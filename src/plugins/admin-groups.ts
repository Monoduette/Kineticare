import type { CollectionConfig, Plugin } from 'payload'

/**
 * Admin-oldalsáv: csoport-sorrend, csoporton belüli sorrend és megjelenített
 * csoportnév.
 *
 * SORREND. A Payload az oldalsáv csoportjait és a csoporton belüli
 * menüpontokat abban a sorrendben rajzolja ki, ahogyan a collectionök a
 * `config.collections` tömbben állnak (@payloadcms/ui → groupNavItems; az
 * Irányítópult kártyái ugyanezt a csoportosítást használják: getNavGroups).
 * A plugin-collectionök (webshop, űrlapok) a saját collectionjeink UTÁN
 * kerülnek a tömbbe, ezért a csoport-hozzárendelés önmagában nem elég: a
 * „Rendszer” csoport (naplók, webhook-események) a webshop elé csúszna, holott
 * a szerkesztőnek ez a legritkábban kellő, legveszélyesebb blokk, a lista
 * aljára való. Ez a plugin ezért a plugin-lánc VÉGÉN futva, amikor már minden
 * collection a helyén van, stabilan újrarendezi a tömböt: előbb a csoportok
 * sorrendje (ADMIN_GROUP_ORDER), azon belül a feladat-gyakoriság
 * (ADMIN_GROUP_ITEM_ORDER) szerint.
 *
 * MEGJELENÍTETT NÉV. Két csoport neve azonos volt a benne álló menüponttal
 * („Űrlapok › Űrlapok”, „Felhasználók › Felhasználók”). Az ilyen címke nem
 * mondja meg, mi van a csoportban, és azt sugallja, hogy a fejléc és a
 * menüpont ugyanaz a hely. A plugin ezért a MEGJELENÍTETT nevet cseréli
 * (ADMIN_GROUP_DISPLAY_NAMES); a collectionök `admin.group` forrás-stringje a
 * forrásfájlokban változatlan marad, és a rangsor a forrásnévre épül.
 * Források:
 *  - NN/g, 5 Tips for Avoiding Confusing Category Names („Check for
 *    Overlapping Categories”: minden kategóriának saját arculata legyen):
 *    https://www.nngroup.com/articles/category-names-suck/
 *  - NN/g, Menu-Design Checklist, 7. irányelv (világos, konkrét, ismerős
 *    címkék): https://www.nngroup.com/articles/menu-design/
 *  - WCAG 2.2 SC 2.4.6 Headings and Labels (a címke a témát vagy a célt írja
 *    le): https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels.html
 *
 * CSAK MEGJELENÍTÉS. A collectionök mezőihez, hookjaihoz, access-szabályaihoz
 * és slugjához a plugin nem nyúl; ahol a nevet cseréli, ott is csak az `admin`
 * objektum új példány. Ezt a src/__tests__/admin-groups.test.ts a valódi
 * configon bizonyítja.
 *
 * ISMERT MELLÉKHATÁS. A Payload a csoport nevét kulcsként használja a
 * nyitva/csukva állapot felhasználói beállításában és a csoport DOM-id-jében
 * (ui/dist/elements/NavGroup/index.js:30-66). Az átnevezett csoport ezért az
 * első betöltéskor nyitva jelenik meg, és a több szavas név szóközt visz a
 * DOM-id-be; egyik sem érint hozzáférhetőségi vagy mentett adatot.
 */
export const ADMIN_GROUP_ORDER: readonly string[] = [
  'Tartalom',
  'Navigáció',
  'Webshop',
  'Űrlapok',
  'Felhasználók',
  'Rendszer',
]

/**
 * Forrásnév → az oldalsávban és az Irányítópulton látható csoportnév.
 * A név a csoport TARTALMÁT írja le, és egyik sem azonos a benne álló
 * menüpont nevével:
 *  - „Űrlapok és beküldések”: a csoportban az űrlapok beállítása és a
 *    látogatók beküldött üzenetei állnak; a szerkesztő leggyakrabban az
 *    utóbbit keresi, ezért a név kimondja.
 *  - „Fiókok”: a Felhasználók lista a munkatársak és a vásárlók fiókjait is
 *    tartalmazza; a Payload a saját fiókoldalt is „Fiók” néven hívja.
 */
export const ADMIN_GROUP_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  Űrlapok: 'Űrlapok és beküldések',
  Felhasználók: 'Fiókok',
}

/**
 * Csoporton belüli sorrend (collection-slugok, forrás-csoportnév szerint).
 * A fel nem sorolt collection a felsoroltak UTÁN áll, egymás közti
 * sorrendjük a config-sorrend.
 *
 * Tartalom: a gyakoribb feladat kerül feljebb, hogy a szerkesztőnek ne kelljen
 * a teljes listát végigolvasnia (NN/g, Top 3 IA Questions about Navigation
 * Menus: „Prioritizing the most frequently accessed items”,
 * https://www.nngroup.com/articles/ia-questions-navigation-menus/; NN/g,
 * Left-Side Vertical Navigation on Desktop: a kevésbé fontos elem kerül alulra,
 * https://www.nngroup.com/articles/vertical-nav/). A gyakoriság bizonyítékai:
 *  1. Oldalak: az admin-audit kognitív sétájának 9 feladatából 7 az Oldalakon
 *     át vezetett (scratchpad admin-audit/seta t1–t4, t6–t8), köztük a
 *     tulajdonos fő kérése, a kezdőlap szövegeinek szerkesztése.
 *  2. Blogbejegyzések: a Tudástár cikkei; a szerkesztői útmutató első
 *     lépésenkénti leírása (docs/szerkesztoi-utmutato.md 4. fejezet).
 *  3. Képek: a képcsere és a képleírás (séta t6, útmutató 10. fejezet); a
 *     képet többnyire az oldal szerkesztőjéből cserélik, ezért nem előrébb.
 *  4. Vélemények: új vélemény felvétele (útmutató 9. fejezet).
 *  5. Kategóriák: ritka, a blogbejegyzések besorolásához (útmutató 5. fejezet).
 *  6. Védett kurzusfájlok: technikai, ritka feladat.
 */
export const ADMIN_GROUP_ITEM_ORDER: Readonly<Record<string, readonly string[]>> = {
  Tartalom: ['pages', 'posts', 'media', 'testimonials', 'categories', 'course-files'],
}

/**
 * A megjelenített névből visszakeresi a forrásnevet, így a rangsor a plugin
 * második futásán (a már átnevezett configon) is ugyanaz marad.
 */
const forrasCsoportnev = (group: string): string => {
  const talalat = Object.entries(ADMIN_GROUP_DISPLAY_NAMES).find(
    ([, megjelenitett]) => megjelenitett === group,
  )
  return talalat ? talalat[0] : group
}

/**
 * Egy collection helye a csoport-sorrendben. Az ismeretlen (vagy csoport
 * nélküli) collection a felsoroltak ELÉ kerül, hogy egy jövőbeli,
 * csoportozatlan collection se szoruljon a „Rendszer” mögé.
 */
export const adminGroupRank = (collection: Pick<CollectionConfig, 'admin'>): number => {
  const group = collection.admin?.group
  if (typeof group !== 'string') {
    return -1
  }
  return ADMIN_GROUP_ORDER.indexOf(forrasCsoportnev(group))
}

/** Egy collection helye a saját csoportján belül (ADMIN_GROUP_ITEM_ORDER). */
export const adminGroupItemRank = (
  collection: Pick<CollectionConfig, 'admin' | 'slug'>,
): number => {
  const group = collection.admin?.group
  if (typeof group !== 'string') {
    return 0
  }
  const sorrend = ADMIN_GROUP_ITEM_ORDER[forrasCsoportnev(group)]
  if (!sorrend) {
    return 0
  }
  const index = sorrend.indexOf(collection.slug)
  return index === -1 ? sorrend.length : index
}

/**
 * A megjelenített csoportnévvel tér vissza. Minden más változatlan: a mezők,
 * a hookok és az access ugyanaz a példány marad.
 */
const megjelenitettNevvel = (collection: CollectionConfig): CollectionConfig => {
  const group = collection.admin?.group
  if (typeof group !== 'string') {
    return collection
  }
  const megjelenitett = ADMIN_GROUP_DISPLAY_NAMES[group]
  if (megjelenitett === undefined) {
    return collection
  }
  return { ...collection, admin: { ...collection.admin, group: megjelenitett } }
}

export const adminGroups: Plugin = (config) => ({
  ...config,
  collections: [...(config.collections ?? [])]
    .sort(
      (a, b) =>
        adminGroupRank(a) - adminGroupRank(b) || adminGroupItemRank(a) - adminGroupItemRank(b),
    )
    .map(megjelenitettNevvel),
})

export default adminGroups
