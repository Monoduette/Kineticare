import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CourseAudienceBand } from '../components/courses/CourseAudienceBand'
import {
  AUDIENCE_BANDS,
  AUDIENCE_LABELS,
  groupProductsByAudience,
  normalizeAudience,
} from '../lib/course-audience'
import type { Product } from '../payload-types'

/**
 * Kétirányú kurzusstruktúra — a besorolás szabálya és a sávok renderelése.
 *
 * A hangsúly az ADAT-tűrésen: a products.audience mező a meglévő soroknál NULL,
 * ezért minden nem-'szakember' érték a laikus ágba esik. A sorrend-tartás is
 * szerződés: a csoportosító nem borítja fel a lekérdezés rendezését.
 */

/** Minimális termék-fixture; az `audience` szándékosan tetszőleges érték lehet. */
function product(id: number, audience?: unknown): { id: number; audience?: unknown } {
  return audience === undefined ? { id } : { id, audience }
}

describe('normalizeAudience — a besorolás egyetlen forrása', () => {
  it("a 'szakember' érték marad szakember", () => {
    expect(normalizeAudience('szakember')).toBe('szakember')
  })

  it("a 'laikus' érték marad laikus", () => {
    expect(normalizeAudience('laikus')).toBe('laikus')
  })

  it('hiányzó érték (null/undefined) laikusra esik vissza — a régi sorok ága', () => {
    expect(normalizeAudience(null)).toBe('laikus')
    expect(normalizeAudience(undefined)).toBe('laikus')
  })

  it('ismeretlen vagy rossz típusú érték laikusra esik vissza', () => {
    expect(normalizeAudience('szakembernek')).toBe('laikus')
    expect(normalizeAudience('SZAKEMBER')).toBe('laikus')
    expect(normalizeAudience('')).toBe('laikus')
    expect(normalizeAudience(0)).toBe('laikus')
    expect(normalizeAudience({ audience: 'szakember' })).toBe('laikus')
  })
})

describe('groupProductsByAudience — a két sáv tartalma', () => {
  it('vegyes listát a két ág közé oszt, az audience nélkülit laikusba', () => {
    const groups = groupProductsByAudience([
      product(1, 'szakember'),
      product(2, 'laikus'),
      product(3, null),
      product(4),
      product(5, 'ismeretlen-ertek'),
    ])
    expect(groups.laikus.map((p) => p.id)).toEqual([2, 3, 4, 5])
    expect(groups.szakember.map((p) => p.id)).toEqual([1])
  })

  it('a bejövő sorrendet nem borítja fel (nagy elemszámon sem)', () => {
    const many = Array.from({ length: 200 }, (_, index) =>
      product(index + 1, index % 3 === 0 ? 'szakember' : 'laikus'),
    )
    const groups = groupProductsByAudience(many)
    const laikusIds = groups.laikus.map((p) => p.id)
    const szakemberIds = groups.szakember.map((p) => p.id)

    expect(laikusIds.length + szakemberIds.length).toBe(200)
    // sávon belül szigorúan növekvő = a bemenet sorrendje megmaradt
    expect(laikusIds).toEqual([...laikusIds].sort((a, b) => a - b))
    expect(szakemberIds).toEqual([...szakemberIds].sort((a, b) => a - b))
    expect(szakemberIds[0]).toBe(1)
    expect(laikusIds[0]).toBe(2)
  })

  it('üres bemenetre mindkét kulcs létezik, üres tömbbel', () => {
    const groups = groupProductsByAudience([])
    expect(groups.laikus).toEqual([])
    expect(groups.szakember).toEqual([])
  })

  it('csak az egyik ág van jelen — a másik üres marad', () => {
    const onlyPros = groupProductsByAudience([product(1, 'szakember'), product(2, 'szakember')])
    expect(onlyPros.laikus).toEqual([])
    expect(onlyPros.szakember).toHaveLength(2)

    const onlyHome = groupProductsByAudience([product(3), product(4, 'laikus')])
    expect(onlyHome.szakember).toEqual([])
    expect(onlyHome.laikus).toHaveLength(2)
  })
})

describe('AUDIENCE_BANDS — sávsorrend és horgonyok', () => {
  it('az otthoni (laikus) sáv van elöl, a szakmai utána', () => {
    expect(AUDIENCE_BANDS.map((band) => band.audience)).toEqual(['laikus', 'szakember'])
  })

  it('stabil magyar horgony-azonosítók és a két ág megjelenő neve', () => {
    expect(AUDIENCE_BANDS.map((band) => band.anchorId)).toEqual(['otthoni', 'szakembereknek'])
    expect(AUDIENCE_LABELS.laikus).toBe('Otthoni gyakorlóknak')
    expect(AUDIENCE_LABELS.szakember).toBe('Szakembereknek')
    expect(AUDIENCE_BANDS.map((band) => band.title)).toEqual([
      'Otthoni gyakorlóknak',
      'Szakembereknek',
    ])
  })

  it('a sáv-felvezetőben nincs töltelék gondolatjel, a csukló-/ujj- kötőjel megmaradhat', () => {
    const [homeBand] = AUDIENCE_BANDS
    expect(homeBand.lead).toBe(
      'Otthon, egyedül is végezhető gyakorlatok a fájdalom enyhítésére, érthetően, szaknyelv nélkül.',
    )
    expect(homeBand.lead).not.toMatch(/[–—]/)
  })
})

describe('CourseAudienceBand — a sáv megjelenítése', () => {
  const [homeBand, proBand] = AUDIENCE_BANDS
  const course = { id: 42, sku: 'Kézrehab alapkurzus' } as Product

  it('a sáv címsora h2, horgonnyal, egymondatos felvezetővel', () => {
    const html = renderToStaticMarkup(
      createElement(CourseAudienceBand, { band: homeBand, products: [course] }),
    )
    expect(html).toContain('id="otthoni"')
    expect(html).toContain('<h2')
    expect(html).toContain('Otthoni gyakorlóknak')
    expect(html).toContain(homeBand.lead)
    expect(html).toContain('aria-labelledby="otthoni-cim"')
  })

  it('a kártyák címe h3 — az oldalon egyetlen h1 és sávonként egy h2 marad', () => {
    const html = renderToStaticMarkup(
      createElement(CourseAudienceBand, { band: proBand, products: [course] }),
    )
    expect(html).toContain('id="szakembereknek"')
    expect(html).toContain('<h3')
    expect(html).toContain('Kézrehab alapkurzus')
    expect(html).toContain('/kurzusok/42')
  })

  it('üres sáv esetén SEMMI nem renderelődik (se cím, se helykitöltő)', () => {
    for (const band of AUDIENCE_BANDS) {
      const html = renderToStaticMarkup(createElement(CourseAudienceBand, { band, products: [] }))
      expect(html).toBe('')
    }
  })
})
