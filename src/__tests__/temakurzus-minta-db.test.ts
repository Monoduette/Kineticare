import { getPayload, type Payload } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { courseEditorialChecklist } from '../components/admin/course-editorial-checklist'
import { findTopicCoursesOf } from '../lib/course-family-topics'
import { OTTHONI_COURSE_SKU, planForSku } from '../lib/curriculum/bunny-keszlet'
import type { Logger } from '../lib/logger'
import {
  CSUKLO_MINTA_AR_HUF,
  CSUKLO_MINTA_LECKEK,
  CSUKLO_MINTA_SKU,
  CSUKLO_MINTA_SLUG,
} from '../lib/temakurzus-minta'
import { futtatCsukloMinta } from '../lib/temakurzus-minta-futtatas'
import type { Product } from '../payload-types'
import configPromise from '../payload.config'
import { isDatabaseAvailable } from './helpers/db-available'

/**
 * A csukló-minta szkriptje (npm run temakurzus:minta) valódi Payload +
 * Postgres úton: a próbafutás nem ír; az éles futás a mintát piszkozatként,
 * rejtettként, a programhoz kötve hozza létre, amit a látogató nem lát; a
 * második futás semmit nem ír (egy átírt mintát sosem ír felül).
 *
 * DB-függő: csak elérhető, migrált Postgres mellett fut (CI verify job).
 */
const hasDb = await isDatabaseAvailable()

const silentLog: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLog,
}

describe.skipIf(!hasDb)('csukló-minta szkript valódi adatbázison (DB)', () => {
  let payload: Payload
  let categoryId: number
  let programId: number
  const stamp = Date.now()
  const productIds: number[] = []

  async function mintaSorok(): Promise<Product[]> {
    const talalat = await payload.find({
      collection: 'products',
      where: {
        or: [{ sku: { equals: CSUKLO_MINTA_SKU } }, { slug: { equals: CSUKLO_MINTA_SLUG } }],
      },
      draft: true,
      depth: 0,
      overrideAccess: true,
      pagination: false,
    })
    return talalat.docs
  }

  beforeAll(async () => {
    vi.stubGlobal('fetch', () => {
      throw new Error('A tesztből SOSEM mehet ki valódi hálózati hívás.')
    })
    payload = await getPayload({ config: configPromise })
    // A minta és a program Belső azonosítója rögzített, ezért egy korábbi,
    // félbeszakadt futás maradéka hamis eredményt adna. Törölni nem törlünk
    // vaktában: hangosan megállunk.
    const marad = await payload.find({
      collection: 'products',
      where: {
        or: [
          { sku: { equals: CSUKLO_MINTA_SKU } },
          { slug: { equals: CSUKLO_MINTA_SLUG } },
          { sku: { equals: OTTHONI_COURSE_SKU } },
        ],
      },
      draft: true,
      depth: 0,
      overrideAccess: true,
      pagination: false,
    })
    if (marad.docs.length > 0) {
      throw new Error(
        `A tesztadatbázisban már van csukló-minta vagy program (id: ${marad.docs
          .map((doc) => doc.id)
          .join(', ')}); egy korábbi futás maradéka, kézzel törlendő.`,
      )
    }
    const category = await payload.create({
      collection: 'categories',
      data: { title: `Csukló-minta ${stamp}`, slug: `csuklo-minta-${stamp}`, type: 'product' },
      overrideAccess: true,
    })
    categoryId = category.id
    const plan = planForSku(OTTHONI_COURSE_SKU)
    if (plan === null) throw new Error('hiányzik a program importterve')
    const programDoc = await payload.create({
      collection: 'products',
      data: {
        sku: OTTHONI_COURSE_SKU,
        slug: `otthoni-program-minta-teszt-${stamp}`,
        category: categoryId,
        status: 'published',
        _status: 'published',
        priceInHUFEnabled: true,
        priceInHUF: 79_500,
        modules: plan.modules,
      },
      overrideAccess: true,
    })
    programId = programDoc.id
    productIds.push(programId)
  })

  afterAll(async () => {
    vi.unstubAllGlobals()
    if (payload === undefined) return
    for (const sor of await mintaSorok()) productIds.unshift(sor.id)
    // A minta előbb megy, hogy a program törlését ne tartsa vissza a hivatkozás.
    for (const id of productIds) {
      await payload.delete({ collection: 'products', id, overrideAccess: true, trash: true })
    }
    if (categoryId !== undefined) {
      await payload.delete({ collection: 'categories', id: categoryId, overrideAccess: true })
    }
    await payload.db?.destroy?.()
  })

  it('próbafutás: tervez, de nem ír', async () => {
    const { terv, letrehozottId } = await futtatCsukloMinta({
      payload,
      dryRun: true,
      log: silentLog,
    })
    expect([terv.allapot, letrehozottId]).toEqual(['LETREHOZANDO', null])
    expect(await mintaSorok()).toEqual([])
  })

  it('éles futás: rejtett piszkozat a programhoz kötve, amit a látogató nem lát', async () => {
    const { terv, letrehozottId } = await futtatCsukloMinta({
      payload,
      dryRun: false,
      log: silentLog,
    })
    expect(terv.allapot).toBe('LETREHOZANDO')
    expect(letrehozottId).not.toBeNull()

    const sorok = await mintaSorok()
    expect(sorok.map((sor) => sor.id)).toEqual([letrehozottId])
    const minta = sorok[0]
    expect({
      _status: minta._status,
      status: minta.status,
      unlisted: minta.unlisted,
      pageLayout: minta.pageLayout,
      parentCourses: minta.parentCourses,
      priceInHUF: minta.priceInHUF,
      leckek: (minta.modules ?? []).flatMap((m) => (m.lessons ?? []).map((l) => l.streamAssetId)),
    }).toEqual({
      _status: 'draft',
      status: 'draft',
      unlisted: true,
      pageLayout: 'landing',
      parentCourses: [programId],
      priceInHUF: CSUKLO_MINTA_AR_HUF,
      leckek: [...CSUKLO_MINTA_LECKEK],
    })

    // A látogató felől: nyilvános olvasással nincs ilyen kurzus, és a program
    // oldalának témakurzus-rácsa sem mutatja.
    const nyilvanos = await payload.find({
      collection: 'products',
      where: { slug: { equals: CSUKLO_MINTA_SLUG } },
      depth: 0,
      overrideAccess: false,
    })
    expect(nyilvanos.docs).toEqual([])
    expect(await findTopicCoursesOf({ payload, programId, logger: silentLog })).toEqual([])

    // Az admin ellenőrzőlistája a mentett mintán: témakurzusnak ismeri fel,
    // kategória és ár rendben, a szövegben nincs kézzel írt ár.
    const kesz = courseEditorialChecklist(minta)
      .items.filter((sor) => ['category', 'price', 'topic-course'].includes(sor.key))
      .map((sor) => [sor.key, sor.ready])
    expect(kesz).toEqual([
      ['category', true],
      ['price', true],
      ['topic-course', true],
    ])
  })

  it('második futás: a meglévő (akár átírt) mintához nem nyúl', async () => {
    const [elotte] = await mintaSorok()
    await payload.update({
      collection: 'products',
      id: elotte.id,
      data: { shortDescription: 'A szerkesztő átírta.' },
      draft: true,
      overrideAccess: true,
    })

    const { terv, letrehozottId } = await futtatCsukloMinta({
      payload,
      dryRun: false,
      log: silentLog,
    })
    expect([terv.allapot, letrehozottId]).toEqual(['MAR_LETEZIK', null])
    const utana = await mintaSorok()
    expect(utana.map((sor) => [sor.id, sor.shortDescription])).toEqual([
      [elotte.id, 'A szerkesztő átírta.'],
    ])
  })
})
