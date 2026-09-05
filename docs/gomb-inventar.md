# Gomb- és CTA-inventár (Kineticare vevői felület)

**Készült:** 2026-08-16 · **Auditor:** gomb- és CTA-inventár ügynök
**Hatókör:** kizárólag a VEVŐI (storefront) felület. Az admin nem tárgya.
**Módszer:** kód-olvasás (`main` @ `92dc88c`) + ÉLES HTML-mérés a `https://kineticare-production.up.railway.app` szolgáltatáson (csak GET, 2026-08-16). A `www.kineticare.hu` a mérés idején még a RÉGI oldalt szolgálja ki, ezért az élő ellenőrzés a Railway-domainen történt.

## 0. Ez a doksi mit dönt el, és mit nem

Három doksi készült párhuzamosan, átfedő tárggyal. A munkamegosztás:

| Doksi | Mit mond ki | Viszony |
| --- | --- | --- |
| **`docs/ui-sztenderdek.md`** | **NORMATÍV.** A gomb-rendszer, az állapotok (§2.3), a méret (§2.4), a magyar mikroszöveg-szabályzat (§3.1) és **a jóváhagyott CTA-szótár (§3.2)**. | **Ez az elsőbbség.** Ütközés esetén az ő szövege győz. |
| **`docs/informacios-architektura.md`** | Útvonal-térkép, zsákutcák, árva oldalak, duplikált utak, menü-taxonómia. | Az IA-hibák ott vannak számozva (TOP 10). Itt csak hivatkozom rájuk. |
| **`docs/gomb-inventar.md`** (ez) | **A MÉRT LELTÁR**: minden kattintható elem oldalanként, élő HTML-ből; a szinonimák leképezése a §3.2 szótárra; a „három ingyenes-definíció" gyökérok-elemzése patch-javaslattal és tesztlistával. | Bemenet a másik kettőhöz. Új CTA-feliratot **nem én hagyok jóvá**: amit itt hiányként találok, azt a §3.2 táblázatába kell felvenni. |

**Amit korábbi változatomból VISSZAVONTAM.** Az első verzióm saját CTA-szótárt javasolt („Indítom a kurzust", „Belépek", „Írok nektek", „Küldöm…"). Ez hiba volt: a `ui-sztenderdek.md` §3.2 már jóváhagyott, forrásolt szótárt tartalmaz, és a §3.2 használati szabálya kimondja, hogy „új felirat csak akkor kerülhet be, ha ez a táblázat bővül". A javaslataim több ponton ütköztek is vele (a §3.2 L-1 sora szerint a folyamatban-felirat `Küldés…`, nem `Küldöm…`). Az 5. fejezet ezért most **leképezés**, nem szótár.

---

## 1. Vezetői összefoglaló

A tulajdonos két panasza mérhetően igazolódott.

**(a) „Az ingyenes kurzuson »Megveszem« a gomb."** Igazolt, és rosszabb, mint amilyennek látszik. Nem csak a felirat rossz: az egész ingyenes vásárlási út zsákutca. A gomb a fizetős pénztárba visz, ott a vevő kitölti a számlázási adatait, kipipálja a két jogszabályi elállási nyilatkozatot, megnyomja a „Megrendelés és fizetés" gombot, és a szerver `400`-zal elutasítja: *„A termékhez nem tartozik érvényes ár, így nem vásárolható meg."* (`src/lib/checkout/start-checkout.ts:260`). Az ingyenes kurzus jelenleg **nem szerezhető meg a weboldalon keresztül**.

**(b) „A gombok működése és a felhasználói folyamat nem konzisztens."** Igazolt. A kezdőlapon **hét különböző felirat** visz a `/kurzusok`-ra. A gondolatjeles írásmód végigfut a felületen, ráadásul a használt karakter (U+2014) a magyar tipográfiában nem is írásjel (`ui-sztenderdek.md` §3.1.1).

**Számok.** 11 vevői útvonal, 45 komponens, **118 kattintható elem** leltárba véve.

**A legfontosabb új eredmény.** A mérésem **megcáfol** egy hipotézist, amit a másik két doksi is átvett: nem a `priceInHUFEnabled: true` + `priceInHUF: 0` konfiguráció okozza az élő hibát. Ha az lenne, a buybox „0 Ft" árat írna ki. Nem ír ki semmit. A bizonyítás a 3.3 pontban.

> ### ⚠ Az audit közben a kód megváltozott
>
> A leltár felvétele után egy párhuzamos ügynök **átalakította** a
> `src/lib/courses.ts` és a `src/lib/free-course-grant.ts` fájlokat. A 3. fejezetet
> ehhez a friss állapothoz igazítottam (az eredeti, három egymásnak ellentmondó
> definíciót leíró elemzés a 3.2-ben archív hivatkozásként maradt meg).
>
> **A helyzet most:** a „három ingyenes-definíció" **meg van szüntetve**, egyetlen
> igazságforrásra (`isFreeCourse`) vezetve. **A tulajdonos által jelzett hiba
> viszont NINCS megjavítva:** az élő SOS-kurzuson továbbra is „Megveszem" áll, és
> a pénztár továbbra is 400-zal elutasítja. Az ok most már **kettős**: egy
> megmaradt kód-rés (a CTA és a checkout-kapu nem ugyanazt mondja) **és** egy
> adathiba az élő terméken. Mindkettő javítása szükséges, a részletek a 3.4-3.6-ban.

---

## 2. Súlyozott hibalista

A `ui-sztenderdek.md` §A (A/1 … A/10) és az `informacios-architektura.md` TOP 10 megállapításait **nem ismétlem meg**. Az alábbi táblázat két oszlopa mutatja, mi az, ami már máshol számozva van, és mi az, amit ez a leltár tesz hozzá.

### 2.1 Blokkoló

| # | Hiba | Máshol | Amit ez a leltár hozzátesz |
| --- | --- | --- | --- |
| **B1** | Az ingyenes kurzus „Megveszem" gombja fizetős pénztárba visz, ahol a beküldés 400-zal elhasal | IA TOP-10 #3, `ui-szt.` A/1 | **A pontos mechanizmus és a cáfolat** (3.3), a négy döntési pont leltára (3.2), a patch (3.5), a tesztek (3.6) |
| **B2** | Az ingyenes kurzuson sehol nem jelenik meg, hogy ingyenes | IA TOP-10 #3 | Mért bizonyíték: `kc-course-buybox__price` előfordulás = **0**; a `MobileBuyBar` `priceLabel`-je is `null` |
| **B3** | Ugyanez a `/kurzusok` listán: az SOS-kártyán se ár, se „Ingyenes" | - | **Új.** A lista `CourseCard`-ja csak `coursePriceHuf`-ot néz (`CourseCard.tsx:52`), tehát a `'free'` badge-et meg sem tudja jeleníteni. A fizetős kártyán ott az „Ár: 79 500 Ft" |
| **B4** | Nincs kijelentkezés | IA TOP-10 #6 | - |
| **B5** | Nincs belépés/fiók a fejlécben | IA TOP-10 #2 | - |
| **B6** | ~~A kosár bejelentkezésre kényszerít, a pénztár nem~~ **lezárva 2026-08-27** | IA TOP-10 #5 (árvaság) | A `CartView` fizetős sávja vendégként is `ctaLabel('cart-to-checkout')` → `/penztar?termek=`. A pénztár vendég-vásárlást 2026-08-15 óta fogad. |
| **B7** | A kezdőlapi „Elindítom az ingyenes kurzust" a listára visz, nem a kurzusra | IA TOP-10 #7 | **A gyökérok:** nem (csak) a `FreeSos.tsx:70-73` fallback, hanem a **seed-adat**: `src/lib/home-seed.ts:305` explicit `url: '/kurzusok'`-ot ír a blokk `cta` mezőjébe, ami felülírja a kód helyes alapértékét |

### 2.2 Komoly (csak az újak)

| # | Hiba | Hol | Miért |
| --- | --- | --- | --- |
| **K1** | **Az `aria-label` némán elveszik a `Button` komponensen.** A kosár „Törlés" gombja `aria-label={\`Törlés: ${item.sku}\`}`-t kap, de a `ButtonProps` nem ismeri és a komponens nem terjeszti tovább. A `npm run typecheck` **zölden fut** (mérve), mert a kötőjeles JSX-attribútum nem esik a TypeScript fölös-property-ellenőrzése alá. | `CartView.tsx:82` + `Button.tsx:27` | Több tétel mellett a képernyőolvasó csak ismétlődő „Törlés"-t mond. Sérti a `ui-szt.` C-5 szabályát (WCAG 2.5.3) |
| **K2** | **Öt hand-rolled `kc-button` osztályú link** kerüli meg a `Button` primitívet: nincs `sanitizeCmsUrl`, nincs egységes disabled/új-lap kezelés, és egy jövőbeli `Button`-javítás nem éri el őket. | `ResetPasswordForm.tsx:61`, `MobileBuyBar.tsx:88`, `penztar/page.tsx:90,107`, `lexical/serialize.tsx:228` | A `ui-szt.` A/3 csak a `Button` belsejét kifogásolja; ezek **kívül** vannak rajta |
| **K3** | **A „Visszaállító link küldése" gomb alapból letiltva**, magyarázat nélkül (`disabled={submitting \|\| !email.trim()}`). Élőben mérve: `kc-button--disabled` + `disabled` az első renderben. | `ForgotPasswordForm.tsx:72` | `ui-szt.` §2.3 5. sor: a disabled mellé **kötelező** magyarázó szöveg; Á-3: inkább ne legyen letiltva |
| **K4** | **A `ForgotPasswordForm` sikerképernyője zsákutca**: nincs továbblépés, nincs „nem érkezett meg" út. | `ForgotPasswordForm.tsx:41` | IA-elv: zsákutca tilos |
| **K5** | **A süti-sáv külön vizuális nyelvet beszél**: inline `style` objektumok, nem `kc-button`, és **magázódik** („a hozzájárulásával"), miközben az egész oldal tegez. | `ConsentBanner.tsx:70-91,163` | `ui-szt.` M-2 (egységes te-forma) + A/5 (vegyes megszólítás). A §3.2 #18 sora a feliratokat is előírja |
| **K6** | **A `/kurzusok` kártyáin nincs CTA**, a kezdőlapi kártyán van (a `ui-szt.` A/4 szerint hibás ál-gomb). Ugyanaz az objektum két helyen két szerződéssel. | `CourseCard.tsx` vs `ProductCard.tsx:230` | `ui-szt.` C-2 (azonos cselekvés = azonos súly) |
| **K7** | **Két képernyőolvasó-utility osztály él**: `kc-visually-hidden` (globális, `base.css:159`) és `kc-sr-only` (kizárólag `player.css:53`). A lejátszón kívül a `kc-sr-only` nem működne. | `CoursePlayer.tsx`, `CurriculumRail.tsx`, `LessonBody.tsx` | Csendes törésveszély kiemeléskor |
| **K8** | **A `/kurzusok` kártyán két link ugyanarra a célra** (borító + cím). A borító `tabIndex={-1}`, tehát Tab-bal kimarad, de a képernyőolvasó link-listájában duplán szerepel. | `CourseCard.tsx:30,47` | WCAG 2.4.4 |
| **K9** | **A `/penztar` „be is jelentkezhetsz" linkjén nincs `returnUrl`**, tehát belépés után a vevő elveszíti a megkezdett pénztárat. | `CheckoutForm.tsx:209` | Zsákutca a vásárlás közepén |
| **K10** | **Latens hiba: 0 Ft-os termék Barion-fizetést indítana.** Az `assertPurchasable` csak `typeof priceInHUF === 'number'`-t követel, a `0` átmegy rajta. | `start-checkout.ts:260` | A `ui-szt.` Ü4 a megjelenítést rendezi; a **szerver-oldali kaput** senki nem javítja. A 3.5 patch ezt is lezárja |

### 2.3 Kozmetikai (csak az újak)

`Z1` „Új jelszó mégegyszer" helyesen „még egyszer" (`ResetPasswordForm.tsx`). ·
`Z2` „Számlázási adatok (opcionális — a checkout előtölti)": angol szakszó a vevői szövegben, gondolatjellel (`RegisterForm.tsx:90`). ·
`Z3` A `→` nyíl hol a felirat része, hol külön `aria-hidden` span, hol nincs (`ui-szt.` C-4 hatálya). ·
`Z4` A `CourseJumpNav` „Ugrás:" látható felirata és a `nav aria-label` („Ugrás az oldal szakaszaira") redundáns (`CourseJumpNav.tsx:32`). ·
`Z5` A `/blog` üres listája üres állapot nélkül renderel (az IA TOP-10 #4 az ürességet rögzíti, az **üres állapot hiányát** nem). ·
`Z6` A köszönőoldal `polling` ágán emodzsi a betöltésjelző (`⏳`, `ThankYouView.tsx:225`), miközben a `ui-szt.` §2.3 6. sora spinner + élő régió párost ír elő.

---

## 3. Gyökérok: a „három ingyenes-definíció"

### 3.1 A séma

```
/tables/public.products/columns/price_in_h_u_f_enabled
  { "type": "boolean", "notNull": false }      ← src/migrations/20260729_231123_initial_schema.json
```

**Nullable boolean, alapérték nélkül.** Háromállapotú mező: `true` / `false` / `NULL`. A `NULL` nem szélsőség, hanem **az alapállapot** minden olyan terméknél, ahol a pipát soha nem mentették el explicit módon. A mező a plugin `pricesField`-jéből jön, a repó csak az admin-leírását írja felül (`src/plugins/ecommerce.ts:122`).
### 3.2 A definíciók: akkor és most

**AHOGY A LELTÁR FELVÉTELEKOR VOLT (archív, `92dc88c`).** Négy hely döntötte el ugyanezt a kérdést, egymásnak ellentmondóan. A `NULL` (beállítatlan) ár-pipára:

| # | Hely | Feltétel | `NULL`-ra |
| --- | --- | --- | --- |
| 1 | `courses.ts` `resolveCourseCta` | `=== false` | nem ingyenes → „Megveszem" |
| 2 | `courses.ts` `coursePriceBadgeKind` | `=== false` | `'none'` → se ár, se címke |
| 3 | `free-course-grant.ts` | `{ not_equals: true }` | **ingyenes** → purchases-be kerül |
| 4 | `home/CourseCards.tsx` `isPaidProduct` | `=== true && number` | nem fizetős |

**AHOGY MOST VAN.** Egy párhuzamos ügynök egyetlen igazságforrásra vezette a kérdést, és a **szigorú** oldalon zárta le:

- `courses.ts:87` **`isFreeCourse(product)` = `priceInHUFEnabled === false`**. Ez a kanonikus definíció; a fejkomment kimondja, hogy a beállítatlan érték nem ingyenes, hanem hiányos konfiguráció.
- `courses.ts:98` **`hasUnsetPriceFlag(product)`** = se nem `true`, se nem `false`. Új, harmadik állapot, plusz egy `reportUnpricedPublishedCourses` diagnosztika a szerkesztői hiba felderítésére.
- `courses.ts:314` **`isPaidCourse(product)`** = `coursePriceHuf(product) !== null`.
- `free-course-grant.ts:97` a lekérdezés **`{ priceInHUFEnabled: { equals: false } }`**-re szigorodott.

**Ez jó döntés, és jobb az én eredeti javaslatomnál egy fontos szemponton.** A régi `not_equals: true` miatt egy publikált, de még be nem árazott kurzust **minden belépő felhasználó ingyen megkapott**, és az ár utólagos beállítása után is bent maradt a jogosultságában. Ez bevételkiesés. Az én első javaslatom (a CTA lazítása a grant felé) ezt a rést nyitva hagyta volna. A szigorítás lezárja.

### 3.3 Empirikus igazolás, és egy hipotézis cáfolata

```
GET /kurzusok/sos-kezrelax-villamkurzus
  „Megveszem" a nyers HTML-ben:      4×  (2 renderelt gomb + 2 az RSC flight-payloadban)
  kc-course-buybox__price blokk:     0×
  MobileBuyBar priceLabel:           nincs kiírva
  buybox + buybar CTA href:          /penztar?termek=2

GET /penztar?termek=2
  Elállási jog kártya:               MEGJELENIK (a fizetős ág)
  submit felirat:                    „Megrendelés és fizetés"
  ár / „Ingyenes" az összefoglalón:  EGYIK SEM
```

**A cáfolat.** A `ui-sztenderdek.md` §A „Az A/1 mellékága" szerint a `priceInHUFEnabled: true` + `priceInHUF: 0` konfiguráció „a tulajdonos által jelzett hiba legvalószínűbb élő útja". **Ez a mérés szerint nem áll.** Ha `priceInHUF` értéke `0` volna, akkor `coursePriceHuf` véges számot adna, `coursePriceBadgeKind` `'price'`-ot mondana, és a buybox **kirenderelné** a `kc-course-buybox__price` blokkot „0 Ft" felirattal. A mért érték **0 előfordulás**. Tehát `priceInHUF` nem szám, és a badge a `'none'` ágon áll.

**Amit a mérés nem dönt el, és ezt kimondom:** a nyilvános HTML-ből nem különböztethető meg a `priceInHUFEnabled: true` + `priceInHUF: null` és a `priceInHUFEnabled: null` + `priceInHUF: null` eset, mert mindkettő ugyanoda fut (`'none'` badge, `'buy'` CTA). A szétválasztáshoz adatbázis-hozzáférés kell. **A javítás szempontjából ez most már számít**, lásd 3.5 (a két eset más beavatkozást igényel).

**Mellékhatás.** A `free: priceBadge === 'free'` jelzés (`kurzusok/[slug]/page.tsx:279`) is hamis, tehát az ingyenes kurzus a FIZETŐS értékesítő szövegváltozatot kapja. Élőben mérve a SOS-oldalon: „Megveszed / Bankkártyás fizetés a Barionon keresztül."

### 3.4 A megmaradt kód-rés: a CTA és a checkout-kapu nem ugyanazt mondja

A refaktor a definíciót egységesítette, de a **vásárolhatóság** kérdését nem. Ma:

| Termék-állapot | `resolveCourseCta` (`courses.ts:192-213`) | `assertPurchasable` (`start-checkout.ts:260`) | Egyezik? |
| --- | --- | --- | --- |
| published, `false` (ingyenes) | `'free'` → `/kurzusaim` | nem is hívódik | igen |
| published, `true` + ár | `'buy'` → `/penztar` | átenged | igen |
| published, `true` + `null` ár | **`'buy'` → `/penztar`** | **400 elutasít** | **NEM** |
| published, `null` (beállítatlan) | **`'buy'` → `/penztar`** | **400 elutasít** | **NEM** |

**A felület tehát olyan vásárlást kínál, amit a szerver garantáltan elutasít.** Ez pontosan a tulajdonos által jelzett tünet, és pontosan az, amit a `ui-sztenderdek.md` §3.2 #16 sora és az NN/g „a link ígéret" elve tilt. A `hasUnsetPriceFlag` függvény már létezik a felismeréshez, de a **CTA-állapotgép nem használja**.

**A szabály, aminek teljesülnie kell:**

> `resolveCourseCta(...).kind === 'buy'` **akkor és csak akkor**, ha `assertPurchasable` nem dobna. Ha a termék nem vásárolható meg, a felület ne kínálja vásárlásra.

### 3.5 Mit kell javítani

A javítás most **kétrészes**: egy kicsi kód-változtatás és egy adatjavítás. Az eredeti, nagy patch-javaslatom nagy része tárgytalanná vált.

**(1) KÓD: a `resolveCourseCta` published ága ne adjon `'buy'`-t nem vásárolható termékre.**

A szignatúra bővül `priceInHUF`-fal (ma csak `'id' | 'status' | 'priceInHUFEnabled'`):

```diff
 export function resolveCourseCta(
-  product: Pick<Product, 'id' | 'status' | 'priceInHUFEnabled'>,
+  product: Pick<Product, 'id' | 'status' | 'priceInHUF' | 'priceInHUFEnabled'>,
   purchased: boolean,
 ): CourseCtaState {
@@ published ág
     if (isFreeCourse(product)) {
       return { kind: 'free', … }
     }
+    // HIÁNYOS ÁR-KONFIGURÁCIÓ: a checkout kapuja (assertPurchasable,
+    // start-checkout.ts) ezt a terméket 400-zal elutasítaná, ezért NEM
+    // kínáljuk vásárlásra. A felület sosem ígérhet olyan cselekvést, amit a
+    // szerver garantáltan visszautasít (docs/ui-sztenderdek.md §3.2 #16;
+    // NN/g: a link ígéret). Mérve élesben 2026-08-16: az SOS-kurzus ebbe az
+    // ágba esett, és „Megveszem" gombot mutatott.
+    if (!isPaidCourse(product)) {
+      return {
+        kind: 'unavailable',
+        label: 'Megveszem',
+        href: null,
+        disabled: true,
+        note: null,
+      }
+    }
     return { kind: 'buy', … }
```

A `CourseCta.tsx:20` és a `CourseBuybox.tsx:34` prop-típusa `priceInHUF`-fal bővül; a hívó (`kurzusok/[slug]/page.tsx:445`) teljes `Product`-ot ad át, ott nincs teendő.

**Megjegyzés a felirathoz és az `unavailable` ág megjelenéséhez.** Az `unavailable` ág ma is „Megveszem" feliratú, letiltott gombot ad, magyarázat nélkül. Ez a `ui-sztenderdek.md` §3.2 **#16** és **Á-3** szerint önmagában hibás (`ui-szt.` A/1). A helyes végállapot: **nincs gomb**, helyette magyarázó mondat. Ezt a `CourseCta.tsx`-ben kell megoldani, és az `archived` ággal együtt érdemes rendezni, egy körben.

**(2) ADAT: az élő SOS-termék ár-pipáját explicit `false`-ra kell állítani.**

A szigorú szabály mellett az „ingyenes" szándékot **ki kell mondani** az adatban. Amíg ez nem történik meg, a kurzus a „hiányos konfiguráció" ágon marad, tehát az (1) javítás után sem lesz ingyenes, csak nem fog hazudni (letiltott CTA lesz „Megveszem" helyett).

- Ha `priceInHUFEnabled` értéke ma `null`: az adminban a pipát be, majd ki kell kapcsolni, hogy explicit `false` mentődjön.
- Ha `true` + üres ár: a pipát ki kell kapcsolni.
- A `reportUnpricedPublishedCourses` diagnosztika (a refaktor része) ezt a hibát mostantól naplózza, tehát a jövőbeli előfordulás látható lesz.

**(3) K10 (latens): a 0 Ft-os termék Barion-fizetést indítana.** Az `assertPurchasable` a `0`-t érvényes számként átengedi, a `coursePriceHuf` is. Az (1) javítás ezen nem segít, mert `isPaidCourse` a 0-t is fizetősnek látja. A `ui-sztenderdek.md` **Ü4** szerint az ingyenesség kritériuma az ár, ezért javaslom a `coursePriceHuf` fogyasztói oldalán a `> 0` feltételt, vagy legalább egy őr-tesztet, ami rögzíti, hogy 0 Ft-os terméket nem szabad a checkoutra engedni. **Ez a vezető döntése**, mert a jelenlegi refaktor tudatosan tartja külön a „fizetős", „ingyenes" és „hiányos" halmazt, és a 0 Ft besorolása ebbe a rendszerbe nincs kimondva.

**(4) B3: a `/kurzusok` lista-kártyája nem tud „Ingyenes" badge-et mutatni.** A `CourseCard.tsx:52` csak `coursePriceHuf`-ot néz. Használja a `coursePriceBadgeKind`-ot, a `ProductCard.tsx:219` mintájára.

**Tilos zóna ellenőrzés:** a javaslat nem érint migrációt (a séma nem változik), nem hív `confirmOrder`-t, nem nyúl access-szabályhoz, nem emel `@payloadcms/*` verziót, és nem tartalmaz `any`-t.

### 3.6 Milyen tesztek védenék

A refaktor már hozott teszteket (`courses.test.ts` +125 sor, `free-course-grant.test.ts` +79 sor). Az alábbiak azt fedik le, ami **még nincs**:

1. **A CTA és a checkout-kapu egyezése (a legfontosabb).** Táblázatos teszt a `{true,false,null,undefined} × {19990, 0, null, undefined}` 16 kombinációján, ami azt állítja: `resolveCourseCta(...).kind === 'buy'` **pontosan akkor**, amikor `assertPurchasable` nem dob. Ez szerkezetileg zárja ki, hogy a felület megvehetetlen terméket kínáljon. **Ma ez a teszt megbukna** a `null` és a `true`+`null` sorokon.
2. **A `hasUnsetPriceFlag` ág CTA-ja.** `resolveCourseCta({ status: 'published', priceInHUF: null, priceInHUFEnabled: null }, false).kind !== 'buy'`.
3. **A 0 Ft-os ág** (K10 / Ü4): `{ true, 0 }` esetén mit várunk. A teszt megírása előtt a 3.5 (3) döntés kell.
4. **Renderelési teszt:** hiányos konfigurációjú terméknél a `CourseBuybox` kimenete ne tartalmazza a vásárlási CTA aktív alakját.
5. **B3 lista-kártya:** `isFreeCourse` termékre a `CourseCard` kimenete tartalmazza az „Ingyenes" badge-et.

Ezek a `ui-sztenderdek.md` §6.3 **G-UI1** őrének kiegészítései, nem helyettesítői.

---

## 4. A mért leltár

118 elem, oldalanként. Típusjelölés: `P` elsődleges gomb · `S` másodlagos · `G` ghost/szöveggomb · `L` szöveges link · `KL` kártya-link (a teljes kártya egyetlen link) · `D` dekoratív, nem interaktív · `IB` ikon-gomb.

### 4.1 Fejléc és lábléc (minden oldalon)

| Hol | Felirat | Típus | Cél | Állapotok | Megjegyzés |
| --- | --- | --- | --- | --- | --- |
| skip-link | Ugrás a tartalomra | L | `#tartalom` | fókuszra láthatóvá válik | rendben |
| márka | Kineticare | L | `/` | hover | `aria-label` gondolatjellel (`ui-szt.` A/2) |
| `DesktopNav` | CMS-menü elemei | L | CMS-cél | hover, fókusz, `:focus-within` | `aria-current` hiányzik (`ui-szt.` A/7) |
| `DesktopNav` | „<menüpont> almenü" | IB | nyit/zár | `aria-expanded`, Esc zár | **példás**, érintésre is működik |
| `DesktopNav` almenü | Rendelői kezelések · Szakmai képzés (külső hivatkozás) · SOS KézRelax | L | CMS-cél, egy `_blank` | hover, fókusz | a „(külső hivatkozás)" a LÁTHATÓ feliratban van: jó minta (WCAG 2.5.3), de máshol nincs így |
| fejléc akció | **Kurzusok** | P | `/kurzusok` | hover, fókusz | a `/kurzusok` oldalon önmagára mutat, `aria-current` nélkül |
| `MobileNav` | hamburger / X | IB | drawer | `aria-expanded`, fókusz-visszaadás | **példás** |
| lábléc | Kapcsolat (óriás serif) | L | `/kapcsolat` | hover | vizuálisan a lap legnagyobb eleme, közben másodlagos cél |
| `NewsletterForm` | Feliratkozom / Küldés… | P | submit | `disabled` küldés alatt és siker után; `role="status"` | **példás**; a felirat E/1 (`ui-szt.` A/5) |
| lábléc jogi | Adatkezelési… · ÁSZF · Impresszum | L | CMS-oldalak | hover | élőben az adatvédelmi link **kétszer** szerepel (a hírlevél-hozzájárulásban is) |
| `ConsentSettingsButton` | Süti-beállítások | nyers `<button>` | sáv újranyitása | - | jogi link-listában gomb, vizuális megkülönböztetés nélkül |
| `ConsentBanner` | Elfogadom · Elutasítom | inline styled | opt-in/out | - | K5; a §3.2 #18 más feliratot ír elő |

### 4.2 Kezdőlap

| Felirat | Típus | Cél | Megjegyzés |
| --- | --- | --- | --- |
| Kurzusok megtekintése | P | `/kurzusok` | `ui-szt.` A/6 |
| Ingyenes SOS gyakorlatok | S | `#ingyenes` | horgony, rendben |
| Bővebben a szakmai hátterünkről → | L | `/rolunk` | rendben |
| *(teljes kártya)* | KL | `/kurzusok/otthoni-kezrehab-program` | rendben, egy tabstop |
| Megnézem a programot → | **D** | - | `ui-szt.` A/4 (ál-gomb) |
| Összes kurzus megtekintése → | L | `/kurzusok` | A/6 |
| **Elindítom az ingyenes kurzust →** | S | **`/kurzusok`** | **B7** |
| Tovább a kezelésekre → | L | `/szolgaltatasok` | `aria-label="Rendelői kezelések: Tovább a kezelésekre"`: jó minta |
| Tovább a programra → | L | `/kurzusok` | A/6; a „Tovább" tiltott kezdés (§3.1.4 M-7) |
| Tovább a kéz workshopra → | L | `probodystudio.hu` `_blank` | új lap nyílása nincs jelölve |
| Megnézem a kurzusokat | P | `/kurzusok` | A/6 |
| Összes bejegyzés a tudástárban → | L | `/blog` | csak posztokkal renderel |
| 4 GYIK-kérdés | `<summary>` | nyit/zár | natív, JS nélkül is működik |

### 4.3 Kurzuslista és kurzusoldal

| Hol | Felirat | Típus | Cél | Megjegyzés |
| --- | --- | --- | --- | --- |
| `/kurzusok` szűrő | Összes · Kézrehabilitációs kurzusok | L (chip) | `?kategoria=` | `aria-current="true"`: **példás** (`ui-szt.` A/7 ellenpéldája) |
| `/kurzusok` kártya | borító + cím | L + L | kurzusoldal | K8 (két link), K6 (nincs CTA), B3 (nincs ár) |
| kurzusoldal morzsamenü | Kurzusok | L | `/kurzusok` | `aria-current="page"` az utolsón: rendben |
| buybox (fizetős) | **Megveszem** | P | `/penztar?termek=1` | §3.2 #1 szerint cserélendő |
| buybox (ingyenes) | **Megveszem** | P | `/penztar?termek=2` | **B1** |
| buybox másodlagos | Kinek való? / Tananyag | L | `#…` | duplikálja a chip-sávot |
| `CourseJumpNav` | Mi ez? · Hogyan működik? · Tananyag · Kinek való? · Garancia · GYIK | L (chip) | `#…` | rendben |
| `MobileBuyBar` | **Megveszem** | P (nyers `kc-button`) | `/penztar?termek=…` | K2; ingyenesnél ár nélkül (B2) |
| `RelatedCourses` | kártyák | KL | kurzusoldalak | rendben |

**A ragadós doboz + mobil sáv kettőssége NEM redundancia.** Az `IntersectionObserver` gondoskodik róla, hogy egyszerre csak egy látszódjon, és ez pontosan a `ui-sztenderdek.md` Ü1 feloldásában rögzített új mérce („a vásárlási akció legfeljebb 0 görgetésnyire").

### 4.4 Kosár, pénztár, fizetés-lezárás

| Hol | Felirat | Típus | Cél | Állapotok | Megjegyzés |
| --- | --- | --- | --- | --- | --- |
| `/kosar` tétel | *kurzus címe* | L | kurzusoldal | hover | rendben |
| `/kosar` | Törlés | G | törlés | nincs folyamatban, nincs visszavonás | **K1** |
| `/kosar` | Menj a pénztárhoz | P | `/penztar?termek=` | vendég és belépett ugyanaz | §3.2 #21; B6 lezárva |
| `/kosar` | Kezdd el a kurzust | P | `/kurzusaim/{id}` | `alreadyPurchasedProductId` egyezik a céltétellel | a notice mellett a sáv is a lejátszóra visz |
| `/kosar` üres | Nézd meg a kurzusainkat | P | `/kurzusok` | `role="status"` | A/6 |
| `/penztar` | be is jelentkezhetsz | L | `/belepes` | - | **K9** (nincs `returnUrl`) |
| `/penztar` | Általános szerződési feltételek | L `_blank` | `/aszf` | - | új lap nem jelölt |
| `/penztar` submit | Megrendelés és fizetés / **Feldolgozás…** | P | `POST /api/checkout/start` | `disabled` küldés alatt, `alreadyPurchased`-nél, waiver hiányában; `role="alert"` élő régió; fókusz az első hibás mezőre | **a repó legjobb űrlapja**; hibaösszegzés hiánya: `ui-szt.` A/10 |
| `/penztar` ingyenes ág | Hozzáférés megnyitása | P | ua. | ua. | ma **elérhetetlen** (B1) |
| `/penztar` üres / archivált | Válassz kurzust / Nézd meg a kurzusokat | P (nyers) | `/kurzusok` | - | K2, A/6 |
| köszönőoldal | Tovább a kurzusaimhoz · Vissza a kezdőlapra · Nézd meg a kurzusaimat · Kurzusaim · Újrapróbálom · Segítséget kérek · Belépés (ha van fiókod) · Kapcsolat | P/S | több | `aria-live` ágakként | a `paid` ágon **három** `/kurzusaim` hivatkozás egy képernyőn |
| `/sikertelen` | Újrapróbálom a fizetést · Vissza a kurzusokhoz · Kapcsolat | P/S | több | - | §3.2 #17 szerint egységesítendő |

### 4.5 Auth, fiók, kurzusaim, lejátszó

| Hol | Felirat | Típus | Állapotok | Megjegyzés |
| --- | --- | --- | --- | --- |
| `/belepes` | Belépés / Belépés… | P | `disabled`, `role="alert"` | rendben (§3.2 #5) |
| `/belepes` | Regisztrálj · Elfelejtetted a jelszavad? | L | - | rendben |
| `/regisztracio` | Regisztráció / Regisztráció… | P | `disabled` | rendben (§3.2 #6 és L-1: az Ü5-döntés P-1c kivétele a bevett egyszavas címkére) |
| `/regisztracio` | Számlázási adatok (opcionális — a checkout előtölti) | `<summary>` | natív | **Z2** |
| `/elfelejtett-jelszo` | Visszaállító link küldése / Küldés… | P | **alapból letiltva** | **K3** |
| `/elfelejtett-jelszo` siker | *(nincs továbblépés)* | - | `role="status"` | **K4** |
| `/jelszo-visszaallitas` | Jelszó beállítása / Beállítás… | P | `disabled` | rendben |
| `/jelszo-visszaallitas` siker | Belépés | P (nyers) | - | **K2** |
| `/fiok` | Mentés / Mentés… | P | `disabled`, siker `role="status"`, hiba `role="alert"` | rendben |
| `/fiok` | Számla letöltése | L `_blank` | allowlist-szűrt; megbízhatatlan URL-nél sima szöveg | **példás** |
| `/fiok` | *(nincs kijelentkezés)* | - | — | **B4** |
| `/kurzusaim` kártya | Kezdés · Folytatás: *lecke* · Újranézés · A kurzus megnyitása · A kurzus megtekintése | P/S | rejtett `— <kurzuscím>` kiegészítés | jó minta (WCAG 2.4.6), de gondolatjellel |
| `/kurzusaim` üres | Kurzusok megnézése | P | `role="status"` | A/6 |
| lejátszó | Kurzusaim (vissza) · tananyag-ikon · Tananyag bezárása · lecke-sorok | L/IB | `aria-haspopup="dialog"` | K7 (`kc-sr-only`) |
| lejátszó | Előző: *lecke* | `<button>` | első leckén **nem renderel** (nem disabled) | **példás** (`ui-szt.` Á-3 szellemében) |
| lejátszó | Kész, tovább: *lecke* · Kurzus befejezése · Minden lecke kész / **Mentés…** | `<button>` | **`aria-disabled`**, nem `disabled`; kattintás-kapu a dupla küldés ellen | **a repó legjobb gombja**, `ui-szt.` §2.3 5-6. sorát teljesíti |
| lejátszó hiba | Újrapróbálom | S | `role="alert"` | rendben |

### 4.6 Blog, kapcsolat, hibaoldalak

| Hol | Felirat | Típus | Megjegyzés |
| --- | --- | --- | --- |
| `/blog` | `PostCard` teljes kártya | KL | rendben |
| `/blog` | *(nincs üres állapot)* | - | **Z5** |
| `/kapcsolat` | Üzenet küldése / Küldés… | P | `disabled`, `role="alert"`; rendben |
| `/kapcsolat` siker | Vissza a kezdőlapra | S | rendben |
| jogi oldalak | RichText-linkek | L / P | `lexical/serialize.tsx:228` `kc-button`-t ad: **K2** |
| 404 | Vissza a kezdőlapra | P | **élőben nem renderel** (IA TOP-10 #1) |
| 500 | Próbáld újra · Vissza a kezdőlapra | P/S | nincs folyamatban-állapot a `reset()`-en |
| előnézet-sáv | Kilépés az előnézetből | L | csak staff; rendben |

---

## 5. Szinonimák: leképezés a jóváhagyott szótárra

**A szótár a `docs/ui-sztenderdek.md` §3.2.** Az alábbi táblázat a **mért** feliratokat képezi le rá. A „§3.2 #" oszlop a jóváhagyott sor száma.

> **Frissítve 2026-08-16-án, az Ü5-döntés után.** A vezető eldöntötte a nyelvtani személyt (`ui-sztenderdek.md` 1.4/Ü5 és 3.1.5/P-1; normatív forrás: `.claude/skills/termektervezes/SKILL.md` 2. pont): a látogató **saját, elkötelező** cselekvését kimondó gomb **E/1**, a puszta **navigáció E/2**, a bevett egyszavas címke **főnévi**, a folyamatban-felirat **semleges**. A §3.2 táblázat ezzel átíródott, és négy új sorral bővült (**#19–#22**) – pontosan azokkal, amiket az 5.1 hiányként talált. **A „Jóváhagyott" oszlop innentől bitre egyezik** a §3.2 táblázatával ÉS a `src/lib/cta-vocabulary.ts` modullal; az egyezést a **G-UI1** őr méri (`src/__tests__/cta-vocabulary-guard.test.ts`), nem emberi figyelem.
>
> **Ez a doksi továbbra sem szótár.** Amit itt látsz, az a MÉRT állapot leképezése a jóváhagyott feliratokra. Új feliratot csak a §3.2 vehet fel.

| Cselekvés | Hány feliratot mértem | A mért feliratok | §3.2 # | Jóváhagyott |
| --- | --- | --- | --- | --- |
| Kurzuslistára | **8** | Kurzusok · Kurzusok megtekintése · Megnézem a kurzusokat · Összes kurzus megtekintése · Nézd meg a kurzusainkat · Nézd meg a kurzusokat · Válassz kurzust · Kurzusok megnézése (+ „Tovább a programra", „Megnézem a programot") | **#10** | `Nézd meg a kurzusokat` |
| Fizetős vásárlás indítása | 1 | Megveszem | **#1** | `Megveszem a kurzust` |
| Ingyenes kurzus indítása | 2 | Ingyenes — azonnal eléred · Elindítom az ingyenes kurzust | **#3, #4** | `Elindítom ingyen` |
| Fizetés befejezése | 2 | Megrendelés és fizetés · Hozzáférés megnyitása | **#2** | `Megrendelem és fizetek` |
| Saját kurzusokhoz | **4** | Kurzusaim · Tovább a kurzusaimhoz · Nézd meg a kurzusaimat · Vissza a kurzusaimhoz | **#9** | `Nyisd meg a kurzusaidat` |
| Kurzus folytatása | 1 | Folytatás: *lecke* | **#7** | `Folytasd a kurzust` |
| Kurzus megkezdése | 1 | Kezdés | **#8** | `Kezdd el a kurzust` |
| Belépés | 2 | Belépés · Belépés (ha van fiókod) | **#5** | `Belépés` |
| Fiók létrehozása | 1 | Regisztráció | **#6** | `Regisztráció` |
| Kapcsolatfelvétel | 1 | Üzenet küldése | **#12** | `Elküldöm az üzenetet` |
| Hírlevél | 1 | Feliratkozom | **#13** | `Feliratkozom` |
| Letöltés | 1 | Számla letöltése | **#14** | `Letöltöm a számlát` |
| Vissza-navigáció | 2 | Vissza a kurzusokhoz · Vissza a kezdőlapra | **#15** | `Vissza a kurzusokhoz` |
| Újrapróbálás | **3** | Újrapróbálom · Újrapróbálom a fizetést · Próbáld újra | **#17** | `Újrapróbálom` |
| Süti-döntés | 2 | Elfogadom · Elutasítom | **#18** | `Elfogadom mindet` / `Csak a szükségeseket` |
| Archivált termék | 1 | Megveszem (letiltva) | **#16** | `Ez a kurzus jelenleg nem vásárolható meg.` *(gomb nélkül)* |
| Kártya-CTA | 1 | Megnézem a programot (dekoratív) | **#11** | *(nincs gomb)* |
| **Tétel kivétele a kosárból** | 1 | Törlés | **#19** | `Kiveszem a kosárból` |
| **Kosárból a pénztárba** | 1 | Tovább a penztárhoz | **#20** | `Menj a pénztárhoz` |
| **Visszaállító link kérése** | 1 | Visszaállító link küldése | **#21** | `Kérem a visszaállító linket` |
| **Új jelszó beállítása** | 1 | Jelszó beállítása | **#22** | `Beállítom az új jelszót` |
| **Hívás a szakembernek** | 2 | Hívd Kocsis Katát · Hívd Kiss Katát | **#23** | `Hívd Kocsis Katát` |
| **Írásos időpontkérés (link)** | 1 | Kérj időpontot üzenetben | **#24** | `Kérj időpontot üzenetben` |
| **Időpontkérő űrlap beküldése** | 1 | Időpontot kérek | **#25** | `Időpontot kérek` |
| **Ingyenes kurzus igénylése (űrlap-beküldés)** | 1 | Kérem a kurzust | **#26** | `Kérem a kurzust` |
| **Ugrás az igénylő űrlaphoz (lapon belül, a lap aljáról)** | 1 | Kérd az ingyenes kurzust | **#27** | `Kérd az ingyenes kurzust` |
| **A kurzus saját (értékesítő) oldalára** | **3** | Megnézem a programot · A kurzus megtekintése (lejátszó-kapu) · A kurzus megtekintése (lejárt kártya) | **#28** | `Nyisd meg a kurzusoldalt` |
| **Befejezett kurzus újranézése** | 1 | Újranézés | **#29** | `Nézd újra a kurzust` |
| **A kurzus befejezése a lejátszóban** | 1 | Kurzus befejezése | **#30** | `Befejezem a kurzust` |
| **Fiókadatok mentése** | 1 | Mentés | **#31** | `Mentés` |
| **Kijelentkezés** | 1 | Kijelentkezés | **#32** | `Kijelentkezés` |
| **Kapcsolatfelvételi oldalra lépés** | **3** | Kapcsolat · Segítséget kérek · Írj nekünk a kapcsolati oldalon | **#33** | `Írj nekünk` |
| **A „rólunk" oldalra lépés** | 1 | Bővebben a szakmai hátterünkről | **#34** | `Ismerd meg a hátterünket` |
| **A tudástár listájára lépés** | 1 | Összes bejegyzés a tudástárban | **#35** | `Nézd meg a tudástárat` |
| **Süti-beállítások újranyitása** | 1 | Süti-beállítások | **#36** | `Süti-beállítások` |
| **Jelszó-visszaállítás kezdeményezése** | **2** | Elfelejtetted a jelszavad? · Új link kérése | **#37** | `Elfelejtetted a jelszavad?` |
| **Ugrás a kezdőlap ingyenes sávjára** | 1 | Ingyenes SOS gyakorlatok | **#38** | `Nézd meg ingyenes SOS-kurzusunkat` |
| Folyamatban | **7** | Feldolgozás… · Küldés… · Mentés… · Belépés… · Regisztráció… · Beállítás… · Kijelentkezés… · Újratöltés folyamatban… | **L-1** | `Belépés…` `Regisztráció…` `Kijelentkezés…` `Küldés…` `Mentés…` `Feldolgozás…` `Betöltés…` |

**Mit mond ez a leképezés összesítve:** 28 mért cselekvésre **63 különböző felirat** élt; a jóváhagyott szótárban ugyanezekre **32 felirat + 7 folyamatban-alak** van. A legnagyobb nyereség a kurzuslistánál (8 → 1) és a saját kurzusoknál (4 → 1) keletkezett – mindkettő WCAG 2.2 **3.2.4** sérülés volt.

> **A hívóhelyek átírása 2026-08-18-án MEGTÖRTÉNT** – lásd az 5.4 szakaszt. A fenti „mért feliratok" oszlop innentől TÖRTÉNETI: azt rögzíti, mi állt a felületen a javítás előtt. Az élő állapotot a **G-UI2** őr méri (`src/__tests__/cta-a-termekben.test.ts`), nem ez a doksi.

**Amit a döntés NEM változtatott meg** (a felirat ma is helyes, kódot nem kell írni): `Belépés`, `Feliratkozom`. **Ami csak a személy miatt maradt E/1-ben, de a szótári alakra pontosítandó:** `Megveszem` → `Megveszem a kurzust`, `Újrapróbálom` (marad, de a másik két alak megszűnik), `Elfogadom` → `Elfogadom mindet`.

### 5.2 Mért eltérés az időpontkérés körül (2026-08-16, a szótár bővítésekor derült ki)

A `#23`–`#25` sorok felvételekor kiderült, hogy az időpontkérés három helyen jelenik meg, és a
feliratok **ma ütköznek** (WCAG 2.2 · 3.2.4 Consistent Identification):

| Hol | Mai felirat | Milyen funkció | Melyik sor szerint helyes |
| --- | --- | --- | --- |
| `/szolgaltatasok` hivatkozás (`restore-legacy-content.ts:562, 606`) | `Időpontot kérek` | **navigáció** a `/kapcsolat#idopontkeres` szekcióra | **#24** → `Kérj időpontot üzenetben` |
| Szakember-szekció hivatkozása (`restore-legacy-content.ts:1180`) | `Kérj időpontot üzenetben` | navigáció ugyanoda | **#24** ✓ helyes |
| Az időpontkérő űrlap beküldő gombja (`restore-legacy-content.ts:1555`) | `Időpontot kérek` | **beküldés** (időpontkérés keletkezik) | **#25** ✓ helyes |

Két hiba egyszerre: (1) ugyanarra a **navigációs** funkcióra két különböző felirat él, (2) a
`Időpontot kérek` felirat egyszerre jelöl **navigációt** és **beküldést**. A látogató ugyanazt a
szöveget látja a linken és a gombon, pedig az egyik csak odavisz, a másik ténylegesen elküldi a
kérést.

**A javítás a hívóhely-csere körébe tartozik** (lásd §10/3.), nem ide: a seed-builderben a
`/szolgaltatasok` hivatkozás feliratát `Kérj időpontot üzenetben`-re kell állítani. Az ÉLŐ
szekciósorokat ez nem írja át — azokat az adminban kell javítani, mert a seed sosem ír felül
meglévő szekciósort.

### 5.1 A négy hiányzó cselekvés – FELVÉVE a §3.2-be (2026-08-16)

A leltár négy olyan cselekvést talált, amire nem volt jóváhagyott sor. **A vezető jóváhagyta, és mind a négy bekerült a `ui-sztenderdek.md` §3.2 táblázatába** (#19–#22). Az alábbi táblázat a javaslat → jóváhagyott felirat útját dokumentálja; a normatív alak a §3.2-ben és a `src/lib/cta-vocabulary.ts`-ben él.

| Cselekvés | Hol fordul elő | Az eredeti javaslatom | **Jóváhagyva (§3.2)** | Miért tér el a javaslattól |
| --- | --- | --- | --- | --- |
| **Tétel kivétele a kosárból** | `CartView.tsx:88` „Törlés" | `Töröld a kosárból` | **#19** `Kiveszem a kosárból` | Két ok. (a) **Személy:** a kosár a látogató dolga, tehát P-1a → E/1. (b) **Szóválasztás:** a Carbon kimondja, hogy a *remove* ≠ *delete* – *„Deletion is the most common type of removal and is destructive"* –, és a helyreállítható műveletre a *remove* alakot írja elő. A kosárból kivett tétel **nem semmisül meg**, bármikor visszatehető. |
| **Kosárból a pénztárba lépés** | `CartView.tsx:103` „Tovább a penztárhoz" | `Menj a pénztárhoz` | **#20** `Menj a pénztárhoz` | Változatlanul jóváhagyva. P-1b: itt még semmi nem történik, csak odaérünk (a vállalás a #2 gombnál van). Egyúttal javítja a mai **elgépelést** („penztárhoz"). |
| **Jelszó-visszaállító link kérése** | `ForgotPasswordForm.tsx:74` | `Kérd a visszaállító linket` | **#21** `Kérem a visszaállító linket` | Csak a személy változott (P-1a: e-mail indul a látogatónak). A régi `kineticare.hu` ugyanezt a szerkezetet használta: `KÉREM A PROGRAMOT`, `KÉREM A HOZZÁFÉRÉST`, `KÉREM AZ ÉRTESÍTÉST` – mérve, `docs/regi-oldal-osszehasonlitas.md` 3.1. **Nem tévesztendő** a §2.7-ben tiltott udvariaskodó „Kérjük"-kel: ez E/1-es ige. |
| **Új jelszó beállítása** | `ResetPasswordForm.tsx:99` „Jelszó beállítása" | `Állítsd be a jelszót` | **#22** `Beállítom az új jelszót` | Csak a személy változott (P-1a: a fiók megváltozik). Az „új" szó azért kell, mert a látogató két jelszót lát a fejében (a régit és az újat) – NN/g „Specific". |

#### A `Beállítás…` folyamatban-felirat sorsa: `Mentés…`-re egységesül

**Döntés: NEM kerül az L-1 listára.** A `/jelszo-visszaallitas` űrlap mai `Beállítás…` felirata a `Mentés…`-re változik. Három indok, ebben a sorrendben:

1. **Szinonima.** A „beállítás" és a „mentés" itt **ugyanazt a műveletet** nevezi meg: a látogató bevitt adata tartósan eltárolódik. A Shopify Polaris *Vocabulary* fejezete kifejezetten előírja a szinonimák azonosítását és felszámolását (*„identify and eliminate synonyms"*) – [polaris.shopify.com/content/vocabulary](https://polaris.shopify.com/content/vocabulary).
2. **Konzisztencia, mérhetően.** A `/fiok` mentés-gombja már ma is `Mentés…`-t ír. A két űrlap így ugyanazt a szót használja ugyanarra a műveletre – WCAG 2.2 **3.2.4 Consistent Identification**.
3. **A lista zárva marad.** A `Regisztráció…` viszont **felkerült** az L-1-re: ma is él a felületen, és a §3.2 #6 főnévi címkéjének (P-1c) szabályos folyamatban-párja. Az L-1 így pontosan **hat** elem, és a G-UI1 őr ezt a hatot méri.

**Miért nem személyragozzuk a folyamatban-feliratot** (tehát miért nem `Mentem…`): ez **rendszerállapot-üzenet**, nem a látogató cselekvése – NN/g 1. heurisztika (*visibility of system status*), WCAG 2.2 **4.1.3 Status Messages**. A §3.2 P-1d sora rögzíti.

### 5.3 A #27 sor felvétele (2026-08-17) – ugrás az igénylő űrlaphoz

Az ingyenes kurzus igénylő űrlapja a lap TETEJÉN, a vásárlódobozban áll. 1024 px alatt a doboz
nem ragadós (`kurzusok.css`, a `position: sticky` a `min-width: 1024px` ágban él), tehát a
végigolvasó látogatónak a lap alján nincs visszaútja az űrlaphoz. A régi `/kezrelax` landing
ugyanezt a belépőt **négyszer** ismételte lefelé haladva (`KÉREM A VILLÁMKURZUST` 4×,
`KÉREM A PROGRAMOT` 2×, `KÉREM A HOZZÁFÉRÉST` 2× – mérve: `regi-oldal-osszehasonlitas.md` 3.1).

**Amit a kutatás mond, és amit ebből átveszünk:** NN/g szerint a duplikált link költséggel jár
(a látogató azon gondolkodik, ugyanoda visz-e a két hivatkozás), és „usually not necessary if
your pages are 2–3 screens long"; hosszú lapon viszont – kifejezetten mobilon – időt spórol, és
a ragadós megoldás a jobb, ahol van
([NN/g, *The Same Link Twice on the Same Page*](https://www.nngroup.com/articles/duplicate-links/)).
Nálunk pontosan így oszlik: 1024 px felett a ragadós vásárlódoboz VAN, tehát ott a másolat el is
marad; alatta nincs, tehát ott megjelenik. Az elsődleges hely változatlanul a doboz
([NN/g, *Scrolling and Attention*](https://www.nngroup.com/articles/scrolling-and-attention/):
„Keep major CTAs above the fold", a nézési idő 42%-a a felső 20%-ra esik).

**A felirat nem a #26 másolata:** a #26 a BEKÜLDÉS (E/1, „Kérem a kurzust"), a #27 a
NAVIGÁCIÓ (E/2, „Kérd az ingyenes kurzust"). A WCAG 2.2 **3.2.4** azonos *funkciót* kér azonos
néven; itt két különböző eredmény van, ahogy a #24 ↔ #25 párnál is.

### 5.4 A hívóhelyek átírása (2026-08-18) – a 67 eltérés rendezése

Ez a szakasz a **mérőszámot** rögzíti. A 2026-08-17-i audit a felületen **136 élő
gombfeliratot** talált, ebből **67 tért el** a jóváhagyott §3.2 szótártól. A termék-oldali őr
(`src/__tests__/cta-a-termekben.test.ts`, **G-UI2**) ezt **96 soros kivétel-listával** rögzítette.

**A lista 96 → 42 sorra csökkent**, kategóriánként:

| Kategória | Előtte | Utána | Mi történt |
| --- | --- | --- | --- |
| `szotartol-elter` | 27 | **0** | 2026-08-27: a maradék EGY (`CartView` „Belépés a fizetéshez") a §3.2 #21 (`Menj a pénztárhoz`) alakra javult. Vendég kosár = pénztár. |
| `mintazat-jelolt` | 9 | **0** | A kategória MEGSZŰNT: a §3.2 C-6 mintázatai gépi alakot kaptak (`CtaEntry.pattern`), így az őr maga ismeri fel a `Vissza a <hova>` változatokat. |
| `nincs-szotari-sor` | 20 | **0** | Mind a húsz feliratra szótári sor lett: **#28–#38** (tizenegy új sor), a L-1 lista `Kijelentkezés…` eleme, és a pénztár ingyenes ága a meglévő **#26**-ra. |
| `nem-cta` | 40 | **41** | Nem csökkenhet: ezek menücímkék, morzsák, folyószöveges hivatkozások, logók, jogi dokumentumnevek. Az egy sor növekedés a `ThankYouView` „Kurzusaim" folyószöveges hivatkozása, amely a `szotartol-elter` kategóriából ide sorolódott át (a komponens három CTA-gombja viszont a #9 alakjára javult). |
| **Összesen** | **96** | **42** | |

**Két szűk kivétel-lista KIÜRÜLT.** A „Tovább…"-sértéseké (`TOVABB_KIVETELEK`, 2 sor → 0) és a
kvirtmínuszos feliratoké (`GONDOLATJEL_KIVETELEK`, 2 sor → 0). A felületen innentől **egyetlen**
„Tovább…" kezdetű és **egyetlen** U+2014-et tartalmazó vevői felirat sincs.

**2026-09-05, helyi logóvezérlő (tulajdonosi jóváhagyás):** a G-UI2 aktuális
listája és pontos felső korlátja **43 → 45**. A két új `nem-cta` pár kizárólag
`components/blocks/LogoRail.tsx` + `Elindítom a logósort`, illetve ugyanez a fájl
és a `Megállítom a logósort` felirat. Ezek a véges helyi görgetés indítás/szünet vezérlői,
nem értékesítési CTA-k, navigáció vagy kurzuslejátszó-parancsok. A §3.2 szótár
nem változik; általános felirat- vagy fájlkivétel nem keletkezik. Normatív
hatókör: `ui-sztenderdek.md` §3.2, a G-UI2 helyi vezérlőkivétel bekezdése.

**A WCAG 2.2 · 3.2.4 cél-ütközések 6-ról 4-re csökkentek**, és a maradék négy mind a
BÖNGÉSZÉS ↔ VISSZALÉPÉS szándékos kettőssége (`/kurzusaim`, `/kurzusok`, `/belepes`, `/blog`),
nem meg nem javított szinonima. A `/kapcsolat` (3 felirat) és az `/elfelejtett-jelszo`
(2 felirat) ütközése teljesen megszűnt.

**Amit a kód NEM tud megjavítani.** A szekciósorok (`pages.layout`) az ADATBÁZISBÓL jönnek, és a
seed sosem ír felül meglévő tartalmat. A `src/lib/home-seed.ts` javított feliratai ezért csak
FRISS adatbázison érvényesülnek; az élő lapon a `src/scripts/apply-owner-content.ts` külön köre
kell hozzá. Érintett feliratok: `Tovább a kezelésekre` → `Nézd meg a kezeléseket`,
`Tovább a kéz workshopra` → `Nézd meg a kézworkshopot`, `Ingyenes SOS gyakorlatok` →
`Nézd meg az SOS-kurzust`, `Bővebben a szakmai hátterünkről` → `Ismerd meg a hátterünket`.

---

## 6. Rossz típusválasztás (gomb ↔ link)

A szabály a `ui-sztenderdek.md` §2.1-ben áll. Az alábbiak a **mért** ütközések; ahol a `ui-szt.` már számozta, ott csak hivatkozom.

| # | Hol | Mai megoldás | Miért baj | Máshol |
| --- | --- | --- | --- | --- |
| T1 | `ProductCard.tsx:230` | `<span aria-hidden>` gomb-geometriával | nem kattintható ál-gomb | `ui-szt.` **A/4** |
| T2 | `CourseCta.tsx:30` archivált ág | `<button disabled>` „Megveszem" | fókuszálhatatlan, hamis ígéret | `ui-szt.` **A/1**, §3.2 **#16** |
| T3 | `Button.tsx:101` `href`+`disabled` | `<span aria-disabled>` | szerep nélküli elemen az `aria-disabled` nem jut el a kisegítő technológiához | `ui-szt.` **A/3** |
| **T4** | `ConsentSettingsButton` a lábléc jogi **listájában** | `<button>` a linkek közé keverve | Helyes elem (cselekvés), de vizuálisan és fókuszban nem különbözik a mellette álló linkektől. `ui-szt.` C-2: azonos súly csak azonos cselekvéshez. | **új** |
| **T5** | `MobileBuyBar.tsx:88`, `penztar/page.tsx:90,107`, `ResetPasswordForm.tsx:61`, `lexical/serialize.tsx:228` | nyers `<Link className="kc-button…">` | helyes elem, de megkerüli a `Button`-t: nincs `sanitizeCmsUrl`, nincs egységes disabled/új-lap kezelés | **új (K2)** |
| **T6** | `Services.tsx:127`, `penztar/page.tsx` ÁSZF-link, `AccountView` számlalink | valódi `<a _blank rel="noopener noreferrer">` | Helyes, DE az új lap nyílása csak a fejléc-menüben van jelölve. WCAG 3.2.5 / G201. | **új** |
| **T7** | `CourseCard.tsx:30,47` | két link egy kártyán | duplikált bejegyzés a képernyőolvasó link-listájában | **új (K8)** |

---

## 7. Gondolatjel: a kódban élő vevői szövegek

**A szabály a `ui-sztenderdek.md` §3.1**, forrásokkal együtt. Röviden: a `—` (U+2014) magyar szövegben nem írásjel; a gondolatjel a `–` (U+2013) szóközökkel; gomb-, menü-, badge-, mező- és `aria-label`-szövegben **nulla** gondolatjel.

A `ui-szt.` A/2 repó-szintű számot ad (4688 db U+2014). Az alábbi lista ehhez a **konkrét, vevő által látott előfordulásokat** adja hozzá, cserejavaslattal. A javaslatok a §3.1.3 helyettesítési táblázatát követik (vessző / kettőspont / pont / zárójel).

| Fájl:sor | Mai szöveg | Javasolt |
| --- | --- | --- |
| `lib/courses.ts:69,119` | `Ingyenes — azonnal eléred` | a §3.2 **#3** jóváhagyott felirata (`Elindítom ingyen`); az „azonnal eléred" ígéret a gomb alatti segédszövegbe |
| `content/home/FreeSos.tsx:65` | `SOS Kézrelax — ingyenes villámkurzus` | `SOS Kézrelax: ingyenes villámkurzus` |
| `auth/RegisterForm.tsx:90` | `Számlázási adatok (opcionális — a checkout előtölti)` | `Számlázási adatok (nem kötelező, a pénztár kitölti helyetted)` |
| `layout/Header.tsx:38` | `aria-label="Kineticare — kezdőlap"` | `aria-label="Kineticare kezdőlap"` |
| `courses/CourseCard.tsx:30` | `` `${title} — kurzus részletei` `` | `` `${title}: kurzus részletei` `` |
| `courses/MobileBuyBar.tsx:81` | `` `${courseTitle} — vásárlás` `` | `` `${courseTitle} vásárlása` `` |
| `account/CourseList.tsx:98` | `` `${card.title} — haladás` `` | `` `${card.title} haladása` `` |
| `account/CourseList.tsx:116` | `` ` — ${card.ctaContext}` `` | `` `, ${card.ctaContext}` `` |
| `account/player/navigation.ts:192` | `Kurzus befejezése — ${current.title} megjelölése késznek` | `Kurzus befejezése: ${current.title} megjelölése késznek` |
| `account/CoursePlayer.tsx:795` | `…folyamatban van — nézz vissza hamarosan.` | `…folyamatban van. Nézz vissza hamarosan.` |
| `account/CoursePlayer.tsx:887` | `` `${product.title} — ${activeLesson.title}` `` | `` `${product.title}: ${activeLesson.title}` `` |
| `lib/course-audience.ts:70` | `…a fájdalom enyhítésére — érthetően, szaknyelv nélkül.` | `…a fájdalom enyhítésére, érthetően, szaknyelv nélkül.` |
| `lib/checkout/start-checkout.ts:319` | `Ezt a terméket már megvásároltad — a kurzust a fiókodban éred el.` | `Ezt a kurzust már megvásároltad. A fiókodban éred el.` |
| `lib/checkout/form-submission.ts:88` | `Ezt a kurzust már megvetted — a Kurzusaim oldalon éred el.` | `Ezt a kurzust már megvetted. A Kurzusaim oldalon éred el.` |
| `lib/checkout/guest.ts:85,94` | 2 db gondolatjeles mondat | ponttal két mondatra bontva |
| `lib/checkout/billing.ts:134,140,142` | 3 db gondolatjeles hibaüzenet | ponttal két mondatra bontva (a `ui-szt.` A/9 a „Kérjük"/„Érvénytelen" szavakat is javítja ezekben) |
| `lib/email/templates/order.ts:70` | `${title} — ${qty} db — ${ár}` | `${title}, ${qty} db, ${ár}` |
| `lib/email/templates/order.ts:99,101,104,111,121` | 5 db | pont / kettőspont |
| `lib/email/templates/auth.ts:37,42` | `…hagyd figyelmen kívül ezt a levelet — a jelszavad nem változik.` | `…hagyd figyelmen kívül ezt a levelet. A jelszavad nem változik.` |
| `lib/customer-import/send-invites.ts:70,74,79,83,89,93,99` | 7 db | pont / kettőspont |
| `lib/seo.ts:167,198`, `app/(frontend)/page.tsx:18,22`, `layout.tsx:19,28,37`, `blog/kategoria/[slug]/page.tsx:18` | `Kineticare — …`, `${SITE_NAME} — ${SITE_TAGLINE}` | `<title>`-ben függőleges vonal, leírásban kettőspont. **Figyelem:** az IA TOP-10 #9 szerint a `<title>` ma **dupla márkanevet** ad („Rólunk – Kineticare \| Kineticare”); a két javítást együtt kell elvégezni |

**A `ui-szt.` C-7 szabálya miatt az e-mail-sablonok is a listán vannak**: a levélből érkező látogató ugyanazt a szót és írásmódot találja az oldalon.

**Amit NEM szabad átírni.** A `home/Faq.tsx:42` „Napi 10–15 perc" **nagykötőjel** (számtartomány, AkH. 264.), nem gondolatjel: helyes, marad. Ugyanígy marad a naplóüzenetekben és a doksikban lévő jel, azt a vevő nem látja. A CMS-tartalomban mért 21 db en dash (kurzus-tananyag felsorolások, vélemény-aláírások) **tartalom-szerkesztési** feladat, nem kódjavítás.

**Kikényszerítés:** a `ui-sztenderdek.md` §6.3 **G-UI2** őre pontosan ezt védi. Kiegészítő javaslat: a `logger.*` első argumentuma fehérlistázható, mert nem vevői szöveg.

---

## 8. Állapot-hiányok

A kötelező állapotlista a `ui-sztenderdek.md` §2.3 (hét állapot: default, hover, focus-visible, active, disabled, loading, selected). Az alábbi a **mért** hiánylista.

| # | Elem | Hiányzó állapot (§2.3 szerint) | Kockázat |
| --- | --- | --- | --- |
| Á1 | `CartView` „Törlés" | 6 (loading), és nincs visszavonás | a vevő véletlenül üríti a kosarát |
| Á2 | `CheckoutForm` submit | van `disabled`, de nincs dupla-kattintás védelem a hálózati késés első pillanatában | `ui-szt.` §6.3 **G-UI8** ezt őrzi |
| Á3 | `error.tsx` „Próbáld újra" | 6 (loading) | ismételt kattintás, „nem történt semmi" érzés |
| Á4 | `ForgotPasswordForm` submit | 5 (disabled) **magyarázat nélkül** | K3 |
| Á5 | `CourseCta` archivált ág | 5: a magyarázat nincs `aria-describedby`-jal a gombhoz kötve | `ui-szt.` A/1 |
| Á6 | fejléc- és menülinkek | 7 (selected / `aria-current`) | `ui-szt.` A/7 |
| Á7 | `MobileBuyBar` ingyenes terméknél | ár-felirat teljesen hiányzik | B2 |
| Á8 | `/kurzusok` kártyák | nincs „már megvetted" állapot | a vevő nem látja, mit birtokol |
| Á9 | külső `_blank` linkek | nincs „új lapon nyílik" jelzés | T6 |
| Á10 | `/blog` üres lista | nincs üres állapot | Z5 |

### 8.1 Mért kontraszt: a letiltott gomb

A `ui-szt.` §2.3 5. sora „csökkent kontraszt + magyarázó szöveg" párost ír elő. A repóban a csökkentést a `styles/ui.css:250-254` `opacity: 0.5` adja **az egész elemre**, tehát a felirat és a felület is a háttér felé olvad. Számolt értékek (sRGB relatív luminancia, WCAG 2.x képlet; `--kc-color-primary: #2f6e9f`, `--kc-color-on-primary: #ffffff`, `--kc-color-paper: #f6f9fc`, `--kc-color-tint-cool: #e6f0f8`):

| Állapot / háttér | Felirat vs felület | Felület vs háttér |
| --- | --- | --- |
| **aktív** elsődleges gomb | **5,45:1** | **5,16:1** |
| letiltott, paper sáv | **2,12:1** | 2,06:1 |
| letiltott, tint sáv | 2,16:1 | 2,00:1 |
| letiltott, fehér kártya | 2,12:1 | 2,12:1 |

**Értékelés.** A WCAG 1.4.3 és 1.4.11 a letiltott vezérlőt mentesíti, tehát ez **nem AA-bukás**. De 2,12:1 mellett a felirat gyakorlatilag olvashatatlan, és a `ui-szt.` §2.3 által megkövetelt „magyarázó szöveg" sem áll mellette (K3, Á4, Á5). A helyes irány a §2.3 **Á-3**: ahol a cselekvés nem végezhető el, ott ne szürke gomb legyen, hanem a gomb eltűnése és egy magyarázó mondat.

**Ellenpéldák a repóból, amiket mintaként kell használni:** `PlayerActions.tsx:76` (`aria-disabled` a `disabled` helyett, hogy a fókusz ne vesszen el, plusz kattintás-kapu) · `CheckoutErrorRegion` (`CheckoutForm.tsx:97`, az élő régió mindig a DOM-ban) · `AccountView` számlalink (allowlist-szűrés renderelléskor is) · `CategoryFilter` (`aria-current`).

---

## 9. Ismétlés és redundancia

| # | Hol | Mi ismétlődik | Máshol |
| --- | --- | --- | --- |
| R1 | kezdőlap | hét `/kurzusok`-ra vivő elem | `ui-szt.` A/6, IA TOP-10 #7 |
| **R2** | kurzusoldal | a buybox másodlagos linkje ugyanaz a horgony, ami a `CourseJumpNav` chipjei közt is szerepel („Kinek való?" / „Tananyag") | **új**: a buybox másodlagos linkje mutasson olyan szakaszra, ami nincs a chipek közt |
| R3 | kurzusoldal | ragadós doboz + mobil sáv | **nem hiba**, lásd 4.3 (Ü1) |
| **R4** | köszönőoldal `paid` ág | **három** `/kurzusaim` hivatkozás egy képernyőn (szövegközi link + gomb + a szöveg „Kurzusaim") | **új**: egy elsődleges gomb maradjon, a szövegben link nélküli említés |
| **R5** | lábléc | az adatvédelmi link **kétszer** szerepel (hírlevél-hozzájárulás + jogi lista) | **új**: a jogi listában rövidüljön „Adatvédelem"-re |
| R6 | `/kurzusok` kártya | két link egy célra | K8 / T7 |
| R7 | `CourseJumpNav` | „Ugrás:" felirat + `nav aria-label` | Z4 |

---

## 10. Ajánlott sorrend

1. **B1, B2, B3, K10** egyetlen patchben (3.5) a tesztekkel (3.6). Legnagyobb üzleti hatás, legkisebb felület, nem érint tilos zónát.
2. **B7** a seedben és az élő DB-ben.
3. ~~A `ui-sztenderdek.md` §3.2 kiegészítése a 5.1 hiányzó soraival, majd a **G-UI1** szótár-őr megírása.~~ **KÉSZ (2026-08-16):** a §3.2 a #19–#22 sorokkal bővült, a szótár a `src/lib/cta-vocabulary.ts`-ben él, a **G-UI1** őr (`src/__tests__/cta-vocabulary-guard.test.ts`) méri a mikroszöveg-szabályokat és a doksi↔kód egyezést. **Ami ebből még hátravan: a hívóhelyek átírása** (`resolveCourseCta`, `CourseCta`, `MobileBuyBar`, `CartView`, `penztar/page.tsx`, `ThankYouView`, `ForgotPasswordForm`, `ResetPasswordForm`, `NewsletterForm`, `ContactForm`, `FreeSos`, `HeroCta`, `CourseCards`, `home-seed.ts`) – külön kör, mert a felület-átírás mérést (6.5 előmérés) és kognitív sétát is igényel.
4. **A/2 + 7. fejezet**: gondolatjel-irtás kódban, majd a **G-UI2** őr.
5. **K1, K2, T3, T4, T5**: a `Button` szerződésének rendbetétele.
6. **K3, K4, K9, Á1-Á10**: állapotok és zsákutcák.
7. **R2, R4, R5**: redundanciák.

A B4, B5, B6 az `informacios-architektura.md` 8. fejezetének javítási terve szerint halad, nem innen.

---

## 11. Nyitott kérdések a vezetőnek

1. ~~**Doksi-tulajdon.**~~ **MEGVÁLASZOLVA (2026-08-16).** A skill 2. pontja azóta kimondja: *„A CTA-szótár EGYETLEN normatív helye a `docs/ui-sztenderdek.md` §3.2… A `docs/gomb-inventar.md` ehhez képest **leltár**."* A munkamegosztás tehát megerősítve, ez a fájl leképezés marad.
2. **A `'none'` badge sorsa.** A 3.5 patch megszünteti a „konfigurációs hiba" állapotot: a beállított de üres árú termék ezután INGYENES-ként jelenik meg. Ez az Ü4-gyel egyezik, de tudatos viselkedésváltás. Alternatíva: a `'none'` marad, de a CTA `unavailable` lesz. **Döntést kérek.**
3. ~~**E/1 vs E/2 megszólítás.**~~ **ELDÖNTVE (2026-08-16).** A vezető a **P-1** szabályt hagyta jóvá (`ui-szt.` 1.4/Ü5, 3.1.5): elkötelező cselekvés **E/1**, puszta navigáció **E/2**, bevett egyszavas címke **főnévi**, folyamatban-felirat **semleges**. Az 5. fejezet leképezése ehhez igazítva. **A mérésem, ami a döntés alapja lett:** a régi `kineticare.hu` 100 %-ban E/1 volt (`docs/regi-oldal-osszehasonlitas.md` 3.4), és a mai felület is az – a váltás tehát nem a személyt, hanem a **szinonimákat** és a **deverbális főnévi alakokat** számolja fel.
4. **A hibát okozó adat pontos állapota.** A nyilvános HTML-ből nem dönthető el, hogy az SOS-terméken `priceInHUFEnabled` értéke `true` vagy `null` (3.3). A javítás mindkettőt kezeli, de ha a tulajdonos szeretné tudni, egy `payload find` lekérdezés a `products`-on megadja.

---

## 12. Források

**Elsődleges (belső, normatív):** `docs/ui-sztenderdek.md` §1.4 (Ü1-Ü4), §2.1, §2.3, §2.4, §3.1, §3.2, §5 (C-1…C-7), §6.3 (G-UI1…G-UI8), §A (A/1…A/10) · `docs/informacios-architektura.md` TOP 10 · `docs/ertekesitesi-ux-skill.md` (M1-M8) · `docs/ux-belso-oldalak-kutatas.md` (B6.1 a Ü1 feloldásával) · `docs/ux-hierarchia-audit.md`

A külső források teljes, forrásolt jegyzékét a `ui-sztenderdek.md` 7. szakasza tartalmazza (W3C, NN/g, Carbon, Polaris, Atlassian, GOV.UK, Baymard, ELTE-tipográfia, AkH.). Az ebben a doksiban használt állítások oda vezetnek vissza. A saját méréseimhez közvetlenül használt hivatkozások:

- [WCAG 2.2 SC 3.2.4 Consistent Identification](https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html) (5. fejezet)
- [WCAG 2.2 SC 2.5.3 Label in Name](https://www.w3.org/WAI/WCAG22/Understanding/label-in-name.html) (K1)
- [WCAG 2.2 SC 2.4.4 Link Purpose (In Context)](https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html) (K8, T7)
- [WCAG 2.2 SC 3.2.5 / G201 (új ablak)](https://www.w3.org/WAI/WCAG22/Understanding/change-on-request.html) (T6)
- [WCAG 2.2 SC 1.4.3 Contrast (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) és [1.4.11 Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) (8.1: a letiltott vezérlő mentessége)
- [GOV.UK Design System: Button](https://design-system.service.gov.uk/components/button/) („Disabled buttons"; „Stop users from accidentally sending information more than once") (K3, Á2, Á3)
- [Shopify Polaris: Vocabulary](https://polaris.shopify.com/content/vocabulary) („identify and eliminate synonyms") (5. fejezet)
- [NN/g: A Link is a Promise](https://www.nngroup.com/articles/link-promise/) (B1, T2)
- [NN/g: Beyond Blue Links](https://www.nngroup.com/articles/clickable-elements/) (T1, T4)
- [Baymard: Cart & Checkout Usability](https://baymard.com/research/checkout-usability) (4.4)
- [IBM Carbon: Remove pattern (remove ≠ delete)](https://v10.carbondesignsystem.com/community/patterns/remove-pattern/) – *„Removing is an action that moves information from one location to another… Deletion is the most common type of removal and is destructive."* (5.1/#19: miért „Kiveszem a kosárból", nem „Törlés")
- [Shopify Polaris: Vocabulary](https://polaris.shopify.com/content/vocabulary) – *„identify and eliminate synonyms"* (5.1: miért egységesül a `Beállítás…` a `Mentés…`-re)
- [GOV.UK Design System: Button – writing button text](https://design-system.service.gov.uk/components/button/) – a fizetésre „Pay", a záró lépésre „Confirm and send"; *„Disabled buttons have poor contrast and can confuse some users, so avoid them if possible."* (5. fejezet #2, #16, #20)
- [NN/g: Jakob's Law of Internet User Experience](https://www.nngroup.com/videos/jakobs-law-internet-ux/) (5. fejezet: a régi oldal 100 %-os E/1 mintája mint megszokás-bizonyíték)

**Mérési reprodukció:** `curl` GET a `https://kineticare-production.up.railway.app` 11 útvonalára, majd `<a>`/`<button>` kivonatolás script- és svg-mentesített HTML-ből; a kontraszt-számítás sRGB relatív luminanciával a `styles/tokens.css` hex-értékeiből. A `npm run typecheck` a K1 igazolásához futott (exit 0).
