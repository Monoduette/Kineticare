import { getDataByPath } from 'payload/shared'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A szekció-tájékoztató (src/components/admin/SectionSourceNotice.tsx) és a
 * sorcímke (src/components/admin/SectionRowLabel.tsx) render-őre.
 *
 * DOM nélkül fut (`renderToStaticMarkup`, a menu-unlisted-link.test.tsx
 * mintája); a Payload-hookokat mockoljuk, az űrlapállapot egy sima objektum.
 * A `fetch` hangosan dob: tesztből SOSEM mehet ki hálózati hívás (CLAUDE.md,
 * 15. üzemeltetési tanulság), és a képleírás-lekérés csak effektben futna.
 */

let formData: { slug?: unknown; layout: Record<string, unknown>[] } = { layout: [] }
let collectionSlug: string | undefined = 'pages'
let rowLabel: { data: Record<string, unknown> | undefined; path: string; rowNumber?: number } = {
  data: undefined,
  path: '',
}

/**
 * A Payload lapos űrlapállapota (`FormState`) a beágyazott adatból, ahogy a
 * @payloadcms/ui addFieldStatePromise.js építi: tömbnél a mező értéke a sorok
 * száma, `rows`-szal, és nem üres tömbnél `disableFormData: true`; a levelek
 * `{ value }`-k; a csoportnak nincs saját bejegyzése.
 */
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
  useDocumentInfo: () => ({ collectionSlug }),
  useFormFields: (selector: (state: [Record<string, { value: unknown }>]) => unknown) =>
    selector([{ slug: { value: formData.slug } }]),
  useWatchForm: () => ({ fields: formStateOf(formData) }),
  useRowLabel: () => rowLabel,
}))

beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('A tesztből SOSEM mehet ki valódi hálózati hívás.')
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  formData = { layout: [] }
  collectionSlug = 'pages'
})

const { SectionSourceNotice, SectionSourceNoticeView } =
  await import('../components/admin/SectionSourceNotice')
const { ArrayRowLabel, SectionRowLabel, siblingRowsFromState } =
  await import('../components/admin/SectionRowLabel')
const {
  KOTOTT_CIM,
  MEGNEZEM_FELIRAT,
  REJTETT_MAGYARAZAT,
  REJTETT_TEENDO,
  LAP_TETEJE_MAGYARAZAT,
  kotottUgropont,
} = await import('../lib/section-row-label')
const { SECTION_SETTINGS_LABEL } = await import('../blocks/section-settings')

const kurzusok = {
  blockType: 'courseCards',
  heading: 'Kurzusaink',
  sectionSettings: { visible: true, anchorId: 'kurzusok' },
}
const velemenyek = {
  blockType: 'testimonials',
  heading: 'Pácienseink mondták',
  sectionSettings: { visible: true, anchorId: null },
}
const tudastar = {
  blockType: 'knowledge',
  heading: 'Legfrissebb a tudástárból',
  sectionSettings: { visible: true, anchorId: null },
}
const rolunkRejtett = {
  blockType: 'about',
  title: 'Megérdemled a profi törődést',
  sectionSettings: { visible: false, anchorId: null },
}
const film = {
  blockType: 'filmHero',
  title: 'Hatékony és biztonságos módszerek',
  sectionSettings: { visible: true, anchorId: null },
}
const sos = {
  blockType: 'freeSos',
  title: 'SOS Kézrelax',
  sectionSettings: { visible: true, anchorId: null },
}

function renderNotice(index: number): string {
  return renderToStaticMarkup(
    createElement(SectionSourceNotice, { path: `layout.${String(index)}.szekcioForrasJelzes` }),
  )
}

/** Az összes <a> href-je és szövege, sorrendben. */
function links(html: string): { href: string; text: string; target: string | null }[] {
  return [...html.matchAll(/<a ([^>]*)>([^<]*)<\/a>/g)].map((match) => ({
    href: /href="([^"]*)"/.exec(match[1] ?? '')?.[1]?.replace(/&amp;/g, '&') ?? '',
    text: match[2] ?? '',
    target: /target="([^"]*)"/.exec(match[1] ?? '')?.[1] ?? null,
  }))
}

describe('SectionSourceNotice: forrás-jelzés és linkek', () => {
  beforeEach(() => {
    formData = {
      slug: 'kezdolap',
      layout: [film, kurzusok, sos, velemenyek, tudastar, rolunkRejtett],
    }
  })

  it.each([
    [1, '/admin/collections/products', 'Kurzusok', '#kurzusok'],
    [
      3,
      '/admin/collections/testimonials',
      'Vélemények',
      '#:~:text=P%C3%A1cienseink%20mondt%C3%A1k',
    ],
    [
      4,
      '/admin/collections/posts',
      'Blogbejegyzések',
      '#:~:text=Legfrissebb%20a%20tud%C3%A1st%C3%A1rb%C3%B3l',
    ],
  ] as const)(
    'a(z) %i. sor a pontos admin-listára és a szekcióra visz',
    (index, adminHref, nev, ugropont) => {
      const html = renderNotice(index)
      expect(html).toContain('kc-admin-notice')
      expect(html).not.toContain('role="alert"')
      const [ugras, megnezem] = links(html)
      expect(ugras).toEqual({
        href: adminHref,
        text: `Ugrás oda, ahol szerkeszted: ${nev}`,
        target: null,
      })
      expect(megnezem?.text).toBe(MEGNEZEM_FELIRAT)
      expect(megnezem?.target).toBe('_blank')
      expect(megnezem?.href).toBe(`/next/preview?collection=pages&slug=kezdolap${ugropont}`)
    },
  )

  it('a Tudástár-ajánló doboza kimondja a kapcsolót, a Kurzuskártyáké „csak” nélkül sorol', () => {
    expect(renderNotice(4)).toContain(
      'Ha a Tudástár ki van kapcsolva (a Menüpontok között a /blog webcímű menüpontnál nincs pipa a „Látható” mezőben, vagy be van jelölve a „Rejtett link”), ez a szekció nem jelenik meg az oldalon.',
    )
    const kurzusDoboz = renderNotice(1)
    expect(kurzusDoboz).toContain(
      'Itt a szekció felső kis feliratát, címét, bevezetőjét, a kártyák gombfeliratát és a kártyák alatti fotókat szerkeszted.',
    )
    expect(kurzusDoboz).not.toMatch(/(?<!\p{L})csak(?!\p{L})/iu)
  })

  it('a filmHero soron nincs forrás-szöveg, csak a „Megnézem” link', () => {
    const html = renderNotice(0)
    expect(html).not.toContain('kc-admin-notice__cim')
    expect(html).not.toContain('Ugrás oda')
    expect(links(html).map((link) => link.text)).toEqual([MEGNEZEM_FELIRAT])
  })

  it('az SOS-sáv forrás-jelzést kap: a Kurzusok közül az SOS-kurzusra szűrt listára visz (H30)', () => {
    const html = renderNotice(2)
    expect(html).toContain('A kurzus neve és a gomb célja a Kurzusokból jön')
    expect(html).toContain('„Kurzusaink”')
    const [ugras] = links(html)
    expect(ugras).toEqual({
      href: '/admin/collections/products?where[slug][equals]=sos-kezrelax-villamkurzus',
      text: 'Ugrás oda, ahol szerkeszted: Kurzusok',
      target: null,
    })
    expect(html).not.toMatch(/(?<!\p{L})csak(?!\p{L})/iu)
  })

  it('az SOS-sáv azonosító és horgony nélkül: őszintén a lap tetejére visz, és ezt kimondja', () => {
    const html = renderNotice(2)
    expect(links(html)[1]?.href).toBe('/next/preview?collection=pages&slug=kezdolap')
    expect(html).toContain(LAP_TETEJE_MAGYARAZAT)
  })

  it('rejtett szekciónál a link HELYETT magyarázat áll', () => {
    const html = renderNotice(5)
    expect(html).toContain(REJTETT_MAGYARAZAT)
    expect(html).toContain(REJTETT_TEENDO)
    expect(html).toContain(
      `A blokk alján, a „${SECTION_SETTINGS_LABEL}” részben a Látható pipával kapcsolod vissza.`,
    )
    expect(html).not.toContain(MEGNEZEM_FELIRAT)
    expect(links(html)).toEqual([])
  })

  it('mentetlen oldalon (nincs webcím) és más gyűjteményben nem jelenik meg link', () => {
    formData = { slug: '', layout: [film] }
    expect(renderNotice(0)).toBe('')
    formData = { slug: 'kezdolap', layout: [film] }
    collectionSlug = 'posts'
    expect(renderNotice(0)).toBe('')
  })

  it('a nézet üres modellnél semmit nem renderel', () => {
    expect(
      renderToStaticMarkup(
        createElement(SectionSourceNoticeView, {
          model: {
            rejtett: false,
            forras: null,
            megnezem: null,
            ugras: null,
            iker: null,
            kotott: null,
          },
        }),
      ),
    ).toBe('')
  })
})

describe('SectionSourceNotice: mentett sor, #szekcio-<azonosító> (H36)', () => {
  const id = (n: number) => `6ab2d1c655cfcd3e0307352${String(n)}`

  it('minden nem rejtett, azonosítós sor a saját horgonyára ugrik, „lap teteje” mondat nélkül', () => {
    formData = {
      slug: 'kezdolap',
      layout: [film, kurzusok, sos, velemenyek, tudastar].map((sor, n) => ({ ...sor, id: id(n) })),
    }
    for (let n = 0; n < 5; n += 1) {
      const html = renderNotice(n)
      const megnezem = links(html).find((link) => link.text === MEGNEZEM_FELIRAT)
      expect(megnezem?.href).toBe(`/next/preview?collection=pages&slug=kezdolap#szekcio-${id(n)}`)
      expect(megnezem?.target).toBe('_blank')
      expect(html).not.toContain(LAP_TETEJE_MAGYARAZAT)
    }
  })

  it('rejtett, azonosítós sornál továbbra sincs link', () => {
    formData = { slug: 'kezdolap', layout: [{ ...rolunkRejtett, id: id(9) }] }
    expect(links(renderNotice(0))).toEqual([])
  })
})

describe('SectionSourceNotice: a Kapcsolat oldal és a kötött ugrópontok', () => {
  const idopont = {
    blockType: 'appointment',
    id: '6ab2d223d49542402eac4ffb',
    title: 'Kérj időpontot a rendelőbe',
    sectionSettings: { visible: true, anchorId: 'idopontkeres' },
  }

  it('Kapcsolat: a Vélemények és a Tudástár-ajánló kimondja, hogy ott nem jelenik meg; link nincs', () => {
    formData = {
      slug: 'kapcsolat',
      layout: [
        idopont,
        { ...velemenyek, id: '6ab2d223d49542402eac4ff1' },
        { ...tudastar, id: '6ab2d223d49542402eac4ff2' },
      ],
    }
    for (const index of [1, 2]) {
      const html = renderNotice(index)
      expect(html).toContain('A Kapcsolat oldalon ez a szekció nem jelenik meg')
      expect(links(html)).toEqual([])
    }
  })

  it('Kapcsolat: az időpontkérő sor kötött ugrópontja figyelmeztet, a „Megnézem” megmarad', () => {
    formData = { slug: 'kapcsolat', layout: [idopont] }
    const html = renderNotice(0)
    expect(html).toContain(`<p class="kc-admin-notice__cim">${KOTOTT_CIM}</p>`)
    const mondat = kotottUgropont(idopont, 'kapcsolat') ?? ''
    expect(mondat.length).toBeGreaterThan(0)
    expect(html.replace(/&quot;/g, '"')).toContain(mondat)
    expect(html).not.toContain('role=')
    expect(links(html).map((link) => link.href)).toEqual([
      '/next/preview?collection=pages&slug=kapcsolat#szekcio-6ab2d223d49542402eac4ffb',
    ])
  })

  it('ugyanez az ugrópont más oldalon nem kötött: nincs figyelmeztetés', () => {
    formData = { slug: 'szolgaltatasok', layout: [idopont] }
    const html = renderNotice(0)
    expect(html).not.toContain(KOTOTT_CIM)
    expect(html).toContain('kc-section-source--csak-link')
  })

  it('a szabad szöveg „rendeloi” során a forrás-doboz alatt áll a kötött mondat, egy dobozban', () => {
    const arlista = {
      blockType: 'richText',
      id: '6ab2d223d49542402eac4fea',
      sectionSettings: { visible: true, anchorId: 'rendeloi' },
    }
    formData = { slug: 'szolgaltatasok', layout: [arlista] }
    const html = renderNotice(0)
    expect(html.match(/class="kc-admin-notice /g)).toHaveLength(1)
    expect(html).toContain('Árlista a szövegből')
    expect(html).toContain('kc-section-source__kotott')
    expect(html).toContain('és a szövegből árkártyák sem lesznek.')
  })
})

describe('SectionRowLabel és ArrayRowLabel', () => {
  it('a sorcímke h3 címsor, a „Rejtve” jel szöveg, az ismétlés jelölve', () => {
    const iker = { ...rolunkRejtett, sectionSettings: { visible: true, anchorId: null } }
    formData = { slug: 'kezdolap', layout: [iker, film, rolunkRejtett] }
    rowLabel = { data: rolunkRejtett, path: 'layout.2', rowNumber: 2 }
    const html = renderToStaticMarkup(
      createElement(SectionRowLabel, { blockLabel: 'Rólunk + statisztikák' }),
    )
    expect(html.startsWith('<h3 class="kc-section-row-label row-label">')).toBe(true)
    expect(html.endsWith('</h3>')).toBe(true)
    expect(html).toContain('<span class="kc-section-row-label__rejtve">Rejtve</span>')
    const szoveg = html.replace(/<[^>]+>/g, '')
    expect(szoveg).toBe(
      '03 · Rejtve · Rólunk + statisztikák: Megérdemled a profi törődést (2. ilyen)',
    )
    expect(html).not.toMatch(/<(a|button|input)\b/)
  })

  it('a tömbsor a tartalmát mutatja, üresen az általános alakot', () => {
    rowLabel = {
      data: { title: 'Rendelői kezelések', number: '01' },
      path: 'layout.0.rows.0',
      rowNumber: 0,
    }
    expect(
      renderToStaticMarkup(
        createElement(ArrayRowLabel, { singular: 'Sor', titleFields: ['title', 'body'] }),
      ),
    ).toBe('<span class="kc-array-row-label row-label">1. Rendelői kezelések</span>')
    rowLabel = { data: { image: 34, alt: null }, path: 'layout.1.logos.1', rowNumber: 1 }
    expect(
      renderToStaticMarkup(
        createElement(ArrayRowLabel, {
          singular: 'Logó',
          titleFields: ['alt'],
          imageField: 'image',
        }),
      ),
    ).toBe('<span class="kc-array-row-label row-label">2. logó (kép)</span>')
  })
})

describe('siblingRowsFromState: a testvérsorok egyetlen bejárással', () => {
  const sorok = [
    {
      blockType: 'faq',
      heading: 'Gyakori kérdések',
      items: [{ question: 'Mennyi?', answer: 'Sok.' }],
      sectionSettings: { visible: true, anchorId: 'gyik' },
    },
    { blockType: 'credsStrip', items: [], sectionSettings: { visible: false, anchorId: null } },
    rolunkRejtett,
  ]

  it('soronként ugyanazt adja, mint a Payload getDataByPath-ja', () => {
    const state = formStateOf({ slug: 'kezdolap', layout: sorok }) as Parameters<
      typeof getDataByPath
    >[0]
    const egyben = siblingRowsFromState(state, 'layout')
    expect(egyben).toHaveLength(3)
    sorok.forEach((_, index) => {
      expect(egyben[index]).toEqual(getDataByPath(state, `layout.${String(index)}`))
    })
    expect(egyben[1]).toMatchObject({ items: [] })
  })

  it('hiányzó vagy üres Szekciók-mezőnél üres lista', () => {
    expect(siblingRowsFromState({}, 'layout')).toEqual([])
    expect(siblingRowsFromState(formStateOf({ layout: [] }), 'layout')).toEqual([])
  })
})
