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

## Partnerek (A04, /rolunk partner-logósáv)

Felvéve 2026-09-07. A tulajdonos kérése (docs/kc-v1-owner-review.md A04): a
partnerlogók úgy fussanak egy csúszó sávban, ahogy a régi kineticare.hu Rólunk
oldalán. A forrás minden tételnél **a régi kineticare.hu/rolunk saját, a
tulajdonos által korábban közzétett képfájlja** (CDN:
`d1yei2z3i6k35z.cloudfront.net/11095654/`); a szervezetek hivatalos oldaláról
nem töltöttünk le semmit, és a logó jelenléte itt sem jelent ajánlást vagy
támogatást (endorsement), csak a régi partnernévsor vizuális alakja.

Gépi nyilvántartás: `content/home-images/site/partner-manifest.json` (forrás-URL,
forrás-SHA-256, helyi SHA-256, méretek, átalakítás tételenként). Őr-teszt:
`src/__tests__/partner-logo-assets.test.ts`. A fájlok a `HOME_IMAGES`-ben
(`src/lib/home-seed.ts`, `partner-` előtag) élnek, így a seed és a restore
tölti fel őket, az induláskori önjavítás pedig visszatölti. A sáv a meglévő
`pressLogos` blokk (LogoRail: folyamatos, megállítható, `prefers-reduced-motion`
alatt statikus, WCAG 2.2 SC 2.2.2), felirata „Partnereink", horgonya
`#partnereink`, oldala `/rolunk`.

Egységes keret: minden fájl 700 × 400 px-es átlátszó vászon (a `press-*`
350 × 200 konvenció kétszerese), a rajzolat képaránya változatlan, WebP
veszteségmentes. Átalakítás csak: az egyszínű KÜLSŐ szegély levágása; a
fehér hátterű logóknál a fehér háttérpixelek átlátszóvá tétele (a rajzolat
érintetlen); a márka saját színes háttérblokkját (bézs, barack, fekete)
megtartottuk.

Bizalmi hatás forrásai: NN/g „Trustworthiness in Web Design"
(<https://www.nngroup.com/articles/trustworthy-design/>): az ismerős külső
nevek a hitelesség jelzői; Baymard „site seal trust"
(<https://baymard.com/blog/site-seal-trust>): a felismerhető jelvények növelik
a bizalmat, az ismeretlenek nem, ezért a sávba csak tényleges logó került.
Alt-szöveg: a szervezet neve (WCAG 2.2 SC 1.1.1).

| #   | Szervezet                                   | Régi fájl                                                       | Helyi fájl                                                                           | Alt                                           | Átalakítás                                 |
| --- | ------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------- | ------------------------------------------ |
| 1   | Magyar Sportrehabilitációs Egyesület (MASE) | `67c9a1738798c_IMG_0523.png` (teal, négyzetes közösségi avatár) | `public/media/press/mase.png` (H05, hivatalos szóvédjegy, ugyanaz a Médiatár-rekord) | A Magyar Sportrehabilitációs Egyesület logója | nincs új fájl                              |
| 2   | ProBody Stúdió                              | `67c9a253f3048_IMG_4351.png` (173 × 173)                        | `partner-probody-studio.webp`                                                        | A ProBody Stúdió logója                       | nincs vágás, barack háttér marad           |
| 3   | Dynamic Tape                                | `67c9a3c085d56_correct-protect-performLOGO-1.png` (1500 × 1497) | `partner-dynamic-tape.webp`                                                          | A Dynamic Tape logója                         | átlátszó szegély vágva                     |
| 4   | WIBBI                                       | `67c9a4f8047fa_Wibbi_Primary-FullColour.png` (898 × 242)        | `partner-wibbi.webp`                                                                 | A WIBBI logója                                | átlátszó szegély vágva                     |
| 5   | Halm Optika                                 | `67c9a51a50b07_logo.png` (632 × 518)                            | `partner-halm-optika.webp`                                                           | A Halm Optika logója                          | fehér szegély vágva, fehér háttér átlátszó |
| 6   | NISHI STUDIO pilates                        | `67c9a5c5b81f0_bezs_bg_logo.png` (1080 × 1080)                  | `partner-nishi-studio.webp`                                                          | A NISHI STUDIO pilates logója                 | nincs vágás, bézs háttér marad             |
| 7   | BodyGPS                                     | `67c9a6134bfb5_BodyGPS_Logo.png` (1426 × 1426)                  | `partner-bodygps.webp`                                                               | A BodyGPS logója                              | fehér szegély vágva, fehér háttér átlátszó |
| 8   | Magic Smile by Juci                         | `67c9a664bbb0c_Jucilogo-5.png` (1202 × 1196)                    | `partner-magic-smile.webp`                                                           | A Magic Smile by Juci logója                  | átlátszó szegély vágva                     |
| 9   | Be Fit With Ben                             | `69ed225bc16561.91850354_befitwithben2.jpeg` (251 × 220)        | `partner-be-fit-with-ben.webp`                                                       | A Be Fit With Ben logója                      | nincs vágás, fekete háttér marad           |
| 10  | OrtoCare                                    | `693f1a9ddd2f8_d80bcbe2-…-14ba4d0cc300.jpeg` (750 × 750)        | `partner-ortocare.webp`                                                              | Az OrtoCare logója                            | nincs vágás, fekete háttér marad           |
| 11  | Pille Fizioterápia                          | `69ed1ddd3fd109.77981488_pille.logo02.png` (1477 × 1500)        | `partner-pille-fizioterapia.webp`                                                    | A Pille Fizioterápia logója                   | fehér szegély vágva, fehér háttér átlátszó |

A SHA-256 értékek a manifestben állnak; a teszt a fájlok bájthashét és
méretét a manifesthez méri. 11 elem ≤ 12 (a blokk `maxRows`-a).

### Csak a mondatban maradó partnerek

A sáv alatti mondat: „Partnereink közé tartozik még az Aurora Medical, a
TUDATEST, a PhysioWatch, dr. pharm. Kocsis Kristóf és Csillik Árpád."

| Szervezet / személy       | Régi fájl                              | Miért nincs a sávban                                                                                      |
| ------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Aurora Medical            | `67c9a3563259b_image_12365029111.jpeg` | A grafikai leltár fotóként jelölte; a képen fehér JPEG-háttéren álló logó (nyitott kérdés, lásd lent)     |
| TUDATEST                  | `67c9a3ffb7385_474381039_…_n.jpeg`     | Facebook-CDN névmintájú profilkép, sötét beégetett háttérrel (nyitott kérdés)                             |
| PhysioWatch               | `67c9a4e51c11f_IMG_0515.jpeg`          | `IMG_` képernyőmentés, sötétkék körjelvény (nyitott kérdés)                                               |
| Csillik Árpád             | `67c9a5b48c0f4_CSH06417copy.jpeg`      | Portréfotó, nem logó; személyiségi jog                                                                    |
| dr. pharm. Kocsis Kristóf | `67c9a545075cc_IMG_0736.png`           | Kézírásos aláírás: sávmagasságban olvashatatlan, és egy magánszemély aláírásának közzététele nem indokolt |

Nyitott kérdés a tulajdonosnak: az Aurora Medical, a TUDATEST és a PhysioWatch
képe a megnézés alapján valódi (bár fotóból/képernyőmentésből származó) logó.
Ha a tulajdonos kéri őket a sávba, hivatalos fájl bekérése után 14 elem lenne,
ami meghaladja a blokk 12-es korlátját; ehhez a korlát indokolt emelése vagy
két sáv kell.

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
