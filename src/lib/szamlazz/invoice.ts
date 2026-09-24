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
import { queryInvoiceData } from './invoice-data'
import { isTrustedInvoicePdfUrl } from './invoice-url'
import { invoiceKulsoAzon, invoiceLookupKeys } from './kulso-azon'
import { createLockBudget } from './lock-budget'
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
 * - <fizetve>true</fizetve>: a számla egy MÁR KIFIZETETT (Barion, online)
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
 * - szamlaKulsoAzon: a bizonylat VISSZAKERESÉSI kulcsa, GLOBÁLISAN EGYEDI alakban
 *   (kulso-azon.ts: rendelésszám + rendelés-id + létrehozási pillanat; a
 *   helyesbítőé ehhez a refund-sorszámot fűzi). A Számlázz.hu a külső
 *   azonosító egyediségét NEM kényszeríti ki, azonos kulcsra a legújabb
 *   birtokost adja vissza, tehát a kulcs önmagában nem duplikátum-védelem. A
 *   SZÁMLA duplikátum-védelme a <rendelesSzam> + a fiókban bekapcsolt
 *   rendelésszám-ismétlés-tiltás (71/152); a HELYESBÍTŐ és a stornó a
 *   hivatalos rendelésszám-oldal szerint KIVÉTEL ez alól („A sztornó és a
 *   helyesbítő számla kivétel az ellenőrzés alól"), ott a beküldés előtti
 *   lekérdezés és az advisory-zár az egyetlen védvonal. A külső azonosító
 *   ahhoz kell, hogy kétes esetben (elveszett válasz) a bizonylat
 *   visszakereshető legyen: utólag már nem pótolható.
 * - <vevo><orszag>: mindig 'Magyarország' (K11: egyelőre csak magyar
 *   számlázási cím fogadható el, a pénztár ezt kényszeríti ki). Az élő XSD
 *   szerint a <nev> után áll (minOccurs 0, szöveges érték, a WooCommerce-
 *   bővítmény is az ország nevét küldi).
 * - Fejléc-megjegyzés: rendelésszám és a semleges fizetési mód
 *   („Barion, online fizetés"; a Barion-egyenlegből is lehet fizetni, tehát a
 *   „bankkártya" nem mindig igaz). AAM módban a megjegyzés a jogszabályi
 *   utalást is hordozza (Áfa tv. 169. § m): „Alanyi adómentes (Áfa tv. XIII.
 *   fejezet)." — a tételsor AAM-címkéje mellett ez ártalmatlan, egyértelmű
 *   hivatkozás, és nem mond ellent neki.
 * - A <vevo><azonosito> mezőt SOHA nem küldjük (a Számlázz.hu-dokumentáció
 *   figyelmeztet: más vevőhöz rögzített azonosító adatfrissítést/biztonsági
 *   problémát okozna).
 * - HELYESBÍTŐ (módosító) számla: ugyanez a művelet, `corrective` megadásával —
 *   ilyenkor <helyesbitoszamla>true</helyesbitoszamla>, a
 *   <helyesbitettSzamlaszam> az eredeti számla száma, a tételek negatív
 *   korrekciót hordoznak, a külső azonosító a helyesbítő saját, egyedi
 *   kulsoAzon-ja, a <rendelesSzam> pedig a rövid
 *   `<rendelésszám>-HELYESBITO-<seq>` (lásd corrective.ts — részleges
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
   * A helyesbítő saját, globálisan egyedi azonosítója (kulso-azon.ts): a
   * <szamlaKulsoAzon> (visszakeresési kulcs). A helyesbítő a hivatalos
   * rendelésszám-oldal szerint kivétel a rendelésszám-ismétlés-tiltás alól,
   * tehát a 71/152 itt NEM véd: a duplikátum ellen a beküldés előtti
   * lekérdezés és az advisory-zár véd.
   */
  kulsoAzon: string
  /**
   * A helyesbítő <rendelesSzam>-ja. A kiállító a rövid
   * `<rendelésszám>-HELYESBITO-<seq>` alakot adja: a fiókban a számlától
   * külön sorként, a rendelésszámmal kereshető, és nem ütközik a NAV-export
   * mezőhossz-korlátjába. Elhagyva a kulsoAzon megy ki.
   */
  rendelesSzam?: string
}

export interface BuildInvoiceXmlInput {
  agentKey: string
  orderNumber: string
  /**
   * A számla globálisan egyedi külső azonosítója (<szamlaKulsoAzon>,
   * kulso-azon.ts). Elhagyva a rendelésszám megy ki (a PR #304-es, régi,
   * újrahasznosítható alak): az éles kiállító (issueInvoiceForOrder) MINDIG
   * az egyedi kulcsot adja. Helyesbítőnél a `corrective.kulsoAzon` dönt. A
   * <rendelesSzam> számlán a puszta rendelésszám marad.
   */
  kulsoAzon?: string
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
  /** Helyesbítő számla esetén az eredeti számla hivatkozása. */
  corrective?: CorrectiveInvoiceRef
  /**
   * A fejléc-megjegyzés felülírása (alapból a rendelésre utaló szöveg). AAM
   * módban az adómentességi utalás ehhez is hozzáfűződik.
   */
  megjegyzes?: string
}

/** Az AAM-számla fejléc-megjegyzésének jogszabályi utalása (Áfa tv. 169. § m). */
export const AAM_MEGJEGYZES = 'Alanyi adómentes (Áfa tv. XIII. fejezet).'

/** A vevő országa a számlán (K11: egyelőre csak magyar számlázási cím). */
export const VEVO_ORSZAG = 'Magyarország'

/** Az alapértelmezett fejléc-megjegyzés: rendelésszám + semleges fizetési mód. */
export function defaultInvoiceMegjegyzes(orderNumber: string): string {
  return `Kineticare online kurzus, rendelésszám: ${orderNumber} (Barion, online fizetés).`
}

/** A megjegyzés AAM módban az adómentességi utalással (egyszer, ismétlés nélkül). */
function withVatNote(megjegyzes: string, vatMode: SzamlazzVatMode): string {
  if (vatMode !== 'AAM' || megjegyzes.includes(AAM_MEGJEGYZES)) {
    return megjegyzes
  }
  const base = megjegyzes.trim()
  return base ? `${base} ${AAM_MEGJEGYZES}` : AAM_MEGJEGYZES
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
  const megjegyzes = withVatNote(
    input.megjegyzes ?? defaultInvoiceMegjegyzes(input.orderNumber),
    vatMode,
  )
  const kulsoAzon = corrective ? corrective.kulsoAzon : (input.kulsoAzon ?? input.orderNumber)
  // A SZÁMLA <rendelesSzam>-ja a puszta rendelésszám: a fiókban bekapcsolt
  // rendelésszám-ismétlés-tiltás (71/152) erre épül. A helyesbítő a hivatalos
  // rendelésszám-oldal szerint KIVÉTEL a tiltás alól, tehát ott a 71/152 nem
  // véd; a helyesbítő saját, rövid rendelésszámot kap, hogy a fiókban a számla
  // mellett külön sorként legyen kereshető.
  const rendelesSzam = corrective ? (corrective.rendelesSzam ?? kulsoAzon) : input.orderNumber

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
    <orszag>${esc(VEVO_ORSZAG)}</orszag>
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
 * A lekérdezések GYAKORISÁGÁNAK fékje egy hibasorozat alatt (a-szamlazz-15).
 * A hivatalos hibakezelési oldal szerint a rendszer ne küldje újra és újra
 * automatikusan a sikertelen kéréseket; a resweep viszont 10–15 percenként
 * újra sorba állítja a pending számlát, és a job maga is háromszor
 * újrapróbál. Ezért:
 * - az első LOOKUP_BURST_FAILURES sikertelen lekérdezés a szokásos ütemben
 *   ismétlődhet (egy pillanatnyi kiesés után a számla gyorsan kiálljon);
 * - utána két lekérdezés között legalább LOOKUP_MIN_INTERVAL_MS telik el
 *   (a közbeeső futások hálózati hívás nélkül 'skipped'-del zárnak), ami
 *   rendelésenként nagyjából napi 24 lekérdezés;
 * - a MAX_LOOKUP_FAILURES-edik sikertelen lekérdezés után a számla
 *   automatikus kiállítása leáll ('failed' + RIASZTÁS), a H4-időkorláttól
 *   függetlenül.
 */
export const LOOKUP_BURST_FAILURES = 3
export const LOOKUP_MIN_INTERVAL_MS = HOUR_MS
export const MAX_LOOKUP_FAILURES = 24

/**
 * A hibasorozat PERZISZTENS, migráció nélkül: az invoiceLastError elején álló,
 * géppel is olvasható előtag, pl.
 * `[lekérdezési hiba 2026-09-24T10:00:00.000Z óta, 3 sikertelen lekérdezés, utolsó: 2026-09-24T10:20:00.000Z] <az utolsó hiba>`.
 * Így egy újraindulás vagy deploy sem indítja újra a sorozatot. A régi,
 * számláló nélküli alak (`[lekérdezési hiba <időpont> óta] …`) is olvasható:
 * egy sikertelen lekérdezésnek számít, amely a sorozat kezdetén történt. A
 * mezőt kizárólag ez a modul írja, és az `invoice:<orderId>` advisory-zár alatt
 * olvassa és írja, tehát egy párhuzamos job sem írhatja közben felül. A
 * sikeres lekérdezés utáni első állapotírás (átvétel, plafon-döntés vagy a
 * beküldés előtti pending-írás) az előtagot törli.
 */
const ISO_INSTANT = '(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z)'
const LOOKUP_STREAK_MARKER = new RegExp(
  `^\\[lekérdezési hiba ${ISO_INSTANT} óta(?:, (\\d+) sikertelen lekérdezés, utolsó: ${ISO_INSTANT})?\\] `,
)

function withLookupStreakMarker(
  startedAtMs: number,
  failures: number,
  lastFailureAtMs: number,
  message: string,
): string {
  return `[lekérdezési hiba ${new Date(startedAtMs).toISOString()} óta, ${failures} sikertelen lekérdezés, utolsó: ${new Date(lastFailureAtMs).toISOString()}] ${message}`
}

interface ParsedLookupStreak {
  /** Volt-e előtag (érvényes vagy sem). */
  marked: boolean
  /** A sorozat kezdete; null, ha nincs előtag, vagy a kezdet értelmezhetetlen vagy jövőbeli. */
  startedAtMs: number | null
  /** A sorozat eddigi sikertelen lekérdezéseinek száma (előtag nélkül 0). */
  failures: number
  /** Az utolsó sikertelen lekérdezés pillanata; null, ha nem ismert vagy jövőbeli. */
  lastFailureAtMs: number | null
  /** Az előtag nélküli hibaüzenet (null, ha a mező üres). */
  message: string | null
}

function parseLookupStreak(
  lastError: string | null | undefined,
  nowMs: number,
): ParsedLookupStreak {
  if (!lastError) {
    return { marked: false, startedAtMs: null, failures: 0, lastFailureAtMs: null, message: null }
  }
  const match = LOOKUP_STREAK_MARKER.exec(lastError)
  if (!match) {
    return {
      marked: false,
      startedAtMs: null,
      failures: 0,
      lastFailureAtMs: null,
      message: lastError,
    }
  }
  // Óraeltérésből eredő jövőbeli időpont érvénytelen: a sorozat újraindul.
  const validInstant = (raw: string | undefined): number | null => {
    const parsed = Date.parse(raw ?? '')
    return Number.isFinite(parsed) && parsed <= nowMs ? parsed : null
  }
  const startedAtMs = validInstant(match[1])
  const counted = match[2] === undefined ? 1 : Number.parseInt(match[2], 10)
  return {
    marked: true,
    startedAtMs,
    failures: startedAtMs === null ? 0 : Number.isSafeInteger(counted) && counted > 0 ? counted : 1,
    lastFailureAtMs: startedAtMs === null ? null : (validInstant(match[3]) ?? startedAtMs),
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
 * kimerült plafon, idegen bizonylat, visszatérítés a számla előtt). Egy ilyen
 * rendelésen egy még sorban álló (pl. a resweep által duplán sorba állított)
 * job sem kérdez le és nem küld be: a RIASZTÁS kézi rendezést kért, és egy
 * közben lefutó automatikus beküldés a kézzel kiállított mellé dupla
 * NAV-számlát tenne.
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

/**
 * A rendelés számlájának várt bruttó végösszege (HUF) az átvétel előtti
 * egyeztetéshez (a-szamlazz-5): a rendelés végösszeg-pillanatképe
 * (totalHufSnapshot, a tétel-snapshotok ár × mennyiség összege,
 * order-integrity.ts), ennek hiányában a kiküldendő tételek bruttó összege.
 */
export function expectedInvoiceBruttoHuf(
  order: Order,
  items: InvoiceItemInput[] | null,
): number | null {
  if (typeof order.totalHufSnapshot === 'number' && Number.isFinite(order.totalHufSnapshot)) {
    return order.totalHufSnapshot
  }
  if (!items) {
    return null
  }
  return items.reduce(
    (sum, item) => sum + Math.round(Math.abs(item.bruttoEgysegar)) * item.mennyiseg,
    0,
  )
}

/** Vevőnév-összevetés: kis- és nagybetű, valamint szóköz-eltérés nem számít. */
function normalizeBuyerName(value: string): string {
  return value.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('hu')
}

/** Sikeres (pénzt ténylegesen visszautaló) visszatérítés-bejegyzés-e a refunds-nyomban. */
function isSettledRefundEntry(entry: unknown): boolean {
  if (typeof entry !== 'object' || entry === null) {
    return false
  }
  const record = entry as Record<string, unknown>
  return (
    typeof record.amountHuf === 'number' &&
    record.amountHuf > 0 &&
    typeof record.status === 'string' &&
    ['Succeeded', 'Refunded', 'PartiallyRefunded'].includes(record.status)
  )
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
   * hibasorozat-alapú időkorlát és a gyakoriság-fék fékezi
   * (LOOKUP_FAILURE_ALERT_AFTER_MS, LOOKUP_FAILURE_ESCALATION_MS,
   * LOOKUP_MIN_INTERVAL_MS, MAX_LOOKUP_FAILURES).
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
 * - hiányzó vevő-/tételadat → invoiceStatus 'failed' + 'failed' + RIASZTÁS
 *   (NEM dob, a job nem újrapróbálja — emberi adatpótlás kell);
 * - retryable provider/timeout-hiba → invoiceStatus MARAD 'pending' (a hibát
 *   az invoiceLastError hordozza) + THROW. A 'pending' azért kötelező, mert az
 *   order-poll resweep csak a ['none','pending'] rendeléseket veszi fel újra
 *   (src/lib/order-poll/service.ts) — 'failed' esetén a job-retryk kimerülése
 *   után a számla ÖRÖKRE elveszne. A valódi fék a perzisztens 5-ös plafon (F4),
 *   a beküldés előtti lekérdezés hibáira pedig az időkorlát (H4) és a
 *   gyakoriság-fék: ha a lekérdezés legalább 2 órája folyamatosan hibás, és a
 *   fizetés óta több mint 24 óra telt el, vagy a sorozat elérte a
 *   MAX_LOOKUP_FAILURES-t, a számla 'failed' + RIASZTÁS, dobás nélkül;
 * - VÉGLEGES agent-hiba (pl. 3, 54, 57, 202) → 'failed' + RIASZTÁS a
 *   hibakóddal (a job nem dob, nincs újrapróbálás; a fiók rendbetétele után
 *   egy kézzel sorba állított invoice-issue job a plafonig újrapróbálhatja);
 * - a lekérdezés bizonylatot talál → CSAK egyező bruttó végösszegnél (és a
 *   régi kulcson talált bizonylatnál egyező vevőnévnél, élő, nem sztornózott
 *   állapotban) vesszük át; eltérésnél 'failed' + RIASZTÁS, beküldés NÉLKÜL
 *   (idegen bizonylat, a-szamlazz-5);
 * - kimerült plafon (H3) → előbb lekérdezés: találatnál a meglévő számla
 *   átvétele, üres találatnál 'failed' + RIASZTÁS, beküldés NÉLKÜL; a
 *   lekérdezés újrapróbálható hibájánál azonnali (fojtott) RIASZTÁS, és a
 *   lekérdezés a H4-időkorlátig ismétlődik (az 5. beküldés bizonylata így
 *   a Számlázz.hu helyreállása után is átvehető);
 * - VISSZATÉRÍTETT (refunded), még számla nélküli rendelés (a-egyeztetes-13,
 *   K12): ha volt már beküldés, a lekérdezés a státusz-kapu ELŐTT fut, és a
 *   talált (egyeztetett) számla átvétele után az inline stornó is lefut; ha
 *   nincs bizonylat, vagy beküldés sem volt, a rendszer NEM állít ki új
 *   számlát + stornót (a könyvelő döntéséig), hanem 'failed' + RIASZTÁS;
 * - kézi rendezésre váró végleges leállás (INVOICE_AUTOMATION_STOPPED) →
 *   'skipped', lekérdezés és beküldés NÉLKÜL (egy még sorban álló job sem
 *   küldhet be a kézi kiállítás mellé).
 *
 * A paid/issue szakasz `invoice:<orderId>` advisory-zár alatt fut (W7):
 * a paid-átmenet jobja és a poll resweep ne POST-oljon egyszerre. A
 * Számlázz.hu HTTP a záron belül van (a refund mintája), a hívások közös
 * időkerettel (lock-budget.ts): a beküldés csak akkor indul, ha a teljes
 * timeoutja a zár-tranzakció tétlenségi korlátja előtt lezárul. Barion-hívás
 * NINCS ebben a zárban. Mockolt Payload (nincs drizzle) nem-productionben a zár
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
      // A zár alatti Számlázz.hu-hívások közös időkerete a zár megszerzésétől.
      const budget = createLockBudget(config)
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
       * Védelem mélységében: ÚJ számla KIZÁRÓLAG paid rendeléshez állítható ki.
       * A sorbaállítás ma csak a paid-átmenetből (és a paid-rendeléseket
       * pásztázó resweepből) történik, de a szolgáltatás a FRISSEN olvasott
       * rendelésen is kikényszeríti. Egyetlen kivétel a VISSZATÉRÍTETT rendelés
       * (a-egyeztetes-13): egy korábbi, elveszett válaszú beküldés számlája ott
       * is létezhet, ezért azt a lekérdezés átveszi és sztornózza (lent).
       */
      const refunded = order.status === 'refunded'
      if (order.status !== 'paid' && !refunded) {
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
      const orderNumber = order.orderNumber

      // A14: perzisztens kísérlet-plafon — a Számlázz.hu felé ugyanaz a kérés
      // legfeljebb ötször mehet ki, utána emberi beavatkozás kell. A plafon
      // SZÁNDÉKOSAN csak a beküldés előtti lekérdezés UTÁN dönt (H3, lásd a
      // try-blokkot): az 5. (bizonytalan kimenetű) beküldés bizonylatát is át
      // kell tudni venni.
      const previousAttempts = order.invoiceAttempts ?? 0

      /**
       * K12 (könyvelői döntésig): visszatérített, számla nélküli rendelésre a
       * rendszer NEM állít ki utólag számlát + stornót. A leállás végleges
       * (INVOICE_AUTOMATION_STOPPED), a RIASZTÁS a kézi egyeztetést kéri.
       */
      const stopRefundedWithoutInvoice = async (detail: string): Promise<IssueInvoiceResult> => {
        const reason =
          `${INVOICE_AUTOMATION_STOPPED}: a rendelést a számla kiállítása előtt visszatérítették, és ${detail}. ` +
          'A rendszer nem állít ki utólag számlát és stornót (könyvelői döntésig, K12): egyeztesd a könyvelővel, kell-e bizonylat.'
        orderLog.error(
          'RIASZTÁS: a rendelést a számla kiállítása előtt visszatérítették, és számla nem készült. A rendszer nem állít ki utólag számlát és stornót (K12): egyeztesd a könyvelővel.',
          { orderNumber, attempts: previousAttempts, detail },
        )
        await writeOrderInvoicingState(deps.payload, deps.orderId, {
          invoiceStatus: 'failed',
          invoiceLastError: reason,
        })
        return { outcome: 'failed', reason }
      }

      if (refunded && previousAttempts === 0) {
        // Beküldés sosem volt: a mi külső azonosítónkon bizonylat nem
        // létezhet, a lekérdezés felesleges volna.
        return stopRefundedWithoutInvoice('korábbi beküldés sem történt')
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
      // A bizonylat globálisan egyedi külső azonosítója (a-szamlazz-5,
      // r-szamlazz-11); a <rendelesSzam> ettől függetlenül a puszta rendelésszám.
      const kulsoAzon = invoiceKulsoAzon(orderNumber, order)
      const xml = buildInvoiceXml({
        agentKey: config.agentKey as string,
        orderNumber,
        kulsoAzon,
        invoicePrefix: config.invoicePrefix,
        issueDate,
        teljesitesDatum,
        buyer,
        items,
        vatMode: config.vatMode,
      })
      // Visszafelé kompatibilitás: a PR #304 a rendelésszámot küldte külső
      // azonosítóként. Korábbi beküldés után a régi alakon is keresünk; egy
      // sosem beküldött rendelésnél a régi kulcson talált bizonylat csak
      // idegen lehetne, ezért ott nem keresünk.
      const lookupKeys = invoiceLookupKeys(orderNumber, order, previousAttempts > 0)
      const expectedBrutto = expectedInvoiceBruttoHuf(order, items)

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

      interface LookupHit {
        found: InvoiceLookupResult
        key: string
        legacy: boolean
      }
      /** A bizonylat keresése a kulcsokon, sorrendben; az első találat dönt. */
      const findExisting = async (): Promise<LookupHit | null> => {
        for (const [index, key] of lookupKeys.entries()) {
          const found = await lookup(key, budget.forQuery())
          if (found) {
            return { found, key, legacy: index > 0 }
          }
        }
        return null
      }
      /**
       * Az átvétel előtti egyeztetés (a-szamlazz-5): a talált bizonylat
       * ehhez a rendeléshez tartozik-e. Visszatérés: null, ha igen; különben
       * az eltérés oka. A PDF-lekérdezés válasza vevőnevet nem hordoz, csak a
       * bruttó végösszeget; a RÉGI kulcson talált bizonylatnál ezért a
       * számlaadat-lekérdezés a vevőnevet és a sztornózottságot is adja (a
       * vevő-blokk a partnertörzs élő adata, de a partnert a Számlázz.hu a
       * névvel azonosítja, tehát a név összevethető). A lekérdezés hibája
       * dob (a hívó bizonytalan állapotban nem vesz át és nem küld be).
       */
      const mismatchOf = async (hit: LookupHit): Promise<string | null> => {
        const brutto = hit.found.szamlabrutto
        if (brutto === undefined) {
          return 'a lekérdezés válasza nem hordoz bruttó végösszeget (szamlabrutto), így a bizonylat nem egyeztethető'
        }
        if (expectedBrutto === null || brutto !== expectedBrutto) {
          return `a bizonylat bruttó végösszege ${brutto} Ft, a rendelésé ${expectedBrutto ?? 'ismeretlen'} Ft`
        }
        if (!hit.legacy) {
          return null
        }
        const data = await queryInvoiceData(hit.found.szamlaszam, budget.forQuery())
        if (data.szamlaszam !== hit.found.szamlaszam) {
          return `a számlaadat-lekérdezés más bizonylatot adott vissza (${data.szamlaszam})`
        }
        if (data.sztornozott) {
          return 'a régi (rendelésszám-alapú) kulcson talált bizonylat már sztornózott'
        }
        if (!data.vevoNev) {
          return 'a régi (rendelésszám-alapú) kulcson talált bizonylat vevőneve nem olvasható, így nem egyeztethető'
        }
        if (normalizeBuyerName(data.vevoNev) !== normalizeBuyerName(buyer.nev)) {
          return 'a régi (rendelésszám-alapú) kulcson talált bizonylat vevőneve eltér a rendelésétől'
        }
        return null
      }
      /** Idegen (vagy nem egyeztethető) bizonylat: nem vesszük át, és nem küldünk be. */
      const refuseForeign = async (
        hit: LookupHit,
        mismatch: string,
        via: string,
      ): Promise<IssueInvoiceResult> => {
        const reason =
          `${INVOICE_AUTOMATION_STOPPED}: a(z) ${hit.key} külső azonosítón talált ${hit.found.szamlaszam} számú bizonylat nem egyeztethető ezzel a rendeléssel (${mismatch}). ` +
          'A rendszer nem veszi át, és új számlát sem küld be: ellenőrizd a Számlázz.hu-fiókban, és szükség esetén állítsd ki kézzel.'
        orderLog.error(
          'RIASZTÁS: a bizonylat-lekérdezés olyan bizonylatot talált, amely nem egyeztethető ezzel a rendeléssel (idegen vagy sztornózott bizonylat lehet) — a számla automatikus kiállítása leállt, kézi ellenőrzés kell.',
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
        await writeOrderInvoicingState(deps.payload, deps.orderId, {
          invoiceStatus: 'failed',
          invoiceLastError: reason,
        })
        return { outcome: 'failed', reason }
      }
      /**
       * A számla rögzítése UTÁN újraolvasunk, és a közben (vagy korábban)
       * történt visszatérítésekhez igazítjuk a bizonylatokat:
       * - W7: ha a rendelés refunded lett (üres invoiceNumberrel), inline
       *   stornó. A stornó hibája NEM billenti a számla-kimenetet failed-re.
       * - a-szamlazz-12: ha a számla előtt RÉSZLEGES visszatérítés történt, a
       *   teljes összegű számla mellé helyesbítő kell; ezt a refund-
       *   helyreállítás állítja ki, a számla oldaláról RIASZTÁS jelzi.
       */
      const reconcileRefundsAfterIssue = async (invoiceNumber: string): Promise<void> => {
        const latest = await rereadOrder()
        if (!latest) {
          return
        }
        const recordedInvoice = latest.invoiceNumber?.trim() || invoiceNumber
        if (latest.status === 'paid') {
          const refunds: unknown[] = Array.isArray(latest.refunds) ? latest.refunds : []
          const partial = refunds.filter(isSettledRefundEntry)
          if (partial.length > 0) {
            orderLog.error(
              'RIASZTÁS: a számla kiállt, de a rendelésen a számla ELŐTT részleges visszatérítés történt — a visszatérített összegről helyesbítő számla kell (a rendelés visszatérítési helyreállításával)',
              { orderNumber, invoiceNumber: recordedInvoice, refundEntries: partial.length },
            )
          }
          return
        }
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
            reason: 'a számla a visszatérítés után állt ki, automatikus stornó',
          })
          if (stornoResult.outcome === 'failed') {
            orderLog.error(
              'RIASZTÁS: a számla kiállt, de a rendelés közben refunded lett, és a stornó nem készült el',
              { orderNumber, invoiceNumber: recordedInvoice, reason: stornoResult.reason ?? null },
            )
          }
        } catch (stornoError) {
          const message = stornoError instanceof Error ? stornoError.message : String(stornoError)
          orderLog.error(
            'RIASZTÁS: a számla kiállt, de a rendelés közben refunded lett, és a stornó hibával állt le',
            { orderNumber, invoiceNumber: recordedInvoice, error: message },
          )
        }
      }
      /** A meglévő bizonylat átvétele (lekérdezés-találat vagy 71/152-feloldás). */
      const adoptExisting = async (hit: LookupHit, via: string): Promise<IssueInvoiceResult> => {
        const szamlaszam = hit.found.szamlaszam
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
          kulsoAzon: hit.key,
          legacyKey: hit.legacy,
          via,
          attempts,
        })
        await reconcileRefundsAfterIssue(szamlaszam)
        return { outcome: 'issued', invoiceNumber: szamlaszam }
      }

      /**
       * H4: a beküldés ELŐTTI lekérdezés hibája. A lekérdezés nem fogyaszt
       * beküldési kísérletet (F10), ezért a kísérlet-plafon itt nem fékez: a
       * fék a folyamatos hibasorozat hossza, a fizetés óta eltelt idő és a
       * sorozat sikertelen lekérdezéseinek száma (LOOKUP_FAILURE_ALERT_AFTER_MS,
       * LOOKUP_FAILURE_ESCALATION_MS, MAX_LOOKUP_FAILURES).
       *
       * Kimenet: `settled` → végleges 'failed', a hívó ezzel tér vissza;
       * `lastError` → a közös hibaág folytatja (újrapróbálható hibán pending +
       * THROW, véglegesen failed + RIASZTÁS), és ezt írja az invoiceLastError-ba:
       * újrapróbálható hibánál a hibasorozatot hordozó előtaggal.
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
        const failures = previous.failures + 1
        const streakMs = nowMs - streakStartedAtMs
        const streakHours = Math.floor(streakMs / HOUR_MS)
        const clockStart = lookupFailureClockStart(paidMoment, order)
        const ageMs = clockStart === null ? null : nowMs - clockStart.atMs
        const ageHours = ageMs === null ? null : Math.floor(ageMs / HOUR_MS)
        const since = clockStart?.source === 'rendeles' ? 'a rendelés' : 'a fizetés'
        const context = {
          orderNumber,
          kind: error.kind,
          retryable: error.retryable,
          attempts: previousAttempts,
          agentErrorCodes: error.agentErrors.map((entry) => entry.code),
          error: error.message,
          lastError: order.invoiceLastError ?? null,
          lookupFailingSince: new Date(streakStartedAtMs).toISOString(),
          lookupFailures: failures,
          streakHours,
          hoursSinceClockStart: ageHours,
          clockStart: clockStart?.source ?? null,
          refunded,
        }
        // A kézi rendezés teendője: 71/152 után a bizonylat biztosan létezik,
        // egy korábbi (bizonytalan kimenetű) beküldés után létezhet; a kézi
        // újrakiállítás mindkét esetben dupla NAV-számla volna.
        const manualHint = duplicateKnown
          ? ` A Számlázz.hu szerint a számla MÁR LÉTEZIK (71/152): ne állítsd ki kézzel, hanem keresd meg a Számlázz.hu-fiókban a(z) ${orderNumber} rendelésszámú bizonylatot.`
          : previousAttempts > 0
            ? ` Egy korábbi beküldés létrehozhatta a számlát, ezért kézi kiállítás előtt keresd meg a Számlázz.hu-fiókban a(z) ${orderNumber} rendelésszámú bizonylatot.`
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
            'RIASZTÁS: a számla előtti bizonylat-lekérdezés végleges hibát adott egy korábbi beküldés után, ezért a számla automatikus kiállítása leállt. A számla létezhet: kézi kiállítás előtt keresd meg a Számlázz.hu-fiókban a rendelésszámmal azonos rendelésszámú bizonylatot.',
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

        if (failures >= MAX_LOOKUP_FAILURES) {
          return stop(
            `${INVOICE_AUTOMATION_STOPPED}: a Számlázz.hu bizonylat-lekérdezése ${failures} alkalommal egymás után sikertelen volt (utolsó hiba: ${error.message}). ` +
              `Ellenőrizd a SZAMLAZZ_API_URL beállítást és a Számlázz.hu elérhetőségét.${manualHint}`,
            `RIASZTÁS: a számla előtti bizonylat-lekérdezés ${MAX_LOOKUP_FAILURES} alkalommal egymás után sikertelen volt, ezért a számla automatikus kiállítása leállt (a rendszer nem ismétli tovább a kérést). Ellenőrizd a SZAMLAZZ_API_URL beállítást és a Számlázz.hu elérhetőségét.`,
          )
        }

        // A kimerült plafonnál és a visszatérített rendelésnél a lekérdezés
        // hibája AZONNAL riaszt (a bizonylat létezhet, és a visszatérített
        // rendelést a resweep nem veszi fel újra), egyébként a legalább 2 órás
        // sorozat. Mindkettő rendelésenként fojtott, közös kulccsal.
        const capReached = previousAttempts >= MAX_INVOICE_ATTEMPTS
        if (
          (capReached || refunded || streakLongEnough) &&
          shouldEmitThrottledAlert(`invoice-lookup:${deps.orderId}`, LOOKUP_FAILURE_ESCALATION_MS)
        ) {
          orderLog.error(
            refunded
              ? 'RIASZTÁS: a visszatérített rendelés korábbi számla-beküldésének ellenőrzése (bizonylat-lekérdezés) hibát adott. A számla létezhet, és akkor sztornózni kell: a rendszer a job újrapróbálásaival még keresi, utána kézi ellenőrzés kell a Számlázz.hu-fiókban.'
              : capReached
                ? 'RIASZTÁS: a számlakiállítás beküldései kimerültek, és a záró bizonylat-lekérdezés hibát adott. Az utolsó beküldés létrehozhatta a számlát: a rendszer tovább próbálkozik a lekérdezéssel, és ha megtalálja, átveszi; tartós hibánál az automatikus kiállítás leáll. Kézi kiállítás előtt keresd meg a Számlázz.hu-fiókban a rendelésszámmal azonos rendelésszámú bizonylatot.'
                : `RIASZTÁS: a számla előtti bizonylat-lekérdezés legalább 2 órája folyamatosan sikertelen. Ha a hiba ${since} után 24 órával is fennáll, a számla automatikus kiállítása leáll. Ellenőrizd a SZAMLAZZ_API_URL beállítást és a Számlázz.hu elérhetőségét.`,
            context,
          )
        }
        return { lastError: withLookupStreakMarker(streakStartedAtMs, failures, nowMs, detail) }
      }

      // Gyakoriság-fék (a-szamlazz-15): egy hibasorozat első néhány lekérdezése
      // után két lekérdezés között legalább LOOKUP_MIN_INTERVAL_MS telik el. A
      // közbeeső futás hálózati hívás és állapotírás nélkül zár; a pending
      // státusz marad, a resweep később újra sorba állítja.
      const streakNow = parseLookupStreak(order.invoiceLastError, Date.now())
      if (
        streakNow.marked &&
        streakNow.failures >= LOOKUP_BURST_FAILURES &&
        streakNow.lastFailureAtMs !== null &&
        Date.now() - streakNow.lastFailureAtMs < LOOKUP_MIN_INTERVAL_MS
      ) {
        const nextAt = new Date(streakNow.lastFailureAtMs + LOOKUP_MIN_INTERVAL_MS).toISOString()
        orderLog.info('a bizonylat-lekérdezés a hibasorozat miatt szünetel — kihagyva', {
          lookupFailures: streakNow.failures,
          nextLookupAt: nextAt,
        })
        return {
          outcome: 'skipped',
          reason: `a bizonylat-lekérdezés a hibasorozat miatt szünetel (következő: ${nextAt})`,
        }
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
        // A talált bizonylatot csak egyeztetés után vesszük át (a-szamlazz-5).
        lookupPhase = true
        const hit = await findExisting()
        const mismatch = hit ? await mismatchOf(hit) : null
        lookupPhase = false
        const via =
          previousAttempts >= MAX_INVOICE_ATTEMPTS
            ? 'plafon-utani lekerdezes'
            : refunded
              ? 'visszaterites-utani lekerdezes'
              : previousAttempts > 0
                ? 'retry-elotti lekerdezes'
                : 'elso-kiserlet-elotti lekerdezes'
        if (hit && mismatch !== null) {
          return await refuseForeign(hit, mismatch, via)
        }
        if (hit) {
          return await adoptExisting(hit, via)
        }

        // a-egyeztetes-13 + K12: a visszatérített rendelés korábbi beküldése
        // nem hozott létre kereshető számlát. Új számla + stornó nem megy ki.
        if (refunded) {
          return await stopRefundedWithoutInvoice(
            `a korábbi beküldés (${previousAttempts}) nyomán a lekérdezés sem talált számlát`,
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
            `Az utolsó beküldés ennek ellenére létrehozhatta a számlát, ezért kézi kiállítás előtt keresd meg a Számlázz.hu-fiókban a(z) ${orderNumber} rendelésszámú bizonylatot.` +
            (previousError ? ` A korábbi hiba: ${previousError}` : '')
          orderLog.error(
            'RIASZTÁS: a számlakiállítás beküldései kimerültek, és a záró lekérdezés sem talált bizonylatot. Emberi beavatkozás kell (Számlázz.hu-szabály: legfeljebb 5 beküldés); kézi kiállítás előtt keresd meg a Számlázz.hu-fiókban a rendelésszámmal azonos rendelésszámú bizonylatot.',
            { orderNumber, attempts: previousAttempts, lastError: order.invoiceLastError ?? null },
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
        if (latestBeforePost?.status === 'refunded') {
          return await stopRefundedWithoutInvoice(
            previousAttempts > 0
              ? `a korábbi beküldés (${previousAttempts}) nyomán a lekérdezés sem talált számlát`
              : 'korábbi beküldés sem történt',
          )
        }
        if (!latestBeforePost || latestBeforePost.status !== 'paid') {
          orderLog.info('a rendelés státusza nem paid — számlakiállítás kihagyva', {
            status: latestBeforePost?.status ?? null,
          })
          return { outcome: 'skipped', reason: 'a rendelés státusza nem paid' }
        }

        // A beküldés csak teljes timeouttal, a zár időkeretén belül indulhat
        // (lock-budget.ts); különben újrapróbálható hiba, kísérlet-növelés NÉLKÜL.
        const postConfig = budget.forPost()
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
        const result = await postXml(xml, postConfig)
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
          kulsoAzon,
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
        await reconcileRefundsAfterIssue(result.szamlaszam)
        return { outcome: 'issued', invoiceNumber: result.szamlaszam }
      } catch (error) {
        // 71/152 — „Már létező rendelésszám": nem hiba, hanem idempotencia-találat.
        // A meglévő bizonylat számát lekérdezéssel (és egyeztetéssel) vesszük át.
        if (isDuplicateOrderError(error)) {
          orderLog.info(
            'a Számlázz.hu duplikátum-jelzést adott (71/152) — a meglévő számla lekérdezése',
            { agentErrorCodes: error.agentErrors.map((entry) => entry.code) },
          )
          try {
            const hit = await findExisting()
            const mismatch = hit ? await mismatchOf(hit) : null
            if (hit && mismatch !== null) {
              return await refuseForeign(hit, mismatch, 'duplikatum-feloldas')
            }
            if (hit) {
              return await adoptExisting(hit, 'duplikatum-feloldas')
            }
            const reason =
              'a Számlázz.hu duplikátumot jelzett (71/152), de a szamlaKulsoAzon-lekérdezés nem talál bizonylatot — kézi egyeztetés szükséges'
            orderLog.error(`RIASZTÁS: ${reason}`, {
              orderNumber,
              agentErrorCodes: error.agentErrors.map((entry) => entry.code),
            })
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
        // végleges, a hibasorozat az invoiceLastError előtagjában marad meg.
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
          const agentErrorCodes = error.agentErrors.map((entry) => entry.code)
          const context = {
            orderNumber,
            kind: error.kind,
            retryable: error.retryable,
            attempts,
            agentErrorCode: agentErrorCodes[0] ?? null,
            agentErrorCodes,
            error: error.message,
          }
          if (error.retryable) {
            // A job-retry (kimerülése után az order-poll resweep) újrapróbálja: a
            // következő futás a beküldés ELŐTT lekérdezi a bizonylatot, a
            // beküldések számát pedig az invoiceAttempts plafon korlátozza.
            orderLog.warn('számlakiállítás sikertelen (újrapróbálható)', context)
            throw error
          }
          // VÉGLEGES hiba (a-szamlazz-6, a-riasztas-2): a számla 'failed', a job
          // nem próbálja újra, és a resweep sem veszi fel. Konfiguráció-jellegű
          // kód (3 hibás kulcs, 54 e-számla nincs engedélyezve, 57 XML, 202
          // előtag, 259–264 kerekítés) MINDEN rendelést érint: RIASZTÁS kell.
          orderLog.error(
            `RIASZTÁS: a számla kiállítása végleges hibával leállt (a Számlázz.hu válasza: ${agentErrorCodes.join(', ') || 'kód nélkül'}) — a számla NEM készült el; a hiba okát a Számlázz.hu-fiókban kell rendezni, utána a számla kézzel sorba állított invoice-issue jobbal újrapróbálható`,
            context,
          )
          return { outcome: 'failed', reason: error.message }
        }
        orderLog.error('RIASZTÁS: a számlakiállítás váratlan hibával állt le', {
          orderNumber,
          attempts,
          error: message,
        })
        throw error
      }
    },
    log,
  )
}
