import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import { jelenlegiBeallitasSzovege } from '../components/analytics/ConsentBanner'
import {
  applyConsentToBarionPixel,
  BARION_CONSENT_MAX_ATTEMPTS,
  BARION_GRANT_CONSENT,
  BARION_REJECT_CONSENT,
  barionConsentCommand,
  isBarionPixelReady,
  sendBarionConsent,
  type BarionConsentScheduler,
  type BarionPixelCaller,
} from '../lib/analytics/barion-consent'
import {
  CONSENT_MAX_AGE_MS,
  CONSENT_STORAGE_KEY,
  CONSENT_TIMESTAMP_KEY,
  consentBannerVisible,
  consentSnapshotStale,
  consentSnapshotState,
  isConsentExpired,
  readConsent,
  readConsentRecord,
  readConsentSnapshot,
  writeConsent,
  type ConsentReader,
  type ConsentWriter,
} from '../lib/analytics/consent'

/**
 * ŐR-TESZT — Barion Pixel hozzájárulás-jelzés + a süti-sáv KÖTELEZŐ
 * időszakos visszatérése.
 * 1. A Barion hozzájáruláskezelési követelménye szerint az ELUTASÍTÁS is
 * JELZÉS: `bp('consent','rejectConsent')`. A kézenfekvő hiba az, hogy
 * elutasításnál egyszerűen „nem hívunk semmit" — az a Barion felé
 */

/** Map-alapú localStorage-mock (getItem/setItem/removeItem). */
function memoryStorage(initial?: Record<string, string>): ConsentReader & ConsentWriter {
  const map = new Map<string, string>(Object.entries(initial ?? {}))
  return {
    getItem: (key: string) => (map.has(key) ? (map.get(key) ?? null) : null),
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
  }
}

/** Szabályos alakú teszt-azonosító (a valódi env sosem kerül a tesztbe). */
const TESZT_PIXEL_ID = 'BP-oA1zcu4uwm-C0'

const NAP_MS = 24 * 60 * 60 * 1000

describe('barionConsentCommand — az állapot → parancs leképezés', () => {
  it("'granted' → grantConsent, 'denied' → rejectConsent, 'unknown' → nincs parancs", () => {
    expect(barionConsentCommand('granted')).toBe(BARION_GRANT_CONSENT)
    expect(barionConsentCommand('denied')).toBe(BARION_REJECT_CONSENT)
    expect(barionConsentCommand('unknown')).toBeNull()
  })

  it('a parancsnevek a Barion API-referencia szó szerinti alakjai', () => {
    expect(BARION_GRANT_CONSENT).toBe('grantConsent')
    expect(BARION_REJECT_CONSENT).toBe('rejectConsent')
  })
})

describe('applyConsentToBarionPixel — a jelzés kimenetele', () => {
  it("elfogadásnál PONTOSAN egy bp('consent','grantConsent') hívás megy ki", () => {
    const bp = vi.fn<BarionPixelCaller>()

    expect(applyConsentToBarionPixel('granted', { bp, pixelId: TESZT_PIXEL_ID })).toBe(true)
    expect(bp).toHaveBeenCalledTimes(1)
    expect(bp).toHaveBeenCalledWith('consent', 'grantConsent')
  })

  it('elutasításnál a rejectConsent TÉNYLEG kimegy (nem az a megoldás, hogy elmarad a hívás)', () => {
    const bp = vi.fn<BarionPixelCaller>()

    expect(applyConsentToBarionPixel('denied', { bp, pixelId: TESZT_PIXEL_ID })).toBe(true)
    expect(bp).toHaveBeenCalledTimes(1)
    expect(bp).toHaveBeenCalledWith('consent', 'rejectConsent')
    // A hívás ELSŐ argumentuma a téma, a MÁSODIK a parancs — a sorrend is szerződés.
    expect(bp.mock.calls[0]).toEqual(['consent', 'rejectConsent'])
  })

  it("döntés nélkül ('unknown') egyetlen jelzés sem megy ki", () => {
    const bp = vi.fn<BarionPixelCaller>()

    expect(applyConsentToBarionPixel('unknown', { bp, pixelId: TESZT_PIXEL_ID })).toBe(false)
    expect(bp).not.toHaveBeenCalled()
  })

  it('pixel-azonosító nélkül (nincs beállítva / üres) nincs hívás', () => {
    const bp = vi.fn<BarionPixelCaller>()

    expect(applyConsentToBarionPixel('granted', { bp, pixelId: null })).toBe(false)
    expect(applyConsentToBarionPixel('granted', { bp, pixelId: '   ' })).toBe(false)
    expect(bp).not.toHaveBeenCalled()
  })

  it('injektált hívó nélkül a globális `bp` készenlétét vizsgálja', () => {
    expect(isBarionPixelReady({})).toBe(false)
    expect(isBarionPixelReady({ bp: 'nem függvény' })).toBe(false)
    expect(isBarionPixelReady({ bp: () => undefined })).toBe(true)

    // Nincs `bp` a névtérben → a jelzés nem megy ki (némán, hiba nélkül).
    expect(applyConsentToBarionPixel('granted', { pixelId: TESZT_PIXEL_ID, scope: {} })).toBe(false)
  })

  it('dobó hívó esetén sem dob (a mérés nem viheti magával a felületet)', () => {
    const bp = vi.fn<BarionPixelCaller>(() => {
      throw new Error('a pixel elszállt')
    })

    expect(applyConsentToBarionPixel('granted', { bp, pixelId: TESZT_PIXEL_ID })).toBe(false)
  })
})

describe('sendBarionConsent — újrapróbálkozás, amíg a pixel megjelenik', () => {
  /** Kézzel léptethető időzítő: a várakozás nem valós idő, hanem lépés. */
  function manualScheduler(): { schedule: BarionConsentScheduler; run: () => void } {
    let pending: (() => void) | null = null
    return {
      schedule: (callback) => {
        pending = callback
        return () => {
          pending = null
        }
      },
      run: () => {
        const callback = pending
        pending = null
        callback?.()
      },
    }
  }

  it('a később megjelenő `bp` is megkapja a jelzést', () => {
    const scope: { bp?: unknown } = {}
    const timer = manualScheduler()

    const cancel = sendBarionConsent('granted', {
      pixelId: TESZT_PIXEL_ID,
      scope,
      schedule: timer.schedule,
    })

    // Az első kísérlet még üresbe megy: a snippet nem futott le.
    const hivasok: unknown[][] = []
    scope.bp = (...args: unknown[]) => {
      hivasok.push(args)
    }
    timer.run()

    expect(hivasok).toEqual([['consent', 'grantConsent']])
    cancel()
  })

  it('a lemondó függvény leállítja a függő újrapróbálkozást', () => {
    const scope: { bp?: unknown } = {}
    const timer = manualScheduler()

    const cancel = sendBarionConsent('denied', {
      pixelId: TESZT_PIXEL_ID,
      scope,
      schedule: timer.schedule,
    })
    cancel()

    const bp = vi.fn<BarionPixelCaller>()
    scope.bp = bp
    timer.run()

    expect(bp).not.toHaveBeenCalled()
  })

  it('a lemondás után a MÁR ELINDULT időzítés sem küld jelzést', () => {
    // Olyan időzítő, amelynek a lemondása nem tudja visszahívni a visszahívást
    // (a valóságban: a setTimeout épp lefutott, mire a takarítás megjött).
    // Ilyenkor a modul saját „lemondva" jelzésének kell megfognia a hívást.
    let pending: (() => void) | null = null
    const schedule: BarionConsentScheduler = (callback) => {
      pending = callback
      return () => undefined
    }
    const scope: { bp?: unknown } = {}
    const bp = vi.fn<BarionPixelCaller>()

    const cancel = sendBarionConsent('granted', { pixelId: TESZT_PIXEL_ID, scope, schedule })
    cancel()
    scope.bp = bp
    ;(pending as (() => void) | null)?.()

    expect(bp).not.toHaveBeenCalled()
  })

  it('korlátos: a próbálkozások száma nem végtelen', () => {
    const schedule = vi.fn<BarionConsentScheduler>((callback) => {
      callback()
      return () => undefined
    })

    sendBarionConsent('granted', {
      pixelId: TESZT_PIXEL_ID,
      scope: {},
      schedule,
      maxAttempts: 4,
    })

    // 4 kísérlet = 3 újraütemezés (az elsőt a hívás maga indítja).
    expect(schedule).toHaveBeenCalledTimes(3)
    expect(BARION_CONSENT_MAX_ATTEMPTS).toBeGreaterThan(1)
  })

  it('azonosító nélkül el sem indul az újrapróbálkozás', () => {
    const schedule = vi.fn<BarionConsentScheduler>(() => () => undefined)

    sendBarionConsent('granted', { pixelId: null, scope: {}, schedule })

    expect(schedule).not.toHaveBeenCalled()
  })
})

describe('újrakérdezés — a tárolt döntés kora', () => {
  it('a döntés írásakor IDŐBÉLYEG is íródik, és visszaolvasható', () => {
    const storage = memoryStorage()
    const most = Date.UTC(2026, 7, 17, 12, 0, 0)

    expect(writeConsent('granted', storage, most)).toBe(true)
    expect(storage.getItem(CONSENT_STORAGE_KEY)).toBe('granted')
    expect(storage.getItem(CONSENT_TIMESTAMP_KEY)).toBe(String(most))
    expect(readConsentRecord(storage)).toEqual({ state: 'granted', decidedAt: most })
  })

  it("a döntés visszavonása ('unknown') mindkét kulcsot törli", () => {
    const storage = memoryStorage({
      [CONSENT_STORAGE_KEY]: 'granted',
      [CONSENT_TIMESTAMP_KEY]: '1',
    })

    expect(writeConsent('unknown', storage)).toBe(true)
    expect(storage.getItem(CONSENT_STORAGE_KEY)).toBeNull()
    expect(storage.getItem(CONSENT_TIMESTAMP_KEY)).toBeNull()
  })

  it('friss döntés nem jár lejárattal, a küszöb átlépése igen', () => {
    const most = Date.UTC(2026, 7, 17, 12, 0, 0)
    const friss = { state: 'granted', decidedAt: most - CONSENT_MAX_AGE_MS + NAP_MS } as const
    const lejart = { state: 'granted', decidedAt: most - CONSENT_MAX_AGE_MS - NAP_MS } as const

    expect(isConsentExpired(friss, most)).toBe(false)
    expect(isConsentExpired(lejart, most)).toBe(true)
    // Pontosan a küszöbön már lejárt (a plafon alatt akarunk maradni).
    expect(isConsentExpired({ state: 'denied', decidedAt: most - CONSENT_MAX_AGE_MS }, most)).toBe(
      true,
    )
  })

  it("döntés nélkül ('unknown') nincs mit lejáratni", () => {
    expect(isConsentExpired({ state: 'unknown', decidedAt: null }, Date.now())).toBe(false)
  })

  it('a lejárt döntés VISSZAHOZZA a sávot, de a döntést nem törli', () => {
    const most = Date.UTC(2026, 7, 17, 12, 0, 0)
    const storage = memoryStorage({
      [CONSENT_STORAGE_KEY]: 'denied',
      [CONSENT_TIMESTAMP_KEY]: String(most - CONSENT_MAX_AGE_MS - NAP_MS),
    })

    const snapshot = readConsentSnapshot(storage, most)

    expect(consentSnapshotState(snapshot)).toBe('denied')
    expect(consentSnapshotStale(snapshot)).toBe(true)
    expect(consentBannerVisible('denied', false, true)).toBe(true)
    // A korábbi beállítás ÉRVÉNYBEN marad — a sáv ezzel jön vissza, nem üresen.
    expect(readConsent(storage)).toBe('denied')
    expect(storage.getItem(CONSENT_STORAGE_KEY)).toBe('denied')
  })

  it('friss döntésnél a sáv NEM jön vissza (nem zaklatunk)', () => {
    const most = Date.UTC(2026, 7, 17, 12, 0, 0)
    const storage = memoryStorage({
      [CONSENT_STORAGE_KEY]: 'granted',
      [CONSENT_TIMESTAMP_KEY]: String(most - NAP_MS),
    })

    const snapshot = readConsentSnapshot(storage, most)

    expect(consentSnapshotStale(snapshot)).toBe(false)
    expect(consentBannerVisible(consentSnapshotState(snapshot), false, false)).toBe(false)
  })

  it('örökölt, IDŐBÉLYEG NÉLKÜLI döntés: egyszer újrakérdezünk, de nem dobjuk el', () => {
    const storage = memoryStorage({ [CONSENT_STORAGE_KEY]: 'granted' })

    const record = readConsentRecord(storage)
    expect(record).toEqual({ state: 'granted', decidedAt: null })
    expect(isConsentExpired(record, Date.now())).toBe(true)
    expect(readConsent(storage)).toBe('granted')
    expect(storage.getItem(CONSENT_STORAGE_KEY)).toBe('granted')

    // Az új döntés már időbélyeggel íródik → utána nyugton marad.
    const most = Date.UTC(2026, 7, 17, 12, 0, 0)
    writeConsent('granted', storage, most)
    expect(isConsentExpired(readConsentRecord(storage), most)).toBe(false)
  })

  it('sérült vagy jövőbeli időbélyeg → ismeretlen/nem hihető kor, újrakérdezés, hiba nélkül', () => {
    const most = Date.UTC(2026, 7, 17, 12, 0, 0)
    const serult = memoryStorage({
      [CONSENT_STORAGE_KEY]: 'granted',
      [CONSENT_TIMESTAMP_KEY]: 'tegnap',
    })
    const jovobeli = memoryStorage({
      [CONSENT_STORAGE_KEY]: 'granted',
      [CONSENT_TIMESTAMP_KEY]: String(most + 30 * NAP_MS),
    })

    expect(() => readConsentRecord(serult)).not.toThrow()
    expect(readConsentRecord(serult).decidedAt).toBeNull()
    expect(isConsentExpired(readConsentRecord(serult), most)).toBe(true)
    expect(isConsentExpired(readConsentRecord(jovobeli), most)).toBe(true)
    // A döntés egyik esetben sem vész el.
    expect(readConsent(serult)).toBe('granted')
    expect(readConsent(jovobeli)).toBe('granted')
  })

  it('tárolóhiba esetén sem dob (letiltott tárhely)', () => {
    const broken: ConsentReader = {
      getItem: () => {
        throw new Error('storage tiltva')
      },
    }
    expect(readConsentRecord(broken)).toEqual({ state: 'unknown', decidedAt: null })
  })

  it('a küszöb a Barion 13 hónapos PLAFONJA alatt van, és nem nulla', () => {
    const tizenharomHonap = 396 * NAP_MS
    expect(CONSENT_MAX_AGE_MS).toBeGreaterThan(0)
    expect(CONSENT_MAX_AGE_MS).toBeLessThan(tizenharomHonap)
  })

  it('a pillanatkép primitív és stabil (useSyncExternalStore-követelmény)', () => {
    const most = Date.UTC(2026, 7, 17, 12, 0, 0)
    const storage = memoryStorage({
      [CONSENT_STORAGE_KEY]: 'granted',
      [CONSENT_TIMESTAMP_KEY]: String(most - NAP_MS),
    })

    const elso = readConsentSnapshot(storage, most)
    const masodik = readConsentSnapshot(storage, most)

    expect(typeof elso).toBe('string')
    expect(masodik).toBe(elso)
    expect(elso).toBe('granted:fresh')
  })
})

describe('a visszatérő sáv szövege — a KORÁBBI beállítás látszik', () => {
  it('elfogadás után a lejáratkor a beállítás és az újrakérdezés oka is kiderül', () => {
    const szoveg = jelenlegiBeallitasSzovege('granted', true)

    expect(szoveg).toContain('Jelenlegi beállítása')
    expect(szoveg).toContain('elfogadta az analitikát')
    expect(szoveg).toContain('Évente egyszer rákérdezünk')
  })

  it('elutasítás után is a SAJÁT beállítását olvassa vissza a látogató', () => {
    const szoveg = jelenlegiBeallitasSzovege('denied', true)

    expect(szoveg).toContain('elutasította az analitikát')
    expect(szoveg).not.toContain('elfogadta az analitikát')
  })

  it('a lábléc gombjával újranyitva a módosítás lehetősége áll a mondatban', () => {
    expect(jelenlegiBeallitasSzovege('granted', false)).toBe(
      'Jelenlegi beállítása: elfogadta az analitikát. Alább módosíthatja.',
    )
  })

  it('első látogatáskor (nincs döntés) nincs ilyen mondat', () => {
    expect(jelenlegiBeallitasSzovege('unknown', false)).toBeNull()
    expect(jelenlegiBeallitasSzovege(null, true)).toBeNull()
  })

  it('a mondatokban nincs töltelék gondolatjel (natív magyar mikroszöveg)', () => {
    const mondatok = [
      jelenlegiBeallitasSzovege('granted', true),
      jelenlegiBeallitasSzovege('denied', false),
    ]
    for (const mondat of mondatok) {
      expect(mondat).not.toMatch(/[–—]/)
    }
  })
})

/**
 * A sáv és a jelzés ÖSSZEKÖTÉSE — forrás-szintű őr.
 *
 * A ConsentBanner React-EFFEKTEKBEN köti be a Barion-jelzést; a repó
 * tesztkörnyezete node (nincs DOM-futtató), ezért az effekt nem játszható le
 * futásidőben. A bekötés viszont némán kieshet egy „takarítás" során, ezért a
 * forrás TÉNYLEGES HÍVÁSAIT őrizzük — nem az import sorát, mert az a hívás
 * törlése után is ott maradna (ezt a mutációs próba mutatta meg).
 */
describe('ConsentBanner — a bekötés megléte', () => {
  const FORRAS = readFileSync(
    fileURLToPath(new URL('../components/analytics/ConsentBanner.tsx', import.meta.url)),
    'utf8',
  )

  it('a sáv betöltéskor a TÁROLT döntést jelzi a Barion Pixelnek', () => {
    expect(FORRAS).toContain('sendBarionConsent(readConsent())')
  })

  it('a későbbi MÓDOSÍTÁS is kimegy (a consent-eseményre)', () => {
    expect(FORRAS).toContain('CONSENT_EVENT')
    expect(FORRAS).toContain('consentStateFromEvent(event)')
    expect(FORRAS).toMatch(/cancelBarionConsent = sendBarionConsent\(/)
  })

  it('a lejáratot a láthatóság is figyeli, és a mondat ki is renderelődik', () => {
    expect(FORRAS).toContain('consentSnapshotStale')
    expect(FORRAS).toMatch(/consentBannerVisible\(consent, reopened, [^)]*stale\)/)
    expect(FORRAS).toContain('jelenlegiBeallitasSzovege(consent, stale)')
    expect(FORRAS).toContain('{jelenlegiBeallitas')
  })

  it('a sáv NEM tölti be és NEM kapuzza az alap pixelt', () => {
    // Az alap pixel a jogos érdeken fut: a sávnak semmi köze a betöltéséhez.
    expect(FORRAS).not.toContain('BARION_PIXEL_SCRIPT_SRC')
    expect(FORRAS).not.toContain('barionPixelNoscriptUrl')
  })
})
