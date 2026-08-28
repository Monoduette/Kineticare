import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import KoszonjukPage, { metadata } from '../app/(frontend)/fizetes/koszonom/page'
import {
  ThankYouMissingOrder,
  ThankYouNotFound,
  ThankYouPaid,
  ThankYouTimeout,
  ThankYouUnauthorized,
  ThankYouView,
} from '../components/checkout/ThankYouView'

/**
 * REGRESSZIÓ-ŐR: a köszönőoldal NEM dönthet szerver-oldali hitelesítésből.
 * A `/fizetes/koszonom` a Barion `redirectUrl`-je
 * (src/lib/checkout/start-checkout.ts), tehát MINDEN fizetés kereszt-oldali,
 * top-level GET-navigációval érkezik ide a `secure.barion.com`-ról. Egy ilyen
 * kérés `Origin` fejlécet nem küld, `Sec-Fetch-Site: cross-site`-ot viszont
 */

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
    expect(html).toContain('/elfelejtett-jelszo?returnUrl=')
    expect(html).toContain('/belepes?returnUrl=')
    expect(html).toContain('%2Fkurzusaim')
    expect(html).toContain('Kérem a visszaállító linket')
    expect(html).toContain('Ha a levél néhány perc múlva sem jön')
    expect(html).not.toContain('/fizetes/koszonom')
    expect(html).toContain('/kurzusok')
    expect(html).not.toMatch(/kc-button[^>]*href="\/kurzusok"/)
  })

  it('a jelszó-beállító kérés az elsődleges gomb, a Belépés másodlagos (vendégnek nincs jelszava)', () => {
    const html = markup()
    const resetIndex = html.indexOf('href="/elfelejtett-jelszo?returnUrl=')
    const signInIndex = html.indexOf('href="/belepes?returnUrl=')
    expect(resetIndex).toBeGreaterThan(-1)
    expect(signInIndex).toBeGreaterThan(resetIndex)
    expect(html).toMatch(/kc-button(?![^>]*kc-button--secondary)[^>]*href="\/elfelejtett-jelszo/)
    expect(html).toMatch(/kc-button--secondary[^>]*href="\/belepes/)
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
