import { beforeEach, describe, expect, it } from 'vitest'

import {
  metaCourseParams,
  trackMetaInitiateCheckout,
  trackMetaLead,
  trackMetaViewContent,
} from '../lib/analytics/meta-events'
import {
  META_PIXEL_SCRIPT_SRC,
  applyConsentToMetaPixel,
  enableMetaPixel,
  isMetaPixelActive,
  isMetaSafeUrl,
  normalizeMetaPixelId,
  resetMetaPixelForTests,
  trackMetaEvent,
  trackMetaPageView,
  type MetaRuntime,
} from '../lib/analytics/meta-pixel'
import { buildContentSecurityPolicy } from '../lib/security/csp'

/**
 * Meta Pixel: consent-first betöltés, csak nem személyes adat, és a CSP csak
 * érvényes azonosítóval nyílik meg. A modul azonosító nélkül inert.
 */

const PIXEL_ID = '123456789012345'

interface FakeRuntime extends MetaRuntime {
  readonly loaded: string[]
}

function fakeRuntime(href: string | null = 'https://www.kineticare.hu/', pixelId = PIXEL_ID) {
  const loaded: string[] = []
  const runtime: FakeRuntime = {
    pixelId,
    globals: {},
    href,
    loaded,
    loadScript(src: string): void {
      loaded.push(src)
    },
  }
  return runtime
}

/** A `fbq.queue` bejegyzései tömbként (a sor `arguments`-objektumokat tart). */
function queue(runtime: MetaRuntime): unknown[][] {
  const fbq = runtime.globals.fbq as { queue: ArrayLike<unknown>[] } | undefined
  return (fbq?.queue ?? []).map((entry) => Array.from(entry))
}

const granted = () => 'granted' as const
const unknown = () => 'unknown' as const

beforeEach(() => {
  resetMetaPixelForTests()
})

describe('normalizeMetaPixelId', () => {
  it('csak számjegyes azonosítót fogad el', () => {
    expect(normalizeMetaPixelId(` ${PIXEL_ID} `)).toBe(PIXEL_ID)
    expect(normalizeMetaPixelId(undefined)).toBe('')
    expect(normalizeMetaPixelId('')).toBe('')
    expect(normalizeMetaPixelId('12345')).toBe('')
    expect(normalizeMetaPixelId('123456789012345"<script>')).toBe('')
    expect(normalizeMetaPixelId('G-TESTONLY00')).toBe('')
  })
})

describe('enableMetaPixel', () => {
  it('azonosító nélkül semmit nem tölt be', () => {
    const runtime = fakeRuntime('https://www.kineticare.hu/', '')
    expect(enableMetaPixel(runtime)).toBe(false)
    expect(runtime.loaded).toEqual([])
    expect(runtime.globals.fbq).toBeUndefined()
  })

  it('autoConfig ki, init, PageView, majd EGYSZER tölti be az fbevents.js-t', () => {
    const runtime = fakeRuntime()
    expect(enableMetaPixel(runtime)).toBe(true)
    expect(enableMetaPixel(runtime)).toBe(true)
    expect(runtime.loaded).toEqual([META_PIXEL_SCRIPT_SRC])
    expect(queue(runtime)).toEqual([
      ['set', 'autoConfig', false, PIXEL_ID],
      ['init', PIXEL_ID],
      ['track', 'PageView'],
    ])
  })

  it('jegyes (token) URL-en nem indul el', () => {
    const runtime = fakeRuntime('https://www.kineticare.hu/jelszo-visszaallitas?token=titok')
    expect(enableMetaPixel(runtime)).toBe(false)
    expect(runtime.loaded).toEqual([])
    expect(runtime.globals.fbq).toBeUndefined()
  })

  it('ismeretlen címmel (href null) nem indul el', () => {
    const runtime = fakeRuntime(null)
    expect(enableMetaPixel(runtime)).toBe(false)
    expect(runtime.loaded).toEqual([])
  })

  it('az fbevents.js automatikus history-PageView-ja ki van kapcsolva', () => {
    const runtime = fakeRuntime()
    enableMetaPixel(runtime)
    expect((runtime.globals.fbq as { disablePushState?: boolean }).disablePushState).toBe(true)
  })

  it('kampány-paraméteres URL-en elindul', () => {
    const runtime = fakeRuntime('https://www.kineticare.hu/?utm_source=facebook#x')
    expect(enableMetaPixel(runtime)).toBe(true)
  })
})

describe('applyConsentToMetaPixel', () => {
  it('unknown → semmi, denied betöltés előtt → semmi', () => {
    const runtime = fakeRuntime()
    applyConsentToMetaPixel('unknown', runtime)
    applyConsentToMetaPixel('denied', runtime)
    expect(runtime.loaded).toEqual([])
    expect(runtime.globals.fbq).toBeUndefined()
  })

  it('visszavonás revoke-ot, újra-engedélyezés grant-ot küld, újratöltés nélkül', () => {
    const runtime = fakeRuntime()
    applyConsentToMetaPixel('granted', runtime)
    applyConsentToMetaPixel('denied', runtime)
    expect(isMetaPixelActive()).toBe(false)
    applyConsentToMetaPixel('granted', runtime)
    expect(isMetaPixelActive()).toBe(true)
    expect(runtime.loaded).toHaveLength(1)
    expect(queue(runtime).slice(3)).toEqual([
      ['consent', 'revoke'],
      ['consent', 'grant'],
    ])
  })
})

describe('trackMetaEvent', () => {
  it('hozzájárulás nélkül nem küld és nem tölt be', () => {
    const runtime = fakeRuntime()
    expect(trackMetaEvent('Lead', {}, { runtime, consent: unknown })).toBe(false)
    expect(runtime.loaded).toEqual([])
    expect(runtime.globals.fbq).toBeUndefined()
  })

  it('hozzájárulással elindítja a Pixelt és elküldi az eseményt', () => {
    const runtime = fakeRuntime()
    expect(trackMetaLead('idopontkeres', { runtime, consent: granted })).toBe(true)
    expect(queue(runtime).at(-1)).toEqual(['track', 'Lead', { content_name: 'idopontkeres' }])
  })

  it('elindult Pixel mellett sem küld jegyes (token) oldalon', () => {
    const runtime = fakeRuntime()
    expect(enableMetaPixel(runtime)).toBe(true)
    const tokenPage = {
      ...runtime,
      href: 'https://www.kineticare.hu/jelszo-visszaallitas?token=titok',
    }
    const before = queue(runtime).length
    expect(trackMetaPageView({ runtime: tokenPage, consent: granted })).toBe(false)
    expect(queue(runtime)).toHaveLength(before)
  })

  it('a Barion-visszatérés és más azonosítós címek nem mennek a Metának', () => {
    for (const href of [
      'https://www.kineticare.hu/fizetes/koszonom?order=KH-2026-000123&paymentId=abc',
      'https://www.kineticare.hu/fizetes/koszonom',
      'https://www.kineticare.hu/sikertelen?order=KH-2026-000123',
      'https://www.kineticare.hu/belepes-atallas?email=x',
      'https://www.kineticare.hu/barmi?ORDER=1',
      'https://www.kineticare.hu/barmi?paymentId=1',
    ]) {
      expect(isMetaSafeUrl(href), href).toBe(false)
    }
    expect(isMetaSafeUrl('https://www.kineticare.hu/penztar?termek=7')).toBe(true)
    expect(isMetaSafeUrl('https://www.kineticare.hu/kurzusok?utm_source=facebook')).toBe(true)
  })

  it('a munkamenetben adott hozzájárulás tároló nélkül is érvényes', () => {
    const runtime = fakeRuntime()
    applyConsentToMetaPixel('granted', runtime)
    expect(trackMetaPageView({ runtime })).toBe(true)
    applyConsentToMetaPixel('denied', runtime)
    expect(trackMetaPageView({ runtime })).toBe(false)
  })

  it('az első PageView nem duplázódik', () => {
    const runtime = fakeRuntime()
    expect(trackMetaPageView({ runtime, consent: granted })).toBe(true)
    expect(queue(runtime).filter((entry) => entry[1] === 'PageView')).toHaveLength(1)
    expect(trackMetaPageView({ runtime, consent: granted })).toBe(true)
    expect(queue(runtime).filter((entry) => entry[1] === 'PageView')).toHaveLength(2)
  })
})

describe('Meta üzleti események', () => {
  const course = { id: 7, priceHuf: 12990 }

  it('csak termék-id, ár és pénznem megy ki (név nem)', () => {
    expect(metaCourseParams(course)).toEqual({
      content_ids: ['7'],
      content_type: 'product',
      value: 12990,
      currency: 'HUF',
      num_items: 1,
    })
    expect(metaCourseParams({ id: 0, priceHuf: 100 })).toBeNull()
    expect(metaCourseParams({ id: 7, priceHuf: Number.NaN })).toBeNull()
  })

  it('ViewContent és InitiateCheckout a kurzus paramétereivel', () => {
    const runtime = fakeRuntime()
    trackMetaViewContent(course, { runtime, consent: granted })
    trackMetaInitiateCheckout(course, { runtime, consent: granted })
    const events = queue(runtime).filter((entry) => entry[0] === 'track')
    expect(events.map((entry) => entry[1])).toEqual(['PageView', 'ViewContent', 'InitiateCheckout'])
  })
})

describe('CSP — Meta hostok csak érvényes azonosítóval', () => {
  const directive = (csp: string, name: string): string =>
    csp.split('; ').find((part) => part.startsWith(`${name} `)) ?? ''

  it('azonosító nélkül (és hibás azonosítóval) a Meta hostjai nincsenek a fejlécben', () => {
    for (const csp of [
      buildContentSecurityPolicy(),
      buildContentSecurityPolicy(undefined, undefined, undefined, undefined, false, 'abc'),
    ]) {
      expect(csp).not.toContain('facebook')
    }
  })

  it('érvényes azonosítóval script-src, img-src és connect-src nyílik', () => {
    const csp = buildContentSecurityPolicy(
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      PIXEL_ID,
    )
    expect(directive(csp, 'script-src')).toContain('https://connect.facebook.net')
    expect(directive(csp, 'img-src')).toContain('https://www.facebook.com')
    expect(directive(csp, 'connect-src')).toContain('https://www.facebook.com')
    expect(directive(csp, 'frame-src')).not.toContain('facebook')
  })
})
