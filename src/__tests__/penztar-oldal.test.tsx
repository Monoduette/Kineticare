import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement, Fragment, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getPayload } from 'payload'

import { CheckoutErrorRegion, CheckoutForm } from '../components/checkout/CheckoutForm'
import type { Product, User } from '../payload-types'

/**
 * M8 REGRESSZIÓ-ŐR: a /penztar szerver-oldala NEM olvassa a kosarat.
 * A pénztár szerver-komponense a 'use client'-es `readCart()`-ot hívta
 * kosár-fallbackként: a localStorage-os kosárhoz a szerver sosem fér hozzá,
 * a hívás pedig garantált render-hiba volt. A fallback most letisztult: a
 * termék KIZÁRÓLAG a ?termek={id} query-ből jön (a /kosar oldal CartView-je
 */

vi.mock('payload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('payload')>()
  return { ...actual, getPayload: vi.fn() }
})

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

const getPayloadMock = vi.mocked(getPayload)

const mockUser = {
  id: 7,
  email: 'vevo@example.test',
  name: 'Minta Mari',
  purchases: [],
} as unknown as User

const publishedProduct = {
  id: 42,
  sku: 'KURZUS-ALAP',
  status: 'published',
  priceInHUF: 5000,
  priceInHUFEnabled: true,
} as unknown as Product

/** Bejelentkezett (vagy vendég) látogató + a termék-lekérdezés kimenetele. */
function mockPayloadBehavior(product: Product | null, user: User | null = mockUser) {
  getPayloadMock.mockResolvedValue({
    auth: vi.fn(async () => ({ user })),
    findByID: vi.fn(async () => {
      if (product === null) {
        throw new Error('Not Found')
      }
      return product
    }),
  } as never)
}

beforeEach(() => {
  getPayloadMock.mockReset()
})

async function renderPenztar(searchParams: Record<string, string | string[] | undefined>) {
  // A vi.mock-hoistelés miatt az oldalt dinamikusan importáljuk.
  const { default: PenztarPage } = await import('../app/(frontend)/penztar/page')
  return PenztarPage({ searchParams: Promise.resolve(searchParams) })
}

function renderMarkup(node: ReactNode): string {
  return renderToStaticMarkup(createElement(Fragment, null, node))
}

/** Az elemfában megkeresi az adott komponens-típus első elemét (koszonom-oldal minta). */
function findElement(node: unknown, type: unknown): ReactElement | null {
  if (!isValidElement(node)) {
    return null
  }
  if (node.type === type) {
    return node
  }
  const children = (node.props as { children?: unknown } | undefined)?.children
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findElement(child, type)
      if (found) {
        return found
      }
    }
    return null
  }
  return findElement(children, type)
}

describe('/penztar — a kosár-fallback kivétele (M8)', () => {
  it('nem numerikus termek-paraméternél (pl. rendelésszám) a „nincs kiválasztott termék" nézet renderelődik — readCart-hívás nélkül', async () => {
    // Ez az ág hívta korábban a szerver-oldali readCart()-ot (garantált hiba).
    mockPayloadBehavior(publishedProduct)
    const tree = await renderPenztar({ termek: 'KH-2026-000123' })

    const html = renderMarkup(tree)
    expect(html).toContain('Nincs kiválasztott termék a fizetéshez.')
    expect(html).toContain('href="/kurzusok"')
    // A pénztár-űrlap NEM renderelődik termék nélkül.
    expect(findElement(tree, CheckoutForm)).toBeNull()
  })

  it('ismeretlen termék-id-nél ugyanaz a fallback (a termék-lekérdezés null-t ad)', async () => {
    mockPayloadBehavior(null)
    const tree = await renderPenztar({ termek: '999' })

    const html = renderMarkup(tree)
    expect(html).toContain('Nincs kiválasztott termék a fizetéshez.')
    expect(findElement(tree, CheckoutForm)).toBeNull()
  })

  it('POZITÍV KONTROLL: érvényes termek-paraméternél a CheckoutForm a termékkel renderelődik', async () => {
    mockPayloadBehavior(publishedProduct)
    const tree = await renderPenztar({ termek: '42' })

    const form = findElement(tree, CheckoutForm)
    expect(form).not.toBeNull()
    const props = form!.props as { product: { id: number; priceHuf: number | null }; alreadyPurchased: boolean }
    expect(props.product.id).toBe(42)
    expect(props.product.priceHuf).toBe(5000)
    expect(props.alreadyPurchased).toBe(false)
  })
})

describe('/penztar — archivált termék', () => {
  it('archived terméknél a tájékoztató állapot renderelődik, a beküldhető űrlap NEM', async () => {
    // A beküldés a checkout API-n 400-zal („archivált") hasalna el — az űrlap
    // megjelenítése díszlet volt (a 2.4-es minta szerinti viselkedésváltozás).
    mockPayloadBehavior({ ...publishedProduct, status: 'archived' } as Product)
    const tree = await renderPenztar({ termek: '42' })

    const html = renderMarkup(tree)
    expect(html).toContain('Ez a kurzus jelenleg nem vásárolható meg.')
    expect(html).toContain('href="/kurzusok"')
    expect(findElement(tree, CheckoutForm)).toBeNull()
  })
})


/**
 * VENDÉG-VÁSÁRLÁS (tulajdonosi döntés, 2026-08-15): az anonim látogatót az
 * oldal KORÁBBAN a /belepes-re irányította — a pénztárba be sem lehetett
 * lépni regisztráció nélkül. Az irányítás megszűnt: az űrlap `user={null}`
 * proppal renderelődik, és a vendég-mezőket (e-mail + név) mutatja.
 */
describe('/penztar — vendég-vásárlás (nincs bejelentkezés)', () => {
  it('anonim látogatónál NINCS átirányítás: a CheckoutForm user={null} proppal renderelődik', async () => {
    mockPayloadBehavior(publishedProduct, null)

    const tree = await renderPenztar({ termek: '42' })

    const form = findElement(tree, CheckoutForm)
    expect(form).not.toBeNull()
    const props = form!.props as { user: unknown; alreadyPurchased: boolean }
    expect(props.user).toBeNull()
    // „Már megvetted" állapot vendégként nem értelmezhető (nincs fiók).
    expect(props.alreadyPurchased).toBe(false)
  })

  it('az űrlap vendégként az azonosító mezőket rendereli (e-mail + név)', async () => {
    mockPayloadBehavior(publishedProduct, null)

    const html = renderMarkup(await renderPenztar({ termek: '42' }))

    expect(html).toContain('id="kc-field-guestEmail"')
    expect(html).toContain('id="kc-field-guestName"')
  })

  it('bejelentkezve a vendég-mezők NEM jelennek meg (a munkamenet azonosít)', async () => {
    mockPayloadBehavior(publishedProduct)

    const html = renderMarkup(await renderPenztar({ termek: '42' }))

    expect(html).not.toContain('id="kc-field-guestEmail"')
    expect(html).toContain('id="kc-field-billingName"')
  })
})

/**
 * ÜRES PIROS HIBADOBOZ (tulajdonosi hibajelentés, 2026-08-16).
 * Az élő hibarégió szándékosan MINDIG a DOM-ban van (a dinamikusan beszúrt
 * aria-live régiót több képernyőolvasó nem jelenti be) — a stíluslap viszont
 * üresen is piros keretet, piros hátteret és belső margót adott neki, így a
 * „Pénztár" cím alatt egy üres piros sáv ült.
 */
describe('/penztar — a hiba-élőrégió megjelenése', () => {
  function renderErrorRegion(error: string | null): string {
    return renderMarkup(createElement(CheckoutErrorRegion, { error }))
  }

  it('hiba NÉLKÜL a régió a DOM-ban marad, de data-visible="false"', () => {
    const html = renderErrorRegion(null)

    expect(html).toContain('class="kc-checkout-form__error"')
    expect(html).toContain('data-visible="false"')
    expect(html).toContain('aria-live="assertive"')
    expect(html).toContain('role="alert"')
    // Az élő régió üresen is létezik — enélkül a későbbi hiba bejelentése
    // megbízhatatlan lenne (ezért nem feltételes a renderelése).
    expect(html).not.toBe('')
  })

  it('beállított hibánál data-visible="true", és a szöveg látszik', () => {
    const html = renderErrorRegion('A fizetés indítása nem sikerült.')

    expect(html).toContain('data-visible="true"')
    expect(html).toContain('A fizetés indítása nem sikerült.')
  })

  it('a pénztár-oldal induló markupjában is „false" az állapot (hiba nélkül indul)', async () => {
    mockPayloadBehavior(publishedProduct)

    const html = renderMarkup(await renderPenztar({ termek: '42' }))

    expect(html).toContain('data-visible="false"')
    expect(html).not.toContain('data-visible="true"')
  })

  it('a CSS az üres állapotot lenullázza — keret, háttér és hely nélkül, de NEM display:none', () => {
    const css = readFileSync(
      fileURLToPath(new URL('../app/(frontend)/checkout.css', import.meta.url)),
      'utf8',
    )
    const rule = css.slice(css.indexOf(".kc-checkout-form__error[data-visible='false']"))
    expect(rule, 'nincs üres-állapot szabály a hibarégióra').not.toBe('')
    const body = rule.slice(0, rule.indexOf('}'))

    expect(body).toContain('border: 0')
    expect(body).toContain('background-color: transparent')
    expect(body).toContain('padding: 0')
    // A `position: absolute` veszi ki az elemet a flex-folyamból is, különben a
    // `.kc-checkout-form` gap-je üres rést hagyna a helyén.
    expect(body).toContain('position: absolute')
    // display:none elnémítaná az élő régiót — ezért TILOS.
    expect(body).not.toContain('display: none')
  })
})
