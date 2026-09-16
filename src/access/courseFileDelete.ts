import { APIError, type CollectionBeforeDeleteHook } from 'payload'

/**
 * A course_files kötelező tulajdonosát nem nullázhatja a termék törlése.
 * A fájlok megőrzéséről a szerkesztő dönt; nincs automatikus bináris törlés.
 * A kapu a haladás és más kapcsolt adatok takarítása előtt fusson.
 */
export const preventCourseDeletionWithFiles: CollectionBeforeDeleteHook = async ({ id, req }) => {
  const result = await req.payload.count({
    collection: 'course-files',
    where: { course: { equals: id } },
    overrideAccess: true,
    req,
  })
  if (result.totalDocs !== 0) {
    throw new APIError(
      'A kurzushoz védett fájlok tartoznak. Archiváld a kurzust; végleges törlés előtt rendezd a fájlok megőrzését.',
      409,
    )
  }
}
