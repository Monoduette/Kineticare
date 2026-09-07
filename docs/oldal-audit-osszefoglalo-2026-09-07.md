# Teljes oldal-audit: összefoglaló és rangsorolt teendőlista (2026. szeptember 7.)

Ez a lap a négy részletes audit **közös** kivonata. A tételes bizonyítás, a
mérési táblák és a képernyőképek a részdokumentumokban vannak:

| Terület                                             | Dokumentum                                        |
| --------------------------------------------------- | ------------------------------------------------- |
| Kezdőlap, Szolgáltatások, Rólunk, Kapcsolat         | `docs/oldal-audit-a-belepo-oldalak-2026-09-07.md` |
| Tudástár: lista, kategóriák, nyolc tünet-hub        | `docs/oldal-audit-b-tudastar-2026-09-07.md`       |
| Kurzuslista, termékoldalak, kosár, pénztár, köszönő | `docs/oldal-audit-c-ertekesites-2026-09-07.md`    |
| Belépés, fiók, lejátszó, jogi lapok                 | `docs/oldal-audit-d-fiok-es-jogi-2026-09-07.md`   |

Korábbi, továbbra is érvényes kiindulás: `docs/kezdolap-ux-audit-2026-09-07.md`.

## 1. Hogyan mértünk

Négy párhuzamos audit, mindegyik a `termektervezes` skill szabálya szerint:
minden állításhoz legalább két külső forrás (NN/g, Baymard, GOV.UK, Material 3,
Apple HIG) és a WCAG 2.2 sikerkritérium száma, minden szám mérve, nem becsülve.
Mérőeszköz: Chromium 1194 playwright-core-ral, 320 / 390 / 1024 / 1440 px,
`reduce` és `no-preference` mozgásmódban; kontraszt, érintőcél, sorhossz,
reflow, fókusz-bejárás, animációlista, LCP-jelölt, nyers HTML-fej és
strukturált adat. A tartalmi és SEO-réteg az ÉLES alkalmazásból
(`kineticare-production.up.railway.app`), a geometria jellemzően a helyi
fejlesztői szerverről.

## 2. A keresési kiindulás, amit minden döntéshez ismerni kell

Friss mérés (Semrush HU, 2026-09-07, runId `01M1YAXBEP1XC00TACAWHSRH7T`, 0,03 USD):
a `kineticare.hu` **15 organikus kulcsszóra** rangsorol, **mind a 17. és 83.
pozíció között**, 0,00% forgalommal. A kifejezések többsége irreleváns
(`kata ruhaklinikája`, `kerékbetörés`, `kocsis viktória`, `mozgástér`,
`kiropraktőr` a 76. helyen). **Egyetlen fő kézrehabilitációs kifejezésre sem**
rangsorol: sem a kéztőalagút szindrómára, sem az ínhüvelygyulladásra, sem a
teniszkönyökre, sem a csuklófájdalomra, sem a kéz zsibbadására. A backlink-profil
gyenge: 2-es pontszám és 9 hivatkozó domain, a gyogytornaszom 36-os pontszáma és
570 domainje mellett (`docs/ADATOK-mert.md` 5. és 9. szakasz).

**Következmény.** A forgalom ma nem keresésből jön, hanem közvetlen belépésből,
közösségi felületről és ajánlásból. Ezért a **konverziós út és a belépő-oldali
meggyőzés** többet ér, mint a rangsor-taktika; a nyolc tünet-hub viszont a
teljes organikus tét, tehát azok technikai alapjai nem hibázhatnak.

## 3. Rangsorolt teendők

A sorrend a várható hatás és a ráfordítás hányadosa szerint áll. A méret S
(néhány óra), M (nap), L (több nap).

### P1: most

1. **A süti-sáv letakarja a vásárlógombot, asztali gépen is.** A fizetős kurzus
   oldalán a „Megveszem a kurzust” gomb 772 és 827 pixel között áll, a sáv egy
   900 pixel magas nézetben pont oda esik; ugyanez a kosár fizetőgombjára
   mobilon. A ragadós vásárlósáv nem old meg semmit, mert a figyelő szerint a
   gomb „látszik”. A pénz útján lévő egyetlen gomb takarásban van. **M, tervezési
   döntés kell** a sáv magasságáról vagy a vásárlódoboz felépítéséről.
   Forrás: AUDIT-C 1. találat.
2. **A nyolc tünet-hub kanonikus címére nulla belső link mutat.** A cikkek
   kanonikus címe a gyökéren él (`/keztoalagut-szindroma`), a honlap minden
   hivatkozása viszont a `/blog/<slug>` alakra megy, ami átirányít, miközben az
   oldaltérkép a kanonikus címeket hirdeti. Az egész oldalon **0** kanonikus
   hub-link. Egyetlen helyen dől el: a cikk-kártya hivatkozásában. **S.**
   Forrás: AUDIT-B 1. találat, saját ellenőrzéssel megerősítve.
3. **A cikkeken nincs szerző, lektor és ellenőrzési dátum.** A szerző-blokk
   egyetlen élő cikken sem jelenik meg, és a strukturált adatból hiányzik a
   szerző, a lektor és az utolsó ellenőrzés. Egészségügyi tartalomnál ez a
   legdrágább hiány, mind a keresőben, mind a látogató szemében. A gyökérok
   tartalmi: a szerzők felhasználója nem a megfelelő szerepkörben van. **S.**
   Forrás: AUDIT-B 2. találat.
4. **A lejátszó hibapaneljén láthatatlanok voltak a mentőgombok.** Sötét
   felületen sötét felirat és keret, mérve 1,00:1: videóhiba esetén a fizető
   vevő nem látta az „Újrapróbálom” és az „Írj nekünk” gombot. **JAVÍTVA** ebben
   a körben (lásd 4. szakasz). Forrás: AUDIT-D 1. találat.
5. **Az űrlapmezők fókuszjelölése a szabvány küszöbe alatt volt** (mérve 1,32:1
   a 3:1 helyett), tíz űrlapon, köztük a minden oldalon látszó hírlevélen.
   **JAVÍTVA** ebben a körben. Forrás: AUDIT-A 2. találat.
6. **A főmenü „olcsó dolgok itt” pontja placeholder feliratot visel**, és egy
   „Képzeletbeli akciós kurzus” című, keresőből kizárt lapra visz. A menüpont
   **tulajdonosi döntés alapján marad**; a felirat és a cél valódi kampány-
   tartalommal töltendő ki. A navigáció címkéje mondja meg, hova visz
   (NN/g Menu Design; WCAG 2.2 SC 2.4.6 és SC 3.2.3). **Tulajdonosi tartalom
   kell.** Forrás: AUDIT-C 4. találat.
7. **A regisztráció hibaüzenete félrevezet, és nincs mezőszintű hiba.** Hiányzó
   nagybetűnél azt írja, hogy „min. 12 karakter”, és összemossa a foglalt
   e-mail esetével; a mezők nem kapnak hibajelölést, pedig a belépés lapja
   ugyanezt helyesen csinálja. **S.** Forrás: AUDIT-D 2. és 3. találat.
8. **A Kapcsolat oldal helyi keresésre üres.** Nincs nyitvatartás, térkép,
   útvonalterv, nincs kanonikus cím és nincs helyi vállalkozás-séma, pedig a
   nulla organikus lábnyom mellett a térképes találat lenne az egyetlen reális
   keresési belépő. **M, tulajdonosi adat kell** (nyitvatartás, hitelesített
   cégprofil, egységes név-cím-telefon alak). Forrás: AUDIT-A 1. találat.
9. **A fiók mezőin hiányzik a kitöltési segítség** (`autocomplete`), ami mérhető
   akadálymentességi bukás; a minta ugyanazon a lapon már létezik. **S.**
   Forrás: AUDIT-D 3. találat.

### P2: a következő körben

10. **A pénztárban 2101 pixel választja el az árat a fizetőgombtól** (mobilon
    2435), és a gomb közelében nem szerepel, mit vesz a vevő; garancia sehol.
    **M.**
11. **A fizetős termékoldalon nulla bizonyíték**: egy kép, nulla videó, nulla
    vélemény, nulla gyakori kérdés, miközben az ingyenes oldalon három vélemény
    és négy kérdés van. Két fel nem használt kép áll a galéria mezőben. **M.**
12. **Az ingyenes kurzus elnyomja a fizetőset**: menüpontot csak az ingyenes kap,
    a belső linkek aránya a kezdőlapon négy az egyhez. **M, tulajdonosi döntés.**
13. **Az ajánlat a Tudástárban a lap utolsó ötödébe szorul**: az első
    kurzus-link a lap 82 százalékánál, az első gomb 93 százaléknál; a lista és a
    kategória-lapok nulla ajánlatot tartalmaznak. **M.**
14. **Nulla kép az egész Tudástárban**, megosztási kép sincs. **M, fotó kell.**
15. **Duplikált tartalom a három meggyőző lapon**: a Rólunk 29 bekezdéséből 8
    szó szerint a kezdőlapé, 7 a Szolgáltatásoké; a vélemények és a
    szakember-kártyák mindhárom lapon futnak. **M, szereposztási döntés.**
16. **A tanulás folytonossága nem működik**: a haladás nem tárol pozíciót, aki
    végignéz egy leckét és bezárja a lapot, nulla százalékon marad. **L.**
17. **A jogi lapok tájékozódás nélkül**: az ÁSZF 21 képernyő magas, 13 alcímmel,
    de tartalomjegyzék, horgony és hatályossági dátum nélkül; az impresszum
    olyan tárhelyszolgáltatót nevez meg, amelyen az alkalmazás nem fut, és
    háromféle kapcsolati adat él párhuzamosan. **M, jogi jóváhagyás kell.**
18. **Dupla gyakori kérdések két hubon**, és egy harmadikon hiányzik az orvosi
    keret, pedig épp az a cikk tanít vészjelekről. **S.**
19. **A fiók oldalra egyetlen link sem vezet** a teljes kódbázisból, és a
    számla letöltése kizárólag ezen az árva lapon érhető el. **S.**

### P3: háttér

20. A filmsáv görgetéshossza 4140 pixel, az első ár a hetedik képernyőn.
21. A H3-ak több helyen a H2-vel azonos méreten állnak.
22. Töltelék gondolatjelek a két termékoldalon és a pénztár hibaüzeneteiben.
23. A sajtólogó-sor felirata félrevezető, és most már a Rólunk lapon is megjelenik.

## 4. Ami ebben a körben már elkészült

| Tétel                                                                     | Hol                                |
| ------------------------------------------------------------------------- | ---------------------------------- |
| Az űrlapmezők a globális, 3 pixeles fókuszgyűrűt kapják (mérve 5,45:1)    | `src/app/(frontend)/styles/ui.css` |
| A lejátszó hibapaneljén a mentőgombok láthatóvá váltak (1,00:1 → 15,63:1) | `src/app/(frontend)/player.css`    |

Mindhárom tételt őr-teszt védi.

## 5. Tulajdonosi döntést igénylő tételek

1. **Nyitvatartás és cégprofil.** Enélkül sem a Kapcsolat oldal szövege, sem a
   helyi vállalkozás-séma, sem a térképes találat nem tölthető ki.
2. **Egységes név, cím és telefon.** A cégnév ma háromféle alakban él, a cím két
   lapon két írásmóddal, a kapcsolati e-mail pedig kétféle.
3. **A süti-sáv és a vásárlógomb viszonya.** Alacsonyabb sáv, vagy a
   vásárlódoboz átrendezése.
4. **Az ingyenes és a fizetős kurzus súlyozása** a menüben és a belső linkekben.
5. **A három meggyőző lap szereposztása**: melyik viszi a véleményeket, a
   szakember-kártyákat és a szolgáltatás-sínt.
6. **A Szolgáltatások oldal fő cselekvése**: időpontkérés vagy kurzus.
7. **A cikkek forrásjegyzéke.** Tíztől huszonnégy ellenőrzött hivatkozás van
   előkészítve, de jelenleg egyetlen külső hivatkozás sem jelenik meg.
8. **Jogi felülvizsgálat**: tárhelyszolgáltató, adatfeldolgozók, a megszűnt
   uniós vitarendezési platform hivatkozása, valamint a garancia és az elállás
   együttes kommunikációja.
9. **Fotóigény**: a Tudástár kártya- és megosztási képei, a termékoldal
   bizonyítékai.
10. **Az „olcsó dolgok itt” menüpont valódi felirata és célja**: milyen
    kampányra visz, és mi legyen a lap tartalma a mai demó-szöveg helyett.

## 6. Javasolt sorrend

Először a keresésnek és a bizalomnak szóló olcsó tételek: a kanonikus
hub-linkek, a szerző és lektor a cikkeken, a regisztráció hibaüzenetei és a
fiók kitöltési segítségei. Ezután a pénz útja: a süti-sáv és a vásárlógomb
viszonya, a pénztár ár-gomb távolsága, a termékoldal bizonyítékai. Végül a
tartalmi szereposztás és a helyi keresés, mert ezek tulajdonosi adatra és
döntésre várnak.
