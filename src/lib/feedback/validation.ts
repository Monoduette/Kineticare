/**
 * Visszajelzés-doboz (WP65) — VALIDÁCIÓ.
 *
 * A modul szándékosan tiszta: nincs benne DOM, Payload, környezet és hálózat,
 * ezért a szabályok egységtesztből mérhetők (a `free-course/validation.ts`
 * mintájára). A végpont NYILVÁNOS, tehát a nyers törzs `unknown`: közvetlen
 * HTTP-hívással bármi érkezhet, és a felület hiánya sosem nyithat rést.
 *
 * Mezők (a felülettel közös szerződés):
 *  - `miTortent` — KÖTELEZŐ, trimmelve 5..2000 karakter. Ez maga a bejelentés.
 *  - `mitCsinaltal` — OPCIONÁLIS, legfeljebb 2000 karakter. A reprodukáláshoz
 *    kell (mit tett a látogató a hiba előtt), de enélkül is elfogadjuk: egy
 *    hiányzó mező nem érhet annyit, hogy a bejelentés elvesszen.
 *  - `oldal` — az az útvonal, ahol a látogató állt.
 *  - `weboldal` — CSAPDA (honeypot), emberi látogató sosem tölti ki.
 *  - `analitikaAzonosito` — a látogató PostHog distinct_id-ja, KIZÁRÓLAG
 *    analitika-hozzájárulás mellett érkezik.
 *
 * SZEMÉLYES ADAT: az űrlapon szándékosan NINCS név- és e-mail-mező, a
 * párbeszédablak pedig figyelmeztet, hogy személyes és egészségügyi adatot ne
 * írjanak bele. A modul ezért nem is ismer ilyen mezőt: amit nem veszünk át,
 * azt nem is szivárogtathatjuk ki.
 */

import { sanitizeAnalyticsUrl } from '../analytics/page-url'

/** A bejelentés alsó hossza. Ennél rövidebb szövegből nem derül ki a hiba. */
export const MI_TORTENT_MIN_HOSSZ = 5

/** A bejelentés felső hossza. Bőven elég egy részletes leíráshoz. */
export const MI_TORTENT_MAX_HOSSZ = 2000

/** A „mit csináltál" mező felső hossza — ugyanaz a nagyságrend. */
export const MIT_CSINALTAL_MAX_HOSSZ = 2000

/**
 * Az útvonal felső hossza a keret-kulcs-plafonok logikájával: a mezőt a kliens
 * adja, korlát nélkül egy több kilobájtos érték menne ki az analitikába.
 */
export const OLDAL_MAX_HOSSZ = 512

/**
 * A PostHog distinct_id felső hossza a hivatalos capture-dokumentáció szerint
 * (`distinct_id`: „max 200 characters", https://posthog.com/docs/api/capture).
 * Ennél hosszabb értéket nem adunk tovább: inkább anonim azonosítót kap.
 */
export const ANALITIKA_AZONOSITO_MAX_HOSSZ = 200

/**
 * Az az érték, ami akkor megy ki, ha az `oldal` nem használható útvonal.
 * SZÁNDÉKOSAN nem útvonal-alakú: a riportban azonnal látszik, hogy itt nem
 * egy `/ismeretlen` nevű oldalról van szó, hanem hiányzó adatról.
 */
export const ISMERETLEN_OLDAL = 'ismeretlen'

// ---------------------------------------------------------------------------
// Magyar üzenetek
// ---------------------------------------------------------------------------

/**
 * A hibaüzenetek a `docs/ui-sztenderdek.md` §2.7 szabályát követik: mondják
 * meg, MI a baj és MIT tegyen a látogató, tegezve. A G-UI7 őr tiltott szavai
 * (`src/__tests__/g-ui7-tiltott-hibaszavak.test.ts`) egyikben sem szerepelnek.
 */
export const MI_TORTENT_HIANYZIK_HIBA = 'Írd le, mi történt. Enélkül nem tudunk utánanézni.'

export const MI_TORTENT_ROVID_HIBA =
  'A leírás túl rövid. Írj legalább 5 karaktert arról, mi történt.'

export const MI_TORTENT_HOSSZU_HIBA =
  'A leírás túl hosszú. Írd le legfeljebb 2000 karakterben, mi történt.'

export const MIT_CSINALTAL_HOSSZU_HIBA =
  'A „Mit csináltál?" mező túl hosszú. Írj bele legfeljebb 2000 karaktert.'

// ---------------------------------------------------------------------------
// Normalizált alak
// ---------------------------------------------------------------------------

/** A beküldés normalizált, szerveroldali alakja (a handler ezt kapja). */
export interface VisszajelzesBody {
  /** A bejelentés szövege, trimmelve. */
  readonly miTortent: string
  /** Mit csinált a látogató a hiba előtt; üres mező esetén `null`. */
  readonly mitCsinaltal: string | null
  /** Az útvonal, ahol a látogató állt, vagy `ISMERETLEN_OLDAL`. */
  readonly oldal: string
  /** A látogató PostHog-azonosítója, hozzájárulás nélkül `null`. */
  readonly analitikaAzonosito: string | null
}

/**
 * A validáció három kimenete. A `csapda` SZÁNDÉKOSAN nem hiba: a hívó
 * látszólagos sikerrel felel rá (lásd a handlert), hogy a bot ne tudja meg,
 * hogy lebukott.
 */
export type VisszajelzesValidacio =
  | { readonly allapot: 'rendben'; readonly body: VisszajelzesBody }
  | { readonly allapot: 'csapda' }
  | { readonly allapot: 'hibas'; readonly uzenet: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Nem-string értékből üres szöveg lesz; minden bemenet trimmelve megy tovább. */
function olvasSzoveg(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Az útvonal ellenőrzése és tisztítása.
 *
 * KÖTÖTT ALAK: `/` karakterrel kezdődik, de nem `//` — a séma nélküli abszolút
 * URL (`//idegen.hu/valami`) ugyanis a böngészőben MÁS eredetre mutat, tehát
 * ezen az úton idegen hostot lehetne a saját riportunkba csempészni. Ami nem
 * felel meg, azt nem utasítjuk el, hanem ELDOBJUK: a bejelentés a fontos, egy
 * rossz útvonal miatt nem veszhet el.
 *
 * A megmaradó útvonal a `sanitizeAnalyticsUrl`-en megy át (M9): a
 * jelszó-visszaállító jegy és minden jövőbeli érzékeny query-paraméter
 * kivágódik, az utm_* kampány-paraméterek megmaradnak. Ez azért kötelező,
 * mert a doboz bármelyik oldalról nyitható, tehát a `token`-es útvonalról is.
 */
export function normalizaltOldal(value: unknown): string {
  const nyers = olvasSzoveg(value)
  if (nyers.length === 0 || nyers.length > OLDAL_MAX_HOSSZ) {
    return ISMERETLEN_OLDAL
  }
  if (!nyers.startsWith('/') || nyers.startsWith('//')) {
    return ISMERETLEN_OLDAL
  }
  const tisztitott = sanitizeAnalyticsUrl(nyers)
  return tisztitott.length > 0 ? tisztitott : ISMERETLEN_OLDAL
}

/**
 * Az analitika-azonosító átvétele. Hozzájárulás nélkül a felület nem küld
 * semmit, tehát a hiány a NORMÁLIS eset — ilyenkor `null` megy tovább, és a
 * handler anonim azonosítót gyárt. A hosszplafon a PostHog szerződése.
 */
export function normalizaltAnalitikaAzonosito(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const azonosito = value.trim()
  if (azonosito.length === 0 || azonosito.length > ANALITIKA_AZONOSITO_MAX_HOSSZ) {
    return null
  }
  return azonosito
}

/**
 * A nyers kérés-törzs (`unknown`) → normalizált beküldés VAGY magyar hibaüzenet
 * VAGY csapda-jelzés.
 *
 * A hosszakat a TRIMMELT szövegen mérjük: a körbe-szóközölt beküldés ugyanazt
 * a szabályt kapja, mint a tiszta. Az első hibánál megállunk, mert a felület
 * egyetlen üzenetet mutat (az űrlap két mezős, nincs mit összegezni).
 */
export function parseVisszajelzesBody(raw: unknown): VisszajelzesValidacio {
  const record = isRecord(raw) ? raw : {}

  // CSAPDA legelöl: ha kitöltött, semmilyen további munkát nem végzünk.
  if (olvasSzoveg(record.weboldal).length > 0) {
    return { allapot: 'csapda' }
  }

  const miTortent = olvasSzoveg(record.miTortent)
  if (miTortent.length === 0) {
    return { allapot: 'hibas', uzenet: MI_TORTENT_HIANYZIK_HIBA }
  }
  if (miTortent.length < MI_TORTENT_MIN_HOSSZ) {
    return { allapot: 'hibas', uzenet: MI_TORTENT_ROVID_HIBA }
  }
  if (miTortent.length > MI_TORTENT_MAX_HOSSZ) {
    return { allapot: 'hibas', uzenet: MI_TORTENT_HOSSZU_HIBA }
  }

  const mitCsinaltal = olvasSzoveg(record.mitCsinaltal)
  if (mitCsinaltal.length > MIT_CSINALTAL_MAX_HOSSZ) {
    return { allapot: 'hibas', uzenet: MIT_CSINALTAL_HOSSZU_HIBA }
  }

  return {
    allapot: 'rendben',
    body: {
      miTortent,
      mitCsinaltal: mitCsinaltal.length > 0 ? mitCsinaltal : null,
      oldal: normalizaltOldal(record.oldal),
      analitikaAzonosito: normalizaltAnalitikaAzonosito(record.analitikaAzonosito),
    },
  }
}
