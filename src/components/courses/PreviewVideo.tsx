/**
 * PreviewVideo — a kurzus PUBLIKUS előzetes-videójának lejátszója
 * (previewVideoStreamId). Ha a termékhez nincs előzetes rendelve, a
 * szekció rejtve marad (a komponens null-t ad).
 * A lejátszó a Bunny Stream publikus iframe-embedje — ez a platform
 * videó-szolgáltatója. A Bunnynál a token-hitelesítés LIBRARY-szintű, ezért az
 * előzetes (és a hero-videó) a PUBLIKUS libraryben él: itt nincs jegy, a
 */

/** A trimmelt publikus library-azonosító, vagy üres string, ha nincs beállítva. */
function publicLibraryId(): string {
  return process.env.NEXT_PUBLIC_BUNNY_STREAM_PUBLIC_LIBRARY_ID?.trim() ?? ''
}

/**
 * Van-e megjeleníthető előzetes: a videó GUID-ja ÉS a publikus library-id ENV
 * együtt kell hozzá — a kurzus-oldal ezzel rejti el az egész szekciót.
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
