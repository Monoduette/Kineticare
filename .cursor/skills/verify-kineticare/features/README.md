# Kineticare visitor-surface verification map

This directory is the maintained source for verifying what a visitor can do on the Kineticare storefront. Read this index, then the matching feature file. The harness is `kc-verify` (HTTP GET against the current app origin).

## Baseline preconditions

- App origin is `KC_VERIFY_BASE_URL`, default `https://kineticare-production.up.railway.app`. That is the Next.js 16 + Payload storefront on Railway.
- `kc-verify doctor` has passed against that origin in this run.
- Do not use `https://www.kineticare.hu` or `https://kineticare.hu` as the app. Those still serve Systeme until DNS cutover. Their `/blog/*` 404 is current truth, not a pass/fail target.
- Do not use the Railway hostname as an Ads final URL.
- Do not POST checkout, appointment, or contact forms on Railway. Do not seed, do not write CMS, do not touch env.
- Renderer locks for the dual/single article CTA already exist in `src/__tests__/tudastar-cikkoldal.test.tsx`. This map is the live HTML. Do not duplicate those Vitest fixtures.

## Driving conventions

- Start from doctor, then one feature file.
- Prefer routes, `id`, accessible names, and existing `kc-*` classes over coordinates or tab counts.
- Treat quoted Hungarian labels as literals (`Megveszem a kurzust`, `Nyisd meg a kurzusoldalt`, `Kérj időpontot üzenetben`, `Időpontot kérek`).
- Strip `<script>` and `<style>` before counting `kc-post-cta__panel`.
- Restore nothing: GET does not mutate. Still keep proof artifacts.

## Proof and skip reporting

- Capture the visitor action and the page it produces. Product checkout proof is the product page **and** `/penztar?termek=N`.
- HTTP proof is JSON facts plus stripped HTML under `$KC_VERIFY_EVIDENCE_DIR`.
- If a browser is used, add an ARIA snapshot or screenshot that shows Kineticare brand and the control you used. Browser is optional; HTTP is the v1 harness.
- Report unreachable paths with the URL and the unmet precondition. Do not call a skip verified via a different path.
- `/` and `/kurzusok` are course surfaces (no article dual-CTA, no `#idopontkeres` form). `/szolgaltatasok` is a different CMS pattern (services + links into `/kapcsolat`); it is not one of the five features below.

## Feature entry contract

Each feature file starts with an H1 and one paragraph of user-visible behavior, then exactly four H2s: `Sub-features`, `How to get to it (user POV)`, `Driving it with kc-verify`, `Gotchas`.

## Features

- [Otthoni KézRehab product page](./otthoni-kezrehab.md) covers the paid course page and `checkout_started` on `/penztar?termek=N`.
- [Blog dual CTA](./blog-dual-cta.md) covers the seven kéz articles with two `kc-post-cta` panels.
- [Befagyott váll single CTA](./befagyott-vall.md) covers the one appointment panel.
- [Kurzusok listing](./kurzusok.md) covers the catalogue, including the Otthoni card.
- [Kapcsolat appointment request](./kapcsolat-idopontkeres.md) covers the callback form, not a calendar booker.
