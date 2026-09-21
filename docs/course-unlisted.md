# Közvetlen linkkel elérhető, listázásból rejtett kurzus

Az `unlisted` mező felfedezhetőségi kapcsoló. A `true` érték kizárja a kurzust a nyilvános kurzuslistából, kezdőlapi és kapcsolódó ajánlókból, strukturált cikkajánlókból, kurzusra hivatkozó menüpontokból, sitemapből és a közös terméklistát használó gépi tartalomjegyzékekből. A hiányzó, null vagy false érték a régi listázási viselkedést tartja meg. A lekérdezési szűrés a limit előtt történik.

A mező nem módosítja a publikáltságot, árat, akciót, vásárlási állapotgépet, kurzus-hozzáférést vagy a Kurzusaim lekérdezését. Egy közzétett, rejtett kurzus URL-jét bárki megnyithatja és megvásárolhatja. A termékadatok publikus olvasását nem tiltja: ez nem titkos vagy hitelesítéssel védett oldal. A szabad szövegben vagy külső URL-ként kézzel elhelyezett linkeket nem írja át.

A rejtett kurzus metadata noindex, follow jelzést ad, a megosztási kép és canonical megmarad. Ez a csak linkkel megosztott céloldalhoz illő keresőjelzés, nem azonnali keresőeltávolítás és nem hozzáférés-védelem. A robots.txt nincs módosítva, így a robot elolvashatja a jelzést. Forrás: [Google: Block Search indexing with noindex](https://developers.google.com/search/docs/crawling-indexing/block-indexing).

## Admin

Az oldalsávban a „Rejtett kurzus (csak közvetlen linkkel)” pipa állítja a mezőt. A publikáltsághoz hasonlóan a meglévő tulajdonosi írási szabályt használja. A szerkesztő tetején lévő állapotjelzés külön kimondja a rejtett, de közvetlen linkkel elérhető állapotot. Piszkozatot vagy archivált kurzust a pipa nem tesz megvásárolhatóvá.

## Migráció és visszaállítás

A `20260921_095507_products_unlisted` migráció a pinned Payload `migrate:create products_unlisted` parancsának kimenete, nem kézi SQL. A generálás `disableDBConnect: true` módban a konfigurációt a korábbi snapshothoz hasonlította. Forrás: [Payload: Migrations](https://payloadcms.com/docs/database/migrations) és a telepített Payload CLI.

Az UP két oszlopot ad hozzá: `products.unlisted` és `_products_v.version_unlisted`, mindkettő boolean DEFAULT false. Nem módosít meglévő kurzust rejtettre, nem ír árat, tartalmat vagy hozzáférést. A DOWN csak a két új oszlopot törli; a beállított rejtési értékeket elveszítené. Üzemi visszaállításhoz először a kapcsolót kell false-ra állítani; kódvisszaállításkor az additív oszlopok megtarthatók. Éles DOWN nem automatikus lépés.

A CI a teljes migrációs láncot eldobható PostgreSQL18 adatbázison futtatja. A külön regresszió a generált UP/DOWN függvényt saját kapcsolati ideiglenes táblákon próbálja, ellenőrzi a meglévő és új sorok default értékét, valamint az eredeti adatok megtartását. A public séma tábláit a regresszió nem módosítja.

## Kiadási kapu

A PR előkészítése nem jelent éles migrációt vagy beállítást. Merge előtt szükséges a pontos HEAD teljes CI-je, független review, valamint a két additív oszlop éles bevezetésének kifejezett jóváhagyása. A Railway automatikus indulása migrációt futtat, ezért a merge egyben ezt a kaput is érinti.

Jóváhagyás után kizárólag az `otthoni-kezrehab-program-akcio` kurzus kapcsolója állítható true-ra. Előtte és utána az aktuális mezőértékeket vissza kell olvasni; más kurzus, ár, tartalom és jogosultság nem változhat. Utóellenőrzés: direkt URL elérhető, lista/főoldal nem ajánlja, az ár és pénztárhivatkozás változatlan. A vásárlói Kurzusaim-megőrzést célzott regresszió igazolja; ez nem valódi fizetéses próba.

A közös terméklistát használó llms válaszok és egyéb gyorsítótárak miatt régi ajánlók a cache lejáratáig megmaradhatnak; az azonnali külső indexeltávolítás nem vállalt eredmény.
