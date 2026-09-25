import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CheckoutErrorRegion } from '../components/checkout/CheckoutForm'
import type { CheckoutSubmitResult } from '../lib/checkout-submit'
import {
  BILLING_TAX_NUMBER_ERROR,
  BILLING_TAX_NUMBER_EU_ERROR,
  validateBilling,
} from '../lib/checkout/billing'
import {
  CHECKOUT_TERMS_ERROR,
  CHECKOUT_TURNSTILE_FAILED_ERROR,
  CHECKOUT_TURNSTILE_PENDING_ERROR,
  WAIVER_LOSS_INPUT_ID,
  WAIVER_LOSS_REQUIRED_ERROR,
  WAIVER_START_INPUT_ID,
  WAIVER_START_REQUIRED_ERROR,
  TERMS_INPUT_ID,
  billingInputId,
  checkoutErrorSummaryTitle,
  guestInputId,
  CHECKOUT_ERROR_REGION_ID,
  createCheckoutSubmitHandler,
  type BillingFieldErrors,
  type CheckoutCheckboxErrors,
  type CheckoutErrorItem,
  type CheckoutRequestBody,
  type CheckoutSubmissionContext,
  type GuestFieldErrors,
} from '../lib/checkout/form-submission'

/**
 * A MAG ÉS A KOMPONENS KÖZTI HUZALOZÁS ŐRE.
 *
 * A `planCheckoutSubmission` maga jól tesztelt volt, a review viszont
 * mutációval megmutatta, hogy ez NEM elég: a `CheckoutForm.handleSubmit`-et át
 * lehetett írni úgy, hogy megkerülje a tervet és pontosan az EREDETI hibát
 * csinálja (üres számlázási adatot küldjön) — és a teljes suite zöld maradt.
 * Az eredeti hiba éppen ezen a ponton élt: az űrlap megjelenítette a mezőket,
 * a beküldés viszont nem az állapotukból épült.
 *
 * Ezért a mellékhatás-lánc külön gyárban van (`createCheckoutSubmitHandler`),
 * és itt DOM nélkül, hamis függőségekkel ellenőrizzük, hogy a beküldött törzs a
 * MÓDOSÍTOTT állapotból származik, és hogy a hibaágak tényleg megjelenítik a
 * hibát, törlik/beállítják a mezőhibákat és fókuszálnak.
 *
 * Valódi hálózati hívás itt nem futhat: a `submit` mindig injektált mock.
 */

/** Hangosan dobó őr — ha bármi mégis a globális fetch-hez nyúlna (CLAUDE.md 15.). */
vi.stubGlobal('fetch', () => {
  throw new Error('TESZT: valódi hálózati hívás nem futhat')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal('fetch', () => {
    throw new Error('TESZT: valódi hálózati hívás nem futhat')
  })
})

const TELJES_BILLING = {
  name: 'Példa Kft.',
  zip: '9700',
  city: 'Szombathely',
  street: 'Fő tér 2/A',
  taxNumber: '',
}

interface Naplo {
  errors: (string | null)[]
  items: (readonly CheckoutErrorItem[])[]
  fieldErrors: BillingFieldErrors[]
  guestErrors: GuestFieldErrors[]
  checkboxErrors: CheckoutCheckboxErrors[]
  submitting: boolean[]
  focused: (string | null)[]
  kuldott: CheckoutRequestBody[]
  atiranyitva: string[]
  sikertelenUtan: number
}

function felepit(
  context: CheckoutSubmissionContext,
  eredmeny: CheckoutSubmitResult | (() => Promise<CheckoutSubmitResult>) = {
    ok: true,
    orderNumber: 'KH-2026-000001',
    gatewayUrl: 'https://fizetes.example/1',
  },
): { futtat: () => Promise<void>; naplo: Naplo } {
  const naplo: Naplo = {
    errors: [],
    items: [],
    fieldErrors: [],
    guestErrors: [],
    checkboxErrors: [],
    submitting: [],
    focused: [],
    kuldott: [],
    atiranyitva: [],
    sikertelenUtan: 0,
  }
  const futtat = createCheckoutSubmitHandler({
    readContext: () => context,
    setError: (message) => naplo.errors.push(message),
    setErrorItems: (items) => naplo.items.push(items),
    setBillingErrors: (errors) => naplo.fieldErrors.push(errors),
    setGuestErrors: (errors) => naplo.guestErrors.push(errors),
    setCheckboxErrors: (errors) => naplo.checkboxErrors.push(errors),
    setSubmitting: (value) => naplo.submitting.push(value),
    focusElement: (elementId) => naplo.focused.push(elementId),
    submit: async (body) => {
      naplo.kuldott.push(body)
      return typeof eredmeny === 'function' ? eredmeny() : eredmeny
    },
    redirect: (url) => naplo.atiranyitva.push(url),
    afterFailedSubmit: () => {
      naplo.sikertelenUtan += 1
    },
  })
  return { futtat, naplo }
}

function alapContext(billing = TELJES_BILLING): CheckoutSubmissionContext {
  return {
    productId: 42,
    alreadyPurchased: false,
    waiverRequired: true,
    waiverStartAccepted: true,
    waiverLossAccepted: true,
    // Az ÁSZF-elfogadás minden ágon kötelező; a saját tesztjei a
    // penztar-aszf-elfogadas.test.tsx-ben.
    termsAccepted: true,
    billing,
  }
}

describe('checkout beküldés-huzalozás', () => {
  it('a beküldött törzs a MÓDOSÍTOTT állapotból épül, nem az előkitöltésből', async () => {
    // Ez az a viselkedés, aminek a hiánya volt az eredeti hiba: a profilból
    // előkitöltött mezőt a vevő átírja, és a rendelésre az ÁTÍRT érték kerül.
    const modositott = { ...TELJES_BILLING, name: 'Átírt Név Kft.', city: 'Sopron' }
    const { futtat, naplo } = felepit(alapContext(modositott))

    await futtat()

    expect(naplo.kuldott).toHaveLength(1)
    expect(naplo.kuldott[0].billing).toMatchObject({ name: 'Átírt Név Kft.', city: 'Sopron' })
    expect(naplo.kuldott[0].productId).toBe(42)
    expect(naplo.atiranyitva).toEqual(['https://fizetes.example/1'])
  })

  it('hiányos számlázási adatnál NEM küld semmit: mezőhiba, összefoglaló a mezősorrendben, fókusz az összefoglalón', async () => {
    const hianyos = { ...TELJES_BILLING, zip: '', city: '' }
    const { futtat, naplo } = felepit(alapContext(hianyos))

    await futtat()

    expect(naplo.kuldott).toEqual([])
    expect(naplo.atiranyitva).toEqual([])
    expect(naplo.fieldErrors).toHaveLength(1)
    expect(Object.keys(naplo.fieldErrors[0]).sort()).toEqual(['city', 'zip'])
    // Az összefoglaló linkjei a MEZŐSORREND szerint a hibás mezőkre mutatnak,
    // a fókusz pedig az összefoglalóra kerül (GOV.UK Error summary).
    expect(naplo.items.at(-1)?.map((item) => item.targetId)).toEqual([
      billingInputId('zip'),
      billingInputId('city'),
    ])
    expect(naplo.focused).toEqual([CHECKOUT_ERROR_REGION_ID])
    expect(naplo.submitting).toEqual([])
  })

  /**
   * a-ux-10 REGRESSZIÓ: korábban üres űrlapnál három nyomás kellett — előbb
   * csak az elállási nyilatkozatot, aztán csak az ÁSZF-et, végül a mezőket
   * kérte számon, és a jelölőnégyzetek hibája szöveg nélkül maradt. Most EGY
   * nyomásra minden hiba egyszerre megjelenik, az űrlap sorrendjében, és a
   * jelölőnégyzetek saját hibaüzenetet kapnak.
   */
  it('üres vendég-űrlapnál EGY nyomásra minden hibát felsorol, a jelölőnégyzetekét is', async () => {
    const { futtat, naplo } = felepit({
      ...alapContext({ name: '', zip: '', city: '', street: '', taxNumber: '' }),
      waiverStartAccepted: false,
      waiverLossAccepted: false,
      termsAccepted: false,
      guest: { email: '', name: '' },
    })

    await futtat()

    expect(naplo.kuldott).toEqual([])
    expect(naplo.items.at(-1)?.map((item) => item.targetId)).toEqual([
      guestInputId('email'),
      guestInputId('name'),
      billingInputId('name'),
      billingInputId('zip'),
      billingInputId('city'),
      billingInputId('street'),
      WAIVER_START_INPUT_ID,
      WAIVER_LOSS_INPUT_ID,
      TERMS_INPUT_ID,
    ])
    expect(naplo.errors.at(-1)).toBe(checkoutErrorSummaryTitle(9))
    expect(naplo.checkboxErrors.at(-1)).toEqual({
      waiverStart: WAIVER_START_REQUIRED_ERROR,
      waiverLoss: WAIVER_LOSS_REQUIRED_ERROR,
      terms: CHECKOUT_TERMS_ERROR,
    })
    expect(Object.keys(naplo.guestErrors.at(-1) ?? {}).sort()).toEqual(['email', 'name'])
    expect(naplo.focused).toEqual([CHECKOUT_ERROR_REGION_ID])
  })

  it('hiányzó elállási nyilatkozatnál blokkol, és a négyzet saját hibát kap', async () => {
    const { futtat, naplo } = felepit({ ...alapContext(), waiverLossAccepted: false })

    await futtat()

    expect(naplo.kuldott).toEqual([])
    expect(naplo.checkboxErrors.at(-1)).toEqual({ waiverLoss: WAIVER_LOSS_REQUIRED_ERROR })
    expect(naplo.items.at(-1)).toEqual([
      { targetId: WAIVER_LOSS_INPUT_ID, message: WAIVER_LOSS_REQUIRED_ERROR },
    ])
    expect(naplo.focused).toEqual([CHECKOUT_ERROR_REGION_ID])
  })

  /**
   * a-ux-15 REGRESSZIÓ: a sikeres indítás után a böngésző még a Barion felé
   * navigál; ha a gomb közben visszaáll, egy második koppintás újabb POST-ot
   * küld. A gomb ezért „Feldolgozás…"-ban marad.
   */
  it('sikeres átirányítás után a gomb folyamatban MARAD (nem enged második beküldést)', async () => {
    const { futtat, naplo } = felepit(alapContext())

    await futtat()

    expect(naplo.fieldErrors).toEqual([{}])
    expect(naplo.atiranyitva).toEqual(['https://fizetes.example/1'])
    expect(naplo.submitting).toEqual([true])
    expect(naplo.sikertelenUtan).toBe(0)
  })

  it('szerverhiba esetén megjeleníti az üzenetet, NEM irányít át, visszaengedi a gombot és új ellenőrzést kér', async () => {
    const { futtat, naplo } = felepit(alapContext(), {
      ok: false,
      message: 'A fizetés indítása nem sikerült.',
    })

    await futtat()

    expect(naplo.atiranyitva).toEqual([])
    expect(naplo.errors).toContain('A fizetés indítása nem sikerült.')
    expect(naplo.submitting).toEqual([true, false])
    expect(naplo.sikertelenUtan).toBe(1)
  })

  it('váratlan kivételnél sem ragad a gomb „Feldolgozás…"-ban', async () => {
    const { futtat, naplo } = felepit(alapContext(), async () => {
      throw new Error('váratlan')
    })

    await expect(futtat()).rejects.toThrow('váratlan')
    expect(naplo.submitting).toEqual([true, false])
    expect(naplo.sikertelenUtan).toBe(1)
  })

  it('szerverhibánál a HIBÁRA viszi a fókuszt (különben a hiba néma marad)', async () => {
    /**
     * A folyamat-audit mérése: szerverhiba után a hibadoboz `top` értéke
     * asztalon −753 px, mobilon −1343 px, `lathatoE: false`, a
     * `document.activeElement` pedig `BODY` — vagyis a felületen SEMMI nem
     * jelezte a hibát, a gomb is visszaállt alapállásba. A vevő azt hitte, a
     * gomb nem reagált, és újra nyomta. A hibadoboz `role="alert"`, tehát a
     * képernyőolvasó megkapta; a LÁTÓ felhasználó nem. A fókusz odamozgatásával
     * a böngésző a dobozt a képernyőre görgeti.
     *
     * Nem elég a hívás JELENLÉTE: azt is rögzítjük, hogy a hibaüzenet UTÁN
     * történik, különben a fókusz egy még üres dobozra menne.
     */
    const { futtat, naplo } = felepit(alapContext(), {
      ok: false,
      message: 'A fizetés indítása nem sikerült.',
    })

    await futtat()

    expect(naplo.focused).toEqual([CHECKOUT_ERROR_REGION_ID])
  })

  it('sikeres beküldésnél NEM mozgatja a fókuszt (nincs mit mutatni)', async () => {
    const { futtat, naplo } = felepit(alapContext(), {
      ok: true,
      orderNumber: 'KH-2026-000001',
      gatewayUrl: 'https://barion.example/pay',
    })

    await futtat()

    expect(naplo.focused).toEqual([])
  })
})

/**
 * a-checkout-9: a láthatatlan Turnstile tokenje a beküldés törzsében megy.
 * Token nélkül a kliens NEM küld (a szerver úgyis 400-at adna), hanem
 * megmondja, miért nem: még fut az ellenőrzés, vagy be sem töltődött.
 */
describe('checkout beküldés — Turnstile és céges vásárlás', () => {
  it('kész tokennel a token a törzsben megy', async () => {
    const { futtat, naplo } = felepit({
      ...alapContext(),
      turnstile: { required: true, token: 'DUMMY-TURNSTILE-TOKEN', failed: false },
    })

    await futtat()

    expect(naplo.kuldott).toHaveLength(1)
    expect(naplo.kuldott[0].turnstileToken).toBe('DUMMY-TURNSTILE-TOKEN')
  })

  it.each([
    ['még fut', false, CHECKOUT_TURNSTILE_PENDING_ERROR],
    ['nem töltődött be', true, CHECKOUT_TURNSTILE_FAILED_ERROR],
  ])(
    'token nélkül (%s) nem küld, és megmondja az okot a hibarégióban',
    async (_nev, failed, uzenet) => {
      const { futtat, naplo } = felepit({
        ...alapContext(),
        turnstile: { required: true, token: null, failed },
      })

      await futtat()

      expect(naplo.kuldott).toEqual([])
      expect(naplo.errors.at(-1)).toBe(uzenet)
      expect(naplo.focused).toEqual([CHECKOUT_ERROR_REGION_ID])
      expect(naplo.submitting).toEqual([])
    },
  )

  it('kikapcsolt ellenőrzésnél (nincs site key) token nélkül is küld, és a törzsben nincs tokenmező', async () => {
    const { futtat, naplo } = felepit({
      ...alapContext(),
      turnstile: { required: false, token: null, failed: false },
    })

    await futtat()

    expect(naplo.kuldott).toHaveLength(1)
    expect('turnstileToken' in naplo.kuldott[0]).toBe(false)
  })

  it('„Cégként vásárolok" mellett a jelölés a számlázási blokkban megy (billing.companyPurchase)', async () => {
    const { futtat, naplo } = felepit({
      ...alapContext({ ...TELJES_BILLING, taxNumber: '12345676-1-42' }),
      companyPurchase: true,
    })

    await futtat()

    expect(naplo.kuldott[0].billing.companyPurchase).toBe(true)
    expect(naplo.kuldott[0].billing.taxNumber).toBe('12345676-1-42')
  })

  it('magánszemélynél a törzsben nincs companyPurchase mező', async () => {
    const { futtat, naplo } = felepit(alapContext())

    await futtat()

    expect('companyPurchase' in naplo.kuldott[0].billing).toBe(false)
  })
})

describe('adószám-súgószöveg önellenőrzése', () => {
  /**
   * A súgószöveg és a szabály nem csúszhat szét: a review kimérte, hogy a
   * korábbi példa (`12345678-1-42`) magán a validátoron BUKOTT, tehát a vevő
   * betűre követte az utasítást, és egy másik hibát kapott.
   */
  it('minden adószám-üzenetben szereplő PÉLDA átmegy a validáción', () => {
    const uzenetek = [BILLING_TAX_NUMBER_ERROR, BILLING_TAX_NUMBER_EU_ERROR]
    const peldak = uzenetek.flatMap((uzenet) => uzenet.match(/\d{8}-\d-\d{2}/g) ?? [])

    expect(peldak.length).toBeGreaterThan(0)
    for (const pelda of peldak) {
      const eredmeny = validateBilling({ ...TELJES_BILLING, taxNumber: pelda })
      expect({ pelda, ok: eredmeny.ok }).toEqual({ pelda, ok: true })
    }
  })
})

describe('a hibarégió fókuszálható is, nem csak felolvasható', () => {
  /**
   * MIÉRT KÜLÖN ŐR: a beküldés-kezelő hiába viszi a fókuszt a hibarégióra, ha a
   * doboz nem fókuszálható — a `focus()` egy sima `<div>`-en NO-OP, és a hiba
   * ugyanúgy néma marad. A mutációs próba ezt ki is mutatta: a `tabIndex`
   * eltávolításával a handler-tesztek VÉGIG zöldek maradtak. Ez az állítás
   * pontosan azt a rést zárja: az azonosítót ÉS a fókuszálhatóságot együtt
   * rögzíti a renderelt kimeneten.
   */
  it('a renderelt doboz viseli az azonosítót és a tabindex="-1"-et', () => {
    const html = renderToStaticMarkup(
      createElement(CheckoutErrorRegion, { error: 'A fizetés indítása nem sikerült.' }),
    )
    expect(html).toContain(`id="${CHECKOUT_ERROR_REGION_ID}"`)
    expect(html).toContain('tabindex="-1"')
    expect(html).toContain('role="alert"')
    expect(html).toContain('A fizetés indítása nem sikerült.')
  })

  it('hiba nélkül is fókuszálható marad (az azonosító nem tűnhet el)', () => {
    const html = renderToStaticMarkup(createElement(CheckoutErrorRegion, { error: null }))
    expect(html).toContain(`id="${CHECKOUT_ERROR_REGION_ID}"`)
    expect(html).toContain('tabindex="-1"')
  })
})
