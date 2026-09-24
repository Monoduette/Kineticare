import { trackMetaLead } from './meta-events'
import { ANALYTICS_EVENTS, captureAnalyticsEvent } from './posthog'

/**
 * Lead funnel: submitted (kliens) vs succeeded (szerver). Csak forrás-címke + kurzus id, személyes adat nem.
 */

/** A lead-források ZÁRT készlete — a riportok ezekre a címkékre bontanak. */
export const LEAD_FORRASOK = [
  'kapcsolat',
  'idopontkeres',
  'hirlevel',
  'ingyenes-kurzus',
] as const

/** Egy lead forrása. Szűk unió: szabad sztringet a típus nem enged át. */
export type LeadForras = (typeof LEAD_FORRASOK)[number]

/**
 * A forrás-címkén FELÜL küldhető, nem személyes adatok.
 *
 * Ma egyetlen mező van: az ingyenes kurzus igénylésénél a kért kurzus
 * adatbázis-azonosítója (szám, a saját rendszerünkön kívül semmit nem jelent).
 * A típus szándékosan szűk — új mezőt csak ide, kimondott indoklással.
 */
export interface LeadEventExtra {
  courseId?: number
}

/** Az esemény tulajdonságai — EGY helyen, hogy a két esemény ne csúszhasson el. */
function leadProps(forras: LeadForras, extra?: LeadEventExtra): Record<string, unknown> {
  return {
    leadSource: forras,
    // A hiányzó/érvénytelen azonosító ki sem kerül (nem null-ként, nem NaN-ként).
    ...(typeof extra?.courseId === 'number' && Number.isFinite(extra.courseId)
      ? { courseId: extra.courseId }
      : {}),
  }
}

/**
 * A látogató ELINDÍTOTTA a beküldést (a kérés kiment).
 *
 * Nem jelenti, hogy a beküldés meg is érkezett — azt a `trackLeadSucceeded`
 * mondja meg. A kettő különbsége a mérőszám (lásd a modul fejlécét).
 */
export function trackLeadSubmitted(forras: LeadForras, extra?: LeadEventExtra): void {
  captureAnalyticsEvent(ANALYTICS_EVENTS.leadSubmitted, leadProps(forras, extra))
}

/** A szerver VISSZAIGAZOLTA a beküldést (a lead ténylegesen létrejött). */
export function trackLeadSucceeded(forras: LeadForras, extra?: LeadEventExtra): void {
  captureAnalyticsEvent(ANALYTICS_EVENTS.leadSucceeded, leadProps(forras, extra))
  // Meta Pixel `Lead`: csak a forrás-címke megy ki, és csak hozzájárulással.
  trackMetaLead(forras)
}

/**
 * A két küldő egy objektumban — kizárólag azért, hogy a négy űrlap beküldő
 * burka INJEKTÁLHATÓ legyen, és a tesztek kémeket adhassanak be valódi
 * PostHog-hívás (és jsdom) nélkül. A repóban ez a bevált minta
 * (`TrackedRegisterDeps`, `TrackedNewsletterDeps`).
 */
export interface LeadTrackers {
  submitted: (forras: LeadForras, extra?: LeadEventExtra) => void
  succeeded: (forras: LeadForras, extra?: LeadEventExtra) => void
}

/** Az éles küldők — ezt kapja minden űrlap, ha nem injektálnak mást. */
export const LEAD_TRACKERS: LeadTrackers = {
  submitted: trackLeadSubmitted,
  succeeded: trackLeadSucceeded,
}

export interface LeadTrackingOptions {
  extra?: LeadEventExtra
  trackers?: LeadTrackers
}

/**
 * Egy űrlap-beküldés lead-mérésbe csomagolva.
 *
 * A `submitted` a hívás ELŐTT, a `succeeded` CSAK sikeres szerverválasz után
 * megy ki — a sorrend maga a szerződés, ezért él egy helyen, és nem négy
 * komponensben szétmásolva.
 *
 * MIÉRT `try/catch` MINDKÉT KÜLDŐN: a mérés hibája NEM ronthatja el a
 * beküldést. Ha a PostHog-kliens bármely okból dob (blokkoló kiegészítő,
 * hibás konfiguráció), a látogató ebből semmit nem érzékelhet — ugyanaz az
 * elv, amit a `trackedRegister` alkalmaz a Barion-eseménynél
 * (src/components/auth/RegisterForm.tsx).
 *
 * A `submit` hibáját NEM nyeljük el: az az űrlap dolga (magyar hibaüzenet,
 * megmaradó űrlap-állapot).
 */
export async function withLeadTracking<T extends { ok: boolean }>(
  forras: LeadForras,
  submit: () => Promise<T>,
  options: LeadTrackingOptions = {},
): Promise<T> {
  const trackers = options.trackers ?? LEAD_TRACKERS

  try {
    trackers.submitted(forras, options.extra)
  } catch {
    // A mérés hibája nem érheti el a felhasználót.
  }

  const result = await submit()

  if (result.ok) {
    try {
      trackers.succeeded(forras, options.extra)
    } catch {
      // A mérés hibája nem érheti el a felhasználót.
    }
  }

  return result
}
