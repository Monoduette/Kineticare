import { readFileSync } from 'node:fs'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CheckoutForm } from '../components/checkout/CheckoutForm'
import {
  CHECKOUT_PAID_UNDER_REVIEW,
  CHECKOUT_REFUNDED_PRIVILEGED,
  CHECKOUT_REFUNDED_RETRY,
  planCheckoutSubmission,
  type CheckoutSubmissionContext,
} from '../lib/checkout/form-submission'
import {
  CHECKOUT_PAID_UNDER_REVIEW as SZERVER_PAID_UNDER_REVIEW,
  CHECKOUT_REFUNDED_PRIVILEGED as SZERVER_REFUNDED_PRIVILEGED,
  CHECKOUT_REFUNDED_RETRY as SZERVER_REFUNDED_RETRY,
} from '../lib/checkout/start-checkout'
import { ctaLabel } from '../lib/cta-vocabulary'

/**
 * A PÉNZTÁR HÁROM ÚJ SZERVER-VÁLASZÁNAK KIÚTJA (2026-08-29).
 *
 * A `POST /api/checkout/start` három olyan 409-es üzenetet adhat, amelyre a
 * pénztár eddig CSAK a hibadobozt tette ki, gomb nélkül:
 *
 *  1. `CHECKOUT_REFUNDED_PRIVILEGED` — vendégként munkatársi fiók e-mailjével
 *     fizetett, a rendszer visszatérített. A kiút: belépés, és onnan vásárlás.
 *  2. `CHECKOUT_PAID_UNDER_REVIEW` — a fizetés beérkezett, a rendelést nem
 *     tudtuk lezárni, kézi rendezés jön. A kiút: kapcsolat (új fizetés TILOS).
 *  3. `CHECKOUT_REFUNDED_RETRY` — összeg-eltérés miatt visszatérítettünk, a
 *     teendő maga az ÚJ beküldés: ehhez nem gomb kell, hanem az, hogy az
 *     űrlap beküldhető MARADJON.
 *
 * NN/g, Error Message Guidelines: a hibaüzenet mellé a következő lépés is jár
 * (https://www.nngroup.com/articles/error-message-guidelines/);
 * GOV.UK Design System, Error message: „tell users what happened and how to
 * fix it" (https://design-system.service.gov.uk/components/error-message/);
 * WCAG 2.2 · 3.3.1 Error Identification és 3.3.3 Error Suggestion
 * (https://www.w3.org/WAI/WCAG22/Understanding/error-suggestion.html);
 * Baymard, a fizetési állapotot pontosan kell közölni
 * (https://baymard.com/blog/order-confirmation-design).
 */

const FORRAS = readFileSync(
  new URL('../components/checkout/CheckoutForm.tsx', import.meta.url),
  'utf8',
)

/**
 * A HÁROM SZÖVEG EGYETLEN IGAZSÁGA.
 *
 * A pénztár ŰRLAPJA kliensoldali komponens: a `start-checkout.ts` (Payload-,
 * Barion- és Postgres-függő szerver-modul) nem húzható be a böngésző-kötegbe.
 * A szövegek ezért a MÁR MEGLÉVŐ, függőségmentes `form-submission.ts`-ben
 * élnek — ugyanott, ahonnan a `start-checkout` a másik három pénztári
 * üzenetet (`CHECKOUT_ALREADY_PURCHASED_ERROR`,
 * `CHECKOUT_GUEST_EXISTING_ACCOUNT`, `CHECKOUT_GUEST_FINISH_AFTER_LOGIN`) is
 * importálja. Amíg a `start-checkout` saját másolatot tart, EZ az őr köti a
 * kettőt össze: bitre kell egyezniük, különben a gomb-térkép élesben némán
 * nem talál rá a szerver üzenetére.
 */
describe('a pénztári hibaszövegek egyetlen igazsága (kliens ↔ szerver)', () => {
  it('a három üzenet bitre egyezik a szerver-oldali szöveggel', () => {
    expect(CHECKOUT_REFUNDED_RETRY).toBe(SZERVER_REFUNDED_RETRY)
    expect(CHECKOUT_REFUNDED_PRIVILEGED).toBe(SZERVER_REFUNDED_PRIVILEGED)
    expect(CHECKOUT_PAID_UNDER_REVIEW).toBe(SZERVER_PAID_UNDER_REVIEW)
  })

  it('a három üzenet KÜLÖNBÖZIK (a gomb-térkép pontos egyezésre épül)', () => {
    const uzenetek = [
      CHECKOUT_REFUNDED_RETRY,
      CHECKOUT_REFUNDED_PRIVILEGED,
      CHECKOUT_PAID_UNDER_REVIEW,
    ]
    expect(new Set(uzenetek).size).toBe(uzenetek.length)
  })

  it('a mikroszöveg magyar szabály szerinti (nincs töltelék gondolatjel)', () => {
    for (const uzenet of [
      CHECKOUT_REFUNDED_RETRY,
      CHECKOUT_REFUNDED_PRIVILEGED,
      CHECKOUT_PAID_UNDER_REVIEW,
    ]) {
      expect(uzenet).not.toMatch(/[–—]/)
      expect(uzenet).not.toContain('Kérjük')
      expect(uzenet).not.toContain('Sajnos')
    }
  })

  it('a kliens a saját (függőségmentes) moduljából olvassa őket', () => {
    expect(FORRAS).toContain('CHECKOUT_REFUNDED_PRIVILEGED')
    expect(FORRAS).toContain('CHECKOUT_PAID_UNDER_REVIEW')
    expect(
      FORRAS,
      'a start-checkout.ts szerver-modul (Payload, Barion, Postgres) nem kerülhet a kliens-kötegbe',
    ).not.toContain('start-checkout')
  })
})

describe('CheckoutForm — visszatérített, privilegizált fiókos vendégvásárlás', () => {
  it('ugyanazt a Belépés-gombot kapja, mint a meglévő-fiókos vendég ág', () => {
    expect(FORRAS).toContain('error === CHECKOUT_REFUNDED_PRIVILEGED')
    // A két ág EGY gombot oszt: a cél a pénztár (oda tér vissza belépés után).
    expect(FORRAS).toMatch(
      /error === CHECKOUT_GUEST_EXISTING_ACCOUNT \|\|\s*error === CHECKOUT_REFUNDED_PRIVILEGED/,
    )
    expect(FORRAS).toContain('signInHref(checkoutHref(product.id))')
    expect(FORRAS).toContain("ctaLabel('sign-in')")
  })
})

describe('CheckoutForm — beérkezett fizetés kézi rendezés alatt', () => {
  it('a kapcsolat a kiút, és NEM új fizetés (a szöveg is ezt kéri)', () => {
    expect(FORRAS).toContain('error === CHECKOUT_PAID_UNDER_REVIEW')
    expect(FORRAS).toContain('href="/kapcsolat"')
    expect(FORRAS).toContain("ctaLabel('contact-open')")
    expect(CHECKOUT_PAID_UNDER_REVIEW).toContain('ne indíts új fizetést')
  })
})

/**
 * A HARMADIK ÁG SZÁNDÉKOSAN GOMBTALAN: az „Indítsd újra a vásárlást" teendő
 * maga a beküldés, ami az űrlapon ott van. Egy második, ugyanoda vivő gomb
 * két feliratot adna ugyanarra a cselekvésre (WCAG 2.2 · 3.2.4), és a
 * GOV.UK „egy elsődleges cselekvés" szabályát is sértené. Amit viszont
 * bizonyítani KELL: a beküldés nem ragad letiltva a hiba után.
 */
describe('CheckoutForm — összeg-eltérés miatti visszatérítés: az űrlap az újrapróba', () => {
  it('nem kap külön gombot a hibadoboz alá', () => {
    expect(FORRAS).not.toContain('error === CHECKOUT_REFUNDED_RETRY')
  })

  it('a beküldő gombot KIZÁRÓLAG a folyamatban lévő küldés tiltja le', () => {
    expect(FORRAS).toContain('disabled={submitting}')
    // Hibaüzenet-függő letiltás nem kerülhet a gombra: a 409 után a vevőnek
    // újra be kell tudnia küldeni ugyanazt az űrlapot.
    expect(FORRAS).not.toMatch(/disabled=\{[^}]*error[^}]*\}/)
  })

  it('a hiba UTÁN is beküldhető az űrlap (a tiszta döntési mag szerint)', () => {
    const context: CheckoutSubmissionContext = {
      productId: 42,
      alreadyPurchased: false,
      waiverRequired: true,
      waiverStartAccepted: true,
      waiverLossAccepted: true,
      termsAccepted: true,
      billing: {
        name: 'Minta Mari',
        zip: '1011',
        city: 'Budapest',
        street: 'Fő utca 1.',
        taxNumber: '',
      },
    }
    // A 409 nem nyúl az űrlapállapothoz: ugyanaz a kontextus másodszor is
    // beküldhető tervet ad (a `blocked` ág csak a már-megvett és a hiányzó
    // nyilatkozat esetére szól).
    expect(planCheckoutSubmission(context).kind).toBe('send')
    expect(planCheckoutSubmission(context).kind).toBe('send')
  })

  it('a fizető gomb a szótári felirattal áll ott (a hiba nem cseréli le)', () => {
    const html = renderToStaticMarkup(
      createElement(CheckoutForm, {
        product: { id: 42, sku: 'Kézrehab alapkurzus', priceHuf: 24900, isFree: false },
        user: { name: 'Minta Mari', email: 'vevo@example.test' },
        alreadyPurchased: false,
      }),
    )
    expect(html).toContain('type="submit"')
    expect(html).toContain(ctaLabel('checkout-submit'))
    expect(html).not.toContain('disabled')
  })
})
