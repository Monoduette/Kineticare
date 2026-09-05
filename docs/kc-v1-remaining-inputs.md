# KC V1: fennmaradó tulajdonosi bemenetek

Állapotrögzítés: 2026-09-05. Ez a dokumentum nem ad felhatalmazást CMS-, ár-,
fizetési, hozzáférési vagy production módosításra. Nem tartalmaz kitalált
kampányfeltételt.

## Lezárt helyi bizonyíték

### A06: nevesített bemutatkozások és portrék

A négy jóváhagyott kanonikus oldal-layoutot az
`src/__tests__/owner-founder-portrait-coverage.test.ts` egyetlen leltárban
ellenőrzi, a meglévő `planOwnerReviewV1` tervvel:

- `kezdolap`: a közös, név szerinti bemutatkozás a jóváhagyott közös képet kapja;
- `szolgaltatasok`, `rolunk`, `kapcsolat`: Kocsis Kata és Kiss Kata nevesített
  bemutatkozása a névhez rendelt, meglévő egyéni portrét kapja;
- a teszt a tényleges kanonikus buildereket használja, és nem gyárt hibás
  ellenpéldát a planner módosításának kikényszerítésére.

Ezzel a jelenlegi kanonikus A06-lefedettség kód- és fixture-szinten lezárható.
A négy új, általános névvel leírt portré személyhez rendelése ettől külön bemenet:
a manifest nem nevezi meg, melyik képen melyik alapító szerepel. Ezt nem
arcfelismerésből és nem fájlnévből következtetjük.

### S06: nyilvános helyi megfigyelés

A már futó `http://localhost:3000` oldal read-only böngészős ellenőrzése szerint:

- a Szolgáltatások almenüben az `Ingyenes SOS KézRelax` felirat a
  `/kurzusok/sos-kezrelax-villamkurzus` címre mutat;
- a `/szolgaltatasok` oldalon az `Otthoni online program` sor
  `Nézd meg a teljes kurzust` linkje a
  `/kurzusok/otthoni-kezrehab-program` címre mutat;
- a `/szolgaltatasok` fő tartalmában nulla `details`/harmonika elem volt.

Ez a helyi publikus állapot nem reprodukál S06-hibát. A planner konzervatív
`accordion-snapshot-required` jelzését nem töröljük: az továbbra is azt mondja,
hogy ismeretlen CMS-harmonikában nem végzünk globális URL-cserét. Új planner-fix
csak ténylegesen reprodukált, egyedileg azonosítható hibás blokk alapján indokolt.

## Fennmaradó tulajdonosi bemenetek

### Új portrék név szerinti hozzárendelése

Szükséges: fájlnév -> `Kocsis Kata` vagy `Kiss Kata` jóváhagyott párosítás,
felhasználási jóváhagyás és kivágás. A jelenlegi név szerint azonosítható,
meglévő portrék addig érvényesek maradnak.

### H14 kapcsolati logó

A repóban elérhető saját KC logó:
`content/home-images/site/logo-kineticare.png`, 500x96 px, átlátszó háttérrel.
SHA-256:
`d547b06a386520fcd125fc36357b69a5ce8c0eb86644d584980e2d8a215348a3`.
Ez bitre azonos az örökölt archív logóállománnyal, ezért létező saját assetként
használható, de új logóvariánsként nincs igazolva. A H14 lezárásához a tulajdonos
döntése kell arról, hogy ez a változat megfelel-e, vagy külön új fájlt ad át;
emellett a pontos kapcsolati elhelyezést és képleírást is jóváhagyja.

### P02 kedvezményes landing

A meglévő CMS képes új tartalmi oldalt és szekciókat kezelni, de a kód jelenleg
egyetlen termékárat használ; kupon- vagy linkhez kötött kedvezménymechanizmust
nem igazoltunk. A régi akciós URL-ek tartós átirányítással a teljes árú kurzusra
vezetnek.

2026-09-05: a tulajdonos pontosította a mostani feladatot. Teljesen kidolgozott,
„Képzeletbeli akciós kurzus” nevű demó landing készül `/akcios-kurzus` címen.
Ehhez nem kell valódi árazás vagy kuponmechanizmus; a demó tartalma és gombjai
elkészíthetők, keresőindexelés és valódi fizetés nélkül.

A későbbi valódi ajánlat indítása előtt szükséges: az érintett kurzus, kedvezmény típusa és összege,
érvényesség kezdete/vége és időzónája, jogosultsági feltétel, a választott URL,
valamint hogy kuponos vagy linkhez kötött ajánlatról van-e szó. Ezek nélkül nem
készül valódi árígéret, visszaszámláló vagy vásárlási CTA. Fizetési és hozzáférési
logika külön, emberileg jóváhagyandó scope.

## Ellenőrzési parancs

```sh
env -i PATH=/opt/homebrew/Cellar/node@24/24.20.0/bin:/usr/bin:/bin NODE_ENV=test \
  /opt/homebrew/Cellar/node@24/24.20.0/bin/node node_modules/vitest/vitest.mjs run \
  src/__tests__/owner-founder-portrait-coverage.test.ts
```
