/**
 * Checkout — a számlázási adatok szerződése és validációja (KÖZÖS modul).
 *
 * A modul SZÁNDÉKOSAN függőségmentes (nincs benne payload-, next- vagy
 * react-import), mert két, egymástól független helyen fut le:
 *  - a /penztar űrlapján (kliens-bundle) — hogy a beküldés hiányos adattal el
 *    se induljon, magyar, mezőhöz kötött hibaüzenettel;
 *  - a POST /api/checkout/start szolgáltatásában — mert a kliens MEGKERÜLHETŐ,
 *    így a szabály a szerveren KÖTELEZŐEN újra lefut.
 *
 * MIÉRT KÖTELEZŐ: a számla (Számlázz.hu, `vevo` blokk) a rendelés
 * `customerSnapshot`-jából készül (src/lib/szamlazz/invoice.ts →
 * `buyerFromOrder`), és ott a `nev`/`irsz`/`telepules`/`cim` a Számla Agent
 * felé is kötelező mező. Ha ezek a snapshotból hiányoznak, a fizetés lemegy, a
 * kurzus kiadódik, a számlakiállítás viszont `invoiceStatus: 'failed'`-del,
 * DOBÁS NÉLKÜL zár — tehát nincs újrapróbálás, és a számla soha nem áll ki.
 * Ezt az utat itt, a rendelés létrejötte ELŐTT kell elzárni.
 *
 * A SZERZŐDÉS: a bemenet minden mezője STRING. Számként küldött irányítószám
 * vagy adószám (`{ zip: 1011 }`) érvénytelen — a vezető nullát a JSON
 * szám-típusa elnyelné (`0111` → `111`), ezért a konverziót szándékosan nem
 * végezzük el helyette.
 *
 * A szigorúság mezőnként MÁS, és mindegyik választás mögött ugyanaz a mérce
 * áll: mit utasítana vissza a Számla Agent (= néma, kiállítatlan számla),
 * illetve mi zárna ki valós vevőt (= elveszett vásárlás).
 *
 *  - **név / település / cím**: nem üres, ésszerű alsó és felső hosszkorlát;
 *    formai megkötés (házszám-kényszer, ékezet- vagy karakter-szűrés) NINCS.
 *  - **irányítószám**: magyar alak esetén szigorú (négy számjegy, 1000–9999),
 *    egyébként SZABAD formátum — lásd a `normalizeZip` fejlécét és a benne
 *    rögzített, TULAJDONOSI DÖNTÉST igénylő megjegyzést.
 *  - **adószám**: OPCIONÁLIS, de ha megadják, SZERKEZETILEG is ellenőrizzük
 *    (CDV + áfakód + megyekód) — lásd a `normalizeTaxNumber` fejlécét.
 */

/** A pénztárból érkező, nyers számlázási adatok (a hálózati törzs alakja). */
export interface CheckoutBillingInput {
  name: string
  zip: string
  city: string
  street: string
  taxNumber?: string
}

/** A validált, normalizált számlázási adatok — ez kerül a rendelés snapshotjába. */
export interface NormalizedBilling {
  name: string
  zip: string
  city: string
  street: string
  /** Hiányzó vagy üres adószám esetén null (magánszemély vásárló). */
  taxNumber: string | null
}

export type BillingFieldName = 'name' | 'zip' | 'city' | 'street' | 'taxNumber'

/**
 * A hiba OSZTÁLYA — ebből származtatjuk a felhasználónak szóló összefoglalót.
 * A korábbi egyetlen, mindenre azonos „a számlázási adatok hiányosak" szöveg
 * félrevezetett: a túl HOSSZÚ érték nem hiányzik, a hibás ADÓSZÁM mezője pedig
 * nem is kötelező.
 */
export type BillingErrorKind = 'missing' | 'tooLong' | 'invalid'

/** Egy mezőhöz kötött, MAGYAR hibaüzenet (a Field `error` propjára illeszkedik). */
export interface BillingFieldError {
  field: BillingFieldName
  kind: BillingErrorKind
  message: string
}

export type BillingValidationResult =
  { ok: true; value: NormalizedBilling } | { ok: false; errors: BillingFieldError[] }

/** A szabad szöveges mezők hosszkorlátai (alsó = elgépelés-szűrő, felső = épesz-határ). */
export const BILLING_LIMITS = {
  name: { min: 2, max: 200 },
  city: { min: 2, max: 100 },
  street: { min: 3, max: 200 },
  zip: { min: 3, max: 12 },
} as const

/** A mezők megjelenítési (és hiba-)sorrendje — a pénztár űrlapjával egyezik. */
export const BILLING_FIELD_ORDER: readonly BillingFieldName[] = [
  'name',
  'zip',
  'city',
  'street',
  'taxNumber',
]

interface TextRule {
  /** A mezőnév — egyben a nyers input kulcsa is. */
  field: Extract<BillingFieldName, 'name' | 'city' | 'street'>
  min: number
  max: number
  /** Hiányzó vagy túl rövid érték üzenete. */
  missing: string
  /** Túl hosszú érték üzenete. */
  tooLong: string
}

const TEXT_RULES: readonly TextRule[] = [
  {
    field: 'name',
    min: BILLING_LIMITS.name.min,
    max: BILLING_LIMITS.name.max,
    missing: 'Add meg a számlázási nevet (legalább 2 karakter).',
    tooLong: `A számlázási név legfeljebb ${BILLING_LIMITS.name.max} karakter lehet.`,
  },
  {
    field: 'city',
    min: BILLING_LIMITS.city.min,
    max: BILLING_LIMITS.city.max,
    missing: 'Add meg a települést.',
    tooLong: `A település neve legfeljebb ${BILLING_LIMITS.city.max} karakter lehet.`,
  },
  {
    field: 'street',
    min: BILLING_LIMITS.street.min,
    max: BILLING_LIMITS.street.max,
    missing: 'Add meg az utcát és a házszámot.',
    tooLong: `A cím legfeljebb ${BILLING_LIMITS.street.max} karakter lehet.`,
  },
]

export const BILLING_ZIP_ERROR =
  'Adj meg érvényes irányítószámot (magyar cím esetén négyjegyű szám, például 1011).'
export const BILLING_TAX_NUMBER_ERROR =
  'Az adószám 11 számjegyből áll (például 12345676-1-42). Magánszemélyként hagyd üresen.'
export const BILLING_TAX_NUMBER_STRUCTURE_ERROR =
  'Ez az adószám elírásnak tűnik: ellenőrizd a számjegyeket. Magánszemélyként hagyd üresen.'
export const BILLING_TAX_NUMBER_EU_ERROR =
  'A közösségi adószám (HU + 8 számjegy) helyett a teljes, 11 jegyű magyar adószámot add meg (például 12345676-1-42).'

/** Összefoglaló üzenetek — a `billingSummaryMessage` a hibahalmazból választ. */
export const BILLING_SUMMARY_MISSING =
  'A számlázási adatok hiányosak. A számlához töltsd ki az összes csillagozott mezőt.'
export const BILLING_SUMMARY_TOO_LONG =
  'A megadott számlázási adat túl hosszú. Rövidítsd a pirossal jelölt mezőt.'
export const BILLING_SUMMARY_MIXED = 'Ellenőrizd a pirossal jelölt számlázási mezőket.'

/**
 * Magyar irányítószám: 1000–9999 (négy számjegy, nem nullás kezdéssel),
 * opcionális `H` / `H-` országelőtaggal.
 */
const HUNGARIAN_ZIP_PATTERN = /^(?:[Hh]-?)?([1-9]\d{3})$/
/** Nemzetközi irányítószám: betű/számjegy/szóköz/kötőjel, legalább egy számjeggyel. */
const FOREIGN_ZIP_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 -]*[A-Za-z0-9]$/
/** Az adószám nyers alakja a szóközök, kötőjelek és a `HU` előtag elhagyása után. */
const TAX_NUMBER_DIGITS_PATTERN = /^\d{11}$/
/** A CDV-súlyok az adószám törzsszámának első HÉT jegyére (a 8. a képzett ellenőrző jegy). */
const TAX_NUMBER_CDV_WEIGHTS = [9, 7, 3, 1, 9, 7, 3] as const
/** Érvényes megyekódok: 02–44, valamint az 51 (Kiemelt Adózók igazgatósága). */
const TAX_NUMBER_COUNTY_CODES: ReadonlySet<string> = new Set([
  ...Array.from({ length: 43 }, (_unused, index) => String(index + 2).padStart(2, '0')),
  '51',
])

/**
 * Szöveg-normalizálás.
 *
 * A `\p{Cf}` (formátum-) karakterek NYOMTALANUL kiesnek: a zero-width space
 * (U+200B), a ZWNJ/ZWJ és a BOM ugyanis nem látszik, de a `trim()` nem vágja
 * le — így egy csupa-zero-width „név" korábban átment a kötelezőségi szűrőn,
 * és a számlára üres `nev` került volna. A `\p{Cc}` (vezérlő-) karakterek
 * ezzel szemben SZÓKÖZZÉ alakulnak, hogy a sortöréssel elválasztott szavak ne
 * tapadjanak össze. Végül: a whitespace-sorozatok egy szóközre, majd trim.
 *
 * EXPORTÁLT, mert a vendég-vásárlás azonosító mezői (`./guest.ts`) ugyanezt a
 * normalizálást igénylik — a szabály MÁSOLÁSA két helyre azt kockáztatná, hogy
 * a két oldal észrevétlenül szétcsúszik (a láthatatlan karakteres „név"
 * pontosan így jutott át korábban a szűrőn).
 */
export function normalizeText(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }
  return value
    .replace(/\p{Cf}/gu, '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

/** Az adószám 8 jegyű törzsszámának CDV-ellenőrzése (súlyok: 9,7,3,1,9,7,3). */
export function isValidTaxNumberCoreChecksum(core: string): boolean {
  if (!/^\d{8}$/.test(core)) {
    return false
  }
  let sum = 0
  for (let index = 0; index < TAX_NUMBER_CDV_WEIGHTS.length; index += 1) {
    sum += Number(core[index]) * TAX_NUMBER_CDV_WEIGHTS[index]
  }
  return (10 - (sum % 10)) % 10 === Number(core[7])
}

type TaxNumberFailure = 'format' | 'structure' | 'eu-only'

/** Üres mező → `{ ok: true, value: null }`; hibás → a hiba osztálya. */
type TaxNumberResult = { ok: true; value: string | null } | { ok: false; failure: TaxNumberFailure }

/**
 * Adószám-normalizálás és SZERKEZETI ellenőrzés.
 *
 * MIÉRT NEM ELÉG A HOSSZ: a korábbi „11 számjegy" szabály a két rossz véglet
 * metszete volt — a `00000000-0-00` és a `12345678-9-99` átment rajta, pedig a
 * Számla Agent ezeket visszautasítaná, vagyis pontosan a néma, kiállítatlan
 * számla esete maradt nyitva. Ezért a teljes magyar szerkezetet ellenőrizzük:
 *
 *  1. törzsszám (1–8. jegy): a 8. jegy CDV-ellenőrző jegy a 9,7,3,1,9,7,3
 *     súlyokkal képezve;
 *  2. áfakód (9. jegy): 1–5;
 *  3. megyekód (10–11. jegy): 02–44 vagy 51.
 *
 * A `HU` előtagot (közösségi adószám) LEVÁGJUK, ha teljes, 11 jegyű adószám
 * követi (`HU12345678142`) — a számla `<adoszam>` mezője a magyar alakot várja,
 * a `<adoszamEU>` mezőt a rendszer jelenleg nem tölti. A CSAK 8 jegyű
 * közösségi alak (`HU12345678`) viszont nem elég: abból az áfakód és a
 * megyekód nem képezhető, ezért saját, eligazító üzenettel utasítjuk el.
 *
 * Üres bemenet → null (magánszemély); hibás bemenet → a hiba OSZTÁLYA.
 */
function normalizeTaxNumber(value: unknown): TaxNumberResult {
  const raw = typeof value === 'string' ? normalizeText(value) : ''
  if (raw.length === 0) {
    return { ok: true, value: null }
  }
  const compact = raw.replace(/[\s-]/gu, '')
  const withoutEuPrefix = compact.replace(/^[Hh][Uu]/u, '')
  if (withoutEuPrefix.length !== compact.length && /^\d{8}$/.test(withoutEuPrefix)) {
    return { ok: false, failure: 'eu-only' }
  }
  if (!TAX_NUMBER_DIGITS_PATTERN.test(withoutEuPrefix)) {
    return { ok: false, failure: 'format' }
  }

  const core = withoutEuPrefix.slice(0, 8)
  const vatCode = withoutEuPrefix.slice(8, 9)
  const countyCode = withoutEuPrefix.slice(9)
  if (
    !isValidTaxNumberCoreChecksum(core) ||
    !/^[1-5]$/.test(vatCode) ||
    !TAX_NUMBER_COUNTY_CODES.has(countyCode)
  ) {
    return { ok: false, failure: 'structure' }
  }
  return { ok: true, value: `${core}-${vatCode}-${countyCode}` }
}

const TAX_NUMBER_FAILURE_MESSAGE: Record<TaxNumberFailure, string> = {
  format: BILLING_TAX_NUMBER_ERROR,
  structure: BILLING_TAX_NUMBER_STRUCTURE_ERROR,
  'eu-only': BILLING_TAX_NUMBER_EU_ERROR,
}

/**
 * Irányítószám-normalizálás.
 *
 * ⚠️ **TULAJDONOSI DÖNTÉST IGÉNYEL — a külföldi cím kezelése.** A szabály
 * korábban KIZÁRÓLAG magyar irányítószámot fogadott el, vagyis a berlini
 * (`10115`) és a malackai (`900 01`) vevő innentől egyáltalán nem tudott volna
 * fizetni — pedig egy magyar nyelvű platformon a határon túli magyar vevő
 * reális, és eddig tudott. Ezért az itteni szabály ORSZÁGMEZŐ NÉLKÜL enged
 * szabadabb alakot:
 *
 *  - magyar alak (opcionális `H-` előtag + négy számjegy, 1000–9999) →
 *    normalizálva, csak a négy számjegy kerül a számlára;
 *  - minden más → 3–12 karakter a [betű, számjegy, szóköz, kötőjel]
 *    készletből, legalább egy számjeggyel, ÉS ÚGY, AHOGY BEÍRTÁK (a belső
 *    szóköz megmarad: a `900 01` alak Szlovákiában így helyes). Korábban a
 *    normalizálás a belső szóközt is elnyelte, tehát TALÁLGATOTT — a `10 11`
 *    csendben `1011` lett; ez megszűnt.
 *
 * Egyetlen szigorúság maradt a magyar elgépelés miatt: a PONTOSAN négy
 * számjegyből álló érték nem kezdődhet nullával (`0111` → hiba). Ez elvben
 * kizárja a néhány dán, nullával kezdődő céges irányítószámot — tudatos csere,
 * mert a magyar elgépelés nagyságrendekkel gyakoribb.
 *
 * ⚠️ **AMI EMBERI DÖNTÉS NÉLKÜL NEM OLDHATÓ MEG:** a számla-XML `<vevo>`
 * blokkja ma NEM tartalmaz `<orszag>` taget (src/lib/szamlazz/invoice.ts), így
 * a külföldi címről leadott rendelés számlájára ország nem kerül. Az `<orszag>`
 * felvétele + a pénztár országmezője ÖNÁLLÓ, tulajdonosi döntést igénylő
 * ticket; addig a fenti enyhítés a kisebbik kockázat (vásárlás nem vész el,
 * a számla ország nélkül, de kiállítható marad).
 */
function normalizeZip(value: unknown): string | null {
  const normalized = normalizeText(value)
  if (normalized.length < BILLING_LIMITS.zip.min || normalized.length > BILLING_LIMITS.zip.max) {
    return null
  }

  const hungarian = HUNGARIAN_ZIP_PATTERN.exec(normalized)
  if (hungarian) {
    return hungarian[1]
  }
  if (!FOREIGN_ZIP_PATTERN.test(normalized) || !/\d/u.test(normalized)) {
    return null
  }
  // A magyar elgépelés-szűrő: négy számjegy csak 1000–9999 lehet.
  if (/^\d{4}$/.test(normalized)) {
    return null
  }
  return normalized
}

/**
 * A számlázási adatok ellenőrzése és normalizálása. A bemenet szándékosan
 * `unknown`: a szerver oldalon tetszőleges JSON-törzs érkezhet.
 */
export function validateBilling(input: unknown): BillingValidationResult {
  const source: Record<string, unknown> =
    typeof input === 'object' && input !== null && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {}

  const errors: BillingFieldError[] = []
  const text: Record<'name' | 'city' | 'street', string> = { name: '', city: '', street: '' }

  for (const rule of TEXT_RULES) {
    const value = normalizeText(source[rule.field])
    if (value.length < rule.min) {
      errors.push({ field: rule.field, kind: 'missing', message: rule.missing })
      continue
    }
    if (value.length > rule.max) {
      errors.push({ field: rule.field, kind: 'tooLong', message: rule.tooLong })
      continue
    }
    text[rule.field] = value
  }

  const zip = normalizeZip(source.zip)
  if (zip === null) {
    errors.push({
      field: 'zip',
      kind: normalizeText(source.zip).length === 0 ? 'missing' : 'invalid',
      message: BILLING_ZIP_ERROR,
    })
  }

  const taxNumber = normalizeTaxNumber(source.taxNumber)
  if (!taxNumber.ok) {
    errors.push({
      field: 'taxNumber',
      kind: 'invalid',
      message: TAX_NUMBER_FAILURE_MESSAGE[taxNumber.failure],
    })
  }

  // A három disjunkt HÁROM KÜLÖN mezőcsoport kapuja (irányítószám, adószám,
  // szöveges mezők) — egyik sem redundáns, és a sikeres ágon így nem marad
  // olyan „nem fordulhat elő" tartalék, ami hiba esetén csendben rossz értéket
  // (üres irányítószámot) engedne a számlára.
  if (zip === null || !taxNumber.ok || errors.length > 0) {
    // A hibák a megjelenítési sorrendben menjenek vissza — a hívó az ELSŐ
    // hibás mezőre viszi a fókuszt.
    errors.sort(
      (left, right) =>
        BILLING_FIELD_ORDER.indexOf(left.field) - BILLING_FIELD_ORDER.indexOf(right.field),
    )
    return { ok: false, errors }
  }

  return {
    ok: true,
    value: {
      name: text.name,
      zip,
      city: text.city,
      street: text.street,
      taxNumber: taxNumber.value,
    },
  }
}

/**
 * A felhasználónak szóló ÖSSZEFOGLALÓ a tényleges hibahalmazból származtatva.
 *
 * Korábban minden számlázási hibára ugyanaz a „hiányosak" szöveg ment ki, ami
 * hibás ADÓSZÁM esetén tényszerűen hamis volt (a mező nem is kötelező, és ki
 * volt töltve), túl HOSSZÚ érték esetén pedig épp az ellenkezőjét állította.
 */
export function billingSummaryMessage(errors: readonly BillingFieldError[]): string {
  if (errors.length === 0) {
    return ''
  }
  if (errors.every((item) => item.field === 'taxNumber')) {
    return errors[0].message
  }
  if (errors.every((item) => item.kind === 'missing')) {
    return BILLING_SUMMARY_MISSING
  }
  if (errors.every((item) => item.kind === 'tooLong')) {
    return BILLING_SUMMARY_TOO_LONG
  }
  return BILLING_SUMMARY_MIXED
}

/**
 * A normalizált adatok visszaképzése a hálózati törzs alakjára: az üres
 * (null) adószám KIMARAD, hogy a szerver felé se menjen ki üres mező.
 */
export function toBillingPayload(value: NormalizedBilling): CheckoutBillingInput {
  return {
    name: value.name,
    zip: value.zip,
    city: value.city,
    street: value.street,
    ...(value.taxNumber ? { taxNumber: value.taxNumber } : {}),
  }
}

/** A mezőhöz kötött hibák leképezése mezőnév → üzenet térképre (a Field-ekhez). */
export function billingErrorMap(
  errors: readonly BillingFieldError[],
): Partial<Record<BillingFieldName, string>> {
  const map: Partial<Record<BillingFieldName, string>> = {}
  for (const item of errors) {
    if (map[item.field] === undefined) {
      map[item.field] = item.message
    }
  }
  return map
}
