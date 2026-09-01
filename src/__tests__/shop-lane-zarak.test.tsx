import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'

import { GoogleAnalytics } from '../components/analytics/GoogleAnalytics'
import { PostHogProvider } from '../components/analytics/PostHogProvider'
import { PostArticle } from '../components/content/PostArticle'
import { APPOINTMENT_CTA_SLUGS, postCtaVariantOf } from '../components/content/post-article'
import {
  applyConsentToGoogleAnalytics,
  enableGoogleAnalytics,
  resetGoogleAnalyticsForTests,
  type GaGlobalScope,
  type GaRuntime,
} from '../lib/analytics/ga4'
import {
  ANALYTICS_EVENTS,
  captureAnalyticsEvent,
  initPostHog,
  POSTHOG_API_HOST,
} from '../lib/analytics/posthog'
import { markdownToLexical } from '../lib/tudastar/markdown-to-lexical'
import type { Post } from '../payload-types'

/**
 * ŐR — Shop-sáv zárak, amiket a repó Ads-fiók nélkül is meg tud buktatni.
 *
 * CTA-fixture (hét kéz-cikk + váll), consent-kapu, ANALYTICS_EVENTS nevek,
 * ad_* denied, nincs /blog Ads-final-URL konstans. Spend, Enable K2–K5,
 * H-IH lander-200 és az A-gyökér 404 a térképen marad
 * (`docs/agent-feature-map.md`). A 900 px-es rács és a /szolgaltatasok
 * szivárgás a cikkoldal- / belső-oldal tesztben él.
 */

const REPO = fileURLToPath(new URL('../..', import.meta.url))

const KEZ_CIKK_PAR_SLUGOK = [
  'inhuvelygyulladas',
  'keztoalagut-szindroma',
  'teniszkonyok',
  'miert-zsibbad-a-kezem',
  'csuklotores-utani-gyogytorna',
  'csuklo-es-kezfajdalom',
  'pattano-ujj',
] as const

const VALL_SLUG = 'befagyott-vall'

const ANALYTICS_EVENTS_ZAR = {
  courseViewed: 'course_viewed',
  checkoutStarted: 'checkout_started',
  purchaseConfirmed: 'purchase_confirmed',
  courseStarted: 'course_started',
  lessonCompleted: 'lesson_completed',
  moduleCompleted: 'module_completed',
  courseCompleted: 'course_completed',
  leadSubmitted: 'lead_submitted',
  leadSucceeded: 'lead_succeeded',
  videoStarted: 'video_started',
  videoMilestone: 'video_milestone',
  checkoutFailed: 'checkout_failed',
  articleViewed: 'article_viewed',
  articleRead: 'article_read',
  articleCtaClicked: 'article_cta_clicked',
  faqOpened: 'faq_opened',
} as const

const ADS_NEV_MINTA =
  /(?:^|_)(ads|adwords|final_url|vegso_url|paid_lander)(?:_|$)|finalUrl|vegsoUrl|FINAL_URL|VEGSO_URL/i

function olvas(relativ: string): string {
  return readFileSync(join(REPO, relativ), 'utf8')
}

function cikkSlugok(): string[] {
  return readdirSync(join(REPO, 'docs', 'cikkek'))
    .filter((fajl) => fajl.endsWith('.md'))
    .map((fajl) => fajl.replace(/^\d+-/, '').replace(/\.md$/, ''))
    .sort()
}

function cikkPost(slug: string): Post {
  return {
    id: 1,
    title: slug,
    slug,
    excerpt: 'Shop-sáv CTA-őr.',
    status: 'published',
    publishedAt: '2026-08-21T08:00:00.000Z',
    updatedAt: '2026-08-21T08:00:00.000Z',
    createdAt: '2026-08-20T08:00:00.000Z',
    content: markdownToLexical(['Bekezdés.']),
    categories: [{ id: 5, title: 'Kézrehabilitáció', slug: 'kezrehabilitacio' }],
  } as unknown as Post
}

function panelSzam(html: string): number {
  return [...html.matchAll(/kc-post-cta__panel/g)].length
}

function fajlok(gyoker: string, kiveve: readonly string[] = []): string[] {
  const talalatok: string[] = []
  const bejar = (relativ: string): void => {
    for (const bejegyzes of readdirSync(join(REPO, relativ), { withFileTypes: true })) {
      const ut = `${relativ}/${bejegyzes.name}`
      if (kiveve.some((kivetel) => ut === kivetel || ut.startsWith(`${kivetel}/`))) continue
      if (bejegyzes.isDirectory()) {
        bejar(ut)
        continue
      }
      talalatok.push(ut)
    }
  }
  bejar(gyoker)
  return talalatok
}

function adsJelleguNev(nev: string): boolean {
  const kigyo = nev.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
  return ADS_NEV_MINTA.test(kigyo) || ADS_NEV_MINTA.test(nev)
}

function adsBlogTalalatok(forras: string): { nev: string; ertek: string }[] {
  const talalatok: { nev: string; ertek: string }[] = []
  const konstans = /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])([^'"`]*?)\2/g
  for (const talalat of forras.matchAll(konstans)) {
    const nev = talalat[1]!
    const ertek = talalat[3]!
    if (adsJelleguNev(nev) && ertek.includes('/blog/')) {
      talalatok.push({ nev, ertek })
    }
  }
  const kulcs = /([A-Za-z_$][\w$]*)\s*:\s*(['"`])([^'"`]*?)\2/g
  for (const talalat of forras.matchAll(kulcs)) {
    const nev = talalat[1]!
    const ertek = talalat[3]!
    if (adsJelleguNev(nev) && ertek.includes('/blog/')) {
      talalatok.push({ nev, ertek })
    }
  }
  return talalatok
}

function objektumLiteral(forras: string, nev: string): Record<string, string> {
  const minta = new RegExp(`const ${nev} = \\{([\\s\\S]*?)\\} as const`)
  const talalat = minta.exec(forras)
  if (talalat === null) {
    throw new Error(`Hiányzó objektum: ${nev}`)
  }
  const mezok: Record<string, string> = {}
  for (const mezo of talalat[1]!.matchAll(/(\w+)\s*:\s*'([^']+)'/g)) {
    mezok[mezo[1]!] = mezo[2]!
  }
  return mezok
}

function fuggvenyTorzs(forras: string, nev: string): string {
  const fej = `export function ${nev}`
  const kezdet = forras.indexOf(fej)
  if (kezdet < 0) {
    throw new Error(`Hiányzó függvény: ${nev}`)
  }
  const nyito = forras.indexOf('{', kezdet)
  let melyseg = 0
  for (let i = nyito; i < forras.length; i += 1) {
    const jel = forras[i]
    if (jel === '{') melyseg += 1
    if (jel === '}') {
      melyseg -= 1
      if (melyseg === 0) return forras.slice(nyito, i + 1)
    }
  }
  throw new Error(`Lezáratlan függvény: ${nev}`)
}

function csomagFuggosegek(): string {
  const nyers: unknown = JSON.parse(olvas('package.json'))
  if (typeof nyers !== 'object' || nyers === null) return ''
  const rekord = nyers as Record<string, unknown>
  return JSON.stringify({
    dependencies: rekord.dependencies ?? {},
    devDependencies: rekord.devDependencies ?? {},
  })
}

interface GaHarness {
  runtime: GaRuntime
  loaded: string[]
  commands(): unknown[][]
}

function gaHarness(measurementId = 'G-TESTONLY00'): GaHarness {
  const globals: GaGlobalScope = {}
  const loaded: string[] = []
  return {
    runtime: {
      measurementId,
      globals,
      loadScript(src: string): void {
        loaded.push(src)
      },
    },
    loaded,
    commands: () => {
      const layer = globals.dataLayer
      if (!Array.isArray(layer)) return []
      return layer.map((entry) => Array.from(entry as ArrayLike<unknown>))
    },
  }
}

beforeEach(() => {
  resetGoogleAnalyticsForTests()
})

describe('Shop — dual CTA a hét fixture-slugon, váll egy panel', () => {
  it('a docs/cikkek slugkészlete pontosan a hét kéz-cikk plusz a váll', () => {
    expect(cikkSlugok()).toEqual([...KEZ_CIKK_PAR_SLUGOK, VALL_SLUG].sort())
    expect(KEZ_CIKK_PAR_SLUGOK).toHaveLength(7)
    expect([...APPOINTMENT_CTA_SLUGS]).toEqual([VALL_SLUG])
  })

  it('a hét kéz-cikk kurzus-változat, két testvér-panel, csomagoló nélkül', () => {
    for (const slug of KEZ_CIKK_PAR_SLUGOK) {
      expect(postCtaVariantOf({ slug }), slug).toBe('kurzus')
      const html = renderToStaticMarkup(createElement(PostArticle, { post: cikkPost(slug) }))
      expect(html, slug).not.toContain('kc-post-cta__pair')
      expect(panelSzam(html), slug).toBe(2)
    }
  })

  it('a váll-cikk egyetlen időpont-panelt kap', () => {
    expect(postCtaVariantOf({ slug: VALL_SLUG })).toBe('idopont')
    const html = renderToStaticMarkup(createElement(PostArticle, { post: cikkPost(VALL_SLUG) }))
    expect(html).not.toContain('kc-post-cta__pair')
    expect(panelSzam(html)).toBe(1)
  })
})

describe('Shop — nincs /blog Ads végső URL-konstans a kódban', () => {
  it('a src (teszteken kívül) és a gyökér konfig nem visz Ads-final-URL /blog/ értéket', () => {
    const forrasok = [
      ...fajlok('src', ['src/__tests__']).filter((ut) => /\.(tsx?|js|mjs)$/.test(ut)),
      'next.config.ts',
      'vitest.config.ts',
      'eslint.config.mjs',
    ]
    const talalatok: string[] = []
    for (const ut of forrasok) {
      for (const talalat of adsBlogTalalatok(olvas(ut))) {
        talalatok.push(`${ut}: ${talalat.nev}=${talalat.ertek}`)
      }
    }
    expect(talalatok).toEqual([])
  })

  it('nincs Google Ads API-kliens a package.json függőségeiben', () => {
    expect(csomagFuggosegek()).not.toMatch(/google-ads/i)
    expect(csomagFuggosegek()).not.toMatch(/googleads/i)
  })
})

describe('Shop — ANALYTICS_EVENTS nevei változatlanok', () => {
  it('a regiszter pontosan a zárolt név-térkép', () => {
    expect(ANALYTICS_EVENTS).toEqual(ANALYTICS_EVENTS_ZAR)
  })
})

describe('Shop — consent-kapu: nincs /ingest vagy gtag a hozzájárulás előtt', () => {
  it('az /ingest a PostHog api_host, nem előzetes hálózati hívás', () => {
    expect(POSTHOG_API_HOST).toBe('/ingest')
    const init = fuggvenyTorzs(olvas('src/lib/analytics/posthog.ts'), 'initPostHog')
    expect(init).toMatch(/isPostHogConfigured\(\)/)
    expect(init).toMatch(/hasAnalyticsConsent\(\)/)
    expect(init.indexOf('hasAnalyticsConsent')).toBeLessThan(init.indexOf('posthog.init'))
    expect(init.indexOf('return false')).toBeLessThan(init.indexOf('posthog.init'))
  })

  it('init és capture consent nélkül no-op (kulcs nélkül a tesztkörben)', () => {
    expect(initPostHog()).toBe(false)
    captureAnalyticsEvent('course_viewed', { courseId: 1 })
  })

  it('unknown és denied nem tölti a gtag.js-t', () => {
    resetGoogleAnalyticsForTests()
    const unknown = gaHarness()
    applyConsentToGoogleAnalytics('unknown', unknown.runtime)
    expect(unknown.loaded).toEqual([])
    expect(unknown.commands()).toEqual([])

    resetGoogleAnalyticsForTests()
    const denied = gaHarness()
    applyConsentToGoogleAnalytics('denied', denied.runtime)
    expect(denied.loaded).toEqual([])
    expect(denied.commands()).toEqual([])
  })

  it('a storefront layout és a providerek SSR-kimenete nem visz gtag scriptet', () => {
    const layout = olvas('src/app/(frontend)/layout.tsx')
    expect(layout).not.toContain('googletagmanager.com')
    expect(layout).not.toContain('gtag/js')
    expect(layout).not.toMatch(/['"`]\/ingest['"`]/)

    const ga = olvas('src/components/analytics/GoogleAnalytics.tsx')
    expect(ga).toContain('applyConsentToGoogleAnalytics(readConsent())')
    expect(ga).not.toContain('googletagmanager.com')
    expect(ga).not.toContain('enableGoogleAnalytics(')

    const html = [
      renderToStaticMarkup(createElement(GoogleAnalytics)),
      renderToStaticMarkup(
        createElement(PostHogProvider, null, createElement('div', null, 'tartalom')),
      ),
    ].join('\n')
    expect(html).not.toContain('googletagmanager')
    expect(html).not.toContain('gtag/js')
    expect(html).not.toContain('/ingest')
  })
})

describe('Shop — ad_* denied marad', () => {
  it('a Consent Mode alapjelzés minden tárolóra denied, a granted csak analytics', () => {
    const ga4 = olvas('src/lib/analytics/ga4.ts')
    const alap = objektumLiteral(ga4, 'CONSENT_MODE_DEFAULT')
    expect(alap).toEqual({
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      analytics_storage: 'denied',
    })
    const granted = objektumLiteral(ga4, 'CONSENT_MODE_GRANTED')
    expect(granted).toEqual({ analytics_storage: 'granted' })
    expect(Object.keys(granted).some((kulcs) => kulcs.startsWith('ad_'))).toBe(false)
  })

  it('a granted consent update egyetlen ad_* kulcsot sem nyit ki', () => {
    resetGoogleAnalyticsForTests()
    const harness = gaHarness()
    enableGoogleAnalytics(harness.runtime)
    const update = harness
      .commands()
      .find((parancs) => parancs[0] === 'consent' && parancs[1] === 'update')
    expect(update).toBeDefined()
    const payload = update![2]
    expect(payload).toEqual({ analytics_storage: 'granted' })
    if (typeof payload === 'object' && payload !== null) {
      const rekord = payload as Record<string, unknown>
      for (const [kulcs, ertek] of Object.entries(rekord)) {
        if (kulcs.startsWith('ad_')) {
          expect(ertek, kulcs).toBe('denied')
        }
      }
    }
  })
})
