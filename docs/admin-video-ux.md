# Admin videótár és kurzusszerkesztés

## Hatókör

A 2026-09-09-i tulajdonosi kérés a meglévő Kurzusaim és kurzusonkénti
jogosultságkezelés megtartásával teszi könnyebbé az új videós kurzusok
szerkesztését. A tulajdonos külön jóváhagyta a munkatársi feltöltési és
előnézeti jogosultság kiegészítését, valamint a folytatható feltöltést kezelő
klienskönyvtár hozzáadását. Ez nem éles feltöltési, szolgáltatói beállítási,
ár-, hozzáférés-adat- vagy tartalommódosítási engedély.

Alap: `0f0d6c600636bf822c7d57a18f238f6314c4b894`. A külön nyitott #242
adminjavítási PR nem része ennek a változtatásnak. Függőségváltozás külön
review-egység. A későbbi, GitHub nélküli helyi javításra adott tulajdonosi
kérés külön engedélyezte az alább dokumentált biztonsági csomagfrissítést
és a meglévő pénzügyi teszt javítását.

## Elfogadási feltételek

1. Új modul-leckében és a régi videólistában is kiválasztható a védett
   videó azonosítómásolás nélkül. A nyilvános bemutató külön tárból választ.
2. A tananyag sorazonosítói, sorrendje, típusa és megadott címei megmaradnak.
   Átrendezés vagy törlés közben visszaérkező kérés nem írhat másik leckébe.
3. Kiválasztáskor a videó, hossz és feldolgozási állapot összetartozik.
   Mentés és újranyitás után is ugyanaz a kapcsolat jelenik meg.
4. Keresés, lapozás, előnézet, üres lista, hiba, újrapróbálkozás és
   megszakítás működik. Videócseréhez egyértelmű megerősítés kell.
5. A feltöltés közvetlenül a védett Bunny-tárba megy. Megállítható és
   az érvényes feltöltési munkamenetben folytatható. A lejárt vagy
   bizonytalanul létrehozott feltöltés nem indít automatikus másolatot.
6. A sikeres fájlátvitel és a kész, feldolgozott videó külön állapot.
   A kliens nem állíthatja önmagában készre a szolgáltatói videót.
7. A mentett, nem publikált kurzus értékesítési oldala csak frissen
   hitelesített staff/owner számára tekinthető meg előnézetben.
   Vásárlói lejátszási jogosultságot ez nem ad, és nem publikál.
8. Feltöltés és védett előnézet: friss hitelesítés, szerepkör, Origin,
   bemenetkorlát, felhasználónkénti rate limit, időkorlát és no-store.
   Kulcs, munkamenetjegy és érzékeny szolgáltatói hiba nem kerül naplóba.
9. Az admin felület billentyűzettel végigjárható; a párbeszédablak kezeli
   a fókuszt és visszaadja a nyitó vezérlőnek. 320 px-en nincs oldalirányú
   dokumentumgörgetés. A fő vezérlők célmérete 44 px, a szöveg és a
   fókuszjelölés kontrasztját mérés ellenőrzi világos és sötét témában.
10. Fizetés, vásárlói grant, SOS-kurzus, Kurzusaim, haladásazonosító és
    tanulói tokenkiadás viselkedése változatlan. Nincs új csomagmodell,
    tananyag-migráció, videótörlés vagy automatikus publikálás.

## Biztonsági tervezési döntések

- A feltöltési képesség csak a szerver által létrehozott védett videóra
  vonatkozik. Újraaláírásnál a felhasználó, hitelesített munkamenet,
  célművelet, library, GUID és eredeti lejárat újra ellenőrzött.
- Induló tervezési korlát: legfeljebb 2 GiB fájl a felületen és az
  inicializáló kérésben; a feltöltési ablak legfeljebb hat óra.
  A bejelentett méret ellenőrzése nem szolgáltatói tárhely- vagy
  költségkvóta. A végleges szolgáltatói korlát külön üzemeltetési döntés.
- A közvetlen feltöltésre már kiadott jogosultság kijelentkezéskor nem
  feltétlenül vonható vissza azonnal. Rövid, rögzített érvényesség és
  minden újraaláírásnál friss szerveroldali ellenőrzés szükséges.
- Nincs webhook vagy új adatbázisséma ebben a körben. A feldolgozást
  korlátos státuszlekérés követi, majd kézi frissítés használható.
- Séma nélküli megoldásnál nincs tartós exactly-once videólétrehozás
  vagy automatikus árvaeltakarítás. Bizonytalan kimenetel után a lista
  ellenőrzése előzze meg az újrakezdést.
- Az admin közvetlen feltöltése csak a pontos Bunny TUS-originhez
  igényel CSP connect-src jogosultságot. A többi frontend policy nem
  nyílhat meg indokolatlanul.

## Kutatási alap

- [Bunny TUS](https://bunny.net/docs/stream/tus-resumable-uploads):
  közvetlen, szerveroldalon aláírt, folytatható feltöltés, titkos API-kulcs
  nélkül a böngészőben.
- [tus-js-client API](https://github.com/tus/tus-js-client/blob/main/docs/api.md):
  folytatás, megszakítás, hibakezelés; saját általános TUS-motor helyett
  karbantartott kliens.
- [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/):
  gyakori szerkesztési feladatok előtérben, ritka technikai adatok külön.
- [GOV.UK check answers](https://design-system.service.gov.uk/patterns/check-answers/):
  mentett adatok ellenőrzése, közvetlen visszalépés a javításhoz.
- [W3C modal dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/):
  fókuszkezelés, billentyűzetes működés, címezhető párbeszédablak.
- [WCAG 2.5.7](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html):
  a húzás mellett egyszerű mutatóeszközös alternatíva is szükséges.
- Helyi, verzióhoz tartozó Payload useField típusok és Next draftMode
  dokumentáció; `docs/ui-sztenderdek.md`, `docs/ertekesitesi-ux-skill.md`.

## Ellenőrzési terv és kiadási határ

A tiszta függvények és a route-ok tesztjei injektált, hálózatmentes
szolgáltatói mockokat használnak. A böngészős komponensharness a valós
interakciót méri. A külön helyi PostgreSQL/Payload adminpróba a mezőútvonal,
átrendezés és mentés-visszaolvasás viselkedését ellenőrzi fiktív adatokon,
mockolt Bunny-hívásokkal; ez nem éles szolgáltatói E2E.

Kötelező kapuk: célzott regressziók, teljes tesztkör, typecheck, lint,
build, generált admin importMap, függőség- és titokellenőrzés, UX-mérés,
két független review. Az esetleges hiányzó vagy kihagyott kapu nem PASS.
Éles API-kulcsok megléte/írási joga, valós nagyfájl-feltöltés és a lányok
feladatalapú használhatósági próbája külön, még nem teljesített kapu.

## Tanulság

A tananyagban tárolt videóazonosító mezőjének lecserélése nem új
tananyagrendszer: a meglévő adattárolást és vásárlói útvonalat megőrizzük.
A kritikus adminregresszió nem csak a látvány, hanem a későn beérkező
válasz és az átrendezett sor találkozása; ezt külön teszt védi.

A kliensnek a szerver tényleges hibaszerződését kell követnie: a lejárt
feltöltési munkamenet 403-as válasza nem általános, újrapróbálható hálózati
hiba. Az eredeti lejárat elérése után egyértelmű újrakezdési állapot kell.
A csak olvasható videómetaadat mellett a feldolgozás alatt álló felvétel
hozzárendelése tartósan elavult leckestátuszt okozhatna; a kiválasztás
pillanatában újra ellenőrzött, kész felvétel használható.

## Engedélyezett helyi utójavítás

- A `sharp` 0.35.4 és `js-yaml` 4.3.2 javított verzióra került.
  A `@esbuild-kit/core-utils` kizárólagos esbuild-felülírása 0.25.12;
  a már nem települő 0.18.20 lifecycle-engedélye és azonosságbejegyzése
  kikerült. A lock- és ellenőrzőösszeg-lánc együtt frissült, a negatív
  telepítési tesztek megmaradtak. A valódi sync/async TypeScript,
  CJS/ESM, sourcemap és Drizzle-sémabetöltést regressziós teszt védi.
- A friss audit eredménye: 0 high, 0 critical, 1 moderate. A megmaradó
  Payload account-unlock jelzéshez az audit nem kínál javított verziót.
  A Payload 3.88.0 és a kapcsolódó csomagok verziója változatlan.
  A meglévő `unlock: isOwner` védelem a tényleges Payload
  `unlockOperation` művelettel, mockolt adatbázison tesztelt: ezen a
  feloldási útvonalon vendég, customer és staff nem olvashatja vagy
  módosíthatja a célfiókot; owner feloldhatja. Ez nem HTTP E2E-próba.
  Ez alkalmazásszintű védelem, nem
  csomagszintű javítás vagy kockázatelfogadás; az auditjelzés nyitva marad.
- A pénzügyi teszt a nyers PostgreSQL `numeric` értéket most `"2"`
  alakban várja, és külön ellenőrzi a domain `schemaVersion: 2` értékét.
  Mind a nyolc kapcsolódó PostgreSQL-teszt sikeres. Pénzügyi működés és
  adatbázisséma nem változott.
- A Vite 8.2.1 opcionális esbuild peer-elvárása és a gyökérben feloldott
  0.25.12 közötti eltérés már a javítás előtt is fennállt. Az `npm ls`
  ezért továbbra is ELSPROBLEMS eredményt ad; ezt nem rejtjük el.

A tanulság: a nyers SQL-reprezentáció és a domainérték külön szerződés.
Egy tranzitív major-felülírást pedig nem igazol önmagában a sikeres
telepítés: a tényleges fogyasztó betöltési és átalakítási útját is tesztelni
kell. A teljes repót bejáró lintet a rövid életű tesztkönyvtárak törlése
miatt a tesztfuttatás után, nem vele egyidejűleg futtatjuk.

GitHub, push, merge és élesítés nem része ennek az utójavításnak.
A korábban felsorolt valós szolgáltatói és használhatósági kapuk változatlanul
külön ellenőrzést igényelnek.
