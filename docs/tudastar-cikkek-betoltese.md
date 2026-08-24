# A Tudástár cikkeinek betöltése

> **Mi ez?** A `docs/cikkek/` alatti nyolc markdown-cikk betöltése a Payload
> `posts` kollekciójába, hogy megjelenjenek a `/blog` listán és a saját
> cikkoldalukon. A 7. és 8. cikk csak `/blog/{slug}` poszt: gyökér
> `/inhuvelygyulladas` pages-hubot a script nem hoz létre.
>
> **Készült:** 2026-08-21.

## 1. Miért script, és miért nem kézi bemásolás

Nyolc cikk, egyenként 2 000–3 000 szavas törzzsel, alcímekkel és
felsorolásokkal. Kézzel a szerkezet elveszne, és minden szakmai javítás után
újra kellene csinálni. Így a markdown marad az **egyetlen igazság**, a
betöltés pedig visszajátszható és tesztelhető.

A fordítót a `src/lib/tudastar/markdown-to-lexical.ts` adja, a betöltést a
`src/scripts/import-tudastar-cikkek.ts`.

## 2. A legfontosabb szabály: némán semmi nem veszhet el

A storefront szerializálója (`src/components/lexical/serialize.tsx`) **véges**
csomópont-készletet ismer: `heading`, `paragraph`, `text`, `link`, `list`,
`listitem`, `quote`, `horizontalrule`, `linebreak`, `upload`. Ami nincs benne
— mindenekelőtt a **táblázat** —, azt nem rendereli ki.

Ez alattomos hibaforrás: egy táblázatot tartalmazó cikk az adatbázisban
hiánytalannak látszana, miközben a látogató nem látja a felét. Ezért a fordító
minden fel nem ismert szerkezetre **kivételt dob**, nem ugorja át. A 7. és 8.
cikk törzsében összehasonlító táblák vannak: ezeket a fordító ismert
csomópontokra (felsorolás, „Fejléc: érték”) alakítja, mert a storefront és a
Payload alapszerkesztője nem ismer `table` csomópontot. Kódblokk és második H1
továbbra is dob.

## 3. Mi kerül be a cikkből, és mi nem

A cikkfájlok felépítése kötött:

| Rész | Sorsa |
| --- | --- |
| A H1 fölötti fejléc (forrástáblák, cikkíró jegyzetei) | **kimarad** |
| A H1 | a bejegyzés **címe** lesz |
| A törzs a H1-től | a `content` mező |
| „Kik írták ezt a cikket?", „Forrásjegyzék", „Fontos tudnivaló" | **bent marad** (E-E-A-T és felelősség) |
| „Állítás és forrás: a cikkíró öntesztje" | **kimarad** |
| „A vezetőnek szóló jelzések", „A cikkíró javaslata a vezetőnek" | **kimarad** |

A rövid bevezetőt (`excerpt`) a törzs első bekezdéséből képezzük, mondathatáron
vágva, legfeljebb 200 karakter.

## 4. A slugok kötöttek

| Fájl | Slug |
| --- | --- |
| `1-miert-zsibbad-a-kezem.md` | `miert-zsibbad-a-kezem` |
| `2-keztoalagut-szindroma.md` | `keztoalagut-szindroma` |
| `3-teniszkonyok.md` | `teniszkonyok` |
| `4-pattano-ujj.md` | `pattano-ujj` |
| `5-csuklo-es-kezfajdalom.md` | `csuklo-es-kezfajdalom` |
| `6-csuklotores-utani-gyogytorna.md` | `csuklotores-utani-gyogytorna` |
| `7-inhuvelygyulladas.md` | `inhuvelygyulladas` (csak `/blog/…`; nincs gyökér pages-hub) |
| `8-befagyott-vall.md` | `befagyott-vall` (csak `/blog/…`; kategória `vall-es-konyok`) |

Ezek a webcímek szerepelnek a `docs/adwords-kampany.md` céloldal-hozzárendelésében
(7.2). **Eltérni tilos** — a hirdetés különben 404-re vinne.

## 5. Két külön kapu

```
OWNER_TUDASTAR_CONFIRM=igen   # enélkül PRÓBAFUTÁS: semmi nem íródik
OWNER_TUDASTAR_PUBLISH=igen   # enélkül a bejegyzés PISZKOZAT marad
```

A két kapu azért külön, mert a betöltés és a nyilvánossá tétel **két külön
döntés**. A betöltés visszavonható (piszkozat, senki nem látja), a publikálás
viszont egészségügyi tartalmat tesz ki a nyílt internetre.

**Tartalmi állapot** (`docs/cikkek-javitas-naplo.md`): a négy blokkolóból három
lezárva (B1 mentőhívási szint, B2 ellenjavallat, B4 irányelv-olvasat), a B3
pedig úgy, hogy a nem igazolt akkreditációs szám kikerült a szövegekből. Ami
**nyitva maradt: a két gyógytornász szakmai átolvasása.** Ezért alapból
piszkozat.

## 6. Futtatás

### Helyben

```bash
npm run import:tudastar                                   # próbafutás
OWNER_TUDASTAR_CONFIRM=igen npm run import:tudastar       # betöltés piszkozatként
OWNER_TUDASTAR_CONFIRM=igen OWNER_TUDASTAR_PUBLISH=igen npm run import:tudastar
```

### Élesben (Railway)

Az éles adatbázis a Railway privát hálózatán van, kívülről nem érhető el, ezért
a betöltés egyszeri **job**-ként fut, a repóban bevált mintát követve
(`CLAUDE.md` 2. üzemeltetési tanulság: a config-as-code felülírja a
service-beállítást, ezért dedikált fájl kell):

1. Új service a Kineticare projektben, ugyanarra a repóra.
2. A service „Config file path" beállítása: `railway.tudastar-job.json`.
3. A `DATABASE_URI` és a `PAYLOAD_SECRET` ugyanaz, mint a fő service-en
   (referencia-változóval: `${{Postgres-c8Rg.DATABASE_URL}}`).
4. `OWNER_TUDASTAR_CONFIRM=igen`, és ha publikálni is kell,
   `OWNER_TUDASTAR_PUBLISH=igen`.
5. Deploy. A logban `TUDASTAR_JOB_START commit=<sha>` … `TUDASTAR_JOB_DONE` a
   siker jele.

   **A `commit=` NEM dísz.** A Railway `redeploy` a MEGLÉVŐ buildet futtatja
   újra, tehát a régi kódot — ugyanaz a csapda, mint a fő szolgáltatásnál
   (`CLAUDE.md` 1. üzemeltetési tanulság: a „SUCCESS" deploy nem jelenti, hogy
   az új kód fut). A kiírt SHA-t vesd össze a `main` fejével; ha nem egyezik,
   a job RÉGI kódot futtatott, és az eredménye nem fogadható el.

   Ezért figyeli a szolgáltatás a `railway.tudastar-job.json` mellett a
   betöltő és a fordító forrásait is: így egy importer-javítás magától friss
   buildet kap, nem kell kézzel kikényszeríteni.
6. **A job végeztével a service törlendő** — a `sleep` csak azért van benne,
   hogy a Railway ne indítsa újra és a log olvasható maradjon.

Alternatíva, ha nem akarsz külön service-t: a cikkek az adminban is
bemásolhatók, de akkor a markdown és az adatbázis kettéválik, és a következő
szakmai javításnál kézzel kell szinkronizálni.

## 7. Újrafuttatható

A párosítás **slug szerint** történik: meglévő bejegyzést frissít, nem
duplikál. A `publishedAt` az első publikáláskor áll be (a Posts collection
`setPublishedAtOnFirstPublish` hookja), ismételt futásnál nem csúszik el.

Ha egy cikk szövege változik, elég a markdownt javítani és újra lefuttatni.

## 8. Amit mértünk (2026-08-21, helyi Postgres 16 + friss migrációs lánc)

| Ellenőrzés | Eredmény |
| --- | --- |
| Próbafutás írás nélkül | 6 cikk lefordult, **0 sor** került az adatbázisba |
| Éles futás | 6 létrehozva, `status` és `_status` egyaránt `published` |
| `/blog` lista | HTTP 200, **6 kártya**, mind a hat cím a helyén |
| Cikkoldalak | mind a hat HTTP 200; 15–18 `<h2>`, 48–93 `<li>`, 95–119 `<p>`, 5 156–6 423 szó |
| Kereszthivatkozások | a cikkek egymásra mutató linkjei HTTP 200-at adnak |
| `sitemap.xml` | mind a hat cikk benne van |
| Szövegveszteség | **nulla** — őr-teszt méri cikkenként, szószámmal |

A szövegveszteség-őr mutációval igazolva: ha a fordító eldobja a
felsorolásokat, az arány 83–91%-ra esik, és a teszt bukik.

## 9. A GYIK („Mások ezt is kérdezik”)

A `posts.faq` mezőbe a betöltő is ír, a `src/lib/tudastar/faq.ts` tételeiből.
Két szabály tartja egyben, és a kettő együtt fontos.

### 9.1 A kérdés MÉRT keresésből jön

Egyetlen kérdést sem találtunk ki. Mindegyik a 2026-08-21-i Monid-mérésből
való: valódi Google-autocomplete kifejezések magyar keresésből
(api.strale.io `/x402/keyword-suggest`, `hl=hu`), kiegészítve a Google Trends
„top” és „emelkedő” listáival. A futásazonosítók a `faq.ts` fejlécében állnak,
tételenként pedig a `mert` mező mondja meg, melyik kifejezésből jön a kérdés.

Ahol a mérés több változatot adott ugyanarra (például „mitől alakul ki” és
„mi az”), ott a tágabb, ok-kereső változat vitte a tételt: a puszta „mi az”-ra
a cikk címe és nyitó mondata amúgy is válaszol.

A kérdés úgy szól, ahogy a felhasználó beírja, de rendes magyar mondatként.
A mért `kéztőalagút szindróma hol fáj` kifejezésből így lesz
`Hol fáj a kéztőalagút-szindróma?`.

### 9.2 A válasz KIZÁRÓLAG a cikk törzséből jön

A GYIK a cikk kivonata, nem a bővítése. A válasz csak azt mondhatja, amit a
cikk törzse már kimond, mert egészségügyi (YMYL) tartalomnál egy kitalált
klinikai állítás valódi kárt okoz.

**Ha egy mért kérdésre a cikk nem ad választ, akkor NEM születik rá tétel.**
Nem az a megoldás, hogy kitaláljuk a választ, hanem az, hogy a kérdés felkerül
a 10. szakasz hiánylistájára: az mondja meg, mivel érdemes bővíteni a cikket.
Ez akkor is így van, ha nagy a keresési igény.

Ezt nem ígéretként, hanem őrként tartjuk fenn (`src/__tests__/tudastar-faq.test.ts`):

| Őr | Mit mér |
| --- | --- |
| G1 | cikkenként 2–6 tétel (a `maxRows` kemény korlátja 6), nincs ismétlődő kérdés |
| G2 | a kérdés kérdőjelre végződik, a válasz 2–4 mondat |
| G3 | a tétel `szakasz` mezője (a választ adó H2) tényleg ott van a cikk törzsében |
| G4 | minden `horgony` szó szerint megvan a VÁLASZBAN és a cikk TÖRZSÉBEN is |
| G5 | nincs forrás- vagy tanulmány-hivatkozás (a fordító `FORRAS_JELOLESEK` listájával) |
| G6 | nincs kvirtmínusz és nincs töltelék gondolatjel (`docs/ui-sztenderdek.md` §3.1) |
| G7 | a `faqFor` és a `faqMezore` a várt alakot adja |

**Amit a G4 nem fed le:** a horgonyok között nem szereplő mondatrészeket. Egy
válasz elvben tartalmazhatna a horgonyok mellé csempészett, cikkből nem
következő állítást. Ezért a horgonyok a válasz vázát adják (számadat, küszöb,
fejmondat), és az emberi felülvizsgálat ettől nem válik feleslegessé.
**Mutációval igazolva (2026-08-21):** ha a válaszba kitalált klinikai állítás
kerül és horgonyként is felvesszük, a G4 bukik; ha csak a horgonyt írjuk át, a
G4 szintén bukik; szóközös gondolatjelre a G6 bukik.

### 9.3 Mi történik, ha egy cikkhez nincs GYIK

A betöltő **nem dob**, csak figyelmeztet, és a `faq` kulcs kimarad a
payloadból. Ez szándékos, és nem következetlenség a kulcsszó-célzáshoz képest,
ahol a hiány kivételt dob:

1. A hiányzó SEO-célzásnál a `buildDocMetadata` **némán** visszaesik a cikk
   címére és bevezetőjére, tehát a hiba nem látszik. A GYIK-nek nincs
   fallbackje: ha nincs tétel, nincs blokk. Ez látható és ártalmatlan.
2. A `posts.faq` nem kötelező mező, a kulcsszó-célzás viszont mind a hat
   cikknél megvan, tehát ott a hiány valóban programhiba.
3. A legfontosabb: egy kötelező GYIK arra nyomna, hogy találjunk ki választ
   olyan mért kérdésre is, amit a cikk nem fed le. Pontosan ezt kell elkerülni.

Mivel a kulcs kimarad, egy adminban kézzel felvett GYIK-et nem töröl le a
betöltő. Ahol viszont **van** tétel, ott a `faq.ts` az igazság forrása, ugyanúgy,
ahogy a törzsnél a markdown: az újrafuttatás felülírja a kézi szerkesztést.

A `maxRows` átlépése ezzel szemben **kivételt dob**, még a fordítás fázisában,
az adatbázis érintése előtt. A Payload ezt csak íráskor utasítaná vissza, és
akkor már félig betöltött állapotot hagyna.

### 9.4 Ami ma benne van (2026-08-21)

| Cikk | Tételek | Miből (mért kifejezések) |
| --- | --- | --- |
| `miert-zsibbad-a-kezem` | 6 | okai, éjszaka/alvás közben/alváskor, bal kéz/jobb kéz, ellen/kezelése, cukorbetegség, hirtelen |
| `keztoalagut-szindroma` | 6 | tünetei, hol fáj, mitől alakul ki/mi az, kezelése házilag/csuklórögzítő, torna, műtét/műtét után |
| `teniszkonyok` | 6 | mitől alakul ki/kialakulása, tünetei/hol fáj, kezelése/házilag/borogatás, pánt/rögzítő/bandázs, gyógytorna/masszírozása, műtét |
| `pattano-ujj` | 6 | mitől alakul ki, hüvelykujj/hüvelykujj fájdalom, kezelése házilag, rögzítő, műtét, műtét utáni gyógyulási idő |
| `csuklo-es-kezfajdalom` | 6 | okai, kezelése/ellen, milyen orvos, terhesség alatt/szülés után, hirtelen, krém |
| `csuklotores-utani-gyogytorna` | **5** | utáni gyógytorna, gyógyulási ideje, gyakorlatok, mikor lehet dolgozni, gipsz |

Összesen **35 tétel**. A csuklótörésnél ötnél áll meg, mert a mérés többi
kifejezésére ez a cikk nem válaszol (lásd a következő szakaszt).

## 10. Amire ma nem születhet válasz (hiánylista)

Ez a szakasz a legértékesebb kimenet: **azt mondja meg, mivel érdemes bővíteni
a cikkeket.** Minden sor egy MÉRT keresési kérdés, amire a cikk törzse ma nem
ad választ, ezért GYIK-tétel sem született belőle.

**Két sor sosem lesz tétel, bővítés után sem:**

- **„lelki okai”** (a `kéz zsibbadás`, a `pattanó ujj`, a `csuklófájdalom` és a
  `csuklótörés` mérésében is felbukkan). Valódi, nagy keresési igény, de
  áltudományos állítást leírni tilos, különösen arról, hogy egy TÖRÉST lelki ok
  idézne elő. Ha ez a téma egyszer bekerül, csak úgy szabad, hogy a cikk
  megmondja, mit tudni erről valójában.
- **„biologika”** (`kéz zsibbadás`). Ugyanez.

A többi hiány valódi tartalmi rés:

| Cikk | Mért kérdés, amire nincs válasz | Miért |
| --- | --- | --- |
| `miert-zsibbad-a-kezem` | elleni krém, -ra krém, elleni gyógyszer, -ra vitamin, b vitamin | a cikk sem krémet, sem zsibbadás elleni gyógyszert, sem vitamint nem említ |
| | covid, kéz és arc zsibbadás, hideg kéz, hányinger, hátfájás | nincs róluk mondat (a Raynaud-jelenség szerepel, a hideg kéz mint tünet nem; az isiász szerepel, de a hátból a lábba sugárzó panaszként) |
| | reggel, bal kéz hüvelykujj | csak egy-egy említés, nincs mögötte szakasz |
| | terhesség alatt | egyetlen mondat áll róla ebben a cikkben; teljes szakasz az 5. cikkben van, a tétel is ott született |
| `keztoalagut-szindroma` | **krém** (Trends top **69**, a harmadik legerősebb) | a cikk semmilyen krémet nem említ |
| | b vitamin, akupunktúra, borogatás | nincsenek a cikkben (borogatás a teniszkönyök-cikkben van, más kórképre) |
| | műtét ára | a cikk árat nem közöl, és nem is akar |
| | vizsgálata | **döntés, nem hiány:** a cikk a CTS-6-ról, az ENG/EMG-ről és az MRI-ről ír, de kimondja, hogy a CTS-6 az orvos eszköze. Egy GYIK-válasz itt öndiagnózisra biztatna |
| | terhesség alatt | a cikk **lefedi**, csak nem fért be a hat tétel közé |
| `teniszkonyok` | **golfkönyök**, golfkönyök vs teniszkönyök, belső teniszkönyök (Trends top **28**) | a cikk a golfkönyökkel nem foglalkozik |
| | akupunktúra, homeopátia, csontkovács, alternatív kezelése, tape | a cikk ezekről nem ír |
| | csonthártyagyulladás, csontkinövés, hogy néz ki | nincsenek a cikkben |
| | gyógyítása (Trends 7) | a cikk **lefedi** („általában pihenéssel elmúlik, de néha egy évnél tovább is eltarthat”), csak nem fért be |
| `pattano-ujj` | terhesség alatt | a cikk kockázati tényezői között a terhesség nem szerepel |
| | műtét videó, műtét vélemények | a cikk nem közöl videót, és nem gyűjt véleményt |
| | gyógytorna | **részleges:** a cikk csak azt mondja meg, mikor NE gyakorolj, arról nincs adata, hogy a gyakorlás segít-e. Ezért nem lett tétel |
| `csuklo-es-kezfajdalom` | **kineziológiai tapasz** (a mérés 4. helye) | ez a cikk nem említi. A kéztőalagút-cikk igen, de más kórképről: másik cikk állítását nem vihetjük át |
| | gyerekeknél | a cikk felnőtteknek szól, gyermekekről nem ír |
| `csuklotores-utani-gyogytorna` | **tünetei** (a mérés 2. helye) | ez a cikk a gipszlevétel UTÁNI időszakról szól, a törés tüneteit nem sorolja fel (az 5. cikk igen) |
| | gipsz helyett | a cikk nem ír a gipsz alternatíváiról |
| | műtét | **részleges:** a cikk a „gipszlevétel vagy a műtét után” időzítést többször említi, de azt nem mondja meg, mikor kell műtét |

A „bno”, a „bno kód”, az „angolul”, a „carpal tunnel syndrome” és a
„carpalis alagút szindróma” szándékosan hiányzik: kódtár- és fordítás-kérdések,
nem a cikk dolga. Ha egyszer mégis kellenek, azokat nem GYIK-ben, hanem a
szócikk fejlécében volna helyük.

## 11. Kapcsolódó

- Fordító: `src/lib/tudastar/markdown-to-lexical.ts`
- Betöltő: `src/scripts/import-tudastar-cikkek.ts`
- GYIK-tételek: `src/lib/tudastar/faq.ts`
- Őrök: `src/__tests__/tudastar-markdown-lexical.test.ts`, `src/__tests__/tudastar-faq.test.ts`
- Job-konfiguráció: `railway.tudastar-job.json`
- Tartalmi állapot: `docs/cikkek-javitas-naplo.md`
- Céloldal-hozzárendelés: `docs/adwords-kampany.md` 7.2
