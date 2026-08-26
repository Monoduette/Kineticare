import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CourseBuyBar } from '../components/courses/CourseBuyBar'
import { CourseBuybox } from '../components/courses/CourseBuybox'
import { CourseCurriculum, moduleMetaLabel } from '../components/courses/CourseCurriculum'
import { CourseFaq } from '../components/courses/CourseFaq'
import { CourseFitCheck } from '../components/courses/CourseFitCheck'
import { CourseGuarantee } from '../components/courses/CourseGuarantee'
import { CourseHowItWorks } from '../components/courses/CourseHowItWorks'
import { CourseJumpNav } from '../components/courses/CourseJumpNav'
import type { CurriculumModule } from '../lib/curriculum/curriculum'
import { formatPriceHuf } from '../lib/format-price'
import type { Product } from '../payload-types'

/**
 * A kurzus-értékesítő oldal komponenseinek SZERZŐDÉSEI.
 *
 * Amit itt mérünk, az mind kutatási szabály vagy akadálymentességi
 * követelmény (docs/ux-belso-oldalak-kutatas.md 3. fejezet):
 *  - a vásárlódobozban az ÁR a gomb közelében van (B6.2), és a lap H1-e is ott
 *    él, hogy mobilon a felső 20%-ba essen;
 *  - a horgony-chipek csak LÉTEZŐ szakaszokra mutatnak (B2.3);
 *  - a GYIK natív `details`, darabszámmal (B5.1, B5.3), de ár és garancia
 *    SOSEM harmonikában (B5.2);
 *  - a garancia-sáv TISZTA érv: 2026-08-16 óta NEM hordoz vásárló-gombot — a
 *    lap egyetlen vásárlási célja a ragadós vásárlódoboz, mobilon a ragadós
 *    alsó sáv (tulajdonosi döntés az ismételt CTA-k ellen);
 *  - a mobil vásárlósáv JS nélkül REJTVE marad;
 *  - a tananyag nyilvános nézete nem szivárogtat fizetős azonosítót (S2/b).
 */

/** Vásárolható (published + ÉRVÉNYES ár) termék — a CTA ezt kínálja megvételre. */
const product = { id: 42, status: 'published', priceInHUF: 79500, priceInHUFEnabled: true } as Pick<
  Product,
  'id' | 'status' | 'priceInHUF' | 'priceInHUFEnabled'
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

describe('CourseBuybox — a lap egyetlen elsődleges célja', () => {
  const html = buybox()

  it('a H1 a dobozban van, és a doboz horgonyt kap a mobil sávnak', () => {
    expect(html).toContain('id="kurzus-vasarlas"')
    expect(html).toContain('<h1')
    expect(html).toContain('Otthoni KézRehab Program')
  })

  it('az ár, a gomb és a garancia EGYÜTT, a gomb közvetlen közelében áll', () => {
    expect(html).toContain(formatPriceHuf(79500))
    expect(html).toContain('/penztar?termek=42')
    expect(html).toContain('Megveszem')
    expect(html).toContain('30 napos kipróbálási garancia')
    // Az ár a gomb ELŐTT — a döntési információ sosem a gomb után jön.
    expect(html.indexOf(formatPriceHuf(79500))).toBeLessThan(html.indexOf('Megveszem'))
  })

  it('a pipás sorok listaelemként, a másodlagos út szöveglinkként jelenik meg', () => {
    expect(html).toContain('kc-course-checklist__item')
    expect(html).toContain('Örökös hozzáférés')
    expect(html).toContain('href="#kinek-valo"')
    expect(html).toContain('kc-course-textlink')
    // A másodlagos út NEM gomb: nem versenyezhet a fő CTA-val (B6.5).
    expect(html).not.toContain('kc-button kc-button--secondary')
  })

  it('ingyenes kurzusnál „Ingyenes" áll az ár helyén, ár-jegyzet nélkül', () => {
    const free = buybox({ priceBadge: 'free', priceHuf: null })
    expect(free).toContain('Ingyenes')
    expect(free).not.toContain('egyszeri díj')
  })

  it('hibás ár-konfigurációnál (badge: none) SEMMILYEN ár-címke nem jelenik meg', () => {
    const none = buybox({ priceBadge: 'none', priceHuf: null })
    expect(none).not.toContain('Ingyenes')
    expect(none).not.toContain('Ft')
  })

  /**
 * `docs/ui-sztenderdek.md` **Á-3** és **§3.2 #16**: ha a cselekvés nem
 * végezhető el, a gomb ELTŰNIK, és magyarázó mondat áll a helyén. A korábbi
 * kód letiltott, „Megveszem" feliratú, magyarázat NÉLKÜLI gombot adott —
 * fókuszálhatatlan és hamis ígéret (NN/g: „a link ígéret"),
 * `docs/gomb-inventar.md` T2.
 */
  it('nem vásárolható termék: NINCS gomb, helyette magyarázó mondat (Á-3, §3.2 #16)', () => {
    const broken = buybox({
      priceBadge: 'none',
      priceHuf: null,
      // ár-pipa BE, ár ÜRES → a checkout 400-zal utasítaná el
      product: { id: 42, status: 'published', priceInHUF: null, priceInHUFEnabled: true },
    })

    expect(broken).not.toContain('Megveszem')
    expect(broken).not.toContain('<button')
    expect(broken).not.toContain('disabled')
    expect(broken).toContain('Ez a kurzus jelenleg nem vásárolható meg.')
    // A magyarázat a CTA-blokk jegyzet-osztályát kapja (nincs új szín/betűméret).
    expect(broken).toContain('kc-course-cta__note')
  })

  it('beállítatlan ár-pipánál is ugyanez (a tulajdonos által jelzett élő eset)', () => {
    const unset = buybox({
      priceBadge: 'none',
      priceHuf: null,
      product: { id: 42, status: 'published', priceInHUF: null, priceInHUFEnabled: null },
    })

    expect(unset).not.toContain('Megveszem')
    expect(unset).toContain('Ez a kurzus jelenleg nem vásárolható meg.')
  })

  it('ARCHIVÁLT terméknél sincs többé letiltott gomb, csak a jelölés', () => {
    const archived = buybox({
      priceBadge: 'price',
      priceHuf: 79500,
      product: { id: 42, status: 'archived', priceInHUF: 79500, priceInHUFEnabled: true },
    })

    expect(archived).not.toContain('Megveszem')
    // A §3.2 #16 mondata + a NN/g Error-Message Guidelines szerinti
    // továbblépés („Merely stating the problem is also not enough; offer some
    // potential remedies") — 2026-08-18 óta az archivált ág sem zsákutca.
    expect(archived).toContain('Ez a kurzus jelenleg nem vásárolható meg.')
    expect(archived).toContain('Nézd meg a többi kurzusunkat')
  })

  it('a VÁSÁROLHATÓ termék gombja változatlanul megjelenik (nincs túlfogás)', () => {
    expect(html).toContain('Megveszem')
    expect(html).not.toContain('Ez a kurzus jelenleg nem vásárolható')
  })
})

describe('CourseJumpNav — horgonyok csak létező szakaszokra', () => {
  it('a chipek a megadott szakaszokra mutatnak', () => {
    const html = renderToStaticMarkup(
      createElement(CourseJumpNav, {
        targets: [
          { id: 'mi-ez', label: 'Mi ez?' },
          { id: 'tananyag', label: 'Tananyag' },
          { id: 'gyik', label: 'GYIK' },
        ],
      }),
    )
    expect(html).toContain('href="#mi-ez"')
    expect(html).toContain('href="#tananyag"')
    expect(html).toContain('href="#gyik"')
    expect(html).toContain('Ugrás:')
  })

  it('kettőnél kevesebb célnál a sáv elmarad (nincs magára mutató navigáció)', () => {
    expect(
      renderToStaticMarkup(
        createElement(CourseJumpNav, { targets: [{ id: 'mi-ez', label: 'Mi ez?' }] }),
      ),
    ).toBe('')
    expect(renderToStaticMarkup(createElement(CourseJumpNav, { targets: [] }))).toBe('')
  })
})

describe('CourseCurriculum — a teljes tanterv NYITVA, fizetős adat nélkül', () => {
  const modules: CurriculumModule[] = [
    {
      id: 'm1',
      title: 'I. Az alapok',
      summary: 'Anatómia és tévhitek.',
      lessons: [
        {
          ref: 'l1',
          title: 'Ismerd meg a kezed',
          kind: 'video',
          summary: null,
          streamAssetId: null,
          durationSec: 300,
          status: 'ready',
          url: null,
          content: null,
          attachments: [],
          playable: true,
          flatIndex: 0,
          indexInModule: 0,
          moduleIndex: 0,
        },
        {
          ref: 'l2',
          title: 'Letölthető puska',
          kind: 'szoveg',
          summary: null,
          streamAssetId: null,
          durationSec: null,
          status: null,
          url: null,
          content: null,
          attachments: [],
          playable: true,
          flatIndex: 1,
          indexInModule: 1,
          moduleIndex: 0,
        },
      ],
    },
    { id: 'ures', title: 'Üres modul', summary: null, lessons: [] },
  ]

  const html = renderToStaticMarkup(
    createElement(CourseCurriculum, {
      heading: 'Tananyag',
      headingId: 'tananyag-cim',
      modules,
    }),
  )

  it('a modulok és a leckecímek NEM harmonikában, hanem nyitva állnak', () => {
    expect(html).toContain('id="tananyag"')
    expect(html).toContain('I. Az alapok')
    expect(html).toContain('Ismerd meg a kezed')
    expect(html).not.toContain('<details')
  })

  it('a lecke típusa csak a nem videós anyagnál látszik', () => {
    expect(html).toContain('szöveges lecke')
  })

  it('az üres modul nem jelenik meg', () => {
    expect(html).not.toContain('Üres modul')
  })

  it('a meta-sor a leckeszámot és — ha van — a hosszt hozza', () => {
    expect(moduleMetaLabel(modules[0])).toBe('2 lecke · 5 perc')
    expect(moduleMetaLabel({ ...modules[0], lessons: [] })).toBe('0 lecke')
  })
})

describe('CourseFitCheck — a két lista EGYMÁS MELLETT', () => {
  it('mindkét hasáb megjelenik, saját címmel és jelölővel', () => {
    const html = renderToStaticMarkup(
      createElement(CourseFitCheck, {
        fitFor: ['Otthon szeretnél gyakorolni'],
        fitTitle: 'Neked való, ha…',
        heading: 'Kinek való, és kinek nem?',
        headingId: 'kinek-valo-cim',
        notFitFor: ['Nincs napi 5 perced'],
        notFitTitle: 'Nem javasoljuk, ha…',
      }),
    )
    expect(html).toContain('id="kinek-valo"')
    expect(html).toContain('data-columns="2"')
    expect(html).toContain('Neked való, ha…')
    expect(html).toContain('Nem javasoljuk, ha…')
    expect(html).toContain('kc-course-checklist--no')
  })

  it('egyetlen lista esetén egy hasáb marad — üres doboz nem kerül ki', () => {
    const html = renderToStaticMarkup(
      createElement(CourseFitCheck, {
        fitFor: ['Otthon szeretnél gyakorolni'],
        fitTitle: 'Neked való, ha…',
        heading: 'Kinek való?',
        headingId: 'kinek-valo-cim',
        notFitFor: [],
        notFitTitle: 'Nem javasoljuk, ha…',
      }),
    )
    expect(html).toContain('data-columns="1"')
    expect(html).not.toContain('Nem javasoljuk, ha…')
  })

  it('mindkét lista üres → a szakasz elmarad', () => {
    expect(
      renderToStaticMarkup(
        createElement(CourseFitCheck, {
          fitFor: [],
          fitTitle: 'a',
          heading: 'b',
          headingId: 'c',
          notFitFor: [],
          notFitTitle: 'd',
        }),
      ),
    ).toBe('')
  })
})

describe('CourseFaq — natív harmonika, darabszámmal', () => {
  const html = renderToStaticMarkup(
    createElement(CourseFaq, {
      heading: 'Gyakori kérdések',
      headingId: 'gyik-cim',
      items: [
        { question: 'Mennyi idő?', answer: 'Napi 5 perc.' },
        { question: 'Kinek jó?', answer: 'Bárkinek, aki otthon gyakorolna.' },
      ],
    }),
  )

  it('natív details/summary — JS nélkül is nyitható (B7.5)', () => {
    expect(html).toContain('<details')
    expect(html).toContain('<summary')
    expect(html).toContain('Mennyi idő?')
  })

  it('a fejlécben ott a darabszám (B5.3)', () => {
    expect(html).toContain('(2)')
  })

  it('üres listánál a szakasz elmarad', () => {
    expect(
      renderToStaticMarkup(
        createElement(CourseFaq, { heading: 'a', headingId: 'b', items: [] }),
      ),
    ).toBe('')
  })
})

describe('CourseGuarantee — tiszta érv, vásárló-gomb NÉLKÜL', () => {
  const html = renderToStaticMarkup(
    createElement(CourseGuarantee, {
      guarantee: { title: '30 napos garancia', text: 'Kérdés nélkül visszafizetjük.' },
      headingId: 'garancia-cim',
    }),
  )

  it('kiemelt, horgonyozott szakasz a garancia címével és szövegével', () => {
    expect(html).toContain('id="garancia"')
    expect(html).toContain('30 napos garancia')
    expect(html).toContain('Kérdés nélkül visszafizetjük.')
    // A garancia NEM harmonikában van (B5.2).
    expect(html).not.toContain('<details')
  })

  it('NEM hordoz checkout-útvonalat: a lapon egyetlen vásárlási cél él', () => {
    expect(html).not.toContain('/penztar')
    expect(html).not.toContain('kc-button')
    expect(html).not.toContain('kc-course-cta')
  })
})

describe('a tartalomban ismételt vásárló-gomb NINCS', () => {
  it('a kurzusoldal forrása nem hivatkozik ismételt CTA-sávra', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const forras = readFileSync(
      fileURLToPath(new URL('../app/(frontend)/kurzusok/[slug]/page.tsx', import.meta.url)),
      'utf8',
    )
    // Az egyetlen vásárlási felület a buybox + a ragadós vásárlósáv.
    expect(forras).toContain('CourseBuybox')
    expect(forras).toContain('CourseBuyBar')
    expect(forras).not.toContain('CourseCtaBand')
    expect(forras).not.toContain('ctaBand')
  })
})

describe('CourseHowItWorks — lépések rácsban', () => {
  it('a lépések számozva, saját címmel jelennek meg', () => {
    const html = renderToStaticMarkup(
      createElement(CourseHowItWorks, {
        heading: 'Hogyan működik?',
        headingId: 'hogyan-mukodik-cim',
        steps: [
          { title: 'Megveszed', text: 'Bankkártyás fizetés.' },
          { title: 'Azonnal eléred', text: null },
        ],
      }),
    )
    expect(html).toContain('id="hogyan-mukodik"')
    expect(html).toContain('Megveszed')
    expect(html).toContain('Azonnal eléred')
    expect(html).toContain('kc-course-step__index')
  })

  it('lépés nélkül a szakasz elmarad', () => {
    expect(
      renderToStaticMarkup(
        createElement(CourseHowItWorks, { heading: 'a', headingId: 'b', steps: [] }),
      ),
    ).toBe('')
  })
})

describe('CourseBuyBar — JS nélkül csendben elmarad', () => {
  it('a szerver-oldali kimenet REJTETT állapotban renderel', () => {
    const html = renderToStaticMarkup(
      createElement(CourseBuyBar, {
        anchorId: 'kurzus-vasarlas-gomb',
        courseTitle: 'Otthoni KézRehab Program',
        href: '/penztar?termek=42',
        label: 'Megveszem',
        priceLabel: '79 500 Ft',
      }),
    )
    expect(html).toContain('data-visible="false"')
    expect(html).toContain('/penztar?termek=42')
    expect(html).toContain('Megveszem')
    // 44px-es célfelület: a közös gomb-osztályt viseli.
    expect(html).toContain('kc-button kc-button--primary')
  })
})
