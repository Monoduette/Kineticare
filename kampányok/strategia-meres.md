# Kineticare — mérés (PostHog, GA4, GSC)

> **Dátum:** 2026-08-22  
> **Állapot:** stratégia. Éles Ads-költés = 0. Nincs kitalált konverziós arány, ROAS vagy forgalom.  
> **Forrás:** `docs/posthog.md`, `docs/ga4.md`, `docs/adwords-kampany.md` 0.2 / 9., `docs/piaci-strategia.md` 7.5, `src/lib/analytics/posthog.ts`, `src/lib/analytics/ga4.ts`, `src/lib/analytics/consent.ts`, `MIT-CSINALJ.md`.

A mérés **kapu**, nem dísz. Amíg a domain Systeme-en van, a `.hu` GSC/GA/PostHog üres (`docs/adwords-kampany.md` 0.1). Amíg a `NEXT_PUBLIC_*` kulcsok nincsenek a **buildben**, a kliens csomag néma (`docs/posthog.md` 2; `docs/ga4.md` 2).

---

## 1. Kapuk (a briefing C pontja, mérési nyelven)

| # | Kapu | Hol dől el | Ma (kód / doksi) |
|---|---|---|---|
| 1 | Domain-cutover | DNS + `NEXT_PUBLIC_SERVER_URL` | `www.kineticare.hu` = Systeme; új app Railway-en (`docs/piaci-strategia.md` 7.1) |
| 2 | Három A-gyökér HTTP 200 | élő GET | A gyökér-hubok **nincsenek** a storefrontön; a törzs `/blog/…` alatt van. Ínhüvely: nincs cikk |
| 3 | Consent-split a hirdetési tárolókra | `src/lib/analytics/ga4.ts` | `ad_storage`, `ad_user_data`, `ad_personalization` **mindig denied** (`docs/ga4.md` 3; ads 0.2 / K2) |
| 4 | Élő checkout / megbízható purchase (briefing: `checkout_started` / `purchase_confirmed`) | PostHog | Kódbeli nevek: `checkout_started`, `purchase_confirmed`. Vendég-purchase **szándékos lyuk** (`docs/posthog.md` 4a / 7) |
| 5 | Céloldal-ígéret / refund | CMS + ÁSZF | Legacy szöveg + ÁSZF ellentmondás (`docs/adwords-kampany.md` 0.3; `src/lib/legal-source/aszf.txt`) |
| 6 | Blog→gyökér redirect + canonical | Web | Még nincs gyökér-hub |

**Ads 1 Ft csak akkor**, ha mind a hat zöld. A Google Ads felület konverziója ezen a kereten várhatóan vak: a hirdetési sütik nem nyílnak, és a modellezési küszöb **7 nap / 700 kattintás**, a doksi keretéből 7 napra **48–83 kattintás** jönne (`docs/adwords-kampany.md` 0.2). A tölcsér igazsága a **PostHog** + UTM.

---

## 2. Hol mérünk — három rendszer, három feladat

| Rendszer | Feladat | Bekapcsolás | Amit NEM tud |
|---|---|---|---|
| **PostHog** (EU, `/ingest` first-party proxy) | Funnel, termék, identify | `NEXT_PUBLIC_POSTHOG_KEY` + **rebuild**; consent `granted` | Ads-sütis attribúció; vendég-purchase (4a) |
| **GA4** (gtag.js) | Forgalom, AI-referral regex | `NEXT_PUBLIC_GA_MEASUREMENT_ID` + **rebuild**; ugyanaz a consent | `ad_*` tárolók; Enhanced conversions süti nélkül |
| **GSC** | Eligibility, index, lekérdezés | Tulajdonosi belépés: `sc-domain:kineticare.hu` (DNS) | Konverzió, bevétel |

Közös consent-állapotgép: `src/lib/analytics/consent.ts`, kulcs `kc_analytics_consent`. Ismeretlen = tiltva. A banner csak ekkor látszik. GA4: először `consent default` minden tároló `denied`, utána `analytics_storage: granted` — hirdetési tároló **sosem** (`docs/ga4.md` 3).

PostHog host alapértelmezés: `https://eu.i.posthog.com`. Session replay **ki** van kapcsolva kódban (`disable_session_recording: true`) — tulajdonosi döntés 2026-08-21 (`docs/posthog.md` 7).

---

## 3. Eseményregiszter (kód = igazság)

`ANALYTICS_EVENTS` / `src/lib/analytics/posthog.ts`. A briefing `checkout_started` / `purchase_confirmed` aliasa a kódban:

| Briefing / doksi szándék | Kódbeli név (`ANALYTICS_EVENTS`) | Mikor | Megjegyzés |
|---|---|---|---|
| oldalnézet | `$pageview` | útvonalváltás | PostHog autocollect ki; kézi küldés |
| kurzusnézet | `course_viewed` | kurzusoldal | `courseId`, `courseSku` |
| pénztár megnyitva (briefing: `checkout_started`) | `checkout_started` | pénztár | |
| vásárlás (briefing: `purchase_confirmed`) | `purchase_confirmed` | köszönőoldal, **csak** `kind: 'status'` + `paid` | vendég 401 → **nincs** esemény |
| pénztár hiba | `checkout_failed` | elutasított beküldés | gépi hibakategória |
| lead szándék / siker | `lead_submitted` / `lead_succeeded` | űrlap | `leadSource` |
| tanulás | `course_started`, `lesson_completed`, `module_completed`, `course_completed` | lejátszó / kurzus | |
| videó | `video_started`, `video_milestone` | lejátszó | |

Személyes adat az esemény-tulajdonságokban **tilos** (e-mail, név, IP). A `purchase_confirmed` vihet `orderNumber`, `value`, `currency` — a 2026-08-21-es javítás szerint a bevétel mező korábban hiányzott (`src/__tests__/analytics/identify-and-revenue.test.tsx` fejkomment).

**Identify:** `identifyUser(users.id)` belépéskor/regisztrációkor; kijelentkezéskor `reset()`. `person_profiles: 'identified_only'` — identify nélkül a Persons lista üres. A briefing Insights sora „identify (#129)”-ként hivatkozik rá; a kódban az identify **bent van** (LoginForm / RegisterForm). Hogy a GitHub #129 nyitva van-e, azt ez a doksi nem állítja.

---

## 4. Baseline cutover UTÁN (üres Systeme-adat nem baseline)

Nincs saját historical forgalom (`docs/piaci-strategia.md` 0 / 7.5). Az első értelmes ablak a **cutover + kulcsok + rebuild** utáni 7 és 30 nap.

Amit rögzítünk (mérés, nem célérték):

### 4.1 PostHog

- `$pageview` a `/`, a három A-gyökér, `/kurzusok/<otthoni-slug>`, `/blog/<cep>` útvonalakon.
- Funnel: `$pageview` → `course_viewed` → `checkout_started` → `purchase_confirmed`.
- A funnel **bejelentkezett** fizetőre igaz; a vendég-ág hiányát ne „0% konverziónak” olvassuk.
- Persons > 0 identify után (tesztfiók, `docs/posthog.md` 6.4).
- Nincs session replay a felvételek listáján.

### 4.2 GA4

- Valós idejű hit cutover után, consent-igen ágon.
- Consent előtt: nincs `googletagmanager.com` kérés, `dataLayer` undefined (`docs/ga4.md` 5).
- AI-referral szegmens, ha a forgalom egyáltalán van: regex `chatgpt.com|perplexity.ai|claude.ai|gemini.google.com` (`docs/seo-geo-llm.md` 3). **Üres szegmens ≠ „az AI nem idéz”** — kevés mintán zaj.

### 4.3 GSC (eligibility)

Bekötés: `sc-domain:kineticare.hu` DNS-txt, **nem** URL-prefix a Railway hostra (`MIT-CSINALJ.md` A/4).

Sitemap: `/sitemap.xml` csak akkor Submit, ha curl **és** a GSC-fetcher is 200. A briefing szerint ma curl 200, WebFetch időnként 500.

Ellenőrzés 2–8 hét (tech SEO ablak, `docs/seo-geo-llm.md` 3):

- A három A-gyökér: „URL is on Google” vagy legalább „Crawled – currently not indexed” → okok.
- Egy szándék = egy URL: a `/blog/keztoalagut-szindroma` ne maradjon indexelve a gyökér mellett (redirect + canonical).
- Lefedettség: 404 a szándékosan kivezetett legacy spam-URL-eken (410 a kódban, `docs/orokolt-url-atiranyitasok.md`).

### 4.4 Google Ads (ha a kapuk zöldek)

A doksi 9. fejezete: a mérés **nálunk** történik. UTM minden végső URL-en (kampány, ad group, kulcsszó). gclid be van kapcsolva; süti híján a Google-oldali konverzió nem a forrás.

Ne olvassunk ki „0 konverzió a Google-ból = 0 vásárlás”.

---

## 5. Amit szándékosan nem mérünk / nem ígérünk

- Rangsor, impression share, AI share of voice-cél — nincs saját GSC-történet.
- ROAS / CPA cél a v1 keretre — nincs mért CR (`docs/adwords-kampany.md` 8.4: a 0,67–1,16% **küszöb**, nem előrejelzés).
- Enhanced conversions, offline import — consent + jog után, nem most.
- Session replay.
- Hamis `purchase_confirmed` a Barion-return URL-ből.

---

## 6. Jogi, ami a mérést is blokkolja

- PostHog **nincs** nevesítve az adatkezelési tájékoztatóban (`docs/posthog.md` 8; `docs/barion-pixel-jogi-szovegterv.md`). Cutover checklist: nevesítés.
- Hirdetési consent (`ad_storage` stb.) új kategória a sávon — **tulajdonos + ügyvéd** (`docs/adwords-kampany.md` K2). A kód ma szándékosan nem nyitja. Ads-konverzió süti nélkül = vak.

---

## 7. Insights sáv — mikor mit

| Mikor | Teendő |
|---|---|
| Most (Systeme) | Ne küldj sitemapet a `.hu`-ra. Ne olvasd a Systeme-analitikát saját baseline-nak. |
| Kulcsok be a Railway-en | Teljes rebuild; ellenőrizd, hogy a bundle-ben nem üres a kulcs |
| Cutover nap | 4.1–4.3 checklist; `/kezrehab` 308 a kanonikus slugra |
| Cutover + 7 nap | Van-e `$pageview` a public hoston; van-e `course_viewed`; identify teszt |
| Cutover + 30 nap | Funnel-számok (bejelentkezett ág); GSC eligibility a 3 hubra, ha publikálva vannak |
| Ads enabled után | UTM-bontás PostHogban; Google-költség vs. PostHog `checkout_started` — ne a Google konverzió oszlop |

A 25 AI-prompt havi minta a `strategia-seo-geo-llm.md` 4. szakaszában van — az is baseline, nem KPI-ígéret.
