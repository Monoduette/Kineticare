import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { HowItWorks, type HowItWorksProps } from '../components/content/home/HowItWorks'
import { ProductCard } from '../components/content/ProductCard'
import { CourseCard } from '../components/courses/CourseCard'
import { Accordion } from '../components/blocks/Accordion'
import { buildHomeLayout } from '../lib/home-seed'
import {
  COURSE_SHORT_DESCRIPTION_FIXED,
  COURSE_SHORT_DESCRIPTION_LEFTOVER,
  HOW_IT_WORKS_STEP1_FIXED,
  HOW_IT_WORKS_STEP1_LEFTOVER,
  ROLUNK_ACCORDION_LEFTOVERS,
  ROLUNK_SZEKCIO_LEFTOVERS,
  rewriteVisitorDashLeftover,
} from '../lib/gondolatjel-leftover'
import { courseJsonLd, productSeoDoc } from '../lib/seo'
import type { BlockAccordion, Page, Product } from '../payload-types'
import { buildRolunkLayout, buildSzolgaltatasokLayout } from '../scripts/restore-legacy-content'

/**
 * Élő kezdőlap gondolatjel-maradék (mért 2026-09-06). A seed már vesszős;
 * a CMS-t a seed nem írja felül. A látogatói felület a két pontos egyezést
 * vesszőre cseréli; más szöveget nem.
 */

function render(node: ReactNode): string {
  return renderToStaticMarkup(createElement(Fragment, null, node))
}

function product(shortDescription: string): Product {
  return {
    id: 7,
    slug: 'otthoni-kezrehab-program',
    sku: 'Otthoni KézRehab Program',
    displayTitle: 'Otthoni KézRehab Program',
    shortDescription,
    category: 1,
    cardHighlights: [{ id: 'a', text: '50+ videós gyakorlat' }],
    coverImage: {
      id: 3,
      alt: 'Borító',
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
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('rewriteVisitorDashLeftover — a két élő maradék', () => {
  it('a how-it-works leftover U+2014, a kurzus-lead leftover U+2013', () => {
    expect(HOW_IT_WORKS_STEP1_LEFTOVER).toContain('\u2014')
    expect(HOW_IT_WORKS_STEP1_LEFTOVER).not.toContain('\u2013')
    expect(COURSE_SHORT_DESCRIPTION_LEFTOVER).toContain('\u2013')
    expect(COURSE_SHORT_DESCRIPTION_LEFTOVER).not.toContain('\u2014')
  })

  it('a javított mondatokban nincs töltelék gondolatjel, a csukló- kiskötőjel megmarad', () => {
    expect(HOW_IT_WORKS_STEP1_FIXED).not.toMatch(/[–—]/)
    expect(COURSE_SHORT_DESCRIPTION_FIXED).not.toMatch(/[–—]/)
    expect(COURSE_SHORT_DESCRIPTION_FIXED).toContain('csukló-, ujj-')
    expect(rewriteVisitorDashLeftover(HOW_IT_WORKS_STEP1_LEFTOVER)).toBe(HOW_IT_WORKS_STEP1_FIXED)
    expect(rewriteVisitorDashLeftover(COURSE_SHORT_DESCRIPTION_LEFTOVER)).toBe(
      COURSE_SHORT_DESCRIPTION_FIXED,
    )
  })

  it('más mondatot, hyphenes szóösszetételt és a már javított szöveget nem nyúlja', () => {
    expect(rewriteVisitorDashLeftover(HOW_IT_WORKS_STEP1_FIXED)).toBe(HOW_IT_WORKS_STEP1_FIXED)
    expect(rewriteVisitorDashLeftover(COURSE_SHORT_DESCRIPTION_FIXED)).toBe(
      COURSE_SHORT_DESCRIPTION_FIXED,
    )
    expect(rewriteVisitorDashLeftover('csukló-, ujj-, alkar- és könyökfájdalmakra')).toBe(
      'csukló-, ujj-, alkar- és könyökfájdalmakra',
    )
    expect(rewriteVisitorDashLeftover(` ${HOW_IT_WORKS_STEP1_LEFTOVER}`)).toBe(
      ` ${HOW_IT_WORKS_STEP1_LEFTOVER}`,
    )
  })
})

describe('HowItWorks — CMS leftover em dash', () => {
  it('a beépített lépés már a vesszős mondat', () => {
    const html = render(createElement(HowItWorks))
    expect(html).toContain(HOW_IT_WORKS_STEP1_FIXED)
    expect(html).not.toContain('\u2014')
  })

  it('a production CMS-mondatot vesszőre cseréli, a többi lépést nem', () => {
    const props: HowItWorksProps = {
      steps: [
        { title: 'Kiválasztod a kurzust', text: HOW_IT_WORKS_STEP1_LEFTOVER },
        { title: 'Azonnal hozzáférsz', text: 'A videós anyagokat a fiókodban éred el.' },
      ],
    }
    const html = render(createElement<HowItWorksProps>(HowItWorks, props))
    expect(html).toContain(HOW_IT_WORKS_STEP1_FIXED)
    expect(html).not.toContain('\u2014')
    expect(html).toContain('A videós anyagokat a fiókodban éred el.')
  })
})

describe('kurzuskártya lead — CMS leftover en dash', () => {
  it('a kezdőlapi kártyán vesszőre cseréli, a csukló- kötőjelet meghagyja', () => {
    const html = render(
      createElement(ProductCard, { product: product(COURSE_SHORT_DESCRIPTION_LEFTOVER) }),
    )
    expect(html).toContain(COURSE_SHORT_DESCRIPTION_FIXED)
    expect(html).not.toContain('\u2013')
    expect(html).toContain('csukló-, ujj-')
  })

  it('a /kurzusok listakártyán ugyanazt a mondatot cseréli', () => {
    const html = render(
      createElement(CourseCard, { product: product(COURSE_SHORT_DESCRIPTION_LEFTOVER) }),
    )
    expect(html).toContain(COURSE_SHORT_DESCRIPTION_FIXED)
    expect(html).not.toContain('\u2013')
  })

  it('más rövid leírást nem nyúl', () => {
    const html = render(
      createElement(ProductCard, { product: product('Otthon végezhető program.') }),
    )
    expect(html).toContain('Otthon végezhető program.')
  })
})

describe('seed és SEO a javított mondattal egyezik', () => {
  it('a home-seed howItWorks első lépése a vesszős mondat', () => {
    const how = buildHomeLayout().find((blokk) => blokk.blockType === 'howItWorks')
    const elso = how?.blockType === 'howItWorks' ? how.steps?.[0]?.text : null
    expect(elso).toBe(HOW_IT_WORKS_STEP1_FIXED)
  })

  it('a kurzus JSON-LD leírása a látható, vesszős mondatot viszi', () => {
    const doc = product(COURSE_SHORT_DESCRIPTION_LEFTOVER)
    expect(productSeoDoc(doc).excerpt).toBe(COURSE_SHORT_DESCRIPTION_FIXED)
    expect(
      courseJsonLd({
        product: doc,
        name: 'Otthoni KézRehab Program',
        path: '/kurzusok/otthoni-kezrehab-program',
        priceHuf: 79500,
      }).description,
    ).toBe(COURSE_SHORT_DESCRIPTION_FIXED)
  })
})

// ---------------------------------------------------------------------------
// /rolunk és /szolgaltatasok seed — töltelék gondolatjel nélkül (2026-09-07)
//
// A tulajdonos kikötése: natív magyar, gondolatjel-halmozás nélkül. A
// gondolatjel közbevetést jelöl (AkH. 12. kiadás 250–251.,
// https://helyesiras.mta.hu/helyesiras/default/akh12#F250); cím és alcím
// közé, felsorolás-elválasztónak nem való. Amit a söprés SZÁNDÉKOSAN nem
// érint: az idézetek (vélemény-szövegek és aláírásaik), a tulajdonnevek, az
// önéletrajz-tételek (tanfolyam – szervező bibliográfiai alak, 2021–2022
// évszám-tartomány: nagykötőjel, AkH. 263.). Ezért a söprés a vevői
// MIKROSZÖVEGEKET nézi: blokk-címek, bevezetők, sorcímek, statisztika-feliratok,
// a bemutatkozás bekezdései és a bevezető rich-text ELSŐ bekezdése.
// ---------------------------------------------------------------------------

type Layout = NonNullable<Page['layout']>

/** A szekciósor vevői mikroszövegei (idézet és önéletrajz-tétel nélkül). */
function mikroszovegek(layout: Layout): string[] {
  const ki: string[] = []
  const add = (...values: unknown[]) => {
    for (const value of values) if (typeof value === 'string') ki.push(value)
  }
  for (const block of layout) {
    const b = block as unknown as Record<string, unknown>
    add(b.eyebrow, b.title, b.heading, b.lead, b.text, b.body, b.note, b.label, b.blockName)
    for (const key of ['items', 'rows', 'paragraphs', 'stats', 'members', 'cards']) {
      const rows = b[key]
      if (!Array.isArray(rows)) continue
      for (const row of rows) {
        const r = row as Record<string, unknown>
        add(r.cim, r.osszefoglalo, r.title, r.body, r.text, r.label, r.name, r.role, r.bio)
        add(r.felirat, r.question, r.answer, r.hivasFelirat)
      }
    }
    if (block.blockType === 'richText') {
      const first = block.content?.root?.children?.[0] as
        | { children?: { text?: unknown }[] }
        | undefined
      add(first?.children?.[0]?.text)
    }
    const feature = b.feature as Record<string, unknown> | undefined
    if (feature) add(feature.label, feature.note)
  }
  return ki
}

describe('/rolunk és /szolgaltatasok seed — a vevői mikroszövegekben nincs U+2013/U+2014', () => {
  it.each([
    ['rolunk', () => buildRolunkLayout({ kocsisPortre: 21, kissPortre: 22, partnerLogok: [1] })],
    ['szolgaltatasok', () => buildSzolgaltatasokLayout({ kocsisPortre: 21, kissPortre: 22 })],
  ])('%s', (_slug, build) => {
    const szovegek = mikroszovegek(build())
    expect(szovegek.length).toBeGreaterThan(20)
    const maradek = szovegek.filter((szoveg) => /[\u2013\u2014]/.test(szoveg))
    expect(maradek, maradek.join('\n')).toEqual([])
  })

  it('a régi /rolunk seed öt maradéka a javított alakra képződik, a javított alak fixpont', () => {
    for (const [regi, uj] of [...ROLUNK_ACCORDION_LEFTOVERS, ...ROLUNK_SZEKCIO_LEFTOVERS]) {
      expect(regi).toMatch(/[\u2013\u2014]/)
      expect(uj).not.toMatch(/[\u2013\u2014]/)
      expect(rewriteVisitorDashLeftover(regi)).toBe(uj)
      expect(rewriteVisitorDashLeftover(uj)).toBe(uj)
    }
    // A javított seed pontosan ezeket az alakokat teszi le (a fejléc-bevezető
    // a Pages.excerpt mező, nem a szekciósor: azt a forrásban ellenőrizzük),
    // a régi alak pedig sehol nincs már a seed-forrásban.
    const szovegek = new Set(mikroszovegek(buildRolunkLayout()))
    const forras = readFileSync(
      fileURLToPath(new URL('../scripts/restore-legacy-content.ts', import.meta.url)),
      'utf8',
    )
    for (const [regi, uj] of [...ROLUNK_ACCORDION_LEFTOVERS, ...ROLUNK_SZEKCIO_LEFTOVERS]) {
      expect(szovegek.has(uj) || forras.includes(uj), uj).toBe(true)
      expect(forras.includes(regi), `régi alak a seedben: ${regi}`).toBe(false)
    }
  })

  it('a harmonika a production CMS régi címét és bevezetőjét vesszőtlen alakra írja át', () => {
    const block = {
      id: 'cms',
      blockType: 'accordion',
      lead: ROLUNK_ACCORDION_LEFTOVERS[2][0],
      items: [
        {
          id: 'k',
          cim: ROLUNK_ACCORDION_LEFTOVERS[0][0],
          tartalom: {
            root: {
              type: 'root',
              children: [
                {
                  type: 'paragraph',
                  children: [{ type: 'text', text: 'Gyógytornász', version: 1 }],
                  version: 1,
                },
              ],
              direction: null,
              format: '',
              indent: 0,
              version: 1,
            },
          },
        },
      ],
      sectionSettings: {},
    } as unknown as BlockAccordion
    const html = render(createElement(Accordion, { block }))
    expect(html).toContain(ROLUNK_ACCORDION_LEFTOVERS[0][1])
    expect(html).toContain(ROLUNK_ACCORDION_LEFTOVERS[2][1])
    expect(html).not.toMatch(/[\u2013\u2014]/)
  })
})
