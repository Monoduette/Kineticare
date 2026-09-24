import { readFileSync } from 'node:fs'

import type { CollectionOverride } from '@payloadcms/plugin-ecommerce/types'
import type { Config, Field } from 'payload'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { isOwnerFieldAccess } from '../access'
import {
  FREE_COURSE_GUARD_MESSAGE,
  MIN_PRICE_HUF,
  OWNER_ONLY_CHANGE_MESSAGE,
  PRICE_MESSAGE,
  PRODUCT_CONFIRMATIONS_KEY,
  PROMO_END_REQUIRED_MESSAGE,
  formatHufInput,
  isFreeCourseGuardMessage,
  isPriceDrop,
  isPriceDropMessage,
  parseHufInput,
  priceDropMessage,
  readProductConfirmations,
} from '../components/admin/huf-price'
import { formatPriceHuf } from '../lib/format-price'

/**
 * r2-termekor (PR-A, termékvédelem): a kurzus ár-mezőinek szerver-oldali őrei
 * (src/plugins/ecommerce.ts) és a forintos bevitel szabályai
 * (src/components/admin/huf-price.ts). DB és hálózat nélkül: a Payload
 * `req.payload.findByID` (a fő tábla sora), `find` (a műveletnapló, a
 * legutóbb közzétett állapot) és `count` (a rendelések) stub; ha egy ágon
 * olvasás nem várható, a stub hangosan dob, és a teszt ellenőrzi, hogy nem
 * hívódott (CLAUDE.md, 15. üzemeltetési tanulság).
 *
 * A mért élő állapot (GET /api/products, 2026-09-24): az 1. és a 4. kurzus
 * fizetős, 79 500 Ft; a 4.-en közzétett, vég nélküli akció 39 500 Ft-tal.
 */

const runtime = vi.hoisted(() => ({ override: undefined as CollectionOverride | undefined }))
vi.mock('@payloadcms/plugin-ecommerce', () => ({
  ecommercePlugin: (options: { products: { productsCollectionOverride: CollectionOverride } }) => {
    runtime.override = options.products.productsCollectionOverride
    return (config: Config) => config
  },
}))
vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))

const {
  ecommerce,
  PROMO_PRICE_MESSAGE,
  restoreVersionByNonOwnerStaysDraft,
  validatePriceInHUF,
  validatePriceInHUFEnabled,
  validatePromoEnd,
  validatePromoPriceHuf,
} = await import('../plugins/ecommerce')

beforeAll(async () => {
  await ecommerce({ collections: [] } as unknown as Config)
})

type Role = 'owner' | 'staff'

type AuditEntry = { before?: unknown; after?: unknown }

/** A közzétett (fő táblás) sor, ahogy a findByID adja; `undefined`: olvasás nem várható. */
function fakeReq(
  options: {
    role?: Role
    published?: Record<string, unknown> | 'hiba'
    orders?: number | 'hiba'
    /** A műveletnapló bejegyzései a legújabbal kezdve (src/plugins/audit.ts), egy lapon. */
    audit?: AuditEntry[]
    /** Több lap: a find `page` paramétere szerint (1-től), a Payload lapozásának alakjában. */
    auditPages?: AuditEntry[][]
    context?: Record<string, unknown>
  } = {},
) {
  const { role = 'owner', published, orders, audit, auditPages, context = {} } = options
  const findByID = vi.fn(async () => {
    if (published === undefined) throw new Error('Ebben az esetben nem kellene olvasni.')
    if (published === 'hiba') throw new Error('DB-hiba')
    return { id: 1, ...published }
  })
  const pages = auditPages ?? (audit === undefined ? undefined : [audit])
  const find = vi.fn(async (args: { page?: number }) => {
    if (pages === undefined) throw new Error('Ebben az esetben nem kellene naplót olvasni.')
    const index = typeof args.page === 'number' ? args.page - 1 : 0
    return { docs: pages[index] ?? [], hasNextPage: index + 1 < pages.length }
  })
  const count = vi.fn(async () => {
    if (orders === undefined) throw new Error('Ebben az esetben nem kellene rendelést számolni.')
    if (orders === 'hiba') throw new Error('DB-hiba')
    return { totalDocs: orders }
  })
  return {
    req: { user: { id: 7, role }, payload: { findByID, find, count }, context },
    findByID,
    find,
    count,
  }
}

const PAID_PUBLISHED = {
  _status: 'published',
  priceInHUFEnabled: true,
  priceInHUF: 79_500,
  promoEnabled: false,
  promoEnd: null,
  promoPriceHuf: null,
}

type NumberOpts = Parameters<typeof validatePriceInHUF>[1]
type CheckboxOpts = Parameters<typeof validatePriceInHUFEnabled>[1]
type DateOpts = Parameters<typeof validatePromoEnd>[1]

function numberOpts(extra: Record<string, unknown>): NumberOpts {
  const sibling = { priceInHUFEnabled: true, priceInHUF: 79_500 }
  return {
    data: sibling,
    siblingData: sibling,
    operation: 'update',
    id: 1,
    previousValue: null,
    ...extra,
  } as unknown as NumberOpts
}

describe('forintos bevitel: a pont és a szóköz ezres tagoló (a-cms-2)', () => {
  it('a mért hiba esetei: „79.500” 79 500 Ft (a gyári mező 80 Ft-ot mentett), „39.500”, „4.990”, „1.000”', () => {
    for (const [text, value] of [
      ['79.500', 79_500],
      ['39.500', 39_500],
      ['4.990', 4_990],
      ['1.000', 1_000],
      ['79 500', 79_500],
      ['79500', 79_500],
      ['79 500 Ft', 79_500],
      ['79\u00a0500', 79_500],
      ['79 500,- Ft', 79_500],
      ['79 500 forint', 79_500],
    ] as const) {
      expect(parseHufInput(text), text).toEqual({ kind: 'ertek', value, unusualGrouping: false })
    }
  })

  it('a szabálytalan tagolás számmá válik, de jelzést kap; üres: nincs ár', () => {
    expect(parseHufInput('79.50')).toEqual({ kind: 'ertek', value: 7_950, unusualGrouping: true })
    expect(parseHufInput('')).toEqual({ kind: 'ures' })
    expect(parseHufInput('   ')).toEqual({ kind: 'ures' })
  })

  it('tizedesvessző, betű, előjel és túl nagy szám: hiba, nem csendes átírás', () => {
    expect(parseHufInput('79,5')).toMatchObject({ kind: 'hiba', message: /nincs fillér/ })
    expect(parseHufInput('12,500')).toMatchObject({ kind: 'hiba', message: /nincs fillér/ })
    expect(parseHufInput('abc')).toMatchObject({ kind: 'hiba', message: /Csak számjegyet/ })
    expect(parseHufInput('-5')).toMatchObject({ kind: 'hiba', message: /Csak számjegyet/ })
    expect(parseHufInput('9999999999999999')).toMatchObject({ kind: 'hiba', message: /túl nagy/ })
  })

  it('a mezőben a vásárlói formázó tagolása áll, „Ft” nélkül', () => {
    expect(formatHufInput(79_500)).toBe('79\u00a0500')
    expect(`${formatHufInput(79_500)}\u00a0Ft`).toBe(formatPriceHuf(79_500))
  })
})

describe('validatePriceInHUF: egész forint, legalább 10 Ft, megerősítés a felénél nagyobb csökkenésnél', () => {
  it('a „79.500” → 80 Ft elírás közzététele hibát ad, pontosan kimondva a két árat', async () => {
    const { req } = fakeReq({ published: PAID_PUBLISHED })
    const message = await validatePriceInHUF(80, numberOpts({ req }))
    expect(message).toBe(priceDropMessage('rendes', 80, 79_500))
    expect(message).toBe(
      'Az új ár (80\u00a0Ft) kevesebb, mint a közzétett ár (79\u00a0500\u00a0Ft) fele. Ha elírás, javítsd. Ha szándékos, jelöld be a mező alatti megerősítést.',
    )
    expect(isPriceDropMessage(message)).toBe(true)
  })

  it('a megerősítés az adott összegre szól: a mentés adataiból vagy a req.context-ből', async () => {
    const fromForm = fakeReq({ published: PAID_PUBLISHED })
    const data = { [PRODUCT_CONFIRMATIONS_KEY]: { priceInHUF: 29_900 } }
    expect(await validatePriceInHUF(29_900, numberOpts({ req: fromForm.req, data }))).toBe(true)
    // Más összegre adott megerősítés nem enged át egy másik árat.
    expect(await validatePriceInHUF(2_990, numberOpts({ req: fromForm.req, data }))).toBe(
      priceDropMessage('rendes', 2_990, 79_500),
    )
    const fromScript = fakeReq({
      published: PAID_PUBLISHED,
      context: { [PRODUCT_CONFIRMATIONS_KEY]: { priceInHUF: 29_900 } },
    })
    expect(await validatePriceInHUF(29_900, numberOpts({ req: fromScript.req }))).toBe(true)
  })

  it('a határ: a közzétett ár fele még nem kér megerősítést, alatta igen; emelésnél sosem', async () => {
    const { req } = fakeReq({ published: PAID_PUBLISHED })
    expect(await validatePriceInHUF(39_750, numberOpts({ req }))).toBe(true)
    expect(await validatePriceInHUF(39_749, numberOpts({ req }))).toBe(
      priceDropMessage('rendes', 39_749, 79_500),
    )
    expect(await validatePriceInHUF(99_000, numberOpts({ req }))).toBe(true)
    expect(isPriceDrop(39_750, 79_500)).toBe(false)
    expect(isPriceDrop(39_749, 79_500)).toBe(true)
  })

  it('a 10 Ft-os alsó határ és az egész forint (a Barion kártyás alsó határa)', async () => {
    const { req } = fakeReq({ published: { _status: 'draft' } })
    expect(MIN_PRICE_HUF).toBe(10)
    for (const value of [0, 1, 5, 9, -79_500, 79_500.5, Number.NaN]) {
      expect(await validatePriceInHUF(value, numberOpts({ req })), String(value)).toBe(
        PRICE_MESSAGE,
      )
    }
    expect(await validatePriceInHUF(10, numberOpts({ req }))).toBe(true)
    expect(PRICE_MESSAGE).toContain('legalább 10 Ft')
  })

  it('üres ár: nem vásárolható, de nem is ingyenes, ezért megengedett; DB-t nem olvas', async () => {
    const { req, findByID } = fakeReq()
    expect(await validatePriceInHUF(null, numberOpts({ req }))).toBe(true)
    expect(await validatePriceInHUF(undefined, numberOpts({ req }))).toBe(true)
    expect(findByID).not.toHaveBeenCalled()
  })

  it('új kurzus (create) és ár nélkül mentett, soha nem közzétett kurzus: nincs mihez mérni', async () => {
    const created = fakeReq()
    expect(
      await validatePriceInHUF(
        80,
        numberOpts({ req: created.req, operation: 'create', id: undefined }),
      ),
    ).toBe(true)
    expect(created.findByID).not.toHaveBeenCalled()
    const draft = fakeReq({ published: { _status: 'draft', priceInHUF: null }, audit: [] })
    expect(await validatePriceInHUF(80, numberOpts({ req: draft.req }))).toBe(true)
  })

  it('H3: közzétételi állapot nélküli piszkozat-sornál (másolat) az eddig mentett árhoz mér', async () => {
    // Csak megerősítést kérhet, átengedni semmit nem enged; a mondat nem
    // állítja, hogy ez az ár közzé volt téve.
    const copy = fakeReq({ published: { ...PAID_PUBLISHED, _status: 'draft' }, audit: [] })
    expect(await validatePriceInHUF(7_950, numberOpts({ req: copy.req }))).toBe(
      priceDropMessage('rendes', 7_950, 79_500, 'rendes', 'eddigi'),
    )
    expect(priceDropMessage('rendes', 7_950, 79_500, 'rendes', 'eddigi')).toContain(
      'mint az eddigi ár (79 500 Ft) fele',
    )
  })

  it('H3: a közzététel visszavonása után a napló szerinti utolsó közzétett árhoz mér', async () => {
    // A visszavonás a fő sorba a piszkozatot írta (benne már az elütött 7 950),
    // a napló „before” oldala a visszavonás előtti közzétett sor.
    const unpublished = { ...PAID_PUBLISHED, _status: 'draft', priceInHUF: 7_950 }
    const { req, find } = fakeReq({
      published: unpublished,
      audit: [{ before: PAID_PUBLISHED, after: unpublished }],
    })
    expect(await validatePriceInHUF(7_950, numberOpts({ req, previousValue: 7_950 }))).toBe(
      priceDropMessage('rendes', 7_950, 79_500),
    )
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'audit-logs',
        where: {
          and: [
            { entityType: { equals: 'products' } },
            { entityId: { equals: '1' } },
            {
              or: [
                { 'after._status': { equals: 'published' } },
                { 'before._status': { equals: 'published' } },
              ],
            },
          ],
        },
        sort: '-createdAt',
        page: 1,
        overrideAccess: true,
      }),
    )
    const confirmed = fakeReq({
      published: unpublished,
      audit: [{ before: PAID_PUBLISHED, after: unpublished }],
    })
    const data = { [PRODUCT_CONFIRMATIONS_KEY]: { priceInHUF: 7_950 } }
    expect(await validatePriceInHUF(7_950, numberOpts({ req: confirmed.req, data }))).toBe(true)
  })

  it('H3: a legfrissebb közzétett pillanatkép számít, a régebbi nem', async () => {
    const draftRow = { ...PAID_PUBLISHED, _status: 'draft' }
    const { req } = fakeReq({
      published: draftRow,
      audit: [
        { before: draftRow, after: { ...draftRow, deletedAt: '2026-09-24T10:00:00.000Z' } },
        { before: { ...PAID_PUBLISHED, priceInHUF: 99_000 }, after: draftRow },
        { before: undefined, after: PAID_PUBLISHED },
      ],
    })
    expect(await validatePriceInHUF(45_000, numberOpts({ req }))).toBe(
      priceDropMessage('rendes', 45_000, 99_000),
    )
  })

  it('H3: egy bejegyzésen belül az „after” az újabb állapot', async () => {
    // Közzétett árváltás 99 000-ről 49 000-re, utána visszavonás: a mérce 49 000.
    const { req } = fakeReq({
      published: { ...PAID_PUBLISHED, _status: 'draft', priceInHUF: 24_000 },
      audit: [
        {
          before: { ...PAID_PUBLISHED, priceInHUF: 99_000 },
          after: { ...PAID_PUBLISHED, priceInHUF: 49_000 },
        },
      ],
    })
    expect(await validatePriceInHUF(24_000, numberOpts({ req, previousValue: 24_000 }))).toBe(
      priceDropMessage('rendes', 24_000, 49_000),
    )
  })

  it('rev1: lomtárban álló sor és naplóoldal sosem mérce, akkor sem, ha közzétett státuszú', async () => {
    // A lomtár írását a Payload nem validálja: a kézzel összerakott
    // `{ deletedAt, _status: 'published' }` után a fő sorban és a bejegyzés
    // „after” oldalán a tulajdonos meg nem erősített 5 Ft-os piszkozata állt.
    const poisoned = { ...PAID_PUBLISHED, priceInHUF: 5, deletedAt: '2026-09-24T10:00:00.000Z' }
    const trashEntry = { before: PAID_PUBLISHED, after: poisoned }
    const rows = [
      ['közzétett státuszú lomtár-sor', poisoned],
      ['piszkozat lomtár-sor, mérgezett naplóoldallal', { ...poisoned, _status: 'draft' }],
    ] as const
    for (const [label, row] of rows) {
      const staff = fakeReq({ role: 'staff', published: row, audit: [trashEntry] })
      expect(
        await validatePriceInHUF(5, numberOpts({ req: staff.req, previousValue: 5 })),
        label,
      ).toBe(OWNER_ONLY_CHANGE_MESSAGE)
      const owner = fakeReq({ published: row, audit: [trashEntry] })
      expect(
        await validatePriceInHUF(5, numberOpts({ req: owner.req, previousValue: 5 })),
        label,
      ).toBe(PRICE_MESSAGE)
    }
  })

  it('H3 (rev1): a napló lapozva keresi a legutóbbi élő közzétett állapotot, nem rögzített ablakban', async () => {
    // Az első lap (20 bejegyzés) nem tartalmaz élő közzétett oldalt. A szűrő
    // (közzétett oldalú bejegyzés) csak olyat enged át, amelynek közzétett
    // oldala lomtárban áll: a rev1 előtti, `_status: 'published'`-del küldött
    // lomtár-írások alakja (lomtárba helyezés, majd lomtárban álló sor mentése).
    const draftRow = { ...PAID_PUBLISHED, _status: 'draft', priceInHUF: 7_950 }
    const trashedPublished = { ...PAID_PUBLISHED, priceInHUF: 7_950, deletedAt: '2026-09-24' }
    const firstPage = Array.from({ length: 20 }, (_, index) =>
      index % 2 === 0
        ? { before: draftRow, after: trashedPublished }
        : { before: trashedPublished, after: trashedPublished },
    )
    const { req } = fakeReq({
      published: draftRow,
      auditPages: [firstPage, [{ before: PAID_PUBLISHED, after: draftRow }]],
    })
    expect(await validatePriceInHUF(7_950, numberOpts({ req, previousValue: 7_950 }))).toBe(
      priceDropMessage('rendes', 7_950, 79_500),
    )
  })

  it('H2: a munkatárs közzététele nem viheti élesbe a tulajdonos meg nem erősített ár-piszkozatát', async () => {
    // A munkatárs értékét a Payload a legutóbbi verzióval (a tulajdonos
    // autosave-es piszkozatával) cseréli: value === previousValue.
    for (const value of [80, 5]) {
      const { req } = fakeReq({ role: 'staff', published: PAID_PUBLISHED })
      expect(
        await validatePriceInHUF(value, numberOpts({ req, previousValue: value })),
        String(value),
      ).toBe(OWNER_ONLY_CHANGE_MESSAGE)
    }
    // A munkatárs által beküldött megerősítés nem számít.
    const forged = fakeReq({ role: 'staff', published: PAID_PUBLISHED })
    const data = { [PRODUCT_CONFIRMATIONS_KEY]: { priceInHUF: 80 } }
    expect(
      await validatePriceInHUF(80, numberOpts({ req: forged.req, data, previousValue: 80 })),
    ).toBe(OWNER_ONLY_CHANGE_MESSAGE)
  })

  it('zárás elleni védelem: a munkatárs a változatlan, közzétett (akár régi, hibás) árral is közzétehet', async () => {
    const legacy = fakeReq({ role: 'staff', published: { ...PAID_PUBLISHED, priceInHUF: 5 } })
    expect(await validatePriceInHUF(5, numberOpts({ req: legacy.req, previousValue: 5 }))).toBe(
      true,
    )
    const clean = fakeReq({ role: 'staff', published: PAID_PUBLISHED })
    expect(
      await validatePriceInHUF(79_500, numberOpts({ req: clean.req, previousValue: 79_500 })),
    ).toBe(true)
  })

  it('régi, változatlan és közzétett érvénytelen ár nem zárja ki más mező mentését', async () => {
    const { req } = fakeReq({ published: { ...PAID_PUBLISHED, priceInHUF: 5 } })
    expect(await validatePriceInHUF(5, numberOpts({ req, previousValue: 5 }))).toBe(true)
    // Az autosave-csapda: a csak piszkozatban álló hibás ár nem „változatlan”.
    const trap = fakeReq({ published: PAID_PUBLISHED })
    expect(await validatePriceInHUF(5, numberOpts({ req: trap.req, previousValue: 5 }))).toBe(
      PRICE_MESSAGE,
    )
  })

  it('a csak piszkozat-sorban álló hibás ár (másolat, soha nem közzétett kurzus) nem „régi közzétett”', async () => {
    // A duplikálás és a lomtár validálás nélkül ír a fő sorba, _status: 'draft'-tal.
    const { req } = fakeReq({ published: { ...PAID_PUBLISHED, _status: 'draft', priceInHUF: 5 } })
    expect(await validatePriceInHUF(5, numberOpts({ req, previousValue: 5 }))).toBe(PRICE_MESSAGE)
  })

  it('a közzétett sort draft:false, overrideAccess és trash:true mellett olvassa', async () => {
    const { req, findByID } = fakeReq({ published: PAID_PUBLISHED })
    await validatePriceInHUF(80, numberOpts({ req }))
    expect(findByID).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'products',
        id: 1,
        draft: false,
        overrideAccess: true,
        trash: true,
        select: expect.objectContaining({ _status: true, deletedAt: true }),
      }),
    )
  })

  it('olvashatatlan közzétett ár: a csökkenés nem mérhető, az egész forint és az alsó határ él', async () => {
    const { req } = fakeReq({ published: 'hiba' })
    expect(await validatePriceInHUF(80, numberOpts({ req }))).toBe(true)
    expect(await validatePriceInHUF(5, numberOpts({ req, previousValue: 5 }))).toBe(PRICE_MESSAGE)
  })
})

describe('validatePromoPriceHuf: 10 Ft-os alsó határ és megerősítés (a-cms-2)', () => {
  const promoOpts = (extra: Record<string, unknown>) => numberOpts(extra)

  it('1 és 9 Ft között eddig átment, most hiba', async () => {
    const { req } = fakeReq({ published: PAID_PUBLISHED })
    for (const value of [1, 5, 9]) {
      expect(await validatePromoPriceHuf(value, promoOpts({ req })), String(value)).toBe(
        PROMO_PRICE_MESSAGE,
      )
    }
    expect(PROMO_PRICE_MESSAGE).toMatch(/pozitív egész/)
    expect(PROMO_PRICE_MESSAGE).toContain('legalább 10 Ft')
  })

  it('új akció a közzétett rendes ár felénél kisebb áron: megerősítést kér, a rendes árat megnevezve', async () => {
    const { req } = fakeReq({ published: PAID_PUBLISHED })
    expect(await validatePromoPriceHuf(19_900, promoOpts({ req }))).toBe(
      'Az új akciós ár (19\u00a0900\u00a0Ft) kevesebb, mint a közzétett ár (79\u00a0500\u00a0Ft) fele. Ha elírás, javítsd. Ha szándékos, jelöld be a mező alatti megerősítést.',
    )
    const data = {
      priceInHUFEnabled: true,
      priceInHUF: 79_500,
      [PRODUCT_CONFIRMATIONS_KEY]: { promoPriceHuf: 19_900 },
    }
    expect(await validatePromoPriceHuf(19_900, promoOpts({ req, data }))).toBe(true)
    expect(await validatePromoPriceHuf(49_900, promoOpts({ req }))).toBe(true)
  })

  it('közzétett akciós árhoz mér: 39 500 → 3 950 (lemaradt nulla) megerősítést kér', async () => {
    const published = { ...PAID_PUBLISHED, promoEnabled: true, promoPriceHuf: 39_500 }
    const { req } = fakeReq({ published })
    expect(await validatePromoPriceHuf(3_950, promoOpts({ req }))).toBe(
      priceDropMessage('akcios', 3_950, 39_500, 'akcios'),
    )
    expect(await validatePromoPriceHuf(3_950, promoOpts({ req }))).toContain(
      'mint a közzétett akciós ár (39\u00a0500\u00a0Ft) fele',
    )
    expect(await validatePromoPriceHuf(29_900, promoOpts({ req }))).toBe(true)
  })

  it('az élő 4. kurzus változatlan akciós ára (39 500 Ft) más mező mentésekor is átmegy', async () => {
    const published = { ...PAID_PUBLISHED, promoEnabled: true, promoPriceHuf: 39_500 }
    const { req } = fakeReq({ published })
    expect(await validatePromoPriceHuf(39_500, promoOpts({ req, previousValue: 39_500 }))).toBe(
      true,
    )
  })

  it('a csak piszkozat-sorban álló hibás akciós ár nem „régi közzétett”', async () => {
    const draftRow = { ...PAID_PUBLISHED, _status: 'draft', promoEnabled: true, promoPriceHuf: 5 }
    const { req } = fakeReq({ published: draftRow })
    expect(await validatePromoPriceHuf(5, promoOpts({ req, previousValue: 5 }))).toBe(
      PROMO_PRICE_MESSAGE,
    )
    const published = fakeReq({ published: { ...draftRow, _status: 'published' } })
    expect(
      await validatePromoPriceHuf(5, promoOpts({ req: published.req, previousValue: 5 })),
    ).toBe(true)
  })
})

describe('validatePriceInHUFEnabled: a „Fizetős kurzus” pipa kivétele ingyenessé tesz (a-cms-1)', () => {
  function checkboxOpts(extra: Record<string, unknown>): CheckboxOpts {
    const sibling = { priceInHUFEnabled: false, priceInHUF: 79_500 }
    return {
      data: sibling,
      siblingData: sibling,
      operation: 'update',
      id: 1,
      ...extra,
    } as unknown as CheckboxOpts
  }

  it('a 79 500 Ft-os kurzus „szüneteltetése” a pipa kivételével: rövid hiba, amely a pipa alatti megerősítéshez vezet', async () => {
    const { req, count } = fakeReq({ published: PAID_PUBLISHED, orders: 0 })
    const message = await validatePriceInHUFEnabled(false, checkboxOpts({ req }))
    expect(message).toBe(FREE_COURSE_GUARD_MESSAGE)
    expect(isFreeCourseGuardMessage(message)).toBe(true)
    // H8: a buborék egy sor marad (1280 px-en az 547 karakteres változat a
    // teljes fülsort takarta); a részletek a Figyelem dobozban és a súgóban.
    expect(FREE_COURSE_GUARD_MESSAGE.length).toBeLessThanOrEqual(100)
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'orders',
        overrideAccess: true,
        where: {
          and: [{ 'items.product': { equals: 1 } }, { status: { in: ['paid', 'refunded'] } }],
        },
      }),
    )
  })

  it('fizetett vagy visszatérített rendelésnél ár nélkül is hiba', async () => {
    const { req } = fakeReq({ published: { ...PAID_PUBLISHED, priceInHUF: null }, orders: 3 })
    const opts = checkboxOpts({ req, siblingData: { priceInHUFEnabled: false, priceInHUF: null } })
    expect(await validatePriceInHUFEnabled(false, opts)).toBe(FREE_COURSE_GUARD_MESSAGE)
  })

  it('kifejezett megerősítéssel átmegy, és ekkor semmit nem olvas', async () => {
    const { req, findByID, count } = fakeReq()
    const data = { [PRODUCT_CONFIRMATIONS_KEY]: { freeCourse: true } }
    expect(await validatePriceInHUFEnabled(false, checkboxOpts({ req, data }))).toBe(true)
    expect(findByID).not.toHaveBeenCalled()
    expect(count).not.toHaveBeenCalled()
  })

  it('a már ingyenes kurzus (SOS) és a bekapcsolt pipa szabadon menthető', async () => {
    const free = fakeReq({ published: { ...PAID_PUBLISHED, priceInHUFEnabled: false } })
    expect(await validatePriceInHUFEnabled(false, checkboxOpts({ req: free.req }))).toBe(true)
    expect(free.count).not.toHaveBeenCalled()
    const on = fakeReq()
    expect(await validatePriceInHUFEnabled(true, checkboxOpts({ req: on.req }))).toBe(true)
    expect(await validatePriceInHUFEnabled(null, checkboxOpts({ req: on.req }))).toBe(true)
    expect(on.findByID).not.toHaveBeenCalled()
  })

  it('a piszkozat- vagy lomtár-sorban kivett pipa nem „már ingyenes” (visszaállítás közzétettként, másolat)', async () => {
    const trashedAt = '2026-09-24T10:00:00.000Z'
    // A lomtárba helyezés validálás nélkül a legutóbbi autosave-es piszkozatot
    // írja a fő sorba (_status: 'draft'); a visszaállítás közzétettként validál.
    const trashedDraft = fakeReq({
      published: {
        ...PAID_PUBLISHED,
        _status: 'draft',
        priceInHUFEnabled: false,
        deletedAt: trashedAt,
      },
      audit: [],
      orders: 0,
    })
    expect(await validatePriceInHUFEnabled(false, checkboxOpts({ req: trashedDraft.req }))).toBe(
      FREE_COURSE_GUARD_MESSAGE,
    )
    const trashedPublished = fakeReq({
      published: { ...PAID_PUBLISHED, priceInHUFEnabled: false, deletedAt: trashedAt },
      audit: [],
      orders: 0,
    })
    expect(
      await validatePriceInHUFEnabled(false, checkboxOpts({ req: trashedPublished.req })),
    ).toBe(FREE_COURSE_GUARD_MESSAGE)
    const neverPublished = fakeReq({
      published: { ...PAID_PUBLISHED, _status: 'draft', priceInHUFEnabled: false },
      audit: [],
      orders: 0,
    })
    expect(await validatePriceInHUFEnabled(false, checkboxOpts({ req: neverPublished.req }))).toBe(
      FREE_COURSE_GUARD_MESSAGE,
    )
    // Ár és vásárló nélkül a lomtárból visszaállított ingyenes kurzus közzétehető.
    const freeNoPrice = fakeReq({
      published: {
        ...PAID_PUBLISHED,
        priceInHUFEnabled: false,
        priceInHUF: null,
        deletedAt: trashedAt,
      },
      audit: [],
      orders: 0,
    })
    const noPriceOpts = checkboxOpts({
      req: freeNoPrice.req,
      siblingData: { priceInHUFEnabled: false, priceInHUF: null },
    })
    expect(await validatePriceInHUFEnabled(false, noPriceOpts)).toBe(true)
  })

  it('ár és vásárló nélküli kurzus ingyenessé tehető; új kurzuson nem kérdez', async () => {
    const { req } = fakeReq({ published: { ...PAID_PUBLISHED, priceInHUF: null }, orders: 0 })
    const opts = checkboxOpts({ req, siblingData: { priceInHUFEnabled: false, priceInHUF: null } })
    expect(await validatePriceInHUFEnabled(false, opts)).toBe(true)
    const created = fakeReq()
    expect(
      await validatePriceInHUFEnabled(
        false,
        checkboxOpts({ req: created.req, operation: 'create', id: undefined }),
      ),
    ).toBe(true)
  })

  it('H2: a munkatárs közzététele nem teheti ingyenessé a tulajdonos piszkozatban kivett pipájával', async () => {
    // A munkatárs értéke a legutóbbi verzió, vagyis a tulajdonos autosave-es,
    // meg nem erősített piszkozata (priceInHUFEnabled: false).
    const { req } = fakeReq({ role: 'staff', published: PAID_PUBLISHED, orders: 3 })
    expect(await validatePriceInHUFEnabled(false, checkboxOpts({ req }))).toBe(
      OWNER_ONLY_CHANGE_MESSAGE,
    )
    // A munkatárs által beküldött megerősítés nem számít.
    const forged = fakeReq({ role: 'staff', published: PAID_PUBLISHED, orders: 3 })
    const data = { [PRODUCT_CONFIRMATIONS_KEY]: { freeCourse: true } }
    expect(await validatePriceInHUFEnabled(false, checkboxOpts({ req: forged.req, data }))).toBe(
      OWNER_ONLY_CHANGE_MESSAGE,
    )
  })

  it('zárás elleni védelem: a munkatárs a már közzétett ingyenes kurzust szabadon közzéteheti', async () => {
    const { req } = fakeReq({
      role: 'staff',
      published: { ...PAID_PUBLISHED, priceInHUFEnabled: false },
    })
    expect(await validatePriceInHUFEnabled(false, checkboxOpts({ req }))).toBe(true)
  })

  it('rev2: a munkatárs a kivett pipát csak akkor teheti közzé, ha a legutóbb közzétett állapot is ingyenes volt', async () => {
    // A közzététel visszavonása után a fő sor piszkozat; a mérce a napló
    // visszavonás előtti (élő) oldala.
    const free = { ...PAID_PUBLISHED, priceInHUFEnabled: false, priceInHUF: null }
    const unpublishedFree = { ...free, _status: 'draft' }
    const wasFree = fakeReq({
      role: 'staff',
      published: unpublishedFree,
      audit: [{ before: free, after: unpublishedFree }],
      orders: 0,
    })
    const noPrice = { priceInHUFEnabled: false, priceInHUF: null }
    const opts = (req: unknown) => checkboxOpts({ req, siblingData: noPrice, data: noPrice })
    expect(await validatePriceInHUFEnabled(false, opts(wasFree.req))).toBe(true)
    // Soha nem közzétett, ár és rendelés nélküli sor (az admin piszkozat-
    // másolata): a tulajdonos kiveheti a pipát, a munkatárs nem teheti közzé.
    const neverPublished = { ...unpublishedFree }
    const staff = fakeReq({ role: 'staff', published: neverPublished, audit: [], orders: 0 })
    expect(await validatePriceInHUFEnabled(false, opts(staff.req))).toBe(OWNER_ONLY_CHANGE_MESSAGE)
    const owner = fakeReq({ published: neverPublished, audit: [], orders: 0 })
    expect(await validatePriceInHUFEnabled(false, opts(owner.req))).toBe(true)
  })

  it('„már ingyenes” a tulajdonosnál csak a közzétett fő sor lehet, a napló pillanatképe nem', async () => {
    // Egy téves „már ingyenes” visszavonhatatlan hozzáféréseket adna, ezért a
    // napló (akár régi, ingyenes állapotú) bejegyzése itt nem kivétel.
    const { req } = fakeReq({
      published: { ...PAID_PUBLISHED, _status: 'draft', priceInHUFEnabled: false },
      audit: [{ after: { ...PAID_PUBLISHED, priceInHUFEnabled: false } }],
      orders: 0,
    })
    expect(await validatePriceInHUFEnabled(false, checkboxOpts({ req }))).toBe(
      FREE_COURSE_GUARD_MESSAGE,
    )
  })

  it('fail-closed: olvashatatlan közzétett sor vagy rendelésszám mellett megerősítést kér', async () => {
    const unreadable = fakeReq({ published: 'hiba', orders: 0 })
    expect(
      await validatePriceInHUFEnabled(
        false,
        checkboxOpts({ req: unreadable.req, siblingData: { priceInHUFEnabled: false } }),
      ),
    ).toBe(FREE_COURSE_GUARD_MESSAGE)
    const noCount = fakeReq({ published: { ...PAID_PUBLISHED, priceInHUF: null }, orders: 'hiba' })
    expect(
      await validatePriceInHUFEnabled(
        false,
        checkboxOpts({ req: noCount.req, siblingData: { priceInHUFEnabled: false } }),
      ),
    ).toBe(FREE_COURSE_GUARD_MESSAGE)
  })
})

describe('restoreVersionByNonOwnerStaysDraft: a munkatárs verzió-visszaállítása', () => {
  it('rev3: kérés-tranzakció nélkül (a fő sor nem zárolható) élő kurzuson is piszkozat marad', async () => {
    // A zár nélküli olvasás egy párhuzamos visszavonás mellett elavult élő
    // sort láthat (BRK-RACE, a DB-teszt méri); tranzakció nélkül a zár nem
    // tartana a mentésig, ezért a döntés fail-closed.
    const { req } = fakeReq({ role: 'staff', published: PAID_PUBLISHED })
    const hook = restoreVersionByNonOwnerStaysDraft as unknown as (args: unknown) => unknown
    const result = await hook({
      data: { _status: 'published', shortDescription: 'Régi leírás.' },
      operation: 'update',
      originalDoc: { id: 1 },
      req: { ...req, context: { isRestoringVersion: true } },
    })
    expect(result).toEqual({ _status: 'draft', shortDescription: 'Régi leírás.' })
  })
})

describe('validatePromoEnd: új akciót csak záró nappal (a-cms-9)', () => {
  function dateOpts(extra: Record<string, unknown>, sibling: Record<string, unknown>): DateOpts {
    return {
      data: sibling,
      siblingData: sibling,
      operation: 'update',
      id: 4,
      ...extra,
    } as unknown as DateOpts
  }

  it('új kurzuson bekapcsolt akció vég nélkül: hiba', async () => {
    const { req } = fakeReq()
    expect(
      await validatePromoEnd(
        null,
        dateOpts({ req, operation: 'create', id: undefined }, { promoEnabled: true }),
      ),
    ).toBe(PROMO_END_REQUIRED_MESSAGE)
  })

  it('eddig kikapcsolt vagy véggel közzétett akció vég nélkül: hiba', async () => {
    const off = fakeReq({ published: PAID_PUBLISHED })
    expect(await validatePromoEnd(null, dateOpts({ req: off.req }, { promoEnabled: true }))).toBe(
      PROMO_END_REQUIRED_MESSAGE,
    )
    const ended = fakeReq({
      published: { ...PAID_PUBLISHED, promoEnabled: true, promoEnd: '2026-10-31T12:00:00.000Z' },
    })
    expect(await validatePromoEnd(null, dateOpts({ req: ended.req }, { promoEnabled: true }))).toBe(
      PROMO_END_REQUIRED_MESSAGE,
    )
  })

  it('egy élő, vég nélküli akciós kurzus másolata (piszkozat-sor) közzétételkor véget kér', async () => {
    // A Payload duplikálása a fő sorba ír, _status: 'draft'-tal, validálás nélkül.
    const bare = fakeReq({ published: { _status: 'draft', promoEnabled: true, promoEnd: null } })
    expect(await validatePromoEnd(null, dateOpts({ req: bare.req }, { promoEnabled: true }))).toBe(
      PROMO_END_REQUIRED_MESSAGE,
    )
    const copyRow = {
      ...PAID_PUBLISHED,
      _status: 'draft',
      promoEnabled: true,
      promoEnd: null,
      promoPriceHuf: 39_500,
    }
    // A másolatnak csak a létrehozás naplóbejegyzése van, közzétett állapot nélkül.
    const copyOfProduct4 = fakeReq({ published: copyRow, audit: [{ after: copyRow }] })
    expect(
      await validatePromoEnd(null, dateOpts({ req: copyOfProduct4.req }, { promoEnabled: true })),
    ).toBe(PROMO_END_REQUIRED_MESSAGE)
  })

  it('a már közzétett, vég nélküli akció (az élő 4. kurzus) más mező mentésekor átmegy', async () => {
    const { req } = fakeReq({
      published: { ...PAID_PUBLISHED, promoEnabled: true, promoEnd: null, promoPriceHuf: 39_500 },
    })
    expect(await validatePromoEnd(null, dateOpts({ req }, { promoEnabled: true }))).toBe(true)
  })

  it('megadott vég és kikapcsolt akció: nincs hiba és nincs olvasás', async () => {
    const { req, findByID } = fakeReq()
    expect(
      validatePromoEnd(
        new Date('2026-12-31T12:00:00.000Z'),
        dateOpts({ req }, { promoEnabled: true }),
      ),
    ).toBe(true)
    expect(validatePromoEnd(null, dateOpts({ req }, { promoEnabled: false }))).toBe(true)
    expect(findByID).not.toHaveBeenCalled()
  })

  it('H2: a munkatárs a tulajdonos vég nélküli akció-piszkozatát nem teheti közzé, a meglévőt igen', async () => {
    const draftOnly = fakeReq({ role: 'staff', published: PAID_PUBLISHED })
    expect(
      await validatePromoEnd(null, dateOpts({ req: draftOnly.req }, { promoEnabled: true })),
    ).toBe(OWNER_ONLY_CHANGE_MESSAGE)
    const live = fakeReq({
      role: 'staff',
      published: { ...PAID_PUBLISHED, promoEnabled: true, promoEnd: null, promoPriceHuf: 39_500 },
    })
    expect(await validatePromoEnd(null, dateOpts({ req: live.req }, { promoEnabled: true }))).toBe(
      true,
    )
  })

  it('H3: a közzététel visszavonása után a meglévő, vég nélküli akció újra közzétehető', async () => {
    const product4 = {
      ...PAID_PUBLISHED,
      promoEnabled: true,
      promoEnd: null,
      promoPriceHuf: 39_500,
    }
    const unpublished = { ...product4, _status: 'draft' }
    const { req } = fakeReq({
      published: unpublished,
      audit: [{ before: product4, after: unpublished }],
    })
    expect(await validatePromoEnd(null, dateOpts({ req }, { promoEnabled: true }))).toBe(true)
    // Ha az utolsó közzétett állapotban nem volt vég nélküli akció, ez új akció.
    const added = fakeReq({
      published: unpublished,
      audit: [{ before: PAID_PUBLISHED, after: unpublished }],
    })
    expect(await validatePromoEnd(null, dateOpts({ req: added.req }, { promoEnabled: true }))).toBe(
      PROMO_END_REQUIRED_MESSAGE,
    )
  })

  it('olvasási hiba: fail-closed, hibát ad', async () => {
    const { req } = fakeReq({ published: 'hiba' })
    expect(await validatePromoEnd(null, dateOpts({ req }, { promoEnabled: true }))).toBe(
      PROMO_END_REQUIRED_MESSAGE,
    )
  })
})

describe('readProductConfirmations: csak a várt alakú megerősítés számít', () => {
  it('ismeretlen alak és kulcs eldobva', () => {
    expect(readProductConfirmations(null)).toEqual({})
    expect(readProductConfirmations([1])).toEqual({})
    expect(
      readProductConfirmations({
        priceInHUF: '29900',
        promoPriceHuf: 19.5,
        freeCourse: 'igen',
        egyeb: true,
      }),
    ).toEqual({})
    expect(
      readProductConfirmations({ priceInHUF: 29_900, promoPriceHuf: 19_900, freeCourse: true }),
    ).toEqual({ priceInHUF: 29_900, promoPriceHuf: 19_900, freeCourse: true })
  })
})

describe('products collection: a plugin ár-mezőinek bekötése', () => {
  async function build() {
    return runtime.override!({
      defaultCollection: {
        slug: 'products',
        fields: [
          {
            type: 'group',
            fields: [
              {
                type: 'row',
                fields: [
                  {
                    type: 'checkbox',
                    name: 'priceInHUFEnabled',
                    admin: { style: { flex: '0 0 auto' } },
                  },
                  {
                    type: 'number',
                    name: 'priceInHUF',
                    admin: {
                      readOnly: true,
                      components: {
                        Cell: '@payloadcms/plugin-ecommerce/client#PriceCell',
                        Field: '@payloadcms/plugin-ecommerce/rsc#PriceInput',
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
        versions: { drafts: { autosave: true } },
      },
    })
  }

  function flatten(fields: Field[]): Map<string, Field> {
    const out = new Map<string, Field>()
    for (const field of fields) {
      if ('name' in field && typeof field.name === 'string') out.set(field.name, field)
      if ('fields' in field) for (const [k, v] of flatten(field.fields)) out.set(k, v)
      if (field.type === 'tabs')
        for (const tab of field.tabs) for (const [k, v] of flatten(tab.fields)) out.set(k, v)
    }
    return out
  }

  const descriptionOf = (field: Field | undefined): string =>
    String((field?.admin as { description?: unknown } | undefined)?.description ?? '')

  it('Ár (Ft): saját validátor és forintos beviteli mező, a cella, a readOnly és az access marad', async () => {
    const price = flatten((await build()).fields).get('priceInHUF')
    expect(price?.type).toBe('number')
    expect(price && 'validate' in price ? price.validate : undefined).toBe(validatePriceInHUF)
    expect(price?.admin?.components?.Field).toEqual({
      path: '/components/admin/HufPriceField#HufPriceField',
      clientProps: { kind: 'rendes' },
    })
    expect(price?.admin?.components?.Cell).toBe('@payloadcms/plugin-ecommerce/client#PriceCell')
    expect((price?.admin as { readOnly?: boolean }).readOnly).toBe(true)
    expect(price && 'access' in price ? price.access?.update : undefined).toBe(isOwnerFieldAccess)
    expect(price && 'access' in price ? price.access?.create : undefined).toBe(isOwnerFieldAccess)
    expect(descriptionOf(price)).toContain('legalább 10 Ft')
  })

  it('Fizetős kurzus: új felirat, a súgó kimondja az ingyenességet és az Archivált utat', async () => {
    const enabled = flatten((await build()).fields).get('priceInHUFEnabled')
    expect(enabled).toMatchObject({ label: 'Fizetős kurzus' })
    expect(enabled && 'validate' in enabled ? enabled.validate : undefined).toBe(
      validatePriceInHUFEnabled,
    )
    expect(enabled?.admin?.components?.Field).toEqual({
      path: '/components/admin/HufPriceField#PaidCourseField',
    })
    expect((enabled?.admin as { style?: unknown }).style).toEqual({ flex: '0 0 auto' })
    expect(enabled && 'access' in enabled ? enabled.access?.update : undefined).toBe(
      isOwnerFieldAccess,
    )
    const description = descriptionOf(enabled)
    expect(description).toContain('Pipa nélkül a kurzus ingyenes')
    expect(description).toContain('bárki megkapja')
    expect(description).toContain('„Archivált”')
    expect(description).toContain('„Piszkozat”')
    expect(description).not.toContain('nem vásárolható meg')
  })

  it('Akciós ár: ugyanaz a beviteli mező, akciós változatban; a Hozzáférés hossza figyelmeztet', async () => {
    const fields = flatten((await build()).fields)
    const promo = fields.get('promoPriceHuf')
    expect(promo?.admin?.components?.Field).toEqual({
      path: '/components/admin/HufPriceField#HufPriceField',
      clientProps: { kind: 'akcios' },
    })
    expect(descriptionOf(promo)).toContain('legalább 10 Ft')
    const duration = descriptionOf(fields.get('accessDurationDays'))
    expect(duration).toContain('a módosítás a korábbi vásárlókra is érvényes')
    expect(duration).toContain('365 napra')
    expect(descriptionOf(fields.get('promoEnd'))).toContain('Bekapcsolt akciónál kötelező')
  })

  it('a felületi szövegekben nincs gondolatjel, ASCII idézőjel vagy verzál szó', () => {
    for (const text of [
      PRICE_MESSAGE,
      PROMO_PRICE_MESSAGE,
      PROMO_END_REQUIRED_MESSAGE,
      FREE_COURSE_GUARD_MESSAGE,
      OWNER_ONLY_CHANGE_MESSAGE,
      priceDropMessage('akcios', 3_950, 39_500),
      priceDropMessage('rendes', 7_950, 79_500, 'rendes', 'eddigi'),
    ]) {
      expect(text).not.toMatch(/[–—"]/)
      expect(text).not.toMatch(/(?<![\p{L}])[A-ZÁÉÍÓÖŐÚÜŰ]{2,}(?![\p{L}])/u)
      expect(text).not.toContain('vevő')
    }
  })
})

/**
 * A két új admin-komponens a generált importMap-ben (payload generate:importmap).
 * Hiányzó bejegyzésnél a Payload a mezőt nem tudja kirajzolni, és az Ár (Ft)
 * mező eltűnne a szerkesztőből; ez az őr ezt a lépést kéri számon.
 */
describe('generált importMap: az új ár-komponensek be vannak kötve', () => {
  const source = readFileSync(
    new URL('../app/(payload)/admin/importMap.js', import.meta.url),
    'utf8',
  )

  it.each(['HufPriceField', 'PaidCourseField'])('%s', (name) => {
    const entry = new RegExp(`"/components/admin/HufPriceField#${name}": (\\w+),`).exec(source)
    expect(entry, name).not.toBeNull()
    expect(source).toContain(
      `import { ${name} as ${entry?.[1]} } from '../../../components/admin/HufPriceField'`,
    )
  })
})
