# 08 Havi egyeztetés (háromutas)

**Mikor:** minden hónap 5-éig az előző hónapra. Az eredményt (eltéréslista) a
könyvelő kapja.

**A kulcs:** a rendelésszám (KH-ÉÉÉÉ-NNNNNN) mindhárom rendszerben ugyanaz:

- **Barion:** a fizetési kérés azonosítója (Payment request ID), amely a havi
  kivonatban és a tranzakció-exportban is szerepel;
- **Számlázz.hu:** a számla rendelésszáma és külső azonosítója (a helyesbítőé
  `KH-…-HELYESBITO-<sorszám>`, a stornó az eredeti számlára hivatkozik);
- **Kineticare:** a rendelésszám.

A Kineticare statisztika-oldala tájékoztató szám; könyvelni a Számlázz.hu
bizonylataiból és a Barion havi kivonatából kell.

## Lépések

1. **Barion:** a Barion-fiókban (secure.barion.com) a bolt fizetési
   előzményeiből exportáld az előző hónapot, és töltsd le a havi kivonatot
   (PDF). A kivonat a könyvelési bizonylat.
2. **Számlázz.hu:** exportáld a hónap számláit, stornóit és helyesbítőit
   (számlaszám, típus, rendelésszám, nettó, áfa, bruttó, teljesítés dátuma).
3. **Kineticare:** a fejlesztő futtassa le az egyeztető exportot (CSV):

   ```bash
   npx tsx src/scripts/export-penzugyi-egyeztetes.ts --honap 2026-09 --kimenet ./egyeztetes-2026-09.csv
   ```

   A fájlban minden rendelés benne van, amely a hónapban jött létre vagy a
   hónapban kapott visszatérítést. A részleges visszatérítés is ide tartozik,
   akkor is, ha a rendelés egy korábbi hónapban jött létre. Oszlopok:
   rendelésszám, létrehozás és fizetés ideje (magyar idő), állapot, bruttó
   összeg, számla, stornó és helyesbítő száma és állapota, teljesítés dátuma,
   visszatérítések, Barion PaymentId. Vevő neve és e-mail-címe nincs benne. A
   szkript csak olvas. A fejlesztő a lenti A–G ellenőrző lekérdezéseket is
   futtassa le.

   A visszatérítésnek három oszlopa van:
   - `visszaterites_honapban_huf`: a hónapban visszautalt összeg. Ha a
     rendelés a hónapban több visszatérítést kapott, ez az összegük;
   - `visszaterites_honapban_tetelei`: a hónap visszatérítései egyenként,
     összeggel és időponttal, például
     `20000 Ft (2026. 10. 05. 11:00) | 5000 Ft (2026. 10. 20. 11:00)`. A hónap
     Barion-visszatérítéseit, stornóit és helyesbítőit tételenként ezzel
     párosítsd;
   - `visszaterites_halmozott_huf`: a hónap végéig összesen visszautalt
     összeg, a korábbi hónapokéval együtt. Ebből látszik, hogy a rendelés
     árából mennyi maradt a cégnél. A hónap utáni visszatérítés egyik oszlopba
     sem kerül.

   Az `allapot` oszlop a futtatás pillanatának állapota. Egy októberben
   részben, novemberben teljesen visszatérített rendelés az októberi fájlban is
   „refunded”, ha a fájl a novemberi visszatérítés után készül; a havi oszlopai
   ettől még csak az októberi visszatérítést mutatják.

4. **Párosítás rendelésszám szerint:**
   - minden Barion „Succeeded” fizetéshez pontosan egy számla tartozik,
     ugyanazzal a bruttó összeggel;
   - minden Barion-visszatérítéshez stornó (teljes) vagy helyesbítő (részleges)
     tartozik, ugyanazzal az összeggel, és a Kineticare-sor havi tételei között
     is ott van egy ugyanekkora tétel;
   - minden számla mögött élő Barion-fizetés áll; teszt- vagy próbavásárlás nem
     viselhet számlát;
   - a Barion „Unsuccessful” visszatérítése azt jelenti, hogy a vevő nem kapta
     vissza a pénzt;
   - Barion-fizetés, amelynek rendelésszáma a Kineticare-ben „Lemondva”,
     „Sikertelen fizetés” vagy hiányzik: eltérés, [02](02-fizetett-de-nincs-hozzaferes.md).
5. **Díjak:** add össze a hónap díjsorait a Barion-exportból, és add át a
   könyvelőnek (a kivonat a bizonylat).
6. **Egyenleg:** nyitó egyenleg + befizetések − díjak − visszatérítések −
   kifizetések − kifizetési díjak − visszaterhelések = záró egyenleg a kivonat
   szerint. A kifizetés ugyanazzal az összeggel szerepeljen a bankszámlán.
7. **Hónapforduló:** a hónap utolsó napján késő este fizetett rendelésnél nézd
   meg, hogy a számla teljesítési dátuma nem csúszott-e át a következő hónapba.
8. **Tartalék:** a tárcában maradjon legalább a legdrágább kurzus ára és a
   függő visszatérítések összege ([09](09-barion-egyenleg-es-kifizetes.md)).
9. **Eltéréslista:** minden eltérést vezess fel (rendelésszám, mi az eltérés,
   oka, javítás, ki intézi), és küldd el a könyvelőnek. Ide kerülnek a kézzel
   kiállított bizonylatok is ([05](05-szamla-storno-helyesbito-kezi.md)).
10. **Megőrzés:** a kivonatot, az exportokat és az eltéréslistát 8 évig őrizd
    meg (Számviteli tv. 169. § (2)).

## Ellenőrző lekérdezések (A–G, csak olvasás, fejlesztőnek)

Mindig csak olvasó tranzakcióban futtasd:

```sql
BEGIN TRANSACTION READ ONLY;
-- ide a lekérdezés
ROLLBACK;
```

**A) Fizetett, de nincs kiállított számla (2 óránál régebbi):**

```sql
SELECT order_number, created_at, invoice_status, invoice_attempts
FROM orders
WHERE status = 'paid'
  AND (invoice_number IS NULL OR invoice_status <> 'issued')
  AND created_at < now() - interval '2 hours'
ORDER BY created_at;
```

**B) Számla nem fizetett rendelésen, vagy visszatérített rendelés stornó
nélkül; és elveszett válaszú számla gyanúja:**

```sql
SELECT order_number, status, invoice_number, storno_number, storno_status
FROM orders
WHERE invoice_number IS NOT NULL
  AND (status NOT IN ('paid', 'refunded')
       OR (status = 'refunded' AND storno_number IS NULL));

SELECT order_number, status, invoice_status, invoice_attempts
FROM orders
WHERE status = 'refunded'
  AND invoice_status IN ('pending', 'failed')
  AND invoice_attempts > 0;
```

**C) Részleges visszatérítés helyesbítő nélkül:**

```sql
SELECT order_number, jsonb_array_length(refunds) AS visszateritesek,
       corrective_invoice_seq, corrective_invoice_status
FROM orders
WHERE jsonb_typeof(refunds) = 'array'
  AND jsonb_array_length(refunds)
      - CASE WHEN refunds -> 0 ->> 'type' = 'full' THEN 1 ELSE 0 END
      > coalesce(corrective_invoice_seq, 0);
```

**D) Elakadt visszatérítési szándék:**

```sql
SELECT ri.id, o.order_number, ri.state, ri.requested_amount_huf, ri.created_at
FROM refund_intents ri
JOIN orders o ON o.id = ri.order_id
WHERE ri.state <> 'committed'
  AND ri.created_at < now() - interval '15 minutes'
ORDER BY ri.created_at;
```

**E) Sikertelen vagy kimerült bizonylat:**

```sql
SELECT order_number, invoice_status, storno_status, corrective_invoice_status,
       invoice_attempts
FROM orders
WHERE invoice_status = 'failed'
   OR storno_status = 'failed'
   OR corrective_invoice_status = 'failed'
   OR invoice_attempts >= 5;
```

**F) Barion-rendellenességek:**

```sql
SELECT provider, external_id, status, result, attempts, updated_at
FROM webhook_events
WHERE provider = 'barion'
  AND (result IN ('rejected', 'failed') OR status <> 'processed');

SELECT order_number, status, barion_payment_id IS NOT NULL AS van_barion_azonosito
FROM orders
WHERE (status IN ('cancelled', 'payment_failed', 'refunded') AND barion_payment_id IS NOT NULL)
   OR (status = 'cancelled' AND barion_payment_id IS NULL);
```

Ezeket a rendelésszámokat egyenként keresd meg a Barion-exportban.

**G) Hibára futott háttérfeladatok:**

```sql
SELECT id, task_slug, created_at, updated_at, error
FROM payload_jobs
WHERE has_error
  AND task_slug::text IN ('invoice-issue', 'storno-issue', 'corrective-invoice-issue', 'order-poll')
ORDER BY updated_at DESC;
```

A `schedule-guard` által lezárt, beragadt futások is itt látszanak (az `error`
mezőben `releasedBy: schedule-guard`); ezek egyenként nem teendők, csak ha
sűrűn fordulnak elő. A rendszer egy futást csak két órával az indulása után
zár le, mert addig még élhet; az új futásokat egy ilyen sor 15 perc után már
nem tartja fel. Ha a lezárás hibára fut, a sor ebben a listában nem jelenik
meg (a `has_error` hamis marad), helyette `beragadt-job-lezaras-sikertelen`
kódú riasztás szól róla.

## Kérdések a könyvelőnek (egyszer, írásban)

1. Online kurzus azonnali hozzáféréssel: a fizetés napja a teljesítés napja? A
   következő hónapba átcsúszott számlát hogyan kezeljük?
2. Hogyan könyveljük a Barion-tárcát, elég-e bizonylatnak a havi kivonat, és a
   Barion díját ráfordításként külön könyveljük-e?
3. Melyik áfa-időszakba esik a stornó és a helyesbítő?
4. Hogyan könyveljük a visszaterhelést, kell-e stornó?
5. Mi a teendő, ha a stornó kiment, de a kártyás visszatérítés utólag elbukott?
6. Hogyan számlázzuk és sztornózzuk a saját próbavásárlásainkat?
