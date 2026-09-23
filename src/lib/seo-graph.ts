import type { Media, Page } from '../payload-types'
import { mapsHref } from './maps-href'
import { isSectionHidden } from './section-row-label'
import {
  absoluteUrl,
  breadcrumbId,
  breadcrumbJsonLd,
  organizationNode,
  organizationRef,
  webPageJsonLd,
  webSiteNode,
  ORGANIZATION_ID,
} from './seo'

/**
 * Az oldal-gráf: WebSite + Organization + WebPage + BreadcrumbList egy
 * `@graph`-ban, lapfüggő kiegészítő csomópontokkal (AboutPage + Person a
 * /rolunk-on, ContactPage + MedicalBusiness a /kapcsolat-on, Service a
 * /szolgaltatasok-on).
 *
 * MIÉRT EGY GRÁF. A schema.org JSON-LD-ben egy `@id` egy entitást jelöl; ha a
 * WebPage az `isPartOf`-ban a WebSite-ra, a `publisher`-ben a szervezetre, a
 * `breadcrumb`-ban a morzsalistára mutat, a gépi olvasó (Google, AI-ágens)
 * a lapot a webhely és a szervezet részeként érti, nem különálló darabként
 * (schema.org data model: https://schema.org/docs/datamodel.html; Google
 * *General structured data guidelines*, „Multiple elements on a page”:
 * https://developers.google.com/search/docs/appearance/structured-data/sd-policies).
 * A `docs/seo-geo-llm.md` alapelve is ez: az AI-válaszokban az entitás
 * (Kineticare = két nevesített gyógytornász, budapesti rendelő, online
 * program) egyértelmű azonosítása a láthatóság előfeltétele.
 *
 * Minden mező a lapon LÁTHATÓ vagy a CMS-ben rögzített adatból jön. Cím,
 * telefon, e-mail a Kapcsolat-lap időpontkérő blokkjából, a személyek a
 * csapat-blokkból; nyitvatartás, geokoordináta, közösségi profil NINCS a
 * CMS-ben, ezért a séma sem hirdeti (kitalálni tilos).
 *
 * REJTETT SZEKCIÓ NEM FORRÁS (modul-térkép H46): a szerkesztő által elrejtett
 * (`sectionSettings.visible === false`) szekció a lapon nem renderelődik
 * (RenderBlocks), ezért az időpontkérő, a csapat- és a szolgáltatás-blokk
 * bejárása is átugorja. A döntés a sorcímkével és a lappal közös
 * `isSectionHidden` (src/lib/section-row-label.ts). Google Search Central,
 * General structured data guidelines, Quality guidelines, Content: „Don't mark
 * up content that is not visible to readers of the page.”
 * https://developers.google.com/search/docs/appearance/structured-data/sd-policies
 */

/** Egy `@type` érték: egy vagy több típus (pl. `['WebPage', 'MedicalWebPage']`). */
type PageType = NonNullable<Parameters<typeof webPageJsonLd>[0]['type']>

export interface SiteGraphPage {
  path: string
  name: string
  description?: string
  type?: PageType
  keywords?: readonly string[]
  imageUrl?: string
  datePublished?: string | null
  dateModified?: string | null
  /** A lap fő entitásának `@id`-ja (pl. a Course vagy az Article csomópont). */
  mainEntityId?: string
}

export interface SiteGraphArgs {
  page: SiteGraphPage
  /**
   * A morzsa elemei. Ha meg van adva, a gráf építi a BreadcrumbList csomópontot.
   * Egyelemű lista nem morzsa: a Google legalább két elemet vár a
   * BreadcrumbList-ben, hogy útvonalat jelöljön (Google *Breadcrumb*:
   * https://developers.google.com/search/docs/appearance/structured-data/breadcrumb),
   * ezért a kezdőlap és a szekció-gyökerek nem kapnak egyelemű listát.
   */
  breadcrumbs?: ReadonlyArray<{ name: string; path: string }>
  /**
   * `true`, ha a morzsalistát MÁSIK script rendereli (PostArticle), és a
   * WebPage csak hivatkozik rá `@id`-vel — így ugyanaz a lista nem íródik le
   * kétszer.
   */
  breadcrumbRef?: boolean
  /**
   * A szervezet csomópontja. Alapból a lapfüggetlen `organizationNode()`;
   * a Kapcsolat-lap a CMS-adatokkal bővített változatot adja át. `null`, ha
   * a lap MÁSIK scriptben rendereli a szervezetet (kezdőlap, HomeView).
   */
  organization?: Record<string, unknown> | null
  /** Lapfüggő kiegészítő csomópontok (Person, Service, MedicalBusiness…). */
  nodes?: ReadonlyArray<Record<string, unknown>>
}

/** Egy csomópont `@context` nélkül (a gráf közös kontextusa alá). */
function withoutContext(node: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...node }
  delete rest['@context']
  return rest
}

/**
 * A lap teljes `@graph`-ja egyetlen JSON-LD dokumentumként.
 */
export function siteGraphJsonLd(args: SiteGraphArgs): Record<string, unknown> {
  const { page, breadcrumbs, breadcrumbRef, nodes } = args
  const organization = args.organization === undefined ? organizationNode() : args.organization
  const hasBreadcrumb =
    (breadcrumbs !== undefined && breadcrumbs.length >= 2) || breadcrumbRef === true
  const webPage = withoutContext(
    webPageJsonLd({
      name: page.name,
      ...(page.description ? { description: page.description } : {}),
      path: page.path,
      ...(page.type ? { type: page.type } : {}),
      ...(page.keywords ? { keywords: page.keywords } : {}),
      ...(page.imageUrl ? { imageUrl: page.imageUrl } : {}),
      datePublished: page.datePublished,
      dateModified: page.dateModified,
      ...(hasBreadcrumb ? { breadcrumbPath: page.path } : {}),
      ...(page.mainEntityId ? { mainEntityId: page.mainEntityId } : {}),
    }),
  )
  const graph: Record<string, unknown>[] = []
  if (organization !== null) {
    graph.push(organization)
  }
  graph.push(webSiteNode(), webPage)
  if (breadcrumbs !== undefined && breadcrumbs.length >= 2) {
    graph.push(withoutContext(breadcrumbJsonLd(breadcrumbs)))
  }
  for (const node of nodes ?? []) {
    graph.push(node)
  }
  return {
    '@context': 'https://schema.org',
    '@graph': graph,
  }
}

// ---------------------------------------------------------------------------
// CMS-blokkokból épülő csomópontok
// ---------------------------------------------------------------------------

type LayoutBlock = NonNullable<Page['layout']>[number]

function trimmed(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text.length > 0 ? text : undefined
}

function mediaUrl(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('url' in value)) return undefined
  const media = value as Media
  const url = trimmed(media.url)
  return url ? absoluteUrl(url) : undefined
}

/** Ékezet nélküli, kötőjeles horgony egy névből (`Kocsis Kata` → `kocsis-kata`). */
export function anchorSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Magyar postacím → `PostalAddress`. Az alak, amit a CMS tárol:
 * `1117 Budapest, Nádorliget u. 7/b` (irányítószám, település, utca). Ha
 * a minta nem illik, a cím szövegként marad (a schema.org `address`
 * Text-et is elfogad), hogy hamis mezőbontás ne kerüljön ki.
 */
export function postalAddressNode(cim: string): Record<string, unknown> | string {
  const match = /^(\d{4})\s+([^,]+),\s*(.+)$/u.exec(cim.trim())
  if (!match) {
    return cim.trim()
  }
  const [, postalCode, addressLocality, streetAddress] = match
  return {
    '@type': 'PostalAddress',
    streetAddress: streetAddress!.trim(),
    addressLocality: addressLocality!.trim(),
    postalCode,
    addressCountry: 'HU',
  }
}

/** A Kapcsolat-lap időpontkérő blokkjából kinyert kapcsolati adatok. */
export interface ContactData {
  addresses: string[]
  telephones: { name?: string; number: string }[]
  email?: string
}

/**
 * A `/kapcsolat` CMS-oldal `appointment` blokkjából a helyszínek, telefonok,
 * e-mail. Csak ami a CMS-ben ténylegesen ki van töltve, és csak látható
 * szekcióból.
 */
export function contactDataFromLayout(
  layout: ReadonlyArray<LayoutBlock> | null | undefined,
): ContactData {
  const data: ContactData = { addresses: [], telephones: [] }
  for (const block of layout ?? []) {
    if (block.blockType !== 'appointment' || isSectionHidden(block)) continue
    for (const hely of block.helyszinek ?? []) {
      const cim = trimmed(hely.cim)
      if (cim && !data.addresses.includes(cim)) data.addresses.push(cim)
    }
    for (const tel of block.telefonszamok ?? []) {
      const szam = trimmed(tel.szam)
      if (szam && !data.telephones.some((entry) => entry.number === szam)) {
        const nev = trimmed(tel.nev)
        data.telephones.push(nev ? { name: nev, number: szam } : { number: szam })
      }
    }
    const email = trimmed(block.email)
    if (email && data.email === undefined) data.email = email
  }
  return data
}

/** Telefonszám E.164-közeli alakban (`+36 30 169 2263` → `+36301692263`). */
export function telephoneUri(number: string): string {
  return number.replace(/[^\d+]/g, '')
}

/**
 * A rendelők `MedicalBusiness` csomópontjai a Kapcsolat-lap címeiből.
 *
 * Több telephely = telephelyenként egy LocalBusiness-csomópont, közös
 * szülőszervezettel (Google *Local business*, „Multiple departments /
 * locations”:
 * https://developers.google.com/search/docs/appearance/structured-data/local-business).
 * A `MedicalBusiness` a schema.org LocalBusiness altípusa
 * (https://schema.org/MedicalBusiness). Nyitvatartás és geokoordináta nincs a
 * CMS-ben, ezért nincs a sémában sem. A telefonszám nem telephelyhez, hanem
 * személyhez kötött a CMS-ben, ezért a szervezet `contactPoint`-jain áll.
 */
/** A cím térkép-linkje mezőként; üres címre (nincs) üres objektum, hogy a gráfban ne álljon üres érték. */
function hasMapField(cim: string): { hasMap?: string } {
  const href = mapsHref(cim)
  return href ? { hasMap: href } : {}
}

export function medicalBusinessNodes(contact: ContactData): Record<string, unknown>[] {
  return contact.addresses.map((cim, index) => ({
    '@type': 'MedicalBusiness',
    // schema.org Place.hasMap: ugyanaz a Google Térkép-link, amit a vevő a
    // felületen kattint (https://schema.org/hasMap; src/lib/maps-href.ts).
    ...hasMapField(cim),
    '@id': `${absoluteUrl('/kapcsolat')}#rendelo-${index + 1}`,
    name: `Kineticare rendelő ${index + 1}`,
    parentOrganization: organizationRef(),
    address: postalAddressNode(cim),
    url: absoluteUrl('/kapcsolat'),
    ...(contact.email ? { email: contact.email } : {}),
    ...(contact.telephones.length > 0
      ? { telephone: contact.telephones.map((tel) => telephoneUri(tel.number)) }
      : {}),
    inLanguage: 'hu-HU',
    areaServed: 'Budapest',
    medicalSpecialty: 'https://schema.org/PhysicalTherapy',
  }))
}

/**
 * A Kapcsolat-lap Organization csomópontja: az alap csomópont + a CMS-ből
 * jövő telefonok, telephelyek és személyenkénti ContactPoint-ok.
 */
export function contactOrganizationNode(contact: ContactData): Record<string, unknown> {
  const base = organizationNode({
    telephone: contact.telephones.map((tel) => telephoneUri(tel.number)),
    location: medicalBusinessNodes(contact).map((node) => ({ '@id': node['@id'] })),
  })
  const contactPoints = contact.telephones.map((tel) => ({
    '@type': 'ContactPoint',
    contactType: 'appointment scheduling',
    telephone: telephoneUri(tel.number),
    ...(tel.name ? { name: tel.name } : {}),
    availableLanguage: ['hu'],
  }))
  return {
    ...base,
    contactPoint: [...(base.contactPoint as Record<string, unknown>[]), ...contactPoints],
  }
}

/** Egy szakember a csapat-blokkból (csak a kitöltött mezők). */
export interface TeamPerson {
  name: string
  jobTitle?: string
  description?: string
  imageUrl?: string
  telephone?: string
  email?: string
}

/**
 * A `/rolunk` (és bármely lap) `teamMembers` blokkjából a szakemberek.
 * Ugyanaz a név két blokkban (pl. Rólunk + Kapcsolat) egyszer szerepel. A
 * rejtett szekció kimarad.
 */
export function teamPersonsFromLayout(
  layout: ReadonlyArray<LayoutBlock> | null | undefined,
): TeamPerson[] {
  const persons: TeamPerson[] = []
  for (const block of layout ?? []) {
    if (block.blockType !== 'teamMembers' || isSectionHidden(block)) continue
    for (const member of block.members ?? []) {
      const name = trimmed(member.name)
      if (!name || persons.some((person) => person.name === name)) continue
      const jobTitle = trimmed(member.role)
      const description = trimmed(member.bio)
      const imageUrl = mediaUrl(member.photo)
      const telephone = trimmed(member.phone)
      const email = trimmed(member.email)
      persons.push({
        name,
        ...(jobTitle ? { jobTitle } : {}),
        ...(description ? { description } : {}),
        ...(imageUrl ? { imageUrl } : {}),
        ...(telephone ? { telephone: telephoneUri(telephone) } : {}),
        ...(email ? { email } : {}),
      })
    }
  }
  return persons
}

/**
 * `Person` csomópontok a két gyógytornászról. A `@id` a /rolunk lap horgonya,
 * az `url` a lap; `worksFor` a szervezet. A `jobTitle` a titulus, NEM a név
 * része (Google *Article* author irányelv: „author.name: only specify the
 * name”; a titulushoz `jobTitle`:
 * https://developers.google.com/search/docs/appearance/structured-data/article#author-best-practices).
 * `sameAs` nincs: a CMS-ben nincs profil-URL.
 */
export function personNodes(
  persons: ReadonlyArray<TeamPerson>,
  path = '/rolunk',
): Record<string, unknown>[] {
  return persons.map((person) => ({
    '@type': 'Person',
    '@id': `${absoluteUrl(path)}#${anchorSlug(person.name)}`,
    name: person.name,
    url: absoluteUrl(path),
    ...(person.jobTitle ? { jobTitle: person.jobTitle } : {}),
    ...(person.description ? { description: person.description } : {}),
    ...(person.imageUrl ? { image: person.imageUrl } : {}),
    ...(person.telephone ? { telephone: person.telephone } : {}),
    ...(person.email ? { email: person.email } : {}),
    worksFor: organizationRef(),
    knowsLanguage: 'hu',
  }))
}

/**
 * A `/szolgaltatasok` `services` blokkjának sorai `Service` csomópontként.
 *
 * Név, leírás, cél-URL a blokkból; a szolgáltató a szervezet. `Offer`/ár
 * SZÁNDÉKOSAN nincs: az árak a lapon szabad szövegben (rich text) állnak, nem
 * strukturált mezőben, és a szövegből visszafejtett ár elavulhat — a
 * strukturált adat nem hirdethet olyat, ami nem mezőből jön
 * (`docs/seo-geo-llm.md` karbantartási szabály). A `Service` a schema.org
 * ajánlott típusa szolgáltatás-leírásra (https://schema.org/Service). A
 * rejtett szekció sorai kimaradnak.
 */
export function serviceNodesFromLayout(
  layout: ReadonlyArray<LayoutBlock> | null | undefined,
  path = '/szolgaltatasok',
): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = []
  for (const block of layout ?? []) {
    if (block.blockType !== 'services' || isSectionHidden(block)) continue
    for (const row of block.rows ?? []) {
      const name = trimmed(row.title)
      if (!name) continue
      const description = trimmed(row.osszefoglalo) ?? trimmed(row.body)
      const url = trimmed(row.url)
      nodes.push({
        '@type': 'Service',
        '@id': `${absoluteUrl(path)}#${anchorSlug(name)}`,
        name,
        ...(description ? { description } : {}),
        ...(url ? { url: absoluteUrl(url) } : {}),
        provider: organizationRef(),
        areaServed: 'HU',
        inLanguage: 'hu-HU',
        serviceType: name,
      })
    }
  }
  return nodes
}

/** A gráf megnevezett csomópontjai (`@id`-val), a teszteknek és az ellenőrzésnek. */
export function graphIds(graph: Record<string, unknown>): string[] {
  const nodes = graph['@graph']
  if (!Array.isArray(nodes)) return []
  return nodes
    .map((node) =>
      typeof node === 'object' && node !== null
        ? (node as Record<string, unknown>)['@id']
        : undefined,
    )
    .filter((id): id is string => typeof id === 'string')
}

export { ORGANIZATION_ID, breadcrumbId }
