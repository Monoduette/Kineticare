/**
 * Havi befizetés-aggregátor — tiszta, DB- és React-mentes mag.
 * Csak `paid`; hónap: invoiceCompletionDate vagy createdAt (Budapest); tétel-szintű ág-bontás.
 *
 * TÁJÉKOZTATÓ SZÁM, NEM KÖNYVELÉS (a-egyeztetes-8): bruttó (áfás) összeg, a
 * teljes visszatérítés a rendelést utólag kiveszi az eredeti hónapjából, a
 * díjakat nem ismeri. A részleges visszatérítést a visszatérítés hónapjában
 * vonja le, de CSAK ha a hívó átadja (`partialRefunds`): a `refunds` mező
 * tulajdonosi olvasású, munkatársi nézetben nem kérdezhető le. A könyvelés
 * forrása a Számlázz.hu és a Barion havi kivonata.
 */

import { hasStaffOrOwnerRole, type RoleUser } from '../../access/roles'
import { normalizeAudience, type CourseAudience } from '../course-audience'
import { budapestMonthKey, isIsoDateString } from '../date/budapest'

export interface RevenueOrderItemInput {
  audience: unknown
  priceHuf: number
  quantity: number
  /** A tétel sku-snapshotja — a kurzusonkénti bontáshoz. */
  titleSnapshot?: string | null
  /** A termék marketingcíme (displayTitle), ha populálva van. */
  displayTitle?: string | null
}

/** Egy részleges visszatérítés: csak az összeg és az időpont (azonosító nélkül). */
export interface RevenuePartialRefundInput {
  amountHuf: number
  refundedAt: string
}

export interface RevenueOrderInput {
  status: string
  createdAt: string
  invoiceCompletionDate?: string | null
  totalHuf: number | null
  items: RevenueOrderItemInput[]
  /** Részleges visszatérítések; csak tulajdonosi lekérdezésnél van kitöltve. */
  partialRefunds?: readonly RevenuePartialRefundInput[]
}

export interface MonthlyRevenueRow {
  month: string
  /** Az otthoni ág bruttó befizetése (visszatérítés levonása nélkül). */
  laikusHuf: number
  /** A szakmai ág bruttó befizetése (visszatérítés levonása nélkül). */
  szakemberHuf: number
  /**
   * A hónapban levont részleges visszatérítések összege. Az aggregátor mindig
   * kitölti; opcionális, hogy a kézzel épített (teszt-)sorok is érvényesek
   * maradjanak.
   */
  refundHuf?: number
  /** Otthoni + szakmai − részleges visszatérítés. */
  totalHuf: number
  orderCount: number
}

export interface CourseRevenueRow {
  /** Sorfejléc: displayTitle, nem sku (WCAG 3.2.4); csoportosítás továbbra is sku-snapshot. */
  title: string
  /** Rendeléskori sku-snapshot — csoportosítási kulcs és könyvelési kapocs. */
  sku: string
  audience: CourseAudience
  revenueHuf: number
  /** Hány fizetett rendelésben szerepelt ez a tétel. */
  orderCount: number
  itemCount: number
  /** Nulla forintos (ingyenes) tételsorok száma. */
  freeItemCount: number
}

export interface OrderFunnelCounts {
  created: number
  paymentPending: number
  paid: number
  paymentFailed: number
  cancelled: number
  refunded: number
  other: number
  total: number
}

export interface RevenueTotals {
  laikusHuf: number
  szakemberHuf: number
  /** A levont részleges visszatérítések összege (lásd `MonthlyRevenueRow`). */
  refundHuf?: number
  totalHuf: number
  orderCount: number
  /** Igaz, ha a részleges visszatérítések adata elérhető volt és levontuk. */
  refundsDeducted?: boolean
}

export interface RevenueReport {
  months: MonthlyRevenueRow[]
  totals: RevenueTotals
  courses: CourseRevenueRow[]
  funnel: OrderFunnelCounts
  /** Igaz, ha a fizetett rendelések lapozása elérte a plafont (a tölcsér count-tal teljes). */
  truncated: boolean
  /** Igaz, ha a részleges visszatérítéseket levontuk (tulajdonosi lekérdezés). */
  refundsDeducted?: boolean
}

const DEFAULT_MONTHS = 12

/** A Payload 3.88.0 custom admin-nézet egyetlen védelme: staff vagy owner. */
export function canAccessStatistics(user: RoleUser | null | undefined): boolean {
  return hasStaffOrOwnerRole(user)
}

/*
 * „Oldal", nem „nézet": a „nézet" a Payload fejlesztői szava (custom admin
 * view), a munkatárs viszont oldalt lát. A magyar mikroszöveg-szabályzat
 * (docs/ui-sztenderdek.md §3.1) a felhasználó szavát kéri, nem a
 * keretrendszerét.
 */
export const STATISTICS_ACCESS_DENIED_MESSAGE =
  'A Statisztikát csak munkatárs vagy tulajdonos nézheti meg.'

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function monthKeyFromInvoiceDate(value: string): string | null {
  const trimmed = value.trim()
  if (!isIsoDateString(trimmed)) {
    return null
  }
  return trimmed.slice(0, 7)
}

function monthKeyFromCreatedAt(value: string): string | null {
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) {
    return null
  }
  return budapestMonthKey(new Date(ms))
}

/**
 * Egy rendelés hónap-kulcsa: számla teljesítési dátuma, tartalék a leadás
 * Budapest szerinti naptári hónapja.
 */
export function orderMonthKey(
  order: Pick<RevenueOrderInput, 'createdAt' | 'invoiceCompletionDate'>,
): string | null {
  const invoice = order.invoiceCompletionDate
  if (typeof invoice === 'string' && invoice.trim().length > 0) {
    const fromInvoice = monthKeyFromInvoiceDate(invoice)
    if (fromInvoice !== null) {
      return fromInvoice
    }
  }
  return monthKeyFromCreatedAt(order.createdAt)
}

function listMonthKeys(now: Date, months: number): string[] {
  const current = budapestMonthKey(now)
  if (current === null || months <= 0) {
    return []
  }
  const keys: string[] = []
  const [yearPart, monthPart] = current.split('-')
  let year = Number(yearPart)
  let month = Number(monthPart)
  for (let i = 0; i < months; i += 1) {
    keys.push(`${String(year)}-${String(month).padStart(2, '0')}`)
    month -= 1
    if (month === 0) {
      month = 12
      year -= 1
    }
  }
  return keys.reverse()
}

function emptyRow(month: string): MonthlyRevenueRow {
  return { month, laikusHuf: 0, szakemberHuf: 0, refundHuf: 0, totalHuf: 0, orderCount: 0 }
}

/**
 * A részleges visszatérítések levonása a visszatérítés Budapest szerinti
 * hónapjában — akkor is, ha maga a rendelés az ablakon kívüli hónapban volt.
 * Csak `paid` rendelésé: a teljesen visszatérített (`refunded`) rendelés
 * eleve kimarad.
 */
function deductPartialRefunds(
  orders: readonly RevenueOrderInput[],
  byMonth: ReadonlyMap<string, MonthlyRevenueRow>,
): void {
  for (const order of orders) {
    if (order.status !== 'paid' || !Array.isArray(order.partialRefunds)) {
      continue
    }
    for (const refund of order.partialRefunds) {
      const amount = finiteNumber(refund.amountHuf)
      if (amount === null || amount <= 0) {
        continue
      }
      const month = monthKeyFromCreatedAt(refund.refundedAt)
      const row = month === null ? undefined : byMonth.get(month)
      if (row === undefined) {
        continue
      }
      row.refundHuf = (row.refundHuf ?? 0) + amount
      row.totalHuf -= amount
    }
  }
}

function itemRevenue(item: RevenueOrderItemInput): number {
  const price = finiteNumber(item.priceHuf) ?? 0
  const quantity = finiteNumber(item.quantity)
  const count = quantity !== null && quantity > 0 ? quantity : 0
  return price * count
}

function itemsRevenue(items: readonly RevenueOrderItemInput[]): number {
  let total = 0
  for (const item of items) {
    total += itemRevenue(item)
  }
  return total
}

/**
 * A rendelés-szintű tartalék összeg ága. Ha a tételek EGYÖNTETŰEN egy ághoz
 * tartoznak, oda kerül (egy szakmai kurzus hiányos snapshotja ne az otthoni
 * ágat növelje); vegyes vagy tétel nélküli rendelésnél a laikus ág a tartalék
 * — ugyanaz a szabály, mint a `normalizeAudience()` ismeretlen-ágánál.
 */
function fallbackAudience(items: readonly RevenueOrderItemInput[]): CourseAudience {
  let single: CourseAudience | null = null
  for (const item of items) {
    const audience = normalizeAudience(item.audience)
    if (single === null) {
      single = audience
    } else if (single !== audience) {
      return 'laikus'
    }
  }
  return single ?? 'laikus'
}

export function aggregateMonthlyRevenue(
  orders: readonly RevenueOrderInput[],
  options?: { months?: number; now?: Date },
): MonthlyRevenueRow[] {
  const months = options?.months ?? DEFAULT_MONTHS
  const now = options?.now ?? new Date()
  const windowKeys = listMonthKeys(now, months)
  const byMonth = new Map<string, MonthlyRevenueRow>()
  for (const key of windowKeys) {
    byMonth.set(key, emptyRow(key))
  }

  for (const order of orders) {
    if (order.status !== 'paid') {
      continue
    }
    const month = orderMonthKey(order)
    if (month === null) {
      continue
    }
    const row = byMonth.get(month)
    if (row === undefined) {
      continue
    }

    row.orderCount += 1

    const items = Array.isArray(order.items) ? order.items : []
    const itemsTotal = itemsRevenue(items)
    const orderTotal = finiteNumber(order.totalHuf) ?? 0

    // Rend.-szintű tartalék: ha a tételsorok összege nem fed le mindent.
    //  a) `items: []` (régi rendelés) → a totalHufSnapshot számított,
    //  b) `items` megvan, de a `priceHufSnapshot` NULL (a mezőt a T-017 hook
    //     csak create-kor tölti, a régi sorok backfill nélkül maradtak)
    //     → a riport 0 Ft-ot írt, miközben a rendelés 79 500 Ft-ról szólt.
    // A fallback így fordítva működött: KEVESEBB adatból jött ki a HELYESEBB
    // szám. A feltétel ezért nem az items ürességére, hanem a tételekből
    // számolt összegre néz. Csak POZITÍV rendelés-összeg pótol (a 0 és a
    // negatív snapshot nem növelheti — illetve nem csökkentheti — a bevételt).
    if (itemsTotal === 0 && orderTotal > 0) {
      if (fallbackAudience(items) === 'szakember') {
        row.szakemberHuf += orderTotal
      } else {
        row.laikusHuf += orderTotal
      }
      row.totalHuf += orderTotal
      continue
    }

    for (const item of items) {
      const amount = itemRevenue(item)
      const audience = normalizeAudience(item.audience)
      if (audience === 'szakember') {
        row.szakemberHuf += amount
      } else {
        row.laikusHuf += amount
      }
      row.totalHuf += amount
    }
  }

  deductPartialRefunds(orders, byMonth)

  return windowKeys.map((key) => byMonth.get(key) ?? emptyRow(key))
}

export function sumRevenueTotals(
  rows: readonly MonthlyRevenueRow[],
  refundsDeducted = false,
): RevenueTotals {
  let refundHuf = 0
  const totals: RevenueTotals = {
    laikusHuf: 0,
    szakemberHuf: 0,
    totalHuf: 0,
    orderCount: 0,
    refundsDeducted,
  }
  for (const row of rows) {
    totals.laikusHuf += row.laikusHuf
    totals.szakemberHuf += row.szakemberHuf
    refundHuf += row.refundHuf ?? 0
    totals.totalHuf += row.totalHuf
    totals.orderCount += row.orderCount
  }
  return { ...totals, refundHuf }
}

function ordersInMonthWindow(
  orders: readonly RevenueOrderInput[],
  options?: { months?: number; now?: Date },
): readonly RevenueOrderInput[] {
  const months = options?.months ?? DEFAULT_MONTHS
  const now = options?.now ?? new Date()
  const windowKeys = new Set(listMonthKeys(now, months))
  return orders.filter((order) => {
    const month = orderMonthKey(order)
    return month !== null && windowKeys.has(month)
  })
}

/**
 * Kurzusonkénti bontás — KIZÁRÓLAG tétel-szintű adatból.
 *
 * A havi sorok rendelés-szintű tartaléka (F3) itt SZÁNDÉKOSAN nem jelenik meg:
 * a `totalHufSnapshot` nem tudja, melyik kurzusra jutott az összeg, tehát egy
 * ide gyártott sor kitalált adat lenne. Következmény, amit tudni kell a
 * kimutatás olvasásakor: hiányos item-snapshotú (backfilleletlen) rendeléseknél
 * a kurzus-tábla bevétel-összege KEVESEBB lehet, mint a havi összesen — a
 * különbség pontosan a tartalékkal pótolt rendelések összege. A tétel ilyenkor
 * 0 Ft-os sorként (`freeItemCount`) látszik, ami jelzi is a hiányt.
 */
export function aggregateCourseRevenue(orders: readonly RevenueOrderInput[]): CourseRevenueRow[] {
  const bySku = new Map<string, CourseRevenueRow & { orderIds: Set<number> }>()
  let orderIndex = 0

  for (const order of orders) {
    orderIndex += 1
    if (order.status !== 'paid' || !Array.isArray(order.items)) {
      continue
    }
    const seenInOrder = new Set<string>()
    for (const item of order.items) {
      const skuRaw = typeof item.titleSnapshot === 'string' ? item.titleSnapshot.trim() : ''
      const sku = skuRaw.length > 0 ? skuRaw : '(nincs azonosító)'
      const cim = typeof item.displayTitle === 'string' ? item.displayTitle.trim() : ''
      let row = bySku.get(sku)
      if (row === undefined) {
        row = {
          // A cím a rendezés miatt is kell, ezért már itt eldől; ha egyik
          // tételnél sincs populált termék (törölt kurzus), a sku marad a
          // sorfejléc — ez az egyetlen név, amit ilyenkor igazat mondhatunk.
          title: cim.length > 0 ? cim : sku,
          sku,
          audience: normalizeAudience(item.audience),
          revenueHuf: 0,
          orderCount: 0,
          itemCount: 0,
          freeItemCount: 0,
          orderIds: new Set<number>(),
        }
        bySku.set(sku, row)
      } else if (cim.length > 0 && row.title === row.sku) {
        // A rendelések a legfrissebbel kezdődnek, de egy régebbi tételnél is
        // előfordulhat, hogy csak ott van populált termék: az első ISMERT
        // címet vesszük át, a későbbi ismétlés nem írja felül.
        row.title = cim
      }
      const amount = itemRevenue(item)
      row.revenueHuf += amount
      row.itemCount += 1
      if (amount === 0) {
        row.freeItemCount += 1
      }
      if (!seenInOrder.has(sku)) {
        seenInOrder.add(sku)
        row.orderIds.add(orderIndex)
      }
    }
  }

  return [...bySku.values()]
    .map((row) => ({
      title: row.title,
      sku: row.sku,
      audience: row.audience,
      revenueHuf: row.revenueHuf,
      orderCount: row.orderIds.size,
      itemCount: row.itemCount,
      freeItemCount: row.freeItemCount,
    }))
    .sort(
      (a, b) =>
        b.revenueHuf - a.revenueHuf ||
        // A LÁTHATÓ név szerint rendezünk holtversenynél (azt olvassa a
        // munkatárs), a sku csak a végső, egyedi tiebreaker — így a sorrend
        // determinisztikus marad két azonos című terméknél is.
        a.title.localeCompare(b.title, 'hu') ||
        a.sku.localeCompare(b.sku, 'hu'),
    )
}

export function emptyFunnel(): OrderFunnelCounts {
  return {
    created: 0,
    paymentPending: 0,
    paid: 0,
    paymentFailed: 0,
    cancelled: 0,
    refunded: 0,
    other: 0,
    total: 0,
  }
}

/**
 * Státusz → tölcsér-mező: a leképezés EGYETLEN forrása.
 *
 * Két út olvassa (F8, 2026-08-21-i vizsgálat): a státusz-listás
 * `aggregateOrderFunnel` és a darabszámos `buildOrderFunnelFromCounts`. Új
 * rendelés-státusz felvételekor ezt az EGY táblát kell bővíteni — a régi,
 * `switch`-es alak mellett a két ág külön-külön csúszhatott volna el.
 *
 * A kulcsok a `src/plugins/ecommerce.ts` állapotgépének értékei, a rendelés
 * életútjának sorrendjében (created → … → refunded). `Map`, nem objektum: a
 * `Map.get` nem ad vissza örökölt `Object.prototype`-tagot, tehát egy
 * `'constructor'` státuszú (elvben lehetetlen, gyakorlatban importból bejövő)
 * sor sem tud mezőnévnek álcázott függvényt visszaadni.
 */
const FUNNEL_FIELD_BY_STATUS = new Map<string, keyof OrderFunnelCounts>([
  ['created', 'created'],
  ['payment_pending', 'paymentPending'],
  ['paid', 'paid'],
  ['payment_failed', 'paymentFailed'],
  ['cancelled', 'cancelled'],
  ['refunded', 'refunded'],
])

/** A tölcsérben nevesített rendelés-státuszok, életút-sorrendben. */
export const FUNNEL_STATUSES: readonly string[] = [...FUNNEL_FIELD_BY_STATUS.keys()]

/**
 * Tölcsér státusz-LISTÁBÓL — olvasható referencia-alak.
 *
 * Az ÉLES lekérdezés nem ezt hívja (az F8 óta a tölcsér `payload.count`-ból
 * jön, sorok beolvasása nélkül), hanem a `buildOrderFunnelFromCounts`-ot. Ez a
 * függvény azért marad, mert néhány elemű listán sokkal olvashatóbban fejezi
 * ki a várt eredményt, és mert az egyenértékűség-teszt EHHEZ MÉRI a darabszámos
 * ágat: ha a közös leképezés-tábla elcsúszna, a két út eredménye eltérne.
 */
export function aggregateOrderFunnel(statuses: readonly string[]): OrderFunnelCounts {
  const funnel = emptyFunnel()
  for (const status of statuses) {
    funnel.total += 1
    funnel[FUNNEL_FIELD_BY_STATUS.get(status) ?? 'other'] += 1
  }
  return funnel
}

/** Darabszám-higiénia: a nem véges, negatív vagy tört érték 0-ra esik. */
function nonNegativeCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
}

/**
 * Tölcsér count-okból; other = total − nevesített. other nem mehet negatívba (párhuzamos count lekérdezés).
 */
export function buildOrderFunnelFromCounts(
  countByStatus: ReadonlyMap<string, number>,
  total: number,
): OrderFunnelCounts {
  const funnel = emptyFunnel()
  let named = 0
  for (const [status, field] of FUNNEL_FIELD_BY_STATUS) {
    const count = nonNegativeCount(countByStatus.get(status) ?? 0)
    funnel[field] = count
    named += count
  }
  funnel.total = nonNegativeCount(total)
  funnel.other = Math.max(0, funnel.total - named)
  return funnel
}

export function formatHuf(value: number): string {
  return `${value.toLocaleString('hu-HU')} Ft`
}

export function formatMonthLabel(monthKey: string): string {
  const [yearPart, monthPart] = monthKey.split('-')
  const year = Number(yearPart)
  const month = Number(monthPart)
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return monthKey
  }
  return new Date(year, month - 1, 1).toLocaleDateString('hu-HU', {
    year: 'numeric',
    month: 'long',
  })
}

/**
 * Rövid hónap-tick a diagram X-tengelyéhez („szept.", „jan."). A táblázat
 * marad a teljes `formatMonthLabel`-en; a diagramon a 12 hosszú címke
 * („2025. szeptember") 320 px-es viewporton átfedett — a rövid alak elfér
 * elforgatás nélkül. Az évszámot a diagram csak évváltásnál és az első
 * oszlopnál írja ki (Carbon „landmark label" minta:
 * https://carbondesignsystem.com/data-visualization/axes-and-labels/).
 */
export function formatMonthShort(monthKey: string): string {
  const [yearPart, monthPart] = monthKey.split('-')
  const year = Number(yearPart)
  const month = Number(monthPart)
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return monthKey
  }
  return new Date(year, month - 1, 1).toLocaleDateString('hu-HU', { month: 'short' })
}

export function buildRevenueReport(
  orders: readonly RevenueOrderInput[],
  funnel: OrderFunnelCounts,
  options?: { months?: number; now?: Date; truncated?: boolean; refundsDeducted?: boolean },
): RevenueReport {
  const monthOptions = { months: options?.months ?? DEFAULT_MONTHS, now: options?.now }
  const months = aggregateMonthlyRevenue(orders, monthOptions)
  const refundsDeducted = options?.refundsDeducted === true
  return {
    months,
    totals: sumRevenueTotals(months, refundsDeducted),
    // A kurzus-tábla ugyanarra az ablakra vonatkozik, mint a havi összeg.
    // A tölcsér szándékosan teljes állomány: a nyitott/sikertelen fizetés
    // operatív jelzés, nem 12 havi bevétel.
    courses: aggregateCourseRevenue(ordersInMonthWindow(orders, monthOptions)),
    // Másolat, nem hivatkozás: a jelentés ne aliasolja a hívó objektumát.
    funnel: { ...funnel },
    truncated: options?.truncated === true,
    refundsDeducted,
  }
}
