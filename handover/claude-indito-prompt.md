# Kineticare — master starter prompt (Codex / Claude)

Give this file to the next coding agent: **OpenAI Codex** or **Anthropic
Claude** (Claude on a phone, Claude Code, or Cursor).

1. Open the repository: https://github.com/Monoduette/Kineticare
2. Paste the block between `MÁSOLD INNENTŐL` and `MÁSOLD IDÁIG` as the
   **first message**.
3. Put the concrete request in the `FELADAT` block, or leave that
   block as-is and send the request in the next message.

Canonical copy: `docs/claude-indito-prompt.md`.
Sendable copy: `handover/claude-indito-prompt.md`.
The two files are bit-identical. If you edit one, copy it to the other.

---

## MÁSOLD INNENTŐL

You are now working on the **Kineticare** repository.

Repository: https://github.com/Monoduette/Kineticare

Open that GitHub repository. Walk the files in the required reading
order below. **Learn the project before you write, edit, or “fix”
anything.** Do not guess. The evidence is the current source and its
tests, not your training memory, not a screenshot, and not an old
campaign note.

If a document and the code disagree, the code and the tests win. If
`CLAUDE.md` and another guide disagree, `CLAUDE.md` wins.

### What Kineticare is

Kineticare is a **Hungarian-language hand-rehabilitation course store**:
a webshop, a Payload CMS, and protected course video. A customer pays
with **Barion**, receives an invoice from **Számlázz.hu**, and watches
a purchased course through a **Bunny Stream** playback token.

Owner: Barna Norbert. Content and medical claims belong to Kocsis Kata
and Kiss Kata. Typical incoming work is **small**: a new page, a copy
change, a homepage section, an image, a menu item, or an article.

Live store: the Railway `Kineticare` app service, with its database in
the `Postgres-c8Rg` service. The `kineticare.hu` domain cutover is still
pending (`docs/kineticare-hu-atallas.md`); until then the new platform
runs on the Railway host only. Do not touch DNS or any `.env*` file
unless the owner explicitly asks.

This is a course store, not a generic CMS starter. Guest checkout is
allowed. The account is created on the paid path, with a password-setup
link. The usual buyer path is:

article or homepage → `/kurzusok/{slug}` → `/penztar?termek={id}` →
Barion → `/fizetes/koszonom` → `/kurzusaim/{id}`

Pinned stack you must know: Next.js 16.3.5 App Router, React 19.3.0,
Payload CMS 3.88.0, `@payloadcms/plugin-ecommerce` 3.88.0 (beta),
PostgreSQL, Node 24.20.0. `package.json` is the source of truth for
versions. Every `@payloadcms/*` version is exact. Caret ranges (`^`)
are forbidden.

### Your job in this repository

You are the next agent: Codex or Claude. Your job is:

1. **Learn** the repository in the required order.
2. Do **only the FELADAT**, with the smallest safe change. Do not
   expand the scope.
3. **Content** (copy, page, article, homepage band, menu, image,
   testimonial, lesson text): Payload admin (`/admin`) and
   `docs/szerkesztoi-utmutato.md`. Do not edit `HomeView` or other
   render code when the CMS owns that surface.
4. **Code / UI / behavior:** `docs/ugynok-kezikonyv.md`, sections
   “Hol kezdj, ha X” and “Hol szerkeszd”. UI work has a mandatory
   skill, listed below.
5. **If you are uncertain:** stop. Say what you do not know. Ask.
   Do not invent medical copy, prices, Ads creative, or a payment
   “fix”.

Customer-facing copy is **Hungarian**: native, plain, not AI-flavored.
Do not stack em dashes. Do not write marketing English on the
storefront.

### What you must learn before you touch FELADAT

You must understand all of the following:

- This is a course store with a real payment, invoice, and video chain.
  It is not a brochure site and not a generic Payload template.
- Payment confirmation is a **custom Barion state machine**. It is
  **not** the ecommerce plugin’s `confirmOrder`. The callback body is
  not proof. Only server-to-server **GetPaymentState v4** is proof.
- Access has **three truths**: a paid order is not a purchases
  checkbox, and a purchases SKU is not the access-grant clock.
- Storefront APIs live under `src/app/(frontend)/api/`, not
  `src/app/api/`. Payload REST lives under the `(payload)` group.
  GraphQL is disabled on purpose.
- Editors ship content from admin. Code owns structure, access, and
  checkout. If CMS can do the job, do not hard-code the change.
- The forbidden zones below are absolute. Violating them is forbidden.
  Working around them is also forbidden.

### Required reading order — walk it, do not skip it

Read **in this order**. Items 1–6 are always required. Items 7–9 are
required when FELADAT enters that domain.

1. https://github.com/Monoduette/Kineticare — repository root and
   `README.md`.
2. `handover/README.md` — the sendable packet, and what not to do.
3. `docs/ugynok-kezikonyv.md` **sections 0–4** (copy:
   `handover/ugynok-kezikonyv.md`; the two files are bit-identical).
   This is the where-is-what map: product, forbidden zones, mental
   model, how to work.
4. `CLAUDE.md` — governing rulebook. On contradiction, this file wins.
5. `AGENTS.md` — short rules, commands, forbidden zones.
6. `docs/szerkesztoi-utmutato.md` — admin: what to click, what not to
   touch.
7. Article / CTA / Ads locks: `docs/agent-feature-map.md`.
8. Before any UI work: `docs/ertekesitesi-ux-skill.md` **and**
   `.claude/skills/termektervezes/SKILL.md`. Designing UI from memory
   is forbidden.
9. Before writing, changing or reviewing any test:
   `.claude/skills/teszt-audit/SKILL.md` (authoring gate, counter-check on
   the pre-fix code, retention bar).
10. The handbook chapter that matches FELADAT, from section 5 onward,
    plus the single-topic file in `docs/`.

Until items 1–6 are done, write no code and “fix” nothing.

### Forbidden zones — no exceptions

If FELADAT asks for any of this, **refuse** and request human review.
Do not route around the rule.

- Do not call, import, re-export, or “repair” `confirmOrder`.
  Confirmation is GetPaymentState v4 plus the custom state machine.
  The local Barion adapter throws on purpose.
- Do not put a secret, password, POSKey, or token in the repository.
  Do **not read, edit, or copy** `.env*` files, including comments.
  If a new key is required, name it in `.env.example` with an empty
  value. Do not write the value yourself.
- Do not hand-write or hand-edit database migrations. Do not edit,
  delete, or reorder existing `src/migrations/*.ts` files.
- Do not change access rules (`src/access/`, collection or field
  `access`, auth hooks) without human approval.
- Do not bump a pinned `@payloadcms/*` version or switch it to `^`.
  Do not regenerate the lockfile.
- Do not tick `users.purchases` or `users.accessGrants` in admin.
  A gift course goes through the **Kurzus ajándékozása** panel /
  `grantPurchase`. Do not mint a fake paid order to grant access.
- Do not hand-edit order, cart, transaction, or invoice fields.
- Do not turn GraphQL back on.
- Do not deploy to `Kineticare-demo`. Leave the old volume-less
  `Postgres` service alone.
- Do not enable Google Ads spend, and do not write a medical claim,
  without Kata.
- Do not let a test make a real Barion or Számlázz.hu network call.
- Do not use `any`. Do not use `console.log`; use `src/lib/logger.ts`.

### Facts you need immediately

- Three truths: `orders` (money and invoice) ≠ `users.purchases`
  (SKU set) ≠ `users.accessGrants` (clock start). Duration lives on
  `products.accessDurationDays`. Missing start on a time-limited SKU
  is fail-open; fix it with the grant panel or the documented
  backfill, not a checkbox.
- Storefront API: `src/app/(frontend)/api/`. Checkout starts at
  `POST /api/checkout/start`. The Barion callback answers 200
  immediately, then confirms with v4.
- Two status fields: Payload `_status` (Draft / Published) and the
  custom `status` the storefront actually reads. A hook keeps them
  aligned. A course with `status=NULL` does not appear.
- A course is free only when `priceInHUFEnabled === false`. An empty
  or NULL price is not free.
- Two canonical course slugs:
  `/kurzusok/otthoni-kezrehab-program` (paid home program) and
  `/kurzusok/sos-kezrelax-villamkurzus` (free SOS lead magnet).
  `/kezrelax` 308-redirects to the SOS course. SOS is not an Ads
  lander.
- Homepage = the `pages` row with slug `kezdolap`, **Szekciók**.
  Do not overwrite an existing section list with seed. The boot-time
  seed only writes on a fresh install (empty Pages / Testimonials). A
  new page does not appear in the menu by itself.
- Most visitor copy comes from the CMS, with a code fallback only for
  an empty field: homepage video captions, photo slots,
  `/szakembereknek`, the contact e-mail. Which field feeds which
  visible element: `docs/mi-hol-szerkesztheto.md`.
- The Tudástár (blog) is switched off by hiding every `/blog` menu
  item (`src/lib/tudastar-kapcsolo.ts`). Do not add a second switch.
- Never pass the incoming route request as `new Request(request, …)`
  input: on Node 24 behind the Next 16 proxy it throws, and every
  Payload REST write returns 500. Copy its fields instead.
- Do not rename a live content slug. Hide or unpublish instead of
  deleting.
- On an empty database, first-user bootstrap is fail-closed without
  `FIRST_USER_BOOTSTRAP_TOKEN` (at least 32 characters). A missing
  or wrong `x-kineticare-bootstrap-token` is 403. No customer
  account is created.
- `npm run seed` is not a dry run. Missing `SEED_*` on a non-prod
  URL writes a full seed. `SEED_SCOPE=kezdolap` writes. `OWNER_*`
  scripts default to dry run.
- Background jobs run only when `ENABLE_JOB_WORKERS=true`. Missing
  that flag in production is a boot warning, not a shop outage.
- Cart state is `localStorage` key `kineticare-cart-v1`.
- Form kind is resolved from the exact form title (Kapcsolat /
  Hírlevél / Időpontkérés). Do not invent a second title contract.

### Content request (the usual job)

1. Read the matching section of `docs/szerkesztoi-utmutato.md` and
   `docs/mi-hol-szerkesztheto.md`.
2. Make the change in Payload admin unless the handbook says the
   code owns that surface.
3. Publish / draft / preview: editor guide, section 3.

### Code or UI request

- Branch: `feat/…` or `fix/…`, lowercase, no accents. On a Cloud
  Agent run, keep the requested `cursor/<name>-836d` branch shape.
- TypeScript strict. Focused test for new behavior.
- CI gates: `npm run typecheck`, `npm run test`, `npm run lint`.
- After `git add`, typecheck the **staged** tree, then commit with
  `git commit -F -` and a heredoc. Quoted `git commit -m` breaks on
  apostrophes.
- UI: at least two external sources (NN/g, Baymard, GOV.UK, Apple
  HIG, Material 3, or WCAG 2.2 with the success-criterion number).
  Measure contrast, touch target, and 320 px reflow. Do not estimate
  by eye. Button labels: `docs/ui-sztenderdek.md` §3.2 →
  `src/lib/cta-vocabulary.ts`.

### Before you touch FELADAT

Write a short English checklist (15 lines or fewer):

- what you understood about the product,
- which files from the required order you read,
- where FELADAT will change things, and where it will **not**,
- whether the request touches a forbidden zone.

### FELADAT

[Write the concrete request here.]

If this block is empty, wait for the next message. Until then, write
no code. Learn the repository in the required order.

## MÁSOLD IDÁIG
