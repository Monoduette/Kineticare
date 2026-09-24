# Teszt-kampány (egy alrendszer teljes tesztfelülete)

A kampány egyetlen PR-ben rendezi egy alrendszer teljes tesztfelületét.
Alrendszer például:
- a számlázás (`src/lib/szamlazz/**` és a számla-jobok);
- a fizetési lánc (checkout, Barion, callback, order-poll, refund);
- egy core terület.

A [SKILL.md](SKILL.md) értékmércéje, megtartási mércéje,
jelölt-bizonyítéka és ellenőrzése minden sávra érvényes. Ez a fájl a munka
sorrendjét és egy teljes kampány tanulságait adja hozzá. Minden lépés a saját
kész-feltételével zárul; a következőt ne kezdd el korábban.

## 1. Alapállapot

Rögzítsd az alrendszer teszt- és tesztsegéd-sorszámát, és minden tesztfájl
átmenő vagy bukó állapotát egy rögzített `main` SHA-n. Az alapállapotban
bukókat külön listán tartsd: az eredeti (OpenClaw) kampányban mindhárom ilyen
valódi termékhiba volt, nem elavult teszt.

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
- tesztsegédek és fixtúrák (`refund-fixture.ts`, Barion-mockok).

Vedd bele az alrendszer eseteit a közös core határokon, és az éles próbák vagy
E2E-forgatókönyvek tesztjeit is.

Kész, ha az alrendszer minden tesztfájlja és forgatókönyve pontosan egy sávba
tartozik.

## 3. Csak olvasó főkönyv sávonként

Minden sávot egy saját, csak olvasó ügynök kap. Az ügynök a kiosztott
tesztet teljes egészében elolvassa, a paramétertáblákkal együtt. Elolvassa az
éles gazdákat és azok belépési pontjait, hívóit, előzményét és CI-útvonalát
is. Minden tesztdeklaráció egy jelöléssel egy írott **főkönyvbe** kerül. Egy
`it.each` egy deklaráció, hacsak a sorai nem kapnak különböző jelölést; akkor
soronként jelölj.

- `R` (megtartás): nevezd meg a szerződést és az elkapott hibát. Ha a teszt
  csak jobb nevű fájlba költözik, `R` marad, a költözés megjegyzésével.
- `F` (javítás): a szerződés marad, az állítást javítani kell. Például egy üres
  negatív, amely akkor is átmegy, ha a több elem közül csak egy hiányzik.
- `C` (összevonás): nevezd meg a gazdát, amely először átveszi az állítást.
  Ez lehet egy testvér táblázatos eset, egy erősebb határ tesztcsomagja vagy
  egy másik modul közös gazdája.
- `D` (törlés): nevezd meg a megmaradó bizonyítékot, vagy hogy miért nincs
  szerződés.

A tesztet az állításai alapján ítéld meg, ne a neve alapján.
- Eredeti példa: egy „ablak lezárását” ígérő teszt azt állította, hogy az
  ablak NEM zárult le.
- Kineticare-példa: egy „forgatást” ígérő order-poll teszt nem állított
  forgatást.

Kész, ha a sáv minden deklarációjának van jelölése és egy bizonyíték-sora.

## 4. Rétegterv sávonként

A tesztenkénti főkönyv bemenet, nem szerkesztési lista. Egy második, csak
olvasó menet a főkönyvből indulva a felesleges **réteget** keresi. Például
több tesztcsomag ugyanazt a közös segédet játssza újra egy mockolt
együttműködőn keresztül, miközben egy erősebb, valódi határ tesztcsomagja már
bizonyítja.

Nevezd meg minden szerződés **őrzőjét**. Előnyben a valódi határ hamis
hálózattal (injektált `fetch`, `postXml`) a mockolt együttműködővel szemben.
Javítsd a főkönyv hibáit, amelyeket ez a menet talál.

Kész, ha minden sávterv megnevezi:
- a kivezetett fájlokat;
- szerződésenként az őrzőt;
- az őrzőkbe átvitt állításokat;
- a feloldott, csak tesztnek szóló éles varratokat.

## 5. Átállás

Sávonként szerkessz. A közös tesztsegédek és támogató fájlok változását egy
gazdán keresztül sorosítsd (CLAUDE.md 16.: tiszta fájl-tulajdonlás).
Minden sávval töröld azokat a csak tesztnek szóló éles varratokat, amelyeket a
sáv felold. Ilyen például egy injektálási paraméter, getter, reset-export vagy
közvetítő réteg, amelyre éles hívónak nincs szüksége.

Ha van tesztleltár vagy a CI-ben tesztútvonal, igazítsd hozzá. A kampány során
talált tartós teszt-tulajdonlási szabályokat írd az `AGENTS.md` „Tesztelés”
szakaszába. Csak a valóban megtalált hibákból levont szabály kerüljön be.

Kész, ha minden sávterv alkalmazva van, és minden sáv őrzői átmennek.

## 6. Megőrzési átnézés

Mielőtt késznek mondod, független átnézők vessék össze a törölt lefedettséget
az őrzőkkel, határcsoportonként egy átnéző.
- Olyan szerződést keresnek, amely elvesztette egyetlen bizonyítékát.
- Olyan új állítást is keresnek, amely nem tud elbukni. Ilyen például egy
  elutasítási sor, amelyet az éles kód soha nem ér el.

Minden visszaállított szerződésnél végezz egy szándékos **mutációt** az éles
gazdán. Győződj meg róla, hogy az őrző pirosra vált, majd állítsd vissza a
forrást bájtra pontosan.

Kész, ha minden jelzett hiányt helyreállítottál, vagy forrásbizonyítékkal
elvetettél, és minden visszaállított szerződésnek van elkapott mutációja.

## 7. Termékhibák

Az alapállapotban bukó teszt, amely egy őrzőben is túlél, hibajelentés.
Javítsd a gazdájánál, külön commitban. Bizonyítsd a valódi felhasználói
folyamaton, egy **kontroll**-futással: a javítás visszavonásakor a régi
viselkedés látszik.

A kampány közben talált, nem kapcsolódó termékeltéréseket követő feladatként
rögzítsd, ne a kampányban javítsd.

Kész, ha minden javított hibának van bukó kontrollja és átmenő jelöltje
ugyanazon a harnessen.

## 8. Egyeztetés és átadás

A kampányok sok `main`-commitot túlélnek. Hosszú, sok commitos kampánynál a
`main`-t merge-eld, ne rebase-eld. Ha a `main` olyan fájlt módosított, amelyet
a kampány törölt, a törlés marad. Az új szerződést vidd át az őrzőbe, és
ellenőrizd, hogy minden új regressziónak, amelyet a `main` hozott, maradt
otthona. Futtasd újra az egész alrendszer tesztcsomagját, és ismételd meg az
éles vagy E2E-próbát a merge-elt fejen.

Ilyen nagy diffnél a review-eszközök csonka fájllistát láthatnak. Az általános
kompatibilitási kapcsolókról hozott karbantartói döntéseket a PR
bizonyítékában rögzítsd, ne a kapuk átírásával.

Az átadás a [SKILL.md](SKILL.md) jelentése, továbbá:
- az alapállapot és a végállapot teszt- és segéd-sorszáma, az éles kód külön
  számolva;
- a sávok, a kivezetett rétegek és az őrzők;
- a talált megőrzési hiányok és a mutációik;
- a termékhibák a kontroll- és a jelölt-bizonyítékkal.

---

Forrás: az OpenClaw `test-audit/CAMPAIGN.md`
(https://github.com/openclaw/openclaw/blob/main/.agents/skills/test-audit/CAMPAIGN.md),
Copyright (c) 2026 OpenClaw Foundation, MIT-licenc (a teljes szöveg:
[LICENSE-openclaw.txt](LICENSE-openclaw.txt)). Fordítás és átdolgozás a
Kineticare-hez.
