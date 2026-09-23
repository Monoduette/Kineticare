import type { FieldHook } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import { courseSlugField } from '../fields/course-slug'
import { courseHref } from '../lib/course-url'
import { courseTitle } from '../lib/courses'
import {
  kitoltKurzusCimeket,
  kurzusCimSorsa,
  type KurzusCimKitoltes,
  type KurzusCimModositas,
} from '../scripts/kurzus-cim-kitoltes'

/**
 * A „Kurzus címe” kitöltő szabálya (modul-térkép H25, terv A12).
 *
 * - Csak az üres címet tölti, a trimmelt azonosítóval; kitöltött címhez nem
 *   nyúl; a bemenetet nem módosítja; a második futás MAR.
 * - A látvány nem változik: a `courseTitle` az élő három kurzusra (a
 *   live-products.json 2026-09-23-i mezői) előtte és utána azonos.
 * - A webcím nem változik: a VALÓDI slug-hook (src/fields/course-slug.ts)
 *   közzétett és piszkozat állapotban is a régi slugot adja, lekérdezés
 *   nélkül (a hangosan dobó `find` mock ezt bizonyítja).
 */

/** Az élő kurzusok (https://kineticare.hu/api/products, 2026-09-23) a szabályhoz kellő mezőkkel. */
const ELO_KURZUSOK = [
  {
    id: 4,
    sku: 'Akciós Otthoni KézRehab Program',
    displayTitle: 'Akciós Otthoni KézRehab Program',
    slug: 'otthoni-kezrehab-program-akcio',
    status: 'published',
    _status: 'published',
    updatedAt: '2026-09-21T12:49:57.539Z',
  },
  {
    id: 2,
    sku: 'SOS Kézrelax villámkurzus',
    displayTitle: null,
    slug: 'sos-kezrelax-villamkurzus',
    status: 'published',
    _status: 'published',
    updatedAt: '2026-09-07T15:51:37.701Z',
  },
  {
    id: 1,
    sku: 'Otthoni KézRehab Program',
    displayTitle: null,
    slug: 'otthoni-kezrehab-program',
    status: 'published',
    _status: 'published',
    updatedAt: '2026-09-19T23:52:48.899Z',
  },
] as const

/** Mélyen fagyasztott másolat: ha a szabály a bemenetbe írna, a teszt dob. */
function fagyaszt<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const ertek of Object.values(value)) fagyaszt(ertek)
    Object.freeze(value)
  }
  return value
}

function masol<T>(value: T): T {
  return structuredClone(value)
}

type Termek = Record<string, unknown> & { id: number | string }

/** A módosítások alkalmazása (a hívó `payload.update`-jének tiszta megfelelője). */
function alkalmaz(termekek: readonly Termek[], eredmeny: KurzusCimKitoltes): Termek[] {
  const szerint = new Map<string, KurzusCimModositas>(
    (eredmeny.modositasok ?? []).map((modositas) => [String(modositas.id), modositas]),
  )
  return termekek.map((termek) => {
    const modositas = szerint.get(String(termek.id))
    return modositas ? { ...termek, ...modositas.data } : termek
  })
}

describe('kitoltKurzusCimeket: az élő három kurzus', () => {
  it('kettőt kitölt, a már kitöltöttet MAR-nak veszi', () => {
    const eredmeny = kitoltKurzusCimeket(fagyaszt(masol(ELO_KURZUSOK)))
    expect(eredmeny.allapot).toBe('KITOLTVE')
    expect(eredmeny.modositasok).toEqual([
      {
        id: 2,
        updatedAt: '2026-09-07T15:51:37.701Z',
        data: { displayTitle: 'SOS Kézrelax villámkurzus', slug: 'sos-kezrelax-villamkurzus' },
      },
      {
        id: 1,
        updatedAt: '2026-09-19T23:52:48.899Z',
        data: { displayTitle: 'Otthoni KézRehab Program', slug: 'otthoni-kezrehab-program' },
      },
    ])
    expect(eredmeny.naplo.map((sor) => [sor.id, sor.allapot])).toEqual([
      [4, 'MAR'],
      [2, 'KITOLTVE'],
      [1, 'KITOLTVE'],
    ])
    expect(eredmeny.naplo[1]?.uzenet).toBe(
      'Kurzus #2 („SOS Kézrelax villámkurzus”): az üres Kurzus címébe a belső azonosító került: „SOS Kézrelax villámkurzus”. A lapon látszó név és a webcím nem változik.',
    )
  })

  it('a bemenetet nem módosítja (mélyen fagyasztva is lefut), és ugyanazt adja újra', () => {
    const bemenet = fagyaszt(masol(ELO_KURZUSOK))
    const elotte = JSON.stringify(bemenet)
    const elso = kitoltKurzusCimeket(bemenet)
    expect(JSON.stringify(bemenet)).toBe(elotte)
    expect(kitoltKurzusCimeket(bemenet)).toEqual(elso)
  })

  it('a második futás MAR, és nincs mit írni', () => {
    const elso = kitoltKurzusCimeket(masol(ELO_KURZUSOK))
    const utana = alkalmaz(masol(ELO_KURZUSOK) as unknown as Termek[], elso)
    const masodik = kitoltKurzusCimeket(utana)
    expect(masodik.allapot).toBe('MAR')
    expect(masodik.modositasok).toBeNull()
    expect(masodik.naplo.map((sor) => sor.allapot)).toEqual(['MAR', 'MAR', 'MAR'])
  })

  it('a courseTitle és a kurzus linkje előtte és utána azonos', () => {
    const elotte = masol(ELO_KURZUSOK) as unknown as Termek[]
    const utana = alkalmaz(elotte, kitoltKurzusCimeket(elotte))
    const nev = (termek: Termek) =>
      courseTitle(termek as unknown as Parameters<typeof courseTitle>[0])
    const link = (termek: Termek) =>
      courseHref(termek as unknown as Parameters<typeof courseHref>[0])
    expect(utana.map(nev)).toEqual(elotte.map(nev))
    expect(utana.map(nev)).toEqual([
      'Akciós Otthoni KézRehab Program',
      'SOS Kézrelax villámkurzus',
      'Otthoni KézRehab Program',
    ])
    expect(utana.map(link)).toEqual(elotte.map(link))
    // A változás maga: a Kurzus címe mező már nem üres.
    expect(utana.map((termek) => termek.displayTitle)).toEqual(utana.map(nev))
  })
})

describe('kurzusCimSorsa: a határok', () => {
  const alap = { id: 9, sku: 'KURZUS-9', slug: 'kurzus-9', updatedAt: null }

  it('csak az üres (hiányzó, null, csupa szóköz) címet tölti, a trimmelt azonosítóval', () => {
    for (const displayTitle of [undefined, null, '', '   ', '\n\t']) {
      const { naplo, modositas } = kurzusCimSorsa({ ...alap, sku: '  KURZUS-9 ', displayTitle })
      expect(naplo.allapot).toBe('KITOLTVE')
      expect(modositas?.data).toEqual({ displayTitle: 'KURZUS-9', slug: 'kurzus-9' })
    }
  })

  it('kitöltött címhez nem nyúl', () => {
    expect(kurzusCimSorsa({ ...alap, displayTitle: 'Kéztorna otthon' }).naplo.allapot).toBe(
      'ERINTETLEN',
    )
    expect(kurzusCimSorsa({ ...alap, displayTitle: 'Kéztorna otthon' }).modositas).toBeNull()
    expect(kurzusCimSorsa({ ...alap, displayTitle: ' KURZUS-9 ' }).naplo.allapot).toBe('MAR')
    expect(kurzusCimSorsa({ ...alap, displayTitle: 42 }).naplo.allapot).toBe('ERINTETLEN')
  })

  it('azonosító vagy webcím nélkül nem tölt (a webcím nem változhat)', () => {
    for (const sku of [null, '', '  ', 7]) {
      const sors = kurzusCimSorsa({ ...alap, sku, displayTitle: null })
      expect(sors.naplo.allapot).toBe('ERINTETLEN')
      expect(sors.modositas).toBeNull()
    }
    for (const slug of [null, '', undefined]) {
      const sors = kurzusCimSorsa({ ...alap, slug, displayTitle: null })
      expect(sors.naplo.allapot).toBe('ERINTETLEN')
      expect(sors.naplo.uzenet).toContain('nincs webcíme')
      expect(sors.modositas).toBeNull()
    }
    expect(kurzusCimSorsa({ sku: 'X', slug: 'x', displayTitle: null }).modositas).toBeNull()
  })

  it('rossz alakú bemenetre sem dob', () => {
    expect(kitoltKurzusCimeket(null)).toEqual({
      allapot: 'NINCS_TERMEK',
      modositasok: null,
      naplo: [],
    })
    expect(kitoltKurzusCimeket([])).toEqual({
      allapot: 'NINCS_TERMEK',
      modositasok: null,
      naplo: [],
    })
    const eredmeny = kitoltKurzusCimeket(['rossz', 5, { ...alap, displayTitle: 'Saját' }])
    expect(eredmeny.allapot).toBe('ERINTETLEN')
    expect(eredmeny.modositasok).toBeNull()
  })

  it('a naplósorokban nincs gondolatjel', () => {
    const sorok = [
      ...kitoltKurzusCimeket(masol(ELO_KURZUSOK)).naplo,
      kurzusCimSorsa({ ...alap, slug: null, displayTitle: null }).naplo,
      kurzusCimSorsa({ ...alap, displayTitle: 'Saját' }).naplo,
    ]
    for (const sor of sorok) {
      expect(sor.uzenet).not.toMatch(/[–—]/)
    }
  })
})

describe('a webcím a VALÓDI slug-hookkal változatlan', () => {
  const hook = courseSlugField.hooks?.beforeValidate?.[0] as FieldHook

  /** A Payload hívásának utánzata; a `find` hangosan dob, ha a hook lekérdezne. */
  async function futtat(args: {
    originalDoc: Record<string, unknown>
    data: Record<string, unknown>
  }): Promise<{ slug: unknown; find: ReturnType<typeof vi.fn> }> {
    const find = vi.fn(() => {
      throw new Error('a slug-hook nem kérdezhet le: a webcím változatlan kell maradjon')
    })
    // A Payload a hiányzó mezőt a régi értékkel pótolja (getFallbackValue),
    // ezért a `value` a data slugja, vagy ennek hiányában az eredeti.
    const value = 'slug' in args.data ? args.data.slug : args.originalDoc.slug
    const slug = await hook({
      data: args.data,
      originalDoc: args.originalDoc,
      value,
      req: { payload: { find } },
    } as unknown as Parameters<FieldHook>[0])
    return { slug, find }
  }

  it.each([['published'], ['draft'], ['archived']])(
    '%s állapotban a kitöltés a régi slugot adja, lekérdezés nélkül',
    async (status) => {
      for (const elo of ELO_KURZUSOK.filter((kurzus) => kurzus.displayTitle === null)) {
        const originalDoc = { ...elo, status }
        const [modositas] =
          kitoltKurzusCimeket([originalDoc]).modositasok ?? ([] as KurzusCimModositas[])
        expect(modositas).toBeDefined()
        const eredmeny = await futtat({ originalDoc, data: { ...modositas?.data } })
        expect(eredmeny.slug).toBe(elo.slug)
        expect(eredmeny.find).not.toHaveBeenCalled()
      }
    },
  )

  it('a slug nélküli adat is a régi slugot adná (a Payload pótlása miatt), piszkozatban is', async () => {
    for (const status of ['published', 'draft']) {
      const originalDoc = { ...ELO_KURZUSOK[2], status }
      const eredmeny = await futtat({
        originalDoc,
        data: { displayTitle: ELO_KURZUSOK[2].sku },
      })
      expect(eredmeny.slug).toBe('otthoni-kezrehab-program')
      expect(eredmeny.find).not.toHaveBeenCalled()
    }
  })

  it('webcím nélküli kurzusnál a hook webcímet generálna: ezért azt a szabály kihagyja', async () => {
    const find = vi.fn(async () => ({ docs: [] }))
    const slug = await hook({
      data: { displayTitle: 'Otthoni KézRehab Program' },
      originalDoc: { id: 8, sku: 'Otthoni KézRehab Program', slug: null, status: 'published' },
      value: null,
      req: { payload: { find } },
    } as unknown as Parameters<FieldHook>[0])
    expect(slug).toBe('otthoni-kezrehab-program')
    expect(
      kurzusCimSorsa({ id: 8, sku: 'Otthoni KézRehab Program', slug: null, displayTitle: null })
        .modositas,
    ).toBeNull()
  })
})
