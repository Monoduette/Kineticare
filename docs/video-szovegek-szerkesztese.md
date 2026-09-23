# A kezdőlapi videó szövegeinek szerkesztése

Szerkesztőknek szóló útmutató. A kezdőlap tetején futó nyitó videón (kéznyitás)
látható minden szöveg az adminban írható át. Magát a videót és az állóképét
nem itt cseréled: ahhoz szólj a fejlesztőnek (`docs/hero-video-feltoltes.md`).

## Hol találod

1. Az admin bal oldali menüjében, a **Leggyakrabban használt** csoportban
   kattints a **Kezdőlapi videó szövegei** pontra (`/admin/kezdolap-video`).
2. A menüpont a kezdőlap szerkesztőjét nyitja meg, és rögtön kinyitja a
   **Nyitó videó (kéznyitás)** szekciót, a kurzor a **Fő cím** mezőbe kerül.
3. Ha a kezdőlapon nincs nyitó videó szekció, a nézet ezt kiírja, és
   megmondja, hogyan veheted fel újra (Szekciók lista alja, majd a lista
   elejére húzás).

Ugyanide jutsz a kezdőlap szerkesztőjéből is: **Szekciók → 01 · Nyitó videó
(kéznyitás)**.

## Mit írhatsz át

| Mező                                                                                  | Hol látszik a lapon                                                 | Korlát       |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------ |
| Fő cím                                                                                | a lap legnagyobb betűs mondata a videó fölött                       | kötelező     |
| Bevezető szöveg                                                                       | a fő cím alatt, 1–3 mondat                                          |              |
| Címkék                                                                                | rövid szavak a fő cím alatt (pl. Kéz, Csukló), legfeljebb 6         |              |
| Gombok                                                                                | legfeljebb 2; az első a hangsúlyos                                  |              |
| Beúszó szövegek a videón → A videó közepén: cím                                       | görgetés közben a videó közepén, jobb oldalt                        | 60 karakter  |
| Beúszó szövegek a videón → A videó közepén: leírás                                    | az előző cím alatt                                                  | 120 karakter |
| Beúszó szövegek a videón → A videó végén: cím                                         | a videó végén, középen                                              | 60 karakter  |
| Beúszó szövegek a videón → A videó végén: leírás                                      | az előző cím alatt, amíg az ingyenes SOS-kurzus kint van az oldalon | 120 karakter |
| Ha nincs ingyenes kurzus (ritkán kell) → A videó végén: leírás ingyenes kurzus nélkül | a fenti leírás helyett, amíg az ingyenes kurzus nincs kint          | 120 karakter |

A karakterkorlát azért van, hogy a szöveg telefonon is elférjen (a cím két, a
leírás három sorban). A mező alatti számláló gépelés közben mutatja, hány
karakternél tartasz; a korlát fölött a mentés magyar hibaüzenettel megáll.

## Ha egy beúszó mezőt üresen hagysz

A lapon a beépített alapszöveg jelenik meg, így a videó sosem marad felirat
nélkül. Az első kiadás után a tartalom-javító futás ezekbe a mezőkbe beírta a
lapon addig látható szöveget, tehát az adminban azt látod, ami a lapon van.

## Mentés és közzététel

A kezdőlap piszkozatként menti a módosítást (**Piszkozat mentése**). A
látogató csak a **Módosítások közzététele** után látja az új szöveget.
Közzététel előtt az **Előnézet** gombbal ellenőrizheted, hogyan fest a lapon.
