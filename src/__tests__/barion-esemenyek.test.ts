import { describe, expect, it, vi } from 'vitest'

import {
  BARION_CURRENCY,
  BARION_PAYMENT_METHOD,
  BARION_STEP,
  BARION_TRACK_METHOD,
  BARION_UNIT,
  barionSnapshotKey,
  buildAddPaymentInfoPayload,
  buildContentItem,
  buildContentViewPayload,
  buildInitiateCheckoutPayload,
  buildInitiatePurchasePayload,
  buildPurchasePayload,
  buildSignUpPayload,
  forgetCheckoutSnapshot,
  readCheckoutSnapshot,
  rememberCheckoutSnapshot,
  sendBarionEvent,
  trackAddPaymentInfo,
  trackContentView,
  trackInitiateCheckout,
  trackInitiatePurchase,
  trackPurchase,
  trackSignUp,
  type BarionCourseInput,
  type BarionSnapshotStorage,
} from '@/lib/analytics/barion-events'
import {
  checkoutBarionCourse,
  trackedSubmitCheckout,
  type TrackedSubmitDeps,
} from '@/components/checkout/CheckoutForm'
import { emitBarionPurchase, type BarionPurchaseDeps } from '@/components/checkout/ThankYouView'
import type { CheckoutSubmitInput, CheckoutSubmitResult } from '@/lib/checkout-submit'

/**
 * A Barion Pixel FOLYAMAT-eseményeinek őr-tesztjei.
 * A szerződést nem memóriából, hanem a futtatott pixel-kódból vettük:
 * forrás). A `handle_message_from_queue` minden követési ága
 * `if (msg.length !== 3)` ellenőrzéssel indul → a hívás pontosan
 * `bp('track', '<esemény>', { … })`. A törzseket a `validate(d, event_name,
 */

/** Egy tipikus fizetős kurzus. */
const COURSE: BarionCourseInput = {
  id: 12,
  name: 'Kézrehabilitáció otthon',
  priceHuf: 24900,
}

/** A bp.js `to_contents` szerinti KÖTELEZŐ kulcsok egy `contents` tételen. */
const CONTENTS_MANDATORY_KEYS = [
  'id',
  'contentType',
  'name',
  'unit',
  'unitPrice',
  'totalItemPrice',
  'currency',
  'quantity',
] as const

/**
 * A bp.js `type_conversion` táblái eseményenként — ami itt nincs benne, azt a
 * pixel ismeretlen kulcsként ELDOBJA (13-as hiba). A tesztek ehhez mérik a
 * törzsek kulcsait.
 */
const RECOGNIZED_KEYS: Record<string, readonly string[]> = {
  contentView: [
    'id',
    'contentType',
    'name',
    'contents',
    'ean',
    'brand',
    'category',
    'variant',
    'list',
    'positioning',
    'creative',
    'unitPrice',
    'imageUrl',
    'unit',
    'currency',
    'quantity',
    'step',
    'customerValue',
  ],
  funnel: [
    'contentType',
    'contents',
    'list',
    'positioning',
    'creative',
    'currency',
    'step',
    'customerValue',
    'coupon',
    'orderNumber',
    'revenue',
    'tax',
    'shipping',
    'shippingAddress',
    'opt',
    'paymentMethod',
  ],
  signUp: [
    'id',
    'contentType',
    'name',
    'contents',
    'customerValue',
    'currency',
    'ean',
    'brand',
    'category',
    'variant',
    'unit',
    'unitPrice',
  ],
  contents: [
    'id',
    'contentType',
    'name',
    'brand',
    'category',
    'unit',
    'unitPrice',
    'totalItemPrice',
    'currency',
    'quantity',
    'ean',
    'variant',
    'description',
    'imageUrl',
  ],
}

/** Egy `bp`-kém, amely a HÍVÁSI ALAKOT is megőrzi. */
function spy() {
  const calls: unknown[][] = []
  const send = (...args: readonly unknown[]): void => {
    calls.push([...args])
  }
  return { calls, send }
}

/** Memóriabeli `sessionStorage`-utánzat (a vitest `environment: 'node'`). */
function memoryStorage(): BarionSnapshotStorage & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value)
    },
    removeItem: (key) => {
      map.delete(key)
    },
  }
}

describe('Barion Pixel — hívási alak', () => {
  it('minden követési esemény HÁROM paraméterrel megy ki: track + név + törzs', () => {
    const { calls, send } = spy()
    trackContentView(COURSE, { list: 'ProductPage' }, send)
    trackInitiateCheckout(COURSE, send)
    trackAddPaymentInfo(COURSE, send)
    trackInitiatePurchase(COURSE, 'KIN-2026-0001', send)
    trackPurchase(COURSE, { orderNumber: 'KIN-2026-0001', succeeded: true }, send)
    trackSignUp({ id: 'regisztracio', name: 'Regisztráció' }, send)

    expect(calls).toHaveLength(6)
    expect(calls.map((call) => call[1])).toEqual([
      'contentView',
      'initiateCheckout',
      'addPaymentInfo',
      'initiatePurchase',
      'purchase',
      'signUp',
    ])
    for (const call of calls) {
      // A bp.js minden ága `msg.length !== 3`-ra hibázik: se több, se kevesebb.
      expect(call).toHaveLength(3)
      expect(call[0]).toBe(BARION_TRACK_METHOD)
      expect(BARION_TRACK_METHOD).toBe('track')
      expect(typeof call[2]).toBe('object')
    }
  })

  it('a küldés SOSEM dob — a dobó pixel nem viheti magával a vásárlást', () => {
    const explode = (): void => {
      throw new Error('a pixel elszállt')
    }
    expect(() => trackInitiatePurchase(COURSE, 'KIN-1', explode)).not.toThrow()
    expect(trackInitiatePurchase(COURSE, 'KIN-1', explode)).toBe(false)
    // A sikeres küldés viszont igazat ad — a `false` nem lehet konstans válasz.
    const { send } = spy()
    expect(trackInitiatePurchase(COURSE, 'KIN-1', send)).toBe(true)
  })

  it('hiányos adatnál NEM megy ki csonka esemény (a pixel úgyis eldobná)', () => {
    const { calls, send } = spy()
    const noPrice: BarionCourseInput = { id: 12, name: 'Kurzus', priceHuf: Number.NaN }
    const noName: BarionCourseInput = { id: 12, name: '   ', priceHuf: 1000 }
    const noId: BarionCourseInput = { id: 0, name: 'Kurzus', priceHuf: 1000 }

    expect(trackInitiateCheckout(noPrice, send)).toBe(false)
    expect(trackContentView(noName, {}, send)).toBe(false)
    expect(trackPurchase(noId, { orderNumber: 'KIN-1', succeeded: true }, send)).toBe(false)
    expect(calls).toHaveLength(0)
    expect(buildContentItem(noPrice)).toBeNull()
    expect(sendBarionEvent('purchase', null, send)).toBe(false)
  })
})

describe('Barion Pixel — kötelező kulcsok és típusok', () => {
  it('a contents tétel MINDEN kötelező kulcsot visz, helyes típussal', () => {
    const item = buildContentItem({ ...COURSE, quantity: 2, category: ' Otthoni ' })
    expect(item).not.toBeNull()
    if (item === null) {
      throw new Error('a tétel nem épült fel')
    }
    for (const key of CONTENTS_MANDATORY_KEYS) {
      expect(Object.keys(item)).toContain(key)
    }
    // A bp.js `to_str` mezői VALÓDI stringet várnak: a szám-id nem mehet ki számként.
    expect(typeof item.id).toBe('string')
    expect(item.id).toBe('12')
    expect(item.contentType).toBe('Product')
    expect(item.unit).toBe(BARION_UNIT)
    expect(item.currency).toBe(BARION_CURRENCY)
    expect(item.currency).toHaveLength(3) // bp.js format_check
    // `to_float` mezők: valódi szám, és a totalItemPrice = unitPrice * quantity.
    expect(typeof item.unitPrice).toBe('number')
    expect(typeof item.quantity).toBe('number')
    expect(item.totalItemPrice).toBe(24900 * 2)
    expect(item.category).toBe('Otthoni')
    // Ismeretlen kulcs nem kerülhet a tételbe.
    for (const key of Object.keys(item)) {
      expect(RECOGNIZED_KEYS.contents).toContain(key)
    }
  })

  it('contentView (Product): a termék-ág többlet-kötelezői ott vannak, totalItemPrice NINCS', () => {
    const payload = buildContentViewPayload({ ...COURSE, imageUrl: 'https://p/k.jpg' }, {
      list: 'ProductPage',
    })
    expect(payload).not.toBeNull()
    if (payload === null) {
      throw new Error('a contentView törzse nem épült fel')
    }
    // bp.js: mandatory_keys = ['id','contentType','name'], és
    // contentType === 'Product' esetén még unitPrice, unit, currency, quantity.
    for (const key of ['id', 'contentType', 'name', 'unitPrice', 'unit', 'currency', 'quantity']) {
      expect(Object.keys(payload)).toContain(key)
    }
    expect(payload.contentType).toBe('Product')
    expect(payload.list).toBe('ProductPage')
    // A contentView type_conversion táblája NEM ismeri a totalItemPrice-t és a
    // revenue-t: a pixel 13-as hibát adna rájuk és törölné őket.
    expect(Object.keys(payload)).not.toContain('totalItemPrice')
    expect(Object.keys(payload)).not.toContain('revenue')
    for (const key of Object.keys(payload)) {
      expect(RECOGNIZED_KEYS.contentView).toContain(key)
    }
  })

  it('initiateCheckout: contents + currency + revenue + step, a step az 1. lépés', () => {
    const payload = buildInitiateCheckoutPayload(COURSE)
    expect(payload).not.toBeNull()
    if (payload === null) {
      throw new Error('az initiateCheckout törzse nem épült fel')
    }
    for (const key of ['contents', 'currency', 'revenue', 'step']) {
      expect(Object.keys(payload)).toContain(key)
    }
    expect(Array.isArray(payload.contents)).toBe(true)
    expect(payload.contents).toHaveLength(1)
    expect(payload.currency).toBe('HUF')
    expect(payload.revenue).toBe(24900)
    expect(payload.step).toBe(1)
    expect(BARION_STEP.initiateCheckout).toBe(1)
    expect(payload.list).toBe('Checkout') // bp.js in_list engedélyezett érték
    // A funnel-események NEM ismerik az `id`/`name` kulcsot.
    expect(Object.keys(payload)).not.toContain('id')
    expect(Object.keys(payload)).not.toContain('name')
    for (const key of Object.keys(payload)) {
      expect(RECOGNIZED_KEYS.funnel).toContain(key)
    }
  })

  it('addPaymentInfo: contents + paymentMethod + step (a paymentMethod kötelező)', () => {
    const payload = buildAddPaymentInfoPayload(COURSE)
    expect(payload).not.toBeNull()
    if (payload === null) {
      throw new Error('az addPaymentInfo törzse nem épült fel')
    }
    for (const key of ['contents', 'paymentMethod', 'step']) {
      expect(Object.keys(payload)).toContain(key)
    }
    expect(payload.paymentMethod).toBe(BARION_PAYMENT_METHOD)
    expect(typeof payload.paymentMethod).toBe('string')
    expect(payload.step).toBe(BARION_STEP.addPaymentInfo)
    for (const key of Object.keys(payload)) {
      expect(RECOGNIZED_KEYS.funnel).toContain(key)
    }
  })

  it('initiatePurchase: a rendelésszámmal megy ki, az átjáróra irányítás lépésével', () => {
    const payload = buildInitiatePurchasePayload(COURSE, 'KIN-2026-0007')
    expect(payload).not.toBeNull()
    if (payload === null) {
      throw new Error('az initiatePurchase törzse nem épült fel')
    }
    for (const key of ['contents', 'currency', 'revenue', 'step']) {
      expect(Object.keys(payload)).toContain(key)
    }
    expect(payload.orderNumber).toBe('KIN-2026-0007')
    expect(payload.step).toBe(BARION_STEP.initiatePurchase)
    // Rendelésszám nélkül a kulcs KIMARAD (üres string nem mehet ki).
    const withoutOrder = buildInitiatePurchasePayload(COURSE, null)
    expect(withoutOrder).not.toBeNull()
    expect(Object.keys(withoutOrder ?? {})).not.toContain('orderNumber')
  })

  it('signUp: contentType Page + id + name, és step NÉLKÜL (a bp.js nem ismeri)', () => {
    const payload = buildSignUpPayload({ id: 'hirlevel', name: 'Hírlevél feliratkozás' })
    expect(payload).toEqual({
      contentType: 'Page',
      id: 'hirlevel',
      name: 'Hírlevél feliratkozás',
    })
    expect(Object.keys(payload ?? {})).not.toContain('step')
    for (const key of Object.keys(payload ?? {})) {
      expect(RECOGNIZED_KEYS.signUp).toContain(key)
    }
    expect(buildSignUpPayload({ id: '', name: 'Regisztráció' })).toBeNull()
  })
})

describe('Barion Pixel — a purchase kimenetele', () => {
  it('SIKERES fizetés: a záró lépés megy ki, pozitív step-pel', () => {
    const payload = buildPurchasePayload(COURSE, {
      orderNumber: 'KIN-2026-0009',
      succeeded: true,
    })
    expect(payload?.step).toBe(BARION_STEP.purchase)
    expect(payload?.step).toBeGreaterThan(0)
    expect(payload?.revenue).toBe(24900)
    expect(payload?.currency).toBe('HUF')
    expect(payload?.orderNumber).toBe('KIN-2026-0009')
  })

  it('SIKERTELEN fizetés: step === -1 (enélkül a Barion bevételnek látná)', () => {
    const payload = buildPurchasePayload(COURSE, {
      orderNumber: 'KIN-2026-0009',
      succeeded: false,
    })
    expect(payload?.step).toBe(-1)
    expect(BARION_STEP.purchaseFailed).toBe(-1)
    // A két ág step-je nem eshet egybe — különben a jelzés nem hordoz információt.
    expect(BARION_STEP.purchase).not.toBe(BARION_STEP.purchaseFailed)
    // A kötelező kulcsok a bukott ágon is kimennek.
    for (const key of ['contents', 'currency', 'revenue', 'step']) {
      expect(Object.keys(payload ?? {})).toContain(key)
    }
  })

  it('a küldött purchase-esemény step-je a kimeneteltől függ (nem csak a builderé)', () => {
    const { calls, send } = spy()
    trackPurchase(COURSE, { orderNumber: 'KIN-1', succeeded: true }, send)
    trackPurchase(COURSE, { orderNumber: 'KIN-1', succeeded: false }, send)
    const steps = calls.map((call) => (call[2] as { step: number }).step)
    expect(steps).toEqual([BARION_STEP.purchase, -1])
  })
})

describe('Barion Pixel — kosár-pillanatkép a köszönőoldalhoz', () => {
  it('a pénztárban eltett kosár a rendelésszámmal olvasható vissza', () => {
    const storage = memoryStorage()
    expect(rememberCheckoutSnapshot(storage, 'KIN-2026-0100', COURSE)).toBe(true)
    expect(storage.map.has(barionSnapshotKey('KIN-2026-0100'))).toBe(true)

    const restored = readCheckoutSnapshot(storage, 'KIN-2026-0100')
    expect(restored).not.toBeNull()
    expect(buildPurchasePayload(restored as BarionCourseInput, {
      orderNumber: 'KIN-2026-0100',
      succeeded: true,
    })?.revenue).toBe(24900)

    // MÁS rendelésszámra nincs találat — a kulcsolás nem lehet globális.
    expect(readCheckoutSnapshot(storage, 'KIN-2026-0999')).toBeNull()

    // Kiküldés után eldobjuk: az újratöltés ne duplázza a konverziót.
    forgetCheckoutSnapshot(storage, 'KIN-2026-0100')
    expect(readCheckoutSnapshot(storage, 'KIN-2026-0100')).toBeNull()
  })

  it('sérült, hiányzó vagy dobó tároló esetén NINCS purchase-esemény', () => {
    const storage = memoryStorage()
    storage.map.set(barionSnapshotKey('KIN-1'), 'nem json')
    expect(readCheckoutSnapshot(storage, 'KIN-1')).toBeNull()

    storage.map.set(barionSnapshotKey('KIN-2'), JSON.stringify({ id: 5, name: 'Kurzus' }))
    expect(readCheckoutSnapshot(storage, 'KIN-2')).toBeNull()

    expect(readCheckoutSnapshot(null, 'KIN-3')).toBeNull()
    expect(rememberCheckoutSnapshot(null, 'KIN-3', COURSE)).toBe(false)

    const throwing: BarionSnapshotStorage = {
      getItem: () => {
        throw new Error('tiltott tároló')
      },
      setItem: () => {
        throw new Error('tiltott tároló')
      },
      removeItem: () => {
        throw new Error('tiltott tároló')
      },
    }
    expect(() => readCheckoutSnapshot(throwing, 'KIN-4')).not.toThrow()
    expect(readCheckoutSnapshot(throwing, 'KIN-4')).toBeNull()
    expect(rememberCheckoutSnapshot(throwing, 'KIN-4', COURSE)).toBe(false)
    expect(() => forgetCheckoutSnapshot(throwing, 'KIN-4')).not.toThrow()
  })
})

describe('Barion Pixel — a pénztár termékének leképezése', () => {
  it('ingyenes kurzus 0 forintos tételt ad, hiányos árú fizetős NEM ad eseményt', () => {
    const free = checkoutBarionCourse({ id: 7, sku: 'Villámkurzus', priceHuf: null, isFree: true })
    expect(free.priceHuf).toBe(0)
    expect(buildInitiateCheckoutPayload(free)?.revenue).toBe(0)

    const broken = checkoutBarionCourse({ id: 8, sku: 'Hibás', priceHuf: null, isFree: false })
    expect(Number.isNaN(broken.priceHuf)).toBe(true)
    // Kitalált ár helyett csend: a hamis bevételi adat rosszabb a hiányzónál.
    const { calls, send } = spy()
    expect(trackInitiateCheckout(broken, send)).toBe(false)
    expect(calls).toHaveLength(0)

    const paid = checkoutBarionCourse({ id: 9, sku: 'Fizetős', priceHuf: 19900, isFree: false })
    expect(buildInitiateCheckoutPayload(paid)?.revenue).toBe(19900)
  })

  it('a pénztár neve a kurzus címéből jön, az azonosító a termék-id-ből', () => {
    const course = checkoutBarionCourse({
      id: 42,
      sku: 'Kézrehabilitáció otthon',
      priceHuf: 24900,
      isFree: false,
    })
    const item = buildContentItem(course)
    expect(item?.id).toBe('42')
    expect(item?.name).toBe('Kézrehabilitáció otthon')
  })
})

describe('Barion Pixel — a személyes adat kizárása', () => {
  it('egyetlen esemény törzsében sincs e-mail, név-mező vagy cím', () => {
    const { calls, send } = spy()
    trackContentView(COURSE, { list: 'ProductPage' }, send)
    trackInitiateCheckout(COURSE, send)
    trackAddPaymentInfo(COURSE, send)
    trackInitiatePurchase(COURSE, 'KIN-1', send)
    trackPurchase(COURSE, { orderNumber: 'KIN-1', succeeded: false }, send)

    const forbidden = ['email', 'phone', 'userId', 'shippingAddress', 'billing', 'guest']
    for (const call of calls) {
      const serialized = JSON.stringify(call[2])
      for (const key of forbidden) {
        expect(serialized).not.toContain(`"${key}"`)
      }
    }
  })

  it('a pillanatkép sem tárol személyes adatot', () => {
    const storage = memoryStorage()
    rememberCheckoutSnapshot(storage, 'KIN-1', COURSE)
    const raw = storage.map.get(barionSnapshotKey('KIN-1')) ?? ''
    expect(Object.keys(JSON.parse(raw) as Record<string, unknown>).sort()).toEqual([
      'id',
      'name',
      'priceHuf',
      'quantity',
    ])
  })
})

describe('Barion Pixel — a szállítás hiánya', () => {
  it('digitális termék: shipping és shippingAddress SEHOL nem megy ki', () => {
    const payloads = [
      buildInitiateCheckoutPayload(COURSE),
      buildAddPaymentInfoPayload(COURSE),
      buildInitiatePurchasePayload(COURSE, 'KIN-1'),
      buildPurchasePayload(COURSE, { orderNumber: 'KIN-1', succeeded: true }),
    ]
    for (const payload of payloads) {
      expect(payload).not.toBeNull()
      expect(Object.keys(payload ?? {})).not.toContain('shipping')
      expect(Object.keys(payload ?? {})).not.toContain('shippingAddress')
    }
  })
})

/**
 * A HUZALOZÁS őrei. A `form-submission.ts` fejkommentje rögzíti a tanulságot:
 * a mag és a komponens KÖZTI kötés az a pont, amit mutációval el lehet rontani
 * úgy, hogy a teljes suite zöld marad. Az alábbi tesztek ezért nem a
 * buildereket, hanem a beküldési láncot és a köszönőoldal kiküldését mérik.
 */
describe('Barion Pixel — a pénztár beküldési láncának huzalozása', () => {
  const BODY = { productId: 12, quantity: 1, consentWithdrawalWaiver: true } as unknown as
    CheckoutSubmitInput

  function trackedDeps(result: CheckoutSubmitResult) {
    const storage = memoryStorage()
    const events: { name: string; orderNumber?: string | null }[] = []
    const submitted: CheckoutSubmitInput[] = []
    const deps: TrackedSubmitDeps = {
      submit: async (body) => {
        submitted.push(body)
        return result
      },
      storage: () => storage,
      addPaymentInfo: () => {
        events.push({ name: 'addPaymentInfo' })
        return true
      },
      initiatePurchase: (_course, orderNumber) => {
        events.push({ name: 'initiatePurchase', orderNumber })
        return true
      },
      remember: (target, orderNumber, course) =>
        rememberCheckoutSnapshot(target, orderNumber, course),
    }
    return { deps, events, storage, submitted }
  }

  it('sikeres indítás: addPaymentInfo → beküldés → initiatePurchase a rendelésszámmal', async () => {
    const { deps, events, storage, submitted } = trackedDeps({
      ok: true,
      orderNumber: 'KIN-2026-0300',
      gatewayUrl: 'https://secure.barion.com/Pay?Id=abc',
    })
    const submit = trackedSubmitCheckout(
      { id: 12, sku: 'Kézrehabilitáció otthon', priceHuf: 24900, isFree: false },
      deps,
    )
    const result = await submit(BODY)

    // A burkoló NEM változtat a beküldésen: ugyanaz a törzs, ugyanaz az eredmény.
    expect(submitted).toEqual([BODY])
    expect(result).toEqual({
      ok: true,
      orderNumber: 'KIN-2026-0300',
      gatewayUrl: 'https://secure.barion.com/Pay?Id=abc',
    })
    // A sorrend számít: a fizetési mód a beküldés ELŐTT, az átjáróra irányítás UTÁN.
    expect(events).toEqual([
      { name: 'addPaymentInfo' },
      { name: 'initiatePurchase', orderNumber: 'KIN-2026-0300' },
    ])
    // És a köszönőoldal kosár-pillanatképe is elkészült.
    expect(readCheckoutSnapshot(storage, 'KIN-2026-0300')).not.toBeNull()
  })

  it('SIKERTELEN indítás: nincs initiatePurchase és nincs pillanatkép', async () => {
    const { deps, events, storage } = trackedDeps({ ok: false, message: 'Hiba' })
    const submit = trackedSubmitCheckout(
      { id: 12, sku: 'Kézrehabilitáció otthon', priceHuf: 24900, isFree: false },
      deps,
    )
    const result = await submit(BODY)

    expect(result.ok).toBe(false)
    expect(events).toEqual([{ name: 'addPaymentInfo' }])
    expect(storage.map.size).toBe(0)
  })

  it('a dobó Pixel NEM viszi magával a beküldést (a vásárlás megy tovább)', async () => {
    const { deps } = trackedDeps({
      ok: true,
      orderNumber: 'KIN-2026-0301',
      gatewayUrl: 'https://secure.barion.com/Pay?Id=abc',
    })
    const explodingDeps: TrackedSubmitDeps = {
      ...deps,
      addPaymentInfo: () => trackAddPaymentInfo(COURSE, () => {
        throw new Error('a pixel elszállt')
      }),
      initiatePurchase: (course, orderNumber) =>
        trackInitiatePurchase(course, orderNumber, () => {
          throw new Error('a pixel elszállt')
        }),
    }
    const submit = trackedSubmitCheckout(
      { id: 12, sku: 'Kézrehabilitáció otthon', priceHuf: 24900, isFree: false },
      explodingDeps,
    )
    await expect(submit(BODY)).resolves.toMatchObject({ ok: true })
  })
})

describe('Barion Pixel — a köszönőoldal huzalozása', () => {
  function purchaseDeps(storage: BarionSnapshotStorage) {
    const sent: { succeeded: boolean; step: number }[] = []
    const forgotten: string[] = []
    const deps: BarionPurchaseDeps = {
      storage: () => storage,
      read: readCheckoutSnapshot,
      track: (course, input) => {
        const payload = buildPurchasePayload(course, input)
        sent.push({ succeeded: input.succeeded, step: payload?.step ?? 0 })
        return payload !== null
      },
      forget: (target, orderNumber) => {
        forgotten.push(orderNumber)
        forgetCheckoutSnapshot(target, orderNumber)
      },
    }
    return { deps, sent, forgotten }
  }

  it('SIKERES fizetésnél a záró lépés, SIKERTELENNÉL step: -1 megy ki', () => {
    const storage = memoryStorage()
    rememberCheckoutSnapshot(storage, 'KIN-A', COURSE)
    rememberCheckoutSnapshot(storage, 'KIN-B', COURSE)
    const { deps, sent } = purchaseDeps(storage)

    expect(emitBarionPurchase('KIN-A', true, deps)).toBe(true)
    expect(emitBarionPurchase('KIN-B', false, deps)).toBe(true)
    expect(sent).toEqual([
      { succeeded: true, step: BARION_STEP.purchase },
      { succeeded: false, step: -1 },
    ])
  })

  it('a kiküldés után a pillanatkép eltűnik — az újratöltés nem duplázza a konverziót', () => {
    const storage = memoryStorage()
    rememberCheckoutSnapshot(storage, 'KIN-C', COURSE)
    const { deps, sent, forgotten } = purchaseDeps(storage)

    expect(emitBarionPurchase('KIN-C', true, deps)).toBe(true)
    expect(forgotten).toEqual(['KIN-C'])
    // Második futás (oldal-újratöltés): nincs pillanatkép → nincs esemény.
    expect(emitBarionPurchase('KIN-C', true, deps)).toBe(false)
    expect(sent).toHaveLength(1)
  })

  it('pillanatkép nélkül (más fül/eszköz) NINCS csonka purchase-esemény', () => {
    const { deps, sent } = purchaseDeps(memoryStorage())
    expect(emitBarionPurchase('KIN-ISMERETLEN', true, deps)).toBe(false)
    expect(sent).toHaveLength(0)
  })
})

describe('Barion Pixel — a valódi bp küldő illesztése', () => {
  it('a modul a barion-pixel `bp`-jét használja alapértelmezett küldőként', async () => {
    // A `send` elhagyásakor a `bp` fut le — SSR-ben (nincs window) némán no-op,
    // tehát a hívásnak akkor sem szabad dobnia.
    vi.resetModules()
    const events = await import('@/lib/analytics/barion-events')
    expect(typeof window).toBe('undefined')
    expect(() => events.trackInitiateCheckout(COURSE)).not.toThrow()
    expect(events.trackInitiateCheckout(COURSE)).toBe(true)
  })
})
