# kineticare.hu átállás — domain, Search Console, Ads

Ez az új platform fogja megkapni a `www.kineticare.hu` címet (ma a régi
Systeme.io oldal él ott). A PostHog már be van kötve; a Google-ellenőrző és a
CORS/CSRF-cutover env-kulcsai a kódban vannak (`.env.example`,
`src/env.ts`).

A mai, mért állapot és a lépésenkénti menetrend a
[Mért állapot és menetrend (2026-09-23)](#mért-állapot-és-menetrend-2026-09-23)
szakaszban van. Az a mérvadó; a régebbi szakaszok háttérnek maradtak.

## Amit a levelekből és a régi oldal HTML-jéből mértünk (2026-08-25)

- A Search Console **már gyűjt** a `kineticare.hu`-ra. Levél
  `sc-noreply@google.com`, tárgy: „Monitor the Google Search traffic to
  kineticare.hu”, 2026-08-25: 2026-08-23-án indult az impression-gyűjtés.
  A címzett a domain tulajdonosa, ez Domain-property-re jellemző, nem
  URL-prefix HTML-címkére.
- A régi `https://kineticare.hu` HTML-jében **nincs**
  `google-site-verification` meta, nincs `G-…` / `AW-…` / `GTM-…`.
  Systeme.io + DNS-ellenőrzés a valószínű út. **HTML-tokent ezért nem
  találunk ki, és a repóba értéket nem írunk.** (2026-09-23: az apex TXT-rekordjai
  között ott a `google-site-verification`, lásd lent.)
- Google Ads fiók (a lányok meghívója,
  `egeszsegmozgastamogatas@gmail.com` → `barnanorbert66@gmail.com`):
  ügyfélazonosító **822-497-2386**. Ez NEM konverzió-címke (`AW-…`).
  A fiók 2026-08-25-én szünetelt („advertiser verification”).
  Konverzió-azonosítót a levelekben és a Drive-on nem találtunk.

Nincs Search Console / Ads MCP ebben a környezetben: a fenti a Gmailből
és a publikus HTML-ből jön.

## Mért állapot és menetrend (2026-09-23)

### DNS és hosting, mérve 2026-09-23

| Rekord                                               | Érték                                                                                                                      | Mit jelent                                                                                                                                                                               |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NS                                                   | `ns.tns1-4.eu`                                                                                                             | Tárhely.Eu DNS. A névszerverek maradnak.                                                                                                                                                 |
| `kineticare.hu` A                                    | `185.51.188.89`                                                                                                            | Tárhely.Eu host. Már ma 301-gyel visz a `https://www.kineticare.hu/` címre, http-n és https-en is, útvonallal és query-vel együtt (mérve: `/kapcsolat`, `/kurzusok/1?x=1`, `/blog/abc`). |
| `mail.kineticare.hu`, `autodiscover.kineticare.hu` A | `185.51.188.89`                                                                                                            | Ugyanaz a host: ez az `info@` postafiók.                                                                                                                                                 |
| MX                                                   | `0 mail.kineticare.hu`, `10 feedback-smtp.us-east-1.amazonses.com`                                                         | A második rossz helyen van, lásd „A rossz helyen álló SES MX” pontot.                                                                                                                    |
| apex TXT                                             | SPF (`+a +mx +exists` spfcheck.eu, `include:amazonses.com`, `~all`), egy kósza DKIM `p=` érték, `google-site-verification` | A Search Console Domain-ellenőrzése ezen áll, maradjon.                                                                                                                                  |
| `resend._domainkey` TXT                              | megvan                                                                                                                     | Resend DKIM.                                                                                                                                                                             |
| `send.kineticare.hu` MX + SPF                        | megvan                                                                                                                     | Resend visszapattanó-domain.                                                                                                                                                             |
| `_dmarc`                                             | `p=none`, `rua` az `info@` címre                                                                                           | Csak megfigyelés.                                                                                                                                                                        |
| `www.kineticare.hu` CNAME                            | `d2mfytj37q7wja.cloudfront.net`                                                                                            | Systeme.io. **Csak ez a rekord változik.**                                                                                                                                               |

Railway, mérve ugyanekkor:

- A `Kineticare` szolgáltatásnak **nincs egyedi domainje**, csak a
  `kineticare-production.up.railway.app` (belső port 8080).
- A HTML canonical ma a Railway-URL
  (`<link rel="canonical" href="https://kineticare-production.up.railway.app"/>`),
  vagyis a `NEXT_PUBLIC_SERVER_URL` ma a Railway-URL.
- **Eltérés a várttól (12:56 UTC):** a Railway-hoston a `/` válaszában nincs
  `X-Robots-Tag` fejléc, a robots meta `index, follow`. A `src/middleware.ts`
  indexelés-kapuja csak akkor enged így, ha a build a
  `NEXT_PUBLIC_ALLOW_INDEXING=true` értékkel készült. A cutover előtt nézd
  meg a Railway-változót: ha már `true`, a Railway-hoston futó példány ma is
  indexelhető, és a Google a Railway-URL-t veheti fel kanonikusnak. Ha ez nem
  szándékos, állítsd üresre, és indíts valódi újrabuildet (a T lépésben úgyis
  `true` lesz).
- **A Tudástár ma ki van kapcsolva:** a `/blog` robots metája
  `noindex, follow`, a kezdőlapon nincs „Legfrissebb a tudástárból”, a
  sitemapben nincs `/blog` cím. Ez tulajdonosi beállítás (a `/blog` menüpont),
  nem hiba; a cutover után ugyanígy marad, amíg vissza nem kapcsolják
  (`docs/szerkesztoi-utmutato.md` 8. pont). A tünet-oldalak (pl.
  `/inhuvelygyulladas`) 200-zal elérhetők, a `/blog/<cikk>` címek 308-cal
  viszik oda.

### Az átállás elve

- **Csak a `www` CNAME változik.** Az apex A, az MX, a `mail` és az
  `autodiscover`, az SPF, a DKIM, a `google-site-verification`, a `_dmarc` és a
  `send.*` rekordok érintetlenek maradnak. A névszervereket nem költöztetjük.
- Az apex már ma a `www`-re irányít, útvonallal együtt, ezért az apexet nem kell
  a Railway-re vinni. A kanonikus cím a `https://www.kineticare.hu`.
- A Railway-domain (`kineticare-production.up.railway.app`) **élve marad**: az
  átállás előtt indított fizetések Barion-callbackje és visszatérő címe még oda
  mutat (`src/lib/checkout/start-checkout.ts`: a `redirectUrl` és a
  `callbackUrl` a `NEXT_PUBLIC_SERVER_URL`-ből épül, az indítás pillanatában).
  A `/api/barion/callback` nem sütis végpont, a same-origin őr nem vonatkozik
  rá, tehát a régi hoston a cutover után is fogadja a callbacket.

### T−1 (előző nap)

1. Tárhely.Eu: a `www` CNAME TTL-je 300 másodperc (hogy a váltás és egy
   esetleges visszaállás gyorsan terjedjen).
2. Railway: a `Kineticare` szolgáltatáson **custom domain:
   `www.kineticare.hu`**. A Railway ad egy CNAME-célt és egy TXT
   ellenőrző rekordot; a TXT-t most vedd fel a Tárhely.Eu-n, a CNAME-et még ne.
3. Railway-változó, érték a repóba nem kerül:

   ```
   EXTRA_ALLOWED_ORIGINS=https://kineticare.hu,https://www.kineticare.hu
   ```

   A sütis API-k (pénztár, belépés, haladás, admin) az `Origin` fejlécet az
   engedélylistához mérik (`src/lib/security/same-origin.ts`,
   `src/env.ts`). Amíg a `NEXT_PUBLIC_SERVER_URL` a Railway-URL, a
   `www.kineticare.hu`-ról jövő kérések enélkül 403-at kapnak. A változó nem
   `NEXT_PUBLIC_`, újrabuild nem kell hozzá, csak újraindítás.

### T (az átállás napja)

1. Tárhely.Eu: a `www` CNAME a Railway által adott célra.
2. Várd meg, amíg a Railway kiállítja a TLS-tanúsítványt a
   `www.kineticare.hu`-ra, és a domain „aktív”.
3. `GET https://www.kineticare.hu/admin` → 200 (a Payload belépő oldala).
4. Railway-változók:

   ```
   NEXT_PUBLIC_SERVER_URL=https://www.kineticare.hu
   NEXT_PUBLIC_ALLOW_INDEXING=true
   ```

   Mindkettő `NEXT_PUBLIC_`, a build **beégeti** őket. Ezért **valódi
   újrabuild** kell, és a build-logban ténylegesen le kell futnia a
   `node ./node_modules/next/dist/bin/next build`-nek (ha
   `Build · skipped` áll ott, a régi `.next/` indult el; lásd
   `docs/deploy-railway.md` és a `CLAUDE.md` 1. üzemeltetési tanulságát).
   Ettől a ponttól a `kineticare.hu` apex társ-eredet automatikus
   (`src/env.ts`, `companionLiveOrigin`).

5. Ellenőrzés a `www.kineticare.hu`-n:
   - a HTML canonical `https://www.kineticare.hu/…`;
   - a `/sitemap.xml` címei `https://www.kineticare.hu/…` kezdetűek;
   - a válaszban nincs `X-Robots-Tag: noindex` (a `src/middleware.ts` kapuja);
   - a régi Systeme.io címek átirányításai (`src/lib/legacy-redirects.ts`,
     táblázat: `docs/orokolt-url-atiranyitasok.md`), például a `/kezrelax`
     308-cal a `/kurzusok/sos-kezrelax-villamkurzus` címre visz (a
     Railway-hoston mérve 2026-09-23), és a régi `/kurzusok/1` is 308-cal a
     `/kurzusok/otthoni-kezrehab-program` címre;
   - az apexről (`https://kineticare.hu/kapcsolat`) 301 a
     `https://www.kineticare.hu/kapcsolat` címre, onnan 200;
   - belépés, majd egy jelszó-visszaállító levél: a levélben lévő link a
     `www.kineticare.hu`-ra mutasson;
   - egy tesztvásárlás végig, a Barion visszatérő oldalával és a callbackkel.

### Visszaállás, ha valami nem megy

1. Tárhely.Eu: a `www` CNAME vissza a `d2mfytj37q7wja.cloudfront.net` célra (a
   Systeme.io T+14-ig él, lásd lent).
2. Railway: `NEXT_PUBLIC_SERVER_URL` vissza a Railway-URL-re, valódi újrabuild.
3. A `NEXT_PUBLIC_ALLOW_INDEXING` a visszaállás idejére legyen üres, hogy a
   Railway-host ne kerüljön az indexbe.

### Külső szolgáltatások, ellenőrzőlista

| Szolgáltatás          | Teendő                                                                                                                                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Barion                | A shop URL-je `https://www.kineticare.hu`, és a shop-ellenőrzést (review) ehhez kérd. A callback és a visszatérő cím a kódban a `NEXT_PUBLIC_SERVER_URL`-ből épül (`src/lib/checkout/start-checkout.ts`), ezt nem a Barion-felületen kell állítani. |
| Cloudflare Turnstile  | A widget hostnevei közé vedd fel a `www.kineticare.hu`-t és a `kineticare.hu`-t is, különben a kapcsolat- és időpontkérő űrlap ellenőrzése elbukik.                                                                                                 |
| Bunny Stream          | Ha a könyvtárakon be van állítva engedélyezett domain vagy referrer, vedd fel a `www.kineticare.hu`-t (a nyilvános és a védett könyvtárnál is).                                                                                                     |
| Resend                | A domain állapota legyen „Verified” (a `resend._domainkey` és a `send.*` rekordok megvannak).                                                                                                                                                       |
| Google Search Console | A Domain-property TXT-je marad, új HTML-token nem kell. Sitemap beküldése: `https://www.kineticare.hu/sitemap.xml`.                                                                                                                                 |
| Systeme.io vevők      | Tömeges import: `npm run import:customers` (`docs/vasarlo-migracio-terv.md`). Az átállási értesítő levél **csak a végleges domain élesedése után** mehet ki. A Systeme.io előfizetést **T+14 előtt ne mondd le**.                                   |
| Google Ads            | **Szünetel**, amíg a DNS nem az új platformra mutat (`docs/adwords-kampany.md` 0.1). Utána is csak a fiók-ellenőrzés befejezése után indulhat.                                                                                                      |

### A rossz helyen álló SES MX (az átállástól független)

Az apex MX-ei között ott a `10 feedback-smtp.us-east-1.amazonses.com`. Ez a
rekord csak a `send.kineticare.hu` alá való (Resend/SES visszapattanó-domain).
Az apexen az a baja, hogy ha a `mail.kineticare.hu` elérhetetlen, a küldő
szerverek a második MX-re, az SES feedback-címére kézbesítenek, és a levél
elveszik. **Javaslat: töröld az apexről.** A `send.kineticare.hu` saját MX-e
marad. Ez az átállástól függetlenül, bármikor elvégezhető.

## Mit kell a Railway-en BEÁLLÍTANI cutover előtt

A sütis API-k (pénztár, belépés, haladás, admin) az `Origin` fejlécet
az engedélylistához mérik. Amíg a `NEXT_PUBLIC_SERVER_URL` a Railway-URL,
a böngésző Origin-je a `kineticare.hu` lesz, és a kérések 403-at kapnak,
ha az extra lista üres.

Railway (prod), **érték nélkül a repóban**:

```
EXTRA_ALLOWED_ORIGINS=https://kineticare.hu,https://www.kineticare.hu
```

Ha a Search Console URL-prefix property-t kér HTML-metával (a Domain
TXT után ez ritkán kell):

```
NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION=
```

Ide a GSC által adott **nyilvános** token kerül, újrabuild kell
(`NEXT_PUBLIC_`). A layout `verification.google` mezője csak nem-üres
értéknél kerül a HTML-be.

```
NEXT_PUBLIC_GOOGLE_ADS_ID=
```

Üresen marad. A kód **nem** nyit `ad_storage` sütit; a `docs/ga4.md`
és a `docs/adwords-kampany.md` 0.2 pontja ezt tiltja. Az Ads
ügyfélazonosító (822-497-2386) NEM ide való.

A `NEXT_PUBLIC_GA_MEASUREMENT_ID` (`G-…`) a meglévő consent-kapus GA4.
Ha van GA4-adatfolyam a lányok fiókjában, azt ide, újrabuilddel.

## Régi sorrend (2026-08-25, felváltva)

A 2026-08-25-i terv az apexet és a `www`-t is az új platformra vitte volna. A
2026-09-23-i mérés szerint az apex a Tárhely.Eu-n marad (az már a `www`-re
irányít, és ott a postafiók is), ezért a fenti menetrend érvényes. A régi terv
többi pontja (Search Console sitemap, Ads-tilalom a DNS-váltásig,
`EXTRA_ALLOWED_ORIGINS` előre) beépült a menetrendbe.

## Amit a kód már tud

- PostHog consent-first (`NEXT_PUBLIC_POSTHOG_KEY`).
- GA4 consent-first, `ad_storage` always denied.
- GSC meta, ha az env ki van töltve.
- CORS/CSRF + same-origin őr a cookie-s POST API-kon
  (`src/lib/security/same-origin.ts`); a `www` ↔ apex társ-eredet a
  `NEXT_PUBLIC_SERVER_URL` alapján automatikus (`src/env.ts`).
- Indexelés-kapu: `NEXT_PUBLIC_ALLOW_INDEXING` nélkül minden válasz
  `X-Robots-Tag: noindex` (`src/middleware.ts`).
- Örökölt Systeme.io-címek: 308-as átirányítás vagy 410
  (`src/lib/legacy-redirects.ts`).
