import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PostArticle } from '../components/content/PostArticle'
import { shouldShowCategoryFilter } from '../components/content/post-list'
import { headingsOf, plainTextOf, RESERVED_ANCHOR_IDS, wordCountOf } from '../components/content/post-outline'
import {
  authorPersonOf,
  freeCourseCtaTargetOf,
  postCtaVariantOf,
  relatedHeading,
  shouldShowToc,
} from '../components/content/post-article'
import {
  APPOINTMENT_BOX_HEADING,
  APPOINTMENT_HREF,
  FREE_LINE_LEAD,
  FREE_LINE_LEAD_KEZ,
  FREE_LINE_TAIL,
} from '../components/content/PostCourseCta'
import { ctaLabel } from '../lib/cta-vocabulary'
import { betuMetrika, szoSzelessegPx } from './helpers/font-metrics'
import {
  elsoHossz,
  hosszPx,
  sajatErtek,
  stilusLapNezetablakra,
  szabalyok,
  tokenek,
  varFeloldas,
  type Elem,
} from './helpers/css-geometria'
import type { Post } from '../payload-types'

/**
 * ŐR — A TUDÁSTÁR CIKKOLDALA ÉS LISTÁJA.
 *
 * Mit véd, és miért csak végrehajtható szabály védheti meg:
 *
 *  G1  A tartalomjegyzék és a törzs HORGONYAI ugyanabból a bejárásból jönnek.
 *      Ha szétcsúsznak, a lap 200-zal válaszol, semmi nem hibázik, a linkek
 *      mégis a semmibe visznek — NÉMA hiba (docs/tudastar-ux-terv.md 5.4).
 *  G2  A jegyzék KÜSZÖBE (800 szó vagy 5 szakaszcím). Az NN/g kimondja, hogy
 *      „shorter pages make tables of contents unnecessary"; küszöb nélkül a
 *      jegyzék minden rövid cikk elé odakerülne.
 *  G3  Laponként legfeljebb EGY elsődleges cselekvés (B6.5).
 *  G4  Minden felirat a §3.2 CTA-szótárból; új felirat kitalálása tilos
 *      (WCAG 2.2 3.2.4 Consistent Identification).
 *  G5  Ellenőrzés-dátum ELLENŐRZÉS NÉLKÜL nem jelenhet meg, és a
 *      szerző-blokk címe sem állíthat meg nem történt ellenőrzést.
 *  G6  A GYIK strukturált adata a LÁTHATÓ listából épül (Google: *Structured
 *      data general policies*).
 *  G7  Kvirtmínusz (U+2014) sehol — sem a kódban, sem a kimeneten (§3.1.2).
 *  G8  A mért CSS-küszöbök: a kéthasábos rács track-korlátai és a CTA-sáv
 *      56 px-es zárótávja (a hamis lapvég ellen).
 *  G9  A cikkoldal MORZSAMENÜJE a kurzusoldaléval azonos szerkezetű és
 *      azonos stílusú (WCAG 2.2 3.2.3 Consistent Navigation), és a `<main>`
 *      valóban visszavisz a `/blog` gyűjtőoldalra.
 *  G10 A KAPCSOLÓDÓ blokk a Tudástár rácsán, `compact` kártyákkal áll: a
 *      kivonat sorhossz-problémája (24–38 karakter/sor) nem térhet vissza.
 *  G11 A TARTALOMJEGYZÉK előnézete: legfeljebb hat tétel látszik nyitás
 *      nélkül, a folytatás natív `details` mögött, folytatólagos számozással.
 *  G12 A cikk törzsének BEKEZDÉSKÖZE teljesíti a WCAG 2.2 1.4.8 (AAA)
 *      küszöbét, és a KÖZÖS `.kc-richtext` ritmusa nem mozdul el.
 *
 * A tesztkörnyezet `node` (nincs jsdom), ezért a SZERVER-RENDELT kimenetet
 * mérjük — pontosan azt, amit a JS nélküli látogató és a keresőrobot lát.
 */

const REPO = fileURLToPath(new URL('..', import.meta.url))

/**
 * Vevői forrásfájlok, amelyek tartalmazzák a mintát. A bejárás a `components`,
 * `app` és `blocks` fákon megy: egy új hívó ne maradjon ki egy kézi listából.
 */
function fajlokAhol(minta: string | RegExp, gyokerek: readonly string[]): string[] {
  const talalatok: string[] = []
  const illeszkedik = (forras: string): boolean =>
    typeof minta === 'string' ? forras.includes(minta) : minta.test(forras)
  const bejar = (relativDir: string): void => {
    for (const bejegyzes of readdirSync(join(REPO, relativDir), { withFileTypes: true })) {
      const ut = `${relativDir}/${bejegyzes.name}`
      if (bejegyzes.isDirectory()) {
        bejar(ut)
        continue
      }
      if (!/\.(tsx?|css)$/.test(bejegyzes.name)) continue
      if (illeszkedik(readFileSync(join(REPO, ut), 'utf8'))) talalatok.push(ut)
    }
  }
  for (const gyoker of gyokerek) bejar(gyoker)
  return talalatok.sort()
}

/** A cikkoldal stíluslapjának nyers forrása (a G8–G12 őrök ebből mérnek). */
const cikkCssForras = readFileSync(`${REPO}app/(frontend)/styles/blocks/post-view.css`, 'utf8')

/**
 * A tartalomjegyzék TELJES horgony-sorrendje, az előnézet és a kinyitható
 * folytatás listáját összefűzve.
 *
 * MIÉRT NEM ELÉG AZ ELSŐ `</ol>`-IG VÁGNI (2026-08-21): a jegyzék azóta KÉT
 * `<ol>`-ből áll (az első hat tétel + a `details` mögötti folytatás,
 * PostToc.tsx), a lapon pedig már a MORZSAMENÜ `<ol>`-je is megelőzi őket.
 * A régi, `indexOf('</ol>')`-alapú vágás emiatt a morzsánál zárt, és üres
 * listát mért. A `nav.kc-post-toc` blokkjából olvasunk, tehát a jegyzék
 * belső szerkezete szabadon változhat: a MÉRT MENNYISÉG a horgonyok
 * sorrendje marad.
 */
function tocHorgonyok(html: string): string[] {
  const eleje = html.indexOf('class="kc-post-toc"')
  if (eleje < 0) return []
  const vege = html.indexOf('</nav>', eleje)
  const blokk = html.slice(eleje, vege < 0 ? undefined : vege)
  return [...blokk.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]!)
}

const render = (element: Parameters<typeof renderToStaticMarkup>[0]): string =>
  renderToStaticMarkup(element)

// ---------------------------------------------------------------------------
// Fixture-építők
// ---------------------------------------------------------------------------

function textNode(text: string): Record<string, unknown> {
  return { type: 'text', detail: 0, format: 0, mode: 'normal', style: '', text, version: 1 }
}

function paragraph(text: string): Record<string, unknown> {
  return {
    type: 'paragraph',
    direction: 'ltr',
    format: '',
    indent: 0,
    version: 1,
    children: [textNode(text)],
  }
}

function heading(tag: string, text: string): Record<string, unknown> {
  return {
    type: 'heading',
    tag,
    direction: 'ltr',
    format: '',
    indent: 0,
    version: 1,
    children: [textNode(text)],
  }
}

function lexical(children: Record<string, unknown>[]): Record<string, unknown> {
  return {
    root: { type: 'root', children, direction: 'ltr', format: '', indent: 0, version: 1 },
  }
}

/** Adott szószámú, valódi szavakból álló bekezdés. */
function words(count: number): string {
  return Array.from({ length: count }, (_, index) => `szo${index + 1}`).join(' ')
}

/**
 * Poszt-fixture.
 *
 * A `Record<string, unknown>` + kettős konverzió SZÁNDÉKOS: a cikkoldal öt
 * olyan mezőt is olvas (`faq`, `ctaCourse`, `reviewedBy`, `reviewedAt`,
 * `nextReviewAt`), amelyet a séma-kör (E-csomag) most vezet be, tehát a
 * generált `Post` típus még nem ismeri. A felület szerződése épp az, hogy
 * ezek nélkül is helyesen működik, velük pedig kódváltozás nélkül gazdagodik
 * — ezt csak akkor tudjuk mérni, ha a fixture ki tudja tölteni őket.
 */
function post(overrides: Record<string, unknown> = {}): Post {
  const base: Record<string, unknown> = {
    id: 1,
    title: 'Miért zsibbad a kezem?',
    slug: 'miert-zsibbad-a-kezem',
    excerpt: 'Mit jelent a zsibbadás, mit tehetsz otthon, és mikor fordulj szakemberhez.',
    status: 'published',
    publishedAt: '2026-08-21T08:00:00.000Z',
    updatedAt: '2026-08-21T08:00:00.000Z',
    createdAt: '2026-08-20T08:00:00.000Z',
    content: lexical([paragraph('Rövid bevezető.')]),
    categories: [{ id: 5, title: 'Kézrehabilitáció', slug: 'kezrehabilitacio' }],
  }
  return { ...base, ...overrides } as unknown as Post
}

/** A kimenet látható szövege (címkék nélkül, entitás-feloldással). */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A kimenetben ténylegesen kiosztott id-k. */
function idsOf(html: string): string[] {
  return [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]!)
}

/** A lap belső (horgony-) hivatkozásai. */
function anchorHrefs(html: string): string[] {
  return [...html.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]!)
}

/** A JSON-LD blokkok feloldott tartalma. */
function jsonLdBlocks(html: string): Record<string, unknown>[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
    (match) => JSON.parse(match[1]!.replace(/\\u003c/g, '<')) as Record<string, unknown>,
  )
}

/** Hosszú, tagolt cikk: 5 szakaszcím és 900+ szó. */
const HOSSZU_CIKK = lexical([
  heading('h2', 'Miért zsibbad a kéz'),
  paragraph(words(300)),
  heading('h2', 'Melyik ujjad zsibbad'),
  paragraph(words(300)),
  heading('h2', 'Mit tehetsz otthon'),
  paragraph(words(300)),
  heading('h2', 'Mikor fordulj szakemberhez'),
  paragraph(words(50)),
  heading('h2', 'Források'),
  paragraph(words(50)),
])

// ---------------------------------------------------------------------------
// G1 — horgony és tartalomjegyzék
// ---------------------------------------------------------------------------

describe('G1 — a tartalomjegyzék és a törzs horgonyai nem csúszhatnak szét', () => {
  const html = render(createElement(PostArticle, { post: post({ content: HOSSZU_CIKK }) }))

  it('a törzs MINDEN szakaszcíme kap horgonyt, magyar ékezetekkel is', () => {
    expect(html).toContain('<h2 id="miert-zsibbad-a-kez">')
    expect(html).toContain('<h2 id="melyik-ujjad-zsibbad">')
    expect(html).toContain('<h2 id="forrasok">')
  })

  it('a jegyzék MINDEN hivatkozása létező horgonyra mutat ugyanazon a lapon', () => {
    const ids = new Set(idsOf(html))
    const hrefs = anchorHrefs(html)
    expect(hrefs.length).toBeGreaterThan(0)
    for (const href of hrefs) {
      expect(ids.has(href)).toBe(true)
    }
  })

  it('a jegyzék tételei a szakaszcímek szövegét és SORRENDJÉT hozzák', () => {
    const sorrend = tocHorgonyok(html)
    expect(sorrend).toEqual([
      'miert-zsibbad-a-kez',
      'melyik-ujjad-zsibbad',
      'mit-tehetsz-otthon',
      'mikor-fordulj-szakemberhez',
      'forrasok',
    ])
  })

  it('egyetlen id sem fordul elő kétszer a lapon', () => {
    const ids = idsOf(html)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('a nav-nak van hozzáférhető neve (aria-labelledby → létező címsor)', () => {
    expect(html).toContain('aria-labelledby="tudastar-toc-cim"')
    expect(html).toContain('id="tudastar-toc-cim"')
  })

  it('pontosan EGY h1 van a lapon (a cikk címe)', () => {
    expect([...html.matchAll(/<h1[\s>]/g)]).toHaveLength(1)
  })

  it('azonos szövegű szakaszcímek külön horgonyt kapnak (ütközés-feloldás)', () => {
    const bejegyzesek = headingsOf(
      lexical([heading('h2', 'Gyakorlatok'), heading('h2', 'Gyakorlatok'), heading('h2', 'Gyakorlatok')]),
    )
    expect(bejegyzesek.map((entry) => entry.id)).toEqual([
      'gyakorlatok',
      'gyakorlatok-2',
      'gyakorlatok-3',
    ])
  })

  it('tartalmi szakaszcím nem veheti el a lap saját horgonyait', () => {
    const bejegyzesek = headingsOf(
      lexical([heading('h2', 'Tartalom'), heading('h2', 'Gyakori kérdések')]),
    )
    for (const entry of bejegyzesek) {
      expect(RESERVED_ANCHOR_IDS).not.toContain(entry.id)
    }
  })

  it('a tartalmi h1 a jegyzékben is h2-ként szerepel (a szerializáló lágyítása)', () => {
    expect(headingsOf(lexical([heading('h1', 'Bevezető')]))[0]!.tag).toBe('h2')
  })

  it('üres (csak írásjeles) szakaszcím is kap stabil horgonyt', () => {
    expect(headingsOf(lexical([heading('h2', '???')]))[0]!.id).toBe('szakasz-1')
  })
})

// ---------------------------------------------------------------------------
// G2 — a jegyzék megjelenési küszöbe
// ---------------------------------------------------------------------------

describe('G2 — tartalomjegyzék csak ott, ahol segít', () => {
  it('a küszöb: 800 szónál hosszabb VAGY legalább 5 szakaszcím', () => {
    expect(shouldShowToc(801, 0)).toBe(true)
    expect(shouldShowToc(0, 5)).toBe(true)
    expect(shouldShowToc(800, 4)).toBe(false)
    expect(shouldShowToc(0, 0)).toBe(false)
  })

  it('hosszú, tagolt cikken MEGJELENIK', () => {
    const html = render(createElement(PostArticle, { post: post({ content: HOSSZU_CIKK }) }))
    expect(html).toContain('kc-post-toc')
    expect(text(html)).toContain('Ezen az oldalon')
  })

  it('rövid cikken NEM jelenik meg', () => {
    const rovid = lexical([heading('h2', 'Egy szakasz'), paragraph(words(120))])
    const html = render(createElement(PostArticle, { post: post({ content: rovid }) }))
    expect(html).not.toContain('kc-post-toc')
    expect(text(html)).not.toContain('Ezen az oldalon')
  })

  it('a GYIK címsora a jegyzék VÉGÉN áll (a bejáró nem látja, a lap igen)', () => {
    const html = render(
      createElement(PostArticle, {
        post: post({
          content: HOSSZU_CIKK,
          faq: [{ question: 'Meddig tart a zsibbadás?', answer: 'Az okától függ.' }],
        }),
      }),
    )
    const sorrend = tocHorgonyok(html)
    expect(sorrend[sorrend.length - 1]).toBe('gyakori-kerdesek')
    expect(html).toContain('id="gyakori-kerdesek"')
  })
})

// ---------------------------------------------------------------------------
// G3 + G4 — a kurzus-ajánló: egy cselekvés, szótári felirattal
// ---------------------------------------------------------------------------

const KURZUS = {
  id: 7,
  status: 'published',
  slug: 'kezrehabilitacio-otthon',
  sku: 'KEZ-1',
  displayTitle: 'Kézrehabilitáció otthon',
  shortDescription: 'Vezetett gyakorlatsor csukló- és kézpanaszokra, otthoni tempóban.',
  priceInHUFEnabled: true,
  priceInHUF: 19900,
}

describe('G3 + G4 — kurzus-ajánló: egy elsődleges cselekvés, szótári felirattal', () => {
  it('kapcsolt kurzus nélkül a kurzuslistára visz, a szótár feliratával', () => {
    const html = render(createElement(PostArticle, { post: post() }))
    expect(text(html)).toContain(ctaLabel('course-list-open'))
    expect(html).toContain('href="/kurzusok"')
  })

  it('kapcsolt kurzussal a kurzusoldalra visz, MÁSODLAGOS súllyal és ár-ténnyel', () => {
    const html = render(createElement(PostArticle, { post: post({ ctaCourse: KURZUS }) }))
    expect(text(html)).toContain(ctaLabel('course-sales-open'))
    expect(html).toContain('href="/kurzusok/kezrehabilitacio-otthon"')
    expect(html).toContain('kc-button--secondary')
    // Az ár a gomb közvetlen közelében áll (Baymard B6.2).
    expect(text(html)).toContain('19 900')
  })

  it('NEM közzétett kurzusra nem mutatunk halott linket', () => {
    const html = render(
      createElement(PostArticle, { post: post({ ctaCourse: { ...KURZUS, status: 'draft' } }) }),
    )
    expect(html).not.toContain('href="/kurzusok/kezrehabilitacio-otthon"')
    expect(text(html)).toContain(ctaLabel('course-list-open'))
  })

  it('laponként legfeljebb EGY elsődleges gomb (mindkét ágon)', () => {
    for (const fixture of [post(), post({ ctaCourse: KURZUS })]) {
      const html = render(createElement(PostArticle, { post: fixture }))
      expect([...html.matchAll(/kc-button--primary/g)].length).toBeLessThanOrEqual(1)
    }
  })

  it('a panel nem ígér gyógyulást, arányt, időt és nem sürget', () => {
    const tiltott = ['garant', 'gyógyul', '%', 'már csak', 'siess', 'utolsó']
    const html = text(render(createElement(PostArticle, { post: post() }))).toLowerCase()
    for (const szo of tiltott) {
      expect(html).not.toContain(szo)
    }
  })

  it('befagyott-vall: a panel MEGVAN, és időpontkérésre visz, nem kurzusra', () => {
    // Tulajdonosi döntés (2026-08-25): a váll-cikk alatt is áll ajánló, de a
    // releváns következő lépéssel (személyes vizsgálat), nem kéz-kurzussal.
    expect(postCtaVariantOf({ slug: 'befagyott-vall' })).toBe('idopont')
    const html = render(createElement(PostArticle, { post: post({ slug: 'befagyott-vall' }) }))
    expect(html).toContain('kc-post-cta')
    expect(text(html)).toContain(ctaLabel('appointment-request-link'))
    expect(html).toContain(`href="${APPOINTMENT_HREF}"`)
    expect(text(html)).not.toContain(ctaLabel('course-list-open'))
    expect(html).not.toContain('href="/kurzusok"')
  })

  it('a hat élő cikk és az ínhüvelygyulladás kurzus-CTA-ja megmarad', () => {
    expect(postCtaVariantOf({ slug: 'miert-zsibbad-a-kezem' })).toBe('kurzus')
    expect(postCtaVariantOf({ slug: 'inhuvelygyulladas' })).toBe('kurzus')
    const elo = render(createElement(PostArticle, { post: post() }))
    expect(text(elo)).toContain(ctaLabel('course-list-open'))
    expect(elo).toContain('href="/kurzusok"')
    const inhuvely = render(
      createElement(PostArticle, {
        post: post({ slug: 'inhuvelygyulladas', ctaCourse: KURZUS }),
      }),
    )
    expect(text(inhuvely)).toContain(ctaLabel('course-sales-open'))
    expect(inhuvely).toContain('href="/kurzusok/kezrehabilitacio-otthon"')
  })
})

// ---------------------------------------------------------------------------
// G3b — az ingyenes belépő halk sora (tulajdonosi döntés, 2026-08-25)
// ---------------------------------------------------------------------------

const INGYENES = {
  id: 9,
  status: 'published',
  slug: 'sos-kezrelax',
  sku: 'SOS-0',
  displayTitle: 'SOS Kézrelax villámkurzus',
  shortDescription: null,
  priceInHUFEnabled: false,
  priceInHUF: null,
}

describe('G3b — az ingyenes belépő sora minden cikk-ajánlóban', () => {
  it('kéz-cikk alatt a sima felvezetéssel és a kurzus címére mutató linkkel áll', () => {
    const html = render(
      createElement(PostArticle, { post: post({ ctaCourse: KURZUS }), freeCourse: INGYENES }),
    )
    // A linkszöveg a cél oldal neve (GOV.UK linkszöveg-szabály), a mondat a
    // rögzített darabokból áll össze. (A text() a címkehatárra szóközt tesz,
    // ezért a lead+cím és a zárás külön ellenőrzés.)
    expect(text(html)).toContain(`${FREE_LINE_LEAD}SOS Kézrelax villámkurzus`)
    expect(text(html)).toContain(FREE_LINE_TAIL.slice(1).trim())
    expect(html).toContain('href="/kurzusok/sos-kezrelax"')
  })

  it('a váll-cikk alatt kimondja, hogy a kurzus kézpanaszokra szól', () => {
    const html = render(
      createElement(PostArticle, {
        post: post({ slug: 'befagyott-vall' }),
        freeCourse: INGYENES,
      }),
    )
    expect(text(html)).toContain(FREE_LINE_LEAD_KEZ)
    expect(html).toContain('href="/kurzusok/sos-kezrelax"')
  })

  it('ingyenes termék nélkül a sor elmarad', () => {
    const html = render(createElement(PostArticle, { post: post() }))
    expect(html).not.toContain('kc-post-cta__free')
  })

  it('fizetős, beállítatlan árú vagy nem publikált termék sosem ad ingyenes sort', () => {
    expect(freeCourseCtaTargetOf(KURZUS)).toBeNull()
    expect(freeCourseCtaTargetOf({ ...INGYENES, priceInHUFEnabled: null })).toBeNull()
    expect(freeCourseCtaTargetOf({ ...INGYENES, status: 'draft' })).toBeNull()
    expect(freeCourseCtaTargetOf(null)).toBeNull()
  })

  it('ha a kapcsolt kurzus maga az ingyenes, a sor nem duplikálja a célt', () => {
    // NN/g, The Same Link Twice on the Same Page: a duplikált linknek ára van.
    const html = render(
      createElement(PostArticle, {
        post: post({ ctaCourse: { ...INGYENES } }),
        freeCourse: INGYENES,
      }),
    )
    expect(html).not.toContain('kc-post-cta__free')
  })

  it('az időpontkérő doboz minden kéz-cikk alatt áll, pontosan egyszer', () => {
    // Tulajdonosi kérés (2026-08-25): az írásos időpontkérés minden cikk
    // alól elérhető, a #24 felirattal, a dedikált kapcsolat-szekcióra.
    for (const fixture of [post(), post({ ctaCourse: KURZUS })]) {
      const html = render(createElement(PostArticle, { post: fixture }))
      expect(text(html)).toContain(APPOINTMENT_BOX_HEADING)
      expect(text(html)).toContain(ctaLabel('appointment-request-link'))
      expect([...html.matchAll(new RegExp(`href="${APPOINTMENT_HREF}"`, 'g'))].length).toBe(1)
    }
  })

  /**
   * Élő HTTP, 2026-08-27: a két fehér panel csak ezeken a 7 cikken áll,
   * testvérként a keskeny konténerben, csomagoló nélkül.
   */
  const KEZ_CIKK_PAR_SLUGOK = [
    'inhuvelygyulladas',
    'keztoalagut-szindroma',
    'teniszkonyok',
    'miert-zsibbad-a-kezem',
    'csuklotores-utani-gyogytorna',
    'csuklo-es-kezfajdalom',
    'pattano-ujj',
  ] as const

  it('a 7 kéz-cikk két testvér-panelt ad, csomagoló nélkül', () => {
    // 2026-08-29 (tulajdonosi kérés): a két paneles pár a SZÉLES konténerben
    // ül (kc-container, --narrow módosító nélkül), a kapcsolódó rács
    // szélességével azonosan.
    const testver = /kc-container">\s*<section class="kc-card kc-card--padded kc-post-cta__panel"[\s\S]*?<\/section>\s*<section class="kc-card kc-card--padded kc-post-cta__panel"/
    for (const slug of KEZ_CIKK_PAR_SLUGOK) {
      const html = render(
        createElement(PostArticle, { post: post({ slug, ctaCourse: KURZUS }) }),
      )
      expect(html, slug).not.toContain('kc-post-cta__pair')
      expect([...html.matchAll(/kc-post-cta__panel/g)].length, slug).toBe(2)
      expect(html, slug).toMatch(testver)
      expect(text(html), slug).toContain(APPOINTMENT_BOX_HEADING)
    }
  })

  it('a váll-cikk egyetlen panelt kap, második doboz nélkül', () => {
    const html = render(createElement(PostArticle, { post: post({ slug: 'befagyott-vall' }) }))
    expect(html).not.toContain('kc-post-cta__pair')
    expect([...html.matchAll(/kc-post-cta__panel/g)].length).toBe(1)
    expect(text(html)).not.toContain(APPOINTMENT_BOX_HEADING)
  })

  it('a kc-post-cta csak a cikkoldalon él (/szolgaltatasok, kezdőlap, kurzusok nem kapják)', () => {
    // A `/szolgaltatasok`, a `/` és a `/kurzusok` más mintát használnak.
    // Osztály-szivárgás vagy PostCourseCta-import oda: a következő ügynök
    // második panelt „javítana" oda, ahova a minta nem való.
    expect(fajlokAhol('kc-post-cta', ['components', 'app', 'blocks'])).toEqual([
      'app/(frontend)/styles/blocks/post-view.css',
      'components/analytics/ArticleEngagement.tsx',
      'components/content/PostArticle.tsx',
      'components/content/PostCourseCta.tsx',
    ])
    expect(fajlokAhol(/from ['"][^'"]*PostCourseCta['"]/, ['components', 'app', 'blocks'])).toEqual([
      'components/content/PostArticle.tsx',
    ])
  })

  it('a váll-cikk alatt az időpontkérés nem duplikálódik', () => {
    // Ott a fő panel maga az időpontkérés; a külön doboz nem ismétli meg
    // (NN/g, The Same Link Twice on the Same Page).
    const html = render(createElement(PostArticle, { post: post({ slug: 'befagyott-vall' }) }))
    expect([...html.matchAll(new RegExp(`href="${APPOINTMENT_HREF}"`, 'g'))].length).toBe(1)
    expect(text(html)).not.toContain(APPOINTMENT_BOX_HEADING)
  })

  it('a sor és az időpontos ág nem ígér gyógyulást, arányt és nem sürget', () => {
    const tiltott = ['garant', 'gyógyul', '%', 'már csak', 'siess', 'utolsó']
    for (const fixture of [
      post({ ctaCourse: KURZUS }),
      post({ slug: 'befagyott-vall' }),
    ]) {
      const html = text(
        render(createElement(PostArticle, { post: fixture, freeCourse: INGYENES })),
      ).toLowerCase()
      for (const szo of tiltott) {
        expect(html).not.toContain(szo)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// G5 — szerző- és lektor-blokk
// ---------------------------------------------------------------------------

const SZERZO = { id: 2, name: 'Kocsis Kata', credentials: 'gyógytornász, kézterapeuta' }

describe('G5 — a szerző-blokk csak azt állítja, ami megtörtént', () => {
  it('lektorálás nélkül a cím „A cikket írta", és NINCS dátum-sor', () => {
    const html = render(createElement(PostArticle, { post: post({ author: SZERZO }) }))
    const latszik = text(html)
    expect(latszik).toContain('A cikket írta')
    expect(latszik).not.toContain('A cikket írta és ellenőrizte')
    expect(latszik).not.toContain('Utoljára ellenőrizve')
    expect(latszik).not.toContain('Következő ellenőrzés')
  })

  it('lektorálással a cím bővül, és a két dátum kiíródik', () => {
    const html = render(
      createElement(PostArticle, {
        post: post({
          author: SZERZO,
          reviewedBy: { id: 3, name: 'Kiss Kata', credentials: 'gyógytornász' },
          reviewedAt: '2026-08-21T08:00:00.000Z',
          nextReviewAt: '2028-08-21T08:00:00.000Z',
        }),
      }),
    )
    const latszik = text(html)
    expect(latszik).toContain('A cikket írta és ellenőrizte')
    expect(latszik).toContain('Szakmailag ellenőrizte: Kiss Kata, gyógytornász')
    expect(latszik).toContain('Utoljára ellenőrizve: 2026. augusztus 21.')
    expect(latszik).toContain('Következő ellenőrzés: 2028. augusztus 21.')
  })

  it('a byline a fejlécben a végzettséget is kimondja (Google E-E-A-T „Who")', () => {
    const html = render(createElement(PostArticle, { post: post({ author: SZERZO }) }))
    expect(text(html)).toContain('Írta: Kocsis Kata, gyógytornász, kézterapeuta')
  })

  it('szerző és lektorálás nélkül a blokk elmarad (nem üres keret)', () => {
    const html = render(createElement(PostArticle, { post: post() }))
    expect(html).not.toContain('kc-post-author')
  })

  it('a szerző-olvasó KIZÁRÓLAG a négy publikus mezőt adja tovább', () => {
    // A `getPostBySlug` depth: 2 + overrideAccess: true hívása a szerzőt
    // TELJES user-dokumentumként populálja (e-mail, jelszó-hash, salt,
    // szerepkör, vásárlások). Az olvasó ezért fehérlistás: ha bárki
    // kiterjeszti (pl. szétteríti a nyers objektumot), ez a teszt bukik.
    const szemely = authorPersonOf(
      post({
        author: {
          ...SZERZO,
          email: 'kata@example.invalid',
          role: 'owner',
          hash: 'titkos-hash',
          salt: 'titkos-salt',
          purchases: [7],
        },
      }),
    )
    expect(szemely).not.toBeNull()
    expect(Object.keys(szemely!).sort()).toEqual(['bioShort', 'credentials', 'name', 'portrait'])
  })

  it('a renderelt lapon nincs egyetlen user-titok sem', () => {
    const html = render(
      createElement(PostArticle, {
        post: post({
          author: {
            ...SZERZO,
            email: 'kata@example.invalid',
            role: 'owner',
            hash: 'titkos-hash',
            salt: 'titkos-salt',
          },
        }),
      }),
    )
    for (const titok of ['kata@example.invalid', 'owner', 'titkos-hash', 'titkos-salt']) {
      expect(html).not.toContain(titok)
    }
  })
})

// ---------------------------------------------------------------------------
// G6 — GYIK: a séma a látható listából
// ---------------------------------------------------------------------------

describe('G6 — a GYIK strukturált adata a LÁTHATÓ listából épül', () => {
  const faq = [
    { question: 'Meddig tart a zsibbadás?', answer: 'Az okától függ.' },
    { question: 'Kell-e sín?', answer: 'Az okától és a tünetektől függ.' },
    { question: '', answer: 'Kérdés nélküli válasz.' },
    { question: 'Válasz nélküli kérdés?', answer: '' },
    { question: 'Harmadik?', answer: 'Igen.' },
    { question: 'Negyedik?', answer: 'Igen.' },
    { question: 'Ötödik?', answer: 'Igen.' },
    { question: 'Hatodik?', answer: 'Igen.' },
    { question: 'Hetedik?', answer: 'Igen.' },
  ]
  const html = render(createElement(PostArticle, { post: post({ faq }) }))

  it('a hiányos tétel sem a listába, sem a sémába nem kerül be', () => {
    expect(text(html)).not.toContain('Kérdés nélküli válasz')
    expect(text(html)).not.toContain('Válasz nélküli kérdés')
  })

  it('legfeljebb HAT tétel jelenik meg (NHS felsorolás-plafon)', () => {
    expect([...html.matchAll(/kc-faq__item/g)]).toHaveLength(6)
  })

  it('a FAQPage séma kérdései PONTOSAN a látható kérdések', () => {
    const faqPage = jsonLdBlocks(html).find((block) => block['@type'] === 'FAQPage')
    expect(faqPage).toBeDefined()
    const mainEntity = faqPage!.mainEntity as { name: string }[]
    const lathato = [...html.matchAll(/class="kc-faq__question">([^<]+)</g)].map((m) => m[1]!)
    expect(mainEntity.map((entry) => entry.name)).toEqual(lathato)
  })

  it('GYIK nélküli cikken nincs sem szekció, sem FAQPage séma', () => {
    const ures = render(createElement(PostArticle, { post: post() }))
    expect(ures).not.toContain('kc-post-faq')
    expect(jsonLdBlocks(ures).some((block) => block['@type'] === 'FAQPage')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Kapcsolódó cikkek, kategória-címke, olvasási idő
// ---------------------------------------------------------------------------

describe('kapcsolódó blokk, kategória-címke, olvasási idő', () => {
  const kapcsolodo = (id: number, categoryId: number): Post =>
    post({
      id,
      title: `Kapcsolódó cikk ${id}`,
      slug: `kapcsolodo-${id}`,
      categories: [{ id: categoryId, title: 'Kézrehabilitáció', slug: 'kezrehabilitacio' }],
    })

  it('a cím megnevezi a témát, ha MINDEN kapcsolódó cikk osztozik rajta', () => {
    expect(relatedHeading(post(), [kapcsolodo(2, 5), kapcsolodo(3, 5)])).toBe(
      'További cikkek a témában: Kézrehabilitáció',
    )
  })

  it('vegyes témájú ajánlónál az általános cím áll (nem állítunk valótlant)', () => {
    expect(relatedHeading(post(), [kapcsolodo(2, 5), kapcsolodo(3, 9)])).toBe(
      'További cikkek a Tudástárból',
    )
  })

  it('a fejlécben PONTOSAN egy kategória-címke áll', () => {
    const html = render(
      createElement(PostArticle, {
        post: post({
          categories: [
            { id: 5, title: 'Kézrehabilitáció', slug: 'kezrehabilitacio' },
            { id: 6, title: 'Műtét után', slug: 'mutet-utan' },
          ],
        }),
      }),
    )
    const fejlec = html.slice(0, html.indexOf('</h1>'))
    expect([...fejlec.matchAll(/kc-badge--info/g)]).toHaveLength(1)
    expect(fejlec).not.toContain('Műtét után')
  })

  it('nem közzétett kapcsolódó cikk nem jelenik meg', () => {
    const html = render(
      createElement(PostArticle, {
        post: post(),
        related: [{ ...kapcsolodo(2, 5), status: 'draft' } as Post],
      }),
    )
    expect(html).not.toContain('kapcsolodo-2')
  })

  it('az olvasási idő becslés-jelleget jelöl, és VALÓDI szavakból számol', () => {
    // 400 valódi szó → kb. 2 perc. A nyers fa-bejárás a mező-értékeket
    // (`paragraph`, `ltr`, `text`, `normal`) is szónak számolná, és 3 percet
    // adna — ez a teszt pontosan ezt a különbséget méri.
    const html = render(
      createElement(PostArticle, { post: post({ content: lexical([paragraph(words(400))]) }) }),
    )
    expect(text(html)).toContain('kb. 2 perc olvasás')
  })

  it('a szó-számláló csak a szöveg-csomópontokat számolja', () => {
    expect(wordCountOf(lexical([paragraph(words(400))]))).toBe(400)
    expect(plainTextOf(lexical([heading('h2', 'Cím'), paragraph('Egy két')]))).toBe('Cím Egy két')
  })
})

// ---------------------------------------------------------------------------
// A lista-oldal szabálya
// ---------------------------------------------------------------------------

describe('lista-oldal — a kategória-szűrő megjelenési küszöbe', () => {
  it('három cikkes kategória VAGY öt cikk kell hozzá', () => {
    expect(shouldShowCategoryFilter(3, 0)).toBe(true)
    expect(shouldShowCategoryFilter(0, 5)).toBe(true)
    expect(shouldShowCategoryFilter(2, 4)).toBe(false)
    expect(shouldShowCategoryFilter(0, 0)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// G7 — mikroszöveg
// ---------------------------------------------------------------------------

describe('G7 — kvirtmínusz (U+2014) sehol', () => {
  const forrasok = [
    'components/content/PostArticle.tsx',
    'components/content/PostToc.tsx',
    'components/content/PostFaq.tsx',
    'components/content/PostAuthorBox.tsx',
    'components/content/PostCourseCta.tsx',
    'components/content/PostBody.tsx',
    'components/content/post-article.ts',
    'components/content/post-outline.ts',
    'components/content/post-list.ts',
    'app/(frontend)/blog/page.tsx',
    'app/(frontend)/blog/[slug]/page.tsx',
  ]

  it('a komponensek SZÖVEG-literáljaiban nincs kvirtmínusz', () => {
    for (const relativ of forrasok) {
      const forras = readFileSync(`${REPO}${relativ}`, 'utf8')
      // A kommentek magyarázó szövegek, nem a felület mikroszövegei.
      const kodCsak = forras.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      expect(kodCsak, `${relativ} kvirtmínuszt tartalmaz`).not.toContain('—')
    }
  })

  it('a renderelt cikkoldalon sincs kvirtmínusz', () => {
    const html = render(
      createElement(PostArticle, {
        post: post({ author: SZERZO, ctaCourse: KURZUS, content: HOSSZU_CIKK }),
      }),
    )
    expect(html).not.toContain('—')
  })
})

// ---------------------------------------------------------------------------
// G8 — a mért CSS-küszöbök
// ---------------------------------------------------------------------------

describe('G8 — a mért CSS-küszöbök nem csúszhatnak vissza', () => {
  const cikkCss = readFileSync(`${REPO}app/(frontend)/styles/blocks/post-view.css`, 'utf8')
  const listaCss = readFileSync(`${REPO}app/(frontend)/styles/blocks/tudastar-lista.css`, 'utf8')
  const kodCsak = (forras: string): string => forras.replace(/\/\*[\s\S]*?\*\//g, '')

  /**
   * JAVÍTVA 2026-08-21. A korábbi állítás betűhíven a HIBÁS szabályt várta
   * (`repeat(auto-fit, minmax(min(100%, 26rem), 34rem))`), ami böngészőben
   * MINDEN szélességen egy hasábot adott. A mai szabály három dolgot mond
   * egyszerre, és mindhármat külön kell védeni:
   *   - `auto-fill` (NEM `auto-fit`): üres sáv nem csukódik össze, tehát
   *     egyetlen cikknél sem lesz 1072 px-es óriáskártya;
   *   - `1fr` felső korlát: NEM határozott, ezért az ismétlésszám az alsó
   *     trackkel számol (CSS Grid 1, §7.2.3.1);
   *   - a MÉRTÉK a kártyán ül (`max-width: 34rem`), nem a tracken.
   */
  it('a poszt-rács auto-fill alapú, 28rem alsó track-korláttal és 1fr felsővel', () => {
    const szabaly = kodCsak(listaCss)
    expect(szabaly).toContain('.kc-card-grid.kc-card-grid--posts')
    expect(szabaly).toContain('repeat(auto-fill, minmax(min(100%, 28rem), 1fr))')
    // `auto-fit` visszacsúszás: az üres sáv összecsukása + `1fr` óriáskártyát ad.
    expect(szabaly).not.toContain('auto-fit')
  })

  it('a poszt-kártya mértéke a KÁRTYÁN ül, nem a rács felső trackjén', () => {
    const szabaly = kodCsak(listaCss)
    expect(szabaly).toMatch(
      /\.kc-card-grid\.kc-card-grid--posts > \*\s*\{[^}]*max-width:\s*34rem;/,
    )
    expect(szabaly).toMatch(/\.kc-card-grid\.kc-card-grid--posts > \*\s*\{[^}]*width:\s*100%;/)
  })

  it('a CTA-sáv és a kapcsolódó blokk közti táv 56 px (a küszöb 72 px)', () => {
    const szabaly = kodCsak(cikkCss)
    expect(szabaly).toMatch(
      /\.kc-section\.kc-post-cta--elotte-kapcsolodo\s*\{\s*padding-block-end:\s*var\(--kc-space-5\);/,
    )
    expect(szabaly).toMatch(
      /\.kc-section\.kc-post-related\s*\{\s*padding-block-start:\s*var\(--kc-space-6\);/,
    )
  })

  it('a kurzus + időpont pár mobilon egymás alatt, 900 px-től két hasáb', () => {
    const szabaly = kodCsak(cikkCss).replace(/\s+/g, ' ')
    expect(szabaly).toMatch(
      /\.kc-post-cta__panel \+ \.kc-post-cta__panel \{ margin-block-start: var\(--kc-space-5\); \}/,
    )
    expect(szabaly).toContain(
      '.kc-post-cta .kc-container:has(> .kc-post-cta__panel + .kc-post-cta__panel)',
    )
    expect(szabaly).toMatch(
      /@media \(min-width: 900px\) \{ [^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);/,
    )
    expect(szabaly).not.toContain('kc-post-cta__pair')
    expect(szabaly).not.toContain('@media (min-width: 640px)')
  })

  it('a tartalomjegyzék linkjei 44 px-es érintőcélt kapnak', () => {
    expect(kodCsak(cikkCss)).toMatch(/\.kc-post-toc__list a\s*\{[^}]*min-height:\s*2\.75rem;/)
  })

  it('a cikkoldal stíluslapja NEM tartalmaz mozgást (WCAG 2.2 2.3.3)', () => {
    const szabaly = kodCsak(cikkCss)
    expect(szabaly).not.toMatch(/\btransition\b/)
    expect(szabaly).not.toMatch(/\banimation\b/)
    expect(szabaly).not.toMatch(/\btransform\b/)
  })

  it('betűméret kizárólag a három tokenről (a skála zárt)', () => {
    for (const forras of [cikkCss, listaCss]) {
      const meretek = [...kodCsak(forras).matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1]!.trim())
      for (const meret of meretek) {
        expect(['var(--kc-font-l)', 'var(--kc-font-m)', 'var(--kc-font-s)']).toContain(meret)
      }
    }
  })

  it('a nyomtatás kiírja a forrás-linkek webcímét', () => {
    expect(kodCsak(cikkCss)).toContain("content: ' (' attr(href) ')'")
  })
})

// ---------------------------------------------------------------------------
// MÉRÉS — a küszöbök a VALÓDI CSS-ből és a VALÓDI metszetekből számolva
// ---------------------------------------------------------------------------

/**
 * Miért számítás és nem böngésző: a repónak nincs playwright-függősége, a
 * CI-ban nincs böngésző, egy böngészős teszt tehát vagy elbukna, vagy NÉMÁN
 * kimaradna. A modell a `helpers/css-geometria.ts` és a
 * `helpers/font-metrics.ts` már kalibrált harnessze (lásd
 * `reflow-hasabmeres.test.ts` kalibrációs blokkját): a kaszkádot a valódi
 * stíluslapokból, a szó-szélességet a `public/fonts/*.woff2` `hmtx`/`HVAR`
 * tábláiból olvassa. Kerning nélkül számol, ezért FELSŐ becslés — a
 * biztonságos oldalon téved.
 */
const GYOKER_UT = fileURLToPath(new URL('../..', import.meta.url))
const GYOKER_BETU = 16

const LAPOK = [
  `${REPO}app/(frontend)/styles/tokens.css`,
  `${REPO}app/(frontend)/styles/base.css`,
  `${REPO}app/(frontend)/styles/ui.css`,
  `${REPO}app/(frontend)/styles/content.css`,
  `${REPO}app/(frontend)/styles/blocks/post-view.css`,
  `${REPO}app/(frontend)/styles/blocks/tudastar-lista.css`,
]

// Fix magasságú szélességsöprés: docs/ui-sztenderdek.md N-4/N-5, 1000 CSS px-es mérési nézet.
const MERESI_MAGASSAG_PX = 1000
const lapNezetablakra = (nezetablak: number) => stilusLapNezetablakra(LAPOK, nezetablak, MERESI_MAGASSAG_PX)

/** Osztály-gyökér elem a kaszkád-modellhez. */
const osztalyElem = (osztaly: string, ostag: string | null = null): Elem => ({
  elemnev: '',
  szulo: null,
  osztaly,
  ostagOsztaly: ostag,
})

/** Egy CSS-érték feloldva és pixelre váltva adott nézetablakon. */
function px(
  lap: readonly ReturnType<typeof szabalyok>[number][],
  ertek: string,
  nezetablak: number,
  szuloBetu = GYOKER_BETU,
): number {
  return hosszPx(varFeloldas(ertek, tokenek(lap)), nezetablak, szuloBetu, GYOKER_BETU)
}

describe('MÉRÉS — érintőcél, térköz, rács és sorhossz', () => {
  for (const nezetablak of [320, 1440]) {
    const lap = lapNezetablakra(nezetablak)

    it(`${nezetablak} px: a tartalomjegyzék linkjének érintőcélja ≥ 44 px`, () => {
      const link: Elem = {
        elemnev: 'a',
        szulo: osztalyElem('.kc-post-toc__list'),
        osztaly: null,
        ostagOsztaly: '.kc-post-toc__list',
      }
      const magassag = sajatErtek(lap, link, 'min-height')
      expect(magassag).not.toBeNull()
      // WCAG 2.2 2.5.8 (AA) 24 px-et kér; a repó a 2.5.5 (AAA) 44 px-es szintjén áll.
      expect(px(lap, magassag!, nezetablak)).toBeGreaterThanOrEqual(44)
    })

    it(`${nezetablak} px: a CTA-sáv és a kapcsolódó blokk közti táv ≤ 72 px`, () => {
      const alap = sajatErtek(lap, osztalyElem('.kc-section'), 'padding-block')
      const ctaVeg = sajatErtek(
        lap,
        osztalyElem('.kc-section.kc-post-cta--elotte-kapcsolodo'),
        'padding-block-end',
      )
      const kapcsolodoEleje = sajatErtek(
        lap,
        osztalyElem('.kc-section.kc-post-related'),
        'padding-block-start',
      )
      expect(ctaVeg).not.toBeNull()
      expect(kapcsolodoEleje).not.toBeNull()
      const tav = px(lap, ctaVeg!, nezetablak) + px(lap, kapcsolodoEleje!, nezetablak)
      expect(tav).toBeLessThanOrEqual(72)
      // A felülírás nélkül a táv a szekció-alapból jönne, és ÁTLÉPNÉ a küszöböt:
      // ez teszi a mérést értelmessé (nem a semmit méri).
      expect(2 * px(lap, alap!, nezetablak)).toBeGreaterThan(72)
    })
  }

  /**
   * JAVÍTVA 2026-08-21 — EZ AZ ŐR KORÁBBAN ROSSZ FIZIKÁT VÉDETT.
   *
   * A régi állítás az ALSÓ trackkel számolt (`2 × 416 + 24 = 856 ≤ 1072`), és
   * ezért zöld volt, miközben a lap böngészőben MINDEN szélességen egyhasábos
   * maradt. A CSS Grid Level 1 §7.2.3.1 (auto-repeat) szabálya ez:
   *
   *   „each track is treated as its max track sizing function if that is
   *    definite or else its min track sizing function if that is definite"
   *   (https://www.w3.org/TR/css-grid-1/#auto-repeat)
   *
   * tehát a HATÁROZOTT felső korlát (a régi 34rem = 544 px) dönt, és
   * `floor((1072 + 24) / (544 + 24)) = 1`. Az `1fr` NEM határozott, ezért a
   * mai szabálynál az alsó track (28rem = 448 px) számol.
   *
   * Ez a teszt most a SPEC szabályát modellezi, nem egy önkényesen választott
   * trackét, és a HASÁBSZÁMOT állítja — azt a mennyiséget, amit a böngésző is
   * kiszámol. Böngészős hitelesítés (Chromium 141, a repó valódi CSS-ével és
   * betűivel, hat valódi cikk-kivonattal), a mai szabállyal:
   *   592 px → 1 hasáb · 768 → 1 · 904 → 1 · 968 → 2 · 1024 → 2 · 1440 → 2 ·
   *   2560 → 2.
   */
  const hasabSzam = (
    lap: readonly ReturnType<typeof szabalyok>[number][],
    nezetablak: number,
    konteneri: number,
  ): number => {
    const sav = sajatErtek(lap, osztalyElem('.kc-card-grid.kc-card-grid--posts'), 'grid-template-columns')
    expect(sav).not.toBeNull()
    const hatarok = /minmax\(\s*min\(100%,\s*([^)]+)\)\s*,\s*([^)]+)\)/.exec(sav!)
    expect(hatarok).not.toBeNull()
    const alsoNyers = hatarok![1]!.trim()
    const felsoNyers = hatarok![2]!.trim()
    // A `fr` és a `%` NEM határozott hossz; minden más (rem/px/em) az.
    const hatarozott = (ertek: string): boolean => !/(^|\d)(fr|%)\s*$/.test(ertek)
    const trackPx = hatarozott(felsoNyers) ? px(lap, felsoNyers, nezetablak) : px(lap, alsoNyers, nezetablak)
    const res = px(lap, sajatErtek(lap, osztalyElem('.kc-card-grid'), 'gap')!, nezetablak)
    return Math.max(1, Math.floor((konteneri + res) / (trackPx + res)))
  }

  const tartalomHasab = (
    lap: readonly ReturnType<typeof szabalyok>[number][],
    nezetablak: number,
  ): number => {
    const gutter = px(lap, sajatErtek(lap, osztalyElem('.kc-container'), 'padding-inline')!, nezetablak)
    const max = px(lap, sajatErtek(lap, osztalyElem('.kc-container'), 'max-width')!, nezetablak)
    return Math.min(max, nezetablak) - 2 * gutter
  }

  for (const nezetablak of [320, 1440]) {
    const lap = lapNezetablakra(nezetablak)

    it(`${nezetablak} px: a kategória-címke LINKJE 44 px-es érintőcélt kap`, () => {
      // A `.kc-badge` érintetlen marad (máshol nem interaktív); a célfelület a
      // linké. Mérve a javítás előtt 28,8 px (320) és 32,4 px (1440) — a WCAG
      // 2.2 2.5.8 (AA, 24 px) fölött, a repó 44 px-es szabálya alatt.
      const link: Elem = {
        elemnev: 'a',
        szulo: osztalyElem('.kc-post-hero__categories'),
        osztaly: null,
        ostagOsztaly: '.kc-post-hero__categories',
      }
      const magassag = sajatErtek(lap, link, 'min-height')
      expect(magassag).not.toBeNull()
      expect(px(lap, magassag!, nezetablak)).toBeGreaterThanOrEqual(44)
    })

    it(`${nezetablak} px: a jegyzék doboza NEM szélesebb a szövegoszlopnál`, () => {
      // Mérve a korlát nélkül 1440 px-en 672 px a jegyzék és 544 px a
      // folyószöveg oszlopa: 23,5%-os túlnyúlás (a11y-mérés 3.6).
      const tocMax = sajatErtek(lap, osztalyElem('.kc-post-toc'), 'max-width')
      expect(tocMax).not.toBeNull()
      const szovegMax = sajatErtek(
        lap,
        { elemnev: 'p', szulo: osztalyElem('.kc-richtext'), osztaly: null, ostagOsztaly: '.kc-richtext' },
        'max-width',
      )
      expect(szovegMax).not.toBeNull()
      expect(px(lap, tocMax!, nezetablak)).toBeLessThanOrEqual(px(lap, szovegMax!, nezetablak))
    })

    it(`${nezetablak} px: a cikk törzsének bekezdésköze teljesíti a WCAG 1.4.8-at`, () => {
      const t = tokenek(lap)
      const betumeret = px(lap, 'var(--kc-font-m)', nezetablak)
      const sortav = Number(varFeloldas('var(--kc-leading-body)', t)) * betumeret
      // A cikk törzsének margója a post-view.css-ben él (`p + p`), amit a
      // kaszkád-modell kombinátor híján nem old fel: a VÁRT tokent a
      // szabályból olvassuk ki, a hosszát viszont a valódi lapról számoljuk.
      const cikkSzabaly = /\.kc-post-body \.kc-richtext p \+ p\s*\{[^}]*margin-top:\s*var\((--kc-space-\d)\)/.exec(
        cikkCssForras.replace(/\/\*[\s\S]*?\*\//g, ''),
      )
      expect(cikkSzabaly, 'a cikk törzsének bekezdés-margója eltűnt').not.toBeNull()
      const cikkMargo = px(lap, `var(${cikkSzabaly![1]!})`, nezetablak)

      const kuszob = 1.5 * sortav
      const koz = cikkMargo + sortav
      expect(koz).toBeGreaterThanOrEqual(kuszob)
      // A TARTALÉK a lényeg: a mérés előtt 1440 px-en 0,97 px volt, tehát a
      // következő sortáv-hangolás észrevétlenül átbillentette volna.
      expect(koz - kuszob).toBeGreaterThan(5)

      // ELLENPRÓBA a mérés értelmességére: a KÖZÖS margóval a tartalék
      // visszaesne a hajszálnyi értékre (1440 px-en 0,97 px).
      const kozosMargo = sajatErtek(
        lap,
        { elemnev: 'p', szulo: osztalyElem('.kc-richtext'), osztaly: null, ostagOsztaly: '.kc-richtext' },
        'margin',
      )
      expect(kozosMargo).not.toBeNull()
      const kozosPx = px(lap, elsoHossz(varFeloldas(kozosMargo!, t))!, nezetablak)
      expect(kozosPx + sortav - kuszob).toBeLessThan(3)
    })
  }

  it('a KÖZÖS .kc-richtext bekezdés-ritmusa NEM mozdult el', () => {
    // A `.kc-richtext` a kurzus-leírásokat és a jogi oldalakat is rendereli:
    // a cikk-törzsi javítás nem szivároghat át rájuk.
    const lap = lapNezetablakra(1440)
    const kozos = sajatErtek(
      lap,
      { elemnev: 'p', szulo: osztalyElem('.kc-richtext'), osztaly: null, ostagOsztaly: '.kc-richtext' },
      'margin',
    )
    expect(kozos).toBe('var(--kc-space-4) 0')
    // És a cikk-törzsi felülírás valóban a `.kc-post-body`-ra szűkít.
    const kodCsak = cikkCssForras.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(kodCsak).toContain('.kc-post-body .kc-richtext p + p')
    expect(kodCsak).not.toMatch(/(^|\})\s*\.kc-richtext p\s*\{/)
  })

  it('a poszt-rács a CSS Grid auto-repeat szabálya szerint KÉT hasábot ad 1440 px-en', () => {
    const lap = lapNezetablakra(1440)
    const konteneri = tartalomHasab(lap, 1440)
    expect(konteneri).toBe(1072)
    // A böngésző ugyanezt méri: `grid-template-columns: 524px 524px`.
    expect(hasabSzam(lap, 1440, konteneri)).toBe(2)
  })

  it('a poszt-rács 768 px-en EGY hasáb (a mérték nem esik szét)', () => {
    const lap = lapNezetablakra(768)
    expect(hasabSzam(lap, 768, tartalomHasab(lap, 768))).toBe(1)
  })

  it('a poszt-rács 2560 px-en sem ad harmadik hasábot', () => {
    const lap = lapNezetablakra(2560)
    expect(hasabSzam(lap, 2560, tartalomHasab(lap, 2560))).toBe(2)
  })

  const PAR_KONTENER = '.kc-container:has(> .kc-post-cta__panel + .kc-post-cta__panel)'

  const parHasabok = (nezetablak: number): string | null => {
    const lap = lapNezetablakra(nezetablak)
    return sajatErtek(lap, osztalyElem(PAR_KONTENER, '.kc-post-cta'), 'grid-template-columns')
  }

  it('a kurzus + időpont pár 320 és 899 px-en nem rács (mobil rakás)', () => {
    expect(parHasabok(320)).toBeNull()
    expect(parHasabok(899)).toBeNull()
  })

  it('a kurzus + időpont pár 900 és 1440 px-en két hasáb (asztali sor)', () => {
    expect(parHasabok(900)?.match(/1fr/g)?.length).toBe(2)
    expect(parHasabok(1440)?.match(/1fr/g)?.length).toBe(2)
  })

  it('a cikkoldal panel-szövegeinek sorhossza a WCAG 1.4.8 (AAA) 80 karakteres plafonja alatt marad', () => {
    const nunito = betuMetrika(
      [
        `${GYOKER_UT}public/fonts/nunito-sans-var-latin.woff2`,
        `${GYOKER_UT}public/fonts/nunito-sans-var-latin-ext.woff2`,
      ],
      400,
    )
    for (const nezetablak of [320, 390, 768, 1440, 1920]) {
      const lap = lapNezetablakra(nezetablak)
      const t = tokenek(lap)
      const betumeret = hosszPx(varFeloldas('var(--kc-font-m)', t), nezetablak, GYOKER_BETU, GYOKER_BETU)
      const gutter = hosszPx(varFeloldas('var(--kc-container-gutter)', t), nezetablak, GYOKER_BETU, GYOKER_BETU)
      const szukMax = hosszPx(varFeloldas('var(--kc-container-narrow)', t), nezetablak, GYOKER_BETU, GYOKER_BETU)
      // A panel belső térköze és a mérték-korlát a VALÓDI szabályokból jön,
      // nem beírt konstansból: ha bárki átírja őket, ez a mérés jelez.
      const kartyaBelso = hosszPx(
        varFeloldas(sajatErtek(lap, osztalyElem('.kc-card--padded'), 'padding')!, t),
        nezetablak,
        GYOKER_BETU,
        GYOKER_BETU,
      )
      const panelKorlat = hosszPx(
        varFeloldas(sajatErtek(lap, osztalyElem('.kc-post-cta__panel'), 'max-width')!, t),
        nezetablak,
        GYOKER_BETU,
        GYOKER_BETU,
      )
      const konteneri = Math.min(nezetablak, szukMax) - 2 * gutter
      const doboz = Math.min(konteneri, panelKorlat) - 2 * kartyaBelso - 2
      // Átlagos magyar karakterszélesség a VALÓDI metszetből, a saját
      // mikroszövegünkön mérve (nem angol mintán, nem becslésből).
      const minta = 'A cikkek a tájékozódáshoz szólnak. Ha vezetett, videós gyakorlást keresel otthonra.'
      const atlag = szoSzelessegPx(nunito, minta, betumeret) / [...minta].length
      const karakterPerSor = doboz / atlag
      expect(karakterPerSor, `${nezetablak} px: ${karakterPerSor.toFixed(1)} karakter/sor`).toBeLessThanOrEqual(80)
      expect(doboz, `${nezetablak} px: ${doboz} px doboz`).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// MÉRÉS — kontraszt (WCAG 2.2, 1.4.3 és 1.4.11), a tokens.css értékeiből
// ---------------------------------------------------------------------------

/** sRGB hex → relatív luminancia (WCAG 2.2, „relative luminance" definíció). */
function luminancia(hex: string): number {
  const szam = hex.replace('#', '')
  const csatornak = [szam.slice(0, 2), szam.slice(2, 4), szam.slice(4, 6)].map((resz) => {
    const c = parseInt(resz, 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * csatornak[0]! + 0.7152 * csatornak[1]! + 0.0722 * csatornak[2]!
}

/** Kontraszt-arány két színpárra (WCAG 2.2, „contrast ratio"). */
function kontraszt(elso: string, masodik: string): number {
  const a = luminancia(elso)
  const b = luminancia(masodik)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

describe('MÉRÉS — kontraszt: minden szövegpár AA felett', () => {
  const lap = lapNezetablakra(1440)
  const t = tokenek(lap)
  const szin = (nev: string): string => varFeloldas(`var(${nev})`, t).trim()

  const SZOVEG_PAROK: readonly [string, string, string][] = [
    ['tartalomjegyzék linkje a fehér dobozon', '--kc-color-link', '--kc-color-surface-raised'],
    ['tartalomjegyzék hover', '--kc-color-link-hover', '--kc-color-surface-raised'],
    ['jegyzék-cím, szerző neve fehéren', '--kc-color-text', '--kc-color-surface-raised'],
    ['végzettség, bio, dátum fehéren', '--kc-color-text-muted', '--kc-color-surface-raised'],
    ['cikk-hero címe a tint sávon', '--kc-color-text', '--kc-color-surface-tint'],
    ['byline és meta a tint sávon', '--kc-color-text-muted', '--kc-color-surface-tint'],
    ['elsődleges gomb felirata', '--kc-color-on-primary', '--kc-color-primary'],
    ['másodlagos gomb felirata a fehér panelen', '--kc-color-text', '--kc-color-surface-raised'],
  ]

  for (const [nev, elotet, hatter] of SZOVEG_PAROK) {
    it(`${nev}: ≥ 4,5:1`, () => {
      const arany = kontraszt(szin(elotet), szin(hatter))
      expect(arany, `${nev}: ${arany.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    })
  }

  it('nem-szöveges elem (másodlagos gomb kerete) ≥ 3:1', () => {
    const arany = kontraszt(szin('--kc-color-text'), szin('--kc-color-surface-raised'))
    expect(arany).toBeGreaterThanOrEqual(3)
  })

  it('fókuszgyűrű a három világos felületen ≥ 3:1', () => {
    for (const hatter of ['--kc-color-surface-raised', '--kc-color-bg', '--kc-color-surface-tint']) {
      const arany = kontraszt(szin('--kc-color-focus'), szin(hatter))
      expect(arany, `${hatter}: ${arany.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('MÉRÉS — 320 px reflow: a saját feliratok elférnek (WCAG 2.2 1.4.10)', () => {
  const lap = lapNezetablakra(320)
  const t = tokenek(lap)
  const NUNITO = [
    `${GYOKER_UT}public/fonts/nunito-sans-var-latin.woff2`,
    `${GYOKER_UT}public/fonts/nunito-sans-var-latin-ext.woff2`,
  ]
  const merEm = (ertek: string): number =>
    hosszPx(varFeloldas(ertek, t), 320, GYOKER_BETU, GYOKER_BETU)

  /** A szűk konténer tartalom-hasábja 320 px-en. */
  const konteneri = 320 - 2 * merEm('var(--kc-container-gutter)')
  /** A fehér panel belseje (kártya-padding és 1px keret levonva). */
  const panel = konteneri - 2 * merEm('var(--kc-space-5)') - 2

  it('a gombfeliratok leghosszabb szava befér a panel gombjába', () => {
    const felkover = betuMetrika(NUNITO, 700)
    const betumeret = merEm('var(--kc-font-m)')
    // A gomb belső vízszintes térköze 2 × --kc-space-5, kerete 2 × 2 px.
    const gombDoboz = panel - 2 * merEm('var(--kc-space-5)') - 4
    for (const felirat of [ctaLabel('course-list-open'), ctaLabel('course-sales-open')]) {
      for (const szo of felirat.split(' ')) {
        const szelesseg = szoSzelessegPx(felkover, szo, betumeret)
        expect(szelesseg, `„${szo}" ${szelesseg.toFixed(1)} px / ${gombDoboz} px`).toBeLessThanOrEqual(gombDoboz)
      }
    }
  })

  it('a panelek saját feliratainak leghosszabb szava befér a hasábba', () => {
    const normal = betuMetrika(NUNITO, 400)
    const felkover = betuMetrika(NUNITO, 700)
    const betumeret = merEm('var(--kc-font-m)')
    const cimkek: readonly [string, ReturnType<typeof betuMetrika>][] = [
      ['Ezen az oldalon', felkover],
      ['A cikket írta és ellenőrizte', felkover],
      ['Szakmailag ellenőrizte:', normal],
      ['Utoljára ellenőrizve:', normal],
      ['Következő ellenőrzés:', normal],
      ['Hogyan tovább?', felkover],
      [ctaLabel('about-open'), normal],
    ]
    for (const [cimke, metrika] of cimkek) {
      for (const szo of cimke.split(' ')) {
        const szelesseg = szoSzelessegPx(metrika, szo, betumeret)
        expect(szelesseg, `„${szo}" ${szelesseg.toFixed(1)} px / ${panel} px`).toBeLessThanOrEqual(panel)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// G9 — morzsamenü: konzisztens navigáció (WCAG 2.2 3.2.3)
// ---------------------------------------------------------------------------

describe('G9 — a cikkoldal morzsamenüje', () => {
  const html = render(
    createElement(PostArticle, {
      post: post({ author: SZERZO, content: HOSSZU_CIKK }),
    }),
  )

  it('a <main>-ből VAN visszaút a Tudástár gyűjtőoldalára', () => {
    // A séta mérése szerint korábban 24 linkből 0 mutatott a /blog-ra.
    expect(html).toMatch(/<a[^>]+href="\/blog"/)
  })

  it('a szerkezete a kurzusoldaléval AZONOS: nav + aria-label + ol + aria-current', () => {
    const morzsa = html.slice(html.indexOf('kc-post-breadcrumb'), html.indexOf('</nav>'))
    expect(html).toContain('aria-label="Morzsamenü"')
    expect(morzsa).toContain('<ol role="list">')
    // A gyűjtőoldal LINK, az aktuális lap NEM link, de aria-current="page".
    expect(morzsa).toMatch(/<a[^>]+href="\/blog"[^>]*>Tudástár<\/a>/)
    expect(morzsa).toContain('aria-current="page"')
    const aktualis = /aria-current="page"[^>]*>([^<]*)</.exec(morzsa)
    expect(aktualis?.[1]).toBe('Miért zsibbad a kezem?')
  })

  it('a látható morzsa és a BreadcrumbList strukturált adat ugyanazt mondja', () => {
    // A repó szabálya: a séma minden mezője a LÁTHATÓ tartalomból jön.
    expect(html).toContain('"@type":"BreadcrumbList"')
    expect(html).toContain('"name":"Tudástár"')
    expect(html).toContain('"name":"Miért zsibbad a kezem?"')
  })

  it('a stílusa a kurzusoldal morzsájával MEGEGYEZIK (3.2.3)', () => {
    // A két blokk ugyanazokat a deklarációkat viszi; ha az egyik elmozdul, ez
    // az őr jelez. (A cikkoldalé ezen felül 44 px-es érintőcélt ad a linknek —
    // lásd a post-view.css indoklását.)
    const kurzusCss = readFileSync(`${REPO}app/(frontend)/kurzusok/kurzusok.css`, 'utf8')
    const kodCsak = (forras: string): string => forras.replace(/\/\*[\s\S]*?\*\//g, '')
    const blokk = (forras: string, szelektor: string): string => {
      const minta = new RegExp(`${szelektor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)
      const talalat = minta.exec(kodCsak(forras))
      expect(talalat, `${szelektor} nincs meg`).not.toBeNull()
      return talalat![1]!
        .split(';')
        .map((sor) => sor.trim())
        .filter(Boolean)
        .sort()
        .join(';')
    }
    expect(blokk(cikkCssForras, '.kc-post-breadcrumb ol')).toBe(
      blokk(kurzusCss, '.kc-course-breadcrumb ol'),
    )
    expect(blokk(cikkCssForras, '.kc-post-breadcrumb li + li::before')).toBe(
      blokk(kurzusCss, '.kc-course-breadcrumb li + li::before'),
    )
  })

  it('a morzsa linkje 44 px-es érintőcélt kap', () => {
    const kodCsak = cikkCssForras.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(kodCsak).toMatch(/\.kc-post-breadcrumb a\s*\{[^}]*min-height:\s*2\.75rem;/)
  })
})

// ---------------------------------------------------------------------------
// G10 — a kapcsolódó blokk: Tudástár-rács + compact kártya
// ---------------------------------------------------------------------------

describe('G10 — a kapcsolódó cikkek blokkja', () => {
  const kapcsolodo = (id: number, cim: string) => ({
    id,
    title: cim,
    slug: `cikk-${id}`,
    status: 'published',
    publishedAt: '2026-07-14T09:00:00.000Z',
    excerpt: 'Ez a kivonat SOSEM jelenhet meg a kapcsolódó blokkban: a hármas rácsban a mért sorhossza 24–38 karakter/sor lenne.',
    categories: [{ id: 5, title: 'Kézrehabilitáció', slug: 'kezrehabilitacio' }],
    content: null,
  })
  const html = render(
    createElement(PostArticle, {
      post: post({ author: SZERZO, content: HOSSZU_CIKK }),
      related: [
        kapcsolodo(21, 'Kéztőalagút-szindróma: mit tehetsz otthon?'),
        kapcsolodo(22, 'Pattanó ujj: mi történik az ínhüvelyben?'),
        kapcsolodo(23, 'Teniszkönyök: miért fáj?'),
      ] as never,
    }),
  )
  const blokk = html.slice(html.indexOf('kc-post-related'))

  it('a Tudástár rács-módosítóján áll, nem a közös hármas rácson', () => {
    expect(blokk).toContain('kc-card-grid kc-card-grid--posts')
  })

  it('a kártyák `compact` változatúak: KIVONAT nincs a DOM-ban', () => {
    // Elrejteni kevés lenne: a képernyőolvasó és a keresőrobot a rejtett
    // kivonatot is végigolvasná (PostCard fejléce).
    expect(blokk).not.toContain('kc-post-card__excerpt')
    expect(blokk).not.toContain('SOSEM jelenhet meg')
  })

  it('a kártyák címe címsor marad (h3 a szekció h2-je alatt)', () => {
    expect(blokk).toContain('<h3 class="kc-post-card__title">')
    expect([...blokk.matchAll(/<h3 class="kc-post-card__title">/g)]).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// G11 — a tartalomjegyzék előnézete
// ---------------------------------------------------------------------------

describe('G11 — a jegyzék előnézete és kinyitható folytatása', () => {
  const sokSzakasz = lexical([
    ...Array.from({ length: 12 }, (_, i) => [
      heading('h2', `Szakasz ${i + 1}`),
      paragraph(words(80)),
    ]).flat(),
  ])
  const html = render(createElement(PostArticle, { post: post({ content: sokSzakasz }) }))
  const toc = html.slice(html.indexOf('class="kc-post-toc"'), html.indexOf('</nav>', html.indexOf('class="kc-post-toc"')))

  it('nyitás nélkül LEGFELJEBB hat tétel látszik', () => {
    const elonezet = toc.slice(0, toc.indexOf('kc-post-toc__tobbi'))
    expect([...elonezet.matchAll(/href="#/g)]).toHaveLength(6)
  })

  it('a többi tétel natív `details` mögött áll, megnevezett darabszámmal', () => {
    expect(toc).toContain('<details class="kc-post-toc__tobbi">')
    expect(toc).toContain('<summary class="kc-post-toc__nyito">')
    expect(text(toc)).toContain('További 6 szakasz')
    // Alapból ZÁRVA: `open` attribútum nincs.
    expect(toc).not.toContain('<details class="kc-post-toc__tobbi" open')
  })

  it('a számozás folytatólagos (a sorrend információ)', () => {
    expect(toc).toContain('start="7"')
  })

  it('egyetlen elmaradó tételért NEM nyit harmonikát', () => {
    const hetSzakasz = lexical([
      ...Array.from({ length: 7 }, (_, i) => [
        heading('h2', `Szakasz ${i + 1}`),
        paragraph(words(80)),
      ]).flat(),
    ])
    const rovid = render(createElement(PostArticle, { post: post({ content: hetSzakasz }) }))
    expect(rovid).not.toContain('kc-post-toc__tobbi')
    expect(tocHorgonyok(rovid)).toHaveLength(7)
  })

  it('a nyitó 44 px-es érintőcélt kap, és nem tartalmaz mozgást', () => {
    const kodCsak = cikkCssForras.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(kodCsak).toMatch(/\.kc-post-toc__nyito\s*\{[^}]*min-height:\s*2\.75rem;/)
  })
})
