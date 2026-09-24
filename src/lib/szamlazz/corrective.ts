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
 * Duplikáció-védelem — HÁROM réteg, eltérő szereppel (F14):
 * 1. Alkalmazás-oldal (ELSŐDLEGES): a rendelés correctiveInvoiceSeq mezője azt
 *    tárolja, hányadik refund-bejegyzéshez készült el a legutóbbi helyesbítő.
 *    Ha ez PONTOSAN a kért sorszám (és van correctiveInvoiceNumber), a
 *    szolgáltatás hálózati hívás nélkül 'already-issued' no-opot ad. A rövidzár
 *    SZIGORÚAN egyezésre szűkített: a kiállítás nem feltétlenül sorrendi — ha
 *    egy korábbi seq job-újrapróbálása (retry-queue) AZUTÁN fut le, hogy egy
 *    későbbi seq inline már kiállt, a recordedSeq nagyobb a kértnél, de a
 *    korábbi refund bizonylata MÉG NEM készült el, ezért a kérés továbbmegy.
 * 2. Provider-oldal: a bizonylat-egyedi <rendelesSzam> + a fiókban bekapcsolt
 *    rendelésszám-ismétlés tiltása. Ez az, ami a Számlázz.hu-nál ténylegesen
 *    megfogja az ismételt beküldést (71/152-es hibakóddal).
 * 3. szamlaKulsoAzon = `${orderNumber}-HELYESBITO-<refund-sorszám>`: ez a
 *    VISSZAKERESÉS kulcsa (xmlszamlapdf-lekérdezés), NEM önálló duplikáció-
 *    védelem — a hivatalos dokumentáció ilyen hatást nem ígér. A beküldés
 *    ELŐTTI lekérdezés (K4) a duplikáció-kapu: nemcsak ugyanazon seq
 *    újrapróbálását fogja, hanem a más seq-es maradék jobot is (pl. seq=1
 *    retry, miután a seq=2 már kiállt). A 71/152 utáni feloldás ugyanezzel
 *    a kulccsal dönti el, létezik-e már a bizonylat.
 *
 * Kísérlet-plafon (A14/F1): a beküldés-számláló BIZONYLAT-szintű, azaz a
 * refund-sorszámhoz kulcsolt (correctiveInvoiceAttempts +
 * correctiveInvoiceAttemptsSeq). Rendelés-szintű számlálóval több részrefund
 * után a KÉSŐBBI bizonylat jogtalanul „kimerült"-re futna. A previousAttempts
 * CSAK a plafonhoz kell: a lekérdezés ettől függetlenül mindig lefut, a
 * kimerült keretnél is, és a plafon csak a negatív lekérdezés után dönt (H3).
 */

export const CORRECTIVE_KULSO_AZON_INFIX = '-HELYESBITO-'

/**
 * A14: a helyesbítő-beküldések perzisztens plafonja (Számlázz.hu-szabály:
 * ugyanaz a kérés legfeljebb ötször, utána emberi beavatkozás). A számláló
 * BIZONYLAT-szintű: a correctiveInvoiceAttemptsSeq mondja meg, melyik
 * refund-sorszámhoz tartozik (F1).
 */
export const MAX_CORRECTIVE_ATTEMPTS = 5

/** A helyesbítő visszakeresési kulcsa (szamlaKulsoAzon) egy refund-sorszámhoz. */
export function correctiveKulsoAzon(orderNumber: string, refundSeq: number): string {
  return `${orderNumber}${CORRECTIVE_KULSO_AZON_INFIX}${refundSeq}`
}

/** A helyesbítő-kiállítás sorosító advisory-zárának kulcsa (rendelés + refund-sorszám). */
export function correctiveLockKey(orderId: number | string, refundSeq: number): string {
  return `corrective:${orderId}:${refundSeq}`
}

export interface BuildCorrectiveInvoiceXmlInput {
  agentKey: string
  /** Az eredeti (helyesbítendő) számla száma. */
  originalInvoiceNumber: string
  orderNumber: string
  invoicePrefix: string
  /** A refunds-nyom 1-alapú sorszáma — az idempotencia-horgony része. */
  refundSeq: number
  /** A visszatérített (helyesbítendő) BRUTTÓ összeg, HUF — pozitív egész. */
  amountHuf: number
  /** Kiállítás dátuma (YYYY-MM-DD). */
  issueDate: string
  /**
   * Az EREDETI számla teljesítési dátuma (YYYY-MM-DD) — a helyesbítő ezt
   * ismétli meg (NAV-szabály: a hónap nem térhet el). Elhagyva = issueDate.
   */
  teljesitesDatum?: string
  /** Áfakulcs — az eredeti számláéval egyezően ('27' | 'AAM'). */
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
      kulsoAzon: correctiveKulsoAzon(input.orderNumber, input.refundSeq),
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
    log.error('érvénytelen refund-sorszám — helyesbítő nem állítható ki', {
      refundSeq: deps.refundSeq,
    })
    return { outcome: 'failed', reason: 'érvénytelen refund-sorszám' }
  }

  // Idempotencia (alkalmazás-oldal): ehhez a refund-bejegyzéshez már készült
  // helyesbítő? KIZÁRÓLAG pontos seq-egyezésnél no-op: recordedSeq > refundSeq
  // esetén egy KORÁBBI refund elmaradt bizonylatának újrapróbálása fut (a
  // retry-queue megtöri a sorrendi kiállítást), ezért a kérést TOVÁBB kell
  // engedni — a duplikáció ellen ilyenkor a bizonylat-egyedi rendelesSzam +
  // a fiókbeállítás (71/152) és a beküldés előtti lekérdezés véd.
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

  const originalInvoiceNumber = order.invoiceNumber?.trim()
  if (!originalInvoiceNumber) {
    log.warn(
      'a rendeléshez nem tartozik kiállított számla (invoiceNumber) — helyesbítő NEM állítható ki',
    )
    return fail('hiányzó eredeti számlaszám (invoiceNumber)')
  }

  if (!Number.isInteger(deps.amountHuf) || deps.amountHuf <= 0) {
    log.error('érvénytelen helyesbítendő összeg — helyesbítő nem állítható ki', {
      amountHuf: deps.amountHuf,
    })
    return fail('érvénytelen helyesbítendő összeg')
  }

  const buyer = buyerFromOrder(order)
  if (!buyer) {
    log.warn(
      'hiányos vevő-számlázási adatok (név/irsz/település/cím) — helyesbítő NEM állítható ki, emberi pótlás szükséges',
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
  const xml = buildCorrectiveInvoiceXml({
    agentKey: config.agentKey as string,
    originalInvoiceNumber,
    orderNumber: order.orderNumber,
    invoicePrefix: config.invoicePrefix,
    refundSeq: deps.refundSeq,
    amountHuf: deps.amountHuf,
    issueDate,
    ...(originalCompletionDate ? { teljesitesDatum: originalCompletionDate } : {}),
    vatMode: config.vatMode,
    buyer,
    ...(deps.reason ? { reason: deps.reason } : {}),
  })

  const kulsoAzon = correctiveKulsoAzon(order.orderNumber, deps.refundSeq)
  const lookup = deps.queryByKulsoAzon ?? queryInvoiceByKulsoAzon
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
    const found = await lookup(kulsoAzon, config)
    lookupPhase = false
    if (found) {
      return await adoptExisting(
        found.szamlaszam,
        capReached ? 'plafon-utani lekerdezes' : 'bekuldes-elotti lekerdezes',
      )
    }

    // A14 + H3: a plafon a NEGATÍV lekérdezés után dönt; kimerült keretnél
    // beküldés nincs, az eredmény végleges 'failed' + RIASZTÁS.
    if (capReached) {
      const reason = `a helyesbítő-kiállítási kísérletek száma kimerült (${previousAttempts}/${MAX_CORRECTIVE_ATTEMPTS}), és a záró lekérdezés sem talált bizonylatot: a helyesbítő számlát kézzel kell kiállítani`
      log.error(
        'RIASZTÁS: a helyesbítő-kiállítás beküldései kimerültek, és a záró lekérdezés sem talált bizonylatot. Emberi beavatkozás kell (Számlázz.hu-szabály: legfeljebb 5 beküldés).',
        { attempts: previousAttempts, lastError: order.correctiveInvoiceLastError ?? null },
      )
      await saveStateBestEffort({
        correctiveInvoiceStatus: 'failed',
        correctiveInvoiceAttemptsSeq: deps.refundSeq,
        correctiveInvoiceLastError: reason,
      })
      return { outcome: 'failed', reason }
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
      const reason =
        `a helyesbítő-kiállítási kísérletek száma kimerült (${previousAttempts}/${MAX_CORRECTIVE_ATTEMPTS}), és a záró lekérdezés hibát adott (${detail}). ` +
        `Egy korábbi beküldés létrehozhatta a helyesbítőt, ezért kézi kiállítás előtt keresd meg a Számlázz.hu-fiókban a(z) ${kulsoAzon} külső azonosítójú bizonylatot.`
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
        const found = await lookup(kulsoAzon, config)
        if (found) {
          return await adoptExisting(found.szamlaszam, 'duplikatum-feloldas')
        }
        const reason =
          'a Számlázz.hu duplikátumot jelzett (71/152), de a szamlaKulsoAzon-lekérdezés nem talál bizonylatot — kézi egyeztetés szükséges'
        log.error(`RIASZTÁS: ${reason}`)
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
      log.warn('helyesbítő számla kiállítás sikertelen', {
        kind: error.kind,
        retryable: error.retryable,
        attempts,
        agentErrorCodes: error.agentErrors.map((entry) => entry.code),
        error: error.message,
      })
      if (error.retryable) {
        // A corrective-invoice-issue job újrapróbálja: a következő futás a
        // beküldés ELŐTT kulsoAzon-lekérdezéssel ellenőrzi, létezik-e már a
        // bizonylat, a beküldések számát pedig a bizonylat-szintű
        // correctiveInvoiceAttempts plafon fogja.
        throw error
      }
      return { outcome: 'failed', reason: error.message }
    }
    log.error('helyesbítő számla kiállítás váratlan hibával állt le', {
      attempts,
      error: message,
    })
    throw error
  }
}
