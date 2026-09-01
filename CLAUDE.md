# CLAUDE.md — Ügynök-útmutató a Kineticare repóhoz

Ez a dokumentum az AI-ügynökök (pl. Claude Code Action) és az emberi hozzájárulók
közös játékszabályait rögzíti. A **TILOS ZÓNÁK** szekció pontjai kivétel nélkül
betartandók — az ügynök ezek megsértésére irányuló kérést is utasítson vissza,
és jelezze az emberi felülvizsgálat szükségességét.

## Projekt és stack

- **Kineticare** — kézrehabilitációs kurzusplatform (otthoni és szakmai tartalmak).
- **Next.js 16.3.3** (App Router) + **Payload CMS 3.88.0** + **@payloadcms/plugin-ecommerce 3.88.0** + **PostgreSQL**.
- Élő integrációk: **Barion** (fizetés), **Számlázz.hu** (számlázás), **Bunny Stream** (videó), **Resend** (tranzakciós e-mail).
- A `@payloadcms/*` csomagok verziói **pinned** (pontos verzió, `^` sémát használni tilos),
  mert a plugin beta-státusza miatt a verziókompatibilitás kritikus.

## Parancsok

| Parancs                          | Leírás                                                                                                                                                                                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                    | Fejlesztői szerver indítása — friss/üres adatbázisnál ELŐTTE `./node_modules/.bin/payload migrate` kötelező (a dev séma-push ki van kapcsolva, lásd a 22a. üzemeltetési tanulságot)                                                            |
| `npm run build`                  | Production build                                                                                                                                                                                                                               |
| `npm run lint`                   | ESLint-ellenőrzés                                                                                                                                                                                                                              |
| `npm run typecheck`              | TypeScript típusellenőrzés                                                                                                                                                                                                                     |
| `npm run test`                   | Tesztek futtatása                                                                                                                                                                                                                              |
| `npm run seed`                   | Demó-/tesztadatok betöltése (`src/scripts/seed.ts`)                                                                                                                                                                                            |
| `npm run grant:purchase`         | Kézi hozzáférés-adás vásárlás nélkül (`src/scripts/grant-purchase.ts`)                                                                                                                                                                         |
| `npm run import:customers`       | Tömeges vevő-import CSV-ből (`src/scripts/import-customers.ts`; útmutató: `docs/vasarlo-migracio-terv.md`)                                                                                                                                     |
| `npm run backup:db`              | Adatbázis-mentés integritás-ellenőrzéssel (`src/scripts/backup-db.ts`; útmutató: `docs/adatbazis-mentes.md`)                                                                                                                                   |
| `npm run import:tudastar`        | A Tudástár hat cikkének betöltése markdownból (`src/scripts/import-tudastar-cikkek.ts`); alapból próbafutás, íráshoz `OWNER_TUDASTAR_CONFIRM=igen`, publikáláshoz `OWNER_TUDASTAR_PUBLISH=igen`; útmutató: `docs/tudastar-cikkek-betoltese.md` |
| `npm run seed:legacy`            | Örökölt tartalom visszatöltése (`src/scripts/restore-legacy-content.ts`)                                                                                                                                                                       |
| `npm run content:owner`          | Tulajdonos által jóváhagyott, egyszeri tartalom-javítások (`src/scripts/apply-owner-content.ts`); alapból próbafutás, íráshoz `OWNER_CONTENT_CONFIRM=igen`                                                                                     |
| `npm run backfill:ar-snapshot`   | Egyszeri ár-snapshot backfill (`src/scripts/backfill-price-snapshot.ts`); alapból próbafutás, íráshoz `OWNER_BACKFILL_CONFIRM=igen`; útmutató: `docs/ar-snapshot-backfill.md`                                                                  |
| `npm run backfill:access-grants` | Hiányzó accessGrants-óra paid dátumából (`src/scripts/backfill-access-grants.ts`); próbafutás, íráshoz `OWNER_BACKFILL_CONFIRM=igen`; útmutató: `docs/access-grants-backfill.md`                                                               |

## Kódolási konvenciók

- **TypeScript strict** mód; `any` használata tilos — indokolt esetben `unknown` + típusszűkítés.
- Kikommentezett kód nem maradhat a repóban. (Kivétel: a kifejezetten váz-jellegű
  fájlok — pl. `src/scripts/seed.ts` — TODO-kommentjei.)
- A felhasználónak szóló hibaüzenetek **magyarul** fogalmazandók.
- A technikai hibák strukturált naplóba kerülnek, **request ID**-vel együtt
  (`src/lib/logger.ts`); a bejövő kéréseket a `src/middleware.ts` látja el request ID-val.
- Naplózáshoz mindig a `src/lib/logger.ts` segédletét használd (ne `console.log`);
  a logger redact-listája miatt érzékeny mező (jelszó, token, kártyaadat stb.)
  sosem kerülhet a naplóba.
- Kis, fókuszált commitok; a commit-üzenet magyarul vagy angolul, de mindig
  tartalmazza az érintett scope-ot.

## TILOS ZÓNÁK

1. **Titok sosem kerül a repóba.** Jelszó, API-kulcs, token, POSKey, tanúsítvány
   vagy bármely credential nem kerülhet a kódba, konfigba, kommentbe vagy
   tesztfixtúrába — még placeholderként sem. A workflow-k csak `secrets.*`
   hivatkozást tartalmazhatnak. A `.env*` fájlokhoz ne nyúlj (ne olvasd, ne
   módosítsd, ne másold be tartalmukat); ha környezeti változó kell, az
   `.env.example`-t bővítendő kulccsal (érték nélkül) jelezd az emberi maintainernek.
2. **Az `@payloadcms/plugin-ecommerce` `confirmOrder` függvénye TILOS.** A
   fizetésjóváhagyás saját, Barion-callback-vezérelt állapotgéppel történik a
   plugin ismert beta-hibája miatt. A `confirmOrder`-t ne hívd, ne importáld, ne
   re-exportáld és ne próbáld „megjavítani"; rendelés-jóváhagyási logikát
   kizárólag a saját állapotgépben szabad írni.
3. **Adatbázis-migrációkat kézzel ne írj és ne módosíts.** A migrációk a Payload
   migrációs eszközével generálandók; meglévő migrációs fájl szerkesztése,
   törlése vagy újrafuttatási sorrend módosítása tilos. A zónának végrehajtható
   őrei vannak (G3/G4), lásd `docs/ci-orok.md`.
4. **Access-control (jogosultság) függvények módosítása csak emberi jóváhagyással.**
   Collection- és field-szintű `access` szabályok, valamint auth-hookok
   átírásához az ügynök PR-t nyithat, de merge előtt emberi review kötelező.
5. **A pinned `@payloadcms/*` verziókat ne emeld fel**, és ne állítsd át `^`
   sémára. Verzióemelés csak kifejezett emberi kérésre, külön PR-ben történhet.

## Felületi (UX/UI) munka

**KÖTELEZŐ SKILL: `.claude/skills/termektervezes/SKILL.md`** — a vevői felület
BÁRMELY elemének tervezése vagy módosítása előtt be kell tölteni (gomb, felirat,
navigáció, szekció, űrlap, állapot, folyamat, tipográfia, szín, elrendezés — akkor
is, ha „csak" egy szöveget írnál át).

A tulajdonos 2026-08-16-i kikötése, szó szerint: _„semmit nem jelentetek késznek,
ha csak memóriából dolgoztatok, mindenre kell több tanulmány, kutatás, tudományos
legyen, valamint világhírű terméktervező cégeknek a tanulmányait kell figyelembe
venni minden tervezésnél"_ — és: a vevői szövegekben nem lehet AI-ízű,
gondolatjel-halmozó írásmód, natív magyar kell.

Ebből következően minden felületi döntéshez legalább KÉT külső forrás kell
(NN/g, Baymard, GOV.UK, Apple HIG, Material 3, Polaris, Carbon, WCAG 2.2 a
sikerkritérium számával), és minden állítást MÉRNI kell (kontraszt-arány,
érintőcél, sorhossz, 320 px-es reflow), nem szemre becsülni.

Hivatkozási kézikönyvek: `docs/ui-sztenderdek.md` (sztenderdek + magyar
mikroszöveg-szabályzat), `docs/informacios-architektura.md` (útvonal- és
gomb-gráf), `docs/gomb-inventar.md` (CTA-szótár), `docs/gomb-kontraszt-audit.md`,
`docs/felhasznaloi-seta.md` (kognitív séta personával),
`docs/regi-oldal-osszehasonlitas.md`, `docs/ertekesitesi-ux-skill.md`
(cél-hierarchia M1–M8, sticky-nav, tipográfiai skála), `docs/ux-hierarchia-audit.md`.

## Branch-konvenció

- Formátum: `feat/<ticket-id>-<rovid-nev>` — pl. `feat/KIN-12-barion-callback`.
- Hibajavításhoz: `fix/<ticket-id>-<rovid-nev>`.
- Kis betű, kötőjel, ékezetek nélkül.

## PR-elvárások (röviden)

- A CI legyen zöld: lint, typecheck, test, build.
- A PR-leírás tartalmazza: mit és miért változtat, érintett tilos zóna van-e,
  hogyan lett ellenőrizve.
- Új viselkedéshez fókuszált teszt vagy legalább reprodukálható ellenőrzési lépés.
- Titok, `.env*` fájl, migrációs kézi szerkesztés, `confirmOrder`-hívás és
  `any`-típus esetén a PR automatikusan elutasítandó.
- **Merge után a munka NEM kész.** Azonnal figyeld a `main` GitHub CI-jét és a
  Railway deployt (tényleges `npm run build`, migráció a start-logban,
  `GET /admin` healthcheck). Piros vagy gyanús állapotot azonnal javíts, ne
  várj külön kérésre. Részletek: `AGENTS.md` „Merge után" szekció.
- **A modellválasztás nem szabad kéz.** 2026-08-22-től a Kineticare
  ügynök-csapatának alapbeállítása: **orkesztrátor = GPT-5.6 Sol legerősebb
  thinking** (`gpt-5.6-sol-xhigh`); **minden Grok-ügynök = Cursor Grok 4.6
  extra high** (`cursor-grok-4.6-xhigh`). A `high` / `high-fast` Grok-slug
  tilos. Ettől eltérni csak a tulajdonos kifejezett kérésére szabad.
  Részletek: a „Munkamodell" szekció és az `AGENTS.md` „Cursor-modellek"
  szekciója. A teljes `main` Bugbot-átnézéséhez a
  `.cursor/agents/kineticare-bugbot.md` projekt-subagentet használd.

## Üzemeltetési tanulságok — élesben szerzett

Ezek mind valós, órákat elvivő hibák voltak. Mielőtt új diagnózist építesz,
nézd végig, hogy nem ezek egyikébe futottál-e.

### Deploy (Railway)

1. **A „SUCCESS" deploy nem jelenti, hogy az új kód fut.** A Railway builder
   `Build · skipped (nothing to build)` döntéssel kihagyhatja a buildet: lehúzza
   az új commitot, de a **régi `.next/` mappát** indítja el. Hetekig futhat így
   régi kód, miközben minden zöld. **Ellenőrzés:** a deploy build-logjában
   szerepelnie kell egy tényleges `npm run build` futásnak. Ezért van explicit
   `buildCommand` és `healthcheckPath` beállítva.
2. **A config-as-code (`railway.json`) MINDIG felülírja a service-beállítást**
   — a hivatalos dokumentáció szerint is („Configuration defined in code will
   always override values from the dashboard"). 2026-08-16-án mérve: az API-n
   beállított egyedi `startCommand`-ot a repóból deployoló szolgáltatás némán
   figyelmen kívül hagyta, és a `railway.json` `startCommand`-ját futtatta —
   redeploy után is. Ha egy szolgáltatásnak MÁS parancs kell (pl. seed-job),
   az egyetlen megbízható út: dedikált config-fájl a repóban
   (`railway.seed-job.json`) + a szolgáltatáson a
   „Config file path" (API: `railwayConfigFile`) átállítása erre a fájlra.
   A `railway.demo.json` történeti: a `Kineticare-demo` 2026-08-29-től
   kivezetve, oda semmit nem deployolunk.
   A fájlban NEM szereplő beállításokat továbbra is a dashboard adja — a
   felülírás kulcsonként érvényesül.
3. **A Postgres-szolgáltatás újraindítása kiürítheti az adatbázist.** Egy
   redeploy `initdb`-t futtatott és a kötet üresen jött vissza — a séma csak a
   `payload migrate` újrafutásával állt helyre. **2026-08-15-i frissítés — a
   gyökérok: a régi `Postgres` szolgáltatásnak NEM VOLT kötete**, az adat a
   konténer múlandó fájlrendszerén élt. Az éles DB azóta a **`Postgres-c8Rg`**
   szolgáltatásban fut (hivatalos `postgres-ssl:18` template, kötettel), a
   Kineticare `DATABASE_URI`-ja `${{Postgres-c8Rg.DATABASE_URL}}` referencia.
   A régi `Postgres` szolgáltatás fagyasztott tartalék: **újraindítani,
   redeployolni, átkonfigurálni TILOS** — kötet híján bármelyik törli a
   tartalmát. Offsite mentés: `db-backup.yml` (C14, a `DATABASE_URI`
   GitHub-secret beállítása után él).
4. **Deploy-hibák, amiket már láttunk:**
   - `git clone failed with exit 128` a `SNAPSHOT_CODE` fázisban → a deployt
     **rövidített commit-SHA-val** indították. SHA nélkül (a branch HEAD-jére)
     azonnal átmegy.
   - `ublkFlush: flush failed: manifest precondition failed` a `PUBLISH_IMAGE`
     fázisban → Railway-oldali blockstore-hiba, nem a kód. Több gépen is
     előjött, nyilvános incidens nélkül. Újrapróbálás segít (nálunk a 3.
     kísérletre ment át).
   - Ha a build, healthcheck és deploy lépés zöld, és csak utána bukik: a hiba
     szinte biztosan a platformé, ne a kódban keresd.

### Adatbázis és Payload

5. **`payload migrate` nem futtatja újra a már lefutott migrációkat.** Hiányzó
   tábla esetén a `migrate` „Done"-t ír és nem csinál semmit.
6. **Hosszú (30+ mp) befagyás írásnál = sorzár, nem lassú lekérdezés.** Egy
   beragadt, nyitva maradt tranzakció (`unexpected EOF on client connection with
an open transaction`) zárolja a sort, és minden írás megáll rajta. Olvasás
   közben gyors marad — ez a megkülönböztető jel.
7. **A `pg` pool hangolása kötelező a Railway privát hálózatán.** A háló elvágja
   a tétlen TCP-kapcsolatokat; keepalive és idle-timeout nélkül a pool halott
   socketet használ újra, és a kérés a TCP retransmission-timeoutig (~45 mp)
   áll. A pool `error` eseményét is le KELL kezelni, különben
   `uncaughtException`-ként viszi el a Next.js szerverfolyamatot.

### Auth és első indulás

8. **Az első user owner szerepkört kap** (`promoteFirstUserToOwner` hook).
   Enélkül a rendszer telepítés után zárva marad: a `role` mező owner-only,
   tehát az első user `customer` lenne, aki nem jut be az adminba, nem
   törölhető (`access.delete: isOwner`) és a szerepköre sem írható át.
9. **A 2. usertől a `role` alapértelmezése `customer`.** Admin-hozzáféréshez az
   adminban kézzel `staff`-ra kell állítani — ezen bukott el több teszt-user.

### Build és eszközök

10. **A lockfile-t tiszta registry-ből kell generálni.** Ha a `resolved` URL-ek
    privát tükörre (pl. `npm.mirrors.*`) mutatnak, a CI runner nem éri el őket.
    Ellenőrzés: `grep -o '"resolved": "https://[^/]*' package-lock.json | sort -u`.
11. **A `robots.ts` és `sitemap.ts` csak a gyökér `src/app/` mappából
    generálódik.** A `(frontend)` route-groupból a `robots.ts` némán kimarad —
    a build route-manifestjében ellenőrizhető, hogy létrejött-e.

### Railway MCP-eszközök

12. **A `list-deployments` ELAVULT státuszt adhat vissza.** Egy deploy 25+ percig
    `WAITING`-nek látszott (snapshot és build-log nélkül), miközben a valóságban
    már rég lefutott: a `railway-agent` `getDeploymentInfo`-ja szerint minden
    fázis (`SNAPSHOT_CODE` → `CONFIGURE_NETWORK`) `completed` volt, a státusz
    `SUCCESS`. **Ha WAITING-et látsz build-log és snapshot nélkül, előbb a
    `railway-agent`-tel kérdezz rá a lépés-eseményekre** — ne indíts új deployt
    vaktában, mert a „beragadás" lehet, hogy csak megjelenítési hiba.
13. **A `create-deployment` ÚJ SERVICE-T hoz létre**, nem a megadott `serviceId`-jű
    meglévőt deployolja — nálunk így keletkezett egy fölösleges service, amit
    törölni kellett. Meglévő service újraindításához: `redeploy` (snapshot kell
    hozzá) vagy a `railway-agent` `restartServiceTool`-ja.
14. **A migrációk a deploy részeként FUTNAK.** A start-parancs
    `./node_modules/.bin/payload migrate && exec ./node_modules/.bin/next start` —
    kizárólag a lockfile-ból telepített lokális binárisokat használja; a tényleges
    deploy-konfigurációban a `railway.json`-ból kell származnia (a 2. pont miatt).
    Ez a legacy Config as Code útvonal csak 2026-12-01-ig él; előtte a live
    projekthez linkelt repóban `railway config migrate` előnézet, majd emberileg
    jóváhagyott `railway config migrate --apply` kell; ezután tiszta
    `railway config plan` bizonyítsa az IaC-egyezést. A `&&` miatt
    bukó migráció esetén az app el sem indul → healthcheck-hiba, tehát a baj
    látható, nem néma. **Ellenőrzés:** a deploy-logban ott kell lennie a
    `Migrating: …` / `Migrated: …` soroknak.

### Ügynök-munkafolyamat (workflow, worktree, harvest)

15. **Tesztből SOSEM mehet ki valódi hálózati hívás.** Egy szolgáltatás-teszt
    injektált mock nélkül a VALÓDI szamlazz.hu-t hívta meg — a ~1,5 mp-es
    futásidő árulta el (a többi teszt milliszekundumos). Minden folyamat-teszt
    injektálja a HTTP-hívókat (`postXml`, `queryByKulsoAzon`), a `fetch`-eseket
    pedig `vi.stubGlobal('fetch', …)` + `afterEach(vi.unstubAllGlobals)` fedi.
    Ahol egy ágon hívásnak NEM szabad futnia, oda hangosan dobó mock való.
16. **Fan-outnál adj TISZTA fájl-tulajdonlást.** Ha két ügynök ugyanazt a fájlt
    kapja (akár más régióban), a harvest kézi összefésülést igényel. Bevált:
    `git add -A` (hogy az index a már alkalmazott változatot tartalmazza), majd
    `git apply --3way` a második patchre — a konfliktusok általában kommentekre
    és importokra szorítkoznak. Duplikált segédfüggvényeket a harvestnél kell
    egy közös változatra visszavezetni.
17. **A párhuzamossági korlát ~2 ügynök** (CPU-alapú cap), a többi sorban áll:
    egy 4 ügynökös kör ~35–40 perc. Ezzel tervezz, ne tekintsd elakadásnak.
18. **A „permission handler returned updatedInput" hiba SZÓRVÁNYOS és NEM
    blokkoló.** Egy ügynöknél egyszer előfordult, utána zavartalanul dolgozott
    tovább — emiatt nem kell workflow-t újraindítani. Ha sorozatosan jelentkezik,
    a munkát a fő szálban kell befejezni.
19. **Leállt workflow után minden visszanyerhető** a worktree-kből és a
    `~/.claude/projects/.../subagents/workflows/<runId>/journal.jsonl`-ből (az
    ügynökök jelentései soronként). Egy session-újraindulás így nem jelent
    elveszett munkát — a fő szálban kell felszüretelni.

### Git és shell

20. **Squash-merge után a branch commitjai NEM ősei a mainnek.** A
    `git merge-base --is-ancestor` ezért hamisan „nincs benne"-t mond. A helyes
    ellenőrzés: `git diff <branch-tip> <squash-commit>` — ha üres, a tartalom
    hiánytalanul átment, és a branch force-with-lease-szel újraalapozható.
    20b. **Futó ügynökök mellett a `git add -A` SZAKADT fájlt commitolhat.** Mérve
    2026-08-21: a `npm run typecheck` zöld volt, utána `git add -A`, majd a
    CI mégis `TS1002: Unterminated string literal`-lel bukott. A gyökérok
    verseny-helyzet: a mérés és a stage-elés KÖZÖTT az ügynök újraírta a
    fájlt, és a stage a félbeírt állapotot rögzítette (`'nem is` / új sor /
    `te hibáztál')`). A mérés tehát a KORÁBBI, teljes tartalmat igazolta, a
    commit meg a KÉSŐBBI, csonkát vitte fel.
    **Szabály: azt kell ellenőrizni, ami STAGE-ELVE van, nem azt, ami a
    mérés pillanatában a lemezen volt.** Sorrend: `git add -A` → futtasd a
    typecheck-et → `git status --short` és `git diff --stat` (üresnek kell
    lennie a stage-elt fájlokra) → csak ezután commit. Ha a fájlok a mérés
    alatt mozogtak, kezdd elölről. Alternatíva: `git show :<fajl>` a
    stage-elt tartalomra, és azt ellenőrizd.

21. **Idézőjelet tartalmazó commit-üzenet töri a `git commit -m "…"`-t** (a
    string korán lezárul, a maradék pathspec-ként hibázik, de a `git add` már
    lefutott — így a következő commit magával viszi a bestage-elt fájlokat!).
    Használj `git commit -F -` + heredoc-ot, és commit után ellenőrizd a
    `git status`-t.
    22a. **A Payload dev-módú séma-push KI VAN KAPCSOLVA** (`push: false` a
    postgres-adapterben, őr-teszt védi). Ok: séma-eltérésnél a push interaktív,
    TÁBLATÖRLÉST kínáló promptot ad, amin minden nem-interaktív futás némán,
    örökre megakad (mérve: 6+ perc ep_poll, a GET /admin sosem válaszol), rossz
    env mellett pedig éles-alakú adatbázison törölne. Sémaváltozásnál helyben
    is a migrációs lánc az út: `./node_modules/.bin/payload migrate:create` +
    `./node_modules/.bin/payload migrate`. Következmény: friss adatbázisnál a
    `npm run dev` előtt migrate kell — enélkül az admin felállni feláll, de a
    seed/lekérdezések hangos
    warnnal buknak.

22b. **Helyi Postgres a migráció-generáláshoz** (a `pgrun` user kell, mert az
`initdb` rootként nem indul): a socket-könyvtárnak `pgrun`-írhatónak kell
lennie (`-k <dir>`), és a scratchpad SZÜLŐ könyvtáraira is kell `o+x`
bejárási jog, különben a `pg_ctl` „Permission denied"-dal áll le.

22c. **A scratchpadben NEM fér el a Postgres unix socketje.** A socket teljes
útja legfeljebb **107 bájt** lehet, a session-scratchpad útja önmagában
~90 karakter, tehát a `-k <scratchpad-alkönyvtár>` mindig elbukik:
`Unix-domain socket path … is too long` → `could not create any
    Unix-domain sockets` → `FATAL`. A hiba megtévesztő, mert a `pg_ctl` csak
annyit ír, hogy „could not start server". **Megoldás:** kapcsold ki a unix
socketet és menj TCP-n: `-o "-p 5433 -k '' -h 127.0.0.1"`, a kliens pedig
`postgres://postgres@127.0.0.1:5433/<db>`. Mellékfeltétel: a `-l <logfile>`
fájlt a `pg_ctl` a `pgrun` nevében nyitja, ezért a logfájlnak LÉTEZNIE kell
és `pgrun`-tulajdonúnak — különben „Permission denied", és a szerver
naplója sosem íródik ki. (Mérve 2026-08-21.)

23. **Merge után azonnal a GitHub CI és a Railway production.** A squash-merge
    nem zárja a kört. A `main` CI (`ci.yml` + gitleaks) legyen zöld; a
    **`Kineticare`** appservice-en tényleges `npm run build` (ne skipped),
    start-logban `Migrating:` / `Migrated:` (vagy `Reading migration files` +
    `Done.`), healthcheck `GET /admin`. A „SUCCESS" deploy nem elég (1. pont).
    `WAITING` snapshot nélkül: előbb a lépés-események, ne indíts vaktában
    új deployt (12. pont). Hiba esetén azonnal javíts. A `Kineticare-demo`
    nem része a körnek (24. pont).
24. **A `Kineticare-demo` 2026-08-29-től kivezetve (tulajdonosi döntés).**
    Oda semmit nem deployolunk: nincs `redeploy`, `create-deployment`,
    GitHub-forrás visszakötése, `--from-source` rebuild, merge-utáni figyelés
    és élő E2E a demo hoston. A forrás le van választva (`repo: null`).
    A `railway.demo.json` és a `docs/demo-kornyezet.md` történeti. A demo
    Postgres (`Postgres-UtWo`) és a régi kötet nélküli `Postgres` békén
    hagyandó.

## Munkamodell — Sol orkesztrátor + Grok 4.6 extra high csapat (tulajdonosi alapbeállítás, 2026-08-22)

Ez a szekció **felülírja** a 2026-08-15-i Opus-alapbeállítást. A tervezés,
a mérés, a tiszta fájl-tulajdonlás és a merge-utáni figyelés szabályai
érvényben maradnak; ami változott: ki a vezető, és ki végzi a munkát.

**Kiosztás (külön kérés nélkül):**

| Szerep                                                         | Modell                           | Kiosztható slug         |
| -------------------------------------------------------------- | -------------------------------- | ----------------------- |
| Orkesztrátor / vezető                                          | GPT-5.6 Sol, legerősebb thinking | `gpt-5.6-sol-xhigh`     |
| Agentic csapat (felderítés, megvalósítás, javítás, ellenőrzés) | Cursor Grok 4.6 extra high       | `cursor-grok-4.6-xhigh` |

**Minden Grok-ügynök extra high.** Cloud Agent, picker, Task-subagent, Bugbot —
ugyanaz a szabály. A `cursor-grok-4.6-high` és a `cursor-grok-4.6-high-fast`
**tilos** (nem extra high). A `cursor-grok-4.6-xhigh-fast` csak akkor, ha a
tulajdonos gyors kört kér. Ne helyettesítsd Opus-szal, Grok 4.5-tel vagy
Composerrel. A Sol `xhigh-fast` gyorsítása szintén csak tulajdonosi kérésre;
az orkesztrátor alapból a nem-fast `xhigh`.

Ha egy felület Task-listája nem tartalmazza a `cursor-grok-4.6-xhigh` slugot:
ne vedd `high-fast`-ra. Jelezd, és a munkát az extra-high szülő végezze, vagy
a tulajdonos indítson extra-high Cloud Agentet.

Minden kódolási munkánál:

1. **A vezető (Sol xhigh) tervez és ellenőriz.** A fennmaradó feladatok
   átnézése, a megoldások aprólékos kitalálása és a feladatkiírás a vezető
   dolga. A kiírás részletes: cél, érintett fájlok, elfogadási feltételek,
   tilalmak, ellenőrzési mód.
2. **A munkát Grok 4.6 extra-high ügynökök végzik**, mindegyik a saját
   szakterületének profija. Addig dolgoznak, amíg a kiírás minden pontja kész.
   Javító kört is ők visznek, nem az orkesztrátor „mellékesen".
3. **Az ügynök, ha valamiben nem biztos:** előbb kutat (internet, hivatalos
   dokumentáció, a repó kódja); ha a kérdés ezek után is valódi döntést
   igényel, NEM találgat — megáll, és a kérdést visszaküldi a vezetőnek.
4. **Minden elkészült munka visszamegy a vezetőnek ellenőrzésre**: strukturált
   beszámoló (mit csinált, fájllista, hogyan ellenőrizte, nyitott kérdések).
   A vezető maga is ellenőriz (tesztfuttatás, diff-átnézés, ahol lehet,
   empirikus/böngészős próba). KÉSZNEK jelenteni csak a vezető jóváhagyása
   után szabad bármit.
5. Semmi nem fogadható el pusztán azért, mert egy ügynök állítja — a mérés és
   a reprodukció többet ér a véleménynél.
6. **A vezető ORKESZTRÁTORKÉNT dolgozik: minden feladatot alaposan megtervez.**
   Nem kap ügynök munkát addig, amíg a terv nincs kész — mi a cél, milyen
   részfeladatokra bomlik, melyik ügynök melyiket kapja, mi a tiszta
   fájl-tulajdonlás (hogy ne írjanak egymásra, lásd a 16. üzemeltetési
   tanulságot), és mi az elfogadási feltétel. A Task-hívásokon a `model`
   mező **kötött**: vezető = `gpt-5.6-sol-xhigh` csak akkor, ha a szülő nem
   Sol (Cloud Agent szülőként a Sol xhigh a pickerben); a csapat minden
   tagja = `cursor-grok-4.6-xhigh`.
7. **MINDIG teljes körű ügynök-csapat indul, Grok 4.6 extra-high ügynökökből.**
   Nem egyetlen ügynök, hanem a feladathoz szabott csapat: felderítés,
   kutatás, megvalósítás, ellenőrzés — mindegyik a saját szakterületén. A
   csapat összetételét a vezető állítja össze a feladat természete szerint.
   (A párhuzamossági korlát ~2 egyidejű ügynök, a többi sorban áll — lásd a 17. üzemeltetési tanulságot; ez tervezési adat, nem elakadás.)
8. **Ismétlődő hibánál a vezető ÁTVESZI a feladatot.** Ha egy ügynök többször
   elbukik ugyanazon, vagy a megoldás nem áll össze, a vezető nem indít újabb
   kört vaktában: maga oldja meg. A cél a működő eredmény, nem a delegálás
   fenntartása.
9. **Merge után a vezető (vagy az ügynök) figyeli a CI-t és a Railwayt, és
   hibánál azonnal javít.** A squash-merge, a zöld PR és a „SUCCESS" deploy
   önmagában nem kész. GitHub: `ci.yml` + gitleaks a `main` squash-commitján.
   Railway: tényleges `npm run build`, migráció a start-logban, `GET /admin`.
   Piros, skipped-build vagy elmaradt healthcheck → azonnali fix, nem jelentés
   és várakozás. (Tulajdonosi kérés, 2026-08-20.)
