import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getPayload } from 'payload'
import { headers } from 'next/headers'
import { cache } from 'react'

import { CoursePlayer } from '@/components/account/CoursePlayer'
import { logger } from '@/lib/logger'
import { resolvePlayerGate, type CourseAccessState } from '@/lib/course-access'
import { lookupPurchaseDates, resolveSingleCourseAccess } from '@/lib/course-access-lookup'
import { fetchWatchedRefs } from '@/lib/course-progress/lookup'
import { buildCurriculum } from '@/lib/curriculum/curriculum'
import { courseTitle, hasUserPurchased, parseCourseIdParam } from '@/lib/courses'
import { signInHref } from '@/lib/return-url'
import type { Product, User } from '@/payload-types'
import { buildPrivatePageMetadata } from '@/lib/seo'

import config from '@payload-config'

// Bejelentkezés mögötti / tranzakciós lap: noindex meta + canonical
// (`src/lib/seo.ts` NOINDEX_ROBOTS — a robots.txt tiltás önmagában nem
// tartja ki az indexből; Google *Block Search indexing with noindex*).
export const metadata: Metadata = buildPrivatePageMetadata({
  title: 'Kurzus lejátszása',
  description: 'A megvett kurzus videóinak lejátszása.',
})

interface KurzusaimPlayerPageProps {
  params: Promise<{ id: string }>
}

const getCourseById = cache(async (id: number): Promise<Product | null> => {
  try {
    const payload = await getPayload({ config })
    return await payload.findByID({ collection: 'products', id, depth: 2, overrideAccess: true })
  } catch (error) {
    logger.warn('lejátszó: kurzus-lekérdezés sikertelen', {
      productId: id,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
})

async function getCurrentUser(): Promise<User | null> {
  try {
    const payload = await getPayload({ config })
    const { user } = await payload.auth({ headers: await headers() })
    return (user as User | null) ?? null
  } catch {
    return null
  }
}

/**
 * /kurzusaim/[id] — a kurzus lejátszóoldala.
 * A lejátszó bemenete a TANANYAG-MODELL (`buildCurriculum`), nem a nyers
 * `videos`/`modules` mezőpár. A modell a szerveren áll össze, mert
 * - a `hasAccess: false` ág ITT szűri ki a Bunny-GUID-okat, tehát a fizetős
 * tartalom azonosítói hozzáférés nélkül BE SEM KERÜLNEK az RSC-payloadba
 * (S2/b) — ezt a kliensre bízni nem lehet, ott már késő;
 */
export default async function KurzusaimPlayerPage({ params }: KurzusaimPlayerPageProps) {
  const { id } = await params
  const courseId = parseCourseIdParam(id)
  if (courseId === null) {
    notFound()
  }

  const user = await getCurrentUser()
  if (user === null) {
    redirect(signInHref(`/kurzusaim/${courseId}`))
  }

  const product = await getCourseById(courseId)
  if (!product || (product.status !== 'published' && product.status !== 'archived')) {
    notFound()
  }

  const payload = await getPayload({ config })
  const purchased = hasUserPurchased(user.purchases, product.id)
  let access: CourseAccessState | null = null
  if (purchased) {
    try {
      access = await resolveSingleCourseAccess({ payload, userId: user.id, product, logger })
    } catch (error) {
      logger.warn('lejátszó: hozzáférés-állapot számítása sikertelen', {
        userId: user.id,
        productId: product.id,
        error: error instanceof Error ? error.message : String(error),
      })
      // A catch NEM hagyhatja access-et nullán. A resolvePlayerGate
      // `purchased: true, access: null` ága hasAccess=true-t ad, és a
      // `buildCurriculum(product, true)` a Bunny-GUID-ot az RSC-payloadba
      // tenné. Ugyanaz a fail-closed állapot, mint a denyOnLookupFailure
      // (unknown-purchase-date): a kapu lookup-failed, nem lejárat.
      access = { hasAccess: false, reason: 'unknown-purchase-date', expiresAt: null }
    }
  }

  let hasPaidOrder = false
  if (!purchased) {
    const lookup = await lookupPurchaseDates({
      payload,
      userId: user.id,
      productIds: [product.id],
      logger,
    })
    hasPaidOrder = !lookup.failed && lookup.dates.has(product.id)
  }

  const resolved = resolvePlayerGate({ purchased, access, hasPaidOrder })
  if (resolved.hasAccess === false && resolved.gate.kind === 'expired') {
    logger.info('lejátszó: lejárt hozzáférés, a videók nem indíthatók', {
      userId: user.id,
      productId: product.id,
      expiresAt: access?.expiresAt?.toISOString() ?? null,
    })
  }

  const hasAccess = resolved.hasAccess
  const watchedRefs = hasAccess ? await getWatchedRefs(user.id, product.id) : []
  const curriculum = buildCurriculum(product, hasAccess)

  return (
    <CoursePlayer
      curriculum={curriculum}
      expiredMessage={resolved.gate?.message ?? null}
      gateKind={resolved.gate?.kind}
      hasAccess={hasAccess}
      product={{
        id: product.id,
        slug: product.slug ?? null,
        title: courseTitle(product),
      }}
      watchedRefs={watchedRefs}
    />
  )
}

/**
 * A már megnézettként jelölt videók refjei (E1). Kényelmi adat: lekérdezési
 * hiba esetén üres lista megy a lejátszóba (a `fetchWatchedRefs` maga is
 * fail-open) — a haladás jelzése sosem akadályozhatja meg a lejátszást.
 */
async function getWatchedRefs(userId: number, productId: number): Promise<string[]> {
  try {
    const payload = await getPayload({ config })
    const byProduct = await fetchWatchedRefs({
      payload,
      userId,
      productIds: [productId],
      logger,
    })
    return [...(byProduct.get(productId) ?? [])]
  } catch (error) {
    logger.warn('lejátszó: a kurzus-haladás betöltése sikertelen', {
      userId,
      productId,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}
