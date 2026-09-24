import type { Payload } from 'payload'

import type { Order } from '../../payload-types'
import { withAdvisoryLock } from '../advisory-lock'
import { shouldEmitThrottledAlert } from '../alert-throttle'
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
import { resolveOrderPaidMoment, type OrderPaidMoment } from './paid-date'
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
 * Szabályok (a hivatalos Számla Agent minta és az élő XSD alapján —
 * https://www.szamlazz.hu/szamla/docs/xsds/agent/xmlszamla.xsd):
 * - A mezők SORRENDJE KÖTÖTT (xs:sequence). A szöveges (xs:string) váz-tagok
 *   üresen is kimehetnek, a TÍPUSOS tagok (double, date, int, boolean) viszont
 *   NEM: az üres érték XSD-hiba, amit a szerver 57-es „XML beolvasási hibával"
 *   utasít el. Ezért az opcionális típusos tagot (pl. <arfolyam>) vagy
 *   érvényes értékkel küldjük, vagy egyáltalán nem. A kimenetet a tesztsor az
 *   élő XSD repóba vendorolt másolatával ellenőrzi
 *   (src/__tests__/szamlazz/xsd-validation.test.ts).
 * - Forint-számla: az <arfolyamBank>/<arfolyam> pár KIMARAD (mindkettő
 *   minOccurs=0, és csak devizás számlán van jelentésük — a hivatalos PHP SDK
 *   és a WooCommerce-bővítmény is így küldi).
 * - <fizetve>true</fizetve>: a számla egy MÁR KIFIZETETT (Barion, bankkártya)
 *   rendelésről szól, a helyesbítő pedig egy már visszautalt összegről.
 *   Nélküle a Számlázz.hu csak a készpénzes számlát tartja kiegyenlítettnek,
 *   minden mást kintlévőségként, lejárat után fizetési felszólítással
 *   (tudastar.szamlazz.hu/gyik/szamla-kiegyenlitett-hogyan). A kifizetettség
 *   kezelése előfizetéses (#start+) csomagot kíván — ugyanazt, amit az
 *   <eszamla>true</eszamla> amúgy is megkövetel.
 * - <vevo><adoalany>: 1, ha van (a checkoutban ellenőrzött, magyar) adószám,
 *   különben -1 (magánszemély). A tudástár (vevo-adoszama-szamlan) szerint a
 *   hiánya partnertörzs-ütközésnél hibát okozhat, és az értéknek pontosan az
 *   adószám meglétével kell egyeznie.
 * - A Számlázz.hu NEM számol: minden tételösszeg (nettoErtek, afaErtek,
 *   bruttoErtek) és a nettoEgysegar kötelezően megadott; az Agent a tétel-
 *   matematikát validálja (57, 259–264 hibakódok).
 * - Bruttó áraink vannak (fogyasztói ár, HUF); az áfakulcs a konfigurációból
 *   jön: '27' vagy 'AAM' (alanyi adómentes eladó). A
 *   tételszámítás HIBRID (bruttó tétel-érték + 2 tizedes nettó egységár) —
 *   a pontos képlet és a három hivatalos egyenlet toleranciája a
 *   `computeLineAmounts` docblockjában.
 * - Minden dátum (keltDatum / teljesitesDatum / fizetesiHataridoDatum) kötelező
 *   YYYY-MM-DD alakú: a builder kapun vezeti át őket (`isIsoDateString`), mert
 *   a teljesítési dátum forrása egy szabad szöveges DB-mező.
 * - Kelt = fizetési határidő = a kiállítás napja; a teljesítés a fizetés
 *   (hozzáférés-nyitás) budapesti napja, ha a hívó megadja. A fizetési
 *   határidő SZÁNDÉKOSAN nem korábbi a keltnél: a Számlázz.hu modelljében a
 *   határidő „csak a keltezés napjára vagy annál később" állítható, a
 *   teljesítés viszont „akár korábbi is lehet"
 *   (tudastar.szamlazz.hu/gyik/ismetlodo-szamlazas-utemezese).
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
   * Teljesítési dátum (YYYY-MM-DD); elhagyva = issueDate. Normál számlán a
   * fizetés (hozzáférés-nyitás) budapesti napja; helyesbítőnél az EREDETI
   * számla teljesítési dátuma (NAV-szabály: a helyesbítő teljesítési
   * dátumának naptári hónapja nem térhet el az eredetiétől).
   */
  teljesitesDatum?: string
  buyer: InvoiceBuyerInput
  items: InvoiceItemInput[]
  /**
   * Áfakulcs: '27' vagy 'AAM' (alanyi adómentes). A builder elhagyva '27'-tel
   * számol; éles úton a hívó MINDIG a konfigurációból adja (a SZAMLAZZ_AFAKULCS
   * bekapcsolt számlázásnál kötelező, alapértelmezés nélkül).
   */
  vatMode?: SzamlazzVatMode
  /**
   * Helyesbítő számla esetén az eredeti számla hivatkozása + a helyesbítő
   * saját, bizonylat-egyedi azonosítója (kulsoAzon + rendelesSzam).
   */
  corrective?: CorrectiveInvoiceRef
  /** A fejléc-megjegyzés felülírása (alapból a rendelésre utaló szöveg). */
  megjegyzes?: string
}

import { budapestDateString, escapeXml, isIsoDateString, stripXmlIllegalChars } from './xml'

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
  const adoszam = input.buyer.adoszam?.trim() ?? ''
  // Az adóalanyiság SZIGORÚAN az adószám meglétéből képződik (a checkout csak
  // ellenőrzött magyar adószámot fogad): 1 = van magyar adószáma, -1 = nincs.
  const adoalany = adoszam.length > 0 ? 1 : -1
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
    <rendelesSzam>${esc(rendelesSzam)}</rendelesSzam>
    <dijbekeroSzamlaszam></dijbekeroSzamlaszam>
    <elolegszamla>false</elolegszamla>
    <vegszamla>false</vegszamla>
    <helyesbitoszamla>${corrective ? 'true' : 'false'}</helyesbitoszamla>
    <helyesbitettSzamlaszam>${corrective ? esc(corrective.originalInvoiceNumber) : ''}</helyesbitettSzamlaszam>
    <dijbekero>false</dijbekero>
    <szamlaszamElotag>${esc(input.invoicePrefix)}</szamlaszamElotag>
    <fizetve>true</fizetve>
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
    <adoalany>${adoalany}</adoalany>
    <adoszam>${esc(adoszam)}</adoszam>
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

/**
 * A snapshot-mező szöveges értéke. Az XML 1.0-ban tiltott karakterek (pl.
 * U+FFFF) itt már kiesnek: a pénztár ma a bevitelnél szűri őket, de egy a
 * szűrés ELŐTT mentett, csak ilyenekből álló név az escapeXml után üres
 * <nev>-vel menne ki. Így az ilyen rendelés a hiányos-vevőadat ágra fut.
 */
function snapshotString(snapshot: CustomerSnapshotShape, key: keyof CustomerSnapshotShape): string {
  const value = snapshot[key]
  return typeof value === 'string' ? stripXmlIllegalChars(value).trim() : ''
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

const HOUR_MS = 60 * 60 * 1000

/**
 * H4: a beküldés ELŐTTI bizonylat-lekérdezés újrapróbálható hibáinak fékje. A
 * lekérdezés nem fogyaszt beküldési kísérletet (F10), ezért a
 * MAX_INVOICE_ATTEMPTS plafon nem állítja meg: egy tartósan hibás lekérdezés
 * (pl. elgépelt SZAMLAZZ_API_URL, amely a Számlázz.hu nyitóoldalára mutat és
 * 200-as HTML-t ad) nélküle örökre pending maradna, és az order-poll resweep
 * ötpercenként újra lekérdezne.
 *
 * A fék a folyamatos HIBASOROZATOT méri, nem a fizetés óta eltelt időt
 * önmagában. A sorozat az első sikertelen lekérdezéssel indul, és minden
 * sikeres lekérdezés (találat vagy „nincs ilyen bizonylat") lezárja.
 * - A sorozat LOOKUP_FAILURE_ALERT_AFTER_MS hossza után egy (rendelésenként
 *   fojtott) error-szintű RIASZTÁS; addig minden hiba csak warn.
 * - A számla akkor lesz 'failed' + RIASZTÁS (dobás nélkül, a resweep ezután
 *   nem veszi fel újra), ha a sorozat legalább LOOKUP_FAILURE_ALERT_AFTER_MS
 *   óta tart, ÉS a fizetés óta több mint LOOKUP_FAILURE_ESCALATION_MS telt
 *   el. Egy job- vagy konfigurációs kiesés után feldolgozott, 24 óránál
 *   régebbi lemaradás így egyetlen átmeneti hibától (503, timeout,
 *   karbantartási oldal) nem vész el: a következő futás rendben kiállítja.
 *
 * A fizetés pillanata a lekérdezés előtt már fel van oldva
 * (resolveOrderPaidMoment); ha nem ismert, a rendelés létrehozása (createdAt)
 * az időalap, ami a fizetésnél sosem későbbi.
 */
export const LOOKUP_FAILURE_ALERT_AFTER_MS = 2 * HOUR_MS
export const LOOKUP_FAILURE_ESCALATION_MS = 24 * HOUR_MS

/**
 * A hibasorozat kezdete PERZISZTENS, migráció nélkül: az invoiceLastError
 * elején álló, géppel is olvasható előtag, pl.
 * `[lekérdezési hiba 2026-09-24T10:00:00.000Z óta] <az utolsó hiba>`. Így egy
 * újraindulás vagy deploy sem indítja újra a sorozatot. A mezőt kizárólag ez a
 * modul írja, és az `invoice:<orderId>` advisory-zár alatt olvassa és írja,
 * tehát egy párhuzamos job sem írhatja közben felül. A sikeres lekérdezés
 * utáni első állapotírás (átvétel, plafon-döntés vagy a beküldés előtti
 * pending-írás) az előtagot törli.
 */
const LOOKUP_STREAK_MARKER =
  /^\[lekérdezési hiba (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) óta\] /

function withLookupStreakMarker(startedAtMs: number, message: string): string {
  return `[lekérdezési hiba ${new Date(startedAtMs).toISOString()} óta] ${message}`
}

interface ParsedLookupStreak {
  /** Volt-e előtag (érvényes vagy sem). */
  marked: boolean
  /** A sorozat kezdete; null, ha nincs előtag, vagy a kezdet értelmezhetetlen vagy jövőbeli. */
  startedAtMs: number | null
  /** Az előtag nélküli hibaüzenet (null, ha a mező üres). */
  message: string | null
}

function parseLookupStreak(
  lastError: string | null | undefined,
  nowMs: number,
): ParsedLookupStreak {
  if (!lastError) {
    return { marked: false, startedAtMs: null, message: null }
  }
  const match = LOOKUP_STREAK_MARKER.exec(lastError)
  if (!match) {
    return { marked: false, startedAtMs: null, message: lastError }
  }
  const startedAtMs = Date.parse(match[1] ?? '')
  return {
    marked: true,
    // Óraeltérésből eredő jövőbeli kezdet érvénytelen: a sorozat újraindul.
    startedAtMs: Number.isFinite(startedAtMs) && startedAtMs <= nowMs ? startedAtMs : null,
    message: lastError.slice(match[0].length),
  }
}

/**
 * F11: 71/152 után a bizonylat a Számlázz.hu szerint MÁR LÉTEZIK. A tény az
 * invoiceLastError elején utazik tovább, a lekérdezési hibasorozat alatt is,
 * hogy a leállás szövege a kézi újrakiállítás helyett a keresést kérje.
 */
const DUPLICATE_EXISTS_NOTE = '71/152 — a bizonylat a Számlázz.hu szerint már létezik'

/**
 * A kézi rendezésre váró VÉGLEGES leállás közös előtagja az invoiceLastError
 * elején (H4-időkorlát, végleges lekérdezés-hiba egy korábbi beküldés után,
 * kimerült plafon). Egy ilyen rendelésen egy még sorban álló (pl. a resweep
 * által duplán sorba állított) job sem kérdez le és nem küld be: a RIASZTÁS
 * kézi rendezést kért, és egy közben lefutó automatikus beküldés a kézzel
 * kiállított mellé dupla NAV-számlát tenne.
 */
const INVOICE_AUTOMATION_STOPPED = 'A számla automatikus kiállítása leállt'

/** A lekérdezés-hiba korának kiindulópontja, vagy null, ha egyik időpont sem ismert. */
function lookupFailureClockStart(
  paidMoment: OrderPaidMoment | null,
  order: Order,
): { atMs: number; source: 'fizetes' | 'rendeles' } | null {
  const paidAtMs = paidMoment ? paidMoment.paidAt.getTime() : Number.NaN
  if (Number.isFinite(paidAtMs)) {
    return { atMs: paidAtMs, source: 'fizetes' }
  }
  const createdAtMs = typeof order.createdAt === 'string' ? Date.parse(order.createdAt) : Number.NaN
  return Number.isFinite(createdAtMs) ? { atMs: createdAtMs, source: 'rendeles' } : null
}

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
   * létezik. A kimerült plafonnál is lefut (H3), mielőtt a számla 'failed'
   * lesz. 71/152 után is lefut a meglévő számla számának átvételére.
   * A lekérdezés NEM fogyaszt beküldési kísérletet (F10); a hibáit a
   * hibasorozat-alapú időkorlát fékezi (LOOKUP_FAILURE_ALERT_AFTER_MS,
   * LOOKUP_FAILURE_ESCALATION_MS).
   */
  queryByKulsoAzon?: (
    kulsoAzon: string,
    config: SzamlazzClientConfig,
  ) => Promise<InvoiceLookupResult | null>
  /** A kelt-dátum felülírása (teszteléshez); alapból a mai dátum. */
  issueDate?: string
  /**
   * Injektálható fizetési-pillanat feloldó (teszteléshez); alapból a valódi
   * resolveOrderPaidMoment (a vevő accessGrants-sora a rendeléshez). Ebből
   * képződik a teljesítési dátum.
   */
  resolvePaidMoment?: (order: Order) => Promise<OrderPaidMoment | null>
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
 *   után a számla ÖRÖKRE elveszne. A valódi fék a perzisztens 5-ös plafon (F4),
 *   a beküldés előtti lekérdezés hibáira pedig az időkorlát (H4): ha a
 *   lekérdezés legalább 2 órája folyamatosan hibás, és a fizetés óta több mint
 *   24 óra telt el, a számla 'failed' + RIASZTÁS, dobás nélkül;
 * - kimerült plafon (H3) → előbb lekérdezés: találatnál a meglévő számla
 *   átvétele, üres találatnál 'failed' + RIASZTÁS, beküldés NÉLKÜL; a
 *   lekérdezés újrapróbálható hibájánál azonnali (fojtott) RIASZTÁS, és a
 *   lekérdezés a H4-időkorlátig ismétlődik (az 5. beküldés bizonylata így
 *   a Számlázz.hu helyreállása után is átvehető);
 * - kézi rendezésre váró végleges leállás (INVOICE_AUTOMATION_STOPPED) →
 *   'skipped', lekérdezés és beküldés NÉLKÜL (egy még sorban álló job sem
 *   küldhet be a kézi kiállítás mellé).
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

      // Kézi rendezésre váró végleges leállás (H4, H3): a RIASZTÁS a kézi
      // rendezést kérte. Egy még sorban álló job (a resweep a 'none'
      // rendeléseket frissesség-szűrés nélkül is újra sorba állítja) itt sem
      // lekérdezni, sem beküldeni nem próbál: a kézzel kiállított számla mellé
      // egy automatikus beküldés dupla NAV-számlát adna.
      if (
        order.invoiceStatus === 'failed' &&
        order.invoiceLastError?.startsWith(INVOICE_AUTOMATION_STOPPED)
      ) {
        orderLog.info(
          'a számla automatikus kiállítása korábban leállt, kézi rendezésre vár — kihagyva',
        )
        return {
          outcome: 'skipped',
          reason: 'a számla automatikus kiállítása leállt, kézi rendezésre vár',
        }
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
      // legfeljebb ötször mehet ki, utána emberi beavatkozás kell. A plafon
      // SZÁNDÉKOSAN csak a beküldés előtti lekérdezés UTÁN dönt (H3, lásd a
      // try-blokkot): az 5. (bizonytalan kimenetű) beküldés bizonylatát is át
      // kell tudni venni.
      const previousAttempts = order.invoiceAttempts ?? 0

      // A kelt-dátum a SZÉKHELY szerinti naptári nap: UTC-ből képezve magyar idő
      // szerint 00:00–02:00 között az előző napra (adott esetben az előző
      // áfa-időszakra) állna ki a számla.
      const issueDate = deps.issueDate ?? budapestDateString()
      // A teljesítési dátum a FIZETÉS (hozzáférés-nyitás) budapesti napja, nem a
      // job futásáé: a 23:58-as fizetés éjféli számlája így sem csúszik át a
      // következő napra, hónapra vagy évre, és egy kiesés utáni újrafuttatás sem
      // viszi el a teljesítést. Olvasási hiba itt szándékosan dob (állapotírás
      // előtt vagyunk, a job újrapróbálja).
      const paidMoment = await (
        deps.resolvePaidMoment ??
        ((current: Order) => resolveOrderPaidMoment(deps.payload, current))
      )(order)
      let teljesitesDatum = issueDate
      if (!paidMoment) {
        orderLog.warn(
          'a fizetés napja nem található (nincs a rendeléshez kötött accessGrants-sor) — a teljesítési dátum a kiállítás napja; hónapfordulónál kézi ellenőrzés javasolt',
          { issueDate },
        )
      } else if (paidMoment.paidDate > issueDate) {
        orderLog.warn(
          'a fizetés napja későbbi a kiállítás napjánál (óraeltérés?) — a teljesítési dátum a kiállítás napja',
          { paidDate: paidMoment.paidDate, issueDate },
        )
      } else {
        teljesitesDatum = paidMoment.paidDate
      }
      const xml = buildInvoiceXml({
        agentKey: config.agentKey as string,
        orderNumber: order.orderNumber,
        invoicePrefix: config.invoicePrefix,
        issueDate,
        teljesitesDatum,
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
      const adoptExisting = async (
        szamlaszam: string,
        via: string,
      ): Promise<IssueInvoiceResult> => {
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

      /**
       * H4: a beküldés ELŐTTI lekérdezés hibája. A lekérdezés nem fogyaszt
       * beküldési kísérletet (F10), ezért a kísérlet-plafon itt nem fékez: a
       * fék a folyamatos hibasorozat hossza és a fizetés óta eltelt idő
       * (LOOKUP_FAILURE_ALERT_AFTER_MS, LOOKUP_FAILURE_ESCALATION_MS).
       *
       * Kimenet: `settled` → végleges 'failed', a hívó ezzel tér vissza;
       * `lastError` → a közös hibaág folytatja (újrapróbálható hibán pending +
       * THROW, véglegesen failed + warn), és ezt írja az invoiceLastError-ba:
       * újrapróbálható hibánál a hibasorozat kezdetét hordozó előtaggal.
       */
      const settleLookupFailure = async (
        error: SzamlazzApiError,
      ): Promise<{ settled: IssueInvoiceResult } | { lastError: string }> => {
        const nowMs = Date.now()
        const previous = parseLookupStreak(order.invoiceLastError, nowMs)
        // F11: a 71/152-es tény a hibasorozat alatt sem veszhet el.
        const duplicateKnown = previous.message?.startsWith(DUPLICATE_EXISTS_NOTE) ?? false
        const detail = duplicateKnown
          ? `${DUPLICATE_EXISTS_NOTE}; a lekérdezés hibája: ${error.message}`
          : error.message
        const streakStartedAtMs = previous.startedAtMs ?? nowMs
        const streakMs = nowMs - streakStartedAtMs
        const streakHours = Math.floor(streakMs / HOUR_MS)
        const clockStart = lookupFailureClockStart(paidMoment, order)
        const ageMs = clockStart === null ? null : nowMs - clockStart.atMs
        const ageHours = ageMs === null ? null : Math.floor(ageMs / HOUR_MS)
        const since = clockStart?.source === 'rendeles' ? 'a rendelés' : 'a fizetés'
        const context = {
          kind: error.kind,
          retryable: error.retryable,
          attempts: previousAttempts,
          agentErrorCodes: error.agentErrors.map((entry) => entry.code),
          error: error.message,
          lastError: order.invoiceLastError ?? null,
          lookupFailingSince: new Date(streakStartedAtMs).toISOString(),
          streakHours,
          hoursSinceClockStart: ageHours,
          clockStart: clockStart?.source ?? null,
        }
        // A kézi rendezés teendője: 71/152 után a bizonylat biztosan létezik,
        // egy korábbi (bizonytalan kimenetű) beküldés után létezhet; a kézi
        // újrakiállítás mindkét esetben dupla NAV-számla volna.
        const manualHint = duplicateKnown
          ? ` A Számlázz.hu szerint a számla MÁR LÉTEZIK (71/152): ne állítsd ki kézzel, hanem keresd meg a Számlázz.hu-fiókban a(z) ${order.orderNumber} külső azonosítójú bizonylatot.`
          : previousAttempts > 0
            ? ` Egy korábbi beküldés létrehozhatta a számlát, ezért kézi kiállítás előtt keresd meg a Számlázz.hu-fiókban a(z) ${order.orderNumber} külső azonosítójú bizonylatot.`
            : ' Beküldés még nem történt, a számlát kézzel kell kiállítani.'
        const stop = async (
          reason: string,
          alert: string,
        ): Promise<{ settled: IssueInvoiceResult }> => {
          orderLog.error(alert, context)
          await writeOrderInvoicingState(deps.payload, deps.orderId, {
            invoiceStatus: 'failed',
            invoiceLastError: reason,
          }).catch(() => undefined)
          return { settled: { outcome: 'failed', reason } }
        }

        if (!error.retryable) {
          if (previousAttempts === 0) {
            // Első kísérlet: beküldés még nem volt, bizonylat nem létezhet.
            return { lastError: error.message }
          }
          return stop(
            `${INVOICE_AUTOMATION_STOPPED}: a számla előtti bizonylat-lekérdezés végleges hibát adott (${error.message}).${manualHint}`,
            'RIASZTÁS: a számla előtti bizonylat-lekérdezés végleges hibát adott egy korábbi beküldés után, ezért a számla automatikus kiállítása leállt. A számla létezhet: kézi kiállítás előtt keresd meg a Számlázz.hu-fiókban a rendelésszámmal azonos külső azonosítójú bizonylatot.',
          )
        }

        const streakLongEnough = streakMs >= LOOKUP_FAILURE_ALERT_AFTER_MS
        if (streakLongEnough && ageMs !== null && ageMs > LOOKUP_FAILURE_ESCALATION_MS) {
          return stop(
            `${INVOICE_AUTOMATION_STOPPED}: a Számlázz.hu bizonylat-lekérdezése ${streakHours} órája folyamatosan sikertelen, ${since} óta ${ageHours} óra telt el (utolsó hiba: ${error.message}). ` +
              `Ellenőrizd a SZAMLAZZ_API_URL beállítást és a Számlázz.hu elérhetőségét.${manualHint}`,
            `RIASZTÁS: a számla előtti bizonylat-lekérdezés legalább 2 órája folyamatosan sikertelen, és ${since} óta több mint 24 óra telt el, ezért a számla automatikus kiállítása leállt. Ellenőrizd a SZAMLAZZ_API_URL beállítást és a Számlázz.hu elérhetőségét.`,
          )
        }

        // A kimerült plafonnál a lekérdezés hibája AZONNAL riaszt (az 5.
        // beküldés bizonylata létezhet), egyébként a legalább 2 órás sorozat.
        // Mindkettő rendelésenként fojtott, közös kulccsal.
        const capReached = previousAttempts >= MAX_INVOICE_ATTEMPTS
        if (
          (capReached || streakLongEnough) &&
          shouldEmitThrottledAlert(`invoice-lookup:${deps.orderId}`, LOOKUP_FAILURE_ESCALATION_MS)
        ) {
          orderLog.error(
            capReached
              ? 'RIASZTÁS: a számlakiállítás beküldései kimerültek, és a záró bizonylat-lekérdezés hibát adott. Az utolsó beküldés létrehozhatta a számlát: a rendszer tovább próbálkozik a lekérdezéssel, és ha megtalálja, átveszi; tartós hibánál az automatikus kiállítás leáll. Kézi kiállítás előtt keresd meg a Számlázz.hu-fiókban a rendelésszámmal azonos külső azonosítójú bizonylatot.'
              : `RIASZTÁS: a számla előtti bizonylat-lekérdezés legalább 2 órája folyamatosan sikertelen. Ha a hiba ${since} után 24 órával is fennáll, a számla automatikus kiállítása leáll. Ellenőrizd a SZAMLAZZ_API_URL beállítást és a Számlázz.hu elérhetőségét.`,
            context,
          )
        }
        return { lastError: withLookupStreakMarker(streakStartedAtMs, detail) }
      }

      /** Igaz, amíg a beküldés ELŐTTI lekérdezés fut (H4: csak ennek a hibája időkorlátos). */
      let lookupPhase = false
      try {
        // A12 + W7 + H3: MINDEN beküldés ELŐTT szamlaKulsoAzon-lekérdezés, az
        // első kísérletnél ÉS a kimerült plafonnál is. A paid job és a poll
        // resweep így nem POST-ol kétszer, ha a bizonylat már létezik, és az
        // 5. (bizonytalan kimenetű) beküldés bizonylata is átvehető. A
        // lekérdezés hibája szándékosan nem enged vak beküldést (a státusz
        // pending marad, a fék a hibasorozat-alapú időkorlát:
        // settleLookupFailure). A lekérdezés NEM fogyaszt kísérletet (F10).
        lookupPhase = true
        const found = await lookup(order.orderNumber, config)
        lookupPhase = false
        if (found) {
          return await adoptExisting(
            found.szamlaszam,
            previousAttempts >= MAX_INVOICE_ATTEMPTS
              ? 'plafon-utani lekerdezes'
              : previousAttempts > 0
                ? 'retry-elotti lekerdezes'
                : 'elso-kiserlet-elotti lekerdezes',
          )
        }

        // A14 + H3: a plafon a lekérdezés UTÁN dönt. Kimerült keretnél beküldés
        // nincs: üres találatnál az eredmény végleges 'failed' + RIASZTÁS (a
        // 'failed' végállapot, a resweep nem veszi fel újra). A lekérdezés
        // újrapróbálható hibája viszont a H4-időkorlátot követi (azonnali,
        // fojtott RIASZTÁS, majd ismétlés a korlátig), hogy az 5. beküldés
        // bizonylata a Számlázz.hu helyreállása után is átvehető legyen. A
        // hivatalos szabály a BEKÜLDÉST korlátozza, a lekérdezést nem.
        if (previousAttempts >= MAX_INVOICE_ATTEMPTS) {
          // Az 5. beküldés bizonytalan kimenete (pl. timeout) a hibaüzenetben
          // marad, és a bizonylat a fiókban később is megjelenhet: a szöveg a
          // kézi kiállítás ELŐTTI keresést kéri.
          const previousError = parseLookupStreak(order.invoiceLastError, Date.now()).message
          const reason =
            `${INVOICE_AUTOMATION_STOPPED}: a számlakiállítási kísérletek száma kimerült (${previousAttempts}/${MAX_INVOICE_ATTEMPTS}), és a záró lekérdezés sem talált bizonylatot. ` +
            `Az utolsó beküldés ennek ellenére létrehozhatta a számlát, ezért kézi kiállítás előtt keresd meg a Számlázz.hu-fiókban a(z) ${order.orderNumber} külső azonosítójú bizonylatot.` +
            (previousError ? ` A korábbi hiba: ${previousError}` : '')
          orderLog.error(
            'RIASZTÁS: a számlakiállítás beküldései kimerültek, és a záró lekérdezés sem talált bizonylatot. Emberi beavatkozás kell (Számlázz.hu-szabály: legfeljebb 5 beküldés); kézi kiállítás előtt keresd meg a Számlázz.hu-fiókban a rendelésszámmal azonos külső azonosítójú bizonylatot.',
            { attempts: previousAttempts, lastError: order.invoiceLastError ?? null },
          )
          await writeOrderInvoicingState(deps.payload, deps.orderId, {
            invoiceStatus: 'failed',
            invoiceLastError: reason,
          })
          return { outcome: 'failed', reason }
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
        // H4: a sikeres lekérdezés lezárta a lekérdezési hibasorozatot, az
        // előtag kikerül (az üzenet a beküldés eredményéig marad).
        const streakBeforePost = parseLookupStreak(latestBeforePost.invoiceLastError, Date.now())
        await writeOrderInvoicingState(deps.payload, deps.orderId, {
          invoiceStatus: 'pending',
          invoiceAttempts: attempts,
          // F8: a KIKÜLDÖTT teljesítési dátum már itt rögzül — ha a válasz
          // elveszik, a későbbi helyesbítő így is az eredeti dátumot ismétli
          // (B4/NAV-hónapszabály). Az adoptExisting szándékosan NEM írja felül:
          // ott egy KORÁBBI kísérlet dátuma az érvényes, amit ez az írás rögzített.
          invoiceCompletionDate: teljesitesDatum,
          ...(streakBeforePost.marked ? { invoiceLastError: streakBeforePost.message } : {}),
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
          invoiceCompletionDate: teljesitesDatum,
          invoiceLastError: null,
          ...(trustedPdfUrl ? { invoicePdfUrl: trustedPdfUrl } : {}),
        })
        orderLog.info('számla kiállítva', {
          invoiceNumber: result.szamlaszam,
          attempts,
          teljesitesDatum,
        })
        if (result.notificationError) {
          // 56: a bizonylat kiállt és a NAV-hoz is bejelentésre került, csak a
          // vevő nem kapta meg az értesítő levelet. A hibaüzenet szövegét nem
          // naplózzuk (a vevő e-mail-címét tartalmazhatja).
          orderLog.error(
            'RIASZTÁS: a számla kiállt, de a számlaértesítő e-mail NEM ment ki a vevőnek (56-os kód) — küldd ki kézzel a Számlázz.hu-fiókból',
            { invoiceNumber: result.szamlaszam, agentErrorCode: result.notificationError.code },
          )
        }
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
            const combined = `${DUPLICATE_EXISTS_NOTE}; a lekérdezés hibája: ${detail}`
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
        // H4: a beküldés ELŐTTI lekérdezés hibája (ebben a futásban POST nem
        // ment ki). Időkorlát és riasztás a settleLookupFailure-ben; ha nem
        // végleges, a hibasorozat kezdete az invoiceLastError előtagjában
        // marad meg.
        let lastErrorToWrite: string | null = null
        if (lookupPhase && error instanceof SzamlazzApiError) {
          const settled = await settleLookupFailure(error)
          if ('settled' in settled) {
            return settled.settled
          }
          lastErrorToWrite = settled.lastError
        }
        const message = error instanceof Error ? error.message : String(error)
        // F4: újrapróbálható hibán a státusz PENDING marad — az order-poll resweep
        // csak a ['none','pending'] rendeléseket veszi fel újra, 'failed' esetén a
        // job-retryk kimerülése után a számla örökre elveszne. Végleges hibán
        // (és csak ott) 'failed'.
        const retryable = error instanceof SzamlazzApiError && error.retryable
        await writeOrderInvoicingState(deps.payload, deps.orderId, {
          invoiceStatus: retryable ? 'pending' : 'failed',
          invoiceLastError: lastErrorToWrite ?? message,
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
