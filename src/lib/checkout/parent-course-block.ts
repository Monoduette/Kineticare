import type { Payload, Where } from 'payload'

import type { Order } from '../../payload-types'
import { parentCourseIdsOf } from '../course-family'
import { resolveCourseAccessForUser } from '../course-access-lookup'
import type { Logger } from '../logger'
import { CHECKOUT_GUEST_FINISH_AFTER_LOGIN } from './form-submission'
import { minutesLeftInWindow } from './pending-payment'

/**
 * Témakurzus pénztár-kapuja (src/lib/course-family.ts): aki a teljes programot
 * már birtokolja, a benne foglalt témakurzusért ne fizessen még egyszer.
 *
 * A kapu a vevőnkénti pénztár-zárban, a duplavásárlás-ellenőrzés ELŐTT fut,
 * így a program fizetése és a témakurzus fizetése ugyanannál a vevőnél sorba
 * áll. Hozzáférést SOHA nem ad, csak elutasít.
 *
 * Döntés:
 * - van a programra szóló, 24 óránál frissebb `payment_pending` (fiók vagy
 *   e-mail szerint) → 409, várjon az eredményre. Nem csak a fizetési ablakon
 *   belül: elveszett callback és késő order-poll mellett a Barionnál sikeres
 *   fizetés az ablak után is `payment_pending` maradhat (CLAUDE.md 26.), és
 *   addig a témakurzus második terhelés lenne. A lezáratlan sort az order-poll
 *   legkésőbb egy nap alatt lezárja;
 * - a vevő birtokolja a programot (fióknál a purchases lista, mint a
 *   kurzusoldalon; fiók nélküli e-mailnél a paid rendelés), és a hozzáférése
 *   él → 409 (bejelentkezve megmondjuk, vendégnek nem: W4);
 * - lejárt időkorlátos program, visszatérített (nem paid) rendelés → mehet.
 *
 * Bizonytalanságnál zárva marad: lekérdezési hiba → 503, a hozzáférés-számítás
 * hibája → „birtokolja” (a resolver alapértelmezett, nem `denyOnLookupFailure`
 * módja). Egy elmaradt eladás javítható, egy kétszer levont összeg csak kézi
 * visszatérítéssel.
 */

export const CHECKOUT_INCLUDED_IN_OWNED_PROGRAM =
  'Ez a témakurzus benne van a teljes programodban, ezért nem kell külön megvenned. A Kurzusaim oldalon nyisd meg a programot.'

export const CHECKOUT_PROGRAM_CHECK_UNAVAILABLE =
  'Most nem tudtuk ellenőrizni, hogy ez a kurzus benne van-e egy már megvett programodban. Hogy ne fizess kétszer, próbáld újra néhány perc múlva.'

/** Ennyi ideig tilt a programra szóló, még lezáratlan fizetés (az order-poll ennyi alatt lezárja). */
export const PROGRAM_PENDING_BLOCK_MS = 24 * 60 * 60 * 1000

export const CHECKOUT_PROGRAM_PAYMENT_UNRESOLVED =
  'A teljes programra, amelyben ez a témakurzus is benne van, korábban fizetés indult, és az eredményét még ellenőrizzük. Hogy ne fizess kétszer, ezt a témakurzust addig nem lehet megvenni. Ez általában legfeljebb egy napig tart.'

export function checkoutProgramPaymentInProgressMessage(minutesLeft: number): string {
  return (
    'Nemrég fizetés indult a teljes programra, amelyben ez a témakurzus is benne van, és az eredményét még nem látjuk. ' +
    'Ha a fizetés sikerül, ezt a témakurzust nem kell külön megvenned. ' +
    `Ha nem sikerül, ${minutesLeft} perc múlva itt is fizethetsz.`
  )
}

export class ParentCourseBlockError extends Error {
  constructor(
    readonly status: 409 | 503,
    message: string,
  ) {
    super(message)
    this.name = 'ParentCourseBlockError'
  }
}

export interface ParentCourseBlockInput {
  payload: Payload
  product: { id: number; parentCourses?: unknown }
  /** A munkamenet felhasználója; vendégnél null. */
  loggedIn: boolean
  /** Bejelentkezve a felhasználó, vendégnél az e-mailhez tartozó meglévő fiók. */
  accountId: number | null
  /** A fiók `purchases` listája, ha a hívó már ismeri (bejelentkezett vevő). */
  accountPurchases?: unknown
  email: string
  nowMs: number
  paymentWindowMs: number
  log: Logger
}

function purchaseIdSet(purchases: unknown): Set<number> {
  const ids = new Set<number>()
  if (!Array.isArray(purchases)) return ids
  for (const entry of purchases) {
    const id = typeof entry === 'object' && entry !== null ? (entry as { id?: unknown }).id : entry
    if (typeof id === 'number' && Number.isSafeInteger(id) && id > 0) ids.add(id)
  }
  return ids
}

function buyerScope(accountId: number | null, email: string): Where {
  const byEmail: Where = { customerEmail: { equals: email } }
  return accountId === null ? byEmail : { or: [{ customer: { equals: accountId } }, byEmail] }
}

async function failClosed<T>(log: Logger, step: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof ParentCourseBlockError) throw error
    log.error('checkout-start: a teljes program ellenőrzése sikertelen — 503', {
      step,
      error: error instanceof Error ? error.message : String(error),
    })
    throw new ParentCourseBlockError(503, CHECKOUT_PROGRAM_CHECK_UNAVAILABLE)
  }
}

export async function assertNotIncludedInOwnedProgram(
  input: ParentCourseBlockInput,
): Promise<void> {
  const parentIds = parentCourseIdsOf(input.product)
  if (parentIds.length === 0) return

  const { payload, accountId, email, log } = input
  const scope = buyerScope(accountId, email)
  const orderWhere = (status: Order['status'], extra: Where[] = []): Where => ({
    and: [scope, { 'items.product': { in: parentIds } }, { status: { equals: status } }, ...extra],
  })

  const pending = await failClosed(log, 'pending', () =>
    payload.find({
      collection: 'orders',
      where: orderWhere('payment_pending', [
        {
          createdAt: {
            greater_than_equal: new Date(input.nowMs - PROGRAM_PENDING_BLOCK_MS).toISOString(),
          },
        },
      ]),
      sort: '-createdAt',
      limit: 1,
      depth: 0,
      pagination: false,
      overrideAccess: true,
    }),
  )
  const livePending = pending.docs[0]
  if (livePending !== undefined) {
    log.info('checkout-start: a teljes programra élő fizetés fut — a témakurzus vár', {
      productId: input.product.id,
      parentOrderId: livePending.id,
    })
    const createdMs = Date.parse(livePending.createdAt)
    const insideWindow =
      Number.isFinite(createdMs) && input.nowMs - createdMs < input.paymentWindowMs
    throw new ParentCourseBlockError(
      409,
      insideWindow
        ? checkoutProgramPaymentInProgressMessage(
            minutesLeftInWindow(livePending.createdAt, input.nowMs, input.paymentWindowMs),
          )
        : CHECKOUT_PROGRAM_PAYMENT_UNRESOLVED,
    )
  }

  // Fiókos vevőnél a birtoklás a `purchases` listából dől el, ugyanúgy, mint a
  // kurzusoldalon (course-family-owned.ts). Így a két felület nem mond mást:
  // ahol az oldal vásárlógombot mutat, ott a pénztár sem állítja, hogy a
  // program már a vevőé. A paid rendelés csak fiók nélküli e-mailnél számít.
  const ownedParentIds = new Set<number>()
  if (accountId !== null) {
    const purchases =
      input.accountPurchases !== undefined
        ? input.accountPurchases
        : (
            await failClosed(log, 'purchases', () =>
              payload.findByID({
                collection: 'users',
                id: accountId,
                depth: 0,
                select: { purchases: true },
                overrideAccess: true,
              }),
            )
          )?.purchases
    for (const id of purchaseIdSet(purchases)) {
      if (parentIds.includes(id)) ownedParentIds.add(id)
    }
  } else {
    const paid = await failClosed(log, 'paid', () =>
      payload.find({
        collection: 'orders',
        where: orderWhere('paid'),
        limit: 100,
        depth: 0,
        pagination: false,
        overrideAccess: true,
      }),
    )
    for (const order of paid.docs) {
      for (const item of order.items ?? []) {
        const raw: unknown = item?.product
        const id = typeof raw === 'object' && raw !== null ? (raw as { id?: unknown }).id : raw
        if (typeof id === 'number' && parentIds.includes(id)) ownedParentIds.add(id)
      }
    }
  }

  if (ownedParentIds.size === 0) return

  if (accountId === null) {
    // Fiók nélküli e-mail paid programmal: nem mondjuk meg, mi van a címen (W4).
    throw new ParentCourseBlockError(409, CHECKOUT_GUEST_FINISH_AFTER_LOGIN)
  }

  const parents = await failClosed(log, 'parents', () =>
    payload.find({
      collection: 'products',
      where: { id: { in: [...ownedParentIds] } },
      depth: 0,
      limit: ownedParentIds.size,
      pagination: false,
      select: { accessDurationDays: true },
      overrideAccess: true,
    }),
  )
  // Törölt programhoz nincs mit megnyitni: a kurzusoldal sem ajánlja fel
  // (course-family-owned.ts), ezért itt sem tilt.
  if (parents.docs.length === 0) return

  const states = await failClosed(log, 'access', () =>
    resolveCourseAccessForUser({
      payload,
      userId: accountId,
      products: parents.docs.map((doc) => ({
        id: doc.id,
        accessDurationDays: doc.accessDurationDays ?? null,
      })),
      now: new Date(input.nowMs),
      logger: log,
    }),
  )
  const liveParentId = parents.docs
    .map((doc) => doc.id)
    .find((id) => states.get(id)?.hasAccess !== false)
  if (liveParentId === undefined) return

  log.info('checkout-start: a vevő birtokolja a teljes programot — témakurzus elutasítva', {
    productId: input.product.id,
    parentId: liveParentId,
    loggedIn: input.loggedIn,
  })
  throw new ParentCourseBlockError(
    409,
    input.loggedIn ? CHECKOUT_INCLUDED_IN_OWNED_PROGRAM : CHECKOUT_GUEST_FINISH_AFTER_LOGIN,
  )
}
