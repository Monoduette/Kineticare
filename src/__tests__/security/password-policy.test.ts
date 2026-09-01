import { describe, expect, it } from 'vitest'

import {
  formatPasswordPolicyErrors,
  PASSWORD_MIN_LENGTH,
  validatePasswordStrength,
} from '../../lib/security/password-policy'

/**
 * A tiszta validatePasswordStrength függvény unit-tesztjei.
 * Payload-mock szándékosan nincs: a politika framework-független.
 */

describe('validatePasswordStrength', () => {
  it('elfogadja az erős, minden szabálynak megfelelő jelszót', () => {
    expect(validatePasswordStrength({ password: 'DUMMY-Eros-Teszt-Jelszo-42' })).toEqual([])
  })

  it('elfogadja az ékezetes karaktereket tartalmazó erős jelszót', () => {
    expect(validatePasswordStrength({ password: 'ÁrvíztűrőTükör42' })).toEqual([])
    expect(validatePasswordStrength({ password: 'ŐrültÜgyvéd2024Nyár' })).toEqual([])
  })

  it('visszautasítja a túl rövid jelszót', () => {
    const errors = validatePasswordStrength({ password: 'Rovid1Aa' })
    expect(errors.some((msg) => msg.includes(`${PASSWORD_MIN_LENGTH} karakter`))).toBe(true)
  })

  it('a hosszt Unicode kódpontban méri (az ékezetes karakter is egynek számít)', () => {
    // 11 kódpont + szám és nagybetű rendben → csak a hossz miatt bukik.
    const errors = validatePasswordStrength({ password: 'Árvíztűr1ab' })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain(`${PASSWORD_MIN_LENGTH} karakter`)
  })

  it('visszautasítja a nagybetű nélküli jelszót', () => {
    const errors = validatePasswordStrength({ password: 'csakiskisbetu123' })
    expect(errors.some((msg) => msg.includes('nagybetűt'))).toBe(true)
  })

  it('visszautasítja a kisbetű nélküli jelszót', () => {
    const errors = validatePasswordStrength({ password: 'DUMMYNAGYBETU123' })
    expect(errors.some((msg) => msg.includes('kisbetűt'))).toBe(true)
  })

  it('visszautasítja a szám nélküli jelszót', () => {
    const errors = validatePasswordStrength({ password: 'NincsBenneSzamjegy' })
    expect(errors.some((msg) => msg.includes('számot'))).toBe(true)
  })

  it('visszautasítja, ha a jelszó tartalmazza az e-mail local-partját', () => {
    const errors = validatePasswordStrength({
      password: 'DUMMY-Eros-Teszt-Jelszo-42',
      email: 'dummy.teszt@example.hu',
    })
    // A local-part "dummy.teszt" - a pontos local-partot nem tartalmazza.
    expect(errors).toEqual([])

    const hits = validatePasswordStrength({
      password: 'DUMMY.tesztA12345',
      email: 'dummy.teszt@example.hu',
    })
    expect(hits.some((msg) => msg.includes('e-mail-címedet'))).toBe(true)
  })

  it('az e-mail-egyezés kis-/nagybetű-érzéketlen', () => {
    const errors = validatePasswordStrength({
      password: 'DUMMY.TESZTa12345',
      email: 'dummy.teszt@example.hu',
    })
    expect(errors.some((msg) => msg.includes('e-mail-címedet'))).toBe(true)
  })

  it('e-mail nélkül is működik (pl. e-mailt nem módosító update)', () => {
    expect(validatePasswordStrength({ password: 'DUMMY-Eros-Teszt-Jelszo-42' })).toEqual([])
  })

  it('több szabálysértés esetén az összes hibaüzenetet visszaadja', () => {
    const errors = validatePasswordStrength({ password: 'rovid' })
    expect(errors.length).toBeGreaterThanOrEqual(3) // hossz + nagybetű + szám
  })
})

describe('formatPasswordPolicyErrors', () => {
  it('egyetlen magyar üzenetté fűzi össze a hibákat', () => {
    const message = formatPasswordPolicyErrors(['Első hiba.', 'Második hiba.'])
    expect(message).toBe('Első hiba. Második hiba.')
  })
})
