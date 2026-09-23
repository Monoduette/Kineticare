// @vitest-environment happy-dom

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { StrictMode, act, createElement, type Context, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A két lapon nyitott szerkesztő figyelője
 * (src/components/editor/admin/ket-lap-figyelo.ts és KetLapFigyelo.tsx):
 * - a dokumentumkulcs csak a szerkesztő gyökérnézetén képződik;
 * - a verziózott protokoll a formátlan és ismeretlen üzenetet eldobja;
 * - TÖBB PÉLDÁNY EGY HAMIS BUSZON (a BroadcastChannel viselkedésével: a
 *   küldő nem kapja meg a saját üzenetét, a kézbesítés aszinkron): mindkét
 *   lapon figyelmeztet, navigáláskor és pagehide-kor eltűnik, a jelenlét
 *   a válaszokból épül újra (a lefagyott vagy összeomlott lap nem ragad be),
 *   időalapú lejárat NINCS, bezárás után csak új csatlakozásra jön vissza;
 * - a komponens: mindig jelen lévő élő régió, a fókuszt nem veszi el, a
 *   Bezárás gomb a SzekcioMegnyito BEZARAS_FELIRAT-ja, a SzekcioMegnyito
 *   providerből renderelve is működik;
 * - a figyelő 0 hálózati kérést küld.
 */

const kornyezet = vi.hoisted(() => ({
  utvonalKontextus: null as unknown,
  search: '',
}))

vi.mock('next/navigation', async () => {
  const react = await import('react')
  const kontextus = react.createContext('/admin')
  kornyezet.utvonalKontextus = kontextus
  return {
    usePathname: () => react.useContext(kontextus),
    useSearchParams: () => new URLSearchParams(kornyezet.search),
  }
})

vi.mock('@payloadcms/ui', () => ({
  useConfig: () => ({ config: { routes: { admin: '/admin', api: '/api' }, serverURL: '' } }),
}))

const {
  CSATORNA_NEV,
  KET_LAP_CIM,
  KET_LAP_SZOVEG,
  PROTOKOLL_VERZIO,
  VALASZ_ABLAK_MS,
  bongeszoCsatornaGyar,
  dokumentumKulcs,
  eletciklusBekotese,
  jelenletFigyelo,
  ujAzonosito,
  uzenetErtelmezese,
} = await import('../components/editor/admin/ket-lap-figyelo')
type CsatornaGyar = import('../components/editor/admin/ket-lap-figyelo').CsatornaGyar
type Csatorna = import('../components/editor/admin/ket-lap-figyelo').Csatorna
type Uzenet = import('../components/editor/admin/ket-lap-figyelo').Uzenet
type JelenletFigyelo = import('../components/editor/admin/ket-lap-figyelo').JelenletFigyelo
type FigyeltAblak = import('../components/editor/admin/ket-lap-figyelo').FigyeltAblak

const { KetLapFigyelo, SAV_ATTR, SAV_VALTOZO } =
  await import('../components/editor/admin/KetLapFigyelo')
const { BEZARAS_FELIRAT, SzekcioMegnyito } =
  await import('../components/editor/admin/SzekcioMegnyito')

const UtvonalKontextus = kornyezet.utvonalKontextus as Context<string>

const P1 = '/admin/collections/pages/1'
const P2 = '/admin/collections/pages/2'
const K1 = 'collections/pages/1'

/** Hangosan dobó fetch: a figyelőnek egyetlen hálózati kérést sem szabad küldenie. */
const tiltottFetch = vi.fn(() => {
  throw new Error('A két lapon nyitott szerkesztő figyelője nem küldhet hálózati kérést.')
})

beforeEach(() => {
  tiltottFetch.mockClear()
  vi.stubGlobal('fetch', tiltottFetch)
})

afterEach(() => {
  expect(tiltottFetch).not.toHaveBeenCalled()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** Lapazonosító a protokoll alakjában (16–64 jel). */
function lapAzonosito(nev: string): string {
  return `lap-${nev}`.padEnd(20, '0')
}

interface BuszCsatorna {
  lap: string
  fogad: (adat: unknown) => void
  nyitva: boolean
}

interface Kuldes {
  forras: BuszCsatorna | null
  felado: string
  adat: unknown
}

/**
 * Hamis BroadcastChannel-busz. A küldő csatorna nem kapja meg a saját
 * üzenetét, a többi nyitott csatorna igen; a kézbesítés csak `kezbesit()`
 * hívásra történik (aszinkron, mint a valódi csatornán). Egy lap
 * lefagyasztható (az üzenetei sorba állnak, és felengedéskor érkeznek meg),
 * vagy összeomolhat (távozás nélkül tűnik el).
 */
function hamisBusz() {
  const aktiv = new Set<BuszCsatorna>()
  const sor: Kuldes[] = []
  const fagyottak = new Set<string>()
  const fagyottSor = new Map<string, unknown[]>()
  const naplo: { felado: string; adat: unknown }[] = []

  function gyar(lap: string): CsatornaGyar {
    return (nev, fogad) => {
      expect(nev).toBe(CSATORNA_NEV)
      const csatorna: BuszCsatorna = { lap, fogad, nyitva: true }
      aktiv.add(csatorna)
      const burok: Csatorna = {
        kuld: (uzenet) => {
          if (!csatorna.nyitva) {
            throw new Error('lezárt csatornára küldés')
          }
          const adat: unknown = structuredClone(uzenet)
          naplo.push({ felado: lap, adat })
          sor.push({ forras: csatorna, felado: lap, adat })
        },
        lezar: () => {
          csatorna.nyitva = false
          aktiv.delete(csatorna)
        },
      }
      return burok
    }
  }

  function kezbesit(): void {
    let lepes = 0
    while (sor.length > 0) {
      lepes += 1
      if (lepes > 1000) {
        throw new Error('végtelen üzenetváltás')
      }
      const kuldes = sor.shift()
      if (!kuldes) {
        break
      }
      for (const csatorna of [...aktiv]) {
        if (csatorna === kuldes.forras || !csatorna.nyitva) {
          continue
        }
        if (fagyottak.has(csatorna.lap)) {
          fagyottSor.set(csatorna.lap, [...(fagyottSor.get(csatorna.lap) ?? []), kuldes.adat])
          continue
        }
        csatorna.fogad(kuldes.adat)
      }
    }
  }

  return {
    gyar,
    kezbesit,
    naplo,
    /** Kívülről érkező nyers üzenet (pl. egy régi vagy hibás lap). */
    nyersKuldes(adat: unknown): void {
      sor.push({ forras: null, felado: 'kulso', adat })
    },
    fagyaszt(lap: string): void {
      fagyottak.add(lap)
    },
    felenged(lap: string): void {
      fagyottak.delete(lap)
      const varakozo = fagyottSor.get(lap) ?? []
      fagyottSor.delete(lap)
      for (const csatorna of [...aktiv]) {
        if (csatorna.lap === lap) {
          for (const adat of varakozo) {
            csatorna.fogad(adat)
          }
        }
      }
      kezbesit()
    },
    /** A lap csatornája távozás nélkül megszűnik (összeomlás, kilőtt folyamat). */
    osszeomlik(lap: string): void {
      for (const csatorna of [...aktiv]) {
        if (csatorna.lap === lap) {
          csatorna.nyitva = false
          aktiv.delete(csatorna)
        }
      }
    },
  }
}

type Busz = ReturnType<typeof hamisBusz>

function ujLap(busz: Busz, nev: string, lapLathato = true) {
  const figyelo = jelenletFigyelo({
    lapId: lapAzonosito(nev),
    csatornaGyar: busz.gyar(nev),
    lapLathato,
  })
  return {
    id: lapAzonosito(nev),
    figyelo,
    /** A lap egy admin-útvonalra navigál (a komponens is így képzi a kulcsot). */
    navigal(utvonal: string): void {
      figyelo.kulcsBeallitasa(dokumentumKulcs(utvonal, '/admin'))
      busz.kezbesit()
    },
    /** A lap háttérbe kerül, majd újra látható lesz (a kérdés elmegy). */
    visszater(): void {
      figyelo.lathatosagValtozott(false)
      figyelo.lathatosagValtozott(true)
      busz.kezbesit()
    },
    all: () => figyelo.allapot(),
  }
}

describe('dokumentumKulcs: csak a szerkesztő gyökérnézete számít', () => {
  it('a gyűjtemény-dokumentum és a global szerkesztője kulcsot ad', () => {
    expect(dokumentumKulcs(P1, '/admin')).toBe(K1)
    expect(dokumentumKulcs(`${P1}/`, '/admin')).toBe(K1)
    expect(dokumentumKulcs('/admin/collections/products/5', '/admin')).toBe(
      'collections/products/5',
    )
    expect(dokumentumKulcs('/admin/collections/payload-preferences/19', '/admin')).toBe(
      'collections/payload-preferences/19',
    )
    expect(dokumentumKulcs('/admin/globals/fejlec', '/admin')).toBe('globals/fejlec')
  })

  it('új dokumentum, verziók, API-nézet, kuka, lista, irányítópult és saját nézet: nincs kulcs', () => {
    for (const utvonal of [
      '/admin/collections/pages/create',
      `${P1}/versions`,
      `${P1}/versions/6ab2d1c655cfcd3e03073521`,
      `${P1}/api`,
      `${P1}/preview`,
      '/admin/collections/products/trash',
      '/admin/collections/products/trash/5',
      '/admin/collections/pages',
      '/admin/collections',
      '/admin',
      '/admin/',
      '/admin/kezdolap',
      '/admin/account',
      '/admin/globals/fejlec/versions',
      '/admin/globals/fejlec/api',
      '/admin/globals',
    ]) {
      expect(dokumentumKulcs(utvonal, '/admin'), utvonal).toBeNull()
    }
  })

  it('az admin-útvonal előtagját a configból veszi, és a határán vág', () => {
    expect(dokumentumKulcs('/cms/collections/pages/1', '/cms')).toBe(K1)
    expect(dokumentumKulcs('/cms/collections/pages/1', 'cms/')).toBe(K1)
    expect(dokumentumKulcs(P1, '/cms')).toBeNull()
    expect(dokumentumKulcs('/adminx/collections/pages/1', '/admin')).toBeNull()
    expect(dokumentumKulcs('/collections/pages/1', '/')).toBe(K1)
    expect(dokumentumKulcs('/collections/pages/1/versions', '/')).toBeNull()
    expect(dokumentumKulcs(null, '/admin')).toBeNull()
    expect(dokumentumKulcs(undefined, '/admin')).toBeNull()
  })

  it('furcsa szegmens nem ad kulcsot (a kulcs sosem kerül HTML-be, csak összevetésre)', () => {
    expect(dokumentumKulcs('/admin/collections/pages/<script>', '/admin')).toBeNull()
    expect(dokumentumKulcs('/admin/collections//1', '/admin')).toBeNull()
    expect(dokumentumKulcs('/admin/collections/pages/1%2F2', '/admin')).toBeNull()
  })
})

describe('uzenetErtelmezese: verziózott protokoll, a formátlant eldobja', () => {
  const lap = lapAzonosito('A')
  const cel = lapAzonosito('B')
  const kerdes = '0123456789abcdef0123'

  it('a négy üzenettípust pontosan, idegen mezők nélkül adja vissza', () => {
    expect(uzenetErtelmezese({ v: 1, tipus: 'bejelentes', lap, kulcs: K1, extra: 'x' })).toEqual({
      v: 1,
      tipus: 'bejelentes',
      lap,
      kulcs: K1,
    })
    expect(uzenetErtelmezese({ v: 1, tipus: 'tavozas', lap, kulcs: K1 })).toEqual({
      v: 1,
      tipus: 'tavozas',
      lap,
      kulcs: K1,
    })
    expect(uzenetErtelmezese({ v: 1, tipus: 'kerdes', lap, kulcs: K1, kerdes })).toEqual({
      v: 1,
      tipus: 'kerdes',
      lap,
      kulcs: K1,
      kerdes,
    })
    expect(uzenetErtelmezese({ v: 1, tipus: 'valasz', lap, kulcs: K1, cel, kerdes: null })).toEqual(
      { v: 1, tipus: 'valasz', lap, kulcs: K1, cel, kerdes: null },
    )
    expect(
      uzenetErtelmezese({ v: 1, tipus: 'valasz', lap, kulcs: 'globals/fejlec', cel, kerdes }),
    ).not.toBeNull()
    expect(PROTOKOLL_VERZIO).toBe(1)
  })

  it('formátlan, más verziójú és ismeretlen üzenet: null', () => {
    for (const adat of [
      null,
      undefined,
      'bejelentes',
      42,
      [],
      [{ v: 1, tipus: 'bejelentes', lap, kulcs: K1 }],
      {},
      { v: 2, tipus: 'bejelentes', lap, kulcs: K1 },
      { v: '1', tipus: 'bejelentes', lap, kulcs: K1 },
      { v: 1, tipus: 'ismeretlen', lap, kulcs: K1 },
      { v: 1, tipus: 'bejelentes', lap: 'rovid', kulcs: K1 },
      { v: 1, tipus: 'bejelentes', lap: `${lap}<`, kulcs: K1 },
      { v: 1, tipus: 'bejelentes', lap, kulcs: `${K1}/versions` },
      { v: 1, tipus: 'bejelentes', lap, kulcs: 'collections/pages' },
      { v: 1, tipus: 'bejelentes', lap, kulcs: 7 },
      { v: 1, tipus: 'kerdes', lap, kulcs: K1 },
      { v: 1, tipus: 'kerdes', lap, kulcs: K1, kerdes: 'x' },
      { v: 1, tipus: 'valasz', lap, kulcs: K1, kerdes: null },
      { v: 1, tipus: 'valasz', lap, kulcs: K1, cel, kerdes: 5 },
      { v: 1, tipus: 'valasz', lap, kulcs: K1, cel },
    ]) {
      expect(uzenetErtelmezese(adat), JSON.stringify(adat) ?? String(adat)).toBeNull()
    }
  })

  it('az azonosító crypto.randomUUID, tartalékkal; mindegyik átmegy a protokoll-ellenőrzésen', () => {
    const uuid = ujAzonosito({ randomUUID: () => '123e4567-e89b-42d3-a456-426614174000' })
    expect(uuid).toBe('123e4567-e89b-42d3-a456-426614174000')
    const hex = ujAzonosito({ getRandomValues: (tomb) => tomb.fill(171) })
    expect(hex).toBe('ab'.repeat(16))
    const tartalek = ujAzonosito({})
    expect(tartalek).toMatch(/^[0-9a-f]{32}$/)
    const dobo = ujAzonosito({
      randomUUID: () => {
        throw new Error('nem biztonságos környezet')
      },
    })
    expect(dobo).toMatch(/^[0-9a-f]{32}$/)
    expect(ujAzonosito()).not.toBe(ujAzonosito())
    for (const azonosito of [uuid, hex, tartalek, dobo]) {
      expect(
        uzenetErtelmezese({ v: 1, tipus: 'bejelentes', lap: azonosito, kulcs: K1 }),
      ).not.toBeNull()
    }
  })
})

describe('több példány egy hamis buszon', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('A nyit: nincs figyelmeztetés, és nincs futó időzítő', () => {
    const busz = hamisBusz()
    const a = ujLap(busz, 'A')
    a.navigal(P1)
    expect(a.all()).toEqual({ kulcs: K1, masikLapok: 0, figyelmeztet: false, megjelenit: false })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('B nyit ugyanarra: MINDKÉT lapon figyelmeztet (a régebbi is, mert az is felülírhat)', () => {
    const busz = hamisBusz()
    const a = ujLap(busz, 'A')
    const b = ujLap(busz, 'B')
    a.navigal(P1)
    b.navigal(P1)
    expect(a.all()).toEqual({ kulcs: K1, masikLapok: 1, figyelmeztet: true, megjelenit: true })
    expect(b.all()).toEqual({ kulcs: K1, masikLapok: 1, figyelmeztet: true, megjelenit: true })
    // Várakozás nélkül, időzítő nélkül: a jelzés a bejelentés és a válasz kézbesítésével kész.
    expect(vi.getTimerCount()).toBe(0)
  })

  it('B más dokumentumra navigál: mindkét lapon eltűnik', () => {
    const busz = hamisBusz()
    const a = ujLap(busz, 'A')
    const b = ujLap(busz, 'B')
    a.navigal(P1)
    b.navigal(P1)
    b.navigal(P2)
    expect(a.all().figyelmeztet).toBe(false)
    expect(a.all().masikLapok).toBe(0)
    expect(b.all()).toEqual({
      kulcs: 'collections/pages/2',
      masikLapok: 0,
      figyelmeztet: false,
      megjelenit: false,
    })
    b.navigal(P1)
    expect(a.all().figyelmeztet).toBe(true)
    b.navigal('/admin/collections/posts/1')
    expect(a.all().figyelmeztet).toBe(false)
  })

  it('B a verziók, az API-nézet vagy a lista felé lép: eltűnik; vissza a szerkesztőbe: újra megjelenik', () => {
    const busz = hamisBusz()
    const a = ujLap(busz, 'A')
    const b = ujLap(busz, 'B')
    a.navigal(P1)
    for (const utvonal of [`${P1}/versions`, `${P1}/api`, '/admin/collections/pages', '/admin']) {
      b.navigal(P1)
      expect(a.all().figyelmeztet, utvonal).toBe(true)
      b.navigal(utvonal)
      expect(a.all().figyelmeztet, utvonal).toBe(false)
      expect(b.all(), utvonal).toEqual({
        kulcs: null,
        masikLapok: 0,
        figyelmeztet: false,
        megjelenit: false,
      })
    }
  })

  it('C más dokumentumon, al-nézeten vagy új dokumentumon: senkin nincs figyelmeztetés', () => {
    const busz = hamisBusz()
    const a = ujLap(busz, 'A')
    const c = ujLap(busz, 'C')
    a.navigal(P1)
    for (const utvonal of [
      P2,
      `${P1}/versions`,
      `${P1}/api`,
      '/admin/collections/pages/create',
      '/admin/collections/pages',
      '/admin',
    ]) {
      c.navigal(utvonal)
      expect(a.all().figyelmeztet, utvonal).toBe(false)
      expect(c.all().figyelmeztet, utvonal).toBe(false)
    }
  })

  it('B pagehide: eltűnik; bfcache-ből visszatérve (pageshow) újra megjelenik', () => {
    const busz = hamisBusz()
    const a = ujLap(busz, 'A')
    const b = ujLap(busz, 'B')
    a.navigal(P1)
    b.navigal(P1)
    b.figyelo.felfuggesztes()
    busz.kezbesit()
    expect(a.all().figyelmeztet).toBe(false)
    expect(b.all().figyelmeztet).toBe(false)
    b.figyelo.folytatas()
    busz.kezbesit()
    expect(a.all().figyelmeztet).toBe(true)
    expect(b.all().figyelmeztet).toBe(true)
  })

  it('a visszatérő lap kérdésére csak a válaszolók számítanak (az összeomlott lap kikerül, villogás nélkül)', () => {
    const busz = hamisBusz()
    const a = ujLap(busz, 'A')
    const b = ujLap(busz, 'B')
    const c = ujLap(busz, 'C')
    a.navigal(P1)
    b.navigal(P1)
    c.navigal(P1)
    expect(a.all().masikLapok).toBe(2)
    busz.osszeomlik('C')
    a.visszater()
    // A válaszablak alatt a régi kép marad (nincs eltűnés–megjelenés).
    expect(a.all().masikLapok).toBe(2)
    vi.advanceTimersByTime(VALASZ_ABLAK_MS)
    expect(a.all()).toEqual({ kulcs: K1, masikLapok: 1, figyelmeztet: true, megjelenit: true })
    busz.osszeomlik('B')
    a.visszater()
    vi.advanceTimersByTime(VALASZ_ABLAK_MS)
    expect(a.all()).toEqual({ kulcs: K1, masikLapok: 0, figyelmeztet: false, megjelenit: false })
  })

  it('lefagyott lap (ismert korlát): nem válaszol, ezért kikerül; felébredve a két lap újra látja egymást', () => {
    const busz = hamisBusz()
    const a = ujLap(busz, 'A')
    const b = ujLap(busz, 'B')
    a.navigal(P1)
    b.navigal(P1)
    busz.fagyaszt('B')
    a.visszater()
    vi.advanceTimersByTime(VALASZ_ABLAK_MS)
    expect(a.all().figyelmeztet).toBe(false)
    // Felébredéskor a sorba állt kérdésre válaszol, és maga is kérdez (resume).
    busz.felenged('B')
    b.figyelo.ujraEpites()
    busz.kezbesit()
    vi.advanceTimersByTime(VALASZ_ABLAK_MS)
    expect(a.all()).toEqual({ kulcs: K1, masikLapok: 1, figyelmeztet: true, megjelenit: true })
    expect(b.all()).toEqual({ kulcs: K1, masikLapok: 1, figyelmeztet: true, megjelenit: true })
  })

  it('NINCS időalapú lejárat: 10 perc csend és 2 perc háttér után is mindkét lap figyelmeztet', () => {
    const busz = hamisBusz()
    const a = ujLap(busz, 'A')
    const b = ujLap(busz, 'B')
    a.navigal(P1)
    b.navigal(P1)
    vi.advanceTimersByTime(10 * 60_000)
    // Újraszámolás kérdés nélkül (a lap rejtetté válik): a jelenlét nem fogy el.
    a.figyelo.lathatosagValtozott(false)
    b.figyelo.lathatosagValtozott(false)
    expect(a.all().masikLapok).toBe(1)
    expect(b.all().masikLapok).toBe(1)
    vi.advanceTimersByTime(2 * 60_000)
    b.figyelo.lathatosagValtozott(true)
    busz.kezbesit()
    vi.advanceTimersByTime(VALASZ_ABLAK_MS)
    expect(a.all().figyelmeztet).toBe(true)
    expect(b.all()).toEqual({ kulcs: K1, masikLapok: 1, figyelmeztet: true, megjelenit: true })
  })

  it('az ismételt bejelentés nem duplikál, és a feladó kulcsváltása (elveszett távozás) kivesz', () => {
    const busz = hamisBusz()
    const a = ujLap(busz, 'A')
    const b = ujLap(busz, 'B')
    a.navigal(P1)
    b.navigal(P1)
    const bejelentes = { v: 1, tipus: 'bejelentes', lap: b.id, kulcs: K1 }
    busz.nyersKuldes(bejelentes)
    busz.nyersKuldes(bejelentes)
    busz.kezbesit()
    expect(a.all().masikLapok).toBe(1)
    busz.nyersKuldes({ v: 1, tipus: 'bejelentes', lap: b.id, kulcs: 'collections/pages/2' })
    busz.kezbesit()
    expect(a.all().masikLapok).toBe(0)
    expect(a.all().figyelmeztet).toBe(false)
  })

  it('Bezárás után csak új csatlakozásra jön vissza (kérdés, ismételt bejelentés és idő nem hozza vissza)', () => {
    const busz = hamisBusz()
    const a = ujLap(busz, 'A')
    const b = ujLap(busz, 'B')
    a.navigal(P1)
    b.navigal(P1)
    a.figyelo.bezaras()
    expect(a.all()).toEqual({ kulcs: K1, masikLapok: 1, figyelmeztet: false, megjelenit: false })
    // A bezárás laponkénti: B-n marad.
    expect(b.all().figyelmeztet).toBe(true)
    b.visszater()
    vi.advanceTimersByTime(VALASZ_ABLAK_MS)
    busz.nyersKuldes({ v: 1, tipus: 'bejelentes', lap: b.id, kulcs: K1 })
    busz.kezbesit()
    vi.advanceTimersByTime(10 * 60_000)
    a.visszater()
    vi.advanceTimersByTime(VALASZ_ABLAK_MS)
    expect(a.all().figyelmeztet).toBe(false)
    expect(a.all().masikLapok).toBe(1)
    // Új lap csatlakozik: visszajön.
    const c = ujLap(busz, 'C')
    c.navigal(P1)
    expect(a.all()).toEqual({ kulcs: K1, masikLapok: 2, figyelmeztet: true, megjelenit: true })
    a.figyelo.bezaras()
    expect(a.all().figyelmeztet).toBe(false)
    // Egy távozott lap visszatérése is új helyzet.
    b.navigal(P2)
    expect(a.all().figyelmeztet).toBe(false)
    b.navigal(P1)
    expect(a.all().figyelmeztet).toBe(true)
  })

  it('rejtett lapon keletkezett figyelmeztetés a láthatóvá váláskor jelenik meg, utána rejtéskor sem tűnik el', () => {
    const busz = hamisBusz()
    const a = ujLap(busz, 'A', false)
    const b = ujLap(busz, 'B')
    a.navigal(P1)
    b.navigal(P1)
    expect(a.all()).toEqual({ kulcs: K1, masikLapok: 1, figyelmeztet: true, megjelenit: false })
    a.figyelo.lathatosagValtozott(true)
    expect(a.all().megjelenit).toBe(true)
    a.figyelo.lathatosagValtozott(false)
    expect(a.all().megjelenit).toBe(true)
  })

  it('formátlan, idegen verziójú vagy saját üzenet nem változtat, és nem dob', () => {
    const busz = hamisBusz()
    const a = ujLap(busz, 'A')
    a.navigal(P1)
    const ertesitesek = vi.fn()
    a.figyelo.feliratkozas(ertesitesek)
    for (const adat of [
      null,
      'x',
      { v: 2, tipus: 'bejelentes', lap: lapAzonosito('X'), kulcs: K1 },
      { v: 1, tipus: 'ismeretlen', lap: lapAzonosito('X'), kulcs: K1 },
      { v: 1, tipus: 'bejelentes', lap: lapAzonosito('X'), kulcs: `${K1}/versions` },
      { v: 1, tipus: 'bejelentes', lap: a.id, kulcs: K1 },
      {
        v: 1,
        tipus: 'valasz',
        lap: lapAzonosito('X'),
        kulcs: K1,
        cel: lapAzonosito('Y'),
        kerdes: null,
      },
    ]) {
      busz.nyersKuldes(adat)
    }
    expect(() => busz.kezbesit()).not.toThrow()
    expect(a.all().masikLapok).toBe(0)
    expect(ertesitesek).not.toHaveBeenCalled()
  })

  it('BroadcastChannel nélkül csendben nem csinál semmit', () => {
    const figyelo = jelenletFigyelo({ lapId: lapAzonosito('A'), csatornaGyar: () => null })
    expect(() => {
      figyelo.kulcsBeallitasa(K1)
      figyelo.lathatosagValtozott(false)
      figyelo.lathatosagValtozott(true)
      figyelo.ujraEpites()
      figyelo.felfuggesztes()
      figyelo.folytatas()
      figyelo.bezaras()
      figyelo.megszuntetes()
    }).not.toThrow()
    expect(figyelo.allapot().figyelmeztet).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a böngésző-gyár: ha nincs BroadcastChannel, vagy nem hozható létre, null; egyébként a csatornán üzen', () => {
    vi.stubGlobal('BroadcastChannel', undefined)
    expect(bongeszoCsatornaGyar(CSATORNA_NEV, () => undefined)).toBeNull()
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        constructor() {
          throw new Error('SecurityError')
        }
      },
    )
    expect(bongeszoCsatornaGyar(CSATORNA_NEV, () => undefined)).toBeNull()
    const kuldott: unknown[] = []
    let lezarva = false
    const peldanyok: { onmessage: ((esemeny: { data: unknown }) => void) | null }[] = []
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        onmessage: ((esemeny: { data: unknown }) => void) | null = null
        constructor(public nev: string) {
          expect(nev).toBe(CSATORNA_NEV)
          peldanyok.push(this)
        }
        postMessage(adat: unknown) {
          if (lezarva) {
            throw new Error('InvalidStateError')
          }
          kuldott.push(adat)
        }
        close() {
          lezarva = true
        }
      },
    )
    const fogadott: unknown[] = []
    const csatorna = bongeszoCsatornaGyar(CSATORNA_NEV, (adat) => fogadott.push(adat))
    expect(csatorna).not.toBeNull()
    const uzenet: Uzenet = { v: 1, tipus: 'bejelentes', lap: lapAzonosito('A'), kulcs: K1 }
    csatorna?.kuld(uzenet)
    expect(kuldott).toEqual([uzenet])
    expect(peldanyok).toHaveLength(1)
    peldanyok[0]?.onmessage?.({ data: 'bejövő' })
    expect(fogadott).toEqual(['bejövő'])
    csatorna?.lezar()
    expect(lezarva).toBe(true)
    expect(() => csatorna?.kuld(uzenet)).not.toThrow()
  })
})

describe('eletciklusBekotese: láthatóság, resume, pagehide, pageshow', () => {
  it('a Page Lifecycle eseményeit a figyelő megfelelő lépésére köti, és le is választja', () => {
    const ablak = new EventTarget()
    const dokumentum = new EventTarget()
    let lathatosag: DocumentVisibilityState = 'visible'
    const figyeltAblak: FigyeltAblak = {
      addEventListener: (tipus, kezelo) => ablak.addEventListener(tipus, kezelo),
      removeEventListener: (tipus, kezelo) => ablak.removeEventListener(tipus, kezelo),
      document: {
        get visibilityState() {
          return lathatosag
        },
        addEventListener: (tipus, kezelo) => dokumentum.addEventListener(tipus, kezelo),
        removeEventListener: (tipus, kezelo) => dokumentum.removeEventListener(tipus, kezelo),
      },
    }
    const figyelo = {
      lathatosagValtozott: vi.fn(),
      ujraEpites: vi.fn(),
      felfuggesztes: vi.fn(),
      folytatas: vi.fn(),
    }
    const levalaszt = eletciklusBekotese(figyelo as unknown as JelenletFigyelo, figyeltAblak)
    lathatosag = 'hidden'
    dokumentum.dispatchEvent(new Event('visibilitychange'))
    lathatosag = 'visible'
    dokumentum.dispatchEvent(new Event('visibilitychange'))
    expect(figyelo.lathatosagValtozott.mock.calls).toEqual([[false], [true]])
    dokumentum.dispatchEvent(new Event('resume'))
    expect(figyelo.ujraEpites).toHaveBeenCalledTimes(1)
    ablak.dispatchEvent(new Event('pagehide'))
    expect(figyelo.felfuggesztes).toHaveBeenCalledTimes(1)
    const nemBfcache = Object.assign(new Event('pageshow'), { persisted: false })
    ablak.dispatchEvent(nemBfcache)
    expect(figyelo.folytatas).not.toHaveBeenCalled()
    const bfcache = Object.assign(new Event('pageshow'), { persisted: true })
    ablak.dispatchEvent(bfcache)
    expect(figyelo.folytatas).toHaveBeenCalledTimes(1)
    levalaszt()
    dokumentum.dispatchEvent(new Event('resume'))
    ablak.dispatchEvent(new Event('pagehide'))
    expect(figyelo.ujraEpites).toHaveBeenCalledTimes(1)
    expect(figyelo.felfuggesztes).toHaveBeenCalledTimes(1)
  })
})

describe('a komponens', () => {
  const gyokerek: Root[] = []

  afterEach(async () => {
    await act(async () => {
      for (const gyoker of gyokerek.splice(0)) {
        gyoker.unmount()
      }
    })
    document.body.replaceChildren()
    document.documentElement.removeAttribute(SAV_ATTR)
    document.documentElement.style.removeProperty(SAV_VALTOZO)
  })

  function lapElem(utvonal: string, tartalom: ReactNode) {
    return createElement(UtvonalKontextus.Provider, { value: utvonal }, tartalom)
  }

  async function renderel(
    utvonal: string,
    tartalom: ReactNode,
  ): Promise<{ tarto: HTMLDivElement; gyoker: Root }> {
    const tarto = document.createElement('div')
    document.body.append(tarto)
    const gyoker = createRoot(tarto)
    gyokerek.push(gyoker)
    await act(async () => {
      gyoker.render(lapElem(utvonal, tartalom))
    })
    return { tarto, gyoker }
  }

  async function kezbesit(busz: Busz) {
    await act(async () => {
      busz.kezbesit()
    })
  }

  const doboz = (tarto: Element) => tarto.querySelector('.kc-ket-lap-figyelo')
  const regio = (tarto: Element) => tarto.querySelector('.kc-ket-lap-figyelo [role="status"]')
  const gomb = (tarto: Element) =>
    tarto.querySelector<HTMLButtonElement>('.kc-ket-lap-figyelo__bezaras')

  it('két lap ugyanazon a dokumentumon: MINDKETTŐN megjelenik a cím és a szöveg, a fókusz marad', async () => {
    const busz = hamisBusz()
    const mezo = document.createElement('input')
    document.body.append(mezo)
    mezo.focus()
    const a = await renderel(
      P1,
      createElement(KetLapFigyelo, {
        bezarasFelirat: BEZARAS_FELIRAT,
        csatornaGyar: busz.gyar('A'),
      }),
    )
    await kezbesit(busz)
    // Az élő régió már üresen a helyén van, mielőtt a szöveg érkezik (SC 4.1.3).
    expect(regio(a.tarto)?.getAttribute('aria-atomic')).toBe('true')
    expect(regio(a.tarto)?.textContent).toBe('')
    expect(doboz(a.tarto)?.className).toContain('kc-ket-lap-figyelo--rejtett')
    expect(gomb(a.tarto)).toBeNull()
    const b = await renderel(
      P1,
      createElement(KetLapFigyelo, {
        bezarasFelirat: BEZARAS_FELIRAT,
        csatornaGyar: busz.gyar('B'),
      }),
    )
    await kezbesit(busz)
    for (const lap of [a, b]) {
      expect(regio(lap.tarto)?.textContent).toBe(`${KET_LAP_CIM}${KET_LAP_SZOVEG}`)
      expect(doboz(lap.tarto)?.className).toContain('kc-admin-notice--figyelem')
      expect(gomb(lap.tarto)?.textContent).toBe(BEZARAS_FELIRAT)
      // A gomb a régión kívül áll: nem olvasódik fel a szöveggel.
      expect(regio(lap.tarto)?.contains(gomb(lap.tarto) ?? null)).toBe(false)
    }
    expect(document.activeElement).toBe(mezo)
    expect(document.documentElement.hasAttribute(SAV_ATTR)).toBe(true)
    expect(document.documentElement.style.getPropertyValue(SAV_VALTOZO)).toMatch(/^\d+px$/)
    expect(
      a.tarto.querySelector('.kc-ket-lap-figyelo__tartalek')?.getAttribute('aria-hidden'),
    ).toBe('true')
  })

  it('B más dokumentumra, majd al-nézetre navigál: mindkettőn eltűnik; B lebontása (lap bezárása) után is', async () => {
    const busz = hamisBusz()
    const aElem = (utvonal: string) =>
      lapElem(
        utvonal,
        createElement(KetLapFigyelo, {
          bezarasFelirat: BEZARAS_FELIRAT,
          csatornaGyar: busz.gyar('A'),
        }),
      )
    const bElem = (utvonal: string) =>
      lapElem(
        utvonal,
        createElement(KetLapFigyelo, {
          bezarasFelirat: BEZARAS_FELIRAT,
          csatornaGyar: busz.gyar('B'),
        }),
      )
    const a = await renderel(P1, null)
    await act(async () => a.gyoker.render(aElem(P1)))
    const b = await renderel(P1, null)
    await act(async () => b.gyoker.render(bElem(P1)))
    await kezbesit(busz)
    expect(gomb(a.tarto)).not.toBeNull()
    await act(async () => b.gyoker.render(bElem(P2)))
    await kezbesit(busz)
    expect(gomb(a.tarto)).toBeNull()
    expect(gomb(b.tarto)).toBeNull()
    expect(regio(a.tarto)?.textContent).toBe('')
    await act(async () => b.gyoker.render(bElem(P1)))
    await kezbesit(busz)
    expect(gomb(a.tarto)).not.toBeNull()
    await act(async () => b.gyoker.render(bElem(`${P1}/versions`)))
    await kezbesit(busz)
    expect(gomb(a.tarto)).toBeNull()
    await act(async () => b.gyoker.render(bElem(P1)))
    await kezbesit(busz)
    expect(gomb(a.tarto)).not.toBeNull()
    await act(async () => {
      b.gyoker.unmount()
    })
    gyokerek.splice(gyokerek.indexOf(b.gyoker), 1)
    await kezbesit(busz)
    expect(gomb(a.tarto)).toBeNull()
    expect(document.documentElement.hasAttribute(SAV_ATTR)).toBe(false)
  })

  it('Bezárás: billentyűvel elérhető gomb, a doboz eltűnik, és a fókusz oda tér vissza, ahonnan jött', async () => {
    const busz = hamisBusz()
    const mezo = document.createElement('input')
    document.body.append(mezo)
    const a = await renderel(
      P1,
      createElement(KetLapFigyelo, {
        bezarasFelirat: BEZARAS_FELIRAT,
        csatornaGyar: busz.gyar('A'),
      }),
    )
    const b = await renderel(
      P1,
      createElement(KetLapFigyelo, {
        bezarasFelirat: BEZARAS_FELIRAT,
        csatornaGyar: busz.gyar('B'),
      }),
    )
    await kezbesit(busz)
    const bezaro = gomb(a.tarto)
    expect(bezaro?.getAttribute('type')).toBe('button')
    mezo.focus()
    await act(async () => {
      bezaro?.dispatchEvent(new FocusEvent('focusin', { bubbles: true, relatedTarget: mezo }))
      bezaro?.focus()
    })
    await act(async () => {
      bezaro?.click()
    })
    expect(gomb(a.tarto)).toBeNull()
    expect(regio(a.tarto)?.textContent).toBe('')
    expect(document.activeElement).toBe(mezo)
    // B-n megmarad: a bezárás laponkénti.
    expect(gomb(b.tarto)).not.toBeNull()
    // Új lap csatlakozik: A-n visszajön.
    await renderel(
      P1,
      createElement(KetLapFigyelo, {
        bezarasFelirat: BEZARAS_FELIRAT,
        csatornaGyar: busz.gyar('C'),
      }),
    )
    await kezbesit(busz)
    expect(gomb(a.tarto)).not.toBeNull()
  })

  it('React StrictMode (fejlesztői kettős futtatás): a többi lap nem kap távozás–bejelentés párt', async () => {
    const busz = hamisBusz()
    await renderel(
      P1,
      createElement(KetLapFigyelo, {
        bezarasFelirat: BEZARAS_FELIRAT,
        csatornaGyar: busz.gyar('A'),
      }),
    )
    await renderel(
      P1,
      createElement(
        StrictMode,
        null,
        createElement(KetLapFigyelo, {
          bezarasFelirat: BEZARAS_FELIRAT,
          csatornaGyar: busz.gyar('B'),
        }),
      ),
    )
    await kezbesit(busz)
    const bTipusai = busz.naplo
      .filter((sor) => sor.felado === 'B')
      .map((sor) => (sor.adat as { tipus: string }).tipus)
    expect(bTipusai.filter((tipus) => tipus === 'bejelentes')).toHaveLength(1)
    expect(bTipusai).not.toContain('tavozas')
  })

  it('a SzekcioMegnyito providerből renderelve (valódi BroadcastChannel-úton): mindkét lapon, a nyitó régiója után', async () => {
    const busz = hamisBusz()
    let sorszam = 0
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        onmessage: ((esemeny: { data: unknown }) => void) | null = null
        private csatorna: Csatorna | null
        constructor(nev: string) {
          sorszam += 1
          this.csatorna = busz.gyar(`bc-${String(sorszam)}`)(nev, (adat) =>
            this.onmessage?.({ data: adat }),
          )
        }
        postMessage(adat: unknown) {
          this.csatorna?.kuld(adat as Uzenet)
        }
        close() {
          this.csatorna?.lezar()
          this.csatorna = null
        }
      },
    )
    kornyezet.search = ''
    const a = await renderel(
      P1,
      createElement(SzekcioMegnyito, null, createElement('p', null, 'admin')),
    )
    const b = await renderel(
      P1,
      createElement(SzekcioMegnyito, null, createElement('p', null, 'admin')),
    )
    await kezbesit(busz)
    for (const lap of [a, b]) {
      expect(regio(lap.tarto)?.textContent).toBe(`${KET_LAP_CIM}${KET_LAP_SZOVEG}`)
      expect(gomb(lap.tarto)?.textContent).toBe(BEZARAS_FELIRAT)
      // A nyitó élő régiója az első a lapon; a figyelmeztetés utána áll.
      const regiok = [...lap.tarto.querySelectorAll('[role="status"]')]
      expect(regiok[0]?.closest('.kc-szekcio-megnyito')).not.toBeNull()
      expect(regiok[1]?.closest('.kc-ket-lap-figyelo')).not.toBeNull()
    }
  })
})

describe('szöveg és határok (forrás-őr)', () => {
  const modulForras = readFileSync(
    path.resolve(process.cwd(), 'src/components/editor/admin/ket-lap-figyelo.ts'),
    'utf8',
  )
  const komponensForras = readFileSync(
    path.resolve(process.cwd(), 'src/components/editor/admin/KetLapFigyelo.tsx'),
    'utf8',
  )

  it('a cím és a szöveg: „Figyelem:” előtag, tegező teendő, gondolatjel nélkül', () => {
    expect(KET_LAP_CIM.startsWith('Figyelem: ')).toBe(true)
    for (const szoveg of [KET_LAP_CIM, KET_LAP_SZOVEG]) {
      expect(szoveg).not.toMatch(/[–—]| - /)
      expect(szoveg).not.toMatch(/(?<!\p{L})(Ön|Önök|kérjük|sajnos|biztos)(?!\p{L})/iu)
    }
    expect(KET_LAP_SZOVEG).toContain('felülírja')
    expect(KET_LAP_SZOVEG).toContain('Zárd be')
    expect(KET_LAP_SZOVEG).toContain('töltsd újra')
  })

  it('nincs window.opener, hálózati kérés, tárolóírás vagy HTML-beszúrás', () => {
    for (const forras of [modulForras, komponensForras]) {
      const kod = forras.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
      expect(kod).not.toMatch(/\bopener\b/)
      expect(kod).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|EventSource|WebSocket/)
      expect(kod).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/)
      expect(kod).not.toMatch(/innerHTML|dangerouslySetInnerHTML|insertAdjacentHTML/)
    }
  })

  it('a tiszta modul React és Payload nélküli; a komponens csak a publikus @payloadcms/ui-t használja', () => {
    expect(modulForras).not.toMatch(/from '(react|next|@payloadcms)/)
    const payloadImportok = [...komponensForras.matchAll(/from '(@payloadcms\/[^']+)'/g)].map(
      (talalat) => talalat[1],
    )
    expect(payloadImportok).toEqual(['@payloadcms/ui'])
  })
})
