import { hasDuplicateSkuSuffix, isTopicCourse } from '../../lib/course-family'
import { resolveCoursePromo } from '../../lib/course-promo'
import { buildCurriculum } from '../../lib/curriculum/curriculum'
import { coursePriceBadgeKind } from '../../lib/courses'
import { formatPriceHuf } from '../../lib/format-price'
import { lexicalPlainText, pricesInText } from '../../lib/text-prices'
import type { Product } from '../../payload-types'

export interface EditorialCheck {
  key: string
  label: string
  ready: boolean
  detail: string
  /** A kurzusszerkesztő füle, ahol a sor javítható (ugrógombot kap). */
  tab?: string
}

/** A kurzusszerkesztő fülének felirata, ahol az ár és az akció áll (src/plugins/ecommerce.ts). */
export const PRICE_TAB_LABEL = 'Ár és hozzáférés'

/**
 * K42: a Tananyag sora köznyelvi mondat („N lecke, ebből M videó még nem
 * kész.”), a korábbi „0 lecke, 0 videó vár ellenőrzésre” helyett.
 */
export function lessonsDetail(lessonCount: number, videoCount: number, pendingVideos: number) {
  if (lessonCount === 0) return 'Még nincs lecke.'
  if (pendingVideos > 0) return `${lessonCount} lecke, ebből ${pendingVideos} videó még nem kész.`
  return videoCount === 0
    ? `${lessonCount} lecke, videó nélkül.`
    : `${lessonCount} lecke, minden videó kész.`
}

/**
 * K42: az Árazás sora az akció állapotát is kimondja, ugyanazzal a
 * feloldással, mint a kurzusoldal és az akció állapotdoboza
 * (resolveCoursePromo, WCAG 2.2 SC 3.2.4). Csak fizetős kurzuson értelmes.
 */
function promoSentence(product: Partial<Product>, now: Date): { text: string; invalid: boolean } {
  const promo = resolveCoursePromo(
    {
      promoEnabled: product.promoEnabled,
      promoStart: product.promoStart,
      promoEnd: product.promoEnd,
      promoPriceHuf: product.promoPriceHuf,
      priceInHUF: product.priceInHUF,
      priceInHUFEnabled: product.priceInHUFEnabled,
    },
    now,
  )
  const wanted = typeof product.promoPriceHuf === 'number' && product.promoPriceHuf > 0
  const invalid = promo.enabled && wanted && promo.promoPriceHuf === null
  if (!promo.enabled) return { text: 'Akció: nincs.', invalid: false }
  if (invalid) {
    return { text: 'Akció: az akciós ár nem kisebb a rendes árnál.', invalid: true }
  }
  if (promo.reason === 'meg-nem-kezdodott') {
    return { text: 'Akció: még nem kezdődött el.', invalid: false }
  }
  if (promo.reason === 'lejart') return { text: 'Akció: lejárt.', invalid: false }
  return {
    text:
      promo.promoPriceHuf === null
        ? 'Akció: most él, akciós ár nélkül.'
        : `Akció: most él, a vásárló ${formatPriceHuf(promo.promoPriceHuf)}-ot fizet.`,
    invalid: false,
  }
}

/**
 * Témakurzus: a teljes programból másolt szövegben a program ára maradhatott
 * („79 500 Ft”), ami a témakurzus oldalán hamis állítás lenne (UCPD, valótlan
 * ár). A kurzusoldal árát a mező adja, a szövegben nem kell ár.
 */
function topicCourseCheck(product: Partial<Product>): EditorialCheck {
  const places: Array<[string, unknown]> = [
    ['Rövid leírás', product.shortDescription],
    ['Részletes leírás', product.longDescription],
    ['Garancia címe', product.guaranteeTitle],
    ['Garancia szövege', product.guaranteeText],
  ]
  const found = places
    .map(([place, value]) => [place, pricesInText(lexicalPlainText(value))] as const)
    .filter(([, prices]) => prices.length > 0)
  return {
    key: 'topic-course',
    label: 'Témakurzus',
    ready: found.length === 0,
    detail:
      found.length === 0
        ? 'A teljes programja beállítva. Aki azt megvette, itt a programja linkjét látja.'
        : `Kézzel írt ár áll a szövegben: ${found
            .map(([place, prices]) => `${place} (${prices.join(', ')})`)
            .join('; ')}. A témakurzus árát az ár mező adja, ezt a szövegből vedd ki.`,
  }
}

/** Advisory only. The canonical curriculum owns precedence and playable semantics. */
export function courseEditorialChecklist(product: Partial<Product>, now: Date = new Date()) {
  const curriculum = buildCurriculum(product, false)
  const videoLessons = curriculum.lessons.filter((lesson) => lesson.kind === 'video')
  const pendingVideoCount = videoLessons.filter((lesson) => !lesson.playable).length
  const hasTitle = [product.displayTitle, product.sku].some(
    (value) => typeof value === 'string' && value.trim().length > 0,
  )
  const price = coursePriceBadgeKind(product, now)
  const promo = price === 'price' ? promoSentence(product, now) : null
  const items: EditorialCheck[] = [
    {
      key: 'title',
      label: 'Kurzus címe',
      ready: hasTitle,
      detail: hasTitle ? 'Kitöltve.' : 'Hiányzik.',
    },
    {
      key: 'category',
      label: 'Kategória',
      ready: Boolean(product.category),
      detail: product.category ? 'Kiválasztva.' : 'Hiányzik.',
    },
    {
      key: 'price',
      label: 'Árazás',
      ready: price !== 'none' && !promo?.invalid,
      detail:
        price === 'price'
          ? `Ár megadva. ${promo?.text ?? ''}`.trim()
          : price === 'free'
            ? 'Ingyenes kurzus.'
            : 'Nincs érvényes ár. Tulajdonosi ellenőrzés szükséges.',
      tab: PRICE_TAB_LABEL,
    },
    {
      key: 'lessons',
      label: 'Tananyag',
      ready: curriculum.lessons.length > 0 && pendingVideoCount === 0,
      detail: lessonsDetail(curriculum.lessons.length, videoLessons.length, pendingVideoCount),
    },
  ]
  // Duplikált kurzus: a „- Copy” jelölés a számlára és a Barion-oldalra is
  // kikerülne. Csak akkor jelenik meg, ha ott áll (a közzétételt a belső
  // azonosító mező is elutasítja).
  const copyMarked = [product.sku, product.displayTitle].some(hasDuplicateSkuSuffix)
  if (copyMarked) {
    items.push({
      key: 'copy-marker',
      label: 'Másolat jelölése',
      ready: false,
      detail: 'A cím vagy a belső azonosító még „- Copy” végű. Közzététel előtt írd át.',
    })
  }
  if (isTopicCourse(product)) {
    items.push(topicCourseCheck(product))
  }
  return {
    items,
    lessonCount: curriculum.lessons.length,
    pendingVideoCount,
    source: curriculum.legacy ? 'legacy' : 'modules',
    hiddenLegacyCount:
      !curriculum.legacy && Array.isArray(product.videos) ? product.videos.length : 0,
  }
}
