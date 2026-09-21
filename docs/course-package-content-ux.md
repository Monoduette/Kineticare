# Akciós kurzus: szerkeszthető, ikonos csomagtartalom

A jóváhagyott tartalmi sorrend: ikonos csomag → Kinek való / Kinek nem → Hogyan működik. A további meglévő leírás, bónuszok, kép, tananyag, garancia és GYIK nem vész el. A már kiadott hero, árképzés, CTA-állapotok, hozzáférés és listázási kapcsoló változatlan.

## CMS-szerkesztés

A kurzus **Részletes leírás** mezőjében új **Kurzuscsomag** blokk választható. Ebben a szakasz címe és az elemek ikonja, kiemelt megnevezése, leírása külön szerkeszthető. Az ikon előre rögzített választó, nem SVG/HTML vagy tetszőleges URL. A meglévő szerkesztői funkciók és állandó eszköztár megmaradnak.

Az első teljes, gyökérszintű Kurzuscsomag blokk aktiválja az új elrendezést az aktív, fizetős akciós oldalon. Nincs slughoz vagy címsor-regexhez kötött viselkedés. Blokk nélkül minden korábbi oldal változatlan. Az akció kikapcsolásakor és a vásárlásmentes szerkesztői előnézetben a csomag egyszerű, olvasható listaként a leírásban marad. Félkész blokk esetén is megőrizzük a biztonságosan olvasható szöveget; nem aktiválunk hiányos adatra emelt elrendezést.

A Kinek való, Kinek nem és Hogyan működik forrása a meglévő tartalomfeloldó: strukturált mező, ennek hiányában a meglévő leírás vagy folyamatadat. Ezekből sem rövidítünk, sem törlünk. A normál kurzusok és a globális fejléc/lábléc nem kapja meg az új stílusokat.

## Tárolás és ikonok

A blokk a meglévő `longDescription` JSONB richtext tartalmában tárolódik. A pinned Payload `migrate:create course_package_schema_check --skip-empty` vizsgálata nem talált sémadiffet és nem generált migrációt. A típusok és az admin importmap generálva vannak; nincs adatbázismező-, access- vagy függőségváltozás.

Hivatalos Lucide SVG-k, rögzített commitból: `951813ce76a859d4d8b145366972cbb237147a4e`. A hét fájl és a licenc a `public/assets/icons/course-package/` alatt van. Díszítő CSS-maskként jelennek meg, kizárólag fix fájllistából; a szöveg önmagában is teljes.

## Rács és mobil

A meglévő Container, Section, `kc-course-fit` és `kc-course-steps` rácsok maradnak. 1440px-en1120px külső konténer,24px belső margó,524px-os két hasáb és24px rés. A három lépés341.33px-os oszlopokat használ. Az érintett három blokk88px desktop és48px mobil szekciópaddingot kap; a betűk a meglévő Tenor Sans/Nunito Sans L/M/S tokenek.

A teljes szöveg miatt a tényleges alkalmassági szakasz hosszabb a3+3 pontos látványkivágásnál: mind a9+6 pont látható marad. Mobilon a csoportok egy hasábra rendeződnek.

## Az adott kurzus CMS-átvezetése

Csak a4-es, `otthoni-kezrehab-program-akcio` kurzus `longDescription` mezője változhat. Előtte aktuális `updatedAt` és teljes tartalmi mentés; eltérésnél újraellenőrzés szükséges. A hét jóváhagyott csomagsor a blokkba kerül változatlan szöveggel. A csomaglistában lévő három bónuszmondat a meglévő Bónusz minikurzusok cím alá kerül. Minden más richtext csomópont változatlan marad. Az előkészítés tételes szövegegyezést és a9+6 feltétel megőrzését ellenőrzi.

Mentés után a publikált rekord visszaolvasása, a teljes szöveg ellenőrzése, desktop/mobil élő nézet és normálkurzus-kontroll szükséges. Ár, státusz, jogosultság, tananyag és más termék nem változhat. A korábban külön jóváhagyott unlisted-kapcsoló művelete ettől elkülönített marad.

Visszaállítás: kizárólag a mentett `longDescription` visszatöltése, a közben keletkezett más mezőváltozások megőrzésével. Nincs visszafuttatandó SQL-migráció. A kód által támogatott blokkot tartalmazó rekord mellett a renderer régi verziójára visszaállni csak a tartalom visszaállítása után szabad, mert a régi renderer nem ismeri ezt a blokkot.

## Bizonyíték és korlát

A célzott tesztek vizsgálják az aktiválást, normál és előnézeti fallbacket, hibás sor melletti szövegmegőrzést, safe text renderelést és a meglévő betűmérettokeneket. A vizuális előnézet a tényleges CoursePage React-renderből, a publikus kurzustartalom előkészített másolatából készül, nem kézzel rajzolt HTML. Ez nem éles CMS-mentési vagy hidratált alkalmazásbizonyíték; ezek külön ellenőrzendők.

Forrás: [Payload Lexical Blocks](https://payloadcms.com/docs/rich-text/blocks), a pinned telepített API és a projekt saját design-tokenjei.
