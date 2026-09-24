# Stornó és helyesbítő számla (Számlázz.hu) a refund-folyamatban

## Áttekintés

Visszatérítéskor a Kineticare automatikusan bizonylatot állít ki a
Számlázz.hu Számla Agenten keresztül. A bizonylat típusát nem önmagában a
visszatérítés összege, hanem a **bizonylat-történet** dönti el:

| Refund                                                     | Bizonylat                                                               | Miért                                                                                                                                                  |
| ---------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Teljes, és még nem volt korábbi refund**                 | **stornó** (`xmlszamlast`, `tipus=SS`)                                  | az eredeti számla teljes érvénytelenítése                                                                                                              |
| **Részleges**                                              | **helyesbítő (módosító) számla** (`xmlszamla`, `helyesbitoszamla=true`) | az eredeti számla érvényben marad, csak a visszatérített összeg korrigálódik                                                                           |
| **A maradékot lezáró teljes refund** (volt már részrefund) | **helyesbítő**                                                          | a korábbi részrefundhoz már készült helyesbítő; a teljes stornó a részösszeget másodszor is jóváírná. A már helyesbített számla amúgy sem stornózható. |

A döntés helye: `src/lib/refund/refund-order.ts` (10. lépés) — a feltétel
`type === 'full' && alreadyRefunded === 0`. A `type: 'full' | 'partial'`, amely a
rendelés státuszát és a purchases-levételt vezérli, ettől független (azt az összeg
adja).

## A Számla Agent sztornó interfésze (séma-tények)

A stornónak **dedikált XML-művelete** van — NEM a sima számla-XML
(`xmlszamla`) része (abban stornó-tag nincs; a
`helyesbitoszamla`/`helyesbitettSzamlaszam` a helyesbítő okirat, az nem
stornó).

| Elem                           | Érték                                                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Végpont                        | `POST https://www.szamlazz.hu/szamla/` (multipart/form-data)                                                                                                              |
| Form-mező                      | `action-szamla_agent_st`                                                                                                                                                  |
| XML-gyökér                     | `<xmlszamlast xmlns="http://www.szamlazz.hu/xmlszamlast">`                                                                                                                |
| XSD                            | `https://www.szamlazz.hu/szamla/docs/xsds/agentst/xmlszamlast.xsd`                                                                                                        |
| Hivatkozás az eredeti számlára | `<fejlec><szamlaszam>` (KÖTELEZŐ)                                                                                                                                         |
| Bizonylattípus                 | `<fejlec><tipus>SS</tipus>` (sztornó)                                                                                                                                     |
| Megjegyzés                     | `<fejlec><megjegyzes>`: „Visszatérítés miatti sztornó, rendelésszám: <rendelésszám>." + „ Indok: <a refund indoka>", ha van (a rendelésszám az indok mellett is megmarad) |
| Dátumok                        | **nincsenek a kérésben** (sem `keltDatum`, sem `teljesitesDatum`)                                                                                                         |
| Külső azonosító                | a stornó **saját** kulcsa: `<beallitasok><szamlaKulsoAzon>` = `<a számla egyedi kulcsa>-STORNO` (a `valaszVerzio` után, az élő XSD szerint)                               |
| Válasz                         | ugyanaz az `xmlszamlavalasz` (valaszVerzio=2), mint a számlakiállításnál                                                                                                  |

A stornó XML-ben **nincs tétel-/összegblokk**: a Számlázz.hu az eredeti
számlából generálja a negatív bizonylatot.

**Dátumok szándékosan kihagyva.** A stornó számlán a teljesítési dátumnak az
EREDETI számláéval azonosnak kell lennie. A `keltDatum`/`teljesitesDatum` az
Agent-kérésben **opcionális**, és ha nem adjuk meg, **a rendszer tölti ki** —
ennyi áll a hivatalos forrásban. Azt **nem** mondja ki, hogy a kitöltött érték
biztosan az eredeti számláéval egyezik, ezért ezt a doksi sem állítja. A
mérlegelés: saját dátum küldésekor egy eltérés a mi hibánk volna, kihagyva a
kitöltés a rendszer dolga. (Ezért a `BuildStornoXmlInput`-nak nincs `issueDate`
mezője.) **Teszt-fiókban ellenőrizendő** (`docs/szamlazz-megfeleles.md`, **T11**):
egy előző havi teljesítésű számlát a következő hónapban stornózva a stornó-PDF
teljesítési dátuma az eredetit veszi-e át. Ha nem, a `teljesitesDatum` visszakerül
a `buildStornoXml()`-be az `order.invoiceCompletionDate`-ből.

**A stornó saját külső azonosítót kap (2026-09-24).** A hivatalos stornó-minta
szerint a kérés `szamlaKulsoAzon`-ja alapján „később ezzel a kulccsal le lehet
kérdezni a számlát", a független, teszt-fiókos mérés szerint pedig a kulcs a
**létrejövő stornóhoz** tapad. Ezért a stornó a számla egyedi kulcsából képzett,
`-STORNO` végű kulcsot kap; az **eredeti** számla kulcsát szándékosan nem
küldjük, mert akkor a stornó lenne a kulcs legújabb birtokosa, és az eredeti
számla azon már nem volna elérhető. A kulcsot most csak **rögzítjük**: a
beküldés előtti stornó-lekérdezés (és vele a bizonytalan állapot automatikus
feloldása) csak azután kapcsolható be, hogy ember a saját teszt-fiókon
lefuttatta a **T10** próbát (`docs/szamlazz-megfeleles.md`). Addig a bizonytalan
stornó-állapot kézi ellenőrzést kér.

## A helyesbítő (módosító) számla séma-tényei

A helyesbítő **ugyanaz az `xmlszamla` művelet** (`action-xmlagentxmlfile`),
két eltéréssel:

| Elem                               | Érték                                                                                                                                                                                                                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<fejlec><helyesbitoszamla>`       | `true`                                                                                                                                                                                                                                                                 |
| `<fejlec><helyesbitettSzamlaszam>` | az EREDETI számla száma (`order.invoiceNumber`)                                                                                                                                                                                                                        |
| Tételek                            | EGY korrekciós tétel a visszatérített összegre, **negatív** `nettoEgysegar` / `nettoErtek` / `afaErtek` / `bruttoErtek` értékkel                                                                                                                                       |
| `<fejlec><teljesitesDatum>`        | az EREDETI számla teljesítési dátuma (`order.invoiceCompletionDate`)                                                                                                                                                                                                   |
| `<fejlec><rendelesSzam>`           | **a helyesbítő saját, rövid rendelésszáma:** `<rendelésszám>-HELYESBITO-<refund-sorszám>`, NEM az eredeti rendelésszám (a hosszú egyedi kulcs csak a `szamlaKulsoAzon`-ban megy)                                                                                       |
| `<beallitasok><szamlaKulsoAzon>`   | `<a számla egyedi kulcsa>-HELYESBITO-<refund-sorszám>` (a számla egyedi kulcsa: `<rendelésszám>-<rendelés-id>-<létrehozás unix mp>`, `kulso-azon.ts`)                                                                                                                  |
| Áfakulcs                           | az EREDETI számla kulcsa: a beküldés előtt a Számlázz.hu számlaadat-lekérdezése (`xmlszamlaxml`) olvassa ki; ha nem olvasható, vegyes, vagy eltér a `SZAMLAZZ_AFAKULCS`-tól, illetve az eredeti már sztornózott, a helyesbítő **nem megy ki** (`failed` + `RIASZTÁS:`) |

A tétel-matematikát a Számlázz.hu validálja (57, 259–264 hibakódok), ezért a
`computeLineAmounts` a korrekciós tételt az **abszolút értéken** számolja, és
utána vált előjelet — így a kerekítés pontosan tükrözi az eredeti számla
tételét (teljes összegű helyesbítés esetén a két bizonylat nullára összegződik).

**A helyesbítőnek nincs provider-oldali duplikátum-védelme.** A hivatalos
rendelésszám-oldal szerint „A sztornó és a helyesbítő számla kivétel az ellenőrzés
alól", tehát a fiókbeli rendelésszám-ismétlés-tiltás (71/152) helyesbítőre nem
vonatkozik: egy ismételt helyesbítő-kérést a Számlázz.hu újra kiállítana. A
duplikátum ellen kizárólag a beküldés előtti, bizonylat-egyedi kulcsú
lekérdezés és a `corrective:<orderId>:<seq>` advisory-zár véd. A `rendelesSzam`
mezőbe a rövid `<rendelésszám>-HELYESBITO-<seq>` megy, hogy a fiókban a számlától
külön sorként, a rendelésszámmal kereshető legyen (a hosszú egyedi kulcs csak a
`szamlaKulsoAzon`-ban utazik). A záron belüli Számlázz.hu-hívások közös, 45 s-os
időkeretben futnak (`lock-budget.ts`): a beküldés csak akkor indul, ha a teljes
timeoutja belefér, különben újrapróbálható hiba, beküldés nélkül. Az ellenőrzés
kétszer fut: a beküldés előtti írások (igénylés-nyugta, pending-írás) előtt,
az írásokra 5 s tartalékkal, majd a beküldés pillanatában is, mert ezek az
írások is megakadhatnak (sorzár, pool-várakozás). Így a zár tranzakcióját a
Postgres 60 s-os tétlenségi korlátja nem öli le beküldés közben. Ha a késői
ellenőrzés egy visszatérítési igénylés rögzítése után bukik, a helyesbítő nem
ment ki, és automatikus újrapróbálás nincs: `failed` + `RIASZTÁS:` (kézi
rendezés; a Számlázz.hu-ba nem ment kérés). Validálás: `docs/szamlazz-megfeleles.md`, **T7 (b)**.

**Dátumszabály (NAV).** A helyesbítő teljesítési dátumának naptári hónapja nem
térhet el az eredeti számláétól, ezért a kiállításkor küldött teljesítési
dátumot a rendszer rögzíti a rendelésen (`invoiceCompletionDate`), és a
helyesbítő ezt ismétli meg. A dátum **már a beküldés előtti `pending`-írásban**
rögzül, tehát elveszett válasz (timeout) után sem marad üresen, és a
lekérdezéssel átvett bizonylat sem hagy űrt. Ha a mező mégis üres vagy nem
`ÉÉÉÉ-HH-NN` formátumú (jellemzően a mező bevezetése előtt kiállított számla),
a helyesbítő figyelmeztetés mellett a saját kiállítási napjára esik vissza —
hónapforduló környékén ez kézi ellenőrzést kíván. A kiállítási dátum
`Europe/Budapest` időzóna szerint képződik (UTC-ből számolva az éjfél utáni
kiállítás az előző napra csúszott volna).

## Folyamat

1. `POST /api/admin/orders/[orderNumber]/refund` (owner-only) →
   `refundOrder()` (`src/lib/refund/refund-order.ts`).
2. A Barion-refund sikere után a rendelés státusza frissül (teljesnél
   `refunded`), a refund-nyom és az audit-bejegyzés rögzül.
3. **Első teljes refundnál** `issueStornoForOrder(order, deps)`
   (`src/lib/szamlazz/storno.ts`), **minden más esetben** (részleges refund,
   illetve a maradékot lezáró teljes refund) `issueCorrectiveInvoiceForOrder(order, deps)`
   (`src/lib/szamlazz/corrective.ts`) fut — mindkettő **best-effort**:
   - kikapcsolt integráció (nincs `SZAMLAZZ_AGENT_KEY`) → `disabled` no-op;
   - a rendelésen már rögzített bizonylat → `already-storned` /
     `already-issued` no-op;
   - hiányzó eredeti számlaszám (`invoiceNumber`), hiányos vevőadat,
     érvénytelen összeg → `failed` + error-szintű `RIASZTÁS:` (nem dob: emberi
     pótlás kell);
   - helyesbítőnél nem igazolható áfakulcs (lásd fent) → `failed` +
     `RIASZTÁS:`, beküldés nélkül; átmeneti olvasási hibánál csak
     figyelmeztetés és újrapróbálható dobás, a státusz marad. Automatikus
     újrapróbálás nincs: a visszatérítési panel „Feldolgozás folytatása"
     gombjával próbálható újra (kézi kiállítás ilyenkor TILOS);
   - helyesbítőnél a beküldés előtti egyéb átmeneti hiba (lekérdezés,
     elfogyott időkeret) → újrapróbálható dobás; a státusz marad, csak a
     hibaüzenet (`correctiveInvoiceLastError`) íródik;
   - a beküldés előtti lekérdezés olyan bizonylatot talál, amelynek bruttója
     nem a helyesbítendő összeg (negatívan) → `failed` + `RIASZTÁS:`, átvétel
     és beküldés nélkül;
   - **stornónál** bizonytalan állapot (nem az első kísérlet, vagy 71/152-es
     duplikátum-jelzés) → `failed` + error-szintű riasztás, **új beküldés
     nélkül** (kézi ellenőrzés a Számlázz.hu-fiókban);
   - siker → a bizonylat száma a rendelésre kerül, strukturált naplózással; az
     56-os jelzés (a bizonylat kiállt, csak az értesítő e-mail nem ment ki) is
     siker, `RIASZTÁS:`-sal a levél kézi újraküldéséhez;
   - végleges agent-hiba → `failed` + error-szintű `RIASZTÁS:` a hibakóddal;
   - retryable provider-hiba (timeout/hálózat, HTTP 408/425/429/5xx,
     `szlahu_down`, 1-es és 55-ös agent-kód, illetve bizonytalan kimenetű
     válasz: értelmezhetetlen törzs, számlaszám nélküli siker vagy 56) → **dob**.
     Stornónál ez `RIASZTÁS:` is, mert a stornó létrejöhetett.
4. A dobott hibát a refund-helyreállítás elkapja, **újrapróbálást nem állít
   sorba**: egy kísérlet után (vagy `invoiceStarted` nyugta mellett) a
   helyreállítás `manual_review`-ra áll. A `queueStornoIssueJob` és a
   `queueCorrectiveInvoiceJob` exportálva van, de 2026-09-24-én semmi nem hívja
   őket automatikusan. Stornónál az újrasorbaállítás egyébként is csapda volna:
   a `storno-issue` job a `stornoAttempts > 0` miatt az F3-ágon `RIASZTÁS:`-sal
   megállna. A helyesbítő újrapróbálása a beküldés előtti lekérdezés miatt
   biztonságos, a bekötése a refund-oldal feladata.
5. A bizonylat hibája **soha nem befolyásolja** a már sikeres refundot:
   a bekötés minden ágat try/catch-ben tart, strukturált loggal
   (`src/lib/logger.ts`).

## Állapot a rendelésen

Az `orders` collection (`src/plugins/ecommerce.ts`) mezői — mind a rendszer
írja (`overrideAccess`), az adminban readOnly/leíró:

| Mező                           | Érték                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `stornoStatus`                 | `none` \| `pending` \| `storned` \| `failed`                                                            |
| `stornoNumber`                 | a kiállított stornó-számla száma (owner-only olvasás)                                                   |
| `stornoAttempts`               | kísérletszámláló (`MAX_STORNO_ATTEMPTS` = 5)                                                            |
| `stornoLastError`              | az utolsó sikertelen kísérlet hibaüzenete                                                               |
| `correctiveInvoiceStatus`      | `none` \| `pending` \| `issued` \| `failed`                                                             |
| `correctiveInvoiceNumber`      | a LEGUTÓBBI helyesbítő számla száma (owner-only olvasás)                                                |
| `correctiveInvoiceSeq`         | melyik refund-bejegyzéshez tartozik a legutóbbi helyesbítő                                              |
| `correctiveInvoiceAttempts`    | kísérletszámláló (`MAX_CORRECTIVE_ATTEMPTS` = 5) — **bizonylat-szintű**                                 |
| `correctiveInvoiceAttemptsSeq` | melyik refund-sorszámhoz tartozik a fenti számláló-állás (eltérő sorszámnál a számlálás nulláról indul) |
| `correctiveInvoiceLastError`   | az utolsó sikertelen kísérlet hibaüzenete                                                               |

## Idempotencia

- **Külső azonosítók (visszakeresési kulcsok, nem duplikátum-védelem):**
  bizonylatonként globálisan egyedi értékek (`kulso-azon.ts`): a számláé
  `<rendelésszám>-<rendelés-id>-<létrehozás unix mp>`, a helyesbítőé ehhez
  `-HELYESBITO-<refund-sorszám>`, a stornóé `-STORNO` toldalékot fűz. A
  Számlázz.hu a külső azonosító egyediségét nem kényszeríti ki, és azonos
  kulcsra a legújabb birtokost adja vissza; a rendelésszám pedig egy törölt
  utolsó rendelés vagy DB-visszaállítás után újra kiosztható. A SZÁMLA
  provider-oldali duplikátum-védelme a `rendelesSzam` (= rendelésszám) + a
  fiókban **bekapcsolt** „rendelésszám-ismétlés tiltása" (71/152); a stornó és
  a helyesbítő ez alól kivétel. Részletek: `docs/szamlazz-megfeleles.md`.
- **Beküldés előtti lekérdezés (számla és helyesbítő):** MINDEN beküldés előtt
  lekérdezés fut a `szamlaKulsoAzon`-ra (`queryInvoiceByKulsoAzon`,
  `src/lib/szamlazz/pdf.ts`, `action-szamla_agent_pdf`); korábbi beküldés után
  a PR #304-es, rendelésszám-alapú régi kulcson is (helyesbítőnél akkor, ha a
  rendelésen BÁRMELY sorszámú helyesbítő beküldése megtörtént). Találat esetén a meglévő
  bizonylat száma kerül a rendelésre, új beküldés nélkül — de csak ha a
  válasz `szamlabrutto`-ja egyezik (számlánál a rendelés végösszegével,
  helyesbítőnél a negatív helyesbített összeggel), és a régi kulcson talált
  bizonylat a számlaadat-lekérdezés szerint is a miénk. Eltérésnél `failed` +
  `RIASZTÁS:`, beküldés nélkül. Kivétel (rendelésszám-újrahasznosítás): ha a
  helyesbítő adott sorszámához még nem volt beküldés, a régi kulcson talált,
  igazoltan MÁS számlára hivatkozó helyesbítő egy korábbi, azonos
  rendelésszámú rendelésé; ezt figyelmeztetéssel átlépjük, és a keresés, majd a
  beküldés folytatódik. Hiányzó hivatkozásnál vagy egyező hivatkozás mellett
  eltérő bruttónál továbbra is `failed` + `RIASZTÁS:`. A 7-es „nincs ilyen bizonylat" csak végleges
  (2xx) válaszban jelent hiányt; átmeneti státusz mellett újrapróbálható hiba.
  Ez oldja fel a „kérés elment, válasz elveszett" esetet. A lekérdezés **nem fogyaszt** a kísérlet-keretből, a hibája
  viszont szándékosan propagál: bizonytalan állapotban nem szabad vakon újra
  beküldeni. A számla-ágon a tartós lekérdezés-hibát időkorlát zárja le: ha a
  lekérdezés legalább 2 órája folyamatosan hibás, és a fizetés óta több mint
  24 óra telt el, a számla `failed` + `RIASZTÁS:` (2026-09-24, H4).
- **A stornó-ágon NINCS lekérdezés, helyette ESZKALÁCIÓ.** Amíg a stornó saját
  kulcsos visszakereshetősége a saját teszt-fiókon (T10) nincs igazolva, a
  „nincs találat" (7-es) válasz nem bizonyítaná stornó hiányát — a vak újraküldés
  pedig **dupla stornót** okozhatna, amit a hivatalos szabály szerint sem
  stornóval, sem helyesbítővel nem lehet visszavonni (csak új, helyreállító
  számlával). Ezért ha a stornó állapota bizonytalan (nem az első kísérlet,
  vagy 71/152-es duplikátum-jelzés érkezett), a szolgáltatás **nem küld be
  újra**: `failed` + error-szintű `RIASZTÁS:` naplóbejegyzés arról, hogy a
  stornó állapotát kézzel kell ellenőrizni a Számlázz.hu-fiókban. Az
  alkalmazás-oldali no-op (lásd lent) marad az elsődleges védelem.
- **Duplikátum-feloldás (számla és helyesbítő):** a 71/152-es válasz nem hiba,
  hanem duplikátum-jelzés (`SzamlazzApiError.kind = 'duplicate'`) — a kód
  ilyenkor ugyanazzal a lekérdezéssel (és ugyanazzal az egyeztetéssel) veszi át
  a meglévő bizonylat számát. Ha a
  lekérdezés mégsem talál semmit vagy maga hibázik, a bizonylat `failed` marad,
  `RIASZTÁS:` naplóbejegyzéssel (kézi egyeztetés kell). Ilyenkor a hibaüzenet
  **fűzött**: a „71/152 — a bizonylat a Számlázz.hu szerint már létezik" tény és
  a lekérdezés hibája EGYÜTT kerül a `*LastError` mezőbe, hogy a kézi rendezés
  ne állítson ki második bizonylatot.
- **Alkalmazás-oldali no-op:** a stornó a `stornoNumber` /
  `stornoStatus='storned'` mezőt nézi; a helyesbítő **pontos** seq-egyezést
  (`correctiveInvoiceSeq === refundSeq`, a `refundSeq` a refunds-nyom 1-alapú
  sorszáma). A szigorítás szándékos: `correctiveInvoiceSeq > refundSeq` esetén
  egy KORÁBBI refund elmaradt bizonylatának újrapróbálása fut (a retry-queue
  megtöri a sorrendi kiállítást), ezért a kérést tovább kell engedni.
- **Kísérlet-korlát:** a Számlázz.hu hivatalos szabálya szerint ugyanaz a kérés
  legfeljebb **ötször** küldhető be, utána emberi beavatkozás kell (a
  retry-loop kitiltást kockáztat). Mindhárom ág perzisztens számlálót használ
  (`invoiceAttempts` / `stornoAttempts` / `correctiveInvoiceAttempts`), így a
  job-retry és az esetleges újrasorbaállítás **együttese** sem lépheti túl a
  plafont. A keretet **csak a tényleges beküldés** fogyasztja — a beküldés
  előtti lekérdezés nem. A helyesbítő-számláló **bizonylat-szintű**: a
  `correctiveInvoiceAttemptsSeq` mezőhöz kötött, ezért egy kimerült
  részrefund-bizonylat nem blokkolja a következő refund helyesbítőjét (új
  sorszámnál a számlálás nulláról indul). Kimerüléskor a bizonylat `failed`
  marad, beküldés nélkül, és error-szintű owner-jelzés kerül a naplóba. A számla-
  és a helyesbítő-ágon előtte lekérdezés fut (2026-09-24, H3): ha az 5.
  (bizonytalan kimenetű) beküldés mégis létrehozta a bizonylatot, azt a rendszer
  átveszi. A záró lekérdezés hibájánál a helyesbítő-ág azonnal `failed` (a
  szöveg a kézi kiállítás előtti keresést kéri), a számla-ág a H4-időkorlátig
  ismétli a lekérdezést. A stornó-ágon a kimerülés hálózati hívás nélküli.
  A számlálók írása a bizonylatonkénti advisory-zár alatt történik
  (`storno:<orderId>`, `corrective:<orderId>:<seq>`), tehát két párhuzamos
  futás nem olvashatja ugyanazt az induló értéket.

## Hibakezelés

| Hibaág                                            | Viselkedés                                                                                                                                                                                                                                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SZAMLAZZ_AGENT_KEY` hiányzik                     | `disabled` no-op — a refund ettől teljes                                                                                                                                                                                                                |
| Nincs `invoiceNumber` a rendelésen                | `failed` + error-szintű `RIASZTÁS:` + `failed` státusz (emberi pótlás)                                                                                                                                                                                  |
| Hiányos vevő-számlázási adat (helyesbítő)         | `failed` + `RIASZTÁS:`                                                                                                                                                                                                                                  |
| Nem igazolható áfakulcs (helyesbítő)              | `failed` + `RIASZTÁS:`, beküldés nélkül; átmeneti olvasási hibánál figyelmeztetés és újrapróbálható dobás, a státusz marad                                                                                                                              |
| Nem egyeztethető lekérdezés-találat (helyesbítő)  | `failed` + `RIASZTÁS:`, átvétel és beküldés nélkül                                                                                                                                                                                                      |
| Agent-elutasítás (`<sikeres>false</sikeres>`)     | `failed` + error-szintű `RIASZTÁS:` a hibakóddal, nem retryable (a hivatalos kódok közül csak az `1` — karbantartás — és az `55` retryable)                                                                                                             |
| Duplikátum-jelzés (71/152) — **helyesbítő**       | NEM hiba: lekérdezés a `szamlaKulsoAzon`-ra, és a meglévő bizonylat átvétele. Sikertelen lekérdezésnél `failed` + `RIASZTÁS:`, **fűzött** hibaüzenettel                                                                                                 |
| Duplikátum-jelzés (71/152) — **stornó**           | `failed` + error-szintű `RIASZTÁS:` (nincs lekérdezés, nincs újraküldés): a stornó állapotát kézzel kell ellenőrizni a fiókban                                                                                                                          |
| Bizonytalan stornó-állapot (nem az első kísérlet) | `failed` + error-szintű `RIASZTÁS:` — a vak újraküldés dupla stornót okozhatna, ami nem javítható                                                                                                                                                       |
| Timeout / hálózat / HTTP 5xx / `szlahu_down`      | `SzamlazzApiError` (retryable) dob; a refund-helyreállítás nem állít sorba újrapróbálást (`manual_review`). Stornónál `RIASZTÁS:` is (a stornó létrejöhetett). A válasz-**törzs** olvasása közbeni megszakadás is ide sorolódik (nem nyers `TypeError`) |
| Kimerült kísérletszám (5)                         | Stornó: `failed`, hálózati hívás nélkül. Helyesbítő: egy záró lekérdezés (találatnál a meglévő bizonylat átvétele), különben `failed`, a kézi kiállítás előtti keresés kérésével. Mindkettő error-szintű owner-jelzéssel                                |
| Bármely váratlan hiba                             | `RIASZTÁS:` error log, továbbdobva — a refund-helyreállítás elkapja, a refund HTTP-válasza változatlan                                                                                                                                                  |

A stornó HTTP-hívás (`postStornoXml`) a `postInvoiceXml`-lel azonos
hibaosztályokat használja (`SzamlazzApiError.kind`: timeout / network /
http / agent / invalid_response), a titok (agent-kulcs) csak az XML-bodyban
utazik, a napló titokmentes.

## Élesítéshez szükséges

1. **`SZAMLAZZ_AGENT_KEY`** környezeti változó beállítása (Számlázz.hu
   fiók → Beállítások → Számla Agent kulcs). Enélkül a bizonylat-kiállítás
   csendben kikapcsolt (`disabled`).
2. Opcionális: `SZAMLAZZ_API_URL`, `SZAMLAZZ_INVOICE_PREFIX`,
   `SZAMLAZZ_AFAKULCS` (`27` vagy `AAM` — a cég adózási státusza szerint,
   könyvelővel egyeztetve), `SZAMLAZZ_TIMEOUT_MS` (a számlakiállítással közös
   konfig-felület, `getSzamlazzConfig`). Az áfakulcsot az **indulási**
   env-ellenőrzés is átnézi: `27`/`AAM`-tól eltérő érték mellett az alkalmazás
   el sem indul (a többi kulcs hibája csak az első számlázási művelet
   futásakor derül ki).
3. A job-workerek (`ENABLE_JOB_WORKERS=true`) futása szükséges ahhoz, hogy a
   (kézzel) sorba állított `storno-issue` / `corrective-invoice-issue` taskok
   ténylegesen lefussanak. Kézi rendezésnél a bizonylatot a Számlázz.hu-felületen
   kell kiállítani; a számát a H2-es admin-művelet elkészültéig nem lehet a
   rendelésre visszavezetni (a mezők írásvédettek), lásd a
   `docs/szamlazz-megfeleles.md` kézi rendezési lépéseit.
4. `SZAMLAZZ_TIMEOUT_MS` legfeljebb 15 000 (a nagyobb értéket a konfiguráció
   levágja).
5. Fiók-oldali előfeltételek (rendelésszám-ismétlés tiltása, előtag felvétele,
   e-számla engedélyezés, NAV-bekötés, vevői fiók be/ki):
   `docs/szamlazz-megfeleles.md` — „Fiók-oldali előfeltételek" checklist.

## Hivatkozások

- Teljes követelmény-audit (45 hivatalos követelmény, fiók-oldali checklist,
  teszt-fiókos validálási lista): `docs/szamlazz-megfeleles.md`
- Számla Agent sztornó XML-minta:
  https://docs.szamlazz.hu/hu/agent/reversing_invoice/xml
- XSD: https://www.szamlazz.hu/szamla/docs/xsds/agentst/xmlszamlast.xsd
- Bizonylat-lekérdezés XSD (idempotencia-feloldás):
  https://www.szamlazz.hu/szamla/docs/xsds/agentpdf/xmlszamlapdf.xsd
- Számlaadat-lekérdezés XSD (a helyesbítő előtti áfakulcs-ellenőrzés):
  https://www.szamlazz.hu/szamla/docs/xsds/agentxml/xmlszamlaxml.xsd
- Rendelésszám-szabály (a stornó és a helyesbítő kivétel):
  https://docs.szamlazz.hu/hu/agent/generating_invoice/settings_and_rules/order-number
- Mezőnév-tábla (melyik form-mező melyik művelet):
  https://docs.szamlazz.hu/hu/agent/basics/send-xml
- Hibakódok: https://docs.szamlazz.hu/agent/basics/error-handling
