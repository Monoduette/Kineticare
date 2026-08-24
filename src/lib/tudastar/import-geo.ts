/**
 * Search GEO segédek a két ÚJ Tudástár-poszt importjához.
 *
 * Person user név vagy e-mail szerint, idempotensen. Hiányzó usernél nem
 * találunk ki rekordot: az author null, a storefront noindexet ad.
 * A faq mezőt csak a két új slugra írjuk — a hat élő posztot nem backfill-eljük.
 */

import type { Payload } from 'payload'

import { logger } from '../logger'
import { ujTudastarSlug } from './eeat-kapu'

export async function felhasznaloIdNevVagyEmailAlapjan(
  payload: Payload,
  nev: string,
  email?: string,
): Promise<number | null> {
  const nevTalalat = await payload.find({
    collection: 'users',
    where: { name: { equals: nev } },
    limit: 1,
    overrideAccess: true,
  })
  const nevId = nevTalalat.docs[0]?.id
  if (typeof nevId === 'number') return nevId

  const emailCim = email?.trim()
  if (emailCim !== undefined && emailCim.length > 0) {
    const emailTalalat = await payload.find({
      collection: 'users',
      where: { email: { equals: emailCim } },
      limit: 1,
      overrideAccess: true,
    })
    const emailId = emailTalalat.docs[0]?.id
    if (typeof emailId === 'number') return emailId
  }
  return null
}

/**
 * Kiss Kata → author, Kocsis Kata → reviewedBy.
 * Hiányzó usernél NEM dob: author null (a Posts defaultValue ownerét felülírjuk).
 */
export async function szerzokExtraMezok(
  payload: Payload,
  nevek: readonly string[],
): Promise<{ author: number | null; reviewedBy?: number; hianyzok: string[] }> {
  const ids = await Promise.all(nevek.map((nev) => felhasznaloIdNevVagyEmailAlapjan(payload, nev)))
  const hianyzok = nevek.filter((_, index) => ids[index] === null)
  const extra: { author: number | null; reviewedBy?: number; hianyzok: string[] } = {
    author: ids[0] ?? null,
    hianyzok,
  }
  if (ids[1] !== null && ids[1] !== undefined) extra.reviewedBy = ids[1]
  return extra
}

export function faqMezoAPayloadba(
  slug: string,
  faq: { question: string; answer: string }[] | undefined,
): { faq: { question: string; answer: string }[] } | Record<string, never> {
  if (!ujTudastarSlug(slug) || faq === undefined) return {}
  return { faq }
}

export function hianzoSzerzoFigyelmeztetes(slug: string, hianyzok: readonly string[]): void {
  if (hianyzok.length === 0) return
  logger.warn(
    'Tudástár-import: hiányzó Person user. Nem találunk ki usert. ' +
      'A cikk published maradhat, a storefront robots noindexet ad, amíg a user nincs a CMS-ben.',
    { slug, hianyzok },
  )
}
