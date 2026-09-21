import { CONSENT_GRANTED, readConsent } from '@/lib/analytics/consent'

import { VISSZAJELZES_HIBA, VISSZAJELZES_VEGPONT } from './visszajelzes-szoveg'

/**
 * VISSZAJELZÉS (WP65) — a beküldés TISZTA logikája.
 *
 * MIÉRT KÜLÖN MODUL, DOM NÉLKÜL. A vitest `node` környezetben fut (nincs
 * jsdom), tehát a beküldést nem DOM-eseményekkel, hanem függvényhívással
 * kell mérni. A hálózati hívó ezért INJEKTÁLHATÓ: a tesztből így sosem megy
 * ki valódi kérés (CLAUDE.md 15. üzemeltetési tanulság).
 */

/** A szervernek küldött csomag. A mezőneveket a végpont szerződése rögzíti. */
export interface VisszajelzesAdat {
  /** 1. kérdés, opcionális: mit csinált a látogató, amikor a hiba történt. */
  readonly mitCsinaltal: string
  /** 2. kérdés, kötelező: mi történt. */
  readonly miTortent: string
  /** A bejelentés helye: KIZÁRÓLAG az útvonal (`window.location.pathname`). */
  readonly oldal: string
  /** Csalétek-mező (honeypot). Valódi látogatónál mindig üres. */
  readonly weboldal: string
  /** PostHog distinct id, ha a látogató hozzájárult az analitikához; egyébként null. */
  readonly analitikaAzonosito: string | null
}

/** A végpont válasza. */
export type VisszajelzesValasz =
  { readonly ok: true } | { readonly ok: false; readonly uzenet: string }

/**
 * A hálózati válasz MINIMÁLIS alakja, amire a beküldésnek szüksége van.
 *
 * Szándékosan nem a DOM `Response` típusa: így a teszt egy egyszerű objektumot
 * adhat vissza, és a modul `any` nélkül marad (CLAUDE.md, kódolási konvenciók).
 */
export interface VisszajelzesHttpValasz {
  readonly ok: boolean
  json: () => Promise<unknown>
}

/** Az injektálható hálózati hívó. */
export type VisszajelzesKuldo = (
  utvonal: string,
  opciok: { method: string; headers: Record<string, string>; body: string },
) => Promise<VisszajelzesHttpValasz>

/** Az éles hívó: a böngésző `fetch`-e, a végpont szerződése szerinti fejlécekkel. */
const ELES_KULDO: VisszajelzesKuldo = (utvonal, opciok) => fetch(utvonal, opciok)

/** A szerver válaszának típusszűkítése (`any` nélkül). */
function valaszbolUzenet(nyers: unknown): string {
  if (typeof nyers !== 'object' || nyers === null) {
    return VISSZAJELZES_HIBA
  }
  const uzenet = (nyers as { uzenet?: unknown }).uzenet
  return typeof uzenet === 'string' && uzenet.trim().length > 0 ? uzenet : VISSZAJELZES_HIBA
}

/**
 * A bejelentés elküldése.
 *
 * CSALÉTEK-MEZŐ. Ha a rejtett `weboldal` mező ki van töltve, a küldés
 * hálózati hívás NÉLKÜL „sikerül": a bot visszajelzést kap, a szerver
 * viszont nem kap terhelést. Ugyanez a minta él a kapcsolat-űrlapon
 * (`ContactForm.tsx`). A mező a csomagban is ott van, tehát a szerver a
 * közvetlenül (böngésző nélkül) posztolt kéréseket is kiszűrheti.
 *
 * HIBAKEZELÉS. A hálózati kivétel NEM buborékolhat fel: az űrlap a hibát
 * magyar mondatban mutatja meg, nem a látogató elé dobott kivétellel
 * (GOV.UK error messages; NN/g „Take a positive tone and don't blame the
 * user", https://www.nngroup.com/articles/error-message-guidelines/).
 */
export async function kuldVisszajelzest(
  adat: VisszajelzesAdat,
  kuldo: VisszajelzesKuldo = ELES_KULDO,
): Promise<VisszajelzesValasz> {
  if (adat.weboldal.length > 0) {
    return { ok: true }
  }

  try {
    const valasz = await kuldo(VISSZAJELZES_VEGPONT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(adat),
    })
    const torzs = await valasz.json().catch(() => null)
    if (
      valasz.ok &&
      typeof torzs === 'object' &&
      torzs !== null &&
      (torzs as { ok?: unknown }).ok === true
    ) {
      return { ok: true }
    }
    return { ok: false, uzenet: valaszbolUzenet(torzs) }
  } catch {
    return { ok: false, uzenet: VISSZAJELZES_HIBA }
  }
}

/** A kötelező mező validálása. Üres vagy csak whitespace: hiba. */
export function hianyzikAMiTortent(ertek: string): boolean {
  return ertek.trim().length === 0
}

/**
 * A látogató PostHog-azonosítója, KIZÁRÓLAG analitikai hozzájárulás mellett.
 *
 * MIÉRT LUSTA IMPORT. A `posthog-js` csomag csak akkor kerül a letöltött
 * kódba, ha a látogató hozzájárult: hozzájárulás nélkül nem indul el az
 * analitika, tehát nincs is distinct id (`src/lib/analytics/posthog.ts`
 * consent-first elve). A hozzájárulás állapotát a DOM-független
 * consent-állapotgépből olvassuk, hogy ez a modul SSR alatt is betölthető
 * maradjon.
 *
 * MIÉRT NEM SZEMÉLYES ADAT. A distinct id technikai azonosító: a PostHog a
 * `person_profiles: 'identified_only'` beállítás mellett anonim látogatóról
 * profilt sem készít. E-mail, név és IP továbbra sem kerül a bejelentés
 * mellé (`src/lib/analytics/posthog.ts`: „SZEMÉLYES ADAT NEM MEHET az
 * esemény-tulajdonságokba").
 */
export async function olvassAnalitikaAzonositot(): Promise<string | null> {
  if (typeof window === 'undefined' || readConsent() !== CONSENT_GRANTED) {
    return null
  }
  try {
    const modul = await import('posthog-js')
    const azonosito = modul.default.get_distinct_id()
    return typeof azonosito === 'string' && azonosito.length > 0 ? azonosito : null
  } catch {
    // A mérés hibája nem ronthatja el a bejelentést: azonosító nélkül megy el.
    return null
  }
}
