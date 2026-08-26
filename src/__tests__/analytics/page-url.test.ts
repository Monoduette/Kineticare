import { describe, expect, it } from 'vitest'

import { sanitizeAnalyticsUrl } from '../../lib/analytics/page-url'

/**
 * M9 — az analytics felé kimenő oldal-URL tisztítása.
 * A jelszó-visszaállító jegy query-paraméterben utazik
 * (/jelszo-visszaallitas?token=…), és a pageview-capture a TELJES URL-t küldte
 * a PostHog/GA4 felé — a jegy harmadik fél naplóiba került volna.
 * A tisztítás SZELEKTÍV: a jegyet hordozó paraméter kivágódik, a kampány-
 */

const RESET_PATH = '/jelszo-visszaallitas'
// DUMMY jegy, egyértelműen jelölve — NEM valódi token.
const DUMMY_TOKEN = 'DUMMY-RESET-TOKEN-NEM-VALODI-JEGY'

describe('sanitizeAnalyticsUrl (M9)', () => {
  it('a token paraméter KIVÁGÓDIK — relatív és abszolút URL-ből egyaránt', () => {
    expect(sanitizeAnalyticsUrl(`${RESET_PATH}?token=${DUMMY_TOKEN}`)).toBe(RESET_PATH)
    expect(sanitizeAnalyticsUrl(`https://shop.example.test${RESET_PATH}?token=${DUMMY_TOKEN}`)).toBe(
      `https://shop.example.test${RESET_PATH}`,
    )
  })

  it('a kampány-paraméterek (utm_*) MEGMARADNAK a token mellett is', () => {
    expect(
      sanitizeAnalyticsUrl(`${RESET_PATH}?utm_source=hirlevel&token=${DUMMY_TOKEN}&utm_campaign=sos`),
    ).toBe(`${RESET_PATH}?utm_source=hirlevel&utm_campaign=sos`)
  })

  it('a hash-részlet mindig lemarad (jegyet is hordozhatna)', () => {
    expect(sanitizeAnalyticsUrl('/kurzusok#osszegzes')).toBe('/kurzusok')
    expect(sanitizeAnalyticsUrl(`${RESET_PATH}?token=${DUMMY_TOKEN}#reszlet`)).toBe(RESET_PATH)
  })

  it('a kulcs-felismerés kis-nagybetű- és URL-kódolás-tűrő', () => {
    expect(sanitizeAnalyticsUrl(`${RESET_PATH}?TOKEN=${DUMMY_TOKEN}`)).toBe(RESET_PATH)
    expect(sanitizeAnalyticsUrl(`${RESET_PATH}?Token=${DUMMY_TOKEN}`)).toBe(RESET_PATH)
    expect(sanitizeAnalyticsUrl(`${RESET_PATH}?%74oken=${DUMMY_TOKEN}`)).toBe(RESET_PATH)
  })

  it('érttéketlen (érték nélküli) token-paramétert is kivág', () => {
    expect(sanitizeAnalyticsUrl(`${RESET_PATH}?token`)).toBe(RESET_PATH)
  })

  it('érzékeny paraméter nélküli URL változatlan marad (query megőrződik)', () => {
    expect(sanitizeAnalyticsUrl('/kurzusok?kategoria=otthoni')).toBe('/kurzusok?kategoria=otthoni')
    expect(sanitizeAnalyticsUrl('/kurzusok')).toBe('/kurzusok')
  })

  it('üres bemenetre üreset ad (nem dob)', () => {
    expect(sanitizeAnalyticsUrl('')).toBe('')
  })
})
