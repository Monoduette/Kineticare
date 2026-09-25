# 03 Hiányzó levél

**Mikor:** a vevő nem kapta meg a visszaigazoló levelet (benne a
jelszó-beállító vagy belépési link), vagy a számlát.

A két levél két helyről jön:

- a **visszaigazolást** a Kineticare küldi a Resenden át, a fizetés lezárásakor;
- a **számlát** a Számlázz.hu küldi, a számla kiállításakor (a fizetés után
  általában 5 percen belül).

## 1. Az első három kérdés

1. Nézte-e a vevő a **Spam** és a **Promóciók** mappát?
2. Jó-e a cím? Webshop → **Rendelések** → a rendelés: a vevő e-mail-címe. Ha
   elgépelte, a levél máshová ment; ilyenkor a 4. pont.
3. Fizetve áll-e a rendelés? Ha „Fizetésre vár” vagy „Lemondva”, nem is ment
   levél: [02](02-fizetett-de-nincs-hozzaferes.md).

## 2. Visszaigazoló levél

1. A Resend felületén (resend.com → Emails) keress rá a vevő címére. A Resend
   30 napig őrzi a küldési adatokat; régebbi levélnél ez a lépés kimarad.
   - „Delivered”: a levél átment, a vevő postafiókja szűrte ki.
   - „Bounced” vagy „Complained”: a cím nem fogad levelet, vagy a vevő
     spamnek jelölt egy korábbi levelet. Kérj másik címet (4. pont).
   - Nincs találat: a küldés el sem indult. Railway → Logs, keresés:
     `visszaigazoló e-mail`; a sort a rendelésszámmal együtt küldd a
     fejlesztőnek.
2. A belépéshez a levél nem feltétlenül kell: a vevő az **Elfelejtett jelszó**
   oldalon a vásárláskori címével új jelszót állíthat, és a Kurzusaim oldalon
   látja a kurzust.

## 3. Számla

1. A vevő a fiókjában (Fiók oldal, a rendelésnél) a számlát letöltheti, ha a
   számla már elkészült.
2. A Számlázz.hu felületén a számla megtalálható a rendelésszámmal; innen
   letöltheted a PDF-et és elküldheted a vevőnek.
3. Ha a rendelésen a **Számla állapota** „Sikertelen” vagy 2 óra után is
   „Nincs” vagy „Függőben”: [05](05-szamla-storno-helyesbito-kezi.md).

## 4. Rossz vagy nem működő e-mail-cím

A rendelés és a fiók e-mail-címét ne írd át kézzel. Kérd a vevőtől a helyes
címet, és szólj a fejlesztőnek: a fiókot a vevő azonosítása után ő javítja.
A számlát addig a Számlázz.hu-ból a helyes címre küldheted.

## 5. Bizonyítás későbbre

Ha a vevő panaszt tesz vagy vitatja a fizetést, a kézbesítés igazolása csak
30 napig van meg a Resendben és a Railway-naplóban. Ilyenkor még aznap mentsd
el a Resend-rekord képernyőképét a panaszkezelési naplóhoz
([10](10-panaszkezeles.md)).
