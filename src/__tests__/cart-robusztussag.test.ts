import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  addToCart,
  cartItemAvailability,
  cartStore,
  cartSummary,
  readCart,
  removeFromCart,
  writeCart,
  type CartItem,
} from '../lib/cart'

/**
 * ŐR — a kosár akkor is működik, ha a tároló ellenáll vagy hazudik.
 *
 * KÉT ÉLES HIBAOSZTÁLY:
 *  1. LETILTOTT localStorage (privát mód, sütitiltás, betelt kvóta): a
 *     `setItem` kivételt vet. A /kosar oldal `useEffect`-ből hívja az
 *     `add(initialItem)`-et (CartView), az effektben dobott kivételt pedig a
 *     React hibahatár fogja el — a vevő HIBAOLDALT látna a kosara helyett.
 *  2. SÉRÜLT tárolt tartalom (`null` elem, sztringgé romlott azonosító): a
 *     render `item.productId`-ra hivatkozik, a törlés/duplikáció-szűrés pedig
 *     SZIGORÚ (`===`) egyenlőséggel dolgozik — az előbbi kivételt dob, az
 *     utóbbi némán eltávolíthatatlan tételt hagy a kosárban.
 */

interface FakeStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

const globalWithWindow = globalThis as unknown as { window?: { localStorage: FakeStorage } }

/** Működő tároló + a memória-tartalék nullázása (a modul-állapot izolálása). */
function installWorkingStorage(): Map<string, string> {
  const entries = new Map<string, string>()
  globalWithWindow.window = {
    localStorage: {
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => {
        entries.set(key, value)
      },
      removeItem: (key) => {
        entries.delete(key)
      },
    },
  }
  writeCart({ items: [] })
  return entries
}

/** Írásra dobó tároló — a privát mód / sütitiltás viselkedése. */
function installWriteBlockedStorage(seed: string | null = null): void {
  globalWithWindow.window = {
    localStorage: {
      getItem: () => seed,
      setItem: () => {
        throw new Error('QuotaExceededError: the storage is disabled')
      },
      removeItem: () => undefined,
    },
  }
}

/** Olvasásra és írásra is dobó tároló (a legszigorúbb böngésző-beállítás). */
function installFullyBlockedStorage(): void {
  globalWithWindow.window = {
    localStorage: {
      getItem: () => {
        throw new Error('SecurityError: storage access denied')
      },
      setItem: () => {
        throw new Error('SecurityError: storage access denied')
      },
      removeItem: () => undefined,
    },
  }
}

const ITEM: CartItem = {
  productId: 42,
  sku: 'kez-rehab-alap',
  shortDescription: null,
  priceHuf: 19990,
  isFree: false,
}

const MASIK: CartItem = { ...ITEM, productId: 43, sku: 'kez-rehab-halado' }

describe('writeCart — letiltott tároló mellett sem dob', () => {
  beforeEach(() => {
    installWorkingStorage()
  })

  afterEach(() => {
    delete globalWithWindow.window
  })

  it('a mentés kivétele el van nyelve (a /kosar effektje nem fut hibaoldalra)', () => {
    installWriteBlockedStorage()
    expect(() => writeCart({ items: [ITEM] })).not.toThrow()
    expect(() => addToCart(MASIK)).not.toThrow()
    expect(() => removeFromCart(MASIK.productId)).not.toThrow()
  })

  it('a kosár az AKTUÁLIS lapon működik tovább (memóriában él)', () => {
    installWriteBlockedStorage()

    expect(addToCart(ITEM).items).toHaveLength(1)
    expect(readCart().items.map((item) => item.productId)).toEqual([42])

    // A második tétel is bekerül, a duplikáció-szűrés is dolgozik.
    expect(addToCart(MASIK).items).toHaveLength(2)
    expect(addToCart(ITEM).items).toHaveLength(2)

    // A sáv így valódi végösszeget és cél-tételt tud mondani.
    const summary = cartSummary(readCart())
    expect(summary.kind).toBe('amount')
    expect(summary.target?.productId).toBe(42)

    expect(removeFromCart(42).items.map((item) => item.productId)).toEqual([43])
  })

  it('a feliratkozók sikertelen mentés után is ÉRTESÜLNEK', () => {
    installWriteBlockedStorage()
    let notifications = 0
    const unsubscribe = cartStore.subscribe(() => {
      notifications += 1
    })

    const before = cartStore.getSnapshot()
    addToCart(ITEM)

    expect(notifications).toBe(1)
    expect(cartStore.getSnapshot()).not.toBe(before)
    expect(cartStore.getSnapshot().items).toHaveLength(1)
    unsubscribe()
  })

  it('olvasásra IS dobó tárolónál üres kosárral indul, és attól még használható', () => {
    installFullyBlockedStorage()
    expect(readCart()).toEqual({ items: [] })
    expect(addToCart(ITEM).items).toHaveLength(1)
    expect(readCart().items).toHaveLength(1)
  })

  it('a tároló helyreállása után ismét a tárolt tartalom az igazság', () => {
    installWriteBlockedStorage()
    addToCart(ITEM)
    expect(readCart().items).toHaveLength(1)

    // Új, működő tároló: a sikeres írás elengedi a memória-tartalékot.
    const entries = installWorkingStorage()
    expect(readCart()).toEqual({ items: [] })
    addToCart(MASIK)
    expect(entries.get('kineticare-cart-v1')).toContain('kez-rehab-halado')
  })
})

describe('readCart — a sérült tárolt tartalom kiszűrése', () => {
  let entries: Map<string, string>

  beforeEach(() => {
    entries = installWorkingStorage()
  })

  afterEach(() => {
    delete globalWithWindow.window
  })

  const tarol = (value: unknown): void => {
    entries.set('kineticare-cart-v1', JSON.stringify(value))
  }

  it('a `null` elem kimarad — a rá hivatkozó render nem dobhat', () => {
    tarol({ items: [null, ITEM] })
    const items = readCart().items
    expect(items).toHaveLength(1)
    expect(items[0]?.productId).toBe(42)
    // A render-úton hívott függvény sem dob a megmaradt tételre.
    expect(() => cartItemAvailability(items[0] as CartItem)).not.toThrow()
  })

  it('a nem objektum elem (sztring, szám, tömb) kimarad', () => {
    tarol({ items: ['42', 42, [], ITEM] })
    expect(readCart().items.map((item) => item.productId)).toEqual([42])
  })

  it('a nem SZÁM azonosítójú tétel kimarad (a `===` sosem találná meg)', () => {
    tarol({ items: [{ ...ITEM, productId: '42' }, ITEM] })
    expect(readCart().items).toHaveLength(1)
  })

  it('a nem véges vagy nem pozitív azonosító kimarad', () => {
    for (const productId of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
      tarol({ items: [{ ...ITEM, productId }] })
      expect(readCart().items).toHaveLength(0)
    }
  })

  it('érvényes tétel változatlanul (mezőstül) jön vissza', () => {
    tarol({ items: [ITEM, MASIK] })
    expect(readCart().items).toEqual([ITEM, MASIK])
  })

  it('értelmezhetetlen gyökér (nem objektum, hiányzó/rossz `items`) → üres kosár', () => {
    for (const value of [null, 42, 'kosar', [ITEM], { items: 'nem tomb' }, {}]) {
      tarol(value)
      expect(readCart()).toEqual({ items: [] })
    }
  })

  it('sérült JSON → üres kosár, kivétel nélkül', () => {
    entries.set('kineticare-cart-v1', '{"items":[')
    expect(readCart()).toEqual({ items: [] })
  })
})
