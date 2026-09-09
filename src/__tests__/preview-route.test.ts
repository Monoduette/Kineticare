import type { Payload } from 'payload'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildExitPreviewHref,
  createExitPreviewHandler,
  RETURN_PATH_PARAM,
  sanitizeReturnPath,
} from '../lib/preview/exit-preview'
import {
  buildAdminPreviewUrl,
  EXIT_PREVIEW_PATH,
  isPreviewCollection,
  PREVIEW_PATH,
  previewTargetPath,
} from '../lib/preview/preview-target'
import { publicRedirectBase } from '../lib/preview/public-redirect-base'
import { createPreviewHandler } from '../lib/preview/route-handler'

/**
 * Piszkozat-előnézet (A10 + B2).
 *
 * Két biztonsági állítást őriz ez a fájl:
 *  1. a publikálatlan tartalmat CSAK staff/owner nézheti meg (`/next/preview`
 *     minden más kérőnek 403-at ad, magyar üzenettel, és a draft mode-ot be sem
 *     kapcsolja);
 *  2. az előnézetből való kilépés (`/next/exit-preview`) nem vihető ki idegen
 *     oldalra: a visszatérési útvonal open-redirect elleni szűrésen megy át.
 *
 * A handlerek függőség-injekcióval készültek, így Next-runtime és adatbázis
 * nélkül tesztelhetők (a checkout/refund route-handlerek mintájára).
 */

const ORIGIN = 'http://localhost:3000'

/** Magyar (ékezetes) felhasználói üzenet — a CLAUDE.md elvárása. */
const hasHungarianAccent = (value: string): boolean => /[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]/.test(value)

type PreviewUser = { id: number; role?: string | null }

const owner: PreviewUser = { id: 1, role: 'owner' }
const staff: PreviewUser = { id: 2, role: 'staff' }
const customer: PreviewUser = { id: 3, role: 'customer' }

interface HandlerHarness {
  handler: (request: Request) => Promise<Response>
  /** Igaz, ha a handler bekapcsolta a Next draft mode-ját. */
  draftEnabled: () => boolean
  authHeaders: () => Headers | undefined
  getPayloadCalls: () => number
}

/** Preview-handler mockolt payload.auth-tal (a valódi user helyett fix válasz). */
const harnessWithUser = (user: PreviewUser | null): HandlerHarness => {
  let draftEnabled = false
  let authHeaders: Headers | undefined
  let getPayloadCalls = 0

  const payload = {
    auth: async ({ headers }: { headers: Headers }) => {
      authHeaders = headers
      return { user }
    },
  } as unknown as Payload

  return {
    handler: createPreviewHandler({
      getPayload: async () => {
        getPayloadCalls += 1
        return payload
      },
      enableDraftMode: async () => {
        draftEnabled = true
      },
    }),
    draftEnabled: () => draftEnabled,
    authHeaders: () => authHeaders,
    getPayloadCalls: () => getPayloadCalls,
  }
}

const previewRequest = (query: string, headers?: Record<string, string>): Request =>
  new Request(`${ORIGIN}${PREVIEW_PATH}${query}`, { headers })

const errorMessage = async (response: Response): Promise<string> => {
  const body = (await response.json()) as { error?: string }
  return body.error ?? ''
}

describe('previewTargetPath / isPreviewCollection', () => {
  it('csak a pages, posts és products collection nyitható előnézetben', () => {
    expect(isPreviewCollection('pages')).toBe(true)
    expect(isPreviewCollection('posts')).toBe(true)
    expect(isPreviewCollection('products')).toBe(true)
    expect(isPreviewCollection('users')).toBe(false)
    expect(isPreviewCollection(null)).toBe(false)
    expect(isPreviewCollection(42)).toBe(false)
  })

  it('poszt → /blog/<slug>, oldal → /<slug>, kezdőlap → /', () => {
    expect(previewTargetPath('posts', 'elso-cikk')).toBe('/blog/elso-cikk')
    expect(previewTargetPath('pages', 'rolunk')).toBe('/rolunk')
    expect(previewTargetPath('pages', 'kezdolap')).toBe('/')
  })

  it('hiányzó vagy üres slugra nincs értelmezhető előnézet', () => {
    expect(previewTargetPath('pages', '')).toBeNull()
    expect(previewTargetPath('pages', '   ')).toBeNull()
    expect(previewTargetPath('posts', null)).toBeNull()
    expect(previewTargetPath('posts', undefined)).toBeNull()
    expect(previewTargetPath('posts', 7)).toBeNull()
  })

  /**
   * A slug egyetlen útvonal-szegmens: az elválasztót (`/`, `\`), séma-jelölőt
   * (`:`) vagy vezérlőkaraktert tartalmazó érték idegen eredetre vinne, ezért
   * nincs értelmezhető előnézeti útvonal.
   */
  it.each([
    ['gyökérből induló útvonal', '/evil.example'],
    ['visszaperjeles változat', '\\evil.example'],
    ['protokoll-relatív cím', '//evil.example'],
    ['abszolút URL', 'https://evil.example/atveres'],
    ['javascript-séma', 'javascript:alert(1)'],
    ['útvonal-szegmens a slugban', 'rolunk/../admin'],
    ['soremelés (fejléc-injekció)', 'rolunk\nLocation: https://evil.example'],
  ])('%s: a slugból nem lehet előnézeti útvonal', (_label, slug) => {
    expect(previewTargetPath('pages', slug)).toBeNull()
    expect(previewTargetPath('posts', slug)).toBeNull()
  })
})

describe('buildAdminPreviewUrl (az admin „Előnézet" gombja)', () => {
  const originalServerUrl = process.env.NEXT_PUBLIC_SERVER_URL

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'https://kineticare.example.test')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    process.env.NEXT_PUBLIC_SERVER_URL = originalServerUrl
  })

  it('a szerver-URL-re épít, a collectiont és a slugot query-ben viszi', () => {
    expect(buildAdminPreviewUrl('posts', 'elso-cikk')).toBe(
      `https://kineticare.example.test${PREVIEW_PATH}?collection=posts&slug=elso-cikk`,
    )
  })

  it('slug nélküli (még el nem mentett) dokumentumnál nincs gomb (null)', () => {
    expect(buildAdminPreviewUrl('pages', undefined)).toBeNull()
    expect(buildAdminPreviewUrl('pages', '')).toBeNull()
    expect(buildAdminPreviewUrl('pages', '  ')).toBeNull()
  })
})

describe('/next/preview — jogosultság-ellenőrzés', () => {
  const originalServerUrl = process.env.NEXT_PUBLIC_SERVER_URL

  beforeEach(() => {
    // A Location-tesztek a request.url originjét várják: üres env → fallback.
    vi.stubEnv('NEXT_PUBLIC_SERVER_URL', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    if (originalServerUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SERVER_URL
    } else {
      process.env.NEXT_PUBLIC_SERVER_URL = originalServerUrl
    }
  })

  it.each([
    ['staff', staff],
    ['owner', owner],
  ])('%s: 307 átirányítás + a draft mode bekapcsol', async (_label, user) => {
    const harness = harnessWithUser(user)

    const response = await harness.handler(previewRequest('?collection=pages&slug=rolunk'))

    expect(response.status).toBe(307)
    expect(response.headers.get('Location')).toBe(`${ORIGIN}/rolunk`)
    expect(harness.draftEnabled()).toBe(true)
  })

  it('poszt-előnézet a /blog útvonalra irányít', async () => {
    const harness = harnessWithUser(staff)

    const response = await harness.handler(previewRequest('?collection=posts&slug=elso-cikk'))

    expect(response.status).toBe(307)
    expect(response.headers.get('Location')).toBe(`${ORIGIN}/blog/elso-cikk`)
  })

  it('a kezdőlap-oldal előnézete a gyökérre irányít', async () => {
    const harness = harnessWithUser(owner)

    const response = await harness.handler(previewRequest('?collection=pages&slug=kezdolap'))

    expect(response.headers.get('Location')).toBe(`${ORIGIN}/`)
  })

  it.each([
    ['látogató (nincs belépve)', null],
    ['customer', customer],
    ['ismeretlen szerepkör', { id: 9, role: 'szerkeszto' }],
  ])('%s: 403 magyar üzenettel, a draft mode NEM kapcsol be', async (_label, user) => {
    const harness = harnessWithUser(user as PreviewUser | null)

    const response = await harness.handler(previewRequest('?collection=pages&slug=rolunk'))
    const message = await errorMessage(response)

    expect(response.status).toBe(403)
    expect(message).toContain('Az előnézet megtekintéséhez szerkesztői belépés szükséges')
    expect(hasHungarianAccent(message)).toBe(true)
    expect(harness.draftEnabled()).toBe(false)
    expect(response.headers.get('Location')).toBeNull()
  })

  it('a bejelentkezési adatok (fejlécek) továbbmennek a payload.auth-nak', async () => {
    const harness = harnessWithUser(staff)

    await harness.handler(
      previewRequest('?collection=pages&slug=rolunk', { 'x-request-id': 'teszt-keres-1' }),
    )

    expect(harness.authHeaders()?.get('x-request-id')).toBe('teszt-keres-1')
  })
})

describe('publicRedirectBase — publikus origin vs. belső host', () => {
  const originalServerUrl = process.env.NEXT_PUBLIC_SERVER_URL

  afterEach(() => {
    vi.unstubAllEnvs()
    if (originalServerUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SERVER_URL
    } else {
      process.env.NEXT_PUBLIC_SERVER_URL = originalServerUrl
    }
  })

  it('érvényes NEXT_PUBLIC_SERVER_URL → a publikus origin, nem a request.url', () => {
    vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'https://kineticare.hu')
    expect(publicRedirectBase('http://localhost:8080/next/preview')).toBe('https://kineticare.hu')
  })

  it('üres env → a request.url a vésztartalék', () => {
    vi.stubEnv('NEXT_PUBLIC_SERVER_URL', '')
    expect(publicRedirectBase('http://localhost:8080/next/preview')).toBe(
      'http://localhost:8080/next/preview',
    )
  })

  it('érvénytelen env → a request.url a vésztartalék', () => {
    vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'nem-url')
    expect(publicRedirectBase('http://localhost:8080/next/preview')).toBe(
      'http://localhost:8080/next/preview',
    )
  })
})

describe('/next/preview — Location a publikus originre épül', () => {
  const originalServerUrl = process.env.NEXT_PUBLIC_SERVER_URL

  afterEach(() => {
    vi.unstubAllEnvs()
    if (originalServerUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SERVER_URL
    } else {
      process.env.NEXT_PUBLIC_SERVER_URL = originalServerUrl
    }
  })

  it('NEXT_PUBLIC_SERVER_URL=https://kineticare.hu: 307 Location a publikus originre megy, a belső host ellenére', async () => {
    vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'https://kineticare.hu')
    const harness = harnessWithUser(staff)

    const response = await harness.handler(
      new Request('http://localhost:8080/next/preview?collection=pages&slug=rolunk'),
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('Location')).toBe('https://kineticare.hu/rolunk')
  })

  it('üres env: a Location a request.url originjére esik vissza', async () => {
    vi.stubEnv('NEXT_PUBLIC_SERVER_URL', '')
    const harness = harnessWithUser(staff)

    const response = await harness.handler(
      new Request('http://localhost:8080/next/preview?collection=pages&slug=rolunk'),
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('Location')).toBe('http://localhost:8080/rolunk')
  })
})

describe('/next/preview — hibás kérés és technikai hiba', () => {
  it.each([
    ['ismeretlen collection', '?collection=orders&slug=valami'],
    ['hiányzó collection', '?slug=valami'],
  ])('%s: 400, és a jogosultság-ellenőrzés el sem indul', async (_label, query) => {
    const harness = harnessWithUser(owner)

    const response = await harness.handler(previewRequest(query))
    const message = await errorMessage(response)

    expect(response.status).toBe(400)
    expect(message).toContain('Az előnézet nem nyitható meg')
    expect(hasHungarianAccent(message)).toBe(true)
    expect(harness.getPayloadCalls()).toBe(0)
    expect(harness.draftEnabled()).toBe(false)
  })

  it.each([
    ['hiányzó slug', '?collection=pages'],
    ['üres slug', '?collection=posts&slug='],
  ])('%s: 400 magyar üzenettel', async (_label, query) => {
    const harness = harnessWithUser(owner)

    const response = await harness.handler(previewRequest(query))

    expect(response.status).toBe(400)
    expect(await errorMessage(response)).toContain('hiányzik vagy hibás a tartalom azonosítója')
    expect(harness.draftEnabled()).toBe(false)
  })

  /**
   * Open-redirect elleni védelem: a `slug` query-paraméterből lesz a válasz
   * `Location` fejléce, ezért az elválasztót tartalmazó slug (`/evil.example`,
   * `\evil.example`, `//evil.example`) már a cél-számításnál elbukik. Így a
   * meglévő 400-as ág fut, és a draft mode be sem kapcsol — az „előnézet" nem
   * használható idegen oldalra való átirányításra.
   */
  it.each([
    ['gyökérből induló útvonal', '/evil.example'],
    ['visszaperjeles változat', '\\evil.example'],
    ['protokoll-relatív cím', '//evil.example'],
  ])('open redirect (%s): 400, a draft mode NEM kapcsol be', async (_label, slug) => {
    const harness = harnessWithUser(owner)

    const response = await harness.handler(
      previewRequest(`?collection=pages&slug=${encodeURIComponent(slug)}`),
    )
    const message = await errorMessage(response)

    expect(response.status).toBe(400)
    expect(message).toContain('hiányzik vagy hibás a tartalom azonosítója')
    expect(hasHungarianAccent(message)).toBe(true)
    expect(harness.draftEnabled()).toBe(false)
    expect(response.headers.get('Location')).toBeNull()
  })

  it('auth-hiba esetén 500, magyar üzenettel, draft mode nélkül', async () => {
    let draftEnabled = false
    const handler = createPreviewHandler({
      getPayload: async () => {
        throw new Error('a kapcsolat megszakadt')
      },
      enableDraftMode: async () => {
        draftEnabled = true
      },
    })

    const response = await handler(previewRequest('?collection=pages&slug=rolunk'))
    const message = await errorMessage(response)

    expect(response.status).toBe(500)
    expect(message).toContain('technikai hiba')
    expect(hasHungarianAccent(message)).toBe(true)
    // A hiba részlete nem szivároghat ki a felhasználónak.
    expect(message).not.toContain('a kapcsolat megszakadt')
    expect(draftEnabled).toBe(false)
  })
})

describe('sanitizeReturnPath (open-redirect védelem)', () => {
  it('azonos eredetű, gyökérből induló útvonalat átenged', () => {
    expect(sanitizeReturnPath('/')).toBe('/')
    expect(sanitizeReturnPath('/rolunk')).toBe('/rolunk')
    expect(sanitizeReturnPath('/blog/elso-cikk')).toBe('/blog/elso-cikk')
    expect(sanitizeReturnPath('/blog?oldal=2#tetejere')).toBe('/blog?oldal=2#tetejere')
    expect(sanitizeReturnPath('  /rolunk  ')).toBe('/rolunk')
  })

  it.each([
    ['protokoll-relatív külső cím', '//evil.example.test'],
    ['visszaperjeles változat', '/\\evil.example.test'],
    ['abszolút http URL', 'http://evil.example.test/atveres'],
    ['abszolút https URL', 'https://evil.example.test/atveres'],
    ['séma nélküli relatív útvonal', 'rolunk'],
    ['javascript-séma', 'javascript:alert(1)'],
    ['data-séma', 'data:text/html,<script></script>'],
    ['üres szöveg', ''],
    ['csak szóköz', '   '],
  ])('%s → a kezdőlapra esik vissza', (_label, value) => {
    expect(sanitizeReturnPath(value)).toBe('/')
  })

  it.each([
    ['soremelés (fejléc-injekció)', '/blog\nLocation: https://evil.example.test'],
    ['kocsivissza', '/blog\r\nSet-Cookie: a=b'],
    ['tabulátor', '/blog\tvalami'],
    ['DEL karakter', '/blog\u007f'],
  ])('%s → a kezdőlapra esik vissza', (_label, value) => {
    expect(sanitizeReturnPath(value)).toBe('/')
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['szám', 42],
    ['objektum', { path: '/rolunk' }],
    ['tömb', ['/rolunk']],
  ])('nem szöveg (%s) → a kezdőlapra esik vissza', (_label, value) => {
    expect(sanitizeReturnPath(value)).toBe('/')
  })
})

describe('buildExitPreviewHref', () => {
  it('a kilépő route-ra mutat, a visszatérési útvonallal', () => {
    expect(buildExitPreviewHref('/blog/elso-cikk')).toBe(
      `${EXIT_PREVIEW_PATH}?${RETURN_PATH_PARAM}=%2Fblog%2Felso-cikk`,
    )
  })

  it('a nem biztonságos visszatérési útvonalat már a link-építéskor kiszűri', () => {
    expect(buildExitPreviewHref('//evil.example.test')).toBe(
      `${EXIT_PREVIEW_PATH}?${RETURN_PATH_PARAM}=%2F`,
    )
  })
})

describe('/next/exit-preview — kilépés az előnézetből', () => {
  interface ExitHarness {
    handler: (request: Request) => Promise<Response>
    /** Igaz, ha a handler kikapcsolta a Next draft mode-ját. */
    disabled: () => boolean
  }

  const exitHarness = (): ExitHarness => {
    let disabled = false
    return {
      handler: createExitPreviewHandler({
        disableDraftMode: async () => {
          disabled = true
        },
      }),
      disabled: () => disabled,
    }
  }

  const exitRequest = (query: string): Request =>
    new Request(`${ORIGIN}${EXIT_PREVIEW_PATH}${query}`)

  it('kikapcsolja a draft mode-ot és visszairányít a megnézett oldalra', async () => {
    const harness = exitHarness()

    const response = await harness.handler(
      exitRequest(`?${RETURN_PATH_PARAM}=%2Fblog%2Felso-cikk`),
    )

    expect(response.status).toBe(307)
    expect(response.headers.get('Location')).toBe(`${ORIGIN}/blog/elso-cikk`)
    expect(harness.disabled()).toBe(true)
  })

  it('visszatérési útvonal nélkül a kezdőlapra visz', async () => {
    const harness = exitHarness()

    const response = await harness.handler(exitRequest(''))

    expect(response.headers.get('Location')).toBe(`${ORIGIN}/`)
    expect(harness.disabled()).toBe(true)
  })

  it('proxy mögött a Location a NEXT_PUBLIC_SERVER_URL originjére épül (nem a belső hostra)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SERVER_URL', 'https://kineticare.example.test')
    try {
      const harness = exitHarness()
      // A request.url szándékosan a konténer BELSŐ címe (a Railway edge ezt adja át):
      const response = await harness.handler(
        new Request(`http://localhost:8080${EXIT_PREVIEW_PATH}?${RETURN_PATH_PARAM}=%2Fblog`),
      )

      expect(response.status).toBe(307)
      expect(response.headers.get('Location')).toBe('https://kineticare.example.test/blog')
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it.each([
    ['protokoll-relatív cím', `?${RETURN_PATH_PARAM}=%2F%2Fevil.example.test`],
    ['abszolút URL', `?${RETURN_PATH_PARAM}=https%3A%2F%2Fevil.example.test%2Fatveres`],
    ['visszaperjeles változat', `?${RETURN_PATH_PARAM}=%2F%5Cevil.example.test`],
  ])('%s: nem visz ki idegen oldalra (a draft mode így is kikapcsol)', async (_label, query) => {
    const harness = exitHarness()

    const response = await harness.handler(exitRequest(query))
    const location = new URL(response.headers.get('Location') ?? '')

    expect(location.origin).toBe(ORIGIN)
    expect(location.pathname).toBe('/')
    expect(harness.disabled()).toBe(true)
  })

  it('a fejléc-injekciós kísérlet sem jut át a Location fejlécbe', async () => {
    const harness = exitHarness()

    const response = await harness.handler(
      exitRequest(`?${RETURN_PATH_PARAM}=%2Fblog%0ALocation%3A%20https%3A%2F%2Fevil.example.test`),
    )

    expect(response.headers.get('Location')).toBe(`${ORIGIN}/`)
  })
})
