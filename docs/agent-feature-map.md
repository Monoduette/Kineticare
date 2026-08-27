# Ügynök-térkép: cikk-CTA és tilos találgatások

> **Kinek szól:** a következő kódoló ügynöknek. Nem termékterv, nem architektúra-újraírás.
> **Honnan a zár:** squash-merge `785a8ad` (PR 174), élő kód a `mainen`.
> **Őr-tesztek:** `src/__tests__/tudastar-cikkoldal.test.tsx` (pár, 900 px, váll),
> `src/__tests__/belso-oldal-szekciok.test.tsx` (`/szolgaltatasok`),
> `src/__tests__/craft-lane-zarak.test.tsx` (Craft-sáv: Szerkesztő / Design / Kutató),
> `src/__tests__/shop-lane-zarak.test.tsx` (Shop-sáv: CTA-fixture, consent, eseménynév,
> Ads-konstans).

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

## A-gyökér és Ads-lander (nem HTTP-invariáns)

A cikk kanonikus címe ma `/blog/{slug}`. A gyökér hubok
(`/inhuvelygyulladas`, `/keztoalagut-szindroma`, `/teniszkonyok`) élőben
404-et adhatnak: ez **Ads-kapu** (ne hírdess 404-re), nem olyan szabály,
amit CI-ben „örökre 404” tesztként kell őrizni. Ha ezek az oldalak
később 200-zal megjelennek, a 404-őr hamis piros lenne, és az H-IH
kampány feltételét is elrontaná.

A Search-lock (`src/lib/tudastar/seo-kulcsszavak.ts`,
`OLDAL_KULCSSZAVAK`) más szerződés: az A-gyökér slugok **nincsenek** a
kulcsszó-importőr táblában. Az a kulcsszó-mező, nem HTTP-státusz. Ne
bővítsd 404-őrrel, és ne találj ki Ads-fiókállapotot a hiányzó gyökérből.

A kampányjegyzetek (`docs/monid-negyedik-kor.md`,
`docs/h-ih-kulcsszavak-draft.md`) „lander 200” sora tervezet. Ne jelezd
200-nak, amíg a gyökér nem az; ne írj tesztet, ami a 404-et állandónak
teszi.

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

## Shop-sáv zárak

A Shop-sáv csak azt viszi CI-re, amit a **repó forrása** meg tud buktatni
Ads-fiók, Google Ads API és kitalált lander nélkül. A kampánydoksi
`/blog/{slug}` végső URL-táblája a Craft-sáv 7.2 parse-a; az nem kód-
konstans, ne tiltsd ott a `/blog/` utat.

Őr: `src/__tests__/shop-lane-zarak.test.tsx`. A 900 px-es `:has` rács
és a `/szolgaltatasok` szivárgás továbbra is a cikkoldal-tesztben és a
belső-oldal tesztben él — itt ne másold.

### CI — a repó meg tudja buktatni

- **Két panel csak a hét kéz-slugon a `docs/cikkek` fixture-készleten.**
  A hét: `inhuvelygyulladas`, `keztoalagut-szindroma`, `teniszkonyok`,
  `miert-zsibbad-a-kezem`, `csuklotores-utani-gyogytorna`,
  `csuklo-es-kezfajdalom`, `pattano-ujj`. Mindegyik két testvér
  `.kc-post-cta__panel`, nincs `kc-post-cta__pair`.
- **Váll-cikk egy panel:** `/blog/befagyott-vall`,
  `APPOINTMENT_CTA_SLUGS === ['befagyott-vall']`.
- Új `docs/cikkek/*.md` slug a lock-listára kell. A produkciós
  `postCtaVariantOf` ma minden nem-váll slugnak `kurzus` (két panel)
  változatot ad; zárt hetes allowlist a függvényben termékdöntés, nem
  ennek a körnek a feladata.
- **Ads végső URL-konstans:** a `src/` (teszteken kívül) és a gyökér
  `*.config.*` fájlokban nincs olyan `ads` / `adwords` / `finalUrl` /
  `vegsoUrl` nevű konstans, amelynek értéke `/blog/` utat visz. Ma
  üres a halmaz; új kódbeli Ads-final-URL a `/blog/`-ra bukik. A
  `docs/adwords-kampany.md` 7.2 tábla nem ez a zár.
- **Consent-kapu:** `initPostHog` csak konfigurált **és** `granted`
  után hív `posthog.init`-et (az `/ingest` a `POSTHOG_API_HOST`, nem
  előzetes hálózat). `applyConsentToGoogleAnalytics` `unknown` /
  `denied` állapotban nem tölti a `gtag.js`-t. A storefront layout és
  a két provider SSR-kimenete nem tartalmaz `googletagmanager` /
  `gtag/js` scriptet. A Barion Pixel nem ide tartozik (fizetési feltétel,
  nem analitika).
- **`ANALYTICS_EVENTS` nevei** a `src/lib/analytics/posthog.ts`
  objektum pontos másolata. Átnevezés bukik; új kulcs a lock
  frissítésével jár.
- **`ad_*` denied:** a `CONSENT_MODE_DEFAULT` minden tárolóra `denied`;
  a `CONSENT_MODE_GRANTED` csak `analytics_storage: 'granted'`. A granted
  `consent update` parancs egyetlen `ad_*` kulcsot sem állít `granted`-re.
- Nincs `google-ads` kliens a `package.json` függőségeiben. Ne írj
  hamis Google Ads API-t a zár méréséhez.

### Térkép-only — Ads-fiók, ne kódolj tesztet

Ezek fiókállapotok. A következő ügynök ne Enable-eljen, ne költsön, és
ne jelezze élő Ads-státusznak a kampánydoksi tervezői sorát.

- **Spend 0.** Ne indíts licitálást ebből a PR-ből, és ne írj tesztet,
  ami a fiók költését találgatja.
- **Ne Enable-eld a K2 / K3 / K4 / K5 kampányt** a Google Ads-fiókban.
  A `docs/adwords-kampany.md` 2.1 táblájának „indul” sora tervezet, nem
  Enable-parancs. A doksi 11. szakasz K2–K5 kérdései más témák
  (`ad_storage` jogi kérdés, `lelki okai`, váll-lefedettség,
  termék-kulcsszó): azokat se kódold Ads Enable-őrnek, és ne keverd a
  checkout/számlázás K2 tesztjeivel.
- **A kezdőlap és a `/kezrelax` nem fizetett lander.** A Craft-sáv
  Design-tesztje őrzi a 7.2 / sitelink táblát és a 308-as átirányítást.
  Itt ne másold.
- **Az SOS nem fizetett ajtó.** A kanonikus cím
  `/kurzusok/sos-kezrelax-villamkurzus` (`COURSE_SOS_KEZRELAX`). Sitelink
  lehet; Search végső URL-nek, fizetett ajtónak ne tedd. Nincs Ads API
  a sitelink vs. Search megkülönböztetésére a fiókban — a térkép a
  szerződés.
- **H-IH csak akkor,** ha a gyökér `/inhuvelygyulladas` **200**. A T1
  kampány a doksiban „vár a cikkre”; a draft
  (`docs/h-ih-kulcsszavak-draft.md`) spend 0. 404-es gyökérre ne
  Enable-eld. A gyökér 200-ra váltása után a H-IH feltétele teljesülhet
  — ezért a 404 **nem** CI-invariáns.

## Amit ez a kör nem kér

- Kommentet, `useEffect`-et ne tilts.
- Architektúrát, Dune-stílusú újraírást ne kezdj.
- Ads- vagy orvosi szöveget ne írj át.
- Railwayt, env-t, migrációt, `confirmOrder`-t ne érintsd.
- Ne merge-elj.
- Ne írj tesztet, hogy az A-gyökér örökre 404.
- Ne írj Google Ads API-klienst, és ne találj ki fiók-Enable / spend
  állapotot.
