import { describe, expect, it, vi } from 'vitest'

// A közös tároló-, zár- és Barion-mockokat a szolgáltatás importja előtt kell regisztrálni.
import { access, fixture, locks, mail, store } from '../refund-fixture'
import { resolveAlertCode } from '../../lib/alerts/classify'
import type { SendResult } from '../../lib/email/types'
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

  // Az élő fő termék neve magánhangzóval kezdődik (restore-legacy-content.ts):
  // „Az „Otthoni…”, nem „A „Otthoni…”. Név nélkül nincs kettőzött névelő.
  it.each([
    [
      'partial',
      undefined,
      ['Otthoni KézRehab Program'],
      'Az „Otthoni KézRehab Program” kurzushoz tartozó hozzáférésed megmarad.',
    ],
    [
      'full',
      'kept',
      ['Otthoni KézRehab Program'],
      'Az „Otthoni KézRehab Program” kurzushoz tartozó hozzáférésed megmarad, mert',
    ],
    [
      'full',
      'revoked',
      ['Otthoni KézRehab Program'],
      'Az „Otthoni KézRehab Program” kurzushoz tartozó hozzáférésed a visszatérítéssel megszűnt.',
    ],
    [
      'full',
      'revoked',
      ['Kézterápia alapok'],
      'A „Kézterápia alapok” kurzushoz tartozó hozzáférésed a visszatérítéssel megszűnt.',
    ],
    ['partial', undefined, [''], 'A kurzushoz tartozó hozzáférésed megmarad.'],
    ['full', 'revoked', [], 'A kurzushoz tartozó hozzáférésed a visszatérítéssel megszűnt.'],
  ] as const)(
    '%s/%s, %j: a névelő a kurzusnévhez igazodik a szövegben és a HTML-ben is',
    (kind, accessState, courseTitles, expected) => {
      const email = refundNoticeEmail({
        ...BASE,
        kind,
        access: accessState,
        courseTitles,
        document: kind === 'partial' ? 'corrective' : 'storno',
      })
      for (const part of [email.text, email.html]) {
        expect(part).toContain(expected)
        expect(part).not.toMatch(/A „[AÁEÉIÍOÓÖŐUÚÜŰ]|A a kurzushoz/u)
      }
    },
  )

  it('a részleges utáni, maradékot lezáró visszatérítés összegét nem a rendelés árának mondja', () => {
    const closing = refundNoticeEmail({ ...BASE, amountHuf: 15000, remainderAfterPartial: true })
    for (const part of [closing.text, closing.html]) {
      expect(part).toMatch(/rendelésedből a fennmaradó 15(?:\s|&nbsp;)000(?:\s|&nbsp;)Ft összeget/u)
      expect(part).toContain('Visszatérítettük a fennmaradó összeget')
      expect(part).not.toMatch(/rendelésed 15(?:\s|&nbsp;)000/u)
    }
    // Az első, teljes visszatérítés szövege változatlan.
    expect(refundNoticeEmail(BASE).text).toMatch(/rendelésed 79\s500\sFt összegét/u)
  })

  it('a más jogon megmaradó hozzáférést nem nevezi megszűntnek', () => {
    const { text } = refundNoticeEmail({ ...BASE, access: 'kept' })
    expect(text).toContain('hozzáférésed megmarad')
    expect(text).not.toContain('megszűnt')
  })
})

function spyLogger() {
  const errors: string[] = []
  const contexts: Array<Record<string, unknown>> = []
  const log: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: (message, context) => {
      errors.push(message)
      contexts.push((context ?? {}) as Record<string, unknown>)
    },
    child: () => log,
  }
  return { log, errors, contexts }
}

describe('a visszatérítési értesítő kiküldése a lezárás után', () => {
  it('teljes visszatérítés: egyszer, minden zár elengedése után, refund:<intentId> kulccsal, a küldés bizonyítékával', async () => {
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
    // Egyetlen advisory-zár sem áll, a „Feldolgozás folytatása” koordinátor-zárja
    // (refund-recovery:order:<id>) sem: annak tétlen tranzakcióját a Postgres
    // 60 s után bontja, a levél ideje nem számíthat bele (advisory-lock.ts).
    expect(heldAtSend).toEqual([[]])
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

  // A valódi withAdvisoryLock a kész szakasz UTÁN is elbukhat: ha a tétlen
  // zár-tranzakciót a Postgres közben bontotta, a COMMIT és a ROLLBACK is hibát
  // dob („Failed query: rollback”). A kísérlet ekkor már committed, a levelet
  // más hívó nem küldi el.
  it('ha a koordinátor-zár csak a kész lezárás után hibázik, a levél akkor is kimegy, egyszer és zár nélkül', async () => {
    const f = fixture()
    Object.assign(f.order, { customerEmail: 'vasarlo@example.test' })
    // Az első futás helyi feldolgozása elakad (a rendelés írása), a pénz a Barionnál már visszament.
    f.failures.order = true
    await expect(f.start()).rejects.toMatchObject({ status: 503 })
    expect(store.intents.get(f.payload)?.state).toBe('provider_succeeded')
    expect(mail.send).not.toHaveBeenCalled()
    f.failures.order = false
    const heldAtSend: string[][] = []
    mail.send.mockImplementation(async () => {
      heldAtSend.push([...locks.held])
      return { ok: true, provider: 'resend', id: 'SYNTHETIC-MSG-1' }
    })
    locks.failAfterSection = `refund-recovery:order:${f.order.id}`
    await f.recover()
    // A koordinátor-zár valóban a kész szakasz után bukott el.
    expect(locks.failAfterSection).toBeNull()
    expect(store.intents.get(f.payload)?.state).toBe('committed')
    expect(heldAtSend).toEqual([[]])
    expect(f.audits.filter((row) => row.action === 'refund-notice-email')).toHaveLength(1)
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

  it('a részleges után a maradékot lezáró visszatérítés levele a fennmaradó összeget mondja', async () => {
    const f = fixture()
    Object.assign(f.order, { customerEmail: 'vasarlo@example.test' })
    await f.start({ amountHuf: 5000 })
    await refundOrder({ ...f.options, input: { operationKey: 'E'.repeat(43) } })
    expect(mail.send).toHaveBeenCalledTimes(2)
    const first = mail.send.mock.calls[0]![0] as { text: string }
    const closing = mail.send.mock.calls[1]![0] as { text: string }
    expect(first.text).toMatch(/rendelésedből 5000\sFt összeget/u)
    expect(closing.text).toMatch(/rendelésedből a fennmaradó 15\s000\sFt összeget/u)
    expect(closing.text).not.toMatch(/rendelésed 15\s000\sFt összegét/u)
  })

  // A hozzáférés sorsát a rendezés nyugtája (access-store.ts
  // preservedProductIds) dönti el; a mock csak ezt a mezőt teszi a fixtúra
  // valódi nyugtájára, ahogy az access-store írja.
  it.each([
    ['minden kurzus más jogon megmarad', [42, 99], 'hozzáférésed megmarad, mert', 'megszűnt'],
    [
      'csak egy kurzus marad meg',
      [99],
      'A rendeléshez kötött kurzushozzáférésed a visszatérítéssel megszűnt; ami más',
      'mert az más vásárlásod',
    ],
    [
      'semmi nem marad meg',
      [],
      'Az „Otthoni KézRehab Program” és „Kézterápia alapok” kurzushoz tartozó hozzáférésed a visszatérítéssel megszűnt.',
      'megmarad',
    ],
  ] as const)(
    'teljes visszatérítés, %s: a levél a rendezés nyugtája szerint beszél a hozzáférésről',
    async (_name, preserved, expected, absent) => {
      const f = fixture()
      Object.assign(f.order, {
        customerEmail: 'vasarlo@example.test',
        items: [
          { product: 42, quantity: 1, titleSnapshot: 'Otthoni KézRehab Program' },
          { product: 99, quantity: 1, titleSnapshot: 'Kézterápia alapok' },
        ],
      })
      const apply = access.apply.getMockImplementation()!
      access.apply.mockImplementationOnce(async (...args: Parameters<typeof apply>) => {
        const result = await apply(...args)
        const rows = f.audits.filter((row) => row.action === 'refund-cleanup-done')
        const done = rows[rows.length - 1]!
        Object.assign(done.after as Record<string, unknown>, { preservedProductIds: preserved })
        return result
      })
      await expect(f.start()).resolves.toMatchObject({ type: 'full' })
      expect(mail.send).toHaveBeenCalledTimes(1)
      const { text } = mail.send.mock.calls[0]![0] as { text: string }
      expect(text).toContain(expected)
      expect(text).not.toContain(absent)
    },
  )

  it('éles környezetben a beállítatlan e-mail-szolgáltató (noop) RIASZTÁS, a visszatérítés lezárul', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const f = fixture()
    Object.assign(f.order, { customerEmail: 'vasarlo@example.test' })
    const { log, errors } = spyLogger()
    await expect(
      refundOrder({ ...f.options, input: { operationKey: 'A'.repeat(43) }, logger: log }),
    ).resolves.toMatchObject({ type: 'full' })
    expect(store.intents.get(f.payload)?.state).toBe('committed')
    expect(mail.send).toHaveBeenCalledTimes(1)
    expect(
      errors.filter(
        (message) => message.startsWith('RIASZTÁS') && message.includes('e-mail-szolgáltató'),
      ),
    ).toHaveLength(1)
  })

  it('nem éles környezetben a noop szolgáltató nem riaszt', async () => {
    vi.stubEnv('NODE_ENV', 'test')
    const f = fixture()
    Object.assign(f.order, { customerEmail: 'vasarlo@example.test' })
    const { log, errors } = spyLogger()
    await expect(
      refundOrder({ ...f.options, input: { operationKey: 'A'.repeat(43) }, logger: log }),
    ).resolves.toMatchObject({ type: 'full' })
    expect(mail.send).toHaveBeenCalledTimes(1)
    expect(errors).toEqual([])
  })

  // Végleges elutasítás: az átmeneti hibák újrapróbálását és a bizonytalan
  // riasztást a w1b-r1-2-refund-notice-retry.test.ts bizonyítja a
  // Resend-határon (W1B-5).
  it('a véglegesen elutasított küldés nem változtat a visszatérítés eredményén, és RIASZTÁS-t ad', async () => {
    const f = fixture()
    Object.assign(f.order, { customerEmail: 'vasarlo@example.test' })
    mail.send.mockResolvedValue({
      ok: false,
      provider: 'resend',
      retryable: false,
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

  // Az SMTP-szolgáltató a levél tartalma után megszakadt kapcsolatot
  // `deliveryUncertain`-nel adja (a lánc: email-smtp-kezbesites.test.ts): a
  // levél célba érhetett, a „NEM ment ki, küldd el kézzel” második levelet
  // íratna a vevőnek.
  it('bizonytalan SMTP-kézbesítésnél a RIASZTÁS ellenőrzést kér a „NEM ment ki” helyett, és küldést sem rögzít', async () => {
    const f = fixture()
    Object.assign(f.order, { customerEmail: 'vasarlo@example.test' })
    const uncertain: SendResult = {
      ok: false,
      provider: 'smtp',
      retryable: false,
      deliveryUncertain: true,
      error: 'SYNTHETIC: a kapcsolat a levél lezárása után megszakadt',
    }
    mail.send.mockResolvedValue(uncertain)
    const { log, errors, contexts } = spyLogger()
    await expect(
      refundOrder({ ...f.options, input: { operationKey: 'A'.repeat(43) }, logger: log }),
    ).resolves.toMatchObject({ type: 'full' })
    expect(store.intents.get(f.payload)?.state).toBe('committed')
    expect(mail.send).toHaveBeenCalledTimes(1)
    const notices = errors
      .map((message, index) => ({ message, context: contexts[index] }))
      .filter(({ message }) => message.includes('visszatérítési értesítő'))
    expect(notices).toHaveLength(1)
    const [notice] = notices
    // A riasztás-csatorna csak a riasztásnak besorolt sort küldi el a tulajdonosnak.
    expect(resolveAlertCode(notice!.message, {}, notice!.context)).not.toBeNull()
    // Kézi újraküldés előtt a levélküldő szolgáltató naplóját kéri megnézni.
    expect(notice!.message).toMatch(/bizonytalan/iu)
    expect(notice!.message).toMatch(/szolgáltató naplójában/u)
    expect(notice!.message).not.toContain('NEM ment ki')
    expect(f.audits.filter((row) => row.action === 'refund-notice-email')).toEqual([])
  })
})
