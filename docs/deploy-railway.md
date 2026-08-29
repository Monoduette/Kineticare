# Railway staging deploy — runbook

> **2026-08-29:** a merge-utáni deploy-kör csak a production **`Kineticare`**
> appservice. A `Kineticare-demo` kivezetve: oda semmit nem deployolunk
> (lásd `AGENTS.md`, `docs/demo-kornyezet.md`).

> **Cél:** a `main` branchből automatikusan deployolódó staging környezet
> Railway-en, managed PostgreSQL-lel, privát hálózaton.
> A gyökérben lévő `railway.json` tartalmazza a build/start konfigurációt —
> ezt a fájlt a Railway automatikusan felismeri.

---

## 0. Mi történik deploykor (röviden)

1. **Build:** `npm ci --legacy-peer-deps && npm run build` (**Railpack** builder — lásd
   `railway.json`, `"builder": "RAILPACK"`; a Nixpacks régi állapot). A Node-verziót a
   `package.json` `engines.node` mezője adja (**`24.x`**), amit a railpack a
   24-es vonal legfrissebb patch-ére old fel.
   **FIGYELEM:** a service Variables közé tett `RAILPACK_NODE_VERSION` **felülírja** az
   `engines.node`-ot (a railpack ebben a sorrendben old fel:
   `RAILPACK_NODE_VERSION` → `engines.node` → `.nvmrc` → `.node-version` → default `lts`).
   Ha a futásidő nem az, amit vársz, előbb ezt a változót keresd.
2. **Start:** `npx payload migrate && npm start` — a migráció idempotens és
   követett (a `payload_migrations` táblában), tehát minden bootnál biztonságosan
   lefut; új migráció esetén az indulás előtt érvényesül.
3. **Healthcheck:** `GET /admin` (a Payload admin mindig 200-at ad, bejelentkezés
   nélkül is a login-oldallal), 300 mp timeout, `ON_FAILURE` restart (3×).

## 1. Projekt és adatbázis létrehozása (Railway UI, ~2 perc)

1. <https://railway.com> → **New Project** → **Deploy from GitHub repo** →
   válaszd az `anorbert-cmyk/Kineticare` repót (első alkalommal engedélyezni
   kell a Railway GitHub-appot a repóra).
2. A projekten belül: **+ New → Database → PostgreSQL**.
   A Postgres a projekt **privát hálózatán** fut — kívülről nem érhető el,
   csak az appservice-ből.
3. Az appservice **Settings → Source** részénél ellenőrizd: branch = `main`,
   **Auto-deploy** bekapcsolva (minden main-push új deploy).

## 2. Környezeti változók (appservice → Variables)

| Változó | Staging érték / forrás |
|---|---|
| `DATABASE_URI` | `${{Postgres.DATABASE_URL}}` (Railway referencia-változó, típusgomb: Reference) |
| `PAYLOAD_SECRET` | frissen generált, pl. `openssl rand -hex 32` kimenete |
| `NEXT_PUBLIC_SERVER_URL` | a staging domain, pl. `https://kineticare-staging.up.railway.app` (lásd 3. pont) |
| `BARION_ENVIRONMENT` | `test` |
| `BARION_API_URL` | `https://api.test.barion.com` |
| `BARION_POSKEY_TEST` | sandbox POSKey — ld. `docs/barion-sandbox-setup.md` |
| `BARION_PAYEE_EMAIL` | a sandbox Barion-fiók e-mail-címe |
| `ENABLE_JOB_WORKERS` | `true` (a callback retry-ladder így élőben is fut) |
| `LOG_LEVEL` | `info` |
| `PAYLOAD_MEDIA_DIR` | a csatolt **Volume mountpontja** (`/app/media`) — enélkül minden deploynál elvesznek a feltöltött képek (a konténer fájlrendszere efemer; a DB-rekord marad, a fájl eltűnik, a `/api/media/file/...` 500-at ad). Részletek: `.env.example`. |
| `SEED_OWNER_EMAIL` | csak az első seed futtatásához (4. pont), utána törölhető |
| `SEED_OWNER_PASSWORD` | csak az első seed futtatásához, utána törölhető |

> ⚠️ **Turnstile: a két kulcs CSAK PÁRBAN állítható be.** A Railway
> `next start`-tal fut (`NODE_ENV=production`), és az induláskori ENV-assert
> (`src/env.ts`, `turnstileEnvPair`) fél-lábas konfigurációnál — csak
> `TURNSTILE_SITE_KEY` VAGY csak `TURNSTILE_SECRET_KEY` — MEGAKASZTJA az
> indulást: site key secret nélkül a widget látszana, de a szerver némán
> mindent átengedne; secret site key nélkül minden beküldés elakadna. Amíg
> egyik sincs beállítva, az app elindul, de a `server_start` után
> `turnstile_kikapcsolva` warn jelzi, hogy a kapcsolat-űrlapot csak az
> IP-keret védi. Egyik kulcs sem `NEXT_PUBLIC_`, tehát a beállításukhoz
> újrabuild nem kell — a Turnstile élesítése tisztán env-művelet.

Később (amikor a funkció aktuális lesz): `BUNNY_STREAM_TOKEN_AUTH_KEY`,
`NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID`,
`NEXT_PUBLIC_BUNNY_STREAM_PUBLIC_LIBRARY_ID`,
`NEXT_PUBLIC_BUNNY_STREAM_PULL_ZONE_HOST` (a `NEXT_PUBLIC_` kulcsok után
ÚJRABUILD kell!), `EMAIL_FROM` + SMTP/Resend,
`TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` (CSAK párban — lásd a keretes
figyelmeztetést), `SZAMLAZZ_AGENT_KEY`, `SZAMLAZZ_INVOICE_PREFIX`.

> ⛔ **Tilos stagingen:** `BARION_POSKEY_PROD`, éles Számlázz.hu-kulcs,
> bármilyen éles titok. (CLAUDE.md: a staging soha nem mutathat éles fiókra.)

## 3. Domain

1. Appservice → **Settings → Networking → Generate Domain** → kapsz egy
   `*.up.railway.app` címet.
2. Ezt írd be a `NEXT_PUBLIC_SERVER_URL` változóba (https-szel, perjel nélkül
   a végén), majd **Redeploy** — a Barion redirect/callback URL-ek ebből épülnek.

## 4. Első migráció és seed

A migráció a startCommandból automatikusan lefut az első sikeres deploynál.

Seed (egyszeri), két módon:

- **CLI-vel (javasolt):**
  ```bash
  npm i -g @railway/cli
  railway login
  railway link            # válaszd a staging projektet + appservice-et
  railway run -- npm run seed
  ```
  A `railway run` a Railway-változókkal (DATABASE_URI stb.) futtatja lokálisan —
  a seed idempotens, többször is lefuttatható.
- **Vagy Railway shellben:** a service **⋯ → Shell** menüjéből `npm run seed`.

A seed létrehozza: owner-felhasználó (`SEED_OWNER_EMAIL` /
`SEED_OWNER_PASSWORD`), `DEMO-KEZREHAB-001` publikált demó-termék (19 990 Ft),
`bemutatkozas` oldal, `kezrehabilitacio-alapok` bejegyzés, demó menüfa.

## 5. Deploy utáni ellenőrzőlista

- [ ] A **build-logban tényleges `npm run build` futás** szerepel — ha
      `Build · skipped (nothing to build)` látszik, a régi `.next/` indult el,
      és a deployt SHA nélkül (a branch HEAD-jére) újra kell indítani
- [ ] A **deploy-logban ott a `server_start` sor**, benne `"nodeVersion":"v24.…"`
      és a **várt `commitSha`**. Ha a nodeVersion nem 24-es: a service Variables
      közt keresd a `RAILPACK_NODE_VERSION`-t (felülírja az `engines.node`-ot).
      Ha a sor egyáltalán nincs meg: előbb a `LOG_LEVEL`-t ellenőrizd (`info` kell
      hozzá), csak utána gyanakodj régi kódra
- [ ] Railway deploy zöld, healthcheck átment
- [ ] `https://<domain>/admin` → Payload login-oldal töltődik
- [ ] Owner belép az adminba, látja a demó-terméket
- [ ] `https://<domain>/kurzusok` → a demó-kurzus megjelenik
- [ ] Regisztráció + checkout → átirányít a **test.barion.com** felületére
- [ ] `https://<domain>/api/barion/callback` elérhető (POST; Barion hívja)
- [ ] E2E-futtatás: `docs/e2e-staging-runbook.md`

## 6. Rollback

Appservice → **Deployments** → bármelyik korábbi zöld deploy → **Redeploy**.
A Railway azonnali rollbacket ad (új build nélkül). DB-migráció visszagörgetése
külön döntés — stagingen egyszerűbb a DB reset (Delete service → új Postgres →
redeploy + seed).

## 7. Ügynök-hozzáférés (railway.com/agents alapján)

A Railway két hivatalos felületet ad ügynököknek:

1. **Remote MCP szerver** (`https://mcp.railway.app/mcp`, OAuth-belépés) —
   a helyi gépen futó ügynököknek (Claude Code / Kimi Code). Egy-egy ügynök
   így terminálból tud deployolni, logot olvasni, változót állítani.
2. **CLI + token** (`@railway/cli`, `RAILWAY_TOKEN`) — headless/CI ügynököknek.

Beállítás a csapatnak:

1. Railway projekt → **Settings → Tokens → New Project Token**
   (projekt-scope, staging projektre!) → `RAILWAY_TOKEN`.
2. A token a **GitHub repo secretbe** kerül (Settings → Secrets → Actions),
   **soha nem a repóba, nem logba, nem kommentbe.**
3. Ügynök-parancsokban a token csak környezeti változóként hivatkozható
   (`$RAILWAY_TOKEN`), képernyőre írni/naplózni tilos.
4. Prod környezethez később **külön projekt és külön token** készül —
   a staging-token nem fér hozzá.

## 8. Költség- és korlát-megjegyzések

- Hobby-csomag elegendő stagingre; a Next.js build memóriaigénye a legnagyobb
  tétel (sharp miatt natív modul is épül — a Railpack builder kezeli; lásd a
  runbook 0.1 pontját: a Nixpacks-említés régi állapot).
- `numReplicas: 1` szándékos: így a boot-time migráció nem futhat párhuzamosan
  két példányban. Prod-skálázásnál a migrációt külön, deploy előtti lépésbe
  tesszük (pre-deploy job), a startCommandból kikerül.
