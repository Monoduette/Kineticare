import { describe, expect, it } from 'vitest'

import {
  buildContentSecurityPolicy,
  BUNNY_PULL_ZONE_WILDCARD_SOURCE,
  BUNNY_STREAM_IFRAME_SOURCE,
  bunnyPullZoneSource,
  GA_COLLECT_SOURCES,
} from '../../lib/security/csp'

/**
 * CSP-regressziós tesztek (C2).
 *
 * A legfontosabb védendő hiba: a CSP host-forrásában a joker (`*`) KIZÁRÓLAG a
 * legbaloldalibb, TELJES címke helyén állhat. A `https://vz-*.b-cdn.net` alak
 * ezért ÉRVÉNYTELEN — a böngésző NÉMÁN eldobja, és a Bunny pull-zone hostja
 * egyáltalán nem kerül fel a listára (fekete lejátszó, csak konzolhibával).
 * Ugyanez a hiba élt korábban a `https://customer-*.cloudflarestream.com`
 * mintában, valódi Chromiumban bizonyítva: docs/video-stream-keszenlet.md
 * „A CSP-javítás bizonyítéka".
 */

/** A fejléc egy direktívájának forrásait adja vissza (a direktíva neve nélkül). */
function directive(csp: string, name: string): string[] {
  const found = csp.split('; ').find((entry) => entry === name || entry.startsWith(`${name} `))
  expect(found, `hiányzó direktíva: ${name}`).toBeDefined()
  return (found as string).split(' ').slice(1)
}

describe('bunnyPullZoneSource', () => {
  it('hosztnév nélkül a SZABÁLYOS, egy címkés jokerre esik vissza', () => {
    expect(bunnyPullZoneSource(undefined)).toBe(BUNNY_PULL_ZONE_WILDCARD_SOURCE)
    expect(bunnyPullZoneSource('')).toBe(BUNNY_PULL_ZONE_WILDCARD_SOURCE)
    expect(bunnyPullZoneSource('   ')).toBe(BUNNY_PULL_ZONE_WILDCARD_SOURCE)
  })

  it('ismert hosztnévvel a PONTOS hostot adja (joker nélkül)', () => {
    expect(bunnyPullZoneSource('vz-1a2b3c4d-5e6.b-cdn.net')).toBe(
      'https://vz-1a2b3c4d-5e6.b-cdn.net',
    )
    expect(bunnyPullZoneSource('  vz-abc123.b-cdn.net  ')).toBe('https://vz-abc123.b-cdn.net')
    // A DNS-név nem kis-nagybetű-érzékeny — a nagybetűs env se essen jokerre.
    expect(bunnyPullZoneSource('VZ-ABC123.B-CDN.NET')).toBe('https://vz-abc123.b-cdn.net')
  })

  it('gyanús env-értéket nem enged a fejlécbe — fejléc-injekció ellen', () => {
    for (const evil of [
      'vz-abc.b-cdn.net; script-src *',
      'vz abc.b-cdn.net',
      'vz-abc.b-cdn.net/utvonal',
      'https://vz-abc.b-cdn.net',
      'vz-abc.evil.example',
      'vz-abc.b-cdn.net.evil.example',
      'sub.vz-abc.b-cdn.net',
      '*',
    ]) {
      expect(bunnyPullZoneSource(evil), evil).toBe(BUNNY_PULL_ZONE_WILDCARD_SOURCE)
    }
  })

  it('a `vz-*` JOKER-alak érvénytelen forrás — sosem adhatja vissza', () => {
    expect(bunnyPullZoneSource('vz-*.b-cdn.net')).toBe(BUNNY_PULL_ZONE_WILDCARD_SOURCE)
    expect(bunnyPullZoneSource('vz-*.b-cdn.net')).not.toContain('vz-*')
  })
})

describe('buildContentSecurityPolicy — a bizonyított hiba nem térhet vissza', () => {
  it('SEHOL nem szerepel érvénytelen, címke-belseji joker (`vz-*` / `customer-*`)', () => {
    for (const csp of [
      buildContentSecurityPolicy(),
      buildContentSecurityPolicy('vz-abc123.b-cdn.net'),
      buildContentSecurityPolicy('vz-*.b-cdn.net'),
      buildContentSecurityPolicy('vz abc'),
    ]) {
      expect(csp).not.toContain('vz-*')
      expect(csp).not.toContain('customer-*')
      // A joker csak TELJES címke helyén állhat: a `*` előtt mindig `//` vagy
      // pont áll (pl. https://*.b-cdn.net), sosem betű/kötőjel.
      expect(csp).not.toMatch(/[a-z0-9-]\*/)
    }
  })

  it('a Bunny pull-zone hostja az img-src és a media-src direktívában ott van', () => {
    const csp = buildContentSecurityPolicy()
    for (const name of ['img-src', 'media-src']) {
      expect(directive(csp, name), name).toContain(BUNNY_PULL_ZONE_WILDCARD_SOURCE)
    }
  })

  it('ismert hosztnévvel a pontos host kerül a fejlécbe, joker nélkül', () => {
    const csp = buildContentSecurityPolicy('vz-abc123.b-cdn.net')
    const exact = 'https://vz-abc123.b-cdn.net'
    for (const name of ['img-src', 'media-src']) {
      expect(directive(csp, name), name).toContain(exact)
      expect(directive(csp, name), name).not.toContain(BUNNY_PULL_ZONE_WILDCARD_SOURCE)
    }
  })

  it('a Cloudflare Stream forrásai KIKERÜLTEK (elfelejtett domain-csere ellen)', () => {
    for (const csp of [buildContentSecurityPolicy(), buildContentSecurityPolicy('vz-a.b-cdn.net')]) {
      expect(csp).not.toContain('cloudflarestream.com')
      expect(csp).not.toContain('videodelivery.net')
    }
  })
})

describe('buildContentSecurityPolicy — direktívák', () => {
  const csp = buildContentSecurityPolicy()

  it('media-src blob: — enélkül a kezdőlap LOKÁLIS filmsávja (ScrollScrub) elhal', () => {
    expect(directive(csp, 'media-src')).toContain('blob:')
  })

  it('worker-src blob: — a PostHog session replay tömörítő workeréhez', () => {
    expect(directive(csp, 'worker-src')).toEqual(["'self'", 'blob:'])
  })

  it("connect-src 'self' — a PostHog a /ingest elsőfél-proxyn megy", () => {
    // Iframe-es lejátszásnál a videó-kérések az iframe dokumentumából mennek,
    // arra a beágyazott oldal saját CSP-je vonatkozik — a pull-zone host ide
    // NEM kell (csak saját <video> + hls.js lejátszó esetén kellene).
    expect(directive(csp, 'connect-src')).toEqual(["'self'"])
  })

  /**
   * A szabály SZŰKÜLT, nem eltűnt.
   *
   * Korábban a `mediadelivery.net` EGYETLEN hostja sem kaphatott script-jogot,
   * mert a lejátszó kizárólag iframe-ként volt beágyazva. Az automatikus
   * haladás-jelöléshez viszont a Bunny HIVATALOS player.js könyvtárát töltjük
   * be — tudatos, emberi döntéssel (lásd a csp.ts `script-src` kommentjét és
   * az src/lib/stream/playerjs-loader.ts fejlécét): rögzített verziójú URL-ről,
   * integritás-hash-sel, saját postMessage-tartalékkal.
   *
   * Ami VÁLTOZATLANUL tilos: a lejátszó KERETÉNEK hostja
   * (`iframe.mediadelivery.net`) és a média pull-zone (`b-cdn.net`) SOHA nem
   * kaphat script-jogot a mi dokumentumunkban — az iframe-en belüli scriptekre
   * a beágyazott oldal saját CSP-je vonatkozik.
   */
  it('script-src: Turnstile és a player.js CDN igen — az iframe- és média-host NEM', () => {
    const sources = directive(csp, 'script-src')
    expect(sources).toContain('https://challenges.cloudflare.com')
    expect(sources).toContain('https://assets.mediadelivery.net')
    expect(sources.some((source) => source.includes('iframe.mediadelivery.net'))).toBe(false)
    expect(sources.some((source) => source.includes('b-cdn.net'))).toBe(false)
  })

  it("script-src: 'unsafe-eval' TILOS (a Next.js inline bootstrap miatt csak 'unsafe-inline' kell)", () => {
    expect(directive(csp, 'script-src')).toContain("'unsafe-inline'")
    expect(csp).not.toContain("'unsafe-eval'")
  })

  it('frame-src: a Bunny lejátszó és a szerkesztői videó-beágyazás hostjai', () => {
    const sources = directive(csp, 'frame-src')
    // Ugyanaz a host viszi a hero-videót, az előzetest és a védett lejátszót.
    expect(sources).toContain(BUNNY_STREAM_IFRAME_SOURCE)
    expect(BUNNY_STREAM_IFRAME_SOURCE).toBe('https://iframe.mediadelivery.net')
    expect(sources).toContain('https://www.youtube-nocookie.com')
    expect(sources).toContain('https://player.vimeo.com')
    expect(sources).toContain('https://challenges.cloudflare.com')
  })

  it('a szigorító alapdirektívák megvannak', () => {
    expect(directive(csp, 'default-src')).toEqual(["'self'"])
    expect(directive(csp, 'object-src')).toEqual(["'none'"])
    expect(directive(csp, 'base-uri')).toEqual(["'self'"])
    expect(directive(csp, 'form-action')).toEqual(["'self'"])
    expect(directive(csp, 'frame-ancestors')).toEqual(["'self'"])
    expect(directive(csp, 'font-src')).toEqual(["'self'"])
  })

  it('GA4 nélkül EGYETLEN Google-host sincs a fejlécben (legszűkebb politika)', () => {
    for (const withoutGa of [
      buildContentSecurityPolicy(),
      buildContentSecurityPolicy('vz-abc123.b-cdn.net'),
      // Formailag hibás azonosító nem nyithatja meg a hostokat.
      buildContentSecurityPolicy(undefined, 'UA-12345-1'),
      buildContentSecurityPolicy(undefined, '   '),
    ]) {
      expect(withoutGa).not.toContain('googletagmanager.com')
      expect(withoutGa).not.toContain('google-analytics.com')
      expect(withoutGa).not.toContain('analytics.google.com')
    }
  })

  it('beállított GA4-azonosítóval a gtag.js hostja a script-src-be kerül', () => {
    const withGa = buildContentSecurityPolicy(undefined, 'G-TESTONLY00')
    expect(directive(withGa, 'script-src')).toContain('https://www.googletagmanager.com')
    // A Turnstile forrása nem tűnhet el mellőle.
    expect(directive(withGa, 'script-src')).toContain('https://challenges.cloudflare.com')
  })

  it('beállított GA4-azonosítóval a gyűjtőhostok a connect-src-ben (régió-jokerrel)', () => {
    const sources = directive(buildContentSecurityPolicy(undefined, 'G-TESTONLY00'), 'connect-src')
    expect(sources).toContain("'self'")
    for (const collect of GA_COLLECT_SOURCES) {
      expect(sources, collect).toContain(collect)
    }
    expect(GA_COLLECT_SOURCES).toContain('https://*.google-analytics.com')
  })

  it('beállított GA4-azonosítóval a képpont-tartalék az img-src-ben van', () => {
    const sources = directive(buildContentSecurityPolicy(undefined, 'G-TESTONLY00'), 'img-src')
    expect(sources).toContain('https://*.google-analytics.com')
    expect(sources).toContain('https://www.googletagmanager.com')
    // A Bunny pull-zone forrása nem eshet ki a GA hostjai mellől.
    expect(sources).toContain(BUNNY_PULL_ZONE_WILDCARD_SOURCE)
  })

  it('a GA4 hostjai NEM lazítanak fel más direktívát (frame-src, default-src)', () => {
    const withGa = buildContentSecurityPolicy(undefined, 'G-TESTONLY00')
    expect(directive(withGa, 'default-src')).toEqual(["'self'"])
    expect(directive(withGa, 'frame-src').some((source) => source.includes('google'))).toBe(false)
    expect(withGa).not.toContain("'unsafe-eval'")
    // A GA jokerei is szabályosak: teljes címke helyén állnak.
    expect(withGa).not.toMatch(/[a-z0-9-]\*/)
  })

  it('PostHog-dashboard env nélkül az eu.posthog.com NINCS a fejlécben', () => {
    for (const withoutEmbed of [
      buildContentSecurityPolicy(),
      // Formailag hibás vagy idegen hostra mutató link sem nyithatja meg.
      buildContentSecurityPolicy(undefined, undefined, undefined, 'nem-url'),
      buildContentSecurityPolicy(
        undefined,
        undefined,
        undefined,
        'https://evil.example/shared/AbCd1234xyz',
      ),
      buildContentSecurityPolicy(
        undefined,
        undefined,
        undefined,
        'https://eu.posthog.com/project/253152',
      ),
    ]) {
      expect(withoutEmbed).not.toContain('eu.posthog.com')
    }
  })

  it('érvényes megosztási linkkel az eu.posthog.com KIZÁRÓLAG a frame-src-be kerül', () => {
    const withEmbed = buildContentSecurityPolicy(
      undefined,
      undefined,
      undefined,
      'https://eu.posthog.com/shared/AbCd1234xyz',
    )
    expect(directive(withEmbed, 'frame-src')).toContain('https://eu.posthog.com')
    // Más direktívát nem lazít: script/connect/img változatlan.
    for (const name of ['script-src', 'connect-src', 'img-src', 'default-src']) {
      expect(
        directive(withEmbed, name).some((source) => source.includes('posthog')),
        name,
      ).toBe(false)
    }
    // A frame-src eddigi forrásai nem tűnhetnek el mellőle.
    expect(directive(withEmbed, 'frame-src')).toContain(BUNNY_STREAM_IFRAME_SOURCE)
  })

  it('a fejléc szintaktikailag ép: nincs üres vagy duplikált direktíva', () => {
    // A GA-forrásokkal bővített változat is: dupla szóköz vagy üres forrás
    // csendben elrontaná a fejlécet.
    for (const value of [
      csp,
      buildContentSecurityPolicy('vz-a.b-cdn.net', 'G-TESTONLY00'),
      buildContentSecurityPolicy(
        'vz-a.b-cdn.net',
        'G-TESTONLY00',
        undefined,
        'https://eu.posthog.com/shared/AbCd1234xyz',
      ),
    ]) {
      const names = value.split('; ').map((entry) => entry.split(' ')[0])
      expect(names.every((name) => name.length > 0)).toBe(true)
      expect(new Set(names).size).toBe(names.length)
      expect(value).not.toContain(';;')
      expect(value).not.toContain('  ')
      expect(value.endsWith(';')).toBe(false)
    }
  })
})
