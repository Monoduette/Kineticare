# AUDIT-A: a meggyőző (belépő) oldalak UX + marketing/SEO átvizsgálása

**Dátum:** 2026. szeptember 7. · **Hatókör:** `/`, `/szolgaltatasok`, `/rolunk`, `/kapcsolat` ·
**Állapot:** `claude/website-updates-visual-fixes-q8azzj`, HEAD `4047460` (a tulajdonosi 3. kör
utáni állapot: alapítói szekció frízzel, sín kéz-ikonokkal és kártya-panellel, ingyenes SOS a
rácsban, süti-sáv, kártyagomb).

**Ez AUDIT.** Kódot, tesztet, CMS-tartalmat nem módosítottam, nem commitoltam.

---

## 0. Mit vizsgáltam és hogyan

**Mérőkörnyezet.** Helyi `next dev` a `http://localhost:3000`-en (Node 24, Postgres a
`127.0.0.1:5433`-on), Chromium 1194 playwright-core-ral. Szélességek: **1440×900**, **1024×768**,
**390×844**, **320×844**. Mozgás: `prefers-reduced-motion: reduce` és `no-preference`.
Minden szám a saját mérésemből való; kulcsszó-adat kizárólag a `docs/ADATOK-mert.md`-ből.

**Mérőszkriptek és nyers adat:** a session-scratchpad `audit-a/` mappája.

| Fájl                                                                        | Mit ad                                                                                                                                                                   |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `measure.mjs`                                                               | szekció-geometria, számított színek, kontrasztarány, betűméret, CTA-doboz, kép-adat, LCP, hajtás-lista (`KC_PATH` / `KC_NAME` környezeti változóval bármelyik útvonalra) |
| `focuswalk.mjs`                                                             | Tab-sorrend, fókuszjelölés minden elemen (60 ms utáni beállással)                                                                                                        |
| `sorhossz.mjs`                                                              | valódi karakter/sor mérés canvas `measureText`-tel, nem becslés                                                                                                          |
| `probe.mjs`, `text.mjs`, `form.mjs`, `pause.mjs`, `motion.mjs`, `faq.mjs`   | elem-geometria, teljes szöveg, űrlapmezők, marquee-vezérlő, animáció-lista, GYIK                                                                                         |
| `measure-<oldal>-<szélesség>-<mozgás>.json`                                 | 14 mérés-fájl                                                                                                                                                            |
| `*-1440.png`, `fold-*-390.png`, `s1440-*.png`, `r1440-*.png`, `k1440-*.png` | teljes oldalas és hajtás-képek, 1500 px-es szeletek                                                                                                                      |

**Módszer.** (1) Nielsen tíz heurisztikája
(<https://www.nngroup.com/articles/ten-usability-heuristics/>), (2) kognitív séta Kovácsné
personájával (`docs/felhasznaloi-seta.md`; NN/g:
<https://www.nngroup.com/articles/cognitive-walkthroughs/>), (3) mérés, (4) on-page SEO-audit a
`digital-marketing-mastery` skill `keyword-research-and-onpage-seo.md` 9. pontja szerint,
(5) helyi SEO a `link-building-and-local-seo.md` II. része szerint, (6) CRO a
`competitive-intelligence-and-analytics.md` 8. pontja szerint, (7) a `docs/ui-sztenderdek.md`
§3.2 CTA-szótár és a `docs/ertekesitesi-ux-skill.md` M1–M8 hierarchia összevetése a mérttel.

**Mért kiindulópont (ADATOK-mert + Monid 2026-09-07, runId `01M1YAXBEP1XC00TACAWHSRH7T`).**
A `kineticare.hu` a HU Semrush-adatbázisban 15 organikus kulcsszóra rangsorol, mind a 17–83.
pozíción, 0,00% forgalommal; a mért fő kifejezések (kéztőalagút szindróma, ínhüvelygyulladás,
teniszkönyök, csuklófájdalom, kéz zsibbadás) közül **egyre sem**. Backlink-profil: score 2,
9 hivatkozó domain (gyogytornaszom 36 / 570). **Következmény az egész auditra:** ezekre a
lapokra ma nem keresőből érkeznek, hanem közvetlenül, közösségi médiából vagy hirdetésből.
Ezért a **belépő meggyőzése és a konverziós út** a fő tét, az on-page alapok pedig nem
rangsor-taktikaként, hanem a jövőbeli fedezetként (és az AI-válaszok forrásaként) fontosak.

**Mérési megjegyzés.** Az LCP-időket a dev-szerverről vettem, ezek csak irányadók; a geometria,
a színek, a kontraszt és a DOM production buildben azonos. A `/rolunk` 1024 px-es futásán és a
`/` 390 px-es futásán egy-egy 34 s-os LCP-érték a dev-szerver képoptimalizálásából jött, nem az
oldalból.

---

## 1. A KEZDŐLAP: mi változott a 2026-09-07-i audit óta

A `docs/kezdolap-ux-audit-2026-09-07.md` találatait nem ismétlem. Az alábbi tábla **kizárólag
azt** mutatja, hogy az akkori mérésekhez képest ma mit mér a harnessz.

### 1.1 Szerkezeti változás

|                             | Régi (2026-09-07 audit)   | Ma mérve                             | Delta                                                 |
| --------------------------- | ------------------------- | ------------------------------------ | ----------------------------------------------------- |
| Szekciók száma              | 16                        | **15**                               | a fotó-fríz beolvadt az alapítói (`kc-about`) blokkba |
| Fríz + Rólunk               | 611 + 736 = 1347 px       | **854 px** (egy `kc-about kc-board`) | −493 px                                               |
| Oldalhossz 1440 reduce      | 10 974 px (12,2 képernyő) | **10 742 px (11,9 képernyő)**        | −232 px                                               |
| Oldalhossz 1440 mozgással   | 13 881 px                 | **13 650 px (15,2 képernyő)**        | −231 px                                               |
| Oldalhossz 390 reduce       | 14 299 px                 | **14 340 px (17,0 képernyő)**        | +41 px                                                |
| Oldalhossz 320              | 15 303 px                 | **15 528 px (18,4 képernyő)**        | +225 px                                               |
| Kurzuskártya                | 524×487 / 524×482         | **524×543 / 524×538**                | +56 px (belefért a gombfelirat)                       |
| Sín (`Így tudunk segíteni`) | 7158 px                   | **6823 px**                          | 335 px-szel feljebb, **továbbra is a 8. képernyőn**   |
| `Erre számíthatsz`          | 820 px, `#f6f9fc`         | **922 px, `#e6f0f8` tint**           | +102 px, háttér elkülönítve                           |

### 1.2 Amit a mérés szerint MEGOLDOTTAK

| Régi találat                                               | Ma mérve                                                                                                                                | Ítélet                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **P1-1** süti-sáv letakarja a hero gombjait mobilon        | 390×844: gombok 543–587 és 599–643 px, a sáv 660 px-nél kezdődik (**29 px rés**). 320×844: gombok 500–544 és 556–621, sáv 650 px-től.   | **javítva**, mindkét mobil szélességen                    |
| **P2-5** a kurzuskártyán nincs látható gomb                | mindkét kártya alján felirat: `Nyisd meg a kurzusoldalt` (fizetős) és `Elindítom ingyen` (ingyenes), a §3.2 #28 és #37 szerint          | **javítva**                                               |
| **P2-10** a nevek háromszor 600 px-en belül                | az alapítói blokk H2-je ma `Megérdemled a profi törődést`, a szövegben nincs név-ismétlés                                               | **javítva**                                               |
| **P2-7** (részben) az első hat szekció azonos háttéren     | ma: `#f6f9fc` ×5 (0–4090) → `#2f6e9f` SOS → `#f6f9fc` ×2 → **`#e6f0f8` → `#f4f8fd` → `#e6f0f8`** → `#f6f9fc` ×2 → `#e6f0f8` → `#f6f9fc` | **részben**, lásd 1.4/A                                   |
| **P3-6** a sín tételei tab-affordancia nélküli rádiócímkék | ma 351×80 px-es címke, 80×80-as jelölőben 40×40-es kéz-ikonnal, cím + alcím; a panel `1. ÚT` sorszámmal                                 | **javult**, a „választó" jelleg még mindig nincs kimondva |

### 1.3 Amit a mérés szerint NEM oldottak meg (változatlanul él)

| Régi találat                                              | Ma mért érték                                                                                                                                                                                |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1-2** a filmsáv mozgással 4,6 képernyő                 | mozgással 13 650 − 10 742 = **2908 px extra scrub**, a filmsáv `no-preference` alatt továbbra is ~4140 px (4,6 képernyő 1440-en, 4,6 mobilon)                                                |
| **P1-3** az ingyenes SOS három belépési ponttal           | változatlanul három: hero másodlagos gomb (**384×55**), kártya a rácsban (524×538), önálló sötétkék sáv **4090-től, 848 px**                                                                 |
| **P2-2** a hero nem mondja ki, hogy online videós program | a bevezető szó szerint azonos: „Professzionális, mégis emberközeli terápiás megoldásokkal…"; az „online", „videó", „Ft" szó az első képernyőn **nem fordul elő**                             |
| **P2-3** a hero címkéi gombnak látszanak                  | `Kéz` 50×43, `Csukló` 73×43, `Könyök` 77×43, `Váll` 52×43, mind `border-radius: 999px`, 1 px keret, `li`, nem fókuszálható                                                                   |
| **P2-4** a másodlagos hero-gomb erősebb az elsődlegesnél  | **384×55 vs 258×55** (49%-kal szélesebb), a cél változatlanul a `#ingyenes` horgony (reduce: 4090 px, mozgással 7017 px)                                                                     |
| **P2-8** a H3-ak akkorák, mint a H2                       | `Szakmai figyelem`, `Segítség a mindennapokhoz`, `Rendelői kezelések`: **39,9995 px**, azonos a H2-vel                                                                                       |
| **P2-11** öt szekció érvel ugyanarról                     | ma is öt: alapítói (854) + hitelcsík (113) + fájdalom (633) + Erre számíthatsz (**922**, nőtt) + sín (773)                                                                                   |
| **P3-2** a stat harmadik tétele nem szám                  | változatlanul `1 · közös cél: fájdalommentesség`                                                                                                                                             |
| **P3-3** a GYIK-válasz árat ígér link nélkül              | **ötből három** válasz nevez meg célt link nélkül: „…a kurzus oldalán találod", „A Kapcsolat oldalon megtalálod…", „A Kapcsolat oldalon elérsz minket". **A GYIK-ban egyetlen `<a>` sincs.** |
| **P2-6** a sajtólogó-sor felirata félrevezető             | `ITT TALÁLKOZHATTÁL VELÜNK` alatt továbbra is ott a MGYFT, a MASE és a Magyar Kézsebész Társaság (tagságok, nem médiamegjelenések)                                                           |
| **P3-4** a sín gombja `Tovább a kezelésekre`              | változatlan; a §3.2 #40 normatív alakja `Nézd meg a kezeléseket`                                                                                                                             |
| **P3-7** 320 px-en két soros gombok                       | `Nézd meg ingyenes SOS-kurzusunkat` 280×65, `Tovább a kezelésekre` 206×73                                                                                                                    |

### 1.4 ÚJ, a változtatásokkal keletkezett kezdőlapi találatok

**A) P2 · Három, egymást követő, alig megkülönböztethető tint-sáv.**
Mért háttérsorrend 5901-től: `#e6f0f8` (Erre számíthatsz, 922 px) → `#f4f8fd` (sín, 773 px) →
`#e6f0f8` (vélemények, 900 px). A `#f4f8fd` és a `#e6f0f8` közti világosságkülönbség szabad
szemmel nem szekcióhatár: 2595 px-en át egyetlen, összefolyó tint-blokk. A régi audit P2-7-e a
lap ELSŐ felére vonatkozott; ott javult (a `kc-about` és a Kurzusaink között ma is `#f6f9fc`
fut), de a MÁSODIK fele romlott.
Forrás: NN/g, _Visual Hierarchy in UX_
(<https://www.nngroup.com/articles/visual-hierarchy-ux-definition/>); NN/g, _Common Region_
(<https://www.nngroup.com/articles/common-region/>). Javaslat: a sín `hatter: feher`, hogy a
ritmus tint → fehér → tint legyen. **Méret: S** (CMS-mező, `Pages → Kezdőlap → Szekciók`).

**B) P2 · A kezdőlapi alapítói blokk és a sín szó szerint a `/rolunk` szövege.**
Mérve: a kezdőlap 29 hosszú (>55 karakteres) bekezdéséből **8 azonos** a `/rolunk`
bekezdéseivel, köztük a teljes alapítói blokk („A kéz rehabilitációja a szakterületünk…",
„Személyes kezelésen a panaszaidhoz…", „A Magyar Sportrehabilitációs Egyesület és a Magyar
Gyógytornász-Fizioterapeuták Társaságának…") és a teljes sín („Három út, ahogy a kezeddel
foglalkozunk…", „Akut panasz, műtét utáni időszak…"). A H2 is azonos: `Megérdemled a profi
törődést` mindkét lapon. Részletek az 5.1 pontban.

**C) P3 · A film-hero úszó feliratai 1392 px széles dobozban futnak.**
Mérve 1440 px-en: a két felirat-doboz `1392×108` px. Ekkora hasábban a magyar szöveg
sorhossza jóval a 45–85 karakteres sávon kívülre esik. A régi audit a scrub HOSSZÁT kifogásolta
(P1-2), a hasáb SZÉLESSÉGÉT nem. Forrás: `termektervezes` SKILL 3. pont (sorhossz 45–85);
WCAG 2.2 SC 1.4.8 Vizuális megjelenítés (AAA, a 80 karakteres korlát elve)
(<https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html>). **Méret: S**
(`film-hero.css`, a felirat-hasáb `max-width`-je).

---

## 2. `/szolgaltatasok`

**Mit lát a felhasználó.** Képek: `s1440-00..04.png` (1440 px), `szolg-390.png`,
`fold-szolg-390.png`. Halvány tint hero („A kezed folyton dolgozik, segítünk, hogy közben ne
fájjon"), döntéssegítő blokk, három szolgáltatás 01/02/03 rácsban árakkal, részletes rendelői
árlista, a két szakember hívógombbal, „Ezért fogod imádni", vélemények, záró kurzus-hívás.

**Az oldal EGY dolga.** A rendelői kezelés megértetése és **időpontkérésbe fordítása**. Ez a
`/kurzusok` melletti második bevételi út, és a `/kapcsolat` egyetlen tartalmi előszobája.

**Mért alapadatok.** 1440: 6972 px (7,7 képernyő), 8 szekció · 1024: 7006 px · 390: 10 023 px
(11,9 képernyő) · 320: 10 804 px, `scrollWidth = 320` (nincs vízszintes görgetés) ·
LCP-jelölt a H1 szöveg (1,59 s) · betűméretek: **16 / 19 / 39,9995 px** (a három token) ·
AA alatti szövegkontraszt: **egy sem** (legkisebb törzsérték 5,45:1) · gondolatjel: **0** ·
animáció `no-preference` alatt is: **0** · minden képnek van alt-szövege, mind `next/image`.

### 2.1 UX-találatok

**P1-1 · A lap elsődleges gombja a kurzusokra visz, a saját szolgáltatására csak szöveglink mutat. (M)**
Mérve 1440 px-en: az egyetlen kitöltött, elsődleges gomb a lap alján a **`Megnézem a kurzusokat`
(265×55, felület-kontraszt 4,72:1)**, célja `/kurzusok`. A rendelői útra mutató két hívás
szöveglink: `Időpontot kérek →` (163×56) és a törzsszövegben egy soron belüli
`időpontot kérek` (113×22 mobilon). A rendelő ára (18 000 / 10 000 Ft) kétszer szerepel, de
egyetlen gomb sem visz a foglalásra.
Forrás: GOV.UK Design System, _Buttons_ („Use a primary button for the main call to action on a
page", <https://design-system.service.gov.uk/components/button/>); Material Design 3,
_Buttons_ gomb-hierarchia (filled > outlined > text,
<https://m3.material.io/components/buttons/guidelines>); Baymard, _Homepage & Category
Navigation_ (a listaelem mutassa a továbblépést,
<https://baymard.com/research/homepage-and-category-navigation>).
Javaslat: a `Kérj időpontot üzenetben` (§3.2 #24) legyen kitöltött elsődleges gomb a
`Rendelői kezelések` szekció alján, a záró sáv `Megnézem a kurzusokat` gombja pedig másodlagos,
vagy a záró sáv kapjon két gombot (elsődleges: időpont, másodlagos: kurzusok). **Méret: M**
(CMS-szekció + `cta-banner` beállítás; tulajdonosi döntés, mert a bevételi sorrendet érinti).

**P1-2 · Mobilon a hajtás fölött nincs semmilyen cselekvés, és az első CTA a 3. képernyőn van. (M)**
Mérve 390×844-en: a hajtás fölött csak H1 (104–260), bevezető (272–326) és a következő H2
(450–553); gomb, link, ár, kép nincs. Az első CTA (`Időpontot kérek →`) **2179 px-nél, a 2,6.
képernyőn**. A süti-sáv 660–844 között ül, tehát a nyitó képernyő alsó ötöde a sávé.
Forrás: NN/g, _Scrolling and Attention_ (az első képernyő kapja a nézési idő 57%-át,
<https://www.nngroup.com/articles/scrolling-and-attention/>); NN/g, _The Fold Manifesto_
(<https://www.nngroup.com/articles/page-fold-manifesto/>); WCAG 2.2 SC 2.4.11 Fókusz nem takart
(minimum) a lebegő sáv miatt
(<https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html>).
Javaslat: a hero alá egy `Kérj időpontot üzenetben` gomb és egy egysoros ártájékoztató
(„50 perc 18 000 Ft, 20 perc 10 000 Ft, két budapesti rendelőben"). **Méret: S** (CMS hero
mezők + egy gomb).

**P2-3 · „Ezért fogod imádni": a címsor nem írja le, ami alatta van, és kilóg a hangnemből. (S)**
Mérve: H2 40 px, alatta két tárgyilagos tétel („A kéz a szakterületünk", „A hétköznapokra
készülünk"). Az „imádni" fogyasztási-cikk regiszter egy egészségügyi szolgáltatásoldalon,
és nem a szekció tartalmát nevezi meg.
Forrás: WCAG 2.2 SC 2.4.6 Címsorok és címkék (a címsor írja le a témát,
<https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html>); NN/g, _How Users Read
on the Web_ (<https://www.nngroup.com/articles/how-users-read-on-the-web/>);
`termektervezes` SKILL 2. pont (natív magyar, nem brossúra-hang).
Javaslat: `Amiben mások vagyunk` (ez a `/rolunk` már bevált címe, tehát a konzisztenciát is
javítja) vagy `Miért hozzánk`. **Méret: S** (CMS `services.title`).

**P2-4 · A H3-ak akkorák, mint a H2 (ugyanaz a hiba, mint a kezdőlapon). (S)**
Mérve: `A kéz a szakterületünk` és `A hétköznapokra készülünk` **39,9995 px**, azonos a szekció
H2-jével; ugyanezen a lapon a többi H3 (`Rendelői kezelések`, `Otthoni online program`,
`Szakmai képzések`, `Kocsis Kata`, `Kiss Kata`) helyesen 19 px.
Forrás: NN/g, _Visual Hierarchy_
(<https://www.nngroup.com/articles/visual-hierarchy-ux-definition/>); GOV.UK Design System,
_Headings_ (<https://design-system.service.gov.uk/styles/headings/>); WCAG 2.2 SC 2.4.6.
Javaslat: `services.css` H3 → `var(--kc-font-m)` + 600 súly. **Méret: S** (ugyanaz a fájl,
mint a kezdőlapi P2-8, egy javítás mindkettőt rendezi).

**P2-5 · Ugyanaz a két címsorszöveg két szinten. (S)**
Mérve: `Rendelői kezelések` **H3-ként** az „Így segítünk" rácsban (1121 px) és **H2-ként** a
részletes blokkban (2153 px). A képernyőolvasós címsorlistában két, azonos nevű, más szintű
tétel áll egymás mellett, és a `#rendeloi` horgony a másodikra mutat.
Forrás: WCAG 2.2 SC 2.4.6; W3C WAI, _Headings_ (a címsorok legyenek egyediek és leírók,
<https://www.w3.org/WAI/tutorials/page-structure/headings/>).
Javaslat: a részletes blokk H2-je legyen `Rendelői kezelések és árak`, a rácsbeli H3 marad.
**Méret: S** (CMS).

**P2-6 · A rendelői ár és a két cím két helyen, szó szerint kétszer. (S)**
Mérve: „Ár: 18 000 Ft (50 perc), illetve 10 000 Ft (20 perc)" az 1121-es rácsban, majd
ugyanez tételesen a 2153-as árlistában; a két cím ugyanígy kétszer, **eltérő írásmóddal**:
`(Nádorliget u. 7/b, Fadrusz utca 15.)` vesszővel, illetve
`1117 Budapest, Nádorliget u. 7/b • 1114 Budapest, Fadrusz utca 15.` felsorolásjellel, irányítószámmal.
Forrás: NN/g, tíz heurisztika #8 (esztétika és minimalista formatervezés); Semrush, _Local
SEO_ NAP-konzisztencia (a cím szó szerint azonos legyen mindenhol,
<https://www.semrush.com/blog/what-is-local-seo/>).
Javaslat: a rácsban csak a „tól" ár és a helyszínek száma („két budapesti rendelőben"), a
tételes árlista és a teljes, irányítószámos cím egyszer, a részletes blokkban, a
`/kapcsolat`-tal betűre azonos alakban. **Méret: S** (CMS).

**P3-7 · Két, azonos nevű link ugyanarra a horgonyra, személyre szabott ígérettel. (S)**
Mérve: a két szakember-kártyán `Nézd meg a szakmai hátterét →` (292×44 mobilon), mindkettő
`/rolunk#szakmai-hatter`, ugyanarra a szekciócímre. A célban két külön lenyíló van
(`Kocsis Kata szakmai önéletrajza`, `Kiss Kata szakmai önéletrajza`), de a link nem a
személyére visz.
Forrás: WCAG 2.2 SC 2.4.4 Link célja (kontextusban)
(<https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html>); NN/g,
_Better Link Labels_ (<https://www.nngroup.com/articles/better-link-labels/>).
Javaslat: `aria-label` a névvel (`Nézd meg Kocsis Kata szakmai hátterét`), és személyenkénti
horgony a `/rolunk` lenyílóira. **Méret: S** (`TeamMembers.tsx` + a lenyíló `id`-jei).

### 2.2 Marketing/SEO réteg

| Elem               | Mért érték                                                                                                                             | Ítélet                                                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<title>`          | `Szolgáltatások \| Kineticare` (27 karakter)                                                                                           | **P2**: nincs benne kulcsszó és helymegjelölés; a `docs/informacios-architektura.md` N5 dupla márkanév-hibája viszont **itt már javítva**                         |
| `meta description` | 154 karakter, árakkal és Budapesttel                                                                                                   | **rendben** (a 105–135 sávnál hosszabb, de a 155-ös levágás alatt)                                                                                                |
| H1                 | `A kezed folyton dolgozik, segítünk, hogy közben ne fájjon`                                                                            | **P2**: nincs benne szolgáltatásnév, város, „gyógytorna", „kézrehabilitáció"                                                                                      |
| H2/H3 lánc         | H1 → 6 H2 → 8 H3, logikus                                                                                                              | rendben, a 2.1/P2-5 kivételével                                                                                                                                   |
| URL                | `/szolgaltatasok`, kisbetűs, kötőjel nélküli, rövid                                                                                    | rendben                                                                                                                                                           |
| canonical          | `…/szolgaltatasok`                                                                                                                     | rendben                                                                                                                                                           |
| robots / sitemap   | indexelhető, benne a sitemapben (`priority 0.6`, `lastmod` van)                                                                        | rendben                                                                                                                                                           |
| JSON-LD            | **1 blokk**: `MedicalWebPage`, `name`/`headline` a poétikus H1                                                                         | **P2**: nincs `Service`, `Offer`, `PriceSpecification` a kiírt árakhoz, nincs `MedicalBusiness` a két rendelőhöz                                                  |
| og:image / og:type | **NINCS** (egyik oldalon sem)                                                                                                          | **P2**, lásd 5.3                                                                                                                                                  |
| kép-alt            | mind a 4 képnek van, leíró                                                                                                             | rendben                                                                                                                                                           |
| belső linkek       | `/kapcsolat#idopontkeres` ×2, `/kurzusok/otthoni-kezrehab-program`, `/rolunk#szakmai-hatter` ×2, `/kurzusok`, külső `probodystudio.hu` | **P3**: **nincs egyetlen link sem a Tudástár cikkeire**, pedig a `/blog/inhuvelygyulladas` és a `/blog/befagyott-vall` pontosan az itt felsorolt panaszokról szól |

**Keresési szándék.** Az oldal ma **informational** hangon szól (mit csinálunk, hogyan
dolgozunk). A mért kulcsszóréteg alapján **commercial + local** szándékot kellene kiszolgálnia:
„kézrehabilitáció gyógytornász Budapest", „kéz gyógytorna ár", „manuálterápia csukló". Az ár és
a két cím már a lapon van, tehát a tartalom megvan; a cím, a H1 és a séma nem mondja ki.
Forrás: Semrush, _Search Intent_ (a SERP-elemzés és a kifejezés nyelvezete alapján,
<https://www.semrush.com/blog/search-intent/>); Semrush, _On-Page SEO Checklist_ 6.2 és 6.10
(<https://www.semrush.com/blog/on-page-seo-checklist/>).

**Konverziós út.** Belépés: közvetlen, menü, kezdőlapi sín. Következő lépés: `/kapcsolat`
űrlap vagy `tel:` hívás. **Ahol elvész:** mobilon 2,6 képernyőnyi szöveg CTA nélkül (P1-2);
a lap egyetlen erős gombja elviszi a kurzusokhoz (P1-1); a rendelői blokk alján a foglalás egy
soron belüli szöveglink.

---

## 3. `/rolunk`

**Mit lát a felhasználó.** Képek: `r1440-00..05.png`, `rolunk-390.png`, `fold-rolunk-390.png`.
Tint hero („A kéz a mindenünk"), 1456 px hosszú, folyamatos esszé, alapítói blokk statokkal,
sajtólogó-sáv, „Amiben mások vagyunk", a kezdőlapról ismert sín, a két szakember kártyája,
partnerlogó-sáv, részletes szakmai háttér lenyílókban, vélemények, záró kurzus-hívás.

**Az oldal EGY dolga.** Bizalom: **E-E-A-T-igazolás** (kik ezek, mit végeztek, hol
publikálnak), majd átterelés a rendelőbe vagy a kurzusra.

**Mért alapadatok.** 1440: 8864 px (9,8 képernyő), 12 szekció · 1024: 8731 px · 390: 12 323 px
(**14,6 képernyő**) · 320: 13 989 px, `scrollWidth = 320` · LCP-jelölt a hero bevezető szövege
(1,94 s) · betűméretek: 16 / 19 / 39,9995 px · AA alatti szövegkontraszt: **egy sem**
(legkisebb 5,42:1) · gondolatjel a látható szövegben: **0** · animáció `no-preference` alatt:
**2 db 32 s-os marquee**, `reduce` alatt **0** (helyes), mindkettőhöz **44×44 px-es
`Megállítom a logósort` vezérlő** (WCAG 2.2.2 teljesül).

### 3.1 UX-találatok

**P1-1 · Az első cselekvési lehetőség mobilon a 7. képernyőn van. (M)**
Mérve 390×844-en: az első gomb vagy tartalmi link a `Tovább a kezelésekre` **5746 px-nél
(6,8. képernyő)**. Előtte: hero (282 px) + 1539 px esszé + 1646 px alapítói blokk + 418 px
sajtósáv + 1026 px „Amiben mások vagyunk". A `/kapcsolat`-ra mutató első link 8353 px
(9,9. képernyő), a fizetős kurzusra mutató első link **11 172 px (13,2. képernyő)**.
Asztali gépen ugyanez 3954 / 4727 / 7954 px.
Forrás: NN/g, _Scrolling and Attention_
(<https://www.nngroup.com/articles/scrolling-and-attention/>); NN/g, tíz heurisztika #7
(rugalmasság és hatékonyság); `docs/ertekesitesi-ux-skill.md` M1 (minden belépő lapon legyen
korai, egyértelmű továbblépés).
Javaslat: a hero alá egy másodlagos gombpár (`Kérj időpontot üzenetben` és
`Nézd meg a kurzusokat`), és a sín feljebb, az esszé UTÁN, az alapítói blokk ELÉ.
**Méret: S** (CMS-átrendezés + két gomb a hero blokkban).

**P1-2 · A lap 29 bekezdéséből 8 szó szerint a kezdőlapé, 7 a `/szolgaltatasok`-é. (M)**
Mérve (teljes `innerText`, >55 karakteres bekezdések): `/rolunk ∩ /`: **8 azonos bekezdés**
(az egész alapítói blokk, a teljes sín, mindhárom vélemény, a szakmai egyesületi jegyzet).
`/rolunk ∩ /szolgaltatasok`: **7** (a két szakember-kártya teljes szövege, mindhárom vélemény).
A H2 is azonos a kezdőlappal: `Megérdemled a profi törődést`.
Forrás: Semrush, _On-Page SEO_ 6.6 (egyedi, hasznos tartalom) és 8. pont 3. hiba (duplikált
tartalom, <https://www.semrush.com/blog/on-page-seo-checklist/>); NN/g, tíz heurisztika #8.
Következmény a mért helyzetben: 9 hivatkozó domain és nulla organikus lábnyom mellett három
egymást ismétlő oldal osztozik ugyanazon a relevancia-jelen, és a látogató a második lapon
már látott szöveget olvas. Részletek és javaslat az 5.1 pontban. **Méret: M**, tulajdonosi
döntés (melyik lap MELYIK állítást viszi).

**P2-3 · A H1 nem mondja meg, hol vagyok, és a következő H2 mondat közepén kezdődik. (S)**
Mérve: H1 `A kéz a mindenünk` (40 px, 1 sor mobilon), a menüpont neve viszont `Rólunk`.
A második címsor: `…ez nem „csak egy kéz”` (H2, hármaspont-kezdet, az előző bekezdés
mondatának folytatása). Képernyőolvasós címsorlistában értelmezhetetlen.
Forrás: WCAG 2.2 SC 2.4.6 Címsorok és címkék
(<https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html>); NN/g,
_Page Titles_ (a cím legyen egyedi és önmagában érthető,
<https://www.nngroup.com/articles/page-titles/>); `docs/informacios-architektura.md` #9
(menüpont-név ≠ oldalcím, „nincs megérkeztem-visszaigazolás"): **ma is fennáll**.
Javaslat: H1 `Rólunk: Kocsis Kata és Kiss Kata kézrehabilitációs gyógytornászok`, vagy a
mostani cím fölé egy `RÓLUNK` eyebrow (a lapon máshol már használt minta). A második címsor
legyen önálló mondat: `Ez nem „csak egy kéz"`. **Méret: S** (CMS).

**P2-4 · A H3-ak akkorák, mint a H2, harmadszor. (S)**
Mérve: `A kézre figyelünk`, `Veled dolgozunk`, `Rendelői kezelések`: **39,9995 px**. Ugyanez a
`services.css` / `services-sin.css` hiba, mint a kezdőlapon és a `/szolgaltatasok`-on.
Ugyanaz a forrás és javaslat, mint a 2.1/P2-4-nél. **Méret: S** (egy javítás mind a három lapra).

**P2-5 · A két szakember-kártyáról hiányzik a telefonszám, pont azon a lapon, ahol a bizalom épül. (S)**
Mérve: `/kapcsolat` és `/szolgaltatasok` kártyáin `Hívd Kocsis Katát +36 30 169 2263`
(446×73 asztali, 292×67 mobil); a `/rolunk` ugyanezen kártyáin **csak** a
`Nézd meg a szakmai hátterét` link van. A `TeamMembers.tsx` a telefont opcionális CMS-mezőből
veszi (`member.phone`), tehát ez tartalmi hiány, nem kódhiba.
Forrás: WCAG 2.2 SC 3.2.4 Következetes azonosítás (azonos komponens, azonos funkció,
<https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html>); NN/g,
tíz heurisztika #4 (következetesség és szabványok).
Javaslat: a `phone` mező kitöltése a `rolunk` oldal team blokkjában is. **Méret: S** (CMS).

**P3-6 · Két, azonos nevű `Megállítom a logósort` gomb, két különböző logósorra. (S)**
Mérve: a `kc-press` blokk kétszer szerepel (2922 px `Itt találkozhattál velünk`, 6003 px
`Partnereink`), mindkettőn 44×44-es vezérlő azonos felirattal.
Forrás: WCAG 2.2 SC 4.1.2 Név, szerep, érték és SC 2.4.4 Link célja
(<https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html>); NN/g,
_Better Link Labels_.
Javaslat: `aria-label` a sor nevével (`Megállítom a médiamegjelenések logósorát` /
`…a partnerek logósorát`). **Méret: S** (`PressLogos.tsx`).

**P3-7 · A médiasor felirata itt is tagsági logókat takar. (S)**
Mérve: az `ITT TALÁLKOZHATTÁL VELÜNK` felirat alatt a Nők Lapja, Karc FM, Házipatika, Képmás,
iSport, Kossuth Rádió és TV2 mellett ott a **MGYFT**, a **MASE** és a **Magyar Kézsebész
Társaság** is. Ugyanaz a kezdőlapi P2-6, most a `/rolunk`-on is. A Kossuth Rádió 107×129-es
álló logója itt is a 176×52-es fekvő dobozban áll.
Ugyanaz a forrás és javaslat, mint a kezdőlapi P2-6-nál. **Méret: S** (CMS-felirat).

### 3.2 Marketing/SEO réteg

| Elem               | Mért érték                                                                                                                    | Ítélet                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<title>`          | **`Rólunk – Kineticare \| Kineticare`** (32 karakter)                                                                         | **P1**: a márkanév kétszer, és **gondolatjellel** (`–`), amit a tulajdonos a vevői szövegben tiltott. Ok: a CMS `seoTitle` már tartalmazza a márkát, a keret-layout `%s \| Kineticare` sablonja még egyszer hozzáteszi. A kezdőlapot a `homeDocumentTitle` (`src/lib/seo.ts`) `title.absolute`-tal megvédi, a CMS-oldalakat futtató `buildPageMetadata` **nem**. A `docs/informacios-architektura.md` N5 ezt már 2026 augusztusában leírta; a `/szolgaltatasok`-on javult, a `/rolunk`-on **nem** |
| `meta description` | **183 karakter**, benne `manuálterapeuta – szakmai háttér`                                                                    | **P2**: a SERP ~155–160 karakternél levágja, tehát a „vélemények, média-megjelenések" rész nem jelenik meg; a gondolatjel a keresőtalálatban is látszik                                                                                                                                                                                                                                                                                                                                           |
| H1                 | `A kéz a mindenünk`                                                                                                           | **P2**, lásd 3.1/P2-3                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| JSON-LD            | 1 blokk: `MedicalWebPage`, `name` = `A kéz a mindenünk`                                                                       | **P1 (GEO/E-E-A-T)**: nincs `Person` séma a két alapítóra, nincs `sameAs`, pedig a lap **38 tanfolyam, 2 publikáció, 7 konferencia, 14 médiamegjelenés** adatát mutatja. Az `ADATOK-mert.md` 4. és 5. pontja ezt nevezi a cutover előtti fedezetnek (A5/A7 lock)                                                                                                                                                                                                                                  |
| belső linkek       | `/szolgaltatasok`, `/kapcsolat#idopontkeres`, `/kurzusok`, `#szakmai-hatter`                                                  | **P3**: a Tudástárra egyetlen tartalmi link sincs                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| kép-alt            | mind a 28 képnek van                                                                                                          | rendben                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| CTA-felirat        | ugyanazon a lapon **`Megnézem a kurzusokat`** (záró sáv) és **`Nézd meg a kurzusokat`** (sín-panel), azonos `/kurzusok` célra | **P2**, lásd 5.2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

**Keresési szándék.** Ma **navigational/brand**. Ez helyes is: a mért 15 rangsoroló kifejezés
között ott van a `kocsis viktória`, a `szóka kata mozgásterápia` és a `kata ruhaklinikája` is,
vagyis a márkanév-környéki keresések **más szakemberekhez** viszik a domaint. A `/rolunk`
lapnak ezt kell rendbe tennie: `Person` séma + `sameAs` (foglaljorvost.hu, probodystudio.hu,
MASE, MGYFT) az egyértelműsítéshez. Forrás: Semrush, _AI Search Optimization_ (entitás-tisztaság
és `sameAs` a márka-összemosás ellen, <https://www.semrush.com/blog/ai-search-optimization/>);
Semrush, _Local SEO_ 7. pont (strukturált adat).

**Konverziós út.** Belépés: menü, kezdőlapi `Ismerd meg a hátterünket`, közvetlen.
**Ahol elvész:** 6,8 képernyő mobilon cselekvés nélkül (P1-1); a lap 28%-a már látott szöveg
(P1-2); a fizetős termékre mutató első link a 13,2. képernyőn.

---

## 4. `/kapcsolat`

**Mit lát a felhasználó.** Képek: `k1440-00..02.png`, `kapcsolat-390.png`,
`fold-kapcsolat-390.png`. Csupasz `Kapcsolat` H1 egy 224 px magas sávban, majd az időpontkérő
szekció (bal hasáb: elérhetőségek, jobb hasáb: űrlap), végül a „Beszéljünk" szakember-kártyák.

**Az oldal EGY dolga.** **Időpontkérés keletkezzen**: űrlapon vagy telefonon.

**Mért alapadatok.** 1440: 3783 px (4,2 képernyő), 3 szekció · 1024: 3863 px · 390: 5636 px
(6,7 képernyő) · 320: 5919 px, `scrollWidth = 320` · LCP-jelölt a szekció bevezető szövege
(0,82 s) · betűméretek: 16 / 19 / 39,9995 px · AA alatti szövegkontraszt: **egy sem**
(legkisebb 5,45:1) · gondolatjel: **0** · animáció: **0** mindkét módban · űrlapmezők 414×55,
jelölőnégyzetek pontosan 24×24 (a WCAG 2.5.8 minimuma), a kattintható sor 44 px ·
`tel:` linkek 151×44 · `autocomplete` mindenhol helyes (`name`, `tel`, `email`) ·
`inputmode` a telefonon és az e-mailen beállítva · a mézesbödön (`website`) mező **nincs** a
Tab-sorrendben.

### 4.1 UX-találatok

**P1-1 · Az űrlapmezők fókuszjelölése a mért 3:1 alatt van. (S, de az egész oldalra kiható)**
Mérve (valódi Tab-bal, 900 ms beállás után, `input[name=appointmentName]`):
a keret `#6b7f94` → `#2f6e9f` vált, a **két állapot közti kontraszt 1,32:1**; a hozzáadott
3 px-es gyűrű `rgba(47,110,159,0.3)`, ami a tint sávra kompozitálva `rgb(175,201,221)`, vagyis
**1,49:1 a sávval** és **1,72:1 a mező fehér belsejével**. Összehasonlításul: az oldal minden
más interaktív eleme 3 px tömör `#2f6e9f` gyűrűt kap, **5,16–5,45:1** kontraszttal.
A szabály forrása a kódban: `src/app/(frontend)/styles/ui.css:389`
(`.kc-field__input:focus-visible { outline: none; … }`), ami felülírja a `base.css:224` globális
gyűrűjét.
Hatókör: a `.kc-field__input` (`src/components/ui/Field.tsx`) **10 űrlap-komponensben** fut,
köztük a lábléc hírlevél-mezőjében, ami **minden oldalon** ott van, továbbá a belépésben, a
regisztrációban, a jelszó-visszaállításban és a pénztárban.
Forrás: WCAG 2.2 SC 1.4.11 Nem-szöveges kontraszt (az állapot azonosításához szükséges vizuális
információ ≥ 3:1, <https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html>);
WCAG 2.2 SC 2.4.13 Fókusz megjelenése (a 3:1-es állapotváltás és a legalább 2 CSS px-es terület
mint AAA-referencia, <https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html>);
`termektervezes` SKILL 3. pont („Fókuszjelölés ≥ 3:1 és látható minden háttéren").
Javaslat: a `.kc-field__input:focus-visible` kapja meg a globális 3 px tömör `#2f6e9f`
gyűrűt (`outline: 3px solid var(--kc-color-focus); outline-offset: 2px`), a keretszín-váltás
maradhat mellette. **Méret: S** (egy szabály), de **őr-teszt kell**, mert ez a fajta
felülírás visszacsúszik.

**P1-2 · A lap helyi SEO és helyi UX szempontból hiányos: nincs nyitvatartás, térkép, útvonalterv, sem strukturált adat. (M)**
Mérve: a lapon két cím szerepel sima szövegként (`1117 Budapest, Nádorliget u. 7/b` és
`1114 Budapest, Fadrusz utca 15.`), két `tel:` link, egy `mailto:`. **Nincs** nyitvatartás,
**nincs** térkép vagy útvonalterv-link, **nincs** információ arról, melyik szakember melyik
rendelőben dolgozik (a lap ezt így oldja meg: „A hívás során megbeszélitek, melyik rendelőbe
érdemes jönnöd"), és a **JSON-LD blokkok száma a lapon: 0** (a kódbázisban sehol nincs
`LocalBusiness`, `MedicalBusiness`, `Physiotherapy`, `PostalAddress`, `openingHours`,
`telephone` vagy `geo` séma).
Forrás: Semrush, _Local SEO_ II/2.8 („Pontos, konzisztens infó: nyitvatartás, cím, telefon"),
II/5 („Külön aloldal minden telephelyhez, GBP beágyazása, belső linkelés szolgáltatás ↔ helyszín
között"), II/7 (Local Business schema) és II/9 (gyakori hibák: inkonzisztens NAP)
(<https://www.semrush.com/blog/what-is-local-seo/>,
<https://www.semrush.com/blog/google-business-profile-optimization/>); NN/g,
_Trustworthiness in Web Design_ (az ellenőrizhető, konkrét adat épít bizalmat,
<https://www.nngroup.com/articles/trustworthiness-in-web-design/>).
Miért súlyos éppen itt: a mért organikus lábnyom nulla, a fő kifejezésekre nincs rangsor, tehát
a **térképes találat (Local Pack) az egyetlen keresési felület, ahol ez a vállalkozás rövid
távon reálisan megjelenhet**. Ehhez a hármas kell: hitelesített Google Business Profile,
betűre azonos NAP a weben, és `LocalBusiness` (pontosabban `Physiotherapy` /
`MedicalBusiness`) séma a `/kapcsolat`-on, két `location` bejegyzéssel.
Javaslat (sorrendben): (a) nyitvatartás felvétele a CMS-be és megjelenítése rendelőnként,
(b) `Physiotherapy` JSON-LD két telephellyel (`name`, `address` `PostalAddress`-szel,
`telephone`, `openingHoursSpecification`, `url`, `sameAs`), (c) rendelőnkénti útvonalterv-link,
(d) annak kiírása, melyik szakember hol rendel. **Méret: M**, és a nyitvatartás
**tulajdonosi adat**, lásd 6. pont.

**P2-3 · A hero egy szó, semmi más, és 224 px magas üres sávot foglal. (S)**
Mérve: az első szekció 72-től 296 px-ig tart, tartalma egyetlen H1: `Kapcsolat` (40 px).
Nincs bevezető, nincs lead, nincs eyebrow, és a szekció nem kap tint hátteret sem, míg a
`/szolgaltatasok` és a `/rolunk` hero-ja `#e6f0f8` tint. Mobilon a hajtás fölött így
**nincs telefonszám, nincs cím, nincs gomb**: csak a `Kapcsolat` szó és az űrlap bevezetője.
Az első `tel:` link 833 px-nél van, amit nyitott süti-sáv mellett a 660–844 közötti sáv részben
takar.
Forrás: NN/g, _The Fold Manifesto_
(<https://www.nngroup.com/articles/page-fold-manifesto/>); NN/g,
_Contact Us Pages_ elve, hogy a legfontosabb elérhetőség azonnal látszódjon (NN/g,
_Trustworthiness in Web Design_,
<https://www.nngroup.com/articles/trustworthiness-in-web-design/>); WCAG 2.2 SC 2.4.11
Fókusz nem takart (minimum)
(<https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html>).
Javaslat: a H1 alá egy mondat („Két budapesti rendelő, időpontkérés űrlapon vagy telefonon"),
és a két telefonszám a hero sávba, gombként. A hero háttere legyen tint, mint a másik két
belépő lapon. **Méret: S** (a `kapcsolat/page.tsx` hero-blokkja + CMS).

**P2-4 · A NAP-írásmód két lapon két alakban szerepel. (S)**
Mérve: `/kapcsolat`: `1117 Budapest, Nádorliget u. 7/b` és `1114 Budapest, Fadrusz utca 15.`
külön sorban. `/szolgaltatasok`: egyszer `(Nádorliget u. 7/b, Fadrusz utca 15.)` irányítószám
nélkül, egyszer `1117 Budapest, Nádorliget u. 7/b • 1114 Budapest, Fadrusz utca 15.`
felsorolásjellel. A cégnév is három alakban él a felületen: `Kineticare` (lábléc, űrlap-szöveg),
`KINETICARE` (a `/rolunk` bevezetője), `Kineticare-t` (a `/rolunk` team-bevezetője).
Forrás: Semrush, _Local SEO_ II/3 („NAP = Name, Address, Phone, **szó szerint azonosnak** kell
lennie minden platformon", <https://www.semrush.com/blog/what-is-local-seo/>); Semrush,
_Google 3-Pack_ 4. lépés (széleskörű, konzisztens citations,
<https://www.semrush.com/blog/google-3-pack/>).
Javaslat: egyetlen kanonikus NAP-alak rögzítése (`docs/ui-sztenderdek.md`-be), és minden
előfordulás arra hozása, beleértve az Impresszumot és a jövőbeli Google Business Profile-t.
**Méret: S** a weben, **M** ha a külső jegyzékeket is végigvisszük.

**P2-5 · Az űrlap 11 mezőből áll, és a beküldés mobilon a 2,8. képernyőn van. (S)**
Mérve 390 px-en: az időpontkérő szekció 2256 px magas, az `Időpontot kérek` gomb 2323 px-nél.
Az űrlap két kötelező (név, telefon) és négy nem kötelező mezőt kér, plusz három
jelölőnégyzet-opciót és egy kötelező hozzájárulást. A `Mikor alkalmas neked?` blokk három
jelölőnégyzete és a hosszú, 222 px magas hozzájárulási felirat együtt 700+ px.
Forrás: Baymard Institute, _Checkout Usability_ (minden fölösleges mező mérhető
lemorzsolódás, <https://baymard.com/research/checkout-usability>); GOV.UK Design System,
_Question pages_ („Only ask for the information you need",
<https://design-system.service.gov.uk/patterns/question-pages/>).
Megjegyzés: az űrlap **jól** van megírva (kötelezőség jelölve, minden mezőnek van súgója, a
telefon `inputmode=tel`, a szándék tisztázva: „Ez az űrlap nem foglalás"). A kifogás csak a
hossz: a három „mikor alkalmas" opció és a szabad szöveges mező a beküldés UTÁNI telefonhívásra
is halasztható. Javaslat: a nem kötelező mezők egy „Adj meg többet, ha szeretnél" lenyílóba.
**Méret: S**, de **tulajdonosi döntés**, mert a mezők üzleti célt szolgálnak.

**P3-6 · A „Kérj időpontot üzenetben" a `/kapcsolat`-on önmagára mutat. (S)**
Mérve: a „Beszéljünk" szekció alján a link `#idopontkeres` (ugyanezen a lapon, 296 px-nél),
míg a `/szolgaltatasok`-on és a `/rolunk`-on ugyanez a felirat `/kapcsolat#idopontkeres`-re
visz. A felirat („Kérj időpontot **üzenetben**") ott igaz, ahol átvisz; itt csak visszagörget.
Forrás: WCAG 2.2 SC 2.4.4 Link célja (kontextusban)
(<https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html>); NN/g,
_Better Link Labels_ (<https://www.nngroup.com/articles/better-link-labels/>).
Javaslat: az aktuális lapon a felirat legyen `Vissza az űrlaphoz`, vagy a link maradjon el.
**Méret: S** (`TeamMembers.tsx`, a saját lapon a horgony kihagyása).

### 4.2 Marketing/SEO réteg

| Elem               | Mért érték                                                                                      | Ítélet                                                                                                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<title>`          | `Kapcsolat \| Kineticare` (22 karakter)                                                         | **P2**: nincs benne se város, se szolgáltatás. Helyi lapnál a Semrush sablonja `[Szolgáltatás] [Városban] – [Egyedi érték] \| [Márka]`                                                |
| `meta description` | 133 karakter                                                                                    | rendben                                                                                                                                                                               |
| **canonical**      | **NINCS**                                                                                       | **P1**: a `src/app/(frontend)/kapcsolat/page.tsx` `metadata` objektumában nincs `alternates.canonical`, és `openGraph.url` sincs. Ez az egyetlen a négy lap közül, amelyiken hiányzik |
| **JSON-LD**        | **0 blokk**                                                                                     | **P1**, lásd 4.1/P1-2                                                                                                                                                                 |
| H1                 | `Kapcsolat`                                                                                     | **P2**: a menüpont neve, nem az oldal tartalma                                                                                                                                        |
| H2/H3              | H1 → `Kérj időpontot a rendelőbe` → H3 `Időpontkérés` → H2 `Beszéljünk` → H3 ×2 → H2 `Hírlevél` | rendben                                                                                                                                                                               |
| sitemap            | benne van, `priority 0.5`, **`lastmod` nélkül** (kézzel felvett bejegyzés)                      | **P3**: a `/szolgaltatasok` és a `/rolunk` 0.6-ot kap, pedig a konverziós lap ez                                                                                                      |
| indexelhetőség     | `robots.txt` engedi, nincs `noindex`                                                            | rendben                                                                                                                                                                               |
| kép-alt            | mindkét portrénak van                                                                           | rendben                                                                                                                                                                               |
| belső linkek       | `/rolunk#szakmai-hatter` ×2, `#idopontkeres`, `tel:` ×4, `mailto:` ×2                           | **P2**: **nincs link a `/szolgaltatasok` árlistájára**, pedig a látogató itt dönt az időpontról                                                                                       |

**Keresési szándék.** Ma **navigational**. Kellene: **local + transactional**
(„gyógytornász XI. kerület", „kézrehabilitáció Budapest időpont", „manuálterapeuta Újbuda").
Ehhez a nyitvatartás, a séma és a rendelőnkénti tartalom az előfeltétel.
Forrás: Semrush, _Local SEO_ II/1 (relevancia, távolság, prominencia); Semrush,
_Search Intent_ (<https://www.semrush.com/blog/search-intent/>).

**Konverziós út.** Belépés: menü, lábléc óriáslink, a `/szolgaltatasok` és a `/rolunk`
szöveglinkjei, GYIK-hivatkozás (link nélkül). Következő lépés: űrlap vagy hívás.
**Ahol elvész:** mobilon a hajtás fölött nincs elérhetőség (P2-3); a látogató nem tudja
eldönteni, melyik rendelőbe menjen és mikor van nyitva (P1-2); az űrlap 2,8 képernyő (P2-5).

---

## 5. Lapokon átívelő találatok

### 5.1 P1 · Ugyanaz a szöveg három lapon (duplikált tartalom)

Mérve, teljes `innerText`, 55 karakternél hosszabb bekezdésekre:

| Lappár                           | Azonos bekezdés | Az érintett lap bekezdéseinek aránya          |
| -------------------------------- | --------------- | --------------------------------------------- |
| `/` ∩ `/rolunk`                  | **8**           | a `/rolunk` 29 bekezdésének **28%-a**         |
| `/szolgaltatasok` ∩ `/rolunk`    | **7**           | a `/szolgaltatasok` 27 bekezdésének **26%-a** |
| `/` ∩ `/szolgaltatasok`          | **3**           | mindhárom vélemény                            |
| `/szolgaltatasok` ∩ `/kapcsolat` | **3**           | a két szakember-alcím és a hívás-jegyzet      |

Konkrétan: a **három vélemény mind a három meggyőző lapon** ott van, azonos szöveggel és
azonos nevekkel. A **két szakember-kártya** (név, alcím, bemutatkozó bekezdés) **három lapon**
szerepel, három különböző szekciócím alatt (`Kihez jössz, ha időpontot kérsz?`,
`Akik a kezeddel foglalkoznak`, `Beszéljünk`). A **sín** (`Így tudunk segíteni`, három út)
a kezdőlapon és a `/rolunk`-on is fut. Az **alapítói blokk** ugyanígy.

Forrás: Semrush, _On-Page SEO Checklist_ 6.6 (egyedi, hasznos tartalom) és 8. pont
(duplikált tartalom mint gyakori hiba, <https://www.semrush.com/blog/on-page-seo-checklist/>);
Semrush, _Keyword Clustering_ (egy szándék, egy oldal,
<https://www.semrush.com/blog/keyword-clustering/>); NN/g, tíz heurisztika #8.

Miért fontos éppen ennél a domainnél: az `ADATOK-mert.md` 5. és 9. pontja szerint a
backlink-profil score 2, 9 hivatkozó domainnel. Ilyen tekintélyszinten a néhány belső oldal
között szétosztott, egymást ismétlő tartalom nem ad hozzá, hanem elveszi egymástól a kevés
jelet. Az AI-válaszok szempontjából ugyanez: az idézhető, önálló állítás számít, nem a
háromszor ismételt bekezdés (Semrush, _AI Search Optimization_,
<https://www.semrush.com/blog/ai-search-optimization/>).

**Javasolt szereposztás (tulajdonosi döntés, 6. pont):**

| Lap               | Ez az övé                                                                        | Ez elmarad róla                                                                                 |
| ----------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `/`               | rövid alapítói összefoglaló + a sín (a döntéselágazás) + 3 vélemény              | a hosszú szakmai szöveg                                                                         |
| `/szolgaltatasok` | a rendelői kezelés teljes leírása, árak, helyszínek, `Service`/`Offer` séma      | a szakember-kártyák (helyette egy sor: „A kezeléseket ketten tartjuk, [nevek]") és a vélemények |
| `/rolunk`         | az esszé, a szakmai háttér lenyílók, `Person` séma, `sameAs`, sajtó és partnerek | a sín és az alapítói blokk (ez a kezdőlapé), a vélemények                                       |
| `/kapcsolat`      | NAP, nyitvatartás, térkép, űrlap, hívógombok, `Physiotherapy` séma               | a szakember-kártyák hosszú bemutatkozó szövege (elég a név, a szakterület és a hívógomb)        |

**Méret: M** (CMS-szekciók ki- és bekapcsolása, nincs kódírás).

### 5.2 P2 · A CTA-szótár (§3.2) megsértése három ponton

A `docs/ui-sztenderdek.md` §3.2 a normatív szótár. Mérve, ma:

| #              | Szótári alak                                                                                                                                                 | Élő eltérés                                                                                                 | Hol                                                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#10**        | `Nézd meg a kurzusokat` (a szótár kommentje néven nevezi a `Megnézem a kurzusokat` alakot mint az A/6 találat egyik eltérését)                               | **`Megnézem a kurzusokat`** (265×55)                                                                        | `/szolgaltatasok` záró sáv (6062 px), `/rolunk` záró sáv (7954 px). Ugyanakkor a `/rolunk` sín-panelje a **helyes** `Nézd meg a kurzusokat` alakot használja: **egy lapon két felirat egy célra** |
| **#24 vs #25** | #24 `Kérj időpontot üzenetben` = navigáció, #25 `Időpontot kérek` = az űrlap beküldése (a szótár kifejezetten kimondja, hogy a kettő SZÁNDÉKOSAN különbözik) | **`Időpontot kérek →`** navigációs linkként a `/szolgaltatasok` 01-es kártyáján (`/kapcsolat#idopontkeres`) | `/szolgaltatasok` 1121 px                                                                                                                                                                         |
| **#40**        | `Nézd meg a kezeléseket`                                                                                                                                     | **`Tovább a kezelésekre`** (267×55)                                                                         | `/` sín (6823 px), `/rolunk` sín (3954 px). A szótár szerint szerkesztői zárolás alatt áll, tehát ez **tulajdonosi döntés**, nem hiba                                                             |

Forrás: WCAG 2.2 SC 3.2.4 Következetes azonosítás
(<https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html>);
Shopify Polaris, _Vocabulary_ („identify and eliminate synonyms",
<https://polaris.shopify.com/content/vocabulary>); GOV.UK, _Add links_
(<https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/add-links/>).
**Méret: S** (CMS-feliratok), a #40 kivételével.

### 5.3 P2 · Egyik lapon sincs `og:image`, `og:type`, és a `twitter:card` `summary`

Mérve mind a négy lapon: `og:title` és `og:description` van, **`og:image` nincs**,
`og:type` nincs, `twitter:card` = `summary` (kis, négyzetes kártya) a
`summary_large_image` helyett. Ok: a `buildDocMetadata` (`src/lib/seo.ts`) csak akkor tesz
képet az OG-be, ha a CMS-oldalon van `ogImage` vagy `heroImage`, és ezeken a lapokon
egyik sincs kitöltve.
Következmény: minden Facebook-, Messenger-, WhatsApp- és LinkedIn-megosztás **kép nélküli
szöveges csík**. A mért helyzetben (nulla organikus forgalom, közösségi és közvetlen belépés)
ez pont azt a csatornát rontja, amelyik ma egyáltalán hoz látogatót.
Forrás: Semrush, _On-Page SEO Checklist_ 6.10 (technikai kiegészítők, megosztási metaadat,
<https://www.semrush.com/blog/on-page-seo-checklist/>); Open Graph protokoll
(<https://ogp.me/>).
Javaslat: a négy lap CMS-rekordjában az `ogImage` mező kitöltése (a `founders-standing-blazers`
és a `hand-treatment-detail` kép már fel van töltve), és a `twitter.card`
`summary_large_image`-re állítása a keret-layoutban. **Méret: S**.

### 5.4 P2 · A CMS-oldalak címében megduplázódik a márkanév

Ok: `src/lib/seo.ts` `homeDocumentTitle` csak a **kezdőlapot** védi `title.absolute`-tal;
a `buildPageMetadata` → `buildDocMetadata` út nem. Ma egyetlen lapot érint (`/rolunk`), mert a
`/szolgaltatasok` CMS `seoTitle`-jéből kivették a márkát, de bármelyik jövőbeli CMS-oldal
visszahozhatja. Javaslat: a `homeDocumentTitle` logikája (ha a cím már tartalmazza a
márkanevet vagy a `|` jelet, `absolute`) emeljen ki a `buildDocMetadata`-ba, és őr-teszt
rögzítse. **Méret: S** + teszt.

### 5.5 P3 · A lábléc hírlevél-bevezetője 103 karakter/sor, minden lapon

Mérve canvas `measureText`-tel, 1440 px-en, mind a négy lapon: a
„Iratkozz fel, és értesülj elsőként az új kézrehabilitációs kurzusokról…" bekezdés hasábja
**707 px, 16 px-es betűvel 103 karakter/sor**. A projekt saját küszöbe 45–85.
Forrás: `termektervezes` SKILL 3. pont; WCAG 2.2 SC 1.4.8 Vizuális megjelenítés (a 80
karakteres korlát elve, AAA,
<https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html>);
GOV.UK Design System, _Typography_ (a törzsszöveg hasábja korlátozott szélességű,
<https://design-system.service.gov.uk/styles/type-scale/>).
Javaslat: `max-width: 60ch` a hírlevél bevezetőjén (`layout.css`). **Méret: S**.

### 5.6 P3 · A menüfa taxonómiai hibái változatlanul élnek

A `docs/informacios-architektura.md` #8, D4 és E7 pontja már leírta; ma is mérhető:
a `Szolgáltatások` lenyíló három különböző természetű célt tart (`Rendelői kezelések`
horgony, **külső** `probodystudio.hu` link, és egy **kurzus**), a fő bevételi objektum
(`Otthoni KézRehab Program`) pedig nincs a menüfában, csak a kódba égetett `Kurzusok` gombban.
Új mért részlet: a lenyíló `Ingyenes SOS KézRelax` tétele a **`/kurzusok/2`** numerikus URL-re
mutat, ami **308-cal átirányít** a `/kurzusok/sos-kezrelax-villamkurzus` slugra. Minden
menükattintás egy fölösleges átirányítási ugrást tesz.
Forrás: Semrush, _301 Redirects_ (a fölösleges átirányítási ugrások kerülése,
<https://www.semrush.com/blog/301-redirects/>); NN/g, tíz heurisztika #2 (a rendszer és a valós
világ egyezése). Javaslat: a `menus` collectionben a slug szerinti URL. **Méret: S** (CMS).

### 5.7 Amit a mérés RENDBEN talált (mind a négy lapon)

- **Betűméret:** kizárólag a három token (16 / 19 / 39,9995 px asztali gépen).
- **Szövegkontraszt:** AA alatti szöveget egyetlen lapon sem találtam; a legkisebb mért
  törzsérték 5,42:1, a legkisebb CTA-érték 4,72:1 (mindkettő a 4,5:1 fölött).
- **320 px reflow:** `document.scrollWidth = 320` mind a négy lapon, nincs vízszintes görgetés
  (WCAG 2.2 SC 1.4.10 Újratördelés teljesül).
- **Érintőcél:** minden gomb és önálló link legalább 44 px magas; a jelölőnégyzetek pontosan
  24×24 CSS px, a kattintható soruk 44 px (WCAG 2.2 SC 2.5.8 Célméret minimum teljesül).
  A 24 px alatti elemek kizárólag soron belüli szöveglinkek, amelyekre a kritérium kivételt ad.
- **Fókusz-sorrend:** logikus, DOM-sorrendű; a `/kapcsolat` két hasábos elrendezésénél a
  sorrend hasábonként halad (bal hasáb végig, majd a jobb hasáb tetejéről), ami a bevett minta.
- **Fókuszjelölés:** 3 px tömör `#2f6e9f` gyűrű 5,16–5,45:1 kontraszttal minden linken és
  gombon; kivétel az űrlapmezők (4.1/P1-1).
- **Mozgás:** `reduce` alatt nulla animáció mind a négy lapon; a két `/rolunk` marquee 32 s-os,
  de mindkettőnek van 44×44-es megállító gombja (WCAG 2.2 SC 2.2.2 teljesül).
- **Gondolatjel:** a látható vevői szövegben egyetlen `–` vagy `—` sincs. **Kivétel:** a
  `/rolunk` `<title>` és `meta description` mezője (3.2 pont).
- **Kép-alt:** minden képnek van leíró alt-szövege, mind `next/image`-en fut.
- **Űrlap-szemantika:** `autocomplete`, `inputmode`, `aria-describedby` súgókra, a kötelezőség
  szövegesen is jelölve, a mézesbödön mező kimarad a Tab-sorrendből.
- **Indexelhetőség:** mind a négy lap engedélyezett a `robots.txt`-ben és benne van a
  sitemapben; az AI-crawlerek (GPTBot, ClaudeBot, PerplexityBot, OAI-SearchBot és társaik)
  külön engedélyt kapnak.

---

## 6. Tulajdonosi döntést igénylő tételek

| #      | Kérdés                                                                                                                                                                                      | Miért nem dönthető el auditból                                                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T1** | **Nyitvatartás.** Mikor rendel Kocsis Kata és Kiss Kata, melyik rendelőben?                                                                                                                 | Ez üzemeltetési adat. Enélkül sem a `/kapcsolat` szöveg, sem az `openingHoursSpecification` séma, sem a Google Business Profile nem tölthető ki (4.1/P1-2). |
| **T2** | **Google Business Profile.** Létezik-e már hitelesített profil a két címre, és ki kezeli?                                                                                                   | A helyi SEO teljes 90 napos terve (Semrush, _Local SEO_ III.) ezen áll vagy bukik.                                                                          |
| **T3** | **A kanonikus NAP-alak.** Melyik a hivatalos név (`Kineticare` / `KINETICARE` / cégnév), és pontosan milyen alakban írjuk a két címet?                                                      | Ezt kell betűre azonosan vinni a weben, az Impresszumban és minden külső jegyzékben (4.1/P2-4).                                                             |
| **T4** | **Duplikált tartalom szereposztása.** Melyik lap viszi a véleményeket, a szakember-kártyákat, a sínt és az alapítói blokkot?                                                                | Az 5.1 táblázat javaslat; a végső sorrend üzleti döntés.                                                                                                    |
| **T5** | **A `/szolgaltatasok` elsődleges gombja.** Az időpontkérés vagy a kurzus legyen a lap fő cselekvése?                                                                                        | Bevételi prioritás (2.1/P1-1).                                                                                                                              |
| **T6** | **A `#40` sín-felirat.** Marad-e a `Tovább a kezelésekre`, vagy a szótári `Nézd meg a kezeléseket` lép a helyébe?                                                                           | A szótár szerint szerkesztői zárolás alatt áll (5.2).                                                                                                       |
| **T7** | **Az időpontkérő űrlap hossza.** A három „mikor alkalmas" opció és a szabad szöveges mező kell-e a beküldéshez, vagy telefonon is tisztázható?                                              | Üzemszervezési kérdés (4.1/P2-5).                                                                                                                           |
| **T8** | **A `/rolunk` esszéjének hossza.** Az 1456 px-es, folyamatos bevezető szöveg (mobilon 1539 px) marad-e a CTA-k előtt?                                                                       | Márkahang kontra konverzió (3.1/P1-1).                                                                                                                      |
| **T9** | Az `ADATOK-mert.md` 7. pontjának nyitott tétele: a „lelki okai" témakör, és hogy a `/rolunk` szakmai háttere kap-e `sameAs` hivatkozást a `probodystudio.hu`-ra és a `foglaljorvost.hu`-ra. | Az A7 backlog nyitott tulajdonosi tétele.                                                                                                                   |

---

## 7. Prioritási sorrend (a mért hatás szerint)

| Sorrend | Találat                                                                                  | Lap                               | Méret        |
| ------- | ---------------------------------------------------------------------------------------- | --------------------------------- | ------------ |
| 1       | Helyi SEO alapok: nyitvatartás, `Physiotherapy` séma, canonical, térkép (4.1/P1-1, P1-2) | `/kapcsolat`                      | M (+T1)      |
| 2       | Az űrlapmezők fókuszjelölése 3:1 alá esik, 10 komponensben (4.1/P1-1)                    | minden lap                        | S + őr-teszt |
| 3       | Duplikált tartalom három lapon (5.1)                                                     | `/`, `/szolgaltatasok`, `/rolunk` | M (+T4)      |
| 4       | A `/rolunk` első CTA-ja a 7. képernyőn (3.1/P1-1)                                        | `/rolunk`                         | S            |
| 5       | A `/szolgaltatasok` elsődleges gombja elviszi a saját szolgáltatásától (2.1/P1-1)        | `/szolgaltatasok`                 | M (+T5)      |
| 6       | `og:image` sehol (5.3)                                                                   | minden lap                        | S            |
| 7       | Dupla márkanév és gondolatjel a `/rolunk` címében (3.2, 5.4)                             | `/rolunk`                         | S + teszt    |
| 8       | Mobil hajtás CTA nélkül (2.1/P1-2, 4.1/P2-3)                                             | `/szolgaltatasok`, `/kapcsolat`   | S            |
| 9       | CTA-szótár eltérések (5.2)                                                               | `/szolgaltatasok`, `/rolunk`      | S            |
| 10      | H3 = H2 méret, három lapon, egy CSS-javítással (2.1/P2-4, 3.1/P2-4)                      | `/`, `/szolgaltatasok`, `/rolunk` | S            |

---

## 8. Mérési napló (reprodukálás)

```
# Postgres és dev-szerver
su pgrun -s /bin/bash -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/kcpg/data \
  -l /var/lib/kcpg/pg.log -o \"-p 5433 -k '' -h 127.0.0.1\" start"
DATABASE_URI=postgres://postgres@127.0.0.1:5433/kineticare_local \
PAYLOAD_SECRET=... NEXT_PUBLIC_SERVER_URL=http://localhost:3000 npm run dev

cd <scratchpad>/audit-a
# szekció-geometria, kontraszt, CTA, kép, LCP, hajtás
KC_PATH=/               KC_NAME=home      node measure.mjs 1440 reduce
KC_PATH=/               KC_NAME=home      node measure.mjs 1440 no-preference
KC_PATH=/               KC_NAME=home      node measure.mjs 390  reduce
KC_PATH=/               KC_NAME=home      node measure.mjs 390  no-preference
KC_PATH=/               KC_NAME=home      node measure.mjs 320  reduce
KC_PATH=/szolgaltatasok KC_NAME=szolg     node measure.mjs 1440 reduce   # 1024, 390, 320 is
KC_PATH=/rolunk         KC_NAME=rolunk    node measure.mjs 1440 reduce   # 1024, 390, 320 is
KC_PATH=/kapcsolat      KC_NAME=kapcsolat node measure.mjs 1440 reduce   # 1024, 390, 320 is

node focuswalk.mjs /kapcsolat 34      # Tab-sorrend + fókuszjelölés (60 ms beállás)
node f6.mjs                           # az űrlapmező fókuszjelölése 900 ms beállás után
node sorhossz.mjs /rolunk 1440        # valódi karakter/sor canvas measureText-tel
node form.mjs                         # az időpontkérő űrlap mezői, autocomplete, inputmode
node pause.mjs /rolunk                # marquee-vezérlők, animációs idő
node motion.mjs /szolgaltatasok       # animációk reduce és no-preference alatt
node faq.mjs                          # GYIK kérdés-válasz + linkek, hero-címkék
node text.mjs /rolunk > txt_rolunk.txt

node ../shot.mjs http://localhost:3000/rolunk rolunk-1440.png 1440 reduce
node fold.mjs /kapcsolat fold-kapcsolat-390.png 390
python3 ../slice.py rolunk-1440.png r1440 1500
```

**Kép-jegyzék:** `home-1440.png`, `szolg-{1440,390}.png`, `rolunk-{1440,390}.png`,
`kapcsolat-{1440,390}.png`, szeletek `s1440-00..04.png`, `r1440-00..05.png`,
`k1440-00..02.png`, hajtás-képek `fold-{home,szolg,rolunk,kapcsolat}-390.png`,
nyers HTML `raw-{home,szolg,rolunk,kapcsolat}.html`, teljes szöveg `txt_*.txt`,
14 mérés-JSON `measure-<oldal>-<szélesség>-<mozgás>.json`.
