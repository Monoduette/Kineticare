/**
 * accessGrants backfill — hiányzó `grantedAt` időkorlátos purchases-sorokhoz.
 * Dátum forrása: a vevő saját paid rendelésének `createdAt` (legutolsó).
 * A termék mai `priceInHUF` árát SOHA nem olvassuk. Íráshoz:
 * `OWNER_BACKFILL_CONFIRM=igen`. Meglévő grantot nem ír felül.
 */

import type { Payload } from 'payload'

import {
  accessGrantsForWrite,
  grantDatesFromRows,
  grantRowsFromUnknown,
  withUpsertedAccessGrant,
} from './access-grants'
import { purchaseDatesFromOrders } from './course-access-lookup'
import { maskEmail } from './email/mask'
import { type Logger } from './logger'
import { readStatisticsPages } from './statistics/query'
import { withUserPurchasesLock } from './user-purchases-lock'
import type { Order } from '../payload-types'

export const ACCESS_GRANT_BACKFILL_LAPMERET = 200
export const ACCESS_GRANT_BACKFILL_USER_MAX = 20_000
export const ACCESS_GRANT_BACKFILL_ORDER_MAX = 20_000
export const ACCESS_GRANT_BACKFILL_PRODUCT_MAX = 5_000

export type AccessGrantKihagyasIndok = 'nincs-paid-datum'

export const ACCESS_GRANT_KIHAGYAS_SZOVEG: Readonly<
  Record<AccessGrantKihagyasIndok, string>
> = {
  'nincs-paid-datum':
    'időkorlátos kurzus a purchasesben, de nincs paid rendelés dátuma — a script nem találgat (nem mai nap, nem a fiók létrehozása)',
}

export type AccessGrantTerv =
  | { readonly dontes: 'ir'; readonly productId: number; readonly grantedAt: string }
  | {
      readonly dontes: 'kihagy'
      readonly productId: number
      readonly indok: AccessGrantKihagyasIndok
      readonly reszlet: string
    }

/** A vevő purchases-tömbjéből a termék-azonosítók. */
export function productIdsFromPurchases(raw: unknown): number[] {
  if (!Array.isArray(raw)) {
    return []
  }
  const ids = new Set<number>()
  for (const item of raw) {
    if (typeof item === 'number' && Number.isFinite(item)) {
      ids.add(item)
      continue
    }
    if (typeof item === 'object' && item !== null && 'id' in item) {
      const id = (item as { id: unknown }).id
      if (typeof id === 'number' && Number.isFinite(id)) {
        ids.add(id)
      }
    }
  }
  return [...ids]
}

/**
 * Paid rendelések → vevőnként productId → a legutolsó paid `createdAt`.
 * A `purchaseDatesFromOrders` szabályát használja rendelésenként, majd
 * vevőnként összesíti (a későbbi dátum nyeri).
 */
export function paidDatesByCustomer(
  orders: readonly Pick<Order, 'customer' | 'status' | 'createdAt' | 'items'>[],
): Map<number, Map<number, string>> {
  const byCustomer = new Map<number, Map<number, string>>()
  const groups = new Map<number, Order[]>()

  for (const order of orders) {
    const customer = order.customer
    const customerId =
      typeof customer === 'number'
        ? customer
        : customer && typeof customer === 'object' && 'id' in customer
          ? customer.id
          : null
    if (typeof customerId !== 'number' || !Number.isFinite(customerId)) {
      continue
    }
    const list = groups.get(customerId) ?? []
    list.push(order as Order)
    groups.set(customerId, list)
  }

  for (const [customerId, list] of groups) {
    byCustomer.set(customerId, purchaseDatesFromOrders(list))
  }
  return byCustomer
}

/**
 * Egy vevő terve — tiszta függvény, mellékhatás nélkül.
 *
 * Csak a `limitedProductIds` halmazba tartozó purchases-sorokra dolgozik.
 * Meglévő grant: nincs teendő. Paid dátum: írás. Különben kihagyás.
 */
export function tervezzAccessGrantBackfill(input: {
  purchases: unknown
  accessGrants: unknown
  limitedProductIds: ReadonlySet<number>
  paidDates: ReadonlyMap<number, string>
}): AccessGrantTerv[] {
  const existing = grantDatesFromRows(input.accessGrants)
  const terv: AccessGrantTerv[] = []

  for (const productId of productIdsFromPurchases(input.purchases)) {
    if (!input.limitedProductIds.has(productId)) {
      continue
    }
    if (existing.has(productId)) {
      continue
    }
    const paid = input.paidDates.get(productId)
    if (paid !== undefined) {
      terv.push({ dontes: 'ir', productId, grantedAt: paid })
      continue
    }
    terv.push({
      dontes: 'kihagy',
      productId,
      indok: 'nincs-paid-datum',
      reszlet: ACCESS_GRANT_KIHAGYAS_SZOVEG['nincs-paid-datum'],
    })
  }
  return terv
}

export interface AccessGrantBackfillUserDoc {
  id: number
  email?: string | null
  purchases?: unknown
  accessGrants?: unknown
}

export interface AccessGrantBackfillProductDoc {
  id: number
  accessDurationDays?: number | null
}

export interface AccessGrantKihagyott {
  readonly userId: number
  readonly emailMaszk: string
  readonly productId: number
  readonly indok: AccessGrantKihagyasIndok
  readonly reszlet: string
}

export interface AccessGrantIrasHiba {
  readonly userId: number
  readonly hiba: string
}

export interface AccessGrantBackfillJelentes {
  readonly dryRun: boolean
  readonly megnezettFelhasznalok: number
  readonly megnezettRendelesek: number
  readonly korlatosTermekek: number
  readonly felsoKorlatUser: number
  readonly felsoKorlatOrder: number
  readonly csonkoltUser: boolean
  readonly csonkoltOrder: boolean
  readonly csonkoltProduct: boolean
  readonly irasok: number
  readonly erintettFelhasznalok: number
  readonly kihagyottak: readonly AccessGrantKihagyott[]
  readonly irasHibak: readonly AccessGrantIrasHiba[]
}

export interface AccessGrantBackfillFuggosegek {
  payload: Payload
  dryRun: boolean
  maxUser?: number
  maxOrder?: number
  lapmeret?: number
  log?: Pick<Logger, 'info' | 'warn' | 'error'>
  /**
   * Írás alatti zár. Alap: `withUserPurchasesLock`. A teszt identity-t ad,
   * hogy ne kelljen Postgres advisory-lock.
   */
  withLock?: (
    payload: Payload,
    userId: number,
    fn: () => Promise<void>,
  ) => Promise<void>
}

const NEMA_NAPLO: Pick<Logger, 'info' | 'warn' | 'error'> = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

function korlatosTermek(days: unknown): boolean {
  return typeof days === 'number' && Number.isFinite(days) && days > 0
}

/** A `--max=<szám>` kapcsoló; hibás/hiányzó értéknél az alapérték. */
export function parseMaxKapcsolo(argv: readonly string[], alapertek: number): number {
  const talalat = argv.find((arg) => arg.startsWith('--max='))
  if (talalat === undefined) {
    return alapertek
  }
  const nyers = talalat.slice('--max='.length).trim()
  if (!/^\d+$/.test(nyers)) {
    return alapertek
  }
  const ertek = Number(nyers)
  return Number.isSafeInteger(ertek) && ertek > 0 ? ertek : alapertek
}

export function formazdAccessGrantJelentest(jelentes: AccessGrantBackfillJelentes): string[] {
  const sorok = [
    `accessGrants backfill — ${jelentes.dryRun ? 'PRÓBAFUTÁS' : 'ÉLES'}: ` +
      `${jelentes.megnezettFelhasznalok} felhasználó, ${jelentes.megnezettRendelesek} paid rendelés, ` +
      `${jelentes.korlatosTermekek} időkorlátos kurzus.`,
    `Írás: ${jelentes.irasok} grant-sor ${jelentes.erintettFelhasznalok} felhasználónál.`,
    `Kihagyás: ${jelentes.kihagyottak.length} (nincs kitalálható paid dátum).`,
  ]
  if (jelentes.csonkoltUser || jelentes.csonkoltOrder || jelentes.csonkoltProduct) {
    sorok.push(
      'FIGYELEM: a beolvasás a felső korlátnál csonkult — a futás NEM teljes. ' +
        `userMax=${jelentes.felsoKorlatUser} orderMax=${jelentes.felsoKorlatOrder}`,
    )
  }
  for (const kihagy of jelentes.kihagyottak) {
    sorok.push(
      `KIHAGYVA user#${kihagy.userId} (${kihagy.emailMaszk}) termék#${kihagy.productId}: ${kihagy.reszlet}`,
    )
  }
  for (const hiba of jelentes.irasHibak) {
    sorok.push(`ÍRÁSI HIBA user#${hiba.userId}: ${hiba.hiba}`)
  }
  return sorok
}

/**
 * A backfill vezérlése. A próbafutás kapuja EGYETLEN helyen zár:
 * az írás előtti `if (dryRun)`. Teszt méri: dry-runban 0 `payload.update`.
 */
export async function futtatAccessGrantBackfill(
  fuggosegek: AccessGrantBackfillFuggosegek,
): Promise<AccessGrantBackfillJelentes> {
  const log = fuggosegek.log ?? NEMA_NAPLO
  const lapmeret = fuggosegek.lapmeret ?? ACCESS_GRANT_BACKFILL_LAPMERET
  const maxUser = fuggosegek.maxUser ?? ACCESS_GRANT_BACKFILL_USER_MAX
  const maxOrder = fuggosegek.maxOrder ?? ACCESS_GRANT_BACKFILL_ORDER_MAX

  const products = await readStatisticsPages<AccessGrantBackfillProductDoc>(
    async (page, limit) =>
      (await fuggosegek.payload.find({
        collection: 'products',
        depth: 0,
        page,
        limit,
        sort: 'id',
        select: { accessDurationDays: true },
        overrideAccess: true,
      })) as unknown as {
        docs?: AccessGrantBackfillProductDoc[] | null
        hasNextPage?: boolean | null
        totalDocs?: number | null
      },
    lapmeret,
    ACCESS_GRANT_BACKFILL_PRODUCT_MAX,
  )

  const limitedProductIds = new Set<number>()
  for (const product of products.docs) {
    if (korlatosTermek(product.accessDurationDays)) {
      limitedProductIds.add(product.id)
    }
  }

  const orders = await readStatisticsPages<Order>(
    async (page, limit) =>
      (await fuggosegek.payload.find({
        collection: 'orders',
        where: { status: { equals: 'paid' } },
        depth: 0,
        page,
        limit,
        sort: 'id',
        select: { customer: true, status: true, createdAt: true, items: true },
        overrideAccess: true,
      })) as unknown as {
        docs?: Order[] | null
        hasNextPage?: boolean | null
        totalDocs?: number | null
      },
    lapmeret,
    maxOrder,
  )

  const datesByCustomer = paidDatesByCustomer(orders.docs)

  const users = await readStatisticsPages<AccessGrantBackfillUserDoc>(
    async (page, limit) =>
      (await fuggosegek.payload.find({
        collection: 'users',
        depth: 0,
        page,
        limit,
        sort: 'id',
        select: { email: true, purchases: true, accessGrants: true },
        overrideAccess: true,
      })) as unknown as {
        docs?: AccessGrantBackfillUserDoc[] | null
        hasNextPage?: boolean | null
        totalDocs?: number | null
      },
    lapmeret,
    maxUser,
  )

  const kihagyottak: AccessGrantKihagyott[] = []
  const irasHibak: AccessGrantIrasHiba[] = []
  let irasok = 0
  const erintett = new Set<number>()

  for (const user of users.docs) {
    const terv = tervezzAccessGrantBackfill({
      purchases: user.purchases,
      accessGrants: user.accessGrants,
      limitedProductIds,
      paidDates: datesByCustomer.get(user.id) ?? new Map(),
    })
    const irandok = terv.filter((sor) => sor.dontes === 'ir')
    for (const sor of terv) {
      if (sor.dontes === 'kihagy') {
        kihagyottak.push({
          userId: user.id,
          emailMaszk: maskEmail(user.email ?? ''),
          productId: sor.productId,
          indok: sor.indok,
          reszlet: sor.reszlet,
        })
      }
    }
    if (irandok.length === 0) {
      continue
    }

    erintett.add(user.id)
    irasok += irandok.length
    const leiras = irandok
      .map((sor) => `termék#${sor.productId} grantedAt=${sor.grantedAt}`)
      .join('; ')

    if (fuggosegek.dryRun) {
      log.info(`accessGrants backfill — ÍRNA: user#${user.id} → ${leiras}`)
      continue
    }

    try {
      const zarral = fuggosegek.withLock ?? withUserPurchasesLock
      await zarral(fuggosegek.payload, user.id, async () => {
        const friss = await fuggosegek.payload.findByID({
          collection: 'users',
          id: user.id,
          depth: 0,
          overrideAccess: true,
        })
        const ujraTerv = tervezzAccessGrantBackfill({
          purchases: friss && typeof friss === 'object' ? friss.purchases : null,
          accessGrants: friss && typeof friss === 'object' ? friss.accessGrants : null,
          limitedProductIds,
          paidDates: datesByCustomer.get(user.id) ?? new Map(),
        }).filter((sor) => sor.dontes === 'ir')

        let rows = grantRowsFromUnknown(
          friss && typeof friss === 'object' ? friss.accessGrants : null,
        )
        for (const sor of ujraTerv) {
          rows = withUpsertedAccessGrant(rows, sor.productId, new Date(sor.grantedAt))
        }
        await fuggosegek.payload.update({
          collection: 'users',
          id: user.id,
          depth: 0,
          overrideAccess: true,
          data: { accessGrants: accessGrantsForWrite(rows) },
        })
      })
      log.info(`accessGrants backfill — ÍRVA: user#${user.id} → ${leiras}`)
    } catch (error: unknown) {
      erintett.delete(user.id)
      irasok -= irandok.length
      const uzenet = error instanceof Error ? error.message : String(error)
      irasHibak.push({ userId: user.id, hiba: uzenet })
      log.error(`accessGrants backfill — ÍRÁSI HIBA: user#${user.id}`, { hiba: uzenet })
    }
  }

  return {
    dryRun: fuggosegek.dryRun,
    megnezettFelhasznalok: users.docs.length,
    megnezettRendelesek: orders.docs.length,
    korlatosTermekek: limitedProductIds.size,
    felsoKorlatUser: maxUser,
    felsoKorlatOrder: maxOrder,
    csonkoltUser: users.truncated,
    csonkoltOrder: orders.truncated,
    csonkoltProduct: products.truncated,
    irasok,
    erintettFelhasznalok: erintett.size,
    kihagyottak,
    irasHibak,
  }
}
