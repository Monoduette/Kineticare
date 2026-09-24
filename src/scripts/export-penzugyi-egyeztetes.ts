/**
 * CLI: pénzügyi egyeztető export a könyvelőnek (CSV, csak olvas).
 *
 *   npx tsx src/scripts/export-penzugyi-egyeztetes.ts
 *     → az előző naptári hónap (Budapest) rendelései.
 *   npx tsx src/scripts/export-penzugyi-egyeztetes.ts --honap 2026-09 --kimenet ./egyeztetes.csv
 *
 * MIÉRT (a-egyeztetes-9): a rendelés-listából nem állítható elő havi
 * könyvelői kimutatás (a számla-, stornó-, helyesbítő-szám és a Barion-
 * azonosító tulajdonosi olvasású, listás export nincs), a tulajdonos kézzel
 * másolt. Ez a szkript a havi háromutas egyeztetés (Barion-export ×
 * Számlázz.hu-export × rendelésszám) harmadik lábát adja; útmutató:
 * docs/uzemeltetes/08-havi-egyeztetes.md.
 *
 * MIT TARTALMAZ: minden rendelést, amely a hónapban jött létre VAGY a
 * hónapban kapott visszatérítést. Oszlopok: rendelésszám, létrehozás és
 * fizetés ideje (Budapest), állapot, bruttó összeg, számla/stornó/helyesbítő
 * száma és állapota, teljesítési dátum, visszatérítés összesen és dátumai,
 * Barion PaymentId. A fizetés ideje a hozzáférés-óra (`users.accessGrants`
 * `grantedAt`, `sourceOrder` = a rendelés); az orders sémában nincs `paidAt`.
 *
 * ADATVÉDELEM: vevőnév, e-mail, cím, IP NEM kerül a fájlba; a könyvelő a
 * rendelésszámmal párosít. A fájl mégis pénzügyi adat: ne küldd nyílt
 * csatornán, és a munka végén töröld a gépedről.
 *
 * CSAK OLVAS: kizárólag `payload.find` fut. A Payload indulásakor a meglévő
 * onInit-ellenőrzések lefutnak (a már meglévő űrlapokat nem módosítják). A
 * CSV fájlba megy, nem a stdoutra, mert a napló JSON-sorai is ott futnak.
 *
 * Formátum: pontosvessző-elválasztó és UTF-8 BOM, hogy a magyar Excel
 * közvetlenül megnyissa; a képletként értelmezhető cellát (= + - @ kezdet)
 * aposztróf előzi meg (OWASP, CSV Injection).
 */

import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { getPayload, type Payload, type Where } from 'payload'

import { budapestDateString, budapestDateTimeString } from '../lib/date/budapest'
import { createLogger } from '../lib/logger'

const log = createLogger({ script: 'export-penzugyi-egyeztetes' })

const PAGE_SIZE = 200
const MAX_PAGES = 100

export const CSV_FEJLEC = [
  'rendelesszam',
  'letrehozva_budapest',
  'fizetve_budapest',
  'allapot',
  'brutto_osszeg_huf',
  'szamla_szama',
  'szamla_allapota',
  'teljesites_datuma',
  'storno_szama',
  'storno_allapota',
  'helyesbito_szama',
  'helyesbito_allapota',
  'visszaterites_osszesen_huf',
  'visszaterites_datumai',
  'barion_payment_id',
] as const

/** A rendelés azon mezői, amelyeket az export olvas. */
export interface ExportOrder {
  id: number
  orderNumber?: string | null
  createdAt?: string | null
  status?: string | null
  totalHufSnapshot?: number | null
  invoiceNumber?: string | null
  invoiceStatus?: string | null
  invoiceCompletionDate?: string | null
  stornoNumber?: string | null
  stornoStatus?: string | null
  correctiveInvoiceNumber?: string | null
  correctiveInvoiceStatus?: string | null
  refunds?: unknown
  barionPaymentId?: string | null
}

export type CsvSor = Record<(typeof CSV_FEJLEC)[number], string>

/** A hónap (ÉÉÉÉ-HH) Budapest szerinti határai UTC-ben: [kezdet, vég). */
export function budapestHonapHatarai(honap: string): { kezdet: Date; veg: Date } {
  const match = /^(\d{4})-(\d{2})$/.exec(honap)
  const ev = Number(match?.[1])
  const ho = Number(match?.[2])
  if (match === null || ho < 1 || ho > 12) {
    throw new Error(`A hónap alakja ÉÉÉÉ-HH legyen (például 2026-09), ezt kaptam: ${honap}`)
  }
  const kovetkezoEv = ho === 12 ? ev + 1 : ev
  const kovetkezoHo = ho === 12 ? 1 : ho + 1
  return {
    kezdet: new Date(budapestEjfelUtcMs(ev, ho, 1)),
    veg: new Date(budapestEjfelUtcMs(kovetkezoEv, kovetkezoHo, 1)),
  }
}

/** A budapesti éjfél UTC-ideje (a hónap 1-je sosem óraátállítási nap). */
function budapestEjfelUtcMs(ev: number, ho: number, nap: number): number {
  const becsles = Date.UTC(ev, ho - 1, nap)
  const reszek = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Budapest',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(becsles))
  const resz = (tipus: string) => Number(reszek.find((item) => item.type === tipus)?.value ?? 0)
  const helyiMintUtc = Date.UTC(
    resz('year'),
    resz('month') - 1,
    resz('day'),
    resz('hour'),
    resz('minute'),
  )
  return becsles - (helyiMintUtc - becsles)
}

/** Az előző naptári hónap Budapest szerint (ÉÉÉÉ-HH). */
export function elozoHonap(most: Date): string {
  const [evResz, hoResz] = budapestDateString(most).split('-')
  const ev = Number(evResz)
  const ho = Number(hoResz)
  return ho === 1 ? `${String(ev - 1)}-12` : `${String(ev)}-${String(ho - 1).padStart(2, '0')}`
}

function budapestIdo(iso: string | null | undefined): string {
  if (typeof iso !== 'string' || iso.length === 0) {
    return ''
  }
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : budapestDateTimeString(date)
}

function visszateritesek(refunds: unknown): { osszeg: number; datumok: string[] } {
  if (!Array.isArray(refunds)) {
    return { osszeg: 0, datumok: [] }
  }
  let osszeg = 0
  const datumok: string[] = []
  for (const entry of refunds) {
    if (typeof entry !== 'object' || entry === null) {
      continue
    }
    const { amountHuf, refundedAt } = entry as { amountHuf?: unknown; refundedAt?: unknown }
    if (typeof amountHuf === 'number' && Number.isFinite(amountHuf) && amountHuf > 0) {
      osszeg += amountHuf
      if (typeof refundedAt === 'string') {
        datumok.push(budapestIdo(refundedAt))
      }
    }
  }
  return { osszeg, datumok }
}

/** Egy rendelés CSV-sora. A `fizetve` a hozzáférés-óra ideje, ha ismert. */
export function exportSor(order: ExportOrder, fizetveIso: string | undefined): CsvSor {
  const { osszeg, datumok } = visszateritesek(order.refunds)
  return {
    rendelesszam: order.orderNumber ?? `#${String(order.id)}`,
    letrehozva_budapest: budapestIdo(order.createdAt),
    fizetve_budapest: budapestIdo(fizetveIso),
    allapot: order.status ?? '',
    brutto_osszeg_huf:
      typeof order.totalHufSnapshot === 'number' ? String(order.totalHufSnapshot) : '',
    szamla_szama: order.invoiceNumber ?? '',
    szamla_allapota: order.invoiceStatus ?? '',
    teljesites_datuma: order.invoiceCompletionDate ?? '',
    storno_szama: order.stornoNumber ?? '',
    storno_allapota: order.stornoStatus ?? '',
    helyesbito_szama: order.correctiveInvoiceNumber ?? '',
    helyesbito_allapota: order.correctiveInvoiceStatus ?? '',
    visszaterites_osszesen_huf: osszeg > 0 ? String(osszeg) : '',
    visszaterites_datumai: datumok.join(' | '),
    barion_payment_id: order.barionPaymentId ?? '',
  }
}

/** Egy cella CSV-alakja: képlet-védelem, idézés, ha kell. */
export function csvCella(ertek: string): string {
  const vedett = /^[=+\-@\t\r]/.test(ertek) ? `'${ertek}` : ertek
  return /[";\n\r]/.test(vedett) ? `"${vedett.replace(/"/g, '""')}"` : vedett
}

/** A teljes CSV: BOM, fejléc, sorok, CRLF sorvég (RFC 4180). */
export function csvSzoveg(sorok: readonly CsvSor[]): string {
  const vonalak = [CSV_FEJLEC.join(';')]
  for (const sor of sorok) {
    vonalak.push(CSV_FEJLEC.map((oszlop) => csvCella(sor[oszlop])).join(';'))
  }
  return `﻿${vonalak.join('\r\n')}\r\n`
}

/** A hozzáférés-órák rendelésenként (a fizetés ideje): sourceOrder → grantedAt. */
export function fizetesiIdok(users: readonly unknown[]): Map<number, string> {
  const idok = new Map<number, string>()
  for (const user of users) {
    const grants = (user as { accessGrants?: unknown }).accessGrants
    if (!Array.isArray(grants)) {
      continue
    }
    for (const grant of grants) {
      const { sourceOrder, grantedAt } = grant as { sourceOrder?: unknown; grantedAt?: unknown }
      const orderId =
        typeof sourceOrder === 'number'
          ? sourceOrder
          : typeof sourceOrder === 'object' && sourceOrder !== null
            ? (sourceOrder as { id?: unknown }).id
            : undefined
      if (typeof orderId === 'number' && typeof grantedAt === 'string') {
        const korabbi = idok.get(orderId)
        if (korabbi === undefined || grantedAt < korabbi) {
          idok.set(orderId, grantedAt)
        }
      }
    }
  }
  return idok
}

const ORDER_SELECT = {
  orderNumber: true,
  createdAt: true,
  status: true,
  totalHufSnapshot: true,
  invoiceNumber: true,
  invoiceStatus: true,
  invoiceCompletionDate: true,
  stornoNumber: true,
  stornoStatus: true,
  correctiveInvoiceNumber: true,
  correctiveInvoiceStatus: true,
  refunds: true,
  barionPaymentId: true,
} as const

async function osszesOldal<T>(
  lekerdezes: (page: number) => Promise<{ docs: unknown[]; hasNextPage?: boolean }>,
): Promise<T[]> {
  const eredmeny: T[] = []
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const oldal = await lekerdezes(page)
    eredmeny.push(...(oldal.docs as T[]))
    if (oldal.hasNextPage !== true) {
      return eredmeny
    }
  }
  throw new Error(`Több mint ${String(PAGE_SIZE * MAX_PAGES)} sor: szűkítsd a hónapot.`)
}

/** A hónap rendelései és a CSV. Csak `find`-et hív. */
export async function penzugyiExport(
  payload: Pick<Payload, 'find'>,
  honap: string,
): Promise<{ csv: string; sorok: number }> {
  const { kezdet, veg } = budapestHonapHatarai(honap)
  const idoszak = (mezo: string): Where => ({
    and: [
      { [mezo]: { greater_than_equal: kezdet.toISOString() } },
      { [mezo]: { less_than: veg.toISOString() } },
    ],
  })
  const orders = await osszesOldal<ExportOrder>(
    (page) =>
      payload.find({
        collection: 'orders',
        where: { or: [idoszak('createdAt'), idoszak('refundedAt')] },
        sort: 'createdAt',
        page,
        limit: PAGE_SIZE,
        depth: 0,
        select: ORDER_SELECT,
        overrideAccess: true,
      } as unknown as Parameters<Payload['find']>[0]) as Promise<{
        docs: unknown[]
        hasNextPage?: boolean
      }>,
  )
  const ids = orders.map((order) => order.id)
  const users =
    ids.length === 0
      ? []
      : await osszesOldal<unknown>(
          (page) =>
            payload.find({
              collection: 'users',
              where: { 'accessGrants.sourceOrder': { in: ids } },
              page,
              limit: PAGE_SIZE,
              depth: 0,
              select: { accessGrants: true },
              overrideAccess: true,
            } as unknown as Parameters<Payload['find']>[0]) as Promise<{
              docs: unknown[]
              hasNextPage?: boolean
            }>,
        )
  const idok = fizetesiIdok(users)
  const sorok = orders.map((order) => exportSor(order, idok.get(order.id)))
  return { csv: csvSzoveg(sorok), sorok: sorok.length }
}

function kapcsolo(nev: string, args: readonly string[]): string | undefined {
  const index = args.indexOf(nev)
  if (index >= 0) {
    return args[index + 1]
  }
  const egyben = args.find((arg) => arg.startsWith(`${nev}=`))
  return egyben?.slice(nev.length + 1)
}

async function futtat(): Promise<void> {
  const args = process.argv.slice(2)
  const honap = kapcsolo('--honap', args) ?? elozoHonap(new Date())
  const kimenet = resolve(kapcsolo('--kimenet', args) ?? `penzugyi-egyeztetes-${honap}.csv`)
  budapestHonapHatarai(honap)

  const { default: config } = await import('../payload.config')
  const payload = await getPayload({ config })
  const { csv, sorok } = await penzugyiExport(payload, honap)
  await writeFile(kimenet, csv, { encoding: 'utf8', mode: 0o600 })
  log.info('pénzügyi egyeztető export kész', { honap, sorok, kimenet })
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  futtat()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      log.error('pénzügyi egyeztető export: hiba történt', {
        error: error instanceof Error ? error.message : String(error),
      })
      process.exit(1)
    })
}
