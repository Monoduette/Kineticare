import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  detectVideoEmbed,
  extractPlainText,
  renderLexicalContent,
} from '../components/lexical/serialize'
import type { LexicalNode } from '../components/lexical/types'

/**
 * Lexical-renderer unit-tesztek — blokk→komponens leképezés.
 * A fixturák a Payload alap lexicalEditor() szerializált kimenetét utánozzák.
 */

function text(textValue: string, format = 0): LexicalNode {
  return { type: 'text', version: 1, text: textValue, format, detail: 0, mode: 'normal', style: '' }
}

function paragraph(...children: LexicalNode[]): LexicalNode {
  return { type: 'paragraph', version: 1, children, direction: 'ltr', format: '', indent: 0 }
}

function root(...children: LexicalNode[]): { root: LexicalNode } {
  return { root: { type: 'root', version: 1, children, direction: 'ltr', format: '', indent: 0 } }
}

function linkNode(url: string, label: string, extra: Record<string, unknown> = {}): LexicalNode {
  return {
    type: 'link',
    version: 3,
    children: [text(label)],
    direction: 'ltr',
    format: '',
    indent: 0,
    fields: { linkType: 'custom', url, newTab: false, ...extra },
  }
}

function html(content: unknown): string {
  return renderToStaticMarkup(createElement(Fragment, null, renderLexicalContent(content) as ReactNode))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('szöveg és bekezdés', () => {
  it('bekezdés → <p>, szöveg tartalommal', () => {
    expect(html(root(paragraph(text('Üdvözlünk!'))))).toBe('<p>Üdvözlünk!</p>')
  })

  it('szöveg-formázások: bold/italic/underline/code bitmaszk', () => {
    expect(html(root(paragraph(text('félkövér', 1))))).toBe('<p><strong>félkövér</strong></p>')
    expect(html(root(paragraph(text('dőlt', 2))))).toBe('<p><em>dőlt</em></p>')
    expect(html(root(paragraph(text('aláhúzott', 8))))).toBe('<p><u>aláhúzott</u></p>')
    expect(html(root(paragraph(text('kód', 16))))).toBe('<p><code>kód</code></p>')
    expect(html(root(paragraph(text('kombó', 3))))).toBe(
      '<p><em><strong>kombó</strong></em></p>',
    )
  })

  it('üres/hibás bemenet → null (nem hasal el)', () => {
    expect(renderLexicalContent(null)).toBeNull()
    expect(renderLexicalContent({})).toBeNull()
    expect(renderLexicalContent('nem-objektum')).toBeNull()
  })
})

describe('címsor', () => {
  it('h2–h6 megtartja a szintet', () => {
    expect(html(root({ type: 'heading', tag: 'h3', version: 1, children: [text('Alcím')] }))).toBe(
      '<h3>Alcím</h3>',
    )
  })

  it('a tartalmi h1 SEO-higiéniából h2-re lágyul (oldalanként egy h1)', () => {
    expect(html(root({ type: 'heading', tag: 'h1', version: 1, children: [text('Cím')] }))).toBe(
      '<h2>Cím</h2>',
    )
  })
})

describe('lista és gyakorlatlista', () => {
  const item = (...children: LexicalNode[]): LexicalNode => ({
    type: 'listitem',
    version: 1,
    children,
    value: 1,
  })

  it('bullet-lista → <ul>, number → <ol>', () => {
    const bullet = root({ type: 'list', listType: 'bullet', tag: 'ul', version: 1, children: [item(text('Egy'))] })
    expect(html(bullet)).toBe('<ul><li>Egy</li></ul>')
    const numbered = root({ type: 'list', listType: 'number', tag: 'ol', version: 1, children: [item(text('Egy'))] })
    expect(html(numbered)).toBe('<ol><li>Egy</li></ol>')
  })

  it('check-lista → gyakorlatlista (kc-richtext__exercise-list, checked-jelölés)', () => {
    const check = root({
      type: 'list',
      listType: 'check',
      tag: 'ul',
      version: 1,
      children: [
        { ...item(text('Ujjnyújtás')), checked: false },
        { ...item(text('Csuklókörzés')), checked: true },
      ],
    })
    const output = html(check)
    expect(output).toContain('kc-richtext__exercise-list')
    expect(output).toContain('kc-richtext__exercise-item--done')
  })
})

describe('link, CTA, videó', () => {
  /**
   * A href a `sanitizeCmsUrl` (src/lib/safe-url.ts) NORMALIZÁLT alakja, ezért a
   * csupasz hosztra bekerül a gyökér-perjel. Ez szándékos: a hívók a
   * `/^https?:\/\//i` mintával döntik el, hogy külső-e a cím, és a nyers alak
   * ezt elronthatja (`https:pelda.hu` → belsőként renderelődne).
   */
  it('külső link bekezdésben → <a href> (normalizált alakkal)', () => {
    expect(html(root(paragraph(text('Látogasd meg: '), linkNode('https://pelda.hu', 'pelda.hu'))))).toBe(
      '<p>Látogasd meg: <a href="https://pelda.hu/">pelda.hu</a></p>',
    )
  })

  it('belső link (pages-doc) → a menü URL-konvenciójú href', () => {
    const internal = linkNode('', 'Rólunk', {
      linkType: 'internal',
      doc: { relationTo: 'pages', value: { slug: 'rolunk' } },
    })
    expect(html(root(paragraph(internal)))).toContain('href="/rolunk"')
  })

  it('önálló link bekezdésben → CTA-gomb (kc-button)', () => {
    const output = html(root(paragraph(linkNode('/kapcsolat', 'Kérem a villámkurzust'))))
    expect(output).toContain('kc-button kc-button--primary')
    expect(output).toContain('Kérem a villámkurzust')
  })

  it('YouTube-URL önálló linkként → publikus videó-előzetes (youtube-nocookie iframe)', () => {
    const output = html(root(paragraph(linkNode('https://www.youtube.com/watch?v=abc123', 'Bemutató videó'))))
    expect(output).toContain('https://www.youtube-nocookie.com/embed/abc123')
    expect(output).toContain('title="Bemutató videó"')
  })

  it('detectVideoEmbed: youtu.be, shorts, vimeo; nem-videó URL → null', () => {
    expect(detectVideoEmbed('https://youtu.be/xyz9')?.embedUrl).toBe(
      'https://www.youtube-nocookie.com/embed/xyz9',
    )
    expect(detectVideoEmbed('https://www.youtube.com/shorts/ab12')?.provider).toBe('youtube')
    expect(detectVideoEmbed('https://vimeo.com/123456')?.embedUrl).toBe(
      'https://player.vimeo.com/video/123456',
    )
    expect(detectVideoEmbed('https://pelda.hu/video')).toBeNull()
    expect(detectVideoEmbed('nem-url')).toBeNull()
  })
})

describe('kép (upload-csomópont)', () => {
  const media = {
    id: 7,
    alt: 'Gyógytorna-gyakorlat csuklóra',
    url: '/media/gyakorlat.webp',
    width: 1280,
    height: 720,
    sizes: {
      sm: { url: '/media/gyakorlat-640.webp', width: 640, height: 360 },
      md: { url: '/media/gyakorlat-1280.webp', width: 1280, height: 720 },
    },
  }

  it('Media-méret (md) a forrás, az alt KÖTELEZŐen megjelenik', () => {
    const output = html(root({ type: 'upload', version: 3, relationTo: 'media', value: media, fields: {} }))
    expect(output).toContain('alt="Gyógytorna-gyakorlat csuklóra"')
    expect(output).toContain(encodeURIComponent('/media/gyakorlat-1280.webp'))
    expect(output).toContain('<figure')
  })

  it('alt nélküli kép → alt="" + fejlesztői figyelmeztetés', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const output = html(
      root({ type: 'upload', version: 3, relationTo: 'media', value: { ...media, alt: '' }, fields: {} }),
    )
    expect(output).toContain('alt=""')
    expect(warn).toHaveBeenCalled()
  })

  it('nem feloldott upload → kimarad, nem hasal el', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(html(root({ type: 'upload', version: 3, relationTo: 'media', value: 42, fields: {} }))).toBe('')
    expect(warn).toHaveBeenCalled()
  })
})

describe('táblázat', () => {
  const cell = (textValue: string, headerState: number): LexicalNode => ({
    type: 'tablecell',
    version: 1,
    headerState,
    children: [paragraph(text(textValue))],
  })
  const row = (...cells: LexicalNode[]): LexicalNode => ({
    type: 'tablerow',
    version: 1,
    children: cells,
  })

  it('table → <table>, th scope=col a fejlécen, th scope=row az első oszlopon', () => {
    const output = html(
      root({
        type: 'table',
        version: 1,
        children: [
          row(cell('Út', 1), cell('Amit tudni lehet', 1)),
          row(cell('Otthon', 2), cell('Fájdalomcsillapító', 0)),
        ],
      }),
    )
    expect(output).toContain('<table')
    expect(output).toContain('kc-richtext__table-wrap')
    expect(output).toContain('scope="col"')
    expect(output).toContain('scope="row"')
    expect(output).toContain('<th scope="col">')
    expect(output).toContain('<th scope="row">')
    expect(output).toContain('<td>')
    expect(output).toContain('Otthon')
  })
})

describe('egyéb blokkok és graceful fallback', () => {
  it('idézet → blockquote, horizontalrule → hr', () => {
    expect(html(root({ type: 'quote', version: 1, children: [text('Idézet')] }))).toBe(
      '<blockquote>Idézet</blockquote>',
    )
    expect(html(root({ type: 'horizontalrule', version: 1 }))).toBe('<hr/>')
  })

  it('ismeretlen blokk-típus: nem hasal el, gyermekei renderelődnek, dev-figyelmeztetés', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const output = html(
      root({ type: 'jovobeli-embed', version: 1, children: [paragraph(text('Tartalom'))] }),
    )
    expect(output).toBe('<p>Tartalom</p>')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('jovobeli-embed'))
  })

  it('custom block (blockType) gyermek nélkül → kimarad, figyelmeztetéssel', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(html(root({ type: 'block', version: 3, fields: { blockType: 'ismeretlen' } }))).toBe('')
    expect(warn).toHaveBeenCalled()
  })

  it('extractPlainText: a teljes fa szövege (olvasási időhöz)', () => {
    const content = root(
      paragraph(text('Első bekezdés.'), { type: 'list', listType: 'bullet', version: 1, children: [{ type: 'listitem', version: 1, children: [text('Listaelem')] }] }),
      { type: 'quote', version: 1, children: [text('Idézet')] },
    )
    expect(extractPlainText(content.root)).toContain('Első bekezdés.')
    expect(extractPlainText(content.root)).toContain('Idézet')
  })
})
