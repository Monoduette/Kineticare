# Szerkesztői útmutató — a Kineticare admin használata

> **Kinek szól?** Neked, aki a weboldal tartalmát írod és gondozod. Nem kell hozzá
> semmilyen informatikai előképzettség: ez az útmutató végigvezet azon, hogyan
> hozol létre blogbejegyzést, oldalt, kategóriát, menüpontot és véleményt, hogyan
> töltesz fel képet, és mihez jobb nem hozzányúlni.
>
> Az útmutató a jelenlegi admin felülethez készült: minden gombnév és mezőnév úgy
> szerepel benne, ahogy a képernyőn látod. Ha valami mást látsz, mint amit itt
> olvasol, az hiba — jelezd (lásd a legvégén: „Hibát látsz?").

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

| Csoport          | Mi van benne                                            | Kell-e neked?                                                                          |
| ---------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Tartalom**     | Képek, Oldalak, Blogbejegyzések, Kategóriák, Vélemények | Igen — ez a napi munkád.                                                               |
| **Navigáció**    | Menüpontok                                              | Igen — az oldal tetején látszó menü.                                                   |
| **Webshop**      | Kurzusok, Rendelések, Kosarak, Tranzakciók              | A kurzus tananyagát itt állítod össze (12. pont); a rendelésekhez ne nyúlj (13. pont). |
| **Űrlapok**      | Űrlapok, Űrlapbeküldések                                | A kapcsolati űrlap és a beérkezett üzenetek.                                           |
| **Felhasználók** | Felhasználók                                            | Csak óvatosan. Lásd a 13. pontot.                                                      |
| **Rendszer**     | Rendszeresemények, Műveletnapló                         | Nem a tiéd — csak technikai napló.                                                     |

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

**Hol találod?** A dokumentum tetején, a jobb felső sarokban lévő gombsorban
(a **Mentés** / **Közzététel** gombok mellett) van egy kis **ikon: négyzetből
kifelé mutató nyíl**. Nincs mellette felirat — ha ráviszed az egeret, megjelenik
a buborék: „Előnézet". Erre kattintva **új lapon** nyílik meg az oldal a
piszkozat tartalmával. Az ikon csak akkor jelenik meg, ha a dokumentumnak már
van webcíme (slugja) — vagyis miután először elmentetted.

Az előnézet csak bejelentkezett munkatársnak/tulajdonosnak működik: ha valaki
másnak küldöd el a linket, ő nem fogja látni a piszkozatot.

### Webcím (slug)

A **Webcím (slug)** a cím webcímes alakja: ékezetek nélkül, kisbetűvel,
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

1. Bal oldalt: **Tartalom → Blogbejegyzések**, majd jobb fent **Új létrehozása**.
2. **Cím** — kötelező. Ez jelenik meg a bloglistán és a Google találatai közt.
3. **Webcím (slug)** — magától kitöltődik a címből, hagyd békén.
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
9. **Megjelenés dátuma** — az első közzétételkor magától kitöltődik; a bloglista
   ez alapján rendez (a legfrissebb elöl). Csak akkor írd át, ha szándékosan más
   dátumot akarsz mutatni.
10. **Szerző** — alapból te vagy. Csak akkor állítsd át, ha más nevében írod.
11. **Kategóriák** — több is választható. Ha még nincs megfelelő, előbb hozd létre
    (5. pont).
12. **Kapcsolódó bejegyzések** — legfeljebb 3 cikk, amit a bejegyzés alján ajánlunk.
13. Mentés után kattints a jobb fenti **előnézet-ikonra** (négyzetből kifelé
    mutató nyíl), és nézd meg új lapon, jól fest-e.
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
3. **Webcím (slug)** — magától kitöltődik, ékezet nélkül (`kezrehabilitacio`).
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
2. **Cím**, **Webcím (slug)**, **Rövid bevezető**, **Tartalom** — ugyanúgy, mint a
   blogbejegyzésnél (4. pont).
3. **Szekciók** — az oldal „építőkockás" része (sávok: nyitó blokk,
   kurzuskártyák, vélemények…). Nem kötelező: ha üresen hagyod, az oldal a
   megszokott módon jelenik meg. Részletesen a 7. pontban.
4. **Fejléckép** — az oldal tetején megjelenő nagy kép (nem kötelező).
5. **SEO-cím**, **SEO-leírás**, **Megosztási kép** — mint a bejegyzésnél.
6. Mentés, **előnézet** (jobb fent a kifelé mutató nyíl ikonja), majd
   **Közzététel**.

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

> **Hol találod?** **Tartalom → Oldalak → `kezdolap`**, majd görgess a
> **Szekciók** mezőig. A szekciók alapból összecsukva jelennek meg, a nevükre
> (pl. „Film-hero (kéznyitás)") kattintva nyílnak ki.

### Mit tudsz csinálni?

**Szöveget írni.** Nyisd ki a szekciót, és töltsd ki a mezőit. Minden mezőnek van
magyar magyarázata a neve alatt — azt érdemes elolvasni, mielőtt írsz.

**Új szekciót felvenni.** A lista alján lévő **Szekció hozzáadása** gombra
kattintva megjelenik a választható szekciótípusok listája, magyar nevekkel és
rövid leírással. A lista két csoportra oszlik:

- **Kezdőlap (ajánlott sorrendben)** — a kezdőlap saját sávjai, abban a
  sorrendben felkínálva, ahogy a lapon ajánlott állniuk;
- **Bárhol használható** — a **Szabad szöveg** és a **CTA-sáv**, amit bármelyik
  oldalon, bárhová beszúrhatsz.

**Sorrendet cserélni.** Minden szekciósor bal szélén van egy **fogantyú** (a
pontokból álló kis ikon). Fogd meg az egérrel, húzd a helyére, engedd el — a
szekció odakerül. Billentyűzettel is megy: állj a fogantyúra a **Tab**
billentyűvel, nyomj **szóközt**, a **nyilakkal** vidd a sort a helyére, majd
újabb **szóközzel** tedd le.

**Elrejteni törlés nélkül.** Minden szekció alján ott van a
**Szekció-beállítások** csoport, benne a **Látható** pipa. Ha kiveszed, a sáv
eltűnik az oldalról, **de a tartalma megmarad** — bármikor visszakapcsolhatod.
Ez a helyes módja egy szekció „kikapcsolásának"; törölni nem kell (a törléssel a
beleírt szöveg is elvész).

**Háttérszínt váltani.** Ugyanitt van a **Háttér** választó (Fehér /
Világoskék / Sötétkék). Váltogasd a fehéret és a világoskéket, hogy az egymás
alatti sávok jól elkülönüljenek; a sötétkéket ritkán, egy-egy kiemeléshez
használd.

**Horgony azonosítót adni.** Szintén a Szekció-beállítások közt: a **Horgony
azonosító** egy rövid név (pl. `kurzusok`), amivel a lapon belül lehet erre a
szekcióra ugrani. Ha megadod, a `https://kineticare.hu/#kurzusok` cím pontosan
ide görget. Így tud egy gomb, egy menüpont vagy egy hírlevél-link a lap közepére
mutatni. Csak ékezet nélküli kisbetűt, számot és kötőjelet írj bele, a `#` jelet
pedig hagyd ki — ha elrontod, a mentés magyar hibaüzenettel figyelmeztet.

### Az ajánlott sorrend — és miért ez

A kezdőlap alap-sorrendje nem véletlen: azt a sorrendet követi, amiben a
látogató dönteni szokott. Fentről lefelé:

| Sorrend | Szekció                                                                              | Mit csinál                                                                                       |
| ------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| 1.      | Film-hero                                                                            | Megmondja, kinek és miben segítünk, és egyetlen hangsúlyos gombbal a kurzusokra visz.            |
| 2.      | Hitel-csík                                                                           | Egy sorban a szakmai háttér — ez keretezi az egész lapot.                                        |
| 3.      | Kurzuskártyák                                                                        | A fizetős kurzusok árral és gombbal. Ez az oldal legfontosabb blokkja.                           |
| 4.      | Ingyenes SOS-sáv                                                                     | Aki még nem venne kurzust, itt kap ingyenes anyagot — a fizetős ajánlat UTÁN, visszafogottabban. |
| 5–10.   | Sajtólogók, Üdvözlő blokk, „Erre számíthatsz", Három állapot, Szolgáltatások, Rólunk | A bizalomépítő, bemutatkozó rész.                                                                |
| 11.     | Így működik                                                                          | Eloszlatja a „vajon menni fog otthon?" kételyt.                                                  |
| 12.     | Vélemények                                                                           | Páciens-visszajelzések — a kurzusok után, legfeljebb három.                                      |
| 13.     | Tudástár                                                                             | A legfrissebb blogcikkek (ez hozza a Google-ből az olvasókat).                                   |
| 14.     | GYIK                                                                                 | A vásárlás előtti utolsó kérdések a lap alján.                                                   |

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

Semmi baj nem történik: **az oldal a megszokott módon jelenik meg**. A kezdőlap
ilyenkor a beépített felépítését hozza (nyitó blokk, kurzuskártyák, ingyenes
SOS, „Így működik", vélemények, Tudástár, GYIK), a többi oldal pedig a
**Tartalom** mezőbe írt szöveget. **Semmi nem vész el** — ha kiürítenéd a
szekciólistát, az oldal nem lesz üres, csak visszaáll erre az alapállapotra.

### Piszkozat, előnézet, közzététel — a szekciókra is

A szekciók pontosan úgy viselkednek, mint az oldal többi mezője (3. pont):

1. Amíg dolgozol, a rendszer **magától ment piszkozatba**. A látogatók
   eközben a korábban közzétett változatot látják — az átrendezésed még nem él.
2. Ha kész vagy, kattints a jobb fent lévő **előnézet-ikonra** (négyzetből
   kifelé mutató nyíl): új lapon, az éles kinézetben látod a piszkozatot, az új
   sorrenddel.
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
2. **Felirat** — ez a szöveg jelenik meg a menüben (pl. „Kurzusok").
3. **Hová mutat** — ettől függ a következő mező:

   | Típus          | Mit válassz utána                                                  |
   | -------------- | ------------------------------------------------------------------ |
   | **Oldal**      | a **Cél** mezőben az oldalak közül választasz (pl. Rólunk)         |
   | **Bejegyzés**  | a **Cél** mezőben egy blogbejegyzést                               |
   | **Kurzus**     | a **Cél** mezőben egy terméket a webshopból                        |
   | **Külső link** | a **Külső webcím** mezőbe teljes címet írsz, `https://`-sel kezdve |

4. **Fölérendelt menüpont** — csak akkor töltsd ki, ha ez almenüpont. Almenüpont
   alá már nem tehetsz továbbit (a menü 2 szintű).
5. **Sorrend** — kisebb szám = előrébb. Érdemes 1, 2, 3… számozást használni.
6. **Látható** — ha kiveszed a pipát, a menüpont eltűnik az oldalról, de nem vész
   el. Ez a helyes módja egy menüpont „elrejtésének" — törölni nem kell.
7. **Új lapon nyíljon** — külső linkeknél szokás bekapcsolni.
8. **Mentés**. A menü azonnal frissül az oldalon.

Ha valamit rosszul állítasz be (pl. „Oldal" típust választasz, de nem adsz meg
célt), a mentés magyar hibaüzenettel megáll — nem tudsz elrontani semmit.

---

## 9. Új vélemény

A vélemények a pácienseink visszajelzései. A kezdőlapon a **kiemelt** vélemények
jelennek meg.

> **A legfontosabb szabály:** ide **kizárólag valós, tényleg elhangzott vélemény**
> kerülhet, **betűhíven**. Kitalált, összeollózott vagy „megszépített"
> visszajelzés tilos.

1. **Tartalom → Vélemények → Új létrehozása**.
2. **Vélemény szövege (teljes)** — kötelező. A teljes, eredeti szöveg, pontosan
   úgy, ahogy elhangzott.
3. **Vélemény szövege (rövid)** — nem kötelező, de a kezdőlapra ez való: 1–2
   mondat, **legfeljebb 260 karakter**. Ha hosszabbat írsz, a mentés magyar
   hibaüzenettel figyelmeztet. A kezdőlapon ez a rövid szöveg jelenik meg; ha
   üresen hagyod, a teljes szöveg kerül ki.
4. **Név** — aki mondta (pl. „Garami Gábor" vagy „P. Benjámin", ha csak
   keresztnévvel vállalta).
5. **Titulus, foglalkozás** — nem kötelező, pl. „zenész / műsorvezető".
6. **Kiemelt** — ez a pipa jelenti azt, hogy **megjelenik a kezdőlapon**.
   A kezdőlapon **legfeljebb 3** vélemény látszik: a kiemeltek közül a
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
- **Formátumok:** jpg, png, webp, avif, gif. SVG nem tölthető fel.
- **Méret:** legfeljebb 10 MB fájlonként. A rendszer a feltöltött képet
  automatikusan optimalizálja és több méretben eltárolja, hogy gyorsan töltsön be
  mobilon is — neked nem kell méretezned.
- **Egy kép többször is használható:** ami egyszer fent van, azt bármelyik
  oldalról ki tudod választani, nem kell újra feltölteni.

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

## 13. Amihez ne nyúlj

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

## 14. Hibát látsz?

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
