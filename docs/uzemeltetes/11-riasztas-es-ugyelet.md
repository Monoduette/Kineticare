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

| Kód                                    | Mit jelent                                            | Teendő                                           |
| -------------------------------------- | ----------------------------------------------------- | ------------------------------------------------ |
| `fuggo-fizetes-24-ora`                 | Egy rendelés egy napja „Fizetésre vár”                | [02](02-fizetett-de-nincs-hozzaferes.md) 4. pont |
| `refund-ellenorzesre-var`              | Visszatérítés kimenete tisztázatlan                   | [06](06-visszaterites.md) 4. pont                |
| `automatikus-visszaterites-sikertelen` | Dupla fizetés automatikus visszatérítése nem sikerült | [06](06-visszaterites.md) 5. pont                |
| `beragadt-job`                         | Beragadt háttérfeladatot zárt le a rendszer           | Nincs, csak ha naponta többször jön: fejlesztő   |
| `utemezes-ellenorzes-hiba`             | Az ütemezés nem éri el az adatbázist                  | Ha egy óránál tovább tart: fejlesztő             |
| `napi-osszesito-hiba`                  | A napi összesítő nem állt össze                       | Fejlesztő; addig nézd az Irányítópultot          |
| `aam-keret-nem-teljes`                 | Nem számolható, mennyi fogyott el az AAM-keretből     | Könyvelő és fejlesztő, lásd lent                 |

**Ha `aam-keret-nem-teljes` jön, vagy a napi összesítő és az Irányítópult
szerint a keret most nem számolható.** A webshop nem tudja kiszámolni, mennyi
fogyott el az alanyi adómentes keretből. Két oka lehet: egy tárgyévi számla
összege hiányzik a rendelésről (a számla a Számlázz.hu-ban megvan, csak a mi
nyilvántartásunkból hiányzik az összeg), vagy a tárgyév számlás rendelései
nem férnek bele a lekérdezés korlátjába. Amíg így van, a napi összesítő és az
Irányítópult a keret helyén azt írja, hogy most nem számolható. Ezt ne vedd
rendben lévő keretnek: a felhasználás 70% fölött is lehet. A napi összesítő
ilyenkor is kimegy a teendőkkel.

1. Kérd el a könyvelőtől a tárgyévi bevételt. Ha eléri a keret 70%-át, a
   [14](14-alanyi-adomentes-keret.md) szerint járj el.
2. Szólj a fejlesztőnek. A Railway-naplóban a `@alertCode:aam-keret-nem-teljes`
   szűrővel talált sor megmutatja az okot, hiányzó összegnél az érintett
   rendeléseket is.

A teendő riasztás-levél nélkül is ez. Ha a levél nem jött meg (például mert az
`OWNER_ALERT_EMAILS` nincs beállítva), a riasztást a fenti Railway-szűrő akkor
is megmutatja, és a PostHog `kc_alert` eseménye is, ha a PostHog a 2. pont
szerint be van állítva.

Okonként naponta legfeljebb egy ilyen riasztás-levél jön. Ha a levél nem ment
ki (például mert a levélküldő szolgáltatás épp hibázott), a rendszer a keret
következő számolásakor újra küldi: az Irányítópult megnyitásakor vagy a napi
összesítő következő próbájánál. Egy új deploy után az első számolás újra
jelez.

A régebbi riasztások kódja az üzenet első mondatrészéből képződik (ékezet
nélkül, kötőjellel). A leggyakoribbak:

| Kód                                                  | Teendő                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------- |
| `barion-hitelesitesi-hiba`                           | A Barion elutasítja a kulcsot: azonnal fejlesztő, fizetés nem megy     |
| `a-szamlazz-hu-konfiguracio-hibas`                   | Számlázási beállítás hibás: fejlesztő                                  |
| `a-szamlakiallitas-bekuldesei-kimerultek`            | [05](05-szamla-storno-helyesbito-kezi.md) 2. pont                      |
| `a-storno-kiallitas-ujraprobalasai-kimerultek`       | [05](05-szamla-storno-helyesbito-kezi.md) 3. pont                      |
| `a-helyesbito-kiallitas-bekuldesei-kimerultek`       | [05](05-szamla-storno-helyesbito-kezi.md) 4. pont                      |
| `hianyos-vevo-szamlazasi-adatok`                     | [05](05-szamla-storno-helyesbito-kezi.md), a vevőtől kérd el az adatot |
| `a-vevo-termek-parhoz-mar-letezik-mas-paid-rendeles` | Dupla fizetés: [06](06-visszaterites.md) 5. pont                       |
| `a-pending-repoll-ujraprobalasai-kimerultek`         | [02](02-fizetett-de-nincs-hozzaferes.md) 4. pont                       |

Minden más kódnál: nézd meg a Railway naplóját a `@alertCode:<kód>` szűrővel,
és ha a teendő nem egyértelmű, küldd el a fejlesztőnek a kódot és a
rendelésszámot.
