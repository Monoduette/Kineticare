# Tesztritkító kampány (egy alrendszer teljes tesztfelülete)

A kampány egyetlen PR-ben ritkítja meg egy alrendszer teljes tesztfelületét.
Alrendszer például:
- a számlázás (`src/lib/szamlazz/**` és a számla-jobok);
- a fizetési lánc (checkout, Barion, callback, order-poll, refund);
- a vevői hozzáférés (`src/lib/course-access.ts`, `src/lib/access-grants.ts`).

A [SKILL.md](SKILL.md) értékmércéje, megtartási mércéje, jelölt-bizonyítéka
és ellenőrzése minden sávra érvényes. Ez a fájl a munka sorrendjét és egy
teljes kampány tanulságait adja hozzá. Minden lépés a saját kész-feltételével
zárul; a következőt ne kezdd el korábban.

## 1. Alapállapot

Rögzítsd egy rögzített `main` SHA-n:
- hány sor az alrendszer tesztje és tesztsegédje;
- minden tesztfájl átmenő vagy bukó állapotát.

A DB-kapus fájloknál rögzítsd, hogy ténylegesen futottak-e: adatbázis nélkül
`skipped`, nem átmenő (`src/__tests__/helpers/db-available.ts`).

Az alapállapotban bukókat külön listán tartsd. Az eredeti (OpenClaw)
kampányban mindhárom ilyen valódi termékhiba volt, nem elavult teszt.

Kész, ha a hatókör minden tesztfájljának van rögzített alapállapot-eredménye.

## 2. Sávok és leltár

A felületet az éles gazdahatárok mentén oszd **sávokra**, ne
fájlnév-előtagok szerint. Kineticare-példa a fizetési láncra:
- Start és pénztár;
- GetState és állapotleképezés;
- callback és webhook-retry;
- order-poll és late-success;
- rendelés-állapotgép (order-status);
- visszatérítés (intent, recovery, automatikus);
- tesztsegédek és fixtúrák:
  - `src/__tests__/refund-fixture.ts`, `src/__tests__/empty-refund-ledger.ts`;
  - a tesztfájlokban helyben definiált Barion-mockok (közös Barion-mock fájl
    nincs).

Vedd bele az alrendszer eseteit a közös határokon is. Vedd bele az élő próbák
tesztjeit is: a `src/__tests__/*.browser.mjs` harnesseket és a
`.cursor/skills/verify-kineticare` csak olvasó próbáit, ha az alrendszert
érintik.

Kész, ha az alrendszer minden tesztfájlja és forgatókönyve pontosan egy sávba
tartozik.

## 3. Csak olvasó jelölési jegyzék sávonként

Minden sávot egy saját, csak olvasó ügynök kap. Az ügynök a kiosztott
tesztet teljes egészében elolvassa, a paramétertáblákkal együtt. Elolvassa az
éles gazdákat és azok belépési pontjait, hívóit, előzményét és CI-útvonalát
is. Minden tesztdeklaráció egy jelöléssel egy írott **jelölési jegyzékbe**
kerül. Egy `it.each` egy deklaráció, hacsak a sorai nem kapnak különböző
jelölést; akkor soronként jelölj.

- `R` (megtartás): nevezd meg a szerződést és az elkapott hibát. Ha a teszt
  csak jobb nevű fájlba költözik, `R` marad, a költözés megjegyzésével.
- `F` (javítás): a szerződés marad, az állítást javítani kell. Például egy
  üresen teljesülő (vacuous) negatív állítás, amely akkor is átmegy, ha a több
  elem közül csak egy hiányzik.
- `C` (összevonás): nevezd meg a tesztgazdát, amely először átveszi az
  állítást. Ez lehet egy testvér táblázatos eset, egy erősebb határ
  tesztcsomagja vagy egy másik modul közös tesztgazdája.
- `D` (törlés): nevezd meg a megmaradó bizonyítékot, vagy hogy miért nincs
  szerződés.

A tesztet az állításai alapján ítéld meg, ne a neve alapján.
- Eredeti példa: egy „ablak lezárását” ígérő teszt azt állította, hogy az
  ablak NEM zárult le.
- Kineticare-példa: egy „forgatást” ígérő order-poll teszt nem állított
  forgatást.

Kész, ha a sáv minden deklarációjának van jelölése és egy bizonyíték-sora.

## 4. Rétegterv sávonként

A tesztenkénti jelölési jegyzék bemenet, nem szerkesztési lista. Egy második,
csak olvasó menet a jegyzékből indulva a felesleges **réteget** keresi.
Például több tesztcsomag ugyanazt a közös segédet játssza újra egy mockolt
együttműködőn keresztül, miközben egy erősebb, valódi határ tesztcsomagja már
bizonyítja.

Nevezd meg minden szerződés **tesztgazdáját**. Előnyben a valódi határ hamis
hálózattal (injektált `postXml`, `vi.stubGlobal('fetch', …)`) a mockolt
együttműködővel szemben. Javítsd a jegyzék hibáit, amelyeket ez a menet talál.

Kész, ha minden sávterv megnevezi:
- a kivezetett fájlokat;
- szerződésenként a tesztgazdát;
- a tesztgazdákba átvitt állításokat;
- a feloldott varratokat.

## 5. Átállás

Sávonként szerkessz. A közös tesztsegédek és támogató fájlok változását egy
gazdán keresztül sorosítsd (CLAUDE.md 16.: tiszta fájl-tulajdonlás).

Minden sávval töröld azokat a varratokat, amelyeket a sáv felold. Ilyen
például egy injektálási paraméter, getter, reset-export vagy közvetítő réteg,
amelyre éles hívónak nincs szüksége. Kivétel: a külső hívók injektálási
pontjai (`postXml`, `queryByKulsoAzon`, a meglévő `fetchImpl` paraméterek) és
az injektált `sleep` maradnak. A CLAUDE.md 15. tanulsága szerint tesztből nem
mehet ki valódi hálózati hívás (SKILL.md, írási kapu, 4. kérdés).

Tesztfájl áthelyezésekor, átnevezésekor vagy törlésekor igazítsd a repó
tesztleltárait:
- a `src/__tests__/db-gated-coverage-guard.test.ts` `DB_GATED_TEST_FILES`
  listáját;
- a `src/__tests__/guard-files-integrity.test.ts` `GUARD_FILES` listáját;
- a `docs/ci-orok.md`-t és a kézikönyv 4.6 táblázatát;
- a `vitest.config.ts` `include`-ját.

Ezek a leltár-őrök a megtartási mérce alá esnek, nem „másolt leltár”
szemét-minták. A `GUARD_FILES` listáján szereplő őrfájlhoz csak emberi
jóváhagyással nyúlj (3. tilos zóna).

A kampány során talált tartós teszt-tulajdonlási szabályokat írd az
`AGENTS.md` „Tesztelés” szakaszába. Csak a valóban megtalált hibákból levont
szabály kerüljön be.

Kész, ha minden sávterv alkalmazva van, és minden sáv tesztgazdái átmennek.

## 6. Megőrzési átnézés

Mielőtt késznek mondod, független átnézők vessék össze a törölt lefedettséget
a tesztgazdákkal, határcsoportonként egy átnéző.
- Olyan szerződést keresnek, amely elvesztette egyetlen bizonyítékát.
- Olyan új állítást is keresnek, amely nem tud elbukni. Ilyen például egy
  elutasítási sor, amelyet az éles kód soha nem ér el.

Az eredeti (OpenClaw) kampányban ez az átnézés kilenc valódi hiányt és egy
elérhetetlen állítást talált.

Minden visszaállított szerződésnél végezz egy szándékos **mutációt** az éles
gazdán. Győződj meg róla, hogy a tesztgazda pirosra vált, majd állítsd vissza
a forrást bájtra pontosan.

Kész, ha minden jelzett hiányt helyreállítottál, vagy forrásbizonyítékkal
elvetettél, és minden visszaállított szerződésnek van elkapott mutációja.

## 7. Termékhibák

Az alapállapotban bukó teszt, amely egy tesztgazdában is túlél,
hibajelentés. Javítsd a gazdájánál, külön commitban. Bizonyítsd a valódi
gazdahatáron, injektált hálózattal (CLAUDE.md 15.), egy **kontroll**-futással:
a javítás visszavonásakor a régi viselkedés látszik.

Fizetési vagy számlázási hibát élőben próbálni TILOS:
- sem a productionön (valódi Barion, valódi NAV-számla);
- sem a kivezetett `Kineticare-demo`-n (CLAUDE.md 24.).

Barion-sandboxos végigjátszás (`docs/e2e-staging-runbook.md`,
`docs/barion-sandbox-setup.md`) csak emberi jóváhagyással, helyi vagy külön
staging példányon történhet.

A kampány közben talált, nem kapcsolódó termékeltéréseket követő feladatként
rögzítsd, ne a kampányban javítsd.

Kész, ha minden javított hibának van bukó kontrollja és átmenő jelöltje
ugyanazon a harnessen.

## 8. Egyeztetés és átadás

A kampányok sok `main`-commitot túlélnek. Hosszú, sok commitos kampánynál a
`main`-t merge-eld, ne rebase-eld.

Ha a `main` olyan fájlt módosított, amelyet a kampány törölt, a törlés marad.
Az új szerződést vidd át a tesztgazdába, és ellenőrizd, hogy minden új
regressziónak, amelyet a `main` hozott, maradt otthona.

Futtasd újra az egész alrendszer tesztcsomagját. A merge-elt fejen ismételd
meg a nem író élő próbát: a vevői felületre a `.cursor/skills/verify-kineticare`
csak olvasó (GET) próbáit. Pénzmozgással vagy számlával járó élő próba itt
sem futhat.

Ilyen nagy diffnél a review-eszközök csonka fájllistát láthatnak.

Az átadás a [SKILL.md](SKILL.md) jelentése, továbbá:
- a tesztek és a segédek sorainak száma az alapállapotban és a
  végállapotban, az éles kód külön számolva;
- a sávok, a kivezetett rétegek és a tesztgazdák;
- a talált megőrzési hiányok és a mutációik;
- a termékhibák a kontroll- és a jelölt-bizonyítékkal.

---

Forrás: az OpenClaw `test-audit/CAMPAIGN.md`, a 2026-09-24-i átvétel állapota
(https://github.com/openclaw/openclaw/blob/76c072404787ee78c822a0a134363762fe2be6c0/.agents/skills/test-audit/CAMPAIGN.md),
Copyright (c) 2026 OpenClaw Foundation, MIT-licenc (a teljes szöveg:
[LICENSE-openclaw.txt](LICENSE-openclaw.txt)). Fordítás és átdolgozás a
Kineticare-hez.
