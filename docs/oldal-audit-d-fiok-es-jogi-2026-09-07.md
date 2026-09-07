# Oldal-audit D: vásárlás utáni, fiók- és jogi felületek

**Dátum:** 2026. szeptember 7. · **Terjedelem:** `/belepes`, `/regisztracio`,
`/elfelejtett-jelszo`, `/jelszo-visszaallitas`, `/belepes-atallas`, `/fiok`,
`/kurzusaim`, `/kurzusaim/<id>` (lejátszó), `/aszf`, `/adatvedelem`,
`/impresszum`, a 404-es oldal és a lábléc mint navigációs felület.

**Ez AUDIT.** Kódot nem módosítottam, tesztet nem írtam, nem commitoltam.
Az egyetlen létrehozott repó-fájl ez a dokumentum.

---

## 0. Módszer és mérési környezet

**Alkalmazás:** a `main` aznapi állapota a helyi fejlesztői szerveren
(`http://localhost:3000`), helyi Postgres (`127.0.0.1:5433/kineticare_local`).
Az éles hostot (`kineticare-production.up.railway.app`) nem terheltem
teszt-fiókokkal.

**Teszt-adatok, kizárólag a HELYI adatbázison** (élesen semmit nem írtam):

| Fiók                      | Szerep   | Miért kellett                                                                                    |
| ------------------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `audit-owner@local.test`  | owner    | a `promoteFirstUserToOwner` hook miatt az ELSŐ user owner; enélkül nem lehet 2. usert létrehozni |
| `vevo-audit-d@local.test` | customer | a vásárlói nézetek (fiók, kurzusaim, lejátszó)                                                   |
| `ures-audit-d@local.test` | customer | az ÜRES állapot (nincs megvett kurzus)                                                           |

A vásárlói fiók a `npm run grant:purchase` paranccsal kapta meg az „Otthoni
KézRehab Program" kurzust (`src/scripts/grant-purchase.ts`). A parancs először
elutasította magát (`Ehhez a kurzushoz nincs megadva, hány napig él az
ajándék.`), ezért a helyi terméken beállítottam `accessDurationDays: 365`-öt,
és feltöltöttem három modult nyolc leckével, hogy a lejátszó ne üres tananyagon
méretődjön. Mindez a helyi DB-ben él, a repót nem érinti.

**Mérőeszköz:** Chromium 1194 (playwright-core), 1440×900, 390×844 és 320×800
px, `prefers-reduced-motion: reduce` és `no-preference`. Számított
kontrasztarány (sRGB relatív luminancia, alfa-összeolvasztással a tényleges
háttérre), mért befoglaló dobozok, canvas-alapú karakterszélességből számolt
sorhossz, valódi `Tab`-billentyűs fókuszbejárás, `document.getAnimations()`.
A szkriptek és a képek a session-scratchpad `audit-d/` mappájában:
`lib.mjs`, `measure.mjs`, `forms.mjs`, `contrast2.mjs`, `focus.mjs`,
`states.mjs`, `obscured.mjs`, `fold.mjs`, `player-mobile.mjs`,
`measure.json`, `forms.json`, `contrast2.json`, valamint 35 képernyőkép.

**Mérési önkorrekció (fontos).** Az első kontraszt-futás 12 oldalon jelzett
bukást a fejléc „Kurzusok" gombján (1,06:1). Ez a MÉRŐESZKÖZ hibája volt: a
Chromium a gomb hátterét `color(srgb 0.0627451 0.141176 0.243137)` alakban adja
vissza, amit a kezdeti `rgb()`-re írt elemző nem ismert fel, ezért a lap
hátteréig sétált fel. A javított elemző (`color(srgb …)` + canvas-fallback)
után a gomb valós aránya **15,60:1**. A dokumentumban csak a javított elemzővel
kapott számok szerepelnek. Ugyanezzel a javított elemzővel maradt fenn a D1
találat, tehát az nem műtermék: képernyőképpel is igazolt.

**Módszertani lánc:** (1) heurisztikus végigjárás Nielsen tíz heurisztikájával,
(2) kognitív séta a `docs/felhasznaloi-seta.md` personájával, (3) mérés,
(4) tartalmi és jogi teljességi ellenőrzés, (5) on-page SEO-réteg.

**Amit NEM ismételek meg**, mert már dokumentált és ma is fennáll:
a `/fiok` árvasága (`docs/informacios-architektura.md` A2 és 2. sor), a
`/fiok` és a `/kurzusaim` funkcionális duplikációja (uo. D3), a fiók
kijelentkezés-gombjának hiánya (`docs/gomb-inventar.md` B4), és a kezdőlapi
süti-sáv takarása (`docs/kezdolap-ux-audit-2026-09-07.md` 1. pont). Ezekre
hivatkozom, és ahol ÚJ következményt mértem, azt külön kiemelem.

---

## 1. Összefoglaló

A vizsgált tizenkét felület alaprétege erős. Mérve: **egyetlen szövegkontraszt-bukás
sincs** a vizsgált tíz oldalon (1131 ellenőrzött szövegcsomópont, 1440 és
390 px-en együtt; a két bukás mindkettője a D1, a lejátszó hibapanelje), a
betűméret kizárólag a három tokenről jön (asztali 16/19/40 px, mobil 14/16/32 px),
**320 px-en egyik lapon sincs vízszintes túlcsordulás** (a dokumentum-szélesség
minden lapon pontosan 320 px), a fókuszjelölés a beviteli mezőkön mérve látható,
mozgás egyik módban sem fut, a mobil tananyag-panel szabályos modális dialógus
fókuszcsapdával és Escape-tel, és a 404-es oldal a GOV.UK-minta magyar
megfelelője.

A baj négy helyen van, és mind a négy a VÁSÁRLÁS UTÁNI bizalmat érinti:

1. **A lejátszó mind a négy hibaállapotában a mentőgombok láthatatlanok.**
   A sötét (#10243e) színpadon a `kc-button--secondary` szövege ÉS kerete is
   #10243e: mért kontraszt **1,00:1**. Amikor a vevő videója nem indul, az
   „Újrapróbálom" és az „Írj nekünk" gomb szó szerint nem látszik. Képernyőképpel
   igazolva (`jatszo-hibapanel-1440.png`).
2. **A regisztráció hibakezelése méréssel elmarad a belépésétől**, és a
   szerver üzenete hazudik: 12 karakteres, csupa kisbetűs jelszóra azt írja,
   hogy „min. 12 karakter", holott a valódi ok a hiányzó nagybetű és szám.
   Mezőszintű hiba nincs (`aria-invalid` sehol), a jelszó-követelmény a
   regisztráción és a visszaállításon KÉTFÉLE.
3. **A haladás csak kézi jelöléssel épül.** A `course_progress` gyűjtemény
   `videoRef` + `watchedAt` párost tárol, lejátszási POZÍCIÓT nem, és a
   `bindLessonProgress` feliratkozót a lejátszó-oldal nem adja át. Aki
   végignézi a videót és bezárja a lapot, 0%-on marad, és a „Folytasd a
   kurzust" visszaviszi az 1. leckére.
4. **A jogi lapokon nincs tájékozódási eszköz és nincs verziódátum.** Az ÁSZF
   mért magassága 1440 px-en **19 221 px** (21,4 képernyő), tartalomjegyzék,
   címsor-horgony, „vissza a tetejére" és hatályossági dátum nélkül. Az
   impresszum tárhelyszolgáltatóként a Tárhely.Eu Kft.-t nevezi meg, miközben
   az alkalmazás a Railwayen fut, és a jogi lapok e-mail-címe
   (`egeszsegmozgastamogatas@gmail.com`) nem egyezik a lábléc címével
   (`info@kineticare.hu`).

### 1.1 Találati táblázat

| #   | Találat                                                                                     | Hol                                                  | Súly   | Méret           |
| --- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------ | --------------- |
| D1  | A lejátszó hibaállapotainak gombjai láthatatlanok (1,00:1)                                  | `styles/ui.css:196`, `CoursePlayer.tsx:890-950`      | **P1** | S               |
| D2  | A regisztráció szerver-hibaüzenete félrevezet (a 12 karakteres jelszóra „min. 12 karakter") | `src/lib/auth-client.ts`, `RegisterForm.tsx`         | **P1** | S               |
| D3  | A regisztrációnak nincs mezőszintű hibája (`aria-invalid` sehol)                            | `RegisterForm.tsx:150-166`                           | **P1** | M               |
| D4  | A `/fiok` űrlapján egyetlen `autocomplete` sincs                                            | `AccountView.tsx:106-153`                            | **P1** | S               |
| D5  | Nincs jelszó-mutatás (mutat/rejt) egyetlen jelszómezőn sem                                  | `LoginForm`, `RegisterForm`, `ResetPasswordForm`     | **P2** | M               |
| D6  | Kétféle jelszó-követelmény két lapon                                                        | `RegisterForm.tsx:169`, `ResetPasswordForm.tsx:170`  | **P2** | S               |
| D7  | Nincs jelszócsere és nincs fióktörlés a `/fiok`-on                                          | `AccountView.tsx`                                    | **P2** | M               |
| D8  | A `/fiok` mezői nincsenek `<form>`-ban (Enter nem küld be)                                  | `AccountView.tsx:104-162`                            | **P2** | S               |
| D9  | Az átköltöztetett vevő üres Kurzusaimja nem magyaráz semmit                                 | `course-list-order.ts:32-36`                         | **P2** | S               |
| D10 | Nincs lejátszási pozíció; a haladás csak kézi                                               | `CourseProgress.ts`, `kurzusaim/[id]/page.tsx`       | **P2** | L               |
| D11 | A lejátszó `<title>`-je és H1-e nem nevezi meg a kurzust                                    | `kurzusaim/[id]/page.tsx:20`, `CoursePlayer.tsx:958` | **P2** | S               |
| D12 | A jogi lapokon nincs tartalomjegyzék, horgony, vissza-a-tetejére                            | `[slug]` + CMS-tartalom                              | **P2** | M               |
| D13 | Nincs hatályossági dátum az ÁSZF-en; az adatvédelmié a lap legalján                         | CMS-tartalom                                         | **P2** | S               |
| D14 | Az impresszum tárhelyszolgáltatója elavult (Tárhely.Eu vs. Railway)                         | CMS: `impresszum`                                    | **P2** | S · tulajdonosi |
| D15 | Háromféle kapcsolati adat a jogi lapok és a lábléc között                                   | CMS + `Footer.tsx:20`                                | **P2** | S · tulajdonosi |
| D16 | Az e-mail és a telefonszám a jogi lapokon nem kattintható                                   | CMS-tartalom                                         | **P2** | S               |
| D17 | A süti-sáv első betöltéskor takarja a beküldő gombot 320/390 px-en                          | `consent-banner.css`                                 | **P2** | M               |
| D18 | A 404-es lap böngészőfül-címe a sablon-cím, nem a lap címe                                  | `not-found.tsx:16`                                   | **P2** | S               |
| D19 | Az adatvédelmi tájékoztató egyetlen adatfeldolgozót sem nevez meg                           | CMS: `adatvedelem`                                   | **P2** | M · tulajdonosi |
| D20 | A `/belepes-atallas` indexelhető (nincs `noindex`, nincs robots-tiltás)                     | `robots.ts:16-38`                                    | **P2** | S               |
| D21 | A lábléc nem navigációs felület (nincs benne kurzus, Tudástár, Rólunk)                      | `Footer.tsx`                                         | **P2** | M               |
| D22 | Nulla strukturált adat (`schema.org`) az impresszumon és a jogi lapokon                     | `[slug]/page.tsx`                                    | **P2** | M               |
| D23 | Sikertelen belépés után nincs helyben felkínált visszaállítás                               | `LoginForm.tsx:186-195`                              | **P3** | S               |
| D24 | A hírlevél-bevezető sorhossza 103 karakter 1440 px-en                                       | `NewsletterSignup`                                   | **P3** | S               |
| D25 | Egyetlen kurzusnál is kiírja a „Folyamatban lévő és új kurzusaid" csoportcímet              | `CourseList.tsx`                                     | **P3** | S               |
| D26 | Kijelentkezetten `/kurzusaim/999` → belépés → 404                                           | `courses.ts`, `return-url.ts`                        | **P3** | S               |
| D27 | Az impresszum kétszer írja ki a saját címét                                                 | CMS: `impresszum`                                    | **P3** | S               |

---

## 2. Belépés és fiókkezelés

### 2.1 `/belepes` (Belépés)

**Mit lát a felhasználó** (`belepes-1440.png`, `belepes-390.png`): egy H1
(„Belépés"), egy bevezető mondat, két mező (E-mail-cím, Jelszó), egy elsődleges
gomb, alatta a „Még nincs fiókod? Regisztráció" mondat és az „Elfelejtetted a
jelszavad?" hivatkozás.
**Az oldal egy dolga:** a visszatérő vevő bejusson a megvett kurzusához.

**Mért adatok**

|                         | 1440×900   | 390×844             | 320×800             |
| ----------------------- | ---------- | ------------------- | ------------------- |
| Dokumentum-magasság     | 1422 px    | 1753 px             | 1910 px             |
| H1 doboza               | —          | 104-143 px          | 104-142 px          |
| Első mező               | —          | 261-311 px (342×50) | 286-336 px (272×50) |
| Beküldő gomb            | 530-584 px | 441-491 px (342×51) | 465-516 px (272×50) |
| Süti-sáv                | 788-900 px | 660-844 px          | 594-800 px          |
| Vízszintes túlcsordulás | nincs      | nincs               | nincs               |

Tab-sorrend 390 px-en, valódi billentyűvel mérve: „Ugrás a tartalomra"
(171×51) → márkalogó → „Kurzusok" (98×44) → „Menü megnyitása" (44×44) →
e-mail → jelszó → „Belépés" (342×51) → „Regisztráció" → „Elfelejtetted a
jelszavad?" (179×44). A sorrend a vizuális sorrendet követi
(WCAG 2.2 · 2.4.3), és a kihagyó link elsőként jön (WCAG 2.2 · 2.4.1,
<https://www.w3.org/WAI/WCAG22/Understanding/bypass-blocks.html>).

**Fókuszjelölés, mérve.** Fókusz nélkül a mező kerete `#6b7f94` a fehér mezőn
(4,13:1). `:focus-visible` állapotban a keret `#2f6e9f`-re vált (5,45:1 a mező
hátterén, 5,16:1 a lap hátterén) és 3 px-es `rgba(47,110,159,0.3)` gyűrűt kap.
Mindkét érték a WCAG 2.2 · 1.4.11 3:1-es küszöbe fölött van, tehát a
2.4.7-es „Focus Visible" teljesül
(<https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html>,
<https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html>).

**Üres beküldés, mérve.** Mindkét mező megkapja a magyar hibaüzenetet
(„Add meg az e-mail-címed.", „Add meg a jelszavad."), az `aria-invalid="true"`
mindkettőn ott van, a hiba `role="alert"` bekezdésként a mező alatt áll.
Ez helyes WCAG 2.2 · 3.3.1 megvalósítás
(<https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html>) és
egyezik a GOV.UK hibaüzenet-mintájával
(<https://design-system.service.gov.uk/components/error-message/>).
**Amit nem tesz:** a fókusz a gombon marad (mérve: `activeElement` = BUTTON),
nem ugrik a hibaösszegzőre. A GOV.UK „Error summary" komponens leírása szerint
a beküldés után a fókuszt az összegzőre kell vinni
(<https://design-system.service.gov.uk/components/error-summary/>); NN/g
ugyanezt írja: a hibát a felhasználó szeme elé kell tenni, nem rá kell bízni,
hogy megtalálja (<https://www.nngroup.com/articles/errors-forms-design-guidelines/>).

**Rossz jelszó, mérve.** Az üzenet „Hibás e-mail-cím vagy jelszó.", a fókusz a
hibadobozra ugrik (`activeElement.className = kc-auth-form__error`). Ez helyes:
a felsorolás-védelem miatt szándékosan nem árulja el, melyik volt hibás
(OWASP), és a fókuszkezelés példás.

#### D23 (P3, S) Sikertelen belépés után nincs helyben felkínált visszaállítás

**Mérve:** a hibadobozban nulla hivatkozás van (`hasResetLinkNearError: false`).
A visszaállító link az oldal alján, a hibadoboztól 200 px-nél messzebb áll.
Az elfelejtett jelszó a belépési hiba leggyakoribb oka, és a `/elfelejtett-jelszo`
lapja saját szövegében is számol azzal, hogy „olyan ember is beesik, aki NEM
felejtette el a jelszavát".
**Miért baj:** NN/g Error-Message Guidelines: „Merely stating the problem is
not enough; offer some potential remedies."
(<https://www.nngroup.com/articles/error-message-guidelines/>). Ugyanez a
Polaris hibaüzenet-mintájának alapelve: a hibaüzenet mondja meg, hogyan lehet
tovább (<https://polaris.shopify.com/patterns/error-messages>).
**Javaslat:** a hibadobozba kerüljön be a §3.2 #37 szótári felirata
(„Elfelejtetted a jelszavad?") linkként, a meglévő `forgotPasswordHref(returnUrl)`
céllal. Új felirat nem keletkezik, tehát a WCAG 2.2 · 3.2.4 nem sérül.

### 2.2 `/regisztracio` (Regisztráció)

**Mit lát a felhasználó** (`regisztracio-1440.png`, `regisztracio-390.png`):
H1, bevezető, három mező (Név, E-mail-cím, Jelszó „Legalább 12 karakter."
segédszöveggel), „Regisztráció" gomb, „Már van fiókod? Belépés".

#### D2 (P1, S) A szerver hibaüzenete félrevezeti a vevőt

**Mérve** (`forms.json` → `regGyengeJelszo`): friss e-mail-címmel és a
`csakkisbetuk` jelszóval (pontosan 12 karakter, csupa kisbetű) beküldve a
felület ezt írja ki:

> „Ez az e-mail-cím már foglalt, vagy a jelszó nem felel meg a
> követelményeknek (min. 12 karakter)."

Két hibája van egyszerre. **(a)** A jelszó 12 karakter volt, tehát az üzenet
saját maga cáfolja a bemenetet; a valódi ok a hiányzó nagybetű és a hiányzó
szám (`src/lib/security/password-policy.ts` `\p{Lu}` és `\p{Nd}` ellenőrzése).
**(b)** Két, egymástól teljesen független okot („foglalt e-mail" és „gyenge
jelszó") mos össze, így a vevő nem tudja, melyik mezőt kell javítania.
**Miért baj:** WCAG 2.2 · 3.3.3 Error Suggestion — ha a javítás módja ismert,
azt közölni kell (<https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion.html>).
NN/g: a hibaüzenet legyen pontos és emberi nyelvű, ne általánosítson
(<https://www.nngroup.com/articles/error-message-guidelines/>). GOV.UK Error
message: „Say exactly what went wrong"
(<https://design-system.service.gov.uk/components/error-message/>).
**Javaslat:** a `validatePasswordStrength` már MOST is tételes magyar üzeneteket
ad, és a `ResetPasswordForm` már használja is. A regisztráció kliensoldalán
ugyanezt kell hívni (a hálózati kör előtt), a szerveroldali „foglalt e-mail"
ágat pedig külön üzenettel az e-mail mezőre kötni.

#### D3 (P1, M) A regisztrációnak nincs mezőszintű hibája

**Mérve** (`forms.json` → `regUresHiba`): üres űrlap beküldése után
`.kc-field__error` elemek száma **0**, `aria-invalid` mind a három mezőn
**null**, a fókusz a gombon marad, és az egyetlen visszajelzés egy form-szintű
doboz („Add meg a neved, az e-mail-címed és a jelszavad."). Szerverhiba után a
fókusz a `body`-ra esik (mérve: `activeElement = BODY`), tehát a billentyűzetes
vevő elveszti a helyét.

Ugyanez a `/belepes` lapon mezőnkénti hibával, `aria-invalid`-dal és
fókuszkezeléssel megoldott. **Egy termék, két minta ugyanarra a feladatra.**

**Miért baj:** WCAG 2.2 · 3.3.1 Error Identification kimondja, hogy „the item
that is in error is identified" — egy közös doboz nem azonosítja a HIBÁS
MEZŐT (<https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html>).
WCAG 2.2 · 3.2.4 Consistent Identification: az azonos funkciójú komponensek
azonos módon azonosítandók
(<https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html>).
GOV.UK a hibaösszegző + mezőszintű hiba PÁROSÁT írja elő, és a fókusz
összegzőre vitelét
(<https://design-system.service.gov.uk/components/error-summary/>).
A Baymard inline-validációs kutatása is a mező melletti, azonnali jelzést
támasztja alá (<https://baymard.com/blog/inline-form-validation>).
**Javaslat:** a `RegisterForm` vegye át a `LoginForm` mintáját: `Field.error`
mezőnként, `aria-invalid`, és egy fókuszálható összegző doboz a form tetején.

#### D5 (P2, M) Nincs jelszó-mutatás egyetlen jelszómezőn sem

**Mérve** (`forms.json` → `jelszoMezok`): a `/belepes`, `/regisztracio` és
`/jelszo-visszaallitas` lapon nulla mutat/rejt kapcsoló van, és Caps
Lock-figyelmeztetés sincs. A `/jelszo-visszaallitas` ráadásul KÉT maszkolt
mezőt kér („Új jelszó", „Új jelszó még egyszer").
**Miért baj:** NN/g „Stop Password Masking": a maszkolás rontja a bevitel
pontosságát, és a felhasználók emiatt választanak gyengébb jelszót
(<https://www.nngroup.com/articles/stop-password-masking/>); a NN/g
jelszó-létrehozási cikk ugyanezt a láthatóvá tehető mezőt javasolja
(<https://www.nngroup.com/articles/password-creation/>). A GOV.UK Design System
külön komponensként szállítja a „Show password" gombos jelszómezőt
(<https://design-system.service.gov.uk/components/password-input/>), és a
Material 3 szövegmező-útmutató is a láthatóság-kapcsolót írja le
(<https://m3.material.io/components/text-fields/guidelines>).
Kapcsolódó szabvány: WCAG 2.2 · 3.3.8 Accessible Authentication (Minimum) —
a hitelesítés ne kényszerítsen kognitív próbára
(<https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html>).
**Javaslat:** egy `Field`-szintű, opcionális mutat/rejt gomb (44×44 px
célfelület, `aria-pressed`, magyar felirat a §3.2 szótárból). Ha ez megvan, a
„Új jelszó még egyszer" mező elhagyható — a GOV.UK fiók-létrehozási mintája
sem kér megerősítést, ha a jelszó megmutatható
(<https://design-system.service.gov.uk/patterns/create-accounts/>).

#### D6 (P2, S) Kétféle jelszó-követelmény két lapon

**Mérve:** `/regisztracio` segédszövege „Legalább 12 karakter.";
`/jelszo-visszaallitas` segédszövege „Legalább 12 karakter, kisbetűvel,
nagybetűvel és számmal." A tényleges, szerveroldali szabály a második
(`password-policy.ts`), tehát a regisztráció szövege HIÁNYOS, és ez okozza a
D2 hibakört.
**Miért baj:** WCAG 2.2 · 3.3.2 Labels or Instructions — a mező kitöltéséhez
szükséges tudnivaló a mezőnél, ELŐRE álljon
(<https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html>);
WCAG 2.2 · 3.2.4 Consistent Identification: ugyanaz a szabály ne két
megfogalmazásban éljen
(<https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html>).
**Javaslat:** egyetlen exportált konstans a `password-policy.ts`-ben
(a szabályok emberi nyelvű összefoglalója), és mindkét űrlap ezt használja.
Így a szabály bővítése automatikusan javítja a szöveget.

### 2.3 `/elfelejtett-jelszo` és `/jelszo-visszaallitas`

Ez a két lap a vizsgált halmaz legjobban megírt része, és ezt a mérés is
alátámasztja.

**Mérve:** a beküldés utáni panel felsorolás-védő mondatot ad („Ha a … címhez
tartozik fiók…"), közli a link 1 órás érvényességét, `role="status"` +
`aria-live="polite"`, és a `returnUrl` végigvezetve marad. A
`/jelszo-visszaallitas` token nélkül nem üres űrlapot mutat, hanem egy
`role="alert"` magyarázatot és egy továbblépő linket. A jelszócsere utáni panel
kimondja, hogy a többi eszközön kijelentkezteti a felhasználót, és a
következő gomb a `returnUrl`-re visz (nem a belépőlapra).
Ez egyszerre elégíti ki a WCAG 2.2 · 3.3.3-at és a GOV.UK „ne dobd le a
felhasználót az útról" elvét (<https://www.gov.uk/service-manual/design>).

**Mért geometria** (390×844): H1 104-143 px, mező 261-311 px, gomb 592-643 px
(342×51), „Vissza a belépéshez" link 44 px magas célfelülettel, 32 px-es
elválasztó térközzel a gombtól. Ez WCAG 2.2 · 2.5.8-nak megfelel, és a
NN/g érintőcél-ajánlásának is
(<https://www.nngroup.com/articles/touch-target-size/>,
<https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html>).

Egyetlen megjegyzés: a D5 (jelszó-mutatás) erre a lapra a legerősebben
vonatkozik, mert itt KÉT maszkolt mezőbe kell azonos szöveget gépelni.

### 2.4 `/belepes-atallas` (az átköltöztetett vevő lapja)

**Mit lát a felhasználó** (`belepes-atallas-1440.png`): H1, egy „nem te
hibáztál" bekezdés, kiemelt dobozban a „A megvásárolt kurzusaid megvannak,
újra fizetned nem kell." mondat, az e-mail-mező, majd két utókérdés
(„Mi történik, miután elküldted?", „Nem érkezett meg a levél?") és két
szöveglink.

Tartalmilag ez a legjobban felépített lap az egész halmazban: a migrációs terv
négy alapelvét szó szerint teljesíti, a kérés-korlátot emberi nyelven mondja
el, és a hibáztatás helyett magyarázatot ad. A mért kontrasztok a `auth.css`
fejlécében rögzített értékekkel egyeznek.

#### D17 (P2, M) A süti-sáv első betöltéskor takarja a beküldő gombot

**Mérve, első kirajzoláskor, görgetés nélkül:**

| Nézet   | Lap                | Beküldő gomb | Süti-sáv   | Takarás  |
| ------- | ------------------ | ------------ | ---------- | -------- |
| 390×844 | `/belepes-atallas` | 727-778 px   | 660-844 px | **100%** |
| 320×800 | `/regisztracio`    | 602-652 px   | 594-800 px | **100%** |
| 390×844 | `/regisztracio`    | 605-656 px   | 660-844 px | 0%       |
| 390×844 | `/belepes`         | 441-491 px   | 660-844 px | 0%       |

Képernyőkép: `regisztracio-sutisav-320.png`, `atallas-sutisav-390.png`.

**Amit ez NEM jelent.** Külön megmértem a WCAG 2.2 · 2.4.11 Focus Not Obscured
(Minimum) kritériumot: valódi `Tab`-bal a beküldő gombra lépve a böngésző a
sáv fölé görgeti, és a takarás mind a három nézetben **0%** volt mind a négy
auth-lapon. A sikerkritérium tehát **teljesül**
(<https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html>).
A hiba az egérrel/érintéssel dolgozó vevőt éri, aki az első képernyőn nem
látja a lap egyetlen cselekvését.
**Miért baj:** ez ugyanaz a gyökérok, amit a kezdőlap-audit 1. pontja
(`docs/kezdolap-ux-audit-2026-09-07.md`) a hero-gomboknál mért; itt viszont
egy TRANZAKCIÓS lapon jelentkezik, ahol nincs másik út. NN/g heurisztika 1
(a rendszer állapotának láthatósága) és 6 (felismerés a felidézés helyett)
sérül (<https://www.nngroup.com/articles/ten-usability-heuristics/>).
**Javaslat:** a sáv magasságát a `body` alsó belső margójaként is le kell
foglalni (a sáv méretéből számolt CSS-változó), hogy a tartalom sose kerüljön
alá. Ez a `docs/kezdolap-ux-audit` javaslatával egy javítás, nem kettő.

#### D20 (P2, S) A `/belepes-atallas` indexelhető

**Mérve:** a lapon nincs `meta robots` (mérve: `robots: None`), nincs
`canonical`, és a `src/app/robots.ts` `DISALLOWED_PATHS` listája nem
tartalmazza (a többi auth-útvonal igen). Sitemapbe nem kerül be, de ez nem
akadályozza az indexelést.
**Miért baj:** ez egy ÁTMENETI, migrációs lap; ha bekerül a találati listába,
a jövőbeli látogató egy „a régi jelszavad nem működik" lapon köt ki. A Google
saját dokumentációja szerint a robots.txt-vel tiltott lapot a kereső be sem
járja, ezért a `noindex` a helyes eszköz, ha az URL nem jelenhet meg
(<https://developers.google.com/search/docs/crawling-indexing/block-indexing>).
A `technical-and-general-seo` modul ugyanezt a különbségtételt írja le
(crawl vs. index).
**Javaslat:** `export const metadata = { robots: { index: false, follow: true } }`
a lapon. A robots.txt tiltása ide NEM való (akkor a `noindex`-et sem látná meg
a kereső).

---

## 3. `/fiok` (Fiókom)

**Mit lát a felhasználó** (`fiok-1440.png`, `fiok-390.png`): H1 „Fiókom",
majd három kártya: „Adataim" (hét mező + Mentés), „Kurzusaim" (a megvett
kurzusok listája hozzáférés-lejárattal), „Rendeléseim" (rendelésszám,
állapot-jelvény, dátum, összeg, számlaletöltés).
**Az oldal egy dolga:** a vevő megtalálja a számláját és karbantartja a
számlázási adatait.

**Az árvaság, újramérve.** A `docs/informacios-architektura.md` A2 tétele ma is
áll: a teljes `src/` fában **egyetlen `href="/fiok"` sincs** (grep-pel mérve;
a három találat két kódkomment és a robots.txt tiltása). A `/kurzusaim` lapról
mért linklista sem tartalmazza. **Új következmény, amit érdemes a régi tétel
mellé tenni:** a „Letöltöm a számlát" hivatkozás KIZÁRÓLAG itt él, a rendelési
levél sablonja (`src/lib/email/templates/order.ts`) pedig a kurzusra/lejátszóra
linkel, nem a fiókra. Vagyis a számla a terméken belül nem elérhető úton van.

### D4 (P1, S) A `/fiok` űrlapján egyetlen `autocomplete` sincs

**Mérve** (`forms.json` → `fiokUrlap`), mind a hét mezőn:

| Mező                  | `autocomplete` | `inputmode` | `<form>`-ban |
| --------------------- | -------------- | ----------- | ------------ |
| Név                   | **null**       | null        | **nem**      |
| E-mail-cím (readOnly) | **null**       | null        | **nem**      |
| Számlázási név        | **null**       | null        | **nem**      |
| Irányítószám          | **null**       | **null**    | **nem**      |
| Település             | **null**       | null        | **nem**      |
| Cím                   | **null**       | null        | **nem**      |
| Adószám               | **null**       | null        | **nem**      |

Összehasonlításul: ugyanezen a lapon a lábléc hírlevél-mezője `autocomplete="email"`
ÉS `inputmode="email"` értéket visel. A minta tehát létezik a repóban, csak
ide nem került be.

**Miért baj:** WCAG 2.2 · 1.3.5 Identify Input Purpose (AA) kifejezetten a
FELHASZNÁLÓ SAJÁT adatait kérő mezőkre ír elő gépileg felismerhető célt, és a
felsorolt tokenek között ott van a `name`, `email`, `postal-code`,
`address-level2`, `street-address`
(<https://www.w3.org/WAI/WCAG22/Understanding/identify-input-purpose.html>).
Ez a legkevésbé vitatható tétel az egész auditban: mérhető, egyértelmű AA-bukás.
Kapcsolódó kutatás: a Baymard űrlapmező-kutatása szerint a felhasználói
elvárásnak megfelelő mezőviselkedés (köztük az automatikus kitöltés) az egyik
legnagyobb hatású űrlap-javítás
(<https://baymard.com/blog/form-field-usability-matching-user-expectations>).
Az irányítószám-mezőn az `inputmode="numeric"` hiánya mobilon betűs
billentyűzetet ad — Apple HIG és Material 3 egyaránt a tartalomhoz illő
billentyűzetet írja elő
(<https://developer.apple.com/design/human-interface-guidelines/text-fields>,
<https://m3.material.io/components/text-fields/guidelines>).

**Javaslat:** `autoComplete="name" | "email" | "section-billing name" |
"section-billing postal-code" | "section-billing address-level2" |
"section-billing street-address"`, az irányítószámra `inputMode="numeric"`.
A `Field` komponens már továbbadja ezeket a propokat, tehát ez hét sor.

### D8 (P2, S) A mezők nincsenek `<form>`-ban

**Mérve:** mind a hét mezőre `closest('form') === null`; a „Mentés" egy
`onClick`-es `<button>`. Következmény: az Enter billentyű nem küld be, és a
böngésző/jelszókezelő űrlap-heurisztikái nem működnek.
**Miért baj:** GOV.UK szövegmező-komponense és lap-sablonja űrlapon belüli
mezőket ír le (<https://design-system.service.gov.uk/components/text-input/>,
<https://design-system.service.gov.uk/styles/page-template/>); WCAG 2.2 · 1.3.1
Info and Relationships — a szerkezeti kapcsolatot gépileg is felismerhetővé
kell tenni (<https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html>).

### D7 (P2, M) Nincs jelszócsere és nincs fiók-önkiszolgálás

**Mérve:** a `/fiok` lapon `input[type=password]` darabszáma **0**, és a lapon
lévő 27 hivatkozás között nincs sem jelszócsere, sem adatkérés, sem
fióktörlés. A jelszót ma csak a `/elfelejtett-jelszo` e-mailes körén át lehet
cserélni.
**Miért baj:** az `/adatvedelem` lap fel is sorolja az érintetti jogokat
(hozzáférés, helyesbítés, törlés, adathordozhatóság — GDPR 15-20. cikk,
<https://gdpr-info.eu/art-13-gdpr/>), a termékben viszont EGYETLEN út sem
vezet hozzájuk; a vevőnek e-mailt kell írnia. NN/g heurisztika 3
(a felhasználó szabadsága és kontrollja) és 7 (rugalmasság)
(<https://www.nngroup.com/articles/ten-usability-heuristics/>). A GOV.UK
fiók-létrehozási mintája a fiók életciklusát végig kezeli, nem csak a
létrehozását (<https://design-system.service.gov.uk/patterns/create-accounts/>).
**Javaslat:** minimum egy „Jelszó módosítása" szakasz (régi + új jelszó) és egy
„Fiókom törlése / adataim kikérése" hivatkozás a `/kapcsolat` felé, előre
kitöltött tárggyal. A jelszócsere access-control-t érint, ezért a repó
szabálya szerint emberi review-val kell mennie (CLAUDE.md TILOS ZÓNÁK 4).

**Egyéb, mért apróságok a lapon.** Az „E-mail-cím" mező `readOnly`, de sehol
nincs megírva, MIÉRT nem szerkeszthető és hogyan lehet mégis megváltoztatni
(WCAG 2.2 · 3.3.2). Az „Adószám" mező helyesen kap segédszöveget („Csak céges
vásárlás esetén."). Az üres állapotok magyarul, teljes mondatban szólnak
(„Még nincs rendelésed."), és a nem megbízható számlalinket a felület nem
linkként, hanem magyarázó szövegként adja — ez példás védekezés.

---

## 4. Tanulási felület

### 4.1 `/kurzusaim` (Kurzusaim)

**Mit lát a felhasználó** (`kurzusaim-1440.png`, `kurzusaim-390.png`): H1
„Kurzusaim", alatta a „Folyamatban lévő és új kurzusaid" csoportcím, és egy
kártya borítóval, haladásgyűrűvel, címmel, meta-sorral, haladássávval,
lejárat-sorral és egy elsődleges gombbal.
**Az oldal egy dolga:** a vevő egy kattintással ott folytassa, ahol abbahagyta.

**Mért kártyaadatok (390 px):** cím „Otthoni KézRehab Program", meta-sor
„0/8 lecke · kb. 42 perc van hátra", hozzáférés „Hozzáférés eddig: 2027. 09. 07.",
gomb „Kezdd el a kurzust" 308×51 px, rejtett kiegészítő szöveggel
(„: Otthoni KézRehab Program"). A haladássáv `aria-valuetext`-tel is beszél, a
gyűrű `aria-hidden`. Ez pontosan az NN/g haladásjelző-ajánlása: a jelzés
szöveggel is olvasható legyen
(<https://www.nngroup.com/articles/progress-indicators/>).

### D9 (P2, S) Az átköltöztetett vevő üres Kurzusaimja nem magyaráz semmit

**Mérve** (`kurzusaim-ures-390.png`, kurzus nélküli fiókkal belépve): a lap
teljes szövege

> „Kurzusaim / Itt jelennek meg a kurzusaid / Még nincs elérhető kurzusod.
> Nézd meg a kínálatunkat: a megvásárolt kurzus azonnal itt nyílik meg. /
> [Nézd meg a kurzusokat]"

Egyetlen cselekvés van a lapon, és az a VÁSÁRLÁS.
**Miért baj:** a `docs/vasarlo-migracio-terv.md` szerinti átköltöztetett vevő
épp azért állított jelszót, mert MÁR FIZETETT. Ha az importja bármiért hiányos,
ezen a lapon azt olvassa, hogy nincs kurzusa, és azt kínálják neki, hogy vegyen
egyet. Ez a bizalom elvesztésének pontos pillanata, és a `/belepes-atallas` lap
egész, gondosan megírt „a kurzusaid megvannak" ígéretét cáfolja.
Az üres állapot NN/g-ajánlása szerint az üres képernyőnek meg kell magyaráznia,
MIÉRT üres, és mi a következő lépés
(<https://www.nngroup.com/articles/empty-state-interface-design/>); GOV.UK:
ne dobd le a felhasználót az útról (<https://www.gov.uk/service-manual/design>).
**Javaslat:** az üres állapot kapjon egy MÁSODIK bekezdést és egy másodlagos
utat: „Ha korábban a régi Kineticare-oldalon vásároltál, és itt mégsem látod a
kurzusodat, írj nekünk, és megkeressük a fiókodat." + „Írj nekünk"
(`/kapcsolat`, §3.2 #33). A szöveget a `course-list-order.ts` `EMPTY_BODY`
mellé, új konstansként.

### D25 (P3, S) Fölösleges csoportcím egyetlen kurzusnál

**Mérve:** egy kurzus mellett is kirendelődik a H2 „Folyamatban lévő és új
kurzusaid" (40 px, azaz UGYANAKKORA, mint a H1 „Kurzusaim"), miközben a
`courseListSummary` egy kurzusnál helyesen `null`-t ad. A címsor tehát a lap
címével azonos hangsúlyú, és semmit nem tesz hozzá.
**Miért baj:** WCAG 2.2 · 2.4.6 Headings and Labels — a címsor írja le a
szakaszt (<https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html>);
egyetlen csoportnál nincs mit elkülöníteni. NN/g: a felesleges ismétlés zajt ad
(<https://www.nngroup.com/articles/how-users-read-on-the-web/>).
**Javaslat:** a csoportcím csak akkor jelenjen meg, ha legalább KÉT csoport van.

### 4.2 `/kurzusaim/<id>` (kurzuslejátszó)

**Mit lát a felhasználó** (`jatszo-1440.png`, `jatszo-390-full.png`): felül a
kurzus címe és a „0/8 lecke kész · 0%" összegzés, alatta a 16:9-es sötét
színpad, alatta a lecke feje (cím, „1. MODUL · 1. LECKE · 3:34", összefoglaló),
az akciósáv („Kész, tovább: Biztonsági szabályok"), és jobbra (1024 px felett)
a modul-akkordeonos tananyagsáv; mobilon ugyanez egy modális panelben.

**Mért, kifogástalan részek.** A mobil tananyag-panel `role="dialog"` +
`aria-modal="true"` + `aria-labelledby`, a `body` görgése zárolt, és a
fókusz **25 egymást követő Tab során egyszer sem szökött ki** a panelből
(mérve, `player-mobile.mjs`); az Escape bezárja, és a fókusz visszatér a nyitó
gombra (129×44 px). Ez a W3C ARIA APG modális minta tankönyvi megvalósítása
(<https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/>), és teljesíti a
WCAG 2.2 · 2.1.2 „No Keyboard Trap" elvárását is (a csapda szándékos és
feloldható). A modulok független nyithatósága, az elsődleges gomb
`aria-disabled` megoldása (nem `disabled`, hogy a fókusz ne vesszen el) és a
lecke-váltáskori fókuszkezelés szintén mérve helyes.

#### D1 (P1, S) A hibaállapotok mentőgombjai láthatatlanok

**Mérve** (`contrast2.json` → `jatszo@1440`, és képernyőképpel:
`jatszo-hibapanel-1440.png`):

| Elem                            | Szövegszín           | Tényleges háttér | Arány      | Küszöb        |
| ------------------------------- | -------------------- | ---------------- | ---------- | ------------- |
| „Újrapróbálom" gomb szövege     | `rgb(16,36,62)`      | `rgb(16,36,62)`  | **1,00:1** | 4,5:1 (1.4.3) |
| „Újrapróbálom" gomb 2 px kerete | `rgb(16,36,62)`      | `rgb(16,36,62)`  | **1,00:1** | 3:1 (1.4.11)  |
| „Írj nekünk" gomb szövege       | `rgb(16,36,62)`      | `rgb(16,36,62)`  | **1,00:1** | 4,5:1         |
| A hibaüzenet szövege            | `--kc-color-on-dark` | `rgb(16,36,62)`  | megfelel   | 4,5:1         |

**A gyökérok pontosan megnevezhető.** A `.kc-player__media` háttere
`--kc-color-surface-dark` (#10243e, `player.css:228`); a `.kc-player__media-error`
a SAJÁT szövegét helyesen `--kc-color-on-dark`-ra állítja (`player.css:253`),
a benne álló `Button variant="secondary"` viszont a `styles/ui.css:196-200`
szabályát hozza: `border-color: var(--kc-color-text)` és
`color: var(--kc-color-text)` — ez ugyanaz a #10243e, mint a háttér. A fájl
egyébként GONDOLT a sötét felületre: a `player.css:261` külön szabályt ad a
fókuszgyűrűnek („A sötét felületen a fókuszgyűrű fehérre vált"). A gombokra
ez a gondolat nem jutott el.

**Hány helyen áll fenn:** a `CoursePlayer.tsx` mind a NÉGY hibaága
(`unauthenticated` 890-899, `forbidden` 902-916, `unavailable` 922-935,
`error` 939-951) `variant="secondary"` gombot használ a sötét színpadon. Ez
azt jelenti, hogy a lejárt munkamenet miatti „Belépés" gomb is láthatatlan.
A hover-állapot sem ment: az `ui.css:202-205` invertál, azaz a gomb háttere
lesz #10243e (a színpaddal azonos), és csak a felirat vált fehérre — a gomb
ALAKJA hoverben sem látszik.

**Miért baj:** WCAG 2.2 · 1.4.3 Contrast (Minimum) 4,5:1
(<https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html>) és
WCAG 2.2 · 1.4.11 Non-text Contrast 3:1 a gomb keretére
(<https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html>). NN/g
heurisztika 9: „Help users recognize, diagnose, and recover from errors" —
itt a felismerés megvan (a szöveg olvasható), a HELYREÁLLÍTÁS eszköze viszont
nem látszik (<https://www.nngroup.com/articles/error-message-guidelines/>).
Carbon értesítés-mintája is kimondja, hogy a hibaüzenethez tartozó cselekvésnek
láthatónak és elérhetőnek kell lennie
(<https://carbondesignsystem.com/patterns/notification-pattern/>).
**Miért P1:** ez pontosan az a képernyő, ahol a fizető vevő elakad. A videó
nem indul, és a két kiút, amit a fejlesztő odatett neki, nem látszik.
**Javaslat:** egy `.kc-button--on-dark` módosító (vagy egy
`.kc-player__media-error .kc-button--secondary` felülírás) a már létező
`--kc-color-on-dark` tokennel: fehér keret és fehér felirat, hoverben
inverzió fehér háttérre #10243e felirattal. Új szín nem kerül be, a token
megvan. **Mérendő a javítás után:** fehér (#ffffff) a #10243e-n = 15,60:1
(szöveg) és ugyanennyi a keretre.

#### D10 (P2, L) Nincs lejátszási pozíció, és a haladás csak kézi jelöléssel épül

**Mérve, kódszinten:** a `course_progress` gyűjtemény mezői `user`, `product`,
`videoRef`, `watchedAt` (`src/collections/CourseProgress.ts`) — pozíciót vagy
nézettségi arányt NEM tárol. A `CoursePlayer` fogad ugyan egy
`bindLessonProgress` feliratkozót az automatikus jelöléshez, de a
`src/app/(frontend)/kurzusaim/[id]/page.tsx` **nem adja át** (a props között
nincs benne). A `resumeLesson` így kizárólag a késznek JELÖLT leckékből
számol: aki nem nyomja meg a gombot, annak a „Folytasd a kurzust" örökre az

1. leckére visz.
   **Miért baj:** a videós tanulás megszokott mintája a pozíció-visszaállítás
   (Jakob törvénye, NN/g videó-használhatóság:
   <https://www.nngroup.com/articles/video-usability/>); a haladásjelzőnek a
   TÉNYLEGES állapotot kell mutatnia, különben félrevezet
   (<https://www.nngroup.com/articles/progress-indicators/>). A WCAG 2.2 · 3.3.7
   Redundant Entry szelleme is ide vág: a felhasználótól ne kérjük, hogy a
   rendszer által már ismert információt újra megadja
   (<https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html>).
   **Javaslat, két lépcsőben.** (a) Rövid táv: a `bindLessonProgress`-t kösse be
   a lejátszó-oldal a Bunny `player.js` hídjához, hogy ~90% lejátszásnál
   automatikusan jelöljön (a szerkezet erre KÉSZ, csak a huzalozás hiányzik).
   (b) Középtáv: a `course_progress` kapjon `positionSec` mezőt, és a lejátszó
   induljon onnan. A (b) séma-változás, tehát migrációt igényel — a repó
   szabálya szerint `payload migrate:create`-tel, kézzel írt migráció nélkül
   (CLAUDE.md TILOS ZÓNÁK 3).

#### D11 (P2, S) A lap címe és a H1 nem nevezi meg a kurzust

**Mérve:** `<title>` = „Kurzus lejátszása | Kineticare" (statikus, minden
kurzusra azonos); a H1 az AKTUÁLIS LECKE címe („Üdvözöllek a programban",
19 px); a kurzus neve („Otthoni KézRehab Program") a lapon egyáltalán nem
címsor, hanem sima szöveg. Két megnyitott kurzus füle a böngészőben
megkülönböztethetetlen.
**Miért baj:** WCAG 2.2 · 2.4.2 Page Titled — a cím írja le a lap témáját vagy
célját (<https://www.w3.org/WAI/WCAG22/Understanding/page-titled.html>);
WCAG 2.2 · 2.4.6 Headings and Labels
(<https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html>).
A „hol vagyok?" a `termektervezes` skill 5. pontjának három kötelező kérdése
közül az első.
**Javaslat:** `generateMetadata`-val dinamikus cím: „<Kurzuscím> · <Leckecím> |
Kineticare"; a kurzuscím kapjon H1-et, a lecke H2-t (a lecke-fókuszálás
`tabIndex={-1}` megoldása változatlanul működik H2-n is).

---

## 5. Jogi és segédoldalak, lábléc

### 5.1 Mért alapadatok

| Lap            | Szavak |          Magasság 1440 px | Magasság 390 px |  H2 | Címsor-`id` | Horgonylink | `mailto`/`tel` | Külső link | Dátum          |
| -------------- | -----: | ------------------------: | --------------: | --: | ----------: | ----------: | -------------: | ---------: | -------------- |
| `/aszf`        |   3158 | 19 221 px (21,4 képernyő) |       22 255 px |  13 |       **0** |       **0** |          **0** |      **0** | **nincs**      |
| `/adatvedelem` |   1869 | 13 893 px (15,4 képernyő) |       15 684 px |   8 |       **0** |       **0** |          **0** |      **0** | a lap legalján |
| `/impresszum`  |     76 |                   1973 px |         2275 px |   0 |           0 |           0 |          **0** |      **0** | **nincs**      |

Sorhossz (mért, canvas-alapú karakterszélességgel): a törzsszöveg 1440 px-en
66-67 karakter, 390 px-en 49, 320 px-en 40 karakter soronként. Ez a 45-85-ös
sávban van, a 320 px-es érték alatta, de ott ez a képernyő korlátja.
Kontraszt: nulla bukás mind a három lapon (149, illetve 54 ellenőrzött
szövegcsomópont). 320 px-en nincs vízszintes túlcsordulás (WCAG 2.2 · 1.4.10
Reflow teljesül, <https://www.w3.org/WAI/WCAG22/Understanding/reflow.html>).

### D12 (P2, M) Nincs tájékozódási eszköz a hosszú jogi lapokon

**Mérve:** a 3158 szavas ÁSZF-en 13 H2 van, de EGYIKNEK SINCS `id`-je, nincs
tartalomjegyzék, nincs horgonylink és nincs „vissza a tetejére". Aki az
elállási jogot keresi, 21 képernyőnyi szöveget görget át.
**Miért baj:** NN/g tartalomjegyzék-útmutató: a hosszú, szakaszokra bontható
oldalak tartalomjegyzéket igényelnek, mert a felhasználók pásztázva olvasnak
(<https://www.nngroup.com/articles/table-of-contents/>); ugyanezt támasztja alá
a NN/g olvasási mintákról szóló alapkutatása
(<https://www.nngroup.com/articles/how-users-read-on-the-web/>). A címsor-`id`
hiánya azt is jelenti, hogy a `/aszf#ellallas` alakú, konkrét szakaszra mutató
hivatkozás nem létezhet: a `keyword-research-and-onpage-seo` modul szerint a
belső horgonyok a kiemelt szemelvények és a szakasz-szintű hivatkozás
feltételei.
**Javaslat:** a `LexicalContent` renderelője adjon slugosított `id`-t minden
H2/H3-nak, és a jogi lapok kapjanak egy tartalomjegyzék-blokkot a H1 alatt
(a lista a címsorokból generálva). Ez egy komponens, három lapra.

### D13 (P2, S) Nincs hatályossági dátum

**Mérve:** az ÁSZF teljes szövegében nincs se „Hatályos", se „Kelt", se
verziószám (csak jogszabály-évszámok: 2013, 2014, 2021). Az adatvédelmi
tájékoztató végén ott a „Kelt: 2025. 07. 05. napján" — de a lap ALJÁN, 13 893
px-nyire a tetejétől.
**Miért baj:** a vevőnek tudnia kell, MELYIK verziót fogadta el; egy vitában
ez a legelső kérdés. A `content-and-general-marketing` és az
`ai-search-optimization` modul E-E-A-T szempontja is a datálást és a
frissesség jelzését emeli ki. GOV.UK a közérthetőségi elveiben szintén a
dokumentum állapotának kimondását írja elő
(<https://www.gov.uk/service-manual/design>).
**Javaslat:** minden jogi lap H1-e alá egy „Hatályos: ÉÉÉÉ. HH. NN-tól" sor, a
lap `updatedAt` mezőjéből vagy egy külön CMS-mezőből, és `dateModified`
strukturált adattal (lásd D22).

### D16 (P2, S) Az e-mail és a telefonszám nem kattintható

**Mérve:** mind a három jogi lapon nulla `mailto:` és nulla `tel:` link. Az
ÁSZF-ben szereplő `+36203573493` és az `egeszsegmozgastamogatas@gmail.com`
sima szövegként áll, ahogy az impresszum e-mail-címe is. Külső hivatkozás sem
akad: a lap megnevezi a `www.bekeltetes.hu` oldalt és a
`fogyasztovedelem.kormany.hu` címet, de nem linkeli.
**Miért baj:** mobilon a telefonszám nem tárcsázható egy koppintással; a
panaszkezelési út megnevezése link nélkül nem használható. WCAG 2.2 · 2.4.4
Link Purpose (In Context) — ahol cselekvés van, ott hivatkozás legyen
(<https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html>);
GOV.UK kapcsolatfelvételi mintája szerint az elérhetőségeket használható
formában kell adni
(<https://design-system.service.gov.uk/patterns/contact-a-department-or-service-team/>).
**Javaslat:** a CMS-tartalomban a címek és a hivatkozott oldalak legyenek
valódi linkek (a Lexical szerkesztő ezt tudja). Külső linkre `rel="noopener"`.

### D27 (P3, S) Az impresszum kétszer írja ki a saját címét

**Mérve:** a lap első két sora „Impresszum" (H1) és „Impresszum" (bekezdés),
utána „https://www.kineticare.hu/ weboldalra vonatkozóan". Az ismétlés a
képernyőolvasós felolvasásban is duplikálódik.
**Javaslat:** a bekezdésnyi ismétlés törlése a CMS-ből; az alcím maradjon
egyetlen mondat.

### 5.2 A 404-es oldal

**Mit lát a felhasználó** (`404-1440.png`, `404-390.png`): H1 „Ez az oldal nem
található", bocsánatkérő bevezető, három ellenőrző mondat, két gomb (elsődleges
„Nézd meg a kurzusokat", másodlagos „Vissza a kezdőlapra"), egy „Vagy folytasd
innen" célblokk (Tudástár, Kapcsolat) és egy e-mailes kiút.

Ez a GOV.UK „Page not found" mintájának magyar megfelelője, hibakód nélkül,
és teljesíti az NN/g 404-es ajánlását: magyarázat, nem hibáztatás, és
konstruktív továbblépés
(<https://www.nngroup.com/articles/improving-dreaded-404-error-message/>).
Mérve: `robots: noindex` ott van, a HTTP-státusz **404** (nem soft-404), a
kontraszt-bukás nulla, 320 px-en nincs túlcsordulás.

#### D18 (P2, S) A böngészőfül-cím a sablon-cím, nem a lap címe

**Mérve:** a `/nincs-ilyen-oldal-auditd` betöltésekor a `document.title` értéke
**„Kineticare — Kézrehabilitációs online kurzusplatform"**, holott a
`src/app/(frontend)/not-found.tsx` explicit `metadata.title`-t exportál
(`'Ez az oldal nem található'`), és a kommentje szó szerint a WCAG 2.4.2-re
hivatkozik. A Next.js `not-found.tsx` határon a `metadata` export nem
érvényesül, tehát a kód SAJÁT SZÁNDÉKA nem valósul meg.
**Miért baj:** WCAG 2.2 · 2.4.2 Page Titled
(<https://www.w3.org/WAI/WCAG22/Understanding/page-titled.html>). Aki több
lapot nyitva tart, a fülről nem látja, hogy hibára futott; a
képernyőolvasó a lap megnyitásakor a sablon-címet olvassa fel.
**Javaslat:** a címet a `NotFoundView` maga állítsa be (`<title>` a
komponensben nem megy szerver-oldalon; a járható út a `[slug]` route
`generateMetadata`-jában a `notFound()` előtti cím-beállítás, vagy egy
`global-not-found` szintű cím). A javítást méréssel kell zárni: a
`document.title` értéke legyen „Ez az oldal nem található | Kineticare".

Kisebb megjegyzés: a lapon nincs keresőmező. Az NN/g 404-ajánlás a keresőt
javasolja, de a Kineticare-nek jelenleg SEHOL nincs oldalkereső, tehát ez nem
a 404-es lap hibája; a célblokk jó helyettesítő.

#### D26 (P3, S) Kijelentkezetten `/kurzusaim/999` → belépés → 404

**Mérve:** kijelentkezve mind a négy védett cím a helyes `returnUrl`-lel
irányít a belépőre (`/kurzusaim`, `/fiok`, `/kurzusaim/1`, `/kurzusaim/999`).
A negyedik esetben viszont a sikeres belépés után a vevő egy 404-re érkezik.
**Javaslat:** ha a `returnUrl` egy nem létező kurzus lejátszója, essen vissza a
`/kurzusaim`-ra. A `sanitizeReturnUrl` már ma is végez ilyen visszaesést idegen
eredetnél, tehát a minta megvan.

### 5.3 A lábléc mint navigációs felület

**Mérve** (a `/kurzusaim` lap láblécéből, 390 px): a lábléc **hat**
hivatkozást tartalmaz: `/kapcsolat`, `/adatvedelem` (kétszer: a hírlevél
hozzájárulási mondatában és a jogi sorban), `/aszf`, `/impresszum`, valamint a
`mailto:info@kineticare.hu`. Ezen kívül a „Süti-beállítások" gomb és a
hírlevél-űrlap. **Nincs benne** `/kurzusok`, `/blog` (Tudástár), `/rolunk`,
`/szolgaltatasok`, `/belepes` és `/kurzusaim`.

Célfelületek 1440 px-en, mérve: „Adatkezelési és adatvédelmi szabályzat"
284,1×44, „Általános szerződési feltételek" 219,6×44, „Impresszum" 86,7×44,
„Süti-beállítások" 113,1×44, e-mail 138×44. Mind teljesíti a WCAG 2.2 · 2.5.8
24×24-es minimumot, sőt a repó saját 44 px-es célját is.

Egyetlen 24 px alatti cél akadt: a hírlevél hozzájárulási mondatában álló
„Adatkezelési és adatvédelmi szabályzat" link, 284,1×**22** px. Ez a linkek
`display: inline` értékű, egy 26,72 px sormagasságú MONDATON belül áll, tehát
a 2.5.8 „Inline" kivétele érvényes rá
(<https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html>) —
**nem találat**, csak a teljesség kedvéért jegyzem fel.

#### D21 (P2, M) A lábléc nem navigációs felület

**Miért baj:** az NN/g lábléc-kutatása szerint a lábléc a felhasználó
biztonsági hálója: az az „utolsó esély" felület, ahol a máshol nem talált
tartalmat keresi, és éppen ezért másodlagos navigációt kell tartalmaznia
(<https://www.nngroup.com/articles/footers/>). A Kineticare láblécében ma csak
kapcsolat + jogi + hírlevél van, tehát a vevő a lap aljára érve zsákutcába
jut. Ez a `termektervezes` skill 5. pontjának „zsákutca tilos" szabálya.

**SEO-oldalról ugyanez, mérten súlyosabb.** Az `docs/ADATOK-mert.md` szerint a
`kineticare.hu` a HU adatbázisban 15 kulcsszóra rangsorol, mind a 17-83.
pozíción, 0,00% forgalommal, a backlink-profil score 2 / 9 hivatkozó domain
(vs. gyogytornaszom 36 / 570). Ilyen gyenge külső tekintélynél a BELSŐ
linkelés az egyetlen olyan eszköz, ami a saját kezünkben van, és a
site-szintű lábléc a legnagyobb hatókörű belső linkfelület. Ma ebből nulla
linkerő megy a Tudástárra, holott a brief szerint „a Tudástár hub-cikkek
jelentik a teljes organikus tétet".
**Javaslat:** háromhasábos lábléc: (1) Kurzusok — a két termék és a
kurzuslista; (2) Tudástár — a kategóriák; (3) Kineticare — Rólunk, Szolgáltatások,
Kapcsolat. A jogi sor és a hírlevél marad, ahol van. A feliratok kizárólag a
§3.2 szótárból, hogy ne keletkezzen új CTA-alak (WCAG 2.2 · 3.2.4).

---

## 6. Marketing- és SEO-réteg

### 6.1 Mért on-page adatok

| Lap                     | `<title>`                                            | Meta description | Canonical | `robots`    | JSON-LD   |
| ----------------------- | ---------------------------------------------------- | ---------------- | --------- | ----------- | --------- |
| `/belepes`              | Belépés \| Kineticare                                | van (69 kar.)    | **nincs** | nincs       | **nincs** |
| `/regisztracio`         | Regisztráció \| Kineticare                           | van              | **nincs** | nincs       | **nincs** |
| `/elfelejtett-jelszo`   | Elfelejtett jelszó \| Kineticare                     | van (49 kar.)    | **nincs** | nincs       | **nincs** |
| `/jelszo-visszaallitas` | Új jelszó beállítása \| Kineticare                   | van              | **nincs** | nincs       | **nincs** |
| `/belepes-atallas`      | Jelszó beállítása az új felületen \| Kineticare      | van              | **nincs** | **nincs**   | **nincs** |
| `/fiok`                 | Fiókom \| Kineticare                                 | van              | **nincs** | nincs       | **nincs** |
| `/kurzusaim`            | Kurzusaim \| Kineticare                              | van              | **nincs** | nincs       | **nincs** |
| `/kurzusaim/<id>`       | Kurzus lejátszása \| Kineticare (statikus)           | van              | **nincs** | nincs       | **nincs** |
| `/aszf`                 | Általános szerződési feltételek \| Kineticare        | van              | van       | nincs       | **nincs** |
| `/adatvedelem`          | Adatkezelési és adatvédelmi szabályzat \| Kineticare | van              | van       | nincs       | **nincs** |
| `/impresszum`           | Impresszum \| Kineticare                             | van              | van       | nincs       | **nincs** |
| 404                     | **sablon-cím** (D18)                                 | sablon           | nincs     | **noindex** | **nincs** |

A `robots.txt` (`src/app/robots.ts`) helyesen tiltja a `/fiok`, `/kurzusaim`,
`/belepes`, `/regisztracio`, `/elfelejtett-jelszo`, `/jelszo-visszaallitas`
útvonalakat, és a jogi lapokat szándékosan NEM tiltja. A `/belepes-atallas`
kimaradt (D20). A jogi lapok bekerülnek a sitemapbe a CMS-oldalak ágán.

### D22 (P2, M) Nulla strukturált adat

**Mérve:** a vizsgált tizenkét lapon összesen **nulla** `application/ld+json`
blokk van.
**Miért baj:** az impresszum pontosan az a lap, ahol az `Organization`
séma helye van (`legalName`, `taxID`, `vatID`, `address`, `email`, `telephone`,
`sameAs`), és a Google saját dokumentációja is ezt a típust írja le a
szervezet azonosítására
(<https://developers.google.com/search/docs/appearance/structured-data/organization>).
Az `ai-search-optimization` modul szerint az AI-keresés az entitás
egyértelmű, gépileg olvasható azonosítására támaszkodik; a mért helyzet
(15 rangsoroló kifejezés, ebből több IRRELEVÁNS: „kata ruhaklinikája",
„kerékbetörés", más nevű szakemberek) azt mutatja, hogy a keresők ma NEM
tudják, mi ez a márka. Egy `Organization` + `sameAs` blokk a legolcsóbb
entitás-tisztázás. A jogi lapokra `WebPage` + `dateModified` illik, ez pedig a
D13 dátum-hiányát is gépileg orvosolja.
**Javaslat:** az `Organization` séma egyetlen helyen (a `(frontend)` layoutban
vagy az impresszumon), a `docs/seo-geo-llm.md`-vel összehangolva, és minden
adata EGYEZZEN az impresszum látható szövegével (különben a séma
félrevezetőnek minősül). Előfeltétel: a D14 és a D15 rendezése.

### 6.2 Keresési szándék és a lapok szerepe

- `/aszf`, `/adatvedelem`, `/impresszum`: **navigációs/bizalmi** szándék. Nem
  forgalomszerző lapok, de a vásárlás előtti bizalom-ellenőrzés állomásai, és
  az E-E-A-T-jelzés hordozói. A mai állapotban (elavult tárhely, gmailes
  cím, dátum nélkül) ROMBOLJÁK a bizalmat ahelyett, hogy építenék.
- Auth- és fiók-oldalak: nincs keresési szándékuk, helyesen tiltottak.
- `/belepes-atallas`: átmeneti, tiltandó (D20).
- 404: `noindex`, helyes.

### 6.3 Konverziós út (CRO)

A `competitive-intelligence-and-analytics` modul CRO-folyamatának 2. lépése a
lemorzsolódási pontok azonosítása. A vásárlás UTÁNI úton három mért
lemorzsolódási pont van:

1. **Belépés → hiba → kilépés.** Rossz jelszónál nincs helyben felkínált
   visszaállítás (D23), és az átköltöztetett vevőnek a régi jelszava nem
   működik. Az `/elfelejtett-jelszo` lap már ma is számol ezzel a
   forgatókönyvvel, a `/belepes` hibaüzenete viszont nem.
2. **Regisztráció → jelszó-elutasítás → feladás.** A félrevezető üzenet (D2)
   és a hiányzó mezőszintű jelzés (D3) miatt a vevő nem tudja, mit javítson.
   A jelszó értéke szerencsére megmarad az űrlapon (mérve), tehát nincs
   adatvesztés.
3. **Első lejátszás → hiba → zsákutca.** A D1 miatt a hibaállapotból nincs
   LÁTHATÓ kiút; a vevő azt tapasztalja, hogy fizetett, és nem kap semmit.
   Ez a legköltségesebb pont: közvetlenül visszatérítés-kockázat.

Ehhez jön a retenciós oldal: a D10 miatt a haladásjelző 0%-on marad annak is,
aki végignézte a leckéket, tehát a „folytatom" hurok, ami a kurzusplatformok
fő visszatérési motorja, ma nem működik magától.

---

## 7. Mért, RENDBEN lévő tételek

Ezeket azért írom le, hogy a javítás ne rontsa el őket, és hogy a következő
audit ne mérje újra.

| Ellenőrzés                        | Küszöb                    | Mért eredmény                                                          |
| --------------------------------- | ------------------------- | ---------------------------------------------------------------------- |
| Szövegkontraszt, 10 lap × 2 nézet | ≥ 4,5:1 (nagy: 3:1)       | 1131 szövegcsomópont, **2 bukás**, mindkettő a D1 (lejátszó hibapanel) |
| Betűméret-tokenek                 | csak L/M/S                | 16/19/40 px asztali, 14/16/32 px mobil — minden lapon                  |
| 320 px reflow                     | nincs vízszintes görgetés | `scrollWidth == clientWidth == 320` mind a 12 lapon                    |
| Fókuszjelölés a mezőkön           | ≥ 3:1                     | keret #2f6e9f 5,45:1 a mezőn, 5,16:1 a lapon + 3 px gyűrű              |
| Fókusz nem takart (2.4.11)        | 0% takarás                | **0%** mind a 4 auth-lapon, 3 nézetben                                 |
| Érintőcélok a láblécben           | ≥ 24×24                   | 44 px magas mind, a 22 px-es inline link kivételes                     |
| Sorhossz (jogi törzs)             | 45-85 karakter            | 66-67 (1440), 49 (390)                                                 |
| Mozgás                            | reduced-motion mögött     | **0 futó animáció** mindkét módban, 390 és 320 px-en                   |
| Mobil tananyag-panel              | modális, fókuszcsapdával  | `role=dialog`, `aria-modal`, 25 Tab bent, Escape visszaad              |
| Hibaüzenet nyelve                 | magyar, mezőnél           | `/belepes` és `/elfelejtett-jelszo`: igen                              |
| Beküldés-alatti állapot           | van                       | minden auth-gombon (`Belépés…`, `Mentés…`)                             |
| Nyílt átirányítás                 | tiltott                   | `sanitizeReturnUrl` minden ágon, kétszer (szerver + kliens)            |
| Számla-URL                        | allowlist                 | rendereléskor is szűrve; nem megbízható URL nem lesz link              |
| 404 HTTP-státusz                  | 404                       | 404 (nem soft-404), `noindex`                                          |
| Kihagyó link                      | első a Tab-sorrendben     | igen, 171×51 px                                                        |

---

## 8. Tulajdonosi döntést igénylő tételek

### T1 (D14) Az impresszum tárhelyszolgáltatója

Az impresszum ma a **Tárhely.Eu Kft.**-t nevezi meg tárhelyszolgáltatóként
(székhely, telefonszám, e-mail együtt), miközben a `docs/deploy-railway.md` és
a `railway.json` szerint az alkalmazás a **Railwayen** fut, adatbázisa a
`Postgres-c8Rg` szolgáltatásban. A régi kineticare.hu (systeme.io) és az új
alkalmazás tárhelye tehát nem ugyanaz. **Kérdés a tulajdonoshoz:** melyik
szolgáltató szerepeljen, és a cutover után mikor íródjon át? A helyes adat
felvezetése jogi felülvizsgálatot kíván, ügynök nem dönthet róla.

### T2 (D15) Háromféle kapcsolati adat

| Hol                                  | E-mail                              | Telefon        |
| ------------------------------------ | ----------------------------------- | -------------- |
| Lábléc (`Footer.tsx:20`), 404-es lap | `info@kineticare.hu`                | —              |
| `/impresszum`                        | `egeszsegmozgastamogatas@gmail.com` | **nincs**      |
| `/aszf`                              | `egeszsegmozgastamogatas@gmail.com` | `+36203573493` |

A vevő három helyen három választ kap arra, hogy hol érheti el a céget. A
`gmail.com` végződésű cím a cég hivatalos impresszumában ráadásul gyengíti a
szakmai megbízhatóság jelzését, amit a `content-and-general-marketing` modul
E-E-A-T szempontja is számon kér. **Kérdés:** legyen-e egyetlen, saját domainű
kapcsolati cím mindenhol, és kerüljön-e telefonszám az impresszumba?
(A távollévők közötti szerződéseknél a telefonos elérhetőség megadása bevett
elvárás, de a pontos jogi kötelem megítélése jogászi kérdés.)

### T3 (D19) Az adatvédelmi tájékoztató nem nevez meg adatfeldolgozót

**Mérve:** az `/adatvedelem` lap teljes szövegében nem szerepel a **Barion**,
a **Számlázz.hu**, a **Bunny**, a **Railway**, a **PostHog**, a **Resend**, a
**Google** és a **Meta** szó sem — csak kategóriák („tárhely és informatikai
szolgáltatók, könyvelési…, számlázási szolgáltató, hírlevél küldési
szolgáltató"). Ugyanakkor az alkalmazás ténylegesen betölti a PostHogot és a
Barion-eseményeket (`src/lib/analytics/`), és a videót Bunny Stream iframe
szolgálja ki. A süti-szakasz kategóriákat sorol fel, de konkrét sütit,
szolgáltatót és élettartamot nem.
**Kérdés:** a tájékoztató kapjon-e tételes adatfeldolgozó-táblázatot és
süti-listát? A GDPR 13. cikke a címzettek KATEGÓRIÁIT is elfogadja
(<https://gdpr-info.eu/art-13-gdpr/>), tehát ez nem automatikusan jogsértés;
a tájékozott hozzájárulás gyakorlata viszont a konkrét megnevezés felé mutat,
és a felületen működő süti-sáv kategóriáival is illene egyeznie. Jogi
felülvizsgálat kell.

### T4 Az ÁSZF elavult uniós hivatkozása

Az ÁSZF a fogyasztói jogviták rendezésénél az **524/2013/EU rendelet** szerinti
európai online vitarendezési (ODR) platformra utalja a vevőt. Ez a hivatkozás
2025 nyara óta felülvizsgálandó (az uniós ODR-platform megszűnt). A
Békéltető Testületre és a `www.bekeltetes.hu` oldalra mutató rész változatlanul
érvényes. **Kérdés:** felülvizsgálja-e jogász az ÁSZF panaszkezelési
szakaszát? Az audit ezt csak jelzi, nem dönti el.

### T5 Az elállási jog lemondásának bekérése

Az ÁSZF szerint „A Megrendeléssel a Vásárló kifejezetten beleegyezik abba, hogy
a KINETICARE megkezdje a teljesítést… ezzel egyidejűleg nyilatkozik arról, hogy
tudomásul vette elállási jogának elvesztését." A 45/2014. (II. 26.) Korm.
rendelet 29. §-a KIFEJEZETT, előzetes hozzájárulást és a jogvesztés
tudomásulvételét kívánja. **Kérdés:** a pénztár ténylegesen külön,
bejelölendő nyilatkozatként kéri-e ezt, vagy a megrendelés gombja hallgatólagos
beleegyezésnek számít? A pénztár felülete az AUDIT-C hatóköre; itt csak a
jogi lap és a folyamat összeillesztésének kérdését teszem fel.

### T6 (D7) Jelszócsere és fiók-önkiszolgálás

A jelszócsere és a fióktörlés access-control- és auth-hook-érintett terület,
tehát a CLAUDE.md TILOS ZÓNÁK 4. pontja szerint emberi jóváhagyás kell hozzá.
**Kérdés:** engedélyezi-e a tulajdonos a `/fiok` bővítését jelszócserével, és
mi legyen a fióktörlés útja (önkiszolgáló vagy e-mailes kérés)?

---

## 9. Javasolt sorrend

| Kör | Tételek                             | Miért ez a sorrend                                                                                             |
| --- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1.  | **D1**, D2, D6                      | Mind a három S-méretű, mind a három közvetlenül a fizető vevő elakadását okozza. A D1 egyetlen CSS-szabály.    |
| 2.  | **D4**, D8, D3                      | Mérhető WCAG-bukás (1.3.5, 3.3.1) és két kis kód-változtatás; a D3 M, de a minta készen áll a `LoginForm`-ban. |
| 3.  | D9, D17, D18, D20, D23, D26         | Kis, elszigetelt javítások a konverziós út és az indexelés mentén.                                             |
| 4.  | D12, D13, D16, D27 + T1, T2, T3, T4 | A jogi lapok egy körben: tartalomjegyzék-komponens + CMS-tartalom, a tulajdonosi döntések után.                |
| 5.  | D5, D21, D22, D11, D25, D24         | Felület- és SEO-bővítések, tervezéssel.                                                                        |
| 6.  | **D10**                             | A legnagyobb (L) és séma-változást igénylő tétel; a (a) alpont viszont már az 1-3. körben is beköthető.        |

---

## 10. Felhasznált külső források

**Szabvány (WCAG 2.2, sikerkritérium-számmal)**
1.3.1 <https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html> ·
1.3.5 <https://www.w3.org/WAI/WCAG22/Understanding/identify-input-purpose.html> ·
1.4.3 <https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html> ·
1.4.10 <https://www.w3.org/WAI/WCAG22/Understanding/reflow.html> ·
1.4.11 <https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html> ·
2.4.1 <https://www.w3.org/WAI/WCAG22/Understanding/bypass-blocks.html> ·
2.4.2 <https://www.w3.org/WAI/WCAG22/Understanding/page-titled.html> ·
2.4.4 <https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context.html> ·
2.4.6 <https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html> ·
2.4.7 <https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html> ·
2.4.11 <https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html> ·
2.5.8 <https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html> ·
3.2.4 <https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html> ·
3.3.1 <https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html> ·
3.3.2 <https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html> ·
3.3.3 <https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion.html> ·
3.3.7 <https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html> ·
3.3.8 <https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html> ·
ARIA APG modális minta <https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/>

**Nielsen Norman Group**
Tíz használhatósági heurisztika <https://www.nngroup.com/articles/ten-usability-heuristics/> ·
Error-Message Guidelines <https://www.nngroup.com/articles/error-message-guidelines/> ·
Errors in Forms <https://www.nngroup.com/articles/errors-forms-design-guidelines/> ·
Stop Password Masking <https://www.nngroup.com/articles/stop-password-masking/> ·
Password Creation <https://www.nngroup.com/articles/password-creation/> ·
Touch Targets <https://www.nngroup.com/articles/touch-target-size/> ·
Table of Contents <https://www.nngroup.com/articles/table-of-contents/> ·
How Users Read on the Web <https://www.nngroup.com/articles/how-users-read-on-the-web/> ·
Empty States <https://www.nngroup.com/articles/empty-state-interface-design/> ·
Footers <https://www.nngroup.com/articles/footers/> ·
Progress Indicators <https://www.nngroup.com/articles/progress-indicators/> ·
Video Usability <https://www.nngroup.com/articles/video-usability/> ·
404 Error Messages <https://www.nngroup.com/articles/improving-dreaded-404-error-message/> ·
Placeholders in Form Fields <https://www.nngroup.com/articles/form-design-placeholders/>

**Baymard Institute**
Inline Form Validation <https://baymard.com/blog/inline-form-validation> ·
Form Field Usability: Matching User Expectations <https://baymard.com/blog/form-field-usability-matching-user-expectations>

**Tervezési rendszerek**
GOV.UK Error summary <https://design-system.service.gov.uk/components/error-summary/> ·
GOV.UK Error message <https://design-system.service.gov.uk/components/error-message/> ·
GOV.UK Password input <https://design-system.service.gov.uk/components/password-input/> ·
GOV.UK Text input <https://design-system.service.gov.uk/components/text-input/> ·
GOV.UK Create accounts <https://design-system.service.gov.uk/patterns/create-accounts/> ·
GOV.UK Contact a service team <https://design-system.service.gov.uk/patterns/contact-a-department-or-service-team/> ·
GOV.UK Page template <https://design-system.service.gov.uk/styles/page-template/> ·
GOV.UK Service Manual, Design <https://www.gov.uk/service-manual/design> ·
Material 3 Text fields <https://m3.material.io/components/text-fields/guidelines> ·
Apple HIG Text fields <https://developer.apple.com/design/human-interface-guidelines/text-fields> ·
Shopify Polaris Error messages <https://polaris.shopify.com/patterns/error-messages> ·
IBM Carbon Notification pattern <https://carbondesignsystem.com/patterns/notification-pattern/>

**Egyéb**
Google Search Central, Block indexing <https://developers.google.com/search/docs/crawling-indexing/block-indexing> ·
Google Search Central, Organization schema <https://developers.google.com/search/docs/appearance/structured-data/organization> ·
GDPR 13. cikk <https://gdpr-info.eu/art-13-gdpr/>

**Belső, kötelező olvasmányok, amelyekre az audit épül**
`.claude/skills/termektervezes/SKILL.md` · `digital-marketing-mastery`
(`competitive-intelligence-and-analytics.md`, `technical-and-general-seo.md`,
`keyword-research-and-onpage-seo.md`, `ai-search-optimization.md`) ·
`docs/ADATOK-mert.md` · `docs/kezdolap-ux-audit-2026-09-07.md` ·
`docs/ui-sztenderdek.md` §3.2 · `docs/informacios-architektura.md` ·
`docs/gomb-inventar.md` · `docs/felhasznaloi-seta.md` ·
`docs/ertekesitesi-ux-skill.md` · `docs/vasarlo-migracio-terv.md`

Minden szám ebben a dokumentumban saját méréssel készült; a mérőszkriptek és a
nyers JSON-ok a session-scratchpad `audit-d/` mappájában maradtak.
