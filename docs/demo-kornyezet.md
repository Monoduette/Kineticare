# Demó-környezet — bemutató kitalált adatokkal

> **2026-08-29 — kivezetve.** A `Kineticare-demo` Railway-szolgáltatásra
> ezentúl **semmit nem deployolunk** (tulajdonosi döntés). Nincs `redeploy`,
> GitHub-forrás, `--from-source` rebuild, merge-utáni figyelés és élő E2E a
> demo hoston. A GitHub-forrás le van választva. A lenti leírás **történeti**:
> hogyan volt felépítve, és miért külön adatbázis. Új demo-környezetet ne
> állíts fel, hacsak a tulajdonos kifejezetten nem kéri.

> **Mire jó:** a rendszer bemutatható legyen **vásárlói szemmel** (regisztráció,
> pénztár, Kurzusaim, tananyag, haladás) és **admin szemmel** (vásárlók,
> rendelések, bevétel-alakulás, kurzus-haladás) — **teljesen kitalált adatokon**.
>
> **Alapszabály:** a demó **külön Railway-környezetben, külön adatbázison** fut.
> Az éles adatbázisba demó-adat SOHA nem kerülhet. A feltöltő script ezt négy
> független kapuval kényszeríti ki (lásd [5. Biztonsági kapuk](#5-biztonsági-kapuk)).

---

## 1. Mit lát a néző, és mit nem

| Működik a demóban | NEM működik (és miért) |
| --- | --- |
| Regisztráció, belépés, jelszó-beállítás | **Videó-lejátszás** — ahhoz valódi Bunny Stream fiók és feltöltött felvételek kellenek. A demó-tananyag ezért **szöveges leckékből** áll, azok minden környezetben megnyithatók, és beleszámítanak a haladásba. |
| Kurzusaim, tananyag-lista, lecke megnyitása, „megnéztem" jelölés | **Számlázás** — a `SZAMLAZZ_AGENT_KEY` nincs beállítva, így a számlázás kikapcsolt állapotban van (nem próbál számlát kiállítani). |
| Admin: vásárlók, rendelések, **Statisztika** (`/admin/statisztika`: havi bevétel otthoni/szakmai bontásban), kurzus-haladás panel | **E-mail-küldés** — provider-kulcs nélkül a noop-provider fut: a levél nem megy ki, csak naplósor keletkezik. Kitalált címekre amúgy sem szabad levelet küldeni. |
| Rendelés-állapotok: **fizetve** és **sikertelen fizetés** is szerepel | **Valódi Barion-tranzakció** — a demó-rendelések fizetésazonosítója `DEMO-` előtagú, hálózati hívás nem történik. |

A demó-vásárlások a **79 500 Ft-os kurzusra** szólnak, több hónapra elosztva —
így az admin **Statisztika** nézetén (`/admin/statisztika`) látszik a bevétel
alakulása. Ez ugyanaz a nézet, ami élesben a valódi `paid` rendeléseket
összesíti; a demó csak az adatot tölti, külön „hamis grafikon” nincs.

---

## 2. A környezet felépítése a Railway-en

> ⚠️ **A legveszélyesebb lépés a környezet-másolás.** A Railway új környezet
> létrehozásakor **átmásolja a szolgáltatások változóit** — köztük a
> `DATABASE_URI`-t. Ha ezt nem írod át, a „demó" service az **ÉLES adatbázison**
> futna, és a demó-feltöltés éles adatba írna. Ezért a 2.2 és 2.3 lépés
> **kötelező**, és a 2.5 ellenőrzés nélkül nem szabad seedelni.

### 2.1 Új environment

Railway → a Kineticare projekt → **Environments → New Environment** → név: `demo`.
(A „duplicate/fork" ugyanígy jó, de akkor a változók öröklődnek — lásd a
figyelmeztetést.)

### 2.2 Külön Postgres a demo környezetben

A `demo` környezetben: **+ New → Database → PostgreSQL** (a hivatalos
`postgres-ssl:18` template).

> ⚠️ **Kötet nélkül ne hagyd.** A `CLAUDE.md` 3. üzemeltetési tanulsága szerint
> a kötet nélküli Postgres tartalma egy redeploynál nyomtalanul eltűnik.
> Ellenőrizd, hogy a szolgáltatáshoz tartozik **Volume** a
> `/var/lib/postgresql/data` mountponttal.
>
> ⛔ **A régi `Postgres` szolgáltatáshoz (fagyasztott éles tartalék) és a
> `Postgres-c8Rg`-hez (éles adatbázis) ebben a munkában NEM nyúlunk** — sem
> redeploy, sem átkonfigurálás.

### 2.3 Változók (demo appservice → Variables)

Titkot **sosem** a repóból másolsz: minden érték a Railway felületén, kézzel
vagy referencia-változóként kerül be.

| Változó | Demó-érték / forrás |
| --- | --- |
| `DATABASE_URI` | **`${{<a demo Postgres neve>.DATABASE_URL}}`** — referencia-változó az ÚJ, demó Postgresre. **Ez a legfontosabb sor: ellenőrizd, hogy nem az éles adatbázisra mutat.** |
| `PAYLOAD_SECRET` | **ÚJ, saját titok** a demónak (pl. `openssl rand -hex 32`). Az éles titkot ide bemásolni tilos. |
| `NEXT_PUBLIC_SERVER_URL` | a demó saját címe (pl. `https://kineticare-demo.up.railway.app`). **Az éles `https://kineticare.hu` itt tilos** — a feltöltő script meg is tagadja rá a futást. |
| `BARION_ENVIRONMENT` | `test` |
| `BARION_API_URL` | `https://api.test.barion.com` |
| `BARION_POSKEY_TEST` | **sandbox** POSKey (`docs/barion-sandbox-setup.md`) |
| `BARION_PAYEE_EMAIL` | a sandbox Barion-fiók címe |
| `PAYLOAD_MEDIA_DIR` | a csatolt Volume mountpontja (pl. `/app/media`) — enélkül a feltöltött képek minden deploynál elvesznek |
| `LOG_LEVEL` | `info` |
| `ENABLE_JOB_WORKERS` | `false` — a demóban nincs valódi fizetés, amit utána kellene pollolni |
| `SEED_OWNER_EMAIL`, `SEED_OWNER_PASSWORD` | csak az első seedhez (3.1), utána törölhető |
| `DEMO_MODE` | **`1`** — enélkül a demó-feltöltés meg sem indul |
| `DEMO_CUSTOMER_PASSWORD` | *(opcionális)* a bemutató vásárlói fiókjának jelszava; legalább 12 karakter, kis- és nagybetűvel, számmal. Ha kihagyod, a script generál egyet, és **egyszer** kiírja a naplóba |
| `DEMO_COURSE_SKU` | *(opcionális)* melyik kurzusra szóljanak a vásárlások; alapértelmezés: `Otthoni KézRehab Program` |

> ⛔ **Tilos a demóban:** `BARION_POSKEY_PROD`, éles Számlázz.hu-kulcs
> (`SZAMLAZZ_AGENT_KEY`), éles Resend/SMTP-kulcs, éles `PAYLOAD_SECRET`, éles
> `DATABASE_URI`. A demó soha nem mutathat éles fiókra.
>
> ⛔ **`DEMO_MODE` az ÉLES környezetben SOHA nem állítható be.** Ez a változó az
> egyetlen kapu, ami a kitalált vevők és kifizetett rendelések írását engedi.

### 2.4 Domain

Demo appservice → **Settings → Networking → Generate Domain**, majd a kapott
címet írd be a `NEXT_PUBLIC_SERVER_URL`-be (https-szel, záró perjel nélkül) és
indíts **Redeploy**-t.

### 2.5 Ellenőrzés seed ELŐTT (kötelező)

1. A demo appservice **Variables** listájában a `DATABASE_URI` **a demó
   Postgresre** mutat (nem `Postgres-c8Rg`, nem `Postgres`).
2. A demó adminja (`https://<demo-domain>/admin`) betöltődik.
3. A demó adatbázisa **üres** (a Payload admin listái üresek, vagy a
   `Vásárlók`/`Rendelések` alatt csak a saját seed-adat van).

Ha bármelyik nem stimmel, **ne futtasd a seedet**.

---

## 3. Feltöltés (a demo környezetben)

A parancsok Railway CLI-vel futtathatók a demo környezet változóival, vagy a
service **⋯ → Shell** menüjéből. CLI-vel:

```bash
npm i -g @railway/cli
railway login
railway link                 # projekt: Kineticare, environment: demo, service: az appservice
railway environment demo     # ellenőrizd, hogy tényleg a demo környezet aktív
```

### 3.1 Alap-tartalom és owner

```bash
railway run -- npx payload migrate     # a deploy startCommandja is lefuttatja
railway run -- npm run seed            # owner-felhasználó + alap-tartalom
```

> A `npm run seed` **kötelező előfeltétel**: üres `users` kollekcióban az első
> létrehozott felhasználó **tulajdonosi** szerepkört kapna, demó-vásárlóból
> pedig sosem lehet tulajdonos. A demó-feltöltés ezért üres users-kollekció
> mellett magától megtagadja a futást.

### 3.2 Valódi kurzus-tartalom (opcionális, de ajánlott)

```bash
railway run -- LEGACY_RESTORE_CONFIRM=igen npm run seed:legacy
```

Ez tölti be a valódi „Otthoni KézRehab Program" (79 500 Ft) és „SOS Kézrelax
villámkurzus" (ingyenes) termékeket a leírásukkal. Enélkül is működik minden: a
demó-feltöltés létrehozza a 79 500 Ft-os kurzust, csak marketing-szöveg és
borítókép nélkül.

### 3.3 Demó-adat

```bash
railway run -- DEMO_MODE=1 npm run seed:demo
```

A script **idempotens**: többször futtatva sem duplikál, és meglévő adatot
(jelszó, tananyag, kézzel megnyitott leckék) SOHA nem ír felül. Ha egy futás
félbeszakadt, a következő befejezi a függőben maradt rendelést.

A kimenet végén összesítés áll (létrehozott/meglévő felhasználók, rendelések,
haladás-sorok). Ha a bemutató fiókja most jött létre, a napló **egyszer**
kiírja a belépési adatokat.

---

## 4. Mit hoz létre a `seed:demo`

| Entitás | Darab | Részletek |
| --- | --- | --- |
| Vásárlói fiókok | **9** | Kitalált magyar nevek, mind `@example.com` címmel (RFC 2606 — bemutató célra fenntartott domain, sosem tartozhat valódi postafiókhoz). 8 vásárolt, 1 „elakadt fizetés". |
| Bemutató fiók | 1 | `demo.vasarlo@example.com` — ezzel megy a vásárlói nézet a bemutatón. Jelszó: `DEMO_CUSTOMER_PASSWORD`, vagy generált (egyszer kiírva). |
| Rendelések | **9** | 8 × `fizetve` a 79 500 Ft-os kurzusra + 1 × `sikertelen fizetés`. A dátumok az aktuális naptári évre egyenletesen szétosztva (bevétel-alakulás). |
| Kurzus-hozzáférés | 8 | Csak a kifizetett rendelésekhez — a sikertelen fizetésű vevőnek **nincs** hozzáférése (ezt érdemes megmutatni). |
| Kurzus-haladás | vegyes | 2 vevő el sem kezdte, 2 vevő ~30%, 2 vevő ~70%, 2 vevő 100%. |
| Demó-tananyag | 3 modul / 10 lecke | **Csak akkor**, ha a kurzusnak még nincs tananyaga. Szöveges leckék, a szövegük kimondja, hogy bemutató-tartalom. Meglévő tananyagot a script nem ír felül. |

**A fizetés útja.** A rendelés `payment_pending` állapotban jön létre, és a
`paid`-re állítást **kizárólag a repó saját állapotgépe** végzi
(`src/lib/order-status/apply-barion-state.ts`) — ugyanaz a kód, ami élesben a
Barion-callback után fut: összeg- és deviza-assert, dupla-fizetés-őr,
fiók-feloldás, idempotens hozzáférés-beírás. A plugin `confirmOrder` függvénye
**nem** hívódik (CLAUDE.md 2. tilos zóna), és Barion felé **nem megy hálózati
hívás**: az állapotválasz a rendelés saját, szerver-oldali összegéből épül,
`DEMO-` előtagú fizetésazonosítóval. A fizetés utáni mellékhatások (számla,
visszaigazoló e-mail) szándékosan nem futnak.

---

## 5. Biztonsági kapuk

A `seed:demo` négy, egymástól független kapun megy át. Bármelyik megállítja,
a script **egyetlen sort sem ír**, és 1-es kilépési kóddal áll le.

| # | Kapu | Mit jelent, ha megállít |
| --- | --- | --- |
| 1 | `DEMO_MODE=1` hiányzik | Nem demó-környezetben futtattad (vagy elfelejtetted beállítani a változót). Éles környezetben **soha ne** állítsd be. |
| 2 | `NEXT_PUBLIC_SERVER_URL` az éles domainre mutat (`kineticare.hu`, `www.kineticare.hu`) | Az éles appservice-en futtattad. Állj meg, és ellenőrizd, melyik environmentben vagy. |
| 3 | Az adatbázisban **valódi vásárló** van (nem `@example.com` című, `customer` szerepkörű felhasználó) | Az adatbázis nem demó-adatbázis (valószínűleg a `DATABASE_URI` maradt az élesre állítva). **Ez a legfontosabb védelem a 2.3-as hiba ellen.** |
| 4 | Az adatbázisban **valódi rendelés** van (nem `@example.com` vevővel) | Ugyanaz, mint a 3. — az adatbázis éles adatot hordoz. |

A 3–4. kapu szándékosan **nem** nézi a `staff`/`owner` felhasználók címét: a
demót bemutató kollégák valódi címmel is kaphatnak admin-hozzáférést, attól az
adatbázis még demó marad.

---

## 6. Bemutató-forgatókönyv (kb. 10 perc)

**Vásárlói szemmel** (privát ablakban, kijelentkezve):

1. Kezdőlap → `Kurzusok` → a 79 500 Ft-os kurzus oldala (ár, leírás, tanterv).
2. Belépés a bemutató fiókkal (`demo.vasarlo@example.com`).
3. `Kurzusaim` → a megvásárolt kurzus, **70%-os haladással**.
4. A kurzus megnyitása → a tananyag fejezetekre bontva, a kész leckék jelölve,
   a „folytatás" a következő, még nem kész leckére visz.
5. Egy lecke megnyitása → „megnéztem" jelölés → a százalék azonnal frissül.

**Admin szemmel** (`/admin`, owner-fiókkal):

6. `Felhasználók` → 9 kitalált vásárló, számlázási adatokkal.
7. `Webshop → Rendelések` → 9 rendelés: rendelésszám, dátum, vevő, tétel,
   végösszeg, állapot. Látszik a **hónapokra elosztott bevétel** és egy
   **sikertelen fizetés** is.
8. A sikertelen fizetésű vevő (`balogh.peter@example.com`) megnyitása →
   **nincs** megvásárolt kurzusa: fizetés nélkül nincs hozzáférés.
9. `Webshop → Kurzusok` → a kurzus lapjának alján a **Kurzus-haladás panel**:
   ki kezdte el, ki hol tart, ki végzett.
10. Egy vevő lapján a **Kurzus-hozzáférés adása** panel: kézi hozzáférés-adás
    vásárlás nélkül (pl. ajándék kurzus) — `docs/manualis-vasarlas-hozzaadas.md`.

---

## 7. A demó után

- **Ha a demó-környezet megmarad:** hagyd békén; a `DEMO_MODE` maradhat a demo
  environmentben. Az éles környezetben viszont ellenőrizd, hogy `DEMO_MODE`
  **nincs** beállítva.
- **Ha nem kell többé:** Railway → `demo` environment → **Settings → Delete
  Environment**. Ez a demó Postgresét is elviszi — az éles környezetet nem
  érinti.
- **Ha csak az adatot dobnád el:** a demó adatbázisában elég a demó-táblák
  ürítése és újraseedelés; egyszerűbb és biztonságosabb az egész demó Postgres
  szolgáltatást újra létrehozni.

---

## 8. Hibakeresés

| Tünet | Ok / teendő |
| --- | --- |
| `A demó-feltöltés csak DEMO_MODE=1 mellett futhat` | Nincs beállítva a `DEMO_MODE` — állítsd be a **demo** environmentben (és sehol máshol). |
| `A NEXT_PUBLIC_SERVER_URL az ÉLES oldalra mutat` | Az éles appservice-en futtattad. Válts environmentet (`railway environment demo`). |
| `Az adatbázisban VALÓDI vásárló/rendelés van` | A `DATABASE_URI` az éles adatbázisra mutat. **Ne erőltesd** — javítsd a változót a 2.3 szerint. |
| `A users kollekció üres` | Előbb `npm run seed` (owner-felhasználó), utána `seed:demo`. |
| `A DEMO_CUSTOMER_PASSWORD nem felel meg a jelszó-politikának` | Legalább 12 karakter, kis- és nagybetű, szám (`docs/jelszo-politika.md`). |
| A kurzus nem látszik a weboldalon | A kurzus `Megjelenés a weboldalon` mezője nem `Közzétéve` — a script erre figyelmeztet is, de nem írja át (szerkesztői döntés). |
| A haladás mindenkinél 0% | A kurzusnak van tananyaga, de nincs **elindítható** leckéje (pl. minden videó „feldolgozás alatt"). A demó-tananyag csak akkor jön létre, ha a kurzusnak egyáltalán nincs leckéje. |

---

## 9. Nyitott pont az emberi maintainernek

A demó három **új** környezeti változót használ. Az ügynök az `.env*` fájlokhoz
nem nyúl, ezért ezeket **kézzel kell felvenni az `.env.example`-be** (érték
nélkül, csak kulcsként és magyarázattal):

```
# Demó-környezet (docs/demo-kornyezet.md) — ÉLESBEN SOHA NE ÁLLÍTSD BE
DEMO_MODE=
DEMO_CUSTOMER_PASSWORD=
DEMO_COURSE_SKU=
```

---

## Kapcsolódó dokumentumok

- `docs/deploy-railway.md` — a Railway-deploy runbookja (build, start, healthcheck).
- `docs/barion-sandbox-setup.md` — a Barion sandbox POSKey beszerzése.
- `docs/manualis-vasarlas-hozzaadas.md` — kézi kurzus-hozzáférés adása.
- `docs/adatbazis-mentes.md` — mentés/visszaállítás (az éles adatbázisról).
- `src/scripts/demo-seed.ts` — a feltöltő script (a fejlécében a részletes indoklás).
