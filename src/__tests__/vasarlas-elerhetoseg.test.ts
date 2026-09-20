import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CourseBuybox } from '../components/courses/CourseBuybox'
import { ProductCard } from '../components/content/ProductCard'
import { formatPriceHuf } from '../lib/format-price'
import type { Product } from '../payload-types'

/**
 * ŐR — a „Megveszem" gomb ELÉRHETŐSÉGE (2026-08-16, mért regresszió).
 * Böngészős mérés (produkciós build, Chromium 141, `elementFromPoint`,
 * `behavior: 'instant'` görgetés, 40 mintapont a lap teljes görgetésén):
 * | méret     | süti-sávval kattintható | süti-sáv nélkül |
 * | --------- | ----------------------- | --------------- |
 */

const REPO = fileURLToPath(new URL('..', import.meta.url))
const olvas = (relativUt: string): string => readFileSync(join(REPO, relativUt), 'utf8')

/** Kommentek nélküli CSS — a SZABÁLYOKAT mérjük, nem az indoklásukat. */
const kommentNelkul = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * Egy szelektor deklarációs blokkja. Ha a szelektor többször szerepel (pl. a
 * mobil alapállapot és a médialekérdezésen belüli asztali változat), a
 * `jellemzo` mintát TARTALMAZÓ blokk jön vissza.
 */
function blokk(css: string, szelektor: string, jellemzo: string): string {
  const tiszta = kommentNelkul(css)
  let index = tiszta.indexOf(szelektor)
  while (index >= 0) {
    const nyit = tiszta.indexOf('{', index)
    const zar = tiszta.indexOf('}', nyit)
    const test = tiszta.slice(nyit + 1, zar)
    if (test.includes(jellemzo)) {
      return test
    }
    index = tiszta.indexOf(szelektor, zar)
  }
  return ''
}

// A `priceInHUF` NEM elhagyhato: a `resolveCourseCta` az ERVENYES arat
// kerdezi (nem az ar-pipa tagadasat), mert a felulet korabban olyan vasarlast
// kinalt, amit a checkout-kapu elutasitott. Ar nelkul ez a fixtura helyesen
// „nem vasarolhato" allapotot adna, es nem lenne mit merni a sorrenden.
const product = { id: 42, status: 'published', priceInHUFEnabled: true, priceInHUF: 79500 } as Pick<
  Product,
  'id' | 'status' | 'priceInHUFEnabled' | 'priceInHUF'
>

function buybox(overrides: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(CourseBuybox, {
      audienceLabel: 'Otthoni gyakorlóknak',
      categoryLabel: 'Kézrehabilitáció',
      ctaId: 'kurzus-vasarlas-gomb',
      guaranteeLabel: '30 napos kipróbálási garancia',
      hasPurchased: false,
      highlights: ['Örökös hozzáférés', '50+ videós gyakorlat', '4 modul'],
      id: 'kurzus-vasarlas',
      lead: 'Otthon végezhető kézrehabilitáció.',
      priceBadge: 'price',
      priceHuf: 79500,
      product,
      secondaryHref: '#kinek-valo',
      secondaryLabel: 'Kinek való?',
      title: 'Otthoni KézRehab Program',
      ...overrides,
    }),
  )
}

// ---------------------------------------------------------------------------
// 1. A vásárlódoboz sorrendje: ár és gomb a doboz ELEJÉN
// ---------------------------------------------------------------------------

describe('CourseBuybox — a döntési elem a doboz elején áll', () => {
  const html = buybox()

  it('az ár és a gomb az előnysorok ELŐTT jön (a doboz első képernyőjébe esik)', () => {
    const ar = html.indexOf(formatPriceHuf(79500))
    const gomb = html.indexOf('Megveszem')
    const elonysor = html.indexOf('kc-course-checklist__item')
    expect(ar).toBeGreaterThanOrEqual(0)
    expect(gomb).toBeGreaterThanOrEqual(0)
    expect(elonysor).toBeGreaterThanOrEqual(0)
    // Ez a sorrend a régi kódon MEGBUKOTT: ott a pipás sorok álltak elöl.
    expect(ar).toBeLessThan(elonysor)
    expect(gomb).toBeLessThan(elonysor)
    // Az ár továbbra is a gomb KÖZVETLEN közelében, előtte (B6.2).
    expect(ar).toBeLessThan(gomb)
  })

  it('a cím és a lead marad a doboz legelején (a H1 nem csúszik a gomb mögé)', () => {
    expect(html.indexOf('<h1')).toBeLessThan(html.indexOf(formatPriceHuf(79500)))
    expect(html.indexOf('Otthon végezhető')).toBeLessThan(html.indexOf('Megveszem'))
  })

  it('semmilyen mező nem veszett el a sorrend-váltással', () => {
    expect(html).toContain('Örökös hozzáférés')
    expect(html).toContain('30 napos kipróbálási garancia')
    expect(html).toContain('href="#kinek-valo"')
    expect(html).toContain('/penztar?termek=42')
  })
})

// ---------------------------------------------------------------------------
// 2. A ragadós doboz belső görgetése (asztali)
// ---------------------------------------------------------------------------

describe('ragadós vásárlódoboz — a gomb minden asztali magasságon elérhető', () => {
  const kurzusok = olvas('app/(frontend)/kurzusok/kurzusok.css')
  // A `calc(...)` a formázó miatt több sorba törhet — a szabályt szóköz-
  // normalizált alakban mérjük, hogy a tördelés ne bukjon el rajta.
  // A `calc(...)` a formázó miatt több sorba törhet: a zárójel utáni
  // sortörést és a behúzást is ki kell szedni, hogy a szabályt mérjük, ne a
  // tördelését.
  const asideBlokk = blokk(kurzusok, '.kc-course-layout__aside', 'position: sticky')
    .replace(/\s+/g, ' ')
    .replace(/\( /g, '(')
    .replace(/ \)/g, ')')

  it('a doboz magassága a nézetablakhoz kötött (dvh), és belül görgethető', () => {
    expect(asideBlokk).toContain('position: sticky')
    expect(asideBlokk).toContain('max-height: calc(100dvh')
    // vh-fallback a dvh-t nem ismerő böngészőknek — a sorrend számít.
    expect(asideBlokk).toContain('max-height: calc(100vh')
    expect(asideBlokk.indexOf('max-height: calc(100vh')).toBeLessThan(
      asideBlokk.indexOf('max-height: calc(100dvh'),
    )
    expect(asideBlokk).toContain('overflow-y: auto')
  })

  it('a belső görgetés nem ragad át a lapra (scroll chaining)', () => {
    expect(asideBlokk).toContain('overscroll-behavior: contain')
  })

  it('a doboz a ragadós fejléc alá sem csúszhat (WCAG 2.2 SC 2.4.11)', () => {
    expect(asideBlokk).toContain('top: calc(var(--kc-header-height) + var(--kc-space-4))')
    // A fókusz-ugrás a dobozon belül is levegőt kap.
    expect(asideBlokk).toContain('scroll-padding-block')
  })

  it('a doboz alja nem érhet a süti-sáv mögé (a magasságból az is levonódik)', () => {
    expect(asideBlokk).toContain('var(--kc-consent-offset, 0px)')
  })
})

// ---------------------------------------------------------------------------
// 3. A ragadós vásárlósáv: tartalék, amikor a gomb nem fér ki
// ---------------------------------------------------------------------------

describe('ragadós vásárlósáv — méret-alapú tartalék, nem töréspont', () => {
  const kurzusok = olvas('app/(frontend)/kurzusok/kurzusok.css')
  const sav = olvas('components/courses/CourseBuyBar.tsx')
  const oldal = olvas('app/(frontend)/kurzusok/[slug]/page.tsx')
  const cta = olvas('components/courses/CourseCta.tsx')

  it('a sáv NEM szélesség-töréspont mögött áll (asztalon is megjelenhet)', () => {
    const tiszta = kommentNelkul(kurzusok)
    const savIndex = tiszta.indexOf(".kc-course-buybar[data-visible='true']")
    expect(savIndex).toBeGreaterThanOrEqual(0)
    // A régi kódon a sáv `@media (max-width: 1023px)` mögött volt: 1024 px
    // felett akkor sem jelent meg, ha a gomb nem fért ki.
    expect(tiszta).not.toContain('@media (max-width: 1023px)')
  })

  it('a sáv a vásárlógombot figyeli, nem az egész dobozt', () => {
    // Az id a gombra (CTA-blokkra) kerül, és a sáv EZT kapja horgonyként.
    expect(cta).toContain('className="kc-course-cta" id={id}')
    expect(oldal).toContain("const CTA_ID = 'kurzus-vasarlas-gomb'")
    expect(oldal).toContain('ctaId={CTA_ID}')
    expect(oldal).toContain('anchorId={CTA_ID}')
    expect(sav).toContain('new IntersectionObserver(')
    expect(sav).toContain('document.getElementById(anchorId)')
  })

  it('a RÉSZBEN levágott gomb is elégtelen: az arány dönt, nem a puszta metszés', () => {
    // A régi kód `!entry.isIntersecting`-et használt: egy 21 pixeles sáv a
    // gombból már „láthatónak" számított, holott a közepe nem volt kattintható.
    // Több megfigyelt gomb (akciós záró sáv) mellett is az ARÁNY dönt: a sáv
    // csak akkor látszik, ha egyik gomb sem éri el a küszöböt.
    expect(sav).toContain('ratio >= TELJESEN_LATSZIK')
    expect(sav).toContain('ratios.set(entry.target, entry.intersectionRatio)')
    expect(sav).toContain('threshold: [0, TELJESEN_LATSZIK]')
    expect(sav).not.toContain('!entry.isIntersecting')
  })

  it('JS nélkül a sáv csendben elmarad (a CSS alapállapot rejtett)', () => {
    expect(blokk(kurzusok, '.kc-course-buybar', 'display: none')).toContain('display: none')
    expect(sav).toContain('data-visible="false"')
  })

  it('széles képernyőn a sáv gombja NEM teljes szélességű (Baymard #791)', () => {
    const szeles = blokk(kurzusok, '.kc-course-buybar__cta', 'min-width')
    expect(szeles).toContain('max-width: none')
    expect(szeles).toContain('min-width')
  })
})

// ---------------------------------------------------------------------------
// 4. A vásárlósáv és a süti-sáv nem takarja egymást
// ---------------------------------------------------------------------------

describe('vásárlósáv — a süti-sáv FÖLÉ tolva', () => {
  const kurzusok = olvas('app/(frontend)/kurzusok/kurzusok.css')
  const tokens = olvas('app/(frontend)/styles/tokens.css')
  const banner = olvas('components/analytics/ConsentBanner.tsx')

  it('a változónak van 0px alapértéke a tokenekben (süti-sáv nélkül nincs eltolás)', () => {
    expect(tokens).toContain('--kc-consent-offset: 0px;')
  })

  it('a vásárlósáv alja a süti-sáv magasságához igazodik, nem 0-hoz', () => {
    const savBlokk = blokk(kurzusok, ".kc-course-buybar[data-visible='true']", 'position: fixed')
    expect(savBlokk).toContain('bottom: var(--kc-consent-offset, 0px)')
    // A régi kódon ez `bottom: 0` volt — a süti-sáv teljesen eltakarta.
    expect(savBlokk).not.toContain('bottom: 0;')
  })

  it('a lap alsó térköze és a horgony-ugrás is beleszámolja a süti-sávot', () => {
    expect(blokk(kurzusok, '.kc-has-buybar', 'scroll-padding-bottom')).toContain(
      'var(--kc-consent-offset, 0px)',
    )
    expect(blokk(kurzusok, '.kc-has-buybar body', 'padding-bottom')).toContain(
      'var(--kc-consent-offset, 0px)',
    )
  })

  it('a süti-sáv a SAJÁT, mért magasságát írja ki, és eltűnéskor törli', () => {
    // A konstans neve a tulelo implementacioe (OFFSET_VAR); a MERT ertek es a
    // takaritas ugyanaz. Ket fuggetlen kor vezette be ugyanezt a mechanizmust,
    // a szuretnel a stiluslapos valtozat maradt.
    expect(banner).toContain("const OFFSET_VAR = '--kc-consent-offset'")
    expect(banner).toContain('new ResizeObserver(')
    expect(banner).toContain('getBoundingClientRect().height')
    expect(banner).toContain('root.style.removeProperty(OFFSET_VAR)')
    // A láthatóság a hatás FÜGGŐSÉGE — elrejtéskor nem marad ott szellem-eltolás.
    expect(banner).toContain('}, [visible])')
  })
})

// ---------------------------------------------------------------------------
// 4. A kiemelt kurzuskártya akadálymentes neve
// ---------------------------------------------------------------------------

describe('ProductCard — a link neve rövid és beszédes', () => {
  const kartya = (featured: boolean): string =>
    renderToStaticMarkup(
      createElement(ProductCard, {
        featured,
        product: {
          id: 7,
          slug: 'otthoni-kezrehab-program',
          sku: 'KEZREHAB-001',
          displayTitle: 'Otthoni KézRehab Program',
          shortDescription: 'Otthon végezhető kézrehabilitációs program.',
          cardHighlights: [{ id: 'a', text: '50+ videós gyakorlat' }],
          coverImage: {
            id: 3,
            alt: 'Otthoni KézRehab Program csomagkép',
            url: '/media/borito.webp',
            width: 1200,
            height: 800,
            updatedAt: '2026-01-01T00:00:00.000Z',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          priceInHUF: 79500,
          priceInHUFEnabled: true,
          accessDurationDays: 365,
          audience: 'laikus',
          status: 'published',
        } as ProductCardProduct,
      }),
    )

  it('a link explicit, rövid nevet kap, amely tartalmazza a látható címet', () => {
    const html = kartya(true)
    expect(html).toContain('aria-label="Otthoni KézRehab Program: a kurzus részletei"')
  })

  it('a borító DEKORATÍV: az alt üres, tehát nem ismétli meg a címet', () => {
    const html = kartya(true)
    expect(html).toContain('alt=""')
    // A régi kódon a borító alt-ja a címet vitte a link nevébe.
    expect(html).not.toContain('alt="Otthoni KézRehab Program csomagkép"')
  })

  it('a nem kiemelt változatra ugyanez áll (egy szabály, két elrendezés)', () => {
    const html = kartya(false)
    expect(html).toContain('aria-label="Otthoni KézRehab Program: a kurzus részletei"')
    expect(html).toContain('alt=""')
  })
})

/** A ProductCard `product` propjának típusa — a teszt-fixtúra szűkítéséhez. */
type ProductCardProduct = Parameters<typeof ProductCard>[0]['product']
