import type { FieldHook } from 'payload'

/** A sor vagy régi nyilvános, vagy új védett fájlt hordozhat. */
export function validateCourseAttachments(value: unknown): true | string {
  if (!Array.isArray(value)) return true
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return 'Válassz fájlt a melléklethez.'
    const legacy = item.file !== null && item.file !== undefined
    const protectedFile = item.protectedFile !== null && item.protectedFile !== undefined
    if (legacy === protectedFile)
      return 'Válassz pontosan egy fájlt: védett kurzusfájlt vagy korábbi nyilvános fájlt.'
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
