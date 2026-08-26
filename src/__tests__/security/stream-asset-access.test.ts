import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import type { CollectionConfig, Field, FieldAccess, Payload, SanitizedConfig } from 'payload'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { streamAssetReadAccess } from '../../access'
import { issueStreamToken, StreamTokenError } from '../../lib/stream/issue-stream-token'
import type { Product, User } from '../../payload-types'
import configPromise from '../../payload.config'

/**
 * A `videos[].streamAssetId` OLVASÁSI VÉDELME (S2/b).
 * A mező a védett Bunny-library videó-GUID-ja. A products olvasása nyilvános
 * (published termékek), tehát védelem nélkül a `GET /api/products` anonim
 * kérőnek is kiadja az összes kurzus összes videó-GUID-ját.
 * 1. a szabály mind az ÖT esetre helyes: anonim / nem-vevő customer / vevő
 */

const DUMMY_TOKEN_KEY = 'DUMMY-BUNNY-TOKEN-AUTH-KEY-NEM-VALODI-TITOK'
const DUMMY_ASSET_ID = 'bunny-video-guid-abc123'
const PRODUCT_ID = 42

type Role = 'owner' | 'staff' | 'customer'

interface TestUser {
  id: number
  role: Role
  purchases?: (number | { id: number })[]
}

interface FieldArgsOverrides {
  /** A top-level dokumentum (array-almezőnél is ez jön `doc`-ként). */
  doc?: unknown
  /** A Payload külön is átadja a dokumentum kulcsát. */
  id?: unknown
}

const fieldArgs = (
  user: TestUser | null,
  overrides: FieldArgsOverrides = {},
): Parameters<FieldAccess>[0] =>
  ({
    doc: 'doc' in overrides ? overrides.doc : { id: PRODUCT_ID },
    id: 'id' in overrides ? overrides.id : PRODUCT_ID,
    req: { user },
  }) as unknown as Parameters<FieldAccess>[0]

describe('streamAssetReadAccess — a szerepkör-mátrix mind az öt esete', () => {
  it('owner olvassa (vásárlás nélkül is)', () => {
    expect(streamAssetReadAccess(fieldArgs({ id: 1, role: 'owner', purchases: [] }))).toBe(true)
  })

  it('staff olvassa (vásárlás nélkül is)', () => {
    expect(streamAssetReadAccess(fieldArgs({ id: 2, role: 'staff', purchases: [] }))).toBe(true)
  })

  it('a VEVŐ customer olvassa — nyers id-listával és populate-olt objektummal is', () => {
    expect(
      streamAssetReadAccess(fieldArgs({ id: 3, role: 'customer', purchases: [7, PRODUCT_ID] })),
    ).toBe(true)
    expect(
      streamAssetReadAccess(fieldArgs({ id: 3, role: 'customer', purchases: [{ id: PRODUCT_ID }] })),
    ).toBe(true)
  })

  it('a NEM-VEVŐ customer nem olvassa', () => {
    expect(streamAssetReadAccess(fieldArgs({ id: 3, role: 'customer', purchases: [7] }))).toBe(false)
    expect(streamAssetReadAccess(fieldArgs({ id: 3, role: 'customer', purchases: [] }))).toBe(false)
    expect(streamAssetReadAccess(fieldArgs({ id: 3, role: 'customer' }))).toBe(false)
  })

  it('anonim látogató SOHA nem olvassa', () => {
    expect(streamAssetReadAccess(fieldArgs(null))).toBe(false)
  })

  it('ismeretlen szülő-termék esetén FAIL-CLOSED (a vevő sem kapja meg)', () => {
    const buyer: TestUser = { id: 3, role: 'customer', purchases: [PRODUCT_ID] }
    expect(streamAssetReadAccess(fieldArgs(buyer, { doc: null, id: undefined }))).toBe(false)
    expect(streamAssetReadAccess(fieldArgs(buyer, { doc: {}, id: undefined }))).toBe(false)
  })

  it('a szülő-termék a doc-ból is feloldható, ha az id argumentum hiányzik', () => {
    const buyer: TestUser = { id: 3, role: 'customer', purchases: [PRODUCT_ID] }
    expect(streamAssetReadAccess(fieldArgs(buyer, { doc: { id: PRODUCT_ID }, id: undefined }))).toBe(
      true,
    )
    expect(streamAssetReadAccess(fieldArgs(buyer, { doc: { id: 999 }, id: undefined }))).toBe(false)
  })
})

/** Rekurzív mező-gyűjtő a group/row/tabs/array-struktúrákhoz. */
const flattenFields = (fields: Field[]): Field[] => {
  const result: Field[] = []
  for (const field of fields) {
    result.push(field)
    if ('fields' in field && Array.isArray(field.fields)) {
      result.push(...flattenFields(field.fields as Field[]))
    }
    if (field.type === 'tabs' && Array.isArray(field.tabs)) {
      for (const tab of field.tabs) {
        result.push(...flattenFields(tab.fields as Field[]))
      }
    }
  }
  return result
}

type NamedTestField = Field & { name: string; access?: { read?: FieldAccess } }

describe('a bekötés a VÉGLEGES, szanitált configban', () => {
  const findProductField = async (name: string): Promise<NamedTestField | undefined> => {
    const config = await configPromise
    const products = (config.collections ?? []).find((c) => c.slug === 'products') as
      | CollectionConfig
      | undefined
    expect(products, 'a products collection létezik').toBeDefined()
    return flattenFields(products?.fields ?? []).find(
      (field) => 'name' in field && field.name === name,
    ) as NamedTestField | undefined
  }

  it('a videos[].streamAssetId read-access a streamAssetReadAccess', async () => {
    const field = await findProductField('streamAssetId')

    expect(field).toBeDefined()
    expect(field?.access?.read).toBe(streamAssetReadAccess)
  })

  it('a videó-sor többi almezője NYILVÁNOS marad (a kurzusoldal epizódlistája)', async () => {
    for (const name of ['title', 'durationSec']) {
      const field = await findProductField(name)
      expect(field, name).toBeDefined()
      expect(field?.access?.read, name).toBeUndefined()
    }
    // Az ingyenes előzetes a PUBLIKUS libraryből jön — az szándékosan nyitott.
    const preview = await findProductField('previewVideoStreamId')
    expect(preview).toBeDefined()
    expect(preview?.access?.read).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// A VALÓDI Payload mező-hook betöltése
// ---------------------------------------------------------------------------

/**
 * A `payload` csomag `exports` mezője csak a `.`, `./internal`, `./node`,
 * `./shared`, `./i18n/*` és `./migrations` alutakat vezeti ki — a
 * `fields/hooks/afterRead/index.js` csomagnévvel NEM importálható. Ezért a
 * csomag belépési pontjából (`require.resolve('payload')`) számolt ABSZOLÚT
 * fájlúttal, dinamikusan töltjük be. Ez a REPÓBAN TELEPÍTETT Payload kódja,
 * nem másolat.
 */
type AfterReadArgsShape = {
  collection: unknown
  context: Record<string, unknown>
  depth: number
  doc: Record<string, unknown>
  draft: boolean
  fallbackLocale: null
  global: null
  locale: string
  overrideAccess: boolean
  req: unknown
  showHiddenFields: boolean
}

type AfterReadFn = (args: AfterReadArgsShape) => Promise<Record<string, unknown>>

async function loadPayloadAfterRead(): Promise<AfterReadFn> {
  const requireFromHere = createRequire(import.meta.url)
  const entry = requireFromHere.resolve('payload')
  const modulePath = entry.replace(/index\.js$/, 'fields/hooks/afterRead/index.js')
  const loaded = (await import(pathToFileURL(modulePath).href)) as { afterRead: AfterReadFn }
  return loaded.afterRead
}

const buyerUser = {
  id: 7,
  email: 'vevo@example.test',
  role: 'customer',
  purchases: [PRODUCT_ID],
} as unknown as User

function makeProduct(): Product {
  return {
    id: PRODUCT_ID,
    sku: 'KURZUS-ALAP',
    status: 'published',
    accessDurationDays: null,
    videos: [
      {
        id: 'sor-1',
        title: '1. lecke',
        streamAssetId: DUMMY_ASSET_ID,
        durationSec: 1800,
        status: 'ready',
      },
    ],
  } as unknown as Product
}

let afterRead: AfterReadFn
let config: SanitizedConfig
let productsCollection: unknown

beforeAll(async () => {
  afterRead = await loadPayloadAfterRead()
  config = await configPromise
  productsCollection = (config.collections ?? []).find(
    (collection) => collection.slug === 'products',
  )
  expect(productsCollection, 'a products collection a szanitált configban').toBeDefined()
})

/**
 * Egy termék-dokumentum végigfuttatása a VALÓDI Payload `afterRead` hookján, a
 * SZANITÁLT products-collectionnel — pontosan úgy, ahogy a REST-olvasás teszi.
 * `depth: 0`, tehát relációfeloldás (és adatbázis-kör) nincs.
 */
async function readProduct(options: {
  user: TestUser | null
  overrideAccess?: boolean
}): Promise<Product> {
  const doc = JSON.parse(JSON.stringify(makeProduct())) as Record<string, unknown>
  const req = {
    context: {},
    payload: { config },
    user: options.user,
  }
  const result = await afterRead({
    collection: productsCollection,
    context: {},
    depth: 0,
    doc,
    draft: false,
    fallbackLocale: null,
    global: null,
    locale: '',
    overrideAccess: options.overrideAccess ?? false,
    req,
    showHiddenFields: false,
  })
  return result as unknown as Product
}

describe('a VALÓDI Payload mező-hook a szanitált configgal', () => {
  it('anonim látogató NEM kapja meg a streamAssetId-t', async () => {
    const product = await readProduct({ user: null })

    expect(product.videos?.[0]?.streamAssetId).toBeUndefined()
    // A cím és a hossz megmarad — a kurzusoldal epizódlistája nem sérül.
    expect(product.videos?.[0]?.title).toBe('1. lecke')
    expect(product.videos?.[0]?.durationSec).toBe(1800)
  })

  it('a NEM-VEVŐ customer sem kapja meg', async () => {
    const product = await readProduct({ user: { id: 8, role: 'customer', purchases: [] } })

    expect(product.videos?.[0]?.streamAssetId).toBeUndefined()
    expect(product.videos?.[0]?.title).toBe('1. lecke')
  })

  it('a VEVŐ customer megkapja', async () => {
    const product = await readProduct({
      user: { id: 7, role: 'customer', purchases: [PRODUCT_ID] },
    })

    expect(product.videos?.[0]?.streamAssetId).toBe(DUMMY_ASSET_ID)
  })

  it('a staff és az owner megkapja (vásárlás nélkül is)', async () => {
    for (const user of [
      { id: 2, role: 'staff' as Role },
      { id: 1, role: 'owner' as Role },
    ]) {
      const product = await readProduct({ user })
      expect(product.videos?.[0]?.streamAssetId, user.role).toBe(DUMMY_ASSET_ID)
    }
  })

  /**
   * A RÖVIDZÁR: `overrideAccess: true` esetén a hook a mező-access-t be sem
   * hívja. A szerver-oldali lejátszási út ezért marad ép — ezt a következő
   * blokk a stream-token szolgáltatáson is végigméri.
   */
  it('overrideAccess: true mellett a mező megmarad, anonim kontextusban is', async () => {
    const product = await readProduct({ user: null, overrideAccess: true })

    expect(product.videos?.[0]?.streamAssetId).toBe(DUMMY_ASSET_ID)
  })

  /**
   * A sorosított válaszban SEHOL nem szerepelhet a GUID: a REST-válasz JSON-je
   * megy ki a hálózatra, tehát mezőnkénti ellenőrzés helyett a teljes kimenetre
   * is ránézünk.
   */
  it('a GUID a nem-vevőnek adott VÁLASZ JSON-jében sehol nem szerepel', async () => {
    const serialized = JSON.stringify(await readProduct({ user: { id: 8, role: 'customer' } }))

    expect(serialized).not.toContain(DUMMY_ASSET_ID)
    expect(serialized).toContain('1. lecke')
  })
})

// ---------------------------------------------------------------------------
// A lejátszási út (stream-token) — ÁL local API a VALÓDI hookkal
// ---------------------------------------------------------------------------

interface PlaybackPayloadOptions {
  /** Ha false: az ál-local-API FIGYELMEN KÍVÜL hagyja az overrideAccess-t (negatív kontroll). */
  honourOverrideAccess?: boolean
  user?: TestUser | null
}

/**
 * Ál Payload local API: a `findByID` a VALÓDI `afterRead` hookon engedi át a
 * dokumentumot, ugyanazzal a szanitált collectionnel, amit az éles kód használ.
 * Így a lejátszási lánc a valódi mező-viselkedéssel mérhető, adatbázis nélkül.
 */
function createPlaybackPayload(options: PlaybackPayloadOptions = {}) {
  const honour = options.honourOverrideAccess !== false
  const user = options.user ?? null
  const findByID = vi.fn(async (args: { overrideAccess?: boolean }) =>
    readProduct({
      user,
      overrideAccess: honour ? args.overrideAccess === true : false,
    }),
  )
  const payload = {
    findByID,
    find: vi.fn(async () => ({ docs: [] })),
  }
  return { payload: payload as unknown as Payload, findByID }
}

const savedTokenKey = process.env.BUNNY_STREAM_TOKEN_AUTH_KEY

beforeAll(() => {
  process.env.BUNNY_STREAM_TOKEN_AUTH_KEY = DUMMY_TOKEN_KEY
})

afterAll(() => {
  if (savedTokenKey === undefined) {
    delete process.env.BUNNY_STREAM_TOKEN_AUTH_KEY
  } else {
    process.env.BUNNY_STREAM_TOKEN_AUTH_KEY = savedTokenKey
  }
})

describe('a lejátszás (stream-token út) a szigorítás után is működik', () => {
  it('a stream-token szolgáltatás overrideAccess: true-val olvassa a terméket', async () => {
    const { payload, findByID } = createPlaybackPayload()

    await issueStreamToken({ payload, user: buyerUser, productId: PRODUCT_ID })

    expect(findByID).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'products', overrideAccess: true }),
    )
  })

  it('a vevő jegyet kap — a streamAssetId végigmegy a láncon', async () => {
    const { payload } = createPlaybackPayload()

    const result = await issueStreamToken({ payload, user: buyerUser, productId: PRODUCT_ID })

    expect(result.token).toMatch(/^[0-9a-f]{64}$/)
    expect(typeof result.expiresAt).toBe('string')
  })

  /**
   * NEGATÍV KONTROLL — ez bizonyítja, hogy a fenti eredmény nem véletlen.
   * Ha ugyanezt a termék-olvasást access-ellenőrzés alá tennénk (overrideAccess
   * nélkül, anonim kontextusban), a Payload TÖRÖLNÉ a streamAssetId-t, és a
   * szolgáltatás 503-mal állna le. A lejátszás tehát pontosan az
   * `overrideAccess: true` miatt marad ép — ez a szigorítás feltétele.
   */
  it('overrideAccess NÉLKÜL a mező eltűnne, és a jegykiadás elhasalna (503)', async () => {
    const { payload } = createPlaybackPayload({ honourOverrideAccess: false })

    await expect(
      issueStreamToken({ payload, user: buyerUser, productId: PRODUCT_ID }),
    ).rejects.toBeInstanceOf(StreamTokenError)

    await expect(
      issueStreamToken({ payload, user: buyerUser, productId: PRODUCT_ID }),
    ).rejects.toMatchObject({ status: 503 })
  })
})
