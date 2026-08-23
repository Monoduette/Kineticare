/**
 * Manuális vásárlás-hozzáadás (kurzus-hozzáférés adása) — adminisztrátori script.
 *
 * Mikor kell: elhibázott fizetés utáni jóváírás, ajándék kurzus, migrációs
 * esetek — amikor a vevőnek a normál checkout-folyamaton kívül, kézzel kell
 * hozzáférést adni egy termékhez. Közvetlen adatbázis-írás helyett ez a
 * script a Payload LOCAL API-t használja (ugyanaz a users.purchases-beírás,
 * mint amit a fizetésjóváhagyás csinál — lásd
 * src/lib/order-status/apply-barion-state.ts grantPurchases).
 *
 * Futtatás (a config a .env-ből tölti a DATABASE_URI-t / PAYLOAD_SECRET-et):
 *   npx tsx src/scripts/grant-purchase.ts --email=<vevő-email> --product=<sku-vagy-id> [--reason=<indoklás>]
 *
 * IDEMPOTENS: ha a vevő már rendelkezik a termékkel és a hozzáférés él, a
 * script „már megvan" üzenettel, 0-s kilépési kóddal leáll (NEM hiba). Ha a
 * termék megvan, de a hozzáférés lejárt, a script ajándékként megújítja
 * (accessGrants.grantedAt = most), 0-s kilépési kóddal — paid rendelés nélkül.
 *
 * Kilépési kódok:
 *   0 — siker (ajándék beírva, megújítva, VAGY már megvolt és él)
 *   1 — hiba (hiányzó/hibás argumentum, ismeretlen felhasználó vagy termék,
 *       adatbázis-hiba)
 *
 * A script NEM hoz létre felhasználót és NEM rendelést — kizárólag a
 * users.purchases mezőt egészíti ki (missing-only), overrideAccess-szel.
 *
 * A tényleges logika az src/lib/grant-purchase.ts-ben él (ugyanazt hívja az
 * admin felület POST /api/admin/grant-purchase végpontja is) — ez a fájl
 * vékony CLI-burkolat: argumentum-feldolgozás, magyar konzol-üzenetek és
 * kilépési kódok. A CLI viselkedése (argumentumok, kimenet, exit-kódok,
 * idempotencia) változatlan.
 */

import { getPayload } from 'payload'

import {
  grantPurchase as grantPurchaseService,
} from '../lib/grant-purchase'
import { createLogger } from '../lib/logger'
import config from '../payload.config'

const log = createLogger({ script: 'grant-purchase' })

interface CliArgs {
  email: string
  product: string
  reason?: string
}

function printUsage(): void {
  console.error(
    [
      'Használat:',
      '  npx tsx src/scripts/grant-purchase.ts --email=<vevő-email> --product=<sku-vagy-id> [--reason=<indoklás>]',
      '',
      'Argumentumok:',
      '  --email    (kötelező) A vevő regisztrált e-mail-címe (users kollekció).',
      '  --product  (kötelező) A termék sku-ja VAGY numerikus adatbázis-id-je (products kollekció).',
      '  --reason   (opcionális) Indoklás — bekerül a strukturált naplóba.',
      '',
      'Példa:',
      '  npx tsx src/scripts/grant-purchase.ts --email=vevo@example.hu --product=DEMO-KEZREHAB-001 --reason="elhibázott fizetés jóváírása"',
    ].join('\n'),
  )
}

/** process.argv-alapú arg-parse — külső arg-parser csomag nélkül. */
function parseArgs(argv: string[]): CliArgs | null {
  const parsed: Partial<Record<'email' | 'product' | 'reason', string>> = {}

  for (const raw of argv) {
    const match = /^--([a-z]+)=(.*)$/.exec(raw)
    if (!match) {
      console.error(`Hiba: érvénytelen argumentum: "${raw}" (a forma: --kulcs=érték).`)
      return null
    }
    const [, key, value] = match
    if (key !== 'email' && key !== 'product' && key !== 'reason') {
      console.error(`Hiba: ismeretlen argumentum: "--${key}".`)
      return null
    }
    if (value.trim().length === 0) {
      console.error(`Hiba: a "--${key}" argumentum értéke nem lehet üres.`)
      return null
    }
    parsed[key] = value
  }

  if (!parsed.email || !parsed.product) {
    console.error('Hiba: a --email és a --product argumentum kötelező.')
    return null
  }

  return {
    email: parsed.email,
    product: parsed.product,
    ...(parsed.reason !== undefined ? { reason: parsed.reason } : {}),
  }
}

async function grantPurchase(args: CliArgs): Promise<void> {
  const payload = await getPayload({ config })

  // A közös szolgáltatás végzi a feloldást, az idempotens írást és az
  // audit-naplózást; a CLI csak a kimenetet és a kilépési kódot képezi.
  const result = await grantPurchaseService({
    payload,
    email: args.email,
    productIdOrSku: args.product,
    ...(args.reason !== undefined ? { reason: args.reason } : {}),
    logger: log,
  })

  if (result.status === 'user-not-found') {
    throw new Error(
      `Nincs ilyen felhasználó: ${args.email}. A script nem hoz létre felhasználót — előbb regisztráltasd a vevőt.`,
    )
  }
  if (result.status === 'product-not-found') {
    throw new Error(
      result.productRefKind === 'id'
        ? `Nincs ilyen termék (id: ${result.productRef}). Ellenőrizd az azonosítót az admin felületen.`
        : `Nincs ilyen termék (sku: ${result.productRef}). Ellenőrizd a sku-t az admin felületen.`,
    )
  }
  if (result.status === 'already-had') {
    console.log(
      `Már megvan: ${args.email} már rendelkezik a(z) "${result.productLabel}" termékkel — nincs teendő.`,
    )
    return
  }

  console.log(
    `Kész: ${args.email} megkapta a(z) "${result.productLabel}" kurzust ajándékba (felhasználó #${result.userId}, termék #${result.productId}).`,
  )
}

const args = parseArgs(process.argv.slice(2))
if (!args) {
  printUsage()
  process.exit(1)
}

grantPurchase(args)
  .then(() => {
    process.exit(0)
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    log.error('manuális hozzáférés sikertelen', { error: message })
    console.error(`Hiba: ${message}`)
    process.exit(1)
  })
