import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { RenderBlocks } from '../components/blocks/RenderBlocks'
import {
  DEFAULT_HEADING as PRESS_DEFAULT_HEADING,
  PressLogos,
} from '../components/blocks/PressLogos'
import { CourseCards, usesFeaturedCard } from '../components/content/home/CourseCards'
import { HowItWorks, type HowItWorksProps } from '../components/content/home/HowItWorks'
import { DEFAULT_CTA_LABEL, ProductCard } from '../components/content/ProductCard'
import { buildHomeLayout } from '../lib/home-seed'
import type { BlockPressLogos, Page, Product } from '../payload-types'

/**
 * Kezdőlap-szekciók redesignja (tulajdonosi visszajelzések, 2026-08-16) —
 * fókuszált tesztek, DB nélkül.
 *
 * Öt szerződést rögzítenek:
 *  1. KURZUSKÁRTYA: egyetlen fizetős kurzusnál kiemelt, VÍZSZINTES kártya áll a
 *     rács helyett; kettőtől marad a rács. A kártya TARTALMA és az
 *     akadálymentességi mintája (egész kártya link, dekoratív CTA) egyik
 *     változatban sem különbözik.
 *  2. „ÍGY MŰKÖDIK": a szekció aszimmetrikus két hasábra nyílik (cím + lépések),
 *     a lista-szemantika és a CMS-felülírás változatlan.
 *  3. ÜDVÖZLŐ SZEKCIÓ: a két hasáb azonos magasságú, az elválasztó vonal végig
 *     fut (stíluslap-őr, mert ezt egy későbbi szerkesztés csendben elronthatja).
 *  4. SAJTÓ-LOGÓSOR: a beépített felirat az új szöveg, a CMS-érték felülírja, és
 *     a logók mérete a nagyobb lépcsőn áll.
 *  5. SEED-SZÖVEGEK: a záró CTA-sávnak és a három állapot szekciónak van
 *     tartalmas alapszövege — és mindkettő CMS-ből felülírható marad.
 *
 * A stíluslap-őrök a teamMembers/accordion tesztek mintáját követik: fájlszinten
 * olvasnak, és pontosan azt a szabályt rögzítik, amelyre a döntés épült.
 */

// ---------------------------------------------------------------------------
// Fixture-ök
// ---------------------------------------------------------------------------

type Layout = NonNullable<Page['layout']>

function render(node: ReactNode): string {
  return renderToStaticMarkup(createElement(Fragment, null, node))
}

/** Látható szöveg a renderelt HTML-ből (attribútumok nélkül, összevont szóközzel). */
function visibleText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function product(overrides: Partial<Product> & { id: number }): Product {
  return {
    sku: `Kurzus ${overrides.id}`,
    shortDescription: 'Otthon végezhető program.',
    coverImage: {
      id: 1,
      alt: 'Borítókép leírása',
      url: '/media/borito.webp',
      width: 1280,
      height: 720,
      sizes: { md: { url: '/media/borito-md.webp', width: 1280, height: 720 } },
    },
    cardHighlights: [
      { id: 'h1', text: '4 modulnyi videóanyag' },
      { id: 'h2', text: '50+ videós gyakorlat' },
    ],
    accessDurationDays: 365,
    audience: 'laikus',
    priceInHUF: 19990,
    priceInHUFEnabled: true,
    status: 'published',
    updatedAt: '',
    createdAt: '',
    ...overrides,
  } as unknown as Product
}

function css(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
}

/** Egy szabály-blokk törzse a stíluslapból (az első illeszkedő szelektortól). */
function ruleBody(source: string, selector: string): string {
  const start = source.indexOf(selector)
  expect(start, `nincs ilyen szabály a stíluslapban: ${selector}`).toBeGreaterThanOrEqual(0)
  const open = source.indexOf('{', start)
  const close = source.indexOf('}', open)
  return source.slice(open + 1, close)
}

// ---------------------------------------------------------------------------
// 1. Kurzus-szekció: kiemelt, vízszintes kártya egyetlen kurzusnál
// ---------------------------------------------------------------------------

describe('CourseCards — kiemelt (vízszintes) kártya egyetlen fizetős kurzusnál', () => {
  it('usesFeaturedCard: PONTOSAN egy kurzusnál igaz, nullánál és kettőtől hamis', () => {
    expect(usesFeaturedCard(0)).toBe(false)
    expect(usesFeaturedCard(1)).toBe(true)
    expect(usesFeaturedCard(2)).toBe(false)
    expect(usesFeaturedCard(3)).toBe(false)
  })

  it('egy kurzus: a rács helyett a kiemelt burkoló és a vízszintes kártya renderel', () => {
    const html = render(createElement(CourseCards, { products: [product({ id: 1 })] }))
    expect(html).toContain('kc-course-cards__featured')
    expect(html).toContain('kc-product-card--featured')
    // A magányos hasábot adó rács ilyenkor NEM jelenik meg.
    expect(html).not.toContain('kc-card-grid--courses')
  })

  it('két kurzus: marad a rács, kiemelt kártya nincs (az összehasonlíthatóság a fontosabb)', () => {
    const html = render(
      createElement(CourseCards, { products: [product({ id: 1 }), product({ id: 2 })] }),
    )
    expect(html).toContain('kc-card-grid--courses')
    expect(html).not.toContain('kc-product-card--featured')
    expect(html).not.toContain('kc-course-cards__featured')
  })

  it('a kiemelt kártya LÁTHATÓ SZÖVEGE bitre a rács-kártyáé (az elrendezés nem ír át tartalmat)', () => {
    const item = product({ id: 1, sku: 'Otthoni KézRehab Program' })
    const gridCard = render(createElement(ProductCard, { product: item }))
    const featuredCard = render(createElement(ProductCard, { featured: true, product: item }))
    expect(visibleText(featuredCard)).toBe(visibleText(gridCard))
    // A mini-buybox minden eleme ott van a kiemelt változatban is.
    for (const marker of [
      'Otthoni KézRehab Program',
      '4 modulnyi videóanyag',
      '50+ videós gyakorlat',
      'Otthoni gyakorlóknak',
      '365 napos hozzáférés',
      DEFAULT_CTA_LABEL,
    ]) {
      expect(visibleText(featuredCard)).toContain(marker)
    }
    expect(visibleText(featuredCard).replace(/ /g, ' ')).toContain('19 990 Ft')
  })

  it('a kiemelt kártya akadálymentességi mintája változatlan: egész kártya link, dekoratív CTA', () => {
    const html = render(
      createElement(CourseCards, { products: [product({ id: 1, slug: 'kezrehab' })] }),
    )
    // Pontosan EGY hivatkozás vezet a kurzusra (a CTA nem beágyazott link/gomb).
    expect(html.match(/href="\/kurzusok\/kezrehab"/g) ?? []).toHaveLength(1)
    const cardStart = html.indexOf('kc-product-card__link')
    const card = html.slice(cardStart, html.indexOf('</article>'))
    expect(card).not.toContain('<button')
    expect(html).toContain('aria-hidden="true" class="kc-product-card__cta"')
  })

  it('a CMS-mezők a kiemelt változatban is felülírják az alapértékeket', () => {
    const html = render(
      createElement(CourseCards, {
        ctaLabel: 'Ezt kérem',
        eyebrow: 'Saját felvezető',
        heading: 'Saját cím',
        lead: 'Saját bevezető.',
        products: [product({ id: 1 })],
      }),
    )
    expect(html).toContain('Saját felvezető')
    expect(html).toContain('Saját cím')
    expect(html).toContain('Saját bevezető.')
    expect(html).toContain('Ezt kérem')
    expect(html).not.toContain(DEFAULT_CTA_LABEL)
  })

  it('stíluslap-őr: a vízszintes elrendezés 900px felett él, és NEM ír fontméretet', () => {
    const source = css('../app/(frontend)/styles/blocks/course-cards.css')
    const featuredStart = source.indexOf('.kc-course-cards__featured {')
    const linkRule = source.indexOf('.kc-product-card--featured .kc-product-card__link {')
    expect(featuredStart).toBeGreaterThanOrEqual(0)
    expect(linkRule).toBeGreaterThan(featuredStart)
    // A vízszintes elrendezés CSAK 900px felett kapcsol be (mobilon a megszokott
    // függőleges kártya áll) — a médialekérdezés a szabály ELŐTT nyílik.
    const mediaOpen = source.indexOf('@media (min-width: 900px)', featuredStart)
    expect(mediaOpen).toBeGreaterThan(featuredStart)
    expect(mediaOpen).toBeLessThan(linkRule)
    expect(source).toContain('grid-template-columns: minmax(0, 5fr) minmax(0, 7fr)')
    // Borító nélküli kurzusnál nem marad üres hasáb.
    expect(source).toContain(':not(:has(> .kc-product-card__cover))')

    // FORRÁS-SORREND: a felülírandó alap-szabályok azonos specificitásúak
    // (0,2,0), a médialekérdezés pedig nem növeli a specificitást — ha a
    // kiemelt blokk feljebb csúszna, az alapok némán visszavennék a vízszintes
    // elrendezést (borító-ív, láb-irány, gomb-belsőmargó).
    for (const alapSzabaly of [
      '.kc-product-card .kc-product-card__cover {',
      '.kc-product-card .kc-product-card__foot {',
      '.kc-product-card .kc-product-card__pricing {',
      '.kc-product-card .kc-product-card__cta {',
    ]) {
      expect(source.indexOf(alapSzabaly), alapSzabaly).toBeLessThan(featuredStart)
    }

    // A tipográfia a közös kártya-szabályokból öröklődik: a kiemelt változat
    // EGYETLEN saját fontméretet sem vezet be (közös tipográfiai skála,
    // UX-skill 4. pont).
    const featuredRules = Array.from(source.matchAll(/([^{}]+)\{([^{}]*)\}/g)).filter(
      ([, selector]) => selector.includes('featured'),
    )
    expect(featuredRules.length).toBeGreaterThan(3)
    for (const [, selector, body] of featuredRules) {
      expect(body, `fontméret a kiemelt kártyán: ${selector.trim()}`).not.toMatch(/font-size/)
    }
  })
})

// ---------------------------------------------------------------------------
// 2. „Így működik az online kurzus" — aszimmetrikus két hasáb
// ---------------------------------------------------------------------------

describe('HowItWorks — finom, aszimmetrikus rács', () => {
  it('a szekció cím-hasábra és lépés-hasábra bomlik, a lista-szemantika megmarad', () => {
    const html = render(createElement(HowItWorks))
    expect(html).toContain('kc-how__grid')
    expect(html).toContain('kc-how__head')
    // A sorrendet továbbra is a rendezett lista hordozza, a sorszám dekoratív.
    expect(html).toContain('<ol class="kc-how__list">')
    expect(html).toContain('aria-hidden="true" class="kc-how__num"')
    expect(html.match(/<li class="kc-how__row">/g) ?? []).toHaveLength(3)
  })

  it('a CMS-cím és a CMS-lépések felülírják a beépítetteket', () => {
    // A HowItWorks propja opcionális (alapértelmezett `{}`), ezért a props
    // objektumot külön, típusosan adjuk át — így a createElement a helyes
    // túlterhelést választja.
    const props: HowItWorksProps = {
      steps: [{ title: 'Saját lépés', text: 'Saját lépésszöveg.' }],
      title: 'Saját szekciócím',
    }
    const html = render(createElement<HowItWorksProps>(HowItWorks, props))
    expect(html).toContain('Saját szekciócím')
    expect(html).toContain('Saját lépés')
    expect(html).toContain('Saját lépésszöveg.')
    expect(html).not.toContain('Így működik az online kurzus')
    expect(html).not.toContain('Kiválasztod a kurzust')
    expect(html.match(/<li class="kc-how__row">/g) ?? []).toHaveLength(1)
  })

  it('stíluslap-őr: 900px felett cím + lépések hasáb, a cím a görgetés alatt a helyén marad', () => {
    const source = css('../app/(frontend)/styles/blocks/how-it-works.css')
    expect(source).toContain('grid-template-columns: minmax(0, 4fr) minmax(0, 7fr)')
    const head = ruleBody(source, '.kc-how__head {')
    expect(head).toContain('position: sticky')
    // A sticky cím a lebegő fejléc ALÁ igazít (base.css scroll-padding-top
    // ugyanezzel a tokennel számol) — enélkül a fejléc takarná.
    expect(head).toContain('var(--kc-header-height)')
    // A ragadós elem csak teljes magasságú rács-cellában tud elmozdulni: a
    // hasáb-nyújtást sem a cellán, sem a rácson nem szabad kikapcsolni.
    expect(head).toContain('align-self: stretch')
    expect(ruleBody(source, '.kc-how__grid {')).not.toContain('align-items: start')
  })
})

// ---------------------------------------------------------------------------
// 3. Üdvözlő szekció — azonos magasságú hasábok
// ---------------------------------------------------------------------------

describe('welcome.css — a két hasáb azonos magasságú és kiegyensúlyozott', () => {
  const source = css('../app/(frontend)/styles/blocks/welcome.css')

  it('a rács hasábjai NYÚLNAK (nem a saját tartalmuk magasságáig érnek)', () => {
    // Az alapértelmezett `align-items: start` a rövidebb hasábot félmagasságban
    // hagyta, az elválasztó vonal pedig „levágva" állt meg.
    expect(source).toContain('align-items: stretch')
  })

  it('a felsorolás tételei arányosan osztják el a közös magasságot, a lista alját vonal zárja', () => {
    expect(source).toContain('flex: 1 1 0')
    expect(source).toMatch(/\.kc-welcome__checklist-item:last-child\s*\{[^}]*border-bottom/)
  })

  it('az összefoglaló hasáb szövege függőlegesen középre zár a teljes magasságú vonal mellett', () => {
    const side = source.slice(source.lastIndexOf('.kc-welcome__side {'))
    expect(side).toContain('justify-content: center')
    expect(side).toContain('border-left: 1px solid var(--kc-welcome-accent)')
  })

  it('a pipa-korong a középre zárt tétel közepén ül (a felülírás az alap-szabály UTÁN áll)', () => {
    // A médialekérdezés nem növeli a specificitást: ha a felülírás a
    // `::before` alap-deklarációja ELÉ kerülne, a `top: 1.05rem` nyerne.
    const alap = source.indexOf('.kc-welcome__checklist-item::before {')
    const felulir = source.lastIndexOf('.kc-welcome__checklist-item::before {')
    expect(felulir).toBeGreaterThan(alap)
    expect(source.slice(felulir)).toContain('transform: translateY(-50%)')
  })
})

// ---------------------------------------------------------------------------
// 4. Sajtó-logósor — új felirat, nagyobb logók
// ---------------------------------------------------------------------------

describe('PressLogos — felirat és logóméret', () => {
  const block = (overrides: Record<string, unknown> = {}): BlockPressLogos =>
    ({
      blockType: 'pressLogos',
      id: 'press1',
      logos: [
        {
          id: 'l1',
          image: { url: '/media/logo.png', alt: 'Példa Magazin logó', width: 160, height: 60 },
        },
      ],
      sectionSettings: {},
      ...overrides,
    }) as unknown as BlockPressLogos

  it('a beépített felirat az új, jóváhagyott szöveg', () => {
    expect(PRESS_DEFAULT_HEADING).toBe('Itt találkozhattál velünk')
    const html = render(createElement(PressLogos, { block: block() }))
    expect(html).toContain('Itt találkozhattál velünk')
    expect(html).not.toContain('Ismerhetsz minket innen')
  })

  it('a CMS-felirat felülírja a beépítettet, és megnevezi a szekció landmarkját', () => {
    const html = render(createElement(PressLogos, { block: block({ heading: 'Saját felirat' }) }))
    expect(html).toContain('Saját felirat')
    expect(html).not.toContain(PRESS_DEFAULT_HEADING)
    expect(html).toContain('aria-labelledby="press-felirat-press1"')
    expect(html).toContain('id="press-felirat-press1"')
  })

  it('logó nélkül a szekció NEM renderel (felirat sem marad árván)', () => {
    expect(render(createElement(PressLogos, { block: block({ logos: [] }) }))).toBe('')
  })

  it('a RenderBlocks switchen át is a beépített felirat jön az üres mezőre', () => {
    const html = render(
      createElement(RenderBlocks, {
        layout: [block({ heading: '   ' })] as unknown as Layout,
        posts: [],
        products: [],
        testimonials: [],
      }),
    )
    expect(html).toContain(PRESS_DEFAULT_HEADING)
  })

  it('stíluslap-őr: a logók a NAGYOBB lépcsőn állnak, és mobilon sem csordulnak túl', () => {
    const source = css('../app/(frontend)/styles/blocks/press-logos.css')
    const img = ruleBody(source, '.kc-press__row img {')
    expect(img).toContain('height: clamp(2.1rem, 3.6vw, 3.4rem)')
    // A korábbi, apró lépcső nem szivároghat vissza.
    expect(img).not.toContain('clamp(1.7rem, 2.6vw, 2.5rem)')
    // Reflow-védelem: a széles logó 320px-en sem lóg ki, és nem torzul.
    expect(img).toContain('max-width: 100%')
    expect(img).toContain('object-fit: contain')
  })
})

// ---------------------------------------------------------------------------
// 5. Kezdőlap-seed — a hiányzó szövegek pótlása
// ---------------------------------------------------------------------------

describe('buildHomeLayout — a záró CTA-sáv és a három állapot szövege', () => {
  const layout = buildHomeLayout()

  /** Az adott típusú blokk a seed-layoutból (a szerződés szerint pontosan egy). */
  function blockOf<T extends string>(blockType: T) {
    const found = layout.filter((block) => block.blockType === blockType)
    expect(found, `hiányzó blokk a seed-layoutból: ${blockType}`).toHaveLength(1)
    return found[0] as Extract<Layout[number], { blockType: T }>
  }

  it('a lapot a „Kezdd el még ma" CTA-sáv zárja, tartalmas szöveggel és belső CTA-val', () => {
    const cta = blockOf('ctaBanner')
    expect(layout[layout.length - 1]?.blockType).toBe('ctaBanner')
    expect(cta.title).toBe('Kezdd el még ma')
    const text = cta.text ?? ''
    // Tartalmas, de rövid: 1–2 mondat.
    expect(text.length).toBeGreaterThan(80)
    expect((text.match(/[.!?]/g) ?? []).length).toBeLessThanOrEqual(2)
    // A gomb a fizetős irányba, belső útvonalra mutat (UX-skill 1. pont).
    expect(cta.cta?.url).toBe('/kurzusok')
    expect(cta.cta?.felirat?.length ?? 0).toBeGreaterThan(0)
    expect(cta.cta?.ujAblakban).toBe(false)
  })

  it('a záró sáv szövege nem sürget és nem ígér gyógyulást (UX-skill 6. pont)', () => {
    const text = (blockOf('ctaBanner').text ?? '').toLowerCase()
    for (const tiltott of ['most azonnal', 'utolsó', 'csak ma', 'garantált gyógyulás', 'akció']) {
      expect(text).not.toContain(tiltott)
    }
  })

  it('a három állapot szekciónak van magyarázó bevezetője', () => {
    const states = blockOf('states')
    const lead = states.lead ?? ''
    expect(lead.length).toBeGreaterThan(60)
    // A bevezető a TERÁPIA ívéről szól — így a szekció akkor is érthető, ha a
    // szerkesztő a címet átírja.
    expect(lead.toLowerCase()).toContain('terápia')
  })

  it('a nyitott állapot igéje dolgozhatsz, nem a nem létező munkázhatsz', () => {
    const states = blockOf('states')
    const nyitott = (states.cards ?? []).find((kartya) => kartya.title === 'Nyitott')
    const szoveg = nyitott?.text ?? ''
    expect(szoveg).toContain('Újra dolgozhatsz')
    expect(szoveg.toLowerCase()).not.toContain('munkáz')
  })

  it('a sajtó-logósor alapértéke a komponens beépített feliratával egyezik', () => {
    expect(blockOf('pressLogos').heading).toBe(PRESS_DEFAULT_HEADING)
  })

  it('a seed-szövegek CMS-ből felülírhatók maradnak (a renderelő a blokk értékét viszi)', () => {
    const html = render(
      createElement(RenderBlocks, {
        layout: [
          {
            blockType: 'ctaBanner',
            id: 'c1',
            title: 'Saját záró cím',
            text: 'Saját záró szöveg.',
            cta: { felirat: 'Saját gomb', url: '/kurzusok' },
            sectionSettings: {},
          },
          {
            blockType: 'states',
            id: 's1',
            title: 'Saját állapot-cím',
            lead: 'Saját állapot-bevezető.',
            cards: [{ id: 'k1', title: 'Zárt', text: 'Rövid szöveg.' }],
            sectionSettings: {},
          },
        ] as unknown as Layout,
        posts: [],
        products: [],
        testimonials: [],
      }),
    )
    expect(html).toContain('Saját záró cím')
    expect(html).toContain('Saját záró szöveg.')
    expect(html).toContain('Saját gomb')
    expect(html).toContain('Saját állapot-cím')
    expect(html).toContain('Saját állapot-bevezető.')
    // A seed alapértékei egyik szekcióban sem szivárognak be felülíráskor.
    expect(html).not.toContain('Kezdd el még ma')
    expect(html).not.toContain('Három állapot, egy folyamat')
  })
})
