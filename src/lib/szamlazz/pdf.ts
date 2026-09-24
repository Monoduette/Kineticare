import { createLogger } from '../logger'
import {
  getSzamlazzConfig,
  isAbortError,
  readAgentResponse,
  type SzamlazzParsedSuccess,
} from './client'
import { SzamlazzApiError, type SzamlazzClientConfig } from './types'
import { escapeXml } from './xml'

/**
 * Bizonylat-lekérdezés a Számla Agent PDF-interfészén (xmlszamlapdf /
 * action-szamla_agent_pdf) — az IDEMPOTENCIA-FELOLDÁS magja.
 *
 * Miért kell: a Railway privát hálózata elvághatja a TCP-kapcsolatot a kérés
 * elküldése UTÁN, a válasz megérkezése ELŐTT („kérés elment, válasz elveszett").
 * Ilyenkor a bizonylat a Számlázz.hu-nál már létezhet, miközben nálunk nincs
 * rögzítve. A hivatalos minta szerint kiállítás-újrapróbálás ELŐTT lekérdezés
 * kell a szamlaKulsoAzon alapján, a 71/152-es („Már létező rendelésszám")
 * duplikátum-jelzés pedig szintén lekérdezéssel oldódik fel — nem hibaként.
 *
 * Séma-tények (élő XSD: https://www.szamlazz.hu/szamla/docs/xsds/agentpdf/xmlszamlapdf.xsd):
 * - Mezősorrend: felhasznalo(0), jelszo(0), szamlaagentkulcs(0), szamlaszam(0),
 *   rendelesSzam(0), valaszVerzio(KÖTELEZŐ, int), szamlaKulsoAzon(0).
 *   (A docs-oldalba ágyazott régebbi XSD-változat eltér — az élő,
 *   schemaLocation-ben hivatkozott XSD a mérvadó; az általunk küldött
 *   agentkulcs → valaszVerzio → szamlaKulsoAzon részsorrend mindkettővel
 *   kompatibilis, mert a szamlaszam/rendelesSzam mezőt nem küldjük.)
 * - A három azonosító kulcs (szamlaszam, rendelesSzam, szamlaKulsoAzon) közül
 *   legalább egy kell; a szamlaKulsoAzon csak akkor használható, ha a
 *   KIÁLLÍTÓ kérésben el volt küldve — nálunk mindig el van (invoice.ts,
 *   storno.ts, corrective.ts), bizonylatonként EGYEDI értékkel, ezért ez a
 *   pontos kulcs (a rendelesSzam több bizonylatot is takarhat, és arra a
 *   rendszer a LEGUTOLSÓT adná vissza).
 * - Ismeretlen azonosító → 7-es hibakód: ez itt NEM hiba, hanem „nincs ilyen
 *   bizonylat" válasz (null) — pl. az első kiállítási kísérlet retry-ja előtt.
 * - valaszVerzio=2: a válasz ugyanaz az xmlszamlavalasz, mint kiállításnál
 *   (parseAgentResponse újrahasznosítva); a <pdf> base64 tartalmát nem
 *   tároljuk, a lekérdezés célja a bizonylat LÉTÉNEK és SZÁMÁNAK megállapítása.
 */

const logger = createLogger({ module: 'szamlazz-lookup' })

/** 7-es hibakód: a megadott azonosítóhoz nem található bizonylat. */
export const SZAMLAZZ_NOT_FOUND_CODE = '7'

export interface BuildInvoiceLookupXmlInput {
  agentKey: string
  /** A keresett bizonylat kiállításkor beküldött külső azonosítója. */
  kulsoAzon: string
}

/** A lekérdező XML (xmlszamlapdf) az élő XSD mezősorrendjében. */
export function buildInvoiceLookupXml(input: BuildInvoiceLookupXmlInput): string {
  const esc = escapeXml
  return `<?xml version="1.0" encoding="UTF-8"?>
<xmlszamlapdf xmlns="http://www.szamlazz.hu/xmlszamlapdf" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.szamlazz.hu/xmlszamlapdf https://www.szamlazz.hu/szamla/docs/xsds/agentpdf/xmlszamlapdf.xsd">
  <szamlaagentkulcs>${esc(input.agentKey)}</szamlaagentkulcs>
  <valaszVerzio>2</valaszVerzio>
  <szamlaKulsoAzon>${esc(input.kulsoAzon)}</szamlaKulsoAzon>
</xmlszamlapdf>`
}

export interface InvoiceLookupResult {
  /** A megtalált bizonylat (számla / stornó / helyesbítő) sorszáma. */
  szamlaszam: string
}

/**
 * Bizonylat-lekérdezés külső azonosító (szamlaKulsoAzon) alapján.
 *
 * Visszatérés:
 * - a bizonylat száma, ha létezik;
 * - null, ha a Számlázz.hu 7-es kóddal „nem található"-t mond;
 * - SzamlazzApiError minden más esetben (timeout/network/http retryable;
 *   agent-hiba a hivatalos osztályozással) — a hívó dönt az újrapróbálásról.
 */
export async function queryInvoiceByKulsoAzon(
  kulsoAzon: string,
  config?: SzamlazzClientConfig,
): Promise<InvoiceLookupResult | null> {
  const resolved = config ?? getSzamlazzConfig()
  if (!resolved.enabled || !resolved.agentKey) {
    throw new SzamlazzApiError({
      message: 'A Számlázz.hu-integráció nincs beállítva (SZAMLAZZ_AGENT_KEY hiányzik).',
      kind: 'invalid_data',
      retryable: false,
    })
  }

  const endpoint = 'POST /szamla (action-szamla_agent_pdf)'
  const xml = buildInvoiceLookupXml({ agentKey: resolved.agentKey, kulsoAzon })
  const form = new FormData()
  form.append('action-szamla_agent_pdf', new Blob([xml], { type: 'text/xml' }), 'szamlapdf.xml')

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
        message: `A Számlázz.hu nem válaszolt ${resolved.timeoutMs} ms-en belül (bizonylat-lekérdezés).`,
        kind: 'timeout',
        retryable: true,
      })
    }
    throw new SzamlazzApiError({
      message: `A Számlázz.hu elérhetetlen (bizonylat-lekérdezés): ${
        error instanceof Error ? error.message : String(error)
      }`,
      kind: 'network',
      retryable: true,
    })
  }

  const durationMs = Date.now() - startedAt
  // A törzs-olvasás és az értelmezés a közös readAgentResponse-ban: a stream
  // félbeszakadása (timeout a fejlécek után, TCP-vágás félúton) osztályozott,
  // retryable hibává válik, a nem-2xx válasz hibakódját is kiolvassa, a
  // parseAgentResponse strukturált hibái pedig változatlanul jönnek ki: a 7-es
  // kód (CDATA-ban vagy nem-2xx válaszban is) → null, a többi dob.
  let result: SzamlazzParsedSuccess
  try {
    result = await readAgentResponse(response, resolved.timeoutMs, 'bizonylat-lekérdezés')
  } catch (error) {
    if (
      error instanceof SzamlazzApiError &&
      error.agentErrors.some((entry) => entry.code.trim() === SZAMLAZZ_NOT_FOUND_CODE)
    ) {
      logger.info('bizonylat-lekérdezés: nincs találat (7-es kód)', { endpoint, durationMs })
      return null
    }
    throw error
  }

  logger.info('bizonylat-lekérdezés: találat', {
    endpoint,
    durationMs,
    szamlaszam: result.szamlaszam,
  })
  return { szamlaszam: result.szamlaszam }
}
