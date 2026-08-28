# Otthoni KézRehab product page

A visitor opens the paid home-rehab course, sees the title, price, and buy control, and can reach the guest checkout for that product. Checkout proof is `checkout_started` on `/penztar?termek=N` for this slug, not Kapcsolat and not the `/kurzusok` list.

## Sub-features

- `product-open` shows `Otthoni KézRehab Program` as `h1` at `/kurzusok/otthoni-kezrehab-program`.
- `product-buybox` keeps the buybox `#kurzus-vasarlas` and the button anchor `#kurzus-vasarlas-gomb`.
- `product-buy-link` exposes `Megveszem a kurzust` to `/penztar?termek=N` (numeric id; live Railway used `1` on 2026-08-28).
- `product-checkout-started` loads that pénztár URL: `h1` is `Pénztár`, HTML contains `checkout_started`, the product title, and `Megrendelem és fizetek`.
- `product-not-other-surfaces` refuses to treat `/kapcsolat`, `/kurzusok`, or `/penztar` without `termek` as checkout proof.

## How to get to it (user POV)

- Open `/kurzusok/otthoni-kezrehab-program`.
- From `/kurzusok`, choose the course card whose title (or `aria-label` `{title}: a kurzus részletei`) is the Otthoni program, under the `#otthoni` band (`Otthoni gyakorlóknak`).
- From a dual-CTA article, choose `Nyisd meg a kurzusoldalt` (that link is this product, not checkout).
- Header `Kurzusok` is the catalogue, not this page.

## Driving it with kc-verify

Preconditions:

- `kc-verify doctor` passed on `KC_VERIFY_BASE_URL`.
- Origin is the Railway Next app (or a later cutover host that still serves this HTML). Not www Systeme.

- **Open product.** Run `.cursor/skills/verify-kineticare/bin/kc-verify drive otthoni-kezrehab`. `GET /kurzusok/otthoni-kezrehab-program` is 200. `h1` is `Otthoni KézRehab Program`. `kc-course-buybox` is present. `id="kurzus-vasarlas"` and `id="kurzus-vasarlas-gomb"` are present.
- **Read the buy control.** The stripped HTML contains an `a` whose text is `Megveszem a kurzust` and whose `href` matches `/penztar?termek=<digits>`. The sticky bar (`role="region"` named `Otthoni KézRehab Program: vásárlás`) repeats the same href. Two identical links are expected.
- **Open checkout.** The harness `GET`s that `/penztar?termek=N`. `h1` is `Pénztár`. Visible text includes `Otthoni KézRehab Program` and `Megrendelem és fizetek`. Raw HTML includes `checkout_started` (`TrackEvent` on the pénztár page). There is no `#idopontkeres` form.
- **Reject lookalikes.** `/kapcsolat` and `/kurzusok` are not recorded as checkout. `GET /penztar` without `termek` is not recorded as checkout.
- **Stop.** Do not fill the form. Do not click `Megrendelem és fizetek`. Do not POST `/api/checkout/start`.
- **Proof.** Evidence files `otthoni-kezrehab.json`, `pages/otthoni-kezrehab.html`, `pages/penztar-otthoni.html` under `$KC_VERIFY_EVIDENCE_DIR`. JSON `ok` is true.

## Gotchas

- The article CTA `Nyisd meg a kurzusoldalt` is **not** checkout. Checkout starts only after `Megveszem a kurzust` on this product page (or the sticky bar with the same href).
- `#kurzus-vasarlas` is the buybox. The IntersectionObserver target is `#kurzus-vasarlas-gomb`. Do not assert the sticky bar is visible over HTTP; `data-visible` defaults to `false` in the SSR HTML.
- Product id is not part of the public slug. Always read `termek` from the live href. Do not hard-code `1` in a new check if the href changed.
- Railway hostname is the verification origin until cutover. It is not an Ads final.
- Local `npm run dev` without live CMS will 404 this slug. Do not seed production-shaped content to fake it.
