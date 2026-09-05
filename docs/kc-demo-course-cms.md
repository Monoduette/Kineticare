# Demo kurzusoldal: helyi CMS-életciklus

## Hatókör

A `Képzeletbeli akciós kurzus` egy kizárólag helyi bemutatóoldal. Stabil címe
`/akcios-kurzus`, a CMS-menü felirata `Akciós kurzus`. Nem termék, nincs ára,
nem vásárolható meg, és nem módosít kurzus-, hozzáférési vagy fizetési adatot.

A scratch fixture csak a `localhost:55441/kineticare_preview` adatbázist
fogadja el. Production és Railway környezetben leáll. Nem olvas `.env` fájlt,
folyamatonként véletlen szintetikus Payload-kulcsot és helyi szervercímet állít
be, letiltja az `onInit` futását, a cront, az automatikus jobokat, a telemetriát
és a generálást.

## Szerkeszthető CMS-mezők

- `title`: az oldal és a H1 címe.
- `excerpt`: a nyitó összefoglaló.
- `heroImage`: opcionális CMS-média. Üresen a felület a repóban lévő, saját
  statikus képet használja; a fixture nem tölt fel és nem keres médiát.
- `layout`: a bemutató modulok, mintalecke, GYIK és záró szakasz meglévő Pages
  blokkokkal, a szerkesztő által meghatározott sorrendben. Az induló érték a
  `src/lib/demo-course-content.ts`
  `DEFAULT_DEMO_COURSE_LAYOUT` exportja.
- `seoTitle`, `seoDescription`, `seoKeywords` és `ogImage`: a meglévő Pages
  SEO-mezők. A fixture csak címet és leírást ad; kulcsszót vagy OG-képet nem
  talál ki.

A kötelező `content` mező egy rövid demo-jelölést kap. Az oldal kizárólag a
helyi preview adatbázisban, közzétettként jön létre, hogy a published-only
route és a menüfa valóban a CMS-rekordot használja. Ez nem production
publikálás. A későbbi szerkesztői piszkozat a támogatott hitelesített draft
előnézettel külön ellenőrizhető.

## Jelenlegi megjelenítési szerződés

A route a CMS-oldalt `Page | null` alakban adja át a demo landingnek. A `title`,
az `excerpt` és a feltöltött `heroImage` közvetlenül a Pages szerkeszthető
mezőiből jön; hiányzó értéknél a repóban definiált demo-alapérték jelenik meg.
Nincs külön, hardcoded preview-változat.

A landing öt meglévő Pages blokktípust fogad el: `welcome`, `howItWorks`,
`accordion`, `faq` és `ctaBanner`. A támogatott blokkok a CMS-ben megadott
sorrendben maradnak. A mintalecke közönséges `accordion` blokk ugyanebben a
sorrendben, nem külön előnézeti komponens. A `faq` tartalom megjelenítés előtt
egyszer az ugyancsak meglévő Accordion-modellre alakul, ezért a noindex demo
nem állít elő `FAQPage` strukturált adatot.

Ha a szerkesztő szándékosan üresen hagyja a `layout` mezőt, az oldal üres
layouttal jelenik meg; a rendszer nem tölti vissza automatikusan a demo
alapblokkokat. Ha viszont nem támogatott blokktípus kerül a CMS-layoutba, a
renderer nem részlegesen szűri a szerkesztő tartalmát: az egész layout helyett
a teljes biztonságos demo-alapértéket használja, és figyelmeztetést naplóz.

## Noindex

Az `/akcios-kurzus` tartósan `noindex`, akkor is, ha később a CMS-ben
közzéteszik. A route szintű noindex- és sitemap-kizárás az irányadó; a CMS SEO
mezőinek átírása nem oldja fel. Ennek megváltoztatása külön launch-döntés és
külön kódmódosítás, nem tartalomszerkesztés.

## Biztonságos előkészítés

A fixture alapértelmezett módja `--dry-run`. A szülői review előtt sem az
`--apply`, sem a törlési módok nem futtathatók. Jóváhagyás után is először a
dry-run kimenetét kell ellenőrizni, pontosan a helyi URI-val és tiszta
környezettel.

```sh
env -i \
  PATH=/opt/homebrew/Cellar/node@24/24.20.0/bin:/usr/bin:/bin \
  NODE_ENV=development \
  DATABASE_URI='postgresql://kineticare_ci@localhost:55441/kineticare_preview' \
  /opt/homebrew/Cellar/node@24/24.20.0/bin/node \
  /tmp/kineticare-kc-v1-owner-review/node_modules/tsx/dist/cli.mjs \
  /tmp/kineticare-demo-course-preview.ts --dry-run
```

Az `--apply` csak hiányzó rekordot hoz létre. A meglévő, egyedi slugú,
közzétett oldalt és a már helyesen odamutató menüpontot érintetlenül hagyja.
Piszkozatként létező azonos slug, többszörös slug, többszörös menüfelirat,
árva azonos felirat vagy más célra mutató azonos felirat esetén még az első
írás előtt leáll. Minden létrehozás után friss, published-only
adatbázis-visszaolvasást is végez.

Jóváhagyott helyi ellenőrzéskor az `--apply` kétszer fut: az első kör
létrehozza a hiányzó rekordokat, a másodiknak mindkettőt változtatás nélkül
kell visszaolvasnia. Nincs automatikus destruktív exercise mód.

## Menü és közvetlen link

A helyi preview adatbázisban a menüpont láthatóként jött létre. A szerkesztő
kézi elrejtése a CMS `Látható` jelölőjének kikapcsolását jelenti: csak a
menüpontot veszi ki a navigációból, az oldalt nem törli és nem módosítja. A
`/akcios-kurzus` közvetlen címe és a hitelesített draft előnézet ettől
megmarad.

Az `--remove-menu` kizárólag a fixture által létrehozott, azóta változatlan
menüpontot törli, az oldalt megtartja. Az `--remove` előbb ezt a menüpontot,
majd kizárólag a fixture által létrehozott és azóta változatlan oldalt törli.
A fixture a tulajdonjogot és a létrehozáskori hasht a
`/tmp/kineticare-demo-course-preview-state.json` fájlban rögzíti. Hiányzó
state, idegen rekord vagy szerkesztői módosítás esetén a törlést megtagadja.

Az automatikus eltávolítás után is friss visszaolvasás igazolja, hogy csak a
célrekord tűnt el. Szerkesztett rekordot az admin felületen, emberi döntéssel
kell elrejteni vagy törölni.

## Helyi provisioning bizonyíték

2026. szeptember 5-én a jóváhagyott fixture kétszer futott `--apply` módban,
      kizárólag a `localhost:55441/kineticare_preview` célon. Az első futás létrehozta
      a közzétett Page `5` és a látható Menu `6` rekordot. A létrehozás utáni friss
      visszaolvasás fingerprintjei:

- Page `5`: `6615e40f985f9fc2def625a3c2ef9317a3d2b7a90d805ee0550b9f1c385c0e17`
- Menu `6`: `6ec1a4179c06c197c115bb12e99915384b83b287552e971562e36bf0e021413d`

A második futás ugyanazokat az azonosítókat olvasta vissza,
`pageCreated: false`, `menuCreated: false`, `pagePreserved: true` és
`menuPreserved: true` eredménnyel. Mindkét futás `freshReadback: true` és
`status: published` eredményt adott. Ez kizárólag helyi CMS-állapot; nem
production publikálás és nem launch-engedély.
