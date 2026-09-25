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
 *   storno.ts, corrective.ts), bizonylatonként EGYEDI értékkel (kulso-azon.ts),
 *   ezért ez a pontos kulcs (a rendelesSzam több bizonylatot is takarhat, és
 *   arra a rendszer a LEGUTOLSÓT adná vissza). A Számlázz.hu a külső azonosító
 *   egyediségét NEM kényszeríti ki: azonos kulcsra a legújabb birtokost adja
 *   (r-szamlazz, szamlazz-hu-behaviour.md), ezért a hívó a talált bizonylat
 *   bruttó végösszegét is egyezteti a rendeléssel, mielőtt átveszi.
 * - Ismeretlen azonosító → 7-es hibakód: ez itt NEM hiba, hanem „nincs ilyen
 *   bizonylat" válasz (null) — pl. az első kiállítási kísérlet retry-ja előtt.
 *   A null KIZÁRÓLAG a VÉGLEGES, nem újrapróbálható 7-esre jár (2xx válasz a
 *   7-es kóddal, a hivatalos válasz-oldal szerint: „Ismeretlen számlaszám,
 *   rendelésszám vagy külső azonosító esetén a szerver 7-es hibakódot ad
 *   vissza"). Egy átmeneti státusz (503/429) mellé került 7-es kód
 *   ÚJRAPRÓBÁLHATÓ hibaként megy tovább: a hívó a null-t a bizonylat
 *   NEMLÉTÉNEK bizonyítékaként kezeli, és beküldene — egy korábbi bizonytalan
 *   beküldés után ez dupla számlát adna (Codex, PR #304 utáni P1).
 * - valaszVerzio=2: a válasz ugyanaz az xmlszamlavalasz, mint kiállításnál
 *   (parseAgentResponse újrahasznosítva); a <pdf> base64 tartalmát nem
 *   tároljuk, a lekérdezés célja a bizonylat LÉTÉNEK, SZÁMÁNAK és bruttó
 *   VÉGÖSSZEGÉNEK megállapítása (`szamlabrutto`, a hivatalos válasz-minta
 *   szerint a v2 válasz része).
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
  /**
   * A talált bizonylat bruttó és nettó végösszege (HUF; stornón és
   * helyesbítőn negatív), ha a válasz hordozta. Az átvétel előtti
   * egyeztetéshez: hiányában a hívó NEM veszi át a bizonylatot.
   */
  szamlabrutto?: number
  szamlanetto?: number
}

/**
 * VÉGLEGES „nincs ilyen bizonylat" válasz-e a hiba: 7-es agent-kód, amelyet a
 * kliens nem minősített újrapróbálhatónak (2xx válasz, vagy végleges
 * státusz). Egy 503/429 mellé került 7-es, a szlahu_down, vagy a
 * félbeszakadt törzs NEM az: ott a bizonylat léte eldöntetlen maradt.
 */
export function isDefinitiveNotFound(error: unknown): error is SzamlazzApiError {
  return (
    error instanceof SzamlazzApiError &&
    error.kind === 'agent' &&
    !error.retryable &&
    error.agentErrors.some((entry) => entry.code.trim() === SZAMLAZZ_NOT_FOUND_CODE)
  )
}

/**
 * Bizonylat-lekérdezés külső azonosító (szamlaKulsoAzon) alapján.
 *
 * Visszatérés:
 * - a bizonylat száma (és végösszege), ha létezik;
 * - null, ha a Számlázz.hu VÉGLEGES 7-es kóddal „nem található"-t mond;
 * - SzamlazzApiError minden más esetben (timeout/network/http retryable;
 *   agent-hiba a hivatalos osztályozással; átmeneti státusz melletti 7-es
 *   kód is retryable) — a hívó dönt az újrapróbálásról, és bizonytalan
 *   kimenetnél NEM küld be.
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
  // parseAgentResponse strukturált hibái pedig változatlanul jönnek ki: a
  // VÉGLEGES 7-es kód (CDATA-ban vagy végleges nem-2xx válaszban is) → null,
  // az újrapróbálható (átmeneti státusz melletti) 7-es és minden más dob.
  let result: SzamlazzParsedSuccess
  try {
    result = await readAgentResponse(response, resolved.timeoutMs, 'bizonylat-lekérdezés')
  } catch (error) {
    if (isDefinitiveNotFound(error)) {
      logger.info('bizonylat-lekérdezés: nincs találat (7-es kód)', { endpoint, durationMs })
      return null
    }
    throw error
  }

  logger.info('bizonylat-lekérdezés: találat', {
    endpoint,
    durationMs,
    szamlaszam: result.szamlaszam,
    szamlabrutto: result.szamlabrutto ?? null,
  })
  return {
    szamlaszam: result.szamlaszam,
    ...(result.szamlabrutto !== undefined ? { szamlabrutto: result.szamlabrutto } : {}),
    ...(result.szamlanetto !== undefined ? { szamlanetto: result.szamlanetto } : {}),
  }
}
