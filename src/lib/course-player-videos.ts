import type { Product } from '../payload-types'

/**
 * Lejátszó epizódlista: streamAssetId csak hasAccess mellett (overrideAccess miatt itt kell szűrni).
 * Őr: kurzusaim-player-videos.test.ts.
 */
export interface PlayerVideo {
  id?: string
  title?: string
  streamAssetId?: string
  durationSec?: number
  status?: 'processing' | 'ready' | 'error'
}

export function toPlayerVideos(
  product: Pick<Product, 'videos'>,
  hasAccess: boolean,
): PlayerVideo[] {
  if (!Array.isArray(product.videos)) {
    return []
  }
  return product.videos.map((video) => ({
    id: video.id ?? undefined,
    title: video.title ?? undefined,
    streamAssetId: hasAccess ? (video.streamAssetId ?? undefined) : undefined,
    durationSec: video.durationSec ?? undefined,
    status: video.status ?? undefined,
  }))
}
