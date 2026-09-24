# Számlázz.hu Számla Agent — megfelelőségi dokumentum

**Készült:** 2026-08-09 · **Frissítve:** 2026-08-10 (javító-kör, F1–F17) · 2026-09-24
(XSD-megfelelés: üres `<arfolyam>` eltávolítva, `<fizetve>`, `<adoalany>`; teljesítés a
fizetés napja; 55/56/nem-2xx/CDATA válaszkezelés)
**Forrás:** a hivatalos szamlazz.hu-dokumentáció kutatásának szintézise (45 követelmény,
A1–A16 / B1–B9 / C1–C10 / D1–D10, `docs.szamlazz.hu`, `tudastar.szamlazz.hu`, élő XSD-k)
**+ kód-audit** a javító-kör implementációs állapotán (a squash-merge miatt az eredeti
SHA-k nem feloldhatók; a vonatkozó PR-ek: #53–#60, a döntések forrása:
`docs/atadas-szamlazz-kor.md` 4. szakasz).

Ez a dokumentum azt rögzíti, hogy a Kineticare Számlázz.hu-integrációja a 45 hivatalos
követelmény mindegyikéhez hogyan viszonyul, mit fed le a kód, mi marad fiók-oldali
(üzemeltetői) teendő, és mit kell teszt-fiókban validálni. A státuszokat a **tényleges kód**
alapján állapítottuk meg — nem a követelmény-doksi feltételezései alapján. A doksi
alapszabálya: **nem állíthat többet, mint amit a kód tud, és nem állíthat hivatalosnak
olyat, ami a `docs/szamlazz-hivatalos-kovetelmenyek.md`-ben nincs benne.**

Kapcsolódó: `docs/szamlazz-storno.md` (stornó/helyesbítő folyamat részletei).

## Jelmagyarázat

| Státusz | Jelentés |
|---|---|
| **megfelel** | a követelmény már teljesült, kód-hivatkozással |
| **ebben a körben javítva** | a mostani implementációs kör hozta meg a megfelelést |
| **TISZTÁZANDÓ** | a megfelelés a hivatalos forrásból **nem igazolható teljesen**: a kód a konzervatív (kevesebbet feltételező) ágat választja, a lezárást teszt-fiókos validálás adja — lásd a T-listát |
| **fiók-oldali teendő** | nem kód: a Számlázz.hu-fiókban vagy a környezetben állítandó be |
| **tudatos eltérés** | szándékosan nem követjük, indoklással |
| **n.a.** | ránk nem alkalmazható, indoklással |

**Szintek:** KÖTELEZŐ = hivatalosan előírt vagy a működéshez elengedhetetlen ·
AJÁNLOTT = hivatalos jó gyakorlat · TISZTÁZANDÓ = hivatalos forrásból nem (teljesen)
megerősített, teszt-fiókban ellenőrizendő.

> A **TISZTÁZANDÓ** szó mindkét oszlopban előfordulhat, de mást jelent: a *Szint*
> oszlopban magának a **követelménynek** a hivatalos megerősítettségére utal, a
> *Státusz* oszlopban a **mi megfelelésünk** igazolhatóságára.

---

## A) Agent-alapok (transzport, hitelesítés, séma, válasz, hibakezelés)

| Az. | Szint | Státusz | Hol a kódban |
|---|---|---|---|
| A1 | KÖTELEZŐ | **ebben a körben javítva** — a végpont **záró perjelet** kapott (`.../szamla` → `.../szamla/`); perjel nélkül egy 301/302 a POST-ot GET-té alakítaná, a multipart törzs elveszne (53-as hiba). Az XML mindhárom művelethez **fájlmellékletként** megy. A normalizálás a **query-stringet megőrzi**, és az URL-be ágyazott hitelesítő adat (`user:pass@`) konfigurációs hibaként megáll. | `src/lib/szamlazz/client.ts` → `SZAMLAZZ_DEFAULT_API_URL`, `getSzamlazzConfig()` (URL-normalizálás: `origin + pathname.replace(/\/*$/, '/') + search`); mezőnevek: `postInvoiceXml` (`action-xmlagentxmlfile`), `postStornoXml` (`action-szamla_agent_st`, `storno.ts`), `queryInvoiceByKulsoAzon` (`action-szamla_agent_pdf`, `pdf.ts`) |
| A2 | KÖTELEZŐ | **megfelel** — hitelesítés kizárólag `<szamlaagentkulcs>`-csal; `felhasznalo`/`jelszo` sosem megy. A kulcs env-ből jön, a repóban nincs; hiánya nem indulási hiba (`enabled=false`). | `getSzamlazzConfig()` (`client.ts`); `<szamlaagentkulcs>` a `buildInvoiceXml` / `buildStornoXml` / `buildInvoiceLookupXml` első `beallitasok`-mezője |
| A3 | KÖTELEZŐ | **megfelel** — a gyökér blokk-sorrend kötött és teljes: `beallitasok → fejlec → elado → vevo → fuvarlevel → tetelek`; namespace + `schemaLocation` kiírva. Futásidejű, beküldés előtti XSD-validálás nincs (a hivatalos szöveg ezt csak ajánlja), de **2026-09-24 óta CI-őr van**: a tesztsor mind a négy kérés-építő kimenetét (számla, helyesbítő, stornó, lekérdezés) az élő XSD-k repóba vendorolt, bájtra azonos másolatai ellen validálja — függőség nélküli validátorral mindig, ahol elérhető, `xmllint`-tel is. Sha256: `xmlszamla.xsd` `90af7504…5498`, `xmlszamlast.xsd` `6f9d5beb…7a3a`, `xmlszamlapdf.xsd` `b9b161d1…cfdf`, `xmlszamlavalasz.xsd` `47ed8e07…9d7e`. | `buildInvoiceXml()` (`src/lib/szamlazz/invoice.ts`); őr: `src/__tests__/szamlazz/xsd-validation.test.ts`, sémák: `src/__tests__/szamlazz/xsd/` |
| A4 | KÖTELEZŐ | **megfelel** — `beallitasok`: `szamlaagentkulcs`, `eszamla`, `szamlaLetoltes`, `valaszVerzio`, `szamlaKulsoAzon` a hivatalos sorrendben. Az elavult `szamlaLetoltesPld` nincs kiírva. A `szamlaKulsoAzon` helyesen a `beallitasok`-ban (nem a fejlécben) van. | `buildInvoiceXml()` (`invoice.ts`), `buildStornoXml()` (`storno.ts`) |
| A5 | KÖTELEZŐ | **megfelel** — `<valaszVerzio>2</valaszVerzio>` mindhárom kérésben; a válasz feldolgozása egy közös XML-értelmezőn (siker: `sikeres`/`szamlaszam`/`vevoifiokurl`; hiba: `hibakod`/`hibauzenet`, `<hiba>`-blokkos és lapos formában is). **2026-09-24:** a CDATA-ba csomagolt értékeket (a valódi válaszok így hozzák a `vevoifiokurl`-t, a hivatalos hibaminta a `hibauzenet`-et) kicsomagolja, az XML-entitásokat feloldja; korábban a link a `<![CDATA[` jelöléssel együtt bukott el az allowlisten. | `parseAgentResponse()` (`client.ts`), `extractAgentErrors()`, `tagValues()` |
| A6 | AJÁNLOTT | **megfelel** — a `szlahu_down`, `szlahu_error`, `szlahu_error_code` fejlécek feldolgozva (a `szlahu_down` a body sikerét is felülírja, retryable hibára; a `szlahu_error_code` önmagában is hibának számít). **2026-09-24 óta** a `szlahu_szamlaszam` és a `szlahu_vevoifiokurl` fejléc **tartalék** forrás, ha a törzsből hiányzik (a hivatalos PHP SDK is a fejlécből olvassa). Ha a törzs és a fejléc **eltérő** számlaszámot mond, a válasz bizonytalan (újrapróbálható), egyik szám sem kerül a rendelésre. Az összeg-fejléceket nem használjuk. | `parseAgentResponse()` (`client.ts`) |
| A7 | KÖTELEZŐ | **2026-09-24-én javítva** — a fejléc-sorrend: `keltDatum, teljesitesDatum, fizetesiHataridoDatum, fizmod, penznem, szamlaNyelve, megjegyzes, rendelesSzam, dijbekeroSzamlaszam, elolegszamla, vegszamla, helyesbitoszamla, helyesbitettSzamlaszam, dijbekero, szamlaszamElotag, fizetve`. **Az `arfolyamBank`/`arfolyam` pár HUF-számlán kimarad:** korábban üresen ment ki, az üres `<arfolyam>` viszont `xs:double`-ként **XSD-hibás** (`'' is not a valid value of the atomic type 'xs:double'`, xmllint-tel mérve), amit a szerver 57-es „XML beolvasási hibával" utasít el — minden számla és helyesbítő végleges `failed`-be futott volna. Mindkét mező `minOccurs=0`; a hivatalos PHP SDK és a WooCommerce-bővítmény is elhagyja őket forintnál. **`<fizetve>true</fizetve>`** a számlán és a helyesbítőn: a rendelés kártyával már ki van fizetve, a helyesbítő összegét a Barion már visszautalta. Nélküle a Számlázz.hu a nem készpénzes számlát kintlévőségként tartja nyilván, lejárat után fizetési felszólítással (`tudastar.szamlazz.hu/gyik/szamla-kiegyenlitett-hogyan`). **Dátumok:** kelt = fizetési határidő = a kiállítás napja; a teljesítés a fizetés napja (lásd B4). A határidő szándékosan nem korábbi a keltnél: a Számlázz.hu-ban a határidő „csak a keltezés napjára vagy annál később" állítható, a teljesítés „akár korábbi is lehet" (`tudastar.szamlazz.hu/gyik/ismetlodo-szamlazas-utemezese`). **A javító-körben:** minden dátum **formátum-kapun** megy át (`ÉÉÉÉ-HH-NN`) — nem megfelelő érték `invalid_data` hibával megáll, tehát szabad szöveges DB-mezőből sem kerülhet nyers tartalom az XML-be; a kiállítási dátum pedig **`Europe/Budapest`** időzónában képződik (UTC-ből számolva a 00:00–02:00 közti kiállítás az előző napra csúszott volna). | `buildInvoiceXml()` (`invoice.ts`); `budapestDateString()` (`src/lib/szamlazz/xml.ts`) |
| A8 | KÖTELEZŐ | **megfelel** — a `vevo` négy kötelező mezője (`nev`, `irsz`, `telepules`, `cim`) nélkül a számla **nem megy ki**: a rendelés `invoiceStatus='failed'` lesz, emberi adatpótlásra várva. Az `elado` blokk minden mezője üresen megy (fiók-adatok érvényesek). A `<vevo><azonosito>` **mindig üres** — a doksi figyelmeztetése miatt (más vevőhöz rögzített azonosító adatfrissítést okozna). **2026-09-24 óta `<adoalany>` is kimegy** a `sendEmail` és az `adoszam` között: `1`, ha van (a checkoutban ellenőrzött, magyar) adószám, különben `-1`. A tudástár (`vevo-adoszama-szamlan`) szerint magánszemélynél a „nincs adószáma" értéket kell átadni, különben egy korábban adószámmal szerepelt, azonos nevű és című partner számlakérése hibára futhat; az értéknek pontosan az adószám meglétével kell egyeznie. | `buyerFromOrder()` + `buildInvoiceXml()` (`invoice.ts`); a `failed`-ág az `issueInvoiceForOrder()`-ben |
| A9 | KÖTELEZŐ | **ebben a körben javítva** (a javító-kör a **hibrid** képletre állította) + a tűrés elfogadhatósága **TISZTÁZANDÓ** — `bruttoErtek = round(bruttoEgysegar) × mennyiseg` (pontos) · `nettoErtek = round(bruttoErtek / 1,27)` (**tétel-szintű** kerekítés) · `afaErtek = bruttoErtek − nettoErtek` · `nettoEgysegar = nettoErtek / mennyiseg` **2 tizedesre**, stringként. A három hivatalos egyenlet így teljesül, ezekkel a maradékokkal: (1) `nettoEgysegar × mennyiseg ≈ nettoErtek` — eltérés ≤ 0,005 × mennyiseg (99 db-nál ≤ 0,5 Ft); (2) `nettoErtek × 27% ≈ afaErtek` — eltérés ≤ **0,64 Ft**, **mennyiségtől függetlenül** (a tétel-szintű kerekítés hibájának 1,27-szerese); (3) `nettoErtek + afaErtek = bruttoErtek` — **pontos**. A korábbi, tisztán egységár-alapú változat a 2. egyenletet a mennyiséggel arányosan rontotta (qty=7 → ~1,4 Ft; qty=99 → ~20 Ft) → 260/263-kockázat; a checkout 1–99 db-ot enged. `mennyiseg = 1`-nél a viselkedés változatlan (egész egységár). AAM-módban `nettoErtek = bruttoErtek`, `afaErtek = 0`, egységár = `nettoErtek / mennyiseg`. Tétel-sorrend a hivatalos. **A hivatalos forrás számszerű tűrést NEM közöl** (csak annyit: bruttóból visszafelé számolva az egyenletek „fillérre jöjjenek ki") → teszt-fiókos validálás: **T9**. | `computeLineAmounts()` (`invoice.ts`) — a docblock mindhárom egyenletet és a tűrés indoklását tartalmazza |
| A10 | AJÁNLOTT | **ebben a körben javítva** — `<fizmod>` `bankkártya` → **`Barion`**: a Számlázz.hu normalizált értékkészletében a `Barion` önálló elem, így a `fizmodunified` pontosan a valós fizetési módra áll (nem „other"-re). | `buildInvoiceXml()` (`invoice.ts`) |
| A11 | KÖTELEZŐ | **megfelel** — `penznem=HUF`, `szamlaNyelve=hu` (utóbbi az egyetlen XSD-enum fejlécmező); a devizás mezők (`arfolyamBank`, `arfolyam`) nem mennek ki (A7). | `buildInvoiceXml()` (`invoice.ts`) |
| A12 | KÖTELEZŐ | **ebben a körben javítva** (számla + helyesbítő) · **TISZTÁZANDÓ** (stornó) — **Számla:** `rendelesSzam = orderNumber` (ez a hivatalos duplikátum-védelem alapja) + `szamlaKulsoAzon = orderNumber` (visszakeresési kulcs); beküldés-**ismétlés** előtt lekérdezés a külső azonosítóra; a 71/152 nem hiba, hanem `kind: 'duplicate'` → lekérdezés → a meglévő számla átvétele. **Helyesbítő:** a javító-kör óta a `rendelesSzam` is **bizonylat-egyedi** (a helyesbítő saját `szamlaKulsoAzon`-ja: `<orderNumber>-HELYESBITO-<seq>`) — az eredetivel azonos rendelésszám mellett a bekapcsolt rendelésszám-ismétlés-tiltás MINDEN helyesbítőt 71/152-be futtatott volna, sőt a 2 napos „azonos adat" ablakban az első helyesbítőt adta volna vissza a másodikra; így a 71/152 valóban azt jelenti, hogy **ez a helyesbítő** már létezik, és a lekérdezéses feloldás helyes bizonylatot vesz át. **Stornó:** a külső azonosító a stornó-kérésből **kikerült**, és a beküldés-ismétlés előtti lekérdezés is — a hivatalos leírás szerint az `xmlszamlast` `szamlaKulsoAzon`-ja a **sztornózandó** számlát hivatkozza, tehát a lekérdezés „nincs találat" (7-es) válasza NEM bizonyítja, hogy stornó nem készült. Helyette: alkalmazás-oldali no-op + bizonytalan állapotban **eszkaláció** (lásd C5). Visszakereshetőség a teszt-fiókos **T10** tétel tárgya. | `client.ts` → `SZAMLAZZ_DUPLICATE_AGENT_CODES`, `isDuplicateOrderError()`; `pdf.ts` → `queryInvoiceByKulsoAzon()`; `invoice.ts` / `corrective.ts` → `adoptExisting()` + a `previousAttempts > 0` ágon futó lookup; `storno.ts` → lookup nélkül. **Fiók-oldali előfeltétel:** a rendelésszám-ismétlés tiltása (lásd checklist 3.) |
| A13 | KÖTELEZŐ | **ebben a körben javítva, 2026-09-24-én bővítve** — hivatalos hibakód-osztályozás: `1` (karbantartás) és **`55`** (e-számla aláírás / időbélyeg-szerver; a tudástár szerint a szolgáltatói kiesés „egy idő után magától" javul, a lejárt tanúsítványt az 5-ös plafon állítja meg) újrapróbálható; `71`/`152` = duplikátum (idempotencia-találat); `7` = „nincs ilyen bizonylat" a lekérdezésnél; **`56`** (a számlaértesítő nem ment ki) számlaszámmal **siker** + `RIASZTÁS:` a levél kézi újraküldéséhez (a hivatalos PHP SDK `InvoiceResponse::isError` szabálya), számlaszám nélkül bizonytalan, újrapróbálható; minden más kód **végleges** `agent` hiba. **Nem-2xx HTTP-válasz:** a törzs és a `szlahu_*` fejlécek ilyenkor is kiolvasódnak (korábban a kód elveszett), a 408/425/429/5xx státusz önmagában újrapróbálható, a többi 4xx végleges. **Értelmezhetetlen (pl. 200-as HTML) válasz** és **számlaszám nélküli siker:** bizonytalan kimenet, újrapróbálható — a számla- és a helyesbítő-ág a következő beküldés előtt úgyis lekérdez. A kód és az üzenet strukturáltan naplózódik (`agentErrorCodes`), request ID-vel. A javító-kör óta a hálózati **törzs-olvasás** hibája (megszakadt válasz, olvasás közbeni timeout) is osztályozva jön ki (`timeout`/`network`, újrapróbálható) — nem nyers `TypeError`-ként, ami elvitte volna az újrapróbálást. Ha a duplikátum-feloldó lekérdezés maga hibázik, a hibaüzenet **fűzött**: a 71/152-es tény és a lekérdezés hibája együtt kerül a `*LastError`-be és a dobott hibába — hogy a kézi rendezés ne állítson ki második bizonylatot. | `client.ts` → `SZAMLAZZ_RETRYABLE_AGENT_CODES`, `SZAMLAZZ_DUPLICATE_AGENT_CODES`, `SZAMLAZZ_NOTIFICATION_FAILED_CODE`, `isTransientHttpStatus()`, `readAgentResponse()`, `agentErrorFromCodes()`; `pdf.ts` → `SZAMLAZZ_NOT_FOUND_CODE` |
| A14 | KÖTELEZŐ | **ebben a körben javítva** — max. 5 beküldés **perzisztens** számlálóval mindhárom ágon; a plafon felett hálózati hívás nélkül `failed` + error-szintű riasztás (emberi beavatkozás). Így a job-retry és az order-poll resweep **együttese** sem lépheti túl. A javító-kör három pontosítása: (1) **csak a tényleges beküldés fogyaszt keretet** — a beküldés-ismétlés előtti lekérdezés nem növeli a számlálót; (2) a helyesbítő-számláló **bizonylat-szintű** (refund-sorszámhoz kötött: `correctiveInvoiceAttemptsSeq`), tehát egy kimerült részrefund nem blokkolja a következő bizonylatot; (3) a számla-ágon az **újrapróbálható** hiba után a státusz `pending` marad (nem `failed`), így az order-poll resweep újra sorba állítja — és a valódi fék a perzisztens plafon, nem a job-retryk kifogyása. | `MAX_INVOICE_ATTEMPTS` (`invoice.ts`), `MAX_STORNO_ATTEMPTS` (`storno.ts`), `MAX_CORRECTIVE_ATTEMPTS` (`corrective.ts`); mezők: `invoiceAttempts` / `stornoAttempts` / `correctiveInvoiceAttempts` + `correctiveInvoiceAttemptsSeq` (`src/plugins/ecommerce.ts`); resweep: `INVOICE_PENDING_STALE_MS` (`src/lib/order-poll/service.ts`) |
| A15 | AJÁNLOTT | **tudatos eltérés** — nincs cookie-jar. Minden hívás önálló, állapotmentes multipart POST, a hitelesítés kérésenként az agent-kulccsal történik; nincs olyan több-lépéses folyamatunk, amely session-folytonosságot igényelne. Ha a szerver mégis session-cookie-t vár, az a teszt-fiókos körben derül ki. | `postInvoiceXml()` / `postStornoXml()` / `queryInvoiceByKulsoAzon()` — natív `fetch`, cookie-kezelés nélkül |
| A16 | AJÁNLOTT | **n.a.** — kimenő tűzfal-szabály nincs (Railway-n a kimenő forgalom nem IP-szűrt), a Let's Encrypt lánc a futtatókörnyezet TLS trust store-jából érvényesül. A kérés-timeout viszont explicit: `SZAMLAZZ_TIMEOUT_MS` (default 15 000 ms). | `getSzamlazzConfig()` → `timeoutMs`; `AbortSignal.timeout()` a három POST-ban |

---

## B) Helyesbítő számla

| Az. | Szint | Státusz | Hol a kódban |
|---|---|---|---|
| B1 | KÖTELEZŐ | **megfelel** — a helyesbítő a **normál** `xmlszamla` műveleten megy (`action-xmlagentxmlfile`), nem a stornó-interfészen; a stornónak külön XML-típusa és mezőneve van. | `buildCorrectiveInvoiceXml()` → `buildInvoiceXml()` + `postInvoiceXml()` (`src/lib/szamlazz/corrective.ts`) |
| B2 | KÖTELEZŐ | **megfelel** — `<helyesbitoszamla>true</helyesbitoszamla>` és `<helyesbitettSzamlaszam>` = az **eredeti** számla száma (`order.invoiceNumber`); a fejléc-sorrendben a hivatalos helyükön. | `buildInvoiceXml()` `corrective` ága (`invoice.ts`), `CorrectiveInvoiceRef` |
| B3 | KÖTELEZŐ | **megfelel** — a helyesbítőn **egyetlen korrekciós tétel** szerepel a visszatérített összegre, negatív értékekkel. A számítás abszolút értéken fut és utána vált előjelet, így az A9-egyenletek a negatív soron is teljesülnek, és a kerekítés pontosan tükrözi az eredeti tételt. Előjel-kombinációnk: `mennyiseg = 1` (pozitív), `nettoEgysegar` / `nettoErtek` / `afaErtek` / `bruttoErtek` negatív — ez a D4-ben hivatalosan rögzített „negatív `nettoEgysegar`" mintát követi. | `buildCorrectiveInvoiceXml()` (`corrective.ts`), `computeLineAmounts({ allowNegative: true })` (`invoice.ts`). Validálás: **T3** |
| B4 | KÖTELEZŐ | **ebben a körben javítva** — a kiállításkor küldött teljesítési dátum rögzül a rendelésen (`invoiceCompletionDate`), és a helyesbítő **ezt ismétli meg** `teljesitesDatum`-ként (NAV-szabály: a naptári hónap nem térhet el). A javító-kör óta a mező **már a beküldés előtti `pending`-írásban** rögzül (nem csak a siker-ágon), tehát elveszett válasz esetén sem marad üresen — a lekérdezéssel átvett (adoptált) bizonylat pedig nem írja felül. A mező bevezetése előtti számláknál (illetve érvénytelen formátumnál) figyelmeztetés + visszaesés a kiállítás napjára. **2026-09-24 óta a teljesítési dátum a FIZETÉS (hozzáférés-nyitás) budapesti napja**, nem a job futásáé: a paid-átmenet a vevő `accessGrants` tömbjébe a rendeléshez kötött (`sourceKind: 'order'`, `sourceOrder`) `grantedAt` órát ír, és ennek a legkorábbi értéke adja a napot. Így a 23:58-as fizetés éjfél utáni számlája sem csúszik át a következő napra, hónapra (áfa-időszak) vagy évre (AAM-keret), és egy kiesés utáni újrafuttatás sem viszi el a teljesítést (Áfa tv. 55. § (1)). Ha nincs ilyen sor (pl. a hozzáférés-óra írása elbukott), a kiállítás napja marad, **figyelmeztetéssel**; a kiállításnál későbbi fizetési napot (óraeltérés) nem vesszük át. A kelt és a fizetési határidő továbbra is a kiállítás napja (A7). | `invoice.ts` → `writeOrderInvoicingState({ invoiceCompletionDate: teljesitesDatum })` a pending-írásban; `paid-date.ts` → `resolveOrderPaidMoment()`, `earliestOrderGrantMoment()`; `corrective.ts` → `originalCompletionDate` + formátum-ellenőrzés és warn; mező: `invoiceCompletionDate` (`ecommerce.ts`) |
| B5 | KÖTELEZŐ | **megfelel** — a bizonylattípus döntése: **első** refundként teljes összeg → stornó; minden más (részleges, illetve a maradékot lezáró) → helyesbítő. | `src/lib/refund/refund-order.ts` (~860. sor): `type === 'full' && alreadyRefunded === 0` → `issueStornoBestEffort()`, egyébként `issueCorrectiveBestEffort()` |
| B6 | KÖTELEZŐ | **megfelel** — a „már helyesbített számla nem stornózható" szabály kikényszerítve: ha volt korábbi részrefund, a maradékot lezáró teljes refund is **helyesbítőt** kap (a stornó a részösszeget másodszor is jóváírná). Több helyesbítő megengedett; a `helyesbitettSzamlaszam` mindig az **eredetire** mutat. | `refund-order.ts` (`alreadyRefunded === 0` feltétel + a 833–848. sorok indoklása); `correctiveInvoiceSeq` a nyom (`ecommerce.ts`). Láncolt hivatkozás validálása: **T4** |
| B7 | AJÁNLOTT | **megfelel** — a sorszámot a Számlázz.hu osztja, mi csak az előtagot választjuk (`szamlaszamElotag`), és a válaszban kapott számot tároljuk (`invoiceNumber` / `stornoNumber` / `correctiveInvoiceNumber`). | `buildInvoiceXml()` (`invoice.ts`); tárolás: `writeOrderInvoicingState()` (`order-state.ts`) |
| B8 | TISZTÁZANDÓ | **tudatos eltérés** — a `fizetendoKorrekcio` mezőt **nem küldjük**: hivatalos leírása hiányos, a részleges visszatérítés bizonylatát a negatív korrekciós tétel önmagában leírja. Bevezetése előtt teszt-fiókos ellenőrzés kell. | nincs kiírva a `buildInvoiceXml()`-ben (`invoice.ts`). Validálás: **T2** |
| B9 | AJÁNLOTT | **megfelel** — a helyesbítő külső kulcsa eltér az eredetiétől és bizonylatonként egyedi: `${orderNumber}-HELYESBITO-<refund-sorszám>`; csak a kiállító kérésben megy el. | `correctiveKulsoAzon()`, `CORRECTIVE_KULSO_AZON_INFIX` (`corrective.ts`) |

---

## C) Stornó, PDF-lekérés, e-számla, értesítő

| Az. | Szint | Státusz | Hol a kódban |
|---|---|---|---|
| C1 | KÖTELEZŐ | **megfelel** — dedikált stornó-művelet: `action-szamla_agent_st` mezőnév, `xmlszamlast` gyökér a saját namespace-szel és XSD-hivatkozással; blokk-sorrend `beallitasok → fejlec → elado → vevo`. | `buildStornoXml()`, `postStornoXml()` (`src/lib/szamlazz/storno.ts`) |
| C2 | KÖTELEZŐ | **megfelel** — stornó `beallitasok`: `szamlaagentkulcs`, `eszamla=true`, `szamlaLetoltes=false`, `valaszVerzio=2` a hivatalos sorrendben; az elavult `szamlaLetoltesPld` nincs. A javító-kör óta a **`szamlaKulsoAzon` nem megy ki** a stornó-kérésben (opcionális mező, elhagyása séma-konform) — az indoklás a C3-ban. Az `eszamla=true` egyezik az eredeti számla típusával (a kiállítás is e-számla). | `buildStornoXml()` (`storno.ts`) |
| C3 | KÖTELEZŐ | **megfelel** (kötelező mezők) · **TISZTÁZANDÓ** (külső azonosító szerepe) — `<szamlaszam>` = az eredeti számla száma (`order.invoiceNumber`), `<megjegyzes>` = a sztornózás oka (a refund indoka), `<tipus>SS</tipus>`; a `vevo.email` a stornó-értesítőhöz megy. A hivatalos leírás szerint a `beallitasok`-beli `szamlaKulsoAzon` a **sztornózandó** számla hivatkozására szolgál (ha kiállításkor be volt állítva) — arról **nincs hivatalos állítás**, hogy a létrejövő stornó ezen az értéken (vagy bármely, a kérésben küldött külső azonosítón) visszakereshető lenne. Ezért a mező a stornó-XML-ből kikerült, és a `-STORNO` toldatú érték sem megy el (a `fejlec.szamlaszam` az egyértelmű, kötelező hivatkozás). A visszakereshetőség tisztázása: **T10**. | `buildStornoXml()` + `buyerEmailFromOrder()` (`storno.ts`) |
| C4 | KÖTELEZŐ | **megfelel** — a v2-válasz ugyanazon az értelmezőn fut, és a kapott **stornó-számlaszám** a rendelésre kerül. | `postStornoXml()` → `parseAgentResponse()`; `stornoNumber` mező (`ecommerce.ts`), írás: `order-state.ts` |
| C5 | KÖTELEZŐ | **megfelel** (alkalmazás-oldali no-op) · **TISZTÁZANDÓ** (bizonytalan állapot feloldása) — az ismételt stornó ellen **saját, alkalmazás-szintű** védelem véd (nem a szerver hibakódja): rögzített `stornoNumber` vagy `stornoStatus='storned'` → `already-storned` no-op, hálózati hívás nélkül. A javító-kör óta **nincs** retry előtti lekérdezés a stornó-ágon: mivel a lekérdezés „nincs találat" válasza nem bizonyítja stornó hiányát (C3), a vak újraküldés dupla stornót okozhatna — ez pedig a hivatalos szabály szerint stornóval/helyesbítővel **nem javítható** (csak új, helyreállító számlával). Helyette: nem-első kísérletnél és `duplicate`-jelzésnél `failed` + **error-szintű riasztás** („a stornó állapota bizonytalan, kézi ellenőrzés kell a Számlázz.hu-fiókban"). | `issueStornoForOrder()` (`storno.ts`). Validálás: **T1**, **T10** |
| C6 | KÖTELEZŐ | **TISZTÁZANDÓ** (a körben megváltoztatva) — a stornó-XML-ből **kikerült a `keltDatum` és a `teljesitesDatum`**. Hivatalosan ennyi áll: a stornón az eredetivel **azonos teljesítési dátumot kell** feltüntetni, a mező az Agent-kérésben **opcionális**, és ha nem adjuk meg, **a rendszer tölti ki**. Azt a hivatalos forrás **nem mondja ki**, hogy a kitöltött érték az eredetiével egyezik — ezért a doksi ezt nem is állítja. A mérlegelés: saját dátum küldésekor az eltérés kockázata a mienk, kihagyva a kitöltés a rendszeré. **Független mérés (2026-09-06, harmadik fél teszt-fiókja, `sagikazarmark/szamlazz-rs` `docs/szamlazz-hu-behaviour.md`, P48-P1/P5):** kihagyott `teljesitesDatum` mellett a stornó az **eredeti** számla teljesítési dátumát kapja, a kelte a mai nap; explicit, eltérő (akár más hónapbeli) dátumot az Agent szó nélkül elfogad (P48-P3), a nem mai `keltDatum`-ot pedig 352-es hibával utasítja el. A kihagyás tehát a biztonságos ág. Saját fiókos megerősítés továbbra is: **T11** — ha a stornó nem az eredeti teljesítési dátumot veszi át, a `buildStornoXml`-be vissza kell tenni a `teljesitesDatum`-ot az `invoiceCompletionDate`-ből (`keltDatum`-ot soha). | `buildStornoXml()` (`storno.ts`) — a `BuildStornoXmlInput`-ból az `issueDate` mező is megszűnt |
| C7 | KÖTELEZŐ | **ebben a körben javítva (új fájl)** — `xmlszamlapdf` lekérdezés `action-szamla_agent_pdf` mezőnévvel, az **élő XSD** sorrendjében (`szamlaagentkulcs → valaszVerzio → szamlaKulsoAzon`; a `szamlaszam`/`rendelesSzam` kihagyásával a docs-beli régebbi XSD-változattal is kompatibilis). A **7-es hibakód nem hiba**, hanem „nincs ilyen bizonylat" (`null`). A `<pdf>` base64 tartalmát nem tároljuk — a lekérdezés célja a bizonylat létének és számának megállapítása. | `src/lib/szamlazz/pdf.ts` → `buildInvoiceLookupXml()`, `queryInvoiceByKulsoAzon()`, `SZAMLAZZ_NOT_FOUND_CODE` |
| C8 | KÖTELEZŐ | **megfelel** — `<eszamla>true</eszamla>` a kiállításnál és a stornónál is; az 54-es (nincs engedélyezve) kód végleges hibaként áll meg. Az 55-ös (aláírás/időbélyeg) kód **2026-09-24 óta újrapróbálható** (A13): az időbélyeg-szolgáltatás kiesése magától megszűnik, a lejárt tanúsítványt pedig az 5-ös beküldési plafon állítja meg `RIASZTÁS:`-sal. | `buildInvoiceXml()`, `buildStornoXml()`; osztályozás: `agentErrorFromCodes()` (`client.ts`). **Fiók-oldali előfeltétel:** checklist 5. |
| C9 | KÖTELEZŐ | **megfelel** — `<sendEmail>` értéke a vevő e-mail-címének meglétéből számolódik; cím nélkül nincs kiküldés. Az `elado.emailReplyto` / `emailTargy` / `emailSzoveg` üresen megy (a fiók alapértelmezései érvényesek). Stornónál a `vevo.email` szintén kimegy. | `buildInvoiceXml()` (`invoice.ts`), `buildStornoXml()` (`storno.ts`) |
| C10 | KÖTELEZŐ | **megfelel** — a `<vevoifiokurl>` opcionálisként van kezelve: ha jön, **allowlisten** (kizárólag `https` + `szamlazz.hu` vagy aldomainje) átengedve kerül a rendelés `invoicePdfUrl` mezőjébe; ha nem jön vagy nem megbízható, a rendelés link nélkül marad (nem hiba), és figyelmeztetés kerül a naplóba — a teljes URL naplózása nélkül. **2026-09-24 óta** a CDATA-ba csomagolt és entitás-kódolt link is helyesen kerül az allowlist elé, hiányában pedig a `szlahu_vevoifiokurl` fejléc a forrás (A5, A6). | `parseAgentResponse()` (`client.ts`), `isTrustedInvoicePdfUrl()` + `safeUrlHost()` (`invoice.ts`) |

---

## D) ÁFA-esetek, fiók-oldali beállítások, teszt-mód, korlátok

| Az. | Szint | Státusz | Hol a kódban |
|---|---|---|---|
| D1 | KÖTELEZŐ | **ebben a körben javítva** — az áfakulcs beállíthatóvá vált a `SZAMLAZZ_AFAKULCS` env-változóval, szűkített unionnal (`'27' \| 'AAM'`), `any` nélkül. Ismeretlen érték **hangosan dob**, nem esik csendben az alapértelmezésre. A javító-kör óta ez **már indításkor** megtörténik: ha a változó be van állítva és nem `27`/`AAM`, az alkalmazás **el sem indul** (minden környezetben) — egy elgépelt kulcs így nem az első számlánál derül ki. **A hiányzó kulcs bekapcsolt számlázásnál HIBA** (2026-08-17 óta, alapértelmezés nélkül): ha van `SZAMLAZZ_AGENT_KEY`, de nincs `SZAMLAZZ_AFAKULCS`, minden számlázási művelet konfigurációs hibával áll meg. Az alkalmazás ilyenkor elindul, a hiba az első számlázási műveletnél jön; a kulcsot tehát kifejezetten `27`-re vagy `AAM`-ra kell állítani, üresen hagyni nem szabad. Csak **kikapcsolt** számlázásnál (agent-kulcs nélkül) nem kell megadni. | `SzamlazzVatMode` (`src/lib/szamlazz/types.ts`), `getSzamlazzConfig()` (`client.ts`); indulási ellenőrzés: `assertRequiredEnv()` (`src/env.ts`) |
| D2 | KÖTELEZŐ | **ebben a körben javítva** — AAM módban a kód az `'AAM'` **stringet** küldi `afakulcs`-ként (sosem `0`-t vagy `TAM`-ot), `afaErtek = 0` és `bruttoErtek = nettoErtek` mellett — így az A9 tétel-validáció is átmegy. | `computeLineAmounts()` (`vatMode === 'AAM'` ág) és `<afakulcs>${vatMode}</afakulcs>` a `buildInvoiceXml()`-ben (`invoice.ts`) |
| D3 | TISZTÁZANDÓ | **fiók-oldali teendő** — külön „alanyi adómentes" záradékszöveget nem küldünk (a hivatalos forrás sem követeli meg); a jelölést vélhetően a rendszer teszi rá a kulcs alapján. Ellenőrzés a teszt-fiókos próbaszámla PDF-jén. | nincs kód-ág. Validálás: **T5** |
| D4 | AJÁNLOTT | **n.a.** — a kosárban nincs kedvezmény-tétel (fix bruttó kurzusárak), ezért dedikált kedvezménysort nem építünk. A negatív tételsor mechanizmusát a helyesbítő számla használja (B3). | — |
| D5 | AJÁNLOTT | **megfelel** — az `eusAfa` mező nincs a kérésben (magyar adószám, belföldi HUF-számlázás). | `buildInvoiceXml()` (`invoice.ts`) — a mező nincs kiírva |
| D6 | KÖTELEZŐ | **megfelel (kód) + fiók-oldali teendő** — a `szamlaszamElotag` a `SZAMLAZZ_INVOICE_PREFIX` env-változóból jön, alapértelmezése `KIN`. Az előtagot a fiókban **fel kell venni**, különben 202-es hiba (végleges, nem retryable). | `SZAMLAZZ_DEFAULT_INVOICE_PREFIX`, `getSzamlazzConfig()` (`client.ts`); `buildInvoiceXml()`. **Fiók-oldali:** checklist 4. |
| D7 | KÖTELEZŐ | **fiók-oldali teendő** — kérés-szintű tesztflag nincs, és a kód sem tartalmaz ilyet: a teszt-mód a fiók szintjén él. Fejlesztéshez dedikált teszt-fiók kell. | nincs kód-ág (az `SZAMLAZZ_API_URL` átirányítható, de az nem teszt-mód). **Fiók-oldali:** checklist 1. |
| D8 | TISZTÁZANDÓ | **n.a. a kódban / üzemeltetési korlát** — a teszt-környezeti volumenkorlátról két hivatalos oldal ellentmond (100/óra vs. 500/10 perc). Kódbeli rate-limitünk nincs; a mi terhelésünk (rendelésenként 1–3 bizonylat) messze a szigorúbb határ alatt van, tesztfuttatásnál viszont figyelendő. | — . Validálás: **T6** |
| D9 | KÖTELEZŐ | **fiók-oldali teendő** — a NAV Online Számla adatszolgáltatás az összekötés után automatikus, az Agent-kérésben semmit nem kell hozzá küldeni (a kód sem küld). Előfeltétel: NAV technikai felhasználó + kulcsok a Számlázz.hu-fiókban. | nincs kód-ág. **Fiók-oldali:** checklist 6. |
| D10 | AJÁNLOTT | **fiók-oldali teendő** — a Számla Agent külön díjazású, és csak a csomagban elérhető funkciókat adja (ingyenes csomagban pl. e-számla sem → 54-es hiba). Csomag-ellenőrzés élesítés előtt. | nincs kód-ág. **Fiók-oldali:** checklist 5. |

---

## Teszt-fiókos validálási lista

A **T1–T8** tételek a követelmény-kutatás 15 bizonytalansági pontjából származnak, a
**T9–T11** a javító-kör nyitva hagyott kérdéseiből (A9-tűrés, stornó-visszakeresés,
stornó-dátum), a **T12** a 2026-09-24-i XSD-körből (kifizetettség, adóalanyiság). Mindegyik **teszt-fiókban** futtatandó (D7), éles fiókban tilos. Az éles
bekötés előtt a teljes lista futtatandó — a **T10** és a **T11** eredménye kódváltozást is
maga után vonhat.

| # | Mit validál | Teszt-forgatókönyv |
|---|---|---|
| **T1** | Ismételt stornó viselkedése (nincs dokumentált hibakód) — a C5 saját idempotenciáját erre nem szabad alapozni | Állíts ki egy számlát, stornózd, majd küldd be **ugyanazt** a stornó-kérést újra (a kérés a javító-kör óta **nem tartalmaz** `szamlaKulsoAzon`-t, csak a `fejlec.szamlaszam` hivatkozást). Jegyezd fel, milyen `hibakod`/`hibauzenet` jön (vagy hogy a rendszer a meglévő stornót adja-e vissza, esetleg MÁSODIK stornót készít-e). Ha új, eddig ismeretlen kód jön, vedd fel a `client.ts` osztályozásába. |
| **T2** | `fizetendoKorrekcio` szemantikája (B8 — jelenleg nem küldjük) | Állíts ki egy számlát, majd két helyesbítőt: egyet a mezővel, egyet nélküle, azonos negatív tétellel. Hasonlítsd össze a két PDF „fizetendő" sorát és a `kintlevoseg` értékét — csak akkor vezessük be, ha bizonyítottan a részleges visszatérítés fizetendő-korrekcióját írja le. |
| **T3** | Negatív tétel előjel-kombinációja helyesbítőn (B3) | Küldj be egy helyesbítőt a jelenlegi kombinációval (`mennyiseg = 1`, negatív `nettoEgysegar` és negatív érték-mezők). Ha az Agent 259–264 kóddal elutasítja, próbáld a másik hivatalos mintát (`mennyiseg = -1`, pozitív `nettoEgysegar`, negatív értékek), és igazítsd a `computeLineAmounts()`-ot. |
| **T4** | Láncolt helyesbítés hivatkozása (B6) | Egy számlához állíts ki két egymást követő helyesbítőt, mindkettőben az **eredeti** számlaszámmal a `helyesbitettSzamlaszam`-ban. Ellenőrizd, hogy a második is átmegy-e, és hogy a PDF-eken a hivatkozás az eredetire mutat-e. Ha a rendszer az előző helyesbítőre való hivatkozást várja, a `corrective.ts` `originalInvoiceNumber` forrását kell átállítani. |
| **T5** | AAM-záradék megjelenése a PDF-en (D3) | `SZAMLAZZ_AFAKULCS=AAM` mellett állíts ki egy próbaszámlát, és nézd meg a PDF-en, megjelenik-e automatikusan az alanyi adómentességre utaló jelölés. Ha nem, a szöveget a fejléc `megjegyzes` mezőjébe kell tenni (`buildInvoiceXml`). |
| **T6** | Teszt-volumenlimit (D8 — 100/óra vs. 500/10 perc) | Egy tesztfuttatás során számold a kiállított bizonylatokat, és figyeld, jön-e limit-jelzés a 100. bizonylat körül. Konzervatívan a szigorúbb 100/óra tartandó; az e2e-forgatókönyveket eszerint kell ütemezni. |
| **T7** | Rendelésszám-ismétlés tiltása + 71/152 (a kutatás 2. bizonytalansága) — **ez az A12 idempotencia alapja** | **(a)** A fiókbeállítás bekapcsolása UTÁN küldd be kétszer ugyanazt a **számlakérést** (azonos vevőnév, bruttó, dátumok). Elvárás: a második hívás a korábbi számlát adja vissza (2 napos ablakon belül), eltérő adatnál pedig 71/152. Ellenőrizd, hogy a `duplicate` ág + a `szamlaKulsoAzon`-lekérdezés valóban átveszi-e a meglévő számlaszámot. **(b) HELYESBÍTŐ-eset (javító-kör):** ugyanahhoz a számlához állíts ki **két, eltérő összegű** helyesbítőt (két különböző refund-sorszámmal). A helyesbítő `rendelesSzam`-ja bizonylat-egyedi (`<orderNumber>-HELYESBITO-<seq>`), ezért a másodiknak **át kell mennie** — nem szabad 71/152-be futnia, és nem szabad az ELSŐ helyesbítőt sikerként visszaadnia. Utána küldd be a **második helyesbítőt még egyszer**, változatlan adatokkal: itt viszont 71/152 (vagy a korábbi bizonylat visszaadása) az elvárás, és a lekérdezéses feloldásnak a MÁSODIK helyesbítő számát kell átvennie. |
| **T8** | Hibakód-besorolás átmeneti/végleges volta (a kutatás 1. bizonytalansága) | A tesztkör során előforduló minden nem-nulla `hibakod`-ot naplózz ki (kód + üzenet + jöhet-e utána sikeres ismétlés). A `SZAMLAZZ_RETRYABLE_AGENT_CODES` jelenleg az `1`-est és az `55`-öst tartalmazza — ha a gyakorlat mást mutat, itt kell bővíteni vagy szűkíteni. Az 56-os kód pontos alakját (fejléc vagy törzs, számlaszámmal vagy nélküle) független mérés sem tudta előidézni; ha előjön, jegyezd fel a teljes választ. |
| **T12** | `<fizetve>true</fizetve>` és `<adoalany>` a valós fiókon (A7, A8, 2026-09-24) | Állíts ki egy számlát adószám nélkül és egyet adószámmal. Ellenőrizd: mindkettő **kiegyenlítettként** jelenik meg (nincs kintlévőség, a vevői fiók nem kínál fizetést), a PDF-en ott a „Fizetve" pecsét (ha a fiókban be van kapcsolva), és a NAV-adatszolgáltatásban a vevő típusa magánszemély, illetve belföldi adóalany. Utána stornózd az egyiket: a kifizetett számla stornója is menjen át. A másikhoz állíts ki egy részleges **helyesbítőt** (az is `<fizetve>true</fizetve>`-vel megy): fogadja el az Agent, és a vevő egyenlege nullán álljon (ne mutasson túlfizetést vagy tartozást). Ha a helyesbítőn a kifizetett jelzést elutasítja, a `buildInvoiceXml()` `corrective` ágán a `fizetve` elhagyandó. |
| **T9** | Mennyiség > 1 tétel elfogadása a hibrid számítással (A9, javító-kör) | Állíts ki egy számlát **qty = 3, 7 és 99** tételekkel (a 99 a checkout felső határa), olyan bruttó egységárral, amely 1,27-tel osztva nem egész (pl. 12 990 Ft). Ellenőrizd: (1) elfogadja-e az Agent a **2 tizedes** `nettoEgysegar` értéket; (2) átmegy-e a 2. egyenlet ≤ **0,64 Ft** eltérése (nem jön 260/263), és az 1. egyenleté (≤ 0,5 Ft, nem jön 259/262). Ha bármelyik elbukik, a `computeLineAmounts()` kerekítési stratégiáját kell átállítani (és a hibaüzenetben megjelölt sorszámot feljegyezni). |
| **T10** | Visszakereshető-e a stornó a kérésben küldött külső azonosítóval (A12/C3/C5, javító-kör) | Egy teszt-számla stornózásakor küldj a stornó-kérésben **kísérleti** `szamlaKulsoAzon`-t (a doksi szerint ez a sztornózandó számlát hivatkozza), majd az `xmlszamlapdf`-lekérdezéssel (`queryInvoiceByKulsoAzon`) kérdezz rá **ugyanarra** az értékre. Jegyezd fel, melyik bizonylat jön vissza: az **eredeti** számla, a **stornó**, vagy 7-es „nincs találat". Csak akkor hozható vissza a stornó-ágra a beküldés előtti lekérdezés (és vele az automatikus feloldás), ha a lekérdezés bizonyíthatóan a **stornót** adja vissza. |
| **T11** | Kihagyott dátumok mellett mit tölt ki a rendszer a stornón (C6, javító-kör) | Állíts ki egy számlát úgy, hogy a teljesítési dátuma egy **korábbi naptári hónapba** essen (pl. előző havi teljesítés), majd a **következő hónapban** stornózd — a stornó-kérés a mostani kód szerint **dátumok nélkül** megy. Nyisd meg a stornó PDF-jét, és hasonlítsd össze a **teljesítési dátumot** az eredeti számláéval. Ha nem egyezik, a `buildStornoXml()`-be vissza kell tenni a `teljesitesDatum`-ot az `invoiceCompletionDate`-ből (a `BuildStornoXmlInput` bővítésével), és a C6-sort újra kell értékelni. |

---

## Fiók-oldali előfeltételek (üzemeltetői checklist)

Sorrendben elvégzendő. A kódot ezek egyike sem érinti — a `docs/szamlazz-storno.md`
„Élesítéshez szükséges" pontjait egészítik ki.

1. **Teszt-fiók létrehozása fejlesztéshez.** Éles fiókban tesztelni tilos (Agent-díj, az
   automatikus számlázás leállhat). Feltétel: a fiókkal még nem számláztak és nincs
   NAV-összekötés; ugyanazzal az adószámmal is regisztrálható. A teszt-fiókban a számlák
   nem számviteli bizonylatok, nem mennek a NAV-hoz, és az értesítő e-mail **mindig a fiók
   kapcsolattartási címére** megy (nem az XML-ben megadott vevő-címre).
2. **Agent-kulcs generálása** (vezérlőpult → Számla Agent kulcsok), és beállítása
   `SZAMLAZZ_AGENT_KEY` környezeti változóként. **A kulcsot kisbetűs alakban add meg** —
   nagybetűvel a hitelesítés elbukhat, és a kód nem alakítja át. A kulcs nem jár le
   (kézi törlésig), fiókonként max. 17 lehet.
3. **Rendelésszám-ismétlés tiltásának BEKAPCSOLÁSA** (bizonylattípusonként).
   **Ez a hivatalos idempotencia-védelem alapja:** bekapcsolva az azonos, ismételt kérésre
   2 napon belül a korábban kiállított számla jön vissza, eltérő adatnál pedig 71/152-es
   kód — amit a kód duplikátum-találatként old fel. Kikapcsolva ez a védelem nem él, és
   csak a saját, alkalmazás-oldali no-opokra támaszkodhatunk.
4. **A `KIN` előtag felvétele** (Beállítások → Előtagok). Ismeretlen előtag → 202-es hiba,
   ami végleges (nem retryable), tehát a számla nem áll ki. Az előtag max. 5 karakter,
   ékezet nélküli nagybetű/szám, és csak addig módosítható, amíg nem készült vele számla.
   Ha más előtagot használunk, a `SZAMLAZZ_INVOICE_PREFIX` állítandó át.
5. **E-számla engedélyezése + csomag-ellenőrzés.** A kód mindenhol `eszamla=true`-t küld;
   ha a fiókban/csomagban az e-számla nincs engedélyezve, minden kiállítás **54-es hibával**
   bukik (tanúsítvány/időbélyeg-hiba esetén 55-össel, amit a kód legfeljebb ötször
   újrapróbál). Agentből csak az a funkció érhető el, amit a csomag manuálisan is biztosít.
   Az e-számla és a kifizetettség kezelése (`<fizetve>true</fizetve>`) egyaránt előfizetéses
   (#start vagy magasabb) csomagot kíván; a #free csomagban „nincs lehetőség kifizetettséget
   kezelni" (`tudastar.szamlazz.hu/gyik/fizetve-pecset-a-szamlan`).
6. **NAV Online Számla technikai felhasználó bekötése** (a NAV-rendszerben létrehozva,
   a kulcsok a Számlázz.hu-fiókban rögzítve). Utána az adatszolgáltatás automatikus.
   Teszt-fióknál ez a kapcsolat nem hozható létre — csak az éles fiókon értelmezhető.
7. **Vevői fiók be/ki döntés.** Bekapcsolva a válasz `vevoifiokurl`-t is ad, amit a kód
   allowlist után a rendelés `invoicePdfUrl` mezőjébe ment, és a vásárló fiók-oldalán
   kattintható linkként jelenít meg. **Kikapcsolva ez a link nem jön** — a számla-PDF
   ilyenkor csatolmányként megy ki az értesítő e-maillel, a fiók-oldalon viszont nem lesz
   számlalink. A kód egyik esetben sem hibázik.
8. **`SZAMLAZZ_AFAKULCS` beállítása a cég adózási státusza szerint** — `27` (általános)
   vagy `AAM` (alanyi adómentes). **KÖNYVELŐVEL egyeztetendő!** Alanyi adómentes eladóként
   belföldön kizárólag az `AAM` kulcs jogszerű (a 0% és a TAM nem). Rossz érték esetén
   minden számla hibás áfakulccsal állna ki — ezért **ismeretlen érték mellett az
   alkalmazás el sem indul** (`assertRequiredEnv()`, `src/env.ts`); elgépelés esetén tehát
   az indulás bukik, nem az első számla. **A változót elhagyni NEM szabad**, ha a számlázás be
   van kapcsolva (van `SZAMLAZZ_AGENT_KEY`): alapértelmezés nincs, minden számlázási
   művelet konfigurációs hibával áll meg. Kifejezetten `27`-et vagy `AAM`-ot kell megadni.
   *Maintainer-teendő:* a `.env.example` jelenleg a `SZAMLAZZ_AGENT_KEY`,
   `SZAMLAZZ_INVOICE_PREFIX`, `SZAMLAZZ_API_URL`, `SZAMLAZZ_TIMEOUT_MS` kulcsokat sorolja
   — a `SZAMLAZZ_AFAKULCS` kulcsnevet (érték nélkül) fel kell venni mellé.

---

## Üzemeltetési jegyzet

### Max. 5 beküldés — hol látszik, mi a teendő

A Számlázz.hu hivatalos szabálya szerint ugyanaz a kérés legfeljebb ötször küldhető be;
utána emberi beavatkozás kell, mert az automatikus retry-loop **kitiltáshoz** vezethet.
A számlálók a **rendelésen perzisztensek**, tehát a Payload job-retry (`retries: 3`) és az
order-poll resweep együttese sem lépheti túl a plafont.

| Ág | Konstans | Számláló-mező | A számláló hatóköre | Utolsó hiba |
|---|---|---|---|---|
| Számlakiállítás | `MAX_INVOICE_ATTEMPTS` (`invoice.ts`) | `invoiceAttempts` | **rendelés** (rendelésenként egy számla) | `invoiceLastError` |
| Stornó | `MAX_STORNO_ATTEMPTS` (`storno.ts`) | `stornoAttempts` | **rendelés** (rendelésenként egy stornó) | `stornoLastError` |
| Helyesbítő | `MAX_CORRECTIVE_ATTEMPTS` (`corrective.ts`) | `correctiveInvoiceAttempts` + `correctiveInvoiceAttemptsSeq` | **bizonylat**: a számláló a refund-sorszámhoz kötött, és **új sorszámnál nulláról indul** | `correctiveInvoiceLastError` |

Amit a keret **fogyaszt**, és amit nem:

- **Fogyaszt:** kizárólag a tényleges beküldés (`postInvoiceXml` / `postStornoXml`) — a
  számláló közvetlenül a POST előtti `pending`-írásban nő.
- **Nem fogyaszt:** a beküldés-ismétlés előtti bizonylat-lekérdezés
  (`queryInvoiceByKulsoAzon`, csak a **számla-** és a **helyesbítő-ágon**) — ha a
  lekérdezés hibázik, a keret érintetlen marad, a művelet pedig újrapróbálhatóként áll
  meg (nem küld be vakon semmit).
- **Számla-ág:** újrapróbálható hiba után a státusz `pending` marad (az okot az
  `invoiceLastError` hordozza), így a job-retryk kifogyása után az **order-poll resweep**
  (`INVOICE_PENDING_STALE_MS` = 10 perc után) újra sorba állítja. A fék tehát a perzisztens
  plafon, nem a job-retryk száma.
- **Stornó- és helyesbítő-ág:** itt nincs resweep — az újrasorbaállítást a refund-folyamat
  queue-hívása (`storno-issue` / `corrective-invoice-issue` job) végzi.

**Kimerüléskor** a szolgáltatás hálózati hívás **nélkül** `failed` kimenetet ad, a státuszt
`failed`-re állítja, az okot a `*LastError` mezőbe írja, és `RIASZTÁS:` előtagú, error-szintű
bejegyzést naplóz. Ilyenkor a bizonylatot kézzel kell rendezni a Számlázz.hu-felületen,
majd a számot a rendelésre visszavezetni.

**Ugyanez a kézi ág a stornó bizonytalan állapotánál is.** A stornó-ágon nincs
beküldés előtti lekérdezés (C3/C5): ha egy stornó-kísérlet után nem tudjuk, létrejött-e a
bizonylat (nem az első kísérlet, vagy 71/152-es „duplikátum" jelzés jött), a szolgáltatás
**nem küld be újra** — `failed` + `RIASZTÁS:` naplóbejegyzés, magyar szöveggel („a stornó
állapota bizonytalan, kézi ellenőrzés kell a Számlázz.hu-fiókban"). Az ok: dupla stornót a
hivatalos szabály szerint sem stornóval, sem helyesbítővel nem lehet visszavonni — csak új,
helyreállító számlával, könyvelői egyeztetéssel.

**Az adminban:** Webshop → Rendelések, a rendelés szerkesztőjében a *Számla állapota*,
*Számla-kísérletek száma*, *Számlázás utolsó hibája*, illetve a stornó/helyesbítő
megfelelői — a helyesbítőnél a *Helyesbítő-kísérletek refund-sorszáma*
(`correctiveInvoiceAttemptsSeq`) mutatja, MELYIK bizonylathoz tartozik az aktuális
számláló-állás. Mindegyik **readOnly** — kizárólag a rendszer írja őket
(`writeOrderInvoicingState`, `overrideAccess: true`). A bizonylatszám-mezők
(`invoiceNumber`, `stornoNumber`, `correctiveInvoiceNumber`) mezőszintű olvasása
owner-only.

### Ismert, elfogadott korlát: a kísérlet-számlálók írása nem atomikus

A számlálók **olvasás-módosítás-írás** mintával frissülnek (a rendelés friss példányából
`previousAttempts + 1`), **zár nélkül**. Elvi ütközési ablak tehát létezik: ha ugyanarra a
rendelésre két folyamat (pl. egy job-retry és az order-poll resweep által indított új
futás) egyszerre lépne be, mindkettő ugyanazt az induló értéket olvashatná, és a plafon
egy-két kísérlettel túlléphető lenne.

Ezt **tudatosan nem javítottuk** kóddal, mert a gyakorlati esélye elhanyagolható: a
job-retryk másodperces nagyságrendben futnak le, a resweep pedig csak több perces
stale-ablak (`INVOICE_PENDING_STALE_MS` = 10 perc) után indít új futást — a két időskála
nem ér össze. A hatás a legrosszabb esetben is korlátos: néhány extra beküldés a hivatalos
5-ös korlát fölött, **nem** végtelen retry-loop.

Ha valaha mégis szükség lesz rá, a javítás iránya adott: a **teljes kiállítási szakasz** a
meglévő `withAdvisoryLock()` (`src/lib/advisory-lock.ts`) alá tehető rendelésenkénti
kulccsal — a Barion-refund (`src/lib/refund/refund-order.ts`) már így fut. Amíg ez nem
történik meg, ez **ismert és vállalt** korlát, nem felderítetlen hiba.

### Titokkezelés és naplózás

- Az agent-kulcs **kizárólag** a kérés XML-törzsében utazik — sosem URL-ben, sosem
  query-stringben.
- A logger redact-listáján (`src/lib/logger.ts`) a `szamlaagentkulcs`, `agentkey`,
  `agent_key`, `apikey` és az `email` kulcsnév is rajta van; az így nevezett mezők értéke
  `[REDACTED]`-ként jelenik meg.
- **Kérés- és válasz-body sosem kerül naplóba** — sem a számla-XML (vevő-személyes adatot
  hordoz), sem a válasz. Naplóba a művelet neve, az időtartam, a bizonylatszám, a
  hibakódok és a hiba szövege megy, request ID-vel.
- A `vevoifiokurl` teljes URL-je sem naplózódik (query-stringben tokent hordozhat) — hiba
  esetén csak a hoszt (`safeUrlHost()`).

### Környezeti változók (kulcsnevek, értékek NÉLKÜL)

| Kulcs | Szerep |
|---|---|
| `SZAMLAZZ_AGENT_KEY` | Számla Agent kulcs. **Titok.** Hiánya nem hiba: az integráció ilyenkor kikapcsolt (`enabled=false`), a fizetési lánc változatlanul működik. |
| `SZAMLAZZ_API_URL` | Agent-végpont felülírása (default: a hivatalos, **záró perjeles** cím). Nem https, érvénytelen URL vagy URL-be ágyazott hitelesítő adat esetén hangos hiba — **az első számlázási művelet futásakor** (a feloldás lusta, nem indulási ellenőrzés). A query-string megmarad, a záró perjelet a normalizálás pótolja. |
| `SZAMLAZZ_INVOICE_PREFIX` | Számlaszám-előtag (default: `KIN`) — a fiókban felvett előtagok egyike kell legyen. |
| `SZAMLAZZ_AFAKULCS` | Áfakulcs: `27` vagy `AAM`. **Más érték esetén az alkalmazás el sem indul** (`assertRequiredEnv()`, `src/env.ts` — minden környezetben). **Bekapcsolt számlázásnál kötelező, alapértelmezés nincs:** hiányában minden számlázási művelet konfigurációs hibával áll meg (`getSzamlazzConfig()`). Csak kikapcsolt számlázásnál (agent-kulcs nélkül) hagyható el. |
| `SZAMLAZZ_TIMEOUT_MS` | Kérés-timeout ezredmásodpercben (default: 15 000). |

Feloldásuk egy helyen: `getSzamlazzConfig()` (`src/lib/szamlazz/client.ts`) — tiszta
függvény, env-paraméterrel tesztelhető. **Fontos különbség:** ez a feloldás **lusta** (az
első számlázási művelet hívja), ezért az itt jelzett hibák nem indulási hibák — az egyetlen
kivétel a `SZAMLAZZ_AFAKULCS`, amelyet az indulási env-ellenőrzés is átnéz, mert egy
elgépelt áfakulcs minden számlát elrontana, és a hiba csak a könyvelésben derülne ki. Az
indulási ellenőrzés csak a **hibás** értéket fogja meg; a **hiányzó** kulcsot (bekapcsolt
számlázás mellett) az első számlázási művelet jelzi konfigurációs hibaként.
