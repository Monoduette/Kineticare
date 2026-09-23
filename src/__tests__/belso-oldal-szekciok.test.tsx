import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getPageBySlug } from '@/lib/cms'

import { pageBlockSlugs } from '../blocks'
import { validateAnchorId } from '../blocks/section-settings'
import { RenderBlocks } from '../components/blocks/RenderBlocks'
import { HOME_HELP_LEAD, HOME_HELP_STATES, HOME_HELP_TITLE } from '../lib/home-help-states'
import { buildHomeLayout, minimalRichText } from '../lib/home-seed'
import { CLINIC_TREATMENTS_ANCHOR } from '../lib/menu-seed'
import {
  buildKapcsolatLayout,
  buildRolunkLayout,
  buildSzolgaltatasokLayout,
  IDOPONTKERES_URL,
  ROLUNK_SZEMELYEK_SZEKCIO,
  tervezdGondolatjelCsereket,
  tervezdKapcsolatRovidBemutatkozast,
  tervezdOneletrajzKepeket,
  tervezdRolunkSzetvalasztast,
} from '../scripts/restore-legacy-content'
import type { Page } from '../payload-types'

/**
 * BELSŐ OLDALAK SZEKCIÓSORA — a P3-hiba őre és a blokkosítás szerződése.
 * A `Pages.layout` (Szekciók) blokk-mező 16 blokktípussal létezik, az admin
 * súgója „az oldal építőkockás részének" nevezi — a `[slug]` route viszont
 * SOHA nem rendereltte (docs/ux-belso-oldalak-kutatas.md, P3). A staff
 * összerakhatott egy szekciósort, elmenthette, és semmi nem jelent meg belőle:
 */

vi.mock('next/headers', () => ({
  draftMode: vi.fn(async () => ({ isEnabled: false })),
}))

// A route a Tudástár-kapcsolót is kérdezi; itt a bekapcsolt állapot a mérce
// (a kikapcsolt ágat a tudastar-link-szuro.test.tsx méri).
vi.mock('@/lib/tudastar-lathatosag', () => ({ getTudastarLathato: async () => true }))
// A kapcsolati e-mail feloldója (src/lib/contact-email-server.ts) itt a
// kódtartalékot adja: tesztből valódi Payload-indítás és adatbázis-hívás nem
// mehet ki (CLAUDE.md 15). Az eltérő CMS-címet a kapcsolati-email-feloldo.test.ts méri.
vi.mock('@/lib/contact-email-server', async () => {
  const { KAPCSOLATI_EMAIL_TARTALEK: tartalek } = await import('../lib/contact-email')
  return { getContactEmail: async () => tartalek }
})

vi.mock('@/lib/cms', () => ({
  getPageBySlug: vi.fn(),
  getPublishedProducts: vi.fn(async () => []),
  getLatestPosts: vi.fn(async () => []),
  getTestimonials: vi.fn(async () => []),
  // WP23: a szekciósor knowledge-kártyái a publikált CMS-oldal-slugokból
  // számolják a kanonikus gyökér-hub célt. Üres halmaz = a mai `/blog/…` cél.
  getPublishedPageSlugs: vi.fn(async () => new Set<string>()),
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
    // …a /rolunk Rólunk-blokkja a páros alak marad: a kezdőlapi fotó-fríz
    // (WP11, `kc-about--founders`) csak a filmsáv utáni első About-é.
    expect(markup).not.toContain('kc-photo-frieze')
    expect(markup).not.toContain('kc-about--founders')
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

  it('NEM veszíti el a rich-text változat kulcsadatait (nevek, partnerek, CV)', () => {
    const markup = renderLayout(layout)

    expect(markup).toContain('Kocsis Kata')
    expect(markup).toContain('Kiss Kata')
    expect(markup).toContain('Partnereink')
    expect(markup).toContain('Kocsis Kata szakmai önéletrajza')
    expect(markup).toContain('Kiss Kata szakmai önéletrajza')
    // A bizonyíték MENNYISÉGE a bizalmi jelzés — a CV-tételek nincsenek rövidítve
    // (a harmonika CSUKVA is a DOM-ban tartja őket, csak a böngésző rejti el).
    expect(markup).toContain('Svédmasszázs (2015) – OKTÁV Továbbképző Központ')
  })

  it('a szakember-bemutatkozás és a partnerek NEM kerülnek lenyitó mögé (GOV.UK-szabály)', () => {
    // A rövid bemutatkozás és a referencia-sor MINDIG LÁTHATÓ blokkban marad,
    // nem a harmonikában: a `teamMembers` blokk (portréval, névvel, titulussal)
    // és a partnerek sora egyike sem kerülhet `details` mögé.
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
    expect(nyitottSzoveg).toContain('Kocsis Kata')
    expect(nyitottSzoveg).toContain('Kiss Kata')
    expect(nyitottSzoveg).toContain('Partnereink')
    expect(nyitottSzoveg).not.toContain('<details')
  })

  /**
   * A SZEMÉLYEK SZEKCIÓJA (WP15, tulajdonosi kérés 2026-09-07: „Rólunk és
   * Kapcsolat menüpont is legyen jobban szeparálva tartalmi szempontból").
   *
   * A Rólunk a SZEMÉLYEKRŐL szól (NN/g About Us: emberek, hitelesség,
   * https://www.nngroup.com/articles/about-us-information-on-websites/), a
   * Kapcsolat a KAPCSOLATFELVÉTELRŐL (NN/g Contact Us: csatornák, válaszidő,
   * https://www.nngroup.com/articles/contact-us-pages/). Ezért a /rolunk
   * kártyáin nincs telefon-kártya és hívás-felirat; a részletes önéletrajzot
   * a kártya nem ismétli, hanem a lap alján álló harmonikára mutat.
   */
  it('a két szakember személyközpontú kártyát kap: portré-hely, bio, szakmai háttér, telefon NÉLKÜL', () => {
    const markup = renderLayout(buildRolunkLayout({ kocsisPortre: 21, kissPortre: 22 }))

    expect(markup).not.toContain('tel:')
    expect(markup).not.toContain('+36 30 169 2263')
    expect(markup).not.toContain('+36 20 357 3493')
    expect(markup).not.toContain('kc-team__call')
    expect(markup).not.toContain('kc-team__booking"')
    expect(markup).toContain('Akik a kezeddel foglalkoznak')
    expect(markup).toContain('Mi ketten')
    expect(markup).toContain('Kézsérülésekkel, műtét utáni állapotokkal és sportolói panaszokkal foglalkozik.')

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

  it('a személyek szekciója EGY szekció-szintű linkkel visz a /kapcsolat időpontkérőjére (§3.2 #24)', () => {
    const markup = renderLayout(buildRolunkLayout())
    expect(markup).toContain('Kérj időpontot üzenetben')
    expect(markup).toContain(`href="${IDOPONTKERES_URL}"`)
    // A kapcsolatfelvétel innen egyetlen úton megy: nincs kártyánkénti hívás.
    expect((markup.match(/class="kc-team__booking-link"/g) ?? []).length).toBe(1)
  })

  it('a szakember-szekció szövegei natív magyarok, gondolatjel nélkül', () => {
    const blokk = layout.find((block) => block.blockType === 'teamMembers')
    if (blokk?.blockType !== 'teamMembers') throw new Error('nincs szakember-szekció')
    expect(blokk.eyebrow).toBe(ROLUNK_SZEMELYEK_SZEKCIO.eyebrow)
    expect(blokk.title).toBe(ROLUNK_SZEMELYEK_SZEKCIO.title)
    expect(blokk.lead).toBe(ROLUNK_SZEMELYEK_SZEKCIO.lead)
    for (const szoveg of [blokk.eyebrow, blokk.title, blokk.lead]) {
      expect(szoveg).not.toMatch(/[–—]/)
    }
    // A cím a szekció tartalmát nevezi meg (WCAG 2.2 SC 2.4.6), nem a hívást.
    expect(blokk.title?.toLowerCase()).not.toContain('hív')
    expect(blokk.title?.toLowerCase()).not.toContain('elér')
  })

  /**
   * „ÍGY TUDUNK SEGÍTENI" A RÓLUNK LAPON (WP15; a tulajdonos 2026-09-07-i
   * kiegészítése: „A főoldalon lévő Így tudunk segíteni a követendő irány").
   * A három út címe, összefoglalója és CTA-ja a kezdőlappal EGY forrásból jön
   * (WCAG 2.2 SC 3.2.4 Consistent Identification; NN/g Consistency and
   * Standards, https://www.nngroup.com/articles/consistency-and-standards/).
   */
  it('a „Így tudunk segíteni" szekció a kezdőlapi sín kanonikus soraival épül', () => {
    const rolunkSin = layout.find((block) => block.blockType === 'services')
    if (rolunkSin?.blockType !== 'services') throw new Error('nincs szolgáltatás-szekció')
    const kezdolapSin = buildHomeLayout().find(
      (block) => block.blockType === 'services' && block.title === HOME_HELP_TITLE,
    )
    if (kezdolapSin?.blockType !== 'services') throw new Error('nincs kezdőlapi sín')

    expect(rolunkSin.elrendezes).toBe('sin')
    expect(rolunkSin.title).toBe(HOME_HELP_TITLE)
    expect(rolunkSin.lead).toBe(HOME_HELP_LEAD)
    expect(rolunkSin.sectionSettings?.anchorId).toBe('szolgaltatasaink')
    const kulcsok = (rows: NonNullable<typeof rolunkSin.rows>) =>
      rows.map((row) => [row.title, row.osszefoglalo, row.felirat, row.url, row.ujAblakban])
    expect(kulcsok(rolunkSin.rows ?? [])).toEqual(kulcsok(kezdolapSin.rows ?? []))
    expect(kulcsok(rolunkSin.rows ?? [])).toEqual(
      HOME_HELP_STATES.map((state) => [
        state.title,
        state.osszefoglalo,
        state.felirat,
        state.url,
        state.ujAblakban,
      ]),
    )
    // A sín ajtó-fotói a kezdőlapi képek id-i, ha megvannak; nélkülük is épül.
    const fotokkal = buildRolunkLayout({ sinFotok: [4, 5, 6] }).find(
      (block) => block.blockType === 'services',
    )
    expect(fotokkal?.blockType === 'services' ? fotokkal.rows?.map((r) => r.photo) : null).toEqual(
      [4, 5, 6],
    )
    expect(rolunkSin.rows?.map((row) => row.photo)).toEqual([undefined, undefined, undefined])
    // A kezdőlapi sín horgony nélkül áll: a két lapon nincs dupla azonosító.
    expect(kezdolapSin.sectionSettings?.anchorId ?? null).toBeNull()
    // Rendereléskor a sín-elrendezés fut, nem a tábla.
    const markup = renderLayout([rolunkSin])
    expect(markup).toContain('kc-services--sin')
    expect(markup).toContain('id="szolgaltatasaink"')
    expect(markup).not.toContain('kc-services__list')
  })

  it('egyetlen elsődleges CTA-gombot tartalmaz a sín panelein kívül, a fizetős kurzusra (B6.5)', () => {
    const markup = renderLayout(layout)
    // A sín három paneljének CTA-ja elsődleges gomb (mint a kezdőlapon), de a
    // rádiócsoport miatt egyszerre CSAK EGY panel látszik; a lap többi részén
    // egyetlen elsődleges gomb marad: a záró sáv.
    const sinNelkul = markup.replace(
      /<section[^>]*kc-services--sin[\s\S]*?<\/section>/,
      '',
    )
    expect((sinNelkul.match(/kc-button--primary/g) ?? []).length).toBe(1)
    expect(sinNelkul).toContain('Megnézem a kurzusokat')
    expect((markup.match(/kc-services-sin__cta/g) ?? []).length).toBeGreaterThan(0)
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
 * A két teljes szakmai önéletrajz korábban EGY szabad szöveges blokkban, folyó
 * szövegként állt: több képernyőnyi görgetés a lap alsó felében. Most az új
 * `accordion` blokk viszi, tételenként (szakemberenként) csukható sorban.
 * A SZERZŐDÉS, AMIT EZ A LEÍRÁS ŐRIZ:
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
    expect(cimek).toEqual(['Kocsis Kata szakmai önéletrajza', 'Kiss Kata szakmai önéletrajza'])
  })

  it('a sor elején a NÉVHEZ rendelt portré áll — ugyanaz, mint a szakember-kártyán (A05)', () => {
    const kepes = buildRolunkLayout({ kocsisPortre: 21, kissPortre: 22 })
    const harmonika = kepes.find((block) => block.blockType === 'accordion')
    const team = kepes.find((block) => block.blockType === 'teamMembers')
    if (harmonika?.blockType !== 'accordion' || team?.blockType !== 'teamMembers') {
      throw new Error('Hiányzik a harmonika vagy a szakember-blokk.')
    }
    expect((harmonika.items ?? []).map((item) => [item.cim, item.kep])).toEqual([
      ['Kocsis Kata szakmai önéletrajza', 21],
      ['Kiss Kata szakmai önéletrajza', 22],
    ])
    expect((team.members ?? []).map((member) => [member.name, member.photo])).toEqual([
      ['Kocsis Kata', 21],
      ['Kiss Kata', 22],
    ])
    // Kép nélküli futásban a sor kép nélkül épül, nem törik.
    if (accordionBlock?.blockType === 'accordion') {
      expect((accordionBlock.items ?? []).every((item) => item.kep === undefined)).toBe(true)
    }
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
    // ugyanaz maradt, a töltelék gondolatjel vesszőre cserélve
    // (`docs/ui-sztenderdek.md` §3.1.1).
    expect(layout[0].blockType).toBe('welcome')
    const markup = renderLayout(layout)

    expect(markup).toContain('Fáj a kezed, csuklód, könyököd vagy vállad?')
    expect(markup).toContain('Van megoldás, ha tudod, merre indulj')
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
    // WP58 (2026-09-19): a rendelői blokk a felismert árlista-szerkezetben
    // renderel (src/components/blocks/RendeloiArlista.tsx): az „Árlista"
    // cím és alcíme külön elem, a tétel időtartam + ár kártya, az ár ezres
    // csoportja nem törő szóközzel. A tartalom ugyanaz, a szerkezet más.
    const NBSP = String.fromCharCode(0xa0)
    expect(markup).toContain(
      'Árlista<span class="kc-arlista__panel-sub">gyógytorna / manuálterápia',
    )
    expect(markup).toContain(
      `<span class="kc-arlista__duration">50 perces alkalom</span><span class="kc-arlista__price">18${NBSP}000${NBSP}Ft</span>`,
    )
    expect(markup).toContain(
      `<span class="kc-arlista__duration">20 perces alkalom</span><span class="kc-arlista__price">10${NBSP}000${NBSP}Ft</span>`,
    )
    expect(markup).toContain('bármikor, a gyakorlatokat')
    expect(markup).not.toMatch(/[–—]/)
    expect(markup).toContain('Nádorliget u. 7/b')
    // A helyszín a tény-sor listaeleme: a mondatzáró pont a felismerésnél
    // lekerül róla (a GOV.UK summary list értékei sem pontozottak).
    // A cím kattintható: a látható szöveg maga a cím, a link a Google Térképet
    // nyitja új lapon, a rejtett toldat a képernyőolvasónak szól (src/lib/maps-href.ts).
    expect(markup).toContain(
      '<li class="kc-arlista__place"><a href="https://www.google.com/maps/search/?api=1&amp;query=1114%20Budapest%2C%20Fadrusz%20utca%2015" target="_blank" rel="noopener noreferrer">1114 Budapest, Fadrusz utca 15<span class="kc-visually-hidden"> (Google Térkép, új lapon nyílik)</span></a></li>',
    )
    expect(markup).toContain('SZTK-A-33553/2024')
    // A kiegészítő terápiák felsorolása is megmarad (nem csak a rövid sor-szöveg).
    expect(markup).toContain('Manuálterápia')
  })

  it('egyetlen elsődleges CTA-gomb: az időpontkérés MÁSODLAGOS gomb (B6.5, WP58)', () => {
    const markup = renderLayout(layout)

    expect((markup.match(/kc-button--primary/g) ?? []).length).toBe(1)
    expect(markup).toContain('Megnézem a kurzusokat')
    // WP58 (tulajdonosi kérés, 2026-09-19): a rendelői szekció szöveglinkje
    // gomb lett, de MÁSODLAGOS (§3.2 #24), hogy a lap egyetlen elsődleges
    // CTA-ja a záró sáv maradjon; a cél a seed időpontkérő horgonya.
    expect(markup).toContain(
      '<a class="kc-button kc-button--secondary" href="/kapcsolat#idopontkeres">Kérj időpontot üzenetben</a>',
    )
    expect(markup).not.toContain('időpontot kérek')
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

  it('nem a cikkoldali kc-post-cta mintát használja', () => {
    // A cikk-CTA (`.kc-post-cta` + két `.kc-post-cta__panel`) csak a
    // `/blog/{slug}` cikkeken él. A /szolgaltatasok CMS-szekciósor; ne kapjon
    // cikk-panelt, és ne örökölje a 900 px-es `:has` rácsot.
    const markup = renderLayout(layout)
    expect(markup).not.toContain('kc-post-cta')
  })
})

/**
 * MEGLÉVŐ /rolunk szekciósor célzott frissítése (három szűk kapu, a LOGOSAV
 * mintájára): a harmonika-sorok üres portré-mezőjének kitöltése
 * (LEGACY_ONELETRAJZ_KEP), a régi seed gondolatjeles mondatainak cseréje
 * (LEGACY_GONDOLATJEL) és a Rólunk/Kapcsolat tartalmi szétválasztása
 * (LEGACY_ROLUNK_KAPCSOLAT, WP15). Mindegyik tiszta függvény, pontos
 * egyezésre nyúl, a szerkesztő tartalmát nem írja felül.
 */
describe('/rolunk — meglévő szekciósor szűk kapui', () => {
  /** A 2026-09-07 ELŐTTI /rolunk szakember-szekció (telefon-kártyákkal). */
  function regiSzakemberSzekcio(): Extract<
    NonNullable<Page['layout']>[number],
    { blockType: 'teamMembers' }
  > {
    const uj = buildRolunkLayout({ kocsisPortre: 21, kissPortre: 22 }).find(
      (block) => block.blockType === 'teamMembers',
    )
    if (uj?.blockType !== 'teamMembers') throw new Error('nincs szakember-szekció')
    const telefonok: Record<string, [string, string]> = {
      'Kocsis Kata': ['+36 30 169 2263', 'Hívd Kocsis Katát'],
      'Kiss Kata': ['+36 20 357 3493', 'Hívd Kiss Katát'],
    }
    return structuredClone({
      ...uj,
      eyebrow: 'Elérhetőség',
      title: 'Így érsz el minket közvetlenül',
      lead: 'Hívj minket, ha időpontot kérnél, vagy ha kérdésed van a kezelésekről.',
      bookingLink: { felirat: 'Kérj időpontot üzenetben', url: '/kapcsolat', ujAblakban: false },
      members: (uj.members ?? []).map((tag) => ({
        ...tag,
        phone: telefonok[tag.name]?.[0] ?? '',
        callLabel: telefonok[tag.name]?.[1] ?? '',
        availability: 'A hívás során megbeszélitek, melyik rendelőbe érdemes jönnöd.',
      })),
    })
  }

  /** A 2026-09-07 ELŐTTI /rolunk „Miben segíthetünk?" tábla (vesszős sorcímekkel). */
  function regiSzolgaltatasTabla(): NonNullable<Page['layout']>[number] {
    return {
      blockType: 'services',
      eyebrow: 'Szolgáltatásaink',
      title: 'Miben segíthetünk?',
      rows: [
        {
          number: '01',
          title: 'Rendelői kezelések, személyesen',
          body: 'Akut sérülések, műtét utáni állapotok és krónikus fájdalmak esetén a mozgásterápia a gyógyulás alappillére. Gyógytornával, manuálterápiával és egy sor kiegészítő terápiával várunk.',
          felirat: 'Tovább a kezelésekre',
          url: '/szolgaltatasok',
          ujAblakban: false,
        },
        {
          number: '02',
          title: 'Otthoni program, online',
          body: 'Ha a kézfájdalom enyhítésére szeretnél egy bárhol, bármikor végezhető megoldást, akkor egy átfogó programmal is tudunk segíteni.',
          felirat: 'Tovább a kurzusokra',
          url: '/kurzusok',
          ujAblakban: false,
        },
        {
          number: '03',
          title: 'Szakmai képzések, kollégáknak',
          body: 'Akkreditált tantermi kézkurzus a kéz, a csukló- és könyökízület rehabilitációs lehetőségeiről gyógytornászoknak, erőnléti- és szakági edzőknek és orvosoknak.',
          felirat: 'Tovább a képzésre',
          url: 'https://probodystudio.hu/kez-workshop/',
          ujAblakban: true,
        },
      ],
      sectionSettings: { visible: true, anchorId: 'szolgaltatasaink', hatter: 'tint' },
    }
  }

  /**
   * A 2026-09-07 ELŐTTI seed alakja: a WP15 előtti szakember-szekció és
   * tábla, portré nélküli harmonika; `gondolatjel: true` esetén a
   * LEGACY_GONDOLATJEL előtti, gondolatjeles címekkel.
   */
  function regiSzekciosor(
    { gondolatjel }: { gondolatjel: boolean } = { gondolatjel: true },
  ): NonNullable<Page['layout']> {
    const layout = structuredClone(buildRolunkLayout({ kocsisPortre: 21, kissPortre: 22 })).map(
      (block) =>
        block.blockType === 'teamMembers'
          ? regiSzakemberSzekcio()
          : block.blockType === 'services'
            ? regiSzolgaltatasTabla()
            : block,
    )
    for (const block of layout) {
      if (block.blockType === 'accordion') {
        for (const item of block.items ?? []) delete item.kep
      }
      if (!gondolatjel) continue
      if (block.blockType === 'accordion') {
        block.lead =
          'A teljes szakmai életutunk — tanulmányok, továbbképzések, publikációk, előadások és médiamegjelenések. Nyisd ki, amelyik érdekel.'
        for (const item of block.items ?? []) {
          item.cim = item.cim.replace(' szakmai önéletrajza', ' — szakmai önéletrajz')
        }
      }
      if (block.blockType === 'about') {
        for (const stat of block.stats ?? []) {
          stat.label = stat.label.replace('kreditpont, akkreditált', 'kreditpont — akkreditált')
        }
      }
      if (block.blockType === 'services') {
        for (const row of block.rows ?? []) {
          row.title = row.title
            .replace('Rendelői kezelések, személyesen', 'Rendelői kezelések – személyesen')
            .replace('Otthoni program, online', 'Otthoni program – online')
            .replace('Szakmai képzések, kollégáknak', 'Szakmai képzések – kollégáknak')
        }
      }
      if (block.blockType === 'richText') {
        const first = block.content.root.children[0] as { children?: { text?: string }[] }
        const node = first.children?.[0]
        if (node?.text?.startsWith('És igazából neked is.')) {
          node.text = node.text.replace('És igazából neked is.', '– és igazából neked is.')
        }
      }
    }
    return layout
  }

  /** A harmonika-sorok portréja nélkül (a kapuk közül a portré-kapu tölti). */
  function kepNelkul(layout: NonNullable<Page['layout']>): NonNullable<Page['layout']> {
    return layout.map((block) =>
      block.blockType === 'accordion'
        ? {
            ...block,
            items: (block.items ?? []).map((item) => {
              const masolat = { ...item }
              delete masolat.kep
              return masolat
            }),
          }
        : block,
    )
  }

  it('a portré-kapu csak az üres kep mezőt tölti, név szerint, a régi és az új címmel is', () => {
    const regi = regiSzekciosor()
    const terv = tervezdOneletrajzKepeket(regi, { kocsisPortre: 21, kissPortre: 22 })
    expect(terv.layout).not.toBeNull()
    expect(terv.uzenet).toContain('Kocsis Kata, Kiss Kata')
    const harmonika = terv.layout?.find((block) => block.blockType === 'accordion')
    if (harmonika?.blockType !== 'accordion') throw new Error('nincs harmonika')
    expect((harmonika.items ?? []).map((item) => item.kep)).toEqual([21, 22])
    // A cím érintetlen marad (a szöveget a másik kapu viszi), a többi blokk azonos.
    expect((harmonika.items ?? []).map((item) => item.cim)).toEqual([
      'Kocsis Kata — szakmai önéletrajz',
      'Kiss Kata — szakmai önéletrajz',
    ])
    expect(terv.layout?.filter((block) => block.blockType !== 'accordion')).toEqual(
      regi.filter((block) => block.blockType !== 'accordion'),
    )
    // Az új címmel is felismeri; már kitöltött mezőt nem ír felül; másodszor nincs teendő.
    const uj = buildRolunkLayout({ kocsisPortre: 21, kissPortre: 22 })
    expect(tervezdOneletrajzKepeket(uj, { kocsisPortre: 31, kissPortre: 32 }).layout).toBeNull()
    const ujKepNelkul = buildRolunkLayout()
    const masodik = tervezdOneletrajzKepeket(ujKepNelkul, { kocsisPortre: 31, kissPortre: 32 })
    const blokk = masodik.layout?.find((block) => block.blockType === 'accordion')
    expect(blokk?.blockType === 'accordion' ? blokk.items?.map((i) => i.kep) : null).toEqual([31, 32])
    expect(tervezdOneletrajzKepeket(masodik.layout, { kocsisPortre: 31, kissPortre: 32 }).layout).toBeNull()
    // Portré nélkül és szekciósor nélkül nincs teendő.
    expect(tervezdOneletrajzKepeket(regi, {}).layout).toBeNull()
    expect(tervezdOneletrajzKepeket([], { kocsisPortre: 21 }).layout).toBeNull()
  })

  it('a portré-kapu a régi A05 saját, azonos képre mutató bevezető csomópontját leveszi, idegent nem', () => {
    const regi = regiSzekciosor()
    const harmonika = regi.find((block) => block.blockType === 'accordion')
    if (harmonika?.blockType !== 'accordion') throw new Error('nincs harmonika')
    const uploadNode = (value: number, id: string) => ({
      type: 'upload',
      version: 3,
      relationTo: 'media',
      value,
      fields: {},
      format: '',
      id,
    })
    const [kocsis, kiss] = harmonika.items ?? []
    const kocsisEredeti = [...kocsis.tartalom.root.children]
    const kissEredeti = [...kiss.tartalom.root.children]
    // Kocsis: a régi apply-owner-review-v1 csomópontja (saját előtag, azonos kép).
    kocsis.tartalom.root.children.unshift(uploadNode(21, 'owner-review-v1-x-kocsisPortrait'))
    // Kiss: a portré már be van állítva, a csomópont IDEGEN (szerkesztői kép, más id).
    kiss.kep = 22
    kiss.tartalom.root.children.unshift(uploadNode(99, 'szerkesztoi-kep'))
    const terv = tervezdOneletrajzKepeket(regi, { kocsisPortre: 21, kissPortre: 22 })
    expect(terv.uzenet).toContain('portré a harmonika-sor elejére: Kocsis Kata')
    expect(terv.uzenet).toContain('ismétlődő bevezető portré-csomópont levéve a tartalom tetejéről: Kocsis Kata')
    const uj = terv.layout?.find((block) => block.blockType === 'accordion')
    if (uj?.blockType !== 'accordion') throw new Error('nincs harmonika')
    const [ujKocsis, ujKiss] = uj.items ?? []
    expect(ujKocsis.kep).toBe(21)
    expect(ujKocsis.tartalom.root.children).toEqual(kocsisEredeti)
    expect(ujKiss.kep).toBe(22)
    expect(ujKiss.tartalom.root.children).toEqual([uploadNode(99, 'szerkesztoi-kep'), ...kissEredeti])
    // Másodszor nincs teendő: a saját csomópont már nincs, az idegen marad.
    expect(tervezdOneletrajzKepeket(terv.layout, { kocsisPortre: 21, kissPortre: 22 }).layout).toBeNull()
  })

  it('a gondolatjel-kapu a régi seed mondatait pontos egyezésre cseréli, az eredmény a vesszős alak', () => {
    const regi = regiSzekciosor()
    const regiMarkup = renderLayout(regi)
    expect(regiMarkup).toContain('kreditpont — akkreditált')
    expect(regiMarkup).toContain('Rendelői kezelések – személyesen')
    expect(regiMarkup).toContain('– és igazából neked is.')
    const terv = tervezdGondolatjelCsereket(regi)
    expect(terv.layout).not.toBeNull()
    // Az eredmény a gondolatjel nélküli régi alak (a WP15 előtti tábla és
    // szakember-szekció, kep nélkül); a többi blokk érintetlen. A WP15
    // szétválasztást a következő kapu viszi, nem ez.
    expect(terv.layout).toEqual(regiSzekciosor({ gondolatjel: false }))
    // Idempotens: a javított szekciósoron nincs teendő.
    expect(tervezdGondolatjelCsereket(terv.layout).layout).toBeNull()
    expect(tervezdGondolatjelCsereket(buildRolunkLayout()).layout).toBeNull()
  })

  /**
   * WP15 (2026-09-07): a Rólunk/Kapcsolat szétválasztás kapuja. A szakember-
   * szekció személyközpontú lesz, a tábla a kezdőlapi sínre vált; a blokkok,
   * sorok és tagok azonosítója, a szerkesztői portré és a 19a. javítás képe
   * megmarad; szerkesztett cím esetén nincs teendő; a kapu idempotens.
   */
  it('a szétválasztás-kapu a régi szakember-szekciót és táblát a mai seed alakjára cseréli, azonosítókkal', () => {
    const regi = regiSzekciosor({ gondolatjel: false })
    for (const block of regi) {
      if (block.blockType === 'teamMembers') {
        block.id = 'team-elo'
        for (const [index, tag] of (block.members ?? []).entries()) {
          tag.id = `tag-${index}`
          // A szerkesztő Kocsis Katának másik portrét állított be: az marad.
          if (tag.name === 'Kocsis Kata') tag.photo = 77
        }
      }
      if (block.blockType === 'services') {
        block.id = 'services-elo'
        block.image = 55
        for (const [index, row] of (block.rows ?? []).entries()) row.id = `sor-${index}`
      }
    }
    const terv = tervezdRolunkSzetvalasztast(regi, {
      kocsisPortre: 21,
      kissPortre: 22,
      sinFotok: [4, 5, 6],
    })
    expect(terv.layout).not.toBeNull()
    expect(terv.uzenet).toContain('személyközpontú')
    expect(terv.uzenet).toContain('Így tudunk segíteni')

    const elvart = kepNelkul(
      buildRolunkLayout({ kocsisPortre: 21, kissPortre: 22, sinFotok: [4, 5, 6] }),
    ).map((block) => {
      if (block.blockType === 'teamMembers') {
        return {
          ...block,
          id: 'team-elo',
          members: (block.members ?? []).map((tag, index) => ({
            ...tag,
            id: `tag-${index}`,
            photo: tag.name === 'Kocsis Kata' ? 77 : tag.photo,
          })),
        }
      }
      if (block.blockType === 'services') {
        return {
          ...block,
          id: 'services-elo',
          image: 55,
          rows: (block.rows ?? []).map((row, index) => ({ ...row, id: `sor-${index}` })),
        }
      }
      return block
    })
    expect(terv.layout).toEqual(elvart)

    // A régi kapu nélküli (gondolatjeles) tábla-sorcímeket is felismeri.
    expect(tervezdRolunkSzetvalasztast(regiSzekciosor(), {}).uzenet).toContain('Így tudunk segíteni')
    // Idempotens: a mai seeden és a cserélt szekciósoron nincs teendő.
    expect(tervezdRolunkSzetvalasztast(terv.layout, { sinFotok: [4, 5, 6] }).layout).toBeNull()
    expect(tervezdRolunkSzetvalasztast(buildRolunkLayout(), {}).layout).toBeNull()
    expect(tervezdRolunkSzetvalasztast([], {}).layout).toBeNull()
  })

  it('a szétválasztás-kapu szerkesztett (nem pontosan egyező) blokkhoz nem nyúl', () => {
    const regi = regiSzekciosor({ gondolatjel: false })
    for (const block of regi) {
      if (block.blockType === 'teamMembers') block.title = 'Így érsz el minket (szerkesztve)'
      if (block.blockType === 'services') {
        const [elso] = block.rows ?? []
        if (elso) elso.title = 'Rendelői kezelések, a stúdióban'
      }
    }
    expect(tervezdRolunkSzetvalasztast(regi, { kocsisPortre: 21 }).layout).toBeNull()
  })

  it('a kapcsolat-kapu a kártyák TELJES seed-bemutatkozását egy mondatra cseréli, mást nem', () => {
    const uj = buildKapcsolatLayout({ kocsisPortre: 31, kissPortre: 32 })
    const rolunkTagok = buildRolunkLayout().find((block) => block.blockType === 'teamMembers')
    if (rolunkTagok?.blockType !== 'teamMembers') throw new Error('nincs szakember-szekció')
    // A 2026-09-07 ELŐTTI /kapcsolat: a Rólunk teljes, kétmondatos bemutatkozásával.
    const regi = structuredClone(uj).map((block) =>
      block.blockType === 'teamMembers'
        ? {
            ...block,
            members: (block.members ?? []).map((tag) => ({
              ...tag,
              bio: (rolunkTagok.members ?? []).find((r) => r.name === tag.name)?.bio ?? tag.bio,
            })),
          }
        : block,
    )
    const terv = tervezdKapcsolatRovidBemutatkozast(regi)
    expect(terv.layout).toEqual(uj)
    expect(terv.uzenet).toContain('Kocsis Kata, Kiss Kata')
    // A rövid alak egy mondat, és a teljes alak első mondata (egy forrás).
    for (const block of uj) {
      if (block.blockType !== 'teamMembers') continue
      for (const tag of block.members ?? []) {
        const teljes = (rolunkTagok.members ?? []).find((r) => r.name === tag.name)?.bio ?? ''
        expect((tag.bio ?? '').match(/[.!?]/g)?.length).toBe(1)
        expect(teljes.startsWith(tag.bio ?? '')).toBe(true)
      }
    }
    // Idempotens; szerkesztett bemutatkozáshoz nem nyúl.
    expect(tervezdKapcsolatRovidBemutatkozast(uj).layout).toBeNull()
    const szerkesztett = structuredClone(regi)
    for (const block of szerkesztett) {
      if (block.blockType === 'teamMembers') {
        for (const tag of block.members ?? []) tag.bio = `${tag.bio} (szerkesztve)`
      }
    }
    expect(tervezdKapcsolatRovidBemutatkozast(szerkesztett).layout).toBeNull()
    expect(tervezdKapcsolatRovidBemutatkozast([]).layout).toBeNull()
  })

  it('a gondolatjel-kapu szerkesztett (nem pontosan egyező) szöveghez nem nyúl', () => {
    const regi = regiSzekciosor()
    for (const block of regi) {
      if (block.blockType === 'accordion') {
        block.lead = 'Saját bevezető — a szerkesztőtől.'
        for (const item of block.items ?? []) item.cim = `${item.cim} (frissítve)`
      }
      if (block.blockType === 'about') for (const stat of block.stats ?? []) stat.label += '!'
      if (block.blockType === 'services') for (const row of block.rows ?? []) row.title += '!'
      if (block.blockType === 'richText') {
        const first = block.content.root.children[0] as { children?: { text?: string }[] }
        const node = first.children?.[0]
        if (node?.text) node.text = `${node.text} (szerkesztve)`
      }
    }
    expect(tervezdGondolatjelCsereket(regi).layout).toBeNull()
  })
})
