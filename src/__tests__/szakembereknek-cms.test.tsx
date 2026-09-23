import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BlockOfferCards, Page } from '../payload-types'

/**
 * ŐR — /szakembereknek a „szakembereknek” Oldalak-rekordból (modul-térkép H11,
 * H09 2. pont; A7).
 *
 * Mit véd:
 *  1. rekord nélkül a kimenet a WP49 lapé: ugyanaz a szerkezet (H1, bevezető,
 *     két kártya, gombok, jegyzetek, aria-describedby), betűre ugyanaz a
 *     szöveg; csak az osztálynevek (a blokk CSS-e) és a jegyzet-id-k neve
 *     változott, értékre azonos stílussal;
 *  2. rekorddal a Cím, a Rövid bevezető és a szekciósor a CMS-ből jön, üres
 *     mezőnél a kódtartalék; látható szekció nélkül a kódbeli kártyák;
 *  3. a metaadat a feloldókkal (SEO-cím, SEO-leírás → Rövid bevezető →
 *     kódtartalék, kulcsszavak, kanonikus út, piszkozatban noindex);
 *  4. piszkozatban előnézet-sáv + a helyzetnek megfelelő szalag, azon kívül
 *     egyik sem;
 *  5. a JSON-LD a feloldott kapcsolati e-mailt viszi.
 *
 * A tesztkörnyezet `node` (nincs jsdom): a SZERVER-RENDERELT kimenetet mérjük.
 * Adatbázis és hálózat nincs: minden forrás mockolt, a `fetch` hangosan dob.
 */

const allapot = vi.hoisted(() => ({
  draft: false,
  email: 'info@kineticare.hu',
  lap: null as unknown,
  tudastar: true,
  lekeresek: [] as { slug: string; draft: boolean }[],
}))

vi.mock('next/headers', () => ({ draftMode: async () => ({ isEnabled: allapot.draft }) }))
vi.mock('@/lib/cms', () => ({
  getPageBySlug: async (slug: string, opciok: { draft?: boolean } = {}) => {
    allapot.lekeresek.push({ slug, draft: opciok.draft === true })
    return allapot.lap
  },
}))
vi.mock('@/lib/contact-email-server', () => ({ getContactEmail: async () => allapot.email }))
vi.mock('@/lib/tudastar-lathatosag', () => ({
  getTudastarLathato: async () => allapot.tudastar,
}))
vi.mock('@/lib/appointment/section', () => ({
  getAppointmentSectionContext: async () => ({ formId: null, turnstileSiteKey: null }),
}))
vi.mock('payload', async (eredeti) => ({
  ...(await eredeti<typeof import('payload')>()),
  getPayload: async () => {
    throw new Error('A tesztből nem indulhat Payload.')
  },
}))
vi.mock('../payload.config', () => ({ default: {} }))

beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('A tesztből SOSEM mehet ki valódi hálózati hívás.')
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  allapot.draft = false
  allapot.email = 'info@kineticare.hu'
  allapot.lap = null
  allapot.tudastar = true
  allapot.lekeresek = []
})

const oldal = await import('../app/(frontend)/szakembereknek/page')
const SzakembereknekPage = oldal.default
const { generateMetadata } = oldal
const { szekcioMelylink } = await import('../components/editor/szekcio-melylink')
const { PREVIEW_BAR_SZOVEG, VISSZA_A_SZERKESZTOBE } =
  await import('../components/preview/PreviewBar')
const { RESZBEN_KODBAN_VAN, KODBAN_VAN } =
  await import('../components/editor/frontend/szerkeszto-szalag')
const { UGRAS_FELIRAT } = await import('../lib/section-row-label')
const {
  SZAKEMBEREKNEK_DESCRIPTION,
  SZAKEMBEREKNEK_EYEBROW,
  SZAKEMBEREKNEK_LEAD,
  SZAKEMBEREKNEK_PATH,
  szakembereknekAlapBlokk,
} = await import('../lib/szakembereknek')
const { szakembereknekOldalTerv } = await import('../scripts/szakembereknek-oldal')

async function render(): Promise<string> {
  return renderToStaticMarkup(await SzakembereknekPage())
}

/** A JSON-LD script nélküli markup. */
function jsonLdNelkul(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/g, '')
}

/** A JSON-LD gráf (egyetlen script). */
function jsonLd(html: string): string {
  return /<script[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? ''
}

function lap(adat: Partial<Page>): Page {
  return {
    id: 42,
    title: 'Szakembereknek',
    slug: 'szakembereknek',
    content: {
      root: { type: 'root', children: [], direction: null, format: '', indent: 0, version: 1 },
    },
    status: 'published',
    updatedAt: '2026-09-23T08:00:00.000Z',
    createdAt: '2026-09-23T08:00:00.000Z',
    ...adat,
  }
}

/** Valódi alakú Payload blokk-azonosító (24 hex jegy): csak ilyenre épül szekció-szalag. */
const BLOKK_ID = '66f1a2b3c4d5e6f708192a3b'

function kartyaBlokk(adat: Partial<BlockOfferCards> = {}): BlockOfferCards {
  return {
    id: BLOKK_ID,
    blockType: 'offerCards',
    kartyak: [
      {
        id: 'k1',
        ikon: 'nincs',
        cim: 'Mentori program',
        szoveg: 'Heti konzultáció kollégáknak.',
        felirat: 'Írj nekünk',
        url: '/kapcsolat',
        gombSuly: 'elsodleges',
      },
    ],
    sectionSettings: { visible: true, hatter: 'feher' },
    ...adat,
  }
}

/**
 * A WP49 lap kimenete (JSON-LD nélkül), 2026-09-23-án a régi route-ból
 * renderelve. A kártya-osztályok a blokk CSS-ébe költöztek
 * (kc-szakemberek__* → kc-ajanlat-kartyak__*, értékre azonos szabályokkal), a
 * jegyzet-id-k a kártya sorszámából épülnek; a normalizálás csak ezt a kettőt
 * fordítja vissza, minden más betűre egyezik.
 */
const WP49_MARKUP = [
  '<section aria-labelledby="szakembereknek-cim" class="kc-section kc-szakemberek"><div class="kc-container"><header class="kc-szakemberek__head"><p class="kc-eyebrow">Gyógytornászoknak és terapeutáknak</p><h1 class="kc-section-title" id="szakembereknek-cim">Szakembereknek</h1><p class="kc-section-lead kc-szakemberek__lead">Ha gyógytornászként vagy terapeutaként dolgozol a kézzel, két úton mélyítheted a tudásod nálunk. Válaszd a képzést, ha gyakorlatban tanulnál, vagy a szakkönyvet, ha a szakmai hátteret a saját tempódban olvasnád át.</p></header>',
  '<ul class="kc-szakemberek__grid"><li class="kc-szakemberek__cell"><article class="kc-card kc-szakemberek__card"><div class="kc-szakemberek__body"><span aria-hidden="true" class="kc-szakemberek__ikon"><svg aria-hidden="true" class="kc-szakemberek__glifa" fill="currentColor" focusable="false" viewBox="0 0 256 256"><path d="M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H53.39a8,8,0,0,0,7.23-4.57,48,48,0,0,1,86.76,0,8,8,0,0,0,7.23,4.57H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40ZM80,144a24,24,0,1,1,24,24A24,24,0,0,1,80,144Zm136,56H159.43a64.39,64.39,0,0,0-28.83-26.16,40,40,0,1,0-53.2,0A64.39,64.39,0,0,0,48.57,200H40V56H216ZM56,96V80a8,8,0,0,1,8-8H192a8,8,0,0,1,8,8v96a8,8,0,0,1-8,8H176a8,8,0,0,1,0-16h8V88H72v8a8,8,0,0,1-16,0Z"></path></svg></span>',
  '<p class="kc-szakemberek__kicker">Képzés</p><h2 class="kc-szakemberek__cim">Akkreditált kézrehabilitációs képzés</h2><p class="kc-szakemberek__szoveg">Tantermi képzés a kéz, a csukló- és a könyökízület rehabilitációjáról, gyógytornászoknak, orvosoknak, mozgásterapeutáknak és edzőknek, a ProBody Stúdióval együttműködve.</p><ul class="kc-szakemberek__tenyek"><li>12 kreditpont (SZTK-A-33553/2024)</li><li>Az időpontokat és a díjat a ProBody Stúdió oldalán találod</li></ul></div>',
  '<div class="kc-szakemberek__lab"><a class="kc-button kc-button--primary kc-szakemberek__gomb" href="https://probodystudio.hu/kez-workshop/" aria-describedby="szakembereknek-kepzes-jegyzet" target="_blank" rel="noopener noreferrer">Nézd meg a kézworkshopot</a><p class="kc-szakemberek__jegyzet" id="szakembereknek-kepzes-jegyzet"><svg aria-hidden="true" class="kc-nav__external-icon" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" x2="21" y1="14" y2="3"></line></svg>Külső oldal, új lapon nyílik.</p></div></article></li>',
  '<li class="kc-szakemberek__cell"><article class="kc-card kc-szakemberek__card"><div class="kc-szakemberek__body"><span aria-hidden="true" class="kc-szakemberek__ikon"><svg aria-hidden="true" class="kc-szakemberek__glifa" fill="currentColor" focusable="false" viewBox="0 0 256 256"><path d="M232,48H160a40,40,0,0,0-32,16A40,40,0,0,0,96,48H24a8,8,0,0,0-8,8V200a8,8,0,0,0,8,8H96a24,24,0,0,1,24,24,8,8,0,0,0,16,0,24,24,0,0,1,24-24h72a8,8,0,0,0,8-8V56A8,8,0,0,0,232,48ZM96,192H32V64H96a24,24,0,0,1,24,24V200A39.81,39.81,0,0,0,96,192Zm128,0H160a39.81,39.81,0,0,0-24,8V88a24,24,0,0,1,24-24h64Z"></path></svg></span>',
  '<p class="kc-szakemberek__kicker">Szakkönyv</p><h2 class="kc-szakemberek__cim">A Kineticare szakkönyve</h2><p class="kc-szakemberek__szoveg">A Kineticare gyógytornászainak szakkönyve a kézrehabilitációról, kollégáknak: a szakmai háttér, amit a saját tempódban olvashatsz át.</p><p class="kc-szakemberek__allapot">A vásárlás lehetőségét hamarosan közzétesszük. Addig kérdezz tőlünk, és szólunk, amint elérhető.</p></div>',
  '<div class="kc-szakemberek__lab"><a class="kc-button kc-button--secondary kc-szakemberek__gomb" aria-describedby="szakembereknek-szakkonyv-jegyzet" href="/kapcsolat">Érdeklődj a szakkönyvről</a><p class="kc-szakemberek__jegyzet" id="szakembereknek-szakkonyv-jegyzet">A kapcsolat-oldalunkra visz.</p></div></article></li></ul></div></section>',
].join('')

/** Az új kimenet a WP49 osztály- és id-neveire fordítva (csak ez a kettő). */
function wp49Nevekre(html: string): string {
  return html
    .replace(/kc-ajanlat-kartyak__/g, 'kc-szakemberek__')
    .replace(/szakembereknek-1-jegyzet/g, 'szakembereknek-kepzes-jegyzet')
    .replace(/szakembereknek-2-jegyzet/g, 'szakembereknek-szakkonyv-jegyzet')
}

// ---------------------------------------------------------------------------
// 1. Rekord nélkül: a WP49 lap
// ---------------------------------------------------------------------------

describe('rekord nélkül: a kódtartalék a WP49 lap', () => {
  it('a kimenet (JSON-LD nélkül) a WP49 lapé, csak az osztály- és id-nevek újak', async () => {
    const html = await render()
    expect(wp49Nevekre(jsonLdNelkul(html))).toBe(WP49_MARKUP)
  })

  it('a „szakembereknek” rekordot kérdezi le, nem piszkozatként', async () => {
    await render()
    expect(allapot.lekeresek).toEqual([{ slug: 'szakembereknek', draft: false }])
  })

  it('a jegyzet-id-k egyediek, és mindkét gomb aria-describedby-ja a saját jegyzetére mutat', async () => {
    const html = await render()
    const idk = [...html.matchAll(/\sid="([^"]+)"/g)].map((talalat) => talalat[1])
    expect(new Set(idk).size).toBe(idk.length)
    const hivatkozott = [...html.matchAll(/aria-describedby="([^"]+)"/g)].map((t) => t[1])
    expect(hivatkozott).toEqual(['szakembereknek-1-jegyzet', 'szakembereknek-2-jegyzet'])
    for (const id of hivatkozott) {
      expect(idk).toContain(id)
    }
  })

  it('nem piszkozatban nincs előnézet-sáv és szerkesztői szalag', async () => {
    const html = await render()
    expect(html).not.toContain('kc-preview-bar')
    expect(html).not.toContain('kc-szerkeszto-szalag')
  })
})

// ---------------------------------------------------------------------------
// 2. Rekorddal: Cím, Rövid bevezető, szekciósor
// ---------------------------------------------------------------------------

describe('rekorddal: a CMS nyer, üres mezőnél a tartalék', () => {
  it('a H1 a Cím, a bevezető a Rövid bevezető, a kártyák a szekciósorból', async () => {
    allapot.lap = lap({
      title: 'Szakmai ajánlatok',
      excerpt: 'Kollégáknak szóló képzések és könyvek.',
      layout: [kartyaBlokk()],
    })
    const html = await render()
    expect(html).toMatch(
      /<h1 class="kc-section-title" id="szakembereknek-cim">Szakmai ajánlatok<\/h1>/,
    )
    expect(html).toContain(
      '<p class="kc-section-lead kc-szakemberek__lead">Kollégáknak szóló képzések és könyvek.</p>',
    )
    // A felső felirat a kódban van.
    expect(html).toContain(`<p class="kc-eyebrow">${SZAKEMBEREKNEK_EYEBROW}</p>`)
    // A lapfej külön szekció, utána a CMS szekciója.
    expect(html).toContain('class="kc-section kc-szakemberek kc-szakemberek--fej"')
    expect(html).toMatch(/<\/section><section class="kc-section kc-ajanlat-kartyak">/)
    expect(html).toMatch(/<h2 class="kc-ajanlat-kartyak__cim">Mentori program<\/h2>/)
    // A kódbeli kártyák nincsenek ott.
    expect(html).not.toContain('Akkreditált kézrehabilitációs képzés')
  })

  it('üres Cím és Rövid bevezető helyén a kódbeli szöveg áll', async () => {
    allapot.lap = lap({ title: '   ', excerpt: '', layout: [kartyaBlokk()] })
    const html = await render()
    expect(html).toMatch(
      /<h1 class="kc-section-title" id="szakembereknek-cim">Szakembereknek<\/h1>/,
    )
    expect(html).toContain(SZAKEMBEREKNEK_LEAD)
  })

  it('látható szekció nélkül (üres vagy csupa rejtett sor) a kódbeli kártyák látszanak', async () => {
    for (const layout of [[], [kartyaBlokk({ sectionSettings: { visible: false } })]]) {
      allapot.lap = lap({ layout })
      const html = await render()
      expect(html).toContain('Akkreditált kézrehabilitációs képzés')
      expect(html).not.toContain('Mentori program')
      expect(html).not.toContain('kc-szakemberek--fej')
    }
  })

  it('a tartalom-szabály rekordjával a lap szövege és kártyái a kódtartalékéval azonosak', async () => {
    const tartalek = await render()
    const terv = szakembereknekOldalTerv(null, new Date('2026-09-23T08:00:00Z'))
    const layout = (terv.adat?.layout ?? []).map((blokk, index) => ({
      ...blokk,
      id: `terv${index}`,
    }))
    allapot.lap = lap({ title: terv.adat?.title, excerpt: terv.adat?.excerpt, layout })
    const cms = await render()
    const kartyak = (html: string): string =>
      (/<ul class="kc-ajanlat-kartyak__grid">[\s\S]*<\/ul>/.exec(html)?.[0] ?? '').replace(
        /(szakembereknek|ajanlat-terv0)-(\d)-jegyzet/g,
        'X-$2-jegyzet',
      )
    expect(kartyak(cms)).not.toBe('')
    expect(kartyak(cms)).toBe(kartyak(tartalek))
    const szoveg = (html: string): string =>
      jsonLdNelkul(html)
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    expect(szoveg(cms)).toBe(szoveg(tartalek))
  })

  it('kikapcsolt Tudástárnál a kártya Tudástár-linkje kimarad (a /kapcsolat mintája)', async () => {
    allapot.tudastar = false
    allapot.lap = lap({
      layout: [
        kartyaBlokk({
          kartyak: [
            { id: 'k1', cim: 'Olvasnivaló', szoveg: 'Cikkek.', felirat: 'Olvasd el', url: '/blog' },
          ],
        }),
      ],
    })
    const html = await render()
    expect(html).toContain('Olvasnivaló')
    expect(html).not.toContain('href="/blog"')
  })
})

// ---------------------------------------------------------------------------
// 3. Metaadat
// ---------------------------------------------------------------------------

describe('metaadat: a feloldók, kódtartalékkal', () => {
  it('rekord nélkül a kódbeli cím, leírás és a kanonikus út', async () => {
    const meta = await generateMetadata()
    expect(meta.title).toBe('Szakembereknek')
    expect(meta.description).toBe(SZAKEMBEREKNEK_DESCRIPTION)
    expect(meta.alternates?.canonical).toBe(SZAKEMBEREKNEK_PATH)
    expect(meta.robots).not.toEqual(expect.objectContaining({ index: false }))
  })

  it('rekorddal: SEO-cím, SEO-leírás és kulcsszavak a CMS-ből', async () => {
    allapot.lap = lap({
      title: 'Szakembereknek',
      seoTitle: 'Kézrehabilitáció szakembereknek | Kineticare',
      seoDescription: 'Képzés és szakkönyv gyógytornászoknak.',
      seoKeywords: [{ phrase: 'kézterápia képzés' }],
    })
    const meta = await generateMetadata()
    // A márka-utótagot a keret sablonja teszi vissza („%s | Kineticare”).
    expect(meta.title).toBe('Kézrehabilitáció szakembereknek')
    expect(meta.description).toBe('Képzés és szakkönyv gyógytornászoknak.')
    expect(String(meta.keywords)).toContain('kézterápia képzés')
  })

  it('üres SEO-leírásnál a Rövid bevezető, annak híján a kódbeli leírás', async () => {
    allapot.lap = lap({ seoDescription: '', excerpt: 'Rövid bevezető a laphoz.' })
    expect((await generateMetadata()).description).toBe('Rövid bevezető a laphoz.')
    allapot.lap = lap({ seoDescription: null, excerpt: null })
    expect((await generateMetadata()).description).toBe(SZAKEMBEREKNEK_DESCRIPTION)
  })

  it('üres Címnél a <title> a kódbeli cím', async () => {
    allapot.lap = lap({ title: '' })
    expect((await generateMetadata()).title).toBe('Szakembereknek')
  })

  it('piszkozatban a válasz nem indexelhető, és a piszkozatot kérdezi le', async () => {
    allapot.draft = true
    const meta = await generateMetadata()
    expect(meta.robots).toEqual(expect.objectContaining({ index: false }))
    expect(allapot.lekeresek).toEqual([{ slug: 'szakembereknek', draft: true }])
  })
})

// ---------------------------------------------------------------------------
// 4. Piszkozat: előnézet-sáv és szalagok
// ---------------------------------------------------------------------------

describe('piszkozat-előnézet', () => {
  it('rekord nélkül: előnézet-sáv szerkesztő-link nélkül, a „kódból jön” és a lapfej szalagja', async () => {
    allapot.draft = true
    const html = await render()
    expect(html).toContain(PREVIEW_BAR_SZOVEG)
    expect(html).not.toContain(VISSZA_A_SZERKESZTOBE)
    expect(html).toContain(`Szakembereknek oldal · ${KODBAN_VAN}`)
    expect(html).toContain('Ez az oldal még a weboldal kódjából jön.')
    expect(html).toContain('href="/admin/collections/pages"')
    expect(html).toContain(`${UGRAS_FELIRAT}: Oldalak`)
    expect(html).toContain(`Lapfej · ${RESZBEN_KODBAN_VAN}`)
    expect(html).not.toContain('kc-szerkeszto-szalag--oldal')
    // A lap maga a kódtartalék.
    expect(html).toContain('Akkreditált kézrehabilitációs képzés')
  })

  it('rekorddal: „Vissza a szerkesztőbe”, az egész oldal szalagja, a lapfej és a szekció szalagja', async () => {
    allapot.draft = true
    allapot.lap = lap({ layout: [kartyaBlokk()] })
    const html = await render()
    expect(html).toContain(VISSZA_A_SZERKESZTOBE)
    expect(html).toContain(`href="${szekcioMelylink({ collection: 'pages', id: 42 })}"`)
    expect(html).toContain('kc-szerkeszto-szalag--oldal')
    expect(html).toContain(`Lapfej · ${RESZBEN_KODBAN_VAN}`)
    expect(html).not.toContain('Ez az oldal még a weboldal kódjából jön.')
    // A szekció előtt a saját szalagja (a mélylink a blokkra visz): a lapfej
    // szekciója UTÁN, az Ajánlat-kártyák ELŐTT.
    const melylink = szekcioMelylink({ collection: 'pages', id: 42, blokkId: BLOKK_ID }).replace(
      /&/g,
      '&amp;',
    )
    expect(melylink).toContain(BLOKK_ID)
    const szalagHelye = html.indexOf(`href="${melylink}"`)
    expect(szalagHelye).toBeGreaterThan(html.indexOf('kc-szakemberek--fej'))
    expect(szalagHelye).toBeLessThan(html.indexOf('<section class="kc-section kc-ajanlat-kartyak"'))
  })

  it('rekorddal, csupa rejtett szekcióval: a kódbeli kártyák és a rejtett szekció szalagja', async () => {
    allapot.draft = true
    allapot.lap = lap({ layout: [kartyaBlokk({ sectionSettings: { visible: false } })] })
    const html = await render()
    expect(html).toContain('nincs látható szekciója')
    expect(html).toContain('Akkreditált kézrehabilitációs képzés')
    // A rejtett szekció szalagja a kódbeli kártyák után áll, a blokkra mutató mélylinkkel.
    const melylink = szekcioMelylink({ collection: 'pages', id: 42, blokkId: BLOKK_ID }).replace(
      /&/g,
      '&amp;',
    )
    expect(html.indexOf(`href="${melylink}"`)).toBeGreaterThan(
      html.indexOf('Akkreditált kézrehabilitációs képzés'),
    )
  })

  it('a szalagok és a sáv szövegében nincs töltelék gondolatjel', async () => {
    allapot.draft = true
    const html = await render()
    const szoveg = jsonLdNelkul(html).replace(/<[^>]+>/g, ' ')
    expect(szoveg).not.toMatch(/[–—]/)
  })
})

// ---------------------------------------------------------------------------
// 5. JSON-LD
// ---------------------------------------------------------------------------

describe('JSON-LD', () => {
  it('a szervezet-csomópont a feloldott kapcsolati e-mailt viszi', async () => {
    allapot.email = 'kapcsolat@pelda-rendelo.hu'
    const graf = jsonLd(await render())
    expect(graf).toContain('"email":"kapcsolat@pelda-rendelo.hu"')
    expect(graf).toContain('"@type":"BreadcrumbList"')
  })

  it('a lap neve és leírása a feloldott érték', async () => {
    allapot.lap = lap({
      title: 'Szakmai ajánlatok',
      seoDescription: 'Képzés és szakkönyv.',
      layout: [kartyaBlokk()],
    })
    const graf = jsonLd(await render())
    expect(graf).toContain('"name":"Szakmai ajánlatok"')
    expect(graf).toContain('"description":"Képzés és szakkönyv."')
    expect(graf).toContain('"dateModified":"2026-09-23T08:00:00.000Z"')
  })

  it('a kódtartalék blokk a szakkönyv vásárlási címével a #42 feliratra vált', () => {
    const blokk = szakembereknekAlapBlokk('https://pelda.hu/szakkonyv')
    const szakkonyv = blokk.kartyak?.[1]
    expect(szakkonyv?.felirat).toBe('Nézd meg a szakkönyvet')
    expect(szakkonyv?.hamarosan).toBe(false)
    expect(szakkonyv?.jegyzet).toBeNull()
    expect(szakkonyv?.ujAblakban).toBe(true)
  })
})
