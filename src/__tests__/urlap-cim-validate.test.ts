import { formBuilderPlugin } from '@payloadcms/plugin-form-builder'
import type { Config, Field, TextFieldSingleValidation } from 'payload'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'

import {
  CONTACT_FORM_TITLE,
  KOTOTT_URLAP_CIMEK,
  MASOLAT_UTOTAG,
  isKotottUrlapCim,
  kotottCimFoglaltHiba,
  kotottCimHiba,
  urlapCimMasolatNeve,
  urlapMezokAdminnal,
  validateUrlapCim,
} from '../lib/admin/urlap-admin'
import { APPOINTMENT_FORM_TITLE, findAppointmentFormId } from '../lib/appointment/form'
import { logger } from '../lib/logger'
import { NEWSLETTER_FORM_TITLE, findNewsletterFormId } from '../lib/newsletter/form'

/**
 * Az Űrlapok cím-mezőjének validátora és duplikálási hookja (modul-térkép H17).
 *
 * A két használt űrlapot a weboldal a PONTOS címéből keresi, `limit: 1`-gyel,
 * rendezés nélkül (a Postgres-adapter alapja '-createdAt', tehát a legújabb
 * azonos nevű nyer); a „Kapcsolat” űrlapot az induláskori seed a címe alapján
 * ellenőrzi. Ezért:
 *  - a kötött név átnevezése magyar, teendőt mondó hibával bukik;
 *  - kötött nevet csak egy űrlap viselhet (új űrlap, duplikálás, átnevezés a
 *    kötött névre: foglalt-hiba), a saját azonosító kizárásával;
 *  - a duplikált kötött nevű űrlap „ (másolat)” utótagot kap.
 * A `find` mock ott, ahol lekérdezésnek nem szabad futnia, hangosan dob, és a
 * teszt végén ellenőrizzük, hogy nem hívták (a validátor a find hibáját
 * elnyeli, ezért a dobás egymagában nem buktatna).
 */

type Opciok = Parameters<TextFieldSingleValidation>[1]
type FindArgs = { where?: unknown } & Record<string, unknown>
type FindMock = Mock<(args: FindArgs) => Promise<{ docs: unknown[] }>>

const tiltottFindok: FindMock[] = []

/** Olyan find, amelyet a vizsgált ágon nem szabad meghívni. */
function tiltottFind(): FindMock {
  const find = vi.fn(async (args: FindArgs): Promise<{ docs: unknown[] }> => {
    void args
    throw new Error('TILOS: ezen az ágon nem futhat lekérdezés')
  })
  tiltottFindok.push(find)
  return find
}

type Urlap = { id: number; title: string }

/** Memóriabeli adatbázis: a validátor `where`-jét (and, title equals, id not_equals) értékeli ki. */
function memoriaFind(urlapok: readonly Urlap[]): FindMock {
  const illik = (urlap: Urlap, where: unknown): boolean => {
    if (typeof where !== 'object' || where === null) return true
    const feltetel = where as Record<string, unknown>
    if (Array.isArray(feltetel.and)) return feltetel.and.every((resz) => illik(urlap, resz))
    const title = feltetel.title as { equals?: unknown } | undefined
    if (title !== undefined && urlap.title !== title.equals) return false
    const id = feltetel.id as { not_equals?: unknown } | undefined
    if (id !== undefined && urlap.id === id.not_equals) return false
    return true
  }
  return vi.fn(async (args: FindArgs) => ({
    docs: urlapok.filter((urlap) => illik(urlap, args.where)).slice(0, 1),
  }))
}

/** A Payload validate-opcióinak szűk utánzata: a `t` a kulcsot adja vissza. */
function opciok(
  previousValue: unknown,
  extra: Record<string, unknown> = {},
  find: FindMock = tiltottFind(),
): Opciok {
  return {
    required: true,
    operation: 'update',
    id: 1,
    previousValue,
    req: { payload: { config: {}, find }, t: (kulcs: string) => kulcs },
    ...extra,
  } as unknown as Opciok
}

afterEach(() => {
  // Előbb ürítünk, hogy egy bukás ne szivárogjon át a következő tesztre.
  const ellenorizendo = tiltottFindok.splice(0)
  try {
    for (const find of ellenorizendo) {
      expect(find).not.toHaveBeenCalled()
    }
  } finally {
    vi.restoreAllMocks()
  }
})

describe('kötött űrlapcímek', () => {
  it('a kód saját állandóiból áll, a „Kapcsolat” itt él', () => {
    expect([...KOTOTT_URLAP_CIMEK]).toEqual([
      APPOINTMENT_FORM_TITLE,
      NEWSLETTER_FORM_TITLE,
      CONTACT_FORM_TITLE,
    ])
    expect(KOTOTT_URLAP_CIMEK).toEqual(['Időpontkérés', 'Hírlevél', 'Kapcsolat'])
  })

  it('pontos egyezést néz, mert a kód is `equals`-szal keres, limit 1-gyel, rendezés nélkül', async () => {
    expect(isKotottUrlapCim('Hírlevél')).toBe(true)
    expect(isKotottUrlapCim('Hírlevél ')).toBe(false)
    expect(isKotottUrlapCim('hírlevél')).toBe(false)
    expect(isKotottUrlapCim(null)).toBe(false)
    expect(isKotottUrlapCim(3)).toBe(false)

    // A két kereső valóban a pontos címre szűr, és rendezés nélkül az első
    // találatot veszi (a kötés tényének és a „legújabb nyer” hibaosztálynak az őre).
    const hivasok: Array<Record<string, unknown>> = []
    const payload = {
      find: async (args: Record<string, unknown>) => {
        hivasok.push(args)
        return { docs: [{ id: 7 }] }
      },
    }
    await findAppointmentFormId(payload as unknown as Parameters<typeof findAppointmentFormId>[0])
    await findNewsletterFormId(payload as unknown as Parameters<typeof findNewsletterFormId>[0])
    expect(hivasok.map((hivas) => hivas.where)).toEqual([
      { title: { equals: APPOINTMENT_FORM_TITLE } },
      { title: { equals: NEWSLETTER_FORM_TITLE } },
    ])
    for (const hivas of hivasok) {
      expect(hivas.limit).toBe(1)
      expect(hivas.sort).toBeUndefined()
    }
  })
})

describe('validateUrlapCim: a kötött név átnevezése bukik', () => {
  it.each(KOTOTT_URLAP_CIMEK.map((cim) => [cim]))(
    '„%s” átnevezése magyar hibát ad, lekérdezés nélkül',
    async (cim) => {
      const eredmeny = await validateUrlapCim(`${cim} (régi)`, opciok(cim))
      expect(eredmeny).toBe(kotottCimHiba(cim))
      // A javítás módja betűre (WCAG 2.2 SC 3.3.3).
      expect(eredmeny).toContain(`Írd vissza a nevét: „${cim}”.`)
    },
  )

  it('a kötött név átnevezése egy másik kötött névre is az átnevezés-hiba', async () => {
    expect(await validateUrlapCim('Időpontkérés', opciok('Hírlevél'))).toBe(
      kotottCimHiba('Hírlevél'),
    )
  })

  it('a csak szóközben eltérő név is átnevezés (a kereső pontos egyezést vár)', async () => {
    expect(await validateUrlapCim('Hírlevél ', opciok('Hírlevél'))).toBe(kotottCimHiba('Hírlevél'))
    expect(await validateUrlapCim('hírlevél', opciok('Hírlevél'))).toBe(kotottCimHiba('Hírlevél'))
  })

  it('mindhárom üzenet azt mondja, mi találja meg az űrlapot a nevéről, és a teendőt', () => {
    expect(kotottCimHiba('Hírlevél')).toBe(
      'A lábléc feliratkozó sora erről a névről találja meg ezt az űrlapot. Írd vissza a nevét: „Hírlevél”.',
    )
    // A nagybetűs névelő a nevelo()-ból jön (magánhangzó előtt „Az”).
    expect(kotottCimHiba('Időpontkérés')).toBe(
      'Az Időpontkérés szekció erről a névről találja meg ezt az űrlapot. Írd vissza a nevét: „Időpontkérés”.',
    )
    // A „Kapcsolat” űrlapot a weboldal nem keresi, csak az induláskori seed
    // ellenőrzi; az üzenet ezért nem állítja, hogy a weboldal találja meg.
    expect(kotottCimHiba('Kapcsolat')).toBe(
      'A rendszer induláskor erről a névről ellenőrzi, hogy ez az űrlap megvan-e. Írd vissza a nevét: „Kapcsolat”.',
    )
  })

  it('mind a 6 üzenet legfeljebb 110 karakter, és az átnevezés-üzenet a teendővel zárul', () => {
    // A Payload mezőhibája egysoros, levágott tooltip (@payloadcms/ui/dist/
    // elements/Tooltip/index.scss: nowrap, ellipsis; fields/FieldError/
    // index.scss: max-width 75%). Mérve (scratchpad leadA/A2-2-4-atvetel2/
    // hossz-meres.json): 1025 px-es ablakon a szövegnek 663 px jut, ez kb. 110
    // karakter. A hosszabb üzenet vége, épp a teendő, levágva elveszne
    // (WCAG 2.2 SC 3.3.3).
    for (const cim of KOTOTT_URLAP_CIMEK) {
      const atnevezes = kotottCimHiba(cim)
      const foglalt = kotottCimFoglaltHiba(cim)
      expect([...atnevezes].length, atnevezes).toBeLessThanOrEqual(110)
      expect([...foglalt].length, foglalt).toBeLessThanOrEqual(110)
      expect(atnevezes.endsWith(`Írd vissza a nevét: „${cim}”.`), atnevezes).toBe(true)
    }
  })
})

describe('validateUrlapCim: egy kötött nevet csak egy űrlap viselhet', () => {
  it('a foglalt-üzenetek szövege', () => {
    expect(kotottCimFoglaltHiba('Hírlevél')).toBe(
      'Már van „Hírlevél” nevű űrlap, a weboldal azt használja. Ennek az űrlapnak adj más nevet.',
    )
    expect(kotottCimFoglaltHiba('Időpontkérés')).toBe(
      'Már van „Időpontkérés” nevű űrlap, a weboldal azt használja. Ennek az űrlapnak adj más nevet.',
    )
    expect(kotottCimFoglaltHiba('Kapcsolat')).toBe(
      'Már van „Kapcsolat” nevű űrlap. Ennek az űrlapnak adj más nevet.',
    )
  })

  it.each(KOTOTT_URLAP_CIMEK.map((cim) => [cim]))(
    'létrehozás „%s” névvel, ha már van ilyen: foglalt',
    async (cim) => {
      const find = memoriaFind([{ id: 2, title: cim }])
      const eredmeny = await validateUrlapCim(
        cim,
        opciok(undefined, { operation: 'create', id: undefined }, find),
      )
      expect(eredmeny).toBe(kotottCimFoglaltHiba(cim))
      expect(find).toHaveBeenCalledTimes(1)
    },
  )

  it('létrehozás kötött névvel, ha nincs ilyen: átmegy (így indul az induláskori seed is)', async () => {
    const find = memoriaFind([{ id: 2, title: 'Próba' }])
    expect(
      await validateUrlapCim(
        'Hírlevél',
        opciok(undefined, { operation: 'create', id: undefined }, find),
      ),
    ).toBe(true)
    expect(find).toHaveBeenCalledTimes(1)
  })

  it('a duplikálás útja: create, a previousValue a forrás címe, és van ilyen: foglalt', async () => {
    const find = memoriaFind([{ id: 2, title: 'Hírlevél' }])
    const eredmeny = await validateUrlapCim(
      'Hírlevél',
      opciok('Hírlevél', { operation: 'create', id: undefined }, find),
    )
    expect(eredmeny).toBe(kotottCimFoglaltHiba('Hírlevél'))
  })

  it('más űrlap átnevezése kötött névre: ha van ilyen, foglalt; ha nincs, átmegy', async () => {
    const van = memoriaFind([
      { id: 2, title: 'Hírlevél' },
      { id: 5, title: 'Próba' },
    ])
    expect(await validateUrlapCim('Hírlevél', opciok('Próba', { id: 5 }, van))).toBe(
      kotottCimFoglaltHiba('Hírlevél'),
    )
    const nincs = memoriaFind([{ id: 5, title: 'Próba' }])
    expect(await validateUrlapCim('Hírlevél', opciok('Próba', { id: 5 }, nincs))).toBe(true)
  })

  it('a változatlan kötött név mentéskor átmegy, lekérdezés nélkül', async () => {
    for (const cim of KOTOTT_URLAP_CIMEK) {
      const find = tiltottFind()
      expect(await validateUrlapCim(cim, opciok(cim, { operation: 'update', id: 2 }, find))).toBe(
        true,
      )
      expect(find).not.toHaveBeenCalled()
    }
  })

  it('a where a saját azonosítót kizárja (védőkorlát), és csak a címet kéri', async () => {
    const find = memoriaFind([])
    await validateUrlapCim('Időpontkérés', opciok('Próba', { id: 5 }, find))
    expect(find).toHaveBeenCalledTimes(1)
    expect(find.mock.calls[0]?.[0]).toMatchObject({
      collection: 'forms',
      where: { and: [{ title: { equals: 'Időpontkérés' } }, { id: { not_equals: 5 } }] },
      limit: 1,
      depth: 0,
      pagination: false,
      select: { title: true },
    })
    // Létrehozáskor nincs saját azonosító, a where csak a címre szűr.
    const ujFind = memoriaFind([])
    await validateUrlapCim(
      'Időpontkérés',
      opciok(undefined, { operation: 'create', id: undefined }, ujFind),
    )
    expect(ujFind.mock.calls[0]?.[0]).toMatchObject({
      where: { and: [{ title: { equals: 'Időpontkérés' } }] },
    })
  })

  it('a saját rekord nem ütközik önmagával (egy másik lapon már átnevezték)', async () => {
    // A 7-es űrlapot egy másik lapon már „Hírlevél”-re nevezték; ebben a lapban
    // a betöltött cím még „Próba”, a mentés ugyanazt a nevet írná.
    const find = memoriaFind([{ id: 7, title: 'Hírlevél' }])
    expect(await validateUrlapCim('Hírlevél', opciok('Próba', { id: 7 }, find))).toBe(true)
  })

  it('a lekérdezés hibájánál átenged és naplóz, nem dob', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined)
    const find = vi.fn(async (args: FindArgs): Promise<{ docs: unknown[] }> => {
      void args
      throw new Error('adatbázis nem elérhető')
    })
    await expect(
      validateUrlapCim('Hírlevél', opciok(undefined, { operation: 'create', id: undefined }, find)),
    ).resolves.toBe(true)
    expect(find).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[1]).toMatchObject({
      cim: 'Hírlevél',
      error: 'adatbázis nem elérhető',
    })
  })
})

describe('validateUrlapCim: ami szabad', () => {
  it('nem kötött nevű új űrlap bármilyen nevet kaphat, lekérdezés nélkül', async () => {
    expect(
      await validateUrlapCim('Új űrlap', opciok(undefined, { operation: 'create', id: undefined })),
    ).toBe(true)
    expect(
      await validateUrlapCim(
        `Hírlevél${MASOLAT_UTOTAG}`,
        opciok('Hírlevél (másolat)', { operation: 'create', id: undefined }),
      ),
    ).toBe(true)
  })

  it('más űrlap szabadon átnevezhető nem kötött névre', async () => {
    expect(await validateUrlapCim('Visszahívás', opciok('Próba űrlap'))).toBe(true)
  })

  it('az üres cím a Payload megszokott kötelező-hibáját adja', async () => {
    expect(await validateUrlapCim('', opciok(undefined))).toBe('validation:required')
    expect(await validateUrlapCim(null, opciok('Próba űrlap'))).toBe('validation:required')
    expect(await validateUrlapCim(undefined, opciok(undefined))).toBe('validation:required')
    // Kötött űrlapnál is: előbb a Payload alapszabálya fut.
    expect(await validateUrlapCim('', opciok('Hírlevél'))).toBe('validation:required')
  })

  it('a hosszkorlát is megmarad (a Payload text-validátora fut tovább)', async () => {
    expect(await validateUrlapCim('abcdef', opciok(undefined, { maxLength: 3 }))).toBe(
      'validation:shorterThanMax',
    )
  })
})

describe('az üzenetek a GOV.UK és a házszabály szerint szólnak', () => {
  it('nincs tiltott szó, gondolatjel, egyenes idézőjel, határozói igenév és magyarázó feltételes mondat', () => {
    for (const cim of KOTOTT_URLAP_CIMEK) {
      for (const uzenet of [kotottCimHiba(cim), kotottCimFoglaltHiba(cim)]) {
        expect(uzenet).not.toMatch(/érvénytelen|kérjük|kérlek|sajnos|tilos|hiba/i)
        expect(uzenet).not.toMatch(/[–—]/)
        expect(uzenet).not.toContain('"')
        expect(uzenet).not.toMatch(/Átnevezve/)
        // A következmény a súgóba tartozik, nem a hibába (GOV.UK: „get to the point”).
        expect(uzenet).not.toMatch(/Ha átneveznéd/i)
      }
    }
  })
})

describe('urlapCimMasolatNeve: a duplikált kötött nevű űrlap utótagot kap', () => {
  function hook(value: unknown): unknown {
    return urlapCimMasolatNeve({ value } as unknown as Parameters<typeof urlapCimMasolatNeve>[0])
  }

  it('kötött névnél „ (másolat)”, minden más érték változatlan', () => {
    expect(hook('Hírlevél')).toBe('Hírlevél (másolat)')
    expect(hook('Időpontkérés')).toBe('Időpontkérés (másolat)')
    expect(hook('Kapcsolat')).toBe('Kapcsolat (másolat)')
    expect(hook('Próba')).toBe('Próba')
    expect(hook('Hírlevél (másolat)')).toBe('Hírlevél (másolat)')
    expect(hook(null)).toBeNull()
    expect(hook(undefined)).toBeUndefined()
  })

  it('a másolat neve már nem kötött, így a validátor lekérdezés nélkül átengedi', async () => {
    const masolat = hook('Hírlevél')
    expect(isKotottUrlapCim(masolat)).toBe(false)
    expect(
      await validateUrlapCim(
        masolat as string,
        opciok(masolat, { operation: 'create', id: undefined }),
      ),
    ).toBe(true)
  })
})

describe('a bekötés: a valódi form-builder plugin cím-mezője', () => {
  it('a cím mező kötelező marad, a validátor és a duplikálási hook a miénk', async () => {
    const config = await formBuilderPlugin({
      formOverrides: { fields: ({ defaultFields }) => urlapMezokAdminnal(defaultFields) },
    })({ collections: [], i18n: {} } as unknown as Config)
    const forms = config.collections?.find((gyujtemeny) => gyujtemeny.slug === 'forms')
    const cim = forms?.fields.find((mezo: Field) => 'name' in mezo && mezo.name === 'title') as
      Record<string, unknown> | undefined
    expect(cim?.type).toBe('text')
    expect(cim?.required).toBe(true)
    expect(cim?.validate).toBe(validateUrlapCim)
    const hooks = cim?.hooks as { beforeDuplicate?: unknown[] } | undefined
    expect(hooks?.beforeDuplicate?.at(-1)).toBe(urlapCimMasolatNeve)
  })
})
