import type { Payload } from 'payload'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CHECKOUT_GUEST_EXISTING_ACCOUNT,
  CHECKOUT_GUEST_FINISH_AFTER_LOGIN,
  CheckoutError,
  startCheckout,
} from '../../lib/checkout/start-checkout'
import {
  GUEST_EMAIL_INVALID_ERROR,
  GUEST_NAME_MISSING_ERROR,
  validateGuest,
} from '../../lib/checkout/guest'
import { planCheckoutSubmission } from '../../lib/checkout/form-submission'
import type { Order, Product, User } from '../../payload-types'

/**
 * VENDÉG-VÁSÁRLÁS a pénztárban (tulajdonosi döntés, 2026-08-15).
 *
 * A vásárláshoz nem kell előbb regisztrálni: e-mail + név elég. A rendelés
 * `customer` NÉLKÜL, de kitöltött `customerEmail`-lel jön létre; a fiók a
 * fizetés UTÁN dől el (lásd order-status/resolve-order-customer.test.ts).
 *
 * Amit ez a fájl bizonyít:
 *  1. a vendég-azonosító adatok validációja (tiszta mag),
 *  2. a pénztár beküldési tervében a `guest` blokk csak vendégként megy ki,
 *  3. a checkout-start vendég-ága: fiók nélküli rendelés, e-maillel,
 *  4. aktivált e-mail vendégként 409 (belépés), a vásárlás ténye nem derül ki,
 *     aktiválatlan customer folytathatja fiók nélküli rendeléssel,
 *  5. bejelentkezve a törzs `guest` mezője figyelmen kívül marad (nem lehet
 *     idegen e-mailre rendelni).
 *
 * A Barion-hívás mockolt fetch-en megy (valódi hálózati hívás nincs — CLAUDE.md
 * 15. tanulság), a Payload local API pedig injektált mock.
 */

// DUMMY érték, egyértelműen jelölve — NEM valódi Barion POSKey.
const DUMMY_POS_KEY = 'DUMMY-POSKEY-NEM-VALODI-TITOK'
const DUMMY_PAYMENT_ID = '11111111-2222-3333-4444-555555555555'
const ORDER_NUMBER = 'KH-2026-000123'
const GATEWAY_URL = `https://secure.test.barion.com/Pay?id=${DUMMY_PAYMENT_ID}`

const GUEST = { email: 'vendeg@example.test', name: 'Vendég Vevő' }

const BILLING = {
  name: 'Vendég Vevő',
  zip: '9700',
  city: 'Szombathely',
  street: 'Fő tér 2/A',
}

const publishedProduct = {
  id: 42,
  sku: 'KURZUS-ALAP',
  status: 'published',
  priceInHUF: 5000,
  priceInHUFEnabled: true,
  shortDescription: 'Alap kurzus',
} as unknown as Product

const createdOrderDoc = {
  id: 101,
  orderNumber: ORDER_NUMBER,
  totalHufSnapshot: 5000,
  items: [{ product: 42, quantity: 1, titleSnapshot: 'KURZUS-ALAP', priceHufSnapshot: 5000 }],
} as unknown as Order

interface MockOptions {
  /** Az e-mailhez tartozó MEGLÉVŐ fiók (vendég-ág) — alapból nincs. */
  existingUser?: User | null
  /** A rendelés-keresés válasza a where alapján (duplavásárlás-ellenőrzés). */
  findOrders?: (where: unknown) => { docs: unknown[]; totalDocs: number }
}

function createMockPayload(options: MockOptions = {}) {
  const calls = {
    create: [] as Array<Record<string, unknown>>,
    userWhere: [] as unknown[],
    orderWhere: [] as unknown[],
  }
  const payload = {
    findByID: vi.fn(async () => publishedProduct),
    find: vi.fn(async (args: { collection: string; where?: unknown }) => {
      if (args.collection === 'users') {
        calls.userWhere.push(args.where)
        const user = options.existingUser ?? null
        return { docs: user ? [user] : [], totalDocs: user ? 1 : 0 }
      }
      calls.orderWhere.push(args.where)
      return options.findOrders ? options.findOrders(args.where) : { docs: [], totalDocs: 0 }
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      calls.create.push(data)
      return { ...data, ...createdOrderDoc, id: 101 }
    }),
    update: vi.fn(async ({ id, data }: { id: number | string; data: Record<string, unknown> }) => ({
      id,
      ...data,
    })),
  }
  return { payload: payload as unknown as Payload, calls }
}

const fetchMock = vi.fn()
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

function barionStartSuccess(): Response {
  return new Response(
    JSON.stringify({
      PaymentId: DUMMY_PAYMENT_ID,
      PaymentRequestId: ORDER_NUMBER,
      Status: 'Prepared',
      GatewayUrl: GATEWAY_URL,
      Transactions: [{ TransactionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }],
      Errors: [],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

/** A Barion-kliens env-je (a checkout-start.test.ts mintája szerint mentve/visszaállítva). */
const savedEnv: Record<string, string | undefined> = {}
const ENV_KEYS = [
  'BARION_API_URL',
  'BARION_PAYEE_EMAIL',
  'BARION_POSKEY_TEST',
  'NEXT_PUBLIC_SERVER_URL',
]
beforeAll(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
  }
  process.env.BARION_API_URL = 'https://api.test.barion.com'
  process.env.BARION_PAYEE_EMAIL = 'payee@example.test'
  process.env.BARION_POSKEY_TEST = DUMMY_POS_KEY
  process.env.NEXT_PUBLIC_SERVER_URL = 'https://shop.example.test'
})
afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

// ---------------------------------------------------------------------------
// 1. A vendég-azonosító adatok validációja (tiszta mag)
// ---------------------------------------------------------------------------

describe('validateGuest — a vendég azonosító adatai', () => {
  it('érvényes adat → kisbetűsített e-mail és normalizált név', () => {
    expect(
      validateGuest({ email: '  Vendeg.Vevo@Example.TEST ', name: '  Vendég   Vevő ' }),
    ).toEqual({
      ok: true,
      value: { email: 'vendeg.vevo@example.test', name: 'Vendég Vevő' },
    })
  })

  it('hiányzó mezők → mindkettőre mezőhöz kötött, magyar hiba, e-mail-lel az élen', () => {
    const result = validateGuest({})
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.errors.map((error) => error.field)).toEqual(['email', 'name'])
    expect(result.errors[1].message).toBe(GUEST_NAME_MISSING_ERROR)
  })

  it('alakilag hibás cím → invalid (a Payload users-create is elutasítaná)', () => {
    for (const email of ['nem-email', 'a@b', 'ket..pont@example.test', 'szokoz a@example.test']) {
      const result = validateGuest({ email, name: 'Teszt Elek' })
      expect(result.ok, `elfogadott hibás cím: ${email}`).toBe(false)
      if (!result.ok) {
        expect(result.errors[0].message).toBe(GUEST_EMAIL_INVALID_ERROR)
      }
    }
  })

  it('LÁTHATATLAN karakterekből álló „név" nem megy át (zero-width szűrés)', () => {
    const result = validateGuest({ email: 'a@example.test', name: '​​​' })
    expect(result.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 2. A pénztár beküldési terve
// ---------------------------------------------------------------------------

describe('planCheckoutSubmission — a vendég-blokk a törzsben', () => {
  const baseContext = {
    productId: 42,
    alreadyPurchased: false,
    waiverRequired: true,
    waiverStartAccepted: true,
    waiverLossAccepted: true,
    // Az ÁSZF-elfogadás minden ágon kötelező; a saját tesztjei a
    // penztar-aszf-elfogadas.test.tsx-ben.
    termsAccepted: true,
    billing: { ...BILLING, taxNumber: '' },
  }

  it('vendégként a `guest` blokk KIMEGY a törzsben (normalizálva)', () => {
    const plan = planCheckoutSubmission({
      ...baseContext,
      guest: { email: ' Vendeg@Example.TEST ', name: 'Vendég Vevő' },
    })
    expect(plan.kind).toBe('send')
    if (plan.kind !== 'send') {
      return
    }
    expect(plan.body.guest).toEqual({ email: 'vendeg@example.test', name: 'Vendég Vevő' })
  })

  it('bejelentkezve (nincs guest-állapot) a törzsben SINCS `guest` mező', () => {
    const plan = planCheckoutSubmission(baseContext)
    expect(plan.kind).toBe('send')
    if (plan.kind !== 'send') {
      return
    }
    expect(plan.body.guest).toBeUndefined()
  })

  it('hiányzó vendég-adatnál a beküldés meg sem indul, és a fókusz az e-mail mezőn áll', () => {
    const plan = planCheckoutSubmission({ ...baseContext, guest: { email: '', name: '' } })
    expect(plan.kind).toBe('invalid')
    if (plan.kind !== 'invalid') {
      return
    }
    expect(plan.focusElementId).toBe('kc-field-guestEmail')
    expect(plan.guestErrors.email).toBeDefined()
    expect(plan.guestErrors.name).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// 3-5. A checkout-start vendég-ága
// ---------------------------------------------------------------------------

describe('startCheckout — vendég-vásárlás', () => {
  it('ÚJ e-maillel: fiók nélküli rendelés jön létre, a snapshot id-je null', async () => {
    fetchMock.mockResolvedValueOnce(barionStartSuccess())
    const { payload, calls } = createMockPayload()

    const result = await startCheckout({
      payload,
      input: {
        productId: 42,
        consentWithdrawalWaiver: true,
        consentTerms: true,
        billing: BILLING,
        guest: GUEST,
      },
    })

    expect(result).toEqual({ orderNumber: ORDER_NUMBER, gatewayUrl: GATEWAY_URL })
    const created = calls.create[0]
    expect(created.customer).toBeUndefined()
    expect(created.customerEmail).toBe(GUEST.email)
    expect(created.customerSnapshot).toMatchObject({
      id: null,
      email: GUEST.email,
      name: GUEST.name,
      billingCity: 'Szombathely',
    })
  })

  it('hiányzó vendég-adat → 400 (a rendelés létre sem jön, a Barion nem hívódik)', async () => {
    const { payload, calls } = createMockPayload()

    await expect(
      startCheckout({
        payload,
        input: {
          productId: 42,
          consentWithdrawalWaiver: true,
          consentTerms: true,
          billing: BILLING,
        },
      }),
    ).rejects.toMatchObject({ status: 400 })
    expect(calls.create).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('aktivált fiók + már megvett kurzus → 409, NEM „már megvásároltad” (W4)', async () => {
    const { payload, calls } = createMockPayload({
      existingUser: {
        id: 7,
        email: GUEST.email,
        role: 'customer',
        passwordSetupPending: false,
      } as unknown as User,
      findOrders: (where) =>
        JSON.stringify(where ?? {}).includes('"paid"')
          ? { docs: [{ id: 55 }], totalDocs: 1 }
          : { docs: [], totalDocs: 0 },
    })

    const promise = startCheckout({
      payload,
      input: {
        productId: 42,
        consentWithdrawalWaiver: true,
        consentTerms: true,
        billing: BILLING,
        guest: GUEST,
      },
    })
    await expect(promise).rejects.toMatchObject({ status: 409 })
    await expect(promise).rejects.toThrowError(CHECKOUT_GUEST_EXISTING_ACCOUNT)
    expect(calls.create).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
    // A vásárlás-orákulum elmarad: a rendelés-táblát nem kérdezzük.
    expect(calls.orderWhere).toHaveLength(0)
  })

  it('aktivált fiók, kurzus NÉLKÜL → UGYANAZ a 409 (K2, nincs vásárlás-orákulum)', async () => {
    const { payload, calls } = createMockPayload({
      existingUser: {
        id: 7,
        email: GUEST.email,
        role: 'customer',
        passwordSetupPending: false,
        name: 'Régi Név',
      } as unknown as User,
    })

    const promise = startCheckout({
      payload,
      input: {
        productId: 42,
        consentWithdrawalWaiver: true,
        consentTerms: true,
        billing: BILLING,
        guest: GUEST,
      },
    })
    await expect(promise).rejects.toMatchObject({ status: 409 })
    await expect(promise).rejects.toThrowError(CHECKOUT_GUEST_EXISTING_ACCOUNT)
    expect(calls.create).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(calls.orderWhere).toHaveLength(0)
  })

  it('aktiválatlan customer e-maillel, még meg nem vett kurzusra: rendelés fiók nélkül', async () => {
    fetchMock.mockResolvedValueOnce(barionStartSuccess())
    const { payload, calls } = createMockPayload({
      existingUser: {
        id: 7,
        email: GUEST.email,
        name: 'Régi Név',
        role: 'customer',
        passwordSetupPending: true,
      } as unknown as User,
    })

    await startCheckout({
      payload,
      input: {
        productId: 42,
        consentWithdrawalWaiver: true,
        consentTerms: true,
        billing: BILLING,
        guest: GUEST,
      },
    })

    const created = calls.create[0]
    expect(created.customer).toBeUndefined()
    expect(created.customerEmail).toBe(GUEST.email)
  })

  /**
   * P1 / W2 — AZ E-MAIL-HATÓKÖRŰ DUPLAVÁSÁRLÁS-BLOKK (start-checkout.ts:
   * mindig `assertNoDuplicatePurchase({ kind: 'email' })`, a customer-ág
   * mellett, ha van fiók).
   *
   * MIÉRT NEM FOGTA MEG A FENTI, „LÉTEZŐ e-mail" TESZT: ott a
   * `findExistingUserByEmail` TALÁL fiókot, tehát a CUSTOMER-hatókörű
   * ellenőrzés is lefut — a vendég, fiók nélküli e-mail-ág önmagában
   * nem került mérés alá. A feltételt `if (false)`-ra cserélve a teljes
   * tesztkészlet zöld maradt.
   *
   * AZ E-MAIL-HATÓKÖR KÉT HELYEN SZÁMÍT: (1) vendég fiók nélkül — a
   * rendelés `customer` nélkül, `customerEmail`-lel jön létre, a fizetési
   * ablakon belüli újabb beküldést csak ez a szűrő látja; (2) bejelentkezett
   * vevő, akinek korábbi VENDÉG payment_pendingje van ugyanarra az e-mailre
   * (`customer: null`) — a customer-szűrő ezt nem találja, az e-mail-ág
   * nélkül második Barion-terhelés indulna. Blokk nélkül két aktív
   * `payment_pending` rendelés áll ugyanarra a kurzusra, MINDKETTŐ
   * kifizethető. A másodikat már csak a paid-átmenet K5-őre fogná meg —
   * akkor viszont a pénz MÁR le van vonva, és kézi visszatérítés kell.
   */

  /** A rendelés-lekérdezés hatóköre a where-ből (a mock döntéséhez). */
  function orderQuery(where: unknown): { text: string; wantsPaid: boolean; wantsPending: boolean } {
    const text = JSON.stringify(where ?? {})
    return {
      text,
      wantsPaid: text.includes('"paid"'),
      wantsPending: text.includes('"payment_pending"'),
    }
  }

  it('VENDÉG, fiók NÉLKÜL, aktív payment_pending rendeléssel az e-mailre → 409, rendelés és fizetés NÉLKÜL', async () => {
    const seenWhere: string[] = []
    const { payload, calls } = createMockPayload({
      // Az e-mailhez NINCS fiók — az e-mail-hatókörű ellenőrzés az EGYETLEN védelem.
      existingUser: null,
      findOrders: (where) => {
        const query = orderQuery(where)
        seenWhere.push(query.text)
        return query.wantsPending
          ? { docs: [{ id: 77 }], totalDocs: 1 }
          : { docs: [], totalDocs: 0 }
      },
    })

    const promise = startCheckout({
      payload,
      input: {
        productId: 42,
        consentWithdrawalWaiver: true,
        consentTerms: true,
        billing: BILLING,
        guest: GUEST,
      },
    })

    await expect(promise).rejects.toBeInstanceOf(CheckoutError)
    await expect(promise).rejects.toMatchObject({ status: 409 })
    await expect(promise).rejects.toThrowError(/nemrég már indult egy fizetés/)

    // Se rendelés, se Barion-hívás: a blokk a pénz levonása ELŐTT áll meg.
    expect(calls.create).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()

    // A szűrés a `customerEmail`-re ment (a fiókhoz még nem kötött rendeléseket
    // KIZÁRÓLAG ez találja meg), és nem a `customer` mezőre.
    const asText = seenWhere.join('\n')
    expect(asText).toContain('"customerEmail"')
    expect(asText).toContain(GUEST.email)
    expect(asText).not.toContain('"customer"')
  })

  it('BEJELENTKEZVE, korábbi vendég payment_pending ugyanarra az e-mailre → 409, nincs második rendelés', async () => {
    const sessionUser = {
      id: 19,
      email: GUEST.email,
      name: 'Vendég Vevő',
    } as unknown as User
    const seenWhere: string[] = []
    const { payload, calls } = createMockPayload({
      findOrders: (where) => {
        const query = orderQuery(where)
        seenWhere.push(query.text)
        // A customer-hatókörű ellenőrzés NEM látja a vendég-rendelést
        // (customer: null). Csak az e-mail-hatókörű találja meg.
        const isEmailScope = query.text.includes('"customerEmail"')
        return query.wantsPending && isEmailScope
          ? { docs: [{ id: 88, status: 'payment_pending', customer: null }], totalDocs: 1 }
          : { docs: [], totalDocs: 0 }
      },
    })

    const promise = startCheckout({
      payload,
      user: sessionUser,
      input: { productId: 42, consentWithdrawalWaiver: true, consentTerms: true, billing: BILLING },
    })

    await expect(promise).rejects.toBeInstanceOf(CheckoutError)
    await expect(promise).rejects.toMatchObject({ status: 409 })
    await expect(promise).rejects.toThrowError(/nemrég már indult egy fizetés/)
    expect(calls.create).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()

    const asText = seenWhere.join('\n')
    expect(asText).toContain('"customerEmail"')
    expect(asText).toContain(GUEST.email)
    expect(asText).toContain('"customer"')
  })

  it('VENDÉG, fiók NÉLKÜL, MÁR kifizetett rendeléssel az e-mailre → 409, nem „már megvásároltad” (W4)', async () => {
    const { payload, calls } = createMockPayload({
      existingUser: null,
      findOrders: (where) =>
        orderQuery(where).wantsPaid
          ? { docs: [{ id: 55 }], totalDocs: 1 }
          : { docs: [], totalDocs: 0 },
    })

    const promise = startCheckout({
      payload,
      input: {
        productId: 42,
        consentWithdrawalWaiver: true,
        consentTerms: true,
        billing: BILLING,
        guest: GUEST,
      },
    })

    await expect(promise).rejects.toMatchObject({ status: 409 })
    await expect(promise).rejects.toThrowError(CHECKOUT_GUEST_FINISH_AFTER_LOGIN)
    expect(calls.create).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  /**
   * NEGATÍV KONTROLL: a blokk nem lehet túlbuzgó. Egy LEJÁRT (a Barion-fizetési
   * ablakon kívüli) payment_pending nem akadályozhatja meg az új próbálkozást.
   * A fizetési ablak a `decidePendingCheckout` JS-ágán dől el, nem SQL-cutoffon;
   * ez a teszt a „nincs pending" utat méri (üres find). A lejárt pending
   * helyi cancelled + új Start útját a checkout-start teszt fedi.
   */
  it('LEJÁRT fizetési ablak (nincs aktív pending) → a vásárlás indulhat', async () => {
    fetchMock.mockResolvedValueOnce(barionStartSuccess())
    const { payload, calls } = createMockPayload({
      existingUser: null,
      findOrders: () => ({ docs: [], totalDocs: 0 }),
    })

    const result = await startCheckout({
      payload,
      input: {
        productId: 42,
        consentWithdrawalWaiver: true,
        consentTerms: true,
        billing: BILLING,
        guest: GUEST,
      },
    })

    expect(result.orderNumber).toBe(ORDER_NUMBER)
    expect(calls.create).toHaveLength(1)
  })

  /**
   * A LEKÉRDEZÉS ALAKJA: minden payment_pending a vevő+termékre, SQL-es
   * createdAt-vágás NÉLKÜL. A fizetési ablak a `decidePendingCheckout`
   * JS-ágán dől el, mert a lejárt pendinget is látni kell (helyi cancelled +
   * új Start), és ha van PaymentId, GetPaymentState kell. SQL-cutoff mellett
   * a lejárt sorok láthatatlanok maradnának.
   */
  it('a payment_pending lekérdezés nem vág createdAt-ra (az ablak JS-ben dől el)', async () => {
    const seenWhere: string[] = []
    const { payload } = createMockPayload({
      existingUser: null,
      findOrders: (where) => {
        seenWhere.push(JSON.stringify(where ?? {}))
        return { docs: [], totalDocs: 0 }
      },
    })
    fetchMock.mockResolvedValueOnce(barionStartSuccess())

    await startCheckout({
      payload,
      input: {
        productId: 42,
        consentWithdrawalWaiver: true,
        consentTerms: true,
        billing: BILLING,
        guest: GUEST,
      },
    })

    const pendingQuery = seenWhere.find((text) => text.includes('"payment_pending"'))
    expect(pendingQuery).toBeDefined()
    expect(pendingQuery).toContain('"payment_pending"')
    expect(pendingQuery).not.toContain('"createdAt"')
    expect(pendingQuery).not.toContain('greater_than')
  })

  it('BEJELENTKEZVE a törzs `guest` mezője figyelmen kívül marad (nem lehet idegen címre rendelni)', async () => {
    fetchMock.mockResolvedValueOnce(barionStartSuccess())
    const { payload, calls } = createMockPayload()
    const sessionUser = {
      id: 7,
      email: 'sajat@example.test',
      name: 'Saját Vevő',
    } as unknown as User

    await startCheckout({
      payload,
      user: sessionUser,
      input: {
        productId: 42,
        consentWithdrawalWaiver: true,
        consentTerms: true,
        billing: BILLING,
        guest: { email: 'idegen@example.test', name: 'Idegen' },
      },
    })

    const created = calls.create[0]
    expect(created.customer).toBe(7)
    expect(created.customerEmail).toBe('sajat@example.test')
    expect(created.customerSnapshot).toMatchObject({ id: 7, email: 'sajat@example.test' })
  })
})
