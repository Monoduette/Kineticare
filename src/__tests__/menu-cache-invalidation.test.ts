import { describe, expect, it, vi } from 'vitest'

import { Menus, revalidateMenusCache } from '../collections/Menus'
import { MENUS_CACHE_TAG } from '../lib/cache-tags'

/**
 * ŐR — a menü-gyorsítótár ürítése a szerkesztői mentéshez KÖTÖTT.
 *
 * A `getNavTree` kérések KÖZÖTT is gyorsítótáraz (`unstable_cache`, `menus`
 * címke). Érvénytelenítés nélkül a szerkesztő menü-módosítása percekig nem
 * látszana — ezért a Menus collection afterChange/afterDelete hookja üríti a
 * címkét. A hook a szerkesztői flow-ban fut, tehát SOSEM dobhat: a
 * `revalidateTag` kérés-környezet nélkül (seed, migráció, local API script)
 * hibát dob, és az a mentést vinné el.
 */

const HOOK_ARGS = { doc: { id: 1, label: 'Kurzusok' } }

/** A regisztrált hook meghívása a Payload argumentum-alakjával. */
function callHook(hook: unknown): unknown {
  const fn = hook as (args: typeof HOOK_ARGS) => unknown
  return fn(HOOK_ARGS)
}

describe('revalidateMenusCache', () => {
  it('a `menus` címkét AZONNALI lejárattal üríti', () => {
    const revalidate = vi.fn()
    expect(revalidateMenusCache({ revalidate })).toBe(true)
    expect(revalidate).toHaveBeenCalledTimes(1)
    expect(revalidate).toHaveBeenCalledWith(MENUS_CACHE_TAG, { expire: 0 })
  })

  it('a címke ugyanaz a konstans, amit az olvasó oldal használ', () => {
    expect(MENUS_CACHE_TAG).toBe('menus')
  })

  it('NEM dob, ha nincs kérés-környezet — a mentés nem hiúsulhat meg miatta', () => {
    const warn = vi.fn()
    const revalidate = vi.fn(() => {
      throw new Error('Invariant: static generation store missing in revalidateTag menus')
    })

    expect(revalidateMenusCache({ revalidate, log: { warn } })).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('menü-gyorsítótár')
  })
})

describe('Menus collection — a hookok be vannak kötve', () => {
  it('afterChange és afterDelete is pontosan egy hookot futtat', () => {
    expect(Menus.hooks?.afterChange).toHaveLength(1)
    expect(Menus.hooks?.afterDelete).toHaveLength(1)
  })

  it('a beforeValidate lánc érintetlen marad', () => {
    expect(Menus.hooks?.beforeValidate).toHaveLength(1)
  })

  it('a hookok a dokumentumot VÁLTOZATLANUL adják vissza', () => {
    expect(callHook(Menus.hooks?.afterChange?.[0])).toBe(HOOK_ARGS.doc)
    expect(callHook(Menus.hooks?.afterDelete?.[0])).toBe(HOOK_ARGS.doc)
  })
})
