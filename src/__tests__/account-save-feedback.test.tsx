import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { GENERIC_UPDATE_ERROR } from '../lib/account-client'
import { ProfileSaveFeedback } from '../components/account/AccountView'

/**
 * A profilmentés visszajelzése — a hibaág NEM NÉMA (AccountView-fix).
 * A profilmentés (PATCH /api/users/me) hibája korábban semmilyen felületi
 * visszajelzést nem adott: a felhasználó azt hitte, elmentette az adatait,
 * közben nem történt mentés. A hibaág most az account-client magyar üzenetét
 * mutatja (role="alert"), a sikerág a megszokott „Mentve."-t.
 */

function render(node: ReactNode): string {
  return renderToStaticMarkup(createElement(Fragment, null, node))
}

describe('ProfileSaveFeedback — a mentés hibaága is magyar visszajelzést ad', () => {
  it('hiba: a kapott magyar üzenet role="alert"-tel jelenik meg', () => {
    const html = render(createElement(ProfileSaveFeedback, { saved: false, saveError: GENERIC_UPDATE_ERROR }))

    expect(html).toContain('role="alert"')
    expect(html).toContain(GENERIC_UPDATE_ERROR)
    expect(html).not.toContain('Mentve.')
  })

  it('a szerver/account-client által adott üzenet SZÓ SZERINT jelenik meg', () => {
    const message = 'A mentés most nem sikerült. Próbáld újra néhány perc múlva.'
    const html = render(createElement(ProfileSaveFeedback, { saved: false, saveError: message }))

    expect(html).toContain(message)
  })

  it('siker: a megszokott „Mentve." visszajelzés (role="status")', () => {
    const html = render(createElement(ProfileSaveFeedback, { saved: true, saveError: null }))

    expect(html).toContain('Mentve.')
    expect(html).toContain('role="status"')
    expect(html).not.toContain('role="alert"')
  })

  it('semmilyen állapotban nem renderel (nincs felesleges üres jelölés)', () => {
    const html = render(createElement(ProfileSaveFeedback, { saved: false, saveError: null }))

    expect(html).toBe('')
  })
})
