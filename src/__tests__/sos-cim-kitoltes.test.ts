import { describe, expect, it } from 'vitest'

import { FREE_SOS_STRIP_TITLE } from '../components/content/home/FreeSos'
import {
  SOS_CIM_REGI,
  SOS_CIM_UJ,
  kitoltSosCim,
  sosCimAllapota,
  type SosCimKitoltes,
} from '../scripts/sos-cim-kitoltes'

/**
 * Az SOS-cím előtöltő szabálya (src/scripts/sos-cim-kitoltes.ts).
 * Csak a pontos régi alakot (U+2014) és az üres címet írja „Ingyenes
 * villámkurzus”-ra; minden más szerkesztői szöveg érintetlen.
 */

/** A seed korábbi, kettőspontos alakja: szerkesztői szövegként ehhez a szabály nem nyúl. */
const SEED_CIM = 'SOS Kézrelax: ingyenes villámkurzus'
/** A nagykötőjeles (U+2013) változat, ez sem a pontos régi alak. */
const NAGYKOTOJELES_CIM = 'SOS Kézrelax \u2013 ingyenes villámkurzus'

const sos = (title: unknown, id = 'sos-1'): Record<string, unknown> => ({
  id,
  blockType: 'freeSos',
  title,
  body: 'Ha előbb kipróbálnád a módszert: rövid gyakorlatok.',
  cta: { felirat: 'Elindítom az ingyenes kurzust', url: '/kurzusok', ujAblakban: false },
  backgroundImage: 31,
  sectionSettings: { visible: true, anchorId: 'ingyenes', hatter: 'tint' },
})

const tobbi = [
  { id: 'film', blockType: 'filmHero', title: 'SOS Kézrelax \u2014 ingyenes villámkurzus' },
  { id: 'kartyak', blockType: 'courseCards', heading: 'Kurzusaink' },
]

/** Mélyen fagyasztott másolat: ha a szabály írna a bemenetbe, a teszt dob. */
function fagyaszt<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const inner of Object.values(value)) fagyaszt(inner)
    Object.freeze(value)
  }
  return value
}

function cimek(eredmeny: SosCimKitoltes): unknown[] {
  return (eredmeny.layout ?? []).map((blokk) =>
    typeof blokk === 'object' && blokk !== null && 'title' in blokk ? blokk.title : undefined,
  )
}

describe('sos-cim-kitoltes: a célérték és a régi alak', () => {
  it('a célérték betűre a komponens tartaléka, a régi alak a pontos U+2014-es élő érték', () => {
    expect(SOS_CIM_UJ).toBe(FREE_SOS_STRIP_TITLE)
    expect(SOS_CIM_UJ).toBe('Ingyenes villámkurzus')
    expect(SOS_CIM_REGI).toBe('SOS Kézrelax \u2014 ingyenes villámkurzus')
    expect([...SOS_CIM_REGI].filter((jel) => jel === '\u2014')).toHaveLength(1)
    expect(SOS_CIM_REGI).not.toContain('\u2013')
  })
})

describe('sos-cim-kitoltes: mit ír át', () => {
  it('a pontos régi alakot „Ingyenes villámkurzus”-ra írja, a blokk többi mezője változatlan', () => {
    const bemenet = fagyaszt([tobbi[0], sos(SOS_CIM_REGI), tobbi[1]])
    const eredmeny = kitoltSosCim(bemenet)
    expect(eredmeny.allapot).toBe('KITOLTVE')
    expect(eredmeny.layout).not.toBeNull()
    expect(eredmeny.layout?.[1]).toEqual({ ...sos(SOS_CIM_REGI), title: SOS_CIM_UJ })
    expect(eredmeny.naplo).toEqual([
      expect.objectContaining({
        index: 1,
        blokkId: 'sos-1',
        regiCim: SOS_CIM_REGI,
        allapot: 'KITOLTVE',
      }),
    ])
    expect(eredmeny.naplo[0]?.uzenet).toBe(
      `Kezdőlap, 2. szekció (SOS-sáv, azonosító: sos-1): a cím „${SOS_CIM_REGI}” helyett „Ingyenes villámkurzus” lett.`,
    )
  })

  it('a régi alakot szélső szóközzel is felismeri (trim után egyezik)', () => {
    const eredmeny = kitoltSosCim(fagyaszt([sos(`  ${SOS_CIM_REGI}\n`)]))
    expect(eredmeny.allapot).toBe('KITOLTVE')
    expect(cimek(eredmeny)).toEqual([SOS_CIM_UJ])
  })

  it.each([
    ['üres', ''],
    ['csak szóköz', '   \t '],
    ['null', null],
    ['hiányzó', undefined],
  ])('a(z) %s címet kitölti', (_nev, title) => {
    const eredmeny = kitoltSosCim(fagyaszt([sos(title)]))
    expect(eredmeny.allapot).toBe('KITOLTVE')
    expect(cimek(eredmeny)).toEqual([SOS_CIM_UJ])
    expect(eredmeny.naplo[0]?.regiCim).toBe(typeof title === 'string' ? title : null)
    expect(eredmeny.naplo[0]?.uzenet).toContain(
      'az üres cím helyére „Ingyenes villámkurzus” került',
    )
  })

  it('a kulcs nélküli (title mező nélküli) blokkot is kitölti', () => {
    const cimNelkul = sos(null)
    delete cimNelkul.title
    expect('title' in cimNelkul).toBe(false)
    const eredmeny = kitoltSosCim(fagyaszt([cimNelkul]))
    expect(eredmeny.allapot).toBe('KITOLTVE')
    expect(cimek(eredmeny)).toEqual([SOS_CIM_UJ])
  })
})

describe('sos-cim-kitoltes: mihez NEM nyúl', () => {
  it.each([
    ['a seed kettőspontos alakja', SEED_CIM],
    ['a nagykötőjeles változat', NAGYKOTOJELES_CIM],
    ['szerkesztői szöveg', 'Próbáld ki ingyen a villámkurzust'],
    ['a régi alak kisbetűs eltéréssel', SOS_CIM_REGI.toLowerCase()],
    ['a régi alak szóköz nélküli kvirtmínusszal', 'SOS Kézrelax\u2014ingyenes villámkurzus'],
    ['a régi alak toldalékkal', `${SOS_CIM_REGI}!`],
  ])('%s érintetlen marad', (_nev, title) => {
    const bemenet = fagyaszt([sos(title)])
    const eredmeny = kitoltSosCim(bemenet)
    expect(eredmeny.allapot).toBe('ERINTETLEN')
    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.naplo[0]).toMatchObject({ allapot: 'ERINTETLEN', regiCim: title })
    expect(eredmeny.naplo[0]?.uzenet).toContain('szerkesztői szövegként érintetlen marad')
    expect(bemenet[0]?.title).toBe(title)
  })

  it('nem szöveg címhez sem nyúl, és nem dob', () => {
    for (const title of [42, true, { szoveg: SOS_CIM_REGI }, [SOS_CIM_REGI]]) {
      const eredmeny = kitoltSosCim(fagyaszt([sos(title)]))
      expect(eredmeny.allapot).toBe('ERINTETLEN')
      expect(eredmeny.layout).toBeNull()
      expect(eredmeny.naplo[0]?.regiCim).toBeNull()
      expect(eredmeny.naplo[0]?.uzenet).toContain('a cím nem szöveg')
    }
  })

  it('más blokktípus régi alakú címéhez sem nyúl (csak a freeSos a célpont)', () => {
    const bemenet = fagyaszt([...tobbi])
    const eredmeny = kitoltSosCim(bemenet)
    expect(eredmeny).toEqual({ allapot: 'NINCS_FREESOS', layout: null, naplo: [] })
  })
})

describe('sos-cim-kitoltes: ismételt futás, több blokk, rossz alak', () => {
  it('a második futás MAR, és nem ír', () => {
    const elso = kitoltSosCim(fagyaszt([tobbi[0], sos(SOS_CIM_REGI)]))
    expect(elso.allapot).toBe('KITOLTVE')
    const masodik = kitoltSosCim(fagyaszt(elso.layout))
    expect(masodik.allapot).toBe('MAR')
    expect(masodik.layout).toBeNull()
    expect(masodik.naplo[0]?.uzenet).toBe(
      'Kezdőlap, 2. szekció (SOS-sáv, azonosító: sos-1): a cím már „Ingyenes villámkurzus”, nincs teendő.',
    )
  })

  it('a szélső szóközös célértéket is MAR-nak veszi (a lap trimelve mutatja)', () => {
    expect(sosCimAllapota(`  ${SOS_CIM_UJ} `)).toBe('MAR')
    expect(kitoltSosCim(fagyaszt([sos(` ${SOS_CIM_UJ}`)])).allapot).toBe('MAR')
  })

  it('a bemenetet nem módosítja; a nem érintett blokkok ugyanazok az objektumok', () => {
    const bemenet = [tobbi[0], sos(SOS_CIM_REGI, 'a'), sos(SEED_CIM, 'b'), tobbi[1]]
    const pillanatkep = JSON.stringify(bemenet)
    const eredmeny = kitoltSosCim(fagyaszt(bemenet))
    expect(JSON.stringify(bemenet)).toBe(pillanatkep)
    expect(eredmeny.layout).not.toBe(bemenet)
    expect(eredmeny.layout?.[0]).toBe(bemenet[0])
    expect(eredmeny.layout?.[1]).not.toBe(bemenet[1])
    expect(eredmeny.layout?.[2]).toBe(bemenet[2])
    expect(eredmeny.layout?.[3]).toBe(bemenet[3])
  })

  it('több SOS-sávnál blokkonként dönt és naplóz; ismételve MAR', () => {
    const bemenet = fagyaszt([
      sos(SOS_CIM_REGI, 'a'),
      sos(SEED_CIM, 'b'),
      sos('', 'c'),
      sos(SOS_CIM_UJ, 'd'),
    ])
    const eredmeny = kitoltSosCim(bemenet)
    expect(eredmeny.allapot).toBe('KITOLTVE')
    expect(cimek(eredmeny)).toEqual([SOS_CIM_UJ, SEED_CIM, SOS_CIM_UJ, SOS_CIM_UJ])
    expect(eredmeny.naplo.map((sor) => [sor.blokkId, sor.allapot])).toEqual([
      ['a', 'KITOLTVE'],
      ['b', 'ERINTETLEN'],
      ['c', 'KITOLTVE'],
      ['d', 'MAR'],
    ])
    const ujra = kitoltSosCim(fagyaszt(eredmeny.layout))
    expect(ujra.allapot).toBe('MAR')
    expect(ujra.layout).toBeNull()
    expect(ujra.naplo.map((sor) => sor.allapot)).toEqual(['MAR', 'ERINTETLEN', 'MAR', 'MAR'])
  })

  it.each([undefined, null, 'layout', 42, {}, { 0: sos(SOS_CIM_REGI) }])(
    'nem tömb bemenetre NINCS_FREESOS, dobás nélkül: %j',
    (layout) => {
      expect(kitoltSosCim(layout)).toEqual({ allapot: 'NINCS_FREESOS', layout: null, naplo: [] })
    },
  )

  it('a tömb rossz alakú elemeit átugorja és változatlanul továbbadja', () => {
    const bemenet = fagyaszt([null, 7, 'szoveg', [sos(SOS_CIM_REGI)], sos(SOS_CIM_REGI, '')])
    const eredmeny = kitoltSosCim(bemenet)
    expect(eredmeny.allapot).toBe('KITOLTVE')
    expect(eredmeny.layout?.slice(0, 4)).toEqual([null, 7, 'szoveg', [sos(SOS_CIM_REGI)]])
    expect(eredmeny.naplo).toHaveLength(1)
    expect(eredmeny.naplo[0]).toMatchObject({ index: 4, blokkId: null })
    expect(eredmeny.naplo[0]?.uzenet).toMatch(/^Kezdőlap, 5\. szekció \(SOS-sáv\): /)
  })

  it('az oldalnév a naplósor elejére kerül; a naplóban nincs töltelék-gondolatjel', () => {
    const eredmeny = kitoltSosCim(fagyaszt([sos('')]), 'Próbaoldal')
    expect(eredmeny.naplo[0]?.uzenet.startsWith('Próbaoldal, 1. szekció')).toBe(true)
    for (const title of ['', SOS_CIM_UJ, SEED_CIM, 42]) {
      const [sor] = kitoltSosCim([sos(title)]).naplo
      expect(sor?.uzenet).not.toMatch(/[\u2013\u2014]/)
    }
  })
})
