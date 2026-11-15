// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from 'vitest'

import {
  dropPostHogToolbarLaunchState,
  POSTHOG_TOOLBAR_STORAGE_KEY,
} from '../../lib/analytics/posthog'

/**
 * A PostHog eszköztár (a „sün”) tiltása.
 *
 * Mit véd: az eszköztár a PostHog felületéről indítva a böngészőben minden
 * oldalon betöltődik, és a CSP miatt formázás nélkül takarja a lapot
 * (tulajdonosi jelzés, 2026-11-15). Az indítás jelének az SDK betöltése előtt
 * el kell tűnnie, a látogató saját horgonya viszont nem sérülhet.
 */
const JEL = JSON.stringify({ action: 'ph_authorize', token: 'DUMMY', temporaryToken: 'DUMMY' })
/** A posthog-js mindkét alakot elfogadja: sima JSON és base64-be csomagolt JSON. */
const ALAKOK = [
  ['__posthog', 'JSON', encodeURIComponent(JEL)],
  ['state', 'JSON', encodeURIComponent(JEL)],
  ['__posthog', 'base64', encodeURIComponent(btoa(JEL))],
  ['state', 'base64', encodeURIComponent(btoa(JEL))],
] as const

describe('dropPostHogToolbarLaunchState', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.history.replaceState(null, '', '/')
  })

  it('a tárolt indítási jel törlődik', () => {
    window.localStorage.setItem(POSTHOG_TOOLBAR_STORAGE_KEY, '{"action":"ph_authorize"}')
    dropPostHogToolbarLaunchState()
    expect(window.localStorage.getItem(POSTHOG_TOOLBAR_STORAGE_KEY)).toBeNull()
  })

  it.each(ALAKOK)(
    'a címsor %s indító horgonya (%s) lekerül, a query marad',
    (kulcs, _alak, ertek) => {
      window.history.replaceState(null, '', `/fiok?utm_source=hirlevel#${kulcs}=${ertek}`)
      dropPostHogToolbarLaunchState()
      expect(window.location.hash).toBe('')
      expect(`${window.location.pathname}${window.location.search}`).toBe(
        '/fiok?utm_source=hirlevel',
      )
    },
  )

  it('az idegen state horgony (nem PostHog-indítás) érintetlen marad', () => {
    window.history.replaceState(null, '', '/fiok#state=abc123')
    dropPostHogToolbarLaunchState()
    expect(window.location.hash).toBe('#state=abc123')
  })

  it('a látogató saját horgonya érintetlen marad', () => {
    window.history.replaceState(null, '', '/szolgaltatasok#rendeloi')
    dropPostHogToolbarLaunchState()
    expect(window.location.hash).toBe('#rendeloi')
  })
})
