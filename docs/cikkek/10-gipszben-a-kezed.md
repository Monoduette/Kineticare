# LEKTORÁLANDÓ VÁZLAT. A két gyógytornász szakmai jóváhagyása előtt nem publikálható.

> Ez a fájl a Tudástár 10. cikkének szövegváltozata. Posts-rekord, slug
> `gipszben-a-kezed`, nyilvános út `/blog/gipszben-a-kezed`. Kategória: Törés
> és műtét után (`tores-es-mutet-utan`). Nincs kurzus-CTA, nincs gyökér
> pages-pár. A törzs a lenti H1-től a „Fontos tudnivaló” szakaszig tart. A H1
> fölötti rész a lektorálónak és az integrátornak szól, nem kerül a `content`
> mezőbe.
>
> A cikk a tulajdonosok blogötlete (2026-09-19). Kulcsszó-mérés ehhez a
> témához még NEM készült, ezért a `seoTitle` és a `seoDescription` az alábbi
> metaadat-táblából jön (a betöltő `seoForras: 'cikkfejlec'` jelöléssel), a
> `seoKeywords` mező üresen marad, amíg nincs mérés. GYIK nincs. Tulajdonosi
> utasítás (2026-09-19): a cikk élesbe megy; a betöltő ugyanazon a két kapun
> viszi, mint a többit (`OWNER_TUDASTAR_CONFIRM=igen` ír,
> `OWNER_TUDASTAR_PUBLISH=igen` közzétesz).
>
> Tulajdonosi kikötés (2026-09-19 este): „a cikkekre legyen study”. Ezért a
> törzs minden klinikai állítása mögött ellenőrzött tanulmány áll (a lenti
> Forrás-ellenőrzés és Forráslista táblában, belső dokumentációként; a cikk
> végén NINCS Források szakasz és a törzsben nincs [n] jel, tulajdonosi döntés
> 2026-09-19 késő este); minden tétel PubMed-azonosítóját és DOI-ját
> a PubMed E-utilities (esearch + esummary + efetch) hívásával ellenőriztük
> 2026-09-19-én, a 2024-es irányelv teljes szövegét a kiadó PDF-jéből
> olvastuk. Ami nem tanulmány (betegtájékoztató), az a listában így van jelölve.
>
> Elhatárolás: a gipsz LEVÉTELE utáni időszak a 6. cikk témája
> (`/blog/csuklotores-utani-gyogytorna`); ez a cikk a gipszben töltött hetekről
> szól, és a végén oda irányít.

## Cikk-metaadatok (az integrátornak)

| Mező | Érték |
|---|---|
| `title` | Gipszben a kezed: mit csinálj, amíg gyógyul |
| `slug` | `gipszben-a-kezed` |
| `seoTitle` | Gipszben a kezed: teendők, amíg gyógyul |
| `seoDescription` | Gipsz vagy sín van a kezeden? Így gondozd, mit mozgass közben, hogyan polcold fel, melyik jelnél kell azonnal orvos, és mi vár rád a gipsz levétele után. |
| Kategória | Törés és műtét után (`tores-es-mutet-utan`) |
| `ctaCourse` | üres (a gipsz alatt az otthoni program nem való; a leírása traumás sérülésnél orvosi engedélyt kér; időpont: `/szolgaltatasok`) |
| `relatedPosts` | `csuklotores-utani-gyogytorna`, `csuklo-es-kezfajdalom`, `miert-zsibbad-a-kezem` |
| Szerző | Kiss Kata és Kocsis Kata |
| Gyökér pages | nincs |
| Állapot | publikálásra kész; `OWNER_TUDASTAR_CONFIRM=igen OWNER_TUDASTAR_PUBLISH=igen npm run import:tudastar` teszi közzé |
| `heroImage` | a script nem állítja; javaslat: `public/media/team/hand-treatment-detail-1600.webp` (kézkezelés közelről), az adminban |

## Forrás-ellenőrzés (az integrátornak és a lektornak)

A törzs végén álló „Források” lista tételei. Az ellenőrzés módja: PubMed
`esearch` (cím szerint) → `esummary` (cím, szerzők, folyóirat, év, kötet,
oldal, DOI) → `efetch` (absztrakt). Az 1. tétel teljes szövege a kiadó
PDF-jéből (orthopt.org, 78 oldal), szövegkinyeréssel és kulcsszavas
kereséssel („digit”, „shoulder”, „elbow”, „edema”, „elevation”, „cast … weeks”).

| # | PubMed | DOI | Mire használtuk |
|---|---|---|---|
| 1 | 39213418 | 10.2519/jospt.2024.0301 | konzervatív kezelésnél jellemzően 4–6 hét rövid alkargipsz; „legalább a korai ujjmozgatást kell hangsúlyozni”; a betegoktatás az ujjak, a könyök, az alkar és a váll mozgatására; ödémakezelés (C ajánlás): felpolcolás, kompressziós kesztyű, gyakorlatok, otthoni program; egy vizsgálatban a leggyakoribb szövődmény (43%) a kéz, a csukló és a váll merevsége; a gipsz 2. hetétől végzett szorítóerő-gyakorlatok rövid távú előnye 60 év fölött (II. szintű bizonyíték); sürgős kézterápiás konzultáció kirívó ujjmerevségnél, bőr-túlérzékenységnél, trofikus bőrelváltozásnál |
| 2 | 19145960 | (Am Fam Physician 2009;79(1):16–22, a rekordban nincs DOI) | ne legyen vizes, ne dugj be tárgyat vakarózni; felpolcolás a fájdalom és a duzzanat ellen; jég 15–30 percig a gipsz fölött; erősödő fájdalom, bizsergés, zsibbadás, súlyos duzzanat, lassult kapilláris-újratelődés, szürkés-lilás ujjak: azonnali sürgősségi ellátás a gipsz eltávolítására; „bizonyos fokú ízületi merevség az immobilizáció elkerülhetetlen szövődménye” |
| 3 | 18180390 | 10.5435/00124635-200801000-00005 | a gipszelés szövődményei: merevség, nyomási fekély, kompartment szindróma |
| 4 | 23948422 | 10.1016/j.arr.2013.07.003 | a kényszerű izomnyugalom gyors izomsorvadáshoz és erővesztéshez vezet; már a 10 napnál rövidebb nyugalom alatt jelentős sorvadás történik; idősek különösen érzékenyek |
| 5 | 22093081 | 10.1111/j.1524-4725.2011.02201.x | hegmasszázs: 10 közlemény, 144 beteg; műtéti hegeknél 27/30 javult; a bizonyíték gyenge, a protokollok eltérőek |
| 6 | betegtájékoztató | nhs.uk, Broken arm or wrist, felülvizsgálva 2023-05-26 | a gipsz nedvességtől védése vízálló huzattal; a kéz könyök fölé emelése, éjjel párnán; ne vezess és ne emelj nehezet az orvos engedélye nélkül; sürgős jelek: sérült, túl szoros vagy laza gipsz, szag vagy váladék alóla, magas láz hidegrázással |
| 7 | betegtájékoztató | nhs.uk, Compartment syndrome, felülvizsgálva 2026-09-04 | szoros gipsz után hirtelen, erős fájdalom, ami az izom nyújtásakor rosszabb; sürgősségi eset, kérj mentőt, ne vezess magad |

> Megjegyzés a lektornak: a törzsben forrásnév nem szerepelhet
> (`FORRAS_JELOLESEK` őr), ezért a Források listában a betegtájékoztató
> kiadóját a domainjével nevezzük meg, és a PubMed-azonosítót „PubMed” címkével
> írjuk. A „ne púderezd, ne dezodorozd” tanács kimaradt, mert csak
> betegtájékoztatóban találtuk, tanulmányban nem.

---

## Forráslista (belső, nem kerül a cikkbe; tulajdonosi döntés 2026-09-19: a cikk végén nincs Források szakasz)
1. Mehta SP, Karagiannopoulos C, Pepin ME és mtsai. Distal Radius Fracture Rehabilitation: Clinical Practice Guidelines. J Orthop Sports Phys Ther. 2024;54(9):CPG1–CPG78. [doi:10.2519/jospt.2024.0301](https://doi.org/10.2519/jospt.2024.0301), PubMed 39213418.
2. Boyd AS, Benjamin HJ, Asplund C. Principles of casting and splinting. Am Fam Physician. 2009;79(1):16–22. PubMed 19145960.
3. Halanski M, Noonan KJ. Cast and splint immobilization: complications. J Am Acad Orthop Surg. 2008;16(1):30–40. [doi:10.5435/00124635-200801000-00005](https://doi.org/10.5435/00124635-200801000-00005), PubMed 18180390.
4. Wall BT, Dirks ML, van Loon LJ. Skeletal muscle atrophy during short-term disuse: implications for age-related sarcopenia. Ageing Res Rev. 2013;12(4):898–906. [doi:10.1016/j.arr.2013.07.003](https://doi.org/10.1016/j.arr.2013.07.003), PubMed 23948422.
5. Shin TM, Bordeaux JS. The role of massage in scar management: a literature review. Dermatol Surg. 2012;38(3):414–423. [doi:10.1111/j.1524-4725.2011.02201.x](https://doi.org/10.1111/j.1524-4725.2011.02201.x), PubMed 22093081.
6. Betegtájékoztató (nem tanulmány): nhs.uk, Broken arm or wrist, felülvizsgálva 2023. május 26. [nhs.uk/conditions/broken-arm-or-wrist](https://www.nhs.uk/conditions/broken-arm-or-wrist/).
7. Betegtájékoztató (nem tanulmány): nhs.uk, Compartment syndrome, felülvizsgálva 2026. szeptember 4. [nhs.uk/conditions/compartment-syndrome](https://www.nhs.uk/conditions/compartment-syndrome/).

# Gipszben a kezed: mit csinálj, amíg gyógyul

Feltették a gipszet, és most hetekig ebben élsz. Viszket, nehéz, és nem tudod, mit szabad vele.

Kiss Kata és Kocsis Kata vagyunk, gyógytornászok, és évek óta elsősorban a kéz rehabilitációjával foglalkozunk. A gipszben töltött hetek nem holtidő: amit ilyenkor teszel, az dönti el, mennyire merev és dagadt kézzel indulsz a gyógytornának.

Egy dolgot előre tisztázunk. Ez a cikk nem mondja meg, mikor jöhet le a gipszed. Azt a kezelőorvosod dönti el, a törés és a kontroll alapján.

## Mikor szólj azonnal az orvosnak?

A gipsz legveszélyesebb szövődménye a keringési zavar. Azonnali sürgősségi ellátás kell a gipsz eltávolítására, ha ezek közül bármelyiket észleled:

- a fájdalom nem enyhül, hanem erősödik,
- az ujjaid bizseregnek vagy zsibbadnak,
- a duzzanat súlyos,
- a szabadon lévő ujjak szürkés-lilás színűek.

Ha a gipsz alatt hirtelen, nagyon erős fájdalom jelentkezik, ami az ujjak óvatos kinyújtásakor rosszabb, az a szoros gipsz szövődménye lehet: hívd a 112-t, és ne vezess magad a kórházba.

Aznap kérj orvosi tanácsot akkor is, ha a gipsz eltörik, meglazul vagy egyre szorosabb, ha rossz szagot vagy váladékot érzel alóla, és ha magas lázad, hidegrázásod van.

## A gipsz gondozása: nedvesség, viszketés

A gipsz nem lehet vizes, és vakarózni sem szabad alá semmilyen tárggyal. Fürdésnél használj vízálló huzatot. A gipszelés ismert szövődménye a nyomási fekély és a bőr fertőzése is.

Ne vezess, és ne emelj nehezet, amíg az orvosod nem mondja, hogy szabad.

## Mozgasd, ami szabad: ujjak, könyök, váll

Bizonyos fokú ízületi merevség az immobilizáció elkerülhetetlen szövődménye, és a kényszerű nyugalom már tíz napnál rövidebb idő alatt is jelentős izomsorvadással és erővesztéssel jár. A 2024-es kézrehabilitációs irányelv ezért azt írja: legalább a korai ujjmozgatást kell hangsúlyozni, és a beteget az ujjak, a könyök, az alkar és a váll önálló mozgatására kell megtanítani. Egy vizsgálatban a leggyakoribb szövődmény a kéz, a csukló és a váll merevsége volt.

- Az ujjaidat a gipsz felhelyezése után kezdd mozgatni: hajlítsd és nyújtsd őket, óvatosan, gyakran.
- A hüvelykujjadat érintsd sorban a többi ujjhoz, ha a gipsz engedi.
- A könyöködet hajlítsd és nyújtsd naponta többször, ha a gipsz nem rögzíti.
- A válladat emeld, körözz vele, nyúlj fel: a kendőben lógó kar válla is bemerevedik.
- Hatvan év fölött egy vizsgálat szerint a gipsz második hetétől végzett, puha labdás szorítógyakorlat rövid távon javította a szorítóerőt. Hogy neked szabad-e, azt a kezelőorvosod mondja meg.

Ha az ujjaid kirívóan bemerevednek, a bőröd túlérzékennyé válik, vagy a bőr színe és tapintása megváltozik, az irányelv sürgős kézterápiás konzultációt kér. Ne várd meg vele a gipsz levételét.

## Polcold fel a duzzanat ellen

Az irányelv szerint a kéz és az ujjak duzzanata jelentős akadály, amely ronthatja a felépülést. A felpolcolás a fájdalmat és a duzzanatot is csökkenti: amikor ülsz, a könyök fölé polcolva, éjjel párnán. Az irányelv az ödéma kezelésére a felpolcolást, a gyakorlatokat és a kompressziós kesztyűt együtt ajánlja, rövid távú előnnyel.

Hűtés a gipsz fölött, száraz csomaggal, 15–30 percig alkalmazható. Vizes borogatás nem, mert a gipsz nem lehet vizes.

## Mi jön a gipsz levétele után?

Ha nem kellett műtét, a csuklótörést jellemzően 4–6 hétig rögzítik gipszben, és a csukló mozgatása ezután indul. Ekkor a kezed merev és gyenge: a merevség az immobilizáció elkerülhetetlen velejárója, és ebben egy gyógytornász tud segíteni.

Műtéti heg esetén a heg masszírozásáról egy irodalmi áttekintés azt találta, hogy a műtéti hegek nagy része javult tőle, de a bizonyíték gyenge. A terhelést fokozatosan kell emelni: előbb a mozgás, aztán az erő, végül a fogás. Ez a mi rendelői tapasztalatunk, nem tanulmány.

Erről az időszakról külön cikket írtunk: [csuklótörés utáni gyógytorna](/blog/csuklotores-utani-gyogytorna). Ott a gyakorlatsor és a felépülés menetrendje is benne van.

## Mikor keress minket?

Amíg a gipsz rajtad van, a legtöbb, amit tehetsz, a fenti mozgás és felpolcolás. Ha a gipsz lekerült, és a merevség, a gyengeség vagy a duzzanat nem indul javulásnak, gyere el hozzánk. A rendelői kezelésekről [a szolgáltatások oldalon](/szolgaltatasok) írtunk, ott tudsz időpontot kérni. Az otthoni kézprogramunkat törés után csak akkor ajánljuk, ha az orvosod már mindent engedélyezett.

## Kik írták ezt a cikket?

Kiss Kata és Kocsis Kata vagyunk. Gyógytornászok, és évek óta elsősorban a kéz rehabilitációjával foglalkozunk.

Kiss Kata gyógytornász, manuálterapeuta, sportrehabilitációs tréner. Kocsis Kata gyógytornász, sportrehabilitációs tréner, gyógy- és sportmasszőr.

Oktatunk is. A ProBody Stúdió sportrehabilitációs tréner képzésén a „Bevezetés a kéz, a csukló- és könyökízület rehabilitációs lehetőségeibe” tantermi kurzus instruktorai vagyunk (2024, 2025, 2026, Budapest).

## Fontos tudnivaló

A cikk általános tájékoztatás, nem helyettesíti a szakorvosi vizsgálatot és a személyre szabott kezelést. A gipsz levételének idejét és a terhelés engedélyezését a kezelőorvos mondja ki. Ha bizonytalan vagy, vagy a tünetek romlanak, fordulj orvoshoz.
