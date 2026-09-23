import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import SzakembereknekPage, { generateMetadata } from '../app/(frontend)/szakembereknek/page'
import { ctaLabel } from '../lib/cta-vocabulary'
import { buildNavigationMenuPlan, PROFESSIONAL_TRAINING_URL } from '../lib/menu-seed'
import { absoluteUrl } from '../lib/seo'
import {
  resolveKepzesCta,
  resolveSzakkonyvCta,
  SZAKEMBEREKNEK_PATH,
  SZAKKONYV_ERDEKLODES_PATH,
  SZAKKONYV_URL,
} from '../lib/szakembereknek'

import { EM_DASH, EN_DASH } from './helpers/cta-mikroszoveg'

/**
 * ŐR — /szakembereknek, a szakmai választó oldal (WP49).
 *
 * Mit véd:
 *  1. a route renderel, H1-gyel és a két egyenrangú kártyával;
 *  2. a képzés-kártya a ProBody külső oldalára visz, jelölve (új lap,
 *     rel="noopener noreferrer", jegyzet az aria-describedby-on: WCAG 2.2 SC
 *     3.2.5);
 *  3. amíg a szakkönyv vásárlási címe hiányzik (`SZAKKONYV_URL === null`), a
 *     kártya a /kapcsolat oldalra esik vissza a §3.2 #43 felirattal, és ha
 *     lesz cím, a #42-re vált;
 *  4. a vevői szövegekben nincs gondolatjel (docs/ui-sztenderdek.md §3.1);
 *  5. a menü-seed „Szakembereknek" pontja pontosan erre az oldalra mutat.
 *
 * A tesztkörnyezet `node` (nincs jsdom): a SZERVER-RENDERELT kimenetet mérjük.
 * A lap 2026-09-23 óta a „szakembereknek” Oldalak-rekordból renderel (H11); itt
 * a rekord NÉLKÜLI kódtartalékot mérjük (a CMS-ágak őre:
 * szakembereknek-cms.test.tsx). Adatbázis és hálózat nincs.
 */

vi.mock('next/headers', () => ({ draftMode: async () => ({ isEnabled: false }) }))
vi.mock('@/lib/cms', () => ({ getPageBySlug: async () => null }))
vi.mock('@/lib/contact-email-server', () => ({ getContactEmail: async () => 'info@kineticare.hu' }))
vi.mock('@/lib/tudastar-lathatosag', () => ({ getTudastarLathato: async () => true }))
vi.mock('payload', async (eredeti) => ({
  ...(await eredeti<typeof import('payload')>()),
  getPayload: async () => {
    throw new Error('A tesztből nem indulhat Payload.')
  },
}))
vi.mock('../payload.config', () => ({ default: {} }))

const html = renderToStaticMarkup(await SzakembereknekPage())
const metadata = await generateMetadata()

function hrefs(markup: string): string[] {
  return [...markup.matchAll(/href="([^"]+)"/g)].map((match) => match[1]!)
}

function text(markup: string): string {
  return markup
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A gomb (`<a class="kc-button …">`) teljes nyitó címkéje a felirat alapján. */
function gombTag(markup: string, felirat: string): string {
  const match = new RegExp(`<a([^>]*class="kc-button[^"]*"[^>]*)>${felirat}</a>`, 'u').exec(markup)
  expect(match, `nincs „${felirat}" feliratú gomb`).not.toBeNull()
  return match?.[1] ?? ''
}

describe('/szakembereknek — a lap renderel', () => {
  it('H1 „Szakembereknek", felvezető és bevezető', () => {
    expect(html).toMatch(/<h1[^>]*>Szakembereknek<\/h1>/)
    const content = text(html)
    expect(content).toContain('Gyógytornászoknak és terapeutáknak')
    expect(content).toContain('két úton mélyítheted a tudásod')
  })

  it('két egyenrangú kártya: képzés és szakkönyv, mindkettő saját címmel', () => {
    expect(html.match(/<article class="kc-card[^"]*kc-ajanlat-kartyak__card"/g)).toHaveLength(2)
    expect(html).toMatch(/<h2[^>]*>Akkreditált kézrehabilitációs képzés<\/h2>/)
    expect(html).toMatch(/<h2[^>]*>A Kineticare szakkönyve<\/h2>/)
    expect(text(html)).toContain('12 kreditpont (SZTK-A-33553/2024)')
  })

  it('a képzés gombja a ProBody külső oldalára visz, új lapon, jelölve (SC 3.2.5)', () => {
    const tag = gombTag(html, ctaLabel('workshop-open'))
    expect(tag).toContain(`href="${PROFESSIONAL_TRAINING_URL}"`)
    expect(tag).toContain('target="_blank"')
    expect(tag).toContain('rel="noopener noreferrer"')
    expect(tag).toContain('aria-describedby="szakembereknek-1-jegyzet"')
    expect(html).toMatch(
      /<p class="kc-ajanlat-kartyak__jegyzet" id="szakembereknek-1-jegyzet">[\s\S]*?Külső oldal, új lapon nyílik\./,
    )
    expect(tag).toContain('kc-button--primary')
  })

  it('a szakkönyv cím hiányában a /kapcsolat oldalra esik vissza, érdeklődő felirattal (#43)', () => {
    expect(SZAKKONYV_URL).toBeNull()
    const tag = gombTag(html, ctaLabel('book-inquiry'))
    expect(tag).toContain(`href="${SZAKKONYV_ERDEKLODES_PATH}"`)
    expect(tag).not.toContain('target="_blank"')
    expect(tag).toContain('kc-button--secondary')
    expect(text(html)).toContain('A vásárlás lehetőségét hamarosan közzétesszük')
    expect(hrefs(html)).not.toContain('#')
  })

  it('a lap egyetlen elsődleges gombot visel (GOV.UK Button)', () => {
    expect(html.match(/kc-button--primary/g)).toHaveLength(1)
  })

  it('a vevői szövegekben nincs gondolatjel és nincs kvirtmínusz (§3.1)', () => {
    const content = text(html)
    expect(content.includes(EN_DASH), 'U+2013 a lapon').toBe(false)
    expect(content.includes(EM_DASH), 'U+2014 a lapon').toBe(false)
  })

  it('metaadat és JSON-LD: cím, leírás, canonical, BreadcrumbList', () => {
    expect(String(metadata.title)).toContain('Szakembereknek')
    expect(metadata.description).toMatch(/gyógytornász/i)
    // A canonical a `metadataBase`-hez képest relatív (a többi statikus lap
    // mintája); az abszolút alak a keret `metadataBase`-éből áll össze.
    expect([SZAKEMBEREKNEK_PATH, absoluteUrl(SZAKEMBEREKNEK_PATH)]).toContain(
      metadata.alternates?.canonical,
    )
    expect(html).toContain('"@type":"BreadcrumbList"')
    expect(html).toContain('"name":"Szakembereknek"')
  })
})

describe('resolveSzakkonyvCta — a szakkönyv-gomb feloldása', () => {
  it('cím nélkül: kapcsolat + #43, belső', () => {
    expect(resolveSzakkonyvCta(null)).toEqual({
      href: '/kapcsolat',
      label: 'Érdeklődj a szakkönyvről',
      external: false,
    })
  })

  it('címmel: a vásárlási oldal + #42, külső címnél jelölve', () => {
    expect(resolveSzakkonyvCta('https://pelda.hu/szakkonyv')).toEqual({
      href: 'https://pelda.hu/szakkonyv',
      label: 'Nézd meg a szakkönyvet',
      external: true,
    })
    expect(resolveSzakkonyvCta('/szakkonyv').external).toBe(false)
  })

  it('a képzés gombja mindig a ProBody workshop (#41), külső', () => {
    expect(resolveKepzesCta()).toEqual({
      href: PROFESSIONAL_TRAINING_URL,
      label: 'Nézd meg a kézworkshopot',
      external: true,
    })
  })
})

describe('a menü-seed „Szakembereknek" pontja erre a lapra mutat', () => {
  it('a Szolgáltatások almenü Szakembereknek tétele = /szakembereknek', () => {
    const services = buildNavigationMenuPlan().find((node) => node.label === 'Szolgáltatások')
    const item = services?.children.find((child) => child.label === 'Szakembereknek')
    expect(item?.url).toBe(SZAKEMBEREKNEK_PATH)
  })
})
