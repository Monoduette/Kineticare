import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CategoryFilter } from '../components/content/CategoryFilter'
import { PostListFilter } from '../components/content/PostListFilter'
import {
  categoryPath,
  categorySlugFromPath,
  filterStatusText,
  findCategory,
  postCategoryIds,
} from '../components/content/post-list'

/**
 * ŐR — a Tudástár kategória-szűrője KLIENS-OLDALI szűrő, nem al-oldalra ugró
 * link-sor (tulajdonosi kérés, 2026-09-08: „megmaradnának azok a kis
 * buborékok … csak az lenne aktív, amit éppen kiválasztottam, és egyből
 * tudnék másikra kattintva váltani”).
 *
 * Amit véd (mindegyik némán romlana el, a lap 200-zal válaszolna tovább):
 *  1. A chipek JS nélkül is működő linkek a KANONIKUS kategória-címre
 *     (progresszív ráépítés; a kereső bejárja őket), és a chip href-je meg a
 *     kliens `pushState` címe ugyanabból a függvényből jön.
 *  2. Az aktív chip `aria-current="page"`-et visel, `aria-pressed`-et NEM
 *     (ARIA in HTML: linken az `aria-pressed` nem megengedett,
 *     https://www.w3.org/TR/html-aria/#el-a).
 *  3. A szűrt nézetben a chipsor OTT MARAD (a kategória-oldalon is), és van
 *     látható `role="status"` állapotsor a találatszámmal (WCAG 2.2 SC 4.1.3).
 *  4. A SSR a szűrt listát rajzolja ki: a kategória-nézet HTML-jében csak a
 *     téma kártyái vannak, az üres témára a `kategoria` üres állapot jön.
 *  5. A `popstate` útvonal-értelmezője a cikk-URL-t (`/blog/<cikk>`) NEM
 *     tekinti szűrőnek.
 *  6. A lista belépője a közös kulcsképsort használja, és csökkentett
 *     mozgásnál ki van kapcsolva (SC 2.3.3).
 */

const REPO = fileURLToPath(new URL('..', import.meta.url))
const olvas = (relativUt: string): string => readFileSync(`${REPO}${relativUt}`, 'utf8')

const kategoriak = [
  { id: 1, title: 'Kéz és csukló', slug: 'kez-es-csuklo' },
  { id: 2, title: 'Törés és műtét után', slug: 'tores-es-mutet-utan' },
  { id: 3, title: 'Váll és könyök', slug: 'vall-es-konyok' },
]

const items = [
  { key: 'a', categoryIds: [1], card: createElement('article', { className: 'c' }, 'A') },
  { key: 'b', categoryIds: [1, 3], card: createElement('article', { className: 'c' }, 'B') },
  { key: 'c', categoryIds: [2], card: createElement('article', { className: 'c' }, 'C') },
]

const render = (initialSlug?: string, showFilter = true) =>
  renderToStaticMarkup(
    createElement(PostListFilter, {
      categories: kategoriak,
      initialSlug,
      items,
      emptyState: createElement('section', { id: 'ures' }, 'nincs'),
      showFilter,
      lead: 'Felvezető.',
    }),
  )

describe('útvonal-szabályok (a href és a pushState egy forrásból)', () => {
  it('az „Összes” a /blog, a kategória a dedikált kategória-cím', () => {
    expect(categoryPath(undefined)).toBe('/blog')
    expect(categoryPath('tores-es-mutet-utan')).toBe('/blog/kategoria/tores-es-mutet-utan')
  })

  it('a popstate-értelmező csak a szűrő címeit ismeri fel', () => {
    expect(categorySlugFromPath('/blog')).toBeUndefined()
    expect(categorySlugFromPath('/blog/')).toBeUndefined()
    expect(categorySlugFromPath('/blog/kategoria/vall-es-konyok')).toBe('vall-es-konyok')
    expect(categorySlugFromPath('/blog/kez-zsibbadas')).toBeNull()
    expect(categorySlugFromPath('/blog/kategoria/')).toBeNull()
    expect(categorySlugFromPath('/blog/kategoria/a/b')).toBeNull()
    expect(categorySlugFromPath('/kurzusok')).toBeNull()
  })

  it('az állapotsor magyar, kettőspontos, gondolatjel nélküli', () => {
    expect(filterStatusText(8, null)).toBe('Összes kategória: 8 cikk')
    expect(filterStatusText(1, 'Törés és műtét után')).toBe('Törés és műtét után: 1 cikk')
    expect(filterStatusText(0, 'Váll és könyök')).not.toMatch(/[–—]/)
  })

  it('a kategória-id-k a nyers és a populate-olt alakból is kijönnek', () => {
    expect(postCategoryIds({ categories: [1, { id: 2, title: 'x', slug: 'x' } as never] })).toEqual(
      [1, 2],
    )
    expect(postCategoryIds({ categories: null })).toEqual([])
    expect(findCategory(kategoriak, 'nincs')).toBeNull()
    expect(findCategory(kategoriak, undefined)).toBeNull()
  })
})

describe('chipsor — működő linkek, aria-current, nincs aria-pressed', () => {
  const html = renderToStaticMarkup(
    createElement(CategoryFilter, { categories: kategoriak, activeSlug: 'vall-es-konyok' }),
  )

  it('minden chip <a href> a kanonikus címre (JS nélkül is jár)', () => {
    expect(html).toContain('href="/blog"')
    for (const k of kategoriak) expect(html).toContain(`href="/blog/kategoria/${k.slug}"`)
    expect(html).not.toContain('<button')
  })

  it('pontosan egy chip aktív, aria-current="page"-dzsel; aria-pressed sehol', () => {
    expect(html.match(/aria-current="page"/g)).toHaveLength(1)
    expect(html).toMatch(/aria-current="page"[^>]*href="\/blog\/kategoria\/vall-es-konyok"/)
    expect(html).not.toContain('aria-pressed')
  })

  it('a chipsor navigációs tájékozódási pont, magyar névvel', () => {
    expect(html).toContain('<nav aria-label="Kategória-szűrő"')
  })
})

describe('PostListFilter — a SSR a szűrt listát adja, a chipsor marad', () => {
  it('szűretlen nézet: minden kártya, „Összes” aktív, állapotsor 3 cikk', () => {
    const html = render()
    expect(html.match(/class="c"/g)).toHaveLength(3)
    expect(html).toMatch(/aria-current="page"[^>]*href="\/blog"/)
    expect(html).toContain('role="status"')
    expect(html).toContain('Összes kategória: 3 cikk')
    expect(html).toContain('<h1 class="kc-page-hero__title">Tudástár</h1>')
  })

  it('kategória-nézet: a H1 a TÉMA NEVE (SEO: címsor és <title> összhang), a felvezető alatta', () => {
    const html = render('vall-es-konyok')
    expect(html).toContain('<h1 class="kc-page-hero__title">Váll és könyök</h1>')
    expect(html).not.toContain('<h1 class="kc-page-hero__title">Tudástár</h1>')
    expect(html).toContain('<p class="kc-page-hero__lead">Felvezető.</p>')
  })

  it('a H1 a kliens-állapotból jön, tehát chip-váltással együtt cserélődik (a lapokon nincs saját H1 a tele listán)', () => {
    const blog = olvas('app/(frontend)/blog/page.tsx')
    const kat = olvas('app/(frontend)/blog/kategoria/[slug]/page.tsx')
    // A lapok CSAK az üres (tudastar) állapothoz adnak saját H1-et; a tele
    // lista címsorát a PostListFilter rajzolja.
    expect(blog.match(/kc-page-hero__title/g)).toHaveLength(1)
    expect(kat.match(/kc-page-hero__title/g)).toHaveLength(1)
    expect(kat).toContain('{category.title}</h1>')
  })

  it('kategória-nézet: CSAK a téma kártyái, a chipsor és az állapotsor ott van', () => {
    const html = render('vall-es-konyok')
    expect(html.match(/class="c"/g)).toHaveLength(1)
    expect(html).toContain('>B<')
    expect(html).toContain('<nav aria-label="Kategória-szűrő"')
    expect(html).toContain('Váll és könyök: 1 cikk')
    expect(html).toMatch(/aria-current="page"[^>]*href="\/blog\/kategoria\/vall-es-konyok"/)
  })

  it('ismeretlen slug: a szűretlen lista (nem üres állapot, nem hiba)', () => {
    const html = render('nincs-ilyen')
    expect(html.match(/class="c"/g)).toHaveLength(3)
    expect(html).not.toContain('id="ures"')
  })

  it('üres téma: a kategória üres állapota jön, a chipsor marad (visszaút)', () => {
    const html = renderToStaticMarkup(
      createElement(PostListFilter, {
        categories: [...kategoriak, { id: 4, title: 'Ujj', slug: 'ujj' }],
        initialSlug: 'ujj',
        items,
        emptyState: createElement('section', { id: 'ures' }, 'nincs'),
        showFilter: true,
        lead: 'Felvezető.',
      }),
    )
    expect(html).toContain('id="ures"')
    expect(html).toContain('<nav aria-label="Kategória-szűrő"')
    expect(html).toContain('Ujj: 0 cikk')
  })

  it('a kártyák rácsa a kéthasábos poszt-rács marad', () => {
    expect(render()).toContain('class="kc-card-grid kc-card-grid--posts kc-post-list__grid"')
  })
})

describe('mozgás és stílus — a lista belépője a közös kulcsképsor, reduce alatt semmi', () => {
  const css = olvas('app/(frontend)/styles/blocks/tudastar-lista.css')

  it('a belépő a motion.css `kc-fade-up` kulcsképsorát és a motion-tokent használja', () => {
    expect(css).toMatch(
      /\.kc-post-list__grid\s*\{[^}]*animation:\s*kc-fade-up var\(--kc-motion-base\)/,
    )
    expect(olvas('app/(frontend)/styles/motion.css')).toContain('@keyframes kc-fade-up')
  })

  it('prefers-reduced-motion alatt a belépő ki van kapcsolva', () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.kc-post-list__grid\s*\{[^}]*animation:\s*none/,
    )
  })

  it('a chip hover-állapota nem húz alá (a base.css általános a:hover-e ellen)', () => {
    const content = olvas('app/(frontend)/styles/content.css')
    expect(content).toMatch(/\.kc-category-filter__chip:hover\s*\{[^}]*text-decoration:\s*none/)
  })

  it('a lapok a kliens-szűrőt használják, nem a régi, szűrt lekérdezést', () => {
    const blog = olvas('app/(frontend)/blog/page.tsx')
    const kat = olvas('app/(frontend)/blog/kategoria/[slug]/page.tsx')
    expect(blog).toContain('<PostListFilter')
    expect(kat).toContain('<PostListFilter')
    expect(blog).not.toContain('getPosts({ categorySlug')
    expect(kat).not.toContain('getPosts({ categorySlug')
  })
})
