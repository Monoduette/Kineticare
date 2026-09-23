import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Field } from 'payload'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { pageBlocks } from '../blocks'
import { SectionRowLabelView } from '../components/admin/SectionRowLabel'
import {
  CLOSED_HAND_HOME_HELP_TITLES,
  HOME_HELP_TITLE,
  LEGACY_HOME_HELP_TITLES,
  LEGACY_HOME_HELP_URLS,
} from '../lib/home-help-states'
import {
  BEEPITETT_CIM,
  BUILT_IN_TITLE_TYPES,
  CMS_KOTOTT_UGROPONTOK,
  cmsKotottUgropont,
  describeSection,
  describeSectionOnPage,
  KOTOTT_UGROPONTOK,
  kotottUgropont,
  NINCS_CIME,
  sectionNoticeModel,
  sectionPageMarks,
  sectionPageTitle,
  sectionRowLabelText,
  sectionSource,
  sectionTitle,
  servicesTenylegesElrendezes,
  VELEMENYEK_HOL_LATSZIK,
  type SectionDescription,
} from '../lib/section-row-label'
import type { Page } from '../payload-types'
import { sinElrendezesKitoltese } from '../scripts/sin-elrendezes-kitoltes'

/**
 * A sorcímke oldalfüggő jelei és a kódbeli címtartalékok őre (modul-térkép
 * H01 maradék, H03 maradék, H48/3, H48/4, H30 és H43/5).
 *
 * A fixture az élő szekciósor (fixtures/elo-szekciosorok-2026-09-22.json, a
 * section-row-label.test.ts és a szerkeszto-szalag.test.tsx közös forrása).
 * Hálózati hívás nincs: minden bemenet helyi adat vagy forrásfájl.
 */

// A SectionRowLabelView hook nélküli nézet; a Payload UI-csomagja Node-ban
// nem tölthető be (CSS-importok), ezért üres mockot kap.
vi.mock('@payloadcms/ui', () => ({}))

const SRC = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const forras = (utvonal: string): string => readFileSync(join(SRC, utvonal), 'utf8')

interface EloLap {
  id: number
  slug: string
  layout: NonNullable<Page['layout']>
}

const ELO: Readonly<Record<string, EloLap>> = JSON.parse(
  forras('__tests__/fixtures/elo-szekciosorok-2026-09-22.json'),
) as Record<string, EloLap>

const lap = (slug: string): EloLap => {
  const talalt = ELO[slug]
  if (!talalt) {
    throw new Error(`Hiányzó élő lap a fixture-ben: ${slug}`)
  }
  return talalt
}

/**
 * A lap szekciósora a sín-elrendezés előtöltése UTÁN (A3, H15). A mezőt
 * tisztelő kód csak ugyanabban a deployban élesedik, mint a
 * src/scripts/sin-elrendezes-kitoltes.ts szabály éles futtatása, ezért a
 * lapon látszó állapotot az előtöltött szekciósor adja; a nyers fixture a
 * szabály előtti mezőértékeket viseli.
 */
const kitoltott = (slug: 'kezdolap' | 'szolgaltatasok'): NonNullable<Page['layout']> => {
  const eredmeny = sinElrendezesKitoltese(lap(slug).layout, slug).layout
  return eredmeny === null ? lap(slug).layout : (eredmeny as NonNullable<Page['layout']>)
}

/** A blokk emberi neve a katalógusból (a sorcímke is ezt kapja clientProps-ként). */
const tipusNev = (slug: string): string => {
  const blokk = pageBlocks.find((block) => block.slug === slug)
  const nev = blokk?.labels?.singular
  return typeof nev === 'string' ? nev : slug
}

const cimke = (sor: unknown, index: number, pageSlug: string): string => {
  const blockType =
    typeof sor === 'object' && sor !== null && 'blockType' in sor ? String(sor.blockType) : ''
  return sectionRowLabelText(describeSectionOnPage(sor, index, tipusNev(blockType), [], pageSlug))
}

/* ------------------------------------------------------------------------ */
/* H01: a kódbeli címtartalékok                                              */
/* ------------------------------------------------------------------------ */

describe('H01: üres Címnél a címke azt mondja, amit a lap', () => {
  it('Számozott lépések: üres Szekciócímnél nem a lépés címe, hanem „(beépített cím)”', () => {
    const adat = { blockType: 'howItWorks', title: '', steps: [{ title: 'X' }] }
    expect(sectionTitle(adat)).toBeNull()
    const leiras = describeSection(adat, 6, tipusNev('howItWorks'))
    expect(leiras.cimSzoveg).toBe(BEEPITETT_CIM)
    expect(sectionRowLabelText(leiras)).toBe('07 · Számozott lépések: (beépített cím)')
    // A lap üres Címnél a beépített címet mutatja (HowItWorks.tsx:49).
    expect(forras('components/content/home/HowItWorks.tsx')).toContain(
      "const heading = title?.trim() || 'Így működik az online kurzus'",
    )
    // Kitöltött Címnél a mentett cím marad.
    expect(sectionTitle({ ...adat, title: 'Három lépésben' })).toBe('Három lépésben')
  })

  it('hitel-csík: az első KITÖLTÖTT tétel, üres tételeknél „(beépített cím)”', () => {
    expect(
      sectionTitle({ blockType: 'credsStrip', items: [{ text: '  ' }, { text: 'Második tény' }] }),
    ).toBe('Második tény')
    for (const items of [[], [{ text: '' }, { text: null }], undefined]) {
      const adat = { blockType: 'credsStrip', items }
      expect(sectionTitle(adat)).toBeNull()
      expect(describeSection(adat, 3, 'Hitel-csík').cimSzoveg).toBe(BEEPITETT_CIM)
    }
    // A lap ugyanígy dönt: az üres tételeket kiszűri, üres listánál a
    // beépített tényeket mutatja (RenderBlocks.tsx, CredentialsStrip.tsx).
    expect(forras('components/blocks/RenderBlocks.tsx')).toContain(
      '.filter((text) => text.length > 0)',
    )
    expect(forras('components/content/home/CredentialsStrip.tsx')).toContain(
      'const credentials = items && items.length > 0 ? items : CREDENTIALS',
    )
  })

  it('a beépített címes típusok listája pontosan a kódbeli tartalékos renderelőké', () => {
    expect([...BUILT_IN_TITLE_TYPES].sort()).toEqual(
      [
        'courseCards',
        'credsStrip',
        'freeSos',
        'howItWorks',
        'knowledge',
        'pressLogos',
        'testimonials',
      ].sort(),
    )
    // Címet adó kódbeli tartalék (`|| '…'` vagy `|| KONSTANS` a cím-változón)
    // pontosan ezekben a renderelőkben áll; új tartaléknál ez a teszt bukik,
    // és a típust fel kell venni.
    const tartalekok: Record<string, RegExp> = {
      'components/content/home/HowItWorks.tsx': /const heading = title\?\.trim\(\) \|\| '/,
      'components/content/home/TestimonialsSection.tsx': /const title = heading\?\.trim\(\) \|\| '/,
      'components/content/home/KnowledgeSection.tsx': /const title = heading\?\.trim\(\) \|\| '/,
      'components/content/home/CourseShowcase.tsx':
        /const title = heading\?\.trim\(\) \|\| COURSE_SHOWCASE_HEADING/,
      'components/blocks/PressLogos.tsx':
        /const heading = block\.heading\?\.trim\(\) \|\| DEFAULT_HEADING/,
    }
    for (const [fajl, minta] of Object.entries(tartalekok)) {
      expect(forras(fajl), fajl).toMatch(minta)
    }
    const renderelok = [
      ...readdirSync(join(SRC, 'components/blocks')).map((f) => `components/blocks/${f}`),
      ...readdirSync(join(SRC, 'components/content/home')).map(
        (f) => `components/content/home/${f}`,
      ),
    ].filter((f) => f.endsWith('.tsx'))
    const cimTartalek = /const (?:title|heading) = [^\n]*\|\| (?:'|[A-Z_]{4,})/
    // A CourseCards.tsx nem blokk-renderelő: a RenderBlocks csak az
    // `isPaidProduct` segédjét importálja belőle, a courseCards ág a
    // CourseShowcase-t rajzolja.
    const nemBlokkRenderelo = ['components/content/home/CourseCards.tsx']
    expect(forras('components/blocks/RenderBlocks.tsx')).toContain(
      "import { isPaidProduct } from '../content/home/CourseCards'",
    )
    const talalt = renderelok
      .filter((f) => !nemBlokkRenderelo.includes(f) && cimTartalek.test(forras(f)))
      .sort()
    expect(talalt).toEqual(Object.keys(tartalekok).sort())
  })

  it('kezdőlapi segítség-sín: üres Címnél a lap feloldója („Így tudunk segíteni”)', () => {
    const sorok = LEGACY_HOME_HELP_TITLES.map((title, index) => ({
      title,
      url: LEGACY_HOME_HELP_URLS[index],
    }))
    const ures = { blockType: 'services', title: '', eyebrow: '', rows: sorok }
    expect(sectionPageTitle(ures, 'kezdolap')).toBe(HOME_HELP_TITLE)
    const leiras = describeSectionOnPage(ures, 4, tipusNev('services'), [], 'kezdolap')
    expect(leiras.cimSzoveg).toBe(`${HOME_HELP_TITLE} ${BEEPITETT_CIM}`)
    expect(sectionRowLabelText(leiras)).toBe(
      '05 · Képes lista vagy kártyák (sín): Így tudunk segíteni (beépített cím)',
    )
    // Más oldalon nincs átalakítás: a mentett adat dönt.
    expect(sectionPageTitle(ures, 'rolunk')).toBeNull()
    // Kitöltött, azonos Címnél nincs jel.
    expect(sectionPageTitle({ ...ures, title: HOME_HELP_TITLE }, 'kezdolap')).toBeNull()
  })

  it('kezdőlapi zárt-kéz sín: a lap a mentett Címtől függetlenül „Így tudunk segíteni”', () => {
    const zart = {
      blockType: 'services',
      title: 'Saját cím',
      rows: CLOSED_HAND_HOME_HELP_TITLES.map((title) => ({ title })),
    }
    expect(sectionPageTitle(zart, 'kezdolap')).toBe(HOME_HELP_TITLE)
    expect(describeSectionOnPage(zart, 4, 'X', [], 'kezdolap').cimSzoveg).toBe(
      `${HOME_HELP_TITLE} ${BEEPITETT_CIM}`,
    )
  })

  it('az élő kezdőlap segítség-sora kitöltött Címmel: nincs „(beépített cím)” jel', () => {
    expect(cimke(kitoltott('kezdolap')[4], 4, 'kezdolap')).toBe(
      '05 · Képes lista vagy kártyák (sín): Így tudunk segíteni',
    )
  })

  it('cím nélküli, beépített tartalék nélküli sor továbbra is „(még nincs címe)”', () => {
    expect(describeSectionOnPage({ blockType: 'ctaBanner' }, 0, 'X', [], 'rolunk').cimSzoveg).toBe(
      NINCS_CIME,
    )
  })
})

/* ------------------------------------------------------------------------ */
/* H03: a lapon TÉNYLEGESEN látszó elrendezés                                */
/* ------------------------------------------------------------------------ */

describe('H03: servicesTenylegesElrendezes a lap szabálya szerint (a mentett mező dönt)', () => {
  it('kezdőlap: a mentett mező dönt, mező nélkül a háromajtós felismerés', () => {
    const nyers = lap('kezdolap').layout[4]
    expect(nyers?.blockType === 'services' ? nyers.elrendezes : null).toBe('tabla')
    // A szabály előtti mentett „tabla” a lapon is tábla (A3: a mező nyer).
    expect(servicesTenylegesElrendezes(nyers, 'kezdolap')).toBe('tabla')
    // Az előtöltés után (deploy-feltétel) a mező „sin”, a lap is sín.
    const sor = kitoltott('kezdolap')[4]
    expect(sor?.blockType === 'services' ? sor.elrendezes : null).toBe('sin')
    expect(servicesTenylegesElrendezes(sor, 'kezdolap')).toBe('sin')
    // Mező nélküli régi adat: a háromajtós felismerés a tartalék.
    expect(servicesTenylegesElrendezes({ ...nyers, elrendezes: null }, 'kezdolap')).toBe('sin')
    // A kezdőlap nem átalakítható services sora a mezőt követi.
    const erre = lap('kezdolap').layout[9]
    expect(servicesTenylegesElrendezes(erre, 'kezdolap')).toBe('tabla')
    expect(servicesTenylegesElrendezes({ ...erre, elrendezes: 'sin' }, 'kezdolap')).toBe('sin')
    expect(servicesTenylegesElrendezes({ ...erre, elrendezes: null }, 'kezdolap')).toBe('tabla')
  })

  it('Szolgáltatások: a mentett mező dönt, mező nélkül az ajtó-felismerés', () => {
    const nyers = lap('szolgaltatasok').layout
    expect(servicesTenylegesElrendezes(nyers[1], 'szolgaltatasok')).toBe('tabla')
    const sorok = kitoltott('szolgaltatasok')
    expect(servicesTenylegesElrendezes(sorok[1], 'szolgaltatasok')).toBe('sin')
    expect(
      servicesTenylegesElrendezes({ ...sorok[1], elrendezes: 'tabla' }, 'szolgaltatasok'),
    ).toBe('tabla')
    expect(servicesTenylegesElrendezes({ ...sorok[1], elrendezes: null }, 'szolgaltatasok')).toBe(
      'sin',
    )
    for (const index of [2, 4]) {
      expect(servicesTenylegesElrendezes(sorok[index], 'szolgaltatasok')).toBe('tabla')
      expect(
        servicesTenylegesElrendezes({ ...sorok[index], elrendezes: 'sin' }, 'szolgaltatasok'),
      ).toBe('sin')
      expect(
        servicesTenylegesElrendezes({ ...sorok[index], elrendezes: null }, 'szolgaltatasok'),
      ).toBe('tabla')
    }
  })

  it('Rólunk (és minden más oldal): a mező értéke, hiányzó mezőnél „tabla”', () => {
    const sorok = lap('rolunk').layout
    expect(servicesTenylegesElrendezes(sorok[2], 'rolunk')).toBe('tabla')
    expect(servicesTenylegesElrendezes(sorok[3], 'rolunk')).toBe('sin')
    expect(servicesTenylegesElrendezes({ blockType: 'services', rows: [] }, 'rolunk')).toBe('tabla')
    expect(servicesTenylegesElrendezes({ blockType: 'services', elrendezes: null }, 'x')).toBe(
      'tabla',
    )
  })

  it('nem services blokknál null', () => {
    expect(servicesTenylegesElrendezes(lap('kezdolap').layout[1], 'kezdolap')).toBeNull()
    expect(servicesTenylegesElrendezes(null, 'kezdolap')).toBeNull()
  })

  it('a címke: „05 · Képes lista vagy kártyák (sín): Így tudunk segíteni”', () => {
    expect(sectionPageMarks(kitoltott('kezdolap')[4], 'kezdolap').valtozat).toBe('(sín)')
    expect(cimke(lap('kezdolap').layout[9], 9, 'kezdolap')).toBe(
      '10 · Képes lista vagy kártyák (tábla): Erre számíthatsz velünk',
    )
    expect(cimke(kitoltott('szolgaltatasok')[1], 1, 'szolgaltatasok')).toBe(
      '02 · Képes lista vagy kártyák (sín): Így segítünk',
    )
  })

  it('az élő szekciósor minden services sora kap jelet, más típus soha', () => {
    for (const elo of Object.values(ELO)) {
      elo.layout.forEach((sor, index) => {
        const { valtozat } = sectionPageMarks(sor, elo.slug)
        expect(valtozat === null, `${elo.slug} ${String(index + 1)}`).toBe(
          sor.blockType !== 'services',
        )
      })
    }
  })
})

/* ------------------------------------------------------------------------ */
/* H48/4: a kötött ugrópont jele a sorcímkén                                 */
/* ------------------------------------------------------------------------ */

describe('H48/4: „#rendeloi (erre visz a menü)” a sorcímkén', () => {
  it('a Szolgáltatások „rendeloi” sora a jelet kapja, ugyanez más oldalon semmit', () => {
    const sor = lap('szolgaltatasok').layout[3]
    expect(sectionPageMarks(sor, 'szolgaltatasok').jelek).toEqual(['#rendeloi (erre visz a menü)'])
    expect(sectionPageMarks(sor, 'rolunk').jelek).toEqual([])
    expect(sectionPageMarks(sor, 'kezdolap').jelek).toEqual([])
    expect(cimke(sor, 3, 'szolgaltatasok')).toMatch(
      /^04 · Szabad szöveg: .+ #rendeloi \(erre visz a menü\)$/u,
    )
  })

  it('a Kapcsolat időpontkérő sora a blogbejegyzések időpontgombját nevezi meg', () => {
    const sor = lap('kapcsolat').layout[0]
    expect(sectionPageMarks(sor, 'kapcsolat').jelek).toEqual([
      '#idopontkeres (erre visz a blogbejegyzések időpontgombja)',
    ])
    expect(cimke(sor, 0, 'kapcsolat')).toBe(
      '01 · Időpontkérés: Kérj időpontot a rendelőbe #idopontkeres (erre visz a blogbejegyzések időpontgombja)',
    )
  })

  it('az illesztés ugyanaz, mint a kotottUgropont-é: az élő szekciósorban pontosan a két sor', () => {
    for (const elo of Object.values(ELO)) {
      elo.layout.forEach((sor) => {
        expect(sectionPageMarks(sor, elo.slug).jelek.length > 0).toBe(
          kotottUgropont(sor, elo.slug) !== null,
        )
      })
    }
    for (const elem of KOTOTT_UGROPONTOK) {
      expect(elem.rovid).toMatch(/^erre visz /u)
      expect(elem.rovid).not.toMatch(/[–—!]/u)
    }
  })

  it('a jelek sorrendje: típus [elrendezés], cím, jelek, (blokknév), (N. ilyen); a nézet betűre ugyanaz', () => {
    const leiras: SectionDescription = {
      sorszam: '05',
      tipus: 'Képes lista vagy kártyák',
      valtozat: '(sín)',
      cim: 'Így tudunk segíteni',
      teljesCim: 'Így tudunk segíteni',
      cimSzoveg: 'Így tudunk segíteni',
      blokkNev: 'Régi név',
      rejtett: true,
      horgony: 'rendeloi',
      ismetles: 2,
      jelek: ['#rendeloi (erre visz a menü)'],
    }
    const vart =
      '05 · Rejtve · Képes lista vagy kártyák (sín): Így tudunk segíteni #rendeloi (erre visz a menü) (Régi név) (2. ilyen)'
    expect(sectionRowLabelText(leiras)).toBe(vart)
    const html = renderToStaticMarkup(createElement(SectionRowLabelView, { leiras }))
    expect(html.replace(/<[^>]+>/g, '')).toBe(vart)
    // Jelek nélkül az alak a régi (a szalag és a szekció-másolatok így építik).
    const regi = {
      ...leiras,
      valtozat: undefined,
      jelek: undefined,
      blokkNev: null,
      ismetles: null,
    }
    expect(sectionRowLabelText(regi)).toBe(
      '05 · Rejtve · Képes lista vagy kártyák: Így tudunk segíteni',
    )
  })
})

/* ------------------------------------------------------------------------ */
/* H48/3: a csak CMS-linkkel kötött „szakmai-hatter”                          */
/* ------------------------------------------------------------------------ */

/** A mező címkéje egy blokk mezői között, rekurzívan (név szerint). */
function mezoCimke(fields: readonly Field[], nev: string): string | undefined {
  for (const field of fields) {
    if ('name' in field && field.name === nev && 'label' in field) {
      return typeof field.label === 'string' ? field.label : undefined
    }
    if ('fields' in field && Array.isArray(field.fields)) {
      const talalt = mezoCimke(field.fields as Field[], nev)
      if (talalt) {
        return talalt
      }
    }
  }
  return undefined
}

describe('H48/3: a CMS-linkekkel kötött ugrópont', () => {
  const MONDAT = CMS_KOTOTT_UGROPONTOK[0]?.mondat ?? ''

  it('egy elem: Rólunk, „szakmai-hatter”', () => {
    expect(CMS_KOTOTT_UGROPONTOK.map((elem) => `${elem.oldal}#${elem.ugropont}`)).toEqual([
      'rolunk#szakmai-hatter',
    ])
  })

  it('a mondat a linkfeliratot és a hivatkozó oldalakat mondja (a kártyákat építő szkript szerint)', () => {
    // Az élő mérés (az /api/pages, 2026-09-22) a fixture-ben nem látszik, mert
    // ott a kártyák mélység nélkül, azonosítóként állnak: négy link, mindegyik
    // „Nézd meg a szakmai hátterét” felirattal, a Kapcsolat oldalon
    // `/rolunk#szakmai-hatter`, a Rólunk oldalon `#szakmai-hatter`. A kártyákat
    // a restore-legacy-content.ts építi, a kód ugyanezt mondja.
    const szkript = forras('scripts/restore-legacy-content.ts')
    expect(szkript).toContain("const SZAKMAI_HATTER_URL = '/rolunk#szakmai-hatter'")
    expect(szkript).toContain("hatterUrl: '#szakmai-hatter'")
    expect(szkript).toMatch(/felirat: 'Nézd meg a szakmai hátterét',\s*url: opciok\.hatterUrl/u)
    const kartyak = Object.values(ELO)
      .filter((elo) => elo.layout.some((sor) => sor.blockType === 'teamMembers'))
      .map((elo) => elo.slug)
      .sort()
    expect(kartyak).toEqual(['kapcsolat', 'rolunk'])
    expect(MONDAT).toContain('„Nézd meg a szakmai hátterét” linkek')
    expect(MONDAT).toContain('a Rólunk és a Kapcsolat oldalon')
  })

  it('a mezőneveket betűre a blokk címkéiből idézi (SC 3.2.4)', () => {
    const csapat = pageBlocks.find((block) => block.slug === 'teamMembers')
    expect(csapat).toBeDefined()
    const hivatkozas = mezoCimke(csapat?.fields ?? [], 'link')
    const webcim = mezoCimke(csapat?.fields ?? [], 'url')
    expect(hivatkozas).toBe('Hivatkozás')
    expect(MONDAT).toContain(`„${String(hivatkozas)}” részében`)
    expect(MONDAT).toContain(`„${String(webcim)}” mezőt`)
  })

  it('illesztés: a Rólunk „szakmai-hatter” sora igen, más oldal és más horgony nem', () => {
    const accordion = lap('rolunk').layout[6]
    expect(cmsKotottUgropont(accordion, 'rolunk')).toBe(MONDAT)
    expect(cmsKotottUgropont(accordion, 'kapcsolat')).toBeNull()
    expect(cmsKotottUgropont(lap('rolunk').layout[1], 'rolunk')).toBeNull()
    // A kódhoz kötött lista és mondat változatlan: a „szakmai-hatter” nem kerül bele.
    expect(kotottUgropont(accordion, 'rolunk')).toBeNull()
    expect(sectionPageMarks(accordion, 'rolunk').jelek).toEqual([])
    const model = sectionNoticeModel({
      data: accordion,
      pageSlug: 'rolunk',
      rowIndex: 6,
      siblings: lap('rolunk').layout,
      adminRoute: '/admin',
    })
    expect(model.cmsKotott).toBe(MONDAT)
    expect(model.kotott).toBeNull()
  })

  it('legfeljebb két mondat, gondolatjel, „csak” és „minden” nélkül', () => {
    expect(MONDAT.split(/(?<=[.!?])\s+(?=\p{Lu})/u)).toHaveLength(2)
    expect(MONDAT).not.toMatch(/[–—!]/u)
    expect(MONDAT).not.toMatch(/(?<!\p{L})(csak|minden)(?!\p{L})/iu)
  })
})

/* ------------------------------------------------------------------------ */
/* H30 és H43/5: a Vélemények hol látszanak                                  */
/* ------------------------------------------------------------------------ */

describe('H30, H43/5: a Vélemények forrás-jelzésének második bekezdése', () => {
  const velemenyek = lap('kezdolap').layout.find((sor) => sor.blockType === 'testimonials')

  it('betűre a kiírt két mondat, a „Hol látszik” oszlopnévvel', () => {
    expect(VELEMENYEK_HOL_LATSZIK).toBe(
      'Ugyanezeket a véleményeket mutatja bármelyik másik oldal Vélemények szekciója is, a Kapcsolat oldalét kivéve. Amelyik vélemény nem kerül az első háromba, az sehol nem jelenik meg; a Vélemények listájában a „Hol látszik” oszlop véleményenként mutatja.',
    )
    for (const slug of ['kezdolap', 'rolunk', 'szolgaltatasok']) {
      expect(sectionSource(velemenyek, slug)?.holLatszik).toBe(VELEMENYEK_HOL_LATSZIK)
    }
    // A Kapcsolat oldalon a szekció nem jelenik meg: ott nincs ilyen bekezdés.
    expect(sectionSource(velemenyek, 'kapcsolat')?.holLatszik).toBeUndefined()
  })

  it('nincs gondolatjel, nincs „csak”, nincs „minden oldal”, szerepel a „Hol látszik”', () => {
    expect(VELEMENYEK_HOL_LATSZIK).not.toMatch(/[–—!]/u)
    expect(VELEMENYEK_HOL_LATSZIK).not.toMatch(/(?<!\p{L})csak(?!\p{L})/iu)
    expect(VELEMENYEK_HOL_LATSZIK).not.toMatch(/minden oldal/iu)
    expect(VELEMENYEK_HOL_LATSZIK).toContain('„Hol látszik”')
    expect(VELEMENYEK_HOL_LATSZIK.split(/(?<=[.!?])\s+(?=\p{Lu})/u)).toHaveLength(2)
  })

  it('a „bármelyik másik oldal, a Kapcsolatét kivéve” igaz: a getTestimonials két route-ban fut', () => {
    const hivok: string[] = []
    const bejar = (konyvtar: string): void => {
      for (const bejegyzes of readdirSync(join(SRC, konyvtar), { withFileTypes: true })) {
        const utvonal = `${konyvtar}/${bejegyzes.name}`
        if (bejegyzes.isDirectory()) {
          if (bejegyzes.name !== '__tests__' && bejegyzes.name !== 'node_modules') {
            bejar(utvonal)
          }
        } else if (
          /\.(ts|tsx)$/.test(bejegyzes.name) &&
          // Csak a kódsorok számítanak, a kommentben álló említés nem hívás.
          forras(utvonal)
            .split('\n')
            .some((sor) => /getTestimonials\(/.test(sor) && !/^\s*(\*|\/\/)/.test(sor))
        ) {
          hivok.push(utvonal)
        }
      }
    }
    bejar('app')
    bejar('components')
    bejar('lib')
    expect(hivok.sort()).toEqual([
      'app/(frontend)/[slug]/page.tsx',
      'app/(frontend)/page.tsx',
      'lib/cms.ts',
    ])
    expect(forras('lib/cms.ts')).toContain('export async function getTestimonials(limit = 3)')
    expect(forras('app/(frontend)/kapcsolat/page.tsx')).toContain('testimonials={[]}')
  })
})
