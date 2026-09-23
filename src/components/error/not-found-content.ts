/**
 * A „nem található" oldal SZÖVEGE és CÉLLISTÁJA — egyetlen igazságforrás.
 */

/** A lap egyetlen h1-e. A GOV.UK mintacíme magyarul. */
export const NOT_FOUND_TITLE = 'Ez az oldal nem található'

/** Bocsánatkérő, nem hibáztató nyitómondat (NN/g). */
export const NOT_FOUND_LEAD =
  'Elnézést kérünk. A megnyitott cím nálunk nem létezik, vagy időközben másik helyre került.'

/**
 * A GOV.UK-minta három ellenőrző mondata magyarul. Sorrend és tartalom a
 * mintáé; a harmadik pont vezeti át a látogatót a kapcsolatfelvételre.
 */
export const NOT_FOUND_CHECKS = [
  'Ha kézzel írtad be a címet, nézd meg, nem maradt-e benne elgépelés.',
  'Ha bemásoltad, ellenőrizd, hogy a teljes cím bekerült-e.',
  'Ha jó a cím, vagy egy linkről jutottál ide, írj nekünk, és megkeressük a tartalmat.',
] as const

/**
 * A KÉT gombos cselekvés: egy elsődleges, egy másodlagos.
 *
 * A feliratok a `docs/gomb-inventar.md` CTA-szótárából valók, hogy ugyanaz a
 * cselekvés mindenhol ugyanúgy hívódjon (WCAG 2.2 · 3.2.4). Az elsődleges a
 * kurzuslista: az értékesítési cél-hierarchia teteje
 * (`docs/ertekesitesi-ux-skill.md`), és a hibaoldalról ez a leghasznosabb
 * továbblépés.
 */
export const NOT_FOUND_PRIMARY_ACTION = { href: '/kurzusok', label: 'Nézd meg a kurzusokat' }
export const NOT_FOUND_SECONDARY_ACTION = { href: '/', label: 'Vissza a kezdőlapra' }

/** A további célokat bevezető sor. */
export const NOT_FOUND_DESTINATIONS_LABEL = 'Vagy folytasd innen'

/**
 * A TOVÁBBI célok. Szándékosan NEM ismétlik a két gombot: az NN/g szerint a
 * hibaoldal legyen konstruktív és áttekinthető, az ugyanarra a célra mutató
 * kettőzött hivatkozás viszont csak zajt ad
 * (https://www.nngroup.com/articles/improving-dreaded-404-error-message/).
 *
 * Mind KÓD-ÚTVONAL (`src/app/(frontend)/…`), nem CMS-oldal: így a lista akkor
 * sem mutathat 404-re, ha a szerkesztő átnevez vagy visszavon egy CMS-oldalt.
 * A `/szolgaltatasok` és a `/rolunk` épp ezért marad ki: azok a `[slug]`
 * CMS-route-on élnek.
 */
export const NOT_FOUND_DESTINATIONS = [
  {
    href: '/blog',
    label: 'Tudástár',
    hint: 'Cikkek a kéz gyógyulásáról és a mindennapi használatról.',
  },
  {
    href: '/kapcsolat',
    label: 'Kapcsolat',
    hint: 'Írj nekünk, ha nem találod, amit keresel.',
  },
] as const

/**
 * A Tudástár-javaslat célja a fenti listában.
 *
 * Tudástár-kapcsoló (src/lib/tudastar-kapcsolo.ts): rejtett /blog menüpontnál
 * a Tudástár sehol nem jelenhet meg, a hibaoldalon sem. Ilyenkor a lista a
 * többi, mindig élő célra szűkül. A modul maga szándékosan nem olvas
 * adatbázist: az állapotot a beépítési hely adja át.
 */
export const NOT_FOUND_TUDASTAR_HREF = '/blog'

/** A továbbvezető célok a Tudástár-kapcsoló állapota szerint. */
export function notFoundDestinations(
  tudastarLathato: boolean,
): ReadonlyArray<(typeof NOT_FOUND_DESTINATIONS)[number]> {
  return tudastarLathato
    ? NOT_FOUND_DESTINATIONS
    : NOT_FOUND_DESTINATIONS.filter((destination) => destination.href !== NOT_FOUND_TUDASTAR_HREF)
}

/**
 * Kapcsolatfelvételi e-mail.
 *
 * Szándékosan NEM a `Footer.tsx` konstansát importáljuk: a lábléc modulja
 * magával hozná a `NewsletterSignup`-ot és rajta keresztül a teljes
 * Payload-példányt, a `global-not-found` viszont a Next dokumentációja szerint
 * kifejezetten könnyű lapnak való
 * (https://nextjs.org/docs/app/api-reference/file-conventions/not-found).
 * A két érték egyezését őr-teszt tartja szinkronban
 * (`src/__tests__/hibaoldal.test.tsx`).
 */
export const NOT_FOUND_CONTACT_EMAIL = 'info@kineticare.hu'
