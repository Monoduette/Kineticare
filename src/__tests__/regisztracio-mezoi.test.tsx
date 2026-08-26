import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { RegisterForm } from '../components/auth/RegisterForm'
import { CheckoutForm } from '../components/checkout/CheckoutForm'
import { BILLING_INPUT_NAME } from '../lib/checkout/form-submission'

/**
 * ŐR — A REGISZTRÁCIÓ HÁROM MEZŐJE.
 * A tulajdonos 2026-08-17-i döntése: a regisztrációból kikerült az
 * összecsukható „Számlázási adatok (opcionális)" blokk, mert a számlázási
 * adatot ott kérjük, ahol számla készül belőle — a fizetés során.
 * Egy ilyen tétel visszacsúszása NÉMA: a lap fut, minden más teszt zöld, csak a
 */

const MARKUP = renderToStaticMarkup(createElement(RegisterForm, { returnUrl: '/fiok' }))

const REPO = fileURLToPath(new URL('..', import.meta.url))
const olvas = (relativUt: string): string => readFileSync(`${REPO}${relativUt}`, 'utf8')

/** A fejléc-komment maga is leírja a kivett mezőket — enélkül az őr vakon zöld. */
const kommentNelkul = (forras: string): string =>
  forras.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/**
 * A számlázási mezőnevek KIÍRVA, nem a kód konstansából származtatva: ha valaki
 * átnevezi a konstanst, az őr ne ürüljön ki némán. A két alak egyezését külön
 * állítás méri (lásd „a mezőnév-lista együtt mozog a pénztárral").
 */
const SZAMLAZASI_MEZOK = [
  'billingName',
  'billingZip',
  'billingCity',
  'billingStreet',
  'taxNumber',
] as const

describe('Regisztráció: három mező, több nincs', () => {
  it('pontosan három beviteli mező van a markupban', () => {
    const mezok = MARKUP.match(/<input\b[^>]*>/g) ?? []
    expect(
      mezok.map((m) => /name="([^"]+)"/.exec(m)?.[1] ?? '(névtelen)').sort(),
    ).toEqual(['email', 'name', 'password'])
  })

  it('egyetlen számlázási mező sincs a regisztrációban', () => {
    for (const mezo of SZAMLAZASI_MEZOK) {
      expect(MARKUP, `a(z) ${mezo} mező visszakerült a regisztrációba`).not.toContain(mezo)
    }
  })

  it('a „számlázás" szó sem jelenik meg a regisztrációs felületen', () => {
    expect(MARKUP.toLowerCase()).not.toContain('számláz')
  })

  it('nincs összecsukható blokk, amiben elrejtve visszajöhetne', () => {
    expect(MARKUP).not.toContain('<details')
    expect(MARKUP).not.toContain('<summary')
  })
})

describe('A számlázási mezők NEM tűntek el a rendszerből', () => {
  it('a pénztár továbbra is bekéri őket (ott készül belőlük számla)', () => {
    // A pénztár a saját, rövidebb mezőneveit használja (billing.ts:
    // BILLING_FIELD_ORDER), ezért itt a KIRENDERELT űrlapot nézzük, nem a
    // forrásszöveget: az számít, hogy a vevő elé kerülnek-e.
    const penztar = renderToStaticMarkup(
      createElement(CheckoutForm, {
        product: { id: 1, sku: 'Teszt kurzus', priceHuf: 19990, isFree: false },
        user: null,
        alreadyPurchased: false,
      }),
    )
    const nevek = new Set(
      (penztar.match(/<input\b[^>]*>/g) ?? []).map((m) => /name="([^"]+)"/.exec(m)?.[1] ?? ''),
    )
    for (const mezo of SZAMLAZASI_MEZOK) {
      expect(nevek, `a pénztárból hiányzik a(z) ${mezo} számlázási mező`).toContain(mezo)
    }
  })

  it('a mezőnév-lista együtt mozog a pénztárral (nem avul el némán)', () => {
    expect([...SZAMLAZASI_MEZOK].sort()).toEqual(Object.values(BILLING_INPUT_NAME).sort())
  })

  it('a fiók „Adataim" lapján elmenthetők (onnan tölt elő a pénztár)', () => {
    const fiok = kommentNelkul(olvas('components/account/AccountView.tsx'))
    for (const mezo of SZAMLAZASI_MEZOK) {
      expect(fiok, `a fiók-profilból hiányzik a(z) ${mezo} mező`).toContain(mezo)
    }
  })

  it('az API-szerződés változatlan: a RegisterInput ISMERI a mezőket', () => {
    // A felület nem kérdezi, de a végpont továbbra is elfogadja — így egy
    // későbbi import vagy admin-folyamat nem törik el.
    const kliens = kommentNelkul(olvas('lib/auth-client.ts'))
    expect(kliens).toContain('billingName')
  })
})

describe('A stílus is elment, nem csak a markup', () => {
  it('nincs több `.kc-auth-form__billing` szabály az auth.css-ben', () => {
    const css = olvas('app/(frontend)/auth.css').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).not.toContain('.kc-auth-form__billing')
  })
})
