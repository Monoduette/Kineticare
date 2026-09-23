import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Field } from 'payload'

import { FREE_SOS_CTA_DESCRIPTIONS, freeSos } from '../blocks/free-sos'
import {
  FREE_SOS_STRIP_TITLE,
  FreeSos,
  resolveFreeSosCta,
} from '../components/content/home/FreeSos'
import { ctaLabel } from '../lib/cta-vocabulary'
import type { Product } from '../payload-types'

const freeProduct = {
  id: 2,
  slug: 'sos-kezrelax-villamkurzus',
  displayTitle: 'SOS Kézrelax',
  status: 'published',
  _status: 'published',
  priceInHUFEnabled: false,
} as Product

const photo = {
  url: '/media/owner-review-fixture.webp',
  width: 1200,
  height: 800,
  alt: 'Két gyógytornász a rendelőben',
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Hálózat tiltva a komponens-tesztben')
    }),
  )
})
afterEach(() => vi.unstubAllGlobals())

describe('P03: ingyenesség csak az ismert ingyenes kurzushoz', () => {
  it.each([
    '/kurzusok/sos-kezrelax-villamkurzus',
    '/kurzusok/sos-kezrelax-villamkurzus/',
    '/kurzusok/sos-kezrelax-villamkurzus?utm_source=teszt#igenyles',
    '/kurzusok/2',
  ])('ismert cél: %s', (href) => {
    expect(resolveFreeSosCta(freeProduct, { href, newTab: true })).toEqual({
      href,
      newTab: true,
      label: ctaLabel('free-course-claim'),
    })
  })

  it.each([
    '/kurzusok/fizetos',
    '/kurzusok/masik-ingyenes-kurzus',
    '/kurzusok/23',
    '/kurzusok/sos-kezrelax-masolat',
    '/kurzusok/sos-kezrelax/../fizetos',
    '/kurzusok/%73os-kezrelax',
  ])('nem bizonyított cél: %s', (href) => {
    const cta = resolveFreeSosCta(freeProduct, { href, newTab: true, label: 'Elindítom ingyen' })
    expect(cta).toEqual({
      href: '/kurzusok/sos-kezrelax-villamkurzus',
      newTab: false,
      label: ctaLabel('free-course-claim'),
    })
  })

  it('termék nélkül egy ismertnek hangzó URL sem bizonyíték', () => {
    expect(
      resolveFreeSosCta(null, { href: '/kurzusok/sos-kezrelax-villamkurzus', newTab: true }),
    ).toEqual({
      href: '/kurzusok',
      newTab: false,
      label: ctaLabel('course-list-open'),
    })
  })

  it.each([
    { priceInHUFEnabled: true, priceInHUF: 10000 },
    { priceInHUFEnabled: true, priceInHUF: null },
    { priceInHUFEnabled: undefined },
    { status: 'draft' as const },
    { _status: 'draft' as const },
    { _status: null },
    { _status: undefined },
    { slug: 'masik-ingyenes' },
    { slug: null },
  ])('a prop neve nem helyettesíti az ingyenes, publikált állapotot: %j', (overrides) => {
    const product = { ...freeProduct, ...overrides }
    expect(resolveFreeSosCta(product).label).not.toBe(ctaLabel('free-course-claim'))
    expect(resolveFreeSosCta(product, { href: '/kurzusok/sos-kezrelax-villamkurzus' })).toEqual({
      href: '/kurzusok',
      newTab: false,
      label: ctaLabel('course-list-open'),
    })
  })

  it.each([
    'javascript:alert(1)',
    '//example.invalid/kurzusok/sos-kezrelax',
    '/kurzusok/\\example.invalid',
    '/kurzusok/sos\n-kezrelax',
  ])('nem biztonságos felülírás helyett a bizonyított alapcél: %s', (href) => {
    expect(resolveFreeSosCta(freeProduct, { href }).href).toBe(
      '/kurzusok/sos-kezrelax-villamkurzus',
    )
  })
})

describe('WP26/P03: kompakt, kép nélküli sáv; ingyenes jelzés csak az ismert ingyenes kurzushoz', () => {
  it('az ingyenes sáv fizetős felülírás mellett is az ingyenes termékre visz', () => {
    const html = renderToStaticMarkup(
      createElement(FreeSos, { freeProduct, cta: { href: '/kurzusok/fizetos' } }),
    )
    expect(html).toContain(`>${FREE_SOS_STRIP_TITLE}</h2>`)
    expect(html).toContain('href="/kurzusok/sos-kezrelax-villamkurzus"')
    expect(html).not.toContain('/kurzusok/fizetos')
  })

  it.each([
    null,
    { ...freeProduct, status: 'draft' as const },
    { ...freeProduct, _status: 'draft' as const },
    { ...freeProduct, _status: null },
    { ...freeProduct, _status: undefined },
    { ...freeProduct, status: 'archived' as const },
    { ...freeProduct, priceInHUFEnabled: true, priceInHUF: 10000 },
    { ...freeProduct, priceInHUFEnabled: undefined },
    { ...freeProduct, slug: 'masik-ingyenes' },
    { ...freeProduct, slug: null },
  ])('elérhető ingyenes termék nélkül a teljes ajánlat semleges: %j', (product) => {
    for (const cmsCopy of [{}, { title: 'Ingyenes SOS', body: 'Indítsd el ingyen!' }]) {
      const html = renderToStaticMarkup(
        createElement(FreeSos, {
          freeProduct: product,
          ...cmsCopy,
          cta: { href: '/kurzusok/fizetos', label: 'Kérem ingyen', newTab: true },
          backgroundImage: photo,
        }),
      )
      expect(html).toContain('>Kurzusaink</h2>')
      expect(html).toContain('href="/kurzusok"')
      expect(html).toContain(ctaLabel('course-list-open'))
      expect(html).not.toMatch(/Ingyenes|ingyen!|Elindítom ingyen|SOS|Kérem ingyen/)
      expect(html).not.toContain('/kurzusok/fizetos')
      expect(html).not.toContain('target="_blank"')
      expect(html).not.toContain('kc-free-sos__kicker')
      expect(html).not.toContain('<img')
    }
  })

  /**
   * WP26 (tulajdonos, 2026-09-07): „‚Ingyenes villámkurzus’ nagyon rövid
   * leírással, benne a gomb ugyanúgy, és hogy ez ingyenes.” A kurzus neve a
   * felvezető sorban, a rács kártyájával azonos forrásból (WCAG 2.2 SC 3.2.4);
   * a szöveg a CMS-é; a gomb a §3.2 #4 szótári alak.
   *
   * 2026-09-22 (admin-audit K18): a sáv címe a CMS `title` mezője, mert a
   * kötelező, kitöltött, mégis hatástalan mező hamis sikert jelzett. Az
   * „Ingyenes villámkurzus” konstans ettől TARTALÉK: üres vagy csak szóköz
   * címnél áll. Az élő, gondolatjeles CMS-címet („SOS Kézrelax — ingyenes
   * villámkurzus”) az előtöltő szabály (src/scripts/sos-cim-kitoltes.ts) írja
   * a tulajdonos címére, így a lap látványa nem változik.
   */
  it.each([
    ['Saját SOS-cím', 'Saját SOS-cím'],
    ['  Ingyenes villámkurzus  ', 'Ingyenes villámkurzus'],
    ['\nPróbáld ki ingyen\t', 'Próbáld ki ingyen'],
  ])('a sáv címe a CMS-cím, trim után: %j', (title, vart) => {
    const html = renderToStaticMarkup(
      createElement(FreeSos, { freeProduct, title, body: 'Megmutatjuk a gyakorlatokat.' }),
    )
    expect(html).toContain(`id="ingyenes-cim">${vart}</h2>`)
    if (vart !== FREE_SOS_STRIP_TITLE) expect(html).not.toContain(FREE_SOS_STRIP_TITLE)
    expect(html).toContain('class="kc-free-sos__kicker">SOS Kézrelax</p>')
    expect(html).toContain('Megmutatjuk a gyakorlatokat.')
    expect(html).toContain(`${ctaLabel('free-course-claim')} <span aria-hidden="true">→</span>`)
    expect(html).toContain('href="/kurzusok/sos-kezrelax-villamkurzus"')
    expect(html).toContain('kc-button--secondary')
  })

  it.each([undefined, '', ' ', '   \t\n '])(
    'üres vagy csak szóköz CMS-címnél a rögzített „Ingyenes villámkurzus” áll: %j',
    (title) => {
      const html = renderToStaticMarkup(
        createElement(FreeSos, { freeProduct, title, body: 'Megmutatjuk a gyakorlatokat.' }),
      )
      expect(FREE_SOS_STRIP_TITLE).toBe('Ingyenes villámkurzus')
      expect(html).toContain(`id="ingyenes-cim">${FREE_SOS_STRIP_TITLE}</h2>`)
      expect(html).not.toContain('\u2014')
      expect(html).not.toContain('\u2013')
      expect(html).toContain('class="kc-free-sos__kicker">SOS Kézrelax</p>')
      expect(html).toContain(`${ctaLabel('free-course-claim')} <span aria-hidden="true">→</span>`)
    },
  )

  it('a CMS-cím a szerkesztőé: a megjelenítés nem írja át (a gondolatjelet a kitöltő szabály javítja)', () => {
    const html = renderToStaticMarkup(
      createElement(FreeSos, { freeProduct, title: 'SOS Kézrelax \u2014 ingyenes villámkurzus' }),
    )
    expect(html).toContain('id="ingyenes-cim">SOS Kézrelax \u2014 ingyenes villámkurzus</h2>')
  })

  it('termék nélkül a CMS-cím helyett a semleges „Kurzusaink” áll, a gomb a kurzuslistára visz', () => {
    for (const title of ['Ingyenes villámkurzus', 'Saját SOS-cím', '', undefined]) {
      const html = renderToStaticMarkup(createElement(FreeSos, { freeProduct: null, title }))
      expect(html).toContain('id="ingyenes-cim">Kurzusaink</h2>')
      if (title) expect(html).not.toContain(title)
      expect(html).toContain('href="/kurzusok"')
      expect(html).toContain(ctaLabel('course-list-open'))
    }
  })

  it('a WP26 tulajdonosi indoklása és idézete a komponensben marad', () => {
    const forras = readFileSync(
      new URL('../components/content/home/FreeSos.tsx', import.meta.url),
      'utf8',
    )
    expect(forras).toContain('Lehetne csak egy sáv, benne a szöveg')
    expect(forras).toContain('csak kép nélkül')
    expect(forras).toContain('„‚Ingyenes villámkurzus’ nagyon rövid')
    expect(forras).toContain('src/scripts/sos-cim-kitoltes.ts')
  })

  it('a felvezető sor a displayTitle → sku láncból jön; mindkettő nélkül elmarad', () => {
    const skuOnly = renderToStaticMarkup(
      createElement(FreeSos, { freeProduct: { ...freeProduct, displayTitle: null, sku: 'SKU-név' } }),
    )
    expect(skuOnly).toContain('class="kc-free-sos__kicker">SKU-név</p>')
    const nameless = renderToStaticMarkup(
      createElement(FreeSos, { freeProduct: { ...freeProduct, displayTitle: null, sku: ' ' } }),
    )
    expect(nameless).not.toContain('kc-free-sos__kicker')
    expect(nameless).toContain(`>${FREE_SOS_STRIP_TITLE}</h2>`)
  })

  it('a szekciót a saját címsora nevezi meg (landmark), a horgony az id-ből jön', () => {
    const html = renderToStaticMarkup(createElement(FreeSos, { freeProduct }))
    expect(html).toContain('aria-labelledby="ingyenes-cim"')
    expect(html).toContain('id="ingyenes-cim"')
    expect(html).toContain('id="ingyenes"')
  })

  it.each([undefined, null, {}, photo])(
    'kép SOHA nem kerül a sávba, akkor sem, ha a CMS ad fotót: %j',
    (backgroundImage) => {
      const html = renderToStaticMarkup(createElement(FreeSos, { freeProduct, backgroundImage }))
      expect(html).not.toContain('<img')
      expect(html).not.toContain('kc-free-sos__art')
      expect(html).not.toContain('kc-free-sos--with-image')
      expect(html).not.toContain(photo.url)
    },
  )

  it('a CSS-ben nincs kép-hasáb, háttérkép, animáció vagy átmenet; a szegély a 32 px-es token', () => {
    const css = readFileSync(
      new URL('../app/(frontend)/styles/blocks/free-sos.css', import.meta.url),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).not.toContain('kc-free-sos__art')
    expect(css).not.toContain('linear-gradient')
    expect(css).not.toContain('background-image')
    expect(css).not.toMatch(/\b(transition|animation|transform)\s*:/)
    expect(css).toMatch(
      /\.kc-section\.kc-free-sos\s*\{[^}]*padding-block:\s*var\(--kc-space-6\)/,
    )
    expect(css).toMatch(/\.kc-free-sos__layout\s*\{[^}]*flex-wrap:\s*wrap/)
  })
})

/**
 * K18 (admin-audit): a blokk admin-szövegei azt mondják, amit a lap csinál, és
 * a séma nem változik. A G2 őr (schema-config-sync) az adatbázis-oszlopokat
 * méri; ez az őr a mezőnevek, típusok, kötelezőség és a szövegek igazát.
 */
describe('K18: a sáv admin-mezői őszinték és séma-semlegesek', () => {
  /**
   * A névvel bíró (adat)mezők, a név nélküli collapsible és row kilapítva: a
   * `sectionSettings()` 2026-09-23 óta (B6, K28) egy név nélküli „Megjelenés
   * és elrejtés” collapsible-ben adja a `sectionSettings` csoportot. Az
   * adatútvonal és a séma nem változott, ezért a sorrend-elvárás szó szerint
   * marad (G2: schema-config-sync).
   */
  const nevvel = (fields: Field[]): Array<Field & { name: string }> =>
    fields.flatMap((field): Array<Field & { name: string }> =>
      'name' in field
        ? [field as Field & { name: string }]
        : field.type === 'collapsible' || field.type === 'row'
          ? nevvel(field.fields)
          : [],
    )
  const mezo = (name: string): Field | undefined =>
    nevvel(freeSos.fields).find((field) => field.name === name)
  /** Az `admin` kulcs olvasása a mezőtípusok uniójától függetlenül. */
  const adminErtek = (field: Field | undefined, kulcs: string): unknown => {
    const admin: unknown = field?.admin
    return typeof admin === 'object' && admin !== null
      ? (admin as Readonly<Record<string, unknown>>)[kulcs]
      : undefined
  }
  const leiras = (field: Field | undefined): string => {
    const description = adminErtek(field, 'description')
    return typeof description === 'string' ? description : ''
  }

  it('a mezők neve, típusa és sorrendje változatlan, a slug és a típusnév is', () => {
    expect(freeSos.slug).toBe('freeSos')
    expect(freeSos.interfaceName).toBe('BlockFreeSos')
    expect(nevvel(freeSos.fields).map((field) => [field.name, field.type])).toEqual([
      ['title', 'text'],
      ['body', 'textarea'],
      ['cta', 'group'],
      ['backgroundImage', 'upload'],
      ['sectionSettings', 'group'],
    ])
    const cta = mezo('cta')
    expect(cta?.type === 'group' ? nevvel(cta.fields).map((f) => [f.name, f.type]) : []).toEqual([
      ['felirat', 'text'],
      ['url', 'text'],
      ['ujAblakban', 'checkbox'],
    ])
  })

  it('a cím kötelező és látható marad, readOnly és alapérték nélkül', () => {
    const title = mezo('title')
    expect(title?.type === 'text' && title.required).toBe(true)
    expect(adminErtek(title, 'hidden')).toBeUndefined()
    expect(adminErtek(title, 'readOnly')).toBeUndefined()
    expect(title && 'defaultValue' in title).toBe(false)
    expect(leiras(title)).toContain('A sáv legnagyobb szövege')
    // Nem törő szóköz a nyíl előtt: a nyíl nem kerülhet sor elejére.
    expect(leiras(title)).toContain(
      'Webshop\u00a0→ Kurzusok\u00a0→ SOS Kézrelax villámkurzus\u00a0→ Alapadatok',
    )
    expect(leiras(title)).not.toMatch(/ →/)
    expect(leiras(title)).toContain('„Kurzus címe”')
    expect(leiras(title)).toContain('„Kurzusaink”')
    expect(leiras(title)).not.toMatch(/üresen hagyod/i)
  })

  it('a Szöveg leírása kimondja a tartalékot: üresen a kurzus Rövid leírása látszik', () => {
    const body = mezo('body')
    expect(body?.type).toBe('textarea')
    expect(leiras(body)).toContain('„Rövid leírás”')
    const html = renderToStaticMarkup(
      createElement(FreeSos, {
        freeProduct: { ...freeProduct, shortDescription: 'A kurzus rövid leírása.' },
        title: 'Ingyenes villámkurzus',
        body: '  ',
      }),
    )
    expect(html).toContain('class="kc-free-sos__text">A kurzus rövid leírása.</p>')
  })

  it('a Háttérkép rejtett (az adat megmarad), nem kötelező, readOnly és alapérték nélkül', () => {
    const kep = mezo('backgroundImage')
    expect(adminErtek(kep, 'hidden')).toBe(true)
    expect(kep?.type === 'upload' && kep.required).toBeFalsy()
    expect(adminErtek(kep, 'readOnly')).toBeUndefined()
    expect(kep && 'defaultValue' in kep).toBe(false)
  })

  it('a gomb feliratmezője csak olvasható, nem kötelező, és a többi gombmező írható marad (H07)', () => {
    const cta = mezo('cta')
    const mezok = cta?.type === 'group' ? nevvel(cta.fields) : []
    const felirat = mezok.find((f) => f.name === 'felirat')
    expect(felirat?.type).toBe('text')
    expect(adminErtek(felirat, 'readOnly')).toBe(true)
    // Nem kötelező mezőn a readOnly a mentést nem akadályozza (backlog K18).
    expect(felirat?.type === 'text' && felirat.required).toBe(false)
    expect(felirat && 'defaultValue' in felirat).toBe(false)
    expect(adminErtek(felirat, 'hidden')).toBeUndefined()
    for (const nev of ['url', 'ujAblakban']) {
      const irhato = mezok.find((f) => f.name === nev)
      expect(adminErtek(irhato, 'readOnly')).toBeUndefined()
    }
    expect(adminErtek(cta, 'readOnly')).toBeUndefined()
  })

  it('a gomb feliratmezője kimondja, hogy a feliratot a rendszer adja, a szótárból', () => {
    const cta = mezo('cta')
    const felirat =
      cta?.type === 'group' ? nevvel(cta.fields).find((f) => f.name === 'felirat') : undefined
    expect(leiras(felirat)).toBe(FREE_SOS_CTA_DESCRIPTIONS.felirat)
    expect(leiras(felirat)).toContain('a weboldalon nem jelenik meg')
    expect(leiras(felirat)).toContain(`„${ctaLabel('free-course-claim')}”`)
    expect(leiras(felirat)).toContain(`„${ctaLabel('course-list-open')}”`)
    expect(leiras(cta)).toBe(FREE_SOS_CTA_DESCRIPTIONS.group)
  })

  it('a blokk neve egyszerű magyar név, a szövegekben nincs kvirtmínusz és egyenes idézőjel', () => {
    expect(freeSos.labels).toEqual({
      singular: 'Ingyenes villámkurzus sáv',
      plural: 'Ingyenes villámkurzus sávok',
    })
    const cta = mezo('cta')
    const szovegek = [
      String(freeSos.labels?.singular),
      leiras(mezo('title')),
      leiras(mezo('body')),
      leiras(mezo('backgroundImage')),
      leiras(cta),
      ...(cta?.type === 'group' ? nevvel(cta.fields).map(leiras) : []),
    ]
    for (const szoveg of szovegek) {
      expect(szoveg.length).toBeGreaterThan(0)
      expect(szoveg).not.toContain('\u2014')
      expect(szoveg).not.toContain('"')
      expect(szoveg).not.toContain('!')
    }
  })
})
