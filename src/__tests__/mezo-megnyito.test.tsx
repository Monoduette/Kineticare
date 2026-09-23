// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A mező-mélylink (H06, H50/B26) a közös nyitóban
 * (src/components/editor/admin/SzekcioMegnyito.tsx):
 * - a megnyitasTerv minden ága (szekció + mező, csak mező, hibás mező);
 * - a fül keresése a kliens-config mezőfájából (tabs, row, collapsible,
 *   névtelen és nevesített fül, nevesített csoport);
 * - szekción belüli mező: a sor után a mező kap görgetést, fókuszt és
 *   kiemelést; csukott belső doboznál a Payload saját gombjával nyit; ha a
 *   mező nincs a sorban, a szekció nyílik, és figyelmeztetés jön;
 * - szekció nélküli mező (Kurzusok): a Payload fülgombjával választ, a mezőt
 *   megvárja, fókuszál, kiemel; ismeretlen mezőnél magyar figyelmeztetés;
 * - a felhasználó mozdulatára az új ágon is azonnal leáll;
 * - a paraméter CSS.escape-pel kerül a szelektorba.
 *
 * A környezet happy-dom (a repó DOM-tesztjeinek közös környezete, a
 * szekcio-megnyito.test.tsx-szel azonos); az elrendezést, mint ott, a
 * `modell` objektum modellezi (görgetés, lapmagasság, elemek teteje).
 */

const navigacio = vi.hoisted(() => ({ pathname: '/admin', search: '' }))
const konfig = vi.hoisted(() => ({ collections: undefined as unknown[] | undefined }))

vi.mock('next/navigation', () => ({
  usePathname: () => navigacio.pathname,
  useSearchParams: () => new URLSearchParams(navigacio.search),
}))

vi.mock('@payloadcms/ui', () => ({
  useConfig: () => ({
    config: {
      routes: { admin: '/admin', api: '/api' },
      serverURL: '',
      collections: konfig.collections,
    },
  }),
}))

const {
  BEZARAS_FELIRAT,
  FUL_PROBA_MAX,
  KIEMELES_ATTR,
  MEZO_KIEMELES_ATTR,
  SzekcioMegnyito,
  UZENETEK,
  csukottOsok,
  fulMezoKeresese,
  gyujtemenyMezoi,
  megnyitasTerv,
  megnyitvaUzenet,
  mezoBevitelei,
  mezoCimkeje,
  mezoDoboza,
  mezoHelye,
  mezoMegnyitasa,
  ragadosSavAlja,
  szekcioMegnyitasa,
} = await import('../components/editor/admin/SzekcioMegnyito')

const HERO_ID = '6ab2d1c655cfcd3e03073521'
const SOR_CIMKE = '01 · Nyitó videó (kéznyitás)'
const FELIRAT_CIMKE = 'Beúszó szövegek a videón'
const HOW_CIMKE = 'Hogyan működik? (lépések)'
const NEZET = 900

const modell = { gorgetes: 0, lapMagassag: 6000, gorgetesZarolt: false }
const gorgetesek: Array<ScrollToOptions | undefined> = []

function teglalap(top: number, magassag: number): DOMRect {
  return {
    top,
    bottom: top + magassag,
    left: 60,
    right: 1000,
    height: magassag,
    width: 940,
    x: 60,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

/** Az elem dokumentumbeli teteje a modellben. */
function geometria(elem: Element | null, teteje: number, magassag = 200) {
  if (elem) {
    elem.getBoundingClientRect = () => teglalap(teteje - modell.gorgetes, magassag)
  }
}

function csokkentettMozgasBeallit(csokkentett: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: csokkentett && query.includes('reduce'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  })
}

beforeEach(() => {
  document.body.innerHTML = ''
  gorgetesek.length = 0
  modell.gorgetes = 0
  modell.lapMagassag = 6000
  modell.gorgetesZarolt = false
  konfig.collections = undefined
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => modell.gorgetes })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: NEZET })
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    configurable: true,
    get: () => modell.lapMagassag,
  })
  Object.defineProperty(document.documentElement, 'clientHeight', {
    configurable: true,
    get: () => NEZET,
  })
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  Object.defineProperty(window, 'scrollTo', {
    configurable: true,
    value: (opciok?: ScrollToOptions) => {
      gorgetesek.push(opciok)
      if (!modell.gorgetesZarolt) {
        const cel = opciok?.top ?? 0
        modell.gorgetes = Math.min(Math.max(0, cel), Math.max(0, modell.lapMagassag - NEZET))
      }
    },
  })
  csokkentettMozgasBeallit(true)
})

const lezarandok: Array<() => void> = []

afterEach(() => {
  for (const lezaras of lezarandok.splice(0)) {
    lezaras()
  }
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/**
 * A kezdőlap filmHero-sora a Payload szerkezetében (BlockRow + Collapsible +
 * RenderFields), benne a „Beúszó szövegek a videón” csoporttal
 * (fields/Group/index.js: id a dobozon, címke a fejlécben) és a csoportban
 * egy csukott belső dobozzal (fields/Collapsible). `feliratok: false` esetén
 * a csoport hiányzik (régi blokk, más szekció).
 */
function filmSor({ csukva = true, feliratok = true } = {}) {
  const sor = document.createElement('div')
  sor.id = 'layout-row-0'
  sor.innerHTML = `
    <div class="collapsible${csukva ? ' collapsible--collapsed' : ''}">
      <div class="collapsible__toggle-wrap">
        <button type="button" class="collapsible__toggle">Blokk kinyitása</button>
        <h4 class="kc-section-row-label">${SOR_CIMKE}</h4>
      </div>
      <div><div class="collapsible__content"><div class="render-fields">
        <div class="field-type text">
          <label class="field-label" for="field-layout__0__title">Cím<span class="required">*</span></label>
          <input id="field-layout__0__title" type="text">
        </div>
        ${
          feliratok
            ? `<div class="field-type group-field" id="field-layout__0__captions">
          <div class="group-field__wrap">
            <div class="group-field__header"><header><h3 class="group-field__title"><span class="field-label">${FELIRAT_CIMKE}</span></h3></header></div>
            <div class="render-fields">
              <div class="field-type text"><label class="field-label" for="field-layout__0__captions__midTitle">A videó közepén: cím</label><input id="field-layout__0__captions__midTitle" type="text"></div>
              <div class="field-type collapsible-field">
                <div class="collapsible collapsible--collapsed" id="belso-doboz">
                  <div class="collapsible__toggle-wrap"><button type="button" class="collapsible__toggle">Ha nincs ingyenes kurzus (ritkán kell)</button></div>
                  <div><div class="collapsible__content"><div class="render-fields">
                    <div class="field-type textarea" id="vegso-doboz"><label class="field-label" for="field-layout__0__captions__endBodyWithoutFreeSos">A videó végén: leírás ingyenes kurzus nélkül</label><textarea id="field-layout__0__captions__endBodyWithoutFreeSos"></textarea></div>
                  </div></div></div>
                </div>
              </div>
            </div>
          </div>
        </div>`
            : ''
        }
      </div></div></div>
    </div>`
  const sorGomb = sor.querySelector<HTMLButtonElement>(
    ':scope > .collapsible > .collapsible__toggle-wrap > button',
  )
  sorGomb?.addEventListener('click', () =>
    sor.querySelector(':scope > .collapsible')?.classList.toggle('collapsible--collapsed'),
  )
  const belsoGomb = sor.querySelector<HTMLButtonElement>(
    '#belso-doboz > .collapsible__toggle-wrap > button',
  )
  let belsoKattintas = 0
  belsoGomb?.addEventListener('click', () => {
    belsoKattintas += 1
    sor.querySelector('#belso-doboz')?.classList.toggle('collapsible--collapsed')
  })
  geometria(sor, 1200, 1400)
  geometria(sor.querySelector('#field-layout__0__captions'), 1600, 600)
  geometria(sor.querySelector('#vegso-doboz'), 1900, 120)
  document.body.append(sor)
  return { sor, belsoKattintasok: () => belsoKattintas }
}

const SZEKCIO_TERV = {
  tipus: 'megnyitas',
  collection: 'pages',
  id: '1',
  mezo: 'layout',
  blokkId: HERO_ID,
} as const

function lekero() {
  return vi.fn(async () => ({ id: 1, layout: [{ id: HERO_ID, blockType: 'filmHero' }] }))
}

/** A Kurzusok (products) mezőfája a kliens-configban, a src/plugins/ecommerce.ts füleivel. */
const TERMEK_MEZOK: unknown[] = [
  { name: 'courseVisibilityNotice', type: 'ui' },
  {
    type: 'tabs',
    tabs: [
      {
        label: 'Alapadatok',
        fields: [
          { name: 'displayTitle', type: 'text', label: 'Kurzus címe' },
          { type: 'row', fields: [{ name: 'sku', type: 'text', label: 'Belső azonosító' }] },
        ],
      },
      {
        label: { hu: 'Ár és hozzáférés', en: 'Price' },
        fields: [
          {
            type: 'collapsible',
            label: 'Akciós megjelenés',
            fields: [{ name: 'promoEnabled', type: 'checkbox', label: 'Akciós kurzus' }],
          },
        ],
      },
      {
        label: 'Kurzusoldal',
        fields: [
          { name: 'howItWorks', type: 'array', label: HOW_CIMKE, fields: [] },
          { name: 'seo', type: 'group', label: 'SEO', fields: [{ name: 'title', type: 'text' }] },
          {
            type: 'tabs',
            tabs: [
              { label: 'Belső A', fields: [{ name: 'belsoA', type: 'text' }] },
              { label: 'Belső B', fields: [{ name: 'belsoB', type: 'text', label: 'B mező' }] },
            ],
          },
        ],
      },
      { name: 'halado', label: 'Haladó', fields: [{ name: 'kulcs', type: 'text' }] },
    ],
  },
]

/**
 * A Kurzusok szerkesztője a Payload fülszerkezetével (fields/Tabs/index.js:
 * `.tabs-field` > `__tabs-wrap` > `__tabs` > gombok; `__content-wrap` csak az
 * aktív fül tartalmával). A fülgomb kattintásra aktív lesz, és a tartalom
 * késleltetve rajzolódik (a React újrarajzolása). A `visszaallitas` a Payload
 * aszinkron fül-visszaállítását utánozza (Tabs/index.js:156-166: a mentett
 * fülindex a csatolás UTÁN érkezik, és felülírja az addigi választást).
 */
function termekSzerkeszto({
  aktiv = 0,
  visszaallitas,
}: { aktiv?: number; visszaallitas?: { index: number; ms: number } } = {}) {
  const fulMezo = document.createElement('div')
  fulMezo.className = 'field-type tabs-field'
  const burok = document.createElement('div')
  burok.className = 'tabs-field__tabs-wrap'
  const sav = document.createElement('div')
  sav.className = 'tabs-field__tabs'
  const tartalom = document.createElement('div')
  tartalom.className = 'tabs-field__content-wrap'
  burok.append(sav)
  fulMezo.append(burok, tartalom)
  const cimkek = ['Alapadatok', 'Ár és hozzáférés', 'Kurzusoldal', 'Haladó']
  const kattintasok = cimkek.map(() => 0)
  const rajzol = (index: number) => {
    tartalom.replaceChildren()
    if (index === 2) {
      const doboz = document.createElement('div')
      doboz.className = 'field-type array-field'
      doboz.id = 'field-howItWorks'
      const fejlec = document.createElement('div')
      fejlec.className = 'array-field__header'
      const cim = document.createElement('h3')
      const cimke = document.createElement('span')
      cimke.className = 'field-label'
      cimke.textContent = HOW_CIMKE
      cim.append(cimke)
      fejlec.append(cim)
      const mezok = document.createElement('div')
      mezok.className = 'render-fields'
      const bevitel = document.createElement('input')
      bevitel.id = 'field-howItWorks__0__title'
      mezok.append(bevitel)
      doboz.append(fejlec, mezok)
      geometria(doboz, 700, 400)
      tartalom.append(doboz)
    }
  }
  const gombok = cimkek.map((felirat, index) => {
    const gomb = document.createElement('button')
    gomb.type = 'button'
    gomb.className = 'tabs-field__tab-button'
    gomb.textContent = felirat
    if (index === aktiv) {
      gomb.classList.add('tabs-field__tab-button--active')
    }
    gomb.addEventListener('click', () => {
      kattintasok[index] = (kattintasok[index] ?? 0) + 1
      for (const masik of sav.children) {
        masik.classList.remove('tabs-field__tab-button--active')
      }
      gomb.classList.add('tabs-field__tab-button--active')
      tartalom.replaceChildren()
      setTimeout(() => rajzol(index), 20)
    })
    sav.append(gomb)
    return gomb
  })
  rajzol(aktiv)
  document.body.append(fulMezo)
  if (visszaallitas) {
    setTimeout(() => {
      gombok.forEach((gomb, index) =>
        gomb.classList.toggle('tabs-field__tab-button--active', index === visszaallitas.index),
      )
      rajzol(visszaallitas.index)
    }, visszaallitas.ms)
  }
  return { fulMezo, gombok, kattintasok: () => [...kattintasok] }
}

const MEZO_TERV = {
  tipus: 'mezo-megnyitas',
  collection: 'products',
  id: '12',
  mezo: 'howItWorks',
} as const

describe('megnyitasTerv: a mező-ágak', () => {
  it('szekció + mező: a mai terv a celMezo-val', () => {
    expect(megnyitasTerv('/admin/collections/pages/1', '/admin', HERO_ID, 'captions')).toEqual({
      ...SZEKCIO_TERV,
      celMezo: 'captions',
    })
  })

  it('csak szekció: a mai terv betűre, celMezo kulcs nélkül', () => {
    const terv = megnyitasTerv('/admin/collections/pages/1', '/admin', HERO_ID)
    expect(terv).toStrictEqual(SZEKCIO_TERV)
    expect(megnyitasTerv('/admin/collections/pages/1', '/admin', HERO_ID, null)).toStrictEqual(
      SZEKCIO_TERV,
    )
  })

  it('csak mező: bármely gyűjtemény dokumentum-szerkesztőjén mezo-megnyitas', () => {
    expect(megnyitasTerv('/admin/collections/products/12', '/admin', null, 'howItWorks')).toEqual(
      MEZO_TERV,
    )
    expect(megnyitasTerv('/admin/collections/pages/1', '/admin', null, 'seo.title')).toEqual({
      tipus: 'mezo-megnyitas',
      collection: 'pages',
      id: '1',
      mezo: 'seo.title',
    })
  })

  it('hibás alakú mező: hibas-mezo (szekcióval és anélkül)', () => {
    for (const rossz of ['', 'layout.0.captions', '<img src=x onerror=alert(1)>', 'a],[b']) {
      expect(megnyitasTerv('/admin/collections/products/12', '/admin', null, rossz).tipus).toBe(
        'hibas-mezo',
      )
      expect(megnyitasTerv('/admin/collections/pages/1', '/admin', HERO_ID, rossz).tipus).toBe(
        'hibas-mezo',
      )
    }
  })

  it('a hibás szekció-azonosító elsőbbséget kap (a mai üzenet marad)', () => {
    expect(megnyitasTerv('/admin/collections/pages/1', '/admin', 'rossz', 'rossz!').tipus).toBe(
      'hibas-azonosito',
    )
  })

  it('nem dokumentum-szerkesztőn, és szekcióval szekció nélküli gyűjteményben: nincs (a mai szabály)', () => {
    expect(megnyitasTerv('/admin/collections/products', '/admin', null, 'howItWorks').tipus).toBe(
      'nincs',
    )
    expect(
      megnyitasTerv('/admin/collections/products/create', '/admin', null, 'howItWorks').tipus,
    ).toBe('nincs')
    expect(megnyitasTerv('/admin', '/admin', null, 'howItWorks').tipus).toBe('nincs')
    expect(megnyitasTerv(null, '/admin', null, 'howItWorks').tipus).toBe('nincs')
    expect(
      megnyitasTerv('/admin/collections/products/12', '/admin', HERO_ID, 'howItWorks').tipus,
    ).toBe('nincs')
    expect(megnyitasTerv('/admin/collections/products/12', '/admin', null, null).tipus).toBe(
      'nincs',
    )
  })
})

describe('mezoHelye: a fül a kliens-config mezőfájából', () => {
  it('fülön álló mező: a fül indexe, a fülek száma és a címke', () => {
    expect(mezoHelye(TERMEK_MEZOK, 'howItWorks')).toEqual({
      fulak: [{ index: 2, darab: 4, cimke: 'Kurzusoldal' }],
      cimke: HOW_CIMKE,
    })
  })

  it('sorban (row) álló mező', () => {
    expect(mezoHelye(TERMEK_MEZOK, 'sku')?.fulak).toEqual([
      { index: 0, darab: 4, cimke: 'Alapadatok' },
    ])
  })

  it('csukható dobozban (collapsible) álló mező, nyelvenkénti fülcímkével (a magyar)', () => {
    expect(mezoHelye(TERMEK_MEZOK, 'promoEnabled')).toEqual({
      fulak: [{ index: 1, darab: 4, cimke: 'Ár és hozzáférés' }],
      cimke: 'Akciós kurzus',
    })
  })

  it('nevesített csoport: az útvonal része (seo.title)', () => {
    expect(mezoHelye(TERMEK_MEZOK, 'seo.title')).toEqual({
      fulak: [{ index: 2, darab: 4, cimke: 'Kurzusoldal' }],
      cimke: null,
    })
    expect(mezoHelye(TERMEK_MEZOK, 'title')).toBeNull()
  })

  it('névtelen fülön belüli névtelen fülsor: két lépés, kívülről befelé', () => {
    expect(mezoHelye(TERMEK_MEZOK, 'belsoB')).toEqual({
      fulak: [
        { index: 2, darab: 4, cimke: 'Kurzusoldal' },
        { index: 1, darab: 2, cimke: 'Belső B' },
      ],
      cimke: 'B mező',
    })
  })

  it('nevesített fül: az útvonal része (halado.kulcs), a név nélküli útvonal nem találja', () => {
    expect(mezoHelye(TERMEK_MEZOK, 'halado.kulcs')?.fulak).toEqual([
      { index: 3, darab: 4, cimke: 'Haladó' },
    ])
    expect(mezoHelye(TERMEK_MEZOK, 'kulcs')).toBeNull()
  })

  it('fül nélküli mező: üres fül-lista; ismeretlen mező: null', () => {
    expect(mezoHelye(TERMEK_MEZOK, 'courseVisibilityNotice')).toEqual({ fulak: [], cimke: null })
    expect(mezoHelye(TERMEK_MEZOK, 'nincsIlyen')).toBeNull()
    expect(mezoHelye(TERMEK_MEZOK, 'howItWorks.title')).toBeNull()
    expect(mezoHelye([null, 'szemet', { type: 'tabs', tabs: 'nem tömb' }], 'x')).toBeNull()
  })

  it('gyujtemenyMezoi: a gyűjtemény mezőfája, vagy null (hitelesítetlen config)', () => {
    expect(gyujtemenyMezoi(undefined, 'products')).toBeNull()
    expect(gyujtemenyMezoi([{ slug: 'users', auth: {} }], 'products')).toBeNull()
    expect(gyujtemenyMezoi([{ slug: 'products' }], 'products')).toBeNull()
    expect(gyujtemenyMezoi([{ slug: 'products', fields: TERMEK_MEZOK }], 'products')).toBe(
      TERMEK_MEZOK,
    )
  })
})

describe('a mező DOM-segédei', () => {
  it('mezoDoboza: a paraméter CSS.escape-pel kerül a szelektorba', () => {
    const { sor } = filmSor()
    // A happy-dom a `CSS` globálist hozzáférésenként új példánnyal adja, ezért
    // a közös prototípus metódusát figyeljük.
    const prototipus: { escape: (ertek: string) => string } = Object.getPrototypeOf(CSS)
    const escape = vi.spyOn(prototipus, 'escape')
    expect(mezoDoboza(sor, 'layout.0.captions')?.id).toBe('field-layout__0__captions')
    expect(escape).toHaveBeenCalledWith('field-layout__0__captions')
    expect(escape).toHaveBeenCalledWith('layout.0.captions')
  })

  it('mezoDoboza: a beviteli elemen álló azonosítónál a .field-type doboz; Lexicalnál data-field-path', () => {
    const { sor } = filmSor()
    expect(mezoDoboza(sor, 'layout.0.title')?.className).toBe('field-type text')
    const lexical = document.createElement('div')
    lexical.className = 'field-type rich-text-lexical'
    lexical.setAttribute('data-field-path', 'longDescription')
    document.body.append(lexical)
    expect(mezoDoboza(document, 'longDescription')).toBe(lexical)
    expect(mezoDoboza(document, 'nincsIlyen')).toBeNull()
  })

  it('mezoCimkeje: a látható címke, a kötelező-csillag nélkül', () => {
    const { sor } = filmSor()
    const cim = mezoDoboza(sor, 'layout.0.title')
    expect(cim && mezoCimkeje(cim)).toBe('Cím')
    const csoport = mezoDoboza(sor, 'layout.0.captions')
    expect(csoport && mezoCimkeje(csoport)).toBe(FELIRAT_CIMKE)
  })

  it('csukottOsok: a csukott dobozok a határig, kívülről befelé', () => {
    const { sor } = filmSor({ csukva: true })
    const vegso = sor.querySelector('#vegso-doboz')
    expect(vegso).not.toBeNull()
    if (vegso) {
      expect(csukottOsok(vegso, sor).map((doboz) => doboz.id)).toEqual(['', 'belso-doboz'])
      expect(csukottOsok(vegso, sor.querySelector('#field-layout__0__captions'))).toEqual([
        sor.querySelector('#belso-doboz'),
      ])
    }
  })

  it('mezoBevitelei: a beviteli elem maga, vagy a doboz mezői (szerkeszthetők elöl)', () => {
    const { sor } = filmSor()
    const bevitel = sor.querySelector<HTMLElement>('#field-layout__0__captions__midTitle')
    expect(bevitel && mezoBevitelei(bevitel)).toEqual([bevitel])
    const csoport = sor.querySelector('#field-layout__0__captions')
    expect(csoport && mezoBevitelei(csoport)[0]).toBe(bevitel)
  })

  it('ragadosSavAlja: a display: contents szülőn átlép (mobilon a .doc-controls, custom.scss), a gombsor alja számít', () => {
    const cel = document.createElement('div')
    cel.getBoundingClientRect = () => teglalap(300, 200)
    const oszlop = document.createElement('div')
    const vezerlok = document.createElement('div')
    vezerlok.style.display = 'contents'
    const gombsor = document.createElement('div')
    gombsor.style.position = 'sticky'
    gombsor.style.top = '0px'
    gombsor.getBoundingClientRect = () => teglalap(0, 48)
    vezerlok.append(gombsor)
    oszlop.append(vezerlok, cel)
    document.body.append(oszlop)
    expect(ragadosSavAlja(cel, window)).toBe(48)
    // Dobozt adó szülőnél (amely a célt nem tartalmazza) a régi szabály marad.
    vezerlok.style.display = 'block'
    expect(ragadosSavAlja(cel, window)).toBe(0)
  })

  it('fulMezoKeresese: a fülsor a gombok száma és a címke szerint', () => {
    const { fulMezo } = termekSzerkeszto()
    expect(fulMezoKeresese(document, { index: 2, darab: 4, cimke: 'Kurzusoldal' })).toBe(fulMezo)
    expect(fulMezoKeresese(document, { index: 2, darab: 3, cimke: 'Kurzusoldal' })).toBeNull()
  })
})

describe('szekcioMegnyitasa: mező a szekción belül (H06)', () => {
  it('a sor után a MEZŐ kap görgetést, fókuszt és kiemelést; a sor nem kap kiemelést', async () => {
    const { sor } = filmSor()
    const eredmeny = await szekcioMegnyitasa(
      { ...SZEKCIO_TERV, celMezo: 'captions' },
      { ablak: window, lekero: lekero(), signal: new AbortController().signal },
    )
    if (eredmeny.tipus === 'megnyitva') {
      lezarandok.push(eredmeny.kiemelesVege)
    }
    expect(eredmeny.tipus).toBe('megnyitva')
    const csoport = sor.querySelector('#field-layout__0__captions')
    expect(document.activeElement?.id).toBe('field-layout__0__captions__midTitle')
    expect(csoport?.hasAttribute(MEZO_KIEMELES_ATTR)).toBe(true)
    expect(sor.hasAttribute(KIEMELES_ATTR)).toBe(false)
    expect(csoport?.getBoundingClientRect().top).toBe(24)
    if (eredmeny.tipus === 'megnyitva') {
      expect(eredmeny.cimke).toBe(SOR_CIMKE)
      expect(eredmeny.celMezo).toEqual({ allapot: 'megnyitva', cimke: FELIRAT_CIMKE })
      expect(megnyitvaUzenet(eredmeny.cimke, FELIRAT_CIMKE).szoveg).toBe(
        `Megnyitva: ${SOR_CIMKE} · ${FELIRAT_CIMKE}`,
      )
    }
  })

  it('csukott belső dobozban álló mezőt a Payload saját gombjával nyit ki', async () => {
    const { sor, belsoKattintasok } = filmSor()
    const eredmeny = await szekcioMegnyitasa(
      { ...SZEKCIO_TERV, celMezo: 'captions.endBodyWithoutFreeSos' },
      { ablak: window, lekero: lekero(), signal: new AbortController().signal },
    )
    if (eredmeny.tipus === 'megnyitva') {
      lezarandok.push(eredmeny.kiemelesVege)
    }
    expect(eredmeny.tipus).toBe('megnyitva')
    expect(belsoKattintasok()).toBe(1)
    expect(sor.querySelector('#belso-doboz')?.classList.contains('collapsible--collapsed')).toBe(
      false,
    )
    expect(document.activeElement?.id).toBe('field-layout__0__captions__endBodyWithoutFreeSos')
    expect(sor.querySelector('#vegso-doboz')?.hasAttribute(MEZO_KIEMELES_ATTR)).toBe(true)
  })

  it('ha a mező nincs a sorban: a szekció a mai módon nyílik, és az eredmény jelzi', async () => {
    const { sor } = filmSor({ feliratok: false })
    const eredmeny = await szekcioMegnyitasa(
      { ...SZEKCIO_TERV, celMezo: 'captions' },
      {
        ablak: window,
        lekero: lekero(),
        signal: new AbortController().signal,
        korIdokorlat: 100,
      },
    )
    if (eredmeny.tipus === 'megnyitva') {
      lezarandok.push(eredmeny.kiemelesVege)
    }
    expect(eredmeny.tipus).toBe('megnyitva')
    if (eredmeny.tipus === 'megnyitva') {
      expect(eredmeny.celMezo).toEqual({ allapot: 'nincs' })
      expect(eredmeny.cimke).toBe(SOR_CIMKE)
    }
    expect(document.activeElement?.id).toBe('field-layout__0__title')
    expect(sor.hasAttribute(KIEMELES_ATTR)).toBe(true)
  })

  it('a felhasználó mozdulatára a mező-szakaszban is leáll: nem görget tovább, fókuszt nem vesz el', async () => {
    const { sor } = filmSor({ csukva: false })
    // A sor a helyére kerül, a mező viszont sosem (a görgetés a sor után zárolt).
    geometria(sor.querySelector('#field-layout__0__captions'), 4000, 600)
    const eredeti = window.scrollTo
    let hivas = 0
    Object.defineProperty(window, 'scrollTo', {
      configurable: true,
      value: (opciok?: ScrollToOptions) => {
        hivas += 1
        if (hivas === 1) {
          eredeti(opciok)
          modell.gorgetesZarolt = true
        } else {
          gorgetesek.push(opciok)
        }
      },
    })
    setTimeout(() => window.dispatchEvent(new Event('wheel')), 700)
    const eredmeny = await szekcioMegnyitasa(
      { ...SZEKCIO_TERV, celMezo: 'captions' },
      { ablak: window, lekero: lekero(), signal: new AbortController().signal },
    )
    expect(eredmeny.tipus).toBe('felhasznalo-atvette')
    const szam = hivas
    await new Promise((vege) => setTimeout(vege, 300))
    expect(hivas).toBe(szam)
    expect(document.activeElement).toBe(document.body)
    expect(document.querySelectorAll(`[${MEZO_KIEMELES_ATTR}], [${KIEMELES_ATTR}]`)).toHaveLength(0)
  })
})

describe('mezoMegnyitasa: mező szekció nélkül (H50/B26, Kurzusok)', () => {
  it('a Payload fülgombjával választ, megvárja a mezőt, görget, fókuszál, kiemel', async () => {
    const szerkeszto = termekSzerkeszto()
    const eredmeny = await mezoMegnyitasa(MEZO_TERV, {
      ablak: window,
      mezok: TERMEK_MEZOK,
      signal: new AbortController().signal,
    })
    if (eredmeny.tipus === 'megnyitva') {
      lezarandok.push(eredmeny.kiemelesVege)
    }
    expect(eredmeny.tipus).toBe('megnyitva')
    expect(szerkeszto.kattintasok()).toEqual([0, 0, 1, 0])
    expect(szerkeszto.gombok[2]?.classList.contains('tabs-field__tab-button--active')).toBe(true)
    expect(document.activeElement?.id).toBe('field-howItWorks__0__title')
    const doboz = document.getElementById('field-howItWorks')
    expect(doboz?.hasAttribute(MEZO_KIEMELES_ATTR)).toBe(true)
    expect(doboz?.getBoundingClientRect().top).toBe(24)
    if (eredmeny.tipus === 'megnyitva') {
      expect(eredmeny.fulNev).toBe('Kurzusoldal')
      expect(eredmeny.mezoCimke).toBe(HOW_CIMKE)
    }
    // Mezőértéket nem írt: a beviteli elem üres maradt.
    expect(document.querySelector<HTMLInputElement>('#field-howItWorks__0__title')?.value).toBe('')
  })

  it('ha a Payload a mentett fület a kattintás UTÁN állítja vissza, a fület újra kiválasztja (mérve a helyi adminban)', async () => {
    const szerkeszto = termekSzerkeszto({ visszaallitas: { index: 3, ms: 60 } })
    const eredmeny = await mezoMegnyitasa(MEZO_TERV, {
      ablak: window,
      mezok: TERMEK_MEZOK,
      signal: new AbortController().signal,
    })
    if (eredmeny.tipus === 'megnyitva') {
      lezarandok.push(eredmeny.kiemelesVege)
    }
    expect(eredmeny.tipus).toBe('megnyitva')
    expect(szerkeszto.kattintasok()).toEqual([0, 0, 2, 0])
    expect(szerkeszto.gombok[2]?.classList.contains('tabs-field__tab-button--active')).toBe(true)
    expect(document.activeElement?.id).toBe('field-howItWorks__0__title')
    expect(FUL_PROBA_MAX).toBe(3)
  })

  it('a már aktív fület nem kattintja újra', async () => {
    const szerkeszto = termekSzerkeszto({ aktiv: 2 })
    const eredmeny = await mezoMegnyitasa(MEZO_TERV, {
      ablak: window,
      mezok: TERMEK_MEZOK,
      signal: new AbortController().signal,
    })
    if (eredmeny.tipus === 'megnyitva') {
      lezarandok.push(eredmeny.kiemelesVege)
    }
    expect(eredmeny.tipus).toBe('megnyitva')
    expect(szerkeszto.kattintasok()).toEqual([0, 0, 0, 0])
  })

  it('ismeretlen mező: mezo-nem-talalhato azonnal, a szerkesztőhöz nem nyúl', async () => {
    const szerkeszto = termekSzerkeszto()
    const eredmeny = await mezoMegnyitasa(
      { ...MEZO_TERV, mezo: 'nincsIlyen' },
      { ablak: window, mezok: TERMEK_MEZOK, signal: new AbortController().signal },
    )
    expect(eredmeny.tipus).toBe('mezo-nem-talalhato')
    expect(szerkeszto.kattintasok()).toEqual([0, 0, 0, 0])
    expect(gorgetesek).toHaveLength(0)
  })

  it('config nélkül (hitelesítetlen kliens-config) a DOM-ban keres; ha nincs, mezo-nem-talalhato', async () => {
    termekSzerkeszto({ aktiv: 2 })
    const talalt = await mezoMegnyitasa(MEZO_TERV, {
      ablak: window,
      mezok: null,
      signal: new AbortController().signal,
    })
    if (talalt.tipus === 'megnyitva') {
      lezarandok.push(talalt.kiemelesVege)
      expect(talalt.fulNev).toBeNull()
    }
    expect(talalt.tipus).toBe('megnyitva')
    const nincs = await mezoMegnyitasa(
      { ...MEZO_TERV, mezo: 'nincsIlyen' },
      { ablak: window, mezok: null, signal: new AbortController().signal, sorIdokorlat: 50 },
    )
    expect(nincs.tipus).toBe('mezo-nem-talalhato')
  })

  it('a felhasználó mozdulatára leáll: fület nem vált, fókuszt nem vesz el', async () => {
    const vezerlo = new AbortController()
    const folyamat = mezoMegnyitasa(MEZO_TERV, {
      ablak: window,
      mezok: TERMEK_MEZOK,
      signal: vezerlo.signal,
    })
    // A szerkesztő még tölt, amikor a felhasználó kattint.
    window.dispatchEvent(new Event('pointerdown'))
    const szerkeszto = termekSzerkeszto()
    expect((await folyamat).tipus).toBe('felhasznalo-atvette')
    expect(szerkeszto.kattintasok()).toEqual([0, 0, 0, 0])
    expect(document.activeElement).toBe(document.body)
  })

  it('a pozicionálás közbeni görgetésre (wheel) is leáll', async () => {
    termekSzerkeszto({ aktiv: 2 })
    modell.gorgetesZarolt = true
    geometria(document.getElementById('field-howItWorks'), 4000, 400)
    setTimeout(() => window.dispatchEvent(new Event('wheel')), 150)
    const eredmeny = await mezoMegnyitasa(MEZO_TERV, {
      ablak: window,
      mezok: TERMEK_MEZOK,
      signal: new AbortController().signal,
    })
    expect(eredmeny.tipus).toBe('felhasznalo-atvette')
    expect(document.activeElement).toBe(document.body)
    expect(document.getElementById('field-howItWorks')?.hasAttribute(MEZO_KIEMELES_ATTR)).toBe(
      false,
    )
  })

  it('csökkentett mozgásnál animáció nélkül, egyébként az első görgetés sima', async () => {
    termekSzerkeszto({ aktiv: 2 })
    const elso = await mezoMegnyitasa(MEZO_TERV, {
      ablak: window,
      mezok: TERMEK_MEZOK,
      signal: new AbortController().signal,
    })
    if (elso.tipus === 'megnyitva') {
      elso.kiemelesVege()
    }
    expect(gorgetesek.every((opciok) => opciok?.behavior === 'instant')).toBe(true)
    document.body.innerHTML = ''
    gorgetesek.length = 0
    modell.gorgetes = 0
    csokkentettMozgasBeallit(false)
    termekSzerkeszto({ aktiv: 2 })
    const masodik = await mezoMegnyitasa(MEZO_TERV, {
      ablak: window,
      mezok: TERMEK_MEZOK,
      signal: new AbortController().signal,
    })
    if (masodik.tipus === 'megnyitva') {
      lezarandok.push(masodik.kiemelesVege)
    }
    expect(gorgetesek[0]?.behavior).toBe('smooth')
  })
})

describe('a provider: a mező-ágak üzenetei az élő régióban', () => {
  let gyoker: Root | null = null
  let tarto: HTMLDivElement

  beforeEach(() => {
    tarto = document.createElement('div')
    document.body.append(tarto)
  })

  afterEach(() => {
    act(() => gyoker?.unmount())
    gyoker = null
  })

  async function renderel() {
    await act(async () => {
      gyoker = createRoot(tarto)
      gyoker.render(createElement(SzekcioMegnyito, null, createElement('p', null, 'admin')))
    })
  }

  const allapot = () => document.querySelector('.kc-szekcio-megnyito [role="status"]')
  const doboz = () => document.querySelector('.kc-szekcio-megnyito')
  const bezaroGomb = () =>
    [...document.querySelectorAll('button')].find((gomb) => gomb.textContent === BEZARAS_FELIRAT)

  async function varjAllapotra(ms = 4000) {
    const hatarido = Date.now() + ms
    while (!allapot()?.textContent && Date.now() < hatarido) {
      await act(async () => {
        await new Promise((vege) => setTimeout(vege, 50))
      })
    }
  }

  it('Kurzusok ?mezo=howItWorks: „Megnyitva: <fül> · <mezőcímke>”, felolvasva', async () => {
    konfig.collections = [{ slug: 'products', fields: TERMEK_MEZOK }]
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('A mező-ág nem kérhet le semmit')
      }),
    )
    termekSzerkeszto()
    navigacio.pathname = '/admin/collections/products/12'
    navigacio.search = 'mezo=howItWorks'
    await renderel()
    await varjAllapotra()
    expect(allapot()?.textContent).toBe(`Megnyitva: Kurzusoldal · ${HOW_CIMKE}`)
    expect(allapot()?.getAttribute('aria-atomic')).toBe('true')
    expect(doboz()?.className).toContain('kc-szekcio-megnyito--rejtett')
    expect(document.activeElement?.id).toBe('field-howItWorks__0__title')
  })

  it('ismeretlen mező: látható, bezárható, felolvasott magyar figyelmeztetés', async () => {
    konfig.collections = [{ slug: 'products', fields: TERMEK_MEZOK }]
    termekSzerkeszto()
    navigacio.pathname = '/admin/collections/products/12'
    navigacio.search = 'mezo=nincsIlyen'
    await renderel()
    await varjAllapotra()
    expect(allapot()?.getAttribute('role')).toBe('status')
    expect(allapot()?.textContent).toBe('A hivatkozott mező nem található ezen a lapon.')
    expect(UZENETEK.mezoNemTalalhato.szoveg).toBe('A hivatkozott mező nem található ezen a lapon.')
    expect(doboz()?.className).toContain('kc-szekcio-megnyito--figyelem')
    const bezaras = bezaroGomb()
    expect(bezaras).toBeDefined()
    await act(async () => {
      bezaras?.click()
    })
    expect(allapot()?.textContent).toBe('')
  })

  it('hibás alakú mező: magyar figyelmeztetés, a szerkesztőhöz nem nyúl', async () => {
    const szerkeszto = termekSzerkeszto()
    navigacio.pathname = '/admin/collections/products/12'
    navigacio.search = 'mezo=%3Cimg%20src%3Dx%3E'
    await renderel()
    await varjAllapotra()
    expect(allapot()?.textContent).toContain(UZENETEK.hibasMezo.cim)
    expect(allapot()?.textContent).toContain(UZENETEK.hibasMezo.szoveg)
    expect(allapot()?.textContent).not.toContain('<img')
    expect(szerkeszto.kattintasok()).toEqual([0, 0, 0, 0])
  })

  it('szekció + mező: „Megnyitva: <sorcímke> · <mezőcímke>”', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ id: 1, layout: [{ id: HERO_ID, blockType: 'filmHero' }] }),
      })),
    )
    filmSor()
    navigacio.pathname = '/admin/collections/pages/1'
    navigacio.search = `szekcio=${HERO_ID}&mezo=captions`
    await renderel()
    await varjAllapotra()
    expect(allapot()?.textContent).toBe(`Megnyitva: ${SOR_CIMKE} · ${FELIRAT_CIMKE}`)
    expect(document.activeElement?.id).toBe('field-layout__0__captions__midTitle')
  })

  it('szekció + a sorban nem létező mező: a szekció nyitva, látható, bezárható figyelmeztetés', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ id: 1, layout: [{ id: HERO_ID, blockType: 'filmHero' }] }),
      })),
    )
    const { sor } = filmSor({ feliratok: false })
    navigacio.pathname = '/admin/collections/pages/1'
    navigacio.search = `szekcio=${HERO_ID}&mezo=captions`
    await renderel()
    await varjAllapotra(6000)
    expect(allapot()?.textContent).toBe(
      'A hivatkozott mező nincs ebben a szekcióban. A szekciót megnyitottam.',
    )
    expect(doboz()?.className).toContain('kc-szekcio-megnyito--figyelem')
    expect(bezaroGomb()).toBeDefined()
    expect(sor.hasAttribute(KIEMELES_ATTR)).toBe(true)
    expect(document.activeElement?.id).toBe('field-layout__0__title')
  }, 10_000)
})

describe('biztonság és határok (forrás-őr, mező-ág)', () => {
  const forras = readFileSync(
    path.resolve(process.cwd(), 'src/components/editor/admin/SzekcioMegnyito.tsx'),
    'utf8',
  )

  it('a mező-paraméter csak CSS.escape-pel kerül szelektorba', () => {
    expect(forras).toMatch(/CSS\.escape\(mezoDomId\(abszolutUtvonal\)\)/)
    expect(forras).toMatch(/data-field-path="\$\{CSS\.escape\(abszolutUtvonal\)\}"/)
  })

  it('nincs innerHTML, átirányítás és értékírás; a Kurzusok konfigjához nem kell nyúlni', () => {
    expect(forras).not.toMatch(/innerHTML|dangerouslySetInnerHTML|insertAdjacentHTML/)
    expect(forras).not.toMatch(/location\s*\.\s*(href|assign|replace)|router\.(push|replace)/)
    expect(forras).not.toMatch(/setValue|dispatchFields|\.submit\(|useForm/)
    const ecommerce = readFileSync(path.resolve(process.cwd(), 'src/plugins/ecommerce.ts'), 'utf8')
    expect(ecommerce).not.toMatch(/DocumentDeepLink/)
  })
})
