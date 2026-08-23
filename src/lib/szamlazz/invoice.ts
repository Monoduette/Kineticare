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
import { isTrustedInvoicePdfUrl } from './invoice-url'
import { queryInvoiceByKulsoAzon, type InvoiceLookupResult } from './pdf'
import { writeOrderInvoicingState } from './order-state'
import {
  SzamlazzApiError,
  type IssueInvoiceResult,
  type IssueStornoResult,
  type SzamlazzClientConfig,
  type SzamlazzVatMode,
} from './types'
import type { IssueStornoForOrderDeps } from './storno'

/**
 * Számla-XML építés és számlakiállítás a paid rendeléshez (T-024/W4-01).
 *
 * Szabályok (a hivatalos Számla Agent minta alapján):
 * - A mezők SORRENDJE KÖTÖTT; a mintában szereplő tag-eknek jelen kell lenniük
 *   (értékük üres is lehet) — ezért a builder a teljes vázat mindig kiírja.
 * - A Számlázz.hu NEM számol: minden tételösszeg (nettoErtek, afaErtek,
 *   bruttoErtek) és a nettoEgysegar kötelezően megadott; az Agent a tétel-
 *   matematikát validálja (57, 259–264 hibakódok).
 * - Bruttó áraink vannak (fogyasztói ár, HUF); az áfakulcs a konfigurációból
 *   jön: '27' (alapértelmezés) vagy 'AAM' (alanyi adómentes eladó). A
 *   tételszámítás HIBRID (bruttó tétel-érték + 2 tizedes nettó egységár) —
 *   a pontos képlet és a három hivatalos egyenlet toleranciája a
 *   `computeLineAmounts` docblockjában.
 * - Minden dátum (keltDatum / teljesitesDatum / fizetesiHataridoDatum) kötelező
 *   YYYY-MM-DD alakú: a builder kapun vezeti át őket (`isIsoDateString`), mert
 *   a teljesítési dátum forrása egy szabad szöveges DB-mező.
 * - szamlaKulsoAzon: a bizonylat VISSZAKERESÉSI kulcsa (számla: orderNumber,
 *   helyesbítő: saját, seq-kulcsolt azonosító). A hivatalos dokumentáció NEM
 *   állítja, hogy azonos külső azonosítóval a Számlázz.hu megtagadná az újabb
 *   kiállítást — a duplikátum-védelmet a <rendelesSzam> + a fiókban bekapcsolt
 *   rendelésszám-ismétlés-tiltás adja (71/152 hibakód). A külső azonosító
 *   ahhoz kell, hogy kétes esetben (elveszett válasz) a bizonylat
 *   visszakereshető legyen — utólag már nem pótolható.
 * - A <vevo><azonosito> mezőt SOHA nem küldjük (a Számlázz.hu-dokumentáció
 *   figyelmeztet: más vevőhöz rögzített azonosító adatfrissítést/biztonsági
 *   problémát okozna).
 * - HELYESBÍTŐ (módosító) számla: ugyanez a művelet, `corrective` megadásával —
 *   ilyenkor <helyesbitoszamla>true</helyesbitoszamla>, a
 *   <helyesbitettSzamlaszam> az eredeti számla száma, a tételek negatív
 *   korrekciót hordoznak, a külső azonosító ÉS a <rendelesSzam> pedig a
 *   helyesbítő saját kulsoAzon-ja (lásd corrective.ts — részleges
 *   visszatérítés bizonylata).
 */

export const VAT_RATE_PERCENT = 27
const VAT_DIVISOR = 1 + VAT_RATE_PERCENT / 100

export interface InvoiceBuyerInput {
  nev: string
  irsz: string
  telepules: string
  cim: string
  email: string
  adoszam?: string
}

export interface InvoiceItemInput {
  megnevezes: string
  mennyiseg: number
  /** Bruttó egységár (HUF, egész). */
  bruttoEgysegar: number
}

/**
 * Helyesbítő (módosító) számla hivatkozása — a részleges visszatérítés
 * bizonylata (C5). A Számla Agent ugyanazt az xmlszamla-műveletet használja,
 * két különbséggel: <helyesbitoszamla>true</helyesbitoszamla> és
 * <helyesbitettSzamlaszam> = az EREDETI számla száma. A tételek a korrekciót
 * (negatív bruttó értéket) hordozzák.
 */
export interface CorrectiveInvoiceRef {
  /** Az eredeti (helyesbítendő) számla száma — <helyesbitettSzamlaszam>. */
  originalInvoiceNumber: string
  /**
   * A helyesbítő saját, bizonylat-egyedi azonosítója. KÉT helyre kerül:
   * <szamlaKulsoAzon> (visszakeresési kulcs) ÉS <rendelesSzam> — utóbbi azért,
   * mert a provider-oldali duplikátum-védelem a rendelésszámra épül: az eredeti
   * számla rendelésszámával beküldött helyesbítő a bekapcsolt
   * rendelésszám-ismétlés-tiltásba (71/152) futna.
   */
  kulsoAzon: string
}

export interface BuildInvoiceXmlInput {
  agentKey: string
  orderNumber: string
  invoicePrefix: string
  /** Kiállítás dátuma (YYYY-MM-DD) — kelt és fizetési határidő. */
  issueDate: string
  /**
   * Teljesítési dátum (YYYY-MM-DD); elhagyva = issueDate. Helyesbítőnél az
   * EREDETI számla teljesítési dátuma megy ide (NAV-szabály: a helyesbítő
   * teljesítési dátumának naptári hónapja nem térhet el az eredetiétől).
   */
  teljesitesDatum?: string
  buyer: InvoiceBuyerInput
  items: InvoiceItemInput[]
  /** Áfakulcs: '27' (alapértelmezés) vagy 'AAM' (alanyi adómentes). */
  vatMode?: SzamlazzVatMode
  /**
   * Helyesbítő számla esetén az eredeti számla hivatkozása + a helyesbítő
   * saját, bizonylat-egyedi azonosítója (kulsoAzon + rendelesSzam).
   */
  corrective?: CorrectiveInvoiceRef
  /** A fejléc-megjegyzés felülírása (alapból a rendelésre utaló szöveg). */
  megjegyzes?: string
}

import { budapestDateString, escapeXml, isIsoDateString } from './xml'

export { budapestDateString, escapeXml, isIsoDateString }

export interface InvoiceLineAmounts {
  nettoEgysegar: string
  nettoErtek: number
  afaErtek: number
  bruttoErtek: number
}

export interface ComputeLineAmountsOptions {
  /**
   * Negatív bruttó egységár engedélyezése — kizárólag helyesbítő (módosító)
   * számla korrekciós tételéhez. A számítás ilyenkor az abszolút értéken fut,
   * és a négy összeg előjelet vált; így a korrekciós tétel kerekítése PONTOSAN
   * tükrözi az eredeti számla tételét (teljes összegű helyesbítés nullázódik).
   */
  allowNegative?: boolean
  /** Áfakulcs: '27' (alapértelmezés) vagy 'AAM' (alanyi adómentes). */
  vatMode?: SzamlazzVatMode
}

/**
 * Tételösszegek bruttóból visszaszámolva — HIBRID számítással.
 *
 * A Számlázz.hu NEM számol, hanem tételenként VALIDÁLJA a három egyenletet
 * (259–264 hibakódok):
 *   (1) nettoEgysegar × mennyiseg = nettoErtek
 *   (2) nettoErtek × afakulcs / 100 = afaErtek
 *   (3) nettoErtek + afaErtek     = bruttoErtek
 * Mindhárom egyszerre, egész forintra kerekített összegekkel nem tartható —
 * kerekítési tűrés kell. A hibrid képlet ezt osztja el a lehető legjobban:
 *
 *   bruttoUnit    = round(|bruttó egységár|)
 *   bruttoErtek   = bruttoUnit × mennyiseg                    (pontos szorzat)
 *   nettoErtek    = round(bruttoErtek / 1,27)                 (TÉTEL-szinten)
 *   afaErtek      = bruttoErtek − nettoErtek
 *   nettoEgysegar = nettoErtek / mennyiseg, legfeljebb 2 tizedesre
 *
 * Az eltérések:
 * - (1) ≤ 0,005 × mennyiseg (a 2 tizedes egységár kerekítése) — a checkout
 *   felső határán (99 db) is ≤ 0,5 Ft; mennyiseg=1 esetén NULLA, mert az
 *   egységár ilyenkor pontosan a nettoErtek (visszafelé kompatibilis).
 * - (2) ≤ 1,27 × 0,5 ≈ 0,64 Ft, MENNYISÉGTŐL FÜGGETLENÜL — ez a hibrid lényege.
 *   A korábbi, egységár-szintű kerekítés ezt a hibát a mennyiséggel szorozta
 *   (7 db → 1,4 Ft; 99 db → ~20 Ft), ami 260/263 hibakódot és VÉGLEGES
 *   „failed" számlát okozhatott.
 * - (3) PONTOS (a definícióból).
 *
 * AAM (alanyi adómentes) módban: nettoErtek = bruttoErtek, afaErtek = 0 —
 * belföldön AAM-eladóként kizárólag ez a kulcs jogszerű (a 0% és a TAM nem).
 */
export function computeLineAmounts(
  item: InvoiceItemInput,
  options: ComputeLineAmountsOptions = {},
): InvoiceLineAmounts {
  if (!Number.isInteger(item.mennyiseg) || item.mennyiseg < 1) {
    throw new SzamlazzApiError({
      message: `A számlatétel mennyisége nem értelmezhető (${item.mennyiseg}); legalább 1-es egész szám kell.`,
      kind: 'invalid_data',
      retryable: false,
    })
  }
  const negativeAllowed = options.allowNegative === true
  if (!Number.isFinite(item.bruttoEgysegar) || (!negativeAllowed && item.bruttoEgysegar < 0)) {
    throw new SzamlazzApiError({
      message: `A számlatétel bruttó egységára nem értelmezhető (${item.bruttoEgysegar}); számot kell megadni.`,
      kind: 'invalid_data',
      retryable: false,
    })
  }
  const vatMode = options.vatMode ?? '27'
  const negative = item.bruttoEgysegar < 0
  const bruttoUnit = Math.round(Math.abs(item.bruttoEgysegar))
  const bruttoErtek = bruttoUnit * item.mennyiseg
  const nettoErtek = vatMode === 'AAM' ? bruttoErtek : Math.round(bruttoErtek / VAT_DIVISOR)
  const afaErtek = bruttoErtek - nettoErtek
  // Helyesbítőnél mind a négy érték előjelet vált (a −0 kerülésével).
  const signed = (value: number): number => (negative && value !== 0 ? -value : value)
  const egysegar = formatNettoEgysegar(nettoErtek / item.mennyiseg)
  return {
    nettoEgysegar: negative && nettoErtek !== 0 ? `-${egysegar}` : egysegar,
    nettoErtek: signed(nettoErtek),
    afaErtek: signed(afaErtek),
    bruttoErtek: signed(bruttoErtek),
  }
}

/**
 * A nettó egységár szöveges alakja: legfeljebb 2 tizedes, PONT tizedesjellel
 * (a Számla Agent numerikus mezőinek alakja), egész értéknél tizedesek nélkül.
 * Így mennyiseg=1 esetén pontosan a nettoErtek megy ki, ahogy korábban.
 */
function formatNettoEgysegar(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, '')
}

/**
 * Dátum-kapu a Számla Agent fejléc-mezőihez: KIZÁRÓLAG YYYY-MM-DD alak mehet
 * ki. A teljesítési dátum forrása egy szabad szöveges DB-mező
 * (orders.invoiceCompletionDate) — a mező admin-oldali readOnly jelölése NEM
 * API-védelem, tehát staff-jogosultsággal tetszőleges szöveg kerülhetne bele,
 * és onnan escape nélkül az XML-be (bizonylat-hamisításig vezető
 * XML-injektálás). A kapun át nem menő érték VÉGLEGES hiba: az újraküldés
 * ugyanezt adná, emberi adatjavítás kell.
 *
 * A visszaadott érték az escape-elt alak — a kapu után az escapeXml már nem
 * változtat semmin, de mélységi védelemként a kimeneten is ott van.
 */
function isoDateForXml(value: string, mezo: string): string {
  if (!isIsoDateString(value)) {
    throw new SzamlazzApiError({
      message: `A számla ${mezo} mezőjében nem valódi dátum áll: kizárólag YYYY-MM-DD alak fogadható el.`,
      kind: 'invalid_data',
      retryable: false,
    })
  }
  return escapeXml(value)
}

/** A teljes számla-XML (xmlszamla) a hivatalos tag-sorrendben. */
export function buildInvoiceXml(input: BuildInvoiceXmlInput): string {
  const esc = escapeXml
  const corrective = input.corrective
  const vatMode = input.vatMode ?? '27'
  const keltDatum = isoDateForXml(input.issueDate, 'keltDatum (kiállítás dátuma)')
  const teljesitesDatum = isoDateForXml(
    input.teljesitesDatum ?? input.issueDate,
    'teljesitesDatum (teljesítési dátum)',
  )
  const fizetesiHataridoDatum = isoDateForXml(
    input.issueDate,
    'fizetesiHataridoDatum (fizetési határidő)',
  )
  const itemsXml = input.items
    .map((item) => {
      const amounts = computeLineAmounts(item, {
        allowNegative: corrective !== undefined,
        vatMode,
      })
      return [
        '    <tetel>',
        `      <megnevezes>${esc(item.megnevezes)}</megnevezes>`,
        `      <mennyiseg>${item.mennyiseg}</mennyiseg>`,
        '      <mennyisegiEgyseg>db</mennyisegiEgyseg>',
        `      <nettoEgysegar>${amounts.nettoEgysegar}</nettoEgysegar>`,
        `      <afakulcs>${vatMode}</afakulcs>`,
        `      <nettoErtek>${amounts.nettoErtek}</nettoErtek>`,
        `      <afaErtek>${amounts.afaErtek}</afaErtek>`,
        `      <bruttoErtek>${amounts.bruttoErtek}</bruttoErtek>`,
        '      <megjegyzes></megjegyzes>',
        '    </tetel>',
      ].join('\n')
    })
    .join('\n')

  const sendEmail = input.buyer.email.trim().length > 0
  const megjegyzes =
    input.megjegyzes ??
    `Kineticare online kurzus — rendelés: ${input.orderNumber} (Barion, bankkártya)`
  const kulsoAzon = corrective ? corrective.kulsoAzon : input.orderNumber
  // A <rendelesSzam> a provider-oldali duplikátum-védelem kulcsa (a fiókban
  // bekapcsolt rendelésszám-ismétlés-tiltás ezt figyeli, 71/152 hibakóddal).
  // A helyesbítő ÖNÁLLÓ bizonylat: az eredeti számla rendelésszámával minden
  // helyesbítő azonnal a tiltásba futna, ezért itt a bizonylat-egyedi kulcs
  // megy ki. Így a 71/152 tényleg azt jelenti: „EZ a helyesbítő már létezik",
  // és a külső azonosítóra futó feloldó lekérdezés a helyes bizonylatot találja.
  const rendelesSzam = corrective ? corrective.kulsoAzon : input.orderNumber

  return `<?xml version="1.0" encoding="UTF-8"?>
<xmlszamla xmlns="http://www.szamlazz.hu/xmlszamla" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.szamlazz.hu/xmlszamla https://www.szamlazz.hu/szamla/docs/xsds/agent/xmlszamla.xsd">
  <beallitasok>
    <szamlaagentkulcs>${esc(input.agentKey)}</szamlaagentkulcs>
    <eszamla>true</eszamla>
    <szamlaLetoltes>false</szamlaLetoltes>
    <valaszVerzio>2</valaszVerzio>
    <szamlaKulsoAzon>${esc(kulsoAzon)}</szamlaKulsoAzon>
  </beallitasok>
  <fejlec>
    <keltDatum>${keltDatum}</keltDatum>
    <teljesitesDatum>${teljesitesDatum}</teljesitesDatum>
    <fizetesiHataridoDatum>${fizetesiHataridoDatum}</fizetesiHataridoDatum>
    <fizmod>Barion</fizmod>
    <penznem>HUF</penznem>
    <szamlaNyelve>hu</szamlaNyelve>
    <megjegyzes>${esc(megjegyzes)}</megjegyzes>
    <arfolyamBank></arfolyamBank>
    <arfolyam></arfolyam>
    <rendelesSzam>${esc(rendelesSzam)}</rendelesSzam>
    <dijbekeroSzamlaszam></dijbekeroSzamlaszam>
    <elolegszamla>false</elolegszamla>
    <vegszamla>false</vegszamla>
    <helyesbitoszamla>${corrective ? 'true' : 'false'}</helyesbitoszamla>
    <helyesbitettSzamlaszam>${corrective ? esc(corrective.originalInvoiceNumber) : ''}</helyesbitettSzamlaszam>
    <dijbekero>false</dijbekero>
    <szamlaszamElotag>${esc(input.invoicePrefix)}</szamlaszamElotag>
  </fejlec>
  <elado>
    <bank></bank>
    <bankszamlaszam></bankszamlaszam>
    <emailReplyto></emailReplyto>
    <emailTargy></emailTargy>
    <emailSzoveg></emailSzoveg>
  </elado>
  <vevo>
    <nev>${esc(input.buyer.nev)}</nev>
    <irsz>${esc(input.buyer.irsz)}</irsz>
    <telepules>${esc(input.buyer.telepules)}</telepules>
    <cim>${esc(input.buyer.cim)}</cim>
    <email>${esc(input.buyer.email)}</email>
    <sendEmail>${sendEmail}</sendEmail>
    <adoszam>${esc(input.buyer.adoszam ?? '')}</adoszam>
    <postazasiNev></postazasiNev>
    <postazasiIrsz></postazasiIrsz>
    <postazasiTelepules></postazasiTelepules>
    <postazasiCim></postazasiCim>
    <azonosito></azonosito>
    <telefonszam></telefonszam>
    <megjegyzes></megjegyzes>
  </vevo>
  <fuvarlevel>
    <uticel></uticel>
    <futarSzolgalat></futarSzolgalat>
  </fuvarlevel>
  <tetelek>
${itemsXml}
  </tetelek>
</xmlszamla>`
}

// ---------------------------------------------------------------------------
// Számlakiállítás a rendeléshez
// ---------------------------------------------------------------------------

interface CustomerSnapshotShape {
  name?: unknown
  email?: unknown
  billingName?: unknown
  billingZip?: unknown
  billingCity?: unknown
  billingStreet?: unknown
  taxNumber?: unknown
}

function snapshotString(snapshot: CustomerSnapshotShape, key: keyof CustomerSnapshotShape): string {
  const value = snapshot[key]
  return typeof value === 'string' ? value.trim() : ''
}

/** A vevőadatok kinyerése a rendelés customerSnapshot-jából. Hiány esetén null. */
export function buyerFromOrder(order: Order): InvoiceBuyerInput | null {
  const snapshot =
    typeof order.customerSnapshot === 'object' && order.customerSnapshot !== null
      ? (order.customerSnapshot as CustomerSnapshotShape)
      : {}
  const nev = snapshotString(snapshot, 'billingName') || snapshotString(snapshot, 'name')
  const irsz = snapshotString(snapshot, 'billingZip')
  const telepules = snapshotString(snapshot, 'billingCity')
  const cim = snapshotString(snapshot, 'billingStreet')
  const email = snapshotString(snapshot, 'email') || (order.customerEmail ?? '').trim()
  if (!nev || !irsz || !telepules || !cim) {
    return null
  }
  const adoszam = snapshotString(snapshot, 'taxNumber')
  return { nev, irsz, telepules, cim, email, ...(adoszam ? { adoszam } : {}) }
}

/** A rendelés-tételek számlatétel-leképezése a snapshot-mezőkből. Hiány esetén null. */
export function itemsFromOrder(order: Order): InvoiceItemInput[] | null {
  const items = order.items ?? []
  if (items.length === 0) {
    return null
  }
  const mapped: InvoiceItemInput[] = []
  for (const item of items) {
    const quantity = item.quantity ?? 1
    const price = item.priceHufSnapshot
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
      return null
    }
    mapped.push({
      megnevezes: item.titleSnapshot?.trim() || 'Kineticare online kurzus',
      mennyiseg: quantity,
      bruttoEgysegar: price,
    })
  }
  return mapped
}

/*
 * A számlalink allowlistje a függőség nélküli `./invoice-url` levél-modulban él,
 * hogy a vásárló fiók-oldala (`'use client'`) is ugyanazt az implementációt
 * használhassa — ez a modul a Payload local API-t és a naplózót is behúzza,
 * tehát kliensre nem kerülhet. A re-export a meglévő importálók kedvéért marad.
 */
export { isTrustedInvoicePdfUrl }

/** Naplóbarát hoszt-részlet: a teljes URL sosem kerül naplóba. */
function safeUrlHost(value: string): string {
  try {
    return new URL(value).host || 'ismeretlen'
  } catch {
    return 'értelmezhetetlen-url'
  }
}

/**
 * A Számlázz.hu hivatalos szabálya: ugyanaz a kérés legfeljebb ÖTSZÖR küldhető
 * be, utána emberi beavatkozás kell (az automatikus retry-loop a szolgáltatásból
 * való kitiltáshoz vezethet). A számláló a rendelésen perzisztens
 * (invoiceAttempts), így a job-retryk és az újrasorbaállítások együttese sem
 * lépheti túl.
 */
export const MAX_INVOICE_ATTEMPTS = 5

export interface IssueInvoiceForOrderDeps {
  payload: Payload
  orderId: number
  config?: SzamlazzClientConfig
  logger?: Logger
  /** Injektálható HTTP-hívó (teszteléshez); alapból a valódi postInvoiceXml. */
  postXml?: (xml: string, config: SzamlazzClientConfig) => Promise<SzamlazzParsedSuccess>
  /**
   * Injektálható bizonylat-lekérdező (teszteléshez); alapból a valódi
   * queryInvoiceByKulsoAzon. Minden beküldés ELŐTT fut (első kísérlet is) —
   * a paid job + poll resweep ne POST-oljon kétszer, ha a bizonylat már
   * létezik. 71/152 után is lefut a meglévő számla számának átvételére.
   * A lekérdezés NEM fogyaszt beküldési kísérletet (F10).
   */
  queryByKulsoAzon?: (
    kulsoAzon: string,
    config: SzamlazzClientConfig,
  ) => Promise<InvoiceLookupResult | null>
  /** A kelt-dátum felülírása (teszteléshez); alapból a mai dátum. */
  issueDate?: string
  /**
   * Injektálható stornó-kiállítás (teszteléshez); alapból a valódi
   * issueStornoForOrder. A refund-verseny (W7) utáni inline stornóhoz kell:
   * ha a számla kiállt, de közben a rendelés refunded lett, a stornót ITT
   * állítjuk ki. queueStornoIssueJob TILOS (W5 — a sorbaállítás csapda).
   * invoice.ts NEM importál a refund-orderből (ciklus: a refund a
   * szamlazz-modulból húz).
   */
  issueStorno?: (order: Order, deps?: IssueStornoForOrderDeps) => Promise<IssueStornoResult>
}

/**
 * Számla kiállítása egy paid rendeléshez — idempotens:
 * - issued/invoiceNumber már megvan → 'already-issued' (no-op);
 * - Számlázz.hu kikapcsolva (nincs agent-kulcs) → 'disabled' (no-op);
 * - hiányzó vevő-/tételadat → invoiceStatus 'failed' + 'failed' (NEM dob,
 *   a job nem újrapróbálja — emberi adatpótlás kell);
 * - retryable provider/timeout-hiba → invoiceStatus MARAD 'pending' (a hibát
 *   az invoiceLastError hordozza) + THROW. A 'pending' azért kötelező, mert az
 *   order-poll resweep csak a ['none','pending'] rendeléseket veszi fel újra
 *   (src/lib/order-poll/service.ts) — 'failed' esetén a job-retryk kimerülése
 *   után a számla ÖRÖKRE elveszne. A valódi fék a perzisztens 5-ös plafon (F4).
 *
 * A paid/issue szakasz `invoice:<orderId>` advisory-zár alatt fut (W7):
 * a paid-átmenet jobja és a poll resweep ne POST-oljon egyszerre. A
 * Számlázz.hu HTTP a záron belül van (a refund mintája). Barion-hívás NINCS
 * ebben a zárban. Mockolt Payload (nincs drizzle) nem-productionben a zár
 * nélkül futtatja a `fn`-t.
 */
export async function issueInvoiceForOrder(
  deps: IssueInvoiceForOrderDeps,
): Promise<IssueInvoiceResult> {
  const log = (deps.logger ?? rootLogger).child({
    module: 'szamlazz-invoice',
    orderId: deps.orderId,
  })
  const config = deps.config ?? getSzamlazzConfig()

  if (!config.enabled) {
    log.debug('számlázás kikapcsolva (SZAMLAZZ_AGENT_KEY nincs beállítva) — kihagyva')
    return { outcome: 'disabled' }
  }

  return withAdvisoryLock(
    deps.payload,
    `invoice:${deps.orderId}`,
    async () => {
  const order = (await deps.payload.findByID({
    collection: 'orders',
    id: deps.orderId,
    depth: 0,
    overrideAccess: true,
  })) as Order | null
  if (!order) {
    log.warn('a rendelés nem található — számlakiállítás kihagyva')
    return { outcome: 'failed', reason: 'a rendelés nem található' }
  }
  const orderLog = log.child({ orderNumber: order.orderNumber ?? null })

  if (order.invoiceStatus === 'issued' || order.invoiceNumber) {
    orderLog.info('a rendeléshez már kiállították a számlát — idempotens no-op', {
      invoiceNumber: order.invoiceNumber ?? null,
    })
    return {
      outcome: 'already-issued',
      ...(order.invoiceNumber ? { invoiceNumber: order.invoiceNumber } : {}),
    }
  }

  /**
   * Védelem mélységében: számla KIZÁRÓLAG paid rendeléshez állítható ki. A
   * sorbaállítás ma csak a paid-átmenetből (és a paid-rendeléseket pásztázó
   * resweepből) történik, de a szolgáltatás a FRISSEN olvasott rendelésen is
   * kikényszeríti — egy jövőbeli hívó vagy egy refundálás utáni elavult job így
   * sem állíthat ki számlát nem-fizetett rendelésre.
   */
  if (order.status !== 'paid') {
    orderLog.info('a rendelés státusza nem paid — számlakiállítás kihagyva', {
      status: order.status ?? null,
    })
    return { outcome: 'skipped', reason: 'a rendelés státusza nem paid' }
  }

  if (!order.orderNumber) {
    orderLog.error('RIASZTÁS: a rendelés rendelésszám nélkül fut — számla nem állítható ki')
    await writeOrderInvoicingState(deps.payload, deps.orderId, { invoiceStatus: 'failed' })
    return { outcome: 'failed', reason: 'hiányzó rendelésszám' }
  }

  const buyer = buyerFromOrder(order)
  if (!buyer) {
    // VÉGLEGES vesztés-ág: a rendelés kifizetve, a kurzus kiadva, számla
    // viszont soha nem áll ki (a hívó `outcome: 'failed'`-del, DOBÁS NÉLKÜL
    // zár, tehát nincs újrapróbálás). A szomszédos, ugyanilyen végleges ágak
    // (rendelésszám, ár-snapshot, kimerült plafon) mind `error` + `RIASZTÁS:`
    // szintűek — ez eddig warn volt, ezért NÉMÁN veszett el.
    orderLog.error(
      'RIASZTÁS: hiányos vevő-számlázási adatok (név/irsz/település/cím) — számla NEM állítható ki, emberi pótlás szükséges',
    )
    await writeOrderInvoicingState(deps.payload, deps.orderId, { invoiceStatus: 'failed' })
    return { outcome: 'failed', reason: 'hiányos vevő-számlázási adatok' }
  }

  const items = itemsFromOrder(order)
  if (!items) {
    orderLog.error(
      'RIASZTÁS: a rendelés-tételekből hiányzik az ár-snapshot — számla nem állítható ki',
    )
    await writeOrderInvoicingState(deps.payload, deps.orderId, { invoiceStatus: 'failed' })
    return { outcome: 'failed', reason: 'hiányzó tétel ár-snapshot' }
  }

  // A14: perzisztens kísérlet-plafon — a Számlázz.hu felé ugyanaz a kérés
  // legfeljebb ötször mehet ki, utána emberi beavatkozás kell.
  const previousAttempts = order.invoiceAttempts ?? 0
  if (previousAttempts >= MAX_INVOICE_ATTEMPTS) {
    const reason = `a számlakiállítási kísérletek száma kimerült (${previousAttempts}/${MAX_INVOICE_ATTEMPTS})`
    orderLog.error(
      'RIASZTÁS: a számlakiállítás beküldései kimerültek — emberi beavatkozás kell (Számlázz.hu-szabály: max. 5 beküldés)',
      { attempts: previousAttempts, lastError: order.invoiceLastError ?? null },
    )
    await writeOrderInvoicingState(deps.payload, deps.orderId, {
      invoiceStatus: 'failed',
      invoiceLastError: reason,
    })
    return { outcome: 'failed', reason }
  }

  // A kelt-dátum a SZÉKHELY szerinti naptári nap: UTC-ből képezve magyar idő
  // szerint 00:00–02:00 között az előző napra (adott esetben az előző
  // áfa-időszakra) állna ki a számla.
  const issueDate = deps.issueDate ?? budapestDateString()
  const xml = buildInvoiceXml({
    agentKey: config.agentKey as string,
    orderNumber: order.orderNumber,
    invoicePrefix: config.invoicePrefix,
    issueDate,
    buyer,
    items,
    vatMode: config.vatMode,
  })

  /**
   * A ténylegesen BEKÜLDÖTT kísérletek száma. A lekérdezés (F10) nem fogyaszt
   * keretet, ezért a számláló csak a POST előtt, a pending-írással együtt nő.
   */
  let attempts = previousAttempts
  const lookup = deps.queryByKulsoAzon ?? queryInvoiceByKulsoAzon
  const rereadOrder = async (): Promise<Order | null> => {
    return (await deps.payload.findByID({
      collection: 'orders',
      id: deps.orderId,
      depth: 0,
      overrideAccess: true,
    })) as Order | null
  }
  /**
   * W7: a számla kiállt (vagy átvettük), de a refund közben refunded-re
   * állíthatta a rendelést üres invoiceNumberrel — stornó nem indulna.
   * Itt, a számla számának rögzítése UTÁN újraolvasunk, és ha kell, inline
   * stornózunk. A stornó hibája NEM billenti a számla-kimenetet failed-re.
   */
  const stornoIfRefundedAfterIssue = async (invoiceNumber: string): Promise<void> => {
    const latest = await rereadOrder()
    if (!latest) {
      return
    }
    const recordedInvoice = latest.invoiceNumber?.trim() || invoiceNumber
    const hasStorno = Boolean(latest.stornoNumber?.trim()) || latest.stornoStatus === 'storned'
    if (latest.status !== 'refunded' || !recordedInvoice || hasStorno) {
      return
    }
    const issueStorno = deps.issueStorno ?? (await import('./storno')).issueStornoForOrder
    const orderForStorno: Order = { ...latest, invoiceNumber: recordedInvoice }
    try {
      const stornoResult = await issueStorno(orderForStorno, {
        payload: deps.payload,
        config,
        logger: orderLog,
        reason: 'a számla a refund után állt ki — automatikus stornó',
      })
      if (stornoResult.outcome === 'failed') {
        orderLog.error(
          'RIASZTÁS: a számla kiállt, de a rendelés közben refunded lett, és a stornó nem készült el',
          { invoiceNumber: recordedInvoice, reason: stornoResult.reason ?? null },
        )
      }
    } catch (stornoError) {
      const message = stornoError instanceof Error ? stornoError.message : String(stornoError)
      orderLog.error(
        'RIASZTÁS: a számla kiállt, de a rendelés közben refunded lett, és a stornó hibával állt le',
        { invoiceNumber: recordedInvoice, error: message },
      )
    }
  }
  /** A meglévő bizonylat átvétele (lekérdezés-találat vagy 71/152-feloldás). */
  const adoptExisting = async (szamlaszam: string, via: string): Promise<IssueInvoiceResult> => {
    await writeOrderInvoicingState(deps.payload, deps.orderId, {
      invoiceStatus: 'issued',
      invoiceNumber: szamlaszam,
      invoiceLastError: null,
      // A teljesítési dátumot SZÁNDÉKOSAN nem írjuk felül: a bizonylat egy
      // KORÁBBI kísérletben állt ki, tehát annak a kísérletnek a dátuma az
      // érvényes — azt a pending-írás (F8) már rögzítette. A mező csak a
      // funkció bevezetése előtti bizonylatoknál maradhat üres; a helyesbítő
      // ilyenkor figyelmeztetéssel a saját kiállítási napjára esik vissza.
    })
    orderLog.info('a számla már korábban kiállt — a meglévő bizonylat átvéve', {
      invoiceNumber: szamlaszam,
      via,
      attempts,
    })
    await stornoIfRefundedAfterIssue(szamlaszam)
    return { outcome: 'issued', invoiceNumber: szamlaszam }
  }

  try {
    // A12 + W7: MINDEN beküldés ELŐTT szamlaKulsoAzon-lekérdezés — első
    // kísérletnél is. A paid job és a poll resweep így nem POST-ol kétszer,
    // ha a bizonylat már létezik. A lekérdezés hibája szándékosan propagál
    // (a státusz pending marad): bizonytalan állapotban nem szabad vakon
    // újra beküldeni. A lekérdezés NEM fogyaszt kísérletet (F10).
    const found = await lookup(order.orderNumber, config)
    if (found) {
      return await adoptExisting(
        found.szamlaszam,
        previousAttempts > 0 ? 'retry-elotti lekerdezes' : 'elso-kiserlet-elotti lekerdezes',
      )
    }

    // W7: a kezdeti paid-ellenőrzés és a POST között a refund refunded-re
    // állíthatja a rendelést. Közvetlenül a kísérlet-növelés / POST előtt
    // újraolvasunk (az invoice-zár a párhuzamos kiállítót sorosítja).
    const latestBeforePost = await rereadOrder()
    if (!latestBeforePost || latestBeforePost.status !== 'paid') {
      orderLog.info('a rendelés státusza nem paid — számlakiállítás kihagyva', {
        status: latestBeforePost?.status ?? null,
      })
      return { outcome: 'skipped', reason: 'a rendelés státusza nem paid' }
    }

    attempts = previousAttempts + 1
    await writeOrderInvoicingState(deps.payload, deps.orderId, {
      invoiceStatus: 'pending',
      invoiceAttempts: attempts,
      // F8: a KIKÜLDÖTT teljesítési dátum már itt rögzül — ha a válasz
      // elveszik, a későbbi helyesbítő így is az eredeti dátumot ismétli
      // (B4/NAV-hónapszabály). Az adoptExisting szándékosan NEM írja felül:
      // ott egy KORÁBBI kísérlet dátuma az érvényes, amit ez az írás rögzített.
      invoiceCompletionDate: issueDate,
    })

    const postXml = deps.postXml ?? postInvoiceXml
    const result = await postXml(xml, config)
    // A vevői fiók URL-jét CSAK allowlist után mentjük — a link a vásárló
    // fiók-oldalán kattintható. Nem megfelelő URL: nem mentjük (a számla maga
    // ettől még kiállt), és riasztunk, mert ilyet a Számlázz.hu nem küldhet.
    const trustedPdfUrl =
      result.vevoifiokUrl && isTrustedInvoicePdfUrl(result.vevoifiokUrl)
        ? result.vevoifiokUrl
        : undefined
    if (result.vevoifiokUrl && !trustedPdfUrl) {
      orderLog.warn(
        'a Számlázz.hu nem megbízható vevői fiók URL-t adott vissza — a link NEM kerül mentésre',
        // A teljes URL-t szándékosan nem naplózzuk (query-string tokent hordozhat).
        { urlHost: safeUrlHost(result.vevoifiokUrl) },
      )
    }
    await writeOrderInvoicingState(deps.payload, deps.orderId, {
      invoiceStatus: 'issued',
      invoiceNumber: result.szamlaszam,
      // A helyesbítő dátumszabályához (B4): az itt küldött teljesítési dátum rögzül.
      invoiceCompletionDate: issueDate,
      invoiceLastError: null,
      ...(trustedPdfUrl ? { invoicePdfUrl: trustedPdfUrl } : {}),
    })
    orderLog.info('számla kiállítva', { invoiceNumber: result.szamlaszam, attempts })
    await stornoIfRefundedAfterIssue(result.szamlaszam)
    return { outcome: 'issued', invoiceNumber: result.szamlaszam }
  } catch (error) {
    // 71/152 — „Már létező rendelésszám": nem hiba, hanem idempotencia-találat.
    // A meglévő bizonylat számát lekérdezéssel vesszük át.
    if (isDuplicateOrderError(error)) {
      orderLog.info(
        'a Számlázz.hu duplikátum-jelzést adott (71/152) — a meglévő számla lekérdezése',
        { agentErrorCodes: error.agentErrors.map((entry) => entry.code) },
      )
      try {
        const found = await lookup(order.orderNumber, config)
        if (found) {
          return await adoptExisting(found.szamlaszam, 'duplikatum-feloldas')
        }
        const reason =
          'a Számlázz.hu duplikátumot jelzett (71/152), de a szamlaKulsoAzon-lekérdezés nem talál bizonylatot — kézi egyeztetés szükséges'
        orderLog.error(`RIASZTÁS: ${reason}`)
        await writeOrderInvoicingState(deps.payload, deps.orderId, {
          invoiceStatus: 'failed',
          invoiceLastError: reason,
        }).catch(() => undefined)
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
    // F4: újrapróbálható hibán a státusz PENDING marad — az order-poll resweep
    // csak a ['none','pending'] rendeléseket veszi fel újra, 'failed' esetén a
    // job-retryk kimerülése után a számla örökre elveszne. Végleges hibán
    // (és csak ott) 'failed'.
    const retryable = error instanceof SzamlazzApiError && error.retryable
    await writeOrderInvoicingState(deps.payload, deps.orderId, {
      invoiceStatus: retryable ? 'pending' : 'failed',
      invoiceLastError: message,
    }).catch(() => undefined)
    if (error instanceof SzamlazzApiError) {
      orderLog.warn('számlakiállítás sikertelen', {
        kind: error.kind,
        retryable: error.retryable,
        attempts,
        agentErrorCodes: error.agentErrors.map((entry) => entry.code),
        error: error.message,
      })
      if (error.retryable) {
        // A job-retry (kimerülése után az order-poll resweep) újrapróbálja: a
        // következő futás a beküldés ELŐTT lekérdezi a bizonylatot, a
        // beküldések számát pedig az invoiceAttempts plafon korlátozza.
        throw error
      }
      return { outcome: 'failed', reason: error.message }
    }
    orderLog.error('számlakiállítás váratlan hibával állt le', { attempts, error: message })
    throw error
  }
    },
    log,
  )
}
