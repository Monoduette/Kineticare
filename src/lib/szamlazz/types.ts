/**
 * Számlázz.hu Számla Agent — típusok és a strukturált hibaosztály (T-024/W4-01).
 *
 * A Számla Agent XML-protokollja (https://docs.szamlazz.hu/hu/agent):
 * - POST https://www.szamlazz.hu/szamla/ , multipart/form-data, az XML az
 *   'action-xmlagentxmlfile' mezőben utazik (fájlként, szöveges XML).
 * - A válasz valaszVerzio=2 mellett XML (xmlszamlavalasz): <sikeres>,
 *   <szamlaszam>, hiba esetén <hibakod>/<hibauzenet>. Egyes hibák csak a
 *   szlahu_* HTTP-válaszfejlécekből derülnek ki (pl. szlahu_down).
 * - A <szamlaKulsoAzon> a harmadik fél rendszerének azonosítója — mi az
 *   orderNumber-t küldjük. Ez a bizonylat VISSZAKERESÉSI kulcsa (pdf.ts); a
 *   duplikátum-védelmet a <rendelesSzam> + a fiókban bekapcsolt
 *   rendelésszám-ismétlés-tiltás adja (lásd invoice.ts).
 */

export type SzamlazzErrorKind =
  | 'timeout'
  | 'network'
  | 'http'
  | 'agent'
  /**
   * 71/152-es hibakód: „Már létező rendelésszám". NEM valódi hiba, hanem a
   * hivatalos idempotencia-jelzés (a fiókban bekapcsolt rendelésszám-ismétlés
   * tiltás fogta meg az ismételt kérést) — a hívó a szamlaKulsoAzon-alapú
   * lekérdezéssel oldja fel (a meglévő bizonylat számát veszi át).
   */
  | 'duplicate'
  | 'invalid_response'
  | 'invalid_data'

/** Számla Agent hibaobjektum (hibakod + hibauzenet pár). */
export interface SzamlazzAgentError {
  code: string
  message: string
}

export class SzamlazzApiError extends Error {
  readonly kind: SzamlazzErrorKind
  readonly httpStatus?: number
  readonly agentErrors: SzamlazzAgentError[]
  /** Újrapróbálható-e (a job-retry e szerint dönt). */
  readonly retryable: boolean

  constructor(args: {
    message: string
    kind: SzamlazzErrorKind
    httpStatus?: number
    agentErrors?: SzamlazzAgentError[]
    retryable: boolean
  }) {
    super(args.message)
    this.name = 'SzamlazzApiError'
    this.kind = args.kind
    this.httpStatus = args.httpStatus
    this.agentErrors = args.agentErrors ?? []
    this.retryable = args.retryable
  }
}

/**
 * A számla tételeinek áfakulcsa. A Számlázz.hu numerikus kulcsokat ÉS
 * speciális kódokat is fogad — a mi két esetünk:
 * - '27': általános 27%-os áfa;
 * - 'AAM': alanyi adómentes eladó — belföldön KIZÁRÓLAG ez a kulcs jogszerű
 *   (a TAM és a 0% nem), afaErtek=0 és bruttoErtek=nettoErtek mellett.
 * A kulcsot a SZAMLAZZ_AFAKULCS env-változó választja ki — bekapcsolt
 * számlázásnál KÖTELEZŐEN, alapértelmezés nélkül (lásd getSzamlazzConfig); a
 * szám-only típus szándékosan kerülve (a 27 és az 'AAM' közös, szűkített
 * unionban él).
 */
export type SzamlazzVatMode = '27' | 'AAM'

export interface SzamlazzClientConfig {
  /** false, ha SZAMLAZZ_AGENT_KEY nincs beállítva — ilyenkor a számlázás ki van kapcsolva (nem hiba). */
  enabled: boolean
  /**
   * Számla Agent végpont (default: https://www.szamlazz.hu/szamla/) — ZÁRÓ
   * PERJELLEL. A perjel nélküli alak átirányítást kaphat, és egy 301/302-es
   * redirect a POST-ot GET-té alakítaná (a multipart törzs elveszne).
   */
  apiUrl: string
  /** Számla Agent kulcs — SOHA ne naplózd! (enabled=false esetén undefined). */
  agentKey?: string
  /** Számlaszám-előtag (a Számlázz.hu felületen beállított Előtagok egyike). */
  invoicePrefix: string
  /**
   * A tételek áfakulcsa (SZAMLAZZ_AFAKULCS env). Bekapcsolt számlázásnál
   * kötelező, hiánya konfigurációs hiba; '27' csak KIKAPCSOLT számlázásnál
   * (agent-kulcs nélkül) áll be, ahol bizonylat sem készül.
   */
  vatMode: SzamlazzVatMode
  timeoutMs: number
}

/** A számlakiállítás kimenetele a job és a naplózás számára. */
export type IssueInvoiceOutcome = 'issued' | 'already-issued' | 'disabled' | 'failed' | 'skipped'

export interface IssueInvoiceResult {
  outcome: IssueInvoiceOutcome
  invoiceNumber?: string
  /** failed kimenetelnél az ok (emberi olvasásra). */
  reason?: string
}

/**
 * A stornó-számla kiállítás kimenetele (T-WSD — a Számla Agent dedikált
 * sztornó interfésze, xmlszamlast / action-szamla_agent_st).
 * - 'storned': a stornó-számla kiállításra került;
 * - 'already-storned': a rendelésen már rögzítve van stornó-számla (no-op);
 * - 'disabled': a Számlázz.hu-integráció kikapcsolva (nincs agent-kulcs) — NEM hiba;
 * - 'failed': nem újrapróbálható okból nem készült el (pl. nincs eredeti számlaszám).
 */
export type IssueStornoOutcome = 'storned' | 'already-storned' | 'disabled' | 'failed'

export interface IssueStornoResult {
  outcome: IssueStornoOutcome
  /** A kiállított stornó-számla száma (storned kimenetelnél). */
  stornoNumber?: string
  /** failed kimenetelnél az ok (emberi olvasásra). */
  reason?: string
}

/**
 * A helyesbítő (módosító) számla kiállítás kimenetele (C5 — RÉSZLEGES
 * visszatérítés bizonylata; a teljes visszatérítésé a stornó).
 * - 'issued': a helyesbítő számla kiállításra került;
 * - 'already-issued': ehhez a refund-bejegyzéshez már készült helyesbítő (no-op);
 * - 'disabled': a Számlázz.hu-integráció kikapcsolva (nincs agent-kulcs) — NEM hiba;
 * - 'failed': nem újrapróbálható okból nem készült el (pl. nincs eredeti
 *   számlaszám, hiányos vevőadat, érvénytelen összeg).
 */
export type IssueCorrectiveOutcome = 'issued' | 'already-issued' | 'disabled' | 'failed'

export interface IssueCorrectiveInvoiceResult {
  outcome: IssueCorrectiveOutcome
  /** A kiállított helyesbítő számla száma (issued/already-issued kimenetelnél). */
  correctiveInvoiceNumber?: string
  /** failed kimenetelnél az ok (emberi olvasásra). */
  reason?: string
}
