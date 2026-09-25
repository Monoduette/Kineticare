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
 * MIT TARTALMAZ: minden rendelést, amely a hónapban jött létre, VAGY a
 * hónapban fizették ki, VAGY a hónapban kapott visszatérítést (teljeset vagy
 * részlegeset, akkor is, ha a rendelés egy korábbi hónapban jött létre). A
 * hónap végén létrehozott és a következő hónapban kifizetett rendelés ezért
 * mindkét hónap fájljában szerepel: a létrehozás hónapjában a létrehozás, a
 * fizetés hónapjában a Barion-tranzakció miatt (PR #305, Devin: augusztus 31.
 * 23:50-es rendelés, szeptember 1. 00:10-es fizetés). Oszlopok: rendelésszám,
 * létrehozás és fizetés ideje (Budapest), állapot, bruttó összeg,
 * számla/stornó/helyesbítő száma és állapota, teljesítési dátum, a HÓNAPBAN
 * visszatérített összeg és tételei (tételenként összeg és időpont, hogy
 * minden Barion-visszatérítés külön párosítható legyen), a hónap végéig
 * halmozott visszatérítés, Barion PaymentId. A fizetés ideje a hozzáférés-óra
 * (`users.accessGrants` `grantedAt`, `sourceOrder` = a rendelés); az orders
 * sémában nincs `paidAt`. Az `allapot` a futtatás pillanatának állapota.
 *
 * MIÉRT NEM ELÉG A `refundedAt`-re szűrni: a rendelés felső szintű
 * `refundedAt` mezőjét csak a TELJES visszatérítés írja (refund-recovery,
 * auto-refund-recovery); a részleges visszatérítés ideje kizárólag a
 * `refunds[].refundedAt` JSON-tételben él. Ezért a lekérdezés bővebb halmazt
 * kér (`updatedAt` >= a hónap eleje: a visszatérítési tételt író mentés a
 * tétel `refundedAt`-je után, ugyanazon a szerver-órán történik, a későbbi
 * mentések pedig csak növelik az `updatedAt`-et), és a pontos hónap-szűrés
 * JS-ben fut a `createdAt`, a `refundedAt` és minden `refunds[].refundedAt`
 * alapján.
 *
 * A FIZETÉS HÓNAPJA ugyanebből a bővebb halmazból jön: a paid-átmenet előbb a
 * hozzáférés-órát írja, UTÁNA menti a rendelést `status: paid`-dal
 * (src/lib/order-status/apply-barion-state.ts), így a rendelés `updatedAt`-je
 * sosem korábbi a `grantedAt`-nél. A fizetési időt ezért a TELJES jelölt-halmazra
 * lekérdezzük (kötegenként, nem rendelésenként), és a hónap-szűrés már ezzel
 * együtt fut. Ha a hozzáférés-óra írása elbukott (arról RIASZTÁS szól), a
 * fizetési idő ismeretlen, és a rendelés csak a létrehozás hónapjában jelenik
 * meg.
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
/** Egy fizetésiidő-lekérdezés legfeljebb ennyi rendelés-azonosítót kér. */
const FIZETES_KOTEG = 200

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
  'visszaterites_honapban_huf',
  'visszaterites_honapban_tetelei',
  'visszaterites_halmozott_huf',
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
  refundedAt?: string | null
  refunds?: unknown
  barionPaymentId?: string | null
}

export type CsvSor = Record<(typeof CSV_FEJLEC)[number], string>

/** A hónap határai UTC-ben: [kezdet, vég). */
export interface HonapHatarai {
  kezdet: Date
  veg: Date
}

/** A hónap (ÉÉÉÉ-HH) Budapest szerinti határai UTC-ben: [kezdet, vég). */
export function budapestHonapHatarai(honap: string): HonapHatarai {
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

/** Az időpont a [kezdet, vég) hónapba esik-e (érvénytelen vagy hiányzó idő: nem). */
function honapba(iso: unknown, { kezdet, veg }: HonapHatarai): boolean {
  const ms = typeof iso === 'string' ? Date.parse(iso) : Number.NaN
  return Number.isFinite(ms) && ms >= kezdet.getTime() && ms < veg.getTime()
}

/** A `refunds` JSON tételei (a nem objektum elemek kimaradnak). */
function visszateritesiTetelek(
  refunds: unknown,
): Array<{ amountHuf?: unknown; refundedAt?: unknown }> {
  if (!Array.isArray(refunds)) {
    return []
  }
  return refunds.filter(
    (entry): entry is { amountHuf?: unknown; refundedAt?: unknown } =>
      typeof entry === 'object' && entry !== null,
  )
}

/**
 * A hónap visszatérítései és a hónap végéig halmozott összeg. A korábbi
 * hónapok visszatérítése csak a halmozottba számít, a hónap utáni egyikbe
 * sem. A dátum nélküli tétel (az éles út mindig ír dátumot) a halmozottba
 * kerül, hogy a pénzmozgás ne tűnjön el a fájlból. A hónap tételei egyenként,
 * összeggel is megjelennek: egy rendelés több visszatérítése több
 * Barion-sort és több helyesbítőt ad, a havi összegből ezek nem párosíthatók.
 */
function visszateritesek(
  refunds: unknown,
  honap: HonapHatarai,
): { honapban: number; honapbanTetelek: string[]; halmozott: number } {
  let honapban = 0
  let halmozott = 0
  const honapbanTetelek: string[] = []
  for (const { amountHuf, refundedAt } of visszateritesiTetelek(refunds)) {
    if (typeof amountHuf !== 'number' || !Number.isFinite(amountHuf) || amountHuf <= 0) {
      continue
    }
    const ms = typeof refundedAt === 'string' ? Date.parse(refundedAt) : Number.NaN
    if (Number.isFinite(ms) && ms >= honap.veg.getTime()) {
      continue
    }
    halmozott += amountHuf
    if (typeof refundedAt === 'string' && honapba(refundedAt, honap)) {
      honapban += amountHuf
      honapbanTetelek.push(`${String(amountHuf)} Ft (${budapestIdo(refundedAt)})`)
    }
  }
  return { honapban, honapbanTetelek, halmozott }
}

/**
 * A rendelés a hónapban jött létre, a hónapban fizették ki (`fizetveIso`, a
 * hozzáférés-óra ideje), vagy a hónapban kapott (bármilyen) visszatérítést.
 */
function honapbanErintett(
  order: ExportOrder,
  fizetveIso: string | undefined,
  honap: HonapHatarai,
): boolean {
  return (
    honapba(order.createdAt, honap) ||
    honapba(fizetveIso, honap) ||
    honapba(order.refundedAt, honap) ||
    visszateritesiTetelek(order.refunds).some((entry) => honapba(entry.refundedAt, honap))
  )
}

/** Egy rendelés CSV-sora. A `fizetve` a hozzáférés-óra ideje, ha ismert. */
export function exportSor(
  order: ExportOrder,
  fizetveIso: string | undefined,
  honap: HonapHatarai,
): CsvSor {
  const { honapban, honapbanTetelek, halmozott } = visszateritesek(order.refunds, honap)
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
    visszaterites_honapban_huf: honapban > 0 ? String(honapban) : '',
    visszaterites_honapban_tetelei: honapbanTetelek.join(' | '),
    visszaterites_halmozott_huf: halmozott > 0 ? String(halmozott) : '',
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
  refundedAt: true,
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
  throw new Error(
    `Több mint ${String(PAGE_SIZE * MAX_PAGES)} sor: az export lapozási korlátja betelt.`,
  )
}

/**
 * A rendelések fizetési ideje (a hozzáférés-órákból), `FIZETES_KOTEG`
 * azonosítónként egy lekérdezéssel. Ugyanaz a vevő több kötegben is
 * visszajöhet; a `fizetesiIdok` rendelésenként a legkorábbi időt tartja meg.
 */
async function jeloltekFizetesiIdeje(
  payload: Pick<Payload, 'find'>,
  ids: readonly number[],
): Promise<Map<number, string>> {
  const users: unknown[] = []
  for (let kezdo = 0; kezdo < ids.length; kezdo += FIZETES_KOTEG) {
    const koteg = ids.slice(kezdo, kezdo + FIZETES_KOTEG)
    users.push(
      ...(await osszesOldal<unknown>(
        (page) =>
          payload.find({
            collection: 'users',
            where: { 'accessGrants.sourceOrder': { in: koteg } },
            page,
            limit: PAGE_SIZE,
            depth: 0,
            select: { accessGrants: true },
            overrideAccess: true,
          } as unknown as Parameters<Payload['find']>[0]) as Promise<{
            docs: unknown[]
            hasNextPage?: boolean
          }>,
      )),
    )
  }
  return fizetesiIdok(users)
}

/** A hónap rendelései és a CSV. Csak `find`-et hív. */
export async function penzugyiExport(
  payload: Pick<Payload, 'find'>,
  honap: string,
): Promise<{ csv: string; sorok: number }> {
  const hatarok = budapestHonapHatarai(honap)
  const { kezdet, veg } = hatarok
  const idoszak = (mezo: string): Where => ({
    and: [
      { [mezo]: { greater_than_equal: kezdet.toISOString() } },
      { [mezo]: { less_than: veg.toISOString() } },
    ],
  })
  // Bővebb halmaz (lásd a fájl fejlécét): a részleges visszatérítés csak a
  // `refunds` JSON-ban él, arra SQL-szűrés nincs, de az írása az `updatedAt`-et
  // a tétel ideje fölé emeli. A pontos hónap-szűrés lent, JS-ben fut.
  const jeloltek = await osszesOldal<ExportOrder>(
    (page) =>
      payload.find({
        collection: 'orders',
        where: {
          or: [
            idoszak('createdAt'),
            idoszak('refundedAt'),
            { updatedAt: { greater_than_equal: kezdet.toISOString() } },
          ],
        },
        // Az id a holtversenyt dönti el, hogy a lapozás determinisztikus legyen.
        sort: ['createdAt', 'id'],
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
  const egyedi = new Map<number, ExportOrder>()
  for (const order of jeloltek) {
    if (!egyedi.has(order.id)) {
      egyedi.set(order.id, order)
    }
  }
  // A fizetési idő a szűrés RÉSZE (a hónapban fizetett rendelés bekerül), ezért
  // a teljes jelölt-halmazra kell, nem csak a már kiválasztott sorokra.
  const idok = await jeloltekFizetesiIdeje(payload, [...egyedi.keys()])
  const orders = [...egyedi.values()].filter((order) =>
    honapbanErintett(order, idok.get(order.id), hatarok),
  )
  const sorok = orders.map((order) => exportSor(order, idok.get(order.id), hatarok))
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
