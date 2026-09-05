# KC v1 logo source ledger

Checked on 2026-09-05. This ledger covers only the owner-requested H05/H14
identity research and the passive raster files under `public/media/press/`.
No CMS data was read or written.

## Integration contract

- Keep the current six home-rail entries: Nők Lapja, Karc FM, Házipatika,
  Képmás, iSport and MGYFT.
- Add only the four verified identity assets below. Six existing plus four new
  entries equals 10, within the existing `pressLogos` limit of 12.
- The change is compatible with the current CMS block and needs no schema,
  migration or dependency change. Integration does require CMS uploads and
  relation writes, followed by an authenticated readback. This acquisition task
  performed none of those CMS writes.
- Do not call the whole mixed row "press" or "partners". Kossuth Rádió and TV2
  are requested media entries; MASE is a professional association; the Magyar
  Kézsebész Társaság evidence is an event/speaker relationship.
- A logo identifies its organization. It does not by itself prove coverage,
  partnership, membership, clinical recommendation or endorsement.

The machine-readable handoff is `public/media/press/manifest.json`.

## Verified assets

### Kossuth Rádió

- Local file: `public/media/press/kossuth-radio.png`
- Suggested alt: `A Kossuth Rádió logója`
- Official page: <https://sajtoszoba.mtva.hu/kossuth>
- Official raster: <https://cdn.cms.mtv.hu/wp-content/plugins/sajtoszoba-plugin/images/logok/kossuth-r.png>
- Dimensions: 157 x 188 px; source bytes preserved.
- SHA-256: `66b16744dcbbb3aea7309869f3678f6893de48460985fdf7ea808c77a90d297c`
- Status: the identity and asset are verified. The media attribution is supplied
  by the owner request and was not independently verified in the repository or
  current official search. Do not present the logo as an endorsement.

### TV2

- Local file: `public/media/press/tv2.webp`
- Suggested alt: `A TV2 logója`
- Official page: <https://tv2csoport.hu/csatornak/tv2>
- Official raster: <https://tv2csoport.hu/storage/8/conversions/b2078f563ea0ed43a3ad1db395c10a1c66b98866-nav.webp>
- Dimensions: 256 x 256 px; source bytes preserved.
- SHA-256: `8b243f0e58d75707edbdee8cb9c6e42b2f7be80f68f7d6040236c83ac5008a83`
- Status: the identity and asset are verified. The media attribution is supplied
  by the owner request and was not independently verified in the repository or
  current official search. Do not present the logo as an endorsement.

### Magyar Sportrehabilitációs Egyesület (MASE)

- Local file: `public/media/press/mase.png`
- Suggested alt: `A Magyar Sportrehabilitációs Egyesület logója`
- Official relationship page:
  <https://magyarsportrehab.hu/felso-vegtagi-bizottsag/>
- Official raster: <https://magyarsportrehab.hu/wp-content/uploads/2023/12/02.mase-logo.png>
- Source dimensions and SHA-256: 1900 x 1900 px,
  `2f1827c77cef5a9776c453bd72273fdb557ef1b0350aa5f1e2a31094e8f8208a`.
- Local dimensions and SHA-256: 1431 x 396 px,
  `bdacf94ba106e7d9d10824e3ba8aa5b34ee926398c2122e21bc2624903ac7d81`.
- Transformation: transparent outer padding only was cropped. The official
  artwork, colors and aspect ratio were not changed.
- Status: identity and relationship are verified. The association identifies
  Kocsis Kata and Kiss Kata as Kineticare founders, founding MASE members and
  co-chairs of its Upper Limb Committee. This is a professional-association
  relationship, not press coverage or a clinical endorsement.

### Magyar Kézsebész Társaság

- Local file: `public/media/press/magyar-kezsebesz-tarsasag.png`
- Suggested alt: `A Magyar Kézsebész Társaság logója`
- Official page: <http://www.kezsebesz.hu/>
- Official raster:
  <http://www.kezsebesz.hu/wordpress/wp-content/uploads/2023/03/cropped-site_head_color.png>
- Dimensions: 600 x 150 px; source bytes preserved.
- SHA-256: `97f70fe6a7e4243e60b0cf70419a23b124d580075e689b423ac815049667043a`
- Corroborating official congress program:
  <https://www.asszisztencia.hu/mkt/2023/down/program_2023.pdf>
- Status: the society identity is verified. Repository CV evidence and the MASE
  official profile identify both founders as speakers/instructors at society
  congresses and events. This supports an event/speaker label only; it does not
  establish a Kineticare partnership, membership or endorsement.
- Transport caveat: the society site currently redirects to HTTP and presents
  an invalid HTTPS certificate. The checked raster is passive PNG, stored
  locally with its hash; no remote asset should be embedded at runtime.

## Unresolved requests

### D3

`D3` is not uniquely identified in the owner brief or anywhere relevant in the
repository. Search hits for unrelated design-decision IDs and a CDN hostname do
not identify a brand. No logo was downloaded. Required input: the full legal or
brand name, or an official page supplied by the owner.

### H14 contact logo

The repository contains the established light-background Kineticare logo at
`content/home-images/site/logo-kineticare.png` (500 x 96 px), matching the
legacy `6790f4bfde577_kckeklogog.png`. It also documents a historical white
Canva export for dark backgrounds, but that file is absent. H14 asks for a
"new" contact logo without selecting either treatment. Copying the existing
light logo would therefore guess the requested variant, so no H14 asset was
added. Required input: approved artwork or an explicit light/dark variant.

## Publication readback

After a separately authorized CMS update, read the saved `pressLogos` block
back and verify all 10 intended entries by media filename and alt text. The six
existing entries must still be present, no unresolved D3/H14 placeholder may
appear, and the visible heading must describe the mixed relationship types
without implying endorsement.
