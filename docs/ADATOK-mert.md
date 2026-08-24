# ADATOK-mert — kanonikus mért réteg (Kineticare)

> **Kötelező olvasmány** minden SEO/Ads/GEO tervezőnek. Stratégiai MD (`kampányok/*`, `docs/adwords-*`, stb.) **csak ide** hivatkozhat számra.  
> **Dátum:** 2026-08-24 · **Spend Ads:** 0 · **Szabály:** nincs kitalált volumén/CPA/rangsor. Becslés = becslésnek jelölve.  
> **Audit lock:** A/B hibák után; Search peer review elfogadta ezt a path-et.

## Mezők (minden sor)

| Mező | Kötelező | Megjegyzés |
|---|---|---|
| `kifejezes` | igen | magyar alak, ékezetesen |
| `metrika` | igen | vol / cpc / kd / tp / trend_index / traffic / rank |
| `ertek` | igen | szám vagy null |
| `egyseg` | igen | /hó, USD, Ft, %, index |
| `eszkoz` | igen | ahrefs \| semrush \| strale \| trends \| apify \| maps \| manual |
| `piac` | igen | HU default |
| `datum` | igen | YYYY-MM-DD |
| `runId` | igen (ha Monid) | **teljes** ULID, tilos csonkolni |
| `koltseg_usd` | ajánlott | run költség |
| `forras_doksi` | igen | melyik MD-ből került ide |
| `megjegyzes` | nem | pl. Semrush összevonás |
| `unresolved` | ha kell | true + magyarázat, ha két forrás ütközik |

**Vas:** Ahrefs és Semrush **soha nem keverhető** egy „a volumen” cellában. Ads licit / forecast → **Ahrefs CPC**. Semrush vol = szándékjelzés.

---

## 1) Cluster A — Ahrefs HU (elsődleges Ads/SEO sorrend)

Forrás: `docs/kulcsszavak.md`, `docs/adwords-kampany.md`, `docs/h-ih-kulcsszavak-draft.md`. Dátum-csomag: 2026-08-21…24.

| kifejezes | vol | kd | cpc_usd | tp | runId / forrás |
|---|---:|---:|---:|---:|---|
| kéztőalagút szindróma | 1200 | 5 | — | — | kulcsszavak.md (Ahrefs) |
| teniszkönyök | 3500 | 13 | — | — | kulcsszavak / adwords 3.6 |
| ínhüvelygyulladás | 2200 | 18 | **1** | 700 | `01M0SJQ0SBHS103YQ37Z6MTX1B` (2026-08-24) |
| csukló ínhüvelygyulladás | 250 | 13 | **3** | 900 | ugyanaz |
| de quervain | 60 | 0 | **4** | 60 | ugyanaz |
| ínhüvelygyulladás torna | 30 | 4 | **4** | 700 | ugyanaz |
| ínhüvelygyulladás kezelése házilag | 80 | — | null | — | ugyanaz |
| de quervain szindróma | 10 | — | null | — | ugyanaz |

**H-IH licit sáv:** $1–4 (Ahrefs). Lista: `docs/h-ih-kulcsszavak-draft.md`.

### További H-IH Ahrefs sorok (korábbi matching-terms / audit A1)

| kifejezes | vol | kd | cpc_usd |
|---|---:|---:|---:|
| ínhüvelygyulladás tünetei | 300 | 5 | 1 |
| hüvelykujj ínhüvelygyulladás | 300 | 9 | 2 |
| ínhüvelygyulladás kezelése | 300 | 17 | 1 |
| ínhüvelygyulladás gyógyulási ideje | 150 | 10 | 1 |
| ínhüvelygyulladás hüvelykujj kezelése | 150 | 12 | 6 |

> **B1 unresolved:** az 1. kör 81 számlázott matching-terms sorból ~14 nincs dokumentálva. Újramérés = új költség.

---

## 2) Ugyanaz Semrush HU (szándékjelzés — NEM Ads forecast)

| kifejezes | vol_semrush | megjegyzes | forrás |
|---|---:|---|---|
| kéztőalagút szindróma | 3600 | Ahrefs 1200 → **3,0×** (B2) | monid 2. kör |
| ínhüvelygyulladás | 2900 | Ahrefs 2200 | monid-negyedik-kor 2026-08-24 |
| ínhüvelygyulladás kezelése házilag | 1300 | Ahrefs 80 → **nagyságrend** (B2) | ugyanaz |
| csukló ínhüvelygyulladás | 480 | Ahrefs 250 → 1,9× | ugyanaz |
| de quervain | 210 | Ahrefs 60 | ugyanaz |
| kéz zsibbadás | 720 | Ahrefs 450 | monid |
| jobb kéz zsibbadás | 880 | Ahrefs 600 | monid |
| csukló fájdalom | 1000 | Ahrefs 800 | monid |

---

## 3) Unresolved / feloldandó ellentmondások

| ID | Ütközés | Állapot |
|---|---|---|
| U1 | `kéztőalagút szindróma` Semrush 3600 vs Trends 2026-átlag ~1210 | **unresolved** — Trends ≠ keyword DB; stratégia: Ahrefs sorrend (B3) |
| U2 | házilag Semrush 1300 vs Ahrefs 80 | **eljárás:** Ads/SEO prioritás Ahrefs |
| U3 | B1 hiányzó ~14 matching-terms sor | **elveszett** — ne találjuk ki |
| U4 | Autocomplete tételes listák / csonkolt runId (B9–B13) | pótlás = új kör + teljes runId |

---

## 4) Trends / szezon / zsugorodás

| jel | ertek | forrás |
|---|---|---|
| kéz zsibbadás YoY | −37% | piaci-strategia / monid 2 |
| kéztőalagút szindróma YoY | −18% | ugyanaz |
| csuklótörés YoY | −20% | ugyanaz |
| interest-by-region kéztőalagút | Zala 100 … BP 65 | monid-negyedik 2026-08-24 |
| interest-by-region teniszkönyök | Nógrád 100 … BP 39 | ugyanaz |
| interest-by-region ínhüvely | Somogy 100 … BP 59 | ugyanaz |

**Következmény (A5 lock):** info-blog forgalom KPI leértékelve; FAQ / Person / chunk / sameAs = cutover **előtti** fedezet.

---

## 5) Versenytárs / off-site (rövid)

| Cél | Mért | Forrás |
|---|---|---|
| fajakezem.hu | ~70 org traffic/hó, Ads 0, sebész profil | monid-negyedik (A8 zárva) |
| gyogytornaszom ads_copies | 93% / alkalomszám — YMYL tilos nálunk | monid-negyedik |
| probodystudio.hu/csapatunk | Kata+Kata → KINETICARE | audit A7 |
| foglaljorvost.hu | sameAs horgony | A7 |
| www.kineticare.hu/munkatarsak/ | indexelt, **404** | A7 |

---

## 6) Monid 2026-08-24

Teljes runId lista: `docs/monid-negyedik-kor.md`. Ahrefs H-IH: `01M0SJQ0SBHS103YQ37Z6MTX1B` (~$0.76).

---

## 7) Explicit döntések (B6/B7)

| Kérdés | Döntés |
|---|---|
| Krém / sín / műtét ára / B-vitamin | **Ads:** negatív. **SEO:** hub/FAQ OK. |
| „Lelki okai” | Katák igen/nem; addig nincs URL. |
| Váll / befagyott váll | **Hold** fiókszintű Ads-negatívon; Katák scope. |
| De Quervain | H-IH H2, nem külön AG v1. |

---

## 8) Frissítési szabály

1. Új mérés → először **ez a fájl**, aztán stratégia MD.
2. Teljes `runId`, tételes lista, költség.
3. Ütközés → `unresolved`, ne átlagolj.
4. Audit: szám / policy / koherencia.

---

## 9) Lyukak zárva 2026-08-24

Lásd `docs/monid-lyukak-2026-08-24.md` (összköltség $0.52376, 15 teljes runId).

- Ínhüvely: Strale SERP HU + Ahrefs volume-history (fő KW + házilag)
- Váll/alkar: Semrush keyword_metrics (5 seed) — Ads HOLD Katákig
- Backlinks_overview: gyogytornaszom / fajakezem / kineticare
- Tételes Strale autocomplete: ínhüvely 50, befagyott váll 22, alkar 21, csukló ínhüvely 10
