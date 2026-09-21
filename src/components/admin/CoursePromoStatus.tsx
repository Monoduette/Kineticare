'use client'

import { useFormFields } from '@payloadcms/ui'
import { useEffect, useState, type CSSProperties, type JSX } from 'react'

import { formatPriceHuf } from '../../lib/format-price'

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

export const PROMO_PRICE_WARNING =
  'Az akciós ár nem kisebb az Árnál (vagy nem egész, pozitív összeg), ezért nem érvényes: a vevő a rendes Árat fizeti, és áthúzott ár nem jelenik meg.'

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
  /** Az állapot kódja (a nézet ebből színez); 'nem-lathato': az időablak él, de a bolt nem mutatja. */
  reason: CoursePromo['reason'] | 'nem-lathato'
}

const HALF_DAY_MS = 12 * 60 * 60 * 1000

/**
 * Az állapot-szöveg a feloldás eredményéből (tiszta függvény, tesztelhető).
 * A dátumfeliratok Budapest szerintiek: az utolsó nap a kizáró pillanat
 * előtti nap, az első nap a kezdő pillanat napja.
 */
export const NOT_PUBLISHED_WARNING =
  'A kurzus nincs közzétéve (piszkozat vagy archivált), ezért az akciós megjelenés és az Akció címke nem jelenik meg, amíg a Megjelenés a weboldalon mező nem Közzétéve.'

export const DRAFT_WARNING =
  'A dokumentumnak nem közzétett módosításai vannak: az itteni beállítások közzététel után élnek.'

export const NO_PRICE_WARNING =
  'A kurzusnak nincs érvényes ára (ingyenes vagy üres az ár), ezért az akciós megjelenés és az Akció címke nem jelenik meg.'

export function deriveCoursePromoStatus(
  fields: Parameters<typeof resolveCoursePromo>[0] & {
    status?: string | null
    /** A Payload dokumentum-státusza (piszkozat vagy közzétett verzió). */
    _status?: string | null
  },
  now: Date = new Date(),
): CoursePromoStatusText {
  const promo = resolveCoursePromo(fields, now)
  // WP63: a kitöltött, de érvénytelen (nem kisebb az Árnál) akciós ár figyelmeztet.
  const promoPriceWanted = typeof fields.promoPriceHuf === 'number' && fields.promoPriceHuf > 0
  // Az akciós MEGJELENÉS csak érvényes, pozitív árú kurzuson él (course-promo
  // isCoursePromoDisplayed); ingyenes vagy ár nélküli kurzuson a pipa hatástalan,
  // és ezt itt kell kimondani, ne a kártyán derüljön ki (Codex, #278).
  const hasValidPrice =
    fields.priceInHUFEnabled === true &&
    typeof fields.priceInHUF === 'number' &&
    Number.isFinite(fields.priceInHUF) &&
    fields.priceInHUF > 0
  // A bolti státusz is feltétel (isCoursePromoDisplayed): archivált vagy
  // piszkozat kurzuson a doboz ne mondjon élő akciót (Devin, #278).
  // Fail-closed, mint a bolt: CSAK a szó szerinti 'published' számít
  // közzétettnek; hiányzó vagy null státusz is figyelmeztet (Devin, #278).
  // A bolt KÉT kaput néz: a saját `status` mezőt ÉS a Payload `_status`-t
  // (piszkozat dokumentum nyilvánosan 404). Mindkettőnek közzétettnek kell
  // lennie (Devin, #278).
  const published = fields.status === 'published'
  // Piszkozat dokumentum: vagy még sosem volt közzétéve (404), vagy egy már
  // közzétett kurzus ÚJABB piszkozata (a látogató a legutóbb közzétett változatot
  // látja). A form ezt nem tudja megkülönböztetni, ezért a szöveg csak annyit
  // mond, amit biztosan tudunk: az itteni módosítások közzététel nélkül nem élnek.
  const draftDocument = fields._status === 'draft'
  const warning =
    promo.enabled && !published
      ? NOT_PUBLISHED_WARNING
      : promo.enabled && draftDocument
        ? DRAFT_WARNING
        : promo.enabled && !hasValidPrice
          ? NO_PRICE_WARNING
          : promo.enabled && promoPriceWanted && promo.promoPriceHuf === null
            ? PROMO_PRICE_WARNING
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
  // Az időablak él, de a bolt nem mutatja (nem közzétett vagy ár nélküli
  // kurzus): a főcím nem mondhat élő akciót (Devin, #278). A piszkozat eset
  // külön: ott a közzétett változat élhet, a figyelmeztetés magyaráz.
  if (!published || !hasValidPrice) {
    return {
      message: 'Az akció időablaka él, de az akciós megjelenés most nem látszik.',
      warning,
      reason: 'nem-lathato',
    }
  }
  const head =
    promo.end === null
      ? 'Az akció most él, és nincs megadva a vége.'
      : `Az akció most él (${withDaySuffix(promoDayLabel(new Date(promo.end.getTime() - 1)), 'ig')}).`
  // WP63: kimondjuk, mit fizet MOST a vevő, és mi lesz az ár az akció után,
  // hogy a szerkesztő ne csak a dátumot, az ár-váltást is lássa (NN/g,
  // Visibility of System Status).
  const price =
    promo.promoPriceHuf !== null && promo.regularPriceHuf !== null
      ? ` A vevő most ${formatPriceHuf(promo.promoPriceHuf)}-ot fizet, az akció után magától ${formatPriceHuf(promo.regularPriceHuf)} lesz az ár.`
      : ' Akciós ár nincs megadva, a vevő a rendes Árat fizeti.'
  return { message: `${head}${price}`, warning, reason: null }
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
  const promoPriceHuf = useFormFields(([fields]) => fields?.promoPriceHuf?.value)
  const priceInHUF = useFormFields(([fields]) => fields?.priceInHUF?.value)
  const priceInHUFEnabled = useFormFields(([fields]) => fields?.priceInHUFEnabled?.value)
  const status = useFormFields(([fields]) => fields?.status?.value)
  const documentStatus = useFormFields(([fields]) => fields?._status?.value)

  const values: CoursePromoFields & {
    priceInHUF: number | null
    priceInHUFEnabled: boolean
    status: string | null
    _status: string | null
  } = {
    promoEnabled: promoEnabled === true,
    // Az űrlapban a dátum Date vagy ISO string is lehet; a feloldó stringet vár.
    promoStart: readDateValue(promoStart),
    promoEnd: readDateValue(promoEnd),
    promoPriceHuf: readNumber(promoPriceHuf),
    priceInHUF: readNumber(priceInHUF),
    priceInHUFEnabled: priceInHUFEnabled === true,
    status: typeof status === 'string' ? status : null,
    _status: typeof documentStatus === 'string' ? documentStatus : null,
  }

  // A nyitva hagyott lap az időablak határán (kezdet vagy vég) magától
  // újraszámol: a következő határig időzítőt állítunk, a mezők változásakor
  // újraállítjuk (Devin, #278). Az időzítő felső korlátja a setTimeout 32 bites
  // maximuma; azon túl a következő ébredéskor újra ütemezünk.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const now = Date.now()
    const promo = resolveCoursePromo(values)
    const boundaries = [promo.start, promo.end]
      .filter((d): d is Date => d !== null && d.getTime() > now)
      .map((d) => d.getTime() - now)
    if (boundaries.length === 0) {
      return undefined
    }
    const delay = Math.min(Math.min(...boundaries) + 1000, 2_147_483_647)
    const timer = setTimeout(() => setTick((n) => n + 1), delay)
    return () => clearTimeout(timer)
    // A dátumok és a pipa határozzák meg a következő határt; a `tick` is
    // függőség: minden ébredés után a KÖVETKEZŐ határra is ütemezünk (kezdet
    // után a vég), és a 32 bites korlát után újra.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, values.promoEnabled, values.promoStart, values.promoEnd])

  return <CoursePromoStatusView status={deriveCoursePromoStatus(values)} />
}
