# 14 Alanyi adómentes keret (AAM)

**Mikor:** a napi összesítő vagy a Figyelmet igényel blokk azt jelzi, hogy az
alanyi adómentes keret 70%-a vagy 90%-a elfogyott. Csak akkor érvényes, ha a
cég alanyi adómentes (a számlákon „AAM” áll); 27%-os áfakulcs mellett a sor
meg sem jelenik. Ha a sor azt írja, hogy a keret **most nem számolható**, a
teendő a [11](11-riasztas-es-ugyelet.md) `aam-keret-nem-teljes` kódjánál van:
addig a keret állását a könyvelőtől kérd el.

## A szabály (Áfa tv., hatályos szöveg)

- Áfa tv. 188. § (2): az értékhatár „20 000 000 forintnak megfelelő
  pénzösszeg”; 2027-re 22 000 000 forint (378. § (1)).
- NAV: a keretbe az „áfa nélkül számított ellenérték” számít. AAM mellett a
  számla áfát nem tartalmaz, tehát a számla összege a nettó.
- Áfa tv. 191. § (2): az az ügylet, amellyel a keret átlépésre kerül, már nem
  adómentes. A Számlázz.hu tudástára szerint: „azt a számlát, amivel
  átlépnéd az alanyi adómentes keretedet, már áfásan kell kiállítanod”.
- Áfa tv. 191. § (3): átlépés után két évig nem lehet újra alanyi
  adómentességet választani.
- Áfa tv. 192. § (2): az átlépést be kell jelenteni a NAV-nak.

**A keretbe a vállalkozás minden belföldi bevétele beleszámít**, nem csak a
webshop. A Kineticare csak a saját számláit látja: tárgyévi kiállított számlák
mínusz a stornózott számlák és a helyesbítővel lezárt részleges
visszatérítések. Ez becslés; a pontos számot a könyvelő adja.

## 70%-nál

1. Küldd el a könyvelőnek a napi összesítő AAM-sorát, és kérd, hogy vesse össze
   a cég összes tárgyévi bevételével.
2. Beszéljétek meg, várhatóan mikor éritek el a határt, és mi legyen az ár.
   Ha a bruttó ár marad, a nettó bevétel a bruttó ár 1,27-ed része (79 500 Ft
   helyett kb. 62 600 Ft); ha a nettónak kell maradnia, az árat emelni kell.

## 90%-nál: az átállás előkészítése

Az átállásnak az átlépő eladás **előtt** kell megtörténnie, mert már az a
számla áfás. A könyvelő mondja meg a napot.

1. **Könyvelő:** a NAV-bejelentés (192. § (2)) és a pontos átállási nap.
2. **Számlázz.hu:** az adózási beállítás átállítása általános áfás
   működésre, a könyvelő útmutatása szerint.
3. **Railway:** a `SZAMLAZZ_AFAKULCS` értéke `27` legyen (a fejlesztő állítja,
   redeploy után ellenőrzi, hogy a deploy tényleg lefutott). Innentől minden
   új számla 27%-os áfával megy.
4. **Árak:** ha az ár változik, a kurzusok árát az átállás napján állítsd át
   az adminban.
5. **ÁSZF és impresszum:** az áfára vonatkozó mondatok frissítése (jogász
   jóváhagyásával), és a kurzusoldalak ár-szövegei.
6. **Ellenőrzés:** az első áfás számlát a könyvelő nézze meg a NAV Online
   Számlában.

## Ha a keret már betelt (100%)

Azonnal szólj a könyvelőnek. Az átlépés utáni, még AAM-mel kiállított
számlákat javítani kell, és az áfát a bruttó árból meg kell fizetni. Ne adj el
további kurzust, amíg a 90%-os lépések 1–3. pontja nincs kész.
