# Ügynök-térkép: cikk-CTA és tilos találgatások

> **Kinek szól:** a következő kódoló ügynöknek. Nem termékterv, nem architektúra-újraírás.
> **Honnan a zár:** squash-merge `785a8ad` (PR 174), élő kód a `mainen`.
> **Őr-tesztek:** `src/__tests__/tudastar-cikkoldal.test.tsx` (pár, 900 px, váll),
> `src/__tests__/belso-oldal-szekciok.test.tsx` (`/szolgaltatasok`),
> `src/__tests__/craft-lane-zarak.test.tsx` (Craft-sáv: Szerkesztő / Design / Kutató).

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

## Craft-sáv tartalmi zárak

Ezek a zárak a **repóban már meglévő** nyilvános forrásokon mérnek: a
`docs/cikkek/*.md` publikálandó törzse (`extractArticleBody`), a belőle
renderelt `PostArticle` HTML (GYIK-kel), a `/blog` lista sablonja, és a
`docs/adwords-kampany.md` RSA/sitelink táblái. Orvosi szöveget, élő CMS-
tartalmat és Ads-kreatívot **ne írj át** attól, hogy a teszt zöld legyen.
Hiányzó vagy az élő szöveggel ütköző zár a térképen marad; új oldalt,
diagramot, landert ne találj ki a méréshez.

### Szerkesztő — nyilvános `/blog` HTML

A nyilvános cikk-HTML (törzs + GYIK + séma) és a lista sablon **nem**
tartalmazhatja:

- `DOI`, `PMID`, `doi.org`
- bibliográfiát / forrásjegyzéket (látható `Források` címsor, `Forrásjegyzék`,
  `id="forrasok"`, `kc-post-sources`)
- `Semrush`, `Ahrefs`
- az angol SEO-zsargont `\bvolume\b` (a magyar „volumen” és a CSS `1fr` nem ez)
- a kifejezést `hivatalos táblázat`

A `docs/cikkek/` H1 **előtti** forrástábla belső. A törzsben a köznyelvi
„források” szó maradhat („Amit a források tényként írnak”); a zár a
**jegyzéket** tiltja, nem a szót. Őr: `src/__tests__/craft-lane-zarak.test.tsx`.

### Design — nem Ads-lander, nincs kitalált orvosi ábra

- A **kezdőlap** (`/`) CMS-szekciósor (`HomeView`). Nem fizetett Ads-lander.
  Ne rakj rá RSA-kreatívot, ne kezeld lander-200-nak.
- A **`/kezrelax` nem 200-as lander:** 308 a
  `/kurzusok/sos-kezrelax-villamkurzus` kanonikus címre
  (`src/lib/legacy-redirects.ts`). Nincs `kezrelax` page route. A kampány
  7.2 végső URL-táblája és a sitelink-célok sem `/`, sem `/kezrelax`.
- **Ne adj hozzá Ads-kreatívot** a kezdőlaphoz vagy a `/kezrelax` átirányításhoz.
- **Kitalált orvosi / anatómiai diagram nincs** a vevői felületen. Admin
  bevételi oszlopdiagram (`src/components/admin/`) nem ide tartozik; ne
  másold át anatómiának.

**RSA saját kreatív** (`docs/adwords-kampany.md` 5.3 címsor/leírás + 6.
sitelink/kiemelés/kivonat cellái): ne legyen százalék-ígéret (`93%` stílus)
és ne legyen alkalomszám-ígéret (`5–8 alkalommal`). A versenytárs formulája
az 5.1 táblában **NEM**-ként áll; azt a prózát ne parse-old kreatívnak.
A `50+ videós gyakorlat` termékadat, nem gyógyulási arány.

**Térkép-only (élő Ads-szöveg, átírni tilos):** a „műtéti címsor” zárat
nem lehet bukásra vinni anélkül, hogy a meglévő kreatívot átírnánk. Az RSA
H2 3. címsora ma `Otthoni torna műtét előtt`; a
`docs/vevohang-es-hirdetesszoveg.md` tervezetben ott van a
`mielőtt műtétre kerül sor` alak is. A következő ügynök ne „javítsa” ezeket
orvosi/Ads-szövegnek, és ne nyisson második PR-t miattuk.

### Kutató — `/blog/inhuvelygyulladas` és `/blog/befagyott-vall`

Őrzött (fixture van, a teszt bukik, ha a nyilvános HTML elromlik):

- A **cím** (H1, `extractArticleBody` title) nem `műtét előtt` és nem
  `mielőtt műtétre kerül sor`. (A `/blog/keztoalagut-szindroma` H1 más cikk;
  arra ez a zár nem vonatkozik.)
- Az **ínhüvely** nyilvános HTML-ben nincs önálló `112` (nem a `1120px`
  CSS-érték).
- A törzs + GYIK **nem** tartalmaz gyógyulási százalék-ígéretet, alkalomszám-
  ígéretet (`N alkalommal`), és a `hetek alatt` csak tagadott katalógusban
  állhat („Amit nem írunk…”, illetve a „Hogy otthon, egyedül…” oszlop).
  A „2–3 hét alatt” leírás nem ez a kifejezés.

**Térkép-only:** a `/blog/befagyott-vall` nyilvános törzse **tartalmazza** a
mentőhívó `112`-t (OMSZ, szívinfarktus-blokk: „Hívd a 112-t”). Ezt a zárat
nem lehet CI-re tenni anélkül, hogy az élő orvosi szöveget átírnánk — az
tilos. A befagyott cikk epidemiológiai arányai (`2–5,3%`, `39%`) **nem**
gyógyulási ígéret; a teszt a gyógyulás-ígéret mintát méri, nem minden `%`-ot.

A két cikk fixture-e megvan (`docs/cikkek/7-inhuvelygyulladas.md`,
`8-befagyott-vall.md` + `src/lib/tudastar/faq.ts`). Új oldalt a méréshez
ne találj ki.

## Amit ez a kör nem kér

- Kommentet, `useEffect`-et ne tilts.
- Architektúrát, Dune-stílusú újraírást ne kezdj.
- Ads- vagy orvosi szöveget ne írj át.
- Railwayt, env-t, migrációt, `confirmOrder`-t ne érintsd.
