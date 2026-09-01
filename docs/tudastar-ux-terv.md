# Tudástár: a cikklista és a cikkoldal UX-terve

> **Státusz: KUTATÁS ÉS TERV, nem implementáció.** Ez a dokumentum azt írja le,
> hogyan nézzen ki és hogyan viselkedjen a `/blog`, a `/blog/kategoria/[slug]`
> és a `/blog/[slug]`. Kód nem tartozik hozzá. Minden döntés mellett ott a
> forrás (cím és URL) és a **mérhető küszöb**, amivel az implementáló ügynök
> ellenőrizni tudja magát.
>
> **Kötelező előolvasmány:** `.claude/skills/termektervezes/SKILL.md`,
> `docs/ui-sztenderdek.md` (§2 gomb-rendszer, §3.1 magyar mikroszöveg, §3.2
> CTA-szótár, §6 mérési protokoll), `docs/ux-belso-oldalak-kutatas.md`
> (B1–B8 szabályok), `docs/informacios-architektura.md`,
> `docs/tudastar-hangnem-es-technika.md` (a cikkek hangja és bevitele),
> `docs/seo-geo-llm.md`.

---

## 0. Hogyan olvasd ezt a dokumentumot

### 0.1 Amit tartalmaz

| Fejezet | Mire ad választ |
|---|---|
| 1. | Mi van ma, számokban. Ez a kiindulási alap, nem vélemény. |
| 2. | Rács vagy lista a `/blog`-on? Hány hasáb, melyik töréspontnál? |
| 3. | A kártya anatómiája: mi kerül rá, és mi NEM. |
| 4. | A lista-oldal teljes elrendezése (szűrő, kiemelt kártya, üres állapot). |
| 5. | A cikkoldal: sorhossz, ritmus, tartalomjegyzék, szerző, források, CTA. |
| 6. | Akadálymentesség kritériumonként, mért küszöbökkel. |
| 7. | Mikroszöveg és feliratok (a §3.2 szótárból, új felirat kitalálása nélkül). |
| 8. | Amit tudatosan NEM csinálunk, és miért. |
| 9. | Implementációs terv fájlonként, őr-tesztekkel. |
| 10. | Nyitott kérdések, amiket a vezetőnek kell eldöntenie. |
| 11. | Forrásjegyzék. |

### 0.2 A mérés módszertana

A skill 3. pontja kimondja: becslés nem elfogadható. Ebben a dokumentumban
minden karakter/sor, kontraszt- és térköz-szám **számított**, a repó saját
betűfájljaiból és a repó saját magyar szövegéből.

**Betűmetrika.** A `public/fonts/` alatti, self-hostolt woff2 metszetek
`cmap` és `hmtx` tábláiból (fontTools 4.63.0). A variábilis Nunito Sansból a
`wght` 400 és 700 példány kimetszve (`instantiateVariableFont`), a Tenor Sans
egyetlen 400-as metszettel érkezik.

**Korpusz.** 72 775 karakter magyar, vevői hangú szöveg a repóból:
`src/lib/legal-source/aszf.txt`, `src/lib/legal-source/adatkezeles.txt`,
`docs/vevohang-es-hirdetesszoveg.md`, `docs/tudastar-hangnem-es-technika.md`
(kódblokkok, inline kód, URL-ek és markdown-jelölés nélkül). A glif-lefedettség
**100,00%**, tehát egyetlen karakter sem esett ki a súlyozásból.

**Mért alapszámok:**

| Mennyiség | Érték |
|---|---|
| Nunito Sans 400, átlagos karakterszélesség magyar szövegen | **0,4480 em** |
| Nunito Sans 700, ugyanaz | 0,4620 em |
| Tenor Sans 400, ugyanaz | **0,4818 em** |
| A `0` glif szélessége (ez az `1ch`) | 0,6000 em |
| **1ch hány tényleges karakter** | **1,351** |
| Átlagos szóhossz | 6,23 betű |
| 10+ betűs szavak aránya | 22,0% |
| 12+ betűs szavak aránya | 9,9% |
| Leghosszabb szó a korpuszban | 23 betű |

A karakter/sor képlete tehát: `karakter/sor = doboz_szélesség_px / (0,4480 × betűméret_px)`
(címsornál 0,4818, a `letter-spacing: 0,01em` hozzáadásával).

**Ez megerősíti a `docs/ux-belso-oldalak-kutatas.md` B1.2 pontját:** a `ch`
egység 35%-kal hosszabb sort ad, mint amit a szám sugall. A `ch`-ban kiírt
korlát tehát továbbra sem elfogadható bizonyíték.

**A clamp-végpontok**, amikből a betűméret jön (`tokens.css`):
`--kc-font-l` 32,0 → 46,4 px · `--kc-font-m` 16,0 → 18,0 px ·
`--kc-font-s` 13,0 → 14,0 px. A dobozok a `--kc-container-wide` (1120 px),
`--kc-container-narrow` (720 px), `--kc-container-gutter` (24 px),
`--kc-space-5` (24 px rács-hézag és kártya-belső térköz), `--kc-measure`
(544 px) és `--kc-measure-comfort` (480 px) tokenekből.

**Kontraszt.** A `tokens.css` hexáiból, a WCAG relatív luminancia képletével
újraszámolva. Mind a 23 ellenőrzött párra a `tokens.css` jegyzőkönyvében álló
értéket kaptam vissza, egyetlen eltérés nélkül (lásd 6.2). A tokenek tehát
megbízhatók, és ez a terv **nem vezet be új színt, betűt vagy méretet**.

**A mérőszkriptek** a session-scratchpad `ux/` mappájában futottak
(`meres.py`, `meres2.py`, `meres3.py`). A módszer a 12. fejezetben leírtak
alapján bármikor újrafuttatható.

---

## 1. A mai állapot, mérve

A Tudástár ma nulla cikkel él, tehát a felület nagy része sosem renderelődött
valódi tartalommal. Ami MA a kódban van, azt mértem ki.

### 1.1 A lista-oldal

| # | Megállapítás | Mért érték | Súly |
|---|---|---|---|
| L1 | A `.kc-card-grid` **fix hármas rács** 900 px felett (`content.css:352`). | A kártya kivonatának sorhossza **28,8 karakter** 900 px-en, **33,7** 1024 px-en, **36,4** 1440 px-en. A saját szabályunk (B1.1, Ü6) tűrése 45–85, célja 50–75. | **magas** |
| L2 | Ugyanez a rács 640 px-en kéthasábosra vált. | Kivonat **31,8 karakter/sor**, vagyis a 640 px-es váltás rosszabb sorhosszt ad, mint az alatta lévő egyhasábos nézet (390 px-en 40,9). | magas |
| L3 | A kártya szövegének **nincs sem mérték-, sem track-korlátja**: a hasáb annyi, amennyi a rácsból jut. | Ma ez még nem bukás: a legszélesebb egyhasábos eset a 640 px-es váltás alatt van, ott a kivonat **73,2**, a cím **68,1** karakter/sor. De a korlát hiánya azt jelenti, hogy bármely rács-változtatás némán átviheti a WCAG 2.2 **1.4.8** (AAA) 80-as plafonja fölé. | közepes (lappangó) |
| L4 | A **teljes kártya egyetlen `<a>`** (`PostCard.tsx`, `kc-post-card__link`). | A link hozzáférhető neve reális cikknél **279 karakter, 41 szó** (borító alt + kategória + cím + kivonat + dátum). Csak a címmel **49 karakter, 8 szó**, vagyis 82%-kal rövidebb. | **magas** |
| L5 | A kártya **minden** kategória-címkét kirak (`categoryTitles` → `titles.map`). | Két-három kategóriás cikknél a címke-sor tördel, és a kártyák magassága eltér. Ez a B4.1 („ugyanazok a mezők ugyanabban a sorrendben, ugyanazon a magasságon") és a Baymard-elv sérülése. | közepes |
| L6 | A poszt-kártyán **nincs** `hyphens: auto` és `overflow-wrap: anywhere`, a kurzus-kártyán van (`course-cards.css:111`). | Túlcsordulást ez ma **nem** okoz: a 7 943 szavas korpuszban egyetlen szó sem szélesebb a kártya szövegdobozánál egyik töréspontnál sem. A hiány tehát tipográfiai, nem reflow-hiba. | alacsony |
| L7 | Nincs lapozás: `getPosts` alapértelmezett `limit` **60**. | 60 cikk fölött a lista némán csonkul. Ma 0 cikk van, tehát ez időzített, nem élő hiba. | alacsony |
| L8 | A kategória-szűrő **egyetlen** kategóriánál is megjelenik (`CategoryFilter` csak 0-nál nem renderel). | A B4.3 küszöbe: legalább 5 tétel vagy legalább 3 valódi kategória. | közepes |

### 1.2 A cikkoldal

| # | Megállapítás | Mért érték | Súly |
|---|---|---|---|
| C1 | A folyószöveg **mértéke rendben van**. | A szűk (720 px) konténerben, `--kc-measure` korláttal: **67,5 karakter/sor** 1440 px-en, 70,1 @1024, 72,2 @768, 47,5 @390, 37,9 @320. A 45-ös alsó határ 320 px-en fizikailag nem érhető el: 45 karakterhez 16 px-es törzsméretnél **319,8 px** szövegdoboz kell, a 320 px-es nézetablakban viszont csak 272 px áll rendelkezésre. | rendben |
| C2 | A bekezdésköz `--kc-space-4` (16 px). | 1440 px-en a sortáv 30,06 px, a bekezdésköz 46,06 px, a WCAG **1.4.8** (AAA) elvárása 45,09 px. A tartalék **+0,97 px**, gyakorlatilag nulla. `--kc-space-5`-tel (24 px) a tartalék +8,97 px. | közepes |
| C3 | A Lexical-címsorok **nem kapnak `id`-t** (`serialize.tsx` `renderHeading`). | Tartalomjegyzék és lapon belüli horgony ma **nem építhető**. | **magas**, ha kell tartalomjegyzék |
| C4 | Nincs tartalomjegyzék. | A B2.3 küszöbe: 800 szó fölött vagy 5-nél több fő szekciónál kötelező. | magas |
| C5 | Nincs forrás-megjelenítési konvenció. | A feladatkiírás első számú orvosi szabálya követeli. | **kritikus** |
| C6 | A szerző-blokk egyetlen név a meta-sorban (`kc-post-meta__author`), végképzettség, szerep és arckép nélkül. | A Google E-E-A-T „Who" kérdése és az NN/g byline-kutatás ennél többet kér egészségügyi tartalomnál. | **magas** |
| C7 | Nincs „utoljára ellenőrizve" jelzés. | Egészségügyi tartalomnál ez bevett minta (NHS). | magas |
| C8 | A kapcsolódó cikkek **maximum 3** (`getRelatedPosts(post, 3)`), a szekció címe „Kapcsolódó bejegyzések". | Az NN/g ajánlása 5–7 link, és a címke legyen beszédes, ne általános. | közepes |
| C9 | A cikkoldalon **nincs kurzus-CTA**. | Az NN/g kimondja: az információs cikknek kérnie kell a rendelést. Ma a cikk zsákutca a vásárlás felé. | **magas** |
| C10 | Az olvasási idő 200 szó/perccel számol (`reading-time.ts`), forrásmegjelölés nélkül. | 1600 szó fölött ez 1 perccel többet mutat, mint a 238 szó/perces nemzetközi átlag. | alacsony |
| C11 | A borítókép a `Posts` sémában **nem kötelező**. | Ha a cikkek egy részének van borítója, a rács fele képes, fele kép nélküli lesz. Baymard: a hiányzó attribútumot vagy sehol nem mutatjuk, vagy kimondjuk. | közepes |

---

## 2. Döntés: rács legyen, de KÉT hasábbal és kiemelt vezető kártyával

A tulajdonos „izgalmas gridet" kért, **azzal a kikötéssel, hogy csak akkor, ha
az működik jobban**. Ezt nem ízlés dönti el, hanem a következő két kérdés:
(a) rács vagy lista, (b) ha rács, hány hasáb.

### 2.1 Rács vagy lista: mit mond a kutatás

| Forrás | Amit kimond | Mit jelent nálunk |
|---|---|---|
| NN/g, *Cards: UI-Component Definition* ([link](https://www.nngroup.com/articles/cards-component/)) | A kártya „a container for a few short, related pieces of information… a linked, short representation of a conceptual unit". Jól működik **böngészésnél** és **heterogén** tartalomnál; rosszul működik, ha a felhasználó **konkrétat keres**, **összehasonlít**, vagy ha a tételek homogének, mert a kártya „less scannable than lists". | A cikkek heterogének (más téma, más hossz, más kép), és a látogató a Tudástárban **böngészik**, nem árat hasonlít össze. **A kártya tehát indokolt.** |
| NN/g, *Mobile Navigation: Image Grids or Text Lists?* ([link](https://www.nngroup.com/articles/image-vs-list-mobile-navigation/)) | A képrács **több görgetést** kér ugyanazért a tartalomért („4 screen lengths vs. 1 scroll"), és a felhasználó gyakran idő előtt megáll: az egyik teszten 42 lehetőségből **4-et** nézett át. „Repeatedly scrolling to review all available options is tiring, and people often stop once they see an item that looks close enough to what they want." | A kép nem hordozhatja egyedül az információt: a **cím** viszi a szagot, a kép kíséret. |
| Baymard, *2 Key Design Principles for Product Listing Information* ([link](https://baymard.com/blog/list-item-design-ecommerce)) | A tételeken „the same attributes are included consistently across similar list items", és minden információ-elem legyen vizuálisan elkülönülő. A benchmarkban **64%** hibázik az elsőben, **40%** a másodikban. | Minden kártyán ugyanaz a mezőkészlet, ugyanabban a sorrendben. Ha a borítókép opcionális marad, azt kezelni kell (lásd 3.4). |
| Saját szabály, `docs/ux-belso-oldalak-kutatas.md` **B4.1** | Homogén tételeknél a kártya csak akkor marad, ha minden kártya ugyanazokat a mezőket ugyanabban a sorrendben, ugyanazon a magasságon hozza. | Ugyanaz a kikötés, kötelező erővel. |

**Döntés (a):** a `/blog` marad **kártyás rács**, mert a feladat böngészés és a
tartalom heterogén. **De** a rács csak akkor jobb a listánál, ha a kártya
szövege olvasható marad, tehát a hasábszám kérdése nem esztétikai.

### 2.2 Hány hasáb: a mérés

Ugyanaz a kártya, ugyanaz a szöveg, két rács-változat. A számok a 0.2 szerint
számítva.

**A javasolt rács:**
`grid-template-columns: repeat(auto-fit, minmax(min(100%, 26rem), 34rem));`
`justify-content: center;`

| Nézetablak | MAI rács (fix 1/2/3 hasáb) | JAVASOLT rács |
|---|---|---|
| 320 px | 1 hasáb, kivonat **31,2** kar./sor | 1 hasáb, **31,2** |
| 390 px | 1 hasáb, **40,9** | 1 hasáb, **40,9** |
| 430 px | 1 hasáb, **46,2** | 1 hasáb, **46,2** |
| 640 px | 2 hasáb, **31,8** | 1 hasáb, **66,9** |
| 768 px | 2 hasáb, **39,8** | 1 hasáb, **65,8** |
| 840 px | 2 hasáb, **44,2** | 1 hasáb, **65,3** |
| 904 px | 3 hasáb, **28,9** | 2 hasáb, **48,1** |
| 1024 px | 3 hasáb, **33,7** | 2 hasáb, **55,1** |
| 1120 px | 3 hasáb, **37,4** | 2 hasáb, **60,6** |
| 1440 px és felette | 3 hasáb, **36,4** | 2 hasáb, **59,0** |

A címre ugyanez a kép: a mai hármas rácsban a kártyacím 1440 px-en **33,8**
karakter/sor, a javasolt kettesben **54,9**. Egy 49 karakteres magyar cikkcím a
hármas rácsban **két sorra**, a hosszabb (65 karakteres) cím **három sorra**
törik; a kettes rácsban egy, illetve két sor.

**Döntés (b): két hasáb, nem három.** Az indok mért: a hármas rács a saját
szabályunk 45-ös alsó tűréshatára alatt marad **minden** 900 px feletti
szélességen (28,9–37,4), a javasolt rács viszont **422 px-es nézetablaktól felfelé végig a
tűrésen belül van** (45,1–67,2), és 900 px felett a **cél**-sávot (50–75) is
eltalálja.

**422 px alatt a 45-ös alsó határ fizikailag elérhetetlen.** 45 karakterhez
16 px-es törzsméretnél 322,6 px szövegdoboz kell, ahhoz 370,6 px kártya, ahhoz
418,6 px nézetablak. Ez nem tervezési hiba, hanem a kis kijelző adottsága; a
kötelező (mérhető) korlát ilyenkor a **felső** határ, ami mindenhol teljesül.

**A hármas rács nem menthető meg a konténer szélesítésével sem.** A
`--kc-container-wide` 1120 px, a belső tartalom 1072 px. Ahhoz, hogy három
hasábban 45 karakteres sor legyen, hasábonként 389 px szövegdoboz kellene,
vagyis 3 × 437 + 2 × 24 = **1359 px** tartalom-szélesség. Ez a repó
konténer-rendszerének átírását jelentené, három cikk-kártya kedvéért.

**Miért `26rem` az alsó és `34rem` a felső track-korlát.**

| Korlát | Érték | Mit old meg |
|---|---|---|
| alsó, `min(100%, 26rem)` | 416 px | A 1072 px-es tartalomban **matematikailag kizárja a harmadik hasábot** (3 × 416 + 2 × 24 = 1296 px > 1072 px), tehát a kettes rács külön oszlopszám-korlát és külön médialekérdezés nélkül adódik, 2560 px-en is. A kétoszlopos váltás 904 px-nél történik, ahol a kivonat már **48,1** karakter/sor, vagyis a váltás nem esik a tűrés alá. A `min(100%, …)` ág a 320 px-es reflow-védelem (ugyanaz a minta, mint `course-cards.css:79`). |
| felső, `34rem` | 544 px | Egyetlen cikknél a kártya nem nő 1072 px széles óriássá, és az egyhasábos tartományban (592–903 px) a kártya szövege **65,3–67,2** karakter/sor marad. Az L3-as lappangó kockázat (korlátlanul szélesedő kártya-szöveg) ezzel **szerkezetileg** megszűnik, külön mérték-korlát a kivonaton nem kell. |

A `justify-content: center` amiatt kell, hogy a fix felső track-korláttal a
rács ne balra tapadjon, amikor a tartalom szélesebb a track-eknél.

### 2.3 Ahol a lista mégis jobb: a szűrt nézet

Baymard (*Avoid „Quick Views" for Spec-Driven Product Types*, illetve a
lista/rács összevetése) és az NN/g kártya-cikke egyaránt azt mondja, hogy
**keresésnél és szűrésnél** a lista a jobb forma, mert gyorsabban átfutható.
A `/blog/kategoria/[slug]` pontosan ilyen szűrt nézet.

**Döntés:** a kategória-oldal ugyanazt a kéthasábos rácsot használja, **de
kiemelt vezető kártya nélkül**. Indok: a kiemelés szerkesztői rangsort sugall,
ami a szűrt nézetben nem létezik, és a Baymard-elv szerint a szűrt lista minden
tétele egyenrangú. Ez tudatos, kimondott eltérés a `/blog`-tól, nem
következetlenség.

---

## 3. A kártya anatómiája

### 3.1 Két változat, egy komponens

Ugyanaz a `PostCard` három helyen jelenik meg: a `/blog` listán, a
kategória-oldalon, a kezdőlapi „Legfrissebb a tudástárból" szekcióban és a
cikkoldal kapcsolódó-blokkjában. A kezdőlapi szekció és a kapcsolódó-blokk
**hármas** rácsban áll (`.kc-card-grid`), és ezt nem szabad elrontani: az a
rács a kurzus-szekcióval és a kezdőlap ritmusával közös, más csapat is
használja.

Ezért a kártya **két változatot** kap:

| Változat | Hol | Mezők |
|---|---|---|
| `list` (alap a Tudástárban) | `/blog`, `/blog/kategoria/[slug]` | borító, kategória-címke, cím, **kivonat (max 3 sor)**, hajszálvonal, dátum + olvasási idő |
| `compact` | kezdőlapi szekció, kapcsolódó cikkek | borító, kategória-címke, cím, hajszálvonal, dátum + olvasási idő. **Kivonat nincs.** |

**Miért nincs kivonat a `compact` változaton.** A hármas rácsban a kivonat
sorhossza mérve **28,8–36,4 karakter**, a 45-ös tűréshatár alatt. A kivonatot
nem elrejteni kell (az továbbra is ott lenne a DOM-ban, olvashatatlanul), hanem
**nem odatenni**: a teaser-sávban a cím viszi az információ-szagot, ez a
kártya-definíció szerint elég (NN/g: „a linked, short representation of a
conceptual unit"). A cím a hármas rácsban 33,8 karakter/sor, egy 49 karakteres
cím tehát két sor, ami fejlécnél elfogadható.

**A Baymard-féle következetesség így nem sérül**: az elv azt mondja ki, hogy
*egy listán belül* minden tétel ugyanazokat a mezőket hozza. A kezdőlapi
teaser-sáv és a `/blog` lista két különböző lista.

### 3.2 A mezők sorrendje és a miértjük

```
┌───────────────────────────────┐
│  BORÍTÓ  16:9                 │  információt hordozó kép vagy semmi (3.4)
├───────────────────────────────┤
│  [Kézrehabilitáció]           │  EGY kategória-címke, kc-badge--info
│  A cikk címe két sorban       │  h2 > a, Tenor Sans, --kc-font-m, text-wrap: balance
│  A kivonat legfeljebb három   │  --kc-font-m, text-muted, max 3 sor (list változat)
│  sorban, a mértékre fogva.    │
│  ─────────────────────────    │  1px hairline
│  2026. augusztus 21. · 6 perc │  --kc-font-s, text-muted             →
└───────────────────────────────┘
```

| Elem | Miért van rajta | Mérhető küszöb |
|---|---|---|
| Borító | NN/g: az információt hordozó képet nézik, a dekoratívat nem („users pay attention to information-carrying images… ignore purely decorative images"). Gyakorlat-fotónál a kép önálló szag. | 16:9, `object-fit: cover`, kötelező `alt`, ami **nem** ismétli a címet. |
| Kategória-címke | Az információ-szag megerősítése és a téma azonosítása. | **Pontosan egy**, az első kategória. Több címke tördel, és a kártyák magassága szétcsúszik (L5). |
| Cím | Ez viszi a szagot. NN/g: „place the most informative words at the beginning of hyperlinks". | Sorhossz a kettes rácsban 54,9 kar./sor 1440 px-en. A cikkcím ajánlott hossza **legfeljebb 65 karakter** (NHS: h1 „ideally 65 characters or less"). |
| Kivonat | A döntéshez kell a második réteg (NN/g réteges olvasás). | Legfeljebb **3 sor**. 1440 px-en 3 × 59,0 = **177 karakter** az elméleti maximum; a szóhatáron való töréssel a gyakorlati felső határ **150–170 karakter**. Ez egybeesik a `seoDescription` ~150 karakteres ajánlásával, tehát a szerkesztőnek egy hosszúságot kell fejben tartania. |
| Dátum | Egészségügyi tartalomnál a frissesség bizalmi tényező (NN/g: „comprehensive, correct, and current"). | `<time dateTime>`, magyar hosszú formátum, ahogy ma. |
| Olvasási idő | Elvárás-beállítás a kattintás előtt (7.3). | „6 perc olvasás", `--kc-font-s`. |
| Nyíl | Dekoratív cselekvés-jel. A „Tovább" felirat tiltott (§3.1.4 M-7). | `aria-hidden="true"`, marad. |

### 3.3 Ami NEM kerül a kártyára, és miért

| Nem kerül rá | Indok |
|---|---|
| **Szerző neve** | Az NN/g byline-kutatás a **cikkoldalra** teszi a bylinet, és kifejezetten megengedi az elhagyását szűk helyen („Mobile copy should be cut even more"). A kártyán a szerző nem segít választani, viszont egy sorral magasabbá teszi a kártyát. |
| **„Tovább olvasom" gomb** | §3.1.4 **M-7**: a puszta, célt nem nevező felirat tiltott. Az egész kártya link, tehát a gomb ráadásul beágyazott interaktív elem lenne a linkben. |
| **Megosztás gombok** | Nem a listaoldal feladata, és a kártya link-nevét is tovább hígítaná. |
| **Több kategória-címke** | L5, B4.1: egyenetlen kártya-magasság. |
| **Pontos időpont (óra, perc)** | Nem segít a döntésben, zajt ad. |
| **„Új" jelzés, számláló, visszaszámláló** | A skill 6. pontja tiltja a sürgetést; itt nem is lenne igaz. |

### 3.4 A borítókép következetessége

A `heroImage` a `Posts` sémában **nem kötelező**. Ha a cikkek egy részének van
borítója, a rács fele képes, fele kép nélküli lesz, és ez pontosan az a
következetlenség, amit a Baymard-elv büntet („either don't display the unknown
information in any of the list items, or explicitly state the attribute's
unavailability").

**Két elfogadható út, a vezetőnek kell választania (lásd 10. fejezet, K1):**

1. **A borító kötelezővé válik** a közzétételhez. Egyszerű, következetes, de
   szerkesztői teher, és séma-változást igényel.
2. **Tipográfiai tartalék-borító**: kép hiányában a kártya a tint felületen a
   kategória nevét mutatja ugyanabban a 16:9-es keretben. Nulla séma-változás,
   a rács ritmusa megmarad. **Ezt javaslom**, mert nem blokkolja a
   cikkírást, és a dekoratív stock-fotó ennél mérhetően rosszabb (NN/g: a
   dekoratív képet a felhasználók teljesen figyelmen kívül hagyták).

Amit **nem** csinálunk: általános, tartalom nélküli hangulatfotót teszünk oda.

### 3.5 A kártya-link akadálymentessége

Ez a terv **legfontosabb akadálymentességi javaslata**.

Ma a teljes kártya egyetlen `<a>`, ezért a link hozzáférhető neve a borító
`alt`-ja, a kategória, a cím, a kivonat és a dátum összefűzése: reális cikknél
mérve **279 karakter, 41 szó**. A képernyőolvasók link-listája (VoiceOver
rotor, NVDA link lista) ezt teljes hosszában olvassa fel, tehát a lista
használhatatlan.

**A javasolt minta** (a szakirodalomban „pseudo-content trick", a repóban új,
de a kurzus-kártyán ugyanígy bevezethető később):

- a `<a>` **csak a címre** kerül, a kártya `<h2>`-je belsejébe,
- a kártya gyökere `position: relative`,
- a cím-link `::after` pszeudoeleme `position: absolute; inset: 0` kitölti a
  kártyát, tehát a kattintható felület a teljes kártya marad,
- a többi tartalom (kép, kivonat, dátum) kimarad a link nevéből.

Források: Kitty Giraudel, *Accessible Cards*
([link](https://kittygiraudel.com/2022/04/02/accessible-cards/)) és Nomensa,
*How to build accessible cards, block links*
([link](https://www.nomensa.com/blog/how-build-accessible-cards-block-links/)).
Az indoklás szó szerint: „links can be listed by assistive technologies… so we
want to provide just enough information so that they're understandable and
identifiable on their own."

**Mérhető elfogadási feltétel:** a kártya `<a>` elemének hozzáférhető neve
legyen **azonos a cikk címével**, és ne haladja meg a **80 karaktert**. Ez
gépesíthető őr-teszttel a szerver-renderelt HTML-en.

**Amire figyelni kell.** A `::after` overlay elnyeli a kártyán belüli
szövegkijelölést, és megakadályozza, hogy a kártyába később második link
kerüljön. Mindkettő szándékos: a kártyán ma sincs második link, és a
kategória-címke **nem** válik linkké (az a kategória-szűrő dolga). A
`:focus-within` alapú hover-kiemelés a mai `.kc-card--interactive` szabállyal
változatlanul működik.

### 3.6 A kártya mozgása

A mai `knowledge.css` `scale(1.02)` ráközelítést ad a borítóra és 0,2rem
elmozdulást a nyílra, mindkettőt `prefers-reduced-motion` mögé zárva. Ez marad.
A `.kc-card--interactive` 2 px-es emelése szintén.

**Küszöb:** `prefers-reduced-motion: reduce` mellett a kártya `transform`-ja
`none`, és a lap nyomtatási nézetben is teljes (a `motion.css` `@media print`
szabálya ezt már kezeli a szekció-belépőkre).

---

## 4. A lista-oldal elrendezése

### 4.1 A `/blog` váza, fentről lefelé

```
[fejléc]
┌ SZEKCIÓ (paper) ─────────────────────────────────────────┐
│  Container (wide, 1120)                                  │
│                                                          │
│  TUDÁSTÁR                    ← kc-eyebrow (S, verzál)    │
│  H1: Tudástár                ← kc-page-hero__title (L)   │
│  Lead: egy mondat arról, mit talál itt (measure-comfort) │
│                                                          │
│  [Összes] [Kézrehabilitáció] [Műtét után] …  ← szűrő     │
│                                                          │
│  ┌ KIEMELT (legfrissebb) ────────────────────────────┐   │
│  │  borító 5fr   │  kategória, H2 cím, kivonat, meta │   │
│  └───────────────────────────────────────────────────┘   │
│                                                          │
│  ┌ kártya ────────┐  ┌ kártya ────────┐                  │
│  └────────────────┘  └────────────────┘                  │
│  ┌ kártya ────────┐  ┌ kártya ────────┐                  │
│  └────────────────┘  └────────────────┘                  │
└──────────────────────────────────────────────────────────┘
[lábléc]
```

### 4.2 A kiemelt vezető kártya

**Mikor jelenik meg:** csak a `/blog`-on, és csak ha **legalább 4** közzétett
cikk van. Kevesebbnél a kiemelés a listát üríti ki, ami ugyanaz a hiba, amit a
kurzus-rácsnál már megoldottunk (`course-cards.css` 29–37. sor).

**Formája:** a repóban **már létező** vízszintes kártya-minta
(`.kc-product-card--featured`): `grid-template-columns: minmax(0, 5fr) minmax(0, 7fr)`,
belső térköz `clamp(2rem, 3.2vw, 3rem)`, a szöveg `--kc-measure` korláttal.
Új geometriát nem találunk ki.

**Mért sorhossz a szövegoszlopban:** 900 px-en 56,6 · 1024 px-en 64,9 ·
1120 px-en 69,3 · 1440 px-en 66,1 · 1920 px-en 65,6 karakter/sor. Mind a
45–85-ös tűrésen belül, és 900 px felett a cél-sávban is.

900 px alatt a kiemelt kártya **egyhasábossá** esik vissza, ugyanúgy, ahogy a
kurzus-kártya, tehát mobilon egy szélesebb, kép fölött szöveg elrendezés.

**Miért nem álpadló ez.** A B2.4 tiltja a teljes képernyős tábla-szekciót belső
oldalon. A kiemelt kártya **nem** tábla: természetes magasságú, és alatta a rács
első sora belóg a hajtás fölé. Ellenőrzés: 1440 × 900-as nézetablakban a rács
első kártyájának teteje legyen a hajtás **felett**, vagyis 900 px-nél kisebb
y-koordinátán.

### 4.3 A kategória-szűrő

**Megjelenési szabály (B4.3):** a chip-sor akkor jelenik meg, ha
**legalább 3 valódi kategóriának van legalább egy cikke**, vagy ha a listán
**legalább 5** cikk van. Egy vagy két kategóriánál a szűrő nem ad döntést,
csak zajt és plusz kattintási költséget.

A szűrő kinézete, viselkedése és `aria-current`-je változatlan
(`content.css` `.kc-category-filter`). Az „Összes" chip marad, mert a
visszaút nélkül a szűrt nézet zsákutca lenne.

**Érintőcél:** a chip `min-height: 2.75rem` (44 px), ez már teljesül. WCAG 2.2
**2.5.8** (AA) 24 × 24 px-et kér, a repó gyakorlata a **2.5.5** (AAA) 44 px-es
szintjén áll, és ott is marad.

### 4.4 Lapozás

60 cikk fölött a lista ma némán csonkul (L7). **Küszöb:** ha a közzétett cikkek
száma meghaladja a **12**-t, a lista lapozódik.

Ez ma nem sürgős (0 cikk), ezért a terv csak a szabályt rögzíti, és a
megvalósítást a Tudástár feltöltése utáni körre hagyja. A lapozás formája
**hagyományos, számozott lapozó**, nem végtelen görgetés: a végtelen görgetés
elveszi a láblécet és megnehezíti a visszatérést egy korábban látott cikkhez.

### 4.5 Üres állapotok

A `PostsEmptyState` már kutatás-alapú, és két változatot ad („a Tudástár
üres" és „ebben a témában nincs cikk"). **Ezen nem változtatunk.** Ami
kiegészül: ha a kiemelt kártya megjelenési küszöbe (4 cikk) nem teljesül, akkor
egyszerűen nincs kiemelt kártya, a rács viszi az összes cikket.

### 4.6 A kategória-oldal

Azonos a `/blog`-gal, három eltéréssel:

1. **nincs** kiemelt vezető kártya (2.3),
2. a H1 a kategória neve, alatta a téma egymondatos leírása,
3. morzsamenü: `Tudástár › <téma>`. Az `informacios-architektura.md` 10. sora
   kifejezetten kéri a morzsamenü kiterjesztését a `/blog` ágra. A strukturált
   `BreadcrumbList` már ma is kimegy, a **látható** morzsa hiányzik.

---

## 5. A cikkoldal

### 5.1 Az oldal váza és a sorrend indoklása

```
[fejléc]
┌ HERO (tint sáv, Container narrow 720) ───────────────────┐
│  [Kézrehabilitáció]                    ← kategória-címke │
│  H1: A cikk címe                                         │
│  Lead: az excerpt, measure-comfort                       │
│  Írta: Kocsis Kata gyógytornász · 2026. 08. 21. · 6 perc │
└──────────────────────────────────────────────────────────┘
┌ BORÍTÓ (Container wide) ─ csak ha információt hordoz ────┐
└──────────────────────────────────────────────────────────┘
┌ TÖRZS (Container narrow 720) ────────────────────────────┐
│  ┌ Ezen az oldalon ───────────────┐  ← csak ha kell (5.4)│
│  │ 1. …  2. …  3. …               │                      │
│  └────────────────────────────────┘                      │
│  H2 szakaszcím                                           │
│  bekezdés, felsorolás, kép, gyakorlatlista …             │
│  …                                                       │
│  H2 Források                          ← 5.7              │
│  1. Szerző/kiadó: Cím. Év. (link) Hozzáférés: dátum.     │
│                                                          │
│  ┌ Szerző- és lektor-blokk ───────┐   ← 5.6              │
│  │ arckép · név · végzettség      │                      │
│  │ Utoljára ellenőrizve: …        │                      │
│  └────────────────────────────────┘                      │
└──────────────────────────────────────────────────────────┘
┌ KURZUS-CTA (tint sáv, kompakt panel) ────────────────────┐  ← 5.8
└──────────────────────────────────────────────────────────┘
┌ KAPCSOLÓDÓ CIKKEK (paper) ───────────────────────────────┐  ← 5.9
└──────────────────────────────────────────────────────────┘
[lábléc]
```

**A sorrend két, látszólag ütköző kutatási ajánlást old fel.**

- NN/g, *Related Content Boosts Pageviews, When Done Right*
  ([link](https://www.nngroup.com/articles/related-content-pageviews/)): „Don't
  let anything come between the article and related links", mert a nagy üres
  felület és a hirdetés-szerű doboz **hamis lapvéget** jelez. Ugyanez a cikk
  viszont azt is kimondja: „Always offer related content **and or strong calls
  to action** at the end of articles."
- NN/g, *Informational Articles Must Ask For the Order*
  ([link](https://www.nngroup.com/articles/product-links-on-informational-pages/)):
  a termék-hivatkozás helye „the page's body area and at the end of the
  article", mert a látogató jellemzően keresőből érkezik és a navigációt nem
  járja be. A P&G-esettanulmányban a látogatók „didn't notice that P&G sold a
  product", mert az ajánló link már rég kigörgött a képernyőről.

Feloldás: a CTA **közvetlenül a cikk után** áll, **kompakt** panelként (nem
teljes képernyős sáv, nem hirdetés-arányú doboz, nem nagy üres felület), a
lap saját vizuális nyelvén, és **utána azonnal** jönnek a kapcsolódó cikkek. A
„hamis lapvég" kockázatát mérni kell: lásd az 5.8 küszöböt.

### 5.2 Sorhossz és tipográfiai ritmus

**Konténer: `narrow` (720 px), a folyószöveg `--kc-measure` korláttal.** Mért
sorhossz:

| Nézetablak | Törzsméret | Bekezdés-doboz | Karakter/sor | Ítélet |
|---|---|---|---|---|
| 320 px | 16,00 px | 272 px | **37,9** | a 45-ös alsó határ itt fizikailag elérhetetlen (45 karakterhez 319,8 px kellene) |
| 360 px | 16,00 px | 312 px | 43,5 | határon |
| 390 px | 16,06 px | 342 px | **47,5** | tűrésen belül |
| 768 px | 16,82 px | 544 px | **72,2** | tűrésen belül |
| 1024 px | 17,33 px | 544 px | **70,1** | cél-sávban |
| 1440 px | 18,00 px | 544 px | **67,5** | cél-sávban |
| 1920 px | 18,00 px | 544 px | **67,5** | cél-sávban |

**Ez a mérés egy tévhitet is eloszlat:** nem kell két hasábos cikkoldal
(GOV.UK „two-thirds and one-third") ahhoz, hogy a sorhossz jó legyen. A szűk
konténer + mérték már ma a cél-sávba talál. A kéthasábos elrendezés csak
kockázatot adna: ragadós oldalsáv a WCAG 2.2 **2.4.11** (fókusz takarása) és a
meglévő ragadós fejléc + süti-sáv (`--kc-consent-offset`) mellett.

**Címsorok.** A három-méretes skála marad, változtatás nélkül:

| Szint | Token | Betű | Súly | Mért sorhossz 1440 px-en |
|---|---|---|---|---|
| H1 (cikkcím) | `--kc-font-l` (46,4 px) | Tenor Sans | 400 | 29,4 karakter/sor |
| H2 (szakaszcím) | `--kc-font-l` | Tenor Sans | 400 | ugyanaz |
| H3–H6 | `--kc-font-m` (18 px) | Nunito Sans | 700 | a mérték szerint |
| Törzs, lead | `--kc-font-m` | Nunito Sans | 400 | 67,5 |
| Meta, apróbetű, forrás-sor | `--kc-font-s` (14 px) | Nunito Sans | 400 | a mérték szerint |

A H1 és a H2 azonos méretét a pozíció, a felvezető sor és a szín különbözteti
meg (`content.css` és `tokens.css` már így rendelkezik). **Új méretet bevezetni
tilos**, az őr `src/__tests__/tipografia-harom-meret.test.ts`.

**Bekezdésköz.** Ez az egyetlen tipográfiai érték, amin változtatni javaslok.

| Nézetablak | Sortáv | Mai köz (16 px) | Kell (WCAG 1.4.8 AAA: 1,5 × sortáv) | Tartalék | 24 px-es közzel |
|---|---|---|---|---|---|
| 320 px | 26,72 px | 42,72 px | 40,08 px | **+2,64 px** | +10,64 px |
| 768 px | 28,08 px | 44,08 px | 42,12 px | **+1,96 px** | +9,96 px |
| 1440 px | 30,06 px | 46,06 px | 45,09 px | **+0,97 px** | +8,97 px |

A mai érték tehát **éppen csak** megfelel, egy pixelnyi tartalékkal, és a
következő betűméret- vagy sortáv-hangolás észrevétlenül átbillentheti.
**Javaslat:** a `.kc-richtext p` függőleges margója `--kc-space-4`-ről
`--kc-space-5`-re (16 → 24 px). Ez egyben a réteges olvashatóságot is segíti
(NN/g *Layer-Cake Pattern*).

**Figyelem, fájl-tulajdon:** ez a `styles/content.css` közös lapját érinti,
amit más csapat is használ (a `.kc-richtext` a kurzus-leírásokat és a jogi
oldalakat is viszi). A változtatás előtt a vezetőnek egyeztetnie kell, és a
`src/__tests__/reflow-hasabmeres.test.ts` őrt újra kell futtatni.

**Szakaszcím fölötti térköz.** A `content.css` már beállítja a
`--kc-space-7`-et (48 px) a H2 fölé, ami a cím saját méretének 1,03-szorosa.
Ez marad.

### 5.3 A cikk fejléce

| Elem | Mit tartalmaz | Szabály |
|---|---|---|
| Kategória-címke | Egy címke, a kategória-oldalra linkelve | Ma minden kategória kimegy. Következetesség miatt itt is **egy** (az első), a többi a lap alján, a források alatt kaphat helyet, ha kell. |
| H1 | A cikk címe | Egy H1 laponként (a Lexical-szerializáló a tartalmi h1-et már h2-re lágyítja). Ajánlott hossz **legfeljebb 65 karakter** (NHS: „ideally 65 characters or less"). |
| Lead | Az `excerpt` | `--kc-measure-comfort`, mérve 59,5 karakter/sor 1440 px-en. |
| Meta-sor | „Írta: <név> <szerep> · <dátum> · <n> perc olvasás" | `--kc-font-s`, `text-muted` (kontraszt a tint sávon 8,05:1). |

**A byline a lap tetején rövid, a teljes szerző-blokk a lap alján áll.** Ez
szó szerint az NN/g ajánlása (*Bylines for Web Articles*): a rövid,
hitelesítő információ „at the top of the page to encourage users to read the
article", a bio „at the bottom of articles".

**Borítókép.** Csak akkor jelenjen meg, ha **információt hordoz** (gyakorlat,
kéztartás, eszköz). Az NN/g szemmozgás-mérése szerint a dekoratív képet a
felhasználók teljesen figyelmen kívül hagyják, a valódi embert ábrázoló
portrén viszont **10%-kal több időt** töltöttek, mint az életrajzon, pedig az
utóbbi 316%-kal több helyet foglalt.

**Mérhető küszöb:** a borító `alt` szövege mondjon olyat, ami a címben **nem**
szerepel. Ha nem tud, a kép dekoratív, tehát nem kell.

### 5.4 Tartalomjegyzék („Ezen az oldalon")

**Mikor.** Ha a cikk **800 szónál hosszabb**, **vagy** legalább **5** H2
szakaszcíme van (B2.3). Rövidebb cikknél nem kell, és zavar is: az NN/g
kimondja, hogy „shorter pages make tables of contents unnecessary".

**Forrás.** NN/g, *In-Page Links for Content Navigation*
([link](https://www.nngroup.com/articles/in-page-links-content-navigation/)):
11 résztvevőből **9** ismerte és használta a mintát. A felirat legyen
egyértelmű („Table of Contents" vagy „On This Page"), mert „in-page links, when
not formatted with intention, can still surprise users". Magyarul: **„Ezen az
oldalon"**.

**Hol.** A törzs elején, a lead alatt, a szűk konténerben. **Nem** ragadós
oldalsáv: a ragadós elem a WCAG 2.2 **2.4.11** kockázata a meglévő ragadós
fejléc és süti-sáv mellett, és a kutatás nem ezt a formát vizsgálta.

**Anatómia.**

```
┌ nav aria-labelledby="tudastar-toc-cim" ───────┐
│  h2 id="tudastar-toc-cim": Ezen az oldalon    │
│  1. Miért merev a kéz reggel                  │
│  2. Mit tehetsz otthon                        │
│  3. Mikor fordulj szakemberhez                │
└───────────────────────────────────────────────┘
```

- számozott lista (`<ol>`), mert a cikk sorrendje számít,
- csak a **H2** szintet listázza (H3-mal kétszintű, zsúfolt lista lenne),
- a lista `<nav>`-ban áll, saját címsorral megnevezve (`aria-labelledby`),
- a linkek **minimum 44 px** magas érintőcélt kapnak.

**Amit előbb meg kell építeni.** A Lexical-szerializáló ma nem ad `id`-t a
címsoroknak (`serialize.tsx` `renderHeading`), tehát a horgony nem létezik.
Kell:

1. `id` a H2–H6 elemekre, a **meglévő** `src/lib/slugify.ts`-ből (az magyar
   ékezetet is helyesen kezel),
2. ütközés-feloldás (`-2`, `-3` utótag), mert két azonos szöveg lehet,
3. üres vagy csak írásjeles címsornál tartalék (`szakasz-<n>`),
4. a tartalomjegyzék ugyanabból a bejárásból épüljön, amiből az `id`-k, hogy a
   kettő ne csúszhasson szét.

**Görgetés és fókusz.** A repóban már él az `AnchorScroll`
(`src/components/motion/`), amely a GOV.UK skip-link `setFocus()` mintáját
követi (ideiglenes `tabindex="-1"`, `preventScroll`), és amelynek őre a
`src/__tests__/cimhierarchia-es-horgony.test.ts`. **Ezt kell újrahasználni**,
nem újat írni. A `scroll-padding-top` a `base.css`-ben már be van állítva.

### 5.5 Réteges olvashatóság a törzsben

| Szabály | Küszöb | Forrás |
|---|---|---|
| Beszédes alcím legalább 150 szavanként | szó / H2–H3 arány ≤ 150 | NN/g *Layer-Cake Pattern* ([link](https://www.nngroup.com/articles/layer-cake-pattern-scanning/)), B2.1 |
| A bekezdés legfeljebb 3–4 mondat | mért mondatszám | B8.2; NHS: „short paragraphs of up to 3 sentences" ([link](https://service-manual.nhs.uk/content/how-we-write)) |
| A mondat legfeljebb 20 szó | mért szószám | NHS, ugyanott |
| A felsorolás legfeljebb 6 elem | elemszám | NHS *Formatting* ([link](https://service-manual.nhs.uk/content/formatting)): „Limit your list to no more than 6 items." |
| Nincs h5, h6 | a renderelt DOM-ban 0 db | NHS: „Avoid using h5 headings. If you need 5 heading levels, your content is probably too complex." |
| A szakszó mellett ott a köznyelvi megfelelő ugyanabban a mondatban | emberi ellenőrzés | B8.1 |

**A szkennelés nem stílus kérdése.** Az NN/g mérése szerint a felhasználók
**79%-a** minden új lapot átfut, és csak **16%** olvas szóról szóra; a
tömör szöveg **58%**-kal, a szkennelhető elrendezés **47%**-kal, a
tárgyilagos nyelv **27%**-kal, a három együtt **124%**-kal javította a
használhatóságot (*How Users Read on the Web*,
[link](https://www.nngroup.com/articles/how-users-read-on-the-web/)). Ugyanez a
kutatás mondja ki, hogy a reklámízű nyelv kognitív terhet ad, mert a
felhasználónak ki kell szűrnie a túlzásokat. Ez egybevág a vevőhang-mérésünkkel
és a gyógyulás-ígéret tilalmával.

### 5.6 Szerző- és lektor-blokk (E-E-A-T)

**Miért ez a legfontosabb blokk az oldalon.** Két gyógytornász szakmai
renoméja a tét, a tartalom pedig egészségügyi, tehát a Google szóhasználatával
YMYL: „our systems give even more weight to content that aligns with strong
E-E-A-T for topics that could significantly impact the health, financial
stability, or safety of people"
([Creating helpful, reliable, people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)).
Ugyanez a dokumentum három kérdést tesz fel, és mindháromra a felületnek kell
válaszolnia:

- **Who:** „Is it self-evident to your visitors who authored your content? Do
  pages carry a byline, where one might be expected? Do bylines lead to further
  information about the author or authors involved?"
- **How:** hogyan készült a tartalom.
- **Why:** miért készült („primarily to help people").

Az NN/g byline-kutatása pontosan a mi esetünket nevesíti: a byline akkor kell,
„if the author has credentials or status that support the article's
credibility. **The classic example is a medical doctor writing about a health
issue.**"

**A blokk tartalma:**

```
┌ Card (fehér, hairline) ─────────────────────────────────────┐
│  [arckép]  Kocsis Kata                                      │
│            gyógytornász, kézterapeuta                       │
│            Egy mondat a szakterületről és a tapasztalatról. │
│            Ismerd meg a hátterünket  →   (link /rolunk-ra)  │
│  ─────────────────────────────────────────────────────────  │
│  Utoljára ellenőrizve: 2026. augusztus 21.                  │
│  Következő ellenőrzés: 2028. augusztus 21.                  │
└─────────────────────────────────────────────────────────────┘
```

**Az ellenőrzés-dátumok mintája az NHS-től jön** (*Know that a page is up to
date*,
[link](https://service-manual.nhs.uk/design-system/patterns/know-that-a-page-is-up-to-date)):
a „Page last reviewed" és „Next review due" pár, kis betűmérettel, másodlagos
színnel, a lap alján. A minta mögötti tesztelés (2018 nyara) azt mutatta, hogy
a láblécbe, elválasztó vonal mögé tett dátumot a felhasználók nem vették észre,
a fő tartalomhoz közelebb tett dátumot igen. Ezért kerül a szerző-blokkba, nem
a láblécbe.

**Az „ellenőrzés" jelentése nálunk:** a két gyógytornász átnézte a cikket, és
a benne álló klinikai állításokat a forrásaival együtt jóváhagyta. Ez azonos
azzal, amit az NHS ért alatta: „reviewing the clinical evidence to make sure
that the page is up to date… checking it with a clinician or other subject
matter expert".

**A séma-kérdés.** A `Posts` collection ma nem ismer `reviewedBy`,
`reviewedAt`, `nextReviewAt` mezőt, és a `users` collection sem tárol
végzettséget, szerepet vagy arcképet. Két út van (10. fejezet, K2):

1. **Séma-változás nélkül, azonnal használható:** a lektorálatlan cikk
   egyszerűen **piszkozat marad**, tehát nem is látszik. A szerző-blokk a
   `users.name` mezőből és a `/rolunk` oldalra mutató linkből épül,
   ellenőrzés-dátum nélkül. Ez kevesebb, de nem hazudik.
2. **Séma-bővítés** (`reviewedBy` relationship, `reviewedAt` és `nextReviewAt`
   date, valamint a `users`-en `credentials` és `portrait`). A migrációt a
   Payload eszközével kell generálni (`./node_modules/.bin/payload migrate:create`), kézzel írt
   migráció **tilos**. Ez adja meg a teljes E-E-A-T-választ.

**Amit semmiképp nem teszünk:** nem írunk oda ellenőrzés-dátumot, ha nem
történt ellenőrzés, és nem teszünk a cikk alá szerzőt, aki nem látta.

**Strukturált adat.** Az `articleJsonLd` ma `author` mezőt tesz ki `Person`
típussal, ha van szerző, különben a `SITE_NAME`-et. A séma-bővítés után a
`reviewedBy` a `reviewedBy` schema.org mezőbe való, a `dateModified` pedig a
tényleges ellenőrzés dátumára állítható. Fontos szabály (`seo-geo-llm.md`): a
séma minden mezője a **látható** tartalomból jön.

### 5.7 Forráshivatkozások

Ez az orvosi tartalom első számú követelménye: minden klinikai állítás mellé
ellenőrizhető forrás kell, szerző vagy kiadó, cím, URL és hozzáférési dátum.

**Miért látszania kell.** NN/g, *Trustworthiness in Web Design: 4 Credibility
Factors* ([link](https://www.nngroup.com/articles/trustworthy-design/)): a
negyedik faktor a „connected to the rest of the web", vagyis „people do not
rely solely on one website", és a kifelé mutató, harmadik felet megnevező
hivatkozás azt mutatja, hogy „transparent and confident" vagy. Ugyanez a
`docs/ux-belso-oldalak-kutatas.md` **B6.6** pontja.

**Kétrétegű megoldás, mindkettő a MAI szerializálóval renderelhető:**

1. **A szövegen belül, megnevezett link.** Nem a puszta URL, nem „ide kattints",
   hanem a forrás neve a mondatban: „a Magyar Gyógytornász-Fizioterapeuták
   Társaságának ajánlása szerint …". Ez teljesíti a WCAG 2.2 **2.4.4** (Link
   Purpose in Context, A) és **2.4.9** (Link Purpose Link Only, AAA)
   kritériumot is, mert a link szövege önmagában megnevezi a célt.
2. **A cikk végén, „Források" H2 alatt, számozott lista.** Soronként:
   `Szerző vagy kiadó: Cím. Év. <link a címen>. Hozzáférés: 2026. 08. 21.`

**Mérhető szabályok:**

| Szabály | Küszöb |
|---|---|
| Minden forrás-sor tartalmaz kiadót, címet, linket és hozzáférési dátumot | 4 mező, hiány nélkül |
| A link szövege a **cím**, nem a nyers URL | 0 db `http`-vel kezdődő linkszöveg |
| A külső link új lapon nyílik? | **Nem.** Váratlan kontextus-váltás; a WCAG 2.2 **3.2.5** (Change on Request, AAA) elve szerint a felhasználó kérjen ilyet. |
| A nyers URL nem tör el a hasábban | 320 px-en nincs vízszintes görgetés (a `.kc-richtext` `overflow-wrap: break-word`-je ezt már kezeli) |
| Nyomtatásban a hivatkozás visszakereshető | a `@media print` szabály a linkek mögé kiírja a `href`-et |

A nyomtatási URL-kiírás **konvenció, nem kutatási eredmény**, de a
`motion.css` már ma is számol a nyomtatással („a látogató a gyakorlatsorát
viszi el"), és a papírra nyomtatott forrás link nélkül értéktelen.

**Lábjegyzet-számok (felső indexben, a mondat végén) EGYELŐRE NEM.** Ehhez a
Lexicalba új csomópont-típus kellene, ami külön fejlesztés és külön szerkesztői
tanulás. A megnevezett inline link + záró forrásjegyzék ugyanazt az
ellenőrizhetőséget adja, ma is működik, és a laikus olvasónak érthetőbb.
Későbbi bővítésként javasolt (10. fejezet, K3).

### 5.8 A kurzus-CTA

**Egy CTA, egy helyen: közvetlenül a cikk után.**

| Kérdés | Válasz | Forrás |
|---|---|---|
| Kell-e egyáltalán? | Igen. Ma a cikkoldal zsákutca a vásárlás felé. | NN/g *Informational Articles Must Ask For the Order*: a kihagyás azt jelenti, „you'll attract tons of freeloaders, but no business". |
| Hol? | A törzs után, a kapcsolódó cikkek előtt. | Ugyanott: „in the page's body area and at the end of the article". |
| Milyen hangon? | Halkan. „Turn down the volume on the sales message. If you push too hard, you lose credibility." | Ugyanott. |
| Hány? | **Egy** panel a cikk után. A szerkesztő a törzsbe tehet **egy** kontextusba illő, szöveglink-súlyú említést (a `kc-richtext__cta` már létezik). | B6.5: belső oldalon legfeljebb egy elsődleges CTA-típus. |
| Milyen felirat? | Ha a cikk konkrét kurzushoz kötődik: **„Nyisd meg a kurzusoldalt"** (§3.2 #28, E/2, secondary). Ha nem: **„Nézd meg a kurzusokat"** (§3.2 #10, E/2, primary). | `docs/ui-sztenderdek.md` §3.2. Új feliratot kitalálni tilos. |

**A panel tartalma:** egy mondat arról, mi a kurzus és kinek szól, az ár vagy
az „ingyenes" tény, és a gomb. Az ár a gomb közelében legyen (B6.2, Baymard).

**Amit tilos:** gyógyulási arány, gyógyulási idő, „garantált eredmény",
visszaszámláló, kamu-készlet. A mért vevőhang szerint a versenytárs
„80-20%-os gyógyulási információja" negatív véleményt hozott.

**Mérhető küszöbök:**

| Mit | Küszöb |
|---|---|
| A panel nem néz ki hirdetésnek (B4.2, NN/g *Banner Blindness*) | a lap saját tokenjeivel épül, nincs benne új szín, nincs benne kép |
| Nem ad hamis lapvéget (NN/g related content) | a CTA-panel alja és a kapcsolódó-blokk címsora között **legfeljebb 72 px** (`--kc-space-8`) üres függőleges távolság |
| Nem takarja el a tartalmat | nem ragadós, nem felugró |
| Egy elsődleges cselekvés a lapon | a szerver-renderelt HTML-ben legfeljebb **1** db `kc-button--primary` |

### 5.9 Kapcsolódó cikkek

| Szempont | Mai állapot | Javaslat | Forrás |
|---|---|---|---|
| Darabszám | max 3 (`getRelatedPosts(post, 3)`) | **Marad 3**, amíg a Tudástár kicsi. A közös `.kc-card-grid` hármas rácsában a 3 pontosan egy teli sor, lyuk nélkül (B3.5); a 4 elem 3+1-re törne. Ha a Tudástár 20 cikk fölé nő, **6**-ra emelhető (két teli sor), és akkor éri el az NN/g sávját. | NN/g: „around 5–7 related links to avoid overwhelming users"; a sáv hírportál-jellegű, szöveglinkes listákra vonatkozik, nem kártya-rácsra |
| Szekció-cím | „Kapcsolódó bejegyzések" | **„További cikkek a témában: <kategória>"**, ha egy közös kategória van; különben „További cikkek a Tudástárból". | NN/g: az általános címke („From the Web", „More from NBC News") gyenge; a kategóriának „good information scent" kell |
| Kártya-változat | `list` | **`compact`** (3.1), mert hármas rácsban áll | 3.1 mérés |
| Elhelyezés | a lap alján | marad, közvetlenül a CTA-panel után | NN/g related content |
| Ha nincs kapcsolódó cikk | a szekció nem renderel | marad, **de** ilyenkor a CTA-panel után a lábléc jön, tehát a lap nem lesz zsákutca | skill 5. pont |

---

## 6. Akadálymentesség

### 6.1 Kritériumonként, mért küszöbbel

| WCAG 2.2 | Szint | Mit követel | Küszöb a Tudástárban | Hogyan mérd |
|---|---|---|---|---|
| **1.3.1** Info and Relationships | A | a szerkezet programozottan is látszik | a listaoldalon `<article>` kártyák, a cikkoldalon `<article>`; a tartalomjegyzék `<nav>` + `<ol>`; a források `<ol>` | a renderelt HTML ellenőrzése |
| **1.4.3** Contrast (Minimum) | AA | szöveg ≥ 4,5:1 (nagy szöveg ≥ 3:1) | lásd 6.2, minden érték számolt | számolt arány, nem szemre |
| **1.4.4** Resize Text | AA | 200%-os nagyítás információvesztés nélkül | a clamp-alapú skála és a `rem`-ben írt mérték ezt adja | 1280 px-es ablak 200%-on |
| **1.4.8** Visual Presentation | AAA | ≤ 80 karakter/sor, sortáv ≥ 1,5, bekezdésköz ≥ 1,5 × sortáv | sorhossz max **72,2** (5.2); a bekezdésköz tartaléka ma **+0,97 px**, javaslat 24 px-re emelni | 0.2 szerinti számítás |
| **1.4.10** Reflow | AA | 320 CSS px-en nincs kétirányú görgetés | a dokumentum szélessége **pontosan 320 px** legyen 320 px-es nézetablakban | `src/__tests__/reflow-hasabmeres.test.ts` mintájára |
| **1.4.11** Non-text Contrast | AA | UI-határ, ikon, fókuszgyűrű ≥ 3:1 | a chip kerete (`border-strong`) 3,57–4,13:1; a fókuszgyűrű (`accent-deep`) 4,72–5,45:1 | 6.2 |
| **1.4.12** Text Spacing | AA | a felhasználó által beállított 1,5-ös sortáv és 2× bekezdésköz mellett sincs tartalomvesztés | a `--kc-leading-body` 1,67 már efölött van; a doboz-magasságok nem fixek | kézi próba felülíró stíluslappal |
| **2.3.3** Animation from Interactions | AAA | a nem lényegi mozgás kikapcsolható | minden átmenet `prefers-reduced-motion` mögött; a hosszú horgony-ugrás nem animálódik (`.kc-scroll-instant`) | kód + őr |
| **2.4.1** Bypass Blocks | A | átugorható ismétlődő blokk | a `.kc-skip-link` már él, a `<main>` a cél | Tab-bal az első elem |
| **2.4.3** Focus Order | A | a fókusz sorrendje a vizuálisat követi | a tartalomjegyzék-kattintás után a fókusz a **cél szakaszcímen** áll (a meglévő `AnchorScroll` `setFocus` mintája) | Tab-bejárás |
| **2.4.4** Link Purpose (In Context) | A | a link célja kiderül | a kártya-link neve **a cikk címe**, legfeljebb 80 karakter (3.5); a forrás-linkek szövege a forrás címe | hozzáférhető név mérése |
| **2.4.6** Headings and Labels | AA | a címsor és a címke leíró | „Ezen az oldalon", „Források", „További cikkek a témában" | emberi ellenőrzés |
| **2.4.9** Link Purpose (Link Only) | AAA | a link önmagában is érthető | ugyanaz, mint 2.4.4; nincs „ide kattints", nincs „Tovább" | ua. |
| **2.4.10** Section Headings | AAA | a szakaszoknak van címe | minden lap-szekció H2-vel indul, a cikk törzse H2-kkel tagolt | DOM-ellenőrzés |
| **2.4.11** Focus Not Obscured (Minimum) | AA | „the component is not entirely hidden due to author-created content" | a tartalomjegyzék **nem ragadós**; a `scroll-padding-top` és a `--kc-consent-offset` már beállítva | Tab-bejárás görgetés közben, asztali és mobil |
| **2.4.13** Focus Appearance | AAA | vastag, kontrasztos fókuszjel | a globális `:focus-visible` 3 px-es gyűrű, 2 px offsettel | kézi próba |
| **2.5.8** Target Size (Minimum) | AA | ≥ 24 × 24 CSS px | a repó gyakorlata **44 × 44** (a 2.5.5 AAA szintje): a chipek, a gombok és a tartalomjegyzék-linkek is | mért doboz |
| **3.1.1 / 3.1.2** Language | A / AA | a lap és a részek nyelve jelölt | `lang="hu"` a gyökéren (megvan); idegen nyelvű forrás-cím `lang="en"` jelölést kap | DOM |
| **3.2.4** Consistent Identification | AA | ugyanaz a cselekvés ugyanazzal a névvel | a feliratok kizárólag a §3.2 szótárból (7. fejezet) | `src/__tests__/cta-a-termekben.test.ts` |

### 6.2 A kontraszt-jegyzőkönyv, újraszámolva

A `tokens.css` értékeit a WCAG relatív luminancia képletével újraszámoltam.
**Mind a 23 pár egyezett a dokumentált értékkel**, tehát a tokenek
megbízhatók, és a Tudástárnak nincs szüksége új színre.

A Tudástár által ténylegesen használt párok:

| Szerep | Szín / háttér | Arány | Ítélet |
|---|---|---|---|
| Cikkcím, kártyacím, folyószöveg fehér kártyán | ink / fehér | **15,63:1** | AAA |
| Folyószöveg a lapon | ink / paper | **14,79:1** | AAA |
| Cikk-hero szövege a tint sávon | ink / tint | **13,53:1** | AAA |
| Kivonat, meta-sor fehér kártyán | ink-soft / fehér | **9,30:1** | AAA |
| Meta-sor a tint hero-ban | ink-soft / tint | **8,05:1** | AAA |
| Felvezető sor, szöveglink a lapon | accent-deep / paper | **5,16:1** | AA |
| Elsődleges gomb felirata | fehér / accent-deep | **5,45:1** | AA |
| Elsődleges gomb hoverben | fehér / accent-deeper | **7,08:1** | AAA |
| Kategória-címke (`badge--info`) | ink / accent-quiet | **8,49:1** | AAA |
| Chip kerete fehéren / paperen / tinten | border-strong | **4,13 / 3,91 / 3,57:1** | UI-határ rendben |
| Fókuszgyűrű a három világos felületen | accent-deep | **5,45 / 5,16 / 4,72:1** | UI-határ rendben |

**Akcent-korlát (változatlan):** az `accent` (#3d78aa) a paperen 4,45:1, a
tinten 4,07:1, tehát **szöveget nem hordozhat**, csak dekorációt (kártya-keret,
nyíl, vonal). A kártya hover-kerete és a nyíl ezért marad `accent`.

**Hairline:** a `#d8e2eb` fehéren 1,31:1, tudatosan dekoratív. A kártya kerete
és a kártya-lábban a vonal ilyen. Ahol a keret **azonosít** (chip), ott
`border-strong` jár. Ez a mai állapot, változtatás nincs.

### 6.3 A kézi ellenőrzési kör (az implementáló ügynöknek)

1. **Tab-bejárás** a `/blog`-on és egy cikken: minden kártya egy tabbal
   elérhető, a fókuszgyűrű mindig látszik, sorrendje a vizuálisat követi.
2. **Képernyőolvasós link-lista** a `/blog`-on: a kártya-linkek nevei a
   cikkcímek legyenek, nem 40 szavas szövegfolyamok.
3. **320 px-es nézetablak**: a dokumentum szélessége 320 px, nincs vízszintes
   görgetősáv sem a listán, sem a cikken, sem a forrás-jegyzékben.
4. **200%-os nagyítás** 1280 px-es ablakban.
5. **`prefers-reduced-motion: reduce`**: nincs kártya-emelés, nincs
   kép-ráközelítés, a horgony-ugrás azonnali.
6. **Nyomtatási nézet** egy cikkre: minden szekció látszik (a `motion.css`
   `@media print` szabálya miatt), és a forrás-linkek mögött ott a cím.
7. **Kognitív séta**: hol vagyok, mit tehetek itt, hova jutok, ha rákattintok.
   Külön végig kell játszani a keresőből érkező látogatót, aki a cikkoldalra
   esik be, és soha nem látta a kezdőlapot.

---

## 7. Mikroszöveg és feliratok

### 7.1 A szabály

Minden felirat a `docs/ui-sztenderdek.md` **§3.2 CTA-szótárból** jön. **Új
feliratot kitalálni tilos**: ha a cselekvésre nincs sor, előbb a §3.2-t kell
bővíteni, forrással, és a bővítés a `src/lib/cta-vocabulary.ts`-be is bekerül.

A nyelvtani személy a **P-1** szabály szerint: a látogató saját, elkötelező
cselekvése E/1, a puszta navigáció E/2, a bevett egyszavas címke főnévi.

**Gondolatjel a felületen: nulla.** Sem gombon, sem címkén, sem `aria-label`-ben,
sem meta-sorban. A meta-sor elválasztója **középpont** (`·`) vagy külön elem,
nem gondolatjel. Kvirtmínusz (U+2014) sehol.

### 7.2 A Tudástár feliratai

| Hol | Felirat | §3.2 sor / szabály |
|---|---|---|
| Kezdőlapi szekció záró linkje | Nézd meg a tudástárat | #35, E/2, link |
| Üres állapot, kurzusokra | Nézd meg a kurzusokat | #10, E/2, primary |
| Üres állapot, ingyenes kurzus | Elindítom ingyen | #3/#4, E/1, secondary |
| Üres állapot, vissza a listára | Vissza a Tudástárba | #15 mintázata, E/2 |
| Üres állapot, kapcsolat | Írj nekünk | #33, E/2, secondary |
| Cikkoldali CTA, konkrét kurzusra | Nyisd meg a kurzusoldalt | #28, E/2, secondary |
| Cikkoldali CTA, kurzuslistára | Nézd meg a kurzusokat | #10, E/2, primary |
| Szerző-blokk linkje | Ismerd meg a hátterünket | #34, E/2, link |

### 7.3 Nem CTA jellegű feliratok

Ezek **címkék és címsorok**, nem cselekvések, tehát nem a CTA-szótár hatálya
alá esnek. A szabály rájuk a §3.1 mikroszöveg-szabályzat és a natív magyar hang.

| Hol | Javasolt szöveg | Miért |
|---|---|---|
| Tartalomjegyzék címe | **Ezen az oldalon** | NN/g: „Table of Contents" vagy „On This Page" jellegű, egyértelmű címke |
| Források címe | **Források** | egyszerű, bevett |
| Szerző-blokk címe | **A cikket írta és ellenőrizte** | megmondja, mi történt, nem csak azt, ki az |
| Kapcsolódó cikkek címe | **További cikkek a témában: <kategória>** | NN/g: beszédes kategória, jó információ-szag |
| Byline a fejlécben | **Írta: <név>, <végzettség>** | Google „Who"; NN/g byline |
| Ellenőrzés dátuma | **Utoljára ellenőrizve: 2026. augusztus 21.** | NHS „Page last reviewed" |
| Következő ellenőrzés | **Következő ellenőrzés: 2028. augusztus 21.** | NHS „Next review due" |
| Olvasási idő | **kb. 6 perc olvasás** | a „kb." kimondja, hogy becslés (indoklás a táblázat alatt) |
| Meta-sor elválasztója | `·` (középpont) | §3.1.2: gondolatjel elválasztóként tilos |

**Az olvasási idő feliratáról.** A `reading-time.ts` 200 szó/perccel számol.
Erre **nincs magyar nyelvre validált kutatási forrás**; a legjobb elérhető
mérés Brysbaert 2019-es meta-elemzése (190 vizsgálat, 18 573 fő), amely
**238 szó/perc** néma olvasási sebességet ad angol nem-fikcióra, és kimondja,
hogy a különbséget a szóhossz magyarázza. A mi korpuszunkban az átlagos szóhossz
**6,23 betű**, ami a magyar agglutináló szerkezet miatt hosszabb az angolnál,
tehát a 200-as érték **védhető**, de becslés. A két érték 1600 szóig ugyanazt a
percet adja, felette 1 perc az eltérés.

**Ezért:** a 200 marad, a felirat viszont mondja ki, hogy becslés („kb."), és a
`reading-time.ts` fejlécében szerepeljen a forrás. Az olvasási idő
megjelenítésének hasznára **nincs erős bizonyíték**, csak szakmai konvenció,
ezért nem építünk rá további funkciót.

---

## 8. Amit tudatosan NEM csinálunk

| Nem csináljuk | Miért |
|---|---|
| **Hármas kártya-rács** | Mérve 28,8–36,4 karakter/sor, a saját 45-ös tűréshatárunk alatt minden asztali szélességen (2.2). |
| **Ragadós, oldalsó tartalomjegyzék** | A WCAG 2.2 **2.4.11** kockázata a meglévő ragadós fejléc és süti-sáv mellett, és a kutatás nem ezt a formát vizsgálta. |
| **Olvasási haladásjelző csík** | Nincs mögötte kutatás, folyamatos mozgást ad, és a lapon már van egy haladás-nyelv (kurzus-haladás), amivel összekeverhető. |
| **Végtelen görgetés a listán** | Elveszi a láblécet, és megnehezíti a visszatérést egy már látott cikkhez. |
| **Teljes képernyős (100dvh) cikkfejléc** | **B2.4** álpadló-tilalom: az NN/g *Illusion of Completeness* vizsgálatában 8-ból 6 felhasználó nem vette észre, hogy a lap görgethető. |
| **Dekoratív hangulatfotó a cikk élén** | Az NN/g szemmozgás-mérésében a dekoratív képet teljesen figyelmen kívül hagyták. |
| **Szerző neve a kártyán** | Nem segít választani, viszont egyenetlenné teszi a kártya-magasságot (3.3). |
| **„Tovább olvasom" gomb a kártyán** | §3.1.4 **M-7**, és beágyazott link lenne a kártya-linkben. |
| **Lábjegyzet-számok a szövegben** | Új Lexical-csomópont kellene hozzá; a megnevezett inline link + záró forrásjegyzék ugyanazt adja, ma is működik (5.7). |
| **Új szín, betű vagy méret** | A három-méretes skála és a `tokens.css` paletta zárt; az őr `tipografia-harom-meret.test.ts`. |
| **Gyógyulási arány, gyógyulási idő, „garantált eredmény"** | A feladatkiírás orvosi szabálya, és a mért vevőhang: a versenytárs „80-20%-os gyógyulási információja" negatív véleményt hozott. |
| **Ellenőrzés-dátum ellenőrzés nélkül** | Hazugság, és pont a bizalmat rombolná, amiért a blokk létezik. |

---

## 9. Implementációs terv, fájlonként

> Ez nem kód, hanem munkamegosztás és elfogadási feltétel. A fájl-tulajdonlás
> azért ilyen részletes, mert párhuzamosan más csapatok is dolgoznak
> (`CLAUDE.md` 16. üzemeltetési tanulság).

### 9.1 Amihez hozzá kell nyúlni

| Fájl | Mi történik | Kockázat / kivel kell egyeztetni |
|---|---|---|
| `src/components/content/PostCard.tsx` | két változat (`list` / `compact`); a link csak a címre kerül; egy kategória-címke; olvasási idő a lábba | a kezdőlapi `KnowledgeSection` és a `PostView` is használja, mindkettő `compact` lesz |
| `src/app/(frontend)/styles/blocks/knowledge.css` | `.kc-card-grid--posts` rács (2.2); a kártya `position: relative` + a cím-link `::after` overlay; `hyphens: auto`; a kivonat 3 soros korlátja | a poszt-kártya saját lapja, tiszta tulajdon |
| `src/app/(frontend)/blog/page.tsx` | eyebrow + lead; kiemelt kártya 4 cikktől; `.kc-card-grid--posts`; a szűrő megjelenési küszöbe | önálló |
| `src/app/(frontend)/blog/kategoria/[slug]/page.tsx` | ua., kiemelt kártya nélkül; látható morzsamenü | önálló |
| `src/components/content/PostView.tsx` | tartalomjegyzék; források-szekció; szerző- és lektor-blokk; kurzus-CTA panel; a kapcsolódó blokk beszédes címe; a kapcsolódó kártyák `compact` változata | önálló |
| `src/components/lexical/serialize.tsx` | a H2–H6 kap `id`-t (`slugify` + ütközés-feloldás); a bejárás adja vissza a címsor-fát a tartalomjegyzékhez | **közös fájl**, a kurzus-leírásokat és a jogi oldalakat is rendereli; az `id` hozzáadása visszafelé kompatibilis, de a `lexical-renderer.test.ts` őrt futtatni kell |
| `src/lib/reading-time.ts` | a fejlécbe a forrás (Brysbaert 2019) és a becslés-jelleg | önálló |

### 9.2 Amihez ebben a körben NEM nyúlunk

| Fájl | Miért |
|---|---|
| `src/app/(frontend)/styles/tokens.css` | nincs új token; a terv a meglévőkből épül |
| `src/app/(frontend)/styles/content.css` `.kc-card-grid` | a kezdőlap és a kurzus-szekció is használja; a Tudástár saját modosítót kap helyette |
| `src/app/(frontend)/styles/content.css` `.kc-richtext p` margója | a **javasolt** 16 → 24 px változtatás közös lapot érint, ezért **vezetői döntés** (10. fejezet, K4) |
| `src/collections/Posts.ts` | a séma-bővítés külön döntés (10. fejezet, K1 és K2), és migrációt igényel |
| bármely migrációs fájl | tiltott zóna; migrációt csak a Payload eszköze generálhat |

### 9.3 Javasolt őr-tesztek

| Őr | Mit véd | Bukás-feltétel |
|---|---|---|
| **G-T1 kártya-link neve** | 3.5 | a `/blog` szerver-renderelt HTML-jében egy kártya `<a>` hozzáférhető neve eltér a cikk címétől, vagy hosszabb 80 karakternél |
| **G-T2 kártya-mezők** | 3.2, B4.1 | egy kártyán egynél több kategória-címke, vagy a mezők sorrendje eltér a rögzítettől |
| **G-T3 rács** | 2.2 | a `.kc-card-grid--posts` szabálya nem `auto-fit`/`minmax` alapú, vagy a track alsó korlátja 26rem alá csökken (ez visszahozná a harmadik hasábot), vagy a felső korlát 34rem fölé nő |
| **G-T4 címsor-horgony** | 5.4 | a Lexical-renderelt H2 nem kap `id`-t, vagy két azonos `id` keletkezik egy lapon |
| **G-T5 tartalomjegyzék-küszöb** | 5.4 | 800 szó vagy 5 H2 felett nem renderel tartalomjegyzéket, illetve rövid cikknél mégis renderel |
| **G-T6 CTA-darabszám** | 5.8, B6.5 | a cikkoldal HTML-jében egynél több `kc-button--primary` |
| **G-T7 gondolatjel** | §3.1.2 | bármely U+2014 a Tudástár komponenseinek szöveg-literáljaiban |
| **G-T8 reflow** | 1.4.10 | a `/blog` vagy egy cikk dokumentum-szélessége > 320 px 320 px-es nézetablakban (a meglévő `reflow-hasabmeres.test.ts` mintájára) |
| **G-T9 három méret** | tokens | a meglévő `tipografia-harom-meret.test.ts` bukik, ha bárhol új `font-size` jelenik meg |

### 9.4 Sorrend, amiben érdemes építeni

1. `serialize.tsx` címsor-`id` (enélkül nincs tartalomjegyzék),
2. `PostCard` két változata + a link-minta + a `knowledge.css` rács,
3. lista-oldalak (kiemelt kártya, szűrő-küszöb, morzsa),
4. `PostView` (tartalomjegyzék, források, szerző-blokk, CTA, kapcsolódó),
5. őr-tesztek,
6. mérés és kognitív séta a 6.3 szerint.

---

## 10. Nyitott kérdések a vezetőnek

Ezekben **nem** döntök, mert valódi termék- vagy adatmodell-döntést igényelnek.

| # | Kérdés | Miért kell dönteni | Amit javaslok |
|---|---|---|---|
| **K1** | Kötelező legyen-e a borítókép a közzétett cikken, vagy legyen tipográfiai tartalék-borító? | A vegyes állapot mérhetően rontja a listát (Baymard-elv, 3.4). | Tipográfiai tartalék: nem blokkolja a cikkírást, és a dekoratív stock-fotónál mérhetően jobb. |
| **K2** | Bővüljön-e a séma a lektorálás mezőivel (`reviewedBy`, `reviewedAt`, `nextReviewAt`, valamint a `users`-en `credentials`, `portrait`)? | Enélkül a szerző-blokk kevesebbet mond, mint amit az E-E-A-T és az NHS-minta kér. Migráció-generálást igényel. | Igen, de külön körben, külön PR-ben. Addig a lektorálatlan cikk marad piszkozat. |
| **K3** | Kell-e lábjegyzet-szám (felső index) a klinikai állítások mellé? | Új Lexical-csomópont, szerkesztői tanulás. | Most nem. A megnevezett inline link és a záró forrásjegyzék ugyanazt az ellenőrizhetőséget adja. |
| **K4** | A `.kc-richtext` bekezdésköze 16-ról 24 px-re emelkedjen-e? | Közös lapot érint (kurzus-leírás, jogi oldalak); a mai WCAG 1.4.8 tartalék **+0,97 px**. | Igen, de a vezető egyeztesse azzal a csapattal, aki a `content.css`-t birtokolja, és a `reflow-hasabmeres` őrt futtassa újra. |
| **K5** | A kiemelt vezető kártya küszöbe 4 cikk legyen? | Kevesebb cikknél a kiemelés kiüríti a rácsot. | 4. Ha a Tudástár 3 cikkel indul, a kiemelt kártya egyszerűen nem jelenik meg, és ez így helyes. |
| **K6** | Kell-e külön „Gyakorlatok" nézet a Tudástárban? | A `kc-richtext__exercise-list` gyakorlatlista-renderelő már létezik, tehát a gyakorlat-cikk külön tartalomtípus lehetne. | Most nem, kategóriával megoldható. Újranézni, ha 10+ gyakorlat-cikk lesz. |
| **K7** | A `/blog` URL maradjon-e, amikor a menüpont neve „Tudástár"? | Az IA-audit N1 pontja mérte ki az eltérést. Az URL váltása átirányítás-láncot igényel. | Külön döntés, ez a terv nem érinti. |

---

## 11. Forrásjegyzék

Minden forrás **2026. augusztus 21-én** ellenőrizve.

### 11.1 Szabvány

- W3C, *WCAG 2.2, Understanding SC 1.4.8 Visual Presentation (AAA)*: https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html
- W3C, *WCAG 2.2, Understanding SC 1.4.12 Text Spacing (AA)*: https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html
- W3C, *WCAG 2.2, Understanding SC 2.4.10 Section Headings (AAA)*: https://www.w3.org/WAI/WCAG22/Understanding/section-headings.html
- W3C, *WCAG 2.2, Understanding SC 2.4.11 Focus Not Obscured (Minimum) (AA)*: https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html
- W3C, *WCAG 2.2, Understanding SC 1.4.10 Reflow (AA)*: https://www.w3.org/WAI/WCAG22/Understanding/reflow.html
- W3C, *WCAG 2.2, Understanding SC 2.5.8 Target Size (Minimum) (AA)*: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- W3C, *CSS Techniques C33: Allowing for Reflow with Long URLs and Strings of Text*: https://www.w3.org/WAI/WCAG22/Techniques/css/C33

### 11.2 Nielsen Norman Group

- *Cards: UI-Component Definition*: https://www.nngroup.com/articles/cards-component/
- *Mobile Navigation: Image Grids or Text Lists?*: https://www.nngroup.com/articles/image-vs-list-mobile-navigation/
- *In-Page Links for Content Navigation*: https://www.nngroup.com/articles/in-page-links-content-navigation/
- *Related Content Boosts Pageviews, When Done Right*: https://www.nngroup.com/articles/related-content-pageviews/
- *Informational Articles Must Ask For the Order*: https://www.nngroup.com/articles/product-links-on-informational-pages/
- *Bylines for Web Articles?*: https://www.nngroup.com/articles/bylines-for-web-articles/
- *Trustworthiness in Web Design: 4 Credibility Factors*: https://www.nngroup.com/articles/trustworthy-design/
- *How Users Read on the Web*: https://www.nngroup.com/articles/how-users-read-on-the-web/
- *Photos as Web Content*: https://www.nngroup.com/articles/photos-as-web-content/
- *The Layer-Cake Pattern of Scanning Content on the Web*: https://www.nngroup.com/articles/layer-cake-pattern-scanning/
- *The Illusion of Completeness*: https://www.nngroup.com/articles/illusion-of-completeness/
- *Banner Blindness Revisited*: https://www.nngroup.com/articles/banner-blindness-old-and-new-findings/

### 11.3 Baymard Institute

- *2 Key Design Principles for Product Listing Information (64% Get at Least 1 Wrong)*: https://baymard.com/blog/list-item-design-ecommerce
- *E-Commerce Product Lists & Filtering UX*: https://baymard.com/research/ecommerce-product-lists
- *Avoid „Quick Views" for Spec-Driven Product Types (21% Don't)*: https://baymard.com/blog/ecommerce-quick-views

### 11.4 Tervezési rendszerek és tartalmi útmutatók

- GOV.UK Design System, *Layout*: https://design-system.service.gov.uk/styles/layout/
- NHS digital service manual, *Formatting*: https://service-manual.nhs.uk/content/formatting
- NHS digital service manual, *How we write*: https://service-manual.nhs.uk/content/how-we-write
- NHS digital service manual, *Know that a page is up to date*: https://service-manual.nhs.uk/design-system/patterns/know-that-a-page-is-up-to-date
- Material Design 3, *Breakpoints*: https://m3.material.io/foundations/layout/breakpoints/overview
- IBM Carbon Design System, *Empty states pattern*: https://carbondesignsystem.com/patterns/empty-states-pattern/

### 11.5 Akadálymentes kártya-minta

- Kitty Giraudel, *Accessible Cards*: https://kittygiraudel.com/2022/04/02/accessible-cards/
- Nomensa, *How to build accessible cards, block links*: https://www.nomensa.com/blog/how-build-accessible-cards-block-links/

### 11.6 Kereső és hitelesség

- Google Search Central, *Creating helpful, reliable, people-first content* (E-E-A-T, Who/How/Why, YMYL): https://developers.google.com/search/docs/fundamentals/creating-helpful-content

### 11.7 Lektorált közlemény

- Brysbaert, M. (2019). *How many words do we read per minute? A review and meta-analysis of reading rate.* Journal of Memory and Language, 109, 104047. https://doi.org/10.1016/j.jml.2019.104047 (190 vizsgálat, 18 573 fő; néma olvasás nem-fikcióra 238 szó/perc)

### 11.8 A repó saját kutatásai

`docs/ui-sztenderdek.md` (§2, §3.1, §3.2, §6) ·
`docs/ux-belso-oldalak-kutatas.md` (B1–B8) ·
`docs/informacios-architektura.md` (N1, N7, Z2, 6.8) ·
`docs/ertekesitesi-ux-skill.md` · `docs/felhasznaloi-seta.md` ·
`docs/vevohang-es-hirdetesszoveg.md` · `docs/seo-geo-llm.md` ·
`docs/tudastar-hangnem-es-technika.md`

### 11.9 Amihez NEM találtam elfogadható forrást (kimondva)

| Állítás | Státusz |
|---|---|
| Az olvasási idő kiírása javítja az élményt | **Nincs erős bizonyíték.** Csak marketing-blogok állítják. Konvencióként tartjuk meg, funkciót nem építünk rá. |
| Magyar nyelvre validált olvasási sebesség (szó/perc) | **Nincs.** A legjobb elérhető adat angol nyelvű (Brysbaert 2019). A 200-as érték becslés, ezért „kb." a felirat. |
| A kapcsolódó cikkek pontos darabszáma (3 most, 6 később) | Az NN/g 5–7-et ajánl hírportál-környezetben, szöveglinkes listákra; nálunk a szám a hármas rács geometriájából jön, nem kutatásból. **Saját, indokolt döntés.** |
| A nyomtatási nézetben kiírt URL | **Konvenció**, nincs mögötte kutatás. |
| A kiemelt kártya 4 cikkes küszöbe | **Saját, gyakorlati küszöb**, a rács-geometriából. |
| A tartalomjegyzék 800 szavas küszöbe | A B2.3-ból örökölt, ott is „saját, gyakorlati javaslat". |

---

## 12. Függelék: a mérés reprodukálása

A számok bármikor újraszámolhatók, böngésző nélkül is, mert a betűmetrika és a
doboz-geometria determinisztikus.

**1. Betűszélességek.** `fontTools`-szal nyisd meg a
`public/fonts/nunito-sans-var-latin.woff2` és
`nunito-sans-var-latin-ext.woff2` fájlokat, metszd ki belőlük a `wght: 400`
példányt (`fontTools.varLib.instancer.instantiateVariableFont`), majd a
`getBestCmap()` és a `hmtx` táblából építs `karakter → szélesség / unitsPerEm`
táblát. A címsorhoz ugyanez a `tenor-sans-400-latin*.woff2` párral.

**2. Korpusz.** `src/lib/legal-source/aszf.txt`,
`src/lib/legal-source/adatkezeles.txt`,
`docs/vevohang-es-hirdetesszoveg.md`, `docs/tudastar-hangnem-es-technika.md`.
A markdown-fájlokból vedd ki a kódblokkokat, az inline kódot, az URL-eket és a
jelölő karaktereket. Tartsd meg a betűket, a számokat, a szóközt és az alap
írásjeleket.

**3. Átlagos karakterszélesség.** A korpusz karakter-gyakoriságával súlyozott
átlag. Az eredménynek **0,4480 em**-nek kell kijönnie a Nunito Sans 400-ra és
**0,4818 em**-nek a Tenor Sansra, 100%-os glif-lefedettséggel.

**4. Betűméret a nézetablak függvényében.** A `tokens.css` clamp-jeiből:
`--kc-font-m = min(max(16, 15,28 + 0,002 × vw), 18)`,
`--kc-font-l = min(max(32, 25,92 + 0,017 × vw), 46,4)`,
`--kc-font-s = min(max(13, 12,56 + 0,0012 × vw), 14)`.

**5. Doboz-szélességek.** Lista: `tartalom = min(vw, 1120) − 48`;
`hasáb = (tartalom − (n−1) × 24) / n`; `szövegdoboz = hasáb − 48`.
Cikk: `tartalom = min(vw, 720) − 48`; `bekezdés = min(tartalom, 544)`.

**6. Karakter/sor.** `szövegdoboz / (0,4480 × betűméret)`; címsornál
`szövegdoboz / ((0,4818 + 0,01) × betűméret)`.

**7. Kontraszt.** WCAG relatív luminancia:
`L = 0,2126·f(R) + 0,7152·f(G) + 0,0722·f(B)`, ahol
`f(c) = c/12,92`, ha `c ≤ 0,03928`, különben `((c + 0,055)/1,055)^2,4`;
az arány `(L_világos + 0,05) / (L_sötét + 0,05)`.

**8. Bekezdésköz-ellenőrzés (WCAG 1.4.8).**
`sortáv = betűméret × 1,67`; `bekezdésköz = sortáv + margó`;
az elvárás `bekezdésköz ≥ 1,5 × sortáv`.

A böngészős mérésekhez (tényleges dokumentum-szélesség 320 px-en,
fókusz-bejárás, nyomtatási nézet) a `docs/ui-sztenderdek.md` §6.1 szerinti
Chromium + playwright-core harness kell; azt ez a terv nem váltja ki.
