# Kineticare — kézrehabilitációs online kurzusplatform

Next.js 16 (App Router, server-component-first) + Payload CMS 3 (PostgreSQL) +
Barion Smart Gateway (kártyás fizetés) + Számlázz.hu Számla Agent (számlázás) +
Bunny Stream (kurzusvideók, tokenes embed) + PostHog (termék-analitika).

**Állapot.** A fizetési lánc (Barion-callback-vezérelt állapotgép + utánpollozó
job), a számlázás (Számlázz.hu) és a videó-kiszolgálás (Bunny Stream, tokenes
embed) implementálva és tesztelve. A kezdőlap CMS-ből szerkeszthető
szekció-rendszeren fut (`docs/szekcio-rendszer-terv.md`).
Ami hátra van: `docs/feladatlista.md`.

## Fejlesztői gyorsindítás

**Node 24 kell** (Active LTS). A repóban van `.nvmrc`, tehát `nvm use` / `fnm use`
beállítja. Más majoron az `npm install` csak `EBADENGINE` figyelmeztetést ad és
lefut, de az éles futásidő Node 24 — ne azon fejlessz.

```bash
nvm use                  # vagy: fnm use — a .nvmrc szerint Node 24
cp .env.example .env     # töltsd ki a kötelező értékeket (lásd a fájlt)
npm install
npm run dev              # http://localhost:3000 (admin: /admin)
npm run seed             # induló tartalom + a kezdőlap szekciósora (idempotens)
```

A `seed` többször futtatva sem duplikál, és a kezdőlap MEGLÉVŐ szekciósorát
sosem írja felül — az már szerkesztői munka.

Kapuk (minden változás előtt/után — a CI is ezt futtatja):

```bash
npm run typecheck        # tsc --noEmit
npm run test             # vitest run
npm run lint             # eslint
npm run build            # next build
```

Környezeti változók: `.env.example` (a titkok SOHA nem kerülnek a repóba;
`.env` gitignore-olt, staging/prod: Railway-változók).

Seed (`npm run seed`): üres fejlesztői adatbázisra teljes demó-tartalmat tölt.
`SEED_SCOPE=kezdolap npm run seed` — szűkített, élesben is futtatható hatókör:
kizárólag a kezdőlap szekciósorát és a landing tartalmi képeit tölti be
(idempotens; meglévő szekciósort sosem ír felül; demó-tartalmat nem hoz létre).

## Dokumentáció (docs/)

| Terület | Fájl |
|---|---|
| **Feladatlista (mi van hátra)** | **`docs/feladatlista.md`** |
| Kezdőlap szekció-rendszer | `docs/szekcio-rendszer-terv.md` |
| Értékesítési UX-skill (UI-munka előtt kötelező) | `docs/ertekesitesi-ux-skill.md` |
| Szerkesztői útmutató (az adminhoz) | `docs/szerkesztoi-utmutato.md` |
| Megrendelői igények | `docs/megrendeloi-igeny-specifikacio.txt`, `docs/igeny-valtozas-pontok.md` |
| W3-indítási specifikáció | `docs/w3-inditas-specifikacio.md` |
| Deploy (Railway) | `docs/deploy-railway.md` + `railway.json` |
| Adatbázis-mentés és visszaállítás | `docs/adatbazis-mentes.md` (`npm run backup:db`) |
| Barion sandbox | `docs/barion-sandbox-setup.md` |
| E2E-futtatás | `docs/e2e-staging-runbook.md` |
| UX-hierarchia-audit | `docs/ux-hierarchia-audit.md` |
| OWASP biztonsági audit | `docs/owasp-security-review.md` |
| Statisztika/Bunny review (2026-08-21) | `docs/review-2026-08-21-statisztika-bunny.md` |
| Kritikus utak review (2026-08-22) | `docs/review-2026-08-22-kritikus-utak.md` |
| **Piaci stratégia és végrehajtási terv** | `docs/piaci-strategia.md` |
| Tudástár-cikkek betöltése | `docs/tudastar-cikkek-betoltese.md` |
| Kulcsszó-célzás (mért) | `docs/kulcsszavak.md` |
| Kampányterv mért adatokból | `docs/kampanyterv-mert-adatokbol.md` |
| Vevőhang és hirdetésszöveg | `docs/vevohang-es-hirdetesszoveg.md` |
| Monid-kutatás (terv + 2. kör) | `docs/monid-kampany-kutatas.md`, `docs/monid-masodik-kor.md` |
| PostHog | `docs/posthog.md` |
| SEO / GEO / LLM-optimalizálás | `docs/seo-geo-llm.md` |
| Hero-videó feltöltés | `docs/hero-video-feltoltes.md` |
| Legacy-forrás | `docs/legacy/` |

## Szabályok (CLAUDE.md — a teljes lista ott)

- Titok sosem kerül a repóba (még placeholder-ként sem; tesztekben kifejezetten
  jelölt DUMMY érték szabad).
- A `confirmOrder` (ecommerce-plugin beta) hívása/importja/re-exportja TILOS —
  a `paid` átmenet kizárólag a Barion-callback-útvonal joga (v4-verifikáció).
- Manuális migráció-írás tilos — a séma-változás generált migrációval megy.
- Access-control (jogosultsági) módosítás csak emberi jóváhagyással.
- A `@payloadcms/*` verziók exact-pinnelve (3.88.0) — frissítés csak changelog
  + staging-E2E után.

## Fizetési és számlázási lánc (röviden)

- Checkout: `POST /api/checkout/start` → Barion Payment/Start v2 (Immediate,
  HUF, hu-HU), redirect a Barionra.
- Callback: `POST /api/barion/callback` → azonnali 200 + dedup, a jóváhagyás
  KIZÁRÓLAG szerver-szerver `GetPaymentState v4`-gyel (a callback-payload nem
  bizonyíték), idempotens státuszgép, retry-ladder.
- Elveszett callback-mentés: az `order-poll` job 5 percenként utánpollol
  (v4), árva-rendelés-lejárat, számla-resweep.
- Számlázás: `paid` átmenet után Számlázz.hu Számla Agent (invoice-issue job,
  szamlaKulsoAzon = rendelésszám — idempotens).
- Analitika: PostHog (EU-cloud, /ingest elsőfél-proxy, consent-first),
  funnel: course_viewed → checkout_started → purchase_confirmed.

## Deploy

Railway (staging + prod), a konfig a `railway.json`-ban; a lépések a
`docs/deploy-railway.md` runbookban. A CI-workflow-k (typecheck/vitest/lint/
build + gitleaks + npm audit) a `.github/workflows/` alatt élnek.

> **A `buildCommand` explicit megadása kötelező.** Nélküle a Railway builder
> „nothing to build" döntéssel **kihagyja a buildet**, lehúzza az új commitot,
> de a **korábbi `.next/` mappát** indítja el — a deploy zölden „SUCCESS"-t
> mutat, miközben hetekkel régebbi kód fut. A hibát csak a build-log
> `─ Build · skipped (nothing to build)` sora árulja el. A `healthcheckPath`
> szintén be van állítva, hogy egy induláskor halott build ne mehessen élesbe.
>
> **Figyelem:** a szolgáltatás dashboardon beállított értékei **felülírják** ezt
> a fájlt. Ha itt módosítasz valamit, ellenőrizd a service-beállításban is
> (`build.builder`, `buildCommand`, `healthcheckPath`), különben a fájl csak
> dokumentáció marad.

### Feltöltött képek (Volume — kötelező élesben)

A Payload a képeket a konténer lemezére írja, amit a Railway **minden deploynál
üresen ad vissza** — kötet nélkül az összes feltöltött kép elveszik (a DB-rekord
marad, a fájl eltűnik, a `/api/media/file/...` HTTP 500-at ad). Ezért élesben
kötelező egy **Railway Volume**, `/app/media` mountponttal, és a
`PAYLOAD_MEDIA_DIR=/app/media` környezeti változó, ami a Payload feltöltési
könyvtárát oda irányítja. A változó nélkül a mai (fejlesztői) alapértelmezés
marad: `<munkakönyvtár>/media`.

Öv és nadrágtartó: induláskor (onInit és `SEED_SCOPE=kezdolap npm run seed`) az
`ensureMediaFiles` (`src/lib/media-restore.ts`) **fájl-szinten** ellenőrzi minden
média-rekord fájljait, és a hiányzókat a repóban élő forrásokból (landing-tükör +
legacy archívum) visszatölti — a rekord **id-jének megőrzésével**, hogy a rá
mutató relációk (kezdőlap-szekciók, oldalak, termékek) ne szakadjanak el. Amihez
nincs repó-forrás (a lányok saját feltöltése), azt nem lehet pótolni: a modul
ezeket megszámolja és figyelmeztetésként naplózza. Későbbi lépés a Cloudflare R2
storage-adapterre váltás (`src/collections/Media.ts` fejkommentje).
