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
