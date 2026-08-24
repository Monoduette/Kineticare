import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getPageBySlug } from '@/lib/cms'

import { pageBlockSlugs } from '../blocks'
import { validateAnchorId } from '../blocks/section-settings'
import { RenderBlocks } from '../components/blocks/RenderBlocks'
import { minimalRichText } from '../lib/home-seed'
import { CLINIC_TREATMENTS_ANCHOR } from '../lib/menu-seed'
import { buildRolunkLayout, buildSzolgaltatasokLayout } from '../scripts/restore-legacy-content'
import type { Page } from '../payload-types'

/**
 * BELSŐ OLDALAK SZEKCIÓSORA — a P3-hiba őre és a blokkosítás szerződése.
 *
 * ═══ A HIBA, AMIT BEZÁR ═══
 * A `Pages.layout` (Szekciók) blokk-mező 16 blokktípussal létezik, az admin
 * súgója „az oldal építőkockás részének" nevezi — a `[slug]` route viszont
 * SOHA nem rendereltte (docs/ux-belso-oldalak-kutatas.md, P3). A staff
 * összerakhatott egy szekciósort, elmenthette, és semmi nem jelent meg belőle:
 * néma tartalomvesztés. Ez a teszt a javítás mindkét ágát rögzíti.
 *
 * ═══ A MÁSODIK SZERZŐDÉS ═══
 * A /rolunk és a /szolgaltatasok alap-szekciósorát a legacy-visszaépítő script
 * tölti fel EGYSZER (`buildRolunkLayout`, `buildSzolgaltatasokLayout`). Mivel a
 * route a szekciósort a rich-text HELYETT rendereli, a blokkosítás nem
 * veszíthet el tartalmat — a teszt a kritikus tényadatokat (telefonszámok,
 * árak, helyszínek, önéletrajzok) a RENDERELT kimeneten keresi.
 *
 * A tartalom egyébként a CMS-é: a feltöltés után minden szöveg, sorrend és
 * láthatóság az adminban szerkeszthető — a kód csak renderel.
 */

vi.mock('next/headers', () => ({
  draftMode: vi.fn(async () => ({ isEnabled: false })),
}))

vi.mock('@/lib/cms', () => ({
  getPageBySlug: vi.fn(),
  getPublishedProducts: vi.fn(async () => []),
  getLatestPosts: vi.fn(async () => []),
  getTestimonials: vi.fn(async () => []),
}))

const getPageBySlugMock = vi.mocked(getPageBySlug)

/** Csak a rich-text ágon jelenhet meg — a keresése így egyértelmű bizonyíték. */
const RICHTEXT_JELOLO = 'Ez a szabad szöveges oldaltartalom.'

function page(overrides: Partial<Page> = {}): Page {
  return {
    id: 1,
    title: 'A kéz a mindenünk',
    slug: 'rolunk',
    excerpt: 'Rövid bevezető.',
    content: minimalRichText(RICHTEXT_JELOLO),
    layout: null,
    heroImage: null,
    seoTitle: null,
    seoDescription: null,
    ogImage: null,
    status: 'published',
    publishedAt: null,
    order: null,
    updatedAt: '',
    createdAt: '',
    ...overrides,
  } as unknown as Page
}

async function renderCmsPage(doc: Page): Promise<string> {
  getPageBySlugMock.mockResolvedValue(doc)
  // A vi.mock-hoistelés miatt az oldalt dinamikusan importáljuk.
  const { default: CmsPage } = await import('../app/(frontend)/[slug]/page')
  const node = (await CmsPage({
    params: Promise.resolve({ slug: doc.slug ?? 'rolunk' }),
  })) as ReactNode
  return renderToStaticMarkup(createElement(Fragment, null, node))
}

function renderLayout(layout: NonNullable<Page['layout']>): string {
  return renderToStaticMarkup(
    createElement(RenderBlocks, { layout, posts: [], products: [], testimonials: [] }),
  )
}

/** Nyitó h1-tagek száma (a `<h1 ` és a `<h1>` alak is). */
function h1Count(markup: string): number {
  return (markup.match(/<h1[\s>]/g) ?? []).length
}

beforeEach(() => {
  getPageBySlugMock.mockReset()
})

describe('CMS-oldal renderelése (P3)', () => {
  it('szekciósor nélkül a rich-text tartalmat rendereli (mai viselkedés)', async () => {
    const markup = await renderCmsPage(page())

    expect(markup).toContain(RICHTEXT_JELOLO)
    expect(markup).toContain('kc-richtext')
    expect(markup).toContain('A kéz a mindenünk')
  })

  it('szekciósorral a BLOKKOKAT rendereli — a szekciók nem vesznek el némán', async () => {
    const markup = await renderCmsPage(page({ layout: buildRolunkLayout() }))

    // A blokkokból származó szekciók megjelennek…
    expect(markup).toContain('kc-about')
    expect(markup).toContain('kc-usps')
    expect(markup).toContain('kc-services')
    expect(markup).toContain('kc-cta-banner')
    // …a rich-text ág pedig NEM fut le (a kezdőlap mintája: vagy-vagy).
    expect(markup).not.toContain(RICHTEXT_JELOLO)
  })

  it('a hero címe marad az oldal EGYETLEN h1-e szekciósorral is', async () => {
    const uresLayout = await renderCmsPage(page())
    const blokkos = await renderCmsPage(page({ layout: buildRolunkLayout() }))

    expect(h1Count(uresLayout)).toBe(1)
    expect(h1Count(blokkos)).toBe(1)
  })

  it('film-hero blokk esetén a szöveges hero kimarad (a filmsáv adja a h1-et)', async () => {
    const markup = await renderCmsPage(
      page({
        excerpt: 'Ez a bevezető csak a szöveges heróban jelenne meg.',
        layout: [
          { blockType: 'filmHero', title: 'Filmes címsor', sectionSettings: { visible: true } },
        ],
      }),
    )

    expect(markup).not.toContain('kc-page-hero__title')
    expect(markup).not.toContain('Ez a bevezető csak a szöveges heróban jelenne meg.')
    expect(h1Count(markup)).toBe(1)
  })
})

describe('CMS-oldal E-E-A-T (szerző-blokk, GYIK, JSON-LD)', () => {
  const KISS_KATA = { id: 2, name: 'Kiss Kata', credentials: 'gyógytornász' }
  const KOCSIS_KATA = { id: 3, name: 'Kocsis Kata', credentials: 'gyógytornász' }

  function jsonLdBlocks(html: string): Record<string, unknown>[] {
    return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(
      (match) => JSON.parse(match[1]!.replace(/\\u003c/g, '<')) as Record<string, unknown>,
    )
  }

  it('üres author/faq mellett a lap a mai viselkedést adja (nincs blokk, nincs FAQPage)', async () => {
    const markup = await renderCmsPage(page())
    expect(markup).toContain(RICHTEXT_JELOLO)
    expect(markup).not.toContain('kc-post-author')
    expect(markup).not.toContain('kc-post-faq')
    expect(markup).not.toContain('"@type":"FAQPage"')
    expect(markup).not.toContain('"@type":"MedicalWebPage"')
    expect(markup).not.toContain('"@type":"Person"')
    expect(markup).not.toMatch(/<h[1-6][^>]*>\s*Források\s*<\/h[1-6]>/)
    expect(markup).not.toContain('id="forrasok"')
  })

  it('kitöltött szerző, lektor és GYIK megjelenik, Person + FAQPage + MedicalWebPage kimegy', async () => {
    const markup = await renderCmsPage(
      page({
        author: KISS_KATA,
        reviewedBy: KOCSIS_KATA,
        reviewedAt: '2026-08-18T00:00:00.000Z',
        faq: [{ question: 'Tesztkérdés a sémához?', answer: 'Tesztválasz, nem klinikai állítás.' }],
      } as unknown as Partial<Page>),
    )

    expect(markup).toContain('Az oldalt írta és ellenőrizte')
    expect(markup).toContain('Kiss Kata')
    expect(markup).toContain('Szakmailag ellenőrizte: Kocsis Kata, gyógytornász')
    expect(markup).toContain('Gyakori kérdések')
    expect(markup).toContain('Tesztkérdés a sémához?')
    expect(markup).toContain('Tesztválasz, nem klinikai állítás.')

    const blocks = jsonLdBlocks(markup)
    const pageSchema = blocks.find((block) => block['@type'] === 'MedicalWebPage')
    const faqSchema = blocks.find((block) => block['@type'] === 'FAQPage')
    expect(pageSchema, 'nincs MedicalWebPage a lapon').toBeDefined()
    expect(faqSchema, 'nincs FAQPage a lapon').toBeDefined()

    const author = pageSchema!.author as Record<string, unknown>
    const reviewer = pageSchema!.reviewedBy as Record<string, unknown>
    const publisher = pageSchema!.publisher as Record<string, unknown>
    expect(author['@type']).toBe('Person')
    expect(author.name).toBe('Kiss Kata')
    expect(reviewer['@type']).toBe('Person')
    expect(reviewer.name).toBe('Kocsis Kata')
    expect(publisher['@type']).toBe('Organization')
    expect(publisher.name).toBe('Kineticare')
    expect(author['@type']).not.toBe('Organization')
    expect(markup).not.toMatch(/<h[1-6][^>]*>\s*Források\s*<\/h[1-6]>/)
    expect('citation' in pageSchema!).toBe(false)
  })

  it('nyers author-id nem hamisít Person-t és nem rak Organization-t a szerző helyére', async () => {
    const markup = await renderCmsPage(page({ author: 2 } as unknown as Partial<Page>))
    expect(markup).not.toContain('kc-post-author')
    expect(markup).not.toContain('"@type":"Person"')
    expect(markup).not.toContain('"@type":"MedicalWebPage"')
  })
})

describe('/rolunk alap-szekciósora', () => {
  const layout = buildRolunkLayout()

  it('csak a katalógusban létező blokktípusokat használja', () => {
    for (const block of layout) {
      expect(pageBlockSlugs).toContain(block.blockType)
    }
  })

  it('érvényes horgony-azonosítókat ad (ékezet és # nélkül)', () => {
    for (const block of layout) {
      const anchor = block.sectionSettings?.anchorId
      if (anchor !== undefined && anchor !== null && anchor !== '') {
        expect(validateAnchorId(anchor)).toBe(true)
      }
    }
  })

  it('NEM veszíti el a rich-text változat kulcsadatait (telefonszám, partnerek, CV)', () => {
    const markup = renderLayout(layout)

    expect(markup).toContain('+36 30 169 2263')
    expect(markup).toContain('+36 20 357 3493')
    expect(markup).toContain('Partnereink')
    expect(markup).toContain('Kocsis Kata — szakmai önéletrajz')
    expect(markup).toContain('Kiss Kata — szakmai önéletrajz')
    // A bizonyíték MENNYISÉGE a bizalmi jelzés — a CV-tételek nincsenek rövidítve
    // (a harmonika CSUKVA is a DOM-ban tartja őket, csak a böngésző rejti el).
    expect(markup).toContain('Svédmasszázs (2015) – OKTÁV Továbbképző Központ')
  })

  it('a telefonszámok és a partnerek NEM kerülnek lenyitó mögé (GOV.UK-szabály)', () => {
    // A kapcsolatfelvételi adat és a referencia-sor rövid: MINDIG LÁTHATÓ
    // blokkban kell maradnia, nem a harmonikában. A telefonszámokat 2026-08-16
    // óta a `teamMembers` blokk viszi (portréval és kattintható `tel:`
    // hivatkozással), a partnerek sora maradt szabad szövegben — a lényeg
    // változatlan: egyik sem kerülhet `details` mögé.
    const nyitott = layout.filter(
      (block) => block.blockType === 'richText' || block.blockType === 'teamMembers',
    )
    const nyitottSzoveg = renderToStaticMarkup(
      createElement(RenderBlocks, {
        layout: nyitott,
        posts: [],
        products: [],
        testimonials: [],
      }),
    )
    expect(nyitottSzoveg).toContain('+36 30 169 2263')
    expect(nyitottSzoveg).toContain('+36 20 357 3493')
    expect(nyitottSzoveg).toContain('Partnereink')
    expect(nyitottSzoveg).not.toContain('<details')
  })

  /**
   * BEJELENTKEZÉS A SZAKEMBEREKHEZ (tulajdonosi kérés, 2026-08-16).
   *
   * A /rolunk oldalon a két telefonszám korábban folyó szövegben állt („… –
   * telefon: +36 30 169 2263"): mobilon kézzel kellett átírni, és nem volt
   * mellette arc. A `teamMembers` blokk mindkettőt megadja, a részletes
   * önéletrajzot pedig NEM ismétli meg, hanem a lap alján álló harmonikára
   * mutat (#szakmai-hatter) — így a tartalom egy helyen él.
   */
  it('a két szakember kattintható `tel:` hivatkozást és portré-helyet kap', () => {
    const markup = renderLayout(buildRolunkLayout({ kocsisPortre: 21, kissPortre: 22 }))

    expect(markup).toContain('href="tel:+36301692263"')
    expect(markup).toContain('href="tel:+36203573493"')
    expect(markup).toContain('Hívd Kocsis Katát')
    expect(markup).toContain('Hívd Kiss Katát')
    expect((markup.match(/class="kc-team__call"/g) ?? []).length).toBe(2)

    // A portré-hivatkozás adat-szinten ellenőrizhető: a renderelő a Media
    // OBJEKTUMOT várja (mélység-feloldás után), a szekciósor viszont az id-t
    // tárolja — a kettő közti kapcsolatot a Payload adja, nem ez a teszt.
    const teamBlock = buildRolunkLayout({ kocsisPortre: 21, kissPortre: 22 }).find(
      (block) => block.blockType === 'teamMembers',
    )
    if (teamBlock?.blockType !== 'teamMembers') {
      throw new Error('A szakember-szekció hiányzik a /rolunk szekciósorból.')
    }
    expect((teamBlock.members ?? []).map((tag) => tag.photo)).toEqual([21, 22])
    // Kép nélkül is épkézláb marad a szekció (a seed kép nélkül is lefut).
    const kepNelkul = buildRolunkLayout().find((block) => block.blockType === 'teamMembers')
    if (kepNelkul?.blockType !== 'teamMembers') {
      throw new Error('A szakember-szekció kép nélkül eltűnt a szekciósorból.')
    }
    expect((kepNelkul.members ?? []).map((tag) => tag.photo)).toEqual([undefined, undefined])
  })

  it('a szakember-kártya a MEGLÉVŐ önéletrajz-harmonikára mutat, nem ismétli meg', () => {
    const teamBlock = buildRolunkLayout().find((block) => block.blockType === 'teamMembers')
    expect(teamBlock).toBeDefined()
    if (teamBlock?.blockType !== 'teamMembers') {
      throw new Error('A szakember-szekció hiányzik a /rolunk szekciósorból.')
    }
    for (const member of teamBlock.members ?? []) {
      expect(member.link?.url).toBe('#szakmai-hatter')
      // A kártyán NINCS saját CV-lista: az a harmonika dolga (egy tartalom,
      // egy hely — az IA-leltár 6.4 D3 „két felület, egy funkció" hibája ellen).
      expect(member.cvSections ?? []).toEqual([])
    }
    // A horgony célja tényleg létezik a lapon.
    const anchors = buildRolunkLayout().map((block) => block.sectionSettings?.anchorId)
    expect(anchors).toContain('szakmai-hatter')
  })

  it('a titulus a szakmai önéletrajzból jön — nem csúszhat el oldalanként', () => {
    const rolunk = buildRolunkLayout().find((block) => block.blockType === 'teamMembers')
    const szolgaltatasok = buildSzolgaltatasokLayout().find(
      (block) => block.blockType === 'teamMembers',
    )
    if (rolunk?.blockType !== 'teamMembers' || szolgaltatasok?.blockType !== 'teamMembers') {
      throw new Error('A szakember-szekció hiányzik valamelyik szekciósorból.')
    }
    const titulusok = (blokk: typeof rolunk) => (blokk.members ?? []).map((tag) => tag.role)
    expect(titulusok(rolunk)).toEqual(titulusok(szolgaltatasok))
    for (const titulus of titulusok(rolunk)) {
      expect((titulus ?? '').trim().length).toBeGreaterThan(0)
    }
  })

  it('a szekció írásos időpontkérési utat is kínál a /kapcsolat oldalra', () => {
    const markup = renderLayout(buildRolunkLayout())
    expect(markup).toContain('Kérj időpontot üzenetben')
    expect(markup).toContain('href="/kapcsolat"')
  })

  it('egyetlen elsődleges CTA-gombot tartalmaz, a fizetős kurzusra (B6.5)', () => {
    const markup = renderLayout(layout)

    expect((markup.match(/kc-button--primary/g) ?? []).length).toBe(1)
    expect(markup).toContain('Megnézem a kurzusokat')
  })

  it('nem visz saját h1-et (a lap h1-e a hero címe marad)', () => {
    expect(h1Count(renderLayout(layout))).toBe(0)
  })

  it('sajtó-logósor csak akkor kerül be, ha van feltöltött logó', () => {
    expect(layout.some((block) => block.blockType === 'pressLogos')).toBe(false)
    const logokkal = buildRolunkLayout({ sajtoLogok: [11, 12] })
    expect(logokkal.some((block) => block.blockType === 'pressLogos')).toBe(true)
  })
})

/**
 * RÉSZLETES SZAKMAI HÁTTÉR — harmonikában (tulajdonosi kérés, 2026-08-16).
 *
 * ═══ MI VÁLTOZOTT ═══
 * A két teljes szakmai önéletrajz korábban EGY szabad szöveges blokkban, folyó
 * szövegként állt: több képernyőnyi görgetés a lap alsó felében. Most az új
 * `accordion` blokk viszi, tételenként (szakemberenként) csukható sorban.
 *
 * A SZERZŐDÉS, AMIT EZ A LEÍRÁS ŐRIZ:
 *  - a tartalom nem vész el (a CV-tételek a DOM-ban maradnak),
 *  - a fejléc DARABSZÁMA a TÉNYLEGES tartalomból számolódik (nem kézzel beírt
 *    szám, ami elcsúszhatna a listától — a teamMembers CV-harmonikájának
 *    mintája),
 *  - a rövid, kapcsolatfelvételi tartalom NEM kerül lenyitó mögé.
 */
describe('/rolunk — a részletes szakmai háttér harmonikája', () => {
  const layout = buildRolunkLayout()
  const accordionBlock = layout.find((block) => block.blockType === 'accordion')

  /** Egy lexical richText tömbben: az adott h3 címsort KÖVETŐ lista tételszáma. */
  function listaTetelszam(tartalom: unknown, listaCim: string): number {
    const children = (tartalom as { root?: { children?: unknown[] } } | null)?.root?.children ?? []
    const cimIndex = children.findIndex((node) => {
      const tipus = (node as { type?: string }).type
      const szoveg = ((node as { children?: { text?: string }[] }).children ?? [])
        .map((child) => child.text ?? '')
        .join('')
      return tipus === 'heading' && szoveg === listaCim
    })
    if (cimIndex === -1) {
      throw new Error(`Nincs ilyen lista az önéletrajzban: ${listaCim}`)
    }
    const lista = children[cimIndex + 1] as { type?: string; children?: unknown[] }
    expect(lista.type, `a(z) „${listaCim}" címsort nem lista követi`).toBe('list')
    return (lista.children ?? []).length
  }

  it('a szekciósorban ott van az accordion blokk, a „szakmai-hatter" horgonnyal', () => {
    expect(accordionBlock, 'nincs accordion blokk a /rolunk szekciósorában').toBeDefined()
    expect(accordionBlock?.sectionSettings?.anchorId).toBe('szakmai-hatter')
    // Az új blokktípus a katalógus része (különben az adminban sem lenne).
    expect(pageBlockSlugs).toContain('accordion')
  })

  it('szakemberenként egy nyitható sor, beszélő címmel', () => {
    if (accordionBlock?.blockType !== 'accordion') {
      throw new Error('A harmonika-blokk hiányzik a szekciósorból.')
    }
    const cimek = (accordionBlock.items ?? []).map((item) => item.cim)
    expect(cimek).toEqual(['Kocsis Kata — szakmai önéletrajz', 'Kiss Kata — szakmai önéletrajz'])
  })

  it('a fejléc darabszáma a TARTALOMBÓL számolódik, nem kézzel beírt szám', () => {
    if (accordionBlock?.blockType !== 'accordion') {
      throw new Error('A harmonika-blokk hiányzik a szekciósorból.')
    }
    const [kocsis, kiss] = accordionBlock.items ?? []

    // A számot a tényleges listákból vezetjük le — ha valaki bővíti a CV-t, a
    // kivonatnak vele kell nőnie (kézzel beírt számnál ez elcsúszna).
    const kocsisTanfolyam = listaTetelszam(
      kocsis.tartalom,
      'Tanfolyamok, továbbképzések, konferenciák',
    )
    const kocsisKonferencia = listaTetelszam(kocsis.tartalom, 'Konferenciák, előadások')
    const kocsisMedia = listaTetelszam(kocsis.tartalom, 'Média-megjelenések')
    expect(kocsisTanfolyam).toBeGreaterThan(10)
    expect(kocsis.osszefoglalo).toContain(`${kocsisTanfolyam} tanfolyam`)
    expect(kocsis.osszefoglalo).toContain(`${kocsisKonferencia} konferencia`)
    expect(kocsis.osszefoglalo).toContain(`${kocsisMedia} médiamegjelenés`)

    const kissTanfolyam = listaTetelszam(kiss.tartalom, 'Tanfolyamok, továbbképzések, konferenciák')
    const kissKonferencia = listaTetelszam(kiss.tartalom, 'Konferenciák, előadások')
    expect(kiss.osszefoglalo).toBe(`${kissTanfolyam} tanfolyam · ${kissKonferencia} konferencia`)
  })

  it('natív details/summary-vel renderelődik, alapból ZÁRVA', () => {
    const markup = renderLayout(layout)

    expect(markup).toContain('<details class="kc-accordion__item">')
    expect(markup).toContain('<summary class="kc-accordion__summary">')
    // Nyitott állapotot egyik sor sem visz — a látogató nyitja ki.
    expect(markup).not.toContain('<details class="kc-accordion__item" open')
    // A harmonika NEM ad ki FAQPage strukturált adatot (egy CV nem GYIK).
    expect(markup).not.toContain('FAQPage')
  })
})

describe('/szolgaltatasok alap-szekciósora', () => {
  const layout = buildSzolgaltatasokLayout()

  it('csak a katalógusban létező blokktípusokat használja', () => {
    for (const block of layout) {
      expect(pageBlockSlugs).toContain(block.blockType)
    }
  })

  it('a lap teteje ÜDVÖZLŐ blokk, a régi bevezető szövegével (redesign, 2026-08-16)', () => {
    // A folyó szöveges bevezető helyére tagolt üdvözlő blokk került; a SZÖVEG
    // betűhíven ugyanaz maradt — a renderelt kimeneten keresve.
    expect(layout[0].blockType).toBe('welcome')
    const markup = renderLayout(layout)

    expect(markup).toContain('Fáj a kezed, csuklód, könyököd vagy vállad?')
    expect(markup).toContain('Van megoldás – ha tudod, merre indulj')
    expect(markup).toContain('a test egy csodálatos „szerkezet”')
    expect(markup).toContain('akár a műtét is elkerülhető')
    expect(markup).toContain('mennyire tud hátráltatni a munkában vagy a sportban')
    expect(markup).toContain('a hosszú távú regenerációban')
  })

  it('a három szolgáltatási ág EGY szekcióban, azonos mezőrenddel áll (5.3, B4.1)', () => {
    const services = layout.find((block) => block.blockType === 'services')
    expect(services).toBeDefined()
    if (services?.blockType !== 'services') {
      throw new Error('A szolgáltatás-szekció hiányzik a szekciósorból.')
    }
    expect(services.rows).toHaveLength(3)
    for (const row of services.rows ?? []) {
      expect(row.title.trim().length).toBeGreaterThan(0)
      expect((row.body ?? '').trim().length).toBeGreaterThan(0)
      expect((row.felirat ?? '').trim().length).toBeGreaterThan(0)
      expect((row.url ?? '').trim().length).toBeGreaterThan(0)
    }
  })

  it('megőrzi az árakat, a helyszíneket és az akkreditációs adatot', () => {
    const markup = renderLayout(layout)

    expect(markup).toContain('18 000 Ft')
    expect(markup).toContain('10 000 Ft')
    expect(markup).toContain('Nádorliget u. 7/b')
    expect(markup).toContain('Fadrusz utca 15.')
    expect(markup).toContain('SZTK-A-33553/2024')
    // A kiegészítő terápiák felsorolása is megmarad (nem csak a rövid sor-szöveg).
    expect(markup).toContain('Manuálterápia')
  })

  it('egyetlen elsődleges CTA-gomb: az időpontkérés szöveglink marad (B6.5)', () => {
    const markup = renderLayout(layout)

    expect((markup.match(/kc-button--primary/g) ?? []).length).toBe(1)
    expect(markup).toContain('Megnézem a kurzusokat')
    expect(markup).toContain('időpontot kérek')
  })

  /**
   * BEJELENTKEZÉS A SZAKEMBEREKHEZ — a /szolgaltatasok ELSŐDLEGES helye.
   *
   * MIÉRT ITT (docs/informacios-architektura.md): a 2.1 leltár szerint ez a lap
   * a rendelői kezeléseké, tehát itt dől el a személyes bejelentkezés; az 5.
   * fejezet élő mérése szerint viszont a `<main>`-ben eddig egyetlen név, arc
   * és telefonszám sem volt, csak egy általános „Kapcsolat" szöveglink.
   *
   * A szekció NEM másolja sem a /rolunk önéletrajz-harmonikáját (oda LINKEL),
   * sem a /kapcsolat űrlapját (oda LINKEL) — az IA-leltár 6.4 pontja épp az
   * ilyen többszörözést („Extreme Polyhierarchy") méri hibaként.
   */
  it('a rendelői régió a szakemberek bejelentkezés-szekciójával zárul', () => {
    const indexek = layout.map((block, index) => ({ block, index }))
    // A horgony a MEGOSZTOTT konstansból jön, nem literálból: a fejléc-menü
    // ugyanezt hivatkozza, és a szekció korábban épp azért nem nyílt meg, mert
    // a kettő elcsúszott. Literállal ez a teszt a következő átnevezésnél némán
    // rossz blokkot keresne.
    const arlista = indexek.find(
      ({ block }) => block.sectionSettings?.anchorId === CLINIC_TREATMENTS_ANCHOR,
    )
    const szakemberek = indexek.find(({ block }) => block.blockType === 'teamMembers')
    expect(arlista, 'nincs rendelői kezelések blokk').toBeDefined()
    expect(szakemberek, 'nincs szakember-szekció').toBeDefined()
    // Közvetlenül az árlista UTÁN áll: „mit kapsz, mennyiért, kitől".
    expect(szakemberek?.index).toBe((arlista?.index ?? -1) + 1)
    // Azonos háttérsáv = közös régió (B2.2); a sávváltás a régióhatárt jelöli.
    // (A `hatter` a film-hero szekció-beállításain nem létezik, ezért a
    // unióból tulajdonság-jelenléttel olvassuk ki.)
    const hatter = (block: (typeof layout)[number]): string | undefined => {
      const settings = block.sectionSettings
      return settings !== undefined && settings !== null && 'hatter' in settings
        ? (settings.hatter ?? undefined)
        : undefined
    }
    expect(szakemberek && hatter(szakemberek.block)).toBe(arlista && hatter(arlista.block))
    expect(szakemberek && hatter(szakemberek.block)).toBe('feher')
    expect(szakemberek?.block.sectionSettings?.anchorId).toBe('szakembereink')
  })

  it('a kártya a /rolunk önéletrajzára mutat, nem másolja ide a CV-t', () => {
    const szakemberek = layout.find((block) => block.blockType === 'teamMembers')
    if (szakemberek?.blockType !== 'teamMembers') {
      throw new Error('A szakember-szekció hiányzik a /szolgaltatasok szekciósorból.')
    }
    for (const tag of szakemberek.members ?? []) {
      expect(tag.link?.url).toBe('/rolunk#szakmai-hatter')
      expect(tag.cvSections ?? []).toEqual([])
    }
    const markup = renderLayout(layout)
    expect(markup).toContain('href="tel:+36301692263"')
    expect(markup).toContain('href="tel:+36203573493"')
    // Az önéletrajz tételei NEM kerülnek át (az a /rolunk harmonikájáé).
    expect(markup).not.toContain('Svédmasszázs (2015)')
  })

  it('a bejelentkezés-szekció nem hoz be új elsődleges gombot (B6.5)', () => {
    // A hívás LINK, felület-szerű súllyal; a tömör `primary` kitöltés a lap
    // egyetlen vásárlási CTA-jáé marad.
    const markup = renderLayout(layout)
    expect((markup.match(/kc-button--primary/g) ?? []).length).toBe(1)
    expect((markup.match(/class="kc-team__call"/g) ?? []).length).toBe(2)
  })

  it('nem visz saját h1-et (a lap h1-e a hero címe marad)', () => {
    expect(h1Count(renderLayout(layout))).toBe(0)
  })
})
