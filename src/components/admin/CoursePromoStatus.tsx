'use client'

import { useFormFields } from '@payloadcms/ui'
import type { CSSProperties, JSX } from 'react'

import {
  promoDayLabel,
  resolveCoursePromo,
  type CoursePromo,
  type CoursePromoFields,
} from '../../lib/course-promo'

/**
 * „Az akció állapota” doboz a kurzus szerkesztőlapján (UI-mező, nem tárol
 * adatot). Csak bekapcsolt „Akciós kurzus” pipa mellett látszik (a mező
 * `condition`-je a products collectionben, src/plugins/ecommerce.ts), és
 * kimondja, hogy az akció MOST él-e, még nem kezdődött el, vagy lejárt.
 *
 * ÉLŐ ÉRTÉK: az űrlap aktuális mezőiből dolgozik (`useFormFields`), tehát a
 * dátum átírása után azonnal a friss állapotot mutatja, mentés nélkül is. A
 * döntést UGYANAZ a feloldás hozza, mint a kurzusoldalét és a kurzuskártyáét
 * (src/lib/course-promo.ts resolveCoursePromo), így a szerkesztő sosem lát
 * mást, mint a látogató (WCAG 2.2 SC 3.2.4, Consistent Identification).
 *
 * A stílus a Payload admin saját CSS-változóira épül (MenuUnlistedLink.tsx
 * mintája): a projekt `--kc-*` tokenjei a vevői felületé, az adminban
 * nincsenek betöltve.
 */

export const PROMO_OFF_MESSAGE = 'Az akciós megjelenés ki van kapcsolva.'

export const ORIGINAL_PRICE_WARNING =
  'Az eredeti ár nem jelenik meg áthúzva, mert nem nagyobb a mostani árnál.'

/**
 * A magyar keltezés ragjai a nap sorszámához (AkH. 12. kiadás 297. pont):
 * kötőjellel, a hangrend szerint. Az elseje kivétel („1-jén”, „1-jétől”,
 * „1-jéig”); mély hangrendű nap: 2, 3, 6, 8, 13, 16, 18, 20, 23, 26, 28, 30.
 */
const BACK_VOWEL_DAYS: ReadonlySet<number> = new Set([2, 3, 6, 8, 13, 16, 18, 20, 23, 26, 28, 30])

export type DaySuffix = 'an' | 'tol' | 'ig'

/** „szeptember 30” + rag: „szeptember 30-án”, „október 1-jétől”, „szeptember 30-ig”. */
export function withDaySuffix(dayLabel: string, suffix: DaySuffix): string {
  const day = Number(dayLabel.split(' ').at(-1))
  if (day === 1) {
    return `${dayLabel}-jé${suffix === 'an' ? 'n' : suffix === 'tol' ? 'től' : 'ig'}`
  }
  const back = BACK_VOWEL_DAYS.has(day)
  if (suffix === 'an') {
    return `${dayLabel}-${back ? 'án' : 'én'}`
  }
  if (suffix === 'tol') {
    return `${dayLabel}-${back ? 'tól' : 'től'}`
  }
  return `${dayLabel}-ig`
}

export interface CoursePromoStatusText {
  /** Az állapot egy mondatban. */
  message: string
  /** Figyelmeztetés az áthúzott árról, vagy null. */
  warning: string | null
  /** Az állapot kódja (a nézet ebből színez). */
  reason: CoursePromo['reason']
}

const HALF_DAY_MS = 12 * 60 * 60 * 1000

/**
 * Az állapot-szöveg a feloldás eredményéből (tiszta függvény, tesztelhető).
 * A dátumfeliratok Budapest szerintiek: az utolsó nap a kizáró pillanat
 * előtti nap, az első nap a kezdő pillanat napja.
 */
export function deriveCoursePromoStatus(
  fields: Parameters<typeof resolveCoursePromo>[0],
  now: Date = new Date(),
): CoursePromoStatusText {
  const promo = resolveCoursePromo(fields, now)
  const originalWanted =
    typeof fields.promoOriginalPriceHuf === 'number' && fields.promoOriginalPriceHuf > 0
  const warning =
    promo.enabled && originalWanted && promo.originalPriceHuf === null
      ? ORIGINAL_PRICE_WARNING
      : null

  if (promo.reason === 'kikapcsolva') {
    return { message: PROMO_OFF_MESSAGE, warning: null, reason: promo.reason }
  }
  if (promo.reason === 'meg-nem-kezdodott' && promo.start !== null) {
    const first = promoDayLabel(new Date(promo.start.getTime() + HALF_DAY_MS))
    return {
      message: `Az akció még nem kezdődött el (${withDaySuffix(first, 'tol')}).`,
      warning,
      reason: promo.reason,
    }
  }
  if (promo.reason === 'lejart' && promo.end !== null) {
    const last = promoDayLabel(new Date(promo.end.getTime() - 1))
    return {
      message: `Az akció lejárt (${withDaySuffix(last, 'an')}).`,
      warning,
      reason: promo.reason,
    }
  }
  const message =
    promo.end === null
      ? 'Az akció most él, és nincs megadva a vége.'
      : `Az akció most él (${withDaySuffix(promoDayLabel(new Date(promo.end.getTime() - 1)), 'ig')}).`
  return { message, warning, reason: null }
}

const panelStyle: CSSProperties = {
  border: '1px solid var(--theme-elevation-150)',
  borderRadius: 'var(--style-radius-m, 6px)',
  marginBottom: 'var(--base)',
  padding: 'calc(var(--base) * 0.75)',
}

const messageStyle: CSSProperties = {
  color: 'var(--theme-elevation-800)',
  fontWeight: 600,
  margin: 0,
  lineHeight: 1.5,
}

const activeStyle: CSSProperties = {
  ...messageStyle,
  color: 'var(--theme-success-600, var(--theme-elevation-800))',
}

const warningStyle: CSSProperties = {
  border: '1px solid var(--theme-warning-500)',
  background: 'var(--theme-warning-50)',
  color: 'var(--theme-elevation-800)',
  borderRadius: 'var(--style-radius-m, 6px)',
  padding: '0.5rem 0.75rem',
  margin: 'calc(var(--base) * 0.5) 0 0',
  lineHeight: 1.5,
}

/** Megjelenítés (állapot-független, tesztelhető). */
export function CoursePromoStatusView({ status }: { status: CoursePromoStatusText }): JSX.Element {
  return (
    <div style={panelStyle}>
      {/* Az állapot mentés nélkül változik, ezért a felolvasónak is szólnia kell. */}
      <p
        role="status"
        aria-live="polite"
        style={status.reason === null ? activeStyle : messageStyle}
      >
        {status.message}
      </p>
      {status.warning !== null ? (
        <p role="alert" style={warningStyle}>
          {status.warning}
        </p>
      ) : null}
    </div>
  )
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readDateValue(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function CoursePromoStatus(): JSX.Element {
  const promoEnabled = useFormFields(([fields]) => fields?.promoEnabled?.value)
  const promoStart = useFormFields(([fields]) => fields?.promoStart?.value)
  const promoEnd = useFormFields(([fields]) => fields?.promoEnd?.value)
  const promoOriginalPriceHuf = useFormFields(([fields]) => fields?.promoOriginalPriceHuf?.value)
  const priceInHUF = useFormFields(([fields]) => fields?.priceInHUF?.value)
  const priceInHUFEnabled = useFormFields(([fields]) => fields?.priceInHUFEnabled?.value)

  const values: CoursePromoFields & { priceInHUF: number | null; priceInHUFEnabled: boolean } = {
    promoEnabled: promoEnabled === true,
    // Az űrlapban a dátum Date vagy ISO string is lehet; a feloldó stringet vár.
    promoStart: readDateValue(promoStart),
    promoEnd: readDateValue(promoEnd),
    promoOriginalPriceHuf: readNumber(promoOriginalPriceHuf),
    priceInHUF: readNumber(priceInHUF),
    priceInHUFEnabled: priceInHUFEnabled === true,
  }

  return <CoursePromoStatusView status={deriveCoursePromoStatus(values)} />
}
