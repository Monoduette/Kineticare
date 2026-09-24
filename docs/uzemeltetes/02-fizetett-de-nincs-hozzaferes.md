# 02 Fizetett, de nincs hozzáférés

**Mikor:** a vevő azt írja, hogy fizetett, de nem látja a kurzust a
Kurzusaim oldalon.

**Határidő:** az ÁSZF szerint ilyenkor „a KINETICARE legkésőbb a következő
munkanapon manuálisan megnyitja a hozzáférést”. Ezt tartsd.

**Ne ajándékozz kurzust** a vevőnek a Kurzus ajándékozása panellel: az nem
zárja le a fizetett rendelést és nem állít ki számlát
([részletek](../manualis-vasarlas-hozzaadas.md)).

## 1. Keresd meg a rendelést

1. Kérd el a rendelésszámot (KH-ÉÉÉÉ-NNNNNN). A köszönőoldalon és a
   visszaigazoló levélben szerepel.
2. Ha nincs meg: Webshop → **Rendelések**, a keresőbe írd a vevő e-mail-címét.
   Figyelj arra, hogy a vevő ugyanazzal a címmel lépjen be, amellyel vásárolt.

## 2. Mit mutat a rendelés állapota

| Állapot a listán | Mit jelent                                                            | Teendő  |
| ---------------- | --------------------------------------------------------------------- | ------- |
| Fizetve          | A rendszer lezárta a fizetést, a hozzáférés beíródott                 | 3. pont |
| Fizetésre vár    | A Barion még nem jelzett végleges eredményt, vagy a jelzés nem ért el | 4. pont |
| Lemondva         | A Barion megszakított vagy lejárt fizetést jelzett                    | 5. pont |

## 3. „Fizetve”, mégsem látja

1. Nyisd meg a vevőt: Fiókok → **Felhasználók** → a vevő. A **Megvásárolt
   kurzusok** között ott kell lennie a kurzusnak.
2. Ha ott van, a gond a belépésnél van: vendégként vásárolt vevőnek a
   rendszer fiókot nyit, és jelszó-beállító linket küld. Kérd meg, hogy az
   „Elfelejtett jelszó” úton állítson jelszót ugyanazzal az e-mail-címmel,
   aztán lépjen be, és frissítse a Kurzusaim oldalt.
3. Ha nincs ott: szólj a fejlesztőnek a rendelésszámmal. Ne pipáld kézzel.

## 4. „Fizetésre vár”

1. Nézd meg a Barion-fiókban (secure.barion.com, a bolt fizetési előzményei)
   a fizetést. A Barionban a „fizetési kérés azonosítója” (Payment request ID)
   maga a rendelésszám.
2. Ha a Barion szerint **sikeres** (Succeeded): a rendszer ötpercenként magától
   rákérdez a Barionra, és lezárja a rendelést. Várj 10 percet, és frissítsd a
   rendelést.
   - Ha 10 perc múlva is „Fizetésre vár”: szólj a fejlesztőnek (a rendelésszám
     és hogy a Barion szerint sikeres). A napi összesítő és egy nap után a
     `fuggo-fizetes-24-ora` riasztás is jelzi.
3. Ha a Barion szerint **folyamatban** van: a vevő még a Barion oldalán áll,
   vagy a fizetés függőben van a banknál. A 30 perces fizetési ablak után a
   Barion lezárja, a rendszer követi.
4. Ha a Barion szerint **nincs ilyen fizetés**: a rendelés nem jutott el a
   Barionig. Pénz nem mozdult; a rendszer egy napon belül lemondja, a vevő
   újra megrendelheti.

## 5. „Lemondva”, de a vevő szerint fizetett

1. Nézd meg a Barion-fiókban. Ha a Barion szerint a fizetés **sikeres**, a
   rendszer a lemondott rendeléseket 7 napig ötpercenként újra ellenőrzi, és a
   késve sikerült fizetést magától lezárja (hozzáférés, számla).
2. Ha a rendelés 7 napnál régebbi, vagy 10 perc után sem változik: szólj a
   fejlesztőnek. Addig a vevőnek írd meg, hogy a befizetését megtaláltad, és a
   következő munkanapon rendezed.
3. Ha a hibát nem lehet a határidőig rendezni, a másik tisztességes út a teljes
   összeg visszatérítése a Barionban (egyeztesd a fejlesztővel, hogy ne legyen
   dupla visszatérítés).

## 6. Válasz a vevőnek

Röviden: megtaláltad a befizetését, mikor és hogyan kapja meg a hozzáférést,
és ha kell, hogyan állítson jelszót. A levél maradjon meg a panaszkezelési
naplóban, ha a vevő panaszként írt ([10](10-panaszkezeles.md)).
