import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getPayload } from 'payload'
import {
  createElement,
  Fragment,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CheckoutForm } from '../components/checkout/CheckoutForm'
import { COURSE_CTA_ANCHOR, courseCtaHref, courseHref } from '../lib/course-url'
import { checkoutHref, isFreeCourse } from '../lib/courses'
import { ctaEntry, ctaLabel } from '../lib/cta-vocabulary'
import {
  FREE_COURSE_ALREADY_GRANTED_TEXT,
  FREE_COURSE_NOT_CHECKOUT_TEXT,
} from '../lib/free-course/ui-text'
import type { Product, User } from '../payload-types'

/**
 * ŐR — A PÉNZTÁR INGYENES-KAPUJA.
 * A `/penztar?termek=<ingyenes-id>` TELJES ÉRTÉKŰ pénztár-űrlapot rendelt
 * („Hozzáférés megnyitása" gombbal), a beküldés viszont a
 * `POST /api/checkout/start`-ra ment, ahol az ár-kapu garantáltan elutasítja:
 * `coursePriceHuf` az ingyenes terméken (`priceInHUFEnabled: false`) `null`,
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
// A VÁRT SZÖVEGEK ÉS AZONOSÍTÓK — LITERÁLKÉNT (fejkomment b) pont)
// ───────────────────────────────────────────────────────────────────────────

const VART = {
  horgony: 'kurzus-vasarlas-gomb',
  ingyenesSzoveg:
    'Ez a kurzus ingyenes, ezért nem a pénztáron át jár. A kurzus oldalán igényelheted: az űrlap rövid, és fizetned nem kell érte.',
  mergvanSzoveg:
    'Ez a kurzus ingyenes, és a hozzáférésed már megvan. A Kurzusaim oldalon éred el.',
  igenylesFelirat: 'Elindítom ingyen',
  kurzusaimFelirat: 'Nyisd meg a kurzusaidat',
  kurzusaimUt: '/kurzusaim',
  archivaltSzoveg: 'Ez a kurzus jelenleg nem vásárolható meg.',
  nincsTermekSzoveg: 'Nincs kiválasztott termék a fizetéshez.',
} as const

// ───────────────────────────────────────────────────────────────────────────
// AZ OLDAL FUTTATÁSA (a penztar-oldal.test.tsx mintája)
// ───────────────────────────────────────────────────────────────────────────

const mockUser = {
  id: 7,
  email: 'vevo@example.test',
  name: 'Minta Mari',
  purchases: [],
} as unknown as User

const fizetosTermek = {
  id: 42,
  sku: 'KURZUS-ALAP',
  slug: 'kez-rehabilitacio',
  status: 'published',
  priceInHUF: 5000,
  priceInHUFEnabled: true,
} as unknown as Product

/** Az „ingyenes" fogalom EGYETLEN forrása a `priceInHUFEnabled: false`. */
const ingyenesTermek = {
  id: 43,
  sku: 'KURZUS-INGYENES',
  slug: 'kez-villamkurzus',
  status: 'published',
  priceInHUF: null,
  priceInHUFEnabled: false,
} as unknown as Product

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

/** A `?termek=` query az adott termékre — ugyanaz, amit a kosár és a CTA épít. */
const termekParam = (product: Product): Record<string, string> => ({ termek: String(product.id) })

// 1. AZ INGYENES KAPU — nincs díszlet-űrlap

describe('/penztar — ingyenes termék: tájékoztató állapot, nem díszlet-űrlap', () => {
  it('a CheckoutForm EGYÁLTALÁN NEM renderelődik', async () => {
    mockPayloadBehavior(ingyenesTermek)
    const tree = await renderPenztar(termekParam(ingyenesTermek))
    expect(
      findElement(tree, CheckoutForm),
      'Az ingyenes terméken a pénztár beküldése a checkout ár-kapuján garantáltan 400-zal bukik. A megjelenített űrlap ezért díszlet: a néma hiba kínosabbik fajtája.',
    ).toBeNull()
  })

  it('a beküldhető felület egyetlen eleme sem kerül ki (mező, nyilatkozat, fizetőgomb)', async () => {
    mockPayloadBehavior(ingyenesTermek)
    const html = renderMarkup(await renderPenztar(termekParam(ingyenesTermek)))
    for (const nyom of [
      'id="kc-field-billingName"',
      'id="kc-field-guestEmail"',
      'id="kc-checkout-terms"',
      'type="submit"',
      'Hozzáférés megnyitása',
    ]) {
      expect(html, `a pénztár-űrlap nyoma a lapon: ${nyom}`).not.toContain(nyom)
    }
  })

  it('a tájékoztató állapot kimondja az OKOT és állapot-szerepben áll', async () => {
    mockPayloadBehavior(ingyenesTermek)
    const html = renderMarkup(await renderPenztar(termekParam(ingyenesTermek)))
    expect(html).toContain(VART.ingyenesSzoveg)
    // A lap másik két végállapotával AZONOS doboz és szerep (SC 3.2.4).
    expect(html).toContain('class="kc-cart-empty"')
    expect(html).toContain('role="status"')
    expect(html).toContain('<h1>Pénztár</h1>')
  })

  it('a továbblépés a KURZUSOLDAL igénylő űrlapjára visz (kanonikus cím + horgony)', async () => {
    mockPayloadBehavior(ingyenesTermek)
    const html = renderMarkup(await renderPenztar(termekParam(ingyenesTermek)))
    expect(html).toContain(`href="/kurzusok/kez-villamkurzus#${VART.horgony}"`)
    expect(html).toContain(VART.igenylesFelirat)
    // A régi, zsákutcás célok NEM jelenhetnek meg ezen az ágon.
    expect(
      html,
      'A /kurzusaim be nem jelentkezett látogatónak zsákutca: fiókja nincs, a lista bejelentkezést kér. Az ingyenes kurzus valódi útja az igénylő űrlap.',
    ).not.toContain(`href="${VART.kurzusaimUt}"`)
    expect(html).not.toContain('href="/kurzusok"')
  })

  it('EGYETLEN továbblépés van a lapon (GOV.UK: egy fő cselekvés)', async () => {
    mockPayloadBehavior(ingyenesTermek)
    const html = renderMarkup(await renderPenztar(termekParam(ingyenesTermek)))
    expect([...html.matchAll(/class="[^"]*kc-button/g)]).toHaveLength(1)
    expect([...html.matchAll(/<a\s/g)]).toHaveLength(1)
  })

  it('SLUG NÉLKÜLI ingyenes terméknél a régi, id-alapú kanonikus cím megy ki', async () => {
    // Nincs külön útvonal-képzés: a `courseCtaHref` a `courseHref`-re épül,
    // ami slug hiányában az id-s alakot adja.
    const slugNelkul = { ...ingyenesTermek, slug: null } as unknown as Product
    mockPayloadBehavior(slugNelkul)
    const html = renderMarkup(await renderPenztar(termekParam(slugNelkul)))
    expect(html).toContain(`href="/kurzusok/43#${VART.horgony}"`)
  })

  it('VENDÉGKÉNT (nincs bejelentkezés) ugyanez az igénylő ág fut', async () => {
    mockPayloadBehavior(ingyenesTermek, null)
    const html = renderMarkup(await renderPenztar(termekParam(ingyenesTermek)))
    expect(html).toContain(VART.ingyenesSzoveg)
    expect(html).toContain(`href="/kurzusok/kez-villamkurzus#${VART.horgony}"`)
  })
})

// 2. AKI MÁR MEGKAPTA — a Kurzusaim a továbblépés

describe('/penztar — ingyenes termék, meglévő hozzáféréssel', () => {
  const vevo = { ...mockUser, purchases: [ingyenesTermek.id] } as unknown as User

  it('a Kurzusaimra visz, és a szöveg megmondja, hol találja meg', async () => {
    mockPayloadBehavior(ingyenesTermek, vevo)
    const html = renderMarkup(await renderPenztar(termekParam(ingyenesTermek)))
    expect(html).toContain(VART.mergvanSzoveg)
    expect(html).toContain(`href="${VART.kurzusaimUt}"`)
    expect(html).toContain(VART.kurzusaimFelirat)
  })

  it('ilyenkor NEM az igénylő űrlapra küld (nincs mit igényelnie)', async () => {
    mockPayloadBehavior(ingyenesTermek, vevo)
    const html = renderMarkup(await renderPenztar(termekParam(ingyenesTermek)))
    expect(html).not.toContain(`#${VART.horgony}`)
    expect(html).not.toContain(VART.ingyenesSzoveg)
    expect(html).not.toContain(VART.igenylesFelirat)
  })

  it('a CheckoutForm ezen az ágon sem renderelődik', async () => {
    mockPayloadBehavior(ingyenesTermek, vevo)
    expect(findElement(await renderPenztar(termekParam(ingyenesTermek)), CheckoutForm)).toBeNull()
  })
})

// 3. POZITÍV KONTROLL — a fizetős út SÉRTETLEN

describe('/penztar — a FIZETŐS termék felülete változatlan (a kapu nem foghatja el)', () => {
  it('fizetős terméknél a CheckoutForm a helyes proppal renderelődik', async () => {
    mockPayloadBehavior(fizetosTermek)
    const tree = await renderPenztar(termekParam(fizetosTermek))
    const form = findElement(tree, CheckoutForm)
    expect(
      form,
      'Ha a kapu a fizetős terméket is elfogja, a webshopban SEMMIT nem lehet megvenni. Ez a legveszélyesebb regresszió ebben a körben.',
    ).not.toBeNull()
    const props = (form as ReactElement).props as {
      product: { id: number; priceHuf: number | null; isFree: boolean }
    }
    expect(props.product.id).toBe(fizetosTermek.id)
    expect(props.product.priceHuf).toBe(5000)
    expect(props.product.isFree).toBe(false)
  })

  it('fizetős terméknél NEM jelenik meg az ingyenes tájékoztató állapot', async () => {
    mockPayloadBehavior(fizetosTermek)
    const html = renderMarkup(await renderPenztar(termekParam(fizetosTermek)))
    expect(html).not.toContain(VART.ingyenesSzoveg)
    expect(html).not.toContain(VART.mergvanSzoveg)
    expect(html).toContain('type="submit"')
  })

  it('a kapu FELTÉTELE az `isFreeCourse`, tehát a beállítatlan ár-pipa NEM ingyenes', async () => {
    // A hiányos konfigurációjú termék (se be, se ki a pipa) SEM ingyenes: azt
    // a checkout másik ága utasítja el, és az ingyenes kapu nem nyelheti el.
    const hianyos = { ...fizetosTermek, priceInHUFEnabled: undefined } as unknown as Product
    expect(isFreeCourse(hianyos)).toBe(false)
    mockPayloadBehavior(hianyos)
    const html = renderMarkup(await renderPenztar(termekParam(hianyos)))
    expect(html).not.toContain(VART.ingyenesSzoveg)
  })
})

// 4. A MEGLÉVŐ VÉGÁLLAPOTOK VÉDVE MARADNAK

describe('/penztar — a korábbi végállapotok változatlanok', () => {
  it('ARCHIVÁLT termék: az archivált állapot marad', async () => {
    mockPayloadBehavior({ ...fizetosTermek, status: 'archived' } as Product)
    const html = renderMarkup(await renderPenztar(termekParam(fizetosTermek)))
    expect(html).toContain(VART.archivaltSzoveg)
    expect(html).toContain('href="/kurzusok"')
  })

  it('ARCHIVÁLT + INGYENES termék: az archivált ág dönt ELŐBB', async () => {
    // A sorrend nem közömbös: az archivált termék nem igényelhető, tehát az
    // igénylő űrlapra küldeni hamis ígéret lenne (NN/g: „a link ígéret").
    mockPayloadBehavior({ ...ingyenesTermek, status: 'archived' } as Product)
    const html = renderMarkup(await renderPenztar(termekParam(ingyenesTermek)))
    expect(html).toContain(VART.archivaltSzoveg)
    expect(html).not.toContain(VART.ingyenesSzoveg)
    expect(html).not.toContain(`#${VART.horgony}`)
  })

  it('NINCS termék: a korábbi üres állapot marad', async () => {
    mockPayloadBehavior(null)
    const html = renderMarkup(await renderPenztar({ termek: '999' }))
    expect(html).toContain(VART.nincsTermekSzoveg)
  })
})

// 5. A KOSÁR ÚTJA IS IDE FUT (D5)

describe('A kosár felől érkező út is a kapuba fut, nem zsákutcába', () => {
  it('a kosár pénztár-linkje a `?termek=<id>` alakot építi', () => {
    // A `CartView` ezt a segédet hívja (`checkoutHref(state.items[0].productId)`),
    // tehát a kosárból induló látogató UGYANAZT az útvonalat kapja.
    expect(checkoutHref(ingyenesTermek.id)).toBe(`/penztar?termek=${ingyenesTermek.id}`)
  })

  it('ezen az útvonalon INGYENES terméknél is a tájékoztató állapot jön ki', async () => {
    const query = checkoutHref(ingyenesTermek.id).split('?')[1]
    const [kulcs, ertek] = query.split('=')
    mockPayloadBehavior(ingyenesTermek)
    const html = renderMarkup(await renderPenztar({ [kulcs]: ertek }))
    expect(html).toContain(VART.ingyenesSzoveg)
    expect(html).not.toContain('type="submit"')
  })
})

// 6. A HORGONY ÉS A FELIRATOK NEM CSÚSZHATNAK SZÉT

describe('A horgony a kurzusoldal VALÓDI cél-azonosítója', () => {
  const kurzusOldal = kommentNelkul(olvas('app/(frontend)/kurzusok/[slug]/page.tsx'))

  it('a `COURSE_CTA_ANCHOR` BITRE egyezik a kurzusoldal `CTA_ID`-jével', () => {
    const talalat = /const CTA_ID = '([^']+)'/.exec(kurzusOldal)
    expect(talalat, 'A kurzusoldalon nincs `CTA_ID` konstans.').not.toBeNull()
    expect(
      (talalat as RegExpExecArray)[1],
      'A pénztár horgonya és a kurzusoldal cél-azonosítója elcsúszott. Ez NÉMA hiba: a link működik, csak nem ugrik sehova.',
    ).toBe(COURSE_CTA_ANCHOR)
    expect(COURSE_CTA_ANCHOR).toBe(VART.horgony)
  })

  it('a kurzusoldal ezt az azonosítót `id`-ként ki is rakja', () => {
    expect(kurzusOldal).toMatch(/id=\{CTA_ID\}/)
  })

  it('a `courseCtaHref` a `courseHref`-re épül (nincs külön útvonal-képzés)', () => {
    for (const termek of [ingyenesTermek, { ...ingyenesTermek, slug: null } as Product]) {
      expect(courseCtaHref(termek)).toBe(`${courseHref(termek)}#${COURSE_CTA_ANCHOR}`)
    }
  })
})

describe('A feliratok a §3.2 CTA-szótárból jönnek', () => {
  it('a két felirat literálja és a szótár bejegyzése egyezik', () => {
    expect(ctaLabel('free-course-claim')).toBe(VART.igenylesFelirat)
    expect(ctaLabel('my-courses-open')).toBe(VART.kurzusaimFelirat)
  })

  it('mindkét sor SÚLYA `secondary` a szótárban (C-2), ahogy a lap rendereli', () => {
    // A lap `variant="secondary"`-t ad. Ha a szótár súlya megváltozik, ez az
    // állítás kidől, és a lapot vele együtt kell igazítani (C-2: ugyanaz a
    // cselekvés = ugyanaz a súly).
    expect(ctaEntry('free-course-claim').weight).toBe('secondary')
    expect(ctaEntry('my-courses-open').weight).toBe('secondary')
    const oldal = kommentNelkul(olvas('app/(frontend)/penztar/page.tsx'))
    expect(oldal).toContain('variant="secondary"')
  })

  it('a lap a szótárból OLVASSA a feliratot, nem literálként írja ki', () => {
    const oldal = kommentNelkul(olvas('app/(frontend)/penztar/page.tsx'))
    expect(oldal).toContain('ctaLabel(')
    expect(
      oldal,
      'A felirat literálként a lapra írva kikerülne a G-UI1 szótár-őr hatálya alól.',
    ).not.toContain(VART.igenylesFelirat)
    expect(oldal).not.toContain(VART.kurzusaimFelirat)
  })

  it('a szövegek és a feliratok magyar mikroszöveg-szabály szerintiek', () => {
    // A karaktereket kódpontból építjük, hogy maga az őrfájl se hordozza őket.
    const kvirt = String.fromCharCode(0x2014)
    const gondolatjel = String.fromCharCode(0x2013)
    for (const szoveg of [
      FREE_COURSE_NOT_CHECKOUT_TEXT,
      FREE_COURSE_ALREADY_GRANTED_TEXT,
      ctaLabel('free-course-claim'),
      ctaLabel('my-courses-open'),
    ]) {
      expect(szoveg).not.toContain(kvirt)
      expect(szoveg).not.toContain(gondolatjel)
      // §2.7 / A-9: a „Kérjük" választást sugall ott, ahol nincs választás.
      expect(szoveg).not.toContain('Kérjük')
    }
  })

  it('a szöveg-konstansok literálja és a modul értéke egyezik', () => {
    expect(FREE_COURSE_NOT_CHECKOUT_TEXT).toBe(VART.ingyenesSzoveg)
    expect(FREE_COURSE_ALREADY_GRANTED_TEXT).toBe(VART.mergvanSzoveg)
  })

  it('a szöveg megmondja az OKOT ÉS a következő lépést (NN/g)', () => {
    expect(FREE_COURSE_NOT_CHECKOUT_TEXT).toContain('ingyenes')
    expect(FREE_COURSE_NOT_CHECKOUT_TEXT).toContain('A kurzus oldalán')
    expect(FREE_COURSE_ALREADY_GRANTED_TEXT).toContain('Kurzusaim')
  })
})

// 7. MÉRÉS — kontraszt, érintőcél, sorhossz, 320 px

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

describe('Mért kontraszt a tájékoztató állapoton (SC 1.4.3 és 1.4.11)', () => {
  const tokenek = tokenTerkep()
  const szin = (nev: string): RGB => {
    const ertek = tokenek.get(nev)
    expect(ertek, `Hiányzó vagy feloldhatatlan token: ${nev}`).toMatch(/^#[0-9a-fA-F]{3,8}$/)
    return hexRgb(ertek as string)
  }

  it('a doboz háttere a tint-felület, a szöveg az ink (a checkout.css-ből mérve)', () => {
    const torzs = szabalyTorzs(olvas('app/(frontend)/checkout.css'), '.kc-cart-empty')
    expect(torzs).toContain('background-color: var(--kc-color-surface-tint)')
  })

  it('az állapot szövege ≥ 4,5:1 a doboz hátterén', () => {
    const mert = arany(szin('--kc-color-text'), szin('--kc-color-surface-tint'))
    expect(mert, `mért ${mert.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
  })

  it('a másodlagos gomb FELIRATA ≥ 4,5:1 a doboz hátterén', () => {
    // A `.kc-button--secondary` háttere `transparent`, tehát a doboz tintje
    // látszik át; a felirat `--kc-color-text`.
    const gomb = szabalyTorzs(olvas('app/(frontend)/styles/ui.css'), '.kc-button--secondary')
    expect(gomb).toContain('background-color: transparent')
    expect(gomb).toContain('color: var(--kc-color-text)')
    const mert = arany(szin('--kc-color-text'), szin('--kc-color-surface-tint'))
    expect(mert, `mért ${mert.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5)
  })

  it('a gomb KERETE ≥ 3:1 (SC 1.4.11: a gomb határa azonosító UI-elem)', () => {
    const gomb = szabalyTorzs(olvas('app/(frontend)/styles/ui.css'), '.kc-button--secondary')
    expect(gomb).toContain('border-color: var(--kc-color-text)')
    const mert = arany(szin('--kc-color-text'), szin('--kc-color-surface-tint'))
    expect(mert, `mért ${mert.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
  })
})

describe('Mért érintőcél, sorhossz és 320 px-es reflow', () => {
  const tokenek = tokenTerkep()
  const ui = olvas('app/(frontend)/styles/ui.css')

  it('a továbblépő gomb legalább 44 px magas (SC 2.5.5)', () => {
    const alap = szabalyTorzs(ui, '.kc-button')
    const magassag = pixel(/min-height:\s*([^;]+);/.exec(alap)?.[1] ?? '')
    expect(magassag, `mért min-height: ${magassag} px`).toBeGreaterThanOrEqual(44)
  })

  it('a gomb felirata TÖRHET, tehát szűk sávon sem csordul túl', () => {
    // `display: inline-flex` + a `white-space: nowrap` HIÁNYA: a gomb doboza a
    // rendelkezésre álló szélességre zsugorodik, a felirat tördel.
    const alap = szabalyTorzs(ui, '.kc-button')
    expect(alap).toContain('display: inline-flex')
    expect(
      alap,
      'A `white-space: nowrap` a hosszabb feliratot („Nyisd meg a kurzusaidat") 320 px-en kilógatná a dobozból (SC 1.4.10).',
    ).not.toContain('white-space: nowrap')
  })

  it('az állapot sorhossza a 45–80 karakteres sávban marad', () => {
    // A repó MÉRT állandója (tokens.css „Mérték" szakasza, fontTools/hmtx a
    // Nunito Sans wght 400 példányán, n = 5981 karakter): 0,4542em/karakter.
    // A törzsszöveg az M lépcsőn áll, aminek a felső vége 1,125rem = 18 px.
    const ATLAG_KARAKTER_EM = 0.4542
    const konteneR = pixel(tokenek.get('--kc-container-narrow') ?? '')
    const oldalMargo = pixel(tokenek.get('--kc-container-gutter') ?? '')
    const dobozBelso = pixel(
      tokenek.get(
        /padding:\s*var\((--kc-space-\d)\)/.exec(
          szabalyTorzs(olvas('app/(frontend)/checkout.css'), '.kc-cart-empty'),
        )?.[1] ?? '',
      ) ?? '',
    )
    for (const ertek of [konteneR, oldalMargo, dobozBelso]) {
      expect(ertek).toBeGreaterThan(0)
    }
    // A konténer max-szélessége a legrosszabb (leghosszabb sorú) eset.
    const szovegSav = konteneR - 2 * oldalMargo - 2 * dobozBelso - 2
    const karakter = szovegSav / (ATLAG_KARAKTER_EM * 18)
    expect(karakter, `mért sorhossz: ${karakter.toFixed(1)} karakter`).toBeGreaterThanOrEqual(45)
    expect(
      karakter,
      `mért sorhossz: ${karakter.toFixed(1)} karakter — a WCAG 2.2 SC 1.4.8 80-as plafonja alatt kell maradnia.`,
    ).toBeLessThanOrEqual(80)
  })

  it('320 px-en a leghosszabb felirat is befér a gombba, túlcsordulás nélkül', () => {
    const oldalMargo = pixel(tokenek.get('--kc-container-gutter') ?? '')
    const dobozBelso = pixel(
      tokenek.get(
        /padding:\s*var\((--kc-space-\d)\)/.exec(
          szabalyTorzs(olvas('app/(frontend)/checkout.css'), '.kc-cart-empty'),
        )?.[1] ?? '',
      ) ?? '',
    )
    const gombBelso = pixel(
      tokenek.get(
        /padding:\s*var\(--kc-space-\d\)\s+var\((--kc-space-\d)\)/.exec(
          szabalyTorzs(ui, '.kc-button'),
        )?.[1] ?? '',
      ) ?? '',
    )
    expect(gombBelso).toBeGreaterThan(0)

    const nezetablak = 320
    const dobozBelvilag = nezetablak - 2 * oldalMargo - 2 * dobozBelso - 2
    expect(dobozBelvilag).toBe(206)

    // A gomb doboza legfeljebb a belvilág; a feliratnak ezen belül kell
    // elférnie a belső margóval és a 2px keretpárral együtt. Ha nem fér, a
    // felirat TÖRDEL (fenti állítás), tehát a lap akkor sem csordul túl —
    // a mérés itt a leghosszabb TÖRHETETLEN szót nézi.
    const LEGSZELESEBB_KARAKTER_EM = 0.6
    const feliratSav = dobozBelvilag - 2 * gombBelso - 4
    for (const felirat of [VART.igenylesFelirat, VART.kurzusaimFelirat]) {
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
