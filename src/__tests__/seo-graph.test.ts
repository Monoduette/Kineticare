import { describe, expect, it } from 'vitest'

import {
  absoluteUrl,
  breadcrumbJsonLd,
  courseJsonLd,
  ORGANIZATION_ID,
  organizationJsonLd,
  webPageId,
  WEBSITE_ID,
  webSiteJsonLd,
} from '../lib/seo'
import { cmsPageJsonLd, postArticleJsonLd } from '../lib/seo-cikk'
import {
  anchorSlug,
  contactDataFromLayout,
  contactOrganizationNode,
  graphIds,
  medicalBusinessNodes,
  personNodes,
  postalAddressNode,
  serviceNodesFromLayout,
  siteGraphJsonLd,
  teamPersonsFromLayout,
  telephoneUri,
} from '../lib/seo-graph'
import type { Page } from '../payload-types'

/**
 * Őr: az oldal-gráf érvényes és összefüggő.
 *
 * - Minden csomópontnak van `@type`; a nevesített csomópontok `@id`-ja egyedi.
 * - Minden `{"@id": …}` hivatkozás feloldható: a gráfon belül, vagy a két
 *   állandó entitásra (szervezet, webhely) mutat, amelyek a kezdőlapon külön
 *   scriptben állnak.
 * - Nincs `undefined`, `null` vagy üres string érték (a Google Rich Results
 *   Test hibának veszi az üres mezőt; *General structured data guidelines*:
 *   https://developers.google.com/search/docs/appearance/structured-data/sd-policies).
 * - Csak CMS-ből/kódból ismert adat: nyitvatartás, geo, sameAs NINCS.
 */

const KNOWN_IDS = new Set([ORGANIZATION_ID, WEBSITE_ID])

function walk(value: unknown, path: string, visit: (value: unknown, path: string) => void): void {
  visit(value, path)
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, visit))
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      walk(item, `${path}.${key}`, visit)
    }
  }
}

function assertNoEmptyValues(graph: unknown): void {
  walk(graph, '$', (value, path) => {
    expect(value, path).not.toBeUndefined()
    expect(value, path).not.toBeNull()
    if (typeof value === 'string') expect(value.length, path).toBeGreaterThan(0)
    if (Array.isArray(value)) expect(value.length, path).toBeGreaterThan(0)
  })
}

/** Minden @id-val DEFINIÁLT csomópont (nem csak hivatkozás), beágyazva is. */
function definedIds(graph: unknown): string[] {
  const ids: string[] = []
  walk(graph, '$', (value) => {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const record = value as Record<string, unknown>
      if (typeof record['@id'] === 'string' && Object.keys(record).length > 1)
        ids.push(record['@id'])
    }
  })
  return ids
}

function assertResolvableIds(graph: Record<string, unknown>): void {
  const ids = graphIds(graph)
  expect(new Set(ids).size, 'egyedi @id-k').toBe(ids.length)
  const known = new Set([...definedIds(graph), ...KNOWN_IDS])
  walk(graph, '$', (value, path) => {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const record = value as Record<string, unknown>
      const keys = Object.keys(record)
      if (keys.length === 1 && keys[0] === '@id') {
        expect(known.has(String(record['@id'])), `${path}: ${String(record['@id'])}`).toBe(true)
      }
    }
  })
}

function nodesOf(graph: Record<string, unknown>): Record<string, unknown>[] {
  return graph['@graph'] as Record<string, unknown>[]
}

function typeOf(node: Record<string, unknown>): string[] {
  const type = node['@type']
  return Array.isArray(type) ? type.map(String) : [String(type)]
}

const KAPCSOLAT_LAYOUT = [
  {
    blockType: 'appointment',
    title: 'Kérj időpontot a rendelőbe',
    helyszinek: [
      { cim: '1117 Budapest, Nádorliget u. 7/b' },
      { cim: '1114 Budapest, Fadrusz utca 15.' },
    ],
    telefonszamok: [
      { nev: 'Kocsis Kata', szam: '+36 30 169 2263' },
      { nev: 'Kiss Kata', szam: '+36 20 357 3493' },
    ],
    email: 'info@kineticare.hu',
  },
  {
    blockType: 'teamMembers',
    title: 'Kit hívj?',
    members: [
      {
        name: 'Kocsis Kata',
        role: 'Gyógytornász, sportrehabilitációs tréner, gyógy- és sportmasszőr',
        bio: 'Kézsérülésekkel, műtét utáni állapotokkal és sportolói panaszokkal foglalkozik.',
        phone: '+36 30 169 2263',
        photo: { id: 1, alt: 'Kocsis Kata portréja', url: '/media/kocsis.png' },
      },
      {
        name: 'Kiss Kata',
        role: 'Gyógytornász, manuálterapeuta, sportrehabilitációs tréner',
        bio: 'Manuálterapeutaként a csukló- és kézpanaszok hátterét keresi.',
        phone: '+36 20 357 3493',
        email: '',
      },
    ],
  },
] as unknown as NonNullable<Page['layout']>

const SZOLGALTATASOK_LAYOUT = [
  {
    blockType: 'services',
    title: 'Válaszd ki, hogyan segíthetünk',
    rows: [
      {
        title: 'Rendelői kezelések',
        body: 'Egyénre szabott gyógytorna.',
        url: '/kapcsolat#idopontkeres',
      },
      { title: 'Otthoni online program', body: 'Videós gyakorlatsorok.', url: '/kurzusok' },
      {
        title: 'Szakmai képzések',
        body: 'Akkreditált tantermi képzés.',
        url: 'https://probodystudio.hu/kez-workshop/',
      },
      { title: '   ', body: 'üres sor nem kerül be' },
    ],
  },
] as unknown as NonNullable<Page['layout']>

describe('siteGraphJsonLd — alap gráf', () => {
  const graph = siteGraphJsonLd({
    page: { path: '/kurzusok', name: 'Kurzusok', description: 'Leírás.', type: 'CollectionPage' },
    breadcrumbs: [
      { name: 'Kezdőlap', path: '/' },
      { name: 'Kurzusok', path: '/kurzusok' },
    ],
  })

  it('Organization + WebSite + WebPage + BreadcrumbList, közös @context alatt', () => {
    expect(graph['@context']).toBe('https://schema.org')
    const types = nodesOf(graph).flatMap(typeOf)
    expect(types).toEqual(['Organization', 'WebSite', 'CollectionPage', 'BreadcrumbList'])
  })

  it('a WebPage a webhelyre, a szervezetre és a morzsára @id-vel hivatkozik', () => {
    const page = nodesOf(graph)[2]!
    expect(page['@id']).toBe(webPageId('/kurzusok'))
    expect(page.isPartOf).toEqual({ '@id': WEBSITE_ID })
    expect(page.publisher).toEqual({ '@id': ORGANIZATION_ID })
    expect(page.breadcrumb).toEqual({ '@id': `${absoluteUrl('/kurzusok')}#breadcrumb` })
    expect(page.inLanguage).toBe('hu-HU')
  })

  it('minden hivatkozott @id feloldható, nincs üres érték', () => {
    assertResolvableIds(graph)
    assertNoEmptyValues(graph)
  })

  it('egyelemű morzsa nem kerül ki (nem útvonal), és a WebPage sem hivatkozik rá', () => {
    const single = siteGraphJsonLd({
      page: { path: '/', name: 'Kezdőlap' },
      breadcrumbs: [{ name: 'Kezdőlap', path: '/' }],
    })
    expect(nodesOf(single).flatMap(typeOf)).not.toContain('BreadcrumbList')
    expect('breadcrumb' in nodesOf(single)[2]!).toBe(false)
  })

  it('breadcrumbRef: a WebPage hivatkozik a máshol renderelt morzsára, de nem duplázza', () => {
    const ref = siteGraphJsonLd({
      page: {
        path: '/blog/cikk',
        name: 'Cikk',
        mainEntityId: `${absoluteUrl('/blog/cikk')}#article`,
      },
      breadcrumbRef: true,
    })
    const page = nodesOf(ref)[2]!
    expect(page.breadcrumb).toEqual({ '@id': `${absoluteUrl('/blog/cikk')}#breadcrumb` })
    expect(page.mainEntity).toEqual({ '@id': `${absoluteUrl('/blog/cikk')}#article` })
    expect(nodesOf(ref).flatMap(typeOf)).not.toContain('BreadcrumbList')
    // A külön scriptben álló morzsa és cikk ugyanezt az @id-t viseli.
    expect(
      breadcrumbJsonLd([
        { name: 'Tudástár', path: '/blog' },
        { name: 'Cikk', path: '/blog/cikk' },
      ])['@id'],
    ).toBe(`${absoluteUrl('/blog/cikk')}#breadcrumb`)
    expect(postArticleJsonLd({ post: { title: 'Cikk' }, path: '/blog/cikk' })['@id']).toBe(
      `${absoluteUrl('/blog/cikk')}#article`,
    )
  })

  it('üres dátum nem kerül a WebPage-be', () => {
    const graph2 = siteGraphJsonLd({
      page: { path: '/x', name: 'X', dateModified: '', datePublished: null },
    })
    const page = nodesOf(graph2)[2]!
    expect('dateModified' in page).toBe(false)
    expect('datePublished' in page).toBe(false)
  })

  it('organization: null → a szervezet másik scriptben áll (kezdőlap), a gráf nem duplázza', () => {
    const home = siteGraphJsonLd({ page: { path: '/', name: 'Kezdőlap' }, organization: null })
    expect(nodesOf(home).flatMap(typeOf)).toEqual(['WebSite', 'WebPage'])
  })
})

describe('Organization és WebSite csomópont', () => {
  it('a szervezet @id-val, logóval, e-maillel, contactPoint-tal áll; sameAs nincs (nincs forrás)', () => {
    const org = organizationJsonLd()
    expect(org['@id']).toBe(ORGANIZATION_ID)
    expect((org.logo as Record<string, unknown>)['@type']).toBe('ImageObject')
    expect(String((org.logo as Record<string, unknown>).url)).toMatch(/\/apple-icon\.png$/)
    expect(org.email).toBe('info@kineticare.hu')
    expect(Array.isArray(org.contactPoint)).toBe(true)
    expect('sameAs' in org).toBe(false)
    expect('openingHours' in org).toBe(false)
    assertNoEmptyValues(org)
  })

  it('a WebSite a szervezetre mutat, SearchAction nélkül (nincs kereső)', () => {
    const site = webSiteJsonLd()
    expect(site['@id']).toBe(WEBSITE_ID)
    expect(site.publisher).toEqual({ '@id': ORGANIZATION_ID })
    expect('potentialAction' in site).toBe(false)
  })

  it('a cikk- és hub-séma kiadója ugyanaz az entitás (@id)', () => {
    const cikk = postArticleJsonLd({ post: { title: 'Cikk' }, path: '/blog/cikk' })
    const hub = cmsPageJsonLd({ page: { title: 'Hub' }, path: '/hub' })
    expect((cikk.publisher as Record<string, unknown>)['@id']).toBe(ORGANIZATION_ID)
    expect((hub.publisher as Record<string, unknown>)['@id']).toBe(ORGANIZATION_ID)
    expect(hub['@id']).toBe(webPageId('/hub'))
  })

  it('a kurzus-csomópont @id-ja a lap fő entitása, a szolgáltató a szervezet', () => {
    const course = courseJsonLd({
      product: { shortDescription: 'x', status: 'published', sku: 'K', seoKeywords: null },
      name: 'K',
      path: '/kurzusok/k',
      priceHuf: 1000,
    })
    expect(course['@id']).toBe(`${absoluteUrl('/kurzusok/k')}#course`)
    expect((course.provider as Record<string, unknown>)['@id']).toBe(ORGANIZATION_ID)
    expect(course.mainEntityOfPage).toEqual({ '@id': webPageId('/kurzusok/k') })
  })
})

describe('Kapcsolat: ContactPage + MedicalBusiness a CMS-ből', () => {
  const contact = contactDataFromLayout(KAPCSOLAT_LAYOUT)

  it('a címek, telefonok, e-mail a blokkból, ismétlés nélkül', () => {
    expect(contact.addresses).toHaveLength(2)
    expect(contact.telephones).toEqual([
      { name: 'Kocsis Kata', number: '+36 30 169 2263' },
      { name: 'Kiss Kata', number: '+36 20 357 3493' },
    ])
    expect(contact.email).toBe('info@kineticare.hu')
  })

  it('magyar postacím → PostalAddress; ismeretlen alak szövegként marad', () => {
    expect(postalAddressNode('1117 Budapest, Nádorliget u. 7/b')).toEqual({
      '@type': 'PostalAddress',
      streetAddress: 'Nádorliget u. 7/b',
      addressLocality: 'Budapest',
      postalCode: '1117',
      addressCountry: 'HU',
    })
    expect(postalAddressNode('Online rendelés')).toBe('Online rendelés')
    expect(telephoneUri('+36 30 169 2263')).toBe('+36301692263')
  })

  it('telephelyenként egy MedicalBusiness, közös szülőszervezettel, nyitvatartás és geo nélkül', () => {
    const nodes = medicalBusinessNodes(contact)
    expect(nodes).toHaveLength(2)
    for (const node of nodes) {
      expect(node['@type']).toBe('MedicalBusiness')
      expect(node.parentOrganization).toEqual({ '@id': ORGANIZATION_ID })
      expect('openingHoursSpecification' in node).toBe(false)
      expect('geo' in node).toBe(false)
    }
    // schema.org Place.hasMap: ugyanaz a Google Térkép-link, amit a vevő a
    // felületen kattint (src/lib/maps-href.ts).
    expect(nodes[0]!.hasMap).toBe(
      'https://www.google.com/maps/search/?api=1&query=1117%20Budapest%2C%20N%C3%A1dorliget%20u.%207%2Fb',
    )
    expect(nodes[1]!.hasMap).toBe(
      'https://www.google.com/maps/search/?api=1&query=1114%20Budapest%2C%20Fadrusz%20utca%2015.',
    )
    expect(nodes[0]!['@id']).not.toBe(nodes[1]!['@id'])
  })

  it('a teljes Kapcsolat-gráf összefüggő és üres érték nélküli', () => {
    const graph = siteGraphJsonLd({
      page: { path: '/kapcsolat', name: 'Kapcsolat', description: 'x', type: 'ContactPage' },
      breadcrumbs: [
        { name: 'Kezdőlap', path: '/' },
        { name: 'Kapcsolat', path: '/kapcsolat' },
      ],
      organization: contactOrganizationNode(contact),
      nodes: [
        ...medicalBusinessNodes(contact),
        ...personNodes(teamPersonsFromLayout(KAPCSOLAT_LAYOUT)),
      ],
    })
    expect(nodesOf(graph).flatMap(typeOf)).toEqual([
      'Organization',
      'WebSite',
      'ContactPage',
      'BreadcrumbList',
      'MedicalBusiness',
      'MedicalBusiness',
      'Person',
      'Person',
    ])
    const org = nodesOf(graph)[0]!
    expect(org.telephone).toEqual(['+36301692263', '+36203573493'])
    expect((org.contactPoint as unknown[]).length).toBe(3)
    assertResolvableIds(graph)
    assertNoEmptyValues(graph)
  })

  it('üres layoutnál nincs telephely és nincs telefon, de a gráf érvényes marad', () => {
    const empty = contactDataFromLayout([])
    expect(medicalBusinessNodes(empty)).toEqual([])
    const org = contactOrganizationNode(empty)
    expect('telephone' in org).toBe(false)
    expect('location' in org).toBe(false)
    assertNoEmptyValues(org)
  })
})

describe('Rólunk: AboutPage + Person a csapat-blokkból', () => {
  const persons = teamPersonsFromLayout(KAPCSOLAT_LAYOUT)

  it('név, titulus (jobTitle), leírás, kép, telefon — üres e-mail kimarad', () => {
    expect(persons).toHaveLength(2)
    expect(persons[0]).toMatchObject({
      name: 'Kocsis Kata',
      jobTitle: 'Gyógytornász, sportrehabilitációs tréner, gyógy- és sportmasszőr',
      telephone: '+36301692263',
      imageUrl: absoluteUrl('/media/kocsis.png'),
    })
    expect('email' in persons[1]!).toBe(false)
    expect('imageUrl' in persons[1]!).toBe(false)
  })

  it('Person csomópont: @id a /rolunk horgonya, worksFor a szervezet, sameAs nincs', () => {
    const nodes = personNodes(persons)
    expect(nodes[0]!['@id']).toBe(`${absoluteUrl('/rolunk')}#kocsis-kata`)
    expect(nodes[0]!.worksFor).toEqual({ '@id': ORGANIZATION_ID })
    expect(nodes[0]!.jobTitle).not.toContain('Kocsis')
    expect('sameAs' in nodes[0]!).toBe(false)
    expect(anchorSlug('Kiss Kata')).toBe('kiss-kata')
    const graph = siteGraphJsonLd({
      page: { path: '/rolunk', name: 'A kéz a mindenünk', type: 'AboutPage' },
      breadcrumbs: [
        { name: 'Kezdőlap', path: '/' },
        { name: 'A kéz a mindenünk', path: '/rolunk' },
      ],
      nodes,
    })
    assertResolvableIds(graph)
    assertNoEmptyValues(graph)
  })
})

describe('Szolgáltatások: Service csomópontok a services-blokkból', () => {
  it('soronként egy Service, Offer nélkül (az ár szabad szöveg, nem mező)', () => {
    const nodes = serviceNodesFromLayout(SZOLGALTATASOK_LAYOUT)
    expect(nodes).toHaveLength(3)
    expect(nodes[0]).toMatchObject({
      '@type': 'Service',
      name: 'Rendelői kezelések',
      description: 'Egyénre szabott gyógytorna.',
      url: absoluteUrl('/kapcsolat#idopontkeres'),
      provider: { '@id': ORGANIZATION_ID },
    })
    expect(nodes[2]!.url).toBe('https://probodystudio.hu/kez-workshop/')
    for (const node of nodes) expect('offers' in node).toBe(false)
    const graph = siteGraphJsonLd({
      page: { path: '/szolgaltatasok', name: 'Szolgáltatások' },
      breadcrumbs: [
        { name: 'Kezdőlap', path: '/' },
        { name: 'Szolgáltatások', path: '/szolgaltatasok' },
      ],
      nodes,
    })
    assertResolvableIds(graph)
    assertNoEmptyValues(graph)
  })
})
