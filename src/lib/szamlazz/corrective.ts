import type { Payload } from 'payload'

import type { Order } from '../../payload-types'
import { withAdvisoryLock } from '../advisory-lock'
import { logger as rootLogger, type Logger } from '../logger'
import {
  getSzamlazzConfig,
  isDuplicateOrderError,
  postInvoiceXml,
  type SzamlazzParsedSuccess,
} from './client'
import { buildInvoiceXml, buyerFromOrder } from './invoice'
import { queryInvoiceData, type InvoiceDataResult } from './invoice-data'
import { correctiveKulsoAzon, correctiveLookupKeys } from './kulso-azon'
import { queryInvoiceByKulsoAzon, type InvoiceLookupResult } from './pdf'
import { writeOrderInvoicingState, writeOrderInvoicingStateBestEffort } from './order-state'
import { claimManagedRefundDocument, managedRefundDocument } from './refund-guard'
import {
  SzamlazzApiError,
  type IssueCorrectiveInvoiceResult,
  type SzamlazzClientConfig,
  type SzamlazzVatMode,
} from './types'
import { budapestDateString, isIsoDateString } from './xml'

/**
 * Helyesbítő (módosító) számla RÉSZLEGES visszatérítéshez (C5).
 *
 * Miért nem stornó? A stornó az eredeti számla TELJES érvénytelenítése —
 * részleges visszatérítésnél a bizonylat helyes formája a helyesbítő
 * (módosító) számla, amely az eredetire hivatkozik, és csak a különbözetet
 * (a visszatérített összeget) hordozza negatív tételként. A teljes vs.
 * részleges döntést a refund összege hozza meg
 * (src/lib/refund/refund-order.ts).
 *
 * Séma-tények (https://docs.szamlazz.hu/hu/agent/basics/generate-invoice):
 * - a helyesbítő UGYANAZ az xmlszamla-művelet (action-xmlagentxmlfile), nem
 *   külön interfész (az a stornóé: xmlszamlast / action-szamla_agent_st);
 * - <fejlec><helyesbitoszamla>true</helyesbitoszamla> és
 *   <fejlec><helyesbitettSzamlaszam> = az EREDETI számla száma;
 * - a tételek a korrekciót hordozzák: negatív nettoEgysegar / nettoErtek /
 *   afaErtek / bruttoErtek (a Számlázz.hu nem számol, a tétel-matematikát
 *   validálja — ezért a computeLineAmounts abszolút értéken számol és utána
 *   előjelet vált, így a kerekítés pontosan tükrözi az eredeti tételt).
 *
 * Duplikáció-védelem — rétegek, eltérő szereppel (F14, r-szamlazz-12):
 * 1. Alkalmazás-oldal (ELSŐDLEGES): a rendelés correctiveInvoiceSeq mezője azt
 *    tárolja, hányadik refund-bejegyzéshez készült el a legutóbbi helyesbítő.
 *    Ha ez PONTOSAN a kért sorszám (és van correctiveInvoiceNumber), a
 *    szolgáltatás hálózati hívás nélkül 'already-issued' no-opot ad. A rövidzár
 *    SZIGORÚAN egyezésre szűkített: a kiállítás nem feltétlenül sorrendi — ha
 *    egy korábbi seq job-újrapróbálása (retry-queue) AZUTÁN fut le, hogy egy
 *    későbbi seq inline már kiállt, a recordedSeq nagyobb a kértnél, de a
 *    korábbi refund bizonylata MÉG NEM készült el, ezért a kérés továbbmegy.
 * 2. A beküldés ELŐTTI lekérdezés (K4) a globálisan egyedi szamlaKulsoAzon-on
 *    (kulso-azon.ts: rendelésszám + rendelés-id + létrehozás pillanata +
 *    `-HELYESBITO-<refund-sorszám>`), az advisory-zár alatt. Ez a
 *    duplikáció-kapu: nemcsak ugyanazon seq újrapróbálását fogja, hanem a más
 *    seq-es maradék jobot is (pl. seq=1 retry, miután a seq=2 már kiállt). A
 *    talált bizonylatot csak egyező (negatív) bruttó végösszegnél vesszük át.
 * 3. A Számlázz.hu rendelésszám-ismétlés-tiltása (71/152) a helyesbítőre NEM
 *    vonatkozik: a hivatalos rendelésszám-oldal szerint „A sztornó és a
 *    helyesbítő számla kivétel az ellenőrzés alól" (docs.szamlazz.hu/hu/agent/
 *    generating_invoice/settings_and_rules/order-number). Provider-oldali
 *    duplikátum-védelem tehát NINCS; ha mégis 71/152 jön, a feloldás
 *    ugyanazzal a lekérdezéssel dönti el, létezik-e már a bizonylat.
 *
 * Áfakulcs (a-szamlazz-13, r-szamlazz-7): a helyesbítő az eredeti számlával
 * EGYÜTT írja le a gazdasági eseményt, tehát az eredeti áfakulcsát kell
 * hordoznia. A rendelés a kiállításkori kulcsot nem tárolja (H8a), ezért a
 * beküldés előtt a Számlázz.hu-tól kérdezzük le az eredeti számlát
 * (invoice-data.ts); ha a kulcs nem olvasható, vagy eltér a
 * SZAMLAZZ_AFAKULCS-tól, a helyesbítő RIASZTÁS-sal megáll, nem találgat.
 *
 * Kísérlet-plafon (A14/F1): a beküldés-számláló BIZONYLAT-szintű, azaz a
 * refund-sorszámhoz kulcsolt (correctiveInvoiceAttempts +
 * correctiveInvoiceAttemptsSeq). Rendelés-szintű számlálóval több részrefund
 * után a KÉSŐBBI bizonylat jogtalanul „kimerült"-re futna. A previousAttempts
 * CSAK a plafonhoz kell: a lekérdezés ettől függetlenül mindig lefut, a
 * kimerült keretnél is, és a plafon csak a lekérdezés után dönt (H3). A
 * kimerült keretnél üres találat és lekérdezés-hiba egyaránt azonnal végleges
 * 'failed' + RIASZTÁS (a helyesbítőt semmi nem sweepeli vissza), a szöveg a
 * kézi kiállítás előtti keresést kéri.
 */

/**
 * A14: a helyesbítő-beküldések perzisztens plafonja (Számlázz.hu-szabály:
 * ugyanaz a kérés legfeljebb ötször, utána emberi beavatkozás). A számláló
 * BIZONYLAT-szintű: a correctiveInvoiceAttemptsSeq mondja meg, melyik
 * refund-sorszámhoz tartozik (F1).
 */
export const MAX_CORRECTIVE_ATTEMPTS = 5

/** A helyesbítő-kiállítás sorosító advisory-zárának kulcsa (rendelés + refund-sorszám). */
export function correctiveLockKey(orderId: number | string, refundSeq: number): string {
  return `corrective:${orderId}:${refundSeq}`
}

export interface BuildCorrectiveInvoiceXmlInput {
  agentKey: string
  /** Az eredeti (helyesbítendő) számla száma. */
  originalInvoiceNumber: string
  orderNumber: string
  /**
   * A helyesbítő globálisan egyedi külső azonosítója (correctiveKulsoAzon,
   * kulso-azon.ts): <szamlaKulsoAzon> és <rendelesSzam>.
   */
  kulsoAzon: string
  invoicePrefix: string
  /** A visszatérített (helyesbítendő) BRUTTÓ összeg, HUF — pozitív egész. */
  amountHuf: number
  /** Kiállítás dátuma (YYYY-MM-DD). */
  issueDate: string
  /**
   * Az EREDETI számla teljesítési dátuma (YYYY-MM-DD) — a helyesbítő ezt
   * ismétli meg (NAV-szabály: a hónap nem térhet el). Elhagyva = issueDate.
   */
  teljesitesDatum?: string
  /**
   * Áfakulcs — az eredeti számláéval egyezően ('27' | 'AAM'). A kiállító
   * (issueCorrectiveInvoiceForOrder) a beküldés előtt a Számlázz.hu-tól
   * kiolvasott eredeti kulccsal veti össze, és eltérésnél nem állít ki.
   */
  vatMode?: SzamlazzVatMode
  buyer: Parameters<typeof buildInvoiceXml>[0]['buyer']
  /** A visszatérítés indoka — a fejléc-megjegyzésbe kerül. */
  reason?: string | null
}

/**
 * A helyesbítő számla XML-je: a normál számla-váz, `corrective` hivatkozással
 * és EGY negatív korrekciós tétellel a visszatérített összegre.
 */
export function buildCorrectiveInvoiceXml(input: BuildCorrectiveInvoiceXmlInput): string {
  const reasonSuffix = input.reason?.trim() ? ` — indok: ${input.reason.trim()}` : ''
  return buildInvoiceXml({
    agentKey: input.agentKey,
    orderNumber: input.orderNumber,
    invoicePrefix: input.invoicePrefix,
    issueDate: input.issueDate,
    ...(input.teljesitesDatum ? { teljesitesDatum: input.teljesitesDatum } : {}),
    ...(input.vatMode ? { vatMode: input.vatMode } : {}),
    buyer: input.buyer,
    items: [
      {
        megnevezes: `Helyesbítés — részleges visszatérítés (rendelés: ${input.orderNumber})`,
        mennyiseg: 1,
        bruttoEgysegar: -Math.abs(input.amountHuf),
      },
    ],
    corrective: {
      originalInvoiceNumber: input.originalInvoiceNumber,
      kulsoAzon: input.kulsoAzon,
    },
    megjegyzes:
      `Helyesbítő számla a(z) ${input.originalInvoiceNumber} számú számlához — ` +
      `részleges visszatérítés, rendelés: ${input.orderNumber}${reasonSuffix}`,
  })
}

// ---------------------------------------------------------------------------
// Helyesbítő kiállítás a rendeléshez
// ---------------------------------------------------------------------------

export interface IssueCorrectiveInvoiceDeps {
  /**
   * Payload-példány: megadva a helyesbítő állapota a RENDELÉSRE is felkerül
   * (correctiveInvoiceStatus / correctiveInvoiceNumber / correctiveInvoiceSeq).
   */
  payload?: Payload
  /**
   * A refunds-nyom 1-alapú sorszáma, amelyhez a helyesbítő tartozik. Ez az
   * idempotencia kulcsa (orderNumber + refund-azonosító).
   */
  refundSeq: number
  /** A visszatérített bruttó összeg HUF-ban (pozitív egész). */
  amountHuf: number
  /** A visszatérítés indoka — a fejléc-megjegyzésbe kerül. */
  reason?: string | null
  config?: SzamlazzClientConfig
  logger?: Logger
  /** Injektálható HTTP-hívó (teszteléshez); alapból a valódi postInvoiceXml. */
  postXml?: (xml: string, config: SzamlazzClientConfig) => Promise<SzamlazzParsedSuccess>
  /**
   * Injektálható bizonylat-lekérdező (teszteléshez); alapból a valódi
   * queryInvoiceByKulsoAzon — a retry-előtti ellenőrzéshez és a 71/152-es
   * duplikátum-jelzés feloldásához. A lekérdezés NEM fogyaszt beküldési
   * kísérletet (F10).
   */
  queryByKulsoAzon?: (
    kulsoAzon: string,
    config: SzamlazzClientConfig,
  ) => Promise<InvoiceLookupResult | null>
  /**
   * Injektálható számlaadat-lekérdező (teszteléshez); alapból a valódi
   * queryInvoiceData. A beküldés ELŐTT az EREDETI számla áfakulcsát olvassa
   * ki (a-szamlazz-13), és a régi kulcson talált helyesbítőnél azt, hogy a
   * talált bizonylat valóban erre a számlára hivatkozik-e.
   */
  queryInvoiceData?: (
    szamlaszam: string,
    config: SzamlazzClientConfig,
  ) => Promise<InvoiceDataResult>
  /** A kelt-dátum felülírása (teszteléshez); alapból a mai dátum. */
  issueDate?: string
}

/**
 * Újrapróbálandó-e a helyesbítő kiállítás a kapott hiba alapján (a retry-döntés
 * egyetlen forrása — a hívó ez alapján állítja sorba a jobot).
 */
export function isRetryableCorrectiveError(error: unknown): boolean {
  return error instanceof SzamlazzApiError && error.retryable
}

/**
 * Helyesbítő számla kiállítása egy részleges visszatérítéshez — idempotens:
 * - ehhez a refund-sorszámhoz már van helyesbítő → 'already-issued' (no-op);
 * - Számlázz.hu kikapcsolva → 'disabled' (no-op, NEM hiba);
 * - hiányzó rendelésszám / eredeti számlaszám / vevőadat / érvénytelen összeg
 *   → 'failed' (NEM dob: emberi pótlás kell, az újrapróbálás nem segít);
 * - retryable provider/timeout-hiba → THROW (a corrective-invoice-issue job
 *   újrapróbálja; az újrabeküldést a bizonylat-szintű kísérlet-plafon fékezi,
 *   és minden beküldés ELŐTT kulsoAzon-lekérdezés fut — K4: nemcsak ugyanazon
 *   seq retryjén, hanem más seq-es maradék jobon is).
 */
/**
 * A helyesbítő kiállítás publikus belépője. A „friss olvasás → döntés →
 * lekérdezés → POST → persist" szakasz advisory-zár alatt fut (SEC-012): két
 * azonos (orderId, refundSeq) futás a POST előtti lekérdezés és a beküldés
 * közti ablakban egyébként duplán POSTolhatna. A záron belül frissen olvassuk
 * újra a rendelést; a tényleges kiállítást a `performCorrectiveInvoiceForOrder`
 * végzi (a provider-oldali kulsoAzon-egyediség + a beküldés előtti lekérdezés
 * továbbra is a második védvonal).
 */
export async function issueCorrectiveInvoiceForOrder(
  order: Order,
  deps: IssueCorrectiveInvoiceDeps,
): Promise<IssueCorrectiveInvoiceResult> {
  const payload = deps.payload
  if (!payload || typeof payload.findByID !== 'function') {
    return performCorrectiveInvoiceForOrder(order, deps)
  }
  const log = (deps.logger ?? rootLogger).child({
    module: 'szamlazz-corrective',
    orderId: order.id,
    orderNumber: order.orderNumber ?? null,
    refundSeq: deps.refundSeq,
  })
  return withAdvisoryLock(
    payload,
    correctiveLockKey(order.id, deps.refundSeq),
    async () => {
      const fresh = (await payload.findByID({
        collection: 'orders',
        id: order.id,
        depth: 0,
        overrideAccess: true,
      })) as Order | null
      return performCorrectiveInvoiceForOrder(fresh ?? order, deps)
    },
    log,
  )
}

async function performCorrectiveInvoiceForOrder(
  order: Order,
  deps: IssueCorrectiveInvoiceDeps,
): Promise<IssueCorrectiveInvoiceResult> {
  const log = (deps.logger ?? rootLogger).child({
    module: 'szamlazz-corrective',
    orderId: order.id,
    orderNumber: order.orderNumber ?? null,
    refundSeq: deps.refundSeq,
  })
  const config = deps.config ?? getSzamlazzConfig()
  const payload = deps.payload
  const saveState = async (data: Record<string, unknown>): Promise<void> => {
    if (payload) {
      await writeOrderInvoicingState(payload, order.id, data)
    }
  }
  const saveStateBestEffort = async (data: Record<string, unknown>): Promise<void> => {
    if (payload) {
      await writeOrderInvoicingStateBestEffort(payload, order.id, data, log)
    }
  }
  const fail = async (reason: string): Promise<IssueCorrectiveInvoiceResult> => {
    await saveStateBestEffort({ correctiveInvoiceStatus: 'failed' })
    return { outcome: 'failed', reason }
  }

  if (!config.enabled) {
    log.debug('számlázás kikapcsolva (SZAMLAZZ_AGENT_KEY nincs beállítva) — helyesbítő kihagyva')
    return { outcome: 'disabled' }
  }

  const managed = payload
    ? await managedRefundDocument(payload, order, 'corrective', deps.refundSeq, deps.amountHuf)
    : null
  if (managed?.number) return { outcome: 'already-issued', correctiveInvoiceNumber: managed.number }

  if (!Number.isInteger(deps.refundSeq) || deps.refundSeq < 1) {
    log.error('RIASZTÁS: érvénytelen refund-sorszám — helyesbítő nem állítható ki', {
      orderNumber: order.orderNumber ?? null,
      refundSeq: deps.refundSeq,
    })
    return { outcome: 'failed', reason: 'érvénytelen refund-sorszám' }
  }

  // Idempotencia (alkalmazás-oldal): ehhez a refund-bejegyzéshez már készült
  // helyesbítő? KIZÁRÓLAG pontos seq-egyezésnél no-op: recordedSeq > refundSeq
  // esetén egy KORÁBBI refund elmaradt bizonylatának újrapróbálása fut (a
  // retry-queue megtöri a sorrendi kiállítást), ezért a kérést TOVÁBB kell
  // engedni — a duplikáció ellen ilyenkor a beküldés előtti, bizonylat-egyedi
  // kulcsú lekérdezés és az advisory-zár véd (a 71/152-es fiókbeállítás a
  // helyesbítőre nem vonatkozik).
  const recordedNumber = order.correctiveInvoiceNumber?.trim()
  const recordedSeq = order.correctiveInvoiceSeq ?? 0
  if (recordedNumber && recordedSeq === deps.refundSeq) {
    log.info('ehhez a visszatérítéshez már készült helyesbítő számla — idempotens no-op', {
      correctiveInvoiceNumber: recordedNumber,
      recordedSeq,
    })
    return { outcome: 'already-issued', correctiveInvoiceNumber: recordedNumber }
  }

  if (!order.orderNumber) {
    log.error('RIASZTÁS: a rendelés rendelésszám nélkül fut — helyesbítő nem állítható ki')
    return fail('hiányzó rendelésszám')
  }

  const orderNumber = order.orderNumber
  const originalInvoiceNumber = order.invoiceNumber?.trim()
  if (!originalInvoiceNumber) {
    // Végleges: számla nélkül nincs mit helyesbíteni (a részleges
    // visszatérítés a számla előtt történt, a-szamlazz-12). Emberi rendezés kell.
    log.error(
      'RIASZTÁS: a rendeléshez nem tartozik kiállított számla (invoiceNumber) — a részleges visszatérítés helyesbítő számlája NEM állítható ki, kézi rendezés kell',
      { orderNumber, refundSeq: deps.refundSeq, amountHuf: deps.amountHuf },
    )
    return fail('hiányzó eredeti számlaszám (invoiceNumber)')
  }

  if (!Number.isInteger(deps.amountHuf) || deps.amountHuf <= 0) {
    log.error('RIASZTÁS: érvénytelen helyesbítendő összeg — helyesbítő nem állítható ki', {
      orderNumber,
      amountHuf: deps.amountHuf,
    })
    return fail('érvénytelen helyesbítendő összeg')
  }

  const buyer = buyerFromOrder(order)
  if (!buyer) {
    log.error(
      'RIASZTÁS: hiányos vevő-számlázási adatok (név/irsz/település/cím) — helyesbítő NEM állítható ki, emberi pótlás szükséges',
      { orderNumber, refundSeq: deps.refundSeq },
    )
    return fail('hiányos vevő-számlázási adatok')
  }

  // A14/F1: perzisztens kísérlet-plafon a helyesbítő-beküldésekre is —
  // BIZONYLAT-szinten. A számláló csak akkor a mienk, ha ugyanahhoz a
  // refund-sorszámhoz tartozik; új seq friss számlálóval indul (különben egy
  // korábbi bizonylat kimerült kerete blokkolná a következőt). A
  // previousAttempts CSAK a plafonhoz kell, és a plafon a beküldés előtti
  // lekérdezés UTÁN dönt (H3, lásd a try-blokkot): a lekérdezés a kimerült
  // keretnél is lefut (K4: más seq-es maradék job anti-duplikáció kapuja, és
  // az 5. bizonytalan beküldés bizonylata is átvehető).
  const attemptsSeq = order.correctiveInvoiceAttemptsSeq ?? 0
  const previousAttempts =
    attemptsSeq === deps.refundSeq ? (order.correctiveInvoiceAttempts ?? 0) : 0
  const capReached = previousAttempts >= MAX_CORRECTIVE_ATTEMPTS

  const issueDate = deps.issueDate ?? budapestDateString()
  // B4 (NAV-dátumszabály): a helyesbítő teljesítési dátuma az EREDETI számláét
  // ismétli. A dátum a kiálláskor rögzül a rendelésen (invoiceCompletionDate);
  // régi, a mező bevezetése előtti számláknál figyelmeztetéssel a kiállítás
  // napjára esünk vissza — hónapforduló környékén ez kézi ellenőrzést kíván.
  // A mező szabad szöveges DB-oszlop (az admin readOnly nem API-védelem),
  // ezért olvasáskor formátum-kapun megy át.
  const recordedCompletionDate = order.invoiceCompletionDate?.trim()
  const originalCompletionDate =
    recordedCompletionDate && isIsoDateString(recordedCompletionDate)
      ? recordedCompletionDate
      : undefined
  if (!recordedCompletionDate) {
    log.warn(
      'az eredeti számla teljesítési dátuma nincs rögzítve (invoiceCompletionDate) — a helyesbítő a kiállítás napját használja; hónapfordulónál kézi ellenőrzés javasolt',
    )
  } else if (!originalCompletionDate) {
    log.warn(
      'az eredeti számla teljesítési dátuma nem YYYY-MM-DD alakú — a helyesbítő a kiállítás napját használja; kézi ellenőrzés szükséges',
    )
  }
  const kulsoAzon = correctiveKulsoAzon(orderNumber, order, deps.refundSeq)
  // Visszafelé kompatibilitás: a PR #304 a `<rendelésszám>-HELYESBITO-<seq>`
  // alakot küldte. Ugyanennek a seq-nek a korábbi beküldése után a régi
  // alakon is keresünk; beküldés nélkül a régi kulcson talált bizonylat csak
  // idegen lehetne.
  const lookupKeys = correctiveLookupKeys(orderNumber, order, deps.refundSeq, previousAttempts > 0)
  const xml = buildCorrectiveInvoiceXml({
    agentKey: config.agentKey as string,
    originalInvoiceNumber,
    orderNumber,
    kulsoAzon,
    invoicePrefix: config.invoicePrefix,
    amountHuf: deps.amountHuf,
    issueDate,
    ...(originalCompletionDate ? { teljesitesDatum: originalCompletionDate } : {}),
    vatMode: config.vatMode,
    buyer,
    ...(deps.reason ? { reason: deps.reason } : {}),
  })

  const lookup = deps.queryByKulsoAzon ?? queryInvoiceByKulsoAzon
  const readInvoiceData = deps.queryInvoiceData ?? queryInvoiceData
  /** A talált helyesbítő várt bruttó végösszege: a visszatérített összeg, negatívan. */
  const expectedBrutto = -Math.abs(deps.amountHuf)
  interface LookupHit {
    found: InvoiceLookupResult
    key: string
    legacy: boolean
  }
  /** A bizonylat keresése a kulcsokon, sorrendben; az első találat dönt. */
  const findExisting = async (): Promise<LookupHit | null> => {
    for (const [index, key] of lookupKeys.entries()) {
      const found = await lookup(key, config)
      if (found) {
        return { found, key, legacy: index > 0 }
      }
    }
    return null
  }
  /**
   * Átvétel előtti egyeztetés: a talált bizonylat ez a helyesbítő-e. Null, ha
   * igen; különben az eltérés oka. A régi kulcson talált bizonylatnál a
   * számlaadat-lekérdezés azt is igazolja, hogy a mi számlánkra hivatkozik
   * (`alap/hivszamlaszam`). A lekérdezés hibája dob.
   */
  const mismatchOf = async (hit: LookupHit): Promise<string | null> => {
    const brutto = hit.found.szamlabrutto
    if (brutto === undefined) {
      return 'a lekérdezés válasza nem hordoz bruttó végösszeget (szamlabrutto), így a bizonylat nem egyeztethető'
    }
    if (brutto !== expectedBrutto) {
      return `a bizonylat bruttó végösszege ${brutto} Ft, a helyesbítésé ${expectedBrutto} Ft`
    }
    if (!hit.legacy) {
      return null
    }
    const data = await readInvoiceData(hit.found.szamlaszam, config)
    if (data.hivatkozottSzamlaszam !== originalInvoiceNumber) {
      return `a régi (rendelésszám-alapú) kulcson talált bizonylat nem a(z) ${originalInvoiceNumber} számú számlára hivatkozik`
    }
    return null
  }
  /** Idegen (vagy nem egyeztethető) bizonylat: nem vesszük át, és nem küldünk be. */
  const refuseForeign = async (
    hit: LookupHit,
    mismatch: string,
    via: string,
  ): Promise<IssueCorrectiveInvoiceResult> => {
    const reason =
      `a(z) ${hit.key} külső azonosítón talált ${hit.found.szamlaszam} számú bizonylat nem egyeztethető ezzel a helyesbítéssel (${mismatch}). ` +
      'A rendszer nem veszi át, és új helyesbítőt sem küld be: ellenőrizd a Számlázz.hu-fiókban.'
    log.error(
      'RIASZTÁS: a helyesbítő előtti bizonylat-lekérdezés olyan bizonylatot talált, amely nem egyeztethető ezzel a helyesbítéssel — a helyesbítő nem készült el, kézi ellenőrzés kell.',
      {
        orderNumber,
        foundInvoiceNumber: hit.found.szamlaszam,
        kulsoAzon: hit.key,
        legacyKey: hit.legacy,
        szamlabrutto: hit.found.szamlabrutto ?? null,
        expectedBrutto,
        mismatch,
        via,
      },
    )
    await saveStateBestEffort({
      correctiveInvoiceStatus: 'failed',
      correctiveInvoiceLastError: reason,
    })
    return { outcome: 'failed', reason }
  }
  /**
   * A ténylegesen BEKÜLDÖTT kísérletek száma. A lekérdezés (F10) nem fogyaszt
   * keretet, ezért a számláló csak a POST előtt, a pending-írással együtt nő.
   */
  let attempts = previousAttempts
  /** A meglévő helyesbítő átvétele (lekérdezés-találat vagy 71/152-feloldás). */
  const adoptExisting = async (
    szamlaszam: string,
    via: string,
  ): Promise<IssueCorrectiveInvoiceResult> => {
    await saveState(
      deps.refundSeq >= recordedSeq
        ? {
            correctiveInvoiceStatus: 'issued',
            correctiveInvoiceNumber: szamlaszam,
            correctiveInvoiceSeq: deps.refundSeq,
            correctiveInvoiceLastError: null,
          }
        : { correctiveInvoiceStatus: 'issued', correctiveInvoiceLastError: null },
    )
    log.info('a helyesbítő már korábban kiállt — a meglévő bizonylat átvéve', {
      correctiveInvoiceNumber: szamlaszam,
      via,
      attempts,
    })
    return { outcome: 'issued', correctiveInvoiceNumber: szamlaszam }
  }

  /**
   * Az eredeti számla áfakulcsának ellenőrzése (a-szamlazz-13). Null, ha a
   * kulcs egyértelműen kiolvasható és egyezik a konfigurált kulccsal; különben
   * a megtagadás eredménye (RIASZTÁS + 'failed'). Újrapróbálható olvasási
   * hibánál a hibát tovább dobja (a hívó / a corrective-invoice-issue job
   * később újrapróbálhatja, beküldés addig nincs).
   */
  const checkOriginalVatKey = async (
    originalNumber: string,
  ): Promise<IssueCorrectiveInvoiceResult | null> => {
    const refuse = async (detail: string): Promise<IssueCorrectiveInvoiceResult> => {
      const reason =
        `a helyesbítő nem állítható ki biztonságosan: ${detail}. ` +
        'A helyesbítőnek az eredeti számla áfakulcsát kell hordoznia; a rendszer nem találgat, kézi rendezés kell.'
      log.error(
        'RIASZTÁS: az eredeti számla áfakulcsa nem igazolható (nem olvasható ki, vagy eltér a SZAMLAZZ_AFAKULCS-tól) — a helyesbítő NEM készült el, kézi rendezés kell',
        {
          orderNumber,
          refundSeq: deps.refundSeq,
          originalInvoiceNumber: originalNumber,
          configuredVatMode: config.vatMode,
          detail,
        },
      )
      await saveStateBestEffort({
        correctiveInvoiceStatus: 'failed',
        correctiveInvoiceLastError: reason,
      })
      return { outcome: 'failed', reason }
    }
    let original: InvoiceDataResult
    try {
      original = await readInvoiceData(originalNumber, config)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const refusal = await refuse(`az eredeti számla adatai nem olvashatók ki (${message})`)
      if (error instanceof SzamlazzApiError && error.retryable) {
        throw error
      }
      return refusal
    }
    if (original.szamlaszam !== originalNumber) {
      return refuse(
        `a számlaadat-lekérdezés más bizonylatot adott vissza (${original.szamlaszam}) a(z) ${originalNumber} helyett`,
      )
    }
    if (original.sztornozott) {
      return refuse(`a(z) ${originalNumber} számú eredeti számlát már sztornózták`)
    }
    if (original.vatKeys.length !== 1 || original.vatKeys[0] !== config.vatMode) {
      return refuse(
        `az eredeti számla áfakulcsa (${original.vatKeys.join(', ') || 'nincs tétel'}) nem egyezik a beállított ${config.vatMode ?? 'hiányzó'} kulccsal`,
      )
    }
    return null
  }

  /** Igaz, amíg a beküldés ELŐTTI lekérdezés fut (a plafonnál ennek a hibája végleges). */
  let lookupPhase = false
  try {
    // K4 + H3: a lekérdezés MINDIG lefut a beküldés (attempts-növelés / POST)
    // előtt, a kimerült plafonnál is, nem csak ugyanazon seq
    // újrapróbálásakor. A „kérés elment, válasz elveszett" mellett ez a kapu
    // a más seq-es maradék jobot is megfogja (pl. seq=1 retry, miután a seq=2
    // már kiállt): találatnál átvesszük a meglévő bizonylatot, vak POST
    // nincs. A lekérdezés hibája szándékosan propagál (bizonytalan állapotban
    // nem szabad vakon újra beküldeni), és NEM növeli a kísérletszámot (F10).
    lookupPhase = true
    const hit = await findExisting()
    const mismatch = hit ? await mismatchOf(hit) : null
    lookupPhase = false
    const via = capReached ? 'plafon-utani lekerdezes' : 'bekuldes-elotti lekerdezes'
    if (hit && mismatch !== null) {
      return await refuseForeign(hit, mismatch, via)
    }
    if (hit) {
      return await adoptExisting(hit.found.szamlaszam, via)
    }

    // A14 + H3: a plafon a NEGATÍV lekérdezés után dönt; kimerült keretnél
    // beküldés nincs, az eredmény végleges 'failed' + RIASZTÁS.
    if (capReached) {
      // Az 5. beküldés bizonytalan kimenetű lehetett, és a bizonylat a fiókban
      // később is megjelenhet: a szöveg a kézi kiállítás ELŐTTI keresést kéri,
      // a korábbi hibával együtt.
      const previousError = order.correctiveInvoiceLastError?.trim()
      const reason =
        `a helyesbítő-kiállítási kísérletek száma kimerült (${previousAttempts}/${MAX_CORRECTIVE_ATTEMPTS}), és a záró lekérdezés sem talált bizonylatot. ` +
        `Az utolsó beküldés ennek ellenére létrehozhatta a helyesbítőt, ezért kézi kiállítás előtt keresd meg a Számlázz.hu-fiókban a(z) ${kulsoAzon} külső azonosítójú bizonylatot.` +
        (previousError ? ` A korábbi hiba: ${previousError}` : '')
      log.error(
        'RIASZTÁS: a helyesbítő-kiállítás beküldései kimerültek, és a záró lekérdezés sem talált bizonylatot. Emberi beavatkozás kell (Számlázz.hu-szabály: legfeljebb 5 beküldés); kézi kiállítás előtt keresd meg a Számlázz.hu-fiókban a helyesbítő külső azonosítójú bizonylatát.',
        { attempts: previousAttempts, lastError: order.correctiveInvoiceLastError ?? null },
      )
      await saveStateBestEffort({
        correctiveInvoiceStatus: 'failed',
        correctiveInvoiceAttemptsSeq: deps.refundSeq,
        correctiveInvoiceLastError: reason,
      })
      return { outcome: 'failed', reason }
    }

    // a-szamlazz-13: az eredeti számla áfakulcsa a Számlázz.hu-ból, a
    // beküldés (és a refund-igénylés rögzítése) ELŐTT. Nem olvasható vagy
    // eltérő kulcsnál nincs találgatás: RIASZTÁS, helyesbítő nem megy ki.
    const vatRefusal = await checkOriginalVatKey(originalInvoiceNumber)
    if (vatRefusal) {
      return vatRefusal
    }

    if (payload && managed) await claimManagedRefundDocument(payload, managed, previousAttempts)
    attempts = previousAttempts + 1
    await saveState({
      correctiveInvoiceStatus: 'pending',
      correctiveInvoiceAttempts: attempts,
      correctiveInvoiceAttemptsSeq: deps.refundSeq,
    })
    const postXml = deps.postXml ?? postInvoiceXml
    const result = await postXml(xml, config)
    // Ha egy KORÁBBI seq elmaradt bizonylata készült el utólag (retry), a
    // rendelésen rögzített legutóbbi szám/sorszám nem íródhat vissza egy
    // régebbire — ilyenkor csak a státusz áll vissza 'issued'-ra.
    await saveState(
      deps.refundSeq >= recordedSeq
        ? {
            correctiveInvoiceStatus: 'issued',
            correctiveInvoiceNumber: result.szamlaszam,
            correctiveInvoiceSeq: deps.refundSeq,
            correctiveInvoiceLastError: null,
          }
        : { correctiveInvoiceStatus: 'issued', correctiveInvoiceLastError: null },
    )
    log.info('helyesbítő számla kiállítva', {
      correctiveInvoiceNumber: result.szamlaszam,
      originalInvoiceNumber,
      amountHuf: deps.amountHuf,
      szamlaKulsoAzon: kulsoAzon,
      attempts,
      persisted: payload !== undefined,
    })
    if (result.notificationError) {
      // 56: a helyesbítő kiállt, csak az értesítő levél nem ment ki. Az üzenet
      // szövegét nem naplózzuk (a vevő e-mail-címét tartalmazhatja).
      log.error(
        'RIASZTÁS: a helyesbítő számla kiállt, de a számlaértesítő e-mail NEM ment ki a vevőnek (56-os kód) — küldd ki kézzel a Számlázz.hu-fiókból',
        {
          correctiveInvoiceNumber: result.szamlaszam,
          agentErrorCode: result.notificationError.code,
        },
      )
    }
    return { outcome: 'issued', correctiveInvoiceNumber: result.szamlaszam }
  } catch (error) {
    // H3: a kimerült plafonnál a lekérdezés hibája VÉGLEGES. Beküldés úgysem
    // mehet ki, a dobás pedig csak a plafon-riasztást nyelné el (a helyesbítőt
    // semmi nem sweepeli vissza). A bizonylat az 5. beküldésből létezhet, ezért
    // a riasztás a kézi kiállítás előtti ellenőrzést kéri.
    if (lookupPhase && capReached) {
      const detail = error instanceof Error ? error.message : String(error)
      const previousError = order.correctiveInvoiceLastError?.trim()
      const reason =
        `a helyesbítő-kiállítási kísérletek száma kimerült (${previousAttempts}/${MAX_CORRECTIVE_ATTEMPTS}), és a záró lekérdezés hibát adott (${detail}). ` +
        `Egy korábbi beküldés létrehozhatta a helyesbítőt, ezért kézi kiállítás előtt keresd meg a Számlázz.hu-fiókban a(z) ${kulsoAzon} külső azonosítójú bizonylatot.` +
        (previousError ? ` A korábbi hiba: ${previousError}` : '')
      log.error(
        'RIASZTÁS: a helyesbítő-kiállítás beküldései kimerültek, és a záró lekérdezés hibát adott. A bizonylat létezhet: kézi kiállítás előtt ellenőrizd a Számlázz.hu-fiókot.',
        {
          attempts: previousAttempts,
          lastError: order.correctiveInvoiceLastError ?? null,
          lookupError: detail,
        },
      )
      await saveStateBestEffort({
        correctiveInvoiceStatus: 'failed',
        correctiveInvoiceAttemptsSeq: deps.refundSeq,
        correctiveInvoiceLastError: reason,
      })
      return { outcome: 'failed', reason }
    }
    // 71/152 — duplikátum-jelzés: a meglévő helyesbítő átvétele lekérdezéssel.
    if (isDuplicateOrderError(error)) {
      log.info(
        'a Számlázz.hu duplikátum-jelzést adott (71/152) — a meglévő helyesbítő lekérdezése',
        { agentErrorCodes: error.agentErrors.map((entry) => entry.code) },
      )
      try {
        const hit = await findExisting()
        const mismatch = hit ? await mismatchOf(hit) : null
        if (hit && mismatch !== null) {
          return await refuseForeign(hit, mismatch, 'duplikatum-feloldas')
        }
        if (hit) {
          return await adoptExisting(hit.found.szamlaszam, 'duplikatum-feloldas')
        }
        const reason =
          'a Számlázz.hu duplikátumot jelzett (71/152), de a szamlaKulsoAzon-lekérdezés nem talál bizonylatot — kézi egyeztetés szükséges'
        log.error(`RIASZTÁS: ${reason}`, {
          orderNumber,
          agentErrorCodes: error.agentErrors.map((entry) => entry.code),
        })
        await saveStateBestEffort({
          correctiveInvoiceStatus: 'failed',
          correctiveInvoiceLastError: reason,
        })
        return { outcome: 'failed', reason }
      } catch (lookupError) {
        // F11: a duplikátum-tény NEM veszhet el a lekérdezés hibája mögött —
        // a bizonylat a szolgáltatónál MÁR LÉTEZIK, a kézi újrakiállítás dupla
        // NAV-adatszolgáltatást okozna. A két üzenet fűzve megy tovább.
        const detail = lookupError instanceof Error ? lookupError.message : String(lookupError)
        const combined = `71/152 — a bizonylat a Számlázz.hu szerint már létezik; a lekérdezés hibája: ${detail}`
        error =
          lookupError instanceof SzamlazzApiError
            ? new SzamlazzApiError({
                message: combined,
                kind: lookupError.kind,
                ...(lookupError.httpStatus !== undefined
                  ? { httpStatus: lookupError.httpStatus }
                  : {}),
                agentErrors: lookupError.agentErrors,
                retryable: lookupError.retryable,
              })
            : new Error(combined)
      }
    }
    const message = error instanceof Error ? error.message : String(error)
    await saveStateBestEffort({
      correctiveInvoiceStatus: 'failed',
      correctiveInvoiceLastError: message,
    })
    if (error instanceof SzamlazzApiError) {
      const agentErrorCodes = error.agentErrors.map((entry) => entry.code)
      const context = {
        orderNumber,
        refundSeq: deps.refundSeq,
        kind: error.kind,
        retryable: error.retryable,
        attempts,
        agentErrorCode: agentErrorCodes[0] ?? null,
        agentErrorCodes,
        error: error.message,
      }
      if (error.retryable) {
        // A corrective-invoice-issue job újrapróbálja: a következő futás a
        // beküldés ELŐTT kulsoAzon-lekérdezéssel ellenőrzi, létezik-e már a
        // bizonylat, a beküldések számát pedig a bizonylat-szintű
        // correctiveInvoiceAttempts plafon fogja.
        log.warn('helyesbítő számla kiállítás sikertelen (újrapróbálható)', context)
        throw error
      }
      log.error(
        `RIASZTÁS: a helyesbítő számla kiállítása végleges hibával leállt (a Számlázz.hu válasza: ${agentErrorCodes.join(', ') || 'kód nélkül'}) — a helyesbítő NEM készült el, kézi rendezés kell`,
        context,
      )
      return { outcome: 'failed', reason: error.message }
    }
    log.error('RIASZTÁS: a helyesbítő számla kiállítása váratlan hibával állt le', {
      orderNumber,
      refundSeq: deps.refundSeq,
      attempts,
      error: message,
    })
    throw error
  }
}
