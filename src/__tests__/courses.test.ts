import { describe, expect, it, vi } from 'vitest'

import {
  ARCHIVED_COURSE_NOTE,
  CHECKOUT_PATH,
  MY_COURSES_PATH,
  UNAVAILABLE_COURSE_NOTE,
  checkoutHref,
  collectCourseCategories,
  coursePriceHuf,
  coursePriceLabel,
  coursePriceBadgeKind,
  courseTitle,
  filterCoursesByCategory,
  hasUnsetPriceFlag,
  hasUserPurchased,
  isFreeCourse,
  isPaidCourse,
  parseCourseIdParam,
  reportUnpricedPublishedCourses,
  resolveCategoryFilter,
  resolveCourseCta,
  unpricedPublishedCourseIds,
  myCoursePlayerHref,
  isMyCoursePlayerHref,
  isMyCoursePlayerUrl,
  postAuthLibraryOrPlayerHref,
  productIdsFromOrderItems,
  purchaseIdsFrom,
} from '../lib/courses'
import { COURSE_CTA_ANCHOR, courseCtaHref } from '../lib/course-url'
import { ctaLabel } from '../lib/cta-vocabulary'
import type { Category, Product } from '../payload-types'

const NBSP = '\u00a0'

/** Minimális kategória-fixture (a products.category populate-olt alakja). */
function category(id: number, slug: string, title: string): Category {
  return { id, slug, title } as Category
}

const otthoni = category(1, 'otthoni', 'Otthoni gyakorlóprogram')
const szakmai = category(2, 'szakmai', 'Szakmai továbbképzés')

function product(
  id: number,
  cat: Category | number,
  overrides: Partial<Product> = {},
): Pick<Product, 'id' | 'category' | 'status' | 'sku' | 'priceInHUF' | 'priceInHUFEnabled'> {
  return {
    id,
    category: cat,
    status: 'published',
    sku: `KURZUS-${id}`,
    priceInHUFEnabled: true,
    priceInHUF: 19990,
    ...overrides,
  }
}

describe('kurzuslista kategória-szűrés', () => {
  const products = [
    product(1, otthoni),
    product(2, szakmai),
    product(3, otthoni),
    product(4, 99), // nem populate-olt (nyers id) — védekező ág
  ]

  it('szűrés nélkül (null) minden terméket visszaad', () => {
    expect(filterCoursesByCategory(products, null)).toHaveLength(4)
  })

  it('otthoni szűrés csak az otthoni kategóriájúakat adja', () => {
    const result = filterCoursesByCategory(products, 'otthoni')
    expect(result.map((p) => p.id)).toEqual([1, 3])
  })

  it('szakmai szűrés a szakmai kategóriát adja', () => {
    const result = filterCoursesByCategory(products, 'szakmai')
    expect(result.map((p) => p.id)).toEqual([2])
  })

  it('a nem populate-olt kategória slug-szűrésnél kiesik', () => {
    const result = filterCoursesByCategory(products, 'otthoni')
    expect(result.some((p) => p.id === 4)).toBe(false)
  })

  it('a szűrő-chipek a listában ténylegesen előforduló kategóriák, magyar ábécé-sorrendben', () => {
    const categories = collectCourseCategories(products)
    expect(categories.map((c) => c.slug)).toEqual(['otthoni', 'szakmai'])
    // a nyers id-s (nem populate-olt) kategória nem kerül chipnek
    expect(categories.some((c) => c.id === 99)).toBe(false)
  })

  it('a query-param csak ismert kategória-slug lehet, egyébként szűretlen (null)', () => {
    const categories = collectCourseCategories(products)
    expect(resolveCategoryFilter('otthoni', categories)).toBe('otthoni')
    expect(resolveCategoryFilter('nemletezo', categories)).toBeNull()
    expect(resolveCategoryFilter('', categories)).toBeNull()
    expect(resolveCategoryFilter(undefined, categories)).toBeNull()
    expect(resolveCategoryFilter(['szakmai', 'otthoni'], categories)).toBe('szakmai')
  })
})

describe('archived kurzus CTA-ja', () => {
  it('archived + nem vevő: a CTA inaktív, href nélkül, „nem vásárolható" jelöléssel', () => {
    const cta = resolveCourseCta(
      { id: 7, status: 'archived', priceInHUF: 19990, priceInHUFEnabled: true },
      false,
    )
    expect(cta.kind).toBe('archived')
    expect(cta.disabled).toBe(true)
    expect(cta.href).toBeNull()
    expect(cta.note).toBe(ARCHIVED_COURSE_NOTE)
    // A mondat a §3.2 #16 jóváhagyott alakjával KEZDŐDIK, és — NN/g,
    // Error-Message Guidelines („Merely stating the problem is also not enough;
    // offer some potential remedies") — továbblépést is kínál. A korábbi
    // egymondatos szöveg zsákutca volt: gomb sincs az oldalon (Á-3).
    expect(cta.note).toBe(
      'Ez a kurzus jelenleg nem vásárolható meg. Nézd meg a többi kurzusunkat, vagy írj nekünk, ha kérdésed van.',
    )
    expect(cta.note?.startsWith(ctaLabel('course-unavailable-notice'))).toBe(true)
    // Á-3 (docs/ui-sztenderdek.md): letiltott gomb helyett NINCS gomb — a
    // felirat hiánya teszi szerkezetileg lehetetlenné a hamis ígéretet.
    expect(cta.label).toBeNull()
  })

  it('archived + vevő: a meglévő vevő tovább nézi — §3.2 #9 link', () => {
    const cta = resolveCourseCta(
      { id: 7, status: 'archived', priceInHUF: 19990, priceInHUFEnabled: true },
      true,
    )
    expect(cta.kind).toBe('purchased')
    expect(cta.disabled).toBe(false)
    expect(cta.href).toBe(myCoursePlayerHref(7))
    expect(cta.label).toBe(ctaLabel('course-start'))
  })

  it('draft + nem vevő: inaktív védekező ág (a nyilvános route amúgy 404)', () => {
    const cta = resolveCourseCta(
      { id: 7, status: 'draft', priceInHUF: 19990, priceInHUFEnabled: true },
      false,
    )
    expect(cta.kind).toBe('unavailable')
    expect(cta.disabled).toBe(true)
    expect(cta.href).toBeNull()
    expect(cta.label).toBeNull()
    expect(cta.note).toBe(UNAVAILABLE_COURSE_NOTE)
  })
})

describe('ingyenes kurzus (free kind)', () => {
  it('published + ingyenes + nem vevő: §3.2 #3 felirat, a KURZUS igénylő űrlapjához', () => {
    const cta = resolveCourseCta(
      {
        id: 10,
        slug: 'sos-kezrelax',
        status: 'published',
        priceInHUF: null,
        priceInHUFEnabled: false,
      },
      false,
    )
    expect(cta.kind).toBe('free')
    expect(cta.label).toBe(ctaLabel('free-course-claim'))
    // Az ág korábban a `/kurzusaim`-ra vitt. Be nem jelentkezett látogatónak ez
    // zsákutca volt: fiókja nincs, a lista bejelentkezést kér, a kurzushoz sosem
    // jut hozzá. A kurzusoldal `ctaSlot`-tal megkerülte, de BÁRMELY új hívó
    // előhozta volna a régi viselkedést. A cél mostantól a kurzus saját oldalán
    // álló igénylő űrlap horgonya.
    expect(cta.href).toBe(courseCtaHref({ id: 10, slug: 'sos-kezrelax' }))
    expect(cta.href).toBe(`/kurzusok/sos-kezrelax#${COURSE_CTA_ANCHOR}`)
    expect(cta.href).not.toBe(MY_COURSES_PATH)
    expect(cta.href).not.toContain(CHECKOUT_PATH)
    expect(cta.disabled).toBe(false)
  })

  it('slug nélküli ingyenes kurzuson is a MŰKÖDŐ, id-alapú kurzus-URL-re mutat', () => {
    const cta = resolveCourseCta(
      { id: 10, status: 'published', priceInHUF: null, priceInHUFEnabled: false },
      false,
    )
    expect(cta.href).toBe(`/kurzusok/10#${COURSE_CTA_ANCHOR}`)
  })

  it('published + ingyenes + vevő: a purchased ág él (a meglévő vevő is a kurzusaimra megy)', () => {
    const cta = resolveCourseCta(
      { id: 10, status: 'published', priceInHUF: null, priceInHUFEnabled: false },
      true,
    )
    expect(cta.kind).toBe('purchased')
  })

  it('published + fizetős + nem vevő: a buy ág él változatlanul (checkout)', () => {
    const cta = resolveCourseCta(
      { id: 10, status: 'published', priceInHUF: 19990, priceInHUFEnabled: true },
      false,
    )
    expect(cta.kind).toBe('buy')
    expect(cta.href).toContain(CHECKOUT_PATH)
  })
})

describe('„már megvetted" ág', () => {
  it('nyers id-ket és populate-olt termékeket egyaránt felismer', () => {
    expect(hasUserPurchased([1, 2, 3], 2)).toBe(true)
    expect(hasUserPurchased([{ id: 5 }], 5)).toBe(true)
    expect(hasUserPurchased([{ id: 5 }], 6)).toBe(false)
    expect(hasUserPurchased([], 1)).toBe(false)
    expect(hasUserPurchased(null, 1)).toBe(false)
    expect(hasUserPurchased(undefined, 1)).toBe(false)
  })

  it('a nyers id-ket és a populate-olt relációkat egyaránt kinyeri', () => {
    expect(purchaseIdsFrom([1, 2, { id: 3 }])).toEqual([1, 2, 3])
    expect(purchaseIdsFrom(null)).toEqual([])
    expect(purchaseIdsFrom(undefined)).toEqual([])
    expect(purchaseIdsFrom([])).toEqual([])
  })

  it('vevőnél a CTA a kurzusaimra mutat (checkout helyett), bármilyen státusznál', () => {
    for (const status of ['published', 'archived', 'draft'] as const) {
      const cta = resolveCourseCta(
        { id: 3, status, priceInHUF: 19990, priceInHUFEnabled: true },
        true,
      )
      expect(cta.kind).toBe('purchased')
      expect(cta.href).toBe(myCoursePlayerHref(3))
      expect(cta.disabled).toBe(false)
    }
  })

  it('published + nem vevő: §3.2 #1 felirat, a checkout-flowba visz (termek query-param)', () => {
    const cta = resolveCourseCta(
      { id: 42, status: 'published', priceInHUF: 19990, priceInHUFEnabled: true },
      false,
    )
    expect(cta.kind).toBe('buy')
    expect(cta.label).toBe(ctaLabel('course-buy'))
    expect(cta.href).toBe(`${CHECKOUT_PATH}?termek=42`)
    expect(cta.href).toBe(checkoutHref(42))
  })
})

describe('ár-formázás (Ft, ezres tagolás)', () => {
  it('bruttó egész forint, ezres tagolással, nem-törhető szóközzel', () => {
    expect(coursePriceLabel({ priceInHUFEnabled: true, priceInHUF: 19990 })).toBe(
      `19${NBSP}990${NBSP}Ft`,
    )
    expect(coursePriceLabel({ priceInHUFEnabled: true, priceInHUF: 1290000 })).toBe(
      `1${NBSP}290${NBSP}000${NBSP}Ft`,
    )
  })

  it('ár nélküli/letiltott árú termékre null (a kártya ilyenkor nem mutat árat)', () => {
    expect(coursePriceLabel({ priceInHUFEnabled: false, priceInHUF: 19990 })).toBeNull()
    expect(coursePriceLabel({ priceInHUFEnabled: true, priceInHUF: null })).toBeNull()
    expect(coursePriceHuf({ priceInHUFEnabled: true, priceInHUF: 19990 })).toBe(19990)
  })
})

describe('coursePriceHuf — akciós ár az időablakban, rendes ár azon kívül (WP63)', () => {
  const regular = { priceInHUFEnabled: true, priceInHUF: 79500 }
  const promo = {
    ...regular,
    promoEnabled: true,
    promoStart: '2026-09-01T12:00:00.000Z',
    promoEnd: '2026-09-30T12:00:00.000Z',
    promoPriceHuf: 39500,
  }
  const inWindow = new Date('2026-09-20T10:00:00.000Z')
  const beforeWindow = new Date('2026-08-31T21:59:59.999Z')
  const afterWindow = new Date('2026-09-30T22:00:00.000Z')

  it('az időablakban az akciós ár, előtte és utána magától a rendes ár', () => {
    expect(coursePriceHuf(promo, inWindow)).toBe(39500)
    expect(coursePriceHuf(promo, beforeWindow)).toBe(79500)
    expect(coursePriceHuf(promo, afterWindow)).toBe(79500)
    expect(coursePriceLabel(promo, inWindow)).toBe(`39${NBSP}500${NBSP}Ft`)
    expect(coursePriceLabel(promo, afterWindow)).toBe(`79${NBSP}500${NBSP}Ft`)
  })

  it('kikapcsolt pipa vagy hiányzó promo-mezők: a rendes ár', () => {
    expect(coursePriceHuf({ ...promo, promoEnabled: false }, inWindow)).toBe(79500)
    expect(coursePriceHuf(regular, inWindow)).toBe(79500)
    expect(coursePriceHuf({ ...promo, promoPriceHuf: null }, inWindow)).toBe(79500)
  })

  it('az akciós ár csak akkor ár, ha kisebb a rendes árnál', () => {
    expect(coursePriceHuf({ ...promo, promoPriceHuf: 79500 }, inWindow)).toBe(79500)
    expect(coursePriceHuf({ ...promo, promoPriceHuf: 99000 }, inWindow)).toBe(79500)
    expect(coursePriceHuf({ ...promo, promoPriceHuf: 0 }, inWindow)).toBe(79500)
  })

  it('ingyenes vagy ár nélküli kurzuson akciós ár mellett sincs fizetendő ár', () => {
    expect(coursePriceHuf({ ...promo, priceInHUFEnabled: false }, inWindow)).toBeNull()
    expect(coursePriceHuf({ ...promo, priceInHUF: null }, inWindow)).toBeNull()
    expect(coursePriceBadgeKind({ ...promo, priceInHUFEnabled: false }, inWindow)).toBe('free')
    expect(coursePriceBadgeKind({ ...promo, priceInHUF: null }, inWindow)).toBe('none')
  })

  it('a fizetős halmaz és az ár-címke az akciós árral is egyezik', () => {
    expect(isPaidCourse(promo, inWindow)).toBe(true)
    expect(isPaidCourse(promo, afterWindow)).toBe(true)
    expect(coursePriceBadgeKind(promo, inWindow)).toBe('price')
  })
})

describe('coursePriceBadgeKind — a kurzusoldal ár-címkéje (Ingyenes/Megveszem finding)', () => {
  it('érvényes ár → price (a PriceTag látszik)', () => {
    expect(coursePriceBadgeKind({ priceInHUFEnabled: true, priceInHUF: 19990 })).toBe('price')
  })

  it('0 Ft NEM ár-címke és NEM „Ingyenes": hiányos konfiguráció (none)', () => {
    // A „0 Ft" kiírása a „Megveszem" mellett azt ígérné, hogy ingyen
    // megkapod, miközben a checkout-kapu elutasít. Az ingyenességnek külön,
    // Barion nélküli útja van (priceInHUFEnabled: false).
    expect(coursePriceBadgeKind({ priceInHUFEnabled: true, priceInHUF: 0 })).toBe('none')
  })

  it('tudatosan ingyenes (priceInHUFEnabled: false) → free („Ingyenes" címke)', () => {
    expect(coursePriceBadgeKind({ priceInHUFEnabled: false, priceInHUF: null })).toBe('free')
    expect(coursePriceBadgeKind({ priceInHUFEnabled: false, priceInHUF: 19990 })).toBe('free')
  })

  it('HIBÁS konfiguráció (ár-pipa BE, ár ÜRES) → none: NEM „Ingyenes" a Megveszem mellett', () => {
    expect(coursePriceBadgeKind({ priceInHUFEnabled: true, priceInHUF: null })).toBe('none')
    expect(coursePriceBadgeKind({ priceInHUFEnabled: true, priceInHUF: undefined })).toBe('none')
    // A pipa nélküli, ár nélküli (legacy/hiányzó mező) rekord sem „Ingyenes" —
    // a resolveCourseCta-val konzisztensem az sem a free ág.
    expect(coursePriceBadgeKind({ priceInHUFEnabled: undefined, priceInHUF: null })).toBe('none')
  })
})

/**
 * A hiba, amit bezár: ugyanez a kérdés három helyen, HÁROMFÉLEKÉPP dőlt el. A
 * hozzáférés-adó lekérdezés a beállítatlan (NULL) ár-pipát is ingyenesnek vette
 * és minden belépőnek kiosztotta a kurzust, a gomb-felirat és az ár-címke
 * viszont szigorú `=== false`-t használt — a látogató „Megveszem" gombot látott
 * egy olyan kurzuson, amit közben mindenki ingyen megkapott.
 */
describe('isFreeCourse — SZIGORÚ ingyenes-szabály', () => {
  it('ingyenes KIZÁRÓLAG a tudatosan kivett ár-pipa (=== false)', () => {
    expect(isFreeCourse({ priceInHUFEnabled: false })).toBe(true)
  })

  it('a BEÁLLÍTATLAN (null/undefined) ár-pipa NEM ingyenes — hiányos konfiguráció', () => {
    // A régi, laza szabály (`!== true`) mindkettőre igazat adott volna.
    expect(isFreeCourse({ priceInHUFEnabled: null })).toBe(false)
    expect(isFreeCourse({ priceInHUFEnabled: undefined })).toBe(false)
  })

  it('a bepipált ár-pipa sosem ingyenes', () => {
    expect(isFreeCourse({ priceInHUFEnabled: true })).toBe(false)
  })

  it('a gomb-logika, az ár-címke és a fizetős-szűrő UGYANAZT mondja minden bemenetre', () => {
    const inputs: Array<{
      priceInHUFEnabled: boolean | null | undefined
      priceInHUF: number | null
    }> = [
      { priceInHUFEnabled: false, priceInHUF: null },
      { priceInHUFEnabled: false, priceInHUF: 19990 },
      { priceInHUFEnabled: true, priceInHUF: 19990 },
      { priceInHUFEnabled: true, priceInHUF: null },
      { priceInHUFEnabled: null, priceInHUF: null },
      { priceInHUFEnabled: undefined, priceInHUF: null },
    ]
    for (const input of inputs) {
      const free = isFreeCourse(input)
      const cta = resolveCourseCta({ id: 1, status: 'published', ...input }, false)
      // (az `input` a priceInHUF-ot is hordozza, tehát a CTA az ÉRVÉNYES árat látja)
      // A CTA 'free' ága PONTOSAN akkor, amikor az igazságforrás ingyenesnek mondja.
      expect(cta.kind === 'free', JSON.stringify(input)).toBe(free)
      // Az ár-címke 'free' ága ugyanígy.
      expect(coursePriceBadgeKind(input) === 'free', JSON.stringify(input)).toBe(free)
      // Az ingyenes és a fizetős halmaz DISZJUNKT (a harmadik állapot a hibás konfig).
      expect(free && isPaidCourse(input)).toBe(false)
    }
  })

  it('a beállítatlan ár-pipájú, publikált termék NEM ingyenes ÉS nem is vásárolható', () => {
    // A tulajdonos gomb-hibájának pontos esete: se ingyenes, se érvényesen
    // árazott. A hozzáférés-adás sem osztja ki (free-course-grant.test.ts),
    // a felület pedig nem kínálja vásárlásra (gomb NINCS), és RIASZTÁS szól rá.
    const cta = resolveCourseCta(
      { id: 5, status: 'published', priceInHUF: null, priceInHUFEnabled: null },
      false,
    )
    expect(cta.kind).toBe('unavailable')
    expect(cta.label).toBeNull()
    expect(cta.href).toBeNull()
    expect(isFreeCourse({ priceInHUFEnabled: null })).toBe(false)
  })
})

/**
 * A tulajdonos által jelzett ÉLŐ hiba: a felület olyan vásárlást kínált, amit a
 * szerver garantáltan elutasít. A vevő végigment a pénztáron (számlázási adatok,
 * két jogszabályi nyilatkozat), és a beküldés 400-zal elhasalt:
 * „A termékhez nem tartozik érvényes ár, így nem vásárolható meg."
 * A szabály, amit ez a teszt rögzít:
 */
describe('a CTA sosem kínál olyan vásárlást, amit a checkout elutasít', () => {
  /**
   * A checkout-kapu ár-feltétele — NEM másolat, hanem UGYANAZ a függvény.
   *
   * Korábban itt a feltétel kézzel átírt mása állt, és pontosan az történt,
   * amitől egy másolat mindig szenved: a kapu szigorodott (a 0 Ft-os és a
   * negatív ár is elutasítandó lett), a másolat viszont nem követte, így ez a
   * teszt zölden HAZUDOTT a `{true, 0}` soron. Azóta az `assertPurchasable`
   * maga is a `coursePriceHuf`-ot hívja, tehát a paritás nem véleményen,
   * hanem közös implementáción nyugszik.
   */
  const checkoutWouldReject = (input: {
    status: string
    priceInHUFEnabled: boolean | null | undefined
    priceInHUF: number | null | undefined
  }): boolean => input.status !== 'published' || coursePriceHuf(input) === null

  const flags: Array<boolean | null | undefined> = [true, false, null, undefined]
  const prices: Array<number | null | undefined> = [19990, 0, null, undefined]

  it('published termékre: kind === "buy" pontosan akkor, amikor a checkout-kapu átengedné', () => {
    for (const priceInHUFEnabled of flags) {
      for (const priceInHUF of prices) {
        const input = { status: 'published' as const, priceInHUFEnabled, priceInHUF }
        const cta = resolveCourseCta({ id: 1, ...input }, false)
        expect(cta.kind === 'buy', JSON.stringify(input)).toBe(!checkoutWouldReject(input))
      }
    }
  })

  it('nem publikált (draft/archived) termékre SOSEM buy', () => {
    for (const status of ['draft', 'archived'] as const) {
      for (const priceInHUFEnabled of flags) {
        for (const priceInHUF of prices) {
          const cta = resolveCourseCta({ id: 1, status, priceInHUFEnabled, priceInHUF }, false)
          expect(cta.kind, `${status}/${String(priceInHUFEnabled)}/${String(priceInHUF)}`).not.toBe(
            'buy',
          )
        }
      }
    }
  })

  it('ahol nincs vásárlás, ott NINCS gomb sem, de VAN magyarázó mondat (Á-3, §3.2 #16)', () => {
    for (const priceInHUFEnabled of flags) {
      for (const priceInHUF of prices) {
        const input = { status: 'published' as const, priceInHUFEnabled, priceInHUF }
        const cta = resolveCourseCta({ id: 1, ...input }, false)
        if (cta.kind === 'buy' || cta.kind === 'free') {
          expect(cta.label, JSON.stringify(input)).not.toBeNull()
          continue
        }
        // Nem cselekvő állapot: felirat NINCS, magyarázat VAN.
        expect(cta.label, JSON.stringify(input)).toBeNull()
        expect(cta.href, JSON.stringify(input)).toBeNull()
        expect(cta.note, JSON.stringify(input)).toBe(UNAVAILABLE_COURSE_NOTE)
      }
    }
  })

  it('a hiányos konfiguráció mindkét alakja az „unavailable" ágra fut', () => {
    // (a) ár-pipa BE, ár ÜRES; (b) ár-pipa BEÁLLÍTATLAN
    const misconfigured = [
      { priceInHUFEnabled: true, priceInHUF: null },
      { priceInHUFEnabled: true, priceInHUF: undefined },
      { priceInHUFEnabled: null, priceInHUF: null },
      { priceInHUFEnabled: undefined, priceInHUF: null },
    ]
    for (const input of misconfigured) {
      const cta = resolveCourseCta({ id: 5, status: 'published', ...input }, false)
      expect(cta.kind, JSON.stringify(input)).toBe('unavailable')
    }
  })

  it('a MEGVÁSÁROLT termék ága érintetlen: a vevő hiányos konfigurációnál is bejut', () => {
    // A hozzáférés már megvan; a hiányos ár-konfiguráció nem veheti el tőle.
    const cta = resolveCourseCta(
      { id: 5, status: 'published', priceInHUF: null, priceInHUFEnabled: null },
      true,
    )
    expect(cta.kind).toBe('purchased')
    expect(cta.href).toBe(myCoursePlayerHref(5))
  })
})

describe('a magyarázó mondatok szövege (skill 2. pont: natív magyar, gondolatjel nélkül)', () => {
  it.each([
    ['ARCHIVED_COURSE_NOTE', ARCHIVED_COURSE_NOTE],
    ['UNAVAILABLE_COURSE_NOTE', UNAVAILABLE_COURSE_NOTE],
  ])('%s nem tartalmaz gondolatjelet elválasztóként', (_label, note) => {
    expect(note).not.toMatch(/[–—]/)
  })

  it('az UNAVAILABLE_COURSE_NOTE megmondja, mi történt ÉS hogyan lehet tovább (GOV.UK-elv)', () => {
    expect(UNAVAILABLE_COURSE_NOTE).toContain('nem vásárolható meg')
    // Továbblépés: a zsákutca tilos (skill 5. pont).
    expect(UNAVAILABLE_COURSE_NOTE).toMatch(/Nézd meg a többi kurzusunkat|írj nekünk/)
  })
})

describe('isPaidCourse — a fizetős halmaz', () => {
  it('csak az érvényes árú termék fizetős', () => {
    expect(isPaidCourse({ priceInHUFEnabled: true, priceInHUF: 19990 })).toBe(true)
    // A 0 Ft NEM fizetős és nem is ingyenes: konfigurációs hiba. Ha „fizetős"
    // lenne, a felület „Megveszem" gombot adna rá, a checkout-kapu viszont
    // elutasítaná — a 0 Ft-ból valódi Barion-fizetés indulna nulláról.
    expect(isPaidCourse({ priceInHUFEnabled: true, priceInHUF: 0 })).toBe(false)
    expect(isPaidCourse({ priceInHUFEnabled: true, priceInHUF: -1 })).toBe(false)
    expect(isPaidCourse({ priceInHUFEnabled: true, priceInHUF: null })).toBe(false)
    expect(isPaidCourse({ priceInHUFEnabled: false, priceInHUF: 19990 })).toBe(false)
    expect(isPaidCourse({ priceInHUFEnabled: null, priceInHUF: null })).toBe(false)
  })

  it('a `!isPaidCourse` NEM ingyenes: a hibás konfiguráció egyik halmazba sem tartozik', () => {
    const broken = { priceInHUFEnabled: true, priceInHUF: null }
    expect(isPaidCourse(broken)).toBe(false)
    expect(isFreeCourse(broken)).toBe(false)
  })
})

describe('hiányos ár-konfiguráció felismerése és RIASZTÁS', () => {
  const products = [
    { id: 1, status: 'published', priceInHUFEnabled: null },
    { id: 2, status: 'published', priceInHUFEnabled: false },
    { id: 3, status: 'published', priceInHUFEnabled: true },
    // Draft: a látogató elé nem kerül, ezért nem riasztunk rá.
    { id: 4, status: 'draft', priceInHUFEnabled: null },
    { id: 5, status: 'published', priceInHUFEnabled: undefined },
  ] as Array<Pick<Product, 'id' | 'status' | 'priceInHUFEnabled'>>

  it('hasUnsetPriceFlag csak a se-be-se-ki állapotra igaz', () => {
    expect(hasUnsetPriceFlag({ priceInHUFEnabled: null })).toBe(true)
    expect(hasUnsetPriceFlag({ priceInHUFEnabled: undefined })).toBe(true)
    expect(hasUnsetPriceFlag({ priceInHUFEnabled: true })).toBe(false)
    expect(hasUnsetPriceFlag({ priceInHUFEnabled: false })).toBe(false)
  })

  it('csak a PUBLIKÁLT, beállítatlan ár-pipájú termékeket sorolja fel', () => {
    expect(unpricedPublishedCourseIds(products)).toEqual([1, 5])
  })

  it('RIASZTÁS: előtagú, error-szintű naplósor megy az érintett id-kkal', () => {
    const log = { error: vi.fn() }
    const ids = reportUnpricedPublishedCourses(products, log)

    expect(ids).toEqual([1, 5])
    expect(log.error).toHaveBeenCalledTimes(1)
    expect(log.error.mock.calls[0][0]).toMatch(/^RIASZTÁS:/)
    expect(log.error.mock.calls[0][1]).toEqual({ productIds: [1, 5] })
  })

  it('hibátlan kínálatnál NINCS naplósor (a riasztás nem zajong)', () => {
    const log = { error: vi.fn() }
    const ids = reportUnpricedPublishedCourses(
      [
        { id: 2, status: 'published', priceInHUFEnabled: false },
        { id: 3, status: 'published', priceInHUFEnabled: true },
      ] as Array<Pick<Product, 'id' | 'status' | 'priceInHUFEnabled'>>,
      log,
    )

    expect(ids).toEqual([])
    expect(log.error).not.toHaveBeenCalled()
  })
})

describe('kurzus URL- és címkezelés', () => {
  it('a [slug] szegmens a numerikus product id; minden más 404', () => {
    expect(parseCourseIdParam('7')).toBe(7)
    expect(parseCourseIdParam(' 12 ')).toBe(12)
    expect(parseCourseIdParam('abc')).toBeNull()
    expect(parseCourseIdParam('7x')).toBeNull()
    expect(parseCourseIdParam('-3')).toBeNull()
    expect(parseCourseIdParam('0')).toBeNull()
    expect(parseCourseIdParam('')).toBeNull()
    expect(parseCourseIdParam(undefined)).toBeNull()
  })

  it('a kurzus display-neve a displayTitle → sku lánc; hiányában azonosítós fallback', () => {
    expect(courseTitle({ id: 1, sku: 'Kézrehabilitáció otthon' })).toBe('Kézrehabilitáció otthon')
    expect(courseTitle({ id: 9, sku: '  ' })).toBe('Kurzus #9')
    expect(courseTitle({ id: 9, sku: null })).toBe('Kurzus #9')
  })

  it('a látogatónak szóló kurzuscím (displayTitle) megelőzi az azonosítót (sku)', () => {
    expect(courseTitle({ id: 1, sku: 'KURZUS-1', displayTitle: 'Kéztorna otthon' })).toBe(
      'Kéztorna otthon',
    )
    // Üres cím esetén a régi viselkedés marad — a sku a megjelenő név.
    expect(courseTitle({ id: 1, sku: 'KURZUS-1', displayTitle: '  ' })).toBe('KURZUS-1')
    expect(courseTitle({ id: 1, sku: 'KURZUS-1', displayTitle: null })).toBe('KURZUS-1')
  })
})

describe('lejátszó-útvonal és jelszó utáni cél', () => {
  it('isMyCoursePlayerHref csak a numerikus lejátszó-útra igaz', () => {
    expect(isMyCoursePlayerHref('/kurzusaim/12')).toBe(true)
    expect(isMyCoursePlayerHref('/kurzusaim')).toBe(false)
    expect(isMyCoursePlayerHref('/kurzusaim/12/extra')).toBe(false)
    expect(isMyCoursePlayerHref('/kurzusok/12')).toBe(false)
  })

  it('isMyCoursePlayerUrl relatív és abszolút címet is felismer', () => {
    expect(isMyCoursePlayerUrl('https://kineticare.test/kurzusaim/12')).toBe(true)
    expect(isMyCoursePlayerUrl('https://kineticare.test/kurzusaim/12?x=1')).toBe(true)
    expect(isMyCoursePlayerUrl('https://kineticare.test/kurzusaim')).toBe(false)
  })

  it('egy SKU a lejátszóra visz, több vagy nulla a listára', () => {
    expect(postAuthLibraryOrPlayerHref([7])).toBe('/kurzusaim/7')
    expect(postAuthLibraryOrPlayerHref([7, 8])).toBe(MY_COURSES_PATH)
    expect(postAuthLibraryOrPlayerHref([])).toBe(MY_COURSES_PATH)
  })

  it('productIdsFromOrderItems id-t és populate-olt docot is vesz', () => {
    expect(
      productIdsFromOrderItems([{ product: 3 }, { product: { id: 3 } }, { product: 9 }]),
    ).toEqual([3, 9])
    expect(productIdsFromOrderItems(null)).toEqual([])
    expect(productIdsFromOrderItems([{ product: null }])).toEqual([])
  })
})
