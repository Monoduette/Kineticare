/**
 * CLI: kézzel kiállított számla számának rögzítése egy 'failed' számlájú
 * rendelésen (W1B-3; runbook: docs/uzemeltetes/05-szamla-storno-helyesbito-kezi.md).
 *
 *   npm run record:manual-invoice -- --order KH-2026-000123 --invoice E-KIN-2026-42 [--teljesites 2026-09-24]
 *     → próbafutás: kiírja, mit változtatna, és minden okot, amiért nem írna.
 *   OWNER_MANUAL_INVOICE_CONFIRM=igen npm run record:manual-invoice -- …
 *     → tényleges írás; a végén MANUAL_INVOICE_RECORD_OK.
 *
 * A szabályok és a zár: src/lib/szamlazz/manual-invoice-record.ts. A script
 * csak a kapcsolókat olvassa, a kaput kezeli és a kimenetet írja.
 */

import { pathToFileURL } from 'node:url'

import type { Payload } from 'payload'

import { createLogger, type Logger } from '../lib/logger'
import {
  recordManualInvoiceNumber,
  type RecordManualInvoiceResult,
} from '../lib/szamlazz/manual-invoice-record'

export const MANUAL_INVOICE_CONFIRM_ENV = 'OWNER_MANUAL_INVOICE_CONFIRM'

export interface ManualInvoiceArgs {
  order: string
  invoice: string
  teljesites?: string
}

const USAGE =
  'Használat: npm run record:manual-invoice -- --order <rendelésszám> --invoice <számlaszám> [--teljesites ÉÉÉÉ-HH-NN]'

type ArgKey = keyof ManualInvoiceArgs
const KEYS: readonly ArgKey[] = ['order', 'invoice', 'teljesites']

function isArgKey(value: string): value is ArgKey {
  return (KEYS as readonly string[]).includes(value)
}

/** `--kulcs érték` és `--kulcs=érték` alak; hiba esetén a magyar ok. */
export function parseManualInvoiceArgs(argv: readonly string[]): ManualInvoiceArgs | string {
  const parsed: Partial<Record<ArgKey, string>> = {}
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index] ?? ''
    const match = /^--([a-z]+)(?:=(.*))?$/.exec(raw)
    if (!match) return `Érvénytelen argumentum: ${raw}. ${USAGE}`
    const key = match[1] ?? ''
    if (!isArgKey(key)) return `Ismeretlen kapcsoló: --${key}. ${USAGE}`
    if (parsed[key] !== undefined) return `A --${key} kapcsoló kétszer szerepel.`
    let value = match[2]
    if (value === undefined) {
      value = argv[index + 1]
      index += 1
    }
    if (value === undefined || value.startsWith('--') || value.trim() === '') {
      return `A --${key} kapcsolóhoz érték kell. ${USAGE}`
    }
    parsed[key] = value
  }
  if (parsed.order === undefined || parsed.invoice === undefined) {
    return `A --order és az --invoice kötelező. ${USAGE}`
  }
  return {
    order: parsed.order,
    invoice: parsed.invoice,
    ...(parsed.teljesites !== undefined ? { teljesites: parsed.teljesites } : {}),
  }
}

export function isManualInvoiceConfirmed(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return env[MANUAL_INVOICE_CONFIRM_ENV]?.trim().toLowerCase() === 'igen'
}

/** A futás eredményének sorai az üzemeltetőnek. */
export function formatManualInvoiceReport(result: RecordManualInvoiceResult): string[] {
  const lines = result.warnings.map((warning) => `Figyelem: ${warning}`)
  if (result.status === 'refused') {
    lines.push('NEM rögzítettem semmit. Okok:')
    for (const reason of result.reasons) lines.push(`  - ${reason}`)
    return lines
  }
  const change = [
    `rendelés: ${result.orderNumber}`,
    `számla állapota: ${result.before.invoiceStatus ?? 'nincs'} → issued`,
    `számlaszám: ${result.before.invoiceNumber ?? 'nincs'} → ${result.invoiceNumber}`,
    `teljesítés: ${result.before.invoiceCompletionDate ?? 'nincs'} → ${result.completionDate ?? 'nincs megadva'}`,
    `a korábbi hiba szövege megmarad: ${result.before.invoiceLastError ?? 'nincs'}`,
  ]
  if (result.status === 'dry-run') {
    lines.push(
      `PRÓBAFUTÁS, semmi nem íródott. Íráshoz futtasd újra ${MANUAL_INVOICE_CONFIRM_ENV}=igen beállítással. Ezt változtatnám:`,
    )
  } else {
    lines.push('Rögzítve. A visszatérítés most már indítható a rendelés oldaláról.')
  }
  for (const item of change) lines.push(`  - ${item}`)
  if (result.status === 'recorded' && !result.auditRecorded) {
    lines.push(
      'Figyelem: a műveletnapló-sor nem jött létre. A rögzítés megtörtént; ezt a kimenetet őrizd meg bizonyítéknak, és szólj a fejlesztőnek.',
    )
  }
  return lines
}

/**
 * A CLI lépései a Payload-példány megszerzése után (a teszt ezt hívja a
 * valódi határon, a script-indítás nélkül). Visszatérés: a kilépési kód.
 */
export async function runRecordManualInvoice(options: {
  payload: Payload
  argv: readonly string[]
  env: Readonly<Record<string, string | undefined>>
  invoicePrefix?: string
  log: Logger
}): Promise<number> {
  const args = parseManualInvoiceArgs(options.argv)
  if (typeof args === 'string') {
    options.log.error(args)
    return 2
  }
  const dryRun = !isManualInvoiceConfirmed(options.env)
  options.log.info(
    dryRun
      ? `kézi számlaszám rögzítése: PRÓBAFUTÁS (${MANUAL_INVOICE_CONFIRM_ENV}=igen nélkül semmi nem íródik)`
      : `kézi számlaszám rögzítése: ÉLES futás (${MANUAL_INVOICE_CONFIRM_ENV}=igen)`,
  )
  const result = await recordManualInvoiceNumber({
    payload: options.payload,
    orderNumber: args.order,
    invoiceNumber: args.invoice,
    ...(args.teljesites !== undefined ? { completionDate: args.teljesites } : {}),
    dryRun,
    ...(options.invoicePrefix !== undefined ? { invoicePrefix: options.invoicePrefix } : {}),
    logger: options.log,
  })
  for (const line of formatManualInvoiceReport(result)) options.log.info(line)
  if (result.status === 'refused') return 1
  if (result.status === 'recorded') {
    if (!result.auditRecorded) return 1
    options.log.info('MANUAL_INVOICE_RECORD_OK')
  }
  return 0
}

async function main(): Promise<number> {
  const log = createLogger({ script: 'record-manual-invoice' })
  const [{ getPayload }, { default: config }, { getSzamlazzConfig }] = await Promise.all([
    import('payload'),
    import('../payload.config'),
    import('../lib/szamlazz/client'),
  ])
  let invoicePrefix: string | undefined
  try {
    invoicePrefix = getSzamlazzConfig().invoicePrefix
  } catch (error) {
    log.warn('a számlázási beállítás nem olvasható, az előtag-ellenőrzés kimarad', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
  const payload = await getPayload({ config })
  return runRecordManualInvoice({
    payload,
    argv: process.argv.slice(2),
    env: process.env,
    ...(invoicePrefix !== undefined ? { invoicePrefix } : {}),
    log,
  })
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      createLogger({ script: 'record-manual-invoice' }).error(
        'kézi számlaszám rögzítése: hiba történt, a rendelést nézd meg az adminban',
        { error: error instanceof Error ? error.message : String(error) },
      )
      process.exit(1)
    })
}
