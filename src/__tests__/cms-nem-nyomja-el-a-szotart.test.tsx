import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppointmentForm } from '../components/blocks/AppointmentForm'
import { CtaBanner } from '../components/blocks/CtaBanner'
import { FilmHero } from '../components/blocks/FilmHero'
import { RenderBlocks } from '../components/blocks/RenderBlocks'
import { TeamMembers } from '../components/blocks/TeamMembers'
import {
  FREE_SOS_COURSE_CTA_LABEL,
  FREE_SOS_LIST_CTA_LABEL,
  resolveFreeSosCta,
} from '../components/content/home/FreeSos'
import { APPOINTMENT_UI_TEXT } from '../lib/appointment/validation'
import { ctaLabel } from '../lib/cta-vocabulary'
import type {
  BlockCtaBanner,
  BlockFilmHero,
  BlockTeamMembers,
  Page,
  Product,
} from '../payload-types'

/**
 * ŐR — CMS KONTRA KÓD: A SZÓTÁRI CSELEKVÉSEKNÉL A KÓD NYER.
 * A `src/__tests__/cta-a-termekben.test.ts` 2026-08-17-i mérése szerint hat
 * helyen a CMS-mező LEGYŐZTE a kódot (`cmsErtek?.trim() || KODBELI_FELIRAT`).
 * Következmény: a §3.2 CTA-szótár betartatása a kódban ÉLESBEN HATÁSTALAN
 * maradt. Konkrétan: a kezdőlap ingyenes sávján az adatbázisban őrzött
 */

vi.stubGlobal('fetch', () => {
  throw new Error('A tesztből SOSEM mehet ki valódi hálózati hívás.')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const REPO = fileURLToPath(new URL('..', import.meta.url))
const olvas = (relativUt: string): string => readFileSync(join(REPO, relativUt), 'utf8')

const kommentNelkul = (forras: string): string =>
  forras.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const render = (node: ReactNode): string =>
  renderToStaticMarkup(createElement(Fragment, null, node))

/** A szerkesztő KITALÁLT felirata — sehol nem szabad megjelennie szótári helyen. */
const SZERKESZTOI_FELIRAT = 'Kérek egy időpontot most'
/** Az ÉLESBEN mért, adatbázisban őrzött, szótártól eltérő felirat. */
const ELES_ELTERO_FELIRAT = 'Elindítom az ingyenes kurzust'

// 1. A DÖNTŐ BIZONYÍTÉK — időpontkérés: a CMS-mező nem győzi le a szótárt

describe('AppointmentForm — a szótári felirat nyer a CMS-mező ellenében', () => {
  const kirendereltCmsFelulirassal = (): string =>
    render(
      createElement(AppointmentForm, {
        formId: 'urlap-1',
        turnstileSiteKey: null,
        idopontSavok: [],
        gombFelirat: SZERKESZTOI_FELIRAT,
      }),
    )

  it('a KÓD felirata jelenik meg, nem a szerkesztőé', () => {
    const html = kirendereltCmsFelulirassal()
    expect(html, 'a §3.2 #25 felirata a jóváhagyott alak').toContain(ctaLabel('appointment-submit'))
    expect(
      html,
      'A szerkesztő mezője nem írhatja felül a szótári cselekvés feliratát.',
    ).not.toContain(SZERKESZTOI_FELIRAT)
  })

  it('ÜRES CMS-mezővel is ugyanaz a felirat áll (nincs két viselkedés)', () => {
    const uressel = render(
      createElement(AppointmentForm, {
        formId: 'urlap-1',
        turnstileSiteKey: null,
        idopontSavok: [],
        gombFelirat: '',
      }),
    )
    const mezoNelkul = render(
      createElement(AppointmentForm, {
        formId: 'urlap-1',
        turnstileSiteKey: null,
        idopontSavok: [],
      }),
    )
    expect(uressel).toContain(ctaLabel('appointment-submit'))
    expect(mezoNelkul).toContain(ctaLabel('appointment-submit'))
    expect(uressel).toBe(mezoNelkul)
    expect(uressel).toBe(kirendereltCmsFelulirassal())
  })

  it('a felirat a SZÓTÁRBÓL jön, nem literálként (a hívóhely `ctaLabel`-t hív)', () => {
    const forras = kommentNelkul(olvas('components/blocks/AppointmentForm.tsx'))
    expect(forras).toContain("ctaLabel('appointment-submit')")
    expect(forras, 'a CMS-felülírás alakja eltűnt').not.toContain('gombFelirat?.trim()')
  })

  it('a szótári felirat és a régi kódbeli tartalék BITRE egyezik (nincs csendes elcsúszás)', () => {
    expect(APPOINTMENT_UI_TEXT.submitLabel).toBe(ctaLabel('appointment-submit'))
  })
})

// 2. A DÖNTŐ BIZONYÍTÉK — ingyenes SOS-sáv: a CMS-mező nem győzi le a szótárt

const ingyenesTermek = {
  id: 2,
  slug: 'sos-kezrelax-villamkurzus',
  displayTitle: 'SOS Kézrelax villámkurzus',
  status: 'published',
  priceInHUF: null,
  priceInHUFEnabled: false,
} as unknown as Product

describe('FreeSos — a szótári felirat nyer a CMS-mező ellenében', () => {
  it('a KÓD felirata áll akkor is, ha a szerkesztő átírta', () => {
    const cta = resolveFreeSosCta(ingyenesTermek, { label: ELES_ELTERO_FELIRAT })
    expect(cta.label).toBe(FREE_SOS_COURSE_CTA_LABEL)
    expect(cta.label).toBe(ctaLabel('free-course-claim'))
    expect(cta.label).not.toBe(ELES_ELTERO_FELIRAT)
  })

  it('a hibatűrő (kurzuslista) ágon is a szótári felirat áll', () => {
    const cta = resolveFreeSosCta(null, { label: ELES_ELTERO_FELIRAT })
    expect(cta.label).toBe(FREE_SOS_LIST_CTA_LABEL)
    expect(cta.label).toBe(ctaLabel('course-list-open'))
  })

  it('a KIRENDERELT kezdőlapi sávon is a szótári felirat látszik', () => {
    const layout = [
      {
        blockType: 'freeSos' as const,
        title: 'Ingyenes SOS gyakorlatok',
        body: 'Öt perc, azonnal.',
        cta: { felirat: ELES_ELTERO_FELIRAT, ujAblakban: false },
        sectionSettings: { visible: true, anchorId: 'ingyenes', hatter: 'tint' as const },
      },
    ] as unknown as NonNullable<Page['layout']>

    const html = render(
      createElement(RenderBlocks, {
        layout,
        products: [ingyenesTermek],
        posts: [],
        testimonials: [],
      }),
    )
    expect(html).toContain(ctaLabel('free-course-claim'))
    expect(html).not.toContain(ELES_ELTERO_FELIRAT)
    // A SZERKESZTŐ TARTALMA viszont változatlanul él.
    expect(html).toContain('Ingyenes SOS gyakorlatok')
    expect(html).toContain('Öt perc, azonnal.')
  })

  it('a másik termékre mutató CMS-cél nem téríti el az ingyenes ajánlatot', () => {
    const cta = resolveFreeSosCta(ingyenesTermek, {
      label: ELES_ELTERO_FELIRAT,
      href: '/kurzusok/masik-ingyenes-kurzus',
    })
    expect(cta.href).toBe('/kurzusok/sos-kezrelax-villamkurzus')
    expect(cta.label).toBe(FREE_SOS_COURSE_CTA_LABEL)
  })

  it('a feliratok a SZÓTÁRBÓL olvasva állnak, nem literálként', () => {
    const forras = kommentNelkul(olvas('components/content/home/FreeSos.tsx'))
    expect(forras).toContain("ctaLabel('free-course-claim')")
    expect(forras).toContain("ctaLabel('course-list-open')")
    expect(forras, 'a CMS-felülírás alakja eltűnt').not.toContain('override?.label?.trim()')
  })
})

// 3. A SZABÁLY HATÁRA — a szerkesztőt NEM némítjuk el ott, ahol joga van írni

describe('CtaBanner — a szerkesztő felirata ÉL (nincs rá §3.2 sor)', () => {
  it('a megadott felirat és cél kimegy a HTML-be', () => {
    const block = {
      blockType: 'ctaBanner',
      title: 'Kérdésed van?',
      text: 'Írj nekünk, és két munkanapon belül válaszolunk.',
      cta: { felirat: 'Írok nektek', url: '/kapcsolat', ujAblakban: false },
    } as unknown as BlockCtaBanner
    const html = render(createElement(CtaBanner, { block }))
    expect(
      html,
      'A CTA-sáv linkje bárhova mutathat, ezért a felirat SZÜKSÉGSZERŰEN a ' +
        'szerkesztőé — az elnémítása felirat nélküli gombot adna.',
    ).toContain('Írok nektek')
    expect(html).toContain('href="/kapcsolat"')
  })

  it('felirat nélkül gomb sincs (kitalált CTA-t nem teszünk ki)', () => {
    const block = {
      blockType: 'ctaBanner',
      title: 'Kérdésed van?',
      cta: { url: '/kapcsolat' },
    } as unknown as BlockCtaBanner
    const html = render(createElement(CtaBanner, { block }))
    expect(html).toContain('Kérdésed van?')
    expect(html).not.toContain('kc-cta-banner__action')
  })
})

describe('FilmHero — a szerkesztő feliratai ÉLNEK (nincs rájuk §3.2 sor)', () => {
  it('mindkét CTA felirata kimegy a HTML-be', () => {
    const block = {
      blockType: 'filmHero',
      title: 'A kéz nyílása',
      ctas: [
        { felirat: 'Megnézem a filmet', url: '/kurzusok', ujAblakban: false },
        { felirat: 'Olvasok a módszerről', url: '/tudastar', ujAblakban: false },
      ],
      sectionSettings: {},
    } as unknown as BlockFilmHero
    const html = render(createElement(FilmHero, { block }))
    expect(html).toContain('Megnézem a filmet')
    expect(html).toContain('Olvasok a módszerről')
  })
})

describe('RenderBlocks.linkFrom — a szerkesztő link-felirata ÉL', () => {
  it('a credsStrip blokk linkjének felirata kimegy a HTML-be', () => {
    const layout = [
      {
        blockType: 'credsStrip' as const,
        items: [{ text: 'Tizenöt év rendelői gyakorlat' }],
        link: { felirat: 'Megismerem a csapatot', url: '/rolunk', ujAblakban: false },
        sectionSettings: { visible: true },
      },
    ] as unknown as NonNullable<Page['layout']>
    const html = render(
      createElement(RenderBlocks, { layout, products: [], posts: [], testimonials: [] }),
    )
    expect(html).toContain('Megismerem a csapatot')
    expect(html).toContain('href="/rolunk"')
  })

  it('hiányos link (csak felirat vagy csak cél) egészben kimarad', () => {
    const layout = [
      {
        blockType: 'credsStrip' as const,
        items: [{ text: 'Tizenöt év rendelői gyakorlat' }],
        link: { felirat: 'Megismerem a csapatot' },
        sectionSettings: { visible: true },
      },
    ] as unknown as NonNullable<Page['layout']>
    const html = render(
      createElement(RenderBlocks, { layout, products: [], posts: [], testimonials: [] }),
    )
    expect(html).not.toContain('Megismerem a csapatot')
  })
})

describe('TeamMembers — a szerkesztő hívás-felirata ÉL', () => {
  it('a `callLabel` kimegy a HTML-be, és a hozzáférhető névbe is bekerül', () => {
    const block = {
      blockType: 'teamMembers',
      members: [
        {
          name: 'Kocsis Kata',
          role: 'gyógytornász',
          phone: '+36 30 123 4567',
          callLabel: 'Hívd a rendelőt',
        },
      ],
      sectionSettings: {},
    } as unknown as BlockTeamMembers
    const html = render(createElement(TeamMembers, { block }))
    expect(html).toContain('Hívd a rendelőt')
    expect(html).toContain('aria-label="Hívd a rendelőt: +36 30 123 4567"')
  })
})

// 4. A SZABÁLY KÉT OLDALA EGY ÁLLÍTÁSBAN

describe('A szabály kimondva: szótári cselekvés → kód, minden más → szerkesztő', () => {
  it('a két szótári hely feliratát a kód adja, a négy szabad helyét a szerkesztő', () => {
    // Szótári: a szerkesztő szövege NEM jelenik meg.
    expect(resolveFreeSosCta(ingyenesTermek, { label: 'Bármi más' }).label).toBe(
      ctaLabel('free-course-claim'),
    )
    const idopont = render(
      createElement(AppointmentForm, {
        formId: 'urlap-1',
        turnstileSiteKey: null,
        idopontSavok: [],
        gombFelirat: 'Bármi más',
      }),
    )
    expect(idopont).not.toContain('Bármi más')

    // Szabad: a szerkesztő szövege MEGJELENIK.
    const sav = render(
      createElement(CtaBanner, {
        block: {
          blockType: 'ctaBanner',
          title: 'Cím',
          cta: { felirat: 'Bármi más', url: '/kapcsolat' },
        } as unknown as BlockCtaBanner,
      }),
    )
    expect(sav).toContain('Bármi más')
  })
})

// 5. A MEGÁLLAPÍTÁS, AMI KÜLÖN KÖRT KÉR — mérve, hogy ne romolhasson el csendben

/**
 * A négy hely, ahol a felirat KIZÁRÓLAG a CMS-ből jön (nincs kódbeli tartalék),
 * és a hívóhely nem tud `CtaAction`-t. A „kód nyer" szabály itt nem
 * alkalmazható; a rendezés admin-oldali döntést kér (mezősúgó vagy validáció),
 * ezért KÜLÖN KÖR. A lista mérete FELSŐ KORLÁT: új ilyen hely tudatos döntés
 * kell legyen.
 */
const CSAK_CMS_HELYEK: readonly { readonly fajl: string; readonly mezo: string }[] = [
  { fajl: 'components/blocks/CtaBanner.tsx', mezo: 'block.cta?.felirat' },
  { fajl: 'components/blocks/FilmHero.tsx', mezo: 'cta.felirat' },
  { fajl: 'components/blocks/RenderBlocks.tsx', mezo: 'link?.felirat' },
  { fajl: 'components/blocks/TeamMembers.tsx', mezo: 'member.callLabel' },
]

describe('A négy CSAK-CMS hely: kódbeli tartalék nélkül (külön kör)', () => {
  for (const { fajl, mezo } of CSAK_CMS_HELYEK) {
    it(`${fajl}: a felirat a(z) \`${mezo}\` mezőből jön`, () => {
      const forras = kommentNelkul(olvas(fajl))
      expect(forras, `${fajl}: eltűnt a CMS-mező olvasása`).toContain(mezo)
    })

    it(`${fajl}: NINCS kódbeli tartalék-felirat a mező mögött`, () => {
      // Ha valaki ide tartalékot tesz, az MÁS döntés (akkor a „kód nyer"
      // szabály alkalmazhatóvá válna) — a szám akkor is látszódjon.
      const forras = kommentNelkul(olvas(fajl))
      const tartalekMinta = new RegExp(
        `${mezo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]*(\\|\\||\\?\\?)\\s*['"\`][^'"\`]+['"\`]`,
      )
      expect(
        tartalekMinta.test(forras),
        `${fajl}: kódbeli tartalék jelent meg a CMS-mező mögött. Ez döntést kér: ` +
          'ha a felirat szótári cselekvés, a KÓD nyerjen (lásd a fenti két helyet).',
      ).toBe(false)
    })
  }

  it('a lista ma NÉGY soros — új CSAK-CMS hely tudatos döntés kell legyen', () => {
    expect(CSAK_CMS_HELYEK).toHaveLength(4)
    expect(new Set(CSAK_CMS_HELYEK.map((hely) => hely.fajl)).size).toBe(4)
  })
})

// 6. A MEGLÉVŐ ADAT — a szerkesztő szövegét NEM töröljük, csak nem jelenítjük meg

describe('A meglévő, adatbázisban élő felülíró értékek sorsa', () => {
  it('a prop/mező a típusban MARAD (a néma adat-eldobás rosszabb lenne)', () => {
    const appointment = olvas('components/blocks/AppointmentForm.tsx')
    expect(appointment, 'a `gombFelirat` prop nem tűnhet el').toContain('gombFelirat?: string')
    const freeSos = olvas('components/content/home/FreeSos.tsx')
    expect(freeSos, 'a `label` felülíró mező nem tűnhet el').toContain('label?: string')
  })

  it('a kód KIMONDJA, hogy a mező szándékosan inaktív (nem véletlen elhagyás)', () => {
    const appointment = olvas('components/blocks/AppointmentForm.tsx')
    expect(appointment).toContain('INAKTÍV, SZÁNDÉKOSAN')
    const freeSos = olvas('components/content/home/FreeSos.tsx')
    expect(freeSos).toContain('INAKTÍV, SZÁNDÉKOSAN')
  })

  it('az Appointment blokk-adapter TOVÁBBRA IS átadja a mezőt (az adat útja ép)', () => {
    const adapter = kommentNelkul(olvas('components/blocks/Appointment.tsx'))
    expect(adapter).toContain('gombFelirat={block.gombFelirat')
  })
})
