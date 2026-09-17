import type { FieldAccess, SanitizedConfig } from 'payload'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  RESET_TOKEN_FIELD_NAMES,
  restrictResetTokenFieldAccess,
} from '../../lib/security/reset-token-field-access'
import configPromise from '../../payload.config'

/**
 * A JELSZÓ-VISSZAÁLLÍTÓ TOKEN OLVASÁS-ZÁRJA (2026-09-17-i biztonsági átnézés).
 *
 * Cáfolható állítás: a Payload `resetPasswordToken` alapmezőjén csak
 * create/update-zár és `hidden` van, olvasás-zár nincs, ezért a mező a REST
 * `where`-ben szűrhető volt; a staff (`read: isSelfOrAdmin` minden userre)
 * `where[resetPasswordToken][like]=a…` prefix-szűréssel karakterenként
 * kitalálhatta az owner élő tokenjét, és átírhatta a jelszavát. A zár után a
 * lekérdezés-ellenőrzés (`validateSearchParams`: a mező `read`-joga hamis)
 * QueryError-ral utasítja el a szűrést.
 */

type Role = 'owner' | 'staff' | 'customer'

const fieldArgs = (user: { id: number; role: Role } | null) =>
  ({ req: { user }, doc: {}, siblingData: {} }) as unknown as Parameters<FieldAccess>[0]

let config: SanitizedConfig

beforeAll(async () => {
  config = await configPromise
})

function usersField(name: string) {
  const users = config.collections.find((collection) => collection.slug === 'users')
  const field = users?.fields.find((candidate) => 'name' in candidate && candidate.name === name)
  if (!field || !('name' in field) || field.type === 'ui') {
    throw new Error(`hiányzó mező a szanitált configban: ${name}`)
  }
  return field
}

describe('a users resetPasswordToken / resetPasswordExpiration mezője a VÉGLEGES configban', () => {
  it.each([...RESET_TOKEN_FIELD_NAMES])(
    '%s: olvasás senkinek (owner, staff, customer, anonim)',
    async (name) => {
      const field = usersField(name)
      const read = field.access?.read
      expect(typeof read).toBe('function')
      for (const user of [
        { id: 1, role: 'owner' as const },
        { id: 2, role: 'staff' as const },
        { id: 3, role: 'customer' as const },
        null,
      ]) {
        expect(await read?.(fieldArgs(user))).toBe(false)
      }
    },
  )

  it.each([...RESET_TOKEN_FIELD_NAMES])('%s: a Payload írás-zárja megmarad', async (name) => {
    const field = usersField(name)
    expect(await field.access?.create?.(fieldArgs({ id: 1, role: 'owner' }))).toBe(false)
    expect(await field.access?.update?.(fieldArgs({ id: 1, role: 'owner' }))).toBe(false)
  })

  it('hiányzó users collection vagy mező esetén hangosan dob (nem nyílik vissza némán)', () => {
    expect(() =>
      restrictResetTokenFieldAccess({ collections: [] } as unknown as SanitizedConfig),
    ).toThrow(/users/)
    expect(() =>
      restrictResetTokenFieldAccess({
        collections: [{ slug: 'users', fields: [] }],
      } as unknown as SanitizedConfig),
    ).toThrow(/resetPasswordToken/)
  })
})
