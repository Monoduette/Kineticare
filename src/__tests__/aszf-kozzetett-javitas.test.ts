/**
 * H11: a tartalom-job ÁSZF-javítása a KÖZZÉTETT változaton dolgozik, és
 * publikálatlan piszkozat mellett NEM ír.
 *
 * Mérve valódi Payload 3.88 + PostgreSQL mellett (2026-09-24): a
 * `draft: true` lekérdezés a legutóbbi (akár félkész admin-) piszkozatot
 * adja, a draft nélküli `payload.update` pedig a hiányzó mezőket (cím,
 * `_status`) a legutóbbi verzióból tölti ki. Publikálatlan piszkozat mellett
 * a régi kód a piszkozat címét és piszkozat-állapotát írta a fő rekordba, és
 * az /aszf 404-re váltott. Ezek a tesztek a javítás szerződését rögzítik egy
 * Payload-csonkon: mit olvas, mikor ír, mikor hibázik.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { JOGI_OLDALAK, jogiOldalTartalom, richTextSzoveg } from '../lib/legal-content'
import { logger } from '../lib/logger'
import {
  ASZF_AFA_REGI_KEZDET,
  ASZF_AFA_UJ_KEZDET,
  alkalmazAszfBekezdesCserek,
  elteroVegek,
  javitsdAKozzetettAszfet,
  type AszfJavitoPayload,
} from '../scripts/apply-owner-content'
import { para, richText } from '../scripts/restore-legacy-content'

const ASZF_LEIRAS = JOGI_OLDALAK.find((oldal) => oldal.slug === 'aszf')
if (ASZF_LEIRAS === undefined) {
  throw new Error('TESZT: nincs ÁSZF a JOGI_OLDALAK-ban')
}

/** A mai élő ÁSZF: minden korábbi javítás lefutott, csak az áfa-mondat a régi (27%). */
const eloAszf = (): unknown =>
  JSON.parse(
    JSON.stringify(jogiOldalTartalom(ASZF_LEIRAS)).replace(
      JSON.stringify(ASZF_AFA_UJ_KEZDET).slice(1, -1),
      JSON.stringify(ASZF_AFA_REGI_KEZDET).slice(1, -1),
    ),
  )

/** A már javított ÁSZF (AAM-mondattal). */
const javitottAszf = (): unknown => jogiOldalTartalom(ASZF_LEIRAS)

interface Dokumentum {
  id: number
  slug: string
  title: string
  content: unknown
  _status: 'draft' | 'published' | null
  updatedAt: string
}

const PUBLIKALT_IDO = '2026-09-20T10:00:00.000Z'
const PISZKOZAT_IDO = '2026-09-24T09:30:00.000Z'

function publikalt(content: unknown, allapot: Dokumentum['_status'] = 'published'): Dokumentum {
  return {
    id: 11,
    slug: 'aszf',
    title: 'Általános szerződési feltételek',
    content,
    _status: allapot,
    updatedAt: PUBLIKALT_IDO,
  }
}

function piszkozat(content: unknown): Dokumentum {
  return {
    id: 11,
    slug: 'aszf',
    title: 'ÁSZF (átírás alatt)',
    content,
    _status: 'draft',
    updatedAt: PISZKOZAT_IDO,
  }
}

function csonk(opciok: { fo: Dokumentum | null; legutobbi: Dokumentum | Error }) {
  type Hivas = (args: Record<string, unknown>) => Promise<unknown>
  const find = vi.fn<Hivas>(async () => ({
    docs: opciok.fo === null ? [] : [opciok.fo],
  }))
  const findByID = vi.fn<Hivas>(async () => {
    if (opciok.legutobbi instanceof Error) {
      throw opciok.legutobbi
    }
    return opciok.legutobbi
  })
  const update = vi.fn<Hivas>(async () => ({}))
  return {
    payload: { find, findByID, update } as unknown as AszfJavitoPayload,
    find,
    findByID,
    update,
  }
}

const hibaUzenetek = (kem: { mock: { calls: unknown[][] } }): string[] =>
  kem.mock.calls.map((hivas) => String(hivas[0]))

afterEach(() => {
  vi.restoreAllMocks()
})

describe('javitsdAKozzetettAszfet — publikálatlan piszkozat mellett nem ír', () => {
  it.each([
    ['éles futás', false, 'KIMARADT'],
    ['próbafutás', true, 'KIMARADNA'],
  ])(
    '%s: a frissebb piszkozat miatt nincs írás, hiba = true, és a napló megmondja a teendőt',
    async (_nev, dryRun, szo) => {
      const hibaKem = vi.spyOn(logger, 'error').mockImplementation(() => {})
      const infoKem = vi.spyOn(logger, 'info').mockImplementation(() => {})
      vi.spyOn(logger, 'warn').mockImplementation(() => {})
      const { payload, update } = csonk({
        fo: publikalt(eloAszf()),
        legutobbi: piszkozat(eloAszf()),
      })

      const eredmeny = await javitsdAKozzetettAszfet(payload, dryRun)

      expect(update).not.toHaveBeenCalled()
      expect(eredmeny.hiba).toBe(true)
      expect(eredmeny.irt).toBe(false)
      const uzenetek = hibaUzenetek(hibaKem)
      expect(uzenetek).toHaveLength(1)
      expect(uzenetek[0]).toContain('közzé nem tett')
      expect(uzenetek[0]).toContain(szo)
      expect(uzenetek[0]).toContain('Verziók')
      // A kimaradt írás a naplóban sem „MÓDOSÍTVA”, és az összesítőbe sem
      // számít bele (próbafutásban a „MÓDOSÍTANÁ” sor és a számlálás marad).
      const infok = hibaUzenetek(infoKem)
      expect(infok.some((sor) => sor.includes('MÓDOSÍTVA'))).toBe(false)
      expect(infok.some((sor) => sor.includes('MÓDOSÍTANÁ: Az ÁSZF áfa-mondata'))).toBe(true)
      expect(eredmeny.modositasok).toBe(dryRun ? 1 : 0)
    },
  )

  it('a nem közzétett (piszkozat-állapotú) fő rekordra sem ír', async () => {
    vi.spyOn(logger, 'info').mockImplementation(() => {})
    const hibaKem = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const fo = publikalt(eloAszf(), 'draft')
    const { payload, update } = csonk({ fo, legutobbi: fo })

    const eredmeny = await javitsdAKozzetettAszfet(payload, false)

    expect(update).not.toHaveBeenCalled()
    expect(eredmeny.hiba).toBe(true)
    expect(hibaUzenetek(hibaKem)[0]).toContain('nincs közzétéve')
  })

  it('ha a legutóbbi verzió nem olvasható, nem ír, és hibával zár', async () => {
    vi.spyOn(logger, 'info').mockImplementation(() => {})
    vi.spyOn(logger, 'error').mockImplementation(() => {})
    const { payload, update } = csonk({
      fo: publikalt(eloAszf()),
      legutobbi: new Error('connection terminated'),
    })

    const eredmeny = await javitsdAKozzetettAszfet(payload, false)

    expect(update).not.toHaveBeenCalled()
    expect(eredmeny.hiba).toBe(true)
  })
})

describe('javitsdAKozzetettAszfet — a lánc a KÖZZÉTETT tartalomból épül', () => {
  it('piszkozat nélkül ír: a közzétett szöveg javítva, közzétett állapotban, draft nélküli lekérdezésből', async () => {
    vi.spyOn(logger, 'info').mockImplementation(() => {})
    const hibaKem = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const fo = publikalt(eloAszf())
    const { payload, find, update } = csonk({ fo, legutobbi: fo })

    const eredmeny = await javitsdAKozzetettAszfet(payload, false)

    // A tartalom a fő rekordból jön: a lekérdezés NEM `draft: true`.
    expect(find).toHaveBeenCalledTimes(1)
    expect(find.mock.calls[0]?.[0]).not.toHaveProperty('draft', true)
    expect(find.mock.calls[0]?.[0]).toMatchObject({
      collection: 'pages',
      where: { slug: { equals: 'aszf' } },
    })

    expect(update).toHaveBeenCalledTimes(1)
    const irasArgs = update.mock.calls[0]?.[0] as {
      id: number
      draft: boolean
      data: { content: unknown; _status: string }
    }
    expect(irasArgs.id).toBe(11)
    expect(irasArgs.draft).toBe(false)
    expect(irasArgs.data._status).toBe('published')
    const szoveg = richTextSzoveg(irasArgs.data.content)
    expect(szoveg).toContain('alanyi adómentes')
    expect(szoveg).not.toContain('27%')
    expect(eredmeny).toMatchObject({ hiba: false, irt: true })
    expect(eredmeny.modositasok).toBe(1)
    expect(hibaUzenetek(hibaKem)).toEqual([])
  })

  it('a már javított közzétett ÁSZF mellé frissebb, régi szövegű piszkozat: nem ír, de FIGYELMEZTET', async () => {
    // A korábbi kód a piszkozat dátumát önmagával vetette össze, így ez a
    // figyelmeztetés sosem szólt.
    vi.spyOn(logger, 'info').mockImplementation(() => {})
    const figyelmeztetes = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const { payload, update } = csonk({
      fo: publikalt(javitottAszf()),
      legutobbi: piszkozat(eloAszf()),
    })

    const eredmeny = await javitsdAKozzetettAszfet(payload, false)

    expect(update).not.toHaveBeenCalled()
    expect(eredmeny.hiba).toBe(false)
    const frissebb = hibaUzenetek(figyelmeztetes).filter((uzenet) => uzenet.includes('FRISSEBB'))
    expect(frissebb).toHaveLength(1)
    expect(frissebb[0]).toContain('ÁSZF')
  })

  it('a próbafutás naplósora a VÁLTOZÓ részt mutatja: „27%-os áfatartalommal” → „alanyi adómentes”', async () => {
    const infoKem = vi.spyOn(logger, 'info').mockImplementation(() => {})
    vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const fo = publikalt(eloAszf())
    const { payload, update } = csonk({ fo, legutobbi: fo })

    await javitsdAKozzetettAszfet(payload, true)

    expect(update).not.toHaveBeenCalled()
    const sor = hibaUzenetek(infoKem).find((uzenet) => uzenet.includes('Az ÁSZF áfa-mondata'))
    expect(sor).toBeDefined()
    expect(sor).toContain('27%-os áfatartalommal')
    expect(sor).toContain('alanyi adómentes')
    expect(sor).toContain('a fizetendő végösszeg')
  })
})

describe('az áfa-csere naplósorai', () => {
  it('a módosítás-sor a régi és az új szöveg eltérő végét idézi, a közös elejét nem', () => {
    const eredmeny = alkalmazAszfBekezdesCserek(richText([para(`${ASZF_AFA_REGI_KEZDET} `)]))
    const sor = eredmeny.modositasok.find((lepes) => lepes.szabaly === 'aszf-afa-aam')?.uzenet
    expect(sor).toBeDefined()
    expect(sor).toContain(
      '„…A Vásárló elfogadja, hogy a számlát/nyugtát a KINETICARE Kft állítja ki 27%-os áfatartalommal.”',
    )
    expect(sor).toContain('alanyi adómentes, ezért a számla áfát nem tartalmaz')
    expect(sor).not.toContain('link formájában')
  })

  it('elteroVegek: mondathatárig lép vissza; közös elő nélkül a teljes szöveget adja', () => {
    expect(elteroVegek('Első mondat. Régi vége.', 'Első mondat. Új vége.')).toEqual({
      regi: '…Régi vége.',
      uj: '…Új vége.',
    })
    expect(elteroVegek('Egy szó régi', 'Egy szó új')).toEqual({ regi: '…régi', uj: '…új' })
    expect(elteroVegek('abc', 'xyz')).toEqual({ regi: 'abc', uj: 'xyz' })
  })

  it('az átírt, de a bekezdés-elejével kezdődő bekezdést a hangos kihagyás idézi (a nyom a bekezdés eleje)', () => {
    // A szerkesztő a Számlázz.hu említését kivette: a korábbi, mondatközi nyom
    // („a Számlázz.hu rendszerén keresztül”) ezt nem találta, és azt írta, hogy
    // ilyen bekezdés nincs is a lapon.
    const atirt = 'A fizetést követően a Vásárló a számlát e-mailben kapja meg. Az ár egyösszegű.'
    const eredmeny = alkalmazAszfBekezdesCserek(richText([para(atirt)]))
    const afa = eredmeny.kihagyasok.find((lepes) => lepes.szabaly === 'aszf-afa-aam')
    expect(afa?.hangos).toBe(true)
    expect(afa?.indok).toContain('a helyén ez áll')
    expect(afa?.indok).toContain('Az ár egyösszegű.')
  })
})
