# Kineticare — Ads stratégia-váz (költés 0)

> Pillanatkép: **2026-08-24** (felülírva Search peer review + audit lock után; előző: 2026-08-22).  
> Forrás: `docs/ADATOK-mert.md`, `docs/h-ih-kulcsszavak-draft.md`, `docs/monid-negyedik-kor.md`, `docs/adwords-kampany.md`, szoba-lock. **Nem éles kampány.**  
> Szám csak mért doksiból; saját forgalom/CPA nincs. **Spend = 0**, amíg a hard kapuk zárva.

## 0. Kapuk vs korlátok (lock 2026-08-24)

### Hard kapuk (mind kötelező → különben spend 0)

1. Domain-cutover: `www.kineticare.hu` = Railway Next (Systeme nem fogadhat fizetett kattintást).
2. Cluster A **gyökér hub 200** (nem `/blog/`): `/keztoalagut-szindroma`, `/inhuvelygyulladas`, `/teniszkonyok`.
3. Importálható / saját stack konverzió, ami tényleg kimegy: legalább `checkout_started` (vendégre is); ideálisan megbízható `purchase_confirmed`.
4. Céloldal-ígéret tisztítva: `/kezrehab` „megszüntetheted… akár hetek alatt” → Unreliable claims (`adwords-kampany.md` 0.3).
5. Blog→gyökér 308/301 + canonical a gyökéren, mielőtt Ads a gyökeret hirdeti.
6. Search hard gate (külön sáv): sitemap **200 mindkét úton** + GSC property — Ads nem helyettesíti.

### Korlátok (nem örök időzár)

- **Consent / `ad_*`:** `ad_storage` / `ad_user_data` / `ad_personalization` csak marketing-igen után. Ez **Ads minőségi korlát**, nem „soha nem nyílik → ne tervezz” hard gate. Jogi/tulajdonosi döntés nélkül **ne** nyissuk ki. Enhanced conversions / first-party event addig is. Google modellezés (7 nap / ~700 katt) a 5k Ft/nap keretből hónapokig vak lehet — **ne várjunk modellezésre** kapuként.
- Blog mint Ads-lander: **tilos** (mindig).

**Amíg bármely hard kapu hiányzik: költés = 0.** Consent hiánya = korlátozott tanulás, nem automatikus „stratégia leáll”.

## 1. Lander-térkép (lock)

| Cél | Végső URL | Tiltott |
|---|---|---|
| Kéztőalagút + „házilag” | `/keztoalagut-szindroma` | `/blog/keztoalagut-szindroma`, homepage, `/kezrelax` |
| Ínhüvelygyulladás | `/inhuvelygyulladas` | nincs blog-pár; **nem** blog-lander |
| Teniszkönyök | `/teniszkonyok` | `/blog/teniszkonyok` |
| Otthoni sitelink / másodlagos | `/kurzusok/otthoni-kezrehab-program` (kanonikus; ne a 308-as `/kezrehab`) | `/kosar`, `/penztar`, `/blog/*` mint fő lander |
| SOS | csak sitelink, nem fő lander | fő RSA cél |
| Pro / akkreditált | `/szakmai-kez-kurzus` (ma 404) — család nem indul | ProBody idegen domain Ads-ből |
| Rendelő | `/szolgaltatasok` | `/rendeloi-kezelesek` |

**Hard lander = gyökér hub HTTP 200.** `/blog/` soha nem Ads-vég.

## 2. Fiókszerkezet (Search only)

PMax / Display / partnerhálózat: **ki**.

| Kód | Kampány | Ad groupok | Lander |
|---|---|---|---|
| **K1** | Tünet / A-hub (laikus) | H-TK · H-IH · H-KA (lásd szonda-sorrend) | a három gyökér |
| **K2** | Otthoni (márka + termék, később) | M1a Kineticare · Otthoni KézRehab | `/kurzusok` / Otthoni kanonikus |
| **K3** | Pro (vár) | akkreditált / kredit / workshop | csak ha `/szakmai-kez-kurzus` 200 |

H1 zsibbadás / H3 pattanó / H4 csukló / H5 gipsz: **v1-ben nincs** külön gyökér → nem külön ad group.

### 2.0 Szonda-sorrend (lock 2026-08-24) — K2→H-IH→K1 jelentése

A audit/Search sorrend a **tünet-AG-kre** értendő (nem a fenti K2 márka-kampányra):

1. **H-TK (teniszkönyök)** először — legalacsonyabb mért CPC (~315 Ft), nagy volumen, blog-törzs átemelhető a gyökér hubra.  
2. **H-IH (ínhüvely)** — paused struktúra + lista OK lander 200 előtt; **spend csak** `/inhuvelygyulladas` 200 után. Nem „vár a cikkre” blokk a *listára*.  
3. **H-KA (kéztőalagút)** — drágább / nagyobb CPC-szórás; harmadik.

Márka **K2** kampány és Pro **K3**: továbbra is később.

### 2.1 Kulcsszavak (exact + phrase; nincs broad)

Forrás: `docs/ADATOK-mert.md` + `docs/h-ih-kulcsszavak-draft.md`. CPC Ads-tervezéshez: **Ahrefs**; Semrush = szándékjelzés, nem forecast.

**H-TK → `/teniszkonyok`** (első szonda)
- `[teniszkönyök]`, `[teniszkönyök kezelése]`, `[teniszkönyök kezelése otthon]`, `"teniszkönyök gyakorlatok"`, `[könyökfájdalom]`
- Súlyozott CPC doksi: ~315 Ft

**H-IH → `/inhuvelygyulladas`** (paused OK; spend hub 200 után)
- Teljes lista: `docs/h-ih-kulcsszavak-draft.md` (2026-08-24). Vezér: `[ínhüvelygyulladás]` Ahrefs vol 2200 CPC **$1**; `csukló ínhüvelygyulladás` CPC **$3**; De Quervain **nem** külön AG (H2 a hubon).
- Licit sáv lock: **$1–4** Ahrefs. Semrush „házilag” 1300 vs Ahrefs 80 — nagyságrend-eltérés; licit ne Semrush vol-ra.
- ~~„Indulás előtt a pontos listát még ki kell másolni / itt nem találok ki sort”~~ — **felülírva:** a lista megvan.

**H-KA → `/keztoalagut-szindroma`**
- `[kéztőalagút szindróma]`, `"kéztőalagút szindróma kezelése"`, `"kéztőalagút szindróma kezelése házilag"`, `[kéztőalagút szindróma torna]`, `"alagút szindróma gyógytorna"`
- Súlyozott CPC doksi: ~979 Ft — harmadik szonda

Egyezés: csak `[pontos]` + `"kifejezés"`. Széles: tilos, amíg nincs konverziós jel.

## 3. RSA váz (nem gyógyítunk)

Tiltott: meggyógyítjuk, garantált, 93%, 5–8 alkalommal, klinikai arány.

Átvehető ék: nincs időpont · otthon / utazás nélkül · egyszer fizetsz · korlátlan visszanézés · 50+ videós gyakorlat · „hiábavaló otthoni kezelés után” → vezetett sorrend.

## 4. Negatívok (röviden)

Teljes lista: `adwords-kampany.md` 4.2–4.4 (KIN-alap). Kötelező blokkok:
- állás / képzés / továbbképzés
- műtét ára / sebész / magánklinika (H5 kivétel: v1-ben H5 nincs)
- termék (krém, sín, pánt, webshop) — **Ads negatív**; SEO-ban megválaszolható (explicit döntés)
- stroke / hányinger / mellkasi a zsibbadás-csoporton
- `ingyen` **nem** fiók-negatív (SOS sitelink)

### Váll / nyak / gerinc (lock 2026-08-24)

**Hold.** Nem kerülnek fiókszintű negatívba Katák döntése előtt. A hosszú tananyagleírás említi a váll / háti / nyaki gerincet; a rövid leírás nem.  
Ha Katák: váll **benne** van a termékben → külön SEO hub-jelölt + későbbi AG (`befagyott váll` stb.).  
Ha **nincs** → termékcopy igazítás, *azután* negatív. Addig: ne csendes kizárás.

## 5. Keret

Doksi javaslat: napi 5 000 Ft / havi ~152 000 Ft — **nem éles költés**. Amíg a hard kapuk zárva: **0 Ft**.

## 6. Mérés (Ads nézet)

- Google Ads: kattintás + költség + keresési kifejezés. Konverzió-import consent nélkül korlátozott; modellezés vak lehet.
- Igazság: PostHog `utm_*` + `checkout_started`; CPA nevező = Payload rendeléslista.
- AI-referral / GSC: Insights / Search sáv; Ads nem helyettesíti.

## 7. Sorrend (felülírva)

1. Hard kapuk (0.) + Search ship-gate
2. **H-TK** ad group + RSA, exact+phrase, KIN-negatívok (váll hold)
3. **H-IH** paused struktúra; spend csak hub 200 után
4. **H-KA** harmadik
5. 7 nap: keresési kifejezések + tényleges CPC vs Ahrefs
6. 30 nap: Payload CPA; csak ezután keret / Max. konverzió
7. Márka K2 / Pro K3 később
8. PMax soha az első hullámban

## 8. Mit NEM tartalmaz ez a váz

Éles fióképítés, költés a kapuk előtt, orvosi szöveg, kitalált volumen/CPA, `/blog/` mint Ads-vég, `ad_*` jogi nélkül „csak úgy” kinyitása, Railway stagingre hirdetés.
