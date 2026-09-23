import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  featuredTestimonials,
  testimonialQuoteText,
} from '../components/content/home/TestimonialsSection'
import { ctaLabel } from '../lib/cta-vocabulary'
import { LEGACY_REDIRECTS, SERVICES_RENDELOI_ANCHOR } from '../lib/legacy-redirects'
import {
  buildNavigationMenuPlan,
  CLINIC_TREATMENTS_ANCHOR,
  CLINIC_TREATMENTS_PATH,
  SERVICES_PAGE_PATH,
  SERVICES_PAGE_SLUG,
} from '../lib/menu-seed'
import {
  KAPCSOLAT_OLDAL_SLUG,
  KOTOTT_UGROPONTOK,
  kapcsolatiUresLista,
  sectionSource,
  SOS_KURZUS_SLUG,
} from '../lib/section-row-label'
import { isStorefrontFreeSos } from '../lib/sos-offer'
import type { Product, Testimonial } from '../payload-types'

/**
 * A szekció-tájékoztató (src/lib/section-row-label.ts) állításainak kötése a
 * kódhoz, amelyre épülnek (modul-térkép H30, H43, H48; B vezető 2. köri
 * tanítása: ha egy szöveg más csapat vagy zárolt fájl viselkedésére épül, egy
 * őr kösse a sorához, így ha a gazda változtat, a teszt bukik, és a szöveg
 * nem marad csendben hamis).
 *
 * Ahol a forrás tiszta, importálható modul (menu-seed.ts, legacy-redirects.ts,
 * cta-vocabulary.ts, TestimonialsSection.tsx tiszta függvényei), import köt;
 * ahol komponens vagy route (kapcsolat/page.tsx, PostCourseCta.tsx,
 * RenderBlocks.tsx, cms.ts, FreeSos.tsx), a forrássort olvassuk
 * (readFileSync), hogy a kliensoldali tájékoztató ne húzza be őket.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url))
const forras = (utvonal: string): string => readFileSync(join(SRC, utvonal), 'utf8')

/** A fájl első `<Nev` … `/>` JSX-hívásának szövege (a props-listája). */
function jsxHivas(kod: string, nev: string): string {
  const eleje = kod.indexOf(`<${nev}`)
  if (eleje === -1) {
    return ''
  }
  const vege = kod.indexOf('/>', eleje)
  return vege === -1 ? '' : kod.slice(eleje, vege + 2)
}

describe('a Kapcsolat oldal üres listái (a B vezető döntése, 2026-09-23)', () => {
  const route = forras('app/(frontend)/kapcsolat/page.tsx')
  const hivas = jsxHivas(route, 'RenderBlocks')

  it('a route a Kapcsolat CMS-oldalt olvassa, ugyanazzal a webcímmel', () => {
    expect(route).toContain(`const CONTACT_PAGE_SLUG = '${KAPCSOLAT_OLDAL_SLUG}'`)
  })

  it.each([
    ['posts', 'a Tudástár-ajánló (knowledge)'],
    ['products', 'a Kurzuskártyák, a kurzusra vivő gombos sáv és az SOS-sáv'],
    ['testimonials', 'a Vélemények'],
  ] as const)('a RenderBlocks %s listája üres: %s ott másképp látszik', (prop, kinek) => {
    expect(hivas.length).toBeGreaterThan(0)
    expect(
      hivas.includes(`${prop}={[]}`),
      `A /kapcsolat route már nem üres „${prop}” listát ad a RenderBlocks-nak (${kinek}). ` +
        'A src/lib/section-row-label.ts kapcsolat-ágát vissza kell venni: a kapcsolatiForras() ' +
        'megfelelő ágát és a kapcsolatiUresLista() típusát törölni, a tájékoztató és a ' +
        '„Megnézem” link ott is a többi oldal szövegét adja. Utána ezt az esetet is frissítsd.',
    ).toBe(true)
  })

  it('a tájékoztató pontosan ezekre a típusokra mondja, hogy ott nem jelenik meg (vagy kép nélkül)', () => {
    const tipusok = ['testimonials', 'knowledge', 'courseCards', 'ctaBanner', 'freeSos', 'faq']
    const uresek = tipusok.filter((tipus) =>
      kapcsolatiUresLista({ blockType: tipus, cta: { url: '/kurzusok' } }, KAPCSOLAT_OLDAL_SLUG),
    )
    expect(uresek).toEqual(['testimonials', 'knowledge', 'courseCards', 'ctaBanner'])
    expect(sectionSource({ blockType: 'freeSos' }, KAPCSOLAT_OLDAL_SLUG)?.szoveg).toContain(
      'Ez az oldal nem tölti be a kurzusokat',
    )
  })
})

describe('a „Megnézem” horgonya: a piszkozat-előnézet minden route-ja kiteszi a szalagot', () => {
  it.each([
    ['app/(frontend)/kapcsolat/page.tsx', 'RenderBlocks'],
    ['app/(frontend)/[slug]/page.tsx', 'RenderBlocks'],
    ['components/content/HomeView.tsx', 'RenderBlocks'],
  ] as const)('%s: a %s megkapja a szerkesztői réteget', (utvonal, komponens) => {
    expect(jsxHivas(forras(utvonal), komponens)).toContain('szerkesztes={szerkesztes}')
  })

  it('a RenderBlocks minden szekció (a rejtett) előtt is kiteszi a szalagot', () => {
    const kod = forras('components/blocks/RenderBlocks.tsx')
    expect(kod).toContain('const szalag = szekcioSzalagja(szerkesztes, block.id)')
    expect(kod).toContain('return szalag ? <SzerkesztoSzalag key={key} szalag={szalag} /> : null')
    expect(kod).toMatch(
      /<SzerkesztoSzalag arlistaNemIsmerheto=\{arlista === null\} szalag=\{szalag\} \/>\s*\{tartalom\}/,
    )
  })
})

describe('kódhoz kötött ugrópontok (H48): a lista egy helyen, a hivatkozó sorokhoz kötve', () => {
  const [rendeloi, idopont] = KOTOTT_UGROPONTOK

  it('két kötött ugrópont van, oldalanként egyedi', () => {
    expect(KOTOTT_UGROPONTOK.map((elem) => `${elem.oldal}#${elem.ugropont}`)).toEqual([
      'szolgaltatasok#rendeloi',
      'kapcsolat#idopontkeres',
    ])
  })

  it('„rendeloi”: a menü „Rendelői kezelések” pontja a Szolgáltatások ugrópontjára visz', () => {
    expect(rendeloi?.oldal).toBe(SERVICES_PAGE_SLUG)
    expect(rendeloi?.ugropont).toBe(CLINIC_TREATMENTS_ANCHOR)
    const menupont = buildNavigationMenuPlan()
      .flatMap((pont) => [pont, ...pont.children])
      .find((pont) => pont.label === 'Rendelői kezelések')
    expect(menupont?.url).toBe(CLINIC_TREATMENTS_PATH)
    expect(CLINIC_TREATMENTS_PATH).toBe(`${SERVICES_PAGE_PATH}#${CLINIC_TREATMENTS_ANCHOR}`)
    expect(rendeloi?.mi).toContain(`a menü „${String(menupont?.label)}” pontja`)
  })

  it('„rendeloi”: pontosan két régi webcím irányít ide (a mondat „két régi webcím”)', () => {
    const cel = `${SERVICES_PAGE_PATH}#${CLINIC_TREATMENTS_ANCHOR}`
    expect(SERVICES_RENDELOI_ANCHOR).toBe(cel)
    const forrasok = LEGACY_REDIRECTS.filter((szabaly) => szabaly.destination === cel).map(
      (szabaly) => szabaly.source,
    )
    expect(forrasok).toEqual(['/rendeloi-kezelesek', '/rendeloi-kezelesek-regi'])
    expect(rendeloi?.mi).toContain('két régi webcím átirányítása')
  })

  it('„rendeloi”: a szabad szöveg árkártyái ehhez a névhez kötöttek (RenderBlocks.tsx)', () => {
    const kod = forras('components/blocks/RenderBlocks.tsx')
    expect(kod).toContain('sectionProps(block).id !== CLINIC_TREATMENTS_ANCHOR')
    expect(kod).toContain('if (id === CLINIC_TREATMENTS_ANCHOR) {')
  })

  it('„idopontkeres”: a blogbejegyzések végi időpontkérő gomb célja (PostCourseCta.tsx)', () => {
    const kod = forras('components/content/PostCourseCta.tsx')
    expect(kod).toContain(
      `export const APPOINTMENT_HREF = '/${String(idopont?.oldal)}#${String(idopont?.ugropont)}'`,
    )
    // A gomb felirata a szótárból jön, a mondat ugyanazt idézi (SC 3.2.4).
    expect(
      kod.match(
        /href=\{APPOINTMENT_HREF\}>?\s*(?:>\s*)?\{ctaLabel\('appointment-request-link'\)\}/g,
      ),
    ).toHaveLength(2)
    expect(idopont?.mi).toBe(
      `a blogbejegyzések végén álló „${ctaLabel('appointment-request-link')}” gomb`,
    )
    // A cikk végi ajánló minden blogbejegyzés alatt áll (PostArticle.tsx).
    expect(forras('components/content/PostArticle.tsx')).toContain('<PostCourseCta')
  })
})

describe('Vélemények (H43): a mondat a lekérdezés és a komponens szabálya', () => {
  const velemeny = (id: number, extra: Partial<Testimonial> = {}): Testimonial =>
    ({
      id,
      quote: `Teljes szöveg ${String(id)}.`,
      shortQuote: null,
      authorName: `Szerző ${String(id)}`,
      featured: true,
      visible: true,
      order: id,
      updatedAt: '',
      createdAt: '',
      ...extra,
    }) as unknown as Testimonial

  it('a lekérdezés a Látható és Kiemelt véleményeket adja, Sorrend szerint, legfeljebb hármat (cms.ts)', () => {
    const kod = forras('lib/cms.ts')
    const eleje = kod.indexOf('export async function getTestimonials(limit = 3)')
    expect(eleje).toBeGreaterThan(-1)
    const fuggveny = kod.slice(eleje, kod.indexOf('\n}\n', eleje))
    expect(fuggveny).toContain('where: { visible: { equals: true }, featured: { equals: true } }')
    expect(fuggveny).toContain("sort: 'order'")
  })

  it('a szekció a Sorrend szerinti első legfeljebb hármat mutatja, a blokk ennél kevesebbet kérhet', () => {
    const lista = [
      velemeny(4),
      velemeny(1),
      velemeny(3),
      velemeny(2),
      velemeny(5, { featured: false }),
    ]
    expect(featuredTestimonials(lista).map((v) => v.id)).toEqual([1, 2, 3])
    expect(featuredTestimonials(lista, 2).map((v) => v.id)).toEqual([1, 2])
    expect(featuredTestimonials(lista, 9)).toHaveLength(3)
    expect(featuredTestimonials([velemeny(1, { visible: false })])).toEqual([])
  })

  it('kitöltött rövid idézetnél az látszik, különben a teljes szöveg', () => {
    expect(testimonialQuoteText(velemeny(1, { shortQuote: 'Rövid.' }))).toBe('Rövid.')
    expect(testimonialQuoteText(velemeny(1, { shortQuote: '   ' }))).toBe('Teljes szöveg 1.')
  })
})

describe('SOS-sáv (H30): a mondat a FreeSos.tsx tartalékláncát mondja', () => {
  it('a felvezető sor a kurzus címe, üresen a belső azonosító; üres Szövegnél a rövid leírás', () => {
    const kod = forras('components/content/home/FreeSos.tsx')
    expect(kod).toContain("freeProduct.displayTitle?.trim() || freeProduct.sku?.trim() || ''")
    expect(kod).toMatch(/body\?\.trim\(\) \|\|\s*freeProduct\.shortDescription\?\.trim\(\) \|\|/)
    expect(kod).toContain("'Ismerd meg a kurzusainkat, és válaszd ki a neked megfelelőt.'")
  })

  it('a Kurzusok-link szűrője ugyanaz a webcím, amelyet a lap az SOS-kurzusnak elfogad', () => {
    const sos = {
      slug: SOS_KURZUS_SLUG,
      status: 'published',
      priceInHUFEnabled: false,
    } as unknown as Product
    expect(isStorefrontFreeSos(sos)).toBe(true)
    expect(isStorefrontFreeSos({ ...sos, slug: 'mas-kurzus' } as Product)).toBe(false)
  })

  it('a mezőcímkék, amelyeket a mondat idéz, a Kurzusok valódi címkéi (ecommerce.ts)', () => {
    const kod = forras('plugins/ecommerce.ts')
    for (const [nev, cimke] of [
      ['displayTitle', 'Kurzus címe'],
      ['sku', 'Belső azonosító'],
      ['shortDescription', 'Rövid leírás'],
    ] as const) {
      expect(kod, nev).toMatch(new RegExp(`name: '${nev}',[\\s\\S]{0,80}?label: '${cimke}'`))
      expect(sectionSource({ blockType: 'freeSos' }, 'kezdolap')?.szoveg, nev).toContain(
        `„${cimke}”`,
      )
    }
  })
})
