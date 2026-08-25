# LEKTORÁLANDÓ VÁZLAT. A két gyógytornász szakmai jóváhagyása előtt nem publikálható.

> **Mi ez?** A Tudástár C1 cikkének teljes szövegvázlata
> (`docs/tudastar-tartalmi-terv.md` 6. szakasz, C1). A rekord `status` és
> `_status` mezője `draft` marad, amíg Kocsis Kata és Kiss Kata jóvá nem hagyja.
>
> **Készült:** 2026-08-21. **Írta:** cikkíró ügynök, a vezető ellenőrzésére.
> **Minden klinikai állítás forrása** a `docs/orvosi-forrasbazis.md` valamelyik
> tétele. Forrás nélküli klinikai állítás a szövegben nincs (az öntesztet lásd
> az „Állítás és forrás” táblázatban).
>
> **Elsődleges forrásellenőrzés.** A cikkíró nem csak a forrásbázisra
> támaszkodott: mind a 12 hivatkozott forrást ELSŐ KÉZBŐL is megnyitotta
> 2026-08-21-én (NHS-oldalak és az AAOS-irányelv PDF-je letöltve, a lektorált
> közlemények absztraktjai a PubMed E-utilities API-jából). Minden szám, arány
> és megbízhatósági tartomány szó szerint egyezik. Egy eltérés derült ki: az
> NHS a sérülés utáni kar- és csuklózsibbadást a **mentőhívást** igénylő jelek
> közé sorolja, nem az aznapi ellátás közé. A cikk a szigorúbb, helyes
> besorolást követi.
>
> **A kvirtmínuszról:** a feladatkiírás a fájl elejére kvirtmínusszal elválasztott
> „LEKTORÁLANDÓ VÁZLAT” jelzést kért. A `docs/ui-sztenderdek.md` §3.1 viszont
> magyar szövegben tiltja a kvirtmínuszt (U+2014), és a cikk-lint L3 szabálya is
> nulla darabot enged. A jelzés ezért ponttal szerepel, szó szerint ugyanazokkal
> a szavakkal.
>
> **Javítás 2026-08-21-én** (tényellenőrző kör, `docs/cikkek-tenyellenorzes.md`):
> a mentőhívási szint a cikk elejére került (B1), a kurzus saját ellenjavallata
> bekerült az ajánlás mellé (B2), és hat forrás másik fele is a szövegbe került
> (J10, J11, J14, J15, J16, M1). A tételes lista: `docs/cikkek-javitas-naplo.md`.

---

## Felhasznált források (áttekintés)

Az alábbi tizenkét tétel a `docs/orvosi-forrasbazis.md`-ből való, a forrásbázis
azonosítójával. A 2026-08-25-i orvosi kutatási kör új forrásait a második tábla
sorolja, linkkel és hozzáférési dátummal.

| Azonosító | Forrás | Típus |
|---|---|---|
| ZS1 | NHS. Pins and needles. Felülvizsgálva 2024-01-04. | Nemzeti egészségügyi szolgálat |
| ZS3 | Iyer S, Kim HJ. Cervical radiculopathy. Curr Rev Musculoskelet Med. 2016. PMID 27250042. | Lektorált áttekintés |
| ZS5 | Graf A és mtsai. Modern Treatment of Cubital Tunnel Syndrome. J Hand Surg Glob Online. 2023. PMID 37521554. | Lektorált áttekintés |
| ZS6 | Bateman M és mtsai. Effectiveness of night splints for cubital tunnel syndrome. Hand Ther. 2025. PMID 40385935. | Szisztematikus áttekintés |
| CTS1 | NHS. Carpal tunnel syndrome. Felülvizsgálva 2024-04-17. | Nemzeti egészségügyi szolgálat |
| CTS2 | AAOS. Management of Carpal Tunnel Syndrome. Evidence-Based Clinical Practice Guideline, 2024-05-18. | Hivatalos irányelv |
| CTS3 | Karjalainen TV és mtsai. Splinting for carpal tunnel syndrome. Cochrane Database Syst Rev. 2023. PMID 36848651. | Cochrane-áttekintés |
| CTS9 | AAOS OrthoInfo. Carpal Tunnel Syndrome. Szerző: Tyler Steven Pidgeon MD; lektor: Thomas Ward Throckmorton MD. | Szakmai szervezet |
| CTS10 | Ballestero-Pérez R és mtsai. Effectiveness of Nerve Gliding Exercises on Carpal Tunnel Syndrome. J Manipulative Physiol Ther. 2017. PMID 27842937. | Szisztematikus áttekintés |
| VZ1 | NHS. Stroke, Symptoms. Felülvizsgálva 2024-09-12. | Nemzeti egészségügyi szolgálat |
| VZ2 (= CSF1) | NHS. Wrist pain. Felülvizsgálva 2025-11-05. | Nemzeti egészségügyi szolgálat |
| VZ3 | NHS. Broken arm or wrist. Felülvizsgálva 2023-05-26. | Nemzeti egészségügyi szolgálat |

### Új források a 2026-08-25-i orvosi kutatási körből

Ezek a `build/kutatas/miert-zsibbad-a-kezem.md` forrásjelölései, változatlanul.
Minden webes forrás lekérési dátuma **2026-08-25**.

| Azonosító | Forrás | Link | Hozzáférés | Mire használtuk |
|---|---|---|---|---|
| ZS7 | NHS. Peripheral neuropathy (fő oldal, Causes, Symptoms aloldalak). | `https://www.nhs.uk/conditions/peripheral-neuropathy/` · `/causes/` · `/symptoms/` | felülvizsgálva 2022-10-10, következő 2025-10-10 (LEJÁRT); lekérés 2026-08-25 | „Mit jelent, ha mindkét kezed zsibbad?”: a perifériás idegkárosodás mintázata és kiváltó okai |
| ZS8 | NHS. Peripheral neuropathy, Treatment. | `https://www.nhs.uk/conditions/peripheral-neuropathy/treatment/` | felülvizsgálva 2022-10-10; lekérés 2026-08-25 | „Segít a krém…?”: az idegi eredetű fájdalom nem javul a megszokott fájdalomcsillapítóktól |
| ZS9 | NHS. Vitamin B12 or folate deficiency anaemia (Symptoms és Treatment aloldal). | `https://www.nhs.uk/conditions/vitamin-b12-or-folate-deficiency-anaemia/symptoms/` · `/treatment/` | felülvizsgálva 2023-02-20, következő 2026-02-20; lekérés 2026-08-25 | B12-hiány tünetei és a pótlás mint kezelés (mindkét új szakaszban) |
| ZS10 | NHS. Vitamins and minerals: B vitamins and folic acid. | `https://www.nhs.uk/conditions/vitamins-and-minerals/vitamin-b/` | felülvizsgálva 2020-08-03, következő 2023-08-03 (LEJÁRT); lekérés 2026-08-25 | „Segít a krém…?”: a napi 200 mg-os B6-határ és a napi 10 mg-os ajánlás |
| ZS11 | Singjam A, Charoentanyarak K, Saengsuwan J. Prevalence and predictive factors for bilateral carpal tunnel syndrome by electrodiagnosis. PLoS One. 2021;16(12):e0260578. PMID 34941881. | `https://doi.org/10.1371/journal.pone.0260578` · `https://pubmed.ncbi.nlm.nih.gov/34941881/` | 2021; lekérés 2026-08-25 | Kétoldali kéztőalagút-érintettség egyoldali panasz mellett is (szám nélkül, minőségi állításként) |
| ZS12 | Tetreault L és mtsai. Degenerative Cervical Myelopathy: A Practical Approach to Diagnosis. Global Spine J. 2022;12(8):1881–1893. PMID 35043715. | `https://doi.org/10.1177/21925682211072847` · `https://pubmed.ncbi.nlm.nih.gov/35043715/` | 2022; lekérés 2026-08-25 | A degeneratív cervicalis myelopathia tünetegyüttese |
| ZS13 | Cervellini M és mtsai. Understanding degenerative cervical myelopathy in musculoskeletal practice. J Man Manip Ther. 2025;33(3):207–223. PMID 40035695. | `https://doi.org/10.1080/10669817.2025.2465728` · `https://pubmed.ncbi.nlm.nih.gov/40035695/` | 2025; lekérés 2026-08-25 | A korai szakasz kétoldali kéztőalagútnak látszik, a késedelem visszafordíthatatlan lehet |
| ZS14 | Gibson J és mtsai. Degenerative Cervical Myelopathy: A Clinical Review. Yale J Biol Med. 2018;91(1):43–48. PMID 29599656. | `https://pubmed.ncbi.nlm.nih.gov/29599656/` | 2018; lekérés 2026-08-25 | Háttérforrás a myelopathia-bekezdéshez (a szövegben külön állítást nem alapoz meg) |
| ZS15 | AAOS OrthoInfo. Cervical Spondylotic Myelopathy (Spinal Cord Compression). | `https://www.orthoinfo.org/diseases--conditions/cervical-spondylotic-myelopathy-spinal-cord-compression` | lekérés 2026-08-25 | A myelopathia tünetei betegtájékoztató szinten |
| CTS11 | NICE. Neuropathic pain in adults: pharmacological management in non-specialist settings. Clinical guideline CG173 (1.1.8 és 1.1.11). | `https://www.nice.org.uk/guidance/cg173/chapter/Recommendations` | megjelent 2013-11-20, frissítve 2020-09-22; lekérés 2026-08-25 | Kapszaicin krém körülírt idegi fájdalomnál; a négy kezdő hatóanyag |
| CTS12 | Padua L és mtsai. Systematic review of pregnancy-related carpal tunnel syndrome. Muscle Nerve. 2010;42(5):697–702. PMID 20976778. | `https://doi.org/10.1002/mus.21910` · `https://pubmed.ncbi.nlm.nih.gov/20976778/` | 2010; lekérés 2026-08-25 | A gyakoriság szóródása; a tünetek a szülés után egy évvel is megmaradhatnak (T4 és a terhesség-szakasz) |
| CTS13 | Cîmpeanu MC és mtsai. Management of „De Novo” Carpal Tunnel Syndrome in Pregnancy: A Narrative Review. J Pers Med. 2024;14(3):240. PMID 38540982. | `https://doi.org/10.3390/jpm14030240` · `https://pubmed.ncbi.nlm.nih.gov/38540982/` | 2024; lekérés 2026-08-25 | Terhesség alatt szűkebb eszköztár; gyakori alulértékelés és késői felismerés |
| VZ4 | NHS. Medicines in pregnancy. | `https://www.nhs.uk/pregnancy/keeping-well/medicines/` | felülvizsgálva 2022-09-05, következő 2025-09-05 (LEJÁRT); lekérés 2026-08-25 | Terhesség alatt bármely készítmény előtt szakemberrel egyeztetés |
| VZ5 | NHS. Swollen ankles, feet and fingers in pregnancy. | `https://www.nhs.uk/pregnancy/related-conditions/common-symptoms/swollen-ankles-feet-and-fingers/` | felülvizsgálva 2024-04-19, következő 2027-04-19; lekérés 2026-08-25 | Hirtelen duzzanat mint preeclampsia-jel, azonnali hívás |
| VZ6 | NHS. Heart attack. | `https://www.nhs.uk/conditions/heart-attack/` | felülvizsgálva 2026-03-31, következő 2029-03-31; lekérés 2026-08-25 | A sürgősségi szakasz szív-blokkja: tünetlista és a 112 |
| VZ7 | American Heart Association. Warning Signs of a Heart Attack. | `https://www.heart.org/en/health-topics/heart-attack/warning-signs-of-a-heart-attack` | felülvizsgálva 2024-12-12; lekérés 2026-08-25 | A kisugárzás és a felsőtesti kellemetlen érzés leírása |

Három korábbi tétel új szerepet is kapott, azonosítójuk változatlan: **CTS1**
(NHS Carpal tunnel syndrome, `https://www.nhs.uk/conditions/carpal-tunnel-syndrome/`,
lekérés 2026-08-25) a terhesség mint kockázati tényező és a fájdalomcsillapítók
korlátja; **CTS2** (AAOS CPG,
`https://www.aaos.org/globalassets/quality-and-practice-resources/carpal-tunnel/carpal-tunnel-2024/cts-cpg.pdf`,
elfogadva 2024-05-18, lekérés 2026-08-25) a krém, a szájon át adott szerek és a
táplálékkiegészítés megítélése; **CTS9** (AAOS OrthoInfo Carpal Tunnel Syndrome,
`https://orthoinfo.aaos.org/en/diseases--conditions/carpal-tunnel-syndrome/`,
lekérés 2026-08-25) a kezeletlen kéztőalagút romlása és a tartós kézműködési zavar.

---

## CMS-mezők az integrátornak

Ezek a `docs/tudastar-tartalmi-terv.md` 4. és 6. szakaszában rögzített,
kötelező értékek. A cikkíró nem talált ki belőlük semmit.

| Mező | Érték |
|---|---|
| `title` (H1) | Miért zsibbad a kezem? |
| `slug` | `miert-zsibbad-a-kezem` |
| `seoTitle` | Kéz zsibbadás: okok, éjszakai zsibbadás, teendők otthon |
| `seoDescription` | Kéz zsibbadás okai: melyik ujjad zsibbad, miért éjszaka, mit tehetsz otthon, és mikor sürgős. Gyógytornászok forrásolt összefoglalója. |
| `excerpt` | A kéz zsibbadás tünet, nem diagnózis: sokféle ok állhat mögötte. Megmutatjuk, mit jelezhet a mintázat, mit tehetsz otthon, és mikor kell orvoshoz fordulni. |
| Kategória | Kéz és csukló (`kez-es-csuklo`) |
| `author` | Kiss Kata (gyógytornász, manuálterapeuta, sportrehabilitációs tréner) |
| `publishedAt` | `2026-09-01T08:00:00.000Z` |
| `status` / `_status` | `draft` / `draft` |
| `relatedPosts` | `keztoalagut-szindroma`, `csuklo-es-kezfajdalom`, `csuklotores-utani-gyogytorna` |
| `heroImage`, `ogImage` | üresen marad |

---
---

# Miért zsibbad a kezem?

Ez a szöveg lektorálandó vázlat. A két gyógytornász szakmai jóváhagyása előtt
nem publikálható.

Felébredsz éjjel, mert elzsibbadt a kezed. Megrázod, és lassan visszatér az
érzés. Reggelre elmúlik, másnap éjjel újra kezdődik.

Zsibbadásnál könnyű halogatni a kivizsgálást, mert nem fáj annyira, hogy
sürgősnek érezd.

Végigmegyünk azon, mit jelezhet a zsibbadás, mit tehetsz otthon, és mikor kell
orvoshoz fordulni. Diagnózist nem adunk: azt vizsgálat nélkül nem lehet.

## Előbb ezt: mikor kell azonnal mentőt hívni?

Van néhány jel, aminél nem cikket kell olvasni, hanem a 112-t hívni. Ezért áll
ez a szakasz elöl, és nem a végén.

**Stroke jelei.** Lelóg az arc egyik fele, erőtlen vagy zsibbadt az egyik kar,
akadozik a beszéd. Ugyanígy sürgős a test egyik oldalára kiterjedő erőtlenség
vagy zsibbadás, a homályos látás, a hirtelen erős fejfájás és a szédülés.
Ilyenkor azonnal hívj mentőt, Magyarországon a 112-t.

Ezt külön ki kell emelni: ha a stroke jelei már el is múltak, de 24 órán belül
megvoltak, akkor is azonnali segítség kell.

**Ha a kartünet mellé mellkasi panasz társul.** Szorító vagy nyomó mellkasi
fájdalom, légszomj, hányinger vagy hányás, hideg verejtékezés, gyomorégésszerű
érzés, sápadt, kékes vagy szürkés bőr: ezek együtt szívinfarktus gyanúját
jelentik, és ilyenkor azonnal a 112-t kell hívni. A mellkasi panasz kisugározhat
a karba, a nyakba és az állkapocsba, és a felsőtesti kellemetlen érzés az egyik
vagy mindkét karban, a hátban, a nyakban, az állkapocsban és a gyomorszájban is
jelentkezhet, akár szokatlan fáradtsággal vagy szédüléssel együtt.

Egy pontosítást ide is ki kell tenni, mert enélkül félrevezető lenne. A szakmai
források a karra vonatkozóan **fájdalmat vagy kellemetlen érzést** írnak le, nem
zsibbadást. Nem azt mondjuk tehát, hogy a zsibbadó bal kéz infarktust jelent.
Azt mondjuk, hogy ha a kartünet mellé mellkasi nyomás, légszomj, hányinger vagy
hideg verejték társul, akkor nem a kezet kell nézni, hanem hívni kell a 112-t.
Ezt telefonon percek alatt eldöntik, egy cikkből nem lehet.

**Sérülés után.** Négy jelnél kell mentőt hívni:

- a sérült kar vagy csukló zsibbad, bizsereg,
- erősen vérző seb van rajta,
- a csont kiáll a bőrből,
- a kar vagy a csukló alakja megváltozott.

Ez a szakasz a sürgős eseteket sorolja. Amikor nem sürgős, de orvos kell, azt a
„Mikor fordulj azonnal orvoshoz?” és a „Mikor kell kivizsgálás, ha nem sürgős?”
szakaszban szedtük össze.

## Mit jelent, ha zsibbad a kezed?

A zsibbadás tünet, nem diagnózis. Sokféle, egymástól nagyon távoli ok állhat
mögötte, és ezek nem ugyanazt a kezelést igénylik.

A szakirodalom lehetséges okként sorolja fel a cukorbetegséget, a
Raynaud-jelenséget, a hiperventillációt, az isiászt és a sclerosis multiplexet.
A tartósan megmaradó zsibbadás okai között a nyakban vagy a hátban becsípődött
ideget is nevesíti.

Az okok egy részénél az ideg nyomás alá kerül. A kéztőalagút-szindróma például a
középideg nyomás okozta károsodása, és jellemzően a hüvelyk-, a mutató- és a
középső ujjban okoz fájdalmat, zsibbadást, bizsergést.

Egy mondatot külön ki kell emelni: „ne diagnosztizáld magad,
menj háziorvoshoz, ha aggódsz”. Mi is így gondoljuk. Az alábbi mintázatok tájékozódásra valók,
nem öndiagnózisra.

## Melyik ujjad zsibbad? A mintázat sokat elárul

Az érintett ujjak mintázata szűkíti a lehetséges okok körét, de önmagában nem
elég a diagnózishoz.

**A hüvelyk, a mutató és a középső ujj.** A
kéztőalagút-szindróma zsibbadása elsősorban a hüvelyk-, a mutató-, a középső és
a gyűrűsujjat érinti. Erről az állapotról külön cikkben írtunk, ott a nem műtéti
lehetőségeket is végigvesszük a
[kéztőalagút-szindrómáról szóló összefoglalónkban](/blog/keztoalagut-szindroma).

**A gyűrűs- és a kisujj.** A könyöknél becsípődő singideg leggyakoribb tünete
éppen ez: időszakos zsibbadás és bizsergés a gyűrűs- és a kisujjban. Ez a felső
végtag második leggyakoribb perifériás idegbecsípődése.

**Az egész kar.** A nyaki gerincből kiinduló idegi panasz jellemzően nyak- vagy
karfájdalommal jelentkezik. Fontos kiemelni, hogy ezt el kell
különíteni a perifériás idegbecsípődésektől és a vállpanaszoktól.

Figyelj a gyűrűsujjra: a jellemző tünetek közt és a singideg panaszainál is szerepel.
Vagyis a mintázat nem döntési fa. Irányt ad, de a vizsgálatot nem pótolja.

## Miért zsibbad a kezed éjszaka?

Az éjszaka erősödő kézzsibbadás a kéztőalagút-szindróma jellegzetes mintázata.

A kéztőalagút-szindróma tünetei lassan indulnak, jönnek-mennek, és
éjjel a legerősebbek.

Ennél pontosabban: a tünetek gyakran felébresztik
az embert, és sokaknál a kéz mozgatása vagy rázogatása enyhíti őket. Ugyanitt
szerepel az ügyetlenség és a tárgyak elejtése is.

Ez ismerős lehet, de nem bizonyíték. Az éjszakai zsibbadásnak más oka is lehet,
és itt is óvatosnak kell lenni az öndiagnózissal. Ha a mintázat rád illik, a részleteket megtalálod a
[kéztőalagút-szindrómáról szóló cikkünkben](/blog/keztoalagut-szindroma).

## Számít, hogy a bal vagy a jobb kezed zsibbad?

Önmagában az oldal ritkán mondja meg az okot.

A lehetséges okok közül egyik sem az oldaltól függ. Cukorbetegség,
Raynaud-jelenség, becsípődött ideg, gyógyszermellékhatás: mindegyik
jelentkezhet a bal és a jobb kézen is.

Egy kivétel viszont van, és ez életmentő. Ha a zsibbadás hirtelen kezdődik a
test egyik oldalán, és mellette lelóg az arc egyik fele, erőtlen a kar vagy
akadozik a beszéd, az stroke gyanúja. Ilyenkor azonnal a 112-t kell hívni,
ahogy a cikk elején is írjuk.

## Mit jelent, ha mindkét kezed zsibbad?

Ha mindkét kezed zsibbad, az inkább egy egész testre kiterjedő ok felé mutat,
mint egyetlen becsípődött ideg felé, és emiatt mindig orvosi kivizsgálást
igényel. Ez nem azt jelenti, hogy súlyos. Azt jelenti, hogy a kétoldali
mintázatot otthon nem lehet lezárni.

A perifériás idegkárosodás a végtagok idegeit érinti, tehát a kezet, a lábfejet
és a kart. A leggyakoribb formája a leghosszabb idegeket támadja meg elsőként,
ezért a tünetek jellemzően a lábfejen indulnak, majd felfelé terjedve később
érik el a kezet. Az Egyesült Királyságban a leggyakoribb kiváltó ok a
cukorbetegség, de a B12-vitamin hiánya, a pajzsmirigy alulműködése, a tartós
túlzott alkoholfogyasztás és több gyógyszercsoport is okozhatja.

A B12-hiány külön említést érdemel, mert pontosan ilyen panaszt csinál:
zsibbadás, bizsergés, izomgyengeség, valamint egyensúly- és
koordinációs zavar. Ez az egyetlen olyan ok a listán, amit egy
vérvétel egyértelműen tisztáz, ezért érdemes róla a háziorvosnál szóba hozni.

Kétoldali lehet maga a kéztőalagút-szindróma is. Egy visszatekintő
elektrodiagnosztikai vizsgálat szerint azoknál is gyakran mindkét oldalon
kimutatható, akik csak az egyik kezükre panaszkodnak. Vagyis a kétoldaliság
önmagában nem zárja ki a csuklót, csak nem is bizonyít semmit.

Van viszont egy mintázat, amit érdemes ismerni, mert a szakirodalom szerint
gyakran késve ismerik fel. A nyaki gerincvelő fokozatos nyomás alá kerülésének
(degeneratív cervicalis myelopathia) jellemző tünetegyüttese a **kétoldali
kézzsibbadás és bizsergés**, az ügyetlenség a finom mozgásokban (gombolás,
kézírás, evés), a járás és az egyensúly romlása, valamint súlyosabb esetben a
hólyagműködés zavara. A szakirodalom kiemeli, hogy ez korai szakaszában
**kétoldali kéztőalagút-szindrómának néz ki**, gyakran tévesen
diagnosztizálják, és a késedelem visszafordíthatatlan idegi következményekkel
járhat.

Ezért a gyakorlati szabály egyszerű. Ha mindkét kezed zsibbad, az kivizsgálás.
Ha mellette a járásod, az egyensúlyod vagy a finom kézmozgásod is romlik, akkor
nem érdemes két hetet várni, azzal menj orvoshoz.

## Mi okozhat még zsibbadást?

A zsibbadásnak sok oka lehet, és nem mind a kézben keresendő.

Lehetséges okok a következők.

- Cukorbetegség.
- Raynaud-jelenség, ha az ujjaid színt is váltanak.
- Hiperventilláció, ha kapkodó légzés és remegő kéz kíséri.
- Isiász, ha a hátból a lábba sugárzik.
- Sclerosis multiplex, ha a test több pontján jelentkezik.

A tartósan megmaradó zsibbadásnál ezek jöhetnek szóba.

- Kemoterápia.
- Egyes gyógyszerek: HIV-gyógyszer, görcsgátló, bizonyos antibiotikumok.
- Mérgező anyagok, például ólom és sugárzás.
- Rossz táplálkozás.
- A hátban vagy a nyakban becsípődött ideg.
- Sérülés vagy betegség utáni idegkárosodás.
- Túlzott alkoholfogyasztás.

A könyöknél becsípődő singideg is okozhat zsibbadást. Az éjszakai sín itt gyakori
javaslat, a bizonyíték viszont gyenge.

Az eddigi kutatás egyetlen olyan vizsgálatot
talált, amely a sínt kontrollcsoporthoz hasonlította. Ez a vizsgálat magas
torzítási kockázatú volt, és nem talált különbséget a csoportok között.

Egy további randomizált és három kontrollcsoport nélküli vizsgálat enyhe és
közepes eseteknél javulást írt le az éjszakai sín mellett. Ezek is magas, súlyos
vagy kritikus torzítási kockázatúak, és a szerzők kiírják: nem tudni, hogy a
javulás a kezeléstől vagy pusztán az idő múlásától volt-e.

A bizonyosság szintje nagyon alacsony, és a
szerzők szerint jelenleg nem eldönthető, ajánlható-e az éjszakai sín ennél az
állapotnál.

### Tényleg a sok gépeléstől van?

A sok billentyűzethasználat és a kéztőalagút-szindróma összefüggése nem igazolt.

A mai szakmai álláspont: megbízható bizonyíték hiányában a
munkacsoport véleménye szerint nincs összefüggés a sok billentyűzethasználat és a
kéztőalagút-szindróma között. A bizonyíték minőségét itt nagyon alacsonynak
jelölik, az ajánlás pedig szakértői konszenzus.

Ez fontos különbség. Nem azt jelenti, hogy bizonyítottan nincs kapcsolat. Azt
jelenti, hogy megbízható vizsgálat egyik irányban sem áll rendelkezésre.

## Zsibbad a kezed a terhesség alatt?

A terhesség alatti kézzsibbadás leggyakoribb hátterében a kéztőalagút-szindróma
áll, és az első lépés itt is az éjszakai csuklósín, nem a gyógyszer. A terhesség
név szerint szerepel a kéztőalagút-szindróma kockázati tényezői között.

Arról, hogy ez mennyire gyakori, egyetlen számot nem lehet felelősen kimondani.
Egy szisztematikus áttekintés szerint a közölt gyakoriság rendkívül széles
sávban szóródik, és a szóródás nagyrészt abból jön, hogy a vizsgálatok
mennyire eltérő módon állapították meg a diagnózist. Ugyanez az áttekintés egy
másik dolgot is kimond, és ez a fontosabb: a panasz a szülés után egy évvel is
megmaradhat. Vagyis a „majd a szülés után elmúlik” nem megbízható terv.

Terhesség alatt szűkebb az eszköztár, mint egyébként. A témát összefoglaló
áttekintés szerint a kezelési lehetőségek körét egyszerre szűkíti a kismama
élettani állapota és az, hogy a panasz a szülés utáni időszakban kezelés nélkül
is rendeződhet. Ugyanez a munka viszont figyelmeztet arra is, hogy a
kéztőalagút-szindrómát terhesség alatt gyakran alulértékelik és későn ismerik
fel, mert a tüneteket a terhesség szokásos velejárójának veszik, a késedelmes
vagy elmaradó ellátás pedig tartós idegkárosodáshoz vezethet.

Ami a krémet, a fájdalomcsillapítót és a vitamint illeti, terhesség alatt
kétszeresen igaz, amit erről a cikkben írunk. A szabály egyszerű: a terhesség
alatt szedett gyógyszerek nagy része átjut a méhlepényen, ezért bármit veszel
be, akár vény nélkülit is, előtte kérdezd meg a gyógyszerészt, a szülésznőt
vagy az orvost. Ugyanez vonatkozik a gyógynövényes és a „természetes”
készítményekre is.

**És egy jel, ami nem várhat.** A terhesség alatti duzzadás a lábszáron, a
bokán, a lábfejen és az ujjakon önmagában szokásos. Ha viszont az arcod, a
kezed vagy a lábfejed duzzanata **hirtelen** megnő, az a preeclampsia jele
lehet, és azonnal szólnod kell. Ilyenkor a szülésznő, a háziorvos vagy a
szülészet azonnali hívása a teendő, különösen ha erős fejfájás, látászavar,
bordák alatti fájdalom vagy nagyon rossz közérzet kíséri.

## Mit lehet tenni kézzsibbadás ellen otthon?

Az első lépés a terhelés csökkentése és a csukló kímélő tartása. A
kéztőalagút-eredetű zsibbadásnál pedig az éjszakai csuklósín az, amire a
legtöbb bizonyíték van.

### Az éjszakai csuklósín: erre van bizonyíték

Első lépésként a csuklósín jön szóba, és érdemes tudni a valós időigényt is:
akár 6 hetet is viselni kell, mire javulni kezd.

Az eddigi vizsgálatok összesítéséből a következő rajzolódik ki.
Az éjszakai sín viselése rövid távon gyakrabban járt együtt általános javulással,
mint a kezelés nélküliség. Ez az eredmény viszont egyetlen, 80 fős vizsgálatból
származik, és a bizonyosság szintje alacsony, tehát irányt mutat, nem eredményt
ígér.

A tünetskálán mért javulás viszont kicsi. A Boston-kérdőív tünetskáláján 0,37
pont a sín javára, a megbízhatósági tartomány 0,82 ponttal jobb és 0,08 ponttal
rosszabb között. Ez a klinikailag érdemi 1 pontos küszöb alatt marad, alacsony
bizonyossági szinttel.

A szerzői következtetés első mondatával kell kezdeni, mert az a fejmondat.
Nincs elég bizonyíték annak eldöntésére, használ-e a sín a
kéztőalagút-szindrómában szenvedőknek.

A korlátozott bizonyíték a tünetek és a kézfunkció kis javulását nem zárja ki, de
ez a javulás lehet, hogy klinikailag nem érdemi.

És csak ezután jön a mondat, amit sokat idéznek. A sín olcsó beavatkozás, tartós
ártalma nem ismert, ezért a kis hatás is indokolhatja a használatát, különösen
annál, aki nem szeretne műtétet vagy injekciót.

A kettő együtt adja ki a valós képet. Nem tudjuk, hogy használ-e, de olcsó és
ártalmatlan, tehát megpróbálható.

Egyet viszont nem ígérhetünk. Bizonytalan, hogy
a sín csökkenti-e a műtétre küldés arányát: a bizonyosság szintje itt nagyon
alacsony. A sín tehát nem műtét-elkerülő
eszköz, hanem egy megpróbálható lépés a döntés előtt.

### Idegsiklató gyakorlatok: kiegészítő, nem megoldás

Az idegsiklató gyakorlatok kiegészítőként jönnek szóba, korlátozott
bizonyítékkal.

A nem műtéti lehetőségek közé tartoznak azok a gyakorlatok, amelyek a középideg
szabadabb mozgását támogatják; egyes pácienseknek ezek segíthetnek.

Egy 13 klinikai vizsgálatot áttekintő munka óvatosabb. A szerzők szerint a
fájdalom csökkentésére a szokásos konzervatív ellátás tűnik a legmegfelelőbbnek.
Az idegsiklatás inkább kiegészítő, amely gyorsíthatja a funkció visszatérését.

A 13 vizsgálatból 6 gyenge minőségűnek bizonyult.

### Amit a gyakorlatokról őszintén el kell mondanunk

A gyakorlatozás a jelenlegi bizonyíték szerint nem javítja a
kéztőalagút-szindróma hosszú távú, páciens által jelentett eredményét.

A 2024-es kéztőalagút-irányelv magas minőségű bizonyíték alapján sorol fel
olyan nem műtéti módszereket, amelyek nem javítják a páciens által jelentett
hosszú távú eredményt. Ezen a listán a gyakorlatozás, a masszázs és a manuálterápia is
szerepel.

Az érem másik oldalát is kiírjuk. Ez az ajánlás gyengébb lábakon áll, mert a
vizsgált kezelések, a módszerek minősége és az utánkövetési idők nagyon
eltérőek voltak.

Azt is fontos tudni, hogy a konzervatív módszerek között nincs
jelentős különbség a páciens által jelentett eredményekben.

Ezt nem hallgatjuk el, mert a döntésed a tiéd. A rendezett otthoni gyakorlás
attól még segíthet a tünetek kezelésében és a terhelés átalakításában. Aki egy
rövid, vezetett kezdéssel indulna, annak belépő az ingyenes
[SOS Kézrelax villámkurzusunk](/kurzusok/sos-kezrelax-villamkurzus). A
villámkurzusban látod, mit vizsgálunk mi az egyes kórképeknél. Ezek tájékozódásra
valók: a diagnózist orvosi vizsgálat adja meg, nem egy otthon elvégzett teszt.

## Segít a krém, a gyógyszer vagy a B-vitamin a kézzsibbadásra?

> **Fontos keret, ezt a szakaszt így kell olvasni.** Nem árulunk gyógyszert,
> krémet és étrend-kiegészítőt, és nem is ajánlunk konkrét készítményt. Az
> alábbi rész arról szól, mit mond ezekről a szakirodalom, mikor van értelmük,
> és mikor nincs.

A ma elérhető bizonyíték szerint sem a külsőleges krém, sem a szokásos
fájdalomcsillapító, sem a vitaminkészítmény nem hoz tartós javulást a
kézzsibbadásban, a B6-vitamin pedig nagy adagban maga is okozhat zsibbadást.
Ettől még nincs mindegyik pontban ugyanaz a helyzet, ezért végigvesszük őket
külön.

**A krém.** A 2024-es kéztőalagút-irányelv név szerint felsorolja a külsőleges
készítményt azok között a nem műtéti módszerek között, amelyek magas minőségű
bizonyíték szerint **nem javítják a beteg által jelentett hosszú távú
eredményt**. Van egy szűk kivétel, de az nem a zsibbadásról szól: az idegi
eredetű fájdalomra írt irányelv **körülírt idegi eredetű fájdalomnál**
mérlegelhetőnek mondja a kapszaicin krémet annál, aki a szájon át szedett
szereket kerülné vagy nem tolerálja. Ez tehát fájdalomra szóló, orvos által
mérlegelt lehetőség, nem a zsibbadás elleni patikai vásárlás.

**A fájdalomcsillapító.** A paracetamol vagy az ibuprofen a kéztőalagút
okozta fájdalmon rövid távon segíthet, de a szakirodalom kiírja: kevés
bizonyíték szól amellett, hogy a panasz **okát** kezelnék, ezért nem szabad
rájuk támaszkodni. Ha a panasz idegi eredetű, ez még hangsúlyosabb: az idegi
eredetű fájdalom általában nem javul a megszokott fájdalomcsillapítóktól, ezért
ott más gyógyszercsoportokat használnak.

**A vényköteles idegi fájdalomcsillapítók.** Ezekről érdemes tudni, hogy
léteznek, és azt is, hogy nem otthoni döntések. Az idegi eredetű fájdalomra írt
irányelv négy szert nevez meg kezdő kezelésként: amitriptilin, duloxetin,
gabapentin vagy pregabalin. Mindegyik vényköteles, az adagolásuk és a
mellékhatásaik miatt orvosi felügyelet kell hozzájuk, és a zsibbadás mint tünet
önmagában nem is feltétlenül fájdalom. A kéztőalagút-irányelv ehhez hozzáteszi,
hogy kéztőalagút-szindrómában a szájon át adott gyulladáscsökkentő, a görcsgátló
és a vízhajtó **nem bizonyult jobbnak a kontrollnál vagy a placebónál**, a
szájon át adott kortikoszteroid pedig nem javítja a hosszú távú eredményt.

**A vitamin.** Ugyanez az irányelv a táplálékkiegészítést is azon a listán
szerepelteti, amelynek elemei nem bizonyultak jobbnak a kontrollnál vagy a
placebónál. Egyetlen helyzetben más a kép: ha tényleg **hiány** áll fenn. A
B12-vitamin hiánya valóban okoz zsibbadást, bizsergést, izomgyengeséget és
egyensúlyzavart, és ilyenkor a pótlás a kezelés, injekcióval vagy tablettával,
a hiány okától függően. A különbség lényeges: ezt vérvétel dönti el, nem tipp.

**És egy dolog, amit a legfontosabbnak tartunk ebben a szakaszban.** A
B6-vitaminból napi 200 mg vagy annál több szedése **maga is okozhat**
érzéskiesést a karban és a lábban, ezt hívják perifériás neuropátiának. Az
általános ajánlás: étrend-kiegészítőből ne szedj napi 10 mg-nál több
B6-vitamint, hacsak orvos nem mondja. Vagyis a zsibbadásra „vitamint bevenni”
nemcsak hogy nem biztos, hogy használ, hanem rosszul adagolva pont azt a
panaszt hozhatja létre, ami miatt keresed.

Amit ebből haza lehet vinni: a kézzsibbadásnak nincs patikában levehető
megoldása. Ami helyette van, az az ok tisztázása, a terhelés csökkentése,
kéztőalagút-gyanúnál az éjszakai csuklósín, és ha a panasz két hét otthoni
kezelés után sem javul, kivizsgálás.

### Amit a terhelésen változtathatsz

A fájdalmat vagy zsibbadást kiváltó tevékenység csökkentése az egyik első
javasolt lépés.

Ezeket érdemes kipróbálni.

- Pihentesd a csuklódat.
- Mozgasd finoman a kezed és a csuklód.
- Hagyd abba vagy csökkentsd a panaszt okozó tevékenységet. Ilyen lehet a
 gépelés, a rezgő szerszám vagy a hangszeres játék.
- Viselj sínt, főleg éjszakára.

Azt is érdemes tudni, hogy a gyógyszerész tud segíteni a fájdalomcsillapító és a
sín kiválasztásában, és abban is, kell-e orvoshoz menned. Ez alacsony küszöbű, gyors lépés.

## Mikor NE végezd a gyakorlatokat?

Ne gyakorolj, ha az alábbi jelek bármelyike fennáll. Ilyenkor a vizsgálat az első.

- **Vörös zászlót látsz.** Stroke jeleinél, friss sérülés utáni zsibbadásnál vagy
 megszűnt érzésnél nem gyakorlat kell, hanem orvos vagy mentő.
- **Éles fájdalom kísér.** A gyakorlatok nem kell, hogy fájjanak. Éles fájdalom
 esetén hagyd abba, és kérj szakmai segítséget. Ez a saját kurzusaink
 ellenjavallati szabálya is.
- **Műtéted volt.** Műtét után mindig a kezelőorvosod vagy gyógytornászod
 jóváhagyásával kezdj bele.
- **Friss sérülés után vagy.** A sérülést követő első 2–3 napban kerülendő a
 melegítő pakolás és a forró fürdő. Nehezet emelni és erősen szorítani sem
 szabad.

A sín sem mindenkinél kellemetlenségmentes. Az összesített vizsgálatok egyik
vizsgálatában a sínt viselő 40 résztvevőből 7 számolt be múló
mellékhatásról, a kezelés nélküli csoportban egy sem. A bizonyosság szintje itt
alacsony, és a megbízhatósági tartomány a hatás hiányát is magában foglalta.

## Mikor fordulj azonnal orvoshoz?

Hívj mentőt (112), ha a zsibbadás mellett stroke jelei mutatkoznak, vagy ha
sérülés után zsibbad a karod.

### Stroke jelei: azonnal 112

Stroke gyanújánál a mentőhívás nem várhat.

- Lelóg az arc egyik fele, erőtlen vagy zsibbadt az egyik kar, akadozik a beszéd.
- Erőtlenség vagy zsibbadás a test egyik oldalán, homályos látás, hirtelen erős
 fejfájás, szédülés.

Fontos: ha a stroke tünetei már elmúltak, de 24 órán belül megvoltak,
akkor is azonnali segítség kell.

### Sérülés után: ezeknél is mentő kell

Sérülés után az alábbi négy jelnél kell mentőt hívni.

- A sérült kar vagy csukló zsibbad, bizsereg.
- Erősen vérző seb van rajta.
- A csont kiáll a bőrből.
- A kar vagy a csukló alakja megváltozott, vagy szokatlan szögben áll.

### Aznap orvos vagy ügyelet

Ezeknél a jeleknél még aznap ellátás kell.

- A kéz egy részén vagy egészén megszűnt az érzés.
- Erős csuklófájdalom ájulásérzéssel, hányingerrel, lázzal vagy hidegrázással.
- A csukló alakja vagy színe megváltozott.
- A csuklódon lévő csomó nagyon fájdalmas, forró vagy piros.
- Reccsenő, csikorgó vagy pattanó hangot hallottál a sérüléskor.
- Nem tudod mozgatni a csuklód, vagy nem tudsz megfogni semmit.

## Mikor kell kivizsgálás, ha nem sürgős?

Bármilyen tartósan megmaradó bizsergés vagy érzéskiesés a kézen orvosi
kivizsgálást igényel.

Ezek a helyzetek jellemzőek.

- Bármilyen bizsergés vagy érzéskiesés a kézen.
- Két hét otthoni kezelés után sem javuló panasz.
- Cukorbetegség mellett jelentkező kézpanasz, mert ilyenkor a kézproblémák
 komolyabbak lehetnek.

Ezekhez jön még három jel, ami nem sürgős, de nem is halogatható: ha gyengül a
szorításod, ha egyre gyakrabban ejtesz el tárgyakat, vagy ha a hüvelykujj tövén
lévő párnás rész látványosan lelapult. Ilyenkor már nem a tünetről van szó,
hanem a működésről.

Ennek egyszerű oka van. A szakirodalom szerint a kéztőalagút-szindróma a
legtöbb embernél idővel rosszabbodik, és ha túl sokáig marad kezeletlen, tartós
kézműködési zavarhoz vezethet, beleértve az ujjak érzéskiesését és a
gyengeséget. Ez nem ijesztgetés, hanem a „majd elmúlik” ellensúlya.

Ha mindkét kezed zsibbad, arról fentebb külön írtunk, és az mindenképp
kivizsgálás. Ha pedig várandós vagy, arra is van külön szakaszunk.

Fontos tudni, hogy a kéztőalagút-szindróma tüneteivel orvoshoz kell
fordulni, ha romlanak vagy nem múlnak.

A szakirodalom szerint a kéztőalagút-szindróma néha magától rendeződik néhány
hónap alatt, különösen akkor, ha terhesség miatt alakult ki. Ez viszont nem
szabály. A terhességhez kötődő panaszt vizsgáló szisztematikus áttekintés
szerint a tünetek a szülés után egy évvel is megmaradhatnak, ezért a „majd
elmúlik” nem indok a kivizsgálás halasztására.

Ha a fájdalom is társul a zsibbadáshoz, arról külön írtunk a
[csukló- és kézfájdalomról szóló cikkünkben](/blog/csuklo-es-kezfajdalom). Ha
pedig törés vagy gipsz után indulnál újra, a
[csuklótörés utáni gyógytornáról szóló összefoglalónk](/blog/csuklotores-utani-gyogytorna)
segít.

## Hogyan tovább, ha a kivizsgálás nem talált sürgős okot?

Ilyenkor a rendezett, fokozatosan felépített otthoni gyakorlás a következő lépés.

Kiss Kata és Kocsis Kata vagyunk, gyógytornászok és sportrehabilitációs trénerek.
Évek óta elsősorban a kéz rehabilitációjával foglalkozunk.

Otthon jellemzően nem a kitartás hiányzik. A sorrend és az adagolás az, ami
nehéz egyedül.

Az [Otthoni KézRehab Program](/kurzusok/otthoni-kezrehab-program) pontosan ezt a
hiányt tölti be. Csukló-, ujj-, alkar- és könyökpanaszokra állítottuk össze:
4 modulnyi videóanyag, 50+ videós gyakorlat, 5 perces miniblokkokban.

Ha nem tudsz rendelői alkalmakra járni, ezt otthon, a saját tempódban végezheted.
Nincs időpont, nincs bérlet, és bármikor visszanézheted.

**Vásárlás előtt ezt tudnod kell, és pont ennek a cikknek az olvasóira
tartozik.** A program leírásában szerepel, hogy nem javasoljuk, ha:

- már jelentkezett érzéskiesés,
- régebb óta tart jelentős gyengülés a szorítóerődben,
- izomtömeg-vesztés látszik a tenyereden,
- műtétre vársz.

Ilyenkor előbb a kivizsgálás következik, nem a gyakorlás.

Amit nem ígérünk: nem gyógyítunk meg, és nem váltjuk ki a műtéti döntést.
A kurzus nem helyettesíti a szakorvosi vizsgálatot és a kontrollt. Ha a
kivizsgálás sürgős okot talál, azt kell követni.

## Állítás és forrás: a cikkíró öntesztje

A `docs/tudastar-tartalmi-terv.md` 5.8/2. pontja tételes öntesztet ír elő. Minden
klinikai állítás egy sor. Forrás nélküli klinikai állítás: **0 darab**.

| # | Állítás a cikkben | Forrás | Szám szó szerint egyezik? |
|---|---|---|---|
| 1 | A zsibbadás lehetséges okai: cukorbetegség, Raynaud, hiperventilláció, isiász, sclerosis multiplex | ZS1 | nincs szám |
| 2 | Tartós zsibbadás okai: kemoterápia, HIV-gyógyszer, görcsgátló, antibiotikum, ólom, sugárzás, rossz táplálkozás, becsípődött ideg, idegkárosodás, alkohol | ZS1 | nincs szám |
| 3 | „Ne diagnosztizáld magad, menj háziorvoshoz, ha aggódsz” | ZS1 | idézet, tartalmi fordítás |
| 4 | A kéztőalagút-szindróma a középideg nyomás okozta károsodása, jellemzően a hüvelyk-, mutató- és középső ujjban | CTS3 (háttérszakasz) | nincs szám |
| 5 | A CTS zsibbadása elsősorban a hüvelyk-, mutató-, középső és gyűrűsujjat érinti | CTS9 | nincs szám |
| 6 | A singideg-becsípődés leggyakoribb tünete időszakos zsibbadás a gyűrűs- és kisujjban | ZS5 | nincs szám |
| 7 | A singideg-becsípődés a felső végtag második leggyakoribb perifériás idegbecsípődése | ZS5 | „második” egyezik |
| 8 | A nyaki eredetű panasz nyak- vagy karfájdalommal jelentkezik, és el kell különíteni a perifériás becsípődésektől és a vállpanaszoktól | ZS3 | nincs szám |
| 9 | A CTS tünetei lassan indulnak, jönnek-mennek, éjjel a legerősebbek | CTS1 | nincs szám |
| 10 | A tünetek gyakran felébresztik az embert; a kéz rázogatása sokaknál enyhíti; ügyetlenség, tárgyak elejtése | CTS9 | nincs szám |
| 11 | Stroke-jelek: arclelógás, kar erőtlensége, akadozó beszéd; azonnal mentő | VZ1 | nincs szám |
| 12 | Ha a stroke tünetei 24 órán belül voltak, akkor is azonnali segítség kell | VZ1 | 24 óra egyezik |
| 13 | Stroke egyéb jelei: egyoldali erőtlenség vagy zsibbadás, homályos látás, hirtelen erős fejfájás, szédülés | VZ1 | nincs szám |
| 14 | Az éjszakai sín bizonyítéka a singideg-becsípődésnél: egyetlen RCT, magas torzítási kockázat, nagyon alacsony bizonyosság, nem eldönthető | ZS6 | „egyetlen” egyezik |
| 15 | A sok billentyűzethasználat és a CTS összefüggése nem igazolt; munkacsoporti konszenzus, nagyon alacsony bizonyítékminőség | CTS2 | „Very Low”, „Consensus” egyezik |
| 16 | A csuklósínt akár 6 hétig kell viselni, mire javulni kezd | CTS1 | 6 hét egyezik |
| 17 | Cochrane: 29 vizsgálat, 1937 felnőtt | CTS3 | 29 és 1937 egyezik |
| 18 | Éjszakai sín kontra semmi: a sín rövid távon gyakrabban járt együtt általános javulással; 1 vizsgálat, 80 fő, alacsony bizonyosság, ezért irányt mutat, nem eredményt ígér | CTS3 | 1 vizsgálat és 80 fő egyezik; a hatásmérték (RR 3,86, 95% CI 2,29–6,51) a forrásban áll, a cikkszövegben már nem |
| 19 | Boston tünetskála: 0,37 pont a sín javára (95% CI 0,82 jobb és 0,08 rosszabb között), az 1 pontos küszöb alatt, alacsony bizonyosság | CTS3 | mind egyezik |
| 20 | A szerzők következtetése: olcsó, tartós ártalom nélküli beavatkozás, a kis hatás is indokolhatja, főleg annál, aki nem akar műtétet vagy injekciót | CTS3 | idézet, tartalmi fordítás |
| 21 | Bizonytalan, hogy a sín csökkenti-e a műtétre küldést; nagyon alacsony bizonyosság | CTS3 | egyezik |
| 22 | Sín-mellékhatás: 40-ből 7 múló panasz, a kontrollcsoportban 0; alacsony bizonyosság, a CI a hatás hiányát is tartalmazta | CTS3 | 40, 7 és 0 egyezik; a százalékos alak (18%) a cikkszövegből kikerült |
| 23 | Az AAOS OrthoInfo szerint egyes pácienseknek segíthetnek a középideg mozgását támogató gyakorlatok | CTS9 | nincs szám |
| 24 | Idegsiklatás: 13 vizsgálat, ebből 6 gyenge minőségű; a szokásos konzervatív ellátás tűnik a legjobbnak a fájdalomra; az idegsiklatás kiegészítő | CTS10 | 13 és 6 egyezik |
| 25 | Az AAOS 2024 magas minőségű bizonyítékra hivatkozva sorolja a gyakorlatozást, a masszázst és a manuálterápiát azok közé, amelyek nem javítják a hosszú távú, páciens által jelentett eredményt | CTS2 | „High” egyezik |
| 26 | Az AAOS 2024 szerint a konzervatív módszerek között nincs jelentős különbség a páciens által jelentett eredményekben | CTS2 | egyezik |
| 27 | NHS otthoni tanács: pihentetés, finom mozgatás, a panaszt okozó tevékenység csökkentése (gépelés, rezgő szerszám, hangszer), éjszakai sín | VZ2/CSF1 | nincs szám |
| 28 | A gyógyszerész segít a fájdalomcsillapító és a sín kiválasztásában, és abban, kell-e orvos | VZ2/CSF1 | nincs szám |
| 29 | Sérülés után az első 2-3 napban nincs melegítés és forró fürdő, nincs nehézemelés és erős szorítás | VZ2/CSF1 | 2-3 nap egyezik |
| 30 | Sérülés utáni zsibbadás vagy bizsergés, kiálló csont, alak- vagy szögváltozás: MENTŐHÍVÁS szintje | VZ3 | nincs szám |
| 31 | Megszűnt érzés a kézen; erős fájdalom ájulásérzéssel, hányingerrel, lázzal; alak- vagy színváltozás; nagyon fájdalmas, forró, piros csomó a csuklón; reccsenő hang a sérüléskor; mozgathatatlan csukló: aznapi ellátás | VZ2 | nincs szám |
| 32 | Bármilyen bizsergés vagy érzéskiesés a kézen orvosi kivizsgálást igényel | VZ2 | nincs szám |
| 33 | Két hét otthoni kezelés után sem javuló panasznál orvos kell | VZ2 | 2 hét egyezik |
| 34 | Cukorbetegség mellett a kézpanasz komolyabb lehet | VZ2 | nincs szám |
| 35 | A CTS tüneteivel orvoshoz kell fordulni, ha romlanak vagy nem múlnak | CTS1 | nincs szám |
| 36 | A CTS néha magától rendeződik néhány hónap alatt, különösen terhesség esetén, de ez nem szabály: a terhességhez kötődő panasz a szülés után egy évvel is megmaradhat | CTS1 és CTS12 | „néhány hónap” és „egy év” egyezik; a korábbi „Jó hír is van” felütés kikerült |

**Kiegészítés a 2026-08-21-i tényellenőrző kör után.** Négy sor változott vagy
került be, ezek forrása is ellenőrizve:

| # | Állítás a cikkben | Forrás | Szám szó szerint egyezik? |
|---|---|---|---|
| 14b | A Bateman-áttekintésben egy további RCT és három kontrollcsoport nélküli vizsgálat javulást írt le enyhe és közepes eseteknél, de nem tudni, a kezeléstől vagy az idő múlásától | ZS6 | „One additional RCT”, „three single-arm studies” egyezik; az „esetek többsége javul” arány a cikkszövegből kikerült |
| 25b | Az AAOS 2024 ugyanennél a pontnál „Limited (Downgraded)” ajánláserősséget ad, az indoklás a kezelések, a vizsgálatminőség, a kontrollcsoportok és az utánkövetési idők eltérése | CTS2 | „Limited (Downgraded)” egyezik |
| 30b | A sérülés utáni mentőhívós lista NÉGY tételes, benne az erősen vérző seb | VZ3 | „a bad cut that is bleeding heavily” egyezik |
| 31b | A csuklón lévő CSOMÓ (nem duzzanat) nagyon fájdalmas, forró vagy piros | VZ2 | „a lump on your wrist” egyezik |

**Kiegészítés a 2026-08-25-i orvosi kutatási kör után.** A négy új, illetve
bővített szakasz állításai. Egyik sem tartalmaz gyógyulási arányt vagy
kimeneteli százalékot.

| # | Állítás a cikkben | Forrás | Szám szó szerint egyezik? |
|---|---|---|---|
| 37 | Szívinfarktus-gyanú jelei a kartünet mellett: szorító vagy nyomó mellkasi fájdalom, légszomj, hányinger vagy hányás, hideg verejtékezés, gyomorégésszerű érzés, sápadt, kékes vagy szürkés bőr; azonnal 112 | VZ6 | nincs szám |
| 38 | A mellkasi panasz kisugározhat a karba, a nyakba és az állkapocsba; a felsőtesti kellemetlen érzés egyik vagy mindkét karban, hátban, nyakban, állkapocsban és gyomorszájban is jelentkezhet, szokatlan fáradtsággal vagy szédüléssel | VZ7 | nincs szám |
| 39 | A szakmai források a karra fájdalmat vagy kellemetlen érzést írnak le, nem zsibbadást (pontosítás, nem új klinikai állítás) | VZ6 és VZ7 | nincs szám |
| 40 | A kétoldali kézzsibbadás inkább egész testre kiterjedő okra utal, ezért mindig kivizsgálást igényel | ZS7 | nincs szám |
| 41 | A perifériás idegkárosodás a leghosszabb idegeket támadja elsőként, ezért a tünetek jellemzően a lábfejen indulnak; a leggyakoribb kiváltó ok a cukorbetegség, mellette B12-hiány, pajzsmirigy-alulműködés, tartós túlzott alkoholfogyasztás, több gyógyszercsoport | ZS7 | nincs szám |
| 42 | A B12-hiány zsibbadást, bizsergést, izomgyengeséget, egyensúly- és koordinációs zavart okoz, és vérvétel tisztázza | ZS9 | nincs szám |
| 43 | Kétoldali kéztőalagút-érintettség azoknál is gyakran kimutatható, akik csak az egyik kezükre panaszkodnak | ZS11 | szándékosan szám nélkül (a forrás 80,7%-os aránya egyetlen központ adata, nem került a szövegbe) |
| 44 | A degeneratív cervicalis myelopathia tünetegyüttese: kétoldali kézzsibbadás és bizsergés, ügyetlenség a finom mozgásokban, járás- és egyensúlyromlás, súlyosabb esetben hólyagműködési zavar | ZS12 és ZS15 | nincs szám |
| 45 | A korai szakasz kétoldali kéztőalagút-szindrómának néz ki, gyakran tévesen diagnosztizálják, a késedelem visszafordíthatatlan idegi következménnyel járhat | ZS13 | nincs szám |
| 46 | A 2024-es kéztőalagút-irányelv a külsőleges készítményt magas minőségű bizonyíték alapján sorolja azok közé, amelyek nem javítják a beteg által jelentett hosszú távú eredményt | CTS2 | „High” egyezik |
| 47 | Körülírt idegi eredetű fájdalomnál a kapszaicin krém mérlegelhető annál, aki a szájon át szedett szereket kerülné vagy nem tolerálja | CTS11 (1.1.11) | nincs szám |
| 48 | A paracetamol és az ibuprofen rövid távon segíthet, de kevés bizonyíték szól amellett, hogy a panasz okát kezelnék | CTS1 | nincs szám |
| 49 | Az idegi eredetű fájdalom általában nem javul a megszokott fájdalomcsillapítóktól, ezért más gyógyszercsoportokat használnak | ZS8 | nincs szám |
| 50 | Idegi eredetű fájdalomra kezdő kezelésként négy szer jön szóba: amitriptilin, duloxetin, gabapentin, pregabalin; mind vényköteles | CTS11 (1.1.8) | „négy” egyezik |
| 51 | Kéztőalagút-szindrómában a szájon át adott gyulladáscsökkentő, görcsgátló és vízhajtó nem bizonyult jobbnak a kontrollnál vagy a placebónál; a szájon át adott kortikoszteroid nem javítja a hosszú távú eredményt | CTS2 | nincs szám |
| 52 | A táplálékkiegészítés sem bizonyult jobbnak a kontrollnál vagy a placebónál | CTS2 | nincs szám |
| 53 | B12-hiánynál a pótlás a kezelés, injekcióval vagy tablettával, a hiány okától függően | ZS9 | nincs szám |
| 54 | Napi 200 mg vagy több B6-vitamin perifériás neuropátiát okozhat; étrend-kiegészítőből napi 10 mg-nál több csak orvosi javaslatra | ZS10 | 200 mg és 10 mg egyezik — **a forrásoldal felülvizsgálati határideje 2023-08-03-án lejárt, kiadás előtt ellenőrizni kell** |
| 55 | A terhesség a kéztőalagút-szindróma kockázati tényezői között szerepel | CTS1 | nincs szám |
| 56 | A terhesség alatti kéztőalagút gyakoriságáról közölt adatok rendkívül széles sávban szóródnak, nagyrészt a diagnózisfelállítás eltérései miatt; a panasz a szülés után egy évvel is megmaradhat | CTS12 | „egy év” egyezik; a 7–43% és 31–62% sávot, valamint a lefolyási arányokat szándékosan nem írtuk a szövegbe |
| 57 | Terhesség alatt szűkebb a kezelési eszköztár; a kéztőalagutat gyakran alulértékelik és későn ismerik fel, a késedelem tartós idegkárosodáshoz vezethet | CTS13 | nincs szám |
| 58 | A terhesség alatt szedett gyógyszerek nagy része átjut a méhlepényen, ezért bármely készítmény előtt szakemberrel kell egyeztetni; ez a gyógynövényes és „természetes” készítményekre is vonatkozik | VZ4 | nincs szám |
| 59 | A terhességi duzzadás önmagában szokásos, de a hirtelen megnövő arc-, kéz- vagy lábfejduzzanat preeclampsia jele lehet, és azonnali hívást igényel, különösen erős fejfájás, látászavar, bordák alatti fájdalom vagy nagyon rossz közérzet mellett | VZ5 | nincs szám |
| 60 | Nem sürgős, de nem is halogatható jelek: gyengülő szorítás, gyakori tárgyelejtés, a hüvelykujj tövén lévő párnás rész lelapulása | CTS9 | nincs szám |
| 61 | A kéztőalagút-szindróma a legtöbb embernél idővel rosszabbodik, és túl sokáig kezeletlenül tartós kézműködési zavarhoz vezethet, beleértve az ujjak érzéskiesését és a gyengeséget | CTS9 | nincs szám |

**Nem klinikai állítások a szövegben** (a lektornak külön ellenőrizendők):
a nyitás „könnyű halogatni a kivizsgálást” mondata helyzetleírás, nem forrásolt
epidemiológiai adat (a korábbi, praxisra hivatkozó változatot a tényellenőrzés
J11 pontja miatt cseréltük). A korábbi „Ha megijedtél” bekezdés helyére
2026-08-25-én a forrásolt szív-blokk került (37–39. sor), amely már megnevezi a
tüneteket, és külön kimondja, hogy a karra a források fájdalmat vagy
kellemetlen érzést írnak le, nem zsibbadást. **Ezt a blokkot a két
gyógytornásznak külön jóvá kell hagynia.** A kurzus leírása („csukló-, ujj-, alkar- és könyökpanaszokra”) és az
ellenjavallati felsorolás a meglévő termékleírásból való, betűhíven. Az „éles
fájdalom esetén hagyd abba” és a „műtét után a kezelőorvos jóváhagyásával” a
kurzusok saját ellenjavallati szövege.

## A cikkíró javaslata a vezetőnek: GYIK-blokk (NEM része a kiírásnak)

A mért adatban szerepel a `kéz zsibbadás éjszaka gyakori kérdések` kifejezés
(90 keresés/hó, KD 0, `docs/monid-adatok-teljes.md` 2.1), a technikai terv pedig
támogat `faq` mezőt FAQPage-sémával. A C1 kiírás GYIK-et nem kér, ezért ezt a
vezető döntésére bízom. Ha kell, ez a négy tétel a cikkből forrásolva áll össze,
és megfelel az L11 lint-szabálynak (2-6 tétel, kérdőjel, legfeljebb 500 karakter).

1. **Miért zsibbad a kezem éjszaka?** Az éjszaka erősödő kézzsibbadás a
   kéztőalagút-szindróma jellegzetes mintázata: az NHS szerint a tünetek éjjel a
   legerősebbek, az AAOS OrthoInfo szerint gyakran felébresztik az embert, és a
   kéz rázogatása sokaknál enyhíti őket. Ez azonban nem bizonyíték, más ok is
   állhat mögötte.
2. **Melyik ujj zsibbadása mit jelent?** A hüvelyk, a mutató, a középső és a
   gyűrűsujj zsibbadása leggyakrabban a kéztőalagút-szindrómához köthető (AAOS
   OrthoInfo), a gyűrűs- és a kisujjé a könyöknél becsípődő singideghez (Graf és
   mtsai, 2023). A gyűrűsujj mindkét mintázatban szerepel, ezért a mintázat
   irányt ad, de nem diagnózis.
3. **Segít az éjszakai csuklósín?** Az NHS első lépésként ajánlja, és akár 6 hét
   viselést ír. A Cochrane 2023-as áttekintése szerint rövid távon nagyobb
   eséllyel hoz általános javulást, mint a semmi (RR 3,86), de a tünetskálán mért
   különbség a klinikailag érdemi küszöb alatt marad, alacsony bizonyossággal.
4. **Mikor sürgős a kézzsibbadás?** Azonnal hívj mentőt (112), ha a zsibbadás
   mellett lelóg az arc egyik fele, erőtlen a kar vagy akadozik a beszéd. Az NHS
   szerint akkor is, ha a jelek már elmúltak, de 24 órán belül megvoltak.
   Sérülés utáni zsibbadásnál és megszűnt érzésnél aznap kell ellátás.
