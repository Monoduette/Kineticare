import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NewsletterForm } from '../components/layout/NewsletterForm'
import { PRIVACY_POLICY_PATH } from '../lib/newsletter/consent-text'

/**
 * C9 — a lábléc feliratkozó-űrlapjának KEZDŐ állapota (renderToStaticMarkup,
 * a course-access-ui.test.ts mintája szerint, jsdom nélkül).
 *
 * Amit ez a réteg őriz: label minden mezőn, a hozzájárulás nincs előpipálva, a
 * jogi szöveg az /adatvedelem oldalra linkel, és a visszajelzés élő régióban
 * (role="status") érkezik. A viselkedés (validáció, beküldés) a tiszta
 * modulok szintjén tesztelt — src/__tests__/newsletter.test.ts.
 *
 * HÁLÓZAT: a globális fetch hangosan dobó mock, hogy a render semmilyen ágon ne
 * indíthasson hívást (CLAUDE.md 15. tanulság).
 */

vi.stubGlobal('fetch', () => {
  throw new Error('A tesztből SOSEM mehet ki valódi hálózati hívás.')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function render(props: { formId: string; turnstileSiteKey: string | null }): string {
  return renderToStaticMarkup(createElement(NewsletterForm, props))
}

describe('NewsletterForm — lábléc-űrlap kezdő állapota', () => {
  const html = render({ formId: '7', turnstileSiteKey: null })

  it('van címsor, magyar bevezető és feliratkozó gomb', () => {
    expect(html).toContain('Hírlevél')
    expect(html).toContain('Feliratkozom')
    expect(html).toContain('Bármikor leiratkozhatsz.')
  })

  it('az e-mail-mezőnek van labelje, és a label az inputra mutat', () => {
    expect(html).toContain('for="kc-field-newsletterEmail"')
    expect(html).toContain('id="kc-field-newsletterEmail"')
    expect(html).toContain('E-mail-cím')
    expect(html).toContain('type="email"')
  })

  it('a hozzájárulás-checkbox NINCS előpipálva, és kötelező', () => {
    expect(html).toContain('id="kc-newsletter-consent"')
    expect(html).toContain('type="checkbox"')
    expect(html).not.toContain('checked=""')
    expect(html).toContain('for="kc-newsletter-consent"')
  })

  it('a jogi szöveg az adatkezelési tájékoztatóra linkel', () => {
    expect(html).toContain(`href="${PRIVACY_POLICY_PATH}"`)
    expect(html).toContain('Adatkezelési és adatvédelmi szabályzat')
    expect(html).toContain('bármikor visszavonható')
  })

  it('a visszajelzésnek élő régiója van (role="status"), kezdetben üresen', () => {
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain(
      '<div aria-live="polite" class="kc-newsletter__status" role="status"></div>',
    )
  })

  it('kezdetben nincs hibaüzenet és nincs sikerüzenet a jelölésben', () => {
    expect(html).not.toContain('role="alert"')
    expect(html).not.toContain('kc-newsletter__success')
    expect(html).not.toContain('kc-newsletter__error')
  })

  it('a honeypot mező rejtett (aria-hidden, tabIndex=-1)', () => {
    expect(html).toContain('kc-newsletter__hp')
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('tabindex="-1"')
  })
})

describe('NewsletterForm — Turnstile csak beállított site key mellett', () => {
  it('site key nélkül nincs Cloudflare-hivatkozás a jelölésben', () => {
    const html = render({ formId: '7', turnstileSiteKey: null })
    expect(html).not.toContain('challenges.cloudflare.com')
  })

  it('site key mellett sem az ELSŐ renderkor tölt be (csak az űrlap érintésekor)', () => {
    // A widget a `touched` állapothoz kötött: a lábléc minden oldalon ott van,
    // a Cloudflare-szkript minden oldalletöltéskori betöltése felesleges lenne.
    const html = render({ formId: '7', turnstileSiteKey: '0x4AAAAAA' })
    expect(html).not.toContain('challenges.cloudflare.com')
  })
})
