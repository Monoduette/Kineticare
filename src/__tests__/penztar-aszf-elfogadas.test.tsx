import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Payload } from 'payload'
import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { CheckoutForm } from '../components/checkout/CheckoutForm'
import {
  CHECKOUT_TERMS_ERROR,
  CHECKOUT_TERMS_HEADING,
  CHECKOUT_TERMS_HINT,
  CHECKOUT_TERMS_LABEL,
  CHECKOUT_TERMS_LABEL_TEXT,
  TERMS_ASZF_PATH,
  TERMS_HINT_ID,
  TERMS_INPUT_ID,
  TERMS_NEW_TAB_HINT,
  TERMS_PRIVACY_PATH,
  planCheckoutSubmission,
  type CheckoutSubmissionContext,
} from '../lib/checkout/form-submission'
import { PRIVACY_POLICY_PATH } from '../lib/newsletter/consent-text'
import { startCheckout } from '../lib/checkout/start-checkout'
import type { Order, Product, User } from '../payload-types'

/**
 * ŐR — ÁSZF-ELFOGADÁS A PÉNZTÁRBAN.
 * A saját ÁSZF-ünk 22. bekezdése (élő szöveg, `src/lib/legal-source/aszf.txt`)
 * SZÓ SZERINT ezt állítja a szerződés létrejöttéről: a Vásárló „megadja
 * személyes adatait, bejelöli az Általános Szerződési feltételek elfogadására
 * és az Adatvédelmi Tájékoztató megismerésére vonatkozó jelölőnégyzetet, majd
 */

const REPO = fileURLToPath(new URL('..', import.meta.url))
const GYOKER = join(REPO, '..')

const olvas = (relativUt: string): string => readFileSync(join(GYOKER, relativUt), 'utf8')

/** Kommentek NÉLKÜLI forrás — lásd a fejkomment a) pontját. */
const kommentNelkul = (forras: string): string =>
  forras.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const CSS_UT = 'src/app/(frontend)/checkout.css'
const KOMPONENS_UT = 'src/components/checkout/CheckoutForm.tsx'
const MAG_UT = 'src/lib/checkout/form-submission.ts'
const SZERVER_UT = 'src/lib/checkout/start-checkout.ts'

// ───────────────────────────────────────────────────────────────────────────
// A VÁRT SZÖVEGEK ÉS AZONOSÍTÓK — LITERÁLKÉNT (fejkomment b) pont)
// ───────────────────────────────────────────────────────────────────────────

const VART = {
  negyzetId: 'kc-checkout-terms',
  sugoId: 'kc-checkout-terms-hint',
  mezoNev: 'consentTerms',
  aszfUt: '/aszf',
  adatvedelemUt: '/adatvedelem',
  cimsor: 'Szerződési feltételek',
  feliratElotte: 'Elfogadom az ',
  aszfFelirat: 'Általános szerződési feltételeket',
  feliratKozotte: ', és megismertem az ',
  adatvedelemFelirat: 'Adatkezelési és adatvédelmi szabályzatot',
  feliratUtana: '.',
  ujLap: ' (új lapon nyílik)',
  sugo: 'Az elfogadásodat a rendszer a rendelésen időbélyeggel rögzíti.',
  hibaUzenet:
    'A vásárláshoz fogadd el az Általános szerződési feltételeket, és jelöld, hogy az Adatkezelési és adatvédelmi szabályzatot megismerted.',
} as const

/** A rendelés-pillanatkép mezőnevei — szintén literálként. */
const SNAPSHOT_MEZO = { teny: 'consentTerms', ido: 'consentTermsAt' } as const

// ───────────────────────────────────────────────────────────────────────────
// SEGÉDLETEK
// ───────────────────────────────────────────────────────────────────────────

function render(node: ReactNode): string {
  return renderToStaticMarkup(createElement(Fragment, null, node))
}

/** A pénztári űrlap markupja (fizetős vagy ingyenes termékkel). */
function penztarMarkup({ isFree }: { isFree: boolean }): string {
  return render(
    createElement(CheckoutForm, {
      product: {
        id: 1,
        sku: 'Teszt kurzus',
        priceHuf: isFree ? null : 19990,
        isFree,
      },
      user: null,
      alreadyPurchased: false,
    }),
  )
}

/** A felirat (`<label>`) markup-részlete — a hivatkozások itt ellenőrizhetők. */
function feliratMarkup(html: string): string {
  const kezdet = html.indexOf(`for="${VART.negyzetId}"`)
  expect(kezdet, 'A felirat nem található a markupban.').toBeGreaterThan(-1)
  const veg = html.indexOf('</label>', kezdet)
  expect(veg).toBeGreaterThan(kezdet)
  return html.slice(kezdet, veg)
}

/** A HTML-attribútumok nélküli, felolvasott szöveg. */
const szoveg = (markup: string): string => markup.replace(/<[^>]*>/g, '')

const TELJES_BILLING = {
  name: 'Minta Mari',
  zip: '1011',
  city: 'Budapest',
  street: 'Fő utca 1.',
  taxNumber: '',
}

function kontextus(overrides: Partial<CheckoutSubmissionContext> = {}): CheckoutSubmissionContext {
  return {
    productId: 42,
    alreadyPurchased: false,
    waiverRequired: true,
    waiverStartAccepted: true,
    waiverLossAccepted: true,
    termsAccepted: true,
    billing: TELJES_BILLING,
    ...overrides,
  }
}

// ───────────────────────────────────────────────────────────────────────────
// KONTRASZT-MOTOR — a WCAG 2.2 normatív definíciója
// https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
// https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio
// ───────────────────────────────────────────────────────────────────────────

type RGB = readonly [number, number, number]

const csatorna = (c: number): number => {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

const luminancia = ([r, g, b]: RGB): number =>
  0.2126 * csatorna(r) + 0.7152 * csatorna(g) + 0.0722 * csatorna(b)

const arany = (a: RGB, b: RGB): number => {
  const la = luminancia(a)
  const lb = luminancia(b)
  const [vilagos, sotet] = la >= lb ? [la, lb] : [lb, la]
  return (vilagos + 0.05) / (sotet + 0.05)
}

const hexRgb = (hex: string): RGB => {
  const jel = hex.trim().replace('#', '')
  const teljes =
    jel.length === 3
      ? jel
          .split('')
          .map((c) => c + c)
          .join('')
      : jel
  return [
    Number.parseInt(teljes.slice(0, 2), 16),
    Number.parseInt(teljes.slice(2, 4), 16),
    Number.parseInt(teljes.slice(4, 6), 16),
  ]
}

/** A tokens.css `--kc-*` deklarációi, `var()`-láncokkal együtt feloldva. */
function tokenTerkep(): Map<string, string> {
  const forras = kommentNelkul(olvas('src/app/(frontend)/styles/tokens.css'))
  const nyers = new Map<string, string>()
  for (const talalat of forras.matchAll(/^\s*(--kc-[a-z0-9-]+):\s*([^;]+);/gm)) {
    nyers.set(talalat[1], talalat[2].trim())
  }
  const feloldott = new Map<string, string>()
  const felold = (nev: string, melyseg = 0): string => {
    const ertek = nyers.get(nev)
    if (ertek === undefined || melyseg > 8) {
      return ''
    }
    const hivatkozas = /^var\((--kc-[a-z0-9-]+)\)$/.exec(ertek)
    return hivatkozas === null ? ertek : felold(hivatkozas[1], melyseg + 1)
  }
  for (const nev of nyers.keys()) {
    feloldott.set(nev, felold(nev))
  }
  return feloldott
}

/** Egy CSS-szabály törzse a megadott szelektorra (az első előfordulás). */
function szabalyTorzs(css: string, szelektor: string): string {
  const minta = new RegExp(`${szelektor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm')
  const talalat = minta.exec(kommentNelkul(css))
  return talalat === null ? '' : talalat[1]
}

/** `1.5rem` / `24px` → CSS-pixel (1rem = 16px). */
function pixel(ertek: string): number {
  const rem = /^([\d.]+)rem$/.exec(ertek.trim())
  if (rem !== null) {
    return Number.parseFloat(rem[1]) * 16
  }
  const px = /^([\d.]+)px$/.exec(ertek.trim())
  return px === null ? Number.NaN : Number.parseFloat(px[1])
}

// 1. A JELÖLŐNÉGYZET LÉTEZÉSE ÉS ALAPÁLLAPOTA

describe('A pénztár ÁSZF-jelölőnégyzete létezik és üresen indul', () => {
  for (const isFree of [false, true]) {
    const ag = isFree ? 'INGYENES' : 'fizetős'

    it(`${ag} terméken a jelölőnégyzet ott van a kirenderelt markupban`, () => {
      const html = penztarMarkup({ isFree })
      expect(
        html,
        'Az ÁSZF 22. bekezdése szerint a szerződés a jelölőnégyzet bejelölésével jön létre. Négyzet nélkül a saját ÁSZF-ünk szövege hamis.',
      ).toContain(`id="${VART.negyzetId}"`)
      expect(html).toContain(`name="${VART.mezoNev}"`)
      expect(html).toContain(`for="${VART.negyzetId}"`)
      // A négyzet valóban jelölőnégyzet (nem rejtett mező vagy díszlet).
      const negyzet = /<input[^>]*id="kc-checkout-terms"[^>]*>/.exec(html)?.[0] ?? ''
      expect(negyzet).toContain('type="checkbox"')
      expect(negyzet).toContain('required')
    })

    it(`${ag} terméken a négyzet ALAPBÓL ÜRES (nincs \`checked\` a markupon)`, () => {
      const html = penztarMarkup({ isFree })
      const negyzet = /<input[^>]*id="kc-checkout-terms"[^>]*>/.exec(html)?.[0] ?? ''
      expect(negyzet).not.toBe('')
      expect(
        negyzet,
        'Előre bepipált elfogadás jogilag érvénytelen és sötét minta. GOV.UK Design System: „Do not pre-select checkbox options…"; NN/g: a jogi jelölőnégyzet alapból üres.',
      ).not.toContain('checked')
    })
  }

  it('a blokk a beküldőgomb ELŐTT áll (az ÁSZF 22. bekezdésének sorrendje)', () => {
    const html = penztarMarkup({ isFree: false })
    const negyzetIndex = html.indexOf(`id="${VART.negyzetId}"`)
    const gombIndex = html.indexOf('type="submit"')
    expect(negyzetIndex).toBeGreaterThan(-1)
    expect(gombIndex).toBeGreaterThan(-1)
    expect(
      negyzetIndex,
      'Az ÁSZF sorrendje: a Vásárló „bejelöli a jelölőnégyzetet, MAJD megnyomja a VÁSÁRLÁS gombot".',
    ).toBeLessThan(gombIndex)
  })

  it('a számlázási mezők UTÁN áll (az ÁSZF: „megadja személyes adatait, bejelöli…")', () => {
    const html = penztarMarkup({ isFree: false })
    expect(html.indexOf('kc-field-billingStreet')).toBeLessThan(
      html.indexOf(`id="${VART.negyzetId}"`),
    )
  })

  it('EGYETLEN ilyen jelölőnégyzet van (egy négyzet, két hivatkozás — nem kettő)', () => {
    const html = penztarMarkup({ isFree: false })
    expect([...html.matchAll(/name="consentTerms"/g)]).toHaveLength(1)
  })
})

// 2. A FELIRAT: KÉT HIVATKOZÁS, ÚJ LAPON, KIMONDVA

describe('A felirat két jogi hivatkozást hordoz, új lapra, kimondottan', () => {
  const felirat = feliratMarkup(penztarMarkup({ isFree: false }))

  it('mindkét jogi hivatkozás benne van a FELIRATBAN (nem másutt a lapon)', () => {
    expect(felirat, 'Az ÁSZF-hivatkozás nélkül a vevő nem tudja, mit fogad el.').toContain(
      `href="${VART.aszfUt}"`,
    )
    expect(
      felirat,
      'Az adatkezelési tájékoztató hivatkozása nélkül a „megismertem" nem teljesíthető.',
    ).toContain(`href="${VART.adatvedelemUt}"`)
    expect([...felirat.matchAll(/<a\s/g)]).toHaveLength(2)
  })

  it('mindkét hivatkozás ÚJ LAPON nyílik, biztonságos rel-lel', () => {
    // A pénztár űrlapállapota kliens-oldali React-state: saját lapon
    // elnavigálva a vevő elvesztené a beírt számlázási adatokat.
    for (const link of felirat.matchAll(/<a\s[^>]*>/g)) {
      expect(link[0]).toContain('target="_blank"')
      expect(link[0]).toContain('rel="noopener noreferrer"')
    }
  })

  it('a képernyőolvasó ELŐRE megtudja, hogy új lapon nyílik (SC 3.2.5, G201)', () => {
    const linkek = [...felirat.matchAll(/<a\s[^>]*>([\s\S]*?)<\/a>/g)].map((t) => t[1])
    expect(linkek).toHaveLength(2)
    for (const tartalom of linkek) {
      expect(
        tartalom,
        'A figyelmeztetés a LINK SZÖVEGÉNEK része kell legyen, különben a képernyőolvasó a link kiolvasásakor nem mondja ki.',
      ).toContain(`<span class="kc-visually-hidden">${VART.ujLap}</span>`)
    }
  })

  it('a felolvasott szöveg az ÁSZF 22. bekezdésének szóhasználatát követi', () => {
    const olvasott = szoveg(felirat)
    // ELFOGADÁS az ÁSZF-re…
    expect(olvasott).toContain(`${VART.feliratElotte}${VART.aszfFelirat}`)
    // …MEGISMERÉS az adatvédelemre (az adatkezelés nem szerződés).
    expect(olvasott).toContain(`${VART.feliratKozotte}${VART.adatvedelemFelirat}`)
    expect(
      olvasott.toLowerCase(),
      'Az adatkezelést MEGISMERNI kell, nem elfogadni — az ÁSZF 22. bekezdése is így fogalmaz.',
    ).not.toContain('elfogadom az adatkezelési')
  })

  it('a felirat NEM tartalmaz gondolatjelet és kvirtmínuszt (magyar mikroszöveg)', () => {
    // A karaktereket kódpontból építjük, hogy maga az őrfájl se hordozza őket.
    const kvirt = String.fromCharCode(0x2014)
    const gondolatjel = String.fromCharCode(0x2013)
    for (const s of [CHECKOUT_TERMS_LABEL_TEXT, VART.sugo, VART.hibaUzenet, VART.cimsor]) {
      expect(s).not.toContain(kvirt)
      expect(s).not.toContain(gondolatjel)
    }
  })

  it('a súgó megígéri az időbélyeges rögzítést, és a négyzethez van kötve', () => {
    const html = penztarMarkup({ isFree: false })
    const negyzet = /<input[^>]*id="kc-checkout-terms"[^>]*>/.exec(html)?.[0] ?? ''
    expect(negyzet).toContain(`aria-describedby="${VART.sugoId}"`)
    expect(html).toContain(`id="${VART.sugoId}"`)
    expect(html).toContain(VART.sugo)
  })

  it('a blokknak van címsora, és a gomb-magyarázat UGYANARRA a névre hivatkozik', () => {
    expect(penztarMarkup({ isFree: false })).toContain(`<h2>${VART.cimsor}</h2>`)
    /**
     * A gomb melletti magyarázat a szekció NEVÉT mondja, hogy a látogató
     * megtalálja (WCAG 2.2 SC 3.3.2, Labels or Instructions). Az INGYENES ágon
     * mérjük, mert ott nincs elállási nyilatkozat: az egyetlen akadály maga az
     * ÁSZF-elfogadás, tehát a magyarázatnak erre kell mutatnia.
     */
    const ingyenes = penztarMarkup({ isFree: true })
    expect(ingyenes).toContain(`a „${VART.cimsor}” résznél`)
    expect(ingyenes).toContain('id="kc-checkout-block-hint"')
  })

  it('fizetős ágon a magyarázat az ELSŐ akadályt mondja (előbb az elállási nyilatkozatot)', () => {
    const fizetos = penztarMarkup({ isFree: false })
    expect(fizetos).toContain('A fizetéshez pipáld ki mindkét nyilatkozatot az „Elállási jog” résznél.')
    expect(fizetos).not.toContain(`a „${VART.cimsor}” résznél`)
  })
})

// 3. A LITERÁLOK ÉS A KÓD KONSTANSAI EGYEZNEK (fejkomment b) pont)

describe('A fixtúra-literálok és a kód konstansai bitre egyeznek', () => {
  it('a felirat darabjai', () => {
    expect(CHECKOUT_TERMS_LABEL.before).toBe(VART.feliratElotte)
    expect(CHECKOUT_TERMS_LABEL.aszfLabel).toBe(VART.aszfFelirat)
    expect(CHECKOUT_TERMS_LABEL.between).toBe(VART.feliratKozotte)
    expect(CHECKOUT_TERMS_LABEL.privacyLabel).toBe(VART.adatvedelemFelirat)
    expect(CHECKOUT_TERMS_LABEL.after).toBe(VART.feliratUtana)
    expect(CHECKOUT_TERMS_LABEL_TEXT).toBe(
      'Elfogadom az Általános szerződési feltételeket, és megismertem az Adatkezelési és adatvédelmi szabályzatot.',
    )
  })

  it('az azonosítók, útvonalak és a többi szöveg', () => {
    expect(TERMS_INPUT_ID).toBe(VART.negyzetId)
    expect(TERMS_HINT_ID).toBe(VART.sugoId)
    expect(TERMS_ASZF_PATH).toBe(VART.aszfUt)
    expect(TERMS_PRIVACY_PATH).toBe(VART.adatvedelemUt)
    expect(TERMS_NEW_TAB_HINT).toBe(VART.ujLap)
    expect(CHECKOUT_TERMS_HINT).toBe(VART.sugo)
    expect(CHECKOUT_TERMS_HEADING).toBe(VART.cimsor)
    expect(CHECKOUT_TERMS_ERROR).toBe(VART.hibaUzenet)
  })

  it('az adatvédelmi útvonal AZONOS a többi űrlapéval (WCAG 2.2 SC 3.2.4)', () => {
    // A hírlevél-, az időpontkérő- és az ingyenes kurzus űrlapja is ezt
    // használja; ha a pénztár elcsúszna, ugyanaz a hivatkozás két helyre vinne.
    expect(TERMS_PRIVACY_PATH).toBe(PRIVACY_POLICY_PATH)
  })

  it('a dokumentum NEVE a felület máshol használt nevével egyezik (SC 3.2.4)', () => {
    // A lábléc, a hírlevél és az időpontkérő is „Adatkezelési és adatvédelmi
    // szabályzat" néven hivatkozik ugyanerre az oldalra; a pénztár felirata
    // ennek TÁRGYESETŰ alakja (magyarul a mondat csak így nyelvhelyes).
    const kozosNev = 'Adatkezelési és adatvédelmi szabályzat'
    expect(CHECKOUT_TERMS_LABEL.privacyLabel.startsWith(kozosNev)).toBe(true)
  })
})

// 4. A BEKÜLDÉSI TERV — kipipálatlanul BLOKKOL, kipipálva továbbenged

describe('planCheckoutSubmission — az elfogadás a beküldés feltétele', () => {
  it('kipipálatlan négyzettel a beküldés meg sem indul, és a fókusz a négyzetre megy', () => {
    const terv = planCheckoutSubmission(kontextus({ termsAccepted: false }))
    expect(terv).toEqual({
      kind: 'blocked',
      message: VART.hibaUzenet,
      focusElementId: VART.negyzetId,
    })
  })

  it('INGYENES terméken is blokkol (a szerződés ott is létrejön)', () => {
    const terv = planCheckoutSubmission(
      kontextus({
        termsAccepted: false,
        waiverRequired: false,
        waiverStartAccepted: false,
        waiverLossAccepted: false,
      }),
    )
    expect(
      terv.kind,
      'Az ingyenes ág kihagyása két, egymástól eltérő viselkedést adna ugyanarra a cselekvésre (WCAG 2.2 SC 3.2.4), és az ÁSZF felhasználási korlátja az ingyenes videóra is vonatkozik.',
    ).toBe('blocked')
  })

  it('a waiver ELŐBB blokkol: a fókusz mindig az ELSŐ hiányzó négyzetre kerül', () => {
    const terv = planCheckoutSubmission(
      kontextus({ termsAccepted: false, waiverStartAccepted: false, waiverLossAccepted: false }),
    )
    expect(terv.kind === 'blocked' && terv.focusElementId).toBe('waiver-start')
  })

  it('kipipálva a törzsbe RÁKERÜL a `consentTerms: true`', () => {
    const terv = planCheckoutSubmission(kontextus())
    expect(terv.kind).toBe('send')
    if (terv.kind !== 'send') {
      return
    }
    expect(
      terv.body.consentTerms,
      'A szerver a törzsből olvassa az elfogadást; enélkül minden beküldés 400-zal bukna.',
    ).toBe(true)
  })

  it('a hibaüzenet MEGMONDJA A TEENDŐT (GOV.UK hibaszöveg-minta)', () => {
    expect(VART.hibaUzenet).toContain('fogadd el')
    expect(VART.hibaUzenet).toContain('jelöld')
  })
})

// 5. A SZERVEROLDALI ŐR — a kliens megkerülhető

// DUMMY érték, egyértelműen jelölve — NEM valódi Barion POSKey.
const DUMMY_POS_KEY = 'DUMMY-POSKEY-NEM-VALODI-TITOK'
const DUMMY_PAYMENT_ID = '11111111-2222-3333-4444-555555555555'
const ORDER_NUMBER = 'KH-2026-000999'

const mockUser = {
  id: 7,
  email: 'vevo@example.test',
  name: 'Minta Mari',
  role: 'customer',
} as unknown as User

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

function createMockPayload() {
  const calls = { create: [] as Array<Record<string, unknown>> }
  const payload = {
    findByID: vi.fn(async () => publishedProduct),
    find: vi.fn(async () => ({ docs: [], totalDocs: 0 })),
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

/**
 * A HÁLÓZAT LEZÁRVA. A `startPayment` a globális `fetch`-et használja; ez a
 * stub adja a Barion sikeres Start-válaszát, valódi hívás nélkül (CLAUDE.md
 * 15. üzemeltetési tanulság). Az `afterEach` visszaállítja.
 */
const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        PaymentId: DUMMY_PAYMENT_ID,
        PaymentRequestId: ORDER_NUMBER,
        Status: 'Prepared',
        GatewayUrl: `https://secure.test.barion.com/Pay?id=${DUMMY_PAYMENT_ID}`,
        Transactions: [{ TransactionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }],
        Errors: [],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  )
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const mentettEnv: Record<string, string | undefined> = {}
beforeAll(() => {
  for (const kulcs of [
    'BARION_API_URL',
    'BARION_PAYEE_EMAIL',
    'BARION_POSKEY_TEST',
    'NEXT_PUBLIC_SERVER_URL',
  ]) {
    mentettEnv[kulcs] = process.env[kulcs]
  }
  process.env.BARION_API_URL = 'https://api.test.barion.com'
  process.env.BARION_PAYEE_EMAIL = 'payee@example.test'
  process.env.BARION_POSKEY_TEST = DUMMY_POS_KEY
  process.env.NEXT_PUBLIC_SERVER_URL = 'https://shop.example.test'
})
afterAll(() => {
  for (const [kulcs, ertek] of Object.entries(mentettEnv)) {
    if (ertek === undefined) {
      delete process.env[kulcs]
    } else {
      process.env[kulcs] = ertek
    }
  }
})

const SZERVER_BILLING = {
  name: 'Minta Mari',
  zip: '1011',
  city: 'Budapest',
  street: 'Fő utca 1.',
}

describe('startCheckout — az ÁSZF-elfogadás a SZERVEREN is kötelező', () => {
  for (const [nev, ertek] of [
    ['hiányzó mező', undefined],
    ['hamis érték', false],
    ['igaznak látszó szöveg', 'true'],
    ['igaznak látszó szám', 1],
  ] as const) {
    it(`${nev} → 400, magyar üzenettel, rendelés NÉLKÜL`, async () => {
      const { payload, calls } = createMockPayload()
      const promise = startCheckout({
        payload,
        user: mockUser,
        input: {
          productId: 42,
          consentWithdrawalWaiver: true,
          ...(ertek === undefined ? {} : { consentTerms: ertek }),
          billing: SZERVER_BILLING,
        },
      })
      await expect(promise).rejects.toMatchObject({ status: 400 })
      await expect(promise).rejects.toThrowError(/Általános szerződési feltételeket/)
      expect(
        calls.create,
        'Elfogadás nélkül rendelés SEM jöhet létre: a szerződés alapja hiányzik.',
      ).toHaveLength(0)
      // Barion felé sem indulhatott semmi.
      expect(fetchMock).not.toHaveBeenCalled()
    })
  }

  it('elfogadással a rendelés létrejön, és a PILLANATKÉPRE rákerül a tény + az időbélyeg', async () => {
    const { payload, calls } = createMockPayload()
    const eredmeny = await startCheckout({
      payload,
      user: mockUser,
      input: {
        productId: 42,
        consentWithdrawalWaiver: true,
        consentTerms: true,
        billing: SZERVER_BILLING,
      },
    })
    expect(eredmeny.orderNumber).toBe(ORDER_NUMBER)
    expect(calls.create).toHaveLength(1)

    const pillanatkep = calls.create[0].customerSnapshot as Record<string, unknown>
    expect(
      pillanatkep[SNAPSHOT_MEZO.teny],
      'A pénztár azt ígéri a vevőnek, hogy az elfogadását a rendszer a rendelésen rögzíti.',
    ).toBe(true)
    const idobelyeg = pillanatkep[SNAPSHOT_MEZO.ido]
    expect(
      typeof idobelyeg,
      'Az ígéret IDŐBÉLYEGRŐL szól — tény önmagában, időpont nélkül, nem bizonyít semmit.',
    ).toBe('string')
    expect(String(idobelyeg)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(Number.isNaN(Date.parse(String(idobelyeg)))).toBe(false)
    // A két nyilatkozat egyetlen beküldéssel születik: ugyanaz a pillanat.
    expect(idobelyeg).toBe(calls.create[0].consentWithdrawalWaiverAt)
  })

  it('a szerveroldali őr a validációs szakaszban áll (a hiba a rendelés ELŐTT dől el)', () => {
    const forras = kommentNelkul(olvas(SZERVER_UT))
    expect(
      forras,
      'A `consentTerms !== true` őr eltűnt a start-checkout parseInput-jából: a végpont közvetlenül POST-olható, tehát a kliens-oldali négyzet önmagában semmit nem véd.',
    ).toMatch(/input\.consentTerms\s*!==\s*true/)
    expect(forras).toMatch(/consentTerms:\s*true/)
    expect(forras).toMatch(/consentTermsAt:/)
  })
})

// 6. A GOMB NEM TILTÓDIK LE (validáció, nem tiltás)

describe('A beküldőgomb a kipipálatlan négyzettől NEM tiltódik le', () => {
  it('a gomb tabbal elérhető marad, és a magyarázat aria-describedby-jal kötődik hozzá', () => {
    const html = penztarMarkup({ isFree: false })
    const gomb = /<button[^>]*type="submit"[^>]*>/.exec(html)?.[0] ?? ''
    expect(gomb).not.toBe('')
    expect(
      gomb,
      'A natív `disabled` kiesik a Tab-sorrendből: a billentyűzetes vevő a gombig el sem jutna, és semmi nem mondaná meg, miért. GOV.UK gomb-útmutató: a letiltott gomb nem közli, mi a teendő.',
    ).not.toContain('disabled')
    expect(gomb).toContain('aria-describedby="kc-checkout-block-hint"')
    expect(html).toContain('id="kc-checkout-block-hint"')
  })

  it('a komponens a gombot KIZÁRÓLAG a beküldés idejére tiltja', () => {
    const forras = kommentNelkul(olvas(KOMPONENS_UT))
    expect(forras).toContain('disabled={submitting}')
    expect(forras).not.toMatch(/disabled=\{[^}]*termsAccepted/)
  })

  it('a jelölőnégyzet állapota `false` kezdőértékű state (nem előre bepipált)', () => {
    const forras = kommentNelkul(olvas(KOMPONENS_UT))
    expect(forras).toContain('useState(false)')
    expect(
      forras,
      'A `useState(true)` előre bepipálná az elfogadást — jogilag érvénytelen és sötét minta.',
    ).not.toMatch(/setTermsAccepted\]\s*=\s*useState\(true\)/)
  })
})

// 7. MÉRT ELRENDEZÉS — a hasáb-hiba nem térhet vissza

describe('Mért elrendezés: a felirat FOLYÓSZÖVEG, nem elrendezés', () => {
  const css = olvas(CSS_UT)
  const felirat = szabalyTorzs(css, '.kc-checkout-terms__label')
  const sor = szabalyTorzs(css, '.kc-checkout-terms__row')

  it('a felirat szabálya NEM flex-konténer (a hasáb-hiba tiltása)', () => {
    expect(felirat).not.toBe('')
    expect(
      felirat,
      'A `.kc-appointment__consent-label` pontosan ettől esett szét ÖT HASÁBRA: flexként a mondat darabjai és a beágyazott linkek külön flex-elemmé válnak, a `flex-wrap` alapértéke pedig `nowrap`. Mérve akkor: 320 px-en 107 px vízszintes túlcsordulás (WCAG 2.2 SC 1.4.10 bukás). Itt KÉT beágyazott link van, tehát a hiba még durvább lenne.',
    ).not.toMatch(/display:\s*(inline-)?flex/)
    expect(felirat).not.toMatch(/display:\s*(inline-)?grid/)
    expect(felirat).toMatch(/display:\s*block/)
  })

  it('a felirat hosszú szót is tör, tehát szűk konténerben sem lóg ki', () => {
    expect(felirat).toMatch(/overflow-wrap:\s*(break-word|anywhere)/)
  })

  it('a sor flex, felső igazítással (a négyzet a felirat ELSŐ sorához illeszkedik)', () => {
    expect(sor).toMatch(/display:\s*flex/)
    expect(sor).toMatch(/align-items:\s*flex-start/)
  })
})

describe('Mért érintőcél (WCAG 2.2 SC 2.5.8)', () => {
  const css = olvas(CSS_UT)
  const negyzet = szabalyTorzs(css, '.kc-checkout-terms__checkbox')
  const felirat = szabalyTorzs(css, '.kc-checkout-terms__label')

  it('a jelölőnégyzet MAGA legalább 24×24 CSS px', () => {
    const szelesseg = pixel(/width:\s*([^;]+);/.exec(negyzet)?.[1] ?? '')
    const magassag = pixel(/height:\s*([^;]+);/.exec(negyzet)?.[1] ?? '')
    expect(szelesseg, `mért szélesség: ${szelesseg} px`).toBeGreaterThanOrEqual(24)
    expect(magassag, `mért magasság: ${magassag} px`).toBeGreaterThanOrEqual(24)
  })

  it('a kattintható sáv (négyzet + felirat) legalább 44 px magas (SC 2.5.5, AAA)', () => {
    const minMagassag = pixel(/min-height:\s*([^;]+);/.exec(felirat)?.[1] ?? '')
    expect(minMagassag, `mért min-height: ${minMagassag} px`).toBeGreaterThanOrEqual(44)
  })

  it('a négyzetnek van látható fókuszjelölése', () => {
    const fokusz = szabalyTorzs(css, '.kc-checkout-terms__checkbox:focus-visible')
    expect(fokusz).toMatch(/outline:\s*2px solid var\(--kc-color-focus\)/)
  })
})

describe('Mért kontraszt (WCAG 2.2 SC 1.4.3) — a tokens.css valódi hexeiből', () => {
  const tokenek = tokenTerkep()
  const szin = (nev: string): RGB => {
    const ertek = tokenek.get(nev)
    expect(ertek, `Hiányzó vagy feloldhatatlan token: ${nev}`).toMatch(/^#[0-9a-fA-F]{3,8}$/)
    return hexRgb(ertek as string)
  }

  const parok = [
    // A felirat és a beágyazott linkek a KÁRTYÁN (fehér) állnak.
    ['a felirat szövege', '--kc-color-text', '--kc-color-surface-raised'],
    ['a beágyazott jogi link', '--kc-color-text', '--kc-color-surface-raised'],
    ['a súgó szövege', '--kc-color-text-muted', '--kc-color-surface-raised'],
    // A gomb melletti akadály-magyarázat a lap-háttéren.
    ['a hiányzó elfogadás magyarázata', '--kc-color-text-muted', '--kc-color-bg'],
    // Az élő hibarégió (ide megy a CHECKOUT_TERMS_ERROR).
    ['a hibaüzenet', '--kc-color-danger', '--kc-color-danger-surface'],
  ] as const

  for (const [nev, elo, hatter] of parok) {
    it(`${nev} ≥ 4,5:1`, () => {
      const mert = arany(szin(elo), szin(hatter))
      expect(mert, `${nev}: mért ${mert.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
    })
  }

  it('a link a mondaton belül nem CSAK színnel különbözik (SC 1.4.1)', () => {
    const linkSzabaly = szabalyTorzs(olvas(CSS_UT), '.kc-checkout-terms__label a')
    expect(
      linkSzabaly,
      'A link színe azonos a szövegével (ink), tehát az aláhúzás az EGYETLEN megkülönböztető jel. Nélküle a kontraszt a mondathoz képest 1,00:1.',
    ).toMatch(/text-decoration:\s*underline/)
  })

  it('a blokk CSS-e KIZÁRÓLAG szerep-tokent használ (nyers hex nincs)', () => {
    const blokk = kommentNelkul(olvas(CSS_UT))
      .split('.kc-checkout-terms__row')[1]
      ?.split('/* ---- Köszönő')[0]
    expect(blokk).toBeDefined()
    expect(blokk).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})

describe('Mért sorhossz és 320 px-es reflow (SC 1.4.10)', () => {
  const tokenek = tokenTerkep()
  const css = olvas(CSS_UT)
  const felirat = szabalyTorzs(css, '.kc-checkout-terms__label')

  it('a felirat sorhossza a 45–85 karakteres sávban marad', () => {
    // A repó MÉRT állandója (tokens.css „Mérték" szakasza, fontTools/hmtx a
    // Nunito Sans wght 400 példányán, n = 5981 karakter): az átlagos karakter
    // 0,4542em. A karakterszám ebből és a mértékből SZÁMOLHATÓ, nem becslés.
    const ATLAG_KARAKTER_EM = 0.4542
    const mertekToken = /max-width:\s*var\((--kc-measure[a-z-]*)\)/.exec(felirat)?.[1] ?? ''
    expect(mertekToken, 'A feliratnak MÉRTÉK-token szabja a sorhosszát.').not.toBe('')
    const mertekPx = pixel(tokenek.get(mertekToken) ?? '')
    // A felirat a törzsméreten (M lépcső) áll, aminek a felső vége 1,125rem.
    expect(felirat).toMatch(/font-size:\s*var\(--kc-font-m\)/)
    const karakter = mertekPx / (ATLAG_KARAKTER_EM * 18)
    expect(karakter, `mért sorhossz: ${karakter.toFixed(1)} karakter`).toBeGreaterThanOrEqual(45)
    expect(
      karakter,
      `mért sorhossz: ${karakter.toFixed(1)} karakter — a 85-ös sávhatár és a WCAG 2.2 SC 1.4.8 80-as plafonja alatt kell maradnia.`,
    ).toBeLessThanOrEqual(80)
  })

  it('320 px-es nézetablakon a felirat elfér, vízszintes görgetés nélkül', () => {
    const oldalMargo = pixel(tokenek.get('--kc-container-gutter') ?? '')
    const kartyaBelso = pixel(
      /padding:\s*([^;]+);/
        .exec(szabalyTorzs(olvas('src/app/(frontend)/styles/ui.css'), '.kc-card--padded'))?.[1]
        ?.trim()
        .replace(/^var\((--kc-[a-z0-9-]+)\)$/, (_, nev: string) => tokenek.get(nev) ?? '') ?? '',
    )
    const res = pixel(
      tokenek.get(/gap:\s*var\((--kc-space-\d)\)/.exec(szabalyTorzs(css, '.kc-checkout-terms__row'))?.[1] ?? '') ?? '',
    )
    const negyzetSzelesseg = pixel(
      /width:\s*([^;]+);/.exec(szabalyTorzs(css, '.kc-checkout-terms__checkbox'))?.[1] ?? '',
    )
    for (const ertek of [oldalMargo, kartyaBelso, res, negyzetSzelesseg]) {
      expect(ertek).toBeGreaterThan(0)
    }

    const nezetablak = 320
    // Konténer-margó két oldalon, kártya belső margó két oldalon, 1px keret.
    const kartyaBelvilag = nezetablak - 2 * oldalMargo - 2 * kartyaBelso - 2
    const feliratSav = kartyaBelvilag - negyzetSzelesseg - res

    expect(kartyaBelvilag).toBe(222)
    expect(feliratSav).toBe(186)
    expect(feliratSav).toBeGreaterThan(0)

    /**
     * A felirat blokk-elem, tehát a rendelkezésre álló sávra tördel. Az
     * EGYETLEN túlcsordulási út egy TÖRHETETLEN, a sávnál szélesebb szó lenne.
     * A leghosszabb szó a legpesszimistább karakterszélességgel is befér, és a
     * felirat emellett `overflow-wrap`-et is visz (fenti állítás).
     */
    const LEGSZELESEBB_KARAKTER_EM = 0.6
    const leghosszabbSzo = CHECKOUT_TERMS_LABEL_TEXT.split(/[\s,.]+/).reduce(
      (leghosszabb, szo) => (szo.length > leghosszabb.length ? szo : leghosszabb),
      '',
    )
    const szoSzelesseg = leghosszabbSzo.length * LEGSZELESEBB_KARAKTER_EM * 18
    expect(
      szoSzelesseg,
      `a leghosszabb szó („${leghosszabbSzo}") felső becsléssel ${szoSzelesseg.toFixed(0)} px, a rendelkezésre álló sáv ${feliratSav} px`,
    ).toBeLessThan(feliratSav)

    // A felirat max-width-je FÉK, nem minimum: 320 px-en a sáv a kisebb.
    const mertekPx = pixel(
      tokenek.get(/max-width:\s*var\((--kc-measure[a-z-]*)\)/.exec(felirat)?.[1] ?? '') ?? '',
    )
    expect(mertekPx).toBeGreaterThan(feliratSav)
  })

  it('a négyzet nem zsugorodik össze szűk sávon (a 24 px-es cél megmarad)', () => {
    expect(szabalyTorzs(css, '.kc-checkout-terms__checkbox')).toMatch(/flex-shrink:\s*0/)
  })
})

// 8. A LÁNC ÉPSÉGE — a mag és a szerződés nem csúszhat szét

describe('A beküldési lánc épsége', () => {
  it('a döntési mag a `termsAccepted` állapotra ÁGAZIK (nem hagyja átfolyni)', () => {
    const forras = kommentNelkul(olvas(MAG_UT))
    expect(
      forras,
      'A `planCheckoutSubmission` `blocked` ága eltűnt: a kipipálatlan négyzet átengedésével a felület hazudna, és a szerver 400-a lenne az egyetlen fék.',
    ).toMatch(/!context\.termsAccepted/)
    expect(forras).toMatch(/consentTerms:\s*true/)
  })

  it('a komponens a SAJÁT állapotát adja a magnak (nem konstans `true`-t)', () => {
    const forras = kommentNelkul(olvas(KOMPONENS_UT))
    expect(forras).toMatch(/termsAccepted,/)
    expect(
      forras,
      'A `termsAccepted: true` bedrótozása a readContext-be némán megkerülné a jelölőnégyzetet.',
    ).not.toMatch(/termsAccepted:\s*true/)
  })

  it('a kérés-szerződés kimondja a mezőt (checkout-submit)', () => {
    const forras = kommentNelkul(olvas('src/lib/checkout-submit.ts'))
    expect(forras).toMatch(/consentTerms:\s*boolean/)
  })
})
