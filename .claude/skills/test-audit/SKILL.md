---
name: test-audit
description: Tesztírási kapu és teszt-audit a Kineticare-hez. Használd MINDIG, amikor tesztet írsz, módosítasz, átnézel vagy söpörsz — új regressziós teszt, meglévő teszt átírása, review, teszt-takarítás. Három mód egy értékmércével — írási kapu minden új vagy módosított tesztre; audit az alacsony értékű, implementációhoz kötött, duplikált tesztekre és az általuk életben tartott, csak tesztnek szóló éles kódrészekre; kampány egy teljes alrendszer tesztfelületének rendbetételére.
---

# Teszt-audit a Kineticare-ben

Három mód, egy értékmérce.

- **Írási kapu:** minden új vagy módosított tesztet az írás pillanatában
  szűr.
- **Audit:** fókuszált söprés azokra a tesztekre, amelyek a forráskódot
  ismétlik, erősebb bizonyítékot duplikálnak, a viselkedést az
  implementációhoz kötik, vagy csak tesztnek szóló éles kódrészt (export,
  kapcsoló, becsomagoló, injektálási pont) tartanak életben. Egy nagy audit
  folytatása mindig külön, önmagában egész követő PR. A cél a bizalom, nem a
  törölt sorok száma.
- **Kampány:** egy teljes alrendszer (például a számlázás vagy a fizetési lánc)
  minden tesztfájlját rendbe teszi. Kampány előtt olvasd el a
  [CAMPAIGN.md](CAMPAIGN.md)-t.

A Kineticare-ben a tesztek pénzt (Barion, éles), NAV-számlát (Számlázz.hu, AAM)
és jogi kötelezettséget (45/2014. Korm. rendelet) védenek. Egy teszt, amely
zöld, de semmit nem bizonyít, rosszabb, mint a hiányzó teszt: hamis
biztonságot ad.

## Írási kapu

Mielőtt bármilyen tesztet hozzáadsz, válaszolj négy kérdésre. Ha egyre nincs
válasz, a tesztet még ne add hozzá.

1. Milyen megfigyelhető viselkedést, invariánst vagy önálló szerződést véd?
2. Milyen hihető regresszió buktatja el?
3. Miért nem fogja meg ezt a hibát a meglévő lefedettség? Minden szerződésnek
   egy elsődleges tesztgazdája van, a legerősebb határon. Egy másik rétegnek
   csak saját, külön kockázat miatt van helye (például szállítási vagy
   életciklus-hiba, amit a gazda nem ér el). Közel-duplikált teszt helyett
   bővíts egy táblázatos esetet (`it.each`) vagy egy közös fixtúrát, és a
   duplikált előkészítést ugyanabban a változásban vond össze.
4. Kell-e hozzá éles kódrész (export, kapcsoló, becsomagoló, injektálási pont),
   amelyre éles hívónak nincs szüksége? Ha igen, vidd a tesztet a valódi
   határra. Kivétel: a CLAUDE.md 15. tanulsága szerinti HTTP-injektálás
   (`postXml`, `queryByKulsoAzon`, `fetchImpl`, injektált `sleep`) éles
   szerződés, nem tesztnek szóló varrat: a tesztből soha nem mehet ki valódi
   hálózati hívás.

Utána vesd össze a tesztet minden [szemét-mintával](#szemét-minták). Egyezés
esetén a kapu elutasítja, hacsak a [megtartási mérce](#megtartási-mérce) meg
nem nevezi azt a szerződést, amelyet önállóan őriz. Az a teszt, amely
viselkedést megőrző átszervezésnél eltörne, implementációt állít, nem
viselkedést: írd át a gazda határán, mielőtt bekerül.

**Hibajavítási regressziós teszt** (a Kineticare ellenpróba-szabálya): a
javítás ELŐTTI kódon a szándékolt okból kell elbuknia, a gazda határán végzett
javítás után át kell mennie. Bizonyítsd: a nem-teszt forrásfájlokat állítsd
vissza a szülő commitra (`git checkout HEAD~1 -- <forrásfájlok>` vagy
`git stash push -- <forrásfájlok>`), futtasd, jegyezd fel a bukás üzenetét,
majd állítsd vissza. Az a regressziós teszt, amely soha nem bukott el
bizonyíthatóan, a mockot bizonyítja, nem a javítást. Egy regresszió a gazda
határán lefedi a hibát; ne játszd újra ugyanazt a forgatókönyvet minden
rétegben, amelyen átmegy.

## Szemét-minták

Közös ellenőrzőlista mindkét módhoz: az írási kapu elutasítja az ilyen új
tesztet, az audit a meglévőket keresi.

- lefedettség-szonda állítás nélkül;
- önmagával való összevetés, azonosság-másoló;
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
- fixtúra, amely maga adja azt a nyugtát, engedélyt vagy callback-sorrendet,
  amelyet a gazdának kellene előállítania, vagy olyan tárolóra tett
  perzisztencia-állítás, amelyet az útvonal soha nem ír;
- képesség-teszt, amely a deklarált kapcsolót ismétli ahelyett, hogy a
  kapcsoló által ígért kézbesítést vagy nyugtázást gyakorolná;
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
- a refund-evidence őr egyik ágát (idegen, nem üres POS-azonosító) semmi nem
  tesztelte, az ág törlése nem buktatott tesztet;
- szintetikus POS-azonosítójú fixtúrák (`SYNTHETIC-…`, `DUMMY-…`), miközben
  az éles kód `${orderNumber}-1`-et vár: a fixtúra nem hasonlított az éles
  adatra.

## Értékmérce

Egy teszt akkor éri meg a karbantartását, ha viselkedést, hihető regressziót
vagy önállóan értelmes szerződést véd. Auditban az a meglévő teszt, amelynek
viselkedést megőrző átszervezéskor változnia kell, gyanús, de nem
automatikusan törölhető. Az írási kapu az új ilyeneket továbbra is elutasítja.

Mielőtt egy jelöltről ítélsz, olvasd el:

- a teljes tesztet és az éles gazdát, a belépési pontját, hívóit és hívottjait;
- a testvér-implementációkat és az átfedő teszteket;
- a CI-útvonalat (`.github/workflows/ci.yml`) és a releváns git-előzményt.

A `CLAUDE.md` és az `AGENTS.md` „Tesztelés” szakaszát mindig olvasd el először.
Ha a teszt függőségre épülő viselkedést állít (Payload, Barion, Számlázz.hu,
Resend), nézd meg közvetlenül a függőség forrását vagy típusait. Külső szerződésnél
a hivatalos dokumentációt is: Barion a Wayback-en, Számlázz.hu XSD-k a
`src/__tests__/szamlazz/xsd/` mappában.

## Felderítés

A felderítés csak olvas; bizonyítékot jelents, mielőtt szerkesztesz. Széles
hatókörnél futtass párhuzamos felderítő sávokat, a Kineticare gazdahatárai
mentén:

- fizetési lánc: `src/lib/checkout/**`, `src/lib/barion/**`,
  `src/lib/barion-callback/**`, `src/lib/order-poll/**`,
  `src/lib/order-status/**`, `src/lib/refund/**`;
- számlázás: `src/lib/szamlazz/**` és a számla-jobok;
- e-mail és jogi szöveg: `src/lib/email/**`, `src/lib/order-paid.ts`,
  `src/lib/legal-*`, `src/scripts/apply-owner-content.ts`;
- CMS és admin: `src/plugins/**`, `src/collections/**`,
  `src/components/admin/**`;
- vevői felület és útvonalak: `src/components/**`, `src/app/**`;
- szkriptek, jobok, eszközök: `src/scripts/**`, `src/jobs/**`, CI;
- átfogó mintakeresés a szemét-mintákra.

Kampányon kívül néhány nagy bizonyosságú jelölt többet ér egy nagy, spekulatív
leltárnál.

## Megtartási mérce

Tartsd meg a tesztet, ha önállóan kikényszerít egy szerződést. A Kineticare-ben
ilyen szerződés:

- a pénzmozgás (Barion Start, GetState, Refund, callback) és a rendelés
  állapotgépe;
- a NAV-számla (XSD-érvényesség, AAM/27 áfa-mód, teljesítési dátum,
  idempotencia);
- a jogi szöveg (45/2014. 18. §, 29. § (1) m), ÁSZF, visszaigazolás tartós
  adathordozón);
- a jogosultság (4. tilos zóna) és a migráció (3. tilos zóna, G3/G4 őrök);
- a biztonság és adatvédelem (redakció, nincs PII a naplóban);
- a konfiguráció és az indulási őrök (`src/env.ts`, instrumentation);
- a nyilvános API és az útvonalak;
- a CLAUDE.md-szabályok őr-tesztjei (például a három betűméret-token, a
  `push: false`, a jogi linkfeliratok);
- a termektervezes skill mért UI-őrei (kontraszt, érintési cél, 320 px-es
  reflow);
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
ne tarts meg helyettük aliasokat. A megtartott regressziókat vidd a kanonikus
gazdájukhoz. Az ismétlődő csomag- vagy függőség-állításokat vond össze egy
általános szerződésbe.

Előnyben a nettó negatív éles sorszám. Ne adj hozzá olyan pótló tesztet, amely
ugyanazt az implementációt ismétli, és ne alakíts bizonytalan jelöltet
takarítássá, csak hogy nőjön a törlésszám.

A tilos zónák itt is érvényesek: migrációt nem szerkesztesz, jogosultsági
őr-tesztet csak emberi jóváhagyással gyengítesz, `confirmOrder` tesztben sem
jelenhet meg.

## Ellenőrzés

Futó Vitest mellett soha ne szerkessz forrást vagy tesztet ugyanabban a
checkoutban. Párhuzamos ügynökök mindig saját git worktree-ben dolgoznak
(CLAUDE.md 16–20b).

1. Futtasd a legkisebb gazda- és testvértesztet:
   `npx vitest run <fájlok vagy szűrő>`.
2. Kivett forrás-grep vagy terv-állítás esetén futtasd azt a szkriptet vagy
   próbafutást, amely a valódi szerződés gazdája. Ilyen például
   `npm run content:owner` próbafutásban, vagy a `payload migrate` helyi
   Postgresen.
3. Célzott formázás és ellenőrzés:
   - `npx prettier --check <fájlok>`;
   - `npx eslint <fájlok>`;
   - `npm run typecheck`;
   - `git diff --check`.
4. A változás végén egyszer a teljes csomag: `npm run test`.
   - Az ismert, csak a sandboxban bukó `ci-platform-security-guard`
     „hostile PATH” tesztet jegyezd fel.
   - Terhelés miatti időtúllépésnél futtasd újra azt a fájlt önmagában, és
     bizonyítsd, hogy átmegy.
5. Nézd meg a `git diff --numstat`-ot, és az éles vagy eszköz-kódot a
   tesztektől és tesztsegédektől külön jelentsd.
6. A stage-elt állapotot ellenőrizd, ne a lemezét (CLAUDE.md 20b). Commit
   `git commit -F -` + heredoc-kal.
7. Az utolsó audit-szerkesztés után kötelező a független átnézés: vezetői
   review és egy „törő” review, amely mutációval próbálja bizonyítani, hogy
   egy megmaradt teszt nem véd (lásd CAMPAIGN.md, 6. lépés).

## Landolás és folytatás

Commit, push, PR vagy merge csak felhatalmazással. A branch- és
PR-konvenció a CLAUDE.md szerint.

Egyszerre egy összefüggő PR-t landolj. Landolás után frissíts a jelenlegi
`main`-ről, és futtasd újra a csak olvasó felderítést a következő, nagy
bizonyosságú kötegre. Merge után a CI-t és a Railway-t figyelni kell
(CLAUDE.md 23.).

## Átadás

Jelentsd:

- a gyökérokot és az eltávolított alacsony értékű kategóriákat;
- az éles gazda egyszerűsítéseit;
- a megtartott hamis pozitívokat, és hogy miért maradnak értékesek;
- a ténylegesen futtatott fókuszált és teljes bizonyítékot;
- az éles és a teszt sorszámot külön;
- a PR és a merge állapotát;
- a megnevezett követő feladatokat.

---

Forrás: az OpenClaw `test-audit` skillje
(https://github.com/openclaw/openclaw/blob/main/.agents/skills/test-audit/SKILL.md),
Copyright (c) 2026 OpenClaw Foundation, MIT-licenc. A Kineticare-változat
fordítás és átdolgozás a saját parancsainkra, tilos zónáinkra és
tanulságainkra. Az MIT-licenc teljes szövege:
[LICENSE-openclaw.txt](LICENSE-openclaw.txt).
