# E2E-audit terv — white/blackhat, DevOps, lead eng, a11y, UX

**Dátum:** 2026-08-27. **Cél:** a Bunny → vásárlás/ingyenes → levél → belépés →
Kurzusaim → lejátszó lánc, plusz a fizetés és a számlázás, több szemszögből
tönkretehető-e, és ami elromlik, az dokumentálva és javítva legyen.

Ez **terv**, nem jelentés. A jelentés a mérés után: `docs/e2e-audit-2026-08-27.md`.

A plan-fájlt (`kurzusvide_l_nc_*.plan.md`) nem szerkesztjük.

## 0. Amit nem csinálunk (TILOS)

- Exploit, exploit-PoC, malware, támadási eljárás — még „saját demo”-ra sem.
- `confirmOrder` hívás, import, „javítás”.
- Kézi migráció-írás, access-szabály átírása merge nélkül.
- Titok a gitbe / chatbe. `.env*` olvasása tilos.
- Éles Barion-fizetés. A demo `api.test.barion.com` — csak sandbox kártya.
- A kötet nélküli régi `Postgres` újraindítása.

A blackhat-szem **védelmi próbákat** jelent: 401/403, enumeráció, GUID-szivárgás,
CSRF same-origin, lejárt hozzáférés. Nem payloadot írunk.

## 1. A lánc, amit végigjárunk

```
Bunny tár (GUID)
  → CMS Tananyag (modulok)
  → nyilvános /kurzusok/{slug}
  → fizetős: /penztar → Barion sandbox → callback → paid
     vagy ingyenes: űrlap → purchases
  → users.purchases + accessGrants
  → e-mail (jelszó / belépés)   [ops: domain pending]
  → /belepes?returnUrl=/kurzusaim
  → fejléc Kurzusaim
  → /kurzusaim lista
  → /kurzusaim/{id} lejátszó
  → GET /api/stream-token
  → Bunny iframe jegy
  → haladás 90% / Kész, tovább
```

Párhuzamos igazság: `orders` (pénz/számla) ≠ `purchases` (SKU) ≠
`accessGrants`+`accessDurationDays` (óra).

## 2. Szemszögek és kiosztás

| Szem | Mit keres | Hogyan | Ki |
| ---- | --------- | ------ | -- |
| **Whitehat / AppSec** | Paywall, token, CSRF, enumeráció, GUID az RSC-ben, IDOR a lejátszón | Defenzív HTTP + kódolvasás, nem exploit | szülő + security-review (explicit kérés) |
| **Blackhat (védelmi)** | Ugyanaz, mint a támadó próbálna: jegy nélkül iframe, idegen productId, idegen fiók grant, callback hamisítás **nélkül** (csak hogy a saját állapotgép elutasítja-e) | 401/403/anti-enum mérés | szülő, demo host |
| **DevOps** | Env, rebuild vs redeploy, migrate a startban, healthcheck, Resend domain, job worker | Railway CLI + start-log | szülő |
| **Lead eng** | Állapotgép, három igazság, confirmOrder-tiltás, haladás `ref`, race | kód + kineticare-bugbot a `main`-re | bugbot + szülő |
| **Accessibility** | WCAG 2.2: 1.4.3, 2.4.11, 2.5.8, 3.2.4, 1.3.1, 2.1.1, 4.1.2; fókusz, érintőcél, reflow 320 | böngésző + komponens-teszt | a11y ügynök + szülő |
| **UX lead** | Vendég vs belépett köszönő, jelszó után Kurzusaim, ingyenes 3 ág, magyar mikroszöveg, egy CTA | termektervezés-skill + élő HTML | UX ügynök + szülő |

Párhuzam: egyszerre ~2 ügynök (üzemeltetési tanulság 17). A többi sorban.

## 3. Forgatókönyvek (mérés, nem vélemény)

### 3.1 Paywall és jegy

| ID | Próba | Várt |
| -- | ----- | ---- |
| P1 | `GET /api/stream-token` süti nélkül | 401, magyar |
| P2 | Belépett, nem-vevő, létező productId+GUID | 403, ugyanaz a szöveg, mint nem létezőnél |
| P3 | Belépett vevő, kész lecke | 200, `token` + `expiresAt`, embed a védett libraryn |
| P4 | Nyilvános `/api/products` | nincs `streamAssetId` |
| P5 | `/kurzusaim/{id}` nem-vevő RSC | GUID nincs a HTML-ben |
| P6 | Jegy nélkül `iframe.mediadelivery.net/embed/469119/{guid}` | Bunny nem játszik (token BE) |

### 3.2 Auth és Kurzusaim

| ID | Próba | Várt |
| -- | ----- | ---- |
| A1 | `/kurzusaim` kilépve | 307 → `/belepes?returnUrl=/kurzusaim` |
| A2 | Belépve lista | csak `purchases` SKU-k; Kezdés/Folytatás/Újranézés |
| A3 | Fejléc | Belépés vs Kurzusaim+Kijelentkezés |
| A4 | Jelszó-reset után | „Új jelszó beállítva” + Kurzusaim, nem üres `returnUrl` |

### 3.3 Fizetés (csak sandbox)

| ID | Próba | Várt |
| -- | ----- | ---- |
| F1 | Belépett vétel, tesztkártya `4444 8888 8888 5559` | `/fizetes/koszonom` + paid + purchases |
| F2 | Vendég vétel | cím: „A visszaigazolás e-mailben érkezik”; nem „Nem látjuk…” |
| F3 | Callback payload önmagában | nem `paid` GetPaymentState nélkül |
| F4 | `confirmOrder` a kódban | nincs hívás (statikus + teszt) |

### 3.4 Ingyenes kurzus

| ID | Próba | Várt |
| -- | ----- | ---- |
| I1 | Új e-mail, kilépve | HTTP `{ ok: true }`; UI postaláda; grant a fiókon |
| I2 | Belépett saját e-mail | `next: library`; nincs új token |
| I3 | Aktivált idegen, kilépve | nincs grant; levél: lépj be |
| I4 | Owner/staff | `blocked` |

### 3.5 Számla

| ID | Próba | Várt |
| -- | ----- | ---- |
| S1 | paid után | invoice-issue job, `szamlaKulsoAzon` = rendelésszám |
| S2 | Tesztből háló | nincs valódi Számlázz-hívás |

### 3.6 Szerkesztői / lejátszó él

| ID | Próba | Várt |
| -- | ----- | ---- |
| E1 | `processing` + GUID | „Hamarosan”, nincs jegy |
| E2 | Kész, üres hossz | lejátszás indul, jegy ≤ 24 ó |
| E3 | Publikus GUID védett leckében | jegy készül, videó némán halott |
| E4 | Haladás `ref` | sorszámcsere nem nulláz (teszt) |

### 3.7 DevOps

| ID | Próba | Várt |
| -- | ----- | ---- |
| D1 | Éles + demo Bunny env | SET, CSP-ben `vz-66c8b310-71c.b-cdn.net` |
| D2 | Start-log | `Migrating:` / `Done.` |
| D3 | Health | `GET /admin` 200 |
| D4 | Resend | kulcs él; `kineticare.hu` Verified **vagy** dokumentált pending + DNS |
| D5 | Demo séma | ne maradjon le a `main` migrációiról |

### 3.8 A11y és UX (élő oldal)

| ID | Próba | Várt |
| -- | ----- | ---- |
| U1 | 320 px reflow, kurzuslista + lejátszó | nincs vízszintes vágás |
| U2 | Billentyűzet | fókusz látható, sorrend értelmes |
| U3 | Kontraszt | CTA ≥ 4,5:1 szöveg, ≥ 3:1 UI |
| U4 | Érintőcél | ≥ 24 px (cél 44) |
| U5 | Egy elsődleges CTA / nézet | gomb-inventár |
| U6 | Hibaszöveg | magyar, mit csinálj |

## 4. Javítási szabály

1. Minden találat: **id, szem, reprodukció, hatás, tilos zóna?**
2. Javítás külön ügynökkel, tiszta fájl-tulajdonlás (tanulság 16).
3. Fizetés / számla / access: a szülő nem delegál vakon; ismétlődő hibánál átveszi.
4. Access-szabály változás: PR + emberi review, merge tilos ügynöktől.
5. Teszt vagy reprodukálható lépés minden viselkedéshez.
6. A jelentést a szülő (Grok 4.6 extra high) írja és javítja; nem más modell.

## 5. Sorrend ezen a körön

1. A Bunny-lánc ops-maradéka: Resend (domain pending dokumentálva), demo tananyag, staging E2E a demo hoston.
2. Demo-belépés 401 gyökéroka (az első mérés ezt hozta).
3. P1–P6, A1–A3, I1–I4, D1–D5 mérés.
4. F1 csak sandbox, ha a belépés él. F2 vendég SKIP, amíg a Resend tetszőleges címre nem küld.
5. Bugbot a `main`-re + security-review a feature-ágra.
6. A11y/UX ügynök a storefront útvonalakra.
7. Javító körök, tesztek, PR-frissítés.
8. Jelentés: `docs/e2e-audit-2026-08-27.md`.
