import { readFileSync } from 'node:fs'

import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import KoszonjukPage, { metadata } from '../app/(frontend)/fizetes/koszonom/page'
import {
  ThankYouFailed,
  ThankYouMissingOrder,
  ThankYouNotFound,
  ThankYouPaid,
  ThankYouRefunded,
  ThankYouTimeout,
  ThankYouUnauthorized,
  ThankYouView,
} from '../components/checkout/ThankYouView'
import { ctaLabel } from '../lib/cta-vocabulary'

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
    expect(html).toContain('role="status"')
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
    renderToStaticMarkup(createElement(ThankYouFailed, { productId: 42 }))

  it('a régi, feltétlen állítás eltűnt', () => {
    expect(html()).not.toContain('Semmi sem került levonásra')
    expect(html()).not.toContain('újrapróbálhatod bármikor')
  })

  it('a jóváhagyott szöveg áll ott, szó szerint', () => {
    expect(html()).toContain(
      'A fizetésedet a bank elutasította vagy megszakította. Ilyenkor általában nem történik levonás. Ha a bankod később mégis jóváhagyja a fizetést, automatikusan érvényesítjük, és e-mailben visszaigazoljuk. Újra is próbálhatod a fizetést.',
    )
  })

  it('az újrapróbálás útja és a kapcsolat változatlan', () => {
    expect(html()).toContain('href="/penztar?termek=42"')
    expect(html()).toContain(ctaLabel('retry'))
    expect(html()).toContain('href="/kapcsolat"')
    expect(html()).toContain('kc-thankyou--failed')
    expect(html()).toContain('role="alert"')
  })

  it('ismeretlen termék-id esetén a kurzuslista a biztonságos cél', () => {
    const listaHtml = renderToStaticMarkup(createElement(ThankYouFailed, { productId: null }))
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
    const magassag = remPx(
      /min-height:\s*([^;]+);/.exec(szabalyTorzs(ui, '.kc-button'))?.[1] ?? '',
    )
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
