import { hu } from '@payloadcms/translations/languages/hu'
import type { Field } from 'payload'
import { describe, expect, it } from 'vitest'

import {
  faq,
  FAQ_KERDES_HIANYZIK,
  FAQ_VALASZ_HIANYZIK,
  validateFaqAnswer,
  validateFaqQuestion,
} from '../blocks/faq'
import { HU_ADMIN_FORDITAS } from '../lib/admin/hu-forditas'

/**
 * A GYIK-blokk kötelező kérdés- és válaszmezőjének saját ellenőrzése (K20).
 *
 * Kiinduló, mért hiba (admin-audit, seta/t7err.json): az üresen hagyott
 * GYIK-sor a közzétételt a Payload „Ez a mező kötelező.” üzenetével és egy
 * belső útvonal-listával tiltotta, teendő nélkül. A mező melletti üzenet most
 * cselekvő (GOV.UK: „use an instruction for empty fields”), és a törlés útját a
 * felület tényleges magyar gombnevével adja.
 *
 * Négy szerződés:
 *  1. üres, hiányzó és csak szóközből álló értékre a cselekvő üzenet jön;
 *  2. kitöltött értéknél a Payload ALAP text/textarea validátora tovább fut
 *     (hossz-korlátok), mert a saját `validate` a beépítettet lecseréli;
 *  3. a mezők `required: true` beállítása megmaradt (séma: NOT NULL);
 *  4. az üzenetben a törlés gombneve a Payload magyar felületének tényleges
 *     szövege (a core `general:remove`, ha a saját fordítás nem írja felül).
 */

type KerdesOpciok = Parameters<typeof validateFaqQuestion>[1]
type ValaszOpciok = Parameters<typeof validateFaqAnswer>[1]

/** Kulcsot visszaadó fordító: így látszik, melyik alapüzenet jött. */
function t(kulcs: string, valtozok?: Record<string, unknown>): string {
  return valtozok ? `${kulcs} ${JSON.stringify(valtozok)}` : kulcs
}

function opciok(extra: Record<string, unknown> = {}, config: Record<string, unknown> = {}) {
  return { req: { payload: { config }, t }, required: true, ...extra }
}

const kerdesOpciok = (extra?: Record<string, unknown>, config?: Record<string, unknown>) =>
  opciok(extra, config) as unknown as KerdesOpciok
const valaszOpciok = (extra?: Record<string, unknown>, config?: Record<string, unknown>) =>
  opciok(extra, config) as unknown as ValaszOpciok

/** A GYIK-sor mezője név szerint (a blokk `items` tömbjéből). */
function sorMezo(nev: string): Field | undefined {
  const items = faq.fields.find((field) => 'name' in field && field.name === 'items')
  const mezok = items && items.type === 'array' ? items.fields : []
  return mezok.find((field) => 'name' in field && field.name === nev)
}

describe('GYIK-blokk: üres kérdés és válasz', () => {
  it.each([
    ['hiányzó érték', undefined],
    ['null', null],
    ['üres szöveg', ''],
  ])('üres kérdés (%s) → cselekvő üzenet', (_eset, ertek) => {
    expect(validateFaqQuestion(ertek, kerdesOpciok())).toBe(FAQ_KERDES_HIANYZIK)
  })

  it.each([
    ['hiányzó érték', undefined],
    ['null', null],
    ['üres szöveg', ''],
  ])('üres válasz (%s) → cselekvő üzenet', (_eset, ertek) => {
    expect(validateFaqAnswer(ertek, valaszOpciok())).toBe(FAQ_VALASZ_HIANYZIK)
  })

  it.each([['   '], ['\n\t  '], ['\u00a0 ']])(
    'csak szóközből álló érték (%j) is üresnek számít, mindkét mezőn',
    (ertek) => {
      // A Payload beépített text-validátora a szóköz-only értéket átengedné
      // (payload/dist/fields/validations.js: `!value || value.length === 0`).
      expect(validateFaqQuestion(ertek, kerdesOpciok())).toBe(FAQ_KERDES_HIANYZIK)
      expect(validateFaqAnswer(ertek, valaszOpciok())).toBe(FAQ_VALASZ_HIANYZIK)
    },
  )

  it('az üzenet cselekvő, tegező, és megmondja a törlés útját', () => {
    expect(FAQ_KERDES_HIANYZIK).toMatch(/^Írd be a kérdést, vagy töröld ezt a sort/)
    expect(FAQ_VALASZ_HIANYZIK).toMatch(/^Írd be a választ, vagy töröld ezt a sort/)
    for (const uzenet of [FAQ_KERDES_HIANYZIK, FAQ_VALASZ_HIANYZIK]) {
      expect(uzenet).toContain('⋯')
      // A §3.1 tipográfiája: gondolatjel, egyenes idézőjel és „érvénytelen” nélkül.
      expect(uzenet).not.toMatch(/—|\s–\s|["“]/)
      expect(uzenet.toLocaleLowerCase('hu')).not.toMatch(/érvénytelen|kérjük|kötelező/)
    }
  })

  it('a törlés gombneve a magyar admin tényleges szövege (general:remove)', () => {
    const felulirt: Record<string, unknown> = HU_ADMIN_FORDITAS.general
    const sajat = felulirt.remove
    const gombnev = typeof sajat === 'string' ? sajat : hu.translations.general.remove
    expect(gombnev).toBe('Törlés')
    expect(FAQ_KERDES_HIANYZIK).toContain(`majd ${gombnev}.`)
    expect(FAQ_VALASZ_HIANYZIK).toContain(`majd ${gombnev}.`)
  })
})

describe('GYIK-blokk: kitöltött érték, a Payload alap-validátora tovább fut', () => {
  it('kitöltött kérdés és válasz átmegy', () => {
    expect(validateFaqQuestion('Kell beutaló a kezeléshez?', kerdesOpciok())).toBe(true)
    expect(validateFaqAnswer('Nem kell beutaló.', valaszOpciok())).toBe(true)
  })

  it('a mező saját maxLength-je érvényesül (text és textarea)', () => {
    expect(validateFaqQuestion('a'.repeat(11), kerdesOpciok({ maxLength: 10 }))).toMatch(
      /^validation:shorterThanMax/,
    )
    expect(validateFaqAnswer('a'.repeat(11), valaszOpciok({ maxLength: 10 }))).toMatch(
      /^validation:shorterThanMax/,
    )
  })

  it('a config defaultMaxTextLength-je érvényesül', () => {
    expect(
      validateFaqQuestion('a'.repeat(6), kerdesOpciok({}, { defaultMaxTextLength: 5 })),
    ).toMatch(/^validation:shorterThanMax/)
    expect(validateFaqAnswer('a'.repeat(6), valaszOpciok({}, { defaultMaxTextLength: 5 }))).toMatch(
      /^validation:shorterThanMax/,
    )
  })

  it('a minLength is az alap-validátorból jön', () => {
    expect(validateFaqQuestion('abc', kerdesOpciok({ minLength: 5 }))).toMatch(
      /^validation:longerThanMin/,
    )
    expect(validateFaqAnswer('abc', valaszOpciok({ minLength: 5 }))).toMatch(
      /^validation:longerThanMin/,
    )
  })
})

describe('GYIK-blokk: a mezők bekötése', () => {
  it('a kérdés és a válasz kötelező maradt, és a saját validátort kapja', () => {
    const kerdes = sorMezo('question')
    const valasz = sorMezo('answer')
    expect(kerdes).toMatchObject({ type: 'text', required: true })
    expect(valasz).toMatchObject({ type: 'textarea', required: true })
    expect(kerdes && 'validate' in kerdes ? kerdes.validate : undefined).toBe(validateFaqQuestion)
    expect(valasz && 'validate' in valasz ? valasz.validate : undefined).toBe(validateFaqAnswer)
  })
})
