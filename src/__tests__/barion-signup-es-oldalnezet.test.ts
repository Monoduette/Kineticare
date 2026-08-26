import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  BARION_PAGE_VIEW,
  BARION_SESSION_SIGNUP_KEY,
  BARION_SIGNUP,
  BARION_TRACK_METHOD,
  buildPageViewPayload,
  buildSignUpPayload,
  claimBarionSessionSignUp,
  trackAccountSignUp,
  trackPageView,
  trackSignUp,
  type BarionOnceLatch,
  type BarionSnapshotStorage,
} from '@/lib/analytics/barion-events'
import { trackedLogin } from '@/components/auth/LoginForm'
import { trackedRegister } from '@/components/auth/RegisterForm'
import { trackedSubmitNewsletter } from '@/components/layout/NewsletterForm'

/**
 * A Barion Pixel `signUp` és az OLDAL-SZINTŰ `contentView` őr-tesztjei.
 * A szerződést nem memóriából vettük: a futtatott pixel-kódból
 * olvasható forrás). A mérvadó két részlet:
 * - `case 'signUp': mandatory_keys = ['id', 'contentType', 'name'];` — és a
 * hozzá tartozó `type_conversion` tábla kulcsai: id, contentType, name,
 */

vi.stubGlobal('fetch', () => {
  throw new Error('A tesztből SOSEM mehet ki valódi hálózati hívás.')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Egy hívás-kém a `bp`-hez: a teljes argumentumlistát eltárolja. */
function spySend() {
  const calls: unknown[][] = []
  return {
    calls,
    send: (...args: readonly unknown[]) => {
      calls.push([...args])
    },
  }
}

/** Memóriában élő, `sessionStorage`-alakú tároló. */
function fakeStorage(): BarionSnapshotStorage & { map: Map<string, string> } {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value)
    },
    removeItem: (key) => {
      map.delete(key)
    },
  }
}

/** Friss memória-retesz — így két teszt sosem szennyezi egymást. */
function freshLatch(): BarionOnceLatch {
  return new Set<string>()
}

const REPO_ROOT = join(import.meta.dirname, '..', '..')

/** A `src` alatti .ts/.tsx fájlok listája (a node_modules és a .next kizárva). */
function sourceFiles(relativeRoot: string): string[] {
  const found: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
        found.push(full)
      }
    }
  }
  walk(join(REPO_ROOT, relativeRoot))
  return found
}

describe('signUp — a bp.js szerződése', () => {
  it('a törzs PONTOSAN a három kötelező kulcs, és `step` NINCS benne', () => {
    const payload = buildSignUpPayload(BARION_SIGNUP.login)
    expect(payload).not.toBeNull()
    // A kulcshalmaz rögzítése: a bp.js signUp-ága a `step`-et nem ismeri, az
    // ISMERETLEN kulcsot pedig 13-as hibával eldobja.
    expect(Object.keys(payload as object).sort()).toEqual(['contentType', 'id', 'name'])
    expect(payload).not.toHaveProperty('step')
    expect((payload as { contentType: string }).contentType).toBe('Page')
  })

  it('a szótár mind a négy eseménye érvényes törzset ad, magyar névvel', () => {
    const events = Object.values(BARION_SIGNUP)
    expect(events).toHaveLength(4)
    for (const event of events) {
      const payload = buildSignUpPayload(event)
      expect(payload).not.toBeNull()
      expect(Object.keys(payload as object)).not.toContain('step')
    }
    expect(BARION_SIGNUP.registration.name).toBe('Regisztráció')
    expect(BARION_SIGNUP.login.name).toBe('Belépés')
    expect(BARION_SIGNUP.newsletter.name).toBe('Hírlevél feliratkozás')
    // Az implicit (munkamenet-nyitó) belépés neve azonos, az AZONOSÍTÓJA nem:
    // a riportban el kell válnia a most beírt jelszóval történt belépéstől.
    expect(BARION_SIGNUP.persistentLogin.name).toBe('Belépés')
    expect(BARION_SIGNUP.persistentLogin.id).not.toBe(BARION_SIGNUP.login.id)
  })

  it('a hívás pontosan háromelemű: track / signUp / törzs', () => {
    const spy = spySend()
    expect(trackSignUp(BARION_SIGNUP.newsletter, spy.send)).toBe(true)
    expect(spy.calls).toHaveLength(1)
    expect(spy.calls[0]).toHaveLength(3)
    expect(spy.calls[0][0]).toBe(BARION_TRACK_METHOD)
    expect(spy.calls[0][1]).toBe('signUp')
    expect(spy.calls[0][2]).toEqual({
      contentType: 'Page',
      id: 'hirlevel-feliratkozas',
      name: 'Hírlevél feliratkozás',
    })
  })
})

describe('signUp — SIKERES beküldésre megy ki, nem mountra', () => {
  it('a sikertelen belépés NEM signUp, a sikeres pontosan egy', async () => {
    const failed: { id: string; name: string }[] = []
    const rejected = await trackedLogin(
      { email: 'a@b.hu', password: 'rossz' },
      {
        login: async () => ({ ok: false, message: 'Hibás e-mail-cím vagy jelszó.' }),
        track: (event) => {
          failed.push(event)
          return true
        },
      },
    )
    expect(rejected.ok).toBe(false)
    expect(failed).toHaveLength(0)

    const sent: { id: string; name: string }[] = []
    const accepted = await trackedLogin(
      { email: 'a@b.hu', password: 'helyes-jelszo' },
      {
        login: async () => ({ ok: true }),
        track: (event) => {
          sent.push(event)
          return true
        },
      },
    )
    expect(accepted.ok).toBe(true)
    expect(sent).toEqual([{ id: 'belepes', name: 'Belépés' }])
  })

  it('a visszautasított regisztráció NEM signUp, a sikeres pontosan egy', async () => {
    const input = { email: 'a@b.hu', password: 'nagyon-hosszu-jelszo', name: 'Teszt Elek' }

    const failed: { id: string; name: string }[] = []
    const rejected = await trackedRegister(input, {
      register: async () => ({ ok: false, message: 'Ez az e-mail-cím már foglalt…' }),
      track: (event) => {
        failed.push(event)
        return true
      },
    })
    expect(rejected.ok).toBe(false)
    expect(failed).toHaveLength(0)

    const sent: { id: string; name: string }[] = []
    const accepted = await trackedRegister(input, {
      register: async () => ({ ok: true }),
      track: (event) => {
        sent.push(event)
        return true
      },
    })
    expect(accepted.ok).toBe(true)
    expect(sent).toEqual([{ id: 'regisztracio', name: 'Regisztráció' }])
  })

  it('a hibára futó hírlevél-beküldés NEM signUp, a sikeres pontosan egy', async () => {
    const payload = { form: '7', submissionData: [] }

    const failed: { id: string; name: string }[] = []
    const rejected = await trackedSubmitNewsletter(payload, {
      submit: async () => ({ ok: false as const, message: 'A feliratkozás most nem sikerült.' }),
      track: (event) => {
        failed.push(event)
        return true
      },
    })
    expect(rejected.ok).toBe(false)
    expect(failed).toHaveLength(0)

    const sent: { id: string; name: string }[] = []
    const accepted = await trackedSubmitNewsletter(payload, {
      submit: async () => ({ ok: true as const }),
      track: (event) => {
        sent.push(event)
        return true
      },
    })
    expect(accepted.ok).toBe(true)
    expect(sent).toEqual([{ id: 'hirlevel-feliratkozas', name: 'Hírlevél feliratkozás' }])
  })

  it('a KÖVETÉS HIBÁJA nem ronthatja el a belépést, a regisztrációt és a feliratkozást', async () => {
    const explode = () => {
      throw new Error('a pixel elszállt')
    }

    await expect(
      trackedLogin({ email: 'a@b.hu', password: 'x' }, { login: async () => ({ ok: true }), track: explode }),
    ).resolves.toEqual({ ok: true })

    await expect(
      trackedRegister(
        { email: 'a@b.hu', password: 'nagyon-hosszu-jelszo', name: 'Teszt Elek' },
        { register: async () => ({ ok: true }), track: explode },
      ),
    ).resolves.toEqual({ ok: true })

    await expect(
      trackedSubmitNewsletter(
        { form: '7', submissionData: [] },
        { submit: async () => ({ ok: true as const }), track: explode },
      ),
    ).resolves.toEqual({ ok: true })
  })
})

describe('signUp — munkamenetenként EGY implicit esemény', () => {
  it('ugyanabban a munkamenetben másodszor már nem kell küldeni', () => {
    const storage = fakeStorage()
    const latch = freshLatch()
    expect(claimBarionSessionSignUp(storage, latch)).toBe(true)
    expect(claimBarionSessionSignUp(storage, latch)).toBe(false)
    expect(storage.map.get(BARION_SESSION_SIGNUP_KEY)).toBeDefined()
  })

  it('a retesz TÚLÉLI a teljes oldalletöltést (a sessionStorage-ban marad)', () => {
    const storage = fakeStorage()
    expect(claimBarionSessionSignUp(storage, freshLatch())).toBe(true)
    // Új dokumentum = üres memória-retesz, de UGYANAZ a sessionStorage.
    expect(claimBarionSessionSignUp(storage, freshLatch())).toBe(false)
  })

  it('letiltott vagy dobó tároló mellett sem dob, és marad a memória-retesz', () => {
    const hostile: BarionSnapshotStorage = {
      getItem: () => {
        throw new Error('a tároló le van tiltva')
      },
      setItem: () => {
        throw new Error('a tároló le van tiltva')
      },
      removeItem: () => undefined,
    }
    const latch = freshLatch()
    expect(() => claimBarionSessionSignUp(hostile, latch)).not.toThrow()
    expect(claimBarionSessionSignUp(hostile, latch)).toBe(false)
    // SSR / nincs tároló: a memória-retesz önmagában is dolgozik.
    const ssrLatch = freshLatch()
    expect(claimBarionSessionSignUp(null, ssrLatch)).toBe(true)
    expect(claimBarionSessionSignUp(null, ssrLatch)).toBe(false)
  })

  it('a KIFEJEZETT belépés elfoglalja a reteszt, a hírlevél-feliratkozás NEM', () => {
    const spy = spySend()
    const storage = fakeStorage()
    const latch = freshLatch()
    expect(trackAccountSignUp(BARION_SIGNUP.login, spy.send, storage, latch)).toBe(true)
    expect(spy.calls).toHaveLength(1)
    // A beléptetés utáni átirányításkor a fejléc implicit signUp-ja már
    // ugyanazt a belépést jelentené másodszor — ezért nem kell küldeni.
    expect(claimBarionSessionSignUp(storage, latch)).toBe(false)

    // A feliratkozás nem beléptetés: nem foglalhatja el a munkamenet reteszét,
    // különben elnyelné a KÉSŐBBI valódi belépés implicit jelzését.
    const other = fakeStorage()
    const otherLatch = freshLatch()
    expect(trackSignUp(BARION_SIGNUP.newsletter, spy.send)).toBe(true)
    expect(claimBarionSessionSignUp(other, otherLatch)).toBe(true)
  })
})

describe('contentView — oldal-szintű (contentType: Page)', () => {
  it('a törzs csak a három kötelezőt viszi, ár-mezők nélkül', () => {
    const payload = buildPageViewPayload(BARION_PAGE_VIEW.courseList)
    expect(payload).not.toBeNull()
    expect(Object.keys(payload as object).sort()).toEqual(['contentType', 'id', 'name'])
    // A `unitPrice`/`unit`/`currency`/`quantity` KIZÁRÓLAG a Product-ágon
    // kötelező (bp.js `validate`); a `totalItemPrice` és a `revenue` pedig
    // ISMERETLEN kulcs a contentView-ban — a pixel eldobná őket.
    for (const forbidden of ['unitPrice', 'unit', 'currency', 'quantity', 'totalItemPrice', 'revenue']) {
      expect(payload).not.toHaveProperty(forbidden)
    }
  })

  it('a `list` csak megadva kerül a törzsbe, és a bp.js kötött listájából való', () => {
    const home = buildPageViewPayload(BARION_PAGE_VIEW.home)
    expect(home).toHaveProperty('list', 'HomePage')
    expect(buildPageViewPayload(BARION_PAGE_VIEW.knowledgeBase)).not.toHaveProperty('list')
    // A kurzuslista és a Tudástár SZÁNDÉKOSAN `list` nélkül megy: a
    // 'ProductPage' a kurzus-oldalé, a 'Misc' pedig nem mond többet a
    // hiányzó mezőnél.
    expect(buildPageViewPayload(BARION_PAGE_VIEW.courseList)).not.toHaveProperty('list')
  })

  it('a hiányos bemenetből NEM megy ki csonka esemény', () => {
    const spy = spySend()
    expect(buildPageViewPayload({ id: '   ', name: 'Kezdőlap' })).toBeNull()
    expect(buildPageViewPayload({ id: 'kezdolap', name: '' })).toBeNull()
    expect(trackPageView({ id: '', name: 'Kezdőlap' }, spy.send)).toBe(false)
    expect(spy.calls).toHaveLength(0)
  })

  it('a küldés a `contentView` néven, háromelemű alakban történik', () => {
    const spy = spySend()
    expect(trackPageView(BARION_PAGE_VIEW.home, spy.send)).toBe(true)
    expect(spy.calls[0]).toHaveLength(3)
    expect(spy.calls[0][0]).toBe(BARION_TRACK_METHOD)
    expect(spy.calls[0][1]).toBe('contentView')
    expect(spy.calls[0][2]).toEqual({
      contentType: 'Page',
      id: 'kezdolap',
      name: 'Kezdőlap',
      list: 'HomePage',
    })
  })
})

describe('contentView — a TERMÉKOLDALON nincs duplikálás', () => {
  /**
   * A KIRENDERELÉST mérjük, nem a puszta említést: a `<Komponens` alak az,
   * amitől az esemény tényleg kimegy. A fejkommentek egymásra hivatkoznak
   * (épp azért, hogy a duplikálás veszélye látszódjon a kódban), azok viszont
   * nem küldenek semmit.
   */
  const rendersPageView = (source: string) => /<BarionPageView[\s/>]/.test(source)
  const rendersProductView = (source: string) => /<CourseBarionView[\s/>]/.test(source)

  const files = sourceFiles('src')
  const pageViewFiles = files.filter((file) => rendersPageView(readFileSync(file, 'utf8')))
  const productViewFiles = files.filter((file) => rendersProductView(readFileSync(file, 'utf8')))

  it('a kurzus-oldal a Product-ágú eseményt küldi, oldal-szintűt NEM', () => {
    const source = readFileSync(
      join(REPO_ROOT, 'src', 'app', '(frontend)', 'kurzusok', '[slug]', 'page.tsx'),
      'utf8',
    )
    expect(rendersProductView(source)).toBe(true)
    expect(rendersPageView(source)).toBe(false)
  })

  it('a két küldő komponens kirenderelése DISZJUNKT (egy oldalon egy esemény)', () => {
    const pages = new Set(pageViewFiles)
    const products = new Set(productViewFiles)
    expect(pages.size).toBeGreaterThan(0)
    expect(products.size).toBeGreaterThan(0)
    const both = [...pages].filter((file) => products.has(file))
    expect(both).toEqual([])
  })

  it('az oldal-szintű esemény NINCS a közös layoutban (ott a termékoldalon is futna)', () => {
    const layout = readFileSync(join(REPO_ROOT, 'src', 'app', '(frontend)', 'layout.tsx'), 'utf8')
    expect(rendersPageView(layout)).toBe(false)
    // Bekötve viszont ténylegesen van, több nem-termék oldalon.
    expect(
      pageViewFiles.filter((file) => file.includes(join('app', '(frontend)'))).length,
    ).toBeGreaterThanOrEqual(3)
  })
})
