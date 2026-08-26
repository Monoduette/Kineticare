import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
  CONSENT_OPEN_EVENT,
  consentBannerVisible,
  dispatchConsentOpenEvent,
} from '../../lib/analytics/consent'
import { ConsentSettingsButton } from '../../components/analytics/ConsentSettingsButton'

/**
 * A süti-hozzájárulás VISSZAVONÁSI útja (GDPR) — a footer „Süti-beállítások"
 * gombja újranyitja a ConsentBanner-t döntés után is.
 * A banner korábban döntés után VÉGLEG eltűnt: a hozzájárulás visszavonására
 * (vagy módosítására) nem volt felület — a GDPR azt kéri, hogy a visszavonás
 * ugyanolyan könnyű legyen, mint a megadás.
 */

function render(node: ReactNode): string {
  return renderToStaticMarkup(createElement(Fragment, null, node))
}

describe('dispatchConsentOpenEvent — a footer-gomb eseménye', () => {
  it('a CONSENT_OPEN_EVENT eseményt szórja az injektált célra', () => {
    const dispatchEvent = vi.fn((_event: Event) => true)

    const ok = dispatchConsentOpenEvent({ dispatchEvent })

    expect(ok).toBe(true)
    expect(dispatchEvent).toHaveBeenCalledTimes(1)
    const event = dispatchEvent.mock.calls[0][0]
    expect(event.type).toBe(CONSENT_OPEN_EVENT)
  })

  it('cél nélkül (SSR) no-op, false — nem dob', () => {
    expect(dispatchConsentOpenEvent()).toBe(false)
  })
})

describe('consentBannerVisible — a banner láthatósági szabálya', () => {
  it("'unknown' állapotban látszik (a mai viselkedés változatlan)", () => {
    expect(consentBannerVisible('unknown', false)).toBe(true)
  })

  it('döntés után NEM látszik — kivéve újranyitáskor (a visszavonási út)', () => {
    expect(consentBannerVisible('granted', false)).toBe(false)
    expect(consentBannerVisible('denied', false)).toBe(false)
    expect(consentBannerVisible('granted', true)).toBe(true)
    expect(consentBannerVisible('denied', true)).toBe(true)
  })

  it('tárolatlan (SSR/hidrálás) állapotban csak az újranyitás jeleníti meg', () => {
    expect(consentBannerVisible(null, false)).toBe(false)
    expect(consentBannerVisible(null, true)).toBe(true)
  })
})

describe('ConsentSettingsButton — a footer visszavonási gombja', () => {
  it('magyar feliratú, valódi button elemként renderelődik', () => {
    const html = render(createElement(ConsentSettingsButton))

    expect(html).toContain('Süti-beállítások')
    expect(html).toContain('<button')
    expect(html).toContain('type="button"')
  })
})
