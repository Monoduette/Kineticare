# Kineticare: kézrehabilitációs kurzusplatform

A Kineticare Kocsis Kata és Kiss Kata gyógytornászok kézrehabilitációs
platformja. Otthoni gyakorlóknak videós online programot ad (fizetős fő
program és ingyenes SOS villámkurzus), szakembereknek szakmai tartalmat
(akkreditált kézworkshop, szakkönyv), és bemutatja a két budapesti rendelő
kezeléseit, időpontkéréssel. Mellette egy orvosi forrásokra épülő
Tudástár (blog, tünet-hubok) hozza az organikus forgalmat.

A webáruház, a CMS és az admin egyetlen Next.js alkalmazásban fut,
Payload CMS-sel és PostgreSQL-lel.

## Állapot (2026-09-23)

- **Élesben fut a Railway-en:** `https://kineticare-production.up.railway.app`
  (admin: `/admin`). A fizetés, a számlázás, a videó-kiszolgálás és a
  tartalomszerkesztés működik.
- **A `kineticare.hu` domain átállítása még hátra van.** Ott ma a régi
  Systeme.io oldal él. A lépések: [`docs/kineticare-hu-atallas.md`](docs/kineticare-hu-atallas.md).
  Addig az indexelés-kapu zárva van (minden válasz `noindex`, lásd SEO).
- Nyitott feladatok: [`docs/feladatlista.md`](docs/feladatlista.md).

## Stack

A verziók a `package.json`-ból, mind pontosan rögzítve (`^` nélkül).

| Réteg            | Csomag és verzió                                                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Futtatókörnyezet | Node **24.20.0**, npm **11.19.0** (`engines`, `.nvmrc`, `engine-strict`)                                                                                                                                     |
| Keretrendszer    | `next` 16.3.5 (App Router), `react` / `react-dom` 19.3.0, TypeScript 5.9.3 (strict)                                                                                                                          |
| CMS              | `payload` 3.88.0, `@payloadcms/next`, `@payloadcms/db-postgres`, `@payloadcms/richtext-lexical`, `@payloadcms/translations`, `@payloadcms/plugin-ecommerce`, `@payloadcms/plugin-form-builder` (mind 3.88.0) |
| Adatbázis        | PostgreSQL (élesben a Railway `Postgres-c8Rg` szolgáltatása, kötettel)                                                                                                                                       |
| Egyéb            | `sharp` 0.35.4 (képek), `sass` 1.104.1, `posthog-js` 1.430.3, `tus-js-client` 4.3.1 (admin videófeltöltés), `graphql` 16.14.2 (a Payload GraphQL-je ki van kapcsolva)                                        |
| Teszt és minőség | `vitest` 4.1.11, `eslint` 9.39.5 + `eslint-config-next` 16.3.5, `prettier` 3.9.6                                                                                                                             |

### Külső szolgáltatások

| Szolgáltatás             | Mire                                                                                      | Kód                                                           |
| ------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Barion Smart Gateway     | kártyás fizetés (Payment/Start v2, PaymentState v4, Refund v2), opcionálisan Barion Pixel | `src/lib/barion/`, `src/components/analytics/BarionPixel.tsx` |
| Számlázz.hu Számla Agent | számla, stornó és helyesbítő számla, PDF                                                  | `src/lib/szamlazz/`                                           |
| Bunny Stream             | védett kurzusvideók tokenes embeddel, publikus library a hero-videóhoz és előzetesekhez   | `src/lib/stream/`                                             |
| Resend (vagy SMTP)       | tranzakciós e-mail; kulcs nélkül no-op, sosem dönti el az appot                           | `src/lib/email/`                                              |
| PostHog (EU cloud)       | termék-analitika `/ingest` elsőfél-proxyn, hozzájárulás után; munkamenet-felvétel nincs   | `src/lib/analytics/posthog.ts`, `docs/posthog.md`             |
| Google Analytics 4       | csak `granted` hozzájárulás után töltődik be (consent-first)                              | `src/lib/analytics/ga4.ts`, `docs/ga4.md`                     |
| Cloudflare Turnstile     | spam-védelem a nyilvános űrlapokon, kulcspárral élesíthető                                | `src/payload.config.ts` (`verifyTurnstile`), `src/env.ts`     |

## Fejlesztői gyorsindítás

**Node 24.20.0 és npm 11.19.0 kell.** A `.nvmrc` alapján az `nvm use` /
`fnm use` a pontos Node-ot választja, az `engine-strict` az eltérő
runtime-ot elutasítja. A támogatott telepítés a review-zott bootstrap: ez
scriptmentes `npm ci` után ellenőrzi a verifier checksumát és a lockfile-t,
majd csak a jóváhagyott lifecycle scripteket építi újra.

```bash
nvm use                                    # vagy: fnm use (Node 24.20.0)
cp .env.example .env                       # töltsd ki a kötelező kulcsokat
node scripts/install-reviewed-dependencies.mjs
./node_modules/.bin/payload migrate        # friss vagy üres adatbázisnál KÖTELEZŐ
npm run dev                                # http://localhost:3000, admin: /admin
npm run seed                               # induló tartalom (idempotens)
```

- A Payload dev-módú séma-push ki van kapcsolva (`push: false`), ezért a
  séma kizárólag migrációval jön létre. Sémaváltozásnál:
  `./node_modules/.bin/payload migrate:create`, majd `migrate`.
- Az első regisztrált felhasználó `owner` szerepet kap; a többiek
  `customer`-ként indulnak, adminhoz `staff`-ra kell állítani őket.
- A `seed` többször futtatva sem duplikál, és a kezdőlap meglévő
  szekciósorát sosem írja felül. `SEED_SCOPE=kezdolap npm run seed`: csak a
  kezdőlap szekciósora és képei, élesben is futtatható.

### Kapuk (a CI is ezeket futtatja)

```bash
npm run typecheck        # tsc --noEmit
npm run test             # vitest run
npm run lint             # eslint
npm run build            # next build
```

A CI (`.github/workflows/ci.yml`) a review-zott bootstrappal telepít,
lefuttatja a migrációkat egy friss adatbázison, és `npm audit`-ot is futtat;
a `gitleaks.yml` titokszivárgást keres.

### Környezeti változók

A kötelező kulcsokat az induláskori assert ellenőrzi (`src/env.ts`,
`src/instrumentation.ts`); hiányukban az app magyar hibaüzenettel meg sem
indul. Titok soha nem kerül a repóba: helyben `.env` (gitignore-olt),
élesben Railway-változók. A kulcsok neve és szerepe:

| Csoport          | Kulcsok                                                                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Kötelező         | `DATABASE_URI`, `PAYLOAD_SECRET`, `NEXT_PUBLIC_SERVER_URL`, `BARION_API_URL`, `BARION_PAYEE_EMAIL`, `BARION_POSKEY_TEST` vagy (`BARION_ENVIRONMENT=prod` mellett) `BARION_POSKEY_PROD`                                               |
| Élesben kötelező | `BARION_ENVIRONMENT`; ajánlott: `ENABLE_JOB_WORKERS=true` (nélküle nem fut a webhook-retry, az order-poll és a számlázás)                                                                                                            |
| Számlázás        | `SZAMLAZZ_AGENT_KEY`, `SZAMLAZZ_AFAKULCS` (`27` vagy `AAM`, hibás értékkel az app nem indul)                                                                                                                                         |
| E-mail           | `RESEND_API_KEY` vagy `SMTP_HOST`, mellette kötelezően `EMAIL_FROM`; `CONTACT_STAFF_EMAILS` (űrlap-értesítők címzettjei)                                                                                                             |
| Videó            | `BUNNY_STREAM_TOKEN_AUTH_KEY`, `BUNNY_STREAM_LIBRARY_API_KEY`, `BUNNY_STREAM_PUBLIC_LIBRARY_API_KEY`, `NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID`, `NEXT_PUBLIC_BUNNY_STREAM_PUBLIC_LIBRARY_ID`, `NEXT_PUBLIC_BUNNY_STREAM_PULL_ZONE_HOST` |
| Analitika        | `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, `NEXT_PUBLIC_GA_MEASUREMENT_ID`, `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`, `NEXT_PUBLIC_BARION_PIXEL_ID`, `POSTHOG_SHARED_DASHBOARD_URL`                                        |
| Spam-védelem     | `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` (csak párban; élesben a fél pár indulási hiba)                                                                                                                                         |
| Domain és SEO    | `NEXT_PUBLIC_ALLOW_INDEXING` (csak `true` nyitja az indexelést), `EXTRA_ALLOWED_ORIGINS` (CORS/CSRF a domain-átállás idejére)                                                                                                        |
| Üzemeltetés      | `PAYLOAD_MEDIA_DIR` (a média-kötet útja), `TRUST_CF_CONNECTING_IP`, `TRUSTED_PROXY_HOP_COUNT` (kliens-IP a kérés-korláthoz)                                                                                                          |

A `NEXT_PUBLIC_*` kulcsok és a CSP a build idején égnek bele az oldalba:
módosításuk után újrabuild kell.

## Funkciók

Minden sor a kódból ellenőrzött; a jobb oszlop a fő belépési pont.

### Nyilvános oldalak és útvonalak

| Útvonal                                                                                         | Mi ez                                                                                                                                                     | Kód                                                                                            |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `/`                                                                                             | kezdőlap a `kezdolap` webcímű CMS-oldal szekcióiból; oldal nélkül beépített tartalék                                                                      | `src/app/(frontend)/page.tsx`, `src/components/content/HomeView.tsx`                           |
| `/[slug]`                                                                                       | bármely CMS-oldal: `/rolunk`, `/szolgaltatasok` (rendelői kezelések és árlista), jogi oldalak (`/aszf`, `/adatvedelem`, `/impresszum`), a nyolc tünet-hub | `src/app/(frontend)/[slug]/page.tsx`                                                           |
| `/kurzusok`, `/kurzusok/[slug]`                                                                 | kurzuslista otthoni és szakmai sávval; kurzusoldal (a régi numerikus id 308-cal a slugra megy)                                                            | `src/app/(frontend)/kurzusok/`, `src/lib/course-url.ts`                                        |
| `/szakembereknek`                                                                               | szakmai választó oldal (ProBody kézworkshop, szakkönyv) a `szakembereknek` CMS-oldalból, kódtartalékkal                                                   | `src/app/(frontend)/szakembereknek/page.tsx`                                                   |
| `/kapcsolat`                                                                                    | a `kapcsolat` CMS-oldal szekciói (rendelők, időpontkérés, kapcsolat-űrlap)                                                                                | `src/app/(frontend)/kapcsolat/`                                                                |
| `/blog`, `/blog/[slug]`, `/blog/kategoria/[slug]`                                               | Tudástár: lista, cikk, kategória                                                                                                                          | `src/app/(frontend)/blog/`                                                                     |
| `/kosar`, `/penztar`, `/fizetes/koszonom`, `/sikertelen`                                        | kosár, pénztár, köszönőoldal állapot-lekérdezéssel, sikertelen fizetés                                                                                    | `src/components/checkout/`                                                                     |
| `/belepes`, `/regisztracio`, `/elfelejtett-jelszo`, `/jelszo-visszaallitas`, `/belepes-atallas` | fiók és belépés, az átköltöztetett vevők külön belépő útjával                                                                                             | `src/app/(frontend)/…`, `src/components/auth/`                                                 |
| `/fiok`, `/kurzusaim`, `/kurzusaim/[id]`                                                        | fiókadatok, megvásárolt kurzusok, kurzuslejátszó                                                                                                          | `src/components/account/`                                                                      |
| `/robots.txt`, `/sitemap.xml`, `/llms.txt`, `/llms-full.txt`, `/manifest.webmanifest`, OG-kép   | gépi olvasásra szánt fájlok                                                                                                                               | `src/app/robots.ts`, `src/app/sitemap.ts`, `src/app/llms*.txt/`, `src/app/opengraph-image.tsx` |
| 404, hibaoldal                                                                                  | magyar `global-not-found` és `global-error`                                                                                                               | `src/app/global-not-found.tsx`, `src/app/global-error.tsx`                                     |
| `/next/preview`, `/next/exit-preview`                                                           | piszkozat-előnézet staff és owner számára                                                                                                                 | `src/lib/preview/route-handler.ts`                                                             |

Saját API-végpontok (`src/app/(frontend)/api/`): `checkout/start`,
`barion/callback`, `orders/[orderNumber]/status`, `stream-token`,
`course-progress/mark-watched`, `free-course/request`,
`users/reset-password`, `visszajelzes`, valamint az adminé:
`admin/grant-purchase`, `admin/orders/[orderNumber]/refund`,
`admin/course-progress`, `admin/user-progress`, `admin/bunny-videos`,
`admin/bunny-uploads`. Minden más a Payload REST-je (`/api/...`).

### Szekció-rendszer (CMS-ből építhető oldalak)

Az Oldalak `layout` mezője szekciókból áll, amelyeket a szerkesztő
elrejthet, átrendezhet, és újat vehet fel. Minden szekció közös
beállítása: látható-e, ugrópont neve, háttér (Fehér, Világoskék,
Sötétkék). A blokk-katalógus (`src/blocks/index.ts`, az admin
„+ Blokk” listájának sorrendjében):

| Admin-név                      | Slug          | Admin-név                | Slug           |
| ------------------------------ | ------------- | ------------------------ | -------------- |
| Nyitó videó (kéznyitás)        | `filmHero`    | Ígéretek kártyákon       | `usps`         |
| Szakmai háttér sáv             | `credsStrip`  | A kéz három állapota     | `states`       |
| Kurzuskártyák (automatikus)    | `courseCards` | Képes lista vagy kártyák | `services`     |
| Ingyenes villámkurzus sáv      | `freeSos`     | Bemutatkozás és számok   | `about`        |
| Logósor                        | `pressLogos`  | Számozott lépések        | `howItWorks`   |
| Üdvözlés és gondok             | `welcome`     | Vélemények (automatikus) | `testimonials` |
| Tudástár-ajánló (automatikus)  | `knowledge`   | GYIK (gyakori kérdések)  | `faq`          |
| Szakemberek kártyái            | `teamMembers` | Nyitható sorok           | `accordion`    |
| Időpontkérés                   | `appointment` | Szabad szöveg            | `richText`     |
| Gombos kiemelő sáv (képpel is) | `ctaBanner`   | Ajánlat-kártyák          | `offerCards`   |

A kurzusok Részletes leírásában ezen felül a **Kurzuscsomag** blokk
(`src/blocks/CoursePackage.ts`) választható: ikonos csomagtartalom az
akciós kurzusoldalhoz. A „Szabad szöveg” blokkban írt rendelői árlistát a
megjelenítő felismeri és rendezett árlistaként rajzolja
(`src/lib/rendeloi-arlista.ts`).

### Kurzusok és termékek

A kurzusok az ecommerce-plugin `products` gyűjteményében élnek, öt fülön
(Alapadatok, Ár és hozzáférés, Kurzusoldal, Tananyag, Haladás);
konfiguráció: `src/plugins/ecommerce.ts`.

- **Két közönség:** `audience` = Otthoni gyakorlóknak vagy Szakembereknek
  (`src/lib/course-audience.ts`); a lista és a statisztika ez alapján bont.
- **Rejtett kurzus:** az `unlisted` pipa (csak a tulajdonos állíthatja)
  kiveszi a kurzust a listákból, ajánlókból, menükből és a sitemapból, de
  linkkel megnyitható és megvásárolható, `noindex, follow` jelzéssel
  (`docs/course-unlisted.md`).
- **Akciós megjelenés és akciós ár lejárattal:** `promoEnabled`,
  `promoStart`, `promoEnd`, `promoPriceHuf`. Az időablakon belül akciós
  sablon és akciós ár, utána magától a rendes ár; a kártya, a kosár, a
  Barion-összeg és a rendelés-snapshot ugyanabból a feloldóból olvas
  (`src/lib/course-promo.ts`, `src/components/courses/promo/`).
- **Tananyag:** fejezetek és leckék (videó, szöveg, link), leckénként
  csatolmányokkal a védett **Védett kurzusfájlok** gyűjteményből
  (`src/fields/course-modules.ts`, `src/collections/CourseFiles.ts`).
- **Időkorlátos hozzáférés:** `accessDurationDays` és a vevő
  `accessGrants` bejegyzései (`src/lib/access-grants.ts`,
  `src/lib/course-access.ts`).
- **Videó:** Bunny Stream, a lejátszáshoz rövid életű token
  (`/api/stream-token`, `src/lib/stream/issue-stream-token.ts`); előzetes
  és hero-videó a publikus libraryből, token nélkül.
- **Haladáskövetés:** a lejátszó a ténylegesen megnézett részt méri és
  jelöli (`src/lib/course-progress/`, `src/lib/stream/watched-coverage.ts`,
  `src/collections/CourseProgress.ts`).
- **Kurzusoldal CMS-ből:** fő előnyök, hogyan működik, kinek való és kinek
  nem, garancia, GYIK, galéria, kapcsolódó kurzusok, SEO-mezők; a
  Részletes leírás kulcsszavas címsorai ezekbe a sávokba is rendeződhetnek.

### Ingyenes SOS villámkurzus

Az ingyenes kurzust (ár nélküli termék, `isFreeCourse` a
`src/lib/courses.ts`-ben) név és e-mail megadásával lehet igényelni:
`/api/free-course/request` fiókot hoz létre vagy a meglévőhöz rendeli a
kurzust, és belépő linket küld (7 napos token). Aktivált fióknál és
munkatársnál nem ír, a válasz nem árulja el, létezett-e a fiók
(`src/lib/free-course/`). Felülete a kurzusoldal igénylő űrlapja és a
kezdőlapi „Ingyenes villámkurzus sáv”.

### Kosár, pénztár, Barion-fizetés

- **Kosár:** kliensoldali, a böngészőben tárolva; tételenként dönti el,
  hogy fizetős, ingyenes, archivált vagy nem vásárolható (`src/lib/cart.ts`).
- **Pénztár:** vendégként is (e-mail + név), számlázási adatokkal, a
  digitális tartalomra vonatkozó elállási nyilatkozattal
  (`src/lib/checkout/`).
- **Indítás:** `POST /api/checkout/start` → Barion Payment/Start v2
  (Immediate, HUF, hu-HU, 30 perces fizetési ablak) → átirányítás a Barionra.
- **Jóváhagyás:** `POST /api/barion/callback` azonnal 200-at ad és
  deduplikál; a rendelés `paid` állapotát **kizárólag** a szerver-szerver
  `GetPaymentState v4` lekérdezés dönti el, idempotens állapotgépben
  (`src/lib/order-status/apply-barion-state.ts`). A plugin `confirmOrder`
  függvénye tilos (CLAUDE.md 2. tilos zóna).
- **Háttérjobok** (`src/jobs/`, `ENABLE_JOB_WORKERS=true` mellett):
  `webhook-retry` percenként (elhasalt callbackok újrafeldolgozása),
  `order-poll` 5 percenként (elveszett callback pótlása, árva rendelés
  lejárata 24 óra után, számla-resweep). A számlázó jobok eseményre állnak
  sorba.
- **Visszatérítés:** az adminban a rendelésnél (RefundPanel) teljes vagy
  részösszegű visszatérítés a Barion Refund v2-vel; a `refund-intents`
  gyűjtemény rögzíti a szándékot, így bizonytalan első kísérlet után nem
  indulhat második pénzmozgás, a félbemaradt utófeldolgozás pedig
  folytatható (`src/lib/refund/`).
- **Kézi hozzáférés-adás** vásárlás nélkül: admin-panel és
  `npm run grant:purchase` (`src/lib/grant-purchase.ts`).
- **Mérés:** funnel `course_viewed → checkout_started → purchase_confirmed`
  (PostHog), opcionálisan Barion Pixel, mind hozzájárulás után.

### Számlázás (Számlázz.hu)

A `paid` átmenet után az `invoice-issue` job állítja ki a számlát; a
külső azonosító a rendelésszám, így az ismétlés nem duplikál.
Visszatérítéskor a bizonylat-történet alapján **stornó** (`storno-issue`)
vagy **helyesbítő számla** (`corrective-invoice-issue`) készül.
Kód: `src/lib/szamlazz/`, `src/jobs/tasks/`; leírás: `docs/szamlazz-storno.md`.

### Vevői fiók

- Belépés, regisztráció, elfelejtett jelszó, jelszó-visszaállítás saját
  végponttal (`/api/users/reset-password`), a többi munkamenet
  kiléptetésével (`src/lib/security/reset-password-route.ts`).
- **Jelszópolitika:** legalább 12 karakter, további szabályokkal, szerver
  oldalon kikényszerítve (`src/lib/security/password-policy.ts`,
  `docs/jelszo-politika.md`).
- **Kurzusaim:** a megvásárolt és ingyenes kurzusok, lejátszó
  fejezetekkel, haladással, csatolmányokkal.
- **Átköltöztetés a Systeme.io-ról:** tömeges vevő-import CSV-ből
  aktiválási linkekkel (`npm run import:customers`,
  `src/lib/customer-import/`), értesítő levél idempotens kiküldéssel
  (`npm run email:migracio`, `src/lib/migration-notice/`) és a
  `/belepes-atallas` belépő oldal. Útmutató: `docs/vasarlo-migracio-terv.md`.

### Tudástár

- Blogbejegyzések kategóriákkal, tartalomjegyzékkel, olvasási idővel,
  szerzői dobozzal, cikkenkénti GYIK-kel és kurzusajánlóval
  (`src/collections/Posts.ts`, `src/components/content/Post*.tsx`).
- **Nyolc tünet-hub** gyökércímen (pl. `/keztoalagut-szindroma`,
  `/pattano-ujj`), a hozzá tartozó lektorált cikkel párosítva
  (`src/lib/tudastar/hub-oldalak.ts`).
- Cikkbetöltés markdownból: `npm run import:tudastar`, hubok:
  `npm run import:hubok` (`docs/tudastar-cikkek-betoltese.md`).
- **Ki- és bekapcsolás a `/blog` menüponttal**
  (`src/lib/tudastar-kapcsolo.ts`): ha minden `/blog` célú menüpont
  rejtett vagy nem látható, a Tudástár mindenhonnan eltűnik (menü,
  kezdőlapi ajánló, kurzus- és hibaoldali hivatkozások, sitemap, llms.txt), a lapjai
  közvetlen linken 200-zal elérhetők maradnak `noindex, follow` jelzéssel.
  Visszakapcsoláskor minden a helyére kerül. Adatbázis-hibánál bekapcsolva
  marad.

### Menük, vélemények, űrlapok

- **Menüpontok** (`src/collections/Menus.ts`): belső oldalra, kurzusra vagy
  webcímre mutatnak, almenüvel; látható és rejtett (csak linkkel elérhető)
  pont, új lapon nyitás.
- **Vélemények** (`src/collections/Testimonials.ts`): kiemelés, sorrend,
  láthatóság; az adminban látszik, hol jelennek meg.
- **Időpontkérés** (`appointment` blokk): név, telefon, e-mail, panasz,
  időpont-sávok, egészségügyi hozzájárulás; a stáb telefonszámmal az élén
  kap levelet, a beküldő visszaigazolást (`src/lib/appointment/`).
- **Kapcsolat-űrlap** és **hírlevél-feliratkozás** a lábléccel
  (`src/lib/contact-submission.ts`, `src/lib/newsletter/`,
  `docs/hirlevel.md`). Mindhárom a form-builder pluginen megy, szerveroldali
  mező- és hozzájárulás-ellenőrzéssel, Turnstile-lal és kérés-korláttal.
- **Visszajelzés-doboz** minden oldalon: a látogató jelezheti, ha valami
  nem működik, a jelzés PostHog-eseményként érkezik
  (`src/components/feedback/`, `src/lib/feedback/`).
- **Süti-hozzájárulás:** a PostHog, a GA4 és a Barion Pixel csak
  elfogadás után tölt be (`src/components/analytics/ConsentBanner.tsx`).

### Admin

- **Magyar felület**, egyetlen nyelvvel, a Payload fordítási hibáinak
  javításával (`src/lib/admin/hu-forditas.ts`); magyar dátumformátum.
- **Menücsoportok:** Tartalom, Navigáció, Webshop, Űrlapok és beküldések,
  Fiókok, Rendszer, feladat-gyakoriság szerint rendezve
  (`src/plugins/admin-groups.ts`); „Gyakori teendők” az Irányítópulton.
- **WCAG AA kontraszt** világos és sötét témán, fókusz, célméret, reflow
  (`src/app/(payload)/custom.scss`).
- **Szekciók sorcímkéje** (típus, sorszám, cím, rejtett jel), tömbsorok
  beszédes címkéje, „Megnézem az oldalon” tájékoztató és „ugyanaz máshol”
  jelzés (`src/blocks/index.ts`, `src/components/admin/SectionRowLabel.tsx`,
  `SectionCopies.tsx`).
- **„Szerkesztem” szalag** a piszkozat-előnézetben: minden szekció előtt
  mélylink a szerkesztő pontos sorára (`?szekcio=…`), amit az admin
  kinyit és odagörget (`src/components/editor/`).
- **Két lapon nyitott szerkesztő figyelmeztetés** (Broadcast Channel), hogy
  az egyik lap mentése ne írja felül a másikét
  (`src/components/editor/admin/KetLapFigyelo.tsx`).
- **Saját nézetek:** Kezdőlap, Kezdőlapi videó szövegei (a nyitó videó
  feliratai, üresen a beépített szöveg; `src/lib/film-captions.ts`),
  Statisztika (havi bevétel közönség szerint, funnel, haladás), Webanalitika
  (beágyazott PostHog-dashboard), Videótár (Bunny library, feltöltés TUS-szal).
- **Fotóhelyek:** a kezdőlapi mozgó fotósor négy íve és a „Kurzusaink”
  jelenet három fotója név szerint cserélhető, üresen a beépített fotóval
  (`src/lib/kep-helyek.ts`).
- **Kódhoz kötött webcímek** jelzése (kezdőlap, kapcsolat, jogi oldalak,
  hubok) és az Oldalak „Mi ez” oszlopa (`src/lib/admin/kotott-cimek.ts`).
- **Kurzusszerkesztés segédei:** láthatósági jelzés, szerkesztői
  ellenőrzőlista, akció-állapot, haladás-panel, karakterszámláló.
- **Naplózás:** az `audit-logs` rögzíti a közzétételt, visszatérítést,
  vásárlás- és szerepkör-változást (`src/plugins/audit.ts`); a
  `webhook-events` a Barion-eseményeket.

### SEO

- **JSON-LD gráf:** WebSite, Organization, WebPage, BreadcrumbList,
  lapfüggően AboutPage és Person, ContactPage és MedicalBusiness, Service,
  Course, BlogPosting, FAQPage (`src/lib/seo-graph.ts`, `src/lib/seo.ts`).
- **Sitemap, robots, llms.txt** (`src/app/sitemap.ts`, `src/app/robots.ts`,
  `src/lib/seo-llms.ts`).
- **Örökölt kineticare.hu URL-ek:** mind a 25 régi címnek van sorsa:
  változatlan, tartós 308, vagy 410 Gone a spam-posztokra
  (`src/lib/legacy-redirects.ts`, `docs/orokolt-url-atiranyitasok.md`).
- **Indexelés-kapu:** amíg `NEXT_PUBLIC_ALLOW_INDEXING` nem `true`, minden
  válasz `X-Robots-Tag: noindex` fejlécet kap (`src/middleware.ts`). A
  bejelentkezés mögötti és tranzakciós lapok mindig `noindex`.

### Biztonság

- **Same-origin/CSRF-őr** a sütis saját POST-végpontokon
  (`src/lib/security/same-origin.ts`), a Payload `cors`/`csrf` listájával
  azonos engedélylistával (`src/env.ts`).
- **REST törzskorlát:** 2 MiB a nem multipart Payload-kérésekre
  (`src/lib/security/payload-rest-body-limit.ts`); feltöltés max. 10 MB.
- **Kérés-korlát** a nyilvános végpontokon (`src/lib/security/rate-limit.ts`).
- **Biztonsági fejlécek és CSP** (`next.config.ts`, `src/lib/security/csp.ts`).
- **Strukturált napló request ID-val** és érzékeny mezők kitakarásával
  (`src/lib/logger.ts`, `src/middleware.ts`); a PostHog-proxy felé a süti
  és az Authorization fejléc nem megy ki.
- **Privát válaszok:** a lejátszási token, az admin haladás-lekérdezések és
  a visszatérítés válaszai `Cache-Control: no-store` fejlécet kapnak; a
  fiók- és tranzakciós lapok `noindex` metát (`buildPrivatePageMetadata`,
  `src/lib/seo.ts`).
- GraphQL kikapcsolva; a jobok, a zárolt dokumentumok és a jelszó-token
  mezők hozzáférése külön zárva (`src/payload.config.ts` vége).

## Parancsok

| Parancs                                                     | Mire                                                                                                      |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `npm run dev` / `build` / `start`                           | fejlesztés, build, indítás                                                                                |
| `npm run typecheck` / `test` / `lint`                       | kapuk                                                                                                     |
| `npm run generate:types` / `generate:importmap`             | Payload-típusok és admin importmap                                                                        |
| `npm run verify:install-scripts`                            | a telepítési scriptek zárának ellenőrzése                                                                 |
| `npm run seed` / `seed:menu` / `seed:legacy`                | induló tartalom, menü, örökölt tartalom visszatöltése                                                     |
| `npm run content:owner`                                     | tulajdonos által jóváhagyott tartalom-javítások; alapból próbafutás, íráshoz `OWNER_CONTENT_CONFIRM=igen` |
| `npm run import:tudastar` / `import:hubok`                  | Tudástár-cikkek és tünet-hubok betöltése (`OWNER_TUDASTAR_CONFIRM=igen`)                                  |
| `npm run import:bunny-curriculum` / `kurzus:videok-modulba` | tananyag Bunny-ból, régi videólista modulokba (`OWNER_BUNNY_CURRICULUM_CONFIRM`)                          |
| `npm run import:customers` / `email:migracio`               | vevő-átköltöztetés és értesítő                                                                            |
| `npm run grant:purchase`                                    | kézi hozzáférés-adás                                                                                      |
| `npm run backfill:ar-snapshot` / `backfill:access-grants`   | egyszeri adatpótlások (`OWNER_BACKFILL_CONFIRM=igen`)                                                     |
| `npm run backup:db`                                         | adatbázis-mentés integritás-ellenőrzéssel                                                                 |
| `npm run seed:demo`                                         | demó-adatok (a demó környezet 2026-08-29 óta kivezetve)                                                   |

A scriptek forrása a `src/scripts/`, az egyszeri Railway-jobok configja a
`railway.*-job.json` fájlokban.

## Szabályok röviden

A teljes, mérvadó lista a [`CLAUDE.md`](CLAUDE.md)-ben (TILOS ZÓNÁK).

- Titok sosem kerül a repóba, még placeholderként sem; tesztben csak
  kifejezetten jelölt DUMMY érték szabad. A `.env*` fájlokhoz ügynök nem nyúl.
- A `confirmOrder` hívása, importja, re-exportja tilos; a `paid` átmenet a
  Barion-callback útjáé (v4-verifikáció).
- Migrációt kézzel írni vagy meglévőt módosítani tilos, a CI őrei
  (`docs/ci-orok.md`) ezt meg is fogják.
- Access-control módosítás csak emberi jóváhagyással.
- A `@payloadcms/*` verziók pontosan rögzítve (3.88.0), emelés csak külön
  kérésre, külön PR-ben.
- Felületi munka előtt a `.claude/skills/termektervezes/SKILL.md` betöltése
  kötelező.

## Fizetési és számlázási lánc röviden

1. `POST /api/checkout/start` → Barion Payment/Start v2 → a vevő a Barionon fizet.
2. `POST /api/barion/callback` → azonnali 200 és dedup → `GetPaymentState v4`
   → idempotens állapotgép; elhasalt feldolgozást a `webhook-retry` ismétel.
3. Elveszett callback: az `order-poll` 5 percenként utánpollol, lejártatja az
   árva rendeléseket, és újra sorba állítja a hiányzó számlákat.
4. `paid` → hozzáférés (`users.purchases`, időkorlátnál `accessGrants`) →
   visszaigazoló levél → `invoice-issue` (Számlázz.hu).
5. Visszatérítés az adminból → Barion Refund v2 → stornó vagy helyesbítő számla.

## Deploy (Railway)

A `main` a Railway **`Kineticare`** szolgáltatására deployolódik; a config
a [`railway.json`](railway.json)-ban, a runbook a
[`docs/deploy-railway.md`](docs/deploy-railway.md)-ben. A start-parancs előbb
a migrációkat futtatja, és csak utána indítja a Next-et
(`node ./node_modules/payload/bin.js migrate && exec node ./node_modules/next/dist/bin/next start`),
a healthcheck a `GET /admin`. Merge után a munka nem kész: a `main` CI-jét
és a deployt figyelni kell (CLAUDE.md 23. pont).

> **A `buildCommand` explicit megadása kötelező.** Nélküle a Railway builder
> „nothing to build” döntéssel kihagyhatja a buildet, lehúzza az új commitot,
> de a korábbi `.next/` mappát indítja el. A deploy zölden „SUCCESS”, miközben
> régi kód fut; csak a build-log `Build · skipped (nothing to build)` sora
> árulja el. A deploy-logban ezért mindig keresd a tényleges Next buildet és a
> `Migrating:` / `Migrated:` sorokat.
>
> A config-as-code (`railway.json`) felülírja a dashboardon beállított
> értékeket. Ha egy szolgáltatásnak más parancs kell (egyszeri job), annak
> saját config-fájl jár (`railway.*-job.json`) és a szolgáltatás
> „Config file path” beállítása.

### Feltöltött képek (Volume, élesben kötelező)

A Payload a képeket a konténer lemezére írja, amit a Railway minden
deploynál üresen ad vissza. Kötet nélkül a feltöltött képek elvesznek (a
rekord marad, a `/api/media/file/...` 500-at ad). Élesben ezért kell egy
Railway Volume `/app/media` mountponttal és a `PAYLOAD_MEDIA_DIR=/app/media`
változó; nélküle a könyvtár `<munkakönyvtár>/media`.

Induláskor az `ensureMediaFiles` (`src/lib/media-restore.ts`) fájl-szinten
ellenőrzi a média-rekordokat, és a hiányzókat a repóban lévő forrásokból
visszatölti, a rekord id-jének megőrzésével. Amihez nincs repó-forrás (a
szerkesztők saját feltöltései), azt csak megszámolja és figyelmeztetést
naplóz.

### Adatbázis-mentés

`npm run backup:db` helyben, a `db-backup.yml` workflow naponta titkosított
offsite mentést készít (a `DATABASE_URI` GitHub-secret és a
`BACKUP_AGE_RECIPIENT` változó beállítása után). Visszaállítás és a
restore-próba: [`docs/adatbazis-mentes.md`](docs/adatbazis-mentes.md).

## Dokumentáció

- **Teljes dokumentáció-index:** [`docs/README.md`](docs/README.md), minden
  `docs/` fájl egy sorban, élő vagy történeti jelöléssel.
- **Ügynök-kézikönyv:** [`docs/ugynok-kezikonyv.md`](docs/ugynok-kezikonyv.md)
  (hol melyik route, API, gyűjtemény, job és tilalom él).
- **Claude indító prompt:** [`docs/claude-indito-prompt.md`](docs/claude-indito-prompt.md);
  küldhető átadási csomag: [`handover/`](handover/).
- **Szerkesztőknek:** [`docs/szerkesztoi-utmutato.md`](docs/szerkesztoi-utmutato.md),
  [`docs/mi-hol-szerkesztheto.md`](docs/mi-hol-szerkesztheto.md).
- **Felületi szabályok:** [`docs/ui-sztenderdek.md`](docs/ui-sztenderdek.md),
  [`docs/ertekesitesi-ux-skill.md`](docs/ertekesitesi-ux-skill.md).
- **Ügynök-szabályok:** [`CLAUDE.md`](CLAUDE.md), [`AGENTS.md`](AGENTS.md).
