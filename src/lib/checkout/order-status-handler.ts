import { type NextRequest, NextResponse } from 'next/server'
import type { Payload } from 'payload'

import { logger } from '../logger'
import { generateRequestId, getRequestId } from '../request-id'
import type { RefundIntent } from '../../payload-types'
import { isNeverPaidRefundCandidate } from '../refund/auto-refund-recovery'
import { readLatestAutomaticRefundBlock } from '../refund/automatic-block'
import { loadActiveRefundIntent, loadRefundIntentsForOrder } from '../refund/intent-store'

/**
 * GET /api/orders/[orderNumber]/status — read-only rendelés-státusz (a
 * köszönőoldal polljához, T-022 callback utáni visszaigazolás).
 *
 * Szabályok (kötöttek):
 * - bejelentkezés kötelező (payload.auth); anon → 401;
 * - CSAK a saját rendelés: a lekérdezés customer=user.id szűrővel történik —
 *   más orderNumber esetén 404 (ne szivárogjon ki, létezik-e a rendelés);
 * - CSAK a { status, productId, totalHufSnapshot, currency } és szükség esetén
 *   paymentReviewRequired:true mezők — a productId
 *   az ELSŐ tétel termék-id-je (null, ha nem feloldható): a köszönőoldal
 *   „Újrapróbálom" gombja ezzel tud a /penztar?termek={id} útvonalra mutatni.
 *   Nem érzékeny adat: a vásárló a SAJÁT rendelésének a termékét látja, amit a
 *   fiókja amúgy is megjelenít. Egyéb rendelésadat (customer, customerEmail,
 *   tételek, számlaadat, Barion-azonosítók) továbbra sem megy ki.
 *
 * `totalHufSnapshot` a köszönőoldal bevétel-méréséhez; csak saját rendelés (customer=user.id).
 */

/**
 * Nem-negatív, véges összeg vagy null. A 0 SZÁNDÉKOSAN érvényes: ingyenes
 * (0 Ft-os) rendelésnél a nulla a valódi bevétel, nem hiányzó adat.
 */
function readOrderTotal(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * A pénznem normalizálása (ISO-4217, nagybetűs) — ugyanaz a szabály, mint a
 * Barion-összevetésben (src/lib/order-status/apply-barion-state.ts).
 */
function readCurrency(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim().toUpperCase() : null
}

/** A paid-reject automatikus visszatérítés (rendszer-eredetű, V2) kísérlete. */
function isSystemRefundIntent(intent: RefundIntent | null | undefined): boolean {
  return intent?.schemaVersion === 2 && intent.actorKind === 'system'
}

export interface OrderStatusHandlerDeps {
  getPayload: () => Promise<Payload>
}

export function createOrderStatusHandler(
  deps: OrderStatusHandlerDeps,
): (
  request: NextRequest,
  context: { params: Promise<{ orderNumber: string }> },
) => Promise<NextResponse> {
  return async function GET(
    request: NextRequest,
    context: { params: Promise<{ orderNumber: string }> },
  ): Promise<NextResponse> {
    const requestId = getRequestId(request.headers) ?? generateRequestId()
    const log = logger.child({ requestId, route: 'order-status' })

    try {
      const payload = await deps.getPayload()

      const { user } = await payload.auth({ headers: request.headers })
      if (!user) {
        return NextResponse.json(
          { error: 'A rendelés állapotának lekérdezéséhez bejelentkezés szükséges.' },
          { status: 401 },
        )
      }

      const { orderNumber } = await context.params
      if (typeof orderNumber !== 'string' || orderNumber.trim().length === 0) {
        return NextResponse.json({ error: 'Hiányzó rendelésszám.' }, { status: 400 })
      }

      const { docs } = await payload.find({
        collection: 'orders',
        where: {
          and: [{ orderNumber: { equals: orderNumber.trim() } }, { customer: { equals: user.id } }],
        },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      })

      const order = docs[0]
      if (!order) {
        // 404 — nem áruljuk el, hogy a rendelés létezik-e máshol.
        return NextResponse.json({ error: 'A rendelés nem található.' }, { status: 404 })
      }

      // Az Újrapróbálom-útvonalhoz: az első tétel termék-id-je (a relationship
      // nyers id vagy populate-olt dokumentum lehet; feloldhatatlanul null).
      const firstProduct = Array.isArray(order.items) ? order.items[0]?.product : undefined
      const productId =
        typeof firstProduct === 'number'
          ? firstProduct
          : typeof firstProduct === 'object' && firstProduct !== null
            ? firstProduct.id
            : null

      // A végösszeg: elsődlegesen a megrendeléskori pillanatkép, tartalékként a
      // plugin `amount` mezője. Érvénytelen/hiányzó érték → null (lásd a fejlécet).
      const totalHufSnapshot =
        readOrderTotal(order.totalHufSnapshot) ?? readOrderTotal(order.amount)
      // Authentication and customer ownership precede this lookup. Storage uncertainty is an error,
      // never a false success; only a customer-facing flag crosses the response boundary.
      const activeRefund = await loadActiveRefundIntent(payload, order.id)
      // Két kísérlet között (pl. a Barion elutasította, a rendszer később
      // újrapróbálja) nincs aktív kísérlet, de a vásárló pénze még nincs
      // visszautalva: a köszönőoldal ilyenkor sem mutathat sima „függő” fizetést.
      // Ugyanez áll, ha az automatika már az első kísérlet előtt tartósan
      // leállt (automatic-block.ts: idegen visszatérítés, eltérő fizetés):
      // ilyenkor kísérlet nincs, csak a leállás-jelzés. Ezt csak akkor olvassuk,
      // ha a kísérletek már nem döntöttek (a köszönőoldal pollja olcsó marad).
      const paymentReviewRequired =
        isSystemRefundIntent(activeRefund) ||
        (isNeverPaidRefundCandidate(order) &&
          ((await loadRefundIntentsForOrder(payload, order.id)).some(
            (intent) => intent.state === 'provider_failed' && isSystemRefundIntent(intent),
          ) ||
            (await readLatestAutomaticRefundBlock(payload, order.id)) !== null))

      return NextResponse.json(
        {
          status: order.status,
          productId,
          totalHufSnapshot,
          currency: readCurrency(order.currency),
          ...(paymentReviewRequired ? { paymentReviewRequired: true } : {}),
        },
        { status: 200 },
      )
    } catch (error) {
      log.error('order-status: váratlan technikai hiba', {
        error: error instanceof Error ? error.message : String(error),
      })
      return NextResponse.json(
        {
          error:
            'A rendelés állapota most nem kérdezhető le. Frissítsd az oldalt néhány perc múlva.',
        },
        { status: 500 },
      )
    }
  }
}
