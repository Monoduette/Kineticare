# LEKTORÁLANDÓ VÁZLAT. A két gyógytornász szakmai jóváhagyása előtt nem publikálható.

> Ez a fájl a Tudástár 5. cikkének szövegváltozata (`docs/tudastar-tartalmi-terv.md`
> 4. szakasz és 6. szakasz, C5). A rekord `status` és `_status` mezője egyaránt
> `draft` marad, amíg Kiss Kata és Kocsis Kata a klinikai tartalmat jóvá nem hagyja.
> A cikk törzse a „Csukló- és kézfájdalom: mi okozhatja, és mit tehetsz?” H1-től a
> „Fontos tudnivaló” szakaszig tart. A törzs első eleme 2026-08-25 óta a
> sürgősségi doboz (idézetblokk), közvetlenül a H1 alatt, a lead ELŐTT — a
> `seo-plan.json` `hub_sablon.sorrend` 3. eleme és a H-CS hub
> `surgossegi_doboz_elol: true` mezője szerint. A H1 fölötti rész és az utolsó
> két szakasz (önteszt, jelzések a vezetőnek) a lektorálónak és az integrátornak
> szól, nem kerül be a `content` mezőbe.

## Felhasznált források (azonosítóval, a `docs/orvosi-forrasbazis.md` szerint)

| Azonosító | Forrás | Hol használtuk |
|---|---|---|
| CSF1 (= VZ2, = DQ5, = F1) | NHS. *Wrist pain* (Hand pain sorozat). https://www.nhs.uk/symptoms/hand-pain/wrist-pain/ · felülvizsgálva 2025-11-05 · következő felülvizsgálat 2028-11-05 · hozzáférés 2026-08-25 (a régi `/conditions/hand-pain/wrist-pain/` cím 301-gyel ide irányít) | a leggyakoribb ok a csukló megütése vagy sérülése, az öt tünet-ok párosítás (törés, rándulás, De Quervain vagy artrózis, kéztőalagút, ganglion), „ne diagnosztizáld magad”, a törésgyanú kezelésének tilalma, a teljes otthoni tanácslista, a „mit ne” lista, a gyógyszerész szerepe, a háziorvosi és a sürgős lista minden tétele · **2026-08-25-i bővítés:** a sürgősségi doboz aznapi listája, a kézfej-szakasz orvoshoz fordulási küszöbe, a krém- és tapasz-szakasz három orvosi kikötése, a rögzítő-szakasz gyógyszerész-mondata és a sín levételét előíró mondat |
| CSF2 | NHS. *Hand pain* (áttekintő oldal). https://www.nhs.uk/conditions/hand-pain/ · hozzáférés 2026-08-21 | a kézfájdalom területek szerinti bontása: csukló, ujj, hüvelykujj, tenyér, kézhát |
| CSF3 (= CTS2) | American Academy of Orthopaedic Surgeons. *Management of Carpal Tunnel Syndrome. Evidence-Based Clinical Practice Guideline.* 2024-05-18. https://www.aaos.org/globalassets/quality-and-practice-resources/carpal-tunnel/carpal-tunnel-2024/cts-cpg.pdf | a billentyűzethasználatról szóló konszenzus, a bizonyíték minősége (Very Low), az ajánlás erőssége (Consensus), és az indoklás (nem volt magas vagy közepes minőségű vizsgálat, egy alacsony minőségű talált összefüggést) |
| CST1 (= VZ3, = F4) | NHS. *Broken arm or wrist.* https://www.nhs.uk/conditions/broken-arm-or-wrist/ · felülvizsgálva 2023-05-26 · a jelzett következő felülvizsgálat (2026-05-26) lejárt · hozzáférés 2026-08-21 | a törés tünetei, a röntgen szükségessége, a sürgős és az azonnali lista, a 6–8 hetes felépülés, a gipsz levétele utáni merevség és gyengeség, a gyógytornász szerepe |
| CTS1 (= F5) | NHS. *Carpal tunnel syndrome.* https://www.nhs.uk/conditions/carpal-tunnel-syndrome/ · felülvizsgálva 2024-04-17 · következő felülvizsgálat 2027-04-17 · hozzáférés 2026-08-21 | a terhesség mint kockázati tényező, és hogy a terhesség miatt kialakult panasz néha néhány hónap alatt magától rendeződik |
| DQ1 (= F9) | AAOS OrthoInfo. *De Quervain's Tenosynovitis.* Szerzők: Sophia Kocher, MS; Erica Taylor, MD, MBA, FAAOS. Lektor: Julie E. Adams, MD, FAAOS. https://www.orthoinfo.org/diseases--conditions/de-quervains-tendinosis/ · hozzáférés 2026-08-21 | a hüvelykujj felőli csuklófájdalom, az alkarba húzódó fájdalom, a terhességgel és a szülés utáni időszakkal való összefüggés, a szülés utáni 4–6 hét, a gyermek felemelése mint fájdalmas mozdulat |
| TK1 (= F6) | NHS. *Tennis elbow.* https://www.nhs.uk/conditions/tennis-elbow/ · felülvizsgálva 2024-05-31 · következő felülvizsgálat 2027-05-31 · hozzáférés 2026-08-21 | az alkarfájdalom mint a teniszkönyök tünete, és a markolás meg a csukló, alkar ismétlődő csavarása mint kiváltó mozdulat |
| VZ1 (= ZS2) | NHS. *Stroke*, Symptoms aloldal. https://www.nhs.uk/conditions/stroke/symptoms/ · felülvizsgálva 2024-09-12 · következő felülvizsgálat 2027-09-12 · hozzáférés 2026-08-21 | a féloldali arclelógás, a karerőtlenség vagy karzsibbadás és az akadozó beszéd, valamint a 24 órán belüli tünetekre vonatkozó szabály |
| VZ5 (= F24) | Hyatt BT, Bagg MR. *Flexor Tenosynovitis.* Orthop Clin North Am. 2017;48(2):217–227. PMID 28336044. | a Kanavel-féle négy jel mint a vizsgálat vezérfonala, a cukorbetegség és az érszűkület rosszabb kimenetele, a merevség és az amputáció |
| VZ6 (= F25) | Langer MF és mtsai. *[Pyogenic Flexor Tenosynovitis].* Handchir Mikrochir Plast Chir. 2021;53(3):267–275. PMID 34134159. | a kéz egyik legsúlyosabb fertőzése, a négy jel meglétekor azonnali műtéti indikáció, a gyors felismerés és a gyors cselekvés |

**A 2026-08-25-i bővítés forrásai.** Az alábbi sorok az arány-tisztító orvosi
kutatás (`build/kutatas/csuklo-es-kezfajdalom.md`) forrásjelöléseit használják.
Minden webes forrás **hozzáférés: 2026-08-25**. Aliasok a fenti sorokhoz: F1 =
CSF1, F4 = CST1, F5 = CTS1, F6 = TK1, F9 = DQ1, F24 = VZ5, F25 = VZ6, VZ1 = a
stroke-forrás.

| Azonosító | Forrás | Hol használtuk |
|---|---|---|
| F2 | NHS. *Pain in the back of the hand.* https://www.nhs.uk/symptoms/hand-pain/pain-in-the-back-of-the-hand/ · hozzáférés 2026-08-25 | a „Kézfej fájdalom: mit jelezhet?” szakasz tünet-ok párosításai: ín- és ízületi gyulladás, törés, ganglion, kéztőalagút-szindróma, és az orvoshoz fordulás küszöbe |
| F3 | NHS. *Thumb pain.* https://www.nhs.uk/symptoms/hand-pain/thumb-pain/ · hozzáférés 2026-08-25 | háttérforrás a hüvelykujj-szakasz területi elkülönítéséhez (a szövegben önálló állítás nem épül rá) |
| F7 | NHS. *Gout.* https://www.nhs.uk/conditions/gout/ · hozzáférés 2026-08-25 | a köszvényes roham képe: órák alatt kialakuló, forró, vörös, duzzadt ízület; tipikusan a nagylábujj, de a kéz, a csukló és a könyök is; az ízületi fertőzés mint azonos képet adó állapot |
| F8 | NHS. *Heart attack.* https://www.nhs.uk/conditions/heart-attack/ · hozzáférés 2026-08-25 | az infarktus mellkasi fájdalmának kisugárzása a karba, a nyakba és az állkapocsba (a „Bal vagy jobb csuklód fáj?” szakasz és a sürgősségi doboz szív-mondata) |
| F10 | AAOS OrthoInfo. *Arthritis of the Thumb.* https://www.orthoinfo.org/diseases--conditions/arthritis-of-the-thumb · hozzáférés 2026-08-25 | a hüvelykujj tövének nyeregízületi kopása: a fogásra, csippentésre és csavarásra jelentkező fájdalom, a kísérő jelek, a nemi és életkori megoszlás, a nyeregízületi őrlőteszt |
| F11 | AAOS OrthoInfo. *Compartment Syndrome.* https://www.orthoinfo.org/en/diseases--conditions/compartment-syndrome · hozzáférés 2026-08-25 | az izomrekesz-szindróma sérülés és szoros gipsz után, az aránytalanul erős, nyújtásra rosszabbodó fájdalom, a késői zsibbadás és bénulás, a nem műtéti kezelés hiánya (az alkar-szakasz és a sürgősségi doboz záró mondata) |
| F12 | Cleveland Clinic. *Arm Pain.* https://my.clevelandclinic.org/health/symptoms/arm-pain · hozzáférés 2026-08-25 | a bal kar fájdalma mint a szívinfarktus lehetséges kísérője, a tünetegyüttes felsorolása |
| F13 | Cleveland Clinic. *Wrist Tendonitis.* https://my.clevelandclinic.org/health/diseases/22196-wrist-tendonitis · hozzáférés 2026-08-25 | a csuklóízület inai az alkar izmait kötik össze a kézközépcsontokkal |
| F14 | Cleveland Clinic. *Heberden's Nodes.* https://my.clevelandclinic.org/health/symptoms/21829-heberdens-nodes · hozzáférés 2026-08-25 | a Heberden- és a Bouchard-csomó leírása, az ízületi kopás csontos válasza, és a kézízületi artrózis népességi gyakorisága 85 éves korra |
| F15 | NICE. *Osteoarthritis in over 16s: diagnosis and management* (NG226), vizuális összefoglaló. https://www.nice.org.uk/guidance/ng226/resources/visual-summary-on-the-management-of-osteoarthritis-pdf-11251842157 · hozzáférés 2026-08-25 | a helyileg felkent gyulladáscsökkentő helye az ízületi kopás kezelésében, a szájon át szedett szer és a gyomorvédelem, a paracetamol rutinszerű használatának kerülése, valamint a sín és a támaszok rutinszerű felajánlásának kerülése |
| F16 | Derry S és mtsai. *Topical NSAIDs for acute musculoskeletal pain in adults.* Cochrane Database Syst Rev. 2015;2015(6):CD007402. DOI 10.1002/14651858.CD007402.pub3 · PMID 26068955. https://pubmed.ncbi.nlm.nih.gov/26068955/ | a friss, sérülés utáni panasz helyi gyulladáscsökkentő kezelése: a 61 vizsgálat, a szájon át szedettel összemérhető hatás, a diklofenak, ibuprofén és ketoprofén gél, az enyhe és átmeneti bőrreakciók |
| F17 | Derry S és mtsai. *Topical NSAIDs for chronic musculoskeletal pain in adults.* Cochrane Database Syst Rev. 2016;4(4):CD007400. DOI 10.1002/14651858.CD007400.pub3 · PMID 27103611. https://pubmed.ncbi.nlm.nih.gov/27103611/ | a tartós panasz: a 39 vizsgálat és az, hogy mind ízületi kopásról szólt, a közepes bizonyíték-minőség, és a vivőanyagtól megélt javulás a 6–12 hetes vizsgálatokban |
| F18 | Karjalainen TV és mtsai. *Splinting for carpal tunnel syndrome.* Cochrane Database Syst Rev. 2023;(2):CD010003. DOI 10.1002/14651858.CD010003.pub2. https://www.cochrane.org/evidence/CD010003_splinting-carpal-tunnel-syndrome | az éjszakai sín a kéztőalagút-szindrómánál, a rövid távú és a hat hónapos viselet, az összehasonlítás szteroidinjekcióval, tornával és ragasztással, az alacsony vagy nagyon alacsony bizonyosság, és az olcsó beavatkozás érve |
| F19 | Buhler M és mtsai. *Effectiveness of splinting for pain and function in people with thumb carpometacarpal osteoarthritis.* Osteoarthritis Cartilage. 2019;27(4):547–559. DOI 10.1016/j.joca.2018.09.012 · PMID 30317000. https://pubmed.ncbi.nlm.nih.gov/30317000/ | a hüvelykujj-nyeregízületi kopás sínje: a középtávú (3–12 hónap) hatás, a rövid távú hatás hiánya, a síntípusok közti különbség hiánya, az alacsony bizonyíték-minőség |
| F20 | Ramírez-Vélez R és mtsai. *Effects of kinesio taping alone versus sham taping in individuals with musculoskeletal conditions.* Physiotherapy. 2019;105(4):412–420. DOI 10.1016/j.physio.2019.04.001 · PMID 31076093. https://pubmed.ncbi.nlm.nih.gov/31076093/ | a kineziológiai tapasz látszatragasztáshoz mérve: alacsony minőségű, nem meggyőző bizonyíték, és hogy a vizsgált területek a derék és a térd voltak |
| F21 | Tomás-Escolar A és mtsai. *Short-term effectiveness of kinesio taping … in carpal tunnel syndrome.* Physiother Res Int. 2023;e2026. DOI 10.1002/pri.2026 · PMID 37269121. https://pubmed.ncbi.nlm.nih.gov/37269121/ | a tapasz rövid távú, gyenge hatása a fájdalomra és a működésre kéztőalagút-szindrómánál, közepes bizonyossági szint mellett (13 vizsgálat) |
| F22 | Li Z és mtsai. *Kinesio taping can relieve symptoms and enhance functions in patients with mild-to-moderate carpal tunnel syndrome.* Physiother Theory Pract. 2025;41(9):1936–1951. DOI 10.1080/09593985.2025.2463902 · PMID 39967023. https://pubmed.ncbi.nlm.nih.gov/39967023/ | a tapasz hosszabb távú hatása és a sínnel együtt adott többlet (14 vizsgálat), valamint a kiegészítő eszköz szerep |
| F23 | Lutsky K és mtsai. *Hand Dominance and Common Hand Conditions.* Orthopedics. 2016;39(3):e444–e448. DOI 10.3928/01477447-20160315-02 · PMID 27018604. https://pubmed.ncbi.nlm.nih.gov/27018604/ | a „Bal vagy jobb csuklód fáj?” szakasz egésze: a domináns és a nem domináns kéz nagyjából egyforma érintettsége a gyakori kézpanaszoknál, a teniszkönyök mint kivétel, és a kicsi különbség a mindennapi akadályozottságban |

**Ellenőrzés a forrásokon (2026-08-21, ezen cikk írásakor).** Mind a tíz forrást
visszaolvastuk az eredetiből, nem a forrásbázis összefoglalójából: a hat NHS-oldalt
és az AAOS OrthoInfo De Quervain-oldalát letöltve és teljes szövegre bontva, az
AAOS 2024-es kéztőalagút-irányelvét a hivatalos PDF-ből (a keresett szakasz:
„RISK FACTORS: KEYBOARDING, CLERICAL WORK”), a VZ5 és VZ6 közleményt a PubMed
E-utilities API absztraktjából. Minden idézett tétel szó szerint egyezik.

**Karbantartási jelzés a lektorálóknak.** Kettőt érdemes tudni a forrásokról.
A DQ1 forrásbázisbeli címe (`https://orthoinfo.aaos.org/en/…`) 2026-08-21-én
átirányít a `https://www.orthoinfo.org/diseases--conditions/de-quervains-tendinosis/`
címre; a cikk forrásjegyzékébe a működő, átirányítás utáni cím került. A CST1
(NHS, Broken arm or wrist) jelzett felülvizsgálati határideje 2026-05-26-án
lejárt, ezt a forrásjegyzékben ki is írjuk. A `docs/orvosi-forrasbazis.md`
javítása nem ennek a cikknek a fájl-tulajdona.

**Nem használt, tiltott tartalom.** A `csuklófájdalom lelki okai` és a
`kéz fájdalom lelki okai` kifejezésre van mért kereslet
(`docs/monid-adatok-teljes.md` 3.6 és 3.9), de a témára nincs forrásunk, ezért
egyetlen mondat sem szól róla. Öndiagnózis-fa nincs a szövegben. Gyógyszernév
csak annyiban szerepel, amennyiben forrásolt tanács része (paracetamol és
ibuprofén gél az NHS-tanácsból; a 2026-08-25-i bővítéssel a hatóanyag-szintű
diklofenak és ketoprofén a két Cochrane-áttekintésből, F16 és F17); adagolási
tanács sehol, konkrét készítménynevet sehol nem nevezünk meg. A magyar
beutalórendet nem részletezzük, mert arra nincs forrásunk. YouTube-link nincs a
szövegben.

**A forrásnevek a törzsből kimaradnak.** A `src/lib/tudastar/markdown-to-lexical.ts`
`FORRAS_JELOLESEK` őre (tulajdonosi döntés, 2026-08-21) hangosan bukik, ha a
publikálandó törzsben ott van az „NHS”, „AAOS”, „OrthoInfo”, „Cochrane”, „PMID”,
„StatPearls” vagy „Forrásjegyzék” szó. Ezért a 2026-08-25-i bővítésnél az orvosi
kutatás mondataiból a forrásmegjelölés kikerült (pl. „Az NHS leírása szerint a
panasz egyik tünete…” → „A panasz egyik tünete…”), az ÁLLÍTÁS viszont szó
szerint megmaradt, és a forrás-azonosító az alábbi „Állítás és forrás” táblában
van rögzítve. Ugyanezért nem szerepel a törzsben a „Cleveland Clinic” és a
„NICE” név sem: helyettük „az ízületi kopásról szóló szakmai irányelv” áll,
mert a hatókör-megkötést (ízületi kopás) az orvosi kutatás kifejezetten kérte
megőrizni.

## Cikk-metaadatok (az integrátornak)

| Mező | Érték |
|---|---|
| `title` | Csukló- és kézfájdalom: mi okozhatja, és mit tehetsz? |
| `slug` | `csuklo-es-kezfajdalom` |
| `seoTitle` | Csukló fájdalom és kézfájdalom: okok, teendők otthon |
| `seoDescription` | Csukló fájdalom és kézfájdalom: mi állhat mögötte, mit tehetsz otthon az első napokban, és mikor kell orvoshoz fordulni. (120 karakter) |
| `excerpt` | Csukló fájdalom és kézfájdalom: sokféle ok állhat mögötte, a rándulástól a kéztőalagút-szindrómáig. Összeszedtük, mit sorol fel lehetséges okként az NHS, mit tehetsz otthon az első napokban, és mikor kell orvoshoz fordulni. Azt is leírjuk, mikor NE végezz gyakorlatokat. |
| Kategória | Kéz és csukló (`kez-es-csuklo`) |
| `publishedAt` | `2026-09-05T08:00:00.000Z` |
| Szerző | Kiss Kata |
| `relatedPosts` | `keztoalagut-szindroma` (C2), `pattano-ujj` (C4), `csuklotores-utani-gyogytorna` (C6) |
| `status` / `_status` | `draft` / `draft` |
| `heroImage`, `ogImage` | üresen marad |

**Belső linkek a törzsben:** `/blog/csuklotores-utani-gyogytorna`,
`/blog/keztoalagut-szindroma`, `/blog/pattano-ujj`,
`/blog/miert-zsibbad-a-kezem`, `/blog/teniszkonyok`,
`/kurzusok/sos-kezrelax-villamkurzus`, `/kurzusok/otthoni-kezrehab-program`.
Egyik link sem áll magában bekezdésben, és egyik sem YouTube-cím.

**A `/blog/de-quervain-szindroma` link KIKERÜLT a törzsből** (tényellenőrzés,
J12): a C9 cikk `publishedAt` értéke 2026-09-09, ez a cikk 09-05-én jelenik meg,
tehát a törzsbe ágyazott link négy napig 404-re mutatna. A `relatedPosts` mező
érintetlen, mert a CMS a nem létező rekordot kihagyja. Ha a C9 az első hullámmal
jelenik meg, a link visszatehető (vezetői döntés).

**Nyitott forrás-kérdés a lektorálóknak (a 4. cikkel azonos, tényellenőrzés J9).**
A gennyes ínhüvelygyulladás négy jelének felsorolását (duzzadt ujj, félig
behajlított tartás, nyújtásra erős fájdalom, nyomásérzékenység az ínhüvely
mentén) a `docs/orvosi-forrasbazis.md` 1.2 táblázata adja, VZ5 és VZ6 alapján. A
két közlemény ABSZTRAKTJA viszont csak „Kanavel's four cardinal signs” néven
hivatkozik rájuk, a tételes felsorolás a teljes szövegben van, ami egyik
közleménynél sem szabadon hozzáférhető (2026-08-21-én ellenőrizve: a PubMed
egyiknél sem ad PMC teljes szöveget). A felsorolást BENNE HAGYTUK, mert kivétele
csökkentené az olvasó biztonságát. **A forrásbázis gazdájának tételesen
felsoroló forrást kell beemelnie az 1.2 táblázatba**, például a StatPearls
„Pyogenic Flexor Tenosynovitis” fejezetét (NCBI Bookshelf, NBK576414), és utána
mindkét cikk arra hivatkozzon.

---

# Csukló- és kézfájdalom: mi okozhatja, és mit tehetsz?

Ez a szöveg lektorálandó vázlat. A két gyógytornász szakmai jóváhagyása előtt nem publikálható.

> **Mielőtt tovább olvasnál.** Van néhány jel, aminél nem otthoni kezelés kell, hanem azonnali segítség.
> **Hívj mentőt, Magyarországon a 112-t,** ha sérülés után a karod vagy a csuklód zsibbad vagy bizsereg, ha a csont kiáll a bőrből, ha a karod vagy a csuklód alakja megváltozott, vagy ha erősen vérző seb van a területen. Ugyanígy azonnal, ha az arcod egyik fele lelóg, az egyik karod erőtlen vagy zsibbadt, és akadozik a beszéded. Ha ezek a tünetek már el is múltak, de 24 órán belül megvoltak, akkor is azonnali segítség kell.
> **Szintén azonnal, és nem a kézről szól:** ha a karod fájdalma mellkasi szorítással vagy nyomással, légszomjjal, hányingerrel vagy hideg verejtékezéssel jár együtt.
> **Aznap kérj orvosi ellátást,** ha a fájdalom nagyon erős, ha rosszul vagy tőle, ha lázas és hidegrázós vagy, ha nem tudod mozgatni a csuklód vagy megfogni semmit, ha a csuklód alakja vagy színe megváltozott, vagy ha a kezeden egy részen megszűnt az érzés. Ugyanígy, ha az ujjad duzzadt, félig behajlítva áll, nyújtásra nagyon fáj, és az ínhüvely mentén nyomásérzékeny.
> Gipsz vagy szoros kötés után az aránytalanul erős, nyújtásra rosszabbodó fájdalom is azonnali ellátást igényel.

Fáj a csuklód, amikor kinyitod az üveget. Este már a bögrét is óvatosan fogod meg.

Ha ez ismerős, jó eséllyel te is beírtad már a keresőbe, hogy csukló fájdalom vagy kéz fájdalom. Ebben a cikkben a csuklófájdalomról, a kézfájdalomról és az alkarfájdalomról is szó lesz.

Kiss Kata és Kocsis Kata vagyunk, gyógytornászok, és évek óta elsősorban a kéz rehabilitációjával foglalkozunk. Most azt szedtük össze, mi állhat a panasz mögött, és mit tehetsz otthon.

Egy dolgot előre tisztázunk. Ez a cikk nem mondja meg, mi bajod van. Azt írjuk le, mit tudni ma erről a panaszról.

## Mi okozhat csukló- és kézfájdalmat?

A csuklófájdalomnak sokféle oka lehet, és a leggyakoribb a csukló megütése vagy sérülése.

A lehetséges okokat tünetek szerint érdemes végigvenni. Ez a lista tájékozódásra való, nem öndiagnózisra.

- Hirtelen, éles csuklófájdalom, duzzanat, és a sérüléskor hallott pattanó vagy roppanó hang: törött csukló lehet.
- Fájdalom, duzzanat és véraláfutás, nehéz mozgatni a csuklót vagy megfogni bármit: rándult csukló lehet.
- Tartós fájdalom, duzzanat és merevség a hüvelykujj tövénél, a csukló közelében, néha csomóval: ínhüvelygyulladás, vagyis De Quervain-szindróma vagy artrózis lehet.
- Éjjel erősödő sajgás, bizsergés vagy zsibbadás az ujjakban, a kézben és a karban, gyenge hüvelykujj: kéztőalagút-szindróma lehet.
- Sima tapintású, néha fájdalmas csomó a csukló tetején: ganglion lehet.

A hüvelykujj tövénél jelentkező panasz a De Quervain-szindróma felé mutat, arról külön cikk készül. Ha a fájdalom mellett éjszakai zsibbadás is van, akkor [a kéztőalagút-szindrómáról szóló cikkünk](/blog/keztoalagut-szindroma) áll közelebb hozzád.

Ha a csuklód eltört, és már túl vagy a gipszen, akkor [a csuklótörés utáni időszakról szóló cikkünket](/blog/csuklotores-utani-gyogytorna) olvasd tovább.

A kézfájdalmat terület szerint érdemes bontani: csukló, ujj, hüvelykujj, tenyér és kézhát. Vagyis az első kérdés mindig az, hol fáj pontosan.

Ha az ujjad hajlításkor beakad, majd pattanással ugrik ki, arról [a pattanó ujjról szóló cikkünkben](/blog/pattano-ujj) olvashatsz. Ha a panasz inkább zsibbadás, akkor [a kézzsibbadásról szóló cikkünk](/blog/miert-zsibbad-a-kezem) a következő lépés.

Egy kérés külön is hangsúlyos: ne próbáld magad megállapítani a fájdalom okát.

Ez nem óvatoskodás: a fájdalom és a duzzanat több lehetséges oknál is szerepel.

## Kézfej fájdalom: mit jelezhet?

A kézfej fájdalma mögött leggyakrabban ín- vagy ízületi gyulladás, törés, ganglion vagy a kéztőalagút-szindróma áll, és nem a fájdalom erőssége, hanem a kísérő tünetek mondják meg, melyik irányba érdemes elindulni.

Ha a fájdalom mellett **duzzanat és merevség** is van, és mindez hosszú ideje tart, akkor ín- vagy ízületi gyulladás felé mutat. Ilyenkor gyakran nehéz az ujjakat mozgatni. Ha viszont a panasz **hirtelen, éles fájdalommal** kezdődött, duzzadt a terület, és a sérülés pillanatában pattanó vagy roppanó hangot hallottál, az törésre utalhat.

A **ganglion** másképp viselkedik: sima tapintású csomó egy ízület vagy egy ín közelében, ami lehet fájdalmas, de lehet teljesen panaszmentes is. A **kéztőalagút-szindrómára** az éjjel erősödő sajgás, a zsibbadás vagy a bizsergés és a gyenge hüvelykujj jellemző. Ez utóbbiról [külön cikkünk szól](/blog/keztoalagut-szindroma), ott részletesebben olvashatsz róla.

Van egy negyedik minta is, amit sokan „bütyöknek” hívnak. Az ujjak végízületén megjelenő borsónyi csontos megvastagodás a Heberden-csomó, a középső ujjperc ízületén ülő hasonló képlet pedig a Bouchard-csomó. Mindkettő az ízületi kopás következménye: ahogy a porc elvékonyodik, a szervezet új csontot épít az ízület szélén. Fájdalommal, duzzanattal és a mozgás beszűkülésével járhat.

A kézízületi kopás nem ritka az idősebb korosztályban. 85 éves korára a nők körülbelül fele és a férfiak nagyjából negyede érintett kézízületi artrózisban. Ez leíró népességi adat, nem rólad szól, és nem is jóslat.

Egy külön eset, amit érdemes ismerni: ha egy kézízület **órák alatt** válik nagyon fájdalmassá, és a bőr fölötte forró, duzzadt és vörös, az köszvényes roham is lehet. A köszvény tipikusan a nagylábujjat érinti, de a kezet, a csuklót és a könyököt is érintheti. Ilyenkor nem otthoni kezelés kell, hanem orvos, mert ugyanez a kép ízületi fertőzést is jelenthet.

Ez a felsorolás tájékozódásra való: a fájdalom és a duzzanat szinte minden fenti okhoz hozzátartozik. Orvoshoz akkor fordulj, ha a kézfej fájdalma akadályoz a szokásos tevékenységeidben, ha két hét otthoni kezelés után sem javult, vagy ha bizsergés, illetve érzéskiesés is társul hozzá.

## Hüvelykujj fájdalom: mikor ínhüvely, mikor ízület?

A hüvelykujj panasza két különböző helyről szokott indulni, és a kettőt a fájdalom pontos helye választja el: az ínhüvely a **csukló hüvelykujj felőli oldalán** fáj, az ízületi kopás pedig lejjebb, **a hüvelykujj tövében**.

Az ínhüvely felőli panasz a De Quervain-szindróma. A fő tünet a fájdalom a csukló hüvelykujj felőli oldalán, és a fájdalom onnan felfelé, az alkar felé húzódhat. A pontos ok nem teljesen tisztázott, de a csukló és a hüvelykujj ismétlődő mozgatása rontja. Kockázati tényező a 40-es és 50-es életkor, a női nem, a rheumatoid arthritis, valamint a terhesség és a szülés utáni időszak.

Az ízületi kopás a hüvelykujj tövében lévő nyeregízületet érinti. Itt a fájdalom jellemzően **fogáskor, csippentéskor és csavaró mozdulatnál** jelentkezik, például üvegnyitásnál vagy kulcsfordításnál. Társulhat hozzá gyengeség fogáskor, duzzanat és nyomásérzékenység a hüvelykujj tövénél, beszűkült mozgás, és néha egy csontos kiemelkedés az ízület fölött. A nők 2-3-szor gyakrabban érintettek, és a panasz jellemzően 50 év fölött jelentkezik.

A kettő elkülönítésére az orvosnak két egyszerű vizsgálata van. Az ínhüvelynél a Finkelstein- vagy Eichhoff-teszt: a hüvelykujjadat a tenyeredbe fogod, a többi ujjaddal ráfogsz, és a csuklódat a kisujj felé hajlítod. Az ízületnél a nyeregízületi őrlőteszt: az orvos nyomja és közben forgatja a hüvelykujjadat, és a fájdalom mellett őrlő érzés is jelentkezhet. Ezeket a vizsgálatot végző szakember végzi el, nem otthon kell megcsinálni.

Inkább ínhüvelyre, vagyis De Quervain-szindrómára utal:

- Hol fáj: a csukló hüvelykujj felőli oldalán.
- Merre húzódik: felfelé, az alkar felé.
- Mikor fáj: csukló- és hüvelykujj-mozgatásra.
- Tipikus élethelyzet: terhesség, szülés utáni időszak.
- Látható jel: duzzanat a csukló szélén.

Inkább ízületi kopásra utal:

- Hol fáj: a hüvelykujj tövében.
- Merre húzódik: jellemzően helyben marad.
- Mikor fáj: fogásra, csippentésre, csavarásra.
- Tipikus élethelyzet: 50 év fölött, nőknél gyakrabban.
- Látható jel: csontos kiemelkedés a hüvelykujj tövében.

A jó hír, hogy az első lépések nagyrészt közösek. Mindkét esetnél szóba jön a hüvelykujjat és a csuklót megtámasztó sín, a helyileg felkent gyulladáscsökkentő, és a fájdalmat kiváltó mozdulat csökkentése. Erről bővebben a krémről, a tapaszról és a csuklórögzítőről szóló szakaszban írunk. Azt viszont, hogy melyikről van szó nálad, vizsgálat dönti el.

## Bal vagy jobb csuklód fáj?

Önmagában az oldal nem árulja el, mi okozza a panaszt: a gyakori kézpanaszok nagyjából ugyanolyan gyakran érintik a domináns és a nem domináns kezet, egyetlen kivétellel.

Ezt egy több mint ezer beteg adatait feldolgozó vizsgálat nézte meg. A kéztőalagút-szindróma, a De Quervain-szindróma, a kézízületi kopás és a pattanó ujj esetében a domináns és a nem domináns kéz körülbelül egyforma arányban volt érintett. A kivétel a teniszkönyök: az számottevően gyakrabban jelentkezett a domináns oldalon. A vizsgálat azt is találta, hogy a domináns kéz érintettsége valamivel nagyobb mindennapi akadályozottsággal jár, de a különbség mértéke kicsi volt.

Vagyis a kérdés, hogy „a bal vagy a jobb kezemről van szó”, önmagában nem visz közelebb a válaszhoz. Ami előrevisz: hol pontosan fáj, mikor kezdődött, mi váltja ki, és milyen tünet társul hozzá. Ezt a cikk többi szakasza járja körbe.

**Egy kivétel van, és az nem a kézről szól.** Ha a bal karod fájdalma mellkasi szorítással, nyomással, légszomjjal, hányingerrel vagy hideg verejtékezéssel együtt jelentkezik, az szívinfarktus jele lehet. Az infarktus mellkasi fájdalma a karba, a nyakba és az állkapocsba is kisugározhat. Ilyenkor azonnal hívj mentőt, Magyarországon a 112-t. Nem várni kell, és nem gyógytornász kell.

Ez akkor is érvényes, ha a kezed egyébként hetek óta fáj. Egy régóta meglévő csuklópanasz nem zárja ki, hogy egy új, hirtelen tünetegyüttes valami egészen mást jelent.

## Sérülés után fáj a csuklód? Ezt figyeld

Sérülés után otthonról nem lehet eldönteni, hogy törés, ficam vagy erős rándulás történt. Ehhez általában röntgen kell.

A törött kar vagy csukló a sérülés után hirtelen fájdalmassá, duzzadttá, véraláfutásossá és nehezen mozgathatóvá válik.

Ehhez társulhat szín- vagy alakváltozás, és a terület zsibbadhat is.

Ha törésre gyanakszol, ne kezeld magad otthon.

Ilyenkor minél előbb kérj orvosi tanácsot. Minden lehetséges törést a lehető leghamarabb el kell látni.

Aznap kérj orvosi ellátást, ha a sérült csukló nagyon fájdalmas. Ugyanígy sürgős, ha nem tudod használni a fájdalomtól, vagy ha a fájdalom romlik.

Sürgős az ellátás nagy duzzanat vagy véraláfutás esetén is. Szintén az, ha a terület nagyon merev, vagy ha magas lázad van és hidegrázósan érzed magad.

A törés utáni felépülés általában 6–8 hét, súlyosabb sérülésnél tovább tart.

A gipsz levétele után a csukló merev és gyenge lehet. A gyógytornász ebben tud segíteni, és a panasz néha több hónapig is elhúzódik.

Erről az időszakról részletesen írtunk [a gipsz levétele utáni teendőkről szóló cikkünkben](/blog/csuklotores-utani-gyogytorna).

## Sokat gépelsz, emelsz vagy hangszeren játszol?

Hagyd abba vagy csökkentsd azt a tevékenységet, amitől fáj. Ilyen például a gépelés, a rezgő szerszám használata és a hangszeres játék.

Ez a tanács arról szól, mit érdemes most csökkenteni. Attól még nem biztos, hogy a gépelés okozta a panaszt.

A mai szakmai álláspont: megbízható bizonyíték hiányában nincs igazolt összefüggés a sok billentyűzethasználat és a kéztőalagút-szindróma között.

Ennek a megállapításnak a bizonyítékminősége „nagyon alacsony”, az ajánlás erőssége pedig „konszenzus”. Vagyis szakértői vélemény, nem bizonyított tény.

Az indoklás is ismert: magas vagy közepes minőségű vizsgálat nincs a kérdésre, egyetlen alacsony minőségű vizsgálat pedig talált statisztikailag jelentős összefüggést.

Ezért nem írjuk le, hogy az „egérkéz” okozza a panaszodat. Azt viszont igen, hogy a fájdalmat kiváltó mozdulat csökkentése az otthoni teendők közé tartozik.

Az alkarfájdalom külön kérdés. Két olyan állapot is van, amelynél a fájdalom az alkarban jelentkezik.

A De Quervain-szindrómánál a fájdalom a csuklóban kezdődik, és felfelé, az alkar felé húzódhat.

A teniszkönyök tünetei közé az alkar fájdalma is beletartozik. Kiváltó mozdulat a markolás és a csukló, illetve az alkar ismétlődő csavarása.

Ha a fájdalom súlypontja a könyököd külső oldalán van, akkor [a teniszkönyökről szóló cikkünk](/blog/teniszkonyok) a következő olvasnivalód.

## Az alkarod is fáj?

Az alkarfájdalom ritkán az alkarban kezdődik: legtöbbször a könyök vagy a csukló felől sugárzik oda, ezért az első kérdés mindig az, hol van a fájdalom súlypontja.

A könyök felőli irányt a teniszkönyök képviseli. A panasz egyik tünete éppen az alkar fájdalma, és jellemzően rosszabb lesz emelésre, a kar hajlítására, tárgyak megmarkolására és a csukló mozgatására.

A csukló felőli irányt két dolog adja. Az egyik a De Quervain-szindróma: a fájdalom a csuklóban kezdődik, és onnan húzódhat fel az alkarba. A másik a csuklót mozgató inak túlterhelése. A csuklóízület inai az alkar izmait kötik össze a kézközépcsontokkal, ezért az alkar és a csukló terhelése ugyanannak a rendszernek a két vége.

Van egy helyzet, amikor az alkarfájdalom nem várhat. Sérülés, törés, zúzódás vagy szoros gipsz, illetve szoros kötés után kialakulhat izomrekesz-szindróma. Ennek klasszikus jele az aránytalanul erős fájdalom, ami akkor a legrosszabb, amikor az érintett izmot megnyújtják, és társulhat hozzá bizsergő vagy égő érzés. A zsibbadás és a bénulás már **késői** jel, és nincs hatásos nem műtéti kezelés. Ez sürgősségi állapot.

Ezért van az, hogy az alkarpanasznál a kiváltó helyzet fontosabb, mint maga a fájdalom. Ha ismétlődő terhelés után alakult ki, és fokozatosan jött, akkor a teniszkönyök vagy a csuklóterhelés felé érdemes indulni. Ha sérülés vagy gipsz után jött, és gyorsan romlik, akkor orvos kell, nem gyakorlás.

## Terhesség alatt vagy szülés után fáj a csuklód?

Terhesség alatt gyakoribb a kéztőalagút-szindróma: a terhesség a kockázati tényezők közé tartozik.

Ugyanez az oldal azt is kimondja: a panasz néha néhány hónap alatt magától rendeződik. Ez különösen akkor igaz, ha a terhesség miatt alakult ki.

A hüvelykujj felőli csuklófájdalomnak is van szülés utáni mintázata. A De Quervain-szindróma összefüggésbe hozható a terhességgel és a szülés utáni időszakkal.

Akinél szülés után jelentkezik, az gyakran 4–6 héten belül veszi észre.

Van egy jellegzetes fájdalmas mozdulat is. Magad elé nyújtott karral, felfelé néző hüvelykujjal emelsz valamit, például a gyermekedet.

Ebből nem következik, hogy nálad is ez van. A kivizsgálás küszöbe terhesség alatt és szülés után is ugyanaz, mint bármilyen csuklófájdalomnál.

## Mit tehetsz otthon az első napokban?

A csuklófájdalom otthoni kezelése pihentetéssel, jegeléssel és a kéz kíméletes mozgatásával kezdődik.

Az otthoni teendők köre pontosan körülírható. Ugyanezeket javasolja a háziorvos is enyhe csuklófájdalomnál vagy merevségnél.

- Pihentesd a csuklód, amikor tudod.
- Tegyél jégpakolást törölközőbe, és tartsd a csuklódon legfeljebb 20 percig, 2–3 óránként.
- Mozgasd a kezed és a csuklód kíméletesen: ez enyhítheti az enyhe fájdalmat és merevséget.
- Fájdalomcsillapítóként a paracetamol és az ibuprofén gél jön szóba.
- Vedd le az ékszereidet, ha duzzadtnak látod a kezed.
- Viselj sínt a csuklód megtámasztására, főleg éjszaka. Sín a legtöbb gyógyszertárban kapható.
- Használj segédeszközt a nehéz feladatokhoz, például üvegnyitáshoz vagy zöldségvágáshoz.

Azt is fontos tudni, mit ne tegyél. Sérülés után az első 2–3 napban ne használj melegítő pakolást, és ne fürödj forró vízben.

Szintén kerülendő a nehéz emelés, és az, hogy bármit nagyon erősen megszoríts.

Gyógyszerről és adagolásról ebben a cikkben nem adunk tanácsot. A gyógyszerész tud segíteni abban, melyik fájdalomcsillapító a legjobb neked.

A sín kiválasztásában is a gyógyszerész az első segítség. Szóba jön a hajlékony gumisín is arra az esetre, ha közben használnod kell a csuklód.

Ha egy rövid, vezetett kóstoló segítene a mozgatáshoz, ingyenesen elérhető [az SOS Kézrelax villámkurzus](/kurzusok/sos-kezrelax-villamkurzus). Ez a kézre, a csuklóra és a könyökre fókuszál. Ebben megmutatjuk, mit vizsgálunk mi az egyes kórképeknél. Ezek tájékozódásra valók: a diagnózist orvosi vizsgálat adja meg, nem egy otthon elvégzett teszt.

## Segít a krém vagy a kineziológiai tapasz?

A helyileg felkent gyulladáscsökkentő gélnek friss, sérülés utáni panasznál van a legjobban alátámasztott hatása, a kineziológiai tapasz mögött viszont ennél sokkal gyengébb és ellentmondásosabb a bizonyíték. Egyik sem helyettesíti a kivizsgálást, és mi nem árulunk egyiket sem.

**A krémről és a gélről.** A friss, sérülés utáni panaszra a legerősebb bizonyíték egy 61 vizsgálatot feldolgozó áttekintésből származik. Rándulásnál, húzódásnál és túlterheléses sérülésnél a helyi gyulladáscsökkentők érdemi fájdalomcsillapítást adtak, valószínűleg hasonlót, mint a szájon át szedett készítmények. A legjobb eredményt a diklofenak, az ibuprofén és a ketoprofén géles kiszerelései hozták. A helyi bőrreakciók enyhék és átmenetiek voltak, és nem tértek el a placebótól.

**A tartós, hónapok óta tartó panasznál más a helyzet.** Ugyanannak a kutatócsoportnak a krónikus fájdalomról szóló áttekintése 39 vizsgálatot nézett át, és ezek **mindegyike ízületi kopásról szólt**. A szerzők következtetése óvatos: a helyi diklofenak és ketoprofén az emberek egy kisebb részénél ad jó fájdalomcsillapítást a vivőanyagon felül, más krónikus fájdalmas állapotra pedig nincs bizonyíték. A bizonyíték minősége közepes.

Ehhez tartozik egy őszinte kiegészítés, amit ritkán szoktak leírni. Ugyanebben az áttekintésben a 6–12 hetes vizsgálatokban a résztvevők jelentős része a hatóanyag nélküli vivőanyagtól, tehát magától a kenőcs alapjától is javulást élt meg. Vagyis a kenés maga is számít, nem csak az, mi van benne.

**Mikor van értelme, és mikor nincs.** Az ízületi kopásról szóló szakmai irányelv a helyileg felkent gyulladáscsökkentőt a térdízületi kopásnál felajánlandónak, más érintett ízületeknél megfontolandónak írja le, és kifejezetten a szájon át szedett szer **elé** teszi. Szájon át szedett gyulladáscsökkentő akkor jön szóba, ha a helyi kezelés nem hatásos vagy nem alkalmas, és akkor gyomorvédelemmel együtt. Ugyanez az irányelv azt mondja, hogy a paracetamolt ne rutinszerűen használjuk ízületi kopásnál.

**A kineziológiai tapaszról.** Itt a bizonyíték gyengébb és ellentmondásos. Egy 2019-es metaanalízis, amely a tapaszt önmagában, látszatragasztáshoz hasonlította, alacsony minőségű és nem meggyőző bizonyítékot talált a tapasz javára, és a vizsgált területek a derék és a térd voltak, nem a csukló.

Kifejezetten a kézre és a csuklóra csak a kéztőalagút-szindrómánál készültek összefoglalók, és azok is óvatosak. Egy 2023-as metaanalízis 13 vizsgálat alapján gyenge hatást talált a fájdalomra és a működésre rövid távon, közepes bizonyossági szint mellett. Egy 2025-ös metaanalízis 14 vizsgálat alapján alacsony és közepes minőségű bizonyítékot talált arra, hogy a tapasz hosszabb távon javíthatja a fájdalmat és a működést, és hogy sínnel együtt alkalmazva rövid távon többet adhat, mint a sín önmagában. Mindkét áttekintés **kiegészítő eszközként** írja le a tapaszt, nem önálló kezelésként.

Általános, még ki nem vizsgált csuklófájdalomra tehát nincs olyan vizsgálat, ami a tapaszt igazolná. Ez nem azt jelenti, hogy nem működik, hanem azt, hogy nem tudjuk.

**Amit ebből a gyakorlatban érdemes tudni.** Konkrét készítményt nem nevezünk meg, és nem is ajánlunk: a gyógyszerész tud segíteni abban, melyik való neked, és mire kell figyelned a saját gyógyszereid mellett. Van viszont három helyzet, amikor a krém és a tapasz nem a jó válasz, hanem orvos kell. Ha a csuklód vagy a kezed forró, vörös, duzzadt és merev, ha lázas vagy, vagy ha a panasz sérülés után kezdődött és törésre gyanakszol, akkor a kenés csak késlelteti az ellátást.

## Segít a csuklórögzítő, és mikor?

A csuklórögzítő ott a legjobban alátámasztott, ahol konkrét kórkép áll a panasz mögött: éjszakai sín a kéztőalagút-szindrómánál, és a hüvelykujj tövét megtámasztó sín az ízületi kopásnál. Általános, még ki nem vizsgált csuklófájdalomra a rögzítő inkább kényelmi eszköz, mint kezelés.

**Kéztőalagút-szindrómánál.** A csuklót egyenesen tartó sín éjszakai viseletre való, és akár hat hét is eltelhet, mire javulni kezd. Egy 2023-as áttekintés ennél árnyaltabb képet ad. Rövid távon, három hónapnál rövidebb viseletnél a sín keveset vagy semmit nem tett hozzá a tünetekhez a kezelés nélküli állapothoz képest, az éjszakai sín viszont többeknél hozott összességében javulást, mint a semmittevés. A sín nem bizonyult jobbnak a szteroidinjekciónál, a tornánál vagy a ragasztásnál.

A szerzők következtetése óvatos, és a bizonyosság alacsony vagy nagyon alacsony. Egy dolgot viszont kimondanak, ami a döntésben segít: a sín olcsó beavatkozás, belátható hosszú távú ártalom nélkül, ezért már kis hatás is indokolhatja a használatát annál, aki a műtétet el akarja kerülni. Ugyanez az áttekintés azt találta, hogy a hat hónapig tartó sínviselet többet javíthat, mint a hathetes.

**A hüvelykujj tövének kopásánál.** Egy 12 vizsgálatot feldolgozó metaanalízis szerint a sín közepes vagy nagy mértékben csökkentette a fájdalmat és kisebb-közepes mértékben javította a működést **középtávon**, vagyis 3 és 12 hónap között. Rövid távon nem volt kimutatható hatása, és a különböző síntípusok között sem volt különbség. A bizonyíték minősége itt is alacsony.

Ez a mintázat magyarázza, amit a gyakorlatban is látni: a sín nem az első héten hozza a javulást. Aki két hét után csalódottan leteszi, az nem feltétlenül azért nem érzett hatást, mert nem neki való.

**Amit fontos hozzátenni.** Az ízületi kopásról szóló szakmai irányelv azt mondja, hogy talpbetétet, merevítőt, tapaszt, sínt és egyéb támaszokat **ne rutinszerűen** ajánljunk fel. Ez nem mond ellent a fentieknek: ott, ahol célzott kórkép és célzott sín van, más a helyzet, mint a rutinszerű felajánlásnál. Ugyanezért nem nevezünk meg konkrét terméket, és a sín kiválasztásában a gyógyszerész az első segítség.

Két gyakorlati szabály zárja a szakaszt. A rögzítő nem helyettesíti a kivizsgálást: sérülés után nem pótolja a röntgent. És ha a sín fáj, elzsibbasztja az ujjaidat, vagy a kezed duzzadni kezd alatta, akkor le kell venni, és orvoshoz kell fordulni.

## Milyen orvoshoz fordulj csuklófájdalommal, és mikor?

Az első lépés lehet a gyógyszertár. A gyógyszerész tud tanácsot adni a fájdalomcsillapítóról, a sínről, és arról is, kell-e orvoshoz menned.

Orvoshoz akkor kell fordulni, ha a csuklófájdalom akadályoz a szokásos tevékenységeidben.

Ugyanígy akkor is, ha a fájdalom romlik, vagy újra és újra visszatér.

Menj orvoshoz, ha a fájdalom két hét otthoni kezelés után sem javult.

Bármilyen bizsergés vagy érzéskiesés esetén szintén orvosi vizsgálat kell.

Cukorbetegség mellett a kézpanasz komolyabb lehet, ezt érdemes külön észben tartani.

Orvoshoz kell menni akkor is, ha a csuklófájdalom mellett rosszul vagy és magas lázad van. Ugyanez érvényes, ha a csuklód fájdalmas, meleg, duzzadt és merev.

Melyik orvos? Nálunk a háziorvos az, aki megvizsgál, és ha kell, továbbküld a megfelelő szakrendelésre. Az ellátás pontos rendjéről az orvosod tud felvilágosítást adni.

A sorrendet mi is így kérjük. Előbb legyen kivizsgálás, és csak utána kezdődjön a rendszeres gyakorlás.

## Mikor NE végezd a gyakorlatokat?

Ne kezdj bele a gyakorlatokba, amíg a friss sérülés utáni csuklódat orvos meg nem nézte. Törésgyanú esetén nem szabad otthon kezelni a csuklót.

Ne gyakorolj, ha a kezed egy részén vagy egészén megszűnt az érzés. Ez sürgős ellátást igényel.

Sérülés után az első 2–3 napban ne melegítsd a területet, ne emelj nehezet, és ne szoríts meg semmit erősen.

Hagyd abba a gyakorlást, és menj orvoshoz, ha a fájdalom romlik, vagy ha két hét otthoni kezelés után sem javult.

A gyakorlatoknak nem kell fájniuk. Éles fájdalom esetén hagyd abba, és kérj szakmai segítséget.

Műtét után mindig a kezelőorvosod vagy a gyógytornászod jóváhagyásával kezdj bele. Egy mondatban: a kéztorna nem helyettesíti az orvosi kivizsgálást.

## Mikor menj azonnal orvoshoz?

Aznap kérj orvosi ellátást, ha a csuklófájdalom nagyon erős, ha a fájdalomtól rosszul vagy, vagy ha megszűnt az érzés a kezedben.

Tételesen felsorolható, mikor kell sürgős ellátás.

Sürgős az ellátás, ha a fájdalomtól ájulásérzésed, szédülésed vagy hányingered van. Ugyanez érvényes, ha rosszul, forrón, hidegen vagy hidegrázósan érzed magad.

Sürgős az ellátás akkor is, ha a sérüléskor reccsenő, csikorgó vagy pattanó hangot hallottál.

Szintén aznap kell orvoshoz menni, ha nem tudod mozgatni a csuklód, vagy ha nem tudsz megfogni semmit.

Ugyanígy sürgős, ha a csuklód alakja vagy színe megváltozott.

Sürgős ellátás kell, ha a csuklódon lévő csomó nagyon fájdalmas, forró vagy piros. A pirosság barna és fekete bőrön nehezebben látszik.

És sürgős akkor is, ha a kezed egy részén vagy egészén megszűnt az érzés. Ezek törés vagy fertőzés jelei lehetnek.

Sérülés után négy jelnél azonnal mentőt kell hívni.

- A kar vagy a csukló zsibbad, bizsereg.
- A csont kiáll a bőrből.
- A kar vagy a csukló alakja megváltozott, vagy furcsa szögben áll.
- Erősen vérző seb van a területen.

A magyar hívószám a 112.

Azonnali ellátás kell akkor is, ha az ujjad duzzadt, félig behajlítva áll, nyújtásra nagyon fáj, és az ínhüvely mentén nyomásérzékeny. Ez a négy jel gennyes ínhüvelygyulladásra utalhat.

A gennyes ínhüvelygyulladás a kéz egyik legsúlyosabb fertőzése. A Kanavel-féle négy jel meglétekor azonnal fel kell állítani a műtéti indikációt.

Cukorbetegség és érszűkület mellett rosszabb a kimenetel. A lehetséges következmények között a merevség és az amputáció is szerepel.

Végül egy jel, ami nem a kézről szól. Ha az arcod egyik fele lelóg, az egyik karod erőtlen vagy zsibbadt, és akadozik a beszéded, azonnal hívj mentőt.

Ehhez hozzátartozik: ha a tünetek elmúltak, de 24 órán belül jelen voltak, akkor is azonnali segítség kell.

## Két hét után sem jobb? Így tovább

Ha két hét otthoni kezelés után sem javult a csuklófájdalom, orvoshoz kell fordulni.

Ez a két hét nem büntetés, hanem a szakmailag elfogadott küszöb.

Ha a kivizsgálás nem talált sürgős okot, jöhet a fokozatos, rendszeres gyakorlás. A kéz és a csukló kíméletes mozgatása enyhítheti az enyhe fájdalmat és a merevséget.

A mozgatás módját, mértékét és ütemét viszont érdemes vezetve csinálni. Gyógytornászként ilyenkor az az első kérdés, milyen terhelés éri a kezed, és ehhez kell igazítani a gyakorlást.

Otthon jellemzően nem a gyakorlat hiányzik. A sorrend és az adagolás az, ami nehéz egyedül.

## Mit ad egy vezetett otthoni program a csuklófájdalom mellé?

Rendszert és sorrendet ad a gyakorlásba, nem gyógyulást.

Az Otthoni KézRehab Programot csukló-, ujj-, alkar- és könyökpanaszokra állítottuk össze. 4 modulnyi videóanyagból áll, 50+ videós gyakorlattal.

A gyakorlatok 5 perces miniblokkokba vannak rendezve, hogy egy rövid alkalom is elférjen a napodban. A részleteket [az Otthoni KézRehab Program oldalán](/kurzusok/otthoni-kezrehab-program) találod.

Vásárlás előtt ezt tudnod kell. A program leírásában szerepel, hogy nem javasoljuk, ha:

- traumás sérülésed volt, és az orvos még nem enged mindent csinálni,
- már jelentkezett érzéskiesés,
- régebb óta tart jelentős gyengülés a szorítóerődben,
- műtétre vársz.

Ilyenkor előbb a kivizsgálás következik.

Amit nem ígérünk: gyógyulást, gyógyulási arányt és gyógyulási időt. Erre nincs adatunk, és nem is állítunk ilyet.

Amit kínálunk: rendszerezett, vezetett alkalmakat arra az időszakra, amíg a kezelésről dönt az orvosod. A program nem helyettesíti a szakorvosi vizsgálatot.

Ha a panaszod zsibbadás is, akkor [a kéztőalagút-szindrómáról szóló cikkünk](/blog/keztoalagut-szindroma) a következő lépés. Ha az ujjad akad be, arról [a pattanó ujjról szóló cikkünkben](/blog/pattano-ujj) írtunk.

Ha nemrég vették le a gipszet a csuklódról, akkor [a csuklótörés utáni időszakról szóló cikkünk](/blog/csuklotores-utani-gyogytorna) való neked.

## Kik írták ezt a cikket?

Kiss Kata és Kocsis Kata vagyunk. Gyógytornászok, és évek óta elsősorban a kéz rehabilitációjával foglalkozunk.

Kiss Kata gyógytornász, manuálterapeuta, sportrehabilitációs tréner. Kocsis Kata gyógytornász, sportrehabilitációs tréner, gyógy- és sportmasszőr.

Mindketten elvégeztük 2024-ben Kate Thorn CHT distalis radius törés és De Quervain kurzusait. Ugyanebben az évben Daphne Xuan MPT „Functional Anatomy of the Hand” kurzusát is.

Oktatunk is. A ProBody Stúdió sportrehabilitációs tréner képzésén a „Bevezetés a kéz, a csukló- és könyökízület rehabilitációs lehetőségeibe” tantermi kurzus instruktorai vagyunk (2024, 2025, 2026, Budapest).

Ez a szakmai háttér a szerző hitelességét igazolja.

## Fontos tudnivaló

A cikk általános tájékoztatás, nem helyettesíti a szakorvosi vizsgálatot és a személyre szabott kezelést. Ha bizonytalan vagy, vagy a tünetek romlanak, fordulj orvoshoz.

---

## Állítás és forrás: a cikkíró öntesztje

> Ez a szakasz NEM része a cikknek, és nem kerül a `content` mezőbe. A
> `docs/tudastar-tartalmi-terv.md` 5.8 pontjának 2. elfogadási feltétele
> miatt készült: minden klinikai állítás mellett ott a forrás-azonosító, és
> minden szám szó szerint egyezik a forrással.

**Klinikai állítások, szakaszonként, forrás-azonosítóval.**

| # | Állítás | Forrás |
|---|---|---|
| 1 | A csuklófájdalomnak sokféle oka lehet, és a leggyakoribb a csukló megütése vagy sérülése | CSF1 |
| 2 | Hirtelen, éles fájdalom, duzzanat, a sérüléskor hallott pattanó vagy roppanó hang: törött csukló | CSF1 |
| 3 | Fájdalom, duzzanat, véraláfutás, nehéz mozgatás és fogás: rándult csukló | CSF1 |
| 4 | Tartós fájdalom, duzzanat, merevség a hüvelykujj tövénél, esetleg csomó: De Quervain vagy artrózis | CSF1 |
| 5 | Éjjel erősödő sajgás, bizsergés, zsibbadás, gyenge hüvelykujj: kéztőalagút-szindróma | CSF1 |
| 6 | Sima tapintású, néha fájdalmas csomó a csukló tetején: ganglion | CSF1 |
| 7 | Az NHS a kézfájdalmat terület szerint bontja: csukló, ujj, hüvelykujj, tenyér, kézhát | CSF2 |
| 8 | „Ne próbáld magad megállapítani a fájdalom okát” | CSF1 (= VZ2) |
| 9 | Sérülés után a törés, a ficam és az erős rándulás elkülönítéséhez általában röntgen kell | CST1 |
| 10 | A törött kar vagy csukló hirtelen fájdalmas, duzzadt, véraláfutásos és nehezen mozgatható lesz | CST1 |
| 11 | Ehhez szín- vagy alakváltozás és zsibbadás is társulhat | CST1 |
| 12 | Törésgyanúnál nem szabad otthon kezelni a csuklót | CSF1 |
| 13 | Törésgyanúnál minél előbb orvosi tanács kell; minden lehetséges törést a lehető leghamarabb el kell látni | CST1 |
| 14 | Sürgős ellátás: nagyon fájdalmas vagy használhatatlan végtag, romló fájdalom, nagy duzzanat vagy véraláfutás, nagyon merev terület, magas láz vagy hidegrázás | CST1 |
| 15 | A törés utáni felépülés általában 6–8 hét, súlyosabb sérülésnél tovább | CST1 |
| 16 | A gipsz levétele után a csukló merev és gyenge lehet; a gyógytornász segít; néha több hónapig is eltart | CST1 |
| 17 | Hagyd abba vagy csökkentsd a fájdalmat okozó tevékenységet: gépelés, rezgő szerszám, hangszer | CSF1 |
| 18 | A munkacsoport véleménye szerint, megbízható bizonyíték hiányában, nincs összefüggés a sok billentyűzethasználat és a kéztőalagút-szindróma között | CSF3 (= CTS2) |
| 19 | Ennek bizonyítékminősége „Very Low”, az ajánlás erőssége „Consensus” | CSF3 |
| 20 | Magas vagy közepes minőségű vizsgálat nem volt a kérdésre; egy alacsony minőségű vizsgálat talált statisztikailag jelentős összefüggést | CSF3 |
| 21 | De Quervain-szindrómánál a fájdalom a csuklóban kezdődik, és az alkar felé húzódhat | DQ1 |
| 22 | A teniszkönyök tünetei közt szerepel az alkarfájdalom; kiváltó a markolás és a csukló, alkar ismétlődő csavarása | TK1 |
| 23 | A terhesség a kéztőalagút-szindróma kockázati tényezői között szerepel | CTS1 |
| 24 | A panasz néha néhány hónap alatt magától rendeződik, különösen ha a terhesség miatt alakult ki | CTS1 |
| 25 | A De Quervain-szindróma összefüggésbe hozható a terhességgel és a szülés utáni időszakkal | DQ1 |
| 26 | Akinél szülés után jelentkezik, gyakran 4–6 héten belül veszi észre | DQ1 |
| 27 | Jellegzetes fájdalmas mozdulat: magad elé nyújtott kar, felfelé néző hüvelykujj, emelés (például a gyermek felemelése) | DQ1 |
| 28 | Otthoni tanács: pihentetés | CSF1 |
| 29 | Otthoni tanács: jégpakolás törölközőben, legfeljebb 20 perc, 2–3 óránként | CSF1 |
| 30 | Otthoni tanács: a kéz és a csukló kíméletes mozgatása enyhítheti az enyhe fájdalmat és merevséget | CSF1 |
| 31 | Otthoni tanács: paracetamol vagy ibuprofén gél mint fájdalomcsillapító | CSF1 |
| 32 | Otthoni tanács: ékszer levétele duzzadt kéznél | CSF1 |
| 33 | Otthoni tanács: sín a csukló megtámasztására, főleg éjszaka, a legtöbb gyógyszertárban kapható | CSF1 |
| 34 | Otthoni tanács: segédeszköz a nehéz feladatokhoz (üvegnyitás, zöldségvágás) | CSF1 |
| 35 | Tilalom: sérülés után az első 2–3 napban nincs melegítő pakolás és forró fürdő; nincs nehéz emelés és erős szorítás | CSF1 |
| 36 | A gyógyszerész tud segíteni a fájdalomcsillapító kiválasztásában | CSF1 |
| 37 | A gyógyszerész segít a sín kiválasztásában; van hajlékony gumisín is, ha használni kell a csuklót | CSF1 |
| 38 | Orvoshoz kell menni, ha a fájdalom akadályoz a szokásos tevékenységekben | CSF1 |
| 39 | Orvoshoz kell menni, ha a fájdalom romlik vagy újra és újra visszatér | CSF1 |
| 40 | Orvoshoz kell menni, ha a fájdalom két hét otthoni kezelés után sem javult | CSF1 |
| 41 | Orvoshoz kell menni bármilyen bizsergés vagy érzéskiesés esetén | CSF1 |
| 42 | Cukorbetegség mellett a kézpanasz komolyabb lehet | CSF1 |
| 43 | Orvoshoz kell menni, ha a fájdalom mellett rosszullét és magas láz van | CSF1 |
| 44 | Orvoshoz kell menni, ha a csukló fájdalmas, meleg, duzzadt és merev | CSF1 |
| 45 | Sürgős: nagyon erős csuklófájdalom | CSF1 |
| 46 | Sürgős: ájulásérzés, szédülés, hányinger a fájdalomtól, illetve rosszullét, forró vagy hideg érzés, hidegrázás | CSF1 |
| 47 | Sürgős: reccsenő, csikorgó vagy pattanó hang a sérüléskor | CSF1 |
| 48 | Sürgős: a csukló nem mozgatható, semmit nem lehet megfogni | CSF1 |
| 49 | Sürgős: a csukló alakja vagy színe megváltozott | CSF1 |
| 50 | Sürgős: nagyon fájdalmas, forró vagy piros csomó a csuklón; a pirosság barna és fekete bőrön nehezebben látszik | CSF1 |
| 51 | Sürgős: megszűnt érzés a kéz egy részén vagy egészén; ezek törés vagy fertőzés jelei lehetnek | CSF1 |
| 52 | Mentőhívás sérülés után: zsibbadó vagy bizsergő kar és csukló | CST1 |
| 53 | Mentőhívás sérülés után: a csont kiáll a bőrből | CST1 |
| 54 | Mentőhívás sérülés után: alakváltozás vagy furcsa szög | CST1 |
| 55 | Mentőhívás sérülés után: erősen vérző seb | CST1 |
| 56 | Azonnali ellátás: duzzadt, félig behajlítva tartott, nyújtásra nagyon fájó, az ínhüvely mentén nyomásérzékeny ujj | VZ5, VZ6 |
| 57 | A gennyes ínhüvelygyulladás a kéz egyik legsúlyosabb fertőzése; a Kanavel-féle négy jel meglétekor azonnali műtéti indikáció | VZ6 |
| 58 | Cukorbetegség és érszűkület mellett rosszabb a kimenetel; merevség és amputáció is előfordulhat | VZ5 |
| 59 | Féloldali arclelógás, karerőtlenség vagy karzsibbadás és akadozó beszéd esetén azonnal mentő | VZ1 |
| 60 | Ha a stroke tünetei elmúltak, de 24 órán belül jelen voltak, akkor is azonnali segítség kell | VZ1 |
| 61 | A két hetes küszöb az NHS csuklófájdalom-oldaláról származik, és ugyanott szerepel az otthoni tanácsok listája | CSF1 |
| 62 | A kéz és a csukló kíméletes mozgatása enyhítheti az enyhe fájdalmat és a merevséget | CSF1 |

**A 2026-08-25-i bővítés állításai** (a forrásjelölés az orvosi kutatás
F-számozását követi; az aliasokat a fenti forrástábla adja).

| # | Állítás | Forrás |
|---|---|---|
| 63 | Sürgősségi doboz: mentőhívás sérülés után zsibbadó vagy bizsergő kar és csukló, kiálló csont, alakváltozás vagy erősen vérző seb esetén | F4 (= CST1) |
| 64 | Sürgősségi doboz: féloldali arclelógás, karerőtlenség vagy karzsibbadás és akadozó beszéd esetén azonnal mentő; a 24 órán belüli, már elmúlt tünetre is | VZ1 |
| 65 | Sürgősségi doboz: a karfájdalom mellkasi szorítással, nyomással, légszomjjal, hányingerrel vagy hideg verejtékezéssel együtt azonnali ellátást igényel | F8, F12 |
| 66 | Sürgősségi doboz: aznapi orvosi ellátás nagyon erős fájdalomnál, rosszullétnél, láznál és hidegrázásnál, mozgás- és fogásképtelenségnél, alak- vagy színváltozásnál, érzéskiesésnél | F1 (= CSF1) |
| 67 | Sürgősségi doboz: duzzadt, félig behajlítva tartott, nyújtásra nagyon fájó, az ínhüvely mentén nyomásérzékeny ujj | F24 (= VZ5), F25 (= VZ6) |
| 68 | Sürgősségi doboz: gipsz vagy szoros kötés után az aránytalanul erős, nyújtásra rosszabbodó fájdalom azonnali ellátást igényel | F11, F4 |
| 69 | A kézfej fájdalma mögött leggyakrabban ín- vagy ízületi gyulladás, törés, ganglion vagy kéztőalagút-szindróma áll | F2 |
| 70 | Tartós duzzanat és merevség ín- vagy ízületi gyulladás felé mutat, és ilyenkor gyakran nehéz az ujjakat mozgatni | F2 |
| 71 | Hirtelen, éles fájdalom, duzzanat és a sérüléskor hallott pattanó vagy roppanó hang törésre utalhat | F2 |
| 72 | A ganglion sima tapintású csomó egy ízület vagy ín közelében; lehet fájdalmas és lehet panaszmentes is | F2 |
| 73 | A kéztőalagút-szindrómára az éjjel erősödő sajgás, a zsibbadás vagy bizsergés és a gyenge hüvelykujj jellemző | F2 |
| 74 | A Heberden-csomó az ujjak végízületén, a Bouchard-csomó a középső ujjperc ízületén ül; mindkettő az ízületi kopás következménye, a porc elvékonyodásával a szervezet új csontot épít az ízület szélén | F14 |
| 75 | Kézízületi artrózis: 85 éves korára a nők körülbelül fele és a férfiak nagyjából negyede érintett (leíró népességi adat) | F14 |
| 76 | Órák alatt kialakuló, forró, duzzadt és vörös ízület köszvényes roham lehet; a köszvény tipikusan a nagylábujjat érinti, de a kezet, a csuklót és a könyököt is; ugyanez a kép ízületi fertőzést is jelenthet | F7 |
| 77 | Orvoshoz kell fordulni, ha a kézfej fájdalma akadályoz a szokásos tevékenységekben, ha két hét otthoni kezelés után sem javult, vagy ha bizsergés, illetve érzéskiesés társul hozzá | F1, F2 |
| 78 | De Quervain-szindróma: a fő tünet a fájdalom a csukló hüvelykujj felőli oldalán, amely az alkar felé húzódhat; a pontos ok nem teljesen tisztázott, az ismétlődő csukló- és hüvelykujj-mozgatás rontja | F9 (= DQ1) |
| 79 | De Quervain kockázati tényezői: a 40-es és 50-es életkor, a női nem, a rheumatoid arthritis, valamint a terhesség és a szülés utáni időszak | F9 |
| 80 | A hüvelykujj tövének nyeregízületi kopása fogáskor, csippentéskor és csavaró mozdulatnál fáj; társulhat gyengeség, duzzanat, nyomásérzékenység, beszűkült mozgás és csontos kiemelkedés | F10 |
| 81 | A nyeregízületi kopás a nőknél 2-3-szor gyakoribb, és jellemzően 50 év fölött jelentkezik | F10 |
| 82 | A Finkelstein- vagy Eichhoff-teszt menete, és hogy a vizsgálatot szakember végzi | F9 |
| 83 | A nyeregízületi őrlőteszt menete | F10 |
| 84 | Az ínhüvelyi és az ízületi eredet elkülönítő jelei: hely, kisugárzás, kiváltó mozdulat, tipikus élethelyzet, látható jel | F9, F10 |
| 85 | Mindkét esetnél szóba jön a hüvelykujjat és a csuklót megtámasztó sín, a helyileg felkent gyulladáscsökkentő és a kiváltó mozdulat csökkentése | F9, F10 |
| 86 | A teniszkönyök egyik tünete az alkar fájdalma, amely rosszabb lesz emelésre, a kar hajlítására, a megmarkolásra és a csukló mozgatására | F6 (= TK1) |
| 87 | De Quervain-szindrómánál a fájdalom a csuklóban kezdődik, és onnan húzódhat fel az alkarba | F9 |
| 88 | A csuklóízület inai az alkar izmait kötik össze a kézközépcsontokkal | F13 |
| 89 | Sérülés, törés, zúzódás, szoros gipsz vagy szoros kötés után izomrekesz-szindróma alakulhat ki: aránytalanul erős, a megnyújtásra legrosszabb fájdalom, bizsergő vagy égő érzés; a zsibbadás és a bénulás késői jel; nincs hatásos nem műtéti kezelés | F11 |
| 90 | A kéztőalagút-szindróma, a De Quervain-szindróma, a kézízületi kopás és a pattanó ujj körülbelül egyforma arányban érinti a domináns és a nem domináns kezet; a kivétel a teniszkönyök, amely a domináns oldalon gyakoribb | F23 |
| 91 | A domináns kéz érintettsége valamivel nagyobb mindennapi akadályozottsággal jár, de a különbség mértéke kicsi | F23 |
| 92 | A bal kar fájdalma mellkasi szorítással, nyomással, légszomjjal, hányingerrel vagy hideg verejtékezéssel együtt szívinfarktus jele lehet | F12 |
| 93 | Az infarktus mellkasi fájdalma a karba, a nyakba és az állkapocsba is kisugározhat | F8 |
| 94 | Friss, sérülés utáni panasznál (rándulás, húzódás, túlterheléses sérülés) a helyi gyulladáscsökkentők érdemi fájdalomcsillapítást adtak, valószínűleg a szájon át szedettekhez hasonlót; a legjobb eredményt a diklofenak, az ibuprofén és a ketoprofén gél hozta; a bőrreakciók enyhék, átmenetiek és a placebótól nem eltérőek voltak | F16 |
| 95 | A krónikus fájdalomról szóló áttekintés 39 vizsgálata mind ízületi kopásról szólt; a helyi diklofenak és ketoprofén az emberek egy kisebb részénél ad jó fájdalomcsillapítást a vivőanyagon felül; más krónikus fájdalmas állapotra nincs bizonyíték; a bizonyíték minősége közepes | F17 |
| 96 | A 6–12 hetes vizsgálatokban a résztvevők jelentős része a hatóanyag nélküli vivőanyagtól is javulást élt meg | F17 |
| 97 | Ízületi kopásnál a helyileg felkent gyulladáscsökkentő a térdnél felajánlandó, más érintett ízületnél megfontolandó, és a szájon át szedett szer elé kerül; a szájon át szedett akkor jön szóba, ha a helyi nem hatásos vagy nem alkalmas, és akkor gyomorvédelemmel; a paracetamol ne legyen rutinszerű | F15 |
| 98 | A kineziológiai tapasz látszatragasztáshoz mérve alacsony minőségű, nem meggyőző bizonyítékot ad; a vizsgált területek a derék és a térd voltak, nem a csukló | F20 |
| 99 | Kéztőalagút-szindrómánál a tapasz 13 vizsgálat alapján rövid távon gyenge hatású a fájdalomra és a működésre, közepes bizonyossági szint mellett | F21 |
| 100 | Kéztőalagút-szindrómánál a tapasz 14 vizsgálat alapján hosszabb távon javíthatja a fájdalmat és a működést, és sínnel együtt rövid távon többet adhat, mint a sín önmagában; mindkét áttekintés kiegészítő eszközként írja le | F21, F22 |
| 101 | Krém és tapasz helyett orvos kell forró, vörös, duzzadt és merev kéznél, láznál, és sérülés utáni törésgyanúnál | F1 |
| 102 | Kéztőalagút-szindrómánál a csuklót egyenesen tartó sín éjszakai viseletre való, és akár hat hét is eltelhet, mire javulni kezd | F5 (= CTS1) |
| 103 | Három hónapnál rövidebb viseletnél a sín keveset vagy semmit nem tett hozzá a kezelés nélküli állapothoz képest; az éjszakai sín viszont többeknél hozott összességében javulást, mint a semmittevés; a sín nem bizonyult jobbnak a szteroidinjekciónál, a tornánál vagy a ragasztásnál | F18 |
| 104 | A bizonyosság alacsony vagy nagyon alacsony; a sín olcsó beavatkozás belátható hosszú távú ártalom nélkül; a hat hónapos sínviselet többet javíthat, mint a hathetes | F18 |
| 105 | A hüvelykujj-nyeregízületi kopásnál a sín középtávon (3 és 12 hónap között) csökkentette a fájdalmat és javította a működést; rövid távon nem volt kimutatható hatása; a síntípusok között nem volt különbség; a bizonyíték minősége alacsony | F19 |
| 106 | Ízületi kopásnál a talpbetét, a merevítő, a tapasz, a sín és az egyéb támaszok rutinszerű felajánlása kerülendő | F15 |
| 107 | A rögzítő nem pótolja a röntgent sérülés után; ha a sín fáj, elzsibbasztja az ujjakat vagy duzzad alatta a kéz, le kell venni és orvoshoz kell fordulni | F1, F4 |

**Klinikai állítás forrás nélkül: 0 darab.**

**Ami forrás nélkül szerepel a szövegben, és miért nem klinikai állítás.**

- A nyitókép (üvegnyitás, bögre) és a „ez a cikk nem mondja meg, mi bajod van”
  mondat: szerkesztői keret, nem állít semmit a betegségről.
- A belső linkeket bevezető mondatok: navigáció, nem klinikai tartalom.
- „Nálunk a háziorvos az, aki megvizsgál, és ha kell, továbbküld”: általános
  ellátási megfogalmazás. A C5 kiírás kifejezetten ezt kéri, és tiltja a magyar
  beutalórend részletezését, mert arra nincs forrás.
- „A sorrendet mi is így kérjük”, „Gyógytornászként ilyenkor azt nézzük meg”:
  a saját gyakorlatunk leírása, nem bizonyíték-állítás
  (`docs/seo-geo-llm.md` 2.3, elsőszemélyű tapasztalat).
- „Otthon jellemzően nem a gyakorlat hiányzik, a sorrend és az adagolás az, ami
  nehéz egyedül”: a mért vevőhangból származó megfigyelés
  (`docs/vevohang-es-hirdetesszoveg.md` 3.), nem klinikai állítás.
- „A gyakorlatoknak nem kell fájniuk”, „Műtét után mindig a kezelőorvosod vagy a
  gyógytornászod jóváhagyásával kezdj bele”: a repó meglévő óvatossági
  fordulatai (`src/scripts/restore-legacy-content.ts`).
- Kurzus-tények (4 modulnyi videóanyag, 50+ videós gyakorlat, 5 perces
  miniblokkok, csukló-, ujj-, alkar- és könyökpanaszok): a repóban élő
  termékleírásból, `src/scripts/restore-legacy-content.ts`.
- Szerzői hitelesítők (végzettség, Kate Thorn CHT és Daphne Xuan MPT kurzusai,
  a ProBody Stúdió képzésén betöltött instruktori szerep 2024, 2025 és 2026
  évekre): `docs/tudastar-hangnem-es-technika.md` 1.7 és
  `src/scripts/restore-legacy-content.ts` 907. sor. Ezek a szerző hitelességét
  igazolják, nem klinikai állítást. **Az SZTK-A-33553/2024 akkreditációs szám és
  a 12 kreditpont a 2026-08-21-i tényellenőrző kör B3 pontja miatt KIKERÜLT** a
  szövegből, mert a repó saját leltára (`docs/tartalom-leltar-regi-oldal.md`
  E17, Ny6) nyitottként tartja nyilván, érvényes-e 2026-ban.

## A vezetőnek szóló jelzések

> Ez a szakasz sem része a cikknek.

**1. Egy H2-vel több, mint a kiírásban.** A C5 kiírás hét H2-t ad. A cikkben
nyolc tartalmi H2 van: külön szakasz lett a „Terhesség alatt vagy szülés után
fáj a csuklód?” kérdés. Indok: a kiírás klaszterében szerepel a
`csuklófájdalom terhesség alatt` autocomplete-alak
(`docs/monid-adatok-teljes.md` 3.9), és a témára két forrásunk is van (CTS1 a
kéztőalagútra, DQ1 a De Quervainre). Egy önálló, kérdés-alakú H2 idézhetőbb,
mint egy bekezdés egy másik szakasz közepén (`docs/seo-geo-llm.md` 2.1).
A kiírás minden H2-je megvan, egyik sem maradt ki.

**2. A „Mikor NE végezd a gyakorlatokat?” a vörös zászlók elé került.** Ugyanaz
a sorrend, mint a C4 cikkben, hogy a két „mikor állj meg” szakasz egymás mellett
legyen.

**3. Forrás-karbantartás.** A DQ1 (AAOS OrthoInfo) címe átirányít a
`www.orthoinfo.org` domainre, a CST1 (NHS, Broken arm or wrist) jelzett
felülvizsgálati határideje 2026-05-26-án lejárt. Mindkettő jelölve a cikk
forrásjegyzékében. A `docs/orvosi-forrasbazis.md` frissítése más ügynök
fájl-tulajdona.

**4. Amit szándékosan nem írtunk le.** Gyógyulási arány, gyógyulási idő és
diagnózis nincs a szövegben. A csuklófájdalom „kezelése” szó a vevő szavaként
szerepel, de mindig otthoni kezelés vagy orvosi kezelés értelemben, ígéret
nélkül. A `lelki okai` keresésekre nincs mondat, mert nincs forrás. Az
öndiagnózis-fa helyett az NHS tünetlistája szerepel, kimondott
öndiagnózis-tilalommal.

**5. Mért nyelvi számok (a `docs/tudastar-hangnem-es-technika.md` függelékének
módszerével, a cikk törzsére, a forrásjegyzék nélkül).** 2 025 szó, 194 mondat,
átlagos mondathossz 10,4 szó, medián 10, a mondatok 88,1%-a legfeljebb 15 szó,
a leghosszabb mondat 21 szó, 30 szónál hosszabb mondat 0. Kvirtmínusz (—)
0 darab. Gondolatjelként használt nagykötőjel 0 darab: mind az 5 nagykötőjel
tartomány (6–8 hét, 4–6 hét, 2–3 óránként, és kétszer az első 2–3 nap).
Idézőjel: 5 nyitó „ és 5 záró ”, magyar alsó-felső pár. Magázó alak: 0.
A vevő szavai a törzsben: fájdalom 43, gyakorlat 6, kezelés 5, alkalom 1,
alkalmakat 1. **Figyelem: ezek a számok a 2026-08-21-i állapotra vonatkoznak,
a 2026-08-25-i bővítés ELŐTT. Újramérés kell.**

**6. A 2026-08-25-i arány-tisztító kör eredménye.** Az orvosi kutatás
(`build/kutatas/csuklo-es-kezfajdalom.md`) mérése szerint a cikkben **nulla**
gyógyulási arány, sikerarány és kimeneteli százalék volt, tehát kötelező csere
nem keletkezett; a `%` jelek száma a teljes szövegben 0 volt. A kutatás öt
határesetet vizsgált meg és hagyott bent (6–8 hetes törésgyógyulás, a szülés
utáni 4–6 hét, a „néha néhány hónap alatt magától rendeződik”, a jegelés
adagolása, és a kurzus termékleíró mennyiségei). Ezekhez a bővítés nem nyúlt.

**7. Amit a bővítés hozott, és amiről nektek kell dönteni.** Hét új elem került
be. A hozzájuk tartozó szakmai döntések, ahogy az orvosi kutatás 4. szakasza
sorolja:

- **A szív-tünetegyüttes** (a „Bal vagy jobb csuklód fáj?” szakasz záró
  bekezdése és a sürgősségi doboz második mondata) tünetegyüttest ír le, nem
  oldalt: a puszta bal oldali kézfájdalom nem infarktusgyanú. A pontos
  tünetlista jóváhagyása a tiétek. Ugyanaz a szerkezeti kérdés, mint a befagyott
  váll cikknél.
- **Az izomrekesz-szindróma** (az alkar-szakasz és a doboz zárómondata) ritka,
  súlyos és ijesztő. Bekerüljön-e, és milyen részletességgel?
- **A köszvény** (a kézfej-szakaszban) új elem, eddig egyik cikkben sem
  szerepelt. Alternatíva: a diagnózisnév elhagyása és csak a „forró, vörös,
  duzzadt ízület” vörös zászló megtartása.
- **A NICE és a paracetamol.** Az ízületi kopásról szóló irányelv szerint a
  paracetamol ne legyen rutinszerű; a „Mit tehetsz otthon” szakasz viszont az
  NHS nyomán a paracetamolt említi elsőként. A két állítás hatóköre különbözik,
  ezért nem ellentmondás, de egymás mellett zavaró lehet.
- **A NICE és a sín.** A rutinszerű felajánlás kerülése és a kórkép-specifikus
  kedvezőbb bizonyíték egymás mellett áll a rögzítő-szakaszban; ha ezt
  ellentmondásnak látjátok, inkább az irányelv-mondat essen ki.
- **A hüvelykujj-összevetés** táblázat helyett két felsorolás lett (a
  storefront szerializálója nem rendereli a táblázatot). Öndiagnózisra
  csábíthat: eldönthetitek, hogy folyószövegbe oldjuk-e, és bent maradjon-e a
  Finkelstein-teszt leírása.
- **Két leíró népességi szám maradt bent** (a kézízületi artrózis 85 éves korra
  vonatkozó gyakorisága, és a nyeregízületi kopás 2-3-szoros női túlsúlya).
  Ezek nem gyógyulási arányok, hanem előfordulási adatok, ezért az
  arány-tisztítás nem érintette őket — de ha úgy látjátok, hogy a cikk
  szám-mentes hangneméből kilógnak, szám nélkül is leírhatók.

**8. Sorrendi változás, és egy szándékos eltérés a hub-sablontól.** A sürgősségi
doboz a H1 alá, a lead ELÉ került (`seo-plan.json` `hub_sablon.sorrend` 3. eleme,
H-CS `surgossegi_doboz_elol: true`). A záró „Mikor menj azonnal orvoshoz?” H2 a
helyén maradt, mert a sablon szerint a részletes záró biztonsági szakasz külön
áll a doboztól.

A „Fontos tudnivaló” disclaimer viszont a törzs VÉGÉN maradt, pedig a hub-sablon
szerint a doboz elé kellene kerülnie. Az ok mérhető, nem ízlésbeli: a
`src/lib/tudastar/markdown-to-lexical.ts` `excerptFrom` függvénye a törzs első
valódi bekezdéséből képzi a bejegyzés `excerpt` mezőjét (idézetblokkot és
címsort átugorva), és ezt az `import-tudastar-cikkek.ts` 138. sora használja.
Ha a disclaimer kerül előre, a lista-kártya és az `og:description` szövege
„A cikk általános tájékoztatás, nem helyettesíti a szakorvosi vizsgálatot…”
lenne a mai lead helyett. Ha a disclaimert mégis előre akarjátok tenni, előbb az
`excerpt` képzését kell explicitté tenni (a metaadat-tábla `excerpt` mezőjéből),
és csak utána mozgatni. Ez vezetői döntés.

**9. Tartalmi átfedés, amit érdemes összefésülni.** Az új „Az alkarod is fáj?”
szakasz és a „Sokat gépelsz, emelsz vagy hangszeren játszol?” szakasz utolsó
három bekezdése ugyanazt a két alkar-eredetet (De Quervain, teniszkönyök)
tárgyalja. A bővítésnél a duplikált teniszkönyök-átvezető mondatot az új
szakaszból kivettük, a maradék átfedés viszont szerkesztői döntést kíván.
Ugyanez kisebb mértékben a kézfej-szakasz és a „Mi okozhat csukló- és
kézfájdalmat?” tünetlistája között is fennáll.

**10. GYIK.** A GYIK ma 6 sor a 6-ból, és a `C.json` a `ne_nyulj_hozza` listára
tette, ezért ez a kör NEM nyúlt hozzá. Ha az új szakaszokhoz GYIK-sort is
akartok, egy mai sornak ki kell esnie; a legkevésbé megterhelt a 6., a „Segít
valamilyen krém vagy gél a csuklófájdalomra?”, amelyet a krém- és
tapasz-szakasz tartalmával sorcsere nélkül bővíteni lehetne.
