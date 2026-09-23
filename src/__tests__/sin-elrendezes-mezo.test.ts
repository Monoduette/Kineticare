import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Services } from '../components/blocks/Services'
import {
  CLOSED_HAND_HOME_HELP_TITLES,
  HOME_HELP_LEAD,
  HOME_HELP_STATES,
  HOME_HELP_TITLE,
  LEGACY_HOME_HELP_ROWS,
  LEGACY_HOME_HELP_URLS,
  homeHelpFallbackMedia,
  isConvertibleHomeHelpServices,
  kezdolapiSinE,
  mentettElrendezes,
  presentHomeHelpServicesBlock,
  presentHomeLayout,
  presentSzolgaltatasokLayout,
  szolgaltatasokSinE,
} from '../lib/home-help-states'
import type { BlockServices, Page } from '../payload-types'

/**
 * H15 (A4 kód, 2026-09-23): a sín vagy tábla döntése a blokk `elrendezes`
 * mezőjéé. `sin` → sín, `tabla` → tábla (ajtó-alakú soroknál is, kényszerítés
 * nélkül), hiányzó mező (régi adat) → a mai felismerés a tartalék. A zárt-kéz
 * sín kanonikus cseréje marad.
 */

type Szekciosor = NonNullable<Page['layout']>

const ajtoSorok = () =>
  LEGACY_HOME_HELP_ROWS.map((row) => ({ ...row, osszefoglalo: null, photo: null }))

const haromAjto = (elrendezes?: 'sin' | 'tabla' | null): BlockServices =>
  ({
    id: 'help',
    blockType: 'services',
    title: HOME_HELP_TITLE,
    ...(elrendezes === undefined ? {} : { elrendezes }),
    rows: ajtoSorok(),
    sectionSettings: { visible: true, hatter: 'feher' },
  }) as unknown as BlockServices

const szolgAjto = (elrendezes?: 'sin' | 'tabla' | null): Szekciosor[number] =>
  ({
    id: 'ajto',
    blockType: 'services',
    title: 'Így segítünk',
    ...(elrendezes === undefined ? {} : { elrendezes }),
    rows: [
      { title: 'Rendelői kezelések', body: 'A.', felirat: 'Időpontot kérek', url: '/kapcsolat' },
      { title: 'Otthoni online program', body: 'B.', felirat: 'Kurzus', url: '/kurzusok/x' },
      { title: 'Szakmai képzések', body: 'C.', felirat: 'Képzés', url: 'https://example.test/' },
    ],
    sectionSettings: { visible: true, hatter: 'feher' },
  }) as unknown as Szekciosor[number]

const ketSoros = (elrendezes?: 'sin' | 'tabla' | null): Szekciosor[number] =>
  ({
    id: 'ezert',
    blockType: 'services',
    title: 'Ezért fogod imádni',
    ...(elrendezes === undefined ? {} : { elrendezes }),
    rows: [
      { title: 'A kéz a szakterületünk', body: 'Első.' },
      { title: 'A hétköznapokra készülünk', body: 'Második.' },
    ],
    sectionSettings: { visible: true, hatter: 'feher' },
  }) as unknown as Szekciosor[number]

const render = (block: Szekciosor[number] | undefined): string => {
  if (block?.blockType !== 'services') throw new Error('nincs services blokk')
  return renderToStaticMarkup(createElement(Services, { block }))
}

describe('mentettElrendezes', () => {
  it('csak a két ismert értéket adja vissza, minden más null (régi adat)', () => {
    expect(mentettElrendezes('sin')).toBe('sin')
    expect(mentettElrendezes('tabla')).toBe('tabla')
    for (const ertek of [undefined, null, '', 'Sin', 'kartya', 1]) {
      expect(mentettElrendezes(ertek)).toBeNull()
    }
  })
})

describe('kezdőlap: az Elrendezés mező dönt', () => {
  it('`sin` → sín, a CMS-szöveggel és a tartalék-pótlással', () => {
    const presented = presentHomeHelpServicesBlock(haromAjto('sin'))
    expect(presented.elrendezes).toBe('sin')
    expect(presented.sectionSettings?.hatter).toBe('tint')
    expect(presented.lead).toBe(HOME_HELP_LEAD)
    expect(presented.rows?.map((row) => row.body)).toEqual(ajtoSorok().map((row) => row.body))
    expect(presented.rows?.map((row) => row.osszefoglalo)).toEqual(
      HOME_HELP_STATES.map((state) => state.osszefoglalo),
    )
    expect(render(presented)).toContain('kc-services--sin')
  })

  it('`tabla` → tábla a háromajtós soroknál is, kényszerítés nélkül', () => {
    const block = haromAjto('tabla')
    expect(isConvertibleHomeHelpServices(block)).toBe(true)
    expect(kezdolapiSinE(block)).toBe(false)
    expect(presentHomeHelpServicesBlock(block)).toBe(block)
    const [presented] = presentHomeLayout([block])
    expect(presented).toBe(block)
    const markup = render(presented)
    expect(markup).not.toContain('kc-services--sin')
    expect(markup).toContain('kc-services--choices')
  })

  it('hiányzó mező (undefined vagy null) → a háromajtós felismerés a tartalék', () => {
    for (const hianyzo of [undefined, null] as const) {
      const [presented] = presentHomeLayout([haromAjto(hianyzo)])
      if (presented?.blockType !== 'services') throw new Error('nincs services blokk')
      expect(presented.elrendezes).toBe('sin')
      expect(presented.sectionSettings?.hatter).toBe('tint')
    }
    const [tabla] = presentHomeLayout([ketSoros()])
    expect(tabla).toEqual(ketSoros())
    expect(render(tabla)).not.toContain('kc-services--sin')
  })

  it('a mentett `sin` a nem háromajtós blokkot is sínné teszi (a mező nyer, nem a cím)', () => {
    const [presented] = presentHomeLayout([ketSoros('sin')])
    if (presented?.blockType !== 'services') throw new Error('nincs services blokk')
    expect(presented.elrendezes).toBe('sin')
    expect(presented.sectionSettings?.hatter).toBe('tint')
    expect(presented.title).toBe('Ezért fogod imádni')
    expect(render(presented)).toContain('kc-services--sin')
  })

  it('a Sötétkék sín a sötét sávon marad', () => {
    const block = {
      ...haromAjto('sin'),
      sectionSettings: { visible: true, hatter: 'sotet' },
    } as BlockServices
    expect(presentHomeHelpServicesBlock(block).sectionSettings?.hatter).toBe('sotet')
  })

  it('a zárt-kéz sín (`sin` mezővel is) a kanonikus ajtó-szöveget kapja, a feltöltött fotó marad', () => {
    const feltoltott = { id: 5, url: '/api/media/file/sajat.webp', alt: 'Saját fotó' }
    for (const elrendezes of ['sin', undefined] as const) {
      const block = {
        blockType: 'services',
        title: 'Régi cím',
        lead: 'A kéz három állapota.',
        eyebrow: 'Régi felirat',
        ...(elrendezes ? { elrendezes } : {}),
        rows: CLOSED_HAND_HOME_HELP_TITLES.map((title, index) => ({
          title,
          body: `Régi kézállapot-szöveg ${index + 1}.`,
          felirat: 'Gomb',
          url: LEGACY_HOME_HELP_URLS[index],
          photo: index === 0 ? feltoltott : null,
        })),
      } as unknown as BlockServices
      const presented = presentHomeHelpServicesBlock(block)
      expect(presented.elrendezes).toBe('sin')
      expect(presented.title).toBe(HOME_HELP_TITLE)
      expect(presented.lead).toBe(HOME_HELP_LEAD)
      expect(presented.eyebrow).toBe('')
      expect(presented.rows?.map((row) => row.title)).toEqual(
        HOME_HELP_STATES.map((state) => state.title),
      )
      expect(presented.rows?.map((row) => row.body)).toEqual(
        HOME_HELP_STATES.map((state) => state.body),
      )
      expect(presented.rows?.[0]?.photo).toEqual(feltoltott)
      expect(presented.rows?.[1]?.photo).toEqual(homeHelpFallbackMedia(1))
    }
  })

  it('a mentett `tabla` zárt-kéz sort nem alakít át (a mező nyer)', () => {
    const block = {
      blockType: 'services',
      title: 'Régi cím',
      elrendezes: 'tabla',
      rows: CLOSED_HAND_HOME_HELP_TITLES.map((title) => ({ title, body: 'Szöveg.' })),
    } as unknown as BlockServices
    expect(presentHomeHelpServicesBlock(block)).toBe(block)
  })

  it('a sín előtti tábla sávváltása a mezős sínnél is megmarad', () => {
    const [elotte, sin] = presentHomeLayout([ketSoros('tabla'), haromAjto('sin')])
    if (elotte?.blockType !== 'services' || sin?.blockType !== 'services') {
      throw new Error('nincs services blokk')
    }
    expect(sin.elrendezes).toBe('sin')
    expect(elotte.sectionSettings?.hatter).toBe('tint')
    const [tablaUtan] = presentHomeLayout([ketSoros('tabla'), haromAjto('tabla')])
    expect(tablaUtan).toEqual(ketSoros('tabla'))
  })
})

describe('/szolgaltatasok: az Elrendezés mező dönt', () => {
  it('`sin` → sín a lap saját soraival, tint sáv, tartalék-fotóval', () => {
    const [presented] = presentSzolgaltatasokLayout([szolgAjto('sin')])
    if (presented?.blockType !== 'services') throw new Error('nincs services blokk')
    expect(presented.elrendezes).toBe('sin')
    expect(presented.sectionSettings?.hatter).toBe('tint')
    expect(presented.rows?.map((row) => row.osszefoglalo ?? null)).toEqual([null, null, null])
    expect(
      presented.rows?.map((row) => (typeof row.photo === 'object' ? row.photo?.url : null)),
    ).toEqual([0, 1, 2].map((ajto) => homeHelpFallbackMedia(ajto).url))
    expect(render(presented)).toContain('kc-services--sin')
  })

  it('`tabla` → tábla az ajtó-alakú (három CTA-s) blokknál is, a mezőt nem írja át', () => {
    const block = szolgAjto('tabla')
    expect(szolgaltatasokSinE(block)).toBe(false)
    const [presented] = presentSzolgaltatasokLayout([block])
    expect(presented).toBe(block)
    const markup = render(presented)
    expect(markup).not.toContain('kc-services--sin')
    expect(markup).toContain('kc-services--choices')
  })

  it('a mentett `sin` a nem ajtó blokkot is sínné teszi (a régi kód táblára kényszerítette)', () => {
    const [presented] = presentSzolgaltatasokLayout([ketSoros('sin')])
    if (presented?.blockType !== 'services') throw new Error('nincs services blokk')
    expect(presented.elrendezes).toBe('sin')
    expect(render(presented)).toContain('kc-services--sin')
  })

  it('hiányzó mező → az ajtó-felismerés a tartalék; a nem ajtó blokk érintetlen tábla', () => {
    for (const hianyzo of [undefined, null] as const) {
      const [ajto, ezert] = presentSzolgaltatasokLayout([szolgAjto(hianyzo), ketSoros(hianyzo)])
      if (ajto?.blockType !== 'services') throw new Error('nincs services blokk')
      expect(ajto.elrendezes).toBe('sin')
      expect(ezert).toEqual(ketSoros(hianyzo))
      expect(render(ezert)).not.toContain('kc-services--sin')
    }
  })
})
