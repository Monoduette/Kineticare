import { createHash } from 'node:crypto'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { ctaBanner } from '../blocks/cta-banner'
import { KEP_CSERE_SUGO } from '../blocks/kep-csere'
import { CtaBanner, ctaBannerCoverAlt } from '../components/blocks/CtaBanner'
import { RenderBlocks } from '../components/blocks/RenderBlocks'
import {
  ctaBannerFigura,
  resolveCtaBannerFigure,
  rolunkCtaMontazs,
  type CtaBannerCourseCover,
} from '../lib/cta-banner-course'
import type { BlockCtaBanner, Media, Page, Product } from '../payload-types'

/**
 * H28: a Gombos kiemelő sáv (ctaBanner) „Kép” mezője.
 *
 * Szerződés:
 *  - a mező nem kötelező `upload` a Képekre, a `text` után áll, a súgója a
 *    kód valódi sorrendjét mondja, és a közös képcsere-mondattal zárul;
 *  - FELTÖLTÖTT kép → a figure a feltöltött médiát mutatja, a saját
 *    képleírásával, link nélkül;
 *  - ÜRES kép → a kimenet BÁJTRA a mező bevezetése előtti render. A lenti
 *    SHA-256 lenyomatokat a változtatás előtti CtaBanner.tsx és
 *    cta-banner-course.ts (git HEAD e9f80bc) renderelte ugyanezekből a
 *    fixture-ökből (2026-09-23), így a teszt a régi kimenettel vet össze,
 *    nem az újjal önmagát. Ha a next/image kimenete verzióváltáskor
 *    megváltozik, a lenyomatokat a régi komponensből kell újraképezni.
 *
 * DB és hálózat nélkül: egy `payload` import hangosan bukik.
 */

vi.mock('payload', () => {
  throw new Error('A CTA-sáv nem kérdezhet le: a lap adataiból dolgozik.')
})

function media(id: number, alt: string): Media {
  return {
    id,
    alt,
    url: `/media/kurzus-${id}.jpg`,
    width: 1600,
    height: 1200,
    sizes: {
      xs: { url: `/media/kurzus-${id}-320.jpg`, width: 320, height: 240 },
      sm: { url: `/media/kurzus-${id}-640.jpg`, width: 640, height: 480 },
      md: { url: `/media/kurzus-${id}-1280.jpg`, width: 1280, height: 960 },
    },
    updatedAt: '',
    createdAt: '',
  } as unknown as Media
}

function product(id: number, slug: string, sku: string, cover: Media | null): Product {
  return {
    id,
    sku,
    slug,
    shortDescription: 'Otthon végezhető program.',
    coverImage: cover,
    priceInHUF: 19990,
    priceInHUFEnabled: true,
    status: 'published',
    _status: 'published',
    updatedAt: '',
    createdAt: '',
  } as unknown as Product
}

const PROGRAM = product(
  1,
  'otthoni-kezrehab-program',
  'Otthoni kézrehab program',
  media(1, 'Gyógytornász kézgyakorlatot mutat'),
)
const ALT_NELKUL = product(2, 'alt-nelkuli-kurzus', 'Alt nélküli kurzus', media(2, ''))
const TERMEKEK = [PROGRAM, ALT_NELKUL]

/** A szerkesztő által feltöltött kép (nem kurzus-borító). */
const FELTOLTOTT = {
  ...media(40, 'Két kéz gyurmát formáz az asztalon.'),
  url: '/media/sajat-sav-kep.jpg',
  sizes: {
    sm: { url: '/media/sajat-sav-kep-640.jpg', width: 640, height: 427 },
  },
} as unknown as Media

function sav(id: string, url: string, extra: Partial<BlockCtaBanner> = {}): BlockCtaBanner {
  return {
    id,
    blockType: 'ctaBanner',
    title: 'Kezdd el még ma',
    text: 'Otthon, a saját tempódban.',
    cta: { felirat: 'Nézd meg a kurzusokat', url, ujAblakban: false },
    sectionSettings: { visible: true, hatter: 'tint' },
    ...extra,
  } as BlockCtaBanner
}

/** A változtatás előtti render lenyomata esetenként (lásd a fejkommentet). */
const ESETEK: Array<{
  nev: string
  block: BlockCtaBanner
  montazs: boolean
  sha256: string
  hossz: number
}> = [
  {
    nev: 'kurzuslista: az első fizetős kurzus borítója',
    block: sav('cta-lista', '/kurzusok'),
    montazs: false,
    sha256: '2ccdb3858d34e2b9986b45bca2fd82ed83fa460994b9e7e865164d3585c7edeb',
    hossz: 1557,
  },
  {
    nev: 'egy kurzus borítója (query és horgony mellett)',
    block: sav('cta-kurzus', '/kurzusok/otthoni-kezrehab-program?utm=x#kurzus-vasarlas-gomb'),
    montazs: false,
    sha256: '8837437f4de44bac46863b38fa5f90570f93b75bd72f111dfc2584b84ef3e489',
    hossz: 1611,
  },
  {
    nev: 'alt nélküli borító: „<kurzus> borítóképe” tartalék',
    block: sav('cta-alt', '/kurzusok/alt-nelkuli-kurzus'),
    montazs: false,
    sha256: '205b649dea8bb0d517785c57c41a6b712d98d9ce52b3afccc006b05dd04d0e99',
    hossz: 1568,
  },
  {
    nev: 'a /rolunk kurzus-montázsa',
    block: sav('cta-rolunk', '/kurzusok', { title: 'Kezdd el otthon, a saját tempódban' }),
    montazs: true,
    sha256: 'e4b9969e09b8c72d9261dd11cbb17dfe7c39254a968273ac75ac10d2f3da2bc7',
    hossz: 1906,
  },
  {
    nev: 'nem kurzus-cél: kép nélkül',
    block: sav('cta-kapcsolat', '/kapcsolat', { title: 'Kérdésed van?' }),
    montazs: false,
    sha256: 'c0835ce1554660470341f78e5e855b4c52119674b80de55c053cd02d6c9424b3',
    hossz: 483,
  },
  {
    nev: 'sötét sáv, külső cél, új lapon',
    block: sav('cta-kulso', 'https://example.invalid/workshop', {
      cta: {
        felirat: 'Nézd meg a kézworkshopot',
        url: 'https://example.invalid/workshop',
        ujAblakban: true,
      },
      sectionSettings: { visible: true, hatter: 'sotet' },
    }),
    montazs: false,
    sha256: '73ab5721d19a19cc3f00be9ec15d256cbed82a956b1885e9db448cb2fcf7e5e1',
    hossz: 544,
  },
]

function szamitott(block: BlockCtaBanner, montazs: boolean): CtaBannerCourseCover | null {
  return resolveCtaBannerFigure(block.cta?.url, TERMEKEK, montazs ? rolunkCtaMontazs() : null)
}

function render(block: BlockCtaBanner, courseCover: CtaBannerCourseCover | null): string {
  return renderToStaticMarkup(createElement(CtaBanner, { block, courseCover }))
}

function sha256(szoveg: string): string {
  return createHash('sha256').update(szoveg).digest('hex')
}

describe('ctaBanner séma: a „Kép” mező (H28)', () => {
  const nevek = ctaBanner.fields.map((field) => ('name' in field ? field.name : field.type))

  it('nem kötelező upload a Képekre, közvetlenül a `text` után', () => {
    const kep = ctaBanner.fields.find((field) => 'name' in field && field.name === 'kep')
    expect(kep).toMatchObject({ type: 'upload', relationTo: 'media', label: 'Kép' })
    expect(kep && 'required' in kep ? kep.required : undefined).toBeFalsy()
    expect(nevek.indexOf('kep')).toBe(nevek.indexOf('text') + 1)
  })

  it('a súgó a kód sorrendjét mondja, és a közös képcsere-mondattal zárul', () => {
    const kep = ctaBanner.fields.find((field) => 'name' in field && field.name === 'kep')
    const leiras = kep?.admin && 'description' in kep.admin ? kep.admin.description : undefined
    expect(typeof leiras).toBe('string')
    const szoveg = String(leiras)
    expect(szoveg.startsWith('Nem kötelező. Ha feltöltesz képet, ez látszik a sávban.')).toBe(true)
    expect(szoveg).toContain(
      'Ha üresen hagyod és a gomb egy kurzusra vagy a kurzuslistára visz, a kurzus borítója látszik (a Rólunk oldalon a kurzus-montázs); más gombcélnál a sáv kép nélkül jelenik meg.',
    )
    expect(szoveg.endsWith(KEP_CSERE_SUGO)).toBe(true)
    expect(szoveg).not.toMatch(/—|\s–\s|\s-\s|"|“|\.\.\./u)
  })
})

describe('ctaBannerFigura: a feltöltött kép elsőbbsége', () => {
  const borito = szamitott(sav('x', '/kurzusok'), false)

  it('populált, url-es média → az nyer, feltöltöttként jelölve', () => {
    expect(borito).not.toBeNull()
    const figura = ctaBannerFigura(FELTOLTOTT, borito)
    expect(figura?.media).toBe(FELTOLTOTT)
    expect(figura?.feltoltott).toBe(true)
  })

  it('üres, null, csak id (nem populált) vagy url nélküli média → a számított érték változatlanul', () => {
    for (const kep of [undefined, null, 40, '40', { id: 40, alt: 'x' }]) {
      expect(ctaBannerFigura(kep, borito)).toBe(borito)
      expect(ctaBannerFigura(kep, null)).toBeNull()
    }
  })

  it('számított kép nélkül (nem kurzus-cél) is megjelenik a feltöltött kép', () => {
    const figura = ctaBannerFigura(FELTOLTOTT, null)
    expect(figura?.media).toBe(FELTOLTOTT)
  })

  it('alt: feltöltött képnél csak a saját képleírás, kitalált „borítóképe” tartalék nélkül', () => {
    const sajat = ctaBannerFigura(FELTOLTOTT, borito)
    expect(sajat && ctaBannerCoverAlt(sajat)).toBe('Két kéz gyurmát formáz az asztalon.')
    const uresAlt = ctaBannerFigura({ ...FELTOLTOTT, alt: '' }, borito)
    expect(uresAlt && ctaBannerCoverAlt(uresAlt)).toBe('')
  })
})

describe('CtaBanner: feltöltött kép a sávban', () => {
  it('a figure a feltöltött médiát mutatja, a borító helyett, link nélkül', () => {
    const block = { ...sav('cta-sajat', '/kurzusok'), kep: FELTOLTOTT } as BlockCtaBanner
    const html = render(block, szamitott(block, false))
    expect(html).toContain('kc-cta-banner__inner--illustrated')
    expect(html).toContain('sajat-sav-kep-640.jpg')
    expect(html).not.toContain('kurzus-1-640.jpg')
    expect(html).toContain('alt="Két kéz gyurmát formáz az asztalon."')
    const figure = html.slice(html.indexOf('<figure'), html.indexOf('</figure>'))
    expect(figure).not.toContain('<a ')
    expect(html.match(/<a /g)).toHaveLength(1)
  })

  it('a feltöltött kép a /rolunk montázsát is megelőzi', () => {
    const block = {
      ...sav('cta-rolunk', '/kurzusok'),
      kep: FELTOLTOTT,
    } as BlockCtaBanner
    const html = render(block, szamitott(block, true))
    expect(html).toContain('sajat-sav-kep-640.jpg')
    expect(html).not.toContain('course-montage-rolunk')
  })

  it('nem kurzus-célú sávban is megjelenik, ha feltöltötték', () => {
    const block = { ...sav('cta-kapcsolat', '/kapcsolat'), kep: FELTOLTOTT } as BlockCtaBanner
    const html = render(block, szamitott(block, false))
    expect(html).toContain('<figure class="kc-cta-banner__figure">')
    expect(html).toContain('sajat-sav-kep-640.jpg')
  })

  it('üres képleírású feltöltött kép dekoratív (alt="")', () => {
    const block = {
      ...sav('cta-dekor', '/kapcsolat'),
      kep: { ...FELTOLTOTT, alt: '' },
    } as BlockCtaBanner
    const html = render(block, null)
    expect(html).toContain('alt=""')
    expect(html).not.toContain('borítóképe')
  })

  it('a RenderBlocks a populált `kep`-et változatlanul átadja, a sáv azt mutatja', () => {
    const block = { ...sav('cta-rb', '/kurzusok'), kep: FELTOLTOTT } as BlockCtaBanner
    const html = renderToStaticMarkup(
      createElement(RenderBlocks, {
        layout: [block] as NonNullable<Page['layout']>,
        products: TERMEKEK,
        posts: [],
        testimonials: [],
      }),
    )
    expect(html).toContain('sajat-sav-kep-640.jpg')
    expect(html).not.toContain('kurzus-1-640.jpg')
  })
})

describe('CtaBanner: üres „Kép” mező mellett bájtra a korábbi kimenet', () => {
  it.each(ESETEK)('$nev', ({ block, montazs, sha256: vart, hossz }) => {
    const cover = szamitott(block, montazs)
    for (const kep of [undefined, null, 17]) {
      const html = render({ ...block, kep } as BlockCtaBanner, cover)
      expect(html.length).toBe(hossz)
      expect(sha256(html)).toBe(vart)
    }
  })
})
