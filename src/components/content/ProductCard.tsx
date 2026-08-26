import Link from 'next/link'

import { courseHref } from '../../lib/course-url'
import { AUDIENCE_LABELS, normalizeAudience } from '../../lib/course-audience'
import { coursePriceBadgeKind, courseTitle } from '../../lib/courses'
import { ctaLabel } from '../../lib/cta-vocabulary'
import type { Product } from '../../payload-types'
import { Badge } from '../ui/Badge'
import { Card } from '../ui/Card'
import { PriceTag } from '../ui/PriceTag'
import { MediaImage } from './MediaImage'

import '../../app/(frontend)/styles/blocks/course-cards.css'

/**
 * ProductCard — a kezdőlapi kurzus-kiemelés kártyája („mini-buybox").
 */

/**
 * A kártya affordancia-feliratának alapértéke — a blokk `ctaLabel` mezője
 * felülírja.
 *
 * A SZÓTÁRBÓL olvas (§3.2 #28, `course-sales-open`), nem literálként: a kártya
 * a kurzus SAJÁT oldalára visz, ugyanoda, ahova a lejátszó „lejárt a
 * hozzáférésed" kapuja és a /kurzusaim lejárt kártyája — egy cselekvés, egy
 * felirat (WCAG 2.2 · 3.2.4). A korábbi „Megnézem a programot" a mért nyolc
 * párhuzamos „kurzus felé" felirat egyike volt (docs/gomb-inventar.md §5), és
 * ráadásul „program"-nak nevezte azt, amit a felület mindenhol máshol
 * „kurzus"-nak hív (C-4: egy fogalom, egy szó).
 */
export const DEFAULT_CTA_LABEL = ctaLabel('course-sales-open')

export interface ProductCardProps {
  // A megjelenített név a displayTitle → sku lánc (courseTitle), az URL pedig a
  // slug → id lánc (courseHref) — lásd src/plugins/ecommerce.ts.
  product: Pick<
    Product,
    | 'id'
    | 'slug'
    | 'sku'
    | 'displayTitle'
    | 'shortDescription'
    | 'cardHighlights'
    | 'coverImage'
    | 'priceInHUF'
    | 'priceInHUFEnabled'
    | 'accessDurationDays'
    | 'audience'
    | 'status'
  >
  /**
   * A dekoratív CTA-gomb felirata (a `courseCards` blokk `ctaLabel` mezőjéből).
   * Üresen a `DEFAULT_CTA_LABEL` marad.
   */
  ctaLabel?: string
  /**
   * Kiemelt, VÍZSZINTES elrendezés (borító balra, tartalom jobbra) 900 px
   * felett. A tartalmi mezőkre nincs hatása — lásd a fejkommentet.
   */
  featured?: boolean
}

/** Publikusan megjeleníthető-e a termék (draft/archived sosem). */
export function isPubliclyVisibleProduct(product: { status?: string | null }): boolean {
  return product.status === 'published'
}

/**
 * A kártyán megjelenő előny-sorok a `cardHighlights` tömbből: trimmelve, üres
 * sorok nélkül, legfeljebb 3 (a mező `maxRows`-ával azonos plafon — a felület
 * akkor sem törik el, ha egy régi rekordban több sor maradt).
 */
export function cardHighlightTexts(
  product: Pick<Product, 'cardHighlights'>,
  limit = 3,
): string[] {
  if (!Array.isArray(product.cardHighlights)) {
    return []
  }
  const texts: string[] = []
  for (const row of product.cardHighlights) {
    const text = typeof row?.text === 'string' ? row.text.trim() : ''
    if (text.length > 0) {
      texts.push(text)
    }
    if (texts.length === limit) {
      break
    }
  }
  return texts
}

/**
 * A hozzáférés hosszának kártya-felirata az `accessDurationDays` mezőből.
 *
 * SZÁNDÉKOSAN CSAK a pozitív, véges napszámot írjuk ki. Üres mezőnél a
 * rendszer szerint a hozzáférés nem jár le (a mező súgója és a
 * resolveCourseAccess is így értelmezi), de a „korlátlan/örökös hozzáférés"
 * ÍGÉRETÉT a kártya nem teheti meg helyettünk: a régi oldal épp ezen a ponton
 * mondott háromfélét („örökké" / „minimum egy évig" / ÁSZF: „három hónapra
 * garantált", lásd docs/regi-oldal-valaszok.md 4. táblázat 3. sora). Ki nem
 * töltött mezőnél tehát a sor egyszerűen elmarad — állítás helyett csend.
 */
export function accessDurationLabel(
  product: Pick<Product, 'accessDurationDays'>,
): string | null {
  const days = product.accessDurationDays
  if (typeof days !== 'number' || !Number.isFinite(days) || days <= 0) {
    return null
  }
  return `${Math.floor(days)} napos hozzáférés`
}

/** Pipa-ikon az előny-sorokhoz — dekoráció, ezért aria-hidden. */
function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      className="kc-product-card__tick"
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.25"
      viewBox="0 0 24 24"
    >
      <path d="M4.5 12.5 10 18 19.5 6.5" />
    </svg>
  )
}

export function ProductCard({ product, ctaLabel, featured = false }: ProductCardProps) {
  if (!isPubliclyVisibleProduct(product)) {
    return null
  }

  const title = courseTitle(product)
  // Egy igazságforrás a kurzusoldallal: a 'none' eset (ár-pipa BE, de az ár
  // ÜRES) szándékosan SEM árat, SEM „Ingyenes"-t nem mutat — az konfigurációs
  // hiba, és a címke a kártyán is megtévesztő lenne (lásd courses.ts).
  const priceBadge = coursePriceBadgeKind(product)
  const coverMedia =
    product.coverImage && typeof product.coverImage === 'object' ? product.coverImage : null
  const highlights = cardHighlightTexts(product)
  const accessLabel = accessDurationLabel(product)
  const audienceLabel = AUDIENCE_LABELS[normalizeAudience(product.audience)]
  const cta = ctaLabel?.trim() || DEFAULT_CTA_LABEL

  return (
    <Card
      as="article"
      className={`kc-product-card${featured ? ' kc-product-card--featured' : ''}`}
      interactive
      padded={false}
    >
      <Link
        aria-label={`${title}: a kurzus részletei`}
        className="kc-product-card__link"
        href={courseHref(product)}
      >
        {coverMedia ? (
          <span className="kc-product-card__cover">
            {/* A kiemelt kártya borítója a szekció fél szélességét kapja, ezért
                nagyobb forrásból (md) és nagyobb `sizes`-szal renderel.
                A borító DEKORATÍV (alt=""): a Media alt-ja a kurzus címét
                ismételte meg, és mivel a kártya EGÉSZE egyetlen link, ez a
                link akadálymentes nevébe is beleszámított — mérve 348
                karakter hosszú nevet adott (a javítás után 44). */}
            <MediaImage
              decorative
              media={coverMedia}
              preferredSize={featured ? 'md' : 'sm'}
              sizes={
                featured ? '(max-width: 900px) 100vw, 520px' : '(max-width: 720px) 100vw, 352px'
              }
            />
          </span>
        ) : null}
        <span className="kc-product-card__body">
          <span className="kc-product-card__audience">
            <Badge tone="neutral">{audienceLabel}</Badge>
          </span>
          <span className="kc-product-card__title">{title}</span>
          {highlights.length > 0 ? (
            <span className="kc-product-card__highlights">
              {highlights.map((highlight) => (
                <span className="kc-product-card__highlight" key={highlight}>
                  <CheckIcon />
                  <span className="kc-product-card__highlight-text">{highlight}</span>
                </span>
              ))}
            </span>
          ) : null}
          {product.shortDescription ? (
            <span className="kc-product-card__description">{product.shortDescription}</span>
          ) : null}
          <span className="kc-product-card__foot">
            <span className="kc-product-card__pricing">
              {priceBadge === 'price' ? (
                <span className="kc-product-card__price">
                  <PriceTag label="Ár:" priceHuf={product.priceInHUF as number} />
                </span>
              ) : null}
              {priceBadge === 'free' ? (
                <span className="kc-product-card__price">
                  <Badge tone="success">Ingyenes</Badge>
                </span>
              ) : null}
              {accessLabel ? (
                <span className="kc-product-card__access">{accessLabel}</span>
              ) : null}
            </span>
            {/* A kártya EGÉSZE a kurzus-oldalra vivő link, ezért a CTA dekoratív
                felirat (aria-hidden) — beágyazott gomb/link nem lehet benne. */}
            <span aria-hidden="true" className="kc-product-card__cta">
              {cta} <span className="kc-product-card__cta-arrow">→</span>
            </span>
          </span>
        </span>
      </Link>
    </Card>
  )
}
