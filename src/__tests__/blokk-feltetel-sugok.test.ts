import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Block, Field } from 'payload'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { appointment } from '../blocks/appointment'
import { faq } from '../blocks/faq'
import { filmHero } from '../blocks/film-hero'
import { FaqBlock } from '../components/blocks/FaqBlock'
import { FilmHero } from '../components/blocks/FilmHero'
import { ctaLabel } from '../lib/cta-vocabulary'
import { appointmentCustomerEmail } from '../lib/email/templates/appointment'
import { SOS_COMPARISON_FAQ } from '../lib/sos-offer-copy'
import type { BlockFaq, BlockFilmHero } from '../payload-types'

/**
 * B7 (modul-térkép H16, H38, H44): három blokk súgója kimondja, amit a kód
 * csendben csinál.
 *
 *  - H16: az időpontkérő „A gomb felirata” mezője csak olvasható, és a súgó a
 *    szótári feliratot mondja (a mező neve, típusa és feltétele változatlan);
 *  - H44: a „Hogyan megy tovább?” és „A sikeres beküldés szövege” súgója a
 *    visszaigazoló e-mail ígéretét BETŰRE idézi, és ez az őr a sablonfüggvény
 *    kimenetével veti össze: ha a levél változik, a teszt bukik;
 *  - H38: a GYIK és a Nyitó videó gombjainak súgója kimondja a feltételes
 *    rejtést, és a súgóban megnevezett útvonalakra a komponens valóban úgy
 *    viselkedik, ahogy a súgó állítja.
 */

/** A súgóban idézett két levélrészlet (src/lib/email/templates/appointment.ts). */
const LEVEL_HATARIDO = 'két munkanapon belül telefonon keresünk'
const LEVEL_ELSO_ALKALOM = 'Az első alkalom minden esetben 50 perces vizsgálattal kezdődik.'

function mezo(fields: readonly Field[], nev: string): Field | undefined {
  return fields.find((field) => 'name' in field && field.name === nev)
}

function leiras(block: Block, nev: string): string {
  const field = mezo(block.fields, nev)
  const description = field?.admin && 'description' in field.admin ? field.admin.description : null
  if (typeof description !== 'string') {
    throw new Error(`A(z) ${block.slug}.${nev} mezőnek nincs szöveges leírása.`)
  }
  return description
}

/** Gondolatjel (U+2013, U+2014) és felkiáltójel tilos az új súgószövegekben. */
const TILTOTT_JEL = /[–—!]/u

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Hálózat tiltva a súgó-tesztben')
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('H16: az időpontkérő gombfelirata csak olvasható, igaz súgóval', () => {
  const field = mezo(appointment.fields, 'gombFelirat')

  it('readOnly, a név, a típus és a feltétel változatlan', () => {
    expect(field?.type).toBe('text')
    if (field?.type !== 'text') return
    expect(field.name).toBe('gombFelirat')
    expect(field.admin?.readOnly).toBe(true)
    expect(typeof field.admin?.condition).toBe('function')
    const condition = field.admin?.condition
    if (typeof condition === 'function') {
      const felt = condition as (data: unknown, siblingData: unknown) => boolean
      expect(felt({}, { urlapMutatasa: true })).toBe(true)
      expect(felt({}, { urlapMutatasa: false })).toBe(false)
    }
    expect(field.required).toBeUndefined()
    expect(field.validate).toBeUndefined()
    expect(field.admin?.hidden).toBeUndefined()
  })

  it('a súgó a szótári feliratot mondja, és nem ígér felülírást', () => {
    const szoveg = leiras(appointment, 'gombFelirat')
    expect(szoveg).toContain(`„${ctaLabel('appointment-submit')}”`)
    expect(szoveg).toContain('a rendszer adja')
    expect(szoveg).toContain('nem jelenik meg')
    expect(szoveg).not.toContain('Üresen hagyva')
    expect(szoveg).not.toMatch(TILTOTT_JEL)
  })
})

describe('H44: a visszaigazoló e-mail ígérete a súgóban, betűre a sablonból', () => {
  const level = appointmentCustomerEmail({
    name: 'Teszt Elek',
    phone: '+36 30 000 0000',
    availability: 'Hétköznap délelőtt',
  })
  const levelLinkkel = appointmentCustomerEmail({
    name: 'Teszt Elek',
    phone: '+36 30 000 0000',
    availability: 'Hétköznap délelőtt',
    contactUrl: 'https://example.test/kapcsolat',
  })

  it('a sablon kimenete (szöveges és HTML) tartalmazza a két idézett részletet', () => {
    for (const email of [level, levelLinkkel]) {
      for (const reszlet of [LEVEL_HATARIDO, LEVEL_ELSO_ALKALOM]) {
        expect(email.text, reszlet).toContain(reszlet)
        expect(email.html, reszlet).toContain(reszlet)
      }
    }
  })

  it.each(['magyarazat', 'sikerSzoveg'])('a(z) %s súgója idézi a levelet', (nev) => {
    const szoveg = leiras(appointment, nev)
    expect(szoveg).toContain('visszaigazoló e-mail')
    expect(szoveg).toContain(`„${LEVEL_HATARIDO}”`)
    expect(szoveg).toContain(`„${LEVEL_ELSO_ALKALOM}”`)
    expect(szoveg).toContain('szólj a fejlesztőnek')
    expect(szoveg).not.toMatch(TILTOTT_JEL)
  })

  it('a Magyarázat súgója feltételes: csak űrlappal megy levél', () => {
    expect(leiras(appointment, 'magyarazat')).toContain(
      'Ha a szekcióban van űrlap, a beküldő visszaigazoló e-mailt is kap.',
    )
    // A Sikerszöveg csak űrlappal látszik (urlapLatszik), ott a feltétel adott.
    const siker = mezo(appointment.fields, 'sikerSzoveg')
    expect(typeof siker?.admin?.condition).toBe('function')
  })
})

describe('H38: a GYIK feltételes párja a súgóban', () => {
  const szoveg = leiras(faq, 'items')

  it('a súgó a kódbeli kérdést idézi, és a két kurzust a Kurzusokban látható nevén nevezi', () => {
    expect(szoveg).toContain(`„${SOS_COMPARISON_FAQ.question}”`)
    expect(szoveg).toContain('SOS Kézrelax villámkurzus')
    expect(szoveg).toContain('Otthoni KézRehab Program')
    expect(szoveg).toContain('a pár mindig látszik')
    expect(szoveg).toContain('formázás és link nélkül')
    expect(szoveg).not.toMatch(TILTOTT_JEL)
  })

  const blokk = (question: string, answer: string): BlockFaq => ({
    blockType: 'faq',
    id: 'gyik',
    items: [
      { id: 'sos', question, answer },
      { id: 'mas', question: 'Mennyi ideig érem el?', answer: 'Egy évig.' },
    ],
  })

  it('a súgó állítása igaz: az eredeti pár feltétellel látszik, az átírt mindig', () => {
    const eredeti = blokk(SOS_COMPARISON_FAQ.question, SOS_COMPARISON_FAQ.answer)
    const nelkule = renderToStaticMarkup(
      createElement(FaqBlock, { block: eredeti, hasSosComparison: false }),
    )
    const vele = renderToStaticMarkup(
      createElement(FaqBlock, { block: eredeti, hasSosComparison: true }),
    )
    expect(nelkule).not.toContain(SOS_COMPARISON_FAQ.question)
    expect(nelkule).toContain('Mennyi ideig érem el?')
    expect(vele).toContain(SOS_COMPARISON_FAQ.question)

    const atirt = blokk(SOS_COMPARISON_FAQ.question, `${SOS_COMPARISON_FAQ.answer} Kiegészítés.`)
    const atirtNelkule = renderToStaticMarkup(
      createElement(FaqBlock, { block: atirt, hasSosComparison: false }),
    )
    expect(atirtNelkule).toContain(SOS_COMPARISON_FAQ.question)
  })
})

describe('H38: a Nyitó videó feltételes gombjai a súgóban', () => {
  const szoveg = leiras(filmHero, 'ctas')

  it('a súgó kimondja mindkét feltételt', () => {
    expect(szoveg).toContain('Legfeljebb 2 gomb.')
    expect(szoveg).toContain('ingyenes')
    expect(szoveg).toContain('#ingyenes')
    expect(szoveg).toContain('Ingyenes villámkurzus sáv')
    expect(szoveg).toContain('a gomb kimarad')
    expect(szoveg).not.toMatch(TILTOTT_JEL)
  })

  /** A súgóban felsorolt SOS-kurzus-útvonalak („(a, b vagy c)”). */
  const kurzusUtak = (() => {
    const talalat = /SOS-kurzus oldalára visz \(([^)]+)\)/u.exec(szoveg)
    return talalat ? talalat[1].split(/, | vagy /u) : []
  })()

  const film = (url: string): BlockFilmHero => ({
    blockType: 'filmHero',
    title: 'Tesztfilm',
    ctas: [
      { id: 'sos', url, felirat: 'Ingyenes gomb' },
      { id: 'lista', url: '/kurzusok', felirat: 'Lista gomb' },
    ],
  })

  it('a súgó a kanonikus SOS-útvonalat és a tartalékokat is megnevezi', () => {
    expect(kurzusUtak).toContain('/kurzusok/sos-kezrelax-villamkurzus')
    expect(kurzusUtak.length).toBeGreaterThanOrEqual(2)
  })

  it('a súgóban megnevezett minden SOS-útvonal gombja ingyenes kurzus nélkül kimarad', () => {
    expect(kurzusUtak.length).toBeGreaterThan(0)
    for (const url of kurzusUtak) {
      const nincs = renderToStaticMarkup(
        createElement(FilmHero, { block: film(url), hasFreeSos: false }),
      )
      const van = renderToStaticMarkup(
        createElement(FilmHero, { block: film(url), hasFreeSos: true }),
      )
      expect(nincs, url).not.toContain('Ingyenes gomb')
      expect(nincs, url).toContain('Lista gomb')
      expect(van, url).toContain('Ingyenes gomb')
      expect(van, url).toContain(`href="${url}"`)
    }
  })

  it('a /#ingyenes gomb csak lejjebb álló sávval látszik, és oda visz', () => {
    const nincsSav = renderToStaticMarkup(
      createElement(FilmHero, { block: film('/#ingyenes'), hasFreeSos: true, freeSosHref: null }),
    )
    expect(nincsSav).not.toContain('Ingyenes gomb')
    const vanSav = renderToStaticMarkup(
      createElement(FilmHero, {
        block: film('/#ingyenes'),
        hasFreeSos: true,
        freeSosHref: '#sajat-sav',
        freeSosAnchorIds: ['sajat-sav'],
      }),
    )
    expect(vanSav).toContain('Ingyenes gomb')
    expect(vanSav).toContain('href="#sajat-sav"')
  })
})
