import { describe, expect, it } from 'vitest'

import {
  KEZDOLAP_BEMUTATKOZAS,
  KEZDOLAP_BEMUTATKOZAS_CIM,
  KEZDOLAP_BEMUTATKOZAS_KIEMELES,
  ROLUNK_BEMUTATKOZAS,
  ROLUNK_BEMUTATKOZAS_CIM,
  ROLUNK_BEMUTATKOZAS_KIEMELES,
  WP18_KOZOS_BEMUTATKOZAS,
} from '../lib/rolunk-bemutatkozas'

/**
 * WP37 őr: a kezdőlap és a /rolunk bemutatkozása két KÜLÖN szöveg (tulajdonosi
 * kérés, 2026-09-08). A mérhető szabályok: nincs közös hatszavas szókapcsolat,
 * nincs töltelék gondolatjel (docs/ui-sztenderdek.md §3.1), GOV.UK-mondathossz
 * (25 szó alatt) és bekezdéshossz (legfeljebb 5 mondat), a kiírt szószám-sáv,
 * a Rólunk-cím a `.kc-about__title` 62ch mértékén belül.
 */

const szavak = (szoveg: string): string[] => szoveg.split(/\s+/).filter(Boolean)
const mondatok = (szoveg: string): string[] => szoveg.split(/(?<=[.!?])\s+/).filter(Boolean)
const normalizalt = (szoveg: string): string[] =>
  szoveg
    .toLowerCase()
    .replace(/[.,:;!?()„”"]/g, '')
    .split(/\s+/)
    .filter(Boolean)
const nGramok = (szoveg: string, n: number): Set<string> => {
  const w = normalizalt(szoveg)
  const halmaz = new Set<string>()
  for (let i = 0; i + n <= w.length; i += 1) halmaz.add(w.slice(i, i + n).join(' '))
  return halmaz
}

const kezdolap = [KEZDOLAP_BEMUTATKOZAS_CIM, ...KEZDOLAP_BEMUTATKOZAS].join(' ')
const rolunk = [ROLUNK_BEMUTATKOZAS_CIM, ...ROLUNK_BEMUTATKOZAS].join(' ')

describe('bemutatkozás-szétválasztás (WP37)', () => {
  it('a két szöveg között nincs közös hatszavas szókapcsolat', () => {
    const kozos = [...nGramok(kezdolap, 6)].filter((g) => nGramok(rolunk, 6).has(g))
    expect(kozos).toEqual([])
  })

  it('a két cím különbözik; a kezdőlapé a tulajdonos által kért „Megérdemled a profi törődést”', () => {
    expect(KEZDOLAP_BEMUTATKOZAS_CIM).toBe('Megérdemled a profi törődést')
    expect(ROLUNK_BEMUTATKOZAS_CIM).not.toBe(KEZDOLAP_BEMUTATKOZAS_CIM)
    // A Rólunk-cím 2–5 szó, és belefér a cím 62ch mértékébe egy sorban.
    expect(szavak(ROLUNK_BEMUTATKOZAS_CIM).length).toBeGreaterThanOrEqual(2)
    expect(szavak(ROLUNK_BEMUTATKOZAS_CIM).length).toBeLessThanOrEqual(6)
    expect(ROLUNK_BEMUTATKOZAS_CIM.length).toBeLessThanOrEqual(62)
  })

  it('egyik szöveg sem a WP18-as közös bekezdéseket viszi', () => {
    for (const regi of WP18_KOZOS_BEMUTATKOZAS.paragraphs) {
      expect(KEZDOLAP_BEMUTATKOZAS).not.toContain(regi)
      expect(ROLUNK_BEMUTATKOZAS).not.toContain(regi)
    }
  })

  it.each([
    ['kezdőlap', KEZDOLAP_BEMUTATKOZAS, 90, 130],
    ['rólunk', ROLUNK_BEMUTATKOZAS, 100, 150],
  ] as const)(
    '%s: 2–3 bekezdés, kiírt szószám, rövid mondatok, nincs gondolatjel',
    (_, lista, min, max) => {
      expect(lista.length).toBeGreaterThanOrEqual(2)
      expect(lista.length).toBeLessThanOrEqual(3)
      const osszes = lista.reduce((acc, p) => acc + szavak(p).length, 0)
      expect(osszes).toBeGreaterThanOrEqual(min)
      expect(osszes).toBeLessThanOrEqual(max)
      for (const bekezdes of lista) {
        expect(bekezdes).not.toMatch(/[–—]/)
        const m = mondatok(bekezdes)
        expect(m.length).toBeGreaterThanOrEqual(2)
        expect(m.length).toBeLessThanOrEqual(5)
        for (const mondat of m) expect(szavak(mondat).length).toBeLessThanOrEqual(25)
      }
    },
  )

  it('a kezdőlap konkrét: mindkét név, mindkét egyetem, a rendelők száma és helye', () => {
    expect(kezdolap).toContain('Kocsis Kata')
    expect(kezdolap).toContain('Kiss Kata')
    expect(kezdolap).toContain('Pécsi Tudományegyetem')
    expect(kezdolap).toContain('Semmelweis Egyetem')
    expect(kezdolap).toContain('két budapesti rendelő')
  })

  it('a kiemelés címkéje közös, a Rólunk jegyzete bővebb, gondolatjel nélkül', () => {
    expect(ROLUNK_BEMUTATKOZAS_KIEMELES.label).toBe(KEZDOLAP_BEMUTATKOZAS_KIEMELES.label)
    expect(ROLUNK_BEMUTATKOZAS_KIEMELES.note.length).toBeGreaterThan(
      KEZDOLAP_BEMUTATKOZAS_KIEMELES.note.length,
    )
    expect(ROLUNK_BEMUTATKOZAS_KIEMELES.note).not.toMatch(/[–—]/)
    expect(KEZDOLAP_BEMUTATKOZAS_KIEMELES.note).not.toMatch(/[–—]/)
  })
})
