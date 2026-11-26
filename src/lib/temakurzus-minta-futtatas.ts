import type { Payload } from 'payload'

import type { Product } from '../payload-types'
import type { Logger } from './logger'
import {
  CSUKLO_MINTA_SKU,
  CSUKLO_MINTA_SLUG,
  OTTHONI_COURSE_SKU,
  tervezdCsukloMintat,
  type CsukloMintaTerv,
} from './temakurzus-minta'

/**
 * A csukló-minta vezérlése (src/scripts/temakurzus-minta.ts hívja).
 *
 * Próbafutásban csak a tervet naplózza. Éles futásban a mintát PISZKOZATKÉNT
 * hozza létre (`draft: true`), így közzétett változata nincs, a látogató nem
 * látja. Idempotens: ha már van ilyen Belső azonosítójú vagy webcímű kurzus
 * (piszkozattal együtt keresve), nem ír semmit, tehát egy szerkesztő által
 * átírt mintát sosem ír felül.
 */
export async function futtatCsukloMinta(input: {
  payload: Payload
  dryRun: boolean
  log: Logger
}): Promise<{ terv: CsukloMintaTerv; letrehozottId: number | null }> {
  const { payload, dryRun, log } = input
  const letezo = await payload.find({
    collection: 'products',
    where: {
      or: [{ sku: { equals: CSUKLO_MINTA_SKU } }, { slug: { equals: CSUKLO_MINTA_SLUG } }],
    },
    draft: true,
    depth: 0,
    limit: 1,
    overrideAccess: true,
    pagination: false,
  })
  const programok = await payload.find({
    collection: 'products',
    where: { sku: { equals: OTTHONI_COURSE_SKU } },
    depth: 0,
    limit: 2,
    overrideAccess: true,
    pagination: false,
  })
  const program: Product | null = programok.docs.length === 1 ? programok.docs[0] : null
  if (programok.docs.length > 1) {
    log.warn('temakurzus-minta: több kurzus is a program Belső azonosítóját viseli, nem írok.', {
      sku: OTTHONI_COURSE_SKU,
    })
  }

  const terv = tervezdCsukloMintat({ program, marLetezik: letezo.docs.length > 0 })
  log.info(terv.uzenet)
  if (terv.allapot !== 'LETREHOZANDO' || terv.adat === null || dryRun) {
    return { terv, letrehozottId: null }
  }
  const letrehozott = await payload.create({
    collection: 'products',
    data: terv.adat,
    draft: true,
    overrideAccess: true,
  })
  log.info('temakurzus-minta: a minta piszkozata elkészült.', { id: letrehozott.id })
  return { terv, letrehozottId: letrehozott.id }
}
