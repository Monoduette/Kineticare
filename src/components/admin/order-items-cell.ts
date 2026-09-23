import { formatPriceHuf } from '../../lib/format-price'

/**
 * A Rendelések admin-lista „Tételek” oszlopának TISZTA (mellékhatásmentes)
 * formázó segédfüggvénye.
 * Külön modulban él a kliens-komponenstől, hogy egységtesztelhető legyen
 * (az OrderItemsCell.tsx React-komponens; a @payloadcms/ui-s cellák
 * node-környezetű tesztben nem tölthetők be — a refund-amount.ts mintája).
 * A bemenet a cella `cellData`-ja: az orders `items` array-mezőjének sorai.
 */

/*
 * A korábbi „—” (U+2014) helyőrző és elválasztó helyett kimondott szöveg és
 * középpont áll. A kvirtmínusz magyar szövegben nem írásjel
 * (docs/ui-sztenderdek.md §3.1.1), a puszta jel pedig a képernyőolvasóban néma
 * vagy „em dash”, tehát az információ elvész (WCAG 2.2 SC 1.3.1). Ugyanez a
 * minta áll a Felhasználók lista „Megvásárolt kurzusok” cellájában
 * (purchases-cell.ts: PURCHASES_EMPTY_PLACEHOLDER, PROGRESS_SEPARATOR).
 */

/** Üres vagy hiányzó tétellista. */
export const ORDER_ITEMS_EMPTY_PLACEHOLDER = 'Nincs tétel'

/** Nem értelmezhető (nem objektum) tételsor. */
export const ORDER_ITEM_INVALID_ROW = 'Olvashatatlan tétel'

/** Sem megrendeléskori név, sem kurzus-azonosító nincs a soron. */
export const ORDER_ITEM_UNKNOWN_TITLE = 'Ismeretlen kurzus'

/** Hiányzó vagy hibás ár-snapshot (mondatközi alak, a sor végén áll). */
export const ORDER_ITEM_UNKNOWN_PRICE = 'ár nem ismert'

/** A tétel és az ára közti elválasztó: középpont, szóközök között. */
export const ORDER_ITEM_SEPARATOR = '·'

/** Egy tétel-sor szűkített, megjeleníthető alakja. */
interface OrderItemLine {
  title: string
  quantity: number
  /** null = az ár nem állapítható meg (hiányzó/hibás snapshot). */
  linePriceHuf: number | null
}

/**
 * A sor címkéje: a megrendeléskori snapshot (a termék sku-ja), hiányában a
 * termék-azonosító `#<id>` alakban. A snapshot SZÁNDÉKOSAN az elsődleges:
 * a termék későbbi átnevezése/törlése sem írja felül a rendelés képét.
 */
function readTitle(record: Record<string, unknown>): string {
  const snapshot = record.titleSnapshot
  if (typeof snapshot === 'string' && snapshot.trim().length > 0) {
    return snapshot.trim()
  }
  const product = record.product
  if (typeof product === 'number' && Number.isFinite(product)) {
    return `#${product}`
  }
  if (typeof product === 'string' && product.length > 0) {
    return `#${product}`
  }
  // Védekező ág: feloldott (objektumos) relationship — a listában nem fordul
  // elő, de ha mégis, az azonosítót emeljük ki.
  if (typeof product === 'object' && product !== null) {
    const id = (product as Record<string, unknown>).id
    if (typeof id === 'number' || (typeof id === 'string' && id.length > 0)) {
      return `#${id}`
    }
  }
  return ORDER_ITEM_UNKNOWN_TITLE
}

/** A mennyiség: pozitív, véges szám; hibás/hiányzó értékre 1 (a mező defaultja). */
function readQuantity(record: Record<string, unknown>): number {
  const quantity = record.quantity
  return typeof quantity === 'number' && Number.isFinite(quantity) && quantity > 0 ? quantity : 1
}

/** A tételár: priceHufSnapshot × quantity; hiányzó/hibás snapshotnál (vagy túlcsordulásnál) null. */
function readLinePriceHuf(record: Record<string, unknown>, quantity: number): number | null {
  const price = record.priceHufSnapshot
  if (typeof price !== 'number' || !Number.isFinite(price)) {
    return null
  }
  const lineTotal = price * quantity
  // A szorzat túlcsordulhat (valós adatból elérhetetlen, de a lista sosem omolhat el):
  return Number.isFinite(lineTotal) ? lineTotal : null
}

/** Egy tétel-sor szűkítése; nem-objektum sor esetén null (a hívó fallbacket ad ki). */
function readOrderItemLine(row: unknown): OrderItemLine | null {
  if (typeof row !== 'object' || row === null) {
    return null
  }
  const record = row as Record<string, unknown>
  const quantity = readQuantity(record)
  return {
    title: readTitle(record),
    quantity,
    linePriceHuf: readLinePriceHuf(record, quantity),
  }
}

/**
 * A cella megjelenítendő sorai („kurzus × db · tételár”).
 *
 * - nem tömb / üres tömb → egyetlen „Nincs tétel” sor,
 * - hibás (nem objektum) sor → „Olvashatatlan tétel” (némán, kivétel nélkül),
 * - hiányzó ár-snapshot → az ár helyén „ár nem ismert”, a tétel többi része látszik.
 */
export function formatOrderItemsLines(cellData: unknown): string[] {
  if (!Array.isArray(cellData) || cellData.length === 0) {
    return [ORDER_ITEMS_EMPTY_PLACEHOLDER]
  }
  return cellData.map((row) => {
    const line = readOrderItemLine(row)
    if (!line) {
      return ORDER_ITEM_INVALID_ROW
    }
    const price =
      line.linePriceHuf === null ? ORDER_ITEM_UNKNOWN_PRICE : formatPriceHuf(line.linePriceHuf)
    return `${line.title} × ${line.quantity} ${ORDER_ITEM_SEPARATOR} ${price}`
  })
}
