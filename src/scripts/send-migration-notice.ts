/**
 * Átköltöztetési értesítő a MÁR feltöltött vevőknek (WP40).
 *
 * `npm run email:migracio`: alapból PRÓBAFUTÁS: kiírja a címzettek számát és
 * maszkolt listáját, semmi nem megy ki. Küldés csak
 * `MIGRATION_NOTICE_CONFIRM=igen` alatt. `--test-to=<cím>` egyetlen tesztlevél
 * a megadott címre, kapu nélkül, jelölés nélkül.
 *
 * Címzett-kör, idempotencia, ütemezés: `src/lib/migration-notice/`.
 * Útmutató: `docs/vasarlo-migracio-terv.md` 4.7 és 6.7.
 */

import { getPayload } from 'payload'

import { resolveServerUrl } from '../lib/customer-import/invite'
import { maskEmail } from '../lib/email/mask'
import { resolveEmailProvider, sendMail } from '../lib/email/provider'
import { MIGRATION_NOTICE_REPLY_TO, migrationNoticeEmail } from '../lib/email/templates/migration'
import { createLogger } from '../lib/logger'
import {
  collectMigrationNoticeRecipients,
  type MigrationNoticeRecipient,
} from '../lib/migration-notice/recipients'
import { sendMigrationNotices, type MigrationNoticeSendOutcome } from '../lib/migration-notice/send'
import config from '../payload.config'

const log = createLogger({ script: 'send-migration-notice' })

const write = (text: string): void => {
  process.stdout.write(`${text}\n`)
}
const writeError = (text: string): void => {
  process.stderr.write(`${text}\n`)
}

/** A küldést engedélyező környezeti változó és az elvárt értéke. */
export const MIGRATION_NOTICE_CONFIRM_ENV = 'MIGRATION_NOTICE_CONFIRM'
export const MIGRATION_NOTICE_CONFIRM_VALUE = 'igen'

interface CliArgs {
  testTo?: string
  limit?: number
  only?: string
  force: boolean
  includeNoAccess: boolean
}

type ArgsResult =
  | { readonly kind: 'args'; readonly args: CliArgs }
  | { readonly kind: 'help' }
  | { readonly kind: 'error' }

const USAGE = [
  'Átköltöztetési értesítő a már feltöltött vevőknek (WP40)',
  '',
  'Használat:',
  '  npm run email:migracio -- [opciók]',
  '',
  'Alapból PRÓBAFUTÁS: címzettek száma és maszkolt listája, levél nem megy ki.',
  `Éles küldés: ${MIGRATION_NOTICE_CONFIRM_ENV}=${MIGRATION_NOTICE_CONFIRM_VALUE} környezeti változóval.`,
  '',
  'Opciók:',
  '  --test-to=<cím>   EGY tesztlevél a megadott címre (kapu nélkül, jelölés nélkül).',
  '  --limit=<N>       Legfeljebb N címzett (próbakörhöz; azonosító szerint az első N).',
  '  --only=<cím>      Csak ez az egy vevő (a címzett-körből).',
  '  --force           Újraküldés azoknak is, akik már megkapták (a jelölést nem tiszteli).',
  '  --include-no-access  A kurzus-hozzáférés nélküli fiókok is kapjanak levelet',
  '                    (alapból kimaradnak: nekik a Kurzusaim-ígéret hamis lenne).',
  '  --help            Ez a súgó.',
  '',
  'Címzett-kör: customer szerepkör, a rendszer hozta létre a fiókot (import vagy',
  'ingyenes-kurzus igénylés), és még nem állított be saját jelszót',
  '(passwordSetupPending). Aki az új oldalon rendelt, vagy már megkapta a levelet,',
  'kimarad. Egy címre EGYSZER megy ki a levél (users.migrationNoticeSentAt).',
  '',
  'Kilépési kód: 0 = hibátlan, 1 = indítási hiba vagy sikertelen küldés.',
].join('\n')

function parseArgs(argv: readonly string[]): ArgsResult {
  const args: CliArgs = { force: false, includeNoAccess: false }
  for (const raw of argv) {
    if (raw === '--help' || raw === '-h') {
      write(USAGE)
      return { kind: 'help' }
    }
    if (raw === '--force') {
      args.force = true
      continue
    }
    if (raw === '--include-no-access') {
      args.includeNoAccess = true
      continue
    }
    const eq = raw.indexOf('=')
    const key = eq === -1 ? raw : raw.slice(0, eq)
    const value = eq === -1 ? '' : raw.slice(eq + 1).trim()
    if (key === '--test-to') {
      if (!value.includes('@')) {
        writeError('Hiba: a --test-to értéke egy e-mail-cím legyen (--test-to=valaki@example.com).')
        return { kind: 'error' }
      }
      args.testTo = value
      continue
    }
    if (key === '--only') {
      if (!value.includes('@')) {
        writeError('Hiba: az --only értéke egy e-mail-cím legyen (--only=valaki@example.com).')
        return { kind: 'error' }
      }
      args.only = value
      continue
    }
    if (key === '--limit') {
      const n = Number(value)
      if (!Number.isInteger(n) || n < 0) {
        writeError('Hiba: a --limit értéke nem negatív egész szám legyen (--limit=20).')
        return { kind: 'error' }
      }
      args.limit = n
      continue
    }
    writeError(`Hiba: ismeretlen kapcsoló: ${raw}`)
    write(USAGE)
    return { kind: 'error' }
  }
  return { kind: 'args', args }
}

/** Magyar hibaüzenet, ha a küldés NEM indítható; `null`, ha minden feltétel adott. */
export function checkSendPreconditions(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const provider = resolveEmailProvider(env)
  if (provider.name === 'noop') {
    return (
      'nincs beállítva e-mail-szolgáltató, ezért a levelek nem mennének ki (csendben elnyelődnének). ' +
      'Állítsd be a RESEND_API_KEY változót a Railway → Variables felületén (a kulcs a repóba SOHA ' +
      'nem kerülhet), és az EMAIL_FROM feladót egy Resendben hitelesített domainre, majd indítsd újra.'
    )
  }
  return null
}

function printRecipients(recipients: readonly MigrationNoticeRecipient[]): void {
  for (const recipient of recipients) {
    const flags = [
      recipient.hasAccess ? '' : 'nincs kurzus-hozzáférés',
      recipient.sentAt ? `már kapott: ${recipient.sentAt}` : '',
    ].filter((flag) => flag.length > 0)
    write(
      `  ${maskEmail(recipient.email)} (#${String(recipient.id)})${flags.length ? ` · ${flags.join(' · ')}` : ''}`,
    )
  }
}

async function run(args: CliArgs): Promise<number> {
  const confirmed = process.env[MIGRATION_NOTICE_CONFIRM_ENV] === MIGRATION_NOTICE_CONFIRM_VALUE
  const willSend = confirmed || args.testTo !== undefined

  if (willSend) {
    const problem = checkSendPreconditions()
    if (problem) {
      writeError(`Hiba: ${problem}`)
      return 1
    }
  }
  const serverUrl = resolveServerUrl()

  // --- Tesztlevél EGY címre (kapu nélkül, adatbázis nélkül) -------------------
  if (args.testTo !== undefined) {
    const template = migrationNoticeEmail({ name: null, email: args.testTo, serverUrl })
    write(`TESZTLEVÉL küldése: ${maskEmail(args.testTo)} (tárgy: „${template.subject}")`)
    const result = await sendMail({
      to: args.testTo,
      subject: template.subject,
      html: template.html,
      text: template.text,
      replyTo: MIGRATION_NOTICE_REPLY_TO,
      idempotencyKey: `migracio-teszt-${Date.now().toString(36)}`,
    })
    if (!result.ok) {
      writeError(`Hiba: a tesztlevél nem ment ki: ${result.error ?? 'ismeretlen hiba'}`)
      return 1
    }
    write(
      `TESZTLEVÉL elküldve (${result.provider}${result.id ? `, id: ${result.id}` : ''}). Jelölés nem történt.`,
    )
    return 0
  }

  // --- Címzett-kör (csak olvasás) --------------------------------------------
  const payload = await getPayload({ config })
  const selection = await collectMigrationNoticeRecipients(payload, {
    force: args.force,
    includeNoAccess: args.includeNoAccess,
    ...(args.only !== undefined ? { only: args.only } : {}),
    ...(args.limit !== undefined ? { limit: args.limit } : {}),
  })
  const { recipients, skipped } = selection
  const noAccess = recipients.filter((recipient) => !recipient.hasAccess).length

  write('')
  write(
    `CÍMZETT-KÖR: ${recipients.length} vevő` +
      ` (kihagyva: már kapott ${skipped.alreadySent}, új oldalon rendelt ${skipped.hasNewSiteOrder}, ` +
      `hozzáférés nélkül ${selection.excludedNoAccess.length}, szűrő miatt ${skipped.filteredOut}).`,
  )
  printRecipients(recipients)
  if (selection.excludedNoAccess.length > 0) {
    write('')
    write(
      `HOZZÁFÉRÉS NÉLKÜL, nem kap levelet: ${selection.excludedNoAccess.length} ` +
        '(purchases és accessGrants üres; előbb a címke → SKU tábla, docs/vasarlo-migracio-terv.md 10. pont; ' +
        'kérésre --include-no-access):',
    )
    printRecipients(selection.excludedNoAccess)
  }
  if (noAccess > 0) {
    write(
      `FIGYELEM: --include-no-access miatt ${noAccess} címzettnek nincs kurzus-hozzáférése; ` +
        'a levél Kurzusaim-mondata nekik üres oldalt ígér.',
    )
  }

  // --- Próbafutás --------------------------------------------------------------
  if (!confirmed) {
    write('')
    write(
      `PRÓBAFUTÁS: levél NEM ment ki, jelölés nem történt. Éles küldés: ${MIGRATION_NOTICE_CONFIRM_ENV}=${MIGRATION_NOTICE_CONFIRM_VALUE} ` +
        'környezeti változóval, ugyanezzel a paranccsal.',
    )
    return 0
  }

  // --- Éles küldés -------------------------------------------------------------
  if (recipients.length === 0) {
    write('')
    write('Nincs kinek küldeni, levél nem ment ki. Ez nem hiba.')
    return 0
  }

  write('')
  write(`ÉLES KÜLDÉS (${recipients.length} címzett${args.force ? ', --force' : ''}):`)
  const printOutcome = (outcome: MigrationNoticeSendOutcome): void => {
    const cim = maskEmail(outcome.email)
    if (!outcome.ok) {
      write(
        `  [SIKERTELEN] ${cim}: ${outcome.error ?? 'ismeretlen hiba'} (${outcome.attempts}. kísérlet)`,
      )
    } else if (outcome.markFailed) {
      write(`  [ELKÜLDVE, JELÖLÉS SIKERTELEN] ${cim}`)
    } else {
      write(`  [ELKÜLDVE] ${cim}`)
    }
  }
  const sent = await sendMigrationNotices(payload, recipients, {
    serverUrl,
    send: sendMail,
    log,
    onOutcome: printOutcome,
  })

  const failed = sent.outcomes.filter((outcome) => !outcome.ok)
  const markFailed = sent.outcomes.filter((outcome) => outcome.ok && outcome.markFailed)
  write('')
  write(
    `MÉRLEG: elküldve ${sent.summary.elkuldve}, sikertelen ${sent.summary.sikertelen}, ` +
      `jelölés sikertelen ${sent.summary.jelolesSikertelen}.`,
  )
  if (failed.length > 0) {
    write('Sikertelen küldések (maszkolt cím · fiók-azonosító · hiba):')
    for (const outcome of failed) {
      write(
        `  ${maskEmail(outcome.email)} · #${String(outcome.userId)} · ${outcome.error ?? 'ismeretlen hiba'}`,
      )
    }
    write('Javítás után ugyanez a parancs újrafuttatható: a már jelölt címzettek kimaradnak.')
  }
  if (markFailed.length > 0) {
    write(
      'A jelölés nélkül maradt fiókokat a következő futás ÚJRA címzettnek látná; 24 órán belül a ' +
        'Resend idempotencia-kulcsa véd, utána az adminban állítsd be kézzel a dátumot vagy zárd ki --only nélkül.',
    )
  }
  return failed.length > 0 ? 1 : 0
}

const parsedArgs = parseArgs(process.argv.slice(2))
if (parsedArgs.kind !== 'args') {
  process.exit(parsedArgs.kind === 'help' ? 0 : 1)
}

run(parsedArgs.args)
  .then((code) => {
    process.exit(code)
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    log.error('átköltöztetési értesítő sikertelen', { error: message })
    writeError(`Hiba: ${message}`)
    process.exit(1)
  })
