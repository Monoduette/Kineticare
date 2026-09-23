import type { DefaultServerCellComponentProps, Payload } from 'payload'
import { cache, type JSX } from 'react'

import {
  NEM_MEGALLAPITHATO,
  velemenyHelye,
  velemenyHelyeFelirat,
  type HelyListaElem,
  type HelyOldal,
} from '../../lib/admin/velemeny-helye'
import { logger } from '../../lib/logger'

/**
 * A Vélemények lista „Hol látszik” oszlopa (modul-térkép H43/4). A szabály és
 * a források: src/lib/admin/velemeny-helye.ts.
 *
 * SZERVERKOMPONENS, a PageKindCell bekötésével (`type: 'ui'` mező, csak Cell
 * komponenssel). A Payload a szerveroldali cellának átadja a `payload`
 * példányt és a sor teljes dokumentumát (`rowData`), lásd
 * DefaultServerCellComponentProps (payload/dist/admin/elements/Cell.d.ts) és
 * @payloadcms/ui dist/providers/TableColumns/buildColumnState/renderCell.js
 * (`cellServerProps`).
 *
 * KÉT LEKÉRDEZÉS KÉRÉSENKÉNT, nem soronként. A React `cache` a szerveren egy
 * kérés idejére jegyzi meg az eredményt ugyanarra az argumentumra; a kulcs a
 * `payload` példány, ami a kérés minden sorában ugyanaz. A hibát is a
 * megjegyzett érték viszi (null), így egy hibás kérés egyszer naplóz, nem
 * soronként. https://react.dev/reference/react/cache
 */

/**
 * (a) A weboldal véleménylistája: BETŰRE a src/lib/cms.ts `getTestimonials`
 * lekérdezése (a testimonials-admin.test.ts a forrásszöveggel köti össze).
 */
export const VELEMENY_LEKERDEZES = {
  collection: 'testimonials',
  where: { visible: { equals: true }, featured: { equals: true } },
  limit: 3,
  sort: 'order',
  depth: 0,
  overrideAccess: true,
} as const

/**
 * (b) A közzétett oldalak: a weboldal a `status: 'published'` változatot
 * rendereli, `draft: false`-szal (cms.ts `getPageBySlug`, `PUBLISHED_WHERE`).
 * Csak a helyhez kellő mezők, lapozás nélkül.
 */
export const OLDAL_LEKERDEZES = {
  collection: 'pages',
  where: { status: { equals: 'published' } },
  depth: 0,
  draft: false,
  pagination: false,
  overrideAccess: true,
  select: { slug: true, title: true, layout: true },
} as const

type CellaPayload = Pick<Payload, 'find'>

function hibaSzovege(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * A weboldal első három véleménye {id, order} párokként, az adatbázis
 * sorrendjében; hibánál null. A rangot a velemeny-helye.ts `sorrendSzerint`
 * számolja, a szekció rendezésével (az üres Sorrend ott 0, a Postgres
 * viszont a végére teszi).
 */
const elsoHaromBetoltese = cache(async (payload: CellaPayload): Promise<HelyListaElem[] | null> => {
  try {
    const { docs } = await payload.find({ ...VELEMENY_LEKERDEZES })
    return docs.map((doc) => ({ id: doc.id, order: doc.order }))
  } catch (error) {
    logger.warn('Vélemények lista: a weboldal véleménylistája nem tölthető be', {
      error: hibaSzovege(error),
    })
    return null
  }
})

/** A közzétett oldalak webcíme, címe és szekciósora; hibánál null. */
const kozzetettOldalakBetoltese = cache(
  async (payload: CellaPayload): Promise<HelyOldal[] | null> => {
    try {
      const { docs } = await payload.find({
        ...OLDAL_LEKERDEZES,
        where: { ...OLDAL_LEKERDEZES.where },
        select: { ...OLDAL_LEKERDEZES.select },
      })
      return docs.map((doc) => ({ slug: doc.slug, title: doc.title, layout: doc.layout }))
    } catch (error) {
      logger.warn('Vélemények lista: a közzétett oldalak nem tölthetők be', {
        error: hibaSzovege(error),
      })
      return null
    }
  },
)

export interface TestimonialPlacementCellProps {
  payload?: CellaPayload
  rowData?: DefaultServerCellComponentProps['rowData']
}

function mezo(rowData: unknown, kulcs: 'id' | 'featured' | 'visible'): unknown {
  return typeof rowData === 'object' && rowData !== null
    ? (rowData as Record<string, unknown>)[kulcs]
    : undefined
}

/** A cella szövege; hibánál „Nem sikerült megállapítani”. */
export async function velemenyHelyeCellaSzoveg({
  payload,
  rowData,
}: TestimonialPlacementCellProps): Promise<string> {
  if (!payload) {
    logger.warn('Vélemények lista: a cella nem kapott payload példányt')
    return NEM_MEGALLAPITHATO
  }
  const [elsoHarom, oldalak] = await Promise.all([
    elsoHaromBetoltese(payload),
    kozzetettOldalakBetoltese(payload),
  ])
  if (elsoHarom === null || oldalak === null) {
    return NEM_MEGALLAPITHATO
  }
  return velemenyHelyeFelirat(
    velemenyHelye({
      velemeny: {
        id: mezo(rowData, 'id'),
        featured: mezo(rowData, 'featured'),
        visible: mezo(rowData, 'visible'),
      },
      elsoHarom,
      oldalak,
    }),
  )
}

export async function TestimonialPlacementCell(
  props: TestimonialPlacementCellProps,
): Promise<JSX.Element> {
  return <span className="kc-velemeny-helye">{await velemenyHelyeCellaSzoveg(props)}</span>
}
