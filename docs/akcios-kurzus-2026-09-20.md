# Akciós kurzus rejtett menüponttal — 2026-09-20 (WP54, WP55, WP56)

Tulajdonosi kérés (2026-09-20): a lányok létrehoztak egy akciós kurzust, ami a teljes
árú Otthoni KézRehab Program másolata (mérve: azonos modul- és leckecímek, azonos
videó-azonosítók), 39 500 Ft-ért. Ezt a partnereiknek szánják, közvetlen linken, a
menüben nem látszó módon. Emellett a rendelő címe legyen kattintható (Google Térkép).

## Döntések és indoklás

1. **A menüpont a kurzus SAJÁT oldalára mutat** (`/kurzusok/otthoni-kezrehab-program-akcio`),
   nem egy CMS-oldalra. A kurzusoldal adja az árat, a „Megveszem" gombot, a
   Barion-pénztárat, a tananyag-listát, a garanciát, a GYIK-et és a strukturált
   adatot; egy CMS-oldalon ezek egyike sem áll rendelkezésre blokként, és egy
   termék-beágyazó blokk új adatbázis-táblát (migrációt) igényelne
   (`src/lib/cta-banner-course.ts` fejkomment). Az egykori `/akcios-kurzus`
   kód-útvonal (noindex demóoldal, `docs/kc-demo-course-cms.md`, történeti) a
   WP60-ban megszűnt.
2. **Rejtett link = új `unlisted` mező a menüpontokon.** A „Látható" pipa kivétele a
   sort a nyilvános API-ról is levenné; az `unlisted` csak a navigációból veszi ki
   (`src/lib/menu-tree.ts`), a cél linkje él. Az admin szerkesztőlapon a kapcsoló
   mellett egy doboz mutatja a közvetlen, abszolút linket, másolás gombbal.
3. **A rendelőcím Google Térkép-link**, a telefonszám mintájára aláhúzva, új lapon,
   a `search` URL-alakkal (a hely megjelenik, onnan egy gombbal indítható útvonal;
   a `dir` alak azonnal helymeghatározást kérne). Források a kódban.

## Owner-content szabályok (`npm run content:owner`)

| Szabály                     | Mit tesz                                                                                                                                                                                                                         | Feltétel                                                                                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `akcios-kurzus-menupont`    | Az „olcsó dolgok itt" menüpont → „Akciós KézRehab kurzus", típus Kurzus, cél az akciós kurzus (webcím alapján), `unlisted: true`, nem új lapon                                                                                   | felirat pontosan a régi (kis/nagybetű, szélső szóköz nélkül) vagy már az új; az akciós kurzus létezik, különben hangos                                                                          |
| `akcios-kurzus-eladoszoveg` | Fő előnyök (4 sor), GYIK (5 pár), SEO-cím, SEO-leírás, kapcsolódó kurzus (SOS) az akciós kurzuson                                                                                                                                | mezőnként csak ÜRES mezőbe ír, vagy a script korábbi, beégetett árú szövegét cseréli (betűre egyezve); más kitöltött mező kihagyás                                                              |
| `akcios-kurzus-arszoveg`    | A törzs téves, teljes árú ár-mondata („eredeti ára 119 000 Ft… 79 500 Ft") → akciós mondat; a zárójeles „nem helyettesíti a szakorvosi kontrollt" marad                                                                          | bekezdés-eleji pontos egyezés; átírt szövegnél hangos kihagyás                                                                                                                                  |
| `akcios-ar-atallas`         | WP63: az ár-modell egyszeri átállása. Ár (rendes ár) = a régi Teljes ár értéke (79 500 Ft), Akciós ár = a régi Ár értéke (39 500 Ft), a régi Teljes ár mező kiürül. Az akció végén magától a rendes ár él, nincs kézi visszaírás | kitöltött Akciós ár: csendes kihagyás; üres örökölt Teljes ár: csendes kihagyás; örökölt Teljes ár, ami nem nagyobb az Árnál vagy nincs érvényes Ár: hangos kihagyás, az adminban kell rendezni |
| `demo-oldal-visszavonas`    | WP60: az egykori demólap („Képzeletbeli akciós kurzus", `akcios-kurzus` webcím) közzétételének visszavonása: `_status` published → draft                                                                                         | csak a pontosan ilyen című rekordon; más címnél hangos kihagyás; hiányzó vagy már piszkozat rekordnál csendes kihagyás                                                                          |

Őr: `src/__tests__/owner-content-akcios-kurzus.test.ts`, `src/__tests__/owner-content-demo-oldal.test.ts`.

A „Hogyan működik", „Kinek való" és „Garancia" szakaszok a teljes árú programmal
azonos módon a törzs címsoraiból és a tényadatokból épülnek
(`src/components/courses/sales-content.ts`), ezért oda a script nem ír.

## Amit a tulajdonosnak tudnia kell

- **Ár-modell (WP63, 2026-09-21).** Az akciós kurzuson az „Ár” mező a RENDES ár
  (79 500 Ft), az „Akciós ár” mező az akciós időablakban fizetendő ár (39 500 Ft).
  Amíg az akció él (bekapcsolt pipa és a dátumablakon belül, vagy dátum nélkül nyílt
  végű), a vevő az akciós árat fizeti és a rendes ár áthúzva jelenik meg; az akció
  végén magától a rendes ár él, nincs kézi visszaírás és nincs időzített feladat
  (`coursePriceHuf`, `src/lib/courses.ts`). A régi „Teljes ár (Ft, áthúzva jelenik
  meg)” mező örökölt: az adminban rejtett, senki nem olvassa, egy későbbi PR
  megszünteti az oszlopot. Az akciós oldal statikus szövege (fő előnyök, SEO-cím
  és -leírás, a törzs ár-mondata) 2026-09-22 óta NEM mond ki árat: a korábbi
  „itt 39 500 Ft” az akció lejárta után is ott maradt volna, miközben a pénztár
  már a rendes árat kéri (félrevezető árközlés, 2005/29/EK 6. cikk (1) d). Az
  árat egyedül a buybox mutatja, élőben. A `content:owner` a script korábbi,
  beégetett árú szövegeit (és csak azokat, betűre egyezve) lecseréli; ha az
  adminban kézzel írtál árat a szövegbe, azt neked kell kivenned.
- **A rejtett link nem hozzáférés-védelem.** Aki tudja a linket, megnyitja. A
  kurzus a `/kurzusok` listában és a keresőkben is látszik, mert közzétett termék.
  Ha a partneri árat a nyilvánosság elől is el kell rejteni, az külön feladat
  (pl. kuponkód vagy nem listázott termék), ma nincs ilyen funkció.
- **A demóoldal** („Képzeletbeli akciós kurzus", `akcios-kurzus` webcím): a dedikált
  noindex route a WP60-ban megszűnt, ezért a közzétett CMS-rekordot az általános
  `[slug]` route indexelhető oldalként szolgálná ki. A `demo-oldal-visszavonas`
  szabály (`npm run content:owner`, íráshoz `OWNER_CONTENT_CONFIRM=igen`) a rekord
  közzétételét vonja vissza (`_status: 'draft'`, `draft: false`, ugyanaz, amit az
  admin „Unpublish” gombja küld); őr: `src/__tests__/owner-content-demo-oldal.test.ts`.
- **Kategória.** Az akciós kurzus az „Akciós termékek" kategóriában van; a kurzuslista
  kategória-szűrője így külön chipet mutat rá.

## Éles alkalmazás

1. A kód mainre kerül, a Railway lefuttatja az `unlisted` oszlop migrációját.
2. `npm run content:owner` (próbafutás) a content-job szolgáltatáson: három
   „MÓDOSÍTANÁ" sor (menüpont, eladó mezők, ár-mondat).
3. `OWNER_CONTENT_CONFIRM=igen npm run content:owner`, majd második próbafutás:
   mindhárom szabály „MÁR" kihagyás.
4. Ellenőrzés: a menüben nincs „olcsó dolgok itt" és nincs „Akciós KézRehab kurzus";
   `/kurzusok/otthoni-kezrehab-program-akcio` 200, ár 39 500 Ft, „Megveszem" gomb,
   fő előnyök, GYIK, a törzsben az akciós ár-mondat; az adminban a menüpont lapján
   a „Közvetlen link" doboz a teljes URL-lel.
5. WP63 (`akcios-ar-atallas`): a `promoPriceHuf` oszlop migrációja után
   `npm run content:owner` (próbafutás): egy „MÓDOSÍTANÁ" sor az ár-átállásról
   (Ár 39 500 Ft → 79 500 Ft, Akciós ár 39 500 Ft, Teljes ár kiürítve). Majd
   `OWNER_CONTENT_CONFIRM=igen npm run content:owner`, és második próbafutás: a
   szabály „MÁR" kihagyás. Ellenőrzés az adminban: Ár 79 500, Akciós ár 39 500,
   a régi Teljes ár üres; a kurzusoldalon fizetendő ár 39 500 Ft, áthúzva 79 500 Ft.
