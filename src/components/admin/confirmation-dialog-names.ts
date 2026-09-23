import { useEffect } from 'react'

/**
 * A Payload ConfirmationModal a <dialog> nevét a modal azonosítójából adja
 * (@faceless-ui/modal: aria-label = slug), a címsorra nem hivatkozik. A
 * megnyitott ablakot ezért a látható címsorhoz és a törzshöz kötjük
 * (SC 4.1.2 Name, Role, Value); az aria-labelledby elsőbbséget élvez az
 * aria-label előtt, a Payload saját attribútumait nem írjuk felül.
 *
 * Saját modul, hogy a megerősítő ablakot használó panelek (Visszatérítés,
 * Kurzus ajándékozása) ne egymás modulját töltsék be.
 */
export function useConfirmationDialogNames(
  slug: string,
  open: boolean,
  headingId: string,
  bodyId: string,
): void {
  useEffect(() => {
    if (!open) return
    const dialog = document.getElementById(slug)
    if (!dialog) return
    dialog.setAttribute('aria-labelledby', headingId)
    dialog.setAttribute('aria-describedby', bodyId)
  }, [slug, open, headingId, bodyId])
}
