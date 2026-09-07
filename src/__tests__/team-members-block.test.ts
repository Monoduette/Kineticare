import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { pageBlockSlugs, teamMembers } from '../blocks'
import { RenderBlocks } from '../components/blocks/RenderBlocks'
import { cvItemLines, TeamMembers, telHref } from '../components/blocks/TeamMembers'
import type { BlockTeamMembers, Page } from '../payload-types'

/**
 * Szakértő-kártyák (teamMembers) — fókuszált tesztek, DB nélkül.
 *
 * Öt szerződést rögzítenek:
 *  1. a BLOKK-DEFINÍCIÓ: benne van a katalógusban, a `members` tömb legfeljebb
 *     KETTŐ (ez a 50–50-es páros szerződése), és a név kötelező;
 *  2. a RENDERELÉS: két tag egymás mellett, névvel/titulussal/bióval, a hiányos
 *     tag kimarad, tag nélkül a szekció is;
 *  3. a LINKELÉS és a TISZTÍTÁS: `tel:`/`mailto:` href-építés, tiltott sémájú
 *     CMS-webcím némán link nélkül renderel;
 *  4. a CV-HARMONIKA: natív `details`, a darabszám a TÉNYLEGES sorokból jön,
 *     üres sor nem számít bele, és a blokk NEM ad ki FAQPage JSON-LD-t;
 *  5. a BEJELENTKEZÉS-RÉTEG (2026-08-16): a telefonszám saját, nagy
 *     érintőcélú hívás-felületet kap, a hozzáférhető neve tartalmazza a
 *     látható feliratot (WCAG 2.5.3), és a szekció alján megjelenhet egy
 *     írásos időpontkérési út.
 *
 * A stíluslap szabályai (akcent-korlát, érintőcél, prefers-reduced-motion)
 * fájl-szinten őrzöttek: mindegyik olyan, amit egy későbbi szerkesztés csendben
 * elronthatna.
 */

// ---------------------------------------------------------------------------
// Fixture-ök
// ---------------------------------------------------------------------------

type Layout = NonNullable<Page['layout']>

function render(node: ReactNode): string {
  return renderToStaticMarkup(createElement(Fragment, null, node))
}

/** Egy teamMembers blokk renderelése önmagában (a szekció-adapteren kívül). */
function renderBlock(block: Record<string, unknown>): string {
  return render(createElement(TeamMembers, { block: block as unknown as BlockTeamMembers }))
}

/** Ugyanaz a blokk a RenderBlocks switchén keresztül (regisztráció-ellenőrzés). */
function renderViaSwitch(block: Record<string, unknown>): string {
  return render(
    createElement(RenderBlocks, {
      layout: [block] as unknown as Layout,
      products: [],
      posts: [],
      testimonials: [],
    }),
  )
}

const kocsis = {
  id: 'm1',
  name: 'Kocsis Kata',
  role: 'Gyógytornász, manuálterapeuta',
  bio: 'Kézrehabilitációval foglalkozik.',
  phone: '+36 30 169 2263',
}

const kiss = {
  id: 'm2',
  name: 'Kiss Kata',
  role: 'Gyógytornász, sportrehabilitációs tréner',
  bio: 'Sportolók kézsérüléseivel foglalkozik.',
  phone: '+36 20 357 3493',
}

// ---------------------------------------------------------------------------
// 1. Blokk-definíció
// ---------------------------------------------------------------------------

describe('teamMembers blokk-definíció', () => {
  it('a katalógus része, és a slug/interfész a generált típussal egyezik', () => {
    expect(teamMembers.slug).toBe('teamMembers')
    expect(teamMembers.interfaceName).toBe('BlockTeamMembers')
    expect(pageBlockSlugs).toContain('teamMembers')
  })

  it('a `members` tömb LEGFELJEBB kettő — ez a 50–50-es páros szerződése', () => {
    const members = teamMembers.fields.find((field) => 'name' in field && field.name === 'members')
    expect(members, 'nincs `members` mező a blokkban').toBeDefined()
    expect(members).toMatchObject({ type: 'array', maxRows: 2, minRows: 1 })
  })

  it('a név kötelező, a portré/titulus/bio nem — hiányos adat nem blokkolja a mentést', () => {
    const members = teamMembers.fields.find(
      (field): field is Extract<typeof field, { fields: unknown[] }> =>
        'name' in field && field.name === 'members' && 'fields' in field,
    )
    const byName = new Map(
      (members?.fields ?? []).flatMap((field) =>
        'name' in field && typeof field.name === 'string' ? [[field.name, field] as const] : [],
      ),
    )
    expect(byName.get('name')).toMatchObject({ required: true })
    expect(byName.get('photo')).toMatchObject({ type: 'upload', relationTo: 'media' })
    // A `required` a Payload mező-uniójában nem minden ágon létezik (UIField),
    // ezért itt szűkítés nélkül, tulajdonság-jelenlétre vizsgálunk. A
    // bejelentkezés-réteg három mezője is OPCIONÁLIS: a blokk meglévő
    // (/rolunk) használatát nem törheti el egy új kötelező mező.
    for (const optional of [
      'role',
      'bio',
      'phone',
      'callLabel',
      'availability',
      'email',
    ] as const) {
      const field = byName.get(optional)
      expect(field, `hiányzó mező: ${optional}`).toBeDefined()
      expect(
        field && 'required' in field ? field.required === true : false,
        `a(z) ${optional} mező nem lehet kötelező`,
      ).toBe(false)
    }
    // A szekció-beállítások (elrejtés, horgony, háttér) minden blokkon ott vannak.
    expect(
      teamMembers.fields.some((field) => 'name' in field && field.name === 'sectionSettings'),
    ).toBe(true)
  })

  it('van szekció-szintű, ÍRÁSOS időpontkérési út (`bookingLink`), a közös link-mezőkkel', () => {
    const booking = teamMembers.fields.find(
      (field): field is Extract<typeof field, { fields: unknown[] }> =>
        'name' in field && field.name === 'bookingLink' && 'fields' in field,
    )
    expect(booking, 'nincs `bookingLink` csoport a blokkban').toBeDefined()
    expect(booking).toMatchObject({ type: 'group' })
    // Ugyanaz a három mező, mint minden más szekció-CTA-nál (link-fields.ts):
    // a szerkesztőnek egyszer kell megtanulnia, és a webcím ugyanazt az
    // allowlist-validációt kapja.
    const nevek = (booking?.fields ?? []).flatMap((field) =>
      'name' in field && typeof field.name === 'string' ? [field.name] : [],
    )
    expect(nevek).toEqual(['felirat', 'url', 'ujAblakban'])
  })
})

// ---------------------------------------------------------------------------
// 2. Renderelés
// ---------------------------------------------------------------------------

describe('TeamMembers renderelés', () => {
  it('két tag egymás mellett: mindkét név, titulus és bio megjelenik', () => {
    const html = renderBlock({
      id: 'b1',
      blockType: 'teamMembers',
      title: 'Kik vagyunk?',
      members: [kocsis, kiss],
      sectionSettings: {},
    })
    expect(html).toContain('Kik vagyunk?')
    expect(html).toContain('Kocsis Kata')
    expect(html).toContain('Kiss Kata')
    expect(html).toContain('Gyógytornász, manuálterapeuta')
    expect(html).toContain('Sportolók kézsérüléseivel foglalkozik.')
    // Pontosan két kártya — a rács két hasábja.
    expect((html.match(/kc-team__card/g) ?? []).length).toBe(2)
  })

  it('név nélküli tag kimarad; egyetlen érvényes tag nélkül a szekció sem renderel', () => {
    const html = renderBlock({
      id: 'b2',
      blockType: 'teamMembers',
      title: 'Kik vagyunk?',
      members: [kocsis, { id: 'm3', name: '   ', role: 'Névtelen titulus' }],
      sectionSettings: {},
    })
    expect(html).toContain('Kocsis Kata')
    expect(html).not.toContain('Névtelen titulus')
    expect((html.match(/kc-team__card/g) ?? []).length).toBe(1)

    expect(renderBlock({ id: 'b3', blockType: 'teamMembers', title: 'Üres' })).toBe('')
  })

  it('cím nélkül a nevek h2-k (nincs kihagyott címsor-szint), címmel h3-ak', () => {
    const withTitle = renderBlock({
      id: 'b4',
      blockType: 'teamMembers',
      title: 'Kik vagyunk?',
      members: [kocsis],
      sectionSettings: {},
    })
    expect(withTitle).toContain('<h2 class="kc-team__title"')
    expect(withTitle).toContain('<h3 class="kc-team__name">Kocsis Kata</h3>')

    const withoutTitle = renderBlock({
      id: 'b5',
      blockType: 'teamMembers',
      members: [kocsis],
      sectionSettings: {},
    })
    expect(withoutTitle).not.toContain('<h3')
    expect(withoutTitle).toContain('<h2 class="kc-team__name">Kocsis Kata</h2>')
  })

  it('a RenderBlocks switch ismeri a blokkot: horgony és háttérsáv átmegy', () => {
    const html = renderViaSwitch({
      blockType: 'teamMembers',
      id: 'b6',
      title: 'Kik vagyunk?',
      members: [kocsis, kiss],
      sectionSettings: { visible: true, anchorId: 'szakembereink', hatter: 'tint' },
    })
    expect(html).toContain('Kocsis Kata')
    expect(html).toContain('id="szakembereink"')
    expect(html).toContain('kc-section--tint')
  })

  it('visible=false esetén a szekció kimarad', () => {
    const html = renderViaSwitch({
      blockType: 'teamMembers',
      id: 'b7',
      title: 'Rejtett szekció',
      members: [kocsis],
      sectionSettings: { visible: false },
    })
    expect(html).toBe('')
  })
})

// ---------------------------------------------------------------------------
// 3. Kapcsolati linkek és CMS-webcím tisztítás
// ---------------------------------------------------------------------------

describe('TeamMembers kapcsolati linkek', () => {
  it('telHref: a tagolt szám href-je csak + és számjegy; szám nélkül nincs link', () => {
    expect(telHref('+36 30 169 2263')).toBe('tel:+36301692263')
    expect(telHref('06-30/169-2263')).toBe('tel:06301692263')
    expect(telHref('hívj fel!')).toBeNull()
  })

  it('a megjelenített szám tagolt marad, a href tömör; az e-mail mailto: lesz', () => {
    const html = renderBlock({
      id: 'b8',
      blockType: 'teamMembers',
      members: [{ ...kocsis, email: 'info@kineticare.hu' }],
      sectionSettings: {},
    })
    expect(html).toContain('href="tel:+36301692263"')
    expect(html).toContain('+36 30 169 2263')
    expect(html).toContain('href="mailto:info@kineticare.hu"')
    // Az ismétlődő kapcsolati linkek a linklistában is megkülönböztethetők.
    expect(html).toContain('aria-label="Kocsis Kata telefonszáma: +36 30 169 2263"')
  })

  it('tiltott sémájú webcím némán link nélkül renderel, a belső útvonal linkként', () => {
    const blocked = renderBlock({
      id: 'b9',
      blockType: 'teamMembers',
      members: [{ ...kocsis, link: { felirat: 'Bővebben', url: 'javascript:alert(1)' } }],
      sectionSettings: {},
    })
    expect(blocked).toContain('Kocsis Kata')
    expect(blocked).not.toContain('kc-team__link')

    const allowed = renderBlock({
      id: 'b10',
      blockType: 'teamMembers',
      members: [{ ...kocsis, link: { felirat: 'Bővebben', url: '/rolunk#cv-kocsis' } }],
      sectionSettings: {},
    })
    expect(allowed).toContain('href="/rolunk#cv-kocsis"')
    expect(allowed).toContain('aria-label="Kocsis Kata: Bővebben"')
  })

  it('a hívás SAJÁT felületet kap (nem a régi, apró kapcsolat-lista eleme)', () => {
    const html = renderBlock({
      id: 'b8b',
      blockType: 'teamMembers',
      members: [{ ...kocsis, email: 'info@kineticare.hu' }],
      sectionSettings: {},
    })
    // A telefon a bejelentkezés-blokk hívás-felületén áll, a szám külön
    // elemben (hogy az egy sorban tartás és a táblázatos számjegy ráérjen).
    expect(html).toContain('class="kc-team__booking"')
    expect(html).toContain('class="kc-team__call"')
    expect(html).toContain('<span class="kc-team__call-number">+36 30 169 2263</span>')
    // Az e-mail MÁSODLAGOS marad: saját, halkabb osztályt visz.
    expect(html).toContain('class="kc-team__email"')
    // A dekoratív ikon nem kaphat hozzáférhető nevet (a linknek már van).
    expect(html).toContain('<svg aria-hidden="true"')
    expect(html).toContain('focusable="false"')
  })

  it('a hívás hozzáférhető neve tartalmazza a LÁTHATÓ feliratot (WCAG 2.5.3)', () => {
    const felirattal = renderBlock({
      id: 'b8c',
      blockType: 'teamMembers',
      members: [{ ...kocsis, callLabel: 'Hívd Kocsis Katát' }],
      sectionSettings: {},
    })
    // Látható: a felirat ÉS a szám — mindkettőnek benne kell lennie a névben.
    expect(felirattal).toContain('<span class="kc-team__call-label">Hívd Kocsis Katát</span>')
    expect(felirattal).toContain('aria-label="Hívd Kocsis Katát: +36 30 169 2263"')
    // Elválasztónak kettőspont áll, nem gondolatjel (projekt-skill 2. pont).
    expect(felirattal).not.toContain('aria-label="Hívd Kocsis Katát —')

    // Felirat nélkül a puszta szám nem azonosít, ezért a név marad a horgony.
    const felirapNelkul = renderBlock({
      id: 'b8d',
      blockType: 'teamMembers',
      members: [kocsis],
      sectionSettings: {},
    })
    expect(felirapNelkul).toContain('aria-label="Kocsis Kata telefonszáma: +36 30 169 2263"')
    expect(felirapNelkul).not.toContain('kc-team__call-label')
  })

  it('az elérhetőségi sor és az írásos időpontkérés csak megadva jelenik meg', () => {
    const nelkule = renderBlock({
      id: 'b8e',
      blockType: 'teamMembers',
      members: [kocsis],
      sectionSettings: {},
    })
    expect(nelkule).not.toContain('kc-team__availability')
    expect(nelkule).not.toContain('kc-team__booking-note')

    const teljes = renderBlock({
      id: 'b8f',
      blockType: 'teamMembers',
      bookingLink: { felirat: 'Kérj időpontot üzenetben', url: '/kapcsolat' },
      members: [{ ...kocsis, availability: 'Hétfőtől péntekig, a budapesti rendelőben' }],
      sectionSettings: {},
    })
    expect(teljes).toContain('Hétfőtől péntekig, a budapesti rendelőben')
    expect(teljes).toContain('class="kc-team__booking-link"')
    expect(teljes).toContain('href="/kapcsolat"')
    expect(teljes).toContain('Kérj időpontot üzenetben')
    // A felirat önmagában beszédes: külön aria-label nem takarhatja el
    // (WCAG 2.5.3 — a hozzáférhető név és a látható felirat egyezzen).
    expect(teljes).not.toMatch(/aria-label="[^"]*Kérj időpontot üzenetben/)
  })

  it('telefon, e-mail és elérhetőségi sor NÉLKÜL nincs bejelentkezés-réteg (WP15: a Rólunk személyközpontú kártyája)', () => {
    // A Rólunk lap a személyekről szól, a Kapcsolat a kapcsolatfelvételről
    // (NN/g About Us vs. Contact Us). A szétválasztás sémabővítés nélkül
    // megy: a /rolunk seed üresen hagyja a három hívás-mezőt, és a komponens
    // ilyenkor sem hívás-felületet, sem üres réteget nem renderel.
    const html = renderBlock({
      id: 'b8g',
      blockType: 'teamMembers',
      title: 'Akik a kezeddel foglalkoznak',
      bookingLink: { felirat: 'Kérj időpontot üzenetben', url: '/kapcsolat#idopontkeres' },
      members: [
        {
          ...kocsis,
          phone: '',
          callLabel: '',
          availability: '',
          link: { felirat: 'Nézd meg a szakmai hátterét', url: '#szakmai-hatter' },
        },
      ],
      sectionSettings: {},
    })
    expect(html).toContain('Kocsis Kata')
    expect(html).toContain('Kézrehabilitációval foglalkozik.')
    expect(html).not.toContain('kc-team__booking"')
    expect(html).not.toContain('kc-team__call')
    expect(html).not.toContain('tel:')
    // A kártya-link és a szekció-szintű időpontkérő link marad.
    expect(html).toContain('href="#szakmai-hatter"')
    expect(html).toContain('href="/kapcsolat#idopontkeres"')
  })

  it('az írásos időpontkérés is átmegy az allowlist-szűrőn', () => {
    const tiltott = renderBlock({
      id: 'b8g',
      blockType: 'teamMembers',
      bookingLink: { felirat: 'Időpont', url: 'javascript:alert(1)' },
      members: [kocsis],
      sectionSettings: {},
    })
    expect(tiltott).not.toContain('kc-team__booking-link')
    // Felirat nélküli webcím sem renderel linket (a kettő együtt kell).
    const felirapNelkul = renderBlock({
      id: 'b8h',
      blockType: 'teamMembers',
      bookingLink: { url: '/kapcsolat' },
      members: [kocsis],
      sectionSettings: {},
    })
    expect(felirapNelkul).not.toContain('kc-team__booking-link')
  })

  it('új lapon nyíló külső linknél kötelező a rel="noopener noreferrer"', () => {
    const html = renderBlock({
      id: 'b11',
      blockType: 'teamMembers',
      members: [
        {
          ...kocsis,
          link: { felirat: 'Szakmai profil', url: 'https://pelda.hu/kata', ujAblakban: true },
        },
      ],
      sectionSettings: {},
    })
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('target="_blank"')
  })
})

// ---------------------------------------------------------------------------
// 4. CV-harmonika
// ---------------------------------------------------------------------------

describe('TeamMembers szakmai listák (harmonika)', () => {
  it('cvItemLines: soronként egy tétel, az üres és csak szóközös sorok kimaradnak', () => {
    expect(cvItemLines('Egy\n\n  \nKettő\nHárom  ')).toEqual(['Egy', 'Kettő', 'Három'])
    expect(cvItemLines('   ')).toEqual([])
  })

  it('natív details/summary, és a darabszám a TÉNYLEGES sorokból számolódik', () => {
    const html = renderBlock({
      id: 'b12',
      blockType: 'teamMembers',
      members: [
        {
          ...kocsis,
          cvSections: [
            {
              id: 'cv1',
              heading: 'Tanfolyamok',
              // Öt sor, közte egy üres — a darabszám 4 kell legyen.
              items: 'Dynamic Tape\nFlossing\n\nKinezio tape\nKöpölyözés',
            },
          ],
        },
      ],
      sectionSettings: {},
    })
    expect(html).toContain('<details')
    expect(html).toContain('<summary')
    expect(html).toContain('Tanfolyamok')
    expect(html).toContain('<span class="kc-team__cv-count">4</span>')
    expect((html.match(/kc-team__cv-entry/g) ?? []).length).toBe(4)
    // Alapból zárva: az `open` attribútum nincs kiírva.
    expect(html).not.toContain('<details class="kc-team__cv-section" open')
  })

  it('cím vagy tétel nélküli lista kimarad', () => {
    const html = renderBlock({
      id: 'b13',
      blockType: 'teamMembers',
      members: [
        {
          ...kocsis,
          cvSections: [
            { id: 'cv2', heading: 'Üres lista', items: '\n  \n' },
            { id: 'cv3', heading: '  ', items: 'Van tétel, de nincs cím' },
          ],
        },
      ],
      sectionSettings: {},
    })
    expect(html).not.toContain('Üres lista')
    expect(html).not.toContain('Van tétel, de nincs cím')
    expect(html).not.toContain('<details')
  })

  it('a blokk NEM ad ki FAQPage JSON-LD-t (egy CV-lista nem GYIK)', () => {
    const html = renderViaSwitch({
      blockType: 'teamMembers',
      id: 'b14',
      title: 'Kik vagyunk?',
      members: [
        { ...kocsis, cvSections: [{ id: 'cv4', heading: 'Publikációk', items: 'Egy\nKettő' }] },
      ],
      sectionSettings: {},
    })
    expect(html).toContain('Publikációk')
    expect(html).not.toContain('FAQPage')
    expect(html).not.toContain('application/ld+json')
  })
})

// ---------------------------------------------------------------------------
// 5. Teljes CMS-vezéreltség (tulajdonosi elfogadási feltétel)
// ---------------------------------------------------------------------------

describe('TeamMembers — minden tartalom az adminból jön', () => {
  /**
   * Látható szöveg a renderelt HTML-ből: tag-ek nélkül, összevont szóközökkel.
   *
   * Az attribútumok (köztük a képernyőolvasónak szóló `aria-label` kötőszava)
   * szándékosan kimaradnak: az elfogadási feltétel a LÁTHATÓ tartalomra szól,
   * a hozzáférhető név pedig nem szerkesztői szöveg, hanem a11y-eszköz.
   */
  function visibleText(html: string): string {
    return html
      .replace(/<[^>]*>/g, ' ')
      .replace(/&#x27;/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
  }

  it('a látható szöveg KIZÁRÓLAG a mezők értéke (+ a számolt darabszám és a dekoratív nyíl)', () => {
    // A jelzőértékek szándékosan NEM részhalmazai egymásnak: a kivonás
    // egymás után fut, egy közös részszó hamis maradékot hagyna.
    const sentinels = {
      eyebrow: 'Aa-jelzo',
      title: 'Bb-jelzo',
      lead: 'Cc-jelzo',
      name: 'Dd-jelzo',
      role: 'Ee-jelzo',
      bio: 'Ff-jelzo',
      phone: '+11 22 333 4444',
      callLabel: 'Kk-jelzo',
      availability: 'Ll-jelzo',
      email: 'gg@jelzo.test',
      cvHeading: 'Hh-jelzo',
      cvItem: 'Ii-jelzo',
      linkLabel: 'Jj-jelzo',
      bookingLabel: 'Mm-jelzo',
    }
    const html = renderBlock({
      id: 'b15',
      blockType: 'teamMembers',
      eyebrow: sentinels.eyebrow,
      title: sentinels.title,
      lead: sentinels.lead,
      bookingLink: { felirat: sentinels.bookingLabel, url: '/kapcsolat' },
      members: [
        {
          id: 'm9',
          name: sentinels.name,
          role: sentinels.role,
          bio: sentinels.bio,
          phone: sentinels.phone,
          callLabel: sentinels.callLabel,
          availability: sentinels.availability,
          email: sentinels.email,
          cvSections: [{ id: 'cv9', heading: sentinels.cvHeading, items: sentinels.cvItem }],
          link: { felirat: sentinels.linkLabel, url: '/rolunk' },
        },
      ],
      sectionSettings: {},
    })

    let remaining = visibleText(html)
    for (const value of Object.values(sentinels)) {
      expect(remaining, `hiányzó mező-érték a kimenetből: ${value}`).toContain(value)
      remaining = remaining.split(value).join(' ')
    }
    // Ami marad: a számolt darabszám (1) és a két dekoratív nyíl. Bármi más
    // beégetett szöveg lenne — az a tulajdonosi feltétel megsértése. (A
    // telefon-ikon SVG, nem szöveg, ezért a kivonás után sem hagy nyomot.)
    expect(remaining.replace(/[\s→1]/g, '')).toBe('')
  })

  it('üres mezők nem kapnak helykitöltőt — a hiányzó rész egyszerűen kimarad', () => {
    const html = renderBlock({
      id: 'b16',
      blockType: 'teamMembers',
      members: [{ id: 'm10', name: 'Csak Név' }],
      sectionSettings: {},
    })
    expect(visibleText(html)).toBe('Csak Név')
    expect(html).not.toContain('kc-team__role')
    expect(html).not.toContain('kc-team__bio')
    expect(html).not.toContain('kc-team__booking')
    expect(html).not.toContain('kc-team__cv')
    expect(html).not.toContain('<img')
    // Telefonszám nélkül nincs se hívás-felület, se telefon-ikon.
    expect(html).not.toContain('<svg')
  })

  it('a kártyák sorrendje a tömb sorrendje — az adminban átrendezhető', () => {
    const first = renderBlock({
      id: 'b17',
      blockType: 'teamMembers',
      members: [kocsis, kiss],
      sectionSettings: {},
    })
    const swapped = renderBlock({
      id: 'b18',
      blockType: 'teamMembers',
      members: [kiss, kocsis],
      sectionSettings: {},
    })
    expect(first.indexOf('Kocsis Kata')).toBeLessThan(first.indexOf('Kiss Kata'))
    expect(swapped.indexOf('Kiss Kata')).toBeLessThan(swapped.indexOf('Kocsis Kata'))
  })
})

// ---------------------------------------------------------------------------
// 6. Stíluslap-őrök (akcent-korlát és mozgás-érzékenység)
// ---------------------------------------------------------------------------

describe('team-members.css szabály-őrök', () => {
  const css = readFileSync(
    fileURLToPath(new URL('../app/(frontend)/styles/blocks/team-members.css', import.meta.url)),
    'utf8',
  )

  it('a kiemelt szöveg accent-DEEP-et visz; a nyers `accent` sehol nem jelenik meg', () => {
    expect(css).toContain('--kc-team-accent-text: var(--kc-color-primary)')
    // A --kc-color-primary maga az accent-deep aliasa (tokens.css). A nyers
    // --kc-color-accent a hűvös felületeken 4,07:1 — AA alatt, ezért itt tilos.
    expect(css).not.toMatch(/var\(--kc-color-accent\)/)
  })

  it('a portré-nagyítás `prefers-reduced-motion: reduce` esetén kikapcsol', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toContain('transition: none')
    expect(reduced).toContain('transform: none')
  })

  it('a bejelentkezés-réteg MINDEN átmenete is a mozgás-kapcsoló mögött van', () => {
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    // A hívás-felület kifordulása, a kártyakeret és a felirat színváltása —
    // mindhárom `transition`, tehát mindhármat le kell tiltani.
    for (const selector of ['.kc-team__card', '.kc-team__call', '.kc-team__call-label']) {
      expect(reduced, `${selector} átmenete nincs kikapcsolva`).toContain(selector)
    }
  })

  it('a rács auto-fit — egy taggal nem marad üres hasáb (kutatás B3.5)', () => {
    expect(css).toContain('grid-template-columns: repeat(auto-fit, minmax(min(20rem, 100%), 1fr))')
  })

  it('a hívás-felület érintőcélja 3,5rem (56px) — a WCAG 2.5.8 minimumának duplája', () => {
    const call = css.slice(css.indexOf('.kc-team__call {'), css.indexOf('.kc-team__call:hover'))
    expect(call).toContain('min-height: 3.5rem')
  })

  it('minden önálló hivatkozás legalább 44px magas (érintőcél, UX-skill 3. pont)', () => {
    // A blokk önálló (nem mondatba ágyazott) hivatkozásai: hívás, e-mail,
    // kártya-link, harmonika-fejléc és az írásos időpontkérés.
    for (const selector of [
      '.kc-team__email',
      '.kc-team__cv-summary',
      '.kc-team__link',
      '.kc-team__booking-link',
    ]) {
      const start = css.indexOf(`${selector} {`)
      expect(start, `nincs ilyen szabály: ${selector}`).toBeGreaterThan(-1)
      const rule = css.slice(start, css.indexOf('}', start))
      expect(rule, `${selector} nem éri el a 44px-es érintőcélt`).toContain('min-height: 2.75rem')
    }
  })

  it('a hívás-felület kerete és telt állapota szerep-tokenről jön (mért AA-kontraszt)', () => {
    // Világos sávon accent-deep (fehér kártyán 5,45:1 — a nem-szöveges 3:1-es
    // küszöb fölött), telt állapotban fehér szöveggel ugyanaz az 5,45:1.
    expect(css).toContain('--kc-team-action-line: var(--kc-color-primary)')
    expect(css).toContain('--kc-team-action-on-fill: var(--kc-color-on-primary)')
    // Sötét sávon az accent-deep az inken csak 2,87:1 lenne, ezért fehérre vált.
    const dark = css.slice(css.indexOf('.kc-section--dark.kc-team {'))
    expect(dark).toContain('--kc-team-action-line: var(--kc-color-on-dark)')
    expect(dark).toContain('--kc-team-action-on-fill: var(--kc-color-surface-dark)')
  })

  it('a telefonszám nem törhet több sorba (a kártya `overflow-wrap: anywhere` ellenére)', () => {
    // Két szabály hivatkozik a számra (méret/tördelés, illetve a
    // fajsúly-erősített színöröklés) — a nowrap az elsőben él.
    const number = css.slice(css.indexOf('\n.kc-team__call-number {'))
    expect(number.slice(0, number.indexOf('}'))).toContain('white-space: nowrap')
  })

  it('a hívás-felület szabályai KÉT osztállyal íródnak (a ui.css sötét-sáv szabálya erősebb)', () => {
    /*
     * MÉRT HIBA (2026-08-16, Chromium, pixelből): egyosztályos
     * `.kc-team__call:hover` mellett a ui.css `.kc-section--dark a:hover`
     * szabálya (két osztály + pszeudo-osztály) nyert, és a szám a fehér
     * kitöltésen halvány akcentre váltott — 1,84:1, azaz AA alatt. Két
     * osztállyal a saját szabály nyer: a telt állapotban 15,63:1 a mért érték.
     */
    expect(css).toContain('.kc-team .kc-team__call {')
    expect(css).toContain('.kc-team .kc-team__call:hover {')
    expect(css).toContain('.kc-team .kc-team__call .kc-team__call-number {')
    // Egyosztályos (gyengébb) alak nem maradhat a fájlban.
    expect(css).not.toMatch(/(^|\n)\.kc-team__call:hover\s*\{/)
  })

  it('a két hívás-felület EGY vonalban áll az eltérő bemutatkozás-hossz ellenére is', () => {
    // A bejelentkezés-réteg viszi az `auto` felső margót; ha a kártya-link is
    // vinné, a flex szétosztaná a szabad helyet, és a páros elcsúszna.
    const booking = css.slice(css.indexOf('.kc-team__booking {'))
    expect(booking.slice(0, booking.indexOf('}'))).toContain('margin-top: auto')
    expect(css).toContain('.kc-team__booking ~ .kc-team__link {')
  })
})
