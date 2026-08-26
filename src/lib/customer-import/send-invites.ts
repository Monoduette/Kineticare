/**
 * Aktiváló levelek kiküldése — `invite.ts` linkekre épül, magyar sablon.
 * Link/token nem naplózódik; címzett maszkolva. Bukott küldés nem állítja meg a kört.
 * Rate-limit szünet: `INVITE_SEND_DELAY_MS`.
 */

import type { Payload } from 'payload'

import { maskEmail } from '../email/mask'
import { resolveEmailProvider } from '../email/provider'
import { escapeHtml, renderLayout } from '../email/templates/layout'
import type { EmailTemplate } from '../email/types'
import type { Logger } from '../logger'
import { INVITE_TOKEN_TTL_MS, type InviteLink } from './invite'
import type { RowIssue } from './parse'

/** Két küldés közti szünet ezredmásodpercben (rate-limit-barát alapérték). */
export const INVITE_SEND_DELAY_MS = 500

/** A token élettartama NAPOKBAN — a levélszöveghez (az invite.ts TTL-jéből). */
export const INVITE_TOKEN_TTL_DAYS = Math.round(INVITE_TOKEN_TTL_MS / (24 * 60 * 60 * 1000))

// ---------------------------------------------------------------------------
// Levélsablon — tisztán tesztelhető, mellékhatás nélkül
// ---------------------------------------------------------------------------

export interface InviteEmailInput {
  /** A címzett neve; üres/hiányzó névnél semleges megszólítás megy ki. */
  readonly name?: string | null
  /** A személyre szóló aktiválási link (abszolút URL). */
  readonly activationUrl: string
  /** A címzett e-mail-címe — a levélben is szerepel („erre a címre küldtük"). */
  readonly email: string
  /** A link élettartama napokban. Alap: az import token-TTL-je (30 nap). */
  readonly expiresInDays?: number
}

/**
 * Az aktiváló levél magyar sablonja (tárgy + HTML + plain-text).
 *
 * A `docs/vasarlo-migracio-terv.md` 4.2. pontjának szövegét követi: egyetlen
 * kért cselekvés (jelszót beállítani), a hozzáférés kimondva („újra fizetned
 * nem kell"), és a „mi van, ha nem működik / nem én vagyok" ág is benne van.
 *
 * MINDEN behelyettesített érték escape-elve (név, e-mail-cím, link): egy furcsa
 * vagy hosszú e-mail-cím sem törheti szét a HTML-t.
 */
export function inviteEmail(input: InviteEmailInput): EmailTemplate {
  const name = input.name?.trim() ?? ''
  const greeting = name ? `Kedves ${name}!` : 'Kedves Vásárlónk!'
  const days = input.expiresInDays ?? INVITE_TOKEN_TTL_DAYS
  const validity = `A link ${days} napig érvényes.`
  const wrongPerson =
    `Ezt a levelet a(z) ${input.email} címre küldtük, mert ezzel a címmel vásároltál nálunk korábban. ` +
    'Ha nem te vagy a címzett, vagy nem ismered fel a vásárlást, ne használd a linket: ' +
    'válaszolj erre a levélre, és utánanézünk.'
  const notWorking =
    'Ha a link már lejárt vagy nem működik, az oldal „Elfelejtett jelszó" gombjával bármikor ' +
    'kérhetsz újat, ugyanezzel az e-mail-címmel. Ilyenkor a régi link érvénytelenné válik, ' +
    'mindig a legfrissebb levélben lévőt használd.'

  const bodyHtml = [
    escapeHtml(greeting),
    'Elkészült az új Kineticare-fiókod. A korábban megvásárolt kurzusaid már benne vannak: ' +
      '<strong>újra fizetned nem kell</strong>, csak egy jelszót kell beállítanod.',
    'Kattints az alábbi gombra, adj meg egy jelszót (legalább 12 karakter, kis- és nagybetűvel ' +
      'és számmal), majd a belépés után a <strong>Kurzusaim</strong> oldalon találod az anyagaidat.',
    `<strong>${escapeHtml(validity)}</strong> A link személyre szól, ne add tovább senkinek.`,
    escapeHtml(notWorking),
    escapeHtml(wrongPerson),
  ]
  const bodyText = [
    greeting,
    'Elkészült az új Kineticare-fiókod. A korábban megvásárolt kurzusaid már benne vannak: ' +
      'újra fizetned nem kell, csak egy jelszót kell beállítanod.',
    'Nyisd meg az alábbi linket, adj meg egy jelszót (legalább 12 karakter, kis- és nagybetűvel ' +
      'és számmal), majd a belépés után a Kurzusaim oldalon találod az anyagaidat.',
    `${validity} A link személyre szól, ne add tovább senkinek.`,
    notWorking,
    wrongPerson,
  ]

  return {
    subject: 'Itt a linked: állítsd be a jelszavad a Kineticare új felületén',
    ...renderLayout({
      heading: 'Állítsd be a jelszavad',
      paragraphsHtml: bodyHtml,
      paragraphsText: bodyText,
      cta: { label: 'Jelszó beállítása', url: input.activationUrl },
    }),
  }
}

// ---------------------------------------------------------------------------
// Indítási feltételek
// ---------------------------------------------------------------------------

/**
 * A `--send-invites` mód indítási ellenőrzése.
 *
 * Magyar hibaüzenetet ad vissza, ha a mód NEM indítható; `null`-t, ha minden
 * feltétel adott. Két blokkoló eset van:
 *
 *  - `--dry-run`-nal együtt: a próbafutás definíció szerint nem ír és nem küld,
 *    a kettő együtt értelmezhetetlen kérés — inkább álljunk meg, mint hogy a
 *    felhasználó azt higgye, „próbaképp" ment ki 300 valódi levél;
 *  - beállított e-mail-szolgáltató nélkül: kulcs híján a provider `noop`, azaz
 *    a levelek CSENDBEN elnyelődnének, és a futás sikeresnek látszana.
 */
export function checkSendInvitesPreconditions(input: {
  readonly dryRun: boolean
  readonly env?: Readonly<Record<string, string | undefined>>
}): string | null {
  if (input.dryRun) {
    return (
      'a --send-invites és a --dry-run nem használható együtt. A próbafutás nem ír és nem küld ' +
      'semmit. Előbb futtasd le a próbafutást, nézd át a tervet, majd a --dry-run NÉLKÜL indítsd ' +
      'az éles futást a --send-invites kapcsolóval.'
    )
  }
  const provider = resolveEmailProvider(input.env ?? process.env)
  if (provider.name === 'noop') {
    return (
      'nincs beállítva e-mail-szolgáltató, ezért a levelek nem mennek ki (csendben elnyelődnének). ' +
      'Állítsd be a RESEND_API_KEY változót a Railway → Variables felületén (a kulcs a repóba SOHA ' +
      'nem kerülhet), és az EMAIL_FROM feladót egy Resendben hitelesített domainre, majd indítsd újra.'
    )
  }
  return null
}

// ---------------------------------------------------------------------------
// Küldés
// ---------------------------------------------------------------------------

/** Egy címzett kiküldésének eredménye — a CLI ezt írja ki soronként. */
export interface InviteSendOutcome {
  readonly email: string
  readonly ok: boolean
  /** Magyar hibaüzenet, ha `ok: false`. */
  readonly error?: string
}

/** A záró MÉRLEG e-mail-számai (a végrehajtás összesítőjének mintájára). */
export interface InviteSendSummary {
  elkuldve: number
  sikertelen: number
}

export interface InviteSendResult {
  readonly outcomes: readonly InviteSendOutcome[]
  readonly summary: InviteSendSummary
  /** A sikertelen küldések a futás hibalistájához (sorszám nélkül). */
  readonly issues: readonly RowIssue[]
}

export interface SendInvitesOptions {
  readonly log?: Logger
  /** E-mail → megjelenő név a megszólításhoz (hiányzó név sem hiba). */
  readonly names?: ReadonlyMap<string, string>
  /** Szünet két küldés közt ms-ban. Alap: INVITE_SEND_DELAY_MS. */
  readonly delayMs?: number
  /** Soronkénti visszajelzés a CLI-nek (a lib maga nem ír a kimenetre). */
  readonly onOutcome?: (outcome: InviteSendOutcome) => void
  /** Várakozás — tesztből felülírható, hogy ne teljen valós idő. */
  readonly sleep?: (ms: number) => Promise<void>
  /** A link élettartama napokban a levélszöveghez. */
  readonly expiresInDays?: number
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/**
 * A küldés eredménye a Payload e-mail-adapterétől.
 *
 * A `payload.sendEmail` visszatérési típusa a Payloadban `unknown` (az adapter
 * dönti el, mit ad vissza), ezért típusszűkítéssel olvassuk. A projekt saját
 * adaptere (`src/lib/email/adapter.ts`) SOSEM dob hibát, hanem
 * `{ ok, error }` alakú SendResultot ad — ezt itt észre kell venni, különben a
 * sikertelen küldés is sikernek látszana. Más adapter (pl. a Payload gyári
 * nodemailerje) hibát dob; azt a hívó `try/catch`-e fogja el.
 */
function sendFailureReason(result: unknown): string | null {
  if (typeof result !== 'object' || result === null) {
    return null
  }
  const record = result as Record<string, unknown>
  if (record.ok === false) {
    return typeof record.error === 'string' && record.error.length > 0
      ? record.error
      : 'a levelező-szolgáltató elutasította a küldést'
  }
  return null
}

/**
 * Aktiváló levelek kiküldése a megadott linkekhez.
 *
 * A linkeket az `invite.ts` `generateInviteLinks` függvénye állítja elő; ez a
 * modul már csak a levelet fogalmazza meg és kiküldi. Üres lista NEM hiba —
 * a hívó ilyenkor a „Nincs kinek küldeni" üzenetet írja ki.
 */
export async function sendInviteEmails(
  payload: Payload,
  links: readonly InviteLink[],
  options: SendInvitesOptions = {},
): Promise<InviteSendResult> {
  const outcomes: InviteSendOutcome[] = []
  const issues: RowIssue[] = []
  const summary: InviteSendSummary = { elkuldve: 0, sikertelen: 0 }
  const delayMs = options.delayMs ?? INVITE_SEND_DELAY_MS
  const sleep = options.sleep ?? defaultSleep

  for (const [index, link] of links.entries()) {
    // Rate-limit-barát szünet a küldések KÖZÖTT (az első elé nem kell).
    if (index > 0 && delayMs > 0) {
      await sleep(delayMs)
    }

    let outcome: InviteSendOutcome
    try {
      const template = inviteEmail({
        name: options.names?.get(link.email) ?? null,
        activationUrl: link.url,
        email: link.email,
        ...(options.expiresInDays !== undefined ? { expiresInDays: options.expiresInDays } : {}),
      })
      const result: unknown = await payload.sendEmail({
        to: link.email,
        subject: template.subject,
        html: template.html,
        text: template.text,
      })
      const failure = sendFailureReason(result)
      outcome =
        failure === null
          ? { email: link.email, ok: true }
          : { email: link.email, ok: false, error: failure }
    } catch (error) {
      outcome = {
        email: link.email,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }

    if (outcome.ok) {
      summary.elkuldve += 1
    } else {
      summary.sikertelen += 1
      issues.push({
        line: 0,
        email: outcome.email,
        reason: `Aktiváló levél hiba: ${outcome.error ?? 'ismeretlen hiba'}`,
      })
      // Maszkolt cím: a teljes cím és a link sem kerülhet naplóba.
      options.log?.warn('vásárló-import: aktiváló levél sikertelen', {
        cimzett: maskEmail(outcome.email),
        error: outcome.error,
      })
    }

    outcomes.push(outcome)
    options.onOutcome?.(outcome)
  }

  // Sem a token, sem a link nem kerülhet naplóba — csak darabszám.
  options.log?.info('vásárló-import: aktiváló levelek kiküldve', {
    elkuldve: summary.elkuldve,
    sikertelen: summary.sikertelen,
  })

  return { outcomes, summary, issues }
}
