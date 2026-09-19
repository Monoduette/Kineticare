# UI-sztenderdek – a Kineticare kötelező felületi szabályrendszere

**Verzió:** 1.1 · **Kiadva:** 2026-08-16 · **Státusz:** kötelező projekt-sztenderd
**Minden forrás online ellenőrizve:** 2026-08-16 (a hozzáférés dátuma a
7. Forrásjegyzékben tételenként is szerepel).

> **Változásnapló – 1.1 (2026-08-16).** A vezető eldöntötte az Ü5 nyitott
> kérdést (CTA-nyelvtan). A §3.2 szótár átírva a döntés szerint, négy új sorral
> bővült (#19–#22), és a döntés óta **kódba is önthető**:
> `src/lib/cta-vocabulary.ts` + a G-UI1 őr-teszt. Érintett szakaszok: 1.4/Ü5,
> 3.1.4 (M-2, P-1), 3.2, 6.5, 7.5, 7.6 (új), A/5.

> **Mi ez?** Verziózott, hivatkozott sztenderd a gombokra, a CTA-szövegekre, a
> navigációra és a magyar mikroszövegre. Ez a dokumentum **nem vélemény**: minden
> szabály mögött megnevezett, nyilvánosan elérhető forrás áll (W3C, Nielsen
> Norman Group, Baymard Institute, GOV.UK Design System, IBM Carbon, Atlassian
> Design System, Shopify Polaris, Apple HIG, Material Design 3, Android
> Accessibility, MTA helyesírási szolgáltatás, ELTE tipográfiai tananyag).
> Ahol nem találtam elfogadható forrást, azt **kimondom** (lásd 7.4).

---

## 1. Cél és hatókör

### 1.1 Mire való

Ez a dokumentum a felületi munka **kikényszeríthető** rétege: azt rögzíti, hogy
egy gomb mikor gomb, mit ír rá, hogyan néz ki minden állapotában, hány lehet
belőle egy oldalon, és hogyan hangzik magyarul. A meglévő két UX-doksi fölé
épül, nem helyettük:

| Doksi | Mit rögzít | Viszony ehhez |
|---|---|---|
| `docs/ertekesitesi-ux-skill.md` | üzleti cél-hierarchia (M1–M8), sticky-nav, tipográfiai skála | **Fölérendelt** üzleti szinten. Ütközésnél az ott rögzített cél-sorrend nyer, kivéve a 1.4-ben feloldott pontokat. |
| `docs/ux-hierarchia-audit.md` | a kezdőlap K1–K8 hibái | Diagnózis; ez a doksi ad rá gyógyszert gomb- és szöveg-szinten. |
| `docs/ux-belso-oldalak-kutatas.md` | belső oldalak elrendezése (B1–B8) | **Testvér-dokumentum.** A B-szabályok elrendezésről szólnak, ez a doksi elemekről és szövegről. Ütközések feloldva: 1.4. |
| `docs/gomb-inventar.md` | a MAI állapot gomb- és CTA-leltára, hibalista, fájl:sor szintű cserejavaslatok | **Testvér-dokumentum, munkamegosztással:** *ez* a doksi mondja meg, mi a **szabály**; a `gomb-inventar.md` mondja meg, **hol sérül ma** és mit kell átírni. A per-fájl patch-listát ne duplikáld ide. A korábbi szótár-ütközés **feloldva**: 1.4/Ü5 (2026-08-16); a `gomb-inventar.md` §5 azóta leképezés, nem szótár. |
| `docs/informacios-architektura.md` | útvonal-leltár, navigációs gráf, zsákutcák, IA-hibalista | **Testvér-dokumentum.** A 4. szakasz elveit *arra* a térképre kell alkalmazni; új útvonal vagy menüpont előtt az IA-térkép a kiindulás. |
| `docs/seo-geo-llm.md` | SEO/GEO technikai és tartalmi réteg | Kiegészítő. A CTA- és címke-szövegek a látható tartalom részei, tehát a JSON-LD mezőinek forrásai is (lásd `seo-geo-llm.md` „minden mező a látható tartalomból jön"). |
| `.claude/skills/termektervezes` | a tulajdonos kötelező munkamenete felületi munkához | **Fölérendelt.** Ez a doksi a skill 1–7. pontjának végrehajtható kifejtése. |

### 1.2 Hatókör

**Kötelező** minden látogatói (storefront) felületen: kezdőlap, kurzuslista,
kurzusoldal, pénztár, köszönőoldal, blog, fiók, lejátszó, űrlapok, hibaoldalak,
tranzakciós e-mailek CTA-i.

**Ajánlott** a Payload admin egyedi paneljein (`src/components/admin/**`): ott a
Payload saját design-rendszere az elsődleges, de a magyar mikroszöveg-szabályzat
(3.1) és a hibaüzenet-szabályok (2.7) **ott is kötelezők**.

### 1.3 Hogyan hivatkozz rá

- **Kódban:** komponens-fejkommentben `docs/ui-sztenderdek.md §<szakasz>` alakban
  (pl. `// CTA-felirat: docs/ui-sztenderdek.md §3.2`). A meglévő
  `docs/ertekesitesi-ux-skill.md 3. pont` hivatkozási stílussal azonos.
- **PR-leírásban:** melyik §-t érinti, és hogyan lett ellenőrizve (6. szakasz).
- **Ügynök-kiírásban:** a felületi feladat kiírása kötelezően megnevezi ezt a
  doksit és az `ertekesitesi-ux-skill.md`-t is.
- **A CLAUDE.md „Felületi (UX/UI) munka" szakasza** ezt a fájlt a kötelezően
  betöltendő listába veszi az `ertekesitesi-ux-skill.md` mellé.

### 1.4 Ütközések a meglévő doksikkal – és a feloldásuk

**Ü1 – Ismételt vásárlási CTA a kurzusoldalon.**
`ux-belso-oldalak-kutatas.md` **B6.1**: „két képernyőnél hosszabb értékesítő
oldalon a vásárlási CTA ismétlődik… a renderelt DOM-ban a `kc-button--primary`
vásárlási CTA-k száma > 1". Ezzel szemben a jelenlegi kód (2026-08-16-i
tulajdonosi döntés, `src/app/(frontend)/kurzusok/[slug]/page.tsx` fejkomment)
**egyetlen** CTA-t tart: a ragadós vásárlódobozét, mobilon a ragadós sávot.
**Feloldás:** a B6.1 mérőszáma elavult, a *célja* nem. A cél az, hogy a
vásárlási akció **mindig egy görgetésnyi távolságon belül** legyen. Ezt a
ragadós doboz + mobil sáv **teljesíti**, ráadásul jobban felel meg az „egy
oldal, egy elsődleges cselekvés" szabálynak (GOV.UK, Carbon, Atlassian –
lásd 2.2). **Új mérce:** nem a CTA-k *száma*, hanem hogy a vásárlási akció a
lap bármely pontján legfeljebb 0 görgetésnyire van (ragadós) – ezt a 6.2
ellenőrzés méri. A B6.1 számláló-kritériumát ez a doksi **felülírja**.

**Ü2 – Sorhossz `ch`-ban.**
`ux-belso-oldalak-kutatas.md` 3.9/1. pont már jelzi, hogy a `ch` egység a repó
betűjén és magyar szövegen ~32 %-kal hosszabb sort ad, mint amit a szám sugall.
Ez itt is érvényben marad: a **karakterszám** (Baymard: 50–60 optimális, 75-ig
elfogadható; WCAG 1.4.8 AAA: ≤ 80) a cél, a `ch` csak eszköz. **Feloldás:** a
6.1 mérési protokoll karakterszámot mér, nem `ch`-t.

**Ü3 – 44 px vs. 24 px érintési cél.**
`ertekesitesi-ux-skill.md` 3. pont 44×44 px-et ír elő, a WCAG 2.2 AA (2.5.8)
csak 24×24 CSS px-et. Ez **nem ellentmondás**: a 44 px szigorúbb, és a WCAG
2.5.5 (AAA) szintje. **Marad a 44 px** minden gombra; a 24 px csak a soron
belüli (inline) hivatkozásokra és az apró segédvezérlőkre a mentesség (2.4).

**Ü5 – ✅ ELDÖNTVE (2026-08-16): vegyes nyelvtan, kimondott szabály szerint.**

**Ez a pont 2026-08-16-ig nyitott volt** (két projekt-doksi ellentétes szótárt
javasolt: E/1 „Megveszem" ↔ E/2 „Vedd meg a kurzust"). **A vezető döntött**, és
a döntés **normatív forrása a `.claude/skills/termektervezes/SKILL.md` 2.
pontja**; ez a szakasz csak rögzíti és a szótárra alkalmazza.

**A döntés szó szerint (SKILL.md 2. pont):**

> A felhasználó SAJÁT cselekvését kimondó gombok **egyes szám első személyben**
> állnak („Megveszem a kurzust", „Elindítom ingyen", „Feliratkozom"); a
> navigáció, az útmutató szöveg és a magyarázatok **egyes szám második
> személyben** tegeznek. Kivétel: a bevett, egyszavas felületi címkék
> („Belépés", „Regisztráció") maradhatnak főnévi alakban.

**Az indoklás (szintén a SKILL.md 2. pontjából, mérésre alapozva):**

1. **Megszokás, mérve.** A régi `www.kineticare.hu` – amit a meglévő ~274 vevő
   használ – **100 %-ban E/1-es gombfeliratokat** használt: `KÉREM A PROGRAMOT`,
   `KÉREM A VILLÁMKURZUST`, `KÉREM A HOZZÁFÉRÉST`, `KÉREM AZ ÉRTESÍTÉST`,
   `MEGRENDELEM`, `MEGNÉZEM`, `ELKÜLDÖM`. **Egyetlen felszólító alakú
   gombfelirat sem volt a teljes régi oldalon** (mérés:
   `docs/regi-oldal-osszehasonlitas.md` 3.1 és 3.4). A mai új felület is E/1-es.
   Jakob törvénye (NN/g) szerint a visszatérő vevő azt a mintát várja, amit már
   ismer – itt tehát a megtartás a bizonyítékkal alátámasztott irány.
2. **Az angol design-rendszerek érve nem ültethető át egy az egyben.** A GOV.UK,
   a Carbon, a Polaris és az Atlassian azért ír felszólító alakot, mert az
   angolban **nincs E/1-es gombidióma** (*„I buy the course"* nem gombfelirat).
   Az elvük – „a gomb mondja meg, mi történik, ha rákattintasz" – E/1-ben
   **ugyanúgy teljesül**: a „Megveszem a kurzust" pontosan olyan konkrét, mint a
   „Vedd meg a kurzust". A szabály mechanikus átvétele fordítás-ízű hangot adna,
   amit a tulajdonos kifejezetten tiltott.
3. **Kutatási tény ebben nincs** – sem E/1, sem E/2 mellett nincs magyar nyelvű,
   replikált mérés (lásd 7.5). Ezért ez **vezetői döntés**, és így is van
   jelölve; a doksi nem álcázza kutatási eredménynek.

**Amit a döntés NEM old fel** (ezek a személytől függetlenül hibák, és a §3.2
mindet érvényesíti):

- **egy cselekvés = egy felirat** az egész oldalon (WCAG 3.2.4) – ma a „menj a
  kurzuslistára" cselekvésre **nyolc**, a „saját kurzusaidhoz"-ra **négy**
  felirat él (`gomb-inventar.md` §5);
- **a felirat legyen igaz** – ingyenes terméken a „Megveszem" hazugság (A/1);
- **töltelék gondolatjel tilos** – az „Ingyenes — azonnal eléred" ezért is hibás
  (3.1.2);
- **a puszta „Tovább…" nem CTA** – nem mondja meg, mi történik (M-7);
- **a főnévi (deverbális) alak gyengébb az igei alaknál** – „Üzenet küldése",
  „Jelszó beállítása" helyett ige (M-1); a *kivétel* csak a bevett, egyszavas
  címke („Belépés", „Regisztráció"), nem a `-ás/-és` képzős szerkezet;
- **archivált/nem elérhető terméknél nincs letiltott gomb**, hanem magyarázó
  mondat (§3.2 #16, Á-3).

**Következmény:** a szótár innentől **kódba önthető** – a §3.2 egyetlen
igazságforrása a `src/lib/cta-vocabulary.ts` modul, amit a **G-UI1** őr véd
(6.3). **A két doksi szótárának bitre egyeznie kell**: a normatív szótár a §3.2,
a `docs/gomb-inventar.md` §5 ennek a *leképezése* a mért állapotra.

**Ü6 – Sorhossz: 45–85 vagy 50–75 karakter?**
A `termektervezes` skill 3. pontja **45–85 karaktert** ír elő (magyar szöveggel
mérve); a külső kutatás szűkebb (Baymard: 50–60 optimum, 75-ig elfogadható;
WCAG 1.4.8 AAA: ≤ 80). **Feloldás:** nincs valódi ellentmondás – a skill a
**tűréshatárt** adja (ezen kívül bukás), a kutatás a **célértéket**. Szabály:
*tűrés 45–85, cél 50–75.* A 85 feletti sor bukás; a 45 alatti (túl keskeny
hasáb) szintén, mert töredezi az olvasást.

**Ü4 – „Megveszem" ingyenes terméken.**
Az `ertekesitesi-ux-skill.md` M3 pontja szerint „ár mindig forintban, rejtett ár
nincs". A `src/lib/courses.ts` `resolveCourseCta` viszont csak akkor ad
ingyenes-ágat, ha `priceInHUFEnabled === false`; a `priceInHUFEnabled: true` +
`priceInHUF: 0` konfiguráció **„Megveszem" + „0 Ft"** kombinációt ad. Ez sérti
a „link is a promise" elvet (NN/g) és a 3.2 CTA-szótárt.

**Állapot 2026-08-16-án:** egy párhuzamos kör **már dolgozik** a gyökérokon
(`src/lib/courses.ts` + `src/lib/free-course-grant.ts`): bevezette az
`isFreeCourse()` egyetlen igazságforrást (szigorú `priceInHUFEnabled === false`)
és a `hasUnsetPriceFlag()` szerkesztői-hiba-felismerést. Ez **helyes irány**, és
a beállítatlan pipa problémáját megoldja — a részleteket lásd
`docs/gomb-inventar.md` §3.

**Ami ettől függetlenül NYITVA MARAD (ellenőrizve a fenti javítás után is):**
a `coursePriceHuf()` a `priceInHUFEnabled: true` + `priceInHUF: 0` esetben
érvényes **0**-t ad vissza, tehát `coursePriceBadgeKind` → `'price'`,
`resolveCourseCta` → `'buy'`. A felület **„0 Ft" ár mellé „Megveszem" gombot**
rajzol. **Feloldás:** a nulla (vagy negatív) ár **nem érvényes ár** — a
`coursePriceHuf` `null`-t adjon rá, és a döntés essen vissza az `isFreeCourse()`
ágra vagy a `'none'` (hiányos konfiguráció) ágra. Lásd A/1 mellékága.

---

## 2. Gomb-rendszer

### 2.1 Mikor gomb és mikor link

Ez **nem stílus-kérdés, hanem szemantika**: eltér a billentyűzetes viselkedés, a
képernyőolvasós bejelentés és a böngésző-funkciók (új lapon nyitás, cím
másolása) elérhetősége.

| | **Link (`<a>` / `next/link`)** | **Gomb (`<button>`)** |
|---|---|---|
| Mit csinál | **Navigál** egy erőforráshoz (másik oldal, horgony, letöltés) | **Cselekvést vagy eseményt indít** (beküldés, megnyitás, bezárás, törlés) |
| Billentyű | `Enter` | `Enter` **és** `Space` |
| Böngésző-funkciók | jobbklikk / új lap / cím másolása működik | nem értelmezett |
| Képernyőolvasó | „hivatkozás" | „gomb" |

> *„A **button** is a widget that enables users to trigger an action or event,
> such as submitting a form, opening a dialog, canceling an action…"* – és
> *„The types of actions performed by buttons are distinctly different from the
> function of a link."*
> (W3C **ARIA Authoring Practices Guide**, Button Pattern)

**Szabályok (kikényszerítendők):**

- **B-1.** Ami URL-t vált, az `<a>`/`next/link` – akkor is, ha gombnak *látszik*
  (a `Button` komponensünk `href` mellett helyesen `<a>`/`Link`-et rendel).
- **B-2.** Ami nem vált URL-t (beküldés, panel nyitása, lejátszó vezérlése), az
  `<button type="button|submit">`. `div`/`span` + `onClick` **tilos**.
- **B-3.** **Nem kattintható elem nem nézhet ki gombnak.** NN/g:
  *„don't make nonclickable items look like buttons"* és
  *„Never make users rely on scrubbing the screen with the mouse to determine if
  a text is clickable."* (Beyond Blue Links)
  → Ha egy kártya EGÉSZE link, akkor a benne lévő „CTA" **nem viselheti a
  `primary` gomb kitöltését** (lásd A/4 megállapítás).
- **B-4.** A hivatkozás megjelenése az egész oldalon **azonos**: NN/g –
  *„Whatever appearance you choose for hyperlinks, make sure to apply the same
  treatment consistently throughout your site."*
- **B-5.** A szín soha nem lehet az egyetlen jelölő (aláhúzás, keret, pozíció,
  ikon kell mellé) – WCAG 2.2 **1.4.1 Use of Color (A)**; NN/g ugyanezt írja elő
  a gomb-állapotokra is.

### 2.2 A hierarchia szintjei – és mikor melyiket

A vezető design-rendszerek egybehangzóak: **oldalanként legfeljebb egy
elsődleges gomb.**

| Forrás | A szabály szó szerint |
|---|---|
| **IBM Carbon** | *„Each page should have only one primary button."* (kivétel: a lapon belül indított külön folyamat, aminek saját elsődlegese van) |
| **GOV.UK Design System** | *„Avoid using multiple default buttons on a single page."* · *„Pages with too many calls to action make it hard for users to know what to do next."* |
| **Atlassian Design System** | *„MUST use `primary` for more than one action per section. If you feel tempted to, one of them is probably `default`."* (azaz: szekciónként egy) |
| **Material Design 3** | öt gomb-típus emelkedő hangsúllyal (text → outlined → tonal → filled/elevated); a `filled` a képernyő fő cselekvése |

**A Kineticare gomb-skálája** (a jelenlegi `src/components/ui/Button.tsx`
variánsokkal, kiegészítve):

| Szint | Változat | Vizuális nyelv | Mikor | Külföldi megfelelő |
|---|---|---|---|---|
| 1. elsődleges | `primary` | akcent-mély kitöltés, fehér szöveg | **Az oldal EGYETLEN fő célja.** Kurzusoldalon: vásárlás. Pénztáron: megrendelés. Űrlapon: beküldés. | Carbon *primary*, GOV.UK *default*, M3 *filled* |
| 2. másodlagos | `secondary` | 2 px ink keret, átlátszó háttér | Valódi alternatíva ugyanazon a képernyőn (pl. „Tovább a kurzusaimhoz"), vagy támogató cselekvés | Carbon *secondary*, GOV.UK *secondary*, Atlassian *default* |
| 3. harmadlagos | `ghost` | aláhúzott szöveglink-jelleg | Alacsony súlyú, nem versengő ajánlat (hero másodlagos link, „Kinek való?" horgony) | Carbon *ghost*, M3 *text*, Atlassian *subtle* |
| 4. **destruktív** | `danger` **(HIÁNYZIK – pótolandó)** | veszély-token kitöltés/keret | Visszafordíthatatlan következmény: visszatérítés, hozzáférés visszavonása, rekord törlése | Carbon *danger*, GOV.UK *warning* |

> **Nyitott hiány:** a repóban ma **nincs** destruktív gomb-változat
> (`src/components/ui/Button.tsx:29` – csak `primary | secondary | ghost`), így
> az admin visszatérítés-panel ugyanolyan gombot használ, mint egy mentés.
> Carbon: a *danger* változat *„For actions that could have destructive effects
> on the user's data"*; GOV.UK: *„Warning buttons are designed to make users
> think carefully before they use them. They only work if used very sparingly"*,
> és kizárólag *„actions with serious destructive consequences that cannot be
> easily undone"* esetén. **→ A/8 megállapítás.**

**Mennyi CTA lehet egy oldalon?**

- **K-1.** Oldalanként **pontosan 1** `primary` gomb-példány. (A ragadós
  vásárlódoboz + a mobil ragadós sáv **egy** példánynak számít: sosem látszanak
  egyszerre – `MobileBuyBar` IntersectionObserverrel váltja őket.)
- **K-2.** Hosszú, szekciókra bontott lapon (kezdőlap) **szekciónként legfeljebb
  1** `primary`, és az oldal egészén legfeljebb 2 – az egyik mindig az üzleti
  cél-hierarchia 1. helyezettjéé (kurzus-értékesítés,
  `ertekesitesi-ux-skill.md` 1. pont).
- **K-3.** Az ingyenes lead-magnet CTA-ja **soha nem `primary`** (K2-hiba,
  `ux-hierarchia-audit.md`) – ma helyesen `secondary` (`FreeSos.tsx:95`).
- **K-4.** A gomb-csoportban a gombok sorrendje: elsődleges → másodlagos →
  harmadlagos, balról jobbra (GOV.UK: *„Use a button group when two or more
  buttons are placed together"*).

### 2.3 Gomb-állapotok – a teljes, kötelező lista

NN/g öt fő + két további állapotot nevez meg, és kimondja a legfontosabbat:
*„stick to the stroke or outline to indicate focus, as opposed to relying on
color change alone"*, illetve hogy a megkülönböztetés **soha nem alapulhat
egyedül színen**. (Button States: Communicate Interaction)

| # | Állapot | Kötelező vizuális jelölés | Kötelező szemantika | Forrás |
|---|---|---|---|---|
| 1 | **default / enabled** | teljes kontraszt, olvasható felirat | – | NN/g |
| 2 | **hover** | háttér sötétedik/telítettebb; kurzor `pointer` | – | NN/g (150–200 ms késleltetés ajánlott a véletlen kiváltás ellen) |
| 3 | **focus (focus-visible)** | **körvonal/keret** (nem csak szín), ≥ 2 CSS px vastag perem, ≥ 3:1 kontraszt a fókuszált és nem fókuszált állapot között | natív fókusz megőrizve | WCAG **2.4.7 (AA)**, **2.4.13 Focus Appearance (AAA)**, NN/g |
| 4 | **active / pressed** | színváltás vagy minimális animáció, **100–150 ms-en belül** megjelenik | – | NN/g |
| 5 | **disabled** | csökkent kontraszt/telítettség **+ magyarázó szöveg** a gomb mellett | `disabled` (`<button>`) **vagy** `aria-disabled="true"` **valódi widget-szerepű elemen** | NN/g: *„Disabled button states should also have the ARIA-disabled: true attribute added"* |
| 6 | **loading / folyamatban** | jelölő (spinner vagy pont-animáció) **+ a felirat folyamatot mond** | `aria-busy="true"` vagy élő régió; a gomb nem kattintható újra | NN/g (Loading state); Carbon (*Loading* állapot inline indikátorral); NN/g 1. heurisztika (*Visibility of system status*) |
| 7 | **selected / toggled** | tartós, nem csak színbeli jelölés | `aria-pressed` / `aria-current` | NN/g |
| 8 | **visited** *(csak LINKNÉL)* | megkülönböztethető a nem látogatottól | – | `termektervezes` skill 4. pont; NN/g: a látogatott link jelölése a navigáció alapszolgáltatása |

> **A skill 4. pontja mind a hetet (linknél nyolcat) végiggondoltatja:**
> *„alap, hover, focus-visible, active, disabled, folyamatban (küldés alatt),
> és – linknél – látogatott."* A **folyamatban** állapot itt nem díszítés:
> *„enélkül a felhasználó kétszer küldi be az űrlapot."*
> A **letiltott gomb mellett mindig áll szöveges magyarázat**, hogy miért nem
> használható (2.7 és Á-3).

**Külön szabályok:**

- **Á-1.** A `focus-visible` gyűrű kontrasztja **minden** háttéren ≥ 3:1
  (WCAG 1.4.11). A repó ezt sötét sávon a `--kc-color-focus-on-dark` fehérre
  váltással már megoldja (`ui.css:60–64`) – ez a minta a mérce.
- **Á-2.** **A ragadós elem nem takarhatja el a fókuszált gombot** – WCAG 2.2
  **2.4.11 Focus Not Obscured (Minimum), AA**: *„When a user interface component
  receives keyboard focus, the component is not entirely hidden due to
  author-created content."* A `scroll-padding` a **ragadós fejléc + ragadós
  vásárlósáv összegére** méretezendő.
- **Á-3.** **Letiltott gomb helyett inkább ne legyen gomb.** Ha a cselekvés nem
  végezhető el (archivált kurzus), a helyes megoldás nem a szürke „Megveszem",
  hanem **a cselekvés eltávolítása + magyarázó mondat**. A GOV.UK
  hibaüzenet-elve („mondd meg, mi történt és hogyan orvosolható") ide is áll.
- **Á-4.** A letiltott állapot **`<span aria-disabled>` alakban nem érvényes**:
  az `aria-disabled` csak widget-szerepű elemen (`role="button"`/`role="link"`)
  kerül a kisegítő technológia felé. **→ A/3 megállapítás.**

### 2.4 Méret és érintési célfelület

| Norma | Érték | Szint / forrás |
|---|---|---|
| WCAG 2.2 **2.5.8 Target Size (Minimum)** | *„at least 24 by 24 CSS pixels"* | **AA – abszolút alsó határ** |
| WCAG 2.2 **2.5.5 Target Size (Enhanced)** | 44 × 44 CSS px | AAA |
| **Apple HIG** | 44 × 44 pt (visionOS: 60 × 60 pt) | iOS/iPadOS/macOS |
| **Android / Material** | *„at least 48dp×48dp. Larger is even better."* | Android |

**A Kineticare-szabály: minden gomb és menüpont ≥ 44 × 44 CSS px.**
(A `kc-button` ma `min-height: 2.75rem` = 44 px minden méretben – ez marad; a
`--sm` változat csak a belső térközt szűkíti, `ui.css:256–261`.)

**A 24 px-es AA-minimum kivételei** (WCAG 2.5.8, öt mentesség – ezeket
ismerni kell, mert a folyószövegbeli hivatkozásainkra vonatkoznak):
*Spacing* (a cél köré rajzolt 24 px átmérőjű kör nem metsz másik célt) ·
*Equivalent* (ugyanaz a funkció máshol elérhető megfelelő mérettel) ·
*Inline* (mondaton belüli, sormagasság-kötött hivatkozás) ·
*User agent control* · *Essential*.

**Következmény nálunk:** a folyószövegbeli `kc-text-link` mentesül (*Inline*),
de a szűrő-chipek, a lapozó, a kártyák és a lábléc-linkek **nem** – azokra a
44 px érvényes.

### 2.5 Ikonok a gombokon

- **I-1.** Az ikon **kiegészít, nem helyettesít**. Carbon: az ikonok
  *„must be directly related to the action that the user is taking"*.
- **I-2.** **Az ikon a felirat JOBB oldalán áll** (Carbon:
  *„Icons should always appear to the right of the label"*). A repó nyíl-glifái
  (`→`) ezt követik.
- **I-3.** A dekoratív ikon/glifa **`aria-hidden="true"`**, és **nem része** a
  hozzáférhető névnek. (A repó ezt következetesen csinálja – `ProductCard`,
  `CourseCards`, `FreeSos`.)
- **I-4.** **Csak ikonból álló gombhoz kötelező a szöveges név** (tooltip vagy
  `aria-label`): Carbon – *„A tooltip is always required"* ikon-only gombnál.
- **I-5.** **Destruktív gomb sosem lehet csak ikon** (Carbon: *„Danger buttons
  cannot be used in an icon only form"*).
- **I-6.** A látható feliratnak **benne kell lennie** a hozzáférhető névben
  (WCAG 2.2 **2.5.3 Label in Name, A**). A repó lejátszó-navigációja ezt
  dokumentáltan betartja (`src/components/account/player/navigation.ts:95`).

### 2.6 Betöltés, folyamatban állapot és a dupla küldés

**Miért kötelező:** NN/g 1. heurisztikája – *„The design should always keep
users informed about what is going on, through appropriate feedback within a
reasonable amount of time."* A fizetés-indítás és a beküldés lassú, hálózatfüggő
művelet; visszajelzés nélkül a látogató **újra kattint**, és duplán rendel.

**Szabályok:**

- **L-1.** Beküldő gomb a kérés indulásakor **azonnal letiltódik**, és a
  felirata folyamatot mond (magyar mikroszöveg, 3.1: **három pont, nem
  gondolatjel** – „Feldolgozás…", nem „Feldolgozás —").
  *A repó ezt ma helyesen csinálja* (`LoginForm.tsx:74`, `CheckoutForm.tsx:360`,
  `ContactForm.tsx:293`, `NewsletterForm.tsx:154`).
- **L-2.** A kliensoldali védelem **nem elég**. GOV.UK a
  `data-prevent-double-click` attribútumhoz kiköti, hogy az JS-t igényel és
  *„should complement server-side protections against repeated submissions"*.
  → A dupla küldés ellen **szerveroldali idempotencia** is kell (a
  checkout-láncban ez ma megvan, a rendelés-snapshot és a Barion-állapotgép
  szintjén).
- **L-3.** A folyamat vége **be legyen jelentve**: `role="status"` /
  `aria-live="polite"` a siker, `role="alert"` / `aria-live="assertive"` a hiba
  esetére. (A `CheckoutErrorRegion` ezt mintaszerűen oldja meg: **mindig
  renderelődik**, üresen is, mert a dinamikusan beszúrt élő régiót több
  képernyőolvasó megbízhatatlanul jelenti be –
  `src/components/checkout/CheckoutForm.tsx:79–105`.)
- **L-4.** A gomb szélessége **ne ugorjon** a felirat cseréjekor (Atlassian:
  a state-váltás nem okozhat elrendezés-ugrást). Gyakorlat: `min-width` a
  leghosszabb feliratra.

### 2.7 Hibakezelés és űrlaphibák

**Melyik WCAG-kritérium:**
**3.3.1 Error Identification (A)** · **3.3.2 Labels or Instructions (A)** ·
**3.3.3 Error Suggestion (AA)** · **3.3.4 Error Prevention (Legal, Financial,
Data) (AA)** · **3.3.7 Redundant Entry (A)** · **3.3.8 Accessible
Authentication (Minimum) (AA)**.
A 3.3.4 külön is releváns: a pénztár **jogi és pénzügyi** kötelezettséget
keletkeztet, tehát a beküldés visszavonható, ellenőrizhető vagy megerősíthető
kell legyen.

**GOV.UK hibaüzenet-szabályok** (kötelezőek nálunk is):

- Mondd meg, **mi történt és hogyan javítható** – ne csak azt, hogy hiba van.
- **Mező mellett ÉS** a lap tetején, **hibaösszegzésben** – a két szöveg
  egyezzen.
- Tilos: technikai zsargon (`form post error`, hibakód), a *„forbidden",
  „illegal", „you forgot", „prohibited"* típusú szavak, a **„please"**
  (választást sugall), a **„sorry"** (nem segít), a **„valid/invalid"**, és a
  humor („oops").
- **A beírt adat nem veszhet el.**
- Legyen **helyzetre szabott**: üres mező ≠ rossz formátum ≠ túl hosszú.

**Baymard – az inline validáció időzítése:**

- Validálj **`onblur`-re** (amikor a látogató elhagyja a mezőt), **ne gépelés
  közben**. A korai validáció mérten frusztrál: *„Why are you telling me my
  email address is wrong, I haven't had a chance to fill it all out yet!"*
- **Újraellenőrzés viszont billentyűleütésenként:** a hiba **azonnal tűnjön el**,
  amint a bevitel helyessé válik – ne várjon a következő `blur`-re.
- **31 %** az oldalak aránya, amelyeknél egyáltalán nincs inline validáció;
  további **4 %** rosszul csinálja.
- **Adaptív hibaüzenet:** a szöveg a *konkrét* megsértett szabályt mondja meg.
  Rossz: „Provide a valid phone number." Jó: „Phone Number is too short."
  Rossz: „This email is invalid." Jó: „This email address is missing part of the
  domain (such as '.com')."
  **Csak 2 %** az oldalak aránya, amely ezt használja – nálunk kötelező.

**Magyar minta-átültetés** (a `kapcsolat/_lib/validation.ts` már ezt a nyelvet
beszéli, ez a mérce):

| Helyzet | Jó (kötelező) | Rossz (tiltott) |
|---|---|---|
| üres mező | `Add meg az e-mail-címed.` | `Ez a mező kötelező.` |
| rossz formátum | `Az e-mail-cím @ jel nélkül nem teljes (pl. nev@pelda.hu).` | `Érvénytelen e-mail-cím.` |
| túl rövid | `Az irányítószám 4 számjegy.` | `Hibás irányítószám.` |
| szerverhiba | `A fizetés indítása most nem sikerült. Próbáld újra néhány perc múlva.` | `Váratlan hiba történt. Kérjük, próbáld újra később.` |

> **Miért tiltott a „Kérjük"?** GOV.UK: a *please* választást sugall ott, ahol
> nincs választás. Magyarul ugyanez: a „Kérjük, próbáld újra" udvariaskodik,
> miközben a látogatónak nincs más lehetősége. **→ A/9 megállapítás.**

---

## 3. Magyar mikroszöveg és CTA-szótár

### 3.1 Magyar mikroszöveg-szabályzat

Ez a szakasz a tulajdonos konkrét kifogására válaszol: az **„AI-szagú"
gondolatjel-halmozásra**. A szabály nem ízlés kérdése – a magyar helyesírás és a
magyar tipográfia is szűken határolja a gondolatjel dolgát.

#### 3.1.1 Melyik jel melyik – a karakterek

| Jel | Unicode | Név | Szóköz | Mire való |
|---|---|---|---|---|
| `-` | U+002D | **kiskötőjel** (divisz) | nincs | szóösszetétel, toldalékolás, elválasztás – `e-mail-cím`, `SOS-kurzus`, `WCAG-kritérium` |
| `–` | U+2013 | **nagykötőjel** (félkvirtmínusz) | **nincs** | „valamitől valameddig", két tulajdonnév/nép kapcsolata – `2020–2024`, `magyar–finn`, `Budapest–Debrecen` (AkH. 264.) |
| `–` | U+2013 | **gondolatjel** – **ugyanaz a karakter** | **van, mindkét oldalán** | közbevetés, párbeszéd, elkülönülő gondolatsor |
| `—` | U+2014 | kvirtmínusz (em dash) | *nem értelmezett* | **MAGYAR SZÖVEGBEN NEM HASZNÁLJUK** (angolszász jel) |
| `−` | U+2212 | mínuszjel | van (műveleti jelként) | matematikai előjel/művelet |

> **A kritikus tétel.** ELTE, *Szabadbölcsészet – Szedés, mikrotipográfia*:
> *„a jelenlegi gyakorlatban magyar szövegekben az angol m-dash (kvirtmínusz)
> írásjelként nem használt"*, és *„a gondolatjel és a nagykötőjel a mai magyar
> használatban azonos karakter (félkvirtmínusz)"*; továbbá
> *„a gondolatjelet szóközök veszik körbe, a nagykötőjelet… nem"*.
> Ugyanezt mondja ki a magyar tipográfiai gyakorlat összefoglalója is:
> a gondolatjel az en dash, mert **a magyar gondolatjel szóközös**, és a
> kvirtmínusz szóközökkel „túl nagy lyukat támaszt a szedésben".

**→ A repóban ma 4688 db `—` (U+2014) és 391 db `–` (U+2013) áll. Az arány
fordítva helyes. → A/2 megállapítás.**

#### 3.1.2 Mikor szabad gondolatjelet írni

A gondolatjelnek **négy** dolga van (A magyar helyesírás szabályai, 12. kiadás):

1. **Elkülönülő gondolatsorok** elválasztása (AkH. 246–247.).
2. **Közbevetés** jelölése (AkH. 249. b), 251–253.) – pl. *„Az ablak –
   természetesen – nyitva volt."*
3. **Idézés** kapcsolása (AkH. 257. b), c), 260.).
4. **Párbeszéd** soraiban (AkH. 259.).

**Minden más használat hiba.** Konkrétan **tilos**:

- gomb-, menü-, badge-, mezőfelirat **elválasztójaként** („Ingyenes – azonnal
  eléred");
- `aria-label`-ben elválasztóként („Kineticare — kezdőlap");
- definíció-jelként vagy kettőspont helyett („Ár — 79 500 Ft");
- felsorolás-elemek összekötésére;
- kódkommentben és doksiban **stilisztikai töltelékként** (ez ugyan nem
  látogatói szöveg, de innen szivárog át a felületre).

#### 3.1.3 Mivel helyettesítsd

| Ha ezt akartad | Ezt írd helyette | Alap |
|---|---|---|
| közbevetés | **vessző** – ez az alapeset, a gondolatjel a kivétel | AkH. 249. |
| magyarázat, következtetés | **kettőspont**: „a tagmondat fontosabb magyarázatot vagy következtetést tartalmaz" | AkH. 245., 268–269. |
| felsorolás bevezetése | **kettőspont** | AkH. 268. |
| két önálló állítás | **pont** (két mondat) – rövidebb mondat, jobb olvashatóság | NN/g F-mintázat; `ux-belso-oldalak-kutatas.md` B8.2 |
| mellékes megjegyzés | **zárójel** | AkH. |
| címke + érték („Ár", „Hozzáférés") | **kettőspont** vagy külön elem | AkH. 268. |
| „folyamatban" jelzés | **három pont (…)**, nem gondolatjel | konvenció; a repó már így csinálja |

**Sűrűség-korlát (kikényszeríthető):**

- **Gomb-, menü-, címke- és `aria-label`-szövegben: 0 gondolatjel.**
- Folyószövegben: legfeljebb **1 gondolatjel 200 szavanként**, és soha nem kettő
  egy bekezdésben. (Nincs rá kutatási forrás, ezért **konvenciónak jelölve** –
  lásd 7.4.)

#### 3.1.4 Hogyan írunk magyar CTA-t

**A nemzetközi konszenzus** (mind a négy nagy rendszer ugyanazt mondja):

| Forrás | Szabály |
|---|---|
| **IBM Carbon** | *„{verb} + {noun}"* – kivéve a bevett rövid parancsokat (*Done, Close, Cancel, Add, Delete*). Alap: **mondatkezdő nagybetű** (sentence case). |
| **Shopify Polaris** | ugyanaz a `{ige}+{főnév}` képlet; *„lead with a strong verb"*; **névelő nélkül**: „Add menu item", nem „Add a menu item"; kerüld a semmitmondó igéket (*View, Go, Read*). |
| **Atlassian** | felszólító, jelen idejű ige; **tilos**: *Submit*, *OK*, *Click here*; sentence case. |
| **GOV.UK** | ige + tárgy, tömören: *Start now*, *Save and continue*, *Sign in*, *Pay*. |
| **NN/g** | *„Lead with verbs or verb phrases that clearly outline what will happen"*; *„no more than 2–4 words"*; *„Users shouldn't have to Google a command name"*; a márkanevek kerülendők a parancsszövegben. |

**A négy S (NN/g, Better Link Labels):**
**Specific** (mit talál a kattintás után) · **Sincere** (az ígéret azonnal
teljesül) · **Substantial** (a környező szöveg nélkül is érthető) ·
**Succinct** (nincs felesleges szó).

**Amit a kutatás kifejezetten büntet:** a homályos CTA. NN/g mérése a
„Get Started"-ről: *„The phrase Get Started is ambiguous and can apply to almost
any goal that a user might have"*, és mágnesként vonzza a figyelmet a
relevánsabb tartalomról. A résztvevő szava:
*„I don't really want to sign up for something until I know what it is."*

**A Kineticare magyar CTA-szabálya:**

- **M-1. Ige + tárgy.** A gomb **cselekvést** nevez meg, nem állapotot és nem
  ígéretet. Rossz: „Ingyenes — azonnal eléred" (ez állapot + ígéret).
  Jó: „Megveszem a kurzust" / „Elindítom ingyen". A **deverbális főnévi alak**
  („Üzenet küldése", „Jelszó beállítása") gyengébb: nem cselekvést mond ki,
  hanem megnevez egy dolgot. Kivétel csak a bevett, egyszavas felületi címke
  (M-2/P-1 alább).
- **M-2. Nyelvtani személy: a P-1 szabály szerint** (vezetői döntés,
  2026-08-16 – lásd 1.4/Ü5). Röviden: a látogató **saját, elkötelező**
  cselekvését kimondó gomb **E/1**, a puszta **navigáció E/2** (tegező), a
  bevett egyszavas címke **főnévi**. A magyarázó és útmutató szöveg mindig
  tegez – a GOV.UK elve (*„write like you're talking to your user
  one-on-one"*) itt érvényesül; a repó szövegei (`Add meg a neved.`,
  `Írd meg az üzeneted.`) már ezt a hangot viszik.
- **M-3. Rövidség: 1–4 szó** (NN/g: 2–4 szó; Carbon: nem tördeljük, nem
  csonkítjuk). Ez **kikényszerített**: a G-UI1 őr minden szótári feliratot
  megszámol.
- **M-4. Mondatkezdő nagybetű** (sentence case) – verzál csak CSS-transzformáció
  lehet, a DOM-szöveg soha (a `Header` wordmark mintája).
- **M-5. Névelő nélkül**, ha attól nem sérül a magyar mondat („Kurzus
  megnyitása", nem „A kurzus megnyitása").
- **M-6. Márkanév nem kerül gombra** (NN/g), kivéve ahol a fizetési szolgáltató
  megnevezése jogilag/bizalmilag szükséges („Fizetés Barionnal").
- **M-7. Tilos a PUSZTA, célt nem nevező felirat:** „Tovább", „Küldés"
  (Atlassian: *Submit* tilos), „OK", „Mehet", „Kattints ide", „Bővebben",
  „Részletek" – önmagában, kiegészítés nélkül. **Pontosítás (1.1):** a tilalom
  a *puszta* alakra vonatkozik, nem a szó puszta előfordulására: a „Tovább"
  azért tilos, mert nem mondja meg, mi történik (NN/g „Get Started"). Ha a
  felirat megnevezi a célt vagy a cselekvést, a szó nem tilos önmagában – de a
  §3.2 szótárban akkor is a **konkrétabb, ige-kezdetű** alak nyer
  („Menj a pénztárhoz", nem „Tovább a pénztárhoz"), mert a NN/g „Succinct"
  a másik három S után jön, nem előttük.
- **M-8. Ígéret helyett cselekvés.** „Azonnal eléred", „Örökre a tiéd",
  „Garantált eredmény" nem gomb-szöveg – ezek állítások, amiket a törzsszöveg
  hordoz, és amiket bizonyítani kell.

#### 3.1.5 P-1 – a nyelvtani személy eldöntött szabálya

**Státusz: ELDÖNTVE, 2026-08-16.** Normatív forrás:
`.claude/skills/termektervezes/SKILL.md` 2. pont; a döntés indoklása és a
mérési háttere az 1.4/**Ü5** pontban. Ez a szakasz a szabály **alkalmazható**
alakja, ami a §3.2 minden sorát megmagyarázza.

| Eset | Személy | Példa | Miért |
|---|---|---|---|
| **P-1a.** A látogató **saját, elkötelező** cselekvése: pénzügyi, adat- vagy hozzáférés-következménnyel jár, vagy megváltoztat valamit a látogató dolgaiban (rendelés, kosár, fiók, feliratkozás, jelszó, letöltött fájl, süti-döntés) | **E/1** | `Megveszem a kurzust` · `Megrendelem és fizetek` · `Elindítom ingyen` · `Feliratkozom` · `Elküldöm az üzenetet` · `Kiveszem a kosárból` · `Kérem a visszaállító linket` · `Beállítom az új jelszót` · `Letöltöm a számlát` · `Újrapróbálom` | A vezetői döntés (Ü5) + a régi oldal 100 %-os E/1 mintája (Jakob törvénye, mérve) |
| **P-1b.** Puszta **navigáció**: a kattintás után csak *máshol vagyok*, semmi nem változik | **E/2** (tegező) | `Nézd meg a kurzusokat` · `Nyisd meg a kurzusaidat` · `Folytasd a kurzust` · `Kezdd el a kurzust` · `Menj a pénztárhoz` · `Vissza a kurzusokhoz` | A vezetői döntés második fele; a navigáció nem a látogató „vállalása", hanem útmutatás |
| **P-1c.** Bevett, **egyszavas** felületi címke | **főnévi** | `Belépés` · `Regisztráció` | Az Ü5 kivétele; Carbon és Polaris ugyanígy mentesíti a bevett rövid parancsokat (*Done, Close, Cancel*) a `{ige}+{főnév}` képlet alól |
| **P-1d.** **Folyamatban**-felirat (a rendszer állapota, nem a látogató cselekvése) | **semleges, deverbális + „…"** | `Belépés…` · `Regisztráció…` · `Küldés…` · `Mentés…` · `Feldolgozás…` · `Betöltés…` | Ez **rendszerállapot-üzenet** (NN/g 1. heurisztika; WCAG 4.1.3), nem CTA – ezért nem személyragozzuk. A `Megveszem…` alak értelmetlen lenne. |
| **P-1e.** **Magyarázó, útmutató, hibaszöveg** | **E/2** (tegező) | `Add meg a neved.` · `Ez a kurzus jelenleg nem vásárolható meg.` | GOV.UK: *„write like you're talking to your user one-on-one"* |

**A határeset eldöntése egy kérdéssel:** *a kattintás után változik-e bármi a
látogató dolgaiban (rendelés, fiók, kosár, feliratkozás, fájl), vagy csak
máshol lesz?* Ha változik → **E/1**. Ha csak máshol lesz → **E/2**.
Az elem *technikai típusa* (gomb vagy link) ezt **nem** dönti el: a
„Megveszem a kurzust" a kódban `<Link>`, mégis elkötelezés – a §2.1 gomb/link
szabálya a *szemantikáról* szól, nem a felirat személyéről.

**→ Ez váltja fel a korábbi, kizárólag E/2-t előíró M-2-t. Az A/5 megállapítás
(vegyes személy) továbbra is hiba – de mostantól a P-1 mondja meg, melyik
elemen melyik a helyes, nem az egységesítés iránya nyitott kérdés.**

### 3.2 CTA-szótár – jóváhagyott magyar feliratok

> ✅ **A nyelvtani személy 2026-08-16-án ELDŐLT** (1.4/Ü5). A táblázat a
> **P-1 szabály** szerint íródott: a látogató saját, elkötelező cselekvése
> **E/1** („Megveszem a kurzust"), a puszta navigáció **E/2** („Nézd meg a
> kurzusokat"), a bevett egyszavas címke **főnévi** („Belépés"), a
> folyamatban-felirat **semleges** („Küldés…"). A döntés normatív forrása a
> `.claude/skills/termektervezes/SKILL.md` 2. pontja; a mérési háttér a régi
> `www.kineticare.hu` 100 %-os E/1 mintája
> (`docs/regi-oldal-osszehasonlitas.md` 3.4).
>
> **A táblázat innentől kódba van öntve:** `src/lib/cta-vocabulary.ts`, a
> **G-UI1** őrrel (`src/__tests__/cta-vocabulary-guard.test.ts`). Ez a táblázat
> és a modul **bitre egyezik** – az őr ezt ellenőrzi, nem emberi figyelem.
> A `docs/gomb-inventar.md` §5 ugyanezeket a feliratokat *képezi le* a mért
> állapotra; ott sem lehet más felirat.

**Használati szabály:** ugyanaz a cselekvés **mindig ugyanezzel a szóval**
jelenik meg, az egész oldalon (WCAG 3.2.4, lásd 5. szakasz). Új felirat csak
akkor kerülhet be, ha **ez** a táblázat bővül – vele együtt frissül a
`src/lib/cta-vocabulary.ts` és a `docs/gomb-inventar.md` §5 leképezése.
(A skill 2. pontja ezt a §-t nevezi meg a szótár egyetlen normatív helyeként;
a `gomb-inventar.md` leltár, nem szótár.)

**Megvalósítás:** a szótár egyetlen modulban él konstansként
(`src/lib/cta-vocabulary.ts`), és onnan olvas a `resolveCourseCta`, a
`course-list-order.ts`, a `ThankYouView`, a `CartView`, a `penztar/page.tsx` és
a többi hívóhely.

**A hívóhelyek átírása 2026-08-18-án MEGTÖRTÉNT.** A 2026-08-17-i audit 136 élő
gombfeliratot mért, ebből **67 tért el** ettől a táblázattól; a termék-oldali őr
(**G-UI2**, `src/__tests__/cta-a-termekben.test.ts`) kivétel-listája 96 sorral
indult. A javítás után **42 sor** maradt; 2026-08-27-én a maradék **egyetlen**
szótár-eltérés (`CartView` „Belépés a fizetéshez") is a §3.2 #21 alakra
javult. A táblázat ugyanebben a körben
**#28–#38** sorokkal bővült, a L-1 lista hatról hét elemre, a mintázatos sorok
(#14, #15, #23) pedig gépi alakot is kaptak — lásd a **C-6** blokkot a táblázat
alatt.

**Két őr védi, és a kettő KÜLÖNBÖZŐ dolgot mér.** A **G-UI1**
(`cta-vocabulary-guard.test.ts`) három fájlt olvas: ezt a táblázatot, a
`gomb-inventar.md` §5-öt és a kódbeli szótárt — vagyis a *szótár* és a *doksik*
egyezését. A **G-UI2** a TERMÉK forrásából olvassa ki a vevőnek megjelenő
feliratokat (303 fájl, a TypeScript fordító elemzőjével), tehát azt méri, hogy a
felületen tényleg a jóváhagyott alakok állnak-e. Egyik sem helyettesíti a
másikat.

**2026-09-05, szűk helyi vezérlőkivétel (tulajdonosi jóváhagyás):** kizárólag a
`src/components/blocks/LogoRail.tsx` két felirata, `Elindítom a logósort` és
`Megállítom a logósort`, `nem-cta` kivételt kap a G-UI2-ben. A kapcsoló csak
helyi, véges logógörgetést indít vagy szüneteltet; nem értékesítési CTA, nem
navigáció és nem kurzuslejátszás. A kivétel felirat + fájl párra pontos, nem
általános indítás/leállítás minta. A lista és a felső korlát **43 → 45**;
a §3.2 értékesítési szótára és a `cta-vocabulary.ts` ettől nem bővül.

**Ami a döntéstől FÜGGETLENÜL kötelező** (ezért több sor akkor is változik, ha
a személy egyébként stimmel): egy cselekvésre egy felirat (WCAG 3.2.4); a
felirat legyen igaz (ingyenes terméken „Megveszem" tilos); nulla töltelék
gondolatjel (3.1.2); a puszta „Tovább…" nem CTA (M-7); a deverbális főnévi alak
gyengébb az igei alaknál (M-1); archivált terméknél nincs letiltott gomb, hanem
magyarázó mondat (#16).

| # | Eset | **Jóváhagyott felirat** | P-1 | Változat | Miért ez – forrás |
|---|---|---|---|---|---|
| 1 | **Fizetős kurzus vásárlása** (kurzusoldal, buybox) | `Megveszem a kurzust` | E/1 (P-1a) | `primary` | Elkötelezés, tehát E/1 (Ü5-döntés; a régi oldal `MEGRENDELEM`/`KÉREM A PROGRAMOT` mintája). A puszta „Megveszem" **tárgy nélkül** áll: Carbon és Polaris `{ige}+{főnév}` képlete a tárgyat kéri, NN/g „Substantial" szerint a felirat a környezete nélkül is érthető legyen – egy kosár- vagy listaoldalon a „Megveszem" magában nem az. *(Ma: „Megveszem".)* |
| 2 | **Vásárlás a pénztáron** (beküldő gomb) | `Megrendelem és fizetek` | E/1 (P-1a) | `primary` | GOV.UK a fizetés lépésére *„Pay"*-t, a záró lépésre *„Confirm and send"*-et ír elő: a felirat mondja ki, hogy **ez a visszavonhatatlan lépés**. Baymard: a homályos „Continue" helyett explicit „Place Order". A régi oldal ugyanezt a szót használta: `MEGRENDELEM`. **Egyetlen felirat, nincs alternatíva** (a korábbi „vagy `Fizetés Barionnal`" maga sértette a C-1-et). A Barion megnevezése **bizalmi elem, de nem a gombon**: a szolgáltató neve és logója a gomb *mellé* kerül (M-6 megengedi, nem kötelezi). *(Ma: „Megrendelés és fizetés" – deverbális főnévi alak.)* |
| 3 | **INGYENES kurzus igénylése** | `Elindítom ingyen` | E/1 (P-1a) | `secondary` | Hozzáférést szerez, tehát elkötelezés → E/1; a SKILL.md 2. pontjának szó szerinti példája. **A jelenlegi „Ingyenes — azonnal eléred" háromszorosan hibás:** nem ige, U+2014-et használ elválasztóként (3.1.1–3.1.2), és ígéretet tesz (M-8). Az ingyenesség **badge-ként**, nem a gombban jelenik meg (a `Badge tone="success"` már így működik). A `secondary` súly kötelező (K-3, K2-hiba). |
| 4 | **Ingyenes anyag a kezdőlapon** (FreeSos sáv) | `Elindítom ingyen` | E/1 (P-1a) | `secondary` | Azonos cselekvés = azonos szó (WCAG 3.2.4). *(Ma: „Elindítom az ingyenes kurzust" – jó személy, de 4 szó és eltér a #3-tól.)* |
| 5 | **Belépés** | `Belépés` | főnévi (P-1c) | `primary` az auth-oldalon | Bevett, egyszavas címke – az Ü5-döntés kivétele; Carbon és Polaris ugyanígy mentesíti a bevett rövid parancsokat (*Done, Close, Cancel*) a `{ige}+{főnév}` képlet alól; GOV.UK: *Sign in*. Folyamatban: `Belépés…` *(Ma is ez.)* |
| 6 | **Regisztráció** | `Regisztráció` | főnévi (P-1c) | `primary` a regisztrációs oldalon | **1.1-ben módosítva** (korábban `Fiók létrehozása`). Ugyanaz a P-1c kivétel, mint a #5-nél: a „Belépés" és a „Regisztráció" **egymás párja**, egyszavas, bevett felületi címke, és a nav-menü is így nevezi (WCAG 3.2.4 – a menüpont és a beküldő gomb ne mondjon mást). Az E/1-es alternatíva („Létrehozom a fiókom") itt hosszabb és a párját elrontja. Folyamatban: `Regisztráció…` *(Ma is ez.)* |
| 7 | **Kurzus folytatása** (fiók, kurzuslista) | `Folytasd a kurzust` | E/2 (P-1b) | `primary` a kártyán, `secondary` a listafejben | Puszta navigáció (a lejátszó megnyílik, semmi nem változik) → E/2. Ige + tárgy; a folytatás ≠ indítás, ezért külön felirat (NN/g: a parancsnév legyen megkülönböztető). |
| 8 | **Kurzus megkezdése** (még el nem kezdett) | `Kezdd el a kurzust` | E/2 (P-1b) | `primary` | Ua. Megkülönböztetendő a #3-tól: ott a hozzáférés *keletkezik* (E/1), itt a meglévő kurzus *megnyílik* (E/2). |
| 9 | **Megvásárolt kurzushoz ugrás** (kurzusoldalról, köszönőoldalról) | `Nyisd meg a kurzusaidat` | E/2 (P-1b) | `secondary` | **1.1-ben módosítva** (korábban `Ugorj a kurzusaidhoz`). Két ok: (a) az „Ugrás" szót a felület már a skip-linkre használja („Ugrás a tartalomra") – C-4 szerint egy szó egy jelentés; (b) a „Nyisd meg" konkrétabban mondja meg, mi történik (NN/g „Specific"). Szándékosan **nem** hasonlít a #10-re („kurzusokat" ↔ „kurzusaidat" különbsége önmagában kevés lenne). *(Ma: „Kurzusaim", „Tovább a kurzusaimhoz", „Nézd meg a kurzusaimat", „Vissza a kurzusaimhoz" – négy felirat egy cselekvésre.)* |
| 10 | **Kurzuskínálat megtekintése** (hero, nav, szekció-láb, üres állapotok) | `Nézd meg a kurzusokat` | E/2 (P-1b) | hero: `primary`; nav: `secondary`; szekció-láb: szöveglink | **Egyetlen felirat a mai nyolc helyett.** Ma: „Kurzusok" (nav), „Kurzusok megtekintése" (hero), „Összes kurzus megtekintése" (szekció-láb), „Megnézem a kurzusokat" (CMS), „Megnézem a programot" (kártya), „Nézd meg a kurzusainkat" (üres kosár), „Válassz kurzust" (üres pénztár), „Kurzusok megnézése" (üres kurzusaim) – WCAG **3.2.4** sérülés. **→ A/6.** A nav-elem kivétel: ott a menüpont neve `Kurzusok` marad (menücímke, nem CTA – N-3). |
| 11 | **Kurzus részleteihez** (kártya) | *(nincs gomb)* – a kártya egésze link, a jelölő a nyíl + cím | – | dekoráció | NN/g: *„don't make nonclickable items look like buttons"*. **→ A/4.** |
| 12 | **Kapcsolatfelvétel** (űrlap beküldése) | `Elküldöm az üzenetet` | E/1 (P-1a) | `primary` | Adatot küld be, tehát elkötelezés → E/1. **A régi oldal kapcsolat-űrlapján szó szerint `ELKÜLDÖM` állt** (mérve) – Jakob törvénye. Ige + tárgy; a puszta „Küldés"/„Submit" tiltott (Atlassian). *(Ma: „Üzenet küldése" – deverbális főnévi alak.)* Folyamatban: `Küldés…` |
| 13 | **Hírlevél-feliratkozás** | `Feliratkozom` | E/1 (P-1a) | `secondary` | **1.1-ben módosítva** (korábban `Iratkozz fel`). A SKILL.md 2. pontjának szó szerinti példája; feliratkozás = a látogató saját vállalása. Egyszavas, de nem „puszta" felirat: önmagában megmondja, mi történik (NN/g „Specific"). Az e-mail-cím mezője mellett, nem `primary` (nem ez az oldal célja). *(Ma is ez – nem kell kódot írni.)* |
| 14 | **Letöltés** | `Letöltöm a számlát` | E/1 (P-1a) | `secondary` | Fájl kerül a látogató gépére → E/1. **Mintázatos felirat** (C-6): a `Letöltöm a <mit>` séma más dokumentumra is használható (`Letöltöm az igazolást`), a fájl megnevezése **kötelező** – NN/g „Substantial": a felirat a környezete nélkül is érthető legyen. *(Ma: „Számla letöltése".)* |
| 15 | **Vissza-navigáció** | `Vissza a kurzusokhoz` | E/2 (P-1b) | `ghost` / szöveglink | Mintázatos felirat (C-6): mindig `Vissza a <hova>`. NN/g 4 S: a puszta „Vissza" nem „Substantial". A böngésző vissza-gombját **nem** duplikáljuk; ez mindig konkrét célra visz. |
| 16 | **Archivált / nem elérhető termék** | `Ez a kurzus jelenleg nem vásárolható meg.` (magyarázó mondat, **gomb nélkül**) | E/2 magyarázat (P-1e) | – | Á-3: letiltott gomb helyett a cselekvés **eltűnik**, és a szöveg megmondja, miért. GOV.UK: *„Disabled buttons have poor contrast and can confuse some users, so avoid them if possible."* A jelenlegi kód a feliratot meghagyja `Megveszem`-nek egy szürke elemen – hamis ígéret (NN/g: *a link ígéret*). **→ A/1.** |
| 17 | **Hiba utáni újrapróbálkozás** | `Újrapróbálom` | E/1 (P-1a) | `secondary` | **1.1-ben módosítva** (korábban `Próbáld újra`). A művelet (fizetés, mentés, betöltés) újraindítása a látogató vállalása → E/1. Ma három alak él („Újrapróbálom", „Újrapróbálom a fizetést", „Próbáld újra") – **egy marad**. Ahol több újrapróbálható dolog van egy képernyőn, a **hozzáférhető név** kapja a célt rejtett szövegben (a `/kurzusaim` már így csinálja), nem a látható felirat változik (WCAG 2.5.3 + 3.2.4). „Kérjük" nélkül (2.7). |
| 18 | **Beleegyezés-kezelés** (süti-sáv) | `Elfogadom mindet` / `Csak a szükségeseket` | E/1 (P-1a) | egyenrangú `secondary` | A süti-döntés a látogató saját döntése → E/1. A második felirat **elliptikus**: az igét („fogadom el") az első tagból veszi át, így a két gomb azonos hosszú és azonos súlyú marad. Nem lehet dark pattern: az elutasítás **azonos súlyú és azonos szintű**, nem bújtatott szöveglink (`ertekesitesi-ux-skill.md` 6. pont). *(Ma: „Elfogadom" / „Elutasítom" – a súly rendben, a hatókör nem derül ki.)* |
| 19 | **Tétel kivétele a kosárból** | `Kiveszem a kosárból` | E/1 (P-1a) | `ghost` | **Új sor (1.1)** – a `gomb-inventar.md` §5.1 hiánya. A kosár tartalma a látogató dolga → E/1. **Miért nem „Törlés":** Carbon kimondja, hogy a *remove* és a *delete* nem ugyanaz – *„Deletion is the most common type of removal and is destructive"* –, és a helyreállítható műveletre a *remove* alakot írja elő. A kosárból kivett tétel **nem semmisül meg**, bármikor visszatehető, tehát „kivétel", nem „törlés". A tétel megnevezése a **hozzáférhető névbe** kerül rejtett szöveggel (több tétel esetén a puszta „Kiveszem a kosárból" nem egyedi – WCAG 2.4.4). *(Ma: „Törlés" – deverbális főnév, és rossz szó.)* |
| 20 | **Kosárból a pénztárba lépés** | `Menj a pénztárhoz` | E/2 (P-1b) | `primary` | **Új sor (1.1)** – a `gomb-inventar.md` §5.1 hiánya. Itt még **semmi nem történik**, csak odaérünk a pénztárhoz (a vállalás a #2 gombnál van) → E/2. Ige + cél; Baymard szerint a kosár elsődleges CTA-ja legyen explicit és jól megtalálható. *(Ma: „Tovább a penztárhoz" – puszta „Tovább"-kezdés (M-7) **és elgépelés**.)* **Vezetői pontosítás (2026-08-16):** ez a sor és a **#1** (`Megveszem a kurzust`) ugyanarra az útvonalra (`/penztar`) visz, mégis MÁS feliratot visel — ez SZÁNDÉKOS, és nem sérti a WCAG 3.2.4-et. A sikerkritérium azonos *funkciót* kér azonos néven; itt viszont két különböző funkció van: a #1 egy KONKRÉT termékre vállal kötelezettséget (a kurzusoldalról indítja a rendelést), a #20 pedig egy MÁR ÖSSZEÁLLÍTOTT kosarat visz a következő lépésre. Aki később „egységesítené" a kettőt, azzal a kurzusoldali vásárlási szándékot fokozná le puszta navigációvá. |
| 21 | **Jelszó-visszaállító link kérése** | `Kérem a visszaállító linket` | E/1 (P-1a) | `primary` | **Új sor (1.1)** – a `gomb-inventar.md` §5.1 hiánya. E-mail indul a látogatónak → elkötelezés, E/1. **A régi oldal ugyanezt a szerkezetet használta:** `KÉREM A PROGRAMOT`, `KÉREM A HOZZÁFÉRÉST`, `KÉREM AZ ÉRTESÍTÉST` (mérve) – Jakob törvénye. **Figyelem:** ez az E/1-es *„kérem"* ige, nem a 2.7-ben tiltott udvariaskodó „Kérjük" – a két szó nem keverendő. *(Ma: „Visszaállító link küldése" – deverbális főnévi alak.)* Folyamatban: `Küldés…` |
| 22 | **Új jelszó beállítása** | `Beállítom az új jelszót` | E/1 (P-1a) | `primary` | **Új sor (1.1)** – a `gomb-inventar.md` §5.1 hiánya. A fiók megváltozik → E/1, ige + tárgy. *(Ma: „Jelszó beállítása" – deverbális főnévi alak.)* Folyamatban: `Mentés…` (lásd L-1). |
| 23 | **Közvetlen hívás a szakembernek** (szakember-szekció, `tel:`) | `Hívd Kocsis Katát` | E/2 (P-1b) | `secondary` | **Új sor (1.2)** – a szakember-bemutató szekció feliratai eddig a szótáron KÍVÜL éltek a seedben. MINTÁZAT (C-6): `Hívd <Nevet>` – név nélkül két szakembernél a felirat nem egyedi (WCAG 2.4.4). P-1b: a hívás a telefon-alkalmazásnak adja át a látogatót, a nála tárolt dolgokban semmi nem változik (foglalás nem keletkezik), ezért E/2. Tömör `primary` kitöltést SZÁNDÉKOSAN nem kap: az a lap egyetlen vásárlási CTA-jának a nyelve, két szakembernél két elsődleges gomb keletkezne (K-3). |
| 24 | **Írásos időpontkérés a szakember-szekcióból** | `Kérj időpontot üzenetben` | E/2 (P-1b) | `secondary` | **Új sor (1.2).** A kattintás a `/kapcsolat` időpontkérő szekciójára VISZ; maga a vállalás ott, a #25 gombbal történik. NN/g egészségügyi kutatása szerint az írásos út a hívás mellett kötelező, mert a válaszadók jelentős része kerüli a telefonálást. |
| 25 | **Az időpontkérő űrlap beküldése** | `Időpontot kérek` | E/1 (P-1a) | `primary` | **Új sor (1.2).** A beküldéssel időpontkérés KELETKEZIK, tehát a látogató dolgaiban változik valami → E/1. **Vezetői pontosítás:** ez a sor és a **#24** SZÁNDÉKOSAN különbözik, és nem sérti a WCAG 3.2.4-et: a #24 navigáció a szekcióhoz, a #25 a tényleges beküldés. Aki egységesítené a kettőt, az a navigációt és a vállalást mosná össze. Folyamatban: `Küldés…` |
| 26 | **Az ingyenes kurzus igénylő űrlapjának beküldése** | `Kérem a kurzust` | E/1 (P-1a) | `primary` | **Új sor (1.3).** A beküldéssel HOZZÁFÉRÉS keletkezik és levél indul a látogatónak, tehát a nála lévő dolgokban változik valami → E/1. **Vezetői pontosítás:** ez a sor és a **#3** (`Elindítom ingyen`) SZÁNDÉKOSAN különbözik, és nem sérti a WCAG 3.2.4-et — ugyanaz a kettősség, mint a #24 ↔ #25 párnál: a #3 NAVIGÁCIÓ (a kezdőlapról a kurzus oldalára visz), a #26 a tényleges VÁLLALÁS. **A régi oldal ugyanezt a szerkezetet használta** a `/kezrelax` landingen: `KÉREM A VILLÁMKURZUST` (4×), `KÉREM A PROGRAMOT` (2×), `KÉREM A HOZZÁFÉRÉST` (2×) — mérés: `docs/regi-oldal-osszehasonlitas.md` 3.1; Jakob törvénye (NN/g). A tárgy SZÁNDÉKOSAN általános („a kurzust”), mert az űrlap minden ingyenes terméken megjelenhet; terméknevet a C-6 mintázat (`Kérem a <mit>`) hozhat később. Folyamatban: `Küldés…` |
| 27 | **Ugrás az ingyenes kurzus igénylő űrlapjához** (a hosszú kurzusoldal aljáról) | `Kérd az ingyenes kurzust` | E/2 (P-1b) | `secondary` | **Új sor (1.4).** LAPON BELÜLI navigáció: a kattintás után semmi nem változik a látogató dolgaiban, csak máshol lesz a lapon, a vállalás továbbra is a #26 gombnál történik → P-1b. **Miért kell egyáltalán:** az igénylő űrlap a lap TETEJÉN, a vásárlódobozban áll; 1024 px alatt a doboz nem ragadós, tehát a végigolvasó látogatónak nincs visszaútja. NN/g, *The Same Link Twice on the Same Page*: „In cases when the page is extremely long, such as when the same long-form content is presented on mobile devices, having links at the bottom of pages can be a time-saver", ugyanott: „Duplicating links is usually not necessary if your pages are 2–3 screens long" és hosszú lapon a ragadós megoldás a jobb (https://www.nngroup.com/articles/duplicate-links/) — ezért jelenik meg a sor KIZÁRÓLAG 1024 px alatt, ahol ragadós doboz nincs. NN/g, *Scrolling and Attention*: „Keep major CTAs above the fold", a nézési idő 42%-a a felső 20%-ra esik (https://www.nngroup.com/articles/scrolling-and-attention/) — az elsődleges hely tehát marad a doboz, ez csak a lap alján álló másodlagos belépő. **A régi oldal mintája:** a `/kezrelax` landing ugyanezt a belépőt NÉGYSZER ismételte lefelé haladva (`KÉREM A VILLÁMKURZUST` 4×, mérve: `docs/regi-oldal-osszehasonlitas.md` 3.1); mi egyszer ismételjük. **Miért nem sérti a WCAG 2.2 3.2.4-et a #3 mellett:** a #3 a kezdőlapról a kurzus OLDALÁRA visz, ez a lapon belül az ŰRLAPHOZ — két különböző eredmény, a sikerkritérium pedig azonos *funkciót* kér azonos néven. GOV.UK: „If your link takes the user to a page where they can start a task, start your link with a verb" (https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/add-links/). **Miért nem „Ugorj az űrlaphoz":** az „Ugrás" szót a skip-link foglalja, C-4 szerint egy szó egy jelentés (ez írta át a #9-et is). |
| 28 | **A kurzus SAJÁT (értékesítő) oldalának megnyitása** (kurzuskártya, lejátszó-kapu lejárt hozzáféréssel, lejárt kurzuskártya) | `Nyisd meg a kurzusoldalt` | E/2 (P-1b) | `secondary`, a kártyán dekoratív affordancia | **Új sor (1.5, 2026-08-18).** Három hívóhely, egy cselekvés, mégis három felirat élt rá: `Megnézem a programot` (kártya), `A kurzus megtekintése` (lejátszó-kapu ÉS lejárt kártya) — WCAG 2.2 **3.2.4** sérülés. Puszta navigáció → E/2. **Miért nem `Nézd meg a kurzust`:** a #10 (`Nézd meg a kurzusokat`) mellett az egyetlen különbség egy toldalék volna; pontosan ezt az érvet mondta ki a #9 sor is („a »kurzusokat ↔ kurzusaidat« különbség önmagában kevés"). **Miért nem `Nyisd meg a kurzust`:** az a #7/#8 párral ütközne, amelyek a LEJÁTSZÓT nyitják meg. A „Nyisd meg" ige SZÁNDÉKOSAN ismétlődik a #9-ből: egy fogalom (megnyitás) egy ige — Polaris, *Vocabulary*: *„identify and eliminate synonyms"*. **Forrás:** GOV.UK, *Add links* — *„If your link takes the user to a page where they can start a task, start your link with a verb"* (https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/add-links/); NN/g, *Better Link Labels* — „Specific": *„A link's primary purpose is to communicate to users what they'll find on the other side of a click"* (https://www.nngroup.com/articles/better-link-labels/). *(Ma: „Megnézem a programot", „A kurzus megtekintése" ×2.)* |
| 29 | **Befejezett kurzus újranézése** (/kurzusaim kártya) | `Nézd újra a kurzust` | E/2 (P-1b) | `secondary` | **Új sor (1.5, 2026-08-18).** Mindhárom lejátszó-nyitó felirat (#7 folytatás, #8 kezdés, #29 újranézés) ugyanoda visz, de MÁS állapotból — és a felirat ezt mondja meg. Befejezett kurzuson a „Kezdd el" hazugság, a „Folytasd" félrevezető volna. **Forrás:** NN/g, *Better Link Labels* — „Sincere": *„A link is a promise. To function properly, it must set expectations that are not only specific, but also accurate."* (https://www.nngroup.com/articles/better-link-labels/); GOV.UK Design System, *Button* — *„Write button text in sentence case, describing the action it performs."* (https://design-system.service.gov.uk/components/button/). *(Ma: „Újranézés" — deverbális főnév, tárgy nélkül.)* |
| 30 | **A kurzus befejezése a lejátszóban** (az utolsó lecke gombja) | `Befejezem a kurzust` | E/1 (P-1a) | `primary` | **Új sor (1.5, 2026-08-18).** A kattintás MEGVÁLTOZTATJA a látogató haladás-adatát (`marksWatched: true`): az utolsó lecke késznek jelölődik, a kurzus befejezetté válik — a P-1 határeset-kérdésének („változik-e bármi a látogató dolgaiban?") egyértelmű igen-ága. **Forrás:** GOV.UK Design System, *Button* (fent); NN/g, *Better Link Labels* — „Substantial": a felirat a környező szöveg nélkül is álljon meg. *(Ma: „Kurzus befejezése" — deverbális főnévi alak, M-1.)* |
| 31 | **Fiókadatok mentése** (/fiok űrlap) | `Mentés` | főnévi (P-1c) | `primary` | **Új sor (1.5, 2026-08-18).** **Miért marad főnévi, szemben a #2/#12/#21/#22 E/1-es soraival:** a magyar E/1-es alak („Mentem az adataimat") KÉTÉRTELMŰ — a *mentem* a *menni* ige múlt idejű E/1 alakja is. Vevői gombon nem állhat két értelemben olvasható szó. A szinonima-csere („Rögzítem az adataimat") viszont a L-1 `Mentés…` folyamatban-felirattal ütközne, amit a Polaris kifejezetten tilt (*„identify and eliminate synonyms"*). Így a „Mentés" a #5/#6 P-1c kivételébe tartozik: bevett, egyszavas felületi címke. **Forrás:** GOV.UK Design System, *Button* — a példák között szó szerint szerepel a *„Save and continue"* (https://design-system.service.gov.uk/components/button/); NN/g, *Jakob's Law of Internet User Experience* — a látogatók az idejük nagy részét más oldalakon töltik, ezért azt várják, hogy a tiéd is úgy működjön, ahogy a többi (https://www.nngroup.com/videos/jakobs-law-internet-ux/). Folyamatban: `Mentés…` *(Ma is ez — kódot nem kell írni, csak a szótárból olvasni.)* |
| 32 | **Kijelentkezés** (fiókmenü) | `Kijelentkezés` | főnévi (P-1c) | `ghost` | **Új sor (1.5, 2026-08-18).** A #5 (`Belépés`) szabályos párja, ugyanazzal a P-1c kivétellel. Ha a belépés főnévi, a kijelentkezés sem lehet más alakú: a menü két, egymásra felelő pontja nem beszélhet két nyelvtani személyben. **Forrás:** GOV.UK Design System, *Button* (fent); NN/g, *Jakob's Law* (fent) — a magyar felületeken ez a bevett név. Folyamatban: `Kijelentkezés…` (a L-1 lista **hetedik** eleme, lásd alább). *(Ma is ez.)* |
| 33 | **Kapcsolatfelvételi oldalra lépés** (üres tudástár, sikertelen fizetés, köszönőoldal hiba-ágai, ingyenes kurzus levélhibája) | `Írj nekünk` | E/2 (P-1b) | `secondary` | **Új sor (1.5, 2026-08-18).** Négy hívóhely, egy cselekvés, HÁROM felirat élt rá: `Kapcsolat`, `Segítséget kérek`, `Írj nekünk a kapcsolati oldalon` — mért 3.2.4-ütközés a `/kapcsolat` célon. P-1b: a kattintás csak odavisz, a vállalás ott, a #12 gombbal történik (ugyanaz a kettősség, mint #24 ↔ #25 és #3 ↔ #26). **Miért nem `Kapcsolat`:** az menücímke (N-3), és a láblécben MARAD is annak; cselekvésgombként viszont nem mondja meg, mi történik (M-7). **Forrás:** GOV.UK, *Add links* — verb-first, és *„make it descriptive and avoid generic text like 'click here' or 'more'"* (https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/add-links/); W3C, *Understanding SC 3.2.4* — *„The intent of this success criterion is to ensure consistent identification of functional components that appear repeatedly within a set of web pages."* (https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html). |
| 34 | **A „rólunk" oldalra lépés** (kezdőlapi szakmai hitel-csík) | `Ismerd meg a hátterünket` | E/2 (P-1b) | szöveglink | **Új sor (1.5, 2026-08-18).** A mai `Bővebben a szakmai hátterünkről` **öt szó** (M-3 korlátja négy), nem igével kezd, és a „Bővebben" a GOV.UK által kifejezetten kerülendő általános linkszöveg magyar párja. **Forrás:** GOV.UK, *Add links* — *„avoid generic text like 'click here' or 'more'"* (URL fent); NN/g, *Better Link Labels* — „Succinct": *„When composing links, don't waste words."* (https://www.nngroup.com/articles/better-link-labels/). |
| 35 | **A tudástár listájára lépés** (kezdőlapi szekció-láb) | `Nézd meg a tudástárat` | E/2 (P-1b) | szöveglink | **Új sor (1.5, 2026-08-18).** A mai `Összes bejegyzés a tudástárban` főnévi, és a `Vissza a Tudástárba` (a #15 mintázata) mellett második feliratot ad ugyanarra a célra. A kettő SZÁNDÉKOSAN marad külön: az egyik BÖNGÉSZÉS, a másik VISSZALÉPÉS — pontosan az a kettősség, amit a #10 ↔ #15 páros már eldöntött a `/kurzusok` célon. **Forrás:** GOV.UK, *Add links* — verb-first, és *„Consider using the title of the page the link goes to as your link text."* (a cél oldal neve a felületen „Tudástár", URL fent); NN/g, *Better Link Labels* — „Specific" (URL fent). |
| 36 | **Süti-beállítások újranyitása** (lábléc) | `Süti-beállítások` | főnévi (P-1c) | szöveglink | **Új sor (1.5, 2026-08-18).** A #18 a sáv KÉT DÖNTÉSGOMBJÁRÓL rendelkezik; a hozzájárulás visszavonásának belépője (GDPR) eddig szótáron kívül élt. P-1c: bevett, egyszavas (kötőjeles összetett) felületi címke. Az igei alak („Módosítom a süti-beállításokat") itt félre is vinne: a kattintás még nem módosít semmit, csak megnyitja a sávot. **Forrás:** NN/g, *Cookie Permissions 101* — a látogatónak később is meg kell tudnia változtatni a döntését, ehhez állandóan elérhető belépő kell (https://www.nngroup.com/articles/cookie-permissions/); NN/g, *Jakob's Law* (URL fent). *(Ma is ez.)* |
| 37 | **Jelszó-visszaállítás kezdeményezése** (link a belépőlapról és a lejárt visszaállító linkről) | `Elfelejtetted a jelszavad?` | E/2 (P-1b) | szöveglink | **Új sor (1.5, 2026-08-18).** Két hívóhely, egy cselekvés, két felirat: `Elfelejtetted a jelszavad?` és `Új link kérése` — mért 3.2.4-ütközés az `/elfelejtett-jelszo` célon. **Miért ez a kettő közül:** a cél oldal **H1 címe szó szerint** „Elfelejtetted a jelszavad?", a GOV.UK pedig kimondja: *„Consider using the title of the page the link goes to as your link text."* (URL fent). Egyben a világ legbevettebb auth-mintája — NN/g, *Jakob's Law* (URL fent); a belépőlapról elvenni tudatos veszteség volna. P-1b: a kattintás után semmi nem változik, a levelet a #21 gomb indítja el. |
| 38 | **Ugrás a kezdőlap ingyenes sávjára** (`#ingyenes`, hero másodlagos gombja és a filmHero második CMS-gombja) | `Nézd meg ingyenes SOS-kurzusunkat` | E/2 (P-1b) | `ghost` | **Pontosítva: KC V1 P03, 2026-09-05.** A gomb az AJÁNLÓ SÁVRA navigál, nem kurzusigénylést küld be, ezért „Nézd meg”, nem a #27 szerinti „Kérd”. Az ajánlat ingyenessége már a gombon is egyértelmű, akkor is, ha a sáv badge-e még nincs a képernyőn. A négyszavas, tegező felirat megtartja az M-3 korlátját; a cél és a `ghost` súly változatlan. A birtokos alak a terapeuták közös kurzusát nevezi meg. NN/g, [Better Link Labels](https://www.nngroup.com/articles/better-link-labels/) és GOV.UK, [Add links](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/add-links/): a felirat a tényleges következő lépést és annak tárgyát mondja meg. A meglévő, szerkesztett CMS-gombot a szótár nem írja felül; a régi kanonikus felirat frissítése külön exact-match tartalmi lépés. |
| 39 | **Ugrás a kurzus moduljaihoz** (kampányoldal hero és záró sáv) | `Nézd meg a modulokat` | E/2 (P-1b) | `secondary` | **KC demó, 2026-09-05.** A link a látható tananyagjegyzékhez navigál, nem vásárlás és nem a lejátszó indítása. A négyszavas felirat a konkrét célt nevezi meg; minden ilyen cél azonos feliratot kap. Forrás: NN/g, [Better Link Labels](https://www.nngroup.com/articles/better-link-labels/); W3C, [WCAG 2.2 SC 3.2.4](https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html). |
| 40 | **A rendelői kezelések oldalára lépés** (kezdőlapi sín, 1. ajtó) | `Nézd meg a kezeléseket` | E/2 (P-1b) | `primary` | **Pontosítva (REV C, 2026-09-06).** Puszta navigáció a `/szolgaltatasok` oldalra → E/2. A szótár M-7 szerinti alakja a #10 mintáját követi (`Nézd meg` + a cél). A sín CMS-felirata a Szerkesztő zárolása: az élő `Tovább a kezelésekre`; a szótárba Tovább nem kerül. **Forrás:** GOV.UK, *Add links* — *„If your link takes the user to a page where they can start a task, start your link with a verb"* (https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/add-links/); NN/g, *Better Link Labels* — „Specific" (https://www.nngroup.com/articles/better-link-labels/); W3C, *WCAG 2.2 SC 3.2.4* (https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html). |
| 41 | **A ProBody kézworkshop megnyitása** (kezdőlapi sín, 3. ajtó) | `Nézd meg a kézworkshopot` | E/2 (P-1b) | `primary` | **Pontosítva (REV C, 2026-09-06).** A kattintás a ProBody Stúdió külső kézworkshop-oldalára visz (új lap). Puszta navigáció → E/2. A felirat a túloldalt nevezi meg. **Forrás:** NN/g, *Better Link Labels* — „Specific" (https://www.nngroup.com/articles/better-link-labels/); GOV.UK, *Add links* — verb-first (https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/add-links/); W3C, *WCAG 2.2 SC 3.2.4* (https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html). |
| 42 | **A szakkönyv vásárlási oldalának megnyitása** (/szakembereknek, 2. kártya) | `Nézd meg a szakkönyvet` | E/2 (P-1b) | `secondary` | **Új sor (WP49, 2026-09-19).** Puszta navigáció a szakkönyv vásárlási oldalára (a cél URL-jét a tulajdonosok még nem adták meg; addig a #43 él). A #41 mintája: `Nézd meg` + a cél. Másodlagos súly, mert a lapon a képzés gombja (#41) az egyetlen elsődleges. **Forrás:** GOV.UK, *Button* — „Avoid using multiple default buttons on a single page" (https://design-system.service.gov.uk/components/button/); NN/g, *Better Link Labels* — „Specific" (https://www.nngroup.com/articles/better-link-labels/); W3C, *WCAG 2.2 SC 3.2.4* (https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html). |
| 43 | **Érdeklődés a szakkönyvről** (/szakembereknek, 2. kártya, amíg nincs vásárlási cím) | `Érdeklődj a szakkönyvről` | E/2 (P-1b) | `secondary` | **Új sor (WP49, 2026-09-19).** A kattintás a `/kapcsolat` oldalra visz; a vállalás ott, a #12 gombbal történik (ugyanaz a kettősség, mint #33 és #24). Nem a #33 `Írj nekünk`, mert a felirat a TÁRGYAT is megnevezi: a látogató a könyvről kérdez, és ezt a gombnak kell kimondania (M-7). **Forrás:** GOV.UK, *Add links* — „If your link takes the user to a page where they can start a task, start your link with a verb" (https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/add-links/); NN/g, *Better Link Labels* — „Specific, Sincere, Substantial, Succinct" (https://www.nngroup.com/articles/better-link-labels/); W3C, *WCAG 2.2 SC 2.4.4 Link Purpose (In Context)* (https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html). |

**C-6 — MINTÁZATOS feliratok, gépi alakkal (2026-08-18).** A `patterned: true`
sorok (#14, #15, #23) eddig csak emberi szöveggel mondták ki a mintázatot, ezért
a termék-oldali őr (G-UI2) kilenc élő `Vissza a …` feliratot kivétel-soron
vezetett. A `src/lib/cta-vocabulary.ts` `CtaEntry.pattern` mezője ezt gépi
alakra hozza:

| §3.2 sor | Mintázat (reguláris kifejezés, `u`) | Élő változatok ma |
| --- | --- | --- |
| #14 | `^Letöltöm a[z]? \S.*$` | `Letöltöm a számlát` |
| #15 | `^Vissza a[z]? \S.*$` | `Vissza a kurzusokhoz`, `Vissza a kezdőlapra`, `Vissza a kurzusaimhoz`, `Vissza a belépéshez`, `Vissza a Tudástárba` |
| #23 | `^Hívd \S.*$` | `Hívd Kocsis Katát` |

A szabály FORRÁSA maga a sikerkritérium magyarázata: W3C, *Understanding SC
3.2.4 Consistent Identification* — *„Text alternatives that are 'consistent' are
not always 'identical.'"*, és a példái pontosan ezt az alakot írják le (egy
nyomtató-ikon az egyik helyen *„Print receipt"*, a másikon *„Print invoice"*; a
letöltésé *„Download [document name]"*):
https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html
A mintázat SZÁNDÉKOSAN szűk: kötött, jelentést hordozó előtag + **kötelező, nem
üres** tárgy. A puszta „Vissza" így sem engedett (NN/g, *Better Link Labels* —
„Substantial": *„must be able to stand alone"*,
https://www.nngroup.com/articles/better-link-labels/).

**L-1 jóváhagyott feliratkészlet** (P-1d; három pont, gondolatjel nélkül).
A §2.6 **L-1** mondja ki a *szabályt* („a beküldő gomb azonnal letiltódik, és
a felirata folyamatot mond"); az alábbi lista a hozzá tartozó **jóváhagyott
feliratkészlet** – ez a §3.2 szótár része, és **zárt**: pontosan hét elem.

`Belépés…` · `Regisztráció…` · `Kijelentkezés…` · `Küldés…` · `Mentés…` · `Feldolgozás…` · `Betöltés…`

**A `Kijelentkezés…` 2026-08-18-án került fel** (a lista hat elemről hétre nőtt).
Az indok BITRE ugyanaz, amivel korábban a `Regisztráció…` felkerült: ma is él a
felületen (`AccountNav`), és a #32 főnévi címkéjének (P-1c) szabályos
folyamatban-párja. Az `Újratöltés folyamatban…` viszont **NEM** került fel: az a
`Betöltés…`-re egységesült — ugyanaz a művelet, két szó, és a Polaris előírja a
szinonimák felszámolását (*„identify and eliminate synonyms"*).

**A `Beállítás…` NEM kerül a listára.** A `/jelszo-visszaallitas` űrlap mai
`Beállítás…` felirata a **`Mentés…`-re egységesül**. Indoklás: a „beállítás" és
a „mentés" itt **ugyanazt a műveletet** nevezi meg (a látogató bevitt adata
tartósan eltárolódik), a Polaris pedig kimondottan előírja a szinonimák
azonosítását és felszámolását (*„identify and eliminate synonyms"*); a WCAG
3.2.4 ugyanezt kéri hozzáférhetőségi oldalról. A `/fiok` mentés-gombja már ma is
`Mentés…`-t ír – a két űrlap így ugyanazt a szót használja ugyanarra a
műveletre. A `Regisztráció…` viszont **felkerül** a listára: ma is él a
felületen, és a #6 főnévi címkéjének (P-1c) szabályos folyamatban-párja.

**A folyamatban-felirat sosem E/1.** Ez rendszerállapot-üzenet (NN/g 1.
heurisztika: *„visibility of system status"*; WCAG 4.1.3 Status Messages), nem a
látogató cselekvése – ezért marad semleges, deverbális alakban. A `Megveszem…`
alak nyelvtanilag is értelmetlen volna.

---

## 4. Navigáció és információ-architektúra

### 4.1 Mélység és szerkezet

- **N-1.** A főmenü **legfeljebb 2 szintű** (a repó `menu-tree.ts` már így
  korlátoz). Mélyebb szerkezethez oldalszintű al-navigáció való, nem harmadik
  lenyíló.
- **N-2.** A **„Kurzusok" menüpont kötelező** és nem függhet a CMS-menü
  tartalmától (`ertekesitesi-ux-skill.md` 3. pont) – az értékesítés fő útja nem
  tűnhet el egy szerkesztői hibától.
- **N-3.** A menüpont-felirat **információt hordozó szót** kezd (NN/g F-mintázat:
  *„Start headings and subheadings with the words carrying most information: if
  users see only the first 2 words, they should still get the gist"*).

### 4.2 „Hol vagyok?" – a jelenlegi oldal jelölése

NN/g: *„Navigation should not only show where you can go but also where you are
now."* A látogatók jelentős része **nem a kezdőlapon** lép be (keresőből,
hirdetésből), ezért az orientáció nem opcionális.

- **N-4.** Az aktív menüpont **vizuálisan** kiemelt (szín + második jelölő:
  vastagság, aláhúzás vagy jelölősáv – a szín önmagában nem elég, 1.4.1) **és**
  programozottan jelölt: **`aria-current="page"`**.
  → A repóban a szűrő-chipek, a lejátszó-tananyag, a kurzus-morzsamenü, valamint
  a fő- és láblécnavigáció ezt már helyesen adja. **→ A/7 javítás.**
- **N-5.** A jelölés **minden nézetben** él: asztali sáv, mobil drawer, lábléc.
- **N-6.** NN/g teszt-protokoll az ellenőrzésre: kérdezd meg a felhasználót,
  *„Where are you on the website?"* és *„How can you tell?"* – a designernek
  nyilvánvaló jelzést a látogató gyakran észre sem veszi.

**N-4/N-5 megvalósítási bizonyíték (2026-09-05, PR #211).** A döntés nem csak a
projekt korábbi auditjára támaszkodik:

1. A [W3C WCAG 2.2 SC 1.4.1 magyarázata](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color)
   látható, nem színalapú jelölőt kér, ha a szín információt közöl. Ezért az aktív
   lábléclink nemcsak KC-kék, hanem az alapállapotnál vastagabb aláhúzást is kap.
2. A [GOV.UK Service navigation](https://design-system.service.gov.uk/components/service-navigation/)
   külön kezeli a pontos jelenlegi oldalt és az aktív oldalcsoportot, a jelenlegi elem
   példájában pedig `aria-current` jelölést használ. Ez támasztja alá a Kineticare pontos
   `aria-current="page"` és külön `data-ancestor-active` állapotát.
3. A [GOV.UK focus-state útmutató](https://design-system.service.gov.uk/get-started/focus-states/)
   a link fókuszát erős, a környező háttértől elkülönülő vizuális jellel tartja
   felismerhetőnek. A route-aláhúzás ezért nem írhatja felül a Kineticare külön 3 px-es
   `:focus-visible` körvonalát.

**Mérési jegyzőkönyv.** Az izolált offline Chromium-harness az exact
`52579fed531f702d20d63a624a9ae3394c4d27dd` runtime commitot mérte a
`9df69f0b8e6db9b1a945acf95f605699748d1204` base-en, a repó valódi CSS-ével és helyi
Tenor Sans/Nunito Sans betűivel. A nézetablak 320, 390, 900 és 1440 × 1000 CSS px volt;
az öt útvonal: `/aszf`, `/kapcsolat`, `/kapcsolat/idopont`, `/impresszum` és
`/aszf-reszletes` (20 állapot).

| Ellenőrzés | Mért eredmény | Küszöb / verdikt |
|---|---|---|
| Pontos és ős útvonal | 12 pontos egyezésnél egy `aria-current="page"`, 8 nem pontos esetben nulla; ősállapot csak a `/kapcsolat/idopont` → `/kapcsolat` páron | N-4/N-5 ✓ |
| Aktív footer szöveg + aláhúzás | `#2f6e9f` / `#f6f9fc` = **5,1597:1**; jogi link 2 px, nagy Kapcsolat-link 3 px | szöveg ≥ 4,5:1, nem csak szín ✓ |
| Billentyűzetes fókusz | a route-állapottal együtt is külön **3 px solid** körvonal | 1.4.11 / 2.4.7 ✓ |
| 320 px célméret | Kapcsolat **150,7 × 44,0**; Adatvédelem **248,6 × 44,0**; ÁSZF **192,1 × 44,0**; Impresszum **75,8 × 44,0** CSS px | projektcél ≥ 44 px ✓ |
| 320 px reflow | minden állapotban `scrollWidth <= innerWidth` | 1.4.10 ✓ |
| Gyors fejlécfátyol-váltás | current, ancestor és nem-current hover+focus minimuma **5,1348:1** | szöveg ≥ 4,5:1 ✓ |
| React SSR + hidratáció | nincs recoverable hydration error vagy page error; a süti-gomb egy kattintásra egy eseményt ad | regresszió nincs ✓ |

A harness határa: a Next `Link`/`usePathname` és a hírlevél adatforrása helyettesített,
ezért ez nem teljes Next RSC/E2E, nem élő CMS- vagy production-mérés, és nem teljes
WCAG-tanúsítás. A kontraszt a CSS-színpárból számolt érték, nem antialiasolt
képernyőkép-pixelekből. A futás hálózatot és `.env*` tartalmat nem használt.

### 4.3 Morzsamenü

- **N-7.** Morzsamenü **akkor kell**, ha a szerkezet 3 vagy több szintű
  (NN/g: *„Breadcrumbs aren't necessary (or useful) for sites with flat
  hierarchies that are only 1 or 2 levels deep"*). Nálunk ez a **kurzusoldal**
  (Kezdőlap → Kurzusok → *kurzus*) és a **blogposzt** (Kezdőlap → Tudástár →
  *kategória* → *poszt*).
- **N-8.** Helye a globális navigáció alatt, a lap tetején.
- **N-9.** **Az utolsó elem (a jelenlegi oldal) nem link** – NN/g:
  *„The last breadcrumb (denoting the current page) should not be a link."*
  A repó kurzusoldala ezt helyesen csinálja (`<li aria-current="page">`).
- **N-10.** A morzsamenü **nem helyettesíti** a fő navigációt:
  *„Breadcrumbs should not replace the global navigation bar or the local
  navigation within a section."*
- **N-11.** `BreadcrumbList` JSON-LD kötelező mellé (`seo-geo-llm.md` – már él).

### 4.4 Horgony-linkek

- **N-12.** A horgony-navigáció (`CourseJumpNav`, `#kurzusok`, `#ingyenes`)
  **csak létező szakaszokra** mutathat – nem szabad üresre vivő horgonyt
  rendelni.
- **N-13.** Horgonyra ugrás után **a fókusz is odamegy** (nem csak a görgetés),
  különben a billentyűzetes látogató a lap tetején marad.
- **N-14.** A cél-szakasz **nem kerülhet a ragadós fejléc alá** –
  `scroll-margin-top` a ragadós sáv teljes magasságára (Á-2 / WCAG 2.4.11).
- **N-15.** Az aktív horgony jelölése `aria-current` (a `scroll-scrub`
  komponens `aria-current="step"`-je jó minta).

### 4.5 Ragadós fejléc

- **N-16.** A ragadós sáv **a lehető legalacsonyabb** – NN/g:
  *„minimize any additional vertical height"* a minimális célfelület
  (≈ 1 cm × 1 cm) és a ~16 pt szövegméret felett.
- **N-17.** A sáv háttere **minden állapotban** biztosítja az AA-kontrasztot; ha
  áttetsző, a **legrosszabb esetre** (legvilágosabb mögöttes tartalom) kell
  méretezni (`ertekesitesi-ux-skill.md` 3. pont).
- **N-18.** Az áttűnés hossza 300–400 ms (NN/g részlegesen ragadó fejlécekre
  mért ajánlása), `prefers-reduced-motion` esetén elmarad.

### 4.6 Mobil navigáció

- **N-19.** Lenyíló („drawer") `aria-expanded` + `aria-controls` állapottal, Esc
  zárja, a fókusz visszatér a nyitó gombra. (A `MobileNav` ezt teljesíti.)
- **N-20.** Érintési célfelület 44 px (2.4).
- **N-21.** A „Kurzusok" akciógomb mobilon is látszik, a hamburger **mellett** –
  az értékesítési út nem kerülhet két koppintásnyira.

### 4.7 Ne rejtsd el a fontosat – banner-vakság

NN/g: a látogatók *„have learned to ignore content that resembles ads, is close
to ads, or appears in locations traditionally dedicated to ads"*. Mérve: a jobb
oldali sávra a nézési idő **0,8 %-a** jut, holott a tartalomterület **25 %-a**.

- **N-22.** Az értékesítési tartalom (ár, CTA, kurzuskártya) **nem kaphat
  hirdetés-jellegű megjelenést**: nem villog, nem animált szalag, nem a jobb
  oldali sávban, nem élesen elütő „reklám-doboz".
- **N-23.** A „hot potato" hatás miatt egy hirdetés-szerű elem **a körülötte
  lévő tartalomra is átterjeszti** a vakságot – ezért nincs a lapon
  hirdetés-arculatú blokk.

---

## 5. Konzisztencia-szabályok

**A norma:** WCAG 2.2 **3.2.4 Consistent Identification (AA)** –
*„Components that have the same functionality within a set of web pages are
identified consistently."*
Kiegészítve: **3.2.3 Consistent Navigation (AA)** (az ismétlődő navigáció
sorrendje ne változzon) és NN/g 4. heurisztikája:
*„Users should not have to wonder whether different words, situations, or
actions mean the same thing."*

| # | Szabály | Ellenőrzés |
|---|---|---|
| **C-1** | **Ugyanaz a cselekvés = ugyanaz a SZÓ.** Egy funkcióhoz pontosan egy felirat tartozik, a 3.2 szótárból. | Szótár-őrteszt (6.3) |
| **C-2** | **Ugyanaz a cselekvés = ugyanaz a SÚLY.** A vásárlás mindenhol `primary`, az ingyenes mindenhol `secondary`, a navigációs kiegészítő mindenhol `ghost`. | Vizuális diff + DOM-osztály-számlálás |
| **C-3** | **Ugyanaz a cselekvés = ugyanaz a HELY.** A buybox CTA-ja mindig a doboz alján, a nav-CTA mindig a sáv jobb szélén, a beküldő gomb mindig az űrlap alján. | Kézi ellenőrzés PR-ben |
| **C-4** | **Ugyanaz az ikon = ugyanaz a jelentés.** A `→` mindig „tovább ebbe az irányba", a `✓` mindig „teljesült". A WCAG 3.2.4 magyarázata kifejezetten kiemeli az ikonok szöveges alternatívájának egységességét. | Ikon-leltár |
| **C-5** | **A látható felirat része a hozzáférhető névnek** (WCAG 2.5.3). | Automatizált (6.3) |
| **C-6** | A mintázatos feliratok megengedettek, ha a **minta** azonos: a WCAG magyarázata szerint a „Go to page 4" / „Go to page 5" megfelel. Nálunk: `Letöltöm a számlát` / `Letöltöm az igazolást` (§3.2 #14), illetve `Vissza a kurzusokhoz` / `Vissza a kezdőlapra` (#15). | – |
| **C-7** | **Az e-mail-sablonok CTA-i is a szótárból jönnek** (`src/lib/email/templates/**`) – a levélből érkező látogató ugyanazt a szót találja az oldalon. | Szótár-őrteszt |

---

## 6. Mérési és ellenőrzési protokoll

**Alapelv (CLAUDE.md munkamodell 5. pont):** semmi nem fogadható el azért, mert
valaki állítja. Minden szabályhoz tartozik mérés vagy reprodukálható lépés.

### 6.1 Mit kell mérni, mivel

| Mit | Küszöb | Eszköz / módszer |
|---|---|---|
| **Szövegkontraszt** | ≥ 4,5:1 normál; ≥ 3:1 nagy szöveg (≥ 24 px, vagy ≥ 18,66 px félkövér) – WCAG **1.4.3 (AA)** | Böngésző DevTools kontraszt-mérő; a `tokens.css`-ben kiszámolt arányok felülvizsgálata minden szín-változtatásnál |
| **Nem-szöveges kontraszt** | ≥ 3:1 UI-komponens-határ, fókuszgyűrű, grafikus objektum – WCAG **1.4.11 (AA)** | Ua. Külön ellenőrizendő: gomb-keret, mező-keret, fókuszgyűrű **mind a négy** háttéren (paper, fehér, tint, dark) |
| **Fókusz megjelenése** | ≥ 2 CSS px perem, ≥ 3:1 a fókuszált/nem fókuszált állapot között – **2.4.13 (AAA), célérték** | Tabbal végigjárás + képernyőkép-összevetés |
| **Fókusz takarása** | egyetlen fókuszgyűrű sem tűnhet el ragadós sáv alatt – **2.4.11 (AA)** | Tabbal végigjárás görgetés közben, desktop + mobil |
| **Érintési célfelület** | ≥ 44 × 44 CSS px minden gombra/menüpontra; inline hivatkozásnál ≥ 24 × 24 vagy távolság-mentesség – **2.5.8 (AA)** / **2.5.5 (AAA)** | DevTools elem-doboz kimérése; automatizált őr (6.3) |
| **Sorhossz** | **tűrés 45–85, cél 50–75 karakter** (Ü6); ≤ 80 az AAA-plafon (WCAG 1.4.8) | **Karakterszám magyar szöveggel mérve**, nem `ch` (Ü2): a renderelt sor kimásolása és megszámlálása 3 töréspontnál (360 / 768 / 1440 px) |
| **Betűméret** | **kizárólag a három token**: `--kc-font-l` / `--kc-font-m` / `--kc-font-s` | `src/__tests__/tipografia-harom-meret.test.ts` (már él; bármely más `font-size` bukás a storefronton) |
| **Kártyacím, ha félkövér kell** | **Nunito Sans 700, M token** (`--kc-font-body` + `--kc-font-weight-bold`), nem a Tenor Sans: a címsor-betű egyetlen 400-as metszettel érkezik, a 600/700 ott szintetikus, torz vastagítás lenne. Így áll a Tudástár blogkártya-címe (`knowledge.css`) és a Három állapot kártyacíme (`states.css`, 600). Tulajdonosi döntés 2026-09-19: a blogcím vastagítása marad, ez a szabály rögzíti, hogy a két kártyacím EGY család, nem következetlenség. | NN/g Headings (a cím váljon el a törzstől), Material 3 Type scale (title = törzsnél nagyobb súly, azonos család), Apple HIG Typography; `wp51-aloldali-keresek.test.tsx` |
| **Reflow** | 320 CSS px-en nincs kétirányú görgetés – **1.4.10 (AA)** | 1280 px ablak 400 %-os nagyításon; mért dokumentum-szélesség |
| **Mozgás** | minden átmenet `prefers-reduced-motion` mögött | kód + őr-teszt |
| **CTA-távolság** | a vásárlási akció a lapon bárhonnan **0 görgetésnyire** (ragadós) | Kézi: görgess a lap aljára, a CTA látszik-e |

**A mérés eszköze – becslés nem elfogadható.** A `termektervezes` skill 3. pontja
kiköti: *„Minden állítást méréssel kell alátámasztani (Chromium +
playwright-core a mérőharnesszel…), nem becsléssel."* A harness a session
scratchpad `ux/` mappájában él (`build.mjs`, `futtat.sh`, előtte/utána
képernyőképek) – új felületi méréshez ezt kell újrafuttatni, nem újat írni.
A kontraszt-arányokat **számolni** kell, nem szemre becsülni; a `tokens.css` és
a `ui.css` már számolt arányokat dokumentál kommentben, ez a minta.

### 6.2 Kézi ellenőrzési kör (PR-enként kötelező)

1. **Tab-bejárás** a teljes oldalon: minden interaktív elem elérhető, a
   fókuszgyűrű mindig látszik, sorrendje a vizuális sorrendet követi.
2. **Csak billentyűzettel** végigvitt vásárlási út: kezdőlap → kurzus → pénztár.
3. **Nagyítás 400 %-ra** és 320 px-es nézet.
4. **`prefers-reduced-motion: reduce`** bekapcsolva: nincs átmenet, nincs
   parallax, a funkció változatlan.
5. **Képernyőolvasós próba** a módosított komponensen (gomb neve, állapota,
   hibaüzenet bejelentése).

### 6.3 Automatizált őr-tesztek – ezeket kell megírni

A repó tesztkultúrája már erős (`src/__tests__/course-sales-ui.test.ts`,
`admin-course-editor-ux.test.ts`, `course-player-ui.test.ts`). Ezek egészítik ki:

| Őr | Mit véd | Bukás-feltétel |
|---|---|---|
| **G-UI1 – CTA-szótár** (`src/__tests__/cta-vocabulary-guard.test.ts`) – **megírva, 2026-08-16** | 3.2 táblázat + 3.1 mikroszöveg | A `src/lib/cta-vocabulary.ts` bármely felirata U+2014-et vagy gondolatjelet tartalmaz, „Tovább"-bal kezdődik, 4 szónál hosszabb, csupa nagybetűs, puszta tiltott felirat (M-7), **vagy** két bejegyzés ugyanarra a cselekvés-kulcsra kerül, **vagy** a modul és a §3.2 táblázat feliratkészlete eltér |
| **G-UI2 – gondolatjel-tilalom** | 3.1.2 | Bármely **U+2014** karakter látogatói szövegkonstansban (gombfelirat, `aria-label`, badge, mezőfelirat, hibaüzenet). Első körben: a `src/lib/**` és `src/components/**` string-literáljai |
| **G-UI3 – egy elsődleges** | K-1 | A szerver-renderelt HTML-ben egynél több `kc-button--primary` a kurzusoldalon, illetve a kezdőlapon kettőnél több |
| **G-UI4 – érintési cél** | 2.4 | `kc-button`-ra vagy nav-elemre `min-height` < 2,75 rem |
| **G-UI5 – hamis gomb** | B-3 / A/4 | `aria-hidden="true"` elem `--kc-color-primary` kitöltéssel és gomb-geometriával |
| **G-UI6 – `aria-current`** | N-4 | A fő navigáció kimenetében nincs `aria-current="page"` az aktív útvonalon |
| **G-UI7 – tiltott hibaszavak** (`src/__tests__/g-ui7-tiltott-hibaszavak.test.ts`) – **megírva, 2026-08-22** | 2.7 | A `src/lib`, `src/components`, `src/app`, `src/collections` fa (és a `src/payload.config.ts`) bármely NEM KOMMENT szövegében `kérjük` / `sajnos` / `hopp` (kisbetűsen is), mondatcímkéző `Érvénytelen`, vagy `hibakód`. A kommenteket az őr karakterszintű maszkolással kiveszi, mert azok jogosan IDÉZIK a tiltott szót |
| **G-UI8 – dupla küldés** | L-1 | Beküldő gomb `disabled` prop nélkül |

### 6.4 Kognitív séta és a megszokott minták (kötelező)

A `termektervezes` skill 5. pontja két olyan lépést ír elő, amit sem
kontraszt-mérő, sem őr-teszt nem vált ki:

- **K-SÉTA.** Minden **új folyamatnál** kötelező végigjátszani egy nem gyakorlott
  felhasználó fejével, lépésenként. A három kérdésre minden képernyőn kell
  válasz: **hol vagyok · mit tehetek itt · hova jutok, ha rákattintok.**
  Zsákutca tilos: minden oldalról legyen értelmes továbblépés és visszaút.
  (A meglévő zsákutcák leltára: `docs/informacios-architektura.md` §6.1.)
- **JAKOB TÖRVÉNYE.** A régi kineticare.hu megszokott útvonalai számítanak: ha
  egy bevett utat elveszünk, azt **tudatosan és indokoltan** tegyük, a PR-ben
  kimondva. (Összevetési alap: `docs/regi-oldal-valaszok.md`,
  `docs/tartalom-leltar-regi-oldal.md`.)
- **Végigjátszás mobilon ÉS billentyűzettel** (skill 6. pont, 6. lépés) – a
  „kész" csak ezután mondható ki.

### 6.5 Konverziós mérés (PostHog)

A meglévő tölcsér változatlan:
`$pageview(/) → course_viewed → checkout_started → purchase_confirmed`
(`ertekesitesi-ux-skill.md` 5. pont).

**Kötelező előmérés minden CTA-szöveg-változtatás előtt** (a
`ux-belso-oldalak-kutatas.md` 6.1 protokollja szerint). **1.1-es pontosítás:**
az Ü5-döntés után a 3.2 szótár bevezetése **NEM személyváltás** – a vásárlási,
ingyenes-igénylési, feliratkozási és üzenetküldési gombok E/1-ben maradnak,
ahogy ma is állnak. Amit a bevezetés valóban megváltoztat, az (a) a szinonimák
felszámolása (nyolc feliratról egyre a kurzuslistánál, négyről egyre a saját
kurzusoknál), (b) a deverbális főnévi alakok igére cserélése, (c) az ingyenes
termék hamis „Megveszem" feliratának javítása. A tölcsér ezekre érzékeny, ezért
a PR-leírás rögzíti az előtte-utána számokat.

---

## 7. Forrásjegyzék

Minden forrás **2026-08-16-án** ellenőrizve.

### 7.1 Szabvány (W3C)

1. **Web Content Accessibility Guidelines (WCAG) 2.2** – W3C Recommendation.
   https://www.w3.org/TR/WCAG22/
   *Hivatkozott kritériumok:* 1.4.1 (A), 1.4.3 Contrast Minimum (AA, 4,5:1 /
   3:1), 1.4.8 Visual Presentation (AAA, ≤ 80 karakter), 1.4.10 Reflow (AA),
   1.4.11 Non-text Contrast (AA, 3:1), 2.4.3 (A), 2.4.7 Focus Visible (AA),
   2.4.11 Focus Not Obscured Minimum (AA), 2.4.12 (AAA), 2.4.13 Focus Appearance
   (AAA), 2.5.3 Label in Name (A), 2.5.5 Target Size Enhanced (AAA, 44×44),
   2.5.8 Target Size Minimum (AA, 24×24), 3.2.3 Consistent Navigation (AA),
   3.2.4 Consistent Identification (AA), 3.3.1–3.3.4, 3.3.7, 3.3.8.
2. **Understanding SC 2.5.8: Target Size (Minimum)** – W3C WAI.
   https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
   *Lényeg:* 24×24 CSS px; öt mentesség (Spacing, Equivalent, Inline,
   User agent control, Essential); a Spacing-mentesség 24 px átmérőjű kört mér.
3. **Understanding SC 3.2.4: Consistent Identification** – W3C WAI.
   https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html
   *Lényeg:* azonos funkció = azonos címke és hozzáférhető név; a mintázatos
   eltérés (pl. sorszám) megengedett.
4. **ARIA Authoring Practices Guide – Button Pattern** – W3C WAI.
   https://www.w3.org/WAI/ARIA/apg/patterns/button/
   *Lényeg:* a gomb cselekvést indít, a link navigál; a gomb `Space`-re **és**
   `Enter`-re aktiválódik; kötelező hozzáférhető név.

### 7.2 Nielsen Norman Group

5. **10 Usability Heuristics for User Interface Design** (1994, frissítve
   2024-01-30). https://www.nngroup.com/articles/ten-usability-heuristics/
   *Lényeg:* 1. rendszerállapot láthatósága; 4. konzisztencia és szabványok;
   9. hibák felismerése és javítása („plain language, no error codes").
6. **Button States: Communicate Interaction.**
   https://www.nngroup.com/articles/button-states-communicate-interaction/
   *Lényeg:* enabled / disabled / hover / focus / pressed + loading + selected;
   a fókuszt körvonallal jelöld, ne csak színnel; `aria-disabled` kötelező;
   hover 150–200 ms, pressed visszajelzés 100–150 ms.
7. **Beyond Blue Links: Making Clickable Elements Recognizable.**
   https://www.nngroup.com/articles/clickable-elements/
   *Lényeg:* „don't make nonclickable items look like buttons"; a linkstílus
   az egész oldalon egységes; a szín önmagában nem elég jelölő.
8. **Better Link Labels: 4Ss for Encouraging Clicks.**
   https://www.nngroup.com/articles/better-link-labels/
   *Lényeg:* Specific · Sincere · Substantial · Succinct; a link a környező
   szöveg nélkül is érthető legyen.
9. **UI Copy: UX Guidelines for Command Names and Keyboard Shortcuts.**
   https://www.nngroup.com/articles/ui-copy/
   *Lényeg:* „no more than 2–4 words"; igével kezdj; kerüld a márkaneveket;
   „if the same command appears in more than one menu… use the same label text".
10. **„Get Started" Stops Users.** https://www.nngroup.com/articles/get-started/
    *Lényeg:* a homályos CTA elvonja a figyelmet és bizalmat rombol; helyette
    konkrét, a következő lépést megnevező felirat.
11. **A Link is a Promise.** https://www.nngroup.com/articles/link-promise/
    *Lényeg:* a felirat ígéretét a kattintás azonnal teljesítse.
12. **Banner Blindness: Old and New Findings.**
    https://www.nngroup.com/articles/banner-blindness-old-and-new-findings/
    *Lényeg:* a hirdetés-szerű megjelenés/elhelyezés vakságot vált ki; a jobb
    oldali sávra a nézési idő 0,8 %-a jut a terület 25 %-a mellett.
13. **F-Shaped Pattern for Reading Web Content.**
    https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/
    *Lényeg:* az első két bekezdésbe kerüljön a lényeg; a címsor és a link első
    2 szava hordozza az információt; kerüld a „go / click here / more" linkeket.
14. **Breadcrumbs: 11 Design Guidelines.**
    https://www.nngroup.com/articles/breadcrumbs/
    *Lényeg:* 1–2 szintű szerkezethez nem kell; a lap tetején; az utolsó elem
    nem link; nem helyettesíti a fő navigációt.
15. **Navigation: You Are Here.**
    https://www.nngroup.com/articles/navigation-you-are-here/
    *Lényeg:* „Navigation should not only show where you can go but also where
    you are now"; teszteld a „Where are you on the website?" kérdéssel.
16. **Sticky Headers: 5 Ways to Make Them Better.**
    https://www.nngroup.com/articles/sticky-headers/
    *Lényeg:* minimalizáld a magasságot; magas kontraszt a tartalom felé;
    részleges ragadásnál 300–400 ms animáció.
17. **The 3 C's of Informational Microcopy.**
    https://www.nngroup.com/articles/3-cs-microcopy/
    *Lényeg:* clarity, concision, character – a mikroszöveg elsődleges feladata
    az egyértelműség.

### 7.3 Ipari kutatás és design-rendszerek

18. **Baymard Institute – Usability Testing of Inline Form Validation.**
    https://baymard.com/blog/inline-form-validation
    *Lényeg:* `onblur`-re validálj, gépelés közben ne; az újraellenőrzés viszont
    billentyűleütésenként; 31 % nem használ inline validációt, 4 % rosszul.
19. **Baymard Institute – How to Improve Validation Errors (Adaptive Error
    Messages).** https://baymard.com/blog/adaptive-validation-error-messages
    *Lényeg:* a hibaüzenet a konkrét megsértett szabályt mondja meg; csak 2 %
    csinálja; „Phone Number is too short" > „Provide a valid phone number".
20. **Baymard Institute – Checkout UX Best Practices 2025.**
    https://baymard.com/blog/current-state-of-checkout-ux
    *Lényeg:* a felhasználók 70 %-a hagyja ott a kosarat; 18 % kizárólag a
    kötelező fiókregisztráció miatt; 94 % nem használ adaptív hibaüzenetet;
    61 % nem jelöli egyszerre a kötelező és az opcionális mezőket.
21. **Baymard Institute – Readability: The Optimal Line Length.**
    https://baymard.com/blog/line-length-readability
    *Lényeg:* 50–60 karakter az optimum, 75-ig elfogadható; a WCAG 1.4.8 a
    80 karaktert szabja felső határnak; 100+ karakternél mért fáradás.
22. **Baymard Institute – 10 Desktop Web UX Best Practices.**
    https://baymard.com/blog/desktop-ux-ecommerce
    *Lényeg:* 90 % nem használ adaptív hibaüzenetet, 72 % nem jelöli a
    kötelező/opcionális mezőket. **Megjegyzés:** sorhosszra és CTA-elhelyezésre
    ez a cikk **nem** ad számot – arra a 21. és a 23. tétel a forrás.
23. **GOV.UK Design System – Button.**
    https://design-system.service.gov.uk/components/button/
    *Lényeg:* „Avoid using multiple default buttons on a single page";
    „Pages with too many calls to action make it hard for users to know what to
    do next"; warning gomb csak visszafordíthatatlan következménynél és
    „very sparingly"; `data-prevent-double-click` + szerveroldali védelem;
    gombcsoport.
24. **GOV.UK Design System – Error message.**
    https://design-system.service.gov.uk/components/error-message/
    *Lényeg:* mondd meg, mi történt és hogyan javítható; mező mellett **és**
    hibaösszegzésben; tilos a „please", „sorry", „valid/invalid", a zsargon és a
    humor; a beírt adat maradjon meg.
25. **GOV.UK Design System – Labels, legends and headings.**
    https://design-system.service.gov.uk/get-started/labels-legends-headings/
    *Lényeg:* „one thing per page" – egy kérdés, egy döntés oldalanként.
26. **GOV.UK – Content design: writing for GOV.UK.**
    https://www.gov.uk/guidance/content-design/writing-for-gov-uk
    *Lényeg:* kötelező plain English; **9 éves olvasási szintre** írunk; „write
    like you're talking to your user one-on-one"; aktív szerkezet; a linkszöveg
    elejére kerül a lényeg; „click here" és „here" tilos.
27. **IBM Carbon Design System – Button usage.**
    https://carbondesignsystem.com/components/button/usage/
    (forrás-markdown: https://raw.githubusercontent.com/carbon-design-system/carbon-website/main/src/pages/components/button/usage.mdx)
    *Lényeg:* primary / secondary / tertiary / ghost / danger; „Each page should
    have only one primary button"; `{verb} + {noun}` felirat; sentence case; az
    ikon a felirat jobb oldalán; ikon-only gombhoz kötelező tooltip; danger nem
    lehet ikon-only; állapotok: default, hover, focus, active, disabled, loading.
28. **Atlassian Design System – Button.**
    https://atlassian.design/components/button
    (gép-olvasható kivonat: https://atlassian.design/DESIGN.md)
    *Lényeg:* default / primary / subtle / warning / danger / discovery;
    szekciónként egy `primary`; felszólító, jelen idejű ige; **tilos**: Submit,
    OK, Click here; sentence case; az állapotváltás nem okozhat elrendezés-ugrást.
29. **Shopify Polaris – Actionable language.**
    https://polaris.shopify.com/content/actionable-language
    (2026-08-16-án a shopify.dev-re irányít át; a szabályok nyilvános
    összefoglalója a keresési találatokból ellenőrizve)
    *Lényeg:* `{ige}+{főnév}` képlet, kivétel a bevett rövid parancsok;
    „lead with a strong verb"; névelő nélkül („Add menu item", nem „Add a menu
    item"); kerüld a semmitmondó igéket (View, Go, Read).
30. **Apple Human Interface Guidelines – Buttons / Accessibility.**
    https://developer.apple.com/design/human-interface-guidelines/buttons ·
    https://developer.apple.com/design/human-interface-guidelines/accessibility
    *Lényeg:* legalább **44 × 44 pt** találati terület (visionOS: 60 × 60 pt).
    **Megjegyzés:** az oldal kliensoldalon renderel, ezért a szöveg közvetlen
    letöltéssel nem volt kinyerhető; a 44 pt-es érték az Apple saját
    dokumentációjából származó keresési kivonatból származik, és egybevág a
    WCAG 2.5.5 (AAA) 44 CSS px-ével.
31. **Material Design 3 – Buttons.**
    https://m3.material.io/components/buttons/overview
    *Lényeg:* öt típus emelkedő hangsúllyal (text → outlined → tonal →
    filled/elevated); egy képernyőn egy fő feladat.
    **Megjegyzés:** kliensoldali renderelés miatt közvetlenül nem volt
    kinyerhető; a hangsúly-sorrend a nyilvános összefoglalókból ellenőrizve.
32. **Android Developers – Make apps more accessible.**
    https://developer.android.com/guide/topics/ui/accessibility/apps
    *Lényeg:* „we recommend that each interactive UI element have a focusable
    area, or touch target size, of at least **48dp×48dp**. Larger is even
    better."; ≥ 4,5:1 kontraszt 18sp alatti (vagy 14sp alatti félkövér)
    szövegre, ≥ 3:1 minden más szövegre.

### 7.4 Magyar nyelvi és tipográfiai források

33. **A magyar helyesírás szabályai, 12. kiadás (AkH.)** – MTA
    helyesírási portál. https://helyesiras.mta.hu/helyesiras/default/akh12
    *Hivatkozott pontok:* gondolatjel – 246–247. (elkülönülő gondolatsorok),
    249. b), 251–253. (közbevetés), 257. b), c), 260. (idézés), 259.
    (párbeszéd); nagykötőjel – 264.; kettőspont – 245., 268–269.
34. **Gondolatjel, nagykötőjel, mínuszjel** – MTA Helyes blog.
    https://helyesiras.mta.hu/helyesiras/blog/show/minuszjel
    *Lényeg:* a kiskötőjel nem használható előjelként/műveleti jelként; a
    mínuszjel külön Unicode-karakter (U+2212) és nem törhető.
35. **Gondolatjel és nagykötőjel** – Wikipédia (AkH-pontokkal hivatkozva).
    https://hu.wikipedia.org/wiki/Gondolatjel_és_nagykötőjel
    *Lényeg:* a gondolatjelet szóköz előzi meg és követi, a nagykötőjelet nem;
    a kettő a mai magyar gyakorlatban azonos karakter.
36. **Szedés, mikrotipográfia – A mínuszok családja** – ELTE, Szabadbölcsészet
    (egyetemi tananyag).
    https://mmi.elte.hu/szabadbolcseszet/mmi.elte.hu/szabadbolcseszet/index0e74.html?option=com_tanelem&id_tanelem=956&tip=0
    *Lényeg (a legfontosabb tétel ehhez a doksihoz):* „a jelenlegi gyakorlatban
    magyar szövegekben az angol m-dash (kvirtmínusz) írásjelként **nem
    használt**"; „a gondolatjel és a nagykötőjel a mai magyar használatban
    azonos karakter (félkvirtmínusz)"; „a gondolatjelet szóközök veszik körbe, a
    nagykötőjelet… nem".
37. **Kiskötőjel, nagykötőjel, gondolatjel** – Nyelv és Tudomány (nyest.hu).
    https://www.nyest.hu/hirek/kiskotojel-nagykotojel-gondolatjel
    *Lényeg:* a három jel elkülönítése és tipikus hibái. **Megjegyzés:** a lap
    2026-08-16-án 503-as hibát adott; a tartalma a keresési kivonatból
    ellenőrizve, és egybevág a 35–36. tétellel.

38. **Shopify Polaris – Vocabulary.** https://polaris.shopify.com/content/vocabulary
    *Lényeg:* a kulcsfogalmak és cselekvések szinonimáit azonosítani és
    felszámolni kell – egy dologra egy szó. (A `docs/gomb-inventar.md` §5.2
    hivatkozza; ez a 3.2 szótár közvetlen alapja.)
39. **NN/g – Plain Language Is for Everyone, Even Experts.**
    https://www.nngroup.com/articles/plain-language-experts/
    *Lényeg:* az egyszerű, rövid mondat még szakértő közönségnél is jobban
    teljesít – ez a 3.1.3 „pont helyett gondolatjel" cseréinek alapja.
40. **NN/g – Buttons vs. Links** (videó) ·
    **Command Links.**
    https://www.nngroup.com/videos/buttons-vs-links/ ·
    https://www.nngroup.com/articles/command-links/
    *Lényeg:* ami másik oldalra visz, az link; ami cselekvést hajt végre, az
    gomb – a vizuális stílus ezt nem írhatja felül (2.1).
41. **Material Design 3 – Applying states.**
    https://m3.material.io/foundations/interaction/states/applying-states
    *Lényeg:* az állapotok (enabled, hovered, focused, pressed, dragged,
    disabled) rendszerszintűek, nem komponensenként kitaláltak.
42. **WCAG 2.2 – Understanding SC 4.1.3 Status Messages (AA).**
    https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html
    *Lényeg:* a siker/hiba visszajelzés fókuszmozgatás nélkül is eljut a
    kisegítő technológiához (L-3 alapja).

### 7.5 Amihez NEM találtam elfogadható forrást – kimondva

- **Az E/1 („Megveszem") vs. E/2 („Vedd meg") magyar CTA-hatás.** Egyetlen,
  gyakran idézett angol nyelvű A/B-teszt létezik (ContentVerve/Unbounce, 2013:
  a „start **my** free 30-day trial" +90 % kattintás; „create account" vs
  „create **your** account" −24,91 %), amelyet a szakirodalom nem replikált
  rendszeresen, és amely **nem magyar nyelvű**. A design-rendszerek
  (Carbon, Polaris, Atlassian, GOV.UK) egységesen felszólító alakot írnak elő,
  az NN/g nem foglal állást. **Ez tehát vezetői döntés volt, nem kutatási
  tény** – és 2026-08-16-án meg is született (1.4/Ü5, 3.1.5/P-1). **Ami
  mérésen alapul, és ezért nem vélemény:** a régi `www.kineticare.hu` gombjai
  100 %-ban E/1-ben álltak (`docs/regi-oldal-osszehasonlitas.md` 3.1, 3.4) –
  ez a *megszokásra* nézve bizonyíték (Jakob törvénye), a *hatékonyságra* nézve
  továbbra sincs magyar nyelvű mérésünk. Ha valaha lesz A/B-kapacitás, ez az
  első mérendő tétel (6.5).
- **A gondolatjel-sűrűség konkrét számhatára** (3.1.3, „1 / 200 szó"). Ez
  **konvenció**, nem mérés; a *tilalmi* rész viszont (UI-címkékben nulla,
  U+2014 magyar szövegben nem használt) forrásolt.
- **Magyarra validált olvashatósági képlet** – a `ux-belso-oldalak-kutatas.md`
  B8.2 már rögzítette, hogy nincs ilyen; a Flesch–Kincaid-mutatók angolra
  kalibráltak. Ezért a 6.1 sorhossz-mérés **karakterszám-alapú**, nem
  pontszám-alapú.
- **A vélemény-blokk hossza és helye** (`ertekesitesi-ux-skill.md` M6) – a
  testvér-doksi 3.9/2. pontja szerint erre nincs kutatási alap; itt sem
  találtam. Vélemény-alapú szabályként megtartandó vagy A/B-vel mérendő.

### 7.6 A 2026-08-16-i CTA-döntéshez (1.1) ellenőrzött további források

Ezek a tételek az Ü5-döntés utáni szótár-átíráshoz és a négy új sorhoz
(#19–#22) készültek. Ellenőrizve: **2026-08-16**.

43. **IBM Carbon Design System – Remove pattern (remove ≠ delete).**
    https://v10.carbondesignsystem.com/community/patterns/remove-pattern/
    *Szó szerint:* „**Removing** is an action that moves information from one
    location to another. Removal can be both destructive and non-destructive.
    **Deletion** is the most common type of removal and is destructive."
    A helyreállítható műveletre a *remove* alak való, a *delete* a
    visszafordíthatatlanra. **A #19 sor alapja:** a kosárból kivett tétel nem
    semmisül meg, ezért „Kiveszem a kosárból", nem „Törlés".
    *(Kiegészítő, ugyanerről:* https://carbondesignsystem.com/guidelines/content/action-labels/
    *– a `{ige}+{főnév}` képlet és a bevett rövid parancsok kivétel-listája:
    Done, Close, Cancel, Add, Delete. Az oldal glosszárium-komponensből
    renderel, ezért a szöveg csak a nyilvános összefoglalókból volt kinyerhető;
    a 27. tétellel egybevág.)*
44. **GOV.UK Design System – Button: „Writing button text".**
    https://design-system.service.gov.uk/components/button/
    *Szó szerint (a döntéshez használt tételek):* a fizetési lépésre „**Pay**";
    a mentéssel járó továbblépésre „**Save and continue**"; a záró, jogi
    következményű lépésre „**Confirm and send**" / „**Accept and send**";
    letiltott gombra: „*Disabled buttons have poor contrast and can confuse
    some users, so avoid them if possible.*"; destruktív műveletnél „*use
    another style of button for the initial call to action, and a warning
    button for the final confirmation*".
    **A #2, #16 és #20 sor alapja.**
45. **Baymard Institute – Checkout flow UX optimization.**
    https://baymard.com/learn/checkout-flow-ux-optimization
    *Lényeg:* a kosár és a checkout elsődleges CTA-ja legyen **explicit és
    cselekvés-vezérelt**, a homályos „Continue" helyett a következő lépést vagy
    a véglegesítést megnevező felirat. **A #2 és #20 sor alapja.**
46. **Régi-oldal mérés (belső, reprodukálható):
    `docs/regi-oldal-osszehasonlitas.md` 3.1 és 3.4.**
    *Mérés:* a `www.kineticare.hu` 11 útvonalának `<a>`/`<button>`
    kivonatolása. *Eredmény:* minden cselekvés-gomb E/1
    (`KÉREM A PROGRAMOT`, `KÉREM A VILLÁMKURZUST`, `KÉREM A HOZZÁFÉRÉST`,
    `KÉREM AZ ÉRTESÍTÉST`, `MEGRENDELEM`, `MEGNÉZEM`, `ELKÜLDÖM`), **egyetlen
    felszólító alakú gombfelirat sincs**. Ez a P-1a szabály és a #2, #3, #12,
    #21 sor Jakob-törvény szerinti alátámasztása
    ([NN/g – Jakob's Law](https://www.nngroup.com/videos/jakobs-law-internet-ux/)).

---

## A. Függelék – amit a jelenlegi kód ma megsért

Bizonyítékkal (fájl:sor), a súlyosság sorrendjében. Ez a lista a következő
végrehajtási kör bemenete; a javítás **nem** ennek a doksinak a feladata.

> **Munkamegosztás a `docs/gomb-inventar.md`-vel.** Az a doksi ugyanezen a napon,
> párhuzamosan készült, és **teljesebb per-fájl cserelistát** ad (§7.2: ~30 sor
> konkrét szöveg-csere; §4: oldalankénti gomb-leltár; §3: az „ingyenes" négy
> egymásnak ellentmondó definíciója, éles méréssel). **Az alábbi tíz tétel nem
> helyettesíti azt**, hanem a *szabályhoz* köti a bizonyítékot. Ahol átfedés van
> (A/1, A/2, A/3, A/4, A/6), ott a **`gomb-inventar.md` a végrehajtás forrása**;
> ahol nincs (**A/8 destruktív gomb-változat, A/9 tiltott hibaszavak,
> A/10 hibaösszegzés, és az A/1 „0 Ft" konfigurációs csapdája**), ott ez a
> doksi az egyetlen forrás.

| # | Megsértett szabály | Bizonyíték | Miért baj |
|---|---|---|---|
| **A/1** | 3.2 #16, Á-3, NN/g „a link ígéret" | `src/lib/courses.ts:103–110` és `:133–139` – archivált és ismeretlen státuszú termék CTA-felirata `'Megveszem'`, letiltva | A felirat vásárlást ígér ott, ahol nem lehet vásárolni. Helyette: a gomb eltűnik, a magyarázó mondat marad. |
| **A/2** | 3.1.1, ELTE-tipográfia | Repó-szintű mérés: **4688 db U+2014 (`—`)** és 391 db U+2013 (`–`); látogatói szövegben pl. `src/lib/courses.ts:119` `'Ingyenes — azonnal eléred'`, `src/components/content/home/FreeSos.tsx:65` `'SOS Kézrelax — ingyenes villámkurzus'`, `src/components/courses/MobileBuyBar.tsx:81` `aria-label={…' — vásárlás'}`, `src/components/courses/CourseCard.tsx:30`, `src/components/layout/Header.tsx:38` `aria-label="Kineticare — kezdőlap"` | A kvirtmínusz **nem magyar írásjel**, és elválasztóként a gondolatjel sem az. Ez a tulajdonos „AI-szagú" kifogásának pontos oka. |
| **A/3** | Á-4, WCAG 4.1.2 | `src/components/ui/Button.tsx:101–107` – letiltott link-gomb `<span className={classes} aria-disabled="true">` | Szerep nélküli `<span>`-en az `aria-disabled` nem jut el a kisegítő technológiához, az elem pedig nem is fókuszálható: a billentyűzetes látogató **soha nem tudja meg**, hogy létezik és miért nem működik. |
| **A/4** | B-3, K-1, NN/g „nonclickable items" | `src/components/content/ProductCard.tsx:230–232` (`<span aria-hidden="true" className="kc-product-card__cta">`) + `src/app/(frontend)/styles/blocks/course-cards.css:186–201` (`background-color: var(--kc-color-primary)`, `min-height: 2.75rem`, `border-radius`) | Minden kurzuskártyán egy **elsődleges gombnak látszó, nem kattintható** elem áll. A kezdőlapon így a hero `primary`-ja mellé kártyánként egy ál-`primary` kerül. |
| **A/5** | M-2 / **P-1**, C-1 | Vegyes személy **szabály nélkül**: `courses.ts:106` `'Megveszem'`, `ProductCard.tsx:54` `'Megnézem a programot'`, `NewsletterForm.tsx:155` `'Feliratkozom'`, `FreeSos.tsx:71` `'Elindítom az ingyenes kurzust'` (E/1) ↔ `kapcsolat/_lib/validation.ts:43,47,53,57` `'Add meg a neved.'`, `'Írd meg az üzeneted.'` (E/2) | **1.1-es állapot:** a személy-keveredés önmagában már nem hiba – a **P-1** (3.1.5) megmondja, melyik elemen melyik a helyes, és a fenti E/1-es gombok többsége eszerint **helyes marad**. Ami A/5-ként hiba marad: (a) a `'Megnézem a programot'` **navigáció** E/1-ben (P-1b sérül, ráadásul ál-gomb – A/4); (b) a `'Elindítom az ingyenes kurzust'` eltér a #3/#4 egységes feliratától; (c) a deverbális főnévi gombok (`'Üzenet küldése'`, `'Jelszó beállítása'`, `'Visszaállító link küldése'`, `'Számla letöltése'`, `'Törlés'`) – M-1. |
| **A/6** | C-1, WCAG **3.2.4** | Ugyanaz a cél (`/kurzusok`) öt feliratot kap: `Header.tsx:44` `'Kurzusok'`; `home/HeroCta.tsx:13` `'Kurzusok megtekintése'`; `home/CourseCards.tsx:142` `'Összes kurzus megtekintése'`; `src/lib/home-seed.ts:585` `'Megnézem a kurzusokat'`; `ProductCard.tsx:54` `'Megnézem a programot'` | „Components that have the same functionality… are identified consistently" – ez öt névvel nem teljesül. |
| **A/7** ✔ **JAVÍTVA, 2026-09-05** | N-4, WCAG 1.4.1, GOV.UK Service navigation | A fő- és láblécnavigáció pontos linkje `aria-current="page"`, az ős külön `data-ancestor-active` állapotot kap. Minden nézetben KC-kék + aláhúzás jelöl, a fókuszkörvonal megmarad. Őr: `src/__tests__/nav-current.test.tsx`; böngészős bizonyíték: N-4/N-5 jegyzőkönyv fent. | A látogató vizuálisan és képernyőolvasóval is megkapja a „hol vagyok?” választ; exact route, query/hash, záró perjel és szegmenshatár védett. |
| **A/8** | 2.2 4. szint (Carbon *danger*, GOV.UK *warning*) | `src/components/ui/Button.tsx:29` – `variant?: 'primary' \| 'secondary' \| 'ghost'`; destruktív változat nincs. Használat: `src/components/admin/RefundPanel.tsx` | A visszatérítés és a hozzáférés-visszavonás ugyanolyan gombot kap, mint egy mentés – pedig ezek visszafordíthatatlanok. |
| **A/9** ✔ **JAVÍTVA, 2026-08-22** | 2.7 (GOV.UK: „please" tilos, „valid/invalid" tilos) | A megállapításkor **39 üzenetben élt a „Kérjük"** (29 nagybetűs + 10 kisbetűs alak, pl. `refund/route-handler.ts:49,55`) és **15 üzenetben a címkéző „Érvénytelen"**. A javító kör mind az 54 üzenetet átírta a §2.7 mintájára (mi történt + mit tegyen a látogató, tegezve): checkout, visszatérítés, kurzus-haladás, hozzáférés-adás, videó, előnézet, jelszó-visszaállítás, kérés-korlát, a három űrlap (kapcsolat, hírlevél, időpontkérés) és a vevőnek menő e-mail-sablonok. A hozzájárulás-hiba mind a három űrlapon SZÓ SZERINT azonos lett (`Pipáld be az adatkezelési hozzájárulást.`, WCAG 2.2 SC 3.2.4). | A „Kérjük" választást sugall ott, ahol nincs; az „Érvénytelen" nem mondja meg, mi a baj és hogyan javítható. **Ma őr védi: G-UI7** (`src/__tests__/g-ui7-tiltott-hibaszavak.test.ts`) – a kommenteket maszkolja, tehát a szabályt IDÉZŐ magyarázatok maradhatnak. **Ismert határ:** a kisbetűs, LEÍRÓ „érvénytelen" (pl. „a régi link érvénytelenné válik") szándékosan megengedett, mert az tényt közöl, nem címkéz. |
| **A/10** | 2.7 (GOV.UK hibaösszegzés) | `src/components/checkout/CheckoutForm.tsx:189` – a lap tetején **csak a beküldési hiba** él (`CheckoutErrorRegion`); a mezőnkénti hibák (`guestErrors`, `billingErrors`, sorok 213–291) nincsenek összegezve és nincsenek a mezőkre linkelve | Hosszú pénztár-űrlapon a képernyő alján lévő hibát a látogató nem találja meg; a GOV.UK ezért követeli meg a lap tetején álló, mezőre ugró hibaösszegzést. |

**Az A/1 mellékága (konfigurációs csapda):** ha egy terméken
`priceInHUFEnabled: true` és `priceInHUF: 0`, akkor a `coursePriceHuf`
(`src/lib/courses.ts:181–190`) érvényes **0**-t ad vissza, tehát
`coursePriceBadgeKind` `'price'`-ot mond, a `resolveCourseCta` pedig `'buy'`-t –
azaz a felület **„0 Ft" ár mellé „Megveszem" gombot** rajzol. Ez a tulajdonos
által jelzett „ingyenes terméken Megveszem" hiba legvalószínűbb élő útja.

**Ellenőrizve a párhuzamos kör javítása UTÁN is (2026-08-16):** az újonnan
bevezetett `isFreeCourse()` / `hasUnsetPriceFlag()` (lásd Ü4) ezt az ágat
**nem** fedi le — `priceInHUFEnabled: true` mellett `isFreeCourse()` hamis, a
`coursePriceHuf` pedig változatlanul visszaadja a 0-t. **A csapda tehát nyitva
van.** Javítás: a `coursePriceHuf` a nem pozitív árat (`<= 0`) kezelje
érvénytelenként (`null`), és a hívók a `'none'` (hiányos konfiguráció) ágra
essenek vissza — nem a `'buy'`-ra. Őr-teszt: `resolveCourseCta` 0 Ft-os,
árazásra kapcsolt termékre **soha** ne adjon `'buy'` kindet.
