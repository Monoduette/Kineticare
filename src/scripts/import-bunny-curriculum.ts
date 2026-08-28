/**
 * A Bunny KINETICARE tár videóit a kurzus Tananyag (modulok) mezőjébe írja.
 *
 * Alapból próbafutás. Íráshoz:
 *   OWNER_BUNNY_CURRICULUM_CONFIRM=igen npm run import:bunny-curriculum -- --alkalmaz
 *
 * Üres tananyagra ír. Ha a modulok MÁR a terv GUID-jait tartalmazzák, kihagyja.
 * Ha más szerkesztői tananyag van (publikált VAGY piszkozat), megáll:
 * a lecke-id csseréje nullázná a vevők haladását.
 */

import { pathToFileURL } from 'node:url'

import { getPayload, type Payload } from 'payload'

import {
  modulesMatchPlan,
  planForSku,
  plannedStreamAssetIds,
  BUNNY_CURRICULUM_PLANS,
  type BunnyCurriculumPlan,
} from '../lib/curriculum/bunny-keszlet'
import { logger } from '../lib/logger'
import config from '../payload.config'
import type { Product } from '../payload-types'

export const OWNER_BUNNY_CURRICULUM_CONFIRM = 'OWNER_BUNNY_CURRICULUM_CONFIRM'

export interface ImportKapcsolok {
  alkalmaz: boolean
  felulir: boolean
}

export function parseImportKapcsolok(argv: readonly string[]): ImportKapcsolok {
  return {
    alkalmaz: argv.includes('--alkalmaz'),
    felulir: argv.includes('--felulir'),
  }
}

export function confirmEnabled(envValue: string | undefined): boolean {
  return envValue?.trim() === 'igen'
}

function modulok(product: Pick<Product, 'modules'> | null | undefined): unknown {
  return Array.isArray(product?.modules) ? product.modules : []
}

async function keresdKurzust(payload: Payload, sku: string): Promise<Product | null> {
  const talalat = await payload.find({
    collection: 'products',
    where: { sku: { equals: sku } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return talalat.docs[0] ?? null
}

function vanFrissebbPiszkozat(publikalt: Product, piszkozat: Product | null): boolean {
  if (piszkozat === null) {
    return false
  }
  const pub = typeof publikalt.updatedAt === 'string' ? publikalt.updatedAt : null
  const draft = typeof piszkozat.updatedAt === 'string' ? piszkozat.updatedAt : null
  return pub !== null && draft !== null && draft > pub
}

export type ImportDontes =
  | { kind: 'hianyzik'; sku: string }
  | { kind: 'kesz'; sku: string; productId: number; leckek: number }
  | { kind: 'piszkozat'; sku: string; productId: number }
  | { kind: 'szerkesztett'; sku: string; productId: number; leckek: number }
  | { kind: 'irhato'; sku: string; productId: number; plan: BunnyCurriculumPlan }

export function dontesKurzusra(input: {
  sku: string
  publikalt: Product | null
  piszkozat: Product | null
  felulir: boolean
}): ImportDontes {
  const plan = planForSku(input.sku)
  if (plan === null) {
    return { kind: 'hianyzik', sku: input.sku }
  }
  if (input.publikalt === null) {
    return { kind: 'hianyzik', sku: input.sku }
  }
  const productId = input.publikalt.id
  if (!input.felulir && vanFrissebbPiszkozat(input.publikalt, input.piszkozat)) {
    const piszkozatModulok = modulok(input.piszkozat)
    if (Array.isArray(piszkozatModulok) && piszkozatModulok.length > 0) {
      return { kind: 'piszkozat', sku: input.sku, productId }
    }
  }
  if (modulesMatchPlan(input.publikalt.modules, plan)) {
    return {
      kind: 'kesz',
      sku: input.sku,
      productId,
      leckek: plannedStreamAssetIds(plan).length,
    }
  }
  const meglevo = modulok(input.publikalt)
  if (Array.isArray(meglevo) && meglevo.length > 0 && !input.felulir) {
    return {
      kind: 'szerkesztett',
      sku: input.sku,
      productId,
      leckek: meglevo.length,
    }
  }
  return { kind: 'irhato', sku: input.sku, productId, plan }
}

async function futtat(): Promise<void> {
  const kapcsolok = parseImportKapcsolok(process.argv.slice(2))
  const irhato = kapcsolok.alkalmaz && confirmEnabled(process.env[OWNER_BUNNY_CURRICULUM_CONFIRM])

  if (kapcsolok.alkalmaz && !irhato) {
    logger.error(
      `Íráshoz a ${OWNER_BUNNY_CURRICULUM_CONFIRM}=igen is kell. Próbafutás: hagyd el a --alkalmaz kapcsolót.`,
    )
    process.exitCode = 1
    return
  }

  const payload = await getPayload({ config })
  let irasok = 0

  for (const plan of BUNNY_CURRICULUM_PLANS) {
    const publikalt = await keresdKurzust(payload, plan.sku)
    const piszkozat =
      publikalt === null
        ? null
        : await payload
            .findByID({
              collection: 'products',
              id: publikalt.id,
              depth: 0,
              overrideAccess: true,
              draft: true,
            })
            .catch(() => null)

    const dontes = dontesKurzusra({
      sku: plan.sku,
      publikalt,
      piszkozat,
      felulir: kapcsolok.felulir,
    })

    if (dontes.kind === 'hianyzik') {
      logger.error('Nincs ilyen kurzus a CMS-ben', { sku: plan.sku })
      process.exitCode = 1
      continue
    }
    if (dontes.kind === 'kesz') {
      logger.info('A tananyag már a Bunny-készletet tartalmazza, nincs teendő', {
        sku: plan.sku,
        productId: dontes.productId,
        leckek: dontes.leckek,
      })
      continue
    }
    if (dontes.kind === 'piszkozat') {
      logger.error(
        'A kurzus piszkozatában van tananyag. Publikáld vagy dobd el, és futtasd újra. Felülíráshoz --felulir kell.',
        { sku: plan.sku, productId: dontes.productId },
      )
      process.exitCode = 1
      continue
    }
    if (dontes.kind === 'szerkesztett') {
      logger.error(
        'A kurzusnak már van tananyag-modulja, ami NEM ez a készlet. A script nem írja felül a szerkesztői munkát (a vevők haladása a lecke-azonosítóhoz kötött).',
        { sku: plan.sku, productId: dontes.productId, modulok: dontes.leckek },
      )
      process.exitCode = 1
      continue
    }

    logger.info('Terv: Bunny-tananyag beírása', {
      sku: plan.sku,
      productId: dontes.productId,
      modulok: plan.modules.length,
      leckek: plannedStreamAssetIds(plan).length,
    })
    for (const modul of plan.modules) {
      logger.info(`  ${modul.title}`, { leckek: modul.lessons.length })
      for (const lesson of modul.lessons) {
        logger.info(`    • ${lesson.title}`, { durationSec: lesson.durationSec })
      }
    }

    if (!irhato) {
      logger.info('SZÁRAZ FUTÁS — semmi nem íródott.')
      continue
    }

    await payload.update({
      collection: 'products',
      id: dontes.productId,
      overrideAccess: true,
      data: {
        modules: plan.modules,
      },
    })
    irasok += 1
    logger.info('Kész: a tananyag a kurzusra került, Kész állapottal és GUID-dal.', {
      sku: plan.sku,
      productId: dontes.productId,
    })
  }

  if (!irhato) {
    logger.info(
      `Próbafutás vége. Íráshoz: ${OWNER_BUNNY_CURRICULUM_CONFIRM}=igen npm run import:bunny-curriculum -- --alkalmaz`,
    )
  } else {
    logger.info('Import kész', { irasok })
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  futtat()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((error: unknown) => {
      logger.error('A Bunny-tananyag importja sikertelen', {
        error: error instanceof Error ? error.message : String(error),
      })
      process.exit(1)
    })
}
