import type { Page, Post, Product } from '../payload-types'

import { extractRelationshipId, extractRelationTo } from './menu-validation'
import { isPublishedTarget, resolveMenuTargetPath, type MenuTargetCollection } from './menu-tree'
import { sanitizeCmsUrl } from './safe-url'

/**
 * A menüpont KÖZVETLEN, abszolút linkje az admin „Rejtett link" dobozához.
 *
 * TISZTA modul (DB- és React-független), hogy a menu-public-url.test.ts
 * adatbázis nélkül lefedje: a bemenet a menüpont nyers űrlapadata (`type`,
 * `ref`, `url`) és az oldal eredete (`origin`).
 *
 * MIÉRT NEM SAJÁT ÚTVONAL-KÉPZÉS: a linket ugyanaz a feloldás adja, mint a
 * fejléc-navigációét (`resolveMenuTargetPath` + `sanitizeCmsUrl`,
 * src/lib/menu-tree.ts és src/lib/safe-url.ts). Ha a két felület külön
 * szabályból dolgozna, a szerkesztő olyan linket másolhatna ki, amit a menü
 * sosem adna a látogatónak (WCAG 2.2 SC 3.2.4 Consistent Identification:
 * https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html).
 *
 * KÜLÖNBSÉG a navigációhoz képest: a piszkozat (nem published) célra is
 * visszaadja a linket, `targetPublished: false` jelzéssel, hogy a felület
 * figyelmeztethessen: a link 404-et ad, amíg a cél nincs közzétéve. A
 * navigáció ugyanezt a célt egyszerűen kihagyja.
 */

export interface MenuPublicUrlInput {
  type?: unknown
  ref?: unknown
  url?: unknown
}

export type MenuPublicUrlResult =
  /** Kész link: relatív href és abszolút webcím. */
  | { kind: 'ready'; href: string; absoluteUrl: string; targetPublished: boolean | null }
  /**
   * A `ref` csak azonosító (nem populált dokumentum): az admin szerkesztőlap
   * depth 0-val kapja az adatot, ezért a hívónak a célt külön kell betöltenie,
   * majd a populált dokumentummal újra hívnia.
   */
  | { kind: 'needs-target'; relationTo: MenuTargetCollection; id: number | string }

const TARGET_COLLECTIONS: ReadonlySet<string> = new Set(['pages', 'posts', 'products'])

function isTargetCollection(value: string | null): value is MenuTargetCollection {
  return value !== null && TARGET_COLLECTIONS.has(value)
}

/**
 * Az oldal eredetének normalizálása: csak http(s) séma, host nélküli vagy
 * hibás érték → null. A záró perjel és az útvonal-rész lemarad, mert a
 * `new URL(href, origin)` a gyökér-relatív href-et amúgy is az eredetre illeszti.
 */
export function normalizeOrigin(origin: unknown): string | null {
  if (typeof origin !== 'string' || origin.trim().length === 0) {
    return null
  }
  let parsed: URL
  try {
    parsed = new URL(origin.trim())
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null
  }
  return parsed.origin
}

/** Abszolút webcím egy href-ből; a már abszolút (külső) href változatlan marad. */
function toAbsoluteUrl(href: string, origin: string): string {
  return new URL(href, origin).href
}

function readRef(ref: unknown): { relationTo: MenuTargetCollection; value: unknown } | null {
  const relationTo = extractRelationTo(ref)
  if (!isTargetCollection(relationTo)) {
    return null
  }
  const value = (ref as { value?: unknown }).value
  return value === null || value === undefined ? null : { relationTo, value }
}

/**
 * A menüpont közvetlen linkje.
 *
 * - `url` típus: a webcím a CMS-url allowlisten megy át (tiltott séma → null).
 * - `page` / `post` / `product` típus populált céllal: a navigáció útvonal-
 *   képzése + published-jelzés.
 * - csak azonosítós `ref`: `needs-target`, a hívó tölti be a célt.
 * - hiányzó/érvénytelen bemenet vagy origin: null.
 */
export function buildMenuPublicUrl(
  input: MenuPublicUrlInput,
  origin: unknown,
): MenuPublicUrlResult | null {
  const normalizedOrigin = normalizeOrigin(origin)
  if (normalizedOrigin === null) {
    return null
  }

  if (input.type === 'url') {
    const href = sanitizeCmsUrl(input.url)
    if (href === null) {
      return null
    }
    return {
      kind: 'ready',
      href,
      absoluteUrl: toAbsoluteUrl(href, normalizedOrigin),
      // Külső célnak nincs CMS-státusza; a jelzés ezért „ismeretlen".
      targetPublished: null,
    }
  }

  if (input.type !== 'page' && input.type !== 'post' && input.type !== 'product') {
    return null
  }

  const ref = readRef(input.ref)
  if (ref === null) {
    return null
  }

  if (typeof ref.value !== 'object') {
    const id = extractRelationshipId(ref.value)
    return id === null ? null : { kind: 'needs-target', relationTo: ref.relationTo, id }
  }

  const doc = ref.value as Page | Post | Product
  const href = resolveMenuTargetPath(ref.relationTo, doc)
  if (href === null) {
    return null
  }
  return {
    kind: 'ready',
    href,
    absoluteUrl: toAbsoluteUrl(href, normalizedOrigin),
    targetPublished: isPublishedTarget(doc),
  }
}
