import { readFileSync } from 'node:fs'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CheckoutForm } from '../components/checkout/CheckoutForm'
import {
  BILLING_SUMMARY_MISSING,
  BILLING_SUMMARY_MIXED,
  BILLING_SUMMARY_TOO_LONG,
  BILLING_TAX_NUMBER_ERROR,
  BILLING_TAX_NUMBER_EU_ERROR,
  BILLING_TAX_NUMBER_STRUCTURE_ERROR,
  billingErrorMap,
  billingSummaryMessage,
  isValidTaxNumberCoreChecksum,
  toBillingPayload,
  validateBilling,
  type BillingFieldName,
} from '../lib/checkout/billing'
import {
  CHECKOUT_ALREADY_PURCHASED_ERROR,
  CHECKOUT_ERROR_REGION_ID,
  CHECKOUT_WAIVER_ERROR,
  WAIVER_LOSS_INPUT_ID,
  WAIVER_START_INPUT_ID,
  billingInputId,
  planCheckoutSubmission,
  prefillBillingForm,
  withBillingValue,
  withoutBillingError,
  type BillingFormValues,
} from '../lib/checkout/form-submission'

/**
 * B — a pénztár számlázási adatainak KÖZÖS validációja és a beküldés
 * összeállítása.
 *
 * Ugyanez a validációs modul fut a /penztar űrlapján és a POST
 * /api/checkout/start szolgáltatásában is (a kliens megkerülhető). A szabály
 * célja, hogy a `customerSnapshot`-ból soha ne hiányozzanak a Számla Agent
 * kötelező vevőmezői (nev/irsz/telepules/cim) — enélkül a fizetés lemenne, a
 * számla viszont soha nem állna ki.
 *
 * CLAUDE.md 15.: hangosan dobó fetch-őr — ebben a fájlban EGYETLEN hálózati
 * hívásnak sem szabad futnia (se valódinak, se mockoltnak). Az őrt MINDEN
 * teszt előtt újra fel kell húzni: az `unstubAllGlobals` visszaadja az eredeti
 * `fetch`-et, tehát egyszeri, fájl-szintű stub csak az első tesztet védené.
 */
const FETCH_GUARD_ERROR = 'TESZT: valódi hálózati hívás nem futhat'

beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error(FETCH_GUARD_ERROR)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('teszt-őr', () => {
  it('a fetch hangosan dob (az őr fel van húzva)', () => {
    // A `.invalid` fenntartott TLD: ha az őr valaha kiesne, ez a hívás akkor
    // sem érhetne el valódi szolgáltatást.
    expect(() => fetch('https://nem-letezik.invalid')).toThrowError(FETCH_GUARD_ERROR)
  })
})

const VALID = {
  name: 'Minta Mari',
  zip: '1011',
  city: 'Budapest',
  street: 'Fő utca 1.',
}

/**
 * SZINTETIKUS, de a magyar adószám-szerkezetnek megfelelő tesztérték:
 * törzsszám 12345676 (a 8. jegy a 9,7,3,1,9,7,3 súlyokból képzett CDV),
 * áfakód 1, megyekód 42. NEM valódi cég adószáma.
 */
const VALID_TAX_NUMBER = '12345676-1-42'

function errorFields(input: unknown): BillingFieldName[] {
  const result = validateBilling(input)
  return result.ok ? [] : result.errors.map((item) => item.field)
}

describe('validateBilling — elfogadott, VALÓS magyar címek', () => {
  it.each([
    ['budapesti alapeset', VALID],
    ['kétbetűs településnév', { ...VALID, zip: '7381', city: 'Ág', street: 'Kossuth utca 3.' }],
    ['törtszámos házszám', { ...VALID, street: 'Fő tér 2/A' }],
    ['emelet-ajtó jelölés', { ...VALID, street: 'Váci út 12. 3. em. 5.' }],
    ['helyrajzi szám', { ...VALID, street: 'Külterület hrsz. 0123/4' }],
    ['házszám nélküli cím', { ...VALID, street: 'Petőfi utca' }],
    ['9-cel kezdődő irányítószám', { ...VALID, zip: '9985', city: 'Felsőszölnök' }],
    ['hosszú, ékezetes név', { ...VALID, name: 'Dr. Kovácsné Szőke Zsuzsanna' }],
  ])('átmegy: %s', (_label, input) => {
    expect(validateBilling(input).ok).toBe(true)
  })

  it('normalizál: körbevágás és a többszörös szóközök összevonása', () => {
    const result = validateBilling({
      name: '  Minta   Mari ',
      zip: ' 1011 ',
      city: ' Budapest ',
      street: 'Fő  utca   1.',
    })
    expect(result).toEqual({
      ok: true,
      value: {
        name: 'Minta Mari',
        zip: '1011',
        city: 'Budapest',
        street: 'Fő utca 1.',
        taxNumber: null,
      },
    })
  })

  it('az irányítószám H- előtaggal is elfogadott', () => {
    expect(validateBilling({ ...VALID, zip: 'H-1011' })).toMatchObject({
      ok: true,
      value: { zip: '1011' },
    })
    expect(validateBilling({ ...VALID, zip: 'H1011' })).toMatchObject({
      ok: true,
      value: { zip: '1011' },
    })
  })
})

describe('validateBilling — külföldi cím (a vásárlás nem vész el)', () => {
  /**
   * A korábbi szabály KIZÁRÓLAG magyar irányítószámot fogadott el, tehát a
   * határon túli magyar vevő innentől egyáltalán nem tudott volna fizetni.
   * ⚠️ A számla-XML `<vevo>` blokkja ma nem tartalmaz `<orszag>` taget — az
   * országmező felvétele önálló, TULAJDONOSI döntést igénylő ticket.
   */
  it.each([
    ['berlini (5 számjegy)', '10115'],
    ['malackai (belső szóközzel)', '900 01'],
    ['reykjavíki (3 számjegy)', '101'],
    ['londoni (betű+számjegy)', 'SW1A 1AA'],
    ['kötőjeles (pl. lengyel)', '00-950'],
  ])('átmegy és VÁLTOZATLAN marad: %s', (_label, zip) => {
    const result = validateBilling({ ...VALID, zip, city: 'Berlin' })
    expect(result.ok && result.value.zip).toBe(zip)
  })

  it('a belső szóközre NEM találgat: a 10 11 nem lesz csendben 1011', () => {
    const result = validateBilling({ ...VALID, zip: '10 11' })
    expect(result.ok && result.value.zip).toBe('10 11')
  })
})

describe('validateBilling — elutasított, hiányos adatok', () => {
  it('teljesen üres bemenet: mind a négy kötelező mező hibás', () => {
    expect(errorFields({})).toEqual(['name', 'zip', 'city', 'street'])
  })

  it('nem objektum bemenet (null, tömb, string) sem omlik el', () => {
    expect(errorFields(null)).toHaveLength(4)
    expect(errorFields('szöveg')).toHaveLength(4)
    expect(errorFields([VALID])).toHaveLength(4)
  })

  it('csak szóközből álló mező is hiányzónak számít', () => {
    expect(errorFields({ ...VALID, city: '   ' })).toEqual(['city'])
    expect(errorFields({ ...VALID, name: '\n\t ' })).toEqual(['name'])
  })

  it('a csak ZERO-WIDTH karakterekből álló név NEM megy át', () => {
    // A trim() ezeket nem vágja le, mégsem látszanak: a számlára üres `nev`
    // kerülne, amit a Számla Agent visszautasítana.
    // Escape-elve, hogy a forrásban is LÁTHATÓ legyen, mit tesztelünk:
    // ZWSP, ZWNJ, ZWJ, BOM.
    expect(errorFields({ ...VALID, name: '\u200B\u200C\u200D\uFEFF' })).toEqual(['name'])
    expect(errorFields({ ...VALID, city: 'A\u200B' })).toEqual(['city'])
  })

  it('a zero-width karakter a HOSSZBA sem számít bele, de a szöveget nem töri el', () => {
    // A látható tartalom marad; csak a láthatatlan töltelék esik ki.
    expect(validateBilling({ ...VALID, city: '\u200BÁg\uFEFF' })).toMatchObject({
      ok: true,
      value: { city: 'Ág' },
    })
  })

  it.each([
    ['üres', ''],
    ['egyjegyű', '1'],
    ['nullával kezdődő négyjegyű', '0111'],
    ['csak betűkből álló', 'ABC'],
    ['tizenhárom karakter', '12345678901234'],
    ['tiltott karakter', '10/11'],
  ])('irányítószám elutasítva: %s', (_label, zip) => {
    expect(errorFields({ ...VALID, zip })).toEqual(['zip'])
  })

  it('a számként küldött irányítószám elutasított (a szerződés string-alapú)', () => {
    expect(errorFields({ ...VALID, zip: 1011 })).toEqual(['zip'])
  })

  it('a túl hosszú érték is elutasított (épesz-határ)', () => {
    expect(errorFields({ ...VALID, city: 'a'.repeat(101) })).toEqual(['city'])
    expect(errorFields({ ...VALID, name: 'a'.repeat(201) })).toEqual(['name'])
    expect(errorFields({ ...VALID, street: 'a'.repeat(201) })).toEqual(['street'])
  })

  it('minden hibaüzenet MAGYAR, mezőhöz kötve', () => {
    const result = validateBilling({})
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    const map = billingErrorMap(result.errors)
    expect(map.name).toBe('Add meg a számlázási nevet (legalább 2 karakter).')
    expect(map.zip).toBe(
      'Adj meg érvényes irányítószámot (magyar cím esetén négyjegyű szám, például 1011).',
    )
    expect(map.city).toBe('Add meg a települést.')
    expect(map.street).toBe('Add meg az utcát és a házszámot.')
  })
})

describe('validateBilling — adószám (opcionális, de SZERKEZETILEG ellenőrzött)', () => {
  it('hiányzó vagy üres adószám → null (magánszemély), nem hiba', () => {
    expect(validateBilling(VALID)).toMatchObject({ ok: true, value: { taxNumber: null } })
    expect(validateBilling({ ...VALID, taxNumber: '' })).toMatchObject({
      ok: true,
      value: { taxNumber: null },
    })
    expect(validateBilling({ ...VALID, taxNumber: '   ' })).toMatchObject({
      ok: true,
      value: { taxNumber: null },
    })
  })

  it.each([
    ['tagolt', '12345676-1-42'],
    ['tagolatlan', '12345676142'],
    ['szóközös', '12345676 1 42'],
    ['HU-előtagos, TELJES adószámmal', 'HU12345676142'],
  ])('a szerkezetileg helyes adószám elfogadott és normalizált: %s', (_label, taxNumber) => {
    const result = validateBilling({ ...VALID, taxNumber })
    expect(result.ok && result.value.taxNumber).toBe(VALID_TAX_NUMBER)
  })

  it.each([
    ['áfakód 1', '12345676-1-42'],
    ['áfakód 5', '12345676-5-42'],
    ['megyekód 02', '12345676-2-02'],
    ['megyekód 44', '12345676-2-44'],
    ['megyekód 51 (Kiemelt Adózók)', '12345676-2-51'],
  ])('érvényes áfa- és megyekód: %s', (_label, taxNumber) => {
    expect(validateBilling({ ...VALID, taxNumber }).ok).toBe(true)
  })

  it.each([
    ['csupa nulla (áfa- és megyekód érvénytelen)', '00000000-0-00'],
    ['látszólag szabályos, de CDV-hibás', '12345678-9-99'],
    ['helyes CDV, de áfakód 0', '12345676-0-42'],
    ['helyes CDV, de áfakód 6', '12345676-6-42'],
    ['helyes CDV, de megyekód 01', '12345676-2-01'],
    ['helyes CDV, de megyekód 45', '12345676-2-45'],
    ['helyes CDV, de megyekód 50', '12345676-2-50'],
    ['elgépelt törzsszám (CDV bukik)', '12345675-1-42'],
  ])('SZERKEZETILEG lehetetlen adószám elutasítva: %s', (_label, taxNumber) => {
    const result = validateBilling({ ...VALID, taxNumber })
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(billingErrorMap(result.errors)).toEqual({
      taxNumber: BILLING_TAX_NUMBER_STRUCTURE_ERROR,
    })
  })

  it.each([
    ['túl rövid', '1234567'],
    ['túl hosszú', '123456761421'],
    ['betűs', '1234567614A'],
  ])('alaki hiba (nem 11 számjegy): %s', (_label, taxNumber) => {
    const result = validateBilling({ ...VALID, taxNumber })
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(billingErrorMap(result.errors)).toEqual({ taxNumber: BILLING_TAX_NUMBER_ERROR })
  })

  it('a CSAK közösségi alak (HU + 8 számjegy) saját, eligazító üzenetet kap', () => {
    // Ebből az áfakód és a megyekód nem képezhető, a számla `<adoszam>` mezője
    // viszont a teljes magyar alakot várja (`<adoszamEU>`-t nem küldünk).
    const result = validateBilling({ ...VALID, taxNumber: 'HU12345676' })
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(billingErrorMap(result.errors)).toEqual({ taxNumber: BILLING_TAX_NUMBER_EU_ERROR })
  })

  it('a CDV-szabály önmagában is ellenőrizhető (súlyok: 9,7,3,1,9,7,3)', () => {
    expect(isValidTaxNumberCoreChecksum('12345676')).toBe(true)
    expect(isValidTaxNumberCoreChecksum('10000001')).toBe(true)
    expect(isValidTaxNumberCoreChecksum('99999999')).toBe(true)
    expect(isValidTaxNumberCoreChecksum('12345678')).toBe(false)
    expect(isValidTaxNumberCoreChecksum('1234567')).toBe(false)
  })
})

describe('billingSummaryMessage — az összefoglaló a HIBAHALMAZBÓL származik', () => {
  const summaryOf = (input: unknown): string => {
    const result = validateBilling(input)
    return result.ok ? '' : billingSummaryMessage(result.errors)
  }

  it('csupa hiányzó mező → „hiányosak"', () => {
    expect(summaryOf({})).toBe(BILLING_SUMMARY_MISSING)
  })

  it('CSAK hibás adószám → az adószám saját üzenete (a mező nem is kötelező)', () => {
    // A régi viselkedés itt tényszerűen hamis volt: a mező ki volt töltve és
    // nem kötelező, mégis „a számlázási adatok hiányosak" ment ki.
    expect(summaryOf({ ...VALID, taxNumber: '12345678-9-99' })).toBe(
      BILLING_TAX_NUMBER_STRUCTURE_ERROR,
    )
    expect(summaryOf({ ...VALID, taxNumber: 'HU12345676' })).toBe(BILLING_TAX_NUMBER_EU_ERROR)
  })

  it('csupa TÚL HOSSZÚ érték → nem „hiányos", hanem rövidítendő', () => {
    expect(summaryOf({ ...VALID, city: 'a'.repeat(101), name: 'a'.repeat(201) })).toBe(
      BILLING_SUMMARY_TOO_LONG,
    )
  })

  it('vegyes hibahalmaz → semleges, mezőkre mutató üzenet', () => {
    expect(summaryOf({ ...VALID, city: '', name: 'a'.repeat(201) })).toBe(BILLING_SUMMARY_MIXED)
  })

  it('hiba nélkül üres', () => {
    expect(billingSummaryMessage([])).toBe('')
  })
})

describe('toBillingPayload — a hálózati törzs alakja', () => {
  it('a null adószám KIMARAD a törzsből', () => {
    const result = validateBilling(VALID)
    expect(result.ok && toBillingPayload(result.value)).toEqual({
      name: 'Minta Mari',
      zip: '1011',
      city: 'Budapest',
      street: 'Fő utca 1.',
    })
  })

  it('a megadott adószám bekerül', () => {
    const result = validateBilling({ ...VALID, taxNumber: '12345676142' })
    expect(result.ok && toBillingPayload(result.value)).toMatchObject({
      taxNumber: VALID_TAX_NUMBER,
    })
  })
})

/**
 * A LÉNYEG: a beküldött törzs a MÓDOSÍTOTT állapotból épül.
 *
 * A korábbi teszt `renderToStaticMarkup`-pal a `value=` attribútumokat
 * ellenőrizte — az viszont a `defaultValue`-t is `value=`-ként rendereli, tehát
 * a régi, HIBÁS komponensen is átment volna. Az űrlap valódi viselkedését ezért
 * a tiszta döntési magon (`planCheckoutSubmission`) hajtjuk meg: az előkitöltés
 * → módosítás → beküldés lánc végigfut, DOM nélkül.
 */
describe('planCheckoutSubmission — a beküldés a MÓDOSÍTOTT állapotból épül', () => {
  const PROFILE = {
    name: 'Minta Mari',
    billingName: 'Minta Mari',
    billingZip: '1011',
    billingCity: 'Budapest',
    billingStreet: 'Fő utca 1.',
    taxNumber: '',
  }

  const context = (billing: BillingFormValues) => ({
    productId: 42,
    alreadyPurchased: false,
    waiverRequired: true,
    waiverStartAccepted: true,
    waiverLossAccepted: true,
    // Az ÁSZF-elfogadás minden ágon kötelező (start-checkout.ts + a pénztár
    // jelölőnégyzete); a saját tesztjei a penztar-aszf-elfogadas.test.tsx-ben.
    termsAccepted: true,
    billing,
  })

  it('a profil ELŐKITÖLTÉS: a beküldés a felülírt értékeket viszi, nem a profilt', () => {
    let values = prefillBillingForm(PROFILE)
    expect(values).toEqual({
      name: 'Minta Mari',
      zip: '1011',
      city: 'Budapest',
      street: 'Fő utca 1.',
      taxNumber: '',
    })

    // A vevő a pénztárban mindent átír (céges számlát kér).
    values = withBillingValue(values, 'name', 'Példa Kft.')
    values = withBillingValue(values, 'zip', '9700')
    values = withBillingValue(values, 'city', 'Szombathely')
    values = withBillingValue(values, 'street', 'Fő tér 2/A')
    values = withBillingValue(values, 'taxNumber', '12345676142')

    const plan = planCheckoutSubmission(context(values))

    expect(plan.kind).toBe('send')
    if (plan.kind !== 'send') {
      return
    }
    expect(plan.body).toEqual({
      productId: 42,
      quantity: 1,
      consentWithdrawalWaiver: true,
      consentTerms: true,
      billing: {
        name: 'Példa Kft.',
        zip: '9700',
        city: 'Szombathely',
        street: 'Fő tér 2/A',
        taxNumber: VALID_TAX_NUMBER,
      },
    })
    // A profil egyetlen értéke sem szivárgott át.
    expect(JSON.stringify(plan.body)).not.toContain('Minta Mari')
    expect(JSON.stringify(plan.body)).not.toContain('1011')
  })

  it('a törzs a normalizált (körbevágott) értékeket viszi, nem a nyers gépelést', () => {
    const values = withBillingValue(prefillBillingForm(PROFILE), 'city', '  Szeged  ')
    const plan = planCheckoutSubmission(context(values))
    expect(plan.kind === 'send' && plan.body.billing.city).toBe('Szeged')
  })

  it('hiányos mező: nincs törzs, van mezőhiba, összefoglaló és FÓKUSZCÉL', () => {
    const values = withBillingValue(prefillBillingForm(PROFILE), 'city', '')
    const plan = planCheckoutSubmission(context(values))

    expect(plan.kind).toBe('invalid')
    if (plan.kind !== 'invalid') {
      return
    }
    expect(plan.fieldErrors).toEqual({ city: 'Add meg a települést.' })
    expect(plan.message).toBe(BILLING_SUMMARY_MISSING)
    expect(plan.focusElementId).toBe('kc-field-billingCity')
  })

  it('több hibás mezőnél az ELSŐ (megjelenítési sorrend szerinti) kapja a fókuszt', () => {
    let values = withBillingValue(prefillBillingForm(PROFILE), 'zip', '')
    values = withBillingValue(values, 'street', '')
    const plan = planCheckoutSubmission(context(values))
    expect(plan.kind === 'invalid' && plan.focusElementId).toBe('kc-field-billingZip')
  })

  it('már megvett kurzus: a beküldés meg sem indul, ÉS a hibára megy a fókusz', () => {
    /**
     * SZERZŐDÉS-VÁLTÁS (folyamat-audit, 2026-08-17): a `focusElementId` itt
     * korábban `null` volt, amitől a `focusElement` no-op lett — vagyis ez az ág
     * ugyanolyan NÉMA volt, mint a szerverhiba-ág: az üzenet a képernyőn kívül
     * maradt, a fókusz a `body`-n. Most a hibarégió kapja a fókuszt, és a
     * böngésző odagörget.
     */
    const plan = planCheckoutSubmission({
      ...context(prefillBillingForm(PROFILE)),
      alreadyPurchased: true,
    })
    expect(plan).toEqual({
      kind: 'blocked',
      message: CHECKOUT_ALREADY_PURCHASED_ERROR,
      focusElementId: CHECKOUT_ERROR_REGION_ID,
    })
  })

  it('hiányzó elállási nyilatkozat: a hiányzó jelölőnégyzet kapja a fókuszt', () => {
    const base = context(prefillBillingForm(PROFILE))
    expect(
      planCheckoutSubmission({ ...base, waiverStartAccepted: false, waiverLossAccepted: false }),
    ).toEqual({
      kind: 'blocked',
      message: CHECKOUT_WAIVER_ERROR,
      focusElementId: WAIVER_START_INPUT_ID,
    })
    expect(
      planCheckoutSubmission({ ...base, waiverStartAccepted: true, waiverLossAccepted: false }),
    ).toMatchObject({ focusElementId: WAIVER_LOSS_INPUT_ID })
  })

  it('ingyenes termék: nyilatkozat nélkül is beküldhető', () => {
    const plan = planCheckoutSubmission({
      ...context(prefillBillingForm(PROFILE)),
      waiverRequired: false,
      waiverStartAccepted: false,
      waiverLossAccepted: false,
    })
    expect(plan.kind).toBe('send')
  })
})

describe('withoutBillingError — a mezőhiba gépeléskor eltűnik', () => {
  it('a szerkesztett mező hibája kikerül, a többi marad', () => {
    const errors = { zip: 'irányítószám-hiba', city: 'település-hiba' }
    expect(withoutBillingError(errors, 'zip')).toEqual({ city: 'település-hiba' })
  })

  it('hibátlan mezőnél ugyanazt az objektumot adja vissza (nincs fölös újrarajzolás)', () => {
    const errors = { zip: 'irányítószám-hiba' }
    expect(withoutBillingError(errors, 'city')).toBe(errors)
  })
})

describe('billingInputId — a fókuszcél és a renderelt input azonosítója EGYEZIK', () => {
  it('a Field id-konvencióját (kc-field-<name>) követi', () => {
    const html = renderToStaticMarkup(
      createElement(CheckoutForm, {
        product: { id: 42, sku: 'Kézrehab alapkurzus', priceHuf: 24900, isFree: false },
        user: { name: 'Minta Mari', email: 'vevo@example.test' },
        alreadyPurchased: false,
      }),
    )
    for (const field of ['name', 'zip', 'city', 'street', 'taxNumber'] as const) {
      expect(html).toContain(`id="${billingInputId(field)}"`)
    }
  })
})

/**
 * Markup-szintű ellenőrzés — TUDATOSAN SZŰK.
 *
 * A `renderToStaticMarkup` NEM tud különbséget tenni kontrollált (`value` +
 * `onChange`) és kontrollálatlan (`defaultValue`) mező között: mindkettőt
 * `value=` attribútumként rendereli. Ez a blokk ezért CSAK azt bizonyítja,
 * amit a kiszolgált HTML tényleg elárul: az előkitöltés a helyes profilmezőből
 * jön, és a mezők autofill-tokenjei a számlázási szekcióra mutatnak. Azt, hogy
 * a beküldés a MÓDOSÍTOTT állapotból épül, a fenti `planCheckoutSubmission`
 * blokk fedi le.
 */
describe('CheckoutForm — a kiszolgált HTML (előkitöltés és autofill)', () => {
  const product = { id: 42, sku: 'Kézrehab alapkurzus', priceHuf: 24900, isFree: false }

  const render = (user: Parameters<typeof CheckoutForm>[0]['user']): string =>
    renderToStaticMarkup(createElement(CheckoutForm, { product, user, alreadyPurchased: false }))

  it('az előkitöltés a profil SZÁMLÁZÁSI mezőiből jön', () => {
    const html = render({
      name: 'Minta Mari',
      email: 'vevo@example.test',
      billingName: 'Példa Kft.',
      billingZip: '9700',
      billingCity: 'Szombathely',
      billingStreet: 'Fő tér 2/A',
      taxNumber: VALID_TAX_NUMBER,
    })
    expect(html).toContain('value="Példa Kft."')
    expect(html).toContain('value="9700"')
    expect(html).toContain('value="Szombathely"')
    expect(html).toContain(`value="${VALID_TAX_NUMBER}"`)
  })

  it('üres profilnál a számlázási név a felhasználó nevére esik vissza', () => {
    expect(render({ name: 'Minta Mari', email: 'vevo@example.test' })).toContain(
      'value="Minta Mari"',
    )
  })

  it('az autofill-tokenek a számlázási szekcióra mutatnak, az adószámon kikapcsolva', () => {
    // Kisbetűsítve: az attribútumnév írásmódja renderer-függő, a TOKEN nem az.
    const html = render({ name: 'Minta Mari', email: 'vevo@example.test' }).toLowerCase()
    expect(html).toContain('autocomplete="billing name"')
    expect(html).toContain('autocomplete="billing postal-code"')
    expect(html).toContain('autocomplete="billing address-level2"')
    expect(html).toContain('autocomplete="billing address-line1"')
    // Az adószámra nincs szabványos token — a böngésző rossz mezőt kínálna fel.
    expect(html).toContain('autocomplete="off"')
  })

  it('induláskor egyetlen mező sem érvénytelen (aria-invalid csak hiba után jelenik meg)', () => {
    expect(render({ name: 'Minta Mari', email: 'vevo@example.test' })).not.toContain('aria-invalid')
  })
})

describe('CheckoutForm — vendég, meglévő fiók (409-szabály)', () => {
  it('előre elmondja, hogy vendégvásárlás nem kerül a meglévő fiókba, és belépés után a pénztárra visz', () => {
    const html = renderToStaticMarkup(
      createElement(CheckoutForm, {
        product: { id: 42, sku: 'Kézrehab alapkurzus', priceHuf: 24900, isFree: false },
        user: null,
        alreadyPurchased: false,
      }),
    )
    expect(html).toContain('be is jelentkezhetsz')
    expect(html).toContain('vendégként a vásárlás nem kerül abba a fiókba')
    expect(html).toContain('/belepes?returnUrl=')
    expect(html).toContain('%2Fpenztar%3Ftermek%3D42')
    expect(html).not.toMatch(/[–—]/)
  })
})

describe('CheckoutForm — már megvett kurzus', () => {
  it('a gomb a lejátszóra visz, nem indít új rendelést', () => {
    const html = renderToStaticMarkup(
      createElement(CheckoutForm, {
        product: { id: 42, sku: 'Kézrehab alapkurzus', priceHuf: 24900, isFree: false },
        user: { name: 'Minta Mari', email: 'vevo@example.test' },
        alreadyPurchased: true,
      }),
    )
    expect(html).toContain('href="/kurzusaim/42"')
    expect(html).toContain('Kezdd el a kurzust')
    expect(html).not.toContain('type="submit"')
    expect(html).not.toMatch(/[–—]/)
  })

  it('a szerver már-megvett 409-ére a lejátszó gombot is kiteszi, ha a lap még nem tudta', () => {
    const source = readFileSync(
      new URL('../components/checkout/CheckoutForm.tsx', import.meta.url),
      'utf8',
    )
    expect(source).toContain('error === CHECKOUT_ALREADY_PURCHASED_ERROR && !alreadyPurchased')
    expect(source).toContain('myCoursePlayerHref(product.id)')
  })
})
