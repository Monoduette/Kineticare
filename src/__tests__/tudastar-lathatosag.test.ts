import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MENUS_CACHE_TAG } from '../lib/cache-tags'

/**
 * A Tudástár-kapcsoló szerveroldali kérdése (src/lib/tudastar-lathatosag.ts):
 * - a menüket `overrideAccess: true`-val, `depth: 0`-val olvassa (a rejtett
 *   kapcsoló-sor is számít, az anonim olvasási szabály elrejtené);
 * - `unstable_cache` a `MENUS_CACHE_TAG` címkével (a Menus hookja üríti);
 * - a React `cache` a kérésen belüli hívásokat egyetlen olvasásra fogja össze;
 * - hibánál BEKAPCSOLT marad, logger.warn-nal.
 *
 * A Next- és a React-gyorsítótár itt kézzel vezérelt mock: a „kérés” a React
 * `cache` tárolója, az „adat-gyorsítótár” az `unstable_cache` tárolója, a
 * címke-ürítés (revalidateTag) pedig ennek törlése. Így számolható, hány
 * adatbázis-olvasás fut kérésenként.
 */

type AsyncFn = () => Promise<unknown>

const h = vi.hoisted(() => ({
  find: vi.fn<(args: Record<string, unknown>) => Promise<{ docs: unknown[] }>>(),
  warn: vi.fn(),
  cacheOptions: [] as Array<{ keyParts: string[]; tags?: string[]; revalidate?: number | false }>,
  /** Az `unstable_cache` tárolója kulcs szerint (a címke-ürítés ezt törli). */
  adatTar: new Map<string, unknown>(),
  /** A React `cache` tárolója: egy „kérés” élettartama. */
  keresTar: new Map<unknown, unknown>(),
}))

vi.mock('next/cache', () => ({
  unstable_cache: (
    fn: AsyncFn,
    keyParts: string[],
    options: { tags?: string[]; revalidate?: number | false },
  ) => {
    h.cacheOptions.push({ keyParts, ...options })
    const key = keyParts.join('|')
    return async () => {
      if (h.adatTar.has(key)) return h.adatTar.get(key)
      const value = await fn()
      h.adatTar.set(key, value)
      return value
    }
  },
}))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    cache:
      (fn: AsyncFn): AsyncFn =>
      () => {
        if (!h.keresTar.has(fn)) h.keresTar.set(fn, fn())
        return h.keresTar.get(fn) as Promise<unknown>
      },
  }
})

vi.mock('payload', () => ({ getPayload: async () => ({ find: h.find }) }))
vi.mock('../payload.config', () => ({ default: {} }))
vi.mock('../lib/logger', () => ({ logger: { warn: h.warn, info: vi.fn(), error: vi.fn() } }))

import { getTudastarLathato, TUDASTAR_REVALIDATE_SECONDS } from '../lib/tudastar-lathatosag'

const menuk = (...docs: Array<Record<string, unknown>>) => Promise.resolve({ docs })

/** Új „kérés”: a React `cache` tárolója üres. */
function ujKeres(): void {
  h.keresTar.clear()
}

/** A Menus afterChange hookjának hatása: a címkézett adat-gyorsítótár ürül. */
function menuMentes(): void {
  h.adatTar.clear()
}

beforeEach(() => {
  h.find.mockReset()
  h.warn.mockReset()
  ujKeres()
  menuMentes()
})

describe('getTudastarLathato — lekérdezés', () => {
  it('overrideAccess: true, depth: 0, csak a döntéshez kellő mezők, lapozás nélkül', async () => {
    h.find.mockImplementation(() => menuk())
    await getTudastarLathato()
    expect(h.find).toHaveBeenCalledTimes(1)
    expect(h.find).toHaveBeenCalledWith({
      collection: 'menus',
      depth: 0,
      pagination: false,
      overrideAccess: true,
      select: { type: true, url: true, visible: true, unlisted: true },
    })
  })

  it('az unstable_cache a menü-címkével és a fejléc-menü lejáratával (60 mp) él', () => {
    expect(TUDASTAR_REVALIDATE_SECONDS).toBe(60)
    expect(h.cacheOptions).toEqual([
      { keyParts: ['tudastar-lathato'], tags: [MENUS_CACHE_TAG], revalidate: 60 },
    ])
  })
})

describe('getTudastarLathato — a szabály az adatbázis soraira', () => {
  it('kapcsoló-menüpont nélkül BEKAPCSOLT', async () => {
    h.find.mockImplementation(() => menuk({ type: 'post', url: null, visible: true }))
    expect(await getTudastarLathato()).toBe(true)
  })

  it('rejtett /blog menüpont (visible=false) → KIKAPCSOLT', async () => {
    h.find.mockImplementation(() =>
      menuk({ type: 'url', url: '/blog', visible: false, unlisted: false }),
    )
    expect(await getTudastarLathato()).toBe(false)
  })

  it('rejtett link (unlisted=true) → KIKAPCSOLT', async () => {
    h.find.mockImplementation(() =>
      menuk({ type: 'url', url: '/blog/', visible: true, unlisted: true }),
    )
    expect(await getTudastarLathato()).toBe(false)
  })

  it('látható /blog menüpont → BEKAPCSOLT', async () => {
    h.find.mockImplementation(() =>
      menuk({ type: 'url', url: '/blog?utm=menu', visible: true, unlisted: false }),
    )
    expect(await getTudastarLathato()).toBe(true)
  })
})

describe('getTudastarLathato — gyorsítótár', () => {
  it('egy kérésen belül legfeljebb 1 menü-olvasás, akárhány hívásra', async () => {
    h.find.mockImplementation(() => menuk({ type: 'url', url: '/blog', visible: false }))
    const eredmenyek = await Promise.all([
      getTudastarLathato(),
      getTudastarLathato(),
      getTudastarLathato(),
    ])
    expect(eredmenyek).toEqual([false, false, false])
    expect(h.find).toHaveBeenCalledTimes(1)
  })

  it('a következő kérés az adat-gyorsítótárból jön, adatbázis-olvasás nélkül', async () => {
    h.find.mockImplementation(() => menuk({ type: 'url', url: '/blog', visible: false }))
    await getTudastarLathato()
    ujKeres()
    expect(await getTudastarLathato()).toBe(false)
    expect(h.find).toHaveBeenCalledTimes(1)
  })

  it('menü-mentés (címke-ürítés) után az első kérés már az új állapotot adja', async () => {
    h.find.mockImplementation(() => menuk({ type: 'url', url: '/blog', visible: false }))
    expect(await getTudastarLathato()).toBe(false)
    h.find.mockImplementation(() => menuk({ type: 'url', url: '/blog', visible: true }))
    menuMentes()
    ujKeres()
    expect(await getTudastarLathato()).toBe(true)
    expect(h.find).toHaveBeenCalledTimes(2)
  })
})

describe('getTudastarLathato — hiba esetén', () => {
  it('adatbázis-hibánál BEKAPCSOLT, és logger.warn jelez', async () => {
    h.find.mockImplementation(() => Promise.reject(new Error('kapcsolat megszakadt')))
    expect(await getTudastarLathato()).toBe(true)
    expect(h.warn).toHaveBeenCalledTimes(1)
    expect(h.warn.mock.calls[0]?.[1]).toEqual({ error: 'kapcsolat megszakadt' })
  })

  it('a hibás eredményt nem teszi el: a következő kérés újra próbálkozik', async () => {
    h.find.mockImplementationOnce(() => Promise.reject(new Error('átmeneti')))
    h.find.mockImplementation(() => menuk({ type: 'url', url: '/blog', unlisted: true }))
    expect(await getTudastarLathato()).toBe(true)
    ujKeres()
    expect(await getTudastarLathato()).toBe(false)
    expect(h.find).toHaveBeenCalledTimes(2)
  })
})
