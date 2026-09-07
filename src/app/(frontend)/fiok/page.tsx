import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import { headers } from 'next/headers'

import { Container } from '@/components/ui/Container'
import { Section } from '@/components/ui/Section'
import { AccountView } from '@/components/account/AccountView'
import { logger } from '@/lib/logger'
import { toCourseAccessView, type CourseAccessView } from '@/lib/course-access'
import { resolveCourseAccessForUser } from '@/lib/course-access-lookup'
import { signInHref } from '@/lib/return-url'
import type { Order, Product, User } from '@/payload-types'
import { buildPrivatePageMetadata } from '@/lib/seo'

import config from '../../../payload.config'

// Bejelentkezés mögötti / tranzakciós lap: noindex meta + canonical
// (`src/lib/seo.ts` NOINDEX_ROBOTS — a robots.txt tiltás önmagában nem
// tartja ki az indexből; Google *Block Search indexing with noindex*).
export const metadata: Metadata = buildPrivatePageMetadata({
  title: 'Fiókom',
  description: 'Adataim, rendeléseim és a megvett kurzusaim egy helyen.',
  path: '/fiok',
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

async function getUserOrders(userId: number): Promise<Order[]> {
  try {
    const payload = await getPayload({ config })
    const { docs } = await payload.find({
      collection: 'orders',
      where: { customer: { equals: userId } },
      sort: '-createdAt',
      depth: 1,
      limit: 50,
      overrideAccess: true,
    })
    return docs
  } catch (error) {
    logger.warn('fiók: rendelés-lekérdezés sikertelen', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

/**
 * A megvett kurzusok hozzáférés-állapota (A1) — a lejárat forrása egységesen az
 * src/lib/course-access.ts. Korlátlan (accessDurationDays nélküli) kurzusoknál
 * nem indul extra lekérdezés.
 */
async function getAccessViews(user: User): Promise<Record<number, CourseAccessView>> {
  const products = (user.purchases ?? []).filter(
    (entry): entry is Product => typeof entry === 'object' && entry !== null,
  )
  const views: Record<number, CourseAccessView> = {}
  if (products.length === 0) {
    return views
  }
  try {
    const payload = await getPayload({ config })
    const states = await resolveCourseAccessForUser({
      payload,
      userId: user.id,
      products,
      logger,
    })
    for (const [productId, state] of states) {
      views[productId] = toCourseAccessView(state)
    }
  } catch (error) {
    logger.warn('fiók: hozzáférés-állapot számítása sikertelen', {
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return views
}

/**
 * /fiok — a felhasználó fiókja (adataim, rendeléseim, kurzusaim).
 */
export default async function FiokPage() {
  const user = await getCurrentUser()
  if (user === null) {
    redirect(signInHref('/fiok'))
  }

  const [orders, accessByProductId] = await Promise.all([
    getUserOrders(user.id),
    getAccessViews(user),
  ])

  return (
    <Section>
      <Container>
        <h1>Fiókom</h1>
        <AccountView accessByProductId={accessByProductId} user={user} orders={orders} />
      </Container>
    </Section>
  )
}
