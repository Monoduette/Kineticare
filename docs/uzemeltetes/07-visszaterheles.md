# 07 Visszaterhelés (chargeback)

**Mikor:** a Barion jelzi (e-mailben vagy a fiókodban), hogy a vevő bankja
vitatja egy fizetést, vagy dokumentumot kér egy fizetésről. Ez hónapokkal a
vásárlás után is érkezhet.

**Miért kell gyorsan lépni** (Barion ÁSZF, hatályos 2026.07.01.):

- 8.14.2: a Kereskedő a Kibocsátó kérésére köteles az iratokat, információt és
  egyéb dokumentumot „haladéktalanul rendelkezésre bocsátani”;
- 13.3: a Barion a visszaterheléssel érintett összeg erejéig zárolhatja a
  tárca egyenlegét;
- 6.1.11: az egyenleget a visszaterhelés benyújtására nyitva álló időszak
  végéig visszatarthatja;
- 6.1.23 f): a szerződés felmondható, ha a panaszos vagy gyanús fizetések
  aránya meghaladja az 5%-ot. Kis forgalmú hónapban egy-két vita is elég ehhez.

## 1. Még aznap: bizonyítékcsomag a rendelésszámhoz

A naplók és a levélküldési adatok 30 nap után törlődnek (Railway, Resend),
ezért ezt ne halaszd. Egy mappába gyűjtsd, a fájlnévben a rendelésszámmal:

1. **Rendelés** (Webshop → Rendelések → a rendelés), képernyőkép: rendelésszám,
   időpont, végösszeg, állapot, számla sorszáma.
2. **Hozzájárulások:** „Lemondott az elállási jogról” és az időpontja; a
   „Vásárlói adatok a megrendeléskor” mezőben az ÁSZF elfogadásának ideje; az
   „IP-cím a megrendeléskor”.
3. **Hozzáférés és használat:** Webshop → **Kurzus-haladás**, szűrés a vevőre:
   melyik leckét mikor nézte. Ez mutatja, hogy a digitális tartalmat megkapta
   és használta.
4. **Fiók:** Fiókok → Felhasználók → a vevő: a fiók létrehozásának és az
   utolsó belépésnek az ideje.
5. **Számla:** a számla PDF-je a Számlázz.hu-ból.
6. **Visszaigazoló levél:** a Resend felületén (resend.com → Emails) a levél
   kézbesítési rekordja, képernyőképpel (30 napig van meg).
7. **Barion:** a fizetés részletei a Barion-fiókból (időpont, összeg, kártya
   utolsó számjegyei, ha látszik).
8. **Naplóexport:** kérd meg a fejlesztőt, hogy a rendelésszámra szűrt
   Railway-naplót mentse le (30 napig van meg).

## 2. Válasz a Barionnak

1. A Barion által megadott határidőn belül, az általa megadott csatornán
   küldd el a csomagot, egy rövid összefoglalóval: mit vett a vevő, mikor kapta
   meg a hozzáférést, mikor és mennyit használta, és hogy az azonnali
   hozzáférés kérésével lemondott az elállási jogáról.
2. Nézd meg a Barion-fiókban, zárolt-e egyenleget a Barion.

## 3. Amit NE tegyél

- **Ne indíts visszatérítést az adminban** a vitatott fizetésre: a
  visszaterhelés már visszaviheti a pénzt, a visszatérítés így második
  kifizetés lenne.
- Ne töröld a vevőt és a rendelést: ezek a bizonyítékok.

## 4. Utána

1. A hozzáférés elvételét a fejlesztő végzi (az adminban erre nincs külön
   gomb, a felhasználó törlése nem megoldás).
2. A könyvelő dönt arról, kell-e stornó, és hogyan könyveli a visszaterhelést.
3. A vitát és a kimenetelét vezesd fel a panaszkezelési naplóba
   ([10](10-panaszkezeles.md)) és az eltéréslistára ([08](08-havi-egyeztetes.md)).
