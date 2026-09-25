# Kineticare — ügynök-kézikönyv

> **Kinek szól:** a következő kódoló ügynöknek, aki először nyitja meg a
> repót, vagy évek múlva nyúl hozzá. Nem termékterv, nem marketingdoksi.
> **Honnan a tartalom:** a 2026-09-23-i `main` (`d5c144d`, a #293 merge
> után) élő forráskódja, plusz a `docs/` döntési dokumentumai.
> Screenshotból és kampányjegyzetből ne diagnosztizálj: a kód és a
> tesztek a bizonyíték.
> **Hogyan használd:** olvasd el a 0–4. szakaszt mindig. A 5. szakasztól
> ugorj arra a tartományra, amihez nyúlsz. A részletes, egy-témás doksik
> (`docs/`) ettől NEM szűnnek meg — ez a térkép, azok a mélyfúrások.

**Utolsó frissítés: 2026-09-23** (a #290–#293 merge-ök: Payload REST
Node 24-javítás, magyar admin, szerkesztői réteg, filmfeliratok,
Tudástár-kapcsoló, fotóhelyek, Ajánlat-kártyák, kapcsolati e-mail
feloldó, `/szakembereknek` CMS-ből, friss telepítésre szűkített onInit).

**Kapcsolódó, NEM helyettesített fájlok:**

| Fájl                                        | Mit tart                                                           |
| ------------------------------------------- | ------------------------------------------------------------------ |
| `handover/`                                 | Küldhető átadási csomag (másolat; a kanonikus kézikönyv itt marad) |
| `docs/claude-indito-prompt.md`              | Bemásolható első üzenet a következő Claude-nak                     |
| `AGENTS.md`                                 | Rövid szabálykönyv + parancsok + tilos zónák                       |
| `CLAUDE.md`                                 | Ugyanaz bővebben; **ellentmondásnál ez a mérvadó**                 |
| `docs/agent-feature-map.md`                 | Cikk-CTA, Craft-sáv, Shop-sáv, Ads-zárak                           |
| `docs/feladatlista.md`                      | Mi van hátra (részben archív)                                      |
| `docs/szerkesztoi-utmutato.md`              | Admin: mire kattints, mihez ne nyúlj                               |
| `docs/mi-hol-szerkesztheto.md`              | Oldalanként: melyik látott elem melyik mezőből (vagy kódból) jön   |
| `docs/ertekesitesi-ux-skill.md`             | Felületi munka előtt kötelező                                      |
| `.claude/skills/termektervezes/SKILL.md`    | Felületi munka előtt kötelező skill                                |
| `.claude/skills/teszt-audit/SKILL.md`       | Teszt írása, módosítása, átnézése előtt kötelező skill             |
| `.cursor/skills/verify-kineticare/SKILL.md` | Élő storefront GET-ellenőrzés                                      |

---

## 0. Első 60 másodperc

1. **Ez egy magyar nyelvű, kézrehabilitációs kurzusbolt.** A vevő kurzust
   vesz Barionnal, számlát kap Számlázz.hu-n, a videót Bunny tokennel nézi.
2. **A fizetésjóváhagyás NEM a Payload ecommerce `confirmOrder`.** Saját
   Barion-callback + GetPaymentState v4. A `confirmOrder` szándékosan dob.
3. **Három igazság a hozzáféréshez:** `orders` (fizetés/számla) ≠
   `users.purchases` (SKU-halmaz, adminból pipálni tilos) ≠
   `users.accessGrants` (az óra kezdőpontja).
4. **Felületi munka előtt** olvasd: `docs/ertekesitesi-ux-skill.md` +
   `.claude/skills/termektervezes/SKILL.md`. Memóriából UI-t tervezni tilos.
5. **Titok, `.env*`, kézi migráció, access-szabály, pinned Payload-verzió**
   — lásd a 2. szakaszt. Ezeket ne „javítsd".
6. **A storefront API-k a `(frontend)` route-groupban élnek**, nem
   `src/app/api/`-ban. A Payload REST a `(payload)/api/[...slug]`.
7. **A látogatói szöveg többnyire a CMS-ből jön**, a kód csak üres
   mezőnél ad tartalékot (filmfeliratok, fotóhelyek, `/szakembereknek`,
   kapcsolati e-mail). Ha a CMS meg tudja oldani, ne égesd be a kódba.
   Szerkesztői térkép: `docs/mi-hol-szerkesztheto.md`.

### Hol kezdj, ha X-et kérnek

| Kérés                                            | Első fájlok                                                                                                                     | Ne nyúlj ide                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Fizetés / Barion / paid                          | `src/lib/checkout/start-checkout.ts`, `src/lib/order-status/apply-barion-state.ts`, `src/lib/barion-callback/`                  | `confirmOrder`, plugin `/payments/*`                        |
| Számla / stornó / helyesbítő                     | `src/lib/szamlazz/`, `src/jobs/tasks/`                                                                                          | kézi `invoiceStatus` írás, migráció                         |
| Videó / lejátszó / token                         | `src/lib/stream/`, `src/lib/curriculum/curriculum.ts`, `src/app/(frontend)/kurzusaim/[id]/page.tsx`                             | Bunny GUID a nyilvános RSC-payloadba hozzáférés nélkül      |
| Hozzáférés / ajándék / lejárat                   | `src/lib/course-access.ts`, `src/lib/access-grants.ts`, `src/lib/grant-purchase.ts`                                             | `users.purchases` admin-pipa, hamis paid rendelés           |
| Kezdőlap / szekció                               | `src/blocks/`, `src/components/blocks/`, `src/lib/home-seed.ts`                                                                 | meglévő kezdőlap-szekciósor felülírása seeddel              |
| Kezdőlapi videó feliratai                        | `src/lib/film-captions.ts`, `src/blocks/film-hero.ts` (`captions`)                                                              | felirat beégetése a `FilmHero.tsx`-be                       |
| Fríz / „Kurzusaink” fotóhelyek                   | `src/lib/kep-helyek.ts`, `src/lib/foto-friz.ts`, `src/blocks/about.ts` (`frieze`), `src/blocks/course-cards.ts` (`scenePhotos`) | szabad képlista a rögzített helyek helyett                  |
| Tudástár ki/be                                   | `src/lib/tudastar-kapcsolo.ts` (szabály), `tudastar-lathatosag.ts`, `tudastar-link-szuro.ts`                                    | második kapcsoló-szabály, külön flag                        |
| Kapcsolati e-mail                                | `src/lib/contact-email.ts` + `contact-email-server.ts`                                                                          | e-mail-literál bárhol máshol                                |
| `/szakembereknek`                                | `src/app/(frontend)/szakembereknek/page.tsx`, `src/lib/szakembereknek.ts`, `src/blocks/offer-cards.ts`                          | kitalált szakkönyv-URL (`SZAKKONYV_URL` szándékosan `null`) |
| Admin felület / fordítás / menü                  | `src/lib/admin/hu-forditas.ts`, `src/plugins/admin-groups.ts`, `src/components/admin/`, `src/app/(payload)/custom.scss`         | access-szabály, collection-slug                             |
| Szerkesztői réteg (Szerkesztem szalag, mélylink) | `src/components/editor/`, `src/lib/section-row-label.ts`                                                                        | helyben szerkesztés, látogatói JS a réteghez                |
| Tulajdonosi tartalom-javítás élesben             | `src/scripts/apply-owner-content.ts` + szabálymoduljai                                                                          | kapu nélküli írás, meglévő szerkesztői szöveg felülírása    |
| Payload REST 500 / törzskorlát                   | `src/lib/security/payload-rest-body-limit.ts`, `src/access/privateResponse.ts`                                                  | `new Request(request, …)` a route-handler kérésén           |
| Cikk / hub / CTA                                 | `src/components/content/PostArticle.tsx`, `PostCourseCta.tsx`, `docs/agent-feature-map.md`                                      | orvosi szöveg, Ads-kreatív, A-gyökér 404-őr                 |
| Gomb / felirat                                   | `src/lib/cta-vocabulary.ts`, `docs/ui-sztenderdek.md` §3.2                                                                      | új felirat szótár nélkül                                    |
| Auth / jelszó                                    | `src/collections/Users.ts`, `src/lib/security/`                                                                                 | GraphQL visszakapcsolás, access-szabály                     |
| Admin stat / videótár                            | `src/components/admin/`, `src/lib/statistics/`, `src/lib/stream/bunny-*`                                                        | access-szabály a custom view-n kívül                        |
| Deploy / Railway                                 | `railway.json`, `railway.*-job.json`, `docs/deploy-railway.md`, `CLAUDE.md` tanulságok                                          | Kineticare-demo, régi kötet nélküli Postgres                |
| Migráció                                         | Payload `migrate:create`                                                                                                        | meglévő `src/migrations/*.ts` szerkesztése                  |

---

## 1. Mi ez a termék

A **Kineticare** (éles appservice: Railway `Kineticare`, adatbázis:
`Postgres-c8Rg`) kézrehabilitációs online kurzusplatform: webshop +
Payload CMS + védett videólejátszás. A `kineticare.hu` domain-átállás
még **nyitott**: a domain ma a régi Systeme.io oldalt szolgálja, az új
platform a Railway-hoston él (`docs/kineticare-hu-atallas.md`).
A tulajdonos Barna Norbert; a szakmai zálog a két Kata (Kocsis Kata,
Kiss Kata) — ők a tartalom és az orvosi állítások gazdái.

**Üzleti sorrend** (`docs/ertekesitesi-ux-skill.md`):

1. Kurzus-értékesítés (Barion).
2. Bizalom / szakmai hitel.
3. Kapcsolatfelvétel / időpont.
4. Tudástár (SEO, hosszútáv).

A vevő útja: cikk vagy kezdőlap → `/kurzusok/{slug}` → `/penztar?termek={id}`
→ Barion → `/fizetes/koszonom` → `/kurzusaim/{id}`. Vendég is vásárolhat;
a fiók a fizetés után jön létre, jelszó-beállító linkkel.

**Két kanonikus fizetős/ingyenes termék-slug** (őrzi
`src/lib/legacy-redirects.ts`):

| Konstans              | Kanonikus út                          | Szerep                     |
| --------------------- | ------------------------------------- | -------------------------- |
| `COURSE_HOME_REHAB`   | `/kurzusok/otthoni-kezrehab-program`  | Fő fizetős program         |
| `COURSE_SOS_KEZRELAX` | `/kurzusok/sos-kezrelax-villamkurzus` | Ingyenes SOS (lead-magnet) |

Az SOS **nem** Ads-lander és **nem** fizetett ajtó. A `/kezrelax` 308 ide.

**Stack (pinned, a `package.json` a bizonyíték):**

- Next.js `16.3.5` App Router, React `19.3.0` (a #266 emelte a
  16.3.3 / 19.2.8-ról, az ellátási-lánc-őrön át; a `CLAUDE.md`
  stack-sora még a régi Next-számot írja), TypeScript `5.9.3` strict
- Payload CMS `3.88.0` + `@payloadcms/plugin-ecommerce` `3.88.0` (béta)
- `@payloadcms/plugin-form-builder`, `@payloadcms/db-postgres`,
  `@payloadcms/richtext-lexical`: mind `3.88.0`
- Node `24.20.0`, npm `11.19.0` (`engines` + `.nvmrc`, engine-strict)
- Vitest 4 (node), ESLint 9 + eslint-config-next, Prettier
  (`semi: false`, `singleQuote: true`, `printWidth: 100`)

A `@payloadcms/*` verzió **pontos**, `^` tilos. A lockfile-t ne generáld
újra (install-script lánc: `npm run verify:install-scripts`,
`scripts/verify-install-script-lock.*`). Verzióemelés csak emberi
kérésre, külön PR-ben.

---

## 2. Tilos zónák (kivétel nélkül)

Ezeket a `CLAUDE.md` / `AGENTS.md` is listázza. Itt a **hol él a kód**
is benne van, hogy ne keresd.

### 2.1 Titok sosem a repóban

Jelszó, API-kulcs, token, POSKey, tanúsítvány — kódba, konfigba,
kommentbe, tesztfixtúrába sem, még placeholderként sem. Tesztekben
kifejezetten jelölt `DUMMY` szabad. A `.env*` fájlokat **ne olvasd, ne
módosítsd, ne másold**. Új kulcsot az `.env.example`-ben, érték nélkül
jelezz. A gitleaks CI a teljes historyt nézi (`.gitleaks.toml`).

### 2.2 `confirmOrder` tilos

A plugin ismert béta-hibája: a `confirmOrder` nem ellenőrzi a fizetés
tényleges státuszát. A saját adapter szándékosan mindig dob:

- `src/lib/payments/barion-adapter.ts` — `confirmOrder` throw +
  `withoutPluginPaymentEndpoints` (minden `/payments/*` kiesik)
- Paid-átmenet: `src/lib/order-status/apply-barion-state.ts`
- Callback: `src/app/(frontend)/api/barion/callback/route.ts` →
  `src/lib/barion-callback/`

Ne hívd, ne importáld, ne re-exportáld, ne „javítsd".

### 2.3 Migrációt kézzel ne írj

Séma-változás: `./node_modules/.bin/payload migrate:create`, majd
`migrate`. Meglévő `src/migrations/*.ts` szerkesztése, törlése,
sorrend-csere tilos. Őrök: `docs/ci-orok.md` (G1–G4). A deploy
`railway.json` startja: `payload migrate && exec next start`.

A postgres-adapterben `push: false` — a dev séma-push interaktív
táblatörlést kínálna. Őr-teszt védi.

### 2.4 Access-control csak emberi jóváhagyással

Collection- és field-szintű `access`, auth-hook. PR nyitható, merge
előtt emberi review kötelező. A mátrix: `src/access/policies.ts` +
`src/collections/Users.ts` + `src/plugins/ecommerce.ts`.

A legutóbbi, emberi jóváhagyással mergelt access-változások (ne
„egyszerűsítsd” vissza őket):

- `users.resetPasswordToken` / `resetPasswordExpiration` olvasás-zár
  (#260): `restrictResetTokenFieldAccess`
  (`src/lib/security/reset-token-field-access.ts`), a
  `payload.config.ts` a `buildConfig` eredményére teszi.
- A termék akciós mezői owner-only írásúak (#283, #289):
  `promoEnabled`, `promoStart`, `promoEnd` (`promoWindowFieldAccess`) és
  `promoPriceHuf`, mert ezek döntik el a fizetendő árat.
- `products.unlisted` owner-only (#285).
- Űrlapok írása `isAdmin` (staff+owner), a beküldések olvasása szintén;
  a nyilvános beküldés (`create`) a plugin alapja marad.

### 2.5 Pinned Payload/Next ne emeld

Pontos verzió, `^` tilos, lockfile-t ne írd újra.

### 2.6 További, kódból következő tilalmak

| Tilos                                                           | Hol / miért                                                                                                                                                    |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users.purchases` / `accessGrants` admin-pipa                   | field `create/update: () => false`; ajándék a grant-panelen                                                                                                    |
| Hamis paid rendelés ajándékhoz                                  | számlát indítana, duplavásárlást tiltana                                                                                                                       |
| GraphQL visszakapcsolás                                         | megkerülné a jelszó-politikát és a rate-limitet                                                                                                                |
| `console.log`                                                   | `src/lib/logger.ts` — redact-lista                                                                                                                             |
| `any`                                                           | `unknown` + szűkítés                                                                                                                                           |
| Kikommentezett kód                                              | kivétel: `src/scripts/seed.ts` TODO-i                                                                                                                          |
| Orvosi / Ads szöveg átírása a teszt zöldítéséhez                | `docs/agent-feature-map.md`                                                                                                                                    |
| Kineticare-demo deploy                                          | 2026-08-29-től kivezetve                                                                                                                                       |
| Régi kötet nélküli `Postgres` újraindítása                      | törli az adatot                                                                                                                                                |
| Higgsfield koncepció-tükör visszahozása                         | `content/home-images/` csak brand+site                                                                                                                         |
| Új `pages` rekord a `/kurzusok` listához                        | a lista kód-oldal, Search-lock                                                                                                                                 |
| Kézi videó-átmozgatás `videos` → `modules`                      | `npm run kurzus:videok-modulba` — különben a haladás nullázódik                                                                                                |
| `ad_storage` grantedre állítása                                 | `docs/ga4.md`, Shop-sáv zár                                                                                                                                    |
| Google Ads Enable / spend ebből a PRből                         | térkép-only, `docs/agent-feature-map.md`                                                                                                                       |
| A bejövő route-kérés `new Request(request, …)` inputként        | Next 16 Proxy + Node 24 undici = `#state` TypeError, minden REST-írás 500 (#289 → #290); csak a mezőit másold. Őr: `security/next-route-request-proxy.test.ts` |
| Kapcsolati e-mail literál a `src/lib/contact-email.ts`-en kívül | egy feloldó; őr: `kapcsolati-email-feloldo.test.ts`                                                                                                            |
| `SZAKKONYV_URL` kitöltése helykitöltővel                        | `src/lib/szakembereknek.ts`: a tulajdonos még nem adta meg, addig a kártya a `/kapcsolat`-ra visz                                                              |
| Admin-szöveg javítása a `node_modules` fordításában             | a `hu-forditas.ts` plugin fésüli felül, a lánc végén                                                                                                           |

---

## 3. Mentális modell

### 3.1 A hozzáférés három igazsága

```
orders.status = paid          →  pénz + számla + vendég-fiók kötés
users.purchases[]             →  „HOZZÁFÉR-e ehhez a SKU-hoz?" (halmaz)
users.accessGrants[].grantedAt →  „MIKORTÓL ketyeg az óra?"
products.accessDurationDays   →  hány nap (üres/0/negatív = korlátlan)
```

Kiértékelés: `resolveCourseAccess` (`src/lib/course-access.ts`) — tiszta
függvény, DB nélkül. A lookup: `src/lib/course-access-lookup.ts`
(`resolveCourseAccessForUser`, `resolveSingleCourseAccess`).

Szabályok:

- Nincs / 0 / negatív `accessDurationDays` → `unlimited`, `hasAccess: true`.
- Van korlát, de a vásárlás dátuma ismeretlen → **fail-open**
  (`unknown-purchase-date`). Pótlás: `npm run backfill:access-grants` vagy
  a Kurzus ajándékozása panel.
- Van korlát + dátum → `expiresAt = purchasedAt + N×24h`.
  `most >= lejárat` → `expired`.
- Teljes refund után a bizonyított forrás nem jogosít → `revoked`.
- A paid rendelésen **nincs `paidAt` mező** — a gyakorlatban a paid
  rendelés `createdAt` (vagy az `accessGrants.grantedAt`) az óra.

A lejátszó kapuja (`resolvePlayerGate`) négy okot különböztet meg —
hamis okot ne mondj (NN/g Error Message Guidelines):

| `kind`          | Mikor                              | Üzenet-konstans                |
| --------------- | ---------------------------------- | ------------------------------ |
| `expired`       | lejárt óra                         | `accessExpiredMessage`         |
| `lookup-failed` | fail-open / lookup hiba            | `ACCESS_LOOKUP_FAILED_MESSAGE` |
| `grant-pending` | van paid order, még nincs purchase | `ACCESS_GRANT_PENDING_MESSAGE` |
| `not-purchased` | nincs purchase (vagy revoked)      | `ACCESS_NOT_PURCHASED_MESSAGE` |

A `streamAssetId` (Bunny GUID) **nem kerülhet** a nyilvános RSC-payloadba
hozzáférés nélkül: `buildCurriculum(..., { hasAccess: false })` kitörli.
Field-access: `streamAssetReadAccess`. A lejátszó oldalon a lookup-hiba
**fail-closed** (GUID kint marad); a tiszta `resolveCourseAccess` óra
ismeretlen dátumnál fail-open — a kettőt ne keverd.

### 3.2 A fizetési cső (a rendszer szíve)

```
POST /api/checkout/start
  → szerveroldali ár-snapshot (kliens-ár csak eltérés-őr)
  → advisory lock: duplavásárlás + rendelés-létrehozás
  → Barion Payment/Start v2 (Immediate, HUF, hu-HU)  [záron KÍVÜL]
  → redirect a Barionra

POST /api/barion/callback
  → AZONNAL 200 + webhook-events dedup (provider=barion)
  → after() aszinkron: GetPaymentState v4
  → applyBarionStateTransition
       paid: fiók-feloldás → purchases-zár → pending/created → paid
       összeg-assert: GetState Total/Currency = order.totalHufSnapshot
       late-success: cancelled/payment_failed + Succeeded → paid (K5 után)
       refunded → paid TILOS
       paid → cancelled TILOS
  → transitionedToPaid? → onOrderPaid
       → invoice-issue job (order-maintenance queue)
       → visszaigazoló levél (jelszó-link VAGY belépés)

Elveszett callback:
  order-poll task, 5 percenként, ugyanaz a v4 + állapotgép
  + árva-rendelés-lejárat + számla-resweep
  + a Barion által KIFEJEZETT not-found kóddal (NotExistingPaymentId,
    PaymentNotFound; 5xx és 401/403 / auth-kód kivételével bármilyen
    HTTP-státusszal) jelzett, 1 óránál régebbi payment_pending sor →
    cancelled (#260); a callback erre terminális rejected; fék: ha a
    futásban egyetlen GetState sem sikerült, az útvonal-próba dönt (a
    legutóbb frissült, Barion-azonosítós paid rendelés GetState-je,
    futásonként legfeljebb egy hívás): sikeres → lezár; elbukik, vagy
    nincs jelölt, de legalább MAX_LEADING_FAILURES ilyen sor jött → egyik
    sem zárul le (fojtott RIASZTÁS: BARION_ENVIRONMENT / POSKey); nincs
    jelölt és kevesebb sor → lezár; auth/transport megszakítás vagy
    olvashatatlan jelölt → a következő futás dönt
  + a puszta HTTP 404 (Errors tömb nélkül, vagy ismeretlen kóddal)
    'unverified-404': forgatás, függő sornál fojtott RIASZTÁS (a
    late-success scan lezárt soránál csak warn), önmagában SOSEM zár le;
    a callback újrapróbálható marad, a pénztár saját szövegű 503-at ad
    (CHECKOUT_PAYMENT_STATE_UNVERIFIED); a 24 óránál régebbi ilyen
    payment_pending sort az order-poll CSAK akkor zárja le (RIASZTÁS), ha
    ugyanabban a futásban egy MÁSIK GetState sikeres volt, vagy sikeres az
    útvonal-próba; egy késői Succeeded-et a late-success scan csak a
    létrehozástól számított 7 napon belül vesz fel
  + a futás eleji mennyezet (MAX_LEADING_FAILURES) csak a függő lapokat
    állítja meg; a late-success scan saját kerettel fut; auth/transport
    megszakítás után kimarad. A mennyezet-RIASZTÁS futásszintű, óránként
    egy (RUN_LEVEL_ALERT_COOLDOWN_MS, közben warn); a late-success scané
    csak warn, ha a függő lapoké ugyanabban a futásban már döntött, vagy
    ha az útvonal-próba sikeres (a hibák a lezárt sorokra szólnak)
  + csendes bolt, néhány lezárt sor puszta 404-gyel, semmi nem sikerül (a
    mennyezet nem ér el): ha az útvonal-próba is elbukik, óránként egy
    útvonal-gyanú RIASZTÁS (BARION_API_URL / BARION_ENVIRONMENT / POSKey)
```

Ár a checkoutban: a pénztár elküldi a **megjelenített** árat
(`priceHuf`), a szerver a saját `coursePriceHuf`-jával veti össze
(eltérés → 400, pl. ha az akció a lapnyitás és a beküldés között járt
le). A függő Barion-fizetés csak egyező ár- és számlázási snapshot
mellett folytatódik, különben a régi sor lezárul és új fizetés indul
(#289). Döntés: `decidePendingCheckout`
(`src/lib/checkout/pending-payment.ts`).

**A callback-payload önmagában NEM bizonyíték.** Csak a szerver-szerver
v4 GetState. A Barion 15 mp-en belül 200-at vár — ezért a handler nem
vár a GetState-re.

Zár-sorrend: `order:mutate` → email → `purchases:user:<id>`. Külső HTTP
a záron belül tilos. `withAdvisoryLock` (`src/lib/advisory-lock.ts`) +
`withUserPurchasesLock` (`src/lib/user-purchases-lock.ts`).

Barion státusz → rendelés (`mapBarionPaymentStatus`):

| Barion                                                        | Nálunk                                   |
| ------------------------------------------------------------- | ---------------------------------------- |
| `Succeeded`                                                   | `paid`                                   |
| `Canceled` / `Expired` / `Failed`                             | `cancelled`                              |
| `Prepared` / `Started` / `InProgress` / `Waiting`             | `payment_pending`                        |
| `Reserved` / `Authorized` / `PartiallySucceeded` / ismeretlen | `payment_pending` + warn (SOHA nem paid) |

A `Failed` szándékosan `cancelled`, nem `payment_failed`: az
`OrderPaymentState` csak három érték, a negyedik enum-migráció lenne.

Vendég: a checkout `guest: { email, name }`. Fiók a paid ágon jön létre
(`resolveOrderCustomer`). `passwordSetupPending=true` → a levél
jelszó-beállító linket küld (7 napos token, W14). Bejelentkezett
sessionnél a `guest` mező figyelmen kívül.

Duplavásárlás: bejelentkezve „már megvásároltad" + lejátszó. Vendég
idegen e-mailre ugyanaz a 409, orákulum nélkül (W4).

### 3.3 Számlázás

`szamlaKulsoAzon = rendelésszám` — idempotens. A paid után az
`invoice-issue` job. Teljes refund → `storno-issue`. Részleges refund →
`corrective-invoice-issue` (helyesbítő, negatív tétel,
`helyesbitettSzamlaszam`). Max 5 kísérlet (Számlázz A14). A számla-
állapotmezők `denyFieldWrite` — staff PATCH tilos (K5).

Üres `SZAMLAZZ_AGENT_KEY` = számlázás kikapcsolva, a fizetés ettől megy.
Bekapcsolt számlázásnál `SZAMLAZZ_AFAKULCS` (`27` vagy `AAM`) kötelező
érték, ha megvan adva — hibás érték már bootkor megáll. Az Agent URL
**záró perjellel** kell (`https://www.szamlazz.hu/szamla/`) — nélküle a
POST GET-té válik, 53-as hiba. Storno-t a job **ne** retry-zza vakon
(dupla stornó); helyesbítő timeout/5xx retry engedett.

### 3.4 Tartalom-modell

| Amit a látogató lát                                            | Honnan jön                                                                                                                                                           |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kezdőlap `/`                                                   | `pages` slug `kezdolap` + `layout` blokksor                                                                                                                          |
| `/szolgaltatasok`, `/rolunk`, jogi                             | `pages` + opcionális `layout`                                                                                                                                        |
| Gyökér tünet-hub `/keztoalagut-szindroma` stb.                 | `pages` + a forrás-cikk törzse                                                                                                                                       |
| Tudástár lista `/blog`                                         | `posts` published                                                                                                                                                    |
| Cikk `/blog/{slug}`                                            | `posts`; ha a hub publikált → 308 a gyökérre                                                                                                                         |
| Kurzuslista `/kurzusok`                                        | `products` ahol `status === 'published'` és nem `unlisted` (`DISCOVERABLE_COURSES_WHERE`, `src/lib/course-discovery.ts`)                                             |
| Kurzusoldal                                                    | `products` slug (vagy régi id → 308); élő akcióban az akciós sablon (`PromoCourseView`)                                                                              |
| `/kapcsolat`                                                   | `pages` slug `kapcsolat` szekciósora (dedikált route)                                                                                                                |
| `/szakembereknek`                                              | `pages` slug `szakembereknek` (Cím, Rövid bevezető, szekciósor, jellemzően `offerCards`); rekord vagy látható szekció nélkül kódtartalék (`szakembereknekAlapBlokk`) |
| Menü                                                           | `menus` collection + kódbeli „Kurzusok" első tétel; `visible=false` vagy `unlisted=true` sor kimarad                                                                 |
| Tudástár látható-e                                             | a `/blog` célú menüpontok (lásd 8. szakasz, Tudástár-kapcsoló)                                                                                                       |
| Kapcsolati e-mail (lábléc, 404, JSON-LD, llms, levél Reply-To) | a `kapcsolat` oldal első látható Időpontkérő szekciójának e-mail-mezője; tartalék `KAPCSOLATI_EMAIL_TARTALEK`                                                        |
| Kezdőlapi videó két beúszó felirata                            | `filmHero` blokk `captions` csoportja; üres mező = beépített szöveg (`src/lib/film-captions.ts`)                                                                     |
| Fríz négy íve, „Kurzusaink” három fotója                       | `about.frieze.photo1–4`, `courseCards.scenePhotos.left/middle/right`; üres hely = beépített fotó (`src/lib/kep-helyek.ts`), kivágás a kép fókuszpontjából            |
| Kapcsolat / hírlevél / időpont                                 | form-builder `forms` + `form-submissions`                                                                                                                            |

**Két státusz, ne keverd:**

- Payload drafts `_status` (`draft` / `published`) — a Piszkozat/Közzététel
  gomb. Verzió-végpontok staff/owner (`readVersions`).
- Saját `status` select a pages/posts/products-on. A **bolt és a
  storefront ezt nézi**. A kettőt `syncStatusFromDraftStatus` tartja
  egyben. A products `status` címkéje szándékosan „Megjelenés a
  weboldalon", mert a szerkesztő a felső „Állapot: Közzétett"-nek hitt,
  és a kurzus `status=NULL` miatt nem jelent meg.

A kurzus `status`: `draft` | `published` | `archived`. Archived nem
listázódik, de a meglévő vevő a közvetlen linken tovább nézi.

Ár: `priceInHUF` + `priceInHUFEnabled`. Ingyenes **kizárólag**
`priceInHUFEnabled === false`. A NULL pipa hiányos konfiguráció, nem
ingyenes — „Megveszem ár nélkül" tilos (`isFreeCourse` / `isPaidCourse`).

Akció (WP58, WP63): az „Akciós megjelenés” mezőcsoport (`promoEnabled`,
`promoStart`, `promoEnd`, `promoPriceHuf`). Az `Ár` mező a **rendes**
ár; az időablakban a vevő az akciós árat fizeti, utána magától a
rendeset, visszaírás nélkül. A fizetendő árat egyetlen helyen a
`coursePriceHuf` (`src/lib/courses.ts`) számolja, az akció-döntést a
`resolveCoursePromo` / `isCoursePromoDisplayed`
(`src/lib/course-promo.ts`). A `promoOriginalPriceHuf` rejtett örökség.
Doksi: `docs/akcios-kurzus-2026-09-20.md`.

`unlisted` (#285): felfedezhetőségi kapcsoló, **nem** hozzáférés-védelem.
Kimarad a listákból, ajánlókból, menüből, sitemapből, a lap noindex,
follow; közvetlen linken megnyitható és megvásárolható. Doksi:
`docs/course-unlisted.md`.

### 3.5 Tananyag két szerkezete

`products.modules` (fejezetek → leckék: videó / `szoveg` / `link`) a
régi lapos `products.videos` **mellett** él. Egyesítés:
`buildCurriculum` (`src/lib/curriculum/curriculum.ts`). Ha van legalább
egy modul-lecke, a régi lista elrejtőzik. Átemelés csak
`npm run kurzus:videok-modulba` — kézi másolás nullázza a
`course-progress` sorokat, mert a `videoRef` a stabil lecke-id.

A lejátszó bemenete a curriculum, nem a nyers mezőpár.

---

## 4. Hogyan dolgozz ezen a repón

### 4.1 Branch, commit, PR

- Ág: `feat/<ticket-id>-<rovid-nev>` vagy `fix/<ticket-id>-<rovid-nev>`
  (kisbetű, kötőjel, ékezet nélkül). Cloud Agenten a kért
  `cursor/<nev>-836d` sablon a futásé.
- Commit: magyarul vagy angolul, scope-pal. Idézőjelet tartalmazó üzenet
  töri a `git commit -m`-et — `git commit -F -` + heredoc, utána
  `git status`.
- Stage után typecheck a **stage-elt** tartalomra (CLAUDE.md 20b):
  `git add` → typecheck → `git status --short` üres a stage-elt fájlokra
  → commit.
- PR: mit/miért, érintett tilos zóna, ellenőrzés módja. Titok, `.env*`,
  kézi migráció, `confirmOrder`, `any` → automatikus elutasítás.
- Merge után a munka NEM kész: GitHub CI (`ci.yml` + `gitleaks.yml`) és
  Railway `Kineticare` (tényleges Next build, migráció a start-logban,
  `GET /admin`).

### 4.2 Parancsok

```bash
nvm use                         # Node 24.20.0
cp .env.example .env            # töltsd ki; .env-t ne commitold
node scripts/install-reviewed-dependencies.mjs
./node_modules/.bin/payload migrate   # friss DB-nél, npm run dev ELŐTT
npm run dev                     # http://localhost:3000, admin: /admin
npm run seed                    # idempotens; kezdőlap-szekciósort nem ír felül
SEED_SCOPE=kezdolap npm run seed
```

Kapuk (a CI is ezt futtatja):

```bash
npm run typecheck
npm run test                    # vitest run; fókusz: npx vitest run src/__tests__/foo.test.ts
npm run lint
npm run build
```

További scriptek: lásd a 11. szakaszt.

### 4.3 Tesztelés

- Include: `src/**/*.test.ts` / `src/**/*.test.tsx` (kb. 480 fájl, a
  többség `src/__tests__/` alatt, benne a `security/` almappa) plusz
  `handover/**/*.test.ts` (a küldhető őr). Alias `@/*` → `src/*`.
  DB-kapus fájlok CI-ben dobnak, ha nincs Postgres; helyben skip.
- **Tesztből SOSEM megy ki valódi hálózat.** HTTP-t injektálj
  (`postXml`, `queryByKulsoAzon`); `fetch`-et `vi.stubGlobal` +
  `afterEach(vi.unstubAllGlobals)`. Ahol hívásnak nem szabad futnia:
  hangosan dobó mock.
- Komponens: `renderToStaticMarkup` (oxc automatic JSX, pragma nélkül).
- Új viselkedéshez fókuszált teszt.
- Teszt írása, módosítása, átnézése vagy átfésülése előtt:
  `.claude/skills/teszt-audit/SKILL.md` (írási kapu, ellenpróba,
  megtartási mérce; alrendszer-kampányhoz a `CAMPAIGN.md`).

### 4.4 Felületi munka kötelező menete

1. Olvasd `.claude/skills/termektervezes/SKILL.md`.
2. Olvasd `docs/ertekesitesi-ux-skill.md` (M1–M8, sticky-nav, skála).
3. CTA: `src/lib/cta-vocabulary.ts` + `docs/ui-sztenderdek.md` §3.2.
   Új felirat csak a szótár bővítésével.
4. Legalább **két külső forrás** (NN/g, Baymard, GOV.UK, Apple HIG,
   Material 3, Polaris, Carbon, WCAG 2.2 **sikerkritérium-számmal**).
5. Mérj, ne becsülj: kontraszt, 44×44 érintőcél, sorhossz, 320 px reflow.
6. Natív magyar, töltelék gondolatjel nélkül. Cselekvő gomb E/1
   („Megveszem"), navigáció E/2. Ugyanaz a cselekvés = ugyanaz a szó
   (WCAG 3.2.4).
7. Nincs dark pattern: nincs visszaszámláló, kamu-készlet, bűntudatos
   elutasító gomb.

### 4.5 Napló, request ID, hibaüzenet

- Logger: `src/lib/logger.ts`. Redact: `email`, `password`, `token`,
  `poskey`, `apikey`, kártyamezők, stb. Az e-mailt maszkolva, **más**
  kulcson (`cimzett`, `identifier`) — `maskEmail`.
- Request ID: `src/middleware.ts` → `x-request-id`; handler:
  `getRequestId`.
- Felhasználói (UI + API) hiba **magyarul**. Technikai részlet csak a
  naplóba.

### 4.6 Melyik őrtesztet futtasd

A CI az egész `npm run test`-et futtatja. Helyben a tartomány őrét
add ki először — ezek némán zöld CI mellett is védik a tilos zónát:

| Téma                                                  | Teszt                                                                                                                                                                                  |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `confirmOrder` / plugin `/payments/*`                 | `src/__tests__/ecommerce-payments-guard.test.ts`                                                                                                                                       |
| Migráció immutábilis + séma-drift                     | G1–G4: `schema-drift-guard`, `schema-config-sync`, `migration-immutability`, `migration-integrity`                                                                                     |
| Őrfájlok léteznek                                     | `guard-files-integrity.test.ts`                                                                                                                                                        |
| Titok nem a naplóban                                  | `security/seed-secret-logging.test.ts`, `security/logger-redact.test.ts`                                                                                                               |
| Cikk-CTA / Craft / Shop zár                           | `tudastar-cikkoldal.test.tsx`, `craft-lane-zarak.test.tsx`, `shop-lane-zarak.test.tsx`                                                                                                 |
| CTA-szótár / gondolatjel                              | `cta-vocabulary-guard.test.ts`                                                                                                                                                         |
| Örökölt URL                                           | `orokolt-url-atiranyitasok.test.ts`                                                                                                                                                    |
| Exact Node / lockfile / `npx payload`                 | `ci-platform-security-guard.test.ts`                                                                                                                                                   |
| Route-kérés nem lehet `new Request()` input (Node 24) | `security/next-route-request-proxy.test.ts`, `security/payload-rest-body-limit.test.ts`                                                                                                |
| onInit csak friss telepítésen ír                      | `onit-seed-friss-telepites.test.ts`                                                                                                                                                    |
| Admin fordítás / menücsoport / kontraszt              | `admin-forditas.test.ts`, `admin-groups.test.ts`, `admin-tema-kontraszt.test.ts`                                                                                                       |
| Szerkesztői réteg                                     | `szekcio-melylink.test.ts`, `section-row-label.test.ts`, `szerkeszto-szalag.test.tsx`, `ket-lap-figyelo.test.tsx`, `szekcio-horgony-igazito.test.tsx`, `kurzus-forras-szalag.test.tsx` |
| Tudástár-kapcsoló                                     | `tudastar-kapcsolo.test.ts`, `tudastar-lathatosag.test.ts`, `tudastar-link-szuro.test.tsx`                                                                                             |
| Filmfeliratok / fotóhelyek                            | `film-captions.test.ts`, `kep-helyek.test.tsx`                                                                                                                                         |
| Kapcsolati e-mail / kötött webcímek                   | `kapcsolati-email-feloldo.test.ts`, `kotott-cimek.test.ts`                                                                                                                             |
| Content-job szabályok                                 | `apply-owner-content*.test.ts`, `owner-content-*.test.ts`, `*-kitoltes.test.ts`                                                                                                        |
| Kézikönyv + mutatók megmaradnak                       | `ugynok-kezikonyv.test.ts`                                                                                                                                                             |

---

## 5. Storefront útvonalak

A `docs/informacios-architektura.md` 2026-08-16-i leltár. Azóta változott:
van `AccountNav` (kijelentkezve `/belepes`, bent fiókmenü), a 404 nem
üres (`global-not-found.tsx` + `NotFoundView`), a „Kurzusok" a menü
első sima tétele (WP36), van `/szakembereknek` (WP49, 2026-09-23 óta
CMS-ből), és a lábléc, a 404 és a `(frontend)/error.tsx` hibabejelentő
gombot visel (`FeedbackTrigger`, WP65). Az alábbi a **mai** térkép.

### 5.1 Nyilvános

| Útvonal                              | Fájl                             | Mi ez                          | Adat                                                                                                                                                                     |
| ------------------------------------ | -------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/`                                  | `(frontend)/page.tsx`            | Kezdőlap, `HomeView`           | `getHomePage` + products/posts/testimonials; `force-dynamic`                                                                                                             |
| `/kurzusok`                          | `kurzusok/page.tsx`              | Lista, `?kategoria=`           | `status===published`, `unlisted` kiszűrve a limit előtt; Search-lock keywords; a lapfej kódban van                                                                       |
| `/kurzusok/[slug]`                   | `kurzusok/[slug]/page.tsx`       | Értékesítési oldal             | slug vagy numerikus id → 308 kanonikusra; UTM megmarad; élő akciónál `PromoCourseView`; `unlisted` → noindex, follow; előnézetben forrás-szalagok (`KurzusForrasSzalag`) |
| `/blog`                              | `blog/page.tsx`                  | Tudástár lista                 | published posts; kikapcsolt Tudástárnál noindex                                                                                                                          |
| `/blog/[slug]`                       | `blog/[slug]/page.tsx`           | Cikk                           | hub publikált → 308 `/{hub}`; CTA: `PostCourseCta`; kikapcsolt Tudástárnál noindex                                                                                       |
| `/blog/kategoria/[slug]`             | `blog/kategoria/[slug]/page.tsx` | Szűrt lista                    | üres kategória: noindex, robots.txt NEM tiltja                                                                                                                           |
| `/kapcsolat`                         | `kapcsolat/page.tsx`             | CMS layout (`RenderBlocks`)    | Élő lead: időpontkérő blokk. A `ContactForm` **nincs** a lapon (őr: `kapcsolat-idopontkeres.test.tsx`). Üres layout = csak H1.                                           |
| `/szakembereknek`                    | `szakembereknek/page.tsx`        | Képzés vagy szakkönyv választó | `pages` slug `szakembereknek`; kódtartalék: `src/lib/szakembereknek.ts`; a rekordot a content-job `szakembereknek-oldal` szabálya hozza létre, ha hiányzik               |
| `/[slug]`                            | `[slug]/page.tsx`                | CMS-oldal / hub                | `pages`; hub: forrás-cikk élménye; kikapcsolt Tudástárnál a hub noindex, és a Tudástár-linkek kiszűrve                                                                   |
| `/adatvedelem` `/aszf` `/impresszum` | `[slug]`                         | Jogi                           | lábléc                                                                                                                                                                   |

Kitüntetett page-slug: `kezdolap` → a `/` viszi, nem a `/kezdolap`
(`HOME_PAGE_SLUG`, `src/lib/content-slugs.ts`). A kódhoz kötött
webcímek teljes listája (kezdőlap, `kapcsolat`, `szakembereknek`, a
három jogi oldal, a 8 hub és a párjuk, az időpontkérős cikkek) és hogy
mi történik átnevezéskor: `src/lib/admin/kotott-cimek.ts`
(`kotottWebcimek`); az admin ezt a `KotottWebcimNotice`-ban mutatja.

### 5.2 Tranzakció

| Útvonal                    | Fájl                        | Megjegyzés                                                                                                                                   |
| -------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `/kosar`                   | `kosar/page.tsx`            | localStorage kosár (`kineticare-cart-v1`); noindex                                                                                           |
| `/penztar?termek={id}`     | `penztar/page.tsx`          | vendég is; ingyenes → kurzusoldali űrlap, nem checkout                                                                                       |
| `/fizetes/koszonom?order=` | `fizetes/koszonom/page.tsx` | Barion-visszatérés; **cím nem állíthat sikert**. Poll: `GET /api/orders/{n}/status` — csak belépett + saját rendelés (idegen 404, anon 401). |
| `/sikertelen`              | `sikertelen/page.tsx`       | sikertelen fizetés                                                                                                                           |

### 5.3 Auth és fiók

| Útvonal                 | Fájl                            | Hozzáférés                                            |
| ----------------------- | ------------------------------- | ----------------------------------------------------- |
| `/belepes`              | `belepes/page.tsx`              | **indexelhető** (márka-keresés); sitemapben nincs     |
| `/regisztracio`         | `regisztracio/page.tsx`         | indexelhető, sitemapben nincs                         |
| `/elfelejtett-jelszo`   | `elfelejtett-jelszo/page.tsx`   | noindex                                               |
| `/jelszo-visszaallitas` | `jelszo-visszaallitas/page.tsx` | token; noindex                                        |
| `/belepes-atallas`      | `belepes-atallas/page.tsx`      | átköltöztetett vevő; noindex; „újra fizetni NEM kell" |
| `/fiok`                 | `fiok/page.tsx`                 | belépett; 307 → `/belepes?returnUrl=`                 |
| `/kurzusaim`            | `kurzusaim/page.tsx`            | belépett; megvett lista                               |
| `/kurzusaim/[id]`       | `kurzusaim/[id]/page.tsx`       | numerikus product id; gate + curriculum; GUID szűrve  |

`returnUrl` sanitizálás: `src/lib/return-url.ts`. Jelszó után egy SKU →
lejátszó, különben `/kurzusaim` (`postAuthLibraryOrPlayerHref`).

### 5.4 Admin, gépi, 404

| Útvonal                                 | Fájl                                                                                      | Megjegyzés                                                                                                      |
| --------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `/admin/[[...segments]]`                | `(payload)/admin/`                                                                        | Payload; staff/owner                                                                                            |
| `/admin/statisztika`                    | custom view                                                                               | `StatisticsView`; kapu a nézetben                                                                               |
| `/admin/videok`                         | custom view                                                                               | `BunnyLibraryView`                                                                                              |
| `/admin/webanalitika`                   | custom view                                                                               | `WebAnalyticsView`                                                                                              |
| `/admin/kezdolap`                       | custom view                                                                               | `KezdolapNezet`: a `kezdolap` oldal szerkesztőjére irányít                                                      |
| `/admin/kezdolap-video`                 | custom view                                                                               | `VideoSzovegeiNezet`: a kezdőlap szerkesztője a nyitó videó szekció mélylinkjével                               |
| `/next/preview`                         | `(frontend)/next/preview`                                                                 | staff/owner; draft cookie; `pages` / `posts` / `products` (`PREVIEW_COLLECTIONS`)                               |
| `/next/exit-preview`                    | `next/exit-preview`                                                                       | draft ki                                                                                                        |
| `/sitemap.xml`                          | `src/app/sitemap.ts`                                                                      | **csak** `src/app/` gyökérből; `force-dynamic`; kikapcsolt Tudástárnál a cikkek, kategóriák és hubok kimaradnak |
| `/robots.txt`                           | `src/app/robots.ts`                                                                       | AI-botok engedve; fiók/tranzakció tiltva                                                                        |
| `/llms.txt` `/llms-full.txt`            | `src/app/llms*.txt/route.ts`                                                              | LLM-olvasó; kapcsolati e-mail a közös feloldóból                                                                |
| `/manifest.webmanifest`, ikonok, OG-kép | `src/app/manifest.ts`, `icon.svg`, `apple-icon.png`, `favicon.ico`, `opengraph-image.tsx` | ikonforrás: `src/scripts/generate-app-icons.ts`; az admin is ezeket használja                                   |
| nem illeszkedő URL                      | `src/app/global-not-found.tsx`                                                            | `experimental.globalNotFound: true` kötelező                                                                    |
| render-hiba                             | `(frontend)/error.tsx`, `src/app/global-error.tsx`                                        | a storefront hibaoldala (`error.tsx`) hibabejelentő gombbal; a `global-error.tsx` a gyökér-layout hibájára      |

A `robots.ts` / `sitemap.ts` a `(frontend)` groupból **némán kimaradna**.

`NEXT_PUBLIC_ALLOW_INDEXING !== 'true'` → middleware `X-Robots-Tag:
noindex…` (Railway-host védőháló a cutoverig).

### 5.5 Örökölt URL-ek

Egy forrás: `src/lib/legacy-redirects.ts`. Három sors:

- **Változatlan** (`LEGACY_UNCHANGED_PATHS`): `/`, `/szolgaltatasok`,
  `/rolunk`, `/kapcsolat`, `/aszf`, `/adatvedelem`, `/impresszum` —
  ezekre redirect-szabály tilos (elnyelné az oldalt).
- **308** (`LEGACY_REDIRECTS`): pl. `/kezrehab` → otthoni program,
  `/kezrelax` → SOS, régi id-s kurzus-URL-ek. Build-időben sül a
  `next.config.ts` `redirects()`-ébe — újrabuild kell.
- **410 Gone**: spam-posztok, a middleware-ben (a Next `redirects()`
  nem tud 410-et).

Őr: `src/__tests__/orokolt-url-atiranyitasok.test.ts`.
Doksi: `docs/orokolt-url-atiranyitasok.md`.

### 5.6 Gyökér-hubok

`src/lib/tudastar/hub-oldalak.ts` — 8 hub. A 9. (vállfájdalom) szándékosan
hiányzik, amíg nincs lektorált cikk.

| Gyökér                          | Forrás-cikk                    | Markdown          |
| ------------------------------- | ------------------------------ | ----------------- |
| `/keztoalagut-szindroma`        | `keztoalagut-szindroma`        | `docs/cikkek/2-…` |
| `/inhuvelygyulladas`            | `inhuvelygyulladas`            | `7-…`             |
| `/teniszkonyok`                 | `teniszkonyok`                 | `3-…`             |
| `/csuklo-es-kezfajdalom`        | `csuklo-es-kezfajdalom`        | `5-…`             |
| `/kez-zsibbadas`                | `miert-zsibbad-a-kezem`        | `1-…`             |
| `/pattano-ujj`                  | `pattano-ujj`                  | `4-…`             |
| `/csuklotores-utani-gyogytorna` | `csuklotores-utani-gyogytorna` | `6-…`             |
| `/befagyott-vall`               | `befagyott-vall`               | `8-…`             |

Publikált hub → `/blog/{cikk}` 308 a gyökérre, a cikk kiesik a
sitemapből. Import: `npm run import:hubok`, publikálás
`OWNER_HUB_PUBLISH=igen`. Az Ads final cutover kézi, a fiókban.

A gyökér 404-e **nem** CI-invariáns (Ads-kapu). Részlet:
`docs/agent-feature-map.md`.

A hub két dokumentum: az Oldal a publikálási kapcsoló és a metaadat
gazdája, a látható lap a Blogbejegyzés cikkélménye. A közös
SEO-feloldólánc: `src/lib/hub-seo.ts`. Kikapcsolt Tudástárnál (8.
szakasz) a hub noindex és kimarad a sitemapből, a menüből és a
Tudástár-linkekből.

Tiltott hub-slugok: `HUB_TILTOTT_SLUGOK` (kezdolap, szolgáltatások,
kurzusok, kezrehab, kezrelax, kosar, …).

### 5.7 Kurzus-CTA állapotgép

Egy gép, három felület (PDP, kosár, pénztár). Forrás:
`resolveCourseCta` (`src/lib/courses.ts`). Második gépet ne írj.

| `kind`        | Felirat               | Cél                                    | Mikor                                          |
| ------------- | --------------------- | -------------------------------------- | ---------------------------------------------- |
| `purchased`   | `course-start`        | `/kurzusaim/{id}`                      | élő hozzáférés                                 |
| `archived`    | nincs gomb            | —                                      | `status === 'archived'`                        |
| `free`        | `Elindítom ingyen`    | kurzusoldali űrlap, **nem** `/penztar` | `isFreeCourse` (`priceInHUFEnabled === false`) |
| `buy`         | `Megveszem a kurzust` | `/penztar?termek={id}`                 | `isPaidCourse`                                 |
| `unavailable` | nincs gomb            | —                                      | hiányos ár / nem published                     |

A NULL `priceInHUFEnabled` **nem** ingyenes.

### 5.8 Pénztár kapuk (UI, nem néma 400)

`penztar/page.tsx`: hiányzó/unpublished → kurzuslista; archived → „nem
vásárolható"; ingyenes → `FREE_COURSE_NOT_CHECKOUT_TEXT`; nem fizetős →
`UNAVAILABLE_COURSE_NOTE`. Submit: kötelező `billing` + két 45/2014
lemondó pipa + ÁSZF (`src/lib/checkout/form-submission.ts`). Függő
fizetés: `decidePendingCheckout` (`resume` / `already-paid` /
`cancel-and-restart` / `wait-no-payment-id` / `wait-not-found` /
`unverified-not-found` / `barion-unavailable`); a definitív not-found
kód (NotExistingPaymentId, PaymentNotFound) a fizetési ablakon túl és az
eltérő ár- vagy számlázási snapshot `cancel-and-restart`; a puszta 404
`unverified-not-found` (503, „legfeljebb egy nap" + info@kineticare.hu,
a sort az order-poll zárja le).

---

## 6. API-végpontok

A saját REST a `(frontend)/api/` alatt van, hogy a storefront originjén
éljen. A Payload catch-all a `(payload)/api/[...slug]`.

### 6.1 Saját storefront API

| Metódus + út                             | Handler                                               | Ki                           | Mit tudj                                                                                                                                                                                                                                                                     |
| ---------------------------------------- | ----------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/checkout/start`               | `lib/checkout/route-handler.ts` → `start-checkout.ts` | session vagy vendég          | ár csak szerver; same-origin; rate `checkout-start` 10/10p                                                                                                                                                                                                                   |
| `POST /api/barion/callback`              | `lib/barion-callback/`                                | Barion                       | azonnali 200+dedup; **nincs** globális IP-limit; ismeretlen GUID: `barion-callback-unknown` 20/10p                                                                                                                                                                           |
| `GET /api/stream-token`                  | `lib/stream/route-handler.ts`                         | belépett vevő                | `?productId=&videoId=`; 401/403/404/409/429/503 magyarul; `Cache-Control: no-store`; rate 60/perc/user. **GET, nem POST.**                                                                                                                                                   |
| `POST /api/course-progress/mark-watched` | `lib/course-progress/route-handler.ts`                | belépett vevő                | `{ productId, videoRef }`; `videoRef` stabil, nem sorszám; rate 60/perc                                                                                                                                                                                                      |
| `GET /api/orders/{orderNumber}/status`   | `lib/checkout/order-status-handler.ts`                | belépett, **saját** rendelés | `{ status, productId, totalHufSnapshot, currency }` + opcionális `paymentReviewRequired`. Idegen szám → 404.                                                                                                                                                                 |
| `POST /api/free-course/request`          | `lib/free-course/route-handler.ts`                    | nyilvános                    | név+email; honeypot; IP 5/10p + email 3/10p; first-user bootstrap elutasítva; 200 nem árulja el, létrejött-e a fiók                                                                                                                                                          |
| `POST /api/visszajelzes`                 | `lib/feedback/route-handler.ts`                       | nyilvános                    | hibabejelentő doboz (WP65); same-origin, törzsplafon, honeypot, rate `visszajelzes` 5/10p; szerver-szerver PostHog `site_feedback` (`lib/feedback/posthog-capture.ts`, 5 mp timeout, hozzájárulás nélkül is, anonim azonosítóval) + Railway-napló. Név- és e-mail-mező nincs |
| `POST /api/users/reset-password`         | `lib/security/payload-rest-post.ts`                   | nyilvános                    | politika + rate; árnyékolja a Payload REST-et                                                                                                                                                                                                                                |
| `GET /next/preview`                      | `lib/preview/route-handler.ts`                        | staff/owner                  | draft cookie                                                                                                                                                                                                                                                                 |
| `GET /next/exit-preview`                 | `lib/preview/exit-preview.ts`                         | —                            | draft ki                                                                                                                                                                                                                                                                     |

### 6.2 Admin API (staff/owner, némelyik owner-only)

| Metódus + út                                  | Mit                                                                              |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| `POST /api/admin/grant-purchase`              | Ajándék; ugyanaz a lock; új ajándéknál **kötelező** pozitív `accessDurationDays` |
| `POST /api/admin/orders/{orderNumber}/refund` | Owner-only; Barion refund + stornó/helyesbítő                                    |
| `GET /api/admin/orders/{orderNumber}/refund`  | Recovery státusz                                                                 |
| `GET /api/admin/course-progress`              | Kurzus-szintű haladás-stat                                                       |
| `GET /api/admin/user-progress`                | Egy user haladása                                                                |
| `GET /api/admin/bunny-videos`                 | Védett/publikus tár lista; rate `bunny-videos` 20/perc                           |
| `GET /api/admin/bunny-videos/{guid}`          | Videó részlet                                                                    |
| `POST /api/admin/bunny-videos/{guid}/preview` | Előnézet-token                                                                   |
| `POST /api/admin/bunny-uploads` + `/sign`     | TUS feltöltés a védett tárba                                                     |

A route-fájlok vékonyak: `getPayload` + factory. A logika `src/lib/`-ben
van, injektálható, unit-tesztelt. A `@payload-config` alias a vitestben
nem mindig oldódik — ezért relatív import a route-okon.

### 6.3 Payload REST catch-all

`src/app/(payload)/api/[...slug]/route.ts`:

- Minden POST a `createProtectedPayloadPost`-on (IP rate-limit + login
  CSRF + reset-árnyék).
- POST / PATCH / PUT nem-multipart törzse 2 MiB fölött **413**
  (`withPayloadRestBodyLimit`, `src/lib/security/payload-rest-body-limit.ts`,
  #289), mert a Payload a törzset az access-ellenőrzés előtt, korlát
  nélkül olvasná. POST-nál a CSRF- és a keret-réteg mögött fut. A
  multipart (admin-mentés, feltöltés) átmegy, azt az
  `upload.limits.fileSize` (10 MB, `abortOnLimit`) védi.
- **Node 24-csapda (#290):** a Next 16 a route handlernek Proxyba
  csomagolt kérést ad, az undici `Request`-konstruktora pedig a bemenet
  privát `#state` mezőjét olvassa. `new Request(request, …)` így
  TypeError, azaz 500 minden REST-írásra (belépés, regisztráció,
  űrlap, profilmentés). Az új kérés mindig az URL-ből és explicit
  mezőkből épül (metódus, fejlécek, törzs, `signal`); ugyanez a
  course-files `HEAD → GET` ágán (`src/access/privateResponse.ts`).
- `X-Payload-HTTP-Method-Override: GET` a relationship-listázás — ez NEM
  regisztráció, GET-ként kell kezelni, különben az admin 5 megnyitás után
  piros.
- Course-file válasz: `withPrivateCourseFileResponse`.
- Ezen megy: `POST /api/users` (regisztráció), `forgot-password`,
  `form-submissions`, carts, stb.

GraphQL **ki** (`graphQL.disable: true`). A `/graphql` robots-tiltás
védőháló.

### 6.4 Rate-limit keretek

`src/lib/security/rate-limit.ts` — in-memory Map, replikánként külön.
`railway.json` `numReplicas: 1`, ezért elég. IP: `resolveClientIp`;
`cf-connecting-ip` csak `TRUST_CF_CONNECTING_IP=true` mellett.

| Keret                              | Limit            |
| ---------------------------------- | ---------------- |
| `registration`                     | 5 / 10 perc      |
| `password-forgot` + `-email`       | 3 / 10 perc      |
| `password-reset`                   | 5 / 10 perc      |
| `login` + `login-email`            | 10 / 10 perc     |
| `checkout-start`                   | 10 / 10 perc     |
| `form-submission`                  | 5 / 10 perc      |
| `visszajelzes`                     | 5 / 10 perc      |
| `stream-token` / `course-progress` | 60 / perc / user |
| `bunny-videos`                     | 20 / perc        |
| `barion-callback-unknown`          | 20 / 10 perc     |
| `cart-write`                       | 30 / 10 perc     |

A valódi Barion-callback **nincs** az útvonal-táblában.

Same-origin a sütis saját POST-okon: `src/lib/security/same-origin.ts`.
Hiányzó Origin ÉS Referer: átengedés (curl/teszt). Böngészős POST-on az
Origin mindig megy.

---

## 7. Payload: collectionök és pluginok

### 7.1 Saját collectionök (`src/collections/`)

| Slug              | Fájl                | Csoport                               | Lényeg                                                                                                                                                                                                                                        |
| ----------------- | ------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`           | `Users.ts`          | Felhasználók (megjelenítve: „Fiókok”) | role, purchases (írás zárt), accessGrants (írás zárt), billing, `passwordSetupPending`, `migrationNoticeSentAt`; első user csak érvényes bootstrap-tokennel owner, enélkül a fiók nem jön létre; reset-token mezők olvasás-zárral             |
| `media`           | `Media.ts`          | Tartalom                              | alt kötelező; webp (q80), méretek 320–1920 + og 1200×630; max 10 MB; `PAYLOAD_MEDIA_DIR`; fókuszpont a kivágáshoz; „közös kép” figyelmeztetés (`kozosKepFigyelmeztetes` UI-mező)                                                              |
| `pages`           | `Pages.ts`          | Tartalom                              | drafts + saját status; `layout` blokksor; preview; lista: 25/oldal (10/25/50/100), „Mi ez” oszlop (`PageKindCell`), fő oldalak gyorslinkjei; tájékoztatók: `KotottWebcimNotice`, `HubPageNotice`, `HomePageEditNotice`, `ElonezetAllapot`     |
| `posts`           | `Posts.ts`          | Tartalom                              | ugyanez; hero, author, related, categories                                                                                                                                                                                                    |
| `menus`           | `Menus.ts`          | Navigáció                             | max 2 szint; type-konzisztens cél; `visible`; `unlisted` („rejtett link”: aktív, de nincs a navigációban; `MenuUnlistedLink` mutatja a közvetlen címet); Tudástár-hatás és almenü-jelzés UI-mezők; mentés/törlés üríti a `MENUS_CACHE_TAG`-et |
| `categories`      | `Categories.ts`     | Tartalom                              | blog vagy termék; slug a címből                                                                                                                                                                                                               |
| `testimonials`    | `Testimonials.ts`   | Tartalom                              | csak VALÓS idézet; `visible` + `featured`; shortQuote ≤ 260; „Hol látszik” oszlop (`TestimonialPlacementCell`, `src/lib/admin/velemeny-helye.ts`)                                                                                             |
| `course-progress` | `CourseProgress.ts` | Webshop                               | user+product+videoRef unique; írás csak szerver; delete staff                                                                                                                                                                                 |
| `course-files`    | `CourseFiles.ts`    | Webshop                               | privát melléklet; fájlcsere tilos (beforeOperation)                                                                                                                                                                                           |
| `webhook-events`  | `WebhookEvents.ts`  | Rendszer                              | (provider, externalId) unique; dedup                                                                                                                                                                                                          |
| `audit-logs`      | `AuditLogs.ts`      | Rendszer                              | owner-only read; rendszer ír                                                                                                                                                                                                                  |
| `refund-intents`  | `RefundIntents.ts`  | Rendszer                              | owner-only; CAS + activeOrderKey                                                                                                                                                                                                              |

### 7.2 Plugin-collectionök (`src/plugins/ecommerce.ts` + form-builder)

| Slug                         | Lényeg                                                                                                                                                                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `products`                   | HUF, displayTitle, slug, saját `status`, modules+videos, accessDurationDays (owner), ár owner-only, streamAssetId rejtve; „Akciós megjelenés” (owner-only), `unlisted` (owner-only); a `longDescription` Lexicalbe `coursePackage` blokk illeszthető (`src/blocks/CoursePackage.ts`) |
| `orders`                     | orderNumber `KH-<év>-<6 jegy>`, totalHufSnapshot, barionPaymentId unique, invoice/storno/corrective mezők `denyFieldWrite`                                                                                                                                                           |
| `carts`                      | plugin; a storefront **nem** ezt használja (localStorage); rate-limit véd                                                                                                                                                                                                            |
| `forms` / `form-submissions` | Kapcsolat / Hírlevél / Időpontkérés; szerződés a **űrlap címéből**; admin-igazság és mezősúgók: `src/lib/admin/urlap-admin.ts`, kötés-jelzés: `FormBindingNotice`                                                                                                                    |
| `payload-jobs`               | staff/owner CRUD; belső queue `overrideAccess`                                                                                                                                                                                                                                       |
| `payload-jobs-stats`         | szanitizálás után zárva (`restrictJobStatsGlobalAccess`)                                                                                                                                                                                                                             |
| `payload-locked-documents`   | ugyanez (`restrictLockedDocumentsAccess`)                                                                                                                                                                                                                                            |

A plugin `variants` / `addresses` / guest-cart **ki**. Currency: `HUF`,
`decimals: 0`. `customers = users`.

Products admin-tabok: Alapadatok → Ár és hozzáférés → Kurzusoldal →
Tananyag → Haladás. UI-mezők (nincs séma): `courseVisibilityNotice`,
`courseEditorialChecklist`, `courseProgressPanel`, `promoStatusPanel`
(`CoursePromoStatus`), user oldalon `purchasesOverview` +
`grantPurchasePanel`. A rendelés-lista összeg-oszlopa `OrderTotalCell`.

### 7.3 Users szerepkörök

`owner` > `staff` > `customer`. Az „admin" a kódban staff+owner
(`hasStaffOrOwnerRole` / `isAdmin`).

- `role` mező: csak owner írja.
- Üres DB, első publikus create (`/users` vagy `/users/first-register`):
  `promoteFirstUserToOwner` + advisory lock. Az első fiók csak akkor
  jön létre `owner`-ként, ha a `FIRST_USER_BOOTSTRAP_TOKEN` (min. 32)
  be van állítva, és a kérés `x-kineticare-bootstrap-token` headere
  egyezik. Hiányzó vagy 32-nél rövidebb token → **503**, fiók **nem**
  jön létre. Hiányzó vagy rossz header → **403**, fiók **nem** jön
  létre. Ez fail-closed: ne keress „beragadt customer”-t, add meg a
  tokent. A 2. usertől a publikus create `customer`. Adminhoz kézzel
  `staff`.
- Jelszócsere / e-mailcsere: a többi session meghal, a cserét végző sid
  megmarad (J2). `revokeOtherSessionsAfterCredentialChange`.
- Jelszó: min. 12, kis+nagy+szám, e-mail local-part tiltva
  (`src/lib/security/password-policy.ts`). A reset saját route, a
  GraphQL ki — a politika REST-tel sem kerülhető meg.

### 7.4 Űrlap-szerződések

Egy hooklánc, három séma. A fajtát a **űrlap címe** dönti el (DB), nem
a kliens mezői — különben a hívó a lazább szerződést választaná.
Ismeretlen → szigorúbb `contact`.

| Cím                                     | Mezők                                             | Levél                           |
| --------------------------------------- | ------------------------------------------------- | ------------------------------- |
| Kapcsolat                               | név, email, tárgy, üzenet, consentPrivacy         | staff (`CONTACT_STAFF_EMAILS`)  |
| Hírlevél (`NEWSLETTER_FORM_TITLE`)      | email, consentNewsletter                          | **nincs** staff-értesítő        |
| Időpontkérés (`APPOINTMENT_FORM_TITLE`) | név, telefon, email, panasz, sávok, consentHealth | staff + visszaigazoló a kérőnek |

Turnstile: párban. Fél-lábas élesben boot-hiba. Mindkettő hiány: warn,
csak IP-keret.

### 7.5 Admin oldalsáv

`src/plugins/admin-groups.ts` sorrend: Tartalom → Navigáció → Webshop →
Űrlapok → Felhasználók → Rendszer. A Tartalom csoporton belül:
Oldalak → Blogbejegyzések → Képek → Vélemények → Kategóriák → Védett
kurzusfájlok (`ADMIN_GROUP_ITEM_ORDER`). Megjelenített csoportnév
(`ADMIN_GROUP_DISPLAY_NAMES`): „Űrlapok” → „Űrlapok és beküldések”,
„Felhasználók” → „Fiókok”; a forrásban az `admin.group` string marad.
Csak megjelenítés: mezőhöz, hookhoz, access-hez nem nyúl
(`admin-groups.test.ts` a valódi configon méri).

A `payload.config.ts` plugin-lánca, a sorrend kötött: `ecommerce` →
`audit` → `usersAuthEmails` → form-builder → `adminKulcsszoNelkul` →
`adminGroups` → `huAdminForditasPlugin`. A lánc után a `buildConfig`
eredményére: `restrictJobStatsGlobalAccess` →
`restrictLockedDocumentsAccess` → `restrictResetTokenFieldAccess`.

Az admin saját rétegei (`admin.components`):

- `beforeNavLinks`: `AdminNavLinks`, két csoport az oldalsáv tetején:
  „Leggyakrabban használt” (Kezdőlap, Kezdőlapi videó szövegei,
  Szerkesztő nézet) és „Kimutatások és kurzusvideók” (Statisztika,
  Webanalitika, Videótár). Útvonalak és feliratok egy helyen:
  `ADMIN_UTAK` (`src/components/admin/KezdolapCel.ts`).
- `actions`: `KezdolapVideoFejlecLink` a fejlécben (1440 px alatt a
  Payload becsukja az oldalsávot).
- `beforeDashboard`: `GyakoriTeendok` (feladat-belépők az
  Irányítópulton).
- `providers`: `SzekcioMegnyito` (a `?szekcio=` / `?mezo=` mélylink
  nyitója) és benne a `KetLapFigyelo`.

Admin-meta: cím „<oldal> | Kineticare admin”, magyar leírás, OG-kép és
kulcsszó ki, a weboldal ikonjai; `avatar: 'default'` (a Gravatart a CSP
blokkolná); `dateFormat: 'yyyy. MM. dd. HH:mm'`.

Custom view-k a Payload 3.88-ban nyilvános admin-route-ok — a kapu a
**nézetben** van, nem a config path-on (pl. `canAccessStatistics`,
`hasStaffOrOwnerRole`). A keret-szabály (be nem jelentkezettnél nincs
admin-keret): `src/lib/admin/custom-view-auth.ts`.

Access-segédek (`src/access/`): `roles.ts`, `isStaffOrOwner.ts`,
`publishedOrAdmin.ts`, `menus-visibility.ts`,
`testimonials-visibility.ts`, `policies.ts` (a saját collectionök
politikáját az ecommerce-plugin pipeline `applyCollectionAccessPolicies`
teszi rá; a `users` politikája a `Users.ts`-ben él). **Ezeket csak
emberi review után szabad változtatni.**

Közös mezők (`src/fields/`): `slug.ts`, `course-slug.ts`,
`course-modules.ts`, `course-attachments.ts`, `seo-keywords.ts`.

i18n: **csak `hu`** (`supportedLanguages: { hu }`, admin-audit K25); az
`en` kivéve, mert az angol böngészőnyelv vegyes nyelvű admint adott.
A Payload magyar fordításának hibáit (lefordított helyőrzők, magázás,
félrefordítás) a `src/lib/admin/hu-forditas.ts` plugin fésüli felül, a
lánc **legvégén**, mert az ecommerce plugin a saját névterét
felülírná. A `lexical:*` kulcsok így nem írhatók felül. Őr:
`admin-forditas.test.ts`. FixedToolbar a Lexicalen.

Admin-téma (`src/app/(payload)/custom.scss`): AA-kontraszt, fókusz,
érintőcél és reflow réteg mindkét témára, számozott szakaszokkal (1–9;
a 9. a saját admin-komponensek stílusszerződése, `.kc-admin-notice`).
Őr: `admin-tema-kontraszt.test.ts`.

### 7.6 onInit

`src/payload.config.ts` `onInit`, kötött sorrendben: pool
error-handler, Barion webhook-processor, kezdőlap-baseline
(`ensureMediaFiles` → `ensureHomeImages` →
`ensureHomeLayoutFrissTelepitesen` →
`ensureHomeTestimonialsFrissTelepitesen`), Kapcsolat űrlap, Hírlevél
űrlap, Időpontkérés űrlap (mind best-effort).

**Friss telepítésre szűkítve (#293, H40):** kezdőlapot csak teljesen
üres Oldalak-gyűjteménynél, véleményt csak üres Vélemények-gyűjteménynél
hoz létre. Beállt rendszeren a két lépés egy-egy `count`, írás nélkül:
a webcímcsere, a kiürített szekciósor, a törölt vélemény a következő
deploy után is a szerkesztő döntése marad. A kézi `npm run seed` a
webcím- és név-alapú pótlást hívja. Őr:
`onit-seed-friss-telepites.test.ts`. Meglévőt nem ír felül. DB-hiba
nem viheti el a bootot.

`serverURL` **szándékosan üres** — beállítva abszolút media-URL, a
`next/image` 400. CORS/CSRF a `buildOriginAllowlist`-ből
(`NEXT_PUBLIC_SERVER_URL` + apex/www társ + `EXTRA_ALLOWED_ORIGINS`).

---

## 8. `src/lib/` — hol lakik az üzleti logika

A route-ok vékonyak. Ha viselkedést változtatsz, a `lib` a helye.

### Fizetés és rendelés

| Modul                                         | Feladat                                          |
| --------------------------------------------- | ------------------------------------------------ |
| `checkout/start-checkout.ts`                  | Checkout indítás, lock, Barion Start, vendég     |
| `checkout/billing.ts` / `guest.ts`            | Számlázási / vendég validáció                    |
| `checkout/pending-payment.ts`                 | Folyamatban lévő fizetés újrafelvétele           |
| `checkout/form-submission.ts`                 | Magyar hibamondatok                              |
| `order-status/apply-barion-state.ts`          | Állapotgép (callback + poll közös mag)           |
| `order-status/resolve-order-customer.ts`      | Vendég-kötés; privileged fiókra tilos            |
| `order-status/recover-paid-reject.ts`         | Elutasított, de Succeeded fizetés helyreállítása |
| `order-paid.ts`                               | invoice job + visszaigazoló levél                |
| `order-poll/service.ts`                       | Elveszett callback, árva lejárat, resweep        |
| `order-number.ts` / `order-integrity.ts`      | KH-szám, tétel-integritás                        |
| `barion/`                                     | client, start v2, state v4, refund               |
| `barion-callback/`                            | 200+dedup, after(), processor regisztráció       |
| `payments/barion-adapter.ts`                  | Plugin-héj; confirmOrder dob                     |
| `refund/`                                     | Intent főkönyv, Barion refund, recovery          |
| `szamlazz/`                                   | invoice / storno / corrective / xml / queue      |
| `advisory-lock.ts` / `user-purchases-lock.ts` | Postgres advisory lock                           |
| `idempotency.ts`                              | webhook-events dedup                             |

### Hozzáférés és tananyag

| Modul                                           | Feladat                                                         |
| ----------------------------------------------- | --------------------------------------------------------------- |
| `course-access.ts`                              | Tiszta óra + player gate                                        |
| `course-access-lookup.ts`                       | DB-lookup, grant + order dátum                                  |
| `access-grants.ts`                              | Grant-sorok, eligibility, fail-open                             |
| `grant-purchase.ts` + `grant-purchase-route.ts` | Kézi ajándék                                                    |
| `free-course/` + `free-course-grant.ts`         | Ingyenes igénylés                                               |
| `curriculum/curriculum.ts`                      | modules ∪ videos → egy modell                                   |
| `course-progress/`                              | mark-watched, lookup, client                                    |
| `stream/`                                       | token, Bunny tár/upload, playerjs, contract                     |
| `courses.ts` / `course-url.ts`                  | cím, ár (`coursePriceHuf`), CTA, kanonikus URL                  |
| `course-promo.ts`                               | Akció időablaka, egy döntés oldalnak, kártyának, adminnak       |
| `course-discovery.ts`                           | `unlisted` szűrés (`DISCOVERABLE_COURSES_WHERE`, a limit előtt) |
| `course-package.ts`                             | `coursePackage` blokk a Részletes leírásban                     |
| `purchased-products.ts`                         | SKU-halmaz segéd                                                |

### Storefront CMS és SEO

| Modul                                                     | Feladat                                                                                                                                                                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cms.ts`                                                  | Local API getterek; `PUBLISHED_WHERE`; hiba → üres + warn                                                                                                                                                                       |
| `menus.ts` / `menu-tree.ts` / `menu-seed.ts`              | Menüfa; Kurzusok kódbeli első tétel                                                                                                                                                                                             |
| `home-seed.ts`                                            | Kezdőlap seed; onInit-ben csak friss telepítésen (`…FrissTelepitesen`), meglévő layoutot nem ír felül                                                                                                                           |
| `home-help-states.ts`                                     | „Így tudunk segíteni” sín vagy tábla: a `services` blokk `elrendezes` mezője dönt (H15), nem cím- vagy URL-felismerés                                                                                                           |
| `SinKoppintasIgazito.tsx`                                 | A sín kliensoldali koppintás-javítása `src/components/blocks/SinKoppintasIgazito.tsx`: a rejtett rádió görgetés nélkül kap fókuszt, a koppintott sor helyben marad (mobil ugrás-hiba, 2026-09-23; őr: `sin-koppintas.test.tsx`) |
| `hero-video.ts`                                           | Publikus Bunny hero (`HERO_VIDEO_STREAM_ID === null`)                                                                                                                                                                           |
| `film-captions.ts`                                        | A nyitó videó két beúszó felirata: tartalékok, 60 / 120 karakteres plafon, validátorok, `resolveFilmCaptions`                                                                                                                   |
| `kep-helyek.ts` / `foto-friz.ts`                          | Rögzített fotóhelyek feloldása (CMS-kép vagy beépített), fókuszpont → `object-position`; a fríz négy beépített fotója                                                                                                           |
| `free-sos-title.ts`                                       | Az SOS-sáv címének egyetlen feloldója (lap, sorcímke, szalag, llms)                                                                                                                                                             |
| `seo.ts` / `seo-graph.ts` / `seo-cikk.ts` / `seo-llms.ts` | meta, JSON-LD, llms.txt                                                                                                                                                                                                         |
| `hub-seo.ts`                                              | Gyökér-hub közös SEO-lánca (Oldal + Blogbejegyzés)                                                                                                                                                                              |
| `tudastar/`                                               | hubok, FAQ, kulcsszó-lock, markdown→lexical                                                                                                                                                                                     |
| `tudastar-kapcsolo.ts`                                    | **A Tudástár-kapcsoló szabálya** (tiszta): kikapcsolt, ha van `/blog` célú URL-menüpont, és mindegyik `visible=false` vagy `unlisted=true`; ilyen menüpont nélkül bekapcsolt                                                    |
| `tudastar-lathatosag.ts`                                  | `getTudastarLathato()`: szerveroldali lekérdezés, `unstable_cache` + `MENUS_CACHE_TAG`, hibánál bekapcsolt + warn                                                                                                               |
| `tudastar-link-szuro.ts`                                  | Kikapcsolt Tudástárnál a `/blog`, `/blog/…` és hub-linkek kiszűrése a szekciósorból és a Lexicalből                                                                                                                             |
| `contact-email.ts` / `contact-email-server.ts`            | Kapcsolati e-mail: a `kapcsolat` oldal első látható Időpontkérőjének mezője, tartalék `KAPCSOLATI_EMAIL_TARTALEK`; `getContactEmail()` kérésenként egy lekérdezés                                                               |
| `szakembereknek.ts`                                       | `/szakembereknek` kódtartaléka, CTA-k, `SZAKKONYV_URL = null`                                                                                                                                                                   |
| `rendeloi-arlista.ts`                                     | A `rendeloi` horgonyú richText árlista-szerkezetének felismerése (WP58)                                                                                                                                                         |
| `cta-banner-course.ts`                                    | A CTA-sáv kurzusborítója a gomb céljából                                                                                                                                                                                        |
| `legacy-redirects.ts`                                     | 25 régi sitemap-URL sorsa (7 változatlan, 13 × 308, 5 × 410)                                                                                                                                                                    |
| `content-slugs.ts`                                        | `kezdolap`, `szakembereknek`                                                                                                                                                                                                    |
| `cta-vocabulary.ts`                                       | Gombfeliratok egyetlen forrása                                                                                                                                                                                                  |
| `legal-content.ts`                                        | Jogi fallback                                                                                                                                                                                                                   |
| `cart.ts`                                                 | localStorage kosár, `useSyncExternalStore`                                                                                                                                                                                      |

### Biztonság és e-mail

| Modul                                                                 | Feladat                                                        |
| --------------------------------------------------------------------- | -------------------------------------------------------------- |
| `security/csp.ts`                                                     | CSP tiszta függvény; build-időben sül                          |
| `security/rate-limit.ts`                                              | Keretek                                                        |
| `security/same-origin.ts` / `login-csrf.ts`                           | CSRF                                                           |
| `security/password-policy.ts` / `reset-password-route.ts`             | Jelszó                                                         |
| `security/revoke-other-sessions.ts`                                   | Session-invalidálás                                            |
| `security/activation-token.ts`                                        | Vendég 7 nap                                                   |
| `security/payload-rest-body-limit.ts` / `request-body.ts`             | 2 MiB törzsplafon a Payload REST-en; korlátozott törzsolvasás  |
| `security/reset-token-field-access.ts` / `locked-documents-access.ts` | Config utáni access-zárak (reset-token olvasás, dokumentumzár) |
| `email/provider.ts`                                                   | Resend → SMTP → noop                                           |
| `email/templates/`                                                    | auth, order, appointment, migration                            |
| `logger.ts` / `request-id.ts` / `audit.ts`                            | Napló, ID, audit-írás                                          |

### Admin és szerkesztői réteg

| Modul                                             | Feladat                                                                                                                                       |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin/hu-forditas.ts`                            | Magyar admin-fordítás javításai, plugin a lánc végén                                                                                          |
| `admin/kotott-cimek.ts`                           | Kódhoz kötött webcímek, mi történik átnevezéskor; az Oldalak „Mi ez” oszlopa                                                                  |
| `admin/szekcio-masolatok.ts`                      | „Ugyanaz máshol” jelzés (azonos típusú szekció, közös telefon, e-mail, kép más oldalon)                                                       |
| `admin/velemeny-helye.ts`                         | Vélemények „Hol látszik” oszlopa                                                                                                              |
| `admin/friz-helyzet.ts`                           | Mikor látszik a fríz a csapatfotó helyén (első látható `about` közvetlenül a `filmHero` után)                                                 |
| `admin/arlista-szabalyok.ts`                      | A rendelői árlista formai szabálya a szerkesztőnek                                                                                            |
| `admin/urlap-admin.ts`                            | Űrlapok admin-igazsága, mezősúgók, `CONTACT_FORM_TITLE`                                                                                       |
| `admin/custom-view-auth.ts`, `admin/*-handler.ts` | Custom view keret, admin-API handlerek (haladás)                                                                                              |
| `section-row-label.ts`                            | Szekció-sorcímke („05 · Szolgáltatás-sorok: …”), oldalfüggő címkék, rejtett-jel, ikerlink a látható párra; ugyanezt olvassa a frontend szalag |

A szerkesztői réteg komponensei a `src/components/editor/` alatt:

- `szekcio-melylink.ts`: a mélylink egyetlen formája
  (`/admin/collections/pages/<id>?szekcio=<24 hex blokk-id>`, opcionális
  `&mezo=<mezőút>`); építi a frontend és a `VideoSzovegeiNezet`,
  értelmezi a `SzekcioMegnyito`.
- `admin/SzekcioMegnyito.tsx`: admin-provider; a legújabb (draft)
  változatból megkeresi a sort, kinyitja, a ragadós fejléc alá görget,
  fókuszt ad. Benne él a `KetLapFigyelo` (ugyanaz a dokumentum két
  lapon: BroadcastChannel, hálózat nélkül, mindkét lapon figyelmeztet,
  mert a Payload dokumentumzár ugyanannak a usernek nem jelez).
- `frontend/SzerkesztoSzalag.tsx`: „Szerkesztem” szalag minden
  CMS-szekció előtt, **csak draft-előnézetben** (a `/next/preview`
  staff/owner-kapuja kapcsolja be); a látogató HTML-jébe és RSC-jébe
  semmi nem kerül. Kódbeli moduloknál „Kódban van” / „Részben kódban
  van” szalag. A `SzekcioHorgonyIgazito` a betöltés után a
  `#szekcio-<id>` horgonyra igazít, az első felhasználói mozdulatig.
- `frontend/KurzusForrasSzalag.tsx`: a kurzusoldal szakaszainak forrása
  (melyik mező, melyik fül, tartalék-e), csak előnézetben.
- `frontend/SzerkesztoNezetBelepo.tsx`: „Szerkesztő nézet” belépő a
  fejléc fölött, csak staff/owner-nek (`header-user.ts` `szerkeszto`
  bit); a cél a `szerkeszto-nezet-cel.ts` leképezése
  (`/`, `/<slug>`, `/blog/<slug>`, `/kurzusok/<slug>`).
- Stílus: `(frontend)/styles/szerkeszto-reteg.css`.

A blokkok admin-burkolója (`withSectionAdmin`, `src/blocks/index.ts`)
séma-semleges: sorcímke (`SectionRowLabel`), `disableBlockName`, és két
UI-mező minden blokk elején (`szekcioForrasJelzes` =
`SectionSourceNotice`, `szekcioMasolatJelzes` = `SectionCopies`). A G2
őr (`schema-config-sync.test.ts`) bizonyítja, hogy a séma nem változik.

### Egyéb

`admin/` (stat, progress, webanalitika kapu), `statistics/`,
`analytics/` (consent, PostHog, GA4, Barion Pixel; az eseménylista a
`posthog-config.ts`-ben), `appointment/`, `newsletter/`, `preview/`,
`migration-notice/`, `media-restore.ts`,
`migrations/destructive-migration-guard.ts`, `sos-offer.ts`,
`owner-review-v1.ts`, `gondolatjel-leftover.ts`
(tiltott kötőjel-maradvány őre), `feedback/` (a `/api/visszajelzes`
validáció, handler, PostHog-capture), `request-error.ts` (a Next
`onRequestError` hookjának törzse: strukturált napló a kiszökő
szerverhibákról, `src/instrumentation.ts` köti be), `cache-tags.ts`,
`brand-logo.ts` (a `public/assets/brand/` SVG-k adatai).

---

## 9. Jobok

`src/jobs/index.ts`. Workerek: `ENABLE_JOB_WORKERS=true`. Dev-ben ki.
Élesben hiányzó flag → **warn** (`job_workerek_kikapcsolva`), nem
fail-closed boot.

| Task                       | Queue                 | Mikor                   | Mit                        |
| -------------------------- | --------------------- | ----------------------- | -------------------------- |
| `webhook-retry`            | `webhook-maintenance` | cron `* * * * *`        | elhasalt callback újra     |
| `order-poll`               | `order-maintenance`   | cron `*/5 * * * *`      | GetState v4, árva, resweep |
| `invoice-issue`            | `order-maintenance`   | esemény (paid)          | számla                     |
| `storno-issue`             | `order-maintenance`   | esemény (teljes refund) | stornó                     |
| `corrective-invoice-issue` | `order-maintenance`   | esemény (részrefund)    | helyesbítő                 |

Az `autoRun` csak a sorban lévőt futtatja — a periodikus taskoknak
`schedule` kell. A kettő párban. A `scheduling` sémát hoz: a migrációnak
ugyanabban a körben kell lennie. Job REST + `payload-jobs` staff/owner.
Hiányzó `payload.jobs.queue` → hangos riasztás, nem néma false (W6).

---

## 10. Frontend architektúra

### 10.1 Keret

`(frontend)/layout.tsx`: `lang="hu"`, `force-dynamic`, `metadataBase` a
`resolveServerUrl()`-ből. Skip-link `#tartalom`. Sorrend:

1. `BarionPixel` a `<head>` **első** eleme — **nem** consent mögött
   (Barion Smart Gateway feltétele, csalásmegelőzés).
2. Font preload (Tenor Sans + Nunito Sans latin).
3. `AnchorScroll`, majd `PostHogProvider` → PageView +
   `GoogleAnalytics` + `Header` + `<main id="tartalom">` +
   `FeloldottFooter` + `ConsentBanner`. Draft-előnézetben a fejléc és a
   lábléc elé `ElonezetKeretSzalag` kerül (a lábléc-szalag a
   `/kapcsolat` Időpontkérőjének mélylinkjével).
4. `BarionPixelNoscript` a body végén (a skip-link után).

A lábléc (`FeloldottFooter`) a kapcsolati e-mailt a közös feloldóból
kapja, és ott a hibabejelentő gomb (`FeedbackTrigger`, natív
`<dialog>`, `src/components/feedback/`). A fejléc staff/owner-nek a
„Szerkesztő nézet” belépőt is rendereli, a látogató RSC-jébe ebből
semmi nem kerül.

A Barion Pixel felhasználását a `bp('consent', …)` szabályozza, a
betöltését nem. PostHog/GA4 csak `granted` után.

A kezdőlap hero **Stream-videója ki van kapcsolva**:
`HERO_VIDEO_STREAM_ID === null` (`src/lib/hero-video.ts`). A film-sáv
helyi `public/media/film/`. Ne találj ki élő Bunny hero-GUID-ot. A
videón beúszó két felirat CMS-mező (`filmHero.captions`: `midTitle`,
`midBody`, `endTitle`, `endBody`, `endBodyWithoutFreeSos`); üres mező
= beépített szöveg. Szerkesztői út: `/admin/kezdolap-video`, doksi:
`docs/video-szovegek-szerkesztese.md`.

Nincs CartProvider / AuthProvider. Kosár: `useCart()`. Auth: szerveren
`payload.auth({ headers })`, kliensen `auth-client.ts` + full page load
login után. A `/fiok` PATCH **sosem** küld `role` vagy `purchases` mezőt.

### 10.2 Komponensfa (`src/components/`)

| Mappa                       | Szerep                                                                                                                                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui/`                       | Button, Field, Card, Container, Section, Badge, PriceTag, Progress — primitívek, tokenekről                                                                                                           |
| `layout/`                   | Header, Footer, DesktopNav, MobileNav, AccountNav, Newsletter*                                                                                                                                        |
| `blocks/`                   | CMS-szekció renderelők (`RenderBlocks` + FilmHero, Usps, PhotoFrieze, OfferCards, RendeloiArlista, LogoRail, …)                                                                                       |
| `content/`                  | HomeView, PostArticle, PostView, ProductCard, JsonLd, HeroVideo, home/*                                                                                                                               |
| `content/PostCourseCta.tsx` | Cikk végi CTA — **csak** cikkoldalon                                                                                                                                                                  |
| `courses/`                  | Buybox, BuyBar, Curriculum, Faq, FitCheck, PreviewVideo, FreeCourse*, PromoBadge                                                                                                                      |
| `courses/promo/`            | Akciós kurzussablon (`PromoCourseView`, hero, előnyök, ár, záró sáv, `CoursePackageContent`)                                                                                                          |
| `checkout/`                 | CheckoutForm, CartView, ThankYouView, BarionFizetesJelzes                                                                                                                                             |
| `account/`                  | AccountView, CourseList, CoursePlayer + `player/`                                                                                                                                                     |
| `auth/`                     | Login / Register / Forgot / Reset formok                                                                                                                                                              |
| `analytics/`                | Consent, PostHog, GA4, Barion, TrackEvent, ArticleEngagement                                                                                                                                          |
| `admin/`                    | Stat, Bunny tár, refund, grant, progress, webanalitika; nav-linkek, Gyakori teendők, sorcímke, forrás- és másolat-jelzés, kötött-webcím és hub tájékoztatók, előnézet-gomb, lista-cellák              |
| `editor/`                   | Szerkesztői réteg: `admin/` (SzekcioMegnyito, KetLapFigyelo), `frontend/` (Szerkesztem és „Kódban van” szalag, horgony-igazító, kurzus forrás-szalag, Szerkesztő nézet belépő), `szekcio-melylink.ts` |
| `feedback/`                 | Hibabejelentő gomb és párbeszédablak (WP65)                                                                                                                                                           |
| `error/`                    | NotFoundView                                                                                                                                                                                          |
| `lexical/`                  | RichText serialize                                                                                                                                                                                    |
| `preview/`                  | PreviewBar                                                                                                                                                                                            |
| `motion/`                   | AnchorScroll, SectionReveal                                                                                                                                                                           |
| `scroll-scrub/`             | A nyitó film görgetésre léptetett lejátszása                                                                                                                                                          |

A kezdőlap **két rendje** van: a CMS `layout` blokksor (élő) és a
`HomeView` fallback/help-state, ha a szekció hiányzik. A seed csak
**üres** szekciósornál ír.

### 10.3 Blokkok (`src/blocks/`)

Katalógus sorrendje = admin „+ Blokk" + ajánlott M1–M8:

`filmHero`, `credsStrip`, `courseCards`, `freeSos`, `pressLogos`,
`welcome`, `usps`, `states`, `services`, `about`, `howItWorks`,
`testimonials`, `knowledge`, `faq`, `teamMembers`, `accordion`,
`appointment`, `richText`, `ctaBanner`, `offerCards`.

Az utolsó hat (`teamMembers`-től) nem kötődik kezdőlapi pozícióhoz, az
admin a „Bárhol használható” csoportba teszi. A `coursePackage` blokk
nem oldalblokk: a termék Részletes leírásának Lexicaljébe illeszthető.

Közös: `sectionSettings` (látható, horgony, háttér), `linkFields`, a
képmezők közös súgója `KEP_CSERE_SUGO` (`src/blocks/kep-csere.ts`).
Terv: `docs/szekcio-rendszer-terv.md`.

Blokkmezők a #292 / #293 óta (generált migrációkkal):

| Blokk         | Mező                                                                                                                                 | Megjegyzés                                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `filmHero`    | `captions` csoport                                                                                                                   | két beúszó felirat, `src/lib/film-captions.ts` (migráció `20260922_225015_film_hero_feliratok`)                                                                                           |
| `about`       | `frieze.photo1–4`                                                                                                                    | a fríz négy íve; üres = beépített (`20260923_073659_kep_helyek`); a fríz csak az első látható `about`-on, közvetlenül `filmHero` után látszik                                             |
| `courseCards` | `scenePhotos.left/middle/right`                                                                                                      | a „Kurzusaink” jelenet három fotója (ugyanaz a migráció)                                                                                                                                  |
| `courseCards` | `hatterFelirat`                                                                                                                      | a kártyák alatti nagy, halvány szó; üresen a beépített `COURSE_SHOWCASE_MARK` (`20260923_083202_a_csapat_blokkmezok`)                                                                     |
| `ctaBanner`   | `kep`                                                                                                                                | saját kép a sávhoz; üresen a gomb céljából feloldott kurzusborító, más célnál kép nélkül (ugyanaz)                                                                                        |
| `offerCards`  | `eyebrow`, `title`, `lead`, `kartyak[]` (ikon, kicker, cím, szöveg, tények, gomb, `gombSuly`, jegyzet, `hamarosan`, `allapotSzoveg`) | 1–4 ajánlat-kártya, a `/szakembereknek` sémája (ugyanaz)                                                                                                                                  |
| `services`    | `elrendezes` (`tabla` alapérték / `sin`)                                                                                             | a sín vagy tábla döntése; a megjelenítés (`home-help-states.ts`) ezt tiszteli (H15); az élő adatot a content-job `sin-elrendezes` szabálya tölti ki, ugyanabban a deployban (11. szakasz) |

### 10.4 CSS

`(frontend)/styles.css` import-sorrend: tokens → fonts → base → motion
→ ui → progress → layout → content → szerkeszto-reteg → consent-banner
→ hibaoldal → visszajelzes → checkout / auth / account / kurzusaim /
player. Route-saját CSS a route `layout.tsx`-ében vagy `page.tsx`-ében
(pl. `kurzusok.css`, `szakembereknek.css`, `kapcsolat.css`). Új lapot
a **rétegbe** tedd, ne a gyűjtőbe.

Tokenek: `styles/tokens.css` — `--kc-*`. Elemre írt px/rem tilos.
Tipográfia: három token, `clamp()` 320–1440. Őr:
`src/__tests__/tipografia-harom-meret.test.ts`.

Szekció-CSS: `styles/blocks/*.css`. A cikk-CTA 900 px-es `:has` rács:
`styles/blocks/post-view.css`. A 640-es kártyarács **nem** ez.

Téma szín (viewport): `#f6f9fc` = `--kc-color-bg` paper.

### 10.5 Kosár

Nincs szerver-kosár a vásárlási úton. `src/lib/cart.ts`:
`localStorage` kulcs `kineticare-cart-v1`, `useSyncExternalStore`.
SSR + első hidrálás üres — a tárolt tartalom utána jön. Egy tétel = egy
vásárlás. Availability: `paid` | `free` | `archived` | `unavailable`.
Régi kosárban nincs `slug` / `availability` — a link id-s URL-re megy,
a route 308-ol.

### 10.6 Cikk-CTA (zár, ne találd ki)

`postCtaVariantOf`: az `APPOINTMENT_CTA_SLUGS`
(`src/components/content/post-article.ts`: `befagyott-vall`,
`peace-and-love-friss-serules`, `gipszben-a-kezed`) → egy panel
(`idopont`, testrésztől független szöveggel); minden más slug →
`kurzus` (két testvér `.kc-post-cta__panel`, nincs
`kc-post-cta__pair`). Asztal 900 px-től kétoszlopos `:has` rács.

Két panelt a hét kéz-cikk visel (lásd `docs/agent-feature-map.md`).
A `docs/cikkek/` tíz törzse: hét kéz-cikk, a váll és két tulajdonosi
piszkozat (őr: `shop-lane-zarak.test.tsx`).
A `/szolgaltatasok`, `/`, `/kurzusok` **nem** `.kc-post-cta`.

Őrök: `tudastar-cikkoldal.test.tsx`, `craft-lane-zarak.test.tsx`,
`shop-lane-zarak.test.tsx`.

Craft-sáv: a nyilvános HTML-ben nincs DOI/PMID, forrásjegyzék, Semrush,
Ahrefs, angol `volume`, „hivatalos táblázat". A kezdőlap nem Ads-lander.
Nincs kitalált orvosi ábra.

### 10.7 Analitika-események

`ANALYTICS_EVENTS` (`src/lib/analytics/posthog-config.ts`, a
`posthog.ts` re-exportálja; a konfig-modul azért külön, hogy a
szerveroldali út ne húzza be a `posthog-js`-t) — átnevezés bukik
(Shop-sáv). Funnelek:

1. Értékesítés: `$pageview` → `course_viewed` → `checkout_started` →
   `purchase_confirmed`
2. Tanulás: `course_started` → `lesson_completed` → `module_completed`
   → `course_completed`
3. Lead: `lead_submitted` / `lead_succeeded`
4. Videó: `video_started` / `video_milestone` (leckénként egyszer)
5. Tartalom: `article_viewed` / `article_read` / `article_cta_clicked`
   / `faq_opened`
6. Hiba: `checkout_failed` (+ PostHog `$exception`)
7. Visszajelzés: `site_feedback`, **szerverről** küldve
   (`/api/visszajelzes`), ezért hozzájárulás nélkül is megérkezik;
   hozzájárulás nélkül egyszer használatos anonim azonosítóval.

Személyes adat az event-propertyben tilos. PostHog `/ingest` first-party
proxy (`next.config.ts` rewrites); a middleware a proxy-kérésből
leveszi a `Cookie` és `Authorization` fejlécet, hogy a `payload-token`
ne jusson a PostHoghoz (#289). Consent: `kc_analytics_consent` +
`kc_analytics_consent_at`. Ismeretlen → banner. Újra kérdez **365 nap**
után. `CONSENT_MODE_DEFAULT` minden tároló `denied`; granted csak
`analytics_storage`. `ad_*` sosem granted. A sticky buy bar a
`--kc-consent-offset` tokenre ül.

---

## 11. Scriptek

| npm                                     | Fájl                                     | Megjegyzés                                                                                                                                                                                                                                              |
| --------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `seed`                                  | `src/scripts/seed.ts`                    | Nem dry-run. Nem-éles URL-en hiányzó `SEED_*` = **teljes seed ír**. Éles URL-en tiltott, kivéve `SEED_SCOPE=kezdolap` (szűkített írás) vagy `SEED_CONFIRM_LIVE=igen` (teljes seed). Owner jelszó **kötelező** env, a script nem generál/naplóz jelszót. |
| `seed:demo`                             | `demo-seed.ts`                           | `DEMO_MODE=1`; éles domain tiltott; **nem** `confirmOrder`                                                                                                                                                                                              |
| `seed:legacy`                           | `restore-legacy-content.ts`              | próba; írás `LEGACY_RESTORE_CONFIRM=igen`; felülírás `LEGACY_OVERWRITE=igen`                                                                                                                                                                            |
| `seed:menu`                             | `seed-menu.ts`                           | `MENU_SEED_DRY_RUN=igen` = próba                                                                                                                                                                                                                        |
| `grant:purchase`                        | `grant-purchase.ts`                      | CLI ugyanarra a szolgáltatásra, mint a panel                                                                                                                                                                                                            |
| `import:customers`                      | `import-customers.ts`                    | CSV; `docs/vasarlo-migracio-terv.md`                                                                                                                                                                                                                    |
| `import:tudastar`                       | `import-tudastar-cikkek.ts`              | próba; írás `OWNER_TUDASTAR_CONFIRM=igen`; publ. `OWNER_TUDASTAR_PUBLISH=igen`                                                                                                                                                                          |
| `import:hubok`                          | `import-hub-oldalak.ts`                  | piszkozat; publ. `OWNER_HUB_PUBLISH=igen`                                                                                                                                                                                                               |
| `import:bunny-curriculum`               | `import-bunny-curriculum.ts`             |                                                                                                                                                                                                                                                         |
| `kurzus:videok-modulba`                 | `videok-modulba.ts`                      | **egyetlen** biztonságos átemelés                                                                                                                                                                                                                       |
| `backfill:ar-snapshot`                  | `backfill-price-snapshot.ts`             | próba; írás `OWNER_BACKFILL_CONFIRM=igen`                                                                                                                                                                                                               |
| `backfill:access-grants`                | `backfill-access-grants.ts`              | ugyanez                                                                                                                                                                                                                                                 |
| `record:manual-invoice`                 | `record-manual-invoice.ts`               | próba; írás `OWNER_MANUAL_INVOICE_CONFIRM=igen`; a 'failed' számlájú rendelésre a megtalált vagy kézzel kiállított számla számát rögzíti (a K12 kapu utána nyit); `docs/uzemeltetes/05-szamla-storno-helyesbito-kezi.md`                                |
| `content:owner`                         | `apply-owner-content.ts`                 | alapból próbafutás, írás `OWNER_CONTENT_CONFIRM=igen`; élesben a `content-job` Railway-szolgáltatás futtatja (`railway.content-job.json`). Doksik: `docs/owner-content-2026-09-19.md`, `docs/owner-content-2026-09-22.md`                               |
| `email:migracio`                        | `send-migration-notice.ts`               | idempotens; `--force` újraküld                                                                                                                                                                                                                          |
| `backup:db`                             | `backup-db.ts`                           | `docs/adatbazis-mentes.md`                                                                                                                                                                                                                              |
| `generate:types` / `generate:importmap` | Payload                                  | a CI: a generált `src/payload-types.ts` egyezzen a commitolttal                                                                                                                                                                                         |
| `verify:install-scripts`                | `scripts/verify-install-script-lock.mjs` | az install-script lánc hash-őre                                                                                                                                                                                                                         |
| _(nincs npm alias)_                     | `update-migration-checksums.ts`          | G3 manifest, ugyanabban a PR-ben                                                                                                                                                                                                                        |
| _(nincs npm alias)_                     | `apply-owner-review-v1.ts`               | explicit owner-content lépés, alapból írásmentes előnézet                                                                                                                                                                                               |
| _(nincs npm alias)_                     | `generate-app-icons.ts`                  | favicon / icon.svg / apple-icon a logócsomagból, commitolt kimenet                                                                                                                                                                                      |
| _(nincs npm alias)_                     | `preview-migration-email.tsx`            | az átállási levél offline előnézete, DB és küldés nélkül                                                                                                                                                                                                |

**A content-job szabálymoduljai.** Az `apply-owner-content.ts`
szabályonként idempotens, pontos egyezésre vagy üres mezőre szűr, a
szerkesztői szöveget kihagyja. A #292 / #293 új szabályai külön, tiszta
modulban élnek, a fő script köti az adatbázishoz:

| Szabály                | Modul                        | Mit ír                                                                                                                                                                                                                                                              |
| ---------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `film-feliratok`       | `film-feliratok-kitoltes.ts` | a `filmHero.captions` üres mezőibe a beépített szöveget, hogy a szerkesztő lássa, mit ír át                                                                                                                                                                         |
| `sos-cim`              | `sos-cim-kitoltes.ts`        | a `freeSos` címét a tulajdonos szó szerinti címére („Ingyenes villámkurzus”), csak a régi pontos értéknél vagy üres mezőnél; a CMS-elsőbbségi kóddal egy deployban                                                                                                  |
| `kurzus-cim`           | `kurzus-cim-kitoltes.ts`     | üres `displayTitle` → a mai `sku`                                                                                                                                                                                                                                   |
| `sin-elrendezes`       | `sin-elrendezes-kitoltes.ts` | a `services` blokkok `elrendezes` / `hatter` mezőjébe a régi kód döntését (kezdőlap, `/szolgaltatasok`). **Deploy-feltétel:** a sín-kódváltással egy deployban kell élesen futnia. Egyszeri jellegű: ismételt éles futás egy tudatos Tábla-váltást visszaírna Sínre |
| `szakembereknek-oldal` | `szakembereknek-oldal.ts`    | a `szakembereknek` Oldal létrehozása a kódtartalékból, csak ha nincs ilyen (piszkozattal együtt keresve)                                                                                                                                                            |

Ugyanitt élnek a korábbi körök szabályai (pl. `harom-ajto-fotok`,
`kocsis-cv-foto`, `akcios-kurzus-*`, `kezdolap-*`); a teljes lista a
`JavitasSzabaly` típus az `apply-owner-content.ts`-ben.

A seed **sosem írja felül** a meglévő kezdőlap-szekciósorát, a meglévő
média-rekordot, kategóriát, oldalt, cikket, terméket, menüpontot, vagy a
Kapcsolat/Hírlevél/Időpont űrlapot. A `SEED_*` változók **nem**
próbafutás-kapuk: hiányuk nem dry-run. Nem-éles `NEXT_PUBLIC_SERVER_URL`
mellett a script azonnal ír (teljes demó-seed). Éles URL-en a teljes
seed el sem indul — kivéve `SEED_CONFIRM_LIVE=igen`. Akkor is megáll,
ha a DB-ben van nem `@example.com` vevő vagy rendelés.
`SEED_SCOPE=kezdolap` élesen is ír: média-restore + kezdőlap +
vélemények + űrlapok, demó-SKU nélkül.

---

## 12. Környezeti változók (csak kulcsnevek)

Kötelező boot (`src/env.ts` `assertRequiredEnv` +
`src/instrumentation.ts` `register()`; ugyanitt a `server_start`
naplósor a Node-verzióval és a `RAILWAY_GIT_COMMIT_SHA`-val, és az
`onRequestError` hook):

`DATABASE_URI`, `PAYLOAD_SECRET`, `NEXT_PUBLIC_SERVER_URL`,
`BARION_API_URL`, `BARION_PAYEE_EMAIL`, plusz
`BARION_POSKEY_TEST` (ha nem prod) vagy `BARION_POSKEY_PROD` (ha
`BARION_ENVIRONMENT=prod`). Élesben `BARION_ENVIRONMENT` is kötelező
(hiányában némán teszt-Barion).

`NEXT_PUBLIC_SERVER_URL` alakja is boot-őr: abszolút http(s), záró
perjel nélkül. Erre épül CORS/CSRF, `metadataBase`, SEO.

További boot-hibák: érvénytelen `SZAMLAZZ_AFAKULCS` (csak `27` vagy
`AAM`); beállított levélküldő (`RESEND_API_KEY` vagy `SMTP_HOST`)
mellett hiányzó vagy nem e-mail alakú `EMAIL_FROM`; élesben hiányzó
`BARION_ENVIRONMENT`; élesben fél-lábas Turnstile-pár. Az éles címen
(`NEXT_PUBLIC_SERVER_URL` a kineticare.hu) boot-hiba a nem-`prod`
Barion bekapcsolt számlázás (`SZAMLAZZ_AGENT_KEY`) mellett, és a
hiányzó `ENABLE_JOB_WORKERS=true`, ha nincs mellette
`JOB_WORKERS_OFF_CONFIRM=igen` nyugtázás. Induláskori RIASZTÁS (az app
elindul): `SZAMLAZZ_AGENT_KEY` `SZAMLAZZ_AFAKULCS` nélkül vagy
nagybetűvel; nem-`prod` Barion az éles címen számlázás nélkül;
nyugtázottan kikapcsolt workerek az éles címen. Élesben csak warn:
hiányzó `ENABLE_JOB_WORKERS=true` nem éles címen, mindkét
Turnstile-kulcs hiánya.

Opcionális, degradált módban az app fut: Számlázz, Bunny, PostHog, GA4,
Turnstile (párban vagy sehogy), e-mail (nincs kulcs → noop).
`NEXT_PUBLIC_*` és a CSP **build-időben** égnek — változás után
újrabuild.

További, kódban élő, az example-ben is jelölt vagy jelölendő kulcsok:

| Kulcs                                         | Szerep                                                                                                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENABLE_JOB_WORKERS`                          | `true` = cron workerek                                                                                                                                     |
| `JOB_WORKERS_OFF_CONFIRM`                     | `igen` = a workerek tudatos kikapcsolása az éles címen; nélküle `ENABLE_JOB_WORKERS=true` hiányában az app nem indul. Az `.env.example` még nem jelöli     |
| `BARION_SEND_3DS`                             | `false` = a Barion Start négy 3DS-blokkja kimarad (vészkapcsoló); üresen bekapcsolva. Az `.env.example` még nem jelöli                                     |
| `PAYLOAD_MEDIA_DIR`                           | élesben `/app/media` volume                                                                                                                                |
| `EXTRA_ALLOWED_ORIGINS`                       | DNS-cutover CORS                                                                                                                                           |
| `NEXT_PUBLIC_ALLOW_INDEXING`                  | `true` = nincs noindex-kapu                                                                                                                                |
| `NEXT_PUBLIC_BARION_PIXEL_ID`                 | BP-…-.. ; BPT- **nem** Pixel                                                                                                                               |
| `NEXT_PUBLIC_META_PIXEL_ID`                   | Meta Pixel (csak számjegy); csak consent után tölt, üresen a CSP sem nyílik                                                                                |
| `FIRST_USER_BOOTSTRAP_TOKEN`                  | első owner, min. 32; hiány/rövid = 503, rossz header = 403, fiók nincs                                                                                     |
| `TRUST_CF_CONNECTING_IP`                      | Cloudflare IP-hitelesség                                                                                                                                   |
| `SEED_SCOPE`                                  | `kezdolap` = szűkített **írás** (éles URL-en is). Üres + nem-éles URL = teljes seed **ír**                                                                 |
| `SEED_CONFIRM_LIVE`                           | `igen` = teljes seed éles URL-en. Hiány éles URL-en = a seed el sem indul, nem dry-run                                                                     |
| `LOG_LEVEL`                                   | debug\|info\|warn\|error                                                                                                                                   |
| `CONTACT_STAFF_EMAILS`                        | űrlap-értesítő                                                                                                                                             |
| `POSTHOG_SHARED_DASHBOARD_URL`                | admin webanalitika iframe; újrabuild                                                                                                                       |
| `TRUSTED_PROXY_HOP_COUNT`                     | `x-forwarded-for` hop jobbról; üres = 1                                                                                                                    |
| `EMAIL_JOB_ARGS`                              | `railway.email-job.json` script-argumentum; futás után ürítsd                                                                                              |
| `EMAIL_FROM`                                  | küldő cím; levélküldő mellett kötelező (boot-hiba nélküle)                                                                                                 |
| `IMPORT_CUSTOMERS_CSV_GZ_B64`                 | `scripts/import-job.sh` bemenete (`railway.import-job.json`); futás után ürítsd. Az `.env.example` még nem jelöli                                          |
| `NEXT_PUBLIC_POSTHOG_KEY`                     | a kliens és a szerveroldali `site_feedback` capture is ezt használja, új titok nem kell                                                                    |
| `MIGRATION_NOTICE_CONFIRM`                    | `igen` = éles migrációs levél                                                                                                                              |
| `DEMO_MODE`                                   | `1` = `seed:demo` futhat; **éles Kineticare-en tilos**                                                                                                     |
| `OWNER_*` kapuk                               | `OWNER_CONTENT_CONFIRM`, `OWNER_BACKFILL_CONFIRM`, `OWNER_TUDASTAR_CONFIRM` stb.: írás csak `…=igen`; hiány = próbafutás. **Nem** vonatkozik a `SEED_*`-ra |
| `LEGACY_RESTORE_CONFIRM` / `LEGACY_OVERWRITE` | legacy restore kapuk                                                                                                                                       |
| `MENU_SEED_DRY_RUN`                           | `igen` = menü-seed próba                                                                                                                                   |
| `E2E_EXPECT_ANALYTICS`                        | `1` = consent E2E valódi PostHog/GA4-et vár                                                                                                                |

`NEXT_PUBLIC_GOOGLE_ADS_ID` üresen marad, amíg az `ad_storage` tiltás él.
A kulcsnevek kanonikus listája (érték nélkül): `.env.example`.

---

## 13. Deploy, CI, üzemeltetés

**Production:** csak a Railway `Kineticare` appservice, az adatbázis a
kötettel futó `Postgres-c8Rg` (`DATABASE_URI` =
`${{Postgres-c8Rg.DATABASE_URL}}` referencia). Config: `railway.json`
(RAILPACK `0.38.0`, explicit `node ./node_modules/next/dist/bin/next
build`, start: `node ./node_modules/payload/bin.js migrate && exec node
./node_modules/next/dist/bin/next start`, healthcheck `/admin` 300 mp,
1 replica). A config-as-code **felülírja** a dashboardot a fájlban
szereplő kulcsokra. A legacy Config as Code út 2026-12-01-ig él, az
átállás menete a `CLAUDE.md` 14. pontjában.

Az új platform ma csak a Railway-hoston érhető el: a `kineticare.hu`
átállás nyitott (`docs/kineticare-hu-atallas.md`), addig a middleware
`NEXT_PUBLIC_ALLOW_INDEXING=true` nélkül noindexet küld.

Migrációk: 40 generált migráció a `src/migrations/` alatt (+ `index.ts`,
`.checksums.json`). A legutóbbi három: `20260922_225015_film_hero_feliratok`
(filmHero feliratmezők), `20260923_073659_kep_helyek` (fríz- és
jelenet-fotóhelyek), `20260923_083202_a_csapat_blokkmezok` (Ajánlat-kártyák
táblái, `hatterFelirat`, CTA-sáv `kep`). Mind a Payload eszközével
generált, pages + `_pages_v` párban. A start-parancs deploykor futtatja
őket.

A „SUCCESS" deploy nem jelenti, hogy az új kód fut — keress tényleges
lokális Next buildet, ne `Build · skipped`. Start-log: `Migrating:` /
`Migrated:` vagy `Reading migration files` + `Done.`. Health: `GET /admin`.

`WAITING` snapshot nélkül: előbb a lépés-események, ne vak redeploy
(CLAUDE.md 12).

**Kineticare-demo kivezetve** (2026-08-29). Oda semmit. A demo Postgres
és a régi kötet nélküli `Postgres` békén hagyandó.

**CI** (`.github/workflows/`):

- `ci.yml` — **verify** (Postgres 18 service): Railpack-plan fixture →
  review-zott install → typecheck → `generate:types` egyezés →
  `payload migrate` → vitest → eslint. Checkout `fetch-depth: 0` (G3).
  A DB-kapus tesztek CI-ben **dobnak**, ha nincs Postgres
  (`db-gated-coverage-guard.test.ts`). **build** (eldobható ál-env).
  **audit:** `npm audit --audit-level=high`. Dependabot: heti npm +
  Actions; `@payloadcms/*` ignore.
- `gitleaks.yml` — teljes history, `fetch-depth: 0`, CLI 8.24.3
- `db-backup.yml` — age-titkosított dump; fail-closed, ha hiányzik a
  `DATABASE_URI` secret / `BACKUP_AGE_RECIPIENT`
- `claude.yml` — opcionális `@claude`

Migráció-őrök: `docs/ci-orok.md`. G3: meglévő migráció immutábilis;
új pár + `npx tsx src/scripts/update-migration-checksums.ts`.

pg pool (`payload.config.ts`): keepalive, idle 30s, statement/query 30s,
`idle_in_transaction_session_timeout` 60s, `pool.max` **szándékosan
nincs** (W3). A pool `error` eseményét kezelni kell.

Média: élesben volume. Induláskor `ensureMediaFiles` a repó-forrásból
visszatölti a hiányzó fájlt, az id megmarad.

**Egyszeri Railway-job konfigok** (a dashboardon a szolgáltatás
`railwayConfigFile` mezője mutat rá; a `railway.json` a webappé):

| Fájl                        | Feladat                                                                                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `railway.json`              | Production webapp (`Kineticare`)                                                                                                                                                                              |
| `railway.email-job.json`    | Migrációs értesítő; args: `EMAIL_JOB_ARGS`                                                                                                                                                                    |
| `railway.seed-job.json`     | `seed-menu` + `restore-legacy-content`                                                                                                                                                                        |
| `railway.content-job.json`  | `content-job` szolgáltatás: `apply-owner-content.ts` (a kapu `OWNER_CONTENT_CONFIRM` a szolgáltatás env-jében); a napló `CONTENT_JOB_START` / `OWNER_CONTENT_OK` / `CONTENT_JOB_DONE` sorai jelzik a lefutást |
| `railway.tudastar-job.json` | Tudástár-import                                                                                                                                                                                               |
| `railway.import-job.json`   | Vevő-import (`scripts/import-job.sh`, bemenet: `IMPORT_CUSTOMERS_CSV_GZ_B64`)                                                                                                                                 |
| `railway.legacy-job.json`   | Legacy restore                                                                                                                                                                                                |
| `railway.demo.json`         | Történeti; a demo kivezetve, ne kösd vissza                                                                                                                                                                   |

A `create-deployment` **új service-t** hoz létre, nem a meglévőt
deployolja (CLAUDE.md 13). Meglévő újraindítás: `redeploy` vagy a
Railway agent `restartServiceTool`.

---

## 14. Dokumentum-katalógus

Csoportosítva; a teljes lista a `docs/` alatt. **Ne találj ki** Ads-
fiókállapotot ezekből.

A `docs/` gyökerében 104 markdown (almappákkal 119). **Elavultnak
kezeld, ha a dátum régi és a kód más:** `informacios-architektura.md` /
`gomb-inventar.md`
(2026-08-16 leltár), `atadas-szamlazz-kor.md` G1–G4 szakasza (az őrök
azóta megvannak), `owasp-security-review.md` (2026-08-04),
`feladatlista.md` A/B sorai (későbbi owner-UI / Railway sok mindent
lerakott). Kampánydoksi ≠ Ads Enable.

**Ügynök / szabály:** `ugynok-kezikonyv.md` (ez), `claude-indito-prompt.md`
(Claude első üzenet), `agent-feature-map.md`, `ci-orok.md`,
`feladatlista.md`, `repo-figyelo/`.

**UX / UI (felület előtt):** `ertekesitesi-ux-skill.md`,
`ui-sztenderdek.md`, `gomb-inventar.md`, `gomb-kontraszt-audit.md`,
`informacios-architektura.md`, `ux-hierarchia-audit.md`,
`felhasznaloi-seta.md`, `ux-belso-oldalak-kutatas.md`,
`szerkesztoi-utmutato.md`, `szekcio-rendszer-terv.md`,
`kezdolap-ux-audit-2026-09-07.md`, `course-details-layout.md`,
`course-package-content-ux.md`.

**Szerkesztés / tartalom-javítás:** `mi-hol-szerkesztheto.md` (látott
elem → mező vagy kód), `video-szovegek-szerkesztese.md`,
`owner-content-2026-09-19.md`, `owner-content-2026-09-22.md`,
`akcios-kurzus-2026-09-20.md`, `course-unlisted.md`.

**Fizetés / számla / hozzáférés:** `barion-sandbox-setup.md`,
`barion-pixel-jogi-szovegterv.md`, `szamlazz-*.md`,
`atadas-szamlazz-kor.md`, `refund-*.md`, `access-grants-backfill.md`,
`ar-snapshot-backfill.md`, `manualis-vasarlas-hozzaadas.md`,
`vasarlo-migracio-terv.md`, `jelszo-politika.md`.

**Videó:** `video-platform-dontes.md`, `video-stream-keszenlet.md`,
`hero-video-feltoltes.md`, `admin-video-ux.md`.

**SEO / tartalom / Ads (tervezet, nem Enable-parancs):** `seo-geo-llm.md`,
`kulcsszavak.md`, `tudastar-*.md`, `cikkek/`, `adwords-kampany.md`,
`h-ih-kulcsszavak-draft.md`, `kampanyterv-mert-adatokbol.md`,
`vevohang-es-hirdetesszoveg.md`, `monid-*.md`, `orokolt-url-atiranyitasok.md`,
`kineticare-hu-atallas.md`.

**Analitika:** `posthog.md`, `ga4.md`, `consent-e2e.md`.

**Deploy / biztonság / review:** `deploy-railway.md`, `adatbazis-mentes.md`,
`owasp-security-review.md`, `review-2026-08-2*.md`, `e2e-*.md`,
`audit-javitasok-20260908.md`, `demo-kornyezet.md` (történeti).

**Piac / owner UI auditok:** `piaci-strategia.md`, `owner-ui-*.md`,
`oldal-audit-*.md`, `kc-v1-*.md`.

A `docs/informacios-architektura.md` **leltár és diagnózis** egy régi
commithoz — a „kosár/fiók árva, 404 üres" sorok egy része azóta megvan
javítva. Mai igazság: ez a kézikönyv + a tesztek + az élő HTML.

---

## 15. Amit a feladatlista szerint még nyitott

A mérvadó lista a `docs/feladatlista.md`; ha ütközik ezzel a
szakasszal, az nyer. A K1–K6 / W1–W20 / J2 kódja a `main`en van (#148).
A 2026-08-30-i állapotból maradt:

- **W3:** Railway `max_connections` × replica mérése; `pool.max` szándékos
  nyitva.
- **C6:** consent E2E harness kész; staging valódi PostHog/GA4 kulccsal
  hátra (`E2E_EXPECT_ANALYTICS=1`).
- **C10:** Dependabot-kör figyelése.
- **C14:** backup kód kész; **offsite restore drill emberi kapu**
  (GitHub secret + age recipient + próba-restore).
- **C15–C17:** tartalmi SEO, prompt-portfólió, bot-védelem — Katák /
  üzemeltetés.
- **A2–A8 / B1–B9:** tartalom és integrációs kulcsok, nem kódlyukak.
- **D:** többnyelv, kupon, tagság, PWA — nincs kérés.

Ads Enable / spend: térkép-only, ne kódold.

Későbbi maradék: `docs/oldal-audit-osszefoglalo-2026-09-07.md`
(P1–P3 UX), `docs/kc-v1-remaining-inputs.md` (portré, logo, éles promo),
`HERO_VIDEO_STREAM_ID` még `null`. A `docs/video-stream-keszenlet.md`
a Bunny-kulcsokra nézve újabb, mint a feladatlista B4 sora.

A kódból mérhető nyitott pontok (2026-09-23):

- **Domain-átállás** (`kineticare.hu`): nyitott, emberi és DNS-lépés;
  `docs/kineticare-hu-atallas.md`.
- **Szakkönyv vásárlási címe:** `SZAKKONYV_URL = null`
  (`src/lib/szakembereknek.ts`), a tulajdonostól várjuk.
- **`promoOriginalPriceHuf` oszlop** rejtett örökség; megszüntetése
  külön PR-ben, generált migrációval, miután a content-job
  `akcios-ar-atallas` szabálya átvitte az értéket.
- **Deploy-feltételes content-job szabályok** (`sin-elrendezes`,
  `sos-cim`): a hozzájuk tartozó kódváltással egy deployban kell élesen
  futniuk; a futás tényét a `content-job` naplója igazolja, nem a merge.

---

## 16. Gyakori csapdák (élesben mérve)

A teljes lista a `CLAUDE.md` „Üzemeltetési tanulságok". A sűrűek:

1. SUCCESS deploy + skipped build = régi `.next/`.
2. `railway.json` felülírja a dashboard start/build/health kulcsait.
3. Kötet nélküli Postgres restart = üres DB. A régi `Postgres`
   szolgáltatás ilyen — ne nyúlj hozzá. Élő: `Postgres-c8Rg`.
4. `payload migrate` nem futtatja újra a lefutottat. Hiányzó tábla +
   „Done" = nem az a baj, amire gondolsz.
5. 30+ mp írásnál = sorzár, nem lassú query. Olvasás gyors marad.
6. Tétlen TCP a Railway privát hálón: keepalive nélkül ~45 mp timeout.
7. Első user csak érvényes bootstrap-tokennel owner. Token vagy header
   nélkül a fiók nem jön létre (503 / 403). A 2. user customer.
8. Lockfile `resolved` URL-jei legyenek publikus registry-n.
9. `robots.ts` / `sitemap.ts` csak `src/app/` gyökérből.
10. Tesztből ne hívd a valódi Számlázz.hu-t / Bariont.
11. Idézőjel a `git commit -m`-ben eltöri a commitot, a stage megmarad.
12. `git add -A` futó ügynök mellett csonk fájlt commitolhat — a
    typechecket a stage-re futtasd.
13. Dev push ki. Friss DB-n migrate, aztán `npm run dev`.
14. Unix socket path túl hosszú a scratchpadben — Postgres TCP-n
    (`127.0.0.1`), socket ki.
15. Squash-merge után a branch nem őse a mainnek — `git diff` a tartalomra.
16. `new Request(request, …)` a route-handler kérésén Node 24-en
    TypeError (Next Proxy + undici `#state`): minden Payload REST-írás
    500 lett (#289 → #290). Az új kérést URL-ből és explicit mezőkből
    építsd.
17. Az onInit beállt rendszeren nem pótol kezdőlapot vagy véleményt
    (#293). Ha „eltűnt” a kezdőlap, az szerkesztői döntés vagy
    webcímcsere, nem boot-hiba; célzott pótlás: `npm run seed`.

---

## 17. Skillök és ügynökök

| Mikor                         | Mit tölts be                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| Bármely vevői UI              | `.claude/skills/termektervezes/SKILL.md` + `docs/ertekesitesi-ux-skill.md`            |
| Élő storefront GET-ellenőrzés | `.cursor/skills/verify-kineticare/SKILL.md` — Railway, ne www.kineticare.hu (Systeme) |
| Teljes `main` Bugbot          | `.cursor/agents/kineticare-bugbot.md` — nem feature-PR diffre                         |
| Cikk-CTA / Ads-zár            | `docs/agent-feature-map.md` + a négy őr-teszt                                         |

Alap modellkiosztás (tulajdonosi, 2026-08-22): vezető Sol xhigh,
csapat Grok 4.6 extra high. A `high` / `high-fast` Grok tilos.

---

## 18. Gyors fájltérkép

```
src/
  app/
    (frontend)/          storefront + saját API + next/preview
    (payload)/           /admin + Payload REST catch-all
    robots.ts sitemap.ts llms.txt  ← GYÖKÉR, ne a groupba
  collections/           Users, Pages, Posts, Menus, …
  access/                szerepkörök, publishedOrAdmin, streamAssetRead
  blocks/                CMS blokk-definíciók
  components/            ui, layout, blocks, content, courses, checkout,
                         account, auth, analytics, admin, editor,
                         feedback, error, preview, motion, scroll-scrub
  fields/                course-modules, course-slug, seo-keywords, slug
  jobs/                  tasks + queues
  lib/                   ÜZLETI LOGIKA — ide írj (admin/: admin-igazság)
  plugins/               ecommerce, audit, admin-groups
  migrations/            GENERÁLT — ne szerkeszd
  scripts/               seed, import, backfill, grant
  __tests__/             vitest
  payload.config.ts env.ts middleware.ts instrumentation.ts
docs/                    magyar döntési és üzemeltetési doksik
content/home-images/     kezdőlap seed képek (brand, site)
public/                  fontok, statikus
```

Ha egy viselkedést két helyen is megtalálsz, a `src/lib/` a forrás, a
route/komponens a héj. Ha a CMS és a kód ütközik: a **publikált CMS**
a látogatói szöveg, a kód a szerkezet, a CTA-szótár a gomb, a
`resolveCourseAccess` a kapu, a Barion v4 a pénz.

### Hol szerkeszd

| Amit változtatnál                              | Első fájl                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| Kezdőlap szekciósorrend                        | CMS `kezdolap.layout`; fallback `HomeView`; seed `home-seed.ts`                       |
| Új CMS-blokk                                   | `src/blocks/*` + `pageBlocks` + `RenderBlocks` + a renderer saját CSS-e               |
| Gombfelirat                                    | `docs/ui-sztenderdek.md` §3.2 → `cta-vocabulary.ts` → őr                              |
| Fejléc tételek                                 | Payload `menus` + `withCoursesNavItem` (a Kurzusok kód)                               |
| Kurzus-CTA                                     | `resolveCourseCta` — ne forkolj másodikat                                             |
| Cikk végi CTA                                  | `post-article.ts` + `PostCourseCta` + `post-view.css`                                 |
| Tipográfia méret                               | `tokens.css` L/M/S — más font-size token tilos                                        |
| 404 szöveg                                     | `not-found-content.ts` (mindkét not-found fa)                                         |
| Fizetés jóváhagyása                            | `applyBarionStateTransition` + GetState v4                                            |
| Hozzáférés adása                               | `grantPurchase` / `grantFreeCoursesToUser` / paid-ág                                  |
| Új POST API                                    | same-origin + body cap + `ROUTE_CLASS_BY_PATH`; Barion callback-et ne tedd oda        |
| Séma                                           | `payload migrate:create` + checksum script                                            |
| Admin custom nézet                             | `payload.config.ts` views + `ADMIN_UTAK` + `generate:importmap` + kapu a nézetben     |
| Admin-szöveg (Payload-fordítás)                | `src/lib/admin/hu-forditas.ts` (csak az eltérő kulcs)                                 |
| Admin oldalsáv-sorrend / csoportnév            | `src/plugins/admin-groups.ts`                                                         |
| Szekció sorcímkéje (admin és szalag közös)     | `src/lib/section-row-label.ts` + a blokk `withSectionAdmin` burkolója                 |
| Mélylink az adminba                            | `szekcioMelylink` (`src/components/editor/szekcio-melylink.ts`), ne építs saját URL-t |
| Kezdőlapi videó felirat alapszövege / plafonja | `src/lib/film-captions.ts`                                                            |
| Beépített fríz- vagy jelenetfotó               | `src/lib/foto-friz.ts`, `src/blocks/course-cards.ts`, `src/lib/kep-helyek.ts`         |
| Tudástár-kapcsoló szabálya                     | `src/lib/tudastar-kapcsolo.ts` (egy helyen)                                           |
| Kapcsolati e-mail tartaléka                    | `KAPCSOLATI_EMAIL_TARTALEK`, `src/lib/contact-email.ts`                               |
| Élő adat egyszeri javítása                     | új szabály az `apply-owner-content.ts`-ben (tiszta modul + teszt), próbafutással      |

Tartalom-forrás a repóban: `docs/cikkek/` (10 törzs: hét kéz-cikk,
váll, két tulajdonosi piszkozat), `content/home-images/` (brand + site;
Higgsfield tükör tilos), `public/media/film/` (helyi hero),
`public/media/team/` (csapat- és fríz-fotók, `manifest.json` az
alt-szövegekkel és méretekkel), `public/media/help-rail/` (a sín
fotói), `public/assets/brand/` (logócsomag, változtatás nélkül),
`public/assets/barion/` (hivatalos Smart Banner, ne módosítsd).
