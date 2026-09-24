# Barion süti- és adatkezelési kiegészítés — szövegterv ügyvédi felülvizsgálatra

**Készült:** 2026-08-17
**Készítette:** Kineticare fejlesztői oldal (mérés + szövegjavaslat)
**Címzett:** a KINETICARE Kft. jogi képviselője
**Státusz:** JAVASLAT. Egyetlen sora sem került még be az élő tájékoztatókba. A beillesztés az ügyvédi jóváhagyás után történik.

Ez a dokumentum nem jogi vélemény. Két dolgot ad: (1) a jelenlegi állapot mért, forrásmegjelöléssel ellenőrizhető leírását, és (2) beillesztésre kész magyar szövegjavaslatokat, amiket az ügyvéd elfogadhat, átírhat vagy elvethet.

---

## 1. Vezetői összefoglaló

A Kineticare bankkártyás fizetése a Barion Payment Zrt. Smart Gateway rendszerén keresztül működik. A Barion ehhez a saját sütijeit helyezi el a látogató eszközén, és ezekről a kereskedőnek, tehát a KINETICARE Kft.-nek kell tájékoztatnia a látogatókat a saját süti- és adatkezelési tájékoztatójában. A Barion szerződéses feltétele, hogy a nem megfelelő tájékoztatásból eredő kárt a kereskedő viseli. Ma ez a tájékoztatás teljes egészében hiányzik: a szó szerinti mérés szerint sem az adatkezelési tájékoztató, sem az ÁSZF nem tartalmazza a „Barion" szót, és egyetlen süti nevét sem sorolja fel.

A hiány két, jogilag eltérő megítélésű körre bomlik. A `ba_vid`, `ba_vid.xxx`, `ba_sid` és `ba_sid.xxx` sütik a Barion közlése szerint csalásmegelőzést szolgálnak, a Barion jogos érdeke alapján működnek, és nem hozzájáruláshoz kötöttek: ezeket elég pontosan felsorolni és leírni. A `BarionMarketingConsent.xxx`, valamint a Barion média- és hirdetőpartnereinek azonosító-szinkronizáló sütijei viszont hozzájáruláshoz kötöttek: ezekhez a látogató előzetes, tájékozott és bármikor visszavonható hozzájárulása kell, és ehhez a jelenlegi süti-kezelő sáv a mai formájában nem elegendő.

A teendő ezért három részes. Először a tájékoztató szövegének bővítése (3. és 4. fejezet). Másodszor a süti-kezelő sáv szövegének és működésének átalakítása, mert ma egyetlen „Elfogadom / Elutasítom" döntést kínál, kategóriánkénti választás nélkül, és a döntés mellé nem tárol időbélyeget, tehát a Barion által elvárt időszakos újrakérdezés jelenleg technikailag sem megvalósítható (részletes mérés a 2.4. pontban). Harmadszor pedig ugyanebben a körben rendezendő három olyan tartalmi ellentmondás, ami az ÁSZF-ben ma is benne van, és amiről a fejlesztői oldalnak nincs döntési jogköre (7. fejezet). Ezek közül az egyik közvetlenül idetartozik: az ÁSZF ma a STRIPE-ot nevezi meg fizetési szolgáltatóként, miközben a rendszer a Barionnal fizettet.

---

## 2. A jelenlegi állapot — mért leírás

Minden alábbi állítás a repó élő forrásfájljaiból származik, fájl- és sormegjelöléssel. A mérés napja: 2026-08-17.

> **Figyelmeztetés a mérés érvényességéről.** A mérés készítése közben, párhuzamos fejlesztői munkában két dolog megváltozott a munkapéldányban: a Barion Pixel kódja bekerült az oldalba, a hozzájárulás tárolása pedig időbélyeget kapott. Ezek a változások még nincsenek élesítve. Az érintett pontoknál (2.4., 2.5. és 5.4.) a szöveg jelzi, mi a kiinduló és mi a mostani állapot. A jogi szövegjavaslatokat (3., 4. és 5. fejezet) ez nem érinti, sőt a Pixel megjelenése sürgetőbbé teszi őket.

### 2.1. A jogi szövegek forrása és élő elérhetősége

A három jogi oldal szövege szó szerinti szövegfájlokból épül fel, nem az adatbázisból:

| Élő útvonal    | Oldal címe                             | Forrásfájl                             | Terjedelem |
| -------------- | -------------------------------------- | -------------------------------------- | ---------- |
| `/aszf`        | Általános szerződési feltételek        | `src/lib/legal-source/aszf.txt`        | 136 sor    |
| `/adatvedelem` | Adatkezelési és adatvédelmi szabályzat | `src/lib/legal-source/adatkezeles.txt` | 162 sor    |
| `/impresszum`  | Impresszum                             | `src/lib/legal-source/impresszum.txt`  | 27 sor     |

Az összerendelés forrása: `src/lib/legal-content.ts:233-253`. Ebből következik, hogy a jóváhagyott szöveg beillesztése egyszerű: a fenti `.txt` fájlok szerkesztésével a szöveg szó szerint jelenik meg az élő oldalon.

### 2.2. Ami ma teljesen hiányzik

Szó szerinti keresés a három forrásfájlban a `barion`, `ba_vid`, `ba_sid`, `BarionMarketingConsent` kifejezésekre, kis- és nagybetű-érzéketlenül: **0 találat.** A „Barion" szó egyetlen jogi szövegben sem szerepel, sem adatkezelőként, sem adatfeldolgozóként, sem fizetési szolgáltatóként.

Ugyanígy 0 találat a `posthog`, `google analytics`, `ga4`, `meta`, `facebook` kifejezésekre, jóllehet a rendszerben a PostHog és a Google Analytics 4 is be van kötve (`src/lib/analytics/posthog.ts`, `src/lib/analytics/ga4.ts`, kulcsok: `.env.example:122`, `.env.example:134`). Tehát a tájékoztató jelenleg egyetlen konkrét mérési vagy marketing-eszközt sem nevez meg.

### 2.3. Amit a jelenlegi süti-fejezet tartalmaz

A süti-fejezet az `adatkezeles.txt:138-153` sorokon található, „Sütik kezeléséről" címmel. Tartalma kizárólag általános kategória-leírás, négy bekezdésben: „Feltétlenül szükséges sütik" (145. sor), „Funkcionális sütik" (147. sor), „Teljesítményt növelő sütik" (149. sor), „Speciális, ún. targeting sütik" (151. sor).

Amit ez a fejezet **nem** tartalmaz:

- egyetlen süti nevét sem,
- egyetlen tárolási időtartamot sem,
- egyetlen jogalap-megjelölést sem sütinként,
- egyetlen szolgáltató nevét sem,
- táblázatos felsorolást semmilyen formában.

Az adatfeldolgozókat felsoroló rész (`adatkezeles.txt:104-105`) szintén nem nevez meg egyetlen céget sem, csak kategóriákat: „tárhely és informatikai szolgáltatók, könyvelési, könyvvizsgálati és adótanácsadási szolgáltatók, számlázási szolgáltató, hírlevél küldési szolgáltató", majd a 105. sorban arra hivatkozik, hogy a lista folyamatosan változik, és név szerinti tájékoztatás e-mailben vagy postai úton kérhető.

### 2.4. A jelenlegi süti-kezelő sáv mért működése

A süti-sáv a `src/components/analytics/ConsentBanner.tsx` fájlban él. Mért jellemzői:

| Jellemző                   | Mai állapot                                                                                                                     | Forrás                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Választható kategóriák     | Nincsenek. Egyetlen, mindent lefedő döntés.                                                                                     | `ConsentBanner.tsx:164-179` (két gomb: „Elfogadom", „Elutasítom") |
| „További beállítások" út   | Nincs.                                                                                                                          | ugyanott                                                          |
| Visszavonási út            | Van: a lábléc „Süti-beállítások" gombja újranyitja a sávot döntés után is.                                                      | `ConsentBanner.tsx:88`, `src/lib/analytics/consent.ts:29-33`      |
| A döntés tárolása          | `localStorage`, kulcs: `kc_analytics_consent`.                                                                                  | `consent.ts:22`                                                   |
| Időbélyeg a döntés mellett | Kiinduláskor nem volt. A párhuzamos munkapéldányban már van: külön `kc_analytics_consent_at` kulcs tárolja a döntés időpontját. | `consent.ts`, `CONSENT_TIMESTAMP_KEY`                             |
| Időszakos újrakérdezés     | Kiinduláskor nem volt megvalósítható. A munkapéldányban 365 napra van állítva, tehát a Barion 13 hónapos felső korlátján belül. | `consent.ts`, `CONSENT_MAX_AGE_DAYS = 365`                        |
| Megszólítás                | Magázó: „Az analitika csak a hozzájárulásával kapcsol be."                                                                      | `ConsentBanner.tsx:162`                                           |

A megszólítás önmagában is eltér az oldal többi részétől, ami tegez. Példa a mai tegező hangra a vásárlás-visszaigazoló levélben: „Köszönjük a vásárlásod! A fizetésed sikeres, a kurzushozzáférésed aktív." (`src/lib/email/templates/order.ts:76`).

A sáv mai szövege szó szerint: „Sütiket használunk a felhasználói élmény javításához és a látogatottsági statisztikák készítéséhez. Az analitika csak a hozzájárulásával kapcsol be. Részletek az adatvédelmi tájékoztatóban." (`ConsentBanner.tsx:160-163`). Ez a szöveg nem említ marketinget, hirdetéseket, adatmegosztást partnerekkel, sem személyre szabást.

### 2.5. A Barion Pixel jelenlegi állapota a kódban

**A mérés kiindulásakor** a `src/` mappában a `BarionPixel`, `barion-pixel`, `pixelId`, `BP_ID` mintákra 0 találat volt: a Barion Pixel követőkód nem volt beépítve az oldalba.

**A dokumentum lezárásakor** ez megváltozott. A párhuzamos fejlesztői munkában elkészült a Barion Pixel beépítése: `src/components/analytics/BarionPixel.tsx` és `src/lib/analytics/barion-pixel.ts`. A kód a Barion hivatalos `bp("init", "addBarionPixelId", …)` hívására épül (`BarionPixel.tsx:67`), és képkép-alapú tartaléklekérést is tartalmaz JavaScript nélküli böngészőkhöz (`barion-pixel.ts:96-97`). Ez a munka még nincs élesítve.

A fizetési integráció ettől függetlenül régóta él: a vásárló a Barion Smart Gateway oldalára irányítódik át (`src/lib/barion/start.ts:149`, a válasz `GatewayUrl` mezője), a fizetés eredményét pedig a `src/app/(frontend)/api/barion/callback/route.ts` végpont dolgozza fel.

**Ennek jogi jelentősége van, és ez ügyvédi tisztázást igényel (lásd a 6. fejezet K1 kérdését):** a marketing körű sütikre vonatkozó tájékoztatás akkor válik élessé, amikor a Barion Pixel élesedik. Mivel a Pixel kódja most már készen áll, a jogi szöveg jóváhagyása lett a szűk keresztmetszet: a Pixel élesítése előtt a tájékoztatónak készen kell lennie. A csalásmegelőzési körű sütikre vonatkozó tájékoztatást a Barion már a Smart Gateway használatához köti, tehát az a mai működés mellett is szükséges lehet. A fejlesztői oldal ezt a határvonalat nem tudja megvonni.

---

## 3. Beillesztésre kész szöveg a süti-tájékoztatóhoz

**Javasolt hely:** az `adatkezeles.txt` „Sütik kezeléséről" fejezetén belül, a mai 151. sor („Speciális, ún. targeting sütik") után, a 152. sor („6.3. A sütik beállítása") elé. Így a mai általános kategória-leírás megmarad, és utána következik a konkrét, nevesített felsorolás.

**Megjegyzés az ügyvédnek:** az alábbi táblázatok a Barion sütijeit tartalmazzák. A saját, működéshez szükséges sütijeinket (munkamenet, hozzájárulás-tárolás), valamint a PostHog és a Google Analytics 4 tételeit ugyanebbe a két táblázatba kellene felvenni, de azok pontos listáját külön mérés adja meg. Ez a dokumentum ezeket szándékosan nem találja ki.

---

### Javasolt szöveg — bevezető bekezdés

> ## 6.2/a. A Weboldalon használt konkrét sütik
>
> Az alábbi táblázatok a Weboldalon ténylegesen elhelyezett sütiket sorolják fel. A táblázatokban megjelölt tárolási idő azt jelenti, hogy a süti mennyi ideig marad az eszközödön, ha közben nem törlöd, illetve nem vonod vissza a hozzájárulásodat.
>
> ### A működéshez elengedhetetlen sütik
>
> Ezek a sütik a Weboldal biztonságos működéséhez szükségesek, ezért a használatuk nem a hozzájárulásodon alapul. A bankkártyás fizetést a Barion Payment Zrt. (székhely: [KITÖLTENDŐ]) biztosítja a Barion Smart Gateway rendszerén keresztül. A Barion az alábbi sütiket a saját jogos érdeke alapján, a bankkártyás visszaélések kiszűrése céljából helyezi el:

**Kitöltendő az ügyvédnek:** a Barion Payment Zrt. hatályos székhelyét és cégadatait a Barion hivatalos közleményéből vagy a cégnyilvántartásból kell átvenni. A jelen dokumentum forrásanyaga ezt nem tartalmazta, ezért szándékosan nem írtuk be emlékezetből.

| Süti neve    | Célja                                                                                                                                                                                                                                                                                                                                                                                     | Szolgáltató         | Tárolási idő                            | Jogalap                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------- |
| `ba_vid`     | A bankkártyás csalások kiszűrése a Barion Smart Gateway használata során, az eszköz digitális ujjlenyomata és a böngészési szokások alapján. Biztosítja, hogy az így gyűjtött adatokról meg lehessen állapítani: ugyanattól a felhasználótól származnak.                                                                                                                                  | Barion Payment Zrt. | Az utolsó frissüléstől számított 1,5 év | A Barion Payment Zrt. jogos érdeke a csalásmegelőzéshez (GDPR 6. cikk (1) bekezdés f) pont) |
| `ba_vid.xxx` | Ugyanaz a cél, mint a `ba_vid` esetében: a böngészési szokások követése két munkamenet között ezen a honlapon. Gyűjtött adatok: a `ba_vid` azonosító, a felhasználóhoz kapcsolódó azonosító (a böngésző tulajdonságaiból képzett hash), az első, a mostani és az utolsó látogatás időbélyege, az aktuális munkamenet azonosítója, valamint a harmadik feles sütikre adott engedély ténye. | Barion Payment Zrt. | 1,5 év                                  | A Barion Payment Zrt. jogos érdeke a csalásmegelőzéshez (GDPR 6. cikk (1) bekezdés f) pont) |
| `ba_sid`     | A munkamenet azonosítása honlapokon átívelően.                                                                                                                                                                                                                                                                                                                                            | Barion Payment Zrt. | 30 perc                                 | A Barion Payment Zrt. jogos érdeke a csalásmegelőzéshez (GDPR 6. cikk (1) bekezdés f) pont) |
| `ba_sid.xxx` | A böngésző munkamenetének azonosítása ezen a honlapon belül.                                                                                                                                                                                                                                                                                                                              | Barion Payment Zrt. | 30 perc                                 | A Barion Payment Zrt. jogos érdeke a csalásmegelőzéshez (GDPR 6. cikk (1) bekezdés f) pont) |

> A fenti sütik lejárati ideje a használat során meghosszabbodhat. Az ebből eredő adatgyűjtés nem igényel külön hozzájárulást.
>
> **Sütin kívüli technológia.** A Barion a csalásmegelőzés céljából a böngésződ digitális ujjlenyomatát is felhasználja. Ennek célja a csaló munkamenetek kiszűrése, és lehetővé teszi a böngésző azonosítását az eszközök között. A Barion ezt az azonosítást más, a Barion Smart Gateway rendszerét használó kereskedők oldalain is felhasználja.

> ### Marketingsütik
>
> Ezeket a sütiket kizárólag akkor helyezzük el, ha ehhez a süti-kezelő sávban hozzájárulsz. A hozzájárulásodat bármikor módosíthatod vagy visszavonhatod a lábléc „Süti-beállítások" pontjában, és a visszavonás nem érinti a visszavonás előtti adatkezelés jogszerűségét.

| Süti neve                                      | Célja                                                                                                                                                                               | Szolgáltató                                                 | Tárolási idő                          | Jogalap                                                 |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------- |
| `BarionMarketingConsent.xxx`                   | Annak tárolása, hogy hozzájárultál-e ahhoz, hogy a böngészési szokásaidból származó adatokat gyűjtsék, és a vásárlási szokásaidat személyre szabott hirdetések céljából vizsgálják. | Barion Payment Zrt.                                         | 1,5 év                                | A Te hozzájárulásod (GDPR 6. cikk (1) bekezdés a) pont) |
| A Barion média- és hirdetőpartnereinek sütijei | A Barion és az adott partner felhasználói azonosítóinak szinkronizálása, azaz egymáshoz párosítása.                                                                                 | Barion Payment Zrt. és a 6.2/b. pontban felsorolt partnerei | A partner saját tájékoztatója szerint | A Te hozzájárulásod (GDPR 6. cikk (1) bekezdés a) pont) |

**Jelölés az ügyvédnek:** a Barion közlése a partneri sütik nevét és tárolási idejét nem adta meg tételesen. A táblázat utolsó sora ezért gyűjtő sor. Ha az ügyvéd tételes felsorolást tart szükségesnek, azt a Barionnál kell megkérdezni (lásd a 6. fejezet K3 kérdését).

---

## 4. Beillesztésre kész szöveg az adatfeldolgozók felsorolásához

**Javasolt hely:** az `adatkezeles.txt` „Adatkezelés címzettjei" fejezetében, a 104. sor kategória-felsorolása után, a 105. sor („Ezen szolgáltatók időszakosan változnak…") elé.

**Indoklás:** a mai szöveg egyetlen adatfeldolgozót sem nevez meg, és a név szerinti listát csak kérésre, e-mailben ígéri. A Barion a marketing körű adatkezeléshez konkrét adatfeldolgozók megnevezését várja el, ezért ezt a négy céget a tájékoztatóban ki kell írni.

> ### 6.2/b. A Barion Marketing Cloud adatfeldolgozói
>
> Ha hozzájárulsz a marketingsütik használatához, a Barion Payment Zrt. a Barion Marketing Cloud, illetve a Barion Pixel szolgáltatás működtetéséhez az alábbi adatfeldolgozókat veszi igénybe:
>
> | Adatfeldolgozó         | Székhely                                            |
> | ---------------------- | --------------------------------------------------- |
> | DataMe Kft.            | 1118 Budapest, Ugron Gábor utca 35.                 |
> | Dentsu Hungary Kft.    | 1027 Budapest, Kacsa utca 15-23.                    |
> | Sales Contact Kft.     | 1115 Budapest, Halmi utca 61.                       |
> | WPP Media Hungary Kft. | 1123 Budapest, Alkotás utca 53. C. épület 2. emelet |

**Jelölés az ügyvédnek:** a fenti négy cég a Barion adatfeldolgozója, nem a KINETICARE Kft.-é. A megfogalmazás ezt igyekszik pontosan visszaadni. Ha az ügyvéd szerint a kereskedő és a Barion viszonya közös adatkezelés, nem pedig önálló adatkezelés, a bevezető mondat átfogalmazandó (lásd a 6. fejezet K2 kérdését).

---

## 5. A süti-kezelő sáv szövege

### 5.1. A Barion által javasolt eredeti szöveg (szó szerint)

> „Sütiket és más technológiát használunk a weboldal működéséhez, statisztikához, a tartalmak és hirdetések, ajánlatok személyre szabásához, és az így gyűjtött adatok média-, hirdető- és elemző partnereinkkel történő megosztásához. Partnereink ezeket kombinálhatják más adatokkal is. Az <Elfogadom> gombra kattintással hozzájárulsz mindezekhez. A hozzájárulásod tartalmát a <További beállítások> gomb alatt állíthatod be, amit bármikor módosíthatsz. Részletes süti tájékoztató és adatvédelmi tájékoztató."

A Barion útmutatása szerint az aláhúzott, itt csúcsos zárójelbe tett részek a saját tájékoztatóinkra mutató hivatkozások.

### 5.2. Javasolt szöveg a mi hangunkon

> Sütiket és hasonló technológiákat használunk: hogy az oldal működjön, hogy statisztikát készítsünk a használatáról, és hogy a tartalmakat, hirdetéseket, ajánlatokat személyre szabjuk. Az így gyűjtött adatokat megosztjuk a média-, hirdető- és elemzőpartnereinkkel, akik ezeket saját adataikkal is összekapcsolhatják.
>
> Az **Elfogadom** gombbal mindehhez hozzájárulsz. Ha csak egy részét engedélyeznéd, nyisd meg a **További beállítások** pontot. A döntésedet később bármikor módosíthatod a lábléc „Süti-beállítások" pontjában.
>
> Részletek a [süti-tájékoztatóban](/adatvedelem#sutik) és az [adatvédelmi tájékoztatóban](/adatvedelem).

### 5.3. Miben tér el a javaslat a Barion eredetijétől, és miért

| Eltérés                                               | Barion eredetije                                         | A javaslat                                                                     | Indok                                                                                                                                                                                                              |
| ----------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mondattagolás                                         | Egy hosszú, négy célt egybefűző mondat.                  | Kettéosztva: célok kettősponttal felsorolva, az adatmegosztás külön mondatban. | Az eredeti mondat egy szuszra öt fogalmat visz, és a végére az olvasó elveszti a fonalat. A tartalom nem változott, csak a tagolás.                                                                                |
| „más technológiát"                                    | „más technológiát"                                       | „hasonló technológiákat"                                                       | Az „és más technológiát" magyarul befejezetlenül hat. A „hasonló technológiák" a bevett magyar jogi fordulat ugyanerre a körre.                                                                                    |
| „a weboldal működéséhez, statisztikához"              | főnévi felsorolás                                        | „hogy az oldal működjön, hogy statisztikát készítsünk"                         | Igei szerkezet. A magyar szöveg így természetesebb és konkrétabb, ugyanazt a két célt nevezi meg.                                                                                                                  |
| „Partnereink ezeket kombinálhatják más adatokkal is." | önálló mondat, alany nélkül folytatva                    | „…akik ezeket saját adataikkal is összekapcsolhatják"                          | A „kombinál" idegen szó, az „összekapcsol" magyar megfelelője pontosabb is. A „saját adataikkal" egyértelműsíti, kinek az adatairól van szó.                                                                       |
| Gombnevek                                             | `<Elfogadom>`, `<További beállítások>`                   | Ugyanezek, félkövéren szedve.                                                  | A csúcsos zárójel helykitöltő volt a Barion sablonjában. A gombnevek szó szerint megegyeznek, hogy a sávon látható felirat és a szöveg egybeessen.                                                                 |
| Visszavonási út                                       | „amit bármikor módosíthatsz"                             | „bármikor módosíthatod a lábléc »Süti-beállítások« pontjában"                  | Az eredeti nem mondja meg, hol. A mi oldalunkon ez a lábléc „Süti-beállítások" gombja, ami már ma is működik (`ConsentBanner.tsx:88`). A konkrét hely megnevezése a visszavonást ténylegesen gyakorolhatóvá teszi. |
| Záró hivatkozás                                       | „Részletes süti tájékoztató és adatvédelmi tájékoztató." | Két külön hivatkozás, teljes mondatban.                                        | Az eredeti mondat állítmány nélküli. Nálunk mindkét szöveg ugyanazon az oldalon van, ezért a süti-hivatkozás a fejezetre mutat.                                                                                    |
| Megszólítás                                           | Tegező.                                                  | Tegező.                                                                        | Nincs eltérés. A mai sávunk viszont magázó (`ConsentBanner.tsx:162`), tehát a javaslat a mai szöveghez képest változtat, a Barion eredetijéhez képest nem.                                                         |

Amit szándékosan **nem** változtattam: az adatmegosztás tényét, a partnerek körét, a személyre szabás említését és a hozzájárulás gombhoz kötését. Ezek a Barion követelményének érdemi elemei.

### 5.4. Amit a szövegen kívül a sávon rendezni kell

Ezek fejlesztői feladatok, de a jogi megfelelés részei, ezért itt is szerepelnek:

1. **Kategóriánkénti választás.** A javasolt szöveg „További beállítások" pontot ígér. Ma ilyen nincs (`ConsentBanner.tsx:164-179`, két gomb). A szöveg csak a funkció megépítésével együtt igaz.
2. **Az elutasítás ugyanolyan könnyű legyen, mint az elfogadás.** A mai sávon ez teljesül, mert a két gomb egyenrangú. Az új sávon is meg kell tartani.
3. **Időbélyeg a döntés mellé.** A Barion elvárása szerint a kezelőnek legalább 13 havonta, ajánlottan 30 naponta újra meg kell jelennie a mentett beállításokkal. Ez a párhuzamos munkapéldányban már elkészült: a döntés időpontja külön tárolókulcsra kerül, az újrakérdezés pedig 365 naposra van állítva. Ez a Barion 13 hónapos felső korlátján belül van, de a Barion 30 napos ajánlásánál ritkább. A K7 kérdés erről szól.
4. **A marketingsütik ne induljanak el hozzájárulás előtt.** A `BarionMarketingConsent.xxx` és a partneri sütik csak a hozzájárulás után kerülhetnek elhelyezésre.

---

## 6. Nyitott kérdések az ügyvédnek

**K1. Mikortól kötelező a Barion-fejezet?** A Barion Pixel követőkód ma nincs beépítve az oldalba (mért, 2.5. pont), a Barion Smart Gateway fizetés viszont él. Kell-e a csalásmegelőzési sütik felsorolása már most, a Pixel nélkül is? A marketing körű táblázat bekerüljön-e előre, vagy csak a Pixel élesítésével egy időben?

**K2. Milyen adatkezelői viszonyban vagyunk a Barionnal?** A 3. és 4. fejezet szövegjavaslata abból indul ki, hogy a Barion önálló adatkezelő, mi pedig csak tájékoztatunk. Ha a marketing körre nézve közös adatkezelés áll fenn, akkor a GDPR 26. cikke szerinti megállapodás és a lényegének nyilvánosságra hozatala is szükséges. Melyik a helyes minősítés?

**K3. Kell-e tételesen felsorolni a Barion média- és hirdetőpartnereinek sütijeit?** A Barion közlése ezeket csak gyűjtőfogalommal adta meg, név és tárolási idő nélkül. Elegendő-e a 3. fejezet gyűjtő sora, vagy kérjük be a Bariontól a tételes listát?

**K4. Az adatfeldolgozói fejezet mai megoldása tartható-e?** Az `adatkezeles.txt:105` szerint a lista „időszakosan változik", és név szerint csak kérésre adjuk meg. A négy Barion-adatfeldolgozó kiírásával ez a mondat ellentmondásba kerül önmagával. Átírjuk-e úgy, hogy a nevesített adatfeldolgozók a tájékoztatóban szerepelnek?

**K5. Nevesítsük-e ugyanebben a körben a PostHogot és a Google Analytics 4-et is?** Ezek ma be vannak kötve, de a tájékoztató egyiket sem említi (mért, 2.2. pont). Ha igen, azok sütijeiről is külön mérést készítünk.

**K6. Kell-e külön süti-tájékoztató oldal?** Ma a süti-fejezet az adatvédelmi tájékoztatón belül él (`/adatvedelem`). A Barion banner-szövege külön „süti tájékoztatóra" és külön „adatvédelmi tájékoztatóra" hivatkozik. Elfogadható-e, hogy mindkét hivatkozás ugyanarra az oldalra mutat, csak más szakaszra?

**K7. Elfogadható-e a 365 napos újrakérdezés?** A Barion legalább 13 havonta előírja, és 30 naponta ajánlja az újrakérdezést. A rendszerben most 365 nap van beállítva, ami a 13 hónapos felső korláton belül van, de az ajánlásnál ritkább. Maradhat-e a 365 nap, vagy a 30 napos ajánláshoz közelítsünk?

**K8. Az adatkezelési tájékoztató ma vegyesen tegez és magáz.** Például az „Adatkezelés címzettjei" fejezet tegez („a Te személyes adataid", 104. sor), a jogokat felsoroló fejezet magáz („Önt, mint az adatkezeléssel érintett vevőt"). A javasolt új szakaszok tegeznek. Egységesítsük-e az egész dokumentumot, és ha igen, melyik irányba?

---

## 7. Kapcsolódó, már ismert jogi ellentmondások

Ezek nem a Barion-témából erednek, de ugyanazokat a fájlokat érintik, ezért egy körben érdemes rendezni őket. A fejlesztői oldal ezekben nem hoz döntést, csak a tényállást rögzíti.

### 7.1. A kurzus-hozzáférés időtartama

**Amit az ÁSZF mond.** `aszf.txt:28`, szó szerint:

> „A szolgáltatás egyszeri fizetéssel jár, a hozzáférés három hónap időtartamra garantált, azt követően addig tart, amíg a tartalomhoz történő hozzáférést a KINETICARE biztosítja. A KINETICARE bármikor jogosult a harmadik hónap letelte után a felvétel elérését korlátozni, véglegesen lezárni, vagy a felvételt magát a KINETICARE weboldaláról törölni."

Ugyanezt erősíti `aszf.txt:25`: „határozott időtartamú hozzáférést biztosít".

**Amit a tulajdonos mond.** A kurzus a vásárlás után örökre elérhető marad.

**Amit a rendszer csinál.** A terméknél megadható egy hozzáférési időtartam napokban. Ha ez nincs megadva, nulla, negatív vagy értelmezhetetlen, a hozzáférés korlátlan (`src/__tests__/course-access.test.ts:36-65`). Az értékesítési oldal ilyenkor kiírja: „Örökös hozzáférés: bármikor újranézheted" (`src/components/courses/sales-content.ts:378`). Az „Örökös hozzáférés" a termékdoboz kiemelt sorai között is javasolt szövegként szerepel az adminfelületen (`src/plugins/ecommerce.ts:471`).

**Pontosítás a feladatkiíráshoz képest.** A vásárlás-visszaigazoló levél szövegét szó szerint megnéztem: az örökös hozzáférést **nem** ígéri kimondottan. Amit mond: „Köszönjük a vásárlásod! A fizetésed sikeres, a kurzushozzáférésed aktív." (`src/lib/email/templates/order.ts:76` és `:80`). A levél tehát nem nevez meg határidőt, se hármat, se örököst. Az „örökös hozzáférés" ígérete az értékesítési oldalon jelenik meg, nem a levélben.

**Az ellentmondás.** Az értékesítési oldal örökös hozzáférést ígér, az ÁSZF három hónap után bármikori lezárást enged. A vásárló a fizetés előtt mindkettőt elfogadja.

**Döntést igényel:** melyik állítás maradjon. Ha az örökös hozzáférés, akkor az `aszf.txt:25` és `:28` átírandó. Ha a három hónap, akkor az értékesítési oldal szövege és a termékbeállítások igazítandók hozzá.

### 7.2. A számla áfatartalma

**Amit az ÁSZF mond.** `aszf.txt:53`, szó szerint:

> „A fizetést követően a Vásárló a számlát emailben kapja meg link formájában, a Számlázz.hu rendszerén keresztül. A Vásárló elfogadja, hogy a számlát/nyugtát a KINETICARE Kft állítja ki 27%-os áfatartalommal."

**Amit az adószám mond.** A cég adószáma `32697865-1-20` (`aszf.txt:13` és `impresszum.txt:19`). A 9. jegy, vagyis a kötőjelek közötti áfakód `1`, ami alanyi adómentességet jelöl.

**Amit a rendszer csinál.** A számlázás áfakulcsa a `SZAMLAZZ_AFAKULCS` beállításból jön, ami két értéket enged: `27` vagy `AAM` (`src/env.ts:164`). Az `AAM` értéknél a számlán a nettó és a bruttó összeg megegyezik, az áfaérték nulla (`src/lib/szamlazz/invoice.ts` és az azt ellenőrző `src/__tests__/szamlazz.test.ts:194-200`, `:315-318`). A kód a hibás beállítás ellen külön véd, mert a néma `27`-es alapértelmezés egy alanyi adómentes eladónál minden bizonylatot elrontana (`src/lib/szamlazz/client.ts:155`, valamint a `src/__tests__/szamlazz.test.ts:58-61` őrző teszt indoklása).

**Az ellentmondás.** Az ÁSZF 27 százalékos áfát ígér a vásárlónak, miközben az adószám alanyi adómentességet jelöl, és a rendszer ennek megfelelően állítható be. A vásárló így olyan tartalmú számlát fogad el az ÁSZF-ben, amilyet nem kap meg.

**Döntés (2026-09-24, tulajdonos):** a KINETICARE Kft. alanyi adómentes, minden számla AAM kulccsal megy ki (`SZAMLAZZ_AFAKULCS=AAM`: nettó = bruttó, áfa = 0). Az ÁSZF mondata ennek megfelelően megváltozott: „A számlát a KINETICARE Kft. állítja ki. A KINETICARE Kft. az általános forgalmi adóról szóló 2007. évi CXXVII. törvény szerint alanyi adómentes, ezért a számla áfát nem tartalmaz. A Weboldalon feltüntetett ár a fizetendő végösszeg.” (`src/lib/legal-source/aszf.txt`; az élő oldalon a tartalom-job `aszf-afa-aam` szabálya cseréli). A vásárlás-visszaigazoló levél összeg-sora ugyanezt a szót használja: „Fizetendő végösszeg”. A fenti 27 százalékos idézet a döntés előtti állapotot rögzíti.

### 7.3. Az ÁSZF a STRIPE-ot nevezi meg fizetési szolgáltatóként

Ez a pont a Barion-témához közvetlenül kapcsolódik, ezért került ide.

**Amit az ÁSZF mond.** `aszf.txt:49`, szó szerint:

> „A fizetés titkosított csatornán megy végbe, a Weboldaltól függetlenül, a STRIPE fizetési felületén."

**Amit a rendszer csinál.** A fizetés a Barion Payment Zrt. rendszerén keresztül történik. A vásárlót a Barion Smart Gateway oldalára irányítjuk át (`src/lib/barion/start.ts:149`), a fizetés eredményét a Barion visszahívása dolgozza fel (`src/app/(frontend)/api/barion/callback/route.ts`), a Barion API címei a `src/lib/barion/client.ts:62` és `:145` sorokban vannak rögzítve. A `Stripe` szó a `src/lib` mappában sehol nem fordul elő, tehát Stripe-integráció nincs.

**Az ellentmondás.** Az ÁSZF olyan fizetési szolgáltatót nevez meg, amelyik nem vesz részt a folyamatban, és nem nevezi meg azt, amelyik igen. Ez a hiba egyszerre érinti az ÁSZF-et és a jelen dokumentum tárgyát: a Barion mint fizetési szolgáltató és adatkezelő sehol nincs megnevezve.

**Döntést igényel:** az `aszf.txt:49` mondat átírása a Barion Payment Zrt.-re, a Barion által előírt megnevezéssel és székhellyel együtt. Érdemes egy körben kezelni a 3. fejezet süti-táblázatával.

---

## 8. Mi a következő lépés

1. Az ügyvéd átnézi a 3., 4. és 5. fejezet szövegjavaslatait, és megválaszolja a 6. fejezet kérdéseit.
2. A jóváhagyott szöveg beillesztése a `src/lib/legal-source/adatkezeles.txt` fájlba, a 3. és 4. fejezetben megjelölt helyekre.
3. A 7. fejezet három ellentmondásáról a tulajdonos és az ügyvéd dönt, ezután javítjuk az `aszf.txt` érintett sorait.
4. A süti-kezelő sáv szövegének és működésének átalakítása az 5.2. és 5.4. pont szerint. Ez fejlesztői feladat, és a 6. fejezet K7 kérdésének megválaszolása után indulhat.

Amíg az 1. pont nem zárul le, a jogi szövegekhez nem nyúlunk.
