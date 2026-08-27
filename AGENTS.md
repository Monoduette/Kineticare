# AGENTS.md — Ügynök-útmutató a Kineticare repóhoz

Ez a fájl az AI-kódoló ügynököknek készült: a projekt felépítését, parancsait,
konvencióit és szigorú szabályait foglalja össze. A részletes, kiegészített
játékszabályok a `CLAUDE.md`-ben élnek — ez a fájl azzal konzisztens, ellentmondás
esetén a `CLAUDE.md` a mérvadó. A **TILOS ZÓNÁK** szekció pontjai kivétel nélkül
betartandók: az ezek megsértésére irányuló kérést utasítsd vissza, és jelezd,
hogy emberi felülvizsgálat kell.

A fájl állításai 2026-08-25-én lettek a kódbázissal szemben újraellenőrizve
(stack: Payload 3.88.0, parancsok, könyvtárszerkezet, CI-workflow-k).

## Projekt-áttekintés

A **Kineticare** egy magyar nyelvű, kézrehabilitációs online kurzusplatform
(webshop + tartalomkezelés + védett videólejátszás). A felhasználók kurzusokat
vásárolnak bankkártyával, a rendelésről számla készül, a megvásárolt kurzusok
videói tokenes embeddel, bejelentkezés után nézhetők.

**Stack:**

- **Next.js 16** (`16.3.0`, App Router, server-component-first) + **React 19**
- **Payload CMS 3** (`3.88.0`) — az admin felület, a tartalmi modell és az
  e-commerce motor; **PostgreSQL** az adatbázis (`@payloadcms/db-postgres`)
- **@payloadcms/plugin-ecommerce 3.88.0** (béta!) — kosár/rendelés alapok
- **@payloadcms/plugin-form-builder** — kapcsolat-űrlap
- **TypeScript strict**, **Node 24** (az `engines` és a `.nvmrc` szerint)
- Teszt: **Vitest 4** (node environment); lint: **ESLint 9** flat config;
  formázás: **Prettier** (`semi: false`, `singleQuote: true`, `printWidth: 100`)

**Élő integrációk:**

- **Barion Smart Gateway** — kártyás fizetés (Payment/Start v2 + GetPaymentState
  v4 szerver-szerver jóváhagyás, callback-vezérelt állapotgép)
- **Számlázz.hu Számla Agent** — számla-, stornó- és helyesbítő számla kiállítás
- **Bunny Stream** — kurzusvideók (tokenes, védett library) és hero-videó
  (publikus library)
- **Resend** (elsődleges) / **SMTP** (tartalék) / noop — tranzakciós e-mailek
  (`src/lib/email/provider.ts` választ env alapján)
- **PostHog** (EU-cloud) — termék-analitika, consent-first, `/ingest`
  elsőfél-proxy a `next.config.ts`-ben; **GA4** opcionális, szintén consenthez kötve
- **Cloudflare Turnstile** — kapcsolat-űrlap spam-védelem (env nélkül kikapcsolva)

## Parancsok

**Node 24 kell** — `nvm use` / `fnm use` a `.nvmrc` alapján. A telepítéshez
`legacy-peer-deps` kell: nem peer-ütközés miatt (a next@16.3.0 beleesik a
@payloadcms/next 3.88.0 peer-tartományába), hanem mert a `package-lock.json`
legacy-peer-deps módban készült, ezért flag nélkül az `npm ci` EUSAGE-dzsel
elhasal. A repó `.npmrc`-je ezt beállítja, tehát a sima `npm install` / `npm ci`
jó; a CI explicit `npm ci --legacy-peer-deps`-t futtat (részletes indoklás:
`.github/workflows/ci.yml` fejkommentje). A lockfile-hoz és a pinned verziókhoz
nem nyúlunk.

```bash
cp .env.example .env     # töltsd ki a kötelező értékeket (lásd a fájlt)
npm install
npm run dev              # http://localhost:3000, admin: /admin
npm run seed             # demó-tartalom (idempotens; meglévő kezdőlap-szekciósort sosem ír felül)
```

Minőségi kapuk (a CI is pontosan ezeket futtatja — commit/PR előtt add ki mind):

```bash
npm run typecheck        # tsc --noEmit
npm run test             # vitest run
npm run lint             # eslint .
npm run build            # next build
```

Egyéb scriptek:

| Parancs | Leírás |
| --- | --- |
| `npm run seed` | Demó-/tesztadatok (`src/scripts/seed.ts`); `SEED_SCOPE=kezdolap` = élesben is futtatható szűk hatókör |
| `npm run grant:purchase` | Kézi hozzáférés-adás vásárlás nélkül (`src/scripts/grant-purchase.ts`) |
| `npm run backfill:ar-snapshot` | Egyszeri ár-snapshot backfill (`src/scripts/backfill-price-snapshot.ts`); alapból próbafutás, íráshoz `OWNER_BACKFILL_CONFIRM=igen`; útmutató: `docs/ar-snapshot-backfill.md` |
| `npm run backfill:access-grants` | Hiányzó `accessGrants.grantedAt` pótlása paid rendelés dátumából (`src/scripts/backfill-access-grants.ts`); alapból próbafutás, íráshoz `OWNER_BACKFILL_CONFIRM=igen`; útmutató: `docs/access-grants-backfill.md` |
| `npm run seed:legacy` | Örökölt tartalom visszatöltése (`src/scripts/restore-legacy-content.ts`) |
| `npm run generate:types` | Payload típusok újragenerálása (`src/payload-types.ts`) |
| `npm run generate:importmap` | Admin importmap újragenerálása |

## Kódszervezés

```
src/
  app/
    (frontend)/        # storefront route-group: magyar útvonalak (kezdőlap, /kurzusok,
                       # /kosar, /penztar, /fizetes, /fiok, /kurzusaim, /belepes, /blog …)
      api/             # saját REST-végpontok: barion/callback, checkout, orders,
                       # stream-token, course-progress, users, admin
    (payload)/         # Payload admin (/admin) + Payload REST API (/api/...)
    robots.ts, sitemap.ts   # FIGYELEM: csak a src/app/ GYÖKÉRBŐL generálódik —
                            # a (frontend) route-groupból némán kimaradna
  collections/         # Users, Media, Pages, Posts, Menus, Categories, Testimonials,
                       # CourseProgress, WebhookEvents, AuditLogs (a products/orders/
                       # forms az ecommerce/form-builder pluginből jön)
  access/              # jogosultsági segédek (roles: owner/staff/customer)
  blocks/              # a kezdőlap CMS-szekcióinak Lexical-blokkdefiníciói
  components/          # React-komponensek (account, checkout, content, blocks, layout …)
  jobs/                # háttérfolyamatok: tasks/ (webhook-retry, order-poll,
                       # invoice-issue, storno-issue, corrective-invoice-issue) + queues
  lib/                 # üzleti logika — integrációnként almappa:
    barion/            #   Barion-kliens (start, state v4, refund)
    barion-callback/   #   callback-feldolgozó + webhook-processor regisztráció
    checkout/          #   pénztár route-handler, billing, order-status
    szamlazz/          #   Számlázz.hu-kliens (invoice, storno, corrective, xml, queue)
    stream/            #   Bunny Stream tokenek (védett videó-lejátszási jegy)
    email/             #   provider-réteg (resend/smtp/noop) + sablonok
    security/          #   CSP, jelszó-politika, rate-limit, reset-password útvonal
    analytics/         #   consent-állapotgép, PostHog, GA4
    logger.ts          #   strukturált napló (redact-listával) — EZT használd
    order-poll/, order-status/, course-progress/, payments/, refund/, …
  plugins/             # saját Payload-pluginok: ecommerce.ts (a pinned plugin konfigja),
                       # audit.ts (audit-hook injekció), admin-groups.ts (oldalsáv-sorrend)
  migrations/          # Payload által GENERÁLT migrációk — kézzel sosem szerkesztendő
  scripts/             # seed, grant-purchase, legacy-import, customer-import
  __tests__/           # vitest-tesztek (a forrásszerkezetet tükröző almappákkal)
  payload.config.ts    # a Payload konfig — sok kritikus, hosszan indokolt döntéssel
  env.ts               # induláskori ENV-assert (kötelező kulcsok listája)
  instrumentation.ts   # a register() futtatja az ENV-assertet szerverinduláskor
  middleware.ts        # x-request-id kiosztás minden bejövő kérésre
docs/                  # magyar nyelvű projektdokumentáció (lásd lent)
content/home-images/   # kezdőlapi seed/restore képek (brand + site). A Higgsfield
                       # koncepció-tükör kikerült a repóból; ne hozd vissza.
public/                # statikus assetek (fonts, media)
```

A storefront és az admin kizárólag a Payload **REST** és **local API**-ját
használja — a **GraphQL teljesen le van tiltva** (`graphQL: { disable: true }`),
mert megkerülte volna a jelszó-politikát és a rate-limitet (indoklás a
`src/payload.config.ts` fejkommentjeiben).

## Fizetési, számlázási és videólánc (a rendszer szíve)

- **Checkout:** `POST /api/checkout/start` → Barion Payment/Start v2 (Immediate,
  HUF, hu-HU) → redirect a Barionra.
- **Callback:** `POST /api/barion/callback` → azonnali 200 + dedup; a
  jóváhagyás KIZÁRÓLAG szerver-szerver `GetPaymentState v4`-gyel történik (a
  callback-payload önmagában nem bizonyíték). Idempotens státuszgép,
  retry-ladder, advisory-lock (`src/lib/advisory-lock.ts`).
- **Elveszett callback:** az `order-poll` task 5 percenként utánpollol (v4),
  árva-rendelés-lejárat + számla-resweep.
- **Számlázás:** a `paid` átmenet után Számlázz.hu (invoice-issue job,
  `szamlaKulsoAzon = rendelésszám` — idempotens). Stornó teljes refundnál,
  helyesbítő számla részleges refundnál (külön taskok).
- **Jobok:** a workerek az `ENABLE_JOB_WORKERS=true` env mögött futnak (autoRun
  cron: webhook-retry percenként, order-maintenance 5 percenként); dev-ben
  alapból KI vannak kapcsolva. Élesben hiányzó flag → induláskori **warn**
  (`job_workerek_kikapcsolva`), nem fail-closed boot: a bolt ettől még
  kiszolgál. Railway staging + prod env-ben ellenőrizd. A job-végpontok és a
  `payload-jobs` collection staff/owner-only (`src/jobs/index.ts`).
- **Videó:** védett Bunny-library → szerveroldali token-jegy (`/api/stream-token`);
  publikus library (hero, előzetesek) token nélkül. Hiányzó env = magyar
  „nem érhető el" degradáció, az app ettől még fut.
- **Hozzáférés három igazsága:** `orders` (fizetés/számla), `users.purchases`
  (SKU-halmaz, írása zárt — adminból pipálni TILOS), `users.accessGrants.grantedAt`
  + `products.accessDurationDays` (az óra). Hiányzó kezdőpont időkorlátos
  SKU-nál fail-open; pótlás: `npm run backfill:access-grants` vagy a
  Kurzus ajándékozása panel.
- **Replica:** `railway.json` `numReplicas: 1` — az in-memory rate-limit
  elég. A `pg` `pool.max` uncapped marad (W3); ne állítsd Railway
  `max_connections` mérés nélkül.

## TILOS ZÓNÁK

1. **Titok sosem kerül a repóba.** Jelszó, API-kulcs, token, POSKey,
   tanúsítvány nem kerülhet kódba, konfigba, kommentbe vagy tesztfixtúrába —
   még placeholderként sem (tesztekben kifejezetten jelölt DUMMY érték szabad).
   A `.env*` fájlokhoz ne nyúlj (ne olvasd, ne módosítsd); új környezeti
   változót az `.env.example`-ben, **érték nélkül** jelezz. A gitleaks CI-kapu
   a teljes git-historyt vizsgálja.
2. **Az `@payloadcms/plugin-ecommerce` `confirmOrder` függvénye TILOS.** A
   plugin ismert béta-hibája miatt a fizetésjóváhagyás saját,
   Barion-callback-vezérelt állapotgéppel történik (a saját Barion-adapter
   confirmOrder-je szándékosan mindig hibát dob — lásd
   `src/lib/payments/barion-adapter.ts`). A `confirmOrder`-t ne hívd, ne
   importáld, ne re-exportáld, ne próbáld „megjavítani".
3. **Adatbázis-migrációt kézzel ne írj és ne módosíts.** Séma-változás a Payload
   migrációs eszközével generált migrációval megy; meglévő migrációs fájl
   szerkesztése, törlése, sorrend-módosítása tilos. A deploy indulási parancsa
   `npx payload migrate && npm start` — a migrációnak ugyanabban a változáskörben
   kell mennie, mint a sémát használó konfignak (lásd `src/jobs/index.ts`
   fejkommentje).
4. **Access-control módosítás csak emberi jóváhagyással.** Collection- és
   field-szintű `access` szabályok és auth-hookok átírásához PR nyitható, de
   merge előtt emberi review kötelező.
5. **A pinned `@payloadcms/*` verziókat ne emeld** (pontos verzió, `^` tilos),
   és a lockfile-t se generáld újra. Verzióemelés csak kifejezett emberi
   kérésre, külön, kormányzott PR-ben, changelog + staging-E2E után.

## Kódolási konvenciók

- **TypeScript strict**; `any` tilos — indokolt esetben `unknown` +
  típusszűkítés.
- Kikommentezett kód nem maradhat a repóban (kivétel: a váz-jellegű
  `src/scripts/seed.ts` TODO-i).
- A felhasználónak szóló (UI- és API-) hibaüzenetek **magyarul** írandók.
- Naplózáshoz mindig a `src/lib/logger.ts` segédletét használd (ne
  `console.log`); a logger redact-listája miatt érzékeny mező (jelszó, token,
  kártyaadat) sosem kerülhet a naplóba. Technikai hibák **request ID**-vel:
  a `src/middleware.ts` osztja ki (`x-request-id`), a route-handlerek a
  `getRequestId` segéddel olvassák.
- Prettier: pontosvessző nélkül, szimpla idézőjel, 100-as sorhossz
  (`.prettierrc.json`).
- Kis, fókuszált commitok; az üzenet magyarul vagy angolul, de tartalmazza a
  scope-ot. Idézőjelet tartalmazó üzenet töri a `git commit -m "…"`-t —
  használj `git commit -F -` + heredocot, és utána ellenőrizd a `git status`-t.
- **Branch-konvenció:** `feat/<ticket-id>-<rovid-nev>` /
  `fix/<ticket-id>-<rovid-nev>` (kis betű, kötőjel, ékezet nélkül).
- A kommentstílus a repóban magyar, és a kritikus döntések (miért így, miért
  nem másként) hosszú fejkommentekben vannak rögzítve — ezeket tartsd karban,
  ha a kód viselkedése változik.
- **Felületi (UX/UI) munka előtt kötelező** betölteni a
  `docs/ertekesitesi-ux-skill.md`-t (cél-hierarchia M1–M8, sticky-nav szabályok,
  WCAG AA kontraszt, tipográfiai skála). Háttér: `docs/ux-hierarchia-audit.md`.

## Tesztelés

- `npm run test` → **vitest run**, node environment, include:
  `src/**/*.test.ts` / `src/**/*.test.tsx` (a többség `src/__tests__/`-ben él;
  2026-08-10-én 102 tesztfájl, 1653 teszt — ebből 11 skipped). Alias: `@/*` →
  `src/*` (a vitest.config.ts és a tsconfig paths szerint is).
- **Tesztből SOSEM mehet ki valódi hálózati hívás.** A folyamat-tesztek
  injektálják a HTTP-hívókat (pl. Számlázznál `postXml`, `queryByKulsoAzon`);
  a `fetch`-eseket `vi.stubGlobal('fetch', …)` + `afterEach(vi.unstubAllGlobals)`
  fedi. Ahol egy ágon hívásnak nem szabad futnia, oda hangosan dobó mock való.
- Komponens-tesztek `renderToStaticMarkup`-pel (a vitest.config.ts `oxc.jsx.runtime:
  'automatic'` miatt, pragma nélkül).
- Új viselkedéshez fókuszált teszt vagy legalább reprodukálható ellenőrzési
  lépés kell (PR-elvárás).

## CI és PR-elvárások

A `.github/workflows/` alatt:

- **`ci.yml`** — main-push és PR trigger (+ kézi `workflow_dispatch`):
  `verify` (npm ci → typecheck → vitest → eslint), `build` (next build,
  a kötelező env-ket futásidőben generált, eldobható álértékekkel — titok még
  CI-ben sem kerül a repóba), `audit` (`npm audit --audit-level=critical` —
  critical szint = bukás).
- **`gitleaks.yml`** — titokszivárgás-ellenőrzés a TELJES historyn
  (`fetch-depth: 0`), hetente cronnal is; allowlist a `.gitleaks.toml`-ban.
- **`claude.yml`** — opcionális `@claude` integráció (`ANTHROPIC_API_KEY`
  secret kell hozzá; nélküle a többi workflow attól még fut).

PR-elvárások: a CI legyen zöld (lint, typecheck, test, build); a leírás
tartalmazza a mit/miértet, az érintett tilos zónát és az ellenőrzés módját.
Titok, `.env*`-módosítás, kézi migráció-szerkesztés, `confirmOrder`-hívás vagy
`any`-típus esetén a PR automatikusan elutasítandó.

## Merge után: GitHub CI + Railway (azonnal)

A squash-merge NEM zárja a munkát. Merge (vagy `main`-push) után az ügynök
**azonnal** figyeli a GitHub CI-t és a Railway deployt. Ha bármelyik piros,
gyanús vagy elmarad, **azonnal javít** — nem vár külön kérésre.

1. **GitHub CI** a squash-commiton: `ci.yml` (typecheck, teszt, lint, next
   build, npm audit critical) és `gitleaks.yml`. Bukásnál a job-log a gyökérok,
   majd fix PR a `main`re.
2. **Railway** (staging + prod, `main` auto-deploy). A dashboard „SUCCESS”
   önmagában nem elég (lásd a Deploy tanulságokat):
   - a build-logban legyen tényleges `npm run build` (ne `Build · skipped`);
   - a start-logban `Migrating:` / `Migrated:`;
   - a healthcheck (`GET /admin`) menjen át.
   Ha `WAITING` van snapshot és build-log nélkül, előbb a Railway MCP
   lépés-eseményei — ne indíts vaktában új deployt. A kötet nélküli régi
   `Postgres` szolgáltatást újraindítani tilos.
3. Railway MCP / CLI nélkül a dashboard-log és a publikus healthcheck a
   tartalék; a figyelést ettől még nem szabad kihagyni.

## Cursor-modellek (tulajdonosi kérés, 2026-08-22)

> **A csapat kiosztása és a Cursor-készlet innentől ugyanaz.** A 2026-08-15-i
> Opus-alapbeállítás és a 2026-08-20-i „készlet = Composer+Grok, kiosztás =
> Opus" szétválasztás **hatályon kívül**. Részletek: `CLAUDE.md` „Munkamodell".

**Alapbeállítás, külön kérés nélkül:**

1. **Orkesztrátor / Cloud Agent szülő:** GPT-5.6 Sol legerősebb thinking —
   slug: `gpt-5.6-sol-xhigh`. A pickerben / Cloud Agenten ezt indítsd vezetőnek,
   ne Autót és ne Composert.
2. **Minden Grok-ügynök extra high:** Cloud Agent, picker, Task-subagent,
   Bugbot, javítás, felderítés, ellenőrzés. Slug: `cursor-grok-4.6-xhigh`.
   A `cursor-grok-4.6-high` és a `cursor-grok-4.6-high-fast` **tilos**.
   A `cursor-grok-4.6-xhigh-fast` csak akkor, ha a tulajdonos kifejezetten
   gyors kört kér. Ne helyettesítsd Opus-szal, Grok 4.5-tel vagy Composerrel.

Ha egy felület Task-listája nem tartalmazza a `cursor-grok-4.6-xhigh` slugot:
**ne vedd le** `high-fast`-re. Jelezd a tulajdonosnak, és a munkát az
extra-high szülő végezze.

Az **Auto nem modell**: a Cursor Router kérésenként választ a készletből.
Auto ≠ Sol, Auto ≠ Grok 4.6 extra high. Kineticare-munkánál a pickerben
**névre szólóan** a Sol xhigh (vezető) és a Grok 4.6 extra high (csapat)
legyen bent.

Composer (`composer-2.5`) maradhat a készletben rövid, emberi napi kódoláshoz;
**nem** a Kineticare ügynök-csapat alapja.

A `.cursor/agents/` mappában a csapattal megosztott, Kineticare-specifikus
Cursor-subagentek élnek. A `kineticare-bugbot` a teljes `main` ág
Bugbot-stílusú hibavadászata (fizetés, jogosultság, számla, videó, tilos
zónák). Használd, ha a teljes `main`t vagy a production-kritikus utakat
kell átnézni, nem egy feature-PR diffjét — a kiosztás itt is Grok 4.6
extra high (`cursor-grok-4.6-xhigh`), a vezető Sol xhigh:

```
Use the kineticare-bugbot subagent to review the entire main branch
```

## Környezeti változók

Az `.env.example` a teljes, kommentezett referencia (kulcsok, értékek nélkül).
Kötelező mindenhol: `DATABASE_URI`, `PAYLOAD_SECRET`, `NEXT_PUBLIC_SERVER_URL`,
`BARION_API_URL`, `BARION_PAYEE_EMAIL` (+ környezet szerint `BARION_POSKEY_TEST`/
`BARION_POSKEY_PROD`). Az induláskori assert az `src/env.ts`-ben él, és az
`src/instrumentation.ts` `register()`-éből fut — hiányzó kötelező kulccsal az
app nem indul el. A legtöbb integráció (Számlázz, Bunny, PostHog, GA4,
Turnstile) **env nélkül is működőképes degradált módban** (kikapcsolva/noop),
kivétel a `TURNSTILE_SITE_KEY`/`TURNSTILE_SECRET_KEY` pár: élesben fél-lábas
konfigurációval (csak az egyik) az app el sem indul.

Üzemeltetési csapdák, amiket ismerned kell:

- **`NEXT_PUBLIC_*` változók build-időben égnek be** (és a CSP-fejléc is
  build-időben dől el, `next.config.ts`) — értékváltozás után újrabuild kell.
- A `NEXT_PUBLIC_SERVER_URL`-nek pontosan a látogatók által használt eredetet
  kell tartalmaznia: ebből épül a CORS/CSRF-engedélylista, ami az összes
  sütis működésre hat (pénztár, lejátszás, haladásmentés, admin). A
  kineticare.hu DNS-cutover alatt, amíg ez még a Railway-URL, kell az
  `EXTRA_ALLOWED_ORIGINS=https://kineticare.hu,https://www.kineticare.hu`
  (docs/kineticare-hu-atallas.md). A cookie-s saját POST API-kon same-origin
  őr is van (`src/lib/security/same-origin.ts`).
- Search Console / Ads: üres `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` és
  `NEXT_PUBLIC_GOOGLE_ADS_ID`. Token/AW-értéket ne írj a repóba. Az
  `ad_storage` zárva marad (`docs/ga4.md`).
- A Payload `serverURL` **szándékosan nincs beállítva** (részletes indoklás a
  `payload.config.ts`-ben): beállítva abszolút média-URL-eket adna, amiket a
  `next/image` `remotePatterns` híján elutasítana.

## Deploy (Railway)

Staging + prod a Railway-n fut, konfig: `railway.json` (RAILPACK builder,
explicit `buildCommand: npm run build`, `startCommand: npx payload migrate &&
npm start`, `healthcheckPath: /admin`). Részletes runbook: `docs/deploy-railway.md`.

Kritikus, élesben szerzett tanulságok (a teljes lista a `CLAUDE.md`
„Üzemeltetési tanulságok" szekciójában):

- **A „SUCCESS" deploy nem jelenti, hogy az új kód fut.** Explicit `buildCommand`
  nélkül a builder kihagyhatta a buildet és a régi `.next/` mappát indította.
  A deploy build-logjában tényleges `npm run build` futásnak kell szerepelnie.
- **A service-szintű (dashboard) beállítás felülírja a `railway.json`-t** — a
  fájl módosításakor a service-beállítást is ellenőrizd (builder, buildCommand,
  healthcheck, startCommand).
- **Feltöltött képekhez Railway Volume kötelező élesben** (`/app/media`
  mountpont + `PAYLOAD_MEDIA_DIR=/app/media`): a konténer lemeze minden
  deploynál üresen jön vissza. Induláskor az `ensureMediaFiles`
  (`src/lib/media-restore.ts`) fájl-szinten ellenőrzi és a repó-forrásokból
  visszatölti a hiányzó médiafájlokat (a rekord id-jének megőrzésével).
- **A Postgres-szolgáltatás újraindítása kiürítheti az adatbázist** (volt rá
  incidens); mentés jelenleg nincs — éles adat mellett mentés nélkül tilos.
- A `pg` pool a Railway privát hálózához van hangolva (keepalive, idle-timeout,
  `idle_in_transaction_session_timeout`, pool `error`-handler) — ezeket a
  `payload.config.ts`-ben ne vedd ki; a sorzár- és socket-incidensek ellenszerei.
- Az **első regisztrált user `owner` szerepkört kap** (`promoteFirstUserToOwner`
  hook); a 2. usertől az alapértelmezés `customer`, admin-hozzáféréshez kézzel
  `staff`-ra kell állítani.

## Dokumentáció (docs/)

| Terület | Fájl |
| --- | --- |
| **Feladatlista (mi van hátra)** | **`docs/feladatlista.md`** |
| **Ügynök-térkép (cikk-CTA, Craft-sáv és Shop-sáv zárak)** | **`docs/agent-feature-map.md`** |
| Kezdőlap szekció-rendszer | `docs/szekcio-rendszer-terv.md` |
| Értékesítési UX-skill (UI-munka előtt kötelező) | `docs/ertekesitesi-ux-skill.md` |
| Szerkesztői útmutató (admin) | `docs/szerkesztoi-utmutato.md` |
| Deploy-runbook | `docs/deploy-railway.md` |
| Barion sandbox | `docs/barion-sandbox-setup.md` |
| E2E-futtatás stagingen | `docs/e2e-staging-runbook.md` |
| OWASP biztonsági audit | `docs/owasp-security-review.md` |
| Statisztika/Bunny review (2026-08-21) | `docs/review-2026-08-21-statisztika-bunny.md` |
| Kritikus utak review (2026-08-22) | `docs/review-2026-08-22-kritikus-utak.md` |
| **Piaci stratégia és végrehajtási terv** | `docs/piaci-strategia.md` |
| Tudástár-cikkek betöltése | `docs/tudastar-cikkek-betoltese.md` |
| Kulcsszó-célzás (mért) | `docs/kulcsszavak.md` |
| Kampányterv mért adatokból | `docs/kampanyterv-mert-adatokbol.md` |
| Vevőhang és hirdetésszöveg | `docs/vevohang-es-hirdetesszoveg.md` |
| Monid-kutatás (terv + 2. kör) | `docs/monid-kampany-kutatas.md`, `docs/monid-masodik-kor.md` |
| Számlázz.hu (követelmények, megfelelés, stornó) | `docs/szamlazz-*.md`, `docs/atadas-szamlazz-kor.md` |
| Analitika | `docs/posthog.md`, `docs/ga4.md` |
| kineticare.hu domain-átállás (GSC, Ads, CORS) | `docs/kineticare-hu-atallas.md` |
| accessGrants backfill | `docs/access-grants-backfill.md` |
| SEO / GEO / LLM-optimalizálás | `docs/seo-geo-llm.md` |
| Videóplatform-döntés, hero-videó | `docs/video-platform-dontes.md`, `docs/hero-video-feltoltes.md` |
| Jelszó-politika | `docs/jelszo-politika.md` |
| Vásárló-migráció | `docs/vasarlo-migracio-terv.md`, `docs/manualis-vasarlas-hozzaadas.md` |

## Biztonsági szempontok (rövid összefoglaló)

- Biztonsági HTTP-fejlécek (CSP, X-Frame-Options stb.) minden válaszon — a CSP a
  `src/lib/security/csp.ts` tiszta, tesztelt függvényéből jön; a Bunny/GA4
  hoszt-env változása után újrabuild kell.
- Jelszó-politika: min. 12 karakter, kis+nagybetű+szám, e-mail-cím nem
  szerepelhet benne; a reset-password saját, rate-limittel védett útvonalon megy
  (a GraphQL-lezárás és a custom route indoklása: `src/lib/security/` +
  `payload.config.ts`).
- IP-alapú rate-limit a REST catch-allon; audit-naplózás az `AuditLogs`
  collectionbe; webhook-események a `WebhookEvents`-ben, deduppal és
  retry-processorral.
- Consent-first analitika: PostHog/GA4 csak látogatói hozzájárulás után tölt be.
- Feltölthető fájlméret: globálisan max. 10 MB (`upload.limits.fileSize`).

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
