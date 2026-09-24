# Régi oldal — válaszok a tartalom-leltár nyitott kérdéseire

> **Mi ez?** A `docs/tartalom-leltar-regi-oldal.md` 6. szakaszában feltett nyitott
> kérdések (Ny1–Ny9) lezárása a régi, élő `www.kineticare.hu` öt irányban végzett
> feltárása és az azt követő **független cáfolat-kör** alapján.
>
> **Készült:** 2026-08-15 · **Módszer:** öt kutatási irány (árazás; tananyag;
> hitelesség; jogi; elérhetőség), mindegyik után önálló cáfolat-ellenőrzés
> (nyers HTML-letöltés + szó szerinti grep/diff, ill. független WebFetch-körök).
> Ebben a dokumentumban **kizárólag a cáfolat-kört túlélt tények** szerepelnek;
> a megcáfolt állítások a helyes adattal, külön jelölve.
>
> **Forrás-szabály:** minden tényhez pontos URL tartozik. Ahol egy adat több
> helyen máshogy szerepel, az ellentmondás külön rögzítve van (4. szakasz).

---

## 1. Vezetői összefoglaló

**Lezárt kérdések (tény-szinten):**

- **Ny7 — páciensszám: LEZÁRVA.** A régi oldal egyetlen alátámasztható számszerű
  állítása az „ezernél is több embernek segítettünk" (`/kezrehab`), illetve a
  „több, mint ezer embernek segítettünk" (`/kezrelax`). **5000-es szám a bejárt
  oldalakon sehol nem fordul elő** — az új oldal „5000+ elégedett páciens"
  állítása a régi oldalról nem támasztható alá.
- **Árazás: LEZÁRVA.** A 119 000 Ft-os horgonyár mindhárom sales-oldalon létezik,
  a ténylegesen fizetendő árak **79 500 Ft** (fő funnel) és **39 700 Ft** (akciós
  funnelek) — **egyszerre, párhuzamosan élnek**. A tulajdonosi „féláron megy"
  állítás számszerűen **nem stimmel**: 59 500 Ft sehol nem szerepel (részletek: 2. szakasz).
- **Garancia↔ÁSZF ellentmondás: MEGERŐSÍTVE.** A sales-oldalak feltétel nélküli
  30 napos pénzvisszafizetést ígérnek, az ÁSZF 13.1 minden visszatérítést kizár.
- **Hozzáférési idő hármas ellentmondása: MEGERŐSÍTVE.** „Örökké" (sales-oldalak)
  vs „minimum egy évig" (`/kezrelax`) vs „három hónapra garantált" (ÁSZF 2.7).
- **Telefonszám-kép: TISZTÁZVA (cáfolat-körben javítva).** Két telefonszám van,
  mindkettő személyhez kötött: Kocsis Kata +36301692263, Kiss Kata +36203573493
  (`/rolunk`); az ÁSZF hivatalos száma a +36203573493.
- **Jogi alapadatok: LEZÁRVA.** Cégnév, székhely, cégjegyzékszám, adószám,
  tárhelyszolgáltató, ÁSZF-szerkezet, adatkezelési részletek mind rögzítve
  (3.4 szakasz) — de az új jogi szövegek megírása **ügyvédi feladat**.

**Nyitva maradt (döntést vagy külső ellenőrzést igényel):**

- **Ny1** (Products `layout` mező) — architekturális döntés, a kutatás nem dönti el.
- **Ny2** (KézRelax: 0 Ft-os termék vs e-mailes lead-magnet) — a ténybeli alap
  lezárva (a régi modell e-mailes opt-in volt), a döntés a vezetőé/tulajdonosé.
- **Ny3** (30 napos garancia marad-e) — az ellentmondás ténye lezárva, a döntés
  a tulajdonosé + ügyvédé.
- **Ny4** (119 000 Ft valós eredeti ár volt-e) — az élő oldalról nem dönthető el;
  webarchívum (Wayback) nem lett vizsgálva.
- **Ny5** (Dream Team kuponok élnek-e) — az oldalról nem derül ki.
- **Ny6** (akkreditáció 2026-os érvényessége) — az oldal 2026-os instruktor-alkalmakat
  sorol, de a formális érvényesség hatósági nyilvántartásban ellenőrizendő.
- **Ny8, Ny9** — döntési kérdések; a kutatás támogató tényeket ad (5. szakasz).

**A leltárhoz képest kiderült korrekciók** (a leltár nem módosul, itt rögzítjük):

1. A leltár 2.8 pontja szerint az akciós oldalakon „visszaszámláló … egyiken
   sincs" — **ez téves**: mindkét akciós oldalon VAN visszaszámláló (látogatónkénti,
   3 napos delay-típus). A `/kezrehab-akcio`-n lejáratkor nem történik semmi
   (`action: nothing`), az `/oto-kezrehab-akcio`-n viszont **lejáratkor átirányít**
   a teljes árú `/kezrehab` oldalra (`action: redirection`).
   Forrás: https://www.kineticare.hu/kezrehab-akcio , https://www.kineticare.hu/oto-kezrehab-akcio
2. A kiegészítő terápiák listája **8 tételes**, nem 7: Dynamic Tape®, Kinezio Tape,
   Flossing, Köpölyterápia, Fasciakés, **Eszközök**, Hegkezelés, NRX®.
   Forrás: https://www.kineticare.hu/rendeloi-kezelesek
3. Kiss Kata tanfolyamlistája **pontosan 33 tétel** (a leltárban 31 áll);
   Kocsis Katáé pontosan 38 (ebből 37 évszámos) — a leltár 38-as száma helyes.
   Forrás: https://www.kineticare.hu/rolunk

---

## 2. ÁRAZÁS — kiemelt szakasz

### 2.1 A tulajdonosi állítás ellenőrzése

> Állítás: „119 000 Ft az eredeti ár, és jelenleg féláron megy."

**Az állítás RÉSZBEN áll:**

- **A 119 000 Ft mint eredeti ár / érték-horgony LÉTEZIK** — mindhárom
  sales-oldalon szerepel, „Értéke: 119.000 Ft" megfogalmazással
  (https://www.kineticare.hu/kezrehab , https://www.kineticare.hu/kezrehab-akcio ,
  https://www.kineticare.hu/oto-kezrehab-akcio). Az viszont, hogy a program
  **valaha ténylegesen kapható volt-e** ennyiért, az élő oldalról nem derül ki
  (a pénztár-konfigokban csak 79 500-as és 39 700-as pricePlan létezik,
  119 000-es nincs; webarchívum nem lett vizsgálva) — ez az **Ny4** kérdés,
  amely nyitva marad.
- **A „féláron" számszerűen NEM stimmel.** 119 000 fele = 59 500 Ft — ez az
  összeg (59 500 / 59.500 / 59500 alakban) **sehol nem szerepel** az élő oldalon
  (0 találat a /kezrehab, /kezrehab-akcio, /oto-kezrehab-akcio, /kezrehab-penztar,
  /kezrehab-akcio-penztar, /aszf, /kezrelax nyers HTML-jében; a „félár" szó sem
  fordul elő). A tényleges árak:
  - **79 500 Ft** a fő funnelben — ez 119 000-hez képest ≈66,8%, azaz
    **kb. kétharmad ár** (~33% kedvezmény);
  - **39 700 Ft** az akciós funnelekben — ≈33,4%, azaz **kb. harmadár**
    (~67% kedvezmény).
- Lehetséges magyarázat (**következtetés, nem olvasott tény**): a „félár" a
  79 500-as fő árra vonatkozó kerekítő közelítés, VAGY az 59 500 egy új oldalra
  szánt, még sehol nem publikált árpont lenne. Ezt a tulajdonossal tisztázni kell.

### 2.2 Minden talált összeg — hol és milyen szerepben

| Összeg                                            | Hol szerepel (URL)                                                                    | Milyen szerepben                                                                                                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **119 000 Ft**                                    | https://www.kineticare.hu/kezrehab                                                    | Érték-horgony, **NEM áthúzva**: „Értéke: 119.000 Ft, de most csak"                                                                                                                             |
| **119 000 Ft**                                    | https://www.kineticare.hu/kezrehab-akcio                                              | Érték-horgony, **`<s>` taggel ÁTHÚZVA**                                                                                                                                                        |
| **119 000 Ft**                                    | https://www.kineticare.hu/oto-kezrehab-akcio                                          | Érték-horgony, **`<s>` taggel ÁTHÚZVA**                                                                                                                                                        |
| **79 500 Ft**                                     | https://www.kineticare.hu/kezrehab                                                    | Fizetendő ár a fő funnelben (külön, 50-es betűméretű elem)                                                                                                                                     |
| **79 500 Ft**                                     | https://www.kineticare.hu/kezrehab-penztar                                            | Terhelendő ár a beágyazott systeme.io-konfigban (pricePlan „Otthoni KézRehab", `directChargeAmount: 7950000` kisegység, `currency: huf`, `one_shot`, létrehozva 2025-03-06, `removedAt: null`) |
| **39 700 Ft**                                     | https://www.kineticare.hu/kezrehab-akcio                                              | Fizetendő ár az akciós funnelben („39.700.- forint")                                                                                                                                           |
| **39 700 Ft**                                     | https://www.kineticare.hu/oto-kezrehab-akcio                                          | Fizetendő ár (azonos szerkezet)                                                                                                                                                                |
| **39 700 Ft**                                     | https://www.kineticare.hu/kezrehab-akcio-penztar                                      | Terhelendő ár a konfigban (pricePlan „AKCIÓ Otthoni KézRehab", `directChargeAmount: 3970000`, létrehozva 2025-03-06, `removedAt: null`)                                                        |
| **59 500 Ft**                                     | **SEHOL** (0 találat minden vizsgált oldalon)                                         | A tulajdonosi „félár" — az élő oldalon nem létezik                                                                                                                                             |
| 29 900 Ft („29.900.-")                            | mindhárom sales-oldal (pl. https://www.kineticare.hu/kezrehab )                       | Bónusz-értékállítás: Kinesio szalag minikurzus, „most ajándék"                                                                                                                                 |
| 19 900 Ft („19.900.-") ×2                         | mindhárom sales-oldal                                                                 | Bónusz-értékállítás: ergonómiai minikurzus + „sportolj kézrehab alatt" minikurzus                                                                                                              |
| „közel 100 000 Ft"                                | mindhárom sales-oldal                                                                 | Dream Team kupon/ajándék-értékígéret                                                                                                                                                           |
| ~200 000 Ft; „bőven 100 000 Ft felett"            | https://www.kineticare.hu/kezrehab (és a két akciós oldalon azonosan)                 | Összehasonlító árérv (8-10 kezelési alkalom ill. orvosi út költsége)                                                                                                                           |
| **18 000 Ft** (50 perc) / **10 000 Ft** (20 perc) | https://www.kineticare.hu/rendeloi-kezelesek                                          | Rendelői árlista (aktuális oldal; első alkalom mindig 50 perces vizsgálat; készpénz/átutalás)                                                                                                  |
| 18 000 Ft (55 perc) / 10 000 Ft (25 perc)         | https://www.kineticare.hu/rendeloi-kezelesek-regi                                     | Rendelői árlista régi változata — azonos árak, hosszabb időtartamok (élőben elérhető!)                                                                                                         |
| 2 500 000 Ft                                      | https://www.kineticare.hu/aszf                                                        | Szerzői jogi kötbér jogsértésenként (az ÁSZF egyetlen számjegyes Ft-összege)                                                                                                                   |
| ár **nincs**                                      | https://www.kineticare.hu/kezrelax                                                    | SOS KézRelax: 0 db Ft-összeg, a konfigban pricePlan sincs — opt-in jellegű ajánlat                                                                                                             |
| ár **nincs**                                      | https://www.kineticare.hu/szolgaltatasok                                              | 0 db Ft-összeg a teljes oldalon                                                                                                                                                                |
| ár **nincs**                                      | https://www.kineticare.hu/typ-kezrehab , https://www.kineticare.hu/typ-kezrehab-akcio | Köszönőoldalak, `orderSummary pricePlans: []`                                                                                                                                                  |

### 2.3 Árazási következtetések az új oldalhoz

1. **Ugyanaz a termék két élő áron fut** (79 500 vs 39 700), mindkét pricePlan
   2025-03-06-i és egyik sincs eltávolítva — az „akció" tartós párhuzamos árpont,
   nem időszakos. Az új oldalon ez így nem vihető tovább (Omnibus-kockázat,
   lásd a leltár E4–E5 tételét).
2. Az akciós oldalak visszaszámlálója **nem valós határidő**: látogatónként
   újrainduló 3 napos delay. A `/kezrehab-akcio`-n lejáratkor nincs következmény;
   az `/oto-kezrehab-akcio` lejáratkor a teljes árú `/kezrehab`-ra irányít.
3. A pénztár-oldalakon `taxBehavior: exclusive` áll — hogy a felület a
   79 500/39 700-ra számol-e rá áfát, böngésző-futtatás nélkül **NEM ELLENŐRIZHETŐ**
   (a kisegység→Ft átváltás 1/100-as értelmezése a sales-oldali árakkal konzisztens,
   de a ténylegesen terhelt végösszeg tranzakció nélkül nem bizonyított).

---

## 3. Irányonkénti eredmények

### 3.1 Árazás és ajánlat-archeológia

**Megerősített tények** (a cáfolat-kör 22 megállapításból 21-et betűre visszaigazolt):

- Árszerkezet és funnel-hozzárendelés a 2.2 táblázat szerint; a `/kezrehab`
  kizárólag a `/kezrehab-penztar`-ra, mindkét akciós oldal kizárólag a
  `/kezrehab-akcio-penztar`-ra linkel. (URL-ek a táblázatban.)
- A 30 napos garancia szövege betűre azonos mindhárom sales-oldalon, feltétel
  és ár-megkötés nélkül: „…csak írj egy e-mailt, és kérdés nélkül visszafizetjük
  a program árát." — https://www.kineticare.hu/kezrehab ,
  https://www.kineticare.hu/kezrehab-akcio , https://www.kineticare.hu/oto-kezrehab-akcio
- ÁSZF 13.1 szó szerint: „Fizetés után a Vásárló pénzvisszafizetést nem kérhet,
  a szerződés teljesítettnek minősül." — https://www.kineticare.hu/aszf
- ÁSZF 8.1 + 2.8: elállási jog kizárva (45/2014. Korm. r. 29. § hivatkozással),
  a vásárló „tudomásul vette elállási jogának elvesztését". — https://www.kineticare.hu/aszf
- ÁSZF 5.4: fizetés „a STRIPE fizetési felületén" (STRIPE 14 előfordulás, Barion 0);
  5.7: az ár „a Weboldalon feltüntetett ár"; 5.8: számla a Számlázz.hu-n keresztül,
  e-mailben. — https://www.kineticare.hu/aszf
- Részletfizetés és kedvezménykód-mező a látható tartalomban nincs (csak a
  systeme.io platform i18n-sztringjeiben fordul elő). —
  https://www.kineticare.hu/kezrehab , https://www.kineticare.hu/kezrehab-penztar
- A `/kezrehab` oldalon nincs Countdown komponens (a „countdown" találatok mind
  platform-szótárelemek). — https://www.kineticare.hu/kezrehab
- A KezRelax oldalon nincs ár és nincs pricePlan, mégis vételár-visszatérítő
  garancia-szöveg áll rajta („100% boldogság garancia … visszatérítjük a
  vételárat"). — https://www.kineticare.hu/kezrelax
- A typ-oldalak köszönőoldalak ár, upsell és határidő nélkül; kapcsolat:
  info@kineticare.hu. — https://www.kineticare.hu/typ-kezrehab ,
  https://www.kineticare.hu/typ-kezrehab-akcio

**Cáfolat-körben megcáfolt / pontosított:**

- **MEGCÁFOLVA:** „mindkét akciós oldal visszaszámlálója következmény nélküli
  (`action: nothing`)". **Helyesen:** csak a `/kezrehab-akcio`-ra igaz; az
  `/oto-kezrehab-akcio` visszaszámlálója `action: "redirection"` +
  `redirectUrl: https://www.kineticare.hu/kezrehab` — lejáratkor a kedvezményes
  ajánlat eltűnik a látogató elől. — https://www.kineticare.hu/oto-kezrehab-akcio
- Pontosítás: az ÁSZF-ben a „garancia" főnév és a számjegyes „30 nap" valóban
  nem szerepel, DE a „garantált" szóalak (2.7: hozzáférés) és a „harminc napon
  belül" (panaszkezelési határidő) más kontextusban előfordul — egyik sem
  pénzvisszafizetési garancia, a következtetés áll. — https://www.kineticare.hu/aszf
- Pontosítás: a pénztár-konfigok kisegység-értelmezése (7950000 → 79 500 Ft)
  konzisztens, de a ténylegesen terhelt végösszeg tranzakció nélkül nem bizonyított.
- Pontosítás: a 3. bónusz pontos címe „sportolj kézrehab alatt minikurzus"
  (nem „sport-minikurzus"); az árérv szövege „kezelésekre jársz"-t mond, nem
  nevesíti a gyógytornát. — https://www.kineticare.hu/kezrehab

### 3.2 Tananyag, bónuszok, garancia, hozzáférés

**Megerősített tények** (a cáfolat-kör mind a 25 megállapítást és 5 ellentmondást igazolta):

- **4 modul:** I. Az alapok (anatómia, tévhitek) · II. A probléma (okok, tipikus
  hibák, mikor melyik szakemberhez) · III. A megoldás (4 problémakör:
  könyökfájdalmak, csuklófájdalom, hüvelyk- és többi ujj panaszai, zsibbadó ujjak)
  · IV. Hosszú távú megelőzés (mobilizálás, eszközök, rögzítő-vásárlás). —
  https://www.kineticare.hu/kezrehab
- Mennyiségi adatok mindhárom sales-oldalon azonosan: „4 modulnyi részletes
  online videóanyag", „50+ videós gyakorlat", „5 perces miniblokkok".
  **Össz-játékidő sehol nem szerepel.** — https://www.kineticare.hu/kezrehab ,
  https://www.kineticare.hu/kezrehab-akcio , https://www.kineticare.hu/oto-kezrehab-akcio
- Csomagelemek: prevenciós útmutató, tematikus e-bookok (eszközök,
  táplálékkiegészítők, kézápolás), letölthető-nyomtatható gyakorlatok,
  „A Dream Team" szakemberajánló, privát Facebook-csoport (a GYIK-en kívüli
  kifogáskezelő szekcióban). — https://www.kineticare.hu/kezrehab
- **3 bónusz** mindhárom oldalon: Kinesio szalag minikurzus („Értéke: 29.900.-,
  most ajándék"), Ergonómiai minikurzus kisbabás anyukáknak („19.900.-"),
  „sportolj kézrehab alatt" minikurzus („19.900.-"); plusz szakemberajánló
  „közel 100.000 Ft értékben" kuponokkal. — https://www.kineticare.hu/kezrehab
- Hozzáférés a sales-oldalakon: „egyszer kell megvásárolnod … innentől örökké
  használhatod", „egy életre szóló segítség" — időkorlát egyik sales-oldalon
  sem szerepel. — https://www.kineticare.hu/kezrehab (azonosan a másik kettőn)
- ÁSZF 2.7 ezzel szemben: „a hozzáférés három hónap időtartamra garantált …
  A KINETICARE bármikor jogosult a harmadik hónap letelte után a felvétel
  elérését korlátozni, véglegesen lezárni, vagy … törölni." —
  https://www.kineticare.hu/aszf
- „Kinek való" lista: pontosan 9 tétel; „kinek nem való": pontosan 6 tétel
  (traumás sérülés orvosi engedély nélkül; érzéskiesés/szorítóerő-gyengülés/
  izomtömeg-vesztés; műtétre várás/onkológiai kezelés; nem akarja megérteni;
  csak passzív kezelés; nincs napi 5 perc). — https://www.kineticare.hu/kezrehab
- KézRehab GYIK: pontosan 3 kérdés (orvosnál jártam; mennyi idő múlva javul —
  „a legtöbben már 1-2 héten belül"; elég-e napi 5 perc). Hozzáférés-időtartam
  kérdés NINCS köztük. — https://www.kineticare.hu/kezrehab
- **SOS KézRelax:** „SOS Kézrelax villámkurzus" fejléc, alcím „A 3 legjobb
  gyakorlatunk a fájdalom enyhítésére"; a témalista 8 tételes; letölthető
  PDF-„puska" fotókkal és adagolással; GYIK 4 kérdés; hozzáférés: „Hivatalosan
  minimum egy évig"; „100% boldogság garancia" határidő nélkül. —
  https://www.kineticare.hu/kezrelax
- Az `/oto-kezrehab-akcio` fizetés/feliratkozás utáni oldal („Sikeres fizetés.
  Sikeres feliratkozás!" fejléccel), törzse a `/kezrehab`-bal tartalmilag azonos. —
  https://www.kineticare.hu/oto-kezrehab-akcio
- `/hamarosan`: várólista-oldal konkrét dátum nélkül, „extra kedvezményes
  ajánlat, ami a nagyközönségnek nem lesz meghirdetve" ígérettel. —
  https://www.kineticare.hu/hamarosan

**Cáfolat-körben megcáfolt / pontosított:** (megcáfolt állítás nem volt)

- A `/kezrelax` `<title>` tagje „SOS Kézrelax kedvezmény", az oldalon belüli
  fejléc „SOS Kézrelax villámkurzus"; a 8 tételes témalista kétszer szerepel
  („A villámkurzus témái" ill. „A minikurzus témái" fejléccel). —
  https://www.kineticare.hu/kezrelax
- A bónusz-értékek az oldalon „29.900.-" / „19.900.-" formában állnak (kiírt
  „Ft" nélkül). — https://www.kineticare.hu/kezrehab
- A `/kezrehab` és `/kezrehab-akcio` közti TELJES diff mindössze 4 eltéréscsoport
  (helyesírás, egy elütés, az ár, a sport-minikurzus egy mondata) — a garancia-,
  modul-, bónusz- és GYIK-szöveg betűre azonos.
- A `/kezrelax` ár-hiánya pozitívan igazolt (0 találat a Ft/forint/„.-" mintákra);
  gombfeliratok: „KÉREM A PROGRAMOT", „KÉREM A VILLÁMKURZUST", „KÉREM A HOZZÁFÉRÉST".

### 3.3 Szakmai hitelesség, akkreditáció, vélemények, partnerek

**Megerősített tények** (a cáfolat-kör mind a 24 megállapítást igazolta):

- **Páciensszám:** az egyetlen számszerű állítás a `/kezrehab` oldalon:
  „…ezernél is több embernek segítettünk…" (az eredeti „tuják" elírással).
  A kezdőlapon, a `/rolunk` és `/szolgaltatasok` oldalon célzott kereséssel
  sincs semmilyen páciensszám; 5000-es szám sehol. —
  https://www.kineticare.hu/kezrehab , https://www.kineticare.hu/ ,
  https://www.kineticare.hu/rolunk , https://www.kineticare.hu/szolgaltatasok
- **Akkreditált képzés:** „Bevezetés a kéz, a csukló- és könyökízület
  rehabilitációs lehetőségeibe" — akkreditált tantermi képzés gyógytornászok,
  orvosok, mozgásterapeuták és edzők számára, a ProBody Stúdióval;
  **12 kreditpont, SZTK-A-33553/2024**. Mindkét CV-ben 2024/2025/2026-os
  budapesti instruktor-alkalmakkal. — https://www.kineticare.hu/szolgaltatasok ,
  https://www.kineticare.hu/rolunk
- Második akkreditált elem: Oftex-kurzus („Ínvarratok és határterületek a
  kézsebészeti ellátásban", 2023, Budapest) mindkét alapítónál instruktorként. —
  https://www.kineticare.hu/rolunk
- **Kocsis Kata:** GYÓGYTORNÁSZ, SPORTREHABILITÁCIÓS TRÉNER, GYÓGY- ÉS
  SPORTMASSZŐR (PTE gyógytornász; Minerva gyógy- és sportmasszőr 54-726-01);
  38 tételes tanfolyamlista (2015–2026, köztük Aspetar 2025 Doha, ATP Challenger
  2024, 5 db Kate Thorn CHT-kurzus, 3 db Harvard-kurzus, Mulligan I., McKenzie
  A+B); **2 publikáció** (2022: Fizioterápia 31(2), 3-10. és Value in Health
  Journal POSB337); konferencia-előadások (Magyar Sportrehabilitációs
  Konferencia 2025.11.02; ISPOR 2020 Milánó, 2021 Koppenhága; Kézsebész
  Társaság 29. Kongresszusa skill tréning instruktor 2023); **14 médiamegjelenés**
  (2021–2025). — https://www.kineticare.hu/rolunk
- **Kiss Kata:** GYÓGYTORNÁSZ, MANUÁLTERAPEUTA, SPORTREHABILITÁCIÓS TRÉNER
  (Semmelweis Egyetem gyógytornász; Barvicsenko-féle manuálterapeuta képzés);
  33 tételes tanfolyamlista (2019–2026, köztük Tendon Transfer Training 2026,
  Ian Gatt-csuklókurzus 2026, Aspetar 2025); konferencia-előadás („Ulnáris
  oldali csuklófájdalmak", 2025.11.02); publikáció-szekciója NINCS;
  1 médiamegjelenés (Nők Lapja 2023/34). — https://www.kineticare.hu/rolunk
- **Tagságok:** Magyar Sportrehabilitációs Egyesület és Magyar
  Gyógytornász-Fizioterapeuták Társasága. Díj/kitüntetés egyik oldalon sem
  szerepel. — https://www.kineticare.hu/rolunk
- **Semmelweis-hivatkozás:** „A Semmelweis Egyetemen a jövő gyógytornászai az
  egyetemi képzésükön többek között a mi anyagunkból is tanulnak." —
  https://www.kineticare.hu/rolunk
- **Vélemények — összesen 26 nevesített:** kezdőlap 7 (Garami Gábor, Kállai
  Dóra, Kunfalvi Lili, Bagdal Szilvia, Dr. Sitku Lili, Hámori Lili, Dr. Kárpáti
  Katalin) · `/rolunk` 2 (Varró Barbara, Takács Mátyás) · `/szolgaltatasok` 2
  (Konda Boglárka, Tarba Patrícia) · `/kezrehab` 15 (10 monogramos + 5 teljes
  nevű: Szegedi Márton, Pályi Csaba, Kiss-Szabó Eszter, Szilágyi Attila,
  Varga Brigitta). — https://www.kineticare.hu/ , https://www.kineticare.hu/rolunk ,
  https://www.kineticare.hu/szolgaltatasok , https://www.kineticare.hu/kezrehab
- **16 partner** a `/rolunk` oldalon (Magyar Sportrehabilitációs Egyesület,
  ProBody Stúdió, Aurora Medical, DYNAMIC TAPE®, TUDATEST, PhysioWatch, WIBBI,
  Halm Optika, dr. pharm. Kocsis Kristóf, Csillik Árpád, NISHI STUDIO pilates,
  BodyGPS, Magic Smile, Be Fit With Ben, OrtoCare, Pille Fizioterápia). —
  https://www.kineticare.hu/rolunk
- A szakmai képzés „TOVÁBB" gombja külső oldalra mutat:
  https://probodystudio.hu/kez-workshop/ — https://www.kineticare.hu/rolunk

**Cáfolat-körben megcáfolt / pontosított:** (megcáfolt állítás nem volt)

- Tanfolyam-darabszámok pontosítva: Kocsis Kata 38 tétel (37 évszámos + 1
  évszám nélküli), Kiss Kata 33 tétel; az „Ian Gatt csuklókurzusok" egyetlen
  kétrészes tétel. — https://www.kineticare.hu/rolunk
- A „7 db Nők Lapja cikk" pontos bontása: 6 db „Nők Lapja" + 1 db „Nők Lapja
  Egészség Különszám" + 1 db „Nők Lapja Évszakok" (Nők Lapja-márkájú összesen 8);
  az összesen 14 médiamegjelenés stimmel. — https://www.kineticare.hu/rolunk
- A kezdőlapi sajtólogó-lista a kép-fájlnevekből származik (noklapja.png,
  karc.png, hazipatika.png, kepmas.png, ispor.png, mgyft.png), renderelt
  alt-szöveg nincs; a logók vizuális tartalma NEM ELLENŐRIZHETŐ. —
  https://www.kineticare.hu/
- A kezdőlapi vélemény-címsor-attribúciós probléma csak az első blokkra áll:
  a „Kötelezővé tenném mindenkinek…" címsor Garami Gábor véleménye felett áll,
  de a mondat szó szerinti forrása Varró Barbara `/rolunk`-beli véleménye;
  a második blokk címsora viszont valóban Hámori Lili szövegéből való. —
  https://www.kineticare.hu/ , https://www.kineticare.hu/rolunk

### 3.4 Jogi szövegek: ÁSZF, adatvédelem, impresszum

> **KÖTELEZŐ MEGJEGYZÉS:** ez a szakasz kizárólag a **meglévő régi szövegek hű
> feltárása**. Új jogi szöveget itt NEM fogalmazunk — az új ÁSZF, adatvédelmi
> tájékoztató és impresszum megírása, valamint minden alábbi feszültség
> feloldása **ügyvédi felülvizsgálatot igényel**. Az idézetek betűhű pontossága
> a WebFetch-kivonatolás miatt nem garantált: az ügyvédnek átadandó végső
> szövegforrás a **böngészőből mentett eredeti oldal** legyen.

**Megerősített tények** (a cáfolat-kör mind a 38 megállapítást igazolta):

- **Cégadatok:** KINETICARE Korlátolt Felelősségű Társaság · 8360 Keszthely,
  Kacsóh Pongrác utca 1. 2a. ép. · cégjegyzékszám 20-09-079468 (Zalaegerszegi
  Törvényszék Cégbírósága) · adószám 32697865-1-20 · hivatalos e-mail mindhárom
  jogi dokumentumban: egeszsegmozgastamogatas@gmail.com. —
  https://www.kineticare.hu/impresszum , https://www.kineticare.hu/aszf ,
  https://www.kineticare.hu/adatvedelem
- Az ÁSZF-ben a képviselő: **Kiss Kata ügyvezető**. Az impresszumban képviselő
  neve, telefonszám, kamarai tagság, engedélyszám NEM szerepel. —
  https://www.kineticare.hu/aszf , https://www.kineticare.hu/impresszum
- **Tárhelyszolgáltató:** Tárhely.Eu Kft., 1144 Budapest, Ormánság utca 4.
  X. em. 241., +36 1 789-2-789, support@tarhely.eu. (Nálunk Railway — az
  impresszum tárhely-szakasza újraírandó; a döntés az ügyvédé/tulajdonosé.) —
  https://www.kineticare.hu/impresszum
- **ÁSZF-szerkezet:** 13 szakasz (1. Bevezetés … 8. Elállási jog kizárása … 13. Vegyes rendelkezések); tárgya: online ismeretterjesztő kurzusok — SOS
  Kézrelax, Otthoni KézRehab, Online KÉZ Kurzus Szakembereknek. —
  https://www.kineticare.hu/aszf
- **Fizetés/számlázás:** kizárólag bankkártyás, egyszeri, a STRIPE felületén
  (5.1, 5.4); számla a Számlázz.hu-n keresztül, e-mailben, **27%-os
  áfatartalommal** (5.8). — https://www.kineticare.hu/aszf
  _Eldöntve 2026-09-24: a cég alanyi adómentes, a számla AAM kulccsal, áfa
  nélkül megy ki; az ÁSZF áfa-mondata ennek megfelelően megváltozott._
- **Hozzáférés:** három hónapra garantált, utána a KINETICARE belátása szerint
  (2.7). — https://www.kineticare.hu/aszf
- **Elállás/visszatérítés:** elállási jog kizárva (8. szakasz, 45/2014. Korm. r. 29. §; 2.8: a megrendeléssel a vásárló tudomásul veszi elállási jogának
  elvesztését); 13.1: fizetés után pénzvisszafizetés nem kérhető. Az ÁSZF-ben
  semmilyen 30 napos garancia nem szerepel. — https://www.kineticare.hu/aszf
- **Panasz/jogorvoslat:** e-mailben vagy postai úton, válasz legkésőbb 30 napon
  belül (11.1); Budapesti Békéltető Testület (1016 Budapest, Krisztina krt. 99.,
  tel. 488-2131, bekelteto.testulet@bkik.hu; postacím 1253 Budapest, Pf.: 10.,
  fax 488-2186 — 11.2.1); kormányhivatali fogyasztóvédelem (11.2.2);
  EU ODR: http://ec.europa.eu/odr (11.2.3). — https://www.kineticare.hu/aszf
- **Egészségügyi felelősségkizárás (3. szakasz):** a videók tájékoztató
  jellegűek, nem egészségügyi szolgáltatások és azokat nem helyettesítik;
  használat saját felelősségre; a KINETICARE orvostechnikai eszköz gyártóktól
  független (3.3). — https://www.kineticare.hu/aszf
- **Szellemi tulajdon (4. szakasz):** szerzői jogi védelem, jogsértésenként
  2 500 000 Ft kötbér + ezt meghaladó kár is követelhető. —
  https://www.kineticare.hu/aszf
- **Hibás teljesítés / kellékszavatosság (9–10. szakasz):** kijavítás/kicserélés,
  arányos árleszállítás vagy elállás; hibajelzés **10 napon belül**; **kétéves
  elévülési határidő** (korábban nem ellenőrizhető tételek, most szó szerint
  igazolva). — https://www.kineticare.hu/aszf
- **Vegyes (13. szakasz):** magyar jog, kizárólagos magyar bírósági joghatóság,
  egyoldalú ÁSZF-módosítás joga fenntartva; kelt: 2025. 05. 05. —
  https://www.kineticare.hu/aszf
- **Adatvédelem:** adatkezelő a KINETICARE Kft. (telefon: +36301692263);
  a hatókör kifejezetten kizárja Kiss Kata és Kocsis Kata egyéni vállalkozók
  egészségügyi szolgáltatását. Vásárlási adatkezelés (2.1): szerződés +
  számviteli kötelezettség jogalap; kezelt adatok közt „bankkártya adatai,
  bankszámlaszám"; megőrzés 5 év, bizonylatokra 8 év. Fiók (2.2): hozzájárulás,
  törlésig. Hírlevél (2.4): jogalapja „A KINETICARE jogos érdeke" (nem
  hozzájárulás), tiltakozás indokolás nélkül. Panaszkezelés (2.5): Fgytv.
  17/A. §, megőrzés 3 év + következő év május 31. Adatfeldolgozók csak
  kategóriánként (név szerint: Stripe, Google, Tárhely.Eu, Barion, Számlázz.hu
  EGYIKE SEM szerepel). Nincs harmadik országba továbbítás. Érintetti jogok +
  30 napos válaszhatáridő. NAIH: 1055 Budapest, Falk Miksa utca 9-11. Sütik:
  4 kategória, banner-hozzájárulás, konkrét sütilista NINCS. Kelt: 2025. 05. 05. —
  https://www.kineticare.hu/adatvedelem
- **Lábléc minden jogi oldalon:** „Kapcsolat: info@kineticare.hu" + 3 jogi link
  - „© 2025 Kineticare, minden jog fenntartva". — https://www.kineticare.hu/impresszum

**Cáfolat-körben megcáfolt / pontosított:** (megcáfolt állítás nem volt)

- A 8.1 beleegyezés-triggere a szöveg szerint a **megrendelés/nyilatkozat**
  („kifejezett, előzetes beleegyezésével kezdte meg"), nem szó szerint maga a
  fizetés; a jogkövetkezmény (elállási jog elvesztése) változatlan. —
  https://www.kineticare.hu/aszf
- A 11.1-ben a postai cím székhelyként való nevesítése nem igazolt (a szöveg
  csak „postai levélben"-t mond) — az eredeti teljes szövegből ellenőrizendő.
- A 13. szakasz egy szavánál átirat-bizonytalanság van („kizárósan" vs
  „kizárólag" joghatóság) — tartalmilag mindkettő kizárólagos magyar bírósági
  joghatóságot mond, de betűhű idézethez az eredeti HTML kell. —
  https://www.kineticare.hu/aszf
- A 2.1-ben a telefonszám „(fizetési mód függvényében)" megszorítással kezelt
  adat. — https://www.kineticare.hu/adatvedelem
- A 45/2014. Korm. rendelet explicit hivatkozása a 8.1-ben (elállás-kizárás)
  igazolt; a 2. szakaszbeli pontos hivatkozási hely az eredetiből ellenőrizendő.

**Az ügyvédnek jelzendő ténypárok** (nem jogi vélemény, csak a talált tények):

1. Sales-oldali 30 napos garancia ↔ ÁSZF 13.1 visszatérítés-tilalom (4. szakasz, 2. sor).
2. STRIPE (ÁSZF 5.4) ↔ nálunk Barion; Tárhely.Eu (impresszum) ↔ nálunk Railway;
   a Számlázz.hu (5.8) nálunk is stimmel.
3. Adószám áfakódja 1-es (32697865-1-20) ↔ ÁSZF 5.8 „27%-os áfatartalommal"
   (eldöntve 2026-09-24: alanyi adómentes, AAM) —
   könyvelővel tisztázandó.
4. Adatvédelem 2.1 „bankkártya adatai" kezelt adatként ↔ ÁSZF 5.4 szerint a
   fizetés a weboldaltól függetlenül, a STRIPE felületén történik.
5. Budapesti Békéltető Testület ↔ keszthelyi (Zala vármegyei) székhely.
6. Az adatvédelmi 2.5 pont cél-szövege elállási nyilatkozatról és „visszaküldött
   termék feldolgozásáról" szól (sablonmaradvány), miközben az ÁSZF az elállást
   kizárja és a termék digitális.
7. Gmail-cím (egeszsegmozgastamogatas@gmail.com) a jogi törzsszövegekben ↔
   info@kineticare.hu a láblécben.
8. Három dokumentum, három telefonállapot: ÁSZF +36203573493 · adatvédelem
   +36301692263 · impresszum nincs.

### 3.5 Elérhetőségek, helyszínek, szolgáltatás-menü

**Megerősített tények:**

- `/kapcsolat`: telefon **+36-30-169-2263** („A telefont a rendelőben nem mindig
  tudjuk felvenni, de amint lehet, visszahívunk."); e-mail **info@kineticare.hu**;
  válaszidő-ígéret „legkésőbb 2 munkanapon belül" (az e-mailekre/üzenetekre
  vonatkozik, telefonra nem); üzenetküldő űrlap adatkezelési checkboxszal +
  ELKÜLDÖM gomb. — https://www.kineticare.hu/kapcsolat
- **Két helyszín:** 1117 Budapest, Nádorliget u. 7/b és 1114 Budapest,
  Fadrusz utca 15., mindkettő Google Maps beágyazással. Nyitvatartás,
  megközelítés, parkolás sehol nem szerepel. — https://www.kineticare.hu/kapcsolat
- **Online időpontfoglaló NINCS** — a HTML-beli „Foglalási naptár"/„Foglalások"
  sztringek a systeme.io platform lokalizációs szótárából valók, nem megjelenített
  modul. — https://www.kineticare.hu/kapcsolat
- **Lemondási szabályzat** szó szerint azonos mindkét rendelői oldalon:
  „24 órán belüli lemondás esetén a díj teljes összegét megfizeti a szolgáltató
  által kiállított számla alapján". — https://www.kineticare.hu/rendeloi-kezelesek ,
  https://www.kineticare.hu/rendeloi-kezelesek-regi
- **Rendelői árlista (élő):** 50 perces alkalom 18 000 Ft, 20 perces 10 000 Ft
  (mindkettő tartalmazza szükség szerint a tape/flossing/köpöly/eszközös
  kezeléseket); első alkalom mindig 50 perces vizsgálat; készpénz és átutalás. —
  https://www.kineticare.hu/rendeloi-kezelesek
- **Rendelői menü:** GYÓGYTORNA · MANUÁLTERÁPIA · KIEGÉSZÍTŐ TERÁPIÁK; a terápia
  alapja egyéni mozgásprogram + manuálterápia; az otthoni programot egyénre
  szabott gyakorlatokat tartalmazó alkalmazás segíti. Manuálterápia-indikációk
  (élő oldal): deréktáji fájdalmak, porckorong, mozgástartomány-csökkenés,
  végtagzsibbadás/sugárzó fájdalom, nyak/vállöv, szédülés/fejfájás egyes fajtái,
  tartós ízületi fájdalmak (könyöktáji-, csuklóízületi, váll), ínbántalmak
  (teniszkönyök, golfkönyök). — https://www.kineticare.hu/rendeloi-kezelesek
- **Kiegészítő terápiák — 8 tétel** mindkét rendelői oldalon: Dynamic Tape®,
  Kinezio Tape, Flossing, Köpölyterápia, Fasciakés, Eszközök, Hegkezelés,
  NRX® („átmenet a kinesiotape és az ortézisek között"); kiemelt megkötés:
  önmagukban nem, csak mozgásprogrammal együtt eredményesek. —
  https://www.kineticare.hu/rendeloi-kezelesek
- **Szolgáltatás-menü (4 elem):** Rendelői kezelések → /rendeloi-kezelesek ·
  Online kurzus → /kezrehab · Szakmai képzések (akkreditált tantermi képzés,
  12 kreditpont, SZTK-A-33553/2024) → https://probodystudio.hu/kez-workshop/ ·
  SOS KézRelax → /kezrelax. — https://www.kineticare.hu/szolgaltatasok
- **Közösségi média** (csak a /kapcsolat oldalon, ikonként):
  https://www.instagram.com/kineticare_hu/ és
  https://www.facebook.com/groups/kineticareotthonikezrehab/ ;
  YouTube/TikTok/LinkedIn sehol. — https://www.kineticare.hu/kapcsolat
- **Lábléc** minden bejárt oldalon azonos mag: info@kineticare.hu + 3 jogi link
  - © 2025; **navigáció:** SZOLGÁLTATÁSOK · RÓLUNK · KAPCSOLAT. —
    https://www.kineticare.hu/
- A `/rendeloi-kezelesek` alján SOS KézRelax kereszt-promóció („KÉREM A
  PROGRAMOT" → /kezrelax); a `-regi` oldalon ez nincs, helyette „Ingyenes
  videó — Lazítsd el a nyakadat 5 perc alatt" e-mail-gyűjtő popup. —
  https://www.kineticare.hu/rendeloi-kezelesek ,
  https://www.kineticare.hu/rendeloi-kezelesek-regi

**Cáfolat-körben megcáfolt / pontosított:**

- **MEGCÁFOLVA:** „egyetlen, nem személyhez kötött rendelői telefonszám van".
  **Helyesen:** két telefonszám van, mindkettő személyhez kötött — a `/rolunk`
  oldalon „Kocsis Kata +36301692263" és „Kiss Kata +36203573493"; az ÁSZF
  hivatalos száma a +36203573493. A `/kapcsolat` csak Kocsis Kata számát közli,
  ott név nélkül. — https://www.kineticare.hu/rolunk , https://www.kineticare.hu/aszf ,
  https://www.kineticare.hu/kapcsolat
- **MEGCÁFOLVA:** „hogy a szám melyik gyógytornászé, NEM ELLENŐRIZHETŐ" —
  igenis ellenőrizhető: a +36-30-169-2263 Kocsis Katáé. —
  https://www.kineticare.hu/rolunk
- **MEGCÁFOLVA:** „a főoldalon a telefonszám a rendelőhöz van rendelve" —
  a főoldalon egyáltalán nincs telefonszám; közös elérhetőség csak az
  info@kineticare.hu. — https://www.kineticare.hu/
- Pontosítás: a `-regi` oldal „Ingyenes nyaklazító gyakorlat feliratkozó oldal"
  címe csak `<title>`/SEO-érték, nem látható felirat; az élő és a régi rendelői
  oldal az árlista-percek MELLETT az indikáció-listában is eltér, és a régi
  oldalról hiányzik a KézRelax-kereszt-promóció.
- Pontosítás: a sitemap-körben egy második kapcsolati e-mail is él:
  egeszsegmozgastamogatas@gmail.com (a jogi oldalak törzsszövegében) —
  migrációnál ez is számít. — https://www.kineticare.hu/aszf

---

## 4. Ellentmondások táblázata

| #   | Ellentmondás                                                                                                                                                                             | A vs B forrás                                                                                                                                      | Miért számít nekünk                                                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Kettős élő ár:** ugyanaz a termék 79 500 és 39 700 Ft-on fut egyszerre (mindkét pricePlan 2025-03-06-i, `removedAt: null` — tartós, nem időszakos)                                     | https://www.kineticare.hu/kezrehab + /kezrehab-penztar vs https://www.kineticare.hu/kezrehab-akcio + /oto-kezrehab-akcio + /kezrehab-akcio-penztar | Az új oldalon egyetlen, konzisztens ár kellhet; Omnibus-szabály (E4–E5); a régi URL-ek indexeltek                                                            |
| 2   | **30 napos „kérdés nélküli" garancia** a sales-oldalakon vs **ÁSZF 13.1: pénzvisszafizetés nem kérhető** + elállási jog kizárva (8.1, 2.8)                                               | https://www.kineticare.hu/kezrehab (és a 2 akciós oldal) vs https://www.kineticare.hu/aszf                                                         | Fogyasztóvédelmi kockázat; az új ÁSZF-be a garancia vagy bekerül, vagy a marketingből törlendő (Ny3, E2) — ügyvédi döntés                                    |
| 3   | **Hozzáférési idő hármas ellentmondása:** „örökké"/„egy életre szóló" vs „hivatalosan minimum egy évig" vs „három hónapra garantált"                                                     | https://www.kineticare.hu/kezrehab (+2 akciós) vs https://www.kineticare.hu/kezrelax vs https://www.kineticare.hu/aszf (2.7)                       | Nálunk az `accessDurationDays` a mérvadó — egységesen azt kell kiírni (E3)                                                                                   |
| 4   | **119 000 Ft megjelenítése eltér:** a fő oldalon NEM áthúzva („Értéke: … de most csak"), az akciósokon `<s>`-sel áthúzva                                                                 | https://www.kineticare.hu/kezrehab vs https://www.kineticare.hu/kezrehab-akcio , /oto-kezrehab-akcio                                               | A látogató URL-től függően mást lát „aktuális árnak"; áthúzott ár csak valós korábbi árral jogszerű (Ny4)                                                    |
| 5   | **Rendelői árlista:** 50/20 perc vs 55/25 perc azonos árakon (első alkalom 50 vs 55 perc)                                                                                                | https://www.kineticare.hu/rendeloi-kezelesek vs https://www.kineticare.hu/rendeloi-kezelesek-regi                                                  | A régi oldal élőben elérhető (HTTP 200) — migrációnál el kell dönteni, melyik hatályos, és a régit lekapcsolni/átirányítani                                  |
| 6   | **Manuálterápia-indikációk eltérnek:** könyök/csukló vs csípő/térd + Achilles                                                                                                            | https://www.kineticare.hu/rendeloi-kezelesek vs https://www.kineticare.hu/rendeloi-kezelesek-regi                                                  | Az élő verzió kéz-fókuszra szűkített — az új oldalra az élő lista való                                                                                       |
| 7   | **Páciensszám:** „ezernél is több" (régi oldal) vs „5000+ elégedett páciens" (új oldal `about` blokk)                                                                                    | https://www.kineticare.hu/kezrehab , https://www.kineticare.hu/kezrelax vs a mi seedünk                                                            | Kitalált statisztika fogyasztóvédelmi kockázat (E16); az alátámasztható szám az 1000+ (Ny7)                                                                  |
| 8   | **Telefonszám három állapotban:** ÁSZF +36203573493 · adatvédelem +36301692263 · impresszum nincs                                                                                        | https://www.kineticare.hu/aszf vs https://www.kineticare.hu/adatvedelem vs https://www.kineticare.hu/impresszum                                    | Az új jogi oldalakon egységes, tudatosan választott hivatalos szám kell                                                                                      |
| 9   | **E-mail-kettősség:** egeszsegmozgastamogatas@gmail.com (jogi törzsszövegek) vs info@kineticare.hu (lábléc)                                                                              | https://www.kineticare.hu/impresszum , /aszf , /adatvedelem (törzs vs lábléc)                                                                      | Az új jogi oldalakra a márkás cím való (E7) — ügyvédi jóváhagyással                                                                                          |
| 10  | **Manuálterapeuta cím:** a közös szövegek mindkét alapítóra állítják, a CV-fejlécekben csak Kiss Katánál szerepel (Kocsis Katánál csak I. részes lágyrész-manuálterápia tanfolyam)       | https://www.kineticare.hu/ , /kezrehab (közös szövegek) vs https://www.kineticare.hu/rolunk (CV-k)                                                 | Szakmai hitelesség-állítás — az új oldalon csak a CV-vel alátámasztható titulus írható ki                                                                    |
| 11  | **KézRelax „vételár-visszatérítés":** ár nélküli, pricePlan nélküli oldalon vételár-visszatérítő garancia-szöveg áll                                                                     | https://www.kineticare.hu/kezrelax (önmagában)                                                                                                     | Sablonmaradvány-gyanú; ingyenes termékhez a szöveg nem vihető át                                                                                             |
| 12  | **KézRelax „3 gyakorlat" vs 8 témás lista** (benne legalább 4 gyakorlat-téma)                                                                                                            | https://www.kineticare.hu/kezrelax (alcím + GYIK vs témalista)                                                                                     | Az új termékleírásban a számokat egyértelműsíteni kell (a leltár 7. szakaszának 2. pontja)                                                                   |
| 13  | **STRIPE + Tárhely.Eu a régi oldalon** vs Barion + Railway nálunk                                                                                                                        | https://www.kineticare.hu/aszf , https://www.kineticare.hu/impresszum vs a mi stackünk                                                             | E1/E8: minden fizetési/tárhely-hivatkozás cserélendő az új jogi szövegekben — ügyvédi feladat                                                                |
| 14  | **Adószám 1-es áfakódja vs „27%-os áfatartalommal" számlázás**                                                                                                                           | https://www.kineticare.hu/impresszum vs https://www.kineticare.hu/aszf (5.8)                                                                       | Eldöntve 2026-09-24 (tulajdonos): a cég alanyi adómentes, a számla AAM kulccsal, áfa nélkül megy ki; az ÁSZF áfa-mondata ennek megfelelően megváltozott      |
| 15  | **Adatvédelem 2.1 „bankkártya adatai" kezelt adatként** vs ÁSZF 5.4: fizetés a weboldaltól függetlenül, a STRIPE felületén                                                               | https://www.kineticare.hu/adatvedelem vs https://www.kineticare.hu/aszf                                                                            | Az új tájékoztatóban a ténylegesen kezelt adatkör pontosítandó (Barion-folyamathoz igazítva) — ügyvédi feladat                                               |
| 16  | **Budapesti Békéltető Testület** vs keszthelyi (Zala vármegyei) székhely                                                                                                                 | https://www.kineticare.hu/aszf vs https://www.kineticare.hu/impresszum                                                                             | Az illetékes testület megjelölése az új ÁSZF-ben ügyvédi kérdés                                                                                              |
| 17  | **Adatvédelem 2.5 sablonszöveg:** elállási nyilatkozat + „visszaküldött termék feldolgozása" — miközben az ÁSZF az elállást kizárja és a termék digitális                                | https://www.kineticare.hu/adatvedelem vs https://www.kineticare.hu/aszf                                                                            | Sablonmaradvány — az új tájékoztatóba nem kerülhet át                                                                                                        |
| 18  | **Akkreditált képzés célcsoportja háromféleképpen** („mozgásterapeuták" csak egy helyen)                                                                                                 | https://www.kineticare.hu/szolgaltatasok vs https://www.kineticare.hu/ vs https://www.kineticare.hu/rolunk                                         | Az új oldalon egyetlen, pontos célcsoport-megfogalmazás kell                                                                                                 |
| 19  | **Vélemény-címsor attribúció:** a kezdőlapi „Kötelezővé tenném…" címsor Garami Gábor felett áll, de a mondat Varró Barbara véleményéből való                                             | https://www.kineticare.hu/ vs https://www.kineticare.hu/rolunk                                                                                     | Vélemény-idézet máshoz rendelése hitelességi kockázat — az új oldalon idézet csak a saját szerzőjével                                                        |
| 20  | **Írásmód:** „Barvincsenko-féle" (Kocsis Kata CV) vs „Barvicsenko-féle" (Kiss Kata CV) ugyanazon az oldalon                                                                              | https://www.kineticare.hu/rolunk (két CV)                                                                                                          | Az átvett CV-szövegben az egyik elírás — a helyes írásmódot a tulajdonossal kell tisztázni                                                                   |
| 21  | **Visszaszámlálók viselkedése eltér:** `/kezrehab-akcio` lejáratkor semmi (`action: nothing`) vs `/oto-kezrehab-akcio` lejáratkor átirányít a teljes árú oldalra (`action: redirection`) | https://www.kineticare.hu/kezrehab-akcio vs https://www.kineticare.hu/oto-kezrehab-akcio                                                           | A leltár 2.8 pontját javítja („visszaszámláló egyiken sincs" — téves); mindkettő látogatónkénti delay, nem valós határidő — dark-pattern-minta, nem átveendő |

---

## 5. Válaszok a leltár nyitott kérdéseire (6. szakasz, Ny1–Ny9)

### Ny1 — Kapjon-e a Products entitás blokk-alapú `layout` mezőt?

**NEM DERÜL KI** — architekturális döntés, a régi oldal kutatása nem dönti el.
Amit a kutatás hozzátesz: a régi `/kezrehab` oldalon a döntést támogató elemek
pontos, igazolt leltára — 15 nevesített vélemény (10 monogramos + 5 teljes nevű,
fényképes), 3 GYIK-kérdés, 3 bónusz-kártya értékkel („29.900.-" / „19.900.-" ×2),
kiemelt garancia-blokk, 9+6 tételes „kinek jó / kinek nem" lista, 4 modul —
mindez a https://www.kineticare.hu/kezrehab oldalon. A döntés a vezetőé.

### Ny2 — SOS KézRelax: 0 Ft-os webshop-termék maradjon, vagy e-mailes lead-magnet?

**RÉSZBEN.** A ténykérdés lezárva: a régi modell **e-mailes opt-in** volt —
a https://www.kineticare.hu/kezrelax oldalon nincs ár (0 találat), a beágyazott
konfigban nincs pricePlan, az űrlap Keresztnév + Email mezős, a gombok
(„KÉREM A VILLÁMKURZUST" stb.) űrlapra visznek. Maga a döntés (melyik modell
legyen nálunk) üzleti kérdés, nyitva marad. Fontos mellék-lelet: az oldalon
„vételár-visszatérítést" ígérő garancia-szöveg maradt („100% boldogság
garancia"), ami ár nélküli termékhez nem vihető át.

### Ny3 — A 30 napos garancia marad?

**RÉSZBEN.** A ténykérdés lezárva: az ellentmondás valós és éles — a garancia
szövege betűre azonos mindhárom sales-oldalon
(https://www.kineticare.hu/kezrehab , /kezrehab-akcio , /oto-kezrehab-akcio),
miközben az ÁSZF 13.1 minden pénzvisszafizetést kizár és a 8.1/2.8 az elállási
jog elvesztését rögzíti (https://www.kineticare.hu/aszf). A kettő együtt nem
másolható át. A döntés (marad-e a garancia, és ha igen, az új ÁSZF-be írva)
a tulajdonosé + ügyvédé. Külön figyelem: a KézRelaxon egy MÁSIK konstrukció él
(határidő nélküli „100% boldogság garancia" — https://www.kineticare.hu/kezrelax).

### Ny4 — A 119 000 Ft „eredeti ár" valós?

**NEM DERÜL KI.** A 119 000 Ft mint érték-horgony mindhárom sales-oldalon
létezik (a fő oldalon nem áthúzva, az akciósokon áthúzva — URL-ek a 2.2
táblázatban), de arra, hogy a program **valaha ténylegesen ennyiért volt
kapható**, az élő oldalon nincs bizonyíték: a pénztár-konfigokban csak a
79 500-as és 39 700-as pricePlan létezik (mindkettő 2025-03-06-tól), 119 000-es
pricePlan-nek nincs nyoma. Webarchívum (Wayback) nem lett vizsgálva — ha a
kérdést le kell zárni, az a következő lépés; addig az áthúzott 119 000
Omnibus-kockázat (E5), és a mi `kezrehabLongDescription()`-ünkben is bent van.

### Ny5 — A Dream Team partnerkuponok (~100 000 Ft) élnek még?

**NEM DERÜL KI.** Az oldalakon csak az összérték-állítás szerepel („közel
100.000 Ft értékben találsz kuponokat és ajándékokat" — mindhárom sales-oldalon
azonosan, pl. https://www.kineticare.hu/kezrehab) és a szakterület-kategóriák;
tételes kuponlista, partnerenkénti kedvezmény vagy érvényesség nem látható.
Csak a tulajdonos tudja megválaszolni. (Ugyanez áll a 3 bónusz feltüntetett
értékére — E6.)

### Ny6 — Az akkreditáció (SZTK-A-33553/2024, 12 kredit) érvényes 2026-ban?

**RÉSZBEN.** Az oldal szerint a képzés 2026-ban is fut: mindkét alapító
CV-jében az SZTK-A-33553/2024 számú akkreditált kurzus alatt szerepel
„(2026, Budapest) - instruktor" bejegyzés (https://www.kineticare.hu/rolunk),
és a szám a /szolgaltatasok oldalon is él. A **formális akkreditációs
érvényesség** azonban a weboldalról nem igazolható — hatósági nyilvántartásban
(SZTK) vagy a ProBody-nál kell ellenőrizni, mielőtt az új oldalra kikerül.

### Ny7 — „5000+ elégedett páciens" vagy „több mint ezer ember"?

**VÁLASZ: a régi oldalról kizárólag az 1000+ támasztható alá.** A teljes bejárt
körben két számszerű páciens-állítás létezik: „…ezernél is több embernek
segítettünk…" (https://www.kineticare.hu/kezrehab — a szöveg az azonos törzsű
akciós oldalakon is így áll) és „…több, mint ezer embernek segítettünk…"
(https://www.kineticare.hu/kezrelax , a garancia-szövegben). A kezdőlapon, a
/rolunk és a /szolgaltatasok oldalon célzott kereséssel semmilyen páciensszám
nincs; **5000-es szám sehol nem fordul elő**. Az új oldal „5000+" állítása vagy
törlendő/lecserélendő „több mint ezer"-re, vagy a tulajdonosnak kell külső
bizonyítékkal alátámasztania (E16: kitalált statisztika fogyasztóvédelmi kockázat).

### Ny8 — Kell-e „hamarosan / értesíts, ha elindul" funkció?

**NEM DERÜL KI** — üzleti döntés. A kutatás tényei: a https://www.kineticare.hu/hamarosan
él, konkrét dátum nélkül, a feliratkozásért „extra kedvezményes ajánlatot"
ígér, „ami a nagyközönségnek nem lesz meghirdetve"; tananyag-, garancia- vagy
hozzáférés-adatot nem tartalmaz. A leltár UX-figyelmeztetése (mesterséges
exkluzivitás — csak akkor másolható, ha igaz) továbbra is áll.

### Ny9 — Kell-e 301-átirányítási térkép a régi URL-ekről?

**NEM DERÜL KI** (döntés), de a kutatás a szükségességét támogató tényeket
adott: a régi funnel-URL-ek MIND élnek és elérhetők — a `/rendeloi-kezelesek-regi`
is HTTP 200-zal (https://www.kineticare.hu/rendeloi-kezelesek-regi), a két akciós
oldal a 39 700 Ft-os árral, az eltérő árlisták és indikáció-listák kereső/látogató
számára egyaránt megtalálhatók. Átirányítás (vagy lekapcsolás) nélkül a
domain-átállás után az ellentmondó oldalak tovább élnének. A döntés és a
konkrét térkép a vezetőé.

### Kiegészítés: a leltár 7. szakaszának időközben lezárt pontjai

- **7/1 — a régi pénztároldalak ára:** most már ismert a beágyazott systeme.io
  konfigból: 7950000 ill. 3970000 kisegység (= 79 500 / 39 700 Ft 1/100-as
  értelmezéssel), HUF, one_shot. — https://www.kineticare.hu/kezrehab-penztar ,
  https://www.kineticare.hu/kezrehab-akcio-penztar . A fizetési felület renderelt
  képe és a végösszeg továbbra is NEM ELLENŐRIZHETŐ (6. szakasz).
- **7/5 — a /kezrelax opt-in űrlap mezői:** ismertek: Keresztnév + Email
  placeholderű mezők. — https://www.kineticare.hu/kezrelax
- **7/2 — SOS KézRelax videószám:** továbbra sem derül ki (a „3 gyakorlat" vs
  8 téma ellentmondás rögzítve, 4. szakasz 12. sor).

---

## 6. NEM ELLENŐRIZHETŐ tételek

Ami a teljes kutatási és cáfolat-kör után is nyitva maradt — ezekre találgatni tilos:

**Árazás:**

1. Szerepelt-e valaha 59 500 Ft-os (valódi fél)ár vagy 119 000 Ft-os tényleges
   eladási ár — webarchívum (Wayback) nem lett vizsgálva.
2. A pénztár-oldalak böngészőben renderelt VÉGÖSSZEGE (`taxBehavior: exclusive`
   mellett számol-e rá a felület áfát a 79 500/39 700-ra) — tranzakció/böngésző
   nélkül nem megállapítható. — https://www.kineticare.hu/kezrehab-penztar ,
   https://www.kineticare.hu/kezrehab-akcio-penztar
3. Melyik funnel kap aktívan hirdetési forgalmat.
4. A 119 000 Ft vizuális megjelenése a `/kezrehab` oldalon (a HTML-ben nincs
   `<s>` és nem található line-through, de a teljes CSS-kaszkád nem futott le).
5. A visszaszámlálók renderelt viselkedése böngészőben (a delay/redirection
   konfigból olvasott, a „látogatónként újrainduló" viselkedés a systeme.io
   szemantikájából következtetett).

**Tananyag:**

6. Össz-játékidő és a videók pontos darabszáma (csak „4 modul", „50+", „5 perces
   miniblokkok" szerepel). — https://www.kineticare.hu/kezrehab
7. A bónusz minikurzusok videó-/gyakorlat-darabszáma.
8. Az SOS KézRelax videóinak darabszáma és végleges ingyenes/fizetős státusza
   (a popup-folyamat nem lett böngészőben végigfuttatva). — https://www.kineticare.hu/kezrelax
9. A Dream Team kuponok tételes tartalma (mely szakemberek, mekkora kedvezmény).
10. A privát Facebook-csoport neve/elérése (csak említés van). — https://www.kineticare.hu/kezrehab

**Hitelesség:**

11. A `/rolunk` képi (fényképes) vélemény-galéria szövegei. — https://www.kineticare.hu/rolunk
12. A partner- és sajtólogók vizuális tartalma (a listák kép-fájlnevekből
    származnak). — https://www.kineticare.hu/ , https://www.kineticare.hu/rolunk
13. Az akkreditáció formális 2026-os érvényessége (hatósági nyilvántartásban
    ellenőrizendő — Ny6).

**Jogi:**

14. Az ÁSZF és az adatvédelmi tájékoztató **betűhű, teljes szövege** — a
    WebFetch kivonatoló modellen keresztül dolgozik; az ügyvédnek átadandó végső
    forrás a böngészőből mentett eredeti oldal. (Konkrét ismert bizonytalanság:
    „kizárósan" vs „kizárólag" a 13. szakaszban.) — https://www.kineticare.hu/aszf
15. Az adatfeldolgozók név szerinti listája (az oldal szerint kérésre adják ki). —
    https://www.kineticare.hu/adatvedelem
16. A süti-banner tényleges viselkedése és a konkrét sütilista (JS-ből töltődik). —
    https://www.kineticare.hu/adatvedelem
17. Az érintetti jogok „jogszabályi korlátozhatóságára" való figyelmeztetés
    megléte a tájékoztatóban (külön nem ellenőrzött). — https://www.kineticare.hu/adatvedelem
18. Az e-mailes visszaigazolás pontos tartalma és a 45/2014. Korm. rendelet
    szerinti tájékoztatások teljessége.

**Elérhetőség:**

19. Nyitvatartás — egyik oldalon sem szerepel.
20. Megközelítés/parkolás — csak Google Maps beágyazás van. —
    https://www.kineticare.hu/kapcsolat
21. Melyik terapeuta melyik helyszínen, mely napokon rendel.
22. A /kapcsolat űrlap beküldésének tényleges működése (hova érkezik az üzenet).

**Általános:**

23. JS-ből dinamikusan töltődő tartalmak — minden lekérés a statikus HTML-t
    vizsgálta; kliensoldali kiegészítések nem ellenőrizhetők.
