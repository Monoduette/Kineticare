import type { CollectionBeforeDeleteHook } from 'payload'
import { describe, expect, it, vi } from 'vitest'

import { deleteCourseProgressOnParentDelete } from '../lib/course-progress/cleanup'

/**
 * A HALADÁS-SOROK takarítása a szülő (felhasználó / kurzus) törlésekor.
 * A `course-progress.user` és `.product` mezője `required: true` (NOT NULL
 * oszlop), a Payload postgres-adaptere viszont `ON DELETE SET NULL` idegen
 * kulcsot generál hozzá. A kettő kizárja egymást. Helyben, VALÓS
 * Payload+Postgres ellen reprodukálva: egy haladással rendelkező felhasználó
 */

interface DeleteHivas {
  collection?: string
  where?: unknown
  req?: unknown
}

function futtat(
  hook: CollectionBeforeDeleteHook,
  options: { id: number | string; hiba?: Error; docs?: unknown[] },
) {
  const hivasok: DeleteHivas[] = []
  const del = vi.fn(async (args: DeleteHivas) => {
    hivasok.push(args)
    if (options.hiba !== undefined) {
      throw options.hiba
    }
    return { docs: options.docs ?? [], errors: [] }
  })
  const req = { payload: { delete: del }, jelolo: 'kérés-kontextus' }
  return {
    hivasok,
    eredmeny: hook({
      id: options.id,
      req: req as never,
      collection: {} as never,
      context: {} as never,
    }),
  }
}

describe('deleteCourseProgressOnParentDelete', () => {
  it('a FELHASZNÁLÓ haladás-sorait a user mező szerint törli', async () => {
    const hook = deleteCourseProgressOnParentDelete('user')
    const { hivasok, eredmeny } = futtat(hook, { id: 42, docs: [{ id: 1 }, { id: 2 }] })
    await eredmeny

    expect(hivasok).toHaveLength(1)
    expect(hivasok[0].collection).toBe('course-progress')
    expect(hivasok[0].where).toEqual({ user: { equals: 42 } })
  })

  it('a KURZUS haladás-sorait a product mező szerint törli', async () => {
    const hook = deleteCourseProgressOnParentDelete('product')
    const { hivasok, eredmeny } = futtat(hook, { id: 7 })
    await eredmeny

    expect(hivasok[0].where).toEqual({ product: { equals: 7 } })
  })

  it('a kérés-kontextust TOVÁBBADJA (tranzakció és jogosultság együtt marad)', async () => {
    const hook = deleteCourseProgressOnParentDelete('user')
    const { hivasok, eredmeny } = futtat(hook, { id: 5 })
    await eredmeny

    expect((hivasok[0].req as { jelolo?: string } | undefined)?.jelolo).toBe('kérés-kontextus')
  })

  it('szöveges azonosítóval is működik (a Payload id-je nem mindig szám)', async () => {
    const hook = deleteCourseProgressOnParentDelete('user')
    const { hivasok, eredmeny } = futtat(hook, { id: 'abc-123' })
    await eredmeny

    expect(hivasok[0].where).toEqual({ user: { equals: 'abc-123' } })
  })

  /**
   * A takarítás egy SEGÉDLÉPÉS. Ha elbukik, a törlés a maga útján fut tovább, és
   * a valódi hibát ott kapja meg a hívó — a hook nem nyelheti el a műveletet, de
   * el sem takarhatja a diagnózist.
   */
  it('a takarítás hibája NEM akasztja meg a törlést', async () => {
    const hook = deleteCourseProgressOnParentDelete('user')
    const { eredmeny } = futtat(hook, { id: 9, hiba: new Error('adatbázis elérhetetlen') })

    await expect(eredmeny).resolves.toBeUndefined()
  })
})
