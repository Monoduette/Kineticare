# kineticare.hu átállás — domain, Search Console, Ads

Ez az új platform fogja megkapni a `kineticare.hu` / `www.kineticare.hu`
címet (ma a régi Systeme.io oldal él ott). A PostHog már be van kötve;
a Google-ellenőrző és a CORS/CSRF-cutover env-kulcsai ebben a körben
kerültek a kódba.

## Amit a levelekből és a régi oldal HTML-jéből mértünk (2026-08-25)

- A Search Console **már gyűjt** a `kineticare.hu`-ra. Levél
  `sc-noreply@google.com`, tárgy: „Monitor the Google Search traffic to
  kineticare.hu”, 2026-08-25: 2026-08-23-án indult az impression-gyűjtés.
  A címzett a domain tulajdonosa — ez Domain-property-re jellemző, nem
  URL-prefix HTML-címkére.
- A régi `https://kineticare.hu` HTML-jében **nincs**
  `google-site-verification` meta, nincs `G-…` / `AW-…` / `GTM-…`.
  Systeme.io + DNS-ellenőrzés a valószínű út. **HTML-tokent ezért nem
  találunk ki, és a repóba értéket nem írunk.**
- Google Ads fiók (a lányok meghívója,
  `egeszsegmozgastamogatas@gmail.com` → `barnanorbert66@gmail.com`):
  ügyfélazonosító **822-497-2386**. Ez NEM konverzió-címke (`AW-…`).
  A fiók 2026-08-25-én szünetelt („advertiser verification”).
  Konverzió-azonosítót a levelekben és a Drive-on nem találtunk.

Nincs Search Console / Ads MCP ebben a környezetben — a fenti a Gmailből
és a publikus HTML-ből jön.

## Mit kell a Railway-en BEÁLLÍTANI cutover előtt

A sütis API-k (pénztár, belépés, haladás, admin) az `Origin` fejlécet
az engedélylistához mérik. Amíg a `NEXT_PUBLIC_SERVER_URL` a Railway-URL,
a böngésző Origin-je a `kineticare.hu` lesz, és a kérések 403-at kapnak,
ha az extra lista üres.

Railway (staging + prod), **érték nélkül a repóban**:

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

## Sorrend (DNS)

1. Railway-en `EXTRA_ALLOWED_ORIGINS` a két kineticare eredetre.
2. Build + deploy, healthcheck `GET /admin`.
3. DNS: apex + www → az új platform (a régi Systeme.io-t ne hagyd
   párhuzamosan ugyanazon a hoston).
4. `NEXT_PUBLIC_SERVER_URL=https://www.kineticare.hu` (vagy az apex,
   ha az a kanonikus), **újrabuild**. A `www` ↔ apex társ-eredet ettől
   a ponttól automatikus.
5. Search Console: sitemap `https://www.kineticare.hu/sitemap.xml`
   (és az apex, ha külön property). Domain-property esetén a DNS-TXT
   megmarad, új HTML-token nem kell.
6. Hirdetés: **ne induljon**, amíg a DNS a Systeme.io-ra mutat
   (`docs/adwords-kampany.md` 0.1). A fiók verifikációját a lányok
   fejezzék be. Konverziómérés nálunk PostHog; Ads-süti nincs.

## Amit a kód már tud

- PostHog consent-first (`NEXT_PUBLIC_POSTHOG_KEY`).
- GA4 consent-first, `ad_storage` always denied.
- GSC meta, ha az env ki van töltve.
- CORS/CSRF + same-origin őr a cookie-s POST API-kon
  (`src/lib/security/same-origin.ts`).
