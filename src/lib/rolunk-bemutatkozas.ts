/**
 * A bemutatkozás (About-blokk) KÖZÖS szövege a kezdőlapon és a /rolunk lapon
 * (WP18, tulajdonosi kérés 2026-09-07: „a főoldalon a rólunk rész legyen
 * olyan, mint a rólunk menüpont alatt").
 *
 * EGY forrás, HÁROM fogyasztó: a kezdőlap seedje (src/lib/home-seed.ts
 * `buildHomeLayout`), a /rolunk builderei (src/scripts/restore-legacy-content.ts:
 * szekciósor ÉS rich-text tartalék) és a tulajdonosi review A02 szabálya
 * (src/lib/owner-review-v1.ts). Külön, függőség nélküli kis modul, hogy a
 * tiszta tervező (owner-review-v1) ne húzza be a fájlrendszert olvasó
 * home-seedet, és importkör se legyen.
 *
 * A SZÖVEG az ÉLES /rolunk About-ja (a tulajdonosi review A02 változata, ezt
 * látja és ezt kéri a tulajdonos), nem a régi oldal hétbekezdéses legacy
 * története. Ugyanaz a bemutatkozás két helyen ugyanazokkal a szavakkal:
 * WCAG 2.2 SC 3.2.4 Consistent Identification; NN/g „About Us": a látogató a
 * lapok közt ugyanazt a történetet várja
 * (https://www.nngroup.com/articles/about-us-information-on-websites/).
 */

export const ROLUNK_BEMUTATKOZAS_CIM = 'Megérdemled a profi törődést'

/** A bemutatkozás bekezdései, sorrendben; az első kiemelt. */
export const ROLUNK_BEMUTATKOZAS: readonly string[] = [
  'A kéz rehabilitációja a szakterületünk. Gyógytornával, manuálterápiával és otthoni gyakorlással támogatunk a mindennapi mozgásban.',
  'Személyes kezelésen a panaszaidhoz és a terhelhetőségedhez igazítjuk a közös munkát. Az online kurzus tartalmát előre megismerheted, és a saját tempódban haladhatsz vele.',
]

/** A bemutatkozás ikonos kiemelése. */
export const ROLUNK_BEMUTATKOZAS_KIEMELES = {
  label: 'Szakmai egyesületi tagság',
  note: 'A Magyar Sportrehabilitációs Egyesület és a Magyar Gyógytornász-Fizioterapeuták Társaságának munkájában is részt veszünk.',
} as const

/** A bekezdések az About-blokk `paragraphs` alakjában (az első kiemelt). */
export const rolunkBemutatkozasBekezdesek = () =>
  ROLUNK_BEMUTATKOZAS.map((text, index) => ({ text, emphasized: index === 0 }))

/**
 * Az About-blokk szöveges mezői (cím, bekezdések, kiemelés) egy alakban, hogy
 * a seed-builderek és a tartalom-csere (apply-owner-content) ugyanazt használják.
 */
export const rolunkBemutatkozasSzoveg = () => ({
  title: ROLUNK_BEMUTATKOZAS_CIM,
  paragraphs: rolunkBemutatkozasBekezdesek(),
  feature: { ...ROLUNK_BEMUTATKOZAS_KIEMELES },
})
