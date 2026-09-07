# Kezdőlap UX/UI-audit (WP14), 2026. szeptember 7.

**Mit vizsgáltam:** a `main` aznapi állapota a helyi fejlesztői szerveren
(`http://localhost:3000/`, seedelt kezdőlap a 14 blokkos szekciósorral, 2 termék,
8 tudástár-cikk). **Csak audit**, kódot nem módosítottam.

**Eszköz:** Chromium 1194 (playwright-core), 1440×900, 1024×768, 390×844 és 320×800 px,
`prefers-reduced-motion: reduce` és `no-preference` módban. Teljes oldalas képernyőképek
és DOM-mérések (szekció-geometria, számított színek, kontrasztarány, érintőcél, betűméret,
LCP-figyelő, Tab-sorrend). A mérőszkriptek és a képek a session-scratchpad `wp14/`
mappájában vannak (`measure.mjs`, `a11y.mjs`, `fold.mjs`, `focus.mjs`,
`measure-<szélesség>-<mozgás>.json`, `home-*.png`, `fold-*.png`).

**Módszer:** (1) heurisztikus végigjárás Nielsen tíz heurisztikájával
(<https://www.nngroup.com/articles/ten-usability-heuristics/>), (2) kognitív séta
Kovácsné personájával (`docs/felhasznaloi-seta.md`; NN/g:
<https://www.nngroup.com/articles/cognitive-walkthroughs/>), (3) mérés, (4) tartalmi
audit, (5) az M1-M8 cél-hierarchia (`docs/ertekesitesi-ux-skill.md`) összevetése a
tényleges sorrenddel.

**Amit NEM javaslok újra, mert ma más ügynök viszi:** az Időpontfoglalás menüpont
kivezetése (a mért fejlécben már nincs benne), az alapítói Rólunk-blokk és a fotó-fríz
egy szekcióba vonása, az ingyenes SOS a Kurzusaink rácsban (a mért oldalon már ott van),
valamint az „Erre számíthatsz velünk" és az „Így tudunk segíteni" szétválasztása (a mért
oldalon már két külön szekció).

**Mérési megjegyzés:** a helyi Postgres a mérés alatt kétszer rövid időre elérhetetlen
volt (dev-napló: `ECONNREFUSED 127.0.0.1:5433`), ilyenkor a kezdőlap a rögzített
fallback nézetet adja (5 szekció, kurzuskártya nélkül). Minden alábbi szám a teljes,
16 szekciós oldalról készült, a szekciószámot minden futás előtt ellenőriztem.

---

## 1. Összefoglaló

A kezdőlap tipográfiai és színrendszere rendben van: a betűméret kizárólag a három
tokenről jön (mért értékek: 16 / 19 / 40 px asztali gépen, 14 / 16 / 32 px mobilon),
szöveges elemre AA alatti kontrasztot nem találtam, minden fókuszjelölés látható
(3 px-es tömör keret), 320 px-en nincs vízszintes túlcsordulás, a mozgás
`prefers-reduced-motion` alatt leáll, a képeknek van alt-szövegük, és a címsor-sorrend
logikus (1 H1, 12 H2, alárendelt H3-ak).

A problémák a **sorrendben, a hangsúlyban és a hosszban** vannak:

1. **Mobilon a süti-sáv letakarja a hero mindkét gombját** (390 px: sáv 616 és 844 px
   között, gombok 667 és 780 px között). Aki nem intézi el a sütiket, nem tud a hero-ból
   továbbmenni. Ez a `docs/felhasznaloi-seta.md` 1.1 és 8.1 pontja: a mai mérés szerint
   változatlanul fennáll.
2. **Mozgással a filmsáv 4140 px** (4,6 képernyő asztali gépen, 3882 px = 4,6 képernyő
   mobilon), két apró felirattal. Az első ár mozgással csak **6190 px körül**, a 7.
   képernyőn jelenik meg (mobilon a 8. képernyőn). Reduce módban a filmsáv 1212 px.
3. **Az ingyenes SOS három belépési ponttal és a fizetősnél nagyobb vizuális súllyal
   szerepel**: hero másodlagos gomb (384 px széles, szélesebb az elsődleges 258 px-nél),
   kártya a Kurzusaink rácsban, és egy 848 px magas, sötétkék, fotós sáv. A fizetős
   program egyetlen, 524×487 px-es kártyán él. Ez az értékesítési skill K2-tilalma.
4. **A „kurzus vagy rendelő?" döntést segítő szekció („Így tudunk segíteni", három út)
   7158 px-nél, a 8. képernyőn van**, holott a persona pontosan ezért jött. Előtte négy
   szekció (Rólunk, hitelcsík, ismételt hívás, sajtólogók) és két „miért mi" blokk
   (Szeretnél megszabadulni…, Erre számíthatsz velünk) érvel ugyanarról.
5. **A kurzuskártyákon nincs látható gomb**: az egész kártya link, egyetlen nyíl-ikonnal;
   a persona nem tudja, hova kattintson, és mi történik.

Ezek mellett tucatnyi kisebb, javarészt S-méretű tétel: a hero „Kéz / Csukló / Könyök /
Váll" gombnak látszó, nem kattintható címkéi; a hero-bevezető nem mondja ki, hogy online
videós programról van szó; a nevek háromszoros ismétlése a fríz és a Rólunk-blokk között;
két fotó kétszer szerepel az oldalon; a sajtólogó-sor felirata („Itt találkozhattál
velünk") alá szakmai egyesületek tagsági logói kerültek; és az első hat szekció
(0-tól 4527 px-ig) ugyanazon a háttéren fut, szekcióhatár nélkül.

---

## 2. Mért táblázat: szekciók

Oszlopok: kezdő y és magasság px-ben (1440 px reduce / 1440 px mozgással / 390 px reduce /
390 px mozgással), számított háttérszín, H2 (mért betűméret), látható CTA-k (mért doboz).

| #   | Szekció (osztály)                        | 1440 reduce y +h | 1440 mozgás y +h | 390 reduce y +h | 390 mozgás y +h | Háttér                 | H2                                                                             | CTA-k                                                                                                    |
| --- | ---------------------------------------- | ---------------- | ---------------- | --------------- | --------------- | ---------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| 1   | Filmsáv (`kc-film-hero`)                 | 0 +1212          | 0 +4140          | 0 +1133         | 0 +3882         | #f6f9fc + poszter      | H1 40 px: Hatékony és biztonságos módszerek a kéz és a kar fájdalmai ellen     | „Nézd meg a kurzusokat" (258×55, `/kurzusok`); „Nézd meg ingyenes SOS-kurzusunkat" (384×55, `#ingyenes`) |
| 2   | Fotó-fríz (`kc-photo-frieze`)            | 1212 +611        | 4140 +611        | 1133 +435       | 3882 +435       | #f6f9fc                | nincs                                                                          | nincs                                                                                                    |
| 3   | Rólunk (`kc-about`)                      | 1823 +736        | 4751 +736        | 1568 +1324      | 4318 +1324      | #f6f9fc                | Kiss Kata és Kocsis Kata vagyunk                                               | nincs                                                                                                    |
| 4   | Hitelcsík (`kc-creds`)                   | 2559 +113        | 5487 +113        | 2892 +181       | 5642 +181       | #f6f9fc                | nincs                                                                          | „Ismerd meg a hátterünket" link (250×44)                                                                 |
| 5   | Kurzusaink (`kc-course-showcase-band`)   | 2672 +1232       | 5599 +1232       | 3072 +1142      | 5822 +1142      | #f6f9fc                | Kurzusaink (+ óriás vízjel „Kurzusaink")                                       | 2 kártya-link (524×487, 524×482), gomb nélkül                                                            |
| 6   | Így működik (`kc-how`)                   | 3904 +623        | 6831 +623        | 4215 +653       | 6965 +653       | #f6f9fc                | Így működik az online kurzus                                                   | nincs                                                                                                    |
| 7   | Ingyenes SOS (`kc-free-sos`)             | 4527 +848        | 7454 +849        | 4867 +905       | 7617 +905       | **#2f6e9f** (sötétkék) | SOS Kézrelax: ingyenes villámkurzus                                            | „Elindítom ingyen" (251×55, termékoldal)                                                                 |
| 8   | Sajtólogók (`kc-press`)                  | 5375 +330        | 8303 +310        | 5772 +418       | 8522 +280       | #f6f9fc                | nincs (felirat: Itt találkozhattál velünk)                                     | mozgásnál „Megállítom a logósort" (44×44)                                                                |
| 9   | Fájdalom-blokk (`kc-welcome`)            | 5705 +633        | 8612 +633        | 6190 +1034      | 8802 +1034      | #f6f9fc                | Szeretnél megszabadulni a fájdalomtól, de hiába próbáltál ki (szinte) mindent? | nincs                                                                                                    |
| 10  | Erre számíthatsz (`kc-services--photo`)  | 6338 +820        | 9245 +820        | 7224 +1320      | 9836 +1320      | #f6f9fc                | Erre számíthatsz velünk                                                        | nincs                                                                                                    |
| 11  | Így tudunk segíteni (`kc-services--sin`) | 7158 +670        | 10065 +670       | 8544 +1457      | 11156 +1457     | #f4f8fd (tint)         | Így tudunk segíteni                                                            | „Tovább a kezelésekre" (267×55); rejtett panelekben „Nézd meg a kurzusokat", „Nézd meg a kézworkshopot"  |
| 12  | Vélemények (`kc-testimonials`)           | 7827 +900        | 10735 +900       | 10001 +1341     | 12613 +1341     | #e6f0f8 (tint)         | Pácienseink mondták                                                            | nincs                                                                                                    |
| 13  | Tudástár (`kc-knowledge`)                | 8727 +548        | 11635 +548       | 11342 +870      | 13954 +870      | #f6f9fc                | Legfrissebb a tudástárból                                                      | 3 cikk-link + „Nézd meg a tudástárat" (224×44)                                                           |
| 14  | GYIK (`kc-faq`)                          | 9275 +527        | 12182 +527       | 12212 +499      | 14824 +499      | #f6f9fc                | Gyakori kérdések                                                               | 5 lenyíló                                                                                                |
| 15  | Záró hívás (`kc-cta-banner`)             | 9802 +359        | 12709 +359       | 12711 +372      | 15322 +372      | #e6f0f8 (tint)         | Kezdd el még ma                                                                | „Nézd meg a kurzusokat" (258×55)                                                                         |
| 16  | Barion-sáv (`kc-barion`)                 | 10161 +199       | 13068 +199       | 13082 +335      | 15694 +335      | #f6f9fc                | Biztonságos fizetés (16 px, 600)                                               | nincs                                                                                                    |
|     | Lábléc (Kapcsolat, hírlevél, jogi)       | 10360 +614       | 13267 +614       | 13417 +882      | 16029 +882      | #f6f9fc                | Hírlevél (H2, S)                                                               | „Feliratkozom"                                                                                           |

**Oldalhossz:** 1440 px: 10 974 px reduce (12,2 képernyő), 13 881 px mozgással
(15,4 képernyő). 390 px: 14 299 px reduce (16,9 képernyő), 16 911 px mozgással
(20 képernyő). 320 px: 15 303 px. 1024 px: 10 700 px.

### 2.1 Az első képernyő (hajtás fölött)

|                       | 1440×900                                                                                        | 390×844                                           |
| --------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Fejléc                | 72 px; Szolgáltatások (lenyíló), Rólunk, Tudástár, Kapcsolat, Belépés, „Kurzusok" gomb (110×47) | 56 px; „Kurzusok" gomb (98×44), hamburger (44×44) |
| H1                    | 154 és 384 px között, **5 sorban** (40 px, Tenor Sans)                                          | 234 és 421 px között, 5 sor (32 px)               |
| Bevezető              | 408 és 526 px között, 4 sor                                                                     | 445 és 571 px között, 5 sor                       |
| Címkék                | Kéz, Csukló, Könyök, Váll (`li`, nem kattintható)                                               | ugyanaz, 616 px-nél                               |
| CTA-k                 | 625 és 679, 691 és 746 px között; **mindkettő a hajtás fölött**                                 | 667 és 717, 729 és 780 px között                  |
| Süti-sáv              | 804 és 884 px között; **nem takar**                                                             | **616 és 844 px között; mindkét CTA-t takarja**   |
| Ár, „online", „videó" | nincs                                                                                           | nincs                                             |

1024×768 px-en mindkét hero-gomb látszik (574 és 662 px), a süti-sáv alatta van.

### 2.2 CTA-k száma és sorrendje (látható, 1440 px, felülről)

1. Fejléc „Kurzusok" (elsődleges, sötét)
2. Hero „Nézd meg a kurzusokat" (elsődleges, kék #2f6e9f, 5,45:1 fehér szöveggel)
3. Hero „Nézd meg ingyenes SOS-kurzusunkat" (keretes, navy keret 15,6:1, **szélesebb az elsődlegesnél**)
4. Hitelcsík „Ismerd meg a hátterünket" (link)
5. Kurzusaink: 2 kártya-link, gomb nélkül
6. Ingyenes SOS „Elindítom ingyen" (fehér keretes a sötétkéken)
7. Sín „Tovább a kezelésekre" (navy, 12,8:1 a felülettel)
8. Tudástár 3 cikk-link + „Nézd meg a tudástárat" (link)
9. Záró „Nézd meg a kurzusokat"
10. Lábléc „Feliratkozom", „Kapcsolat" óriáslink

A fizetős irányba 4 hívás mutat (fejléc, hero, sín rejtett panel, záró), az ingyenesbe 3
(hero, kártya, sáv). Ugyanaz a cselekvés ugyanazzal a felirattal: „Nézd meg a kurzusokat"
háromszor, azonos; az SOS viszont három feliratot visel („Nézd meg ingyenes
SOS-kurzusunkat", a kártya címe, „Elindítom ingyen"), és a hero-gomb nem a termékre,
hanem a `#ingyenes` sávra ugrik (1440 px reduce: 4527 px-re, mozgással 7454 px-re).

### 2.3 Tipográfia, kontraszt, érintőcél, sorhossz

| Mérés                                                                    | Eredmény                                                                                                                   | Küszöb / forrás                     |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Előforduló betűméretek                                                   | 1440: 16 / 19 / 40 px; 390: 14,1 / 16,2 / 32,5 px                                                                          | három token, teljesül               |
| H1 és H2                                                                 | 40 px, 400 súly, Tenor Sans; H2 kontraszt 14,8:1                                                                           | WCAG 1.4.3 teljesül                 |
| H3 „Szakmai figyelem", „Segítség a mindennapokhoz", „Rendelői kezelések" | **40 px, azonos a H2-vel**                                                                                                 | NN/g vizuális hierarchia, lásd P2-8 |
| H3 „Kiválasztod a kurzust" stb., tudástár-címek                          | 19 px, 600                                                                                                                 | rendben                             |
| Legkisebb szövegkontraszt                                                | 5,16:1 (link-kék #2f6e9f a #f6f9fc háttéren)                                                                               | ≥ 4,5:1 teljesül                    |
| AA alatti szöveg                                                         | egy sem (teljes DOM-szkennelés, 1440 px)                                                                                   | WCAG 1.4.3                          |
| Gombfelület a felülethez                                                 | elsődleges 5,16:1, sötét 12,8:1, záró 4,72:1                                                                               | ≥ 3:1 teljesül (WCAG 1.4.11)        |
| Érintőcélok                                                              | minden látható link és gomb ≥ 44 px magas; a lábléc jogi linkjei 22 px magasak (soron belüli szöveglink, kivétel alá esik) | WCAG 2.5.8                          |
| Fókuszjelölés                                                            | 3 px tömör keret (navy vagy kék) minden bejárt elemen, a kurzuskártyán is                                                  | WCAG 2.4.7 teljesül                 |
| Sorhossz, asztali törzs                                                  | 45 és 75 karakter között (hasábok `max-width`-del)                                                                         | rendben                             |
| Sorhossz, 390 px                                                         | 33 és 48 karakter között                                                                                                   | rendben mobilon                     |
| Vízszintes túlcsordulás 320 px                                           | `scrollWidth` = 320                                                                                                        | WCAG 1.4.10 teljesül                |
| 320 px, két soros gombok                                                 | „Nézd meg ingyenes SOS-kurzusunkat" 280×73; „Tovább a kezelésekre" 190×73                                                  | működik, lásd P3-7                  |

### 2.4 Sáv-ritmus (háttérszínek sorrendje, felülről)

`#f6f9fc` ×6 (filmsáv, fríz, Rólunk, hitelcsík, Kurzusaink, Így működik; 0 és 4527 px
között) → `#2f6e9f` sötétkék (SOS) → `#f6f9fc` ×3 (sajtó, fájdalom-blokk, Erre
számíthatsz) → `#f4f8fd` tint (sín) → `#e6f0f8` tint (vélemények) → `#f6f9fc` ×2
(tudástár, GYIK) → `#e6f0f8` (záró hívás) → `#f6f9fc` (Barion, lábléc).

Két gond: a lap első felében nincs váltás (a szekcióhatárt csak 1 px-es vonalak adják),
a sín és a vélemények pedig két, egymás melletti, csaknem azonos tint.

### 2.5 LCP és képek

| Mérés              | Eredmény                                                                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LCP-elem           | a H1 szöveg (`scroll-scrub__title`), 1,6 s a dev-szerveren 1440 px-en, 1,6 s 320 px-en (390 px-en egyszer 4,3 s, a DB-kihagyás alatt)                                                                   |
| Hero-poszter       | `one-hand-header-v1-poster.webp` 1920×1080, **507 KB**, `loading=eager`, `fetchpriority=high`; mobil poszter 21 KB                                                                                      |
| Hero-videó         | `one-hand-header-v1.mp4` 2,8 MB (asztali), 0,9 MB (mobil); reduce módban nem töltődik                                                                                                                   |
| Fríz               | 4 kép `next/image`-en, 384 px-es változat 259×497 px-es csíkhoz (DPR 1)                                                                                                                                 |
| Kurzuskártyák      | két PNG packshot (1080×750, 1080×880) `next/image`-en, `alt=""`, a link `aria-label`-lel                                                                                                                |
| Kurzusaink-jelenet | **3 teljes méretű webp** (`founders-shared-laugh-1600` 61 KB, `hand-treatment-detail-1600` 105 KB, `founders-intro-white-1600` 67 KB) 284×242 px-es dobozokba, `next/image` nélkül, 5,6-szoros túlméret |
| Ismétlődő fotó     | `hand-treatment-detail` (fríz 3. csík + jelenet 2. fotó), `founders-intro-white` (Rólunk + jelenet 3. fotó)                                                                                             |
| Sajtólogók         | 10 PNG/WebP 176×52 px-es dobozban, szürkeárnyalatban; a Kossuth Rádió 107×129-es álló logója a fekvő dobozban apró                                                                                      |

---

## 3. Találatok rangsorolva

Jelölés: **P1** blokkoló (a fő cél, a kurzusértékesítés sérül), **P2** fontos, **P3**
finomítás. Méret: S (egy fájl, egy óra alatt), M (több fájl vagy tulajdonosi döntés),
L (szerkezeti).

### P1: blokkoló

**P1-1. Mobilon a süti-sáv letakarja mindkét hero-gombot.**
Mért: 390×844 px-en a sáv 616 és 844 px között áll (szöveg, „Elfogadom mindet"
722 és 769, „Csak a szükségeseket" 781 és 828 px között), a hero két gombja 667 és 717,
illetve 729 és 780 px között van. Képernyőkép: `wp14/fold-390-consent.png`.
Heurisztika: NN/g #1 (a rendszer állapotának láthatósága) és #7 (hatékonyság);
WCAG 2.2 SC 2.4.11 Fókusz nem takart (minimum),
<https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html>;
GOV.UK süti-sáv komponens: a sáv az oldal TETEJÉN, a tartalom előtt áll, nem lebeg
fölötte, <https://design-system.service.gov.uk/components/cookie-banner/>.
Javaslat: (a) a süti-sáv mobilon a fejléc alatt, a folyamban (nem `position: fixed`),
vagy (b) ha marad lebegő, a hero belső alsó térköze mobilon legyen legalább a sáv
magassága (`padding-bottom: var(--kc-space-12)` nagyságrend, mérve 228 px), hogy a két
gomb a sáv fölé kerüljön, vagy (c) egysoros sáv (szöveg + két gomb egy sorban, ~96 px).
Várható hatás: a mobil hero-gombok kattinthatók az első képernyőn; a
`$pageview → course_viewed` arány mobilon nő. Méret: S (b) / M (a).

**P1-2. A filmsáv mozgással 4,6 képernyő tartalom nélkül, az első ár a 7. képernyőn.**
Mért: `no-preference` mellett a `kc-film-hero` 0 és 4140 px között (1440×900), 0 és
3882 px között (390×844). A 2. és 3. képernyőn a kézposzter és egy-egy rövid felirat
(„Minden alkalommal egy mozdulattal több", „A következő mozdulat a tiéd"). Az első
kurzuskártya ára mozgással 6190 px körül (7. képernyő), mobilon 6430 px körül (8.
képernyő). Reduce módban ugyanez 3260 px (4. képernyő).
Forrás: NN/g Scrolling and Attention: az első képernyő kapja a nézési idő 57%-át, a
második 17%-ot, a maradék 26% oszlik el a többin,
<https://www.nngroup.com/articles/scrolling-and-attention/>; NN/g The Fold Manifesto (a
hajtás fölötti tartalom döntő, a lentebbi csak akkor ér célt, ha a felső rész oda
vezet), <https://www.nngroup.com/articles/page-fold-manifesto/>; Apple HIG Motion: a
mozgás ne késleltesse a feladatot, <https://developer.apple.com/design/human-interface-guidelines/motion>.
Javaslat: a scrub hossza a jelenlegi harmadára (a `segment.weight` értékek összege
~4,6 dvh-ról ~1,6 dvh-ra), a két úszó felirat egy állásba vonva; a kéznyitás filmje
megmarad, csak rövidebb görgetésre fut le. A tulajdonos szerint a videó „jól működik",
ezért ez **tulajdonosi döntés**: az audit a hosszt, nem a filmet kifogásolja.
Várható hatás: az első ár a 3. képernyőre kerül mozgással is. Méret: M.

**P1-3. Az ingyenes SOS három helyen, a fizetős programnál nagyobb súllyal.**
Mért: (1) hero másodlagos gomb 384×55 px, az elsődleges 258×55 (a másodlagos 49%-kal
szélesebb, navy kerettel 15,6:1); (2) kártya a Kurzusaink rácsban (524×482 px); (3)
önálló sötétkék sáv 848 px magassággal, 473×672 px-es fotóval és saját H2-vel. A fizetős
Otthoni KézRehab Program egy 524×487 px-es kártya. A sáv a Kurzusaink után 1855 px-szel
ismétli, ami a rácsban már megvan.
Forrás: `docs/ertekesitesi-ux-skill.md` 2. (M4: „vizuálisan másodlagos súllyal") és 6.
pont (K2 tilalom); NN/g #8 (esztétika és minimalizmus: minden plusz elem versenyez a
fontossal), <https://www.nngroup.com/articles/ten-usability-heuristics/>; GOV.UK Button:
oldalanként egy elsődleges gomb,
<https://design-system.service.gov.uk/components/button/>; Material 3 gomb-hierarchia
(filled > outlined > text), <https://m3.material.io/components/buttons/guidelines>.
Javaslat: mivel az SOS ma bekerült a Kurzusaink rácsba, a `freeSos` blokk vagy
elrejthető (`sectionSettings.visible = false`, CMS, azonnal), vagy kompakt formára vált:
tint háttér (`--kc-color-tint-cool`), fotó nélkül, egy sor + „Elindítom ingyen", ~300 px.
A hero másodlagos gombja legyen szövegstílusú (`kc-button--link` jellegű, „quiet"), és a
célja a termékoldal (`/kurzusok/sos-kezrelax-villamkurzus`) vagy a `#kurzusok` horgony, ne
egy 4500 px-re lévő sáv. **Tulajdonosi döntés**, mert a sáv a levél K5/P3 tétele.
Várható hatás: a fizetős kártya lesz az oldal legerősebb ajánlata; az oldal 550 px-szel
rövidül. Méret: S (elrejtés) / M (kompakt változat).

### P2: fontos

**P2-1. A „kurzus vagy rendelő?" döntés segítője a 8. képernyőn van.**
Mért: a sín („Így tudunk segíteni", három út: rendelő, otthoni program, képzés) 7158 px-nél
kezdődik (mozgással 10 065 px-nél; mobilon 8544 / 11 156 px). Előtte a Rólunk-blokk
(736 px), a hitelcsík (113), az SOS-sáv (848), a sajtólogók (330), a fájdalom-blokk (633)
és az „Erre számíthatsz velünk" (820). A GYIK első kérdése ugyanezt válaszolja meg
(„Online kurzust vagy személyes kezelést válasszak?") 9275 px-nél.
Forrás: NN/g #2 (a rendszer és a valós világ egyezése: a látogató saját kérdése
legyen a vezérfonal) és #6 (felismerés a felidézés helyett); Baymard Homepage & Category
kutatás: a kezdőlap legfontosabb feladata, hogy a látogató típusát a megfelelő útra
terelje, <https://baymard.com/research/homepage-and-category-navigation>.
Javaslat: a `services` (sín) blokk a szekciósorban közvetlenül a fríz+Rólunk után,
a Kurzusaink elé vagy mögé (CMS-átrendezés, kód nélkül); a rendelői út gombja marad,
az otthoni út panelje a `#kurzusok` horgonyra mutat. A fájdalom-blokk és az „Erre
számíthatsz" közül egy marad (lásd P2-11).
Várható hatás: a persona a 3. képernyőn elágazik, nem a 8.-on. Méret: S (átrendezés
a CMS-ben) / M (ha a panelek célja is változik).

**P2-2. A hero nem mondja ki, hogy online videós program, és nem mond árat.**
Mért: H1 „Hatékony és biztonságos módszerek a kéz és a kar fájdalmai ellen"; bevezető:
„Professzionális, mégis emberközeli terápiás megoldásokkal kezeljük a különböző
mozgásszervi problémákat, hogy te ismét önfeledten dolgozhass, sportolhass vagy
gondoskodhass szeretteidről." Az „online", „videó", „otthon", „Ft" szavak az első
képernyőn nem fordulnak elő; a „mozgásszervi problémák" tágabb a kéznél. A fríz
felirata („Két rendelő Budapesten, és egy otthoni program.") viszont az oldal
legvilágosabb mondata, csak 1212 px-nél áll.
Forrás: NN/g How Users Read on the Web (a felhasználó pásztáz, a konkrét szó számít),
<https://www.nngroup.com/articles/how-users-read-on-the-web/>; NN/g #2; `docs/felhasznaloi-seta.md`
1.2 (ugyanez a hiba, javaslattal).
Javaslat (CMS, `filmHero.lead`): „Online videós kézrehabilitációs program otthonra és
személyes kezelés két budapesti rendelőben. Gyógytornászok vezetik, a kéz, a csukló, a
könyök és a váll panaszaira." A H1 hasábja asztali gépen 5 sorba tördel (max-width
~340 px); `max-width: 18ch` helyett ~`24ch` három sort ad (mért: 40 px-es Tenor Sansban
a 46 karakteres cím 3 sor ~560 px-en). Méret: S.

**P2-3. A hero címkéi gombnak látszanak, de nem kattinthatók.**
Mért: `<ul class="scroll-scrub__tags"><li>Kéz</li>…` négy kerekített, keretes csip,
`cursor` alap, fókuszálhatatlan. Formájuk azonos a szűrőcsipekével.
Forrás: NN/g Flat Design: a hamis affordancia kattintási kísérleteket és bizalomvesztést
okoz, <https://www.nngroup.com/articles/flat-design/>; NN/g #4 (következetesség és
szabványok); WCAG 2.2 SC 1.3.1 (a vizuális szerep ne állítson mást, mint a szemantika).
Javaslat: vagy sima felsorolás csip-keret nélkül (S-token, vesszővel: „Kéz, csukló,
könyök, váll"), vagy valódi linkek a Szolgáltatások megfelelő horgonyaira (akkor
`<a>` és fókuszjelölés). Méret: S.

**P2-4. A hero másodlagos gombja erősebb az elsődlegesnél, és rossz helyre ugrik.**
Mért: lásd P1-3 (384 px vs 258 px, navy keret 15,6:1 vs kék felület 5,16:1). A
`#ingyenes` cél reduce módban 4527 px-nél, mozgással 7454 px-nél van; ott egy újabb gomb
(„Elindítom ingyen") vár. A felirat „Nézd meg…" ugrást ígér, nem indítást; kétlépcsős.
Forrás: GOV.UK Button (másodlagos gomb csak kevésbé fontos cselekvésre, egy elsődleges),
<https://design-system.service.gov.uk/components/button/>; Apple HIG Buttons (a
hangsúly a fontosságot tükrözze),
<https://developer.apple.com/design/human-interface-guidelines/buttons>; WCAG 2.2 SC
2.4.4 Link célja, <https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html>.
Javaslat: a másodlagos legyen szöveglink-stílus (`kc-button--link`, nyíllal) vagy
legfeljebb az elsődlegessel azonos széles; célja a `#kurzusok` horgony (ahol az SOS-kártya
az ár helyén „Ingyenes" felirattal áll). Méret: S.

**P2-5. A kurzuskártyákon nincs látható gomb.**
Mért: a kártya teljes felülete egy `<a>` (524×487 px), a jobb felső sarokban egy
44 px-es körben nyíl-ikon (`aria-hidden`), a link `aria-label`-je „…: a kurzus
részletei". Szöveges hívás nincs. Ugyanez a `docs/felhasznaloi-seta.md` 2.2 pontja a
listaoldalon.
Forrás: NN/g Cards (a kártya egészének kattinthatósága mellett legyen explicit
cselekvés), <https://www.nngroup.com/articles/cards-component/>; NN/g #6 (felismerés);
Baymard listaoldal-kutatás: a listaelem mutassa a legfontosabb döntési adatokat és a
továbblépést, <https://baymard.com/research/homepage-and-category-navigation>.
Javaslat: a kártya alján (az ár alatt) a szótár szerinti felirat: fizetősnél
„Nyisd meg a kurzusoldalt" (`course-sales-open`, §3.2 #29) másodlagos stílusban,
ingyenesnél „Elindítom ingyen" (`free-course-claim`); a nyíl-ikon maradhat. A kártya
marad egy link, a felirat a linken belüli `span`. Méret: S.

**P2-6. A sajtólogó-sor felirata félrevezető, és a rács egyenetlen.**
Mért: „Itt találkozhattál velünk" alatt 10 logó, ebből 3 szakmai egyesület
(MGYFT, MASE, Magyar Kézsebész Társaság), amelyek tagságok, nem médiamegjelenések (a
hitelcsík külön mondja: „Szakmai egyesületi tagság"). 1440 px-en 6 + 4-es sorokban, a
négy új logó sötétebb és nagyobbnak hat; a Kossuth Rádió álló logója a 176×52-es fekvő
dobozban apró.
Forrás: NN/g Trustworthiness in Web Design (a hitel-jelzések akkor működnek, ha
pontosak és ellenőrizhetők), <https://www.nngroup.com/articles/trustworthiness-in-web-design/>;
NN/g #2; WCAG 2.2 SC 2.4.6 Címsorok és címkék,
<https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html>.
Javaslat: két csoport két felirattal: „Médiamegjelenések" (Nők Lapja, Karc FM,
Házipatika, Képmás, iSport, Kossuth Rádió, TV2) és „Szakmai szervezetek, ahol tagok
vagyunk" (MGYFT, MASE, Kézsebész Társaság); vagy egy közös, igaz felirat: „Sajtó és
szakmai szervezetek". Egyforma optikai méret (max-height a dobozon, `object-fit:
contain`). Méret: S (felirat, CMS) / M (két rács).

**P2-7. Az első hat szekció ugyanazon a háttéren fut, majd két tint egymás mellett.**
Mért: 0 és 4527 px között (filmsáv, fríz, Rólunk, hitelcsík, Kurzusaink, Így működik)
mind `#f6f9fc`; a sín `#f4f8fd` és a vélemények `#e6f0f8` egymást követik.
Forrás: NN/g Visual Hierarchy (csoportosítás és háttér is építi a hierarchiát),
<https://www.nngroup.com/articles/visual-hierarchy-ux-definition/>; NN/g Common
Region (Gestalt: a közös háttér csoportot jelez),
<https://www.nngroup.com/articles/common-region/>; `docs/szekcio-rendszer-terv.md` 2.
(a blokkok `hatter` mezője éppen erre való).
Javaslat: a Kurzusaink blokk `hatter: tint` (`--kc-color-tint-cool`), a sín `feher`;
így a ritmus: fehér (hero+fríz+Rólunk) → tint (Kurzusaink) → fehér (Így működik) → …
→ fehér (sín) → tint (vélemények). CMS-beállítás, kód nélkül. Méret: S.

**P2-8. A H3-ak akkorák, mint a H2.**
Mért: „Szakmai figyelem", „Segítség a mindennapokhoz" (Erre számíthatsz) és
„Rendelői kezelések" (sín panel) 40 px, 400 súly, azonos a szekció H2-jével; ugyanitt a
H2 „Erre számíthatsz velünk" három sorba tördel egy 290 px-es hasábban. A többi H3 (Így
működik, Tudástár) 19 px 600, ami a helyes minta.
Forrás: NN/g Visual Hierarchy (a szint különbsége méretből, súlyból, elhelyezésből
együtt), <https://www.nngroup.com/articles/visual-hierarchy-ux-definition/>; GOV.UK
Headings (a címsorszintek lépcsője látható legyen),
<https://design-system.service.gov.uk/styles/headings/>; WCAG 2.2 SC 2.4.6.
Javaslat: a `services.css` és `services-sin.css` H3-a `--kc-font-m` + 600 súly (Nunito
Sans), a sorszám („01") marad S-tokenen; a H2 hasábja legalább 22ch. Méret: S.

**P2-9. Két fotó kétszer szerepel, és a jelenet teljes méretű képeket tölt.**
Mért: `hand-treatment-detail-1600.webp` a frízben (3. csík) és a Kurzusaink-jelenetben
(2. fotó); `founders-intro-white-1600.webp` a Rólunk-blokkban és a jelenet 3. fotóján.
A jelenet három képe `next/image` nélkül, 1600 px-es forrással 284×242 px-es dobozban
(összesen ~233 KB).
Forrás: NN/g #8 (minimalizmus, ismétlés nélkül); web.dev responsive images,
<https://web.dev/articles/serve-responsive-images>; a brief fotólistája (manifest).
Javaslat: a jelenet fotói a manifest még nem használt képei legyenek
(`portrait-seated-ball-a`, `tablet-anatomical-model`, `laptop-exercise-equipment`), és
`next/image` `sizes="(max-width: 600px) 60vw, 300px"`. Méret: S (kódban él:
`course-showcase.ts`).

**P2-10. A nevek háromszor 600 px-en belül.**
Mért: fríz-felirat „Kiss Kata és Kocsis Kata, gyógytornászok" (1730 px), H2 „Kiss Kata
és Kocsis Kata vagyunk" (1900 px), első bekezdés „Kiss Kata és Kocsis Kata vagyunk,
gyógytornászok." (1990 px).
Forrás: NN/g How Users Read on the Web (ismétlés = zaj a pásztázásnak); NN/g #8.
Javaslat (CMS, `about` blokk): H2 „Két gyógytornász, egy cél: hogy ne fájjon", első
bekezdés „A kéz, a csukló, a könyök és a váll rehabilitációjával foglalkozunk,
személyesen két budapesti rendelőben és otthoni videókurzussal." A fríz-felirat marad.
Mivel a fríz és a Rólunk ma összevonás alatt áll, ezt az összevonó ügynöknek érdemes
átadni. Méret: S.

**P2-11. Öt szekció érvel ugyanarról („miért mi"), a termék után.**
Mért: Rólunk (736 px) + hitelcsík (113) + fájdalom-blokk (633) + Erre számíthatsz (820) +
sín bevezető (670); ebből 2123 px a Kurzusaink UTÁN. A fájdalom-blokk („Tudjuk, milyen,
amikor…") és az „Erre számíthatsz" mondanivalója átfed („Rendelői kezeléssel és otthoni
videókurzussal is támogatunk" vs. a Rólunk „Személyes kezeléssel és otthoni
videókurzussal segítünk…").
Forrás: NN/g #8; NN/g Scrolling and Attention; `docs/ertekesitesi-ux-skill.md` 2.
(M2 egy sor, M5-M8 támogató).
Javaslat: a fájdalom-blokk (jó konverziós pszichológia, `docs/ux-hierarchia-audit.md`
4.) maradjon, de közvetlenül a hero után, a fríz elé vagy mögé, 2 oszlopból 1-be
tömörítve; az „Erre számíthatsz" két tétele a Rólunk-blokk „feature" listájába olvad
(ott ma egyetlen tétel áll: „Személyre szabott rendelői kezelések"); a hitelcsík három
pontja szintén oda. Így három szekció (Rólunk+feature, fájdalom, sín) marad az ötből.
**Tulajdonosi döntés** (K7 közös kép az „Erre számíthatsz" mellé). Méret: M.

**P2-12. Az M-sorrend eltér a cél-hierarchiától: M3 a negyedik, M4 megelőzi M2-t.**
Mért sorrend: M1 (hero) → [fríz] → [Rólunk] → M2 (hitelcsík) → M3 (Kurzusaink) → M5
(Így működik) → M4 (SOS-sáv) → [sajtó] → [fájdalom] → [Erre számíthatsz] → [sín] → M6
(vélemények) → M7 (tudástár) → M8 (GYIK) → [záró hívás] → [Barion]. A hitelcsík a
Rólunk-blokk UTÁN áll, pedig annak a tartalmát („gyógytornászok") már elmondta.
Forrás: `docs/ertekesitesi-ux-skill.md` 2. (M2 a hero ALATT tömören, M3 elsődleges);
`docs/szekcio-rendszer-terv.md` 4. (alapsorrend: filmHero → credsStrip → courseCards →
freeSos). Javaslat: hitelcsík a fríz alá (a fríz-felirat sorába, egy sorban), a
Rólunk-blokk a Kurzusaink + Így működik UTÁN (a tulajdonos K1 kérése, „legelőször saját
fotó fogadjon", a frízzel teljesül). Méret: S (CMS-átrendezés), a fríz+Rólunk összevonás
állapotától függően M.

### P3: finomítás

**P3-1. A „Kurzusaink" szó kétszer a szekcióban.** H2 „Kurzusaink" (2760 px), alatta
1230 px-en belül a 210 px magas vízjel „Kurzusaink". Forrás: NN/g #8. Javaslat: a
vízjel szava a jelenethez illő, más szó („Otthon", „Gyakorolj"), vagy a H2 marad és a
vízjel a szekció tetejére kerül a H2 helyett (a `course-showcase` a H2-t a vízjel
`aria-hidden` mellett tartja). Méret: S. (Az Astra-referencia a tulajdonos kedvence,
ezért csak a szóismétlést kifogásolom, a jelenetet nem.)

**P3-2. A stat-sor harmadik tétele nem szám.** „1 · közös cél: fájdalommentesség" a
„10+ év" és „1000+ páciens" mellett. Forrás: NN/g Trustworthiness (a számok akkor
hitelesek, ha mérhetők). Javaslat: „2 rendelő Budapesten" vagy „2 szakmai egyesületi
tagság" (a Rólunk-oldal stat-készletében már létezik). CMS. Méret: S.

**P3-3. A GYIK 2. válasza árat ígér, de nem linkel.** „A pontos tartalmat és az árat a
kurzus oldalán találod." link nélkül (zsákutca-mondat). Forrás: NN/g #7; WCAG 2.4.4.
Javaslat: a válaszban link a `/kurzusok` oldalra. CMS. Méret: S.

**P3-4. A sín első gombja eltér a szótártól.** „Tovább a kezelésekre" a §3.2 #40
„Nézd meg a kezeléseket" helyett (a szótár kommentje szerint szerkesztői zárolás
2026-09-06-án). A másik két panel a szótárt követi („Nézd meg a kurzusokat", „Nézd meg
a kézworkshopot"). Forrás: WCAG 2.2 SC 3.2.4 Következetes azonosítás,
<https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html>;
`termektervezes` skill 2. („a puszta Tovább… nem CTA"). Javaslat: tulajdonosi döntés a
két felirat között; az audit a szótári alakot javasolja. Méret: S.

**P3-5. Fríz-feliratok írásjelezése.** Bal: „Kiss Kata és Kocsis Kata, gyógytornászok"
(pont nélkül), jobb: „Két rendelő Budapesten, és egy otthoni program." (ponttal, és a
vessző az „és" előtt fölösleges). Javaslat: mindkettő pont nélkül, a jobb: „Két rendelő
Budapesten és egy otthoni program". Méret: S (`PhotoFrieze.tsx`).

**P3-6. A sín bal oldali tételei rádiógombos címkék, tab-affordancia nélkül.** Mért:
három `label` (421×71 px, `cursor: pointer`), az aktív sötét ikonnal; billentyűzettel a
rádió nyilai működnek. A persona listának nézheti, nem választónak. Forrás: NN/g Tabs,
Used Right, <https://www.nngroup.com/articles/tabs-used-right/>. Javaslat: a nem aktív
tételeknél halvány „Megnézem" jelzés vagy chevron az S-tokenen; mobilon (390 px, 1457
px-es szekció) fontolható a három panel egymás alá tétele választó nélkül. Méret: S/M.

**P3-7. 320 px-en két gomb két soros.** „Nézd meg ingyenes SOS-kurzusunkat" 280×73 px,
„Tovább a kezelésekre" 190×73 px. Működik (WCAG 1.4.10 teljesül), de a szótár rövidebb
alakjai („Nézd meg a kezeléseket") egy sorba férnének. Méret: S.

**P3-8. A hero-poszter 507 KB, `fetchpriority=high`.** A LCP ma a H1 szöveg, tehát nem
lassít, de a poszter egy 1920×1080-as webp, amelyből ~150 KB-os változat elegendő
(q≈70). Forrás: web.dev LCP, <https://web.dev/articles/lcp>. Méret: S (asset-csere).

**P3-9. A vélemény-tábla első idézete 40 px-en 7 sor.** 166 karakter a display-méreten
(900 px-es szekció). Az M6 (max 2-3, rövid, a termék után) teljesül; a méret
ízlés-kérdés. Javaslat: ha a szekció rövidülne, az első idézet M-tokenen. Méret: S.

**P3-10. A „Biztonságos fizetés" és „Hírlevél" H2 az S/M tokenen.** Szemantikailag
helyes, vizuálisan nem szekciócím. Nem hiba; a képernyőolvasós vázlatban két „kicsi"
H2 zárja az oldalt. Nincs teendő, csak jegyzet.

---

## 4. Persona-séta lépésenként (Kovácsné, 54, fájós csukló, laptop és telefon)

Cél: eldönteni, hogy kurzust vegyen vagy rendelőbe menjen. Jelölés a
`docs/felhasznaloi-seta.md` szerint: elakad / bizonytalan / zavaró.

| Lépés                       | Mit lát (mért)                                                                                         | K1 próbálja?                       | K2 látja?                        | K3 érti?                                        | K4 visszajelzés                   | Ítélet                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------- | -------------------------------- | ----------------------------------------------- | --------------------------------- | --------------------------------------------- |
| 1. Betöltés, laptop (1440)  | 5 soros cím, ökölbe szorult kéz, 4 címke, kék gomb + keretes gomb; süti-sáv alul, nem takar            | igen (a cím „kéz és kar")          | igen                             | részben: „Kurzusok"? „SOS"? nem tudja, online-e | nincs még                         | bizonytalan                                   |
| 1b. Betöltés, telefon (390) | ugyanez, de a süti-sáv 616 px-től letakarja a gombokat                                                 | igen                               | **nem** (a gombok a sáv alatt)   | ugyanaz                                         | nincs                             | **elakad** (P1-1)                             |
| 2. Görgetés mozgással       | 2. és 3. képernyő: ugyanaz a kéz, egy-egy felirat („Napi néhány perc otthon…", „Lentebb megtalálod…")  | görget                             | nincs vezérlő                    | a felirat ígéri, hogy lentebb lesz              | nem lát haladást 4,6 képernyőn át | **elakad** (P1-2)                             |
| 3. Fríz + Rólunk            | 4 arckép, „Két rendelő Budapesten, és egy otthoni program." Ez az első mondat, amiből érti a kínálatot | igen                               | felirat                          | **igen, itt érti meg**                          | jó                                | zavaró (későn)                                |
| 4. Hitelcsík                | 3 pont, „Ismerd meg a hátterünket"                                                                     | nem cél                            | igen                             | rendben                                         |                                   | rendben                                       |
| 5. Kurzusaink               | 2 kártya, ár 79 500 Ft és „Ingyenes"; egész kártya kattintható, csak nyíl-ikon                         | igen                               | a kártyát látja, gombot nem      | „hova kattintsak? mi történik?"                 |                                   | bizonytalan (P2-5)                            |
| 6. Így működik              | 3 lépés, „megvásárolod, bankkártyával, biztonságosan"                                                  |                                    |                                  | érti                                            |                                   | rendben                                       |
| 7. Ingyenes SOS-sáv         | sötétkék, nagy fotó, „Elindítom ingyen"                                                                | igen (fél a fizetéstől, ez vonzza) | igen                             | igen                                            | a termékoldalra visz              | rendben, de az ingyenes uralja a képet (P1-3) |
| 8. Sajtólogók               | „Itt találkozhattál velünk", 10 szürke logó                                                            |                                    |                                  | „a Kézsebész Társaságnál találkoztam velük?"    |                                   | zavaró (P2-6)                                 |
| 9. Fájdalom-blokk           | „Tudjuk, milyen, amikor…", 3 pipa                                                                      | érzi, hogy róla szól               |                                  | igen                                            |                                   | rendben, de későn (P2-11)                     |
| 10. Erre számíthatsz        | fotó, 01 Szakmai figyelem, 02 Segítség a mindennapokhoz, mindkettő címsor-méretben                     |                                    |                                  | „ez ugyanaz, mint feljebb"                      |                                   | zavaró (P2-8, P2-11)                          |
| 11. Így tudunk segíteni     | „Három út"; bal oldalt 3 tétel, jobb oldalt a rendelői panel gombbal                                   | **igen, ez a kérdése**             | a bal tételek listának látszanak | ha rákattint, kiderül                           | panel vált                        | bizonytalan, és 8. képernyő (P2-1, P3-6)      |
| 12. Vélemények              | 3 rövid idézet, név + foglalkozás                                                                      |                                    |                                  | bizalom nő                                      |                                   | rendben                                       |
| 13. Tudástár                | 3 cikk címkével, dátummal, „Nézd meg a tudástárat"                                                     |                                    |                                  |                                                 |                                   | rendben                                       |
| 14. GYIK                    | 5 kérdés; az 1. pont az ő kérdése; a 2. árat ígér link nélkül                                          | igen                               | igen                             | igen                                            | a válasz nem visz tovább          | zavaró (P3-3)                                 |
| 15. Záró hívás              | „Kezdd el még ma" + „Nézd meg a kurzusokat"                                                            | igen                               | igen                             | igen                                            |                                   | rendben                                       |
| 16. Barion-sáv, lábléc      | kártyalogók, MNB-engedély, „Kapcsolat", hírlevél, jogi linkek                                          |                                    |                                  | megnyugtató                                     |                                   | rendben                                       |

**Ítélet:** Kovácsné laptopon a 3. lépésnél érti meg, mit kínálnak, az 5.-nél látja az
árat, és a 11.-nél kap választ a saját kérdésére. Telefonon az 1b lépésnél elakad, amíg
el nem intézi a sütiket. A döntéshez szükséges három elem (mi ez, mennyibe kerül,
rendelő vagy kurzus) a 2., 4. és 8. képernyőre esik; mindháromnak az első háromra kellene.

---

## 5. Az M1-M8 hierarchia és a mért sorrend

| Modul                                                        | Szabály (skill)                    | Hol van ma (1440 reduce)                                                   | Eltérés                                                                                |
| ------------------------------------------------------------ | ---------------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| M1 hero + 1+1 CTA                                            | elsődleges a fizetős irányba       | 0 px; 1 elsődleges + 1 másodlagos                                          | a másodlagos szélesebb és feltűnőbb (P2-4); nincs „online/videó/ár" (P2-2)             |
| M2 hitelcsík                                                 | a hero ALATT, tömören              | 2559 px, a Rólunk-blokk után                                               | két szekcióval lejjebb, tartalma a Rólunkkal átfed (P2-12)                             |
| M3 fizetős kártyák, ár + CTA                                 | elsődleges, minden fizetős termék  | 2672 px; 1 fizetős kártya árral, CTA-felirat nélkül                        | 4. hely; gomb nélkül (P2-5); mozgással 5599 px (P1-2)                                  |
| M4 ingyenes SOS                                              | a fizetős UTÁN, másodlagos súllyal | kártya a rácsban (M3-mal együtt) ÉS 848 px-es sáv 4527 px-nél ÉS hero-gomb | túlsúly (P1-3)                                                                         |
| M5 Így működik                                               | támogató                           | 3904 px, közvetlenül M3 után                                               | rendben                                                                                |
| M6 vélemények                                                | max 2-3 rövid, a termék után       | 7827 px, 3 rövid (153 és 172 karakter)                                     | rendben, kései                                                                         |
| M7 tudástár 3 poszt                                          | sosem előzi meg a terméket         | 8727 px, 3 poszt + link                                                    | rendben                                                                                |
| M8 GYIK / kapcsolat                                          | a lap alján                        | 9275 px GYIK, záró hívás, Barion, lábléc Kapcsolat                         | rendben; a 2. válasz link nélkül (P3-3)                                                |
| (nem M) fríz, Rólunk, sajtó, fájdalom, Erre számíthatsz, sín |                                    | 1212, 1823, 5375, 5705, 6338, 7158 px                                      | a sín a persona döntési pontja, 8. képernyő (P2-1); két „miért mi" blokk átfed (P2-11) |

---

## 6. Tartalmi audit

- **Gondolatjel:** a látható és a rejtett (GYIK-válaszok, sín-panelek) szövegben egy
  U+2013 / U+2014 sincs (DOM-szkennelés). Rendben.
- **AI-ízű vagy fordítás-ízű mondatok:**
  - hero-bevezető: „Professzionális, mégis emberközeli terápiás megoldásokkal kezeljük a
    különböző mozgásszervi problémákat, hogy te ismét önfeledten dolgozhass, sportolhass
    vagy gondoskodhass szeretteidről." Általános, brossúra-hang, nem kéz-specifikus és
    nem mondja ki az online programot (P2-2).
  - hero úszó felirat: „Minden alkalommal egy mozdulattal több", „A következő mozdulat a
    tiéd": szlogen-jellegű, a persona számára üres (P1-2 mellett rendezhető).
  - Rólunk: „segítünk eligazodni a lehetőségeid között" (üres általánosság), és a nevek
    háromszoros ismétlése (P2-10).
  - Erre számíthatsz: „A kutatásokat és a gyakorlati tapasztalatainkat együtt
    használjuk." (semmitmondó; a hitelcsík konkrétabb).
  - stat: „1 közös cél: fájdalommentesség" (P3-2).
- **Ismétlődő állítások:** „Személyes kezeléssel és otthoni videókurzussal" (Rólunk) ≈
  „Rendelői kezeléssel és otthoni videókurzussal is támogatunk" (Erre számíthatsz) ≈
  „Három út…" (sín) ≈ GYIK 1. válasz. „Saját tempódban" háromszor (hero-felirat, Így
  működik 2. és 3. lépés). „Nézd meg a kurzusokat" háromszor (ez helyes, azonos
  cselekvés).
- **Ismétlődő fotók:** `hand-treatment-detail` és `founders-intro-white` kétszer (P2-9).
- **Félrevezető feliratok:** „Itt találkozhattál velünk" a tagsági logók fölött (P2-6);
  „Nézd meg ingyenes SOS-kurzusunkat", ami nem a kurzusra, hanem egy sávra ugrik (P2-4);
  a kéz-címkék gombként (P2-3).
- **Igaz és jó:** a kártya „Ingyenes" felirata az ár helyén (a séta 2.1 pontja
  megoldva); „Elindítom ingyen" E/1-ben, a termékre visz; „Így működik az online kurzus"
  három lépése; a Barion-sáv MNB-engedélyszámmal; a fríz jobb felirata („Két rendelő
  Budapesten, és egy otthoni program.") az oldal legjobb mondata, csak följebb kellene.

---

## 7. Azonnal vállalható S-méretű javítások (külön ügynöknek kiadható)

Mindegyik egy fájl vagy egy CMS-mező, őr-teszt nem sérül (a CTA-feliratok a
szótárból jönnek, betűméret-token nem változik).

1. **Süti-sáv mobilon a hero-gombok alá** (P1-1): a `kc-film-hero` alsó belső térköze
   900 px alatt legyen a sáv magassága (`--kc-space-*` a 4 px-es rácson), vagy a sáv a
   folyamban; ellenőrzés: 390×844-en a két gomb alja < 616 px, vagy a sáv nem takar.
   Fájl: `film-hero.css` vagy `consent-banner.css`.
2. **Hero másodlagos gomb szöveglink-stílusra és `#kurzusok` célra** (P2-4):
   `FilmHero.tsx` + `film-hero.css` (`kc-film-hero__cta--quiet`), a felirat marad a
   §3.2 #37 szerint, a `href` a rács horgonya.
3. **Hero címkék csip-keret nélkül** (P2-3): `film-hero.css` `.scroll-scrub__tags li`
   keret és padding nélkül, S-token, vesszős felsorolás vagy pont-elválasztó.
4. **Kurzuskártya-CTA felirat** (P2-5): `CourseShowcase.tsx` a kártya aljára a szótár
   `course-sales-open` / `free-course-claim` feliratát `span`-ként a linken belül,
   másodlagos gombstílussal; ellenőrzés: `cta-vocabulary-guard` zöld.
5. **H3-ak M-tokenre** (P2-8): `services.css` és `services-sin.css` H3 →
   `var(--kc-font-m)`, 600 súly; a H2 hasábja `min-width: 22ch`.
6. **Kurzusaink blokk `hatter: tint`, sín `feher`** (P2-7): CMS-mező (Pages → Kezdőlap →
   Szekciók), és a seed (`home-seed.ts`) ugyanígy, hogy élesben is így álljon.
7. **Jelenet-fotók cseréje és `next/image`** (P2-9): `course-showcase.ts` fotólista a
   manifest nem használt képeire; `CourseShowcase.tsx` `Image` `sizes`-zel.
8. **Sajtósor felirat** (P2-6 minimális változat): CMS `pressLogos.felirat` → „Sajtó és
   szakmai szervezetek"; seed ugyanígy.
9. **Hero-bevezető** (P2-2): CMS `filmHero.lead` és `home-seed.ts` a 3. szakasz P2-2
   mondatára; a H1 hasábja `max-width` ~24ch (`film-hero.css`).
10. **Rólunk H2 és első bekezdés** (P2-10): CMS `about.title` és első bekezdés; átadni a
    fríz+Rólunk összevonását végző ügynöknek.
11. **Stat harmadik tétele** (P3-2): CMS `about.stats[2]` → „2 rendelő Budapesten".
12. **GYIK 2. válaszába link** (P3-3): CMS `faq.items[1].answer` Lexical-link a
    `/kurzusok`-ra; seed ugyanígy.
13. **Fríz-feliratok írásjelei** (P3-5): `PhotoFrieze.tsx`.
14. **Hero-poszter tömörítése** (P3-8): `public/media/film/one-hand-header-v1-poster.webp`
    ~150 KB-ra (q 70), méret marad 1920×1080.

Tulajdonosi döntést igénylő, M-méretű tételek (nem S-lista): a filmsáv scrub-hossza
(P1-2), az ingyenes sáv elrejtése vagy kompakt formája (P1-3), a sín feljebb hozása
(P2-1), az öt „miért mi" szekció háromra vonása (P2-11), a Rólunk-blokk a Kurzusaink
mögé és a hitelcsík a fríz alá (P2-12), a sín első gombfelirata (P3-4).

---

## 8. Mérési napló (reprodukálás)

```
cd <scratchpad>/wp14
node measure.mjs 1440 reduce        # → measure-1440-reduce.json
node measure.mjs 390 reduce
node measure.mjs 320 reduce
node measure.mjs 1440 no-preference
node measure.mjs 390 no-preference
node a11y.mjs                        # Tab-sorrend, AA-szkennelés, szövegkivonat
node fold.mjs                        # hajtás-képek süti-sávval és nélküle, film-állások
node focus.mjs                       # kurzuskártya fókuszjelölése
node ../shot.mjs http://localhost:3000/ home-1440-reduce.png 1440 reduce   # teljes oldal
```

Képernyőképek: `home-{1440,1024,390,320}-reduce.png`, `home-{1440,390}-motion.png`,
szeletek `s1440-*.png`, `s390-*.png`, `s320-*.png`, `m1440-*.png`;
`fold-{1440,1024,390}[-consent|-scrollN].png`; `focus-card.png`.

A számok a dev-szerverről valók (`next dev`, Turbopack), az LCP-idő ezért csak
irányadó; a geometria, a színek és a kontraszt a production buildben azonos.
