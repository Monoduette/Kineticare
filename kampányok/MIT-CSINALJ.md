# Kineticare — MIT CSINÁLJ (Norbert)

> **2026-08-24 lock (Search peer review):** Hard Ads lander = gyökér hub 200 (nem blog). Szonda: H-TK → H-IH → H-KA. Consent = korlát, nem örök kapu. Váll negatív = HOLD Katákig. Kanonikus számok: `docs/ADATOK-mert.md`. Ship-gate Search: sitemap×2, Person+FAQ, thin tilos, impresszum index.

> **Dátum:** 2026-08-22  
> **Állapot:** stratégia kész a csapattól; **éles Ads = 0**, cutover = te döntöd.  
> **Szabály:** nincs kitalált rangsor / költés / konverzió. Orvosi törzs = Kiss Kata + Kocsis Kata.  
> **Részletek:** a négy mellékelt MD (`strategia-seo-geo-llm`, `strategia-ads`, `strategia-url-matrix`, `strategia-meres`).

---

## A) Amit TE csinálsz most (sorrendben)

### 1. A két Kata — három Cluster A törzs (legfontosabb)

Írd / lektoráld a **három gyökér-hub** szakmai törzsét. Enélkül semmi nem megy ki, Ads sem.

| URL (cél) | Elsődleges kifejezés (mért) | Megjegyzés |
|---|---|---|
| `/keztoalagut-szindroma` | kéztőalagút szindróma (+ **kezelése házilag** H2-ként) | Blogon már van teljes törzs (`/blog/keztoalagut-szindroma`) — átültethető |
| `/inhuvelygyulladas` | ínhüvelygyulladás | **Nincs blog-forrás** — ezt a Katáknak kell megírni (lista: docs/h-ih-kulcsszavak-draft.md; spend csak hub 200 után) |
| `/teniszkonyok` | teniszkönyök (+ otthon / házilag) | Blogon van (`/blog/teniszkonyok`) — átültethető |

**Kötelező a törzsben (Craft/Search):**
- Kérdés-alapú H2-k; az első mondat = válasz (GEO).
- Szerző bio (név, végzettség, praxis) — ma a JSON-LD szerzője „Kineticare”.
- Orvosi disclaimer elöl.
- Zsibbadás-magnál: 112-s figyelmeztetés **elöl** (`bal kéz zsibbadás` + hányinger autocomplete).
- **Nincs** gyógyulás-% , „hetek alatt megszűnik”, „garantált”.
- CTA híd: tünet → **Otthoni KézRehab** (nem az ingyenes SOS mint fő ajtó).

**v1-ben NEM kell külön gyökér:** zsibbadás, pattanó ujj, csukló, gipsz után — ezek blog CEP-ként maradnak.

### 2. Céloldal-ígéret + refund (te + Katák + jog)

Élő Railway `/kezrehab` / Otthoni kurzus:
- „megszüntetheted… akár hetek alatt” → **Unreliable claims** (Ads kapu).
- „30 nap kérdés nélkül visszafizetjük” vs ÁSZF „fizetés után pénzvisszafizetést nem kérhet” → **ellentmondás**, te döntöd.

Amíg ez nincs tisztázva: **Ads költés = 0**.

### 3. Domain-átállás (te döntöd a napot)

Amíg `www.kineticare.hu` = Systeme:
- fizetett kattintás rossz helyre megy,
- saját GSC/GA/PostHog a .hu-n üres.

**A kampány feltétele a cutover** (Monid + Ads lock). A stratégia cutover **nélkül** is kész; az élesítés cutover **után**.

Cutover előtt / közben (Web + te):
- `NEXT_PUBLIC_SERVER_URL` = a nyilvános host (www).
- PostHog + GA kulcs + **teljes rebuild**.
- Adatvédelemben PostHog nevesítve.
- `/kezrehab` és `/kezrelax` 308-at a cutover-listán a kanonikus kurzus-slugra igazítjátok (Ads a **kanonikus** kurzust hirdesse, ne a 308-at).

### 4. GSC + Google Cégprofil (belépés kell)

Konnektor még nincs → te lépsz be:
- Search Console: `sc-domain:kineticare.hu` (DNS), **ne** a Railway hostot a .hu alá.
- Sitemap csak akkor, ha **stabil 200** (ma: curl 200, WebFetch időnként 500 — amíg mindkét út 200, ne küldd).
- Cégprofil: teniszkönyöknek van lokális szándéka; Cégprofil, nem Ads a „közelemben” querykre.

### 5. Amit NE csinálj most

- Ne indíts Google Ads-et / ne költs.
- Ne hirdesd a homepage-et, a `/kezrelax` / SOS-t, a `/blog/…` URL-eket, a `/kosár` / `/pénztár` oldalt.
- Ne írd át te az orvosi törzset a csapattal — a Katák írják.
- Ne ígérj „tökéletes #1 / AI elől” — a doksi checklist + mérés, **nem** garancia.

---

## B) Amit a CSAPAT csinál (te után / mellett)

| Sáv | Feladat | Amikor |
|---|---|---|
| **Web** | 3 A-gyökér Payload page (draft → published); blog→gyökér 308/301 + canonical; `/kapcsolat` canonical; FAQ schema az A-hubokra | Ha kéred / ha a törzs megvan |
| **Search** | Keyword map, kannibalizáció, 25 AI-prompt baseline, cutover SEO checklist | Stratégia kész (`strategia-seo-geo-llm.md`) |
| **Ads** | K1 három ad group draft a fiókban **költés 0**; RSA a tiltásokkal | Csak a kapuk után |
| **Insights** | PostHog baseline; identify (#129); checkout_started élőn; GSC után eligibility | Cutover + kulcsok után |
| **CX** | Hero: Otthoni hangsúlyos, SOS másodlagos; nyelv: „kezelés/alkalom” | CTA/CMS kör |
| **Craft** | Forrásőr + creative ék (ország / azonnal / egyszer / kéznél); műtét-címsor tilos | Ads szöveg előtt |

---

## C) Ads kapuk (mind kötelező, mielőtt 1 Ft)

1. Domain-cutover (www = Railway).
2. Három A-gyökér **HTTP 200**.
3. Consent-split: `ad_storage` / `ad_user_data` / `ad_personalization` csak marketing-igen után (ma: soha nem nyílik).
4. Legalább egy **élő** `checkout_started` vagy megbízható `purchase_confirmed`.
5. Céloldal-ígéret tisztítva (lásd A/2).
6. Blog→gyökér redirect + canonical, mielőtt a gyökeret hirdetitek.

**v1 kampány (ha a kapuk zöldek):** csak **K1** Search — három ad group → három gyökér. Exact + phrase. PMax ki. Keret: a doksi 5 000 Ft/nap **csak javaslat**, nem éles — te döntöd; amíg kapu zárva: **0 Ft**.

---

## D) SEO / GEO / LLM — mit jelent a „tökéletes”

Nem garancia. Siker-definíció a stratégiában:

- **November elejére** a 3 A-hub indexelve a public hoston (januári szezon).
- **Eligibility** (GSC): indexelhető, egy állapot = egy URL, nincs blog+gyökér dupla.
- **GEO:** chunk-önálló bekezdés, FAQPage = látható Q&A, szerző bio, 25 prompt havi minta.
- **Időtáv a doksiból:** tech SEO 2–8 hét; AI-láthatóság **hónapok**.
- `llms.txt` **nem** elsődleges stratégia.

---

## E) Mellékletek (olvasási sorrend)

1. **Ez a fájl** — teendőlista.  
2. `strategia-url-matrix.md` — minden Railway URL státusza.  
3. `strategia-seo-geo-llm.md` — keyword map + oldalankénti SEO/GEO + 25 prompt.  
4. `strategia-ads.md` — kampányarchitektúra, kulcsszavak, RSA, negatívok.  
5. `strategia-meres.md` — PostHog/GA/GSC kapuk és baseline.

Nyers adat továbbra is a repóban: `docs/piaci-strategia.md`, `docs/kulcsszavak.md`, `docs/adwords-kampany.md`, `docs/seo-geo-llm.md`, Monid-doksi.

---

## F) Egy mondatban

**Katák megírják a három A-hubot → te tisztázod az ígéret/refundot → cutover → GSC/Cégprofil → mérés él → csak utána Ads K1.** Addig a stratégia kész, a költés 0.
