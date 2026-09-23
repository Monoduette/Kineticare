import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { HomeView } from '../components/content/HomeView'
import { FAQ_ITEMS } from '../components/content/home/Faq'
import {
  breadcrumbJsonLd,
  courseJsonLd,
  faqPageJsonLd,
  organizationJsonLd,
  SITE_DESCRIPTION,
} from '../lib/seo'
import robots from '../app/robots'

/**
 * SEO / GEO strukturált adat és crawler-hozzáférés.
 *
 * Miért teszteljük: a strukturált adat és a robots.txt csendben tud elromlani —
 * nincs futásidejű hibája, csak a láthatóság tűnik el hetekre. Ezek a tesztek a
 * három leggyakoribb csendes hibát fogják meg: (1) AI-crawler kizárása,
 * (2) privát útvonal indexelhetővé válása, (3) a schema és a látható szöveg
 * szétcsúszása.
 */

describe('robots.txt', () => {
  const result = robots()
  const rules = Array.isArray(result.rules) ? result.rules : [result.rules]

  it('minden AI-crawlert enged (a GEO-láthatóság előfeltétele)', () => {
    const agents = rules.map((rule) => rule.userAgent)
    for (const agent of [
      'GPTBot',
      'OAI-SearchBot',
      'ClaudeBot',
      'PerplexityBot',
      'Google-Extended',
    ]) {
      expect(agents).toContain(agent)
    }
    // Egyetlen szabály sem tilthatja le a teljes oldalt.
    for (const rule of rules) {
      const disallow = rule.disallow
      const list = Array.isArray(disallow) ? disallow : disallow ? [disallow] : []
      expect(list).not.toContain('/')
    }
  })

  it('a privát és tranzakciós útvonalakat minden szabály tiltja', () => {
    for (const rule of rules) {
      const disallow = rule.disallow
      const list = Array.isArray(disallow) ? disallow : disallow ? [disallow] : []
      for (const path of ['/admin', '/api/', '/fiok', '/kurzusaim', '/penztar']) {
        expect(list).toContain(path)
      }
    }
  })

  it('a nyilvános képeket (og:image) engedi, a többi API-t nem', () => {
    // A megosztási előnézet képe a /api/media/file/ alól jön; ha a /api/
    // tiltás ezt is lefedné, a robots.txt-t tisztelő botok kép nélküli
    // kártyát mutatnának.
    for (const rule of rules) {
      const allow = rule.allow
      const list = Array.isArray(allow) ? allow : allow ? [allow] : []
      expect(list).toContain('/')
      expect(list).toContain('/api/media/file/')
      expect(list.filter((path) => path.startsWith('/api/'))).toEqual(['/api/media/file/'])
    }
  })

  it('hivatkozik a sitemapre', () => {
    expect(String(result.sitemap)).toMatch(/\/sitemap\.xml$/)
  })

  it('a Tudástár /blog útvonalát nem tiltja (a közzétett cikkek indexelendők)', () => {
    for (const rule of rules) {
      const disallow = rule.disallow
      const list = Array.isArray(disallow) ? disallow : disallow ? [disallow] : []
      expect(list).not.toContain('/blog')
      expect(list).not.toContain('/blog/')
    }
  })
})

describe('FAQPage JSON-LD', () => {
  it('a kezdőlap GYIK-jével azonos forrásból épül, csonkolás nélkül', () => {
    const jsonLd = faqPageJsonLd(FAQ_ITEMS)
    const mainEntity = jsonLd.mainEntity as Array<Record<string, unknown>>

    expect(jsonLd['@type']).toBe('FAQPage')
    expect(mainEntity).toHaveLength(FAQ_ITEMS.length)
    expect(FAQ_ITEMS.length).toBeGreaterThan(0)

    mainEntity.forEach((entry, index) => {
      const accepted = entry.acceptedAnswer as Record<string, unknown>
      expect(entry.name).toBe(FAQ_ITEMS[index]!.question)
      // A TELJES válasz kerül a schemába — a csonkolt válasz félreidézhető.
      expect(accepted.text).toBe(FAQ_ITEMS[index]!.answer)
    })
  })
})

describe('Course JSON-LD', () => {
  const product = {
    shortDescription: 'Nyolc hetes otthoni kézrehabilitációs program.',
    status: 'published' as const,
  }

  it('árat és elérhetőséget közöl, ha van ár', () => {
    const jsonLd = courseJsonLd({
      product,
      name: 'Kéz-rehab alapprogram',
      path: '/kurzusok/7',
      priceHuf: 19990,
    })
    const offers = jsonLd.offers as Record<string, unknown>

    // Egy entitás, kettős típussal: online kurzus ÉS megvásárolható termék.
    // A Product-oldali mezőket (sku, brand, offers) a product-seo.test.ts fedi.
    expect(jsonLd['@type']).toEqual(['Course', 'Product'])
    expect(jsonLd.description).toBe(product.shortDescription)
    expect(offers.price).toBe(19990)
    expect(offers.priceCurrency).toBe('HUF')
    expect(offers.availability).toBe('https://schema.org/InStock')
  })

  it('archivált kurzusnál a készlet Discontinued', () => {
    const jsonLd = courseJsonLd({
      product: { ...product, status: 'archived' },
      name: 'Régi kurzus',
      path: '/kurzusok/8',
      priceHuf: 9990,
    })
    expect((jsonLd.offers as Record<string, unknown>).availability).toBe(
      'https://schema.org/Discontinued',
    )
  })

  it('ár nélkül NEM közöl offers-t (a 0 Ft félrevezető strukturált adat lenne)', () => {
    const jsonLd = courseJsonLd({
      product,
      name: 'Ingyenes SOS',
      path: '/kurzusok/9',
      priceHuf: null,
    })
    expect(jsonLd.offers).toBeUndefined()
  })
})

describe('BreadcrumbList JSON-LD', () => {
  it('sorszámozott, abszolút URL-es listát ad', () => {
    const jsonLd = breadcrumbJsonLd([
      { name: 'Tudástár', path: '/blog' },
      { name: 'Cikk', path: '/blog/cikk' },
    ])
    const items = jsonLd.itemListElement as Array<Record<string, unknown>>

    expect(items).toHaveLength(2)
    expect(items[0]!.position).toBe(1)
    expect(items[1]!.position).toBe(2)
    expect(String(items[1]!.item)).toMatch(/^https?:\/\/.+\/blog\/cikk$/)
  })
})

describe('Kezdőlap strukturált adat (render)', () => {
  const html = renderToStaticMarkup(
    createElement(HomeView, { home: null, products: [], posts: [] }),
  )
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map(
    (match) => JSON.parse(match[1]!.replace(/&quot;/g, '"')) as Record<string, unknown>,
  )

  it('az Organization séma PONTOSAN egyszer szerepel', () => {
    // Élesben duplán jelent meg, mert a page.tsx és a HomeView is kirenderelte.
    // A duplikált entitás-leírás validációs figyelmeztetést okoz, és fölöslegesen
    // kétszer írja le ugyanazt a gépi olvasónak.
    const organizations = blocks.filter((block) => block['@type'] === 'Organization')
    expect(organizations).toHaveLength(1)
  })

  it('a FAQPage séma szerepel a kezdőlapon', () => {
    expect(blocks.filter((block) => block['@type'] === 'FAQPage')).toHaveLength(1)
  })
})

describe('Organization JSON-LD', () => {
  it('nyelvet és szakterületet is közöl (entitás-egyértelműsítés AI-válaszokhoz)', () => {
    const jsonLd = organizationJsonLd()
    expect(jsonLd.inLanguage).toBe('hu-HU')
    expect(Array.isArray(jsonLd.knowsAbout)).toBe(true)
    expect(jsonLd.description).toBe(SITE_DESCRIPTION)
    expect(String(jsonLd.description)).not.toMatch(/[–—]/)
  })
})
