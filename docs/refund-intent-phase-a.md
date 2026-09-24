# Refund intent Phase A

Ez a fázis kizárólag egy szigorú, tiszta V1 domaint és egy passzív Payload
collection-sémát vezet be. A collection regisztrációja miatt a szokásos Payload
REST-végpontok léteznek, de a létrehozás, módosítás és törlés access-denied, az
olvasás pedig kizárólag owner számára engedélyezett. Nincs saját, visszatérítést
végrehajtó endpoint, hook, route, job vagy élő fogyasztó, ezért a jelenlegi
visszatérítési folyamat viselkedése változatlan.

A Payload local API `overrideAccess` opciója önmagában nem biztonsági határ.
A Phase B-hez dedikált író/szolgáltatás, perzisztált és atomi compare-and-set
vagy tranzakciós fegyelem, valamint szolgáltatói reconciliation kell.

## Szekvencia és idempotencia

Minden intenthez pozitív biztonságos egész `refundSequence` tartozik. Azonos
idempotenciakulcsnál az order eltérése invariánssértés; eltérő request hash
`key_payload_mismatch`; azonos hash, de eltérő szekvencia
`key_sequence_mismatch`; csak minden egyezés replay. Egy ugyanahhoz a
rendeléshez tartozó feloldatlan intent bármely új kulcsot blokkol.

Feloldott rekordoknál ugyanazon order és szekvencia egyetlen `committed`
rekordja `sequence_already_committed` konfliktust ad, több committed rekord
`duplicate_committed_sequence` invariánssértés. Más szekvencián committed rekord
nem blokkol új intentet. A `provider_failed` ugyanazon szekvencián is új kulcsot
enged, de csak végleges, szolgáltatói bizonyítékkal alátámasztott nullhatás
esetén. A domain API bizonyíték nélkül nem engedi a `provider_failed` átmenetet,
nem oldja fel az aktív rendelészárat, és a későbbi létrehozási döntés
invariánssértésként elutasít minden olyan `provider_failed` rekordot, amelyből
hiányzik a kanonikus `reconciliationCheckedAt` vagy
`reconciliationReference`. A sikeres átmeneti döntés ezt a két perzisztálandó
mezőt explicit visszaadja; a Phase B írónak ezeket és az állapotot ugyanabban az
atomi műveletben kell mentenie.

Timeout, transport-hiba, hibás válasz vagy elveszett acknowledgement nem
`provider_failed`, hanem `provider_unknown`, majd `manual_review`. A nullhatás
bizonyítéka strukturált `provider_confirmed_no_effect` tény, kanonikus ISO
időponttal és szolgáltatói/reconciliation hivatkozással. Megerősített
siker nem minősíthető vissza; `provider_succeeded` csak `committed` felé léphet.
Zárak önmagukban nem oldják meg azt az esetet, amikor a szolgáltató sikeresen
teljesít, de a válasz elveszik: ehhez egyeztetés és explicit reconciliation kell.

A collection soha nem tárolhat nyers idempotenciakulcsot, teljes kérésbodyt,
teljes szolgáltatói payloadot vagy szabad szöveges hibát. Csak a V1
kéréslenyomat, a domainnel elválasztott kulcsdigest és a minimális egyeztetési
metaadat marad. A kötelező order- és actor-kapcsolatok szándékosan megtartják az
audit kapcsolatát; az intentek létrejötte után a törlést a NOT NULL mezők és a
generált SET NULL viselkedés megakadályozhatja. Aktiválás előtt emberi retention
felülvizsgálat szükséges.

## Migráció és visszaállítás

A konfigurált Payload adapter burka letiltja a `migrate:down`, `migrate:fresh`,
`migrate:refresh` és `migrate:reset` destruktív parancsot, mielőtt az adapter
eredeti implementációja futna. Ez a védelem csak a konfigurált Payload adapter
parancsaira vonatkozik: generált `down` közvetlen meghívása továbbra is szigorúan
tilos. Visszaállításkor csak az alkalmazáskódot szabad visszavonni; a tábla és
az adatok megmaradnak. A főkönyv eltávolítása külön emberi jóváhagyást,
archiválási és megőrzési bizonyítékot, lezárt reconciliationt, valamint új,
előrefelé generált Payload-migrációt igényel.

## Nullhatás-bizonyítékok és a `prepared → provider_failed` él (PR #304)

A `provider_failed` állapot a tartós `reconciliationReference` mezőben mindig
megnevezi, mi bizonyítja, hogy pénz nem mozdult. Három hivatkozás létezik, más
nem fogadható el:

| Hivatkozás                                  | Mikor                                                                                                          | Honnan                               | Kód                                                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `barion:refund-rejected:<kód>[+<kód>…]`     | A Barion a Payment/Refund kérésre dokumentált, végleges hibakóddal válaszolt (pl. `TooLowBalanceToMakeRefund`) | `provider_started`                   | `src/lib/refund/barion-refund-evidence.ts` (`classifyRefundRejection`, `rejectionReference`)      |
| `barion:paymentstate:no-refund-transaction` | Bizonytalan kimenet után a friss GetState-ben nincs új, a forrástranzakcióhoz kapcsolódó visszatérítés         | `provider_unknown` / `manual_review` | `refundEvidenceFromPaymentState`, `src/lib/refund/provider-reconciliation.ts`                     |
| `kineticare:no-provider-request`            | A kísérlet a `provider_started` CAS előtt megszakadt, tehát a Barionnak kérés sem mehetett                     | `prepared`                           | `NO_PROVIDER_REQUEST_REFERENCE` (`src/lib/refund/refund-intent.ts`), `releaseNeverLaunchedIntent` |

**A `prepared → provider_failed` él.** Csak a `kineticare:no-provider-request`
hivatkozással léphető, és ez a hivatkozás fordítva is kötött: elindított
(`provider_started` utáni) kísérletre nem használható, így a
`providerStartedAt` nélküli `provider_failed` sor mindig ezt hordozza
(`decideRefundIntentTransition`, a tároló `parseIntent`-je is ellenőrzi). Az
átmenet SQL CAS a `state = 'prepared'` feltétellel: egy közben mégis elindított
kísérletet nem írhat felül. Lezárja a tulajdonos „Feldolgozás folytatása”
gombja (`reconcileStuckIntent`), és az automatikus út következő futása is
(`settleActiveAutomaticIntent`, `recover-paid-reject.ts`).

**A negyedórás GetState-szabály.** Hiányzó visszatérítésből csak akkor lesz
nullhatás, ha a GetState-lekérdezés INDÍTÁSA legalább
`PROVIDER_SETTLE_DELAY_MS` (15 perc) a `providerStartedAt` után történt (a
Barion egy kérést legfeljebb 30 másodpercig dolgoz fel, Calling_the_API), a
fizetés `Total` értéke a helyi nyilvántartás szerinti maradék, minden korábban
rögzített visszatérítés pontosan egyszer látszik, és nincs sikertelen
visszatérítés sztornója. A mérés a lekérdezés indításához kötött
(`stateObservedAt`), nem a zárra várás utáni feldolgozáshoz: a késve
feldolgozott régi pillanatkép így nem igazolhat nullhatást. Negyedórán belül
az eredmény `too_early`, a kísérlet blokkoló marad.

**Az automatikus (paid-reject) visszatérítés újrapróbálása.** A szabály és az
indoklása a `src/lib/refund/automatic-retry.ts` fejlécében áll, röviden: nem
javítható Barion-kód azonnal és véglegesen leállít; a tulajdonos által
javítható kód (pl. `TooLowBalanceToMakeRefund`) darabszám-korlát nélkül,
legalább naponta újrapróbál (1, 2, 4, 8, 16, majd 24 óra várakozás; K6: nincs
tartalék a tárcában); a kód nélküli
nullhatásból (a fenti második és harmadik hivatkozás) legfeljebb 8 jöhet
egymás után (egy kódolt, javítható elutasítás a sorozatot lezárja). Új
kísérlet csak akkor indul, ha minden korábbi automatikus kísérlet igazoltan
hatástalan, és a friss GetState-ben a `${orderNumber}-1` forrástranzakció a
fizetés teljes összegével áll, kapcsolódó visszatérítés nélkül.

**Kapcsolódó visszatérítési tranzakciók egységes besorolása.** Az indítás őre
(`hasRelatedRefundActivity`) és a GetState-egyeztetés
(`refundEvidenceFromPaymentState`) ugyanazt a besorolást használja: a
forrástranzakcióhoz (`RelatedId`) kapcsolódó minden `Refund`,
`RefundToBankCard`, `RefundToBankAccount` tranzakció, a státuszától
függetlenül, és minden `StornoUnSuccessfulRefundTo*` sztornó „aktivitás”
(a hívó által már rögzített saját visszatérítés kivételével). A Barion
dokumentációja egy visszatérítés kudarcát sztornó-tranzakcióval írja le
(TransactionType, oldid 4445), a `Rejected` / `RejectedByShop` státusz
jelentését visszatérítésre nem adja meg (TransactionStatus, oldid 2547), a
dokumentált elutasítás pedig a válasz `Errors` tömbjében jön, tranzakciót nem
hagy (Calling_the_API). Ismeretlen értelmű kapcsolódó tranzakció mellett ezért
nem indul új visszatérítés (`foreign-refund-detected`), és nullhatás sem
mondható ki (`unprovable`): kézi egyeztetés kell.

**Kísérlet előtti, tartós leállás.** Ha a friss GetState miatt kísérlet sem
indul (`foreign-refund-detected`, `source-transaction-unproven`,
`payment-state-unproven`), a rendszer ezt egy `automatic-refund-blocked`
audit-bejegyzéssel rögzíti a rendelésen (`entityType: 'orders'`, a rendszer a
szereplő, `after: { version: 1, detail, observedAt }`;
`src/lib/refund/automatic-block.ts`). Az írás idempotens: ugyanazzal az okkal,
a legutóbbi lezárt kísérlet után csak egy bejegyzés keletkezik. A tulajdonosi
panel ebből tudja, hogy a rendszer nem próbálkozik tovább, ezért nem ígér
újrapróbálást vagy tárca-feltöltést, hanem a leállást és a teendőt mondja. A
jelzést egy később valóban elindult kísérlet kimenete felülírja; egy újabb,
más okú leállás új bejegyzést kap, és mindig a legújabb számít. Migráció nem
kell: az audit-log `action` mezője szöveg. Az idegen visszatérítést az őr az
összegek ELŐTT nézi: a Barion a visszatérítés után a fizetés `Total` értékét
csökkenti (Payment-PaymentState-v4: „if the transaction is a refund of a
previously completed payment, this can be lower than at payment creation
time”), így egy teljes, a Barion felületén indított visszatérítés (`Total` 0)
is `foreign-refund-detected`, nem „eltérő összeg”. A vásárlói köszönőoldal
(`GET /api/orders/[orderNumber]/status`) a bejelentkezés és a saját rendelés
ellenőrzése után ezt a jelzést is nézi, ha a rendelésnek sem aktív, sem
lezárt (`provider_failed`) automatikus kísérlete nincs: ilyenkor
`paymentReviewRequired: true`, nem sima függő fizetés. Olvasási hibánál 500 (nem hamis „függő”).

**Lemondott és sikertelen fizetésű rendelés.** Ezeket a fizetés-ellenőrzés a
létrehozásuk után csak egy hétig nézi (`LATE_SUCCESS_LOOKBACK_MS`,
`src/lib/order-poll/service.ts`), a `created` rendelést soha. A határ
(`automaticRetryDeadline`, `AUTOMATIC_RETRY_CLOSED_ORDER_WINDOW_MS`, az
egyezést teszt őrzi) a közös `decideAutomaticRetry` része: ha a következő
kísérlet ideje a határ utánra esne, vagy a határ már elmúlt, a döntés
`automatic-refund-window-closed` leállás. A határ a tartalékkal
(`AUTOMATIC_RETRY_DEADLINE_MARGIN_MS`, egy óra) rövidebb az ablaknál, mert a
poll 5 percenként fut, és ki is maradhat: a következő kísérletnek biztosan
bele kell férnie, különben a leállás riasztás nélkül maradna. A leállás
riasztása az okot is megnevezi. A kísérletet indító futás és a panel
ugyanebből dönt, ezért az utolsó, ablakon belüli kísérletet lezáró futás
(kódolt elutasítás, kód nélküli GetState-nullhatás vagy a Barionhoz el sem
jutott kísérlet lezárása) azonnal „leállt” RIASZTÁST ad, nem napi
újrapróbálást ígér, és a panel is már a határ előtt a leállást mondja. Az első
kísérletre a határ nem vonatkozik: azt az éppen futó hívó indítja.
