/**
 * ŐR-TESZT: a `users.purchases` (Megvásárolt kurzusok) mező ÍRÁSI joga.
 *
 * MIT VÉD. A mező a kurzus-hozzáférés maga: aki írhatja, az ingyen ad magának
 * fizetős tartalmat, és a pipa megkerüli az ajándék-órát (accessGrants).
 * A tulajdonos 2026-08-23-i kérésére a mező újra rendszer-írású:
 * create/update minden szerepkörre hamis. Írás csak `overrideAccess: true`
 * (grant-panel, CLI, fizetésjóváhagyás).
 *
 * A teszt a VÉGLEGES payload.configon áll (nem a forrásfájl olvasásán).
 *
 * MINDEN ADAT KITALÁLT.
 */

import type { CollectionConfig, Field, FieldAccess } from 'payload'
import { describe, expect, it } from 'vitest'

import configPromise from '../../payload.config'

type Role = 'owner' | 'staff' | 'customer'

const owner = { id: 1, role: 'owner' as Role }
const staff = { id: 2, role: 'staff' as Role }
const customer = { id: 3, role: 'customer' as Role }

/**
 * A field-access argumentuma. A `id`/`doc` szándékosan a KÉRÉST INDÍTÓ
 * felhasználó saját rekordjára mutat: így a „customer a saját fiókján" eset is
 * a valósághoz hűen áll elő.
 */
const fieldArgs = (
  user: { id: number; role: Role } | null,
): Parameters<FieldAccess>[0] =>
  ({
    req: { user },
    id: user?.id,
    doc: user === null ? undefined : { id: user.id, email: 'teszt@example.com', role: user.role },
    data: { purchases: [11] },
  }) as unknown as Parameters<FieldAccess>[0]

type NamedTestField = Field & {
  name: string
  access?: {
    create?: FieldAccess
    read?: FieldAccess
    update?: FieldAccess
  }
}

function findField(collection: CollectionConfig, name: string): NamedTestField | undefined {
  return collection.fields.find((field) => 'name' in field && field.name === name) as
    | NamedTestField
    | undefined
}

async function purchasesField(): Promise<NamedTestField> {
  const config = await configPromise
  const users = (config.collections ?? []).find((collection) => collection.slug === 'users')
  expect(users, 'a users collection megvan a configban').toBeDefined()
  const field = findField(users as CollectionConfig, 'purchases')
  expect(field, 'a purchases mező megvan').toBeDefined()
  return field as NamedTestField
}

describe('users.purchases mezőszintű írási jog', () => {
  it('owner sem írhatja — a pipa megkerülné az ajándék-órát', async () => {
    const field = await purchasesField()
    expect(field.access?.create?.(fieldArgs(owner))).toBe(false)
    expect(field.access?.update?.(fieldArgs(owner))).toBe(false)
  })

  it('staff sem írhatja — ajándék a grant-panelen / CLI-n megy', async () => {
    const field = await purchasesField()
    expect(field.access?.create?.(fieldArgs(staff))).toBe(false)
    expect(field.access?.update?.(fieldArgs(staff))).toBe(false)
  })

  it('a VEVŐ nem írhatja — a saját rekordján sem', async () => {
    const field = await purchasesField()
    expect(field.access?.create?.(fieldArgs(customer))).toBe(false)
    expect(field.access?.update?.(fieldArgs(customer))).toBe(false)
  })

  it('látogató (nincs bejelentkezve) nem írhatja — a nyilvános regisztráció sem', async () => {
    const field = await purchasesField()
    expect(field.access?.create?.(fieldArgs(null))).toBe(false)
    expect(field.access?.update?.(fieldArgs(null))).toBe(false)
  })

  it('a lista oszlopai közt szerepel — a tulajdonos látja, ki mit vett meg', async () => {
    const config = await configPromise
    const users = (config.collections ?? []).find((collection) => collection.slug === 'users')
    expect(users?.admin?.defaultColumns).toContain('purchases')
  })
})
