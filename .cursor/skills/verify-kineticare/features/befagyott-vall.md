# Befagyott váll single CTA

The frozen-shoulder article ends with one recommendation panel. That panel is an appointment request, not a course buybox. The extra appointment box used on kéz articles is omitted so the same link is not printed twice.

## Sub-features

- `shoulder-open` shows the article at `/blog/befagyott-vall` with a Kineticare `h1`.
- `shoulder-one-panel` has exactly one `section.kc-post-cta__panel`.
- `shoulder-appointment` uses heading `Hogyan tovább?` and link `Kérj időpontot üzenetben` → `/kapcsolat#idopontkeres`.
- `shoulder-no-course-cta` has no `Nyisd meg a kurzusoldalt` and no `Megveszem a kurzust`.
- `shoulder-no-second-box` has no `Időpontkérés a rendelőbe` heading (that box is the kéz second panel).

## How to get to it (user POV)

- Open `/blog/befagyott-vall`.
- From `/blog`, choose the Befagyott váll card.
- From a kéz article's related list, choose the váll piece if it is offered. Related cards are not the CTA panel.

## Driving it with kc-verify

Preconditions:

- `kc-verify doctor` passed.
- Origin is the Next app. Not www.

- **Drive.** Run `.cursor/skills/verify-kineticare/bin/kc-verify drive befagyott-vall`.
- **One panel.** `GET /blog/befagyott-vall` 200. Stripped HTML has exactly one `kc-post-cta__panel` section. Text includes `Hogyan tovább?`. Link `Kérj időpontot üzenetben` href is `/kapcsolat#idopontkeres`, once.
- **Absence.** No `Nyisd meg a kurzusoldalt`. No `Időpontkérés a rendelőbe`. No `/penztar`.
- **Proof.** `befagyott-vall.json` and `pages/befagyott-vall.html`. JSON `ok` is true.

## Gotchas

- `postCtaVariantOf` returns `idopont` only for slug `befagyott-vall` (`APPOINTMENT_CTA_SLUGS` in `src/components/content/post-article.ts`). Other slugs are `kurzus` and get two panels when a course is attached.
- A free-course line can still appear under the appointment panel if a published free product exists. That is not a second `kc-post-cta__panel`.
- Do not follow the appointment link into form submit on Railway. Proving the href is enough here; the form is the `kapcsolat-idopontkeres` feature.
- Vitest already locks the fixture (`a váll-cikk egyetlen panelt kap`). This file is the live page.
