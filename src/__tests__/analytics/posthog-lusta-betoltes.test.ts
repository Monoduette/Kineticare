// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A PostHog SDK LUSTA betöltésének szerződése (2026-10-16, a mobil halott
 * kattintások javítása, src/lib/analytics/posthog.ts).
 *
 * A `posthog-js` a főoldal legnagyobb JS-csomagja volt, és minden látogatónál
 * a hidratálás előtt futott, hozzájárulás nélkül is. Most csak hozzájárulás
 * után töltődik be, dinamikus `import()`-tal. Három hihető regressziót fog:
 *  1. valaki visszateszi a statikus importot: az SDK hozzájárulás nélkül is
 *     betöltődik (a mock gyára az import pillanatában fut, ezt számoljuk);
 *  2. a betöltés alatt küldött esemény (például egy koppintásra küldött
 *     `checkout_started`) elvész, mert a kliens még nincs kész;
 *  3. a betöltés alatt visszavont hozzájárulás után az SDK mégis elindul, és
 *     a várakozó esemény kimegy.
 *
 * A betöltési ablak további szerződései (a 2026-10-16-i átnézés találatai):
 *  4. a visszavonás alatt keletkezett esemény egy újbóli elfogadás után sem
 *     megy ki;
 *  5. a belépő oldal megtekintése (és kampány-paramétere) nem vész el, ha a
 *     látogató az SDK megérkezése előtt továbblép;
 *  6. a sorba állított esemény a keletkezési oldalát viszi, nem a kiküldéskorit;
 *  7. a betöltés alatti belépés azonosít (`identify`);
 *  8. az SDK megérkezése előtti kijelentkezés a teljes újratöltés után is
 *     elengedi az azonosságot (`reset`).
 *
 * Az azonosság és a hozzájárulás sorrendje (a 2026-10-17-i átnézés):
 *  9. visszavont hozzájárulás mellett a kijelentkezés az SDK-hoz nem nyúl (a
 *     `reset()` a `/flags` kérést az opt-out ellenére is kiküldené), csak a
 *     jelet írja;
 * 10. a függő `reset` a következő hozzájárulásnál az `opt_in_capturing` ELŐTT
 *     fut, mert az `$opt_in` a tárolt azonossággal megy ki; a függő
 *     `identify` UTÁNA, mert opt-out alatt az SDK eldobná. Az `opt_in` a
 *     reset után is lefut, ha az SDK opt-outtal indult: a valódi `reset()` az
 *     opt-outot törli, a szüneteltetett kérés-sort viszont csak az `opt_in`
 *     indítja el;
 * 11. a betöltés alatti belépés a korábbi lapról maradt `reset` jelet nem
 *     nyelheti el: akkor sem, ha a lap az SDK előtt továbblép, a letöltés
 *     elbukik, vagy közben visszavonják és újra megadják a hozzájárulást
 *     (2026-10-17, 5. kritikus kör).
 */

const sdk = vi.hoisted(() => {
  /** Az SDK azonosság- és rögzítés-hívásai, sorrendben. */
  const hivasok: string[] = []
  const allapot = {
    betoltve: 0,
    /** Az SDK tartósan tárolt opt-outja (posthog-js: a saját tárolójában). */
    optedOut: false,
    hivasok,
    init: vi.fn(),
    capture: vi.fn(),
    identify: vi.fn((id: string) => {
      hivasok.push(`identify:${id}`)
    }),
    // A valódi reset() a tárolt opt-outot is törli (posthog-js 1.430.3
    // posthog-core.js `_reset`: „Consent is user state, so reset() clears it”).
    reset: vi.fn(() => {
      allapot.optedOut = false
      hivasok.push('reset')
    }),
  }
  /** A mockolt SDK-modul; a gyár a betöltést számolja. */
  const modul = () => {
    allapot.betoltve += 1
    return {
      default: {
        init: allapot.init,
        capture: allapot.capture,
        identify: allapot.identify,
        reset: allapot.reset,
        has_opted_out_capturing: () => allapot.optedOut,
        opt_in_capturing: () => {
          allapot.optedOut = false
          hivasok.push('opt_in')
        },
        opt_out_capturing: () => {
          allapot.optedOut = true
          hivasok.push('opt_out')
        },
      },
    }
  }
  return Object.assign(allapot, { modul })
})

vi.mock('posthog-js', () => sdk.modul())

// A kulcsot a posthog-config modul betöltéskor olvassa, ezért az import előtt.
vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'DUMMY-posthog-teszt-kulcs')

const {
  CONSENT_STORAGE_KEY,
  captureAnalyticsEvent,
  capturePageView,
  identifyUser,
  initPostHog,
  optInToAnalytics,
  optOutOfAnalytics,
  resetAnalyticsIdentity,
  resetPostHogForTests,
  whenPostHogReady,
} = await import('@/lib/analytics/posthog')

/** A dinamikus import és az init lépése egy makrotaszkon belül lezajlik. */
const kivar = () => new Promise((resolve) => setTimeout(resolve, 0))

/** A böngésző címe (a Next útvonalváltása pushState-tel így látszik). */
function cim(path: string): void {
  window.history.replaceState(null, '', path)
}

beforeEach(() => {
  resetPostHogForTests()
  sdk.init.mockClear()
  sdk.capture.mockClear()
  sdk.identify.mockClear()
  sdk.reset.mockClear()
  sdk.optedOut = false
  sdk.hivasok.length = 0
  window.localStorage.clear()
  cim('/')
})

describe('PostHog SDK: lusta betöltés', () => {
  it('hozzájárulás nélkül az SDK le sem töltődik; elfogadás után egyszer betöltődik és elindul', async () => {
    expect(initPostHog()).toBe(false)
    captureAnalyticsEvent('course_viewed', { courseId: 7 })
    await kivar()
    expect(sdk.betoltve).toBe(0)

    optInToAnalytics()
    await kivar()
    expect(sdk.betoltve).toBe(1)
    expect(sdk.init).toHaveBeenCalledTimes(1)
  })

  it('a betöltés alatt küldött esemény az SDK megérkezése után egyszer kimegy', async () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, 'granted')
    expect(initPostHog()).toBe(true)
    captureAnalyticsEvent('checkout_started', { productId: 3 })
    expect(sdk.capture).not.toHaveBeenCalled()

    await kivar()
    expect(sdk.init).toHaveBeenCalledTimes(1)
    expect(sdk.capture).toHaveBeenCalledTimes(1)
    expect(sdk.capture).toHaveBeenCalledWith(
      'checkout_started',
      expect.objectContaining({ productId: 3 }),
    )
  })

  it('a betöltés alatt visszavont hozzájárulás után az SDK nem indul el, és semmi nem megy ki', async () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, 'granted')
    initPostHog()
    captureAnalyticsEvent('checkout_started', { productId: 3 })
    optOutOfAnalytics()

    await kivar()
    expect(sdk.init).not.toHaveBeenCalled()
    expect(sdk.capture).not.toHaveBeenCalled()
  })

  it('a visszavonás alatt keletkezett esemény újbóli elfogadás után sem megy ki', async () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, 'granted')
    initPostHog()
    optOutOfAnalytics()
    captureAnalyticsEvent('checkout_started', { productId: 3 })
    optInToAnalytics()
    captureAnalyticsEvent('checkout_started', { productId: 4 })

    await kivar()
    expect(sdk.init).toHaveBeenCalledTimes(1)
    expect(sdk.capture.mock.calls).toEqual([
      ['checkout_started', expect.objectContaining({ productId: 4 })],
    ])
  })

  it('a belépő oldal megtekintése és kampány-paramétere megmarad, ha a látogató a betöltés alatt továbblép', async () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, 'granted')
    cim('/?utm_source=hirlevel')
    // A layout sorrendje: a PostHogPageView effectje a provider initje ELŐTT
    // fut, és a route-váltáskor a cleanup visszavonná a sajátját.
    const visszavon = whenPostHogReady(() => capturePageView('/?utm_source=hirlevel'))
    initPostHog()
    visszavon()
    cim('/kurzusok')
    whenPostHogReady(() => capturePageView('/kurzusok'))

    await kivar()
    expect(sdk.capture.mock.calls).toEqual([
      [
        '$pageview',
        {
          $current_url: '/?utm_source=hirlevel',
          $pathname: '/',
          utm_source: 'hirlevel',
        },
      ],
      ['$pageview', { $current_url: '/kurzusok', $pathname: '/kurzusok' }],
    ])
  })

  it('a sorba állított esemény a keletkezési oldalát viszi, nem a kiküldéskorit', async () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, 'granted')
    cim('/tudastar/csuklo?utm_campaign=osz&token=DUMMY-JEGY')
    initPostHog()
    captureAnalyticsEvent('checkout_started', { productId: 3 })
    cim('/penztar')

    await kivar()
    expect(sdk.capture).toHaveBeenCalledWith('checkout_started', {
      // A jelszó-visszaállító jegy a sorból sem mehet ki (M9).
      $current_url: `${window.location.origin}/tudastar/csuklo?utm_campaign=osz`,
      $pathname: '/tudastar/csuklo',
      utm_campaign: 'osz',
      productId: 3,
    })
  })

  it('a betöltés alatti belépés az SDK megérkezése után azonosít', async () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, 'granted')
    initPostHog()
    expect(identifyUser(42)).toBe(true)
    expect(sdk.identify).not.toHaveBeenCalled()

    await kivar()
    expect(sdk.identify).toHaveBeenCalledExactlyOnceWith('42')
  })

  it('az SDK megérkezése előtti kijelentkezés a teljes újratöltés után is elengedi az azonosságot, egyszer', async () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, 'granted')
    // 1. lap: az SDK úton van, a látogató kijelentkezik, a lap újratölt
    // (AccountNav: `window.location.href = '/'`), a csomag sosem érkezik meg.
    vi.resetModules()
    vi.doMock('posthog-js', () => new Promise<never>(() => {}))
    const elsoLap = await import('@/lib/analytics/posthog')
    elsoLap.initPostHog()
    elsoLap.resetAnalyticsIdentity()
    await kivar()
    expect(sdk.reset).not.toHaveBeenCalled()

    // 2. lap: friss modul, az SDK megérkezik.
    vi.doMock('posthog-js', () => sdk.modul())
    vi.resetModules()
    const masodikLap = await import('@/lib/analytics/posthog')
    masodikLap.initPostHog()
    await kivar()
    expect(sdk.init).toHaveBeenCalledTimes(1)
    expect(sdk.reset).toHaveBeenCalledTimes(1)

    // 3. lap: a jel elfogyott, a mostani azonosság marad.
    vi.resetModules()
    const harmadikLap = await import('@/lib/analytics/posthog')
    harmadikLap.initPostHog()
    await kivar()
    expect(sdk.reset).toHaveBeenCalledTimes(1)
  })

  it('visszavont hozzájárulás mellett a kijelentkezés az SDK-hoz nem nyúl; az újbóli elfogadás a reset után kapcsol be', async () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, 'granted')
    initPostHog()
    await kivar()
    identifyUser(42)
    optOutOfAnalytics()
    sdk.hivasok.length = 0

    resetAnalyticsIdentity()
    expect(sdk.hivasok).toEqual([])

    optInToAnalytics()
    expect(sdk.hivasok).toEqual(['reset', 'opt_in'])
  })

  it('a korábbi lapon hozzájárulás nélkül történt kijelentkezés a következő initnél az $opt_in előtt fut', async () => {
    // Az SDK a korábbi elutasítást és a régi azonosságot tartósan tárolja.
    sdk.optedOut = true
    window.localStorage.setItem(CONSENT_STORAGE_KEY, 'denied')
    resetAnalyticsIdentity()
    expect(sdk.hivasok).toEqual([])

    // A következő látogató ugyanazon a gépen elfogadja a sütisávot.
    optInToAnalytics()
    await kivar()
    expect(sdk.hivasok).toEqual(['reset', 'opt_in'])
  })

  it('a korábbi lapról függő belépés tárolt opt-out mellett a bekapcsolás után azonosít', async () => {
    sdk.optedOut = true
    window.localStorage.setItem(CONSENT_STORAGE_KEY, 'granted')
    // 1. lap: belépés, az SDK sosem érkezik meg, a lap újratölt.
    vi.resetModules()
    vi.doMock('posthog-js', () => new Promise<never>(() => {}))
    const elsoLap = await import('@/lib/analytics/posthog')
    elsoLap.initPostHog()
    expect(elsoLap.identifyUser(42)).toBe(true)

    // 2. lap: az SDK megérkezik.
    vi.doMock('posthog-js', () => sdk.modul())
    vi.resetModules()
    const masodikLap = await import('@/lib/analytics/posthog')
    masodikLap.initPostHog()
    await kivar()
    expect(sdk.hivasok).toEqual(['opt_in', 'identify:42'])
  })

  it('a betöltés alatti belépés előtt a korábbi lapról függő reset az $opt_in előtt fut', async () => {
    // Korábbi lap: hozzájárulás nélküli kijelentkezés, az SDK opt-outot tárol.
    sdk.optedOut = true
    window.localStorage.setItem(CONSENT_STORAGE_KEY, 'denied')
    resetAnalyticsIdentity()

    // Ez a lap: elfogadás, és belépés, mielőtt az SDK megérkezne.
    let megerkezik: () => void = () => {}
    const kapu = new Promise<void>((resolve) => {
      megerkezik = resolve
    })
    vi.resetModules()
    vi.doMock('posthog-js', async () => {
      await kapu
      return sdk.modul()
    })
    const lap = await import('@/lib/analytics/posthog')
    lap.optInToAnalytics()
    expect(lap.identifyUser(77)).toBe(true)

    megerkezik()
    await kivar()
    expect(sdk.hivasok).toEqual(['reset', 'opt_in', 'identify:77'])
  })

  /** Korábbi lap: hozzájárulás nélküli kijelentkezés, az SDK opt-outot tárol. */
  function kijelentkezesHozzajarulasNelkul(): void {
    sdk.optedOut = true
    window.localStorage.setItem(CONSENT_STORAGE_KEY, 'denied')
    resetAnalyticsIdentity()
  }

  it.each([
    [
      'a lap az SDK előtt továbblép (LoginForm: teljes betöltés)',
      () => new Promise<never>(() => {}),
    ],
    ['az SDK letöltése elbukik', () => Promise.reject(new Error('blokkolt csomag'))],
  ])(
    'a betöltés alatti belépés a korábbi lapról függő resetet a következő lapra is átviszi: %s',
    async (_eset, elsoSdk) => {
      kijelentkezesHozzajarulasNelkul()
      // Ez a lap: elfogadás és belépés az SDK előtt; az SDK nem áll fel.
      vi.resetModules()
      vi.doMock('posthog-js', elsoSdk)
      const belepoLap = await import('@/lib/analytics/posthog')
      belepoLap.optInToAnalytics()
      expect(belepoLap.identifyUser(77)).toBe(true)
      await kivar()

      // A következő lap: az SDK megérkezik.
      vi.doMock('posthog-js', () => sdk.modul())
      vi.resetModules()
      const kovetkezoLap = await import('@/lib/analytics/posthog')
      kovetkezoLap.initPostHog()
      await kivar()
      expect(sdk.hivasok).toEqual(['reset', 'opt_in', 'identify:77'])
    },
  )

  it('a betöltés alatti belépés, visszavonás és újbóli elfogadás után a korábbi lapról függő reset az $opt_in előtt fut', async () => {
    kijelentkezesHozzajarulasNelkul()
    let megerkezik: () => void = () => {}
    const kapu = new Promise<void>((resolve) => {
      megerkezik = resolve
    })
    vi.resetModules()
    vi.doMock('posthog-js', async () => {
      await kapu
      return sdk.modul()
    })
    const lap = await import('@/lib/analytics/posthog')
    lap.optInToAnalytics()
    lap.identifyUser(77)
    // A visszavonás a függő belépést eldobja, a kijelentkezést nem.
    lap.optOutOfAnalytics()
    lap.optInToAnalytics()

    megerkezik()
    await kivar()
    expect(sdk.hivasok).toEqual(['reset', 'opt_in'])
  })
})
