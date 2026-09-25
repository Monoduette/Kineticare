# 13 Visszaállítási próba

**Mikor:** a fejlesztő havonta elvégzi a technikai próbát
([`docs/adatbazis-mentes.md`](../adatbazis-mentes.md) 7. fejezet).
Negyedévente a tulajdonos is részt vesz, és az üzleti ellenőrzést is elvégzi
(lent).

**Miért:** „Egy mentés, amit sosem állítottak vissza, nem mentés, hanem
feltételezés.” Egy adatvesztés után a rendelések, a hozzáférések, a
visszatérítési szándékok és a számlaszámok csak a mentésből jönnek vissza.

## A fejlesztő lépései (röviden)

1. A legutóbbi _DB mentés_ workflow-artifact letöltése és visszafejtése
   (adatbazis-mentes.md 6.1).
2. Ellenőrzés visszaállítás előtt (6.2), visszaállítás **üres, eldobható**
   adatbázisba (6.3), ellenőrző lekérdezések (6.4).
3. A visszaállítás idejének mérése.
4. A próba-adatbázis és a visszafejtett fájl törlése.

## Az üzleti ellenőrzés (negyedévente, a tulajdonossal)

A visszaállított, eldobható adatbázison a fejlesztő lekérdezi, a tulajdonos
összeveti:

1. **Rendelések:** a legutóbbi 5 fizetett rendelés rendelésszáma, összege és
   számlaszáma egyezik a Számlázz.hu-val.
2. **Hozzáférés:** egy ismert vevő megvásárolt kurzusai megvannak.
3. **Visszatérítések:** a Visszatérítési szándékok száma és a legutóbbi
   állapota egyezik az élessel (a mentés időpontjáig).
4. **Havi egyeztetés:** az előző havi egyeztető export
   ([08](08-havi-egyeztetes.md)) a visszaállított adatbázisból ugyanazt adja,
   mint élesben (a mentés időpontjáig).

## Jegyzőkönyv

Írd fel: dátum, a mentés időpontja, a visszaállítás ideje percben, az
eltérések (ha voltak), ki végezte. Ha a próba nem sikerült, az azonnali
teendő: a fejlesztő a hibát a következő munkanapon javítja, mert addig nincs
bizonyítottan visszaállítható mentés.

## Amit a mentés nem hoz vissza

- A feltöltött médiafájlokat (képek) a kötet tárolja, nem az adatbázis
  (adatbazis-mentes.md 3. fejezet).
- A Railway-naplót és a Resend levélküldési adatait (30 napig élnek).
- A Barion és a Számlázz.hu adatait: azok a saját rendszerükben maradnak, és a
  havi egyeztetés velük párosít.
