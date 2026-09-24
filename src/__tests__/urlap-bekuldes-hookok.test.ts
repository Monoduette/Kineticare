import {
  APIError,
  type CollectionAfterChangeHook,
  type CollectionBeforeValidateHook,
} from 'payload'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { budapestDateTimeString } from '../lib/date/budapest'
import { logger } from '../lib/logger'
import configPromise from '../payload.config'

/**
 * A `form-submissions` hookjainak szerveroldali javításai (2026-09-24):
 *  - a Turnstile-ellenőrzés csak CREATE-en fut (a token egyszer használatos,
 *    update-en a stáb admin-módosítása bukna el);
 *  - elérhetetlen siteverify esetén 503 + magyar üzenet, nem kezeletlen 500
 *    (amit a Payload „Something went wrong."-ra cserélne);
 *  - a stáb-értesítő „Beküldve" ideje budapesti, a Reply-To a beküldő címe;
 *  - üres CONTACT_STAFF_EMAILS élesben warn-szintű napló.
 *
 * Valódi hálózati hívás nincs: a `fetch` stubolt, a `sendMail` mockolt.
 */

const sendMailMock = vi.hoisted(() =>
  vi.fn<(input: Record<string, unknown>) => Promise<{ ok: true; provider: string }>>(async () => ({
    ok: true,
    provider: 'noop',
  })),
)

vi.mock('../lib/email', async (importOriginal) => {
  const eredeti = await importOriginal<typeof import('../lib/email')>()
  return { ...eredeti, sendMail: sendMailMock }
})

const TESZT_TOKEN = 'teszt-turnstile-jel'
const ELERHETETLEN_UZENET =
  'A spam-ellenőrzés most nem érhető el. Próbáld újra néhány perc múlva, vagy hívj minket telefonon.'

async function bekuldesHookok(): Promise<{
  turnstile: CollectionBeforeValidateHook
  stabErtesito: CollectionAfterChangeHook
}> {
  const config = await configPromise
  const gyujtemeny = (config.collections ?? []).find((c) => c.slug === 'form-submissions')
  const beforeValidate = gyujtemeny?.hooks?.beforeValidate ?? []
  const afterChange = gyujtemeny?.hooks?.afterChange ?? []
  expect(beforeValidate).toHaveLength(2)
  expect(afterChange.length).toBeGreaterThanOrEqual(1)
  return {
    turnstile: beforeValidate[1],
    stabErtesito: afterChange[afterChange.length - 1],
  }
}

const validateArgs = (data: unknown, operation: 'create' | 'update') =>
  ({ data, operation }) as unknown as Parameters<CollectionBeforeValidateHook>[0]

const afterChangeArgs = (doc: unknown, formKind: string) =>
  ({
    doc,
    operation: 'create',
    req: { context: { kineticareFormKind: formKind } },
  }) as unknown as Parameters<CollectionAfterChangeHook>[0]

async function hibaja(futtat: () => Promise<unknown>): Promise<unknown> {
  return futtat().then(
    () => null,
    (caught: unknown) => caught,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.useRealTimers()
  sendMailMock.mockClear()
})

describe('Turnstile-ellenőrzés a form-submissions beforeValidate-láncában', () => {
  beforeEach(() => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'teszt-titok-nem-valodi')
  })

  it('update-en NEM fut (a tárolt, elhasznált token ne buktassa a stáb módosítását)', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('update-en nem szabad siteverify-t hívni')
    })
    vi.stubGlobal('fetch', fetchMock)
    const { turnstile } = await bekuldesHookok()
    const data = { turnstileToken: TESZT_TOKEN, submissionData: [] }

    await expect(turnstile(validateArgs(data, 'update'))).resolves.toBe(data)
    // Token nélküli részleges update sem bukik el.
    await expect(turnstile(validateArgs({}, 'update'))).resolves.toEqual({})
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('create: token nélkül a korábbi 400-as magyar hiba marad', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('token nélkül nem szabad hívni')
      }),
    )
    const { turnstile } = await bekuldesHookok()
    const hiba = await hibaja(async () => turnstile(validateArgs({}, 'create')))
    expect(hiba).toBeInstanceOf(APIError)
    expect((hiba as APIError).status).toBe(400)
    expect((hiba as APIError).message).toMatch(/nem futott le/)
  })

  it('create: sikeres ellenőrzés átengedi, időkorláttal hívja a siteverify-t', async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      async () => new Response(JSON.stringify({ success: true }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { turnstile } = await bekuldesHookok()
    const data = { turnstileToken: TESZT_TOKEN }

    await expect(turnstile(validateArgs(data, 'create'))).resolves.toBe(data)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('create: elutasított token → a korábbi 400-as magyar hiba', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 200 })),
    )
    const { turnstile } = await bekuldesHookok()
    const hiba = await hibaja(async () =>
      turnstile(validateArgs({ turnstileToken: TESZT_TOKEN }, 'create')),
    )
    expect(hiba).toBeInstanceOf(APIError)
    expect((hiba as APIError).status).toBe(400)
    expect((hiba as APIError).message).toMatch(/nem sikerült/)
  })

  const elerhetetlenEsetek: Array<[string, () => Promise<Response>]> = [
    [
      'hálózati hiba',
      async () => {
        throw new TypeError('fetch failed')
      },
    ],
    [
      'időtúllépés',
      async () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
      },
    ],
    ['nem 2xx válasz', async () => new Response('Bad Gateway', { status: 502 })],
    ['nem JSON törzs', async () => new Response('<html>hiba</html>', { status: 200 })],
    ['üres objektum (success nélkül)', async () => Response.json({}, { status: 200 })],
    ['tömb törzs', async () => Response.json([], { status: 200 })],
    ['nem logikai success', async () => Response.json({ success: 'true' }, { status: 200 })],
  ]

  it.each(elerhetetlenEsetek)(
    'create: %s → 503-as APIError magyar üzenettel, token nélküli warn-naplóval',
    async (_nev, valasz) => {
      vi.stubGlobal('fetch', vi.fn(valasz))
      const warnSpy = vi.spyOn(logger, 'warn')
      const { turnstile } = await bekuldesHookok()

      const hiba = await hibaja(async () =>
        turnstile(validateArgs({ turnstileToken: TESZT_TOKEN }, 'create')),
      )

      expect(hiba).toBeInstanceOf(APIError)
      expect((hiba as APIError).status).toBe(503)
      expect((hiba as APIError).message).toBe(ELERHETETLEN_UZENET)
      // A 503 nyilvános hiba: a Payload nem cseréli „Something went wrong."-ra.
      expect((hiba as APIError).isPublic).toBe(true)
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(TESZT_TOKEN)
    },
  )
})

describe('budapestDateTimeString', () => {
  it('nyári időben az UTC-hez két órát ad (06:35Z → 08:35)', () => {
    expect(budapestDateTimeString(new Date('2026-09-15T06:35:00Z'))).toBe('2026. 09. 15. 08:35')
  })

  it('téli időben egy órát, napfordulón a magyar napot adja', () => {
    expect(budapestDateTimeString(new Date('2026-01-15T23:05:00Z'))).toBe('2026. 01. 16. 00:05')
  })
})

describe('stáb-értesítő (form-submissions afterChange)', () => {
  const STAB_CIM = 'stab@kineticare.test'

  function sor(field: string, value: string): { field: string; value: string } {
    return { field, value }
  }

  function elsoLevel(): Record<string, unknown> {
    const hivas = sendMailMock.mock.calls[0]
    expect(hivas).toBeDefined()
    return hivas?.[0] ?? {}
  }

  it('időpontkérés: a „Beküldve" budapesti idő, a Reply-To a beküldő címe', async () => {
    vi.stubEnv('CONTACT_STAFF_EMAILS', STAB_CIM)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-15T06:35:00Z'))
    const { stabErtesito } = await bekuldesHookok()
    const doc = {
      submissionData: [
        sor('name', 'Kovács Anna'),
        sor('phone', '+36 30 123 4567'),
        sor('email', 'anna@pelda.hu'),
        sor('availability', 'hétköznap délelőtt'),
        sor('reason', 'Csuklótörés utáni rehabilitáció'),
      ],
    }

    await stabErtesito(afterChangeArgs(doc, 'appointment'))

    const level = elsoLevel()
    expect(level.to).toEqual([STAB_CIM])
    expect(level.replyTo).toBe('anna@pelda.hu')
    expect(String(level.text)).toContain('Beküldve: 2026. 09. 15. 08:35')
    expect(String(level.html)).toContain('2026. 09. 15. 08:35')
  })

  it('kapcsolat-űrlap: érvényes e-mail → Reply-To a beküldőre', async () => {
    vi.stubEnv('CONTACT_STAFF_EMAILS', STAB_CIM)
    const { stabErtesito } = await bekuldesHookok()
    const doc = {
      submissionData: [
        sor('name', 'Nagy Péter'),
        sor('email', '  peter@pelda.hu '),
        sor('message', 'Érdeklődnék a kurzusról.'),
      ],
    }

    await stabErtesito(afterChangeArgs(doc, 'contact'))

    expect(sendMailMock).toHaveBeenCalledTimes(1)
    expect(elsoLevel().replyTo).toBe('peter@pelda.hu')
  })

  it('érvénytelen vagy hiányzó beküldői címnél nincs Reply-To', async () => {
    vi.stubEnv('CONTACT_STAFF_EMAILS', STAB_CIM)
    const { stabErtesito } = await bekuldesHookok()

    await stabErtesito(
      afterChangeArgs({ submissionData: [sor('email', 'nem-email\r\nBcc: x@y.hu')] }, 'contact'),
    )
    await stabErtesito(
      afterChangeArgs({ submissionData: [sor('phone', '+36 30 123 4567')] }, 'appointment'),
    )

    expect(sendMailMock).toHaveBeenCalledTimes(2)
    for (const hivas of sendMailMock.mock.calls) {
      expect(hivas[0]).not.toHaveProperty('replyTo')
    }
  })

  it('üres CONTACT_STAFF_EMAILS élesben warn-szintű napló, személyes adat nélkül', async () => {
    vi.stubEnv('CONTACT_STAFF_EMAILS', '')
    vi.stubEnv('NODE_ENV', 'production')
    const warnSpy = vi.spyOn(logger, 'warn')
    const { stabErtesito } = await bekuldesHookok()
    const doc = {
      submissionData: [sor('name', 'Kovács Anna'), sor('email', 'anna@pelda.hu')],
    }

    await expect(stabErtesito(afterChangeArgs(doc, 'contact'))).resolves.toBe(doc)

    expect(sendMailMock).not.toHaveBeenCalled()
    const uresNaplo = warnSpy.mock.calls.filter(([uzenet]) =>
      String(uzenet).includes('CONTACT_STAFF_EMAILS'),
    )
    expect(uresNaplo).toHaveLength(1)
    const naplo = JSON.stringify(uresNaplo)
    expect(naplo).not.toContain('anna@pelda.hu')
    expect(naplo).not.toContain('Kovács')
  })

  it('üres CONTACT_STAFF_EMAILS fejlesztésben nem warn (megszokott állapot)', async () => {
    vi.stubEnv('CONTACT_STAFF_EMAILS', '')
    vi.stubEnv('NODE_ENV', 'development')
    const warnSpy = vi.spyOn(logger, 'warn')
    const { stabErtesito } = await bekuldesHookok()

    await stabErtesito(afterChangeArgs({ submissionData: [] }, 'contact'))

    expect(sendMailMock).not.toHaveBeenCalled()
    expect(
      warnSpy.mock.calls.some(([uzenet]) => String(uzenet).includes('CONTACT_STAFF_EMAILS')),
    ).toBe(false)
  })
})
