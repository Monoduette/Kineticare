import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  RESET_OTHER_DEVICES_NOTE,
  RESET_SUCCESS_NEXT_STEP,
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
    expect(RESET_SUCCESS_NEXT_STEP).toContain('kurzusaidhoz')
    expect(RESET_SUCCESS_NEXT_STEP).not.toMatch(/[–—]/)
    expect(source).toContain(
      "ctaLabel(isMyCoursePlayerHref(safeReturn) ? 'course-start' : 'my-courses-open')",
    )
    expect(source).not.toContain('href="/belepes"')
  })

  it('az űrlap alapállapota NEM mutatja a siker-mondatot', () => {
    const html = renderToStaticMarkup(
      createElement(ResetPasswordForm, { token: 'DUMMY-RESET-TOKEN' }),
    )
    expect(html).not.toContain(RESET_OTHER_DEVICES_NOTE)
    expect(html).toContain('Új jelszó')
  })
})
