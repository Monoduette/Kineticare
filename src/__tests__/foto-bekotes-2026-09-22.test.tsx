import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { renderToStaticMarkup } from 'react-dom/server'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import teamManifest from '../../public/media/team/manifest.json'
import { Media } from '../collections/Media'
import { PhotoFrieze } from '../components/blocks/PhotoFrieze'
import { Services } from '../components/blocks/Services'
import { TeamMembers } from '../components/blocks/TeamMembers'
import { CourseShowcase } from '../components/content/home/CourseShowcase'
import { COURSE_SHOWCASE_SCENE_PHOTOS } from '../lib/course-showcase'
import {
  HOME_HELP_PHOTOS,
  HOME_HELP_PHOTO_FILES,
  HOME_HELP_PUBLIC_DIR,
  HOME_HELP_TITLE,
  LEGACY_HOME_HELP_PHOTO_FILES,
  LEGACY_HOME_HELP_ROWS,
  SZOLGALTATASOK_KEZELES_FOTO,
  homeHelpFallbackMedia,
  presentHomeLayout,
  presentSzolgaltatasokLayout,
} from '../lib/home-help-states'
import { HOME_IMAGES, mediaCreateData } from '../lib/home-seed'
import { buildMediaSourceIndex } from '../lib/media-restore'
import type { BlockServices, BlockTeamMembers, Page, Product } from '../payload-types'

/**
 * 2026-09-22, tulajdonosi kérés: az új fotók „mindenhol”. Ez az őr a
 * BEKÖTÉST méri, a fájlokból (sharp, sha256) és a renderelt markupból, nem a
 * kommentekből:
 *  - a háromajtós sín ajtónkénti képe a kezdőlapon, a /szolgaltatasokon (az
 *    1. ajtón is) és a seedben, a kép mért fókuszpontjával;
 *  - a fríz négy íve, ívenkénti vágással;
 *  - a Kurzusaink-jelenet bal és jobb cellája;
 *  - a vágások geometriája: `object-fit: cover` mellett a kép lényege a mért
 *    kereteken (élő oldal, Chromium, 2026-09-22) bent marad;
 *  - Kocsis Kata CV-fotója a szakemberkártyán felskálázás nélkül jelenik meg
 *    (DPR 3-as telefonon is).
 * Adatbázis és hálózat nélkül fut.
 */

const REPO = fileURLToPath(new URL('../..', import.meta.url))
const sha256 = (relativ: string): string =>
  createHash('sha256')
    .update(readFileSync(join(REPO, relativ)))
    .digest('hex')

const manifestAsset = (file: string) => teamManifest.assets.find((asset) => asset.file === file)

type Meret = { w: number; h: number }

/**
 * `object-fit: cover` + `object-position: X% Y%`: a keretben látható
 * forrás-sáv forráspixelben (W3C CSS Images 3: a <position> a konkrét
 * objektumméret és a doboz különbségén oldódik fel).
 */
const coverSav = (forras: Meret, keret: Meret, poz: readonly [number, number]) => {
  const arany = Math.max(keret.w / forras.w, keret.h / forras.h)
  const w = keret.w / arany
  const h = keret.h / arany
  const x0 = ((forras.w - w) * poz[0]) / 100
  const y0 = ((forras.h - h) * poz[1]) / 100
  return { x0, x1: x0 + w, y0, y1: y0 + h, arany }
}

const bent = (sav: { a0: number; a1: number }, tartomany: readonly [number, number]): boolean =>
  sav.a0 <= tartomany[0] && tartomany[1] <= sav.a1

const pozicio = (ertek: string): [number, number] => {
  const [x, y] = ertek.split(' ').map((resz) => Number.parseFloat(resz))
  return [x ?? 50, y ?? 50]
}

// ---------------------------------------------------------------------------
// 1. A háromajtós sín
// ---------------------------------------------------------------------------

describe('a sín ajtónkénti fotói: fájlok', () => {
  it('mindhárom kép 933×1400-as, metaadat nélküli JPEG, a tartalék és a seed-másolat bájtra azonos', async () => {
    for (const foto of HOME_HELP_PHOTOS) {
      const publikus = `public/media/help-rail/${foto.file}`
      const seed = `content/home-images/brand/${foto.file}`
      expect(existsSync(join(REPO, publikus)), publikus).toBe(true)
      expect(sha256(publikus), foto.file).toBe(sha256(seed))
      const meta = await sharp(join(REPO, publikus)).metadata()
      expect([meta.format, meta.width, meta.height], foto.file).toEqual([
        'jpeg',
        foto.width,
        foto.height,
      ])
      expect([foto.width, foto.height]).toEqual([933, 1400])
      // sRGB, beágyazott profil és EXIF nélkül (a böngésző sRGB-nek veszi).
      expect(meta.icc, foto.file).toBeUndefined()
      expect(meta.exif, foto.file).toBeUndefined()
      expect(meta.chromaSubsampling, foto.file).toBe('4:4:4')
      expect(meta.isProgressive, foto.file).toBe(true)
    }
  })

  it('az alt-ok leírják a képet, natív magyarul, gondolatjel és „kép/fotó” szó nélkül', () => {
    expect(HOME_HELP_PHOTOS.map((foto) => foto.alt)).toEqual([
      'Gyógytornász kék gumiszalagot feszít a páciens csuklóján.',
      'Kocsis Kata és Kiss Kata a videókurzus stúdiójában.',
      'Táblagépen a kéz izmai, inai és idegei, a toll a csuklóra mutat.',
    ])
    for (const foto of HOME_HELP_PHOTOS) {
      expect(foto.alt).not.toMatch(/[–—]/)
      expect(foto.alt).not.toMatch(/\b(kép|fotó)/i)
    }
  })

  it('a régi portrék a seed-mappában maradnak, a Volume-helyreállítás forrásaként', () => {
    const index = buildMediaSourceIndex()
    for (const file of [...LEGACY_HOME_HELP_PHOTO_FILES, ...HOME_HELP_PHOTO_FILES]) {
      const torzs = file.replace(/\.[^.]+$/, '')
      expect(index.get(torzs), file).toBe(join(REPO, 'content/home-images/brand', file))
    }
  })

  it('a seed az új képeket a kód alt-jával és fókuszpontjával tölti fel', () => {
    for (const foto of HOME_HELP_PHOTOS) {
      const seed = HOME_IMAGES.find((image) => image.file === foto.file)
      expect(seed, foto.file).toEqual({
        file: foto.file,
        dir: 'brand',
        alt: foto.alt,
        focalX: foto.focalX,
        focalY: foto.focalY,
      })
      expect(mediaCreateData(seed ?? { alt: '' })).toEqual({
        alt: foto.alt,
        focalX: foto.focalX,
        focalY: foto.focalY,
      })
    }
    // Fókuszpont nélküli seed-kép: csak az alt (a séma 50/50-e marad).
    expect(mediaCreateData({ alt: 'Logó' })).toEqual({ alt: 'Logó' })
  })
})

describe('a sín ajtónkénti fotói: bekötés', () => {
  it('a tartalék Media ajtónként a saját képet, a valós méretet és a mért fókuszpontot viszi', () => {
    expect(
      HOME_HELP_PHOTOS.map((_, index) => {
        const media = homeHelpFallbackMedia(index)
        return [media.url, media.mimeType, media.width, media.height, media.focalX, media.focalY]
      }),
    ).toEqual([
      ['/media/help-rail/help-rendelo-szalag.jpg', 'image/jpeg', 933, 1400, 50, 40],
      ['/media/help-rail/help-otthoni-video.jpg', 'image/jpeg', 933, 1400, 50, 20],
      ['/media/help-rail/help-szakmai-tablet.jpg', 'image/jpeg', 933, 1400, 50, 15],
    ])
    expect(() => homeHelpFallbackMedia(3)).toThrow()
  })

  it('a /szolgaltatasok 1. ajtaja is a sín rendelői képe (a WP54-es döntést a tulajdonos felülírta)', () => {
    expect(SZOLGALTATASOK_KEZELES_FOTO).toEqual(homeHelpFallbackMedia(0))
    // Az élő /szolgaltatasok ajtó-blokkja (mérve 2026-09-22): üres fotók, a
    // 2. sor címe egyedi, az ajtót az URL-je azonosítja.
    const elo = [
      {
        blockType: 'services',
        title: 'Így segítünk',
        elrendezes: 'tabla',
        rows: [
          {
            title: 'Rendelői kezelések',
            felirat: 'Időpontot kérek',
            url: '/kapcsolat',
            photo: null,
          },
          {
            title: 'Otthoni online program',
            felirat: 'Megnézem a kurzust',
            url: '/kurzusok/otthoni-kezrehab-program',
            photo: null,
          },
          {
            title: 'Szakmai képzések',
            felirat: 'Tovább a képzésre',
            url: 'https://probodystudio.hu/kez-workshop/',
            photo: null,
          },
        ],
      },
    ] as unknown as NonNullable<Page['layout']>
    const [sin] = presentSzolgaltatasokLayout(elo)
    if (sin?.blockType !== 'services') throw new Error('nincs services blokk')
    expect(
      sin.rows?.map((sor) => (typeof sor.photo === 'object' && sor.photo ? sor.photo.url : null)),
    ).toEqual(HOME_HELP_PHOTO_FILES.map((file) => `${HOME_HELP_PUBLIC_DIR}/${file}`))
  })

  it('a kezdőlap mentett táblás hármasa (üres fotók) sínként a három új képet kapja', () => {
    const elo = [
      {
        id: 'help',
        blockType: 'services',
        title: HOME_HELP_TITLE,
        elrendezes: 'tabla',
        rows: LEGACY_HOME_HELP_ROWS.map((sor) => ({ ...sor, photo: null })),
        sectionSettings: { visible: true },
      },
    ] as unknown as NonNullable<Page['layout']>
    const [sin] = presentHomeLayout(elo)
    if (sin?.blockType !== 'services') throw new Error('nincs services blokk')
    expect(sin.elrendezes).toBe('sin')
    expect(
      sin.rows?.map((sor) => (typeof sor.photo === 'object' && sor.photo ? sor.photo.url : null)),
    ).toEqual(HOME_HELP_PHOTO_FILES.map((file) => `${HOME_HELP_PUBLIC_DIR}/${file}`))
  })

  it('a panel-fotó a kép fókuszpontját kapja vágásként; fókuszpont nélküli CMS-képnél 50% 50%', () => {
    const [sin] = presentHomeLayout([
      {
        id: 'help',
        blockType: 'services',
        title: HOME_HELP_TITLE,
        rows: LEGACY_HOME_HELP_ROWS.map((sor, index) =>
          index === 2
            ? {
                ...sor,
                photo: {
                  id: 9,
                  url: '/api/media/file/sajat.webp',
                  alt: 'Saját',
                  width: 800,
                  height: 1200,
                },
              }
            : { ...sor, photo: null },
        ),
        sectionSettings: { visible: true },
      },
    ] as unknown as NonNullable<Page['layout']>)
    const html = renderToStaticMarkup(<Services block={sin as BlockServices} />)
    const fotok = [...html.matchAll(/<span class="kc-services-sin__photo" style="([^"]*)"/g)].map(
      (talalat) => talalat[1],
    )
    expect(fotok).toEqual([
      '--kc-services-image-focus:50% 40%',
      '--kc-services-image-focus:50% 20%',
      '--kc-services-image-focus:50% 50%',
    ])
    const css = readFileSync(
      join(REPO, 'src/app/(frontend)/styles/blocks/services-sin.css'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '')
    expect(css).toMatch(
      /\.kc-services-sin__photo img\s*\{[^}]*object-fit: cover;[^}]*object-position: var\(--kc-services-image-focus, 50% 50%\);/,
    )
  })

  it('geometria: a kép lényege a mért panel-kereteken (4:5 asztalon, 1:1 mobilon) bent marad', () => {
    // Élő oldal, Chromium, 2026-09-22 (.kc-services-sin__photo, CSS px).
    const keretek: Meret[] = [
      { w: 326.78, h: 408.47 },
      { w: 204.19, h: 255.23 },
      { w: 276, h: 276 },
      { w: 206, h: 206 },
    ]
    // A lényeg függőleges sávja forráspixelben (1400 magas képen, rácsos
    // átfedéssel mérve): a rendelőn a hüvelykujj hegyétől (y 258) a húzó ököl
    // aljáig (y 1100); az otthoni képen a bal fej tetejétől (y 155) az
    // összekulcsolt kezekig (y 1000); a táblagépen a tok felső sarkától
    // (y 108) az aljáig (y 958).
    const lenyeg: readonly (readonly [number, number])[] = [
      [258, 1100],
      [155, 1000],
      [108, 958],
    ]
    for (const [index, foto] of HOME_HELP_PHOTOS.entries()) {
      for (const keret of keretek) {
        const sav = coverSav({ w: foto.width, h: foto.height }, keret, [foto.focalX, foto.focalY])
        const tartomany = lenyeg[index] ?? [0, 0]
        expect(
          bent({ a0: sav.y0, a1: sav.y1 }, tartomany),
          `${foto.file} ${keret.w}×${keret.h}: y ${sav.y0.toFixed(0)}–${sav.y1.toFixed(0)}`,
        ).toBe(true)
      }
    }
    // Az 50% 50%-os középre vágás 1:1-ben levágná az otthoni képen a fejek
    // tetejét és a táblagép felső sarkát: ezért kell a fókuszpont.
    const kozep = coverSav({ w: 933, h: 1400 }, { w: 276, h: 276 }, [50, 50])
    expect(kozep.y0).toBeGreaterThan(155)
    expect(kozep.y0).toBeGreaterThan(108)
  })
})

// ---------------------------------------------------------------------------
// 2. A fríz
// ---------------------------------------------------------------------------

const frizMarkup = renderToStaticMarkup(<PhotoFrieze />)
const frizCsikok = [
  ...frizMarkup.matchAll(
    /<li class="kc-photo-frieze__strip"[^>]*style="([^"]*)"[^>]*>([\s\S]*?)<\/li>/g,
  ),
].map((talalat) => {
  const stilus = talalat[1] ?? ''
  const img = talalat[2] ?? ''
  const fajl = /url=%2Fmedia%2Fteam%2F([a-z0-9-]+\.webp)/.exec(img)?.[1] ?? ''
  const vagas = /--kc-frieze-focus:([^;"]+)/.exec(stilus)?.[1] ?? ''
  const width = Number(/width="(\d+)"/.exec(img)?.[1])
  const height = Number(/height="(\d+)"/.exec(img)?.[1])
  return { fajl, vagas, width, height }
})

describe('a fríz négy íve', () => {
  it('a fájlok a lemezen vannak, a méret a fájl valós mérete, a sha256 a manifesté', async () => {
    expect(frizCsikok.map((csik) => csik.fajl)).toEqual([
      'founders-white-turtleneck-1600.webp',
      'tablet-forearm-anatomy-1600.webp',
      'goniometer-elbow-measure-1388.webp',
      'founders-working-laptop-1600.webp',
    ])
    for (const csik of frizCsikok) {
      const relativ = `public/media/team/${csik.fajl}`
      const meta = await sharp(join(REPO, relativ)).metadata()
      expect([meta.width, meta.height], csik.fajl).toEqual([csik.width, csik.height])
      const asset = manifestAsset(csik.fajl)
      expect(asset?.sha256, csik.fajl).toBe(sha256(relativ))
      expect([asset?.width, asset?.height], csik.fajl).toEqual([csik.width, csik.height])
    }
  })

  it('geometria: ívenként a lényeg a mért kereteken bent marad', () => {
    // Élő oldal (2026-09-22): a csík mérete és benne a kép doboza (115%).
    const keretek = {
      1440: { csik: { w: 306, h: 296.33 }, kep: { w: 306, h: 340.77 } },
      1200: { csik: { w: 251.3, h: 337.34 }, kep: { w: 251.3, h: 387.94 } },
      1024: { csik: { w: 215.22, h: 272 }, kep: { w: 215.22, h: 312.8 } },
      900: { csik: { w: 186.97, h: 272 }, kep: { w: 186.97, h: 312.8 } },
      390: { csik: { w: 100.67, h: 288 }, kep: { w: 100.67, h: 331.19 } },
      320: { csik: { w: 77.33, h: 288 }, kep: { w: 77.33, h: 331.19 } },
    } as const
    type Szelesseg = keyof typeof keretek
    /** Nyugalmi helyzetben a csík a kép-doboz tetejét mutatja. */
    const lathato = (index: number, szelesseg: Szelesseg) => {
      const csik = frizCsikok[index]
      if (!csik) throw new Error('hiányzó ív')
      const keret = keretek[szelesseg]
      const sav = coverSav({ w: csik.width, h: csik.height }, keret.kep, pozicio(csik.vagas))
      return {
        x: { a0: sav.x0, a1: sav.x1 },
        y: { a0: sav.y0, a1: sav.y0 + keret.csik.h / sav.arany },
      }
    }
    // 1. A két arc (x 243–1333) minden asztali szélességen; mobilon a csík elmarad.
    for (const szelesseg of [1440, 1200, 1024, 900] as const) {
      expect(bent(lathato(0, szelesseg).x, [243, 1333]), `garbó ${szelesseg}`).toBe(true)
    }
    // 2. A táblagép (y 210–1650) 1440-en.
    expect(bent(lathato(1, 1440).y, [210, 1650])).toBe(true)
    // 3. A mérőkorong (x 815–1105, y 1243–1528) minden szélességen; mobilon
    // mellette az alsó kéz hüvelykujja (x 725–830) is, 1440-en a felső kéz
    // teteje (y 411) is bent van.
    for (const szelesseg of [1440, 1200, 1024, 900, 390, 320] as const) {
      const sav = lathato(2, szelesseg)
      expect(bent(sav.x, [815, 1105]), `goniométer x ${szelesseg}`).toBe(true)
      expect(bent(sav.y, [1243, 1528]), `goniométer y ${szelesseg}`).toBe(true)
    }
    for (const szelesseg of [390, 320] as const) {
      expect(bent(lathato(2, szelesseg).x, [725, 830]), `hüvelykujj ${szelesseg}`).toBe(true)
    }
    expect(lathato(2, 1440).y.a0).toBeLessThanOrEqual(411)
    // Az alapértelmezett 50% 20% mobilon a korongot kettévágná: ezért kell a
    // saját vágás.
    const csik = frizCsikok[2]
    for (const szelesseg of [390, 320] as const) {
      const alap = coverSav(
        { w: csik?.width ?? 0, h: csik?.height ?? 0 },
        keretek[szelesseg].kep,
        [50, 20],
      )
      expect(bent({ a0: alap.x0, a1: alap.x1 }, [815, 1105]), `50% 20% ${szelesseg}`).toBe(false)
    }
    // 4. A két arc bőrtől bőrig (x 575–1130) mobilon is.
    for (const szelesseg of [390, 320] as const) {
      expect(bent(lathato(3, szelesseg).x, [575, 1130]), `laptop ${szelesseg}`).toBe(true)
    }
    // Felskálázás nincs: a mesterfájl egy forráspixelére asztalon DPR 2-n,
    // mobilon DPR 3-on is legfeljebb egy eszközpixel jut (az 1. ív mobilon
    // elmarad).
    for (const [index, csik] of frizCsikok.entries()) {
      for (const szelesseg of [1440, 1200, 1024, 900, 390, 320] as const) {
        if (index === 0 && szelesseg < 900) continue
        const dpr = szelesseg < 900 ? 3 : 2
        const sav = coverSav({ w: csik.width, h: csik.height }, keretek[szelesseg].kep, [50, 50])
        expect(sav.arany * dpr, `${csik.fajl} ${szelesseg}`).toBeLessThanOrEqual(1)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// 3. A Kurzusaink-jelenet
// ---------------------------------------------------------------------------

describe('a Kurzusaink-jelenet', () => {
  it('bal és jobb cella az új gyakorlat-képek, a közép marad; a fájlok a manifest szerint', async () => {
    expect(COURSE_SHOWCASE_SCENE_PHOTOS.map((kep) => kep.src)).toEqual([
      '/media/team/showcase-kiss-kata-labda-800.webp',
      '/media/team/home-exercise-ball-towel-800.webp',
      '/media/team/showcase-kocsis-kata-bogre-800.webp',
    ])
    for (const kep of COURSE_SHOWCASE_SCENE_PHOTOS) {
      const meta = await sharp(join(REPO, 'public', kep.src)).metadata()
      expect([meta.width, meta.height], kep.src).toEqual([kep.width, kep.height])
    }
    for (const kep of [COURSE_SHOWCASE_SCENE_PHOTOS[0], COURSE_SHOWCASE_SCENE_PHOTOS[2]]) {
      const fajl = kep?.src.replace('/media/team/', '') ?? ''
      const asset = manifestAsset(fajl)
      expect(asset?.sha256, fajl).toBe(sha256(`public${kep?.src ?? ''}`))
      expect([asset?.width, asset?.height], fajl).toEqual([kep?.width, kep?.height])
    }
  })

  it('a jelenet dekoratív: aria-hidden, a cellák alt="" (a leírás a manifestben él)', () => {
    const products = [1, 2, 3].map(
      (id) =>
        ({
          id,
          title: `Teszt kurzus ${id}`,
          slug: `teszt-kurzus-${id}`,
          priceInHUF: 19900,
          audience: 'home',
        }) as unknown as Product,
    )
    const html = renderToStaticMarkup(<CourseShowcase products={products} />)
    const jelenet =
      /<div aria-hidden="true" class="kc-course-showcase__scene">[\s\S]*?<\/div>/.exec(html)?.[0]
    for (const kep of COURSE_SHOWCASE_SCENE_PHOTOS) {
      expect(jelenet).toContain(`alt="" class="kc-course-showcase__photo"`)
      expect(jelenet).toContain(`src="${kep.src}"`)
    }
  })

  it('geometria: a 4:3 cella 25% 50%-os ablaka (x 22–733) a középső kép ujjhegyeit (x 33) is megtartja', () => {
    for (const kep of COURSE_SHOWCASE_SCENE_PHOTOS) {
      const sav = coverSav({ w: kep.width, h: kep.height }, { w: 4, h: 3 }, [25, 50])
      expect(Math.round(sav.x0), kep.src).toBe(22)
      expect(Math.round(sav.x1), kep.src).toBe(733)
    }
    const kozep = coverSav({ w: 800, h: 533 }, { w: 4, h: 3 }, [50, 50])
    expect(kozep.x0).toBeGreaterThan(33)
  })
})

// ---------------------------------------------------------------------------
// 4. Kocsis Kata CV-fotója a szakemberkártyán
// ---------------------------------------------------------------------------

describe('a szakemberkártya fotója', () => {
  /** A Médiatár Payload-mérete a valós fájlból (`withoutEnlargement`: legfeljebb az eredeti). */
  const payloadMeret = (nev: string, eredeti: Meret): Meret => {
    const upload = Media.upload
    const meretek = typeof upload === 'object' ? (upload.imageSizes ?? []) : []
    const beallitas = meretek.find((meret) => meret.name === nev)
    if (typeof beallitas?.width !== 'number') throw new Error(`nincs ${nev} méret`)
    const w = Math.min(beallitas.width, eredeti.w)
    return { w, h: Math.round((eredeti.h * w) / eredeti.w) }
  }

  /** A `sizes` attribútum slotja az adott nézetszélességen (csak `max-width` + px alak). */
  const slot = (sizes: string, nezet: number): number => {
    for (const resz of sizes.split(',').map((elem) => elem.trim())) {
      const feltetel = /^\(max-width:\s*(\d+)px\)\s+(\d+)px$/.exec(resz)
      if (feltetel) {
        if (nezet <= Number(feltetel[1])) return Number(feltetel[2])
        continue
      }
      const alap = /^(\d+)px$/.exec(resz)
      if (alap) return Number(alap[1])
      throw new Error(`ismeretlen sizes-tag: ${resz}`)
    }
    throw new Error('a sizes-nek nincs alapértéke')
  }

  it('DPR 3-as telefonon is legfeljebb egy eszközpixel jut egy forráspixelre (nincs felskálázás)', async () => {
    const asset = teamManifest.assets.find((elem) => elem.role === 'cv-kocsis-kata')
    if (asset === undefined) throw new Error('hiányzó manifest-bejegyzés')
    const fajl = await sharp(join(REPO, 'public/media/team', asset.file)).metadata()
    const eredeti = { w: fajl.width ?? 0, h: fajl.height ?? 0 }
    expect([eredeti.w, eredeti.h]).toEqual([asset.width, asset.height])
    const torzs = asset.file.replace(/\.webp$/, '')
    const valtozat = (nev: string) => {
      const meret = payloadMeret(nev, eredeti)
      return {
        url: `/api/media/file/${torzs}-${meret.w}x${meret.h}.webp`,
        width: meret.w,
        height: meret.h,
      }
    }
    const media = {
      id: 56,
      url: `/api/media/file/${asset.file}`,
      width: eredeti.w,
      height: eredeti.h,
      alt: asset.alt,
      sizes: { xs: valtozat('xs'), sm: valtozat('sm'), md: valtozat('md'), lg: valtozat('lg') },
    }
    const forrasSzelesseg = new Map<string, number>([
      [media.url, media.width],
      ...Object.values(media.sizes).map((meret): [string, number] => [meret.url, meret.width]),
    ])
    const block = {
      blockType: 'teamMembers',
      members: [{ id: 'm1', name: 'Kocsis Kata', role: 'Gyógytornász', photo: media }],
    } as unknown as BlockTeamMembers
    const html = renderToStaticMarkup(<TeamMembers block={block} />)
    const img = /<figure class="kc-team__figure"><img ([^>]*)\/?>/.exec(html)?.[1] ?? ''
    const attr = (nev: string) =>
      new RegExp(`\\s?${nev}="([^"]*)"`, 'i').exec(` ${img}`)?.[1]?.replaceAll('&amp;', '&') ?? ''
    const sizes = attr('sizes')
    const jeloltek = attr('srcset')
      .split(/,\s+/)
      .map((jelolt) => {
        const [url = '', leiro = ''] = jelolt.split(' ')
        const kert = Number.parseInt(leiro, 10)
        const parameterek = new URL(url, 'https://kineticare.invalid').searchParams
        const forras = parameterek.get('url') ?? url
        const forrasW = forrasSzelesseg.get(forras)
        if (forrasW === undefined) throw new Error(`ismeretlen forrás: ${forras}`)
        // A next/image optimalizálója a forrásnál szélesebbet nem készít.
        return { forras, kert, kiszolgalt: Math.min(kert, forrasW) }
      })
      .sort((a, b) => a.kert - b.kert)
    expect(jeloltek.length).toBeGreaterThan(0)
    // A böngésző a `sizes` slotja alapján VÁLASZT (a slotnál nem kisebb első
    // jelöltet tölti, MDN, Responsive images), a kép viszont a keret MÉRT
    // szélességében jelenik meg (Chromium, 2026-09-22, a /rolunk, a
    // /szolgaltatasok és a /kapcsolat oldalon azonosan): 288 CSS px 1440-en,
    // 1024-en és 390-en, 238 CSS px 320-on.
    for (const [nezet, dpr, keret] of [
      [1440, 2, 288],
      [1024, 2, 288],
      [390, 3, 288],
      [320, 3, 238],
    ] as const) {
      const igeny = slot(sizes, nezet) * dpr
      const valasztott = jeloltek.find((jelolt) => jelolt.kert >= igeny) ?? jeloltek.at(-1)
      expect(
        (keret * dpr) / (valasztott?.kiszolgalt ?? 1),
        `${nezet} px, DPR ${dpr}`,
      ).toBeLessThanOrEqual(1)
    }
    expect(slot(sizes, 390)).toBe(288)
    // A forrás a Médiatár `md` mérete (1280 px), nem az `sm` (640 px).
    expect(new Set(jeloltek.map((jelolt) => jelolt.forras))).toEqual(new Set([media.sizes.md.url]))
    // Érzékenység: az `sm` forrással 390-en DPR 3-on 1,35-szörös nagyítás lenne.
    expect((288 * 3) / valtozat('sm').width).toBeCloseTo(1.35, 2)
  })
})
