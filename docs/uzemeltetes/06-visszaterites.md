# 06 Visszatérítés

Három helyzet: a szokásos visszatérítés, a kevés egyenleg miatt elutasított,
és a bizonytalan kimenetű (elakadt) visszatérítés. A negyedik a rendszer
automatikus visszatérítése dupla fizetésnél (5. pont).

**Két tilalom mindig:**

- Ugyanarra a rendelésre **ne indíts visszatérítést a Barion felületén** is. A
  Kineticare nem tudna róla, és a vevő kétszer kaphatja vissza a pénzt.
- Elakadt visszatérítés mellé **ne indíts újat**, amíg a 4. pont végére nem
  értél.

## 1. Mielőtt elindítod

1. **Egyenleg:** a Barion-tárcában legyen legalább a visszatérítendő összeg. A
   Barion a díját a fizetéskor levonja, és visszatérítést csak fedezetből
   teljesít. Egy 79 500 Ft-os eladás után a díj levonásával kevesebb marad,
   mint 79 500 Ft, ezért tartalék kell ([09](09-barion-egyenleg-es-kifizetes.md)).
2. **Számla:** a rendelésen a „Számla sorszáma” legyen kitöltve (a vásárlás
   után várj legalább 10 percet). A stornó és a helyesbítő az eredeti számlára
   hivatkozik. Amíg nincs kiállított számla, a panel nem engedi indítani a
   visszatérítést, és megírja, miért (3. pont).
3. **Összeg:** teljes visszatérítésnél a vevő elveszti a hozzáférést, és
   stornó készül; részlegesnél a hozzáférés megmarad, és helyesbítő számla
   készül.

## 2. Szokásos visszatérítés

1. Webshop → **Rendelések** → a rendelés → **Visszatérítés** panel.
2. Teljes összeghez hagyd üresen az összeget, részlegeshez írd be. Add meg az
   okot.
3. **Visszatérítés indítása**, majd erősítsd meg.
4. Elvárt eredmény: a panel megírja, hogy a visszatérítés megtörtént, és
   kiírja a Barion tranzakció-azonosítóját. Teljesnél a rendelés
   „Visszatérítve”, a kurzus eltűnik a vevő Kurzusaim oldaláról, és néhány
   percen belül a stornó is elkészül. Részlegesnél a helyesbítő számla készül
   el.
5. A Barion-fiókban is látszik a visszatérítés. A pénz a bank ütemezése szerint
   érkezik vissza a vevő kártyájára.
6. A vevőnek nem kell külön írnod: a rendszer minden lezárt visszatérítés után
   magától e-mailt küld neki az összeggel, és megírja, hogy a stornót vagy a
   helyesbítő számlát a Számlázz.hu külön levélben küldi. Kézzel csak akkor
   írj, ha riasztás jön ([11](11-riasztas-es-ugyelet.md)):
   - `visszateritesi-ertesito-nem-ment-ki`: a levél nem ment ki, írd meg a
     vevőnek a rendelésszámmal és az összeggel;
   - `visszateritesi-ertesito-bizonytalan`: a levél kimehetett. Előbb a Resend
     felületén (resend.com → Emails) keress rá a vevő címére (a rendelésen
     áll): ha a riasztás idejéből ott van a „Visszatérítés: <rendelésszám>”
     tárgyú levél, a levél kiment, ne írj. Csak akkor írj, ha nincs ott,
     különben a vevő két levelet kap.
7. Ha 2 óra múlva sincs stornó vagy helyesbítő: [05](05-szamla-storno-helyesbito-kezi.md).

## 3. Ha a visszatérítés nem indul el

Ezekben az esetekben pénz nem mozdult, a rendelés változatlan.

**Kevés egyenleg.** Tünet: a panel hibát ír, a riasztásban és a naplóban
`TooLowBalanceToMakeRefund` áll (riasztáskód: `visszaterites-barion-elutasitotta`).

1. Utalj a Barion-tárcára magyar bankszámláról legalább a hiányzó összeget.
2. Ha a jóváírás megjelent a tárcában, indítsd újra a 2. pont szerint.

**A számla még nem készült el.** A panel ezt írja: „A számla még nem készült
el, ezért a visszatérítés még nem indítható.” A számlát a rendszer néhány
percen belül kiállítja. Frissítsd később az oldalt; ha egy óra múlva is ezt
látod, szólj az üzemeltetőnek.

**A számla automatikus kiállítása nem sikerült.** A panel ezt írja: „A számla
automatikus kiállítása nem sikerült, ezért a visszatérítés most nem
indítható.” Ilyenkor várni hiába: a rendszer ezt a számlát magától már nem
állítja ki. A számla ettől még létezhet: egy korábbi beküldés létrehozhatta,
vagy korábban már kézzel kiállítottad.

1. Előbb keress rá a rendelésszámra a Számlázz.hu-ban
   ([05](05-szamla-storno-helyesbito-kezi.md) 1. pont), és nézd meg, hogy a
   talált számla ehhez a rendeléshez tartozik-e: a vevő neve és a végösszeg
   is ugyanaz legyen, mint a rendelésen.
   - Ha igen, **ne állíts ki újat**: ugyanarra az eladásra két számla kerülne
     a NAV-hoz.
   - Ha más vevő számlája áll ott ugyanezzel a rendelésszámmal, azt ne
     használd: a rendelésszámot egy korábbi, azóta törölt vagy elveszett
     rendelés is viselhette. Ne kérd a rögzítését, hanem szólj a fejlesztőnek
     a rendelésszámmal és a talált számla számával; ő mondja meg, hogyan
     készüljön el ennek a rendelésnek a számlája.
2. Csak ha semmit nem találsz, állítsd ki kézzel (05, 2. pont).
3. Küldd el az üzemeltetőnek a rendelésszámot, a megtalált vagy kézzel
   kiállított számla sorszámát, a teljesítés dátumát és a számla bruttó
   végösszegét. Ő a próbafutásban összeveti a végösszeget a rendelésével
   („végösszeg a megrendeléskor”), és rögzíti a rendelésen:
   `npm run record:manual-invoice` (előbb próbafutás, utána
   `OWNER_MANUAL_INVOICE_CONFIRM=igen`).
4. Ezután frissítsd a rendelést: a panel engedi a visszatérítést, és a stornó
   vagy a helyesbítő a rögzített számlához készül el.
5. Ha a vevő elállt a vásárlástól, még aznap szólj az üzemeltetőnek: az
   elállás után 14 napon belül vissza kell fizetni a pénzt.

**Más összeg ment már vissza.** A panel ezt írja: „A Barion adatai szerint
ebből a fizetésből más összeg ment már vissza, mint amennyit ez a rendelés
nyilvántart” (riasztáskód: `visszaterites-barion-elteres`, a levél mindkét
összeget megírja). Valaki valószínűleg a Barion felületén indított
visszatérítést. Ne indíts újat, se itt, se a Barionban, mert a vevő kétszer
kaphatná vissza a pénzt. Nézd meg a Barion-fiókban a fizetés
visszatérítéseit, és a rendelésszámmal szólj a fejlesztőnek, hogy egyeztesse a
rendelést. Ha a panel azt írja: „A Barion adataiból nem dönthető el, mennyi
ment már vissza ebből a fizetésből”, egy korábbi visszatérítés még
feldolgozás alatt áll: nézz vissza néhány óra múlva.

## 4. Bizonytalan kimenet (elakadt visszatérítés)

Tünet: a panel azt írja, hogy a művelet ellenőrzést igényel, időtúllépés
volt, vagy a Figyelmet igényel blokkban „elakadt visszatérítés” áll. Ilyenkor
nem tudni biztosan, hogy a Barion végrehajtotta-e.

1. **Ne indíts újat.** Várj 2 percet, és frissítsd a rendelést.
2. Ha a panelen **Feldolgozás folytatása** gomb van, nyomd meg: a rendszer a
   Barionnál ellenőrzi, mi történt, és új pénzmozgás nélkül lezárja.
3. Ha nincs gomb, vagy a folytatás sem zár le: nézd meg a Barion-fiókban,
   létrejött-e a visszatérítés ennél a fizetésnél.
   - Ha **létrejött**: a vevő megkapta a pénzt. Szólj a fejlesztőnek a
     rendelésszámmal és a Barion visszatérítés azonosítójával, hogy a rendelést
     lezárja (és a stornó elkészüljön).
   - Ha **nem jött létre**: szólj a fejlesztőnek; a visszatérítést ő indítja
     újra, miután a függő szándékot lezárta.
4. Ha a panel azt írja, hogy a helyesbítő számla kiállítása átmeneti hibába
   futott, és a rendszer a háttérben keresi a Számlázz.hu-ban, a pénz már
   visszament, és új visszatérítés nem kell. A panel mondata: „Ne állíts ki
   kézzel helyesbítőt, amíg ez az üzenet látszik.” Várj, amíg a panel
   továbblép; ha riasztás jön (`helyesbito-nem-kuldheto-be-ujra` vagy
   `helyesbito-ujraprobalas-kimerult`), akkor [05](05-szamla-storno-helyesbito-kezi.md) 4. pont.
5. A visszatérítési szándékokat a Rendszer → **Visszatérítési szándékok**
   listán látod (csak a tulajdonos). Az állapotok:

   | Állapot            | Jelentés                                                |
   | ------------------ | ------------------------------------------------------- |
   | prepared           | Előkészítve, a Barion még nem kapta meg                 |
   | provider_started   | Elküldve a Barionnak, válasz még nincs                  |
   | provider_unknown   | A válasz elveszett: nem tudni, megtörtént-e             |
   | provider_failed    | A Barion elutasította, pénz nem mozdult                 |
   | provider_succeeded | A Barion végrehajtotta, a rendelés lezárása folyamatban |
   | committed          | Kész: pénz visszament, a rendelés rögzítette            |
   | manual_review      | Emberi döntés kell: szólj a fejlesztőnek                |

## 5. Automatikus visszatérítés (dupla fizetés)

A rendszer magától próbál visszatéríteni, ha ugyanaz a vevő ugyanarra a
kurzusra kétszer fizetett, ha egy vendégfizetés munkatársi vagy tulajdonosi
fiók címére jött, vagy ha a fizetett összeg nem egyezik a rendelésével. A
vevő ilyenkor azt az üzenetet látja, hogy rövid időn belül rendezzük: vagy
megnyitjuk a hozzáférést, vagy visszaadjuk a teljes összeget.

Riasztáskódok: `automatikus-visszaterites-sikertelen`, `refund-ellenorzesre-var`
([11](11-riasztas-es-ugyelet.md)).

1. Nézd meg a Barion-fiókban mindkét fizetést (a rendelésszámokat a riasztás
   és a rendelés-lista adja).
2. Ha a visszatérítés kevés egyenleg miatt bukott el: töltsd fel a tárcát
   (3. pont), és szólj a fejlesztőnek, hogy újraindítsa.
3. Ha a pénz sorsa bizonytalan: a 4. pont szerint.
4. A vevőnek még aznap írj: melyik fizetését adod vissza, és mikor. (Ha az
   automatikus visszatérítés sikerült, a rendszer ezt maga megírja a vevőnek;
   ez a lépés a sikertelen vagy bizonytalan esetekre szól.)
