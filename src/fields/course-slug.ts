import type { FieldHook, TextField } from 'payload'

import {
  buildCourseSlug,
  courseSlugSource,
  isNumberedVariantOf,
  nextFreeCourseSlug,
} from '../lib/course-url'
import { logger } from '../lib/logger'

/**
 * A kurzus (products) webcím-mezője (C3).
 *
 * Miért nem a közös `slugField()` (src/fields/slug.ts):
 * - a products collectionnek nincs `title` mezője, a forrás a `displayTitle` →
 *   `sku` lánc;
 * - a mező NEM `required`: a bevezetés előtti sorokban NULL marad (a Payload a
 *   required mezőből NOT NULL oszlopot generálna, ami meglévő adat mellett
 *   megbukna). A slug nélküli kurzus a régi, id-alapú URL-en marad elérhető —
 *   a route ezt kiszolgálja;
 * - ütközésnél a slug SORSZÁMOZÓDIK (`-2`, `-3`…) ahelyett, hogy a mentés
 *   unique-hibára futna: a kurzusok neve gyakran hasonló, és a szerkesztőt nem
 *   szabad kézi webcím-ütköztetésre kényszeríteni.
 */

/** Szövegmező kiolvasása ismeretlen alakú hook-adatból (`any` nélkül). */
function readText(source: unknown, key: string): string | null {
  if (typeof source !== 'object' || source === null) {
    return null
  }
  const value = (source as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : null
}

/** A dokumentum azonosítója az eredeti (update előtti) dokumentumból; create-nél null. */
function readId(source: unknown): number | null {
  if (typeof source !== 'object' || source === null) {
    return null
  }
  const value = (source as Record<string, unknown>).id
  return typeof value === 'number' ? value : null
}

/**
 * A dokumentum címéből (displayTitle → sku) automatikusan adódó slug —
 * `data` (a mentendő adat) elsőbbséggel, hiányzó mezőnél az eredeti dokumentum.
 */
function autoSlugFrom(source: unknown, fallback: unknown): string | null {
  return buildCourseSlug(
    courseSlugSource({
      displayTitle: readText(source, 'displayTitle') ?? readText(fallback, 'displayTitle'),
      sku: readText(source, 'sku') ?? readText(fallback, 'sku'),
    }),
  )
}

/**
 * Slug hook: változatlan → skip; kézi slug marad; üres → displayTitle→sku;
 * részleges update → meglévő marad (publikált/archivált URL fagyott). Draftnál
 * automatikus slug követi a címet, kézi slugot nem ír felül.
 */
const generateCourseSlug: FieldHook = async ({ data, originalDoc, req, value }) => {
  const typed = typeof value === 'string' ? value.trim() : ''
  const previous = readText(originalDoc, 'slug')?.trim() ?? ''

  if (typed.length > 0 && typed === previous) {
    return previous
  }

  let base: string | null
  if (typed.length > 0) {
    base = buildCourseSlug(typed)
  } else {
    const auto = autoSlugFrom(data, originalDoc)
    if (previous.length > 0) {
      const status = readText(data, 'status') ?? readText(originalDoc, 'status')
      const previousAuto = autoSlugFrom(originalDoc, null)
      // A cím-követés csak addig él, amíg a kurzus egyszer sem volt élő URL:
      // a published MELLETT az archived is fagyasztja a slugot (élő, linkelt
      // oldal — a `status === 'draft'` helyett tagadó alak, hogy a hiányzó/
      // ismeretlen státusz a mai, címkövető viselkedést tartsa meg).
      const slugFollowsTitle =
        status !== 'published' &&
        status !== 'archived' &&
        previousAuto !== null &&
        isNumberedVariantOf(previous, previousAuto)
      // A cím változatlan (vagy a slugja ugyanaz) → felesleges lekérdezés nélkül marad.
      if (!slugFollowsTitle || auto === null || isNumberedVariantOf(previous, auto)) {
        return previous
      }
    }
    base = auto
  }

  if (base === null) {
    // Se cím, se azonosító: a kurzus slug nélkül marad (régi, id-alapú URL).
    return null
  }

  const currentId = readId(originalDoc)
  try {
    const existing = await req.payload.find({
      collection: 'products',
      depth: 0,
      limit: 1000,
      overrideAccess: true,
      select: { slug: true },
      // A kukába tett (soft-deleted) kurzus sora — és vele a slugja — a
      // táblában marad, tehát a unique indexet TOVÁBBRA IS foglalja. Ha
      // kihagynánk, a mentés a DB-nél bukna el unique-hibával.
      trash: true,
      where:
        currentId === null
          ? { slug: { contains: base } }
          : { and: [{ slug: { contains: base } }, { id: { not_equals: currentId } }] },
    })
    const taken = existing.docs
      .map((doc) => (typeof doc.slug === 'string' ? doc.slug : null))
      .filter((slug): slug is string => slug !== null && isNumberedVariantOf(slug, base))
    return nextFreeCourseSlug(base, taken)
  } catch (error) {
    // A foglaltság-lekérdezés hibája nem akaszthatja meg a mentést: a séma
    // unique indexe a kettőzés ellen így is véd.
    logger.warn('kurzus-slug foglaltság-ellenőrzés sikertelen — az alap slug marad', {
      slug: base,
      error: error instanceof Error ? error.message : String(error),
    })
    return base
  }
}

export const courseSlugField: TextField = {
  name: 'slug',
  type: 'text',
  unique: true,
  index: true,
  label: 'Webcím',
  admin: {
    description:
      'A kurzus linkjének vége, pl. a kineticare.hu/kurzusok/kezrehabilitacio-otthon címben a „kezrehabilitacio-otthon”. A kurzus címéből magától kitöltődik, ékezetek nélkül, kötőjelekkel; ha már foglalt, sorszám kerül a végére. Ha átírod, a régi link nem működik tovább.',
  },
  hooks: {
    beforeValidate: [generateCourseSlug],
  },
}
