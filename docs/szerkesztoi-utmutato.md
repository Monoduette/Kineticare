# Szerkesztői útmutató — a Kineticare admin használata

> **Kinek szól?** Neked, aki a weboldal tartalmát írod és gondozod. Nem kell hozzá
> semmilyen informatikai előképzettség: ez az útmutató végigvezet azon, hogyan
> hozol létre blogbejegyzést, oldalt, kategóriát, menüpontot és véleményt, hogyan
> töltesz fel képet, és mihez jobb nem hozzányúlni.
>
> Az útmutató a jelenlegi admin felülethez készült: minden gombnév és mezőnév úgy
> szerepel benne, ahogy a képernyőn látod. Ha valami mást látsz, mint amit itt
> olvasol, az hiba — jelezd (lásd a legvégén: „Hibát látsz?").
>
> Hogy a weboldal melyik szövegét és képét hol írod át, és mi van a weboldal
> kódjában, azt oldalanként és modulonként a [Mi hol szerkeszthető](mi-hol-szerkesztheto.md)
> táblázat mondja meg (lásd a 13. pontot is).

---

## 1. Belépés

1. Nyisd meg a böngészőben a weboldal címét, és írj a végére `/admin`-t
   (például `https://kineticare.hu/admin`).
2. Add meg az e-mail-címed és a jelszavad, majd kattints a **Bejelentkezés** gombra.
3. Ha elfelejtetted a jelszavad, az **Elfelejtett jelszó** linkre kattints — e-mailben
   kapsz egy linket, amivel újat állíthatsz be.

Néhány dolog a jelszóról:

- legalább **12 karakter** legyen,
- ne az e-mail-címed részlete legyen,
- ne oszd meg senkivel — mindenkinek saját belépése van.

Kilépni jobbra fent, a fiókodnál található **Kijelentkezés** ponttal tudsz.

> **Új munkatárs felvételekor figyelj:** az újonnan létrehozott felhasználó
> szerepköre alapból „Vásárló", és így **nem tud belépni az adminba**. A szerepkört
> a tulajdonos tudja „Munkatárs"-ra állítani.

---

## 2. Az admin felépítése

Belépés után bal oldalon látod a menüt. A tételek csoportokba vannak rendezve,
felül a leggyakrabban használt, alul a legritkábban kellő dolgokkal:

| Csoport                         | Mi van benne                                                                 | Kell-e neked?                                                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Leggyakrabban használt**      | Kezdőlap, Kezdőlapi videó szövegei, Szerkesztő nézet (új lapon)              | Igen: egy kattintással a kezdőlap szerkesztője, illetve a nyitó videó szövegei. A Szerkesztő nézet új lapon a kezdőlap piszkozatát nyitja meg (14. pont). |
| **Kimutatások és kurzusvideók** | Statisztika, Webanalitika, Videótár                                          | A Videótár a kurzusok videóit tartja, a kezdőlapi videóét nem.                                                                                            |
| **Tartalom**                    | Oldalak, Blogbejegyzések, Képek, Vélemények, Kategóriák, Védett kurzusfájlok | Igen, ez a napi munkád.                                                                                                                                   |
| **Navigáció**                   | Menüpontok                                                                   | Igen, az oldal tetején látszó menü.                                                                                                                       |
| **Webshop**                     | Kurzusok, Rendelések, Kurzus-haladás                                         | A kurzus tananyagát itt állítod össze (12. pont); a rendelésekhez ne nyúlj (19. pont).                                                                    |
| **Űrlapok és beküldések**       | Űrlapok, Űrlapbeküldések                                                     | A beérkezett üzenetek az Űrlapbeküldések között vannak.                                                                                                   |
| **Fiókok**                      | Felhasználók                                                                 | Csak óvatosan. Lásd a 19. pontot.                                                                                                                         |
| **Rendszer**                    | Rendszeresemények, Műveletnapló, Visszatérítési szándékok                    | Nem a tiéd, csak technikai napló.                                                                                                                         |

Az Irányítópulton a „Gyakori teendők” kártyái ugyanezekre a helyekre visznek
(Kezdőlap, Kezdőlapi videó szövegei, Kurzusok és árak, Menüpontok,
Űrlapbeküldések, Statisztika).

Egy csoportra kattintva megkapod a listát (pl. az összes blogbejegyzést). A lista
jobb felső sarkában van az **Új létrehozása** gomb, a listaelemre kattintva pedig
szerkeszthetsz.

---

## 3. Négy fogalom, amit érdemes érteni

### Piszkozat

A piszkozat olyan tartalom, amit **csak te látsz** az adminban. A weboldal
látogatói nem találkoznak vele. Nyugodtan írhatsz bele félkész mondatokat is.

### Automatikus mentés

Az Oldalak és a Blogbejegyzések **maguktól mentődnek**, piszkozatként, miközben
írsz — nem kell külön „Mentés" gombot keresned, és nincs is ilyen gomb. A
dokumentum tetején látod, mikor mentett utoljára a rendszer. Ha bezárod a fület,
a munkád megmarad.

(A Kategóriáknál, Menüpontoknál, Véleményeknél és Képeknél nincs piszkozat: ott
egy **Mentés** gomb van, és a mentés azonnal élesít.)

### Közzététel

Amikor kész vagy, a **Közzététel** gombbal teszed ki a tartalmat az élő oldalra.
Ha egy már közzétett tartalmon módosítasz, a gomb neve **Módosítások közzététele**
lesz — vagyis a látogatók addig a régi, közzétett változatot látják, amíg rá nem
nyomsz.

A dokumentum állapotát a szerkesztő tetején látod: **Piszkozat** vagy **Közzétett**.
A közzétételt vissza is lehet vonni: **Közzététel visszavonása** — ilyenkor a
tartalom azonnal eltűnik az oldalról, de nem vész el, piszkozatként megmarad.

### Előnézet

Az előnézettel megnézheted, hogyan fest a **piszkozatod** az éles oldal
kinézetében, mielőtt bárki más látná.

**Hol találod?** Az Oldalak és a Blogbejegyzések szerkesztőjének tetején, a
jobb felső gombsorban az **Előnézet** gomb áll (mellette egy kifelé mutató nyíl
ikon). Erre kattintva **új lapon** nyílik meg az oldal a piszkozat tartalmával.
Ha épp gépeltél, az új lap előbb a „Mentés folyamatban, az előnézet pár
másodperc múlva megnyílik…” szöveget mutatja, és a mentés után tölti be a
piszkozatot. A gomb csak akkor jelenik meg, ha a dokumentumnak már van
webcíme, vagyis miután először elmentetted.

A szerkesztő tetején egy állapotdoboz is mutatja, mit látnak most a látogatók
(például „Van közzé nem tett módosításod.”), és a „Korábbi verziók és
visszaállítás” link a Verziók fülre visz. Egy szekciót közvetlenül is
megnézhetsz az oldalon: lásd a 14. pontot.

Az előnézet csak bejelentkezett munkatársnak/tulajdonosnak működik: ha valaki
másnak küldöd el a linket, ő nem fogja látni a piszkozatot.

### Webcím

A **Webcím** a cím webcímes alakja (angolul slug): ékezetek nélkül, kisbetűvel,
kötőjelekkel. **Magától kitöltődik** a címből — például
„Kézrehabilitáció otthon" → `kezrehabilitacio-otthon`.

Csak akkor írd át, ha tudod, mit csinálsz: a webcím a link része, és ha
megváltoztatod egy már közzétett tartalomnál, **a régi link megszűnik működni**
(aki elmentette vagy megosztotta, hibaüzenetet kap).

### Verziók (biztonsági háló)

Az Oldalaknál és a Blogbejegyzéseknél van egy **Verziók** fül. Itt a korábbi
mentések listáját látod, és bármelyiket vissza tudod állítani
(**A verzió visszaállítása**). Ha véletlenül kitörölsz egy bekezdést, innen
visszahozható.

---

## 4. Új blogbejegyzés lépésről lépésre

A blogbejegyzés szerkesztőjében a mezők három fülön állnak: **Blogbejegyzés**
(Cím, Rövid bevezető, Tartalom, Borítókép), **GYIK és ajánló** (Ajánlott kurzus,
Gyakori kérdések, Kapcsolódó blogbejegyzések) és **Kereső és megosztás**
(SEO-cím, SEO-leírás, SEO-kulcsszavak, Megosztási kép). A Webcím, a Megjelenés
dátuma, a Szerző és a Kategóriák jobb oldalt, az oldalsávban vannak.

1. Bal oldalt: **Tartalom → Blogbejegyzések**, majd jobb fent **Új létrehozása**.
2. **Cím** — kötelező. Ez jelenik meg a bloglistán és a Google találatai közt.
3. **Webcím** — magától kitöltődik a címből, hagyd békén.
4. **Rövid bevezető** — 1–3 mondat. A bloglista kártyáin és a Google-ban is ez látszik.
5. **Tartalom** — ide írod a cikket. A szövegdoboz fölött **mindig ott van az
   eszköztár**: címsorok, félkövér, dőlt, felsorolás, számozott lista, link,
   idézet, kép beszúrása.
   - Ne csinálj a szövegben „óriás betűs" címsort: használd a felkínált
     címsorszinteket (a cikk fő címét már megadtad fent).
   - Linkeléshez jelöld ki a szöveget, és kattints a lánc ikonra.
6. **Borítókép** — a bloglistán és a cikk tetején jelenik meg. Feltöltésnél a
   képleírás kötelező (lásd a 10. pontot).
7. **SEO-cím** és **SEO-leírás** — ha üresen hagyod, a Google a fenti címet és
   bevezetőt használja. A leírás kb. 150 karakter legyen.
8. **Megosztási kép** — ez látszik, ha valaki Facebookon vagy Messengeren megosztja.
   Ha üres, a Borítókép, annak híján a Kineticare alapképe látszik (15. pont).
9. **Megjelenés dátuma** — az első közzétételkor magától kitöltődik; a bloglista
   ez alapján rendez (a legfrissebb elöl). Csak akkor írd át, ha szándékosan más
   dátumot akarsz mutatni.
10. **Szerző** — alapból te vagy. Csak akkor állítsd át, ha más nevében írod.
11. **Kategóriák** — több is választható. Ha még nincs megfelelő, előbb hozd létre
    (5. pont).
12. **Kapcsolódó blogbejegyzések** — legfeljebb 3 cikk, amit a bejegyzés alján ajánlunk.
13. Mentés után kattints a jobb fenti **Előnézet** gombra, és nézd meg új lapon,
    jól fest-e.
14. Ha jó: **Közzététel**.

A kész cikk itt jelenik meg:

- a blog listaoldalán: `/blog`,
- saját címén: `/blog/<webcím>`,
- a kategóriaoldalán: `/blog/kategoria/<kategória webcíme>`,
- és a kezdőlap „Tudástár" blokkjában a 3 legfrissebb cikk.

---

## 5. Új kategória

A kategória a cikkek témakörökbe rendezésére való.

1. **Tartalom → Kategóriák → Új létrehozása**.
2. **Név** — ahogy az olvasó látja, pl. „Kézrehabilitáció".
3. **Webcím** — magától kitöltődik, ékezet nélkül (`kezrehabilitacio`).
4. **Mihez tartozik**:
   - _Blogbejegyzésekhez_ — ez a blog témaköre; a blog csak ezeket mutatja,
   - _Kurzusokhoz_ — a webshop termékeinek besorolása.
5. **Fölérendelt kategória** — csak akkor töltsd ki, ha ez egy nagyobb témakör
   alkategóriája. Ha bizonytalan vagy, hagyd üresen.
6. **Mentés**. A kategória azonnal él, saját oldala: `/blog/kategoria/<webcím>`.

Tipp: kevés, jól elkülönülő kategória hasznosabb, mint húsz, amiből mindegyikben
egy cikk van.

---

## 6. Új oldal

Az „oldal" az állandó tartalom (pl. Rólunk, Szolgáltatások) — szemben a
blogbejegyzéssel, ami idővel régivé válik.

1. **Tartalom → Oldalak → Új létrehozása**.
2. **Cím**, **Webcím**, **Rövid bevezető**, **Tartalom** — ugyanúgy, mint a
   blogbejegyzésnél (4. pont). Az Oldalaknál nincsenek fülek: a mezők egymás
   alatt állnak, a Webcím és a Szerző az oldalsávban.
3. **Szekciók** — az oldal „építőkockás" része (sávok: nyitó blokk,
   kurzuskártyák, vélemények…). Nem kötelező: ha üresen hagyod, az oldal a
   megszokott módon jelenik meg. Részletesen a 7. pontban.
4. **Fejléckép** — az oldal tetején megjelenő nagy kép (nem kötelező).
5. **SEO-cím**, **SEO-leírás**, **Megosztási kép** — mint a bejegyzésnél. Az
   Oldalnál üres Megosztási kép helyett a Fejléckép, annak híján a Kineticare
   alapképe látszik (15. pont).
6. Mentés, **Előnézet** (a jobb felső gomb), majd **Közzététel**.

A kész oldal a webcímén él: pl. `/rolunk`.

Két dolog, amire figyelj:

- **A kezdőlap külön eset.** A tartalmát a **`kezdolap`** webcímű Oldal hordozza,
  de a látogató a `/` címen látja (nem a `/kezdolap`-on). Ha a kezdőlapon akarsz
  módosítani, ezt az oldalt szerkeszd — a sávjait a **Szekciók** mezőben találod
  (7. pont).
- **Az új oldal nem kerül automatikusan a menübe.** Ha szeretnéd, hogy a
  látogatók megtalálják, csinálj hozzá menüpontot (8. pont).

---

## 7. Szekciók — a kezdőlap összerakása

A kezdőlap sávokból áll: legfelül a nagy nyitó blokk a kéznyitás-filmmel, alatta
a szakmai hitel-csík, a kurzuskártyák, az ingyenes SOS-sáv, és így tovább a
véleményekig meg a gyakori kérdésekig. **Ezek a sávok a szekciók**, és mind a
Payload adminból kezelhetők: szöveget írhatsz beléjük, újat vehetsz fel,
elrejtheted valamelyiket, és — ami a legfontosabb — **átrendezheted a
sorrendjüket**. Programozó nem kell hozzá.

> **Hol találod?** Bal oldalt **Leggyakrabban használt → Kezdőlap** (vagy
> **Tartalom → Oldalak**, a lista fölötti „Fő oldalak a weboldal menüje szerint”
> dobozban **Kezdőlap**), majd görgess a **Szekciók** mezőig. A szekciók alapból
> összecsukva jelennek meg. Minden sor címkéje megmondja a sorszámot, a típust
> és a szekció címét, például „01 · Nyitó videó (kéznyitás): Hatékony és
> biztonságos módszerek…”; a sorra kattintva nyílik ki. A nyitó videó
> szövegeihez közvetlenül is eljutsz: **Leggyakrabban használt → Kezdőlapi videó
> szövegei**.

### Mit tudsz csinálni?

**Szöveget írni.** Nyisd ki a szekciót, és töltsd ki a mezőit. Minden mezőnek van
magyar magyarázata a neve alatt — azt érdemes elolvasni, mielőtt írsz.

**Új szekciót felvenni.** A lista alján lévő **Szekció hozzáadása** gombra
kattintva megjelenik a választható szekciótípusok listája, magyar nevekkel és
rövid leírással. A lista két csoportra oszlik:

- **Kezdőlap (ajánlott sorrendben)** — a kezdőlap saját sávjai, abban a
  sorrendben felkínálva, ahogy a lapon ajánlott állniuk;
- **Bárhol használható** — a **Szakemberek kártyái**, a **Nyitható sorok**, az
  **Időpontkérés**, a **Szabad szöveg** és a **Gombos kiemelő sáv**, amit
  bármelyik oldalon, bárhová beszúrhatsz.

**Sorrendet cserélni.** Minden szekciósor bal szélén van egy **fogantyú** (a
pontokból álló kis ikon). Fogd meg az egérrel, húzd a helyére, engedd el — a
szekció odakerül. Billentyűzettel is megy: állj a fogantyúra a **Tab**
billentyűvel, nyomj **szóközt**, a **nyilakkal** vidd a sort a helyére, majd
újabb **szóközzel** tedd le.

**Elrejteni törlés nélkül.** Minden szekció alján ott van a csukott
**Megjelenés és elrejtés** rész; kinyitva benne a **Látható** pipa. Ha kiveszed,
a sáv eltűnik az oldalról, **de a tartalma megmarad** — bármikor
visszakapcsolhatod. A sor címkéjén ilyenkor „Rejtve” áll. Ez a helyes módja egy
szekció „kikapcsolásának"; törölni nem kell (a törléssel a beleírt szöveg is
elvész).

**Háttérszínt váltani.** Ugyanitt van a **Háttér** választó (Fehér /
Világoskék / Sötétkék). Váltogasd a fehéret és a világoskéket, hogy az egymás
alatti sávok jól elkülönüljenek; a sötétkéket ritkán, egy-egy kiemeléshez
használd.

**Ugrópontot adni.** Szintén a Megjelenés és elrejtés részben: az **Ugrópont
neve (haladó beállítás)** egy rövid név (pl. `kurzusok`), amivel a lapon belül
lehet erre a szekcióra ugrani. Ha megadod, a `https://kineticare.hu/#kurzusok`
cím pontosan ide görget. Így tud egy gomb, egy menüpont vagy egy hírlevél-link a
lap közepére mutatni. Csak ékezet nélküli kisbetűt, számot és kötőjelet írj
bele, a `#` jelet pedig hagyd ki — ha elrontod, a mentés magyar hibaüzenettel
figyelmeztet. Néhány ugrópontra a weboldal vagy más oldalak linkjei épülnek
(„rendeloi”, „idopontkeres”, „szakmai-hatter”): ezeknél a szekció tetején
figyelmeztetés áll, ezeket ne nevezd át.

### Az ajánlott sorrend — és miért ez

A kezdőlap alap-sorrendje nem véletlen: azt a sorrendet követi, amiben a
látogató dönteni szokott. Fentről lefelé:

| Sorrend | Szekció                                                                                                                 | Mit csinál                                                                                       |
| ------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1.      | Nyitó videó (kéznyitás)                                                                                                 | Megmondja, kinek és miben segítünk, és egyetlen hangsúlyos gombbal a kurzusokra visz.            |
| 2.      | Szakmai háttér sáv                                                                                                      | Egy sorban a szakmai háttér — ez keretezi az egész lapot.                                        |
| 3.      | Kurzuskártyák (automatikus)                                                                                             | A fizetős kurzusok árral és gombbal. Ez az oldal legfontosabb blokkja.                           |
| 4.      | Ingyenes villámkurzus sáv                                                                                               | Aki még nem venne kurzust, itt kap ingyenes anyagot — a fizetős ajánlat UTÁN, visszafogottabban. |
| 5–10.   | Logósor, Üdvözlés és gondok, Ígéretek kártyákon, A kéz három állapota, Képes lista vagy kártyák, Bemutatkozás és számok | A bizalomépítő, bemutatkozó rész.                                                                |
| 11.     | Számozott lépések                                                                                                       | Eloszlatja a „vajon menni fog otthon?" kételyt.                                                  |
| 12.     | Vélemények (automatikus)                                                                                                | Páciens-visszajelzések — a kurzusok után, legfeljebb három.                                      |
| 13.     | Tudástár-ajánló (automatikus)                                                                                           | A legfrissebb blogcikkek (ez hozza a Google-ből az olvasókat).                                   |
| 14.     | GYIK (gyakori kérdések)                                                                                                 | A vásárlás előtti utolsó kérdések a lap alján.                                                   |

Két szabály, amit érdemes megtartani, ha átrendezel:

- **A fizetős kurzuskártyák maradjanak elöl**, és mindenképp az ingyenes
  SOS-sáv ELŐTT. Ha az ingyenes anyag kerül előre, a legtöbb látogató azt viszi
  el, és a kurzus nem fogy.
- **A vélemények a kurzuskártyák UTÁN jöjjenek**, és maradjanak rövidek. A
  vélemény akkor győz meg, ha már tudni lehet, miről szól az ajánlat.

Ezen kívül szabadon kísérletezz — pontosan ezért készült így a rendszer. Ha egy
átrendezés után romlanak a vásárlások, tedd vissza: a sorrend bármikor
visszaállítható (és a **Verziók** fül is ott van, lásd a 3. pontot).

### Ha üresen hagyod a Szekciók mezőt

Az oldal nem lesz üres. A kezdőlap ilyenkor a weboldal beépített alapváltozatát
hozza (nyitó blokk, kurzuskártyák, ingyenes SOS, „Így működik", vélemények,
Tudástár, GYIK), a többi oldal pedig a **Tartalom** mezőbe írt szöveget.

A kezdőlapon azonban a törölt szekciók szövege elvész. A kezdőlap szerkesztőjének
tetején ez áll:

> Ha az összes szekciót törlöd és közzéteszed, a kezdőlapon a weboldal beépített alapváltozata jelenik meg, a szekciók pedig maguktól nem kerülnek vissza, a korábbi állapotot a Verziók fülön állíthatod vissza.

Ha egy szekciót nem akarsz mutatni, rejtsd el (lásd fent), ne töröld. A
részleteket a 16. pont írja le.

### Piszkozat, előnézet, közzététel — a szekciókra is

A szekciók pontosan úgy viselkednek, mint az oldal többi mezője (3. pont):

1. Amíg dolgozol, a rendszer **magától ment piszkozatba**. A látogatók
   eközben a korábban közzétett változatot látják — az átrendezésed még nem él.
2. Ha kész vagy, kattints a jobb fent lévő **Előnézet** gombra: új lapon, az
   éles kinézetben látod a piszkozatot, az új sorrenddel. Egy szekciót a
   tetején álló **Megnézem az oldalon (új lapon)** linkkel közvetlenül is
   megnézhetsz (14. pont).
3. Ha jónak találod: **Módosítások közzététele** — ettől a pillanattól a
   látogatók is az új sorrendet látják.
4. Ha mégsem: a **Verziók** fülön bármelyik korábbi állapot visszaállítható.

Nyugodtan próbálgass: amíg nem nyomsz Közzétételt, az élő oldalon semmi nem
változik.

---

## 8. Új menüpont

A menü az oldal tetején látszó navigáció. Legfeljebb **2 szintű**: főmenüpontok,
és alattuk almenüpontok.

1. **Navigáció → Menüpontok → Új létrehozása**.
2. **Felirat** — ez a szöveg jelenik meg a menüben (pl. „Rólunk").
3. **Hová mutat** — ettől függ a következő mező:

   | Típus                             | Mit válassz utána                                                                                                                                 |
   | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
   | **Oldal**                         | a **Cél** mezőben az oldalak közül választasz (pl. Rólunk)                                                                                        |
   | **Blogbejegyzés**                 | a **Cél** mezőben egy blogbejegyzést                                                                                                              |
   | **Webcím (saját vagy más oldal)** | a **Webcím** mezőbe a weboldal saját lapjához perjellel kezdődő útvonalat (pl. `/blog`), más weboldalhoz `https://`-sel kezdődő teljes címet írsz |
   | **Kurzus**                        | a **Cél** mezőben egy kurzust                                                                                                                     |

   A menü első pontját (**Kurzusok**) a rendszer teszi ki, ha itt nincs
   `/kurzusok` webcímű főmenüpont. A Kurzus típusú SOS KézRelax menüpont
   feliratának „Ingyenes” szavát is a rendszer kezeli.

4. **Fölérendelt menüpont** — csak akkor töltsd ki, ha ez almenüpont. Almenüpont
   alá már nem tehetsz továbbit (a menü 2 szintű).
5. **Sorrend** — kisebb szám = előrébb. Érdemes 1, 2, 3… számozást használni.
6. **Látható** — ha kiveszed a pipát, a menüpont eltűnik az oldalról, de nem vész
   el. Ez a helyes módja egy menüpont „elrejtésének" — törölni nem kell.
7. **Új lapon nyíljon** — külső linkeknél szokás bekapcsolni.
8. **Mentés**. A menü azonnal frissül az oldalon.

Ha valamit rosszul állítasz be (pl. „Oldal" típust választasz, de nem adsz meg
célt), a mentés magyar hibaüzenettel megáll — nem tudsz elrontani semmit.

### Rejtett link: elérhető cél, ami nincs benne a menüben

Van olyan oldal vagy kurzus, amit csak azok érjenek el, akiknek elküldöd a
linkjét (például egy zárt csoportnak vagy hírlevélben)? Erre való a **Rejtett
link (nem jelenik meg a menüben)** kapcsoló a menüpont szerkesztőlapján.

1. Állítsd be a menüpontot a szokott módon (felirat, típus, cél).
2. Kapcsold be a **Rejtett link** pipát. A **Látható** pipát hagyd bekapcsolva.
3. Megjelenik a **Közvetlen link** doboz a menüpont teljes webcímével. A
   **Másolás** gombbal a vágólapra kerül, és bárhová beillesztheted.
4. **Mentés**. A menüpont ezután nem látszik a fejlécben és a mobil menüben, de
   aki megkapja a linket, az eléri a célt.

Amire figyelj:

- Ha a cél (oldal, bejegyzés vagy kurzus) még **piszkozat**, a doboz
  figyelmeztet: a link addig hibaoldalt ad, amíg a célt közzé nem teszed.
- A rejtett link nem jelszó. Aki ismeri a címet, megnyithatja, és a keresők is
  megtalálhatják, ha valahol nyilvánosan hivatkoznak rá.
- Ha egy **főmenüpontot** teszel rejtetté, az alatta lévő almenüpontok nem
  tűnnek el: főmenüpontként jelennek meg tovább. Ha azokat sem akarod mutatni,
  azoknál is kapcsold be a Rejtett linket.
- A **Látható** pipa kivétele ugyanígy kiveszi a menüpontot a menüből, és a
  cél a saját címén ugyanígy elérhető marad. A különbség annyi, hogy a Rejtett
  linknél kimásolhatod a cél közvetlen linkjét.
- A `/blog` webcímű menüpont a Tudástár kapcsolója is: ha ott kiveszed a
  Látható pipát vagy bekapcsolod a Rejtett linket, a Tudástár az egész
  weboldalon eltűnik.

---

## 9. Új vélemény

A vélemények a pácienseink visszajelzései. A weboldal Vélemények szekcióiban
(ma a kezdőlapon, a Rólunk és a Szolgáltatások oldalon) a **kiemelt**
vélemények jelennek meg, mindegyikben ugyanazok; a Kapcsolat oldalon a
Vélemények szekció nem jelenik meg. A lista „Hol látszik” oszlopa véleményenként
megmutatja, hol látszik.

> **A legfontosabb szabály:** ide **kizárólag valós, tényleg elhangzott vélemény**
> kerülhet, **betűhíven**. Kitalált, összeollózott vagy „megszépített"
> visszajelzés tilos.

1. **Tartalom → Vélemények → Új létrehozása**.
2. **Rövid idézet**: nem kötelező, de a weboldalra ez való: 1–2
   mondat, **legfeljebb 260 karakter**. Ha hosszabbat írsz, a mentés magyar
   hibaüzenettel figyelmeztet. A weboldalon ez a rövid szöveg jelenik meg; ha
   üresen hagyod, a Teljes szöveg kerül ki.
3. **Teljes szöveg**: kötelező. A teljes, eredeti szöveg, pontosan
   úgy, ahogy elhangzott. Ha a Rövid idézet ki van töltve, a weboldalon az
   látszik, ez nem.
4. **Név** — aki mondta (pl. „Garami Gábor" vagy „P. Benjámin", ha csak
   keresztnévvel vállalta).
5. **Titulus, foglalkozás** — nem kötelező, pl. „zenész / műsorvezető".
6. **Kiemelt** — ez a pipa jelenti azt, hogy **megjelenik a Vélemények
   szekciókban**, a kezdőlapon is.
   **Legfeljebb 3** vélemény látszik: a kiemeltek közül a
   **Sorrend** szerint **első három** (a legkisebb sorszámúak), a többi
   egyszerűen kimarad. Ezért adj a kiemelteknek **különböző** sorszámot —
   azonos sorszám esetén nem garantált, melyikük kerül ki a kezdőlapra.
   Ha kiemelsz egy véleményt rövid szöveg nélkül, és a teljes szöveg hosszabb
   260 karakternél, a mentés magyar hibaüzenettel megáll: ilyenkor vagy tölts
   ki rövid változatot, vagy vedd ki a Kiemelt pipát.
7. **Sorrend** — kisebb szám = előrébb (a kezdőlapon 1, 2, 3 a három kiemelt).
8. **Látható** — ha kiveszed a pipát, a vélemény sehol nem jelenik meg, de nem
   vész el.
9. **Mentés**. A vélemény azonnal él.

Ha új véleményt akarsz kitenni a kezdőlapra egy régi helyett: az újnál pipáld be a
**Kiemelt**et és adj neki 1–3 közötti sorszámot, a leváltottnál pedig **vedd ki a
Kiemelt pipát** (a vélemény megmarad, csak nem a kezdőlapon).

Egy véleményt nyugodtan törölhetsz vagy átnevezhetsz: a weboldal induláskor
csak akkor tölti fel az induló véleményeket, ha a Vélemények között egyetlen
vélemény sincs (16. pont). Ha valamelyiket csak nem akarod mutatni, vedd ki a
Kiemelt vagy a Látható pipát.

---

## 10. Kép feltöltése és a képleírás

Képet két helyről tölthetsz fel: a **Tartalom → Képek** listából (**Új
létrehozása**), vagy közvetlenül szerkesztés közben, amikor egy képmezőnél
(borítókép, fejléckép) vagy a szövegszerkesztőben képet szúrsz be.

Amit tudni érdemes:

- **A Képleírás (alt) kötelező.** Egy mondatban írd le, mi látszik a képen
  (pl. „Kiss Kata gyógytornász csuklókezelést végez").
- **Miért kötelező?** Egyrészt a vak és gyengénlátó látogatók képernyőolvasó
  programja ezt olvassa fel — enélkül számukra a kép nem létezik. Másrészt a
  Google is ebből érti meg, mi van a képen, tehát a keresésben is számít.
  Ne írj bele „kép", „fotó", „IMG_1234" típusú szöveget.
- **Formátumok:** jpg, png, webp, gif. AVIF és SVG nem tölthető fel.
- **Méret:** legfeljebb 10 MB fájlonként. A rendszer a feltöltött képet
  automatikusan optimalizálja és több méretben eltárolja, hogy gyorsan töltsön be
  mobilon is — neked nem kell méretezned.
- **Egy kép többször is használható:** ami egyszer fent van, azt bármelyik
  oldalról ki tudod választani, nem kell újra feltölteni.

### A kezdőlap rögzített fotóhelyei

Két kezdőlapi szekcióban a fotók helyekhez kötöttek. Minden hely külön mező, és
ha üresen hagyod, a lapon a beépített fotó marad (a mező alatt olvasod, melyik).

- **Bemutatkozás és számok → Mozgó fotósor a kezdőlapon (négy kép):** a
  nyitó videó alatti négy íves fotó. Az 1. kép telefonon nem látszik. Ez a
  sor csak akkor jelenik meg, ha három feltétel együtt teljesül:
  - ez az első látható „Bemutatkozás és számok” szekció a lapon;
  - közvetlenül a nyitó videó után áll;
  - a „Felső kis felirat”, a „Szekció címe”, a „Bekezdések” és a „Kiemelt
    blokk” közül legalább egy ki van töltve.

  Ilyenkor a **Csapatfotó** mező képe nem látszik. Ha a szekcióban csak Számok
  és Csapatfotó van, szöveg nincs, akkor a Csapatfotó látszik, a fotósor nem.
  A Csapatfotó mező alatt a szerkesztő jelzi, melyik eset áll fenn. Ha a
  fotósor látszik, ez áll ott: „Ebben a helyzetben a jobb oldalon a mozgó
  fotósor látszik, ez a kép nem.” Ha nem látszik, ez: „Ebben a helyzetben a
  mozgó fotósor nem látszik: csak akkor jelenik meg, ha ez az első látható
  „Bemutatkozás és számok” szekció, közvetlenül a nyitó videó után áll, és a
  „Felső kis felirat”, a „Szekció címe”, a „Bekezdések” és a „Kiemelt blokk”
  közül legalább egy ki van töltve.”

- **Kurzuskártyák (automatikus) → Fotók a „Kurzusaink” felirat alatt:** a
  bal, a középső és a jobb oldali díszítő fotó a kártyák alatt.

A kép kivágását a kép **fókuszpontja** adja. A **Tartalom → Képek** között
nyisd meg a képet, és a fókuszpontot tedd arra a részre (arcra, kézre), aminek
keskeny helyen is látszania kell.

---

## 11. Mi történik közzétételkor?

- A tartalom **azonnal élesedik**: a látogatók a következő oldalbetöltésnél már az
  új változatot látják. Nincs várakozás, nincs „gyorsítótár-ürítés".
- A Google-nak viszont **idő kell**, mire indexeli az új tartalmat — ez nem hiba,
  napokat is igénybe vehet.
- Ha meggondoltad magad: **Közzététel visszavonása**. A tartalom azonnal eltűnik
  az oldalról, és piszkozatként megmarad.
- Ha csak elgépeltél valamit: javítsd, majd **Módosítások közzététele**.
- Ha egy egész korábbi állapotot akarsz vissza: **Verziók** fül →
  **A verzió visszaállítása**.

### Kurzusnál: a „Megjelenés a weboldalon" mező

A **kurzusoknál** (Webshop → Kurzusok) a közzététel **két lépés**, és ez a
leggyakoribb buktató:

1. a **„Módosítások közzététele"** gomb a **szerkesztői változatot** élesíti
   (ez az, amiről a lap tetején az „Állapot" felirat szól);
2. a kurzus **akkor jelenik meg a weboldalon**, ha az oldalsávban a
   **„Megjelenés a weboldalon"** mező értéke **„Közzétéve"**.

Ha a kurzus nem látszik, a lap tetején **narancssárga sáv** figyelmeztet rá, és
megmondja, mi a teendő. Ezt a mezőt **csak a tulajdonos** tudja átállítani —
munkatársként a sáv szövege szerint kérd meg rá.

> A sáv **zöld**, ha a kurzus látszik. Ha narancssárgát látsz, a kurzus a
> vásárlók számára nem létezik, akkor is, ha a lap tetején „Közzétett" áll.

---

## 12. A kurzus tananyaga — modulok és leckék

A kurzus tartalmát a **Webshop → Kurzusok** alatt, a kurzus szerkesztőlapján
állítod össze, a **Tananyag (modulok)** mezőben. Ez az, amit a vásárló a
lejátszóban lát: bal oldalon a fejezetek, bennük a leckék, mellette a videó.

### Felépítés

- Egy **modul** = egy fejezet (pl. „1. ALAPOK — Így kezdj neki”). Van címe és
  egy nem kötelező rövid leírása.
- Egy modulban tetszőleges számú **lecke** van. A sorrend számít: a vásárló
  ebben a sorrendben halad, és az „Előző / Következő” is ezt követi.
- Modult és leckét a **fogantyúnál fogva át tudsz húzni** — így rendezed át
  őket.
- Az összecsukott soron **a cím látszik**, nem sorszám: a modulnál a cím és a
  leckék száma („1. ALAPOK — Így kezdj neki (3 lecke)"), a leckénél a cím és a
  típus („Bemelegítés · Videó"). Ha egy videó még nincs „Kész" állapotban, **vagy
  hiányzik belőle a Video ID**, a soron ott áll: **„· még nem játszható"** — így
  a csukott listán is azonnal látod, mi nem indulna el a vásárlónál. A cím nélküli
  sor **„(névtelen modul)"** / **„(névtelen lecke)"** jelzést kap. A hossz
  (másodperc) üresen hagyható: a lejátszás ettől még elindul.

### Háromféle lecke

| Típus              | Mikor használd                           | Mit kell kitölteni                                   |
| ------------------ | ---------------------------------------- | ---------------------------------------------------- |
| **Videó**          | Bunny Stream felvétel                    | Videó azonosítója, Hossz (másodperc), Videó állapota |
| **Szöveges lecke** | Csak írott anyag és/vagy letölthető fájl | Lecke szövege és/vagy Letölthető anyagok             |
| **Külső link**     | Máshová vezet (pl. Facebook-csoport)     | Külső webcím                                         |

Mindhárom típushoz adhatsz **rövid összefoglalót**, **lecke szöveget** és
**letölthető anyagokat** (PDF, kép, segédlet).

### Hol találom a videó azonosítóját?

A Bunny felületén nyisd meg a videót, és másold ki a **„Video ID"** mezőt — egy
hosszú, kötőjeles kód. Ez kerül a lecke **„Videó azonosítója"** mezőjébe.

- A **fizetős kurzusvideók** a **védett videótárban** vannak: ezeket csak az
  nézheti meg, aki megvásárolta a kurzust.
- Az **ingyenes előzetesek** a **nyilvános videótárba** kerülnek — azokat
  bárki megnézheti vásárlás nélkül is. Az előzetes azonosítója a kurzus
  **„Bemutató videó azonosítója"** mezőjébe megy, nem a leckéhez.

Ha rossz tárból másolod ki az azonosítót, a videó **némán nem indul el** — ez a
leggyakoribb hiba a kurzusfeltöltésnél.

### Videós leckénél erre figyelj

- A **Hossz (másodperc)** kitöltése **ajánlott**: ebből számoljuk a hátralévő időt, és a rövid lecke jegye is legalább két óráig él. Ha üresen marad, a lejátszás ettől még elindul (a jegy 24 órás). A GUID és a **Kész** állapot nélkül viszont nem.
- A **Videó állapota** alapból „Feldolgozás alatt”. Amíg nem állítod
  **„Kész”**-re, a lecke a lejátszóban „Hamarosan” jelzéssel, letiltva jelenik
  meg, és **nem számít bele a haladásba** sem. Ez szándékos: nem várjuk el a
  vásárlótól, hogy megnézzen valamit, amit nem tud elindítani.
- A feltöltés nem automatikus: miután a Bunny végzett a feldolgozással, **kézzel
  kell** „Kész”-re állítani.

### Ha egy régi kurzusnak még „Videók” listája van

A kurzus alján van egy **„Videók (régi…)"** mező. Ez a korábbi, fejezetek
nélküli felépítés. Amíg nincs egyetlen modul sem, a vásárló ezt a listát látja —
tehát **nem kell hozzányúlnod, minden működik**. Új kurzuson ez a mező **meg sem
jelenik**, tehát nem tudod véletlenül rossz helyre felvinni a leckéket.

> ⚠️ **Ha fejezetekre akarod bontani, NE vidd fel kézzel újra a videókat!**
> Az újonnan felvett lecke új belső azonosítót kap, a már megnézett videókról
> tárolt haladás viszont a régire mutat — így **minden vásárló haladása
> nullázódna**, hibaüzenet nélkül. Ehelyett szólj a fejlesztőnek: van egy
> parancs (`npm run kurzus:videok-modulba`), ami az azonosítók megtartásával
> emeli át a videókat egy modulba, tehát senki haladása nem vész el.

### Amit a vásárló lát

- A leckék mellett kis **kör** jelzi, hogy megnézte-e már. A fejezet fejlécében
  ott a „3/7” számláló, a kurzus tetején pedig a haladás-sáv és a százalék.
- A **haladás nevezőjébe** csak az **elindítható** leckék számítanak bele: a
  „Feldolgozás alatt” videó nem.
- A **Kurzusaim** oldalon a kártyán a „Folytatás” gomb pontosan arra a leckére
  visz, ahol abbahagyta.

### Ki hol tart? — a Kurzus-haladás panel

A kurzus szerkesztőlapjának **alján** találod a **Kurzus-haladás** panelt.
Nem tölt magától (hogy a lap gyors maradjon): nyomd meg a **„Haladás
betöltése"** gombot.

Amit mutat:

- **öt kártya**: Beiratkozott · Elkezdte · **Nem kezdte el** · Befejezte ·
  Átlagos haladás;
- **hallgatónkénti táblázat**: név, e-mail, állapot, kis kördiagram a
  százalékkal, utolsó aktivitás és a **következő lecke**;
- **Leckénkénti lemorzsolódás** (lenyitható): melyik leckénél veszíted el a
  nézőket. A „(kezdés)" az első leckét jelöli, a „−12 fő" tényleges veszteséget,
  a „+218 fő" pedig azt, hogy oda többen jutottak el (jellemzően modulhatáron).

Praktikák:

- A táblázat alapból **25 sort** mutat; lejjebb a **„További … hallgató
  megjelenítése"** gombbal bővítheted. A **szűrő és a kereső mindig a teljes
  létszámon dolgozik**, tehát a szűrés akkor is pontos, ha nem látszik minden sor.
- A szűrő fölött ott áll, hány hallgatóból hány felel meg a szűrésnek — a
  „ki nem kezdte még el" listához állítsd az **Állapot** szűrőt
  **„Nem kezdte el"**-re, és a szám azonnal látszik.
- A **„Letöltés táblázatba (CSV)"** gomb a **szűrt** listát menti le (Excelben
  ékezethelyesen nyílik). Így egy kattintással megvan azoknak az e-mail-címe,
  akiknek emlékeztetőt küldenél.

---

## 13. Mi hol szerkeszthető?

Amit a weboldalon látsz, az háromféle helyről jöhet:

1. **Az oldal vagy a szekció saját mezőjéből.** Ezt ott írod át, ahol a
   szekciót vagy az oldalt szerkeszted.
2. **Egy másik gyűjteményből** (Kurzusok, Vélemények, Blogbejegyzések). Ilyenkor
   a szekció tetején egy doboz megmondja, honnan jön a tartalom, és az
   „Ugrás oda, ahol szerkeszted” link odavisz.
3. **A weboldal kódjából.** Ezt az adminban nem tudod átírni: szólj a
   fejlesztőnek.

Oldalanként és modulonként a [Mi hol szerkeszthető](mi-hol-szerkesztheto.md)
táblázat sorolja fel, mi melyik fajta, és hol találod. Ahol a táblázatban az áll,
hogy „kódban van, szólj a fejlesztőnek”, ott az adminban nincs rá mező.

---

## 14. Az oldalról a szerkesztőbe, és vissza

Ha a weboldalon látsz valamit, amit át akarsz írni, nem kell a Szekciók között
keresgélned: az oldalról egy kattintással a pontos szekcióhoz jutsz.

### Az oldalról a szerkesztőbe

1. Lépj be az adminba, majd ugyanabban a böngészőben nyisd meg a weboldal
   lapját. A fejléc fölött egy sáv jelenik meg ezzel a szöveggel: „Ezt a sávot
   csak a szerkesztők látják.” Mellette a **Szerkesztő nézet** link áll. A
   látogatók ezt a sávot nem látják.

   A kezdőlaphoz rövidebb az út: az admin bal oldali menüjében kattints a
   **Leggyakrabban használt → Szerkesztő nézet (új lapon)** linkre. Ez új lapon
   rögtön a kezdőlap piszkozatát nyitja meg, vagyis a 2. lépés eredményét, így
   onnan a 3. lépéssel folytatod. Ez a link mindig a kezdőlapot nyitja; a többi
   laphoz a fejléc fölötti sáv kell.

2. Kattints a **Szerkesztő nézet** linkre. Ugyanennek a lapnak a piszkozata
   nyílik meg. A lap tetején ez áll: „Előnézet: a piszkozatot látod, ez a
   változat még nem nyilvános.” Mellette a **Vissza a szerkesztőbe** és a
   **Kilépés az előnézetből** link.
3. Az előnézetben minden szekció előtt egy szalag áll. Rajta a szekció
   címkéje, betűre ugyanaz, mint az adminban (például „05 · Képes lista vagy
   kártyák (sín): Így tudunk segíteni”), és a **Szerkesztem** link. A lap
   tetején „Az egész oldal: …” kezdetű szalag az egész oldal szerkesztőjét
   nyitja meg.
4. Kattints a szekció **Szerkesztem** linkjére. Ugyanabban a lapban megnyílik
   az admin, az oldal szerkesztője. A böngésző címsorában a cím végén
   `?szekcio=` és a szekció azonosítója áll.
5. Az admin megkeresi a szekciót, kinyitja, odagörget úgy, hogy a ragadós
   fejléc ne takarja, és a kurzort a szekció első mezőjébe teszi. A szekciót
   zöld keret emeli ki, amíg máshová nem kattintasz, a képernyőolvasó pedig felolvassa:
   „Megnyitva:” és a szekció címkéje. Ha közben görgetsz, kattintasz vagy
   gépelsz, a nyitás megáll, és nem veszi el tőled a kurzort.
6. Ha a szekció közben kikerült az oldalról, vagy a link régi, egy bezárható
   figyelmeztetés jelenik meg, például „A hivatkozott szekció nincs ezen a
   lapon”, azzal, hogy a szekciókat lent, a Szekciók alatt találod. A
   **Bezárás** gombbal eltünteted.
7. Az előnézethez a böngésző **Vissza** gombjával térsz vissza.

A szalagon további jelzések is állhatnak:

- **Máshonnan jövő tartalom.** Ha a szekció egy másik gyűjteményből töltődik
  (például a kurzuskártyák a Kurzusokból), a szalag ezt kimondja, és egy
  második link is áll rajta: „Ugrás oda, ahol szerkeszted: Kurzusok”.
- **Rejtett szekció.** A rejtett szekció előtt is áll szalag: „Figyelem:
  rejtett szekció. Ez a szekció most rejtve van, a lapon nem látszik.” Utána
  az, hogy hol kapcsolod vissza, vagy melyik látható sor a párja.
- **Rendelői árlista.** Ha az árlista szövegéből nem lesznek árkártyák, a
  szalag figyelmeztet: „Az árlista nem ismerhető fel, sima szövegként
  látszik.” A szabályt a 18. pont írja le.
- **Tünet-oldalak.** A nyolc tünet-oldalon (például /keztoalagut-szindroma) a
  lap tetején két link áll: **Szerkesztem a blogbejegyzést** (a látható cikk)
  és **Szerkesztem az oldalt** (a keresőben megjelenő cím és leírás).

A **Szerkesztő nézet** a kódban élő lapokon nem jelenik meg (például a
Kurzusok listáján, a Tudástár listáján, a Szakembereknek oldalon, a fiók- és
pénztároldalakon). A kurzusoldalak és a blogbejegyzések előnézetében csak az
előnézet sávja áll, szekciónkénti szalag nincs.

A bal oldali menü **Kezdőlapi videó szövegei** pontja ugyanígy működik: a
kezdőlap szerkesztőjét a nyitó videó szekciójánál nyitja meg.

### A szerkesztőből az oldalra

- **Egy szekció:** minden szekció tetején ott a **Megnézem az oldalon (új
  lapon)** link. Új lapon nyílik meg a piszkozat előnézete, pontosan annál a
  szekciónál. Mindig a legutóbb mentett piszkozatot mutatja; az automatikus
  mentés pár másodperccel a gépelés után történik. Ritkán, ha a szekciónak
  nincs azonosítója, a link a lap tetejére visz; ezt a link melletti mondat
  jelzi: „A lap a tetején nyílik meg, innen görgess a szekcióhoz.”
- **Az egész oldal:** a jobb felső **Előnézet** gomb (3. pont).
- Rejtett szekciónál a Megnézem link nem jelenik meg, hiszen a szekció a lapon
  nem látszik. A Kapcsolat oldalon a Vélemények, a Tudástár-ajánló, a
  Kurzuskártyák és a kurzusra vivő Gombos kiemelő sáv szekciónál sincs ilyen
  link, mert ott ezek nem vagy hiányosan látszanak; a szekció tetején álló doboz
  megmondja, miért.

### A rejtett szekció és a látható párja

Ha egy szekció rejtve van, a tetején figyelmeztető doboz áll: „Figyelem:
rejtett szekció”. Ha ugyanazon a lapon egy ugyanilyen típusú és ugyanilyen című
szekció látható, a doboz ezt is megmondja (például „Ugyanezzel a címmel a 2. sor
látszik a lapon, a látható szöveget ott írod át.”), alatta pedig egy link áll:

> A látható párja: 02 · Megérdemled a profi törődést

A linkre kattintva a szerkesztő a látható szekcióra ugrik, és kinyitja. A lap
nem töltődik újra, ezért amit addig beírtál, megmarad. A kezdőlapon ma ez a
helyzet: a 11. sor a 2. sor rejtett ikerpéldánya, amit ott írsz, az a lapon
nem jelenik meg.

### Ugyanez máshol

Néhány szekció más oldalon is él, külön példányban (például az „Így tudunk
segíteni” sín a kezdőlapon, a Rólunk és a Szolgáltatások oldalon; a
szakemberkártyák a Rólunk és a Kapcsolat oldalon). Ilyenkor a szekció tetején
egy lista áll, ezzel a bevezetővel: „Hasonló szekció más oldalon:”. Utána a
másik példányok, mindegyik linkkel, végül ez a mondat: „Ezek külön példányok: az
itteni módosítás csak ezt az oldalt érinti.”

Ha ugyanaz a telefonszám, e-mail-cím vagy kép más szekcióban is szerepel,
ugyanitt egy másik lista mondja meg, hol: „Ugyanez a telefonszám (…) máshol is
szerepel:”, a lista után pedig: „Ha itt cseréled, ott is cseréld.” Képnél a
lista után ez áll: „Ha itt az X-szel kiveszed, és másik képet választasz, ott a
régi marad. A ceruza viszont a kép adatait mindenhol módosítja.” A képmezők
súgója ugyanezt mondja:

> Cseréhez az X-szel vedd ki a képet, aztán tölts fel újat az „Új létrehozása” gombbal, vagy válassz a meglévők közül. A ceruza a kép adatait minden oldalon módosítja.

A listák linkjei a másik szekciót ugyanígy nyitják meg, a Felhasználók
arcképénél pedig a munkatárs adatlapját.

---

## 15. Ami nem a lapon látszik

Néhány szöveg és kép nem a lapon jelenik meg, hanem megosztáskor, a Google
találatai között, a gépi olvasásnak szóló fájlokban vagy a levelekben. Ezek
forrását itt találod.

### Megosztási kép (Facebook, Messenger)

Ha valaki megoszt egy linket, az előnézet képe ebben a sorrendben dől el: az
első kitöltött mező nyer.

| Tartalom               | 1. próba       | 2. próba  | Ha mindkettő üres     |
| ---------------------- | -------------- | --------- | --------------------- |
| Oldal (a Kapcsolat is) | Megosztási kép | Fejléckép | a Kineticare alapképe |
| Blogbejegyzés          | Megosztási kép | Borítókép | a Kineticare alapképe |
| Kurzus                 | Megosztási kép | Borítókép | a Kineticare alapképe |

A **Kineticare alapképe** egy 1200 × 630 pixeles kép a két alapító közös
fotójával, a „Kézrehabilitációs online kurzusplatform” felirattal és a weboldal
címével. Ez a kép a weboldal kódjában van, az adminban nem látod, és nem is
tudod cserélni: a cseréje fejlesztői munka. Ma a legtöbb oldal megosztásakor
ez látszik, mert az Oldalakon a Megosztási kép üres. A kezdőlapon és a
Szolgáltatások oldalon a Fejléckép a megosztási kép, a kurzusoknál a
Borítókép. Ha a kezdőlap Fejlécképét cseréled, a Facebook-előnézet is változik,
pedig a kép a kezdőlapon nem látszik.

A kódban élő lapoknak (Kurzusok, Tudástár, Szakembereknek) nincs saját
megosztási képük, náluk is az alapkép látszik.

### A Google-találat címe és leírása

| Tartalom                                  | A találat címe                                               | A találat leírása                                                                               |
| ----------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Oldal                                     | SEO-cím, üresen a Cím                                        | SEO-leírás, üresen a Rövid bevezető                                                             |
| Kezdőlap                                  | SEO-cím, üresen a Cím                                        | SEO-leírás, üresen a Rövid bevezető                                                             |
| Kapcsolat                                 | SEO-cím, üresen a Cím, annak híján „Kapcsolat”               | SEO-leírás, üresen a weboldal beépített leírása (a Rövid bevezető itt nem számít)               |
| Blogbejegyzés                             | SEO-cím, üresen a Cím                                        | SEO-leírás, üresen a Rövid bevezető                                                             |
| Tünet-oldal (a nyolc Tudástár-cikk tükre) | az Oldal SEO-címe, üresen az Oldal Címe                      | az Oldal SEO-leírása, üresen az Oldal Rövid bevezetője; a blogbejegyzés SEO-címe itt nem számít |
| Kurzus                                    | SEO-cím, üresen a Kurzus címe, annak híján a Belső azonosító | SEO-leírás, üresen a Rövid leírás, annak híján egy beépített mondat a kurzus nevével            |
| Kurzusok, Tudástár, Szakembereknek        | a weboldal kódjában van                                      | a weboldal kódjában van                                                                         |

A böngészőfülön a cím után „| Kineticare” áll, ezt a rendszer teszi hozzá. Ha
a SEO-cím végére magad írod ki a márkát, a rendszer nem ismétli meg; ha a cím
közepén szerepel a Kineticare szó, a cím úgy marad, ahogy írtad. A **SEO-kulcsszavak**
a keresőknek szóló kifejezések, a lapon nem jelennek meg. A „Rejtett kurzus
(csak közvetlen linkkel)” pipás kurzust a Google nem veszi fel a találatai
közé.

### Gépi olvasás: llms.txt és llms-full.txt

Két fájl a mesterséges intelligencián alapuló keresőknek és asszisztenseknek
szól. A lapon nem látszanak, de a tartalmukat az adminban írt szövegek adják.

- **/llms.txt**: a weboldal térképe. A bevezetője (a két szakember neve, a
  kapcsolati e-mail-cím, a „Fontos:” kezdetű figyelmeztetés) és a Kezdőlap sora
  a weboldal kódjában van. Utána jön minden közzétett Oldal (a kezdőlap, a
  Kapcsolat, a jogi oldalak és a tünet-oldalak kivételével): a link szövege az
  Oldal Címe, a leírása a SEO-leírás, üresen a Rövid bevezető. A Kapcsolat sora
  a Kapcsolat oldal SEO-leírását, üresen a Rövid bevezetőjét mutatja. A
  kurzusoknál a Kurzus címe (üresen a Belső azonosító) és a SEO-leírás, üresen
  a Rövid leírás; a Tudástár cikkeinél a Cím és a SEO-leírás, üresen a Rövid
  bevezető. A jogi oldalak a fájl végén állnak.
- **/llms-full.txt**: a nyilvános lapok teljes szövege. Minden közzétett Oldal
  Címe, Rövid bevezetője és szekcióinak szövege (a rejtett szekciók nélkül, a
  kezdőlapon úgy, ahogy a lapon látszik); Szekciók nélküli oldalnál a Tartalom.
  Utána a kurzusok neve, Rövid leírása és Részletes leírása, végül a
  blogbejegyzések címe, Rövid bevezetője és szövege. A tünet-oldalak a cikkük
  szövegével, egyszer szerepelnek.

Ha a Tudástár ki van kapcsolva, a cikkek egyik fájlban sem szerepelnek. A két
fájl a módosítás után legfeljebb kb. 10 perc alatt frissül.

### Visszaigazoló levelek

A weboldal leveleinek szövege a kódban van. Két részletük a lapon írt
szövegekkel függ össze:

- **Időpontkérés.** Aki az időpontkérő űrlapot elküldi, levelet kap „Megkaptuk
  az időpontkérésed: Kineticare” tárggyal. A levél ezt ígéri: „Megkaptuk az
  időpontkérésed. Ez még nem foglalás: két munkanapon belül telefonon keresünk,
  és közösen egyeztetjük a pontos időpontot.”, és „Az első alkalom minden
  esetben 50 perces vizsgálattal kezdődik.” Ugyanezt ígéri a Kapcsolat oldalon
  az Időpontkérés szekció „Hogyan megy tovább?” és „A sikeres beküldés szövege”
  mezője, a Szakemberek kártyái bevezetője és a Szolgáltatások oldal árlistája.
  Ha ezeken a helyeken mást ígérsz (például három munkanapot), szólj a
  fejlesztőnek, hogy a levél is ugyanezt mondja. A két mező súgója is
  emlékeztet erre.
- **Vásárlás.** A vevő „Sikeres vásárlás:” kezdetű tárgyú levelet kap a
  rendelésszámmal, benne: „Köszönjük a vásárlásod! A fizetésed sikeres, a
  kurzushozzáférésed aktív.” A számlát a Számlázz.hu rendszere külön levélben
  küldi. A megvett kurzus neve a levélben a Belső azonosító (lásd lent).

### A számlán és a fizetésnél látszó kurzusnév

A **Webshop → Kurzusok →** a kurzus → **Alapadatok → Belső azonosító** mező
áll a számlán, a rendeléseken, a vásárlási visszaigazoló levélben és a Barion
fizetőoldalán. A weboldalon a **Kurzus címe** látszik, ha ki van töltve,
különben ugyanez a Belső azonosító. A Belső azonosító minden kurzusnál más kell,
hogy legyen, és a módosítása csak a következő vásárlástól látszik: a régi
rendelések és számlák a régi nevet őrzik.

---

## 16. Amit a rendszer induláskor visszahoz

A weboldal minden indulásakor, vagyis minden élesítés után lefut néhány
ellenőrzés. A meglévő tartalmat sosem írják felül. A kezdőlapot és a
véleményeket 2026. szeptember 23. óta csak egy teljesen új, üres rendszeren
töltik fel, így a te döntésed (törlés, átnevezés, üres szekciósor) nem fordul
vissza a következő indulásnál.

| Mit néz                                                                 | Mikor hoz létre valamit                                    | Mit hoz létre                                                                                                    |
| ----------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| A kezdőlapot                                                            | Csak ha az Oldalak között egyetlen oldal sincs             | Egy közzétett kezdőlapot az alap-szekciósorral                                                                   |
| Az induló véleményeket                                                  | Csak ha a Vélemények között egyetlen vélemény sincs        | A három induló véleményt (Garami Gábor, Kállai Dóra, Bagdal Szilvia) Kiemelt és Látható pipával, 1–3. sorrenddel |
| A három űrlapot, pontos név szerint (Időpontkérés, Hírlevél, Kapcsolat) | Ha nincs ilyen nevű űrlap (például törölték)               | Egy új, alapmezős űrlapot ugyanezzel a névvel                                                                    |
| A kezdőlap induló képeit, fájlnév szerint                               | Ha a Képek között nincs ilyen nevű fájl (például törölték) | A képet újra feltölti                                                                                            |

Mit jelent ez a gyakorlatban:

- **A kezdőlap webcímét ne írd át, és a kezdőlapot ne töröld.** A webcím
  átírása után a `/` cím a weboldal beépített alapváltozatát mutatja, és ez így
  marad, amíg a webcímet vissza nem írod „kezdolap”-ra. Új kezdőlap nem jön
  létre. A webcím mező alatt ez a figyelmeztetés is áll: „A weboldal kódja
  erre a webcímre épít, ne írd át.”
- **A kezdőlap közzétételét ne vond vissza.** Ezt a rendszer induláskor sem
  hozza helyre. Közzétett kezdőlapnál a webcím mező alatti doboz ezt is
  kimondja: „A „Közzététel visszavonása” után a kezdőlapon (/) a weboldal
  beépített tartalék-kezdőlapja jelenik meg, új kezdőlap nem jön létre, és az
  újbóli közzététellel ismét ez az oldal látszik.”
- **A kezdőlap összes szekcióját ne töröld.** A szerkesztő tetején ez áll: „Ha
  az összes szekciót törlöd és közzéteszed, a kezdőlapon a weboldal beépített
  alapváltozata jelenik meg, a szekciók pedig maguktól nem kerülnek vissza, a korábbi állapotot a Verziók fülön állíthatod vissza.” Egy szekció helyett
  használd a Látható pipát (7. pont).
- **A véleményeket** szabadon törölheted és átnevezheted, a rendszer nem hozza
  vissza őket, amíg legalább egy vélemény van. Ha csak nem akarod mutatni, a
  Kiemelt vagy a Látható pipát vedd ki.
- **A három űrlapot ne töröld.** Átnevezni nem is tudod őket: a mentés
  hibaüzenettel megáll. Törlés után az Időpontkérés szekció űrlapja letiltva
  jelenik meg, a láblécből eltűnik a hírlevél-feliratkozó, a következő indulás
  pedig új, üres űrlapot hoz létre.
- **A kezdőlap induló képeit** a Képek között hagyd meg. Ha egy képnek a fájlja
  vész el a tárhelyről, a rendszer a kódban őrzött eredetiből pótolja, ha van
  ilyen; a saját feltöltésű képeknél nincs ilyen pótlás.

Ha ezek közül valamit végleg el akarsz tüntetni, szólj a fejlesztőnek.

---

## 17. Kódban lévő feliratok a kurzusoldalon

A kurzusoldal néhány felirata nem a kurzus mezőiből jön, hanem a weboldal
kódjából. Ezeket az adminban nem tudod átírni; ha változtatni szeretnél, szólj
a fejlesztőnek.

**Kapcsolódó kurzusok.** A kurzusoldal alján álló sávban a kurzusokat te
választod ki: **Webshop → Kurzusok →** a kurzus → **Kurzusoldal → Kapcsolódó
kurzusok**. Csak a közzétett, nem rejtett kurzusok látszanak. A sáv címe és
bevezetője viszont a kódban van:

- fizetős kurzus oldalán a cím: „Kapcsolódó kurzusok”, bevezető nélkül;
- az ingyenes kurzus oldalán a cím: „Mi jön az ingyenes kurzus után?”, alatta
  ez a bevezető: „Ha az ingyenes anyag után rendszeresen gyakorolnál, itt folytathatod. Az árat alább látod, a teljes tananyagot pedig a kurzus oldalán.”
  Ha a kapcsolt kurzusnak nincs látható ára, a második mondat helyett ez áll:
  „A teljes tananyagot a kurzus oldalán találod.”

**Az akciós kurzusoldal feliratai.** Az akciót a **Webshop → Kurzusok →** a
kurzus → **Ár és hozzáférés → Akciós megjelenés** részben állítod be (Akciós
kurzus, Akció kezdete, Akció vége, Akciós ár (Ft)). Az akciós oldal három
állandó felirata a kódban van:

- a lap tetején a jelvény: „Akciós ár”;
- az előnyök sávjának címe: „A kurzus fő előnyei”;
- a záró sáv címe: „Kezdd el az akciós áron”.

Az Akciós megjelenés súgója is ezt mondja. Az akciós elrendezést csak élesben
látod: az előnézet mindig a normál kurzusoldalt mutatja.

A kurzusoldal szakaszcímei („Hogyan működik?”, „Tananyag”, „Kinek való, és
kinek nem?”, „Garancia”, „Gyakori kérdések”) és a vásárlógombok feliratai
szintén a kódban vannak, szándékosan minden kurzuson egyformák.

---

## 18. A rendelői árlista formai szabálya

A Szolgáltatások oldal rendelői árlistája egy **Szabad szöveg** szekció, amelynek
az ugrópontja „rendeloi” (**Megjelenés és elrejtés → Ugrópont neve (haladó
beállítás)**). A lap ebből a szövegből árkártyákat épít, ha a szöveg szerkezete
felismerhető. A szabályt a Tartalom mező fölött is olvashatod, ugyanezekkel a
mondatokkal.

Ennek a szekciónak az ugrópontja „rendeloi”, ezért a szövegből akkor lesznek
árkártyák, ha az alábbi szabályok mind teljesülnek.

1. A szöveg első eleme egy nem üres címsor az első három szint valamelyikén (Címsor 1, 2 vagy 3); a kisebb címsor nem számít.
2. Valahol utána egy „Árlista” szóval kezdődő címsor jön, szintén az első három szint valamelyikén.
3. Közvetlenül e címsor alatt egy felsorolás áll legalább egy, legfeljebb négy tétellel, és minden tétel „50 perces alkalom: 18 000 Ft” alakú; a kettőspont helyett kötőjel is állhat, a tétel végén pedig zárójeles megjegyzés.
4. A felsorolás után csak bekezdés következhet, újabb felsorolás vagy címsor nem.
5. Ezekben a bekezdésekben legfeljebb egy link lehet, és annak a /kapcsolat oldalra kell mutatnia; a „Helyszíneink:” kezdetű bekezdés legfeljebb egyszer szerepelhet.

Ha bármelyik nem teljesül, a szöveg sima szövegként látszik.

Egy felismerhető szerkezet például:

- Címsor 2: Rendelői kezelések
- Bekezdés: pár mondat a kezelésekről
- Címsor 3: Árlista
- Felsorolás: „50 perces alkalom: 18 000 Ft”
- Bekezdés: „Helyszíneink: …” a rendelők címével
- Bekezdés: egy link a /kapcsolat oldalra (ebből lesz a „Kérj időpontot
  üzenetben” gomb)

Ha a szabály sérül, a lap figyelmeztetés nélkül sima szöveget mutat. Az
előnézetben viszont a szekció szalagján ez a figyelmeztetés áll: „Az árlista
nem ismerhető fel, sima szövegként látszik.” Mentés után ezért mindig nézd meg
az árlistát a **Megnézem az oldalon (új lapon)** linkkel. Az ugrópontot ne
nevezd át: a „rendeloi” név nélkül nincsenek árkártyák, és a menü „Rendelői
kezelések” pontja sem ide visz.

---

## 19. Amihez ne nyúlj

Ezek nem tiltások a tiltás kedvéért: mindegyik mögött van valami, ami a
látogatóknak vagy a vásárlóknak fáj, ha elromlik.

**Webshop (Kurzusok, Rendelések, Kosarak, Tranzakciók)**

- A **Rendeléseket, Kosarakat, Tranzakciókat** ne írd át, ne töröld. Ezeket a
  fizetési folyamat tölti automatikusan, és ezekhez kötődik az, hogy a vásárló
  hozzáfér-e a megvett kurzushoz, illetve mi kerül a számlájára. Ha egy
  rendeléssel gond van, szólj — ne javítsd kézzel.
- A **Kurzusok** árát, státuszát csak egyeztetés után módosítsd.

**Felhasználók**

- A **Szerepkör** mezőt csak a tulajdonos tudja állítani (Tulajdonos / Munkatárs /
  Vásárló). Ha új kollégának kell hozzáférés, kérd meg a tulajdonost.
- Felhasználót **ne törölj** — vásárlói fiók törlésével a vásárlásai is
  értelmezhetetlenné válnak.
- A **Megvásárolt kurzusok** listát ne pipáld kézzel (a mezőt a rendszer zárja).
  Ajándékot a **Kurzus ajándékozása** panellel adj: az írja be a hozzáférés
  hosszának kezdőpontját is. A pipa önmagában örök hozzáférést adna.

**Rendszer csoport (Rendszeresemények, Műveletnapló)**

- Ez technikai napló a hibakereséshez. Nézni szabad, írni/törölni nem kell benne
  semmit.

**Általános óvatosság**

- **Törlés helyett rejts el.** Menüpontnál, véleménynél és szekciónál vedd ki a
  _Látható_ pipát, oldalnál/bejegyzésnél vond vissza a közzétételt. A törlés
  végleges — a szekcióval együtt a beleírt szöveg is elvész.
- **Élő tartalom webcímét (slug) ne írd át** — a régi linkek elhalnak.
- Ha egy mentés hibaüzenettel áll meg, olvasd el az üzenetet: magyarul mondja meg,
  mi hiányzik. Nem rontottál el semmit, a hibás adat nem mentődött el.

---

## 20. Hibát látsz?

Előfordul. Ilyenkor a legtöbbet azzal segítesz, ha **pontosan** leírod, mi
történt. Küldd el ezt az öt dolgot:

1. **A pontos hibaüzenet** — szó szerint, vagy még jobb: képernyőkép az egész
   képernyőről (a böngésző címsorával együtt).
2. **Az időpont** — dátum és óra:perc. Ez a legfontosabb: a naplókban időpont
   alapján kereshető meg, mi történt a háttérben.
3. **Mit csináltál** — pl. „a Blogbejegyzések alatt a »Csuklófájdalom« cikknél a
   Közzététel gombra kattintottam".
4. **Melyik oldalon/dokumentumnál** — a böngésző címsorában látszó cím segít
   (`.../admin/collections/posts/123`).
5. **Böngésző és eszköz** — pl. „Chrome, laptop" vagy „Safari, iPhone".

Amit **ne** csinálj hiba után: ne nyomd meg ötször ugyanazt a gombot. Előbb
frissítsd az oldalt, és nézd meg a listában, létrejött-e mégis a dokumentum —
így elkerülhető, hogy ugyanaz a cikk háromszor szerepeljen.

Ha a hiba pénzt vagy vásárlót érint (rendelés, fizetés, hozzáférés), azt jelezd
azonnal és külön — az ilyet nem érdemes „majd holnap" alapon kezelni.
