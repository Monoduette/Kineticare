import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import partnerManifest from '../../content/home-images/site/partner-manifest.json'
import pressManifest from '../../public/media/press/manifest.json'
import {
  HOME_IMAGES,
  PARTNER_LOGO_FILES,
  PRESS_MANIFEST_FILES,
  PRESS_RAIL_FILES,
  buildHomeLayout,
  type HomeMediaIds,
} from '../lib/home-seed'
import {
  ROLUNK_PARTNER_FELIRAT,
  ROLUNK_PARTNER_LOGO_FAJLOK,
  ROLUNK_TOVABBI_PARTNEREK,
  buildRolunkLayout,
  rolunkPartnerSzekciok,
  tervezdPartnerSavot,
  tervezdSajtoLogosorBovitest,
} from '../scripts/restore-legacy-content'
import type { Page } from '../payload-types'

const SITE_DIR = path.resolve(process.cwd(), 'content/home-images/site')

/**
 * A régi kineticare.hu/rolunk 16 partnere közül azok, akiknek a régi oldalon
 * NEM logófájl állt (fotó, képernyőmentés, aláírás) — ők a logósávba nem
 * kerülhetnek, csak a sáv alatti mondatba (docs/grafikai-leltar-regi-oldal.md
 * 2.3, docs/kc-v1-logo-sources.md „Partnerek").
 */
const NEM_LOGO_PARTNEREK = [
  'Aurora Medical',
  'TUDATEST',
  'PhysioWatch',
  'Csillik Árpád',
  'dr. pharm. Kocsis Kristóf',
] as const

type Layout = NonNullable<Page['layout']>
const pressBlocks = (layout: Layout) =>
  layout.flatMap((block) => (block.blockType === 'pressLogos' ? [block] : []))
/** A háttérsáv értéke azoknál a blokkoknál, amelyeknek van ilyen beállítása. */
const hatterOf = (block: Layout[number]): string | null | undefined =>
  (block.sectionSettings as { hatter?: string | null } | undefined)?.hatter

describe('Partnerlogó-assetcsomag (A04)', () => {
  it('a manifest minden fájlja létezik, a bájthash és a dekódolt méret egyezik', async () => {
    expect(partnerManifest.assets.length).toBeGreaterThan(0)
    for (const asset of partnerManifest.assets) {
      const filePath = path.join(SITE_DIR, asset.file)
      expect(existsSync(filePath), asset.file).toBe(true)
      const bytes = readFileSync(filePath)
      const metadata = await sharp(bytes).metadata()
      expect(createHash('sha256').update(bytes).digest('hex'), asset.file).toBe(asset.sha256)
      expect(metadata.format, asset.file).toBe('webp')
      expect(metadata.width, asset.file).toBe(asset.localWidth)
      expect(metadata.height, asset.file).toBe(asset.localHeight)
      // Egységes keret: minden logó ugyanakkora vásznon áll.
      expect(metadata.width, asset.file).toBe(partnerManifest.canvas.width)
      expect(metadata.height, asset.file).toBe(partnerManifest.canvas.height)
      expect(asset.file, asset.file).toMatch(/^partner-[a-z0-9-]+\.webp$/)
      expect(new URL(asset.sourceUrl).protocol).toBe('https:')
      expect(asset.sourceSha256).toMatch(/^[a-f0-9]{64}$/)
    }
  })

  it('az alt a szervezet neve (WCAG 2.2 SC 1.1.1), és a HOME_IMAGES ugyanezt hordozza', () => {
    for (const asset of partnerManifest.assets) {
      expect(asset.alt, asset.file).toMatch(/^Az? .+ logója$/)
      expect(asset.alt, asset.file).toContain(asset.name)
      const seed = HOME_IMAGES.find((image) => image.file === asset.file)
      expect(seed, `${asset.file}: a HOME_IMAGES-ben kell lennie`).toBeDefined()
      expect(seed?.alt, asset.file).toBe(asset.alt)
      expect(seed?.dir, asset.file).toBe('site')
    }
    expect(PARTNER_LOGO_FILES).toEqual(partnerManifest.assets.map((asset) => asset.file))
  })

  it('a sáv: elöl a hivatalos MASE-logó, utána a manifest sorrendje, legfeljebb 12 elem', () => {
    expect(ROLUNK_PARTNER_LOGO_FAJLOK).toEqual(['mase.png', ...PARTNER_LOGO_FILES])
    expect(pressManifest.assets.map((asset) => asset.file)).toContain('mase.png')
    expect(ROLUNK_PARTNER_LOGO_FAJLOK.length).toBe(partnerManifest.integration.railCount)
    expect(ROLUNK_PARTNER_LOGO_FAJLOK.length).toBeLessThanOrEqual(
      partnerManifest.integration.maxRows,
    )
    expect(partnerManifest.integration.maxRows).toBe(12)
  })

  it('a fotó- és aláírás-eredetű partnerek NEM kerülnek a logósávba, csak a mondatba', () => {
    const savNevek = partnerManifest.assets.map((asset) => asset.name)
    const textOnly = partnerManifest.textOnly.map((entry) => entry.name)
    for (const nev of NEM_LOGO_PARTNEREK) {
      expect(savNevek, nev).not.toContain(nev)
      expect(textOnly, nev).toContain(nev)
      expect(ROLUNK_TOVABBI_PARTNEREK, nev).toContain(nev)
    }
    for (const file of PARTNER_LOGO_FILES) {
      expect(file).not.toMatch(/aurora|tudatest|physiowatch|csillik|kocsis-kristof/)
    }
    // Natív magyar mondat, töltelék gondolatjel nélkül; a rich-text ág
    // kulcsszava („Partnereink") a mondat elején.
    expect(ROLUNK_TOVABBI_PARTNEREK).not.toMatch(/[–—]/)
    expect(ROLUNK_TOVABBI_PARTNEREK.startsWith('Partnereink')).toBe(true)
  })

  it('a /rolunk szekciósorában a partner-logósáv a pressLogos blokk „Partnereink" felirattal', () => {
    const partnerLogok = [101, 102, 103]
    const layout = buildRolunkLayout({ partnerLogok })
    const partnerSav = pressBlocks(layout).find((block) => block.heading === ROLUNK_PARTNER_FELIRAT)
    expect(partnerSav).toBeDefined()
    expect(partnerSav?.logos?.map((logo) => logo.image)).toEqual(partnerLogok)
    expect(partnerSav?.sectionSettings?.anchorId).toBe('partnereink')
    // A mondat közvetlenül a sáv után, ugyanabban a fehér régióban.
    const index = layout.indexOf(partnerSav!)
    const mondat = layout[index + 1]
    expect(mondat.blockType).toBe('richText')
    expect(JSON.stringify(mondat)).toContain(ROLUNK_TOVABBI_PARTNEREK)
    expect(hatterOf(mondat)).toBe(hatterOf(partnerSav!))
    // Logó nélkül csak a mondat marad.
    expect(rolunkPartnerSzekciok([]).map((block) => block.blockType)).toEqual(['richText'])
  })

  it('a meglévő /rolunk szövegbekezdést pontosan egyszer cseréli sávra, és idempotens', () => {
    const regi = buildRolunkLayout() // logó nélkül: a régi alak, „Partnereink" mondattal
    const partnerIndex = regi.findIndex(
      (block) => block.blockType === 'richText' && JSON.stringify(block).includes('Partnereink'),
    )
    expect(partnerIndex).toBeGreaterThan(0)
    // A régi seed által letett alak: h2 „Partnereink" + bekezdés.
    const orokolt: Layout = [...regi]
    orokolt[partnerIndex] = {
      blockType: 'richText',
      content: {
        root: {
          type: 'root',
          version: 1,
          direction: null,
          format: '',
          indent: 0,
          children: [
            {
              type: 'heading',
              tag: 'h2',
              version: 1,
              direction: null,
              format: '',
              indent: 0,
              children: [{ type: 'text', text: 'Partnereink', version: 1 }],
            },
          ],
        },
      },
      sectionSettings: { visible: true, hatter: 'tint' },
    }
    const terv = tervezdPartnerSavot(orokolt, [7, 8])
    expect(terv.layout).not.toBeNull()
    expect(terv.layout!.length).toBe(orokolt.length + 1)
    const sav = terv.layout![partnerIndex]
    expect(sav.blockType).toBe('pressLogos')
    expect(sav.blockType === 'pressLogos' ? sav.heading : null).toBe(ROLUNK_PARTNER_FELIRAT)
    // A régi blokk háttérsávját örökli (a szerkesztő sávritmusa marad).
    expect(hatterOf(sav)).toBe('tint')
    expect(hatterOf(terv.layout![partnerIndex + 1])).toBe('tint')
    // Minden más szekció azonos referenciával marad.
    expect(terv.layout!.slice(0, partnerIndex)).toEqual(orokolt.slice(0, partnerIndex))
    expect(terv.layout!.slice(partnerIndex + 2)).toEqual(orokolt.slice(partnerIndex + 1))
    // Második futás: nincs teendő.
    expect(tervezdPartnerSavot(terv.layout, [7, 8]).layout).toBeNull()
    // Logó nélkül és szerkesztői (nem seed-alakú) blokknál nem nyúl hozzá.
    expect(tervezdPartnerSavot(orokolt, []).layout).toBeNull()
    expect(tervezdPartnerSavot(regi, [7]).layout).toBeNull()
  })
})

describe('Sajtó-logósor bővítése (H05)', () => {
  it('a teljes sor a manifest hat régi logója + a négy ellenőrzött új, 10 ≤ 12', () => {
    expect(PRESS_RAIL_FILES).toEqual([
      ...pressManifest.preserveExisting,
      ...pressManifest.assets.map((asset) => asset.file),
    ])
    expect(PRESS_MANIFEST_FILES).toEqual(pressManifest.assets.map((asset) => asset.file))
    expect(PRESS_RAIL_FILES.length).toBe(pressManifest.integration.resultingCount)
    expect(PRESS_RAIL_FILES.length).toBeLessThanOrEqual(pressManifest.integration.maxRows)
    const media: HomeMediaIds = {}
    PRESS_RAIL_FILES.forEach((file, index) => {
      media[file] = 100 + index
    })
    const home = pressBlocks(buildHomeLayout(media))
    expect(home).toHaveLength(1)
    expect(home[0].logos?.map((logo) => logo.image)).toEqual(
      PRESS_RAIL_FILES.map((_, index) => 100 + index),
    )
    const rolunk = pressBlocks(
      buildRolunkLayout({ sajtoLogok: PRESS_RAIL_FILES.map((_, index) => 100 + index) }),
    ).find((block) => block.heading === 'Itt találkozhattál velünk')
    expect(rolunk?.logos).toHaveLength(PRESS_RAIL_FILES.length)
  })

  it('meglévő sort additívan bővít: a régi hat marad elöl, a hiányzók a végére, 12 fölött nem nyúl hozzá', () => {
    const regiHat = [1, 2, 3, 4, 5, 6]
    const layout: Layout = [
      {
        blockType: 'pressLogos',
        id: 'p1',
        heading: 'Itt találkozhattál velünk',
        logos: regiHat.map((image, index) => ({ id: `l${index}`, image })),
        sectionSettings: { visible: true, hatter: 'feher' },
      },
    ]
    const terv = tervezdSajtoLogosorBovitest(
      layout,
      [3, 1, 7, 8, 9, 10],
      'Itt találkozhattál velünk',
    )
    const sor = terv.layout![0]
    expect(sor.blockType === 'pressLogos' ? sor.logos?.map((logo) => logo.image) : null).toEqual([
      ...regiHat,
      7,
      8,
      9,
      10,
    ])
    // A meglévő sorok (id-vel együtt) érintetlenek.
    expect(sor.blockType === 'pressLogos' ? sor.logos?.[0] : null).toEqual({ id: 'l0', image: 1 })
    expect(
      tervezdSajtoLogosorBovitest(terv.layout, [7, 8, 9, 10], 'Itt találkozhattál velünk').layout,
    ).toBeNull()
    expect(
      tervezdSajtoLogosorBovitest(layout, [7, 8, 9, 10, 11, 12, 13], 'Itt találkozhattál velünk')
        .layout,
    ).toBeNull()
    expect(tervezdSajtoLogosorBovitest(layout, [7], 'Más felirat').layout).toBeNull()
    expect(tervezdSajtoLogosorBovitest([], [7], 'Itt találkozhattál velünk').layout).toBeNull()
  })
})
