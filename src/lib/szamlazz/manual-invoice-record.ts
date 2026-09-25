import type { Payload } from 'payload'

import type { Order } from '../../payload-types'
import { withAdvisoryLock } from '../advisory-lock'
import { auditLogStore, writeAuditLog } from '../audit'
import { budapestDateString, isIsoDateString } from '../date/budapest'
import { logger as rootLogger, type Logger } from '../logger'

/**
 * Kézzel kiállított számla számának rögzítése egy 'failed' számlájú
 * rendelésen (W1B-3, W1B-7; a tulajdonosi admin-művelet később a w2 H2).
 *
 * Miért kell: a K12 kapu (src/lib/refund/invoice-gate.ts) a tulajdonosi
 * visszatérítést csak kiállított számla után engedi. Ha a számla automatikus
 * kiállítása 'failed' lett (végleges Számlázz.hu-elutasítás, kimerült
 * kísérletek, INVOICE_AUTOMATION_STOPPED), a tulajdonos a 05-ös útmutató
 * szerint kézzel állítja ki a számlát a Számlázz.hu-ban. A rendelés számlázási
 * mezői rendszer-írásúak (access/system-written.ts), ezért a számot az
 * üzemeltető ezzel a modullal rögzíti (`npm run record:manual-invoice`). Az
 * 'issued' állapot után a kapu magától kinyílik, és a szokásos visszatérítés a
 * valódi számlához készít stornót vagy helyesbítőt.
 *
 * Amit szándékosan NEM tesz:
 * - a 'failed' állapotot nem állítja vissza 'pending'-re: a leállt vagy kézzel
 *   pótolt számla mellé egy újabb automatikus beküldés dupla NAV-számla lenne
 *   (invoice.ts, INVOICE_AUTOMATION_STOPPED);
 * - az `invoiceLastError`-t nem törli: a sikertelenség oka a rendelésen
 *   látható marad;
 * - 'none', 'pending' vagy már kiállított számlájú rendelésen nem ír: ott a
 *   számlajob még dolgozhat, vagy már van szám, és egy második szám kettős
 *   számlát jelentene.
 *
 * Párhuzamosság: az írás ugyanazon az advisory-záron fut, mint a számla
 * kiállítása (`invoice:<orderId>`, invoice.ts issueInvoiceForOrder). A két
 * kulcsnak EGYEZNIE KELL; ezt teszt őrzi
 * (src/__tests__/szamlazz/w1b-r1-2-manual-invoice-record.test.ts). A zár alatt
 * a rendelés újraolvasva megy át minden feltételen, így egy közben lefutó
 * számlajob vagy egy második futtatás nem ír felül semmit. A zár után egy még
 * sorban álló számlajob az 'issued' állapotot látja, és no-op marad
 * (invoice.ts: „már kiállították a számlát”).
 */

export const MANUAL_INVOICE_RECORD_AUDIT_ACTION = 'invoice-manual-record'

/** A rögzíthető számlaszám felső hossza (a Számlázz.hu sorszámai ennél jóval rövidebbek). */
export const MANUAL_INVOICE_NUMBER_MAX_LENGTH = 64

/** A futást végző eszköz a műveletnapló `recordedBy` mezőjében (CLI-ből nincs bejelentkezett felhasználó). */
export const MANUAL_INVOICE_RECORDED_BY = 'script:record-manual-invoice'

/** Az advisory-zár kulcsa: SZÓ SZERINT ugyanaz, mint az invoice.ts issueInvoiceForOrder kulcsa. */
export function invoiceIssueLockKey(orderId: number): string {
  return `invoice:${orderId}`
}

export interface RecordManualInvoiceInput {
  payload: Payload
  orderNumber: string
  invoiceNumber: string
  /** A kézi számla teljesítési dátuma (YYYY-MM-DD), ha ismert. */
  completionDate?: string
  /** Igaz: csak kiírja, mit tenne; semmit nem ír. */
  dryRun: boolean
  /** A beállított számlaszám-előtag (SZAMLAZZ_INVOICE_PREFIX); eltérésnél figyelmeztet. */
  invoicePrefix?: string
  logger?: Logger
}

export interface ManualInvoiceOrderState {
  status: string | null
  invoiceStatus: string | null
  invoiceNumber: string | null
  invoiceCompletionDate: string | null
  invoiceLastError: string | null
}

export type RecordManualInvoiceResult =
  | {
      status: 'refused'
      reasons: string[]
      warnings: string[]
    }
  | {
      status: 'dry-run' | 'recorded'
      orderId: number
      orderNumber: string
      invoiceNumber: string
      completionDate: string | null
      before: ManualInvoiceOrderState
      warnings: string[]
      /** Csak 'recorded' esetén értelmes: bekerült-e a műveletnaplóba. */
      auditRecorded: boolean
    }

function orderState(order: Order): ManualInvoiceOrderState {
  return {
    status: order.status ?? null,
    invoiceStatus: order.invoiceStatus ?? null,
    invoiceNumber: order.invoiceNumber ?? null,
    invoiceCompletionDate: order.invoiceCompletionDate ?? null,
    invoiceLastError: order.invoiceLastError ?? null,
  }
}

/** Szóköz, sortörés és vezérlőkarakter nélküli, nyomtatható szöveg. */
const PRINTABLE_TOKEN = /^[^\s\p{C}]+$/u

/** A bemenet ellenőrzése adatbázis nélkül: a hibák listája (üres, ha rendben). */
export function validateManualInvoiceInput(input: {
  invoiceNumber: string
  completionDate?: string
}): string[] {
  const reasons: string[] = []
  const number = input.invoiceNumber.trim()
  if (number.length === 0) {
    reasons.push('A számla száma üres. Add meg a kézzel kiállított számla sorszámát.')
  } else {
    if (number.length > MANUAL_INVOICE_NUMBER_MAX_LENGTH) {
      reasons.push(
        `A számla száma túl hosszú (${String(number.length)} karakter, legfeljebb ${String(MANUAL_INVOICE_NUMBER_MAX_LENGTH)}). Ellenőrizd, hogy csak a sorszámot adtad-e meg.`,
      )
    }
    if (!PRINTABLE_TOKEN.test(number)) {
      reasons.push(
        'A számla számában szóköz vagy nem nyomtatható karakter van. Másold ki pontosan a Számlázz.hu-ból a sorszámot.',
      )
    }
  }
  if (input.completionDate !== undefined) {
    const date = input.completionDate.trim()
    if (!isIsoDateString(date)) {
      reasons.push(
        `A teljesítés dátuma nem ÉÉÉÉ-HH-NN alakú valós dátum (${date}). Például: 2026-09-24.`,
      )
    } else if (date > budapestDateString()) {
      reasons.push(
        `A teljesítés dátuma a jövőben van (${date}). A kézi számla teljesítési dátumát add meg.`,
      )
    }
  }
  return reasons
}

/** Eltér-e a szám a beállított előtagtól (a Számlázz.hu sorszáma pl. „E-KIN-2026-12”). */
function lacksPrefix(invoiceNumber: string, prefix: string | undefined): boolean {
  const wanted = prefix?.trim() ?? ''
  if (wanted === '') return false
  return !invoiceNumber.split('-').includes(wanted)
}

/** Az állapot-feltételek a zár alatt újraolvasott rendelésen. */
function orderReasons(order: Order): string[] {
  const reasons: string[] = []
  if (order.status === 'refunded') {
    reasons.push(
      'A rendelés már visszatérített. Visszatérített rendelésen a számla rögzítése külön döntést igényel (stornó is kell hozzá), ezt ez az eszköz nem végzi. Jelezd a fejlesztőnek.',
    )
  } else if (order.status !== 'paid') {
    reasons.push(
      `A rendelés nem fizetett állapotú (${order.status ?? 'ismeretlen'}), ezért számla sem rögzíthető rajta.`,
    )
  }
  const existing = order.invoiceNumber?.trim() ?? ''
  if (existing.length > 0) {
    reasons.push(
      `A rendelésen már áll számlaszám (${existing}). Második számot nem rögzítünk, mert az kettős számlát jelentene.`,
    )
  }
  switch (order.invoiceStatus) {
    case 'failed':
      break
    case 'issued':
      reasons.push('A rendelés számlája már kiállított állapotú, nincs mit rögzíteni.')
      break
    case 'pending':
      reasons.push(
        'A számla automatikus kiállítása még folyamatban van. Várd meg, amíg a számla elkészül vagy végleg sikertelen lesz; most egy kézi szám mellé a rendszer is kiállíthatna egy számlát.',
      )
      break
    default:
      reasons.push(
        'A rendelésnél a számla automatikus kiállítása el sem indult (vagy a számlázás ki van kapcsolva). Ilyenkor a rendszer még kiállíthatja a számlát, ezért kézi szám nem rögzíthető.',
      )
  }
  return reasons
}

/** Másik rendelés hordozza-e már ezt a számot (számla, stornó vagy helyesbítő). */
async function numberUsedElsewhere(
  payload: Payload,
  orderId: number,
  invoiceNumber: string,
): Promise<string[]> {
  const found = await payload.find({
    collection: 'orders',
    where: {
      and: [
        { id: { not_equals: orderId } },
        {
          or: [
            { invoiceNumber: { equals: invoiceNumber } },
            { stornoNumber: { equals: invoiceNumber } },
            { correctiveInvoiceNumber: { equals: invoiceNumber } },
          ],
        },
      ],
    },
    depth: 0,
    limit: 5,
    overrideAccess: true,
  })
  return found.docs
    .filter((doc) => doc.id !== orderId)
    .map((doc) => doc.orderNumber ?? `#${String(doc.id)}`)
}

async function findSingleOrder(
  payload: Payload,
  orderNumber: string,
): Promise<{ order: Order } | { reason: string }> {
  const found = await payload.find({
    collection: 'orders',
    where: { orderNumber: { equals: orderNumber } },
    depth: 0,
    limit: 2,
    overrideAccess: true,
  })
  const matches = found.docs.filter((doc) => doc.orderNumber === orderNumber)
  if (matches.length === 0 || found.totalDocs === 0) {
    return { reason: `Nincs ${orderNumber} rendelésszámú rendelés.` }
  }
  if (matches.length > 1 || found.totalDocs > 1) {
    return {
      reason: `Több rendelés is ${orderNumber} rendelésszámú. Ilyenkor nem rögzítünk semmit; jelezd a fejlesztőnek.`,
    }
  }
  return { order: matches[0] as Order }
}

/**
 * A kézi számlaszám rögzítése. Próbafutásban (`dryRun`) csak kiértékel;
 * éles futásban a zár alatt újraolvasott rendelésen ír, és egy
 * műveletnapló-sort hagy. Sosem ír, ha bármelyik feltétel nem teljesül.
 */
export async function recordManualInvoiceNumber(
  input: RecordManualInvoiceInput,
): Promise<RecordManualInvoiceResult> {
  const orderNumber = input.orderNumber.trim()
  const invoiceNumber = input.invoiceNumber.trim()
  const completionDate = input.completionDate?.trim() || null
  const log = (input.logger ?? rootLogger).child({
    module: 'manual-invoice-record',
    orderNumber,
    invoiceNumber,
  })

  const warnings: string[] = []
  if (invoiceNumber.length > 0 && lacksPrefix(invoiceNumber, input.invoicePrefix)) {
    warnings.push(
      `A számla száma nem a beállított „${input.invoicePrefix ?? ''}” előtaggal szerepel. Ellenőrizd, hogy valóban ennek a rendelésnek a Kineticare-számláját adtad-e meg.`,
    )
  }
  if (completionDate === null) {
    warnings.push(
      'Teljesítési dátum nélkül a helyesbítő számla a kiállítás napját kapja, és az alanyi adómentességi keret számlálója nem veszi figyelembe ezt a számlát. Ha tudod, add meg a --teljesites kapcsolóval.',
    )
  }

  const inputReasons = validateManualInvoiceInput({
    invoiceNumber,
    ...(input.completionDate !== undefined ? { completionDate: input.completionDate } : {}),
  })
  if (orderNumber.length === 0) inputReasons.unshift('A rendelésszám üres.')
  if (orderNumber.length === 0) return { status: 'refused', reasons: inputReasons, warnings }

  const lookup = await findSingleOrder(input.payload, orderNumber)
  if ('reason' in lookup) {
    return { status: 'refused', reasons: [...inputReasons, lookup.reason], warnings }
  }
  const orderId = lookup.order.id

  return withAdvisoryLock(
    input.payload,
    invoiceIssueLockKey(orderId),
    async (): Promise<RecordManualInvoiceResult> => {
      // A zár alatt újraolvasva: a próbafutás és az éles futás között (vagy
      // egy közben lefutó számlajob után) a rendelés megváltozhatott.
      const order = (await input.payload.findByID({
        collection: 'orders',
        id: orderId,
        depth: 0,
        overrideAccess: true,
      })) as Order | null
      if (!order || order.orderNumber !== orderNumber) {
        return {
          status: 'refused',
          reasons: [...inputReasons, `Nincs ${orderNumber} rendelésszámú rendelés.`],
          warnings,
        }
      }
      const reasons = [...inputReasons, ...orderReasons(order)]
      if (invoiceNumber.length > 0) {
        const others = await numberUsedElsewhere(input.payload, order.id, invoiceNumber)
        if (others.length > 0) {
          reasons.push(
            `Ez a számlaszám már egy másik rendelésen áll (${others.join(', ')}). Egy számla csak egy rendeléshez tartozhat; ellenőrizd a számot.`,
          )
        }
      }
      if (reasons.length > 0) {
        log.warn('kézi számlaszám rögzítése elutasítva', { reasonCount: reasons.length })
        return { status: 'refused', reasons, warnings }
      }

      const before = orderState(order)
      if (input.dryRun) {
        return {
          status: 'dry-run',
          orderId: order.id,
          orderNumber,
          invoiceNumber,
          completionDate,
          before,
          warnings,
          auditRecorded: false,
        }
      }

      const updated = (await input.payload.update({
        collection: 'orders',
        id: order.id,
        data: {
          invoiceStatus: 'issued',
          invoiceNumber,
          ...(completionDate !== null ? { invoiceCompletionDate: completionDate } : {}),
        },
        depth: 0,
        overrideAccess: true,
      })) as Order
      if (updated.invoiceStatus !== 'issued' || updated.invoiceNumber !== invoiceNumber) {
        throw new Error(
          `A rendelés mentése után a számla állapota nem a várt (${String(updated.invoiceStatus)}); a rögzítés nem biztos, nézd meg a rendelést.`,
        )
      }
      log.info('kézzel kiállított számla száma rögzítve a rendelésen', {
        orderId: order.id,
        completionDate,
      })

      const auditRecorded = await writeAuditLog({
        store: auditLogStore(input.payload),
        actor: null,
        action: MANUAL_INVOICE_RECORD_AUDIT_ACTION,
        entityType: 'orders',
        entityId: order.id,
        before: {
          invoiceStatus: before.invoiceStatus,
          invoiceNumber: before.invoiceNumber,
          invoiceCompletionDate: before.invoiceCompletionDate,
          invoiceLastError: before.invoiceLastError,
        },
        after: {
          version: 1,
          orderId: order.id,
          orderNumber,
          invoiceStatus: 'issued',
          invoiceNumber,
          invoiceCompletionDate: completionDate,
          recordedBy: MANUAL_INVOICE_RECORDED_BY,
          recordedAt: new Date().toISOString(),
        },
      })
      if (!auditRecorded) {
        log.error(
          'a kézi számlaszám rögzítve, de a műveletnaplóba nem került be; a futás kimenetét őrizd meg bizonyítéknak',
          { orderId: order.id },
        )
      }
      return {
        status: 'recorded',
        orderId: order.id,
        orderNumber,
        invoiceNumber,
        completionDate,
        before,
        warnings,
        auditRecorded,
      }
    },
    log,
  )
}
