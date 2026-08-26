import type { Metadata } from 'next'
import Link from 'next/link'
import { getPayload } from 'payload'
import { headers } from 'next/headers'

import { Container } from '@/components/ui/Container'
import { Section } from '@/components/ui/Section'
import { CartView } from '@/components/checkout/CartView'
import type { CartItem, CartItemAvailability } from '@/lib/cart'
import { logger } from '@/lib/logger'
import {
  coursePriceHuf,
  courseTitle,
  hasUserPurchased,
  isFreeCourse,
  isPaidCourse,
} from '@/lib/courses'
import type { Product, User } from '@/payload-types'

import config from '../../../payload.config'

export const metadata: Metadata = {
  title: 'Kosár',
  description: 'A kosarad tartalma: ellenőrizd a tételeket, és menj tovább a fizetéshez.',
}

interface KosarPageProps {
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
    logger.warn('kosár: termék-lekérdezés sikertelen', { productId: id, error: error instanceof Error ? error.message : String(error) })
    return null
  }
}

/**
 * A tétel VÁSÁROLHATÓSÁGA — a kurzusoldal CTA-állapotgépével AZONOS sorrendben.
 * A sorrend nem közömbös: az archivált termék akkor sem igényelhető és nem
 * vehető meg, ha egyébként ingyenesnek van jelölve, ezért az archivált ág dönt
 * először (ugyanaz a sorrend, mint a `resolveCourseCta`-ban és a /penztar
 * kapuiban). A „fizetős" feltétel az `isPaidCourse` (ÉRVÉNYES ár), NEM a
 * `!isFreeCourse`: a `priceInHUFEnabled: true` + üres/0/negatív ár, illetve a
 */
function resolveCartAvailability(
  product: Pick<Product, 'status' | 'priceInHUF' | 'priceInHUFEnabled'>,
): CartItemAvailability {
  if (product.status === 'archived') {
    return 'archived'
  }
  if (isFreeCourse(product)) {
    return 'free'
  }
  return isPaidCourse(product) ? 'paid' : 'unavailable'
}

/**
 * /kosar — a kosár megjelenítése.
 * A tényleges tételek a kliens-oldali cart-state-ből jönnek (egy termék =
 * egy vásárlás), de a kosár-oldal a /penztar?termek={id} konvenciót is
 * fogadja: ha a query-ben termék van, azt a listához adjuk (a kliens-state
 * is kezeli a duplikációt). A végösszeg MINDIG a szerver (T-021) válaszából
 * igazolódik vissza a checkout során.
 */
export default async function KosarPage({ searchParams }: KosarPageProps) {
  const params = await searchParams
  const user = await getCurrentUser()

  // A /penztar?termek={id} → /kosar?termek={id} átirányítás is megérkezhet:
  // a terméket a kosár-oldalra irányítjuk, ahol a kliens a kosárhoz adja.
  const termekParam = params.termek
  const termekId =
    typeof termekParam === 'string' && /^\d+$/.test(termekParam.trim())
      ? Number(termekParam.trim())
      : null

  let termekItem: CartItem | null = null
  if (termekId !== null) {
    const product = await getProductById(termekId)
    if (product && (product.status === 'published' || product.status === 'archived')) {
      const price = coursePriceHuf(product)
      termekItem = {
        productId: product.id,
        sku: courseTitle(product),
        slug: product.slug ?? null,
        shortDescription: product.shortDescription ?? null,
        priceHuf: price,
        // Az „ingyenes" EGYETLEN igazságforrása a courses.ts (a fejkommentje
        // szerint „Új fogyasztó is KIZÁRÓLAG innen kérdezze") — a korábbi
        // inline `priceInHUFEnabled === false` másolat pont az a negyedik
        // igazság volt, amit a 2026-08-16-i átvizsgálás felszámolt.
        isFree: isFreeCourse(product),
        availability: resolveCartAvailability(product),
      }
    }
  }

  const alreadyPurchased =
    user !== null && termekItem !== null && hasUserPurchased(user.purchases, termekItem.productId)

  return (
    <Section>
      <Container size="narrow">
        <h1>Kosár</h1>
        {alreadyPurchased ? (
          <div className="kc-cart-notice" role="status">
            <p>Ezt a kurzust már megvetted, a <Link href="/kurzusaim">Kurzusaim</Link> oldalon éred el.</p>
          </div>
        ) : null}
        <CartView initialItem={termekItem} isLoggedIn={user !== null} />
      </Container>
    </Section>
  )
}
