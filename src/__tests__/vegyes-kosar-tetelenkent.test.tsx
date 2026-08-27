import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createElement, Fragment, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CartView } from '../components/checkout/CartView'
import {
  CART_FREE_LABEL,
  cartItemNote,
  cartScopeNote,
  cartStore,
  cartSummary,
  type CartItem,
  type CartState,
} from '../lib/cart'
import { COURSE_BASE_PATH, courseCtaHref } from '../lib/course-url'
import { ARCHIVED_COURSE_NOTE, UNAVAILABLE_COURSE_NOTE, checkoutHref } from '../lib/courses'
import { ctaEntry, ctaLabel } from '../lib/cta-vocabulary'
import { formatPriceHuf } from '../lib/format-price'

/**
 * ŐR — VEGYES KOSÁR: TÉTELENKÉNTI CSELEKVÉS.
 * 2026-08-17-én a kosár helyesen ismerte fel a négy tétel-állapotot
 * (`paid` / `free` / `archived` / `unavailable`), de a következtetése túl
 * szigorú volt: EGYETLEN nem vásárolható tétel elvette az EGÉSZ kosár
 * fizetés-gombját. Három megvehető kurzus mellett egy archivált tétel
 */

const REPO = fileURLToPath(new URL('..', import.meta.url))
const olvas = (relativUt: string): string => readFileSync(join(REPO, relativUt), 'utf8')

/** Kommentek NÉLKÜLI forrás. */
const kommentNelkul = (forras: string): string =>
  forras.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// ───────────────────────────────────────────────────────────────────────────
// FIXTÚRÁK — az árak SZÁNDÉKOSAN különböznek (fejkomment b) pont)
// ───────────────────────────────────────────────────────────────────────────

const MEGVEHETO: CartItem = {
  productId: 42,
  sku: 'Kézrehabilitációs alapkurzus',
  slug: 'kez-rehabilitacio',
  shortDescription: 'Nyolc hetes otthoni program.',
  priceHuf: 19990,
  isFree: false,
  availability: 'paid',
}

const ARCHIVALT: CartItem = {
  productId: 71,
  sku: 'Régi csuklókurzus',
  slug: 'regi-csuklokurzus',
  shortDescription: 'Korábbi program.',
  // Az archivált terméknek VAN eltárolt ára: pontosan ez a szám nem kerülhet
  // sem a sorba, sem a végösszegbe.
  priceHuf: 34990,
  isFree: false,
  availability: 'archived',
}

const INGYENES: CartItem = {
  productId: 61,
  sku: 'SOS Kézrelax villámkurzus',
  slug: 'sos-kezrelax-villamkurzus',
  shortDescription: 'Öt perc, azonnal.',
  priceHuf: null,
  isFree: true,
  availability: 'free',
}

const HIBAS_ARU: CartItem = {
  productId: 53,
  sku: 'Beállítatlan árú kurzus',
  slug: 'beallitatlan-ar',
  shortDescription: null,
  priceHuf: null,
  isFree: false,
  availability: 'unavailable',
}

/** A vegyes kosár: 1 megvehető + 1 archivált + 1 ingyenes. */
const VEGYES: CartItem[] = [MEGVEHETO, ARCHIVALT, INGYENES]

function renderKosar(items: CartItem[], alreadyPurchasedProductId: number | null = null): string {
  const pillanatkep: CartState = { items }
  const spy = vi.spyOn(cartStore, 'getServerSnapshot').mockReturnValue(pillanatkep)
  try {
    return renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        createElement(CartView, { alreadyPurchasedProductId, initialItem: null }),
      ),
    )
  } finally {
    spy.mockRestore()
  }
}

/** Egy `<li class="kc-cart__item">` sor kivágása a HTML-ből, a tétel neve szerint. */
function sor(html: string, nev: string): string {
  const darabok = html.split('<li class="kc-cart__item">')
  const talalat = darabok.find((darab) => darab.includes(nev))
  expect(talalat, `Nincs kosársor ehhez a tételhez: ${nev}`).toBeDefined()
  return (talalat as string).split('</li>')[0]
}

const renderElem = (node: ReactNode): string =>
  renderToStaticMarkup(createElement(Fragment, null, node))

afterEach(() => {
  vi.restoreAllMocks()
})

// 1. A DÖNTŐ BIZONYÍTÉK — a vegyes kosár kirenderelve

describe('VEGYES KOSÁR (1 megvehető + 1 archivált + 1 ingyenes)', () => {
  it('mindhárom tétel a kosárban marad (a néma eldobás elrejtené, mi történt)', () => {
    const html = renderKosar(VEGYES)
    for (const tetel of VEGYES) {
      expect(html, `hiányzó kosársor: ${tetel.sku}`).toContain(tetel.sku)
    }
  })

  it('a MEGVEHETŐ tétel fizetés-útja ÉL, és a megvehető termékre mutat', () => {
    const html = renderKosar(VEGYES)
    expect(
      html,
      'A régi szabály szerint egyetlen archivált tétel elvette volna ezt a gombot.',
    ).toContain(`href="${checkoutHref(MEGVEHETO.productId)}"`)
    expect(html).toContain(ctaLabel('cart-to-checkout'))
  })

  it('a fizetés-út SOHA nem a nem vásárolható vagy az ingyenes tételre megy', () => {
    const html = renderKosar(VEGYES)
    expect(html).not.toContain(`href="${checkoutHref(ARCHIVALT.productId)}"`)
    expect(html).not.toContain(`href="${checkoutHref(INGYENES.productId)}"`)
  })

  it('az ARCHIVÁLT tétel a SAJÁT SORÁBAN kapja a magyarázatát', () => {
    const archivaltSor = sor(renderKosar(VEGYES), ARCHIVALT.sku)
    expect(archivaltSor).toContain(ARCHIVED_COURSE_NOTE)
    expect(archivaltSor).toContain('kc-cart__note')
  })

  it('az ARCHIVÁLT tétel sorában NINCS ár (a látogató ne higgye, hogy fizet érte)', () => {
    const archivaltSor = sor(renderKosar(VEGYES), ARCHIVALT.sku)
    expect(
      archivaltSor,
      'Az archivált tétel eltárolt ára sehol nem jelenhet meg a kosárban.',
    ).not.toContain(formatPriceHuf(ARCHIVALT.priceHuf as number))
    expect(archivaltSor).not.toContain('kc-price-tag')
  })

  it('az ARCHIVÁLT tételnek van SAJÁT cselekvése: kivehető, a nevével azonosítva', () => {
    const archivaltSor = sor(renderKosar(VEGYES), ARCHIVALT.sku)
    expect(archivaltSor).toContain(ctaLabel('cart-remove-item'))
    // SC 2.4.4: három kivevő gomb van a lapon, a nevük nem lehet azonos.
    expect(archivaltSor).toMatch(
      new RegExp(
        `${ctaLabel('cart-remove-item')}[^<]*<span[^>]*kc-visually-hidden[^>]*>: ${ARCHIVALT.sku}`,
      ),
    )
  })

  it('az INGYENES tétel a saját sorában kapja a SAJÁT, MŰKÖDŐ útját', () => {
    const ingyenesSor = sor(renderKosar(VEGYES), INGYENES.sku)
    const igenylesUt = courseCtaHref({ id: INGYENES.productId, slug: INGYENES.slug })
    expect(ingyenesSor).toContain(`href="${igenylesUt}"`)
    expect(ingyenesSor).toContain(ctaLabel('free-course-claim'))
  })

  it('az INGYENES tétel NEM olvad össze a „nem vásárolható" állapottal', () => {
    const ingyenesSor = sor(renderKosar(VEGYES), INGYENES.sku)
    expect(ingyenesSor).toContain(CART_FREE_LABEL)
    expect(ingyenesSor, 'az ingyenes tétel nem hiba').not.toContain(ARCHIVED_COURSE_NOTE)
    expect(ingyenesSor).not.toContain(UNAVAILABLE_COURSE_NOTE)
    expect(cartItemNote(INGYENES)).toBeNull()
  })

  it('a VÉGÖSSZEG pontosan annyi, amennyit a következő lépés levon', () => {
    const html = renderKosar(VEGYES)
    expect(html).toContain(`Végösszeg: <strong>${formatPriceHuf(MEGVEHETO.priceHuf as number)}`)
    // A hazugság három ismert alakja: a rossz tétel ára beszáll, a „0 Ft"
    // visszajön, vagy a két ár összege jelenik meg.
    expect(html).not.toContain(formatPriceHuf(ARCHIVALT.priceHuf as number))
    expect(html).not.toContain('0 Ft')
    expect(html).not.toContain(
      formatPriceHuf((MEGVEHETO.priceHuf as number) + (ARCHIVALT.priceHuf as number)),
    )
  })

  it('a sáv KIMONDJA, mire vonatkozik a fizetés, és mire nem', () => {
    const html = renderKosar(VEGYES)
    const osszegzes = cartSummary({ items: VEGYES })
    const hatokor = cartScopeNote(osszegzes)
    expect(hatokor, 'vegyes kosárban kötelező a hatókör-mondat').not.toBeNull()
    expect(html).toContain(hatokor as string)
    expect(hatokor as string).toContain(MEGVEHETO.sku)
    expect(html).toContain('kc-cart__scope')
  })

  it('a hatókör-mondat a VÉGÖSSZEG UTÁN és a gomb ELŐTT áll (olvasási sorrend)', () => {
    const html = renderKosar(VEGYES)
    const hatokor = cartScopeNote(cartSummary({ items: VEGYES })) as string
    const vegosszegIndex = html.indexOf('Végösszeg:')
    const hatokorIndex = html.indexOf(hatokor)
    const gombIndex = html.indexOf(`href="${checkoutHref(MEGVEHETO.productId)}"`)
    expect(vegosszegIndex).toBeGreaterThanOrEqual(0)
    expect(hatokorIndex).toBeGreaterThan(vegosszegIndex)
    expect(gombIndex).toBeGreaterThan(hatokorIndex)
  })

  it('a lapon PONTOSAN EGY elsődleges gomb áll (GOV.UK: Button)', () => {
    const html = renderKosar(VEGYES)
    const elsodlegesek = html.match(/kc-button--primary/g) ?? []
    expect(
      elsodlegesek.length,
      '„Avoid using multiple default buttons on a single page." — a sorok ' +
        'cselekvései másodlagos és ghost súlyt kapnak.',
    ).toBe(1)
    expect(ctaEntry('cart-to-checkout').weight).toBe('primary')
    expect(ctaEntry('free-course-claim').weight).toBe('secondary')
    expect(ctaEntry('cart-remove-item').weight).toBe('ghost')
  })

  it('LETILTOTT gomb sehol nem jelenik meg a vegyes kosárban', () => {
    const html = renderKosar(VEGYES)
    expect(html).not.toContain('disabled')
    expect(html).not.toContain('aria-disabled')
  })

  it('BEJELENTKEZÉS NÉLKÜL is a pénztárra visz, nem belépésre kényszerít', () => {
    const html = renderKosar(VEGYES)
    expect(html).toContain(`href="${checkoutHref(MEGVEHETO.productId)}"`)
    expect(html).toContain(ctaLabel('cart-to-checkout'))
    expect(html).not.toContain('Belépés a fizetéshez')
    expect(html).not.toContain('/belepes?returnUrl=')
    expect(html).not.toContain(encodeURIComponent(checkoutHref(ARCHIVALT.productId)))
  })

  it('már megvett céltételnél a sáv a lejátszóra visz, nem a pénztárba', () => {
    const html = renderKosar(VEGYES, MEGVEHETO.productId)
    expect(html).toContain(`href="/kurzusaim/${MEGVEHETO.productId}"`)
    expect(html).toContain(ctaLabel('course-start'))
    expect(html).not.toContain(ctaLabel('cart-to-checkout'))
    expect(html).not.toContain(`href="${checkoutHref(MEGVEHETO.productId)}"`)
  })
})

// 2. AZ ÁLLAPOTGÉP — a `cartSummary` a vegyes kosáron

describe('cartSummary — a vegyes kosár állapotgépe', () => {
  it('a POZITÍV oldal dönt: van megvehető tétel, tehát `amount`', () => {
    const osszegzes = cartSummary({ items: VEGYES })
    expect(osszegzes.kind).toBe('amount')
    expect(osszegzes.target).toBe(MEGVEHETO)
    expect(osszegzes.payable).toEqual([MEGVEHETO])
    expect(osszegzes.blocked).toEqual([ARCHIVALT])
    expect(osszegzes.free).toEqual([INGYENES])
  })

  it('a fizetés által NEM fedezett tételek névvel megvannak', () => {
    const osszegzes = cartSummary({ items: VEGYES })
    expect(osszegzes.uncovered).toEqual([ARCHIVALT, INGYENES])
  })

  it('a sorrend nem számít: a megvehető tétel akkor is cél, ha nem ő az első', () => {
    const osszegzes = cartSummary({ items: [ARCHIVALT, INGYENES, MEGVEHETO] })
    expect(osszegzes.kind).toBe('amount')
    expect(osszegzes.target).toBe(MEGVEHETO)
    expect(osszegzes.totalHuf).toBe(MEGVEHETO.priceHuf)
  })

  it('a hiányos ár-konfigurációjú tétel is csak a saját sorát blokkolja', () => {
    const osszegzes = cartSummary({ items: [MEGVEHETO, HIBAS_ARU] })
    expect(osszegzes.kind).toBe('amount')
    expect(osszegzes.target).toBe(MEGVEHETO)
    expect(osszegzes.blocked).toEqual([HIBAS_ARU])
    expect(cartItemNote(HIBAS_ARU)).toBe(UNAVAILABLE_COURSE_NOTE)
  })

  it('EGYETLEN vásárolható tétel sincs: marad a MAI, blokkolt állapot', () => {
    const osszegzes = cartSummary({ items: [ARCHIVALT, HIBAS_ARU] })
    expect(osszegzes.kind).toBe('blocked')
    expect(osszegzes.target).toBeNull()
    expect(osszegzes.totalLabel, 'nincs kimondható végösszeg').toBeNull()
    const html = renderKosar([ARCHIVALT, HIBAS_ARU])
    expect(html).not.toContain('Végösszeg')
    expect(html).not.toContain(ctaLabel('cart-to-checkout'))
    // A továbblépés viszont KÖTELEZŐ (Baymard: 30% máshol keres tovább).
    expect(html).toContain(`href="${COURSE_BASE_PATH}"`)
    expect(html).toContain(ctaLabel('course-list-open'))
  })

  it('CSUPA INGYENES kosár: nincs pénztár, a sorok viszik tovább a látogatót', () => {
    const osszegzes = cartSummary({ items: [INGYENES] })
    expect(osszegzes.kind).toBe('free')
    expect(osszegzes.totalLabel).toBe(CART_FREE_LABEL)
    const html = renderKosar([INGYENES])
    expect(html).toContain(
      `href="${courseCtaHref({ id: INGYENES.productId, slug: INGYENES.slug })}"`,
    )
    expect(html).not.toContain(ctaLabel('cart-to-checkout'))
  })

  it('INGYENES + ARCHIVÁLT: az ingyenes útja él, az archivált magyarázatot kap', () => {
    const html = renderKosar([INGYENES, ARCHIVALT])
    expect(html).toContain(ctaLabel('free-course-claim'))
    expect(html).toContain(ARCHIVED_COURSE_NOTE)
    expect(html).not.toContain(ctaLabel('cart-to-checkout'))
    expect(html).not.toContain(formatPriceHuf(ARCHIVALT.priceHuf as number))
  })

  it('a hatókör-mondat CSAK ott jelenik meg, ahol van mit kimondani', () => {
    // Egyetlen megvehető tétel: a fizetés a kosár egészét fedi, nincs mondat.
    expect(cartScopeNote(cartSummary({ items: [MEGVEHETO] }))).toBeNull()
    expect(cartScopeNote(cartSummary({ items: [] }))).toBeNull()
    expect(cartScopeNote(cartSummary({ items: [ARCHIVALT] }))).toBeNull()
    expect(cartScopeNote(cartSummary({ items: [INGYENES] }))).toBeNull()
    expect(cartScopeNote(cartSummary({ items: VEGYES }))).not.toBeNull()
  })

  it('KÉT megvehető tétel: a végösszeg NEM ad össze többet, mint amit a pénztár levon', () => {
    // A `/penztar` szerződése szerint egy termék = egy vásárlás (a lap csak a
    // `?termek={id}` query-t látja), ezért a kosár sem írhat ki nagyobb számot.
    const masodik: CartItem = { ...MEGVEHETO, productId: 43, sku: 'Másik kurzus', priceHuf: 9990 }
    const osszegzes = cartSummary({ items: [MEGVEHETO, masodik] })
    expect(osszegzes.totalHuf).toBe(MEGVEHETO.priceHuf)
    expect(osszegzes.totalHuf).not.toBe(
      (MEGVEHETO.priceHuf as number) + (masodik.priceHuf as number),
    )
    const html = renderKosar([MEGVEHETO, masodik])
    expect(html).not.toContain(
      formatPriceHuf((MEGVEHETO.priceHuf as number) + (masodik.priceHuf as number)),
    )
    expect(cartScopeNote(osszegzes), 'itt is ki kell mondani, mire megy a fizetés').not.toBeNull()
  })
})

// 3. A MIKROSZÖVEG — natív magyar, töltelék gondolatjel nélkül

describe('A hatókör-mondat magyar mikroszöveg-szabály szerinti', () => {
  const hatokor = cartScopeNote(cartSummary({ items: VEGYES })) as string

  it('nincs benne töltelék gondolatjel és nincs „Kérjük"', () => {
    const kvirt = String.fromCharCode(0x2014)
    const gondolatjel = String.fromCharCode(0x2013)
    expect(hatokor).not.toContain(kvirt)
    expect(hatokor).not.toContain(gondolatjel)
    expect(hatokor).not.toContain('Kérjük')
  })

  it('TEGEZŐ, egyes szám második személyű magyarázat (P-1b/P-1e)', () => {
    expect(hatokor).toContain('fizetsz')
  })

  it('kimondja azt is, amiért a látogató NEM fizet', () => {
    expect(hatokor).toContain('A kosár többi tételéért nem.')
  })

  it('megnevezi a fizetett kurzust (nem általánosságban beszél)', () => {
    expect(hatokor).toContain(MEGVEHETO.sku)
  })
})

// 4. A FELIRATOK — mind a §3.2 szótárból, literál nélkül

describe('CartView — a tételenkénti cselekvések feliratai is a szótárból jönnek', () => {
  const forras = kommentNelkul(olvas('components/checkout/CartView.tsx'))

  it('a komponens egyetlen CTA-feliratot sem ír ki literálként', () => {
    for (const akcio of [
      'cart-to-checkout',
      'cart-remove-item',
      'free-course-claim',
      'course-list-open',
      'course-start',
    ] as const) {
      expect(forras, `literál felirat a komponensben: ${ctaLabel(akcio)}`).not.toContain(
        ctaLabel(akcio),
      )
    }
  })

  it('a hatókör-mondat a `cart.ts`-ből jön, nem a JSX-ből', () => {
    expect(forras).toContain('cartScopeNote')
    expect(forras).not.toContain('Most csak ezért a kurzusért fizetsz')
  })
})

// 5. MÉRÉS — kontraszt, sorhossz, 320 px-es reflow az ÚJ elemeken

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

function tokenTerkep(): Map<string, string> {
  const forras = kommentNelkul(olvas('app/(frontend)/styles/tokens.css'))
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

function szabalyTorzs(css: string, szelektor: string): string {
  const minta = new RegExp(
    `(^|[,}])\\s*${szelektor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(,[^{]*)?\\{([^}]*)\\}`,
    'm',
  )
  const talalat = minta.exec(kommentNelkul(css))
  return talalat === null ? '' : talalat[3]
}

function pixel(ertek: string): number {
  const rem = /^([\d.]+)rem$/.exec(ertek.trim())
  if (rem !== null) {
    return Number.parseFloat(rem[1]) * 16
  }
  const px = /^([\d.]+)px$/.exec(ertek.trim())
  return px === null ? Number.NaN : Number.parseFloat(px[1])
}

describe('Mért kontraszt, sorhossz és reflow az ÚJ kosár-elemeken', () => {
  const tokenek = tokenTerkep()
  const checkoutCss = olvas('app/(frontend)/checkout.css')
  const ui = olvas('app/(frontend)/styles/ui.css')

  const szin = (nev: string): RGB => {
    const ertek = tokenek.get(nev)
    expect(ertek, `Hiányzó vagy feloldhatatlan token: ${nev}`).toMatch(/^#[0-9a-fA-F]{3,8}$/)
    return hexRgb(ertek as string)
  }

  it('a hatókör-mondat TELJES tintával áll a lapháttéren: ≥ 4,5:1 (SC 1.4.3)', () => {
    const torzs = szabalyTorzs(checkoutCss, '.kc-cart__scope')
    expect(torzs, 'Hiányzik a `.kc-cart__scope` szabály.').not.toBe('')
    expect(torzs, 'Pénzről szóló állítás, nem lábjegyzet: nem tompítható.').toContain(
      'color: var(--kc-color-text)',
    )
    const mert = arany(szin('--kc-color-text'), szin('--kc-color-surface'))
    expect(mert, `mért ${mert.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
  })

  it('a hatókör-mondat a HÁROM méret-token egyikén áll', () => {
    const torzs = szabalyTorzs(checkoutCss, '.kc-cart__scope')
    expect(torzs).toMatch(/font-size:\s*var\(--kc-font-[lms]\)/)
  })

  it('a hatókör-mondat FOLYÓSZÖVEG marad (soha nem flex, soha nem grid)', () => {
    // A repó megtörtént csapdája: a `.kc-appointment__consent-label` `display:
    // flex`-től öt hasábra esett szét (107 px túlcsordulás 320 px-en, SC 1.4.10).
    const torzs = szabalyTorzs(checkoutCss, '.kc-cart__scope')
    expect(torzs).not.toContain('display: flex')
    expect(torzs).not.toContain('display: grid')
    expect(torzs).not.toContain('display:flex')
    expect(torzs).not.toContain('display:grid')
  })

  it('a hatókör-mondat sorhossza a 45–80 karakteres sávban marad (SC 1.4.8)', () => {
    // A repó MÉRT állandója (tokens.css „Mérték" szakasza, fontTools/hmtx a
    // Nunito Sans wght 400 példányán, n = 5981 karakter): 0,4542 em/karakter.
    const ATLAG_KARAKTER_EM = 0.4542
    const torzs = szabalyTorzs(checkoutCss, '.kc-cart__scope')
    const merteK = pixel(
      tokenek.get(/max-width:\s*var\((--kc-measure[a-z-]*)\)/.exec(torzs)?.[1] ?? '') ?? '',
    )
    expect(merteK, 'a hatókör-mondatnak sorhossz-korlátja kell').toBeGreaterThan(0)
    const karakter = merteK / (ATLAG_KARAKTER_EM * 18)
    expect(karakter, `mért sorhossz: ${karakter.toFixed(1)} karakter`).toBeGreaterThanOrEqual(45)
    expect(karakter, `mért sorhossz: ${karakter.toFixed(1)} karakter`).toBeLessThanOrEqual(80)
  })

  it('a sor CSELEKVÉS-CSOPORTJA tördelhető: 320 px-en nem csordul túl (SC 1.4.10)', () => {
    const sorTorzs = szabalyTorzs(checkoutCss, '.kc-cart__row')
    const cselekvesTorzs = szabalyTorzs(checkoutCss, '.kc-cart__actions')
    expect(cselekvesTorzs, 'Hiányzik a `.kc-cart__actions` szabály.').not.toBe('')
    expect(sorTorzs, 'a sor tördelése nélkül a két gomb kilógna').toContain('flex-wrap: wrap')
    expect(cselekvesTorzs).toContain('flex-wrap: wrap')

    // A MÉRÉS: 320 px nézetablak, 2 × oldal-margó, 2 × kártya-belső.
    const oldalMargo = pixel(tokenek.get('--kc-container-gutter') ?? '')
    const kartyaBelso = pixel(
      tokenek.get(
        /padding:\s*var\((--kc-space-\d)\)/.exec(szabalyTorzs(ui, '.kc-card--padded'))?.[1] ?? '',
      ) ?? '',
    )
    const gombBelso = pixel(
      tokenek.get(
        /padding:\s*var\(--kc-space-\d\)\s+var\((--kc-space-\d)\)/.exec(
          szabalyTorzs(ui, '.kc-button--sm'),
        )?.[1] ?? '',
      ) ?? '',
    )
    for (const ertek of [oldalMargo, kartyaBelso, gombBelso]) {
      expect(ertek).toBeGreaterThan(0)
    }
    const sorSav = 320 - 2 * oldalMargo - 2 * kartyaBelso
    expect(sorSav, 'a kártya belső sávja 320 px-en').toBe(224)

    // Felső becslés a legszélesebb karakterrel (0,6 em), 18 px-es törzsön.
    const LEGSZELESEBB_KARAKTER_EM = 0.6
    for (const akcio of ['free-course-claim', 'cart-remove-item'] as const) {
      const felirat = ctaLabel(akcio)
      const leghosszabbSzo = felirat
        .split(/\s+/)
        .reduce((leghosszabb, szo) => (szo.length > leghosszabb.length ? szo : leghosszabb), '')
      const gombSzelesseg =
        leghosszabbSzo.length * LEGSZELESEBB_KARAKTER_EM * 18 + 2 * gombBelso + 4
      expect(
        gombSzelesseg,
        `„${leghosszabbSzo}" felső becsléssel ${gombSzelesseg.toFixed(0)} px, a sor sávja ${sorSav} px`,
      ).toBeLessThan(sorSav)
    }
  })

  it('a sor-gombok érintőcélja is ≥ 44 px (SC 2.5.5)', () => {
    const alap = szabalyTorzs(ui, '.kc-button')
    const magassag = pixel(/min-height:\s*([^;]+);/.exec(alap)?.[1] ?? '')
    expect(magassag, `mért min-height: ${magassag} px`).toBeGreaterThanOrEqual(44)
    // A `--sm` változat CSAK a belső margót szűkíti, a min-height-et nem.
    expect(szabalyTorzs(ui, '.kc-button--sm')).not.toContain('min-height')
  })
})

// 6. A KIRENDERELT SOROK SZERKEZETE — a cselekvés-csoport tényleg ott van

describe('A sor szerkezete a kirenderelt HTML-ben', () => {
  it('minden sor kap cselekvés-csoportot', () => {
    const html = renderKosar(VEGYES)
    expect((html.match(/kc-cart__actions/g) ?? []).length).toBe(VEGYES.length)
  })

  it('az ingyenes soron KÉT cselekvés áll, a többin egy', () => {
    const html = renderKosar(VEGYES)
    const gombokSorban = (nev: string): number =>
      (sor(html, nev).match(/class="kc-button/g) ?? []).length
    expect(gombokSorban(INGYENES.sku)).toBe(2)
    expect(gombokSorban(MEGVEHETO.sku)).toBe(1)
    expect(gombokSorban(ARCHIVALT.sku)).toBe(1)
  })

  it('a `CartRow` a valódi komponensből renderel (nem tesztbeli másolatból)', () => {
    // Ha a nézet szerkezete elcsúszna a `CartView`-tól, ez a teszt hazudna.
    const kozvetlen = renderElem(createElement(CartView, { initialItem: null }))
    expect(kozvetlen).toContain('kc-cart-empty')
  })
})
