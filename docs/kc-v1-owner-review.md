# KC V1: tulajdonosi kéréslista és ellenőrzés

Forrás: [KC V1 review](https://docs.google.com/document/d/16qu4uU3wy1B0fziBGTNQM4CxXhGqEW-WEtg2sdxT5bI/edit), beolvasva 2026-09-05.
Fotók: a tulajdonos által megadott [Drive-mappa](https://drive.google.com/drive/folders/1Eq19mFjrMRiWQQ103kXXa5vmAQl7Eq2m), Katák / Kedvencek és Szakmai.
Kiinduló main: `9df69f0b8e6db9b1a945acf95f605699748d1204`.
Integrált main: `3f3f9c473db5d775ba5244683d92a39aba5e2a97` (PR207 is).
Az upstream footer-változás az alap része; ez a változtatáscsomag nem szerkeszti a footert.

## Közös design-brief

Minden résztvevő a repó AGENTS.md, CLAUDE.md, termektervezes skill,
ertekesitesi-ux-skill, ui-sztenderdek, szekcio-rendszer-terv,
design-review-2026-08-21, tudastar-hangnem-es-technika és vevohang-es-hirdetesszoveg
dokumentumait, valamint az aktuális komponenseket és tokeneket olvassa.
A történeti audit megfigyeléseit újra ellenőrizni kell.

Megőrzendő: világos papírfelület, KC-kék hangsúlyok, Tenor Sans és Nunito Sans,
közös L/M/S skála, finom határvonalak, szellős és következetes szekcióritmus.
A gombszótár a ui-sztenderdek 3.2 pontja. A magyarázat tegez, a terapeuták
többes szám első személyben beszélnek. A fájdalommentesség cél, nem garantált eredmény.
A kutatási eredmény, az alkalmazott szabvány és a helyi tervezői következtetés külön jelölendő.

A tulajdonos beszélgetésbeli pontosítása szerint a videó marad legfelül,
a bemutatkozó közös fotó közvetlenül alatta kap helyet. A kéz mérete,
a folyamatos fátyol és az elfogadott mobilviselkedés megmarad. A footer kívül esik a feladaton.

## Tételes követés

| ID | Kérés | Állapot |
| --- | --- | --- |
| H01 | Közös bemutatkozó fotó közvetlenül a videó alatt | Helyi CMS-előnézetben és független mobil/desktop képelhelyezési review-val ellenőrizve |
| H02 | Egykezes Higgsfield-videó, folyamatos fátyol, szöveg fölötte | Mainen: #209 és #210; a jelenlegi csomag megőrzi |
| H03 | KC-kék menü hover és aktív állapot | Mainen: #208; a lábléc megfelelő állapota #211 |
| H04 | Saját közös fotó az ingyenes SOS mellé | Saját közös fotó beillesztve; ingyenes cél ellenőrzése tesztelve |
| H05 | Itt találkozhattál velünk: Kossuth Rádió, TV2, MASE, Kézsebészeti Társaság, D3 | Négy hivatalos logó a repóban, helyi CMS-ben ellenőrizve; a D3 szervezet azonosítása hiányzik. Éles CMS-publikálás külön lépés |
| H06 | Közös fotó az Erre számíthatsz velünk szekcióhoz | Helyi előnézetben saját közös munkafotó |
| H07 | Több kontextusba illő saját fotó | 12 optimalizált fotó a könyvtárban; 7 különböző új fotó használatban |
| H08 | Három állapot helyett Így tudunk segíteni, háromrészes felosztással | Megvalósítva; három hasáb desktopon, egymás alatti utak mobilon |
| H09 | 1 közös cél: fájdalommentesség | Célként megfogalmazva, nem eredménygaranciaként |
| H10 | Így működik az online kurzus közvetlenül a kurzusblokk alatt | A tényleges helyi szekciósorrendben ellenőrizve |
| H11 | Vélemények idézőjeleinek igazítása | Az upstream iOS-javítás megőrzése; Chromium és CSS-őrteszt, tényleges iOS-mérés nélkül |
| H12 | Tudástár-címkék egységesítése | Üres címke, ismétlődés és egyetlen kártyalink tesztelve |
| H13 | Általános GYIK, online és személyes segítség közti választás | Független tartalmi review PASS; igazolt ingyenes SOS nélkül az új GYIK publikálását a CLI letiltja |
| H14 | Új saját logó a Kapcsolat részhez | A kért új logófájlra vár |
| S01 | Közös kép a Szolgáltatások oldalon | Saját közös portré beillesztve |
| S02 | a csuklód, a könyököd vagy a vállad | Javítva, helyi renderben ellenőrizve |
| S03 | Egyszerűbb címek és rövid rendelői ismertető | Árlistacímet és teljes árlistát megőrző célzott tartalmi terv, regresszióteszttel |
| S04 | Közös kép vagy három kontextusfotó | Közös fotóval megvalósítva az S01 részeként |
| S05 | Ezért fogod imádni cím és kép | Saját szakmai kontextusfotóval megvalósítva |
| S06 | A teljes kurzushoz tartozó link ne az SOS-re vigyen | A fizetős kurzus célja ellenőrizve; a nyilvános Szolgáltatások layoutban nincs harmonika. A legördülő menü SOS-terméke adminos ellenőrzést igényel |
| A01 | Rólunk kép legfeljebb fél oldalszélesség, finom hullámos szél | Kéthasábos természetes képarány; alsó 3 px-es állandó hullám, 320/1440 px és reduced-motion képpontméréssel |
| A02 | Megérdemled a profi törődést szöveg rövidítése | Rövidítve, független tartalmi review PASS |
| A03 | Amiben mások vagyunk mellé fotó | Saját közös fotó beillesztve |
| A04 | Partnerlogók mozgó sávban, megállítás és csökkentett mozgás | Hozzáférhető komponens tesztelve; tényleges partnerlogófájlok hiányoznak, a meglévő partnernévsor megmarad |
| A05 | Külön fotók a két szakmai háttér mellett | Névvel azonosított meglévő portrék, korlátozott méret és mobilos ellenőrzés; új portrék név-hozzárendelése vár |
| A06 | Nevesített bemutatkozások mellett megfelelő portré | Pontosan egyező régi név/blokk cseréje meglévő portrés komponensre; a partnernode-ok változatlanok |
| K01 | Minden Tudástár-elem azonos elvű címkét kap | H12-vel együtt tesztelve |
| C01 | Kisebb kapcsolati képek | Korlátozott portréméret; 320 px-en 238 px széles kép ellenőrizve |
| C02 | Egyszerűbb Kapcsolat-cím | Beszéljünk; helyi renderben ellenőrizve |
| P01 | Nagy és SOS kurzus külön; további felosztás később | Meglévő kínálat megőrzése |
| P02 | Kedvezményes oldal link vagy kuponkód alapján | A pontosított demó landing elkészült: /akcios-kurzus, szerkeszthető modulok/mintalecke/GYIK, noindex és fizetés nélkül. Valódi ajánlathoz külön ár- és érvényességi adatok kellenek |
| P03 | SOS minden ajánlati megjelenésénél egyértelműen ingyenes | Gomb és ellenőrzött ingyenes termékre mutató menü kezelve; az éles SOS termék nyilvános lekérése 404, adminos ellenőrzésig publikálási HOLD |

## Elfogadási feltételek

- A lista minden sora megvalósított, ellenőrzött vagy konkrét hiányzó bemenethez kötött.
- A közös kép nem szorítja ki a videót; a fizetős kínálat korán elérhető marad.
- Valódi, ellenőrzött fotóforrás, értelmes magyar képleírás, mobilon is ép arcok és kézmozdulatok.
- CMS-tartalom szerkeszthető marad; a változtatás nem írja felül rejtetten a szerkesztő döntéseit.
- A meglévő oldalak frissítése tételes, idempotens, előnézetben ellenőrizhető.
- 320, 390, 768, 1024 és 1440 px-en nincs vízszintes túlcsordulás vagy értelmetlen átfedés.
- Billentyűzetes kezelés, látható fókusz, 44 px-es gombcélok, megfelelő kontraszt és reduced-motion állapot.
- A fontos útvonalak célja a feliratnak megfelelő, az ingyenes ajánlat egyértelmű.
- A releváns tesztek, typecheck, lint, build és független review igazolja a végállapotot.

## Határok

Nem olvasunk `.env*` fájlt. Nincs éles fizetés, jogosultság- vagy dependency-változtatás,
kézi migráció, éles szolgáltatást érintő teszt, automatikus tartalomfelülírás vagy footer-áttervezés.
A jelenlegi kör kódot és ellenőrizhető tartalmi változtatást készít; az éles CMS-alkalmazás
állapota külön szerepel a záró bizonyítékban.

## Tartalmi előnézet és alkalmazás

### Média-eredetigazolás és teljes fájlvesztés

A kezelt team-képekhez verziózott, csak hozzáfűzhető igazolás tartozik a
meglévő `audit-logs` gyűjteményben. A friss feltöltés után a CLI ellenőrzi a
tényleges tárolt fájlt és az aktuális rekordot, és még az oldal publikálása
előtt rögzíti az igazolást. Sikertelen rögzítés után az újrapróbálás sem
publikálhat igazolás nélküli képet.

Korábban feltöltött képhez az operátor külön, írásmentes előnézetet kérhet:

```sh
node node_modules/tsx/dist/cli.mjs src/scripts/apply-owner-review-v1.ts --enroll-media-recovery <média-ID>
```

Az igazolt forrásfájl és a megmaradt főfájl egyezése, friss rekordellenőrzés,
operátori review és a terv kiírt ellenőrzőösszege után ugyanaz a parancs
`--apply <ellenőrzött terv SHA-256>` kapcsolóval rögzítheti az igazolást.
Ez nem publikál oldalt és nem tölthet fel ismeretlen vagy már elveszett képet.
Éles végrehajtás előtt szerkesztői szünet, mentés és konkrét műveleti terv kell.

Induláskori helyreállításnál kizárólag a legfrissebb, a rekordhoz és a
forrásbyte-okhoz illő igazolás fogadható el. Az átmeneti `restoring` állapot
nem jogosít új próbálkozásra; megszakadás vagy sikertelen igazolás-megújítás
kézi ellenőrzést kér. Siker után azonos rekord-ID, alt és fókusz marad, az új
igazolás a tényleges visszaadott és újraellenőrzött rekordhoz kötődik.
A friss olvasás és írás közötti versenyablak nem atomi zárolás: a dokumentált
szerkesztői szünet továbbra is követelmény.

A `src/scripts/apply-owner-review-v1.ts` nem része az indulási hooknak vagy a
deploynak. Argumentum nélkül csak olvas és tételes előnézetet készít:

```sh
node node_modules/tsx/dist/cli.mjs src/scripts/apply-owner-review-v1.ts
```

A futtató környezetének már rendelkeznie kell a jóváhagyott célhoz tartozó
beállításokkal. Ez nem felhatalmazás éles titkok kiolvasására vagy éles futtatásra.
A script kikapcsolt `onInit` és cron mellett indul, ellenőrzi a fotók helyi
SHA-256-át, és jelzi az egyedi szerkesztéseket, hiányzó oldalakat és piszkozatokat.
Csak az ismert korábbi tartalom pontosan egyező részeit tervezi módosítani.

Külön engedélyezett publikáláskor a teljes tételes előnézet független review-ja,
az aktuális oldalak és médiák visszaállítható mentése, valamint a szerkesztők
által egyeztetett publikálási ablak szükséges. Az alkalmazás kötelező argumentuma
a frissen ellenőrzött terv 64 karakteres hash-e:

```sh
node node_modules/tsx/dist/cli.mjs src/scripts/apply-owner-review-v1.ts --apply <ellenorzott-terv-hash>
```

A tartalom az első írás előtt és oldalanként is újraellenőrződik, de ez **nem
tranzakciós szerkesztőzár**. Egy közben elinduló szerkesztés és az írás között
marad versenyablak; a futás alatt a szerkesztést szüneteltetni kell. Nincs a
négy oldalra és a fájlfeltöltésekre kiterjedő visszagörgetés. Hiba esetén korábbi
oldalak vagy új médiafájlok már létrejöhettek: állapotfelmérés és új előnézet
kell, nem vak újrafuttatás vagy az egész oldal felülírása.

Az új, ingyenes SOS-t említő GYIK és a régi hero-gombfelirat ingyenességet
jelző frissítésének publikálását a program írás előtt letiltja,
ha nem igazolt a megfelelő kurzus közzétett és explicit ingyenes állapota.
A HOLD az előnézetben is látszik. A releváns termékek állapota, ára és
módosítási ideje a terv hash-ének része; közben megváltozott terméknél új
előnézet szükséges akkor is, ha a menücímkén nincs módosítanivaló.

Sikeres alkalmazás után új előnézetben nulla tervezett módosítás, majd a
tényleges CMS-tartalommal végzett vizuális és útvonalellenőrzés szükséges.
Eddig kizárólag a `localhost:55441/kineticare_preview` nevű helyi
adatbázison történt alkalmazás és nulla-változásos ismételt előnézet.
A helyi oldalakhoz 2026-09-05-én a négy nyilvános éles oldal pillanatképét
is átmásoltuk; a terméktesztadatok továbbra is szintetikusak. Ez nem
piszkozatokat is tartalmazó éles mentés. A tulajdonos az adminos átvezetést
jóváhagyta; a Brave „Ügyfélszerzés” lapcsoportjában a bejelentkezett éles
admin 2026-09-05-én ellenőrizve. A 2-es SOS-termék szerkesztői állapota
„Piszkozat”, a kanonikus slug helyes, a HUF-ár engedélyezése kikapcsolt.
A külön megjelenési mező „Közzétéve” jelzése nem helyettesíti a tényleges
publikálási állapotot; az ajánlati tartalom HOLD-ja megmarad. Éles írás még nem történt.
Ez nem éles tartalomfrissítési vagy kiadási bizonyíték.

A Mobbin webes mintatára ebben a böngészőben bejelentkezést kér.
Zárt Mobbin-példák megtekintését nem állítjuk; a design-indoklás a külön
dokumentumban ténylegesen megnyitott elsődleges forrásokra támaszkodik.

## Helyi ellenőrzési bizonyíték

- Nyilvános éles oldalak helyi másolatán: 38 tételes oldalmódosítás és egy
  szintetikus, ellenőrzött ingyenes termékhez tartozó menücímke alkalmazva.
  A következő előnézetben mind a négy oldal és a menü nulla módosítást tervez.
- A Szolgáltatások oldalon 320 px-en a dokumentumszélesség 320 px,
  az árlista címe és tartalma megmaradt, a teljes kurzus linkje
  `/kurzusok/otthoni-kezrehab-program`.
- A kezdőlapon nincs states blokk; a videót közvetlenül a bemutatkozás,
  a fizetős kurzusblokkot közvetlenül az online működés követi.
- Rólunk: a partnernévsor megmaradt, nincs ismétlődő HTML-azonosító.
- A CLI-menüírás utáni `revalidateTag` külön folyamatban figyelmeztethet
  hiányzó Next-környezetre. Ezért az adminos readback mellett a navigáció
  tényleges megjelenését a gyorsítótár lejárta után is ellenőrizni kell.
- A teljes párhuzamos tesztfutás 6312 PASS / 1 FAIL volt. A változatlan
  rendelésszámtesztek azonos adatbázisba írnak; a független vizsgálat
  versenymechanizmust azonosított. A teljes soros diagnosztikai futás
  6320/6320 PASS, kihagyás és retry nélkül. Ez nem helyettesíti a távoli CI-t.
- Az utolsó Services-helyfoglalási regresszió tesztje előbb megbukott,
  majd a javítással 15/15 célzott teszt PASS. A lazy fotók szélessége
  már a feldolgozott kép ismert arányából adódik, nem a betöltésből.
- Typecheck PASS; lint: 0 hiba, 3 változatlan figyelmeztetés.
  Install-script lock PASS; natív Railpack-tervinvariánsok PASS.
  `npm audit --audit-level=high`: PASS, 6 meglévő moderate jelzés,
  nincs dependency-változtatás.
- Az első PR-head (`d2447b0`) teljes soros tesztköre: 6321/6321 PASS, 279 fájl.
  Production build PASS. Meglévő buildfigyelmeztetések: middleware-elnevezés
  kivezetése és a `media-restore.ts` dinamikus fájlrendszer-tracingje.
- Az első head távoli CI-ja is PASS: 33960853223, audit és production build;
  a teljes history-s gitleaks ellenőrzés sikeres. A cloud review ezután két
  valódi problémát talált, ezért a merge a javítások ellenőrzéséig megállt.
- A P1 ajánlati összhang, P2 opcionális horgony és H13 CLI-kapu javításával:
  **6366/6366 teszt PASS, 280 fájl**, soros futás, kihagyás és retry nélkül.
  Teljes typecheck és production build PASS; lint 0 hiba, a 3 korábbi warning.
  Független kód- és tartalmi review PASS. A friss CLI-előnézet mind a négy
  helyi oldalon nulla módosítást és nulla blokkolót jelez; a termék szintetikus.
- A második cloud review után az SOS-ajánlat már nem fogad el másik ingyenes
  terméket: a kanonikus SOS-slug, publikált állapot és explicit ingyenesség
  együtt szükséges a hero, a blokkos kezdőlap és a FreeSos számára.
- Rövid mobilnézetben a betűméretek helyett a térközök csökkentek;
  nagyon alacsony nézetben a szöveg természetesen görgethető. Normál 320x568:
  44 px magas CTA-k, alsó szélek 496/552 px. A 700/701 és 480/481 px-es
  magassági határokon, illetve 568x320 fekvő nézetben a hozzáférés ellenőrizve.
- Hideg reduced-motion indulásnál a 568x320 nézet korábban eltüntette a CTA-t.
  A javítás ebben a módban álló posztert, folyamatosan olvasható főszöveget
  és a főszöveg után mindkét felirat teljes, statikus változatát adja.
  Main IAB: 320x568 és 568x320 cold reduced PASS; utóbbin 180 px görgetésnél
  a CTA 230,80–274,80 px-en, opacity 1, pointer auto; valódi SOS-kattintás PASS.
- 200%-os CSS-gyökérbetűméret stresszteszt reduced módban: 32 px gyökér,
  64 px cím, 32 px törzsszöveg; a hero szélessége 320 px marad, a szöveg és
  mindkét CTA görgetéssel hozzáférhető. Ez nem natív böngészőzoom-teszt.
  A változatlan header ebben a teljes oldalas stresszhelyzetben túlcsordul;
  ezt a PR nem javítja. Menet közbeni OS-mozgáspreferencia-váltás és tényleges
  iOS-eszközteszt sem része a teljesített bizonyítéknak.
- Normál 1280x720 végállapot: CTA-alj 630,390625 px, statikus feliratlista rejtett,
  egy videó, 52%-os fátyol, dokumentumszélesség 1280 px. A normál filmforrások,
  lépték és görgetési időzítés változatlan.
- Végleges helyi stage: **6426/6426 teszt PASS, 283 fájl**, teljes soros futás
  kihagyás és retry nélkül; typecheck és production build PASS, lint 0 hiba
  és 3 meglévő figyelmeztetés. A végső független kódreview a dokumentált
  hero- és tartalmi scope-ot jóváhagyta; az új head távoli gate-jei külön kapuk.
- Az `e6aaa27` távoli CI-ja (33966315251), auditja, buildje és gitleaks-kapui
  sikeresek. A cloud review további közvetlen-SOS-link és tárolt régi
  gombfelirat hibát jelzett. Új, célzott javítókör indult, mert a konkrét
  ellenpéldák a korábbi horgony- és seedteszteken túlmutató bizonyítékot adnak.
  A javítások helyi kapui és a következő head kiadása külön ellenőrzendők.
- A közvetlen SOS-link és P03-migráció javítása után a független ellenőrzés
  a `status: published`, `_status: draft` eltérést is reprodukálta. Az SOS-helper
  most mindkét publikált állapotot megköveteli; a célzott kör 18 pirosból
  355 zöld tesztre váltott. A normál film, a footer és az általános termékgetter változatlan.
- A `f2c8f0f` javítás helyi teljes köre: **6497/6497 PASS, 283 fájl**,
  typecheck és production build PASS; lint 0 hiba, 3 meglévő warning.
  A leállt helyi Docker elsőre adatbázis-elérési hibát okozott; a meglévő
  tesztkonténer helyreállítása után a teljes csomag kihagyás nélkül sikeres.
  A közben frissült main integrációja új exact-base kapukat igényel.
- PR207 main-integráció (`3f3f9c4`): **6923/6923 PASS, 298 fájl**, teljes
  soros futás az izolált `localhost:55441/kineticare_ci` adatbázison.
  A korábbi helyi adatbázisnevet az upstream refundtesztek tudatos célvédelme
  elutasította; a védelmet nem módosítottuk, megfelelő külön tesztadatbázist használtunk.
  Typecheck és production build PASS; lint 0 hiba, 3 meglévő warning.
  Két független review (Gauss és Avicenna) jóváhagyta a CLI/P03/H13 scope-ot.
- A `cd01680` remote CI és gitleaks sikeres, de a friss cloud review két
  további P2-t talált: abszolút saját SOS-link és a CMS nélküli H10 sorrend.
  A reprodukció 20 új URL-es és 5 sorrendi hibát igazolt. A javítás után
  a két fókuszált tesztfájl **168/168 PASS**; az exact-head teljes kapuk
  és a független review ismét kötelezőek a merge előtt.
- Az abszolút URL/H10 javítás teljes helyi köre: **6968/6968 PASS, 298 fájl**,
  kihagyás és ismétlés nélkül, ugyanazon izolált CI-adatbázison.
  Typecheck és production build PASS; lint 0 hiba, 3 meglévő warning.
  A friss 1280 px-es helyi CMS-nézet sorrendje és hero-linkjei ellenőrizve.
  Gauss a négy kódfájlt jóváhagyta, 146 saját izolált assertion PASS;
  James külön origin/path review-ja sem talált blokkoló hibát.
- A `0b541ad` remote CI/gitleaks is sikeres, de a cloud review új bizonyítéka
  az `AGENTS.md:337-343` DNS-cutover konfigurációja. A korábbi origin-mátrix
  nem fedte a Railway-primer és az ismert éles domain-kivételek együttállását.
  Az orkesztrátor egy további, szűk javítási ciklust enged: új konfigurációs
  regresszió és kizárólag a dokumentált két HTTPS-origin ellenőrzése ad új
  bizonyítékot; az általános CORS-lista továbbra sem tartalmi azonosság.
  Külön új kritérium a tárolt menü/GYIK ingyenességi állításának későbbi
  árváltozás utáni érvényessége. A merge mindkét ellenőrzés lezárásáig HOLD.
- A cutover és a dokumentált `/kezrelax` alias (nagybetűs alakokkal is)
  célzott köre **141/141 PASS**. James független origin/alias review-ja PASS.
  A mentett ajánlati szöveg és a cache bekötése 35 piros TDD-eset után
  **260/260 célzott teszttel PASS**. A GYIK csak mindkét kanonikus kurzus
  igazolt publikációja és megfelelő ára mellett állít ingyenes/fizetős
  összehasonlítást, azonos HTML és JSON-LD listából.
  Gauss jóváhagyta az összeállt 11 kód-/tesztfájlt; Avicenna külön jóváhagyta
  a 9 fájlos lifecycle/cache határt. A cache-hívás bizonyítéka mockolt
  regisztrált hook, nem élő Next/Payload termékmódosítás.
- Végső helyi teljes csomag a cutover/lifecycle/cache javítással:
  **7018/7018 PASS, 300 fájl**, kihagyás és ismétlés nélkül.
  Typecheck és production build PASS; lint 0 hiba, 3 meglévő warning.
  A friss helyi CMS-kezdőlapon a sorrend, hero-linkek és a GYIK ellenőrizve.
- A `7b3a12d` CI/gitleaks sikeres. A cloud review új, név szerint
  hivatkozott szerződést talált: `menu-seed.ts` számos SOS-tartalékútvonala.
  A korábbi feltételezés, hogy ez csak ismeretlen adatbázis-azonosító lenne,
  téves volt. Az orkesztrátor további egy szűk, bizonyítékalapú ciklust enged:
  a kurzusoldal tényleges parserének újrahasználata zárja össze a slugos és
  számos névteret, explicit regressziókkal. Külön új média-kritérium a
  jóváhagyott fotók bekötése a meglévő, induláskori fájl-helyreállításba.
  A merge mindkét javítás független ellenőrzéséig HOLD.
  A két helyi HOLD később lezárult: a számos SOS-útvonal regressziói és a
  fotó-helyreállítás fail-closed/provenance ellenőrzései sikeresek; a média-
  és CLI-javításokat független review elfogadta. A teljes fagyasztott csomag
  7125/7125 tesztje, typecheckje, lintje és buildje sikeres. Az új remote
  head CI/review és az éles CMS-publikálás továbbra is külön kapu;
  részletes bizonyíték: `docs/kc-v1-delivery-plan.md`.

## Tanulságok

- A kitöltött CMS-oldalt a seed átírása nem frissíti. Külön, tételes tartalmi terv kell.
- A kép megőrzött képaránya és a valós mobilos képmérete együtt ellenőrzendő.
- Egy ingyenes ajánlat teljes szövegének és céljának egyeznie kell; pusztán
  semleges gombfelirat nem javít ki egy fizetős kurzusra mutató ingyenes ajánlatot.
- A Lexical-tartalom rövidítését a valódi kanonikus adatszerkezettel kell
  tesztelni, különösen a megőrzendő árlista és kapcsolati információ határán.
- Egy nyilvános tartalmi pillanatkép média-ID-i nem hordozhatók át másik
  adatbázisra. A korábbi képet ismert fájl és kanonikus kapcsolat azonosítsa.
- A természetes képarány és a nulla betöltési elmozdulás külön kapu:
  az `auto` szélesség/magasság lazy betöltés előtt nulla méretet is adhat.
- Az ingyenes ajánlat rendelkezésre állását a hero szövege és hivatkozása
  is kövesse. A célblokk elrejtése vagy átrendezése sem hagyhat hamis
  „lentebb” ígéretet vagy hibás horgonylinket.
- A Payload az elhagyott opcionális horgonyt `null` értékként is visszaadhatja.
  A sorrendvédelmet ilyen ténylegesen materializált adatokkal is teszteljük;
  csak a `null` és `undefined` egyenértékű, egyedi horgonyt nem normalizálunk el.
- A publikálási előfeltétel nem maradhat puszta dokumentációs figyelmeztetés:
  hiányzó, piszkozat vagy fizetős SOS-terméknél az új GYIK-állítás előtt
  kötelező a végrehajtható, nulla írással megálló ellenőrzés.
- Az ajánlat neve is bizalmi határ: az „ingyenes” állapot önmagában nem
  bizonyítja, hogy a kiválasztott termék valóban az SOS-kurzus.
- A tárolt hero-gombfeliratot külön, pontos régi felirat+cél alapján kell
  frissíteni; a szótár átírása nem módosít már kitöltött CMS-oldalt. Az új
  ingyenességi állítás önálló P03-változásként is publikálási előfeltételhez kötött.
- A közvetlen kurzuslink és a kezdőlapi szekcióugrás külön eset: az előbbihez
  elérhető kurzus, az utóbbihoz megfelelő, látható célszekció is szükséges.
- A nav aktívállapot-segédje csak relatív útvonalakat értelmez; nem általános
  URL-azonosító. Az ajánlatellenőrzés strukturált URL-parserrel hasonlítja
  a publikus origin/apex/www célokat, query/hash és eredeti href megőrzésével.
  A CORS-kivételek önmagukban nem jelentik ugyanazt a tartalmi site-ot.
  A mátrix külső/lookalike hostot, eltérő portot/sémát és kódolt útvonalat is fed.
- A H10 sorrend két végrehajtható felület: a CMS-terv és az üres CMS
  fallback. Mindkettőn tényleges szomszédsági teszt kell, nem csak dokumentáció.
- Az alkalmazáskori productProof nem garantálja egy tartós marketingállítás
  későbbi igazságát. Az ismert, generált ajánlati szöveg renderelése és a
  gyorsítótár érvénytelenítése együtt kövesse a termék állapotát; a szabadon
  átírt szerkesztői tartalom nem korrigálható általános szövegcserével.
- A CSS-geometriai őrnek a magassági médiafeltételt is valódi viewportadattal
  kell kiértékelnie. Az ismeretlen feltétel nem nyelhető el egy inaktív ágban sem.
- A futás közbeni mozgásemuláció nem helyettesíti a hideg betöltést. A Brave
  kötése újratöltéskor elvesztette a beállítást; az IAB megőrizte, és így
  reprodukálhatóvá vált a rövid reduced-motion sáv és a CTA-k eltűnésének hibája.
