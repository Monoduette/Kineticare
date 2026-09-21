import { describe, expect, it } from 'vitest'

import { absoluteUrl, SITE_DESCRIPTION } from '../lib/seo'
import {
  buildLlmsFullTxt,
  buildLlmsTxt,
  layoutBlockToMarkdown,
  lexicalToMarkdown,
  type LlmsSource,
} from '../lib/seo-llms'
import { COURSE_SHORT_DESCRIPTION_LEFTOVER } from '../lib/gondolatjel-leftover'
import type { Page, Post } from '../payload-types'

/**
 * Őr: az `/llms.txt` az llmstxt.org alakját követi (https://llmstxt.org/):
 * H1 (név) → blockquote (leírás) → szabad bekezdés → `## Szekció` →
 * `- [név](url): leírás`; az `## Optional` a kihagyható linkeké. Az
 * `llms-full.txt` a publikus lapok teljes szövegét adja.
 */

const richText = (children: unknown[]) =>
  ({ root: { type: 'root', children } }) as unknown as Post['content']
const text = (t: string, format = 0) => ({ type: 'text', text: t, format })
const paragraph = (...children: unknown[]) => ({ type: 'paragraph', children })
const heading = (tag: string, t: string) => ({ type: 'heading', tag, children: [text(t)] })
const list = (listType: 'bullet' | 'number', ...items: string[]) => ({
  type: 'list',
  listType,
  children: items.map((item) => ({ type: 'listitem', children: [text(item)] })),
})

const SOURCE: LlmsSource = {
  pages: [
    {
      title: 'Kezdőlap',
      slug: 'kezdolap',
      excerpt: 'Bevezető.',
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
    {
      title: 'Szolgáltatások',
      slug: 'szolgaltatasok',
      excerpt: 'Rendelő, online program, képzés.',
      seoDescription: 'Rendelői gyógytorna és manuálterápia Budapesten.',
      updatedAt: '2026-09-02T00:00:00.000Z',
      layout: [
        {
          blockType: 'services',
          title: 'Válaszd ki, hogyan segíthetünk',
          lead: 'Három út.',
          rows: [
            { title: 'Rendelői kezelések', body: 'Egyénre szabott gyógytorna.', url: '/kapcsolat' },
          ],
        },
        {
          blockType: 'faq',
          heading: 'Gyakori kérdések',
          items: [{ question: 'Mennyi idő?', answer: '50 perc.' }],
        },
        {
          blockType: 'usps',
          title: 'Rejtett',
          cards: [{ title: 'x', body: 'y' }],
          sectionSettings: { visible: false },
        },
      ] as unknown as Page['layout'],
    },
    {
      title: 'Kapcsolat',
      slug: 'kapcsolat',
      excerpt: 'Írj nekünk.',
      updatedAt: '2026-09-03T00:00:00.000Z',
    },
    {
      title: 'Impresszum',
      slug: 'impresszum',
      excerpt: 'Üzemeltető.',
      updatedAt: '2026-09-04T00:00:00.000Z',
    },
    {
      title: 'Kéztőalagút szindróma',
      slug: 'keztoalagut-szindroma',
      excerpt: 'Hub.',
      updatedAt: '2026-09-05T00:00:00.000Z',
      content: richText([paragraph(text('Hub-szöveg, ami a cikk tükre.'))]),
    },
  ],
  posts: [
    {
      title: 'Kéz zsibbadás: mi okozza?',
      slug: 'miert-zsibbad-a-kezem',
      excerpt: 'Éjjel elzsibbad a kezed?',
      publishedAt: '2026-08-21T08:00:00.000Z',
      updatedAt: '2026-09-01T09:00:00.000Z',
      content: richText([
        heading('h2', 'Meddig tart?'),
        paragraph(text('Általában '), text('néhány hét', 1), text('.')),
        list('bullet', 'Első', 'Második'),
        { type: 'upload', value: 1 },
      ]),
    },
    {
      title: 'Kéztőalagút szindróma kezelése házilag',
      slug: 'keztoalagut-szindroma',
      excerpt: 'Mit tehetsz otthon?',
      publishedAt: '2026-08-22T08:00:00.000Z',
      updatedAt: '2026-09-02T09:00:00.000Z',
      content: richText([paragraph(text('Cikk-szöveg.'))]),
    },
  ],
  products: [
    {
      id: 7,
      sku: 'Otthoni KézRehab Program',
      displayTitle: null,
      slug: 'otthoni-kezrehab-program',
      shortDescription: COURSE_SHORT_DESCRIPTION_LEFTOVER,
      updatedAt: '2026-09-01T00:00:00.000Z',
    },
  ],
  hubUtvonalak: { 'keztoalagut-szindroma': '/keztoalagut-szindroma' },
}

describe('llms.txt — llmstxt.org alak', () => {
  const body = buildLlmsTxt(SOURCE)
  const lines = body.split('\n')

  it('H1 a név, alatta blockquote a leírás', () => {
    expect(lines[0]).toBe('# Kineticare')
    expect(lines[1]).toBe('')
    expect(lines[2]).toBe(`> ${SITE_DESCRIPTION}`)
  })

  it('H2-es szekciók, bennük `- [név](abszolút url): leírás` sorok', () => {
    expect(body).toContain('\n## Szolgáltatások és oldalak\n')
    expect(body).toContain('\n## Kurzusok\n')
    expect(body).toContain('\n## Tudástár\n')
    expect(body).toContain('\n## Optional\n')
    const linkLines = lines.filter((line) => line.startsWith('- '))
    expect(linkLines.length).toBeGreaterThan(5)
    for (const line of linkLines) {
      expect(line).toMatch(/^- \[[^\]]+\]\(https?:\/\/[^)]+\)(: .+)?$/)
    }
  })

  it('a szolgáltatások lap a seoDescription-nel, a kezdőlap a `/` címen', () => {
    expect(body).toContain(
      `- [Szolgáltatások](${absoluteUrl('/szolgaltatasok')}): Rendelői gyógytorna és manuálterápia Budapesten.`,
    )
    expect(body).toContain(`- [Kezdőlap](${absoluteUrl('/')})`)
    expect(body).not.toContain('/kezdolap')
  })

  it('az örökölt demólap (akcios-kurzus) közzétéve sem kerül az llms.txt-be (legacy-noindex)', () => {
    const demoBody = buildLlmsTxt({
      ...SOURCE,
      pages: [
        ...SOURCE.pages,
        {
          title: 'Képzeletbeli akciós kurzus',
          slug: 'akcios-kurzus',
          excerpt: 'Demo.',
          updatedAt: '2026-09-04T00:00:00.000Z',
        },
      ],
    })
    expect(demoBody).not.toContain('akcios-kurzus')
  })

  it('a cikk a KANONIKUS (hub) címén áll, a jogi lap az Optional alatt', () => {
    expect(body).toContain(`](${absoluteUrl('/keztoalagut-szindroma')})`)
    expect(body).not.toContain('/blog/keztoalagut-szindroma')
    expect(body.split('## Optional')[1]).toContain('Impresszum')
  })

  it('a kurzus a slugos címén, a rövid leírásból a töltelék gondolatjel eltűnik', () => {
    expect(body).toContain(
      `- [Otthoni KézRehab Program](${absoluteUrl('/kurzusok/otthoni-kezrehab-program')}): `,
    )
    expect(body).not.toMatch(/ – /)
    expect(body).not.toContain('—')
  })

  it('egy URL csak egyszer szerepel (a hub-lap nem ismétli a cikkét)', () => {
    const urls = lines
      .filter((line) => line.startsWith('- '))
      .map((line) => /\]\(([^)]+)\)/.exec(line)?.[1])
    expect(new Set(urls).size).toBe(urls.length)
    expect(body).not.toContain('- [Kéztőalagút szindróma](')
  })

  it('mutat az llms-full.txt-re és a sitemapre', () => {
    expect(body).toContain(absoluteUrl('/llms-full.txt'))
    expect(body).toContain(absoluteUrl('/sitemap.xml'))
  })
})

describe('llms-full.txt — teljes szöveg', () => {
  const body = buildLlmsFullTxt(SOURCE)

  it('a lapok H1-gyel, URL-lel és dátummal, a rejtett szekció nélkül', () => {
    expect(body).toContain('# Szolgáltatások\n\nURL: ' + absoluteUrl('/szolgaltatasok'))
    expect(body).toContain('Frissítve: 2026-09-02')
    expect(body).toContain('## Válaszd ki, hogyan segíthetünk')
    expect(body).toContain('#### Rendelői kezelések')
    expect(body).toContain('#### Mennyi idő?\n\n50 perc.')
    expect(body).not.toContain('Rejtett')
  })

  it('a cikk markdownja: címsor, félkövér, lista; a média kimarad', () => {
    expect(body).toContain('## Meddig tart?')
    expect(body).toContain('Általában **néhány hét**.')
    expect(body).toContain('- Első\n- Második')
    expect(body).toContain('Közzétéve: 2026-08-21')
  })

  it('a hub-lap NEM duplázza a cikket: a cikk egyszer, a kanonikus címén', () => {
    expect(body.split('Cikk-szöveg.').length - 1).toBe(1)
    expect(body).not.toContain('Hub-szöveg')
    expect(body).toContain('URL: ' + absoluteUrl('/keztoalagut-szindroma'))
  })

  it('a bejelentkezés mögötti utak nincsenek benne', () => {
    expect(body).not.toContain('/kurzusaim')
    expect(body).not.toContain('/fiok')
  })
})

describe('lexicalToMarkdown', () => {
  it('link abszolút URL-lel, számozott lista, idézet, elválasztó', () => {
    const md = lexicalToMarkdown(
      richText([
        paragraph({ type: 'link', fields: { url: '/kurzusok' }, children: [text('Kurzusok')] }),
        list('number', 'Egy', 'Kettő'),
        { type: 'quote', children: [text('Idézet')] },
        { type: 'horizontalrule' },
      ]),
    )
    expect(md).toBe(
      `[Kurzusok](${absoluteUrl('/kurzusok')})\n\n1. Egy\n2. Kettő\n\n> Idézet\n\n---`,
    )
  })

  it('érvénytelen bemenetre üres string', () => {
    expect(lexicalToMarkdown(null)).toBe('')
    expect(lexicalToMarkdown({})).toBe('')
    expect(lexicalToMarkdown('szöveg')).toBe('')
  })

  it('rejtett blokk üres, látható blokk címe H2', () => {
    const block = {
      blockType: 'usps',
      title: 'Ezért fogod imádni',
      cards: [{ title: 'Gyors', body: 'Napi 10 perc.' }],
    } as unknown as NonNullable<Page['layout']>[number]
    expect(layoutBlockToMarkdown(block)).toBe(
      '## Ezért fogod imádni\n\n#### Gyors\n\nNapi 10 perc.',
    )
  })
})
