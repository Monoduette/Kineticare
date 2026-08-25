# Kineticare — teljes feladatlista

**Utolsó frissítés:** 2026-08-22, a 5. szakasz maradék döntései (J2 session).

## 2026-08-22 kritikus utak — a #148-ban lezárva

A teljes indoklás: `docs/review-2026-08-22-kritikus-utak.md` (vizsgálat: #142,
javítás: #143 ⊂ #144 ⊂ #148). A 26 tétel **nem tűnt el**; a kód a `mainen`
van. A #146 a merge előtt nyitottként hozta volna vissza őket — ezért a
tábla itt a #148 utáni állapot.

| # | Súly | Tétel | Éles main | Hol |
| --- | --- | --- | --- | --- |
| K1 | CRITICAL | `users.purchases` RMW, vevő-zár nélkül | kész | #148 (`withUserPurchasesLock`) |
| K2 | CRITICAL | igazolatlan e-mail + vendég-kötés | kész (szűk) | #148; nincs `auth.verify` / migráció |
| K3 | CRITICAL | ingyenes kurzus 7 napos reset-token bármely fiókra | kész | #148 |
| K4 | CRITICAL | helyesbítő kísérlet rendelés-szintű | kész (min) | #148 mindig `queryByKulsoAzon`; teljes térkép nincs |
| K5 | CRITICAL | staff PATCH a számla-állapotmezőkre | kész | #148 `denyFieldWrite` (zóna 4, tulajdonosi merge) |
| K6 | HIGH | `paid` ág `else` (fail-open) | kész | #148 |
| W1 | WARNING | poll-ablak beragadt `payment_pending` soron | kész | #148 |
| W2 | WARNING | bejelentkezve nem látja a vendég-pendinget | kész | #148 |
| W3 | WARNING | beágyazott zár + `pool.max` | szándékos nyitva | nincs cap; Railway `max_connections` × replika kellene |
| W4 | WARNING | vendég 409 idegen e-mailre (orákulum) | kész | #148; azonos 409, „már megvásároltad” csak belépve |
| W5 | WARNING | `storno-issue` job zsákutca | kész | #148 |
| W6 | WARNING | hiányzó `jobs.queue` néma `false` | kész | #148 |
| W7 | WARNING | számla-POST × refund, stornó nélkül | kész | #148 |
| W8 | WARNING | stream-token `Cache-Control` nélkül | kész | #148 |
| W9 | WARNING | grant e-mail nem kisbetűsít | kész | #148 |
| W10 | WARNING | lejárt hozzáférés = „Már hozzáfér” | kész | #148 |
| W11 | WARNING | preview `Location` Railway belső host | kész | #148 |
| W12 | WARNING | Barion callback rate-limit nélkül | kész | #148 |
| W13 | WARNING | `pending_repoll` kimerülés néma | kész | #148 |
| W14 | WARNING | vendég-aktiváló token 30 nap | kész | #148 (7 nap) |
| W15 | WARNING | logger nem redaktálja a token-kulcsokat | kész | #148 |
| W16 | WARNING | `purchases` közvetlen írás auditálatlan | kész | #148 |
| W17 | WARNING | failed-login hamisítható XFF | kész | #148 |
| W18 | WARNING | `/api/users/login` nincs kereten | kész | #148 |
| W19 | WARNING | mark-watched `userId` törzs nincs tesztelve | kész | #148 |
| W20 | WARNING | paid-not-allowed / cancel-not-allowed 0 teszt | kész | #148 |
| J2 | session | jelszócsere után a többi session élve maradt | kész | más eszközök kijelentkeznek; a cserét végző sid megmarad |

Hátra ebből a listából: **W3** (Railway `max_connections` × replika mérése).
A 5. szakasz többi eldöntendője lezárva (jegyzőkönyv 9.5): J2 session-visszavonás
igen; W5 job kézi újrasorbaállításra marad; K3 7 napos token csak új/pending
customer; `auth.verify` nincs; Linear-szinkron nincs.

## Állapot most (archív, 2026-08-09)

> **Archív pillanatkép (2026-08-09)** — az alábbi sorok a 2026-08-06-i
> hibakeresés állapotát rögzítik, történeti értékük van. A 2026-08-22-i
> P0 lyukak a fenti táblában és a jegyzőkönyv 9. szakaszában élnek, nem itt.

- main: `6560c7f`, CI zöld (typecheck 0, vitest 443/0, eslint 0 error, npm audit, gitleaks). *(2026-08-09-i pillanat)*
- **A Railway ténylegesen buildel.** Korábban `Build · skipped (nothing to build)`
  döntéssel kihagyta a build lépést, és a régi `.next/` mappát indította — a deploy
  „SUCCESS"-t mutatott, miközben hetekkel régebbi kód futott. Javítva: explicit
  `buildCommand` + `healthcheckPath: /admin` (lásd README „Deploy").
- **Az owner-fiók létrehozható és működik**: a `create-first-user` végigmegy
  (~1,6 mp), az első user `owner` szerepkört kap, és bejut az adminba.
- **Az adatbázis tartalma üres.** A hibakeresés során a Postgres-szolgáltatás
  újraindításakor `initdb` futott és a kötet üresen jött vissza; a séma a
  `payload migrate`-tel teljesen helyreállt (mind a 3 migráció), de tartalom
  nincs benne. Tartalom eddig sem volt — az adminba korábban nem lehetett belépni.

A lista 4 blokkra bomlik: **(A) azonnali, rajtad múló**, **(B) integrációk
(rajtad múló)**, **(C) fejlesztési backlog (CI véd)**, **(D) opcionális/későbbi**.

---

## A) Azonnali — ezek nélkül a staging „üres héj"

| # | Feladat | Hol | Megjegyzés |
|---|---|---|---|
| A1 | ~~Owner-fiók létrehozása~~ | `/admin` | **KÉSZ** (2026-08-06). |
| A2 | **Staff-fiókok**: Kocsis Kata, Kiss Kata | `/admin` → Users → Create New | A `role` mezőt **`staff`**-ra kell állítani — az alapértelmezés `customer`, azzal nem jutnak be az adminba. Jelszó: min. 12 karakter, kis+nagybetű + szám, az e-mail-címük ne legyen benne (a politika a 2. usertől él). |
| A3 | **Kurzusok feltöltése** (products): cím, rövid leírás, ár (`priceInHUFEnabled` + `priceInHUF`), sku, videó (később) | `/admin` → Products | A kezdőlap kurzuskártyái innen jönnek (`getPublishedProducts`). |
| A4 | **Kezdőlap-tartalom** (hero-szöveg, Rólunk-blokk, GYIK) | `/admin` → Pages (`kezdolap`) | A hero és a hitel-csík a CMS-mezőkből jön. |
| A5 | **„Hogyan működik" + GYIK tartalom** | `/admin` → Pages | Most statikus — a Katák döntik el, CMS-be kerüljön-e. |
| A6 | **Menüfa** (felső navigáció) | `/admin` → Menus | |
| A7 | **Posztok** (tudástár/blog) | `/admin` → Posts | A `/blog` oldal innen jön. |
| A8 | **Valódi testimonialok** a Katáktól | Katák → `/admin` → Pages | Fogyasztóvédelmi okból fiktív nem kerülhet ki — az M5-szekció szándékosan hiányzik, amíg nincs valódi idézet. |

---

## B) Integrációk — a valódi fizetés / számla / mérés éléséhez

| # | Feladat | Env-változó | Hol szerzed | Megjegyzés |
|---|---|---|---|---|
| B1 | **Barion sandbox** → valódi POSKey + payee | `BARION_POSKEY_TEST`, `BARION_PAYEE_EMAIL` | test.barion.com | Most álértékek — a fizetés nem indul el. Tesztkártyák: Successful `4444 8888 8888 5559`, ProblemWithCard `…4446`, LowFunds `…9999`, LostOrStolen `…1111`. |
| B2 | **Számlázz.hu** tesztkulcs | `SZAMLAZZ_AGENT_KEY` | szamlazz.hu (Számla Agent tesztfiók) | A számla- és stornó-jobok csak ezzel élnek. `valaszVerzio=2`, `szamlaKulsoAzon=orderNumber` idempotencia-horgony kész. |
| B3 | **PostHog** EU projekt-kulcs | `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` (EU: `https://eu.i.posthog.com`) | posthog.com (EU projekt) | A consent-banner és a funnel (`course_viewed` → `checkout_started` → `purchase_confirmed`) **kód szinten kész** — csak a kulcs hiányzik. Részletek: `docs/posthog.md`. |
| B4 | **Hero-videó** Bunny Stream (publikus library) | `HERO_VIDEO_STREAM_ID` (kódban), `NEXT_PUBLIC_BUNNY_STREAM_PUBLIC_LIBRARY_ID`, `NEXT_PUBLIC_BUNNY_STREAM_PULL_ZONE_HOST` | Bunny Stream | A `HeroVideo` komponens kész (poster-first, reduced-motion, publikus iframe). Ma a hero a CMS heroImage-re esik vissza. Útmutató: `docs/hero-video-feltoltes.md`. |
| B5 | **Adatvédelem oldal** a CMS-ben | — | `/admin` → Pages (`adatvedelem`) | A consent-banner ide linkel, jelenleg 404. A legacy forrásfájl (`adatvedelem.html`) a repóból kikerült — a `docs/legacy/` alatt csak a `typ-kezrehab.html` maradt; a szöveget a Katáknak kell pótolni/jóváhagyni. |
| B6 | **E-mail (SMTP)** rendszer-levelekhez | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | SMTP-szolgáltató | A `src/lib/email/smtp.ts` STARTTLS-t kér (OWASP-fix). Az order-confirmation és a reset-password e-mail csak ezzel él. |
| B7 | **Claude GitHub App + `ANTHROPIC_API_KEY`** | GitHub repo secret | github.com/apps/claude + anthropic.com | A `@claude` megemlítés issue/PR-kommentben. A `ci.yml` és `gitleaks.yml` enélkül is fut. |
| B8 | **Google Search Console** bekötés | `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` (opcionális HTML-meta) | search.google.com/search-console | A kódoldali meta-kapu kész (üres env = nincs címke). 2026-08-25: a Domain-property már gyűjt impressiont a `kineticare.hu`-ra. DNS-cutover után sitemap: `/sitemap.xml`. HTML-tokent ne találj ki — a GSC adja, Railway-re, újrabuilddel. Runbook: `docs/kineticare-hu-atallas.md`. |
| B9 | **Google Analytics (GA4)** bekötés | `NEXT_PUBLIC_GA_MEASUREMENT_ID` | analytics.google.com | **A kódoldali fele KÉSZ** (C12, 2026-08-09): a GA a consent-állapotgépre kötve, csak `granted` után tölt be. Már csak a mérési azonosító beszerzése és Railway-beállítása kell — NEXT_PUBLIC, tehát beállítás után **újrabuild kötelező** (a CSP is ekkor nyílik meg). Részletek: `docs/ga4.md`. |
| B10 | **Linear** bekötés | — | linear.app | **Eldöntve (2026-08-22):** nincs GitHub↔Linear szinkron. A `feat/<ticket-id>-…` ágnév elég. Külön szinkron új üzemeltetési felület, a fizetéshez nem kell. |

> **Titkok:** egyetlen kulcs sem kerülhet a repóba — sem kódba, sem konfigba, sem
> kommentbe, sem tesztfixtúrába (CLAUDE.md TILOS ZÓNÁK 1.). A Railway
> szolgáltatás-változói közé kell felvenni őket; a repóban legfeljebb az
> `.env.example` bővül a kulcs nevével, **érték nélkül**.

---

## C) Fejlesztési backlog — CI véd, a main zöld marad

| # | Feladat | Prioritás | Megjegyzés |
|---|---|---|---|
| ~~C1~~ | ~~Reset-password szerveroldali jelszópolitika~~ | — | **KÉSZ** (2026-08-09): saját route-handler árnyékolja a `POST /api/users/reset-password` útvonalat (rate-limit + `validatePasswordStrength` + delegálás a Payloadnak), a politika REST-hívással sem kerülhető meg. Részletek: `docs/jelszo-politika.md`. |
| C2 | **`@payloadcms/*` kormányzott bump** | Közepes | A 3.86.0 peer-tartománya már beengedi a next@16.x-et (`>=16.2.6 <17.0.0`); a `legacy-peer-deps` a régebbi felbontású lockfile miatt marad, amíg a tiszta-registrys lockfile-újragenerálás külön, emberi döntésű PR-ben meg nem történik. A tranzitív sebezhetőségek miatt a CI audit-kapu `critical`-szintű. |
| ~~C3~~ | ~~products `displayTitle` + `slug` mező~~ (SEO) | — | **KÉSZ** (2026-08-09): `displayTitle` + egyedi `slug` mező, kanonikus `/kurzusok/{slug}` URL tartós átirányítással a régi id-s címről; minden hivatkozás a közös `courseHref()`-re állt át. Üzemeltetés: a meglévő kurzusok slugja az adminban mentéskor áll elő (addig az id-s URL él). |
| ~~C4~~ | ~~stornó-státusz mezők + retry-job~~ | — | **KÉSZ** (2026-08-09): `stornoStatus`/`stornoNumber`/`stornoAttempts`/`stornoLastError` a rendelésen, `storno-issue` retry-job az order-maintenance queue-n, MAX 5 kísérlet. Részletek: `docs/szamlazz-storno.md`. |
| ~~C5~~ | ~~Helyesbítő számla részrefundhoz~~ | — | **KÉSZ** (2026-08-09): részrefundnál helyesbítő számla (`helyesbitoszamla` + `helyesbitettSzamlaszam`, negatív korrekciós tétel), `correctiveInvoiceStatus/Number/Seq` mezők + `corrective-invoice-issue` job, kétrétegű idempotenciával. Élesítés előtt egy sandbox-os végigfuttatás ajánlott. |
| C6 | **Consent-flow E2E** | Alacsony | **A harness KÉSZ** (2026-08-15): `scripts/e2e/consent-e2e.mjs` — helyben lefuttatva 46 PASS / 0 FAIL (banner, elutasítás → 0 méréskérés 3 oldalon át, perzisztencia, visszavonási kör, billentyűzet). Futtatás: `docs/consent-e2e.md`. HÁTRA VAN: staging-futás valódi PostHog-kulccsal (`E2E_EXPECT_ANALYTICS=1`) és GA4-azonosítóval. Ismert UX-adósság: a bannerhez 32 Tab kell (fókusz-sorrend), és a fix sáv takarja a lábléc alját. |
| ~~C7~~ | ~~PostHogProvider init→enable finomítás~~ | — | **KÉSZ** (2026-08-09, ellenőrzéssel zárva): a `PostHogProvider` már `enableAnalyticsCapture()`-t hív granted consentre, az pedig inicializált kliensnél `opt_in_capturing()`-ot — az opt-out perzisztencia rendben, kódváltozás nem kellett. |
| ~~C8~~ | ~~**Meglévő-vevő migráció (T-061)**~~ | — | **KÉSZ** (2026-08-15, empirikus ellenőrzéssel zárva): a tömeges CSV-import él — `src/scripts/import-customers.ts` (`npm run import:customers`) + `src/lib/customer-import/` (parse / plan / execute / invite / send-invites), 87 unit-teszt. Ellenőrizve izolált Payload+Postgres ellen: magyar-Excel CSV (BOM, `;`, CRLF, idézőjeles mező), próbafutás = 0 írás, éles futás után a `purchases` helyes, a MÁSODIK futás 0 írás (idempotens), az új fiók `customer` szerepkört kap, a napló maszkolt címet ír, jelszó sehol. Üzemeltetés: `docs/vasarlo-migracio-terv.md`. |
| ~~C9~~ | ~~**Newsletter** (footer-feliratkozás)~~ | — | **KÉSZ** (2026-08-15, böngészős ellenőrzéssel zárva): lábléc-blokk minden oldalon (email + kötelező GDPR-checkbox + /adatvedelem link), a form-builder „Hírlevél" űrlapjára küld (adat, nem séma — nincs migráció). A form-submissions hook űrlap-CÍM alapján választ szerződést (szerver-oldalon, a kliens nem választhat lazábbat), feliratkozásnál staff-értesítő nem megy ki. Az űrlap seedből ÉS onInitből is létrejön (idempotens, best-effort). Spam-védelem a kapcsolat-űrlap mintájára, rate-limit: közös form-submission keret (5/10 perc/IP). NINCS (dokumentáltan): double opt-in, leiratkozó-link, Resend-szinkron — `docs/hirlevel.md`. |
| C10 | **Dependabot-kör figyelése** | Alacsony | A korábbi vitest security-update failure a placeholder-lockfile miatt volt; a következő Dependabot-PR megmutatja, rendbe jött-e. |
| ~~C11~~ | ~~`sitemap.xml` + `robots.txt`~~ | — | **KÉSZ** (2026-08-06): `src/app/robots.ts` + `src/app/sitemap.ts`. A robots az AI-crawlereket kifejezetten engedi. Részletek: `docs/seo-geo-llm.md`. |
| ~~C12~~ | ~~GA4 bekötése a consent-állapotgépre~~ | — | **KÉSZ** (2026-08-09): a gtag.js kizárólag `granted` consent után töltődik be (Consent Mode: default denied → update granted), revoke a `ga-disable-<ID>` kapcsolóval; a CSP csak érvényes azonosító mellett nyitja meg a Google-hostokat. Már csak a B9 (mérési azonosító beszerzése + újrabuild) van hátra. Részletek: `docs/ga4.md`. |

### Üzemeltetési tételek (2026-08-06-i hibakeresésből)

| # | Feladat | Prioritás | Megjegyzés |
|---|---|---|---|
| ~~C13~~ | ~~`idle_in_transaction_session_timeout` a Postgresen~~ | — | **KÉSZ** (2026-08-09, app-oldalon): a pg pool minden kapcsolata 60 mp-es `idle_in_transaction_session_timeout` startup-paramétert kap (`src/payload.config.ts`) — az app, a migrate és a seed fedve. Maradék rés: külső session (kézi `psql`, Railway-konzol) zárját ez nem oldja; teljes lefedettséghez DB-oldali beállítás kellene (infra-döntés). |
| C14 | **Adatbázis-mentés** | HIGH (élesítés előtt) | **Az eszköz KÉSZ** (2026-08-15): `npm run backup:db` (pg_dump -Fc + kötelező `pg_restore --list` integritás-ellenőrzés + retenció) és napi ütemezett `db-backup.yml` workflow (artifact, 30 nap). Visszaállítási próbával igazolva helyi Postgresen (users/products/course_progress sorszámok egyeznek). **ÉLESÍTÉSHEZ EMBERI LÉPÉS KELL:** a `DATABASE_URI` repo-secret felvétele (a Railway `DATABASE_PUBLIC_URL` értékével) — addig a workflow zölden, üzenettel kimarad. Ajánlott mellé a Railway-natív kötet-mentés és a PITR bekapcsolása is. **2026-08-15, infrastruktúra:** kiderült, hogy a régi `Postgres` szolgáltatásnak NEM VOLT kötete (az adat a konténer múlandó lemezén élt) — az éles adatbázis átköltözött a kötetes `Postgres-c8Rg` szolgáltatásba (`postgres-ssl:18`), sorszám-egyeztetéssel igazolva; a régi szolgáltatás fagyasztott tartalék. A workflow `PG_IMAGE`-e ezért `postgres:18-alpine`. Részletek: `docs/adatbazis-mentes.md`. |

### SEO / GEO / LLM-optimalizálás

A **technikai réteg kész** (C11: robots + sitemap, valamint FAQPage / Course /
BreadcrumbList strukturált adat). Ami hátravan, az nagyrészt tartalmi munka —
a teljes checklist: `docs/seo-geo-llm.md`.

| # | Feladat | Prioritás | Megjegyzés |
|---|---|---|---|
| C15 | **Tartalmi átvezetés minden cikken és oldalon** | Közepes (folyamatos) | Kérdés-alapú alcímek, közvetlen válasz az alcím alatt, forrásmegjelölt adat, E-E-A-T szerzői bio, CEP-alapú (helyzet-, nem téma-) címek. A Katák szakmai munkája. `docs/seo-geo-llm.md` 2. fejezet. |
| C16 | **Prompt-portfólió + baseline-mérés** | Közepes | 25 prompt 4 típusban (bevétel / reputáció / versenytárs / rés), havi rögzítés. `docs/seo-geo-llm.md` 3. fejezet. |
| C17 | **Bot-védelem ellenőrzése élesítés után** | Közepes | A `robots.txt` hiába enged, ha a Cloudflare/WAF blokkolja az AI-crawlereket. Külön réteg, külön ellenőrzés. |
| ~~C18~~ | ~~Kurzus-felület: fejezetekre bontott tananyag, új lejátszó, admin haladás-nézet~~ | — | **KÉSZ** (2026-08-15): `products.modules` (modulok → leckék; videó / szöveges lecke / külső link, mellékletekkel) a régi `videos` lista MELLETT, nem destruktív migrációval — meglévő kurzus és haladás érintetlen. Új kétpaneles lejátszó (modul-akkordeon W3C APG szerint, sticky fejléc haladás-sávval, állapotfüggő akciósáv, mobil tananyag-fiók), állapot-kártyás Kurzusaim lista folytatás-gombbal, admin haladás-panel (ki kezdte el / ki nem / hány %, leckénkénti lemorzsolódás), automatikus nézettség-alapú jelölés (90%-os küszöb, saját player.js-kliens — a CSP nem engedi a Bunny scriptjét), és tanulási funnel (`course_started` → `lesson_completed` → `module_completed` → `course_completed`). Szerkesztői leírás: `docs/szerkesztoi-utmutato.md` 12. pont. **Üzemeltetés:** a régi videólistát fejezetekre bontani KIZÁRÓLAG az `npm run kurzus:videok-modulba` paranccsal szabad — kézi újrafelvitelnél minden vásárló haladása némán nullázódna. |

---

## D) Opcionális / későbbi

- **Többnyelvűség** (a Katák döntése — a szövegek most magyarul vannak).
- **Kupon / rendszer-kedvezmény** (a `plugin-ecommerce` támogatja).
- **Havi díjas tagság** (`plugin-ecommerce` subscriptions).
- **Mobilapp** (a webapp PWA-sítható).

---

## A leggyorsabb út a „teljesen élő" staginghez

1. **A2** (staff-fiókok) → **A3–A7** (tartalom) — enélkül a staging üres héj.
2. **B1** (Barion POSKey) → E2E a teljes vásárlási tölcséren, tesztkártyákkal
   (`docs/e2e-staging-runbook.md`).
3. **B2** (Számlázz.hu) → számla-kiállítás a tesztvásárlásnál.
4. **C14** (mentés) — élesítés előtt kötelező.
5. A kód-oldali, priorizált hátralék az `docs/atadas-szamlazz-kor.md` 3. szakaszában él
   (G1–G4 CI-őrök, checkout-draft, Rendelések-lista tételei stb.).
