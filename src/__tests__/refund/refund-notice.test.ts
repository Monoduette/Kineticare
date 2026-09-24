import { describe, expect, it } from 'vitest'

// A közös tároló-, zár- és Barion-mockokat a szolgáltatás importja előtt kell regisztrálni.
import { fixture, locks, mail, store } from '../refund-fixture'
import type { Logger } from '../../lib/logger'
import { refundNoticeEmail, type RefundNoticeInput } from '../../lib/email/templates/refund'
import { refundOrder } from '../../lib/refund/refund-order'

/**
 * Vevői visszatérítési értesítő (a-refund-6, K14): a sablon csak igaz,
 * garantálható állítást tesz, és a levél a lezárás (committed) után
 * pontosan egyszer megy ki, Resend Idempotency-Key-jel.
 */

const BASE: RefundNoticeInput = {
  orderNumber: 'KH-2026-000123',
  buyerName: 'Teszt Vásárló',
  amountHuf: 79500,
  refundedAt: '2026-09-24T21:30:00.000Z',
  kind: 'full',
  access: 'revoked',
  courseTitles: ['Kézterápia alapok'],
  document: 'storno',
  supportEmail: 'info@kineticare.hu',
}

describe('a visszatérítési értesítő sablonja', () => {
  it.each([
    ['full', 'storno', 'stornószámlát'],
    ['partial', 'corrective', 'helyesbítő számlát'],
  ] as const)(
    '%s: összeg, rendelésszám, a pénz útja és a Számlázz.hu bizonylata a szövegben és a HTML-ben is',
    (kind, document, documentWord) => {
      const email = refundNoticeEmail({ ...BASE, kind, document })
      for (const part of [email.text, email.html]) {
        expect(part).toContain('KH-2026-000123')
        expect(part).toMatch(/79(?:\s|&nbsp;)500(?:\s|&nbsp;)Ft/u)
        expect(part).toContain('Barionon keresztül arra a bankkártyára vagy Barion-tárcába')
        expect(part).toContain(documentWord)
        expect(part).toContain('Számlázz.hu külön e-mailben küldi el')
        expect(part).toContain('info@kineticare.hu')
      }
      // A budapesti naptári nap számít: 21:30 UTC = szeptember 24., 23:30.
      expect(email.text).toContain('2026. 09. 24.')
      expect(email.subject).toBe('Visszatérítés: KH-2026-000123')
    },
  )

  it('nem ígér banki határidőt, és nem használ töltelék-gondolatjelet', () => {
    for (const kind of ['full', 'partial', 'order-not-accepted'] as const) {
      const { text } = refundNoticeEmail({
        ...BASE,
        kind,
        document: kind === 'full' ? 'storno' : 'none',
      })
      expect(text).not.toMatch(/munkanap|órán belül|napon belül jóváír/u)
      expect(text).toContain('a jóváírás ideje a kártyát kibocsátó banktól függ')
      expect(text).not.toMatch(/ [–—] /u)
    }
  })

  it('a nem teljesített rendelésnél (dupla fizetés) nem állít bizonylatot, és a meglévő hozzáférést megtartja', () => {
    const { text } = refundNoticeEmail({ ...BASE, kind: 'order-not-accepted', document: 'none' })
    expect(text).toContain('nem tudtuk teljesíteni')
    expect(text).toContain('az változatlanul megmarad')
    expect(text).not.toContain('Számlázz.hu')
  })

  it('a más jogon megmaradó hozzáférést nem nevezi megszűntnek', () => {
    const { text } = refundNoticeEmail({ ...BASE, access: 'kept' })
    expect(text).toContain('hozzáférésed megmarad')
    expect(text).not.toContain('megszűnt')
  })
})

function spyLogger() {
  const errors: string[] = []
  const log: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (message) => {
      errors.push(message)
    },
    child: () => log,
  }
  return { log, errors }
}

describe('a visszatérítési értesítő kiküldése a lezárás után', () => {
  it('teljes visszatérítés: egyszer, a rendelés-záron kívül, refund:<intentId> kulccsal, a küldés bizonyítékával', async () => {
    const f = fixture()
    Object.assign(f.order, { customerEmail: 'vasarlo@example.test' })
    const heldAtSend: string[][] = []
    mail.send.mockImplementation(async () => {
      heldAtSend.push([...locks.held])
      return { ok: true, provider: 'resend', id: 'SYNTHETIC-MSG-1' }
    })
    await expect(f.start()).resolves.toMatchObject({ type: 'full' })
    const intent = store.intents.get(f.payload)!
    expect(intent.state).toBe('committed')
    expect(mail.send).toHaveBeenCalledTimes(1)
    expect(mail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'vasarlo@example.test',
        replyTo: 'info@kineticare.hu',
        idempotencyKey: `refund:${intent.id}`,
        text: expect.stringContaining('stornószámlát'),
      }),
    )
    expect(heldAtSend[0]).not.toContain(`order:mutate:${f.order.id}`)
    expect(f.audits.filter((row) => row.action === 'refund-notice-email')).toEqual([
      expect.objectContaining({
        after: expect.objectContaining({
          providerMessageId: 'SYNTHETIC-MSG-1',
          idempotencyKey: `refund:${intent.id}`,
          kind: 'full',
          document: 'storno',
        }),
      }),
    ])
    // Egy későbbi „Feldolgozás folytatása” nem küldi újra.
    await f.recover()
    expect(mail.send).toHaveBeenCalledTimes(1)
  })

  it('részleges visszatérítés: a helyesbítő számlát nevezi meg, és a hozzáférés megmarad', async () => {
    const f = fixture()
    Object.assign(f.order, { customerEmail: 'vasarlo@example.test' })
    await f.start({ amountHuf: 5000 })
    expect(mail.send).toHaveBeenCalledTimes(1)
    const { text } = mail.send.mock.calls[0]![0] as { text: string }
    expect(text).toContain('helyesbítő számlát')
    expect(text).toContain('hozzáférésed megmarad')
  })

  it('a sikertelen küldés nem változtat a visszatérítés eredményén, és RIASZTÁS-t ad', async () => {
    const f = fixture()
    Object.assign(f.order, { customerEmail: 'vasarlo@example.test' })
    mail.send.mockResolvedValue({
      ok: false,
      provider: 'resend',
      retryable: true,
      error: 'SYNTHETIC',
    })
    const { log, errors } = spyLogger()
    await expect(
      refundOrder({ ...f.options, input: { operationKey: 'A'.repeat(43) }, logger: log }),
    ).resolves.toMatchObject({ type: 'full' })
    expect(store.intents.get(f.payload)?.state).toBe('committed')
    expect(errors.filter((message) => message.includes('értesítő NEM ment ki'))).toHaveLength(1)
  })

  it('a Barionhoz el sem jutott (előkészítésnél megszakadt) kísérlet után nem megy levél', async () => {
    const f = fixture()
    Object.assign(f.order, { customerEmail: 'vasarlo@example.test' })
    f.failures.receipt = 'refund-prepared'
    await expect(f.start()).rejects.toMatchObject({ status: 409 })
    expect(mail.send).not.toHaveBeenCalled()
  })
})
