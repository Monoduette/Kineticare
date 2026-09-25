import type { Payload } from 'payload'

import { shouldEmitThrottledAlert } from '../alert-throttle'
import { KAPCSOLATI_EMAIL_TARTALEK } from '../contact-email'
import { maskEmail } from '../email/mask'
import type { Logger } from '../logger'
import { minutesLeftInWindow } from './pending-payment'

/**
 * Visszaélés elleni korlátok a pénztárban (a-checkout-9).
 *
 * A vendég-pénztár hitelesítés nélkül hoz létre rendelést és Barion-fizetést,
 * és eddig csak az IP-keret (10 kérés / 10 perc / IP, replikánként, memóriában)
 * fogta; IP-rotációval ez korlátlan rendelést, rendelésszám-égetést és
 * Barion-hívást (kártyatesztelés a kereskedői azonosítónkon) engedett.
 *
 * A korlátok az ADATBÁZISBÓL számolnak, nem memóriából: replikák között és
 * újraindítás után is ugyanazt látják, és természetesen kihagyják a fizetett
 * rendelést. Így egy vevő, aki egymás után több kurzust fizet ki, sosem ütközik
 * beléjük.
 *
 * Mi számít, és miért így (a vezetői kikötés: valódi, fizetést újrapróbáló
 * vevőt a korlát nem zárhat ki):
 *  - a folytatott fizetés (resume) NEM hoz létre rendelést, tehát nem számít;
 *  - a Barion által elutasított Start `payment_failed` rendelése NEM számít: a
 *    fizetés meg sem jött létre, és az ok nálunk van (konfiguráció);
 *  - a fizetett és visszatérített rendelés NEM számít;
 *  - a lezárt (`cancelled`) és a függő rendelés számít: ez a visszaélés nyoma
 *    (kifizetetlenül lejárt fizetések).
 */

/** Egy e-mail-címhez egyszerre legfeljebb ennyi befejezetlen, élő fizetés tartozhat. */
export const CHECKOUT_OPEN_ORDERS_PER_EMAIL_MAX = 3

/**
 * Vendég-pénztárban egy e-mail-címre óránként legfeljebb ennyi ÚJ, ki nem
 * fizetett rendelés indulhat. A brief kb. hármat javasolt; a legrosszabb
 * valódi eset (a Barion-oldalon megszakított fizetés kétszeri újrapróbálása és
 * egy számlázási adat javítása) négy rendelés egy órán belül, ezért öt. Ez a
 * korlátlanhoz képest címenként óránként öt Barion-fizetésre szorítja a
 * visszaélést, a valódi vevőt pedig nem fogja meg.
 */
export const CHECKOUT_GUEST_NEW_ORDERS_PER_EMAIL_PER_HOUR = 5
export const CHECKOUT_GUEST_NEW_ORDERS_WINDOW_MS = 60 * 60 * 1000

/**
 * Az új vendég-rendelések riasztási küszöbe tíz percre (az összes vevőre).
 * Nem tilt: egy hírlevél utáni valódi csúcs nem eshet ki miatta. A mai
 * forgalom napi néhány rendelés, tehát húsz tíz perc alatt ennek a
 * sokszorosa, és gépi rendelésgyártásra utal.
 */
export const CHECKOUT_GUEST_ORDER_BURST_THRESHOLD = 20
export const CHECKOUT_GUEST_ORDER_BURST_WINDOW_MS = 10 * 60 * 1000
export const CHECKOUT_GUEST_ORDER_BURST_ALERT_COOLDOWN_MS = 60 * 60 * 1000

/**
 * A vevő szövegei. Nem hibáztatnak, megmondják, mit tehet és mikor, és
 * elérhetőséget adnak (NN/g, Error-Message Guidelines: „offer some potential
 * remedies", https://www.nngroup.com/articles/error-message-guidelines/ ;
 * GOV.UK, There is a problem with the service: mondd meg, mikor próbálkozhat
 * újra, és hová fordulhat,
 * https://design-system.service.gov.uk/patterns/problem-with-the-service-pages/).
 * A cím a K14 szerinti egyetlen ügyfélszolgálati cím (contact-email.ts).
 */
export function checkoutOpenOrdersLimitMessage(minutesLeft: number): string {
  return (
    `Ehhez az e-mail-címhez már ${CHECKOUT_OPEN_ORDERS_PER_EMAIL_MAX} befejezetlen fizetés tartozik, ezért újat most nem indítunk. ` +
    'Ha valamelyiket folytatnád, nyisd meg újra annak a kurzusnak a pénztárát. ' +
    `Új fizetést ${minutesLeft} perc múlva indíthatsz. ` +
    `Ha segítség kell, írj nekünk az ${KAPCSOLATI_EMAIL_TARTALEK} címre.`
  )
}

export function checkoutGuestHourlyLimitMessage(minutesLeft: number): string {
  return (
    'Ezzel az e-mail-címmel az elmúlt órában már többször elindítottad a fizetést, ezért újat most nem indítunk. ' +
    `Új fizetést ${minutesLeft} perc múlva indíthatsz. ` +
    `Ha addig segítség kell, írj nekünk az ${KAPCSOLATI_EMAIL_TARTALEK} címre.`
  )
}

export type OrderLimitVerdict =
  | { kind: 'ok' }
  | { kind: 'open-orders'; status: 409; message: string }
  | { kind: 'guest-hourly'; status: 429; message: string }

interface CountedOrders {
  totalDocs: number
  /** A `limit`-edik legújabb rendelés létrehozási ideje (ha van annyi). */
  limitthCreatedAt: string | null
}

async function countRecentOrders(
  payload: Payload,
  where: Record<string, unknown>,
  limit: number,
): Promise<CountedOrders> {
  const result = await payload.find({
    collection: 'orders',
    where,
    sort: '-createdAt',
    limit,
    depth: 0,
    overrideAccess: true,
  } as unknown as Parameters<Payload['find']>[0])
  const docs = result.docs as Array<{ createdAt?: unknown }>
  const limitth = docs[limit - 1]
  return {
    totalDocs: typeof result.totalDocs === 'number' ? result.totalDocs : docs.length,
    limitthCreatedAt: typeof limitth?.createdAt === 'string' ? limitth.createdAt : null,
  }
}

/**
 * A két vevőoldali korlát. A hívó a pénztár-zárban, a duplavásárlás-döntés
 * UTÁN hívja (az ugyanarra a kurzusra szóló, lejárt függő sort addigra
 * lezárta), közvetlenül a rendelés létrehozása előtt.
 *
 * - Nyitott fizetések (mindenkinek, e-mail szerint): `payment_pending` a
 *   fizetési ablakon belül. Az ablakon túli függő sor már nem fizethető, azt
 *   az order-poll zárja le; nem tarthatja fogva a vevőt.
 * - Óránkénti új rendelés (csak vendégnek): a fenti mérce szerint.
 *
 * A várakozási idő az a pillanat, amikor a korlátba beleszámító
 * `limit`-edik legújabb rendelés kicsúszik az ablakból.
 */
export async function checkOrderLimits(input: {
  payload: Payload
  email: string
  guest: boolean
  nowMs: number
  paymentWindowMs: number
  log: Logger
}): Promise<OrderLimitVerdict> {
  const { payload, email, nowMs, log } = input

  const open = await countRecentOrders(
    payload,
    {
      and: [
        { customerEmail: { equals: email } },
        { status: { equals: 'payment_pending' } },
        { createdAt: { greater_than: new Date(nowMs - input.paymentWindowMs).toISOString() } },
      ],
    },
    CHECKOUT_OPEN_ORDERS_PER_EMAIL_MAX,
  )
  if (open.totalDocs >= CHECKOUT_OPEN_ORDERS_PER_EMAIL_MAX) {
    const minutesLeft = minutesLeftInWindow(open.limitthCreatedAt, nowMs, input.paymentWindowMs)
    log.warn('checkout-start: túl sok befejezetlen fizetés ugyanarra az e-mailre — új nem indul', {
      email: maskEmail(email),
      openOrders: open.totalDocs,
      limit: CHECKOUT_OPEN_ORDERS_PER_EMAIL_MAX,
      guest: input.guest,
      reason: 'open-orders-limit',
    })
    return {
      kind: 'open-orders',
      status: 409,
      message: checkoutOpenOrdersLimitMessage(minutesLeft),
    }
  }

  if (!input.guest) {
    return { kind: 'ok' }
  }

  const recent = await countRecentOrders(
    payload,
    {
      and: [
        { customerEmail: { equals: email } },
        { status: { in: ['created', 'payment_pending', 'cancelled'] } },
        {
          createdAt: {
            greater_than: new Date(nowMs - CHECKOUT_GUEST_NEW_ORDERS_WINDOW_MS).toISOString(),
          },
        },
      ],
    },
    CHECKOUT_GUEST_NEW_ORDERS_PER_EMAIL_PER_HOUR,
  )
  if (recent.totalDocs >= CHECKOUT_GUEST_NEW_ORDERS_PER_EMAIL_PER_HOUR) {
    const minutesLeft = minutesLeftInWindow(
      recent.limitthCreatedAt,
      nowMs,
      CHECKOUT_GUEST_NEW_ORDERS_WINDOW_MS,
    )
    log.warn(
      'checkout-start: az e-mail-cím óránkénti vendég-rendeléskerete betelt — új nem indul',
      {
        email: maskEmail(email),
        recentOrders: recent.totalDocs,
        limit: CHECKOUT_GUEST_NEW_ORDERS_PER_EMAIL_PER_HOUR,
        reason: 'guest-hourly-limit',
      },
    )
    return {
      kind: 'guest-hourly',
      status: 429,
      message: checkoutGuestHourlyLimitMessage(minutesLeft),
    }
  }
  return { kind: 'ok' }
}

/**
 * Riasztás, ha tíz perc alatt a küszöbnél több új, fiókhoz nem kötött
 * (vendég-) rendelés jött létre. A pénztár a vendég-rendelés létrehozása után,
 * a záron kívül hívja; a hiba nem állíthatja meg a vásárlást (csak naplóz).
 */
export async function reportGuestOrderBurst(input: {
  payload: Payload
  nowMs: number
  log: Logger
}): Promise<void> {
  const { payload, nowMs, log } = input
  try {
    const result = await payload.find({
      collection: 'orders',
      where: {
        and: [
          { customer: { exists: false } },
          {
            createdAt: {
              greater_than: new Date(nowMs - CHECKOUT_GUEST_ORDER_BURST_WINDOW_MS).toISOString(),
            },
          },
        ],
      },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    } as unknown as Parameters<Payload['find']>[0])
    const count = typeof result.totalDocs === 'number' ? result.totalDocs : 0
    if (count <= CHECKOUT_GUEST_ORDER_BURST_THRESHOLD) {
      return
    }
    const context = {
      guestOrdersInWindow: count,
      threshold: CHECKOUT_GUEST_ORDER_BURST_THRESHOLD,
      windowMinutes: CHECKOUT_GUEST_ORDER_BURST_WINDOW_MS / 60_000,
    }
    if (
      shouldEmitThrottledAlert(
        'checkout-guest-order-burst',
        CHECKOUT_GUEST_ORDER_BURST_ALERT_COOLDOWN_MS,
        nowMs,
      )
    ) {
      log.error(
        'RIASZTÁS: szokatlanul sok új vendég-rendelés tíz perc alatt — gépi rendelésgyártás vagy kártyatesztelés gyanúja. ' +
          'Nézd meg az adminban a legutóbbi függő rendeléseket (e-mail-címek, IP-címek).',
        context,
      )
    } else {
      log.warn('checkout-start: továbbra is sok új vendég-rendelés (a riasztás fojtva)', context)
    }
  } catch (error) {
    log.warn('checkout-start: a vendég-rendelések számlálása sikertelen (a vásárlás folytatódik)', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
