# Vásárló-átköltöztetés: systeme.io → Kineticare

> **Mire való:** a systeme.io-n vásárolt, meglévő ügyfelek zökkenőmentes
> átvitele az új Kineticare-platformra — úgy, hogy a vevő **ne veszítse el a
> hozzáférését**, **ne kelljen újra fizetnie**, és **pontosan tudja, mikor mi
> történik**.
>
> **Eszköz:** `src/scripts/import-customers.ts` (CSV-import) +
> `src/lib/customer-import/` (parser / terv / végrehajtás / aktiválási linkek /
> aktiváló levelek).
>
> **E-mail-szolgáltató: Resend** (megrendelői döntés) — az élesítés lépései a
> **10.1.** pontban.
>
> **Kapcsolódó:** `docs/manualis-vasarlas-hozzaadas.md` (egy-egy vevő kézi
> jóváírása), feladatlista **C8 / T-061**.

---

## 1. A kommunikáció öt alapelve

Ez a rész a „hogyan mondjuk el" kérdésre válaszol. A minta a nagy
szervezetek átállás-kommunikációja: **egyetlen igazságforrás, előre kiadott
idővonal, világos cselekvés, nyitott visszaút.**

1. **Egy hang, egy üzenet.** Minden levél ugyanabból a fiókból, ugyanazzal az
   aláírással és ugyanazzal a szóhasználattal megy ki. A vevő ne kelljen
   találgatnia, hogy valódi-e a levél — ezért nem használunk új feladó-címet
   az átállás közben.
2. **Előre bejelentett idővonal.** A vevő az első levélben megkapja a TELJES
   menetrendet (mikor mi történik, meddig mit tud használni). Semmi ne érje
   meglepetésként.
3. **Egyetlen kért cselekvés levelenként.** Egy levél = egy gomb. A bejelentő
   levélben nincs teendő; az aktiváló levélben pontosan egy: jelszót beállítani.
4. **A hozzáférés kimondva, nem sejtetve.** „A megvásárolt kurzusaid átkerültek,
   újra fizetni NEM kell." Ez a mondat szó szerint szerepeljen — ez a vevő
   legfőbb félelme.
5. **Visszaút biztosítva.** A régi rendszer addig marad élő, amíg az új
   bizonyítottan működik (lásd 7. — rollback-elv). Ezt is elmondjuk a vevőnek:
   „ha bármi nem sikerül, a régi felület még elérhető."

**Amit sosem írunk le:** hogy a rendszert most építjük, hogy mi mennyibe került,
hogy technikailag mi bonyolult. A vevőt a saját hozzáférése érdekli.

---

## 2. Idővonal

`T` = az átállás napja (a nap, amikor az új platform az egyetlen belépési pont).
Ajánlott: **kedd vagy szerda délelőtt** — így a hét maradékában van emberi
kapacitás a válaszokra. Ne péntek, ne ünnep előtt.

| Nap | Lépés | Ki csinálja | Kimenet |
| --- | --- | --- | --- |
| **T−14** | Adat-előkészítés: systeme.io-export letöltése, kurzusnév→SKU tábla összeállítása | technikai + Katák | `export.csv`, `--map` párok listája |
| **T−13** | **Próbafutás** (`--dry-run`) az éles adatbázis ellen, terv átnézése | technikai | terv-táblázat, nem leképezett kurzusnevek listája |
| **T−12** | A nem leképezett kurzusnevek tisztázása, `--map` kiegészítése, újabb próbafutás | Katák | tiszta próbafutás (0 ismeretlen kurzusnév) |
| **T−10** | **1. levél — Bejelentés** (teendő nincs) | Katák | minden meglévő vevő értesítve |
| **T−3** | Éles import futtatása (fiókok + hozzáférések létrejönnek), aktiválási linkek generálása | technikai | mérleg + `linkek.csv` |
| **T−3** | **2. levél — Aktiváló, személyre szóló linkkel** (`--send-invites`, vagy körlevél a `linkek.csv`-ből) | technikai / Katák | mindenki tud jelszót állítani |
| **T−1** | **3. levél — Emlékeztető** csak azoknak, akik még nem léptek be | Katák | lemorzsolódás csökkentése |
| **T** | **Átállás napja:** a régi felület kezdőlapján/levélben átirányítás az újra | Katák | egyetlen belépési pont |
| **T+2** | Utókövetés: kik nem léptek be még → egyéni megkeresés | Katák | senki nem marad kint |
| **T+14** | Zárómérleg: belépési arány, hibalista lezárva | technikai + Katák | döntés a systeme.io lemondásáról |

**Kulcsszabály:** a **T−3**-as import és a **T−3**-as aktiváló levél KÖZÖTT ne
teljen el több nap. A generált link 30 napig érvényes, de a vevő fejében az
„épp most kaptam" a legerősebb cselekvésre ösztönző.

---

## 3. Mit tapasztal a vevő

| Kérdés | Mi történik a háttérben |
| --- | --- |
| Kap-e új fiókot? | Igen, az **eddigi e-mail-címével**. Ha már regisztrált az új oldalon, a meglévő fiókja marad — új nem jön létre. |
| Mi lesz a jelszavával? | A régi jelszó **nem költözik át** (nem is ismerjük). Az aktiváló levélben kap egy linket, amivel sajátot állít be. |
| Mi lesz a kurzusaival? | A megvásárolt kurzusok hozzáférésként (`purchases`) átkerülnek. A már meglévő hozzáféréseket az import **sosem törli** — csak kiegészíti. |
| Kell újra fizetnie? | Nem. Az import nem hoz létre rendelést és nem indít fizetést. |
| Mi van, ha kétszer futtatjuk az importot? | Semmi. A művelet idempotens: a második kör a kész sorokat kihagyja. |
| Mi a helyzet, ha a vevő MÁR fent van, csak nem tud belépni? | Ez a 4.5. „egyetlen levél" esete: közös linket kap a `/belepes-atallas` lapra (4.6.), ott a saját címével kér visszaállító linket. Új import nem kell hozzá. |

---

## 4. Kész e-mail-szövegek

A `{{ }}` jelöléseket a levelezőrendszer körlevél-funkciója tölti ki.
**Az aktiváló levél linkje személyre szól** — csak körlevélként (mail merge)
küldhető ki, közös link NINCS.

### 4.1. Bejelentő levél (T−10) — teendő nincs

> **Tárgy:** Költözünk — a kurzusaid hamarosan új helyen várnak
>
> Kedves {{nev}}!
>
> Örömmel jelentjük be: a Kineticare kurzusai **új, saját platformra
> költöznek**. A cél egyszerű — gyorsabb videólejátszás, átláthatóbb
> kurzusoldalak és egy fiók, ahol minden megvásárolt anyagod egy helyen van.
>
> **A legfontosabb: a megvásárolt kurzusaid átkerülnek, újra fizetned NEM kell.**
>
> Mi vár rád, és mikor:
>
> - **{{datum_aktivalas}}** – kapsz tőlünk egy levelet egy személyes linkkel,
>   amivel beállíthatod a jelszavadat az új felületen.
> - **{{datum_atallas}}** – ettől a naptól az új oldalon éred el a kurzusaidat.
>
> **Most nincs teendőd.** Ezt a levelet elég elolvasni — a következő levél hozza
> majd a linket. Ha bármi kérdésed van, válaszolj erre a levélre, és emberi
> választ kapsz.
>
> Üdvözlettel:
> a Kineticare csapata

### 4.2. Aktiváló levél (T−3) — személyre szóló linkkel

> **Tárgy:** Itt a linked: állítsd be a jelszavad a Kineticare új felületén
>
> Kedves {{nev}}!
>
> Elkészült az új Kineticare-fiókod. Már minden megvásárolt kurzusod benne van —
> **újra fizetned nem kell**, csak egy jelszót kell beállítanod.
>
> **Jelszó beállítása:** {{aktivalasi_link}}
>
> Így indulj el:
>
> 1. Kattints a fenti linkre (csak neked szól, ne add tovább).
> 2. Adj meg egy jelszót — legalább 12 karakter, legyen benne kis- és nagybetű
>    és szám.
> 3. Belépés után a **Kurzusaim** oldalon találod az anyagaidat.
>
> A link **{{link_ervenyesseg}}**-ig érvényes. Ha lejárna, az „Elfelejtett
> jelszó" gombbal bármikor kérhetsz újat ugyanezzel az e-mail-címmel.
>
> Ha elakadsz, válaszolj erre a levélre — segítünk.
>
> Üdvözlettel:
> a Kineticare csapata

### 4.3. Emlékeztető (T−1) — csak azoknak, akik még nem léptek be

> **Tárgy:** Emlékeztető: még nem állítottad be a jelszavad
>
> Kedves {{nev}}!
>
> Azt látjuk, hogy még nem léptél be az új Kineticare-felületen. Semmi baj —
> a kurzusaid megvannak, és **holnaptól** az új oldalon éred el őket.
>
> **A jelszó beállítása 1 perc:** {{aktivalasi_link}}
>
> Ha a link nem működik, vagy nem emlékszel, melyik e-mail-címmel vásároltál,
> válaszolj erre a levélre — megkeressük, és megoldjuk.
>
> Üdvözlettel:
> a Kineticare csapata

### 4.4. „Segítségre van szükségem" — válasz-sablon

Erre a levélre a Katák válaszolnak; a `[ ]` részeket a helyzethez kell igazítani.

> **Tárgy:** Re: {{eredeti_targy}}
>
> Kedves {{nev}}!
>
> Köszönjük, hogy szóltál — megnéztük a fiókodat.
>
> [**HA a link lejárt vagy nem működik:**]
> Küldtem egy friss linket erre a címre — kérlek, azzal próbáld újra. Ha percek
> alatt sem érkezik meg, nézd meg a Spam/Levélszemét mappát is.
>
> [**HA másik e-mail-címmel vásárolt:**]
> A vásárlásodat a(z) {{masik_email}} címen találtuk meg. Két lehetőség van:
> ezzel a címmel lépsz be, vagy szólj, és átvezetjük a mostani címedre.
>
> [**HA hiányzik egy kurzus:**]
> Ellenőriztük, és igazad van: a(z) {{kurzus}} nem került át. Már javítottuk, a
> következő belépésnél látni fogod. Elnézést a kellemetlenségért.
>
> Ha bármi más nem stimmel, írj nyugodtan — végigmegyünk rajta együtt.
>
> Üdvözlettel:
> {{alairas}}

### 4.5. EGYETLEN levél a MÁR feltöltött vevőknek (2026-08-21, tulajdonosi kérés)

A 4.1–4.3. hármas az EREDETI forgatókönyvhöz készült (bejelentés T−10,
aktiváló T−3, emlékeztető T−1), ahol az import még hátravan. Ez a szakasz a
MÁSIK helyzetre szól, amit a tulajdonos kért: **a vevők már fent vannak az új
oldalon**, csak nem tudják, hogy a régi jelszavuk nem működik. Ilyenkor egyetlen
levél megy ki, és az mindent elmond.

**Miért közös link, és miért nem személyre szóló.** A 4.2. aktiváló levél
személyes tokent visz; ez a levél **nem**. Három oka van:

1. a tulajdonos kérése szó szerint az, hogy a vevők „jöjjenek majd fel az új
   oldalra és kérjenek új jelszót": ő maga kérte a kérésre épülő utat;
2. közös link mellett **nincs mail merge**: a levél sima körlevélként is
   kiküldhető, tehát nem kell a `linkek.csv`-t (titkot tartalmazó fájlt)
   kézbe venni;
3. token nem kerül a levélbe, tehát a továbbküldött vagy kiszivárgott levél
   nem ér semmit. (A visszaállító link, amit a vevő MAGÁNAK kér, 1 óráig él:
   Payload alapérték, `forgotPassword.expiration = 3600000 ms`.)

Ára: a vevő két levelet kap (ezt, majd a saját visszaállító linkjét). Ha egy
lépést akartok, a 4.2. levél és a `--send-invites` út továbbra is él, az
viszont mail merge-öt és a token kezelését kívánja.

> **Tárgy:** Új helyen a kurzusaid: állítsd be a jelszavad
>
> Kedves {{nev}}!
>
> A Kineticare kurzusai új, saját felületre költöztek. Ezért írunk: a **régi
> jelszavad az új oldalon nem működik**, mert a korábbi oldal külön rendszer
> volt, és a jelszavakat onnan nem vesszük át. Nem veszett el semmi, és nem is
> te hibáztál: mindenkinek új jelszót kell beállítania, aki eddig a régi oldalon
> vásárolt.
>
> **A megvásárolt kurzusaid megvannak, újra fizetned nem kell.**
>
> Állítsd be a jelszavad: {{belepes_atallas_url}}
>
> A megnyíló oldalon add meg azt az e-mail-címet, amelyre ezt a levelet kaptad.
> Küldünk rá egy linket, azon beállítod a saját jelszavad, és utána a
> **Kurzusaim** oldalon ott lesz minden anyagod. A link 1 óráig érvényes; ha
> lejár, ugyanott kérhetsz újat.
>
> Ha pár percen belül nem érkezik meg a levél, nézd meg a levélszemét mappát is,
> és keress rá a Kineticare szóra. Ugyanarra a címre 10 percen belül legfeljebb
> 3 levelet küldünk ki, ezért ha többször is kérted, várj néhány percet az újabb
> próbálkozással.
>
> Ha elakadsz, vagy nem emlékszel, melyik címmel vásároltál, válaszolj erre a
> levélre. Emberi választ kapsz, és megkeressük a fiókodat.
>
> Üdvözlettel:
> {{alairas}}

**A behelyettesítendő mezők**

| Mező | Mi kerül bele | Ki adja meg |
| --- | --- | --- |
| `{{nev}}` | a vevő keresztneve; merge nélkül „Kedves Vásárlónk!" a megszólítás | levelezőrendszer / Katák |
| `{{belepes_atallas_url}}` | az átállási céllap teljes címe: a `NEXT_PUBLIC_SERVER_URL` + `/belepes-atallas` | üzemeltetés |
| `{{alairas}}` | az aláírás (a 4.1–4.3. levelekével AZONOS, 1. alapelv) | Katák |

**Amit a levél SZÁNDÉKOSAN nem tartalmaz:** dátumot (a régi felület
lekapcsolásának napját a tulajdonos még nem adta meg), határidőt, sürgetést és
második linket. Egy levél = egy gomb (3. alapelv).

**A két szám a levélben nem díszítés.** A „10 percen belül legfeljebb 3 levelet"
a `password-forgot-email` kérés-korlát emberi nyelvű alakja
(`src/lib/security/rate-limit.ts`); ugyanez a mondat áll a céllapon is, és
őr-teszt köti a keret valódi értékéhez
(`src/__tests__/belepes-atallas-ui.test.tsx`). Ha a keretet valaha átállítjátok,
a teszt kidobja a levélből és a lapról is elavult mondatot.

### 4.6. Hova visz a levél linkje: `/belepes-atallas`

A levél EGYETLEN linkje a `/belepes-atallas` lapra megy. Ez nem a
„Elfelejtett jelszó" lap: az átköltöztetett vevő **nem felejtette el** a
jelszavát, az a régi rendszerben működött. Ha a levél az „Elfelejtetted a
jelszavad?" című lapra vinné, a cím nem az ő helyzetét írná le (WCAG 2.2 ·
2.4.6 Headings and Labels), és a vevő azt hihetné, rossz helyre jutott.

A lap négy dolgot teljesít, mindegyiket őr-teszt méri:

1. kimondja, hogy **nem a vevő hibázott**, és megmondja az okot (a régi oldal
   külön rendszer volt);
2. kimondja szó szerint: **„A megvásárolt kurzusaid megvannak, újra fizetned
   nem kell."**, a beküldés előtt és a beküldés utáni megerősítő panelen is;
3. **egy** kért cselekvés van rajta (a visszaállító link kérése), ugyanazzal a
   végponttal, kérés-korláttal és gombfelirattal, mint a `/elfelejtett-jelszo`;
4. van **visszaút** (`/belepes`) és **segítségkérés** (`/kapcsolat`).

A lap keresőben nem jelenik meg: a `robots.txt` `/belepes` tiltása
előtag-egyezéssel a `/belepes-atallas`-ra is áll.

**Aki a levelet nem kapja meg**, a megszokott úton érkezik: fejléc → Belépés →
régi jelszó → „Hibás e-mail-cím vagy jelszó." → „Elfelejtetted a jelszavad?".
Ezért a `/elfelejtett-jelszo` lap is kapott egy állandó bekezdést arról, hogy a
régi oldal jelszava itt nem működik, és hogy a kurzusok megvannak. A `/belepes`
lap SZÁNDÉKOSAN nem kapott átállási sávot: a GOV.UK Design System szerint
lineáris folyamatban a sáv nem a helyes eszköz, és „there's evidence that people
often miss them"
(https://design-system.service.gov.uk/components/notification-banner/).

### 4.7. A 4.5. levél KÉSZ sablonja és küldője (WP40, 2026-09-16)

A 4.5. szövege 2026-09-16-tól **kódban él**: `src/lib/email/templates/migration.ts`
(tárgy + előnézeti sor + HTML a közös `layout.ts` brand-keretében + plain-text),
a kiküldő pedig `npm run email:migracio` (`src/scripts/send-migration-notice.ts`,
részletek: 6.7.). A tulajdonos 7. körös hangsúlyai kerültek bele: megújult az
oldal; a régi jelszó elavult; az új jelszót AZZAL a címmel kell beállítani,
amelyre a levél érkezett (ezzel regisztrált); belépés után a **Kurzusaim**
menüpontban vannak a megvett kurzusok vagy az ingyenes SOS KézRelax villámkurzus.

> **Tárgy:** Megújult a Kineticare: állítsd be az új jelszavad
> *(49 karakter; őr-teszt: legfeljebb 60)*
>
> **Előnézeti sor:** A régi jelszavad itt már nem működik. A kurzusaid
> megvannak, újra fizetned nem kell.
>
> *Fiók-átköltöztetés*
>
> **Megújult az oldal, új jelszó kell**
>
> Kedves {{nev}}! *(név nélkül: Kedves Vásárlónk!)*
>
> A Kineticare oldala megújult: a kurzusok új, saját felületre költöztek. Ezért
> írunk: a régi jelszavad elavult, az új oldalon már nem működik. Nem veszett el
> semmi, és nem te hibáztál: mindenkinek új jelszót kell beállítania, aki a
> korábbi oldalon regisztrált.
>
> **A megvásárolt kurzusaid megvannak, újra fizetned nem kell.**
>
> Az új jelszót azzal az e-mail-címmel állítsd be, amelyre ezt a levelet kaptad
> (**{{email}}**), mert ezzel regisztráltál nálunk. A gomb megnyitja a beállító
> oldalt: ott add meg ezt a címet, és küldünk rá egy linket, amelyen a saját
> jelszavadat választhatod meg. A link 1 óráig érvényes; ha lejár, ugyanott
> kérhetsz újat.
>
> Belépés után a Kurzusaim menüpontban találod a megvásárolt kurzusaidat, vagy
> ha azt kérted, az ingyenes SOS KézRelax villámkurzust.
>
> **[ Beállítom az új jelszót ]** → `{{NEXT_PUBLIC_SERVER_URL}}/belepes-atallas`
>
> Ha elakadsz, vagy nem emlékszel, melyik címmel regisztráltál, válaszolj erre
> a levélre. Emberi választ kapsz, és megkeressük a fiókodat.
>
> Üdvözlettel:
> a Kineticare csapata
>
> *Ha pár percen belül nem érkezik meg a levél, nézd meg a levélszemét mappát
> is, és keress rá a Kineticare szóra. Ugyanarra a címre 10 percen belül
> legfeljebb 3 levelet küldünk ki, ezért ha többször is kérted, várj néhány
> percet az újabb próbálkozással.*
>
> **Lábléc:** Kineticare · Kézrehabilitációs online kurzusplatform
> Ezt a levelet azért kapod, mert a(z) {{email}} címmel fiókod van a Kineticare
> oldalán, és a fiókodat az új felületre költöztettük át.
> Kérdésed van? Válaszolj erre a levélre, vagy írj a(z) info@kineticare.hu címre.

**Tervezési döntések (forrással; a részletes indoklás a sablon fejkommentjében):**

| Döntés | Miért | Forrás |
| --- | --- | --- |
| Egy levél, egy gomb, aláírás | 1. alapelv, 3. pont; a cselekvés elöl, a kiegészítő tudnivaló hátul | NN/g, *Transactional and Confirmation Email* (https://www.nngroup.com/articles/transactional-and-confirmation-email/) |
| Tárgy ≤ 60 karakter, a lényeg elöl | a kliens rövidít | Postmark, *Transactional email best practices* (https://postmarkapp.com/guides/transactional-email-best-practices); GOV.UK Service Manual, *Sending emails and text messages* (https://www.gov.uk/service-manual/design/sending-emails-and-text-messages) |
| A gomb felirata `Beállítom az új jelszót` (§3.2 #22), NEM új szinonima | ugyanaz a cselekvés, mint az aktiváló levélben és a jelszó-beállító lapon → ugyanaz a felirat | WCAG 2.2 SC 3.2.4 Consistent Identification; Polaris („identify and eliminate synonyms"); `docs/ui-sztenderdek.md` §3.2 |
| Válasz-cím: `info@kineticare.hu`, a lábléc kimondja, miért kapja | fiókkal kapcsolatos értesítés; a válasz figyelt postaládába menjen | Postmark (fent): „Avoid a noreply@ address if you can"; GOV.UK (fent): „include contact details for your service" |
| Nincs List-Unsubscribe fejléc | tranzakciós, fiókkal kapcsolatos értesítés, nem hírlevél | Postmark (fent) |
| A „10 percen belül legfeljebb 3 levél" mondat a `password-forgot-email` keret értékéből épül | ne maradjon hazug szám, ha a keretet átállítják | `src/lib/security/rate-limit.ts`; őr: `src/__tests__/email-migracio-sablon.test.ts` (bitre azonos a `/belepes-atallas` mondatával) |
| Resend `Idempotency-Key` címzettenként (`migracio-<userId>`), 250 ms szünet | a kulcs 24 óráig él, ≤ 256 karakter; a csapat-szintű alap-korlát 10 kérés/mp | https://resend.com/docs/dashboard/emails/idempotency-keys; https://resend.com/docs/api-reference/rate-limit |

A „1 óráig érvényes" mondat a Payload `forgotPassword.expiration` alapértékéből
(3 600 000 ms) számolódik; őr-teszt köti a `payload.config` users-collectionjéhez.

**Mérve (Chromium, 600 px és 320 px, `scratchpad/wp40/`):** törzs #33495f/#ffffff
9,30:1; címsor 15,63:1; gomb szövege #ffffff/#2f6e9f 5,45:1 (WCAG 1.4.3 ≥ 4,5:1);
gombfelület 5,45:1 (1.4.11 ≥ 3:1); gomb 230×46 px (2.5.8 ≥ 24×24, cél 44); 320
px-en nincs vízszintes görgetés (1.4.10); sorhossz 600 px-en 65 karakter.

---

## 5. GYIK — a vevők kérdései és a válaszok

**„Mi lesz a hozzáférésemmel?"**
Minden korábban megvásárolt kurzusod átkerül az új fiókodba, ugyanarra az
e-mail-címre. A hozzáférés nem jár le az átállás miatt.

**„Kell újra fizetnem?"**
Nem. Az átköltöztetés nem hoz létre új rendelést és nem indít fizetést. Amit egyszer
megvettél, az a tiéd marad.

**„Nem kaptam linket, mit tegyek?"**
Először nézd meg a Spam/Levélszemét mappát, és keress rá a „Kineticare" szóra.
Ha így sincs meg, az oldalon az **Elfelejtett jelszó** gombbal bármikor kérhetsz
újat — ugyanazzal az e-mail-címmel, amivel vásároltál. Ha az sem érkezik meg,
írj nekünk: elképzelhető, hogy más címmel vásároltál.

**„Lejárt a linkem."**
Kérj újat az **Elfelejtett jelszó** gombbal. A régi link ilyenkor automatikusan
érvénytelenné válik — mindig a legfrissebb levélben lévő linket használd.

**„Két e-mail-címem is van, melyikkel lépjek be?"**
Azzal, amelyikkel vásároltál. Ha nem emlékszel, írj nekünk, és megkeressük.

**„Meddig érem el a régi felületet?"**
Az átállás napjáig biztosan. Utána is csak akkor mondjuk le a régi rendszert, ha
az új már mindenkinél működik.

**„Elveszik a haladásom / a jegyzeteim?"**
A kurzus-hozzáférés átkerül. A régi rendszerben tárolt megtekintési előzmény nem
költözik — a videók újranézhetők, korlátozás nélkül.

**„A régi jelszavammal próbáltam, és azt írja: Hibás e-mail-cím vagy jelszó."**
Ez a várt viselkedés: a régi oldal jelszava nem költözött át. Ugyanez az üzenet
jelenik meg akkor is, ha a cím nincs a rendszerben — a hibaüzenetből nem derül
ki, van-e fiók (mérve 2026-09-16). A teendő: a levélben kapott linkről, vagy az
**Elfelejtett jelszó** gombbal kérj beállító linket.

**„Túl sok próbálkozás — ezt írta a lap."**
Ugyanarra a címre 10 percen belül legfeljebb 3 levelet küldünk ki; a 4. kérés
ezzel az üzenettel bukik. Várj 10 percet, és a legfrissebb levél linkjét használd.

**„Mikor jár le a hozzáférésem?"**
Az átköltöztetett vásárlásnál lejáratot nem számolunk: a Kurzusaim listán nincs
„Hozzáférés eddig" dátum, a kurzus korlátlanul nyílik. (Technikai háttér a 6.5.
pontban.)

---

## 6. A CLI használata lépésről lépésre

### 6.0. Előkészítés

Kell hozzá:

- a systeme.io-export CSV-je (e-mail + név + megvásárolt kurzus/címke oszlop),
- a **kurzusnév → SKU** tábla (a Katáktól): melyik régi kurzusnév melyik
  Kineticare-terméknek felel meg. A SKU-t az adminban a **Kurzusok** listában
  látod („Kurzus neve (azonosító)").

> **Fontos:** a scriptet abból a könyvtárból futtasd, ahol a `.env` elérhető —
> a `DATABASE_URI`-t és a `PAYLOAD_SECRET`-et a Payload-config onnan olvassa.
> A `--out-links` használatához a `NEXT_PUBLIC_SERVER_URL` is kell.

### 6.0.1. A systeme.io kontakt-export (címke-alapú lista)

A tulajdonos által átadott export fejléce:

```text
"Email","First name","Last name","Tag","Date Registered"
```

Ez NEM kurzusnév-oszlopos alak: a `Tag` cella **vesszővel elválasztott
címkéket** tartalmaz, és egy sorban több címke is állhat. A script magától
felismeri ezt az alakot (a vezetéknév- és a címke-oszlop együttes jelenlétéből);
kényszeríteni a `--format=systeme` kapcsolóval lehet.

**A címkék jelentése** (a szabálytábla helye: `src/lib/customer-import/tags.ts`):

| Címke | Mit jelent | Hozzáférés |
| --- | --- | --- |
| `SOS KézRelax vásárló` | az ingyenes SOS Kézrelax villámkurzus vásárlója | **igen** |
| `Otthoni KézRehab vásárló` | a fizetős Otthoni KézRehab Program vásárlója | **igen** |
| `Előjelentkezők` | érdeklődő, nem vásárolt | nem |
| `Visszatérítés KézRelax` | visszatérített SOS Kézrelax | **kiüti** a SOS-t |
| `Visszatérítés Kézrehab` | visszatérített Otthoni KézRehab | **kiüti** a KézRehabot |
| üres cella | nincs címke | nem |
| bármi más | ISMERETLEN címke | nem — figyelmeztetés a mérlegben |

Két szabály, ami könnyen félremegy:

- **A visszatérítés csak a SAJÁT párját üti ki.** Aki mindkét kurzust
  megvette, de csak az egyiket téríttette vissza, a másikat megkapja.
- **Az ismeretlen címke nem állítja meg a futást.** A vevő fiókja és a többi
  hozzáférése elkészül, a címke pedig a mérlegben, néven nevezve megjelenik.
  Ha kiderül, hogy mégis vásárlást jelent, két út van: felvenni a
  szabálytáblába (kódmódosítás), vagy — ha nem vásárlás —
  `--ignore-tag "<címke>"` kapcsolóval nem-vásárlásnak jelölni.

**Név:** a két név-oszlop össze-vissza van töltve (van, ahol az egyik hordozza a
teljes nevet, van, ahol ismétlődnek). Az összeállítás ezért: üres oszlop → a
másik érték; azonos érték → egyszer; ha az egyik TARTALMAZZA a másikat → a
bővebb marad; különben a kettő összefűzve, a fájl oszlopsorrendjében. Így
egyetlen névtöredék sem vész el, és nem keletkezik duplikátum.

**Dátum:** a `Date Registered` (`2025-03-04 09:30:00 (UTC+2)`) ISO-alakra
normalizálódik, és a beírt hozzáféréssel együtt **audit-bejegyzésbe** kerül
(admin → Rendszer → Műveletnapló, művelet: `customer-import.legacy-purchase`).
Így visszakereshető marad, ki mikor lett vevő a régi rendszerben. Ha ugyanaz az
e-mail több sorban szerepel, a LEGKORÁBBI dátum marad.

### 6.0.2. Fájl-ellenőrzés adatbázis nélkül (`--parse-only`)

A legolcsóbb első lépés: a fájl értelmezése **adatbázis-kapcsolat nélkül**.
Kiírja a címke-mérleget (ki mit kapna), a hibás sorokat és az ismeretlen
címkéket — írás sehol nem történik.

```bash
npx tsx src/scripts/import-customers.ts \
  --file=kontakt-lista.csv \
  --map "SOS KézRelax vásárló=<SKU>" \
  --map "Otthoni KézRehab vásárló=<SKU>" \
  --parse-only
```

### 6.0.3. A CSV átadása fájl NÉLKÜL (Railway-job)

A vásárlói lista **személyes adat: a repóba nem kerülhet be.** Ha a scriptet a
Railway-en futtatjátok, a fájl helyett egy környezeti változóban adható át,
base64-kódolva:

| Változó | Tartalom |
| --- | --- |
| `IMPORT_CUSTOMERS_CSV_BASE64` | a CSV-fájl teljes tartalma base64-kódolva |

```bash
# 1. kódolás a saját gépen (Linux)
base64 -w0 kontakt-lista.csv > lista.b64      # macOS: base64 -i kontakt-lista.csv

# 2. a lista.b64 tartalmát beilleszteni:
#    Railway → a szolgáltatás → Variables → IMPORT_CUSTOMERS_CSV_BASE64

# 3. a script --file NÉLKÜL fut:
npx tsx src/scripts/import-customers.ts --map "SOS KézRelax vásárló=<SKU>" --dry-run
```

- A `--file` és a változó **együtt nem használható** (hibaüzenettel megáll):
  mindig egyértelmű legyen, melyik listát importáljátok.
- **A futás után a változót TÖRÖLNI kell** (Railway → Variables → a változó
  törlése). Amíg ott van, a személyes adat a szolgáltatás konfigjában marad.
- A script a változó tartalmát sosem írja ki és nem naplózza.

### 6.1. Első lépés: PRÓBAFUTÁS (kötelező)

```bash
npx tsx src/scripts/import-customers.ts \
  --file=export.csv \
  --map "Kéz Rehab Alap=KEZ-ALAP" \
  --map "Kéz Rehab Haladó=KEZ-HALADO" \
  --dry-run
```

A próbafutás **egyetlen sort sem ír** az adatbázisba. Kiírja:

- a teljes tervet táblázatban (`ÚJ FIÓK` / `BŐVÍTÉS` / `KIHAGY` soronként),
- a **nem leképezett kurzusneveket** — ezekhez hiányzik a `--map` pár,
- az összesítőt (létrehozandó / bővítendő / kihagyva / hibás sor).

**Addig ne menj tovább, amíg a „nem leképezett kurzusnév" lista nem üres**
(vagy amíg tudatosan el nem döntöttétek, hogy az adott címke — pl. hírlevél-tag —
nem kurzus, tehát kimaradhat).

### 6.2. Oszlopnevek és elválasztó

Ha a fájl fejléce nem felismerhető nevű (a script az `email` / `név` / `kurzus`
jellegű neveket ismeri automatikusan), add meg kézzel:

```bash
npx tsx src/scripts/import-customers.ts \
  --file=export.csv --delimiter=';' \
  --email-col="E-mail cím" --name-col="Teljes név" --courses-col="Megvásárolt termékek" \
  --map "Kéz Rehab Alap=KEZ-ALAP" --dry-run
```

| Kapcsoló | Mire jó |
| --- | --- |
| `--delimiter=';'` | Magyar Excelből mentett fájl (pontosvessző). `--delimiter='\t'` = tabulátor. |
| `--email-col` / `--name-col` / `--courses-col` | Az oszlopok fejlécneve, ha az automatikus felismerés nem talál. |
| `--last-name-col` / `--registered-col` | A systeme.io vezetéknév- és dátum-oszlopa, ha a fejléc szokatlan. |
| `--format=systeme` | A címke-alapú (systeme.io) értelmezés kényszerítése. `--format=generic` = a régi, kurzusnév-oszlopos alak. |
| `--ignore-tag "<címke>"` | Ismételhető. A címke NEM vásárlás (hozzáférést nem ad, nem is hiba). |
| `--refund-tag "V=K"` | Ismételhető. A `V` visszatérítés-címke kiüti a `K` vásárlás-címkét. |
| `--map "Név=SKU"` | Ismételhető. Egy kurzusnév/címke → egy termék. |
| `--parse-only` | Csak a fájl ellenőrzése, adatbázis-kapcsolat nélkül. |
| `--dry-run` | Próbafutás: nulla írás. |
| `--out-links=<út>` | Aktiválási linkek CSV-be (éles futásnál). |
| `--invite-all` | Link ne csak az új fiókoknak, hanem minden érintett vevőnek. |
| `--send-invites` | **Aktiváló levél kiküldése** az új fiókoknak (lásd 6.4.1.). |
| `--send-invites=all` | Levél minden tervbeli vevőnek — a kihagyottaknak is. |
| `--help` | Súgó. |

### 6.3. Éles futtatás

Ugyanaz a parancs, `--dry-run` **nélkül**, kiegészítve a linkek kimenetével:

```bash
npx tsx src/scripts/import-customers.ts \
  --file=export.csv \
  --map "Kéz Rehab Alap=KEZ-ALAP" \
  --map "Kéz Rehab Haladó=KEZ-HALADO" \
  --out-links="$HOME/kineticare-linkek.csv"
```

A futás soronként kiírja az eredményt, a végén pedig a **mérleget**:

```text
MÉRLEG — létrehozva: 128, bővítve: 14, kihagyva (már megvolt): 3, hibás sor: 0,
nem leképezett kurzusnév: 0.
```

### 6.4. Az aktiválási linkek fájlja

- Alapból csak az **újonnan létrehozott** fiókokhoz készül link; a
  `--invite-all` kapcsolóval minden érintett vevő kap.
- A fájl `email,aktivalasi_link` oszloppal, UTF-8 BOM-mal készül — az Excel
  ékezethelyesen, oszlopokra bontva nyitja meg. Ez a körlevél forrásfájlja.
- **A fájl titkot tartalmaz.** Aki megkapja a linket, jelszót állíthat az adott
  fiókhoz. Ezért:
  - a projekt könyvtárán **kívülre** írasd (`--out-links="$HOME/kineticare-linkek.csv"`),
  - a repóba **soha** ne kerüljön be,
  - a körlevél kiküldése után **töröld**.
- Új linkgenerálás felülírja a korábbi tokent: a régi link ilyenkor
  érvénytelen. Ne keverd a köröket — mindig a legfrissebb fájlból küldj.

### 6.4.1. Levélküldés a scriptből (`--send-invites`)

A körlevél helyett a script maga is kiküldheti a **magyar aktiváló levelet**
(4.2. szövege), címzettenként a saját linkjével. A szolgáltató **Resend** —
az élesítés feltételeit lásd a 10. pontban.

```bash
npx tsx src/scripts/import-customers.ts \
  --file=export.csv \
  --map "Kéz Rehab Alap=KEZ-ALAP" \
  --send-invites
```

**A sorrend kötött: `--dry-run` → éles futás → küldés.**

| Amit tudni kell | Miért |
| --- | --- |
| `--dry-run`-nal EGYÜTT nem használható | A script hibaüzenettel, `1`-es kóddal áll meg, **még a fájl beolvasása előtt**. Próbaképp nem megy ki 300 valódi levél. |
| `RESEND_API_KEY` nélkül el sem indul | Kulcs híján a levelek csendben elnyelődnének, és a futás sikeresnek látszana. |
| Alapból csak az **új fiókok** kapnak levelet | `--send-invites=all` esetén minden tervbeli vevő (a `KIHAGY`-ottak is) — ez az „újraküldés mindenkinek" eset. |
| Egy bukott küldés nem állítja meg a kört | A hibás címzettek a végén listázódnak, a kilépési kód `1`. Javítás után újrafuttatható. |
| A küldések közt kis szünet van | Rate-limit-barát: egy több százas kör nem fut bele a szolgáltató korlátjába. |
| A token és a link **nem kerül naplóba** | A napló csak maszkolt címet (`k***@example.com`) és darabszámot lát. |

A futás végén a mérleg egy sorral bővül:

```text
AKTIVÁLÓ LEVELEK — elküldve: 128, sikertelen: 0.
```

Ha nincs kinek küldeni (pl. újrafuttatás, ahol minden sor `KIHAGY`), a script
ezt írja ki — **ez nem hiba**:

```text
Nincs kinek küldeni — levél nem ment ki. Ez nem hiba.
```

A `--out-links` és a `--send-invites` **együtt is használható**: a linkek
egyetlen körben készülnek, tehát a CSV-be írt link ugyanaz, mint amit a levél
tartalmaz. (Külön körben a második generálás érvénytelenítené az elsőt.)

### 6.5. Ellenőrzés az import után

1. Az adminban nézz meg **3 mintavevőt**: van fiókjuk, a „Megvásárolt kurzusok"
   mezőben ott a helyes kurzus, a szerepkörük `Vásárló`. A **Felhasználók
   listában** külön oszlop mutatja a megvásárolt kurzusokat (a kurzus címével),
   szűrni a „Szűrők" gombbal lehet rá.
2. Egy tesztfiókkal (saját cím) menj végig a teljes úton: link → jelszó →
   belépés → **Kurzusaim** → videó elindul.
3. A mérleg számai stimmeljenek: `létrehozva + bővítve + kihagyva` = a fájlban
   szereplő **egyedi e-mail-címek** száma (a többször szereplő e-mail egynek
   számít — a script összefésüli), a hibás sorok pedig ezen felül vannak.

**Helyben végigmért teljes út (2026-09-16, WP41, Chromium + helyi SMTP-gyűjtő,
3 fiktív vevő: vásárolt / ingyenes SOS / mindkettő):** import `--dry-run` →
éles import `--out-links` → `/belepes-atallas` (és `/elfelejtett-jelszo`) →
a levél linkje (`NEXT_PUBLIC_SERVER_URL` + `/jelszo-visszaallitas?token=…&returnUrl=%2Fkurzusaim`)
→ új jelszó → a munkamenet a jelszó után él (külön belépés nem kell) →
**Kurzusaim** a helyes kurzus(ok)kal → `/kurzusaim/<id>` nyílik → a
`/api/stream-token` nem ad 401/403-at (a nem megvett kurzusra 403). A
`linkek.csv` aktiválási linkje ugyanide vezet. A használt, hibás vagy hiányzó
token magyar hibát ad, újrakérési úttal. Őr-teszt: `src/__tests__/atallas-vegpont.test.ts`.

**Amit az admin „Megvásárolt kurzusok" mezője és a Kurzusaim lista másképp
mutathat:**

- A Kurzusaim csak a `published`/`archived` kurzust listázza; egy `draft`
  kurzus az adminban a vevőnél látszik, a listán nem (a lejátszó úgysem nyílna).
- **Időkorlátos kurzusnál (`accessDurationDays`, pl. 365 nap) az import NEM ír
  `accessGrants` kezdőpontot**, és paid rendelés sincs, ezért a hozzáférés
  „ismeretlen vásárlási dátum" ággal **korlátlan** (fail-open): a listán nincs
  „Hozzáférés eddig" felirat, a videó megy. Ez megfelel az 5. GYIK ígéretének
  („a hozzáférés nem jár le az átállás miatt"). Ha a tulajdonos mégis órát
  akar az átköltöztetett vevőknek, az külön döntés: a
  `docs/access-grants-backfill.md` szándékosan nem talál ki dátumot, a
  „Kurzus ajándékozása" panel pedig a mai naptól indítaná.

### 6.6. Újrafuttatás (megszakadt futás)

**Az import idempotens**, ezért a megszakadt futás (hálózat-hiba, Ctrl-C,
adatbázis-zár) **biztonságosan újraindítható ugyanazzal a paranccsal**:

- meglévő felhasználónál a jelszót, a szerepkört és a meglévő vásárlásokat
  **sosem** módosítja,
- csak a ténylegesen hiányzó hozzáférést fűzi hozzá,
- a már kész sorokat a második kör `KIHAGY`-ként jelenti.

Amire figyelj: ha a `--out-links` kapcsolót is megismétled, **új tokenek**
készülnek, és a korábban kiküldött linkek érvénytelenné válnak. Újrafuttatásnál
a linkgenerálást csak akkor kérd, ha a leveleket még nem küldtétek ki.

### 6.7. Az átköltöztetési értesítő kiküldése (`npm run email:migracio`)

A 4.7. levél küldője. **Alapból PRÓBAFUTÁS**: kiírja a címzettek számát és
maszkolt listáját, semmi nem megy ki. Küldeni csak a
`MIGRATION_NOTICE_CONFIRM=igen` környezeti változóval küld.

> **Railway job-argumentumok (2026-09-16):** a `railway.email-job.json` indítóparancsa az `EMAIL_JOB_ARGS` változó tartalmát adja át a scriptnek (pl. `--test-to=valaki@example.com`, `--limit=20`, `--only=…`, `--include-no-access`). Üres változó = argumentum nélküli (próba- vagy éles) futás a `MIGRATION_NOTICE_CONFIRM` szerint. A változót minden futás után érdemes üríteni, hogy egy későbbi automatikus deploy ne ismételje a teszt-küldést.


**Címzett-kör** (`src/lib/migration-notice/recipients.ts`): `customer`
szerepkör + `passwordSetupPending: true` (a rendszer hozta létre a fiókot:
import vagy ingyenes-kurzus igénylés, és a vevő MÉG NEM állított be saját
jelszót; a jelző az első sikeres belépéskor magától törlődik, tehát aki már
belépett, kiesik). Kimarad: staff/owner; akinek az ÚJ oldalon rendelése van
(vendég-vásárló, neki nem volt régi jelszava); aki már megkapta a levelet
(`users.migrationNoticeSentAt`); és **akinek nincs kurzus-hozzáférése**
(`purchases` és `accessGrants` üres): neki a levél Kurzusaim-ígérete hamis
lenne (vezetői döntés, 2026-09-16). Ez utóbbiakat a próbafutás külön, maszkolva
és darabszámmal listázza („HOZZÁFÉRÉS NÉLKÜL, nem kap levelet: N"). Az ilyen
fiók jellemzően a nem leképezett import-címke következménye: előbb a **10.
pont 2. sorának címke → SKU tábláját** kell rendezni és a hozzáférést pótolni
(`--map` az importban vagy `grant-purchase`), utána a vevő magától bekerül a
körbe. Ha mégis levelet kell kapniuk hozzáférés nélkül, a
`--include-no-access` kapcsoló veszi be őket. **Egy címre egyszer megy ki** a
levél; újraküldés csak `--force`-szal.

| Kapcsoló / változó | Mit csinál |
| --- | --- |
| *(semmi)* | próbafutás: címzett-kör, maszkolt lista, levél nem megy ki |
| `MIGRATION_NOTICE_CONFIRM=igen` | éles küldés ugyanazzal a paranccsal |
| `--test-to=<cím>` | EGY tesztlevél a megadott címre, kapu nélkül, adatbázis és jelölés nélkül (a feladó-domain és a kézbesítés próbája) |
| `--limit=N` | legfeljebb N címzett (azonosító szerint az első N; a próbafutás és az éles kör ugyanazokkal kezd) |
| `--only=<cím>` | csak ez az egy vevő a címzett-körből |
| `--force` | újraküldés a már jelölt fiókoknak is |
| `--include-no-access` | a kurzus-hozzáférés nélküli fiókok is kapjanak levelet (alapból kimaradnak) |
| `--help` | súgó |

**A sorrend kötött:** `--test-to` a saját címedre → próbafutás → `--limit=5`
éles → teljes éles.

```bash
# 1. tesztlevél a saját címedre (RESEND_API_KEY, EMAIL_FROM, NEXT_PUBLIC_SERVER_URL kell)
npm run email:migracio -- --test-to=sajat.cim@example.com

# 2. próbafutás (semmi nem megy ki)
npm run email:migracio

# 3. első 5 vevő élesben
MIGRATION_NOTICE_CONFIRM=igen npm run email:migracio -- --limit=5

# 4. mindenki
MIGRATION_NOTICE_CONFIRM=igen npm run email:migracio
```

**A próbafutás elvárt naplója:**

```text
CÍMZETT-KÖR: 128 vevő (kihagyva: már kapott 0, új oldalon rendelt 3, hozzáférés nélkül 1, szűrő miatt 0).
  k***@example.com (#41)
  …

HOZZÁFÉRÉS NÉLKÜL, nem kap levelet: 1 (purchases és accessGrants üres; előbb a címke → SKU tábla, …; kérésre --include-no-access):
  m***@example.com (#42) · nincs kurzus-hozzáférés

PRÓBAFUTÁS: levél NEM ment ki, jelölés nem történt. Éles küldés: MIGRATION_NOTICE_CONFIRM=igen környezeti változóval, ugyanezzel a paranccsal.
```

A „HOZZÁFÉRÉS NÉLKÜL" listát a küldés előtt nézd meg az adminban (a 10. pont
2. sora: nem leképezett címke); ők levelet csak a hozzáférés pótlása után, vagy
kifejezett kérésre (`--include-no-access`) kapnak.

**Az éles futás naplója:** soronként `[ELKÜLDVE] k***@example.com`, a végén
`MÉRLEG: elküldve N, sikertelen M, jelölés sikertelen K.` és a sikertelenek
listája (maszkolt cím, fiók-azonosító, hiba). Kilépési kód `0` = hibátlan,
`1` = indítási hiba vagy sikertelen küldés. A napló sosem tartalmaz teljes
címet vagy kulcsot.

**Ütemezés és idempotencia.** Két küldés között 250 ms szünet (4 kérés/mp, a
Resend csapat-szintű alap-korlátja 10 kérés/mp); 429 vagy 5xx esetén legfeljebb
két újrapróbálás (1,5 s, 4 s). Minden címzett saját Resend idempotencia-kulcsot
kap (`migracio-<userId>`, 24 óráig él), sikeres küldés után a fiók
`migrationNoticeSentAt` mezője kap időbélyeget. Ha a levél kiment, de a jelölés
nem sikerült, a sor `[ELKÜLDVE, JELÖLÉS SIKERTELEN]`, és a mérleg is mutatja:
24 órán belül a Resend-kulcs véd a duplikáció ellen; utána az adminban
(Felhasználók → a vevő → „Átköltöztetési értesítő kiküldve") látszik, hogy üres.

**Futtatás a Railwayen (email-job szolgáltatás).** A script a Kineticare-app
környezetében fut, tehát ugyanazok a változók kellenek: `DATABASE_URI`
(`${{Postgres-c8Rg.DATABASE_URL}}`), `PAYLOAD_SECRET`, `NEXT_PUBLIC_SERVER_URL`
(https://kineticare.hu), `RESEND_API_KEY`, `EMAIL_FROM`. A `railway.json`
mindig felülírja a service-beállítást (üzemeltetési tanulság 2.), ezért a
jobnak saját config-fájl van: **`railway.email-job.json`** (`startCommand`:
`npx tsx src/scripts/send-migration-notice.ts`, utána `sleep`, hogy a konténer
ne induljon újra). Lépések:

1. A content-job szolgáltatáson (vagy egy erre a célra létrehozott, a repóhoz
   kötött szolgáltatáson) a **Config file path** (`railwayConfigFile`)
   átállítása `railway.email-job.json`-ra.
2. Variables: a fenti öt változó; `MIGRATION_NOTICE_CONFIRM` **még NEM**.
3. Deploy → a logban `EMAIL_JOB_START`, majd a PRÓBAFUTÁS naplója,
   `EMAIL_JOB_DONE`. Ellenőrizd a címzettszámot.
4. `MIGRATION_NOTICE_CONFIRM=igen` felvétele → redeploy → éles küldés.
   Kapcsolókhoz (`--limit=5`) a `startCommand` végére írd a kapcsolót a
   config-fájlban, vagy futtasd a `railway run`-nal helyben, éles változókkal.
5. A futás UTÁN a `MIGRATION_NOTICE_CONFIRM` változó **törlése**, és a
   szolgáltatás leállítása (vagy a config-fájl visszaállítása), hogy egy
   későbbi redeploy ne indítson új kört. (Új kört a jelölés miatt akkor sem
   küldene, de a próbafutás naplója így nem téveszt meg.)

**Rollback.** A levél visszahívhatatlan; a jelölés törlése nem kell: az
újrafuttatás a jelölt fiókokat kihagyja, újraküldés csak `--force`-szal. Ha
rossz szöveg ment ki, a javított sablonnal `--force` küld mindenkinek újra
(két levelet kapnak), ezért előbb `--test-to` és `--limit`.

---

## 7. Hibaágak — mit jelentenek és mi a teendő

| Jelenség | Mit jelent | Teendő |
| --- | --- | --- |
| `Nem található a fájl: …` (exit 1) | Rossz útvonal | Ellenőrizd a `--file` értékét. |
| `Nincs importálható sor.` | Üres fájl vagy csak fejléc | Kérd újra az exportot. |
| `Nem található e-mail-oszlop…` | A fejléc neve ismeretlen | Add meg: `--email-col="…"`. |
| `Hiányzó vagy többlet oszlop: …` (sor kimarad) | A sor mezőszáma eltér a fejléctől — elcsúszott adat | Nézd meg az adott sort a fájlban; javítás után futtasd újra. |
| `Hibás e-mail-formátum` / `Üres e-mail-cím` | Rossz cella | A sor kimarad, a futás megy tovább. Javítsd, és futtasd újra. |
| `a --map olyan SKU-ra hivatkozik, ami nincs az adatbázisban` (exit 1) | Elgépelt SKU | **Írás nem történt.** Javítsd a `--map` értéket. |
| `Nem leképezett kurzusnevek (…)` | Hiányzó `--map` pár | Egészítsd ki, vagy tudatosan hagyd ki (pl. hírlevél-címke). |
| `a users kollekció üres…` (exit 1) | Nincs még admin-felhasználó | Előbb hozd létre az admint — az első user owner szerepkört kapna. |
| Egy soron `HIBA` | Adatbázis-hiba annál a sornál | A futás folytatódik; a végén exit-kód 1. **Futtasd újra** — az idempotencia miatt csak a hiányzó sorok készülnek el. |
| `a --send-invites és a --dry-run nem használható együtt` (exit 1) | A két kapcsoló egyszerre | **Semmi nem történt.** Előbb próbafutás, aztán éles futás a küldéssel. |
| `nincs beállítva e-mail-szolgáltató…` (exit 1) | Hiányzik a `RESEND_API_KEY` | **Semmi nem történt.** Állítsd be a kulcsot a Railway → Variables felületén (10. pont), és indítsd újra. |
| Egy címzetten `SIKERTELEN` | A szolgáltató elutasította vagy nem érte el | A kör folytatódik a többi címzettel; a végén exit-kód 1. A hibás címzetteknek küldj újra (`--send-invites=all` vagy kézi körlevél a `linkek.csv`-ből). |
| A vevő a lapon sikert lát („Ellenőrizd az e-mail-fiókodat"), de levél nem jön | A `/api/users/forgot-password` **mindig 200-at ad** (fiók-létezés nem szivároghat); a küldés hibája csak a naplóban látszik: `e-mail küldés sikertelen` (Resend elutasítás, nem Verified domain) vagy `noop-provider aktív` (nincs `RESEND_API_KEY`) | Nézd meg a Railway-naplót a maszkolt címre (`v***@…`). Resend: a domain legyen **Verified**, az `EMAIL_FROM` a hitelesített domainen. Csak a napló bizonyít — a 200-as válasz nem. |
| A levél a szöveges (text/plain) olvasóban üres volt | A Payload forgot-password művelete csak HTML-t ad; az adapter 2026-09-16-ig üres szöveges részt küldött | Javítva: az adapter a HTML-ből szöveges változatot készít, a linkkel (őr-teszt: `atallas-vegpont.test.ts`). |
| Helyi próbánál `SMTP … nem hirdet STARTTLS-t` | Az SMTP-küldő titkosítás nélkül nem küld | Helyi gyűjtőhöz implicit TLS a 465-ös porton (önaláírt tanúsítvány + `NODE_EXTRA_CA_CERTS`), vagy STARTTLS-t hirdető szerver. |

**Kilépési kódok:** `0` = hibátlan futás; `1` = indítási hiba (fájl, argumentum,
ismeretlen SKU, üres users-kollekció) **vagy** legalább egy hibás sor a futásban.

---

## 8. Rollback-elv — a visszaút

**A systeme.io-előfizetést csak a SIKERES átállás UTÁN mondjátok le.** Amíg a
régi rendszer él, minden hiba visszafordítható: a vevő ott is eléri az anyagot.

A lemondás feltételei (mind teljesüljön, tipikusan **T+14** környékén):

1. Az import mérlege hibátlan (`hibás sor: 0`, `nem leképezett kurzusnév: 0`).
2. A vevők legalább **80%-a** belépett az új felületen.
3. A maradék vevőket egyenként megkerestétek (T+2-es utókövetés), és nincs
   megválaszolatlan „nem tudok belépni" levél.
4. Az exportfájl **és** a régi rendszer adatai archiválva vannak (a
   kurzus-hozzáférések listája a lemondás után is rekonstruálható legyen).
5. Az adatbázisról van mentés (feladatlista **C14** — élesítés előtti tétel).

Ha bármelyik feltétel nem teljesül: **ne mondjátok le**, hosszabbítsatok egy
hónapot. Egy hónapnyi előfizetés olcsóbb, mint egyetlen elveszett vevő.

**Ha az import félrement:** a script **nem töröl semmit**, tehát nincs mit
visszaállítani — a rossz hozzáférést az adminban lehet levenni, a felesleg
fiókot pedig tulajdonosi jogosultsággal törölni. Ezért is kötelező a
próbafutás: a terv átnézése olcsóbb, mint a takarítás.

---

## 9. Adatvédelem és titokkezelés

- Az **exportfájl** és a **linkfájl** személyes adatot (és tokent) tartalmaz:
  a repóba egyik sem kerülhet be, a kiküldés után törlendők. Ha a listát
  környezeti változóban adjátok át (`IMPORT_CUSTOMERS_CSV_BASE64`, 6.0.3.), azt
  a futás után **törölni kell** — a base64 nem titkosítás, csak kódolás.
- A script **nem naplóz** jelszót, tokent és aktiválási linket — a strukturált
  naplóba csak e-mail, felhasználó-azonosító, termék-azonosító és darabszám kerül.
- A generált kezdőjelszó véletlen, sehol nem jelenik meg, és a vevő úgysem
  használja: a jelszavát az aktiválási linkkel ő maga állítja be.
- Az import **alapból nem küld e-mailt**. A küldés külön, tudatos kapcsoló
  (`--send-invites`, 6.4.1.), ami próbafutással és e-mail-kulcs nélkül el sem
  indul. A küldő út is naplózás-tiszta: a levélbe kerülő link és token sosem
  kerül a naplóba, a címzett is csak maszkolva (`k***@example.com`).

---

## 10. Mi kell még az éleshez

Ezek a nyitott pontok — nélkülük az eszköz kész, de az átállás nem indítható.

**Legutóbbi felülvizsgálat: 2026-08-21.** Ami azóta teljesült, áthúzva marad
(nem törölve): a lista így mutatja, mi mozdult, és mi nem.

| # | Mi hiányzik | Kitől | Állapot 2026-08-21-én |
| --- | --- | --- | --- |
| 1 | ~~A systeme.io-export pontos formátuma~~ | Katák | **KÉSZ** (2026-08-16): `"Email","First name","Last name","Tag","Date Registered"`, vesszős elválasztó, címke-alapú lista; a parser felismeri (6.0.1.). Új export érkezésekor egy `--parse-only` futás megmutatja, változott-e a fejléc. |
| 2 | **Címke → SKU tábla** — melyik Kineticare-termék felel meg a `SOS KézRelax vásárló` és az `Otthoni KézRehab vásárló` címkének | Katák | **NYITOTT.** Enélkül a címkék nem leképezettként kimaradnak (a vevő fiókot kapna, kurzus-hozzáférést nem). A SKU az adminban, a Kurzusok listában látszik. |
| 3 | ~~E-mail-küldés döntése és beállítása~~ | üzemeltetés | **RÉSZBEN KÉSZ.** A szolgáltató eldöntve (Resend); a `RESEND_API_KEY` és az `EMAIL_FROM` a Railway Kineticare-szolgáltatásán BE VAN ÁLLÍTVA. Ami MÉG NINCS igazolva: a feladó-domain **Verified** állapota a Resendben, és egy sikeres **próbalevél** (10.1. 5. lépés). Amíg ez a kettő nincs meg, a körlevél nem indítható. |
| 4 | **Adatbázis-mentés** (feladatlista C14) | üzemeltetés | **NYITOTT** a `DATABASE_URI` GitHub-secret beállításáig (`db-backup.yml`). Tömeges írás előtt kötelező visszaállítási pont. |
| 5 | **Az átállás dátuma** és a levelek aláírása | Katák | **NYITOTT.** A 4.1–4.3. sablonok `{{datum_*}}` mezői és MINDEN levél `{{alairas}}` mezője. A 4.5. „egyetlen levél" dátumot SZÁNDÉKOSAN nem tartalmaz, aláírást viszont igen. |
| 6 | **Kettős e-mail-címek listája** (aki más címmel vásárolt, mint amit használ) | Katák | **NYITOTT.** Kézi összevezetést igényel: az import e-mail-cím alapján dolgozik. |
| 7 | ~~A vevői céllap, ahova a levél linkje visz~~ | technikai | **KÉSZ** (2026-08-21): `/belepes-atallas` (4.6.), plusz a `/elfelejtett-jelszo` állandó bekezdése a régi vevőnek. Őr-teszt: `src/__tests__/belepes-atallas-ui.test.tsx`. |
| 8 | **A levél kiküldésének csatornája** | üzemeltetés | **NYITOTT DÖNTÉS.** A 4.5. levél közös linkes, tehát mail merge nélkül is mehet. Eldöntendő, hogy Resend broadcast megy-e, vagy a Katák saját levelezője; ettől függ, hogy a `{{nev}}` mező kitölthető-e. **2026-09-16:** a csatorna KÉSZ: `npm run email:migracio` (6.7.), a `{{nev}}` a fiók nevéből töltődik. Ami még nyitott: az aláírás végleges alakja (ma: „a Kineticare csapata", a 4.1–4.2 levelekkel azonos) és a feladó-domain Verified állapota + próbalevél (`--test-to`). |

**Ami NEM hiányzik (mérve, ne induljon rá újabb kör):** a jelszó-kérő és
jelszó-beállító lap, az enumeráció-védelem (a végpont mindig 200-at ad), a
kérés-korlát (IP-re és a CÍMZETT címére is 3 kérés / 10 perc), a
`passwordSetupPending` jelző és annak automatikus törlése az első belépéskor, a
CSV-import, az aktiválási linkek és a magyar levélsablonok.

### 10.1. E-mail-küldés élesítése (Resend)

A szolgáltató **Resend** (megrendelői döntés). A kódoldal kész — ami hiányzik,
az kizárólag üzemeltetői beállítás. Sorrendben:

1. **Resend-fiók** létrehozása a Kineticare nevére (ne magánfiók legyen: a
   kulcsokat és a domaint a cégnek kell birtokolnia).
2. **A `kineticare.hu` feladó-domain hitelesítése** a Resend felületén
   (*Domains → Add Domain*). A Resend kiír néhány **DNS-rekordot** — ezeket a
   domain szolgáltatójánál kell felvenni:
   - **SPF** (TXT) — melyik szerver küldhet a domain nevében,
   - **DKIM** (TXT) — a levelek kriptográfiai aláírása,
   - (ajánlott) **DMARC** (TXT) — mi történjen a nem hitelesíthető levéllel.
   A rekordok terjedése akár órákig tarthat; a Resend felületén a domain
   állapotának **Verified**-re kell váltania. **Amíg nem az, a küldés
   elutasításra kerül** — ne az átállás napján kezdjétek.
3. **API-kulcs** létrehozása (küldési joggal), és beállítása **KIZÁRÓLAG a
   Railway → Variables** felületén: `RESEND_API_KEY`. A kulcs
   **soha** nem kerülhet a repóba, PR-be, jegybe vagy chat-üzenetbe. Ha
   véletlenül mégis kikerül: a Resendben azonnal vonjátok vissza és
   generáljatok újat. **(2026-08-21: beállítva.)**
4. **Feladó beállítása:** `EMAIL_FROM` (pl. `Kineticare <no-reply@kineticare.hu>`)
   — a domain rész legyen az a domain, amit a 2. lépésben hitelesítettetek.
   **(2026-08-21: beállítva.)**
   Beállítás nélkül a rendszer `noreply@localhost`-ra esik vissza, ami élesben
   biztosan visszapattan.
5. **Próbalevél**: az oldalon az „Elfelejtett jelszó" gombbal kérjetek
   visszaállítást egy saját címre. Ha megérkezik és a linkről be tudtok
   állítani jelszót, a lánc működik. **Ez a lépés 2026-08-21-én még nincs
   igazolva** — a kulcs megléte nem bizonyítja, hogy a domain Verified, és hogy
   a levél be is érkezik. A 4.5. körlevél előtt EZ az utolsó kapu.
   A próbát a `/belepes-atallas` lapról érdemes futtatni: az a lap megy ki a
   levélben, tehát a teljes vevői utat egyszerre méritek.
6. Csak ezután futtassátok a `--send-invites`-t (6.4.1.).

**Amíg ezek nincsenek kész:** a rendszer nem hibázik, csak nem küld levelet —
naplóban egyszer figyelmeztet („noop-provider aktív"), a `--send-invites` pedig
érthető magyar üzenettel elutasít. Az átállás ilyenkor a **`linkek.csv` +
kézi körlevél** úton is végigvihető (6.4.).
