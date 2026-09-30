# Adatkezelési tájékoztató frissítése: mért eltérések és szövegjavaslat

**Készült:** 2026-09-30
**Címzett:** a KINETICARE Kft. ügyvezetői és jogi képviselője
**Státusz:** JAVASLAT. Az élő tájékoztatóba egyetlen sor sem került be. A beillesztés csak jóváhagyás után történik.

Ez a dokumentum nem jogi vélemény. A fejlesztői oldal két dolgot ad: (1) a weboldal **mért** működése és a tájékoztató mai szövege közötti eltéréseket, (2) beillesztésre kész szövegjavaslatokat, amelyeket a jogi képviselő elfogadhat, átírhat vagy elvethet. A Barion sütijeire vonatkozó szövegterv külön dokumentumban van (`docs/barion-pixel-jogi-szovegterv.md`); ez a dokumentum arra épít, nem ismétli meg.

---

## 1. Miért sürgős

2026. szeptember végén **élesedett a Meta (Facebook) Pixel** a weboldalon (azonosító: `1854174315570157`). A Pixel csak akkor tölt be, ha a látogató a süti-sávban az „Elfogadom mindet” gombra kattint, és a sáv szövege meg is nevezi. A tájékoztató viszont ma sem a Metát, sem más mérőeszközt nem említ, és két állítása ellentmond a valós működésnek (lásd 2. fejezet, 1. és 2. sor). A Meta üzleti eszközeinek feltételei szerint a Pixelt használó vállalkozás a Metával **közös adatkezelő** az adatok gyűjtése és továbbítása tekintetében, és neki kell erről tájékoztatnia a látogatókat.

---

## 2. Mért eltérések a mai tájékoztató és a valós működés között

A mai szöveg forrása a közzétett `/adatvedelem` oldal (kelt: 2025. 07. 05.). A mérés napja: 2026-09-30.

| #   | A tájékoztató mai állítása                                                                       | A valós működés                                                                                                                                                                                                                                                                                                                                                                                                                                            | Súly     |
| --- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | „Harmadik országba, illetve nemzetközi szervezetek részére nem továbbítunk személyes adatokat.”  | A Meta Pixel az USA-ba is továbbít adatot; több adatfeldolgozó (Resend, Cloudflare, Railway) amerikai cég.                                                                                                                                                                                                                                                                                                                                                 | Magas    |
| 2   | 6.3.: „Ha a böngészőjében engedélyezi a sütik használatát, akkor feltételezzük, hogy elfogadja…” | A weboldal előzetes, kifejezett hozzájárulást kér (süti-sáv); elutasítás esetén a PostHog-mérés és a Meta Pixel nem indul. Kivétel: a Barion alap-pixele a fizetési csalásmegelőzés miatt hozzájárulás nélkül is betölt és oldalmegtekintést jelez (a Barion feltétele, jogos érdek alapján; lásd a Barion szövegtervet). A mai mondat a hallgatólagos hozzájárulást írja le, ami a GDPR szerint nem érvényes hozzájárulás, és a valóságnak sem felel meg. | Magas    |
| 3   | Egyetlen mérő- vagy marketingeszközt sem nevez meg.                                              | Élő: PostHog (látogatottság-mérés, EU szerver; hozzájárulással), Barion Pixel (alap része hozzájárulás nélkül, marketing része hozzájárulással), Meta Pixel (hozzájárulással).                                                                                                                                                                                                                                                                             | Magas    |
| 3/a | A „Hibát jelzek” visszajelző űrlapot nem említi.                                                 | A lábléc „Hibát jelzek” űrlapjába írt szöveget a szerver a PostHog-ba továbbítja, egyszeri névtelen azonosítóval, a süti-hozzájárulástól **függetlenül** (a hibajelzés célja a beküldött üzenet megőrzése). A látogató a szövegbe személyes adatot is írhat.                                                                                                                                                                                               | Közepes  |
| 4   | Az időpontkérést nem említi; a 2.3. pont a megkereséseket jogos érdekre alapozza.                | Az időpontkérő űrlap a panasz leírását is bekéri (egészségügyi adat, GDPR 9. cikk), külön egészségügyi hozzájárulással (`consentHealth`). Erre a jogos érdek nem elég jogalap.                                                                                                                                                                                                                                                                             | Magas    |
| 5   | 2.4. hírlevél: jogalap „a KINETICARE jogos érdeke”.                                              | A hírlevél-űrlap kifejezett hozzájárulást kér („Hozzájárulok, hogy a Kineticare hírlevelet küldjön…”). A jogalap a hozzájárulás.                                                                                                                                                                                                                                                                                                                           | Közepes  |
| 6   | 2.1.: kezelt adat „bankkártya adatai, bankszámlaszám”.                                           | A kártyaadatot kizárólag a Barion kezeli, a KINETICARE nem látja és nem tárolja.                                                                                                                                                                                                                                                                                                                                                                           | Közepes  |
| 7   | Adatkezelői e-mail: egeszsegmozgastamogatas@gmail.com                                            | A weboldal mindenhol az info@kineticare.hu címet használja.                                                                                                                                                                                                                                                                                                                                                                                                | Alacsony |
| 8   | Az adatfeldolgozókat csak kategóriánként írja le.                                                | Név szerint ismertek (lásd 4. fejezet).                                                                                                                                                                                                                                                                                                                                                                                                                    | Közepes  |
| 9   | Az ingyenes kurzus igénylését nem említi.                                                        | Az SOS villámkurzus igénylésekor fiók jön létre és belépő levél megy ki.                                                                                                                                                                                                                                                                                                                                                                                   | Közepes  |

---

## 3. Beillesztésre kész szövegek

### 3.1. A Meta Pixel (új alpont a „Sütik kezeléséről” fejezetben)

> **6.2/c. Hirdetésmérés: Meta Pixel**
>
> Ha a süti-sávban az „Elfogadom mindet” gombra kattintasz, a Weboldal betölti a Meta Platforms Ireland Limited (Merrion Road, Dublin 4, D04 X2K5, Írország; a továbbiakban: Meta) mérőkódját, a Meta Pixelt. Hozzájárulásod nélkül a Pixel nem töltődik be, és a Meta felé semmilyen adat nem kerül továbbításra.
>
> **Célja:** Facebook- és Instagram-hirdetéseink hatékonyságának mérése, valamint annak lehetővé tétele, hogy hirdetéseinket azoknak mutassuk meg, akiket a szolgáltatásaink érdekelhetnek.
>
> **Továbbított adatok:** a meglátogatott oldal címe, a böngésző és az eszköz technikai adatai (például IP-cím, böngészőtípus), a Meta sütijeiben tárolt azonosítók, valamint az alábbi események: oldalmegtekintés, kurzusoldal megtekintése (a kurzus belső azonosítója és ára), a pénztár megnyitása (a kurzus belső azonosítója és ára), valamint az időpontkérés, a kapcsolatfelvétel, a hírlevél-feliratkozás és az ingyenes kurzus igénylésének ténye (kizárólag az űrlap típusa). **Nevet, e-mail-címet, telefonszámot, az űrlapokba írt szöveget és egészségügyi adatot a Pixel soha nem továbbít.** A belépést igénylő oldalakon (fiók, saját kurzusok), a fizetési és visszaigazoló oldalakon, valamint a belépési és jelszó-visszaállítási oldalakon a Pixel semmit nem küld.
>
> **Sütik:** `_fbp` (a Weboldal saját domainjén, a böngésző azonosítására, tárolási idő: 90 nap), `_fbc` (csak ha Facebook- vagy Instagram-hirdetésről érkezel; 90 nap), valamint a Meta saját domainjén elhelyezett `fr` süti (90 nap).
>
> **Közös adatkezelés:** a Weboldalon történő adatgyűjtés és a Meta részére történő továbbítás tekintetében a KINETICARE és a Meta a GDPR 26. cikke szerint közös adatkezelők. A megállapodás lényege: a KINETICARE felel a hozzájárulás beszerzéséért és ezért a tájékoztatásért; a Meta felel az adatok további, saját célú kezeléséért, amelyről a https://www.facebook.com/privacy/policy oldalon tájékoztat. Az érintetti jogokat a Metával szemben is gyakorolhatod.
>
> **Jogalap:** hozzájárulásod (GDPR 6. cikk (1) bekezdés a) pont; az elektronikus hírközlésről szóló 2003. évi C. törvény 155. § (4) bekezdése).
>
> **Harmadik országba továbbítás:** a Meta az adatokat az Amerikai Egyesült Államokba is továbbíthatja. Ennek alapja az EU–USA adatvédelmi keretrendszer (Data Privacy Framework), amelynek a Meta Platforms, Inc. résztvevője, valamint az Európai Bizottság általános szerződési feltételei.
>
> **Visszavonás:** hozzájárulásodat bármikor visszavonhatod a Weboldal láblécében található „Süti-beállítások” pontban. A visszavonás után a Pixel nem küld több adatot; a visszavonás nem érinti a korábbi adatkezelés jogszerűségét.

**Ellenőrizendő a jogi képviselőnek:** a Meta Platforms, Inc. Data Privacy Framework-tagságát a https://www.dataprivacyframework.gov oldalon; a Meta közös adatkezelői kiegészítésének (Controller Addendum) hatályos szövegét a Meta üzleti feltételei között. A süti-élettartamokat a Meta saját süti-tájékoztatója alapján adtuk meg; ezek változhatnak.

### 3.2. Látogatottság-mérés: PostHog (új alpont)

> **6.2/d. Látogatottság-mérés: PostHog**
>
> Ha a süti-sávban hozzájárulsz, a Weboldal a PostHog szolgáltatással méri, hogyan használják a látogatók az oldalt (például mely oldalakat nézik meg, hol akadnak el egy űrlapon). A mérés a PostHog európai uniós (Németországban üzemelő) szerverén történik, a Weboldal saját címén keresztül. Képernyő-felvétel nem készül. A látogatottság-mérés a hozzájárulásod nélkül nem indul el. (A „Hibát jelzek” űrlapon beküldött üzeneteket szintén a PostHog tárolja; erről a 2.8. pont szól.)
>
> **Szolgáltató:** PostHog Inc. (adatfeldolgozó, EU-s adattárolással).
> **Tárolt azonosító:** a böngészőben tárolt véletlenszerű azonosító (`ph_…_posthog`), tárolási idő: 1 év.
> **Jogalap:** hozzájárulásod (GDPR 6. cikk (1) bekezdés a) pont).
> **Visszavonás:** a lábléc „Süti-beállítások” pontjában bármikor.

### 3.3. A 6.3. pont cseréje (a hallgatólagos hozzájárulás helyett)

> **6.3. A sütik beállítása és a hozzájárulás visszavonása**
>
> A Weboldal első megnyitásakor egy sávban kérdezzük meg, hogy hozzájárulsz-e a nem feltétlenül szükséges sütik (látogatottság-mérés és hirdetésmérés) használatához. Amíg nem döntesz, és ha a „Csak a szükségeseket” lehetőséget választod, a PostHog látogatottság-mérése és a Meta Pixel nem töltődik be, és a Barion marketingcélú sütijei sem kerülnek elhelyezésre. A Barion fizetési csalásmegelőzést szolgáló sütijei és alap-mérőkódja ettől függetlenül működik, mert a bankkártyás fizetés biztonságához szükségesek (lásd a 6.2/a. pontot). Döntésedet a böngésződben tároljuk, és legkésőbb 12 hónap múlva újra megkérdezünk. Döntésedet bármikor megváltoztathatod a Weboldal láblécében található „Süti-beállítások” pontban. A sütiket a böngésződ beállításaiban is törölheted vagy letilthatod.

### 3.4. Az 1. pont javítása (harmadik országba továbbítás)

A mai mondat helyett:

> **Harmadik országba történő adattovábbítás.** Egyes adatfeldolgozóink, illetve a Meta az Európai Unión kívül, az Amerikai Egyesült Államokban is kezelhetnek személyes adatot. Ilyen továbbítás kizárólag az Európai Bizottság megfelelőségi határozata (EU–USA adatvédelmi keretrendszer) vagy az Európai Bizottság által elfogadott általános szerződési feltételek alapján történik. Az érintett szolgáltatókat a 4. pont sorolja fel.

### 3.5. Új adatkezelési cél: időpontkérés rendelői kezelésre

> **2.6. Időpontkérés rendelői kezelésre**
>
> **Adatkezelés célja:** a weboldalon keresztül beküldött időpontkérés fogadása, a kérelmezővel való kapcsolatfelvétel és az időpont egyeztetése.
> **Kezelt adatok:** név, telefonszám, e-mail-cím, a panasz rövid leírása, a választott időpont-sávok.
> **Jogalap:** a név és az elérhetőségek tekintetében a szerződés megkötését megelőzően az érintett kérésére történő lépések megtétele (GDPR 6. cikk (1) bekezdés b) pont); a panasz leírása egészségügyi adatnak minősül, ennek kezelése az érintett kifejezett hozzájárulásán alapul (GDPR 9. cikk (2) bekezdés a) pont), amelyet az űrlapon külön jelölőnégyzettel adsz meg.
> **Időtartam:** [KITÖLTENDŐ: például az időpont egyeztetésétől számított 30 nap, vagy ha a kezelés létrejön, az egészségügyi dokumentáció szabályai szerint].
> **Adatszolgáltatás elmaradásának következménye:** az időpontkérés nem küldhető be.

**Jelölés a jogi képviselőnek:** a mai tájékoztató 1. pontja szerint a tájékoztató nem vonatkozik Kiss Kata és Kocsis Kata egyéni vállalkozók egészségügyi szolgáltatására. Az időpontkérés viszont a kineticare.hu oldalon, a KINETICARE Kft. rendszerében érkezik. El kell dönteni, ki az adatkezelő (a Kft. vagy az egyéni vállalkozó, esetleg a Kft. adatfeldolgozóként), és ehhez igazítani a 2.6. pontot.

### 3.6. Ingyenes kurzus igénylése

> **2.7. Ingyenes kurzus igénylése**
>
> **Adatkezelés célja:** az ingyenes online kurzushoz való hozzáférés biztosítása: felhasználói fiók létrehozása és a belépéshez szükséges e-mail kiküldése.
> **Kezelt adatok:** e-mail-cím, név (ha megadod).
> **Jogalap:** a szolgáltatás nyújtására irányuló szerződés teljesítése (GDPR 6. cikk (1) bekezdés b) pont).
> **Időtartam:** a felhasználói fiók törléséig.

### 3.6/a. Hibajelzés és visszajelzés

> **2.8. Visszajelzés a Weboldalról („Hibát jelzek”)**
>
> **Adatkezelés célja:** a Weboldal hibáinak és a látogatói észrevételeknek a fogadása és kijavítása.
> **Kezelt adatok:** a beküldött üzenet szövege (mit csináltál, mi történt), az oldal útvonala, ahonnan küldted, valamint egy egyszeri, névtelen azonosító; ha a látogatottság-méréshez hozzájárultál, ehelyett a mérés azonosítója, így a hibajelzés a látogatásod mért adataihoz kapcsolható. Kérjük, az üzenetbe ne írj személyes vagy egészségügyi adatot; ha mégis megteszed, azt is tároljuk.
> **Adatfeldolgozó:** PostHog Inc. (EU-s, németországi adattárolás). A beküldés a süti-beállításaidtól függetlenül működik, sütit nem helyez el.
> **Jogalap:** a KINETICARE jogos érdeke a Weboldal működőképességének biztosításához (GDPR 6. cikk (1) bekezdés f) pont).
> **Időtartam:** [KITÖLTENDŐ, például a hiba lezárásától számított 1 év].

### 3.7. Kisebb javítások

- **2.1. pont, kezelt adatok:** a „bankkártya adatai, bankszámlaszám” helyett: „A bankkártyás fizetést a Barion Payment Zrt. bonyolítja; a kártyaadatokat kizárólag a Barion kezeli, azokat a KINETICARE nem látja és nem tárolja. A KINETICARE a fizetés azonosítóját, összegét és eredményét kapja meg.”
- **2.4. pont, hírlevél jogalapja:** „A KINETICARE jogos érdeke” helyett: „Az érintett hozzájárulása (GDPR 6. cikk (1) bekezdés a) pont), amelyet a feliratkozáskor adsz meg, és bármikor visszavonhatsz a hírlevelek alján található leiratkozó linkkel.” A tiltakozási jogról szóló mondat ekkor a hozzájárulás visszavonására cserélendő.
- **Elérhetőség:** az adatkezelő e-mail-címe mindhárom helyen: info@kineticare.hu (ha az ügyvezetés ezt választja).
- **Kelt:** a módosítás dátumára frissítendő.

---

## 4. Adatfeldolgozók név szerint (a „címzettek” rész kiegészítése)

A tábla a weboldal mért működéséből készült. A székhelyeket és a szerződéses státuszt (adatfeldolgozói megállapodás) a jogi képviselőnek kell ellenőriznie; ahol a fejlesztői oldal nem tudja biztosan, „ELLENŐRIZENDŐ” jelölés áll.

| Szolgáltató                    | Feladat                                                                   | Adattárolás helye                    |
| ------------------------------ | ------------------------------------------------------------------------- | ------------------------------------ |
| Railway Corporation            | a weboldal és az adatbázis tárhelye                                       | EU (Hollandia) régió; amerikai cég   |
| Barion Payment Zrt.            | bankkártyás fizetés, Barion Pixel                                         | Magyarország                         |
| KBOSS.hu Kft. (Számlázz.hu)    | számlakiállítás                                                           | Magyarország (élesben bekapcsolva)   |
| Resend (Plus Five Five, Inc.)  | tranzakciós és rendszerlevelek küldése                                    | USA                                  |
| PostHog Inc.                   | látogatottság-mérés (hozzájárulással)                                     | EU (Németország)                     |
| Cloudflare, Inc.               | űrlapok robotvédelme (Turnstile)                                          | USA / globális                       |
| BunnyWay d.o.o. (bunny.net)    | videók tárolása és lejátszása                                             | EU (Szlovénia)                       |
| Tárhely.Eu Kft.                | az info@kineticare.hu postafiók                                           | Magyarország (ELLENŐRIZENDŐ, cégnév) |
| Meta Platforms Ireland Limited | hirdetésmérés (hozzájárulással); **közös adatkezelő**, nem adatfeldolgozó | Írország / USA                       |

---

## 5. Nyitott kérdések a jogi képviselőnek

1. Ki az adatkezelő az időpontkérésnél (3.5. pont jelölése)?
2. Elfogadható-e a Meta Pixel „Elfogadom mindet” típusú, egyetlen döntéses hozzájárulása, vagy kategóriánkénti választás (mérés és hirdetés külön) szükséges? A fejlesztői oldal a kategóriás sávot el tudja készíteni.
3. A Resend, a Cloudflare és a Railway esetében megfelelő-e a továbbítás alapja (DPF-tagság, illetve általános szerződési feltételek)?
4. A Barion szövegterv (`docs/barion-pixel-jogi-szovegterv.md`) nyitott pontjai továbbra is érvényesek.

---

## 6. Beillesztés menete

A jóváhagyott szöveget a fejlesztői oldal szó szerint illeszti be az `/adatvedelem` oldalra, és a süti-sáv szövegét is hozzáigazítja, ha a jogi képviselő mást kér. A beillesztés után az élő oldalt ellenőrizzük.
