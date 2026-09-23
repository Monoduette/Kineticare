// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A szekció-mélylink nyitó (src/components/editor/admin/SzekcioMegnyito.tsx)
 * tiszta logikája és DOM-lépései, a Payload szerkesztőjének szerkezetét
 * utánzó DOM-on:
 * - a paraméter ellenőrzése és az útvonal-feltétel (csak dokumentum-szerkesztőn);
 * - a sor a LEGÚJABB layout sorrendjéből (injektált lekérő), a Payload saját
 *   kinyitó gombjával kinyitva, a fókusz az első BEVITELI mezőn (nem a
 *   szekció elején álló linken);
 * - hibás, elavult és elérhetetlen eset: magyar üzenet, kivétel nélkül;
 * - csökkentett mozgásnál animáció nélküli görgetés;
 * - a Payload LUSTA rajzolása (RenderIfInViewport): görgetés közben a
 *   fölötte álló tartalom megnő, a mező csak a nézetben jelenik meg; a nyitó
 *   konvergáló ciklussal ér célba, és „Megnyitva” csak igazolt végállapotra
 *   szól (SC 4.1.3);
 * - az utókövetés csak az elrendezés-eltolódást igazítja: a bemeneti esemény
 *   nélküli idegen görgetésnél leáll, a scroll anchoring igazítását
 *   tudomásul veszi;
 * - a fókusz sikerét az activeElement igazolja: a fókuszt fel nem vevő
 *   mező után a következő jelölt, végül a sor kapja;
 * - biztonság: nincs innerHTML és nincs a paraméterre épülő átirányítás.
 *
 * A GEOMETRIA-MODELL. A happy-dom nem számol elrendezést, ezért a teszt
 * modellezi: a görgetés (`scrollY`, `scrollTo`), a lap magassága és minden
 * sor dokumentumbeli teteje a `modell` objektumban él, a sor
 * `getBoundingClientRect`-je ebből számol (teteje − görgetés).
 */

const navigacio = vi.hoisted(() => ({ pathname: '/admin', search: '' }))

vi.mock('next/navigation', () => ({
  usePathname: () => navigacio.pathname,
  useSearchParams: () => new URLSearchParams(navigacio.search),
}))

vi.mock('@payloadcms/ui', () => ({
  useConfig: () => ({ config: { routes: { admin: '/admin', api: '/api' }, serverURL: '' } }),
}))

const {
  BEZARAS_FELIRAT,
  FOKUSZ_JELOLTEK_MAX,
  KIEMELES_ATTR,
  MIN_RES_PX,
  SzekcioMegnyito,
  UZENETEK,
  beviteliMezok,
  elsoBeviteliMezo,
  gorgetesCel,
  megnyitasTerv,
  megnyitvaUzenet,
  ragadosSavAlja,
  sorCimke,
  sorCsukva,
  sorHelyzete,
  szekcioMegnyitasa,
  tartalomKirajzolva,
} = await import('../components/editor/admin/SzekcioMegnyito')

const HERO_ID = '6ab2d1c655cfcd3e03073521'
const MASIK_ID = '6ab2d1c655cfcd3e03073525'
const CIMKE = '01 · Nyitó videó (kéznyitás): Hatékony és biztonságos módszerek'

/** A nézetablak magassága a modellben (px). */
const NEZET = 900

/**
 * Az elrendezés modellje. `gorgetes` a `window.scrollY`, `lapMagassag` a
 * `scrollHeight`; `gorgetesZarolt` mellett a `scrollTo` nem mozdít (a sor
 * sosem kerül a nézetbe); `gorgetesUtan` a görgetés utáni mellékhatás (pl. a
 * fölötte álló sorok kinövése).
 */
const modell = {
  gorgetes: 0,
  lapMagassag: 5000,
  gorgetesZarolt: false,
  gorgetesUtan: null as ((hanyadik: number) => void) | null,
}

const gorgetesek: Array<ScrollToOptions | undefined> = []

function teglalap(top: number, magassag: number, left = 60, right = 1000): DOMRect {
  return {
    top,
    bottom: top + magassag,
    left,
    right,
    height: magassag,
    width: right - left,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

/** A sor a modellben: a dokumentumbeli teteje (függvény, mert változhat) és magassága. */
function geometria(sor: HTMLElement, teteje: () => number, magassag = 400) {
  sor.getBoundingClientRect = () => teglalap(teteje() - modell.gorgetes, magassag)
}

/** A Payload RenderIfInViewport szabálya: a nézet 1000 px-es környezetében vagy fölötte. */
function nezetkozelben(sor: Element): boolean {
  const { top, bottom } = sor.getBoundingClientRect()
  return top < 0 || (top < NEZET + 1000 && bottom > -1000)
}

/**
 * A Payload Blocks-sorának szerkezete (BlockRow.js + Collapsible +
 * RenderFields), a B2 sorcímkéjével és a szekció elején álló linkekkel.
 * Kinyitáskor a mezők késleltetve jelennek meg (RenderIfInViewport).
 * A sor dokumentumbeli teteje alapból 200 + index × 600 px.
 */
function sortEpit(
  index: number,
  {
    csukva = true,
    cimke = CIMKE,
    teteje = () => 200 + index * 600,
    mezoNelkul = false,
    lusta = false,
  }: {
    csukva?: boolean
    cimke?: string
    teteje?: () => number
    mezoNelkul?: boolean
    /** A mezőket sem a kinyitás, sem a nyitott állapot nem rajzolja: csak `mezoketRajzol()`. */
    lusta?: boolean
  } = {},
) {
  const sor = document.createElement('div')
  sor.id = `layout-row-${String(index)}`
  geometria(sor, teteje)
  const dobozElem = document.createElement('div')
  dobozElem.className = csukva ? 'collapsible collapsible--collapsed' : 'collapsible'
  const fejlec = document.createElement('div')
  fejlec.className = 'collapsible__toggle-wrap'
  const gomb = document.createElement('button')
  gomb.type = 'button'
  gomb.className = 'collapsible__toggle'
  gomb.textContent = 'Blokk kinyitása'
  const cimkeElem = document.createElement('h4')
  cimkeElem.className = 'kc-section-row-label row-label'
  cimkeElem.textContent = cimke
  const nevMezo = document.createElement('input')
  nevMezo.className = 'section-title__input'
  fejlec.append(gomb, cimkeElem, nevMezo)
  const tartalomHely = document.createElement('div')
  const tartalom = document.createElement('div')
  tartalom.className = 'collapsible__content'
  const mezoDoboz = document.createElement('div')
  mezoDoboz.className = 'render-fields blocks-field__fields'
  tartalom.append(mezoDoboz)
  tartalomHely.append(tartalom)
  dobozElem.append(fejlec, tartalomHely)
  sor.append(dobozElem)

  let kirajzolva = false
  const mezoketRajzol = () => {
    if (kirajzolva) {
      return
    }
    kirajzolva = true
    const link = document.createElement('a')
    link.href = '/'
    link.textContent = 'Megnézem az oldalon (új lapon)'
    mezoDoboz.append(link)
    if (mezoNelkul) {
      return
    }
    const rejtett = document.createElement('input')
    rejtett.type = 'hidden'
    const cim = document.createElement('input')
    cim.id = `field-layout__${String(index)}__title`
    const leiras = document.createElement('textarea')
    mezoDoboz.append(rejtett, cim, leiras)
  }
  let kattintas = 0
  gomb.addEventListener('click', () => {
    kattintas += 1
    dobozElem.classList.toggle('collapsible--collapsed')
    if (!lusta) {
      setTimeout(mezoketRajzol, 20)
    }
  })
  if (!csukva && !lusta) {
    mezoketRajzol()
  }
  return { sor, gomb, kattintasok: () => kattintas, mezoketRajzol }
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

let lathatosag: DocumentVisibilityState = 'visible'

beforeEach(() => {
  document.body.innerHTML = ''
  gorgetesek.length = 0
  modell.gorgetes = 0
  modell.lapMagassag = 5000
  modell.gorgetesZarolt = false
  modell.gorgetesUtan = null
  lathatosag = 'visible'
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
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => lathatosag,
  })
  Object.defineProperty(window, 'scrollTo', {
    configurable: true,
    value: (opciok?: ScrollToOptions) => {
      gorgetesek.push(opciok)
      if (!modell.gorgetesZarolt) {
        const cel = opciok?.top ?? 0
        modell.gorgetes = Math.min(Math.max(0, cel), Math.max(0, modell.lapMagassag - NEZET))
      }
      modell.gorgetesUtan?.(gorgetesek.length)
    },
  })
  csokkentettMozgasBeallit(true)
})

/** A sikeres megnyitások lezárói: a teszt végén leállítják az utókövetést és a kiemelést. */
const lezarandok: Array<() => void> = []

/** szekcioMegnyitasa, amelynek sikeres eredményét a teszt végén lezárjuk. */
async function megnyit(...args: Parameters<typeof szekcioMegnyitasa>) {
  const eredmeny = await szekcioMegnyitasa(...args)
  if (eredmeny.tipus === 'megnyitva') {
    lezarandok.push(eredmeny.kiemelesVege)
  }
  return eredmeny
}

afterEach(() => {
  for (const lezaras of lezarandok.splice(0)) {
    lezaras()
  }
  vi.unstubAllGlobals()
})

const TERV = {
  tipus: 'megnyitas',
  collection: 'pages',
  id: '1',
  mezo: 'layout',
  blokkId: HERO_ID,
} as const

describe('megnyitasTerv: csak dokumentum-szerkesztőn és érvényes azonosítóval', () => {
  it('a kezdőlap szerkesztőjén érvényes azonosítóval megnyit', () => {
    expect(megnyitasTerv('/admin/collections/pages/1', '/admin', HERO_ID)).toEqual(TERV)
  })

  it('paraméter nélkül, más útvonalon és szekció nélküli gyűjteményben nem fut', () => {
    expect(megnyitasTerv('/admin/collections/pages/1', '/admin', null).tipus).toBe('nincs')
    expect(megnyitasTerv('/admin', '/admin', HERO_ID).tipus).toBe('nincs')
    expect(megnyitasTerv('/admin/collections/pages', '/admin', HERO_ID).tipus).toBe('nincs')
    expect(megnyitasTerv('/admin/collections/pages/create', '/admin', HERO_ID).tipus).toBe('nincs')
    expect(megnyitasTerv('/admin/collections/media/1', '/admin', HERO_ID).tipus).toBe('nincs')
    expect(megnyitasTerv(null, '/admin', HERO_ID).tipus).toBe('nincs')
  })

  it.each(['abc', '<img src=x onerror=alert(1)>', 'https://pelda.hu', `${HERO_ID}x`])(
    'hibás alakú azonosító: %s',
    (ertek) => {
      expect(megnyitasTerv('/admin/collections/pages/1', '/admin', ertek).tipus).toBe(
        'hibas-azonosito',
      )
    },
  )
})

describe('a sor DOM-segédei', () => {
  it('a sorcímke a B2 címkéjéből, nélküle a Payload alapfejlécéből, végül a sorszámból', () => {
    const { sor } = sortEpit(0)
    expect(sorCimke(sor, 0)).toBe(CIMKE)
    const alap = document.createElement('div')
    alap.innerHTML =
      '<span class="blocks-field__block-number">03</span><span class="blocks-field__block-pill">Szolgáltatás-sorok</span>'
    expect(sorCimke(alap, 2)).toBe('03 · Szolgáltatás-sorok')
    expect(sorCimke(document.createElement('div'), 6)).toBe('07. szekció')
  })

  it('az első BEVITELI mező a sor tartalmában: nem a link, nem a rejtett és nem a fejléc mezője', () => {
    const { sor } = sortEpit(0, { csukva: false })
    expect(elsoBeviteliMezo(sor)?.id).toBe('field-layout__0__title')
  })

  it('csak olvasható mezőnél is ad célt (az első mezőt)', () => {
    const { sor } = sortEpit(0, { csukva: false })
    for (const mezo of sor.querySelectorAll('.collapsible__content input, textarea')) {
      mezo.setAttribute('readonly', '')
    }
    expect(elsoBeviteliMezo(sor)?.id).toBe('field-layout__0__title')
  })

  it('a jelöltek sorrendje: elöl a szerkeszthetők, utánuk a csak olvashatók; az első jelölt az elsoBeviteliMezo', () => {
    const { sor } = sortEpit(0, { csukva: false })
    const cim = sor.querySelector('#field-layout__0__title')
    const leiras = sor.querySelector('.collapsible__content textarea')
    expect(beviteliMezok(sor)).toEqual([cim, leiras])
    cim?.setAttribute('readonly', '')
    expect(beviteliMezok(sor)).toEqual([leiras, cim])
    expect(elsoBeviteliMezo(sor)).toBe(leiras)
    expect(beviteliMezok(document.createElement('div'))).toEqual([])
  })

  it('a csukott állapotot a Payload osztályából olvassa', () => {
    expect(sorCsukva(sortEpit(0).sor)).toBe(true)
    expect(sorCsukva(sortEpit(1, { csukva: false }).sor)).toBe(false)
  })

  it('a görgetési cél a ragadós sáv alja + 24 px, sosem negatív', () => {
    expect(gorgetesCel(1000, 400, 56)).toBe(1320)
    expect(gorgetesCel(0, 30, 56)).toBe(0)
  })

  it('a ragadós sáv alját a beragadt helyzetből számolja, a sort tartalmazó és a keskeny oldalsávot kihagyja', () => {
    const { sor } = sortEpit(0, { csukva: false })
    const sav = document.createElement('div')
    sav.style.position = 'sticky'
    sav.style.top = '0px'
    const oldalsav = document.createElement('div')
    oldalsav.style.position = 'sticky'
    oldalsav.style.top = '56px'
    document.body.append(sav, oldalsav, sor)
    const doboz = (top: number, bottom: number, left: number, right: number) => () =>
      ({ top, bottom, left, right, height: bottom - top, width: right - left }) as DOMRect
    sav.getBoundingClientRect = doboz(300, 356, 0, 1600)
    oldalsav.getBoundingClientRect = doboz(356, 1200, 1100, 1600)
    sor.getBoundingClientRect = doboz(500, 600, 60, 1000)
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })
    expect(ragadosSavAlja(sor, window)).toBe(56)
  })

  it('egy MÁSIK szekció ragadós eszköztára nem számít: a ragadós elem csak a szülőjén belül ragad', () => {
    const cel = sortEpit(1, { csukva: false }).sor
    const masik = sortEpit(0, { csukva: false }).sor
    const eszkoztar = document.createElement('div')
    eszkoztar.style.position = 'sticky'
    eszkoztar.style.top = '56px'
    masik.querySelector('.render-fields')?.append(eszkoztar)
    eszkoztar.getBoundingClientRect = () => teglalap(-300, 40)
    document.body.append(masik, cel)
    expect(ragadosSavAlja(cel, window)).toBe(0)
    // A saját szekcióján belül (a szülője a célt is tartalmazza) továbbra is számít.
    const sajatMezo = masik.querySelector('textarea')
    expect(sajatMezo).not.toBeNull()
    if (sajatMezo) {
      sajatMezo.getBoundingClientRect = () => teglalap(300, 60)
      expect(ragadosSavAlja(sajatMezo, window)).toBe(96)
    }
  })

  it('a sor helyzete: célhelyzet a ragadós sáv alatt, a lap aljára szorítva', () => {
    const { sor } = sortEpit(0, { csukva: false, teteje: () => 1000 })
    document.body.append(sor)
    expect(sorHelyzete(sor, window, 56)).toMatchObject({
      teteje: 1000,
      cel: 920,
      helyen: false,
      latszik: false,
    })
    modell.gorgetes = 920
    expect(sorHelyzete(sor, window, 56)).toMatchObject({ teteje: 80, helyen: true, latszik: true })
    // Az utolsó sor: a lap nem görgethető tovább, a sor lejjebb marad, de helyén van.
    const { sor: utolso } = sortEpit(1, { csukva: false, teteje: () => 4800 })
    document.body.append(utolso)
    modell.gorgetes = modell.lapMagassag - NEZET
    expect(sorHelyzete(utolso, window, 56)).toMatchObject({
      teteje: 700,
      cel: 4100,
      helyen: true,
      latszik: true,
    })
    // A ragadós sáv mögött álló sor nem „látszik” (SC 2.4.11).
    modell.gorgetes = 950
    expect(sorHelyzete(sor, window, 56).latszik).toBe(false)
  })

  it('a mezők kirajzolását a Payload .render-fields dobozából olvassa', () => {
    const csukott = sortEpit(0)
    expect(tartalomKirajzolva(csukott.sor)).toBe(false)
    csukott.mezoketRajzol()
    expect(tartalomKirajzolva(csukott.sor)).toBe(true)
    const tolt = sortEpit(1, { csukva: false })
    const shimmer = document.createElement('div')
    shimmer.className = 'shimmer-effect'
    tolt.sor.querySelector('.collapsible__content')?.append(shimmer)
    expect(tartalomKirajzolva(tolt.sor)).toBe(false)
  })
})

describe('szekcioMegnyitasa: a teljes lépéssor', () => {
  function lekero(layout: unknown[]) {
    return vi.fn(async () => ({ id: 1, layout }))
  }

  it('a legújabb layoutból indexel, kinyit, a fókuszt az első mezőre teszi, kiemel', async () => {
    const elso = sortEpit(0, { csukva: false, cimke: '01 · Hitel-csík' })
    const cel = sortEpit(1)
    document.body.append(elso.sor, cel.sor)
    const lekeres = lekero([
      { id: MASIK_ID, blockType: 'credsStrip' },
      { id: HERO_ID, blockType: 'filmHero' },
    ])
    const eredmeny = await megnyit(TERV, {
      ablak: window,
      lekero: lekeres,
      signal: new AbortController().signal,
    })
    expect(lekeres).toHaveBeenCalledWith('pages', '1', expect.any(AbortSignal))
    expect(eredmeny.tipus).toBe('megnyitva')
    expect(cel.kattintasok()).toBe(1)
    expect(sorCsukva(cel.sor)).toBe(false)
    expect(document.activeElement?.id).toBe('field-layout__1__title')
    expect(cel.sor.hasAttribute(KIEMELES_ATTR)).toBe(true)
    expect(elso.kattintasok()).toBe(0)
    if (eredmeny.tipus === 'megnyitva') {
      expect(eredmeny.cimke).toBe(CIMKE)
      expect(megnyitvaUzenet(eredmeny.cimke).szoveg).toBe(`Megnyitva: ${CIMKE}`)
    }
  })

  it('a már nyitott sort nem csukja be', async () => {
    const cel = sortEpit(0, { csukva: false })
    document.body.append(cel.sor)
    const eredmeny = await megnyit(TERV, {
      ablak: window,
      lekero: lekero([{ id: HERO_ID, blockType: 'filmHero' }]),
      signal: new AbortController().signal,
    })
    expect(eredmeny.tipus).toBe('megnyitva')
    expect(cel.kattintasok()).toBe(0)
    expect(document.activeElement?.id).toBe('field-layout__0__title')
  })

  it('a sort a megjelenéséig várja (a szerkesztő később rajzol)', async () => {
    const cel = sortEpit(0)
    setTimeout(() => document.body.append(cel.sor), 30)
    const eredmeny = await megnyit(TERV, {
      ablak: window,
      lekero: lekero([{ id: HERO_ID, blockType: 'filmHero' }]),
      signal: new AbortController().signal,
    })
    expect(eredmeny.tipus).toBe('megnyitva')
  })

  it('csökkentett mozgásnál animáció nélkül görget, egyébként simán', async () => {
    document.body.append(sortEpit(0).sor)
    await megnyit(TERV, {
      ablak: window,
      lekero: lekero([{ id: HERO_ID, blockType: 'filmHero' }]),
      signal: new AbortController().signal,
    })
    expect(gorgetesek.length).toBeGreaterThan(0)
    expect(gorgetesek.every((opciok) => opciok?.behavior === 'instant')).toBe(true)

    document.body.innerHTML = ''
    gorgetesek.length = 0
    modell.gorgetes = 0
    csokkentettMozgasBeallit(false)
    document.body.append(sortEpit(0).sor)
    await megnyit(TERV, {
      ablak: window,
      lekero: lekero([{ id: HERO_ID, blockType: 'filmHero' }]),
      signal: new AbortController().signal,
    })
    expect(gorgetesek[0]?.behavior).toBe('smooth')
  })

  it('a kiemelés megszűnik, ha a felhasználó a szekción kívülre kattint', async () => {
    const cel = sortEpit(0)
    const kint = document.createElement('button')
    document.body.append(cel.sor, kint)
    await megnyit(TERV, {
      ablak: window,
      lekero: lekero([{ id: HERO_ID, blockType: 'filmHero' }]),
      signal: new AbortController().signal,
    })
    cel.sor.querySelector('textarea')?.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(cel.sor.hasAttribute(KIEMELES_ATTR)).toBe(true)
    kint.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(cel.sor.hasAttribute(KIEMELES_ATTR)).toBe(false)
  })

  it('elavult azonosító: „elavult”, és a szerkesztőhöz nem nyúl', async () => {
    const cel = sortEpit(0)
    document.body.append(cel.sor)
    const eredmeny = await megnyit(TERV, {
      ablak: window,
      lekero: lekero([{ id: MASIK_ID, blockType: 'credsStrip' }]),
      signal: new AbortController().signal,
    })
    expect(eredmeny.tipus).toBe('elavult')
    expect(cel.kattintasok()).toBe(0)
    expect(gorgetesek).toHaveLength(0)
  })

  it('lekérési hiba és hiányzó sor: „nem-sikerult”, kivétel nélkül', async () => {
    const hibas = await megnyit(TERV, {
      ablak: window,
      lekero: async () => {
        throw new Error('HTTP 500')
      },
      signal: new AbortController().signal,
    })
    expect(hibas.tipus).toBe('nem-sikerult')
    const nincsSor = await megnyit(TERV, {
      ablak: window,
      lekero: lekero([{ id: HERO_ID, blockType: 'filmHero' }]),
      signal: new AbortController().signal,
      sorIdokorlat: 30,
    })
    expect(nincsSor.tipus).toBe('nem-sikerult')
  })

  it('megszakításnál (navigáció) nem nyúl a DOM-hoz', async () => {
    const cel = sortEpit(0)
    const vezerlo = new AbortController()
    const folyamat = megnyit(TERV, {
      ablak: window,
      lekero: lekero([{ id: HERO_ID, blockType: 'filmHero' }]),
      signal: vezerlo.signal,
    })
    vezerlo.abort()
    document.body.append(cel.sor)
    expect((await folyamat).tipus).toBe('megszakitva')
    expect(cel.kattintasok()).toBe(0)
  })

  it('LUSTA RAJZOLÁS: a fölötte álló tartalom kinő, a mező csak a nézetben jelenik meg, a nyitó több körben mégis célba ér', async () => {
    // A 11. sor esete (mérve 1440×900-on): a sor 4000 px-en indul; az első
    // görgetés közben a fölötte álló sorok 3000 px-szel nőnek, a korrekció
    // után a nézet környezetében állók még 1200 px-szel.
    csokkentettMozgasBeallit(false)
    const fok = { teteje: 4000 }
    modell.lapMagassag = 12_000
    // Csukott sor, a mezők csak a nézet környezetében rajzolódnak ki.
    const cel = sortEpit(11, { teteje: () => fok.teteje, lusta: true })
    document.body.append(cel.sor)
    modell.gorgetesUtan = (hanyadik) => {
      if (hanyadik === 1) {
        fok.teteje += 3000
      }
      if (hanyadik === 2) {
        setTimeout(() => {
          fok.teteje += 1200
        }, 40)
      }
      setTimeout(() => {
        if (nezetkozelben(cel.sor)) {
          cel.mezoketRajzol()
        }
      }, 20)
    }
    const eredmeny = await megnyit(
      { ...TERV },
      {
        ablak: window,
        lekero: lekero([...Array.from({ length: 11 }, () => ({ id: MASIK_ID })), { id: HERO_ID }]),
        signal: new AbortController().signal,
      },
    )
    expect(eredmeny.tipus).toBe('megnyitva')
    expect(gorgetesek.length).toBeGreaterThanOrEqual(2)
    expect(gorgetesek[0]?.behavior).toBe('smooth')
    expect(gorgetesek.slice(1).every((opciok) => opciok?.behavior === 'instant')).toBe(true)
    expect(cel.kattintasok()).toBe(1)
    expect(sorCsukva(cel.sor)).toBe(false)
    expect(document.activeElement?.id).toBe('field-layout__11__title')
    const teteje = cel.sor.getBoundingClientRect().top
    expect(teteje).toBeGreaterThanOrEqual(MIN_RES_PX)
    expect(teteje).toBeLessThan(NEZET / 2)
    expect(cel.sor.hasAttribute(KIEMELES_ATTR)).toBe(true)
  }, 10_000)

  it('ha a sor SOSEM kerül a nézetbe: „nem-sikerult”, fókusz és kiemelés nélkül', async () => {
    modell.lapMagassag = 8000
    modell.gorgetesZarolt = true
    const cel = sortEpit(0, { csukva: false, teteje: () => 5000 })
    document.body.append(cel.sor)
    const eredmeny = await megnyit(TERV, {
      ablak: window,
      lekero: lekero([{ id: HERO_ID }]),
      signal: new AbortController().signal,
      pozicioIdokorlat: 700,
    })
    expect(eredmeny.tipus).toBe('nem-sikerult')
    expect(gorgetesek.length).toBeGreaterThanOrEqual(2)
    expect(document.activeElement).toBe(document.body)
    expect(cel.sor.hasAttribute(KIEMELES_ATTR)).toBe(false)
  })

  it('ha a sor látszik, de nincs benne beviteli mező: a fókusz magára a sorra kerül (tabindex="-1")', async () => {
    const cel = sortEpit(0, { csukva: false, mezoNelkul: true })
    const kint = document.createElement('input')
    document.body.append(cel.sor, kint)
    const eredmeny = await megnyit(TERV, {
      ablak: window,
      lekero: lekero([{ id: HERO_ID }]),
      signal: new AbortController().signal,
      korIdokorlat: 150,
    })
    expect(eredmeny.tipus).toBe('megnyitva')
    if (eredmeny.tipus === 'megnyitva') {
      expect(eredmeny.mezo).toBeNull()
      expect(eredmeny.cimke).toBe(CIMKE)
    }
    expect(document.activeElement).toBe(cel.sor)
    expect(cel.sor.getAttribute('tabindex')).toBe('-1')
    expect(cel.sor.hasAttribute(KIEMELES_ATTR)).toBe(true)
    // A sor elhagyásakor a tabindex és a kiemelés lekerül.
    kint.focus()
    expect(cel.sor.hasAttribute('tabindex')).toBe(false)
    expect(cel.sor.hasAttribute(KIEMELES_ATTR)).toBe(false)
  })

  it('ha a felhasználó közben görget, a nyitó abbahagyja: nem görget tovább és a fókuszt nem veszi el', async () => {
    modell.lapMagassag = 8000
    modell.gorgetesZarolt = true
    const cel = sortEpit(0, { csukva: false, teteje: () => 5000 })
    document.body.append(cel.sor)
    setTimeout(() => window.dispatchEvent(new Event('wheel')), 150)
    const eredmeny = await megnyit(TERV, {
      ablak: window,
      lekero: lekero([{ id: HERO_ID }]),
      signal: new AbortController().signal,
    })
    expect(eredmeny.tipus).toBe('felhasznalo-atvette')
    const gorgetesekSzama = gorgetesek.length
    await new Promise((vege) => setTimeout(vege, 300))
    expect(gorgetesek.length).toBe(gorgetesekSzama)
    expect(document.activeElement).toBe(document.body)
    expect(cel.sor.hasAttribute(KIEMELES_ATTR)).toBe(false)
  })

  it('UTÓKÖVETÉS: ha a siker után a fölötte álló tartalom még változik, a sort visszaigazítja', async () => {
    const fok = { teteje: 1400 }
    const cel = sortEpit(1, { csukva: false, teteje: () => fok.teteje })
    document.body.append(cel.sor)
    const eredmeny = await megnyit(TERV, {
      ablak: window,
      lekero: lekero([{ id: MASIK_ID }, { id: HERO_ID }]),
      signal: new AbortController().signal,
    })
    expect(eredmeny.tipus).toBe('megnyitva')
    expect(cel.sor.getBoundingClientRect().top).toBe(24)
    const elotte = gorgetesek.length
    // A fölötte álló képmező előnézete betöltődik: a lap 45 px-szel rövidül.
    fok.teteje -= 45
    expect(cel.sor.getBoundingClientRect().top).toBe(-21)
    await new Promise((vege) => setTimeout(vege, 500))
    expect(gorgetesek.length).toBeGreaterThan(elotte)
    expect(gorgetesek.at(-1)?.behavior).toBe('instant')
    expect(cel.sor.getBoundingClientRect().top).toBe(24)
    expect(document.activeElement?.id).toBe('field-layout__1__title')
  })

  it('UTÓKÖVETÉS: a felhasználó mozdulata vagy a lezárás után nem görget', async () => {
    const fok = { teteje: 1400 }
    const cel = sortEpit(1, { csukva: false, teteje: () => fok.teteje })
    document.body.append(cel.sor)
    const eredmeny = await megnyit(TERV, {
      ablak: window,
      lekero: lekero([{ id: MASIK_ID }, { id: HERO_ID }]),
      signal: new AbortController().signal,
    })
    expect(eredmeny.tipus).toBe('megnyitva')
    window.dispatchEvent(new Event('keydown'))
    const elotte = gorgetesek.length
    fok.teteje -= 45
    await new Promise((vege) => setTimeout(vege, 500))
    expect(gorgetesek.length).toBe(elotte)

    // Új megnyitás, majd a provider lezárja (navigáció): utána sem görget.
    document.body.innerHTML = ''
    modell.gorgetes = 0
    fok.teteje = 1400
    document.body.append(cel.sor)
    const masodik = await szekcioMegnyitasa(TERV, {
      ablak: window,
      lekero: lekero([{ id: MASIK_ID }, { id: HERO_ID }]),
      signal: new AbortController().signal,
    })
    expect(masodik.tipus).toBe('megnyitva')
    if (masodik.tipus === 'megnyitva') {
      masodik.kiemelesVege()
    }
    expect(cel.sor.hasAttribute(KIEMELES_ATTR)).toBe(false)
    const lezaraskor = gorgetesek.length
    fok.teteje -= 45
    await new Promise((vege) => setTimeout(vege, 500))
    expect(gorgetesek.length).toBe(lezaraskor)
  })

  it('UTÓKÖVETÉS: a bemeneti esemény nélküli idegen görgetést (pl. képernyőolvasó) nem rántja vissza, és utána leáll', async () => {
    const fok = { teteje: 1400 }
    const cel = sortEpit(1, { csukva: false, teteje: () => fok.teteje })
    document.body.append(cel.sor)
    const eredmeny = await megnyit(TERV, {
      ablak: window,
      lekero: lekero([{ id: MASIK_ID }, { id: HERO_ID }]),
      signal: new AbortController().signal,
    })
    expect(eredmeny.tipus).toBe('megnyitva')
    expect(cel.sor.getBoundingClientRect().top).toBe(24)
    const elotte = gorgetesek.length
    const sikerkor = modell.gorgetes
    // Görgetés wheel, keydown, pointerdown és touchstart nélkül.
    modell.gorgetes += 700
    await new Promise((vege) => setTimeout(vege, 500))
    expect(gorgetesek.length).toBe(elotte)
    expect(modell.gorgetes).toBe(sikerkor + 700)
    // Az utókövetés leállt: egy ezutáni elrendezés-eltolódást sem igazít.
    fok.teteje -= 45
    await new Promise((vege) => setTimeout(vege, 500))
    expect(gorgetesek.length).toBe(elotte)
    expect(modell.gorgetes).toBe(sikerkor + 700)
    expect(document.activeElement?.id).toBe('field-layout__1__title')
  })

  it('UTÓKÖVETÉS: a scroll anchoring igazítását (a görgetés változik, a sor a nézetben helyben marad) tudomásul veszi, a későbbi eltolódást igazítja', async () => {
    const fok = { teteje: 1400 }
    const cel = sortEpit(1, { csukva: false, teteje: () => fok.teteje })
    document.body.append(cel.sor)
    const eredmeny = await megnyit(TERV, {
      ablak: window,
      lekero: lekero([{ id: MASIK_ID }, { id: HERO_ID }]),
      signal: new AbortController().signal,
    })
    expect(eredmeny.tipus).toBe('megnyitva')
    const elotte = gorgetesek.length
    // A fölötte, a nézeten kívül álló tartalom 45 px-szel rövidül, és a
    // böngésző a görgetést ugyanennyivel kiegyenlíti.
    modell.gorgetes -= 45
    fok.teteje -= 45
    expect(cel.sor.getBoundingClientRect().top).toBe(24)
    await new Promise((vege) => setTimeout(vege, 500))
    expect(gorgetesek.length).toBe(elotte)
    // Utána valódi elrendezés-eltolódás: a görgetés marad, a sor elmozdul.
    fok.teteje -= 30
    expect(cel.sor.getBoundingClientRect().top).toBe(-6)
    await new Promise((vege) => setTimeout(vege, 500))
    expect(gorgetesek.length).toBeGreaterThan(elotte)
    expect(gorgetesek.at(-1)?.behavior).toBe('instant')
    expect(cel.sor.getBoundingClientRect().top).toBe(24)
    expect(document.activeElement?.id).toBe('field-layout__1__title')
  })

  it('FÓKUSZ-TARTALÉK: ha az első mező nem veszi fel a fókuszt (pl. becsukott belső sor), a következő jelölt kapja', async () => {
    const cel = sortEpit(0, { csukva: false })
    document.body.append(cel.sor)
    const cim = cel.sor.querySelector<HTMLInputElement>('#field-layout__0__title')
    const leiras = cel.sor.querySelector('.collapsible__content textarea')
    expect(cim).not.toBeNull()
    expect(leiras).not.toBeNull()
    if (cim) {
      // A display: none mező focus() hívása nem mozdítja a fókuszt.
      cim.focus = () => undefined
    }
    const eredmeny = await megnyit(TERV, {
      ablak: window,
      lekero: lekero([{ id: HERO_ID }]),
      signal: new AbortController().signal,
    })
    expect(eredmeny.tipus).toBe('megnyitva')
    expect(document.activeElement).toBe(leiras)
    if (eredmeny.tipus === 'megnyitva') {
      expect(eredmeny.mezo).toBe(leiras)
    }
    expect(cel.sor.hasAttribute('tabindex')).toBe(false)
    expect(cel.sor.hasAttribute(KIEMELES_ATTR)).toBe(true)
  })

  it('FÓKUSZ-TARTALÉK: ha egyik jelölt sem veszi fel a fókuszt, a sor kapja (tabindex="-1", mezo: null), és legfeljebb FOKUSZ_JELOLTEK_MAX mezőt próbál', async () => {
    const cel = sortEpit(0, { csukva: false })
    const mezoDoboz = cel.sor.querySelector('.render-fields')
    for (let i = 0; i < 10; i += 1) {
      mezoDoboz?.append(document.createElement('input'))
    }
    document.body.append(cel.sor)
    const mezok = [
      ...cel.sor.querySelectorAll<HTMLElement>(
        '.collapsible__content input:not([type="hidden"]), .collapsible__content textarea',
      ),
    ]
    expect(mezok).toHaveLength(12)
    let probak = 0
    for (const mezo of mezok) {
      mezo.focus = () => {
        probak += 1
      }
    }
    const eredmeny = await megnyit(TERV, {
      ablak: window,
      lekero: lekero([{ id: HERO_ID }]),
      signal: new AbortController().signal,
    })
    expect(eredmeny.tipus).toBe('megnyitva')
    if (eredmeny.tipus === 'megnyitva') {
      expect(eredmeny.mezo).toBeNull()
    }
    expect(probak).toBe(FOKUSZ_JELOLTEK_MAX)
    expect(document.activeElement).toBe(cel.sor)
    expect(cel.sor.getAttribute('tabindex')).toBe('-1')
    expect(cel.sor.hasAttribute(KIEMELES_ATTR)).toBe(true)
  })

  it('háttérlapon nem görget, a lap láthatóvá válásakor nyit', async () => {
    lathatosag = 'hidden'
    const cel = sortEpit(1, { csukva: false })
    document.body.append(cel.sor)
    const folyamat = megnyit(TERV, {
      ablak: window,
      lekero: lekero([{ id: MASIK_ID }, { id: HERO_ID }]),
      signal: new AbortController().signal,
      pozicioIdokorlat: 400,
    })
    await new Promise((vege) => setTimeout(vege, 600))
    expect(gorgetesek).toHaveLength(0)
    lathatosag = 'visible'
    document.dispatchEvent(new Event('visibilitychange'))
    expect((await folyamat).tipus).toBe('megnyitva')
    expect(document.activeElement?.id).toBe('field-layout__1__title')
  })
})

describe('a provider: élő régió és magyar értesítések', () => {
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

  const allapot = () => document.querySelector('[role="status"]')
  const doboz = () => document.querySelector('.kc-szekcio-megnyito')

  /** Megvárja, hogy az élő régióba szöveg kerüljön (legfeljebb `ms` ideig). */
  async function varjAllapotra(ms = 4000) {
    const hatarido = Date.now() + ms
    while (!allapot()?.textContent && Date.now() < hatarido) {
      await act(async () => {
        await new Promise((vege) => setTimeout(vege, 50))
      })
    }
  }

  it('más útvonalon csak az üres, rejtett élő régiót rajzolja, a gyermekeket változatlanul', async () => {
    navigacio.pathname = '/admin'
    navigacio.search = ''
    await renderel()
    expect(tarto.textContent).toContain('admin')
    expect(allapot()?.getAttribute('aria-atomic')).toBe('true')
    expect(allapot()?.textContent).toBe('')
    expect(doboz()?.className).toContain('kc-szekcio-megnyito--rejtett')
  })

  it('hibás azonosító: látható, bezárható magyar figyelmeztetés az élő régióban', async () => {
    navigacio.pathname = '/admin/collections/pages/1'
    navigacio.search = 'szekcio=rossz'
    // Szinkron act: a hatás lefut, az időzítő még nem. Az élő régió az első
    // megjelenéskor üres, a szöveg csak utána érkezik (így felolvasható).
    act(() => {
      gyoker = createRoot(tarto)
      gyoker.render(createElement(SzekcioMegnyito, null, createElement('p', null, 'admin')))
    })
    const regio = allapot()
    expect(regio?.textContent).toBe('')
    await act(async () => {
      await new Promise((vege) => setTimeout(vege, 5))
    })
    expect(allapot()).toBe(regio)
    expect(allapot()?.textContent).toContain(UZENETEK.hibasAzonosito.cim)
    expect(allapot()?.textContent).toContain(UZENETEK.hibasAzonosito.szoveg)
    expect(doboz()?.className).toContain('kc-szekcio-megnyito--figyelem')
    const bezaras = [...document.querySelectorAll('button')].find(
      (gomb) => gomb.textContent === BEZARAS_FELIRAT,
    )
    expect(bezaras).toBeDefined()
    await act(async () => {
      bezaras?.click()
    })
    expect(allapot()?.textContent).toBe('')
  })

  it('sikeres megnyitás: a legújabb változatot kéri a felhasználó sütijével, és felolvassa a sorcímkét', async () => {
    const lekeres = vi.fn<(cim: string, opciok: RequestInit) => Promise<unknown>>(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 1, layout: [{ id: HERO_ID, blockType: 'filmHero' }] }),
    }))
    vi.stubGlobal('fetch', lekeres)
    document.body.append(sortEpit(0).sor)
    navigacio.pathname = '/admin/collections/pages/1'
    navigacio.search = `szekcio=${HERO_ID}`
    await renderel()
    await varjAllapotra()
    expect(lekeres).toHaveBeenCalledTimes(1)
    const [cim, opciok] = lekeres.mock.calls[0] ?? ['', {}]
    expect(cim).toBe('/api/pages/1?depth=0&draft=true')
    expect(opciok.credentials).toBe('include')
    expect(opciok.method ?? 'GET').toBe('GET')
    expect(allapot()?.textContent).toBe(`Megnyitva: ${CIMKE}`)
    expect(doboz()?.className).toContain('kc-szekcio-megnyito--rejtett')
    expect(document.activeElement?.id).toBe('field-layout__0__title')
  })

  it('ha a sor nem kerül a nézetbe: látható, bezárható figyelmeztetés, és SOHA nem „Megnyitva: …”', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ id: 1, layout: [{ id: HERO_ID, blockType: 'filmHero' }] }),
      })),
    )
    modell.lapMagassag = 8000
    modell.gorgetesZarolt = true
    document.body.append(sortEpit(0, { csukva: false, teteje: () => 5000 }).sor)
    const szovegek = new Set<string>()
    const figyelo = new MutationObserver(() => szovegek.add(allapot()?.textContent ?? ''))
    navigacio.pathname = '/admin/collections/pages/1'
    navigacio.search = `szekcio=${HERO_ID}`
    await renderel()
    const regio = allapot()
    if (regio) {
      figyelo.observe(regio, { childList: true, subtree: true, characterData: true })
    }
    await varjAllapotra(8000)
    figyelo.disconnect()
    expect(allapot()?.textContent).toContain(UZENETEK.nemSikerult.cim)
    expect(allapot()?.textContent).not.toMatch(/^Megnyitva/)
    expect([...szovegek].some((szoveg) => szoveg.startsWith('Megnyitva'))).toBe(false)
    expect(doboz()?.className).toContain('kc-szekcio-megnyito--figyelem')
    expect(document.activeElement).toBe(document.body)
    expect(document.querySelectorAll(`[${KIEMELES_ATTR}]`)).toHaveLength(0)
  }, 12_000)

  it('elavult azonosító: magyar figyelmeztetés', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ id: 1, layout: [{ id: MASIK_ID, blockType: 'credsStrip' }] }),
      })),
    )
    navigacio.pathname = '/admin/collections/pages/1'
    navigacio.search = `szekcio=${HERO_ID}`
    await renderel()
    await act(async () => {
      await new Promise((vege) => setTimeout(vege, 50))
    })
    expect(allapot()?.textContent).toContain(UZENETEK.elavult.cim)
  })
})

describe('biztonság és határok (forrás-őr)', () => {
  const forras = readFileSync(
    path.resolve(process.cwd(), 'src/components/editor/admin/SzekcioMegnyito.tsx'),
    'utf8',
  )

  it('nincs innerHTML, és nincs a paraméterre épülő átirányítás', () => {
    expect(forras).not.toMatch(/innerHTML|dangerouslySetInnerHTML|insertAdjacentHTML/)
    expect(forras).not.toMatch(/location\s*\.\s*(href|assign|replace)|router\.(push|replace)/)
    expect(forras).not.toMatch(/useRouter/)
  })

  it('csak a publikus @payloadcms/ui exportot használja (belső dist-útvonalat nem)', () => {
    const payloadImportok = [...forras.matchAll(/from '(@payloadcms\/[^']+)'/g)].map((t) => t[1])
    expect(payloadImportok).toEqual(['@payloadcms/ui'])
  })

  it('mezőértéket nem ír: nincs setValue, dispatchFields vagy submit hívás', () => {
    expect(forras).not.toMatch(/setValue|dispatchFields|\.submit\(|useForm/)
  })
})
