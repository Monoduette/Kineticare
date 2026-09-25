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
2. Ha találsz bizonylatot, előbb nézd meg, hogy **ehhez a rendeléshez**
   tartozik-e. A rendelésszám nem mindig egyedi: egy törölt vagy egy
   adatbázis-visszaállításkor elveszett korábbi rendelés is viselhette, és
   akkor a talált bizonylat egy másik vevőé. Ehhez a rendeléshez akkor
   tartozik, ha a vevő neve ugyanaz, mint a rendelés „Vásárlói adatok a
   megrendeléskor” mezőjében, a végösszege ugyanaz, mint a „Végösszeg a
   megrendeléskor”, és a teljesítés dátuma nem korábbi a rendelés napjánál.
   - Ha **ehhez a rendeléshez tartozik**: ne állíts ki újat. Küldd el az
     üzemeltetőnek a rendelésszámot, a bizonylat számát, a teljesítés dátumát
     és a bizonylat bruttó végösszegét, hogy a rendelésen is rögzítse.
     Számlánál, ha a „Számla állapota” „Sikertelen”, ezt az üzemeltető a
     `npm run record:manual-invoice` paranccsal teszi meg (lásd a 2. pont
     végét); utána a visszatérítés az adminból indítható. Ha a számla
     állapota még „Függőben”, a rendszer maga veszi át a megtalált számlát.
     Stornóhoz és helyesbítőhöz ilyen eszköz még nincs: ezeket a fejlesztő
     rögzíti.
   - Ha **más vevőé**, vagy a végösszeg vagy a dátum nem stimmel: a bizonylat
     egy korábbi eladásé. Ne kérd a rögzítését, és ne sztornózd. Új számlát se
     állíts ki, amíg a fejlesztő meg nem nézte: küldd el neki a rendelésszámot
     és a talált bizonylat számát, és ő mondja meg, hogyan készüljön el ennek
     a rendelésnek a számlája.
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
5. Küldd el az üzemeltetőnek a rendelésszámot, a kézi számla sorszámát, a
   teljesítés dátumát és a számla bruttó végösszegét (mind a négy kötelező).
   Az üzemeltető így rögzíti a rendelésen:
   - próbafutás, ami semmit nem ír, csak megmutatja, mit változtatna, és ha
     valami nem stimmel, miért nem írna:
     `npm run record:manual-invoice -- --order KH-ÉÉÉÉ-NNNNNN --invoice <sorszám> --teljesites ÉÉÉÉ-HH-NN`.
     Kiírja a rendelés végösszegét („végösszeg a megrendeléskor”), a fizetés
     napját és a korábbi visszatérítéseket is. A végösszeget vesse össze a
     tőled kapott bruttó végösszeggel, a fizetés napját a teljesítés
     dátumával. Ha a végösszeg eltér, vagy a próbafutás azt írja, hogy a
     rendelés korábbi hibaszövege éppen ezt a számot említi, ne írjon:
     előbb az 1. pont 2. lépése szerint derüljön ki, hogy a számla ehhez a
     rendeléshez tartozik-e;
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
kézi mellé egy második helyesbítő készülne. Ez a mondat csak addig látszik,
amíg a háttérbeli job él (legfeljebb négy futás, ötpercenként).

Ha a panel azt írja, hogy a háttérbeli újrapróbálás véget ért, és a
Számlázz.hu-nak nem ment kérés, akkor se állítsd ki kézzel: a „Feldolgozás
folytatása” gomb újra megpróbálja, és kézi kiállítás mellett kettő lenne.
Ha a gomb sem segít, szólj az üzemeltetőnek a rendelésszámmal együtt.

A panel két esetben kér kézi rendezést: ha azt írja, hogy a rendszer nem
talált helyesbítőt, és nem küldi be újra, vagy hogy a helyesbítő „nem készült
el biztosan, és a háttérbeli ellenőrzés sem járt sikerrel”. Ez utóbbi
legkorábban két órával a háttérbeli újrapróbálás indulása után jelenhet meg,
és csak akkor, ha éppen nem fut beküldés. Ilyenkor a rendszer már nem küldi be
a helyesbítőt. Előbb az 1. pont szerint keresd meg a Számlázz.hu-ban
(`KH-…-HELYESBITO-<sorszám>`). Ha megvan, küldd el a számát az üzemeltetőnek.
Ha nincs meg, állítsd ki kézzel az alábbiak szerint, és jelezd az
üzemeltetőnek a rendelésszámmal együtt.

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
