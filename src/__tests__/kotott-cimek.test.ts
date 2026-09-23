import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  hubBlogbejegyzesbol,
  hubOldalbol,
  IDOPONTKEROS_BLOGBEJEGYZESEK,
  JOGI_WEBCIMEK,
  KAPCSOLAT_WEBCIM,
  kotottWebcim,
  kotottWebcimek,
  nevelo,
  Nevelo,
  OLDAL_FAJTA_FELIRAT,
  oldalFajta,
  oldalFajtaFelirat,
} from '../lib/admin/kotott-cimek'
import { APPOINTMENT_CTA_SLUGS } from '../components/content/post-article'
import { HOME_PAGE_SLUG } from '../lib/content-slugs'
import { HUB_OLDALAK } from '../lib/tudastar/hub-oldalak'

/**
 * H48 őr: a kódhoz kötött webcímek listája és minden „mi épít rá” és „mi
 * történik átírás után” állítás a kódbeli forrássorhoz kötve. Ha a gazda
 * (route, lábléc, seed, hub-térkép) változtat, a teszt bukik, és a
 * tájékoztató szöveget újra kell mérni, nem marad csendben hamis.
 *
 * DOM és hálózat nélkül fut; a kliens-komponens tesztje a
 * hub-oldal-jelzes.test.tsx-ben van.
 */

const forras = (ut: string): string =>
  readFileSync(fileURLToPath(new URL(ut, import.meta.url)), 'utf8')

const core = (ut: string): string =>
  readFileSync(fileURLToPath(new URL(`../../node_modules/${ut}`, import.meta.url)), 'utf8')

/** A §3.1/§8.3 tipográfiai hibái (üres = tiszta). */
function tipografiaiHibak(text: string): string[] {
  const hibak: string[] = []
  if (/\s–\s|—/.test(text)) hibak.push(`gondolatjel: ${text}`)
  if (/["“]/.test(text)) hibak.push(`hibás idézőjel: ${text}`)
  if ([...text.matchAll(/„/g)].length !== [...text.matchAll(/”/g)].length) {
    hibak.push(`páratlan idézőjel: ${text}`)
  }
  for (const match of text.matchAll(/\p{Lu}{3,}/gu)) {
    if (!['SEO', 'GYIK'].includes(match[0])) hibak.push(`verzál szó (${match[0]}): ${text}`)
  }
  return hibak
}

describe('a kötött webcímek listája a kódból', () => {
  it('a jogi webcímek literálja egyezik a legal-content.ts JOGI_OLDALAK slugjaival', () => {
    // A legal-content.ts node-importos (fájlrendszerből olvas), ezért a kliensbe
    // nem húzható be: a lista literál, ez a teszt köti össze a kettőt.
    const legal = forras('../lib/legal-content.ts')
    const blokk = legal.slice(legal.indexOf('export const JOGI_OLDALAK'))
    const slugok = [...blokk.matchAll(/slug: '([^']+)'/g)].map((m) => m[1])
    expect(slugok.slice(0, 3)).toEqual([...JOGI_WEBCIMEK])
  })

  it('az időpontkérős blogbejegyzések literálja egyezik az APPOINTMENT_CTA_SLUGS-szal', () => {
    expect([...IDOPONTKEROS_BLOGBEJEGYZESEK]).toEqual([...APPOINTMENT_CTA_SLUGS])
  })

  it('az Oldalak: kezdőlap, Kapcsolat, 3 jogi és a 8 hub; a Blogbejegyzések: 8 hub-pár és az időpontkérősök', () => {
    expect(kotottWebcimek('pages')).toEqual([
      HOME_PAGE_SLUG,
      KAPCSOLAT_WEBCIM,
      'aszf',
      'adatvedelem',
      'impresszum',
      ...HUB_OLDALAK.map((hub) => hub.slug),
    ])
    expect(kotottWebcimek('pages')).toHaveLength(13)
    const posts = kotottWebcimek('posts')
    expect(posts).toHaveLength(10)
    expect(posts).toContain('miert-zsibbad-a-kezem')
    expect(posts).toContain('peace-and-love-friss-serules')
    expect(posts.filter((slug) => slug === 'befagyott-vall')).toHaveLength(1)
    for (const slug of kotottWebcimek('pages'))
      expect(kotottWebcim('pages', slug), slug).not.toBeNull()
    for (const slug of posts) expect(kotottWebcim('posts', slug), slug).not.toBeNull()
  })

  it('nem kötött: más webcím, üres érték, rossz gyűjtemény, és a két gyűjtemény nem keveredik', () => {
    expect(kotottWebcim('pages', 'rolunk')).toBeNull()
    expect(kotottWebcim('pages', 'szolgaltatasok')).toBeNull()
    expect(kotottWebcim('pages', '')).toBeNull()
    expect(kotottWebcim('pages', undefined)).toBeNull()
    expect(kotottWebcim('media', 'kapcsolat')).toBeNull()
    // A kez-zsibbadas Oldal párja a miert-zsibbad-a-kezem blogbejegyzés.
    expect(kotottWebcim('posts', 'kez-zsibbadas')).toBeNull()
    expect(kotottWebcim('pages', 'miert-zsibbad-a-kezem')).toBeNull()
    expect(hubOldalbol('kez-zsibbadas')?.cikkSlug).toBe('miert-zsibbad-a-kezem')
    expect(hubBlogbejegyzesbol('miert-zsibbad-a-kezem')?.slug).toBe('kez-zsibbadas')
    expect(kotottWebcim('pages', '  kapcsolat  ')).not.toBeNull()
  })
})

describe('névelő a sablonos szövegekben („a” vagy „az”)', () => {
  it.each([
    ['kapcsolat', 'a'],
    ['aszf', 'az'],
    ['adatvedelem', 'az'],
    ['impresszum', 'az'],
    ['/inhuvelygyulladas', 'az'],
    ['/kez-zsibbadas', 'a'],
    ['Ínhüvelygyulladás: mi ez', 'az'],
    ['„Övszindróma”', 'az'],
    ['5 tipp', 'az'],
    ['10 perc', 'a'],
    ['1 perc', 'az'],
    ['1000 lépés', 'az'],
    ['2 kérdés', 'a'],
  ] as const)('%s → %s', (szo, vart) => {
    expect(nevelo(szo)).toBe(vart)
  })

  it('mondat elején nagybetűvel, és a sablonok a helyes névelőt kapják', () => {
    expect(Nevelo('aszf')).toBe('Az')
    expect(Nevelo('kapcsolat')).toBe('A')
    expect(kotottWebcim('pages', 'inhuvelygyulladas')?.mire[0]).toMatch(
      /^Az \/inhuvelygyulladas címen/,
    )
    expect(kotottWebcim('pages', 'inhuvelygyulladas')?.kovetkezmeny[0]).toContain(
      'közzéteszed, az /inhuvelygyulladas cím',
    )
    expect(kotottWebcim('posts', 'inhuvelygyulladas')?.mire[0]).toContain(
      'Az Oldalak között az /inhuvelygyulladas webcímű oldal',
    )
  })
})

describe('„Mi ez” oszlop: az oldal fajtája a webcímből', () => {
  it.each([
    ['kezdolap', 'Kezdőlap (/)'],
    ['kapcsolat', 'Kapcsolat oldal'],
    ['aszf', 'Jogi oldal'],
    ['adatvedelem', 'Jogi oldal'],
    ['impresszum', 'Jogi oldal'],
    ['keztoalagut-szindroma', 'Tudástár-cikk tükre'],
    ['kez-zsibbadas', 'Tudástár-cikk tükre'],
    ['befagyott-vall', 'Tudástár-cikk tükre'],
    ['rolunk', 'Aloldal'],
    ['szolgaltatasok', 'Aloldal'],
    ['bemutatkozas', 'Aloldal'],
    ['', 'Aloldal'],
    [null, 'Aloldal'],
  ] as const)('%s → %s', (slug, felirat) => {
    expect(oldalFajtaFelirat(slug)).toBe(felirat)
  })

  it('mind a 8 hub „Tudástár-cikk tükre”, és az öt felirat különböző', () => {
    for (const hub of HUB_OLDALAK) expect(oldalFajta(hub.slug)).toBe('hub')
    expect(new Set(Object.values(OLDAL_FAJTA_FELIRAT)).size).toBe(5)
    for (const felirat of Object.values(OLDAL_FAJTA_FELIRAT)) {
      expect(tipografiaiHibak(felirat)).toEqual([])
      expect(felirat).not.toContain(',')
    }
  })
})

describe('a „mi épít rá” és a „mi történik” állítások a forrássorhoz kötve', () => {
  it('kezdőlap: a / a kezdolap webcímű oldalt tölti; hiányában tartalék, induláskor új kezdőlap', () => {
    expect(forras('../lib/content-slugs.ts')).toContain("export const HOME_PAGE_SLUG = 'kezdolap'")
    expect(forras('../lib/cms.ts')).toMatch(
      /export async function getHomePage[\s\S]*?where: \{ slug: \{ equals: HOME_PAGE_SLUG \}/,
    )
    // Oldal nélkül (home null) a HomeView a beépített alapváltozatot rajzolja.
    expect(forras('../components/content/HomeView.tsx')).toContain(
      'const layout = presentHomeLayout(home?.layout ?? [])',
    )
    // Induláskor: nincs kezdolap → új, közzétett kezdőlap (home-seed.ts ensureHomeLayout).
    const seed = forras('../lib/home-seed.ts')
    expect(seed).toMatch(
      /if \(existing\.docs\.length === 0\) \{\s*await payload\.create\(\{\s*collection: 'pages',\s*data: \{\s*title: HOME_HERO_TITLE,\s*slug: HOME_PAGE_SLUG,/,
    )
    expect(seed).toMatch(/_status: 'published',/)
    expect(forras('../payload.config.ts')).toMatch(
      /async function onInit\(payload: Payload\)[\s\S]*?await ensureHomeBaseline\(payload\)/,
    )
    const k = kotottWebcim('pages', 'kezdolap')
    expect(k?.mire.join(' ')).toContain('A kezdőlap (/) ezt az oldalt tölti be.')
    expect(k?.kovetkezmeny.join(' ')).toContain('beépített tartalék-kezdőlapja')
    expect(k?.kovetkezmeny.join(' ')).toContain('új, alapszekciós kezdőlap jön létre')
  })

  it('Kapcsolat: a /kapcsolat a kapcsolat oldal szekcióit rajzolja, oldal nélkül csak a címet', () => {
    const route = forras('../app/(frontend)/kapcsolat/page.tsx')
    expect(route).toContain("const CONTACT_PAGE_SLUG = 'kapcsolat'")
    expect(route).toContain("const CONTACT_TITLE = 'Kapcsolat'")
    expect(route).toContain('return page?.title?.trim() || CONTACT_TITLE')
    expect(route).toContain('const rawLayout = page?.layout ?? []')
    expect(route).toMatch(/\{layout\.length > 0 \? \(\s*<RenderBlocks/)
    // A blogbejegyzések végi időpontkérő gomb ide visz.
    expect(forras('../components/content/PostCourseCta.tsx')).toContain(
      "export const APPOINTMENT_HREF = '/kapcsolat#idopontkeres'",
    )
    const k = kotottWebcim('pages', 'kapcsolat')
    expect(k?.kovetkezmeny.join(' ')).toContain('csak a „Kapcsolat” cím marad, szekciók nélkül')
  })

  it('jogi oldalak: a lábléc, a hibaoldal, a pénztár, a sütisáv és az űrlapok linkjei', () => {
    const footer = forras('../components/layout/Footer.tsx')
    const hiba = forras('../app/global-not-found.tsx')
    for (const slug of JOGI_WEBCIMEK) {
      expect(footer, `lábléc: ${slug}`).toContain(`href: '/${slug}'`)
      expect(hiba, `hibaoldal: ${slug}`).toContain(`href: '/${slug}'`)
    }
    const penztar = forras('../lib/checkout/form-submission.ts')
    expect(penztar).toContain("export const TERMS_ASZF_PATH = '/aszf'")
    expect(penztar).toContain("export const TERMS_PRIVACY_PATH = '/adatvedelem'")
    const checkout = forras('../components/checkout/CheckoutForm.tsx')
    expect(checkout).toContain('<a href={TERMS_ASZF_PATH}')
    expect(checkout).toContain('<a href={TERMS_PRIVACY_PATH}')
    expect(forras('../components/analytics/ConsentBanner.tsx')).toContain('href="/adatvedelem"')
    expect(forras('../lib/newsletter/consent-text.ts')).toContain(
      "export const PRIVACY_POLICY_PATH = '/adatvedelem'",
    )
    expect(forras('../lib/appointment/consent-text.ts')).toContain(
      "export const APPOINTMENT_PRIVACY_POLICY_PATH = '/adatvedelem'",
    )
    // Az impresszumra csak a lábléc és a hibaoldal mutat, a pénztár nem.
    expect(checkout).not.toContain('/impresszum')
    expect(kotottWebcim('pages', 'aszf')?.mire).toEqual([
      'A lábléc, a hibaoldal és a pénztár linkje erre a webcímre mutat.',
    ])
    expect(kotottWebcim('pages', 'adatvedelem')?.mire.join(' ')).toContain(
      'a pénztár, a sütisáv és az űrlapok adatkezelési linkje',
    )
    expect(kotottWebcim('pages', 'impresszum')?.mire).toEqual([
      'A lábléc és a hibaoldal linkje erre a webcímre mutat.',
    ])
  })

  it('Tudástár-hub: a lap a pár blogbejegyzést mutatja, a /blog cím csak közzétett Oldalnál irányít át', () => {
    const route = forras('../app/(frontend)/[slug]/page.tsx')
    expect(route).toContain('const hub = HUB_OLDALAK.find((jelolt) => jelolt.slug === slug)')
    expect(route).toContain('const post = await hubPostOf(hub.cikkSlug)')
    const blog = forras('../app/(frontend)/blog/[slug]/page.tsx')
    expect(blog).toMatch(
      /const hub = await getPageBySlug\(hubSlug\)\s*if \(hub\) permanentRedirect\(`\/\$\{hubSlug\}`\)/,
    )
    // A hub-Oldal nélküli /blog/<cikk> a blogbejegyzést mutatja (nincs átirányítás).
    expect(forras('../lib/tudastar/hub-oldalak.ts')).toContain(
      'if (hubSlug === null || !publikaltPageSlugok.has(hubSlug)) {',
    )
    const k = kotottWebcim('pages', 'kez-zsibbadas')
    expect(k?.mire.join(' ')).toContain(
      'A /kez-zsibbadas címen a /blog/miert-zsibbad-a-kezem blogbejegyzés',
    )
    expect(k?.kovetkezmeny.join(' ')).toContain('visszakerül a /blog/miert-zsibbad-a-kezem címre')
    const p = kotottWebcim('posts', 'miert-zsibbad-a-kezem')
    expect(p?.mire.join(' ')).toContain(
      'a /kez-zsibbadas webcímű oldal ezt a blogbejegyzést mutatja',
    )
  })

  it('időpontkérős blogbejegyzés: a cikk végi ajánló változatát a webcím dönti el', () => {
    const cikk = forras('../components/content/post-article.ts')
    expect(cikk).toMatch(
      /typeof post\.slug === 'string' && APPOINTMENT_CTA_SLUGS\.includes\(post\.slug\)\s*\? 'idopont'\s*: 'kurzus'/,
    )
    // A befagyott-vall hub-pár ÉS időpontkérős: mindkét kötés megjelenik.
    const k = kotottWebcim('posts', 'befagyott-vall')
    expect(k?.mire).toHaveLength(2)
    expect(k?.kovetkezmeny).toHaveLength(2)
    expect(kotottWebcim('posts', 'gipszben-a-kezed')?.kovetkezmeny).toEqual([
      'Ha átírod és közzéteszed, a lap végén az időpontkérés helyett a kurzusajánló jelenik meg.',
    ])
  })

  it('az automatikus mentés csak piszkozatot ír: a fő dokumentum a közzétételig marad (core-őr)', () => {
    // A szöveg („a weboldal a … gombig a régi webcímet használja”) erre épít;
    // verzióemeléskor újra kell mérni (lásd kotott-cimek.ts fejléce).
    const update = core('payload/dist/collections/operations/utilities/update.js')
    expect(update).toContain(
      "const isSavingDraft = Boolean(draftArg && hasDraftsEnabled(collectionConfig)) && data._status !== 'published' && !publishAllLocales;",
    )
    expect(update).toMatch(
      /if \(!isSavingDraft\) \{[\s\S]{0,120}result = await req\.payload\.db\.updateOne\(/,
    )
  })

  it('minden szöveg tipográfiailag tiszta, és nem mond 404-et, horgonyt vagy slugot (§8.2)', () => {
    const szovegek = [...kotottWebcimek('pages').map((s) => kotottWebcim('pages', s))]
      .concat(kotottWebcimek('posts').map((s) => kotottWebcim('posts', s)))
      .flatMap((k) => [...(k?.mire ?? []), ...(k?.kovetkezmeny ?? [])])
    expect(szovegek.length).toBeGreaterThan(40)
    for (const sz of szovegek) {
      expect(tipografiaiHibak(sz), sz).toEqual([])
      expect(sz, sz).not.toMatch(/404|horgony|\bslug/i)
      expect(sz.endsWith('.'), sz).toBe(true)
    }
  })
})
