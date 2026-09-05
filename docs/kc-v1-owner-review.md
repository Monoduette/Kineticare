# KC V1: tulajdonosi kéréslista és ellenőrzés

Forrás: [KC V1 review](https://docs.google.com/document/d/16qu4uU3wy1B0fziBGTNQM4CxXhGqEW-WEtg2sdxT5bI/edit), beolvasva 2026-09-05.
Fotók: a tulajdonos által megadott [Drive-mappa](https://drive.google.com/drive/folders/1Eq19mFjrMRiWQQ103kXXa5vmAQl7Eq2m), Katák / Kedvencek és Szakmai.
Kiinduló main: `9df69f0b8e6db9b1a945acf95f605699748d1204`.
Integrált main: `3da0a89ea26589786d1469afe42732cf97bf8f61` (PR205 és PR211).
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
| H02 | Egykezes Higgsfield-videó, folyamatos fátyol, szöveg fölötte | Korábban átadva, regresszióellenőrzés |
| H03 | KC-kék menü hover és aktív állapot | Korábban átadva, regresszióellenőrzés |
| H04 | Saját közös fotó az ingyenes SOS mellé | Saját közös fotó beillesztve; ingyenes cél ellenőrzése tesztelve |
| H05 | Itt találkozhattál velünk: Kossuth Rádió, TV2, MASE, Kézsebészeti Társaság, D3 | Logófájlokra vár; nem készítünk utánzatot |
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
| P02 | Kedvezményes oldal link vagy kuponkód alapján | HOLD: kurzus, kedvezmény és lejárat kell; nincs új ár- vagy fizetési logika |
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

Az új, ingyenes SOS-t említő GYIK publikálását a program írás előtt letiltja,
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
jóváhagyta; az admin bejelentkezést kér, éles írás még nem történt.
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
