# Auditjavítások és kiadási feltételek — 2026. szeptember 8.

A változás a fizetési, hozzáférési, e-mail- és mentési audit forráskóddal
javítható megállapításait kezeli. A történeti adatok egyeztetése és az éles
üzemeltetési beállítások külön feladatok. Ez a dokumentum nem engedélyez
éles adatváltoztatást, pénzmozgást vagy kiadást.

## Megőrzendő viselkedés

- A fizetés és a feltételes státuszírás ugyanazt a rendelészárat használja.
  A friss státusz olvasása és írása együtt történik; a Payload hookjai futnak.
- Az automatikus visszatérítésnek tartós indítási bejegyzése és a konkrét
  kéréshez kötött szolgáltatói bizonyítéka van. Elveszett vagy bizonytalan
  válasz után nem indul új pénzvisszatérítés. A bizonyított siker helyi
  rögzítése külön folytatható. Függő visszatérítés mellett egy újabb fizetési
  értesítés nem adhat új jogosultságot.
- A szolgáltatói válaszban az eredeti fizetés és az új refund azonosítója
  külön adat. A fizetés, a kereskedői tranzakcióazonosító, a teljes összeg és
  a sikeres státusz egyezése kötelező. A korábbi V1 bejegyzések hash-e nem
  változik; bizonytalan történeti bizonyítékból nem készül automatikus siker.
- A poll egy rendelés végleges hibája után továbbhalad, és forgatja a sort.
  A hitelesítési és sorozatos szállítási hibák továbbra is megszakítják a
  futást. A tartósan függő refund forgatása nem ismétli meg a pénzműveletet.
- Az új hozzáférési sorok megkülönböztetik a konkrét rendelésből és a külön
  ajándékozásból származó jogosultságot. A refund csak a saját forrását
  érvénytelenítheti; másik érvényes vásárlás és külön ajándék megmarad.
- A közös hozzáférés-ellenőrzés a lejáratot a REST-mezőknél és a védett
  fájloknál is alkalmazza. A hozzáféréshez szükséges legutolsó paid vásárlási
  időpontot kurzusonként keressük; sok újabb rendelés nem rejthet el egy másik
  kurzus régi vásárlását.
  Bizonytalan lekérdezést a felület nem nevez visszavonásnak vagy lejáratnak.
  A lista megtarthatja a kurzus linkjét, a tényleges tartalomkapu viszont tilt.
- A jelszó-visszaállítás alternatív útvonalai és a metódusfelülírás nem
  kerülhetik meg a jelszópolitikát vagy az IP-keretet. A szükséges admin
  műveleteket külön regressziók védik.
- Az SMTP-küldés korlátozza a MIME-test és a kódolt fejléc fizikai sorait,
  a szöveg veszteségmentes marad. A szolgáltatói naplókba nem kerül szabad
  tárgyszöveg, és a visszatükrözött szolgáltatói hiba sem kerül be nyersen.
- Mentés csak a tartalomjegyzék ellenőrzése és a teljes archívum dekódolása
  után lehet sikeres. A CLI kizárólagosan lefoglalt, 0600 módú részleges
  fájlba dolgozik, majd felülírás nélkül publikál. Hibánál csak a saját
  részleges fájlt törli; korábbi vagy másik futáshoz tartozó mentést nem.

## Védett fájlok bevezetése

Az új `course-files` gyűjtemény külön névteret használ a meglévő médiakötet
alatt. Egy fájl egy kurzushoz tartozik, és a vásárló csak az adott kurzus
közzétett tananyagában hivatkozott fájlt kaphatja meg. A fájl cseréje és a
másik kurzushoz áthelyezése tiltott; új tartalomhoz új rekord szükséges.

Az eredeti és átméretezett privát képek ugyanazt az ellenőrzést kapják.
Privát válasz nem lehet megosztott gyorsítótárban, a Next képfeldolgozója
csak a felsorolt nyilvános névtereket fogadja. A privát képet a renderer
közvetlenül kéri. A nyilvános marketingképek útvonala megmarad.

A közös `media` fájlkiszolgáló kizárólag fájlnevet fogad el: alkönyvtáron
vagy kódolt útvonalon keresztül sem érhető el a privát tároló. Privát
hivatkozás sikertelen feloldása után nincs visszaesés a régi publikus URL-re.
A fájllal rendelkező kurzus törlése a kapcsolódó adatok takarítása előtt
megáll, és archiválást vagy a fájlok megőrzésének rendezését kéri.

**A meglévő publikus tananyagfájlokat a kód nem helyezi át és nem törli.**
A bevezetéshez külön, tulajdonos által jóváhagyott leltár kell: mely rekord
és bináris fizetős tananyag, melyiket használja marketingoldal is, és mely
URL került már CDN-, böngésző- vagy képgyorsítótárba. A jóváhagyott másolás,
hivatkozásátvezetés és eredeti példányok rendezése előtt ez a történeti
hozzáférési kockázat nyitott marad. Közös marketingképet tilos pusztán a
kurzus-hivatkozás alapján megszüntetni.

## Séma és történeti kompatibilitás

A `20260908_092438_audit_refund_provenance_private_course_files` migrációt
a rögzített Payload-generátor készítette. Új fájltáblát, kapcsolati mezőket,
hozzáférési eredetmezőket és refundszereplő-mezőket ad hozzá; az automatikus
szereplőhöz az emberi szereplő kapcsolata lehet üres. Az előre irányú
migráció nem töröl táblát, oszlopot vagy meglévő üzleti adatot. A korábbi
migrációk és checksumjaik változatlanok.

A korábbi, eredetmegjelölés nélküli hozzáférések megmaradnak. Dátumegyezés
alapján nem minősítjük át őket ajándékká vagy egy adott rendelésből származó
jogosultsággá. A backfill csak a hiányzó dátumhoz köt új, a tényleges paid
rendelésből igazolt forrást, és az írás előtt újra ellenőrzi azt. Ilyen
scriptet ez a változás nem futtat éles adatokon.

Függő V1 refund-hozzáférési bizonyíték történeti egyeztetést igényel; már
lezárt V1 nyugta továbbra is lezártnak olvasható. Ez szándékos korlát,
nem jogosít fel tömeges törlésre vagy automatikus újrapróbálásra.

## Kötelező kiadási kapuk

1. A végleges diffre illeszkedő célzott és teljes tesztek, typecheck, lint,
   build és biztonsági ellenőrzések. A kihagyott teszt nem siker.
2. A CI elkülönített PostgreSQL 18 adatbázisán a teljes migrációs lánc,
   a valódi párhuzamossági/refundtároló-tesztek, valamint egy jó mentés
   visszaállítása és egy ép tartalomjegyzékű, csonka archívum elutasítása.
3. Két független felülvizsgálat a magas kockázatú részekre. A hozzáférési
   szabályoknál a repó előírása szerint merge előtt emberi review is kell.
4. A meglévő publikus fájlok és a történeti jogosultságok átállási döntése,
   az éles kötet és gyorsítótár viselkedésének külön ellenőrzése.
5. A főág védelme és a Railway „Wait for CI” beállításának tulajdonosi
   rendezése. Ezek beállítását a forrásjavítás nem végzi el.

A korábban feltöltött titkosítatlan GitHub-mentések megszüntetése szintén
külön üzemeltetési döntés. Törlés előtt igazolt titkosított helyreállítás,
a szükséges történeti visszaállítási pontok megőrzésének eldöntése és az
aktuális pontos artifactlista jóváhagyása szükséges. A törlés nem visszavonható.

Az alkalmazás automatikusan migrál induláskor. Ezért az új séma merge-je
és éles bevezetése csak a fenti kapuk után történhet. A generált `down`
ág adatot törölhet, futtatása tiltott. Az új eredet- és rendszerszereplő-adatok
megjelenése után a régi, kurzusonként egy sort feltételező író visszaállítása
sem biztonságos. Hiba esetén a kiadást meg kell állítani, a még nem érintett
éles állapotot megőrizni, és ember által ellenőrzött előre javítást vagy az
új adatokkal kompatibilis verziót használó helyreállítási tervet készíteni.
