import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * VIDEÓ-MÉLYSÉG ÉS PÉNZTÁRI HIBAKÖVETÉS — a két új mérés őre.
 * 1. A MÉRFÖLDKŐ-RETESZ. Ez a fájl legfontosabb állítása. A lejátszó
 * `timeupdate` eseménye másodpercenként többször érkezik, a néző pedig
 * VISSZATEKERHET — retesz nélkül ugyanaz az ember tucatszor átlépné a
 * 25/50/75%-ot, és a tölcsér HAMIS képet adna (egy néző sokszor számítana).
 */

/** Hangosan dobó őr — ha bármi mégis a globális fetch-hez nyúlna. */
const halozatiOr = () => {
  throw new Error('TESZT: valódi hálózati hívás nem futhat')
}
vi.stubGlobal('fetch', halozatiOr)

const captureAnalyticsEvent = vi.fn()
const captureAnalyticsException = vi.fn()

vi.mock('../../lib/analytics/posthog', async () => {
  const tenyleges = await vi.importActual<typeof import('../../lib/analytics/posthog')>(
    '../../lib/analytics/posthog',
  )
  return {
    ...tenyleges,
    captureAnalyticsEvent: (...args: unknown[]) => captureAnalyticsEvent(...args),
    captureAnalyticsException: (...args: unknown[]) => captureAnalyticsException(...args),
  }
})

const { createVideoDepthTracker } = await import('../../components/account/player/analytics')
const { ANALYTICS_EVENTS } = await import('../../lib/analytics/posthog')
const { VIDEO_MILESTONE_PERCENTS, trackVideoMilestone, trackVideoStarted } = await import(
  '../../lib/analytics/course-events'
)
const {
  CHECKOUT_FAILURE_REASONS,
  checkoutFailureFromPlan,
  reportCheckoutFailure,
  trackedSubmitCheckout,
} = await import('../../components/checkout/CheckoutForm')
const {
  CHECKOUT_ERROR_REGION_ID,
  TERMS_INPUT_ID,
  WAIVER_START_INPUT_ID,
  billingInputId,
  planCheckoutSubmission,
} = await import('../../lib/checkout/form-submission')
const { readFile } = await import('node:fs/promises')

type CheckoutSubmitInput = import('../../lib/checkout-submit').CheckoutSubmitInput
type CheckoutSubmitResult = import('../../lib/checkout-submit').CheckoutSubmitResult
type TrackedSubmitDeps = import('../../components/checkout/CheckoutForm').TrackedSubmitDeps
type CheckoutSubmissionContext =
  import('../../lib/checkout/form-submission').CheckoutSubmissionContext

beforeEach(() => {
  captureAnalyticsEvent.mockReset()
  captureAnalyticsException.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal('fetch', halozatiOr)
})

/** A rögzített hívások [eseménynév, tulajdonságok] párként. */
function hivasok(): [string, Record<string, unknown>][] {
  return captureAnalyticsEvent.mock.calls as [string, Record<string, unknown>][]
}

/** Az adott nevű események tulajdonságai, sorrendben. */
function esemenyek(nev: string): Record<string, unknown>[] {
  return hivasok()
    .filter(([name]) => name === nev)
    .map(([, props]) => props)
}

// A) VIDEÓ-MÉLYSÉG — a döntés és a RETESZ

/** Egy lejátszási sor lefuttatása; a kiadott mérföldkövek sorban. */
function lejatszas(
  tracker: ReturnType<typeof createVideoDepthTracker>,
  pozíciók: readonly number[],
  duration: number,
): number[] {
  const kiadott: number[] = []
  for (const seconds of pozíciók) {
    kiadott.push(...tracker.position({ seconds, duration }).milestones)
  }
  return kiadott
}

describe('videó-mélység — a lejátszás indulása', () => {
  it('a 0. másodperc még NEM indulás (a betöltött, de álló lejátszó is ott van)', () => {
    const tracker = createVideoDepthTracker()
    expect(tracker.position({ seconds: 0, duration: 100 }).started).toBe(false)
  })

  it('az első ELŐREHALADÓ pozíció indulás — de csak EGYSZER', () => {
    const tracker = createVideoDepthTracker()
    expect(tracker.position({ seconds: 0.25, duration: 100 }).started).toBe(true)
    expect(tracker.position({ seconds: 0.5, duration: 100 }).started).toBe(false)
    expect(tracker.position({ seconds: 30, duration: 100 }).started).toBe(false)
    // A visszatekerés sem indítja újra.
    expect(tracker.position({ seconds: 1, duration: 100 }).started).toBe(false)
  })

  it('a videó vége is latch-eli az indulást (mérföldkő nem mehet ki nélküle)', () => {
    const tracker = createVideoDepthTracker()
    const vege = tracker.ended()
    expect(vege.started).toBe(true)
    expect(vege.milestones).toEqual([25, 50, 75, 100])
    expect(tracker.ended().started).toBe(false)
  })

  it('a hibás pozíciót (NaN, végtelen, negatív) csendben eldobja', () => {
    const tracker = createVideoDepthTracker()
    for (const seconds of [Number.NaN, Number.POSITIVE_INFINITY, -5]) {
      const events = tracker.position({ seconds, duration: 100 })
      expect(events).toEqual({ started: false, milestones: [] })
    }
  })
})

describe('videó-mélység — a mérföldkövek', () => {
  it('a mért mélységek: 25 / 50 / 75 / 100 százalék', () => {
    expect(VIDEO_MILESTONE_PERCENTS).toEqual([25, 50, 75, 100])
  })

  it('a küszöb ALATT nincs esemény, a küszöbön pontosan egy', () => {
    const tracker = createVideoDepthTracker()
    expect(lejatszas(tracker, [1, 24.9], 100)).toEqual([])
    expect(lejatszas(tracker, [25], 100)).toEqual([25])
    expect(lejatszas(tracker, [26, 30, 49.9], 100)).toEqual([])
    expect(lejatszas(tracker, [50], 100)).toEqual([50])
    expect(lejatszas(tracker, [75], 100)).toEqual([75])
  })

  it('a SŰRŰ timeupdate nem szór ismétlődő mérföldkövet', () => {
    const tracker = createVideoDepthTracker()
    // 0,25 másodpercenként érkező esemény a 24. és a 30. másodperc között.
    const pozíciók = Array.from({ length: 25 }, (_, i) => 24 + i * 0.25)
    expect(lejatszas(tracker, pozíciók, 100)).toEqual([25])
  })

  it('a videó VÉGE adja a 100%-ot (a pozíció ritkán ér el pontosan a hosszig)', () => {
    const tracker = createVideoDepthTracker()
    lejatszas(tracker, [1, 25, 50, 75, 99.4], 100)
    expect(tracker.ended().milestones).toEqual([100])
    // És csak egyszer: a lejátszó `ended`-et ismételten is küldhet.
    expect(tracker.ended().milestones).toEqual([])
  })

  it('a mélység a lejátszófej pozíciójából számol (a hossz a nevező)', () => {
    const tracker = createVideoDepthTracker()
    // 40 másodperces videó: a 10. másodperc a 25%.
    expect(lejatszas(tracker, [9.9], 40)).toEqual([])
    expect(lejatszas(tracker, [10], 40)).toEqual([25])
  })

  it('ISMERETLEN hossz mellett nincs mérföldkő (a százalék hazugság lenne)', () => {
    for (const duration of [null, 0, Number.NaN, -10]) {
      const tracker = createVideoDepthTracker()
      const events = tracker.position({ seconds: 30, duration })
      // Az indulás attól még jelződik: ahhoz nem kell nevező.
      expect(events.started).toBe(true)
      expect(events.milestones).toEqual([])
    }
  })

  it('a leckék követői FÜGGETLENEK (az egyik retesze nem hallgattatja el a másikat)', () => {
    const elso = createVideoDepthTracker()
    const masodik = createVideoDepthTracker()
    expect(lejatszas(elso, [1, 30], 100)).toEqual([25])
    expect(lejatszas(masodik, [1, 30], 100)).toEqual([25])
  })
})

describe('videó-mélység — A RETESZ (visszatekerés)', () => {
  /**
   * EZ A FÁJL LEGFONTOSABB ÁLLÍTÁSA. Retesz nélkül a második, visszatekerés
   * utáni áthaladás ÚJRA kiadná a 25%-ot és az 50%-ot — egyetlen néző így
   * kétszer számítana a tölcsérben.
   */
  it('a visszatekerés után újra átlépett küszöbök NEM mennek ki még egyszer', () => {
    const tracker = createVideoDepthTracker()
    const elsoMenet = lejatszas(tracker, [1, 25, 40, 50, 60], 100)
    expect(elsoMenet).toEqual([25, 50])

    // A néző visszateker az elejére, és újra végigmegy ugyanazon a szakaszon.
    const masodikMenet = lejatszas(tracker, [5, 20, 26, 40, 51, 61], 100)
    expect(masodikMenet).toEqual([])
  })

  it('oda-vissza tekergetés után is CSAK az ÚJ mélység ad eseményt', () => {
    const tracker = createVideoDepthTracker()
    expect(lejatszas(tracker, [1, 30], 100)).toEqual([25])
    // Vissza az elejére, előre a feléig, megint vissza, majd tovább a 75%-ig.
    expect(lejatszas(tracker, [2, 51, 3, 52, 10], 100)).toEqual([50])
    expect(lejatszas(tracker, [76], 100)).toEqual([75])
    // A teljes lefutásban mindegyik mérföldkő pontosan egyszer szerepelt.
    expect(lejatszas(tracker, [80, 90, 95], 100)).toEqual([])
  })

  it('a videó VÉGE sem küldi újra a már kiadott mérföldköveket', () => {
    const tracker = createVideoDepthTracker()
    expect(lejatszas(tracker, [1, 25, 50, 75], 100)).toEqual([25, 50, 75])
    expect(tracker.ended().milestones).toEqual([100])
  })
})

// B) A VIDEÓ-ESEMÉNYEK SZERZŐDÉSE (eseménynév + tulajdonságok)

describe('a videó-mélység eseményeinek szerződése', () => {
  it('az eseménynevek rögzítettek (a riportok ezekre a sztringekre épülnek)', () => {
    expect(ANALYTICS_EVENTS.videoStarted).toBe('video_started')
    expect(ANALYTICS_EVENTS.videoMilestone).toBe('video_milestone')
  })

  it('a video_started a kurzus- és a lecke-azonosítót küldi', () => {
    trackVideoStarted({ courseId: 42, lessonRef: '68f0a1b2c3d4e5f6a7b8c9d0' })
    expect(hivasok()).toEqual([
      ['video_started', { courseId: 42, lessonRef: '68f0a1b2c3d4e5f6a7b8c9d0' }],
    ])
  })

  it('a video_milestone a mérföldkő SZÁZALÉKÁT is viszi', () => {
    trackVideoMilestone({ courseId: 42, lessonRef: 'lecke-1', percent: 75 })
    expect(hivasok()).toEqual([
      ['video_milestone', { courseId: 42, lessonRef: 'lecke-1', percent: 75 }],
    ])
  })

  it('a sku csak akkor kerül ki, ha van (üresen/nullal ki sem kerül)', () => {
    trackVideoStarted({ courseId: 7, courseSku: 'KEZREHAB-001', lessonRef: 'l1' })
    expect(esemenyek('video_started')[0]).toEqual({
      courseId: 7,
      courseSku: 'KEZREHAB-001',
      lessonRef: 'l1',
    })

    captureAnalyticsEvent.mockReset()
    trackVideoStarted({ courseId: 7, courseSku: null, lessonRef: 'l1' })
    expect(esemenyek('video_started')[0]).toEqual({ courseId: 7, lessonRef: 'l1' })
  })

  it('SZEMÉLYES ADAT nem kerülhet a videó-eseményekbe', () => {
    trackVideoStarted({ courseId: 42, courseSku: 'KEZREHAB-001', lessonRef: 'l1' })
    trackVideoMilestone({ courseId: 42, lessonRef: 'l1', percent: 50 })
    const engedett = new Set(['courseId', 'courseSku', 'lessonRef', 'percent'])
    for (const [, props] of hivasok()) {
      for (const kulcs of Object.keys(props)) {
        expect(engedett.has(kulcs)).toBe(true)
      }
    }
  })
})

// C) PÉNZTÁRI HIBAKÖVETÉS (checkout_failed)

const TERMEK = { id: 12, sku: 'Kézrehabilitáció otthon', priceHuf: 24900, isFree: false }

const TORZS: CheckoutSubmitInput = {
  productId: 12,
  quantity: 1,
  consentWithdrawalWaiver: true,
  consentTerms: true,
  billing: {
    name: 'Példa Kft.',
    zip: '9700',
    city: 'Szombathely',
    street: 'Fő tér 2/A',
  },
}

/** A Barion-oldali függőségek némán, hogy csak a hibakövetés látszódjon. */
function csendesDeps(result: CheckoutSubmitResult | (() => never)): TrackedSubmitDeps {
  return {
    submit: async () => (typeof result === 'function' ? result() : result),
    storage: () => null,
    addPaymentInfo: () => true,
    initiatePurchase: () => true,
    remember: () => true,
  }
}

const TELJES_BILLING = {
  name: 'Példa Kft.',
  zip: '9700',
  city: 'Szombathely',
  street: 'Fő tér 2/A',
  taxNumber: '',
}

function kontextus(override: Partial<CheckoutSubmissionContext> = {}): CheckoutSubmissionContext {
  return {
    productId: 12,
    alreadyPurchased: false,
    waiverRequired: true,
    waiverStartAccepted: true,
    waiverLossAccepted: true,
    termsAccepted: true,
    billing: TELJES_BILLING,
    ...override,
  }
}

describe('pénztári hibakövetés — a szerződés', () => {
  it('az eseménynév rögzített', () => {
    expect(ANALYTICS_EVENTS.checkoutFailed).toBe('checkout_failed')
  })

  it('a hiba-kategóriák ZÁRT készlete', () => {
    expect(CHECKOUT_FAILURE_REASONS).toEqual(['blocked', 'invalid', 'rejected', 'exception'])
  })

  it('a gépi kategória megy ki, a fókuszcél pedig csak ha van', () => {
    reportCheckoutFailure({ productId: 12, reason: 'rejected' })
    expect(hivasok()).toEqual([['checkout_failed', { productId: 12, reason: 'rejected' }]])

    captureAnalyticsEvent.mockReset()
    reportCheckoutFailure({ productId: 12, reason: 'blocked', field: TERMS_INPUT_ID })
    expect(esemenyek('checkout_failed')[0]).toEqual({
      productId: 12,
      reason: 'blocked',
      field: TERMS_INPUT_ID,
    })
  })

  it('valódi JS-kivétel esetén a PostHog $exception is megy, „checkout-submit" címkével', () => {
    const hiba = new Error('váratlan')
    reportCheckoutFailure({ productId: 12, reason: 'exception', error: hiba })
    expect(captureAnalyticsException).toHaveBeenCalledWith(hiba, 'checkout-submit')
  })

  it('kivétel NÉLKÜL nem megy ki $exception (az üzleti hiba nem JS-hiba)', () => {
    reportCheckoutFailure({ productId: 12, reason: 'rejected' })
    expect(captureAnalyticsException).not.toHaveBeenCalled()
  })

  it('a MÉRÉS hibája nem szivárog ki (dobó PostHog-kliens mellett sem)', () => {
    captureAnalyticsEvent.mockImplementation(() => {
      throw new Error('a PostHog elszállt')
    })
    expect(() => reportCheckoutFailure({ productId: 12, reason: 'rejected' })).not.toThrow()
  })
})

describe('pénztári hibakövetés — a KLIENSOLDALI elakadás kategóriája', () => {
  it('hiányzó ÁSZF-pipa → blocked, az ÁSZF-négyzetre mutatva', () => {
    const terv = planCheckoutSubmission(kontextus({ termsAccepted: false }))
    expect(checkoutFailureFromPlan(terv)).toEqual({ reason: 'blocked', field: TERMS_INPUT_ID })
  })

  it('hiányzó elállási nyilatkozat → blocked, a nyilatkozat-négyzetre mutatva', () => {
    const terv = planCheckoutSubmission(kontextus({ waiverStartAccepted: false }))
    expect(checkoutFailureFromPlan(terv)).toEqual({
      reason: 'blocked',
      field: WAIVER_START_INPUT_ID,
    })
  })

  it('már megvett kurzus → blocked, a hibarégióra mutatva', () => {
    const terv = planCheckoutSubmission(kontextus({ alreadyPurchased: true }))
    expect(checkoutFailureFromPlan(terv)).toEqual({
      reason: 'blocked',
      field: CHECKOUT_ERROR_REGION_ID,
    })
  })

  it('hibás számlázási adat → invalid, az első hibás mezőre mutatva', () => {
    const terv = planCheckoutSubmission(
      kontextus({ billing: { ...TELJES_BILLING, zip: '', city: '' } }),
    )
    expect(checkoutFailureFromPlan(terv)).toEqual({
      reason: 'invalid',
      field: billingInputId('zip'),
    })
  })

  it('rendben lévő űrlap → NINCS hiba-esemény', () => {
    expect(checkoutFailureFromPlan(planCheckoutSubmission(kontextus()))).toBeNull()
  })

  it('a magyar hibaüzenet SZÖVEGE nem szivárog a kategóriába', () => {
    const terv = planCheckoutSubmission(kontextus({ termsAccepted: false }))
    const hiba = checkoutFailureFromPlan(terv)
    expect(hiba).not.toBeNull()
    expect(JSON.stringify(hiba)).not.toContain('nyilatkozat')
    // A tervben ott van a magyar üzenet — a mérésbe mégsem kerül bele.
    expect(terv.kind === 'blocked' ? terv.message.length : 0).toBeGreaterThan(0)
  })
})

describe('pénztári hibakövetés — a beküldés huzalozása', () => {
  it('a szerver ELUTASÍTÁSA checkout_failed eseményt küld (reason: rejected)', async () => {
    const submit = trackedSubmitCheckout(
      TERMEK,
      csendesDeps({ ok: false, message: 'A fizetés indítása most nem sikerült.' }),
    )
    const result = await submit(TORZS)

    expect(result.ok).toBe(false)
    expect(esemenyek('checkout_failed')).toEqual([{ productId: 12, reason: 'rejected' }])
  })

  it('a magyar hibaüzenet SZÖVEGE SOHA nem megy ki az eseménnyel', async () => {
    const uzenet =
      'A fizetés indítása most nem sikerült. Próbáld újra néhány perc múlva, vagy írj nekünk.'
    const submit = trackedSubmitCheckout(TERMEK, csendesDeps({ ok: false, message: uzenet }))
    await submit(TORZS)

    const kimenet = JSON.stringify(hivasok())
    expect(kimenet).not.toContain('nem sikerült')
    expect(kimenet).not.toContain(uzenet)
  })

  it('SIKERES indításnál nincs hiba-esemény', async () => {
    const submit = trackedSubmitCheckout(
      TERMEK,
      csendesDeps({
        ok: true,
        orderNumber: 'KIN-2026-0300',
        gatewayUrl: 'https://secure.barion.com/Pay?Id=abc',
      }),
    )
    await submit(TORZS)
    expect(esemenyek('checkout_failed')).toEqual([])
  })

  it('VALÓDI kivételnél: $exception + checkout_failed, és a hiba TOVÁBBMEGY', async () => {
    const hiba = new Error('a hálózat elszállt')
    const submit = trackedSubmitCheckout(
      TERMEK,
      csendesDeps(() => {
        throw hiba
      }),
    )

    // A látható viselkedés nem változik: a kivétel nem nyelődik el.
    await expect(submit(TORZS)).rejects.toThrow('a hálózat elszállt')
    expect(esemenyek('checkout_failed')).toEqual([{ productId: 12, reason: 'exception' }])
    expect(captureAnalyticsException).toHaveBeenCalledWith(hiba, 'checkout-submit')
  })

  it('a MÉRÉS hibája nem viszi magával a beküldést (a vásárlás megy tovább)', async () => {
    captureAnalyticsEvent.mockImplementation(() => {
      throw new Error('a PostHog elszállt')
    })
    const submit = trackedSubmitCheckout(
      TERMEK,
      csendesDeps({ ok: false, message: 'Hiba történt.' }),
    )
    await expect(submit(TORZS)).resolves.toEqual({ ok: false, message: 'Hiba történt.' })
  })

  it('az injektált hiba-küldő KAPJA meg a kategóriát (a huzalozás mérhető)', async () => {
    const kapott: string[] = []
    const submit = trackedSubmitCheckout(TERMEK, {
      ...csendesDeps({ ok: false, message: 'Hiba történt.' }),
      failed: (reason) => kapott.push(reason),
    })
    await submit(TORZS)
    expect(kapott).toEqual(['rejected'])
  })
})

describe('pénztári hibakövetés — a KLIENSOLDALI ág be van kötve', () => {
  /**
   * FORRÁS-SZINTŰ ŐR. A kliensoldali elakadás mérése a `handleSubmit`-ben fut,
   * amit DOM nélkül (jsdom nincs telepítve) nem lehet meghívni. A repóban ez a
   * bevált pótlék erre a résre (lásd `penztar-aszf-elfogadas.test.tsx`): a
   * huzalozás meglétét a komponens forrásán mérjük, a DÖNTÉST pedig a fenti,
   * valódi állítások fedik.
   */
  it('a handleSubmit a tervből számolt kategóriát küldi el', async () => {
    const forras = await readFile('src/components/checkout/CheckoutForm.tsx', 'utf8')
    expect(forras).toContain('checkoutFailureFromPlan(planCheckoutSubmission(readCheckoutContext()))')
    expect(forras).toContain('reportCheckoutFailure({ productId: product.id, ...hiba })')
  })
})
