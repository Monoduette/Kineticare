/**
 * Reggeli napi összesítő a tulajdonosnak.
 *
 * Az order-poll task (5 percenként) minden futás végén megkérdezi, esedékes-e:
 * az első olyan futás küldi, amely Budapest szerint 07:00 után és még aznap
 * nem küldött. Új job-slug és ütemezés nem kell hozzá (egy új slug a
 * payload-jobs enum miatt migrációt igényelne).
 *
 * A levél csak akkor megy ki, ha van teendő (lásd `src/lib/alerts/attention.ts`)
 * vagy az alanyi adómentes keret elérte a 70%-ot. Resend-idempotenciakulcs:
 * `digest-ÉÉÉÉ-HH-NN`. A kulcs 24 óráig él, ugyanazzal a kulccsal a második
 * kérés nem küld második levelet, eltérő tartalomnál 409-et ad
 * (https://resend.com/docs/dashboard/emails/idempotency-keys).
 *
 * TARTÓS NAPI NYOM (PR #305, Codex P2): az SMTP-tartaléknak nincs
 * idempotenciája, ezért a sikeres küldés után egy napi „elküldve” bejegyzés
 * kerül az audit-logs-ba (`src/lib/alerts/digest-claim.ts`). Küldés előtt ezt
 * olvassuk, így egy 07:00 utáni újraindulás vagy deploy sem küld második
 * összesítőt. Ha a bejegyzés írása a küldés után elbukik, a futó folyamat a
 * nap további futásain pótolja. A „megnézem, elküldöm, beírom” lépés napi
 * kulcsú Postgres advisory-zár alatt fut, így két átfedő példány közül csak
 * az egyik küld.
 * A zárra nem várunk: ha foglalt, a másik példány épp küld, és ez a kör
 * `folyamatban` kimenettel, riasztás nélkül kimarad. Nyom csak valódi
 * kézbesítés után kerül be: a noop-szolgáltató (nincs RESEND_API_KEY és
 * SMTP_HOST) „sikere” nem zárja le a napot, így a szolgáltató aznapi
 * beállítása és a deploy után még kimegy a levél.
 *
 * A folyamaton belüli állapot (`DigestState`) csak a napon belüli
 * ütemezést tartja:
 *  - naponta legfeljebb `MAX_DIGEST_ATTEMPTS_PER_DAY` valódi küldési
 *    kísérlet (a `sendMail` hívása számít, a lekérdezés nem), hogy egy tartós
 *    levélhiba ne hívja a szolgáltatót 5 percenként egész nap (Codex P2: a
 *    lekérdezési hiba eddig ebből a keretből fogyasztott);
 *  - a lekérdezési (adatbázis-) hiba után növekvő várakozás
 *    (`assemblyRetryDelayMs`), hogy egy leállt adatbázis ne kapjon 5
 *    percenként lekérdezést és riasztást, de a helyreállás után aznap még
 *    kimenjen a levél;
 *  - címzett nélkül (üres OWNER_ALERT_EMAILS) nincs lekérdezés, és a nap
 *    nem zárul le: ha a címzettet aznap később beállítják, a következő futás
 *    küld (Devin). A hiányt naponta egyszer jelezzük;
 *  - e-mail-szolgáltató nélkül (noop) a nap a folyamaton belül sem zárul le
 *    (Codex): a kimenet `nincs-szolgaltato`, a próbálkozásokat a napi küldési
 *    keret korlátozza, és a hiányt naponta egyszer jelezzük.
 */

import type { Payload } from 'payload'

import { budapestDateString, budapestDateTimeString } from '../date/budapest'
import type { SendMailInput } from '../email'
import type { SendResult } from '../email/types'
import type { Logger } from '../logger'
import { formatAamLine, payloadAamFind, queryAamStatus, type AamStatus } from './aam'
import { aamEstimateApplies } from './aam-mode'
import {
  attentionListHref,
  attentionTotal,
  payloadAttentionSources,
  resolveAttention,
  type AttentionCounts,
  type AttentionDefinition,
} from './attention'
import {
  asDigestClaimPayload,
  digestSentOn,
  recordDigestSent,
  withDigestTryLock,
  type DigestClaimAfter,
  type DigestClaimPayload,
  type DigestLockResult,
} from './digest-claim'

/** Budapest szerinti óra, amelytől az összesítő esedékes. */
export const DIGEST_HOUR_BUDAPEST = 7

/** Naponta legfeljebb ennyiszer hívjuk a levélküldést (valódi küldési kísérlet). */
export const MAX_DIGEST_ATTEMPTS_PER_DAY = 3

const MINUTE_MS = 60 * 1000

/** Az első lekérdezési hiba utáni várakozás; hibánként duplázódik. */
export const DIGEST_ASSEMBLY_RETRY_BASE_MS = 10 * MINUTE_MS

/** A lekérdezési hibák utáni várakozás felső korlátja. */
export const DIGEST_ASSEMBLY_RETRY_MAX_MS = 60 * MINUTE_MS

/** A napi teendők runbookja (a levél erre mutat). */
export const DAILY_RUNBOOK_PATH = 'docs/uzemeltetes/01-napi-ellenorzes.md'

/** Az AAM-átállás runbookja. */
export const AAM_RUNBOOK_PATH = 'docs/uzemeltetes/14-alanyi-adomentes-keret.md'

/** A folyamaton belüli, napra szóló állapot (Budapest-nap). */
export interface DigestState {
  /** A nap (ÉÉÉÉ-HH-NN), amelyre a többi mező vonatkozik. */
  day: string | null
  /** Aznapra lezárva (elküldve, nincs teendő, vagy feladva). */
  done: boolean
  /** Valódi küldési kísérletek (a `sendMail` hívásai) aznap. */
  sendAttempts: number
  /** Egymást követő lekérdezési hibák aznap. */
  assemblyFailures: number
  /** A következő lekérdezés legkorábbi ideje (ms); 0, ha nincs várakozás. */
  retryNotBeforeMs: number
  /** Aznap szóltunk-e már a hiányzó e-mail-szolgáltatóról (noop). */
  providerWarned: boolean
  /** Aznap szóltunk-e már a hiányzó címzettről. */
  recipientWarned: boolean
  /**
   * A kiment levél napi nyoma, ha a küldés után nem íródott be: a nap további
   * futásai pótolják (`retryPendingClaim`). A nap a nyomban van, nem csak a
   * `day` mezőben: így egy későbbi napra sem íródhat be (az a másnapi levelet
   * némítaná el), akkor sem, ha a `startDay` egyszer nem törölné.
   */
  pendingClaim: PendingDigestClaim | null
}

/** A kiment, de be nem írt napi nyom: melyik napra és mit kell beírni. */
export interface PendingDigestClaim {
  readonly day: string
  readonly after: DigestClaimAfter
}

export function createDigestState(): DigestState {
  return {
    day: null,
    done: false,
    sendAttempts: 0,
    assemblyFailures: 0,
    retryNotBeforeMs: 0,
    providerWarned: false,
    recipientWarned: false,
    pendingClaim: null,
  }
}

/** Új napon a számlálók nulláról indulnak. */
function startDay(state: DigestState, today: string): void {
  if (state.day !== today) {
    Object.assign(state, createDigestState(), { day: today })
  }
}

/** A `failures`-edik egymást követő lekérdezési hiba utáni várakozás. */
export function assemblyRetryDelayMs(failures: number): number {
  const exponent = Math.max(0, Math.min(failures - 1, 10))
  return Math.min(DIGEST_ASSEMBLY_RETRY_BASE_MS * 2 ** exponent, DIGEST_ASSEMBLY_RETRY_MAX_MS)
}

function recordAssemblyFailure(state: DigestState, nowMs: number): void {
  state.assemblyFailures += 1
  state.retryNotBeforeMs = nowMs + assemblyRetryDelayMs(state.assemblyFailures)
}

/** A folyamat saját összesítő-állapota (a teszt sajátot ad). */
const processDigestState = createDigestState()

export type DigestOutcome =
  | 'nem-esedekes'
  | 'nincs-teendo'
  | 'nincs-cimzett'
  | 'nincs-szolgaltato'
  | 'elkuldve'
  | 'mar-elkuldve'
  | 'folyamatban'
  | 'hiba'
  | 'feladva'

export interface DigestDeps {
  /**
   * Az éles Payload-példány. Olvasás a számokhoz; a napi nyom írásához a
   * `create`, a zárhoz a `db` is kell (az order-poll a teljes példányt adja).
   */
  readonly payload: Pick<Payload, 'count' | 'find'> & Partial<Pick<Payload, 'create' | 'db'>>
  readonly sendMail: (input: SendMailInput) => Promise<SendResult>
  readonly recipients: () => readonly string[]
  readonly logger: Logger
  readonly nowMs: number
  /** A nyilvános gyökér-URL (linkekhez), pl. https://kineticare.hu. */
  readonly serverUrl: string
  /** A SZAMLAZZ_AFAKULCS értéke: az AAM-sor csak `AAM` mellett készül (`aamEstimateApplies`). */
  readonly vatMode?: string
  readonly state?: DigestState
}

/** A Budapest szerinti óra (0–23). */
export function budapestHour(nowMs: number): number {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Budapest',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(nowMs))
  return Number(hour)
}

/** Esedékes-e most az összesítő. */
export function isDigestDue(nowMs: number, state: DigestState): boolean {
  if (budapestHour(nowMs) < DIGEST_HOUR_BUDAPEST) {
    return false
  }
  const today = budapestDateString(new Date(nowMs))
  if (state.day !== today) {
    return true
  }
  return (
    !state.done &&
    state.sendAttempts < MAX_DIGEST_ATTEMPTS_PER_DAY &&
    nowMs >= state.retryNotBeforeMs
  )
}

export interface DigestMail {
  readonly subject: string
  readonly text: string
  readonly html: string
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function aamNeedsAttention(aam: AamStatus | null): boolean {
  return aam !== null && aam.level !== 'rendben'
}

function aamWarning(aam: AamStatus): string {
  switch (aam.level) {
    case 'tullepve':
      return 'A webshop számlái alapján a keret betelt. Azonnal egyeztess a könyvelővel: az átlépő számlát már áfásan kell kiállítani.'
    case 'figyelem-90':
      return 'A keret 90%-a elfogyott. Egyeztess a könyvelővel még ezen a héten az áfakörbe lépésről.'
    case 'figyelem-70':
      return 'A keret 70%-a elfogyott. Érdemes a könyvelővel átnézni, mikor érheti el a határt.'
    default:
      return 'A keret rendben van.'
  }
}

/**
 * A levél. Csak a nem nulla kategóriák kerülnek bele, mindegyik a szűrt
 * admin-listára mutató linkkel. A `definitions` ugyanabból a
 * `resolveAttention`-hívásból jön, mint a számok, így a link pontosan azt a
 * listát nyitja meg, amelyből a szám jön.
 */
export function buildDigestMail(input: {
  readonly counts: AttentionCounts
  readonly definitions: readonly AttentionDefinition[]
  readonly aam: AamStatus | null
  readonly nowMs: number
  readonly serverUrl: string
}): DigestMail {
  const { counts, aam, nowMs } = input
  const adminRoute = `${input.serverUrl.replace(/\/+$/, '')}/admin`
  const total = attentionTotal(counts)
  const date = budapestDateString(new Date(nowMs))
  const subject =
    total > 0
      ? `Kineticare napi összesítő, ${date}: ${String(total)} teendő`
      : `Kineticare napi összesítő, ${date}: az alanyi adómentes keret figyelmet kér`

  const textLines: string[] = [
    `A Kineticare napi összesítője, ${budapestDateTimeString(new Date(nowMs))} (magyar idő).`,
    '',
  ]
  const htmlParts: string[] = [
    `<p>A Kineticare napi összesítője, ${escapeHtml(budapestDateTimeString(new Date(nowMs)))} (magyar idő).</p>`,
  ]

  if (total > 0) {
    textLines.push('Teendők:')
    htmlParts.push('<p><strong>Teendők:</strong></p>', '<ul>')
    for (const definition of input.definitions) {
      if (definition.reszhalmaz === true) {
        continue
      }
      const count = counts[definition.key]
      if (count === 0) {
        continue
      }
      const subset =
        definition.key === 'fuggoFizetes' && counts.fuggoFizetesRegi > 0
          ? ` (ebből ${String(counts.fuggoFizetesRegi)} egy napnál régebbi)`
          : ''
      const href = attentionListHref(adminRoute, definition.collection, definition.where)
      textLines.push(
        `- ${String(count)} ${definition.label}${subset}`,
        `  ${definition.teendo}`,
        `  Lista: ${href}`,
      )
      htmlParts.push(
        `<li><a href="${escapeHtml(href)}">${String(count)} ${escapeHtml(definition.label)}</a>${escapeHtml(subset)}<br>${escapeHtml(definition.teendo)}</li>`,
      )
    }
    htmlParts.push('</ul>')
    textLines.push('')
  } else {
    textLines.push('Fizetési, számlázási és visszatérítési teendő nincs.', '')
    htmlParts.push('<p>Fizetési, számlázási és visszatérítési teendő nincs.</p>')
  }

  if (aam !== null) {
    const line = `Alanyi adómentes keret, ${formatAamLine(aam)}.`
    const note =
      'A keretbe a vállalkozás minden belföldi bevétele beleszámít, ez a szám csak a webshop számláit látja.'
    textLines.push(line)
    htmlParts.push(`<p>${escapeHtml(line)}`)
    if (aamNeedsAttention(aam)) {
      textLines.push(`${aamWarning(aam)} Útmutató: ${AAM_RUNBOOK_PATH}`)
      htmlParts.push(
        `<br><strong>${escapeHtml(aamWarning(aam))}</strong> Útmutató: ${escapeHtml(AAM_RUNBOOK_PATH)}`,
      )
    }
    textLines.push(note, '')
    htmlParts.push(`<br>${escapeHtml(note)}</p>`)
  }

  const footer = [
    `A napi ellenőrzés lépései: ${DAILY_RUNBOOK_PATH}`,
    'Ugyanezek a számok az admin Irányítópultján, a Figyelmet igényel blokkban is látszanak. Ez a levél csak akkor jön, ha van teendő.',
  ]
  textLines.push(...footer)
  htmlParts.push(`<p>${footer.map(escapeHtml).join('<br>')}</p>`)

  return { subject, text: textLines.join('\n'), html: htmlParts.join('\n') }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A napi nyom tárolója; ha a példány nem tud írni, a küldés nem biztonságos. */
function claimPayload(deps: DigestDeps): DigestClaimPayload {
  const payload = asDigestClaimPayload(deps.payload)
  if (payload === null) {
    throw new Error('a napi összesítő nyoma nem írható: a Payload-példányon nincs create')
  }
  return payload
}

/**
 * A kiment levél be nem írt napi nyomának pótlása (breaker, PR #305 rev2).
 * Minden futás elején, az esedékesség vizsgálata előtt fut, mert a küldés után
 * a nap már le van zárva. A nyom arra a napra kerül, amelyen a levél kiment,
 * és csak azon a napon pótoljuk. Nem dob: a `writeAuditLog` best-effort, a
 * sikertelen pótlást maga naplózza, és a következő futás újra próbálja.
 */
async function retryPendingClaim(deps: DigestDeps, state: DigestState): Promise<void> {
  const pending = state.pendingClaim
  if (pending === null) {
    return
  }
  if (pending.day !== budapestDateString(new Date(deps.nowMs))) {
    // Egy elmúlt nap nyoma már semmit nem véd, más napra beírni pedig tilos.
    state.pendingClaim = null
    return
  }
  const claims = asDigestClaimPayload(deps.payload)
  if (claims !== null && (await recordDigestSent(claims, pending.day, pending.after))) {
    state.pendingClaim = null
    deps.logger.info('napi összesítő: a napi nyom utólag beíródott')
  }
}

/**
 * Az összesítő, ha esedékes. A lekérdezési, a nyom-olvasási és a zár-hibát
 * a hívóra dobja (az order-poll riaszt, lásd poll-watch.ts), és a következő
 * próbát növekvő várakozás után engedi; a levélküldés hibája `hiba` vagy
 * `feladva` kimenet, nem dobás. Ha a napi zárat épp egy másik példány tartja,
 * a kimenet `folyamatban`: nem hiba, a nap nyitva marad.
 */
export async function runDailyDigestIfDue(deps: DigestDeps): Promise<DigestOutcome> {
  const state = deps.state ?? processDigestState
  const log = deps.logger
  await retryPendingClaim(deps, state)
  if (!isDigestDue(deps.nowMs, state)) {
    return 'nem-esedekes'
  }
  const today = budapestDateString(new Date(deps.nowMs))
  startDay(state, today)

  // Címzett nélkül nincs kinek küldeni: se lekérdezés, se napi lezárás, hogy
  // a később beállított címzett még aznap megkapja a levelet.
  const recipients = deps.recipients()
  if (recipients.length === 0) {
    if (!state.recipientWarned) {
      state.recipientWarned = true
      log.warn(
        'napi összesítő: az OWNER_ALERT_EMAILS nincs beállítva, a levél nem megy ki, amíg nincs címzett',
      )
    }
    return 'nincs-cimzett'
  }

  let claims: DigestClaimPayload
  let snapshot: Awaited<ReturnType<typeof resolveAttention>>
  let aam: AamStatus | null
  try {
    claims = claimPayload(deps)
    if (await digestSentOn(claims, today)) {
      state.done = true
      log.info('napi összesítő: ma már elküldte egy korábbi vagy párhuzamos futás')
      return 'mar-elkuldve'
    }
    // Rendszer-szintű számolás (job-kontextus, nincs felhasználó).
    snapshot = await resolveAttention(
      payloadAttentionSources(deps.payload, { overrideAccess: true }),
      deps.nowMs,
    )
    aam = aamEstimateApplies(deps.vatMode)
      ? await queryAamStatus(payloadAamFind(deps.payload, { overrideAccess: true }), deps.nowMs)
      : null
  } catch (error) {
    recordAssemblyFailure(state, deps.nowMs)
    throw error
  }
  state.assemblyFailures = 0
  state.retryNotBeforeMs = 0

  const { counts, definitions } = snapshot
  const total = attentionTotal(counts)
  log.info('napi összesítő: számok', {
    ...counts,
    teendo: total,
    ...(aam ? { aamNetHuf: aam.netHuf, aamLevel: aam.level } : {}),
  })

  if (total === 0 && !aamNeedsAttention(aam)) {
    state.done = true
    return 'nincs-teendo'
  }

  const mail = buildDigestMail({
    counts,
    definitions,
    aam,
    nowMs: deps.nowMs,
    serverUrl: deps.serverUrl,
  })

  // A nyom ellenőrzése, a küldés és a nyom beírása egy napi zár alatt. A zárra
  // nem várunk (a várakozás a pool 30 s-os statement_timeoutjába futna, és
  // hamis riasztást adna, miközben a másik példány küld): foglalt zárnál ez a
  // kör kimarad, a következő futás a nyomot látva már nem küld. A zár
  // session-szintű, tranzakció nélkül: a hosszú SMTP-küldést az
  // idle_in_transaction_session_timeout nem szakítja meg, és a zár
  // kapcsolatának hibája csak figyelmeztetés, nem uncaughtException.
  //
  // Ismert rések. Az 1–3. esetben második levél csak SMTP-n mehet ki, mert a
  // Resend idempotenciakulcsa ezt kivédi:
  //  1. Ha a folyamat a küldés és a nyom beírása között leáll, nyom nem lesz,
  //     és egy később induló példány aznap még egyszer küldhet.
  //  2. Ha a nyom írása a küldés után elbukik, ez a folyamat a következő
  //     futásán pótolja (`retryPendingClaim`). Addig, jellemzően 5 percig,
  //     egy közben induló vagy párhuzamosan futó példány még egyszer küldhet.
  //     Ugyanennek a folyamatnak egy átfedő futása (kézi job-indítás) nem
  //     küldhet: a zár alatt a függő nyomot is nézzük.
  //  3. Ha a zár kapcsolata a küldés közben megszakad (pl.
  //     Postgres-újraindulás), a zár felszabadul, és egy közben induló vagy
  //     párhuzamosan futó példány a nyom beírása előtt küldhet még egyet.
  //  4. Ha a zárat tartó kliens FIN nélkül tűnik el (hálózati szakadás,
  //     gépleállás), a Postgres a session zárját csak akkor engedi el, amikor
  //     a szerver TCP keepalive-ja észleli a halott kapcsolatot. Ez a Linux
  //     alapértékeivel kb. két óra, ha a szerveren a tcp_keepalives_* nincs
  //     beállítva. Addig minden példány riasztás nélkül `folyamatban`-t kap:
  //     a levél késik, és ha a küldés késő este volt, aznapra el is maradhat.
  //
  // Ha a zár a küldés UTÁN hibázik, a küldés eredménye itt marad meg.
  const attempt: { result?: SendResult } = {}
  let locked: DigestLockResult<boolean> = { acquired: false }
  try {
    locked = await withDigestTryLock(
      deps.payload,
      `alerts:daily-digest:${today}`,
      async () => {
        // A függő nyom azt jelenti, hogy ez a folyamat ma már elküldte a levelet
        // (breaker, PR #305 rev4): egy átfedő futás nem küldheti újra.
        if (state.pendingClaim?.day === today || (await digestSentOn(claims, today))) {
          return true
        }
        state.sendAttempts += 1
        const result = await sendDigest(deps, recipients, mail, today)
        attempt.result = result
        if (result.ok && result.provider === 'noop') {
          // Nincs levélszolgáltató: semmi nem ment ki, ezért nyom sem kerül be,
          // hogy a szolgáltató beállítása és a deploy után még aznap kimenjen.
          // A hiányról naponta egyszer szólunk.
          if (state.providerWarned) {
            return false
          }
          state.providerWarned = true
          log.warn(
            'napi összesítő: nincs levélszolgáltató beállítva (noop), a levél nem ment ki; a napi nyom nem íródik be',
          )
        } else if (result.ok) {
          const claim: DigestClaimAfter = { teendo: total, provider: result.provider }
          if (!(await recordDigestSent(claims, today, claim))) {
            // A levél kiment: a nyomot a következő futások pótolják.
            state.pendingClaim = { day: today, after: claim }
            log.warn(
              'napi összesítő: a levél kiment, de a napi nyom nem íródott be; a következő futás pótolja, addig egy közben induló vagy párhuzamosan futó példány ma még egyszer elküldheti',
            )
          }
        }
        return false
      },
      log,
    )
  } catch (error) {
    if (attempt.result === undefined) {
      recordAssemblyFailure(state, deps.nowMs)
      throw error
    }
    // A küldés már lefutott: a zár lezárásának hibája ezt nem teszi semmissé.
    log.warn('napi összesítő: a zár a küldés után hibával zárult', { error: errorText(error) })
  }

  if (attempt.result === undefined && !locked.acquired) {
    // Egy másik példány épp a zár alatt van (küld). Nem hiba, nem riasztunk,
    // és a napot sem zárjuk: ha az a küldés elbukna, itt még pótolható.
    log.info('napi összesítő: egy párhuzamos futás épp küldi, ez a kör kimarad')
    return 'folyamatban'
  }
  if (locked.acquired && locked.value) {
    state.done = true
    log.info('napi összesítő: ma már elküldte egy korábbi vagy párhuzamos futás')
    return 'mar-elkuldve'
  }
  const sent: SendResult = attempt.result ?? { ok: false, provider: 'noop', retryable: true }
  if (sent.ok && sent.provider === 'noop') {
    // Semmi nem ment ki: a nap nyitva marad (Codex, PR #305). Az újabb
    // próbálkozásokat a napi küldési keret korlátozza, a noop is abból fogy.
    return 'nincs-szolgaltato'
  }
  if (sent.ok) {
    state.done = true
    log.info('napi összesítő: levél elküldve', { teendo: total })
    return 'elkuldve'
  }
  if (sent.retryable !== true) {
    // Nem újrapróbálható (pl. a Resend 409-cel jelzi, hogy ma már ment
    // összesítő ezzel a kulccsal): aznapra lezárjuk.
    state.done = true
    log.warn('napi összesítő: a levél nem ment ki, ma már nem próbáljuk újra', { teendo: total })
    return 'feladva'
  }
  log.warn('napi összesítő: a levél nem ment ki, a következő futás újrapróbálja', {
    teendo: total,
    probalkozas: state.sendAttempts,
  })
  return 'hiba'
}

/** A levélküldés; a szolgáltató dobását is `SendResult`-tá alakítja. */
async function sendDigest(
  deps: DigestDeps,
  recipients: readonly string[],
  mail: DigestMail,
  today: string,
): Promise<SendResult> {
  try {
    return await deps.sendMail({
      to: [...recipients],
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      idempotencyKey: `digest-${today}`,
    })
  } catch (error) {
    return { ok: false, provider: 'noop', retryable: true, error: errorText(error) }
  }
}
