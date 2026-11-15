import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CourseMaterials, COURSE_MATERIALS_HEADING } from '../components/account/CourseMaterials'

/**
 * A kurzus segédanyag-linkjei (lejátszó, Kurzusaim kártya).
 *
 * Mit véd: a vevő telefonról nyitja meg a gyakorlatfüzetet. A kényszerített
 * letöltés (`download`) a Fájlok alkalmazásba tenné, ahol nem találja; új
 * lapon a telefon nézője nyitja meg, a lecke a helyén marad. A link ezért új
 * lapon nyílik, ezt ki is mondja (WCAG 2.2 · 3.2.5, G201), és a formátum meg a
 * méret a koppintás előtt látszik (GOV.UK, Content design: Links).
 */
describe('CourseMaterials', () => {
  const html = renderToStaticMarkup(
    createElement(CourseMaterials, {
      materials: [
        { label: 'Gyakorlatfüzet', url: '/api/course-files/file/fuzet.pdf', detail: 'PDF, 2,4 MB' },
        { label: 'Ismétlésszámok', url: null, detail: null },
      ],
    }),
  )

  it('a fájl új lapon nyílik, kényszerített letöltés nélkül, és ezt a link kimondja', () => {
    const link = /<a [^>]*>.*?<\/a>/.exec(html)?.[0] ?? ''
    expect(link).toContain('href="/api/course-files/file/fuzet.pdf"')
    expect(link).toContain('target="_blank"')
    expect(link).not.toContain('download')
    expect(link).toContain('Gyakorlatfüzet')
    expect(link).toContain('(PDF, 2,4 MB)')
    expect(link).toContain('új lapon nyílik')
  })

  it('a fel nem töltött fájl sora megmarad, de nem link', () => {
    expect(html).toContain('Ismétlésszámok: a fájl feltöltése folyamatban')
    expect(html.match(/<a /g)).toHaveLength(1)
  })

  it('segédanyag nélkül a szekció és a címe sem jelenik meg', () => {
    const empty = renderToStaticMarkup(createElement(CourseMaterials, { materials: [] }))
    expect(empty).toBe('')
    expect(html).toContain(COURSE_MATERIALS_HEADING)
  })
})
