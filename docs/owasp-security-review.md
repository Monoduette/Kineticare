# OWASP Top 10 biztonsági kódvizsgálat — Kineticare

## Összefoglaló
- **Hatókör:** a teljes repó (src/), hangsúly: fizetési lánc (checkout/callback/refund), auth/RBAC, stream-token (JWT), webhook-idempotencia, Számlázz.hu, SMTP, PostHog/analitika, kapcsolat-űrlap, dependency-gráf (npm audit, hivatalos registry).
- **Dátum:** 2026-08-04
- **Kockázati összesítés:** 🔴 RED 3 | 🟡 YELLOW 5 | 🟢 GREEN 4 | ✅ PASS (megállapítás nélküli kategória) 3

> **Történeti, nem operatív jelentés.** A történeti parancsblokkok nem operatívak,
> és az auditkori állapotot őrzik. A jelenlegi támogatott bootstrap parancs
> `node scripts/install-reviewed-dependencies.mjs`; a repó helyi CLI-jait, például
> `./node_modules/.bin/payload`, közvetlenül kell futtatni.

> Módszer: a `secure-code-review` checklist (OWASP 2021) szerint, „inkább téves pozitív, mint elmaradt valódi". Minden találathoz fájl:sor és használatra-kész javítókód tartozik. Az A01/A02/A10 kategóriákban NINCS kritikus megállapítás (PASS) — a legerősebb pontok a végén, a prioritás a jelentés alján.

---

## Találatok (súlyosság csökkenő sorrendben)

### 🔴 RED A06 — `next@15.4.11`: 20+ ismert sérülékenység, köztük HIGH-súlyúak
- **Hely:** `package.json:24` (`"next": "15.4.11"`)
- **Leírás:** az npm audit (hivatalos registry) szerint a 15.4.11-es Next.js-t érinti több HIGH-súlyú advisory is: DoS a Server Componentsben (GHSA-q4gf-8mx6-v5v3, GHSA-8h8q-6873-q5fj), Middleware/Proxy-bypass az App Routerban (GHSA-267c-6grr-h53f, GHSA-26hh-7cqf-hhc6, GHSA-492v-c6pp-mqqv), SSRF Server Actionökben és **SSRF rewrites-ben** (GHSA-p9j2-gv94-2wf4, GHSA-89xv-2m56-2m9x), valamint „HTTP request smuggling in rewrites" (GHSA-ggv3-7p47-pfv8) — a PostHog `/ingest`-proxy bekötése miatt a rewrites-osztály kifejezetten releváns.
- **Hatás:** önmagát hostoló Next.js-ként (Railway) DoS és proxy-működés elleni támadási felület; a rewrites-osztály a frissen bevezetett `/ingest`-proxy miatt a mi felületünkön is érintett.
- **Javítás:** Next.js-frissítés a javított sorra (a `fixAvailable` a 15.5.x ágat jelöli), a standard kapuval (typecheck + vitest + build + staging E2E). A `@payloadcms/*` exact-pin-szabály a `next`-re NEM vonatkozik (a 3.86.0-s Payload peer-támogatja), de a frissítés ugyanúgy kapu-köteles:
  ```jsonc
  // package.json
  {
    "dependencies": {
      "next": "15.5.22", // 15.4.11 helyett — a GHSA-sorozat javított ága
    }
  }
  ```
  Utána: `npm install && npx tsc --noEmit && npx vitest run && npm run build`, majd staging-E2E.

### 🔴 RED A07/A04 — Nincs bejelentkezési zárolás (korlátlan brute-force)
- **Hely:** `src/collections/Users.ts:10-13` (`auth: true`, zárolási opciók nélkül)
- **Leírás:** a `/api/users/login` végponton nincs kísérlet-korlát és zárolási idő — a jelszavas bejelentkezés korlátlanul próbálkozható (brute-force / credential-stuffing). A kliensoldali hibaüzenet („Hibás e-mail-cím vagy jelszó.") már nem árul el semmit, de a sebesség-korlát hiányzik.
- **Hatás:** jelszó-brute-force az ügyfél-fiókokon; a vásárlási adatok/számlázási címek kiszivárgása esetén súlyos GDPR-implikáció.
- **Javítás:** Payload auth lockout + minimális jelszóhossz a Users collectionben:
  ```ts
  // src/collections/Users.ts
  export const Users: CollectionConfig = {
    slug: 'users',
    admin: { useAsTitle: 'email' },
    auth: {
      maxLoginAttempts: 5,        // 5 sikertelen kísérlet után…
      lockTime: 600_000,          // …10 perces zárolás (ezredmásodperc)
      passwordMinLength: 12,      // a kliens üzenete is ezt ígéri („min. 12 karakter")
      tokenExpiration: 7_200_000, // forgot-password token: 2 óra (explicit)
    },
    access: { /* változatlan */ },
    fields: [ /* változatlan */ ],
    hooks: { /* változatlan */ },
  }
  ```
  Megjegyzés: a `passwordMinLength` Payload 3-alapú opció — a typecheck a zárolt kapu azonnal jelzi, ha a pinned verzióban eltér a mezőnév; a CI (ci.yml feltöltése után) ezt véglegesen lefuttatja.

### 🔴 RED A05 — SMTP: ha nincs STARTTLS-hirdetés, a hitelesítés TITKOSÍTATLANUL megy
- **Hely:** `src/lib/email/smtp.ts:174-178` (a `send()` metódus STARTTLS-ága)
- **Leírás:** a session csak akkor upgrade-el TLS-re, ha a szerver HIRDETI a STARTTLS-t (`if (config.port !== 465 && supportsStartTls)`). Ha a 587/25-ös szerver nem hirdeti, a kód TLS nélkül folytat, és az `AUTH LOGIN` (base64 kódolt felhasználónév/jelszó) NYÍLT csatornán megy ki.
- **Hatás:** SMTP-hitelesítő adatok lehallgathatók a hálózati útvonalon.
- **Javítás:** STARTTLS kötelezővé tétele (titkosítatlan hitelesítés soha):
  ```ts
  // src/lib/email/smtp.ts — a send() metódusban
  const ehloLines = await this.command(`EHLO ${config.host}`, [250])
  const supportsStartTls = ehloLines.some((line) => /STARTTLS/i.test(line))
  if (config.port !== 465) {
    if (!supportsStartTls) {
      throw new EmailSendError(
        'Az SMTP-szerver nem hirdet STARTTLS-t, implicit TLS (465) pedig nincs beállítva — ' +
          'a hitelesítés titkosítatlan csatornán NEM küldhető. Állíts be TLS-támogatást a szerveren, ' +
          'használd a 465-ös implicit TLS-portot, vagy válts Resend-providerre.',
        false,
      )
    }
    await this.command('STARTTLS', [220])
    await upgradeToTls()
    await this.command(`EHLO ${config.host}`, [250])
  }
  ```

### 🟡 YELLOW A03 — `dangerouslySetInnerHTML` `</script>`-breakout a JSON-LD-ben
- **Hely:** `src/components/content/JsonLd.tsx:7-8`
- **Leírás:** a komponens `JSON.stringify(data)`-t injektál `dangerouslySetInnerHTML`-be. A `JSON.stringify` NEM escape-eli a `</script>` sorozatot — ha a CMS-ből jövő cím/leírás `</script><script>…</script>`-t tartalmaz, a böngésző a szkriptet végrehajtja.
- **Hatás:** tárolt XSS a staff által szerkesztett tartalomból (a védekezés rétege hiányzik; a szerző kör korlátozott, de a minta veszélyes).
- **Javítás:** a szokásos `<`→`\u003c` escape a JSON-LD szerializálásakor:
  ```tsx
  // src/components/content/JsonLd.tsx
  export function JsonLd({ data }: { data: Record<string, unknown> }) {
    const safeJson = JSON.stringify(data).replace(/</g, '\\u003c')
    return (
      <script
        type="application/ld+json"
        // A \u003c escape miatt a JSON-LD sosem törhet ki a <script> kontextusból.
        dangerouslySetInnerHTML={{ __html: safeJson }}
      />
    )
  }
  ```

### 🟡 YELLOW A05 — Hiányzó biztonsági HTTP-fejlécek (CSP, X-Frame-Options, stb.)
- **Hely:** `next.config.ts:4-22` (nincs `headers()` beállítás)
- **Leírás:** a válaszokon nincs `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy` és Content-Security-Policy. A Stream-iframe (kurzus/előzetes/hero-videó), a Turnstile-widget és a PostHog miatt a CSP-t ezekkel a hostokkal kell felépíteni.
- **Hatás:** clickjacking, MIME-sniffing, réteg-hiány a kliensoldali védelemben.
- **Javítás:** `headers()` a next.config.ts-ben (a meglévő rewrites MELLÉ):
  ```ts
  // next.config.ts — a nextConfig-be (a rewrites után)
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' https://iframe.cloudflarestream.com https://challenges.cloudflare.com",
              "frame-src 'self' https://iframe.cloudflarestream.com https://customer-*.cloudflarestream.com https://www.youtube-nocookie.com https://player.vimeo.com https://challenges.cloudflare.com",
              "img-src 'self' data: https://videodelivery.net https://customer-*.cloudflarestream.com",
              "media-src 'self' https://videodelivery.net https://customer-*.cloudflarestream.com",
              "connect-src 'self'", // a PostHog a /ingest elsőfél-proxyn megy — külön host nem kell
              "style-src 'self' 'unsafe-inline'",
              "font-src 'self'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'self'",
            ].join('; '),
          },
        ],
      },
    ]
  },
  ```
  Megjegyzés: a CSP első stagingen Report-Only-ként is érdemes (`Content-Security-Policy-Report-Only`), a karcolás-mentes bevezetéshez.

  > ⚠️ **A fenti kódrészlet TÖRTÉNETI — ne másold vissza.** A benne szereplő
  > `https://customer-*.cloudflarestream.com` **érvénytelen CSP-forrás** (a joker
  > csak a legbaloldalibb, TELJES címke helyén állhat), a böngésző némán eldobja;
  > a `media-src`-ből pedig hiányzik a `blob:`, ami nélkül a kezdőlap filmsávja
  > nem indul el. A hatályos, javított és egységtesztelt politika:
  > **`src/lib/security/csp.ts`** — indoklás és böngészős bizonyíték:
  > [`docs/video-stream-keszenlet.md`](video-stream-keszenlet.md) 6. pont.

### 🟡 YELLOW A07 — A jelszó-minimumhossz csak a kliensben van állítva
- **Hely:** `src/lib/auth-client.ts:76` („…min. 12 karakter" üzenet) vs. `src/collections/Users.ts` (nincs szerveroldali szabály)
- **Leírás:** a regisztrációs hibaüzenet 12 karakteres minimumot ígér, de a Users collectionben nincs szerveroldali `passwordMinLength` — a kliens-üzenet és a tényleges szabály eltérhet. (A RED#2 javítókódja ezt egyben megoldja.)
- **Hatás:** gyenge jelszavak (a marketing-üzenet nem felel meg a rendszernek).
- **Javítás:** a RED#2 `auth.passwordMinLength: 12` — ha a pinned Payload nem ismeri az opciót, `beforeChange` jelszó-validációs hook (a CLAUDE.md access-szabály miatt emberi jóváhagyással).

### 🟡 YELLOW A06 — `vitest@3.2.4` (kritikus, CSAK dev/CI) + a `@payloadcms/*` 3.86.0-sor
- **Hely:** `package.json:39` (`"vitest": "3.2.4"`), `package.json:16-21` (`@payloadcms/*: 3.86.0`)
- **Leírás:** (a) a vitest <3.2.6 kritikus (GHSA-5xrq-8626-4rwp: a Vitest UI szerver tetszőleges fájlt olvashat/futtathat) — dev/CI-only, de a fejlesztői gépeket és a CI-t érinti. (b) a `@payloadcms/*` 3.86.0-sor az audit-gráfban ismétlődően „Depends on vulnerable versions of payload" (a payload-család moderate advisoryjei) — a pin-szabály miatt nem azonnali javítás.
- **Hatás:** (a) fejlesztői/CI-eszközök kompromittálódása build-időben; (b) a payload-család moderate felülete a következő verzióig nyitva.
- **Javítás:** (a) `"vitest": "3.2.6"` (vagy újabb — devDep, nincs pin-szabály): `npm install && npx vitest run`. (b) a `@payloadcms/*`-bump a hivatalos folyamat szerint: changelog-átnézés → `npm install` az új exact-pinre → staging-E2E (fizetés/callback/stream/admin) → csak utána merge. Rögzítendő a W5-backlogban.

### 🟡 YELLOW A04 — Az `order-poll` árva-lejárat 2 óra: későn befejeződő fizetés esetén `paid-not-allowed` riasztás
- **Hely:** `src/lib/order-poll/service.ts:55` (`ORPHAN_ORDER_GRACE_MS = 2 * 60 * 60 * 1000`)
- **Leírás:** a `barionPaymentId` nélküli rendelést 2 óra után `cancelled`-re állítja a poll-job. Ha a fizetés a 2 óra UTÁN fejeződik be, a callback a `paid-not-allowed` állapotgép-védelembe ütközik (pénz felvéve, kurzus nem, riasztás az admin felé).
- **Hatás:** manuális helyreállítás igénye a késői fizetési szélsőesetben (a riasztás megvan, az anyagi kockázat nincs, de a vevő-élmény rossz).
- **Javítás:** a lejárati türelem megnövelése a Barion PaymentWindow + banki késleltetésekre (24 óra), a riasztás megtartásával:
  ```ts
  // src/lib/order-poll/service.ts
  export const ORPHAN_ORDER_GRACE_MS = 24 * 60 * 60 * 1000 // 24 óra — a banki késleltetés is belefér
  ```

### 🟢 GREEN A03 — A YouTube-ID nincs URL-kódolva a Lexical videó-beágyazásban
- **Hely:** `src/components/lexical/serialize.tsx:116-158` (`detectVideoEmbed`)
- **Leírás:** a youtu.be/youtube.com ID-t nyersen illeszti az embedUrl-be (`embed/${id}`). Az iframe `src` React-escape-elve van, így XSS nincs, de a formailag nem tiszta ID-t (pl. query-vel) érdemes kódolni.
- **Hatás:** kozmetikai/higiéniai — nincs közvetlen exploit.
- **Javítás:**
  ```ts
  // serialize.tsx — a youtu.be és /watch ágakban:
  return { provider: 'youtube', embedUrl: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` }
  // (a vimeo ág \d+-ra szűkít — ott nincs teendő)
  ```

### 🟢 GREEN A09 — A sikertelen bejelentkezések nincsenek naplózva
- **Hely:** `src/collections/Users.ts:48-62` (csak `afterLogin` — siker esetén)
- **Leírás:** a sikeres belépés rögzül (lastLoginAt), de a sikertelen kísérletek nem kerülnek a naplóba — a RED#2 zárolás a MEGELŐZÉS, a detektálás (anomália-figyelés) hiányzik.
- **Hatás:** a brute-force kísérletek láthatatlanok a monitoringnak.
- **Javítás:** `afterFailedLogin` hook (ha a pinned Payload támogatja — a typecheck jelzi):
  ```ts
  // src/collections/Users.ts hooks
  hooks: {
    afterLogin: [ /* meglévő */ ],
    afterFailedLogin: [
      async ({ req, user }) => {
        req.payload.logger.warn('sikertelen bejelentkezési kísérlet', {
          email: typeof user === 'object' && user !== null && 'email' in user ? (user as { email?: string }).email : null,
          ip: req.headers?.get?.('x-forwarded-for') ?? null,
        })
      },
    ],
  },
  ```

### ✅ LEZÁRVA A08 — Supply-chain: a CI-workflow-k és a lockfile hiánya
- **Eredeti találat:** a repóban nem volt `ci.yml`, `gitleaks.yml` és valódi `package-lock.json`, ezért a CI-kapuk (typecheck/vitest/lint/build) és a gitleaks nem futottak, a telepítés pedig nem volt reprodukálható (feloldás-alapú `npm install`). A B1–B7 regressziók ebből fakadtak.
- **Állapot:** **lezárva.** Mindhárom fájl a `main`-en van. A `package-lock.json` tiszta registryből készült — minden `resolved` URL a `registry.npmjs.org`-ra mutat (privát tükörre mutató URL a CI-runnerről elérhetetlen lenne).
- **A tényleges audit-job a `ci.yml`-ben** — ez a mérvadó, ne ezt a doksit másold:
  ```yaml
  audit:
    name: npm audit (high = bukás)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm
      - name: Függőségek telepítése
        run: npm ci --legacy-peer-deps
      - name: Sebezhetőség-riport (nem blokkol)
        run: npm audit || true
      - name: Sebezhetőség-audit (high és fölötte bukás)
        run: npm audit --audit-level=high
  ```
  Három eltérés a fenti eredeti javaslathoz képest, mindegyik szándékos:
  1. `--legacy-peer-deps` **kötelező** — de NEM peer-ütközés miatt (az megszűnt: a repó ma `next@16.3.3`-on áll, ami beleesik a `@payloadcms/*` 3.88.0 peer-tartományába). A repóban élő `package-lock.json` legacy-peer-deps módban készült, ezért nem tartalmazza a szigorú feloldás peer-csomagjait — flag nélkül az `npm ci` „not in sync" EUSAGE-hibával elhasal. A flag elhagyásához a lockfile-t külön, szigorú peer-feloldással validált dependency PR-ben kellene frissíteni.
  2. `--audit-level=high` a korábbi `critical` helyett: a kritikus küszöb négy HIGH sebezhetőséget zölden átengedett. A `moderate` tételek a nem blokkoló teljes riportban továbbra is látszanak.
  3. `checkout@v7` / `setup-node@v7`: a `@v4` runtime-ja `node20`, amit a GitHub 2026-09-16-án eltávolít a hosztolt runnerekről.

### 🟢 GREEN A10 — SSRF: nincs felhasználó-vezérelt kimenő kérés (PASS, jegyzettel)
- **Hely:** `src/lib/barion/client.ts`, `src/lib/szamlazz/client.ts`, `src/payload.config.ts` (Turnstile), `next.config.ts` (PostHog rewrites)
- **Leírás:** a szerveroldali kimenő hívások KIZÁRÓLAG konfigurált, `https`-validált hostokra mennek (Barion, Számlázz.hu, Turnstile siteverify, Cloudflare Stream, PostHog). Felhasználó által megadott URL-t a szerver nem tölt le. A `NEXT_PUBLIC_POSTHOG_HOST` env-szintű (admin vezérli, nem látogató).
- **PASS** — a GHSA-p9j2-gv94-2wf4 (SSRF rewrites-ben) a RED#1 Next.js-frissítéssel zárul; a mi rewrite-céljaink statikusak.

---

## PASS — megállapítás nélküli kategóriák

### ✅ A01 — Broken Access Control: NINCS kritikus megállapítás
Erős, rétegzett modell: a rendelés-státusz végpont a `customer: user.id` szűrővel és egységes 404-gyel (létezés-elfedés) dolgozik (`src/lib/checkout/order-status-handler.ts:31-44`); a stream-token a purchases-ellenőrzést a termék-lekérdezés ELŐTT végzi, egységes 403-mal (`src/lib/stream/issue-stream-token.ts:102-112`); a refund kizárólag owner (`src/lib/refund/route-handler.ts:76-86`); a `role`/`purchases` mezők field-szinten zároltak (`src/collections/Users.ts:32-52`); a products read a `publishedOrAdmin` politika; a webhook-events/audit-logs collections kizárólag rendszerírásúak, read owner/staff (`src/collections/WebhookEvents.ts:22-27`, `AuditLogs.ts:20-25`); a `paid` átmenet csak a callback-útvonal joga (T-063, `src/plugins/ecommerce.ts:196-212`).

### ✅ A02 — Cryptographic Failures: NINCS kritikus megállapítás
A Stream playback JWT helyes HS256-HMAC (`src/lib/stream/token.ts:78-108`); a jelszó-hash a Payload auth modulé (bcrypt-alapú); a titkok kizárólag ENV-ben (a logger redact-listája: password/token/secret/POSKey/cardNumber/cookie/session/apikey — `src/lib/logger.ts:52-77`); a POSKey sosem URL-ben, csak body/header (`src/lib/barion/client.ts:200-215`); a Számlázz-kulcs csak az XML-bodyban; a lazy kérés-idejű signing-key ellenőrzés (`src/lib/stream/issue-stream-token.ts:124-131`). (Az SMTP titkosítatlan-fallback a RED#3.)

### ✅ A09 — Logging & Monitoring: alapvetően erős
A strukturált logger redakciója + a pénzügyi audit-trail (webhook-events dedup + audit-logs before/after érzékeny-mező-mentesítve, `src/lib/audit.ts:88-118`) kiemelkedő. A callback-payload szándékosan nincs tárolva (adatminimalizálás). (A sikertelen-belépés-napló a GREEN#2.)

---

## Javítási prioritás

1. **🔴 RED#1 next@15.4.11 → 15.5.x (kapuval)** — a rewrites/SSRF/DoS-sorozat a PostHog `/ingest`-proxy miatt a mi felületünkön is közvetlen; a legnagyobb friss, gyakorlati kockázat.
2. **🔴 RED#2 Users auth lockout (maxLoginAttempts + lockTime + passwordMinLength)** — a jelszó-brute-force megelőzése alapvető; egy fájl, egy commit, a kapu azonnal igazolja.
3. **🔴 RED#3 SMTP STARTTLS kötelezővé** — a hitelesítés sosem mehet nyílt csatornán; kis, pontos javítás.
4. **🟡 YELLOW#1 JsonLd `</script>`-escape** — egy sor; tárolt-XSS-réteg.
5. **🟡 YELLOW#2 biztonsági HTTP-fejlécek (CSP Report-Onlyval kezdve)** — a Stream/Turnstile-hostokkal; stagingen hangolva.
6. **🟡 YELLOW#3 vitest ≥3.2.6 (dev)** — a kritikus dev-eszköz-sérülékenység; nincs pin-korlát.
7. **🟡 YELLOW#4 `@payloadcms/*` ütemezett bump (changelog + staging-E2E)** — a pin-szabály tiszteletben tartásával, W5-ticketként.
8. **🟡 YELLOW#5 árva-lejárat 2h → 24h** — a késői banki fizetés szélsőesete ritka, de a riasztás-manuális-út elkerülhető.
9. **🟢 GREEN#1-3 (video-ID kódolás, sikertelen-belépés-napló, CI+lockfile feltöltés + npm-audit-jobb)** — higiénia és detektálás; a CI-csomag feltöltésével együtt.

> Megjegyzés: a RED#2/#3 és YELLOW#1/#5 javítások a CLAUDE.md tilos zónáiba NEM ütköznek (nincs titok a repóban, nincs confirmOrder, nincs manuális migráció, az access-control-módosítás — Users auth-opciók — emberi jóváhagyással megy).
