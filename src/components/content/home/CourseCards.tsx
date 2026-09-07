import type { Product } from '../../../payload-types'
import { isPaidCourse } from '../../../lib/courses'
import { Container } from '../../ui/Container'
import { Section } from '../../ui/Section'
import { ProductCard } from '../ProductCard'

import '../../../app/(frontend)/styles/blocks/course-cards.css'

/**
 * CourseCards: a FIZETŐS kurzusok kiemelése a hitel-csík után (ProductCard
 * alapú, örökölt rács). A kezdőlapi Kurzusaink galéria ma a CourseShowcase;
 * annak tételeit a `showcaseProducts` (src/lib/course-showcase.ts) adja,
 * 2026-09-07-től az igazolt ingyenes SOS-szal együtt.
 */

/** Felvezető sor — a `courseCards` blokk `eyebrow` mezője írja felül. */
export const DEFAULT_EYEBROW = 'Kurzusok'

/**
 * Szekciócím-fallback.
 *
 * SZÁNDÉKOSAN NEM „Így tudunk neked segíteni": az élő kezdőlapon az a cím
 * ütközött a Szolgáltatások szekció „Így tudunk segíteni" címével — két,
 * majdnem betűre azonos H2 ugyanazon a lapon (kezdőlap-audit, 2026-08-15).
 * A csere emellett a szekció DOLGÁT mondja ki: ez a blokk nem segítséget
 * ígér, hanem a megvásárolható kínálatot sorolja fel (UX-skill 1. pont: ami
 * pénzt hoz, az világos névvel, árral és CTA-val áll ki).
 */
export const DEFAULT_HEADING = 'Kurzusaink'

/** Bevezető-fallback — a blokk `lead` mezője írja felül. */
export const DEFAULT_LEAD =
  'Online kézrehabilitációs kurzusaink lépésről lépésre vezetnek végig az otthoni felépülésen.'

/**
 * Kiemelt (vízszintes) kártyát kap-e a szekció ennyi kurzusnál.
 *
 * A küszöb szándékosan EGY: kettőtől már van mit összehasonlítani, és a rács
 * két hasábja tölti a szekció szélességét. Külön exportált, hogy a szabályt
 * teszt közvetlenül rögzíthesse.
 */
export function usesFeaturedCard(productCount: number): boolean {
  return productCount === 1
}

/**
 * Fizetős-e a termék — az ÁR-MEGJELENÍTÉS szabályával azonos feltétel, egyetlen
 * forrásból (`isPaidCourse`, src/lib/courses.ts). A viselkedés változatlan
 * (érvényes ár = fizetős); a közös forrás azt zárja ki, hogy a kezdőlap és a
 * kurzusoldal ítélete szétcsússzon.
 *
 * FIGYELEM: a `!isPaidProduct` NEM jelent „ingyenes"-t — a hiányosan
 * konfigurált termék egyik halmazba sem tartozik. Ingyenességre az
 * `isFreeCourse` a helyes kérdés; a kezdőlapi rácsba az ingyenes SOS csak az
 * `isAvailableSosProduct` igazolásával kerül (`showcaseProducts`), ez a
 * függvény tehát már NEM a rács egyetlen beléptető szűrője (WP12).
 */
export function isPaidProduct(product: {
  priceInHUFEnabled?: boolean | null
  priceInHUF?: number | null
}): boolean {
  return isPaidCourse(product as Pick<Product, 'priceInHUF' | 'priceInHUFEnabled'>)
}

export interface CourseCardsProps {
  /** A fizetős kurzusok — a rács kizárólag ezeket jeleníti meg. */
  products: Product[]
  /** Felvezető-felülírás a `courseCards` blokkból — üresen a beépített marad. */
  eyebrow?: string
  /** Cím-felülírás a `courseCards` blokkból — üresen a beépített cím marad. */
  heading?: string
  /** Bevezető-felülírás a blokkból — üresen a beépített szöveg marad. */
  lead?: string
  /** A kártyák dekoratív CTA-gombjának felirata a blokkból. */
  ctaLabel?: string
  /**
   * Horgony. Alapból „kurzusok" — a sticky nav /#kurzusok linkje erre épül,
   * ezért az alapérték felülírásakor a navigáció célját is ellenőrizni kell.
   */
  id?: string
  variant?: 'default' | 'tint' | 'dark'
}

export function CourseCards({
  products,
  eyebrow,
  heading,
  lead,
  ctaLabel,
  id = 'kurzusok',
  variant = 'default',
}: CourseCardsProps) {
  if (products.length === 0) {
    return null
  }

  const eyebrowText = eyebrow?.trim() || DEFAULT_EYEBROW
  const title = heading?.trim() || DEFAULT_HEADING
  const leadText = lead?.trim() || DEFAULT_LEAD
  const featured = usesFeaturedCard(products.length)

  return (
    <Section className="kc-course-cards" id={id} variant={variant}>
      <Container>
        <div className="kc-course-cards__head">
          <p className="kc-eyebrow">{eyebrowText}</p>
          <h2 className="kc-section-title">{title}</h2>
          <p className="kc-section-lead">{leadText}</p>
        </div>
        <div
          className={featured ? 'kc-course-cards__featured' : 'kc-card-grid kc-card-grid--courses'}
        >
          {products.map((product) => (
            <ProductCard
              ctaLabel={ctaLabel}
              featured={featured}
              key={product.id}
              product={product}
            />
          ))}
        </div>
      </Container>
    </Section>
  )
}
