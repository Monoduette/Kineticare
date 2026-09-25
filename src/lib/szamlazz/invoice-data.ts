import { createLogger } from '../logger'
import {
  bodyReadError,
  getSzamlazzConfig,
  isAbortError,
  isTransientHttpStatus,
  readAgentResponse,
  tagValue,
} from './client'
import { SzamlazzApiError, type SzamlazzClientConfig } from './types'
import { escapeXml } from './xml'

/**
 * Számlaadat-lekérdezés XML-ben (xmlszamlaxml / action-szamla_agent_xml) —
 * az EREDETI számla áfakulcsának kiolvasása a helyesbítő kiállítása előtt
 * (a-szamlazz-13, r-szamlazz-7, r-ado-8, a-refund-11).
 *
 * Miért kell: a rendelés nem tárolja, milyen áfakulccsal állt ki a számla
 * (új mező csak migrációval jöhetne — H8a), a helyesbítő pedig a hivatalos
 * szabály szerint az eredetivel EGYÜTT írja le a gazdasági eseményt
 * (tudastar/gyik/helyesbito-szamla-kiallitasa), tehát ugyanazt a kulcsot kell
 * hordoznia. Egy kulcsváltás (AAM-keret átlépése, vagy a konfig javítása) után
 * a `SZAMLAZZ_AFAKULCS` már NEM az eredeti számla kulcsa. Ezért a helyesbítő
 * előtt a Számlázz.hu-tól kérdezzük le az eredetit, és ha a kulcs nem olvasható
 * vagy eltér, a helyesbítő RIASZTÁS-sal megáll — nem találgat.
 *
 * Kérés (élő XSD: https://www.szamlazz.hu/szamla/docs/xsds/agentxml/xmlszamlaxml.xsd,
 * vendorolt másolat: src/__tests__/szamlazz/xsd/xmlszamlaxml.xsd): a mezők
 * sorrendje felhasznalo(0), jelszo(0), szamlaagentkulcs(0), szamlaszam(0),
 * rendelesSzam(0), pdf(0), szamlaKulsoAzon(0). A számlát a SZÁMÁVAL kérjük
 * (`szamlaszam`), mert a rendelésszám több bizonylatot takarhat (a rendszer a
 * legutolsót adná), a külső azonosító pedig a régi (PR #304-es) alakban is
 * lehet. PDF-et nem kérünk.
 *
 * Válasz: `<szamla xmlns="http://www.szamlazz.hu/szamla">` dokumentum
 * (alap / szallito / vevo / tetelek / osszegek), amelynek tételei az
 * `afatipus` (szöveges kód: TAM, AAM, EU, …; csak speciális kulcsnál) és az
 * `afakulcs` (numerikus, pl. 27.0) mezőt hordozzák — a hivatalos PHP SDK
 * (`getInvoiceData`) és a független Go-kliens válaszmodellje szerint
 * (r-szamlazz/verify). Hiba esetén a szokásos xmlszamlavalasz jön
 * (`<sikeres>false</sikeres>` + hibakód; ismeretlen számlaszámra 7-es), a
 * fejlécekben pedig a szlahu_* jelzések — ezeket a közös readAgentResponse
 * osztályozza. A `<vevo>` blokk a PARTNERTÖRZS élő adata, nem a kiállításkori
 * pillanatkép (szamlazz-hu-behaviour.md, D6): a címe és e-mail-címe egy későbbi,
 * azonos nevű vevőnek kiállított számlával felülíródhat. A partnert viszont a
 * Számlázz.hu a NÉVVEL azonosítja, így a `<vevo><nev>` összevethető a rendelés
 * vevőnevével (a régi kulcson talált számla átvétele előtt, invoice.ts); a
 * cím és az e-mail nem.
 */

const logger = createLogger({ module: 'szamlazz-invoice-data' })

export interface BuildInvoiceDataQueryXmlInput {
  agentKey: string
  /** A lekérdezett bizonylat száma (az eredeti számla `invoiceNumber`-e). */
  szamlaszam: string
}

/** A számlaadat-lekérdező XML (xmlszamlaxml) az élő XSD mezősorrendjében. */
export function buildInvoiceDataQueryXml(input: BuildInvoiceDataQueryXmlInput): string {
  const esc = escapeXml
  return `<?xml version="1.0" encoding="UTF-8"?>
<xmlszamlaxml xmlns="http://www.szamlazz.hu/xmlszamlaxml" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.szamlazz.hu/xmlszamlaxml https://www.szamlazz.hu/szamla/docs/xsds/agentxml/xmlszamlaxml.xsd">
  <szamlaagentkulcs>${esc(input.agentKey)}</szamlaagentkulcs>
  <szamlaszam>${esc(input.szamlaszam)}</szamlaszam>
  <pdf>false</pdf>
</xmlszamlaxml>`
}

export interface InvoiceDataResult {
  /** A lekérdezett bizonylat száma (`alap/szamlaszam`). */
  szamlaszam: string
  /**
   * A tételek áfakulcsai NORMALIZÁLVA, az első előfordulás sorrendjében,
   * ismétlés nélkül: a szöveges kód (`afatipus`, pl. 'AAM'), ha van, különben
   * a numerikus kulcs egész alakja (27.0 → '27'). Egy értelmezhetetlen tétel
   * `'ismeretlen'`-ként jelenik meg — a hívó ilyenkor megáll.
   */
  vatKeys: string[]
  /** `alap/sztornozott` = true: a bizonylatot már sztornózták. */
  sztornozott: boolean
  /** A vevő neve (`vevo/nev`), ha a válasz hordozza. */
  vevoNev?: string
  /**
   * A hivatkozott (helyesbített vagy sztornózott) számla száma
   * (`alap/hivszamlaszam`); csak helyesbítőn és stornón van.
   */
  hivatkozottSzamlaszam?: string
}

/** Egy `<tetel>` (vagy `<afakulcsossz>`) áfakulcsának normalizált alakja. */
function normalizeVatKey(block: string): string {
  const afatipus = tagValue(block, 'afatipus')?.trim()
  if (afatipus) {
    return afatipus
  }
  const afakulcs = tagValue(block, 'afakulcs')?.trim()
  if (!afakulcs) {
    return 'ismeretlen'
  }
  // Numerikus kulcs egész alakban (27.0 → '27'); a nem numerikus szöveg
  // (ha a szolgáltató az afakulcs mezőbe írná a kódot) változatlanul.
  const numeric = Number(afakulcs)
  return Number.isFinite(numeric) ? String(numeric) : afakulcs
}

/** A `<szamla>` gyökérelem jelen van-e (a hibaválasz gyökere xmlszamlavalasz). */
function isSzamlaDocument(body: string): boolean {
  return /<szamla(?:\s[^>]*)?>/.test(body)
}

/**
 * A `<szamla>` dokumentum értelmezése. A tételeket a CDATA-tudatos
 * tag-olvasóval járjuk be; tétel nélküli vagy szám nélküli dokumentum
 * bizonytalan válasz (a hívó nem építhet rá).
 */
export function parseInvoiceDataDocument(body: string): InvoiceDataResult {
  const alap = tagValue(body, 'alap')
  const szamlaszam = alap ? tagValue(alap, 'szamlaszam') : undefined
  if (!szamlaszam) {
    throw new SzamlazzApiError({
      message:
        'A Számlázz.hu számlaadat-válasza nem tartalmaz bizonylatszámot (alap/szamlaszam) — a válasz nem értelmezhető.',
      kind: 'invalid_response',
      retryable: true,
    })
  }
  const tetelek = tagValue(body, 'tetelek') ?? ''
  const blocks = tetelek.match(/<tetel(?:\s[^>]*)?>[\s\S]*?<\/tetel\s*>/g) ?? []
  const vatKeys: string[] = []
  for (const block of blocks) {
    const key = normalizeVatKey(block)
    if (!vatKeys.includes(key)) {
      vatKeys.push(key)
    }
  }
  const sztornozott = (alap ? tagValue(alap, 'sztornozott') : undefined)?.trim().toLowerCase()
  const vevo = tagValue(body, 'vevo')
  const vevoNev = vevo ? tagValue(vevo, 'nev')?.trim() : undefined
  const hivatkozottSzamlaszam = alap ? tagValue(alap, 'hivszamlaszam')?.trim() : undefined
  return {
    szamlaszam,
    vatKeys,
    sztornozott: sztornozott === 'true' || sztornozott === '1',
    ...(vevoNev ? { vevoNev } : {}),
    ...(hivatkozottSzamlaszam ? { hivatkozottSzamlaszam } : {}),
  }
}

/**
 * Az eredeti számla adatainak lekérdezése a számla számával.
 *
 * Visszatérés: a bizonylat száma, a tételek áfakulcsai és a sztornózottság.
 * Hiba: SzamlazzApiError a hivatalos osztályozással (timeout/network/http
 * újrapróbálható; ismeretlen számlaszám = 7-es agent-kód, VÉGLEGES; a
 * `<szamla>` nélküli, hibajelzés nélküli törzs bizonytalan, újrapróbálható).
 * A 7-es itt NEM „nincs találat"-null: egy nem létező eredeti számlához
 * helyesbítő sem állítható ki, a hívó megáll.
 */
export async function queryInvoiceData(
  szamlaszam: string,
  config?: SzamlazzClientConfig,
): Promise<InvoiceDataResult> {
  const resolved = config ?? getSzamlazzConfig()
  if (!resolved.enabled || !resolved.agentKey) {
    throw new SzamlazzApiError({
      message: 'A Számlázz.hu-integráció nincs beállítva (SZAMLAZZ_AGENT_KEY hiányzik).',
      kind: 'invalid_data',
      retryable: false,
    })
  }

  const endpoint = 'POST /szamla (action-szamla_agent_xml)'
  const context = 'számlaadat-lekérdezés'
  const xml = buildInvoiceDataQueryXml({ agentKey: resolved.agentKey, szamlaszam })
  const form = new FormData()
  form.append('action-szamla_agent_xml', new Blob([xml], { type: 'text/xml' }), 'szamlaxml.xml')

  const startedAt = Date.now()
  let response: Response
  try {
    response = await fetch(resolved.apiUrl, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(resolved.timeoutMs),
    })
  } catch (error) {
    if (isAbortError(error)) {
      throw new SzamlazzApiError({
        message: `A Számlázz.hu nem válaszolt ${resolved.timeoutMs} ms-en belül (${context}).`,
        kind: 'timeout',
        retryable: true,
      })
    }
    throw new SzamlazzApiError({
      message: `A Számlázz.hu elérhetetlen (${context}): ${
        error instanceof Error ? error.message : String(error)
      }`,
      kind: 'network',
      retryable: true,
    })
  }
  const durationMs = Date.now() - startedAt

  let body: string
  try {
    body = await response.text()
  } catch (error) {
    if (!response.ok) {
      throw new SzamlazzApiError({
        message: `Számlázz.hu HTTP-hiba (${response.status}) (${context}).`,
        kind: 'http',
        httpStatus: response.status,
        retryable: isTransientHttpStatus(response.status),
      })
    }
    throw bodyReadError(error, resolved.timeoutMs, context)
  }

  const headerError =
    response.headers.get('szlahu_down') ||
    response.headers.get('szlahu_error') ||
    response.headers.get('szlahu_error_code')
  if (response.ok && !headerError && isSzamlaDocument(body)) {
    const result = parseInvoiceDataDocument(body)
    logger.info('számlaadat-lekérdezés: találat', {
      endpoint,
      durationMs,
      szamlaszam: result.szamlaszam,
      vatKeys: result.vatKeys,
      sztornozott: result.sztornozott,
    })
    return result
  }

  // Nem <szamla> dokumentum: a hibajelzést (fejléc / xmlszamlavalasz törzs /
  // átmeneti státusz) a közös olvasó osztályozza a már beolvasott törzsből.
  await readAgentResponse(
    { ok: response.ok, status: response.status, headers: response.headers, text: async () => body },
    resolved.timeoutMs,
    context,
  )
  // Ide csak egy xmlszamlavalasz-alakú SIKER jutna el, ami a számlaadat-
  // lekérdezésnél nem értelmezhető: bizonytalan válasz.
  throw new SzamlazzApiError({
    message: `A Számlázz.hu válasza nem <szamla> dokumentum (${context}) — a válasz nem értelmezhető.`,
    kind: 'invalid_response',
    retryable: true,
  })
}
