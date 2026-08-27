import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import { headers } from 'next/headers'

import { Container } from '@/components/ui/Container'
import { Section } from '@/components/ui/Section'
import { CourseList } from '@/components/account/CourseList'
import {
  buildCourseCardView,
  courseListSummary,
  type CourseCardView,
} from '@/components/account/course-list-order'
import { toCourseAccessView, type CourseAccessView } from '@/lib/course-access'
import { resolveCourseAccessForUser } from '@/lib/course-access-lookup'
import { fetchWatchedRefs } from '@/lib/course-progress/lookup'
import { buildCurriculum } from '@/lib/curriculum/curriculum'
import { courseHref } from '@/lib/course-url'
import { courseCover, courseTitle } from '@/lib/courses'
import { signInHref } from '@/lib/return-url'
import { logger } from '@/lib/logger'
import { loadPurchasedProducts } from '@/lib/purchased-products'
import type { Product, User } from '@/payload-types'

import config from '../../../payload.config'

export const metadata: Metadata = {
  title: 'Kurzusaim',
  description: 'A megvett kurzusaid és a lejátszásaid egy helyen.',
}

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
 * A megvett kurzusok hozzáférés-állapota (A1) — a lejárat forrása egységesen az
 * src/lib/course-access.ts. Hiba esetén üres térkép: a lista ilyenkor a mai,
 * korlátlan viselkedést mutatja (a vevőt egy lekérdezési hiba nem zárhatja ki).
 */
async function getAccessViews(
  userId: number,
  products: Product[],
): Promise<Record<number, CourseAccessView>> {
  const views: Record<number, CourseAccessView> = {}
  try {
    const payload = await getPayload({ config })
    const states = await resolveCourseAccessForUser({ payload, userId, products, logger })
    for (const [productId, state] of states) {
      views[productId] = toCourseAccessView(state)
    }
  } catch (error) {
    logger.warn('kurzusaim: hozzáférés-állapot számítása sikertelen', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return views
}

/**
 * A késznek jelölt leckék refjei kurzusonként.
 *
 * FAIL-OPEN: a `fetchWatchedRefs` maga is üres térképpel tér vissza lekérdezési
 * hibánál; ez a burkoló a `getPayload` hibáját fogja el ugyanígy. A haladás
 * jelzése kényelmi funkció — egy adatbázis-akadás miatt a vevő ne veszítse el a
 * kurzuslistáját: ilyenkor minden kurzus „el nem kezdett"-ként jelenik meg, és a
 * következő oldalletöltés helyreteszi.
 */
async function getWatchedRefs(
  userId: number,
  products: Product[],
): Promise<Map<number, Set<string>>> {
  if (products.length === 0) {
    return new Map()
  }
  try {
    const payload = await getPayload({ config })
    return await fetchWatchedRefs({
      payload,
      userId,
      productIds: products.map((product) => product.id),
      logger,
    })
  } catch (error) {
    logger.warn('kurzusaim: a kurzus-haladás betöltése sikertelen', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    })
    return new Map()
  }
}

/**
 * A kártya-nézetek összeállítása — a szerveren, EGY helyen.
 *
 * A haladás forrása KIZÁRÓLAG a tananyag-modell (`buildCurriculum` +
 * `summarizeCurriculum`), ugyanaz, amiből a lejátszó dolgozik: így a listán és a
 * lejátszóban definíció szerint ugyanaz a szám áll.
 *
 * A kártya CÉLJA a hozzáféréstől függ: élő hozzáférésnél a védett lejátszó
 * (azonosító alapján), lejárt hozzáférésnél a NYILVÁNOS kurzusoldal (slug
 * alapján) — a lejátszó ilyenkor úgysem indulna el, a stream-token 403-at ad.
 */
function buildCards(
  products: Product[],
  accessByProductId: Record<number, CourseAccessView>,
  watchedByProduct: Map<number, Set<string>>,
): CourseCardView[] {
  return products.map((product) => {
    const access = accessByProductId[product.id]
    // Hiányzó hozzáférés-bejegyzés = korlátlan hozzáférés (a lekérdezés
    // fail-open ága is ide fut be).
    const hasAccess = access?.hasAccess !== false
    return buildCourseCardView({
      productId: product.id,
      title: courseTitle(product),
      href: hasAccess ? `/kurzusaim/${product.id}` : courseHref(product),
      cover: courseCover(product),
      curriculum: buildCurriculum(product, hasAccess),
      watchedRefs: watchedByProduct.get(product.id) ?? [],
      hasAccess,
      expiryLabel: access?.expiryLabel ?? null,
      expiredMessage: access?.expiredMessage ?? null,
    })
  })
}

/**
 * /kurzusaim — a belépés utáni ELSŐ képernyő: a megvett kurzusok
 * (`users.purchases`) állapot-kártyái, a hozzáférés lejáratával (A1) és a
 * tananyag-alapú haladással.
 */
export default async function KurzusaimPage() {
  const user = await getCurrentUser()
  if (user === null) {
    redirect(signInHref('/kurzusaim'))
  }

  const payload = await getPayload({ config })
  const products = await loadPurchasedProducts({ payload, purchases: user.purchases })

  const accessByProductId = await getAccessViews(user.id, products)
  const watchedByProduct = await getWatchedRefs(user.id, products)
  const cards = buildCards(products, accessByProductId, watchedByProduct)
  // Egyetlen kurzusnál az összegzés nem mond semmit, amit a kártya ne mondana
  // el — ott a fejléc a puszta címre szorítkozik.
  const summary = courseListSummary(cards)

  return (
    <Section>
      <Container>
        <header className="kc-mycourses__header">
          <h1 className="kc-mycourses__heading">Kurzusaim</h1>
          {summary === null ? null : <p className="kc-mycourses__summary-line">{summary}</p>}
        </header>
        <CourseList cards={cards} />
      </Container>
    </Section>
  )
}
