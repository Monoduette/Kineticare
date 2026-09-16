# Kineticare — ügynök-kézikönyv

> **Kinek szól:** a következő kódoló ügynöknek, aki először nyitja meg a
> repót, vagy évek múlva nyúl hozzá. Nem termékterv, nem marketingdoksi.
> **Honnan a tartalom:** a 2026-09-16-i `main` (`7aefff9` környéke) élő
> forráskódja, plusz a `docs/` döntési dokumentumai. Screenshotból és
> kampányjegyzetből ne diagnosztizálj — a kód és a tesztek a bizonyíték.
> **Hogyan használd:** olvasd el a 0–4. szakaszt mindig. A 5. szakasztól
> ugorj arra a tartományra, amihez nyúlsz. A részletes, egy-témás doksik
> (`docs/`) ettől NEM szűnnek meg — ez a térkép, azok a mélyfúrások.

**Kapcsolódó, NEM helyettesített fájlok:**

| Fájl | Mit tart |
| --- | --- |
| `AGENTS.md` | Rövid szabálykönyv + parancsok + tilos zónák |
| `CLAUDE.md` | Ugyanaz bővebben; **ellentmondásnál ez a mérvadó** |
| `docs/agent-feature-map.md` | Cikk-CTA, Craft-sáv, Shop-sáv, Ads-zárak |
| `docs/feladatlista.md` | Mi van hátra (részben archív) |
| `docs/ertekesitesi-ux-skill.md` | Felületi munka előtt kötelező |
| `.claude/skills/termektervezes/SKILL.md` | Felületi munka előtt kötelező skill |
| `.cursor/skills/verify-kineticare/SKILL.md` | Élő storefront GET-ellenőrzés |

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

### Hol kezdj, ha X-et kérnek

| Kérés | Első fájlok | Ne nyúlj ide |
| --- | --- | --- |
| Fizetés / Barion / paid | `src/lib/checkout/start-checkout.ts`, `src/lib/order-status/apply-barion-state.ts`, `src/lib/barion-callback/` | `confirmOrder`, plugin `/payments/*` |
| Számla / stornó / helyesbítő | `src/lib/szamlazz/`, `src/jobs/tasks/` | kézi `invoiceStatus` írás, migráció |
| Videó / lejátszó / token | `src/lib/stream/`, `src/lib/curriculum/curriculum.ts`, `src/app/(frontend)/kurzusaim/[id]/page.tsx` | Bunny GUID a nyilvános RSC-payloadba hozzáférés nélkül |
| Hozzáférés / ajándék / lejárat | `src/lib/course-access.ts`, `src/lib/access-grants.ts`, `src/lib/grant-purchase.ts` | `users.purchases` admin-pipa, hamis paid rendelés |
| Kezdőlap / szekció | `src/blocks/`, `src/components/blocks/`, `src/lib/home-seed.ts` | meglévő kezdőlap-szekciósor felülírása seeddel |
| Cikk / hub / CTA | `src/components/content/PostArticle.tsx`, `PostCourseCta.tsx`, `docs/agent-feature-map.md` | orvosi szöveg, Ads-kreatív, A-gyökér 404-őr |
| Gomb / felirat | `src/lib/cta-vocabulary.ts`, `docs/ui-sztenderdek.md` §3.2 | új felirat szótár nélkül |
| Auth / jelszó | `src/collections/Users.ts`, `src/lib/security/` | GraphQL visszakapcsolás, access-szabály |
| Admin stat / videótár | `src/components/admin/`, `src/lib/statistics/`, `src/lib/stream/bunny-*` | access-szabály a custom view-n kívül |
| Deploy / Railway | `railway.json`, `docs/deploy-railway.md`, `CLAUDE.md` tanulságok | Kineticare-demo, régi kötet nélküli Postgres |
| Migráció | Payload `migrate:create` | meglévő `src/migrations/*.ts` szerkesztése |

---

## 1. Mi ez a termék

A **Kineticare** (kineticare.hu, éles appservice: Railway `Kineticare`)
kézrehabilitációs online kurzusplatform: webshop + Payload CMS + védett
videólejátszás. A tulajdonos Barna Norbert; a szakmai zálog a két Kata
(Kocsis Kata, Kiss Kata) — ők a tartalom és az orvosi állítások gazdái.

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

| Konstans | Kanonikus út | Szerep |
| --- | --- | --- |
| `COURSE_HOME_REHAB` | `/kurzusok/otthoni-kezrehab-program` | Fő fizetős program |
| `COURSE_SOS_KEZRELAX` | `/kurzusok/sos-kezrelax-villamkurzus` | Ingyenes SOS (lead-magnet) |

Az SOS **nem** Ads-lander és **nem** fizetett ajtó. A `/kezrelax` 308 ide.

**Stack (pinned, 2026-08-30 óta kormányzott):**

- Next.js `16.3.3` App Router, React `19.2.8`, TypeScript strict
- Payload CMS `3.88.0` + `@payloadcms/plugin-ecommerce` `3.88.0` (béta)
- `@payloadcms/plugin-form-builder` `3.88.0`, `@payloadcms/db-postgres`
- Node `24.20.0`, npm `11.19.0` (`engines` + `.nvmrc`, engine-strict)
- Vitest 4 (node), ESLint 9 + eslint-config-next, Prettier
  (`semi: false`, `singleQuote: true`, `printWidth: 100`)

A `@payloadcms/*` verzió **pontos**, `^` tilos. A lockfile-t ne generáld
újra. Verzióemelés csak emberi kérésre, külön PR-ben.

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

### 2.5 Pinned Payload/Next ne emeld

Pontos verzió, `^` tilos, lockfile-t ne írd újra.

### 2.6 További, kódból következő tilalmak

| Tilos | Hol / miért |
| --- | --- |
| `users.purchases` / `accessGrants` admin-pipa | field `create/update: () => false`; ajándék a grant-panelen |
| Hamis paid rendelés ajándékhoz | számlát indítana, duplavásárlást tiltana |
| GraphQL visszakapcsolás | megkerülné a jelszó-politikát és a rate-limitet |
| `console.log` | `src/lib/logger.ts` — redact-lista |
| `any` | `unknown` + szűkítés |
| Kikommentezett kód | kivétel: `src/scripts/seed.ts` TODO-i |
| Orvosi / Ads szöveg átírása a teszt zöldítéséhez | `docs/agent-feature-map.md` |
| Kineticare-demo deploy | 2026-08-29-től kivezetve |
| Régi kötet nélküli `Postgres` újraindítása | törli az adatot |
| Higgsfield koncepció-tükör visszahozása | `content/home-images/` csak brand+site |
| Új `pages` rekord a `/kurzusok` listához | a lista kód-oldal, Search-lock |
| Kézi videó-átmozgatás `videos` → `modules` | `npm run kurzus:videok-modulba` — különben a haladás nullázódik |
| `ad_storage` grantedre állítása | `docs/ga4.md`, Shop-sáv zár |
| Google Ads Enable / spend ebből a PRből | térkép-only, `docs/agent-feature-map.md` |

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

| `kind` | Mikor | Üzenet-konstans |
| --- | --- | --- |
| `expired` | lejárt óra | `accessExpiredMessage` |
| `lookup-failed` | fail-open / lookup hiba | `ACCESS_LOOKUP_FAILED_MESSAGE` |
| `grant-pending` | van paid order, még nincs purchase | `ACCESS_GRANT_PENDING_MESSAGE` |
| `not-purchased` | nincs purchase (vagy revoked) | `ACCESS_NOT_PURCHASED_MESSAGE` |

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
```

**A callback-payload önmagában NEM bizonyíték.** Csak a szerver-szerver
v4 GetState. A Barion 15 mp-en belül 200-at vár — ezért a handler nem
vár a GetState-re.

Zár-sorrend: `order:mutate` → email → `purchases:user:<id>`. Külső HTTP
a záron belül tilos. `withAdvisoryLock` (`src/lib/advisory-lock.ts`) +
`withUserPurchasesLock` (`src/lib/user-purchases-lock.ts`).

Barion státusz → rendelés (`mapBarionPaymentStatus`):

| Barion | Nálunk |
| --- | --- |
| `Succeeded` | `paid` |
| `Canceled` / `Expired` / `Failed` | `cancelled` |
| `Prepared` / `Started` / `InProgress` / `Waiting` | `payment_pending` |
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

| Amit a látogató lát | Honnan jön |
| --- | --- |
| Kezdőlap `/` | `pages` slug `kezdolap` + `layout` blokksor |
| `/szolgaltatasok`, `/rolunk`, jogi | `pages` + opcionális `layout` |
| Gyökér tünet-hub `/keztoalagut-szindroma` stb. | `pages` + a forrás-cikk törzse |
| Tudástár lista `/blog` | `posts` published |
| Cikk `/blog/{slug}` | `posts`; ha a hub publikált → 308 a gyökérre |
| Kurzuslista `/kurzusok` | `products` ahol `status === 'published'` |
| Kurzusoldal | `products` slug (vagy régi id → 308) |
| Menü | `menus` collection + kódbeli „Kurzusok" első tétel |
| Kapcsolat / hírlevél / időpont | form-builder `forms` + `form-submissions` |

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

További scriptek: lásd a 15. szakaszt.

### 4.3 Tesztelés

- Include: `src/**/*.test.ts` / `src/**/*.test.tsx` (mind
  `src/__tests__/` alatt, 350+ fájl). Alias `@/*` → `src/*`.
  DB-kapus fájlok CI-ben dobnak, ha nincs Postgres; helyben skip.
- **Tesztből SOSEM megy ki valódi hálózat.** HTTP-t injektálj
  (`postXml`, `queryByKulsoAzon`); `fetch`-et `vi.stubGlobal` +
  `afterEach(vi.unstubAllGlobals)`. Ahol hívásnak nem szabad futnia:
  hangosan dobó mock.
- Komponens: `renderToStaticMarkup` (oxc automatic JSX, pragma nélkül).
- Új viselkedéshez fókuszált teszt.

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

| Téma | Teszt |
| --- | --- |
| `confirmOrder` / plugin `/payments/*` | `src/__tests__/ecommerce-payments-guard.test.ts` |
| Migráció immutábilis + séma-drift | G1–G4: `schema-drift-guard`, `schema-config-sync`, `migration-immutability`, `migration-integrity` |
| Őrfájlok léteznek | `guard-files-integrity.test.ts` |
| Titok nem a naplóban | `security/seed-secret-logging.test.ts`, `security/logger-redact.test.ts` |
| Cikk-CTA / Craft / Shop zár | `tudastar-cikkoldal.test.tsx`, `craft-lane-zarak.test.tsx`, `shop-lane-zarak.test.tsx` |
| CTA-szótár / gondolatjel | `cta-vocabulary-guard.test.ts` |
| Örökölt URL | `orokolt-url-atiranyitasok.test.ts` |
| Exact Node / lockfile / `npx payload` | `ci-platform-security-guard.test.ts` |
| Kézikönyv + mutatók megmaradnak | `ugynok-kezikonyv.test.ts` |

---

## 5. Storefront útvonalak

A `docs/informacios-architektura.md` 2026-08-16-i leltár. Azóta változott:
van `AccountNav` (kijelentkezve `/belepes`, bent fiókmenü), a 404 nem
üres (`global-not-found.tsx` + `NotFoundView`), a „Kurzusok" a menü
első sima tétele (WP36). Az alábbi a **mai** térkép.

### 5.1 Nyilvános

| Útvonal | Fájl | Mi ez | Adat |
| --- | --- | --- | --- |
| `/` | `(frontend)/page.tsx` | Kezdőlap, `HomeView` | `getHomePage` + products/posts/testimonials; `force-dynamic` |
| `/kurzusok` | `kurzusok/page.tsx` | Lista, `?kategoria=` | `status===published`; Search-lock keywords |
| `/kurzusok/[slug]` | `kurzusok/[slug]/page.tsx` | Értékesítési oldal | slug vagy numerikus id → 308 kanonikusra; UTM megmarad |
| `/blog` | `blog/page.tsx` | Tudástár lista | published posts |
| `/blog/[slug]` | `blog/[slug]/page.tsx` | Cikk | hub publikált → 308 `/{hub}`; CTA: `PostCourseCta` |
| `/blog/kategoria/[slug]` | `blog/kategoria/[slug]/page.tsx` | Szűrt lista | üres kategória: noindex, robots.txt NEM tiltja |
| `/kapcsolat` | `kapcsolat/page.tsx` | CMS layout (`RenderBlocks`) | Élő lead: időpontkérő blokk. A `ContactForm` **nincs** a lapon (őr: `kapcsolat-idopontkeres.test.tsx`). Üres layout = csak H1. |
| `/[slug]` | `[slug]/page.tsx` | CMS-oldal / hub | `pages`; hub: forrás-cikk élménye |
| `/akcios-kurzus` | `akcios-kurzus/page.tsx` | Demo lander | `DEMO_COURSE_SLUG`; **mindig noindex**, nem éles ajánlat |
| `/adatvedelem` `/aszf` `/impresszum` | `[slug]` | Jogi | lábléc |

Kitüntetett page-slug: `kezdolap` → a `/` viszi, nem a `/kezdolap`
(`HOME_PAGE_SLUG`, `src/lib/content-slugs.ts`).

### 5.2 Tranzakció

| Útvonal | Fájl | Megjegyzés |
| --- | --- | --- |
| `/kosar` | `kosar/page.tsx` | localStorage kosár (`kineticare-cart-v1`); noindex |
| `/penztar?termek={id}` | `penztar/page.tsx` | vendég is; ingyenes → kurzusoldali űrlap, nem checkout |
| `/fizetes/koszonom?order=` | `fizetes/koszonom/page.tsx` | Barion-visszatérés; **cím nem állíthat sikert**. Poll: `GET /api/orders/{n}/status` — csak belépett + saját rendelés (idegen 404, anon 401). |
| `/sikertelen` | `sikertelen/page.tsx` | sikertelen fizetés |

### 5.3 Auth és fiók

| Útvonal | Fájl | Hozzáférés |
| --- | --- | --- |
| `/belepes` | `belepes/page.tsx` | **indexelhető** (márka-keresés); sitemapben nincs |
| `/regisztracio` | `regisztracio/page.tsx` | indexelhető, sitemapben nincs |
| `/elfelejtett-jelszo` | `elfelejtett-jelszo/page.tsx` | noindex |
| `/jelszo-visszaallitas` | `jelszo-visszaallitas/page.tsx` | token; noindex |
| `/belepes-atallas` | `belepes-atallas/page.tsx` | átköltöztetett vevő; noindex; „újra fizetni NEM kell" |
| `/fiok` | `fiok/page.tsx` | belépett; 307 → `/belepes?returnUrl=` |
| `/kurzusaim` | `kurzusaim/page.tsx` | belépett; megvett lista |
| `/kurzusaim/[id]` | `kurzusaim/[id]/page.tsx` | numerikus product id; gate + curriculum; GUID szűrve |

`returnUrl` sanitizálás: `src/lib/return-url.ts`. Jelszó után egy SKU →
lejátszó, különben `/kurzusaim` (`postAuthLibraryOrPlayerHref`).

### 5.4 Admin, gépi, 404

| Útvonal | Fájl | Megjegyzés |
| --- | --- | --- |
| `/admin/[[...segments]]` | `(payload)/admin/` | Payload; staff/owner |
| `/admin/statisztika` | custom view | `StatisticsView`; kapu a nézetben |
| `/admin/videok` | custom view | `BunnyLibraryView` |
| `/admin/webanalitika` | custom view | `WebAnalyticsView` |
| `/next/preview` | `(frontend)/next/preview` | staff/owner; draft cookie |
| `/next/exit-preview` | `next/exit-preview` | draft ki |
| `/sitemap.xml` | `src/app/sitemap.ts` | **csak** `src/app/` gyökérből; `force-dynamic` |
| `/robots.txt` | `src/app/robots.ts` | AI-botok engedve; fiók/tranzakció tiltva |
| `/llms.txt` `/llms-full.txt` | `src/app/llms*.txt/route.ts` | LLM-olvasó |
| nem illeszkedő URL | `src/app/global-not-found.tsx` | `experimental.globalNotFound: true` kötelező |

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

| Gyökér | Forrás-cikk | Markdown |
| --- | --- | --- |
| `/keztoalagut-szindroma` | `keztoalagut-szindroma` | `docs/cikkek/2-…` |
| `/inhuvelygyulladas` | `inhuvelygyulladas` | `7-…` |
| `/teniszkonyok` | `teniszkonyok` | `3-…` |
| `/csuklo-es-kezfajdalom` | `csuklo-es-kezfajdalom` | `5-…` |
| `/kez-zsibbadas` | `miert-zsibbad-a-kezem` | `1-…` |
| `/pattano-ujj` | `pattano-ujj` | `4-…` |
| `/csuklotores-utani-gyogytorna` | `csuklotores-utani-gyogytorna` | `6-…` |
| `/befagyott-vall` | `befagyott-vall` | `8-…` |

Publikált hub → `/blog/{cikk}` 308 a gyökérre, a cikk kiesik a
sitemapből. Import: `npm run import:hubok`, publikálás
`OWNER_HUB_PUBLISH=igen`. Az Ads final cutover kézi, a fiókban.

A gyökér 404-e **nem** CI-invariáns (Ads-kapu). Részlet:
`docs/agent-feature-map.md`.

Tiltott hub-slugok: `HUB_TILTOTT_SLUGOK` (kezdolap, szolgáltatások,
kurzusok, kezrehab, kezrelax, kosar, …).

### 5.7 Kurzus-CTA állapotgép

Egy gép, három felület (PDP, kosár, pénztár). Forrás:
`resolveCourseCta` (`src/lib/courses.ts`). Második gépet ne írj.

| `kind` | Felirat | Cél | Mikor |
| --- | --- | --- | --- |
| `purchased` | `course-start` | `/kurzusaim/{id}` | élő hozzáférés |
| `archived` | nincs gomb | — | `status === 'archived'` |
| `free` | `Elindítom ingyen` | kurzusoldali űrlap, **nem** `/penztar` | `isFreeCourse` (`priceInHUFEnabled === false`) |
| `buy` | `Megveszem a kurzust` | `/penztar?termek={id}` | `isPaidCourse` |
| `unavailable` | nincs gomb | — | hiányos ár / nem published |

A NULL `priceInHUFEnabled` **nem** ingyenes.

### 5.8 Pénztár kapuk (UI, nem néma 400)

`penztar/page.tsx`: hiányzó/unpublished → kurzuslista; archived → „nem
vásárolható"; ingyenes → `FREE_COURSE_NOT_CHECKOUT_TEXT`; nem fizetős →
`UNAVAILABLE_COURSE_NOTE`. Submit: kötelező `billing` + két 45/2014
lemondó pipa + ÁSZF (`src/lib/checkout/form-submission.ts`). Függő
fizetés: `decidePendingCheckout` (resume / already-paid / cancel-and-restart
/ wait / fail-closed).

---

## 6. API-végpontok

A saját REST a `(frontend)/api/` alatt van, hogy a storefront originjén
éljen. A Payload catch-all a `(payload)/api/[...slug]`.

### 6.1 Saját storefront API

| Metódus + út | Handler | Ki | Mit tudj |
| --- | --- | --- | --- |
| `POST /api/checkout/start` | `lib/checkout/route-handler.ts` → `start-checkout.ts` | session vagy vendég | ár csak szerver; same-origin; rate `checkout-start` 10/10p |
| `POST /api/barion/callback` | `lib/barion-callback/` | Barion | azonnali 200+dedup; **nincs** globális IP-limit; ismeretlen GUID: `barion-callback-unknown` 20/10p |
| `GET /api/stream-token` | `lib/stream/route-handler.ts` | belépett vevő | `?productId=&videoId=`; 401/403/404/409/429/503 magyarul; `Cache-Control: no-store`; rate 60/perc/user. **GET, nem POST.** |
| `POST /api/course-progress/mark-watched` | `lib/course-progress/route-handler.ts` | belépett vevő | `{ productId, videoRef }`; `videoRef` stabil, nem sorszám; rate 60/perc |
| `GET /api/orders/{orderNumber}/status` | `lib/checkout/order-status-handler.ts` | belépett, **saját** rendelés | `{ status, productId, totalHufSnapshot, currency }` + opcionális `paymentReviewRequired`. Idegen szám → 404. |
| `POST /api/free-course/request` | `lib/free-course/route-handler.ts` | nyilvános | név+email; honeypot; IP 5/10p + email 3/10p; first-user bootstrap elutasítva; 200 nem árulja el, létrejött-e a fiók |
| `POST /api/users/reset-password` | `lib/security/payload-rest-post.ts` | nyilvános | politika + rate; árnyékolja a Payload REST-et |
| `GET /next/preview` | `lib/preview/route-handler.ts` | staff/owner | draft cookie |
| `GET /next/exit-preview` | `lib/preview/exit-preview.ts` | — | draft ki |

### 6.2 Admin API (staff/owner, némelyik owner-only)

| Metódus + út | Mit |
| --- | --- |
| `POST /api/admin/grant-purchase` | Ajándék; ugyanaz a lock; új ajándéknál **kötelező** pozitív `accessDurationDays` |
| `POST /api/admin/orders/{orderNumber}/refund` | Owner-only; Barion refund + stornó/helyesbítő |
| `GET /api/admin/orders/{orderNumber}/refund` | Recovery státusz |
| `GET /api/admin/course-progress` | Kurzus-szintű haladás-stat |
| `GET /api/admin/user-progress` | Egy user haladása |
| `GET /api/admin/bunny-videos` | Védett/publikus tár lista; rate `bunny-videos` 20/perc |
| `GET /api/admin/bunny-videos/{guid}` | Videó részlet |
| `POST /api/admin/bunny-videos/{guid}/preview` | Előnézet-token |
| `POST /api/admin/bunny-uploads` + `/sign` | TUS feltöltés a védett tárba |

A route-fájlok vékonyak: `getPayload` + factory. A logika `src/lib/`-ben
van, injektálható, unit-tesztelt. A `@payload-config` alias a vitestben
nem mindig oldódik — ezért relatív import a route-okon.

### 6.3 Payload REST catch-all

`src/app/(payload)/api/[...slug]/route.ts`:

- Minden POST a `createProtectedPayloadPost`-on (IP rate-limit + login
  CSRF + reset-árnyék).
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

| Keret | Limit |
| --- | --- |
| `registration` | 5 / 10 perc |
| `password-forgot` + `-email` | 3 / 10 perc |
| `password-reset` | 5 / 10 perc |
| `login` + `login-email` | 10 / 10 perc |
| `checkout-start` | 10 / 10 perc |
| `form-submission` | 5 / 10 perc |
| `stream-token` / `course-progress` | 60 / perc / user |
| `bunny-videos` | 20 / perc |
| `barion-callback-unknown` | 20 / 10 perc |
| `cart-write` | 30 / 10 perc |

A valódi Barion-callback **nincs** az útvonal-táblában.

Same-origin a sütis saját POST-okon: `src/lib/security/same-origin.ts`.
Hiányzó Origin ÉS Referer: átengedés (curl/teszt). Böngészős POST-on az
Origin mindig megy.

---

## 7. Payload: collectionök és pluginok

### 7.1 Saját collectionök (`src/collections/`)

| Slug | Fájl | Csoport | Lényeg |
| --- | --- | --- | --- |
| `users` | `Users.ts` | Felhasználók | role, purchases (írás zárt), accessGrants (írás zárt), billing, `passwordSetupPending`, `migrationNoticeSentAt`; első user owner bootstrap-tokennel |
| `media` | `Media.ts` | Tartalom | alt kötelező; webp; max 10 MB; `PAYLOAD_MEDIA_DIR` |
| `pages` | `Pages.ts` | Tartalom | drafts + saját status; `layout` blokksor; preview |
| `posts` | `Posts.ts` | Tartalom | ugyanez; hero, author, related, categories |
| `menus` | `Menus.ts` | Navigáció | max 2 szint; type-konzisztens cél; `visible` |
| `categories` | `Categories.ts` | Tartalom | blog vagy termék; slug a címből |
| `testimonials` | `Testimonials.ts` | Tartalom | csak VALÓS idézet; `visible` + `featured`; shortQuote ≤ 260 |
| `course-progress` | `CourseProgress.ts` | Webshop | user+product+videoRef unique; írás csak szerver; delete staff |
| `course-files` | `CourseFiles.ts` | Webshop | privát melléklet; fájlcsere tilos (beforeOperation) |
| `webhook-events` | `WebhookEvents.ts` | Rendszer | (provider, externalId) unique; dedup |
| `audit-logs` | `AuditLogs.ts` | Rendszer | owner-only read; rendszer ír |
| `refund-intents` | `RefundIntents.ts` | Rendszer | owner-only; CAS + activeOrderKey |

### 7.2 Plugin-collectionök (`src/plugins/ecommerce.ts` + form-builder)

| Slug | Lényeg |
| --- | --- |
| `products` | HUF, displayTitle, slug, saját `status`, modules+videos, accessDurationDays (owner), ár owner-only, streamAssetId rejtve |
| `orders` | orderNumber `KH-<év>-<6 jegy>`, totalHufSnapshot, barionPaymentId unique, invoice/storno/corrective mezők `denyFieldWrite` |
| `carts` | plugin; a storefront **nem** ezt használja (localStorage); rate-limit véd |
| `forms` / `form-submissions` | Kapcsolat / Hírlevél / Időpontkérés; szerződés a **űrlap címéből** |
| `payload-jobs` | staff/owner CRUD; belső queue `overrideAccess` |
| `payload-jobs-stats` | szanitizálás után zárva (`restrictJobStatsGlobalAccess`) |
| `payload-locked-documents` | ugyanez (`restrictLockedDocumentsAccess`) |

A plugin `variants` / `addresses` / guest-cart **ki**. Currency: `HUF`,
`decimals: 0`. `customers = users`.

Products admin-tabok: Alapadatok → Ár és hozzáférés → Kurzusoldal →
Tananyag → Haladás. UI-mezők (nincs séma): `courseVisibilityNotice`,
`courseEditorialChecklist`, `courseProgressPanel`, user oldalon
`purchasesOverview` + `grantPurchasePanel`.

### 7.3 Users szerepkörök

`owner` > `staff` > `customer`. Az „admin" a kódban staff+owner
(`hasStaffOrOwnerRole` / `isAdmin`).

- `role` mező: csak owner írja.
- Első user: `promoteFirstUserToOwner` + advisory lock +
  `FIRST_USER_BOOTSTRAP_TOKEN` (min. 32) a
  `x-kineticare-bootstrap-token` headerben. Enélkül az első fiók
  customer lenne, és senki nem jutna adminba.
- 2. usertől default `customer`. Adminhoz kézzel `staff`.
- Jelszócsere / e-mailcsere: a többi session meghal, a cserét végző sid
  megmarad (J2). `revokeOtherSessionsAfterCredentialChange`.
- Jelszó: min. 12, kis+nagy+szám, e-mail local-part tiltva
  (`src/lib/security/password-policy.ts`). A reset saját route, a
  GraphQL ki — a politika REST-tel sem kerülhető meg.

### 7.4 Űrlap-szerződések

Egy hooklánc, három séma. A fajtát a **űrlap címe** dönti el (DB), nem
a kliens mezői — különben a hívó a lazább szerződést választaná.
Ismeretlen → szigorúbb `contact`.

| Cím | Mezők | Levél |
| --- | --- | --- |
| Kapcsolat | név, email, tárgy, üzenet, consentPrivacy | staff (`CONTACT_STAFF_EMAILS`) |
| Hírlevél (`NEWSLETTER_FORM_TITLE`) | email, consentNewsletter | **nincs** staff-értesítő |
| Időpontkérés (`APPOINTMENT_FORM_TITLE`) | név, telefon, email, panasz, sávok, consentHealth | staff + visszaigazoló a kérőnek |

Turnstile: párban. Fél-lábas élesben boot-hiba. Mindkettő hiány: warn,
csak IP-keret.

### 7.5 Admin oldalsáv

`src/plugins/admin-groups.ts` sorrend: Tartalom → Navigáció → Webshop →
Űrlapok → Felhasználók → Rendszer. A plugin a lánc végén fut, hogy a
plugin-collectionöket is besorolja.

Custom view-k a Payload 3.88-ban nyilvános admin-route-ok — a kapu a
**nézetben** van, nem a config path-on.

Access-segédek (`src/access/`): `roles.ts`, `isStaffOrOwner.ts`,
`publishedOrAdmin.ts`, `menus-visibility.ts`,
`testimonials-visibility.ts`, `policies.ts` (a saját collectionök
politikáját az ecommerce-plugin pipeline `applyCollectionAccessPolicies`
teszi rá; a `users` politikája a `Users.ts`-ben él). **Ezeket csak
emberi review után szabad változtatni.**

Közös mezők (`src/fields/`): `slug.ts`, `course-slug.ts`,
`course-modules.ts`, `course-attachments.ts`, `seo-keywords.ts`.

i18n: `hu` fallback, `en` választható. FixedToolbar a Lexicalen.

### 7.6 onInit

`src/payload.config.ts` `onInit`: pool error-handler, Barion webhook-
processor, kezdőlap-baseline (képek+üres layout), Kapcsolat űrlap,
Hírlevél űrlap (best-effort), Időpontkérés űrlap (best-effort).
Meglévőt nem ír felül. DB-hiba nem viheti el a bootot.

`serverURL` **szándékosan üres** — beállítva abszolút media-URL, a
`next/image` 400. CORS/CSRF a `buildOriginAllowlist`-ből
(`NEXT_PUBLIC_SERVER_URL` + apex/www társ + `EXTRA_ALLOWED_ORIGINS`).

---

## 8. `src/lib/` — hol lakik az üzleti logika

A route-ok vékonyak. Ha viselkedést változtatsz, a `lib` a helye.

### Fizetés és rendelés

| Modul | Feladat |
| --- | --- |
| `checkout/start-checkout.ts` | Checkout indítás, lock, Barion Start, vendég |
| `checkout/billing.ts` / `guest.ts` | Számlázási / vendég validáció |
| `checkout/pending-payment.ts` | Folyamatban lévő fizetés újrafelvétele |
| `checkout/form-submission.ts` | Magyar hibamondatok |
| `order-status/apply-barion-state.ts` | Állapotgép (callback + poll közös mag) |
| `order-status/resolve-order-customer.ts` | Vendég-kötés; privileged fiókra tilos |
| `order-status/recover-paid-reject.ts` | Elutasított, de Succeeded fizetés helyreállítása |
| `order-paid.ts` | invoice job + visszaigazoló levél |
| `order-poll/service.ts` | Elveszett callback, árva lejárat, resweep |
| `order-number.ts` / `order-integrity.ts` | KH-szám, tétel-integritás |
| `barion/` | client, start v2, state v4, refund |
| `barion-callback/` | 200+dedup, after(), processor regisztráció |
| `payments/barion-adapter.ts` | Plugin-héj; confirmOrder dob |
| `refund/` | Intent főkönyv, Barion refund, recovery |
| `szamlazz/` | invoice / storno / corrective / xml / queue |
| `advisory-lock.ts` / `user-purchases-lock.ts` | Postgres advisory lock |
| `idempotency.ts` | webhook-events dedup |

### Hozzáférés és tananyag

| Modul | Feladat |
| --- | --- |
| `course-access.ts` | Tiszta óra + player gate |
| `course-access-lookup.ts` | DB-lookup, grant + order dátum |
| `access-grants.ts` | Grant-sorok, eligibility, fail-open |
| `grant-purchase.ts` + `grant-purchase-route.ts` | Kézi ajándék |
| `free-course/` + `free-course-grant.ts` | Ingyenes igénylés |
| `curriculum/curriculum.ts` | modules ∪ videos → egy modell |
| `course-progress/` | mark-watched, lookup, client |
| `stream/` | token, Bunny tár/upload, playerjs, contract |
| `courses.ts` / `course-url.ts` | cím, ár, CTA, kanonikus URL |
| `purchased-products.ts` | SKU-halmaz segéd |

### Storefront CMS és SEO

| Modul | Feladat |
| --- | --- |
| `cms.ts` | Local API getterek; `PUBLISHED_WHERE`; hiba → üres + warn |
| `menus.ts` / `menu-tree.ts` / `menu-seed.ts` | Menüfa; Kurzusok kódbeli első tétel |
| `home-seed.ts` / `home-help-states.ts` | Kezdőlap seed; meglévő layoutot nem ír felül |
| `hero-video.ts` | Publikus Bunny hero |
| `seo.ts` / `seo-graph.ts` / `seo-cikk.ts` / `seo-llms.ts` | meta, JSON-LD, llms.txt |
| `tudastar/` | hubok, FAQ, kulcsszó-lock, markdown→lexical |
| `legacy-redirects.ts` | 25 URL sorsa |
| `content-slugs.ts` | `kezdolap` |
| `cta-vocabulary.ts` | Gombfeliratok egyetlen forrása |
| `legal-content.ts` | Jogi fallback |
| `cart.ts` | localStorage kosár, `useSyncExternalStore` |

### Biztonság és e-mail

| Modul | Feladat |
| --- | --- |
| `security/csp.ts` | CSP tiszta függvény; build-időben sül |
| `security/rate-limit.ts` | Keretek |
| `security/same-origin.ts` / `login-csrf.ts` | CSRF |
| `security/password-policy.ts` / `reset-password-route.ts` | Jelszó |
| `security/revoke-other-sessions.ts` | Session-invalidálás |
| `security/activation-token.ts` | Vendég 7 nap |
| `email/provider.ts` | Resend → SMTP → noop |
| `email/templates/` | auth, order, appointment, migration |
| `logger.ts` / `request-id.ts` / `audit.ts` | Napló, ID, audit-írás |

### Egyéb

`admin/` (stat, progress, webanalitika kapu), `statistics/`,
`analytics/` (consent, PostHog, GA4, Barion Pixel), `appointment/`,
`newsletter/`, `preview/`, `migration-notice/`, `media-restore.ts`,
`migrations/destructive-migration-guard.ts`, `sos-offer.ts`,
`demo-course-route.ts`, `owner-review-v1.ts`, `gondolatjel-leftover.ts`
(tiltott kötőjel-maradvány őre).

---

## 9. Jobok

`src/jobs/index.ts`. Workerek: `ENABLE_JOB_WORKERS=true`. Dev-ben ki.
Élesben hiányzó flag → **warn** (`job_workerek_kikapcsolva`), nem
fail-closed boot.

| Task | Queue | Mikor | Mit |
| --- | --- | --- | --- |
| `webhook-retry` | `webhook-maintenance` | cron `* * * * *` | elhasalt callback újra |
| `order-poll` | `order-maintenance` | cron `*/5 * * * *` | GetState v4, árva, resweep |
| `invoice-issue` | `order-maintenance` | esemény (paid) | számla |
| `storno-issue` | `order-maintenance` | esemény (teljes refund) | stornó |
| `corrective-invoice-issue` | `order-maintenance` | esemény (részrefund) | helyesbítő |

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
3. `PostHogProvider` → PageView + `GoogleAnalytics` + `Header` +
   `<main id="tartalom">` + `Footer` + `ConsentBanner`.
4. `BarionPixelNoscript` a body végén (a skip-link után).

A Barion Pixel felhasználását a `bp('consent', …)` szabályozza, a
betöltését nem. PostHog/GA4 csak `granted` után.

A kezdőlap hero **Stream-videója ki van kapcsolva**:
`HERO_VIDEO_STREAM_ID === null` (`src/lib/hero-video.ts`). A film-sáv
helyi `public/media/film/`. Ne találj ki élő Bunny hero-GUID-ot.

Nincs CartProvider / AuthProvider. Kosár: `useCart()`. Auth: szerveren
`payload.auth({ headers })`, kliensen `auth-client.ts` + full page load
login után. A `/fiok` PATCH **sosem** küld `role` vagy `purchases` mezőt.

### 10.2 Komponensfa (`src/components/`)

| Mappa | Szerep |
| --- | --- |
| `ui/` | Button, Field, Card, Container, Section, Badge, PriceTag, Progress — primitívek, tokenekről |
| `layout/` | Header, Footer, DesktopNav, MobileNav, AccountNav, Newsletter* |
| `blocks/` | CMS-szekció renderelők (`RenderBlocks` + FilmHero, Usps, …) |
| `content/` | HomeView, PostArticle, PostView, ProductCard, JsonLd, HeroVideo, home/* |
| `content/PostCourseCta.tsx` | Cikk végi CTA — **csak** cikkoldalon |
| `courses/` | Buybox, BuyBar, Curriculum, Faq, FitCheck, PreviewVideo, FreeCourse* |
| `checkout/` | CheckoutForm, CartView, ThankYouView, BarionFizetesJelzes |
| `account/` | AccountView, CourseList, CoursePlayer + `player/` |
| `auth/` | Login / Register / Forgot / Reset formok |
| `analytics/` | Consent, PostHog, GA4, Barion, TrackEvent, ArticleEngagement |
| `admin/` | Stat, Bunny tár, refund, grant, progress, webanalitika |
| `campaign/` | DemoCourseLanding (`/akcios-kurzus`) |
| `error/` | NotFoundView |
| `lexical/` | RichText serialize |
| `preview/` | PreviewBar |
| `motion/` | AnchorScroll, SectionReveal |

A kezdőlap **két rendje** van: a CMS `layout` blokksor (élő) és a
`HomeView` fallback/help-state, ha a szekció hiányzik. A seed csak
**üres** szekciósornál ír.

### 10.3 Blokkok (`src/blocks/`)

Katalógus sorrendje = admin „+ Blokk" + ajánlott M1–M8:

`filmHero`, `credsStrip`, `courseCards`, `freeSos`, `pressLogos`,
`welcome`, `usps`, `states`, `services`, `about`, `howItWorks`,
`testimonials`, `knowledge`, `faq`, `teamMembers`, `accordion`,
`appointment`, `richText`, `ctaBanner`.

Közös: `sectionSettings` (háttér, horgony), `linkFields`. Terv:
`docs/szekcio-rendszer-terv.md`.

### 10.4 CSS

`(frontend)/styles.css` import-sorrend: tokens → fonts → base → motion
→ ui → progress → layout → content → consent → hibaoldal → checkout /
auth / account / kurzusaim / player. Új lapot a **rétegbe** tedd, ne a
gyűjtőbe.

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

`postCtaVariantOf`: `befagyott-vall` → egy panel (`idopont`); minden
más slug → `kurzus` (két testvér `.kc-post-cta__panel`, nincs
`kc-post-cta__pair`). Asztal 900 px-től kétoszlopos `:has` rács.

Két panelt a hét kéz-cikk visel (lásd `docs/agent-feature-map.md`).
A `/szolgaltatasok`, `/`, `/kurzusok` **nem** `.kc-post-cta`.

Őrök: `tudastar-cikkoldal.test.tsx`, `craft-lane-zarak.test.tsx`,
`shop-lane-zarak.test.tsx`.

Craft-sáv: a nyilvános HTML-ben nincs DOI/PMID, forrásjegyzék, Semrush,
Ahrefs, angol `volume`, „hivatalos táblázat". A kezdőlap nem Ads-lander.
Nincs kitalált orvosi ábra.

### 10.7 Analitika-események

`ANALYTICS_EVENTS` (`src/lib/analytics/posthog.ts`) — átnevezés bukik
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

Személyes adat az event-propertyben tilos. PostHog `/ingest` first-party
proxy (`next.config.ts` rewrites). Consent: `kc_analytics_consent` +
`kc_analytics_consent_at`. Ismeretlen → banner. Újra kérdez **365 nap**
után. `CONSENT_MODE_DEFAULT` minden tároló `denied`; granted csak
`analytics_storage`. `ad_*` sosem granted. A sticky buy bar a
`--kc-consent-offset` tokenre ül.

---

## 11. Scriptek

| npm | Fájl | Megjegyzés |
| --- | --- | --- |
| `seed` | `src/scripts/seed.ts` | Élesben tiltott, kivéve `SEED_SCOPE=kezdolap` vagy `SEED_CONFIRM_LIVE=igen`. Owner jelszó **kötelező** env, a script nem generál/naplóz jelszót. |
| `seed:demo` | `demo-seed.ts` | `DEMO_MODE=1`; éles domain tiltott; **nem** `confirmOrder` |
| `seed:legacy` | `restore-legacy-content.ts` | próba; írás `LEGACY_RESTORE_CONFIRM=igen`; felülírás `LEGACY_OVERWRITE=igen` |
| `seed:menu` | `seed-menu.ts` | `MENU_SEED_DRY_RUN=igen` = próba |
| `grant:purchase` | `grant-purchase.ts` | CLI ugyanarra a szolgáltatásra, mint a panel |
| `import:customers` | `import-customers.ts` | CSV; `docs/vasarlo-migracio-terv.md` |
| `import:tudastar` | `import-tudastar-cikkek.ts` | próba; írás `OWNER_TUDASTAR_CONFIRM=igen`; publ. `OWNER_TUDASTAR_PUBLISH=igen` |
| `import:hubok` | `import-hub-oldalak.ts` | piszkozat; publ. `OWNER_HUB_PUBLISH=igen` |
| `import:bunny-curriculum` | `import-bunny-curriculum.ts` | |
| `kurzus:videok-modulba` | `videok-modulba.ts` | **egyetlen** biztonságos átemelés |
| `backfill:ar-snapshot` | `backfill-price-snapshot.ts` | próba; írás `OWNER_BACKFILL_CONFIRM=igen` |
| `backfill:access-grants` | `backfill-access-grants.ts` | ugyanez |
| `content:owner` | `apply-owner-content.ts` | `OWNER_CONTENT_CONFIRM=igen` |
| `email:migracio` | `send-migration-notice.ts` | idempotens; `--force` újraküld |
| `backup:db` | `backup-db.ts` | `docs/adatbazis-mentes.md` |
| `generate:types` / `generate:importmap` | Payload | a CI: a generált `src/payload-types.ts` egyezzen a commitolttal |
| *(nincs npm alias)* | `update-migration-checksums.ts` | G3 manifest, ugyanabban a PR-ben |

A seed **sosem írja felül** a meglévő kezdőlap-szekciósorát, a meglévő
média-rekordot, kategóriát, oldalt, cikket, terméket, menüpontot, vagy a
Kapcsolat/Hírlevél/Időpont űrlapot. Teljes seed éles URL-en tiltott
(`SEED_CONFIRM_LIVE=igen` kivétel), és akkor is, ha a DB-ben van nem
`@example.com` vevő vagy rendelés. `SEED_SCOPE=kezdolap` élesen is
mehet: média-restore + kezdőlap + vélemények + űrlapok, demó-SKU nélkül.

---

## 12. Környezeti változók (csak kulcsnevek)

Kötelező boot (`src/env.ts` + `instrumentation.ts` `register()`):

`DATABASE_URI`, `PAYLOAD_SECRET`, `NEXT_PUBLIC_SERVER_URL`,
`BARION_API_URL`, `BARION_PAYEE_EMAIL`, plusz
`BARION_POSKEY_TEST` (ha nem prod) vagy `BARION_POSKEY_PROD` (ha
`BARION_ENVIRONMENT=prod`). Élesben `BARION_ENVIRONMENT` is kötelező
(hiányában némán teszt-Barion).

`NEXT_PUBLIC_SERVER_URL` alakja is boot-őr: abszolút http(s), záró
perjel nélkül. Erre épül CORS/CSRF, `metadataBase`, SEO.

Opcionális, degradált módban az app fut: Számlázz, Bunny, PostHog, GA4,
Turnstile (párban vagy sehogy), e-mail (nincs kulcs → noop).
`NEXT_PUBLIC_*` és a CSP **build-időben** égnek — változás után
újrabuild.

További, kódban élő, az example-ben is jelölt vagy jelölendő kulcsok:

| Kulcs | Szerep |
| --- | --- |
| `ENABLE_JOB_WORKERS` | `true` = cron workerek |
| `PAYLOAD_MEDIA_DIR` | élesben `/app/media` volume |
| `EXTRA_ALLOWED_ORIGINS` | DNS-cutover CORS |
| `NEXT_PUBLIC_ALLOW_INDEXING` | `true` = nincs noindex-kapu |
| `NEXT_PUBLIC_BARION_PIXEL_ID` | BP-…-.. ; BPT- **nem** Pixel |
| `FIRST_USER_BOOTSTRAP_TOKEN` | első owner, min. 32 |
| `TRUST_CF_CONNECTING_IP` | Cloudflare IP-hitelesség |
| `SEED_SCOPE` / `SEED_CONFIRM_LIVE` | seed hatókör / éles felülírás |
| `LOG_LEVEL` | debug\|info\|warn\|error |
| `CONTACT_STAFF_EMAILS` | űrlap-értesítő |
| `POSTHOG_SHARED_DASHBOARD_URL` | admin webanalitika iframe; újrabuild |
| `TRUSTED_PROXY_HOP_COUNT` | `x-forwarded-for` hop jobbról; üres = 1 |
| `EMAIL_JOB_ARGS` | `railway.email-job.json` script-argumentum; futás után ürítsd |
| `MIGRATION_NOTICE_CONFIRM` | `igen` = éles migrációs levél |
| `DEMO_MODE` | `1` = `seed:demo` futhat; **éles Kineticare-en tilos** |
| `OWNER_*` / `SEED_*` kapuk | írás csak `…=igen`; hiány = próbafutás |
| `LEGACY_RESTORE_CONFIRM` / `LEGACY_OVERWRITE` | legacy restore kapuk |
| `MENU_SEED_DRY_RUN` | `igen` = menü-seed próba |
| `E2E_EXPECT_ANALYTICS` | `1` = consent E2E valódi PostHog/GA4-et vár |

`NEXT_PUBLIC_GOOGLE_ADS_ID` üresen marad, amíg az `ad_storage` tiltás él.
A kulcsnevek kanonikus listája (érték nélkül): `.env.example`.

---

## 13. Deploy, CI, üzemeltetés

**Production:** csak a Railway `Kineticare` appservice. Config:
`railway.json` (RAILPACK, explicit `next build`, migrate+`next start`,
healthcheck `/admin`, 1 replica). A config-as-code **felülírja** a
dashboardot a fájlban szereplő kulcsokra.

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

| Fájl | Feladat |
| --- | --- |
| `railway.json` | Production webapp (`Kineticare`) |
| `railway.email-job.json` | Migrációs értesítő; args: `EMAIL_JOB_ARGS` |
| `railway.seed-job.json` | `seed-menu` + `restore-legacy-content` |
| `railway.content-job.json` | Owner content script |
| `railway.tudastar-job.json` | Tudástár-import |
| `railway.import-job.json` | Vevő-import |
| `railway.legacy-job.json` | Legacy restore |
| `railway.demo.json` | Történeti; a demo kivezetve, ne kösd vissza |

A `create-deployment` **új service-t** hoz létre, nem a meglévőt
deployolja (CLAUDE.md 13). Meglévő újraindítás: `redeploy` vagy a
Railway agent `restartServiceTool`.

---

## 14. Dokumentum-katalógus

Csoportosítva; a teljes lista a `docs/` alatt. **Ne találj ki** Ads-
fiókállapotot ezekből.

A `docs/` alatt ~107 markdown. **Elavultnak kezeld, ha a dátum régi és
a kód más:** `informacios-architektura.md` / `gomb-inventar.md`
(2026-08-16 leltár), `atadas-szamlazz-kor.md` G1–G4 szakasza (az őrök
azóta megvannak), `owasp-security-review.md` (2026-08-04),
`feladatlista.md` A/B sorai (későbbi owner-UI / Railway sok mindent
lerakott). Kampánydoksi ≠ Ads Enable.

**Ügynök / szabály:** `ugynok-kezikonyv.md` (ez), `agent-feature-map.md`,
`ci-orok.md`, `feladatlista.md`, `repo-figyelo/`.

**UX / UI (felület előtt):** `ertekesitesi-ux-skill.md`,
`ui-sztenderdek.md`, `gomb-inventar.md`, `gomb-kontraszt-audit.md`,
`informacios-architektura.md`, `ux-hierarchia-audit.md`,
`felhasznaloi-seta.md`, `ux-belso-oldalak-kutatas.md`,
`szerkesztoi-utmutato.md`, `szekcio-rendszer-terv.md`.

**Fizetés / számla / hozzáférés:** `barion-sandbox-setup.md`,
`barion-pixel-jogi-szovegterv.md`, `szamlazz-*.md`,
`atadas-szamlazz-kor.md`, `refund-*.md`, `access-grants-backfill.md`,
`ar-snapshot-backfill.md`, `manualis-vasarlas-hozzaadas.md`,
`vasarlo-migracio-terv.md`, `jelszo-politika.md`.

**Videó:** `video-platform-dontes.md`, `video-stream-keszenlet.md`,
`hero-video-feltoltese.md`, `admin-video-ux.md`.

**SEO / tartalom / Ads (tervezet, nem Enable-parancs):** `seo-geo-llm.md`,
`kulcsszavak.md`, `tudastar-*.md`, `cikkek/`, `adwords-kampany.md`,
`h-ih-kulcsszavak-draft.md`, `kampanyterv-mert-adatokbol.md`,
`vevohang-es-hirdetesszoveg.md`, `monid-*.md`, `orokolt-url-atiranyitasok.md`,
`kineticare-hu-atallas.md`.

**Analitika:** `posthog.md`, `ga4.md`, `consent-e2e.md`.

**Deploy / biztonság / review:** `deploy-railway.md`, `adatbazis-mentes.md`,
`owasp-security-review.md`, `review-2026-08-2*.md`, `e2e-*.md`,
`demo-kornyezet.md` (történeti).

**Piac / owner UI auditok:** `piaci-strategia.md`, `owner-ui-*.md`,
`oldal-audit-*.md`, `kc-v1-*.md`.

A `docs/informacios-architektura.md` **leltár és diagnózis** egy régi
commithoz — a „kosár/fiók árva, 404 üres" sorok egy része azóta megvan
javítva. Mai igazság: ez a kézikönyv + a tesztek + az élő HTML.

---

## 15. Amit a feladatlista szerint még nyitott

A `docs/feladatlista.md` 2026-08-30-i. A K1–K6 / W1–W20 / J2 kódja a
`main`en van (#148). Maradék:

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

Későbbi, a feladatlistában nem szereplő maradék: `docs/oldal-audit-osszefoglalo-2026-09-07.md`
(P1–P3 UX), `docs/kc-v1-remaining-inputs.md` (portré, logo, éles promo),
`HERO_VIDEO_STREAM_ID` még `null`. A `docs/video-stream-keszenlet.md`
a Bunny-kulcsokra nézve újabb, mint a feladatlista B4 sora.

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
7. Első user owner; a 2. customer.
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

---

## 17. Skillök és ügynökök

| Mikor | Mit tölts be |
| --- | --- |
| Bármely vevői UI | `.claude/skills/termektervezes/SKILL.md` + `docs/ertekesitesi-ux-skill.md` |
| Élő storefront GET-ellenőrzés | `.cursor/skills/verify-kineticare/SKILL.md` — Railway, ne www.kineticare.hu (Systeme) |
| Teljes `main` Bugbot | `.cursor/agents/kineticare-bugbot.md` — nem feature-PR diffre |
| Cikk-CTA / Ads-zár | `docs/agent-feature-map.md` + a négy őr-teszt |

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
                         account, auth, analytics, admin
  fields/                course-modules, course-slug, seo-keywords, slug
  jobs/                  tasks + queues
  lib/                   ÜZLETI LOGIKA — ide írj
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

| Amit változtatnál | Első fájl |
| --- | --- |
| Kezdőlap szekciósorrend | CMS `kezdolap.layout`; fallback `HomeView`; seed `home-seed.ts` |
| Új CMS-blokk | `src/blocks/*` + `pageBlocks` + `RenderBlocks` + a renderer saját CSS-e |
| Gombfelirat | `docs/ui-sztenderdek.md` §3.2 → `cta-vocabulary.ts` → őr |
| Fejléc tételek | Payload `menus` + `withCoursesNavItem` (a Kurzusok kód) |
| Kurzus-CTA | `resolveCourseCta` — ne forkolj másodikat |
| Cikk végi CTA | `post-article.ts` + `PostCourseCta` + `post-view.css` |
| Tipográfia méret | `tokens.css` L/M/S — más font-size token tilos |
| 404 szöveg | `not-found-content.ts` (mindkét not-found fa) |
| Fizetés jóváhagyása | `applyBarionStateTransition` + GetState v4 |
| Hozzáférés adása | `grantPurchase` / `grantFreeCoursesToUser` / paid-ág |
| Új POST API | same-origin + body cap + `ROUTE_CLASS_BY_PATH`; Barion callback-et ne tedd oda |
| Séma | `payload migrate:create` + checksum script |
| Admin custom nézet | `payload.config.ts` views + `generate:importmap` + kapu a nézetben |

Tartalom-forrás a repóban: `docs/cikkek/` (8 lektorálandó törzs),
`content/home-images/` (brand + site; Higgsfield tükör tilos),
`public/media/film/` (helyi hero), `public/assets/barion/` (hivatalos
Smart Banner, ne módosítsd).
