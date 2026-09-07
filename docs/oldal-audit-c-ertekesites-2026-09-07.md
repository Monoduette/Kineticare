# Értékesítési út audit (AUDIT-C): a listától a köszönőoldalig, 2026. szeptember 7.

**Mit vizsgáltam:** a `main` aznapi állapota a teljes vásárlási úton:
`/kurzusok` (lista), `/kurzusok/otthoni-kezrehab-program` (fizetős termékoldal),
`/kurzusok/sos-kezrelax-villamkurzus` (ingyenes termékoldal), `/akcios-kurzus`
(kampány-landing), `/kosar`, `/penztar`, `/fizetes/koszonom`, `/sikertelen`.
**Csak audit**, kódot és tartalmat nem módosítottam, fizetést élesben nem
indítottam.

**Eszköz és környezet.** Geometria, kontraszt, érintőcél, űrlapmezők és
találat-teszt: helyi fejlesztői szerver (`http://localhost:3000`), Chromium 1194
(playwright-core), 1440×900, 390×844 és 320×800 px, `prefers-reduced-motion:
reduce`. Tartalom, SEO-réteg és navigáció: az ÉLES alkalmazás nyers HTML-je
(`https://kineticare-production.up.railway.app`, letöltve 2026-09-07). A két
forrás azért van szétválasztva, mert a checkout-ot élesben megnyitni sem akartam
(a beküldés valódi Barion-fizetést indítana), a tartalom viszont a helyi seedben
egy modullal kevesebb (élesben 4 modul a fizetős kurzuson, helyben 3), és a
navigáció is eltér. Ahol az élő és a helyi állapot különbözik, azt kiírom.

**Módszer.** (1) Baymard checkout- és termékoldal-kutatás szerinti tételes
átvizsgálás (<https://baymard.com/research/checkout-usability>), (2) Nielsen tíz
heurisztikája (<https://www.nngroup.com/articles/ten-usability-heuristics/>),
(3) mérés (geometria, kontraszt, találat-teszt `elementFromPoint`-tal, 320 px
reflow), (4) kognitív séta Kovácsné personájával
(`docs/felhasznaloi-seta.md`), (5) a `digital-marketing-mastery` skill
ecommerce- és CRO-modulja szerinti tölcsér-elemzés, (6) SEO-réteg (title, meta,
strukturált adat, belső linkelés, indexelhetőség).

**Amit NEM ismétlek meg:** a kezdőlap tételei
(`docs/kezdolap-ux-audit-2026-09-07.md`). Ahol ugyanaz a hiba a vásárlási úton
is előjön, hivatkozom rá, és csak az ÚJ mérést közlöm. Két kezdőlapi tétel
időközben rendeződött, ezt itt is mértem: a kurzuskártyákon MA már ott a
szótári CTA-felirat („Nyisd meg a kurzusoldalt", „Elindítom ingyen"), tehát a
kezdőlapi P2-5 a `/kurzusok` listán is megoldott.

**Kanonikus adatréteg:** `docs/ADATOK-mert.md`. Kitalált volumen, CPC vagy
pozíció ebben a dokumentumban nincs; ahol nincs mért szám, azt kiírom
nyitott kérdésként.

---

## 1. Összefoglaló

A vásárlási út **mérnökileg erős, üzletileg gyenge**. A checkout hibakezelése,
a vendégvásárlás, a jogi nyilatkozatok, a dupla beküldés elleni védelem, a
Barion-jelzés és a hibaágak (elutasított fizetés, visszatérítés, vendég 401,
időtúllépés) a mért állapotban jobbak, mint a magyar piac átlaga: minden
hibaüzenet magyar, mezőhöz kötött, a fókusz az első hibás mezőre ugrik, és
minden zsákutcából van kiút. Ezt a szintet érdemes megőrizni.

A baj öt helyen van, és mind az öt a PÉNZ útjában áll:

1. **A süti-sáv letakarja a fizetős kurzus vásárlógombját, asztali gépen is.**
   Mérve, találat-teszttel: 1440×900-on a „Megveszem a kurzust" gomb 772 és 826 px
   között áll, a sáv 788-tól, a gomb KÖZEPE nem kattintható
   (`document.elementFromPoint` a `kc-consent-banner`-t adja vissza). 390×844-en
   ugyanez: gomb 644 és 694 között, sáv 660-tól. A ragadós vásárlósáv ilyenkor
   NEM segít, mert `data-visible="false"`: az `IntersectionObserver` szerint a
   gomb látszik, csak épp egy `position: fixed` réteg van fölötte. Ugyanez a
   `/kosar` „Menj a pénztárhoz" gombjára 390 px-en.
2. **A pénztárban a gomb közelében nincs ár és nincs „mit kapok érte".** Mérve:
   az ár (79 500 Ft) 208 px-nél (1440) és 143 px-nél (390), a „Megrendelem és
   fizetek" gomb 2309, illetve 2578 px-nél. A kettő között **2101, illetve 2435
   px**, azaz 2,3 és 2,9 képernyő. A visszavonhatatlan kattintás pillanatában a
   vevő nem látja, mennyit fizet és miért.
3. **A fizetős termékoldalon nulla bizonyíték van.** Élesben mérve: 1 darab kép
   (a csomagkép, 433 KB PNG), 0 videó, 0 vélemény, 0 GYIK. Az INGYENES kurzus
   oldalán ugyanakkor 3 vélemény és 4 GYIK van. A bizonyíték a rossz oldalon áll.
4. **Az élő főmenüben placeholder-felirat visz egy demó-oldalra.** Élesben minden
   oldalon szerepel a „olcsó dolgok itt" menüpont az `/akcios-kurzus` címre, ami
   egy `noindex` demó („Képzeletbeli akciós kurzus"), ár és vásárlási út nélkül.
5. **Az ingyenes SOS erősebb belső pozíciót kap, mint a fizetős program.** Mérve
   az élő oldalakon: a főmenü almenüjében ott az „Ingyenes SOS KézRelax", a
   fizetős program nincs a menüben; a belső linkek aránya SOS javára 4:1 a
   kezdőlapon, 4:2 és 3:3 a Tudástár-hubokon, 2:0 a `/blog`-on.

Emellett: a `/kosar` oldalra a felület egyetlen pontjáról sem lehet eljutni
(nulla belső link), a pénztár teljes fejlécet és lábléc-hírlevelet visel
(8 navigációs link + egy második űrlap), folyamatjelző sehol nincs, és a
látogatói szövegben 16 (fizetős), illetve 14 (SOS) töltelék gondolatjel maradt.

---

## 2. Mért táblázatok

### 2.1 Oldalhossz és reflow

| Útvonal                                   | 1440 px | 390 px |     320 px | Vízszintes túlcsordulás 320-on |
| ----------------------------------------- | ------: | -----: | ---------: | ------------------------------ |
| `/kurzusok`                               |    2026 |   2621 |       2704 | nincs (`scrollWidth` = 320)    |
| `/kurzusok/otthoni-kezrehab-program`      |    8571 | 10 771 |     12 268 | nincs                          |
| `/kurzusok/sos-kezrelax-villamkurzus`     |    6168 |   8357 |       9295 | nincs                          |
| `/akcios-kurzus`                          |    5195 |   5851 |       6519 | nincs                          |
| `/kosar?termek=1`                         |    1420 |   1900 |       2016 | nincs                          |
| `/penztar?termek=1`                       |    3101 |   3814 |       4227 | nincs                          |
| `/sikertelen?termek=1`                    |    1293 |   1829 | mérve, 320 | nincs                          |
| `/fizetes/koszonom` (rendelésszám nélkül) |    1108 |  mérve |      mérve | nincs                          |

WCAG 2.2 SC 1.4.10 (Reflow) mind a nyolc lapon teljesül,
<https://www.w3.org/WAI/WCAG22/Understanding/reflow.html>.

### 2.2 Tipográfia, kontraszt, érintőcél

| Mérés                                   | Eredmény                                                                                               | Küszöb, forrás                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Előforduló betűméretek                  | 1440: 16 / 19 / 40 px; 390 és 320: 14,1 / 16,2 / 32,5 px                                               | három token, teljesül (`termektervezes` 3.)                         |
| Legkisebb szövegkontraszt a teljes úton | 8,05:1 (garancia-szöveg), a pénztárban 8,8:1                                                           | ≥ 4,5:1, WCAG 1.4.3                                                 |
| Gombfelület a háttérhez                 | elsődleges 5,16:1, sötét 12,8:1                                                                        | ≥ 3:1, WCAG 1.4.11                                                  |
| Sorhossz, asztali törzs                 | 51 és 76 karakter között                                                                               | 45 és 85 között, teljesül                                           |
| Sorhossz, 390 px                        | 33 és 48 karakter között                                                                               | teljesül                                                            |
| 24 px alatti érintőcélok                | kizárólag soron belüli szöveglinkek (19 és 22 px magas), plusz a két elállási jelölőnégyzet (20×20 px) | WCAG 2.5.8, a szöveglink kivétel alá esik; a négyzeteknél lásd P3-2 |
| Kategória-csip a listán                 | 37 px magas                                                                                            | ≥ 24 px teljesül, a 44 px-es projekt-cél nem                        |

### 2.3 A pénztár űrlapja (mérve, `/penztar?termek=1`, vendégként)

|   # | Mező            | `type`   | `inputmode` | `autocomplete`           | Kötelező | Címke                       | Segédszöveg                                                       |
| --: | --------------- | -------- | ----------- | ------------------------ | -------- | --------------------------- | ----------------------------------------------------------------- |
|   1 | `guestEmail`    | email    | email       | `email`                  | igen     | E-mail-cím                  | nincs                                                             |
|   2 | `guestName`     | text     | nincs       | `name`                   | igen     | Neved                       | „Ez a fiókod neve, a számlázási név ettől eltérhet (pl. cégnév)." |
|   3 | `billingName`   | text     | nincs       | `billing name`           | igen     | Név                         | nincs                                                             |
|   4 | `billingZip`    | text     | **nincs**   | `billing postal-code`    | igen     | Irányítószám                | nincs                                                             |
|   5 | `billingCity`   | text     | nincs       | `billing address-level2` | igen     | Település                   | nincs                                                             |
|   6 | `billingStreet` | text     | nincs       | `billing address-line1`  | igen     | Cím                         | nincs                                                             |
|   7 | `taxNumber`     | text     | nincs       | `off`                    | nem      | Adószám (céges vásárlásnál) | „Csak céges vásárlás esetén."                                     |
|   8 | `waiverStart`   | checkbox |             |                          | igen     | azonnali hozzáférés kérése  | van                                                               |
|   9 | `waiverLoss`    | checkbox |             |                          | igen     | elállási jog elvesztése     | van                                                               |
|  10 | `consentTerms`  | checkbox |             |                          | igen     | ÁSZF + adatvédelem          | van                                                               |

Bejelentkezve az 1. és 2. mező kimarad, tehát 5 szövegmező és 3 jelölőnégyzet
marad. Placeholder egyik mezőn sincs (helyesen, NN/g Placeholders in Form Fields
Are Harmful, <https://www.nngroup.com/articles/form-design-placeholders/>).
Minden kötelező mező látható „*" jelet és rejtett „(kötelező)" szöveget kap
(WCAG 3.3.2 Labels or Instructions,
<https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html>).

**Ami a lap alján még van, de nem a vásárláshoz tartozik:** a lábléc hírlevél-
űrlapja egy kötelező e-mail-mezővel (`newsletterEmail`), egy mézes-bödön mezővel
és egy kötelező hozzájárulás-négyzettel, 2784 px-nél (1440).

### 2.4 A pénztár függőleges rendje (1440 px, mérve)

|   y (px) | Elem                                                                                                                 |
| -------: | -------------------------------------------------------------------------------------------------------------------- |
|        0 | fejléc, 72 px, 8 navigációs link (Szolgáltatások, almenü, Rólunk, Tudástár, Kapcsolat, Belépés, Kurzusok gomb, logó) |
|      160 | H1 „Pénztár" (40 px)                                                                                                 |
|  **208** | **összegző kártya: „Otthoni KézRehab Program 79 500 Ft"**                                                            |
|      339 | H2 „Elérhetőséged" (vendég-blokk)                                                                                    |
|      772 | H2 „Számlázási adatok"                                                                                               |
|     1329 | H2 „Elállási jog"                                                                                                    |
|     1808 | H2 „Szerződési feltételek"                                                                                           |
|     2011 | H2 „Biztonságos fizetés" (Barion logósor + magyarázat)                                                               |
| **2309** | **gomb: „Megrendelem és fizetek" (262×55)**                                                                          |
|     2372 | akadály-magyarázat („A fizetéshez pipáld ki mindkét nyilatkozatot…")                                                 |
|     2486 | lábléc: Kapcsolat óriáslink, hírlevél-űrlap, jogi linkek                                                             |

**Ár és gomb távolsága: 2101 px (1440), 2435 px (390).**

### 2.5 A két termékoldal tartalmi mérlege (élő HTML, 2026-09-07)

| Elem                                     | Fizetős (79 500 Ft)                    | Ingyenes SOS                                       |
| ---------------------------------------- | -------------------------------------- | -------------------------------------------------- |
| Tartalmi kép                             | **1** (csomagkép, 433 KB PNG, 640×444) | 1 (csomagkép, 439 KB PNG) + 1 cross-sell kártyakép |
| Videó vagy előzetes                      | **0**                                  | **0**                                              |
| Vélemény                                 | **0**                                  | 3                                                  |
| GYIK                                     | **0**                                  | 4 (és FAQPage strukturált adat)                    |
| Garancia                                 | 30 napos kipróbálási garancia          | 100% boldogság garancia                            |
| Tananyag-lista                           | 4 modul (élesben)                      | 1 modul                                            |
| „Kinek való / kinek nem"                 | 9 + 6 tétel                            | nincs                                              |
| Kapcsolódó kurzus sáv                    | **nincs**                              | van, cross-sell keretezéssel                       |
| Töltelék gondolatjel a látható szövegben | **16**                                 | **14**                                             |
| Ugrás-csipek                             | 5                                      | 4                                                  |
| `gallery` mezőben ki nem tett kép        | 2                                      | 1                                                  |

A `gallery` mező adatbázisban létezik és fel is van töltve (fizetős: egy
gyakorlat-fotó és egy alapítói fotó; SOS: a letölthető „puska" képe), de
egyetlen komponens sem rendereli. Ezek MA meglévő, felhasznált nélküli
bizonyítékok.

### 2.6 SEO-réteg (élő HTML)

| Oldal            | `title` (hossz)                                | `meta description` (hossz)       | Strukturált adat                                                                                                                                                                    |
| ---------------- | ---------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/kurzusok`      | „Kurzusok \| Kineticare" (21)                  | 173 karakter                     | `CollectionPage`, **`ItemList` nélkül**                                                                                                                                             |
| fizetős kurzus   | „Otthoni KézRehab Program \| Kineticare" (37)  | 196 karakter                     | `["Course","Product"]` + `Offer` (79500 HUF, InStock) + `BreadcrumbList`; **nincs FAQPage, nincs review/aggregateRating, nincs `priceValidUntil`, nincs `hasMerchantReturnPolicy`** |
| SOS kurzus       | „SOS Kézrelax villámkurzus \| Kineticare" (38) | 152 karakter, **gondolatjellel** | `["Course","Product"]` **`offers` NÉLKÜL** + `BreadcrumbList` + `FAQPage` (4 kérdés)                                                                                                |
| `/akcios-kurzus` | „Képzeletbeli akciós kurzus \| Kineticare"     | 137 karakter                     | nincs JSON-LD; `robots: noindex, follow`                                                                                                                                            |

`meta keywords`: a `/kurzusok` és a fizetős kurzus **ugyanazt a három
kifejezést** viszi (otthoni gyógytorna, kéztorna, kéztorna gyakorlatok,
Search-lock 2026-08-24, `src/lib/tudastar/seo-kulcsszavak.ts`). A SOS
szándékosan üres.

`robots.txt` (élő): a `/kosar`, `/penztar`, `/fizetes/`, `/sikertelen` tiltva
minden robotra és a 14 engedélyezett AI-ügynökre is; a `/kurzusok/` engedve.
`sitemap.xml`: 22 cím, benne mindkét kurzus, a demó-landing helyesen kimarad.
Ez a réteg rendben van.

### 2.7 Belső linkelés a két termék felé (élő HTML, számolt darab)

| Forrásoldal              | → fizetős program | → ingyenes SOS | → `/kurzusok` |
| ------------------------ | ----------------: | -------------: | ------------: |
| kezdőlap                 |                 1 |          **4** |             4 |
| `/keztoalagut-szindroma` |                 2 |          **4** |             1 |
| `/inhuvelygyulladas`     |                 3 |              3 |             1 |
| `/teniszkonyok`          |                 2 |          **4** |             1 |
| `/kez-zsibbadas`         |                 2 |          **4** |             1 |
| `/blog`                  |             **0** |              2 |             1 |
| `/szolgaltatasok`        |                 1 |              2 |             2 |

A SOS-többlet forrása részben a FŐMENÜ: a „Szolgáltatások" almenüjében állandó
menüpont az „Ingyenes SOS KézRelax", a fizetős programnak nincs menüpontja.

---

## 3. Találatok rangsorolva

Jelölés: **P1** blokkoló (a vásárlás sérül), **P2** fontos, **P3** finomítás.
Méret: S (egy fájl vagy egy CMS-mező), M (több fájl vagy tulajdonosi döntés),
L (szerkezeti).

### P1: blokkoló

**P1-1. A süti-sáv letakarja a vásárlógombot a fizetős termékoldalon, asztali
gépen és mobilon is, és a ragadós sáv sem lép be helyette.**

Mérve, találat-teszttel (`document.elementFromPoint` a gomb középpontjában):

| Szélesség | Gomb doboza          | Süti-sáv          | A gomb közepén ez van | Ragadós sáv                        |
| --------- | -------------------- | ----------------- | --------------------- | ---------------------------------- |
| 1440×900  | 772 és 826 px között | 788 és 900 között | `kc-consent-banner`   | `data-visible="false"`, 0 px magas |
| 390×844   | 644 és 694 px között | 660 és 844 között | `kc-consent-banner`   | `data-visible="false"`, 0 px magas |

Ugyanez a `/kosar` „Menj a pénztárhoz" gombjára 390 px-en (720 és 770 között,
sáv 660-tól, a közép nem kattintható), és az SOS igénylő űrlapjának mindkét
mezőjére (665 és 715, illetve 763 és 813 px között).
Képernyőkép: `audit-c/fold-fizetos-1440.png` (a gomb kék csíkja a sáv fölött,
a felirat nem is olvasható), `audit-c/fold-fizetos-390.png`.

**A mechanizmus, ami miatt a ragadós sáv nem ment meg.** A `CourseBuyBar` egy
`IntersectionObserver`-rel figyeli a gombot, és akkor jelenik meg, ha a gomb
láthatósági aránya 0,99 alá esik. Az `IntersectionObserver` viszont a
GÖRGETÉSI viszonyt méri, nem azt, hogy egy `position: fixed` réteg takarja-e:
a gomb „teljesen látszik", miközben a felhasználó nem éri el. A komponens saját
fejkommentje pontosan ezt a hibaosztályt írja le (a doboz belső görgetése miatt
levágott gomb), csak most a süti-sáv okozza.

Forrás: WCAG 2.2 SC 2.4.11 Focus Not Obscured (Minimum),
<https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html>;
GOV.UK Design System, Cookie banner (a sáv a lap TETEJÉN, a tartalom folyamában
áll, nem lebeg fölötte),
<https://design-system.service.gov.uk/components/cookie-banner/>;
Baymard checkout- és termékoldal-kutatás (az elsődleges cselekvés akadálytalan
elérhetősége az első képernyőn),
<https://baymard.com/research/checkout-usability>.

Javaslat, a legolcsóbbtól: (a) a süti-sáv mobilon és asztali gépen is a
folyamban, a fejléc alatt (GOV.UK-minta), vagy (b) ha marad lebegő, a
`document.documentElement` kapjon `kc-has-consent` jelölést, amíg a sáv él, és
ebben az állapotban a `CourseBuyBar` FELTÉTEL NÉLKÜL látszódjon (a ragadós sáv
a sáv fölé rendeződik, ezt mértem: `audit-c/buybar-390.png`), vagy (c) a
`CourseBuyBar` az `IntersectionObserver` mellett `elementFromPoint`-tal is
ellenőrizze a gomb közepét. A `b` a legkisebb kockázat, mert a meglévő,
működő komponenst kapcsolja be.
Méret: S (b) / M (a). Várható hatás: a `course_viewed → checkout_started`
átmenet első látogatáson egyáltalán lehetségessé válik.

**P1-2. A pénztárban a fizetőgomb mellett nincs sem ár, sem tétel.**

Mérve: az összegző kártya („Otthoni KézRehab Program 79 500 Ft") 208 px-nél
(1440) és 143 px-nél (390); a „Megrendelem és fizetek" gomb 2309, illetve
2578 px-nél. A gomb fölött a Barion-kártya áll, alatta az akadály-magyarázat.
A gomb és az ár között **2101, illetve 2435 px**. A lapon egyetlen szó sem
mondja meg a gomb közelében, mit vesz meg a vevő (a „50+ videós gyakorlat",
a modulszám, a hozzáférés hossza és a 30 napos garancia mind a termékoldalon
maradt).

Forrás: Baymard checkout-kutatás (a rendelés összegzésének a fizetési lépésben,
a végleges gomb mellett kell állnia; a hiányzó összegzés a kosárelhagyás egyik
visszatérő oka), <https://baymard.com/research/checkout-usability> és
<https://baymard.com/lists/cart-abandonment-rate>; NN/g #1 A rendszer
állapotának láthatósága, <https://www.nngroup.com/articles/ten-usability-heuristics/>;
GOV.UK „Check your answers" minta (a visszavonhatatlan lépés előtt a döntés
összefoglalója),
<https://design-system.service.gov.uk/patterns/check-answers/>.

Javaslat: a `BarionFizetesJelzes` és a gomb közé egy tömör összegző kártya:
a kurzus neve, az ár, „egyszeri díj, további költség nincs", a garancia egy
sora és a hozzáférés hossza. Ugyanaz a négy adat, ami a vásárlódobozban már
létezik (`sales.highlights`, `guaranteeLabel`, `PriceTag`), tehát új szöveget
kitalálni nem kell.
Méret: S. Várható hatás: a `checkout_started → purchase_confirmed` arány javul,
és a `checkout_failed` „blocked" kategóriája csökken, mert a vevő nem görget
vissza ellenőrizni.

**P1-3. A fizetős kurzusoldalon nincs bizonyíték, az ingyenesen van.**

Mérve az élő HTML-en: a fizetős oldal 1 tartalmi képet, 0 videót, 0 véleményt és
0 GYIK-et tartalmaz. Az ingyenes oldal 3 véleményt és 4 GYIK-et. A `previewVideoStreamId`
mindkét terméken üres, tehát a `PreviewVideo` komponens és az „Ingyenes előzetes"
felirat sosem jelenik meg, pedig a termék maga VIDEÓS program („50+ videós
gyakorlat"). A `gallery` mezőben két fel nem használt kép vár (gyakorlat-fotó,
alapítói fotó).

Ez a mért forgalmi helyzetben súlyosabb a szokásosnál: a `docs/ADATOK-mert.md`
és a 2026-09-07-i Monid-mérés szerint a domain 15 organikus kulcsszóra
rangsorol, mind a 17 és 83. pozíció között, 0,00% forgalommal, és egyetlen fő
kifejezésre sem. A termékoldalra tehát nem keresésből, hanem Tudástárból,
közösségi felületről vagy hirdetésből érkeznek, kontextus nélkül: az oldalnak
magának kell meggyőznie.

Forrás: Baymard termékoldal-kutatás (több szögből készült kép, videó és
vélemények a legfontosabb döntéstámogató elemek),
<https://baymard.com/research/ecommerce-product-pages>; Semrush ecommerce-modul
11.1 („Konverziós termékoldalak: egyértelmű cím, több szögből képek,
előny-vezérelt leírás, vélemények, GYIK"),
<https://www.semrush.com/blog/ecommerce-marketing/>; NN/g Trustworthiness in Web
Design, <https://www.nngroup.com/articles/trustworthiness-in-web-design/>.

Javaslat: (a) a `faq` mezőbe legalább 6 valódi kérdés a fizetős programra
(a legolcsóbb lépés, és azonnal FAQPage strukturált adatot is ad, lásd P2-7);
(b) 3 vélemény a fizetős programról (a régi kineticare.hu és a rendelői
gyakorlat anyagából, tulajdonosi jóváhagyással); (c) a `gallery` két képének
megjelenítése a csomagkép alatt; (d) 60 és 90 másodperc közötti előzetes a
Bunny Streamből a `previewVideoStreamId` mezőbe.
Méret: (a) és (c) S, (b) és (d) M, tulajdonosi tartalommal.

**P1-4. Az élő főmenüben placeholder-felirat mutat egy demó-oldalra.**

Mérve: az élő alkalmazás MINDEN letöltött oldalán (kezdőlap, `/szolgaltatasok`,
mindkét kurzusoldal, `/kosar`) háromszor szerepel a „olcsó dolgok itt" felirat,
a „Szolgáltatások" almenüben, `/akcios-kurzus` célra. A cél oldal H1-e
„Képzeletbeli akciós kurzus", a hero fölött „Demókurzus, jelenleg nem
vásárolható." sáv áll, tartalma megfigyelési jegyzetelésről szól, ár és
vásárlási út nincs rajta, `robots: noindex, follow`. A helyi CMS-ben ez a
menüpont NEM létezik, tehát az élő adatbázisban, kézzel keletkezett.

Forrás: NN/g #2 A rendszer és a valós világ egyezése és #4 Következetesség,
<https://www.nngroup.com/articles/ten-usability-heuristics/>; NN/g
Trustworthiness in Web Design (a felület minden pontatlansága a hitelt viszi),
<https://www.nngroup.com/articles/trustworthiness-in-web-design/>; WCAG 2.2 SC
2.4.4 Link Purpose (In Context),
<https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html>.

Javaslat: a menüpont törlése az éles adminban (Menük gyűjtemény). Ha az
`/akcios-kurzus` kampány-landingként kell, akkor valódi terméket, árat és
vásárlógombot kapjon, és a menüfelirat legyen igaz. **Tulajdonosi döntés,
azonnali.** Méret: S (törlés) / L (valódi kampány-landing).

**P1-5. A `/kosar` oldalra egyetlen belső link sem vezet.**

Mérve: a `src` fában a `/kosar` cím kizárólag a `robots.ts` tiltólistájában, a
`CartView` kommentjeiben és magában a lapban szerepel; az élő oldalak HTML-jében
nulla `href="/kosar…"` található. A vásárlás útja a termékoldalról közvetlenül
`/penztar?termek=<id>`. A `/kosar` mégis teljes funkcióval él: localStorage-os
kosár, tételtörlés, végösszeg, „Menj a pénztárhoz", „már megvetted" ág.

Ez önmagában nem hiba (egytételes digitális terméknél az egylépéses checkout a
helyes minta, Baymard), de jelenleg egy karbantartott, tesztelt, de elérhetetlen
felület, amelynek a hibái (P1-1 mobil takarás, P2-6 szerver-szöveg) senkinek nem
tűnnek fel, és amelyre a `/sikertelen`, a `ThankYouView` és a `/penztar` üres
ága sem visz.

Forrás: Baymard cart and checkout (az egytételes, digitális vásárlásnál a kosár
lépés kihagyható, de akkor ne is legyen félkész felület),
<https://baymard.com/research/checkout-usability>; NN/g #8 Esztétika és
minimalista tervezés, <https://www.nngroup.com/articles/ten-usability-heuristics/>.

Javaslat, tulajdonosi döntés: (a) a `/kosar` kivezetése (a lap 308-cal a
`/penztar?termek=` címre irányít, a `CartView` és a `cart.ts` marad
tesztfedezettel), vagy (b) bekötése (kosár-ikon a fejlécben tétel-számmal, a
termékoldali gomb a kosárba tesz). Az (a) az olcsóbb és a mért helyzetben
(kettő termék, egytételes vásárlás) a helyesebb. Méret: S (a) / L (b).

### P2: fontos

**P2-1. A pénztár teljes webhely-fejlécet és lábléc-hírlevelet visel.**

Mérve a `/penztar?termek=1` lapon: 72 px-es fejléc 8 kattintható elemmel (logó,
Szolgáltatások, almenü-nyitó, Rólunk, Tudástár, Kapcsolat, Belépés, „Kurzusok"
gomb), a lap alján a lábléc óriás „Kapcsolat" linkkel, hírlevél-űrlappal (egy
kötelező e-mail-mező és egy kötelező hozzájárulás-négyzet 2784 és 2857 px-nél)
és jogi linkekkel. Ugyanez a `/kosar`-on.

Forrás: Baymard checkout-kutatás (a checkout során a fő navigáció eltávolítása
vagy leredukálása, hogy a folyamatból ne legyen kilépés),
<https://baymard.com/research/checkout-usability>; GOV.UK „One thing per page"
(a folyamatlapokról minden nem odatartozó cselekvés lekerül),
<https://design-system.service.gov.uk/patterns/question-pages/>; NN/g #8.
Javaslat: a `/penztar` (és megtartás esetén a `/kosar`) redukált fejlécet kapjon
(logó, ami a kurzusoldalra visz vissza, plusz a „Biztonságos fizetés" jelzés) és
redukált láblécet (ÁSZF, Adatvédelem, Impresszum, Kapcsolat), hírlevél-űrlap
nélkül. Méret: M (a `(frontend)/layout.tsx` útvonalfüggő változata vagy külön
`penztar/layout.tsx`).

**P2-2. Nincs folyamatjelző, és nincs visszaút a termékhez a pénztárból.**

Mérve: sem a `/kosar`, sem a `/penztar` nem jelzi, hányadik lépésnél tart a vevő,
és a pénztári összegzőben a kurzus neve NEM link (a `kc-checkout-summary` csak
szöveg és `PriceTag`). Ha a vevő ellenőrizni akarja, mit vesz, a böngésző vissza
gombján kívül nincs útja.

Forrás: Baymard checkout-kutatás (folyamatjelző a lépések számával és a jelenlegi
állással, valamint a tételre visszavezető link az összegzőből),
<https://baymard.com/research/checkout-usability>; NN/g Progress Indicators,
<https://www.nngroup.com/articles/progress-indicators/>; WCAG 2.2 SC 2.4.8
Location (AAA szintű, de itt a folyamat érthetőségének feltétele),
<https://www.w3.org/WAI/WCAG22/Understanding/location.html>.
Javaslat: a H1 alatt egy egyszerű, két lépéses jelölés („1. Adatok, 2. Fizetés a
Barionon") vagy morzsamenü („Kurzusok / Otthoni KézRehab Program / Pénztár"), és
az összegzőben a kurzus neve legyen link a termékoldalra. Méret: S.

**P2-3. A vendég kétszer írja be a nevét.**

Mérve: `guestName` (a fiók neve) a 608 px-nél, `billingName` (a számlázási név)
a 899 px-nél, mindkettő kötelező, előkitöltés nélkül. A segédszöveg megmagyarázza,
miért két mező, de a vevő szemszögéből ez ugyanaz az adat kétszer. Vendégként így
7 szövegmező és 3 jelölőnégyzet, azaz 10 űrlapelem áll egy szállítás nélküli,
digitális terméknél.

Forrás: Baymard checkout-kutatás (a mezők számának csökkentése és a duplikált
adatbekérés elkerülése; a tipikus checkout 11,8 mezős, a valós igény jóval
kevesebb), <https://baymard.com/research/checkout-usability>; GOV.UK Addresses
minta (csak azt kérdezd, amire tényleg szükség van),
<https://design-system.service.gov.uk/patterns/addresses/>; NN/g #8.
Javaslat: a `billingName` alapból tükrözze a `guestName` értékét (élő
előkitöltés gépelés közben, felülírható), vagy egy „A számlázási név megegyezik"
jelölőnégyzet alapból bepipálva. A számlázási cím marad, mert a számlához
jogszabály szerint kell.
Méret: S. Várható hatás: egy kötelező mezővel kevesebb a legdrágább lépésben.

**P2-4. Az adószám-mező minden vásárlónak látszik.**

Mérve: a `taxNumber` mező mindig renderelődik, „Adószám (céges vásárlásnál)"
címkével és „Csak céges vásárlás esetén." segédszöveggel, 622×55 px-en, a
számlázási blokk utolsó elemeként. A magánszemély vásárlók (a vevőkör túlnyomó
része) számára ez egy mező, amiről el kell dönteni, hogy kihagyható-e.

Forrás: Baymard checkout-kutatás (a céges és a magánszemély út szétválasztása
kapcsolóval, hogy az irreleváns mezők ne is látszódjanak),
<https://baymard.com/research/checkout-usability>; GOV.UK Question pages
(a feltételes mező csak akkor jelenjen meg, ha releváns),
<https://design-system.service.gov.uk/patterns/question-pages/>.
Javaslat: „Céges számlát kérek" jelölőnégyzet, ami megnyitja az adószám-mezőt
(a validáció változatlan marad). Méret: S.

**P2-5. A látogatói szövegben 16, illetve 14 töltelék gondolatjel maradt,
és a checkout hibaüzeneteiben is öt.**

Mérve, a renderelt `innerText`-ben: fizetős kurzusoldal 16 darab U+2013,
SOS-oldal 14 darab; a `/kurzusok`, a `/kosar`, a `/penztar`, a `/sikertelen` és
az `/akcios-kurzus` tiszta (0 darab). Tipikus előfordulások: „akár napi néhány
percben – kézrehabilitációs gyógytornászok állították össze", „50+ videós
gyakorlat – rövid, lépésről lépésre…", „01 – Kinesio szalag minikurzus (értéke
29 900 Ft – most ajándék)", „– P. Benjámin, informatikus". Ezen felül a kódban
öt látogatói hibaüzenet visel U+2014 kvirtmínuszt:
`src/lib/checkout/guest.ts` 85. és 94. sor, `src/lib/checkout/billing.ts` 134., 140. és 142. sor. A SOS meta-leírásába is átmegy a jel, mert a
`rewriteVisitorDashLeftover` csak a fizetős kurzus rövid leírását javítja.

Forrás: a tulajdonos 2026-08-16-i kikötése (natív magyar, gondolatjel-halmozás
tilos), `docs/ui-sztenderdek.md` §3.1.3 és az AkH. 12. kiadás 250 és 251. pontja
(<https://helyesiras.mta.hu/helyesiras/default/akh12#F250>); a
`termektervezes` skill 2. és 7. pontja.
Javaslat: a termékoldali szövegek a CMS-ben javítandók (a gondolatjel helyén
vessző, kettőspont vagy zárójel), a vélemények attribúciója „P. Benjámin,
informatikus" alakban, gondolatjel nélkül; az öt hibaüzenet a kódban javítandó,
és a SOS rövid leírása vagy a CMS-ben, vagy a `gondolatjel-leftover.ts`
listájában. Méret: S mindegyik, de a termékoldali javítás tulajdonosi
szövegjóváhagyással.

**P2-6. A kosárban szerver-belső mondat áll a végösszeg alatt.**

Mérve, `/kosar` látható szöveg: „Végösszeg: 79 500 Ft" alatt „A fizetendő
végösszeget a rendszer a fizetéskor, a szerveren újraszámolja." Ez a mondat a
vevőnek azt üzeni, hogy a kiírt ár nem végleges.

Forrás: NN/g Error Message and Trust (a felület ne közöljön belső működést a
vevővel, ha az kétséget kelt),
<https://www.nngroup.com/articles/trustworthiness-in-web-design/>; Baymard
checkout-kutatás (a végösszeg legyen végleges és kétségtelen),
<https://baymard.com/research/checkout-usability>.
Javaslat: a mondat helyett „Az ár egyszeri díj, további költség nincs." (ez a
szöveg a vásárlódobozban már létezik és igaz). A szerveroldali újraszámolás
marad, csak nem a vevőnek szól. Méret: S.

**P2-7. A fizetős kurzusnak nincs FAQPage strukturált adata, az ingyenesnek van.**

Mérve: a SOS-oldal négy kérdéses `FAQPage` JSON-LD-t ad ki, a fizetős oldal
egyet sem, mert a `faq` mező üres és a leírásban sincs GYIK-szakasz (a
`sales-content.ts` a címsor-mintákból dolgozna). A `Course` és `Product` együttes
entitásból hiányzik a `priceValidUntil`, a `hasMerchantReturnPolicy` és bármilyen
értékelés, a SOS-nál pedig teljesen hiányzik az `offers` blokk, tehát a gépi
olvasó nem tudja, hogy az ingyenes.

Forrás: Google, Product structured data (ajánlott `priceValidUntil`,
`hasMerchantReturnPolicy`, `review`/`aggregateRating`),
<https://developers.google.com/search/docs/appearance/structured-data/product>;
Google, Course info,
<https://developers.google.com/search/docs/appearance/structured-data/course-info>;
Google, FAQPage,
<https://developers.google.com/search/docs/appearance/structured-data/faqpage>.
Javaslat: (a) a fizetős kurzus `faq` mezőjének feltöltése (a látható harmonika és
a JSON-LD ugyanabból épül, tehát egy művelet); (b) a `courseJsonLd` az ingyenes
ágon is adjon `offers`-t `price: 0`-val; (c) `hasMerchantReturnPolicy` a 30 napos
garanciából (ez tényadat, nem kitalálás). Az `aggregateRating` csak akkor, ha
valódi, gyűjtött értékelés van mögötte.
Méret: (a) S CMS, (b) és (c) S kód.

**P2-8. A kurzuslista fele nem létező kínálatot ígér, és a szűrő nem szűr.**

Mérve a `/kurzusok` lapon: a bevezető „Válogass az otthoni gyakorlóprogramok és a
**szakmai továbbképzések** között", a rács alatti második bevezető „Online
kézrehabilitációs kurzusok otthon **és szakembereknek**, egy kínálatban" ,
miközben mindkét termék „Otthoni gyakorlóknak" címkét visel, és a listán
összesen két kurzus van. A kategória-szűrő két csipet mutat („Összes",
„Kézrehabilitációs kurzusok"), amelyek ugyanazt a két terméket adják. A lapon
ráadásul három cím szól ugyanarról a rácsról: H1 „Kurzusok", H2 „A kezed,
lépésről lépésre.", és a 210 px magas „Kurzusaink" vízjel.

Forrás: NN/g Trustworthiness in Web Design (a nem teljesülő ígéret a hitelt
viszi), <https://www.nngroup.com/articles/trustworthiness-in-web-design/>;
Baymard listaoldal-kutatás (ne kínálj szűrőt, ami nem szűkít; a listaelem a
döntéshez szükséges adatokat mutassa),
<https://baymard.com/research/homepage-and-category-navigation>; NN/g #8.
Javaslat: a két bevezetőből egy marad, a valós kínálatra igazítva („Két online
kézrehabilitációs kurzus otthonra: egy ingyenes villámkurzus és a teljes
program."); a kategória-csipek csak akkor jelenjenek meg, ha legalább két
kategória van (a `collectCourseCategories` már ad listát, csak a küszöb hiányzik);
a vízjel szava vagy a H2 megy. Méret: S.

**P2-9. A termékoldal egyetlen képe 433 KB PNG, és ez az LCP elem.**

Mérve: az élő `…Programpackshot-640x444.png` 433 029 bájt, az
`…belepotermekpackshot1-640x521.png` 438 611 bájt, mindkettő `image/png`,
640 px szélesen, `<img>`-ben (nem `next/image`), és a helyi mérésben ez az
LCP-jelölt (980 ms, illetve 1184 ms a dev-szerveren). A CMS-ben az eredeti
fájl WebP, 1080 px szélesen, 72 KB, illetve 82 KB, azaz a KISEBB felbontású
kiszolgált változat ötszörös súlyú. Ráadásul a `.kc-course-media__image`
`aspect-ratio: 16/10` és `object-fit: cover`, ami a 640×444-es csomagképből
kb. 10%-ot, a 640×521-esből kb. 23%-ot levág fent és lent.

Forrás: web.dev, Optimize LCP, <https://web.dev/articles/optimize-lcp>;
web.dev, Serve responsive images,
<https://web.dev/articles/serve-responsive-images>; Baymard termékoldal-kutatás
(a termékkép ne legyen levágva úgy, hogy a lényeg kimarad),
<https://baymard.com/research/ecommerce-product-pages>.
Javaslat: a `640x444` méretvariáns WebP-ként generálódjon (a média-pipeline
beállítása), a `<img>` kapjon `sizes` és `srcset` értéket vagy `next/image`-et,
és a `cover` helyett `contain` a csomagképnél (a doboz háttere már tint, tehát a
levágás helyett letterbox marad). Méret: S (CSS) / M (média-variáns).

**P2-10. A garancia eltűnik pont ott, ahol a kockázat érződik.**

Mérve: a fizetős termékoldalon a „30 napos kipróbálási garancia" kétszer is
szerepel (vásárlódoboz bizalmi sora 1125 px-nél, saját szekció 7439 px-nél), a
`/kosar` és a `/penztar` látható szövegében viszont egyszer sem. A pénztárban a
vevő ehelyett két nyilatkozatot pipál ki arról, hogy ELVESZÍTI a 14 napos
elállási jogát. Jogilag ez rendben van (a 30 napos garancia önkéntes kereskedelmi
vállalás a törvényes jog fölött), a vevő szemszögéből viszont pontosan a döntés
pillanatában kap kockázat-üzenetet, kockázat-oldás nélkül.

Forrás: Baymard checkout-kutatás (a visszaküldési és garancia-politika
megjelenítése a checkout fizetési lépésében),
<https://baymard.com/research/checkout-usability>; NN/g Trustworthiness in Web
Design, <https://www.nngroup.com/articles/trustworthiness-in-web-design/>;
Semrush CRO-modul 8.4 (árazási és fizetési oldal fókusza: egyszerűség és bizalmi
elem), <https://www.semrush.com/blog/conversion-rate-optimization/>.
Javaslat: a P1-2 összegző kártyájában szerepeljen a garancia egy sora, a
`guaranteeLabel` mezőből (tehát nem új szöveg). Méret: S.

**P2-11. A pénztári Barion-szövegből hiányzik az MNB-engedélyszám, a
kezdőlapiból nem.**

Mérve: a kezdőlapi változat kimondja, hogy a Barion Payment Zrt. az MNB
felügyelete alatt áll, engedélyszáma H-EN-I-1064/2013; a pénztári változat csak
azt írja le, mi történik a kattintás után. A legerősebb, ellenőrizhető bizalmi
adat így nem ott van, ahol a fizetési döntés születik.

Forrás: Baymard checkout-kutatás (a biztonsági és felügyeleti jelzések a
fizetési mező köré tartoznak), <https://baymard.com/research/checkout-usability>;
NN/g Trustworthiness in Web Design (az ellenőrizhető, konkrét adat működik,
a general „biztonságos" nem),
<https://www.nngroup.com/articles/trustworthiness-in-web-design/>.
Javaslat: a `BARION_PENZTAR_SZOVEG` végére az engedélyszámot tartalmazó mondat,
szó szerint a kezdőlapi változatból (a forrás ugyanaz az ÁSZF-szöveg, tehát nem
keletkezik új állítás). Méret: S.

**P2-12. Az ingyenes SOS erősebb belső pozíciója kannibalizálja a fizetős
programot.**

Mérve: a főmenü „Szolgáltatások" almenüjében állandó menüpont az „Ingyenes SOS
KézRelax", a fizetős programnak nincs menüpontja. A belső linkek aránya a SOS
javára 4:1 a kezdőlapon, 4:2 három Tudástár-hubon, 2:0 a `/blog`-on. Az SOS-oldal
ugyanakkor helyesen visz tovább a fizetősre („Mi jön az ingyenes kurzus után?"),
a fizetős oldalon viszont NINCS kapcsolódó sáv, tehát az út egyirányú, és a több
link a rövidebb, ingyenes ágra mutat.

Ez a `docs/ertekesitesi-ux-skill.md` M4 szabálya (az ingyenes a fizetős UTÁN,
vizuálisan másodlagos súllyal) és K2 tilalma. Forrás mellé: Semrush ecommerce
11.2 (a vásárlási szándék szerinti oldalstruktúra: az összehasonlító és a belépő
tartalom ne versenyezzen a tranzakciós oldallal),
<https://www.semrush.com/blog/ecommerce-marketing/>; Semrush kulcsszó-kannibalizáció,
<https://www.semrush.com/blog/keyword-cannibalization/>.
Javaslat: a menüben az „Ingyenes SOS KézRelax" mellé (vagy helyette) kerüljön be
az „Otthoni KézRehab Program", vagy a menüpont mutasson a `/kurzusok` listára,
ahol mindkettő látszik az árával. A Tudástár-hubokban a fizetős link legyen
legalább annyi, mint az ingyenes.
**Tulajdonosi döntés**, mert a tölcsér-stratégiát érinti. Méret: S (menü) / M (hubok).

**P2-13. A `/kurzusok` lista és a fizetős termékoldal ugyanarra a három
kifejezésre céloz.**

Mérve: mindkettő a `KURZUSLISTA_KULCSSZAVAK` hármasát viszi (otthoni gyógytorna,
kéztorna, kéztorna gyakorlatok). A lista `title`-je „Kurzusok | Kineticare"
(21 karakter), tehát a kereső által megjelenített cím fele kihasználatlan, és
egyetlen kifejezést sem tartalmaz; a leírása 173 karakter, azaz a szokásos
kivonat-hossz fölött. A fizetős kurzus leírása 196 karakter.

Forrás: Semrush kulcsszó-kannibalizáció (két saját oldal ne célozza ugyanazt),
<https://www.semrush.com/blog/keyword-cannibalization/>; Google, Title link
(a cím legyen leíró és egyedi),
<https://developers.google.com/search/docs/appearance/title-link>; Google,
Snippet és meta description,
<https://developers.google.com/search/docs/appearance/snippet>.
Javaslat: a lista kapja a szélesebb, kategória-jellegű kifejezést és egy
leíróbb címet („Online kézrehabilitációs kurzusok | Kineticare"), a termékoldal
a szűkebb, tranzakciós alakot. **Nyitott kérdés:** a mért adatréteg nem
tartalmaz volument sem a „kéztorna gyakorlatok", sem az „otthoni gyógytorna"
kifejezésre, tehát a szétosztást csak új Monid-kör után szabad számokkal
alátámasztani. Méret: S (szöveg) után M (mérés).

### P3: finomítás

**P3-1. Az irányítószám-mezőnek nincs `inputmode`-ja.** Mérve: `type="text"`,
`inputmode` nélkül. A kód indoklása (külföldi irányítószámok, például `SW1A 1AA`)
védhető, de a vevőkör és a számlázási lánc magyar. Forrás: MDN, `inputmode`
(<https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inputmode>);
Baymard checkout-kutatás (számjegyes mezőnél számbillentyűzet).
Javaslat: **tulajdonosi döntés** az `inputmode="numeric"` bevezetéséről; ha
marad a mai állapot, a mező kapjon segédszöveget („Magyar cím esetén négyjegyű
szám"). Méret: S.

**P3-2. A két elállási jelölőnégyzet 20×20 px, a harmadik 24×24.** Mérve
1440 px-en és 390 px-en is. A címke kattintható és 590×63 px (1440), illetve
260×81 és 260×108 px (390), tehát a tényleges érintőcél nagyobb, és a WCAG 2.2
SC 2.5.8 teljesül (<https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html>).
A három azonos szerepű vezérlő eltérő mérete viszont következetlen (WCAG 3.2.4
szellemében, és `docs/ui-sztenderdek.md` 1.4/Ü3 szerint a projekt-cél 44 px).
Javaslat: mindhárom négyzet 24×24 px, a doboz körül 44 px-es érintési terület.
Méret: S.

**P3-3. A H1 és minden H2 azonos, 40 px-es méretet visel a termékoldalon.**
Mérve: H1 „Otthoni KézRehab Program" 39,9995 px, és mind a nyolc H2 ugyanennyi.
A három betűtoken miatt új méret nem vezethető be
(`termektervezes` 3. és 7.), a szintkülönbség tehát súlyból, térközből és
színből kell hogy jöjjön. Forrás: NN/g Visual Hierarchy,
<https://www.nngroup.com/articles/visual-hierarchy-ux-definition/>; GOV.UK
Headings, <https://design-system.service.gov.uk/styles/typography/>.
Javaslat: a szekció-H2-k a meglévő `kc-eyebrow` felvezető-nyelvét kapják
(verzál, betűköz, akcent-szín, M-token), a 40 px marad a H1-nek. Méret: S.

**P3-4. A GYIK címsora darabszámot visel.** Mérve: „Gyakori kérdések (4)" az
SOS-oldalon. A szám nem segít a döntésben, viszont a képernyőolvasós vázlatban és
a keresőkivonatban is megjelenik. Forrás: WCAG 2.2 SC 2.4.6 Headings and Labels,
<https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html>; NN/g #8.
Javaslat: a `kc-course-section__count` elhagyása vagy `aria-hidden` mellett
vizuális jelzésként. Méret: S.

**P3-5. A köszönőoldal címe és H1-e két különböző dolgot mond.** Mérve:
`<title>` „A fizetésed állapota", a poll alatti H1 „Köszönjük, feldolgozzuk a
fizetésedet". A cím szándékosan semleges (a Barion sikeres és sikertelen
fizetést is ide küld), a H1 viszont már köszön. Ez nem hiba (a poll csak akkor
fut, ha van rendelésszám), de a `failed` ágra váltás után a fül címe és a lap
állítása egy pillanatra ellentmond. Forrás: WCAG 2.2 SC 2.4.2 Page Titled,
<https://www.w3.org/WAI/WCAG22/Understanding/page-titled.html>.
Javaslat: a poll-állapot H1-e legyen „A fizetésed feldolgozása folyamatban",
azonos az időtúllépés ágéval. Méret: S.

**P3-6. Az `/akcios-kurzus` hero-képének nincs alt-szövege, és 117 KB-os
1920 px-es változatot tölt egy 1440×702-es dobozba.** Mérve: `alt=""` (dekoratív,
ez rendben van, ha tényleg az), `next/image` `w=1920&q=75`, 117 291 bájt, LCP-jelölt.
A lap `noindex`, tehát a tétel csak akkor számít, ha a landing valódi lesz (P1-4).
Méret: S.

**P3-7. A kosárban a „Kiveszem a kosárból" gomb 212×47 px, a rejtett kiegészítés
viszont a látható feliratba is bekerül a szövegkivonatnál.** Mérve: az
akadálymentes név „Kiveszem a kosárból: Otthoni KézRehab Program", ami helyes
(WCAG 2.2 SC 2.5.3 Label in Name,
<https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html>). Nincs teendő,
csak jegyzet: a mérőeszközök ezt egy feliratként látják.

---

## 4. Amit a mérés JÓNAK talált (megőrzendő)

Ezek nem díszítő megjegyzések: mindegyik olyan pont, ahol a magyar
kisvállalkozói webshopok jellemzően buknak, és itt mérve rendben van.

1. **Vendégvásárlás, kényszerített regisztráció nélkül.** A pénztár vendégként
   is teljes értékű, a szöveg elmondja, hogy a fizetés után jön a jelszó-beállító
   link, és ha az e-mailhez már van fiók, felkínálja a belépést
   (Baymard, <https://baymard.com/blog/guest-and-account-checkout>).
2. **Hibaüzenetek magyarul, a mezőnél, fókusszal.** A `planCheckoutSubmission`
   az első hibás mezőre viszi a fókuszt, a mezőhiba `role="alert"`, az
   `aria-invalid` gépeléskor eltűnik, és az űrlap tetején mindig ott az élő
   régió (WCAG 3.3.1 és 3.3.3;
   GOV.UK Error message, <https://design-system.service.gov.uk/components/error-message/>).
3. **A gomb NINCS letiltva hiányzó pipa esetén, hanem magyarázatot kap.**
   Az `aria-describedby` a gomb mellé írja, mi hiányzik. Ez pontosan a GOV.UK és
   az NN/g ajánlása a letiltott gomb helyett.
4. **Dupla beküldés ellen valódi védelem:** a gomb csak beküldés közben
   `disabled`, és a felirat a szótári „Feldolgozás…"-ra vált.
5. **Az ÁSZF-pipa nincs előre bejelölve**, és két külön nyilatkozat fedi a
   digitális tartalom azonnali teljesítését (GOV.UK Checkboxes,
   <https://design-system.service.gov.uk/components/checkboxes/>).
6. **Minden hibaág visz tovább:** sikertelen fizetés (újrapróbálás a TERMÉK
   azonosítójával, nem a rendelésszámmal), vendég 401 (jelszó-beállítás
   elsődlegesen, belépés másodlagosan), 404, időtúllépés, visszatérítés.
   Zsákutcát egyiken sem mértem.
7. **A Barion-jelzés a gomb közvetlen közelében áll**, hivatalos logósorral, és
   a kép `width`/`height` attribútummal, tehát nem ugrik el a gomb betöltéskor.
8. **A CTA-feliratok a szótárból jönnek** (`src/lib/cta-vocabulary.ts`,
   G-UI1 őr): „Megveszem a kurzust", „Menj a pénztárhoz", „Megrendelem és
   fizetek", „Nyisd meg a kurzusoldalt", „Elindítom ingyen", „Újrapróbálom".
   A teljes úton nem találtam szótáron kívüli gombfeliratot.
9. **A ragadós vásárlósáv mobilon jól viselkedik**, ha egyszer bekapcsol: a
   süti-sáv FÖLÉ rendeződik, árat és gombot visz (390 px-en 390×98, a gomb
   205×73), tehát a P1-1 javítása után azonnal működő tartalékút.
10. **`robots.txt` és `sitemap.xml` helyes**: a tranzakciós lapok minden robotra
    és a 14 engedélyezett AI-ügynökre is tiltva, a kurzusoldalak benne a
    sitemapben, a demó-landing kihagyva és `noindex`.

---

## 5. Kognitív séta (Kovácsné, 54, fájós csukló, telefon és laptop)

A persona a `docs/felhasznaloi-seta.md` szerint. Belépési pont a mért helyzethez
igazítva: NEM keresésből, hanem egy Tudástár-cikkből kattint a kurzusra.

|   # | Lépés                               | Mit lát (mérve)                                                                                                      | Ítélet                       |
| --: | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
|   1 | Tudástár-cikkből a fizetős kurzusra | a hubon 2 fizetős és 4 ingyenes link között választ, a menüben is az ingyenes van                                    | bizonytalan (P2-12)          |
|   2 | Termékoldal, első képernyő, laptop  | csomagkép, cím, ár 79 500 Ft, „egyszeri díj", pipás előnyök, garancia-sor                                            | rendben                      |
|   3 | A gomb megnyomása                   | a „Megveszem a kurzust" gomb közepén a süti-sáv van, a kattintás a sávot éri                                         | **elakad (P1-1)**            |
|   4 | Süti elintézése után újra           | a gomb kattintható, a ragadós sáv is életre kel görgetéskor                                                          | rendben                      |
|   5 | Bizonyítékot keres                  | 4 modul címe, „Kinek való, kinek nem" 15 tétele, garancia. Vélemény nincs, GYIK nincs, videó nincs, egyetlen kép van | bizonytalan (P1-3)           |
|   6 | Az árat mérlegeli                   | a 119 000 Ft-os eredeti ár csak a garancia-szövegben, 7439 px-nél bukkan fel, az ár mellett nem                      | zavaró (lásd 7. szakasz)     |
|   7 | Pénztár                             | teljes menü, „Elérhetőséged", 7 mező, a nevét kétszer írja be                                                        | zavaró (P2-1, P2-3)          |
|   8 | Elállási nyilatkozatok              | két pipa arról, hogy elveszíti a 14 napos elállási jogát; a 30 napos garancia sehol                                  | **bizonytalan (P2-10)**      |
|   9 | A fizetőgomb előtt                  | Barion logósor és magyarázat. Az ár 2101 px-rel feljebb, a tétel neve nem link                                       | **bizonytalan (P1-2, P2-2)** |
|  10 | Pipa nélkül kattint                 | a gomb nem tiltott, a fókusz az első hiányzó négyzetre ugrik, magyar magyarázat                                      | rendben                      |
|  11 | Fizetés a Barionon, visszatérés     | a köszönőoldal 2 mp-enként kérdez, siker esetén a lejátszóra visz                                                    | rendben                      |
|  12 | Ha a bank elutasít                  | „A fizetés nem sikerült", újrapróbálás a TERMÉKRE, plusz „Írj nekünk"                                                | rendben                      |

**Ítélet:** Kovácsné az első kattintásnál elakad (3. lépés), majd az 5., 8. és 9.
lépésnél nem kap választ arra, hogy megbízhat-e a vásárlásban és pontosan mit
kap 79 500 Ft-ért. A folyamat technikai része ezután hibátlanul viszi végig.

---

## 6. Konverziós út és mérés (CRO)

**A mért tölcsér.** A PostHog-események: `course_viewed` (a kurzusoldal
megnyitása), `checkout_started` (a pénztár megnyitása), `purchase_confirmed`
(csak ténylegesen `paid` státusz után), `checkout_failed` négy zárt kategóriával
(`blocked`, `invalid`, `rejected`, `exception`) és a fókuszált elem
azonosítójával. A Barion Pixel a `contentView`, `initiateCheckout`,
`addPaymentInfo`, `initiatePurchase`, `purchase` láncot viszi, sikertelen
fizetésnél `step: -1`-gyel. Ez a műszerezettség elég a Semrush CRO-modul 2.
lépéséhez (lemorzsolódási pontok azonosítása,
<https://www.semrush.com/blog/conversion-rate-optimization/>).

**Ami hiányzik a méréshez.** (1) A `course_viewed` és a `checkout_started`
között nincs esemény, tehát nem látszik, hányan próbálták megnyomni a gombot,
és hányan görgettek el mellette. A P1-1 takarás emiatt a mai adatokban NEM
látszana, csak a hiányzó konverzióban. (2) Nincs görgetési mélység a
termékoldalon, tehát nem tudni, eljutnak-e a „Kinek való" és a garancia
szakaszig (a fizetős oldal 8571 px, azaz 9,5 képernyő asztali gépen).
(3) Nincs kilépési szándék-kérdés a pénztárban.

**Javaslat sorrendben:** a P1-1 javítása után az első két hét adatában a
`checkout_started / course_viewed` arány a mérőszám. Utána a P1-2 (ár a gomb
mellett) és a P2-10 (garancia a pénztárban) egyetlen változásként mérhető a
`purchase_confirmed / checkout_started` arányon. A/B tesztet a mért forgalom
mellett (organikus lábnyom nulla) NEM javaslok: nem lenne szignifikáns minta,
a Semrush CRO-modul 5. lépése kisebb oldalnál is legalább két hetet és elegendő
mintát ír elő.

---

## 7. Tulajdonosi döntést igénylő tételek

1. **A „olcsó dolgok itt" menüpont sorsa** (P1-4). Törlés az éles adminban, vagy
   az `/akcios-kurzus` valódi kampány-landinggé alakítása. Amíg így áll, a
   főmenü minden oldalon egy demó-oldalra visz.
2. **A `/kosar` kivezetése vagy bekötése** (P1-5).
3. **Az ingyenes SOS és a fizetős program menü- és linkaránya** (P2-12).
4. **A 119 000 Ft-os eredeti ár állítása.** A garancia-szövegben ez áll:
   „A program eredeti ára 119 000 Ft, bevezető áron most 79 500 Ft-ért érhető
   el." Ez árcsökkentés-bejelentés, amelyre az uniós ár-feltüntetési szabályok
   (Omnibus) korábbi-ár-szabálya vonatkozik, és a magyar átültetés is előírja a
   megelőző időszak legalacsonyabb árának feltüntetését. **Jogi ellenőrzést
   javaslok**, mielőtt az állítás a vásárlódobozba, az ár mellé kerülne; ha az
   állítás nem tartható, a mondat elhagyandó. Az audit nem foglal állást a
   jogszerűségről, csak jelzi a kockázatot.
5. **Egészségügyi eredmény-ígéretek** a fizetős oldalon: „megszüntetheted vagy
   jelentősen enyhítheted a csukló-, ujj-, alkar- és könyökfájdalmakat, akár
   hetek alatt", és „Semmit sem kockáztatsz, de rengeteget nyerhetsz!". A
   `docs/ADATOK-mert.md` 5. szakasza a versenytárs számszerű
   gyógyulás-állításait kifejezetten YMYL-tilalom alá vonja nálunk. Tulajdonosi
   és szakmai döntés, hogy ezek maradnak-e ebben a formában.
6. **Az irányítószám-mező billentyűzete** (P3-1).
7. **A redukált pénztári fejléc és lábléc** (P2-1): ez érinti a webhely
   egységes keretét, ezért döntés kell hozzá.

---

## 8. Azonnal vállalható, S-méretű javítások (külön ügynöknek kiadható)

Mindegyik egy fájl vagy egy CMS-mező, a CTA-szótár és a betűméret-tokenek
sértetlenül maradnak, tehát a G-UI1 és a tipográfia-őr nem sérül.

1. **A vásárlógomb kiszabadítása a süti-sáv alól** (P1-1): a
   `documentElement` kapjon jelölést, amíg a sáv él, és ebben az állapotban a
   `CourseBuyBar` `data-visible="true"` legyen. Ellenőrzés: `elementFromPoint`
   a gomb közepén 1440×900-on és 390×844-en NEM a `kc-consent-banner`-t adja,
   vagy a ragadós sáv magassága nagyobb nullánál.
2. **Összegző kártya a fizetőgomb fölé** (P1-2, P2-10): kurzusnév, ár,
   „egyszeri díj, további költség nincs", a garancia egy sora. Fájl:
   `src/components/checkout/CheckoutForm.tsx`, adat: a már meglévő `product` és
   `guaranteeLabel`.
3. **A számlázási név előkitöltése a vendég nevéből** (P2-3):
   `src/lib/checkout/form-submission.ts` és `CheckoutForm.tsx`.
4. **Az adószám-mező kapcsoló mögé** (P2-4): `CheckoutForm.tsx`.
5. **Az öt gondolatjeles hibaüzenet javítása** (P2-5):
   `src/lib/checkout/guest.ts` 85. és 94. sor, `src/lib/checkout/billing.ts`
   134., 140. és 142. sor. Vessző vagy kettőspont a jel helyén.
6. **A kosár szerver-mondatának cseréje** (P2-6): `CartView.tsx`.
7. **Az MNB-engedélyszám a pénztári Barion-szövegbe** (P2-11):
   `BarionFizetesJelzes.tsx`, a kezdőlapi mondat átvételével.
8. **A `courseJsonLd` ingyenes ága kapjon `offers`-t `price: 0`-val, és a
   garancia `hasMerchantReturnPolicy`-t** (P2-7): `src/lib/seo.ts`.
9. **A kategória-csipek csak két kategóriától** (P2-8):
   `src/app/(frontend)/kurzusok/page.tsx`.
10. **A lista bevezetőjének igazítása a valós kínálathoz** (P2-8): CMS és
    `COURSE_LISTING_DESCRIPTION`, egyúttal 155 karakter alá.
11. **A csomagkép `contain`-re** (P2-9): `kurzusok.css`
    `.kc-course-media__image`.
12. **A GYIK-címsor darabszámának elrejtése** (P3-4): `CourseFaq.tsx`.
13. **A három jelölőnégyzet azonos, 24 px-es mérete** (P3-2): `checkout.css`.
14. **A poll-állapot H1-ének egységesítése** (P3-5): `ThankYouView.tsx`.

Tartalmi (CMS) feladatok, tulajdonosi szöveggel: a fizetős kurzus GYIK-je és
véleményei (P1-3), a 16 és 14 gondolatjel javítása a termékoldalakon (P2-5), a
`gallery` képek megjelenítése (P1-3 c pont, ehhez kód is kell).

---

## 9. Nyitott kérdések

1. **Nincs mért kulcsszó-adat a kurzusoldalak tranzakciós szándékára.** Az
   `ADATOK-mert.md` a panasz-kifejezéseket méri (ínhüvelygyulladás, kéztőalagút,
   teniszkönyök), a „kéztorna", „otthoni gyógytorna", „kéztorna gyakorlatok"
   hármashoz viszont nincs volumen, KD vagy CPC. A P2-13 szétosztása ezért ma
   csak elvi; számokkal alátámasztani új Monid-kör után lehet.
2. **Az élő és a helyi tartalom eltér** (élesben 4 modul a fizetős kurzuson,
   helyben 3; a menü csak élesben tartalmazza a „olcsó dolgok itt" pontot). Nem
   tudom, mekkora még a szétcsúszás; a seed és az éles CMS összevetése külön
   feladat.
3. **A 30 napos garancia és a 14 napos elállási jog együttes kommunikációja**
   jogi jóváhagyást igényel, mielőtt a garancia a pénztárba kerül.
4. **A 119 000 Ft-os eredeti ár** ár-feltüntetési megfelelősége (7. szakasz 4.
   pont).
5. **Nem tudom, terveznek-e szakmai (nem laikus) kurzust.** A `/kurzusok` mai
   szövege ígéri, a kínálat nem tartalmazza; ha nem lesz, a szöveg javítandó, ha
   lesz, a `audience` szerinti szűrő értelmet kap.
6. **Élő checkout-mérés nem történt.** A `/penztar` élesben csak megnyitva lett
   volna vizsgálható, beküldés nélkül; a mérést a biztonság kedvéért helyben
   végeztem. Egy Barion teszt-környezetes, végigvitt vásárlás (staging) még
   hátravan.

---

## 10. Mérési napló (reprodukálás)

```
cd <scratchpad>/audit-c
# geometria, kontraszt, űrlapmezők, kép- és CTA-leltár
node measure.mjs http://localhost:3000/kurzusok                              lista   1440 reduce
node measure.mjs http://localhost:3000/kurzusok/otthoni-kezrehab-program     fizetos 1440 reduce
node measure.mjs http://localhost:3000/kurzusok/sos-kezrelax-villamkurzus    sos     1440 reduce
node measure.mjs http://localhost:3000/akcios-kurzus                         akcios  1440 reduce
node measure.mjs "http://localhost:3000/kosar?termek=1"                      kosar   1440 reduce
node measure.mjs "http://localhost:3000/penztar?termek=1"                    penztar 1440 reduce
node measure.mjs "http://localhost:3000/sikertelen?termek=1"                 sikertelen 1440 reduce
#   ugyanez 390 és 320 px-en
# dokumentum-sorrend, gomb- és mezőpozíciók, jelölőnégyzet-célok
node checkout.mjs "http://localhost:3000/penztar?termek=1" penztar 1440
node checkout.mjs "http://localhost:3000/penztar?termek=1" penztar 390
# hajtás fölötti tartalom a süti-sávval EGYÜTT
node fold.mjs http://localhost:3000/kurzusok/otthoni-kezrehab-program fizetos 1440
node fold.mjs http://localhost:3000/kurzusok/otthoni-kezrehab-program fizetos 390
node fold.mjs "http://localhost:3000/kosar?termek=1" kosar 390
# találat-teszt: kattintható-e a gomb KÖZEPE
node hit.mjs http://localhost:3000/kurzusok/otthoni-kezrehab-program 1440
node hit.mjs http://localhost:3000/kurzusok/otthoni-kezrehab-program 390
node hit.mjs "http://localhost:3000/kosar?termek=1" 390
# ragadós vásárlósáv
node buybar.mjs 390
node buybar.mjs 1440
# látható szöveg és gondolatjel-számlálás
node text.mjs http://localhost:3000/kurzusok/otthoni-kezrehab-program fizetos
# teljes oldalas képernyőképek és szeletek
node ../shot.mjs http://localhost:3000/penztar?termek=1 shot-penztar-1440.png 1440 reduce
python3 ../slice.py shot-fizetos-1440.png sl-fizetos 1400
# élő tartalom és SEO-réteg
curl -sS https://kineticare-production.up.railway.app/kurzusok/otthoni-kezrehab-program -o live-...html
curl -sS https://kineticare-production.up.railway.app/robots.txt
curl -sS https://kineticare-production.up.railway.app/sitemap.xml
```

Kimenetek a session-scratchpad `audit-c/` mappájában:
`m-<oldal>-<szélesség>-reduce.json`, `c-<oldal>-<szélesség>.json`,
`t-<oldal>.txt`, `shot-<oldal>-<szélesség>.png`, `sl-<oldal>-NN.png`,
`fold-<oldal>-<szélesség>.png`, `buybar-<szélesség>.png`,
`live-*.html`, `lp-*.html`.

A geometria, a színek és a kontraszt a production buildben azonosak; az
LCP-idők a dev-szerverről valók, tehát csak irányadóak. A képsúlyokat és a
strukturált adatot közvetlenül az ÉLES kiszolgálóról mértem.
