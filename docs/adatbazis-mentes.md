# Adatbázis-mentés és visszaállítás (C14)

> **Állapot:** a mentés-eszköz elkészült, az ÉLESÍTÉS emberi lépést igényel:
> a `DATABASE_URI` GitHub-secret és a `BACKUP_AGE_RECIPIENT` GitHub repository
> variable felvételét, valamint a recipienthez tartozó privát age-kulcs
> biztonságos, offline megőrzését (lásd [Élesítés](#élesítés)). Bármelyik
> GitHub-konfiguráció hiányában a workflow fail-closed módon pirosra vált;
> titkosítatlan dumpot nem tölt fel. A Railway-oldali kötet-mentést külön kell
> bekapcsolni.

Ez a dokumentum három kérdésre válaszol: **mi véd** ma az adatvesztés ellen,
**hogyan kell visszaállítani**, és **hogyan ellenőrizzük**, hogy a mentés
tényleg működik.

---

## 1. Miért kell (a konkrét incidens)

A `CLAUDE.md` 3. üzemeltetési tanulsága: a Railway Postgres-szolgáltatás egy
redeploynál `initdb`-t futtatott, és **a kötet üresen jött vissza**. A séma
csak a `payload migrate` újrafuttatásával állt helyre; tartalom akkor még nem
volt benne. Éles adat mellett ugyanez adatvesztés lett volna, és **nem volt
mentés, amiből vissza lehetett volna állni**.

> **2026-08-15-i frissítés:** az incidens gyökéroka kiderült — a régi
> `Postgres` szolgáltatásnak **egyáltalán nem volt kötete**, az adat a
> konténer múlandó fájlrendszerén élt. Az éles adatbázis ezért átköltözött a
> **`Postgres-c8Rg`** szolgáltatásba (Railway hivatalos `postgres-ssl:18`
> template, kötettel a `/var/lib/postgresql/data` alatt); a Kineticare
> `DATABASE_URI`-ja `${{Postgres-c8Rg.DATABASE_URL}}` referencia. A régi
> `Postgres` szolgáltatás **érintetlen tartalékként megmaradt — tilos
> újraindítani vagy redeployolni**, mert kötet híján azzal törlődne.

Az adatbázisban ma valódi, nehezen pótolható üzleti adat van: vevők,
jelszó-hash-ek, rendelések, kifizetés-állapotok, számlaszámok és
kurzus-haladás. Ezek egy része (rendelés–Barion–számla lánc) utólag nem
rekonstruálható.

---

## 2. Mit kínál maga a Railway (kutatás, 2026-08)

Forrás: `docs.railway.com` — *Back Up and Restore Postgres*, *Volumes →
Backups*, *Volumes → Point-in-Time Recovery*.

| Réteg | Mit ad | Korlát |
| --- | --- | --- |
| **Ütemezett kötet-mentés** (Backups fül) | A Postgres kötetének pillanatfelvétele. Napi (6 napig őrizve), heti (1 hónapig), havi (3 hónapig) ütemezés, egyszerre több is. Inkrementális, copy-on-write; a kötet-díjszabás szerint fizetsz a felvételenként egyedi adatért. Kézi felvétel is indítható (a kötet méretének max. 50%-áig). | **Nem hagyja el a Railway-t**: ugyanabban a projektben és környezetben él, nem tölthető le. **A kötet kiürítése az összes mentését törli**, és a projekt törlésével is elvész. Visszaállításkor a nála újabb mentések elvesznek. |
| **Point-in-time recovery (PITR)** | pgBackRest folyamatosan tolja a WAL-t egy privát Railway storage bucketbe; ~4 hetes ablakon belül **tetszőleges időpillanatra** vissza lehet állni (ez a jó eszköz a felvételek KÖZÖTT történt hibára: rossz `DROP`, elszállt script). A visszaállítás új, testvér-szolgáltatásba történik (`<forrás>-restored-…`), az eredetit érintetlenül hagyva. | Külön PITR-díj nincs, de a bucket-tárhelyet és az egresst fizeted. **Az ablak a bekapcsolás utáni ELSŐ alap-mentéstől indul** — visszamenőleg nem véd, tehát előre kell bekapcsolni. Szintén platformon belül marad. |
| **Logikai dump (`pg_dump`)** | Hordozható, szolgáltató-független másolat. A Railway saját doksija is ezt ajánlja arra az esetre, amikor a kötet maga tűnik el: „a mentések az adat-hibák ellen védenek, nem a kötet törlése ellen — arra valók a logikai dumpok". | Nem folyamatos: két mentés között keletkezett adat elvész. Nagy adatbázisnál lassabb, és (a mi esetünkben) TCP-proxy-egresst számláz. |

**Következtetés — a három réteg egymást egészíti ki, nem helyettesíti:**

1. **Kötet-mentés (Railway, napi)** — a leggyorsabb visszaállás egy elrontott
   művelet után. *Bekapcsolása emberi lépés a Railway felületén.*
2. **PITR (Railway)** — pontos időpontra állás két felvétel között.
   *Opcionális; ha bekapcsoljuk, előre kell.*
3. **Logikai dump (ez a repó)** — az egyetlen réteg, ami **offsite**: másik
   szolgáltatónál (GitHub) tárolt, **letölthető** és **visszaállítási próbával
   igazolt** másolat. Ez éli túl a kötet kiürítését, a projekt törlését és a
   Railway-fiók elvesztését is.

Ez a dokumentum a 3. réteget írja le, mert az van a repó kezében. Az 1. és 2.
réteg bekapcsolását külön, a Railway felületén kell elvégezni (`Postgres-c8Rg`
szolgáltatás → **Backups** fül).

---

## 3. Mit fed le a mentés — és mit NEM

| Adat | Fedve? | Hol van |
| --- | --- | --- |
| Teljes Postgres-tartalom (users, orders, products, course_progress, `payload_migrations`, séma, indexek, szekvenciák) | **Igen** | a dump-fájl |
| Feltöltött médiafájlok (képek, `Media` kollekció fájljai) | **NEM** | a Kineticare-szolgáltatás Railway-kötetén, `/app/media` (`PAYLOAD_MEDIA_DIR`) |
| Bunny Stream-en tárolt videók | **NEM** (nem is ebben a rendszerben él) | Bunny Stream könyvtár |
| Környezeti változók / titkok | **NEM** (szándékosan) | Railway variables |

**Ezt ki kell mondani: a médiafájlok ma nincsenek mentve.** A DB-ben csak a
`media` rekord marad meg; ha a kötet elvész, a rekord megmarad, a fájl nem, és
a `/api/media/file/...` HTTP 500-at ad. A visszaállítás után ezt a
`src/scripts/…` médiaellenőrzés (`media-restore` teszt által lefedett út) is
jelzi.

**A média-mentés lehetséges útjai** (döntést igényel, nem része ennek a
körnek):

- **Railway kötet-mentés a Kineticare-szolgáltatás kötetére** — egy kapcsoló a
  felületen, azonnal véd, de platformon belül marad (ugyanaz a korlát, mint
  fent).
- **Objektumtár (S3-kompatibilis, pl. Railway storage bucket vagy Bunny
  Storage)**, ahová a Payload upload-adapter közvetlenül ír — így a média nem
  is múlik a konténer-köteten. Ez a tartós megoldás, de kód- és
  konfigurációváltozás (upload-adapter), külön feladat.
- **Ütemezett `tar`-mentés a kötetről** egy Railway cron-szolgáltatásból az
  objektumtárba — köztes megoldás, kódváltozás nélkül.

---

## 4. A repó-oldali mentés felépítése

```
                 ┌──────────────────────────────┐
  ütemezett      │ .github/workflows/           │   napi 02:17 UTC
  (offsite)      │   db-backup.yml              │ + kézi indítás
                 │  postgres:18-alpine@digest   │
                 └──────────────┬───────────────┘
                                │ pg_dump --format=custom
                                ▼
                    kineticare-YYYYMMDD-HHmmss.dump
                                │
                    pg_restore --list (integritás)
                                │
                     age recipient (titkosítás)
                                │
                                ▼
                 *.dump.age GitHub artifact, 30 nap

                 ┌──────────────────────────────┐
  kézi /         │ npm run backup:db            │   ugyanaz a formátum,
  üzemeltetői    │  src/scripts/backup-db.ts    │   + retenció a célkönyvtárban
                 └──────────────────────────────┘
```

### 4.1 `npm run backup:db` (kézi / üzemeltetői mentés)

```bash
# alapértelmezés: ./backups könyvtár, 14 mentés megtartva
DATABASE_URI="..." npm run backup:db

# saját célkönyvtár és retenció
DATABASE_URI="..." npm run backup:db -- --cel=/mnt/mentes --megtart=30
```

| Kapcsoló | Alapértelmezés | Leírás |
| --- | --- | --- |
| `--cel=<könyvtár>` | `./backups` | Célkönyvtár (létrejön, ha nincs). A `.gitignore` kizárja a `/backups/`-t — dump SOSEM kerülhet a repóba. |
| `--megtart=<n>` | `14` | Ennyi legfrissebb mentés marad; a többi törlődik. |

Amit a script garantál:

- **Formátum:** `pg_dump --format=custom` (tömörített, szelektíven
  visszaállítható). A tulajdonos/jogosultság-adat **benne marad** — a
  visszaállításkor lehet róla dönteni (`--no-owner`), fordítva nem.
- **Fájlnév:** `kineticare-YYYYMMDD-HHmmss.dump`, **UTC** időbélyeggel, hogy a
  nevek rendezése időrendi legyen és a nyári időszámítás ne okozzon ütközést.
- **Integritás-ellenőrzés minden mentés után:** `pg_restore --list` a kész
  fájlon. Ha nem olvasható végig, vagy egyetlen visszaállítható bejegyzést sem
  tartalmaz, a **fájl törlődik** és a script **1-es kóddal** lép ki — nem
  maradhat hátra hamis biztonságot adó, visszaállíthatatlan mentés.
- **Titokvédelem:** a `DATABASE_URI` értéke sehol nem jelenik meg — sem a
  konzolon, sem a strukturált naplóban, sem hibaüzenetben. A pg_dump/pg_restore
  hibakimenete redakciós szűrőn megy át (`redactConnectionInfo`).
- **Nincs shell:** a folyamatindítás `execFile`-lal történik, tehát a
  jelszóban lévő speciális karakter (`$`, `;`, idézőjel) nem eshet át
  shell-értelmezésen, és nem kerül parancs-history-ba.
- **Idegen fájlhoz nem nyúl:** a retenció csak a saját névsémájú fájlokat
  törli.

A tiszta (mellékhatás-mentes) logika a `src/lib/backup-db.ts`-ben él, és
`src/__tests__/backup-db.test.ts` teszteli — valódi `pg_dump` és hálózat
nélkül.

### 4.2 Az ütemezett workflow

`.github/workflows/db-backup.yml` — napi 02:17 UTC + kézi indítás
(`workflow_dispatch`).

- A workflow **fail-closed**: ha a `DATABASE_URI` secret vagy a
  `BACKUP_AGE_RECIPIENT` repository variable hiányzik, a futás pirosra vált,
  és nem készül feltölthető artifact. A recipient nyilvános kulcs; a privát
  kulcs nem kerülhet GitHubra vagy a repóba.
- A `pg_dump` a **hivatalos `postgres:18-alpine` image digesthez kötött
  példányából** fut, nem a runner apt-csomagjából. Két oka van: (1) a kliens
  főverziója nem lehet kisebb a szerverénél, és a tag ezt láthatóan rögzíti —
  az éles `Postgres-c8Rg` szolgáltatás `postgres-ssl:18` (PostgreSQL 18);
  (2) a digest kizárja, hogy ugyanaz a tag később észrevétlenül más image-re
  mutasson. A mentés nem függ a repó npm-telepítésétől.
- A mentés ugyanazt az integritás-ellenőrzést kapja (`pg_restore --list`);
  bukásnál a fájl törlődik és a job piros.
- Az ellenőrzött dumpot **age v1.3.2** titkosítja. Az eszköz a hivatalos
  release-archívumból töltődik le, és telepítés előtt rögzített SHA-256
  ellenőrzést kap.
- Az artifact kizárólag `*.dump.age`, `retention-days: 30`, és hiányzó fájlnál
  a feltöltés hibára fut. A plaintext `.dump` és a `toc.txt` minden kimenetnél
  (`always()`) törlődik a runner munkaterületéről.
- A `DATABASE_URI` kizárólag `env:`-ként megy a lépésbe és a konténerbe; az
  értéke sosem kerül parancssorba, echo-ba vagy logba.

> **Ha a Railway Postgres főverziót vált** (ma `postgres-ssl:18`, a workflow
> `PG_IMAGE`-e `postgres:18-alpine`), a workflow `PG_IMAGE` értékét is emelni
> kell — különben a `pg_dump` „server version mismatch"-csel áll le. Ez hangos
> hiba, nem néma kimaradás.

---

## 5. Élesítés

1. **Railway → `Postgres-c8Rg` szolgáltatás → Backups fül:** kapcsold be a
   **napi** (és ha kell, heti) kötet-mentést. Ez az első védelmi vonal, egy
   kattintás. Megfontolandó a **PITR** bekapcsolása is — az ablak csak a
   bekapcsolás utáni első alap-mentéstől indul, tehát előre kell (a
   `postgres-ssl` template-tel kompatibilis). **A régi `Postgres`
   szolgáltatáson NINCS mit bekapcsolni: nincs kötete — hozzányúlni tilos.**
2. **A publikus kapcsolati string kikeresése:** Railway → `Postgres-c8Rg` →
   *Variables* → `DATABASE_PUBLIC_URL`. **Fontos:** a GitHub-runner nem éri el
   a Railway privát hálózatát (`postgres-c8rg.railway.internal`), ezért a belső
   `DATABASE_URI` itt nem használható. A publikus proxyn keresztüli forgalom
   egressként számlázódik — ez a napi mentés ára.
3. **Offline age-kulcspár létrehozása:** megbízható, internetkapcsolat nélküli
   gépen telepítsd az age-et, majd hozd létre a kulcsot és olvasd ki a
   nyilvános recipientet:

   ```bash
   age-keygen -o /biztonsagos/hely/backup-age-key.txt
   age-keygen -y /biztonsagos/hely/backup-age-key.txt
   ```

   A privát kulcsfájlról készíts legalább két, elkülönített és
   hozzáférés-védett offline másolatot. A privát kulcs **nem kerülhet** a
   repóba, GitHub secrethez, artifactba, chatbe vagy jelszókezelőből exportált
   közös fájlba.
4. **GitHub → Settings → Secrets and variables → Actions → New repository
   secret:** név `DATABASE_URI`, érték a 2. pontban kikeresett publikus
   kapcsolati string. **Az értéket sehová ne másold be** — sem PR-be, sem
   dokumentációba, sem chatbe.
5. **GitHub → Settings → Secrets and variables → Actions → Variables → New
   repository variable:** név `BACKUP_AGE_RECIPIENT`, érték a 3. pontban
   kiolvasott **nyilvános** age-recipient. Ellenőrizd kétszer, hogy valóban a
   biztonságosan eltett privát kulcshoz tartozik.
6. **Első futás kézzel:** Actions fül → *DB mentés* → *Run workflow*. Ellenőrizd
   a job összefoglalóját (titkosított fájlnév, méret, bejegyzésszám), majd
   töltsd le az artifactot. Kizárólag `.dump.age` lehet benne.
7. **Visszaállítási próba** az 7. fejezet szerint — a mentés addig nem mentés,
   amíg vissza nem állt egyszer.

> **Kulcsvesztés = mentésvesztés.** A GitHubon csak a nyilvános recipient van;
> az offline privát kulcs nélkül a régi artifactok nem fejthetők vissza.
> Kulcsrotációnál a régi privát kulcsot legalább a hozzá tartozó artifactok
> lejártáig meg kell őrizni.

---

## 6. Visszaállítás (lépésről lépésre)

> **Előtte:** ha az adatbázis még él és csak részleges a baj, először **készíts
> friss mentést** a jelenlegi állapotról (`npm run backup:db`). Egy visszaállítás
> felülírja a mai adatot; e nélkül nincs visszaút.

### 6.1 A mentés beszerzése

- **Artifactból:** GitHub → Actions → *DB mentés* → a kívánt futás → Artifacts
  → letöltés, kicsomagolás (a `.dump.age` fájl a zipben van). Megbízható,
  offline gépen, az ott őrzött privát kulccsal fejtsd vissza:

  ```bash
  age --decrypt --identity /biztonsagos/hely/backup-age-key.txt \
    --output kineticare-20260815-021709.dump \
    kineticare-20260815-021709.dump.age
  ```

  A visszafejtett `.dump` személyes adatot tartalmaz: csak a visszaállítási
  próbához szükséges ideig tartsd meg, majd biztonságosan töröld.
- **Vagy helyi mentésből:** a `--cel` könyvtár legfrissebb `.dump` fájlja.

### 6.2 Ellenőrzés visszaállítás ELŐTT

```bash
pg_restore --list kineticare-20260815-021709.dump | head -20
```

A fejlécből leolvasható a `Dumped from database version` és a bejegyzések
száma. Ha ez a parancs hibázik, **a fájl sérült — ne is kezdd el a
visszaállítást**, keress egy korábbi mentést.

### 6.3 Visszaállítás ÜRES adatbázisba (ez az ajánlott út)

A `pg_restore` nem törli a meglévő objektumokat: meglévő táblákra ráfuttatva
„already exists" hibákat kapsz és félig visszaállított állapotot. Ezért mindig
üres célt használj.

```bash
# 1. új, üres adatbázis a cél-szerveren
createdb --dbname="<admin-kapcsolat>" kineticare_restore

# 2. visszaállítás
pg_restore \
  --dbname="postgresql://<user>:<jelszo>@<host>:<port>/kineticare_restore" \
  --no-owner --no-privileges --exit-on-error \
  kineticare-20260815-021709.dump
```

- `--no-owner --no-privileges`: a cél-szerveren más lehet a szerepkör neve,
  mint a forráson (Railway `postgres` vs. helyi user). E kapcsolók nélkül a
  visszaállítás „role does not exist" hibára fut.
- `--exit-on-error`: **kötelező.** Nélküle a `pg_restore` hibák mellett is
  végigmegy és 0-val lép ki — így egy féllábon álló adatbázist néznél
  sikernek.
- Nagy dumpnál a `--jobs=4` gyorsít (csak custom/directory formátumnál
  működik).

### 6.4 Ellenőrzés visszaállítás UTÁN

```sql
SELECT count(*) FROM users;
SELECT count(*) FROM products;
SELECT count(*) FROM course_progress;
SELECT count(*) FROM orders;
SELECT count(*) FROM payload_migrations;
SELECT count(*) FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
```

Vesd össze az eredeti (vagy a mentés készültekori) számokkal. A táblaszám
eltérése azonnal látszó jel: hiányzó séma-elem.

### 6.5 Éles átállítás és a Payload-migrációk

Ez a legfontosabb rész, itt lehet a legnagyobbat hibázni.

- **A dump a `payload_migrations` táblát is tartalmazza**, tehát a
  visszaállított adatbázis „tudja", meddig jutott a migrációs sor. Ezért a
  visszaállítás után **NEM szabad** a migrációkat kézzel újrajátszani vagy a
  `payload_migrations` sorait törölni.
- Az induláskor futó `npx payload migrate` (a `railway.json`
  `startCommand`-jában) a visszaállított állapotot látja, és **csak a
  hiányzó** migrációkat futtatja le. Ez a helyes viselkedés.
- **Figyelem a régi mentés + új kód kombinációra:** ha egy RÉGI mentést állítasz
  vissza, miközben a kód azóta továbblépett, az induláskori `migrate` a köztes
  migrációkat le fogja futtatni — ez rendben van, DE a `&&` miatt egy bukó
  migráció esetén az app el sem indul (healthcheck-hiba). Ezért a
  visszaállítást mindig **előbb egy külön adatbázisban** próbáld ki, és nézd
  meg, hogy a `Migrating: …` / `Migrated: …` sorok hibátlanul lefutnak-e.
- **A migrációs fájlokat SOHA ne szerkeszd** a visszaállítás megkönnyítésére —
  ez a `CLAUDE.md` 3. tilos zónája, végrehajtható őrökkel (G3/G4, lásd
  `docs/ci-orok.md`).
- Az éles szolgáltatás `DATABASE_URI`-ját csak akkor állítsd át a
  visszaállított adatbázisra, ha a 6.4 ellenőrzés rendben volt. Az átállítás
  redeployt vált ki; a `CLAUDE.md` 1. tanulsága szerint ellenőrizd, hogy a
  build tényleg lefutott.

### 6.6 A visszaállítás után

- **A médiafájlok nem jönnek vissza a dumppal** (3. fejezet). Ha a kötet is
  elveszett, a `media` rekordokhoz nem lesz fájl.
- Ellenőrizd a `users` tábla első felhasználójának szerepkörét: a
  `promoteFirstUserToOwner` hook csak az ELSŐ user létrehozásakor fut, tehát
  visszaállítás után nem játszik szerepet — az owner az marad, aki a dumpban
  az volt (`CLAUDE.md` 8–9. tanulság).
- Futtass egy kézi mentést az új éles állapotról.

---

## 7. Mentés-ellenőrzési rutin (havonta)

Egy mentés, amit sosem állítottak vissza, nem mentés, hanem feltételezés.

**Havonta egyszer** (naptárba tenni, kb. 20 perc):

1. Indítsd kézzel a *DB mentés* workflow-t, vagy vedd a legutóbbi artifactot.
2. Töltsd le, csomagold ki, majd offline fejtsd vissza a 6.1 szerint.
3. `pg_restore --list <visszafejtett-fájl> | head -20` — végigolvasható-e.
4. Állítsd vissza egy **eldobható** adatbázisba (6.3), `--exit-on-error`-ral.
5. Futtasd le a 6.4 ellenőrző lekérdezéseket, és vesd össze az élessel.
6. **Mérd meg, mennyi ideig tartott** — ez lesz a visszaállítási idő becslése
   egy éles incidensben.
7. Dobd el a próba-adatbázist, és töröld a visszafejtett plaintext dumpot.
8. Írd fel az eredményt (dátum, dump mérete, visszaállítási idő, sorszámok) —
   a `docs/feladatlista.md` C14 sorához vagy egy üzemeltetési naplóba.

**Emellett folyamatosan figyelendő:**

- A *DB mentés* workflow pirosra váltása **azonnali** figyelmet igényel: ez
  azt jelenti, hogy éppen most nincs friss mentés.
- Ha a Railway Postgres főverziót vált, a workflow `PG_IMAGE` értékét emelni
  kell.
- Ha az adatbázis érdemben nő, nézd meg az artifact méretét és a futás idejét
  (30 perces timeout van a jobon).

---

## 8. Ami tudatosan kimaradt

- **Titkosított, hosszú távú offsite tár (S3/B2).** A GitHub-artifact age-gel
  titkosított, de csak 30 napig él. Ha ennél hosszabb megőrzés vagy a GitHubtól
  független harmadik másolat kell, az külön tárhely-, retenciós és
  adatkezelési döntés.
- **Média-mentés** (3. fejezet) — külön feladat.
- **Automatikus visszaállítási próba CI-ban** (dump → eldobható Postgres →
  ellenőrző lekérdezések). Technikailag megoldható lenne egy service
  konténerrel; ma a havi kézi rutin fedi le.
