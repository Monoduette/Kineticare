# Örökölt kineticare.hu URL-ek — a végleges átirányítás-térkép

**Mérve és megvalósítva:** 2026-08-16
**Kód:** `src/lib/legacy-redirects.ts` (a térkép) · `next.config.ts` `redirects()` (a 308-ak) ·
`src/middleware.ts` (a 410-ek)
**Őr-teszt:** `src/__tests__/orokolt-url-atiranyitasok.test.ts`
**Háttérkutatás:** `docs/regi-oldal-osszehasonlitas.md` 8. szakasz

---

## 1. Miért van erre szükség

A régi, systeme.io-n futó kineticare.hu sitemapjában **25 URL** van, és
2026-08-16-án **mind a 25 élt, HTTP 200-zal**. Az új platformon ezek közül
hét címet változatlan slug szolgál ki, a többi tizennyolc viszont **nem
létezik**. A domain átállításának pillanatában tehát minden régi link, minden
korábbi megosztás, minden Google-találat — **és a nyomtatott szórólap
QR-kódja** — 404-re futna.

A `/kezrelax` sor emiatt nem SEO-, hanem **ügyfélszolgálati** kérdés: a
szórólapot már kiosztották, a QR-kódot nem lehet visszahívni.

Google ajánlása: készíts URL-térképet előre, használj szerveroldali **tartós**
átirányítást, lánc nélkül, és „Keep the redirects for as long as possible,
generally at least 1 year"
([Site move with URL changes](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes)).
A `301` és a `308` egyenrangú: „The `301` and `308` status codes mean that a page
has permanently moved to a new location."
([Redirects and Google Search](https://developers.google.com/search/docs/crawling-indexing/301-redirects)).
A Next.js `permanent: true` beállítása **308**-at ad (RFC 9110 15.4.9) — ezért
a táblázatban 308 áll ott, ahol a kutatás 301-et javasolt; a hatás azonos.

---

## 2. A végleges térkép

Minden örökölt URL **pontosan egy** kezelést kap. A három oszlop-típus:

- **változatlan** — az új rendszer ugyanezen a címen szolgálja ki. Szabályt
  **nem kap**, és nem is kaphat: a Next `redirects()` a fájlrendszer-útvonalak
  **előtt** fut, tehát egy ilyen szabály elnyelné a valódi oldalt.
- **308** — tartós átirányítás a mai kanonikus címre.
- **410** — a tartalom véglegesen megszűnt, nincs értelmes cél.

| # | Régi URL | Cél | Kód | Indoklás |
| --- | --- | --- | --- | --- |
| 1 | `/` | `/` | változatlan | A slug egyezik; mérve 200. |
| 2 | `/szolgaltatasok` | `/szolgaltatasok` | változatlan | CMS-oldal, mérve 200, a sitemapban is benne van. |
| 3 | `/rolunk` | `/rolunk` | változatlan | ua. |
| 4 | `/kapcsolat` | `/kapcsolat` | változatlan | ua. |
| 5 | `/aszf` | `/aszf` | változatlan | ua. |
| 6 | `/adatvedelem` | `/adatvedelem` | változatlan | ua. |
| 7 | `/impresszum` | `/impresszum` | változatlan | ua. |
| **8** | **`/kezrelax`** | **`/kurzusok/sos-kezrelax-villamkurzus`** | **308** | **A nyomtatott szórólap QR-kódjának célja — a térkép legfontosabb sora.** A kanonikus slug mérve: `/kurzusok/2` → 308 → ez. |
| 9 | `/kezrehab` | `/kurzusok/otthoni-kezrehab-program` | 308 | A régi fő értékesítő oldal; hirdetésekben és ajánlásokban is szerepel. Mérve: `/kurzusok/1` → 308 → ez. |
| 10 | `/kezrehab-akcio` | `/kurzusok/otthoni-kezrehab-program` | 308 | Akciós duplikátum; a régi 39 700 Ft-os ár nem él tovább. |
| 11 | `/oto-kezrehab-akcio` | `/kurzusok/otthoni-kezrehab-program` | 308 | A régi ingyenes lánc egyszeri ajánlata (a `/kezrelax` `urlRedirect` célja volt). A visszaszámlálós sürgetést nem hozzuk át, a program célja viszont ugyanaz. |
| 12 | `/kezrehab-penztar` | `/kurzusok/otthoni-kezrehab-program` | 308 | **Szándékosan nem a `/penztar`:** az a `robots.txt`-ben tiltott, és termékparaméter nélkül üres. A vevő a kurzusoldalról indítja a vásárlást. |
| 13 | `/kezrehab-akcio-penztar` | `/kurzusok/otthoni-kezrehab-program` | 308 | ua. |
| 14 | `/typ-kezrehab` | `/kurzusok/otthoni-kezrehab-program` | 308 | Régi köszönőoldal, elavult szöveggel („a belépő e-mailben jön"). Vevőt ide irányítani félrevezető lenne. |
| 15 | `/typ-kezrehab-akcio` | `/kurzusok/otthoni-kezrehab-program` | 308 | ua. |
| **16** | **`/rendeloi-kezelesek`** | **`/szolgaltatasok#rendeloi`** | **308** | Az önálló oldal megszűnt, a tartalom szekcióvá vált. A horgony létezését mértem: `id="rendeloi"` jelen van az élő oldalon. |
| 17 | `/rendeloi-kezelesek-regi` | `/szolgaltatasok#rendeloi` | 308 | Elavult duplikátum (55/25 perces időpontokkal), amely élesben is elérhető maradt. |
| 18 | `/hamarosan` | `/kurzusok` | 308 | Várólista-funkció ma nincs; a kurzuslista a legközelebbi értelmes cél. Ha várólista készül, **ez a sor arra áll át**. |
| 19 | `/typ-hamarosan` | `/kurzusok` | 308 | ua. |
| 20 | `/search` | `/` | 308 | Üres systeme.io-sablon, Kineticare-tartalom nélkül. Az új rendszerben nincs `/search` útvonal (mérve: 404), tehát a szabály nem nyel el valódi oldalt. |
| 21 | `/best-places-to-visit-in-asia` | — | **410** | Idegen spam-tartalom, ami a régi tárhelyre került. |
| 22 | `/best-time-to-visit-asia` | — | 410 | ua. |
| 23 | `/mehtab-bagh-itmad-ud-daula-taj-mahal` | — | 410 | ua. |
| 24 | `/top-places-in-china` | — | 410 | ua. |
| 25 | `/kathmandu-nepal` | — | 410 | ua. |

**Összesen:** 7 változatlan + 13 tartós átirányítás + 5 megszűnt = 25.

### 2.1. A Search Console 404-jelentéséből (2026-09-23)

A domain átállításának éjszakáján a Search Console „Not found (404)”
jelentése négy olyan címet mutatott, amely a régi sitemapban nem szerepelt,
de a Google ismeri (belső link, külső hivatkozás vagy régi megosztás). A régi
oldalon is 404-et adtak, az új hoszton is 404-et adtak (mérve). Három 308-at
kap a legközelebbi mai tartalomra; a lista a
`LEGACY_SEARCH_CONSOLE_PATHS`-ban él, külön a 25 elemű sitemap-lenyomattól.

| # | Régi URL | Cél | Kód | Indoklás |
| --- | --- | --- | --- | --- |
| 26 | `/kezrelax-penztar` | `/kurzusok/sos-kezrelax-villamkurzus` | 308 | Az ingyenes SOS régi pénztára; szándékosan nem a `/penztar` (lásd 12. sor). |
| 27 | `/kiss-kata` | `/rolunk` | 308 | Kiss Kata régi bemutatkozó oldala; ma a Rólunk mutatja be mindkét gyógytornászt. |
| 28 | `/home` | `/` | 308 | A kezdőlap másodlagos régi címe. |

A negyedik, `/en`, **szándékosan 404 marad**: angol változat nincs, és egy nyelvi
címet a magyar kezdőlapra irányítani nem egyenértékű csere (a Google soft
404-nek veheti). Ha angol oldal készül, arra kap 308-at.

**Összesen a 2.1-gyel:** 7 változatlan + 16 tartós átirányítás + 5 megszűnt = 28.

---

## 3. Amit élőben ellenőriztem (2026-08-16)

Minden lekérés olvasó GET volt.

| Mit | Eredmény |
| --- | --- |
| A régi sitemap 4 rész-sitemapjának URL-listája | Pontosan a fenti 25 cím |
| Mind a 25 régi URL státusza a régi hoszton | **25/25 HTTP 200** |
| A 10 új cél státusza (`kineticare-production.up.railway.app`) | **10/10 HTTP 200** |
| `/kurzusok/1` és `/kurzusok/2` | 308 → `otthoni-kezrehab-program`, illetve `sos-kezrelax-villamkurzus` (a slugok tehát ma is kanonikusak) |
| `id="rendeloi"` a `/szolgaltatasok`-on | Jelen van |
| `/kezrelax`, `/kezrehab`, `/rendeloi-kezelesek` az ÚJ hoszton | **404** (ez az, amit a térkép megszüntet) |
| `/search` az új hoszton | 404 (nincs elnyelt útvonal) |
| Új `sitemap.xml` | 11 URL, egyetlen örökölt cím sincs benne |
| Nagybetűs alak a régi hoszton | `/KezRelax` → **302** → `/kezrelax` (tehát a nagybetűs alakok élnek és indexelhetők) |
| Záró perjeles alak a régi hoszton | `/kezrelax/` → **200** (tehát ez a forma is forgalomban van) |
| Apex → www a régi hoszton | `https://kineticare.hu/` → **301** → `https://www.kineticare.hu/` |

---

## 4. Megvalósítási részletek — a három kényes pont

### 4.1 Záró perjel a `skipTrailingSlashRedirect: true` mellett

A repóban `skipTrailingSlashRedirect: true` van (a PostHog-proxy miatt), ami
kikapcsolja a Next automatikus `/foo/` → `/foo` normalizálását. **A saját
szabályaink ettől függetlenül illeszkednek a záró perjeles alakra**, mert a Next
a custom route regexét `modifyRouteRegex`-szel zárja
(`next/dist/lib/redirect-status.js`), és az a `$`-t `(?:\/)?$`-ra cseréli:

```
/kezrelax  →  ^(?!\/_next)\/kezrelax(?:\/)?$
```

Ezért **nem szabad** külön `/kezrelax/` forrást felvenni — az duplikált szabály
lenne ugyanarra a címre. Az őr-teszt mindkét alakot a Next **saját**
route-fordítójával ellenőrzi, nem újraírt logikával.

### 4.2 Nagybetűs és query-s alakok

Az `experimental.caseSensitiveRoutes` alapértéke `false`, a route-fordítás
`sensitive: false` — a `/KEZRELAX` ugyanarra a szabályra illeszkedik. A régi
szerver ezt két lépésben oldotta meg (`/KezRelax` → 302 → `/kezrelax` → 200);
nálunk **egy ugrás** lesz, tehát láncot sem építünk.

A query string automatikusan átmegy a célra (`prepare-destination.js`: „Query
merge order lowest priority to highest — 1. initial URL query values"), így az
`utm_*` és `gclid` paraméterek nem vesznek el. A `#rendeloi` horgony szintén
megmarad a célban.

### 4.3 Miért middleware a 410

A Next `redirects()` kizárólag átirányítás-státuszokat tud kiadni — az
`allowedStatusCodes` listája **301, 302, 303, 307, 308**
(`next/dist/lib/redirect-status.js`), 410 nincs benne. Öt dedikált route-fájl
helyett egy középponti ág maradt a `src/middleware.ts`-ben, így a térkép
egyetlen forrásból (`src/lib/legacy-redirects.ts`) él. A válasz rövid, magyar,
`lang="hu"` HTML, és van benne továbblépés a kezdőlapra (zsákutca tilos).

> **Őszinte megjegyzés a 410-ről.** A háttérkutatás azt írta, hogy a 410
> gyorsabban vet ki az indexből, mint a 404. A Google **mai** dokumentációja ezt
> nem támasztja alá: „All `4xx` errors, except `429`, are treated the same"
> ([HTTP status codes](https://developers.google.com/search/docs/crawling-indexing/http-network-errors)).
> A 410 mellett tehát az szól, hogy **szemantikailag pontos** — RFC 9110 15.5.11:
> „the target resource is no longer available at the origin server and this
> condition is likely to be permanent" —, és más keresők, archívumok is jelzésként
> használják. A választás így is helyes, csak az indoklása más.

---

## 5. Amit a DOMAIN-ÁTÁLLÁSKOR ellenőrizni kell

Sorrendben, és mindegyik **mérés**, nem szemrevételezés.

1. **Valódi újrabuild.** A `redirects()` — a `headers()`-höz hasonlóan — a
   **build idején** sül bele a `.next/routes-manifest.json`-be. Ha a Railway
   `Build · skipped (nothing to build)` döntéssel indítja a régi `.next/`-et, a
   szabályok nem élnek, miközben a deploy zöld (CLAUDE.md 1. üzemeltetési
   tanulság). **Ellenőrzés:** a build-logban legyen tényleges `npm run build`
   futás, és a manifestben szerepeljen a 13 szabály.
2. **A 308-ak mérése élesben**, közvetlenül az átállítás után:

   ```bash
   B=https://kineticare.hu    # az ÉLES domain, az átállítás után
   for u in kezrelax kezrehab kezrehab-akcio oto-kezrehab-akcio \
            kezrehab-penztar kezrehab-akcio-penztar typ-kezrehab \
            typ-kezrehab-akcio rendeloi-kezelesek rendeloi-kezelesek-regi \
            hamarosan typ-hamarosan search; do
     printf "%-26s " "/$u"
     curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "$B/$u"
   done      # mind 308, és a cél a fenti táblázat szerinti

   # A záró perjeles és a nagybetűs alak is 308 legyen, egy ugrással:
   curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "$B/kezrelax/"
   curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "$B/KEZRELAX"

   # A query megmarad:
   curl -s -o /dev/null -w "%{redirect_url}\n" "$B/kezrelax?utm_source=szorolap"

   # A spam-posztok 410-et adnak:
   for u in best-places-to-visit-in-asia best-time-to-visit-asia \
            mehtab-bagh-itmad-ud-daula-taj-mahal top-places-in-china kathmandu-nepal; do
     printf "%-40s " "/$u"
     curl -s -o /dev/null -w "%{http_code}\n" "$B/$u"
   done      # mind 410
   ```

3. **A szórólap-QR végigjátszása telefonon.** Nem elég a `curl`: a QR-t be kell
   olvasni, és végig kell nézni, hogy a látogató az ingyenes kurzusoldalon köt
   ki, érthető szöveggel.
4. **Apex ↔ www egységesítés.** A régi oldalon `kineticare.hu` → 301 →
   `www.kineticare.hu`. Az új hoszton ugyanezt az irányt kell tartani (vagy
   tudatosan megfordítani), különben minden örökölt link **kétugrásos láncot**
   kap.
5. **Search Console.**
   - A **régi tulajdont meg kell tartani** — nem törölni, nem leválasztani.
     A Change of Address csak akkor működik, ha a régi tulajdon megmarad, és a
     „Lefedettség" jelentésben ott látszik, hogyan dolgozza fel a Google a
     308-akat.
   - **Change of Address** beküldése a régi tulajdonon (Google: „Submit a Change
     of Address in Search Console for the old site"). Ha a régi oldalnak több
     altulajdona van (www és nem-www), **mindegyikre** be kell küldeni.
   - Az **új sitemap** beküldése az új tulajdonon.
6. **A redirectek megtartása legalább 1 évig** (Google ajánlása), felhasználói
   szempontból pedig határozatlan ideig. A szórólapok miatt a `/kezrelax` sor
   gyakorlatilag **véglegesen** marad.
7. **A 404-oldal.** Az átirányítás önmagában nem elég: ami kimarad a térképből,
   az ma vak zsákutcába fut. A 404-oldalnak értelmes továbblépést kell adnia.

---

## 6. Karbantartás

- **A térkép egyetlen forrása** a `src/lib/legacy-redirects.ts`. A
  `next.config.ts` csak visszaadja, a middleware csak a 410-es halmazt olvassa.
- **Új örökölt URL** felbukkanásakor előbb a `LEGACY_SITEMAP_PATHS` listát kell
  bővíteni — az őr-teszt ettől azonnal bukik, amíg a cím nem kap sorsot a három
  lista valamelyikében.
- **Kurzus-slug változásakor** a `COURSE_HOME_REHAB` / `COURSE_SOS_KEZRELAX`
  konstansokat kell átírni, és élesben újramérni, hogy az `/kurzusok/<id>` →
  308 lánc oda mutat-e.
- **Ha a `/hamarosan` várólista-oldal elkészül**, a 18–19. sor célja arra áll át.
- **Ha a rendelői kezelések visszakapják a saját oldalukat** (a kutatás K8
  kérdése), a 16–17. sor célja arra áll át, a horgony helyett.
