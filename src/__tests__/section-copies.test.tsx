// @vitest-environment happy-dom

import { act, createElement, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Az „ugyanaz máshol” jelzés kliens-komponense
 * (src/components/admin/SectionCopies.tsx, modul-térkép H10, H49):
 * - dokumentumonként EGY betöltés: három (és tizenöt) szekció jelzése ugyanarra
 *   az oldalra legfeljebb két fetch-hívást ad (pages + users), a kérések
 *   paraméterei a Payload 3.88 REST szerint; egyidejű újracsatolás és a
 *   StrictMode dupla effektje nem kér újra, az utolsó jelzés lecsatolása után
 *   (a törlés-időzítő lefutásával) viszont a következő megnyitás friss adatot kér;
 * - a helyek feliratai betűre a cél sorcímkéi (describeSectionOnPage a cél
 *   oldal webcímével + sectionRowLabelText, az oldal neve elöl);
 * - az ugyanazon oldali hely a helybenUgras-t hívja, a más oldali nem;
 * - hiba és nem-ok válasz: a modul hibamondata; lekérés nélküli típus és nem
 *   Oldalak-dokumentum: se fetch, se doboz;
 * - a tiszta nézet: link nélküli hely, „és még N”, nincs role.
 *
 * A fetch mindig stubolt (CLAUDE.md 15. üzemeltetési tanulság): tesztből
 * valódi hálózati hívás nem mehet ki. A happy-dom mountolja a komponenst
 * (createRoot + act, a szekcio-megnyito.test.tsx mintája).
 */

const allapot = vi.hoisted(() => ({
  collectionSlug: 'pages' as string | undefined,
  id: 5 as number | string | undefined,
  formData: { slug: undefined, title: undefined, layout: [] } as {
    slug: unknown
    title: unknown
    layout: Record<string, unknown>[]
  },
}))

const helybenUgras = vi.hoisted(() =>
  vi.fn((esemeny: { preventDefault: () => void }) => {
    esemeny.preventDefault()
  }),
)

/** A Payload lapos űrlapállapota (a section-source-notice.test.tsx mintája). */
function formStateOf(value: unknown, path = '', out: Record<string, unknown> = {}) {
  if (Array.isArray(value)) {
    out[path] = {
      value: value.length,
      rows: value.map(() => ({})),
      ...(value.length > 0 ? { disableFormData: true } : {}),
    }
    value.forEach((item, index) => formStateOf(item, `${path}.${String(index)}`, out))
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      formStateOf(child, path ? `${path}.${key}` : key, out)
    }
  } else if (path) {
    out[path] = { value }
  }
  return out
}

vi.mock('@payloadcms/ui', () => ({
  useConfig: () => ({ config: { serverURL: '', routes: { admin: '/admin', api: '/api' } } }),
  useDocumentInfo: () => ({ collectionSlug: allapot.collectionSlug, id: allapot.id }),
  useFormFields: (selector: (state: [Record<string, { value: unknown }>]) => unknown) =>
    selector([
      { slug: { value: allapot.formData.slug }, title: { value: allapot.formData.title } },
    ]),
  useWatchForm: () => ({ fields: formStateOf({ layout: allapot.formData.layout }) }),
  useRowLabel: () => ({ data: undefined, path: '' }),
}))

vi.mock('../components/admin/helyben-ugras', () => ({ helybenUgras }))

const {
  SectionCopies,
  SectionCopiesView,
  kellLekeres,
  masolatAdatokUritese,
  munkatarsakUrl,
  oldalakUrl,
} = await import('../components/admin/SectionCopies')
const { SZEKCIO_CIMKE_FORRASOK } = await import('../blocks')
const { MUNKATARS_HIBA, OLDAL_HIBA, esMeg, HASONLO_TEENDO, SZOVEG_TEENDO } =
  await import('../lib/admin/szekcio-masolatok')
const { describeSectionOnPage, sectionRepeatOrdinals, sectionRowLabelText, ELVALASZTO } =
  await import('../lib/section-row-label')

const blokkId = (n: number): string => n.toString(16).padStart(24, '0')

const idopont = {
  id: blokkId(1),
  blockType: 'appointment',
  title: 'Időpontkérés',
  telefonszamok: [{ id: 'a1', nev: 'Kocsis Kata', szam: '+36 30 169 2263' }],
  sectionSettings: { visible: true },
}
const szakemberek = {
  id: blokkId(2),
  blockType: 'teamMembers',
  title: 'Szakembereink',
  members: [{ id: 'm1', name: 'Kocsis Kata', phone: '06 30 169 2263', photo: 7 }],
  sectionSettings: { visible: true },
}
const szabadSzoveg = {
  id: blokkId(3),
  blockType: 'richText',
  sectionSettings: { visible: true },
}
const rolunkSzakemberek = {
  id: blokkId(10),
  blockType: 'teamMembers',
  title: 'A csapat',
  members: [{ id: 'm2', name: 'Kiss Kata', photo: 9 }],
  sectionSettings: { visible: true },
}
const rolunkLayout = [
  { id: blokkId(9), blockType: 'about', title: 'Rólunk', photo: 7 },
  rolunkSzakemberek,
]

const PAGES_VALASZ = {
  docs: [
    { id: 5, slug: 'kapcsolat', title: 'Kapcsolat', layout: [idopont, szakemberek, szabadSzoveg] },
    { id: 6, slug: 'rolunk', title: 'Rólunk', layout: rolunkLayout },
  ],
}
const USERS_VALASZ = { docs: [{ id: 3, name: 'Kocsis Kata', portrait: 7 }] }

type FetchValasz = { ok: boolean; json: () => Promise<unknown> }

function valasz(torzs: unknown, ok = true): FetchValasz {
  return { ok, json: () => Promise.resolve(torzs) }
}

function ujFetchMock() {
  return vi.fn<(url: string, init?: { credentials?: string }) => Promise<FetchValasz>>((url) =>
    Promise.resolve(valasz(url.includes('/users?') ? USERS_VALASZ : PAGES_VALASZ)),
  )
}

let fetchMock = ujFetchMock()

let gyoker: Root | null = null
let tarolo: HTMLDivElement | null = null

beforeEach(() => {
  masolatAdatokUritese()
  helybenUgras.mockClear()
  fetchMock = ujFetchMock()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  allapot.collectionSlug = 'pages'
  allapot.id = 5
  allapot.formData = {
    slug: 'kapcsolat',
    title: 'Kapcsolat',
    layout: [idopont, szakemberek, szabadSzoveg],
  }
})

afterEach(() => {
  act(() => {
    gyoker?.unmount()
  })
  gyoker = null
  tarolo?.remove()
  tarolo = null
  vi.unstubAllGlobals()
})

/** A megadott sorok jelzései egy közös szülőben (a sor kulcsa a sorszám). */
function jelzesek(sorok: readonly number[], strict = false) {
  const fa = createElement(
    'div',
    null,
    sorok.map((sor) =>
      createElement(SectionCopies, {
        key: sor,
        path: `layout.${String(sor)}.szekcioMasolatJelzes`,
        cimkek: SZEKCIO_CIMKE_FORRASOK,
      }),
    ),
  )
  return strict ? createElement(StrictMode, null, fa) : fa
}

/** Egy makrotaszk: a lecsatolás törlés-időzítője (setTimeout 0) lefut. */
const makrotaszk = () => new Promise((resolve) => setTimeout(resolve, 0))

/** A megadott sorok jelzéseit mountolja, és megvárja a betöltést. */
async function mount(sorok: readonly number[], strict = false): Promise<HTMLDivElement> {
  tarolo = document.createElement('div')
  document.body.append(tarolo)
  const cel = tarolo
  gyoker = createRoot(cel)
  await act(async () => {
    gyoker?.render(jelzesek(sorok, strict))
    await makrotaszk()
  })
  return cel
}

/** Lecsatolja a gyökeret (minden jelzést). */
function unmount(): void {
  act(() => {
    gyoker?.unmount()
  })
  gyoker = null
  tarolo?.remove()
  tarolo = null
}

/**
 * A cél sorcímkéje, ahogy a SectionRowLabel rajzolja: oldalfüggő leírás a cél
 * oldal webcímével, beégetett szöveg nélkül.
 */
function sorcimke(
  layout: readonly Record<string, unknown>[],
  index: number,
  oldalSlug: string,
): string {
  const szekcio = layout[index] ?? {}
  const forras = SZEKCIO_CIMKE_FORRASOK[String(szekcio.blockType)]
  const leiras = describeSectionOnPage(
    szekcio,
    index,
    forras?.blockLabel ?? '',
    forras?.textFields ?? [],
    oldalSlug,
  )
  return sectionRowLabelText({ ...leiras, ismetles: sectionRepeatOrdinals(layout)[index] ?? null })
}

function linkek(elem: Element): { href: string; text: string }[] {
  return [...elem.querySelectorAll('a')].map((a) => ({
    href: a.getAttribute('href') ?? '',
    text: a.textContent ?? '',
  }))
}

describe('SectionCopies: adatbetöltés dokumentumonként egyszer', () => {
  it('három jelzés ugyanarra az oldalra legfeljebb két fetch-hívást ad', async () => {
    // Mindhárom sor kér adatot (időpontkérő, szakember-kártyák, szolgáltatás-sorok):
    // gyorsítótár nélkül ez hat hívás volna.
    allapot.formData.layout = [
      idopont,
      szakemberek,
      { id: blokkId(4), blockType: 'services', title: 'Rendelői kezelések' },
    ]
    for (const tipus of ['appointment', 'teamMembers', 'services']) {
      expect(kellLekeres(tipus)).toBe(true)
    }
    const elem = await mount([0, 1, 2])
    // A két kártyás sor dobozt kap, a szolgáltatás-sor nem (máshol nincs ilyen).
    expect(elem.querySelectorAll('.kc-section-copies')).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const urlek = fetchMock.mock.calls.map(([url]) => url).sort()
    expect(urlek).toEqual([munkatarsakUrl('/api'), oldalakUrl('/api')].sort())
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toEqual({ credentials: 'include' })
    }
  })

  it('a kérések paraméterei: piszkozat, lapozás nélkül, csak a szükséges mezők', () => {
    const oldalak = new URL(oldalakUrl('/api'), 'http://localhost')
    expect(oldalak.pathname).toBe('/api/pages')
    expect(Object.fromEntries(oldalak.searchParams)).toEqual({
      depth: '0',
      draft: 'true',
      pagination: 'false',
      'select[slug]': 'true',
      'select[title]': 'true',
      'select[layout]': 'true',
    })
    const felhasznalok = new URL(munkatarsakUrl('/api'), 'http://localhost')
    expect(felhasznalok.pathname).toBe('/api/users')
    expect(Object.fromEntries(felhasznalok.searchParams)).toEqual({
      depth: '0',
      pagination: 'false',
      'where[portrait][exists]': 'true',
      'select[name]': 'true',
      'select[portrait]': 'true',
    })
  })

  it('tizenöt jelzés ugyanarra az oldalra is legfeljebb két fetch-hívást ad', async () => {
    allapot.formData.layout = Array.from({ length: 15 }, (_, i) => ({
      id: blokkId(100 + i),
      blockType: 'services',
      title: `Kezelés ${String(i + 1)}`,
    }))
    await mount(Array.from({ length: 15 }, (_, i) => i))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('egyidejű újracsatolás (sorcsere egy körben) nem kér újra', async () => {
    const elem = await mount([0])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // Ugyanabban a commitban a 0. sor jelzése lecsatolódik, az 1. sora csatolódik.
    await act(async () => {
      gyoker?.render(jelzesek([1]))
      await makrotaszk()
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(elem.querySelectorAll('.kc-section-copies')).toHaveLength(1)
  })

  it('a StrictMode dupla effektje nem kér újra', async () => {
    await mount([0, 1], true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('minden jelzés lecsatolása és az időzítő lefutása után az újranyitás friss adatot kér', async () => {
    await mount([0])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    unmount()
    await makrotaszk()
    await mount([1])
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('ha az időzítő lefutása előtt új gyökér csatol, a törlés elmarad', async () => {
    await mount([0])
    unmount()
    // Szinkron act: az effect még az időzítő előtt lefut, és visszavonja a törlést.
    tarolo = document.createElement('div')
    document.body.append(tarolo)
    const ujGyoker = createRoot(tarolo)
    gyoker = ujGyoker
    act(() => {
      ujGyoker.render(jelzesek([1]))
    })
    await act(async () => {
      await makrotaszk()
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(tarolo.querySelectorAll('.kc-section-copies')).toHaveLength(1)
  })
})

describe('SectionCopies: a helyek feliratai és linkjei', () => {
  it('az időpontkérő száma: a szakember-kártya sora ugyanitt, a felirat betűre a sorcímke', async () => {
    const elem = await mount([0])
    const layout = allapot.formData.layout
    expect(linkek(elem)).toEqual([
      {
        href: `/admin/collections/pages/5?szekcio=${blokkId(2)}`,
        text: `Kapcsolat${ELVALASZTO}${sorcimke(layout, 1, 'kapcsolat')}`,
      },
    ])
    expect(elem.textContent).toContain(
      'Ugyanez a telefonszám (+36 30 169 2263) máshol is szerepel:',
    )
    expect(elem.textContent).toContain(SZOVEG_TEENDO)
  })

  it('a szakember-kártyák: hasonló szekció, közös kép más oldalon és az arckép', async () => {
    const elem = await mount([1])
    const szovegek = linkek(elem).map((link) => link.text)
    expect(szovegek).toEqual(
      expect.arrayContaining([
        `Rólunk${ELVALASZTO}${sorcimke(rolunkLayout, 1, 'rolunk')}`,
        `Rólunk${ELVALASZTO}${sorcimke(rolunkLayout, 0, 'rolunk')}`,
        'Felhasználók · Kocsis Kata · Arckép',
      ]),
    )
    const hrefek = linkek(elem).map((link) => link.href)
    expect(hrefek).toEqual(
      expect.arrayContaining([
        `/admin/collections/pages/6?szekcio=${blokkId(10)}`,
        `/admin/collections/pages/6?szekcio=${blokkId(9)}`,
        '/admin/collections/users/3',
      ]),
    )
    expect(elem.textContent).toContain(HASONLO_TEENDO)
    expect(elem.querySelector('[role]')).toBeNull()
    expect(elem.querySelector('[aria-live]')).toBeNull()
  })

  it('az ugyanazon oldali hely a helybenUgras-t hívja, a más oldali nem', async () => {
    const elem = await mount([0, 1])
    const [helyben] = [...elem.querySelectorAll('a')].filter((a) =>
      a.getAttribute('href')?.startsWith('/admin/collections/pages/5'),
    )
    const [masOldal] = [...elem.querySelectorAll('a')].filter((a) =>
      a.getAttribute('href')?.startsWith('/admin/collections/pages/6'),
    )
    expect(helyben).toBeDefined()
    expect(masOldal).toBeDefined()
    act(() => {
      masOldal?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    expect(helybenUgras).not.toHaveBeenCalled()
    act(() => {
      helyben?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    expect(helybenUgras).toHaveBeenCalledTimes(1)
  })
})

describe('SectionCopies: hiba és kihagyás', () => {
  it('nem-ok válasznál a többi oldal hibamondata jelenik meg', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(url.includes('/users?') ? valasz(USERS_VALASZ) : valasz({}, false)),
    )
    const elem = await mount([0])
    expect(elem.textContent).toContain(OLDAL_HIBA)
    expect(elem.querySelector('.kc-admin-notice--figyelem')).not.toBeNull()
  })

  it('hálózati hibánál képes szekción mindkét hibamondat', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('offline')))
    const elem = await mount([1])
    expect(elem.textContent).toContain(OLDAL_HIBA)
    expect(elem.textContent).toContain(MUNKATARS_HIBA)
  })

  it('Szabad szövegnél (se hasonló-szabály, se közös adat) nincs lekérés és doboz', async () => {
    const elem = await mount([2])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(elem.innerHTML).toBe('<div></div>')
  })

  it('nem Oldalak-dokumentumon nincs lekérés és doboz', async () => {
    allapot.collectionSlug = 'posts'
    const elem = await mount([0, 1])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(elem.innerHTML).toBe('<div></div>')
  })
})

describe('SectionCopiesView: a tiszta nézet', () => {
  it('üres modellnél és hiba nélkül semmit nem rajzol', () => {
    expect(
      renderToStaticMarkup(
        createElement(SectionCopiesView, {
          model: { csoportok: [], oldalHiba: false, munkatarsHiba: false },
        }),
      ),
    ).toBe('')
  })

  it('link nélküli hely szövegként, a levágott lista vége „és még N”', () => {
    const html = renderToStaticMarkup(
      createElement(SectionCopiesView, {
        model: {
          csoportok: [
            {
              fajta: 'hasonlo',
              ertekek: [],
              helyek: [
                { kulcs: 'a', felirat: 'Kezdőlap · 03 · X: Y', href: null, ugyanitt: false },
                { kulcs: 'b', felirat: 'Rólunk · 02 · X: Z', href: '/admin/x', ugyanitt: false },
              ],
              tobbi: 2,
            },
          ],
          oldalHiba: false,
          munkatarsHiba: false,
        },
      }),
    )
    expect(html).toContain('<span>Kezdőlap · 03 · X: Y</span>')
    expect(html).toContain('<a href="/admin/x">Rólunk · 02 · X: Z</a>')
    expect(html).toContain(`<li class="kc-section-copies__tobbi">${esMeg(2)}</li>`)
    expect(html).toContain('Hasonló szekció más oldalon:')
    expect(html).toContain('class="kc-admin-notice kc-section-copies"')
    expect(html).not.toContain('role=')
  })
})
