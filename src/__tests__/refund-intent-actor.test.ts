import { describe, expect, it } from 'vitest'
import { RefundIntents } from '../collections/RefundIntents'
import * as actorDomain from '../lib/refund/refund-intent'

describe('refund intent actor identity (system V2)', () => {
  it('a schema befogadja a rendszer V2 intentet kötelező hamis user actor nélkül', () => {
    const actor = RefundIntents.fields.find((field) => 'name' in field && field.name === 'actor')
    const version = RefundIntents.fields.find(
      (field) => 'name' in field && field.name === 'schemaVersion',
    )
    expect(actor).not.toMatchObject({ required: true })
    expect(version).toMatchObject({ max: 2 })
  })

  it('V1 owner eredetet változatlan user azonosítóval ismeri fel', () => {
    expect(actorDomain.parseRefundIntentActorIdentity({ schemaVersion: 1, actor: 7 })).toEqual({
      actorKind: 'owner',
      actorId: 7,
      systemActor: null,
    })
  })

  it('V2 rendszereredet nem tulajdonítja a pénzműveletet egy usernek', () => {
    expect(
      actorDomain.parseRefundIntentActorIdentity({
        schemaVersion: 2,
        actor: null,
        actorKind: 'system',
        systemActor: 'paid-reject-recovery',
      }),
    ).toEqual({ actorKind: 'system', actorId: null, systemActor: 'paid-reject-recovery' })
  })

  it.each([
    { schemaVersion: 1, actor: null },
    { schemaVersion: 1, actor: 7, actorKind: 'system', systemActor: 'paid-reject-recovery' },
    { schemaVersion: 2, actor: 7, actorKind: 'system', systemActor: 'paid-reject-recovery' },
    { schemaVersion: 2, actor: null, actorKind: 'system', systemActor: 'unknown-system' },
    { schemaVersion: 2, actor: null, actorKind: 'owner' },
    { schemaVersion: 2, actor: 7, actorKind: 'owner', systemActor: 'paid-reject-recovery' },
  ])('hibás/kevert actor alakot elutasít: %j', (input) => {
    expect(() => actorDomain.parseRefundIntentActorIdentity(input)).toThrow()
  })
})
