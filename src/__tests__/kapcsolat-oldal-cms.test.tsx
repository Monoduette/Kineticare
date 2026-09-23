import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Page } from '../payload-types'

/**
 * A /kapcsolat CMS-kötése (modul-térkép H26, A-rész) és piszkozat-előnézete.
 *
 * - A H1 a rekord Címéből jön, üresen vagy rekord nélkül „Kapcsolat” a tartalék.
 * - A <title> a [slug] oldalakkal AZONOS feloldóval (`resolveSeoTitle` +
 *   `documentTitle`), a Kulcsszavak átmennek. Élő adattal (2026-09-22, Cím:
 *   „Kapcsolat”, SEO-cím: „Kapcsolat – Kineticare”) a <title> változatlanul
 *   „Kapcsolat | Kineticare”, ahogy a /rolunk „Rólunk | Kineticare”.
 * - Piszkozat-előnézetben (draft mode) a lap és a metaadat is a piszkozatot
 *   kéri, a válasz nem indexelhető, van előnézet-sáv „Vissza a szerkesztőbe”
 *   linkkel és minden szekció előtt szalag; publikált nézetben semmi ilyen.
 * - A Tudástár-szűrés és a JSON-LD-építők bemenete változatlan: a szűrt sor.
 */

const h = vi.hoisted(() => ({
  draft: false,
  lathato: true,
  page: null as unknown,
  hivasok: [] as unknown[][],
  kapcsolatAdatSorok: [] as unknown[],
  csapatSorok: [] as unknown[],
}))

vi.mock('next/headers', () => ({ draftMode: async () => ({ isEnabled: h.draft }) }))
vi.mock('@/lib/cms', () => ({
  getPageBySlug: async (...args: unknown[]) => {
    h.hivasok.push(args)
    return h.page
  },
}))
vi.mock('@/lib/tudastar-lathatosag', () => ({ getTudastarLathato: async () => h.lathato }))
// A kapcsolati e-mail feloldója (src/lib/contact-email-server.ts) itt a
// kódtartalékot adja: tesztből valódi Payload-indítás és adatbázis-hívás nem
// mehet ki (CLAUDE.md 15). Az eltérő CMS-címet a kapcsolati-email-feloldo.test.ts méri.
vi.mock('@/lib/contact-email-server', async () => {
  const { KAPCSOLATI_EMAIL_TARTALEK: tartalek } = await import('../lib/contact-email')
  return { getContactEmail: async () => tartalek }
})
vi.mock('@/lib/appointment/section', () => ({
  getAppointmentSectionContext: async () => ({ formId: null, turnstileSiteKey: null }),
}))
vi.mock('@/lib/seo-graph', async (importOriginal) => {
  const eredeti = await importOriginal<typeof import('../lib/seo-graph')>()
  return {
    ...eredeti,
    contactDataFromLayout: (layout: Parameters<typeof eredeti.contactDataFromLayout>[0]) => {
      h.kapcsolatAdatSorok.push(layout)
      return eredeti.contactDataFromLayout(layout)
    },
    teamPersonsFromLayout: (layout: Parameters<typeof eredeti.teamPersonsFromLayout>[0]) => {
      h.csapatSorok.push(layout)
      return eredeti.teamPersonsFromLayout(layout)
    },
  }
})

beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('A tesztből SOSEM mehet ki valódi hálózati hívás.')
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  h.draft = false
  h.lathato = true
  h.page = null
  h.hivasok.length = 0
  h.kapcsolatAdatSorok.length = 0
  h.csapatSorok.length = 0
})

const kapcsolatModul = await import('../app/(frontend)/kapcsolat/page')
const KapcsolatPage = kapcsolatModul.default
const { generateMetadata } = kapcsolatModul
const { buildPageMetadata, renderedDocumentTitle } = await import('../lib/seo')
const { DRAFT_ROBOTS } = await import('../lib/preview/draft-metadata')
const { layoutTudastarLinkekNelkul } = await import('../lib/tudastar-link-szuro')
const { HORGONY_ELOTAG } = await import('../components/editor/frontend/szerkeszto-szalag')
const { PREVIEW_BAR_SZOVEG, VISSZA_A_SZERKESZTOBE } =
  await import('../components/preview/PreviewBar')

const REPO = fileURLToPath(new URL('../..', import.meta.url))
const ELO = JSON.parse(
  readFileSync(join(REPO, 'src/__tests__/fixtures/elo-szekciosorok-2026-09-22.json'), 'utf8'),
) as Record<string, { id: number; slug: string; title: string; layout: Page['layout'] }>

/** Az élő kapcsolat-rekord (a meta-mezők a scratchpad live-pages.json-ból, 2026-09-22). */
function eloKapcsolat(felulir: Partial<Page> = {}): Page {
  const lap = ELO.kapcsolat
  if (!lap) throw new Error('Hiányzik a fixture-ből: kapcsolat')
  return {
    id: lap.id,
    slug: lap.slug,
    title: lap.title,
    excerpt: 'Keress minket bizalommal telefonon, e-mailben, vagy írj üzenetet.',
    content: null,
    layout: lap.layout,
    seoTitle: 'Kapcsolat – Kineticare',
    seoDescription: null,
    seoKeywords: [],
    status: 'published',
    updatedAt: '2026-09-22T00:00:00.000Z',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...felulir,
  } as unknown as Page
}

const render = async (): Promise<string> =>
  renderToStaticMarkup((await KapcsolatPage()) as ReactNode)

const h1 = (html: string): string | null => /<h1>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? null

describe('/kapcsolat: a H1 a rekord Címéből', () => {
  it('élő adattal „Kapcsolat”', async () => {
    h.page = eloKapcsolat()
    expect(h1(await render())).toBe('Kapcsolat')
  })

  it('a szerkesztő által átírt Cím megjelenik', async () => {
    h.page = eloKapcsolat({ title: 'Kapcsolat és időpontkérés' })
    expect(h1(await render())).toBe('Kapcsolat és időpontkérés')
  })

  it.each([
    ['üres cím', { title: '   ' }],
    ['nincs rekord', null],
  ])('%s: a tartalék „Kapcsolat”', async (_, felulir) => {
    h.page = felulir === null ? null : eloKapcsolat(felulir)
    expect(h1(await render())).toBe('Kapcsolat')
  })
})

describe('/kapcsolat: a <title> és a kulcsszavak', () => {
  it('élő adattal a <title> „Kapcsolat | Kineticare” marad (mint a /rolunk „Rólunk | Kineticare”)', async () => {
    h.page = eloKapcsolat()
    const meta = await generateMetadata()
    expect(renderedDocumentTitle(meta.title)).toBe('Kapcsolat | Kineticare')
    const rolunk = buildPageMetadata(
      { title: 'A kéz a mindenünk', seoTitle: 'Rólunk – Kineticare' },
      '/rolunk',
    )
    expect(renderedDocumentTitle(rolunk.title)).toBe('Rólunk | Kineticare')
    expect(meta.openGraph?.title).toBe('Kapcsolat')
  })

  it('a SEO-cím a [slug] oldalak feloldójával hat, üresen a Cím, rekord nélkül a kódtartalék', async () => {
    h.page = eloKapcsolat({ seoTitle: 'Elérhetőségek – Kineticare' })
    expect(renderedDocumentTitle((await generateMetadata()).title)).toBe(
      'Elérhetőségek | Kineticare',
    )
    h.page = eloKapcsolat({ seoTitle: null, title: 'Kapcsolat és időpontkérés' })
    expect(renderedDocumentTitle((await generateMetadata()).title)).toBe(
      'Kapcsolat és időpontkérés | Kineticare',
    )
    h.page = null
    expect(renderedDocumentTitle((await generateMetadata()).title)).toBe('Kapcsolat | Kineticare')
  })

  it('a Kulcsszavak átmennek; üresen a keywords kulcs kimarad', async () => {
    h.page = eloKapcsolat()
    expect((await generateMetadata()).keywords).toBeUndefined()
    h.page = eloKapcsolat({
      seoKeywords: [
        { id: 'a', phrase: 'kézterapeuta Budapest' },
        { id: 'b', phrase: 'időpontkérés gyógytorna' },
      ],
    })
    const keywords = (await generateMetadata()).keywords
    expect(String(keywords)).toContain('kézterapeuta Budapest')
    expect(String(keywords)).toContain('időpontkérés gyógytorna')
  })

  it('a leírás továbbra sem a Rövid bevezetőből jön (H26: nincs üzenetküldő)', async () => {
    h.page = eloKapcsolat()
    expect((await generateMetadata()).description).not.toContain('írj üzenetet')
  })
})

describe('/kapcsolat: piszkozat-előnézet', () => {
  it('publikált nézet: a publikált rekord, nincs előnézet-sáv, szalag és szekcio- id', async () => {
    h.page = eloKapcsolat()
    const html = await render()
    const meta = await generateMetadata()
    expect(h.hivasok).toEqual([
      ['kapcsolat', { draft: false }],
      ['kapcsolat', { draft: false }],
    ])
    expect(html).not.toContain('kc-preview-bar')
    expect(html).not.toContain('kc-szerkeszto')
    expect(html).not.toContain(`id="${HORGONY_ELOTAG}`)
    expect(meta.robots).toBeUndefined()
  })

  it('draft: a piszkozat, noindex, előnézet-sáv „Vissza a szerkesztőbe” linkkel, minden szekció előtt szalag', async () => {
    h.draft = true
    h.page = eloKapcsolat()
    const html = await render()
    const meta = await generateMetadata()
    expect(h.hivasok).toEqual([
      ['kapcsolat', { draft: true }],
      ['kapcsolat', { draft: true }],
    ])
    expect(meta.robots).toEqual(DRAFT_ROBOTS)
    expect(html).toContain(PREVIEW_BAR_SZOVEG)
    expect(html).toContain(
      `<a class="kc-preview-bar__exit" href="/admin/collections/pages/7">${VISSZA_A_SZERKESZTOBE}</a>`,
    )
    expect(html).toContain('href="/next/exit-preview?vissza=%2Fkapcsolat"')
    expect(html).toContain('kc-szerkeszto-szalag--oldal')
    const horgonyok = [...html.matchAll(new RegExp(`id="${HORGONY_ELOTAG}([a-f0-9]{24})"`, 'g'))]
    expect(horgonyok.map((talalat) => talalat[1])).toEqual(
      (ELO.kapcsolat?.layout ?? []).map((sor) => sor.id),
    )
    expect(h1(html)).toBe('Kapcsolat')
  })

  it('a Tudástár-szűrés és a JSON-LD-építők bemenete draftban is a szűrt sor', async () => {
    h.draft = true
    h.lathato = false
    h.page = eloKapcsolat()
    const html = await render()
    const szurt = layoutTudastarLinkekNelkul(ELO.kapcsolat?.layout ?? [])
    expect(h.kapcsolatAdatSorok).toEqual([szurt])
    expect(h.csapatSorok).toEqual([szurt])
    const jsonLd = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map((talalat) => talalat[1])
      .join('\n')
    expect(jsonLd).toContain('"name":"Kapcsolat"')
    expect(jsonLd).toContain('"@type":"ContactPage"')
  })
})
