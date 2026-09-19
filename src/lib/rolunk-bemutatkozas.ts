/**
 * A bemutatkozás (About-blokk) szövegei: a KEZDŐLAPÉ és a /rolunk LAPÉ külön
 * (WP37, tulajdonosi kérés 2026-09-08: „a főoldalon kellene több információ a
 * lányokról … professzionális maradjon”, „a rólunk részt is … hogy még jobban
 * az adott menüpontra fókuszáljon”). A WP18 (2026-09-07) egyetlen közös
 * szövege innentől történeti: pontos egyezéshez a tartalom-csere őrzi
 * (`WP18_KOZOS_BEMUTATKOZAS`).
 *
 * SZEREP-MEGOSZTÁS (a források a docs/owner-ui-2026-09-07.md WP37-szakaszában):
 *  - Kezdőlap: KIK ŐK és MIÉRT bízz bennük, 20 másodperc alatt: nevek,
 *    végzettség, szakterület, hány éve, hol, mit kapsz. NN/g Homepage design
 *    principles: „Treat your homepage as an elevator pitch”
 *    (https://www.nngroup.com/articles/homepage-design-principles/); NN/g
 *    About Us, 1. szint: a kezdőlap rövid összefoglalója
 *    (https://www.nngroup.com/articles/about-us-information-on-websites/).
 *  - Rólunk: a történet, a hitvallás, a szakmai út és az egyesületi szerep,
 *    továbbvezetés a részletes szakmai háttérhez és a kapcsolathoz. NN/g About
 *    Us, 2. szint: „1-2 scannable paragraphs with goals and accomplishments”.
 *
 * Fogyasztók: a kezdőlap seedje (src/lib/home-seed.ts) a kezdőlapit; a /rolunk
 * builderei (src/scripts/restore-legacy-content.ts) és a tulajdonosi review A02
 * szabálya (src/lib/owner-review-v1.ts) a Rólunk-ét. Külön, függőség nélküli
 * kis modul, hogy importkör ne legyen.
 *
 * Nyelv: natív magyar, E/2 tegezés, töltelék gondolatjel nélkül (docs/
 * ui-sztenderdek.md §3.1); GOV.UK: 25 szó alatti mondatok, legfeljebb 5 mondat
 * bekezdésenként (https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/clear-language/).
 * NN/g F-minta: a bekezdés első szavai viszik az információt
 * (https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/).
 * A két szöveg között nincs közös hatszavas szókapcsolat (őr:
 * src/__tests__/bemutatkozas-szetvalasztas.test.ts).
 *
 * TÉNYEK kizárólag a repóból (forráshelyek a doksi WP37-szakaszában): nevek,
 * titulusok, egyetemek és szakterületek a /rolunk önéletrajz-seedjéből, a két
 * budapesti rendelő a szolgáltatás-seedből, a „több mint tíz év” a kezdőlapi
 * statisztikából, az egyesületi szerepek a docs/kc-v1-logo-sources.md-ből.
 */

/** A kezdőlapi About-blokk címe (a tulajdonos kérésére változatlan). */
export const KEZDOLAP_BEMUTATKOZAS_CIM = 'Megérdemled a profi törődést'

/** A kezdőlapi bemutatkozás bekezdései, sorrendben; az első kiemelt. */
export const KEZDOLAP_BEMUTATKOZAS: readonly string[] = [
  'Kocsis Kata és Kiss Kata vagyunk, gyógytornászok és sportrehabilitációs trénerek. Több mint tíz éve elsősorban a kéz, a csukló és a könyök rehabilitációjával foglalkozunk, két budapesti rendelőben és online.',
  'Kocsis Kata a Pécsi Tudományegyetemen végzett gyógytornászként, kézsérülésekkel, műtét utáni állapotokkal és sportolói panaszokkal foglalkozik, és az akkreditált kézrehabilitációs képzésünk oktatója. Kiss Kata a Semmelweis Egyetemen szerzett gyógytornász diplomát, manuálterapeutaként a csukló- és kézpanaszok hátterét keresi, a sportolói eseteket is beleértve.',
  'Nálunk vizsgálat után a saját panaszaidhoz és terhelhetőségedhez szabott tervet kapsz. Ha nem tudsz rendelőbe járni, az otthoni videókurzussal a saját tempódban gyakorolhatsz.',
]

/**
 * WP52 — a kezdőlapi bemutatkozás RÖVIDÍTETT változata (tulajdonosi kérés,
 * 2026-09-19: „lehetséges a rövidítés? jó lenne, ha a szakmai egyesületi
 * tagság rész a képekkel egy vonalba kerülhetne”). Mérve a `KEZDOLAP_BEMUTATKOZAS`
 * ellenében: 745 → 483 karakter (35 %-kal rövidebb), 93 → 63 szó; minden
 * mondat 25 szó alatt (GOV.UK), töltelék gondolatjel nélkül (docs/
 * ui-sztenderdek.md §3.1). A tények változatlanok: nevek, kézre szakosodott
 * gyógytornászok, tíz év, két budapesti rendelő és online, Pécs és Semmelweis
 * (tulajdonosi kikötés: a Semmelweis-mondat marad), képzés-oktatás,
 * manuálterápia, vizsgálat utáni saját terv, otthoni videókurzus.
 *
 * A tartalom-csere (apply-owner-content, `alkalmazKezdolapBemutatkozasRovidites`)
 * kizárólag a PONTOSAN `KEZDOLAP_BEMUTATKOZAS`-t viselő blokkot cseréli erre;
 * a kezdőlap seedje a tulajdonosi jóváhagyásig a hosszabb változaton marad.
 */
export const KEZDOLAP_BEMUTATKOZAS_ROVID: readonly string[] = [
  'Kocsis Kata és Kiss Kata vagyunk, kézrehabilitációra szakosodott gyógytornászok. Több mint tíz éve a kéz, a csukló és a könyök panaszaival foglalkozunk, két budapesti rendelőben és online.',
  'Kocsis Kata a Pécsi Tudományegyetemen végzett, ő az akkreditált kézrehabilitációs képzésünk oktatója. Kiss Kata a Semmelweis Egyetemen diplomázott, manuálterapeutaként a panaszok hátterét keresi.',
  'Vizsgálat után a panaszaidhoz szabott tervet kapsz, otthonra pedig videókurzust a saját tempódban.',
]

/**
 * A /rolunk About-blokk címe: a menüpontra fókuszál (történet, szakmai út).
 * Első két szava viszi a lényeget (NN/g F-minta: „if users see only the first
 * 2 words, they should still get the gist”), 31 karakter, a `.kc-about__title`
 * 62ch mértékén egy sor (mérve a WP37-szakaszban).
 */
export const ROLUNK_BEMUTATKOZAS_CIM = 'Így lett a kéz a szakterületünk'

/** A /rolunk bemutatkozás bekezdései, sorrendben; az első kiemelt. */
export const ROLUNK_BEMUTATKOZAS: readonly string[] = [
  'A Kineticare két gyógytornász közös praxisa, amely az évek alatt a kézrehabilitációra épült. A pácienseink nagy része makacs kéz-, csukló-, könyök- vagy vállfájdalommal érkezik hozzánk, ezért pontosan tudjuk, mennyire megkeseríti a mindennapokat.',
  'A legújabb kutatásokat, a külföldi irányelveket és a saját tapasztalatunkat együtt használjuk, hogy a felépülés biztonságos és a lehető leggyorsabb legyen. Folyamatosan képezzük magunkat nemzetközi kézterápiás kurzusokon. Amit tudunk, a ProBody Stúdióval közös, akkreditált képzésen adjuk tovább kollégáinknak (12 kreditpont, SZTK-A-33553/2024). A Semmelweis Egyetemen a jövő gyógytornászai az egyetemi képzésükön többek között a mi anyagunkból is tanulnak.',
  'Hisszük, hogy a kezed nem csak egy testrész: ezzel dolgozol, alkotsz és gondoskodsz. Lentebb megtalálod a részletes szakmai hátterünket, a pácienseink véleményét és a partnereinket; ha kérdésed van, a Kapcsolat oldalon elérsz minket.',
]

/** A kezdőlapi bemutatkozás ikonos kiemelése. */
export const KEZDOLAP_BEMUTATKOZAS_KIEMELES = {
  label: 'Szakmai egyesületi tagság',
  note: 'A Magyar Sportrehabilitációs Egyesület és a Magyar Gyógytornász-Fizioterapeuták Társaságának munkájában is részt veszünk.',
} as const

/**
 * A /rolunk bemutatkozás ikonos kiemelése: ugyanaz a címke, bővebb jegyzet.
 * Az alapító tagság és a bizottsági társelnökség az egyesület hivatalos
 * oldalán áll (https://magyarsportrehab.hu/felso-vegtagi-bizottsag/,
 * docs/kc-v1-logo-sources.md).
 */
export const ROLUNK_BEMUTATKOZAS_KIEMELES = {
  label: 'Szakmai egyesületi tagság',
  note: 'A Magyar Sportrehabilitációs Egyesület alapító tagjai és Felső Végtagi Bizottságának társelnökei vagyunk, és a Magyar Gyógytornász-Fizioterapeuták Társaságának munkájában is részt veszünk.',
} as const

/**
 * A WP18 (2026-09-07 és 2026-09-08 között élő) KÖZÖS bemutatkozás pontos
 * pillanatképe: a kezdőlapon és a /rolunk lapon ma szóról szóra ez áll (mérve
 * 2026-09-08 az éles oldalon). A tartalom-csere (apply-owner-content) csak
 * PONTOSAN ezzel egyező blokkot cserél; szerkesztett szöveghez nem nyúl.
 */
export const WP18_KOZOS_BEMUTATKOZAS = {
  title: 'Megérdemled a profi törődést',
  paragraphs: [
    'A kéz rehabilitációja a szakterületünk. Gyógytornával, manuálterápiával és otthoni gyakorlással támogatunk a mindennapi mozgásban.',
    'Személyes kezelésen a panaszaidhoz és a terhelhetőségedhez igazítjuk a közös munkát. Az online kurzus tartalmát előre megismerheted, és a saját tempódban haladhatsz vele.',
  ] as readonly string[],
} as const

/**
 * A Rólunk-bemutatkozás ELSŐ éles változata (2026-09-08 reggel, WP37): a
 * tulajdonos ugyanaznap kérte bele a Semmelweis-mondatot („nagyon tetszik”),
 * ezért a tartalom-csere ezt a változatot is pontos egyezéssel cseréli a
 * mai szövegre. Kizárólag a csere forrás-mintája, sehol máshol nem használjuk.
 */
export const ROLUNK_BEMUTATKOZAS_V1 = {
  title: 'Így lett a kéz a szakterületünk',
  paragraphs: [
    'A Kineticare két gyógytornász közös praxisa, amely az évek alatt a kézrehabilitációra épült. A pácienseink nagy része makacs kéz-, csukló-, könyök- vagy vállfájdalommal érkezik hozzánk, ezért pontosan tudjuk, mennyire megkeseríti a mindennapokat.',
    'A legújabb kutatásokat, a külföldi irányelveket és a saját tapasztalatunkat együtt használjuk, hogy a felépülés biztonságos és a lehető leggyorsabb legyen. Folyamatosan képezzük magunkat nemzetközi kézterápiás kurzusokon. Amit tudunk, a ProBody Stúdióval közös, akkreditált képzésen adjuk tovább kollégáinknak (12 kreditpont, SZTK-A-33553/2024).',
    'Hisszük, hogy a kezed nem csak egy testrész: ezzel dolgozol, alkotsz és gondoskodsz. Lentebb megtalálod a részletes szakmai hátterünket, a pácienseink véleményét és a partnereinket; ha kérdésed van, a Kapcsolat oldalon elérsz minket.',
  ] as readonly string[],
} as const

const bekezdesek = (lista: readonly string[]) =>
  lista.map((text, index) => ({ text, emphasized: index === 0 }))

/** A kezdőlapi bekezdések az About-blokk `paragraphs` alakjában (az első kiemelt). */
export const kezdolapBemutatkozasBekezdesek = () => bekezdesek(KEZDOLAP_BEMUTATKOZAS)

/** A /rolunk bekezdések az About-blokk `paragraphs` alakjában (az első kiemelt). */
export const rolunkBemutatkozasBekezdesek = () => bekezdesek(ROLUNK_BEMUTATKOZAS)

/** A kezdőlapi About-blokk szöveges mezői (cím, bekezdések, kiemelés) egy alakban. */
export const kezdolapBemutatkozasSzoveg = () => ({
  title: KEZDOLAP_BEMUTATKOZAS_CIM,
  paragraphs: kezdolapBemutatkozasBekezdesek(),
  feature: { ...KEZDOLAP_BEMUTATKOZAS_KIEMELES },
})

/**
 * A kezdőlapi About-blokk RÖVIDÍTETT szöveges mezői (WP52): a cím és a kiemelés
 * változatlan, csak a bekezdések rövidebbek (az első kiemelt).
 */
export const kezdolapBemutatkozasRovidSzoveg = () => ({
  title: KEZDOLAP_BEMUTATKOZAS_CIM,
  paragraphs: bekezdesek(KEZDOLAP_BEMUTATKOZAS_ROVID),
  feature: { ...KEZDOLAP_BEMUTATKOZAS_KIEMELES },
})

/** A /rolunk About-blokk szöveges mezői (cím, bekezdések, kiemelés) egy alakban. */
export const rolunkBemutatkozasSzoveg = () => ({
  title: ROLUNK_BEMUTATKOZAS_CIM,
  paragraphs: rolunkBemutatkozasBekezdesek(),
  feature: { ...ROLUNK_BEMUTATKOZAS_KIEMELES },
})
