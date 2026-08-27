# Ügynök-térkép: cikk-CTA és tilos találgatások

> **Kinek szól:** a következő kódoló ügynöknek. Nem termékterv, nem architektúra-újraírás.
> **Honnan a zár:** squash-merge `785a8ad` (PR 174), élő kód a `mainen`.
> **Őr-tesztek:** `src/__tests__/tudastar-cikkoldal.test.tsx` (pár, 900 px, váll),
> `src/__tests__/belso-oldal-szekciok.test.tsx` (`/szolgaltatasok`).

Screenshotból ne diagnosztizálj. Futtasd a fenti teszteket, vagy nyisd meg a
valódi oldalt. A kampánydoksi nem HTTP-bizonyíték.

## Cikk végi CTA (`.kc-post-cta`)

Két testvér `.kc-post-cta__panel` a keskeny konténerben. Nincs `kc-post-cta__pair`
csomagoló. Mobil: `+` szelektor, egymás alatt. Asztal **900 px-től**:

```css
.kc-post-cta .kc-container--narrow:has(> .kc-post-cta__panel + .kc-post-cta__panel)
```

kétoszlopos rács (`minmax(0, 1fr) minmax(0, 1fr)`). Forrás:
`src/app/(frontend)/styles/blocks/post-view.css`. A 640 px-es kártyarács-váltás
nem ide tartozik.

### Két panel (kurzus + időpont)

Csak ez a hét poszt:

- `/blog/inhuvelygyulladas`
- `/blog/keztoalagut-szindroma`
- `/blog/teniszkonyok`
- `/blog/miert-zsibbad-a-kezem`
- `/blog/csuklotores-utani-gyogytorna`
- `/blog/csuklo-es-kezfajdalom`
- `/blog/pattano-ujj`

### Egy panel (időpont)

- `/blog/befagyott-vall` marad egyetlen időpont-panel. Második panelt ne adj hozzá.

### Ezekhez a CTA-mintához ne nyúlj

- `/szolgaltatasok` (CMS-szekciósor, nem `.kc-post-cta`)
- `/` (kezdőlap)
- `/kurzusok` (kurzuslista)

A `.kc-post-cta` osztály és a `PostCourseCta` import csak a cikkoldalon él
(`PostArticle` + `PostCourseCta` + `post-view.css`).

## Ads-lander nem 200

A cikk kanonikus címe `/blog/{slug}`. Gyökér `/inhuvelygyulladas`,
`/keztoalagut-szindroma`, `/teniszkonyok` pages-hub **nincs** (404), és
létrehozni tilos (`src/lib/tudastar/seo-kulcsszavak.ts`, Search-lock). A
kampányjegyzetek (`docs/monid-negyedik-kor.md`, `docs/h-ih-kulcsszavak-draft.md`)
„lander 200” sora tervezet, nem élő útvonal. Ne találj ki Ads-landert 200-nak.

## Amit ez a kör nem kér

- Kommentet, `useEffect`-et ne tilts.
- Architektúrát, Dune-stílusú újraírást ne kezdj.
- Ads- vagy orvosi szöveget ne írj át.
- Railwayt, env-t, migrációt, `confirmOrder`-t ne érintsd.
