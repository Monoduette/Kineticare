import { Window } from 'happy-dom'
import { act, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CHECKOUT_BLOCK_HINT_ID,
  CheckoutForm,
  type CheckoutFormProps,
} from '../components/checkout/CheckoutForm'
import {
  CHECKOUT_ERROR_REGION_ID,
  CHECKOUT_TURNSTILE_CONTAINER_ID,
  CHECKOUT_TURNSTILE_FAILED_ERROR,
  WAIVER_START_INPUT_ID,
  checkboxErrorId,
  checkoutErrorSummaryTitle,
} from '../lib/checkout/form-submission'
import { ctaLabel } from '../lib/cta-vocabulary'
import { formatPriceHuf } from '../lib/format-price'

/**
 * A pénztár utolsó képernyője: amit a vevő a „Megrendelem és fizetek" előtt
 * lát, és ami a gomb megnyomásakor történik.
 *
 *  - a-ux-6 (45/2014. 15. § (1)): a lényeges feltételek és a végösszeg
 *    KÖZVETLENÜL a gomb fölött;
 *  - a-checkout-14 / a-ux-4: a beírt e-mail-cím visszaírása a gomb fölött;
 *  - a-ux-10: egy nyomásra minden hiba, linkes összefoglalóval és a
 *    jelölőnégyzetek saját hibaüzenetével;
 *  - a-checkout-9: a láthatatlan Turnstile tokenje a kérésben megy, a
 *    betöltési hiba pedig érthető üzenetet ad, nem néma blokkolást.
 *
 * A renderelt kimeneten és egy happy-dom böngészőben mérünk; valódi hálózati
 * hívás nem mehet ki (a `fetch` kém, CLAUDE.md 15.).
 */

const PRODUCT: CheckoutFormProps['product'] = {
  id: 42,
  sku: 'Otthoni KézRehab Program',
  priceHuf: 79500,
  isFree: false,
}

function staticHtml(props: Partial<CheckoutFormProps> = {}): string {
  return renderToStaticMarkup(
    createElement(CheckoutForm, {
      product: PRODUCT,
      user: null,
      alreadyPurchased: false,
      turnstileSiteKey: null,
      ...props,
    }),
  )
}

describe('összegzés közvetlenül a fizetőgomb fölött (a-ux-6)', () => {
  it('a gomb előtti utolsó blokk a termék, az egyszeri díj, a hozzáférés, a végösszeg és az áfa-mondat', () => {
    const html = staticHtml()
    const osszegzes = html.indexOf('class="kc-checkout-final"')
    const barion = html.indexOf('kc-barion--penztar')
    const gomb = html.indexOf(`>${ctaLabel('checkout-submit')}<`)
    expect(osszegzes).toBeGreaterThan(barion)
    expect(gomb).toBeGreaterThan(osszegzes)
    // Az összegzés és a gomb között nincs másik kártya vagy űrlaprész.
    const kozotte = html.slice(osszegzes, gomb)
    expect(kozotte).not.toContain('kc-card')
    expect(kozotte).not.toContain('<input')

    const blokk = html.slice(osszegzes, html.indexOf('</section>', osszegzes))
    expect(blokk).toContain(PRODUCT.sku)
    expect(blokk).toContain('egyszeri díj')
    expect(blokk).toContain('nem jár le')
    expect(blokk).toContain(formatPriceHuf(79500))
    // K1: a tulajdonos által jóváhagyott mondat, szó szerint (nem a komponens
    // saját konstansából: egy átírt vagy kiürített szöveg itt bukik).
    expect(blokk).toContain(
      'A feltüntetett ár a fizetendő végösszeg. A KINETICARE Kft. alanyi adómentes, ezért a számla áfát nem tartalmaz.',
    )
    expect(blokk).not.toMatch(/[–—]/)
  })

  it('bejelentkezve a fiók e-mail-címét írja vissza a gomb fölött', () => {
    const html = staticHtml({ user: { name: 'Minta Mari', email: 'mari@example.test' } })
    const blokk = html.slice(html.indexOf('class="kc-checkout-final"'))
    expect(blokk).toContain('A visszaigazolást erre a címre küldjük: mari@example.test')
  })

  it('már megvett kurzusnál nincs fizetési összegzés (nincs mit megrendelni)', () => {
    expect(staticHtml({ alreadyPurchased: true })).not.toContain('kc-checkout-final')
  })
})

/**
 * Egy happy-dom böngésző a CheckoutForm élő kipróbálásához. A `turnstile`
 * a már betöltött Cloudflare API-t helyettesíti (a szkript maga nem töltődik:
 * a happy-dom külső JS-betöltése ki van kapcsolva).
 */
async function openBrowser(
  options: {
    siteKey?: string | null
    turnstile?: Record<string, unknown>
    /** A Turnstile api.js betöltése sikerül-e (false = reklámblokkoló, hálózati hiba). */
    scriptLoads?: boolean
  } = {},
) {
  const browser = new Window({
    url: 'http://localhost:3000/penztar?termek=42',
    settings: {
      disableJavaScriptFileLoading: true,
      disableJavaScriptEvaluation: true,
      handleDisabledFileLoadingAsSuccess: options.scriptLoads ?? true,
    },
  })
  if (options.turnstile !== undefined) {
    ;(browser as unknown as { turnstile: unknown }).turnstile = options.turnstile
  }
  vi.stubGlobal('window', browser)
  vi.stubGlobal('document', browser.document)
  vi.stubGlobal('navigator', browser.navigator)
  vi.stubGlobal('HTMLElement', browser.HTMLElement)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
    Response.json({ error: 'A fizetés indítása most nem sikerült.' }, { status: 409 }),
  )
  vi.stubGlobal('fetch', fetchMock)
  const { createRoot } = await import('react-dom/client')
  const container = browser.document.createElement('div')
  browser.document.body.append(container)
  const root = createRoot(container as unknown as Element)
  await act(async () => {
    root.render(
      createElement(CheckoutForm, {
        product: PRODUCT,
        user: null,
        alreadyPurchased: false,
        turnstileSiteKey: options.siteKey ?? null,
      }),
    )
  })
  // A szkript-elem betöltési (vagy hiba-) eseménye aszinkron érkezik.
  await act(async () => {
    await browser.happyDOM.waitUntilComplete()
  })
  const valueSetter = Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, 'value')
  const type = async (name: string, value: string) => {
    const input = container.querySelector(`input[name="${name}"]`)
    if (input === null) throw new Error(`nincs ilyen mező: ${name}`)
    await act(async () => {
      valueSetter?.set?.call(input, value)
      input.dispatchEvent(new browser.Event('input', { bubbles: true }))
    })
  }
  const click = async (selector: string) => {
    const element = container.querySelector(selector) as unknown as { click(): void } | null
    if (element === null) throw new Error(`nincs ilyen elem: ${selector}`)
    await act(async () => {
      element.click()
    })
  }
  const close = async () => {
    await act(async () => {
      root.unmount()
    })
    await browser.happyDOM.close()
    vi.unstubAllGlobals()
  }
  return { browser, container, fetchMock, type, click, close }
}

async function fillValidForm(ui: Awaited<ReturnType<typeof openBrowser>>) {
  await ui.type('guestEmail', 'vevo@example.test')
  await ui.type('guestName', 'Minta Mari')
  await ui.type('billingName', 'Minta Mari')
  await ui.type('billingZip', '1011')
  await ui.type('billingCity', 'Budapest')
  await ui.type('billingStreet', 'Fő utca 1.')
  await ui.click('#waiver-start')
  await ui.click('#waiver-loss')
  await ui.click('#kc-checkout-terms')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('egy nyomásra minden hiba (a-ux-10)', () => {
  it('üres vendég-űrlapnál a hibarégió minden hibát linkkel sorol, és a négyzetek alatt saját hibaüzenet áll', async () => {
    const ui = await openBrowser()
    try {
      await ui.click('button[type="submit"]')

      const regio = ui.container.querySelector(`#${CHECKOUT_ERROR_REGION_ID}`)
      expect(regio?.getAttribute('data-visible')).toBe('true')
      expect(regio?.textContent).toContain(checkoutErrorSummaryTitle(9))
      const linkek = [...(regio?.querySelectorAll('a') ?? [])].map((a) => a.getAttribute('href'))
      expect(linkek).toEqual([
        '#kc-field-guestEmail',
        '#kc-field-guestName',
        '#kc-field-billingName',
        '#kc-field-billingZip',
        '#kc-field-billingCity',
        '#kc-field-billingStreet',
        '#waiver-start',
        '#waiver-loss',
        '#kc-checkout-terms',
      ])
      for (const name of ['waiverStart', 'waiverLoss', 'terms'] as const) {
        expect(ui.container.querySelector(`#${checkboxErrorId(name)}`)?.textContent).toBeTruthy()
      }
      const negyzet = ui.container.querySelector(`#${WAIVER_START_INPUT_ID}`)
      expect(negyzet?.getAttribute('aria-invalid')).toBe('true')
      expect(negyzet?.getAttribute('aria-describedby')).toContain(checkboxErrorId('waiverStart'))
      expect(ui.fetchMock).not.toHaveBeenCalled()

      // A link a hibás elemre viszi a fókuszt, és a kipipált négyzet hibája eltűnik.
      await ui.click(`#${CHECKOUT_ERROR_REGION_ID} a[href="#waiver-start"]`)
      expect(ui.browser.document.activeElement?.id).toBe(WAIVER_START_INPUT_ID)
      await ui.click('#waiver-start')
      expect(ui.container.querySelector(`#${checkboxErrorId('waiverStart')}`)).toBeNull()
    } finally {
      await ui.close()
    }
  })

  /**
   * a-ux-15 kísérője: a sikeres indítás után a gomb szándékosan
   * „Feldolgozás…"-ban marad. Ha a vevő a Barion oldaláról a böngésző Vissza
   * gombjával tér vissza, a lap a bfcache-ből, a megfagyott állapottal éled
   * újra; ekkor a gombnak újra használhatónak kell lennie.
   */
  it('a bfcache-ből visszatérő lapon a „Feldolgozás…" gomb újra nyomható', async () => {
    const ui = await openBrowser()
    try {
      // A kérés „repülés közben" marad, mint a Barion felé navigáló lapon.
      ui.fetchMock.mockImplementation(() => new Promise<Response>(() => {}))
      await fillValidForm(ui)
      await ui.click('button[type="submit"]')
      const gomb = ui.container.querySelector('button[type="submit"]')
      expect(gomb?.hasAttribute('disabled')).toBe(true)

      await act(async () => {
        const event = new ui.browser.Event('pageshow')
        Object.defineProperty(event, 'persisted', { value: true })
        ui.browser.dispatchEvent(event)
      })

      expect(gomb?.hasAttribute('disabled')).toBe(false)
      expect(gomb?.textContent).toBe(ctaLabel('checkout-submit'))
    } finally {
      await ui.close()
    }
  })

  it('a beírt vendég e-mail-cím a fizetőgomb fölött visszaíródik', async () => {
    const ui = await openBrowser()
    try {
      await ui.type('guestEmail', 'vevo@exmaple.test')
      expect(ui.container.querySelector('.kc-checkout-final__email')?.textContent).toBe(
        'Erre a címre küldjük a hozzáférést: vevo@exmaple.test',
      )
    } finally {
      await ui.close()
    }
  })
})

interface RenderOptions {
  callback: (token: string) => void
  'error-callback'?: () => void
  'before-interactive-callback'?: () => void
  'after-interactive-callback'?: () => void
  appearance?: string
}

describe('láthatatlan Turnstile a pénztárban (a-checkout-9)', () => {
  // SORREND: a next/script a már betöltött szkriptet modul-szintű
  // gyorsítótárban tartja, ezért a betöltési HIBA esete csak addig mérhető,
  // amíg ebben a fájlban még egyetlen widget sem töltötte be az api.js-t.
  // A hibás esetek ezért állnak elöl.
  it.each([
    [
      'a szkript nem töltődik be (reklámblokkoló, hálózat)',
      { siteKey: 'DUMMY-SITEKEY', scriptLoads: false },
    ],
    [
      'a widget hibát jelez',
      {
        siteKey: 'DUMMY-SITEKEY',
        turnstile: {
          render: (_container: unknown, options: RenderOptions) => {
            options['error-callback']?.()
            return 'widget-1'
          },
          reset: vi.fn(),
          remove: vi.fn(),
        },
      },
    ],
  ])('%s: a gomb megnyomására magyar magyarázatot ad, és nem küld', async (_nev, options) => {
    const ui = await openBrowser(options)
    try {
      await fillValidForm(ui)
      await ui.click('button[type="submit"]')

      expect(ui.fetchMock).not.toHaveBeenCalled()
      expect(ui.container.querySelector(`#${CHECKOUT_ERROR_REGION_ID}`)?.textContent).toBe(
        CHECKOUT_TURNSTILE_FAILED_ERROR,
      )
    } finally {
      await ui.close()
    }
  })

  it('a token a kérésben megy; sikertelen beküldés után a widget új ellenőrzést kér', async () => {
    const render = vi.fn((_container: unknown, options: RenderOptions) => {
      options.callback('DUMMY-TURNSTILE-TOKEN')
      return 'widget-1'
    })
    const reset = vi.fn()
    const ui = await openBrowser({
      siteKey: 'DUMMY-SITEKEY',
      turnstile: { render, reset, remove: vi.fn() },
    })
    try {
      expect(render).toHaveBeenCalledTimes(1)
      expect(render.mock.calls[0][1].appearance).toBe('interaction-only')
      await fillValidForm(ui)
      await ui.click('button[type="submit"]')

      expect(ui.fetchMock).toHaveBeenCalledTimes(1)
      const body = JSON.parse(String(ui.fetchMock.mock.calls[0][1]?.body)) as Record<
        string,
        unknown
      >
      expect(body.turnstileToken).toBe('DUMMY-TURNSTILE-TOKEN')
      // A szerver 409-et adott: a token elhasználódott, új ellenőrzés indul.
      expect(reset).toHaveBeenCalledWith('widget-1')
    } finally {
      await ui.close()
    }
  })
  /**
   * REGRESSZIÓ (breaker, 6a5cd61): interakció-kérésnél (a widget a gomb alatt
   * láthatóvá vált) a vevő a „még fut, várj" üzenetet kapta, és a fókusz a
   * lap tetejére ugrott, pedig a teendő a gomb alatti négyzet kipipálása. A
   * bázison: „expected 'A biztonsági ellenőrzés még fut. Várj…' not to be …".
   */
  it('interaktív kihívásnál a gomb alatti súgó mondja meg a teendőt, és a gomb a widgetre visz, nem a lap tetejére', async () => {
    let widgetOptions: RenderOptions | undefined
    const render = vi.fn((_container: unknown, options: RenderOptions) => {
      widgetOptions = options
      options['before-interactive-callback']?.()
      return 'widget-1'
    })
    const ui = await openBrowser({
      siteKey: 'DUMMY-SITEKEY',
      turnstile: { render, reset: vi.fn(), remove: vi.fn() },
    })
    try {
      await fillValidForm(ui)
      const sugo = ui.container.querySelector(`#${CHECKOUT_BLOCK_HINT_ID}`)
      expect(sugo?.textContent).toBe(
        'A fizetéshez pipáld ki a gomb alatti biztonsági ellenőrzés négyzetét.',
      )
      expect(
        ui.container.querySelector('button[type="submit"]')?.getAttribute('aria-describedby'),
      ).toBe(CHECKOUT_BLOCK_HINT_ID)

      await ui.click('button[type="submit"]')

      expect(ui.fetchMock).not.toHaveBeenCalled()
      expect(ui.container.querySelector(`#${CHECKOUT_ERROR_REGION_ID}`)?.textContent).toBe('')
      expect(ui.browser.document.activeElement?.id).toBe(CHECKOUT_TURNSTILE_CONTAINER_ID)

      // A vevő kipipálja: a kihívás kilép az interaktív módból, token jön, a súgó eltűnik, a beküldés megy.
      await act(async () => {
        widgetOptions?.['after-interactive-callback']?.()
        widgetOptions?.callback('DUMMY-TURNSTILE-TOKEN')
      })
      expect(ui.container.querySelector(`#${CHECKOUT_BLOCK_HINT_ID}`)).toBeNull()
      await ui.click('button[type="submit"]')
      expect(ui.fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      await ui.close()
    }
  })
})
