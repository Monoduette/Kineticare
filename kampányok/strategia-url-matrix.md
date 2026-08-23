# Kineticare — URL-mátrix (stratégia)

> **Dátum:** 2026-08-22  
> **Állapot:** stratégia. Nincs élő Ads. Nincs kitalált rangsor / forgalom.  
> **Forrás:** `MIT-CSINALJ.md`; `docs/informacios-architektura.md`; `docs/orokolt-url-atiranyitasok.md`; `src/app/sitemap.ts`; `src/app/robots.ts`; `src/lib/legacy-redirects.ts`.  
> **HTTP-státusz:** csak ott, ahol a doksi mért. A többi **kód szerint** — élő curl a cutover napján kötelező.

A mátrix két idősíkot tart szét:

1. **Ma** — ami a Railway-appban / a kódban él (`kineticare-production.up.railway.app` a `docs/orokolt-url-atiranyitasok.md` szerint).
2. **Cél (v1 hubok)** — a három A-gyökér, amit a Katák törzse + Web publikál (`MIT-CSINALJ.md` A/1).

Amíg `www.kineticare.hu` = Systeme.io, a `.hu` GSC/GA/PostHog üres, és a fizetett kattintás a régi funnelre megy (`docs/adwords-kampany.md` 0.1; `docs/piaci-strategia.md` 7.1).

---

## 1. Döntési szabályok (nem rangsor)

| Szabály | Honnan |
|---|---|
| Sitemapbe csak az kerül, amit a találati listán akarunk | `src/app/sitemap.ts` fejkomment; Google sitemap-útmutató |
| Duplikátumnál egy kanonikus URL | uo. |
| Tranzakciós / auth URL: `robots.txt` Disallow + noindex | `src/app/robots.ts` |
| Ads a **kanonikus** kurzust hirdesse, ne a 308-at | `MIT-CSINALJ.md` A/3 |
| Blog CEP és gyökér-hub ne éljen egyszerre ugyanarra a szándékra | `MIT-CSINALJ.md` D; `docs/seo-geo-llm.md` 2.5 |
| v1-ben **nincs** külön gyökér: zsibbadás, pattanó ujj, csukló, gipsz után | `MIT-CSINALJ.md` A/1 |

---

## 2. Cél: három A-gyökér (még nincs a storefront gyökerén)

Ezek **Payload page** célok. Ma a storefrontön nincs `src/app/(frontend)/keztoalagut-szindroma/` route — a törzs a Tudástár / blog slugokon él.

| Cél-URL | Elsődleges kifejezés (mért, forrás) | Mai forrás-URL | Státusz ma | Cutover után |
|---|---|---|---|---|
| `/keztoalagut-szindroma` | kéztőalagút szindróma — Ahrefs 1 200/hó, KD 5 (`docs/kulcsszavak.md`); piaci doksi 3 600/hó (`docs/piaci-strategia.md` 2.1) — **a két forrás eltér, nem átlagoljuk** | `/blog/keztoalagut-szindroma` (Tudástár-cikk slug: `keztoalagut-szindroma`) | Blog CEP; gyökér-hub nincs | HTTP 200 a gyökéren; blog→gyökér 308/301 + canonical a gyökérre, **mielőtt** Ads a gyökeret hirdeti |
| `/inhuvelygyulladas` | ínhüvelygyulladás klaszter — mért 2 200 + 1 300 (`docs/adwords-kampany.md` 3.8); `csukló ínhüvelygyulladás` 480/hó (`docs/piaci-strategia.md` 2.1) | **Nincs** blog-forrás (`MIT-CSINALJ.md`; ads T1 „vár a cikkre”) | Lyuk | Katák megírják → Payload page 200 → csak utána Ads-ad group |
| `/teniszkonyok` | teniszkönyök — 3 500/hó, KD 13 (`docs/kulcsszavak.md`); ads K2a 3 500 (`docs/adwords-kampany.md` 3.6) | `/blog/teniszkonyok` | Blog CEP; gyökér-hub nincs | Ugyanaz, mint a kéztőalagútnál |

**H2-k (GEO), a törzsben — nem külön URL:**

- kéztőalagút: **kezelése házilag** — `kéztő alagút szindróma kezelése házilag` 1 600/hó (`docs/piaci-strategia.md` 2.1); `kéztőalagút szindróma kezelése házilag` autocomplete (`docs/adwords-kampany.md` 3.2).
- teniszkönyök: otthon / házilag — `teniszkönyök kezelése otthon` 400/hó, KD 4 (`docs/adwords-kampany.md` 3.6).

---

## 3. Storefront — kód szerinti nyilvános útvonalak

A `src/app/(frontend)/` route-ok + a sitemap statikus listája (`/`, `/kurzusok`, `/blog`, `/kapcsolat`).

| URL | Szerep | Sitemap | robots | Ads v1 | Megjegyzés |
|---|---|---|---|---|---|
| `/` | Kezdőlap | igen, priority 1 | engedélyezett | **Ne hirdesd** (`MIT-CSINALJ.md` A/5) | CMS-szekciók |
| `/kurzusok` | Kurzuslista | igen, 0.9 | engedélyezett | Nem v1 cél | |
| `/kurzusok/[slug]` | Kurzus (kanonikus) | igen, published slug | engedélyezett | Igen: **Otthoni** kanonikus slug, SOS nem | Id-alapú `/kurzusok/1`, `/kurzusok/2` → **308** a slugra (`docs/orokolt-url-atiranyitasok.md` 3. mérés) |
| `/blog` | Tudástár lista | igen, 0.8 | engedélyezett | **Ne hirdesd** a `/blog/…` URL-eket | |
| `/blog/[slug]` | Cikk (CEP) | igen, published | engedélyezett | Nem — CEP marad, Ads a gyökérre megy a 3 A-hubnál | Hat mért cikk: lásd 5. |
| `/blog/kategoria/[slug]` | Kategória | csak ha van published poszt | üres kategória: noindex, follow (`sitemap.ts`) | Nem | |
| `/kapcsolat` | Űrlap | igen, 0.5 | engedélyezett | Nem | Canonical a Web sávon (`MIT-CSINALJ.md` B) |
| `/[slug]` | CMS-oldal (szolgáltatások, rólunk, jogi) | published pages | engedélyezett (nem Disallow) | Nem | `docs/informacios-architektura.md`: `/szolgaltatasok`, `/rolunk`, `/aszf`, `/adatvedelem`, `/impresszum` |

**Kanonikus kurzus-slugok a tesztek / legacy-térkép szerint** (élő CMS felülírhatja — cutoverkor ellenőrizni):

| Kanonikus | Mit takar | Legacy forrás (308, kód) |
|---|---|---|
| `/kurzusok/otthoni-kezrehab-program` | Fizetős Otthoni KézRehab | `/kezrehab`, `/kezrehab-akcio`, `/oto-kezrehab-akcio`, `/kezrehab-penztar`, `/kezrehab-akcio-penztar`, `/typ-kezrehab`, `/typ-kezrehab-akcio` |
| `/kurzusok/sos-kezrelax-villamkurzus` | Ingyenes / SOS Kézrelax | `/kezrelax` (nyomtatott szórólap QR — `docs/orokolt-url-atiranyitasok.md` #8) |

`MIT-CSINALJ.md` A/3: a cutover-listán a `/kezrehab` és `/kezrelax` 308 a **kanonikus** slugra mutasson; Ads ne a 308-as címet hirdesse.

---

## 4. Tranzakciós / auth — ne index, ne Ads

`src/app/robots.ts` `DISALLOWED_PATHS` + sitemap „NINCS BENNE” lista:

| URL | robots | Ads |
|---|---|---|
| `/kosar` | Disallow | **Ne hirdesd** |
| `/penztar` | Disallow | **Ne hirdesd** |
| `/fizetes/` | Disallow | Nem |
| `/sikertelen` | Disallow | Nem |
| `/belepes`, `/regisztracio`, `/elfelejtett-jelszo`, `/jelszo-visszaallitas` | Disallow | Nem |
| `/fiok`, `/kurzusaim` | Disallow | Nem |
| `/admin`, `/api/`, `/graphql`, `/next/`, `/ingest/` | Disallow | Nem |

A `docs/informacios-architektura.md` 2026-08-16-i sétáján a `/kosar` **árva** volt (semmi nem linkelt rá a keretből) — ez IA-hiba, nem Ads-cél.

---

## 5. Tudástár-cikkek (CEP) — mért célzás

Forrás: `docs/seo-geo-llm.md` 5.2 (2026-08-21). A slug a `/blog/<slug>` alatt él.

| Slug | Elsődleges kifejezés | Havi keresés | KD | v1 gyökér? |
|---|---|---:|---:|---|
| `miert-zsibbad-a-kezem` | kéz zsibbadás | 450 | 17 | Nem — CEP marad |
| `keztoalagut-szindroma` | kéztőalagút szindróma | 1 200 | 5 | **Igen** — átültetés a gyökérre |
| `teniszkonyok` | teniszkönyök | 3 500 | 13 | **Igen** — átültetés a gyökérre |
| `pattano-ujj` | pattanó ujj | 800 | **0** | Nem — CEP marad |
| `csuklo-es-kezfajdalom` | csuklófájdalom | 150 | **0** | Nem — CEP marad |
| `csuklotores-utani-gyogytorna` | csuklótörés utáni gyógytorna | 100 | **0** | Nem — CEP marad |

**Ínhüvelygyulladás:** nincs sor a táblában. Az ads-doksi T1-et ezért tartja vissza.

A cikkek `seoTitle` / `seoDescription` betöltéskor üresen maradt; a fallback a cím + bevezető (`docs/seo-geo-llm.md` 5.1). A gyökér-huboknál ez **nem** ismételhető: külön title/description + canonical a gyökérre.

---

## 6. Örökölt Systeme-URL-ek (cutover-térkép)

Mérés 2026-08-16: a régi `www.kineticare.hu` sitemap **25 URL**, mind **HTTP 200** (`docs/orokolt-url-atiranyitasok.md`). Az új hoston a térkép előtt `/kezrelax`, `/kezrehab`, `/rendeloi-kezelesek` **404** volt; a kód 308/410/változatlan sorsot ad.

Összesen a doksi szerint: **7 változatlan + 13 tartós 308 + 5 darab 410**.

| # | Régi URL | Cél | Kód |
|---|---|---|---|
| 1–7 | `/`, `/szolgaltatasok`, `/rolunk`, `/kapcsolat`, `/aszf`, `/adatvedelem`, `/impresszum` | ugyanaz | változatlan (szabály **tilos**, elnyelné az oldalt) |
| 8 | `/kezrelax` | `/kurzusok/sos-kezrelax-villamkurzus` | 308 |
| 9 | `/kezrehab` | `/kurzusok/otthoni-kezrehab-program` | 308 |
| 10–15 | akciós / pénztár / typ változatok | Otthoni kanonikus | 308 (pénztár **szándékosan nem** `/penztar`) |
| 16–17 | `/rendeloi-kezelesek` (+ `-regi`) | `/szolgaltatasok#rendeloi` | 308 |
| 18–19 | `/hamarosan`, `/typ-hamarosan` | `/kurzusok` | 308 |
| 20 | `/search` | `/` | 308 (Systeme-sablon, üres) |
| 21–25 | idegen spam-útvonalak | — | **410** |

Apex → www a **régi** hoston: `https://kineticare.hu/` → **301** → `https://www.kineticare.hu/` (mért, uo. 3. szakasz).

---

## 7. Technikai SEO, ami már a kódban van

`docs/seo-geo-llm.md` 1. szakasz — nem ígéret, implementáció:

- `robots.txt` + AI-crawler ALLOW (`GPTBot`, `OAI-SearchBot`, `ClaudeBot`, `PerplexityBot`, `CCBot`, `Google-Extended`, …).
- `sitemap.xml` kérésidőben (`force-dynamic`).
- Canonical + metadata fallback (`src/lib/seo.ts`).
- JSON-LD: Organization (kezdőlap), FAQPage (kezdőlap), Course+Product (kurzus), BreadcrumbList, Article (poszt).
- Kurzusoldalon **egy** blokk, kettős `@type` — két blokk két entitásnak látszana.

Amit a gyökér-huboknál **még nincs** a doksi szerint: cikk-FAQ séma (`posts.faq` üres); szerző a JSON-LD-ben szervezet, nem Kata (`docs/seo-geo-llm.md` 5.5); `og:image` hiány.

---

## 8. Cutover checklist (URL)

Mérés, nem szemrevételezés (`docs/orokolt-url-atiranyitasok.md` 5; `MIT-CSINALJ.md` A/3–4):

1. `NEXT_PUBLIC_SERVER_URL` = a látogatói origin (`www`).
2. Railway build-logban **tényleges** `npm run build` (ne skipped `.next/`).
3. `/kezrehab` és `/kezrelax` 308 a kanonikus slugra (lánc nélkül).
4. Három A-gyökér **200**, canonical önmagára, blog-változat redirect+canonical.
5. `sitemap.xml` csak 200-as, kanonikus URL-eket tartalmaz.
6. GSC: `sc-domain:kineticare.hu` (DNS), ne a Railway hostot a `.hu` alá.
7. Sitemap beküldés csak ha curl **és** WebFetch/GSC-fetch is 200.

Amíg ez a lista nincs zöld: Ads költés 0.
