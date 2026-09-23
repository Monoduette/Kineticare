import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { Field, UIField } from 'payload'
import { describe, expect, it } from 'vitest'

import { pageBlocks } from '../blocks'
import {
  about,
  ABOUT_SZOVEG_CIMKEK,
  CSAPATFOTO_FRIZ_JELZES,
  FRIZ_CSOPORT_CIMKE,
  FRIZ_NEM_LATSZIK_JELZES,
} from '../blocks/about'
import {
  frizHelyzetAllapot,
  frizHelyzetben,
  frizHelyzetUtvonalbol,
  nemFrizHelyzetUtvonalbol,
  vanSzovege,
} from '../lib/admin/friz-helyzet'
import { EM_DASH, EN_DASH } from './helpers/cta-mikroszoveg'

/**
 * A fríz-helyzet őre (modul-térkép H12): az about blokk Csapatfotó-jelzése
 * csak ott áll, ahol a lap valóban a mozgó fotósort mutatja. A szabály a
 * RenderBlocks.tsx-é, ezt a szövegőr köti; a condition-teszt a Payload 3.88
 * valós, sztring-szegmenses útvonalával fut (`path.split('.')`). A hely mellett
 * a szöveg is feltétel: az About.tsx a frízt csak `hasCopy` mellett rajzolja,
 * ezt a `vanSzovege` tükrözi, és ennek a képletét is szövegőr köti.
 */

const REPO = fileURLToPath(new URL('..', import.meta.url))

const blokk = (blockType: string, visible?: boolean) => ({
  blockType,
  ...(visible === undefined ? {} : { sectionSettings: { visible } }),
})

/** Szöveges about blokk: a condition-tesztekben a hely a kérdés, nem a szöveg. */
const cimesAbout = (visible?: boolean) => ({
  ...blokk('about', visible),
  title: 'Kiss Kata és Kocsis Kata vagyunk',
})

/** Szöveg nélküli about blokk: csak szám és Csapatfotó, ahogy frissen beszúrva. */
const szovegNelkuliAbout = (extra: Record<string, unknown> = {}) => ({
  ...blokk('about'),
  stats: [{ value: '10', label: 'év' }],
  photo: { id: 1, url: '/media/csapat.jpg' },
  ...extra,
})

const GONDOLATJEL = new RegExp(`[${EN_DASH}${EM_DASH}]`, 'u')

describe('frizHelyzetben: a lap szabálya', () => {
  it('filmHero, about: az about fríz-helyzetben áll', () => {
    expect(frizHelyzetben([blokk('filmHero'), blokk('about')], 1)).toBe(true)
  })

  it('filmHero, rejtett blokk, about: a rejtett blokkot átugorja', () => {
    const layout = [blokk('filmHero'), blokk('welcome', false), blokk('about')]
    expect(frizHelyzetben(layout, 2)).toBe(true)
  })

  it('filmHero, about, about: a második nem fríz-helyzet', () => {
    const layout = [blokk('filmHero'), blokk('about'), blokk('about')]
    expect(frizHelyzetben(layout, 1)).toBe(true)
    expect(frizHelyzetben(layout, 2)).toBe(false)
  })

  it('welcome, about: nem fríz-helyzet', () => {
    expect(frizHelyzetben([blokk('welcome'), blokk('about')], 1)).toBe(false)
  })

  it('rejtett about után álló about: a rejtett nem számít ismétlésnek', () => {
    const layout = [blokk('filmHero'), blokk('about', false), blokk('about')]
    expect(frizHelyzetben(layout, 1)).toBe(false)
    expect(frizHelyzetben(layout, 2)).toBe(true)
  })

  it('a rejtett filmHero nem számít, a látható visible: true igen', () => {
    expect(frizHelyzetben([blokk('filmHero', false), blokk('about')], 1)).toBe(false)
    expect(frizHelyzetben([blokk('filmHero', true), blokk('about', true)], 1)).toBe(true)
  })

  it('nem about blokk, lap eleje és hibás index: hamis', () => {
    expect(frizHelyzetben([blokk('filmHero'), blokk('welcome')], 1)).toBe(false)
    expect(frizHelyzetben([blokk('about')], 0)).toBe(false)
    expect(frizHelyzetben([blokk('filmHero'), blokk('about')], 5)).toBe(false)
    expect(frizHelyzetben([blokk('filmHero'), blokk('about')], -1)).toBe(false)
    expect(frizHelyzetben([null, 'x', blokk('about')], 2)).toBe(false)
  })
})

describe('frizHelyzetUtvonalbol: a condition útvonala', () => {
  const data = { layout: [blokk('filmHero'), cimesAbout(), cimesAbout()] }

  it('a valós sztring-szegmensekből számol', () => {
    expect(frizHelyzetUtvonalbol(data, 'layout.1.csapatfotoFrizJelzes'.split('.'))).toBe(true)
    expect(frizHelyzetUtvonalbol(data, 'layout.2.csapatfotoFrizJelzes'.split('.'))).toBe(false)
    expect(nemFrizHelyzetUtvonalbol(data, 'layout.2.frizNemLatszikJelzes'.split('.'))).toBe(true)
    expect(nemFrizHelyzetUtvonalbol(data, 'layout.1.frizNemLatszikJelzes'.split('.'))).toBe(false)
  })

  it('számszegmenst is elfogad', () => {
    expect(frizHelyzetUtvonalbol(data, ['layout', 1, 'csapatfotoFrizJelzes'])).toBe(true)
  })

  it('hiányzó vagy hibás adatnál mindkét irány hamis', () => {
    const esetek: [unknown, (string | number)[] | undefined][] = [
      [undefined, ['layout', '1', 'x']],
      [{}, ['layout', '1', 'x']],
      [{ layout: 'nem tömb' }, ['layout', '1', 'x']],
      [data, undefined],
      [data, []],
      [data, ['layout']],
      [data, ['layout', 'abc', 'x']],
      [data, ['layout', '1.5', 'x']],
      [data, ['layout', '9', 'x']],
      [data, ['content', '1', 'x']],
    ]
    for (const [adat, utvonal] of esetek) {
      expect(frizHelyzetAllapot(adat, utvonal)).toBeNull()
      expect(frizHelyzetUtvonalbol(adat, utvonal)).toBe(false)
      expect(nemFrizHelyzetUtvonalbol(adat, utvonal)).toBe(false)
    }
  })
})

describe('vanSzovege: az About.tsx hasCopy-képletének tükre', () => {
  it('a cím, a felső kis felirat, egy bekezdés vagy a kiemelt blokk elég', () => {
    expect(vanSzovege({ title: 'Kiss Kata és Kocsis Kata vagyunk' })).toBe(true)
    expect(vanSzovege({ eyebrow: 'Rólunk' })).toBe(true)
    expect(vanSzovege({ paragraphs: [{ text: '' }, { text: 'Gyógytornászok vagyunk.' }] })).toBe(
      true,
    )
    expect(vanSzovege({ feature: { label: 'Személyre szabott kezelések' } })).toBe(true)
  })

  it('egyetlen kiemelt magyarázat (feature.note) is elég', () => {
    expect(vanSzovege({ feature: { label: '', note: 'Minden kezelést rád szabunk.' } })).toBe(true)
  })

  it('a csak szóközből álló cím és az üres bekezdés nem szöveg', () => {
    expect(vanSzovege({ title: '   ' })).toBe(false)
    expect(vanSzovege({ eyebrow: '\t\n' })).toBe(false)
    expect(vanSzovege({ paragraphs: [{ text: '' }, { text: '  ' }, {}] })).toBe(false)
    expect(vanSzovege({ feature: { label: ' ', note: '  ' } })).toBe(false)
    expect(vanSzovege(szovegNelkuliAbout())).toBe(false)
  })

  it('hibás adatnál hamis', () => {
    for (const hibas of [null, undefined, 'x', 3, [], { paragraphs: 'nem tömb', feature: 'x' }]) {
      expect(vanSzovege(hibas)).toBe(false)
    }
  })
})

describe('szöveg nélküli about a nyitó videó után: a Csapatfotó látszik', () => {
  it('a hely fríz-helyzet, de a lap a sima alakot rajzolja', () => {
    const layout = [blokk('filmHero'), szovegNelkuliAbout()]
    expect(frizHelyzetben(layout, 1)).toBe(true)
    expect(frizHelyzetAllapot({ layout }, ['layout', '1', 'x'])).toBe(false)
    const csapatfoto = uiMezo(about.fields, 'csapatfotoFrizJelzes')
    const nemLatszik = uiMezo(about.fields, 'frizNemLatszikJelzes')
    expect(feltetel(csapatfoto, { layout }, 'layout.1.csapatfotoFrizJelzes')).toBe(false)
    expect(feltetel(nemLatszik, { layout }, 'layout.1.frizNemLatszikJelzes')).toBe(true)
  })

  it('a csak szóközös cím és az üres bekezdés sem kapcsolja be a frízt', () => {
    for (const extra of [{ title: '   ' }, { paragraphs: [{ text: '' }] }]) {
      const layout = [blokk('filmHero'), szovegNelkuliAbout(extra)]
      expect(frizHelyzetUtvonalbol({ layout }, 'layout.1.x'.split('.'))).toBe(false)
      expect(nemFrizHelyzetUtvonalbol({ layout }, 'layout.1.x'.split('.'))).toBe(true)
    }
  })

  it('egyetlen kiemelt magyarázat már bekapcsolja a frízt', () => {
    const layout = [blokk('filmHero'), szovegNelkuliAbout({ feature: { note: 'Rád szabjuk.' } })]
    expect(frizHelyzetUtvonalbol({ layout }, 'layout.1.x'.split('.'))).toBe(true)
    expect(nemFrizHelyzetUtvonalbol({ layout }, 'layout.1.x'.split('.'))).toBe(false)
  })
})

describe('a megjelenítő szabálya nem mozdult el (szövegőr)', () => {
  it('az About.tsx a frízt csak szöveggel rajzolja, a hasCopy képlete változatlan', () => {
    const forras = readFileSync(`${REPO}components/blocks/About.tsx`, 'utf8')
    expect(forras).toContain('const founders = frieze && hasCopy')
    expect(forras).toContain(
      'const hasCopy = title.length > 0 || paragraphs.length > 0 || hasFeature || eyebrow.length > 0',
    )
    expect(forras).toContain('const hasFeature = featureLabel.length > 0 || featureNote.length > 0')
    expect(forras).toContain("(item.text?.trim() ?? '').length > 0")
  })

  it('a RenderBlocks.tsx a látható előzményből és az ismétlésből számol', () => {
    const forras = readFileSync(`${REPO}components/blocks/RenderBlocks.tsx`, 'utf8')
    expect(forras).toContain('afterFilmHero && !isRepeat')
    expect(forras).toContain("previousVisible?.blockType === 'filmHero'")
    expect(forras).toContain('candidate.sectionSettings?.visible !== false')
  })
})

function uiMezo(fields: readonly Field[], name: string): UIField {
  const mezo = fields.find((field) => 'name' in field && field.name === name)
  if (!mezo || mezo.type !== 'ui') throw new Error(`nincs ${name} UI-mező`)
  return mezo
}

function feltetel(mezo: UIField, data: unknown, path: string): boolean {
  const condition = mezo.admin?.condition
  if (!condition) throw new Error(`${mezo.name}: nincs condition`)
  return Boolean(
    condition(
      data as Record<string, unknown>,
      {},
      {
        blockData: {},
        operation: 'update',
        path: path.split('.'),
        user: null,
      },
    ),
  )
}

describe('az about blokk feltételes jelzései', () => {
  const nevek = about.fields.map((field) => ('name' in field ? field.name : null))

  it('a Csapatfotó után, a fríz-csoport előtt állnak, nem a blokk elején', () => {
    const photo = nevek.indexOf('photo')
    expect(nevek[photo + 1]).toBe('csapatfotoFrizJelzes')
    expect(nevek[photo + 2]).toBe('frizNemLatszikJelzes')
    expect(nevek[photo + 3]).toBe('frieze')
    expect(nevek[0]).toBe('eyebrow')
  })

  it('a Payload FieldDescription-komponensével rajzolnak, séma nélkül', () => {
    for (const name of ['csapatfotoFrizJelzes', 'frizNemLatszikJelzes']) {
      const mezo = uiMezo(about.fields, name)
      const komponens = mezo.admin?.components?.Field
      expect(typeof komponens === 'object' && komponens !== null ? komponens.path : null).toBe(
        '@payloadcms/ui#FieldDescription',
      )
    }
  })

  it('a condition a valós útvonallal csak a fríz-helyzetben mutatja a Csapatfotó-jelzést', () => {
    const data = {
      layout: [blokk('filmHero'), cimesAbout(), blokk('welcome'), cimesAbout()],
    }
    const csapatfoto = uiMezo(about.fields, 'csapatfotoFrizJelzes')
    const nemLatszik = uiMezo(about.fields, 'frizNemLatszikJelzes')
    expect(feltetel(csapatfoto, data, 'layout.1.csapatfotoFrizJelzes')).toBe(true)
    expect(feltetel(nemLatszik, data, 'layout.1.frizNemLatszikJelzes')).toBe(false)
    expect(feltetel(csapatfoto, data, 'layout.3.csapatfotoFrizJelzes')).toBe(false)
    expect(feltetel(nemLatszik, data, 'layout.3.frizNemLatszikJelzes')).toBe(true)
    expect(feltetel(csapatfoto, {}, 'layout.1.csapatfotoFrizJelzes')).toBe(false)
    expect(feltetel(nemLatszik, {}, 'layout.1.frizNemLatszikJelzes')).toBe(false)
  })

  it('a katalógus (pageBlocks) burkolt about blokkja is hordozza a jelzéseket', () => {
    const burkolt = pageBlocks.find((block) => block.slug === 'about')
    expect(burkolt).toBeDefined()
    if (!burkolt) return
    const data = { layout: [blokk('filmHero'), cimesAbout()] }
    expect(feltetel(uiMezo(burkolt.fields, 'csapatfotoFrizJelzes'), data, 'layout.1.x')).toBe(true)
  })

  it('a szöveg a csoport címkéjének és a blokk nevének szavát idézi, gondolatjel nélkül', () => {
    const csoport = about.fields.find((field) => 'name' in field && field.name === 'frieze')
    expect(csoport?.type === 'group' ? csoport.label : null).toBe(FRIZ_CSOPORT_CIMKE)
    expect(FRIZ_CSOPORT_CIMKE.toLocaleLowerCase('hu')).toContain('mozgó fotósor')
    expect(CSAPATFOTO_FRIZ_JELZES).toBe(
      'Ebben a helyzetben a jobb oldalon a mozgó fotósor látszik, ez a kép nem.',
    )
    expect(FRIZ_NEM_LATSZIK_JELZES).toContain('a mozgó fotósor nem látszik')
    expect(FRIZ_NEM_LATSZIK_JELZES).toContain(`„${String(about.labels?.singular)}” szekció`)
    expect(FRIZ_NEM_LATSZIK_JELZES).toContain('közvetlenül a nyitó videó után áll, és')
    for (const [name, cimke] of Object.entries(ABOUT_SZOVEG_CIMKEK)) {
      const mezo = about.fields.find((field) => 'name' in field && field.name === name)
      expect(mezo && 'label' in mezo ? mezo.label : null).toBe(cimke)
      expect(FRIZ_NEM_LATSZIK_JELZES).toContain(`„${cimke}”`)
    }
    expect(FRIZ_NEM_LATSZIK_JELZES).toMatch(/közül legalább egy ki van töltve\.$/u)
    expect(GONDOLATJEL.test(CSAPATFOTO_FRIZ_JELZES)).toBe(false)
    expect(GONDOLATJEL.test(FRIZ_NEM_LATSZIK_JELZES)).toBe(false)
  })
})
