# Kineticare — Ads stratégia-váz (költés 0)

> Pillanatkép: 2026-08-22. Forrás: `docs/adwords-kampany.md`, `docs/piaci-strategia.md`, `docs/kampanyterv-mert-adatokbol.md`, `docs/vevohang-es-hirdetesszoveg.md`, szoba-lock. **Nem éles kampány.** Szám csak a doksiból; saját forgalom/CPA nincs.

## 0. Indítási kapuk (mind kötelező)

1. Domain-cutover: `www.kineticare.hu` = Railway Next (Systeme nem fogadhat fizetett kattintást).
2. Cluster A gyökér **200**: `/keztoalagut-szindroma`, `/inhuvelygyulladas`, `/teniszkonyok` (ma: 404).
3. Consent-split: `ad_storage` / `ad_user_data` / `ad_personalization` csak marketing-igen után (ma: soha nem nyílik, `ga4.ts` + `docs/ga4.md`).
4. Importálható konverzió, ami tényleg kimegy: legalább `checkout_started` (vendégre is), ideálisan megbízható `purchase_confirmed` (vendég-lyuk dokumentálva).
5. Céloldal-ígéret tisztítva: `/kezrehab` „megszüntetheted… akár hetek alatt” → Unreliable claims (`adwords-kampany.md` 0.3).
6. Blog→gyökér 308/301 + canonical a gyökéren, mielőtt Ads a gyökeret hirdeti.

**Amíg bármelyik hiányzik: költés = 0.**

## 1. Lander-térkép (lock)

| Cél | Végső URL | Tiltott |
|---|---|---|
| Kéztőalagút + „házilag” | `/keztoalagut-szindroma` | `/blog/keztoalagut-szindroma`, homepage, `/kezrelax` |
| Ínhüvelygyulladás | `/inhuvelygyulladas` | nincs blog-pár (tiszta) |
| Teniszkönyök | `/teniszkonyok` | `/blog/teniszkonyok` |
| Otthoni sitelink / másodlagos | `/kurzusok/otthoni-kezrehab-program` (kanonikus; ne a 308-as `/kezrehab`) | `/kosar`, `/penztar`, `/blog/*` mint fő lander |
| SOS | csak sitelink, nem fő lander | fő RSA cél |
| Pro / akkreditált | `/szakmai-kez-kurzus` (ma 404) — család nem indul | ProBody idegen domain Ads-ből |
| Rendelő | `/szolgaltatasok` | `/rendeloi-kezelesek` |

Sitelinkek (ha élnek): Otthoni kurzus · SOS · A-hub · /rolunk · /kapcsolat · /blog (csak tartalom, nem Ads-vég).

## 2. Fiókszerkezet (Search only)

PMax / Display / partnerhálózat: **ki** (kis keret + nincs konverziós tanulás).

| Kód | Kampány | Ad groupok | Lander |
|---|---|---|---|
| **K1** | Tünet / A-hub (laikus) | H-KA kéztőalagút · H-IH ínhüvely · H-TK teniszkönyök | a három gyökér |
| **K2** | Otthoni (márka + termék, később) | M1a Kineticare · Otthoni KézRehab | `/kurzusok` / Otthoni kanonikus |
| **K3** | Pro (vár) | akkreditált / kredit / workshop | csak ha `/szakmai-kez-kurzus` 200 |

v1-ben **csak K1** indulhat a három A-oldal után. H1 zsibbadás / H3 pattanó / H4 csukló / H5 gipsz: **v1-ben nincs** külön gyökér → nem külön ad group (Search lock: CEP a hubon / blogon, nem Ads-lander).

### 2.1 Kulcsszavak (exact + phrase; nincs broad induláskor)

Forrás: `adwords-kampany.md` 3.2–3.6 mért Ahrefs HU. CPC = doksi súlyozott becslés, nem aukciós tény.

**H-KA → `/keztoalagut-szindroma`**
- `[kéztőalagút szindróma]`, `"kéztőalagút szindróma kezelése"`, `"kéztőalagút szindróma kezelése házilag"`, `[kéztőalagút szindróma torna]`, `"alagút szindróma gyógytorna"`
- Súlyozott CPC doksi: ~979 Ft (3.2)

**H-IH → `/inhuvelygyulladas`** (legnagyobb lyuk, 7.3: 2200+1300)
- Exact/phrase a Monid ínhüvely-fürtre, amint a hub + Kulcsszó-tábla a `kulcsszavak.md` / matching-terms alapján lezárul. **Indulás előtt a pontos listát a nyers Monid-sorból kell kimásolni** — itt nem találok ki sort.

**H-TK → `/teniszkonyok`**
- `[teniszkönyök]`, `[teniszkönyök kezelése]`, `[teniszkönyök kezelése otthon]`, `"teniszkönyök gyakorlatok"`, `[könyökfájdalom]`
- Súlyozott CPC doksi: ~315 Ft (3.6) — legolcsóbb mért csoport

Egyezés: csak `[pontos]` + `"kifejezés"`. Széles: tilos, amíg nincs konverziós jel (`adwords` 3.0).

## 3. RSA váz (nem gyógyítunk)

Tiltott: meggyógyítjuk, garantált, 93%, 5–8 alkalommal, klinikai arány (`vevohang` 4, `adwords` 1.3 / 5.1).

Átvehető ék (mért negatívokból): nincs időpont · otthon / utazás nélkül · egyszer fizetsz, nincs bérlet · korlátlan visszanézés · 50+ videós gyakorlat · „hiábavaló otthoni kezelés után” → vezetett sorrend.

Címsor-példa (max 30 kar., tegezés):
- `Kéztőalagút: mit tehetsz`
- `Kezelés házilag: torna`
- `Nem kell időpontot kérned`
- `Otthonról, utazás nélkül`
- `Mikor fordulj orvoshoz?`

Leírás-példa: „Kézrehabilitációs gyógytornászok otthoni programja. Nincs időpont, nincs utazás.” — eredmény-ígéret nélkül.

## 4. Negatívok (röviden)

Teljes lista: `adwords-kampany.md` 4.2–4.4 (KIN-alap). Kötelező blokkok:
- állás / képzés / továbbképzés
- műtét ára / sebész / magánklinika (H5 kivétel: „műtét után” ott marad — v1-ben H5 nincs)
- termék (krém, sín, pánt, webshop)
- váll / befagyott váll (termék nem fedi)
- stroke / hányinger / mellkasi a zsibbadás-csoporton (v1-ben ha nincs H1, a hub-cikk FAQ-ja kezeli)
- `ingyen` **nem** fiók-negatív (SOS sitelink); SOS mégsem fő lander

Magyar ragozás: `műtét` ≠ `műtétet` — külön sorok.

## 5. Keret

A doksi javaslat (`adwords` 8.3): napi 5 000 Ft / havi ~152 000 Ft (K1 3000 + K2 1500 + M1 500), Ahrefs CPC-vel. **Ez nem éles költés és nem előrejelzés** — Norbert döntése. Minimális értelmes: 8.5 szerinti 2 000 Ft/nap. Amíg a kapuk zárva: **0 Ft**.

Nullszaldó küszöb a doksiban (8.4): 79 500 Ft bruttó / AAM vagy 27% áfa — **küszöb, nem prognózis**; saját vásárlási arány nincs.

## 6. Mérés (Ads nézet)

- Google Ads: kattintás + költség + keresési kifejezés. Konverzió-import várhatóan vak (`ad_*` denied + <700 katt/7 nap).
- Igazság: PostHog `utm_*` + `checkout_started`; CPA nevező = Payload rendeléslista, nem csak `purchase_confirmed` (vendég-lyuk).
- AI-referral / GSC: Insights sáv; Ads nem helyettesíti.

## 7. Sorrend

1. Kapuk (0.)
2. K1 három ad group, egy RSA/csoport, exact+phrase, KIN-negatívok
3. 7 nap: keresési kifejezések + tényleges CPC vs Ahrefs
4. 30 nap: Payload CPA; csak ezután keret / Max. konverzió
5. K2 márka / K3 pro később
6. PMax soha az első hullámban

## 8. Mit NEM tartalmaz ez a váz

Éles fióképítés, költés, orvosi szöveg, kitalált volumen/CPA, `/blog/` mint Ads-vég, Railway stagingre hirdetés.
