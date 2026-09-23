import { readFileSync } from 'node:fs'

import { createElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ŐR: A KEZDŐLAP BELÉPÉSI ÚTJAI (`/admin/kezdolap`, `/admin/kezdolap-video`)
 * ÉS AZ IRÁNYÍTÓPULT „GYAKORI TEENDŐK” PANELJE.
 *
 * A Payload 3.88 a saját nézeteket NYILVÁNOS admin-útvonalként kezeli, ezért a
 * két átirányító nézet szerepkör-kapuja az egyetlen védelem: be nem
 * jelentkezett és vásárlói fiók se azonosítót, se tartalmat nem kaphat, és a
 * lekérdezés sem indulhat el (a StatisticsView kapu-őrének mintája,
 * admin-nezet-kapu-kotes.test.tsx). Munkatárs és tulajdonos a kezdőlap
 * szerkesztőjébe jut; a videószöveg-nézet a nyitó videó szekció mélylinkjével.
 */

class Atiranyitas extends Error {
  constructor(readonly cel: string) {
    super(`NEXT_REDIRECT ${cel}`)
  }
}

vi.mock('next/navigation', () => ({
  redirect: (cel: string) => {
    throw new Atiranyitas(cel)
  },
}))

vi.mock('../components/admin/AdminChrome', () => ({
  AdminChrome: ({ children }: { children: ReactNode }) =>
    createElement('div', { 'data-keret': 'chrome' }, children),
  AdminViewFrame: ({ children }: { children: ReactNode }) =>
    createElement('div', { 'data-keret': 'frame' }, children),
}))

const naplo = vi.hoisted(() => {
  const csonk = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), child: vi.fn() }
  // A valódi config betöltésekor a modulok gyermek-naplót kérnek (logger.child).
  csonk.child.mockImplementation(() => csonk)
  return csonk
})
vi.mock('../lib/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/logger')>()),
  logger: naplo,
}))

const { KezdolapNezet, KEZDOLAP_ELUTASITAS, KEZDOLAP_HIANYZIK, KEZDOLAP_NEM_ELERHETO } =
  await import('../components/admin/KezdolapNezet')
const { VideoSzovegeiNezet, VIDEO_SZOVEGEI_ELUTASITAS, NINCS_NYITO_VIDEO } =
  await import('../components/admin/VideoSzovegeiNezet')
const {
  ADMIN_UTAK,
  KEZDOLAP_SLUG,
  NYITO_VIDEO_BLOKKTIPUS,
  kezdolapCelFeloldasa,
  payloadKezdolapLekerdezo,
} = await import('../components/admin/KezdolapCel')
const {
  GyakoriTeendok,
  GYAKORI_TEENDOK,
  gyujtemenyOldalsavNeve,
  lathatoTeendok,
  teendoCime,
  FO_OLDALAK,
  FO_OLDALAK_CIM,
  FO_OLDALAK_SZOVEG,
  FoOldalakGyorslinkjei,
  foOldalakFeloldasa,
  foOldalHref,
  payloadFoOldalakLekerdezo,
} = await import('../components/admin/GyakoriTeendok')

type GyakoriProps = Parameters<typeof GyakoriTeendok>[0]

/** Az async szerver-komponens kimenete statikus HTML-ként (null → ''). */
async function htmlje(elem: Promise<ReactElement | null>): Promise<string> {
  const kesz = await elem
  return kesz === null ? '' : renderToStaticMarkup(kesz)
}

const HERO_ID = '6ab2d1c655cfcd3e03073521'
const KEZDOLAP = {
  id: 1,
  slug: 'kezdolap',
  layout: [
    { id: '6ab2d1c655cfcd3e03073525', blockType: 'credsStrip' },
    { id: HERO_ID, blockType: 'filmHero' },
    { id: '6ab2d1c655cfcd3e03073540', blockType: 'filmHero' },
  ],
}

type Szerep = { role: string } | null

function props(user: Szerep, find: ReturnType<typeof vi.fn>, adminRoute = '/admin') {
  return {
    initPageResult: {
      req: { user, payload: { find, config: { routes: { admin: adminRoute } } } },
    },
    params: {},
    searchParams: {},
    user,
  } as unknown as Parameters<typeof KezdolapNezet>[0]
}

async function futtat(
  nezet: typeof KezdolapNezet | typeof VideoSzovegeiNezet,
  user: Szerep,
  find: ReturnType<typeof vi.fn>,
): Promise<{ html: string | null; cel: string | null }> {
  try {
    const elem = await nezet(props(user, find))
    return { html: renderToStaticMarkup(elem), cel: null }
  } catch (hiba) {
    if (hiba instanceof Atiranyitas) {
      return { html: null, cel: hiba.cel }
    }
    throw hiba
  }
}

const TILTOTT: Array<[string, Szerep]> = [
  ['bejelentkezés nélkül', null],
  ['vevőként (customer)', { role: 'customer' }],
]
const ENGEDETT: Array<[string, Szerep]> = [
  ['munkatársként (staff)', { role: 'staff' }],
  ['tulajdonosként (owner)', { role: 'owner' }],
]

describe('/admin/kezdolap: a kapu a lekérdezés ELŐTT zár', () => {
  let find: ReturnType<typeof vi.fn>
  beforeEach(() => {
    find = vi.fn(async () => ({ docs: [KEZDOLAP] }))
    naplo.error.mockClear()
  })

  for (const [nev, user] of TILTOTT) {
    it(`${nev}: magyar elutasítás, lekérdezés, azonosító és átirányítás nélkül`, async () => {
      const { html, cel } = await futtat(KezdolapNezet, user, find)
      expect(cel).toBeNull()
      expect(find, 'a kezdőlap-lekérdezés lefutott a tiltott ágon').not.toHaveBeenCalled()
      expect(html).toContain(KEZDOLAP_ELUTASITAS)
      expect(html).toContain('data-keret="frame"')
      expect(html).not.toContain('collections/pages/1')
      expect(html).not.toContain(HERO_ID)
    })
  }

  it('be nem jelentkezett látogató belépési linket kap, amely ide hoz vissza', async () => {
    const { html } = await futtat(KezdolapNezet, null, find)
    expect(html).toContain('href="/admin/login?redirect=%2Fadmin%2Fkezdolap"')
  })

  it('vásárlói fiók nem kap belépési linket (már be van lépve)', async () => {
    const { html } = await futtat(KezdolapNezet, { role: 'customer' }, find)
    expect(html).not.toContain('/admin/login')
  })

  for (const [nev, user] of ENGEDETT) {
    it(`${nev}: a kezdőlap szerkesztőjébe irányít`, async () => {
      const { cel } = await futtat(KezdolapNezet, user, find)
      expect(cel).toBe('/admin/collections/pages/1')
    })
  }

  it('a lekérdezés a kérés felhasználójával, a legújabb változaton fut, slug alapján', async () => {
    await futtat(KezdolapNezet, { role: 'staff' }, find)
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'pages',
        where: { slug: { equals: 'kezdolap' } },
        draft: true,
        depth: 0,
        limit: 1,
        overrideAccess: false,
      }),
    )
    const [argumentumok] = find.mock.calls[0] as [{ req: { user: unknown } }]
    expect(argumentumok.req.user).toEqual({ role: 'staff' })
  })

  it('kezdőlap nélkül magyar üzenet és link az Oldalak listára', async () => {
    const ures = vi.fn(async () => ({ docs: [] }))
    const { html, cel } = await futtat(KezdolapNezet, { role: 'owner' }, ures)
    expect(cel).toBeNull()
    expect(html).toContain(KEZDOLAP_HIANYZIK)
    expect(html).toContain('href="/admin/collections/pages"')
    expect(html).toContain('data-keret="chrome"')
  })

  it('adatbázis-hibánál naplóz és magyar üzenetet ad, nem 500-at', async () => {
    const hibas = vi.fn(async () => {
      throw new Error('connection terminated')
    })
    const { html } = await futtat(KezdolapNezet, { role: 'staff' }, hibas)
    expect(html).toContain(KEZDOLAP_NEM_ELERHETO)
    expect(naplo.error).toHaveBeenCalledTimes(1)
  })

  it('a config admin-útvonalát használja', async () => {
    try {
      await KezdolapNezet(props({ role: 'staff' }, find, '/kezelo'))
      expect.unreachable('átirányításnak kellett volna történnie')
    } catch (hiba) {
      expect(hiba).toBeInstanceOf(Atiranyitas)
      expect((hiba as Atiranyitas).cel).toBe('/kezelo/collections/pages/1')
    }
  })
})

describe('/admin/kezdolap-video: ugyanaz a kapu, mélylinkkel', () => {
  let find: ReturnType<typeof vi.fn>
  beforeEach(() => {
    find = vi.fn(async () => ({ docs: [KEZDOLAP] }))
  })

  for (const [nev, user] of TILTOTT) {
    it(`${nev}: magyar elutasítás, lekérdezés és azonosító nélkül`, async () => {
      const { html, cel } = await futtat(VideoSzovegeiNezet, user, find)
      expect(cel).toBeNull()
      expect(find).not.toHaveBeenCalled()
      expect(html).toContain(VIDEO_SZOVEGEI_ELUTASITAS)
      expect(html).not.toContain(HERO_ID)
    })
  }

  for (const [nev, user] of ENGEDETT) {
    it(`${nev}: az ELSŐ nyitó videó szekció mélylinkjére irányít`, async () => {
      const { cel } = await futtat(VideoSzovegeiNezet, user, find)
      expect(cel).toBe(`/admin/collections/pages/1?szekcio=${HERO_ID}`)
    })
  }

  it('nyitó videó nélkül magyar üzenet, link a kezdőlap szerkesztőjére', async () => {
    const hero = vi.fn(async () => ({
      docs: [{ ...KEZDOLAP, layout: [{ id: HERO_ID, blockType: 'credsStrip' }] }],
    }))
    const { html, cel } = await futtat(VideoSzovegeiNezet, { role: 'staff' }, hero)
    expect(cel).toBeNull()
    expect(html).toContain(NINCS_NYITO_VIDEO)
    expect(html).toContain('Nyitó videó (kéznyitás)')
    expect(html).toContain('href="/admin/collections/pages/1"')
  })

  it('kezdőlap nélkül ugyanaz a magyar üzenet, mint a Kezdőlap nézeten', async () => {
    const { html } = await futtat(
      VideoSzovegeiNezet,
      { role: 'staff' },
      vi.fn(async () => ({ docs: [] })),
    )
    expect(html).toContain(KEZDOLAP_HIANYZIK)
  })
})

describe('KezdolapCel: a tiszta feloldó', () => {
  it('az első nyitó videó szekciót adja', async () => {
    await expect(kezdolapCelFeloldasa(async () => ({ docs: [KEZDOLAP] }))).resolves.toEqual({
      allapot: 'megvan',
      oldalId: 1,
      vanNyitoVideo: true,
      nyitoVideoBlokkId: HERO_ID,
    })
  })

  it('hiányzó oldal, hibás azonosító és hibás adat', async () => {
    await expect(kezdolapCelFeloldasa(async () => ({ docs: [] }))).resolves.toEqual({
      allapot: 'nincs-kezdolap',
    })
    await expect(kezdolapCelFeloldasa(async () => ({ docs: [{ slug: 'x' }] }))).resolves.toEqual({
      allapot: 'nincs-kezdolap',
    })
    await expect(
      kezdolapCelFeloldasa(async () => ({
        docs: [{ id: 5, layout: [{ id: 'nem-objectid', blockType: 'filmHero' }] }],
      })),
    ).resolves.toEqual({
      allapot: 'megvan',
      oldalId: 5,
      vanNyitoVideo: true,
      nyitoVideoBlokkId: null,
    })
    await expect(kezdolapCelFeloldasa(async () => ({ docs: [{ id: 5 }] }))).resolves.toEqual({
      allapot: 'megvan',
      oldalId: 5,
      vanNyitoVideo: false,
      nyitoVideoBlokkId: null,
    })
  })

  it('a lekérdezés hibáját nem nyeli el (a nézet naplózza)', async () => {
    await expect(
      kezdolapCelFeloldasa(async () => {
        throw new Error('db')
      }),
    ).rejects.toThrow('db')
  })

  it('a valódi lekérdező a kérés objektumát adja tovább (tranzakció és felhasználó)', async () => {
    const find = vi.fn(async () => ({ docs: [] }))
    const req = { user: { role: 'staff' }, payload: { find } }
    await payloadKezdolapLekerdezo(req as never)()
    expect(find).toHaveBeenCalledWith(expect.objectContaining({ req, overrideAccess: false }))
  })

  it('a slug és a blokktípus a seed és a blokk szerződése', () => {
    expect(KEZDOLAP_SLUG).toBe('kezdolap')
    expect(NYITO_VIDEO_BLOKKTIPUS).toBe('filmHero')
    const blokk = readFileSync(new URL('../blocks/film-hero.ts', import.meta.url), 'utf8')
    expect(blokk).toContain("slug: 'filmHero'")
  })
})

describe('Gyakori teendők panel (Irányítópult, K32)', () => {
  const minden = {
    collections: {
      pages: { read: true },
      products: { read: true },
      menus: { read: true },
      'form-submissions': { read: true },
    },
  }
  const payload = {
    find: vi.fn(async () => ({ docs: [] })),
    config: { routes: { admin: '/admin' } },
  } as unknown as GyakoriProps['payload']

  it('4–6 feladat, köztük a kezdőlap és a videó szövegei, mindegyik magyarázattal', () => {
    expect(GYAKORI_TEENDOK.length).toBeGreaterThanOrEqual(4)
    expect(GYAKORI_TEENDOK.length).toBeLessThanOrEqual(6)
    const cimek = GYAKORI_TEENDOK.map((teendo) => teendo.cim)
    expect(cimek).toContain(ADMIN_UTAK.kezdolap.felirat)
    expect(cimek).toContain(ADMIN_UTAK.videoSzovegei.felirat)
    for (const teendo of GYAKORI_TEENDOK) {
      expect(teendo.leiras.length, teendo.cim).toBeGreaterThan(20)
      expect(teendo.leiras, teendo.cim).toMatch(/\.$/)
      expect(`${teendo.cim} ${teendo.leiras}`, 'gondolatjel').not.toMatch(/[–—]/)
      expect(teendo.leiras, 'felkiáltójel').not.toContain('!')
    }
  })

  it('vásárlónak és be nem jelentkezettnek semmit nem rajzol', async () => {
    expect(lathatoTeendok(null, minden)).toEqual([])
    expect(lathatoTeendok({ role: 'customer' }, minden)).toEqual([])
    expect(
      await htmlje(GyakoriTeendok({ payload, permissions: minden, user: { role: 'customer' } })),
    ).toBe('')
  })

  it('csak az olvasható gyűjtemények feladatait mutatja', () => {
    const teendok = lathatoTeendok({ role: 'staff' }, { collections: { pages: { read: true } } })
    expect(teendok.map((teendo) => teendo.kulcs)).toEqual([
      'kezdolap',
      'video-szovegei',
      'statisztika',
    ])
  })

  it('a gyűjtemény-kártya címe a config oldalsáv-nevéből jön (ugyanaz a forrás, mint az oldalsávé)', async () => {
    const gyujtemenyek = [
      { slug: 'products', labels: { plural: 'Kurzusok' } },
      { slug: 'menus', labels: { plural: 'Navigációs pontok' } },
      { slug: 'form-submissions', labels: { plural: { hu: 'fordítási objektum' } } },
    ]
    const html = await htmlje(
      GyakoriTeendok({
        payload: {
          ...payload,
          config: { ...payload.config, collections: gyujtemenyek },
        },
        permissions: minden,
        user: { role: 'staff' },
      }),
    )
    expect(html).toContain('>Kurzusok és árak</a>')
    expect(html).toContain('>Navigációs pontok</a>')
    // Nem szöveges címkénél a konstans tartalék áll.
    expect(html).toContain('>Űrlapbeküldések</a>')
    expect(gyujtemenyOldalsavNeve(gyujtemenyek, 'form-submissions')).toBeNull()
    expect(gyujtemenyOldalsavNeve(gyujtemenyek, 'nincs-ilyen')).toBeNull()
    expect(
      gyujtemenyOldalsavNeve([{ slug: 'menus', labels: { plural: '  ' } }], 'menus'),
    ).toBeNull()
  })

  it('SC 3.2.4: minden kártya címe a cél oldalsáv-nevével kezdődik (a VALÓDI config címkéivel)', async () => {
    const { default: configPromise } = await import('../payload.config')
    const config = await configPromise
    const gyujtemenyek = config.collections.map((gyujtemeny) => ({
      slug: gyujtemeny.slug,
      labels: { plural: gyujtemeny.labels?.plural as unknown },
    }))
    const sajatNezetek = new Map<string, string>(
      Object.values(ADMIN_UTAK).map((ut) => [ut.utvonal, ut.felirat]),
    )
    for (const teendo of GYAKORI_TEENDOK) {
      const cim = teendoCime(teendo, gyujtemenyek)
      if (teendo.cimAGyujtemenybol) {
        const oldalsav = gyujtemenyOldalsavNeve(gyujtemenyek, teendo.gyujtemeny ?? '')
        expect(oldalsav, `${teendo.kulcs}: a gyűjtemény címkéje nem szöveg`).not.toBeNull()
        expect(teendo.utvonal).toBe(`/collections/${String(teendo.gyujtemeny)}`)
        expect(cim.startsWith(String(oldalsav)), `${cim} ↔ ${String(oldalsav)}`).toBe(true)
        // A konstans tartalék is ugyanaz, ha a config címkéje egyszer nem lenne olvasható.
        expect(teendo.cim, teendo.kulcs).toBe(cim)
      } else {
        expect(sajatNezetek.get(teendo.utvonal), teendo.kulcs).toBe(cim)
      }
    }
    expect(GYAKORI_TEENDOK.find((teendo) => teendo.kulcs === 'menu')?.cim).toBe('Menüpontok')
    expect(GYAKORI_TEENDOK.find((teendo) => teendo.kulcs === 'urlapok')?.cim).toBe(
      'Űrlapbeküldések',
    )
  }, 60_000)

  it('a kártya linkje a cím, a leírás aria-describedby-jal kapcsolódik, a célok helyesek', async () => {
    const html = await htmlje(
      GyakoriTeendok({ payload, permissions: minden, user: { role: 'owner' } }),
    )
    expect(html).toContain('<h2 class="kc-gyakori-teendok__cim" id="kc-gyakori-teendok-cim">')
    for (const [utvonal, kulcs] of [
      ['/admin/kezdolap', 'kezdolap'],
      ['/admin/kezdolap-video', 'video-szovegei'],
      ['/admin/collections/products', 'kurzusok'],
      ['/admin/collections/menus', 'menu'],
      ['/admin/collections/form-submissions', 'urlapok'],
      ['/admin/statisztika', 'statisztika'],
    ]) {
      expect(html).toContain(`aria-describedby="kc-gyakori-teendo-${kulcs}"`)
      expect(html).toContain(`href="${utvonal}"`)
      expect(html).toContain(`id="kc-gyakori-teendo-${kulcs}"`)
    }
  })
})

/**
 * A fő oldalak gyorslinkje (modul-térkép H08): EGY lekérdezés slug alapján,
 * a kérés felhasználójával; csak a megtalált oldalak, rögzített sorrendben; a
 * link neve a menüben látható név, mellette az oldal Címe; a Kezdőlap célja
 * és neve az oldalsávéval azonos; csak munkatárs és tulajdonos látja.
 */
describe('Fő oldalak gyorslinkje (Irányítópult és Oldalak lista, H08)', () => {
  // A helyi adatbázis mért sorai (2026-09-23), szándékosan kevert sorrendben,
  // a bemutatkozas oldal NÉLKÜL (élőben nincs ilyen oldal).
  const OLDALAK = [
    { id: 5, slug: 'kapcsolat', title: 'Kapcsolat' },
    { id: 3, slug: 'rolunk', title: 'A kéz a mindenünk' },
    {
      id: 1,
      slug: 'kezdolap',
      title: 'Hatékony és biztonságos módszerek a kéz és a kar fájdalmai ellen',
    },
    {
      id: 4,
      slug: 'szolgaltatasok',
      title: 'A kezed folyton dolgozik, segítünk, hogy közben ne fájjon',
    },
  ]
  const olvas = { collections: { pages: { read: true } } }
  let find: ReturnType<typeof vi.fn>
  let fetchKem: ReturnType<typeof vi.fn>

  function payloadMock(adminRoute = '/admin'): GyakoriProps['payload'] {
    return { find, config: { routes: { admin: adminRoute } } } as unknown as GyakoriProps['payload']
  }

  beforeEach(() => {
    find = vi.fn(async () => ({ docs: OLDALAK }))
    naplo.error.mockClear()
    // Tesztből hálózati kérés nem mehet ki (CLAUDE.md 15.); ha a komponens
    // mégis fetch-et hívna, ez hangosan bukik.
    fetchKem = vi.fn(() => {
      throw new Error('fetch nem hívható')
    })
    vi.stubGlobal('fetch', fetchKem)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('a feloldás: rögzített sorrend, a hiányzó oldal kimarad, nevek, azonosítók és Címek', async () => {
    const lekerdezo = vi.fn(async () => ({
      docs: [
        ...OLDALAK,
        // ugyanaz a webcím még egyszer: az első találat nyer
        { id: 99, slug: 'rolunk', title: 'Másodpéldány' },
        // hibás adat: kimarad
        { slug: 'bemutatkozas' },
        null,
        { id: 7, slug: 'nem-fo-oldal', title: 'Impresszum' },
      ],
    }))
    const talalatok = await foOldalakFeloldasa(lekerdezo)

    expect(lekerdezo).toHaveBeenCalledTimes(1)
    expect(lekerdezo).toHaveBeenCalledWith(FO_OLDALAK.map((oldal) => oldal.slug))
    expect(talalatok.map((t) => [t.slug, t.nev, t.oldalId, t.cim])).toEqual([
      [
        'kezdolap',
        'Kezdőlap',
        1,
        'Hatékony és biztonságos módszerek a kéz és a kar fájdalmai ellen',
      ],
      [
        'szolgaltatasok',
        'Szolgáltatások',
        4,
        'A kezed folyton dolgozik, segítünk, hogy közben ne fájjon',
      ],
      ['rolunk', 'Rólunk', 3, 'A kéz a mindenünk'],
      ['kapcsolat', 'Kapcsolat', 5, 'Kapcsolat'],
    ])
  })

  it('a menü sorrendje és nevei; üres Cím null; a hiba nem nyelődik el', async () => {
    expect(FO_OLDALAK.map((oldal) => [oldal.slug, oldal.nev])).toEqual([
      ['kezdolap', 'Kezdőlap'],
      ['bemutatkozas', 'Bemutatkozás'],
      ['szolgaltatasok', 'Szolgáltatások'],
      ['rolunk', 'Rólunk'],
      ['kapcsolat', 'Kapcsolat'],
    ])
    const talalatok = await foOldalakFeloldasa(async () => ({
      docs: [{ id: 2, slug: 'bemutatkozas', title: '   ' }],
    }))
    expect(talalatok).toEqual([
      { slug: 'bemutatkozas', nev: 'Bemutatkozás', oldalId: 2, cim: null },
    ])
    await expect(foOldalakFeloldasa(async () => ({ docs: [] }))).resolves.toEqual([])
    await expect(
      foOldalakFeloldasa(async () => {
        throw new Error('db')
      }),
    ).rejects.toThrow('db')
  })

  it('a Kezdőlap neve és célja az oldalsáv „Kezdőlap” linkjéé (SC 3.2.4), a többi a szerkesztő', () => {
    const [kezdolap] = FO_OLDALAK
    expect(kezdolap?.nev).toBe(ADMIN_UTAK.kezdolap.felirat)
    expect(
      foOldalHref('/admin', {
        slug: 'kezdolap',
        nev: 'Kezdőlap',
        cim: 'x',
        oldalId: 1,
        sajatUtvonal: kezdolap?.sajatUtvonal,
      }),
    ).toBe(`/admin${ADMIN_UTAK.kezdolap.utvonal}`)
    expect(foOldalHref('/admin/', { slug: 'rolunk', nev: 'Rólunk', cim: 'x', oldalId: 3 })).toBe(
      '/admin/collections/pages/3',
    )
  })

  it('a valódi lekérdező EGY Local API-hívás: slug in, a felhasználó jogaival, a legújabb változaton', async () => {
    const user = { role: 'staff' }
    await payloadFoOldalakLekerdezo(payloadMock(), user)(['kezdolap', 'rolunk'])
    expect(find).toHaveBeenCalledTimes(1)
    expect(find).toHaveBeenCalledWith({
      collection: 'pages',
      where: { slug: { in: ['kezdolap', 'rolunk'] } },
      draft: true,
      depth: 0,
      pagination: false,
      select: { title: true, slug: true },
      overrideAccess: false,
      user,
    })
  })

  const TILTOTT_GYORSLINK: Array<[string, Szerep, GyakoriProps['permissions']]> = [
    ['bejelentkezés nélkül', null, olvas],
    ['vásárlóként (customer)', { role: 'customer' }, olvas],
    ['munkatársként, de az Oldalak olvasási joga nélkül', { role: 'staff' }, { collections: {} }],
  ]
  for (const [nev, user, permissions] of TILTOTT_GYORSLINK) {
    it(`${nev}: semmit nem rajzol, és lekérdezés sem indul`, async () => {
      for (const elhelyezes of ['lista', 'panel'] as const) {
        expect(
          await htmlje(
            FoOldalakGyorslinkjei({ payload: payloadMock(), permissions, user, elhelyezes }),
          ),
        ).toBe('')
      }
      expect(find).not.toHaveBeenCalled()
    })
  }

  for (const [nev, user] of ENGEDETT) {
    it(`${nev}: az Oldalak lista fölött a tájékoztató dobozban, címsor nélkül`, async () => {
      const html = await htmlje(
        FoOldalakGyorslinkjei({ payload: payloadMock(), permissions: olvas, user }),
      )

      expect(find).toHaveBeenCalledTimes(1)
      // Címmel ellátott <nav>: a Payload a lista elemeit tájékozódási ponton kívül
      // rajzolja, így az axe `region` szabálya a nav nélkül ezt is jelezné (mérve).
      expect(html).toContain(
        '<nav aria-labelledby="kc-fo-oldalak-cim-lista" class="kc-admin-notice kc-fo-oldalak" data-elhelyezes="lista">',
      )
      expect(html).toContain(
        `<p class="kc-admin-notice__cim" id="kc-fo-oldalak-cim-lista">${FO_OLDALAK_CIM}</p>`,
      )
      expect(html).toContain(FO_OLDALAK_SZOVEG)
      // A lista fölött nincs címsor, így a lista h1-e utáni sorrendet nem bontja.
      expect(html).not.toMatch(/<h[1-6]/)
      expect(html).toContain('<ul class="kc-fo-oldalak__lista">')

      const linkek = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [
        m[1],
        m[2],
      ])
      expect(linkek).toEqual([
        ['/admin/kezdolap', 'Kezdőlap'],
        ['/admin/collections/pages/4', 'Szolgáltatások'],
        ['/admin/collections/pages/3', 'Rólunk'],
        ['/admin/collections/pages/5', 'Kapcsolat'],
      ])
      expect(html).not.toContain('Bemutatkozás')
      expect(html).toContain('aria-describedby="kc-fo-oldal-lista-rolunk"')
      expect(html).toContain('id="kc-fo-oldal-lista-rolunk">Cím: „A kéz a mindenünk”</span>')
    })
  }

  it('a config admin-útvonalát használja', async () => {
    const html = await htmlje(
      FoOldalakGyorslinkjei({
        payload: payloadMock('/kezelo'),
        permissions: olvas,
        user: { role: 'owner' },
      }),
    )
    expect(html).toContain('href="/kezelo/kezdolap"')
    expect(html).toContain('href="/kezelo/collections/pages/3"')
  })

  it('az Irányítópulton UGYANEZ a komponens a hat kártya után, h3 címsorral, kisebb súllyal', async () => {
    const minden = {
      collections: {
        pages: { read: true },
        products: { read: true },
        menus: { read: true },
        'form-submissions': { read: true },
      },
    }
    const html = await htmlje(
      GyakoriTeendok({ payload: payloadMock(), permissions: minden, user: { role: 'staff' } }),
    )
    const panel = await htmlje(
      FoOldalakGyorslinkjei({
        payload: payloadMock(),
        permissions: minden,
        user: { role: 'staff' },
        elhelyezes: 'panel',
      }),
    )
    expect(panel).not.toBe('')
    // A panel a gyorslinket betűre ugyanúgy tartalmazza, a szekció végén.
    expect(html.endsWith(`${panel}</section>`)).toBe(true)
    expect(panel).toContain(
      '<nav aria-labelledby="kc-fo-oldalak-cim-panel" class="kc-fo-oldalak kc-fo-oldalak--panel" data-elhelyezes="panel">',
    )
    expect(panel).not.toContain('kc-admin-notice')

    // Címsorrend: h2, majd csak h3-ak; a hat kártya mind a gyorslink ELŐTT.
    const cimsorok = [...html.matchAll(/<h([1-6])[^>]*>(.*?)<\/h\1>/g)].map((m) => [
      Number(m[1]),
      m[2]?.replace(/<[^>]+>/g, ''),
    ])
    expect(cimsorok[0]).toEqual([2, 'Gyakori teendők'])
    expect(cimsorok.slice(1).every(([szint]) => szint === 3)).toBe(true)
    expect(cimsorok.slice(1).map(([, szoveg]) => szoveg)).toEqual([
      ADMIN_UTAK.kezdolap.felirat,
      ADMIN_UTAK.videoSzovegei.felirat,
      'Kurzusok és árak',
      'Menüpontok',
      'Űrlapbeküldések',
      ADMIN_UTAK.statisztika.felirat,
      FO_OLDALAK_CIM,
    ])
    expect(html.match(/class="kc-gyakori-teendok__kartya"/g)).toHaveLength(6)
  })

  it('adatbázis-hibánál naplóz, a gyorslink kimarad, a panel kártyái megmaradnak', async () => {
    find.mockImplementation(async () => {
      throw new Error('connection terminated')
    })
    const html = await htmlje(
      GyakoriTeendok({ payload: payloadMock(), permissions: olvas, user: { role: 'owner' } }),
    )
    expect(html).toContain('kc-gyakori-teendok__kartya')
    expect(html).not.toContain('kc-fo-oldalak')
    expect(naplo.error).toHaveBeenCalledTimes(1)
  })

  it('egyetlen megtalált oldal nélkül nem rajzol üres dobozt', async () => {
    find.mockImplementation(async () => ({ docs: [] }))
    expect(
      await htmlje(
        FoOldalakGyorslinkjei({
          payload: payloadMock(),
          permissions: olvas,
          user: { role: 'staff' },
        }),
      ),
    ).toBe('')
  })

  it('0 hálózati kérés: csak a Local API-t hívja', async () => {
    await htmlje(
      FoOldalakGyorslinkjei({
        payload: payloadMock(),
        permissions: olvas,
        user: { role: 'staff' },
      }),
    )
    await htmlje(
      GyakoriTeendok({ payload: payloadMock(), permissions: olvas, user: { role: 'owner' } }),
    )
    expect(fetchKem).not.toHaveBeenCalled()
    expect(find).toHaveBeenCalledTimes(2)
  })

  it('a szövegek magyarok, gondolatjel és felkiáltójel nélkül', () => {
    for (const szoveg of [FO_OLDALAK_CIM, FO_OLDALAK_SZOVEG, ...FO_OLDALAK.map((o) => o.nev)]) {
      expect(szoveg, 'gondolatjel').not.toMatch(/[–—]/)
      expect(szoveg).not.toContain('!')
    }
    expect(FO_OLDALAK_SZOVEG).toMatch(/\.$/)
  })
})

describe('a config bekötése és a generált importMap', () => {
  it('a két nézet a közös útvonal-táblából, az új komponensek az importMap-ben', async () => {
    const importMap = readFileSync(
      new URL('../app/(payload)/admin/importMap.js', import.meta.url),
      'utf8',
    )
    for (const kulcs of [
      '/components/admin/KezdolapNezet#KezdolapNezet',
      '/components/admin/VideoSzovegeiNezet#VideoSzovegeiNezet',
      '/components/admin/GyakoriTeendok#GyakoriTeendok',
      '/components/admin/AdminNavLinks#AdminNavLinks',
      '/components/admin/AdminNavLinks#KezdolapVideoFejlecLink',
      '/components/editor/admin/SzekcioMegnyito#SzekcioMegnyito',
    ]) {
      expect(importMap, kulcs).toContain(`"${kulcs}":`)
    }
    for (const regi of ['StatisticsNavLink', 'BunnyLibraryNavLink', 'WebAnalyticsNavLink']) {
      expect(importMap, `holt bejegyzés: ${regi}`).not.toContain(regi)
    }
  })
})
