import { formatPriceHuf } from '../../lib/format-price'

/**
 * A kurzus forintos ár-mezőinek közös, React-mentes szabályai (r2-termekor).
 *
 * Két oldal használja, ezért egy helyen él: a szerver-oldali validátorok
 * (src/plugins/ecommerce.ts) és az admin beviteli mezője
 * (src/components/admin/HufPriceField.tsx). A szerkesztő így ugyanazt a
 * szabályt és ugyanazt a mondatot látja a mező alatt, mint amit a mentés
 * hibaüzenete mond (WCAG 2.2 SC 3.2.4, Consistent Identification).
 *
 * A mért hiba, amit a modul megszüntet: a plugin gyári ár-mezője a pontot
 * tizedesjelnek veszi, a forintnak pedig nincs tizedese, így a magyarul
 * beírt „79.500” 80 Ft-ként mentődött (a plugin convertToBaseValue-ja:
 * Math.round(parseFloat('79.500') * 10 ** 0) = 80). Itt a pont és a szóköz
 * ezres tagoló, a tizedesvessző pedig hiba.
 */

/**
 * A legkisebb elfogadott ár (Ft). A Barion kártyás fizetés alsó határa
 * 10 Ft; ennél kisebb összegű rendelést a fizetés elutasítana. Magasabb,
 * józansági alsó határt (például 1 000 Ft) a tulajdonos dönthet el: az
 * egyetlen helye ez a konstans.
 */
export const MIN_PRICE_HUF = 10

/**
 * Az új ár ennél kisebb arányban a közzétetthez képest megerősítést kér: a
 * „79.500” → 80 Ft típusú elírás, a lemaradt nulla (7 950 Ft) és az akarattal
 * nagy árcsökkentés ugyanígy fennakad, de az utóbbi egy pipával átengedhető.
 */
export const PRICE_DROP_CONFIRM_RATIO = 0.5

/**
 * A megerősítések kulcsa a mentés adataiban (admin űrlap) és a
 * `req.context`-ben (Local API, szkriptek). NEM séma-mező: a Payload a
 * sémában nem szereplő kulcsot nem tárolja (a drizzle-adapter csak a
 * deklarált mezőket írja), így új mező és migráció nélkül jut el a mentés
 * validátoraihoz. A megerősítés ÉRTÉKHEZ kötött: csak pontosan azt az árat
 * engedi át, amelyre a tulajdonos rábólintott.
 */
export const PRODUCT_CONFIRMATIONS_KEY = 'kcMegerositesek'

export interface ProductChangeConfirmations {
  /** A megerősített új rendes ár (Ft). */
  priceInHUF?: number
  /** A megerősített új akciós ár (Ft). */
  promoPriceHuf?: number
  /** A tulajdonos megerősítette, hogy a kurzus ingyenes lesz. */
  freeCourse?: boolean
}

export type ConfirmableProductChange = keyof ProductChangeConfirmations

/** Az admin űrlap-állapotának útja egy megerősítéshez (pl. „kcMegerositesek.priceInHUF”). */
export function confirmationPath(change: ConfirmableProductChange): string {
  return `${PRODUCT_CONFIRMATIONS_KEY}.${change}`
}

/** A beküldött megerősítés-objektum szűkítése: minden ismeretlen alakú érték eldobva. */
export function readProductConfirmations(source: unknown): ProductChangeConfirmations {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return {}
  const raw = source as Record<string, unknown>
  const result: ProductChangeConfirmations = {}
  for (const key of ['priceInHUF', 'promoPriceHuf'] as const) {
    const value = raw[key]
    if (typeof value === 'number' && Number.isSafeInteger(value)) result[key] = value
  }
  if (raw.freeCourse === true) result.freeCourse = true
  return result
}

/** Kisebb-e az új ár a hivatkozási ár felénél (a határ maga még nem). */
export function isPriceDrop(value: number, reference: number | null): boolean {
  return reference !== null && reference > 0 && value < reference * PRICE_DROP_CONFIRM_RATIO
}

/** Pozitív, véges szám, különben null (a tárolt és a beküldött ár szűkítése). */
export function positivePriceOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/* Beviteli mező: szöveg ↔ forintösszeg */

/** Ezres tagoló: sima, nem törhető és keskeny nem törhető szóköz, illetve pont. */
const SEPARATORS = /[ .\u00a0\u202f]/g
const REGULAR_GROUPING = /^\d{1,3}(?:[ .\u00a0\u202f]\d{3})+$/
const DIGITS_AND_SEPARATORS = /^[\d .\u00a0\u202f]+$/

export const HUF_INPUT_DECIMAL_MESSAGE =
  'Forintban nincs fillér: egész összeget írj be, tizedesvessző nélkül (például 79 500).'
export const HUF_INPUT_CHARACTER_MESSAGE =
  'Csak számjegyet írj be. Ezres tagolónak szóközt vagy pontot használhatsz (például 79 500 vagy 79.500).'
export const HUF_INPUT_TOO_LARGE_MESSAGE = 'Ez az összeg túl nagy. Ellenőrizd a beírt számot.'

export type HufInputResult =
  | { kind: 'ures' }
  | { kind: 'ertek'; value: number; unusualGrouping: boolean }
  | { kind: 'hiba'; message: string }

/**
 * A beírt szöveg forintösszegként. Elfogadja: „79500”, „79 500”, „79.500”,
 * „79 500 Ft”, „79 500,- Ft”, „79 500 forint”. A pont és a szóköz mindig
 * ezres tagoló; a szabálytalan tagolás („79.50”) is számmá válik (7 950), de
 * jelzést kap, hogy a szerkesztő ellenőrizze. Tizedesvessző és betű: hiba.
 */
export function parseHufInput(text: string): HufInputResult {
  const trimmed = text
    .trim()
    .replace(/(?:ft\.?|huf|forint)$/iu, '')
    .trim()
    .replace(/,-$/u, '')
    .trim()
  if (trimmed === '' || trimmed.replace(SEPARATORS, '') === '') return { kind: 'ures' }
  if (trimmed.includes(',')) return { kind: 'hiba', message: HUF_INPUT_DECIMAL_MESSAGE }
  if (!DIGITS_AND_SEPARATORS.test(trimmed)) {
    return { kind: 'hiba', message: HUF_INPUT_CHARACTER_MESSAGE }
  }
  const digits = trimmed.replace(SEPARATORS, '')
  const value = Number(digits)
  if (digits.length > 15 || !Number.isSafeInteger(value)) {
    return { kind: 'hiba', message: HUF_INPUT_TOO_LARGE_MESSAGE }
  }
  const unusualGrouping = digits !== trimmed && !REGULAR_GROUPING.test(trimmed)
  return { kind: 'ertek', value, unusualGrouping }
}

/** A tárolt összeg a beviteli mezőben: „79 500” (a vásárlói formázó tagolásával, „Ft” nélkül). */
export function formatHufInput(value: number): string {
  return formatPriceHuf(value).replace(/\u00a0Ft$/u, '')
}

/** A beviteli mező alatti előnézet: így jelenik meg az ár a vásárlónak. */
export function hufPreviewText(value: number): string {
  return `Így jelenik meg: ${formatPriceHuf(value)}`
}

/** Szabálytalan tagolásnál: a mező alatt, a mentés előtt. */
export function unusualGroupingNote(value: number): string {
  return `A pontot és a szóközt ezres tagolónak vettük. Ellenőrizd, hogy valóban ${formatPriceHuf(value)} a szándékod.`
}

/* A mentés validátorainak üzenetei */

/** A rendes ár alakja: egész forint, legalább MIN_PRICE_HUF. */
export const PRICE_MESSAGE = `Az ár csak egész forintösszeg lehet, legalább ${MIN_PRICE_HUF} Ft. Írd be újra, vagy hagyd üresen.`

/**
 * A két ár-mező, ahogy a mondatban szerepel. A hibaüzenet megmondja, mi a baj
 * és hogyan javítható (NN/g, Error-Message Guidelines; GOV.UK Design System,
 * Error message; WCAG 2.2 SC 3.3.3 Error Suggestion).
 */
export type PriceFieldKind = 'rendes' | 'akcios'

const PRICE_NOUN: Record<PriceFieldKind, string> = {
  rendes: 'ár',
  akcios: 'akciós ár',
}

const PRICE_DROP_LEAD: Record<PriceFieldKind, string> = {
  rendes: 'Az új ár (',
  akcios: 'Az új akciós ár (',
}

/**
 * Honnan jön a mentés hivatkozási ára: a legutóbb KÖZZÉTETT állapotból (a
 * vásárló ezt látta utoljára), vagy ha a kurzus még sosem volt közzétéve, a
 * fő táblában álló, eddig mentett sorból (másolat, új kurzus).
 */
export type PriceReferenceSource = 'kozzetett' | 'eddigi'

/**
 * Az 50 %-nál nagyobb árcsökkenés hibaüzenete a mentéskor. A hivatkozás a
 * legutóbb KÖZZÉTETT ár (a vásárló ezt látja most, vagy a közzététel
 * visszavonása előtt ezt látta); akciós árnál, ha még nem volt közzétett
 * akciós ár, a közzétett rendes ár. Soha nem közzétett kurzusnál az eddig
 * mentett ár („az eddigi ár”).
 *
 * Megerősítés WCAG 2.2 SC 3.3.4 (Error Prevention: Legal, Financial, Data)
 * szerint: a pénzügyi következményű beküldés „checked … or confirmed”. NN/g,
 * Confirmation Dialogs Can Prevent User Errors: „Be specific and inform users
 * about the consequence of their action”
 * (https://www.nngroup.com/articles/confirmation-dialog/), ezért a mondat a két
 * összeget kimondja, és csak a valóban szokatlan (felére eső) csökkentésnél
 * jelenik meg („Do not use confirmation dialogs for routine actions”).
 */
export function priceDropMessage(
  kind: PriceFieldKind,
  value: number,
  reference: number,
  referenceKind: PriceFieldKind = kind,
  source: PriceReferenceSource = 'kozzetett',
): string {
  const referenceWord = source === 'kozzetett' ? 'a közzétett' : 'az eddigi'
  return `${PRICE_DROP_LEAD[kind]}${formatPriceHuf(value)}) kevesebb, mint ${referenceWord} ${PRICE_NOUN[referenceKind]} (${formatPriceHuf(reference)}) fele. Ha elírás, javítsd. Ha szándékos, jelöld be a mező alatti megerősítést.`
}

/**
 * A mező alatti figyelmeztetés mentés előtt. A hivatkozás az űrlap
 * betöltésekori ára; új akciós árnál, ha még nem volt, a rendes ár.
 */
export function priceDropWarning(
  kind: PriceFieldKind,
  value: number,
  reference: number,
  referenceKind: PriceFieldKind = kind,
): string {
  return `${PRICE_DROP_LEAD[kind]}${formatPriceHuf(value)}) kevesebb, mint az eddigi ${PRICE_NOUN[referenceKind]} (${formatPriceHuf(reference)}) fele. Ellenőrizd, hogy nem maradt-e le számjegy.`
}

/** A megerősítő jelölőnégyzet felirata: a pontos összeget mondja ki. */
export function priceDropConfirmLabel(kind: PriceFieldKind, value: number): string {
  return `Igen, az új ${PRICE_NOUN[kind]} valóban ${formatPriceHuf(value)}.`
}

/** A mentés hibaüzenete árcsökkenés miatti megerősítést kér-e (a mező ekkor a pipát is mutatja). */
export function isPriceDropMessage(message: unknown): message is string {
  return (
    typeof message === 'string' &&
    Object.values(PRICE_DROP_LEAD).some((lead) => message.startsWith(lead)) &&
    message.includes(' fele. Ha elírás')
  )
}

/**
 * A mentés árcsökkenés-üzenete PONTOSAN erről a mezőről és erről az összegről
 * szól-e. A Payload a szerver hibaüzenetét a javított érték mellett is az
 * űrlap-állapotban hagyja (@payloadcms/ui useField: a kliens-validátor csak a
 * saját előző eredményéhez méri magát), ezért a mező csak a most beírt
 * összegre szóló üzenetet veheti figyelembe. A teljes nyitó rész egyezik, nem
 * részszöveg: a „79 500 Ft” üzenetében a „500 Ft” is benne volna.
 */
export function isPriceDropMessageFor(
  kind: PriceFieldKind,
  value: number,
  message: unknown,
): message is string {
  return (
    isPriceDropMessage(message) &&
    message.startsWith(`${PRICE_DROP_LEAD[kind]}${formatPriceHuf(value)})`)
  )
}

/**
 * A kurzus ár-, ingyenesség- és akció-mezőit csak a tulajdonos írhatja
 * (T-011). Ha a piszkozatban a tulajdonos olyan értéke áll, amely
 * közzétételkor megerősítést kér (vagy javítani kell), a munkatárs
 * közzététele nem viheti élesbe: ő a megerősítést nem adhatja meg, és a
 * mezőt nem írhatja át. Az üzenet megmondja, mi a teendő (NN/g, Error-Message
 * Guidelines: „Offer constructive advice”,
 * https://www.nngroup.com/articles/error-message-guidelines/; GOV.UK Design
 * System, Error message: „tell someone what has happened and how to fix it”,
 * https://design-system.service.gov.uk/components/error-message/), és egy
 * sorban elfér, hogy a hibabuborék ne takarja a lap füleit.
 */
export const OWNER_ONLY_CHANGE_MESSAGE =
  'A mező piszkozatban álló értékét csak a tulajdonos teheti közzé. Szólj neki, hogy nézze át.'

/* „Fizetős kurzus” pipa */

/**
 * Mit jelent a pipa hiánya: a kód szerint (src/lib/courses.ts isFreeCourse:
 * `priceInHUFEnabled === false`) a kurzus INGYENES, és a nyilvános igénylő
 * űrlap név és e-mail-cím alapján bárkinek hozzáférést ad
 * (src/lib/free-course/request-access.ts). A hozzáférés „független” jogként
 * marad meg, a pipa visszatétele nem veszi el (src/lib/access-grants.ts).
 */
export const FREE_COURSE_EFFECT =
  'Pipa nélkül a kurzus ingyenes: bárki megkapja, aki megadja a nevét és az e-mail-címét, és a hozzáférése akkor is megmarad, ha a pipát később visszateszed.'

/**
 * Az eladás leállítása az „Archivált” megjelenés: a kurzus nem vásárolható,
 * a meglévő vásárló tovább nézi (src/lib/courses.ts; a stream-token az
 * archivált kurzusra is kiadható, src/lib/stream/issue-stream-token.ts). A
 * „Piszkozat” a vásárlótól is elvenné a videókat, ezért nem az.
 */
export const STOP_SALES_HINT =
  'Az eladás leállításához tedd vissza a pipát, és a „Megjelenés a weboldalon” mezőt állítsd „Archivált” értékre: így a kurzus nem vásárolható, a meglévő vásárlók pedig tovább nézik. A „Piszkozat” erre nem jó, mert a vásárlóktól is elveszi a videókat.'

export const FREE_COURSE_CONFIRM_LABEL = 'Igen, a kurzus legyen ingyenes.'

/**
 * A mentés hibaüzenete, ha egy fizetős kurzusból megerősítés nélkül lenne
 * ingyenes. Egy sor: a „Fizetős kurzus” a fül első mezője, és a Payload a
 * pipa hibabuborékát a pipa fölé, felfelé növeszti (custom.scss 8b). Az
 * 547 karakteres, ötsoros változat 1280 px-en a teljes fülsort eltakarta, és
 * elnyelte a fülekre adott kattintást (mérve, Chromium). A részletek (mit
 * jelent az ingyenesség, hogyan állítható le az eladás) a pipa alatti
 * Figyelem dobozban és a mező súgójában állnak. NN/g, Error-Message
 * Guidelines: „Be concise”, „Offer constructive advice”
 * (https://www.nngroup.com/articles/error-message-guidelines/); WCAG 2.2
 * SC 2.4.11 Focus Not Obscured (a buborék alá került fülek fókusza).
 */
export const FREE_COURSE_GUARD_MESSAGE =
  'Pipa nélkül a kurzus ingyenes lesz. Ha ezt szeretnéd, jelöld be a pipa alatti megerősítést.'

/** A pipa alatti figyelmeztetés mentés előtt. */
export const FREE_COURSE_WARNING = `${FREE_COURSE_EFFECT} ${STOP_SALES_HINT}`

export function isFreeCourseGuardMessage(message: unknown): boolean {
  return message === FREE_COURSE_GUARD_MESSAGE
}

/**
 * A lap tetején (CourseVisibilityNotice) álló tájékoztatás ingyenes kurzusnál:
 * a szerkesztő ne csak a pipa hiányából következtessen.
 */
export const FREE_COURSE_NOTICE_TITLE = 'Ez a kurzus ingyenes.'
export const FREE_COURSE_NOTICE_BODY =
  'Bárki megkapja, aki megadja a nevét és az e-mail-címét. Ha fizetőssé tennéd, az Ár és hozzáférés fülön pipáld be a „Fizetős kurzus” mezőt.'

/* Akció vége */

/** Új akciót csak záró nappal lehet közzétenni. */
export const PROMO_END_REQUIRED_MESSAGE =
  'Add meg az akció utolsó napját. Új akciót csak záró nappal lehet közzétenni.'

/** Az „Az akció állapota” doboz jegyzete vég nélküli akciónál. */
export const PROMO_END_MISSING_NOTE =
  'Az akciónak nincs megadott utolsó napja. Új akciót csak záró nappal lehet közzétenni; egy korábban vég nélkül közzétett akció addig marad így, amíg meg nem adod a végét.'
