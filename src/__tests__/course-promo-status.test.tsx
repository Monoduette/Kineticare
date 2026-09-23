import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { formatPriceHuf } from '../lib/format-price'

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
  DRAFT_WARNING,
  NO_PRICE_WARNING,
  NOT_PUBLISHED_WARNING,
  PROMO_OFF_MESSAGE,
  deriveCoursePromoStatus,
  handwrittenPriceNotes,
  lexicalPlainText,
  pricesInText,
  promoPriceWarning,
  withDaySuffix,
} = await import('../components/admin/CoursePromoStatus')

const base = {
  priceInHUF: 19_900,
  priceInHUFEnabled: true,
  promoPriceHuf: null,
  status: 'published',
}
const NOW = new Date('2026-09-20T10:00:00Z')
const NO_PROMO_PRICE_TAIL = ' Akciós ár nincs megadva, a vásárló a rendes árat fizeti.'

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

  it('most él, véggel és vég nélkül; akciós ár nélkül ezt kimondja', () => {
    expect(
      deriveCoursePromoStatus(
        { ...base, promoEnabled: true, promoStart: null, promoEnd: '2026-09-30T12:00:00.000Z' },
        NOW,
      ).message,
    ).toBe(`Az akció most él (szeptember 30-ig).${NO_PROMO_PRICE_TAIL}`)
    expect(
      deriveCoursePromoStatus(
        { ...base, promoEnabled: true, promoStart: null, promoEnd: null },
        NOW,
      ).message,
    ).toBe(`Az akció most él, és nincs megadva a vége.${NO_PROMO_PRICE_TAIL}`)
  })

  it('most él, akciós árral: kimondja, mit fizet a vásárló, és mi lesz az ár utána', () => {
    const status = deriveCoursePromoStatus(
      {
        ...base,
        promoEnabled: true,
        promoStart: null,
        promoEnd: '2026-09-30T12:00:00.000Z',
        promoPriceHuf: 14_900,
      },
      NOW,
    )
    expect(status.message).toBe(
      `Az akció most él (szeptember 30-ig). A vásárló most ${formatPriceHuf(14_900)}-ot fizet, az akció után magától ${formatPriceHuf(19_900)} lesz az ár.`,
    )
    expect(status.warning).toBeNull()
    expect(status.reason).toBeNull()
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

  it('figyelmeztet, ha az akciós ár nem kisebb az Árnál; ilyenkor a rendes árat mondja', () => {
    const on = { promoEnabled: true, promoStart: null, promoEnd: null }
    const equal = deriveCoursePromoStatus({ ...base, ...on, promoPriceHuf: 19_900 }, NOW)
    expect(equal.warning).toBe(promoPriceWarning(19_900, 19_900))
    expect(equal.message).toBe(`Az akció most él, és nincs megadva a vége.${NO_PROMO_PRICE_TAIL}`)
    expect(deriveCoursePromoStatus({ ...base, ...on, promoPriceHuf: 24_900 }, NOW).warning).toBe(
      promoPriceWarning(24_900, 19_900),
    )
    expect(
      deriveCoursePromoStatus({ ...base, ...on, promoPriceHuf: 14_900 }, NOW).warning,
    ).toBeNull()
    expect(deriveCoursePromoStatus({ ...base, ...on }, NOW).warning).toBeNull()
    // Lejárt akciónál is figyelmeztet a hibás akciós árra, hogy a következő akció előtt javítsák.
    expect(
      deriveCoursePromoStatus(
        { ...base, ...on, promoEnd: '2026-09-10T12:00:00.000Z', promoPriceHuf: 24_900 },
        NOW,
      ),
    ).toEqual({
      message: 'Az akció lejárt (szeptember 10-én).',
      warning: promoPriceWarning(24_900, 19_900),
      reason: 'lejart',
    })
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
    ).toBe(DRAFT_WARNING)
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

describe('K21: az érvénytelen akciós ár figyelmeztetése a validátor párja', () => {
  it('szó szerint: a megadott ár és a most fizetett ár, formázva', () => {
    expect(promoPriceWarning(99_000, 79_500)).toBe(
      `A megadott akciós ár (${formatPriceHuf(99_000)}) nem kisebb a rendes árnál, ezért a vásárló most ${formatPriceHuf(79_500)}-ot fizet.`,
    )
    expect(promoPriceWarning(99_000, 79_500)).toBe(
      'A megadott akciós ár (99\u00a0000\u00a0Ft) nem kisebb a rendes árnál, ezért a vásárló most 79\u00a0500\u00a0Ft-ot fizet.',
    )
  })
})

describe('K42: kézzel írt ár a szabad szövegben', () => {
  const lexical = (...paragraphs: string[][]) => ({
    root: {
      type: 'root',
      children: paragraphs.map((texts) => ({
        type: 'paragraph',
        children: texts.map((text) => ({ type: 'text', text })),
      })),
    },
  })

  it('a Lexical szöveget bekezdésenként olvassa, a darabolt szövegrészeket összefűzi', () => {
    expect(lexicalPlainText(lexical(['Most csak ', '79 500', ' Ft-ért.'], ['Második']))).toBe(
      'Most csak 79 500 Ft-ért.\nMásodik',
    )
    expect(lexicalPlainText(null)).toBe('')
    expect(lexicalPlainText('szöveg')).toBe('szöveg')
  })

  it('a magyar írásmódokat felismeri, és egységesen formázza', () => {
    expect(
      pricesInText('79 500 Ft, 79.500 Ft, 79500 Ft, 79\u00a0500,- Ft, 19 900 forint, 4500 HUF'),
    ).toEqual([formatPriceHuf(79_500), formatPriceHuf(19_900), formatPriceHuf(4_500)])
    expect(pricesInText('Nincs itt ár, csak 12 lecke és 2026.')).toEqual([])
  })

  it('mezőnként egy mondat, a brief szövege szerint', () => {
    expect(
      handwrittenPriceNotes({
        longDescription: lexical(['A program 79 500 Ft-ért érhető el.']),
        guaranteeTitle: 'Pénzvisszafizetési garancia',
        guaranteeText: 'Ha nem válik be, visszakapod a 79 500 Ft-ot.',
        faqText: 'Mennyibe kerül?\nCsak 59 900 Ft.',
      }),
    ).toEqual([
      `A Részletes leírásban kézzel írt ár áll (${formatPriceHuf(79_500)}). Ellenőrizd, hogy az akció alatt is igaz-e.`,
      `A Garancia szövegében kézzel írt ár áll (${formatPriceHuf(79_500)}). Ellenőrizd, hogy az akció alatt is igaz-e.`,
      `A Gyakori kérdésekben (GYIK) kézzel írt ár áll (${formatPriceHuf(59_900)}). Ellenőrizd, hogy az akció alatt is igaz-e.`,
    ])
    expect(handwrittenPriceNotes({})).toEqual([])
  })
})

describe('CoursePromoStatusView', () => {
  it('a doboz egyetlen role="status" régió, a figyelmeztetés benne, alert nincs', () => {
    const html = renderToStaticMarkup(
      createElement(CoursePromoStatusView, {
        status: {
          message: 'Az akció most él (szeptember 30-ig).',
          warning: promoPriceWarning(99_000, 79_500),
          reason: null,
        },
        priceNotes: ['A Részletes leírásban kézzel írt ár áll (79 500 Ft).'],
      }),
    )
    expect(html.match(/role="status"/g)).toHaveLength(1)
    expect(html).not.toContain('role="alert"')
    expect(html).toContain('Az akció most él (szeptember 30-ig).')
    expect(html).toContain('kc-admin-notice kc-admin-notice--figyelem')
    expect(html).toContain('<p class="kc-admin-notice__cim">Figyelem</p>')
    expect(html).toContain('Kézzel írt ár a kurzusoldalon')
  })

  it('figyelmeztetés nélkül nincs figyelmeztető doboz', () => {
    const html = renderToStaticMarkup(
      createElement(CoursePromoStatusView, {
        status: { message: PROMO_OFF_MESSAGE, warning: null, reason: 'kikapcsolva' },
      }),
    )
    expect(html).not.toContain('role="alert"')
    expect(html).not.toContain('kc-admin-notice')
  })

  it('a felületi szövegekben nincs gondolatjel, ASCII idézőjel és verzál szó', () => {
    for (const text of [
      PROMO_OFF_MESSAGE,
      promoPriceWarning(99_000, 79_500),
      NOT_PUBLISHED_WARNING,
      DRAFT_WARNING,
      NO_PRICE_WARNING,
      ...handwrittenPriceNotes({ guaranteeText: '79 500 Ft' }),
    ]) {
      expect(text).not.toMatch(/[–—"]/)
      expect(text).not.toMatch(/\b[A-ZÁÉÍÓÖŐÚÜŰ]{2,}\b/u)
      expect(text).not.toContain('vevő')
    }
  })
})

describe('CoursePromoStatus (konténer, SSR)', () => {
  it('az űrlap mezőiből számol: a vég napjáig él, a hibás akciós ár figyelmeztetésével', () => {
    vi.useFakeTimers({ now: NOW })
    formFields.promoEnabled = { value: true }
    formFields.promoStart = { value: null }
    formFields.promoEnd = { value: new Date('2026-09-30T12:00:00.000Z') }
    formFields.promoPriceHuf = { value: 25_000 }
    formFields.priceInHUF = { value: 19_900 }
    formFields.priceInHUFEnabled = { value: true }
    formFields.status = { value: 'published' }
    const html = renderToStaticMarkup(createElement(CoursePromoStatus))
    expect(html).toContain('Az akció most él (szeptember 30-ig).')
    expect(html).toContain(promoPriceWarning(25_000, 19_900))
  })

  it('a Kurzusoldal szabad szövegéből a kézzel írt árat is megnevezi', () => {
    vi.useFakeTimers({ now: NOW })
    formFields.promoEnabled = { value: true }
    formFields.promoPriceHuf = { value: 14_900 }
    formFields.guaranteeText = { value: 'A teljes ár 19 900 Ft.' }
    formFields['faq.0.question'] = { value: 'Mennyibe kerül?' }
    formFields['faq.0.answer'] = { value: 'Most 14 900 Ft.' }
    const html = renderToStaticMarkup(createElement(CoursePromoStatus))
    expect(html).toContain('A Garancia szövegében kézzel írt ár áll')
    expect(html).toContain('A Gyakori kérdésekben (GYIK) kézzel írt ár áll')
    delete formFields.guaranteeText
    delete formFields['faq.0.question']
    delete formFields['faq.0.answer']
  })

  it('az űrlap akciós árából a vevő mostani és akció utáni ára', () => {
    vi.useFakeTimers({ now: NOW })
    formFields.promoEnabled = { value: true }
    formFields.promoStart = { value: null }
    formFields.promoEnd = { value: '2026-09-30T12:00:00.000Z' }
    formFields.promoPriceHuf = { value: 14_900 }
    formFields.priceInHUF = { value: 19_900 }
    formFields.priceInHUFEnabled = { value: true }
    formFields.status = { value: 'published' }
    const html = renderToStaticMarkup(createElement(CoursePromoStatus))
    expect(html).toContain(`A vásárló most ${formatPriceHuf(14_900)}-ot fizet`)
    expect(html).toContain(`magától ${formatPriceHuf(19_900)} lesz az ár.`)
    expect(html).not.toContain('role="alert"')
  })

  it('kikapcsolt pipa: a kikapcsolt üzenet', () => {
    formFields.promoEnabled = { value: false }
    formFields.promoStart = { value: null }
    formFields.promoEnd = { value: null }
    formFields.promoPriceHuf = { value: null }
    const html = renderToStaticMarkup(createElement(CoursePromoStatus))
    expect(html).toContain(PROMO_OFF_MESSAGE)
  })
})
