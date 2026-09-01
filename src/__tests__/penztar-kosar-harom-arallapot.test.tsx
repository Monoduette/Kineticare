import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getPayload } from 'payload'
import { createElement, Fragment, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CartView } from '../components/checkout/CartView'
import { CheckoutForm } from '../components/checkout/CheckoutForm'
import {
  CART_FREE_LABEL,
  cartItemAvailability,
  cartItemNote,
  cartStore,
  cartSummary,
  cartTotalHuf,
  type CartItem,
  type CartState,
} from '../lib/cart'
import { courseCtaHref, courseHref } from '../lib/course-url'
import {
  ARCHIVED_COURSE_NOTE,
  UNAVAILABLE_COURSE_NOTE,
  checkoutHref,
  coursePriceHuf,
  isFreeCourse,
  isPaidCourse,
} from '../lib/courses'
import { ctaEntry, ctaLabel } from '../lib/cta-vocabulary'
import { formatPriceHuf } from '../lib/format-price'
import type { Product, User } from '../payload-types'

/**
 * ŐR — A HÁROM ÁR-ÁLLAPOT A PÉNZTÁRON ÉS A KOSÁRBAN.
 * A `resolveCourseCta` (src/lib/courses.ts) 2026-08-16 óta HÁROM ár-állapotot
 * ismer: `isFreeCourse` (tudatosan ingyenes), `isPaidCourse` (ÉRVÉNYES ára van)
 * és a kettő közötti HIÁNYOS KONFIGURÁCIÓ. A kurzusoldal eszerint működik, a
 * pénztár és a kosár viszont csak KÉT állapotot ismert: „ingyenes" és „minden
 */

vi.mock('payload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('payload')>()
  return { ...actual, getPayload: vi.fn() }
})

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}))

const getPayloadMock = vi.mocked(getPayload)

const REPO = fileURLToPath(new URL('..', import.meta.url))
const olvas = (relativUt: string): string => readFileSync(join(REPO, relativUt), 'utf8')

/** Kommentek NÉLKÜLI forrás — lásd a fejkomment a) pontját. */
const kommentNelkul = (forras: string): string =>
  forras.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// ───────────────────────────────────────────────────────────────────────────
// A VÁRT SZÖVEGEK ÉS FELIRATOK — LITERÁLKÉNT (fejkomment b) pont)
// ───────────────────────────────────────────────────────────────────────────

const VART = {
  nemVasarolhatoSzoveg:
    'Ez a kurzus jelenleg nem vásárolható meg. Nézd meg a többi kurzusunkat, vagy írj nekünk, ha kérdésed van.',
  /**
   * 2026-08-18: az archivált ág szövege a NEM VÁSÁROLHATÓ ággal EGYEZŐRE
   * változott. A korábbi „Ez a kurzus jelenleg nem vásárolható." egyetlen
   * mondat volt, továbblépés nélkül — NN/g, Error-Message Guidelines: „Merely
   * stating the problem is also not enough; offer some potential remedies."
   * (https://www.nngroup.com/articles/error-message-guidelines/). A látogató
   * szemszögéből a két állapot ugyanaz, ezért ugyanazt is olvassa
   * (WCAG 2.2 · 3.2.4).
   */
  archivaltTetelSzoveg:
    'Ez a kurzus jelenleg nem vásárolható meg. Nézd meg a többi kurzusunkat, vagy írj nekünk, ha kérdésed van.',
  kurzuslistaFelirat: 'Nézd meg a kurzusokat',
  penztarFelirat: 'Menj a pénztárhoz',
  kivetelFelirat: 'Kiveszem a kosárból',
  ingyenesIgenylesFelirat: 'Elindítom ingyen',
  ingyenesCimke: 'Ingyenes',
  /** A mai, HIBÁS feliratok — ezeknek el kell tűnniük a kosárból. */
  elgepeltPenztarFelirat: 'Tovább a penztárhoz',
  regiTorlesFelirat: 'Törlés',
} as const

// ───────────────────────────────────────────────────────────────────────────
// TERMÉK-FIXTÚRÁK
// ───────────────────────────────────────────────────────────────────────────

const alapTermek = {
  id: 42,
  sku: 'KURZUS-ALAP',
  slug: 'kez-rehabilitacio',
  shortDescription: 'Nyolc hetes otthoni program.',
  status: 'published',
  priceInHUF: 19990,
  priceInHUFEnabled: true,
} as unknown as Product

/**
 * A HÁROM (plusz egy) HIBÁS ÁR-KONFIGURÁCIÓ. Mind PUBLIKÁLT, tehát a látogató
 * elé kerülhet, és MINDEGYIKET elutasítja a checkout ár-kapuja.
 */
const HIBAS_ARU_TERMEKEK = [
  {
    nev: 'ár-pipa BE, az ár ÜRES (null)',
    termek: { ...alapTermek, id: 51, slug: 'ar-nelkul', priceInHUFEnabled: true, priceInHUF: null },
  },
  {
    nev: 'ár-pipa BE, az ár 0',
    termek: { ...alapTermek, id: 52, slug: 'nulla-ar', priceInHUFEnabled: true, priceInHUF: 0 },
  },
  {
    nev: 'ár-pipa BE, az ár NEGATÍV',
    termek: {
      ...alapTermek,
      id: 53,
      slug: 'negativ-ar',
      priceInHUFEnabled: true,
      priceInHUF: -1990,
    },
  },
  {
    nev: 'ár-pipa BEÁLLÍTATLAN (a szerkesztő hozzá sem nyúlt)',
    termek: {
      ...alapTermek,
      id: 54,
      slug: 'beallitatlan-pipa',
      priceInHUFEnabled: undefined,
      priceInHUF: 4990,
    },
  },
] as unknown as { nev: string; termek: Product }[]

const ingyenesTermek = {
  ...alapTermek,
  id: 61,
  slug: 'kez-villamkurzus',
  priceInHUF: null,
  priceInHUFEnabled: false,
} as unknown as Product

const archivaltTermek = {
  ...alapTermek,
  id: 71,
  slug: 'regi-kurzus',
  status: 'archived',
} as Product

const mockUser = {
  id: 7,
  email: 'vevo@example.test',
  name: 'Minta Mari',
  purchases: [],
} as unknown as User

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
  const { default: PenztarPage } = await import('../app/(frontend)/penztar/page')
  return PenztarPage({ searchParams: Promise.resolve(searchParams) })
}

async function renderKosarOldal(searchParams: Record<string, string | string[] | undefined>) {
  const { default: KosarPage } = await import('../app/(frontend)/kosar/page')
  return KosarPage({ searchParams: Promise.resolve(searchParams) })
}

function renderMarkup(node: ReactNode): string {
  return renderToStaticMarkup(createElement(Fragment, null, node))
}

/** Az elemfában megkeresi az adott komponens-típus első elemét. */
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

const termekParam = (product: Product): Record<string, string> => ({ termek: String(product.id) })

// 1. A PÉNZTÁR HARMADIK ÁR-ÁLLAPOTA — nincs díszlet-űrlap

describe('/penztar — hibás ár-konfiguráció: magyarázó állapot, nem beküldő űrlap', () => {
  for (const { nev, termek } of HIBAS_ARU_TERMEKEK) {
    describe(nev, () => {
      it('a checkout ár-kapuja szerint tényleg NEM eladható (a fixtúra igaz)', () => {
        // Ez a fixtúrát méri, nem a felületet: ha a `coursePriceHuf` egyszer
        // elfogadná ezeket az értékeket, az egész teszt tárgytalanná válna, és
        // ezt itt kell megtudni, nem élesben.
        expect(coursePriceHuf(termek)).toBeNull()
        expect(isPaidCourse(termek)).toBe(false)
        expect(isFreeCourse(termek)).toBe(false)
      })

      it('a CheckoutForm EGYÁLTALÁN NEM renderelődik', async () => {
        mockPayloadBehavior(termek)
        const tree = await renderPenztar(termekParam(termek))
        expect(
          findElement(tree, CheckoutForm),
          'A beküldést a checkout ár-kapuja garantáltan 400-zal elutasítja, tehát a megjelenített űrlap díszlet.',
        ).toBeNull()
      })

      it('a beküldhető felület egyetlen eleme sem kerül ki', async () => {
        mockPayloadBehavior(termek)
        const html = renderMarkup(await renderPenztar(termekParam(termek)))
        for (const nyom of [
          'id="kc-field-billingName"',
          'id="kc-field-guestEmail"',
          'id="kc-checkout-terms"',
          'type="submit"',
          '<form',
        ]) {
          expect(html, `a pénztár-űrlap nyoma a lapon: ${nyom}`).not.toContain(nyom)
        }
      })

      it('a magyarázat kimondja az OKOT és EGY továbblépést kínál', async () => {
        mockPayloadBehavior(termek)
        const html = renderMarkup(await renderPenztar(termekParam(termek)))
        expect(html).toContain(VART.nemVasarolhatoSzoveg)
        expect(html).toContain('class="kc-cart-empty"')
        expect(html).toContain('role="status"')
        expect(html).toContain('<h1>Pénztár</h1>')
        expect(html).toContain('href="/kurzusok"')
        expect(html).toContain(VART.kurzuslistaFelirat)
        // GOV.UK: egy fő cselekvés a lapon.
        expect([...html.matchAll(/class="[^"]*kc-button/g)]).toHaveLength(1)
      })

      it('VENDÉGKÉNT (bejelentkezés nélkül) ugyanez az állapot fut', async () => {
        mockPayloadBehavior(termek, null)
        const html = renderMarkup(await renderPenztar(termekParam(termek)))
        expect(html).toContain(VART.nemVasarolhatoSzoveg)
        expect(html).not.toContain('type="submit"')
      })
    })
  }

  it('a magyarázó mondat a courses.ts EGYETLEN forrásából jön', () => {
    expect(UNAVAILABLE_COURSE_NOTE).toBe(VART.nemVasarolhatoSzoveg)
  })
})

// 2. POZITÍV KONTROLL — az ÉRVÉNYES árú termék útja sértetlen

describe('/penztar — az érvényes árú termék űrlapja változatlan', () => {
  it('a CheckoutForm a helyes proppal renderelődik', async () => {
    mockPayloadBehavior(alapTermek)
    const form = findElement(await renderPenztar(termekParam(alapTermek)), CheckoutForm)
    expect(
      form,
      'Ha a kapu az érvényes árú terméket is elfogja, a webshopban SEMMIT nem lehet megvenni. Ez a legveszélyesebb regresszió ebben a körben.',
    ).not.toBeNull()
    const props = (form as ReactElement).props as {
      product: { id: number; priceHuf: number | null; isFree: boolean }
    }
    expect(props.product.id).toBe(alapTermek.id)
    expect(props.product.priceHuf).toBe(19990)
    expect(props.product.isFree).toBe(false)
  })

  it('a magyarázó állapot NEM jelenik meg az érvényes árú terméken', async () => {
    mockPayloadBehavior(alapTermek)
    const html = renderMarkup(await renderPenztar(termekParam(alapTermek)))
    expect(html).not.toContain(VART.nemVasarolhatoSzoveg)
    expect(html).toContain('type="submit"')
  })

  it('az 1 Ft-os ár is ÉRVÉNYES ár (a kapu nem szigorúbb a kelleténél)', async () => {
    const egyForintos = { ...alapTermek, priceInHUF: 1 } as Product
    mockPayloadBehavior(egyForintos)
    expect(findElement(await renderPenztar(termekParam(egyForintos)), CheckoutForm)).not.toBeNull()
  })
})

// 3. A LAP FELIRATAI A SZÓTÁRBÓL JÖNNEK

describe('/penztar — a kurzuslista-felirat a §3.2 szótárból jön', () => {
  const oldal = kommentNelkul(olvas('app/(frontend)/penztar/page.tsx'))

  it('a szótári felirat és a literál egyezik', () => {
    expect(ctaLabel('course-list-open')).toBe(VART.kurzuslistaFelirat)
  })

  it('a lap NEM írja ki literálként a kurzuslista-feliratot', () => {
    expect(
      oldal,
      'A felirat literálként a lapra írva kikerülne a G-UI1 szótár-őr hatálya alól.',
    ).not.toContain(VART.kurzuslistaFelirat)
  })

  it('a korábbi, MÁSIK felirat ugyanerre a cselekvésre eltűnt (WCAG 3.2.4)', () => {
    expect(
      oldal,
      'Egy cselekvésre egy felirat: a „Válassz kurzust" és a „Nézd meg a kurzusokat" ugyanoda vitt.',
    ).not.toContain('Válassz kurzust')
  })
})

// 4. A KOSÁR-OLDAL AZ EGYETLEN IGAZSÁGFORRÁSBÓL KÉRDEZ

describe('/kosar — az „ingyenes" és a „vásárolható" kérdés forrása', () => {
  const oldal = kommentNelkul(olvas('app/(frontend)/kosar/page.tsx'))

  it('a lap az `isFreeCourse`-t hívja, nem inline másolatot', () => {
    expect(oldal).toContain('isFreeCourse(')
    expect(
      oldal,
      'A courses.ts fejkommentje kimondja: „Új fogyasztó is KIZÁRÓLAG innen kérdezze."',
    ).not.toContain('priceInHUFEnabled === false')
  })

  it('a lap a HÁROM állapotot állítja be a kosár-tételen', () => {
    expect(oldal).toContain('isPaidCourse(')
    expect(oldal).toContain('availability')
  })

  it('már megvett tételnél a nézet megkapja a termék-id-t, nem csak egy zászlót', () => {
    expect(oldal).toContain('alreadyPurchasedProductId')
    expect(oldal).toContain('myCoursePlayerHref')
  })
})

// 5. A KOSÁR HÁROM ÁLLAPOTA — a KIRENDERELT kimeneten mérve

/**
 * A `CartView` a `cartStore` SZERVER-pillanatképéből olvas, amikor a
 * `renderToStaticMarkup` futtatja (`useSyncExternalStore` szerződése). Ezt a
 * pillanatképet cseréljük ki: így a kosár tartalma determinisztikus, és nem
 * kell böngésző-környezetet emulálni.
 */
function kosarralRenderel(
  items: CartItem[],
  options: { alreadyPurchasedProductId?: number | null } = {},
): string {
  const pillanatkep: CartState = { items }
  const spy = vi.spyOn(cartStore, 'getServerSnapshot').mockReturnValue(pillanatkep)
  try {
    return renderMarkup(
      createElement(CartView, {
        alreadyPurchasedProductId: options.alreadyPurchasedProductId ?? null,
        initialItem: items[0] ?? null,
      }),
    )
  } finally {
    spy.mockRestore()
  }
}

/** A kosár-oldal SZERVER-oldali tétel-építése (a valódi lapon átfutva). */
async function kosarTetel(product: Product): Promise<CartItem | null> {
  mockPayloadBehavior(product)
  const tree = await renderKosarOldal(termekParam(product))
  const view = findElement(tree, CartView)
  return view === null ? null : (view.props as { initialItem: CartItem | null }).initialItem
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('/kosar — ARCHIVÁLT tétel: nincs pénztár-gomb, van magyarázat', () => {
  it('a kosár-oldal archiváltként jelöli meg a tételt', async () => {
    const item = await kosarTetel(archivaltTermek)
    expect(item).not.toBeNull()
    expect(cartItemAvailability(item as CartItem)).toBe('archived')
  })

  it('a kirenderelt kosárban NINCS pénztár-gomb', async () => {
    const item = (await kosarTetel(archivaltTermek)) as CartItem
    const html = kosarralRenderel([item])
    expect(
      html,
      'A kurzusoldal ugyanezt a terméket SZÁNDÉKOSAN gomb nélkül mutatja; a kosár nem mondhat mást (WCAG 3.2.4).',
    ).not.toContain(`href="${checkoutHref(archivaltTermek.id)}"`)
    expect(html).not.toContain(VART.penztarFelirat)
    expect(html).not.toContain('/belepes?returnUrl=')
  })

  it('a tétel megmondja, MIÉRT nem vehető meg, és hova mehet tovább', async () => {
    const item = (await kosarTetel(archivaltTermek)) as CartItem
    const html = kosarralRenderel([item])
    expect(html).toContain(VART.archivaltTetelSzoveg)
    expect(html).toContain('href="/kurzusok"')
    expect(html).toContain(VART.kurzuslistaFelirat)
  })

  it('a magyarázat a courses.ts konstansából jön', () => {
    expect(ARCHIVED_COURSE_NOTE).toBe(VART.archivaltTetelSzoveg)
  })
})

describe('/kosar — HIBÁS ÁR-KONFIGURÁCIÓ: nincs „0 Ft" végösszeg', () => {
  for (const { nev, termek } of HIBAS_ARU_TERMEKEK) {
    it(`${nev}: nincs kimondott végösszeg és nincs pénztár-gomb`, async () => {
      const item = (await kosarTetel(termek)) as CartItem
      expect(item).not.toBeNull()
      expect(cartItemAvailability(item)).toBe('unavailable')
      const html = kosarralRenderel([item])
      expect(html, 'A „Végösszeg: 0 Ft" fizetősnek jelölt tételre hazugság.').not.toContain('0 Ft')
      expect(html).not.toContain('Végösszeg')
      expect(html).not.toContain(`href="${checkoutHref(termek.id)}"`)
      expect(html).toContain(VART.nemVasarolhatoSzoveg)
    })
  }
})

describe('/kosar — INGYENES tétel: az igénylő űrlapra visz, nem a pénztárba', () => {
  it('a kosár-oldal ingyenesként jelöli meg a tételt', async () => {
    const item = await kosarTetel(ingyenesTermek)
    expect(cartItemAvailability(item as CartItem)).toBe('free')
    expect((item as CartItem).isFree).toBe(true)
  })

  it('a gomb a kurzusoldal igénylő űrlapjának horgonyára megy', async () => {
    const item = (await kosarTetel(ingyenesTermek)) as CartItem
    const html = kosarralRenderel([item])
    const varhatoUt = courseCtaHref({ id: ingyenesTermek.id, slug: ingyenesTermek.slug })
    expect(varhatoUt).toBe(`${courseHref(ingyenesTermek)}#kurzus-vasarlas-gomb`)
    expect(html).toContain(`href="${varhatoUt}"`)
    expect(html).toContain(VART.ingyenesIgenylesFelirat)
    expect(html).not.toContain(`href="${checkoutHref(ingyenesTermek.id)}"`)
  })

  it('BEJELENTKEZÉS NÉLKÜL is az igénylő űrlapra visz (az űrlap vendégnek is jár)', async () => {
    const item = (await kosarTetel(ingyenesTermek)) as CartItem
    const html = kosarralRenderel([item])
    expect(html).toContain(
      `href="${courseCtaHref({ id: ingyenesTermek.id, slug: ingyenesTermek.slug })}"`,
    )
    expect(html).not.toContain('/belepes?returnUrl=')
  })

  it('a végösszeg „Ingyenes", nem 0 Ft', async () => {
    const item = (await kosarTetel(ingyenesTermek)) as CartItem
    const html = kosarralRenderel([item])
    expect(html).toContain(VART.ingyenesCimke)
    expect(html).not.toContain('0 Ft')
  })
})

describe('/kosar — FIZETŐS tétel: a pénztár útja sértetlen (pozitív kontroll)', () => {
  it('a pénztár-gomb a szótári felirattal és a helyes úttal áll ott', async () => {
    const item = (await kosarTetel(alapTermek)) as CartItem
    const html = kosarralRenderel([item])
    expect(html).toContain(`href="${checkoutHref(alapTermek.id)}"`)
    expect(html).toContain(VART.penztarFelirat)
  })

  it('a végösszeg a közös `formatPriceHuf` alakjában áll (nem-törhető szóközzel)', async () => {
    const item = (await kosarTetel(alapTermek)) as CartItem
    const html = kosarralRenderel([item])
    const varhato = formatPriceHuf(19990)
    expect(varhato).toContain(' ')
    expect(html).toContain(varhato)
    expect(
      html,
      'A `toLocaleString` közönséges szóközzel tagol, tehát az ár sorra törhet.',
    ).not.toContain('19 990 Ft')
  })

  it('BEJELENTKEZÉS NÉLKÜL is a pénztárra visz, nem belépésre kényszerít', async () => {
    const item = (await kosarTetel(alapTermek)) as CartItem
    const html = kosarralRenderel([item])
    expect(html).toContain(`href="${checkoutHref(alapTermek.id)}"`)
    expect(html).toContain(VART.penztarFelirat)
    expect(html).not.toContain('Belépés a fizetéshez')
    expect(html).not.toContain('/belepes?returnUrl=')
  })

  it('már megvett céltételnél a sáv a lejátszóra visz', async () => {
    const item = (await kosarTetel(alapTermek)) as CartItem
    const html = kosarralRenderel([item], { alreadyPurchasedProductId: alapTermek.id })
    expect(html).toContain(`href="/kurzusaim/${alapTermek.id}"`)
    expect(html).toContain(ctaLabel('course-start'))
    expect(html).not.toContain(VART.penztarFelirat)
    expect(html).not.toContain(`href="${checkoutHref(alapTermek.id)}"`)
  })
})

// 5b. LEJÁRT HOZZÁFÉRÉS — a vevő ÚJRA megveheti (P1)

/**
 * A HIBA, AMIT BEZÁR (2026-08-29).
 *
 * Az időkorlátos kurzus (accessDurationDays) hozzáférése lejár. A KURZUSOLDAL
 * ezt 2026 óta helyesen kezeli: a `purchased` ott `hasUserPurchased(...) ÉS
 * élő hozzáférés`, tehát lejárat után újra a vásárlási CTA jelenik meg
 * (src/app/(frontend)/kurzusok/[slug]/page.tsx). A SZERVER is engedi az
 * újravásárlást: a `startCheckout` duplavásárlás-kapuja `access.reason ===
 * 'expired'` esetén átenged (src/lib/checkout/start-checkout.ts).
 *
 * A pénztár és a kosár viszont csak a `hasUserPurchased`-et nézte, ezért a
 * lejárt vevő ZSÁKUTCÁBA futott: a lejátszó lejárat-kapuja a kurzusoldalra
 * küldte, ott a „Megveszem a kurzust" a pénztárba vitt, a pénztár pedig
 * kiírta, hogy „Ezt a kurzust már megvetted", és a beküldő gomb helyett a
 * lejátszóra mutató gombot adta — vissza oda, ahonnan jött.
 *
 * Ez a blokk azt méri, hogy a HÁROM felület ugyanazt a szabályt mondja
 * (WCAG 2.2 · 3.2.4 Consistent Identification;
 * https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html ;
 * GOV.UK, don't drop people off a journey
 * https://www.gov.uk/service-manual/design/user-centred-design ).
 */
const KORLATOS_TERMEK = { ...alapTermek, id: 81, accessDurationDays: 30 } as unknown as Product

const vevoAKurzussal = { ...mockUser, purchases: [KORLATOS_TERMEK.id] } as unknown as User

/**
 * A hozzáférés-feloldás (`resolveSingleCourseAccess`) a Payload-lekérdezéseken
 * át dolgozik: a paid rendelés `createdAt`-jából és a felhasználó
 * `accessGrants` sorából számol (src/lib/course-access-lookup.ts). A mock
 * ezért NEM a segédfüggvényt cseréli ki, hanem az ALATTA lévő két lekérdezést
 * adja meg — így a valódi szabály fut le, a teszt pedig azt méri, amit éles.
 */
function mockPayloadHozzaferessel(
  product: Product,
  user: User | null,
  paidOrderCreatedAt: string | null,
) {
  getPayloadMock.mockResolvedValue({
    auth: vi.fn(async () => ({ user })),
    findByID: vi.fn(async ({ collection }: { collection: string }) =>
      collection === 'users' ? { ...(user ?? {}), accessGrants: [] } : product,
    ),
    find: vi.fn(async () => ({
      docs:
        paidOrderCreatedAt === null
          ? []
          : [
              {
                id: 1,
                status: 'paid',
                createdAt: paidOrderCreatedAt,
                items: [{ id: 'sor-1', product: product.id, quantity: 1 }],
              },
            ],
      totalDocs: paidOrderCreatedAt === null ? 0 : 1,
    })),
  } as never)
}

/** Réges-régi vásárlás: a 30 napos hozzáférés biztosan lejárt. */
const LEJART_VASARLAS = '2020-01-01T10:00:00.000Z'
/** Mai vásárlás: a hozzáférés él. */
const ELO_VASARLAS = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

describe('/penztar — LEJÁRT hozzáférés: a normál vásárlási út jelenik meg', () => {
  it('a beküldő űrlap ott van, és NEM „már megvetted" állapotban', async () => {
    mockPayloadHozzaferessel(KORLATOS_TERMEK, vevoAKurzussal, LEJART_VASARLAS)
    const tree = await renderPenztar(termekParam(KORLATOS_TERMEK))
    const form = findElement(tree, CheckoutForm)
    expect(form, 'a lejárt vevőnek a pénztár-űrlapot kell látnia').not.toBeNull()
    expect((form as ReactElement).props).toMatchObject({ alreadyPurchased: false })
  })

  it('a „Ezt a kurzust már megvetted" sáv eltűnik, a fizető gomb visszajön', async () => {
    mockPayloadHozzaferessel(KORLATOS_TERMEK, vevoAKurzussal, LEJART_VASARLAS)
    const html = renderMarkup(await renderPenztar(termekParam(KORLATOS_TERMEK)))
    expect(html).not.toContain('Ezt a kurzust már megvetted')
    expect(html).toContain('type="submit"')
    expect(html).toContain(ctaLabel('checkout-submit'))
    expect(html).not.toContain(`href="/kurzusaim/${KORLATOS_TERMEK.id}"`)
  })

  it('ÉLŐ hozzáférésnél változatlanul a „már megvetted" állapot fut (pozitív kontroll)', async () => {
    mockPayloadHozzaferessel(KORLATOS_TERMEK, vevoAKurzussal, ELO_VASARLAS)
    const tree = await renderPenztar(termekParam(KORLATOS_TERMEK))
    expect((findElement(tree, CheckoutForm) as ReactElement).props).toMatchObject({
      alreadyPurchased: true,
    })
    const html = renderMarkup(tree)
    expect(html).toContain('Ezt a kurzust már megvetted')
    expect(html).toContain(`href="/kurzusaim/${KORLATOS_TERMEK.id}"`)
  })

  it('KORLÁTLAN kurzusnál a megvett állapot marad (a lejárat ott értelmezhetetlen)', async () => {
    const vevo = { ...mockUser, purchases: [alapTermek.id] } as unknown as User
    mockPayloadHozzaferessel(alapTermek, vevo, LEJART_VASARLAS)
    const tree = await renderPenztar(termekParam(alapTermek))
    expect((findElement(tree, CheckoutForm) as ReactElement).props).toMatchObject({
      alreadyPurchased: true,
    })
  })

  it('a lap ugyanazt a segédletet hívja, mint a kurzusoldal (nem másolt szabályt)', () => {
    const oldal = kommentNelkul(olvas('app/(frontend)/penztar/page.tsx'))
    const kurzusoldal = kommentNelkul(olvas('app/(frontend)/kurzusok/[slug]/page.tsx'))
    for (const forras of [oldal, kurzusoldal]) {
      expect(forras).toContain('resolveSingleCourseAccess(')
      expect(forras).toContain('hasUserPurchased(')
    }
  })
})

describe('/kosar — LEJÁRT hozzáférés: nem a lejátszóra küld, hanem a pénztárba', () => {
  it('a „már megvetted" sáv és a lejátszó-link eltűnik', async () => {
    mockPayloadHozzaferessel(KORLATOS_TERMEK, vevoAKurzussal, LEJART_VASARLAS)
    const html = renderMarkup(await renderKosarOldal(termekParam(KORLATOS_TERMEK)))
    expect(html).not.toContain('Ezt a kurzust már megvetted')
    expect(html).not.toContain(`href="/kurzusaim/${KORLATOS_TERMEK.id}"`)
  })

  it('a CartView a fizetés útját kapja, nem a már-megvett jelzést', async () => {
    mockPayloadHozzaferessel(KORLATOS_TERMEK, vevoAKurzussal, LEJART_VASARLAS)
    const view = findElement(await renderKosarOldal(termekParam(KORLATOS_TERMEK)), CartView)
    expect((view as ReactElement).props).toMatchObject({ alreadyPurchasedProductId: null })
  })

  it('ÉLŐ hozzáférésnél változatlanul a lejátszóra visz (pozitív kontroll)', async () => {
    mockPayloadHozzaferessel(KORLATOS_TERMEK, vevoAKurzussal, ELO_VASARLAS)
    const tree = await renderKosarOldal(termekParam(KORLATOS_TERMEK))
    expect((findElement(tree, CartView) as ReactElement).props).toMatchObject({
      alreadyPurchasedProductId: KORLATOS_TERMEK.id,
    })
    expect(renderMarkup(tree)).toContain('Ezt a kurzust már megvetted')
  })

  it('a lap ugyanazt a segédletet hívja, mint a kurzusoldal', () => {
    const oldal = kommentNelkul(olvas('app/(frontend)/kosar/page.tsx'))
    expect(oldal).toContain('resolveSingleCourseAccess(')
    expect(oldal).toContain('hasUserPurchased(')
  })
})

// 6. A KOSÁR FELIRATAI — szótárból, elgépelés nélkül

describe('CartView — a feliratok a §3.2 CTA-szótárból jönnek', () => {
  const forras = kommentNelkul(olvas('components/checkout/CartView.tsx'))

  it('a szótári feliratok és a literálok egyeznek', () => {
    expect(ctaLabel('cart-to-checkout')).toBe(VART.penztarFelirat)
    expect(ctaLabel('cart-remove-item')).toBe(VART.kivetelFelirat)
    expect(ctaLabel('free-course-claim')).toBe(VART.ingyenesIgenylesFelirat)
    expect(ctaLabel('course-list-open')).toBe(VART.kurzuslistaFelirat)
  })

  it('a komponens EGYETLEN feliratot sem ír ki literálként', () => {
    for (const felirat of [
      VART.penztarFelirat,
      VART.kivetelFelirat,
      VART.ingyenesIgenylesFelirat,
      VART.kurzuslistaFelirat,
      ctaLabel('course-start'),
    ]) {
      expect(forras, `literál felirat a komponensben: ${felirat}`).not.toContain(felirat)
    }
    expect(forras).toContain('ctaLabel(')
  })

  it('az ELGÉPELT „Tovább a penztárhoz" nem tud visszajönni', async () => {
    expect(forras).not.toContain(VART.elgepeltPenztarFelirat)
    expect(forras).not.toContain('penztárhoz')
    const item = (await kosarTetel(alapTermek)) as CartItem
    expect(kosarralRenderel([item])).not.toContain(VART.elgepeltPenztarFelirat)
  })

  it('a puszta „Törlés" felirat eltűnt (Carbon: a remove nem delete)', async () => {
    const item = (await kosarTetel(alapTermek)) as CartItem
    const html = kosarralRenderel([item])
    expect(html).not.toContain(`>${VART.regiTorlesFelirat}<`)
    expect(html).toContain(VART.kivetelFelirat)
  })

  it('a kivevő gomb HOZZÁFÉRHETŐ NEVE egyedi (SC 2.4.4): a tétel neve is benne van', async () => {
    const item = (await kosarTetel(alapTermek)) as CartItem
    const html = kosarralRenderel([item])
    // A tétel neve rejtett szövegként a gombon belül — a `Button` az
    // `aria-label`-t nem adja tovább, tehát a látható+rejtett szöveg az
    // egyetlen működő megoldás.
    expect(html).toContain('kc-visually-hidden')
    expect(html).toMatch(new RegExp(`${VART.kivetelFelirat}[^<]*<span[^>]*kc-visually-hidden`))
    expect(html).toContain(alapTermek.sku as string)
  })

  it('a szótári SÚLYOK és a lap renderelése egyezik (C-2)', () => {
    expect(ctaEntry('cart-to-checkout').weight).toBe('primary')
    expect(ctaEntry('free-course-claim').weight).toBe('secondary')
    expect(ctaEntry('cart-remove-item').weight).toBe('ghost')
  })

  it('a `toLocaleString` kikerült a komponensből', () => {
    expect(
      forras,
      'A repó közös ár-formázója a formatPriceHuf (nem-törhető szóköz, HUF pénznem).',
    ).not.toContain('toLocaleString')
  })

  it('a mikroszöveg magyar szabály szerinti (nincs töltelék gondolatjel, nincs „Kérjük")', () => {
    const kvirt = String.fromCharCode(0x2014)
    const gondolatjel = String.fromCharCode(0x2013)
    for (const szoveg of [
      ARCHIVED_COURSE_NOTE,
      UNAVAILABLE_COURSE_NOTE,
      CART_FREE_LABEL,
      ctaLabel('cart-to-checkout'),
      ctaLabel('cart-remove-item'),
      ctaLabel('course-list-open'),
    ]) {
      expect(szoveg).not.toContain(kvirt)
      expect(szoveg).not.toContain(gondolatjel)
      expect(szoveg).not.toContain('Kérjük')
    }
  })
})

// 7. A KOSÁR ÁLLAPOTGÉPE — egységteszt (a régi kosarakkal együtt)

const tetel = (reszlet: Partial<CartItem>): CartItem => ({
  productId: 1,
  sku: 'TESZT',
  slug: 'teszt',
  shortDescription: null,
  priceHuf: 19990,
  isFree: false,
  availability: 'paid',
  ...reszlet,
})

describe('cartItemAvailability — a négy állapot', () => {
  it('a szerver verdiktjét veszi át', () => {
    expect(cartItemAvailability(tetel({ availability: 'paid' }))).toBe('paid')
    expect(
      cartItemAvailability(tetel({ availability: 'free', priceHuf: null, isFree: true })),
    ).toBe('free')
    expect(cartItemAvailability(tetel({ availability: 'archived' }))).toBe('archived')
    expect(cartItemAvailability(tetel({ availability: 'unavailable', priceHuf: null }))).toBe(
      'unavailable',
    )
  })

  it('a „fizetős" verdikt ÉRVÉNYES árat is követel (a kettő nem mondhat mást)', () => {
    for (const ar of [null, 0, -1, Number.NaN]) {
      expect(cartItemAvailability(tetel({ availability: 'paid', priceHuf: ar }))).toBe(
        'unavailable',
      )
    }
  })

  it('RÉGI kosár (a mező bevezetése előttről): az árból és az isFree-ből következtet', () => {
    const regi = (reszlet: Partial<CartItem>): CartItem => {
      const item = tetel(reszlet)
      delete item.availability
      return item
    }
    expect(cartItemAvailability(regi({ priceHuf: 19990, isFree: false }))).toBe('paid')
    expect(cartItemAvailability(regi({ priceHuf: null, isFree: true }))).toBe('free')
    expect(
      cartItemAvailability(regi({ priceHuf: null, isFree: false })),
      'Ez a tétel adta a „Végösszeg: 0 Ft" hazugságot.',
    ).toBe('unavailable')
    expect(cartItemAvailability(regi({ priceHuf: 0, isFree: false }))).toBe('unavailable')
  })
})

describe('cartItemNote — a magyarázó mondat', () => {
  it('csak a nem vásárolható tételnek van magyarázata', () => {
    expect(cartItemNote(tetel({ availability: 'paid' }))).toBeNull()
    expect(cartItemNote(tetel({ availability: 'free', isFree: true }))).toBeNull()
    expect(cartItemNote(tetel({ availability: 'archived' }))).toBe(ARCHIVED_COURSE_NOTE)
    expect(cartItemNote(tetel({ availability: 'unavailable', priceHuf: null }))).toBe(
      UNAVAILABLE_COURSE_NOTE,
    )
  })
})

describe('cartTotalHuf és cartSummary', () => {
  it('a végösszeg CSAK az érvényes árú tételeket adja össze', () => {
    expect(cartTotalHuf({ items: [tetel({ productId: 1, priceHuf: 1000 })] })).toBe(1000)
    expect(
      cartTotalHuf({
        items: [
          tetel({ productId: 1, priceHuf: 1000 }),
          tetel({ productId: 2, availability: 'archived', priceHuf: 9999 }),
        ],
      }),
      'Az archivált tétel ára nem fizetendő: a checkout el sem indul rá.',
    ).toBe(1000)
    expect(cartTotalHuf({ items: [tetel({ availability: 'unavailable', priceHuf: null })] })).toBe(
      0,
    )
  })

  it('ÜRES kosár: nincs kimondott végösszeg és nincs cél', () => {
    const osszegzes = cartSummary({ items: [] })
    expect(osszegzes.kind).toBe('empty')
    expect(osszegzes.totalLabel).toBeNull()
    expect(osszegzes.target).toBeNull()
  })

  it('NEM VÁSÁROLHATÓ tétel esetén NINCS végösszeg és NINCS cselekvés', () => {
    for (const allapot of ['archived', 'unavailable'] as const) {
      const osszegzes = cartSummary({
        items: [tetel({ availability: allapot, priceHuf: allapot === 'archived' ? 19990 : null })],
      })
      expect(osszegzes.kind).toBe('blocked')
      expect(osszegzes.totalLabel, 'A „Végösszeg: 0 Ft" pontosan itt keletkezett.').toBeNull()
      expect(osszegzes.target).toBeNull()
      expect(osszegzes.blocked).toHaveLength(1)
    }
  })

  it('CSUPA INGYENES kosár: „Ingyenes" a végösszeg, a cél az első tétel', () => {
    const item = tetel({ availability: 'free', isFree: true, priceHuf: null })
    const osszegzes = cartSummary({ items: [item] })
    expect(osszegzes.kind).toBe('free')
    expect(osszegzes.totalLabel).toBe(CART_FREE_LABEL)
    expect(osszegzes.target).toBe(item)
  })

  it('FIZETŐS kosár: a végösszeg a formatPriceHuf alakjában áll', () => {
    const osszegzes = cartSummary({ items: [tetel({ priceHuf: 19990 })] })
    expect(osszegzes.kind).toBe('amount')
    expect(osszegzes.totalHuf).toBe(19990)
    expect(osszegzes.totalLabel).toBe(formatPriceHuf(19990))
  })

  it('VEGYES (ingyenes + fizetős) kosár: a cél az első FIZETŐS tétel, nem az első tétel', () => {
    // Enélkül a pénztár-gomb az ingyenes tételre mutatna, ahol a pénztár
    // tájékoztató állapotot ad: újabb zsákutca.
    const ingyenes = tetel({ productId: 1, availability: 'free', isFree: true, priceHuf: null })
    const fizetos = tetel({ productId: 2, priceHuf: 5000 })
    const osszegzes = cartSummary({ items: [ingyenes, fizetos] })
    expect(osszegzes.kind).toBe('amount')
    expect(osszegzes.target).toBe(fizetos)
    expect(osszegzes.totalHuf).toBe(5000)
  })

  it('EGY nem vásárolható tétel NEM veszi el a megvehető tétel fizetés-útját', () => {
    // 2026-08-18, tulajdonosi döntés: a jó tétel megvehető marad, a rossz a
    // saját sorában kapja a magyarázatát. A régi, mindent blokkoló szabály
    // Baymard mérése szerint 30%-ot küld máshova
    // (https://baymard.com/blog/handling-out-of-stock-products).
    // A teljes bizonyítás: `src/__tests__/vegyes-kosar-tetelenkent.test.tsx`.
    const megvehetoTetel = tetel({ productId: 1, priceHuf: 5000 })
    const osszegzes = cartSummary({
      items: [megvehetoTetel, tetel({ productId: 2, availability: 'archived' })],
    })
    expect(osszegzes.kind).toBe('amount')
    expect(osszegzes.target).toBe(megvehetoTetel)
    expect(osszegzes.blocked).toHaveLength(1)
    expect(osszegzes.totalHuf, 'az archivált tétel ára nem szállhat be').toBe(5000)
  })

  it('MINDEN tétel nem vásárolható: marad a blokkolt állapot', () => {
    const osszegzes = cartSummary({
      items: [
        tetel({ productId: 1, availability: 'archived' }),
        tetel({ productId: 2, availability: 'unavailable', priceHuf: null }),
      ],
    })
    expect(osszegzes.kind).toBe('blocked')
    expect(osszegzes.target).toBeNull()
    expect(osszegzes.totalLabel).toBeNull()
    expect(osszegzes.blocked).toHaveLength(2)
  })
})

// 8. MÉRÉS — kontraszt, érintőcél, sorhossz, 320 px

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
    const hivatkozas = /^var\(\s*(--kc-[a-z0-9-]+)\s*\)$/.exec(ertek)
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

describe('Mért kontraszt a kosár magyarázó mondatán (SC 1.4.3)', () => {
  const tokenek = tokenTerkep()
  const szin = (nev: string): RGB => {
    const ertek = tokenek.get(nev)
    expect(ertek, `Hiányzó vagy feloldhatatlan token: ${nev}`).toMatch(/^#[0-9a-fA-F]{3,8}$/)
    return hexRgb(ertek as string)
  }

  it('a magyarázó mondat TELJES tintával áll (nem tompított): ≥ 4,5:1 a kártyán', () => {
    const torzs = szabalyTorzs(olvas('app/(frontend)/checkout.css'), '.kc-cart__note')
    expect(torzs, 'Hiányzik a `.kc-cart__note` szabály.').not.toBe('')
    expect(
      torzs,
      'A blokkoló ok NEM tompítható: enélkül a látogató nem tudja meg, miért nem tud fizetni.',
    ).toContain('color: var(--kc-color-text)')
    const kartya = szabalyTorzs(olvas('app/(frontend)/styles/ui.css'), '.kc-card')
    expect(kartya).toContain('background-color: var(--kc-color-surface-raised)')
    const mert = arany(szin('--kc-color-text'), szin('--kc-color-surface-raised'))
    expect(mert, `mért ${mert.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
  })

  it('a magyarázó mondat a HÁROM méret-token egyikén áll', () => {
    const torzs = szabalyTorzs(olvas('app/(frontend)/checkout.css'), '.kc-cart__note')
    expect(torzs).toMatch(/font-size:\s*var\(--kc-font-[lms]\)/)
  })
})

describe('Mért érintőcél, sorhossz és 320 px-es reflow a kosárban', () => {
  const tokenek = tokenTerkep()
  const ui = olvas('app/(frontend)/styles/ui.css')

  it('a kosár gombjai legalább 44 px magasak (SC 2.5.5)', () => {
    const alap = szabalyTorzs(ui, '.kc-button')
    const magassag = pixel(/min-height:\s*([^;]+);/.exec(alap)?.[1] ?? '')
    expect(magassag, `mért min-height: ${magassag} px`).toBeGreaterThanOrEqual(44)
  })

  it('a magyarázó mondat FOLYÓSZÖVEG marad (soha nem flex)', () => {
    // A repó megtörtént csapdája: a `.kc-appointment__consent-label` `display:
    // flex`-től öt hasábra esett szét (107 px túlcsordulás 320 px-en, SC 1.4.10).
    const torzs = szabalyTorzs(olvas('app/(frontend)/checkout.css'), '.kc-cart__note')
    expect(torzs).not.toContain('display: flex')
    expect(torzs).not.toContain('display: grid')
  })

  it('a magyarázat sorhossza a 45–80 karakteres sávban marad (SC 1.4.8)', () => {
    // A repó MÉRT állandója (tokens.css „Mérték" szakasza, fontTools/hmtx a
    // Nunito Sans wght 400 példányán, n = 5981 karakter): 0,4542 em/karakter.
    const ATLAG_KARAKTER_EM = 0.4542
    const konteneR = pixel(tokenek.get('--kc-container-narrow') ?? '')
    const oldalMargo = pixel(tokenek.get('--kc-container-gutter') ?? '')
    const kartyaBelso = pixel(
      tokenek.get(
        /padding:\s*var\((--kc-space-\d)\)/.exec(szabalyTorzs(ui, '.kc-card--padded'))?.[1] ?? '',
      ) ?? '',
    )
    for (const ertek of [konteneR, oldalMargo, kartyaBelso]) {
      expect(ertek).toBeGreaterThan(0)
    }
    const szovegSav = konteneR - 2 * oldalMargo - 2 * kartyaBelso - 2
    const karakter = szovegSav / (ATLAG_KARAKTER_EM * 18)
    expect(karakter, `mért sorhossz: ${karakter.toFixed(1)} karakter`).toBeGreaterThanOrEqual(45)
    expect(karakter, `mért sorhossz: ${karakter.toFixed(1)} karakter`).toBeLessThanOrEqual(80)
  })

  it('320 px-en a leghosszabb gombfelirat is befér, túlcsordulás nélkül (SC 1.4.10)', () => {
    const oldalMargo = pixel(tokenek.get('--kc-container-gutter') ?? '')
    const gombBelso = pixel(
      tokenek.get(
        /padding:\s*var\(--kc-space-\d\)\s+var\((--kc-space-\d)\)/.exec(
          szabalyTorzs(ui, '.kc-button'),
        )?.[1] ?? '',
      ) ?? '',
    )
    expect(gombBelso).toBeGreaterThan(0)

    const nezetablak = 320
    // A kosár összegző sávja a konténerben áll, kártya nélkül.
    const savSzelesseg = nezetablak - 2 * oldalMargo
    expect(savSzelesseg).toBe(272)

    const LEGSZELESEBB_KARAKTER_EM = 0.6
    const feliratSav = savSzelesseg - 2 * gombBelso - 4
    for (const felirat of [
      ctaLabel('cart-to-checkout'),
      ctaLabel('cart-remove-item'),
      ctaLabel('free-course-claim'),
      ctaLabel('course-list-open'),
    ]) {
      const leghosszabbSzo = felirat
        .split(/\s+/)
        .reduce((leghosszabb, szo) => (szo.length > leghosszabb.length ? szo : leghosszabb), '')
      const szoSzelesseg = leghosszabbSzo.length * LEGSZELESEBB_KARAKTER_EM * 18
      expect(
        szoSzelesseg,
        `„${leghosszabbSzo}" felső becsléssel ${szoSzelesseg.toFixed(0)} px, a gomb belső sávja ${feliratSav} px`,
      ).toBeLessThan(feliratSav)
    }
  })
})
