import { describe, expect, it } from 'vitest'

import { articleJsonLd } from '../lib/seo'

import {
  CIKK_KULCSSZAVAK,
  kulcsszoFor,
  SEO_DESCRIPTION_MAX,
  SEO_DESCRIPTION_MIN,
  SEO_TITLE_MAX,
} from '../lib/tudastar/seo-kulcsszavak'

/** Ékezet- és kisbetű-független összevetés (a magyar toldalékolás miatt). */
const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

const CIKKEK = [
  'miert-zsibbad-a-kezem',
  'keztoalagut-szindroma',
  'teniszkonyok',
  'pattano-ujj',
  'csuklo-es-kezfajdalom',
  'csuklotores-utani-gyogytorna',
  'inhuvelygyulladas',
  'befagyott-vall',
] as const

describe('S1 — minden cikknek van mért célzása', () => {
  it.each(CIKKEK)('%s', (slug) => {
    const k = kulcsszoFor(slug)
    expect(k, `${slug}: nincs kulcsszó-célzás`).toBeDefined()
    expect(k!.volumen).toBeGreaterThan(0)
    expect(k!.nehezseg).toBeGreaterThanOrEqual(0)
    expect(k!.masodlagos.length).toBeGreaterThan(0)
    expect(k!.indok.length).toBeGreaterThan(40)
  })
})

describe('S2 — a keresett kifejezés tényleg a címben van', () => {
  it.each(CIKK_KULCSSZAVAK.map((k) => [k.slug, k] as const))('%s', (_slug, k) => {
    // A magyar toldalékolás miatt a kifejezés SZAVAIT keressük, nem a
    // pontos alakot: „kéz zsibbadás” → a címben „Kéz zsibbadás”.
    const cim = norm(k.seoTitle)
    for (const szo of norm(k.elsodleges).split(' ')) {
      expect(cim, `${k.slug}: „${szo}” hiányzik a SEO-címből`).toContain(szo.slice(0, 6))
    }
  })
})

describe('S3 — MÉRT hossz-korlátok', () => {
  it.each(CIKK_KULCSSZAVAK.map((k) => [k.slug, k] as const))('%s', (_slug, k) => {
    expect(k.seoTitle.length, `${k.slug}: SEO-cím túl hosszú`).toBeLessThanOrEqual(SEO_TITLE_MAX)
    expect(k.seoDescription.length, `${k.slug}: leírás túl hosszú`).toBeLessThanOrEqual(
      SEO_DESCRIPTION_MAX,
    )
    expect(k.seoDescription.length, `${k.slug}: leírás túl rövid`).toBeGreaterThanOrEqual(
      SEO_DESCRIPTION_MIN,
    )
  })
})

describe('S4 — magyar mikroszöveg-szabályzat', () => {
  it.each(CIKK_KULCSSZAVAK.map((k) => [k.slug, k] as const))('%s', (_slug, k) => {
    // Töltelék gondolatjel tilos (CLAUDE.md, „Felületi (UX/UI) munka”).
    expect(k.seoTitle, `${k.slug}: gondolatjel a címben`).not.toMatch(/[–—]/)
    expect(k.seoDescription, `${k.slug}: gondolatjel a leírásban`).not.toMatch(/[–—]/)
    // A cím nem kezdhet márkanévvel: a mérés szerint a versenytárs kezdőlapja
    // is gyengébb, mint négy tünet-cikkük.
    expect(norm(k.seoTitle).startsWith('kineticare')).toBe(false)
  })
})

describe('S5 — nincs két cikk ugyanarra a kifejezésre (kannibalizáció)', () => {
  it('az elsődleges kifejezések egyediek', () => {
    const set = new Set(CIKK_KULCSSZAVAK.map((k) => norm(k.elsodleges)))
    expect(set.size).toBe(CIKK_KULCSSZAVAK.length)
  })
  it('a SEO-címek egyediek', () => {
    const set = new Set(CIKK_KULCSSZAVAK.map((k) => norm(k.seoTitle)))
    expect(set.size).toBe(CIKK_KULCSSZAVAK.length)
  })
})

describe('S6 — a mért kulcsszavak kikerülnek a strukturált adatba', () => {
  it.each(CIKK_KULCSSZAVAK.map((k) => [k.slug, k] as const))('%s', (_slug, k) => {
    const ld = articleJsonLd({
      post: {
        title: 'Cím',
        excerpt: 'Bevezető.',
        publishedAt: '2026-08-21T00:00:00.000Z',
        updatedAt: '2026-08-21T00:00:00.000Z',
      },
      path: `/blog/${k.slug}`,
      keywords: [k.elsodleges, ...k.masodlagos],
      about: k.targy,
    })
    // A schema.org szerint a keywords lista vesszővel elválasztott szöveg.
    expect(String(ld.keywords)).toContain(k.elsodleges)
    for (const m of k.masodlagos) {
      expect(String(ld.keywords), `${k.slug}: „${m}” hiányzik`).toContain(m)
    }
    expect(ld.about).toEqual({ '@type': k.targy.tipus, name: k.targy.nev })
  })

  it('a keywords mező kimarad, ha nincs mérés (nem üresen jelenik meg)', () => {
    const ld = articleJsonLd({
      post: {
        title: 'Cím',
        excerpt: 'Bevezető.',
        publishedAt: null,
        updatedAt: '2026-08-21T00:00:00.000Z',
      },
      path: '/blog/valami',
    })
    expect('keywords' in ld).toBe(false)
    expect('about' in ld).toBe(false)
  })
})

describe('S7 — a 7. és 8. cikk zárolt célzása', () => {
  it('ínhüvelygyulladás: elsodleges, volumen, KD, seo, MedicalCondition', () => {
    const k = kulcsszoFor('inhuvelygyulladas')
    expect(k).toBeDefined()
    expect(k!.elsodleges).toBe('ínhüvelygyulladás')
    expect(k!.volumen).toBe(2200)
    expect(k!.nehezseg).toBe(18)
    expect(k!.seoTitle).toBe('Ínhüvelygyulladás: tünetek és mit tehetsz')
    expect(k!.seoDescription).toBe(
      'Ínhüvelygyulladás: hol fáj a csuklón és a hüvelykujjon, mit tehetsz házilag, és mikor kell orvoshoz menni. Nem diagnózis.',
    )
    expect(k!.targy).toEqual({ tipus: 'MedicalCondition', nev: 'Ínhüvelygyulladás' })
  })

  it('befagyott váll: elsodleges, volumen, KD, seo; nem vállfájdalom', () => {
    const k = kulcsszoFor('befagyott-vall')
    expect(k).toBeDefined()
    expect(k!.elsodleges).toBe('befagyott váll')
    expect(k!.volumen).toBe(880)
    expect(k!.nehezseg).toBe(12)
    expect(k!.seoTitle).toBe('Befagyott váll: szakaszok és teendők')
    expect(k!.seoDescription).toBe(
      'Befagyott váll (adhesive capsulitis): a három szakasz, mit tehetsz otthon, milyen a torna, és mikor kell orvos. Nem diagnózis.',
    )
    expect(k!.elsodleges).not.toBe('vállfájdalom')
    expect(k!.targy).toEqual({ tipus: 'MedicalCondition', nev: 'Befagyott váll' })
  })
})
