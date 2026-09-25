# Kineticare — teljes feladatlista

**Utolsó frissítés:** 2026-09-25. A `main` a `16e92c7` (#311) commiton áll,
a #283–#311 PR-ek mind bent vannak.

A lista elején a **ma nyitott** tételek állnak, utána a 2026 szeptemberében
lezárt munka, végül a korábbi állapotok archívuma. A régi táblák nem tűntek el:
az „Archív” szakaszba kerültek, hogy a döntések nyoma megmaradjon.

## Nyitott most (2026-09-25)

### 1. Fizetés, számlázás és ÁSZF: az élesítés utáni teendők

A tulajdonos három fő kérdése a számlázás, az ÁSZF és a Barion
(`CLAUDE.md`, „Állapotjelentés a tulajdonosnak”). A W1 (#307) 2026-09-25-én
beolvadt; a keményítés élesben van, de egyik folyamat sem futott még végig
valódi vásárlással.

| #   | Teendő                                                                                                                                                     | Ki                 | Megjegyzés                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Barion: az első éles fizetésindítás a W1 után, pénzmozgás nélkül (runbook 11: vendég- és bejelentkezett indítás, a Barion-oldal megnyílik, riasztás nincs) | tulajdonos         | **A vendég-indítás sikeres (2026-09-25 19:57 UTC):** a `POST /api/checkout/start` 200-zal tért vissza, a napló szerint „checkout-start: fizetés elindítva” (`KH-2026-000004`, vendég), 401 és riasztás nem volt. A `BARION_POSKEY_PROD` tehát jó; a 09-16-i és a 09-24-i 401 az élesítés előtti bolt miatt jött (`CLAUDE.md` 25. tanulság). Hátravan: a bejelentkezett vevői fiókkal indított próba (ez csak a 3DS-fiókadatokat ellenőrzi). |
| F2  | Számlázás: az első éles számla                                                                                                                             | tulajdonos         | A számlázás élesben be van kapcsolva, de fizetett rendelés még nem volt, így éles számla sem készült. Javaslat: próbavásárlás a legolcsóbb fizetős (legalább 10 Ft-os) kurzusra, utána visszatérítés. Az ingyenes SOS-kurzus nem megy Barionon át, azzal számla sem készül. Így a számla, a stornó vagy helyesbítő és a vevői értesítők is lefutnak.                                                                                        |
| F3  | ÁSZF: ügyvédi átnézés (K15)                                                                                                                                | tulajdonos, ügyvéd | Tulajdonosi döntés: élesítés most, ügyvéd utólag. Az ÁSZF-ben nincs a 45/2014. Korm. rendelet 11. § (1) i) szerinti elállási pont (határidő, gyakorlás módja, nyilatkozatminta, visszatérítés), csak az „Elállási jog kizárása”. A „Fizetés után a Vásárló pénzvisszafizetést nem kérhet” mondat ütközik az online elállási funkcióval és a 23. § (1)-gyel. Kódból nem javítható.                                                           |
| F4  | Külső életjel-figyelés (`HEALTHCHECK_PING_URL`)                                                                                                            | tulajdonos         | Élesben nincs beállítva: ha a job-workerek leállnak, külső figyelő nem jelez, csak a napló. Kell egy Healthchecks.io-csekk, és a címe a Railway-en.                                                                                                                                                                                                                                                                                         |
| F5  | A #307 utolsó Codex-átnézésének öt közepes (P2) találata                                                                                                   | fejlesztés         | Lent részletezve. A #307 a tulajdonos döntése szerint zöld CI-vel beolvadt; a PR szálain a válasz rögzíti az ellenőrzést. Egyik sem mozgat rosszul pénzt vagy számlát.                                                                                                                                                                                                                                                                      |
| F6  | A W1 harmadik hibavadász-körének kisebb találatai                                                                                                          | fejlesztés         | Lent részletezve. Egyik sem mozgat rosszul pénzt vagy bizonylatot.                                                                                                                                                                                                                                                                                                                                                                          |

**F5, a #307 Codex-találatai (2026-09-25):**

- Visszatérítés-egyeztetés: a rögzített visszatérítésekből csak a `Succeeded`
  számít, a `Refunded` és a `PartiallyRefunded` nem, pedig a közös osztályozó
  (`classifyRefundedTransactionStatus`) ezeket is sikeresnek veszi. Ilyenkor
  téves `foreign-refund` riasztás szól.
- Elállási űrlap JavaScript nélkül: a natív POST az `/elallas` oldalra megy, a
  nyilatkozat nem rögzül. Űrlap-kódolást fogadó szerveroldali végpont és
  visszaigazoló oldal kell mögé.
- Számla-resweep: ha a tíz legrégebbi jelöltnek már van élő számlajobja, egy
  elveszett jobú tizenegyedik rendelés addig nem kerül sorra, amíg a torlódás
  el nem fogy. A resweep vegyen fel helyettük továbbiakat.
- Visszatérítések heti újraellenőrzése: ha a workerek a 7–8. nap teljes 24
  órás sávjában nem futnak, a visszatérítés kimarad, és riasztás sem szól.
- Kézi számlaszám rögzítése: két egyidejű futás két rendelésen ugyanazt a
  számot rögzíthetné. A számlaszám szerinti zár kell.

**F6, a W1 hibavadász-kör kisebb találatai:**

- `/api/elallas`: a Turnstile szerveroldali kiesése 400 és figyelmeztetés,
  RIASZTÁS nélkül (a pénztár 503-at ad és riaszt).
- A globális 404-oldalról hiányzik az „Elállás a szerződéstől” link.
- A visszatérítés-egyeztetés riasztása (visszafordított vagy elbukott kártyás
  visszatérítés) az admint ajánlja, amely ilyenkor elutasít; nincs alertCode és
  runbook-sor.
- Hat Számlázz.hu-RIASZTÁS kódja nincs a runbook 11-ben; két sor sosem
  illeszkedik.
- A kézikönyv 3.3 pontja és a 05/08-as runbook szerint a számla külső
  azonosítója a puszta rendelésszám, pedig a #307 egyedivé tette.
- A `docs/szamlazz-megfeleles.md` szerint semmi nem állítja sorba a helyesbítő
  jobot, pedig a helyreállítás igen.
- Stornó: ha a pending-írás közvetlenül az igénylés után bukik, a panel
  beküldést állít, pedig kérés nem ment ki.
- A leállás-kiürítés riasztása szerint a schedule-őr lezárja a megszakított job
  sorát; az esemény-vezérelt jobokra ez nem igaz (ellenőrizendő).
- Az automatikus visszatérítésnél a lezárás utáni zár-hiba elnyeli a vevői
  értesítőt (ellenőrizendő).
- A pénztár áfa-mondata nincs a `SZAMLAZZ_AFAKULCS`-hoz kötve: a 27%-os
  átállás (runbook 14) előtt javítani kell.
- A pénztári Turnstile kliensoldali kiesése riasztás nélkül blokkol; a widget
  320 px-en kilóghat; két Turnstile-ág és a köszönőoldal kísérlet-kerete
  teszteletlen.
- Ha az audit és a munkatársi értesítő egyszerre bukik, a riasztások nem
  létező bizonyítékra mutatnak (ellenőrizendő).

### 2. Domain-átállás: `www.kineticare.hu` → Railway

A teljes, mért menetrend: [`docs/kineticare-hu-atallas.md`](kineticare-hu-atallas.md),
„Mért állapot és menetrend (2026-09-23)”. Csak a `www` CNAME változik; az apex,
a levelezés és a többi rekord marad.

**Mérve 2026-09-25:** a `www.kineticare.hu` már a Railway-en fut. Egyedi domain a
`Kineticare` szolgáltatáson, a válaszfejlécben `server: railway-hikari`, nincs
`X-Robots-Tag`, a robots-meta `index, follow`, a canonical
`https://www.kineticare.hu`, és a `/admin` 200-at ad. A D1 és a D3 ezzel
teljesült. A D4-ből a canonical és az indexelés rendben van; a belépés, a
jelszó-visszaállító link, az örökölt átirányítások és a tesztvásárlás még
ellenőrizendő, ezért a D4 nyitva marad. A többi sort a tulajdonos ellenőrizze.

| #   | Teendő                                                                                                                                             | Ki         | Megjegyzés                                                                                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | T−1: `www` TTL 300; Railway custom domain `www.kineticare.hu` a `Kineticare` szolgáltatáson, a TXT-ellenőrző rekord a Tárhely.Eu-n                 | tulajdonos | **Kész** (mérve 2026-09-25): a `www.kineticare.hu` egyedi domainként be van állítva, és a Railway szolgálja ki.                                           |
| D2  | T−1: `EXTRA_ALLOWED_ORIGINS=https://kineticare.hu,https://www.kineticare.hu` a Railway-en                                                          | tulajdonos | Enélkül a `www`-ről jövő sütis kérések 403-at kapnak, amíg a `NEXT_PUBLIC_SERVER_URL` a Railway-URL.                                                      |
| D3  | T: `www` CNAME a Railway-célra, TLS megvárása, `GET https://www.kineticare.hu/admin` 200                                                           | tulajdonos | **Kész** (mérve 2026-09-25): a `www` a Railway-t éri el, a TLS él, a `/admin` 200.                                                                        |
| D4  | T: `NEXT_PUBLIC_SERVER_URL=https://www.kineticare.hu` és `NEXT_PUBLIC_ALLOW_INDEXING=true`, **valódi újrabuild** (a build-log nem lehet `skipped`) | tulajdonos | Ellenőrzés: canonical, sitemap, nincs `X-Robots-Tag: noindex`, örökölt átirányítások, belépés, jelszó-visszaállító link, tesztvásárlás.                   |
| D5  | Az `NEXT_PUBLIC_ALLOW_INDEXING` mai értékének megnézése                                                                                            | tulajdonos | Mérve 2026-09-23: a Railway-hoston nincs `X-Robots-Tag`, a robots meta `index, follow`; a kapu tehát ma is nyitva. Ha nem szándékos, üresre és újrabuild. |
| D6  | Barion: shop URL `https://www.kineticare.hu`, shop-ellenőrzés                                                                                      | tulajdonos | A callback- és visszatérő cím a kódban a `NEXT_PUBLIC_SERVER_URL`-ből épül. A Railway-domain maradjon élve a korábban indított fizetésekhez.              |
| D7  | Turnstile widget hostnevei: `www.kineticare.hu` és `kineticare.hu`                                                                                 | tulajdonos |                                                                                                                                                           |
| D8  | Bunny Stream: engedélyezett domainek / referrerek, ha be vannak állítva                                                                            | tulajdonos |                                                                                                                                                           |
| D9  | Resend: a domain „Verified” állapotának ellenőrzése                                                                                                | tulajdonos | A DNS-rekordok megvannak.                                                                                                                                 |
| D10 | Search Console: sitemap beküldése (`https://www.kineticare.hu/sitemap.xml`); a Domain-TXT marad                                                    | tulajdonos |                                                                                                                                                           |
| D11 | Google Ads szünetel, amíg a DNS nem az új platformra mutat                                                                                         | tulajdonos | `docs/adwords-kampany.md` 0.1.                                                                                                                            |
| D12 | A rossz helyen álló SES MX törlése az apexről (`10 feedback-smtp.us-east-1.amazonses.com`)                                                         | tulajdonos | Az átállástól független. Ha a `mail.kineticare.hu` leáll, a bejövő levél ide menne, és elveszne. A `send.kineticare.hu` MX-e marad.                       |

### 3. Systeme.io vevők átköltöztetése

| #   | Teendő                                                                       | Megjegyzés                                                                                        |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| M1  | Tömeges vevő-import CSV-ből: `npm run import:customers`                      | Útmutató: `docs/vasarlo-migracio-terv.md`. Az eszköz kész (C8), a valódi adatfeltöltés hátra van. |
| M2  | Az átállási értesítő levél kiküldése (email-job, `MIGRATION_NOTICE_CONFIRM`) | **Csak a végleges domain élesedése után.**                                                        |
| M3  | A Systeme.io előfizetés lemondása                                            | **T+14 előtt ne.** Addig a visszaállás útja is ez.                                                |

### 4. Tulajdonosi döntésre szándékosan parkolva

Ezekhez nem nyúlunk, amíg a tulajdonos nem dönt:

- mező az időpontkérő szekció gombfeliratának (ma kódban van: „Időpontot kérek”);
- a Kapcsolat űrlap sorsa (a „Kapcsolat” nevű űrlapot a weboldal most nem használja);
- a kezdőlap rejtett 11. szekciója (a 2. sor ikerpéldánya, ma „Rejtve”);
- blokkoló ellenőrzés a kódhoz kötött webcímeken (ma csak figyelmeztetés és
  „Visszaállítom …” gomb van, a mentést nem állítja meg);
- új globális beállítások (Payload globals) a kódban élő szövegekhez.

### 5. Dependabot

| PR   | Tartalom                    | Megjegyzés                                       |
| ---- | --------------------------- | ------------------------------------------------ |
| #280 | `claude-code-action` emelés | Az ellátási-lánc-őrön át, mint a #259 és a #265. |
| #281 | npm minor/patch csoport     | Az ellátási-lánc-őrön át, mint a #266.           |
| #282 | vitest 5 (major)            | Major váltás, külön átnézés és tesztfutás kell.  |

A `@payloadcms/*` verziók pinneltek; emelésük csak kifejezett tulajdonosi
kérésre, külön PR-ben (`CLAUDE.md`, TILOS ZÓNÁK 5.).

### 6. Korábbról nyitva maradt

| #       | Tétel                                                                           | Állapot                                                                                                                                                                                                                          |
| ------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W3      | beágyazott zár + `pool.max`                                                     | `pool.max` 20 (W1); a `max_connections`-t minden induláskor mérjük, szűkös keretnél RIASZTÁS. Mérve 2026-09-25 (a #307 deployja): `max_connections` 100, két konténer × 20 + 10 tartalék = 50, belefér. A beágyazott zár nyitva. |
| C6      | Consent-flow E2E stagingen, valódi PostHog-kulccsal és GA4-azonosítóval         | A harness kész (`docs/consent-e2e.md`).                                                                                                                                                                                          |
| C14     | Offsite mentés: E2E restore drill                                               | Emberi kapu: `DATABASE_URI` repo-secret, `BACKUP_AGE_RECIPIENT`, kézi futás, visszafejtés, restore sorszám-egyeztetéssel (`docs/adatbazis-mentes.md`).                                                                           |
| C15–C17 | SEO/GEO tartalmi munka, prompt-portfólió, bot-védelem ellenőrzése élesítés után | `docs/seo-geo-llm.md`.                                                                                                                                                                                                           |
| R1      | Railway legacy Config as Code kivezetése **2026-12-01 előtt**                   | `railway config migrate` előnézet, emberi jóváhagyással `--apply`, utána tiszta `railway config plan` (`docs/deploy-railway.md`).                                                                                                |
| R2      | A #292/#293 tartalom-szabályainak éles futtatása (content-job)                  | Nem ellenőriztük innen, lefutott-e: a sín Elrendezés-kitöltése és a „szakembereknek” webcímű oldal létrehozása. A naplóban „MÁR …” sorok jelzik, hogy nincs teendő (`docs/deploy-railway.md`, content-job).                      |

## Kész 2026 szeptemberében (#283–#307)

| PR   | Mi került be                                                                                                                                                                                                                                                                                          |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #283 | Akciós ár mező; a lejárat után magától a rendes ár él.                                                                                                                                                                                                                                                |
| #284 | Az akciós kurzusoldal vásárlási hierarchiája és reszponzív ritmusa.                                                                                                                                                                                                                                   |
| #285 | A rejtett (unlisted) kurzus felfedezhetősége elválik a hozzáféréstől.                                                                                                                                                                                                                                 |
| #286 | Akciós kurzus: CMS-ben szerkeszthető ikonos tartalom, áttekinthető szakaszok.                                                                                                                                                                                                                         |
| #287 | Hibabejelentő doboz a láblécből és a hibaoldalakról, szerveroldali PostHog-eseménnyel.                                                                                                                                                                                                                |
| #288 | Akciós kurzus: leírás, modulok, bónuszok és kép célzott elrendezése.                                                                                                                                                                                                                                  |
| #289 | A teljes körű review hat közepes találatának javítása (security, checkout, products).                                                                                                                                                                                                                 |
| #290 | A Payload REST-írások 500-as hibája Node 24-en; tulajdonosi fotók és kezdőlapi szövegek.                                                                                                                                                                                                              |
| #291 | Zárt-kéz sín, üres /rolunk fejléckép, DUMMY tesztértékek.                                                                                                                                                                                                                                             |
| #292 | Admin-integráció (magyar felület, menücsoportok, AA-kontraszt), szerkesztői réteg (sorcímkék, mélylink, „Szerkesztem” szalag), kezdőlapi videó feliratai CMS-ben, Tudástár-kapcsoló, fríz és „Kurzusaink” fotóhelyek. Migrációk: `20260922_225015_film_hero_feliratok`, `20260923_073659_kep_helyek`. |
| #293 | Ajánlat-kártyák blokk, Háttérfelirat, Gombos kiemelő sáv Kép mezője (migráció `20260923_083202_a_csapat_blokkmezok`), /szakembereknek a CMS-ből, kurzusoldali forrás-szalagok, mező-mélylink, induláskori seed csak friss telepítésen, „Mi hol szerkeszthető” táblázat.                               |
| #294 | Mobil sín-ugrás javítása, naprakész projektleírás és dokumentáció.                                                                                                                                                                                                                                    |
| #295 | „KÉZREHABILITÁCIÓ” feliratos logó, README-pontosítás.                                                                                                                                                                                                                                                 |
| #296 | Mobil fejléc középre igazítva, finomabb nyitás-zárás a sínen, keskeny asztalon kisebb logó.                                                                                                                                                                                                           |
| #297 | Sín: felfelé nyitásnál a képernyőről kicsúszó sorok elhalványulnak.                                                                                                                                                                                                                                   |
| #298 | 308-as átirányítás a Search Console három 404-es régi címére.                                                                                                                                                                                                                                         |
| #299 | A robots.txt engedi a nyilvános képeket (`/api/media/file/`).                                                                                                                                                                                                                                         |
| #300 | Meta Pixel: csak hozzájárulás után, azonosító nélkül nem fut.                                                                                                                                                                                                                                         |
| #301 | Űrlapok: második Turnstile-widget, újrapróbálás, 320 px; zöld sikerdoboz a hírlevélnél; stáb-értesítő javítások.                                                                                                                                                                                      |
| #302 | Search Console: Product snippets és Merchant listings hibák.                                                                                                                                                                                                                                          |
| #303 | Barion: PaymentId kötőjellel és anélkül, a v4 PaymentState csak kötőjel nélkül, Start-mezőkorlátok.                                                                                                                                                                                                   |
| #304 | Éles fizetési kör, 1. javítási kör: Barion, pénztár, Számlázz.hu, visszatérítés, e-mail, ÁSZF (alanyi adómentes mondat).                                                                                                                                                                              |
| #305 | Riasztási csatorna, napi összesítő, életjel, Figyelmet igényel blokk, AAM-keretfigyelő, havi egyeztető export, termék- és ár-őrök.                                                                                                                                                                    |
| #306 | A #305 utolsó bot-találatai: napi összesítő, AAM, riasztási sink, runbook 08, ár-verseny.                                                                                                                                                                                                             |
| #307 | W1: a Barion, a számlázás, a visszatérítés, az online elállás (`/elallas`) és a pénztár élesítés előtti keményítése; az order-poll saját queue-ja.                                                                                                                                                    |

**Biztonsági átnézés, 2026-09-23:** a #290–#293 változásain lefutott security
review nem talált kihasználható hibát.

A szerkesztői oldal leírása: `docs/szerkesztoi-utmutato.md` és
`docs/mi-hol-szerkesztheto.md`.

---

## Archív

Az alábbi szakaszok korábbi pillanatképek. A bennük nyitottként álló tételek
közül ami ma is nyitott, az fent, a „Nyitott most” alatt szerepel; a többi
lezárult vagy felváltotta a későbbi munka (például a staging-út a production
`Kineticare` szolgáltatásra, a B6 SMTP a Resendre).

### 2026-08-22 kritikus utak — a #148-ban lezárva

A teljes indoklás: `docs/review-2026-08-22-kritikus-utak.md` (vizsgálat: #142,
javítás: #143 ⊂ #144 ⊂ #148). A 26 tétel **nem tűnt el**; a kód a `mainen`
van. A #146 a merge előtt nyitottként hozta volna vissza őket — ezért a
tábla itt a #148 utáni állapot.

| #   | Súly     | Tétel                                              | Éles main        | Hol                                                      |
| --- | -------- | -------------------------------------------------- | ---------------- | -------------------------------------------------------- |
| K1  | CRITICAL | `users.purchases` RMW, vevő-zár nélkül             | kész             | #148 (`withUserPurchasesLock`)                           |
| K2  | CRITICAL | igazolatlan e-mail + vendég-kötés                  | kész (szűk)      | #148; nincs `auth.verify` / migráció                     |
| K3  | CRITICAL | ingyenes kurzus 7 napos reset-token bármely fiókra | kész             | #148                                                     |
| K4  | CRITICAL | helyesbítő kísérlet rendelés-szintű                | kész (min)       | #148 mindig `queryByKulsoAzon`; teljes térkép nincs      |
| K5  | CRITICAL | staff PATCH a számla-állapotmezőkre                | kész             | #148 `denyFieldWrite` (zóna 4, tulajdonosi merge)        |
| K6  | HIGH     | `paid` ág `else` (fail-open)                       | kész             | #148                                                     |
| W1  | WARNING  | poll-ablak beragadt `payment_pending` soron        | kész             | #148                                                     |
| W2  | WARNING  | bejelentkezve nem látja a vendég-pendinget         | kész             | #148                                                     |
| W3  | WARNING  | beágyazott zár + `pool.max`                        | részben megoldva | `pool.max` 20, induláskori mérés                         |
| W4  | WARNING  | vendég 409 idegen e-mailre (orákulum)              | kész             | #148; azonos 409, „már megvásároltad” csak belépve       |
| W5  | WARNING  | `storno-issue` job zsákutca                        | kész             | #148                                                     |
| W6  | WARNING  | hiányzó `jobs.queue` néma `false`                  | kész             | #148                                                     |
| W7  | WARNING  | számla-POST × refund, stornó nélkül                | kész             | #148                                                     |
| W8  | WARNING  | stream-token `Cache-Control` nélkül                | kész             | #148                                                     |
| W9  | WARNING  | grant e-mail nem kisbetűsít                        | kész             | #148                                                     |
| W10 | WARNING  | lejárt hozzáférés = „Már hozzáfér”                 | kész             | #148                                                     |
| W11 | WARNING  | preview `Location` Railway belső host              | kész             | #148                                                     |
| W12 | WARNING  | Barion callback rate-limit nélkül                  | kész             | #148                                                     |
| W13 | WARNING  | `pending_repoll` kimerülés néma                    | kész             | #148                                                     |
| W14 | WARNING  | vendég-aktiváló token 30 nap                       | kész             | #148 (7 nap)                                             |
| W15 | WARNING  | logger nem redaktálja a token-kulcsokat            | kész             | #148                                                     |
| W16 | WARNING  | `purchases` közvetlen írás auditálatlan            | kész             | #148                                                     |
| W17 | WARNING  | failed-login hamisítható XFF                       | kész             | #148                                                     |
| W18 | WARNING  | `/api/users/login` nincs kereten                   | kész             | #148                                                     |
| W19 | WARNING  | mark-watched `userId` törzs nincs tesztelve        | kész             | #148                                                     |
| W20 | WARNING  | paid-not-allowed / cancel-not-allowed 0 teszt      | kész             | #148                                                     |
| J2  | session  | jelszócsere után a többi session élve maradt       | kész             | más eszközök kijelentkeznek; a cserét végző sid megmarad |

Hátra ebből a listából: **W3** (Railway `max_connections` × replika mérése).
A 5. szakasz többi eldöntendője lezárva (jegyzőkönyv 9.5): J2 session-visszavonás
igen; W5 job kézi újrasorbaállításra marad; K3 7 napos token csak új/pending
customer; `auth.verify` nincs; Linear-szinkron nincs.

### Állapot most (archív, 2026-08-09)

> **Archív pillanatkép (2026-08-09)** — az alábbi sorok a 2026-08-06-i
> hibakeresés állapotát rögzítik, történeti értékük van. A 2026-08-22-i
> P0 lyukak a fenti táblában és a jegyzőkönyv 9. szakaszában élnek, nem itt.

- main: `6560c7f`, CI zöld (typecheck 0, vitest 443/0, eslint 0 error, npm audit, gitleaks). _(2026-08-09-i pillanat)_
- **A Railway ténylegesen buildel.** Korábban `Build · skipped (nothing to build)`
  döntéssel kihagyta a build lépést, és a régi `.next/` mappát indította — a deploy
  „SUCCESS"-t mutatott, miközben hetekkel régebbi kód futott. Javítva: explicit
  `buildCommand` + `healthcheckPath: /admin` (lásd README „Deploy").
- **Az owner-fiók létrehozható és működik**: a `create-first-user` végigmegy
  (~1,6 mp), az első user `owner` szerepkört kap, és bejut az adminba.
- **Az adatbázis tartalma üres.** A hibakeresés során a Postgres-szolgáltatás
  újraindításakor `initdb` futott és a kötet üresen jött vissza; a séma a
  `payload migrate`-tel teljesen helyreállt (mind a 3 migráció), de tartalom
  nincs benne. Tartalom eddig sem volt — az adminba korábban nem lehetett belépni.

A lista 4 blokkra bomlik: **(A) azonnali, rajtad múló**, **(B) integrációk
(rajtad múló)**, **(C) fejlesztési backlog (CI véd)**, **(D) opcionális/későbbi**.

---

### A) Azonnali — ezek nélkül a staging „üres héj"

| #   | Feladat                                                                                                             | Hol                           | Megjegyzés                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | ~~Owner-fiók létrehozása~~                                                                                          | `/admin`                      | **KÉSZ** (2026-08-06).                                                                                                                                                                                                   |
| A2  | **Staff-fiókok**: Kocsis Kata, Kiss Kata                                                                            | `/admin` → Users → Create New | A `role` mezőt **`staff`**-ra kell állítani — az alapértelmezés `customer`, azzal nem jutnak be az adminba. Jelszó: min. 12 karakter, kis+nagybetű + szám, az e-mail-címük ne legyen benne (a politika a 2. usertől él). |
| A3  | **Kurzusok feltöltése** (products): cím, rövid leírás, ár (`priceInHUFEnabled` + `priceInHUF`), sku, videó (később) | `/admin` → Products           | A kezdőlap kurzuskártyái innen jönnek (`getPublishedProducts`).                                                                                                                                                          |
| A4  | **Kezdőlap-tartalom** (hero-szöveg, Rólunk-blokk, GYIK)                                                             | `/admin` → Pages (`kezdolap`) | A hero és a hitel-csík a CMS-mezőkből jön.                                                                                                                                                                               |
| A5  | **„Hogyan működik" + GYIK tartalom**                                                                                | `/admin` → Pages              | Most statikus — a Katák döntik el, CMS-be kerüljön-e.                                                                                                                                                                    |
| A6  | **Menüfa** (felső navigáció)                                                                                        | `/admin` → Menus              |                                                                                                                                                                                                                          |
| A7  | **Posztok** (tudástár/blog)                                                                                         | `/admin` → Posts              | A `/blog` oldal innen jön.                                                                                                                                                                                               |
| A8  | **Valódi testimonialok** a Katáktól                                                                                 | Katák → `/admin` → Pages      | Fogyasztóvédelmi okból fiktív nem kerülhet ki — az M5-szekció szándékosan hiányzik, amíg nincs valódi idézet.                                                                                                            |

---

### B) Integrációk — a valódi fizetés / számla / mérés éléséhez

| #   | Feladat                                        | Env-változó                                                                                                              | Hol szerzed                            | Megjegyzés                                                                                                                                                                                                                                                                                       |
| --- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | **Barion sandbox** → valódi POSKey + payee     | `BARION_POSKEY_TEST`, `BARION_PAYEE_EMAIL`                                                                               | test.barion.com                        | Most álértékek — a fizetés nem indul el. Tesztkártyák: Successful `4444 8888 8888 5559`, ProblemWithCard `…4446`, LowFunds `…9999`, LostOrStolen `…1111`.                                                                                                                                        |
| B2  | **Számlázz.hu** tesztkulcs                     | `SZAMLAZZ_AGENT_KEY`                                                                                                     | szamlazz.hu (Számla Agent tesztfiók)   | A számla- és stornó-jobok csak ezzel élnek. `valaszVerzio=2`, `szamlaKulsoAzon=orderNumber` idempotencia-horgony kész.                                                                                                                                                                           |
| B3  | **PostHog** EU projekt-kulcs                   | `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` (EU: `https://eu.i.posthog.com`)                                   | posthog.com (EU projekt)               | A consent-banner és a funnel (`course_viewed` → `checkout_started` → `purchase_confirmed`) **kód szinten kész** — csak a kulcs hiányzik. Részletek: `docs/posthog.md`.                                                                                                                           |
| B4  | **Hero-videó** Bunny Stream (publikus library) | `HERO_VIDEO_STREAM_ID` (kódban), `NEXT_PUBLIC_BUNNY_STREAM_PUBLIC_LIBRARY_ID`, `NEXT_PUBLIC_BUNNY_STREAM_PULL_ZONE_HOST` | Bunny Stream                           | A `HeroVideo` komponens kész (poster-first, reduced-motion, publikus iframe). Ma a hero a CMS heroImage-re esik vissza. Útmutató: `docs/hero-video-feltoltes.md`.                                                                                                                                |
| B5  | **Adatvédelem oldal** a CMS-ben                | —                                                                                                                        | `/admin` → Pages (`adatvedelem`)       | A consent-banner ide linkel, jelenleg 404. A legacy forrásfájl (`adatvedelem.html`) a repóból kikerült — a `docs/legacy/` alatt csak a `typ-kezrehab.html` maradt; a szöveget a Katáknak kell pótolni/jóváhagyni.                                                                                |
| B6  | **E-mail (SMTP)** rendszer-levelekhez          | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`                                                         | SMTP-szolgáltató                       | A `src/lib/email/smtp.ts` STARTTLS-t kér (OWASP-fix). Az order-confirmation és a reset-password e-mail csak ezzel él.                                                                                                                                                                            |
| B7  | **Claude GitHub App + `ANTHROPIC_API_KEY`**    | GitHub repo secret                                                                                                       | github.com/apps/claude + anthropic.com | A `@claude` megemlítés issue/PR-kommentben. A `ci.yml` és `gitleaks.yml` enélkül is fut.                                                                                                                                                                                                         |
| B8  | **Google Search Console** bekötés              | `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` (opcionális HTML-meta)                                                            | search.google.com/search-console       | A kódoldali meta-kapu kész (üres env = nincs címke). 2026-08-25: a Domain-property már gyűjt impressiont a `kineticare.hu`-ra. DNS-cutover után sitemap: `/sitemap.xml`. HTML-tokent ne találj ki — a GSC adja, Railway-re, újrabuilddel. Runbook: `docs/kineticare-hu-atallas.md`.              |
| B9  | **Google Analytics (GA4)** bekötés             | `NEXT_PUBLIC_GA_MEASUREMENT_ID`                                                                                          | analytics.google.com                   | **A kódoldali fele KÉSZ** (C12, 2026-08-09): a GA a consent-állapotgépre kötve, csak `granted` után tölt be. Már csak a mérési azonosító beszerzése és Railway-beállítása kell — NEXT_PUBLIC, tehát beállítás után **újrabuild kötelező** (a CSP is ekkor nyílik meg). Részletek: `docs/ga4.md`. |
| B10 | **Linear** bekötés                             | —                                                                                                                        | linear.app                             | **Eldöntve (2026-08-22):** nincs GitHub↔Linear szinkron. A `feat/<ticket-id>-…` ágnév elég. Külön szinkron új üzemeltetési felület, a fizetéshez nem kell.                                                                                                                                       |

> **Titkok:** egyetlen kulcs sem kerülhet a repóba — sem kódba, sem konfigba, sem
> kommentbe, sem tesztfixtúrába (CLAUDE.md TILOS ZÓNÁK 1.). A Railway
> szolgáltatás-változói közé kell felvenni őket; a repóban legfeljebb az
> `.env.example` bővül a kulcs nevével, **érték nélkül**.

---

### C) Fejlesztési backlog — CI véd, a main zöld marad

| #       | Feladat                                         | Prioritás | Megjegyzés                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------- | ----------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~C1~~  | ~~Reset-password szerveroldali jelszópolitika~~ | —         | **KÉSZ** (2026-08-09): saját route-handler árnyékolja a `POST /api/users/reset-password` útvonalat (rate-limit + `validatePasswordStrength` + delegálás a Payloadnak), a politika REST-hívással sem kerülhető meg. Részletek: `docs/jelszo-politika.md`.                                                                                                                                                                                                                                                                                                                                                                                              |
| ~~C2~~  | ~~`@payloadcms/*` kormányzott bump~~            | —         | **KÉSZ (2026-08-30):** az `@payloadcms/*` és a `payload` exact-pinnelve `3.88.0`, a Next `16.3.3`. A `legacy-peer-deps` nem peer-ütközés miatt marad: a lockfile ebben a módban készült és lett validálva. A CI audit-kapu `high` szinttől blokkol.                                                                                                                                                                                                                                                                                                                                                                                                   |
| ~~C3~~  | ~~products `displayTitle` + `slug` mező~~ (SEO) | —         | **KÉSZ** (2026-08-09): `displayTitle` + egyedi `slug` mező, kanonikus `/kurzusok/{slug}` URL tartós átirányítással a régi id-s címről; minden hivatkozás a közös `courseHref()`-re állt át. Üzemeltetés: a meglévő kurzusok slugja az adminban mentéskor áll elő (addig az id-s URL él).                                                                                                                                                                                                                                                                                                                                                              |
| ~~C4~~  | ~~stornó-státusz mezők + retry-job~~            | —         | **KÉSZ** (2026-08-09): `stornoStatus`/`stornoNumber`/`stornoAttempts`/`stornoLastError` a rendelésen, `storno-issue` retry-job az order-maintenance queue-n, MAX 5 kísérlet. Részletek: `docs/szamlazz-storno.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ~~C5~~  | ~~Helyesbítő számla részrefundhoz~~             | —         | **KÉSZ** (2026-08-09): részrefundnál helyesbítő számla (`helyesbitoszamla` + `helyesbitettSzamlaszam`, negatív korrekciós tétel), `correctiveInvoiceStatus/Number/Seq` mezők + `corrective-invoice-issue` job, kétrétegű idempotenciával. Élesítés előtt egy sandbox-os végigfuttatás ajánlott.                                                                                                                                                                                                                                                                                                                                                       |
| C6      | **Consent-flow E2E**                            | Alacsony  | **A harness KÉSZ** (2026-08-15): `scripts/e2e/consent-e2e.mjs` — helyben lefuttatva 46 PASS / 0 FAIL (banner, elutasítás → 0 méréskérés 3 oldalon át, perzisztencia, visszavonási kör, billentyűzet). Futtatás: `docs/consent-e2e.md`. HÁTRA VAN: staging-futás valódi PostHog-kulccsal (`E2E_EXPECT_ANALYTICS=1`) és GA4-azonosítóval. Ismert UX-adósság: a bannerhez 32 Tab kell (fókusz-sorrend), és a fix sáv takarja a lábléc alját.                                                                                                                                                                                                             |
| ~~C7~~  | ~~PostHogProvider init→enable finomítás~~       | —         | **KÉSZ** (2026-08-09, ellenőrzéssel zárva): a `PostHogProvider` már `enableAnalyticsCapture()`-t hív granted consentre, az pedig inicializált kliensnél `opt_in_capturing()`-ot — az opt-out perzisztencia rendben, kódváltozás nem kellett.                                                                                                                                                                                                                                                                                                                                                                                                          |
| ~~C8~~  | ~~**Meglévő-vevő migráció (T-061)**~~           | —         | **KÉSZ** (2026-08-15, empirikus ellenőrzéssel zárva): a tömeges CSV-import él — `src/scripts/import-customers.ts` (`npm run import:customers`) + `src/lib/customer-import/` (parse / plan / execute / invite / send-invites), 87 unit-teszt. Ellenőrizve izolált Payload+Postgres ellen: magyar-Excel CSV (BOM, `;`, CRLF, idézőjeles mező), próbafutás = 0 írás, éles futás után a `purchases` helyes, a MÁSODIK futás 0 írás (idempotens), az új fiók `customer` szerepkört kap, a napló maszkolt címet ír, jelszó sehol. Üzemeltetés: `docs/vasarlo-migracio-terv.md`.                                                                             |
| ~~C9~~  | ~~**Newsletter** (footer-feliratkozás)~~        | —         | **KÉSZ** (2026-08-15, böngészős ellenőrzéssel zárva): lábléc-blokk minden oldalon (email + kötelező GDPR-checkbox + /adatvedelem link), a form-builder „Hírlevél" űrlapjára küld (adat, nem séma — nincs migráció). A form-submissions hook űrlap-CÍM alapján választ szerződést (szerver-oldalon, a kliens nem választhat lazábbat), feliratkozásnál staff-értesítő nem megy ki. Az űrlap seedből ÉS onInitből is létrejön (idempotens, best-effort). Spam-védelem a kapcsolat-űrlap mintájára, rate-limit: közös form-submission keret (5/10 perc/IP). NINCS (dokumentáltan): double opt-in, leiratkozó-link, Resend-szinkron — `docs/hirlevel.md`. |
| ~~C10~~ | ~~Dependabot-kör figyelése~~                    | —         | **FELVÁLTVA (2026-09-23):** a Dependabot-PR-ek rendben megnyílnak és az ellátási-lánc-őrön át mennek be (#259, #265, #266). A ma nyitott három (#280, #281, #282) fent, a „Nyitott most” 4. pontjában.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ~~C11~~ | ~~`sitemap.xml` + `robots.txt`~~                | —         | **KÉSZ** (2026-08-06): `src/app/robots.ts` + `src/app/sitemap.ts`. A robots az AI-crawlereket kifejezetten engedi. Részletek: `docs/seo-geo-llm.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ~~C12~~ | ~~GA4 bekötése a consent-állapotgépre~~         | —         | **KÉSZ** (2026-08-09): a gtag.js kizárólag `granted` consent után töltődik be (Consent Mode: default denied → update granted), revoke a `ga-disable-<ID>` kapcsolóval; a CSP csak érvényes azonosító mellett nyitja meg a Google-hostokat. Már csak a B9 (mérési azonosító beszerzése + újrabuild) van hátra. Részletek: `docs/ga4.md`.                                                                                                                                                                                                                                                                                                               |

#### Üzemeltetési tételek (2026-08-06-i hibakeresésből)

| #       | Feladat                                                | Prioritás             | Megjegyzés                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------- | ------------------------------------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ~~C13~~ | ~~`idle_in_transaction_session_timeout` a Postgresen~~ | —                     | **KÉSZ** (2026-08-09, app-oldalon): a pg pool minden kapcsolata 60 mp-es `idle_in_transaction_session_timeout` startup-paramétert kap (`src/payload.config.ts`) — az app, a migrate és a seed fedve. Maradék rés: külső session (kézi `psql`, Railway-konzol) zárját ez nem oldja; teljes lefedettséghez DB-oldali beállítás kellene (infra-döntés).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| C14     | **Adatbázis-mentés**                                   | HIGH (élesítés előtt) | **IMPLEMENTÁLVA, DE AZ OFFSITE E2E RESTORE DRILL MÉG NYITOTT EMBERI KAPU** (2026-08-30): `npm run backup:db` (credential-mentes argv, védett ideiglenes `PGPASSFILE`, pg_dump -Fc + kötelező `pg_restore --list` integritás-ellenőrzés + retenció) és napi ütemezett `db-backup.yml` workflow (age-titkosított `.dump.age` artifact, 30 nap; Postgres image digesthez kötve; plaintext cleanup `always()`). **ÉLESÍTÉSHEZ EMBERI LÉPÉS KELL:** a `DATABASE_URI` repo-secret felvétele (a Railway `DATABASE_PUBLIC_URL` értékével), egy offline őrzött age privát kulcshoz tartozó nyilvános recipient felvétele `BACKUP_AGE_RECIPIENT` repository variable-ként, a recipient kétfős out-of-band ellenőrzése, majd kézi workflow-futás, artifact-letöltés, offline visszafejtés és üres adatbázisba `--exit-on-error` restore sorszám-egyeztetéssel. Bármelyik GitHub-konfiguráció hiányában a workflow fail-closed módon piros, nem zölden kihagyott. Ajánlott mellé a Railway-natív kötet-mentés és a PITR bekapcsolása is. **2026-08-15, infrastruktúra:** kiderült, hogy a régi `Postgres` szolgáltatásnak NEM VOLT kötete (az adat a konténer múlandó lemezén élt) — az éles adatbázis átköltözött a kötetes `Postgres-c8Rg` szolgáltatásba (`postgres-ssl:18`), sorszám-egyeztetéssel igazolva; a régi szolgáltatás fagyasztott tartalék. Részletek: `docs/adatbazis-mentes.md`. |

#### SEO / GEO / LLM-optimalizálás

A **technikai réteg kész** (C11: robots + sitemap, valamint FAQPage / Course /
BreadcrumbList strukturált adat). Ami hátravan, az nagyrészt tartalmi munka —
a teljes checklist: `docs/seo-geo-llm.md`.

| #       | Feladat                                                                            | Prioritás            | Megjegyzés                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------- | ---------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C15     | **Tartalmi átvezetés minden cikken és oldalon**                                    | Közepes (folyamatos) | Kérdés-alapú alcímek, közvetlen válasz az alcím alatt, forrásmegjelölt adat, E-E-A-T szerzői bio, CEP-alapú (helyzet-, nem téma-) címek. A Katák szakmai munkája. `docs/seo-geo-llm.md` 2. fejezet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| C16     | **Prompt-portfólió + baseline-mérés**                                              | Közepes              | 25 prompt 4 típusban (bevétel / reputáció / versenytárs / rés), havi rögzítés. `docs/seo-geo-llm.md` 3. fejezet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| C17     | **Bot-védelem ellenőrzése élesítés után**                                          | Közepes              | A `robots.txt` hiába enged, ha a Cloudflare/WAF blokkolja az AI-crawlereket. Külön réteg, külön ellenőrzés.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ~~C18~~ | ~~Kurzus-felület: fejezetekre bontott tananyag, új lejátszó, admin haladás-nézet~~ | —                    | **KÉSZ** (2026-08-15): `products.modules` (modulok → leckék; videó / szöveges lecke / külső link, mellékletekkel) a régi `videos` lista MELLETT, nem destruktív migrációval — meglévő kurzus és haladás érintetlen. Új kétpaneles lejátszó (modul-akkordeon W3C APG szerint, sticky fejléc haladás-sávval, állapotfüggő akciósáv, mobil tananyag-fiók), állapot-kártyás Kurzusaim lista folytatás-gombbal, admin haladás-panel (ki kezdte el / ki nem / hány %, leckénkénti lemorzsolódás), automatikus nézettség-alapú jelölés (90%-os küszöb, saját player.js-kliens — a CSP nem engedi a Bunny scriptjét), és tanulási funnel (`course_started` → `lesson_completed` → `module_completed` → `course_completed`). Szerkesztői leírás: `docs/szerkesztoi-utmutato.md` 12. pont. **Üzemeltetés:** a régi videólistát fejezetekre bontani KIZÁRÓLAG az `npm run kurzus:videok-modulba` paranccsal szabad — kézi újrafelvitelnél minden vásárló haladása némán nullázódna. |

---

### D) Opcionális / későbbi

- **Többnyelvűség** (a Katák döntése — a szövegek most magyarul vannak).
- **Kupon / rendszer-kedvezmény** (a `plugin-ecommerce` támogatja).
- **Havi díjas tagság** (`plugin-ecommerce` subscriptions).
- **Mobilapp** (a webapp PWA-sítható).

---

### A leggyorsabb út a „teljesen élő" staginghez

1. **A2** (staff-fiókok) → **A3–A7** (tartalom) — enélkül a staging üres héj.
2. **B1** (Barion POSKey) → E2E a teljes vásárlási tölcséren, tesztkártyákkal
   (`docs/e2e-staging-runbook.md`).
3. **B2** (Számlázz.hu) → számla-kiállítás a tesztvásárlásnál.
4. **C14** (mentés) — élesítés előtt kötelező.
5. A kód-oldali, priorizált hátralék az `docs/atadas-szamlazz-kor.md` 3. szakaszában él
   (G1–G4 CI-őrök, checkout-draft, Rendelések-lista tételei stb.).
