import type { Payload } from 'payload'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { freeCourseEmail } from '../lib/free-course/email'
import {
  createFreeCourseRequestHandler,
  verifyTurnstileToken,
  FREE_COURSE_EMAIL_RULE,
  FREE_COURSE_IP_RULE,
  FREE_COURSE_TURNSTILE_ERROR,
  FREE_COURSE_UNAVAILABLE_ERROR,
  resolveServerUrlOrNull,
} from '../lib/free-course/route-handler'
import { grantFreeCoursesToUser } from '../lib/free-course-grant'
import {
  requestFreeCourseAccess,
  resolveFreeCourseRequestActions,
  FREE_COURSE_TOKEN_TTL_DAYS,
  FREE_COURSE_TOKEN_TTL_MS,
} from '../lib/free-course/request-access'
import { INVITE_TOKEN_TTL_MS } from '@/lib/customer-import/invite'

vi.mock('../lib/free-course-grant', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/free-course-grant')>()
  return {
    ...actual,
    grantFreeCoursesToUser: vi.fn(actual.grantFreeCoursesToUser),
  }
})
import { FREE_COURSE_GENERIC_ERROR } from '../lib/free-course/ui-text'
import {
  parseFreeCourseRequestBody,
  validateFreeCourseForm,
  FREE_COURSE_CONSENT_ERROR,
  FREE_COURSE_EMAIL_FORMAT_ERROR,
  FREE_COURSE_NAME_REQUIRED_ERROR,
} from '../lib/free-course/validation'
import type { Logger } from '../lib/logger'
import { SlidingWindowRateLimiter } from '../lib/security/rate-limit'

/**
 * INGYENES KURZUS IGÉNYLÉSE (név + e-mail → hozzáférés + belépő link).
 *
 * A tulajdonos kérése: a lead-magnet SOS villámkurzushoz regisztráció és
 * fizetés nélkül hozzá lehessen jutni. Ez a fájl a folyamat NÉGY kritikus
 * viselkedését rögzíti, plusz a védelmi réteget:
 *
 *  (a) ÚJ e-mail-cím → fiók + hozzáférés + kiküldött levél;
 *  (b) MEGLÉVŐ e-mail-cím → NINCS második fiók, és a válasz BITRE ugyanaz
 *      (fiók-felderítés elleni védelem);
 *  (c) KÉTSZERI beküldés idempotens: se második fiók, se duplázott hozzáférés;
 *  (d) HIÁNYZÓ RESEND_API_KEY → a hozzáférés AKKOR IS létrejön, a látogató IGAZ
 *      üzenetet kap (emailSent: false), és a napló HIBÁT rögzít.
 *
 * ═══ SEMMILYEN VALÓDI HÁLÓZATI HÍVÁS ═══
 * A globális `fetch` hangosan dobó mockra van cserélve (CLAUDE.md 15.
 * üzemeltetési tanulság: egy teszt egyszer már meghívta a VALÓDI szamlazz.hu-t).
 * A Turnstile-ellenőrző saját, injektált fetch-csel van tesztelve; a levélküldés
 * a mockolt `payload.sendEmail`-en megy.
 */

// ---------------------------------------------------------------------------
// Fixtúrák és mock-Payload
// ---------------------------------------------------------------------------

/** Csendes logger — a naplóhívások megfigyelhetők, a kimenet tiszta marad. */
function createLogger(): { log: Logger; errors: string[]; infos: string[]; warns: string[] } {
  const errors: string[] = []
  const infos: string[] = []
  const warns: string[] = []
  const log: Logger = {
    debug: vi.fn(),
    info: vi.fn((message: string) => {
      infos.push(message)
    }),
    warn: vi.fn((message: string) => {
      warns.push(message)
    }),
    error: vi.fn((message: string) => {
      errors.push(message)
    }),
    child: () => log,
  }
  return { log, errors, infos, warns }
}

interface ProductRow {
  id: number
  sku: string
  displayTitle?: string
  status: string
  priceInHUFEnabled: boolean | null
  priceInHUF?: number | null
}

interface UserRow {
  id: number
  email: string
  name: string
  role: string
  purchases: number[]
  passwordSetupPending?: boolean
}

const FREE_COURSE: ProductRow = {
  id: 2,
  sku: 'SOS-KEZRELAX',
  displayTitle: 'SOS KézRelax villámkurzus',
  status: 'published',
  priceInHUFEnabled: false,
}

const PAID_COURSE: ProductRow = {
  id: 5,
  sku: 'KEZ-ALAP',
  displayTitle: 'Otthoni KézRehab Program',
  status: 'published',
  priceInHUFEnabled: true,
  priceInHUF: 79500,
}

/** Beállítatlan ár-pipa: NEM ingyenes, hanem hiányos konfiguráció (courses.ts). */
const UNSET_PRICE_COURSE: ProductRow = {
  id: 9,
  sku: 'FELIG-KONFIG',
  status: 'published',
  priceInHUFEnabled: null,
}

interface MockOptions {
  products?: ProductRow[]
  users?: UserRow[]
  /** A `payload.sendEmail` visszatérési értéke (a saját adapter SendResultja). */
  sendResult?: unknown
}

function createMockPayload(options: MockOptions = {}) {
  const products = options.products ?? [FREE_COURSE, PAID_COURSE, UNSET_PRICE_COURSE]
  const users: UserRow[] = (options.users ?? []).map((user) => ({ ...user }))
  const sent: Array<{ to: string; subject: string; html: string; text: string }> = []
  const created: UserRow[] = []
  const forgotPasswordCalls: Array<{ email: string; expiration?: number }> = []
  let nextUserId = users.reduce((max, user) => Math.max(max, user.id), 100) + 1
  let nextToken = 0

  const payload = {
    findByID: vi.fn(async ({ collection, id }: { collection: string; id: number | string }) => {
      if (collection === 'products') {
        const product = products.find((row) => String(row.id) === String(id))
        if (!product) {
          throw new Error('Not Found')
        }
        return product
      }
      const user = users.find((row) => String(row.id) === String(id))
      if (!user) {
        throw new Error('Not Found')
      }
      return user
    }),
    find: vi.fn(async ({ collection, where }: { collection: string; where?: unknown }) => {
      if (collection === 'users') {
        const email = (where as { email?: { equals?: string } })?.email?.equals
        const docs = users.filter((row) => row.email === email)
        return { docs, totalDocs: docs.length }
      }
      // A grantFreeCoursesToUser lekérdezése: published + priceInHUFEnabled === false.
      const clauses = (where as { and?: Array<Record<string, Record<string, unknown>>> })?.and ?? []
      const docs = products.filter((product) =>
        clauses.every((clause) => {
          if (clause.status?.equals !== undefined && product.status !== clause.status.equals) {
            return false
          }
          if (
            clause.priceInHUFEnabled?.equals !== undefined &&
            product.priceInHUFEnabled !== clause.priceInHUFEnabled.equals
          ) {
            return false
          }
          return true
        }),
      )
      return { docs, totalDocs: docs.length }
    }),
    count: vi.fn(async () => ({ totalDocs: users.length })),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row: UserRow = {
        id: nextUserId,
        email: String(data.email),
        name: String(data.name),
        role: String(data.role),
        purchases: [],
        passwordSetupPending: data.passwordSetupPending === true,
      }
      nextUserId += 1
      users.push(row)
      created.push(row)
      return row
    }),
    update: vi.fn(
      async ({
        id,
        data,
      }: {
        collection: string
        id: number | string
        data: Record<string, unknown>
      }) => {
        const user = users.find((row) => String(row.id) === String(id))
        if (user && Array.isArray(data.purchases)) {
          user.purchases = (data.purchases as number[]).slice()
        }
        return user
      },
    ),
    forgotPassword: vi.fn(
      async ({ data, expiration }: { data: { email: string }; expiration?: number }) => {
        forgotPasswordCalls.push({ email: data.email, ...(expiration ? { expiration } : {}) })
        nextToken += 1
        return `token-${nextToken}`
      },
    ),
    sendEmail: vi.fn(
      async (message: { to: string; subject: string; html: string; text: string }) => {
        sent.push(message)
        return options.sendResult ?? { ok: true, provider: 'resend' }
      },
    ),
    // A route-handler a sessiont `payload.auth({ headers })`-szel olvassa
    // (bejelentkezett, egyező e-mail → saját magának grant). Alapból vendég.
    auth: vi.fn(async () => ({ user: null })),
  }

  return {
    payload: payload as unknown as Payload,
    users,
    created,
    sent,
    forgotPasswordCalls,
    mocks: payload,
  }
}

/**
 * Beállított levelező-szolgáltató.
 *
 * A „kulcs" SZÁNDÉKOSAN nem kulcs-alakú, hanem a repó DUMMY-konvencióját
 * viszi (.gitleaks.toml): a provider-feloldás csak azt nézi, hogy a változó
 * ki van-e töltve, tehát valódi formátumú érték itt sosem kell.
 */
const ENV_WITH_EMAIL = {
  RESEND_API_KEY: 'DUMMY-RESEND-KULCS-NEM-VALODI-TITOK',
  NEXT_PUBLIC_SERVER_URL: 'https://pelda.kineticare.hu',
} as const

/** Az ÉLES helyzet 2026-08-17-én: nincs beállított levelező-szolgáltató. */
const ENV_WITHOUT_EMAIL = {
  NEXT_PUBLIC_SERVER_URL: 'https://pelda.kineticare.hu',
} as const

/** Már aktivált vevő: jelszó be van állítva, tokent NEM szabad írni (K3). */
const MEGLEVO_VEVO: UserRow = {
  id: 101,
  email: 'anna@pelda.hu',
  name: 'Anna',
  role: 'customer',
  purchases: [],
  passwordSetupPending: false,
}

const MEGLEVO_OWNER: UserRow = {
  id: 201,
  email: 'tulaj@pelda.hu',
  name: 'Tulajdonos',
  role: 'owner',
  purchases: [],
}

const MEGLEVO_STAFF: UserRow = {
  id: 202,
  email: 'munkatars@pelda.hu',
  name: 'Munkatárs',
  role: 'staff',
  purchases: [],
}

/** Import/igénylés után, jelszó nélkül: a 7 napos belépő token IGEN. */
const VARAKOZO_VEVO: UserRow = {
  id: 203,
  email: 'varakozo@pelda.hu',
  name: 'Váró Vevő',
  role: 'customer',
  purchases: [],
  passwordSetupPending: true,
}

beforeEach(() => {
  // Egyetlen valódi hálózati hívás sem indulhat egy tesztből.
  vi.stubGlobal('fetch', () => {
    throw new Error('TESZT: valódi hálózati hívás indult — minden HTTP-hívót injektálni kell')
  })
  vi.mocked(grantFreeCoursesToUser).mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// (a) ÚJ e-mail-cím
// ---------------------------------------------------------------------------

/**
 * Nem titok, hanem JELÖLŐ: a Turnstile-ellenőrzés csak akkor fut le, ha a
 * kulcs be van állítva, és ezek a tesztek pont ezt az ágat járják be. A
 * hálózati hívást mindenhol injektált fetch fogja el, tehát valódi kulcsra
 * nincs szükség, és a repóba nem is kerülhet (CLAUDE.md 1. tiltott zóna).
 */
const TESZT_TURNSTILE_KULCS = 'nincs-valodi-kulcs'

describe('igénylés ÚJ e-mail-címmel', () => {
  it('fiókot hoz létre, hozzáférést ad és kiküldi a belépő levelet', async () => {
    const mock = createMockPayload({ users: [MEGLEVO_VEVO] })
    const { log } = createLogger()

    const result = await requestFreeCourseAccess({
      payload: mock.payload,
      productId: FREE_COURSE.id,
      name: 'Kis Piroska',
      email: 'piroska@pelda.hu',
      serverUrl: 'https://pelda.kineticare.hu',
      env: ENV_WITH_EMAIL,
      logger: log,
    })

    expect(result.status).toBe('ok')
    expect(result.emailDelivered).toBe(true)
    expect(result.userCreated).toBe(true)

    // Fiók: pontosan egy új, `customer` szerepkörrel és jelszó-beállítás
    // jelzővel (a látogató SOHA nem talál ki jelszót).
    expect(mock.created).toHaveLength(1)
    expect(mock.created[0]).toMatchObject({
      email: 'piroska@pelda.hu',
      name: 'Kis Piroska',
      role: 'customer',
      passwordSetupPending: true,
    })

    // Hozzáférés: az ingyenes kurzus bekerült a purchases-be.
    const user = mock.users.find((row) => row.email === 'piroska@pelda.hu')
    expect(user?.purchases).toContain(FREE_COURSE.id)
    // A fizetős és a hiányosan konfigurált termék SOSEM.
    expect(user?.purchases).not.toContain(PAID_COURSE.id)
    expect(user?.purchases).not.toContain(UNSET_PRICE_COURSE.id)

    // Levél: pontosan egy, a megadott címre, a belépő linkkel.
    expect(mock.sent).toHaveLength(1)
    expect(mock.sent[0].to).toBe('piroska@pelda.hu')
    expect(mock.sent[0].html).toContain('https://pelda.kineticare.hu/jelszo-visszaallitas?token=')
    expect(mock.sent[0].subject).toContain('SOS KézRelax villámkurzus')
    expect(vi.mocked(grantFreeCoursesToUser)).toHaveBeenCalledTimes(1)
    expect(mock.forgotPasswordCalls[0].expiration).toBe(FREE_COURSE_TOKEN_TTL_MS)
  })

  it('a belépő link a Payload SAJÁT reset-tokenjéből épül, levélküldés nélkül generálva', async () => {
    const mock = createMockPayload({ users: [MEGLEVO_VEVO] })
    const { log } = createLogger()

    await requestFreeCourseAccess({
      payload: mock.payload,
      productId: FREE_COURSE.id,
      name: 'Kis Piroska',
      email: 'piroska@pelda.hu',
      serverUrl: 'https://pelda.kineticare.hu',
      env: ENV_WITH_EMAIL,
      logger: log,
    })

    const call = (
      mock.mocks.forgotPassword as unknown as { mock: { calls: [Record<string, unknown>][] } }
    ).mock.calls[0][0]
    // `disableEmail: true` — a levelet MI fogalmazzuk meg magyarul, nem a
    // Payload gyári sablonja megy ki.
    expect(call.disableEmail).toBe(true)
    expect(mock.forgotPasswordCalls[0].email).toBe('piroska@pelda.hu')
  })

  it('a nem ingyenes és a nem publikált kurzus NEM igényelhető (a felület sem kínálná)', async () => {
    for (const productId of [PAID_COURSE.id, UNSET_PRICE_COURSE.id, 4242]) {
      const mock = createMockPayload({ users: [MEGLEVO_VEVO] })
      const { log } = createLogger()
      const result = await requestFreeCourseAccess({
        payload: mock.payload,
        productId,
        name: 'Kis Piroska',
        email: 'piroska@pelda.hu',
        serverUrl: 'https://pelda.kineticare.hu',
        env: ENV_WITH_EMAIL,
        logger: log,
      })
      expect(result.status, `productId=${productId}`).toBe('course-not-available')
      expect(mock.created).toHaveLength(0)
      expect(mock.sent).toHaveLength(0)
    }
  })

  it('ÜRES users-kollekcióra NEM hoz létre fiókot (az első user owner lenne)', async () => {
    const mock = createMockPayload({ users: [] })
    const { log, errors } = createLogger()

    const result = await requestFreeCourseAccess({
      payload: mock.payload,
      productId: FREE_COURSE.id,
      name: 'Kis Piroska',
      email: 'piroska@pelda.hu',
      serverUrl: 'https://pelda.kineticare.hu',
      env: ENV_WITH_EMAIL,
      logger: log,
    })

    expect(result.status).toBe('refused-first-user')
    expect(mock.created).toHaveLength(0)
    expect(errors.join(' ')).toContain('RIASZTÁS')
  })
})

// ---------------------------------------------------------------------------
// (b) MEGLÉVŐ e-mail-cím + fiók-felderítés elleni védelem
// ---------------------------------------------------------------------------

describe('igénylés MEGLÉVŐ e-mail-címmel', () => {
  it('nem hoz létre második fiókot, és aktivált vevőnek NEM ír kurzust', async () => {
    const mock = createMockPayload({ users: [MEGLEVO_VEVO] })
    const { log } = createLogger()

    const result = await requestFreeCourseAccess({
      payload: mock.payload,
      productId: FREE_COURSE.id,
      name: 'Anna (újra megadva)',
      email: MEGLEVO_VEVO.email,
      serverUrl: 'https://pelda.kineticare.hu',
      env: ENV_WITH_EMAIL,
      logger: log,
    })

    expect(result.status).toBe('ok')
    expect(result.userCreated).toBe(false)
    expect(mock.created).toHaveLength(0)
    expect(mock.users).toHaveLength(1)
    expect(mock.users[0].purchases ?? []).not.toContain(FREE_COURSE.id)
    expect(mock.sent).toHaveLength(1)
    expect(mock.sent[0]?.html).toContain('/belepes')
    expect(mock.sent[0]?.html).toContain('/elfelejtett-jelszo')
    // A meglévő fiók NEVÉT nem írja felül az űrlapon megadott név.
    expect(mock.users[0].name).toBe('Anna')
    // Aktivált vevő: a nyilvános űrlap NEM írja rá a kurzust (staff-ajándék
    // az admin panel). Belépés / jelszó-helyreállítás a levélben.
    expect(vi.mocked(grantFreeCoursesToUser)).not.toHaveBeenCalled()
    expect(mock.forgotPasswordCalls).toHaveLength(0)
  })

  it('a HTTP-válasz BITRE azonos új és meglévő címnél (fiók-felderítés elleni védelem)', async () => {
    const handlerFor = (users: UserRow[]) => {
      const mock = createMockPayload({ users })
      return {
        mock,
        handler: createFreeCourseRequestHandler({
          getPayload: async () => mock.payload,
          env: ENV_WITH_EMAIL,
          limiter: new SlidingWindowRateLimiter(),
        }),
      }
    }

    const uj = handlerFor([MEGLEVO_VEVO])
    const meglevo = handlerFor([MEGLEVO_VEVO])

    const ujValasz = await uj.handler(requestFor({ email: 'uj.cim@pelda.hu', name: 'Új Látogató' }))
    const meglevoValasz = await meglevo.handler(
      requestFor({ email: MEGLEVO_VEVO.email, name: 'Anna' }),
    )

    expect(ujValasz.status).toBe(meglevoValasz.status)
    expect(await ujValasz.json()).toEqual(await meglevoValasz.json())
    // A `userCreated` a szolgáltatásban létezik (naplóhoz kell), de a válaszban
    // SOSEM jelenhet meg: abból derülne ki, ki a vevőnk.
    expect(
      JSON.stringify(await handlerBody(uj.handler, { email: 'masik@pelda.hu' })),
    ).not.toContain('userCreated')
  })
})

// ---------------------------------------------------------------------------
// K3: jelszó-token és grant kapu (owner/staff / aktivált vevő / pending)
// ---------------------------------------------------------------------------

describe('jelszó-token és grant kapu (K3)', () => {
  it('a döntőtábla: új fiók és pending customer kap tokent, owner/staff semmit', () => {
    expect(
      resolveFreeCourseRequestActions({
        created: true,
        role: 'customer',
        passwordSetupPending: true,
      }),
    ).toEqual({ grant: true, issueSetPasswordToken: true })
    expect(
      resolveFreeCourseRequestActions({
        created: false,
        role: 'customer',
        passwordSetupPending: true,
      }),
    ).toEqual({ grant: true, issueSetPasswordToken: true })
    expect(
      resolveFreeCourseRequestActions({
        created: false,
        role: 'customer',
        passwordSetupPending: false,
      }),
    ).toEqual({ grant: false, issueSetPasswordToken: false })
    expect(
      resolveFreeCourseRequestActions({
        created: false,
        role: 'customer',
        passwordSetupPending: false,
        actorUserId: 101,
        userId: 101,
      }),
    ).toEqual({ grant: true, issueSetPasswordToken: false })
    expect(
      resolveFreeCourseRequestActions({
        created: false,
        role: 'owner',
        passwordSetupPending: true,
      }),
    ).toEqual({ grant: false, issueSetPasswordToken: false })
    expect(
      resolveFreeCourseRequestActions({
        created: false,
        role: 'staff',
        passwordSetupPending: false,
      }),
    ).toEqual({ grant: false, issueSetPasswordToken: false })
  })

  it('meglévő owner: forgotPassword NEM hívódik, grant NEM hívódik, a válasz { ok: true }', async () => {
    const mock = createMockPayload({ users: [MEGLEVO_OWNER] })
    const { log, warns } = createLogger()

    const result = await requestFreeCourseAccess({
      payload: mock.payload,
      productId: FREE_COURSE.id,
      name: 'Valaki',
      email: MEGLEVO_OWNER.email,
      serverUrl: 'https://pelda.kineticare.hu',
      env: ENV_WITH_EMAIL,
      logger: log,
    })

    expect(result.status).toBe('ok')
    expect(result.userCreated).toBe(false)
    expect(result.grantedProductIds).toEqual([])
    expect(mock.forgotPasswordCalls).toHaveLength(0)
    expect(mock.sent).toHaveLength(0)
    expect(vi.mocked(grantFreeCoursesToUser)).not.toHaveBeenCalled()
    expect(mock.users[0].purchases).toEqual([])
    expect(warns.join(' ')).toContain('owner/staff')
    expect(mock.mocks.forgotPassword).not.toHaveBeenCalled()
  })

  it('meglévő staff: forgotPassword NEM hívódik, grant NEM hívódik, a válasz { ok: true }', async () => {
    const mock = createMockPayload({ users: [MEGLEVO_STAFF] })
    const { log } = createLogger()

    const result = await requestFreeCourseAccess({
      payload: mock.payload,
      productId: FREE_COURSE.id,
      name: 'Valaki',
      email: MEGLEVO_STAFF.email,
      serverUrl: 'https://pelda.kineticare.hu',
      env: ENV_WITH_EMAIL,
      logger: log,
    })

    expect(result.status).toBe('ok')
    expect(result.userCreated).toBe(false)
    expect(result.grantedProductIds).toEqual([])
    expect(mock.forgotPasswordCalls).toHaveLength(0)
    expect(mock.sent).toHaveLength(0)
    expect(vi.mocked(grantFreeCoursesToUser)).not.toHaveBeenCalled()
    expect(mock.users[0].purchases).toEqual([])
  })

  it('meglévő customer passwordSetupPending: true — 7 napos token ÉS grant', async () => {
    const mock = createMockPayload({ users: [VARAKOZO_VEVO] })
    const { log } = createLogger()

    const result = await requestFreeCourseAccess({
      payload: mock.payload,
      productId: FREE_COURSE.id,
      name: 'Váró Vevő',
      email: VARAKOZO_VEVO.email,
      serverUrl: 'https://pelda.kineticare.hu',
      env: ENV_WITH_EMAIL,
      logger: log,
    })

    expect(result.status).toBe('ok')
    expect(result.userCreated).toBe(false)
    expect(result.emailDelivered).toBe(true)
    expect(vi.mocked(grantFreeCoursesToUser)).toHaveBeenCalledTimes(1)
    expect(mock.users[0].purchases).toContain(FREE_COURSE.id)
    expect(mock.forgotPasswordCalls).toEqual([
      { email: VARAKOZO_VEVO.email, expiration: FREE_COURSE_TOKEN_TTL_MS },
    ])
    expect(mock.sent).toHaveLength(1)
  })

  it('meglévő customer jelszóval: forgotPassword NEM, grant NEM, belépős levél IGEN', async () => {
    const mock = createMockPayload({ users: [MEGLEVO_VEVO] })
    const { log } = createLogger()

    const result = await requestFreeCourseAccess({
      payload: mock.payload,
      productId: FREE_COURSE.id,
      name: 'Anna',
      email: MEGLEVO_VEVO.email,
      serverUrl: 'https://pelda.kineticare.hu',
      env: ENV_WITH_EMAIL,
      logger: log,
    })

    expect(result.status).toBe('ok')
    expect(result.userCreated).toBe(false)
    expect(vi.mocked(grantFreeCoursesToUser)).not.toHaveBeenCalled()
    expect(mock.users[0].purchases ?? []).not.toContain(FREE_COURSE.id)
    expect(mock.forgotPasswordCalls).toHaveLength(0)
    expect(mock.sent).toHaveLength(1)
    expect(mock.sent[0]?.html).toContain('/belepes')
  })

  it('új fiók: forgotPassword + grant, a HTTP-válasz nem árulja el a szerepkört', async () => {
    const mock = createMockPayload({ users: [MEGLEVO_VEVO] })
    const { log } = createLogger()

    const result = await requestFreeCourseAccess({
      payload: mock.payload,
      productId: FREE_COURSE.id,
      name: 'Kis Piroska',
      email: 'piroska@pelda.hu',
      serverUrl: 'https://pelda.kineticare.hu',
      env: ENV_WITH_EMAIL,
      logger: log,
    })

    expect(result.status).toBe('ok')
    expect(result.userCreated).toBe(true)
    expect(vi.mocked(grantFreeCoursesToUser)).toHaveBeenCalledTimes(1)
    expect(mock.forgotPasswordCalls).toEqual([
      { email: 'piroska@pelda.hu', expiration: FREE_COURSE_TOKEN_TTL_MS },
    ])
    expect(mock.sent).toHaveLength(1)
  })

  it('a HTTP-válasz owner, staff, aktivált vevő, pending vevő és új cím esetén is azonos alakú', async () => {
    const cases: Array<{ users: UserRow[]; email: string }> = [
      { users: [MEGLEVO_OWNER, MEGLEVO_VEVO], email: MEGLEVO_OWNER.email },
      { users: [MEGLEVO_STAFF, MEGLEVO_VEVO], email: MEGLEVO_STAFF.email },
      { users: [MEGLEVO_VEVO], email: MEGLEVO_VEVO.email },
      { users: [VARAKOZO_VEVO, MEGLEVO_VEVO], email: VARAKOZO_VEVO.email },
      { users: [MEGLEVO_VEVO], email: 'uj.cim@pelda.hu' },
    ]

    const bodies: unknown[] = []
    for (const teszt of cases) {
      const mock = createMockPayload({ users: teszt.users })
      const handler = createFreeCourseRequestHandler({
        getPayload: async () => mock.payload,
        env: ENV_WITH_EMAIL,
        limiter: new SlidingWindowRateLimiter(),
      })
      const response = await handler(requestFor({ email: teszt.email, name: 'Valaki' }))
      expect(response.status).toBe(200)
      const body: unknown = await response.json()
      expect(body).toEqual({ ok: true, emailSent: true })
      expect(JSON.stringify(body)).not.toMatch(/owner|staff|userCreated|role/u)
      bodies.push(body)
    }
    expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// (c) IDEMPOTENCIA
// ---------------------------------------------------------------------------

describe('kétszeri beküldés', () => {
  it('nem hoz létre két fiókot és nem duplázza a hozzáférést', async () => {
    const mock = createMockPayload({ users: [MEGLEVO_VEVO] })
    const { log } = createLogger()
    const input = {
      payload: mock.payload,
      productId: FREE_COURSE.id,
      name: 'Kis Piroska',
      email: 'piroska@pelda.hu',
      serverUrl: 'https://pelda.kineticare.hu',
      env: ENV_WITH_EMAIL,
      logger: log,
    }

    const elso = await requestFreeCourseAccess(input)
    const masodik = await requestFreeCourseAccess(input)

    expect(elso.status).toBe('ok')
    expect(masodik.status).toBe('ok')
    // Egyetlen új fiók, egyetlen hozzáférés-bejegyzés.
    expect(mock.created).toHaveLength(1)
    expect(mock.users.filter((user) => user.email === 'piroska@pelda.hu')).toHaveLength(1)
    const user = mock.users.find((row) => row.email === 'piroska@pelda.hu')
    expect(user?.purchases).toEqual([FREE_COURSE.id])
    // A MÁSODIK körben már nincs mit beírni (a grant no-op).
    expect(masodik.grantedProductIds).toEqual([])
    // A belépő levél viszont ÚJRA kimegy (a látogató nem találta a régit) —
    // ez a jelszó-emlékeztető ismert viselkedése, a keretet a route-handler adja.
    expect(mock.sent).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// (d) LEVÉLKÜLDÉS NÉLKÜLI ÜZEM (az élő Railway-állapot 2026-08-17-én)
// ---------------------------------------------------------------------------

describe('hiányzó RESEND_API_KEY', () => {
  it('a hozzáférés létrejön, a levél NEM megy ki, és a napló hibát rögzít', async () => {
    const mock = createMockPayload({ users: [MEGLEVO_VEVO] })
    const { log, errors } = createLogger()

    const result = await requestFreeCourseAccess({
      payload: mock.payload,
      productId: FREE_COURSE.id,
      name: 'Kis Piroska',
      email: 'piroska@pelda.hu',
      serverUrl: 'https://pelda.kineticare.hu',
      env: ENV_WITHOUT_EMAIL,
      logger: log,
    })

    // A hozzáférés a fontos: az adat létrejön.
    expect(result.status).toBe('ok')
    const user = mock.users.find((row) => row.email === 'piroska@pelda.hu')
    expect(user?.purchases).toContain(FREE_COURSE.id)

    // A levél NEM ment ki, és nem is állítjuk az ellenkezőjét.
    expect(result.emailDelivered).toBe(false)
    expect(mock.sent).toHaveLength(0)

    // Tokent SEM generálunk: az csak érvénytelenítené a címzett esetleg még
    // élő, korábbi linkjét, cserébe semmit nem adna.
    expect(mock.forgotPasswordCalls).toHaveLength(0)

    // A staff LÁTJA a hibát: nem néma degradálás.
    expect(errors.join(' ')).toContain('RIASZTÁS')
    expect(errors.join(' ')).toContain('RESEND_API_KEY')
  })

  it('a végpont ilyenkor 200-at ad `emailSent: false`-szal (a látogató IGAZ üzenetet kap)', async () => {
    const mock = createMockPayload({ users: [MEGLEVO_VEVO] })
    const handler = createFreeCourseRequestHandler({
      getPayload: async () => mock.payload,
      env: ENV_WITHOUT_EMAIL,
      limiter: new SlidingWindowRateLimiter(),
    })

    const response = await handler(requestFor({ email: 'piroska@pelda.hu' }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, emailSent: false })
  })

  it('a szolgáltató ELUTASÍTOTT küldése sem látszik sikernek', async () => {
    const mock = createMockPayload({
      users: [MEGLEVO_VEVO],
      // A saját e-mail-adapter SOSEM dob: `{ ok: false }` alakot ad vissza.
      sendResult: { ok: false, provider: 'resend', error: 'domain not verified' },
    })
    const { log, errors } = createLogger()

    const result = await requestFreeCourseAccess({
      payload: mock.payload,
      productId: FREE_COURSE.id,
      name: 'Kis Piroska',
      email: 'piroska@pelda.hu',
      serverUrl: 'https://pelda.kineticare.hu',
      env: ENV_WITH_EMAIL,
      logger: log,
    })

    expect(result.status).toBe('ok')
    expect(result.emailDelivered).toBe(false)
    expect(errors.join(' ')).toContain('RIASZTÁS')
  })

  it('NEXT_PUBLIC_SERVER_URL nélkül sincs hamis ígéret (nincs link, nincs levél)', async () => {
    const mock = createMockPayload({ users: [MEGLEVO_VEVO] })
    const { log, errors } = createLogger()

    const result = await requestFreeCourseAccess({
      payload: mock.payload,
      productId: FREE_COURSE.id,
      name: 'Kis Piroska',
      email: 'piroska@pelda.hu',
      serverUrl: null,
      env: ENV_WITH_EMAIL,
      logger: log,
    })

    expect(result.emailDelivered).toBe(false)
    expect(mock.sent).toHaveLength(0)
    expect(errors.join(' ')).toContain('NEXT_PUBLIC_SERVER_URL')
    expect(resolveServerUrlOrNull({})).toBeNull()
    expect(resolveServerUrlOrNull({ NEXT_PUBLIC_SERVER_URL: 'https://a.hu/' })).toBe('https://a.hu')
  })
})

// ---------------------------------------------------------------------------
// Validáció
// ---------------------------------------------------------------------------

describe('validáció', () => {
  it('a hozzájárulás KÖTELEZŐ, és sosem előpipált', () => {
    const errors = validateFreeCourseForm({
      name: 'Anna',
      email: 'a@pelda.hu',
      consentPrivacy: false,
    })
    expect(errors.consentPrivacy).toBe(FREE_COURSE_CONSENT_ERROR)
  })

  it('a hiányzó név és a hibás e-mail-cím helyzetre szabott üzenetet kap', () => {
    const errors = validateFreeCourseForm({ name: '  ', email: 'nem-email', consentPrivacy: true })
    expect(errors.name).toBe(FREE_COURSE_NAME_REQUIRED_ERROR)
    expect(errors.email).toBe(FREE_COURSE_EMAIL_FORMAT_ERROR)
  })

  it('a SZERVER-oldali elemző ugyanazokat a szabályokat érvényesíti', () => {
    const rossz = parseFreeCourseRequestBody({
      productId: 2,
      name: '',
      email: 'x',
      consentPrivacy: false,
    })
    expect(rossz.ok).toBe(false)
    if (!rossz.ok) {
      expect(rossz.errors).toContain(FREE_COURSE_NAME_REQUIRED_ERROR)
      expect(rossz.errors).toContain(FREE_COURSE_CONSENT_ERROR)
    }

    const jo = parseFreeCourseRequestBody({
      productId: '2',
      name: '  Kis Piroska  ',
      email: '  Piroska@Pelda.HU ',
      consentPrivacy: true,
    })
    expect(jo.ok).toBe(true)
    if (jo.ok) {
      expect(jo.body.productId).toBe(2)
      expect(jo.body.name).toBe('Kis Piroska')
      // Kisbetűsítve: különben a „Piroska@Pelda.HU" alakra ÚJ fiók keletkezne
      // a meglévő mellé.
      expect(jo.body.email).toBe('piroska@pelda.hu')
    }
  })

  it('a hozzájárulás CSAK logikai `true` értékkel fogadható el (a „true" string nem elég)', () => {
    const result = parseFreeCourseRequestBody({
      productId: 2,
      name: 'Anna',
      email: 'a@pelda.hu',
      consentPrivacy: 'true',
    })
    expect(result.ok).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Védelmi réteg: honeypot, kérés-korlát, Turnstile
// ---------------------------------------------------------------------------

describe('spam- és visszaélés-védelem', () => {
  it('a kitöltött honeypot látszólagos sikerrel, fiók és levél NÉLKÜL zárul', async () => {
    const mock = createMockPayload({ users: [MEGLEVO_VEVO] })
    const handler = createFreeCourseRequestHandler({
      getPayload: async () => mock.payload,
      env: ENV_WITH_EMAIL,
      limiter: new SlidingWindowRateLimiter(),
    })

    const response = await handler(
      requestFor({ email: 'bot@pelda.hu', website: 'https://spam.example' }),
    )

    expect(response.status).toBe(200)
    expect(mock.created).toHaveLength(0)
    expect(mock.sent).toHaveLength(0)
  })

  it('az IP-keret az 5. kérés után 429-cel és Retry-After fejléccel zár', async () => {
    const mock = createMockPayload({ users: [MEGLEVO_VEVO] })
    const handler = createFreeCourseRequestHandler({
      getPayload: async () => mock.payload,
      env: ENV_WITH_EMAIL,
      limiter: new SlidingWindowRateLimiter(),
    })

    // Címenként MÁS e-mail, hogy a cím-keret ne fogjon előbb.
    const statuszok: number[] = []
    for (let index = 0; index < FREE_COURSE_IP_RULE.limit + 1; index += 1) {
      const response = await handler(requestFor({ email: `latogato${index}@pelda.hu` }))
      statuszok.push(response.status)
      if (response.status === 429) {
        expect(response.headers.get('Retry-After')).toMatch(/^\d+$/u)
      }
    }
    expect(statuszok.filter((status) => status === 429)).toHaveLength(1)
  })

  it('a CÍM-keret ugyanarra a postaládára 3 levél után zár (mail-bombing ellen)', async () => {
    const mock = createMockPayload({ users: [MEGLEVO_VEVO] })
    const handler = createFreeCourseRequestHandler({
      getPayload: async () => mock.payload,
      env: ENV_WITH_EMAIL,
      limiter: new SlidingWindowRateLimiter(),
    })

    const statuszok: number[] = []
    for (let index = 0; index < FREE_COURSE_EMAIL_RULE.limit + 1; index += 1) {
      // MÁS IP, UGYANAZ a cím: az IP-rotációt a cím-keret fogja meg.
      const response = await handler(
        requestFor({ email: 'aldozat@pelda.hu', ip: `10.0.0.${index + 1}` }),
      )
      statuszok.push(response.status)
    }
    expect(statuszok.at(-1)).toBe(429)
    expect(mock.sent).toHaveLength(FREE_COURSE_EMAIL_RULE.limit)
  })

  it('beállított Turnstile-secret mellett token nélkül elutasít (valódi hálózat nélkül)', async () => {
    const mock = createMockPayload({ users: [MEGLEVO_VEVO] })
    const handler = createFreeCourseRequestHandler({
      getPayload: async () => mock.payload,
      env: { ...ENV_WITH_EMAIL, TURNSTILE_SECRET_KEY: TESZT_TURNSTILE_KULCS },
      limiter: new SlidingWindowRateLimiter(),
      // Az ellenőrző injektált: valódi siteverify-hívás SOSEM indul.
      verifyTurnstile: async (token) => token === 'jo-token',
    })

    const rossz = await handler(requestFor({ email: 'piroska@pelda.hu' }))
    expect(rossz.status).toBe(400)
    expect(await rossz.json()).toEqual({ error: FREE_COURSE_TURNSTILE_ERROR })
    expect(mock.created).toHaveLength(0)

    const jo = await handler(requestFor({ email: 'piroska@pelda.hu', turnstileToken: 'jo-token' }))
    expect(jo.status).toBe(200)
  })

  it('a Turnstile-ellenőrző injektált fetch-csel dolgozik, és üres tokenre nem hív hálózatot', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: true })))

    await expect(
      verifyTurnstileToken({ secret: TESZT_TURNSTILE_KULCS, token: null, fetchImpl }),
    ).resolves.toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()

    await expect(
      verifyTurnstileToken({ secret: TESZT_TURNSTILE_KULCS, token: 'abc', fetchImpl }),
    ).resolves.toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('a nem igényelhető kurzus 400-at ad, magyar magyarázattal', async () => {
    const mock = createMockPayload({ users: [MEGLEVO_VEVO] })
    const handler = createFreeCourseRequestHandler({
      getPayload: async () => mock.payload,
      env: ENV_WITH_EMAIL,
      limiter: new SlidingWindowRateLimiter(),
    })

    const response = await handler(requestFor({ email: 'a@pelda.hu', productId: PAID_COURSE.id }))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: FREE_COURSE_UNAVAILABLE_ERROR })
  })

  it('technikai hiba esetén NEM ad sikerüzenetet', async () => {
    const mock = createMockPayload({ users: [MEGLEVO_VEVO] })
    const handler = createFreeCourseRequestHandler({
      getPayload: async () => mock.payload,
      env: ENV_WITH_EMAIL,
      limiter: new SlidingWindowRateLimiter(),
      requestAccess: async () => {
        throw new Error('adatbázis elérhetetlen')
      },
    })

    const response = await handler(requestFor({ email: 'a@pelda.hu' }))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: FREE_COURSE_GENERIC_ERROR })
  })
})

// ---------------------------------------------------------------------------
// A levél szövege
// ---------------------------------------------------------------------------

describe('a belépő link élettartama', () => {
  it('7 nap, és NEM a vásárló-import 30 napos TTL-je', () => {
    // Vezetői döntés (2026-08-17, tulajdonosi jóváhagyással): a link
    // gyakorlatilag jelszóbeállító token egy NYILVÁNOS, önkiszolgáló
    // végpontról, tehát a 30 napos ablak túl hosszú kitettség. Az
    // újraküldés itt egyetlen űrlap-beküldés, ezért a rövidítés nem ront
    // a használhatóságon. Az import 30 napja MÁS helyzet (staff küld
    // meghívót, az újraküldés kézi lépés), ezért az érintetlen marad.
    expect(FREE_COURSE_TOKEN_TTL_DAYS).toBe(7)
    expect(FREE_COURSE_TOKEN_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000)
    expect(FREE_COURSE_TOKEN_TTL_MS).toBeLessThan(INVITE_TOKEN_TTL_MS)
  })

  it('a Payload 1 órás alapértelmezésénél BŐVEN hosszabb (a levelet napokkal később nyitják)', () => {
    expect(FREE_COURSE_TOKEN_TTL_MS).toBeGreaterThan(24 * 60 * 60 * 1000)
  })

  it('a levél a TÉNYLEGES élettartamot írja ki, nem beégetett számot', () => {
    const sablon = freeCourseEmail({
      name: 'Kis Piroska',
      courseTitle: 'SOS KézRelax villámkurzus',
      activationUrl: 'https://pelda.kineticare.hu/jelszo-visszaallitas?token=abc',
      email: 'piroska@pelda.hu',
      expiresInDays: FREE_COURSE_TOKEN_TTL_DAYS,
    })
    expect(sablon.text).toContain(String(FREE_COURSE_TOKEN_TTL_DAYS))
  })
})

describe('belépő levél', () => {
  const template = freeCourseEmail({
    name: 'Kis Piroska',
    courseTitle: 'SOS KézRelax villámkurzus',
    activationUrl: 'https://pelda.kineticare.hu/jelszo-visszaallitas?token=abc',
    email: 'piroska@pelda.hu',
    expiresInDays: FREE_COURSE_TOKEN_TTL_DAYS,
  })

  it('magyarul szól, kimondja az ingyenességet, és EGY cselekvést kér', () => {
    expect(template.subject).toContain('SOS KézRelax villámkurzus')
    expect(template.text).toContain('Kedves Kis Piroska!')
    expect(template.text).toContain('Ingyenes, fizetned nem kell érte.')
    expect(template.html).toContain('https://pelda.kineticare.hu/jelszo-visszaallitas?token=abc')
  })

  it('NEM árulja el, hogy a fiók most jött létre vagy már létezett', () => {
    // Fiók-felderítés elleni védelem a levélben is: a szöveg mindkét esetben
    // ugyanaz és mindkét esetben igaz.
    expect(template.text).not.toMatch(/új fiókod|már regisztráltál|meglévő fiók/iu)
  })

  it('nem használ töltelék gondolatjelet (a tulajdonos kifejezett kikötése)', () => {
    // A MI szövegünk: tárgy + a levéltörzs bekezdései. A közös e-mail-váz
    // (`src/lib/email/templates/layout.ts`) fejsora a 2026-08-22-i review-kör
    // óta „Kineticare: <cím>" alakú, tehát már nem tartalmaz U+2014-et. A
    // szűrő (a „Kineticare " kezdetű sor kihagyása) megmaradt, hogy a teszt
    // továbbra is CSAK a saját folyamat szövegét mérje, ne a közös vázét —
    // a váz saját őre az order-paid.test.ts.
    const sajatSorok = template.text
      .split('\n')
      .filter((line) => !line.startsWith('Kineticare '))
      .join('\n')
    expect(template.subject).not.toMatch(/[–—]/u)
    expect(sajatSorok).not.toMatch(/[–—]/u)
  })

  it('escape-eli a behelyettesített értékeket (a HTML nem törhető szét)', () => {
    const veszelyes = freeCourseEmail({
      name: '<script>alert(1)</script>',
      courseTitle: 'A & B "kurzus"',
      activationUrl: 'https://pelda.hu/jelszo-visszaallitas?token=a&b=1',
      email: 'x@pelda.hu',
      expiresInDays: 30,
    })
    expect(veszelyes.html).not.toContain('<script>')
    expect(veszelyes.html).toContain('&lt;script&gt;')
    expect(veszelyes.html).toContain('&amp;')
  })
})

// ---------------------------------------------------------------------------
// Segédek
// ---------------------------------------------------------------------------

interface RequestOptions {
  email: string
  name?: string
  productId?: number
  website?: string
  turnstileToken?: string
  ip?: string
}

/** Egy érvényes beküldés `NextRequest`-alakban (a handler ezt kapja). */
function requestFor(options: RequestOptions) {
  const body: Record<string, unknown> = {
    productId: options.productId ?? FREE_COURSE.id,
    name: options.name ?? 'Kis Piroska',
    email: options.email,
    consentPrivacy: true,
  }
  if (options.website !== undefined) {
    body.website = options.website
  }
  if (options.turnstileToken !== undefined) {
    body.turnstileToken = options.turnstileToken
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (options.ip !== undefined) {
    headers['x-forwarded-for'] = options.ip
  }
  return new Request('https://pelda.kineticare.hu/api/free-course/request', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }) as unknown as Parameters<ReturnType<typeof createFreeCourseRequestHandler>>[0]
}

async function handlerBody(
  handler: ReturnType<typeof createFreeCourseRequestHandler>,
  options: RequestOptions,
): Promise<unknown> {
  const response = await handler(requestFor(options))
  return response.json()
}
