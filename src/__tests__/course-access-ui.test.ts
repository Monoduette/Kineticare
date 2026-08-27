import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CoursePlayer } from '../components/account/CoursePlayer'
import {
  ACCESS_GRANT_PENDING_MESSAGE,
  ACCESS_LOOKUP_FAILED_MESSAGE,
  accessExpiredMessage,
} from '../lib/course-access'
import { buildCurriculum } from '../lib/curriculum/curriculum'

/**
 * A1 — a hozzáférés lejáratának MEGJELENÍTÉSE (lejátszó).
 *
 * A szabály maga (és a lejárat számítása) az src/__tests__/course-access.test.ts
 * hatóköre; itt csak azt ellenőrizzük, hogy a kész, magyar szövegek és a
 * célhivatkozások a helyükre kerülnek.
 *
 * A KURZUSAIM-LISTA A1-őrei átköltöztek: a lista kártya-nézetté alakult
 * (tananyag-alapú haladás + állapotfüggő CTA), ezért a lejárat-sor, a lejárt
 * üzenet és a nyilvános kurzusoldalra mutató link ellenőrzése a
 * src/__tests__/course-list-ui.test.ts „CourseList — megjelenítés" blokkjában
 * él tovább, a lista új szerződésével.
 */

const EXPIRED_MESSAGE = accessExpiredMessage(new Date('2027-03-04T12:00:00.000Z'))

/**
 * A lejátszó bemenete a TANANYAG-MODELL lett (`buildCurriculum`) a nyers
 * `videos` tömb helyett — a kapuzott (hozzáférés nélküli) ág ettől nem
 * változott, ezért itt üres tananyag is elég.
 */
const EMPTY_CURRICULUM = buildCurriculum({ modules: [], videos: [] }, false)

describe('CoursePlayer — lejárt hozzáférés', () => {
  it('lejárat esetén nem a „nem vetted meg" szöveget mutatja, és nem tölt be videót', () => {
    const html = renderToStaticMarkup(
      createElement(CoursePlayer, {
        product: { id: 42, title: 'Kézrehab alapkurzus' },
        curriculum: EMPTY_CURRICULUM,
        hasAccess: false,
        expiredMessage: EXPIRED_MESSAGE,
      }),
    )
    expect(html).toContain('Lejárt a hozzáférésed')
    expect(html).toContain('2027. 03. 04.')
    expect(html).not.toContain('megvásárlása szükséges')
    expect(html).not.toContain('<iframe')
  })

  it('vásárlás nélkül a korábbi üzenet marad (nem lejárat-specifikus)', () => {
    const html = renderToStaticMarkup(
      createElement(CoursePlayer, {
        product: { id: 42, title: 'Kézrehab alapkurzus' },
        curriculum: EMPTY_CURRICULUM,
        hasAccess: false,
      }),
    )
    expect(html).toContain('Nincs hozzáférésed ehhez a kurzushoz')
    expect(html).toContain('megvásárlása szükséges')
  })
})

describe('CoursePlayer — lookup-hiba és grant-pending (nem lejárat)', () => {
  it('lookup-failed: nincs Lejárt, nincs értékesítési CTA', () => {
    const html = renderToStaticMarkup(
      createElement(CoursePlayer, {
        product: { id: 42, title: 'Kézrehab alapkurzus' },
        curriculum: EMPTY_CURRICULUM,
        hasAccess: false,
        expiredMessage: ACCESS_LOOKUP_FAILED_MESSAGE,
        gateKind: 'lookup-failed',
      }),
    )
    expect(html).toContain('A kurzus most nem nyitható meg')
    expect(html).toContain(ACCESS_LOOKUP_FAILED_MESSAGE)
    expect(html).not.toContain('Lejárt a hozzáférésed')
    expect(html).not.toContain('megvásárlása szükséges')
    expect(html).toContain('/kurzusaim/42')
    expect(html).toContain('/kapcsolat')
    expect(html).not.toContain('/kurzusok/42')
  })

  it('grant-pending: nincs értékesítési CTA', () => {
    const html = renderToStaticMarkup(
      createElement(CoursePlayer, {
        product: { id: 42, title: 'Kézrehab alapkurzus' },
        curriculum: EMPTY_CURRICULUM,
        hasAccess: false,
        expiredMessage: ACCESS_GRANT_PENDING_MESSAGE,
        gateKind: 'grant-pending',
      }),
    )
    expect(html).toContain('A kurzus most nem nyitható meg')
    expect(html).toContain(ACCESS_GRANT_PENDING_MESSAGE)
    expect(html).not.toContain('Lejárt a hozzáférésed')
  })
})
