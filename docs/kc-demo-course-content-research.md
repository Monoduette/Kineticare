# Képzeletbeli akciós kurzus: kutatási brief és végleges szöveg

**Állapot:** demó kampányoldal, nem valódi ajánlat
**Frissítve:** 2026-09-05
**Hatókör:** a meglévő Kineticare `Page` és layout blokkok tartalma. Nincs új CMS-séma,
ár, kedvezmény, checkout, adatbekérés vagy publikálás.

## Kutatási döntések

- A magyar találati minta az otthoni kéztornához kapcsolódó kereséseknél főként
  tájékoztató cikkeket, gyakorlatleírásokat, videókat és személyes szolgáltatásokat
  mutatott. A domináns szándék információs. Az oldal ezért előbb használható tudást és
  mintaleckét ad, nem vásárlást sürget. Keresési volumenre vagy várható helyezésre nincs
  állítás.
- A Google jelenlegi útmutatója szerint az AI Overviews és AI Mode nem igényel külön
  „AI SEO” megoldást. A fontos alap a hasznos, megbízható, embernek írt tartalom, a
  világos szerzőség, a szövegesen elérhető lényeg és a jó oldalélmény.
- A Google FAQ rich result 2026. május 7-től nem jelenik meg; a dokumentációját 2026.
  június 15-én eltávolították. A GYIK a látogatónak készül, nem külön keresési
  megjelenésért.
- A demó maradjon `noindex, follow`. Ne kapjon `Course`, `Product`, `Offer`, `Review`,
  `AggregateRating` vagy `FAQPage` strukturált adatot, mert nincs mögötte valódi kurzus,
  ajánlat vagy értékelés.
- A modulokhoz a meglévő `accordion` blokk használható. A cím és a rövid összefoglaló
  csukott állapotban is látszik; a vezérlő billentyűzettel működik, állapotát az
  `aria-expanded` közli. A mintalecke a fő út, ezért közvetlenül a hero után következik.
- A CTA-k navigációk, ezért a normatív §3.2/P-1b szerint E/2 alakúak:
  `Nézd meg a mintaleckét` és `Írj nekünk`. A mintalecke új navigációs cél; ha a
  megvalósítás szótári bejegyzést igényel, a CTA-szótárat és őrtesztet együtt kell
  frissíteni.

## Végleges oldalszöveg

### Hero

**Címke és az egyetlen demóközlés:**

> Demóoldal: ez egy képzeletbeli kurzus, nincs hozzá valódi kedvezmény, ár vagy
> vásárlási lehetőség.

**H1:** Képzeletbeli akciós kurzus

**Bevezető:**

> Tanuld meg rendszerezni a kézhasználattal kapcsolatos hétköznapi megfigyeléseidet, és
> készülj fel tudatosabban egy szakmai konzultációra.

**Rövid tartalmi adatok:** `5 modul` · `15 rövid lecke` · `kb. 75 perc`

**Elsődleges CTA:** `Nézd meg a mintaleckét` → `#minta-lecke`
**Másodlagos CTA:** `Írj nekünk` → `/kapcsolat`

### Mintalecke

**Kis felső felirat:** Mintalecke

**Cím:** Készíts használható megfigyelési jegyzetet

**Bevezető:**

> Egy pontos jegyzet segít elkülöníteni a megfigyelt tényeket a feltételezésektől.
> Haladj végig a három kérdésen, majd foglald össze egy mondatban, amit észrevettél.

#### 1. Írd le a helyzetet

**Rövid kivonat:** Mikor és milyen tevékenység közben figyelted meg?

> Jegyezd fel röviden a napszakot és a tevékenységet. Például: délelőtt, gépelés után;
> vagy este, egy bevásárlótáska elpakolását követően. Maradj a megfigyelhető tényeknél.

#### 2. Nevezd meg, mit vettél észre

**Rövid kivonat:** Egy-két pontos mondat többet ér egy általános jelzőnél.

> Írd le, hol és milyen érzetet tapasztaltál, anélkül hogy következtetést vagy diagnózist
> állítanál fel. Az is hasznos információ, ha az adott helyzetben nem vettél észre
> változást.

#### 3. Fogalmazz meg egy kérdést

**Rövid kivonat:** Mit szeretnél tisztázni egy szakemberrel?

> A feljegyzés végére írj egy konkrét kérdést. Például: érdemes-e módosítanom ezen a
> hétköznapi mozdulaton? A döntést és a személyre szabott tanácsot hagyd a megfelelő
> szakemberre.

### Kinek szól?

**Cím:** Neked szól, ha pontosabban szeretnéd követni a hétköznapi helyzeteket

**Felvezető:** A tananyag abban segít, hogy rendezett megfigyelésekkel készülj, ha:

- nehezen idézed fel, mikor és milyen tevékenység közben vettél észre változást;
- tényszerűbb jegyzeteket szeretnél készíteni;
- konkrét kérdésekkel készülnél egy szakmai konzultációra;
- rövid, egymásra épülő leckékben tanulnál;
- a saját időbeosztásodban szeretnél haladni.

**Oldalsó szöveg:**

> A rövid leckék végigvezetnek a megfigyelés, a rendszerezés és az összegzés lépésein.
> Nem kell hozzá egészségügyi előképzettség.

**Kiemelt biztonsági határ:**

> A tananyag nem diagnosztizál, nem ad gyakorlatprogramot, és nem helyettesíti az orvosi
> vizsgálatot vagy az egyéni gyógytornászati ellátást.

### Mit ad a kurzus?

**Cím:** Kevesebb találgatás, pontosabb kérdések

> A kurzus végére lesz egy egyszerű rendszered a hétköznapi tapasztalatok rögzítésére.
> Könnyebben áttekinted, mely helyzetek térnek vissza, és pontosabban fogalmazod meg, mit
> szeretnél tisztázni egy szakemberrel. A napló nem állapít meg okot vagy diagnózist.

- **Megfigyelési szempontok:** mit, mikor és milyen helyzetben érdemes feljegyezni.
- **Egységes szerkezet:** a bejegyzések később is könnyen összehasonlíthatók.
- **Kérdéslista:** a konzultáció előtt egy helyen látod, mire szeretnél választ kapni.

### Modulok

**Kis felső felirat:** Tananyag

**Cím:** Öt modul az első jegyzettől a rendezett kérdéslistáig

**Bevezető:**

> A modulok egymásra épülnek, de később külön is visszanézhetők. Mindegyik három rövid
> leckében dolgoz fel egy témát, majd egy konkrét jegyzetelési lépéssel zárul.

#### 1. modul: Pontos megfigyelés

**Rövid kivonat:** Helyzet, időpont és megfigyelhető tények

> **Leckék:** Mit nevezünk megfigyelésnek? · A helyzet rövid leírása · Tény és
> feltételezés szétválasztása
>
> Megtanulod röviden rögzíteni, mi történt, mikor történt és mit vettél észre. A modul
> nem értékeli az egészségi állapotodat.

#### 2. modul: Követhető jegyzet

**Rövid kivonat:** Azonos kérdések minden bejegyzéshez

> **Leckék:** Egyszerű jegyzetsablon · Érthető szavak és rövid mondatok · Mi maradjon ki?
>
> Kialakítasz egy könnyen ismételhető szerkezetet, amelyben a bejegyzések később is
> gyorsan áttekinthetők.

#### 3. modul: Hétköznapi kézhasználat

**Rövid kivonat:** Munka, háztartás, telefon és alkotás

> **Leckék:** Gyakori tevékenységek összegyűjtése · Könnyebb és nehezebb helyzetek ·
> Pihenők és váltások feljegyzése
>
> Sorra veszed azokat a hétköznapi helyzeteket, amelyekben sokat használod a kezed. A cél
> a pontos leírás, nem az okok önálló megállapítása.

#### 4. modul: Visszatérő minták

**Rövid kivonat:** Mi ismétlődik, és mi változik napról napra?

> **Leckék:** Bejegyzések időrendben · Visszatérő helyzetek jelölése · Kivételek és
> változások
>
> Egymás mellé rendezed a jegyzeteidet, és kiemeled a visszatérő helyzeteket. Nem vonsz
> le klinikai következtetést, hanem előkészíted a tisztázandó kérdéseket.

#### 5. modul: Felkészülés a konzultációra

**Rövid kivonat:** Rövid összegzés és konkrét kérdések

> **Leckék:** Mi kerüljön az összefoglalóba? · Kérdések fontossági sorrendben · A napló
> áttekintése konzultáció előtt
>
> Elkészíted a rövid összegzést és a kérdéslistát, amelyet magaddal vihetsz egy szakmai
> konzultációra. A végső értékelést és az egyéni tanácsot a megfelelő szakember adja.

### Így épül egymásra a tanulás

1. **Megfigyelsz egy helyzetet.** Rögzíted a tevékenységet, az időpontot és azt, amit
   ténylegesen észrevettél.
2. **Rendszerezed a jegyzeteidet.** Azonos szerkezetben írod le a helyzeteket, így később
   könnyebben áttekinthetők.
3. **Kérdéseket fogalmazol meg.** Kiválasztod, mit szeretnél egy megfelelő szakemberrel
   pontosítani.

### Gyakori kérdések

#### Kell hozzá egészségügyi előképzettség?

Nem. A fogalmakat közérthetően, hétköznapi példákkal vezetjük be. A cél a pontosabb
megfigyelés és jegyzetelés, nem az önálló állapotértékelés.

#### Mennyi idő alatt végezhető el?

A 15 rövid lecke összesen körülbelül 75 perc. Haladhatsz modulonként, és közben időt
hagyhatsz a saját jegyzeteid elkészítésére.

#### Tartalmaz elvégezhető kéztorna-gyakorlatokat?

Nem. A tananyag a hétköznapi helyzetek megfigyelésére, a jegyzetelésre és a kérdések
rendszerezésére összpontosít. Nem ad mozdulatsort vagy terhelési javaslatot.

#### Helyettesíti az orvosi vizsgálatot vagy a gyógytornát?

Nem. A napló segíthet felkészülni egy beszélgetésre, de nem ad diagnózist vagy egyéni
kezelési tervet. Akut sérülés, romló panasz vagy bizonytalan terhelhetőség esetén kérj
személyre szabott szakmai segítséget.

#### Milyen eszköz kell hozzá?

A leckék megtekintéséhez internetkapcsolattal rendelkező telefon, táblagép vagy
számítógép, a feladatokhoz pedig papír vagy digitális jegyzet szükséges. Egészségügyi
vagy kéztornaeszközt a kurzus nem kér.

#### Kapok egyéni visszajelzést vagy tanúsítványt?

Nem. Ez önállóan követhető ismeretterjesztő tananyag, nem állapotfelmérés, továbbképzés
vagy szakmai minősítés. Egyéni kérdéssel megfelelő szakemberhez fordulj.

#### Hol tehetek fel kérdést?

A Kineticare kapcsolati oldalán írhatsz üzenetet. Egészségügyi sürgősség esetén ne az
űrlapot használd, hanem kérj azonnali segítséget az illetékes ellátótól.

### Záró CTA

**Cím:** Próbáld ki az első három lépést

**Szöveg:**

> A mintaleckében néhány perc alatt elkészítheted az első rendezett megfigyelési
> jegyzetedet.

**CTA:** `Nézd meg a mintaleckét` → `#minta-lecke`

## Leképezés a meglévő Page architektúrára

| Meglévő mező vagy blokk | Tartalom |
| --- | --- |
| `Page.title` | `Képzeletbeli akciós kurzus` |
| `Page.excerpt` | a hero bevezetője |
| `Page.heroImage` | meglévő, jogtiszta Kineticare-kép pontos alt szöveggel |
| hero disclosure | az egyetlen demóközlés |
| `accordion`, `#minta-lecke` | a háromlépéses mintalecke |
| `welcome` | a Kinek szól? és Mit ad a kurzus? tartalma |
| `accordion`, `#modulok` | az öt modul |
| `howItWorks` | a három tanulási lépés |
| `faq` | a hét kérdés és válasz; demóban strukturált adat nélkül |
| `ctaBanner` | záró mintalecke CTA |
| `Page.seoTitle` | `Képzeletbeli akciós kurzus, demó - Kineticare` |
| `Page.seoDescription` | `Ismerd meg egy képzeletbeli Kineticare-kurzus mintaleckéjét és öt modulját. Demóoldal, valódi ajánlat és vásárlás nélkül.` |

## Megvalósítási és publikálási kapuk

- A demóközlés egyszer, a hero első képernyőjén látszik.
- A fő CTA minden előfordulása `Nézd meg a mintaleckét` és `#minta-lecke`.
- A kapcsolati CTA `Írj nekünk` és `/kapcsolat`; új űrlap nem készül.
- Nincs ár, referenciaár, kedvezmény, kupon, lejárat, visszaszámláló vagy checkout.
- Nincs klinikai eredmény, diagnózis, személyre szabott kezelési javaslat, testimonial,
  értékelés, tanúsítvány vagy rangígéret.
- Nincs páciens-, egészségügyi vagy fizetési adat bekérése.
- A modulcím és a rövid kivonat csukott állapotban is látszik; a vezérlő billentyűzettel
  és képernyőolvasóval használható.
- A demó `noindex, follow`; a felsorolt strukturált adatok egyike sem kerül rá.
- Éles ajánlattá alakítás előtt külön szakmai, jogi/kereskedelmi, SEO- és
  hozzáférhetőségi review szükséges. A demó tartalma önmagában nem élesíthető.

## Források

**Elsődleges, aktuális külső források:**

- Google Search Central: [Creating helpful, reliable, people-first
  content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)
- Google Search Central: [AI features and your
  website](https://developers.google.com/search/docs/appearance/ai-features)
- Google Search Central: [Optimizing for generative AI features](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- Google Search Central: [Title links](https://developers.google.com/search/docs/appearance/title-link)
- Google Search Central: [Snippets and meta descriptions](https://developers.google.com/search/docs/appearance/snippet)
- Google Search Central: [Documentation updates](https://developers.google.com/search/updates)
- W3C WAI: [Accordion Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/accordion/)
- GOV.UK Design System: [Accordion](https://design-system.service.gov.uk/components/accordion/)

**A 2026-09-05-i magyar keresési szándék mintája:**

- [Kéztorna, kézsérülés utáni rehabilitáció](https://www.harmonia-centrum.hu/keztorna-kezserules-utani-gyogytorna)
- [Otthoni gyakorlatok és önkezelés](https://kezklinika.hu/tudastar/mutet-nelkuli-kezelesek-es-rehabilitacio/otthoni-gyakorlatok-es-onkezeles)
- [Csuklótörés utáni gyógytorna](https://www.hazigyogytorna.hu/csuklotores-utani-gyogytorna/)
- [Egyszerű kéz és csukló torna](https://www.fizioart.hu/kez-es-csuklo-torna/)

**Helyi alap:** `.claude/skills/termektervezes/SKILL.md`, `docs/seo-geo-llm.md`,
`docs/kulcsszavak.md`, `docs/ertekesitesi-ux-skill.md`, `docs/ui-sztenderdek.md`,
`docs/informacios-architektura.md`, `docs/regi-oldal-osszehasonlitas.md` és
`docs/kc-v1-design-decisions.md`.

## Bizonyítéki korlát

Ez dokumentációs és kutatási eredmény. Nem történt runtime-, CMS-, adatbázis-, fizetési,
függőség- vagy Git-írás. A dokumentum nem bizonyít élő megjelenést, indexelést, keresési
teljesítményt vagy klinikai megfelelőséget.
