# 11 Riasztás és ügyelet

**Mikor:** riasztás-levél érkezett („Kineticare riasztás: …” tárggyal), vagy a
riasztási csatornákat most kell beállítani.

## Hogyan jut el hozzád egy hiba

A rendszer minden olyan hibát, amely emberi beavatkozást kér, **riasztásként**
ír a naplóba (az üzenet „RIASZTÁS” szóval kezdődik, vagy riasztáskódot kap).
Egy riasztás egyszerre négy helyen jelenik meg, egymástól függetlenül:

| Csatorna           | Mit kapsz                                                                                     | Beállítás |
| ------------------ | --------------------------------------------------------------------------------------------- | --------- |
| Riasztás-levél     | Levél az `OWNER_ALERT_EMAILS` címre: mi történt, riasztáskód, időpont, rendelésszám           | 1. pont   |
| PostHog `kc_alert` | Esemény a PostHogban, erre e-mailes riasztás állítható (ha a levélküldés maga romlik el)      | 2. pont   |
| Railway-napló      | A naplósor `alert: true` és `alertCode` mezővel, szűrő: `@alert:true` vagy `@alertCode:<kód>` | nem kell  |
| Napi összesítő     | A nyitott ügyek reggel egy levélben ([01](01-napi-ellenorzes.md))                             | 1. pont   |

Ugyanarra a riasztáskódra **legfeljebb óránként egy levél** jön; a következő
levél megírja, hányszor ismétlődött közben. Egy hibavihar idején óránként
legfeljebb 20 riasztás-levél megy ki. A levélben személyes adat a
rendelésszámon kívül nincs.

A job-workerek leállását (nincs számlázás, nincs callback-pótlás) külön
**életjel** figyeli (3. pont): ha az ötpercenkénti ping elmarad, a külső
figyelő szól.

## Egyszeri beállítás (fejlesztő és tulajdonos)

A változók értékét senkinek ne küldd el, és ne írd a repóba.

1. **Riasztás-levél:** Railway → Kineticare → Variables:
   `OWNER_ALERT_EMAILS` = a címzettek vesszővel elválasztva (legalább két
   ember: a tulajdonos és egy helyettes). Mentés után redeploy. Beállítás
   nélkül a rendszer nem száll el, de levél nem megy ki, és a naplóban egyszer
   figyelmeztetés jelenik meg.
2. **PostHog, második csatorna:** a PostHogban új Trends insight a `kc_alert`
   eseményre (darabszám), majd Alerts → New alert: „has value”, „more than” 0,
   ellenőrzés óránként, címzett a tulajdonos e-mail-címe. A PostHog trend- és
   SQL-insightra ad riasztást, és „email recipients, Slack channels, Discord
   webhooks” is választható (posthog.com/docs/alerts).
3. **Életjel:** a Healthchecks.io-n (az ingyenes csomag elég) új check
   „Kineticare order-poll” néven. Period: 5 perc („the expected time between
   pings”), Grace time: 15 perc („the additional time to wait before sending an
   alert when a check is late”). Értesítés e-mailben és a telefonos appban. A
   check ping-címét tedd a Railway-be: `HEALTHCHECK_PING_URL`. Az order-poll
   minden sikeres futás végén ide küld egy GET-et (5 mp-es időkorláttal); ha
   20 percig nem jön ping, a Healthchecks riaszt.
4. **Railway:** a projekt-tagok a „Crashed” deployról alapból e-mailt kapnak.
   Ha csapatcsatorna (Discord vagy Slack) van, a Railway projekt-webhookját
   állítsd a Deployment failed és crashed eseményre.
5. **Szolgáltatói állapot:** iratkozz fel a status.barion.com és a
   status.railway.com értesítéseire.
6. **Próba:** a fejlesztő a beállítás után egyszer kiváltja a riasztást egy
   próbakörnyezetben, és megnézi, hogy mind a levél, mind a PostHog-esemény
   megérkezett.

## Ügyelet

- **Elsődleges címzett:** a tulajdonos. **Helyettes:** a tulajdonos által
  kijelölt munkatárs (a nevét itt töltsd ki): ………………
- **Reakcióidő:** fizetési vagy visszatérítési riasztásra 2 órán belül,
  számlázási riasztásra 1 munkanapon belül.
- Szabadság előtt nézd meg, hogy a helyettes címe benne van-e az
  `OWNER_ALERT_EMAILS`-ben.

## Riasztáskódok és teendők

A kód a levélben és a naplóban is szerepel. A saját kóddal küldött riasztások:

| Kód                                             | Mit jelent                                                                                                                                                    | Teendő                                                                                                                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fuggo-fizetes-24-ora`                          | Egy rendelés egy napja „Fizetésre vár”                                                                                                                        | [02](02-fizetett-de-nincs-hozzaferes.md) 4. pont                                                                                                                                                       |
| `refund-ellenorzesre-var`                       | Visszatérítés kimenete tisztázatlan                                                                                                                           | [06](06-visszaterites.md) 4. pont                                                                                                                                                                      |
| `automatikus-visszaterites-sikertelen`          | Dupla fizetés automatikus visszatérítése nem sikerült                                                                                                         | [06](06-visszaterites.md) 5. pont                                                                                                                                                                      |
| `beragadt-job`                                  | Beragadt háttérfeladatot zárt le a rendszer                                                                                                                   | Nincs, csak ha naponta többször jön: fejlesztő                                                                                                                                                         |
| `utemezes-ellenorzes-hiba`                      | Az ütemezés nem éri el az adatbázist                                                                                                                          | Ha egy óránál tovább tart: fejlesztő                                                                                                                                                                   |
| `napi-osszesito-hiba`                           | A napi összesítő nem állt össze                                                                                                                               | Fejlesztő; addig nézd az Irányítópultot                                                                                                                                                                |
| `beragadt-job-lezaras-sikertelen`               | Egy beragadt háttérfeladat lezárása nem sikerült; a rendszer a következő körökben újra megpróbálja                                                            | Nincs; ha a riasztás újra megjön: fejlesztő                                                                                                                                                            |
| `visszaterites-barion-elteres`                  | A Barionban más összeg ment már vissza, mint amit a rendelés nyilvántart (a levél megírja mindkettőt), vagy ez nem dönthető el; a visszatérítés nem indult el | Ne indíts új visszatérítést, se itt, se a Barionban. Eltérésnél egyeztesd a fejlesztővel; ha a levél szerint nem dönthető el, nézz vissza néhány óra múlva: [06](06-visszaterites.md) 3. pont          |
| `visszaterites-barion-elutasitotta`             | A Barion elutasította a visszatérítést, pénz nem mozdult; a levél megírja a Barion-hibakódot és az összeget                                                   | `TooLowBalanceToMakeRefund`: töltsd fel a Barion-tárcát legalább az összegre ([09](09-barion-egyenleg-es-kifizetes.md)), utána indítsd újra ([06](06-visszaterites.md) 3. pont). Más kódnál: fejlesztő |
| `visszaterites-kimenete-ismeretlen`             | A Barion válaszából nem derül ki, megtörtént-e a visszatérítés                                                                                                | Ne indíts új visszatérítést; a panelen a „Feldolgozás folytatása” gomb: [06](06-visszaterites.md) 4. pont                                                                                              |
| `visszaterites-rogzitese-elakadt`               | A Barion visszaigazolta a visszatérítést, de a rendszer nem rögzítette                                                                                        | Ne indíts új visszatérítést; a panelen a „Feldolgozás folytatása” gomb: [06](06-visszaterites.md) 4. pont                                                                                              |
| `visszaterites-feldolgozasa-elakadt`            | A pénz már visszament, de a hozzáférés vagy a bizonylat rendezése nem fejeződött be                                                                           | A panel szövege mondja a teendőt; bizonylatnál [05](05-szamla-storno-helyesbito-kezi.md)                                                                                                               |
| `automatikus-visszaterites-kimenete-ismeretlen` | Az automatikus visszatérítés (dupla fizetés) kimenete tisztázatlan                                                                                            | Kézzel ne térítsd vissza, az ütemezett ellenőrzés tisztázza: [06](06-visszaterites.md) 5. pont                                                                                                         |
| `visszateritesi-ertesito-nem-ment-ki`           | A visszatérítés megtörtént, de a vevőnek szóló értesítőt a levelező szolgáltató elutasította                                                                  | Írd meg kézzel a vevőnek a rendelésszámmal és az összeggel: [06](06-visszaterites.md) 2. pont                                                                                                          |
| `visszateritesi-ertesito-bizonytalan`           | A visszatérítés megtörtént, de nem biztos, hogy a vevő értesítője kiment (időtúllépés, átmeneti hiba vagy kivétel)                                            | A Resend felületén (Emails) keresd a vevő címére a riasztás idején küldött „Visszatérítés: <rendelésszám>” levelet. Ha ott van, ne írj; ha nincs, írj kézzel: [06](06-visszaterites.md) 2. pont        |
| `visszateritesi-ertesito-nincs-szolgaltato`     | Élesben nincs e-mail-szolgáltató beállítva, a vevő értesítője nem ment ki                                                                                     | Azonnal fejlesztő (egyik levél sem megy ki); a vevőnek írj kézzel                                                                                                                                      |
| `helyesbito-nem-kuldheto-be-ujra`               | A helyesbítő számla nem készült el, a rendszer nem talált ilyet, és újra sem küldheti be                                                                      | Keresd meg a Számlázz.hu-fiókban a levélben álló külső azonosítóra; ha nincs, állítsd ki kézzel ([05](05-szamla-storno-helyesbito-kezi.md) 4. pont), és szólj az üzemeltetőnek                         |
| `helyesbito-ujraprobalas-kimerult`              | A helyesbítő háttérbeli ellenőrzése többször hibára futott (a Számlázz.hu nem volt elérhető)                                                                  | Mint az előző sornál: keresd meg a fiókban, ha nincs, [05](05-szamla-storno-helyesbito-kezi.md) 4. pont, és szólj az üzemeltetőnek                                                                     |
| `visszaterites-ujraellenorzes-elmaradt`         | Egy visszatérítés egy héttel későbbi Barion-ellenőrzése elmaradt                                                                                              | Lásd lent: a heti újraellenőrzés                                                                                                                                                                       |

A régebbi riasztások kódja az üzenet első mondatrészéből képződik (ékezet
nélkül, kötőjellel). A leggyakoribbak:

| Kód                                                         | Teendő                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `barion-hitelesitesi-hiba`                                  | A Barion elutasítja a kulcsot: azonnal fejlesztő, fizetés nem megy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `a-szamlazz-hu-konfiguracio-hibas`                          | Számlázási beállítás hibás: fejlesztő                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `a-szamlakiallitas-bekuldesei-kimerultek`                   | [05](05-szamla-storno-helyesbito-kezi.md) 2. pont                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `a-storno-kiallitas-ujraprobalasai-kimerultek`              | [05](05-szamla-storno-helyesbito-kezi.md) 3. pont                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `a-helyesbito-kiallitas-bekuldesei-kimerultek`              | [05](05-szamla-storno-helyesbito-kezi.md) 4. pont                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `hianyos-vevo-szamlazasi-adatok`                            | [05](05-szamla-storno-helyesbito-kezi.md), a vevőtől kérd el az adatot                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `a-vevo-termek-parhoz-mar-letezik-mas-paid-rendeles`        | Dupla fizetés: [06](06-visszaterites.md) 5. pont                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `a-pending-repoll-ujraprobalasai-kimerultek`                | [02](02-fizetett-de-nincs-hozzaferes.md) 4. pont                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `a-barion-elutasitotta-a-fizetesinditast`                   | Fizetés nem megy. Ha a levélben a ModelValidationError kód áll, és közvetlenül egy deploy után jött: a Railway-en add meg a `BARION_SEND_3DS` változót `false` értékkel (idézőjelek nélkül), majd a projekt tetején megjelenő sávban a „Deploy” gombbal alkalmazd (enélkül nem lép életbe), és szólj a fejlesztőnek. Minden más esetben azonnal szólj a fejlesztőnek. Részletek alább, „A 3DS-vészkapcsoló” szakaszban.                                                                                                                                                                                                                                                                                           |
| `a-kurzus-ara-a-barion-10-ft-os-minimuma-alatt-van-igy-nem` | Webshop → **Kurzusok**: a levélben a `source: product-<szám>` mutatja, melyik kurzusról van szó. A szám a kurzus azonosítója: a kurzus közvetlenül a `.../admin/collections/products/<szám>` címen nyílik meg. Az „Ár (Ft)” mező legalább 10 Ft legyen, és ha a kurzuson akció fut, az „Akciós ár (Ft)” mező is (vagy vedd ki az „Akciós kurzus” pipát). Utána kattints a „Módosítások közzététele” gombra. Automatikus mentéskor csak piszkozat készül: a pénztár a közzétételig a régi árat látja, és addig a kurzus nem vásárolható meg. A lista „Ár (Ft)” oszlopa ilyenkor már a piszkozat árát mutatja, ezért abból nem derül ki, hogy elmaradt a közzététel. Ezeket a mezőket csak a tulajdonos állíthatja. |

Minden más kódnál: nézd meg a Railway naplóját a `@alertCode:<kód>` szűrővel,
és ha a teendő nem egyértelmű, küldd el a fejlesztőnek a kódot és a
rendelésszámot.

## A heti újraellenőrzés: `visszaterites-ujraellenorzes-elmaradt`

Egy kártyás visszatérítés napokkal később is meghiúsulhat. Ezért a rendszer
minden visszatérítést nagyjából egy héttel később (a visszatérítés utáni
hetedik és nyolcadik nap között) egyszer újra megnéz a Barionnál. Pénzt ez az
ellenőrzés nem mozgat, csak jelez. Ha nem sikerül lefuttatni, a rendszer
többet nem próbálja, és ezt a riasztást küldi. A riasztás `reason` mezője
mondja meg, miért maradt el:

| `reason`               | Mit jelent                                                                                                                                                                                                             |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kiserletek-elfogytak` | Az ellenőrzés háromszor átmeneti hibával (például időtúllépéssel vagy Barion-fojtással) bukott, nagyjából hatórás szünetekkel.                                                                                         |
| `vegleges-hiba`        | A Barion végleges hibát adott erre a fizetésre, például nem ismeri. Ez jellemzően Barion-környezetváltás után fordul elő.                                                                                              |
| `globalis-hiba`        | Az ellenőrzés az egész futásra leállt (hitelesítési hiba, hibás PaymentState-útvonal vagy Barion-kiesés), és a visszatérítés egy órán belül kiesett volna az ellenőrzési időszakból.                                   |
| `sav-lejart`           | Egy korábbi sikertelen vagy elhalasztott kísérlet után a visszatérítés sikeres ellenőrzés nélkül lépett ki a 7–8 napos időszakból. A riasztás az utolsó hibafajtát (`failureClass`) és a kísérletek számát is megadja. |

**Teendő mindegyiknél:** nézd meg a Barion-fiókban a riasztásban szereplő
rendelés fizetését. Ha a visszatérítés sikertelen, vagy sztornózták
(`StornoUnSuccessfulRefundToBankCard`), a vevő nem kapta meg a pénzt: küldd el
a fejlesztőnek a rendelésszámot. Ha a visszatérítés rendben van, nincs teendő.

Egy Barion-kiesés alatti deploy után a `globalis-hiba` RIASZTÁS hamis is lehet
(a már ellenőrzött visszatérítésről is jöhet); a kézi ellenőrzés ettől még
biztonságos.

## A 3DS-vészkapcsoló (BARION_SEND_3DS)

A fizetésindításkor (Barion Payment/Start) a rendszer a kártyás fizetés
biztonsági ellenőrzéséhez (3DS) négy adatblokkot is elküld: a számlázási
címet, a vásárlás adatait, a vevői fiók adatait és a banki megerősítés
kérésének beállítását. Ezek csökkentik annak esélyét, hogy a vevőnek a bankja
külön megerősítést kérjen. Ha a Barion valamelyik adatot nem fogadja el,
minden fizetésindítást elutasít, és amíg a 3DS-adatok küldését ki nem
kapcsolod, egyetlen vásárlás sem megy át.

A kapcsoló a Railway-en, a Kineticare szolgáltatás változói (Variables)
között állítható. Ha a változó még nincs a listán, a „New Variable” gombbal
vedd fel. Az értéket idézőjelek nélkül írd be.

- **Üres vagy nincs beállítva:** a 3DS-adatok mennek (ez az alapállapot).
- **`true`:** ugyanaz, mint az üres: a 3DS-adatok mennek.
- **`false` (kis- és nagybetű mindegy):** a négy adatblokk kimarad, a
  fizetésindítás a korábbi, 3DS nélküli formában megy. A vásárlás így is
  működik, a vevő legfeljebb gyakrabban kap megerősítést a bankjától.
- **Minden más, nem üres érték (`0`, `off`, `no`, `ki`, `nem` is):** semmit
  nem kapcsol ki, a 3DS-adatok mennek. A napló ilyenkor egyszer figyelmeztet.

A változó mentése önmagában még semmit nem kapcsol: a Railway a módosítást
függőben tartja, és a projektoldal tetején egy sávban jelzi. Előbb a sáv
„Details” gombjával nézd meg, mi vár alkalmazásra: csak a Kineticare
szolgáltatás `BARION_SEND_3DS` változója szerepeljen. A „Deploy” ugyanis
minden függő módosítást egyszerre alkalmaz, és minden érintett szolgáltatást
újraindít. Ha más módosítás is ott van, azt a jobb oldalán álló x-szel vesd
el, vagy kérdezd meg a fejlesztőt. Ezután kattints a „Deploy” gombra (az Alt
billentyű lenyomása nélkül): a Railway csak ekkor alkalmazza a változást, és
újraindítja a szolgáltatást. Alt-kattintásnál a Railway újraindítás nélkül
menti a változást, és a futó szolgáltatás a régi beállítással dolgozik
tovább.

A kapcsoló akkor él, amikor az új deploy a Deployments listán aktívként
(Active) látszik. Ezután egy próbafizetéssel győződj meg róla, hogy a
vásárlás újra működik (az alábbi Élesítési próba 1. lépése szerint, egy
próba is elég): ha a Barion fizetési oldala megnyílik, rendben van. Ha nem
jön újabb riasztás, az még nem bizonyíték, mert ugyanarra a kódra óránként
legfeljebb egy levél megy ki.

A visszakapcsoláshoz töröld a változót, és ugyanígy alkalmazd a „Deploy”
gombbal.

**Élesítési próba** (a fejlesztő végzi, a tulajdonossal egyeztetett
időpontban):

0. Töröld a `BARION_SEND_3DS` változót, alkalmazd a „Deploy” gombbal, és
   várd meg, hogy az új deploy aktív (Active) legyen, és a `GET /admin`
   egészségellenőrzés átmenjen. Addig a szolgáltatás még 3DS nélkül fut, és
   a próba nem ellenőrizne semmit.
1. Indíts két fizetést egy legalább 10 Ft-os kurzusra: egyet vendégként
   (kijelentkezve, olyan e-mail-címmel, amelyhez nincs fiók), egyet pedig
   bejelentkezve, olyan vevői fiókkal, amelyik még nem vette meg a kurzust.
   Egyik próba e-mail-címe se legyen a bolt Barion-fiókjának címe
   (`BARION_PAYEE_EMAIL`): azzal a pénztár már a Barion megkeresése előtt
   hibát ad, így a próba semmit nem mond a 3DS-ről. Olyan e-mail-címet és
   fiókot válassz, amellyel az utóbbi 30 percben nem indult fizetés erre a
   kurzusra (a 0. lépés előtti próbákat is beleértve). Ha indult, a pénztár a
   még nyitott fizetést folytatja: új fizetésindítás nem megy ki, és a próba
   semmit nem ellenőriz. A Barion fizetési oldalán egyiknél se fizess, csak
   zárd be. Ez nem kerül pénzbe, és a próbához elég, mert egy elutasítás már
   a fizetésindításkor visszajön. Két próba kell, mert a rendszer a vendégről
   és a bejelentkezett vevőről más fiókadatot küld a Barionnak.
2. A próba akkor sikeres, ha a Barion fizetési oldala mindkét esetben
   megnyílt, nem jött `a-barion-elutasitotta-a-fizetesinditast` riasztás, és
   a Webshop → Rendelések listáján mindkét próbához tartozik egy új,
   „Fizetésre vár” állapotú rendelés, amely a próba idején jött létre
   (Létrehozva oszlop). Ha valamelyikhez nincs új rendelés, a pénztár egy
   korábbi fizetést folytatott: ismételd meg azt a próbát másik
   e-mail-címmel, illetve másik vevői fiókkal. Ha a pénztár azt írta ki, hogy
   a Barion nem fogadta el a fizetés indítását, vagy megjött a riasztás, a
   próba sikertelen: azonnal add meg újra a `BARION_SEND_3DS` változót
   `false` értékkel, és alkalmazd a „Deploy” gombbal. A hiba okát a levélben
   álló `barionErrorKind` kód és a Railway-napló mutatja; a 3DS-t csak a
   javítás után kapcsold vissza.
3. Ha a bank megerősítési lépését is látni szeretnétek: egy valódi, legalább
   10 Ft-os kártyás vásárlás, majd annak visszatérítése a Kineticare
   adminjából (a Barion felületén soha). A vásárlásról valódi számla, a
   teljes visszatérítésről stornó készül, és a visszatérítéshez a
   Barion-tárcában fedezet kell: előtte nézd át a [06](06-visszaterites.md)
   útmutató 1. pontját.
