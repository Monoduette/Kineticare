# Kineticare — Ads stratégia (v1 = K1 Search)

> **Dátum:** 2026-08-22  
> **Állapot:** stratégia. **Éles költés = 0**, amíg a kapuk zárva.  
> **Forrás:** `docs/adwords-kampany.md` (2026-08-21, mért karakterszám), `docs/piaci-strategia.md`, `docs/vevohang-es-hirdetesszoveg.md`, `MIT-CSINALJ.md`.  
> **Ez nem orvosi tartalom.** A RSA-k a doksiból másolt, mért karakterszámú sorok. Ínhüvely-csoportra a doksi **nem** adott RSA-t, mert nincs céloldal — ide nem találunk ki szöveget.

A teljes fiókterv a `docs/adwords-kampany.md`-ben három kampány (K1+K2+M1) és öt K1-es ad group. A briefing **szűkít**: v1-ben csak **K1 Search, három ad group → három gyökér**. Ez a fájl azt a szűkítést viszi, és megmondja, mi marad a doksiban tartaléknak.

---

## 0. Kapuk — 1 Ft előtt mind kötelező

`MIT-CSINALJ.md` C + `docs/adwords-kampany.md` 0. fejezet:

1. Domain-cutover (`www` = Railway). Systeme-en nincs PostHog/GA/consent/cikk.
2. Három A-gyökér **HTTP 200**.
3. Consent-split: `ad_storage` / `ad_user_data` / `ad_personalization` csak marketing-igen után. **Ma soha nem nyílik** (`docs/ga4.md` 3; `src/lib/analytics/ga4.ts` `CONSENT_MODE_GRANTED` csak `analytics_storage`).
4. Legalább egy **élő** `checkout_started` vagy megbízható `purchase_confirmed` (kódbeli eseménynevek: `src/lib/analytics/posthog.ts`).
5. Céloldal-ígéret tisztítva (lásd 1. szakasz).
6. Blog→gyökér redirect + canonical, mielőtt a gyökeret hirdetitek.

A Google konverzió-modellezési küszöbe: **7 nap alatt 700 hirdetéskattintás** domain × ország. A doksi 8. fejezet mért keretéből 7 nap alatt **48–83 kattintás** jönne össze — egy nagyságrenddel kevesebb. **Következmény:** a Google Ads felület konverziója vak marad ezen a kereten; a mérés PostHog + UTM (`docs/adwords-kampany.md` 0.2).

---

## 1. Céloldal — két blokkoló mondat (nem Ads-szöveg)

A `src/scripts/restore-legacy-content.ts` `kezrehabLongDescription` ma: „amivel **megszüntetheted vagy jelentősen enyhítheted** a csukló-, ujj-, alkar- és könyökfájdalmakat, **akár hetek alatt**”. Ez a Google „Unreliable claims” szabálya alá esik, és a **céloldalra is** vonatkozik (`docs/adwords-kampany.md` 0.3).

Refund: élő ígéret „30 nap kérdés nélkül visszafizetjük” vs ÁSZF: „Fizetés után a Vásárló pénzvisszafizetést nem kérhet” (`src/lib/legal-source/aszf.txt`). `MIT-CSINALJ.md` A/2: **ellentmondás, tulajdonosi döntés**. Amíg nyitva: költés 0.

A mondat átírása felület — `.claude/skills/termektervezes` hatálya; **ebben a PR-ben nem nyúlunk hozzá**.

---

## 2. v1 architektúra

| | Döntés | Honnan |
|---|---|---|
| Típus | Search only. Display-partner, keresési partner, **PMax ki**. | `docs/adwords-kampany.md` 2.3; `MIT-CSINALJ.md` C |
| Kampány | **K1** egy kampány, három ad group | Briefing (a doksi K1-je öt group + külön K2/M1) |
| Egyezés | Exact + phrase. Broad induláskor **tilos** (nincs konverziós jel a smart biddinghez) | Ads-doksi 3.0 |
| Hely | Magyarország, jelenlét (nem érdeklődés) | Ads-doksi 2.3 |
| Nyelv | magyar | uo. |
| Licit | Kattintások maximalizálása + max. CPC; tCPA csak 30+ mért konverzió után | uo. |
| Automatikus címkézés | BE (gclid) | uo. |
| UTM | kötelező minden végső URL-en | Ads-doksi 9.3 |
| Nyelv a RSA-ban | tegezés; nincs felkiáltójel a címsorban | Ads-doksi 1.3 |

### 2.1 Három ad group → három gyökér

| Ad group | Végső URL (kanonikus) | Mért vezérkifejezés | Doksibeli pár |
|---|---|---|---|
| AG1 Kéztőalagút | `/keztoalagut-szindroma` | kéztőalagút szindróma 1 200/hó (Ahrefs); 3 600/hó (piaci doksi) | H2 |
| AG2 Ínhüvelygyulladás | `/inhuvelygyulladas` | klaszter 2 200+1 300; `csukló ínhüvelygyulladás` 480 | T1 — **draft a fiókban, költés 0, amíg a hub 200** |
| AG3 Teniszkönyök | `/teniszkonyok` | teniszkönyök 3 500/hó | K2a — a doksiban **külön kampány**, mert a 3 500-as volumen felszívná a kéz-keretet (2.1). v1-ben egy kampányban van: a napi keretet **te** állítod, vagy AG3-at külön kampányba emeled, ha az aukció elnyomja AG1–2-t. |

**Amit v1-ben szándékosan nem indítunk** (a doksi mért, de a briefing kihagyja):

| Doksibeli group | Miért nem v1 Ads |
|---|---|
| H1 Zsibbadás | CEP marad; 112-s queryk; CPC $4,46 / 1 404 Ft |
| H3 Pattanó ujj | CEP; a doksi szerint olcsó ($1,35) — tartalék, nem v1 |
| H4 Csukló/kéz | CEP |
| H5 Törés/gipsz | CEP; drága „gyógyulási idő” sorok szüneteltetve a doksiban |
| M1 Márka | Nincs mért volumen; v1 után, ha a hirdetések kint vannak |
| T2 Váll | Termék nem fedi |
| PMax / Demand Gen / Display | Briefing: ki |

---

## 3. Kulcsszavak (másolat a mért táblákból)

Jelölés: `[pontos]` · `"kifejezés"`. CPC: Ahrefs, HU, 2026-08-21, 1 USD = 314,74 Ft (MNB 2026-08-19) — `docs/adwords-kampany.md` 1.1. **Aukciós tény nincs.**

### AG1 — Kéztőalagút (`docs/adwords-kampany.md` 3.2)

| Kulcsszó | Egyezés | Ker./hó | KD | CPC ($) |
|---|---|---:|---:|---:|
| kéztőalagút szindróma | `[…]` + `"…"` | 1 200 | 5 | 3 |
| kéztőalagút szindróma kezelése | `"…"` | 150 | 12 | 3 |
| kéztőalagút szindróma tünetei | `"…"` | 90 | 12 | 1 |
| kéztőalagút szindróma torna | `[…]` + `"…"` | 70 | **0** | **8** |
| kéztőalagút szindróma kezelése házilag | `"…"` | autocomplete | — | — |
| kéztőalagút szindróma mitől alakul ki | `"…"` | autocomplete | — | — |
| alagút szindróma gyógytorna | `"…"` | autocomplete | — | — |

Volumen-súlyozott CPC a mért sorokból: **$3,11 = 979 Ft**.

### AG2 — Ínhüvelygyulladás

A doksi **nem** közöl kulcsszó-táblát, csak a klaszterösszeget (2 200+1 300) és a `csukló ínhüvelygyulladás` 480-at. **Nem találunk ki** további volume/CPC sort. Induláskor (hub 200 után): a diagnózisnév exact+phrase + a 480-as alak; a Search terms report tölti a listát. Amíg nincs törzs: a group a fiókban **paused**, költés 0.

### AG3 — Teniszkönyök (`docs/adwords-kampany.md` 3.6)

| Kulcsszó | Egyezés | Ker./hó | KD | CPC ($) |
|---|---|---:|---:|---:|
| teniszkönyök | `[…]` + `"…"` | 3 500 | 13 | 1 |
| teniszkönyök kezelése | `[…]` + `"…"` | 800 | 21 | 1 |
| teniszkönyök kezelése otthon | `[…]` + `"…"` | 400 | **4** | 1 |
| teniszkönyök tünetei | `"…"` | 350 | 0 | 1 |
| könyökfájdalom | `[…]` + `"…"` | 700 | **0** | 1 |
| teniszkönyök gyógytorna | `[…]` + `"…"` | 210 (Semrush) | — | 0,17 (Semrush) |
| teniszkönyök kezelése házilag | `"…"` | autocomplete | — | — |
| teniszkönyök gyakorlatok | `"…"` | autocomplete | — | — |

Volumen-súlyozott CPC: **$1,00 = 315 Ft**. Lokális szándékot az első 30 nap Search termséből szűrünk — **nem** vesszük fel előre városnevet negatívnak (`docs/adwords-kampany.md` 4.5).

---

## 4. Negatívok (a doksi listája, v1-re)

A negatív **nem** fedi a ragozott alakot — a magyar ragot külön kell felvenni (`docs/adwords-kampany.md` 4.1). A teljes „KIN-alap” lista a doksi 4.2-ben van; itt a v1-hez kötelező mag:

**Fiókszint:** állás/képzés; krém/sín/pánt/webshop; BNO/fordítás/táppénz; láb/térd/hát/váll (váll szándékos elengedés); stroke/gyerek/állat; lelki/homeopátia; torrent/pdf. Az `ingyen` **nincs** a listán — a SOS termék miatt (doksi 4.2 G).

**K1 kampány:** `műtét ára`, sebész, magánklinika, „műtét menete” (4.3).

**AG1 és AG3 group-szint:** `műtét` + ragozott alakok, `operáció` — a SERP műtéti. (A doksi H5-nél a `műtét után` bent marad; az a group nem v1.)

**AG3 extra (doksi K2a):** `golfkönyök`, `bandázs`, `pánt`, `csontkinövés` — mért autocomplete, más szándék.

---

## 5. RSA — csak ahol a doksi adott szöveget

Karakterkorlát: címsor 30, leírás 90; ékezet = 1 karakter. Csoportonként két RSA: egyik pin nélkül, a másik **1. címsor-pozícióra rögzítve** a tünet-sort (`docs/adwords-kampany.md` 5.2).

**Tilos a RSA-ban és a címsorban:** gyógyulás-%, időtávos megszűnés, „garantált”, műtét mint ígéret, felkiáltójel (`MIT-CSINALJ.md` B Craft; ads 1.3 / 5.1). Átvesszük a versenytárs formulájából a tünetet, a sürgősséget („ma este el tudod kezdeni”), a termék-számot (50+ videó — **termékadat**, nem klinikai %), az akadály elhárítását. **Nem** vesszük: „5–8 alkalommal”, „93%”.

### AG1 — Kéztőalagút (doksi H2, másolat)

Címsorok: `Kéztőalagút: mit tehetsz` (24) · `Kéztőalagút-szindróma torna` (27) · `Otthoni torna műtét előtt` (25) · `Alagút szindróma otthon` (23) · `Gyakorlatok gyógytornásztól` (27) · `Konzervatív kézgyakorlatok` (26) · `Nem kell időpontot kérned` (25) · `Otthonról, utazás nélkül` (24) · `Kezdd el a saját tempódban` (26) · `Egyszer fizetsz, nincs bérlet` (29) · `Korlátlanul újranézheted` (24) · `50+ videós gyakorlat` (20) · `Kézrehab gyógytornászoktól` (26) · `Mikor fordulj orvoshoz?` (23) · `Ingyenes kezdő gyakorlatok` (26).

Leírások: kutatás sínről/tornáról/műtétről (78) · otthoni program, nincs időpont (80) · egyszer fizetsz (75) · mit tehetsz otthon, mikor szakember (70).

Megjelenítési útvonal: `kezrehab` / `keztoalagut` (doksi 5.4).

### AG3 — Teniszkönyök (doksi K2, másolat)

Címsorok: `Teniszkönyök: mit tehetsz` (25) · `Teniszkönyök kezelése otthon` (28) · `Fáj a könyököd emelésnél?` (25) · `Teniszkönyök gyakorlatok` (24) · + a közös blokk (gyógytornász, nincs időpont, utazás nélkül, saját tempó, egyszer fizetsz, korlátlan, 50+, Mikor fordulj orvoshoz?, ingyenes kezdő).

Leírások: mitől alakul ki, mit kezdj otthon (78) · otthoni program (80) · egyszer fizetsz (75) · alkar/csukló/könyök videók (74).

Útvonal: `kezrehab` / `teniszkonyok`.

### AG2 — Ínhüvelygyulladás

**Nincs RSA a doksiban.** A Craft sáv a törzs után írja, ugyanazzal a tiltólistával. Addig a group paused.

---

## 6. Keret — javaslat, nem éles

A doksi **három kampányának** összege: **5 000 Ft/nap ≈ 152 000 Ft/hó**, várható **210–360 kattintás/hó** (K1 3 000 + K2 1 500 + M1 500). Max. CPC-korlát a doksiban: K1 1 200 Ft, K2 500 Ft, M1 150 Ft.

A briefing: ez **csak javaslat**; amíg kapu zárva: **0 Ft**; a napi keretet a tulajdonos dönti.

v1 (három group egy Search-kampányban) **nincs külön mért keretsora** a doksiban. Ha a 3 500-as teniszkönyök egy kampányban van a kéztőalagúttal, a doksi 2.1 szerint felszívhatja a keretet — ezt vagy külön kampánnyal, vagy AG-szintű figyelemmel kell kezelni. **Nem találunk ki** v1-specifikus napi Ft-ot.

Nullszaldó-küszöb a doksi 8.4-ből (teljes 152k Ft/hó keretre, nem előrejelzés): Otthoni program **79 500 Ft** bruttó a `restore-legacy-content.ts` szerint; 1,91 eladás/hó (AAM) vagy 2,43 (27% áfa). **Nincs mért konverziós arány.**

---

## 7. Amit a hirdetés állít — mért vevőhang, nem klinika

`docs/vevohang-es-hirdetesszoveg.md` / ads 1.2: a negatív Maps-vélemények **nem** a szakmát bírálják, hanem az elérést, az árat, a bérletet. A RSA ezt a hiányt nevezi meg: nincs időpont, nincs utazás, egyszer fizetsz, korlátlanul újranézed.

A versenytárs „93% / 5–8 alkalom” formulája náluk bevált, nálunk **tilos** (klinikai állítás + a mért visszajelzés pont ezen bukott).

Váll kimarad: a termék „csukló-, ujj-, alkar- és könyökfájdalmakra” szól (`docs/adwords-kampany.md` 1.3).

---

## 8. Fiókbeli draft (költés 0)

A csapat Ads sávja (`MIT-CSINALJ.md` B): a három ad group **létrehozható** paused kampányként, RSA a tiltásokkal, negatív lista feltöltve. Kampány státusz: szüneteltetve. Napi keret: 0 vagy a platform minimuma paused mellett — **ne** legyen enabled.

Élesítés: kapuk zöldek + tulajdonosi döntés a keretről + a céloldal-ígéret/ÁSZF rendben.
