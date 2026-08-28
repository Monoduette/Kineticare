/**
 * PreviewVideo — a kurzus PUBLIKUS előzetes-videójának lejátszója
 * (previewVideoStreamId). Ha a termékhez nincs előzetes rendelve, a
 * szekció rejtve marad (a komponens null-t ad).
 * A lejátszó a Bunny Stream publikus iframe-embedje — ez a platform
 * videó-szolgáltatója. A Bunnynál a token-hitelesítés LIBRARY-szintű, ezért az
 * előzetes (és a hero-videó) a PUBLIKUS libraryben él: itt nincs jegy, a
 */

import { bunnyPublicLibraryId } from '@/lib/stream/bunny-site-config'

/** A publikus library azonosítója: env, különben az éles KINETICARE-PUBLIC tár. */
function publicLibraryId(): string {
  return bunnyPublicLibraryId()
}

/**
 * Van-e megjeleníthető előzetes: a videó GUID-ja kell. A publikus library id
 * az env-ből vagy az éles KINETICARE-PUBLIC tárból jön.
 */
export function hasPreviewVideo(streamId: string | null | undefined): boolean {
  const id = typeof streamId === 'string' ? streamId.trim() : ''
  return id.length > 0 && publicLibraryId().length > 0
}

export interface PreviewVideoProps {
  streamId: string | null | undefined
  /** Akadálymentes cím az iframe-hez (pl. „<kurzus címe> — előzetes"). */
  title: string
}

export function PreviewVideo({ streamId, title }: PreviewVideoProps) {
  const id = typeof streamId === 'string' ? streamId.trim() : ''
  const libraryId = publicLibraryId()
  if (id.length === 0 || libraryId.length === 0) {
    return null
  }
  const src = `https://iframe.mediadelivery.net/embed/${encodeURIComponent(libraryId)}/${encodeURIComponent(id)}`

  return (
    <div className="kc-course-preview">
      <iframe
        allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
        className="kc-course-preview__frame"
        loading="lazy"
        src={src}
        title={title}
      />
    </div>
  )
}
