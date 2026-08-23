import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import { Users } from '../../collections/Users'

/**
 * A „jelszó-beállítás függőben" jelző (`passwordSetupPending`) ÉLETCIKLUSA.
 *
 * MIRE KELL: a rendszer által létrehozott fiókokon (vendég-vásárlás
 * fiók-feloldása, vásárló-import) a vevő még nem választott jelszót — a
 * kezdőjelszó véletlen és eldobható. A fizetés utáni levél ebből dönti el,
 * hogy jelszó-beállító linket küldjön-e, vagy a belépésre irányítson.
 *
 * A jelző az ELSŐ SIKERES BELÉPÉSKOR törlődik. Ez lefedi a jelszó-beállító
 * linkkel indított utat is: a Payload `resetPasswordOperation`-je a jelszócsere
 * után lefuttatja az afterLogin hookokat (a beforeChange láncot NEM) — külön
 * reset-oldali huzalozás így nem kell.
 *
 * A mező RENDSZER-ÍRÁSÚ: a field-access create/update szabálya zárt, tehát sem
 * az admin felület, sem az API nem állíthatja át kívülről (a `purchases`
 * mintája).
 */

/** A jelzőt törlő afterLogin hook — név szerint, a lánc bővülhet. */
function clearHook() {
  const hook = (Users.hooks?.afterLogin ?? []).find(
    (candidate) => candidate.name === 'clearPasswordSetupPendingAfterLogin',
  )
  expect(hook, 'a jelző-törlő afterLogin hook nincs bekötve').toBeDefined()
  return hook!
}

function hookReq(payload: Payload) {
  return { payload } as unknown as Parameters<
    NonNullable<NonNullable<typeof Users.hooks>['afterLogin']>[number]
  >[0]['req']
}

function createMockPayload(failing = false) {
  const updates: Array<{ id: unknown; data: Record<string, unknown>; hasReq: boolean }> = []
  const payload = {
    update: vi.fn(async (args: { id: unknown; data: Record<string, unknown>; req?: unknown }) => {
      if (failing) {
        throw new Error('connection lost')
      }
      updates.push({ id: args.id, data: args.data, hasReq: args.req !== undefined })
      return args.data
    }),
  } as unknown as Payload
  return { payload, updates }
}

describe('passwordSetupPending — a mező szerződése', () => {
  it('a Users collection tartalmazza a mezőt, alapértelmezés szerint hamis értékkel', () => {
    const field = Users.fields.find(
      (entry) => 'name' in entry && entry.name === 'passwordSetupPending',
    )
    expect(field).toBeDefined()
    expect(field).toMatchObject({ type: 'checkbox', defaultValue: false })
  })

  it('a mező RENDSZER-ÍRÁSÚ: kívülről sem create-kor, sem update-kor nem állítható', () => {
    const field = Users.fields.find(
      (entry) => 'name' in entry && entry.name === 'passwordSetupPending',
    ) as { access?: { create?: () => boolean; update?: () => boolean } }

    expect(field.access?.create?.()).toBe(false)
    expect(field.access?.update?.()).toBe(false)
  })
})

describe('passwordSetupPending — törlés az első sikeres belépéskor', () => {
  it('függőben lévő jelszó-beállításnál a jelző törlődik (a req továbbadásával)', async () => {
    const { payload, updates } = createMockPayload()

    await clearHook()({
      req: hookReq(payload),
      user: { id: 7, passwordSetupPending: true },
    } as never)

    expect(updates).toEqual([
      // A `req` továbbadása KÖTELEZŐ: enélkül az update új tranzakcióban futna,
      // és a login-tranzakció által már írt sorra ön-blokkoló deadlockot okozna.
      { id: 7, data: { passwordSetupPending: false }, hasReq: true },
    ])
  })

  it('már aktivált fióknál NINCS fölösleges írás', async () => {
    const { payload, updates } = createMockPayload()

    await clearHook()({
      req: hookReq(payload),
      user: { id: 7, passwordSetupPending: false },
    } as never)

    expect(updates).toHaveLength(0)
  })

  it('BEST-EFFORT: a törlés hibája NEM törheti a bejelentkezést', async () => {
    const { payload } = createMockPayload(true)

    await expect(
      clearHook()({
        req: hookReq(payload),
        user: { id: 7, passwordSetupPending: true },
      } as never),
    ).resolves.toBeDefined()
  })
})
