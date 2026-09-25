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
 * (https://resend.com/docs/dashboard/emails/idempotency-keys). Egy
 * újraindult folyamat így aznap nem küld második összesítőt.
 *
 * Az állapot (küldött-e ma) folyamaton belüli; naponta legfeljebb
 * `MAX_DIGEST_ATTEMPTS_PER_DAY` próbálkozás, hogy egy tartós levélhiba ne
 * hívja a Resendet 5 percenként egész nap.
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

/** Budapest szerinti óra, amelytől az összesítő esedékes. */
export const DIGEST_HOUR_BUDAPEST = 7

/** Naponta legfeljebb ennyiszer próbáljuk elküldeni. */
export const MAX_DIGEST_ATTEMPTS_PER_DAY = 3

/** A napi teendők runbookja (a levél erre mutat). */
export const DAILY_RUNBOOK_PATH = 'docs/uzemeltetes/01-napi-ellenorzes.md'

/** Az AAM-átállás runbookja. */
export const AAM_RUNBOOK_PATH = 'docs/uzemeltetes/14-alanyi-adomentes-keret.md'

export interface DigestState {
  doneDate: string | null
  attemptDate: string | null
  attempts: number
}

export function createDigestState(): DigestState {
  return { doneDate: null, attemptDate: null, attempts: 0 }
}

/** A folyamat saját összesítő-állapota (a teszt sajátot ad). */
const processDigestState = createDigestState()

export type DigestOutcome =
  'nem-esedekes' | 'nincs-teendo' | 'nincs-cimzett' | 'elkuldve' | 'hiba' | 'feladva'

export interface DigestDeps {
  readonly payload: Pick<Payload, 'count' | 'find'>
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
  if (state.doneDate === today) {
    return false
  }
  return !(state.attemptDate === today && state.attempts >= MAX_DIGEST_ATTEMPTS_PER_DAY)
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

/**
 * Az összesítő, ha esedékes. Soha nem dob: minden hiba warn/riasztás és
 * `hiba` kimenet, a poll-futás ettől zavartalan.
 */
export async function runDailyDigestIfDue(deps: DigestDeps): Promise<DigestOutcome> {
  const state = deps.state ?? processDigestState
  const log = deps.logger
  if (!isDigestDue(deps.nowMs, state)) {
    return 'nem-esedekes'
  }
  const today = budapestDateString(new Date(deps.nowMs))
  if (state.attemptDate !== today) {
    state.attemptDate = today
    state.attempts = 0
  }
  state.attempts += 1

  // Rendszer-szintű számolás (job-kontextus, nincs felhasználó).
  const { counts, definitions } = await resolveAttention(
    payloadAttentionSources(deps.payload, { overrideAccess: true }),
    deps.nowMs,
  )
  const aam = aamEstimateApplies(deps.vatMode)
    ? await queryAamStatus(payloadAamFind(deps.payload, { overrideAccess: true }), deps.nowMs)
    : null
  const total = attentionTotal(counts)
  log.info('napi összesítő: számok', {
    ...counts,
    teendo: total,
    ...(aam ? { aamNetHuf: aam.netHuf, aamLevel: aam.level } : {}),
  })

  if (total === 0 && !aamNeedsAttention(aam)) {
    state.doneDate = today
    return 'nincs-teendo'
  }

  const recipients = deps.recipients()
  if (recipients.length === 0) {
    state.doneDate = today
    log.warn(
      'napi összesítő: van teendő, de az OWNER_ALERT_EMAILS nincs beállítva, a levél nem megy ki',
      { teendo: total },
    )
    return 'nincs-cimzett'
  }

  const mail = buildDigestMail({
    counts,
    definitions,
    aam,
    nowMs: deps.nowMs,
    serverUrl: deps.serverUrl,
  })
  let result: SendResult
  try {
    result = await deps.sendMail({
      to: [...recipients],
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      idempotencyKey: `digest-${today}`,
    })
  } catch (error) {
    result = {
      ok: false,
      provider: 'noop',
      retryable: true,
      error: error instanceof Error ? error.message : String(error),
    }
  }

  if (result.ok) {
    state.doneDate = today
    log.info('napi összesítő: levél elküldve', { teendo: total })
    return 'elkuldve'
  }
  if (result.retryable !== true) {
    // Nem újrapróbálható (pl. a Resend 409-cel jelzi, hogy ma már ment
    // összesítő ezzel a kulccsal): aznapra lezárjuk.
    state.doneDate = today
    log.warn('napi összesítő: a levél nem ment ki, ma már nem próbáljuk újra', { teendo: total })
    return 'feladva'
  }
  log.warn('napi összesítő: a levél nem ment ki, a következő futás újrapróbálja', {
    teendo: total,
    probalkozas: state.attempts,
  })
  return 'hiba'
}
