# Railway deploy — runbook

> **Frissítve 2026-09-23.** A `main` branch a Railway **`Kineticare`**
> szolgáltatására (production) deployol automatikusan. A merge-utáni kör csak
> ez a szolgáltatás; a `Kineticare-demo` 2026-08-29-től kivezetve, oda semmit
> nem deployolunk (`AGENTS.md`, `docs/demo-kornyezet.md`).
>
> A gyökérben lévő `railway.json` tartalmazza a build/start konfigurációt, és
> kulcsonként felülírja a dashboard beállítását (`CLAUDE.md` 2. üzemeltetési
> tanulság). Ezt kizárólag a már Config as Code-dal kezelt, meglévő
> `Kineticare` szolgáltatás olvassa; új szolgáltatás már nem kapcsolható erre
> a legacy konfigurációra.

> **Railway kivezetési határ: 2026-12-01.** A `railway.json` Config as Code
> deprecated, de a már ezt használó `Kineticare` szolgáltatásnál 2026-12-01-ig
> továbbra is működik, és az itt megadott kulcsokra felülírja a dashboardot.
> A hard cutoff előtt a live projekthez linkelt repóból előbb
> `railway config migrate` előnézet, majd emberileg jóváhagyott
> `railway config migrate --apply` kell: ez írja ki az IaC-fájlt és törli a
> service Config File beállítását. Ezután a `railway config plan` legyen tiszta,
> mielőtt a régi fájl törléséről külön döntés születik. A sima `config pull` +
> `config plan` útvonal blokkolt, amíg ugyanazt a service-t a Config as Code
> kezeli. A job-szolgáltatások (`railway.*-job.json`, lásd a 7. pontot) ugyanígy
> config-fájlt használnak, velük ugyanez a döntés kell.

## A projekt szolgáltatásai (2026-09-23)

| Szolgáltatás      | Szerep                                                                 | Config-fájl                     | Szabály                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `Kineticare`      | Production app (Next + Payload), `main` auto-deploy                    | `railway.json`                  | Minden merge után figyelni (5. pont).                                                                                    |
| `Postgres-c8Rg`   | Az éles adatbázis, **kötettel** (hivatalos `postgres-ssl:18` template) | —                               | A `Kineticare` `DATABASE_URI`-ja `${{Postgres-c8Rg.DATABASE_URL}}` referencia.                                           |
| `Postgres`        | A régi adatbázis, **kötet nélkül**, fagyasztott tartalék               | —                               | **Újraindítani, redeployolni, átkonfigurálni TILOS**: kötet híján bármelyik törli a tartalmát (`CLAUDE.md` 3. tanulság). |
| `content-job`     | Tulajdonosi tartalom-javítások (`src/scripts/apply-owner-content.ts`)  | `railway.content-job.json`      | Lásd a 7.1 pontot.                                                                                                       |
| `Kineticare-demo` | Kivezetve 2026-08-29-től, a forrás leválasztva (`repo: null`)          | `railway.demo.json` (történeti) | Semmi: nincs redeploy, nincs figyelés. A demo Postgres (`Postgres-UtWo`) is békén hagyandó.                              |

A többi `railway.*-job.json` (seed, tudastar, email, import, legacy) egy-egy
egyszeri job mintája; a szolgáltatás csak a futás idejére él (7.2 pont).

---

## 0. Mi történik deploykor (röviden)

1. **Build:** a repó `railpack.json` fájlja a pinned **Railpack 0.38.0** install
   lépését egyetlen `node scripts/install-reviewed-dependencies.mjs` bootstrapra
   írja felül: scriptmentes `npm ci`, a lockfile és a lifecycle-tarballok
   ellenőrzése, majd kizárólag az exact jóváhagyott install scriptek rebuildje.
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

1. Ez a runbook a meglévő production `Kineticare` szolgáltatás ellenőrzésére
   szolgál. Új szolgáltatást csak Railway IaC-val hozz létre, és az első deploy
   előtt rögzítsd benne ugyanezt a build-, start- és healthcheck-szerződést;
   a `railway.json` automatikus felismerésére új szolgáltatásnál ne számíts.
2. Az app `DATABASE_URI`-ja a kötetes **`Postgres-c8Rg`**-re mutasson
   (`${{Postgres-c8Rg.DATABASE_URL}}`, a projekt **privát hálózatán**). A régi,
   kötet nélküli `Postgres` szolgáltatáshoz ne nyúlj (lásd a táblát fent).
3. A `Kineticare` **Settings → Source** részénél: branch = `main`,
   **Auto-deploy** bekapcsolva (minden main-push új deploy).
4. A `pg` pool keepalive- és idle-timeout-hangolása, valamint a pool
   `error`-eseményének kezelése kötelező a Railway privát hálózatán
   (`CLAUDE.md` 7. tanulság); ne vedd ki a `src/payload.config.ts`-ből.

## 2. Környezeti változók (`Kineticare` → Variables)

Értéket a repóba soha nem írunk; a kulcsok listája és magyarázata a
`.env.example`-ben van. A `NEXT_PUBLIC_` kulcsokat a build **beégeti**, ezért
módosításuk után valódi újrabuild kell (nem elég a restart vagy a redeploy).

| Változó                      | Forrás / szabály                                                                                                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URI`               | `${{Postgres-c8Rg.DATABASE_URL}}` (Railway referencia-változó, típusgomb: Reference)                                                                                                                                                       |
| `PAYLOAD_SECRET`             | frissen generált, pl. `openssl rand -hex 32` kimenete                                                                                                                                                                                      |
| `NEXT_PUBLIC_SERVER_URL`     | a nyilvános cím, https-szel, perjel nélkül. Ma a `https://kineticare-production.up.railway.app`, a domain-átállás után `https://www.kineticare.hu` (3. pont). A Barion visszatérő- és callback-címe ebből épül.                            |
| `NEXT_PUBLIC_ALLOW_INDEXING` | `true` csak a domain-átállás után. Üresen minden válasz `X-Robots-Tag: noindex` (`src/middleware.ts`).                                                                                                                                     |
| `EXTRA_ALLOWED_ORIGINS`      | a domain-átállás előtt: `https://kineticare.hu,https://www.kineticare.hu`                                                                                                                                                                  |
| `BARION_ENVIRONMENT`         | `test` vagy `prod`; élesben kötelező megadni (`src/env.ts`). `prod` mellett a `BARION_POSKEY_PROD`, különben a `BARION_POSKEY_TEST` kötelező.                                                                                              |
| `BARION_API_URL`             | a környezethez illő API-cím (`api.test.barion.com` vagy `api.barion.com`, lásd `.env.example`)                                                                                                                                             |
| `BARION_PAYEE_EMAIL`         | a Barion-fiók e-mail-címe (sandboxhoz: `docs/barion-sandbox-setup.md`)                                                                                                                                                                     |
| `ENABLE_JOB_WORKERS`         | `true` (a callback retry-ladder így élőben is fut)                                                                                                                                                                                         |
| `LOG_LEVEL`                  | `info` (enélkül a `server_start` sor sem látszik, 5. pont)                                                                                                                                                                                 |
| `PAYLOAD_MEDIA_DIR`          | a csatolt **Volume mountpontja** (`/app/media`). Enélkül minden deploynál elvesznek a feltöltött képek (a konténer fájlrendszere efemer; a DB-rekord marad, a fájl eltűnik, a `/api/media/file/...` 500-at ad). Részletek: `.env.example`. |
| `FIRST_USER_BOOTSTRAP_TOKEN` | egyszer használatos, legalább 32 karakteres, nagy entrópiájú operátori titok az első owner létrehozásához; csak a bootstrap idejére állítsd be, értékét ne írd repóba, parancssorba vagy naplóba                                           |
| `SEED_OWNER_EMAIL`           | a már bootstrapelt owner címe az első seedhez, utána törölhető                                                                                                                                                                             |
| `SEED_OWNER_PASSWORD`        | bootstrap-alapú friss deploynál nem szükséges; hagyd unset állapotban                                                                                                                                                                      |

> ⚠️ **Turnstile: a két kulcs CSAK PÁRBAN állítható be.** A Railway
> `next start`-tal fut (`NODE_ENV=production`), és az induláskori ENV-assert
> (`src/env.ts`, `turnstileEnvPair`) fél-lábas konfigurációnál (csak
> `TURNSTILE_SITE_KEY` VAGY csak `TURNSTILE_SECRET_KEY`) MEGAKASZTJA az
> indulást: site key secret nélkül a widget látszana, de a szerver némán
> mindent átengedne; secret site key nélkül minden beküldés elakadna. Amíg
> egyik sincs beállítva, az app elindul, de a `server_start` után
> `turnstile_kikapcsolva` warn jelzi, hogy a kapcsolat-űrlapot csak az
> IP-keret védi. Egyik kulcs sem `NEXT_PUBLIC_`, tehát a beállításukhoz
> újrabuild nem kell: a Turnstile élesítése tisztán env-művelet. A
> domain-átállásnál a widget hostnevei közé a `www.kineticare.hu` és a
> `kineticare.hu` is kell.

További kulcsok (Bunny Stream, Resend/SMTP, Számlázz.hu, PostHog, GA4,
Barion Pixel): a `.env.example` sorolja fel őket, a `NEXT_PUBLIC_` kulcsok után
ÚJRABUILD kell.

> ⛔ **Teszt- és staging-környezetben tilos:** `BARION_POSKEY_PROD`, éles
> Számlázz.hu-kulcs, bármilyen éles titok. A teszt-környezet soha nem mutathat
> éles fiókra.

## 3. Domain

- **Ma:** a `Kineticare` szolgáltatásnak csak a Railway által generált
  `kineticare-production.up.railway.app` címe van (belső port 8080), egyedi
  domain nincs rajta (mérve 2026-09-23).
- **Átállás a `www.kineticare.hu`-ra:** a lépések, a mért DNS-állapot és a
  külső szolgáltatások listája a `docs/kineticare-hu-atallas.md` „Mért állapot
  és menetrend (2026-09-23)” szakaszában. Röviden: custom domain a Railway-en,
  csak a `www` CNAME változik a Tárhely.Eu-n, utána
  `NEXT_PUBLIC_SERVER_URL=https://www.kineticare.hu` és
  `NEXT_PUBLIC_ALLOW_INDEXING=true` valódi újrabuilddel.
- **A Railway-domaint az átállás után se töröld:** az addig indított fizetések
  Barion-callbackje oda érkezik.

## 4. Első migráció és seed (csak friss, üres környezetben)

A migráció a startCommandból minden indulásnál lefut; új migráció az app
indulása előtt érvényesül. A `payload migrate` a már lefutott migrációt nem
futtatja újra, hiányzó táblát tehát nem pótol (`CLAUDE.md` 5. tanulság).
Migrációt kézzel írni vagy szerkeszteni tilos (TILOS ZÓNÁK 3.).

Az alábbi bootstrap és seed **csak új, üres adatbázisú környezethez** kell. A
production `Kineticare`-en ezekre nincs szükség.

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

A `npm run seed` a már bootstrapelt, `SEED_OWNER_EMAIL` című owner-felhasználót
megtalálja, majd létrehozza a `DEMO-KEZREHAB-001` publikált demó-terméket,
a `bemutatkozas` oldalt, a `kezrehabilitacio-alapok` bejegyzést és a demó
menüfát. Idempotens, többször is lefuttatható.

- **Éles adatbázison a teljes seed tiltott** (`src/scripts/seed.ts`); élesben
  csak a szűkített `SEED_SCOPE=kezdolap` futhat, a meglévő szekciósort nem írja
  felül.
- Az éles adatbázis a Railway privát hálózatán van, kívülről nem érhető el,
  ezért a `railway run -- npm run seed` helyi gépről nem éri el. Adatbázison
  dolgozó scriptet a Railway-en belül, job-szolgáltatásként futtatunk
  (7. pont).

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
- [ ] A start-logban a migráció nyoma: `Migrating:` / `Migrated:` sorok, vagy
      függő migráció nélkül `Reading migration files` + `Done.`
- [ ] Railway deploy zöld, a healthcheck (`GET /admin`) átment
- [ ] `https://<domain>/admin` → Payload login-oldal töltődik
- [ ] `https://<domain>/kurzusok` → a kurzusok megjelennek
- [ ] A `main` CI (`ci.yml` + `gitleaks.yml`) zöld a squash-commiton
- [ ] Ha `WAITING` látszik snapshot és build-log nélkül: előbb a Railway MCP
      lépés-eseményeit nézd meg, ne indíts vaktában új deployt (`CLAUDE.md` 12. tanulság). A `create-deployment` ÚJ szolgáltatást hoz létre, meglévő
      újraindításához `redeploy` vagy `restart-service` való (13. tanulság).
- [ ] `git clone failed with exit 128` a `SNAPSHOT_CODE` fázisban: a deploy
      rövidített SHA-val indult. Teljes (40 karakteres) SHA-val vagy SHA
      nélkül, a branch HEAD-jére indítsd újra (4. tanulság).

## 6. Rollback

`Kineticare` → **Deployments** → a legutóbbi zöld deploy → **Redeploy**. A
Railway új build nélkül a régi képet indítja. Két korlát:

- A redeploy a régi `.next/`-et futtatja, tehát a `NEXT_PUBLIC_` értékek is a
  régiek (a buildkor beégetettek).
- **Az adatbázis-migráció nem görgethető vissza** a kóddal együtt: a régi kód
  az új sémán indul. Migráció visszafordítása külön döntés, és csak a mentésből
  (`docs/adatbazis-mentes.md`) történhet. Az adatbázis-szolgáltatást törölni,
  újraindítani vagy újra létrehozni rollback címén tilos: a `Postgres-c8Rg` az
  éles adat, a régi `Postgres` kötet nélküli tartalék.

## 7. Job-szolgáltatások (egyszeri scriptek a Railway-en)

Az éles adatbázis csak a Railway privát hálózatáról érhető el, ezért az
adatbázison dolgozó scriptek külön szolgáltatásként futnak, ugyanarról a
repóról. A config-fájl mindig felülírja a dashboard beállítását, ezért minden
jobnak saját `railway.*-job.json` fájlja van, és a szolgáltatás **„Config file
path”** beállítása erre mutat (`CLAUDE.md` 2. tanulság). Közös minta:

- a build csak egy `echo`, a start a scriptet futtatja, a végén
  `sleep 2147483647`, hogy a Railway ne indítsa újra, és a napló olvasható
  maradjon;
- a `DATABASE_URI` és a `PAYLOAD_SECRET` ugyanaz, mint a `Kineticare`-en
  (`DATABASE_URI`: `${{Postgres-c8Rg.DATABASE_URL}}`);
- a job **nem látja** az app kötetét (`PAYLOAD_MEDIA_DIR`): ha a script
  Médiatár-rekordot hoz létre, a job után az appot újra kell indítani, hogy a
  hiányzó fájlokat a manifestből visszatöltse (`docs/owner-content-2026-09-19.md`);
- **csak teljes, 40 karakteres commit-SHA-val deployolj** (vagy SHA nélkül, a
  `main` HEAD-jére). Rövid SHA-nál a `SNAPSHOT_CODE` `git clone … exit 128`-cal
  bukik. A `redeploy` a meglévő snapshotot futtatja újra, vagyis a **régi
  kódot**: új szabályhoz új deploy kell a friss SHA-ra.

### 7.1 content-job (tulajdonosi tartalom-javítások)

- Config-fájl: `railway.content-job.json`. A start:
  `echo CONTENT_JOB_START; npx tsx src/scripts/apply-owner-content.ts && echo CONTENT_JOB_DONE; sleep …`
  (újraindítás: `ON_FAILURE`, legfeljebb 1).
- **Kapu:** `OWNER_CONTENT_CONFIRM`. Ha nem `igen`, a script **próbafutás**:
  a naplóban „MÓDOSÍTANÁ” sorok, az adatbázisba semmi nem íródik. Írni csak
  `OWNER_CONTENT_CONFIRM=igen` mellett ír.
- Menet:
  1. próbafutás a friss `main` teljes SHA-jára, a napló átnézése;
  2. `OWNER_CONTENT_CONFIRM=igen`, új deploy ugyanarra a SHA-ra;
  3. **azonnal vissza `OWNER_CONTENT_CONFIRM=nem`-re**, és egy második
     próbafutás: minden érintett szabálynál „MÁR …” kihagyás jelzi, hogy nincs
     több teendő (idempotencia);
  4. ha a futás képet hozott létre, az app újraindítása, utána böngészős
     ellenőrzés.
- A kapu visszaállítása azért kötelező, mert egy későbbi automatikus deploy
  különben újra élesben futna. Egyes szabályok egyszeriek: a sín Elrendezés-
  kitöltése (#293) például egy szerkesztő későbbi, tudatos Tábla-választását
  visszaírná Sínre (`src/scripts/apply-owner-content.ts` fejkommentje).
- A szabályok leírása: `docs/owner-content-2026-09-19.md`,
  `docs/owner-content-2026-09-22.md`, `docs/akcios-kurzus-2026-09-20.md`.

### 7.2 A többi job-fájl

| Fájl                        | Mit futtat                                       | Kapu, megjegyzés                                                                                                      |
| --------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `railway.seed-job.json`     | `seed-menu.ts`, majd `restore-legacy-content.ts` | `MENU_SEED_DRY_RUN`, `LEGACY_RESTORE_CONFIRM` (`.env.example`)                                                        |
| `railway.tudastar-job.json` | Tudástár-cikkek és tünet-oldalak betöltése       | `OWNER_TUDASTAR_CONFIRM`, `OWNER_TUDASTAR_PUBLISH`; a napló kiírja a commitot (`docs/tudastar-cikkek-betoltese.md`)   |
| `railway.email-job.json`    | Átállási értesítő (`send-migration-notice.ts`)   | `MIGRATION_NOTICE_CONFIRM`, argumentumok az `EMAIL_JOB_ARGS`-ból; futás után ürítsd (`docs/vasarlo-migracio-terv.md`) |
| `railway.import-job.json`   | Vevő-import (`scripts/import-job.sh`)            | `docs/vasarlo-migracio-terv.md`                                                                                       |
| `railway.legacy-job.json`   | `restore-legacy-content.ts`                      | `LEGACY_RESTORE_CONFIRM`                                                                                              |
| `railway.demo.json`         | —                                                | Történeti, a `Kineticare-demo` kivezetve. Ne használd.                                                                |

Egyszeri job után a szolgáltatás törölhető (a `content-job` tartósan
megmarad, a kapuja zárva).

## 8. Ügynök-hozzáférés (railway.com/agents alapján)

A Railway két hivatalos felületet ad ügynököknek:

1. **Remote MCP szerver** (`https://mcp.railway.app/mcp`, OAuth-belépés):
   terminálból deploy, log, változó.
2. **CLI + token** (`@railway/cli`, `RAILWAY_TOKEN`): headless/CI ügynököknek.

A token a **GitHub repo secretbe** kerül (Settings → Secrets → Actions),
**soha nem a repóba, nem logba, nem kommentbe**. Ügynök-parancsokban csak
környezeti változóként hivatkozható (`$RAILWAY_TOKEN`), képernyőre írni vagy
naplózni tilos. Változó-listát kiolvasni csak akkor, ha a feladat tényleg
megköveteli: a válasz titkokat tartalmaz.

## 9. Költség- és korlát-megjegyzések

- A Next.js build memóriaigénye a legnagyobb tétel (a `sharp` natív modul is
  épül; a Railpack builder kezeli, lásd a 0. pontot).
- `numReplicas: 1` szándékos: így a boot-time migráció nem futhat párhuzamosan
  két példányban. Skálázásnál a migráció külön, deploy előtti lépésbe kerül
  (pre-deploy job), a startCommandból kikerül.
