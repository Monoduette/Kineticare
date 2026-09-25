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
import { correctiveKulsoAzon, correctiveLookupKeys, legacyCorrectiveKulsoAzon } from './kulso-azon'
import { createLockBudget, type LockBudget } from './lock-budget'
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
 *    seq-es maradék jobot is (pl. seq=1 retry, miután a seq=2 már kiállt). Ha
 *    a rendelésen bármely helyesbítő beküldése megtörtént, a PR #304-es régi
 *    kulcson (`<rendelésszám>-HELYESBITO-<seq>`) is keresünk. A talált
 *    bizonylatot csak egyező (negatív) bruttó végösszegnél vesszük át, a régi
 *    kulcson találtat csak egyező hivatkozott számlaszámnál is.
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
   * kulso-azon.ts): <szamlaKulsoAzon>, a visszakeresés kulcsa.
   */
  kulsoAzon: string
  /**
   * A helyesbítő <rendelesSzam>-ja: a rövid `<rendelésszám>-HELYESBITO-<seq>`
   * (legacyCorrectiveKulsoAzon). Elhagyva a kulsoAzon megy ki.
   */
  rendelesSzam?: string
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
      ...(input.rendelesSzam ? { rendelesSzam: input.rendelesSzam } : {}),
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
 * végzi. A második védvonal a záron belüli, beküldés előtti lekérdezés; a
 * Számlázz.hu a külső azonosító egyediségét NEM kényszeríti ki, és a
 * helyesbítő a rendelésszám-ismétlés-tiltás alól is kivétel, tehát
 * provider-oldali duplikátum-védelem nincs. A zár alatti hívások közös
 * időkerete (lock-budget.ts) biztosítja, hogy a beküldés a zár
 * tétlenségi korlátja előtt lezáruljon.
 */
export async function issueCorrectiveInvoiceForOrder(
  order: Order,
  deps: IssueCorrectiveInvoiceDeps,
): Promise<IssueCorrectiveInvoiceResult> {
  const payload = deps.payload
  if (!payload || typeof payload.findByID !== 'function') {
    return performCorrectiveInvoiceForOrder(order, deps, createLockBudget(resolveConfig(deps)))
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
      // A keret a zár megszerzésétől számít (a zár-tranzakció ettől tétlen).
      const budget = createLockBudget(resolveConfig(deps))
      const fresh = (await payload.findByID({
        collection: 'orders',
        id: order.id,
        depth: 0,
        overrideAccess: true,
      })) as Order | null
      return performCorrectiveInvoiceForOrder(fresh ?? order, deps, budget)
    },
    log,
  )
}

function resolveConfig(deps: IssueCorrectiveInvoiceDeps): SzamlazzClientConfig {
  return deps.config ?? getSzamlazzConfig()
}

async function performCorrectiveInvoiceForOrder(
  order: Order,
  deps: IssueCorrectiveInvoiceDeps,
  budget: LockBudget,
): Promise<IssueCorrectiveInvoiceResult> {
  const log = (deps.logger ?? rootLogger).child({
    module: 'szamlazz-corrective',
    orderId: order.id,
    orderNumber: order.orderNumber ?? null,
    refundSeq: deps.refundSeq,
  })
  const config = resolveConfig(deps)
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
  // alakot küldte. A régi alakon akkor is keresünk, ha a rendelésen BÁRMELY
  // sorszámú helyesbítő beküldése megtörtént, nem csak ennek a seq-nek: a
  // kísérlet-számláló seq-kulcsolt, így egy később kiállt seq=2 után a seq=1
  // maradék jobja previousAttempts=0-val fut, pedig a seq=1 bizonytalan
  // kimenetű beküldése a régi kulcson létezhet (breaker, rev1). A régi
  // kulcson talált bizonylatot csak egyező bruttó és egyező hivatkozott
  // számlaszám mellett vesszük át (resolveExisting), tehát egy idegen
  // rendelés helyesbítője nem kerülhet át. (A previousAttempts > 0 eset a
  // correctiveInvoiceAttempts > 0 része.)
  const anyCorrectiveSubmitted =
    (order.correctiveInvoiceAttempts ?? 0) > 0 || (order.correctiveInvoiceSeq ?? 0) > 0
  const lookupKeys = correctiveLookupKeys(
    orderNumber,
    order,
    deps.refundSeq,
    anyCorrectiveSubmitted,
  )
  const xml = buildCorrectiveInvoiceXml({
    agentKey: config.agentKey as string,
    originalInvoiceNumber,
    orderNumber,
    kulsoAzon,
    // A <rendelesSzam> a rövid, olvasható `<rendelésszám>-HELYESBITO-<seq>`
    // marad (a PR #304-es alak): a helyesbítő kivétel a rendelésszám-ismétlés-
    // tiltás alól, a visszakeresés a <szamlaKulsoAzon>-on megy, a fiókban pedig
    // a rendelésszámmal kereshető. A hosszú egyedi kulcs rendelésszámként a NAV-
    // export mezőhossz-korlátjába ütközhetne.
    rendelesSzam: legacyCorrectiveKulsoAzon(orderNumber, deps.refundSeq),
    invoicePrefix: config.invoicePrefix,
    amountHuf: deps.amountHuf,
    issueDate,
    ...(originalCompletionDate ? { teljesitesDatum: originalCompletionDate } : {}),
    vatMode: config.vatMode,
    buyer,
    ...(deps.reason ? { reason: deps.reason } : {}),
  })

  const lookup = deps.queryByKulsoAzon ?? queryInvoiceByKulsoAzon
  /** A talált helyesbítő várt bruttó végösszege: a visszatérített összeg, negatívan. */
  const expectedBrutto = -Math.abs(deps.amountHuf)
  interface LookupHit {
    found: InvoiceLookupResult
    key: string
    legacy: boolean
  }
  interface ResolvedHit {
    hit: LookupHit
    /** Null, ha a bizonylat ez a helyesbítő (átvehető); különben az eltérés oka. */
    mismatch: string | null
  }
  const bruttoMismatchOf = (hit: LookupHit): string | null => {
    const brutto = hit.found.szamlabrutto
    if (brutto === undefined) {
      return 'a lekérdezés válasza nem hordoz bruttó végösszeget (szamlabrutto), így a bizonylat nem egyeztethető'
    }
    if (brutto !== expectedBrutto) {
      return `a bizonylat bruttó végösszege ${brutto} Ft, a helyesbítésé ${expectedBrutto} Ft`
    }
    return null
  }
  const foreignReferenceMismatch = `a régi (rendelésszám-alapú) kulcson talált bizonylat nem a(z) ${originalInvoiceNumber} számú számlára hivatkozik`
  /**
   * A bizonylat keresése a kulcsokon, sorrendben, átvétel előtti
   * egyeztetéssel. Az új kulcson az egyező (negatív) bruttó elég. A régi
   * (rendelésszám-alapú) kulcson a számlaadat-lekérdezés azt is igazolja, hogy
   * a mi számlánkra hivatkozik (`alap/hivszamlaszam`).
   *
   * Rendelésszám-újrahasznosítás (breaker, rev2): ha ehhez a seq-hez még
   * nem volt beküldés, a régi kulcson talált, igazoltan MÁS számlára hivatkozó
   * bizonylat egy korábbi, azonos rendelésszámú rendelésé (a mi helyesbítőnk
   * mindig a mi számlánkra hivatkozik): figyelmeztetéssel átlépjük, és a
   * keresés a következő kulccsal, majd a beküldéssel folytatódik. Minden más
   * eltérés (hiányzó hivatkozás, egyező hivatkozás rossz bruttóval, vagy ehhez
   * a seq-hez már volt beküldés) zártan hibázik. A lekérdezések hibája dob.
   */
  const resolveExisting = async (): Promise<ResolvedHit | null> => {
    for (const [index, key] of lookupKeys.entries()) {
      const found = await lookup(key, budget.forQuery())
      if (!found) continue
      const hit: LookupHit = { found, key, legacy: index > 0 }
      if (!hit.legacy) {
        return { hit, mismatch: bruttoMismatchOf(hit) }
      }
      if (previousAttempts === 0) {
        const data = await queryInvoiceData(found.szamlaszam, budget.forQuery())
        const reference = data.hivatkozottSzamlaszam
        if (reference && reference !== originalInvoiceNumber) {
          log.warn(
            'a régi (rendelésszám-alapú) kulcson talált bizonylat igazoltan más számlára hivatkozik (korábbi, azonos rendelésszámú rendelésé) — átlépve',
            {
              orderNumber,
              foundInvoiceNumber: found.szamlaszam,
              kulsoAzon: key,
              referencedInvoiceNumber: reference,
            },
          )
          continue
        }
        return {
          hit,
          mismatch:
            reference === originalInvoiceNumber ? bruttoMismatchOf(hit) : foreignReferenceMismatch,
        }
      }
      const bruttoMismatch = bruttoMismatchOf(hit)
      if (bruttoMismatch !== null) {
        return { hit, mismatch: bruttoMismatch }
      }
      const data = await queryInvoiceData(found.szamlaszam, budget.forQuery())
      return {
        hit,
        mismatch:
          data.hivatkozottSzamlaszam === originalInvoiceNumber ? null : foreignReferenceMismatch,
      }
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
   * Az eredeti számla átmeneti olvasási hibája: a közös hibaág ezt állapotírás
   * nélkül engedi tovább (a státusz marad, lásd checkOriginalVatKey).
   */
  let transientOriginalReadError: unknown = null
  /**
   * Az eredeti számla áfakulcsának ellenőrzése (a-szamlazz-13). Null, ha a
   * kulcs egyértelműen kiolvasható és egyezik a konfigurált kulccsal; különben
   * a megtagadás eredménye (RIASZTÁS + 'failed').
   *
   * Újrapróbálható (átmeneti) olvasási hibánál NINCS megtagadás: sem 'failed'
   * írás, sem „kézi rendezés kell" RIASZTÁS, csak figyelmeztetés, és a hiba
   * továbbmegy. Igénylés és beküldés nem történt. Automatikus újrapróbálás
   * nincs: a visszatérítési panel „Feldolgozás folytatása” gombja (vagy egy
   * kézzel sorba állított corrective-invoice-issue job) próbálja újra. Egy
   * kézi kiállításra felszólító riasztás mellett ez az újrapróbálás dupla
   * helyesbítőt adna.
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
      original = await queryInvoiceData(originalNumber, budget.forQuery())
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (error instanceof SzamlazzApiError && error.retryable) {
        log.warn(
          'az eredeti számla adatai átmeneti hiba miatt nem olvashatók ki — a helyesbítő most nem ment ki; a visszatérítési panel „Feldolgozás folytatása” gombjával újrapróbálható (kézzel NE állítsd ki)',
          {
            orderNumber,
            refundSeq: deps.refundSeq,
            originalInvoiceNumber: originalNumber,
            kind: error.kind,
            error: message,
          },
        )
        transientOriginalReadError = error
        throw error
      }
      return refuse(`az eredeti számla adatai nem olvashatók ki (${message})`)
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
  /** Igaz, ha ebben a futásban megkezdődött a beküldés előkészítése (igénylés / pending-írás). */
  let submissionPrepared = false
  /** Igaz, ha ebben a futásban rögzült az igénylés-nyugta (intent-kezelt visszatérítés). */
  let managedClaimed = false
  /** Igaz, ha ebben a futásban a beküldés (POST) elindult. */
  let postStarted = false
  try {
    // K4 + H3: a lekérdezés MINDIG lefut a beküldés (attempts-növelés / POST)
    // előtt, a kimerült plafonnál is, nem csak ugyanazon seq
    // újrapróbálásakor. A „kérés elment, válasz elveszett" mellett ez a kapu
    // a más seq-es maradék jobot is megfogja (pl. seq=1 retry, miután a seq=2
    // már kiállt): találatnál átvesszük a meglévő bizonylatot, vak POST
    // nincs. A lekérdezés hibája szándékosan propagál (bizonytalan állapotban
    // nem szabad vakon újra beküldeni), és NEM növeli a kísérletszámot (F10).
    lookupPhase = true
    const existing = await resolveExisting()
    lookupPhase = false
    const via = capReached ? 'plafon-utani lekerdezes' : 'bekuldes-elotti lekerdezes'
    if (existing && existing.mismatch !== null) {
      return await refuseForeign(existing.hit, existing.mismatch, via)
    }
    if (existing) {
      return await adoptExisting(existing.hit.found.szamlaszam, via)
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

    // A beküldés csak akkor indul, ha a teljes timeoutja a zár időkeretébe
    // fér (lock-budget.ts). Korai ellenőrzés az igénylés és a pending-írás
    // előtt (tartalékkal): különben újrapróbálható hiba, igénylés és
    // kísérlet-növelés NÉLKÜL.
    budget.reservePost()
    submissionPrepared = true
    if (payload && managed) {
      await claimManagedRefundDocument(payload, managed, previousAttempts)
      managedClaimed = true
    }
    attempts = previousAttempts + 1
    await saveState({
      correctiveInvoiceStatus: 'pending',
      correctiveInvoiceAttempts: attempts,
      correctiveInvoiceAttemptsSeq: deps.refundSeq,
    })
    const postXml = deps.postXml ?? postInvoiceXml
    // Késői ellenőrzés a beküldés pillanatában (breaker, rev2): az igénylés és
    // a pending-írás megakadhatott (sorzár, pool; CLAUDE.md 6–7.), és a zár
    // tranzakcióját a 60 s-os tétlenségi korlát beküldés közben leölné. Ha a
    // teljes timeout már nem fér a keretbe, a POST NEM indul.
    const postConfig = budget.forPost()
    postStarted = true
    const result = await postXml(xml, postConfig)
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
    // Az eredeti számla átmeneti olvasási hibája: nincs 'failed' írás és
    // RIASZTÁS (a figyelmeztetés már elment), a job újrapróbálja.
    if (error === transientOriginalReadError) {
      throw error
    }
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
        const existing = await resolveExisting()
        if (existing && existing.mismatch !== null) {
          return await refuseForeign(existing.hit, existing.mismatch, 'duplikatum-feloldas')
        }
        if (existing) {
          return await adoptExisting(existing.hit.found.szamlaszam, 'duplikatum-feloldas')
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
    // Beküldés ELŐTTI átmeneti hiba (lekérdezés, időkeret): a helyesbítő nem
    // ment ki, és ebben a futásban semmi nem rögzült. A státusz marad (mint az
    // átmeneti áfakulcs-olvasásnál), csak a hibaüzenet íródik; a
    // helyreállítás és egy kézi job ugyanúgy újrapróbálhatja.
    if (!submissionPrepared && error instanceof SzamlazzApiError && error.retryable) {
      await saveStateBestEffort({ correctiveInvoiceLastError: message })
      log.warn('helyesbítő számla kiállítás sikertelen a beküldés előtt (újrapróbálható)', {
        orderNumber,
        refundSeq: deps.refundSeq,
        kind: error.kind,
        attempts,
        error: message,
      })
      throw error
    }
    // Az igénylés-nyugta rögzült, de a beküldés NEM indult el (jellemzően a
    // zár időkerete a beküldés előtti írások alatt elfogyott, vagy a
    // pending-írás hibázott). Az igénylés után a
    // rendszer nem küld be újra (refund-guard: bizonytalan állapot), tehát
    // automatikus újrapróbálás nincs; ez RIASZTÁS. A Számlázz.hu-ba ebből a
    // futásból nem ment kérés, és ehhez a visszatérítéshez korábban sem
    // (az igénylés csak kísérlet nélkül rögzülhet).
    if (managedClaimed && !postStarted) {
      const reason =
        `a helyesbítő beküldése nem indult el, de a bizonylat-igénylés már rögzült, ezért a rendszer nem próbálja újra (ok: ${message}). ` +
        `A Számlázz.hu-ba nem ment kérés: kézi kiállítás előtt a(z) ${kulsoAzon} külső azonosítóra keresve ellenőrizd, hogy nincs-e már helyesbítő.`
      log.error(
        'RIASZTÁS: a helyesbítő beküldése az igénylés rögzítése után nem indult el (például elfogyott a zár időkerete) — a helyesbítő NEM készült el, automatikus újrapróbálás nincs, kézi rendezés kell',
        { orderNumber, refundSeq: deps.refundSeq, attempts, error: message },
      )
      await saveStateBestEffort({
        correctiveInvoiceStatus: 'failed',
        correctiveInvoiceLastError: reason,
      })
      return { outcome: 'failed', reason }
    }
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
