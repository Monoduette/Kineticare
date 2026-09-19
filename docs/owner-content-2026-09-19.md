# Tulajdonosi tartalom-szabályok — 2026-09-19 (WP52, WP54)

A `npm run content:owner` script (`src/scripts/apply-owner-content.ts`) 2026-09-19-én
felvett, idempotens szabályai. Mind a meglévő mintát követi: tiszta `alkalmaz…`
döntésfüggvény, `modositasok` / `kihagyasok` napló indokkal, szigorú egyezés,
hangos (`error` szintű) kihagyás hiányzó előfeltételnél, a szerkesztő adatához a
script nem nyúl. Alapból próbafutás; írás csak `OWNER_CONTENT_CONFIRM=igen` mellett
(élesben a Railway `content-job` szolgáltatás futtatja).

## WP52 — CMS-adat a tulajdonosi kérésekhez

| Szabály                       | Mit tesz                                                                                      | Feltétel                                                                  |
| ----------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `szakmai-menupont`            | A „Szakmai képzés(ek)” menüpont → „Szakembereknek”, belső `/szakembereknek` cél, nem új lapon | felirat pontosan a régi, cél pontosan a ProBody URL                       |
| `kezdolap-segitseg-sorrend`   | A kezdőlapi „Így tudunk segíteni” sín a „Kurzusaink” kártyák elé                              | mindkét blokk látható, pontosan egyszer                                   |
| `kezdolap-sajtologo-sorrend`  | Az önálló sajtó-logósor közvetlenül a kezdőlapi About mögé                                    | rejtett duplikátum nem horgony                                            |
| `kezdolap-bemutatkozas-rovid` | A kezdőlapi About bekezdései a rövid szövegre (`KEZDOLAP_BEMUTATKOZAS_ROVID`)                 | ma pontosan a `KEZDOLAP_BEMUTATKOZAS` áll benne                           |
| `rolunk-partner-mondat`       | A /rolunk „Partnereink” alatti mondat törlése (a törölt szöveg betűhíven a naplóban)          | a sáv utáni blokk pontosan egyetlen, betűre egyező bekezdés               |
| `rolunk-logosavok-sorrend`    | A „Partnereink” és az „Itt találkozhattál velünk” sávok helycseréje                           | a partner-mondat már törölve, különben hangos kihagyás; nem forgat vissza |

Őr: `src/__tests__/owner-content-wp52.test.ts`.

## WP54 — fotók a repó fájljaiból

### 1. Média a repó fájljából (`biztositMediaFajlbol`)

- Ha a `media` collectionben már van rekord a PONTOS fájlnévvel, azt adja vissza (nem
  duplikál). Különben a `public/media/...` fájlból hozza létre a megadott alt-tal
  (`payload.create({ collection: 'media', filePath, data: { alt } })`).
- Próbafutásban SEMMIT nem hoz létre, csak naplózza („létrehozná”). Hiányzó forrásfájl:
  hangos kihagyás.
- A döntés tiszta függvény (`dontsMediaBiztositas`), a Payload-hívás injektált
  (`MediaBiztositasFuggosegek`; élesben `payloadMediaFuggosegek`). Ha a Payload a várttól
  eltérő fájlnevet adna (ütköző fájl a feltöltési könyvtárban), a script hangosan hibával
  áll le — a részleges állapot kézi átnézést kér. A team/press manifestben szereplő
  képnél az eredetigazolást is rögzíti (`enrollMediaRecovery`).
- A rekordot a script csak akkor hozza létre, ha a hivatkozó szabály ténylegesen módosít
  (szerkesztői képnél nem keletkezik fölösleges média).

### 2. A /rolunk fejléc-képe (`rolunk-hero-kep`, `alkalmazRolunkHeroKep`)

EGYETLEN szabály él a mezőre (a korábbi „szóló portré → katak-team” csere ebbe olvadt).

- Cél: `founders-studio-pair-1600.webp` (`public/media/team/`, alt: „Kocsis Kata és Kiss
  Kata a stúdióban”).
- Csere KIZÁRÓLAG üres mezőnél, vagy ha a mai kép a script/seed korábbi képe
  (`ROLUNK_HERO_KORABBI_PREFIXEK`: `682a121babe80_IMG_7573…`, `katak-team…`).
- Ha már a stúdiófotó: csendes kihagyás. Szerkesztői kép, nem található média-rekord,
  vagy hiányzó forrásfájl: HANGOS kihagyás.

### 3. Az ingyenes SOS kurzus galériája (`sos-galeria`, `alkalmazSosGaleria`)

- A termék: `products.sku = SOS_COURSE_SKU` („SOS Kézrelax villámkurzus”), a `gallery`
  tömbmező (`{ image }[]`); ugyanabba az update-be fut, mint a 7./13./17. javítás.
- Három kép EBBEN a sorrendben (`public/media/sos/`): `sos-band-stretch-1600.webp`
  („Gumiszalagos csuklónyújtás az asztal szélén”), `sos-ball-squeeze-1600.webp` („Puha labda
  szorítása a tenyérben”), `sos-spiky-ball-forearm-1600.webp` („Tüskés labdás alkarlazítás”).
- Írás KIZÁRÓLAG üres galériába. Pontosan ez a hármas: csendes kihagyás; csak ezekből, de
  más sorrendben vagy hiányosan: indokolt kihagyás (nem rendez át, nem egészít ki); bármi
  más a szerkesztőé: HANGOS kihagyás. Hiányzó forrásfájl: hangos kihagyás, a galéria csak
  a teljes hármassal kerül be.
- A kurzusoldal (`CourseGalleryFigure`) ma csak a galéria ELSŐ képét rendereli a leírás
  után; a további képek megjelenítése külön (felületi) döntés.

### 4. A /szolgaltatasok technikák-táblája (`szolgaltatasok-technikak-tabla`)

- Tulajdonosi kérés: a régi oldal „miket csinálunk” listája (hegkezelés, flossing, tape…)
  maradjon. Új `services` blokk tábla-elrendezéssel, KÖZVETLENÜL a három ajtós
  `services` blokk (`isSzolgaltatasokAjtoBlock`) után: eyebrow „Rendelői kezelések”, cím
  „Amit a rendelőben kínálunk”, 5 sor („1”–„5”: Gyógytorna, Manuálterápia, Kinesio Tape
  és Dynamic Tape, Flossing és köpölyterápia, Hegkezelés, fasciakés, NRX bandázs),
  horgony `rendeloi-technikak`, fehér háttér.
- Kép (WP55-től): `treatment-wrist-table-1600.webp` (`public/media/team/`, alt: „Csuklókezelés a
  Kineticare rendelőjében: a gyógytornász két kézzel mobilizálja a csuklót”), NEM a fejléc
  kezelőasztalos fotója (ugyanaz a kép kétszer egy lapon rossz); kép nélkül a blokk NEM
  kerül be (hangos kihagyás).
- Idempotens: ha már van „Amit a rendelőben kínálunk” című `services` blokk (rejtve is),
  csendes kihagyás. Ha az ajtó-blokk nincs meg pontosan egyszer: indokolt kihagyás.

### 5. A /szolgaltatasok fejléc-képe (`szolgaltatasok-hero-kep`, WP55)

- Tulajdonosi visszajelzés: „olyan szűknek néz ki a sáv” (mérve 1440 px-en: 672 px-es
  szövegoszlop, a sáv 2/3-a üres). A lap fejléce a /rolunk párosított alakját kapja
  (route-oldali rész külön); a CMS-szabály a `heroImage` mezőt a kezelőasztalos fotóra
  állítja: `treatment-table-hands-1600.webp` (`public/media/team/`, alt: „Csuklókezelés a
  kezelőasztalon a Kineticare rendelőjében”).
- A korábbi 12a. (ÜRÍTŐ) szabály megszűnt, a mezőre egyetlen szabály él, az
  `alkalmazRolunkHeroKep` szemantikájával (közös mag: `alkalmazFejlecKep`): csere üres
  mezőnél vagy az örökölt rendelő-fotónál (`67b3bd06f3936_Rendelo…`); már a kezelőasztalos
  fotó: csendes kihagyás; szerkesztői kép, nem található rekord, hiányzó forrásfájl:
  HANGOS kihagyás. A rekordot a script a repó fájljából hozza létre (próbafutásban nem).

Őr: `src/__tests__/owner-content-wp54.test.ts` (a próbafutás-ág hangosan dobó
`create`/`update` hamisítvánnyal), `src/__tests__/apply-owner-content.test.ts` (a két
fejléc-kép szabály).

## Éles alkalmazás

1. A fotófájlok a repóban legyenek (`public/media/team/founders-studio-pair-1600.webp`,
   `public/media/team/treatment-table-hands-1600.webp`,
   `public/media/team/treatment-wrist-table-1600.webp`, `public/media/sos/*.webp`).
2. `npm run content:owner` (próbafutás): a naplóban „MÓDOSÍTANÁ” sorok az öt szabálynál
   és „Médiatár: … létrehozná” sorok a hiányzó rekordoknál; hangos („KIHAGYNÁ … hiányzik”)
   sor csak akkor, ha egy fájl tényleg hiányzik.
3. `OWNER_CONTENT_CONFIRM=igen npm run content:owner`, majd második próbafutás: minden
   érintett szabály „MÁR …” kihagyás (idempotencia).
