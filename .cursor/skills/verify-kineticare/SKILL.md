---
name: verify-kineticare
description: Drive the Kineticare visitor storefront the way a user does (Railway Next.js surface, blog dual CTA, Otthoni product checkout href, course listing, appointment request). Use before claiming a CTA, checkout, cutover, or storefront change works.
---

# Kineticare verification

This skill is for the **visitor storefront**, not Payload admin, not Barion, not Ads finals. Read the feature file before you drive. Prove one mapped feature with the harness. Do not invent a local `.env`. Do not treat `www.kineticare.hu` as the app.

Renderer-level CTA locks already live in `src/__tests__/tudastar-cikkoldal.test.tsx` (`KEZ_CIKK_PAR_SLUGOK` + `befagyott-vall`). Do not add a second Vitest for the same fixture. This skill locks the **live HTML**. PR 178 (`docs/agent-feature-map.md`, craft/shop zárak) is a Grok-side map, not a substitute for this harness.

## Launch

The user surface today is the Railway Next app:

`https://kineticare-production.up.railway.app`

Measured 2026-08-28: `GET /` 200, title `Kineticare – kézrehabilitáció gyógytornászoktól`, `server: railway-hikari`. `https://www.kineticare.hu/` is still Systeme (`cdn.systeme.io`): `/` 200, `/blog/*` and `/kurzusok/otthoni-kezrehab-program` 404. Apex `https://kineticare.hu` 301-redirects to www. Do not point this skill at www. Do not use the Railway hostname as a Google Ads final URL (`docs/kineticare-hu-atallas.md`, `docs/adwords-kampany.md` 0.1).

There is **no local launch in the default path.** The repo starts with `npm run dev` (Next 16, port 3000), **not** `pnpm dev`. `package.json` scripts are npm. Node 24 (`engines`, `.nvmrc`). Required env, asserted in `src/env.ts`: `DATABASE_URI`, `PAYLOAD_SECRET`, `NEXT_PUBLIC_SERVER_URL`, `BARION_API_URL`, `BARION_PAYEE_EMAIL`. This Cloud Agent shell does not export those keys. `.env` is gitignored and must not be created in the repo. The Cloud Agent `start.sh` can write dummy values to `$HOME/.kineticare-dev.env` and run local Postgres + `npx payload migrate`; that database is schema, not the live CMS. Do not `npm run seed` to make verification work. Do not invent Barion/Számlázz keys.

If a later agent has a **seeded, disposable** local app and sets `KC_VERIFY_BASE_URL=http://127.0.0.1:3000`, doctor must still reject Systeme HTML and www hosts. Ready signal: `GET /` 200 and Kineticare brand, plus `GET /blog/teniszkonyok` 200 with two `kc-post-cta__panel` sections. Next's own "Ready" log is not enough.

Teardown for a local Next you started: kill **that PID** (the one you recorded), never `pkill -f next`. Default Railway HTTP runs start no server.

Isolation: Railway production is a **shared** instance. Two GET-only doctor/drive runs can overlap. Two mutating runs must not. This harness is GET-only.

```bash
export KC_VERIFY_BASE_URL="${KC_VERIFY_BASE_URL:-https://kineticare-production.up.railway.app}"
export KC_VERIFY_RUN_ID="${KC_VERIFY_RUN_ID:-$({ date -u +%Y%m%dT%H%M%SZ; })}"
export KC_VERIFY_EVIDENCE_DIR="${KC_VERIFY_EVIDENCE_DIR:-/tmp/kc-verify-evidence/$KC_VERIFY_RUN_ID}"
```

## Doctor

One read-only check. Run it first, and again after any failed drive.

```bash
.cursor/skills/verify-kineticare/bin/kc-verify doctor --evidence-dir "$KC_VERIFY_EVIDENCE_DIR"
```

Pass when all of these hold:

- `KC_VERIFY_BASE_URL` host is not `www.kineticare.hu` or `kineticare.hu`.
- `KC_VERIFY_FAIL_ON_WWW_404` is unset. If someone sets it, doctor exits 1 and tells them to stop: www 404 is cutover truth, not a CI goal.
- `GET /` 200, Kineticare brand, not Systeme.
- `GET /blog/teniszkonyok` 200 and exactly two `section.kc-post-cta__panel` nodes (scripts/styles stripped first; raw string count hits CSS).
- `GET /kurzusok/otthoni-kezrehab-program` 200.

Doctor also **observes** `GET https://www.kineticare.hu/blog/teniszkonyok` and writes the status into `doctor.json` under `www_cutover.ci_goal: false`. A www 404 does not fail doctor. A www 200 that looks like Systeme still does not fail doctor. Only the Railway (or explicitly overridden) app origin can fail doctor.

If doctor fails, do not drive.

## Drive

Harness: `kc-verify` (HTTP GET + HTML facts). Prefer routes, element `id`, accessible names, and CSS module classes that the storefront already ships (`kc-post-cta__panel`, `#kurzus-vasarlas-gomb`, `#idopontkeres`, `kc-field-appointmentName`). No click coordinates. No Playwright in this repo (`package.json` has no Playwright script; Vitest is node + `renderToStaticMarkup`).

```bash
.cursor/skills/verify-kineticare/bin/kc-verify doctor --evidence-dir "$KC_VERIFY_EVIDENCE_DIR"
.cursor/skills/verify-kineticare/bin/kc-verify drive blog-dual-cta --evidence-dir "$KC_VERIFY_EVIDENCE_DIR"
.cursor/skills/verify-kineticare/bin/kc-verify drive otthoni-kezrehab --evidence-dir "$KC_VERIFY_EVIDENCE_DIR"
.cursor/skills/verify-kineticare/bin/kc-verify drive befagyott-vall --evidence-dir "$KC_VERIFY_EVIDENCE_DIR"
.cursor/skills/verify-kineticare/bin/kc-verify drive kurzusok --evidence-dir "$KC_VERIFY_EVIDENCE_DIR"
.cursor/skills/verify-kineticare/bin/kc-verify drive kapcsolat-idopontkeres --evidence-dir "$KC_VERIFY_EVIDENCE_DIR"
```

Mapped features (recipes in `features/`):

| Feature | Path | Proof |
| --- | --- | --- |
| `otthoni-kezrehab` | `/kurzusok/otthoni-kezrehab-program` | `Megveszem a kurzust` → `/penztar?termek=N`; that page is `h1` Pénztár, contains `checkout_started`, product title, `Megrendelem és fizetek`. Not Kapcsolat. Not `/kurzusok`. |
| `blog-dual-cta` | seven `/blog/{slug}` | exactly two `kc-post-cta__panel`; course link `Nyisd meg a kurzusoldalt` → `/kurzusok/otthoni-kezrehab-program`; appointment `Kérj időpontot üzenetben` → `/kapcsolat#idopontkeres`. Dual CTA **only** on those seven slugs. |
| `befagyott-vall` | `/blog/befagyott-vall` | exactly one panel; appointment only; heading `Hogyan tovább?` |
| `kurzusok` | `/kurzusok` | `h1` Kurzusok; `#otthoni` band; card link to the Otthoni product; no post-CTA panels; no `#idopontkeres` form |
| `kapcsolat-idopontkeres` | `/kapcsolat#idopontkeres` | callback form (`Neved`, `Telefonszám`, submit `Időpontot kérek`), copy says this is not a calendar booking. Do not POST. |

Optional browser pass (computer-use / CDP) after HTTP pass: same selectors, still no submit on Railway. Header brand link accessible name is `Kineticare kezdőlap`. Header CTA to the catalogue is the `Kurzusok` button (`href=/kurzusok`). Sticky product buy bar: `role="region"` named `{courseTitle}: vásárlás`, same `Megveszem a kurzust` href as `#kurzus-vasarlas-gomb`.

Hard stops on the live app:

- Do not POST `/api/checkout/start` or click `Megrendelem és fizetek`.
- Do not submit `#idopontkeres` (`Időpontot kérek`).
- Do not sign in, change orders, refund, or call `confirmOrder`.
- Do not edit CMS, env, or medical copy.

## Evidence

Proof lives in `$KC_VERIFY_EVIDENCE_DIR` (default `/tmp/kc-verify-evidence/<run-id>`). Cleanup must not delete it. Copy a run you need to show a human into `/opt/cursor/artifacts/` (or attach the files on the PR). Do not commit HTML dumps.

Each drive writes:

- `<feature>.json` — facts, failures, `ok`
- `pages/*.html` — script/style-stripped HTML
- `doctor.json` / `doctor.txt` from doctor

Standards:

- Exercise the visitor path (the route they open), not a test-only endpoint.
- Capture the action **and** the resulting page. Product proof is the product page **plus** `GET /penztar?termek=N`. Dual-CTA proof is the article HTML, not the Vitest fixture.
- `checkout_started` is the PostHog event name serialized by `TrackEvent` on `/penztar` when a paid product is present (`src/app/(frontend)/penztar/page.tsx`). An empty `/penztar` is not proof. `/kapcsolat` is not proof. `/kurzusok` is not proof.
- Side effects: this harness does not create orders or leads. If you ever drive a disposable staging checkout, read back the order in admin; that is out of scope here.
- Strip `<script>` and `<style>` before counting `kc-post-cta__panel`. The inlined CSS repeats the class name.

## Cleanup

```bash
.cursor/skills/verify-kineticare/bin/kc-verify cleanup --evidence-dir "$KC_VERIFY_EVIDENCE_DIR"
```

Removes `$KC_VERIFY_SCRATCH_DIR/<run-id>` only. Leaves `$KC_VERIFY_EVIDENCE_DIR` in place. HTTP GET starts no process, so cleanup does not kill anything. If you started `npm run dev` yourself, kill that recorded PID after you have copied evidence. Never process-name kill.

After cleanup, `test -s "$KC_VERIFY_EVIDENCE_DIR/doctor.json"` (and the feature JSON you drove) must still succeed.

## Helpers

`bin/kc-verify` is executable Python 3, stdlib only.

```bash
chmod +x .cursor/skills/verify-kineticare/bin/kc-verify   # already executable in git
.cursor/skills/verify-kineticare/bin/kc-verify doctor
.cursor/skills/verify-kineticare/bin/kc-verify drive blog-dual-cta
.cursor/skills/verify-kineticare/bin/kc-verify drive otthoni-kezrehab
.cursor/skills/verify-kineticare/bin/kc-verify snapshot /blog/teniszkonyok
.cursor/skills/verify-kineticare/bin/kc-verify cleanup
```

Flags: `--base`, `--evidence-dir`, `--scratch-dir`. Env: `KC_VERIFY_BASE_URL`, `KC_VERIFY_EVIDENCE_DIR`, `KC_VERIFY_SCRATCH_DIR`, `KC_VERIFY_RUN_ID`, `KC_VERIFY_WWW_URL`.

## Invariants (harness, not PR chat)

1. Dual `.kc-post-cta__panel` (course + appointment) only on the seven slugs listed in `features/blog-dual-cta.md`. A new `/blog/{slug}` with both links fails `drive blog-dual-cta`.
2. `/blog/befagyott-vall` is one appointment panel. No `Nyisd meg a kurzusoldalt`.
3. Do not fail CI or doctor because www `/blog/*` is 404.
4. Checkout proof for Otthoni is `checkout_started` on `/penztar?termek=N` reached from that product slug.

Keep the map honest with `/maintain-verification-skill` when routes or CTA chrome change.
