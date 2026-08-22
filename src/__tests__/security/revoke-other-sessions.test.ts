import { describe, expect, it, vi } from 'vitest'

import { Users } from '../../collections/Users'
import {
  CREDENTIAL_CHANGE_REVOKE_KEY,
  isEmailChanged,
  isPasswordChanged,
  isPasswordResetRequest,
  readSidFromJwtPayload,
  resolveSidToKeep,
  revokeOtherSessionsAfterCredentialChange,
  revokeOtherSessionsAfterPasswordReset,
  revokeOtherSessionsForUser,
  sessionIdsChanged,
  sessionsAfterCredentialChange,
  shouldMarkCredentialChangeForSessionRevoke,
} from '../../lib/security/revoke-other-sessions'
import type { Payload, PayloadRequest } from 'payload'

const NOW = new Date('2026-08-22T12:00:00.000Z')
const LATER = '2099-01-01T00:00:00.000Z'
const EARLIER = '2000-01-01T00:00:00.000Z'

const current = { id: 'sid-current', createdAt: '2026-08-22T10:00:00.000Z', expiresAt: LATER }
const other = { id: 'sid-other', createdAt: '2026-08-22T09:00:00.000Z', expiresAt: LATER }
const expired = { id: 'sid-expired', createdAt: '2026-08-22T08:00:00.000Z', expiresAt: EARLIER }

function jwtWithSid(sid: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ id: 7, sid, collection: 'users' })).toString(
    'base64url',
  )
  return `${header}.${payload}.x`
}

describe('sessionsAfterCredentialChange', () => {
  it('keepSid nélkül minden sessiont eldob', () => {
    expect(
      sessionsAfterCredentialChange({ sessions: [current, other], keepSid: null, now: NOW }),
    ).toEqual([])
  })

  it('csak a kért, még élő sessiont tartja meg', () => {
    expect(
      sessionsAfterCredentialChange({
        sessions: [current, other, expired],
        keepSid: 'sid-current',
        now: NOW,
      }),
    ).toEqual([current])
  })

  it('a megtartandó, de lejárt sessiont is eldobja', () => {
    expect(
      sessionsAfterCredentialChange({
        sessions: [expired],
        keepSid: 'sid-expired',
        now: NOW,
      }),
    ).toEqual([])
  })
})

describe('resolveSidToKeep', () => {
  it('idegen rekord cseréjénél semmit nem tart meg', () => {
    expect(
      resolveSidToKeep({
        actorId: 1,
        targetId: 99,
        actorSid: 'sid-owner',
        jwtSid: 'sid-new',
      }),
    ).toBeNull()
  })

  it('saját csere: a kérés sid-je nyer a JWT-nél', () => {
    expect(
      resolveSidToKeep({
        actorId: 7,
        targetId: 7,
        actorSid: 'sid-current',
        jwtSid: 'sid-jwt',
      }),
    ).toBe('sid-current')
  })

  it('reset: nincs actorSid, a JWT sid marad', () => {
    expect(
      resolveSidToKeep({
        actorId: 7,
        targetId: 7,
        actorSid: null,
        jwtSid: 'sid-new',
      }),
    ).toBe('sid-new')
  })
})

describe('isPasswordResetRequest / JWT sid / jelölő', () => {
  it('csak a reset-password útvonalat ismeri fel', () => {
    expect(isPasswordResetRequest({ url: '/api/users/reset-password' })).toBe(true)
    expect(isPasswordResetRequest({ pathname: '/api/users/login' })).toBe(false)
    expect(isPasswordResetRequest({ url: '/api/users/forgot-password' })).toBe(false)
  })

  it('a JWT payload sid-jét olvassa, a tokent nem kéri másodszor', () => {
    expect(readSidFromJwtPayload(jwtWithSid('sid-new'))).toBe('sid-new')
    expect(readSidFromJwtPayload('nem-jwt')).toBeNull()
    expect(readSidFromJwtPayload(jwtWithSid(''))).toBeNull()
  })

  it('jelszó- vagy e-mail-csere update-en jelöl, create-en nem', () => {
    expect(isPasswordChanged({ password: 'x' })).toBe(true)
    expect(isPasswordChanged({ password: '' })).toBe(false)
    expect(isEmailChanged({ currentEmail: 'a@b.hu', nextEmail: 'c@b.hu' })).toBe(true)
    expect(isEmailChanged({ currentEmail: 'a@b.hu', nextEmail: 'a@b.hu' })).toBe(false)
    expect(
      shouldMarkCredentialChangeForSessionRevoke({
        operation: 'update',
        passwordChanged: true,
        emailChanged: false,
      }),
    ).toBe(true)
    expect(
      shouldMarkCredentialChangeForSessionRevoke({
        operation: 'create',
        passwordChanged: true,
        emailChanged: false,
      }),
    ).toBe(false)
  })

  it('az azonosító-halmaz változását méri', () => {
    expect(sessionIdsChanged([current, other], [current])).toBe(true)
    expect(sessionIdsChanged([current], [current])).toBe(false)
  })
})

function createDb(sessions: typeof current[]) {
  const updates: Array<{ id: unknown; sessions: unknown; updatedAt: unknown }> = []
  const payload = {
    db: {
      findOne: vi.fn(async () => ({ id: 7, sessions, email: 'anna@example.test' })),
      updateOne: vi.fn(
        async (args: { id: unknown; data: { sessions?: unknown; updatedAt?: unknown } }) => {
          updates.push({
            id: args.id,
            sessions: args.data.sessions,
            updatedAt: args.data.updatedAt,
          })
        },
      ),
    },
  } as unknown as Payload
  return { payload, updates }
}

describe('revokeOtherSessionsForUser', () => {
  it('a saját sid-et megtartja, a másikat és a lejártat eldobja, updatedAt-et nem mozdítja', async () => {
    const { payload, updates } = createDb([current, other, expired])
    const result = await revokeOtherSessionsForUser({
      payload,
      req: {} as PayloadRequest,
      targetId: 7,
      actorId: 7,
      actorSid: 'sid-current',
    })

    expect(result).toEqual({ wrote: true, kept: 1, revoked: 2 })
    expect(updates).toEqual([
      {
        id: 7,
        sessions: [{ id: 'sid-current', createdAt: current.createdAt, expiresAt: LATER }],
        updatedAt: null,
      },
    ])
  })

  it('ha csak a saját session él, NINCS fölösleges írás', async () => {
    const { payload, updates } = createDb([current])
    const result = await revokeOtherSessionsForUser({
      payload,
      req: {} as PayloadRequest,
      targetId: 7,
      actorId: 7,
      actorSid: 'sid-current',
    })
    expect(result.wrote).toBe(false)
    expect(updates).toHaveLength(0)
  })

  it('idegen rekord: minden session elesik', async () => {
    const { payload, updates } = createDb([current, other])
    const result = await revokeOtherSessionsForUser({
      payload,
      req: {} as PayloadRequest,
      targetId: 7,
      actorId: 1,
      actorSid: 'sid-owner',
    })
    expect(result).toEqual({ wrote: true, kept: 0, revoked: 2 })
    expect(updates[0]?.sessions).toEqual([])
  })
})

describe('afterChange / afterLogin kapuk', () => {
  it('afterChange zászló nélkül nem ír', async () => {
    const { payload, updates } = createDb([current, other])
    await revokeOtherSessionsAfterCredentialChange({
      doc: { id: 7 },
      operation: 'update',
      req: { payload, user: { id: 7, _sid: 'sid-current' } } as unknown as PayloadRequest,
      context: {},
    })
    expect(updates).toHaveLength(0)
  })

  it('afterChange a zászlóra ír, majd a zászlót törli (nincs újra-belépés)', async () => {
    const { payload, updates } = createDb([current, other])
    const context: Record<string, unknown> = { [CREDENTIAL_CHANGE_REVOKE_KEY]: true }
    const req = { payload, user: { id: 7, _sid: 'sid-current' }, context } as unknown as PayloadRequest
    await revokeOtherSessionsAfterCredentialChange({
      doc: { id: 7 },
      operation: 'update',
      req,
      context,
    })
    expect(updates).toHaveLength(1)
    expect(context[CREDENTIAL_CHANGE_REVOKE_KEY]).toBe(false)
  })

  it('afterLogin sima belépésen NEM ír', async () => {
    const { payload, updates } = createDb([current, other])
    await revokeOtherSessionsAfterPasswordReset({
      req: {
        payload,
        url: '/api/users/login',
        user: { id: 7, _sid: 'sid-current' },
      } as unknown as PayloadRequest,
      user: { id: 7 },
      token: jwtWithSid('sid-current'),
    })
    expect(updates).toHaveLength(0)
  })

  it('afterLogin reset-passwordon a JWT sid-et tartja meg', async () => {
    const { payload, updates } = createDb([current, other])
    await revokeOtherSessionsAfterPasswordReset({
      req: {
        payload,
        url: 'http://localhost:3000/api/users/reset-password',
        user: { id: 7 },
      } as unknown as PayloadRequest,
      user: { id: 7 },
      token: jwtWithSid('sid-current'),
    })
    expect(updates).toHaveLength(1)
    expect(updates[0]?.sessions).toEqual([
      { id: 'sid-current', createdAt: current.createdAt, expiresAt: LATER },
    ])
  })

  it('BEST-EFFORT: a db-hiba nem dob', async () => {
    const payload = {
      db: {
        findOne: vi.fn(async () => {
          throw new Error('connection lost')
        }),
        updateOne: vi.fn(),
      },
    } as unknown as Payload
    await expect(
      revokeOtherSessionsAfterPasswordReset({
        req: { payload, url: '/api/users/reset-password' } as unknown as PayloadRequest,
        user: { id: 7 },
        token: jwtWithSid('sid-new'),
      }),
    ).resolves.toBeUndefined()
  })
})

describe('Users hook-bekötés', () => {
  it('a jelölő a beforeChange láncban van, a 403-as őr marad első', () => {
    const names = (Users.hooks?.beforeChange ?? []).map((hook) => hook.name)
    expect(names[0]).toBe('blockForeignCredentialChange')
    expect(names).toContain('markCredentialChangeForSessionRevoke')
  })

  it('az afterChange és az afterLogin láncban ott a visszavonás', () => {
    expect((Users.hooks?.afterChange ?? []).map((hook) => hook.name)).toContain(
      'revokeOtherSessionsAfterCredentialChangeHook',
    )
    expect((Users.hooks?.afterLogin ?? []).map((hook) => hook.name)).toContain(
      'revokeOtherSessionsAfterPasswordResetHook',
    )
    expect((Users.hooks?.afterLogin ?? []).map((hook) => hook.name)).toContain(
      'clearPasswordSetupPendingAfterLogin',
    )
  })

  it('a jelölő hook jelszó-update-re zászlót tesz, profilmezőre nem', () => {
    const mark = (Users.hooks?.beforeChange ?? []).find(
      (hook) => hook.name === 'markCredentialChangeForSessionRevoke',
    )
    expect(mark).toBeDefined()
    const context: Record<string, unknown> = {}
    void mark?.({
      data: { password: 'Teszt-Jelszo-Nem-Titok-1' },
      originalDoc: { id: 7, email: 'anna@example.test' },
      operation: 'update',
      req: { context },
    } as never)
    expect(context[CREDENTIAL_CHANGE_REVOKE_KEY]).toBe(true)

    const billingContext: Record<string, unknown> = {}
    void mark?.({
      data: { billingCity: 'Budapest' },
      originalDoc: { id: 7, email: 'anna@example.test' },
      operation: 'update',
      req: { context: billingContext },
    } as never)
    expect(billingContext[CREDENTIAL_CHANGE_REVOKE_KEY]).toBeUndefined()
  })
})
