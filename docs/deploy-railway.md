# Railway staging deploy — runbook

> **2026-08-29:** a merge-utáni deploy-kör csak a production **`Kineticare`**
> appservice. A `Kineticare-demo` kivezetve: oda semmit nem deployolunk
> (lásd `AGENTS.md`, `docs/demo-kornyezet.md`).

> **Cél:** a `main` branchből automatikusan deployolódó staging környezet
> Railway-en, managed PostgreSQL-lel, privát hálózaton.
> A gyökérben lévő `railway.json` tartalmazza a build/start konfigurációt —
> ezt kizárólag a már Config as Code-dal kezelt, meglévő Kineticare service
> olvassa. Új service már nem kapcsolható erre a legacy konfigurációra.

> **2026-09-01 — Railway kivezetési határ:** a `railway.json` Config as Code
> deprecated, de a már ezt használó Kineticare service-nél 2026-12-01-ig
> továbbra is működik és az itt megadott kulcsokra felülírja a dashboardot.
> A hard cutoff előtt a live projekthez linkelt repóból előbb
> `railway config migrate` előnézet, majd emberileg jóváhagyott
> `railway config migrate --apply` kell: ez írja ki az IaC-fájlt és törli a
> service Config File beállítását. Ezután a `railway config plan` legyen tiszta,
> mielőtt a régi fájl törléséről külön döntés születik. A sima `config pull` +
> `config plan` útvonal blokkolt, amíg ugyanazt a service-t a Config as Code kezeli.

---

## 0. Mi történik deploykor (röviden)

1. **Build:** a repó `railpack.json` fájlja a pinned **Railpack 0.38.0** install
   lépését egyetlen `node scripts/install-reviewed-dependencies.mjs` bootstrapra
   írja felül: scriptmentes `npm ci`, a lockfile és a lifecycle-tarballok
   ellenőrzése, majd kizárólag az exact jóváhagyott install scriptek rebuildje.
   A bootstrap `scripts/` relatív útvonalat vár, ezért az install input a
   `scripts` könyvtárat másolja (nem a külön fájlokat), és van egy explicit
   `src/dest: scripts` copy is: a Railpack a `scripts/foo.mjs` include-ot
   `/app/foo.mjs`-re lapítja, és a 2026-09-01-i production build ezen
   `MODULE_NOT_FOUND`-dal állt le.
   Ezután az exact Mise Node a lokális Next JS entrypointtal buildel. A Node és
   npm verzió is exact:
   **Node `24.20.0`, npm `11.19.0`**. A `package.json` `engines.node`, a
   `.nvmrc` és a projekt `mise.toml` szándékosan ugyanaz az exact Node-verzió:
   Railpack 0.38.0 a Node-verziót
   az `engines.node` alapján írja a generált mise-konfigba, de a bemásolt
   idiomatikus `.nvmrc` a mise feloldásakor felülírhatná azt. A két forrás
   eltérése ezért release blocker. A projekt `mise.toml` emellett fail-closed
   GPG-ellenőrzést kapcsol a Node letöltésére. A Railpack 0.38.0 által használt mise
   `minimum_release_age = "14d"` beállítása az exact `24.20.0` rögzítést nem
   utasítja el; ezt a pinned mise-verzióval tényleges telepítés igazolta.
   **FIGYELEM:** a service Variables közé tett `RAILPACK_NODE_VERSION` a
   Railpack provider feloldásakor felülírja az `engines.node`-ot, de az eltérő
   `.nvmrc` ezt később ismét felülírhatja; ne állíts be ilyen változót.
   Ha a futásidő eltér, a verifier még a lifecycle scriptek előtt leállítja a
   buildet; ilyenkor előbb ezt a változót keresd.
   A bizalmi határ a Railpack által generált exact Mise runtime: nem égetünk be
   változékony `/mise/...` abszolút útvonalat. A bootstrap az első műveletként
   ellenőrzi a `process.execPath` Node-verzióját és a mellette telepített npm CLI-t.
2. **Start:** `node ./node_modules/payload/bin.js migrate && exec node ./node_modules/next/dist/bin/next start`
   — az exact Railpack runtime explicit Node-ja futtatja a lockfile-ból telepített
   lokális JS entrypointokat, shebang-feloldás nélkül. A migráció idempotens és
   követett (a `payload_migrations` táblában), tehát minden bootnál biztonságosan
   lefut; új migráció esetén az indulás előtt érvényesül.
3. **Healthcheck:** `GET /admin` (a Payload admin mindig 200-at ad, bejelentkezés
   nélkül is a login-oldallal), 300 mp timeout, `ON_FAILURE` restart (3×).

## 1. Meglévő projekt és adatbázis ellenőrzése

1. Ez a runbook a meglévő production `Kineticare` appservice ellenőrzésére
   szolgál. Új service-t csak Railway IaC-val hozz létre, és az első deploy
   előtt rögzítsd benne ugyanezt a build-, start- és healthcheck-szerződést;
   a `railway.json` automatikus felismerésére új service-nél ne számíts.
2. A meglévő projektben ellenőrizd, hogy a PostgreSQL service a projekt
   **privát hálózatán** érhető el, és az appservice `DATABASE_URI` változója
   erre a service-re hivatkozik.
3. Az appservice **Settings → Source** részénél ellenőrizd: branch = `main`,
   **Auto-deploy** bekapcsolva (minden main-push új deploy).

## 2. Környezeti változók (appservice → Variables)

| Változó                      | Staging érték / forrás                                                                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URI`               | `${{Postgres.DATABASE_URL}}` (Railway referencia-változó, típusgomb: Reference)                                                                                                                                                             |
| `PAYLOAD_SECRET`             | frissen generált, pl. `openssl rand -hex 32` kimenete                                                                                                                                                                                       |
| `NEXT_PUBLIC_SERVER_URL`     | a staging domain, pl. `https://kineticare-staging.up.railway.app` (lásd 3. pont)                                                                                                                                                            |
| `BARION_ENVIRONMENT`         | `test`                                                                                                                                                                                                                                      |
| `BARION_API_URL`             | `https://api.test.barion.com`                                                                                                                                                                                                               |
| `BARION_POSKEY_TEST`         | sandbox POSKey — ld. `docs/barion-sandbox-setup.md`                                                                                                                                                                                         |
| `BARION_PAYEE_EMAIL`         | a sandbox Barion-fiók e-mail-címe                                                                                                                                                                                                           |
| `ENABLE_JOB_WORKERS`         | `true` (a callback retry-ladder így élőben is fut)                                                                                                                                                                                          |
| `LOG_LEVEL`                  | `info`                                                                                                                                                                                                                                      |
| `PAYLOAD_MEDIA_DIR`          | a csatolt **Volume mountpontja** (`/app/media`) — enélkül minden deploynál elvesznek a feltöltött képek (a konténer fájlrendszere efemer; a DB-rekord marad, a fájl eltűnik, a `/api/media/file/...` 500-at ad). Részletek: `.env.example`. |
| `FIRST_USER_BOOTSTRAP_TOKEN` | egyszer használatos, legalább 32 karakteres, nagy entrópiájú operátori titok az első owner létrehozásához; csak a bootstrap idejére állítsd be, értékét ne írd repóba, parancssorba vagy naplóba                                            |
| `SEED_OWNER_EMAIL`           | a már bootstrapelt owner címe az első seedhez, utána törölhető                                                                                                                                                                              |
| `SEED_OWNER_PASSWORD`        | bootstrap-alapú friss deploynál nem szükséges; hagyd unset állapotban                                                                                                                                                                       |

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

### 4.1 Első owner biztonságos bootstrapje

Üres adatbázison a publikus `/api/users` és `/api/users/first-register`
token nélkül nem hozhat létre felhasználót. Az első ownerhez:

1. állíts be egy egyszer használatos, legalább 32 karakteres, nagy entrópiájú
   `FIRST_USER_BOOTSTRAP_TOKEN` secretet az appservice Variables felületén;
2. operátori API-kliensből küldd el az első regisztrációt a
   `/api/users/first-register` végpontra, az
   `x-kineticare-bootstrap-token` fejlécben ugyanazzal az értékkel; az owner
   e-mail-címe egyezzen a későbbi `SEED_OWNER_EMAIL` értékével, a jelszó pedig
   feleljen meg a normál 12 karakteres kis-/nagybetű/szám szabálynak;
3. sikeres belépés után ellenőrizd az adminban, hogy pontosan egy owner van;
4. azonnal töröld a `FIRST_USER_BOOTSTRAP_TOKEN` változót a Railway-ről.

A titkot ne add parancssori argumentumként, ne mentsd shell-historyba, és ne
naplózd. Hiányzó szerveroldali secret esetén a claim `503`, hibás vagy hiányzó
fejlécnél `403`. A normál nyilvános regisztráció csak a bootstrap után nyílik
meg, és mindig `customer` szerepkört kap.

### 4.2 Seed

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

A seed a már bootstrapelt, `SEED_OWNER_EMAIL` című owner-felhasználót
megtalálja, majd létrehozza a
`DEMO-KEZREHAB-001` publikált demó-terméket (19 990 Ft),
`bemutatkozas` oldal, `kezrehabilitacio-alapok` bejegyzés, demó menüfa.

## 5. Deploy utáni ellenőrzőlista

- [ ] A **build-logban tényleges `node ./node_modules/next/dist/bin/next build` futás** szerepel — ha
      `Build · skipped (nothing to build)` látszik, a régi `.next/` indult el,
      és a deployt SHA nélkül (a branch HEAD-jére) újra kell indítani
- [ ] A **deploy-logban ott a `server_start` sor**, benne
      `"nodeVersion":"v24.20.0"` és a **várt `commitSha`**. Ha a nodeVersion nem
      exact `v24.20.0`: a service Variables közt keresd a
      `RAILPACK_NODE_VERSION`-t (felülírja az `engines.node`-ot).
      Ha a sor egyáltalán nincs meg: előbb a `LOG_LEVEL`-t ellenőrizd (`info` kell
      hozzá), csak utána gyanakodj régi kódra
- [ ] A build-logban a sorrend: egyetlen review-zott bootstrap → scriptmentes
      `npm ci` → verifier `OK` → jóváhagyott `npm rebuild` → lokális Next build;
      nincs Corepack bootstrap
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
