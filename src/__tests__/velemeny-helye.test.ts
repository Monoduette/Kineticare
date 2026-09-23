import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  featuredTestimonials,
  MAX_HOME_TESTIMONIALS,
} from '../components/content/home/TestimonialsSection'
import {
  HOL_LATSZIK_OSZLOP,
  mutatottDarab,
  oldalVelemenyDarab,
  SEHOL_FELIRAT,
  VELEMENY_FELSO_KORLAT,
  velemenyHelye,
  velemenyHelyeFelirat,
  sorrendSzerint,
  type HelyListaElem,
  type HelyOldal,
  type HelyVelemeny,
} from '../lib/admin/velemeny-helye'
import type { Testimonial } from '../payload-types'

/**
 * A „Hol látszik” oszlop szabálya (modul-térkép H43/4,
 * src/lib/admin/velemeny-helye.ts). Minden „Sehol” ág, a többoldalas eset,
 * és a kötés a weboldal kódjához: ahol a szabály egy komponensre vagy
 * route-ra épül, a forrássort olvassuk (readFileSync), hogy ha a gazda
 * változtat, ez a teszt bukjon, és az oszlop ne maradjon csendben hamis.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url))
const forras = (utvonal: string): string => readFileSync(join(SRC, utvonal), 'utf8')

const kiemelt = (id: number | string): HelyVelemeny => ({ id, featured: true, visible: true })

/** A weboldal listája: az azonosítók sorrendjében 1, 2, 3 Sorrenddel. */
const sor = (...idk: (number | string)[]): HelyListaElem[] =>
  idk.map((id, index) => ({ id, order: index + 1 }))

const szekcio = (
  beallitas: { maxItems?: number | null; rejtett?: boolean } = {},
): Record<string, unknown> => ({
  blockType: 'testimonials',
  maxItems: beallitas.maxItems ?? null,
  sectionSettings: { visible: beallitas.rejtett !== true },
})

const masikSzekcio = { blockType: 'richText', sectionSettings: { visible: true } }

const oldal = (slug: string, title: string, layout: unknown[]): HelyOldal => ({
  slug,
  title,
  layout,
})

/** Kezdőlap Vélemények szekció nélkül (ezzel a tartalék-kezdőlap nem számít). */
const kezdolapSzekcioNelkul = oldal('kezdolap', 'Kéz-rehabilitáció otthon', [masikSzekcio])

const felirat = (bemenet: Parameters<typeof velemenyHelye>[0]): string =>
  velemenyHelyeFelirat(velemenyHelye(bemenet))

describe('velemenyHelye: a „Sehol” ágak', () => {
  const oldalak = [oldal('kezdolap', 'Kezdőlap cím', [szekcio()])]

  it('nincs Látható pipa: „Sehol (rejtett)”, akkor is, ha kiemelt', () => {
    for (const visible of [false, null, undefined]) {
      expect(
        felirat({ velemeny: { id: 1, featured: true, visible }, elsoHarom: sor(1), oldalak }),
      ).toBe('Sehol (rejtett)')
    }
  })

  it('nincs Kiemelt pipa: „Sehol (nincs kiemelve)”', () => {
    for (const featured of [false, null, undefined]) {
      expect(
        felirat({ velemeny: { id: 1, featured, visible: true }, elsoHarom: sor(), oldalak }),
      ).toBe('Sehol (nincs kiemelve)')
    }
  })

  it('kiemelt és látható, de nincs az első háromban: „Sehol (nem fér az első háromba)”', () => {
    expect(felirat({ velemeny: kiemelt(9), elsoHarom: sor(1, 2, 3), oldalak })).toBe(
      'Sehol (nem fér az első háromba)',
    )
  })

  it('nincs nem rejtett Vélemények szekció: „Sehol (nincs Vélemények szekció)”', () => {
    expect(
      felirat({
        velemeny: kiemelt(1),
        elsoHarom: sor(1),
        oldalak: [
          kezdolapSzekcioNelkul,
          oldal('rolunk', 'Rólunk', [szekcio({ rejtett: true })]),
          oldal('kapcsolat', 'Kapcsolat', [szekcio()]),
        ],
      }),
    ).toBe('Sehol (nincs Vélemények szekció)')
  })

  it('a szekció 1 véleményt mutat, a vélemény rangja 2: az oldal nem számít', () => {
    const hely = velemenyHelye({
      velemeny: kiemelt(3),
      elsoHarom: sor(1, 2, 3),
      oldalak: [kezdolapSzekcioNelkul, oldal('rolunk', 'Rólunk', [szekcio({ maxItems: 1 })])],
    })
    expect(hely).toEqual({ tipus: 'sehol', ok: 'keves-hely' })
    expect(velemenyHelyeFelirat(hely)).toBe('Sehol (a Vélemények szekció kevesebbet mutat)')
  })

  it('ugyanott az első helyen álló vélemény látszik (rang 0 < 1)', () => {
    expect(
      felirat({
        velemeny: kiemelt(1),
        elsoHarom: sor(1, 2, 3),
        oldalak: [kezdolapSzekcioNelkul, oldal('rolunk', 'Rólunk', [szekcio({ maxItems: 1 })])],
      }),
    ).toBe('Rólunk')
  })

  it('minden „Sehol” felirat natív magyar, gondolatjel nélkül', () => {
    for (const szoveg of Object.values(SEHOL_FELIRAT)) {
      expect(szoveg.startsWith('Sehol (')).toBe(true)
      expect(szoveg).not.toMatch(/[–—]/)
    }
  })
})

describe('velemenyHelye: több oldal', () => {
  it('a nevek vesszővel, a Kezdőlap elöl, utána ábécérendben', () => {
    expect(
      felirat({
        velemeny: kiemelt(2),
        elsoHarom: sor(1, 2, 3),
        oldalak: [
          oldal('szolgaltatasok', 'Szolgáltatások', [szekcio()]),
          oldal('rolunk', 'Rólunk', [masikSzekcio, szekcio({ maxItems: 2 })]),
          oldal('kezdolap', 'Kéz-rehabilitáció otthon', [szekcio()]),
          oldal('kapcsolat', 'Kapcsolat', [szekcio()]),
          oldal('gyik', 'Gyakori kérdések', [szekcio({ maxItems: 1 })]),
        ],
      }),
    ).toBe('Kezdőlap, Rólunk, Szolgáltatások')
  })

  it('egy oldal több szekciójából a legtöbbet mutató dönt, a rejtett nem számít', () => {
    const rolunk = oldal('rolunk', 'Rólunk', [
      szekcio({ maxItems: 1 }),
      szekcio({ maxItems: 3, rejtett: true }),
      szekcio({ maxItems: 2 }),
    ])
    expect(oldalVelemenyDarab(rolunk)).toBe(2)
    expect(
      felirat({
        velemeny: kiemelt('b'),
        elsoHarom: sor('a', 'b'),
        oldalak: [kezdolapSzekcioNelkul, rolunk],
      }),
    ).toBe('Rólunk')
  })

  it('az azonosító számként és szövegként is egyezik', () => {
    const oldalak = [oldal('kezdolap', 'x', [szekcio()])]
    expect(felirat({ velemeny: kiemelt(7), elsoHarom: sor('7'), oldalak })).toBe('Kezdőlap')
    expect(felirat({ velemeny: kiemelt('7'), elsoHarom: sor(7), oldalak })).toBe('Kezdőlap')
  })

  it('a szekciósor nélküli kezdőlap a rögzített kezdőlap (3 vélemény)', () => {
    expect(oldalVelemenyDarab(oldal('kezdolap', 'x', []))).toBe(3)
    expect(oldalVelemenyDarab({ slug: 'kezdolap', title: 'x', layout: null })).toBe(3)
    expect(
      felirat({
        velemeny: kiemelt(3),
        elsoHarom: sor(1, 2, 3),
        oldalak: [oldal('kezdolap', 'x', [])],
      }),
    ).toBe('Kezdőlap')
  })

  it('közzétett kezdőlap nélkül is a rögzített kezdőlap látszik', () => {
    expect(
      felirat({
        velemeny: kiemelt(1),
        elsoHarom: sor(1),
        oldalak: [oldal('rolunk', 'Rólunk', [szekcio()])],
      }),
    ).toBe('Kezdőlap, Rólunk')
  })

  it('a Kapcsolat oldal sosem számít', () => {
    expect(oldalVelemenyDarab(oldal('kapcsolat', 'Kapcsolat', [szekcio()]))).toBe(0)
  })
})

describe('kötés a weboldal kódjához', () => {
  it('a darabszám szorítása egyezik a featuredTestimonials szorításával', () => {
    expect(VELEMENY_FELSO_KORLAT).toBe(MAX_HOME_TESTIMONIALS)
    const lista: Testimonial[] = [1, 2, 3, 4, 5].map((id) => ({
      id,
      quote: `Idézet ${String(id)}`,
      authorName: `Szerző ${String(id)}`,
      featured: true,
      visible: true,
      order: id,
      updatedAt: '2026-09-23T00:00:00.000Z',
      createdAt: '2026-09-23T00:00:00.000Z',
    }))
    for (const limit of [-5, 0, 0.5, 1, 1.9, 2, 2.7, 3, 4, 99, Number.NaN]) {
      expect(mutatottDarab(limit), `maxItems = ${String(limit)}`).toBe(
        featuredTestimonials(lista, limit).length,
      )
    }
    for (const hianyzo of [null, undefined]) {
      expect(mutatottDarab(hianyzo)).toBe(featuredTestimonials(lista).length)
    }
  })

  /** Egy kiemelt és látható vélemény a weboldal típusával. */
  const velemenyDoc = (id: number, order: number | null): Testimonial => ({
    id,
    quote: `Idézet ${String(id)}`,
    authorName: `Szerző ${String(id)}`,
    featured: true,
    visible: true,
    order,
    updatedAt: '2026-09-23T00:00:00.000Z',
    createdAt: '2026-09-23T00:00:00.000Z',
  })

  /**
   * Az adatbázis válasza a getTestimonials lekérdezésre (`sort: 'order'`,
   * `limit: 3`): Postgres ASC NULLS LAST, egyenlőnél az azonosító szerint.
   */
  const adatbazisElsoHarom = (lista: readonly Testimonial[]): Testimonial[] =>
    [...lista]
      .sort((a, b) => {
        if (a.order == null || b.order == null) {
          return a.order == null ? (b.order == null ? a.id - b.id : 1) : -1
        }
        return a.order - b.order || a.id - b.id
      })
      .slice(0, VELEMENY_FELSO_KORLAT)

  it('az üres Sorrendű vélemény a szekcióban előre kerül (az adatbázisban hátul áll)', () => {
    const lista = [velemenyDoc(1, 1), velemenyDoc(2, 2), velemenyDoc(3, null)]
    const elsoHarom = adatbazisElsoHarom(lista)
    expect(elsoHarom.map((v) => v.id)).toEqual([1, 2, 3])
    expect(featuredTestimonials(elsoHarom, 1).map((v) => v.id)).toEqual([3])

    const oldalak = [kezdolapSzekcioNelkul, oldal('rolunk', 'Rólunk', [szekcio({ maxItems: 1 })])]
    const bemenet = (id: number): Parameters<typeof velemenyHelye>[0] => ({
      velemeny: kiemelt(id),
      elsoHarom,
      oldalak,
    })
    expect(felirat(bemenet(3))).toBe('Rólunk')
    expect(felirat(bemenet(1))).toBe('Sehol (a Vélemények szekció kevesebbet mutat)')
    expect(felirat(bemenet(2))).toBe('Sehol (a Vélemények szekció kevesebbet mutat)')
  })

  it('üres és negatív Sorrend vegyesen: a látottnak jelöltek pontosan a featuredTestimonials kimenete', () => {
    const esetek: readonly (readonly (number | null)[])[] = [
      [1, 2, null],
      [5, null, -2, null],
      [null, -3, 4],
      [-1, null, null, 7],
      [null, 0, null],
      [null, null, null, null],
      [3, -1, null, -1, 2],
      [0, -5, null],
    ]
    for (const sorrendek of esetek) {
      const lista = sorrendek.map((order, index) => velemenyDoc(index + 1, order))
      const elsoHarom = adatbazisElsoHarom(lista)
      for (const limit of [1, 2]) {
        const oldalak = [
          kezdolapSzekcioNelkul,
          oldal('rolunk', 'Rólunk', [szekcio({ maxItems: limit })]),
        ]
        const latott = lista
          .filter((v) => {
            const hely = velemenyHelye({ velemeny: kiemelt(v.id), elsoHarom, oldalak })
            return hely.tipus === 'oldalak' && hely.nevek.includes('Rólunk')
          })
          .map((v) => v.id)
          .sort((a, b) => a - b)
        const weboldal = featuredTestimonials(elsoHarom, limit).map((v) => v.id)
        const eset = `Sorrend ${JSON.stringify(sorrendek)}, maxItems ${String(limit)}`
        expect(latott, eset).toEqual([...weboldal].sort((a, b) => a - b))
        expect(
          sorrendSzerint(elsoHarom)
            .slice(0, limit)
            .map((v) => v.id),
          eset,
        ).toEqual(weboldal)
      }
    }
  })

  it('a rendezés BETŰRE a featuredTestimonials rendezése', () => {
    expect(forras('components/content/home/TestimonialsSection.tsx')).toContain(
      '.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))',
    )
  })

  it('a RenderBlocks a blokk maxItems-ét adja át, és a rejtett szekciót kihagyja', () => {
    const kod = forras('components/blocks/RenderBlocks.tsx')
    expect(kod).toContain('maxItems={block.maxItems ?? undefined}')
    expect(kod).toContain('if (block.sectionSettings?.visible === false) {')
  })

  it('a szekciósor nélküli kezdőlap a Vélemények szekciót a teljes listával rajzolja', () => {
    const kod = forras('components/content/HomeView.tsx')
    expect(kod).toContain('const layout = presentHomeLayout(home?.layout ?? [])')
    expect(kod).toContain('<TestimonialsSection testimonials={testimonials} />')
  })

  it('a Kapcsolat route üres véleménylistát ad', () => {
    expect(forras('app/(frontend)/kapcsolat/page.tsx')).toContain('testimonials={[]}')
  })

  it('az oszlop neve a gyűjtemény leírásában is ez', () => {
    expect(HOL_LATSZIK_OSZLOP).toBe('Hol látszik')
  })
})
