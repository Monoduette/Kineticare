# KC V1: design-döntések és implementációs kapuk

Dátum: 2026-09-05. Szerep: Architect / UX research.
Vizsgált alap: `9df69f0b8e6db9b1a945acf95f605699748d1204`.
Státusz: kutatási és tervezési átadó; nem implementációs vagy release-jóváhagyás.
Fájltulajdon: ebben a részfeladatban kizárólag `docs/kc-v1-design-decisions.md`.

## Érvényesség és bizonyíték

- **Megfigyelt:** a megnevezett commit helyi kódja, tokenjei és dokumentumai.
  A fájl:sor hivatkozások erre az alapra érvényesek, későbbi diffnél újraellenőrzendők.
- **Kutatás:** ebben a beszélgetésben megnyitott elsődleges NN/g- és Baymard-források.
  Az ellenőrzés dátuma 2026-09-05; ez nem a kutatások publikálási dátuma.
- **Szabvány/útmutató:** W3C és GOV.UK. A WCAG sikerkritérium normatív;
  az Understanding magyarázat, a Technique egy lehetséges megoldás.
- **Tulajdonosi követelmény:** a jelenlegi feladat és a helyi
  [kéréslista](kc-v1-owner-review.md). A kéréslista forrásának Drive-tartalmát
  ez a szerepkör nem ellenőrizte közvetlenül.
- **Helyi következtetés:** a források és a Kineticare feladatából levezetett terv.
  Nem jelent univerzális pszichológiai hatást, klinikai eredményt vagy mért
  konverziónövekedést. Két kiadó hivatkozása nem feltétlenül két független kísérlet.

A korábbi design review történeti mérés, nem a mostani felület állapotigazolása.
A saját fotók korábbi szemrevételezése sem végleges asset-jóváhagyás.

## Kötelező helyi tudás

Minden implementer és validator olvassa: `AGENTS.md`, `CLAUDE.md`,
`.claude/skills/termektervezes/SKILL.md`, `docs/ertekesitesi-ux-skill.md`,
`docs/ui-sztenderdek.md`, `docs/design-review-2026-08-21.md`,
`docs/szekcio-rendszer-terv.md`, `docs/tudastar-hangnem-es-technika.md`,
`docs/vevohang-es-hirdetesszoveg.md`, az érintett komponensek és CSS-tokenek.

A designismeret bizonyítéka az átadóban: érintett komponens és token, választott
felirat és tényleges cél, képszerep és képkivágás, releváns forráspár,
normál/csökkentett mozgású viselkedés és a hozzájuk tartozó mérési eredmény.
Az elolvasott fájlok felsorolása önmagában nem validáció.

## Közös stílusbrief

- **Védett nyitás:** PR210 egykezes filmje, desktop/mobil posztere, a kéz léptéke,
  elfogadott mobilviselkedése, a 4.6 scrollhossz és 0.16 linger megmarad.
  Bizonyíték: `src/components/blocks/FilmHero.tsx:17`.
- **Állandó papírfátyol:** az 52%-os réteg nem válhat scrollfüggővé.
  Bizonyíték: `src/app/(frontend)/styles/blocks/film-hero.css:40`.
- **Arculat:** világos paper, fehér és hűvös tint felületek; KC-kék hangsúlyok;
  ink törzsszöveg. A meglévő navigáció hover/aktív KC-kék kezelése megmarad.
  Nincs idegen paletta, globális színcsere vagy footer-áttervezés.
  Alap: `src/app/(frontend)/styles/tokens.css:6`, `styles/layout.css:17`
  azonos frontend könyvtár alatt.
- **Tipográfia:** Tenor Sans címsor, Nunito Sans törzs, kizárólag a közös L/M/S
  mérettokenek. A meglévő globális skálát nem írjuk át, új viewport-alapú
  betűméretet nem vezetünk be. Az új szövegkezelés betűköze 0.
  Alap: `src/app/(frontend)/styles/tokens.css:123` és `:190`.
- **Elrendezés:** nem lebegő, teljes szélességű szekciók, következetes belső
  igazítással és természetes magassággal. Finom határvonal, kevés dekoráció;
  nincs kártya a kártyában. Új ismétlődő kártyák sugara legfeljebb 8 px.
  Arcra, kézmozdulatra vagy logóra ne kerüljön szöveg/fátyol.
- **Hang:** natív tegezés; a terapeuták többes szám első személyben beszélnek.
  Rövid, konkrét mondatok, nem személytelen intézményi hang. A fájdalommentesség
  közös cél lehet, de nem garantált eredmény. A személyenkénti titulusok nem
  általánosíthatók mindkét alapítóra.
- **Fotók:** a másik agent új, saját Drive-válogatása az átadandó bemenet.
  Régi fájlnevet vagy fotót ez a dokumentum nem rögzít végleges választásnak.
  Nincs generált alapítóportré, stock helyettesítés vagy kitalált partnerlogó.

## D1. Alapítók közvetlenül a videó alatt

**Kutatás/útmutató:** az NN/g a feladathoz kapcsolódó valódi személyfotók
információértékét mutatja; a GOV.UK megkívánja, hogy világos legyen, kit jelent
a szövegben a „mi”. A fotó önmagában nem igazolja a szakmai állításokat.
[NN/g: Photos as Web Content](https://www.nngroup.com/articles/photos-as-web-content/)
és [GOV.UK: Use the right tone](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/right-tone/).

**Tulajdonosi követelmény és helyi döntés (H01):** a videót közvetlenül a
bemutatkozó közös fotós szekció követi; nincs közéjük tett hitelcsík vagy logósáv.
Egy H2, rövid bemutatkozás és két nevesített szakember pontos titulussal.
Nem új hero és nem teljes önéletrajz. Az About blokknak nincs linkmezője;
a bemutatkozást a meglévő credentials blokk „Ismerd…” linkje követheti.
Ez nem az About belsejében garantált link, és nem igényel új About-mezőt.

**Kódhatár:** `src/components/content/HomeView.tsx:85` a CMS-layout elsőbbségét
mutatja; `src/components/blocks/About.tsx:38` meglévő képes kiindulás.
A régi, háromhasábos About megjelenés változtatás nélküli újrahasználata nem terv.
Mezőhatár: `src/blocks/about.ts:22`; a külön credentials link támogatása:
`src/components/content/home/CredentialsStrip.tsx:46` és `:88`.

**Kapu:** a ténylegesen renderelt tartalmi szekciósorban a videó utáni első
szekció az alapítóké. Mindkét arc és név látható mobilon is, nincs üres
statisztikaoszlop, nincs második hosszú bemutatkozás a kezdőlapon.

## D2. Saját, feladathoz illő képek végleges fájlnevek nélkül

**Kutatás/szabvány:** a releváns kép információt ad; az alternatív szöveg a
képpel közölt jelentést követi. A dekoratív és informatív szerep kontextusfüggő.
[NN/g: Photos as Web Content](https://www.nngroup.com/articles/photos-as-web-content/)
és [W3C: Informative Images](https://www.w3.org/WAI/tutorials/images/informative/).

**Tulajdonosi követelmény és helyi döntés (H04/H06/H07, S01/S04, A01/A03/A05/A06,
C01):** az SOS és az „Erre számíthatsz velünk” közös alapítói képet kap;
a Szolgáltatások oldal közös fotója megmarad követelménynek. A további képek
a tényleges szolgáltatás, a rólunk tartalom és a névhez rendelt szakmai háttér
megértését segítik. Kapcsolatnál kisebb, nevesített képek, nem új nagyméretű hero.
Rendelői fotó nem jelent személyre szabott ellátást az online kurzus részeként.
Beállított portrét nem nevezünk gyakorlatbemutatónak.

**Asset-átadási szerződés:** szekció/oldal, eredeti Drive-azonosító, jóváhagyott
helyi fájl, igazolt szereplőnév, felhasználási jóváhagyás, képméret, alternatív
szöveg és mobil/desktop fókuszpont. A név-hozzárendelést a forrásgazda igazolja,
nem arcfelismerésből következtetjük. Hiányzó bemenet = VÁR, nem végleges régi kép.

**Kódhatár:** `src/components/content/home/FreeSos.tsx:155` jelenleg rejtett,
dekoratív képet és mobilon 1px-es mérettippet használ. Informatív mobilfotónál
ezt együtt kell felülvizsgálni a CSS-sel. `src/blocks/usps.ts:22` alatt nincs
képmező; ez nem engedély sémabővítésre vagy migrációra.

**Kapu:** az új válogatás szekciónként jóváhagyott; a kép betölt, nem torzul,
értelmes része minden nézetben látható. Informatív kép nem tűnik el mobilon.
Minden képnek fenntartott helye van; a betöltés nem tolja el az alatta lévő CTA-t.

## D3. Rövidebb hierarchia, kötelező H10 szomszédsággal

**Kutatás/útmutató:** a leíró alcímek, az összetartozó információk csoportosítása
és a fontos tartalom előrehelyezése segíti az áttekintést. Ezek nem határoznak
meg univerzális szekciószámot vagy konverziót garantáló sorrendet.
[NN/g: Layer-Cake Scanning](https://www.nngroup.com/articles/layer-cake-pattern-scanning/)
és [GOV.UK: Clear structure](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/clear-structure/).

**Tulajdonosi pontosítás (H10, kötelező):**

`fizetős kurzusblokk → Így működik az online kurzus → SOS`

Az online működés KÖZVETLENÜL a fizetős kurzusblokk alatt áll. Közéjük sem SOS,
sem alapítói, logó-, vélemény- vagy más tartalmi szekció nem kerülhet.
Ez felülírja a korábbi kutatási válasz SOS-előtti sorrendjét és az online
működés későbbi elvárások blokkba olvasztásának javaslatát.

**Javasolt teljes kezdőlapi sorrend:** változatlan videó → alapítók rövid
szakmai hitelesítéssel → fizetős kurzusok → online működés → SOS →
„Erre számíthatsz velünk” közös fotóval → „Így tudunk segíteni” háromrészes
felosztással → rövid vélemények → tudástár → általános GYIK/kapcsolat.
A logósáv helye a fennmaradó kompozíció része, de H01/H10 közé nem ékelhető.
H08 szerint a három kézállapot ismétlődő blokkja helyett a háromrészes
segítségválasztás kap helyet. Az online működés nem ismétlődik az elvárásoknál.

**Kódhatár:** `src/lib/home-seed.ts:305`, `:325`, `:543` és
`src/components/content/HomeView.tsx:138` a régi sorrendet mutatják.
A meglévő lépéskomponens: `src/components/content/home/HowItWorks.tsx:20`.
A seed önmagában nem írja át a kitöltött CMS-layoutot.

**Kapu:** CMS-fixture és fallback renderben, az összes kért nézetben a
látható fizetős kurzusblokk következő tartalmi szekciója az online működés.
Üres terméklista nem hozhat létre üres értékesítési blokkot vagy hamis ajánlatot;
az ilyen állapot külön fixture. A szerkesztői sorrendet nem írjuk felül rejtetten:
az elfogadott kompozíció előkészítése és esetleges CMS-alkalmazása külön tétel.

## D4. Személyes magyar hang, pontos állítások

**Kutatás/útmutató:** az egyszerű, aktív, tömör nyelv a szakértő olvasóknak is
hasznos. Az angol ajánlás nem bizonyítja a magyar tegezés vagy CTA-ragozás
konverziós fölényét; ezek helyi szerkesztési szabályok.
[NN/g: Plain Language](https://www.nngroup.com/articles/plain-language-experts/)
és [GOV.UK: Clear language](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/clear-language/).

**Helyi döntés:** „mi” a két terapeuta, „te” a megszólított; egy bekezdés egy
gondolat, jellemzően 1–3 mondat. Célszint: átlagosan legfeljebb 15 szó/mondat;
ez szerkesztési cél, nem klinikai vagy WCAG-küszöb. Nincs magázás, AI-ízű
töltelék, garantált javulás, kitalált statisztika vagy páciensvélemény.
H09 fájdalommentessége célként fogalmazható meg, nem biztos kimenetként.
Online kurzust nem nevezünk automatikusan személyre szabott kezelésnek.

**Minta, szakmai/tulajdonosi lektorálásra:** „Kiss Kata és Kocsis Kata vagyunk,
gyógytornászok. Online kurzusokat készítünk, és rendelői kezeléseken is
foglalkozunk kézrehabilitációval.” Az online működés három pontja a kiválasztást,
a hozzáférést és a gyakorlást magyarázza; az „azonnali”, „korlátlan” és
időtartamra vonatkozó állítás csak igazolt termékfeltételből jöhet.

**Helyi bizonyíték:** `docs/tudastar-hangnem-es-technika.md:39` és `:136`.
Kocsis Kata és Kiss Kata titulusai eltérnek. A
`docs/vevohang-es-hirdetesszoveg.md:1` mintája nem reprezentatív magyar
piackutatás; magázó hirdetésmintái és általánosításai nem másolandók át.

**Kapu:** minden új állítás igazolható, a szöveg szakmailag lektorált; nulla
garancia vagy indokolatlan személyre-szabási ígéret. A képleírás sem tartalmaz
kitalált gyógyulást vagy nem látható tevékenységet.

## D5. Célhoz illő címkék és következetes CTA-k

**Kutatás/szabvány:** a link előre jelezze, mi történik; az ismétlődő funkciók
azonosítása legyen következetes. A WCAG 3.2.4 nem követel minden helyzetben
betűazonos szöveget, és nem tilt automatikusan minden szinonimát.
[NN/g: Better Link Labels](https://www.nngroup.com/articles/better-link-labels/)
és [W3C: Consistent Identification](https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html).

**Helyi döntés:** a normatív szótár `docs/ui-sztenderdek.md:591`, gépi párja
`src/lib/cta-vocabulary.ts`. Navigáció E/2, elkötelező saját cselekvés E/1;
a bevett menücímkék maradhatnak főnevek. „Nézd meg a kurzusokat”, „Ismerd meg
a hátterünket”, „Írj nekünk”; beküldésnél „Elküldöm az üzenetet”.
A „Bővebben” nem önálló célmegjelölés. Link navigál, gomb műveletet indít.
Új gombszöveg ne változtassa meg a védett hero feliratait ebben a részfeladatban.

**Korlát:** új ingyenes CTA nem lehet elsődleges súlyú a fizetős ajánlat mellett.
Az SOS ajánlaton az ingyenesség mindig látható. A teljes kurzus linkje nem
vihet az SOS-re (S06), a kapcsolatlink pedig nem ígérhet kész időpontfoglalást.
Az alapítóblokk nem hoz új, versengő elsődleges CTA-t.

**Kapu:** az új/érintett felirat–href párok tételes fixture-ellenőrzése;
hozzáférhető név tartalmazza a látható címkét. Katalógus, kurzusoldal,
igénylő űrlap és üzenetbeküldés nem mosódik össze. Nincs pusztán navigáló
elemre kötött állapotmódosító handler.

## D6. Részletes szakmai háttér kérésre, lényeges információ nyitva

**Kutatás/útmutató:** a ritkábban szükséges részletek második szinten is
elérhetők; a legtöbb látogatónak szükséges tartalmat nem szabad elrejteni.
[NN/g: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
és [GOV.UK: Details](https://design-system.service.gov.uk/components/details/).

**Helyi döntés:** a teljes képzés-, publikáció- és konferencialista a
szakmai háttér nyitható részeibe kerül. Név, titulus, ajánlat, ár, lényeges
hozzáférési feltétel és releváns használati korlát nem kerül accordion mögé.
A H10 online működés három rövid lépése alapból látható. A kezdőlapi GYIK az
online és személyes segítség közötti választást is tisztázza; nem csak vásárlási
kérdések halmaza.

**Kódhatár:** a meglévő natív `details/summary` minta
`src/components/blocks/TeamMembers.tsx:270`; nincs szükség új accordion-függőségre.

**Kapu:** billentyűzettel nyitható/zárható, neve és állapota érthető; csukott
tartalomban nincs elérhető rejtett fókuszcél. A név, titulus és a H10 három
lépése nulla nyitási művelettel olvasható.

## D7. Mozgó partnersáv teljes leállíthatósággal

**Kutatás/szabvány:** az automatikus carousel-váltás kutatott problémái itt
analógiák, nem kifejezetten logó-marquee kísérletek. WCAG 2.2.2 szerint az
automatikus, öt másodpercnél hosszabb, más tartalom mellett futó mozgásnak
megállíthatónak, szüneteltethetőnek vagy elrejthetőnek kell lennie.
[NN/g: Auto-forwarding](https://www.nngroup.com/articles/auto-forwarding/)
és [W3C: Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html).
A csökkentett mozgás megvalósítási mintája:
[W3C: C39](https://www.w3.org/WAI/WCAG22/Techniques/css/C39).

**Tulajdonosi követelmény és helyi döntés (A04):** a partnerlogók normál mozgási
preferenciánál mozgó sávot alkothatnak. A HTML/alap fallback statikus lista;
`prefers-reduced-motion: reduce` esetén minden eredeti logó statikus,
tördelődő elrendezésben elérhető. Nincs mozgó CTA vagy eltűnő fontos szöveg.
Legyen billentyűzettel és érintéssel elérhető pause/play vezérlő, magyar
hozzáférhető névvel és tooltippel. A hover/fókusz-szünet kiegészítés,
nem a tartós leállítás helyettesítője. A kézi szünet nem oldódik fel magától.

**Kódhatár:** `src/components/blocks/PressLogos.tsx:33` és
`src/app/(frontend)/styles/blocks/press-logos.css:36` jelenleg statikus lista;
az animáció új viselkedés. Az ismételt vizuális példányok `aria-hidden`
jelölés mellett sem tartalmazhatnak fókuszolható linket.

**Kapu:** normál módban a sáv mozog; leállítva és reduce módban 10 másodperc
alatt nulla eltolódás. Fókuszban a cél nem mozog ki a látható területről;
képernyőolvasó minden eredeti elemet egyszer kap meg, a klónokat soha.
Hiányzó H05/H14 logófájl nem helyettesíthető utánzattal. A sajtómegjelenés,
tagság és partneri kapcsolat nem jelent klinikai ajánlást; a címke pontos.

## D8. Prémium arányok, valódi mobil- és desktop-kompozíció

**Kutatás/szabvány:** a sorhossz hat az olvashatóságra, a reflow pedig
információ- és funkcióvesztés nélkül tegye használhatóvá a keskeny nézetet.
Az 50–75 karakteres törzssor célérték, nem minden mobil sorra érvényes minimum.
[Baymard: Line Length](https://baymard.com/blog/line-length-readability)
és [W3C: Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).

**Helyi döntés:** desktopon legfeljebb két olvasási hasáb az új alapítói
kompozícióban, mobilon egy. A Rólunk kép desktopon legfeljebb fél
tartalomszélesség (A01); finom hullámos szél csak dekoratív képszegély,
nem szöveg- vagy arcmaszk. Kapcsolatnál kisebb képek és rövid cím.
A szekciómagasság tartalomvezérelt; nem örökítjük automatikusan a
`--kc-board-min-h` teljesképernyős méretét minden új blokkra.

**Kódhatár:** `src/app/(frontend)/styles/tokens.css:237`, `:260`, `:286`;
az About jelenlegi háromhasábos kiosztása `styles/blocks/about.css:59`
ugyanazon frontend gyökér alatt. Globális tokenmódosítás helyett célzott
komponenshatár kell, hogy a footer és a hero ne változzon közvetetten.

**Kapu:** a magyar szöveg tényleges sorhossza mérendő, nem a CSS `ch` értéke.
Nincs szövegkicsinyítés a hosszú cím elrejtésére, levágás vagy ellipszis a
fontos tartalmon; a kép és a szöveg nem fed át, betöltésre nem változik a rács.

## Mérhető validációs mátrix

Minden sor állapota jelenleg **NEM MÉRT**. A dokumentum elkészülte nem zöld UI-kapu.

| Kapu | Kötelező eredmény | Bizonyíték |
| --- | --- | --- |
| 320×568 | Egyhasábos új tartalom; `scrollWidth <= clientWidth`; teljes CTA-felirat; mindkét alapító arca látható; informatív SOS-kép nem rejtett | Screenshot, DOM-dobozok, betöltött kép ellenőrzése |
| 390×844 | Azonos tartalmi sorrend; nincs levágott arc, jelentéshordozó kéz vagy szöveg; fókuszált új CTA teljesen látható consent-sáv mellett is | Screenshot nyitott/zárt consent-állapotban, Tab-bejárás |
| 768×1024 | Tudatos tablet-kompozíció; nincs összenyomott háromhasábos bemutatkozás; H10 három lépése alapból nyitott | Screenshot, DOM-sorrend, olvasási sorrend |
| 1440×900 | Kéthasábos alapítói sáv, üres statisztikaoszlop nélkül; Rólunk-kép legfeljebb fél tartalomszélesség; hosszabb törzssorok célja 50–75 karakter | Screenshot, aránymérés, Range-alapú karakterszámlálás |
| Töréspont | A helyi kéréslista szerinti 1024 px-es nézet és az érintett 900 px-es CSS-váltás két oldala is hibamentes | Kiegészítő screenshot és overflow-mérés |
| H01 | Videó után közvetlenül alapítói szekció | Renderelt tartalmi szekciósor, normál és reduce állapot |
| H10 | Fizetős kurzusblokk után közvetlenül online működés; SOS csak utána | CMS-fixture és fallback komponensassert, desktop/mobil screenshot |
| Kontraszt | Normál szöveg legalább 4,5:1; nagy szöveg legalább 3:1; szükséges UI-/fókuszjelzés legalább 3:1 | WCAG 1.4.3/1.4.11 szerinti számítás, tényleges kompozit háttérrel |
| Vezérlők | Új gomb/menü/önálló vezérlő legalább 44×44 CSS px; teljes, látható fókusz, helyes hozzáférhető név | Dobozmérés, billentyűzet és képernyőolvasó; 44 px helyi cél, nem az AA általános minimuma |
| Nagyítás | 200%-os szövegnagyításnál nincs veszteség; külön 1280 px/400%-os reflow-próba | Böngészős mérés; WCAG 1.4.4/1.4.10 |
| Mozgás | Normál partnersáv mozog; pause és reduce esetén 10 másodperc alatt nulla eltolódás; minden eredeti logó hozzáférhető | Időbeli pozíciómérés, Tab- és képernyőolvasós próba |
| Képek | Drive-átadó jóváhagyva, fájl betölt, megfelelő alt és kivágás; nincs CTA-eltolódás képletöltéskor | Asset-jegyzék, normál/lassú képbetöltési próba |
| Regresszió | PR210 kézlépték, állandó fátyol, mobilviselkedés és KC-nav változatlan; footer markup/stílus változatlan | Exact-base/head diff és azonos film-/scrollállapotú összehasonlító képek |
| Tartalom | Nincs ismételt online működés, klinikai garancia, hamis ingyenesség vagy félrevezető CTA; pontos titulusok | Magyar szerkesztői és szakmai review, felirat–cél jegyzék |
| Implementáció | A scope-hoz illő tesztek, typecheck, lint, build és független review az implementáció pontos headjén | Csak külön engedélyezett, izolált ellenőrzés; a dokumentum nem állít futtatott kapukat |

Méréskor a rejtett overlay dobozának metszete nem automatikusan takarás;
a láthatóság is ellenőrzendő. A kontrasztmérés külön kezeli az `rgb()` 0–255 és
a `color(srgb ...)` 0–1 tartományát. Telefonon a fizikailag rövidebb sor nem
indok a betűméret csökkentésére. Ezek a történeti audit módszertani tanulságai:
`docs/design-review-2026-08-21.md:65` és `:396`.

## Implementációs sorrend és határok

1. Vedd át az új Drive-válogatást és a logófájlokat; hiányukat tételesen jelöld.
2. Először fixture-ben bizonyítsd a H01/H10 sorrendet, az üres adatállapotot
   és a CMS/fallback út különbségét. A piaci állítások nem termékadatok.
3. Meglévő komponensekkel, szűk prezentációs változtatással építs; új
   CMS-mező, dependency vagy migráció nem következik ebből a briefből.
   Ha nélkülük nem oldható meg a kért szerkeszthetőség, jelezd a konkrét határt.
4. A magyar szöveget és a képek kontextusát lektoráltasd, majd ellenőrizd a
   nézeteket, fókuszt, linkcélokat és a mozgásvezérlést izolált környezetben.
5. A független validator a tényleges diffet és bizonyítékot ellenőrzi;
   az implementer saját jóváhagyása nem zárhatja a kaput.

Tilos: `.env*` olvasás, élő app-/szolgáltatáshívás, production írás,
függőség-, access-, migráció- vagy fizetésmódosítás, footer-edit és más agent
változásainak felülírása. A dokumentum nem ad új végrehajtási felhatalmazást.
A CMS-előnézet, a tartalomalkalmazás és a kiadás külön engedély és bizonyíték
kérdése; seed/fallback siker nem bizonyít éles változást.

## Nyitott bemenetek és tanulság

- **VÁR:** új Drive-fotóválogatás, nevesített asset-átadó és jóváhagyott kivágások.
- **VÁR:** H05 új logói és H14 kapcsolati logója; nincs helyettesítő utánzat.
- **VÁR:** végleges magyar szöveg és szakmai jóváhagyás az érintett állításokra.
- **NEM MÉRT:** új UI, exact-head tesztek és független implementációs review.
- **Külön scope:** P02 kedvezmény/kupon működése nem design-briefből levezetett
  engedély ár-, fizetés- vagy hozzáférési logika módosítására.

Tanulság: a tulajdonosi sorrend nem puszta tartalomjegyzék. A H10 közvetlen
szomszédságát renderelt sorrendasserttel kell védeni, nem csak seed-szöveggel.
A fotó szerepe és a végleges fájl kiválasztása külön döntés; a régi kép nem
válhat véglegessé azért, mert korábban már szerepelt egy kutatási válaszban.
