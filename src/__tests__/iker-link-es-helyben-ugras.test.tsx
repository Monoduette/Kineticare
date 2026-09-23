// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { act, createElement, type MouseEvent as ReactMouseEvent } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BLOKK_ID_MINTA } from '../components/editor/szekcio-melylink'
import type { Page } from '../payload-types'

/**
 * A rejtett szekció ikerlinkje (modul-térkép H02) és a helyben ugrás
 * (src/components/admin/helyben-ugras.ts) őre.
 *
 * - modell: `sectionNoticeModel(...).ikerLink` felirata és mélylinkje;
 * - nézet: `SectionSourceNoticeView` a `renderToStaticMarkup`-pal;
 * - helyben ugrás: happy-dom, `history.pushState`-kémmel. Csak a MEGÁLLÍTOTT
 *   kattintás megy át valódi DOM-eseményen; ahol a böngésző alapviselkedése
 *   maradna (navigáció), ott a függvényt kézzel épített eseménnyel hívjuk,
 *   hogy a teszt ne navigáljon, és hálózati hívás se induljon.
 * A `fetch` hangosan dob (CLAUDE.md, 15. üzemeltetési tanulság).
 */

vi.mock('@payloadcms/ui', () => ({
  useConfig: () => ({ config: { serverURL: '', routes: { admin: '/admin', api: '/api' } } }),
  useDocumentInfo: () => ({ collectionSlug: 'pages', id: 7 }),
  useFormFields: () => 'kezdolap',
  useWatchForm: () => ({ fields: {} }),
  useRowLabel: () => ({ data: undefined, path: '' }),
}))

const { SectionSourceNoticeView } = await import('../components/admin/SectionSourceNotice')
const { helybenUgras } = await import('../components/admin/helyben-ugras')
const {
  CMS_KOTOTT_CIM,
  CMS_KOTOTT_UGROPONTOK,
  hiddenHint,
  IKER_LINK_ELOTAG,
  REJTETT_MAGYARAZAT,
  sectionNoticeModel,
  sectionSource,
  VELEMENYEK_HOL_LATSZIK,
  visibleTwin,
} = await import('../lib/section-row-label')

const ELO = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'fixtures/elo-szekciosorok-2026-09-22.json'),
    'utf8',
  ),
) as Record<string, { id: number; slug: string; layout: NonNullable<Page['layout']> }>

const kezdolap = ELO.kezdolap
if (!kezdolap) {
  throw new Error('Hiányzik az élő kezdőlap a fixture-ből.')
}
const SOROK = kezdolap.layout
const REJTETT_INDEX = SOROK.findIndex((sor) => sor.sectionSettings?.visible === false)
const IKER_ID = String(SOROK[1]?.id)

const modell = (docId?: number | string | null, siblings: readonly unknown[] = SOROK) =>
  sectionNoticeModel({
    data: siblings[REJTETT_INDEX],
    pageSlug: 'kezdolap',
    rowIndex: REJTETT_INDEX,
    siblings,
    adminRoute: '/admin',
    docId,
  })

beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('A tesztből SOSEM mehet ki valódi hálózati hívás.')
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ikerLink: a modell (élő kezdőlap, 11. rejtett sor)', () => {
  it('a felirat betűre „A látható párja: 02 · Megérdemled a profi törődést”', () => {
    expect(REJTETT_INDEX).toBe(10)
    const model = modell(kezdolap.id)
    expect(model.ikerLink?.felirat).toBe('A látható párja: 02 · Megérdemled a profi törődést')
    expect(model.ikerLink?.felirat.startsWith(`${IKER_LINK_ELOTAG} `)).toBe(true)
  })

  it('a href a szerkesztő mélylinkje az iker szekciójára: /admin/collections/pages/<id>?szekcio=<24 hexa>', () => {
    expect(IKER_ID).toMatch(BLOKK_ID_MINTA)
    const href = modell(kezdolap.id).ikerLink?.href ?? ''
    expect(href).toBe(`/admin/collections/pages/${String(kezdolap.id)}?szekcio=${IKER_ID}`)
    expect(href).toMatch(/^\/admin\/collections\/pages\/\d+\?szekcio=[a-f0-9]{24}$/)
    expect(modell('12').ikerLink?.href).toBe(`/admin/collections/pages/12?szekcio=${IKER_ID}`)
  })

  it('dokumentum-azonosító nélkül, hibás azonosítóval vagy az iker azonosítója nélkül a href null', () => {
    for (const docId of [undefined, null, '', '  ', -1, 1.5, 'create', 'a/b']) {
      const model = modell(docId)
      expect(model.ikerLink?.felirat, String(docId)).toBe(
        'A látható párja: 02 · Megérdemled a profi törődést',
      )
      expect(model.ikerLink?.href, String(docId)).toBeNull()
    }
    const azonositoNelkul = SOROK.map((sor, index) => (index === 1 ? { ...sor, id: 'x' } : sor))
    expect(modell(kezdolap.id, azonositoNelkul).ikerLink?.href).toBeNull()
  })

  it('látható sornak és iker nélküli rejtett sornak nincs ikerlinkje', () => {
    const lathato = sectionNoticeModel({
      data: SOROK[1],
      pageSlug: 'kezdolap',
      rowIndex: 1,
      siblings: SOROK,
      adminRoute: '/admin',
      docId: kezdolap.id,
    })
    expect(lathato.ikerLink).toBeNull()
    const egyedul = [SOROK[REJTETT_INDEX]]
    expect(
      sectionNoticeModel({
        data: egyedul[0],
        pageSlug: 'kezdolap',
        rowIndex: 0,
        siblings: egyedul,
        adminRoute: '/admin',
        docId: kezdolap.id,
      }).ikerLink,
    ).toBeNull()
  })

  it('a meglévő API és szöveg változatlan: iker „02”, a rejtett mondat a régi', () => {
    const model = modell(kezdolap.id)
    expect(model.iker).toBe('02')
    expect(visibleTwin(SOROK[REJTETT_INDEX], REJTETT_INDEX, SOROK)).toBe('02')
    expect(hiddenHint('02')).toBe(
      'Ugyanezzel a címmel a 2. sor látszik a lapon, a látható szöveget ott írod át.',
    )
  })
})

describe('SectionSourceNoticeView: az ikerlink a rejtett dobozban', () => {
  it('a hiddenHint bekezdés UTÁN, saját bekezdésben, <a href>-fel', () => {
    const html = renderToStaticMarkup(
      createElement(SectionSourceNoticeView, { model: modell(kezdolap.id) }),
    )
    const href = `/admin/collections/pages/${String(kezdolap.id)}?szekcio=${IKER_ID}`
    const link = `<p class="kc-admin-notice__szoveg kc-section-source__iker"><a href="${href}">A látható párja: 02 · Megérdemled a profi törődést</a></p>`
    expect(html).toContain(link)
    const hint = html.indexOf(`${REJTETT_MAGYARAZAT} ${hiddenHint('02')}`)
    expect(hint).toBeGreaterThan(-1)
    expect(html.indexOf(link)).toBeGreaterThan(hint)
    // Nem új lapon nyílik: a szerkesztő ugyanazon a lapon marad.
    expect(html).not.toContain('target=')
  })

  it('href nélkül a felirat link nélkül áll', () => {
    const html = renderToStaticMarkup(createElement(SectionSourceNoticeView, { model: modell() }))
    expect(html).toContain(
      '<p class="kc-admin-notice__szoveg kc-section-source__iker">A látható párja: 02 · Megérdemled a profi törődést</p>',
    )
    expect(html).not.toMatch(/<a /)
  })

  it('a Vélemények forrás-dobozában a „hol látszik” külön bekezdés', () => {
    const velemenyek = SOROK.find((sor) => sor.blockType === 'testimonials')
    const html = renderToStaticMarkup(
      createElement(SectionSourceNoticeView, {
        model: {
          rejtett: false,
          forras: sectionSource(velemenyek, 'kezdolap'),
          megnezem: null,
          ugras: null,
          iker: null,
          kotott: null,
        },
      }),
    )
    expect(html.replace(/&quot;/g, '"')).toContain(
      `<p class="kc-admin-notice__szoveg kc-section-source__hol">${VELEMENYEK_HOL_LATSZIK}</p>`,
    )
  })

  it('a CMS-linkekkel kötött ugrópont saját címmel, a kötött mondat mintájára', () => {
    const mondat = CMS_KOTOTT_UGROPONTOK[0]?.mondat ?? ''
    const html = renderToStaticMarkup(
      createElement(SectionSourceNoticeView, {
        model: {
          rejtett: false,
          forras: null,
          megnezem: null,
          ugras: null,
          iker: null,
          kotott: null,
          cmsKotott: mondat,
        },
      }),
    )
    expect(html).toContain(`<p class="kc-admin-notice__cim">${CMS_KOTOTT_CIM}</p>`)
    expect(html).toContain('kc-section-source__kotott')
    expect(html).toContain('Nézd meg a szakmai hátterét')
  })
})

/* ------------------------------------------------------------------------ */
/* helybenUgras                                                              */
/* ------------------------------------------------------------------------ */

const SZERKESZTO = '/admin/collections/pages/7'
const IKER_HREF = `${SZERKESZTO}?szekcio=6a9c87851506dc83a6ad17c7`

/** Kézzel épített React-egér-esemény (a böngésző alapviselkedése nem fut le). */
function esemeny(
  href: string,
  extra: Partial<
    Record<'button' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey', number | boolean>
  > = {},
  target: string | null = null,
) {
  const link = document.createElement('a')
  link.setAttribute('href', href)
  if (target !== null) {
    link.setAttribute('target', target)
  }
  const preventDefault = vi.fn()
  const e = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    ...extra,
    currentTarget: link,
    preventDefault,
  } as unknown as ReactMouseEvent<HTMLAnchorElement>
  return { e, preventDefault }
}

describe('helybenUgras: ugyanazon a szerkesztőn újratöltés nélkül', () => {
  let gyoker: Root | null = null

  beforeEach(() => {
    window.history.replaceState(null, '', SZERKESZTO)
  })

  afterEach(() => {
    act(() => gyoker?.unmount())
    gyoker = null
    document.body.innerHTML = ''
  })

  it('sima bal kattintás azonos pathname-re: preventDefault, majd pushState ugyanarra a címre (valódi DOM-esemény)', () => {
    const push = vi.spyOn(window.history, 'pushState')
    const tarto = document.createElement('div')
    document.body.append(tarto)
    act(() => {
      gyoker = createRoot(tarto)
      gyoker.render(createElement('a', { href: IKER_HREF, onClick: helybenUgras }, 'iker'))
    })
    const link = tarto.querySelector('a')
    const kattintas = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    act(() => {
      link?.dispatchEvent(kattintas)
    })
    expect(kattintas.defaultPrevented).toBe(true)
    expect(push).toHaveBeenCalledTimes(1)
    expect(push).toHaveBeenCalledWith(null, '', IKER_HREF)
    expect(`${window.location.pathname}${window.location.search}`).toBe(IKER_HREF)
  })

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Meta (Cmd)', { metaKey: true }],
    ['Shift', { shiftKey: true }],
    ['Alt', { altKey: true }],
    ['középső gomb', { button: 1 }],
  ] as const)('%s kattintásnál a böngésző alapviselkedése marad', (_nev, extra) => {
    const push = vi.spyOn(window.history, 'pushState')
    const { e, preventDefault } = esemeny(IKER_HREF, extra)
    helybenUgras(e)
    expect(preventDefault).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('más pathname-re (másik dokumentum, lista, más origin) nem avatkozik be', () => {
    const push = vi.spyOn(window.history, 'pushState')
    for (const href of [
      '/admin/collections/pages/8?szekcio=6a9c87851506dc83a6ad17c7',
      '/admin/collections/pages',
      'https://pelda.example/admin/collections/pages/7?szekcio=6a9c87851506dc83a6ad17c7',
    ]) {
      const { e, preventDefault } = esemeny(href)
      helybenUgras(e)
      expect(preventDefault, href).not.toHaveBeenCalled()
    }
    expect(push).not.toHaveBeenCalled()
  })

  it('target attribútumos (új lapon nyíló) linknél és már megállított eseménynél sem', () => {
    const push = vi.spyOn(window.history, 'pushState')
    const ujLap = esemeny(IKER_HREF, {}, '_blank')
    helybenUgras(ujLap.e)
    expect(ujLap.preventDefault).not.toHaveBeenCalled()
    const megallitott = esemeny(IKER_HREF)
    helybenUgras({ ...megallitott.e, defaultPrevented: true })
    expect(megallitott.preventDefault).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })
})
