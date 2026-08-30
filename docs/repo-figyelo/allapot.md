# Állapot-pillanatkép

> Frissítve: **2026-08-30** · Alap-commit: `e8616c0` (`fix/security-next-16-3-3`)

> **Frissítési jegyzet (2026-08-30):** a fejléc, ez a bekezdés és a
> stack-tábla a mai állapotot tükrözi; a lentebbi részletes szakaszok a
> 2026-07-31-i mélyfelmérés pillanatképei — az azóta történteket a
> `naplo.md` kronológiája és a PR-történet fedi.

## Egy bekezdésben

A Kineticare egy kézrehabilitációs kurzusplatform: Next.js 16 (App Router) +
Payload CMS 3 monorepo egyetlen alkalmazásban, PostgreSQL adatbázissal. A
pénzügyi főlánc élesben jár: checkout-start → Barion → callback-vezérelt
állapotgép (+ utánpollozó job) → rendelés `paid` → `purchases`-jogosultság →
tokenes Bunny Stream videó, valamint owner-indítású (rész)visszatérítés
stornó/helyesbítő számlával (Számlázz.hu). A frontend teljes: filmsávos,
CMS-ből szerkeszthető kezdőlap, kurzusoldalak kanonikus slug-URL-ekkel,
fiók + kurzus-haladás, pénztár, kapcsolat-űrlap. Mellette: Resend-alapú
tranzakciós e-mail, GA4 + PostHog consent-kapuval, kérés-korlátozás,
audit- és webhook-infrastruktúra. A 2026-08-09-i „biztonsági kör 2" az élő
triázs-találatokat zárta (M-07, M-11, M-13, M-15 — ld. `megfigyelesek.md`);
nyitott: adatbázis-mentés (C14) és az M-12 emberi döntése.

## Stack és verziók

| Csomag | Verzió | Megjegyzés |
| --- | --- | --- |
| `payload`, `@payloadcms/db-postgres`, `@payloadcms/next`, `@payloadcms/plugin-ecommerce`, `@payloadcms/plugin-form-builder`, `@payloadcms/richtext-lexical` | `3.88.0` | **Pinned** — a Dependabot ezekre nem nyit PR-t (T-072) |
| `next` | `16.3.3` | |
| `react` / `react-dom` | `19.2.8` | |
| `typescript` | `5.9.3` | strict mód |
| `vitest` | `4.1.10` | `npm run test` |
| `eslint` | `9.39.5` | flat config (`eslint.config.mjs`) |

Node **24** (engines: `24.x`), PostgreSQL **16**, npm (lockfile commitolva,
legacy-peer-deps módban — ld. `.npmrc` és a `ci.yml` fejléc-kommentje).
Hosting: Railway (staging/prod), deploy nem a CI része.

## Modultérkép (`src/`)

```
app/(payload)/        Payload admin + REST/GraphQL route-ok
app/(frontend)/       Nyilvános felület — jelenleg csak API-route-ok:
  api/checkout/start/           POST — vásárlás indítása (T-021)
  api/barion/callback/          POST — Barion-callback (T-022)
  api/stream-token/             GET  — aláírt videó-token (paywall)
  api/admin/orders/[orderNumber]/refund/  POST — owner-refund (T-025)
collections/          Users, Media, Pages, Posts, Menus, Categories,
                      WebhookEvents, AuditLogs
plugins/ecommerce.ts  Az ecommerce plugin bekötése + products/orders override
plugins/audit.ts      Config-szintű audit-hook injekció (az ecommerce UTÁN fut)
access/               Központi jogosultsági réteg (policies.ts = a mátrix)
lib/barion/           Barion kliens: Start v2, PaymentState v4, Refund v2
lib/checkout/         Checkout-start üzleti logika + route-handler
lib/barion-callback/  Callback route-handler (dedup + azonnali 200) és
                      aszinkron feldolgozó (v4 GetState-verifikáció) — T-022
lib/refund/           Owner-only visszatérítés: teljes és részrefund — T-025
lib/stream/           Cloudflare Stream signed playback token + paywall
lib/payments/         Saját Barion PaymentAdapter (szándékosan NEM regisztrált)
lib/email/            Provider-réteg (Resend / SMTP / noop) + magyar sablonok
lib/logger.ts         Strukturált napló request ID-val, redact-listával
lib/order-integrity.ts, order-number.ts, idempotency.ts, audit.ts,
lib/menu-validation.ts, duplicate.ts, slugify.ts, request-id.ts
jobs/                 Job-queue + webhook-retry task (ENABLE_JOB_WORKERS mögött)
migrations/           3 migráció — generált, kézzel nem szerkesztendő
env.ts                Induláskori ENV-assert (instrumentation.ts hívja)
middleware.ts         Bejövő kérések request ID-val való ellátása
__tests__/            18 vitest fájl
```

## Adatmodell és üzleti szabályok

**Saját collectionök:** Users (szerepkörök: `owner` / `staff` / customer),
Media, Pages, Posts (verziózva, draft-tal), Menus (max 2 szint, ciklus-gátlás),
Categories, WebhookEvents (idempotencia), AuditLogs.

**Plugin-collectionök:** products, orders, carts, transactions.
Az `addresses` collection **kiszűrve** (digitális termék; a plugin
`addresses: false` értéke önmagában nem tiltja le, ezért a plugin lefutása után
szűrjük).

**Kurzus (products) kiegészítő mezők:** `shortDescription`, `longDescription`,
`coverImage`, `gallery`, `category`, `previewVideoStreamId`, `videos[]`
(Cloudflare Stream asset + státusz), `accessDurationDays` (null = örök
hozzáférés), `status` (draft/published/archived, saját enum-névvel a `_status`
ütközés miatt), `sku` (unique, egyben a display-név), `relatedProducts`.

**Rendelés (orders) állapotgép — a projekt egyik sarokköve:**

```
created → payment_pending → paid | payment_failed   (+ cancelled, refunded)
```

A plugin gyári állapotai (processing/completed) kódoldalon megszűntek. A `paid`
átmenet **kizárólag a Barion-callback-útvonal (T-022) joga** — sem a
checkout-start, sem a plugin `confirmOrder`-je nem állíthatja.

Az átmenetek védettek: `paid` rendelést a `cancelled` callback sem billenti
vissza (riasztás + `rejected` eredmény), és `cancelled`/`refunded`/
`payment_failed` kiindulóból sem lehet `paid`-be lépni. A `payment_failed`
állapot kódúton továbbra sincs bekötve — az M-07 2026-08-09-én úgy zárult,
hogy a Barion `Failed` a meglévő készlet `cancelled` végállapotára képződik
(lásd `megfigyelesek.md` M-07).

**Rendelés-integritás (T-017):** `orderNumber` (`KH-<év>-<6 jegyű sorszám>`),
`totalHufSnapshot`, item-szintű `titleSnapshot` / `priceHufSnapshot` — mind
szerver-oldalon, `beforeChange`-hookban, **csak create-kor** töltődik; a kliens
által küldött ár sosem forrás.

**Deviza:** HUF, `decimals: 0`. **Variants** és **guest cart** kikapcsolva
(egy kurzus = egy ár, fiók kötelező).

## Jogosultság (T-011)

Központi réteg az `src/access/`-ben, a mátrix az `access/policies.ts`-ben
dokumentálva. Lényeg:

- `isAdmin` = `owner` + `staff`; a pénzügyi default mezők admin-only.
- **Ár-mezők** (`priceInHUF*`) create/update **owner-only** — a staff nem
  árazhat.
- **Publikálás** (`products.status`) szintén owner-only — a staff draftot
  készíthet, nem publikálhat.
- Owner-only **olvasás**: `customerSnapshot`, `ipAddress`, `invoiceNumber`,
  `barionPaymentId`, `refunds`.
- **`users.purchases`** — a paywall csuklópontja: `create`/`update` egyaránt
  `false`, tehát sem az admin felület, sem az API nem írhatja. Kizárólag a
  rendszerfolyamat állítja `overrideAccess`-szel (callback: beírás, teljes
  refund: levétel). A `users.role` ugyanígy owner-only, ezért a nyilvános
  regisztráció nem ad jogemelési utat.
- `isDocumentOwner`: a customer csak a saját orders/carts dokumentumait látja.
- Nyilvános olvasás csak publikált tartalomra (`adminOrPublishedStatus`).

> A `CLAUDE.md` szerint access-függvény módosítása **emberi jóváhagyást igényel**.

## Fizetés (Barion) — hol tart

- `lib/barion/` — kliensmodul: **Start v2**, **PaymentState v4**, **Refund v2**,
  mockolt fetch-csel unit-tesztelve; a titkok env-ből, az induláskori assert-tel.
- `POST /api/checkout/start` (T-021): input-validáció → termék/státusz-ellenőrzés
  → duplavásárlás-blokk (paid vagy aktív payment_pending → 409) → rendelés
  `payment_pending` státusszal → Barion `Payment/Start` (a `PaymentRequestId` az
  `orderNumber`, ez adja a Barion-oldali idempotenciát) → `barionPaymentId`
  mentése.
- **T-063 plugin-adapter-kontroll — háromszoros védelem a `confirmOrder` ellen:**
  1. a saját `PaymentAdapter` létezik, de **szándékosan nincs regisztrálva** (a
     plugin `paymentMethods` listája üres), így a `/payments/*` végpontok létre
     sem jönnek;
  2. a `withoutPluginPaymentEndpoints` szűrő a plugin lefutása után is eltávolít
     minden `/payments/*` végpontot — akkor is, ha egy későbbi módosítás mégis
     regisztrálná az adaptert;
  3. az adapter `confirmOrder`-je **mindig hibát dob**, sosem fut le sikeresen.

  Mindhármat unit-teszt őrzi (`checkout-start.test.ts`).
- **T-022 Barion-callback** (`POST /api/barion/callback`): a handler azonnal
  dedupol a `webhook-events`-be (`provider='barion'`, `externalId=PaymentId`,
  UNIQUE) és **azonnal 200-at válaszol** — a Barion 15 mp-es elvárása és
  retry-lépcsője (2/6/18/54/102 s) miatt sosem blokkol. A feldolgozás aszinkron,
  két csatornán: `next/server` `after()` a válasz után, plusz a T-014
  retry-job a beragadt/hibás eseményekre.

  A jóváhagyás **kizárólag szerver-szerver `fetchPaymentState` (v4)**
  verifikációból származik — a callback-payload önmagában nem bizonyíték, ezért
  a hamis PaymentId is 200-at kap (rögzül, riasztás naplózódik). A nyers bodyt
  szándékosan nem tároljuk. Rendelés-azonosítás `barionPaymentId` alapján,
  fallback a Barion által hitelesített `PaymentRequestId` (= `orderNumber`),
  ilyenkor a hiányzó `barionPaymentId` pótlódik.

  Siker esetén: `paid` + **`purchases`-jogosultság** idempotens beírása a
  `users`-re. Hiba esetén a `processedAt` üresen marad → az esemény
  újrapróbálható.

- **T-025 owner-refund** (`POST /api/admin/orders/[orderNumber]/refund`):
  owner-only (anon → 401, staff → 403, a meglévő `hasOwnerRole` predikátummal).
  Csak `paid` rendelés téríthető; teljes és részrefund is támogatott. A Barion
  `TransactionId`-t az első refund előtt a v4 GetState `Transactions` tömbjéből
  oldja fel, és az `orders.refunds` json-nyomba menti (későbbi részrefundok
  ezt újrahasználják). **A DB-írás kizárólag a sikeres Barion-hívás után
  történik** — Barion-hibánál a rendelés érintetlen marad.

  Teljes refund → `refunded` + `refundedAt` + `purchases`-levétel (idempotens,
  és megvédi azt a terméket, amire a vevőnek másik `paid` rendelése van).
  **Részrefund → a rendelés `paid` MARAD, a hozzáférés megmarad** — tudatos,
  kommentben indokolt döntés. Minden refund audit-log bejegyzést kap.

- **Videó-paywall** (`GET /api/stream-token`): HS256-tal aláírt Cloudflare
  Stream playback JWT, nulla extra függőséggel (`sub` = `streamAssetId`,
  `exp` = videóhossz + 10 perc türelem, max. 24 óra, opcionális `kid`).
  A vásárlás-ellenőrzés a termék lekérdezése **előtt** fut, így a 403 nem
  árulja el a termék létezését. `published` → rendben, `archived` → a meglévő
  vevő tovább nézi, `draft` → senki. A `CF_STREAM_SIGNING_KEY` **nem
  induláskori kötelező ENV**, hanem kérés-idejű lazy ellenőrzés (hiányában 503).

- **Következő lépések:** a `pending_repoll` eseményeket feldolgozó **poll-job**
  (a kommentek hivatkoznak rá, még nem létezik), és a **számlázás**
  (Számlázz.hu) — az `orders` mezői (`invoiceStatus`, `invoiceNumber`,
  `invoicePdfUrl`) már készen állnak rá.

## Egyéb infrastruktúra

- **E-mail:** provider-réteg (Resend / SMTP / **noop**) — env nélkül sosem
  crashel; magyar sablonok; a Payload auth-levelei (forgot-password) is ezen
  mennek.
- **Kapcsolat űrlap (T-016):** a form-builder plugin form-submissions
  végpontján; opcionális Cloudflare Turnstile spam-védelem
  (`TURNSTILE_SECRET_KEY` jelenlétére kapcsol be); staff-értesítő e-mail
  best-effort (`CONTACT_STAFF_EMAILS`).
- **Audit + webhook (T-014/T-015):** webhook-idempotencia, audit-trail,
  `webhook-retry` job az `ENABLE_JOB_WORKERS` env mögött. A `webhook-events`
  a T-022-vel két új, csak olvasható mezőt kapott: `processedAt` (hiba esetén
  szándékosan üres → újrapróbálható) és `result` (`paid` / `cancelled` /
  `pending_repoll` / `rejected` / `failed`).
- **Feltöltés:** globális limit **10 MB**; Media imageSizes 320/640/1280/1920 +
  og 1200×630, webp, mimeType-szűrés.
- **Napló:** `lib/logger.ts` — strukturált, request ID-val (a `middleware.ts`
  adja), redact-listával. `console.log` használata tilos.

## Ticket-nyomvonal (commitüzenetekből)

Lezárt: **T-011** (mezőszintű védelem), **T-012** (versions/drafts + duplikálás),
**T-013** (menüfa-validáció), **T-014/T-015** (webhook-idempotencia +
audit-trail), **T-016** (kapcsolat űrlap), **T-017** (rendelés-integritás),
**T-018** (e-mail-réteg), **T-019** (Media imageSizes + 10 MB limit),
**T-021** (checkout-start), **T-022** (Barion-callback → `paid` + purchases),
**T-025** (owner-refund), **T-063** (plugin-adapter-kontroll), **T-072**
(pinnelt verziók politikája). Ticketszám nélkül: a Cloudflare Stream
videó-paywall (`/api/stream-token`).

Hivatkozott, még nyitott: a `pending_repoll` **poll-job** és a **számlázás**.

## Konvenciók (röviden)

- Branch: `feat/<ticket-id>-<rovid-nev>`, hibajavításra `fix/<ticket-id>-<rovid-nev>`.
- Commit: kis, fókuszált, scope-pal; magyar vagy angol.
- TypeScript strict, `any` tilos (helyette `unknown` + szűkítés).
- Felhasználónak szóló hibaüzenet **magyarul**.
- Kikommentezett kód nem maradhat a repóban.
