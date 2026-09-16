import { buildCurriculum } from '../../lib/curriculum/curriculum'
import { coursePriceBadgeKind } from '../../lib/courses'
import type { Product } from '../../payload-types'

export interface EditorialCheck {
  key: string
  label: string
  ready: boolean
  detail: string
}

/** Advisory only. The canonical curriculum owns precedence and playable semantics. */
export function courseEditorialChecklist(product: Partial<Product>) {
  const curriculum = buildCurriculum(product, false)
  const videoLessons = curriculum.lessons.filter((lesson) => lesson.kind === 'video')
  const pendingVideoCount = videoLessons.filter((lesson) => !lesson.playable).length
  const hasTitle = [product.displayTitle, product.sku].some(
    (value) => typeof value === 'string' && value.trim().length > 0,
  )
  const price = coursePriceBadgeKind(product)
  const items: EditorialCheck[] = [
    {
      key: 'title',
      label: 'Kurzus címe',
      ready: hasTitle,
      detail: hasTitle ? 'Kitöltve' : 'Hiányzik',
    },
    {
      key: 'category',
      label: 'Kategória',
      ready: Boolean(product.category),
      detail: product.category ? 'Kiválasztva' : 'Hiányzik',
    },
    {
      key: 'price',
      label: 'Árazás',
      ready: price !== 'none',
      detail:
        price === 'price'
          ? 'Ár megadva'
          : price === 'free'
            ? 'Ingyenes kurzus'
            : 'Tulajdonosi ellenőrzés szükséges',
    },
    {
      key: 'lessons',
      label: 'Tananyag',
      ready: curriculum.lessons.length > 0 && pendingVideoCount === 0,
      detail: `${curriculum.lessons.length} lecke, ${pendingVideoCount} videó vár ellenőrzésre`,
    },
  ]
  return {
    items,
    lessonCount: curriculum.lessons.length,
    pendingVideoCount,
    source: curriculum.legacy ? 'legacy' : 'modules',
    hiddenLegacyCount:
      !curriculum.legacy && Array.isArray(product.videos) ? product.videos.length : 0,
  }
}
