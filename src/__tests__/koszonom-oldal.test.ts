import { readFileSync } from 'node:fs'

import { Window } from 'happy-dom'
import type { Payload } from 'payload'
import { act, createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import KoszonjukPage, { metadata } from '../app/(frontend)/fizetes/koszonom/page'
import {
  THANK_YOU_STATE_CHECK_MAX_ORDER_AGE_MS,
  runThankYouPaymentStateCheck,
} from '../app/(frontend)/fizetes/koszonom/payment-state-check'
import {
  MAX_WEBHOOK_ATTEMPTS,
  type WebhookEventDoc,
  type WebhookEventStore,
} from '../lib/idempotency'
import {
  ThankYouFailed,
  ThankYouMissingOrder,
  ThankYouNotFound,
  ThankYouPaid,
  ThankYouRefunded,
  ThankYouReview,
  ThankYouTimeout,
  ThankYouUnauthorized,
  ThankYouView,
  GUEST_RESET_LINK_DELAY_MS,
  THANK_YOU_LIVE_REGION_ID,
  shouldEmitPurchaseConfirmed,
} from '../components/checkout/ThankYouView'
import { ctaLabel } from '../lib/cta-vocabulary'

/**
 * REGRESSZIÓ-ŐR: a köszönőoldal NEM dönthet szerver-oldali hitelesítésből.
 * A `/fizetes/koszonom` a Barion `redirectUrl`-je
 * (src/lib/checkout/start-checkout.ts), tehát MINDEN fizetés kereszt-oldali,
 * top-level GET-navigációval érkezik ide a `secure.barion.com`-ról. Egy ilyen
 * kérés `Origin` fejlécet nem küld, `Sec-Fetch-Site: cross-site`-ot viszont
 */

/**
 * A next/server `after()`-je a teszt kérés-környezetén kívül dobna; a kém
 * rögzíti, hogy a lap ütemezett-e, és mit (a feladat NEM fut le magától).
 */
const afterSpy = vi.hoisted(() => ({ after: vi.fn<(task: () => Promise<void>) => void>() }))
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: afterSpy.after }
})

/** A visszaadott elemfából kiszedi a ThankYouView elemet. */
function findThankYouElement(node: unknown): ReactElement | null {
  if (node === null || typeof node !== 'object') {
    return null
  }
  const element = node as ReactElement<Record<string, unknown>>
  if (element.type === ThankYouView) {
    return element
  }
  const children = (element.props as { children?: unknown } | undefined)?.children
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findThankYouElement(child)
      if (found) {
        return found
      }
    }
    return null
  }
  return findThankYouElement(children)
}

async function renderPage(order: Record<string, string | string[] | undefined>) {
  const tree = await KoszonjukPage({ searchParams: Promise.resolve(order) })
  const element = findThankYouElement(tree)
  if (!element) {
    throw new Error('a köszönőoldal nem rendereli a ThankYouView-t')
  }
  return element.props as Record<string, unknown>
}

describe('köszönőoldal — lapcím (állapot, nem siker)', () => {
  it('az élő kliens a review poll-válaszból kapcsolatnézetre vált és nem küld sikeres vásárlást', async () => {
    const browser = new Window({
      url: 'http://localhost:3000/fizetes/koszonom?order=SYNTHETIC-123',
    })
    vi.stubGlobal('window', browser)
    vi.stubGlobal('document', browser.document)
    vi.stubGlobal('navigator', browser.navigator)
    vi.stubGlobal('HTMLElement', browser.HTMLElement)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const fetch = vi.fn(async () =>
      Response.json({ status: 'refunded', paymentReviewRequired: true }),
    )
    vi.stubGlobal('fetch', fetch)
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => {
        root.render(createElement(ThankYouView, { orderNumber: 'SYNTHETIC-123' }))
      })
      expect(container.querySelector('h1')?.textContent).toBe('A fizetésed ellenőrzése szükséges')
      expect(container.querySelector('a')?.getAttribute('href')).toBe('/kapcsolat')
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(shouldEmitPurchaseConfirmed({ kind: 'review' })).toBe(false)
      expect(container.textContent).not.toContain('A fizetést visszatérítettük')
    } finally {
      await act(async () => {
        root.unmount()
      })
      container.remove()
      await browser.happyDOM.close()
      vi.unstubAllGlobals()
    }
  })
  it('az ellenőrzési nézet nem ígér banki sikert, és a kapcsolatfelvételre vezet', () => {
    const html = renderToStaticMarkup(
      createElement(ThankYouReview, { orderNumber: 'SYNTHETIC-123' }),
    )
    expect(html).toContain('A fizetésed ellenőrzése szükséges')
    expect(html).toContain('href="/kapcsolat"')
    expect(html).toContain('SYNTHETIC-123')
    expect(html).not.toMatch(/provider_unknown|refund-intent|idempotency|A pénzed visszatérítettük/)
  })
  it('a title nem állít sikert, amíg a fizetés kimenetele ismeretlen', () => {
    expect(metadata.title).toBe('A fizetésed állapota')
    expect(metadata.description).toBe(
      'A banki visszaigazolás után itt látod, mi a következő lépés.',
    )
    expect(String(metadata.title)).not.toContain('Köszönjük')
    expect(String(metadata.description)).not.toContain('feldolgozzuk')
    expect(String(metadata.title)).not.toMatch(/[–—]/)
    expect(String(metadata.description)).not.toMatch(/[–—]/)
  })
})

describe('köszönőoldal (Barion-visszatérés)', () => {
  it('CSAK a rendelésszámot adja át — bejelentkezettséget NEM dönt szerver-oldalon', async () => {
    const props = await renderPage({ order: 'KH-2026-000123' })

    expect(props.orderNumber).toBe('KH-2026-000123')
    // A döntő állítás: nincs szerver-oldalon eldöntött hitelesítési prop.
    // Ha valaki visszateszi (bármilyen néven), az itt bukik.
    expect(Object.keys(props)).toEqual(['orderNumber'])
  })

  it('hiányzó vagy üres rendelésszám esetén null megy át', async () => {
    expect((await renderPage({})).orderNumber).toBeNull()
    expect((await renderPage({ order: '   ' })).orderNumber).toBeNull()
    expect((await renderPage({ order: ['a', 'b'] })).orderNumber).toBeNull()
  })

  it('a rendelésszám körüli szóközök levágódnak', async () => {
    expect((await renderPage({ order: '  KH-2026-000123  ' })).orderNumber).toBe('KH-2026-000123')
  })

  /**
   * A checkout `?order=<rendelésszám>` paraméterrel kéri a visszairányítást
   * (src/lib/checkout/start-checkout.ts), a Barion pedig a SAJÁT `paymentId`
   * paraméterét fűzi hozzá. Ha ezt nem '&'-tel, hanem '?'-lel teszi, a
   * böngésző EGYETLEN paramétert lát: `order=KH-…?paymentId=<guid>`. A
   * rendelésszám alakja kötött (KH-<év>-<6 jegy>), ilyen karakter nincs benne,
   * tehát a maradék levágható — enélkül a státusz-poll szemét azonosítóval
   * indulna, és a vevő „nincs ilyen rendelés" nézetet kapna.
   */
  it('a Barion által hozzáfűzött paraméter nem szennyezi a rendelésszámot', async () => {
    expect(
      (await renderPage({ order: 'KH-2026-000123?paymentId=11111111-2222-3333-4444-555555555555' }))
        .orderNumber,
    ).toBe('KH-2026-000123')
    expect(
      (await renderPage({ order: 'KH-2026-000123&paymentId=11111111-2222-3333-4444-555555555555' }))
        .orderNumber,
    ).toBe('KH-2026-000123')
    expect((await renderPage({ order: '?paymentId=abc' })).orderNumber).toBeNull()
  })

  /**
   * A ThankYouView szerződése: a bejelentkezettség NEM bemenet. Ez azért külön
   * állítás, mert a hívó oldalt és a komponenst külön is el lehetne rontani.
   */
  it('a ThankYouView egyetlen propot vár, és az nem a bejelentkezettség', () => {
    expect(ThankYouView.length).toBe(1)
    const source = ThankYouView.toString()
    expect(source).not.toContain('isLoggedIn')
  })
})

describe('vendég visszatérése a Barionból — NEM állítunk sikert', () => {
  /**
   * A folyamat-audit MÉRÉSE: a Barion egyetlen visszatérési címet ismer
   * („after the payment is completed OR CANCELED"), a vendégnek pedig nincs
   * munkamenete, tehát az állapot-lekérdezés neki mindig 401. Négy állapoton
   * mérve — valós fiókos `payment_failed`, valós VENDÉG `payment_failed`, valós
   * `paid`, és egy KITALÁLT rendelésszám — mind a négy ugyanazt a „Köszönjük a
   * vásárlást! … Több teendőd nincs." képernyőt kapta.
   *
   * Akinek a kártyáját elutasították, azt a rendszer tájékoztatta, hogy
   * vásárolt, és várjon egy e-mailt, ami sosem jön. Ez az őr azt rögzíti, hogy
   * ezen az ágon SEMMILYEN kimenetelt nem állítunk.
   */
  const markup = () =>
    renderToStaticMarkup(createElement(ThankYouUnauthorized, { orderNumber: 'KH-2026-000009' }))

  it('nem mondja, hogy megtörtént a vásárlás', () => {
    const html = markup()
    expect(html).not.toContain('Köszönjük a vásárlást')
    expect(html).not.toContain('Több teendőd nincs')
    // „A fizetésed feldolgozzuk" is állítás lenne arról, hogy van mit feldolgozni.
    expect(html).not.toContain('A fizetésed feldolgozzuk')
  })

  it('kimondja, hogy a visszaigazolás e-mailben jön, belépés nélkül nem látjuk az állapotot', () => {
    const html = markup()
    expect(html).toContain('A visszaigazolás e-mailben érkezik')
    expect(html).toContain('nincs belépésed')
    expect(html).not.toContain('Nem látjuk, mi történt a fizetéssel')
  })

  it('MINDKÉT lehetséges kimenetelre megmondja a következő lépést', () => {
    const html = markup()
    expect(html).toContain('ha a fizetés sikerült')
    expect(html).toContain('megszakítottad')
    expect(html).toContain('elutasította')
    expect(html).toContain('próbálhatod')
  })

  it('a rendelésszám és a kiutak megmaradnak, egyik sem a köszönőoldalra visz vissza', () => {
    const html = markup()
    expect(html).toContain('KH-2026-000009')
    expect(html).toContain('/belepes?returnUrl=')
    expect(html).toContain('%2Fkurzusaim')
    expect(html).not.toContain('/fizetes/koszonom')
    expect(html).toContain('/kurzusok')
    expect(html).not.toMatch(/kc-button[^>]*href="\/kurzusok"/)
  })

  /**
   * a-ux-5 REGRESSZIÓ: korábban a nézet ELSŐ, elsődleges gombja a
   * jelszó-visszaállító kérés volt. A paid-levél aktiváló linkje ugyanazt a
   * (felhasználónként egyetlen) Payload reset-tokent használja, tehát a gomb
   * nyomán beküldött kérés a levélben lévő linket érvénytelenítette. Most az
   * e-mail az útmutatás, elsődleges gomb nincs, és a kérés csak késleltetve,
   * másodlagos linkként jelenik meg.
   */
  it('a jelszó-beállító kérés NEM elsődleges gomb, és a késleltetés lejárta előtt nincs is link rá', () => {
    const html = markup()
    expect(html).not.toContain('href="/elfelejtett-jelszo')
    expect(html).not.toMatch(/kc-button--primary/)
    expect(html).toMatch(/kc-button--secondary[^>]*href="\/belepes/)
    expect(html).toContain('Ha a levél 10 perc alatt sem érkezik meg')
    expect(html).toContain('az új link a levélben lévőt érvényteleníti')
  })

  it('a késleltetés után a kérés másodlagos szöveglinkként jelenik meg, jelszó-beállító linkként megnevezve', () => {
    const html = renderToStaticMarkup(
      createElement(ThankYouUnauthorized, { orderNumber: 'KH-2026-000009', showResetLink: true }),
    )
    expect(html).toContain('Nem jött meg a levél 10 perc alatt?')
    expect(html).toContain('Kérj új jelszó-beállító linket')
    expect(html).toMatch(
      /<a href="\/elfelejtett-jelszo\?returnUrl=%2Fkurzusaim">Kérem a visszaállító linket<\/a>/,
    )
    expect(html).not.toMatch(/kc-button[^>]*href="\/elfelejtett-jelszo/)
    expect(GUEST_RESET_LINK_DELAY_MS).toBe(10 * 60 * 1000)
  })
})

describe('bejelentkezett, sikeres fizetés — a lejátszó a következő lépés', () => {
  it('ismert termék-id-nél a gomb a lejátszóra visz, nem a listára', () => {
    const html = renderToStaticMarkup(
      createElement(ThankYouPaid, { orderNumber: 'KH-2026-000123', productId: 42 }),
    )
    expect(html).toContain('Köszönjük a vásárlást')
    expect(html).toContain('most megnyitható')
    expect(html).toContain('href="/kurzusaim/42"')
    expect(html).toContain('Kezdd el a kurzust')
    expect(html).not.toMatch(/kc-button[^>]*href="\/kurzusaim"/)
    expect(html).not.toMatch(/[–—]/)
  })

  it('hiányzó termék-id-nél a Kurzusaim lista a tartalék', () => {
    const html = renderToStaticMarkup(
      createElement(ThankYouPaid, { orderNumber: 'KH-2026-000123', productId: null }),
    )
    expect(html).toContain('href="/kurzusaim"')
    expect(html).toContain('Nyisd meg a kurzusaidat')
    expect(html).not.toContain('/kurzusaim/42')
  })
})

describe('bejelentkezett, függő fizetés — a poll után is a kurzus a következő lépés', () => {
  it('ismert termék-id-nél a gomb a lejátszóra visz', () => {
    const html = renderToStaticMarkup(
      createElement(ThankYouTimeout, { orderNumber: 'KH-2026-000123', productId: 42 }),
    )
    expect(html).toContain('feldolgozása folyamatban')
    expect(html).toContain('href="/kurzusaim/42"')
    expect(html).toContain('Kezdd el a kurzust')
    expect(html).not.toMatch(/kc-button[^>]*href="\/kurzusaim"/)
    expect(html).not.toContain('Kurzusaim oldalon')
    expect(html).not.toMatch(/[–—]/)
  })

  it('hiányzó termék-id-nél a lista a tartalék', () => {
    const html = renderToStaticMarkup(
      createElement(ThankYouTimeout, { orderNumber: 'KH-2026-000123', productId: null }),
    )
    expect(html).toContain('href="/kurzusaim"')
    expect(html).toContain('Nyisd meg a kurzusaidat')
    expect(html).not.toContain('Kurzusaim oldalon')
  })
})

/**
 * VISSZATÉRÍTETT FIZETÉS — a negyedik kimenetel (2026-08-29).
 *
 * A rendelés `refunded` állapotba kerülhet a paid-átmenet ELLENŐRZÉSE után
 * (összeg-eltérés, privilegizált fiókra kötött vendégvásárlás): a pénz
 * automatikusan visszamegy, hozzáférés viszont NEM jön létre. A poll eddig
 * ezt az állapotot nem ismerte, tehát a vevő a 2 perces időkorlátig pörgő
 * „feldolgozzuk" nézetet kapta, majd egy „a bank még dolgozik rajta"
 * üzenetet — mindkettő hamis állítás egy már lezárt, visszatérített
 * fizetésről.
 *
 * Forrás: NN/g, Error Message Guidelines (mondd meg, mi történt és mi a
 * következő lépés) https://www.nngroup.com/articles/error-message-guidelines/ ;
 * GOV.UK Design System, Error message pattern
 * https://design-system.service.gov.uk/components/error-message/ ;
 * Baymard, a fizetési állapotot egyértelműen kell közölni
 * https://baymard.com/blog/order-confirmation-design ;
 * WCAG 2.2 · 3.3.1 Error Identification, 4.1.3 Status Messages.
 */
describe('visszatérített fizetés — a pénz visszament, hozzáférés nincs', () => {
  const CIM = 'A fizetést visszatérítettük'
  const TORZS =
    'A rendelést az ellenőrzés után nem zárhattuk le, ezért a teljes összeget automatikusan visszaküldtük a kártyádra. Hozzáférés nem jött létre. Ha kérdésed van, írj nekünk, vagy indítsd újra a vásárlást.'

  it('kimondja, hogy visszatérítettük az összeget, és hogy hozzáférés nem jött létre', () => {
    const html = renderToStaticMarkup(
      createElement(ThankYouRefunded, { orderNumber: 'KH-2026-000123', productId: 42 }),
    )
    expect(html).toContain(CIM)
    expect(html).toContain(TORZS)
    // A három hamis állítás, amit ez a nézet kizár:
    expect(html).not.toContain('Köszönjük a vásárlást')
    expect(html).not.toContain('feldolgozása folyamatban')
    expect(html).not.toContain('A fizetés nem sikerült')
  })

  it('a rendelésszám és a kiutak megvannak, új gombfelirat nélkül', () => {
    const html = renderToStaticMarkup(
      createElement(ThankYouRefunded, { orderNumber: 'KH-2026-000123', productId: 42 }),
    )
    expect(html).toContain('KH-2026-000123')
    expect(html).toContain('href="/kurzusok/42"')
    expect(html).toContain(ctaLabel('course-sales-open'))
    expect(html).toContain('href="/kapcsolat"')
    expect(html).toContain(ctaLabel('contact-open'))
    // A lejátszóra vivő gomb HAZUGSÁG lenne: hozzáférés nem jött létre.
    expect(html).not.toContain('href="/kurzusaim/42"')
    expect(html).not.toContain(ctaLabel('course-start'))
  })

  it('ismeretlen termék-id: a kapcsolat marad az egyetlen kiút (nem találunk ki célt)', () => {
    const html = renderToStaticMarkup(
      createElement(ThankYouRefunded, { orderNumber: 'KH-2026-000123', productId: null }),
    )
    expect(html).toContain(CIM)
    expect(html).toContain('href="/kapcsolat"')
    expect(html).not.toContain('/kurzusok/')
  })

  it('a meglévő nézet-szerkezetet használja (nincs új CSS-osztály)', () => {
    const html = renderToStaticMarkup(
      createElement(ThankYouRefunded, { orderNumber: 'KH-2026-000123', productId: 42 }),
    )
    expect(html).toContain('class="kc-thankyou"')
    expect(html).toContain('kc-thankyou__order')
    expect(html).toContain('kc-thankyou__actions')
  })

  it('a mikroszöveg magyar szabály szerinti (nincs kvirtmínusz és gondolatjel)', () => {
    const html = renderToStaticMarkup(
      createElement(ThankYouRefunded, { orderNumber: 'KH-2026-000123', productId: 42 }),
    )
    expect(html).not.toMatch(/[–—]/)
  })
})

/**
 * A SIKERTELEN FIZETÉS SZÖVEGE (2026-08-29-i vezetői döntés).
 *
 * A korábbi „Semmi sem került levonásra, újrapróbálhatod bármikor." mondat
 * OLYAT ÁLLÍTOTT, amit a felület nem tudhat: a kártyán maradhat zárolás, és a
 * bank a késve jóváhagyott fizetést utólag is teljesítheti (ilyenkor a
 * rendszer a paid-átmenetet magától elvégzi). A GOV.UK error message pattern
 * és az NN/g Error Message Guidelines szerint a hibaüzenet nem ígérhet olyat,
 * ami később hamisnak bizonyulhat; Baymard: a fizetési állapot közlése legyen
 * pontos.
 */
describe('sikertelen fizetés — a levonásról nem állítunk többet a valóságnál', () => {
  const html = () =>
    renderToStaticMarkup(
      createElement(ThankYouFailed, { orderNumber: 'KH-2026-000077', productId: 42 }),
    )

  it('a régi, feltétlen állítás eltűnt', () => {
    expect(html()).not.toContain('Semmi sem került levonásra')
    expect(html()).not.toContain('újrapróbálhatod bármikor')
  })

  /**
   * a-ux-13 REGRESSZIÓ: a `cancelled` állapot a vevő saját megszakítását is
   * jelenti (a Barion Canceled/Expired/Failed mind ide képeződik), a korábbi
   * szöveg mégis a bankot hibáztatta; a rendelésszám pedig hiányzott, pedig a
   * nézet kapcsolatfelvételre is küld.
   */
  it('a jóváhagyott szöveg áll ott, szó szerint, a rendelésszámmal', () => {
    expect(html()).toContain(
      'A fizetés nem zárult le: megszakítottad, vagy a bank elutasította. Ilyenkor általában nem történik levonás. Ha a bankod később mégis jóváhagyja a fizetést, automatikusan érvényesítjük, és e-mailben visszaigazoljuk. Újra is próbálhatod a fizetést.',
    )
    expect(html()).not.toContain('A fizetésedet a bank elutasította vagy megszakította.')
    expect(html()).toContain('Rendelésszám: <strong>KH-2026-000077</strong>')
  })

  it('az újrapróbálás útja és a kapcsolat változatlan', () => {
    expect(html()).toContain('href="/penztar?termek=42"')
    expect(html()).toContain(ctaLabel('retry'))
    expect(html()).toContain('href="/kapcsolat"')
    expect(html()).toContain('kc-thankyou--failed')
  })

  it('ismeretlen termék-id esetén a kurzuslista a biztonságos cél', () => {
    const listaHtml = renderToStaticMarkup(
      createElement(ThankYouFailed, { orderNumber: 'KH-2026-000077', productId: null }),
    )
    expect(listaHtml).toContain('href="/kurzusok"')
    expect(listaHtml).not.toContain('/penztar?termek=')
  })

  it('a mikroszöveg magyar szabály szerinti (nincs kvirtmínusz és gondolatjel)', () => {
    expect(html()).not.toMatch(/[–—]/)
  })
})

/**
 * MÉRÉS a visszatérítés-nézeten: érintőcél, 320 px-es reflow és a három
 * betűméret-token. A nézet ÚJ CSS-t nem vezet be (a `.kc-thankyou` dobozt és
 * a `.kc-thankyou__actions` sávot használja), ezért a mérés a meglévő
 * tokenekből számol — becslés nélkül.
 *
 * WCAG 2.2 · 1.4.10 Reflow (320 CSS px-en nincs vízszintes görgetés)
 * https://www.w3.org/WAI/WCAG22/Understanding/reflow.html ;
 * WCAG 2.2 · 2.5.8 Target Size (Minimum)
 * https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
 */
describe('visszatérítés-nézet — mért érintőcél és 320 px-es reflow', () => {
  const olvas = (relativUt: string): string =>
    readFileSync(new URL(`../${relativUt}`, import.meta.url), 'utf8')
  const kommentNelkul = (forras: string): string =>
    forras.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  const szabalyTorzs = (css: string, szelektor: string): string => {
    const minta = new RegExp(
      `(^|[,}])\\s*${szelektor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(,[^{]*)?\\{([^}]*)\\}`,
      'm',
    )
    return minta.exec(kommentNelkul(css))?.[3] ?? ''
  }
  const remPx = (ertek: string): number => {
    const rem = /^([\d.]+)rem$/.exec(ertek.trim())
    if (rem !== null) {
      return Number.parseFloat(rem[1]) * 16
    }
    const px = /^([\d.]+)px$/.exec(ertek.trim())
    return px === null ? Number.NaN : Number.parseFloat(px[1])
  }

  /** A tokenek `var(...)` hivatkozásokon át feloldva (a repó bevett mérési módja). */
  const nyersTokenek = new Map<string, string>()
  for (const talalat of kommentNelkul(olvas('app/(frontend)/styles/tokens.css')).matchAll(
    /^\s*(--kc-[a-z0-9-]+):\s*([^;]+);/gm,
  )) {
    nyersTokenek.set(talalat[1], talalat[2].trim())
  }
  const token = (nev: string, melyseg = 0): number => {
    const ertek = nyersTokenek.get(nev)
    if (ertek === undefined || melyseg > 8) {
      return Number.NaN
    }
    const hivatkozas = /^var\(\s*(--kc-[a-z0-9-]+)\s*\)$/.exec(ertek)
    return hivatkozas === null ? remPx(ertek) : token(hivatkozas[1], melyseg + 1)
  }

  const ui = olvas('app/(frontend)/styles/ui.css')
  const checkout = olvas('app/(frontend)/checkout.css')

  it('a nézet a MEGLÉVŐ osztályokat használja (nincs új CSS-szabály)', () => {
    expect(szabalyTorzs(checkout, '.kc-thankyou')).not.toBe('')
    expect(szabalyTorzs(checkout, '.kc-thankyou__actions')).not.toBe('')
    // Új, csak ehhez a nézethez tartozó módosító nem keletkezett.
    expect(checkout).not.toContain('.kc-thankyou--refunded')
  })

  it('a gombok érintőcélja legalább 44 px magas (SC 2.5.5/2.5.8)', () => {
    const magassag = remPx(/min-height:\s*([^;]+);/.exec(szabalyTorzs(ui, '.kc-button'))?.[1] ?? '')
    expect(magassag, `mért min-height: ${magassag} px`).toBeGreaterThanOrEqual(44)
  })

  it('320 px-en a leghosszabb gombfelirat is befér, túlcsordulás nélkül (SC 1.4.10)', () => {
    const oldalMargo = token('--kc-container-gutter')
    const dobozBelso = token(
      /padding:\s*var\((--kc-space-\d)\)/.exec(szabalyTorzs(checkout, '.kc-thankyou'))?.[1] ?? '',
    )
    const gombBelso = token(
      /padding:\s*var\(--kc-space-\d\)\s+var\((--kc-space-\d)\)/.exec(
        szabalyTorzs(ui, '.kc-button'),
      )?.[1] ?? '',
    )
    for (const ertek of [oldalMargo, dobozBelso, gombBelso]) {
      expect(ertek).toBeGreaterThan(0)
    }

    // 320 px-en a --kc-font-m clamp ALSÓ értéke érvényes: 1rem = 16 px.
    const FONT_PX = 16
    // A repó felső becslése a legszélesebb karakterre (penztar-kosar mérés).
    const LEGSZELESEBB_KARAKTER_EM = 0.6
    const feliratSav = 320 - 2 * oldalMargo - 2 * dobozBelso - 2 * gombBelso - 4
    expect(feliratSav, `mért felirat-sáv: ${feliratSav} px`).toBeGreaterThan(0)

    for (const felirat of [ctaLabel('course-sales-open'), ctaLabel('contact-open')]) {
      const leghosszabbSzo = felirat
        .split(/\s+/)
        .reduce((leghosszabb, szo) => (szo.length > leghosszabb.length ? szo : leghosszabb), '')
      const szoSzelesseg = leghosszabbSzo.length * LEGSZELESEBB_KARAKTER_EM * FONT_PX
      expect(
        szoSzelesseg,
        `„${leghosszabbSzo}" felső becsléssel ${szoSzelesseg.toFixed(0)} px, a gomb belső sávja ${feliratSav} px`,
      ).toBeLessThan(feliratSav)
    }
  })

  it('a rendelésszám sora a HÁROM méret-token egyikén áll', () => {
    expect(szabalyTorzs(checkout, '.kc-thankyou__order')).toMatch(
      /font-size:\s*var\(--kc-font-[lms]\)/,
    )
  })
})

describe('köszönőoldal — pollás állapotjelző', () => {
  it('a várakozás nem emoji-óra, hanem CSS-sáv (U-10)', () => {
    const html = renderToStaticMarkup(
      createElement(ThankYouView, { orderNumber: 'KH-2026-000123' }),
    )
    expect(html).toContain('kc-thankyou__spinner')
    expect(html).not.toContain('⏳')
    expect(html).toContain('Köszönjük, feldolgozzuk a fizetésedet')
  })
})

describe('köszönőoldal — hiányzó vagy idegen rendelés', () => {
  it('rendelésszám nélkül a gomb a kurzusaidhoz visz, nem oldalnévre küld', () => {
    const html = renderToStaticMarkup(createElement(ThankYouMissingOrder))
    expect(html).toContain('Hiányzik a rendelésszám')
    expect(html).toContain('<h1>A fizetésed állapota</h1>')
    expect(html).not.toContain('Köszönjük!')
    expect(html).toContain('href="/kurzusaim"')
    expect(html).toContain('Nyisd meg a kurzusaidat')
    expect(html).not.toContain('Kurzusaim oldalon')
    expect(html).not.toMatch(/[–—]/)
  })

  it('ismeretlen rendelésnél a lista és a kapcsolat a kiút', () => {
    const html = renderToStaticMarkup(
      createElement(ThankYouNotFound, { orderNumber: 'KH-2026-000999' }),
    )
    expect(html).toContain('KH-2026-000999')
    expect(html).toContain('href="/kurzusaim"')
    expect(html).toContain('href="/kapcsolat"')
    expect(html).not.toContain('Kurzusaim oldalra')
    expect(html).not.toMatch(/[–—]/)
  })
})

/**
 * a-ux-11 REGRESSZIÓ: az állapotváltáskor az élő régió NEM cserélődhet. A
 * korábbi kódban minden nézet saját `role="status"` dobozt hozott, így a
 * vendég 401-es válaszakor a „feldolgozzuk" régió eltűnt, és egy már kitöltött
 * új régió került a helyére, amelyet a képernyőolvasók megbízhatatlanul
 * jelentenek be (MDN, Live regions). Mérés: ugyanaz a DOM-csomópont-e a régió
 * a váltás előtt és után.
 */
describe('köszönőoldal — egyetlen, végig élő állapot-régió (WCAG 2.2 SC 4.1.3)', () => {
  it('a poll-válasz után ugyanaz a role="status" csomópont él, csak a tartalma változik', async () => {
    const browser = new Window({
      url: 'http://localhost:3000/fizetes/koszonom?order=KH-2026-000123',
    })
    vi.stubGlobal('window', browser)
    vi.stubGlobal('document', browser.document)
    vi.stubGlobal('navigator', browser.navigator)
    vi.stubGlobal('HTMLElement', browser.HTMLElement)
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    let valasz: (response: Response) => void = () => {}
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          valasz = resolve
        }),
    )
    vi.stubGlobal('fetch', fetch)
    const { createRoot } = await import('react-dom/client')
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => {
        root.render(createElement(ThankYouView, { orderNumber: 'KH-2026-000123' }))
      })
      const regioElotte = container.querySelector('[role="status"]')
      expect(regioElotte?.textContent).toContain('Köszönjük, feldolgozzuk a fizetésedet')
      expect(container.querySelectorAll('[role="status"], [role="alert"]')).toHaveLength(1)

      await act(async () => {
        valasz(new Response(null, { status: 401 }))
      })

      const regioUtana = container.querySelector('[role="status"]')
      expect(regioUtana?.textContent).toContain('A visszaigazolás e-mailben érkezik')
      expect(regioUtana).toBe(regioElotte)
      expect(regioUtana?.getAttribute('aria-live')).toBe('polite')
      expect(regioUtana?.id).toBe(THANK_YOU_LIVE_REGION_ID)
      expect(container.querySelectorAll('[role="status"], [role="alert"]')).toHaveLength(1)
    } finally {
      await act(async () => {
        root.unmount()
      })
      container.remove()
      await browser.happyDOM.close()
      vi.unstubAllGlobals()
    }
  })
})

/**
 * a-ux-12: a címsor 320 px-en ne törjön szó közepén elválasztójel nélkül. A
 * mért állapot (Chromium, 320×740) a jelentésben; ez az őr a két szabályt
 * rögzíti, amelyre a mérés épül.
 */
describe('köszönőoldal — címsor 320 px-en', () => {
  const checkoutCss = readFileSync(
    new URL('../app/(frontend)/checkout.css', import.meta.url),
    'utf8',
  )
  it('a címsor magyar elválasztással tör, és 360 px alatt a doboz belső margója kisebb', () => {
    expect(checkoutCss).toMatch(/\.kc-thankyou h1 \{[^}]*hyphens:\s*auto;/)
    expect(checkoutCss).toMatch(
      /@media \(max-width: 359\.98px\) \{\s*\.kc-thankyou \{\s*padding: var\(--kc-space-4\);/,
    )
  })
})

/**
 * a-callback-11 / a-checkout-3 / r-barion-7 (3): a Barion-visszatéréskor EGY
 * PaymentState-ellenőrzés a rendelés TÁROLT PaymentId-jére, a callback-út
 * feldolgozóján át. A tesztből valódi hálózati hívás nem mehet ki: a Barion
 * GetState a globális `fetch` kémén fut (CLAUDE.md 15.).
 */
describe('köszönőoldal — PaymentState-ellenőrzés a visszatéréskor', () => {
  const ORDER_NUMBER = 'KH-2026-000123'
  const STORED_PAYMENT_ID = '11111111-2222-3333-4444-555555555555'
  const NOW = Date.parse('2026-09-24T10:00:00.000Z')
  const envKeys = [
    'BARION_API_URL',
    'BARION_PAYEE_EMAIL',
    'BARION_POSKEY_TEST',
    'BARION_ENVIRONMENT',
  ]
  const savedEnv: Record<string, string | undefined> = {}
  const fetchMock = vi.fn()

  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key]
    }
    process.env.BARION_API_URL = 'https://api.test.barion.com'
    process.env.BARION_PAYEE_EMAIL = 'payee@example.test'
    // DUMMY érték, egyértelműen jelölve — NEM valódi Barion POSKey.
    process.env.BARION_POSKEY_TEST = 'DUMMY-POSKEY-NEM-VALODI-TITOK'
    delete process.env.BARION_ENVIRONMENT
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    afterSpy.after.mockReset()
  })

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = savedEnv[key]
      }
    }
    vi.unstubAllGlobals()
  })

  function order(overrides: Record<string, unknown> = {}) {
    return {
      id: 101,
      orderNumber: ORDER_NUMBER,
      status: 'payment_pending',
      barionPaymentId: STORED_PAYMENT_ID,
      currency: 'HUF',
      totalHufSnapshot: 19990,
      createdAt: new Date(NOW - 5 * 60 * 1000).toISOString(),
      items: [{ product: 42, quantity: 1 }],
      ...overrides,
    }
  }

  function fakePayload(doc: Record<string, unknown> | null) {
    const find = vi.fn(async ({ where }: { where?: unknown }) => {
      const json = JSON.stringify(where ?? {})
      if (doc === null) return { docs: [], totalDocs: 0 }
      if (json.includes('orderNumber') && json.includes(String(doc.orderNumber))) {
        return { docs: [doc], totalDocs: 1 }
      }
      if (json.includes('barionPaymentId') && json.includes(String(doc.barionPaymentId))) {
        return { docs: [doc], totalDocs: 1 }
      }
      return { docs: [], totalDocs: 0 }
    })
    const update = vi.fn(async () => ({}))
    return { payload: { find, update } as unknown as Payload, find, update }
  }

  function memoryStore(initial: WebhookEventDoc[] = []) {
    const docs = [...initial]
    const store: WebhookEventStore = {
      find: async ({ where }) => {
        const match = /"externalId":\{"equals":"([^"]+)"\}/.exec(JSON.stringify(where ?? {}))
        const found = docs.filter((doc) => !match || doc.externalId === match[1])
        return { docs: found, totalDocs: found.length }
      },
      create: async ({ data }) => {
        const doc = { id: docs.length + 1, ...data } as unknown as WebhookEventDoc
        docs.push(doc)
        return doc
      },
      update: async ({ id, data }) => {
        const doc = docs.find((candidate) => candidate.id === id)
        if (!doc) throw new Error(`nincs ilyen rekord: ${id}`)
        Object.assign(doc, data)
        return doc
      },
    }
    return { store, docs }
  }

  function preparedState(): Response {
    return new Response(
      JSON.stringify({
        PaymentId: STORED_PAYMENT_ID,
        PaymentRequestId: ORDER_NUMBER,
        Status: 'Prepared',
        Total: 19990,
        Currency: 'HUF',
        Transactions: [],
        Errors: [],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  it('a lap rendelésszám mellett a válasz UTÁN ütemez egy ellenőrzést, rendelésszám nélkül nem', async () => {
    await KoszonjukPage({ searchParams: Promise.resolve({ order: ORDER_NUMBER }) })
    expect(afterSpy.after).toHaveBeenCalledTimes(1)
    afterSpy.after.mockReset()
    await KoszonjukPage({ searchParams: Promise.resolve({}) })
    expect(afterSpy.after).not.toHaveBeenCalled()
  })

  it('függő, friss rendelésnél a TÁROLT PaymentId-re kér GetState-et a callback-feldolgozón át, a URL-es paymentId-t figyelmen kívül hagyva', async () => {
    fetchMock.mockResolvedValueOnce(preparedState())
    const { payload } = fakePayload(order())
    const { store, docs } = memoryStore()

    // A lap a Barion által hozzáfűzött paymentId-t levágja; az ellenőrzés
    // bemenete kizárólag a rendelésszám.
    const props = await (async () => {
      const tree = await KoszonjukPage({
        searchParams: Promise.resolve({
          order: `${ORDER_NUMBER}?paymentId=99999999-8888-7777-6666-555555555555`,
        }),
      })
      return findThankYouElement(tree)?.props as { orderNumber: string }
    })()
    const outcome = await runThankYouPaymentStateCheck({
      payload,
      orderNumber: props.orderNumber,
      store,
      now: NOW,
    })

    expect(outcome).toBe('processed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/v4/Payment/')
    expect(url.toLowerCase().replace(/-/g, '')).toContain(STORED_PAYMENT_ID.replace(/-/g, ''))
    expect(url).not.toContain('99999999')
    // A callback-út eseménye jött létre (ugyanaz a dedup-kulcs), és a függő
    // kimenetel nem zárja le: a későbbi valódi callback még feldolgozható.
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({ externalId: STORED_PAYMENT_ID, status: 'received' })
  })

  it.each([
    ['nem függő (már paid)', order({ status: 'paid' }), 'not-pending'],
    ['nincs tárolt PaymentId', order({ barionPaymentId: null }), 'no-payment-id'],
    [
      'régi rendelés (az order-poll viszi)',
      order({
        createdAt: new Date(NOW - THANK_YOU_STATE_CHECK_MAX_ORDER_AGE_MS - 1000).toISOString(),
      }),
      'too-old',
    ],
    ['nem létező rendelés', null, 'not-found'],
  ])('%s: nincs GetState', async (_nev, doc, vart) => {
    const { payload } = fakePayload(doc)
    const { store } = memoryStore()
    expect(
      await runThankYouPaymentStateCheck({ payload, orderNumber: ORDER_NUMBER, store, now: NOW }),
    ).toBe(vart)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rendelésszám-alakú bemenet nélkül az adatbázist sem kérdezi', async () => {
    const { payload, find } = fakePayload(order())
    expect(
      await runThankYouPaymentStateCheck({ payload, orderNumber: "KH-1' OR 1=1", now: NOW }),
    ).toBe('invalid-order-number')
    expect(find).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('már lezárt callback-eseménynél nem hív újra', async () => {
    const { payload } = fakePayload(order())
    const { store } = memoryStore([
      {
        id: 1,
        provider: 'barion',
        externalId: STORED_PAYMENT_ID,
        status: 'processed',
        attempts: 1,
        result: 'cancelled',
        processedAt: new Date(NOW).toISOString(),
      } as unknown as WebhookEventDoc,
    ])
    expect(
      await runThankYouPaymentStateCheck({ payload, orderNumber: ORDER_NUMBER, store, now: NOW }),
    ).toBe('already-processed')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  /**
   * Oldal-újratöltésekkel nem lehet a callback-eseményt kimeríteni: a
   * kimerülés riasztást ad és a retry-jobból kivenné az eseményt. Ez az út a
   * kimerülés ELŐTTI utolsó kísérletet a valódi callbacknek hagyja.
   */
  it('a kimerülés előtti utolsó kísérletet nem használja el', async () => {
    const { payload } = fakePayload(order())
    const { store, docs } = memoryStore([
      {
        id: 1,
        provider: 'barion',
        externalId: STORED_PAYMENT_ID,
        status: 'received',
        attempts: MAX_WEBHOOK_ATTEMPTS - 1,
        result: 'pending_repoll',
      } as unknown as WebhookEventDoc,
    ])
    expect(
      await runThankYouPaymentStateCheck({ payload, orderNumber: ORDER_NUMBER, store, now: NOW }),
    ).toBe('attempts-reserved')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(docs[0].attempts).toBe(MAX_WEBHOOK_ATTEMPTS - 1)
  })

  it('a Barion hibája nem dob a hívóra (a válasz után fut), és a kimenetel „failed"', async () => {
    fetchMock.mockRejectedValueOnce(new Error('hálózati hiba'))
    const { payload } = fakePayload(order())
    const { store } = memoryStore()
    await expect(
      runThankYouPaymentStateCheck({ payload, orderNumber: ORDER_NUMBER, store, now: NOW }),
    ).resolves.toBe('failed')
  })
})
