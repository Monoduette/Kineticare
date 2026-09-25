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
   hivatkozik.
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
6. Írd meg a vevőnek, hogy a visszatérítést elindítottad, mekkora összeggel, és
   hogy a számlát érvénytelenítő vagy módosító bizonylatot e-mailben kapja.
7. Ha 2 óra múlva sincs stornó vagy helyesbítő: [05](05-szamla-storno-helyesbito-kezi.md).

## 3. Kevés egyenleg

Tünet: a panel hibát ír, a naplóban `TooLowBalanceToMakeRefund` áll. Pénz nem
mozdult, a rendelés változatlan.

1. Utalj a Barion-tárcára magyar bankszámláról legalább a hiányzó összeget.
2. Ha a jóváírás megjelent a tárcában, indítsd újra a 2. pont szerint.

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
4. A visszatérítési szándékokat a Rendszer → **Visszatérítési szándékok**
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
4. A vevőnek még aznap írj: melyik fizetését adod vissza, és mikor.
