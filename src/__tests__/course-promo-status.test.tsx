import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * „Az akció állapota” doboz (src/components/admin/CoursePromoStatus.tsx) őre,
 * a menu-unlisted-link.test.tsx mintájára: DOM nélkül, `renderToStaticMarkup`
 * adja a nézetet, a Payload `useFormFields` hookot mockoljuk. Hálózat nincs;
 * a `fetch` hangosan dob (CLAUDE.md, 15. üzemeltetési tanulság).
 */

const formFields: Record<string, { value: unknown }> = {}

vi.mock('@payloadcms/ui', () => ({
  useFormFields: (selector: (state: [Record<string, { value: unknown }>]) => unknown) =>
    selector([formFields]),
}))

vi.stubGlobal('fetch', () => {
  throw new Error('A tesztből SOSEM mehet ki valódi hálózati hívás.')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const {
  CoursePromoStatus,
  CoursePromoStatusView,
  NO_PRICE_WARNING,
  NOT_PUBLISHED_WARNING,
  ORIGINAL_PRICE_WARNING,
  PROMO_OFF_MESSAGE,
  deriveCoursePromoStatus,
  withDaySuffix,
} = await import('../components/admin/CoursePromoStatus')

const base = {
  priceInHUF: 19_900,
  priceInHUFEnabled: true,
  promoOriginalPriceHuf: null,
  status: 'published',
}
const NOW = new Date('2026-09-20T10:00:00Z')

describe('withDaySuffix: a keltezés ragja hangrend szerint', () => {
  it('-án/-én, -tól/-től, -ig; az elseje kivétel', () => {
    expect(withDaySuffix('szeptember 30', 'an')).toBe('szeptember 30-án')
    expect(withDaySuffix('szeptember 30', 'ig')).toBe('szeptember 30-ig')
    expect(withDaySuffix('szeptember 30', 'tol')).toBe('szeptember 30-tól')
    expect(withDaySuffix('október 1', 'tol')).toBe('október 1-jétől')
    expect(withDaySuffix('október 1', 'an')).toBe('október 1-jén')
    expect(withDaySuffix('október 1', 'ig')).toBe('október 1-jéig')
    expect(withDaySuffix('május 5', 'an')).toBe('május 5-én')
    expect(withDaySuffix('május 5', 'tol')).toBe('május 5-től')
    expect(withDaySuffix('május 23', 'an')).toBe('május 23-án')
  })
})

describe('deriveCoursePromoStatus: a négy állapot szövege', () => {
  it('kikapcsolva', () => {
    expect(
      deriveCoursePromoStatus(
        { ...base, promoEnabled: false, promoStart: null, promoEnd: null },
        NOW,
      ),
    ).toEqual({ message: PROMO_OFF_MESSAGE, warning: null, reason: 'kikapcsolva' })
  })

  it('most él, véggel és vég nélkül', () => {
    expect(
      deriveCoursePromoStatus(
        { ...base, promoEnabled: true, promoStart: null, promoEnd: '2026-09-30T12:00:00.000Z' },
        NOW,
      ).message,
    ).toBe('Az akció most él (szeptember 30-ig).')
    expect(
      deriveCoursePromoStatus(
        { ...base, promoEnabled: true, promoStart: null, promoEnd: null },
        NOW,
      ).message,
    ).toBe('Az akció most él, és nincs megadva a vége.')
  })

  it('még nem kezdődött el', () => {
    expect(
      deriveCoursePromoStatus(
        { ...base, promoEnabled: true, promoStart: '2026-10-01T12:00:00.000Z', promoEnd: null },
        NOW,
      ).message,
    ).toBe('Az akció még nem kezdődött el (október 1-jétől).')
  })

  it('lejárt', () => {
    expect(
      deriveCoursePromoStatus(
        { ...base, promoEnabled: true, promoStart: null, promoEnd: '2026-09-30T12:00:00.000Z' },
        new Date('2026-10-05T10:00:00Z'),
      ),
    ).toEqual({ message: 'Az akció lejárt (szeptember 30-án).', warning: null, reason: 'lejart' })
  })

  it('figyelmeztet, ha az eredeti ár nem nagyobb a mostani árnál', () => {
    const on = { promoEnabled: true, promoStart: null, promoEnd: null }
    expect(
      deriveCoursePromoStatus({ ...base, ...on, promoOriginalPriceHuf: 19_900 }, NOW).warning,
    ).toBe(ORIGINAL_PRICE_WARNING)
    expect(
      deriveCoursePromoStatus({ ...base, ...on, promoOriginalPriceHuf: 24_900 }, NOW).warning,
    ).toBeNull()
    expect(deriveCoursePromoStatus({ ...base, ...on }, NOW).warning).toBeNull()
  })

  it('archivált vagy piszkozat kurzuson a doboz kimondja, hogy az akció nem jelenik meg', () => {
    const on = { promoEnabled: true, promoStart: null, promoEnd: null }
    expect(deriveCoursePromoStatus({ ...base, ...on, status: 'archived' }, NOW).warning).toBe(
      NOT_PUBLISHED_WARNING,
    )
    expect(deriveCoursePromoStatus({ ...base, ...on, status: 'draft' }, NOW).warning).toBe(
      NOT_PUBLISHED_WARNING,
    )
    expect(deriveCoursePromoStatus({ ...base, ...on, status: 'published' }, NOW).warning).toBeNull()
    expect(deriveCoursePromoStatus({ ...base, ...on, status: null }, NOW).warning).toBe(
      NOT_PUBLISHED_WARNING,
    )
    expect(deriveCoursePromoStatus({ ...base, ...on, status: undefined }, NOW).warning).toBe(
      NOT_PUBLISHED_WARNING,
    )
    expect(
      deriveCoursePromoStatus({ ...base, ...on, status: 'published', _status: 'draft' }, NOW)
        .warning,
    ).toBe(NOT_PUBLISHED_WARNING)
    expect(
      deriveCoursePromoStatus({ ...base, ...on, status: 'published', _status: 'published' }, NOW)
        .warning,
    ).toBeNull()
  })

  it('ingyenes vagy ár nélküli kurzuson a pipa hatástalan, és ezt a doboz kimondja', () => {
    const on = { promoEnabled: true, promoStart: null, promoEnd: null }
    expect(deriveCoursePromoStatus({ ...base, ...on, priceInHUFEnabled: false }, NOW).warning).toBe(
      NO_PRICE_WARNING,
    )
    expect(deriveCoursePromoStatus({ ...base, ...on, priceInHUF: null }, NOW).warning).toBe(
      NO_PRICE_WARNING,
    )
  })
})

describe('CoursePromoStatusView', () => {
  it('az üzenet role="status" bekezdésben, a figyelmeztetés role="alert"-ben', () => {
    const html = renderToStaticMarkup(
      createElement(CoursePromoStatusView, {
        status: {
          message: 'Az akció most él (szeptember 30-ig).',
          warning: ORIGINAL_PRICE_WARNING,
          reason: null,
        },
      }),
    )
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('Az akció most él (szeptember 30-ig).')
    expect(html).toContain('role="alert"')
    expect(html).toContain(ORIGINAL_PRICE_WARNING)
  })

  it('figyelmeztetés nélkül nincs alert', () => {
    const html = renderToStaticMarkup(
      createElement(CoursePromoStatusView, {
        status: { message: PROMO_OFF_MESSAGE, warning: null, reason: 'kikapcsolva' },
      }),
    )
    expect(html).not.toContain('role="alert"')
  })

  it('a felületi szövegekben nincs gondolatjel (tulajdonosi kikötés)', () => {
    for (const text of [PROMO_OFF_MESSAGE, ORIGINAL_PRICE_WARNING]) {
      expect(text).not.toMatch(/[–—]/)
    }
  })
})

describe('CoursePromoStatus (konténer, SSR)', () => {
  it('az űrlap mezőiből számol: a vég napjáig él, az eredeti ár figyelmeztetésével', () => {
    vi.useFakeTimers({ now: NOW })
    formFields.promoEnabled = { value: true }
    formFields.promoStart = { value: null }
    formFields.promoEnd = { value: new Date('2026-09-30T12:00:00.000Z') }
    formFields.promoOriginalPriceHuf = { value: 15_000 }
    formFields.priceInHUF = { value: 19_900 }
    formFields.priceInHUFEnabled = { value: true }
    formFields.status = { value: 'published' }
    const html = renderToStaticMarkup(createElement(CoursePromoStatus))
    expect(html).toContain('Az akció most él (szeptember 30-ig).')
    expect(html).toContain(ORIGINAL_PRICE_WARNING)
  })

  it('kikapcsolt pipa: a kikapcsolt üzenet', () => {
    formFields.promoEnabled = { value: false }
    formFields.promoStart = { value: null }
    formFields.promoEnd = { value: null }
    formFields.promoOriginalPriceHuf = { value: null }
    const html = renderToStaticMarkup(createElement(CoursePromoStatus))
    expect(html).toContain(PROMO_OFF_MESSAGE)
  })
})
