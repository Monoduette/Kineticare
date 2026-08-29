# Blog dual CTA

Seven kéz articles end with two sibling recommendation panels in the narrow column: a course panel that opens the Otthoni product page, then an appointment panel that jumps to the kapcsolat callback form. Dual CTA is only these seven slugs.

## Sub-features

- `dual-seven` is exactly: `inhuvelygyulladas`, `keztoalagut-szindroma`, `teniszkonyok`, `miert-zsibbad-a-kezem`, `csuklotores-utani-gyogytorna`, `csuklo-es-kezfajdalom`, `pattano-ujj`.
- `dual-panels` gives **two sibling** `section.kc-post-cta__panel` inside **one** `section.kc-post-cta` (no `kc-post-cta__pair` wrapper). Two `.kc-post-cta` roots is a fail.
- `dual-course-link` is `Nyisd meg a kurzusoldalt` → `/kurzusok/otthoni-kezrehab-program`.
- `dual-appointment-link` is `Kérj időpontot üzenetben` → `/kapcsolat#idopontkeres`.
- `dual-not-checkout` means the article has no `Megveszem a kurzust` and no `/penztar`.
- `dual-only-those-seven` fails if another `/blog/{slug}` from the listing grows the same two-link pair.

## How to get to it (user POV)

- Open `/blog/teniszkonyok` (preferred smoke path) or any of the other six slugs.
- From `/blog` (Tudástár), choose the article card for that slug.
- Scroll past the article body to the tint recommendation section. Header `Kurzusok` is global nav, not this pair.

## Driving it with kc-verify

Preconditions:

- `kc-verify doctor` passed.
- Origin serves the Next storefront. www Systeme `/blog/teniszkonyok` is 404 and must not be the origin.

- **Drive the map.** Run `.cursor/skills/verify-kineticare/bin/kc-verify drive blog-dual-cta`.
- **Each of the seven.** `GET /blog/{slug}` 200. After stripping script/style, class-token count of `kc-post-cta` is 1 (the root) and `kc-post-cta__panel` opening tags count is 2. Course accessible name `Nyisd meg a kurzusoldalt` has href `/kurzusok/otthoni-kezrehab-program`. Appointment accessible name `Kérj időpontot üzenetben` has href `/kapcsolat#idopontkeres`.
- **Shoulder contrast.** The same run `GET`s `/blog/befagyott-vall` and requires **one** root and **one** panel and no course-sales link. That is the closed list, not a second feature drive.
- **Listing sweep.** `GET /blog` collects `/blog/{slug}` hrefs. Any slug outside the seven plus `befagyott-vall` that shows two panels **and** both links fails.
- **Proof.** `blog-dual-cta.json` plus `pages/{slug}.html` for the seven and `befagyott-vall`. JSON `ok` is true.

## Gotchas

- Counting `kc-post-cta` in the raw response over-counts because the CSS bundle repeats the class and because `__panel` / `__title` share the prefix. Count exact class tokens after stripping script and style: one `kc-post-cta`, two `kc-post-cta__panel`.
- Bare `/pattano-ujj` and `/csuklo-es-kezfajdalom` (no `/blog/`) are Railway 404. Do not add those paths to doctor pass conditions or CI. The articles live at `/blog/...`.
- Following `Nyisd meg a kurzusoldalt` lands on the product page, not pénztár. Observe that GET href. Do not call that `checkout_started`. Do not POST checkout. Do not submit the appointment form.
- A second panel heading is `Időpontkérés a rendelőbe`, not `Hogyan tovább?`. `Hogyan tovább?` is the váll single-panel title.
- A published free course can add a text line (`SOS Kézrelax villámkurzus`) inside the **first** panel. That is not a third `kc-post-cta__panel` and not `Nyisd meg a kurzusoldalt`.
- Do not add a Vitest that re-renders `PostArticle` fixtures for these slugs. `src/__tests__/tudastar-cikkoldal.test.tsx` already does (`KEZ_CIKK_PAR_SLUGOK`).
- A www 404 on these slugs is cutover residue. Changing doctor to require that 404 is forbidden.
