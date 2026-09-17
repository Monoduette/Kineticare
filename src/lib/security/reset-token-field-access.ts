import type { Field, SanitizedConfig } from 'payload'

/**
 * A `users` collection Payload által generált `resetPasswordToken` és
 * `resetPasswordExpiration` mezőjének OLVASÁS-zárja.
 *
 * A Payload alap auth-mezői (`payload/dist/auth/baseFields/auth.js`) csak
 * `create`/`update: () => false` és `hidden: true` beállítást kapnak; olvasási
 * szabályuk nincs. A `hidden` csak az admin felületről és a válaszból veszi ki
 * a mezőt, a `where`-szűrést NEM tiltja: a lekérdezés-ellenőrzés
 * (`validateSearchParams`) a `hash` és a `salt` úton kívül a mező
 * `read`-jogát nézi, ami zár nélkül igaz. Így bárki, aki a célrekordot
 * olvashatja (a `read: isSelfOrAdmin` miatt a staff MINDEN usert), a
 * `?where[resetPasswordToken][like]=…` prefix-szűréssel karakterenként
 * kitalálhatja az élő jelszó-visszaállító tokent, és az owner jelszavát
 * írhatja át. A zár ezt a mérésekkel igazolt utat csukja be.
 *
 * Nem törik: a Payload saját `forgotPassword`/`resetPassword` műveletei a
 * `payload.db` rétegen dolgoznak, a saját reset-útvonal (`reset-password-route.ts`)
 * `overrideAccess: true`-val keres, a lokális API alapból felülbírálja az
 * access-t. Hiányzó mező → dob (ne nyíljon vissza némán egy Payload-emelésnél).
 */
export const RESET_TOKEN_FIELD_NAMES = ['resetPasswordToken', 'resetPasswordExpiration'] as const

const denyRead = (): false => false

/** Az access-szel rendelkező (nem UI) mezők típusa. */
type AccessField = Exclude<Field, { type: 'ui' }>

function hasAccess(field: Field): field is AccessField {
  return field.type !== 'ui'
}

function findNamedField(fields: Field[], name: string): Field | undefined {
  for (const field of fields) {
    if ('name' in field && field.name === name) {
      return field
    }
    if ('fields' in field && Array.isArray(field.fields)) {
      const nested = findNamedField(field.fields, name)
      if (nested) {
        return nested
      }
    }
    if (field.type === 'tabs') {
      for (const tab of field.tabs) {
        const nested = findNamedField(tab.fields, name)
        if (nested) {
          return nested
        }
      }
    }
  }
  return undefined
}

export function restrictResetTokenFieldAccess(config: SanitizedConfig): SanitizedConfig {
  const users = config.collections.find((collection) => collection.slug === 'users')
  if (!users) {
    throw new Error(
      'A „users" collection nincs a szanitált configban — a jelszó-visszaállító token ' +
        'olvasás-zárja NEM alkalmazható. Emberi felülvizsgálat szükséges ' +
        '(src/lib/security/reset-token-field-access.ts).',
    )
  }
  for (const name of RESET_TOKEN_FIELD_NAMES) {
    const field = findNamedField(users.fields, name)
    if (!field || !('name' in field) || !hasAccess(field)) {
      throw new Error(
        `A „users" collection „${name}" mezője hiányzik a szanitált configból — a Payload ` +
          'feltehetően átnevezte az auth-alapmezőit. A token-olvasás zárja így NEM ' +
          'alkalmazható, és a staff prefix-szűréssel kitalálhatná az élő tokent. ' +
          'Emberi felülvizsgálat szükséges (src/lib/security/reset-token-field-access.ts).',
      )
    }
    field.access = { ...field.access, read: denyRead }
  }
  return config
}
