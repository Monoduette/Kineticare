import { readFileSync } from 'node:fs'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  LoginForm,
  URES_BELEPES_EMAIL_HIBA,
  URES_BELEPES_JELSZO_HIBA,
} from '../components/auth/LoginForm'

const FORRAS = readFileSync(new URL('../components/auth/LoginForm.tsx', import.meta.url), 'utf8')

describe('LoginForm — mezőhiba és állandó élő régió (U-05, U-06)', () => {
  it('az üres beküldés mezőhibája magyar, gondolatjel nélkül', () => {
    expect(URES_BELEPES_EMAIL_HIBA).toBe('Add meg az e-mail-címed.')
    expect(URES_BELEPES_JELSZO_HIBA).toBe('Add meg a jelszavad.')
    expect(URES_BELEPES_EMAIL_HIBA).not.toMatch(/[–—]/)
    expect(URES_BELEPES_JELSZO_HIBA).not.toMatch(/[–—]/)
  })

  it('a mezőhiba a Field error propján megy (aria-invalid), a szerverhiba a form-dobozba', () => {
    expect(FORRAS).toContain('error={emailError ?? undefined}')
    expect(FORRAS).toContain('error={passwordError ?? undefined}')
    expect(FORRAS).toContain('setFormError(result.message ?? null)')
    expect(FORRAS).toContain('role="alert"')
    expect(FORRAS).toContain('aria-live="assertive"')
    expect(FORRAS).not.toContain("error ? (")
  })

  it('az űrlap alapállapota nem mutat mezőhibát', () => {
    const html = renderToStaticMarkup(createElement(LoginForm, { returnUrl: '/kurzusaim' }))
    expect(html).not.toContain(URES_BELEPES_EMAIL_HIBA)
    expect(html).not.toContain(URES_BELEPES_JELSZO_HIBA)
    expect(html).toContain('role="alert"')
    expect(html).not.toContain('aria-invalid')
  })
})
