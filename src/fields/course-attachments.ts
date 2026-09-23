import type { FieldHook } from 'payload'

/** Üres mellékletsor: a „Korábbi nyilvános fájl” ilyenkor rejtve van, csak a védett fájl választható. */
export const ATTACHMENT_MISSING_FILE_MESSAGE = 'Válassz védett kurzusfájlt a melléklethez.'

/** Régi sor, amelyhez új védett fájlt is választottak: a kettő közül egy maradhat. */
export const ATTACHMENT_DOUBLE_FILE_MESSAGE =
  'Egy mellékletnél csak egy fájl lehet. Tartsd meg a védett kurzusfájlt, és töröld a korábbi nyilvános fájlt.'

/**
 * A sor vagy régi nyilvános, vagy új védett fájlt hordozhat. Az üzenet a
 * látható mezőkhöz igazodik (K46): új sorban a „Korábbi nyilvános fájl” rejtve
 * van (src/fields/course-modules.ts `hasLegacyAttachmentFile`), ezért ott csak
 * a védett fájlt kérjük.
 */
export function validateCourseAttachments(value: unknown): true | string {
  if (!Array.isArray(value)) return true
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return ATTACHMENT_MISSING_FILE_MESSAGE
    const legacy = item.file !== null && item.file !== undefined
    const protectedFile = item.protectedFile !== null && item.protectedFile !== undefined
    if (legacy && protectedFile) return ATTACHMENT_DOUBLE_FILE_MESSAGE
    if (!legacy && !protectedFile) return ATTACHMENT_MISSING_FILE_MESSAGE
  }
  return true
}

/** Még a child relationship population előtt eltávolítja az elavult public fallbacket. */
export const hideLegacyAttachmentFallback: FieldHook = ({ value }) => {
  if (!Array.isArray(value)) return value
  return value.map((item) => {
    if (typeof item !== 'object' || item === null || item.protectedFile == null) return item
    const safe = { ...item }
    delete safe.file
    return safe
  })
}
