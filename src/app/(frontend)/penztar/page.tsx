import type { Metadata } from 'next'
import Link from 'next/link'
import { getPayload } from 'payload'
import { headers } from 'next/headers'

import { TrackEvent } from '@/components/analytics/TrackEvent'
import { Button } from '@/components/ui/Button'
import { Container } from '@/components/ui/Container'
import { Section } from '@/components/ui/Section'
import { CheckoutForm } from '@/components/checkout/CheckoutForm'
import { resolveSingleCourseAccess } from '@/lib/course-access-lookup'
import { courseCtaHref } from '@/lib/course-url'
import { ctaLabel } from '@/lib/cta-vocabulary'
import {
  FREE_COURSE_ALREADY_GRANTED_TEXT,
  FREE_COURSE_NOT_CHECKOUT_TEXT,
} from '@/lib/free-course/ui-text'
import { logger } from '@/lib/logger'
import {
  UNAVAILABLE_COURSE_NOTE,
  coursePriceHuf,
  courseTitle,
  hasUserPurchased,
  isFreeCourse,
  isPaidCourse,
  myCoursePlayerHref,
} from '@/lib/courses'
import type { Product, User } from '@/payload-types'
import { buildPrivatePageMetadata } from '@/lib/seo'

import config from '../../../payload.config'

// Bejelentkezés mögötti / tranzakciós lap: noindex meta + canonical
// (`src/lib/seo.ts` NOINDEX_ROBOTS — a robots.txt tiltás önmagában nem
// tartja ki az indexből; Google *Block Search indexing with noindex*).
export const metadata: Metadata = buildPrivatePageMetadata({
  title: 'Pénztár',
  description: 'A vásárlás befejezése: számlázási adatok és a digitális tartalom elállási joga.',
  path: '/penztar',
})

interface PenztarPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
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

async function getProductById(id: number): Promise<Product | null> {
  try {
    const payload = await getPayload({ config })
    return await payload.findByID({ collection: 'products', id, depth: 1, overrideAccess: true })
  } catch (error) {
    logger.warn('penztár: termék-lekérdezés sikertelen', {
      productId: id,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

async function hasLiveAccess(userId: number, product: Product): Promise<boolean> {
  try {
    const payload = await getPayload({ config })
    const access = await resolveSingleCourseAccess({ payload, userId, product, logger })
    return access.hasAccess
  } catch (error) {
    logger.warn('pénztár: hozzáférés-állapot számítása sikertelen', {
      userId,
      productId: product.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return true
  }
}

/**
 * /penztar — a vásárlás befejezése.
 */
export default async function PenztarPage({ searchParams }: PenztarPageProps) {
  const params = await searchParams
  const user = await getCurrentUser()

  const termekParam = params.termek
  const termekId =
    typeof termekParam === 'string' && /^\d+$/.test(termekParam.trim())
      ? Number(termekParam.trim())
      : null

  // A termék meghatározása: KIZÁRÓLAG a query (a kosár kliens-oldali; a
  // /kosar oldal CartView-je teszi a termék-id-t a pénztár-linkbe — M8).
  let product: Product | null = null
  if (termekId !== null) {
    product = await getProductById(termekId)
  }

  if (!product || (product.status !== 'published' && product.status !== 'archived')) {
    return (
      <Section>
        <Container size="narrow">
          <h1>Pénztár</h1>
          <div className="kc-cart-empty" role="status">
            <p>Nincs kiválasztott termék a fizetéshez.</p>
            {/* A felirat a §3.2 #10 szótári sora: ugyanaz a cselekvés (a
                kurzuslistára lépés) a lap MINDEN végállapotában ugyanazt a
                szót kapja (WCAG 2.2 SC 3.2.4). A korábbi „Válassz kurzust"
                a `docs/gomb-inventar.md` A/6 megállapítása szerint a nyolc
                párhuzamos felirat egyike volt. */}
            <Link className="kc-button kc-button--primary" href="/kurzusok">
              {ctaLabel('course-list-open')}
            </Link>
          </div>
        </Container>
      </Section>
    )
  }

  // Archivált terméknél az űrlap helyett tiszta tájékoztató állapot: a beküldés
  // úgyis 400-zal hasalna el („Ez a kurzus jelenleg nem vásárolható meg."),
  // a díszlet-űrlap pedig a néma hiba kínosabbik fajtája.
  if (product.status === 'archived') {
    return (
      <Section>
        <Container size="narrow">
          <h1>Pénztár</h1>
          <div className="kc-cart-empty" role="status">
            <p>Ez a kurzus jelenleg nem vásárolható meg.</p>
            <Link className="kc-button kc-button--primary" href="/kurzusok">
              {ctaLabel('course-list-open')}
            </Link>
          </div>
        </Container>
      </Section>
    )
  }

  // Vendégként nincs mit összevetni: a „már megvetted" állapotot a szerver a
  // fizetés indításakor (e-mail alapján) is ellenőrzi, 409-cel.
  const alreadyPurchased =
    user !== null &&
    hasUserPurchased(user.purchases, product.id) &&
    (await hasLiveAccess(user.id, product))
  const price = coursePriceHuf(product)
  const isFree = isFreeCourse(product)

  /**
   * A HIBA, AMIT BEZÁR. A `/penztar?termek=<ingyenes-id>` eddig teljes értékű
   * MIÉRT ÁLLAPOT ÉS NEM ÁTIRÁNYÍTÁS. Ugyanaz az érv, amit a fenti archivált ág
   */
  if (isFree) {
    return (
      <Section>
        <Container size="narrow">
          <h1>Pénztár</h1>
          <div className="kc-cart-empty" role="status">
            <p>
              {alreadyPurchased ? FREE_COURSE_ALREADY_GRANTED_TEXT : FREE_COURSE_NOT_CHECKOUT_TEXT}
            </p>
            <Button
              href={alreadyPurchased ? myCoursePlayerHref(product.id) : courseCtaHref(product)}
              variant={alreadyPurchased ? 'primary' : 'secondary'}
            >
              {ctaLabel(alreadyPurchased ? 'course-start' : 'free-course-claim')}
            </Button>
          </div>
        </Container>
      </Section>
    )
  }

  /**
   * A HIBA, AMIT BEZÁR. A fenti ingyenes-kapu feltétele az `isFreeCourse`,
   * `courses.ts` fejkommentje szerint a „fizetős" és az „ingyenes" NEM egymás
   */
  if (!isPaidCourse(product)) {
    return (
      <Section>
        <Container size="narrow">
          <h1>Pénztár</h1>
          <div className="kc-cart-empty" role="status">
            <p>{UNAVAILABLE_COURSE_NOTE}</p>
            <Link className="kc-button kc-button--primary" href="/kurzusok">
              {ctaLabel('course-list-open')}
            </Link>
          </div>
        </Container>
      </Section>
    )
  }

  return (
    <Section>
      <Container size="narrow">
        {/* PostHog funnel-lépés: a pénztár megnyitása (no-op consent nélkül). */}
        <TrackEvent
          event="checkout_started"
          properties={{ courseId: product.id, courseSku: product.sku ?? undefined }}
        />
        <h1>Pénztár</h1>
        {alreadyPurchased ? (
          <div className="kc-cart-notice" role="status">
            <p>Ezt a kurzust már megvetted. A lejátszóban éred el, új rendelés nem kell.</p>
          </div>
        ) : null}
        <CheckoutForm
          product={{
            id: product.id,
            sku: courseTitle(product),
            priceHuf: price,
            isFree,
          }}
          user={
            user === null
              ? null
              : {
                  name: user.name,
                  email: user.email,
                  billingName: user.billingName,
                  billingZip: user.billingZip,
                  billingCity: user.billingCity,
                  billingStreet: user.billingStreet,
                  taxNumber: user.taxNumber,
                }
          }
          alreadyPurchased={alreadyPurchased}
        />
      </Container>
    </Section>
  )
}
