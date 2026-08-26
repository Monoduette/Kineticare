import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  resolveClientIp,
  stripSensitiveFields,
  trustedForwardedForEntry,
  writeAuditLog,
  type AuditLogStore,
} from '../lib/audit'
import { auditActionsForChange, auditAfterChange } from '../plugins/audit'

describe('writeAuditLog', () => {
  it('sikeres íráskor továbbadja az adatot (requestId a req fejlécéből)', async () => {
    const create = vi.fn<AuditLogStore['create']>(async () => ({ id: 1 }))
    const store: AuditLogStore = { create }
    const headers = new Headers({ 'x-request-id': 'req-42' })

    const ok = await writeAuditLog({
      store,
      actor: 7,
      action: 'role-change',
      entityType: 'users',
      entityId: 99,
      before: { role: 'customer' },
      after: { role: 'staff' },
      req: { headers },
      ipAddress: '203.0.113.9',
    })

    expect(ok).toBe(true)
    expect(create).toHaveBeenCalledTimes(1)
    const args = create.mock.calls[0][0]
    expect(args.collection).toBe('audit-logs')
    expect(args.overrideAccess).toBe(true)
    expect(args.data).toMatchObject({
      actor: 7,
      action: 'role-change',
      entityType: 'users',
      entityId: '99',
      requestId: 'req-42',
      ipAddress: '203.0.113.9',
      before: { role: 'customer' },
      after: { role: 'staff' },
    })
  })

  it('best-effort: DB-hiba esetén NEM dob, hanem false-szal tér vissza és warn-naplot ír', async () => {
    const create = vi.fn<AuditLogStore['create']>(async () => {
      throw new Error('relation "audit_logs" does not exist')
    })
    const store: AuditLogStore = { create }

    await expect(
      writeAuditLog({ store, action: 'publish', entityType: 'pages', entityId: 1 }),
    ).resolves.toBe(false)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('a before/after-ból eltávolítja az érzékeny mezőket', async () => {
    const create = vi.fn<AuditLogStore['create']>(async () => ({ id: 1 }))
    const store: AuditLogStore = { create }

    await writeAuditLog({
      store,
      action: 'role-change',
      after: { email: 'a@b.hu', password: 'titok', hash: 'x', salt: 'y', role: 'staff' },
    })

    expect(create.mock.calls[0][0].data.after).toEqual({ email: 'a@b.hu', role: 'staff' })
  })
})

describe('stripSensitiveFields', () => {
  it('mélyen és tömbben is tisztít, a körkörös hivatkozást null-ra cseréli', () => {
    const circular: Record<string, unknown> = { name: 'x' }
    circular.self = circular
    const input = {
      user: { password: 'p', nested: [{ token: 't', keep: 1 }] },
      circular,
    }
    const output = stripSensitiveFields(input) as Record<string, unknown>
    expect(output.user).toEqual({ nested: [{ keep: 1 }] })
    expect((output.circular as Record<string, unknown>).self).toBeNull()
  })

  it('a kombinált érzékeny kulcsok is redaktilódnak (részleges illesztés), az azonosítók megmaradnak', () => {
    const input = {
      resetPasswordToken: 'tok',
      sessions: [{ id: 's1' }],
      accessToken: 'at',
      mySecretValue: 'x',
      email: 'vevo@example.test',
      name: 'Teszt',
      status: 'paid',
    }
    const output = stripSensitiveFields(input) as Record<string, unknown>
    expect(output).toEqual({ email: 'vevo@example.test', name: 'Teszt', status: 'paid' })
  })
})

describe('auditActionsForChange', () => {
  it('create mindig auditált', () => {
    expect(auditActionsForChange('pages', 'create', { id: 1 }, undefined)).toEqual(['create'])
  })

  it('publish-átmenetet észlel pages/posts (status) és products (_status) esetén', () => {
    expect(
      auditActionsForChange('pages', 'update', { status: 'published' }, { status: 'draft' }),
    ).toEqual(['publish'])
    // Újra-publish nem új esemény:
    expect(
      auditActionsForChange('posts', 'update', { status: 'published' }, { status: 'published' }),
    ).toEqual([])
    // A products a drafts _status mezőn publikál:
    expect(
      auditActionsForChange('products', 'update', { _status: 'published' }, { _status: 'draft' }),
    ).toEqual(['publish'])
  })

  it('orders refund-mező változásra refund-update', () => {
    expect(
      auditActionsForChange(
        'orders',
        'update',
        { refundReason: 'hibás termék', refundedAt: null },
        { refundReason: null, refundedAt: null },
      ),
    ).toEqual(['refund-update'])
    expect(auditActionsForChange('orders', 'update', { amount: 5000 }, { amount: 4990 })).toEqual(
      [],
    )
  })

  it('users role-változásra role-change', () => {
    expect(
      auditActionsForChange('users', 'update', { role: 'staff' }, { role: 'customer' }),
    ).toEqual(['role-change'])
    expect(
      auditActionsForChange('users', 'update', { lastLoginAt: 'b' }, { lastLoginAt: 'a' }),
    ).toEqual([])
  })

  it('users purchases hozzáadására purchase-change', () => {
    expect(
      auditActionsForChange('users', 'update', { purchases: [1, 2] }, { purchases: [1] }),
    ).toEqual(['purchase-change'])
  })

  it('users role-only változás: role-change, nincs purchase-change', () => {
    expect(
      auditActionsForChange(
        'users',
        'update',
        { role: 'staff', purchases: [1] },
        { role: 'customer', purchases: [1] },
      ),
    ).toEqual(['role-change'])
  })

  it('users role + purchases együtt: mindkét action', () => {
    expect(
      auditActionsForChange(
        'users',
        'update',
        { role: 'staff', purchases: [1, 2] },
        { role: 'customer', purchases: [1] },
      ),
    ).toEqual(['role-change', 'purchase-change'])
  })

  it('users create továbbra is csak create (nincs purchase-change zaj az új fiókon)', () => {
    expect(
      auditActionsForChange('users', 'create', { id: 1, purchases: [42] }, undefined),
    ).toEqual(['create'])
  })

  it('users purchases csak átrendezve vagy populate-olt alakban: nincs purchase-change', () => {
    expect(
      auditActionsForChange(
        'users',
        'update',
        { purchases: [2, 1] },
        { purchases: [{ id: 1 }, { id: 2 }] },
      ),
    ).toEqual([])
  })
})

type CreateCall = {
  collection: string
  data: Record<string, unknown>
  overrideAccess?: boolean
}

describe('audit plugin injekciós hook', () => {
  function createReq() {
    return {
      payload: {
        create: vi.fn<(args: CreateCall) => Promise<{ id: number }>>(async () => ({ id: 1 })),
      },
      headers: new Headers({ 'x-request-id': 'req-hook-1' }),
      user: { id: 5, role: 'owner' },
    }
  }

  it('role-change → audit-bejegyzés before/after-rel', async () => {
    const req = createReq()
    await auditAfterChange({
      doc: { id: 12, role: 'staff', email: 'x@y.hu' },
      previousDoc: { id: 12, role: 'customer', email: 'x@y.hu' },
      req: req as never,
      operation: 'update',
      collection: { slug: 'users' } as never,
    } as never)

    expect(req.payload.create).toHaveBeenCalledTimes(1)
    const args = req.payload.create.mock.calls[0][0]
    expect(args.collection).toBe('audit-logs')
    expect(args.data).toMatchObject({
      actor: 5,
      action: 'role-change',
      entityType: 'users',
      entityId: '12',
      requestId: 'req-hook-1',
    })
    expect(args.data.before).toMatchObject({ role: 'customer' })
    expect(args.data.after).toMatchObject({ role: 'staff' })
  })

  it('nem-auditált változás (pl. lastLoginAt) nem ír bejegyzést', async () => {
    const req = createReq()
    await auditAfterChange({
      doc: { id: 12, role: 'staff', lastLoginAt: 'b' },
      previousDoc: { id: 12, role: 'staff', lastLoginAt: 'a' },
      req: req as never,
      operation: 'update',
      collection: { slug: 'users' } as never,
    } as never)

    expect(req.payload.create).not.toHaveBeenCalled()
  })

  it('az audit-írás hibája nem törli meg az eredeti műveletet (best-effort)', async () => {
    const req = createReq()
    req.payload.create = vi.fn<(args: CreateCall) => Promise<{ id: number }>>(async () => {
      throw new Error('DB leállt')
    })
    const doc = { id: 3, status: 'published' }
    const result = await auditAfterChange({
      doc,
      previousDoc: { id: 3, status: 'draft' },
      req: req as never,
      operation: 'update',
      collection: { slug: 'pages' } as never,
    } as never)

    expect(result).toBe(doc)
  })
})

/**
 * Az `ipAddress` az audit-sor bizonyító ereje, és ugyanez a függvény adja a
 * kérés-korlát kulcsát is. A régi sorrend feltétel nélkül elfogadta a
 * `cf-connecting-ip` fejlécet, és az `x-forwarded-for` ELSŐ (kliens által
 * küldött) elemét használta — mindkettő hamisítható, mert az éles kiszolgálás
 * előtt nincs Cloudflare.
 */
describe('resolveClientIp — megbízható IP proxy mögül', () => {
  afterEach(() => {
    delete process.env.TRUST_CF_CONNECTING_IP
    delete process.env.TRUSTED_PROXY_HOP_COUNT
  })

  it('a cf-connecting-ip alapból FIGYELMEN KÍVÜL marad (a régi kódon ez nyert volna)', () => {
    const headers = new Headers({
      'cf-connecting-ip': '9.9.9.9',
      'x-forwarded-for': '1.1.1.1, 203.0.113.9',
    })
    expect(resolveClientIp(headers)).toBe('203.0.113.9')
  })

  it('a cf-connecting-ip CSAK TRUST_CF_CONNECTING_IP=true mellett számít', () => {
    process.env.TRUST_CF_CONNECTING_IP = 'true'
    const headers = new Headers({
      'cf-connecting-ip': '9.9.9.9',
      'x-forwarded-for': '1.1.1.1, 203.0.113.9',
    })
    expect(resolveClientIp(headers)).toBe('9.9.9.9')
  })

  it('bekapcsolt kapcsoló mellett is az x-forwarded-for marad, ha nincs CF-fejléc', () => {
    process.env.TRUST_CF_CONNECTING_IP = 'true'
    expect(resolveClientIp(new Headers({ 'x-forwarded-for': '1.1.1.1, 203.0.113.9' }))).toBe(
      '203.0.113.9',
    )
  })

  it('x-real-ip a végső tartalék; fejléc nélkül undefined (nem dob)', () => {
    expect(resolveClientIp(new Headers({ 'x-real-ip': '198.51.100.5' }))).toBe('198.51.100.5')
    expect(resolveClientIp(new Headers())).toBeUndefined()
    expect(resolveClientIp(undefined)).toBeUndefined()
  })

  it('üres/whitespace fejléc hiányzónak számít', () => {
    expect(resolveClientIp(new Headers({ 'x-forwarded-for': '   ' }))).toBeUndefined()
    expect(
      resolveClientIp(new Headers({ 'x-forwarded-for': ' , , ', 'x-real-ip': '198.51.100.5' })),
    ).toBe('198.51.100.5')
  })
})

describe('trustedForwardedForEntry — a lánc megbízható eleme', () => {
  it('alapból (1 hop) a JOBB SZÉLSŐ elem — azt a saját edge-proxynk fűzi hozzá', () => {
    expect(trustedForwardedForEntry('1.1.1.1, 2.2.2.2, 203.0.113.9', 1)).toBe('203.0.113.9')
  })

  it('több hop esetén annyival beljebb', () => {
    expect(trustedForwardedForEntry('1.1.1.1, 203.0.113.9, 10.0.0.9', 2)).toBe('203.0.113.9')
  })

  it('a hop-számnál rövidebb lánc → a legkorábbi elérhető elem (sosem dob)', () => {
    expect(trustedForwardedForEntry('203.0.113.9', 3)).toBe('203.0.113.9')
  })

  it('üres bejegyzéseket kiszűr; használható elem híján undefined', () => {
    expect(trustedForwardedForEntry('1.1.1.1, , 203.0.113.9 ', 1)).toBe('203.0.113.9')
    expect(trustedForwardedForEntry(' , , ', 1)).toBeUndefined()
    expect(trustedForwardedForEntry(undefined, 1)).toBeUndefined()
  })
})
