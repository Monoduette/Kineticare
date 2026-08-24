# Kineticare — SEO / GEO / LLM stratégia

> **Dátum:** 2026-08-24 (felülírva).  
> **Állapot:** stratégia. Nincs kitalált pozíció, AI-share vagy forgalom-előrejelzés.  
> **Forrás:** `docs/seo-geo-llm.md`, `docs/kulcsszavak.md`, `docs/piaci-strategia.md`, `docs/adwords-kampany.md`, `MIT-CSINALJ.md`.  
> **Szám:** csak `docs/ADATOK-mert.md` — stratégia MD nem kever Ahrefs/Semrush cellát, nem talál ki volumen/CPA/rangsort.  
> **Orvosi törzs:** Kiss Kata + Kocsis Kata. A csapat nem írja át a klinikai szöveget.

Ez a fájl a `MIT-CSINALJ.md` „tökéletes” definícióját bontja oldalra és prompt-mintára. **Nem garancia.**

---

## 0.1 Cutover előtti ship-gate (Search lock — hard)

1. Sitemap **HTTP 200 mindkét úton** (curl + böngésző/GSC-kompatibilis út).
2. JSON-LD **Person** szerző: Kiss Kata + Kocsis Kata végzettséggel — **szervezet-only author = blokk** indexre.
3. FAQ mező kitöltve (ne üres `faq`); `og:image`, `seoTitle`, `seoDescription` a publikált A-hubokon.
4. A-draft **ne legyen thin** (Katák törzs vagy noindex marad).
5. Impresszum **indexelhető**.
6. Off-site backlog (A7): ProBody csapatunk sameAs, foglaljorvost, Kiss Kata név-disambig, legacy `/munkatarsak/` 404 → redirect.

**E-E-A-T / FAQ / chunk-önálló bekezdés / sameAs = cutover ELŐTTI fedezet**, nem utána checklist (A5/A6). Zsugorodó info-piac: blog-forgalom KPI leértékelve; idézhetőség felértékelve.

## 0. Keret

### Siker-definíció (a briefingből)

- **November elejére** a 3 A-hub indexelve a nyilvános hoston (januári szezon — `docs/piaci-strategia.md` 3: kéztőalagút / csuklótörés / teniszkönyök csúcsa **január**).
- **Eligibility (GSC):** indexelhető; egy állapot = egy URL; nincs blog+gyökér dupla.
- **GEO:** chunk-önálló bekezdés; FAQPage = a látható Q&A; szerző bio; 25 prompt havi minta.
- **Időtáv a doksiból:** tech SEO **2–8 hét**; AI-láthatóság **hónapok** (`docs/seo-geo-llm.md` 3).
- `llms.txt` **nem** elsődleges stratégia (`docs/seo-geo-llm.md` 4).

A piac **nem nő**: `kéz zsibbadás` 2024→2026 átlag −37%, `kéztőalagút szindróma` −18%, `csuklótörés` −20% (`docs/piaci-strategia.md` 3). A rés nyitott, a torta kisebb.

---

## 1. Keyword map — csak mért sorok

Két mérés van a repóban. **Nem vonjuk össze** őket egy „hivatalos” számmá. **Szám csak `docs/ADATOK-mert.md`.** Ahrefs és Semrush külön cella; ütközés = unresolved, nem átlag.

### 1.1 Ahrefs Keywords Explorer, `country=hu`, 2026-08-21 (`docs/kulcsszavak.md`)

| Kifejezés | Keresés/hó | KD | Forgalmi potenciál | CPC | v1 szerep |
|---|---:|---:|---:|---:|---|
| teniszkönyök | 3 500 | 13 | 3 700 | $1 | A-hub `/teniszkonyok` |
| vállfájdalom | 1 600 | 20 | 700 | $6 | **Kimarad** — a termék vállat nem fed (`docs/adwords-kampany.md` 1.3 / 3.8) |
| kéztőalagút szindróma | 1 200 | **5** | 1 000 | $3 | A-hub `/keztoalagut-szindroma` |
| pattanó ujj | 800 | **0** | 450 | $1 | Blog CEP |
| kéz zsibbadás | 450 | 17 | **2 200** | $4 | Blog CEP (nem gyökér v1-ben) |
| alkar fájdalom | 250 | **0** | 200 | $9 | Blog CEP / H4 ads (nem v1 Ads) |
| csuklófájdalom | 150 | **0** | 500 | $3 | Blog CEP |
| kézfájdalom | 150 | **0** | 400 | $10 | Blog CEP |
| csuklótörés utáni gyógytorna | 100 | **0** | 150 | $3 | Blog CEP |
| de Quervain | 60 | **0** | 60 | $4 | Nincs külön oldal a 6 cikkben |

**Nulla mért volumen, ne írj rá oldalt:** `egérkéz` · `online gyógytorna` · `zsibbadó kéz éjszaka` · `kézterápia` · `gyógytorna kézre` · `kézműtét utáni rehabilitáció` (`docs/kulcsszavak.md` 1).

**Szakmai továbbképzés:** `gyógytornász továbbképzés` 30/hó — SEO-ból eladhatatlan (`docs/kulcsszavak.md` 2/e; `docs/piaci-strategia.md` 6).

### 1.2 Monid / Ahrefs–Semrush piaci doksi, 2026-08-21 (`docs/piaci-strategia.md` 2.1)

| Kifejezés | Keresés/hó | Versenytárs helyezése (mért) | v1 szerep |
|---|---:|---:|---|
| **kéztő alagút szindróma kezelése házilag** | **1 600** | 6. | H2 a kéztőalagút-hubon |
| kéztőalagút szindróma | **3 600** | **24.** | Ugyanaz a hub — volumen **nem egyezik** az 1.1 1 200-as sorával |
| kézfej fájdalom | 880 | 18. | CEP |
| csukló ínhüvelygyulladás | 480 | 14. | A-hub `/inhuvelygyulladas` (törzs hiányzik) |
| mindkét kéz zsibbadása | 480 | 11. | CEP + 112-s figyelmeztetés a zsibbadás-magnál |
| csukló fájdalom kezelése házilag | 210 | 11. | CEP H2 |

A Semrush vs Ahrefs eltérést a piaci doksi 9. pontja és `docs/ADATOK-mert.md` (U1/U2) rögzíti. **Döntést a nagyságrend és a sorrend visz, nem egyetlen szám.** Szám csak `docs/ADATOK-mert.md`.

### 1.3 Kannibalizáció — amit ne másoljunk

A versenytársnál `csuklótörés utáni gyógytorna` **hat saját oldal** versenyez (7., 9., 24., 41., 69., 80.) (`docs/piaci-strategia.md` 2.3). Szabály: **egy hub + belső link a CEP-ekre**, nem öt félig átfedő cikk.

v1 kannibalizációs rizikó nálunk: `/blog/keztoalagut-szindroma` **és** `/keztoalagut-szindroma` egyszerre 200 + külön canonical. A kapu: redirect + canonical a gyökérre, mielőtt Ads/GSC a gyökeret kapja (`MIT-CSINALJ.md` C/6).

---

## 2. Oldalankénti SEO / GEO (A-hubok)

Minden hubra a `docs/seo-geo-llm.md` 2. fejezet checklistje **kötelező**. Itt csak a v1-specifikus ráadás.

### 2.1 Közös (Craft/Search + YMYL)

- Kérdés-alapú H2; az alcím alatti **első mondat = teljes válasz** (GEO chunk).
- 2–4 mondatos bekezdések; lista/tábla HTML, soha kép.
- Nincs „mint fentebb említettük”.
- Szerző bio: név, végzettség, praxis — ma a JSON-LD szerzője a szervezet (`docs/seo-geo-llm.md` 5.5).
- Orvosi disclaimer **elöl**.
- **Tilos:** gyógyulás-%, „hetek alatt megszűnik”, „garantált” (`MIT-CSINALJ.md`; `docs/adwords-kampany.md` 1.3).
- CTA híd: tünet → **Otthoni KézRehab**, nem az ingyenes SOS mint fő ajtó.
- FAQ a **látható** Q&A-ból (FAQPage schema csak azt tükrözze). A cikk-FAQ mező ma üres (`docs/seo-geo-llm.md` 5.5) — a hubon ezt ki kell tölteni.
- Title ≤ 47 karakter + ` | Kineticare` utótag (mért keret, `docs/seo-geo-llm.md` 5.4); description 110–160 karakter.

### 2.2 `/keztoalagut-szindroma`

- Elsődleges: diagnózisnév.
- Kötelező H2: kezelés házilag (1 600/hó mért alak).
- Műtét-szándék a SERP-en dominál (`docs/adwords-kampany.md` 3.2) — a szöveg a „mit tehetsz, mielőtt műtétre kerül sor” szög, nem a műtét ára.
- Terhességi kéztőalagút: mért élethelyzet, külön szakasz (`docs/piaci-strategia.md` 4).
- Forrás: a blogtörzs átültethető (`docs/cikkek/2-keztoalagut-szindroma.md`) — **Kata-lektor** nélkül nem publikálható (a fájl fejléce szerint).

### 2.3 `/inhuvelygyulladas`

- Nincs blog-forrás. Ez a Katák új törzse.
- Ads T1 addig **nem indul**, amíg ez a hub 200 (`docs/adwords-kampany.md` 2.1 / 3.8). Spend csak hub 200 után.
- Ne keverjük a pattanó ujjal (az CEP marad, külön szándék).

| Cél-URL | Kulcsszó / mért | Megjegyzés |
|---|---|---|
| `/inhuvelygyulladas` | Ahrefs 2200 / Semrush 2900; lista: docs/h-ih-kulcsszavak-draft.md + ADATOK-mert.md (A1: adat megvolt, nem „hiányzó”) | Nem adwords 7.3 „legnagyobb hiány”: az adat megvolt. Szám: `docs/ADATOK-mert.md`. |

### 2.4 `/teniszkonyok`

- Elsődleges: teniszkönyök; H2: otthon / házilag (`kezelése otthon` 400/hó, KD 4).
- Lokális szándék is van a kifejezésben (`docs/piaci-strategia.md` 6; `docs/adwords-kampany.md` 3.6) — **Cégprofil**, nem Ads a „közelemben” querykre (`MIT-CSINALJ.md` A/4).
- Blogtörzs átültethető (`docs/cikkek/3-teniszkonyok.md`).

### 2.5 Zsibbadás-mag (CEP, nem gyökér)

A `bal kéz zsibbadás hányinger` és `bal kéz zsibbadás fájdalom` **valós keresési alak** (`docs/piaci-strategia.md` 4). A 112-s figyelmeztetés a cikk **elején** áll, nem a végén. Ugyanez a szabály a hubokra, ha zsibbadás-szakaszuk van.

---

## 3. Technikai réteg — kész vs. cutover

**Kész a kódban** (`docs/seo-geo-llm.md` 1): robots + AI ALLOW, dinamikus sitemap, canonical, Organization/FAQ/Course+Product/Breadcrumb/Article JSON-LD.

**Cutover nélkül nem számít:** a Google a Systeme-oldalt indexeli a márkanévre (`docs/kulcsszavak.md` 3; `docs/piaci-strategia.md` 7.1).

**Nyitott (nem kitaláljuk, hogy kész):**

| Tétel | Állapot a doksiban |
|---|---|
| GSC `sc-domain:kineticare.hu` | Konnektor nincs; tulajdonos lép be (`MIT-CSINALJ.md` A/4) |
| Sitemap beküldés | Csak stabil 200 után (curl 200, WebFetch időnként 500) |
| FAQ séma a cikkeken | Komponens kész, mező üres |
| Szerző a JSON-LD-ben | Szervezet, nem Kata |
| `og:image` | Nincs |
| Kurzus-URL numerikus id → slug | 308 él a tesztek szerint; GSC-ben a slug a kanonikus |
| Cloudflare/WAF vs. AI-bot | Ellenőrizni cutover után (`docs/seo-geo-llm.md` 1) |

---

## 4. 25 AI-prompt — havi minta (baseline)

Szabály a doksiból: **25 jól választott prompt jobb, mint 500 véletlenszerű**; az AI-válasz nem determinisztikus — mintázatot mérünk, nem szó szerinti szöveget (`docs/seo-geo-llm.md` 3). Négy típus: bevétel, reputáció, versenytárs, rés.

Az alábbi 25 **nem kitalált kereslet**: a mért kulcsszavak / autocomplete-alakok és a doksi példamondatai. Havonta: megjelenünk-e, idéznek-e, milyen hangnemben. **Nincs célszám.**

### Bevétel (1–10)

1. „kéztőalagút szindróma kezelése házilag”
2. „kéztőalagút szindróma torna”
3. „legjobb online kézrehabilitációs kurzus” (doksi bevétel-típus)
4. „otthoni kéztorna program” (doksi bevétel-típus)
5. „ínhüvelygyulladás kezelése otthon”
6. „csukló ínhüvelygyulladás”
7. „teniszkönyök kezelése otthon”
8. „teniszkönyök gyakorlatok”
9. „pattanó ujj kezelése házilag”
10. „csuklótörés utáni gyógytorna gyakorlatok”

### Reputáció (11–14)

11. „mit tudni a Kineticare-ről” (doksi reputáció-példa)
12. „Kineticare kézrehab”
13. „Kineticare Kiss Kata Kocsis Kata”
14. „Otthoni KézRehab Program vélemény” — **csak akkor mérjük a tartalmat, ha van valódi, nem fiktív vélemény** (`docs/seo-geo-llm.md` 2.3: fiktív tesztimonial tilos)

### Versenytárs (15–18)

15. „gyógytorna vs otthoni kézrehab program”
16. „X vs Kineticare” (doksi versenytárs-sablon; X = a mért helyi versenytárs, nem kitalált név a havi futásban)
17. „teniszkönyök gyógytorna Budapest vagy otthon”
18. „kéztőalagút műtét vagy torna”

### Rés / élethelyzet (19–25)

19. „alternatíva a személyes gyógytornára kézsérülés után” (doksi rés-példa)
20. „bal kéz zsibbadás hányinger” — a válaszban a 112 **elöl** legyen; ha nem mi vagyunk a forrás, az is adat
21. „mindkét kéz zsibbadása”
22. „kéztőalagút terhesség alatt”
23. „gipsz levétele után torna”
24. „pattanó ujj gyógytorna videó”
25. „de Quervain otthoni kezelés”

Rögzítés: dátum, modell/kereső (Google AI Overview, ChatGPT, Perplexity, Gemini), idéznek-e, URL, hangnem. Egy táblázat / hó elég. A Search sáv viszi (`MIT-CSINALJ.md` B).

---

## 5. Amit a SEO nem old meg

`docs/piaci-strategia.md` 6:

- Szakmai (akkreditált) kurzus — 30 keresés/hó.
- Helyi „közelemben” szándék — Google Cégprofil + vélemény, nem cikk.
- Domain-átállás előtt bármelyik cikk indexelése a `.hu` márkanéven.

---

## 6. Sorrend

1. Katák: három A-törzs (ínhüvely **új**, a másik kettő átültetés + lektor).
2. Web: draft → published; blog→gyökér redirect+canonical; FAQ schema; szerző a JSON-LD-ben.
3. Cutover + GSC + Cégprofil.
4. 25 prompt első baseline (cutover után, a public hoston).
5. Ads K1 csak a kapuk után — lásd `strategia-ads.md`.
