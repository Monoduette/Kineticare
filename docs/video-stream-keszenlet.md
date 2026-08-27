# Videó-lejátszás készenléti állapota (Bunny Stream)

> **Miről szól ez a dokumentum?** Arról, hogy a kurzusvideók lejátszásából mi
> van már kész a rendszerben, mi hiányzik még az élesítéshez, és pontosan
> milyen lépések kellenek a szerkesztők (a „lányok") oldaláról, amikor egy
> videót fel kell tenni az oldalra. Nem kell hozzá programozói tudás — a
> technikai részleteket a végén, külön szakaszban gyűjtjük.
>
> **2026-08-09 — a videó-platform a Bunny.net (Bunny Stream).** A korábbi,
> Cloudflare Streamre épült bekötés soha nem lett élesítve (nem volt fiók, nem
> volt kulcs, nem volt ott videó), a kód pedig azóta át van kötve a Bunnyra. A
> döntés indoklása és a részletes átállási terv:
> [videó-platform: döntés és Bunny-átállási terv](video-platform-dontes.md).
>
> Kapcsolódó: [hero-videó feltöltése](hero-video-feltoltes.md) (a kezdőlapi
> háttérvideó — az MÁS folyamat).

---

## 1. Egy percben: hol tartunk

| Terület                                         | Állapot                            |
| ----------------------------------------------- | ---------------------------------- |
| Jogosultság-ellenőrzés (ki nézheti a videót)    | ✅ Kész, tesztelt                  |
| Lejátszási jegy (token) kiállítása — Bunny-séma | ✅ Kész, tesztelt                  |
| Lejátszó felület (kezdőlap, előzetes, kurzus)   | ✅ Kész                            |
| Biztonsági fejléc (CSP) a Bunnyhoz              | ✅ Kész                            |
| A lejátszási lánc korábbi két kódhibája         | ✅ Javítva (4.3)                   |
| Bunny-kulcsok és library-azonosítók beállítása  | ✅ Railway-en (éles + demo), 2026-08-27; védett tár token-hitelesítése BE |
| Tananyag (modulok) GUID-dal, hosszal, Kész      | ✅ Éles + demo: Otthoni 4×23, SOS 1×5 (`import:bunny-curriculum`) |
| Videó feltöltése a rendszeren keresztül         | ❌ Nincs — a 28 kész videó a Bunnyn van; GUID-ok: `src/lib/curriculum/bunny-keszlet.ts` |
| Belépő / vásárlás e-mail                        | ⏳ Resend kulcs él; a `kineticare.hu` feladó **pending** (Tárhely.Eu DNS) |

Magyarul: a **nehéz része kész** (ki férhet hozzá, hogyan lesz belőle
biztonságos, lejáró link, mit lát a vevő hiba esetén), a kód a Bunnyra van
kötve, a két tár megvan (védett `469119`, publikus `738433`), a Railway
titkok be vannak írva, és a tananyag GUID-jai a CMS-ben vannak. Ami a
teljes vevői levélúthoz még kell: a Resend DNS-rekordok a Tárhely.Eu
névszerverén (4.5).

---

## 2. Hogyan működik ez az egész (laikus magyarázat)

A kurzusvideók **nem a mi szerverünkön** vannak, hanem a Bunny Stream nevű
videó-szolgáltatónál. Ez azért jó, mert a videó így mindenkinél gyorsan és a
sávszélességéhez igazodó minőségben indul el, telefonon is.

A videó ott egy **azonosítót** kap (egy GUID: hosszú betű-szám sorozat, pl.
`e8c1f0a2-4b17-4e7a-9f2c-0d3b5a6c7e8f`). Az oldal ezt az azonosítót tárolja —
nem magát a videófájlt.

Amikor egy vásárló megnyitja a kurzust:

1. az oldal megkérdezi a saját szerverünket: „ez az ember megvette ezt a kurzust?";
2. ha igen, a szerver kiállít egy **időkorlátos belépőjegyet** (ez a „token"),
   ami csak arra az egy videóra és csak korlátozott ideig érvényes;
3. a lejátszó ezzel a jeggyel kéri le a videót a Bunnytól.

Így a videó linkje nem osztható meg: a jegy lejár, és máshoz nem jó.

**Két videó-tár (library).** A Bunnynál a jegy-kötelezettség nem videónként,
hanem **library-szinten** kapcsolható be. Ezért a videók két tárban élnek:

| Tár          | Mi van benne                            | Kell-e jegy |
| ------------ | --------------------------------------- | ----------- |
| **Védett**   | a megvásárolható kurzus-epizódok        | igen        |
| **Publikus** | kezdőlapi hero-videó, kurzus-előzetesek | nem         |

---

## 3. Mi van már kész

### 3.1 Jogosultság-ellenőrzés és jegy-kiadás

- Végpont: `src/app/(frontend)/api/stream-token/route.ts`
- Üzleti szabályok: `src/lib/stream/issue-stream-token.ts`
- A jegy előállítása: `src/lib/stream/token.ts`
- Tesztek: `src/__tests__/stream-token.test.ts`,
  `src/__tests__/stream-token-contract.test.ts`,
  `src/__tests__/stream-token-client.test.ts`

A szabályok, amiket már betart:

- **Csak bejelentkezve** (különben 401).
- **Csak vásárlás után**: a felhasználó `purchases` listájában szerepelnie kell
  a terméknek, különben 403.
- **Információ-minimalizálás**: a nem-vevő ugyanazt a 403-at kapja akkor is, ha
  a kurzus nem is létezik — így nem lehet „kitalálni", milyen kurzusaink vannak.
- **Státusz-szabály**: közzétett kurzus → mehet; archivált → a régi vevő tovább
  nézheti; piszkozat → senki.
- **A jegy élettartama**: a videó hossza + 10 perc türelem, de legfeljebb 24 óra.
- **Hiányzó token-kulcs esetén** nem omlik össze az app: 503 + magyar üzenet
  („A videólejátszás ideiglenesen nem érhető el…") és naplóbejegyzés.

A jegy a Bunny sémája szerint készül:
`SHA256_HEX(token_auth_key + videó-GUID + expires)`, ahol az `expires` a lejárat
Unix-másodpercben — ez a szám az embed-URL-be is bekerül, és pontosan
egyeznie kell a hashelt értékkel.

### 3.2 Lejátszó felületek

| Hol                  | Komponens                                 | Videó típusa             |
| -------------------- | ----------------------------------------- | ------------------------ |
| Kezdőlap hero        | `src/components/content/HeroVideo.tsx`    | publikus marketing-videó |
| Kurzus adatlap       | `src/components/courses/PreviewVideo.tsx` | publikus előzetes        |
| „Kurzusaim" lejátszó | `src/components/account/CoursePlayer.tsx` | **védett**, jegyes       |

A `CoursePlayer` epizódlistát is ad, és a jegy lejárta előtt 5 perccel magától
új jegyet kér, hogy a lejátszás ne szakadjon meg hosszú videó közben.

> A **kezdőlapi nyitó filmsáv** (ScrollScrub / `FilmHero`) NEM tartozik ide: az
> a `public/media/film` alatti **lokális** klipeket tölti le, és `blob:`
> URL-lel adja a videóelemnek. Ezért marad a `blob:` a CSP `media-src`
> direktívájában akkor is, ha a Bunny-videó nincs bekapcsolva.

### 3.3 Admin-mezők (ide kerül az azonosító)

A kurzus (termék) szerkesztőjében:

| Mező az adminban                                 | Mire való                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| **Bemutató videó azonosítója**                   | az ingyenes előzetes GUID-ja a **publikus** libraryből                         |
| **Tananyag → modul → lecke → Videó azonosítója** | egy megvásárolható epizód GUID-ja a **védett** libraryből                      |
| **Tananyag → Hossz (másodperc)**                 | a hátralévő idő és a jegy alsó küszöbe; **ajánlott**, hiányában a jegy 24 órás |
| **Tananyag → Videó állapota**                    | csak a **Kész** állapotú videó játszható le (kézzel állítandó)                 |

### 3.4 Biztonsági fejléc (CSP)

A böngészőnek szóló „honnan tölthet be az oldal bármit" szabály
(`src/lib/security/csp.ts`) a Bunny hostjait engedi: a lejátszót az
`iframe.mediadelivery.net`-ről (`frame-src`), a poszterképeket és a
médiafájlokat a videó-library pull-zone hosztjáról (`img-src`, `media-src`).
A joker-csapdáról — ami itt már egyszer valódi hibát okozott — a 6. pont szól.

---

## 4. Mi hiányzik az élesítéshez

**2026-08-27 — a 4.1–4.2 üzemeltetési lépések az éles és a demo
Railway-szolgáltatáson kész.** A védett tár token-hitelesítése be van
kapcsolva. A GUID-ok a kurzusok **Tananyag (modulok)** mezőjében vannak
(`npm run import:bunny-curriculum`; a demo seed-tananyagot `--felulir`
írta felül). Új epizódnál továbbra is a 5. pont a szerkesztői út.

### 4.1 Bunny-oldali előkészítés és a kulcsok

A Bunny-előfizetés megvan, a videók a tárban vannak. Ami kell (és 2026-08-27-én
be is van állítva a Railway Kineticare + Kineticare-demo szolgáltatásán):

1. **Két videó-library** (4.4 a döntési dokumentumban): egy **védett**
   (token-hitelesítés BE) és egy **publikus** (token-hitelesítés KI).
2. A védett libraryn a **token-hitelesítés bekapcsolása** — enélkül a fizetőfal
   megkerülhető: a videó a jegy nélkül is nézhető.
3. A következő környezeti változók (Railway → a szolgáltatás **Variables**
   fülén; `NEXT_PUBLIC_*` után **újrabuild** `--from-source`, ne sima redeploy):

| Változó                                      | Mire kell                                           | Titok?   |
| -------------------------------------------- | --------------------------------------------------- | -------- |
| `BUNNY_STREAM_TOKEN_AUTH_KEY`                | a védett library token-kulcsa — ezzel készül a jegy | **IGEN** |
| `NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID`        | a védett library numerikus id-ja (embed-URL)        | nem      |
| `NEXT_PUBLIC_BUNNY_STREAM_PUBLIC_LIBRARY_ID` | a publikus library id-ja (hero, előzetes)           | nem      |
| `NEXT_PUBLIC_BUNNY_STREAM_PULL_ZONE_HOST`    | `vz-….b-cdn.net` — CSP + poszterképek               | nem      |

Mind a négy **opcionális** a kód szempontjából: hiányukban az app elindul és
működik, csak a videó nem játszható (magyar üzenettel, nem fekete lejátszóval).
A `.env.example` mind a négyet felsorolja, érték nélkül.

> **Figyelem — ez sokakat megtréfál:** a `NEXT_PUBLIC_` kezdetű változók a
> **build** pillanatában égnek bele az oldalba. Ha utólag állítod be őket,
> **újra kell buildelni**, különben semmi nem változik. Ugyanez igaz a
> biztonsági fejlécre is: azt is a build süti be
> (`.next/routes-manifest.json`). Vö. CLAUDE.md — „a SUCCESS deploy nem
> jelenti, hogy az új kód fut".

> **A token-kulcs titok.** Ne menjen e-mailben, chatben, képernyőképen — a
> Railway Variables felületén kell bevinni. Ha mégis kikerülne, a Bunny
> felületén azonnal újragenerálandó; a régi jegyek ilyenkor érvénytelenek, egy
> futó lejátszás megszakadhat (a lejátszó magyar üzenetet és „Újrapróbálom"
> gombot ad, nem fagy le).

### 4.5 Resend feladó-domain (Tárhely.Eu DNS)

A `RESEND_API_KEY` és az `EMAIL_FROM` az éles Kineticare-szolgáltatáson be
van állítva. A kulcs **él**: a Resend a
`kineticare.hu` domainre `pending` státuszt ad, ezért a
`Kineticare <noreply@kineticare.hu>` feladós levél 403-mal elutasított
(„domain is not verified”). Domain nélkül a Resend csak a fiók saját címére
(`info@kineticare.hu`) enged tesztküldést a `onboarding@resend.dev`
feladóval.

A névszerver: `ns.tns1.eu`–`ns.tns4.eu` (Tárhely.Eu ügyféladmin,
Domainek → DNS-kezelő). A Resend **ezeket** a rekordokat kéri a
`kineticare.hu` zónában — a gyökérre (apexre) rakott SES/DKIM TXT **nem**
elég:

| Típus | Név (a zónában)     | Érték                                              |
| ----- | ------------------- | -------------------------------------------------- |
| TXT   | `resend._domainkey` | a Resend Domains oldalon kiírt DKIM `p=…` érték    |
| MX    | `send`              | `feedback-smtp.us-east-1.amazonses.com` (prio 10)  |
| TXT   | `send`              | `v=spf1 include:amazonses.com ~all`                |

A meglévő `mail.kineticare.hu` MX-et ne vedd el: a `send` aldomain a
Resend/SES bounce-útvonala, a postafiók a gyökér MX-en marad.

Felvitel után a Resendben **Verify**, amíg az állapot **Verified**. Ezután
az éles `EMAIL_FROM` (`Kineticare <noreply@kineticare.hu>`) kimegy
tetszőleges vevőnek. A demo szolgáltatás átmenetileg
`Kineticare <onboarding@resend.dev>` feladót használ, amíg a domain
Verified nem lesz — vendég-E2E tetszőleges címre ettől még SKIP
(Resend teszt-korlát).

### 4.2 Feltöltési automatizmus — nincs, és egyelőre nem is kell

Ma nincs olyan gomb az adminban, ami feltöltené a videót a Bunnyba. A videó
feltöltése a Bunny felületén történik, a GUID-ot pedig kézzel kell bemásolni az
adminba (lásd 5. pont). Ez kis darabszámnál teljesen rendben van.

Ebből következik, hogy a **Videó állapota** mezőt (Kész / Feldolgozás alatt)
kézzel kell **Kész**-re állítani, miután a Bunny végzett a feldolgozással.

Ha valaha automata feltöltést építünk, ahhoz egy Bunny **API-kulcs** kell
(`BUNNY_STREAM_API_KEY`) — ma nincs a rendszerben, és nincs is rá szükség.

### 4.3 A lejátszási lánc két korábbi kódhibája — JAVÍTVA

Ezt a két hibát ez a dokumentum mérte be még a Cloudflare-es időszakban;
mindkettő javítva van, és regressziós teszt őrzi őket. Azért marad itt, mert a
tanulság a Bunnynál is ugyanaz:

**(a) A lejárati idő formátuma nem egyezett a két oldal között.** A szerver
ISO-8601 szöveget adott vissza, a kliens számot várt — a fizető vevő is
hibaüzenetet kapott. A tesztek nem fogták meg, mert **mindkét oldal a SAJÁT
feltevését mockolta**.

**(b) Az epizód-választás nem jutott el a szerverig.** A kliens `videoIndex`
néven küldte, a szerver `videoId` néven olvasta, ezért mindig az első videóra
állított ki jegyet.

A javítás **egyetlen közös szerződés-modul** (`src/lib/stream/contract.ts`): a
kérés-paraméterek nevei, a válasz alakja, a lejárat egyszeri
epoch-másodpercre alakítása és az embed-URL építése is itt lakik, és a
`src/__tests__/stream-token-contract.test.ts` a VALÓDI klienst a VALÓDI
szerverrel futtatja.

> **A Bunnynál ez a kockázat NAGYOBB, nem kisebb.** A jegy hash-e a lejáratot
> is köti: ha az `expiresAt` oda-vissza alakítása akár egy másodpercet
> csúszna, **minden** lejátszás elhalna, és a hibaüzenet nem utalna az okra.
> Ezért a contract-teszt a kliens által visszaalakított másodperccel
> újraszámolja a hasht, és a szerver jegyével veti össze.

---

## 5. A szerkesztői út — lépésről lépésre

> Ez a rész a tartalomkezelőknek szól. Programozás nincs benne.

### 5.1 Ingyenes előzetes videó feltevése egy kurzushoz

1. Jelentkezz be a **Bunny** felületére → **Stream** → a **PUBLIKUS** library.
2. **Upload video** → válaszd ki a fájlt → várd meg, amíg a feldolgozás
   befejeződik (pár perc; hosszabb videónál több).
3. Kattints a videóra, és másold ki a **GUID**-ot (a videó adatlapján).
4. Menj a Kineticare **adminba** → **Kurzusok** → a kurzus megnyitása.
5. A **Bemutató videó azonosítója** mezőbe illeszd be a GUID-ot → **Mentés**.
6. Nézd meg a kurzus nyilvános oldalát: az előzetes megjelenik.
   - Ha nem jelenik meg: az előzetes csak akkor látszik, ha a
     `NEXT_PUBLIC_BUNNY_STREAM_PUBLIC_LIBRARY_ID` be van állítva (4.1) — ez
     fejlesztői lépés, szólj a fejlesztőnek.

### 5.2 Megvásárolható kurzusvideó (epizód) feltevése

1. Töltsd fel a videót a **VÉDETT** libraryba (mint fent), és várd meg a
   feldolgozás végét.
2. **Fontos:** a védett libraryn a **token-hitelesítésnek bekapcsolva kell
   lennie** (ez library-szintű beállítás, nem videónkénti). Enélkül a link
   bárkinek működne.
3. Másold ki a **GUID**-ot és jegyezd fel a videó **hosszát másodpercben**
   (pl. 12:30 → 750).
4. Adminban a kurzusnál: **Tananyag (modulok)** → modul → lecke:
   - **Lecke címe**: amit a vevő lát az epizódlistában (pl. „1. rész, Bemelegítés")
   - **Videó azonosítója**: a GUID
   - **Hossz (másodperc)**: a kiszámolt szám. Ajánlott: ebből számoljuk a hátralévő időt. Üresen hagyva a lejátszás ettől még elindul (a jegy 24 órás).
   - **Videó állapota**: **Kész**
5. Mentés. A sorrend az epizódlistában a leckék sorrendje.

### 5.3 Amit NE csinálj

- **Ne tölts fel** olyan felvételt, amin páciens felismerhető, írásos
  hozzájárulás nélkül.
- **Ne írd át** a Videó azonosítóját meglévő, már vásárolt kurzusnál — a régi
  vevők lejátszása áll meg tőle.
- **Ne hagyd üresen** a hosszt, ha tudod: a hátralévő idő és a rövid lecke jegye ebből pontosabb. Üresen a lejátszás ettől még elindul.
- **Ne tedd** a kurzusvideót a publikus libraryba — azzal a fizetőfal
  megkerülhetővé válik.

---

## 6. A CSP-joker csapdája és a bizonyítéka

### 6.1 Mi a szabály

A Content-Security-Policy host-forrásában a joker (`*`) **kizárólag a
legbaloldalibb, TELJES címke helyén** állhat:

```
https://*.b-cdn.net     ✅ szabályos
https://vz-*.b-cdn.net  ❌ ÉRVÉNYTELEN — a böngésző NÉMÁN eldobja
```

A hibás alak nem ad hibaüzenetet: a forrás egyszerűen nem kerül fel a listára,
és a lejátszó fekete marad, csak a böngésző-konzolban látszó CSP-hibával.

Ez a repóban **valódi hiba volt**: a fejlécben korábban a
`https://customer-*.cloudflarestream.com` minta szerepelt három direktívában. A
Bunny hosztneve (`vz-….b-cdn.net`) pontosan ugyanebbe a csapdába hívna.

### 6.2 Mi lett belőle (a mai szabály)

- Ha a `NEXT_PUBLIC_BUNNY_STREAM_PULL_ZONE_HOST` be van állítva, a fejléc a
  **pontos** hostot engedi (`https://vz-….b-cdn.net`) — ez a lehető
  legszűkebb szabály.
- Ha nincs beállítva, a szabályos, egy címkés jokerre esik vissza
  (`https://*.b-cdn.net`), hogy az élesítés ne törjön el.
- A hosztnév csak `^[a-z0-9-]+\.b-cdn\.net$` alakú lehet; bármi más (szóköz,
  pontosvessző, útvonal, saját joker) a jokeres ágra esik vissza — így egy
  elgépelt env-érték nem tud új direktívát csempészni a fejlécbe.
- A `media-src` `blob:` forrása **marad**: enélkül a **kezdőlap nyitó
  filmsávja** (ScrollScrub) nem indul el, mert az a lokális klipet letölti,
  majd `URL.createObjectURL()`-lel adja a videóelemnek.

### 6.3 A bizonyíték (valódi böngésző)

A viselkedést valódi Chromiumban, valódi `Content-Security-Policy`
válaszfejléccel kiszolgált oldalon mértük (a mérés a Cloudflare-hostokkal
készült, de a vizsgált szabály maga a joker-elhelyezés, ami hosztnév-független).
A böngésző `securitypolicyviolation` eseménye a döntő jel: ha a forrás nem
került a listára, az esemény elsül.

| Eset                                                      | Eredmény                                                        |
| --------------------------------------------------------- | --------------------------------------------------------------- |
| A) címke-belseji joker (`customer-*` / `vz-*`)            | **mindhárom direktíva megsértve**, egyetlen kérés sem indult el |
| B) szabályos, egy címkés joker (`*.`) + `media-src blob:` | **nulla megsértés**, mindhárom erőforrás betöltött              |
| C) pontos host                                            | **nulla megsértés**, mindhárom erőforrás betöltött              |
| D) szabályos joker, de `blob:` nélkül                     | a videó átmegy, de a **filmsáv blob-videója blokkolva**         |

A regressziót a `src/__tests__/security/csp.test.ts` őrzi a CI-ban: külön teszt
tiltja a címke-belseji joker (`vz-*`, `customer-*`) visszatérését, ellenőrzi,
hogy a Cloudflare-hostok már nincsenek a fejlécben, és őrzi a `blob:`,
`worker-src`, `connect-src`, `object-src`, `base-uri`, `form-action`,
`frame-ancestors` direktívákat.

### 6.4 A teljes fejléc (pull-zone hoszt nélküli, alapértelmezett eset)

```
default-src 'self';
script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com
           https://assets.mediadelivery.net;
frame-src 'self' https://iframe.mediadelivery.net
          https://www.youtube-nocookie.com https://player.vimeo.com https://challenges.cloudflare.com;
img-src 'self' data: https://*.b-cdn.net;
media-src 'self' blob: https://*.b-cdn.net;
connect-src 'self';
style-src 'self' 'unsafe-inline';
font-src 'self';
worker-src 'self' blob:;
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'self'
```

Miért van benne `'unsafe-inline'` (és miért nincs `'unsafe-eval'`):

- **`script-src 'unsafe-inline'` — kényszer.** A Next.js App Router minden
  oldalra inline bootstrap-scriptet ír (`self.__next_f.push(...)`, a
  szerver-komponensek adatfolyama), és a Payload admin is inline scripttel adja
  át a kezdőállapotot. Kiváltani csak kérésenkénti `nonce` + `'strict-dynamic'`
  párossal lehet, amit a middleware-nek kell generálnia **és** a Payload
  adminnak is át kell vennie. Ez külön, mérendő feladat.
- **`style-src 'unsafe-inline'` — kényszer.** A React `style={{…}}` attribútumai
  (HeroVideo, ScrollScrub) és a Payload admin `<style>` blokkjai. Később
  szűkíthető `style-src-elem` + `style-src-attr` bontással.
- **`'unsafe-eval'` nincs, és nem is kell** — sem a Turnstile, sem a
  videó-beágyazás nem használ `eval`-t. (Megjegyzés: `npm run dev` alatt a HMR
  igényelhet `eval`-t; a fejlesztői élményt ez érintheti, az éles működést nem.)
- **`connect-src 'self'` elég:** iframe-es lejátszásnál a videó-kérések az
  iframe dokumentumából mennek, arra a beágyazott oldal saját CSP-je vonatkozik.
  (Ha valaha saját `<video>` + `hls.js` lejátszóra váltanánk, a pull-zone
  hosztot ide is fel kellene venni.) A PostHog a saját domainünk `/ingest`
  proxyján megy (`next.config.ts` rewrites), a Barion pedig **nem** hálózati
  hívás a böngészőből, hanem teljes oldalas átirányítás — azt a CSP nem
  korlátozza. **A fizetés tehát nem törik el.**
- A lejátszó **KERETÉNEK** hostja (`iframe.mediadelivery.net`) és a média
  pull-zone (`b-cdn.net`) **nincs** a `script-src`-ben, és nem is kerülhet oda:
  a lejátszó iframe-ként van beágyazva, az iframe-en belüli scriptekre a
  beágyazott dokumentum saját szabálya vonatkozik.
- Az `assets.mediadelivery.net` viszont **2026-08-15 óta benne van** — ez a
  Bunny player.js könyvtárának CDN-hosztja, a haladás automatikus jelöléséhez
  (a videó ~90%-ának tényleges megnézése). Tudatos, emberi döntéssel felvett
  engedély; a kockázat mérlegelése a `src/lib/security/csp.ts` `script-src`
  kommentjében él. Amivel korlátozzuk:
  - **rögzített verziójú URL** (`player-0.1.0.min.js`), nem `-latest`,
  - **Subresource Integrity** (SHA-384) + `crossorigin="anonymous"`: a böngésző
    kizárólag a bájtra ellenőrzött fájlt futtatja, tehát a „CDN alattunk
    kicseréli a kódot" forgatókönyv ki van zárva,
  - `referrerpolicy="no-referrer"`: a CDN nem tudja meg, melyik aloldalról tölt,
  - **tartalék út**: ha a script bármi miatt nem fut le (integritás-hiba,
    hálózat, blokkoló bővítmény), a lejátszó a saját, függőség nélküli
    postMessage-hidunkra esik vissza (`src/lib/stream/playerjs-client.ts`), és
    ha az sem szólal meg, a kézi „Kész, tovább" gomb rögzíti a haladást.
    A hash frissítése (emberi átnézéssel) az
    `src/lib/stream/playerjs-loader.ts` fejlécében leírt paranccsal.

---

## 7. Ha később saját (nem szolgáltatói) videóra váltanánk

Reális alternatíva, ha a költség vagy a szolgáltatófüggés zavaró. Amit tudni
érdemes, mielőtt bárki belevág:

**Mi maradna változatlan**

- A fizetőfal logikája: „megvette-e" ellenőrzés, a 403-as
  információ-minimalizálás, a státusz-szabályok
  (`src/lib/stream/issue-stream-token.ts`) — ez szolgáltató-független.
- A `GET /api/stream-token` → `200 { token, expiresAt }` wire-formátum és a
  lejátszó állapotgépe (`src/lib/stream/contract.ts`, `CoursePlayer`).
- Az admin-mezők szerkezete (azonosító, hossz, állapot) — csak az azonosító
  jelentése változna.

**Mit kellene újraírni**

| Terület        | Teendő                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jegy-kiállítás | A `src/lib/stream/token.ts` a Bunny hash-sémáját gyártja. Saját tárolónál jellemzően aláírt URL-t vagy rövid életű süti-jegyet adnánk.                                    |
| Lejátszó       | Az iframe-beágyazás helyett saját `<video>` elem kellene HLS-sel (pl. `hls.js`) — plusz függőség, plusz karbantartás.                                                     |
| Átkódolás      | A szolgáltató ma automatikusan több minőségben kódol. Saját megoldásnál ezt nekünk kellene futtatni (ffmpeg), különben mobilon akadna a lejátszás.                        |
| Kiszolgálás    | CDN nélkül a videó a saját szerverünk sávszélességét eszi. Railway-en ez gyorsan drága és lassú lesz — reálisan objektumtároló + CDN kell.                                |
| CSP            | A `frame-src`/`img-src`/`media-src` hostjai helyére az új tároló hoszt kerülne (`src/lib/security/csp.ts`). A `media-src blob:` maradna, mert a filmsávnak amúgy is kell. |
| Meglévő videók | A már feltöltött videókat le kell tölteni és átköltöztetni; a régi GUID-ok az adminban érvénytelenné válnak.                                                              |

**Rövid ajánlás:** a költség-összevetés a
[döntési dokumentum](video-platform-dontes.md) 3. pontjában él — a Bunny a
teljes éves plafon 3–11%-a. A váltásnak akkor van értelme, ha a havi számla
tartósan meghaladja egy tároló + CDN + fejlesztői karbantartás együttes
költségét — ezt előbb mérjük, ne becsüljük.

---

## 8. Ellenőrzőlista élesítés előtt

- [x] Bunny: **két library** (védett `469119` + publikus `738433`), a védetten a
      **token-hitelesítés bekapcsolva** (2026-08-27).
- [x] `BUNNY_STREAM_TOKEN_AUTH_KEY` beállítva (Railway Variables, titok) —
      éles + demo.
- [x] `NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID`,
      `NEXT_PUBLIC_BUNNY_STREAM_PUBLIC_LIBRARY_ID`,
      `NEXT_PUBLIC_BUNNY_STREAM_PULL_ZONE_HOST` beállítva **és utána
      `--from-source` újrabuildelve** (éles + demo).
- [x] Tananyag: Otthoni + SOS modulok GUID + hossz + Kész (éles és demo CMS).
- [ ] Staging / demo: egy tetszőleges videóra generált jegy tényleg lejátszható-e
      (ez igazolja az `expires` sztringgé alakításának alakját is).
- [ ] Próbavásárlás a staging-en: vétel → „Kurzusaim" → a videó elindul →
      epizódváltás → token-frissítés.
- [ ] Ellenőrzés, hogy **nem** vevőként a lejátszó 403-at ad, és a videó URL-je
      önmagában (jegy nélkül) nem játszható le.
- [ ] Böngésző-konzol: nincs CSP-hiba a kurzus- és a kezdőlapon.
- [ ] Resend: `kineticare.hu` **Verified** a Tárhely.Eu DNS-rekordok után (4.5).
