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

| Szabály                     | Mit tesz                                                                                                                                                                                                    | Feltétel                                                                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `akcios-kurzus-menupont`    | Az „olcsó dolgok itt" menüpont → „Akciós KézRehab kurzus", típus Kurzus, cél az akciós kurzus (webcím alapján), `unlisted: true`, nem új lapon                                                              | felirat pontosan a régi (kis/nagybetű, szélső szóköz nélkül) vagy már az új; az akciós kurzus létezik, különben hangos                                     |
| `akcios-kurzus-eladoszoveg` | Fő előnyök (4 sor), GYIK (5 pár), SEO-cím, SEO-leírás, kapcsolódó kurzus (SOS) az akciós kurzuson                                                                                                           | mezőnként csak ÜRES mezőbe ír; kitöltött mező kihagyás                                                                                                     |
| `akcios-kurzus-arszoveg`    | A törzs téves, teljes árú ár-mondata („eredeti ára 119 000 Ft… 79 500 Ft") → akciós mondat; a zárójeles „nem helyettesíti a szakorvosi kontrollt" marad                                                     | bekezdés-eleji pontos egyezés; átírt szövegnél hangos kihagyás                                                                                             |
| `akcios-kurzus-akcio-mezok` | PR #278: az „Akciós kurzus” pipa bekapcsolása (dátum nélkül, nyílt végű) és a „Teljes ár” a teljes árú Otthoni KézRehab ma élő árával, hogy a kurzusoldal az akciós sablont, a kártya az Akció címkét kapja | bekapcsolt pipa: csendes kihagyás; kitöltött teljes ár: kihagyás; ha a teljes árú program ára nem nagyobb vagy nem olvasható: a teljes ár hangosan kimarad |
| `demo-oldal-visszavonas`    | WP60: az egykori demólap („Képzeletbeli akciós kurzus", `akcios-kurzus` webcím) közzétételének visszavonása: `_status` published → draft                                                                    | csak a pontosan ilyen című rekordon; más címnél hangos kihagyás; hiányzó vagy már piszkozat rekordnál csendes kihagyás                                     |

Őr: `src/__tests__/owner-content-akcios-kurzus.test.ts`, `src/__tests__/owner-content-demo-oldal.test.ts`.

A „Hogyan működik", „Kinek való" és „Garancia" szakaszok a teljes árú programmal
azonos módon a törzs címsoraiból és a tényadatokból épülnek
(`src/components/courses/sales-content.ts`), ezért oda a script nem ír.

## Amit a tulajdonosnak tudnia kell

- **Ár-összehasonlítás.** Az akciós oldal a MA ÉLŐ teljes árú programra hivatkozik
  („mint a 79 500 Ft-os programban, itt 39 500 Ft"), nem „korábbi" árra. A kettő két
  külön termék. Ha a teljes árú program ára változik, ezt a mondatot és a fő előnyök
  első sorát az adminban frissíteni kell. Egy „eredeti ár / akciós ár" (áthúzott ár)
  mező ma nincs a terméken; az bevezetése migrációval járna, külön döntés.
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
