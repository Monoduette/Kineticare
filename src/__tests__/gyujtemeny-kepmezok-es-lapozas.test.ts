import type { Field } from 'payload'
import { describe, expect, it } from 'vitest'

import { KEP_CSERE_SUGO } from '../blocks/kep-csere'
import { KOZOS_KEP_FIGYELMEZTETES, Media, MEDIA_LEIRAS, meglevoKep } from '../collections/Media'
import { Pages } from '../collections/Pages'
import { Posts } from '../collections/Posts'

/**
 * B4 (modul-térkép H08/1 és H34): az Oldalak lista lapozása, a Képek
 * gyűjtemény közös-kép figyelmeztetése, és a képmezők közös súgója a Pages és
 * a Posts képmezőin.
 */

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null

const adminOf = (f: Field): Rec => ('admin' in f && isRec(f.admin) ? f.admin : {})

/** A mezők laposan, a név nélküli fülek és sorok tartalmával együtt. */
function laposMezok(fields: Field[]): Field[] {
  const out: Field[] = []
  for (const f of fields) {
    out.push(f)
    if (f.type === 'tabs') for (const tab of f.tabs) out.push(...laposMezok(tab.fields))
    if ((f.type === 'row' || f.type === 'collapsible') && Array.isArray(f.fields)) {
      out.push(...laposMezok(f.fields))
    }
  }
  return out
}

function mezo(fields: Field[], name: string): Field {
  const talalat = laposMezok(fields).find((f) => 'name' in f && f.name === name)
  if (!talalat) throw new Error(`nincs ${name} mező`)
  return talalat
}

const leiras = (fields: Field[], name: string): string => {
  const d = adminOf(mezo(fields, name)).description
  if (typeof d !== 'string') throw new Error(`${name}: a leírás nem szöveg`)
  return d
}

/** Nagykötőjel (U+2013) és kvirtmínusz (U+2014): az új szövegekben egy sem lehet. */
const GONDOLATJEL = /[\u2013\u2014]/

describe('H08/1: az Oldalak lista lapozása', () => {
  it('alapból 25 sor, választható 10, 25, 50, 100', () => {
    expect(Pages.admin?.pagination?.defaultLimit).toBe(25)
    expect(Pages.admin?.pagination?.limits).toEqual([10, 25, 50, 100])
    // Az alapérték a választhatók között van (a lapméret-választó ezt jelöli).
    expect(Pages.admin?.pagination?.limits).toContain(Pages.admin?.pagination?.defaultLimit)
  })

  it('a lista keresője változatlan', () => {
    expect(Pages.admin?.listSearchableFields).toEqual(['title', 'slug'])
  })
})

describe('H34: a Képek gyűjtemény kimondja, hogy a kép közös', () => {
  it('a gyűjtemény leírása a hatókört és a helyi csere útját is mondja', () => {
    expect(Media.admin?.description).toBe(MEDIA_LEIRAS)
    expect(MEDIA_LEIRAS).toContain('minden oldalon')
    expect(MEDIA_LEIRAS).toContain('X-szel')
  })

  it('az első mező a figyelmeztető ui-mező, a Payload FieldDescription-jével', () => {
    const elso = Media.fields[0]
    expect(elso?.type).toBe('ui')
    if (!elso || elso.type !== 'ui') throw new Error('az első mező nem ui')
    expect(elso.name).toBe('kozosKepFigyelmeztetes')
    const Field = elso.admin.components?.Field
    expect(isRec(Field) ? Field.path : Field).toBe('@payloadcms/ui#FieldDescription')
    const clientProps = isRec(Field) && isRec(Field.clientProps) ? Field.clientProps : {}
    expect(clientProps.description).toBe(KOZOS_KEP_FIGYELMEZTETES)
    expect(KOZOS_KEP_FIGYELMEZTETES).toMatch(/^Figyelem: /)
    expect(adminOf(elso).disableListColumn).toBe(true)
  })

  it('a feltétele új képnél hamis, meglévőnél igaz', () => {
    const elso = Media.fields[0]
    if (!elso || elso.type !== 'ui') throw new Error('az első mező nem ui')
    const feltetel = elso.admin.condition
    expect(typeof feltetel).toBe('function')
    if (typeof feltetel !== 'function') return
    const hiv = (data: Rec): boolean =>
      feltetel(data, data, { blockData: {}, operation: 'update', path: [], user: null })
    expect(hiv({})).toBe(false)
    expect(hiv({ alt: 'Új kép' })).toBe(false)
    expect(hiv({ id: null })).toBe(false)
    expect(hiv({ id: '' })).toBe(false)
    expect(hiv({ id: 12, alt: 'Kéz' })).toBe(true)
    expect(hiv({ id: '12' })).toBe(true)
    expect(meglevoKep(null)).toBe(false)
    expect(meglevoKep(undefined)).toBe(false)
  })

  it('a meglévő mezők sorrendje és a feltöltés beállítása változatlan', () => {
    expect(Media.fields.map((f) => ('name' in f ? f.name : f.type))).toEqual([
      'kozosKepFigyelmeztetes',
      'alt',
    ])
    expect(Media.upload && typeof Media.upload === 'object' ? Media.upload.mimeTypes : []).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
    ])
  })
})

describe('H34: a képmezők közös súgója a Pages és a Posts képmezőin', () => {
  const esetek: Array<[string, Field[], string]> = [
    ['Pages', Pages.fields, 'heroImage'],
    ['Pages', Pages.fields, 'ogImage'],
    ['Posts', Posts.fields, 'heroImage'],
    ['Posts', Posts.fields, 'ogImage'],
  ]

  it.each(esetek)('%s %s: a leírás a KEP_CSERE_SUGO-val zárul', (_gyujtemeny, fields, name) => {
    expect(leiras(fields, name).endsWith(` ${KEP_CSERE_SUGO}`)).toBe(true)
  })

  it('a meglévő tartaléklánc-mondatok változatlanok', () => {
    expect(leiras(Pages.fields, 'heroImage')).toBe(
      `A legtöbb oldalon a lap tetején, a cím mellett vagy alatt álló kép. Ha a Megosztási kép üres, ez látszik a Facebook- és a Messenger-előnézetben; ha ez is üres, a Kineticare alapképe (csapatfotó). A Kapcsolat oldalon a lapon nem jelenik meg, a kezdőlapon sem, amíg annak vannak Szekciói. ${KEP_CSERE_SUGO}`,
    )
    expect(leiras(Pages.fields, 'ogImage')).toBe(
      `Ez a kép jelenik meg, ha valaki Facebookon vagy Messengeren megosztja az oldalt. Ha üres, a Fejléckép, annak híján a Kineticare alapképe (csapatfotó) látszik. ${KEP_CSERE_SUGO}`,
    )
    expect(leiras(Posts.fields, 'heroImage')).toBe(
      `A blogbejegyzés fő képe a bloglistán és a lap tetején. Ha a Megosztási kép üres, megosztáskor is ez látszik; ha ez is üres, a Kineticare alapképe (csapatfotó). ${KEP_CSERE_SUGO}`,
    )
    expect(leiras(Posts.fields, 'ogImage')).toBe(
      `Ez a kép jelenik meg, ha valaki Facebookon vagy Messengeren megosztja a blogbejegyzést. Ha üres, a Borítókép, annak híján a Kineticare alapképe (csapatfotó) látszik. ${KEP_CSERE_SUGO}`,
    )
  })

  it('a súgó és a Képek szövegei ugyanazt mondják a ceruzáról és az X-ről (SC 3.2.4)', () => {
    expect(KEP_CSERE_SUGO).toContain('X-szel')
    expect(KEP_CSERE_SUGO).toContain('minden oldalon')
  })
})

describe('B4: tipográfia az új szövegekben', () => {
  it('nincs nagykötőjel (U+2013) és kvirtmínusz (U+2014)', () => {
    const szovegek = [
      MEDIA_LEIRAS,
      KOZOS_KEP_FIGYELMEZTETES,
      KEP_CSERE_SUGO,
      leiras(Pages.fields, 'heroImage'),
      leiras(Pages.fields, 'ogImage'),
      leiras(Posts.fields, 'heroImage'),
      leiras(Posts.fields, 'ogImage'),
    ]
    expect(szovegek.filter((s) => GONDOLATJEL.test(s))).toEqual([])
  })
})
