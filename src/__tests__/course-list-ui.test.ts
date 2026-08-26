import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CourseList } from '../components/account/CourseList'
import {
  buildCourseCardView,
  courseCtaContext,
  courseCtaLabel,
  courseListSummary,
  courseMetaLine,
  formatRemainingLabel,
  groupCourseCards,
  remainingSeconds,
  resolveCourseCardStatus,
  type CourseCardView,
} from '../components/account/course-list-order'
import { ACCESS_EXPIRED_TITLE, accessExpiredMessage } from '../lib/course-access'
import { ctaLabel } from '../lib/cta-vocabulary'
import { buildCurriculum } from '../lib/curriculum/curriculum'
import { NO_LESSONS_LABEL } from '../lib/curriculum/progress'
import type { Product } from '../payload-types'

/**
 * A „Kurzusaim" lista — a TISZTA logika és a megjelenítés őrei.
 * 1. Csoportosítás és sorrend: folyamatban → el nem kezdett → befejezett →
 * lejárt. Ez a képernyő fő ígérete („hol folytassam?"), ezért a sorrend
 * megfordulása néma, de súlyos regresszió lenne.
 * 2. A gombfelirat-állapotgép: a felirat a valós állapotot mondja. „Folytatás"
 */

/** Három leckés, modulokra bontott kurzus — a „folyamatban" alapesethez. */
const KURZUS: Product = {
  id: 42,
  sku: 'Otthoni KézRehab',
  modules: [
    {
      id: 'modul-1',
      title: 'Alapok',
      lessons: [
        {
          id: 'lecke-1',
          title: 'Bevezetés',
          kind: 'video',
          streamAssetId: 'asset-1',
          status: 'ready',
          durationSec: 600,
        },
        {
          id: 'lecke-2',
          title: 'Csuklóhajlítás alapjai',
          kind: 'video',
          streamAssetId: 'asset-2',
          status: 'ready',
          durationSec: 1920,
        },
        {
          id: 'lecke-3',
          title: 'Zárás',
          kind: 'video',
          streamAssetId: 'asset-3',
          status: 'ready',
          durationSec: 600,
        },
      ],
    },
  ],
} as unknown as Product

/** Tananyag nélküli kurzus (a staff még nem töltötte fel a leckéket). */
const URES_KURZUS: Product = { id: 7, sku: 'Készülő kurzus' } as unknown as Product

interface CardOptions {
  product?: Product
  watched?: string[]
  hasAccess?: boolean
  expiryLabel?: string | null
  expiredMessage?: string | null
}

function card(options: CardOptions = {}): CourseCardView {
  const product = options.product ?? KURZUS
  const hasAccess = options.hasAccess ?? true
  return buildCourseCardView({
    productId: product.id,
    title: typeof product.sku === 'string' ? product.sku : `Kurzus #${product.id}`,
    href: hasAccess ? `/kurzusaim/${product.id}` : `/kurzusok/${product.id}`,
    cover: null,
    curriculum: buildCurriculum(product, hasAccess),
    watchedRefs: options.watched ?? [],
    hasAccess,
    expiryLabel: options.expiryLabel ?? null,
    expiredMessage: options.expiredMessage ?? null,
  })
}

const MINDEN_LECKE = ['lecke-1', 'lecke-2', 'lecke-3']

describe('formatRemainingLabel — a hátralévő idő magyar felirata', () => {
  it('percet mond egy óra alatt', () => {
    expect(formatRemainingLabel(42 * 60)).toBe('kb. 42 perc')
  })

  it('órát ÉS percet mond egy óra felett', () => {
    expect(formatRemainingLabel(65 * 60)).toBe('kb. 1 óra 5 perc')
  })

  it('kerek óránál nem ír „0 perc"-et', () => {
    expect(formatRemainingLabel(2 * 60 * 60)).toBe('kb. 2 óra')
  })

  it('percre kerekít (a másodperc-pontosság itt zaj)', () => {
    expect(formatRemainingLabel(90)).toBe('kb. 2 perc')
  })

  it('egy percnél rövidebb maradék is legalább „1 perc" — „kb. 0 perc" nincs', () => {
    expect(formatRemainingLabel(20)).toBe('kb. 1 perc')
  })

  it.each([
    ['nulla', 0],
    ['negatív', -60],
    ['hiányzó', null],
  ])('%s érték esetén elmarad a szakasz (null)', (_nev, ertek) => {
    expect(formatRemainingLabel(ertek as number | null)).toBeNull()
  })
})

describe('remainingSeconds — mennyi van még hátra', () => {
  const lessons = buildCurriculum(KURZUS, true).lessons

  it('csak a MÉG NEM kész leckéket számolja', () => {
    expect(remainingSeconds(lessons, ['lecke-1'])).toBe(1920 + 600)
  })

  it('minden lecke kész → nincs hátralévő idő', () => {
    expect(remainingSeconds(lessons, MINDEN_LECKE)).toBeNull()
  })

  it('a nem elindítható (feldolgozás alatti) leckét kihagyja', () => {
    const feldolgozasAlatt = buildCurriculum(
      {
        modules: [
          {
            id: 'm',
            title: 'M',
            lessons: [
              { id: 'a', title: 'Kész', kind: 'video', streamAssetId: 'x', status: 'ready', durationSec: 120 },
              {
                id: 'b',
                title: 'Még készül',
                kind: 'video',
                streamAssetId: 'y',
                status: 'processing',
                durationSec: 6000,
              },
            ],
          },
        ],
      } as unknown as Product,
      true,
    ).lessons
    expect(remainingSeconds(feldolgozasAlatt, [])).toBe(120)
  })

  it('hossz-adat nélkül null — kitalált időt nem írunk ki', () => {
    const hosszNelkul = buildCurriculum(
      {
        videos: [{ id: 'v1', title: 'Videó', streamAssetId: 'x', status: 'ready' }],
      } as unknown as Product,
      true,
    ).lessons
    expect(remainingSeconds(hosszNelkul, [])).toBeNull()
  })
})

describe('resolveCourseCardStatus — az állapotgép', () => {
  it('a lejárat MINDENT felülír', () => {
    expect(resolveCourseCardStatus({ hasAccess: false, started: true, complete: true })).toBe(
      'expired',
    )
  })

  it.each([
    ['el nem kezdett', { started: false, complete: false }, 'not-started'],
    ['folyamatban', { started: true, complete: false }, 'in-progress'],
    ['befejezett', { started: true, complete: true }, 'completed'],
  ])('%s', (_nev, allapot, vart) => {
    expect(resolveCourseCardStatus({ hasAccess: true, ...allapot })).toBe(vart)
  })
})

describe('courseCtaLabel — a gombfelirat-állapotgép (kizárólag §3.2 szótári alakok)', () => {
  it('el nem kezdett kurzus → §3.2 #8', () => {
    expect(courseCtaLabel({ status: 'not-started', totalLessons: 3 })).toBe(
      ctaLabel('course-start'),
    )
  })

  it('folyamatban → §3.2 #7, a lecke címe NÉLKÜL (az a hozzáférhető névbe való)', () => {
    expect(courseCtaLabel({ status: 'in-progress', totalLessons: 3 })).toBe(
      ctaLabel('course-continue'),
    )
  })

  it('befejezett → §3.2 #29', () => {
    expect(courseCtaLabel({ status: 'completed', totalLessons: 3 })).toBe(
      ctaLabel('course-rewatch'),
    )
  })

  it('lejárt → §3.2 #28 (a kurzus saját oldala)', () => {
    expect(courseCtaLabel({ status: 'expired', totalLessons: 3 })).toBe(
      ctaLabel('course-sales-open'),
    )
  })

  it('tananyag nélküli kurzus ugyanazt a cselekvést kapja, mint az el nem kezdett (#8)', () => {
    expect(courseCtaLabel({ status: 'not-started', totalLessons: 0 })).toBe(
      ctaLabel('course-start'),
    )
  })
})

describe('courseCtaContext — a lecke neve a HOZZÁFÉRHETŐ névbe kerül (WCAG 2.2 · 2.5.3)', () => {
  it('folyamatban lévő kurzuson a következő lecke neve is benne van', () => {
    expect(
      courseCtaContext({
        status: 'in-progress',
        title: 'Kéztorna otthon',
        resumeLessonTitle: 'Csuklóhajlítás alapjai',
      }),
    ).toBe('Kéztorna otthon, következő lecke: Csuklóhajlítás alapjai')
  })

  it('ismeretlen lecke-címnél csak a kurzus neve marad (kitalált címet nem írunk)', () => {
    expect(
      courseCtaContext({ status: 'in-progress', title: 'Kéztorna otthon', resumeLessonTitle: null }),
    ).toBe('Kéztorna otthon')
  })

  it('nem folyamatban lévő kurzuson a lecke neve nem jelenik meg', () => {
    expect(
      courseCtaContext({ status: 'completed', title: 'Kéztorna otthon', resumeLessonTitle: 'X' }),
    ).toBe('Kéztorna otthon')
  })

  it('a kiegészítésben nincs kvirtmínusz (§3.1.1)', () => {
    const context = courseCtaContext({
      status: 'in-progress',
      title: 'Kéztorna otthon',
      resumeLessonTitle: 'Csuklóhajlítás alapjai',
    })
    expect(context.includes(String.fromCharCode(0x2014))).toBe(false)
  })
})

describe('courseMetaLine — a mikro-meta sor', () => {
  it('lecke-szám ÉS hátralévő idő', () => {
    expect(
      courseMetaLine({
        status: 'in-progress',
        completedLessons: 12,
        totalLessons: 18,
        remainingSec: 42 * 60,
      }),
    ).toBe('12/18 lecke · kb. 42 perc van hátra')
  })

  it('idő-adat nélkül CSAK a lecke-szám', () => {
    expect(
      courseMetaLine({
        status: 'in-progress',
        completedLessons: 12,
        totalLessons: 18,
        remainingSec: null,
      }),
    ).toBe('12/18 lecke')
  })

  it('lejárt hozzáférésnél a haladás nem releváns, csak a kurzus mérete', () => {
    expect(
      courseMetaLine({ status: 'expired', completedLessons: 2, totalLessons: 18, remainingSec: null }),
    ).toBe('18 lecke')
  })

  it('tananyag nélkül nem írunk „0/0 lecké"-t', () => {
    expect(
      courseMetaLine({ status: 'not-started', completedLessons: 0, totalLessons: 0, remainingSec: null }),
    ).toBe(NO_LESSONS_LABEL)
  })
})

describe('buildCourseCardView — a kész kártya-nézet', () => {
  it('folyamatban lévő kurzus: haladás, felirat és meta EGYÜTT stimmel', () => {
    const view = card({ watched: ['lecke-1'] })

    expect(view.status).toBe('in-progress')
    expect(view.completedLessons).toBe(1)
    expect(view.totalLessons).toBe(3)
    expect(view.percent).toBe(33)
    expect(view.showProgress).toBe(true)
    expect(view.metaLine).toBe('1/3 lecke · kb. 42 perc van hátra')
    expect(view.ctaLabel).toBe(ctaLabel('course-continue'))
    expect(view.ctaContext).toBe('Otthoni KézRehab, következő lecke: Csuklóhajlítás alapjai')
    expect(view.progressValueText).toBe('1/3 lecke kész')
  })

  it('befejezett kurzus: 100%, §3.2 #29 felirat, hátralévő idő nélkül', () => {
    const view = card({ watched: MINDEN_LECKE })

    expect(view.status).toBe('completed')
    expect(view.percent).toBe(100)
    expect(view.metaLine).toBe('3/3 lecke')
    expect(view.ctaLabel).toBe(ctaLabel('course-rewatch'))
  })

  it('lejárt hozzáférés: nincs haladás-rajz, a felirat a kurzusoldalra visz', () => {
    const view = card({ hasAccess: false, watched: ['lecke-1'] })

    expect(view.status).toBe('expired')
    expect(view.showProgress).toBe(false)
    expect(view.ctaLabel).toBe(ctaLabel('course-sales-open'))
    expect(view.href).toBe('/kurzusok/42')
  })

  it('tananyag nélküli kurzus nem oszt nullával', () => {
    const view = card({ product: URES_KURZUS })

    expect(view.totalLessons).toBe(0)
    expect(view.percent).toBe(0)
    expect(view.showProgress).toBe(false)
    expect(view.metaLine).toBe(NO_LESSONS_LABEL)
  })
})

describe('groupCourseCards — csoportosítás és sorrend', () => {
  const folyamatban = { ...card({ watched: ['lecke-1'] }), productId: 1 }
  const folyamatban2 = { ...card({ watched: ['lecke-1'] }), productId: 2 }
  const elNemKezdett = { ...card(), productId: 3 }
  const befejezett = { ...card({ watched: MINDEN_LECKE }), productId: 4 }
  const lejart = { ...card({ hasAccess: false }), productId: 5 }

  it('a folyamatban lévők ELÖL, utánuk az el nem kezdettek', () => {
    const groups = groupCourseCards([elNemKezdett, folyamatban])
    expect(groups.current.map((entry) => entry.productId)).toEqual([1, 3])
  })

  it('a befejezettek és a lejártak külön csoportba kerülnek', () => {
    const groups = groupCourseCards([befejezett, folyamatban, lejart, elNemKezdett])

    expect(groups.current.map((entry) => entry.productId)).toEqual([1, 3])
    expect(groups.completed.map((entry) => entry.productId)).toEqual([4])
    expect(groups.expired.map((entry) => entry.productId)).toEqual([5])
  })

  it('a csoportokon BELÜL a bejövő sorrend marad (stabil rendezés)', () => {
    const groups = groupCourseCards([folyamatban2, folyamatban])
    expect(groups.current.map((entry) => entry.productId)).toEqual([2, 1])
  })

  it('üres bemenet → üres csoportok', () => {
    expect(groupCourseCards([])).toEqual({ current: [], completed: [], expired: [] })
  })
})

describe('courseListSummary — a fejléc összefoglaló sora', () => {
  it('egyetlen kurzusnál elmarad', () => {
    expect(courseListSummary([card()])).toBeNull()
  })

  it('a nem nulla szakaszokat sorolja fel', () => {
    const summary = courseListSummary([
      card({ watched: ['lecke-1'] }),
      card({ watched: MINDEN_LECKE }),
      card(),
    ])
    expect(summary).toBe('3 kurzus · 1 folyamatban · 1 befejezve')
  })

  it('a lejárt hozzáférés is megjelenik, a nulla darabszámú szakaszok nem', () => {
    const summary = courseListSummary([card(), card({ hasAccess: false })])
    expect(summary).toBe('2 kurzus · 1 lejárt')
  })
})

/** A renderelt kimenet `href` értékei — a fókuszrend ellenőrzéséhez. */
function hrefValues(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1])
}

function render(cards: CourseCardView[]): string {
  return renderToStaticMarkup(createElement(CourseList, { cards }))
}

describe('CourseList — megjelenítés', () => {
  it('üres állapot: barátságos szöveg + link a kurzusokra', () => {
    const html = render([])

    expect(html).toContain('Itt jelennek meg a kurzusaid')
    expect(html).toContain(ctaLabel('course-list-open'))
    expect(hrefValues(html)).toContain('/kurzusok')
  })

  it('kártyánként PONTOSAN egy fókuszálható elem van (nincs duplikált tabstop)', () => {
    const html = render([card({ watched: ['lecke-1'] })])

    expect(hrefValues(html)).toEqual(['/kurzusaim/42'])
    // A kép nem link, tehát nincs szükség tabindex-trükkre sem.
    expect(html).not.toContain('tabindex')
    expect(html).not.toContain('<button')
  })

  it('a gomb akadálymentes neve tartalmazza a kurzus ÉS a következő lecke nevét is', () => {
    const html = render([card({ watched: ['lecke-1'] })])

    // A LÁTHATÓ felirat a szótári alak; a megkülönböztetés (melyik kurzus,
    // melyik lecke) rejtett szövegben él — §3.2 #17 minta, WCAG 2.2 · 2.5.3
    // (a hozzáférhető név a látható felirattal KEZDŐDIK).
    expect(html).toContain(ctaLabel('course-continue'))
    expect(html).toContain('kc-visually-hidden')
    expect(html).toContain(': Otthoni KézRehab, következő lecke: Csuklóhajlítás alapjai')
  })

  it('a haladás szövegesen IS ott van (a kör dekoratív)', () => {
    const html = render([card({ watched: ['lecke-1'] })])

    expect(html).toContain('1/3 lecke · kb. 42 perc van hátra')
    expect(html).toContain('aria-valuetext="1/3 lecke kész"')
  })

  it('A1: látszik a lejárati dátum, ha van', () => {
    const html = render([card({ expiryLabel: 'Hozzáférés eddig: 2027. 03. 04.' })])

    expect(html).toContain('Hozzáférés eddig: 2027. 03. 04.')
    expect(hrefValues(html)).toContain('/kurzusaim/42')
  })

  it('A1: korlátlan hozzáférésnél nincs lejárati sor', () => {
    expect(render([card()])).not.toContain('Hozzáférés eddig')
  })

  it('A1: lejárt hozzáférésnél empatikus üzenet + a NYILVÁNOS kurzusoldal linkje', () => {
    const uzenet = accessExpiredMessage(new Date('2027-03-04T12:00:00.000Z'))
    const html = render([card({ hasAccess: false, expiredMessage: uzenet })])

    expect(html).toContain(ACCESS_EXPIRED_TITLE)
    expect(html).toContain('2027. 03. 04.')
    expect(hrefValues(html)).toEqual(['/kurzusok/42'])
    expect(html).not.toContain('/kurzusaim/42')
  })

  it('a befejezettek összecsukott szekcióban, darabszámmal állnak', () => {
    const html = render([
      card({ watched: ['lecke-1'] }),
      { ...card({ watched: MINDEN_LECKE }), productId: 43 },
    ])

    expect(html).toContain('<details')
    expect(html).toContain('Befejezett kurzusok (1)')
    // A `<details>` alapból CSUKVA nyílik meg — nincs `open` jelző. A code
    // review fogta meg a korábbi őrt: egy pontos-substring assert csak az
    // attribútumok AKKORI sorrendjénél fogott volna, tehát az `open`
    // visszakerülése más prop-sorrenddel némán átcsúszik rajta. Ezért a teszt
    // a TAG-eket vizsgálja: egyik <details> nyitótag sem tartalmazhat `open`-t.
    const detailsTagek = html.match(/<details\b[^>]*>/g) ?? []
    expect(detailsTagek.length).toBeGreaterThan(0)
    for (const tag of detailsTagek) {
      expect(tag).not.toMatch(/\bopen\b/)
    }
  })

  it('a lejárt hozzáférésűek saját, megnevezett szekcióba kerülnek', () => {
    const html = render([card(), { ...card({ hasAccess: false }), productId: 43 }])

    expect(html).toContain('Lejárt hozzáférésű kurzusok')
    expect(html).toContain('aria-labelledby="kc-mycourses-expired"')
  })
})
