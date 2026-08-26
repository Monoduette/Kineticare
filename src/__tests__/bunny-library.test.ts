import { afterEach, describe, expect, it, vi } from 'vitest'

import { optionalBunnyStreamEnvVars, requiredEnvVars } from '../env'
import {
  BUNNY_LIBRARY_API_KEY_ENV,
  BUNNY_PUBLIC_LIBRARY_API_KEY_ENV,
  BUNNY_SEARCH_MAX_LENGTH,
  listBunnyLibraryVideos,
  parseBunnyLibraryVideo,
  parseBunnyLibraryListPage,
  parseBunnyLibraryListPayload,
} from '../lib/stream/bunny-library'

/**
 * Bunny Stream library-lista — parser + injektált fetch, nincs valódi hálózat.
 */

const DUMMY_KEY = 'DUMMY-BUNNY-LIBRARY-KEY'

describe('Bunny library ENV — titok, nem kötelező, nem NEXT_PUBLIC', () => {
  it('a library API-kulcsok opcionálisak és nem döntik el az appot', () => {
    expect(optionalBunnyStreamEnvVars).toContain(BUNNY_LIBRARY_API_KEY_ENV)
    expect(optionalBunnyStreamEnvVars).toContain(BUNNY_PUBLIC_LIBRARY_API_KEY_ENV)
    expect(requiredEnvVars as readonly string[]).not.toContain(BUNNY_LIBRARY_API_KEY_ENV)
    expect(BUNNY_LIBRARY_API_KEY_ENV.startsWith('NEXT_PUBLIC_')).toBe(false)
    expect(BUNNY_PUBLIC_LIBRARY_API_KEY_ENV.startsWith('NEXT_PUBLIC_')).toBe(false)
  })
})

describe('parseBunnyLibraryVideo', () => {
  it('camelCase és PascalCase mezőket is elfogad', () => {
    const camel = parseBunnyLibraryVideo({
      guid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      title: '1. ALAPOK',
      length: 213,
      status: 4,
      dateUploaded: '2026-08-01T10:00:00Z',
    })
    expect(camel?.guid).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    expect(camel?.statusLabel).toBe('Kész')
    expect(camel?.lengthSec).toBe(213)

    const pascal = parseBunnyLibraryVideo({
      Guid: '11111111-2222-3333-4444-555555555555',
      Title: 'Előzetes',
      Length: 40,
      Status: 2,
    })
    expect(pascal?.title).toBe('Előzetes')
    expect(pascal?.statusLabel).toBe('Feldolgozás')
  })

  it('GUID nélkül null', () => {
    expect(parseBunnyLibraryVideo({ title: 'nincs id', status: 4 })).toBeNull()
  })
})

describe('parseBunnyLibraryListPayload', () => {
  it('az Items tömböt is olvassa', () => {
    const list = parseBunnyLibraryListPayload(
      {
        TotalItems: 1,
        Items: [
          { Guid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', Title: 'Lecke', Status: 4, Length: 10 },
        ],
      },
      { kind: 'protected', libraryId: '123' },
    )
    expect(list?.videos).toHaveLength(1)
    expect(list?.totalItems).toBe(1)
  })
})

describe('listBunnyLibraryVideos', () => {
  afterEach(() => {
    delete process.env.BUNNY_STREAM_LIBRARY_API_KEY
    delete process.env.NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID
  })

  it('hiányzó kulcs → not-configured, magyar üzenet, nincs fetch', async () => {
    delete process.env.BUNNY_STREAM_LIBRARY_API_KEY
    process.env.NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID = '123'
    const fetchImpl = vi.fn()
    const result = await listBunnyLibraryVideos({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      kind: 'protected',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('not-configured')
      expect(result.message).toContain('nincs bekötve')
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('siker: AccessKey fejléc megy, a lista parse-olódik, a kulcs NEM kerül a kimenetbe', async () => {
    process.env.BUNNY_STREAM_LIBRARY_API_KEY = DUMMY_KEY
    process.env.NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID = '4242'
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain('/library/4242/videos')
      const headers = init?.headers as Record<string, string>
      expect(headers.AccessKey).toBe(DUMMY_KEY)
      return {
        ok: true,
        status: 200,
        json: async () => ({
          totalItems: 1,
          items: [
            {
              guid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
              title: 'Lecke 1',
              status: 4,
              length: 90,
            },
          ],
        }),
      }
    })

    const result = await listBunnyLibraryVideos({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      kind: 'protected',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.list.videos[0]?.title).toBe('Lecke 1')
      expect(JSON.stringify(result)).not.toContain(DUMMY_KEY)
    }
  })

  it('nem numerikus libraryId → invalid-library-id, nincs fetch', async () => {
    process.env.BUNNY_STREAM_LIBRARY_API_KEY = DUMMY_KEY
    process.env.NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID = '../evil'
    const fetchImpl = vi.fn()
    const result = await listBunnyLibraryVideos({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      kind: 'protected',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('invalid-library-id')
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('túl hosszú keresés → invalid-search, nincs fetch', async () => {
    process.env.BUNNY_STREAM_LIBRARY_API_KEY = DUMMY_KEY
    process.env.NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID = '4242'
    const fetchImpl = vi.fn()
    const result = await listBunnyLibraryVideos({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      kind: 'protected',
      search: 'x'.repeat(BUNNY_SEARCH_MAX_LENGTH + 1),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe('invalid-search')
    }
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

/**
 * ŐR — A LAPOZÁS A NYERS OLDALMÉRETEN DŐL EL, NEM A PARSE-OLT HOSSZON.
 * A ciklus korábban a `parsed.videos.length < itemsPerPage` feltételre állt
 * meg. A parser a GUID nélküli sort ELDOBJA, ezért egy tele, 100-as oldal
 * egyetlen ilyen tétellel 99 videót adott: a lapozás „ez már nem tele oldal”
 * alapon megállt, a 2–5. oldal SOSEM jött be, és csonka-figyelmeztetés sem
 */

/** Egy szabályos videósor a Bunny válaszában. */
function videoRow(id: string) {
  return { guid: id, title: `Videó ${id}`, status: 4, length: 60 }
}

/** GUID nélküli sor: feltöltés alatti / hibás felvétel (status 0 vagy 6). */
const GUID_NELKULI_SOR = { title: 'Feltöltés alatt', status: 0, length: 0 }

function jsonPage(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

function rows(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => videoRow(`${prefix}-${index + 1}`))
}

describe('listBunnyLibraryVideos — lapozás GUID nélküli tétel mellett (F5 őr)', () => {
  afterEach(() => {
    delete process.env.BUNNY_STREAM_LIBRARY_API_KEY
    delete process.env.NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID
  })

  function setupEnv() {
    process.env.BUNNY_STREAM_LIBRARY_API_KEY = DUMMY_KEY
    process.env.NEXT_PUBLIC_BUNNY_STREAM_LIBRARY_ID = '4242'
  }

  it('tele oldal EGY GUID nélküli tétellel: a 2. oldal is bejön, és nincs néma veszteség', async () => {
    setupEnv()
    // 1. oldal: 100 NYERS tétel, ebből 99 szabályos + 1 GUID nélküli.
    const elsoOldal = {
      totalItems: 150,
      currentPage: 1,
      itemsPerPage: 100,
      items: [...rows('p1', 99), GUID_NELKULI_SOR],
    }
    // 2. oldal: 50 tétel — itt már tényleg vége a listának.
    const masodikOldal = {
      totalItems: 150,
      currentPage: 2,
      itemsPerPage: 100,
      items: rows('p2', 50),
    }
    const oldalak = [elsoOldal, masodikOldal]
    const fetchImpl = vi.fn(async () => jsonPage(oldalak.shift() ?? { items: [] }))
    const warn = vi.fn()

    const result = await listBunnyLibraryVideos({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      kind: 'protected',
      log: { warn },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(fetchImpl, 'a 2. oldal le sem kérdeződött').toHaveBeenCalledTimes(2)
    expect(result.list.videos).toHaveLength(149)
    expect(result.list.videos.map((video) => video.guid)).toContain('p2-50')
    // Az eldobott tétel nem tűnik el némán: számláló + napló.
    expect(result.list.droppedItems).toBe(1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[1]).toMatchObject({ droppedItemCount: 1, page: 1 })
    // A lista hiányos (egy tétel kimaradt), ezért a felület figyelmeztet.
    expect(result.list.truncated).toBe(true)
  })

  it('hiánytalan, nem tele oldal: egyetlen kérés, nincs csonka jelzés', async () => {
    setupEnv()
    const fetchImpl = vi.fn(async () =>
      jsonPage({ totalItems: 3, currentPage: 1, itemsPerPage: 100, items: rows('p1', 3) }),
    )
    const result = await listBunnyLibraryVideos({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      kind: 'protected',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(result.list.videos).toHaveLength(3)
    expect(result.list.truncated).toBe(false)
    expect(result.list.droppedItems).toBe(0)
  })

  it('a MAX_PAGES (5) kimerülése csonka listát jelez', async () => {
    setupEnv()
    let page = 0
    const fetchImpl = vi.fn(async () => {
      page += 1
      return jsonPage({
        totalItems: 1000,
        currentPage: page,
        itemsPerPage: 100,
        items: rows(`p${page}`, 100),
      })
    })
    const result = await listBunnyLibraryVideos({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      kind: 'protected',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(fetchImpl).toHaveBeenCalledTimes(5)
    expect(result.list.videos).toHaveLength(500)
    expect(result.list.truncated).toBe(true)
  })

  it('a lapozás megáll, ha a totalItems szerint minden nyers tétel megvan', async () => {
    setupEnv()
    let page = 0
    const fetchImpl = vi.fn(async () => {
      page += 1
      return jsonPage({
        totalItems: 200,
        currentPage: page,
        itemsPerPage: 100,
        items: rows(`p${page}`, 100),
      })
    })
    const result = await listBunnyLibraryVideos({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      kind: 'protected',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(fetchImpl, 'fölösleges 3. kérés ment ki').toHaveBeenCalledTimes(2)
    expect(result.list.videos).toHaveLength(200)
    expect(result.list.truncated).toBe(false)
  })

  it('a válasz által jelentett kisebb oldalméret is tele oldalnak számít', async () => {
    setupEnv()
    // A kért 100 helyett a Bunny 50-es lapokat ad: az 50 tétel TELE oldal,
    // tehát tovább kell lapozni. A régi (kért méretre néző) logika itt is
    // idő előtt megállt volna.
    let page = 0
    const fetchImpl = vi.fn(async () => {
      page += 1
      return jsonPage({
        totalItems: 120,
        currentPage: page,
        itemsPerPage: 50,
        items: rows(`p${page}`, page < 3 ? 50 : 20),
      })
    })
    const result = await listBunnyLibraryVideos({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      kind: 'protected',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(result.list.videos).toHaveLength(120)
    expect(result.list.truncated).toBe(false)
  })

  it('deps.page megadva: egyetlen kérés, a megadott oldalra, változatlan jelzésekkel', async () => {
    setupEnv()
    const kertUrlk: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      kertUrlk.push(url)
      return jsonPage({ totalItems: 130, currentPage: 2, itemsPerPage: 100, items: rows('p2', 30) })
    })
    const result = await listBunnyLibraryVideos({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      kind: 'protected',
      page: 2,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(kertUrlk[0]).toContain('page=2')
    expect(result.list.videos).toHaveLength(30)
    expect(result.list.truncated).toBe(false)
  })

  it('deps.page megadva tele oldallal: marad a korábbi csonka-jelzés', async () => {
    setupEnv()
    const fetchImpl = vi.fn(async () =>
      jsonPage({ totalItems: 500, currentPage: 2, itemsPerPage: 100, items: rows('p2', 100) }),
    )
    const result = await listBunnyLibraryVideos({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      kind: 'protected',
      page: 2,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(result.list.truncated).toBe(true)
  })
})

describe('parseBunnyLibraryListPage — nyers számok a lapozáshoz', () => {
  it('a nyers tételszám és az eldobott tételek száma külön látszik', () => {
    const page = parseBunnyLibraryListPage(
      {
        totalItems: 7,
        itemsPerPage: 100,
        items: [videoRow('a'), GUID_NELKULI_SOR, videoRow('b')],
      },
      { kind: 'protected', libraryId: '123' },
    )
    expect(page?.rawItemCount).toBe(3)
    expect(page?.droppedItemCount).toBe(1)
    expect(page?.pageSize).toBe(100)
    expect(page?.list.videos).toHaveLength(2)
    expect(page?.list.droppedItems).toBe(1)
  })

  it('érvénytelen itemsPerPage esetén nincs oldalméret (a kért méret marad a küszöb)', () => {
    const page = parseBunnyLibraryListPage(
      { itemsPerPage: 0, items: [videoRow('a')] },
      { kind: 'public', libraryId: '9' },
    )
    expect(page?.pageSize).toBeNull()
  })
})
