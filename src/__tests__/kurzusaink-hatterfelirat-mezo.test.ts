import { describe, expect, it } from 'vitest'

import { courseCards, HATTERFELIRAT_MAX_HOSSZ, validateHatterFelirat } from '../blocks/course-cards'
import { COURSE_SHOWCASE_MARK } from '../lib/course-showcase'

/**
 * H22: a Kurzuskártyák (courseCards) „Háttérfelirat” mezője, a „Kurzusaink”
 * vízjel szava.
 *
 * - a mező a `lead` után, a `ctaLabel` előtt áll, szöveg típusú, nem kötelező;
 * - a súgó a beépített szót a src/lib/course-showcase.ts konstansából veszi
 *   (import, nem másolat), és kimondja az üres állapotot;
 * - a validate a mért korlát (10 karakter, mérés: src/blocks/course-cards.ts
 *   fejkommentje) fölött magyar hibát ad, alatta és üresen igazat.
 */

type Mezo = (typeof courseCards.fields)[number]

function mezo(nev: string): Mezo | undefined {
  return courseCards.fields.find((field) => 'name' in field && field.name === nev)
}

function leiras(field: Mezo | undefined): string {
  const admin = field && 'admin' in field ? field.admin : undefined
  const description = admin && 'description' in admin ? admin.description : undefined
  return typeof description === 'string' ? description : ''
}

describe('courseCards: a Háttérfelirat mező helye és alakja', () => {
  const nevek = courseCards.fields.map((field) => ('name' in field ? field.name : field.type))

  it('a `lead` után, a `ctaLabel` előtt áll', () => {
    const index = nevek.indexOf('hatterFelirat')
    expect(index).toBe(nevek.indexOf('lead') + 1)
    expect(nevek[index + 1]).toBe('ctaLabel')
  })

  it('nem kötelező szövegmező, vessző nélküli címkével (blokknevek.test.ts szabálya)', () => {
    const field = mezo('hatterFelirat')
    expect(field).toMatchObject({ type: 'text', label: 'Háttérfelirat (a nagy és halvány szó)' })
    expect(field && 'required' in field ? field.required : undefined).toBeFalsy()
    const label = field && 'label' in field ? field.label : undefined
    expect(String(label)).not.toContain(',')
  })

  it('a súgó a COURSE_SHOWCASE_MARK értékével mondja ki az üres állapotot', () => {
    expect(COURSE_SHOWCASE_MARK).toBe('Kurzusaink')
    const szoveg = leiras(mezo('hatterFelirat'))
    expect(szoveg).toContain(`Ha üresen hagyod, ez látszik: „${COURSE_SHOWCASE_MARK}”.`)
    expect(szoveg).toContain(`legfeljebb ${HATTERFELIRAT_MAX_HOSSZ} karakter`)
    expect(szoveg).not.toMatch(/—|\s–\s|\s-\s|"|“|\.\.\./u)
  })

  it('a mező validate-je a közös ellenőrzőt hívja', () => {
    const field = mezo('hatterFelirat')
    const validate = field && 'validate' in field ? field.validate : undefined
    expect(typeof validate).toBe('function')
  })
})

describe('validateHatterFelirat: a mért 10 karakteres korlát', () => {
  it('a korlát 10, a beépített szó hossza', () => {
    expect(HATTERFELIRAT_MAX_HOSSZ).toBe(10)
    expect([...COURSE_SHOWCASE_MARK].length).toBe(HATTERFELIRAT_MAX_HOSSZ)
  })

  it('üresen, szóközökkel vagy nem szövegként igaz (a beépített szó marad)', () => {
    for (const ertek of [undefined, null, '', '   ', 42]) {
      expect(validateHatterFelirat(ertek)).toBe(true)
    }
  })

  it('10 karakterig igaz, ékezetes betűkkel is (karakter, nem bájt)', () => {
    expect(validateHatterFelirat('Kurzusaink')).toBe(true)
    expect(validateHatterFelirat('Képzéseink')).toBe(true)
    expect(validateHatterFelirat('  Szakkönyv  ')).toBe(true)
  })

  it('10 fölött magyar hibaüzenet a korláttal', () => {
    expect(validateHatterFelirat('Tanfolyamok')).toBe('Legfeljebb 10 karakter fér el a háttérben.')
    expect(validateHatterFelirat('Szakembereknek')).toBe(
      'Legfeljebb 10 karakter fér el a háttérben.',
    )
  })
})
