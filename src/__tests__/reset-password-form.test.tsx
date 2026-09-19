import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import ResetPasswordPage from '../app/(frontend)/jelszo-visszaallitas/page'
import {
  RESET_OTHER_DEVICES_NOTE,
  RESET_SUCCESS_NEXT_STEP,
  RESET_SUCCESS_NEXT_STEP_PLAYER,
  ResetPasswordForm,
} from '../components/auth/ResetPasswordForm'

/**
 * A ResetPasswordForm siker-ága kliens-állapot (`done`), a statikus markup
 * az űrlapot adja. A második mondat exportált konstans: a szöveg és a
 * success-panel osztálya innen mérhető anélkül, hogy a formot mountolnánk.
 */
describe('ResetPasswordForm — más eszközök kijelentkezése (J2)', () => {
  it('a siker-mondat natív magyar, nincs gondolatjel, és a meglévő note-osztályt viszi', async () => {
    const source = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../components/auth/ResetPasswordForm.tsx', import.meta.url), 'utf8'),
    )
    expect(source).toContain('kc-auth-success__note')
    expect(source).toContain('{RESET_OTHER_DEVICES_NOTE}')
    expect(RESET_OTHER_DEVICES_NOTE).toBe('A többi eszközön ki leszel jelentkeztetve.')
    expect(RESET_OTHER_DEVICES_NOTE).not.toMatch(/[–—]/)
    expect(RESET_SUCCESS_NEXT_STEP).toContain('Kurzusaim oldalra')
    expect(RESET_SUCCESS_NEXT_STEP).not.toMatch(/[–—]/)
    expect(RESET_SUCCESS_NEXT_STEP_PLAYER).toContain('továbbléphetsz a kurzushoz')
    expect(RESET_SUCCESS_NEXT_STEP_PLAYER).not.toMatch(/[–—]/)
    expect(source).toContain(
      "ctaLabel(isMyCoursePlayerHref(safeReturn) ? 'course-start' : 'my-courses-open')",
    )
    expect(source).toContain('RESET_SUCCESS_NEXT_STEP_PLAYER')
    expect(source).not.toContain('href="/belepes"')
  })

  it('az űrlap alapállapota NEM mutatja a siker-mondatot', () => {
    const html = renderToStaticMarkup(
      createElement(ResetPasswordForm, { token: 'DUMMY-RESET-TOKEN' }),
    )
    expect(html).not.toContain(RESET_OTHER_DEVICES_NOTE)
    expect(html).toContain('Új jelszó')
    expect(html).toContain('Új jelszó még egyszer')
    expect(html).not.toContain('mégegyszer')
  })
})

describe('/jelszo-visszaallitas — hiányzó token', () => {
  it('a visszaállító kérés viszi a returnUrl-t, nem csupasz /elfelejtett-jelszo', async () => {
    const html = renderToStaticMarkup(
      await ResetPasswordPage({
        searchParams: Promise.resolve({ returnUrl: '/kurzusaim/12' }),
      }),
    )
    expect(html).toContain('Hiányzik a visszaállító token')
    expect(html).toContain('href="/elfelejtett-jelszo?returnUrl=%2Fkurzusaim%2F12"')
  })
})
