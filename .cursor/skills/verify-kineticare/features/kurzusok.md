# Kurzusok listing

The catalogue lists published courses in audience bands. A visitor can filter and open a course page. This surface is course-only: no article dual-CTA, no `#idopontkeres` form. Checkout is not here.

## Sub-features

- `list-open` shows `h1` `Kurzusok` at `/kurzusok`.
- `list-otthoni-band` renders the `#otthoni` region titled `Otthoni gyakorlóknak` when at least one laikus course is published.
- `list-otthoni-card` includes an article `kc-course-card` (or a heading link) to `/kurzusok/otthoni-kezrehab-program`. Media link accessible name is `{title}: a kurzus részletei`.
- `list-filter` may show `nav` `aria-label="Kurzusok szűrése kategória szerint"` with chip `Összes` plus category slugs. Chips omit themselves when the live catalogue has no categories; that is not a failure.
- `list-not-cta-article` has zero `kc-post-cta__panel` and no appointment form.

## How to get to it (user POV)

- Open `/kurzusok`.
- Choose the header button `Kurzusok`.
- From the home page, choose a course card or a CMS control that goes to `/kurzusok` or a product slug. Home is also course-oriented (no `#idopontkeres` on the 2026-08-28 Railway homepage).

## Driving it with kc-verify

Preconditions:

- `kc-verify doctor` passed.

- **Drive.** Run `.cursor/skills/verify-kineticare/bin/kc-verify drive kurzusok`.
- **List.** `GET /kurzusok` 200. `h1` is `Kurzusok`. `id="otthoni"` is present. Href `/kurzusok/otthoni-kezrehab-program` is present.
- **Not checkout, not appointment.** `panel_count` is 0. No `id="idopontkeres"`. No `Megveszem a kurzust` (cards are whole-card links, §3.2 #11, no buy button on the card).
- **Proof.** `kurzusok.json` and `pages/kurzusok.html`. JSON `ok` is true.

## Gotchas

- Course cards have no CTA label. Do not fail the listing because `Nyisd meg a kurzusoldalt` is missing. That label is the article recommendation, not the catalogue.
- `kc-course-card` appears on nested classes (`kc-course-card__media`). Count `<article ... kc-course-card` if you need a card count. Live Railway on 2026-08-28 had the otthoni band and the Otthoni product href; a professional band renders only when a `szakember` product is published.
- Empty state copy `Jelenleg nincs megjeleníthető kurzus` would be a product outage, not a harness bug. Report it; do not retarget www.
- Opening a card goes to the product page. `checkout_started` still requires `Megveszem a kurzust` there.
