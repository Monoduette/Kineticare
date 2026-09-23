/**
 * Kitüntetett tartalom-slugok.
 *
 * Külön (függőségmentes) modulban élnek, mert a Payload-config oldala
 * (collections → admin.preview) és a storefront oldala (src/lib/cms.ts) is
 * hivatkozik rájuk — közös leaf-modul nélkül körkörös import keletkezne
 * (payload.config → collections → cms.ts → payload.config).
 */

/** A kezdőlapként szolgáló CMS-oldal slugja: a `/` útvonalon él, nem `/kezdolap`-on. */
export const HOME_PAGE_SLUG = 'kezdolap'

/**
 * A /szakembereknek lap CMS-oldalának slugja (A7, H11): a dedikált route ezt
 * a rekordot tölti, ezért a webcím kódhoz kötött (src/lib/admin/kotott-cimek.ts).
 */
export const SZAKEMBEREKNEK_PAGE_SLUG = 'szakembereknek'
