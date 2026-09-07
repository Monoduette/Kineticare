import { readFileSync } from 'node:fs'
import path from 'node:path'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PostCard } from '../components/content/PostCard'
import { shouldShowCategoryFilter } from '../components/content/post-list'
import {
  CIKK_KATEGORIA,
  kategoriaForCikk,
  postCardLabel,
  TUDASTAR_KATEGORIAK,
  TUDASTAR_TARTALEK_CIMKE,
} from '../lib/tudastar-kategoriak'
import type { Post } from '../payload-types'
import { CIKKEK } from '../scripts/import-tudastar-cikkek'

/**
 * ŐR — A TUDÁSTÁR KATEGÓRIÁI ÉS A KÁRTYA-CÍMKE EGYSÉGESSÉGE.
 *
 * Tulajdonosi kérés (2026-09-07): „A Tudástár címkéit (bilétáit) kérnénk
 * egységesíteni” és „minden elem label-lel legyen ellátva”. Mérve: a nyolc
 * importált cikk közül egynek sem volt kategóriája, ezért minden kártya a
 * „Tudástár” tartalékot viselte. Ez NÉMA hiba: a lap 200-zal válaszol, a
 * kártya kap címkét, csak nem mond semmit. Ezért kell végrehajtható szabály.
 *
 *  T1  MINDEN importált cikk-slug (CIKKEK) szerepel a CIKK_KATEGORIA táblában,
 *      és a tábla nem tartalmaz olyan slugot, amit nem importálunk.
 *  T2  Minden hozzárendelés a három kanonikus kategória egyikére mutat; a
 *      kategória-slugok egyediek, a nevek natív magyarok, kvirtmínusz nélkül,
 *      tömörek (Carbon Tag: „under 20 characters when possible”,
 *      https://carbondesignsystem.com/components/tag/usage/).
 *  T3  A hozzárendelés a tartalmi terv 3. szakaszával és a 7–8. cikk
 *      fejlécében rögzített kategóriával azonos (a döntés a cikkírás ELŐTT
 *      született, a slug utólagos átírása webcímet tör).
 *  T4  A kategória-szűrő az importált készleten MEGJELENIK: legalább három
 *      kategóriának van cikke (post-list.ts küszöbe), különben a szűrő némán
 *      elmaradna, ahogy a mért kiindulásnál.
 *  T5  A kártya PONTOSAN EGY címkét visel, az első kategória nevét; a
 *      tartalék „Tudástár” csak kategória nélküli cikknél jelenik meg, és az
 *      importált készletben ilyen nincs (WCAG 2.2 3.2.4: azonos szerep,
 *      azonos azonosítás; docs/tudastar-ux-terv.md 3.2).
 */

const CIKKEK_DIR = path.join(process.cwd(), 'docs', 'cikkek')

describe('T1 — minden importált cikknek van kategóriája, és csak azoknak', () => {
  it('a CIKKEK minden slugja szerepel a CIKK_KATEGORIA táblában', () => {
    for (const { slug } of CIKKEK) {
      expect(CIKK_KATEGORIA[slug], `kategória nélküli cikk: ${slug}`).toBeDefined()
      expect(() => kategoriaForCikk(slug)).not.toThrow()
    }
  })

  it('a táblában nincs olyan slug, amit nem importálunk (elgépelt kulcs)', () => {
    const importalt = new Set(CIKKEK.map((cikk) => cikk.slug))
    for (const slug of Object.keys(CIKK_KATEGORIA)) {
      expect(importalt.has(slug), `ismeretlen cikk-slug a táblában: ${slug}`).toBe(true)
    }
  })

  it('ismeretlen cikk-slugra a feloldás DOB, nem ad némán tartalékot', () => {
    expect(() => kategoriaForCikk('nincs-ilyen-cikk')).toThrow(/nincs kategória/)
  })
})

describe('T2 — három kanonikus kategória, tömör natív magyar névvel', () => {
  it('pontosan három kategória, egyedi slugokkal és nevekkel', () => {
    expect(TUDASTAR_KATEGORIAK).toHaveLength(3)
    expect(new Set(TUDASTAR_KATEGORIAK.map((k) => k.slug)).size).toBe(3)
    expect(new Set(TUDASTAR_KATEGORIAK.map((k) => k.title)).size).toBe(3)
  })

  it('a slug ékezet nélküli, kisbetűs, kötőjeles', () => {
    for (const { slug } of TUDASTAR_KATEGORIAK) {
      expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    }
  })

  it('a név legfeljebb 20 karakter, nincs benne gondolatjel vagy kvirtmínusz', () => {
    for (const { title } of TUDASTAR_KATEGORIAK) {
      expect(title.length).toBeLessThanOrEqual(20)
      expect(title).not.toMatch(/[–—]/)
      expect(title.trim()).toBe(title)
    }
  })

  it('minden hozzárendelés létező kategóriára mutat', () => {
    const slugok = new Set(TUDASTAR_KATEGORIAK.map((k) => k.slug))
    for (const [cikk, kategoria] of Object.entries(CIKK_KATEGORIA)) {
      expect(slugok.has(kategoria), `${cikk} → ismeretlen kategória: ${kategoria}`).toBe(true)
    }
  })

  it('a seed „tudastar” kategóriája NEM téma: egyetlen cikk sem kerül bele', () => {
    expect(Object.values(CIKK_KATEGORIA)).not.toContain('tudastar')
    expect(TUDASTAR_KATEGORIAK.map((k) => k.slug)).not.toContain('tudastar')
  })
})

describe('T3 — a hozzárendelés a tartalmi tervvel és a cikkfejlécekkel azonos', () => {
  it('a tartalmi terv 3. szakaszának táblája (C1…C8)', () => {
    expect(CIKK_KATEGORIA).toEqual({
      'miert-zsibbad-a-kezem': 'kez-es-csuklo',
      'keztoalagut-szindroma': 'kez-es-csuklo',
      teniszkonyok: 'vall-es-konyok',
      'pattano-ujj': 'kez-es-csuklo',
      'csuklo-es-kezfajdalom': 'kez-es-csuklo',
      'csuklotores-utani-gyogytorna': 'tores-es-mutet-utan',
      inhuvelygyulladas: 'kez-es-csuklo',
      'befagyott-vall': 'vall-es-konyok',
    })
  })

  it('ahol a cikkfájl fejléce kategóriát rögzít, az a táblával egyezik', () => {
    let talalt = 0
    for (const { fajl, slug } of CIKKEK) {
      const forras = readFileSync(path.join(CIKKEK_DIR, fajl), 'utf8')
      const sor = /\|\s*Kategória\s*\|[^|]*\(`([a-z0-9-]+)`\)\s*\|/.exec(forras)
      if (sor === null) continue
      talalt += 1
      expect(sor[1], `${fajl}: a fejléc és a tábla eltér`).toBe(CIKK_KATEGORIA[slug])
    }
    // Mind a nyolc cikkfájl fejléce rögzít kategóriát (mérve 2026-09-07); ha
    // a minta nem találna, a teszt nem védene semmit, ezért a darabszámot is
    // mérjük.
    expect(talalt).toBe(CIKKEK.length)
  })
})

describe('T4 — a kategória-szűrő az importált készleten megjelenik', () => {
  it('legalább három kategóriának van cikke, tehát a chip-sor kint van', () => {
    const cikkesKategoriak = new Set(CIKKEK.map((cikk) => CIKK_KATEGORIA[cikk.slug]))
    expect(cikkesKategoriak.size).toBeGreaterThanOrEqual(3)
    expect(shouldShowCategoryFilter(cikkesKategoriak.size, CIKKEK.length)).toBe(true)
  })
})

describe('T5 — a kártya pontosan egy, egységes elvű címkét visel', () => {
  const badgeSzovegek = (html: string): string[] =>
    [...html.matchAll(/<span class="kc-badge kc-badge--info"[^>]*>([^<]+)<\/span>/g)].map(
      (m) => m[1]!,
    )

  const kartya = (categories: unknown, variant: 'list' | 'compact' = 'list'): string =>
    renderToStaticMarkup(
      createElement(PostCard, {
        post: {
          id: 1,
          slug: 'teszt',
          title: 'Teszt cikk',
          status: 'published',
          categories,
        } as Post,
        variant,
      }),
    )

  it('a címke az ELSŐ feloldott kategória neve, a többi nem jelenik meg', () => {
    const html = kartya([
      { id: 1, title: 'Kéz és csukló' },
      { id: 2, title: 'Váll és könyök' },
    ])
    expect(badgeSzovegek(html)).toEqual(['Kéz és csukló'])
    expect(html).not.toContain('Váll és könyök')
  })

  it.each(['list', 'compact'] as const)('%s: mindkét változat ugyanazt a címkét adja', (variant) => {
    const html = kartya([{ id: 1, title: 'Törés és műtét után' }], variant)
    expect(badgeSzovegek(html)).toEqual(['Törés és műtét után'])
  })

  it('kategória nélküli cikknél a tartalék a tartalomtár neve, nem kitalált téma', () => {
    for (const categories of [undefined, null, [], [99], [{ id: 1, title: ' ' }]]) {
      expect(postCardLabel(categories)).toBe(TUDASTAR_TARTALEK_CIMKE)
      expect(badgeSzovegek(kartya(categories))).toEqual([TUDASTAR_TARTALEK_CIMKE])
    }
    expect(TUDASTAR_TARTALEK_CIMKE).toBe('Tudástár')
  })

  it('a tartalék a kanonikus készletben SOHA nem fordul elő', () => {
    for (const { slug } of CIKKEK) {
      const kategoria = kategoriaForCikk(slug)
      expect(postCardLabel([{ id: 1, title: kategoria.title }])).toBe(kategoria.title)
      expect(kategoria.title).not.toBe(TUDASTAR_TARTALEK_CIMKE)
    }
  })
})
