# Tulajdonosi üzemeltetési kézikönyv

Ezek a lapok a tulajdonosnak szólnak: mit nézz meg naponta, és mit tegyél,
ha egy fizetéssel, számlával, visszatérítéssel vagy vevői panasszal gond van.
Minden lap egy helyzet: mikor kell, lépésről lépésre mi a teendő, és mikor
szólj a fejlesztőnek.

Írva a 2026-09-24-i állapotra (Barion élesben, Számlázz.hu-integráció,
riasztási csatorna). Ha a felület vagy a folyamat változik, a lapot is
frissíteni kell.

| Lap                                                                         | Mikor kell                                                |
| --------------------------------------------------------------------------- | --------------------------------------------------------- |
| [01 Napi ellenőrzés](01-napi-ellenorzes.md)                                 | Minden reggel, és ha megjön a napi összesítő levél        |
| [02 Fizetett, de nincs hozzáférés](02-fizetett-de-nincs-hozzaferes.md)      | A vevő szerint fizetett, de nem látja a kurzust           |
| [03 Hiányzó levél](03-hianyzo-level.md)                                     | A vevő nem kapta meg a visszaigazolást vagy a számlát     |
| [04 Hibás számlaadat](04-hibas-szamlaadat.md)                               | Rossz név, cím vagy adószám került a számlára             |
| [05 Számla, stornó, helyesbítő kézzel](05-szamla-storno-helyesbito-kezi.md) | A rendszer nem tudta kiállítani a bizonylatot             |
| [06 Visszatérítés](06-visszaterites.md)                                     | Pénzt kell visszaadni, vagy egy visszatérítés elakadt     |
| [07 Visszaterhelés (chargeback)](07-visszaterheles.md)                      | A vevő bankja vitatja a fizetést                          |
| [08 Havi egyeztetés](08-havi-egyeztetes.md)                                 | Minden hónap 5-éig az előző hónapra                       |
| [09 Barion-egyenleg és kifizetés](09-barion-egyenleg-es-kifizetes.md)       | Havonta, és minden kivét előtt                            |
| [10 Panaszkezelés](10-panaszkezeles.md)                                     | Vevői panasz érkezett                                     |
| [11 Riasztás és ügyelet](11-riasztas-es-ugyelet.md)                         | Riasztás-levél jött, vagy a riasztást be kell állítani    |
| [12 Számla Agent kulcs cseréje](12-szamla-agent-kulcs-csere.md)             | Évente, vagy azonnal, ha a kulcs kiszivároghatott         |
| [13 Visszaállítási próba](13-visszaallitasi-proba.md)                       | Havonta a fejlesztő, negyedévente a tulajdonossal együtt  |
| [14 Alanyi adómentes keret](14-alanyi-adomentes-keret.md)                   | Ha a napi összesítő 70% fölötti keret-felhasználást jelez |

Két szabály mindenhez:

- **Rendelést, felhasználót, visszatérítési szándékot soha ne törölj**, és ne
  írd át kézzel. A pénz és a számla nyoma ezekben él.
- Ha egy lépés nem úgy megy, ahogy a lap írja, **állj meg** és szólj a
  fejlesztőnek. A rendelésszámot (KH-ÉÉÉÉ-NNNNNN) mindig írd meg, a vevő
  személyes adatait ne.
