import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import type { Payload } from 'payload'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetAlertThrottle } from '../lib/alert-throttle'
import type { AuditLogStore } from '../lib/audit'
import { KAPCSOLATI_EMAIL_TARTALEK } from '../lib/contact-email'
import { EMAIL_SZINEK, escapeHtml, inlineLinkHtml } from '../lib/email/templates/layout'
import {
  ORDER_CONFIRMATION_TEMPLATE_VERSION,
  WAIVER_LOSS_STATEMENT,
  WAIVER_START_STATEMENT,
  hatarozottNevelo,
  orderConfirmationEmail,
} from '../lib/email/templates/order'
import {
  ASZF_MELLEKLET_FAJLNEV,
  loadOrderLegalInfo,
  orderLegalInfoFromAszf,
  orderLegalInfoFromAszfPage,
  type OrderLegalInfo,
  type SellerIdentity,
} from '../lib/email/templates/order-legal'
import type { SendResult } from '../lib/email/types'
import {
  JOGI_OLDALAK,
  jogiOldalTartalom,
  jogiRichText,
  parseJogiForras,
} from '../lib/legal-content'
import type { LogContext, Logger } from '../lib/logger'
import {
  CONFIRMATION_RETRY_DELAYS_MS,
  ORDER_CONFIRMATION_AUDIT_ACTION,
  onOrderPaid,
  type ConfirmationMailInput,
  type OnOrderPaidDeps,
} from '../lib/order-paid'
import type { Order } from '../payload-types'

/**
 * A vásárlás-visszaigazoló JOGI tartalma és a küldés megbízhatósága.
 *
 * MI A TÉT: a 45/2014. (II. 26.) Korm. rendelet 29. § (1) m) pontja szerint a
 * digitális tartalomra az elállási jog kizárása CSAK akkor él, ha a vállalkozás
 * a 18. § szerint tartós adathordozón visszaigazolta a vevő két nyilatkozatát,
 * és megadta a 11. § (1) szerinti tájékoztatást. Ha a levél ezt nem hordozza,
 * vagy nem megy ki, a vevő a teljes kurzus megnézése után is elállhat (27. §
 * b) bc)). Ezek a tesztek ezt a láncot őrzik: a levél tartalmát, az ÁSZF
 * mellékletet, az újrapróbát, a riasztást és a küldés bizonyítékát.
 *
 * Hálózati hívás nincs: a küldő, a műveletnapló és a várakozás injektált
 * (CLAUDE.md 15. tanulság).
 */

const ORDER_NUMBER = 'KH-2026-000777'
/** 12:05 UTC = 14:05 budapesti nyári idő (CEST, UTC+2). */
const WAIVER_AT = '2026-09-24T12:05:00.000Z'
const WAIVER_AT_BUDAPEST = '2026. 09. 24. 14:05'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const ASZF = readFileSync(`${REPO_ROOT}src/lib/legal-source/aszf.txt`, 'utf8')
const LEGAL: OrderLegalInfo = orderLegalInfoFromAszf(ASZF)

/**
 * A közzétett /aszf oldal tartalma, ahogy a tartalom-job létrehozza
 * (src/lib/legal-content.ts): a levél ALAPBÓL ebből épül (H10).
 */
const ASZF_LEIRAS = JOGI_OLDALAK.find((oldal) => oldal.slug === 'aszf')
if (ASZF_LEIRAS === undefined) {
  throw new Error('TESZT: nincs ÁSZF a JOGI_OLDALAK-ban')
}
const PUBLIKALT_ASZF = jogiOldalTartalom(ASZF_LEIRAS)
/** A közzétett oldalból épült jogi csomag (lustán: a modul betöltése ne múljon rajta). */
const oldalLegal = (): OrderLegalInfo | null => orderLegalInfoFromAszfPage(PUBLIKALT_ASZF)

/**
 * Az onOrderPaid a mai éles állapottal: közzétett ÁSZF-oldal és a kapcsolati
 * cím (K14) injektálva. A tesztek így a levél tartalmát és a küldést mérik,
 * nem a hiányzó adatbázis tartalék-ágát (azt külön tesztek fedik).
 */
function futtasd(deps: OnOrderPaidDeps): Promise<void> {
  return onOrderPaid({
    loadPublishedAszf: async () => ({ content: PUBLIKALT_ASZF }),
    loadSupportEmail: async () => KAPCSOLATI_EMAIL_TARTALEK,
    ...deps,
  })
}

function createOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 777,
    orderNumber: ORDER_NUMBER,
    status: 'paid',
    customerEmail: 'anna@example.test',
    totalHufSnapshot: 19990,
    items: [
      { product: 42, quantity: 1, titleSnapshot: 'Otthoni KézRehab', priceHufSnapshot: 19990 },
    ],
    customerSnapshot: { name: 'Teszt Anna', email: 'anna@example.test' },
    consentWithdrawalWaiver: true,
    consentWithdrawalWaiverAt: WAIVER_AT,
    ...overrides,
  } as unknown as Order
}

interface CapturedLogEntry {
  level: 'debug' | 'info' | 'warn' | 'error'
  msg: string
  context?: LogContext
}

function createCapturingLogger(): { log: Logger; entries: CapturedLogEntry[] } {
  const entries: CapturedLogEntry[] = []
  const write =
    (level: CapturedLogEntry['level']) =>
    (msg: string, context?: LogContext): void => {
      entries.push(context === undefined ? { level, msg } : { level, msg, context })
    }
  const log: Logger = {
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
    child: () => log,
  }
  return { log, entries }
}

const errorsOf = (entries: CapturedLogEntry[]): CapturedLogEntry[] =>
  entries.filter((entry) => entry.level === 'error')

/** Rögzítő műveletnapló: a `create` hívásait gyűjti. */
function createAuditStore(fail = false): {
  store: AuditLogStore
  created: Array<Record<string, unknown>>
} {
  const created: Array<Record<string, unknown>> = []
  const store: AuditLogStore = {
    create: async (args) => {
      if (fail) {
        throw new Error('DB nem elérhető')
      }
      created.push(args.data)
      return { id: created.length }
    },
  }
  return { store, created }
}

/** Sikeres Resend-küldést szimuláló küldő, a hívások gyűjtésével. */
function createSender(results: SendResult[] = [{ ok: true, provider: 'resend', id: 're_123' }]) {
  const calls: ConfirmationMailInput[] = []
  let index = 0
  const send = async (input: ConfirmationMailInput): Promise<SendResult> => {
    calls.push(input)
    const result = results[Math.min(index, results.length - 1)]
    index += 1
    return result
  }
  return { send, calls }
}

/** Hangosan dobó várakozás: ahol újrapróbának NEM szabad futnia. */
const nemVarhat = async (): Promise<void> => {
  throw new Error('TESZT: ezen az ágon NEM szabad újrapróbálni')
}

beforeEach(() => {
  resetAlertThrottle()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

// ---------------------------------------------------------------------------
// A sablon jogi tartalma
// ---------------------------------------------------------------------------

describe('orderConfirmationEmail: a 18. § szerinti visszaigazolás tartalma', () => {
  const level = orderConfirmationEmail({
    orderNumber: ORDER_NUMBER,
    buyerName: 'Teszt Anna',
    items: [
      { title: 'Otthoni KézRehab', quantity: 1, totalHuf: 19990, accessDurationDays: null },
      { title: 'Szakmai kurzus', quantity: 1, totalHuf: 49990, accessDurationDays: 90 },
      { title: 'Ismeretlen hosszú', quantity: 1, totalHuf: 1000 },
    ],
    totalHuf: 70980,
    coursesUrl: 'https://pelda.hu/kurzusaim',
    invoiceNote: true,
    withdrawalWaiver: { given: true, at: WAIVER_AT },
    seller: LEGAL.seller,
    terms: { url: 'https://pelda.hu/aszf', attachment: LEGAL.aszf.attachment },
    supportEmail: KAPCSOLATI_EMAIL_TARTALEK,
  })
  const text = level.text.replace(/ /g, ' ')

  it('visszaigazolja a két nyilatkozatot, szó szerint és a budapesti időponttal', () => {
    expect(text).toContain('Az elállási jogodról:')
    expect(text).toContain(`(${WAIVER_AT_BUDAPEST})`)
    expect(text).toContain(`„${WAIVER_START_STATEMENT}”`)
    expect(text).toContain(`„${WAIVER_LOSS_STATEMENT}”`)
    expect(text).toContain('mindkét nyilatkozatodat visszaigazoljuk')
    expect(level.html).toContain('<strong>Az elállási jogodról:</strong>')
  })

  it('a szolgáltató adatai az ÁSZF-ből: név, székhely, cégjegyzékszám, adószám, e-mail, telefon', () => {
    expect(text).toContain('A szolgáltató adatai:')
    expect(text).toContain('KINETICARE Kft.')
    expect(text).toContain('Székhely: 8360 Keszthely, Kacsóh Pongrác utca 1. 2a. ép.')
    expect(text).toContain('Cégjegyzékszám: 20-09-079468 (Zalaegerszegi Törvényszék Cégbírósága)')
    expect(text).toContain('Adószám: 32697865-1-20')
    expect(text).toContain('E-mail: egeszsegmozgastamogatas@gmail.com')
    expect(text).toContain('Telefon: +36 20 357 3493')
  })

  it('panaszkezelés: hova, milyen határidővel, és a békéltető testület', () => {
    expect(text).toContain('Ha panaszod van:')
    // K14: az e-mailes panasz a kapcsolati címre megy, a postai a székhelyre.
    expect(text).toContain(
      `írd meg nekünk e-mailben az ${KAPCSOLATI_EMAIL_TARTALEK} címre, vagy postai levélben a fenti székhelyünkre, amely egyben a panaszügyintézés helye is.`,
    )
    expect(text).toContain('Legkésőbb 30 napon belül írásban válaszolunk.')
    expect(text).toContain('békéltető testülethez')
    expect(text).toContain('www.bekeltetes.hu')
    expect(text).toContain('kellékszavatossági')
  })

  it('a kurzus fő jellemzői: online, nem tárgyi adathordozón nyújtott digitális tartalom', () => {
    expect(text).toContain('A kurzusról:')
    expect(text).toContain('nem tárgyi adathordozón nyújtott digitális tartalmat')
    expect(text).toContain('Google Chrome vagy a Safari')
  })

  it('fizetendő végösszeg (az ÁSZF szavával, áfa-utalás nélkül) és tételenként a hozzáférés hossza', () => {
    // H16: AAM mellett a „bruttó” áfa-tartalmat sugallna; az ÁSZF szava a
    // „fizetendő végösszeg”, ami áfás számlázásnál is igaz marad.
    expect(text).toContain('Fizetendő végösszeg: 70 980 Ft')
    expect(level.html).toContain('Fizetendő végösszeg')
    expect(text).not.toMatch(/bruttó/iu)
    expect(level.html).not.toMatch(/bruttó/iu)
    expect(text).toContain('Otthoni KézRehab, 1 db, a hozzáférés nem jár le, 19 990 Ft')
    expect(text).toContain('Szakmai kurzus, 1 db, 90 napos hozzáférés, 49 990 Ft')
    // Ismeretlen hossznál a levél nem állít semmit. (A négyjegyű összeget a
    // hu-HU formázás nem tagolja: „1000 Ft".)
    expect(text).toContain('Ismeretlen hosszú, 1 db, 1000 Ft')
  })

  it('a szöveges változatban a jogi bekezdéseket üres sor választja el', () => {
    expect(text).toContain(
      'visszaigazoljuk. A hozzáférést a kérésednek megfelelően azonnal megnyitottuk.\n\nA kurzusról:',
    )
    expect(text).toContain('Telefon: +36 20 357 3493\n\nHa panaszod van:')
  })

  it('az ÁSZF mellékletként megy (link önmagában nem tartós adathordozó, C-49/11)', () => {
    expect(level.attachments).toHaveLength(1)
    expect(level.attachments?.[0]).toMatchObject({
      filename: ASZF_MELLEKLET_FAJLNEV,
      contentType: 'text/plain; charset=utf-8',
    })
    expect(level.attachments?.[0].content).toContain('Általános Szerződési Feltételei')
    expect(text).toContain(
      `a teljes szövegét mellékeltük ehhez a levélhez (${ASZF_MELLEKLET_FAJLNEV}), így bármikor újra elolvashatod. A weboldalon is megtalálod: https://pelda.hu/aszf`,
    )
    expect(text).not.toContain('hogy később is meglegyen')
  })

  it('a HTML-ben az ÁSZF webcíme kattintható, kiírt link (GOV.UK, WCAG 2.2 SC 2.4.4)', () => {
    expect(level.html).toContain(
      'A weboldalon is megtalálod: <a href="https://pelda.hu/aszf" style="color:#2f6e9f;text-decoration:underline;word-break:break-all;">https://pelda.hu/aszf</a>',
    )
  })

  it('a link színe fehéren ≥ 4,5:1, a szövegtől színben < 3:1, ezért aláhúzott (SC 1.4.3, 1.4.1)', () => {
    const csatorna = (ertek: number): number => {
      const c = ertek / 255
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }
    const fenyesseg = (hex: string): number => {
      const [r, g, b] = [1, 3, 5].map((i) => csatorna(Number.parseInt(hex.slice(i, i + 2), 16)))
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const arany = (a: string, b: string): number => {
      const [vilagos, sotet] = [fenyesseg(a), fenyesseg(b)].sort((x, y) => y - x)
      return (vilagos + 0.05) / (sotet + 0.05)
    }
    expect(arany(EMAIL_SZINEK.akcent, EMAIL_SZINEK.feher)).toBeGreaterThanOrEqual(4.5)
    expect(arany(EMAIL_SZINEK.akcent, EMAIL_SZINEK.inkHalk)).toBeLessThan(3)
    expect(inlineLinkHtml('https://pelda.hu/aszf')).toContain('text-decoration:underline')
  })

  it('megválaszolható: a lábléc a kapcsolati címre terel (K14), nem „ne válaszolj"', () => {
    expect(text).toContain(
      `Válaszolj erre a levélre, vagy írj az ${KAPCSOLATI_EMAIL_TARTALEK} címre.`,
    )
    expect(text).not.toContain('a(z) info@')
    expect(text).toContain(`rendelésszám: ${ORDER_NUMBER}`)
    expect(text).not.toContain('ne válaszolj')
  })

  it('a szolgáltató adatai az ÁSZF-et követik (jogi azonosítás), a kapcsolati cím ettől független', () => {
    expect(text).toContain('E-mail: egeszsegmozgastamogatas@gmail.com')
    expect(text).not.toContain('írj az egeszsegmozgastamogatas@gmail.com')
    expect(text).not.toContain('írj a egeszsegmozgastamogatas@gmail.com')
  })

  it('a számla-mondat a gomb UTÁN, de a hosszú jogi rész ELŐTT áll (NN/g)', () => {
    for (const valtozat of [text, level.html]) {
      const cta = valtozat.indexOf('https://pelda.hu/kurzusaim')
      const szamla = valtozat.indexOf(
        'A számlát a Számlázz.hu rendszeréből külön e-mailben küldjük el.',
      )
      const jogi = valtozat.indexOf('Az elállási jogodról')
      expect(cta).toBeGreaterThan(0)
      expect(szamla).toBeGreaterThan(cta)
      expect(jogi).toBeGreaterThan(szamla)
    }
    expect(text).toContain(
      'A számlát a Számlázz.hu rendszeréből külön e-mailben küldjük el.\n\nAz elállási jogodról:',
    )
  })

  /**
   * H12: a vevők levelezője a HTML-részt mutatja. Ha a HTML-ből egy jogi sor
   * kimaradna (a szöveges rész ép marad), a 18. § szerinti visszaigazolás
   * hiányos lenne, és ezt semmi nem jelezné. A teszt a szöveges rész minden
   * sorát a számla-mondattól a lábléc végéig a HTML-ben is megköveteli.
   */
  it('a HTML-rész minden jogi sort hordoz, amit a szöveges rész (paritás)', () => {
    const htmlSzoveg = level.html
      .replace(/<br \/>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/ /g, ' ')
    const eleje = text.indexOf('A számlát a Számlázz.hu')
    expect(eleje).toBeGreaterThan(0)
    const sorok = text
      .slice(eleje)
      .split('\n')
      .map((sor) => sor.trim())
      .filter((sor) => sor.length > 0)
    expect(sorok.length).toBeGreaterThanOrEqual(14)
    expect(sorok.some((sor) => sor.includes(WAIVER_START_STATEMENT))).toBe(true)
    expect(sorok.some((sor) => sor.startsWith('Ezt a levelet azért kapod'))).toBe(true)
    for (const sor of sorok) {
      expect(htmlSzoveg, sor).toContain(sor)
    }
    for (const cimke of [
      'Az elállási jogodról',
      'A kurzusról',
      'Általános szerződési feltételek (ÁSZF)',
      'A szolgáltató adatai',
      'Ha panaszod van',
    ]) {
      expect(level.html).toContain(`<strong>${escapeHtml(cimke)}:</strong>`)
    }
  })

  it('a jogi rész a gomb UTÁN áll (elöl a rendelés és a hozzáférés, NN/g)', () => {
    const ctaIndex = level.html.indexOf('https://pelda.hu/kurzusaim')
    const legalIndex = level.html.indexOf('Az elállási jogodról')
    expect(ctaIndex).toBeGreaterThan(0)
    expect(legalIndex).toBeGreaterThan(ctaIndex)
  })

  it('natív magyar írásjelek: nincs kvirtmínusz és nincs töltelék-gondolatjel (§3.1.2)', () => {
    expect(level.text).not.toContain('—')
    expect(level.html).not.toContain('—')
    expect(level.text).not.toMatch(/ – /u)
  })

  it('nyilatkozat nélküli rendelésnél NEM igazol vissza olyat, ami nem történt meg', () => {
    const nelkul = orderConfirmationEmail({
      orderNumber: ORDER_NUMBER,
      items: [],
      totalHuf: 0,
      coursesUrl: 'https://pelda.hu/kurzusaim',
      invoiceNote: false,
      // Az időpont a nyilatkozat NÉLKÜL sem vezethet visszaigazoláshoz.
      withdrawalWaiver: { given: false, at: WAIVER_AT },
      seller: LEGAL.seller,
      terms: { url: 'https://pelda.hu/aszf', attachment: LEGAL.aszf.attachment },
    })
    expect(nelkul.text).not.toContain('Az elállási jogodról')
    expect(nelkul.text).not.toContain(WAIVER_LOSS_STATEMENT)
  })

  it('hibás időbélyegnél a visszaigazolás időpont nélkül megy, nem dob', () => {
    const hibas = orderConfirmationEmail({
      orderNumber: ORDER_NUMBER,
      items: [],
      totalHuf: 0,
      coursesUrl: 'https://pelda.hu/kurzusaim',
      invoiceNote: false,
      withdrawalWaiver: { given: true, at: 'nem-datum' },
    })
    expect(hibas.text).toContain(
      'Az elállási jogodról: a rendelésed leadásakor két nyilatkozatot tettél.',
    )
  })

  it('megtett nyilatkozat rögzítetlen időponttal: időpont nélkül igazol vissza (nincs üres-szöveg jel)', () => {
    const idoNelkul = orderConfirmationEmail({
      orderNumber: ORDER_NUMBER,
      items: [],
      totalHuf: 0,
      coursesUrl: 'https://pelda.hu/kurzusaim',
      invoiceNote: false,
      withdrawalWaiver: { given: true, at: null },
    })
    expect(idoNelkul.text).toContain(
      'Az elállási jogodról: a rendelésed leadásakor két nyilatkozatot tettél.',
    )
  })

  it('melléklet nélkül csak a link áll, és a levél nem állítja, hogy csatoltuk', () => {
    const linkkel = orderConfirmationEmail({
      orderNumber: ORDER_NUMBER,
      items: [],
      totalHuf: 0,
      coursesUrl: 'https://pelda.hu/kurzusaim',
      invoiceNote: false,
      terms: { url: 'https://pelda.hu/aszf', attachment: null },
    })
    expect(linkkel.attachments).toBeUndefined()
    expect(linkkel.text).toContain(
      'a teljes szövegét a weboldalon olvashatod: https://pelda.hu/aszf',
    )
    expect(linkkel.text).not.toContain('mellékeltük')
  })

  it('kapcsolati cím nélkül a lábléc a megszokott „ne válaszolj" sor marad', () => {
    const regi = orderConfirmationEmail({
      orderNumber: ORDER_NUMBER,
      items: [],
      totalHuf: 0,
      coursesUrl: 'https://pelda.hu/kurzusaim',
      invoiceNote: false,
    })
    expect(regi.text).toContain('ne válaszolj')
    expect(regi.text).not.toContain('A szolgáltató adatai')
  })

  it('a kapcsolati cím a szolgáltatói adatoktól függetlenül megválaszolhatóvá teszi a levelet (K14)', () => {
    const adatNelkul = orderConfirmationEmail({
      orderNumber: ORDER_NUMBER,
      items: [],
      totalHuf: 0,
      coursesUrl: 'https://pelda.hu/kurzusaim',
      invoiceNote: false,
      seller: null,
      supportEmail: KAPCSOLATI_EMAIL_TARTALEK,
    })
    expect(adatNelkul.text).toContain(`írj az ${KAPCSOLATI_EMAIL_TARTALEK} címre`)
    expect(adatNelkul.text).not.toContain('ne válaszolj')
  })
})

describe('hatarozottNevelo: a/az a kapcsolati cím előtt', () => {
  it.each([
    ['info@kineticare.hu', 'az'],
    ['Info@kineticare.hu', 'az'],
    ['ügyfél@pelda.hu', 'az'],
    ['orvos@pelda.hu', 'az'],
    ['1rendelo@pelda.hu', 'az'],
    ['5let@pelda.hu', 'az'],
    ['kapcsolat@pelda.hu', 'a'],
    ['segitseg@pelda.hu', 'a'],
    ['2rendelo@pelda.hu', 'a'],
  ])('%s → %s', (cim, nevelo) => {
    expect(hatarozottNevelo(cim)).toBe(nevelo)
  })

  it('más kapcsolati címnél a lábléc és a panasz-sor a helyes névelőt kapja', () => {
    const level = orderConfirmationEmail({
      orderNumber: ORDER_NUMBER,
      items: [],
      totalHuf: 0,
      coursesUrl: 'https://pelda.hu/kurzusaim',
      invoiceNote: false,
      seller: LEGAL.seller,
      supportEmail: 'kapcsolat@pelda.hu',
    })
    expect(level.text).toContain('vagy írj a kapcsolat@pelda.hu címre.')
    expect(level.text).toContain('e-mailben a kapcsolat@pelda.hu címre')
  })
})

/**
 * ŐR: a sablonváltozat a renderelt szöveghez kötve. A műveletnapló a
 * `templateVersion`-ből bizonyítja, melyik szövegű levél ment ki; ha a szöveg
 * változik, de a változat nem lép, a bizonyíték hamis lenne. A bemenet
 * SZÁNDÉKOSAN kitalált (nem az aszf.txt): az ÁSZF változása nem a sablon
 * változása, annak saját ujjlenyomata van (aszfSha256).
 *
 * Ha ez a teszt bukik: léptesd az ORDER_CONFIRMATION_TEMPLATE_VERSION-t
 * (src/lib/email/templates/order.ts), és vedd fel az új változatot az új
 * ujjlenyomattal. Régi sort ne írj át.
 */
describe('sablonváltozat: a renderelt szöveg ujjlenyomatához kötve', () => {
  const UJJLENYOMATOK: Readonly<Record<string, string>> = {
    '2026-09-24.2': '84d807355613a580f487f03e2159ee6166ae5fe89a8a55f842a95ce24ce3c82a',
  }

  const szolgaltato: SellerIdentity = {
    name: 'Minta Kft.',
    seat: '1000 Budapest, Minta utca 1.',
    companyRegistrationNumber: '01-09-000000',
    registryCourt: 'Fővárosi Törvényszék Cégbírósága',
    taxNumber: '00000000-1-00',
    email: 'ceg@pelda.hu',
    phone: '+36301234567',
    complaintHandledAtSeat: true,
  }
  const melleklet = { filename: 'Minta.txt', content: 'x', contentType: 'text/plain' }

  const szovegek = (): string =>
    [
      orderConfirmationEmail({
        orderNumber: 'MINTA-1',
        buyerName: 'Minta Anna',
        items: [{ title: 'Minta kurzus', quantity: 1, totalHuf: 1000, accessDurationDays: null }],
        totalHuf: 1000,
        coursesUrl: 'https://pelda.hu/kurzusaim',
        invoiceNote: true,
        account: {
          kind: 'password-setup',
          activationUrl: 'https://pelda.hu/aktivalas',
          expiresInDays: 7,
          email: 'anna@pelda.hu',
        },
        withdrawalWaiver: { given: true, at: WAIVER_AT },
        seller: szolgaltato,
        terms: { url: 'https://pelda.hu/aszf', attachment: melleklet },
        supportEmail: 'info@pelda.hu',
      }).text,
      orderConfirmationEmail({
        orderNumber: 'MINTA-2',
        items: [{ title: 'Minta kurzus', quantity: 2, totalHuf: 2000, accessDurationDays: 30 }],
        totalHuf: 2000,
        coursesUrl: 'https://pelda.hu/kurzusaim',
        invoiceNote: false,
        account: { kind: 'login', loginUrl: 'https://pelda.hu/belepes', email: 'anna@pelda.hu' },
        withdrawalWaiver: { given: false, at: null },
        seller: szolgaltato,
        terms: { url: 'https://pelda.hu/aszf', attachment: null },
        supportEmail: 'kapcsolat@pelda.hu',
      }).text,
      orderConfirmationEmail({
        orderNumber: 'MINTA-3',
        items: [],
        totalHuf: 0,
        coursesUrl: 'https://pelda.hu/kurzusaim/1',
        invoiceNote: false,
      }).text,
    ].join('\n=====\n')

  it('a mostani változat ujjlenyomata egyezik a renderelt szövegével', () => {
    const ujjlenyomat = createHash('sha256').update(szovegek(), 'utf8').digest('hex')
    expect(ORDER_CONFIRMATION_TEMPLATE_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/u)
    expect(
      UJJLENYOMATOK[ORDER_CONFIRMATION_TEMPLATE_VERSION],
      'A levél szövege változott: léptesd az ORDER_CONFIRMATION_TEMPLATE_VERSION-t, és vedd fel az új ujjlenyomatot.',
    ).toBe(ujjlenyomat)
  })

  it('minden rögzített változat ujjlenyomata különböző (egy szöveg, egy változat)', () => {
    const ertekek = Object.values(UJJLENYOMATOK)
    expect(new Set(ertekek).size).toBe(ertekek.length)
  })
})

/**
 * ŐR: a levél a pénztár jelölőnégyzeteinek SZÓ SZERINTI szövegét idézi. Ha a
 * pénztárban valaki átírja a nyilatkozatot, a levél már nem azt igazolná
 * vissza, amit a vevő elfogadott, ezért ez a teszt ilyenkor bukik.
 */
describe('a visszaigazolt nyilatkozat = a pénztárban elfogadott nyilatkozat', () => {
  const checkout = readFileSync(`${REPO_ROOT}src/components/checkout/CheckoutForm.tsx`, 'utf8')
  const normalized = checkout.replace(/\s+/g, ' ')

  it.each([
    ['azonnali hozzáférés kérése', WAIVER_START_STATEMENT],
    ['az elállási jog elvesztésének tudomásulvétele', WAIVER_LOSS_STATEMENT],
  ])('%s: a CheckoutForm.tsx pontosan ezt a szöveget jeleníti meg', (_nev, statement) => {
    expect(normalized).toContain(statement)
  })
})

// ---------------------------------------------------------------------------
// onOrderPaid: küldés, újrapróba, riasztás, bizonyíték
// ---------------------------------------------------------------------------

describe('onOrderPaid: a jogi visszaigazoló levél kiküldése', () => {
  it('a levél a nyilatkozatokkal, az ÁSZF-melléklettel és válaszcímmel megy, a küldés a műveletnaplóba kerül', async () => {
    const { send, calls } = createSender()
    const { store, created } = createAuditStore()
    const { log, entries } = createCapturingLogger()

    await futtasd({
      payload: {} as unknown as Payload,
      order: createOrder(),
      logger: log,
      queueInvoice: async () => true,
      send,
      auditStore: store,
      loadAccessDurations: async () => new Map([[42, null]]),
      sleep: nemVarhat,
    })

    expect(calls).toHaveLength(1)
    const message = calls[0]
    expect(message.to).toBe('anna@example.test')
    // K14: a válaszcím a kapcsolati cím, nem az ÁSZF-ben álló cég-e-mail.
    expect(message.replyTo).toBe(KAPCSOLATI_EMAIL_TARTALEK)
    expect(message.idempotencyKey).toBe('kineticare-order-confirmation-777')
    expect(message.attachments?.[0]?.filename).toBe(ASZF_MELLEKLET_FAJLNEV)
    expect(message.text).toContain(`„${WAIVER_START_STATEMENT}”`)
    expect(message.text).toContain(WAIVER_AT_BUDAPEST)
    expect(message.text).toContain('Adószám: 32697865-1-20')
    expect(message.text.replace(/ /g, ' ')).toContain('a hozzáférés nem jár le')

    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({
      action: ORDER_CONFIRMATION_AUDIT_ACTION,
      entityType: 'orders',
      entityId: '777',
      after: {
        orderNumber: ORDER_NUMBER,
        recipient: 'anna@example.test',
        provider: 'resend',
        providerMessageId: 're_123',
        attempts: 1,
        templateVersion: ORDER_CONFIRMATION_TEMPLATE_VERSION,
        withdrawalWaiverConfirmed: true,
        withdrawalWaiverAt: WAIVER_AT,
        sellerIncluded: true,
        sellerSource: 'cms',
        aszfAttached: true,
        aszfAttachmentDropped: false,
        aszfSource: 'cms',
        // A TÉNYLEGESEN felhasznált szöveg (a közzétett oldalé) ujjlenyomata.
        aszfSha256: oldalLegal()?.aszf.sha256,
        aszfKelt: '2025. 07.05.',
        replyTo: KAPCSOLATI_EMAIL_TARTALEK,
      },
    })
    const after = created[0].after as Record<string, unknown>
    expect(after.aszfSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(typeof after.sentAt).toBe('string')
    expect(errorsOf(entries)).toHaveLength(0)
  })

  it('nyilatkozat nélküli rendelés: nincs visszaigazolt nyilatkozat, és a napló is ezt rögzíti', async () => {
    const { send, calls } = createSender()
    const { store, created } = createAuditStore()

    await futtasd({
      payload: {} as unknown as Payload,
      order: createOrder({ consentWithdrawalWaiver: false, consentWithdrawalWaiverAt: null }),
      logger: createCapturingLogger().log,
      queueInvoice: async () => true,
      send,
      auditStore: store,
      loadAccessDurations: async () => new Map(),
      sleep: nemVarhat,
    })

    expect(calls[0].text).not.toContain('Az elállási jogodról')
    expect(created[0]).toMatchObject({
      after: { withdrawalWaiverConfirmed: false, withdrawalWaiverAt: null },
    })
  })

  it('átmeneti hiba: újrapróbál ugyanazzal az idempotencia-kulccsal, 2 és 6 mp várakozással', async () => {
    const { send, calls } = createSender([
      { ok: false, provider: 'resend', retryable: true, error: 'HTTP 503' },
      { ok: false, provider: 'resend', retryable: true, error: 'HTTP 429' },
      { ok: true, provider: 'resend', id: 're_retry' },
    ])
    const { store, created } = createAuditStore()
    const { log, entries } = createCapturingLogger()
    const waits: number[] = []

    await futtasd({
      payload: {} as unknown as Payload,
      order: createOrder(),
      logger: log,
      queueInvoice: async () => true,
      send,
      auditStore: store,
      loadAccessDurations: async () => new Map(),
      sleep: async (ms) => {
        waits.push(ms)
      },
    })

    expect(calls).toHaveLength(3)
    expect(new Set(calls.map((call) => call.idempotencyKey)).size).toBe(1)
    expect(waits).toEqual([...CONFIRMATION_RETRY_DELAYS_MS])
    expect(waits).toEqual([2_000, 6_000])
    expect(created[0]).toMatchObject({ after: { attempts: 3, providerMessageId: 're_retry' } })
    expect(errorsOf(entries)).toHaveLength(0)
  })

  it('végleges hiba (retryable: false): ugyanazt nem próbálja újra, RIASZT, és nem rögzít küldést', async () => {
    // A mellékletes levél végleges elutasítása után EGY melléklet nélküli
    // próba jár (lásd order-paid-aszf-forras.test.ts); itt az is elbukik.
    const { send, calls } = createSender([
      { ok: false, provider: 'resend', retryable: false, error: 'HTTP 422' },
    ])
    const { store, created } = createAuditStore()
    const { log, entries } = createCapturingLogger()

    await futtasd({
      payload: {} as unknown as Payload,
      order: createOrder(),
      logger: log,
      queueInvoice: async () => true,
      send,
      auditStore: store,
      loadAccessDurations: async () => new Map(),
      sleep: nemVarhat,
    })

    expect(
      calls.filter((call) => call.idempotencyKey === 'kineticare-order-confirmation-777'),
    ).toHaveLength(1)
    expect(calls).toHaveLength(2)
    expect(calls[1].attachments).toBeUndefined()
    expect(created).toHaveLength(0)
    const alerts = errorsOf(entries)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].msg).toContain('RIASZTÁS')
    expect(alerts[0].msg).toContain('18. §')
    expect(alerts[0].context).toMatchObject({ attempts: 2, retryable: false })
  })

  it('minden kísérlet elbukik: 3 próba után egyetlen RIASZTÁS, küldés nincs rögzítve', async () => {
    const { send, calls } = createSender([
      { ok: false, provider: 'resend', retryable: true, error: 'HTTP 500' },
    ])
    const { store, created } = createAuditStore()
    const { log, entries } = createCapturingLogger()

    await futtasd({
      payload: {} as unknown as Payload,
      order: createOrder(),
      logger: log,
      queueInvoice: async () => true,
      send,
      auditStore: store,
      loadAccessDurations: async () => new Map(),
      sleep: async () => {},
    })

    expect(calls).toHaveLength(1 + CONFIRMATION_RETRY_DELAYS_MS.length)
    expect(created).toHaveLength(0)
    const alerts = errorsOf(entries)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].context).toMatchObject({ attempts: 3 })
  })

  it('élesben a noop-szolgáltató NEM visszaigazolás: RIASZT, és nem rögzít küldést', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { send } = createSender([{ ok: true, provider: 'noop' }])
    const { store, created } = createAuditStore()
    const { log, entries } = createCapturingLogger()

    await futtasd({
      payload: {} as unknown as Payload,
      order: createOrder(),
      logger: log,
      queueInvoice: async () => true,
      send,
      auditStore: store,
      loadAccessDurations: async () => new Map(),
      sleep: nemVarhat,
    })

    expect(created).toHaveLength(0)
    const alerts = errorsOf(entries)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].msg).toContain('nincs e-mail-szolgáltató beállítva')
  })

  it('fejlesztői környezetben a noop csak szimuláció: nincs riasztás és nincs napló-bejegyzés', async () => {
    const { send } = createSender([{ ok: true, provider: 'noop' }])
    const { store, created } = createAuditStore()
    const { log, entries } = createCapturingLogger()

    await futtasd({
      payload: {} as unknown as Payload,
      order: createOrder(),
      logger: log,
      queueInvoice: async () => true,
      send,
      auditStore: store,
      loadAccessDurations: async () => new Map(),
      sleep: nemVarhat,
    })

    expect(created).toHaveLength(0)
    expect(errorsOf(entries)).toHaveLength(0)
  })

  it('olvashatatlan ÁSZF (oldal és tartalék is): a levél kimegy (nyilatkozatokkal), de melléklet nélkül, és RIASZT', async () => {
    const { send, calls } = createSender()
    const { store, created } = createAuditStore()
    const { log, entries } = createCapturingLogger()

    await futtasd({
      payload: {} as unknown as Payload,
      order: createOrder(),
      logger: log,
      queueInvoice: async () => true,
      send,
      auditStore: store,
      loadAccessDurations: async () => new Map(),
      loadPublishedAszf: async () => {
        throw new Error('DB nem elérhető')
      },
      loadLegalInfo: () => {
        throw new Error('ENOENT: aszf.txt')
      },
      sleep: nemVarhat,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].attachments).toBeUndefined()
    // A válaszcím (K14) nem az ÁSZF-ből jön, ezért ilyenkor is megvan.
    expect(calls[0].replyTo).toBe(KAPCSOLATI_EMAIL_TARTALEK)
    expect(calls[0].text).toContain('Az elállási jogodról')
    expect(created[0]).toMatchObject({
      after: {
        aszfAttached: false,
        sellerIncluded: false,
        aszfSha256: null,
        aszfSource: null,
        sellerSource: null,
      },
    })
    const alerts = errorsOf(entries)
    expect(alerts.map((alert) => alert.msg)).toEqual([
      expect.stringContaining('a közzétett ÁSZF-oldal nem olvasható'),
      expect.stringContaining('az ÁSZF nem olvasható'),
    ])
  })

  it('hiányos ÁSZF-adatblokk (oldalon és tartalékban is): a szolgáltatói blokk kimarad, és RIASZT', async () => {
    const { send, calls } = createSender()
    const { store } = createAuditStore()
    const { log, entries } = createCapturingLogger()
    const adoszamNelkul = ASZF.replace(/Adószám:[^\n]*\n/u, '')

    await futtasd({
      payload: {} as unknown as Payload,
      order: createOrder(),
      logger: log,
      queueInvoice: async () => true,
      send,
      auditStore: store,
      loadAccessDurations: async () => new Map(),
      loadPublishedAszf: async () => ({ content: jogiRichText(parseJogiForras(adoszamNelkul)) }),
      loadLegalInfo: () => orderLegalInfoFromAszf(adoszamNelkul),
      sleep: nemVarhat,
    })

    expect(calls[0].text).not.toContain('A szolgáltató adatai')
    expect(calls[0].attachments).toHaveLength(1)
    const alerts = errorsOf(entries)
    expect(alerts).toHaveLength(2)
    expect(alerts[0].msg).toContain('a közzétett ÁSZF (/aszf) „KINETICARE adatai" blokkja')
    expect(alerts[1].msg).toContain('KINETICARE adatai')
    expect(alerts[1].msg).toContain('kimaradnak a szolgáltató adatai')
  })

  it('ha a bizonyíték nem kerül a műveletnaplóba, az is RIASZTÁS (a levél ettől kiment)', async () => {
    const { send, calls } = createSender()
    const { store } = createAuditStore(true)
    const { log, entries } = createCapturingLogger()
    vi.spyOn(console, 'log').mockImplementation(() => {})

    await futtasd({
      payload: {} as unknown as Payload,
      order: createOrder(),
      logger: log,
      queueInvoice: async () => true,
      send,
      auditStore: store,
      loadAccessDurations: async () => new Map(),
      sleep: nemVarhat,
    })

    expect(calls).toHaveLength(1)
    const alerts = errorsOf(entries)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].msg).toContain('bizonyítéka nem került a műveletnaplóba')
    expect(alerts[0].context).toMatchObject({ providerMessageId: 're_123' })
    vi.restoreAllMocks()
  })

  it('kivételt dobó küldő: nem dob tovább, de error-szintű RIASZTÁS lesz (nem csendes warn)', async () => {
    const { log, entries } = createCapturingLogger()

    await expect(
      futtasd({
        payload: {} as unknown as Payload,
        order: createOrder(),
        logger: log,
        queueInvoice: async () => true,
        send: async () => {
          throw new Error('váratlan')
        },
        auditStore: createAuditStore().store,
        loadAccessDurations: async () => new Map(),
        sleep: nemVarhat,
      }),
    ).resolves.toBeUndefined()

    const alerts = errorsOf(entries)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].msg).toContain('kivétellel leállt')
  })
})

describe('onOrderPaid: a hozzáférés hossza a termékből', () => {
  it('az alapértelmezett lekérdezés a products collectionből, csak a szükséges mezővel olvas', async () => {
    const find = vi.fn(async () => ({ docs: [{ id: 42, accessDurationDays: 30 }] }))
    const { send, calls } = createSender([{ ok: true, provider: 'noop' }])

    await futtasd({
      payload: { find } as unknown as Payload,
      order: createOrder(),
      logger: createCapturingLogger().log,
      queueInvoice: async () => true,
      send,
      sleep: nemVarhat,
    })

    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'products',
        where: { id: { in: [42] } },
        depth: 0,
        overrideAccess: true,
        select: { accessDurationDays: true },
      }),
    )
    expect(calls[0].text).toContain('30 napos hozzáférés')
  })

  it('populate-olt terméknél nem kérdez le, a dokumentum mezőjét használja', async () => {
    const { send, calls } = createSender([{ ok: true, provider: 'noop' }])
    const load = vi.fn(async () => new Map<number, number | null>())

    await futtasd({
      payload: {} as unknown as Payload,
      order: createOrder({
        items: [
          {
            product: { id: 42, accessDurationDays: null },
            quantity: 1,
            titleSnapshot: 'Otthoni KézRehab',
            priceHufSnapshot: 19990,
          },
        ] as unknown as Order['items'],
      }),
      logger: createCapturingLogger().log,
      queueInvoice: async () => true,
      send,
      loadAccessDurations: load,
      sleep: nemVarhat,
    })

    expect(load).not.toHaveBeenCalled()
    expect(calls[0].text.replace(/ /g, ' ')).toContain('a hozzáférés nem jár le')
  })

  it('lekérdezési hibánál a levél kimegy, és nem állít semmit a hozzáférés hosszáról', async () => {
    const { send, calls } = createSender([{ ok: true, provider: 'noop' }])
    const { log, entries } = createCapturingLogger()

    await futtasd({
      payload: {} as unknown as Payload,
      order: createOrder(),
      logger: log,
      queueInvoice: async () => true,
      send,
      loadAccessDurations: async () => {
        throw new Error('DB nem elérhető')
      },
      sleep: nemVarhat,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0].text).not.toContain('hozzáférés nem jár le')
    expect(calls[0].text).not.toContain('napos hozzáférés')
    expect(entries.some((entry) => entry.level === 'warn')).toBe(true)
    expect(errorsOf(entries)).toHaveLength(0)
  })
})

describe('loadOrderLegalInfo: a futásidejű forrás', () => {
  it('a repó gyökeréből (process.cwd()) a valódi aszf.txt-t olvassa', () => {
    const legal = loadOrderLegalInfo()
    expect(legal.seller?.name).toBe('KINETICARE Kft.')
    expect(legal.aszf.sha256).toBe(LEGAL.aszf.sha256)
  })

  it('olvasási hibánál DOB (a hívó riaszt), nem ad vissza üres adatot', () => {
    expect(() =>
      loadOrderLegalInfo(() => {
        throw new Error('ENOENT')
      }),
    ).toThrow('ENOENT')
  })
})
