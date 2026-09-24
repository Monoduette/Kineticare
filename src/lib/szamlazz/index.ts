/**
 * Számlázz.hu Számla Agent modul (T-024/W4-01) — nyilvános belépési pont.
 */
export {
  getSzamlazzConfig,
  isDuplicateOrderError,
  isSzamlazzEnabled,
  isTransientHttpStatus,
  parseAgentResponse,
  postInvoiceXml,
  readAgentResponse,
  SZAMLAZZ_DEFAULT_API_URL,
  SZAMLAZZ_DEFAULT_INVOICE_PREFIX,
  SZAMLAZZ_DEFAULT_TIMEOUT_MS,
  SZAMLAZZ_DUPLICATE_AGENT_CODES,
  SZAMLAZZ_NOTIFICATION_FAILED_CODE,
  SZAMLAZZ_RETRYABLE_AGENT_CODES,
  type SzamlazzEnv,
  type SzamlazzParsedSuccess,
} from './client'
export {
  buildInvoiceLookupXml,
  queryInvoiceByKulsoAzon,
  SZAMLAZZ_NOT_FOUND_CODE,
  type BuildInvoiceLookupXmlInput,
  type InvoiceLookupResult,
} from './pdf'
export {
  buildInvoiceXml,
  buyerFromOrder,
  computeLineAmounts,
  escapeXml,
  issueInvoiceForOrder,
  itemsFromOrder,
  MAX_INVOICE_ATTEMPTS,
  VAT_RATE_PERCENT,
  type BuildInvoiceXmlInput,
  type ComputeLineAmountsOptions,
  type CorrectiveInvoiceRef,
  type InvoiceBuyerInput,
  type InvoiceItemInput,
  type InvoiceLineAmounts,
  type IssueInvoiceForOrderDeps,
} from './invoice'
export {
  buildStornoXml,
  isRetryableStornoError,
  issueStornoForOrder,
  MAX_STORNO_ATTEMPTS,
  postStornoXml,
  type BuildStornoXmlInput,
  type IssueStornoForOrderDeps,
} from './storno'
export {
  buildCorrectiveInvoiceXml,
  CORRECTIVE_KULSO_AZON_INFIX,
  correctiveKulsoAzon,
  isRetryableCorrectiveError,
  issueCorrectiveInvoiceForOrder,
  MAX_CORRECTIVE_ATTEMPTS,
  type BuildCorrectiveInvoiceXmlInput,
  type IssueCorrectiveInvoiceDeps,
} from './corrective'
export { earliestOrderGrantMoment, resolveOrderPaidMoment, type OrderPaidMoment } from './paid-date'
export { queueCorrectiveInvoiceJob, queueStornoIssueJob } from './queue'
export { writeOrderInvoicingState } from './order-state'
// Közös dátum-segédek: a kelt-dátum zóna-tudatos képzése (Europe/Budapest) és
// a Számla Agent dátummezőinek alak-kapuja. Az escapeXml az invoice.ts-en
// keresztül exportálódik (ott is re-export a ./xml-ből).
export { budapestDateString, isIsoDateString } from './xml'
export {
  SzamlazzApiError,
  type IssueCorrectiveInvoiceResult,
  type IssueCorrectiveOutcome,
  type IssueInvoiceOutcome,
  type IssueInvoiceResult,
  type IssueStornoOutcome,
  type IssueStornoResult,
  type SzamlazzAgentError,
  type SzamlazzClientConfig,
  type SzamlazzErrorKind,
  type SzamlazzVatMode,
} from './types'
