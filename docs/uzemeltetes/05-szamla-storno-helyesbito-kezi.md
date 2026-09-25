# 05 Számla, stornó és helyesbítő kézi kiállítása

**Mikor:** a rendelésen a **Számla állapota**, a **Stornószámla állapota**
vagy a **Helyesbítő számla állapota** „Sikertelen”, vagy egy fizetett
rendelésnél 2 óra után sincs kiállított számla. A napi összesítő és a
Figyelmet igényel blokk ezeket külön sorban mutatja.

**Miért sürgős:** a számlát a teljesítés után késedelem nélkül ki kell
állítani, a visszatérítésről szóló stornót vagy helyesbítőt pedig a vevőnek
meg kell kapnia: az adóalap csak akkor csökkenthető, ha az érvénytelenítő vagy
módosító számla a vevő rendelkezésére áll (Áfa tv. 153/B. § (1) a)).

**Amit a rendszer már megpróbált:** egy bizonylatot legfeljebb ötször küld be
a Számlázz.hu-nak (a Számlázz.hu szabálya), utána „Sikertelen” lesz, és többé
nem próbálja. A sikertelen bizonylatot a rendszer nem küldi be újra: innen
kézzel kell rendezni.

## 1. Mielőtt bármit kiállítasz: létezik-e már?

Előfordul, hogy a Számlázz.hu kiállította a bizonylatot, csak a válasz nem ért
vissza. Ezért először:

1. A Számlázz.hu felületén keress rá a rendelésszámra (KH-ÉÉÉÉ-NNNNNN). A
   számla rendelésszáma és külső azonosítója is ez; a helyesbítőé
   `KH-…-HELYESBITO-<sorszám>`.
2. Ha a bizonylat **megvan**: ne állíts ki újat. Szólj az üzemeltetőnek a
   rendelésszámmal, a bizonylat számával és a teljesítés dátumával, hogy a
   rendelésen is rögzítse. Számlánál, ha a „Számla állapota” „Sikertelen”, ezt
   az üzemeltető a `npm run record:manual-invoice` paranccsal teszi meg (lásd
   a 2. pont végét); utána a visszatérítés az adminból indítható. Ha a
   számla állapota még „Függőben”, a rendszer maga veszi át a megtalált
   számlát. Stornóhoz és
   helyesbítőhöz ilyen eszköz még nincs: ezeket a fejlesztő rögzíti.
3. Ha **nincs meg**: nézd meg a rendelésen az „… utolsó hibája” mezőt. Ha
   3-as hibakód vagy kulcshiba áll benne, a Számla Agent kulcs a hibás
   ([12](12-szamla-agent-kulcs-csere.md)); ilyenkor minden számla elbukik,
   azonnal szólj a fejlesztőnek.

## 2. Számla kézzel

1. A Számlázz.hu-ban állíts ki számlát a rendelés adataiból: vevő a
   „Vásárlói adatok a megrendeléskor” mezőből, tétel a rendelés tételeiből,
   végösszeg a „Végösszeg a megrendeléskor”, fizetési mód Barion (bankkártya),
   fizetve.
2. Áfakulcs: ugyanaz, amit a rendszer használ (AAM vagy 27%, a könyvelő
   döntése szerint). Teljesítés dátuma: a fizetés napja.
3. A rendelésszám mezőbe és a megjegyzésbe írd be a rendelésszámot.
4. Vezesd fel az eltéréslistára ([08](08-havi-egyeztetes.md)): rendelésszám,
   kézi számla száma, miért kellett.
5. Küldd el az üzemeltetőnek a rendelésszámot, a kézi számla sorszámát és a
   teljesítés dátumát. Az üzemeltető így rögzíti a rendelésen:
   - próbafutás, ami semmit nem ír, csak megmutatja, mit változtatna, és ha
     valami nem stimmel, miért nem írna:
     `npm run record:manual-invoice -- --order KH-ÉÉÉÉ-NNNNNN --invoice <sorszám> --teljesites ÉÉÉÉ-HH-NN`;
   - ha a próbafutás rendben van, ugyanez `OWNER_MANUAL_INVOICE_CONFIRM=igen`
     beállítással. A rögzítés a Műveletnaplóba is bekerül.

   Ezután a rendelés „Számla állapota” „Kiállítva” lesz, a korábbi hiba szövege
   megmarad. A visszatérítés innen már indítható az adminból, és a stornó vagy
   a helyesbítő a kézi számlához készül el. Ha a rendelésen már van számlaszám,
   vagy a számla még nem „Sikertelen”, az eszköz nem ír semmit.

## 3. Stornó kézzel (teljes visszatérítés után)

1. A Számlázz.hu-ban keresd meg az eredeti számlát (a rendelés „Számla
   sorszáma”), és sztornózd.
2. Ellenőrizd, hogy a stornó a vevő e-mail-címére is kimegy (a Számlázz.hu
   küldi); ha nem, küldd el kézzel.
3. Eltéréslista: rendelésszám, stornó száma.

## 4. Helyesbítő kézzel (részleges visszatérítés után)

Amíg a rendelés Visszatérítés paneljén az áll, hogy a rendszer a háttérben
keresi a helyesbítőt a Számlázz.hu-ban („Ne állíts ki kézzel helyesbítőt, amíg
ez az üzenet látszik.”), ne állítsd ki kézzel: a rendszer maga pótolja, és a
kézi mellé egy második helyesbítő készülne.

1. A Számlázz.hu-ban az eredeti számlához állíts ki módosító (helyesbítő)
   számlát a visszatérített összeggel csökkentve.
2. A teljesítés dátuma az eredeti számla teljesítési dátuma (a rendelésen:
   „Számla teljesítési dátuma”); a helyesbítő teljesítési hónapja nem térhet
   el az eredetiétől.
3. A visszatérített összeget a rendelés „Visszatérítések” listája mutatja.
4. Eltéréslista: rendelésszám, helyesbítő száma, összeg.

## 5. Utána

- A rendelés mezői kézzel nem írhatók. A kézi **számla** számát az üzemeltető
  rögzíti (2. pont vége), utána a „Sikertelen” helyett „Kiállítva” áll a
  rendelésen. A kézi **stornó** és **helyesbítő** rögzítésére még nincs eszköz,
  ezért azoknál a „Sikertelen” felirat marad. A napi összesítő 14 nap után
  magától elhagyja; addig a levélben ismét látod. Ez nem új hiba.
- Ha egy héten belül két bizonylat is elbukik ugyanazzal a hibával, szólj a
  fejlesztőnek: az már rendszerhiba.
- A könyvelő havonta megkapja az eltéréslistát.
