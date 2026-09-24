---
name: teszt-audit
description: "Tesztírási kapu és teszt-audit a Kineticare-hez (a globális test-audit helyett ezt használd). Használd MINDIG, amikor tesztet írsz, módosítasz, átnézel vagy átfésülsz: új regressziós teszt egy hibajavításhoz, meglévő teszt átírása, review, teszt-takarítás. Három mód egy értékmércével: írási kapu minden új vagy módosított tesztre; audit az alacsony értékű, implementációhoz kötött vagy duplikált tesztekre és az általuk életben tartott, csak tesztnek szóló éles kódrészekre; kampány egy teljes alrendszer tesztfelületének megritkítására."
---

# Teszt-audit a Kineticare-ben

Három mód, egy értékmérce.

- **Írási kapu:** minden új vagy módosított tesztet az írás pillanatában
  szűr.
- **Audit:** célzott átfésülés azokra a tesztekre, amelyek a forráskódot
  ismétlik, erősebb bizonyítékot duplikálnak, a viselkedést az
  implementációhoz kötik, vagy csak tesztnek szóló varratot tartanak életben.
  Egy nagy auditot folytass tovább, mindig külön, önmagában egész követő
  PR-ekben. A cél a bizalom, nem a törölt sorok száma.
- **Kampány:** egy teljes alrendszer (például a számlázás vagy a fizetési lánc)
  teljes tesztfelületét ritkítja meg: minden tesztfájlját átvizsgálja, és
  kigyomlálja az alacsony értékűeket. Kampány előtt olvasd el a
  [CAMPAIGN.md](CAMPAIGN.md)-t.

A Kineticare-ben a tesztek pénzt (Barion, éles), NAV-számlát (Számlázz.hu, AAM)
és jogi kötelezettséget (45/2014. Korm. rendelet) védenek. Egy teszt, amely
zöld, de semmit nem bizonyít, rosszabb, mint a hiányzó teszt: hamis
biztonságot ad.

**Először olvasd el:**
- a `CLAUDE.md` „Tesztírás és teszt-audit” szakaszát és a 15. üzemeltetési
  tanulságát;
- az `AGENTS.md` „Tesztelés” és „CI és PR-elvárások” szakaszát;
- a `docs/ugynok-kezikonyv.md` 4.3 (Tesztelés) és 4.6 (Melyik őrtesztet
  futtasd) pontját;
- az érintett mappák esetleges saját `AGENTS.md`/`CLAUDE.md` fájljait.

Egy teszt megírásához elég az Írási kapu és a Szemét-minták; a többi szakasz
audithoz és kampányhoz kell.

**Fogalmak.**
- **Gazda:** az az éles modul, amely a szerződést ténylegesen megvalósítja
  (például `src/lib/order-status/apply-barion-state.ts`).
- **Gazdahatár:** a gazda belépési pontja, amelyet éles hívó is használ.
- **Tesztgazda:** az a teszt, amely a szerződést elsődlegesen bizonyítja.
- **Varrat:** olyan éles kódrész (export, kapcsoló, becsomagoló, injektálási
  pont), amely csak azért létezik, hogy a teszt hozzáférjen.

## Írási kapu

Mielőtt bármilyen tesztet hozzáadsz, válaszolj négy kérdésre. Ha egyre nincs
válasz, a tesztet még ne add hozzá.

1. Milyen megfigyelhető viselkedést, invariánst vagy önálló szerződést véd?
2. Milyen hihető regresszió buktatja el?
3. Miért nem fogja meg ezt a hibát a meglévő lefedettség? Minden szerződésnek
   egy tesztgazdája van, a legerősebb határon. Egy másik rétegnek csak saját,
   külön kockázat miatt van helye (például szállítási vagy életciklus-hiba,
   amit a tesztgazda nem ér el). Közel-duplikált teszt helyett bővíts egy
   táblázatos esetet (`it.each`) vagy egy közös fixtúrát, és a duplikált
   előkészítést ugyanabban a változásban vond össze.
4. Kell-e hozzá varrat, amelyre éles hívónak nincs szüksége? Ha igen, vidd a
   tesztet a valódi határra.
   - **Kivétel:** a külső hívók meglévő injektálási pontjai (`postXml`,
     `queryByKulsoAzon`, a meglévő `fetchImpl` paraméterek) és az injektált
     `sleep` szándékos, megtartandó tesztvarratok. A CLAUDE.md 15. tanulsága
     szerint tesztből soha nem mehet ki valódi hálózati hívás, és a várakozás
     nem lassíthatja a tesztcsomagot.
   - Új `fetch`-es kódhoz ne vezess be új injektálási paramétert: ott a
     `vi.stubGlobal('fetch', …)` + `afterEach(vi.unstubAllGlobals)` az út.

Utána vesd össze a tesztet minden [szemét-mintával](#szemét-minták). Egyezés
esetén a kapu elutasítja, hacsak a [megtartási mérce](#megtartási-mérce) meg
nem nevezi azt a szerződést, amelyet önállóan őriz. Az a teszt, amely
viselkedést megőrző átszervezésnél eltörne, implementációt állít, nem
viselkedést: írd át a gazdahatáron, mielőtt bekerül.

**Hibajavítási regressziós teszt (ellenpróba):** a javítás előtti kódon a
szándékolt okból kell elbuknia, a gazdahatáron végzett javítás után át kell
mennie. Bizonyítsd, és a bukás üzenete kerüljön a PR-leírás „hogyan lett
ellenőrizve” részébe. A `git stash`-t ne használd: a stash-lista a worktree-k
között közös.

- **Ha a javítás még nincs commitolva:**
  ```
  git diff HEAD -- <forrásfájlok> > <scratchpad>/javitas.patch
  git apply -R <scratchpad>/javitas.patch
  ```
  Új, még nem követett forrásfájlnál előbb futtasd a `git add -N <fájl>`-t.
  Ezután futtasd a tesztet (`npx vitest run <tesztfájl>`), jegyezd fel a
  bukás üzenetét, majd `git apply <scratchpad>/javitas.patch`.
- **Ha a javítás már commitolva van:**
  `git checkout <javítás-előtti-SHA> -- <forrásfájlok>`, futtatás, majd
  `git checkout HEAD -- <forrásfájlok>`. A `git checkout <commit> -- <fájl>`
  az indexet is átírja.
- A végén a `git status --short` és a `git diff --cached -- <forrásfájlok>`
  legyen üres, a `git diff --stat` pedig mutassa, hogy a javítás visszakerült
  (CLAUDE.md 20b).

Az a regressziós teszt, amely soha nem bukott el bizonyíthatóan, a mockot
bizonyítja, nem a javítást. Egy regresszió a gazdahatáron lefedi a hibát; ne
játszd újra ugyanazt a forgatókönyvet minden rétegben, amelyen átmegy.

## Szemét-minták

Közös ellenőrzőlista mindkét módhoz: az írási kapu elutasítja az ilyen új
tesztet, az audit a meglévőket keresi.

- állítás nélküli teszt, amely csak lefuttatja a kódot (a lefedettség
  kedvéért);
- önmagával összevetett érték (például `expect(x).toEqual(x)`), vagy a
  bemenetet változatlanul visszaadó függvény tesztje;
- másolt fixtúra, leltár, manifest vagy export-lista;
- pontos forrás-, import- vagy szöveg-grep (kivételt lásd a megtartási
  mércénél);
- privát predikátum vagy hívásalak tesztje, amelyet a valódi határon is
  tesztelünk;
- ugyanannak a szerződésnek duplikált meghívása;
- közös segédfüggvény szolgáltatónkénti újrajátszása;
- teszt, amelynek egyetlen célja egy csak tesztnek szóló export, globális vagy
  becsomagoló megtartása;
- halott éles kód, amelynek csak tesztek a hívói;
- olyan elvárt érték, amelyet maga a tesztelt segédfüggvény vagy renderelő
  állít elő;
- mock, amely maga valósítja meg az állított viselkedést, vagy egyetlen
  azonos mock, amely különböző API-kat helyettesít;
- fixtúra, amely maga adja azt a visszaigazolást, befogadást (admission) vagy
  callback-sorrendet, amelyet a gazdának kellene előállítania, vagy olyan
  tárolóra tett perzisztencia-állítás, amelyet az útvonal soha nem ír;
- konfigurációs teszt, amely csak visszaolvassa a beállított kapcsolót
  (például `paymentMethods: []`), ahelyett hogy a kapcsoló által ígért
  viselkedést gyakorolná (például hogy a plugin `/payments/*` útvonala nem
  létezik);
- negatív kontroll, amely más okból megy át, például egy másik őr
  elutasítása miatt, vagy olyan elutasítással, amelyet az éles útvonal soha
  nem ér el;
- név vagy fixtúra, amely többet ígér, mint amit a bemenet gyakorol.

Valódi Kineticare-példák (a 2026-09-24-i regressziókeresésből):

- egy order-poll teszt címe „forgatást” ígért, de forgatásra nem volt
  állítása (az utolsó minta);
- a jogi visszaigazoló e-mailnél csak a szöveges részt tesztelték, így a HTML
  rész, amit a levelezők valóban mutatnak, elveszíthette a kötelező
  blokkokat, és a CI zöld maradt (mutációval igazolva);
- a refund-evidence őr egyik ágát (idegen, nem üres POS-tranzakcióazonosító)
  semmi nem tesztelte, az ág törlése nem buktatott tesztet;
- szintetikus POS-tranzakcióazonosítójú fixtúrák
  (`posTransactionId: 'SYNTHETIC-…'`), miközben az éles kód
  `${orderNumber}-1`-et vár: a fixtúra nem hasonlított az éles adatra. A
  titkokat helyettesítő, jelölt `DUMMY-…` értékek maradnak (1. tilos zóna,
  kézikönyv 2.1); a gond csak az éles alakot utánzó, nem titkos
  azonosítókkal van.

## Értékmérce

Egy teszt akkor éri meg a karbantartását, ha viselkedést, hihető regressziót
vagy önállóan értelmes szerződést véd. Auditban az a meglévő teszt, amelynek
viselkedést megőrző átszervezéskor változnia kell, gyanús, de nem
automatikusan törölhető. Az írási kapu az új ilyeneket továbbra is elutasítja.

Mielőtt egy jelöltről ítélsz, olvasd el:

- a teljes tesztet és az éles gazdát, a belépési pontját, hívóit és hívottjait;
- a testvér-implementációkat és az átfedő teszteket;
- a CI-útvonalat (`.github/workflows/ci.yml`) és a releváns git-előzményt.

Ha a teszt függőségre épülő viselkedést állít (Payload, Barion, Számlázz.hu,
Resend), nézd meg közvetlenül a függőség forrását vagy típusait. Külső
szerződésnél a hivatalos dokumentációt is:
- Barion: `docs.barion.com`, és ha nem érhető el, a Wayback Machine-másolata;
- Számlázz.hu: az XSD-k a `src/__tests__/szamlazz/xsd/` mappában.

## Felderítés

A felderítés csak olvas; bizonyítékot jelents, mielőtt szerkesztesz. Széles
hatókörnél futtass párhuzamos felderítő sávokat, a Kineticare gazdahatárai
mentén:

- **fizetési lánc:**
  - `src/lib/checkout/**`, `src/lib/checkout-submit.ts`;
  - `src/lib/payments/**` (a `confirmOrder`-őr gazdája);
  - `src/lib/barion/**`, `src/lib/barion-callback/**`;
  - `src/lib/order-poll/**`, `src/lib/order-status/**`,
    `src/lib/order-status-poll.ts`, `src/lib/order-integrity.ts`;
  - `src/lib/refund/**`;
  - `src/jobs/tasks/order-poll.ts`, `src/jobs/tasks/webhook-retry.ts`;
  - `src/app/(frontend)/api/checkout/**`, `src/app/(frontend)/api/barion/**`.
- **számlázás:** `src/lib/szamlazz/**`, `src/jobs/szamlazz-task-gate.ts`,
  `src/jobs/tasks/invoice-issue.ts`, `src/jobs/tasks/storno-issue.ts`,
  `src/jobs/tasks/corrective-invoice-issue.ts`.
- **e-mail és jogi szöveg:** `src/lib/email/**`, `src/lib/order-paid.ts`,
  `src/lib/legal-*`, `src/scripts/apply-owner-content.ts`.
- **jogosultság, biztonság, hozzáférés:**
  - `src/access/**`, `src/lib/security/**`;
  - `src/lib/access-grants*.ts`, `src/lib/course-access*.ts`,
    `src/lib/auth-client.ts`;
  - `src/middleware.ts`, `src/lib/logger.ts`;
  - `src/collections/Users.ts` (4. tilos zóna);
  - tesztjei a `src/__tests__/security/**` alatt.
- **CMS és admin:** `src/plugins/**`, `src/collections/**`,
  `src/components/admin/**`.
- **egyéb core:**
  - a `src/lib/**` többi része (például `stream/**`, `tudastar*`, `seo*`);
  - `src/fields/**`, `src/blocks/**`;
  - `src/env.ts`, `src/instrumentation.ts`, `src/payload.config.ts`.
- **vevői felület és útvonalak:** `src/components/**`, `src/app/**`.
- **szkriptek, jobok, eszközök:** `src/scripts/**`, `src/jobs/**`, a gyökér
  `scripts/**` és a `.github/workflows/**`.
- **dokumentum-őrök:** `handover/**/*.test.ts` (a vitest `include` része).

Minden sávban a [szemét-mintákat](#szemét-minták) keresd. Kampányon kívül
néhány nagy bizonyosságú jelölt többet ér egy nagy, spekulatív leltárnál.

## Megtartási mérce

Tartsd meg a tesztet, ha önállóan kikényszerít egy szerződést. Ilyen a
nyilvános API-, protokoll-, konfigurációs, migrációs, tárolási, biztonsági,
platform-, alapértelmezési, pontos bájtos (generált kimenet), csomag-,
kiadási/deploy- vagy architektúra-szerződés.

A Kineticare-ben ilyen szerződés például (a lista nem teljes):

- a pénzmozgás (Barion Start, GetState, Refund, callback) és a rendelés
  állapotgépe;
- a NAV-számla (XSD-érvényesség, AAM/27 áfa-mód, teljesítési dátum,
  idempotencia);
- a jogi szöveg (45/2014. 18. §, 29. § (1) m), ÁSZF, visszaigazolás tartós
  adathordozón);
- a tilos zónák őrtesztjei:
  - `ecommerce-payments-guard.test.ts`;
  - a `checkout-start.test.ts` „T-063 — plugin-adapter-kontroll” blokkja,
    amely az adapter mindig dobó `confirmOrder`-jét hívja;
  - a G1–G4 őrök: `schema-drift-guard`, `schema-config-sync`,
    `migration-immutability`, `migration-integrity`;
  - a `guard-files-integrity.test.ts`;
  - a teljes lista: `docs/ugynok-kezikonyv.md` 4.6 és `docs/ci-orok.md`.
- a jogosultság (4. tilos zóna) és a migráció (3. tilos zóna);
- a biztonság és adatvédelem (redakció, nincs PII a naplóban);
- a konfiguráció és az indulási őrök (`src/env.ts`, instrumentation);
- az alapértelmezések: az első user owner, a 2. usertől `customer` szerepkör
  (CLAUDE.md 8–9.);
- a csomag- és platform-szerződés:
  - a pinned `@payloadcms/*` verziók (5. tilos zóna);
  - a lockfile registry-je (CLAUDE.md 10.);
  - a rögzített image-ek és a Node-verzió;
- a tárolás: amit a Payload-collectionök és az adatbázis ténylegesen
  perzisztálnak;
- a nyilvános API és az útvonalak;
- a repó-szabályok őrtesztjei:
  - `payload-config.test.ts` (`push: false`, CLAUDE.md 22a);
  - `tipografia-harom-meret.test.ts` (három betűméret-token,
    `docs/ertekesitesi-ux-skill.md`);
  - `jogi-linkfeliratok.test.ts` (a jogi link felirata a jogi oldal címe);
- a termektervezes skill mért UI-őrei (kontraszt, érintési cél, 320 px-es
  reflow);
- a tesztleltár-őrök: `db-gated-coverage-guard.test.ts` és a
  `guard-files-integrity.test.ts` `GUARD_FILES` listája. Ezek nem „másolt
  leltár” szemét-minták.
- a deploy (`railway.json`, start-parancs).

Tartsd meg ezeket is:

- a hívássorrendet, ha a sorrend megfigyelhető viselkedés (például a
  Számlázz.hu-lekérdezés a beküldés ELŐTT, vagy a zár alatti újraolvasás);
- a hihető hibamódú regressziókat;
- a forrás-ellenőrzést, ha az a legolcsóbb önálló őr: elbukik, ha a szerződés
  változik (a felhasználónak látszó kulcs, bájt vagy útvonal), és túléli a
  pusztán azonosító-átnevezést;
- a megtartott tesztet, amely az alapállapoton bukik. Ezt kezeld lehetséges
  termékhibaként: reprodukáld, és a gazdát javítsd, ne a tesztet töröld.

A statikusság vagy a lassúság nem törlési ok. Egy implementációra hasonlító
teszt is lehet az önálló szerződés; törlés előtt bizonyítsd az ellenkezőjét.

## Jelölt-bizonyíték

Szerkesztés előtt rögzíts minden alábbi mezőt. Ha egy mező hiányzik, a jelölt
nem törölhető:

- a teszt pontos neve és helye;
- milyen hibát tud valójában észlelni;
- a lefedett éles vagy támogató varrat nem-teszt hívói;
- az erősebb, megmaradó gazdahatár-bizonyíték, vagy hogy miért nem kell
  bizonyíték;
- a releváns előzmény, és hogy miért létezik a teszt vagy a varrat;
- milyen éles vagy tesztsegéd-törlést tesz lehetővé;
- a kockázat és a fókuszált ellenőrző parancs.

## Szerkesztés alakja

Válassz egy összefüggő, gazdahatár szerinti köteget. A tesztnek szóló
exportokat, globálisokat, becsomagolókat és halott éles útvonalakat töröld,
ne tarts meg helyettük aliasokat. Kivétel: a külső hívók injektálási pontjai
(`postXml`, `queryByKulsoAzon`, a meglévő `fetchImpl` paraméterek) és az
injektált `sleep` maradnak (CLAUDE.md 15.; írási kapu, 4. kérdés).

A megtartott regressziókat vidd a tesztgazdájukhoz. Az ismétlődő csomag- vagy
függőség-állításokat vond össze egy általános szerződésbe.

Előnyben az a változás, amely után az éles kód sorainak száma összességében
csökken. Ne adj hozzá olyan pótló tesztet, amely ugyanazt az implementációt
ismétli, és ne alakíts bizonytalan jelöltet takarítássá, csak hogy nőjön a
törlésszám.

A tilos zónák itt is érvényesek:
- **1. zóna:** titok fixtúrába csak kifejezetten jelölt `DUMMY` értékként
  kerülhet (kézikönyv 2.1).
- **2. zóna:** a plugin `confirmOrder`-jét tesztben sem importálod, és nem
  hívod sikeres jóváhagyásra. Azok az őrtesztek viszont megtartandók, amelyek
  azt bizonyítják, hogy az adapter `confirmOrder`-je mindig dob.
- **3. zóna:** migrációt nem szerkesztesz. A G1–G4 őröket és a
  `GUARD_FILES` listáján szereplő fájlokat emberi jóváhagyás nélkül nem
  törlöd, nem nevezed át és nem gyengíted (`docs/ci-orok.md`).
- **4. zóna:** jogosultsági őrtesztet csak emberi jóváhagyással gyengítesz.

## Ellenőrzés

Futó Vitest mellett soha ne szerkessz forrást vagy tesztet ugyanabban a
checkoutban (vö. CLAUDE.md 20b: a mérés és a stage közti versenyhelyzet).
Párhuzamos ügynökök saját git worktree-ben, tiszta fájl-tulajdonlással
dolgoznak (CLAUDE.md 16. és 19.).

1. Futtasd a legkisebb gazda- és testvértesztet:
   `npx vitest run <fájlok vagy szűrő>`.
2. Kivett forrás-grep vagy terv-állítás esetén futtasd azt a szkriptet vagy
   próbafutást, amely a valódi szerződés gazdája. Ilyen például
   `npm run content:owner` próbafutásban (`OWNER_CONTENT_CONFIRM` nélkül),
   vagy a `./node_modules/.bin/payload migrate`. Mindkettőt migrált helyi
   Postgresen futtasd (CLAUDE.md 22a–22c), soha nem éles `DATABASE_URI`-val.
3. Célzott formázás és ellenőrzés:
   - `npx prettier --check <fájlok>`;
   - `npx eslint <fájlok>`;
   - `git diff --check`.
4. A változás végén a repó-szabály szerinti teljes kapu (CLAUDE.md
   „PR-elvárások”, `.github/workflows/ci.yml`): `npm run lint`,
   `npm run typecheck`, `npm run test`.
   - Éles kód, collection, konfiguráció vagy útvonal változásakor
     `npm run generate:types` (a `src/payload-types.ts` nem változhat) és
     `npm run build` is: helyben, vagy a PR `ci.yml` build jobjában, mielőtt
     a munkát késznek jelented.
   - A teljes tesztcsomagot migrált helyi Postgresszel futtasd (`DATABASE_URI`,
     `PAYLOAD_SECRET`, `./node_modules/.bin/payload migrate`; CLAUDE.md
     22a–22c). Adatbázis nélkül a DB-kapus fájlok
     (`src/__tests__/helpers/db-available.ts`, például
     `refund-intent-store-db`, `refund-access-store-db`,
     `order-status/conditional-status-db`, `webhook-audit-db`) helyben NÉMÁN
     kimaradnak. Ilyenkor a kimaradt fájlokat jelentsd, és a zöld CI a
     bizonyíték.
   - Node 24.20.0-tól (`.nvmrc`, `ci.yml` `NODE_VERSION`) eltérő
     futtatókörnyezetben a `ci-platform-security-guard.test.ts` „az install
     verifier hostile PATH mellett sem futtat ambient npm-et” tesztje
     környezeti okból bukik (`Node … is not reviewed Node 24.20.0`). Ezt
     jegyezd fel, de más bukást ne írj ennek a számlájára.
   - Terhelés miatti időtúllépésnél futtasd újra azt a fájlt önmagában, és
     bizonyítsd, hogy átmegy.
5. Nézd meg a `git diff --numstat`-ot, és az éles vagy eszköz-kódot a
   tesztektől és tesztsegédektől külön jelentsd.
6. A stage-elt állapotot ellenőrizd, ne a lemezét (CLAUDE.md 20b). Commit
   `git commit -F -` + heredoc-kal (CLAUDE.md 21.).
7. Az utolsó audit-szerkesztés után kötelező a független átnézés: vezetői
   átnézés és egy mutációs átnézés, amely szándékos hibával próbálja
   bizonyítani, hogy egy megmaradt teszt nem véd (lásd CAMPAIGN.md, 6. lépés).

## Merge és folytatás

Commit, push, PR vagy merge csak felhatalmazással. A branch- és
PR-konvenció a CLAUDE.md szerint.

Egyszerre egy összefüggő PR-t merge-elj. Merge után frissíts a jelenlegi
`main`-ről, és futtasd újra a csak olvasó felderítést a következő, nagy
bizonyosságú kötegre. Merge után a CI-t és a Railway-t figyelni kell
(CLAUDE.md 23.).

## Átadás

Jelentsd:

- a gyökérokot és az eltávolított alacsony értékű kategóriákat;
- az éles gazda egyszerűsítéseit;
- a megtartott hamis pozitívokat, és hogy miért maradnak értékesek;
- a ténylegesen futtatott fókuszált és teljes bizonyítékot (a kimaradt
  DB-kapus fájlokkal együtt);
- az éles és a teszt kód sorainak számát külön;
- a PR és a merge állapotát;
- a megnevezett követő feladatokat.

---

Forrás: az OpenClaw `test-audit` skillje, a 2026-09-24-i átvétel állapota
(https://github.com/openclaw/openclaw/blob/76c072404787ee78c822a0a134363762fe2be6c0/.agents/skills/test-audit/SKILL.md),
Copyright (c) 2026 OpenClaw Foundation, MIT-licenc. A Kineticare-változat
fordítás és átdolgozás a saját parancsainkra, tilos zónáinkra és
tanulságainkra. Az MIT-licenc teljes szövege:
[LICENSE-openclaw.txt](LICENSE-openclaw.txt).
