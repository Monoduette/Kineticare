# Kineticare Monid lyukak — 2026-08-24

Mérés: Norbert Barna / Kineticare. **Ads spend = 0.** Nem inventált számok; forrás: Monid futások.

A Strale autocomplete ékezetes betűi a szolgáltatónál mojibake-ként jöttek (`?` / replacement). Az alábbi listák a magyar helyesírás szerint visszaállított alakok; ahol a nyers sor eleve `i`-vel (nem `í`-vel) indult, ott **(nyers)** jelölés van. A nyers JSON bármikor visszanézhető a runId-vel (`monid_get_run`).

## Egyenleg és költség

| | USD |
|---|---:|
| Egyenleg előtt | **3.97308** |
| Egyenleg után | **3.44932** |
| **Összköltség (delta)** | **0.52376** |
| Soft cap | ~1.50 (fejrész a ~3.97 walletből) |

### Költségtábla

| Blokk | Eszköz | Endpoint | Cost USD | runId |
|---|---|---|---:|---|
| A SERP | Strale | `/x402/serp-analyze` | 0.1782 | `01M0ST8BETJK5P1CBB0ZTARRG5` |
| A szezon — ínhüvely | Ahrefs | `/keywords-explorer/volume-history` | 0.078 (13×0.006) | `01M0ST97S4379Q0RCG5HSDJZWQ` |
| A szezon — házilag | Ahrefs | `/keywords-explorer/volume-history` | 0.078 (13×0.006) | `01M0STB0QDJDFDN99HVJQ1HE5P` |
| D AC ínhüvely | Strale | `/x402/keyword-suggest` | 0.03564 | `01M0ST97ZPY5D2SFJB76QGAAR1` |
| D AC befagyott váll | Strale | `/x402/keyword-suggest` | 0.03564 | `01M0STA07VXPVRGYP6SB4H2AMV` |
| D AC alkar fájdalom | Strale | `/x402/keyword-suggest` | 0.03564 | `01M0STA06GCYMS11EJNXV1PKF1` |
| D AC csukló ínhüvely (opt.) | Strale | `/x402/keyword-suggest` | 0.03564 | `01M0STB1Y4FNE3RG3RKQCT2MVT` |
| C gyogytornaszom.hu | Semrush | `/backlinks_overview` | 0.009 | `01M0ST984S82HTFDGQAWK04AD7` |
| C fajakezem.hu | Semrush | `/backlinks_overview` | 0.009 | `01M0ST9W80SMT98WS3XQ8GC0Q9` |
| C kineticare.hu | Semrush | `/backlinks_overview` | 0.009 | `01M0ST9X5SBVT2SNX69NFCF2C9` |
| B befagyott váll | Semrush | `/keyword_metrics` | 0.004 | `01M0ST9XKE8HY4VC81DB7BWAAP` |
| B befagyott váll torna | Semrush | `/keyword_metrics` | 0.004 | `01M0ST9Y21YQCPK8Q6JHZ0KM7B` |
| B vállfájdalom | Semrush | `/keyword_metrics` | 0.004 | `01M0ST9Z3ZQEC7KV0B9TN2FE14` |
| B alkar fájdalom | Semrush | `/keyword_metrics` | 0.004 | `01M0ST9Z7K6W2PTDC95A6GYDQ9` |
| B alkar zsibbadás | Semrush | `/keyword_metrics` | 0.004 | `01M0ST9ZPFQRK18RQEW7HHG771` |
| **Összesen** | | | **0.52376** | |

### Teljes runId lista (15)

1. `01M0ST8BETJK5P1CBB0ZTARRG5`
2. `01M0ST97S4379Q0RCG5HSDJZWQ`
3. `01M0ST97ZPY5D2SFJB76QGAAR1`
4. `01M0ST984S82HTFDGQAWK04AD7`
5. `01M0ST9W80SMT98WS3XQ8GC0Q9`
6. `01M0ST9X5SBVT2SNX69NFCF2C9`
7. `01M0ST9XKE8HY4VC81DB7BWAAP`
8. `01M0ST9Y21YQCPK8Q6JHZ0KM7B`
9. `01M0ST9Z3ZQEC7KV0B9TN2FE14`
10. `01M0ST9Z7K6W2PTDC95A6GYDQ9`
11. `01M0ST9ZPFQRK18RQEW7HHG771`
12. `01M0STA07VXPVRGYP6SB4H2AMV`
13. `01M0STA06GCYMS11EJNXV1PKF1`
14. `01M0STB0QDJDFDN99HVJQ1HE5P`
15. `01M0STB1Y4FNE3RG3RKQCT2MVT`

### Schema / tool megjegyzések

- **Trends `/trend`:** nincs `country` paraméter (worldwide). HU szezonalitáshoz **Ahrefs volume-history** (country=`hu`, 2025-08→2026-08).
- **Semrush keyword_metrics:** vol / CPC / KD / density — nincs TP. Ahrefs fallback nem kellett.
- **Strale autocomplete:** mojibake → manuális ékezet; teljes listák.

---

## A) Ínhüvelygyulladás — SERP + szezonalitás

### A1) Google SERP HU — `ínhüvelygyulladás`

Strale `/x402/serp-analyze`, country=`HU`. PAA/features: üres.

| Pos | Title | URL | Domain |
|---:|---|---|---|
| 1 | Ínhüvelygyulladás - Tünetek és kezelés típusonként | https://www.webbeteg.hu/cikkek/mozgasszervi_betegseg/957/inhuvelygyulladas | webbeteg.hu |
| 2 | Ínhüvelygyulladás | https://bhc.hu/betegsegek/inhuvelygyulladas | bhc.hu |
| 3 | Ínhüvelygyulladás | https://www.gyorgytea.hu/betegsegek/inhuvelygyulladas/ | gyorgytea.hu |
| 4 | Ínhüvelygyulladás | https://egeszsegvonal.gov.hu/egeszseg-a-z/i-j/inhuvelygyulladas.html | egeszsegvonal.gov.hu |
| 5 | Ínhüvelygyulladás kezelése manuálterápiával | https://sherlockrehab.hu/blog/inhuvelygyulladas-hogyan-kezeljuk-a-fajdalmat-es-elozzuk-meg-a-visszaterest/ | sherlockrehab.hu |
| 6 | Ínhüvelygyulladás – a kézfájdalom leggyakoribb oka | https://medicarekorhaz.hu/blog/inhuvelygyulladas-a-kezfajdalom-leggyakoribb-oka/ | medicarekorhaz.hu |
| 7 | Ínhüvelygyulladás | https://bmm.hu/panaszok/inhuvelygyulladas/ | bmm.hu |
| 8 | Ínhüvelygyulladás tünetei és kezelése | https://www.hazipatika.com/betegsegek_a_z/inhuvelygyulladas | hazipatika.com |

→ Kineticare nincs a top 8-ban.

### A2) Szezonalitás Ahrefs volume-history HU

Ország: `hu`. Időablak: `2025-08-01` → `2026-08-01` (13 hónap, $0.006/hó).

#### `ínhüvelygyulladás`

runId: `01M0ST97S4379Q0RCG5HSDJZWQ`. Min **1925** (2025-12), max **2463** (2026-01).

| Hónap | Volume |
|---|---:|
| 2025-08 | 2182 |
| 2025-09 | 2142 |
| 2025-10 | 2212 |
| 2025-11 | 2177 |
| 2025-12 | 1925 |
| 2026-01 | 2463 |
| 2026-02 | 2346 |
| 2026-03 | 2374 |
| 2026-04 | 2349 |
| 2026-05 | 2181 |
| 2026-06 | 2073 |
| 2026-07 | 2237 |
| 2026-08 | 2170 |

Sorban: 2182, 2142, 2212, 2177, 1925, 2463, 2346, 2374, 2349, 2181, 2073, 2237, 2170.

#### `ínhüvelygyulladás kezelése házilag`

runId: `01M0STB0QDJDFDN99HVJQ1HE5P`. Ahrefs sáv **~38–158**.

| Hónap | Volume |
|---|---:|
| 2025-08 | 91 |
| 2025-09 | 88 |
| 2025-10 | 72 |
| 2025-11 | 60 |
| 2025-12 | 158 |
| 2026-01 | 67 |
| 2026-02 | 67 |
| 2026-03 | 57 |
| 2026-04 | 59 |
| 2026-05 | 93 |
| 2026-06 | 94 |
| 2026-07 | 38 |
| 2026-08 | 74 |

Sorban: 91, 88, 72, 60, 158, 67, 67, 57, 59, 93, 94, 38, 74.

---

## B) Váll + alkar Semrush HU

Semrush `/keyword_metrics`, country=`HU`. Nincs traffic potential. **Ads HOLD** pending Katák.

| KW | Vol | KD | CPC* | Density | runId |
|---|---:|---:|---:|---:|---|
| befagyott váll | 880 | 12 | 6 | 50 | `01M0ST9XKE8HY4VC81DB7BWAAP` |
| befagyott váll torna | 390 | 9 | 11 | 28 | `01M0ST9Y21YQCPK8Q6JHZ0KM7B` |
| vállfájdalom | 1900 | 28 | 14 | 50 | `01M0ST9Z3ZQEC7KV0B9TN2FE14` |
| alkar fájdalom | 390 | 12 | 14 | 11 | `01M0ST9Z7K6W2PTDC95A6GYDQ9` |
| alkar zsibbadás | 50 | 14 | 5 | 33 | `01M0ST9ZPFQRK18RQEW7HHG771` |

\*Semrush snapshot. Ads HOLD pending Katák. Ads/forecast CPC továbbra is Ahrefs (lásd `docs/ADATOK-mert.md`).

---

## C) Backlinks_overview ROOT_DOMAIN

Semrush `/backlinks_overview`, scope=`ROOT_DOMAIN`.

| Domain | Score | Backlinks | Ref domains | runId |
|---|---:|---:|---:|---|
| gyogytornaszom.hu | 36 | 6636 | 570 | `01M0ST984S82HTFDGQAWK04AD7` |
| fajakezem.hu | 7 | 208 | 108 | `01M0ST9W80SMT98WS3XQ8GC0Q9` |
| kineticare.hu | 2 | 23 | 9 | `01M0ST9X5SBVT2SNX69NFCF2C9` |

---

## D) Tételes autocomplete (teljes)

Strale `/x402/keyword-suggest`, country=`HU`, language=`hu`.

### D1) `ínhüvelygyulladás` (50)

runId: `01M0ST97ZPY5D2SFJB76QGAAR1`. `total_suggestions`: 50.

1. ínhüvelygyulladás
2. ínhüvelygyulladás tünetei
3. ínhüvelygyulladás krém
4. ínhüvelygyulladás kezelése
5. ínhüvelygyulladás gyógyszer vény nélkül
6. ínhüvelygyulladás gyógyulási ideje
7. ínhüvelygyulladás gyógyszer
8. ínhüvelygyulladás rögzítő
9. ínhüvelygyulladás tape
10. ínhüvelygyulladás bno
11. ínhüvelygyulladás angolul
12. ínhüvelygyulladás az ujjakban
13. ínhüvelygyulladás alkar
14. ínhüvelygyulladás az alkarban
15. ínhüvelygyulladás a talpon
16. ínhüvelygyulladás alagút szindróma
17. ínhüvelygyulladás a vállban
18. ínhüvelygyulladás a lábfejen
19. ínhüvelygyulladás a lábon
20. ínhüvelygyulladás antibiotikum
21. ínhüvelygyulladás boka
22. ínhüvelygyulladás borogatás
23. ínhüvelygyulladás bno kód
24. ínhüvelygyulladás bandázs
25. inhüvelygyulladás bokában tünetei *(nyers)*
26. ínhüvelygyulladás bioptron lámpa
27. boka ínhüvelygyulladás kezelése
28. bicepsz inhüvelygyulladás *(nyers)*
29. bemer ínhüvelygyulladás
30. ínhüvelygyulladás csukló
31. ínhüvelygyulladás csukló tünetei
32. ínhüvelygyulladás csuklórögzítő
33. ínhüvelygyulladás csukló kezelése
34. ínhüvelygyulladás csuklószorító
35. ínhüvelygyulladás comb
36. ínhüvelygyulladás csomó
37. inhüvelygyulladás csuklón krém *(nyers)*
38. csukló ínhüvelygyulladás gyógytorna
39. csuklórögzítő ínhüvelygyulladás
40. ínhüvelygyulladás hüvelykujj rögzítő
41. ínhüvelygyulladás hüvelykujj
42. ínhüvelygyulladás hol fáj
43. ínhüvelygyulladás hüvelykujj kezelése
44. ínhüvelygyulladás házi gyógymód
45. ínhüvelygyulladás helye
46. ínhüvelygyulladás hova kell mennem
47. ínhüvelygyulladás hideg vagy meleg
48. ínhüvelygyulladás hideg
49. ínhüvelygyulladás hüvelykujj tape
50. ínhüvelygyulladás wikipedia

### D2) `befagyott váll` (22)

runId: `01M0STA07VXPVRGYP6SB4H2AMV`. `total_suggestions`: 22.

1. befagyott váll szindróma
2. befagyott váll
3. befagyott váll torna
4. befagyott váll kezelése
5. befagyott váll fórum
6. befagyott váll kezelése otthon
7. befagyott vállra kenőcs
8. befagyott váll gyógytorna
9. befagyott váll tünetei
10. befagyott váll torna gyakorlatok
11. befagyott váll akupunktúra
12. befagyott váll angolul
13. befagyott váll adhezív kapszulitisz
14. befagyott váll szindróma angolul
15. befagyott váll kimozgatása altatásban
16. befagyott váll szindróma adhesiv capsulitis
17. befagyott váll szindróma mitől alakul ki
18. befagyott váll bno kód
19. befagyott váll szindróma bno kód
20. befagyott váll csontkovács
21. befagyott váll fájdalom csillapítása
22. befagyott váll homeopátia

### D3) `alkar fájdalom` (21)

runId: `01M0STA06GCYMS11EJNXV1PKF1`. `total_suggestions`: 21.

1. alkar fájdalom
2. alkar fájdalom okai
3. alkar fájdalom lelki okai
4. alkar fájdalom duzzanat
5. alkar fájdalom kezelése
6. alkar fájdalom és zsibbadás
7. alkar fájdalom kinesio tape
8. alkar fájdalom gyakori kérdések
9. alkar fájdalom gyerekeknél
10. alkar fájdalom kezelése házilag
11. fájdalom az alkar belső oldalán
12. alkar fájdalom bno
13. bal alkar fájdalom
14. bal alkar fájdalom okai
15. bal alkar fájdalom lelki okai
16. bicepsz alkar fájdalom
17. belső alkar fájdalom
18. bal alkar fájdalom gyakori kérdések
19. alkar csont fájdalom
20. alkar csukló fájdalom
21. alkar hajlat fájdalom

### D4) `csukló ínhüvelygyulladás` (10)

runId: `01M0STB1Y4FNE3RG3RKQCT2MVT`. `total_suggestions`: 10.

1. csukló ínhüvelygyulladás
2. csukló ínhüvelygyulladás tape
3. csukló ínhüvelygyulladás krém
4. csukló ínhüvelygyulladás kezelése
5. csukló ínhüvelygyulladás torna
6. csukló ínhüvelygyulladás gyógytorna
7. csukló ínhüvelygyulladás műtét
8. csukló ínhüvelygyulladás gyógyszer
9. ínhüvelygyulladás csukló tünetei
10. ínhüvelygyulladás csukló szorító

---

## Következmények

- **Ads spend = 0.** Ez kutatási költség, nem Ads-költés.
- Ínhüvely SERP: Kineticare nincs a HU top 8-ban (webbeteg, BHC, gyorgytea, gov, Sherlock, Medicare, BMM, Házipatika). Rés az otthoni programnak.
- Házilag: Ahrefs volume-history sáv 38–158; H2 a hubon, nem külön slug (`docs/monid-negyedik-kor.md`).
- Váll / alkar: Semrush vol megvan; **Ads HOLD** Katák döntéséig.
- Backlink gap: gyogytornaszom score 36 / 570 domain vs kineticare score 2 / 9 domain.
- Autocomplete szándék: krém / gyógyszer / rögzítő / tape — Ads-negatív (B6); SEO hub/FAQ OK.
