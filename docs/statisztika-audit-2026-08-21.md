# Statisztika-oldal: audit és döntések

> **Mi ez?** Négy párhuzamos kutatás (versenytárs-analitika üzleti szemmel,
> NN/g és akadálymentességi sztenderdek, PostHog-adataudit, repó- és
> biztonsági audit) szintézise, és a belőle következő **vezetői döntések**.
>
> **Készült:** 2026-08-21. A kiváltó tulajdonosi kérés: *„a statisztikai
> oldalon fontos lenne ha lehetne látni hogy ki az aki elkezdte a kurzust név
> szerint és ki az aki nem, valamint a felhasználói oldalon az usereknél lenne
> valami indikáció hogy ha elkezdték és hol tartanak"* — plusz audit arra,
> hogy egy cégvezető ezt akarja-e látni.

## 0. A négy legfontosabb megállapítás

1. **A kért funkció adatrétege KÉSZ.** A név, e-mail, százalék, állapot,
   utolsó aktivitás és a következő lecke tanulónként már ki van számolva
   (`src/lib/admin/course-progress-stats.ts`). Új mező, új tábla, **migráció
   nem kell.** Ez teljesíti a „ne legyen felesleges kód" kikötést.
2. **Az oldal ma eredményjelző tábla, nem teendőlista.** A tetején a
   legkevésbé cselekvésre késztető szám áll (12 havi kumulált bevétel), a
   legcselekvőbb (sikertelen fizetés) a negyedik helyen, hajtás alatt.
   Egyszemélyes vállalkozásnál ez fordítva hasznos.
3. **A PostHogból ma nincs mit áthozni**, és tartósan sem lesz érdemes:
   a konszent miatt szisztematikusan a forgalom felét-kétharmadát hiányolná,
   és ugyanazon a képernyőn ellentmondana a teljes adatbázis-számoknak.
4. **Két valódi WCAG-bukás van a MAI panelben**, számolt kontraszt-értékkel:
   a Payload `--theme-error-500` fehéren **4,13:1**, a `--theme-warning-500`
   **4,03:1** — mindkettő a 4,5:1 küszöb alatt.

## 1. Döntés: hova kerülnek a nevek

**A tulajdonos a statisztika-oldalt kérte. A tervezői ajánlás a kurzus lapja
volt.** A feloldás mindkettőt teljesíti:

| Mi | Hol | Miért |
| --- | --- | --- |
| A **„nem kezdte el" nevek**, legfeljebb 10, nyitható blokkban | a statisztika-oldalon | Ez az EGYETLEN csoport, amiből aznap cselekvés lesz. A tulajdonos ezt kérte, és ez fér el egy irányítópulton. |
| A többi név, szűrővel, keresővel, CSV-exporttal | marad a kurzus lapján | 300 nevet egy irányítópultra tenni a dashboard-elv ellen való: az „nem felfedezésre, hanem gyors leolvasásra" készül. A panel ma többet tud, mint amit egy beágyazott lista tudna. |
| **Mély link**: a szám maga legyen link, ami a panelt magától betölti és a szűrőt beállítja | mindkét irányban | Ma három lépés kell a válaszig (link → „Haladás betöltése" gomb → szűrő). Ez háromról egyre csökken. |

**Amit a nevek kitétele MAGA UTÁN VON, és kötelező:** a csonkolásnál kihagyott
hallgatók számát (`omitted`) át kell vezetni a jelentésbe és ki kell mondani.
Darabszámnál a csonkolás elfogadható alsó becslés; **névsornál nem az** —
egy hiányzó név nem becslés, hanem hamis állítás egy konkrét emberről
(„nincs a listán" → „nem kezdte el"). Ma a `CourseEngagementReport` nem hordoz
`omitted` mezőt, az érték elvész.

## 2. Döntés: mit mutat a felhasználó-lista

**A meglévő „Megvásárolt kurzusok" oszlop bővül, NEM jön új oszlop.** Így a
lista nem nő vízszintesen, és nem válik szét a „mit vett" és a „hol tart".

```
Otthoni KézRehab Program · 45% · folyamatban
SOS KézRelax · 0% · nem kezdte el
```

**Kurzusonkénti sor, nem átlag.** Ez válaszolja meg azt a kérdést, hogy mi
legyen három kurzusnál: nincs súlyozott átlag, mert az hazudna.

**Kötelező feltételek:**
- Az állapot **szóval** is szerepel, nem csak színnel (WCAG 2.2 **1.4.1**).
- A cella **egyetlen**, oldalankénti kérésből tölt, nem soronként.
- A haladás **számított** érték, ezért a listában **nem szűrhető és nem
  rendezhető**. Ezt az oszlop leírásának ki kell mondania, és a „listázd ki
  mindenkit, aki nem kezdte el" feladatra a kurzus-panel szűrője + CSV-exportja
  a helyes eszköz.

## 3. Döntés: a szekciók sorrendje

Két független kutatás ugyanarra jutott: a cselekvésre késztető szekció menjen
felülre.

| Ma | Javasolt |
| --- | --- |
| 1. Összesítő kártyák | 1. Összesítő kártyák (kap `h2`-t) |
| 2. Havi bevétel | 2. **Rendelések állapota** (a mai tölcsér) |
| 3. Bevétel kurzusonként | 3. **Ki hol tart a kurzusokban** (+ a „nem kezdte el" nevek) |
| 4. Tölcsér | 4. Havi bevétel |
| 5. Kurzus-hatás | 5. Bevétel kurzusonként |

Ez nem mond ellent a `docs/ertekesitesi-ux-skill.md` üzleti sorrendjének: az a
**vevői** felület cél-hierarchiája, nem egy belső irányítópulté.

## 4. Döntés: a PostHog

**Nem hozunk át PostHog-adatot a Statisztika oldalra.** Indok a 0.3 pontban.

A PostHog valódi többlete három dolog, és egyik sem szerepel a kért
funkciók között: a vásárlás **előtti** viselkedés, a **néma űrlaphibák**, és a
**videón belüli mélység**. Ezek a PostHog saját felületén nézendők.

**Kemény szabály:** ugyanaz a mérőszám sosem jelenhet meg két forrásból. Ha a
PostHog „38 kurzusindítást" ír, az adatbázis meg 71-et, a tulajdonos nem az
adatot fogja nézni, hanem elveszti a bizalmát mindkettőben.

**Tulajdonosi döntések ehhez (2026-08-21):** az `identifyUser` **marad**, az
autocapture **kikapcsolandó**, a GeoIP-finomítás **elmarad**. Az autocapture
kikapcsolása azért sürgős, mert ma diagnózis-beszédes kattintás-szövegeket
rögzít („a kéztőalagút-szindrómáról szóló cikkünk").

**Állapot (2026-08-22): az autocapture kikapcsolása MEGTÖRTÉNT.** A
`buildPostHogOptions` mostantól kiírja az `autocapture: false`-t
(`src/lib/analytics/posthog.ts`), őr-teszttel védve
(`src/__tests__/posthog.test.ts`). A kiírás azért kellett, mert a posthog-js
alapértelmezése BEkapcsolt autocapture — mérve a telepített csomagban
(`node_modules/posthog-js/dist/module.js`, az alapértelmezés-blokkban:
`…,token:"",autocapture:!0,cross_subdomain_cookie:…`). A hallgatás itt tehát
nem semleges lett volna. Az `identifyUser` és a GeoIP változatlan.

**Állapot (2026-10-16): az autocapture engedélyezőlistával vissza.** A mobil
halott kattintások méréséhez a tulajdonos kérésére az autocapture csak négy
vezérlőcsalád kattintását küldi: `.kc-nav-mobile__toggle`, `.kc-button`,
`.kc-nav-mobile__link`, `.kc-nav-mobile__sublink`
(`css_selector_allowlist`, ugyanott, ugyanazzal az őr-teszttel). A cikkek és
az űrlapok szövege így nem megy ki. Nyitott tulajdonosi döntés: a `.kc-button`
felirata CMS-szöveg, és egy cikk alatti gomb a betegség nevét is tartalmazhatja;
ha ezt azonosított látogatónál sem akarjuk rögzíteni, a `mask_all_text: true`
a szöveget elhagyja, az elem osztálya és a link címe megmarad.

## 5. Amit tudatosan KIHAGYUNK

| Kihagyva | Miért |
| --- | --- |
| MRR, churn, LTV, CAC, kohorsz-görbék | Ez nem előfizetéses üzlet, hanem egyszeri digitális termék, két termékkel. Kognitív teher, nulla döntéssel. |
| Kupon- és affiliate-riport | Nincs kuponrendszer a kódban. Adat nélküli szekció rosszabb, mint a hiányzó szekció. |
| Ranglista, gamifikáció | Kézrehabilitációs, gyakran fájdalommal élő betegcsoportnál a nyilvános teljesítmény-rangsor kontraproduktív és ízléstelen. A névsor **belső munkalista**, nem verseny. |
| Videónkénti retenciós görbe | A Bunny Stream saját analitikájában él; duplikálni drága. |
| A/B-teszt szignifikancia | Néhány vásárlásnál a minta nem hordozza. |
| „Összes regisztrált felhasználó" kumulatív szám | Sosem csökken, sosem hoz rossz hírt. |
| Visszatérítés **forintban** | Az `orders.refunds` owner-only; a staff-riportba emelése access-control kérdés, emberi jóváhagyással. Darabszám mehet. |

## 6. Kötelező biztonsági és minőségi feltételek a megvalósításhoz

Ezek nem javaslatok, hanem a kiírás részei.

1. Új `users` mező és migráció **TILOS** — `ui` mező + szerver-végpont az út
   (precedens: a `users` két meglévő `ui` mezője).
2. A lista-cella **nem aggregálhat a kliensen** Payload REST-ből: a százalék
   szerver-oldalon, a közös számítási maggal dől el.
3. Az új végpont **saját `payload.auth` + szerepkör-kapu**, 401/403-mal, a
   meglévő haladás-végpont szó szerinti mintájára; `overrideAccess` csak a
   kapu UTÁN.
4. A lekérdezés **batchelve**, egyetlen `where … in` kifejezéssel a meglévő
   indexen. Soronkénti hívás tilos.
5. **Hibaágon sem kerülhet hallgatói objektum a naplóba.** A naplózó
   redact-listáján rajta van az `email`, de a **`name` nincs** — ellenőrizve,
   nulla találat.
6. **Access-control függvény, auth-hook és migráció nem módosul.** Mindkét
   kért funkció megoldható anélkül.
7. A statisztika-oldalra **csak név megy, e-mail nem.** Az e-mail a magasabb
   kockázatú mező, és nem is kérte senki.

## 7. Javítandó hibák, amiket az audit talált

| # | Hiba | Hol |
| --- | --- | --- |
| H1 | `--theme-error-500` kontrasztja **4,13:1** (kell 4,5) | a haladás-panel hibaüzenete |
| H2 | `--theme-warning-500` kontrasztja **4,03:1** | a csonkolás-figyelmeztetés |
| H3 | A görgethető táblarégió billentyűzetről nem érhető el | a haladás-panel tábláiban |
| H4 | A hallgató neve `td`, nem `th scope="row"` | ua. |
| H5 | A rendezhető fejléc-gomb magassága ~19 px (kell ≥24) | ua. |
| H6 | Nincs látható rendezés-jelölés, csak `aria-sort` | ua. |
| H7 | A bevétel-tábla sorfejléce a SKU, nem a kurzus címe — ugyanaz a kurzus két néven fut egy lapon | bevétel kurzusonként |
| H8 | Az összesítő kártyák fölött nincs `h2` | a lap teteje |
| H9 | Gondolatjel töltelék-elválasztóként, vegyes tegezés-magázás | több felirat |
| H10 | A dokumentáció azt állítja, „az N+1 megszűnt" — a kód szerint nem szűnt meg | `docs/review-2026-08-21-statisztika-bunny.md` |

## 8. A négy nyitott kérdés — eldöntve (2026-08-21)

A tulajdonos ezeket a vezetőre bízta („oldd meg nélkülem"). A döntések
indoklással, hogy később visszakereshetők legyenek.

### 8.1 Az „elakadt" küszöbe: **14 nap**

Nem 30. Két ok:

1. **Ez napi gyakorlásra épülő termék.** A kurzus ígérete szó szerint az, hogy
   „naponta néhány perc is elég". Aki két hete nem nyitotta meg, annál a
   szokás már megtört, nem csak lassult. A 30 nap ehhez a termékhez késő.
2. **Egy szám legyen, ne kettő.** A magyar elállási jog 14 nap
   (45/2014. Korm. rendelet). Ha az „elakadt" küszöb is 14, a tulajdonosnak
   egyetlen határidőt kell fejben tartania, nem kettőt.

Fontos, hogy ez **szűrő, nem negyedik állapot**: aki elakadt, az egyszerre
„folyamatban" is van. Negyedik címke kategóriahibát vinne a hármasba.

### 8.2 Szóhasználat: **„Hozzáfér"**, mindkét felületen egyszerre

A 2026-08-20-i audit nem azt döntötte el, melyik szó a jobb — azt döntötte el,
hogy a két felület **ugyanazt** mondja (WCAG 2.2 **3.2.4**). Az alapkérdés
nyitva maradt. A döntés most:

- **„Hozzáfér"**, mert ez írja le, ami történt: a vevő megvásárolta és
  hozzáférést kapott. Webshopban senki nem „iratkozik be".
- A `users` mező már ma is **„Megvásárolt kurzusok"** — vásárlás-nyelv,
  nem iskolai.
- **A döntő érv:** a hozzáférést ADÓ panel már ma is így beszél
  („Hozzáférés adása", „Hozzáférés megadva"). Vagyis nem új szót vezetünk be,
  hanem a meglévő kettőből ahhoz igazodunk, amelyik a cselekvést végzi.

A két felület **együtt** változik, egy PR-ben, hogy a 3.2.4-konzisztencia
egyetlen pillanatra se sérüljön.

### 8.3 A Payload hibaszíne: **csak a saját komponenseinkben**

Nem írjuk felül az admin egészére. Indok:

- A globális felülírás a **Payload gyári hibaüzeneteit is** átszínezné, az
  egész adminban, minden űrlapon. Nagy hatósugár, nehezen tesztelhető,
  és a keretrendszer saját kontraszt-feltevéseit boríthatja.
- A saját komponenseink **körülhatárolt felület**, és van már működő
  márka-tokenünk (#b3261e, mérve **6,54:1** — bőven a küszöb felett), ami a
  statisztika-oldalon már ma is fut.

Tehát: a saját komponensekben a márka-tokenre cserélünk, a Payload
globálisához nem nyúlunk.

### 8.4 Célszám a befejezési arányra: **nincs, és nem is lesz külső**

A kutatás egyértelmű: fizetős, önálló platformon futó, kis közönségű magyar
kurzusra **megbízható nyilvános viszonyítási szám nem létezik**. Ami a
keresésben előjön, az forrás nélküli tartalommarketing.

Ezért a felület **nem tűz ki célszámot**. Helyette a saját alapvonalat mutatja:
az arányt az **előző időszakhoz** mérve. Ez az egyetlen becsületes viszonyítás,
és egyben cselekvésre késztető is („romlott a múlt hónaphoz képest" → utána kell
nézni), miközben egy kitalált 40%-os cél csak szorongást keltene.

Az első hónapok számai lesznek az alapvonal. Amíg nincs elég adat, a felület
ezt mondja ki, nem trendet hazudik.

## 9. Amit a kutatás a viszonyítási számokról mondott

Ezt külön kiemeljük, mert csábító lenne külső célszámot kitűzni:

- **Medián 12,6%** befejezési arány (0,7–52,1% tartomány), 221 MOOC vizsgálva.
- Ugyanaz a kurzus **6,5%** a beiratkozottakhoz, **59%** a befejezési szándékot
  jelzőkhöz mérve. **Egy nagyságrend, pusztán a nevezőtől.**
- A befejezési arányok **6 éven át nem javultak** az edX-en.

**Fizetős, önálló platformon futó, kis közönségű magyar kurzusra megbízható
nyilvános viszonyítási szám NINCS.** A keresésben előjövő „fizetős kurzus
15–40%" típusú számok tartalommarketing-blogokból származnak, módszertan
nélkül — ezekre célt kitűzni nem szabad.

A helyes cél **saját alapvonal, időben követve**. A repó ehhez már helyesen
megkülönbözteti a két nevezőt (`completionRateOfEnrolled` és
`completionRateOfStarted`) — ez a kód erőssége, ki kell használni.
