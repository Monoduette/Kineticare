import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  BELSO_UJ_LAP_JEGYZET,
  KULSO_UJ_LAP_JEGYZET,
  OfferCards,
  type OfferCardsProps,
} from '../components/blocks/OfferCards'
import type { BlockOfferCards } from '../payload-types'

import { EM_DASH, EN_DASH } from './helpers/cta-mikroszoveg'

/**
 * ŐR — az Ajánlat-kártyák blokk megjelenítése (OfferCards.tsx, modul-térkép
 * H11, A7). Minden mezőkombináció: ikon, kis felirat, tények 0–4, belső és
 * külső cél, új lap, jegyzet üres/kitöltött, „még nem elérhető” állapot,
 * gombsúly, blokk-cím van/nincs (→ címsorszint), id-k egyedisége két blokk
 * esetén is, és a beépített szövegekben nincs töltelék gondolatjel.
 *
 * A tesztkörnyezet `node` (nincs jsdom): a szerver-renderelt kimenetet mérjük.
 */

type Kartya = NonNullable<BlockOfferCards['kartyak']>[number]

function kartya(adat: Partial<Kartya> = {}): Kartya {
  return { cim: 'Ajánlat címe', szoveg: 'Az ajánlat leírása.', ...adat }
}

function blokk(adat: Partial<BlockOfferCards> = {}): BlockOfferCards {
  return { blockType: 'offerCards', id: 'b1', kartyak: [kartya()], ...adat }
}

function render(props: OfferCardsProps): string {
  return renderToStaticMarkup(createElement(OfferCards, props))
}

/** A gomb (`<a class="kc-button …">`) nyitó címkéje. */
function gombTag(html: string): string {
  return /<a([^>]*class="kc-button[^"]*"[^>]*)>/.exec(html)?.[1] ?? ''
}

function szoveg(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

describe('OfferCards: szerkezet és címsorszint', () => {
  it('blokk-cím nélkül a kártya címe H2, nincs blokk-fej és aria-labelledby', () => {
    const html = render({ block: blokk() })
    expect(html).toContain('<h2 class="kc-ajanlat-kartyak__cim">Ajánlat címe</h2>')
    expect(html).not.toContain('<h3')
    expect(html).not.toContain('kc-ajanlat-kartyak__fej')
    expect(html).not.toContain('aria-labelledby')
    expect(html).toMatch(/^<section class="kc-section kc-ajanlat-kartyak">/)
  })

  it('blokk-címmel a blokk H2, a kártyák H3, a szekció a címmel nevezett', () => {
    const html = render({
      block: blokk({ eyebrow: 'Kollégáknak', title: 'Szakmai ajánlatok', lead: 'Két út.' }),
    })
    expect(html).toContain('<h2 class="kc-section-title" id="b1-cim">Szakmai ajánlatok</h2>')
    expect(html).toContain('<h3 class="kc-ajanlat-kartyak__cim">Ajánlat címe</h3>')
    expect(html).toContain('aria-labelledby="b1-cim"')
    expect(html).toContain('<p class="kc-eyebrow">Kollégáknak</p>')
    expect(html).toContain('<p class="kc-section-lead kc-ajanlat-kartyak__lead">Két út.</p>')
  })

  it('csak felső felirat vagy bevezető: blokk-fej H2 nélkül, a kártyák H2-k maradnak', () => {
    const html = render({ block: blokk({ eyebrow: 'Kollégáknak', title: '  ' }) })
    expect(html).toContain('kc-ajanlat-kartyak__fej')
    expect(html).not.toContain('kc-section-title')
    expect(html).toContain('<h2 class="kc-ajanlat-kartyak__cim">')
  })

  it('a kártyák ul/li rácsban, article elemként állnak', () => {
    const html = render({ block: blokk({ kartyak: [kartya(), kartya({ cim: 'Második' })] }) })
    expect(html.match(/<li class="kc-ajanlat-kartyak__cell">/g)).toHaveLength(2)
    expect(html.match(/<article class="kc-card kc-ajanlat-kartyak__card">/g)).toHaveLength(2)
    expect(html).toContain('<ul class="kc-ajanlat-kartyak__grid">')
  })

  it('cím nélküli kártya kimarad; kártya nélkül a blokk semmit nem renderel', () => {
    expect(render({ block: blokk({ kartyak: [kartya({ cim: '  ' })] }) })).toBe('')
    expect(render({ block: blokk({ kartyak: [] }) })).toBe('')
    expect(render({ block: blokk({ kartyak: null }) })).toBe('')
    const html = render({ block: blokk({ kartyak: [kartya({ cim: '' }), kartya()] }) })
    expect(html.match(/<article/g)).toHaveLength(1)
  })

  it('beágyazva nincs Section és Container, csak a rács', () => {
    const html = render({ block: blokk(), beagyazott: true })
    expect(html).toMatch(/^<ul class="kc-ajanlat-kartyak__grid">/)
    expect(html).not.toContain('kc-section')
    expect(html).not.toContain('kc-container')
  })

  it('horgony és háttér-változat a Section-ön', () => {
    const html = render({ block: blokk(), id: 'ajanlatok', variant: 'dark' })
    expect(html).toContain('class="kc-section kc-section--dark kc-ajanlat-kartyak" id="ajanlatok"')
  })
})

describe('OfferCards: ikon és kis felirat', () => {
  it.each([
    ['kepzes', 'M216,40H40'],
    ['szakkonyv', 'M232,48H160'],
  ] as const)('%s ikon: dekoratív korong, aria-hidden, a Phosphor glifa', (ikon, pathEleje) => {
    const html = render({ block: blokk({ kartyak: [kartya({ ikon })] }) })
    expect(html).toContain('<span aria-hidden="true" class="kc-ajanlat-kartyak__ikon">')
    expect(html).toContain('focusable="false"')
    expect(html).toContain(`d="${pathEleje}`)
  })

  it.each(['nincs', null, undefined] as const)('%s ikon: nincs korong', (ikon) => {
    const html = render({ block: blokk({ kartyak: [kartya({ ikon })] }) })
    expect(html).not.toContain('kc-ajanlat-kartyak__ikon')
  })

  it('kis felirat csak kitöltve', () => {
    expect(render({ block: blokk({ kartyak: [kartya({ kicker: 'Képzés' })] }) })).toContain(
      '<p class="kc-ajanlat-kartyak__kicker">Képzés</p>',
    )
    expect(render({ block: blokk({ kartyak: [kartya({ kicker: ' ' })] }) })).not.toContain(
      'kc-ajanlat-kartyak__kicker',
    )
  })
})

describe('OfferCards: tények (0–4)', () => {
  it.each([0, 1, 2, 3, 4])('%i tény', (darab) => {
    const tenyek = Array.from({ length: darab }, (_, index) => ({ szoveg: `Tény ${index + 1}` }))
    const html = render({ block: blokk({ kartyak: [kartya({ tenyek })] }) })
    if (darab === 0) {
      expect(html).not.toContain('kc-ajanlat-kartyak__tenyek')
    } else {
      const lista = /<ul class="kc-ajanlat-kartyak__tenyek">([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? ''
      expect(lista.match(/<li>/g)).toHaveLength(darab)
      expect(lista).toContain(`Tény ${darab}`)
    }
  })

  it('az üres tény-sor kimarad', () => {
    const html = render({
      block: blokk({ kartyak: [kartya({ tenyek: [{ szoveg: ' ' }, { szoveg: 'Valódi' }] })] }),
    })
    expect(html).toContain('<ul class="kc-ajanlat-kartyak__tenyek"><li>Valódi</li></ul>')
  })
})

describe('OfferCards: gomb, cél, gombsúly', () => {
  it('belső cél: Link, új lap nélkül, keretes alapsúllyal', () => {
    const html = render({
      block: blokk({ kartyak: [kartya({ felirat: 'Írj nekünk', url: '/kapcsolat' })] }),
    })
    const tag = gombTag(html)
    expect(tag).toContain('href="/kapcsolat"')
    expect(tag).toContain('kc-button--secondary')
    expect(tag).not.toContain('target=')
  })

  it('külső cél új lapon: target és rel', () => {
    const html = render({
      block: blokk({
        kartyak: [kartya({ felirat: 'Nézd meg', url: 'https://pelda.hu/', ujAblakban: true })],
      }),
    })
    const tag = gombTag(html)
    expect(tag).toContain('href="https://pelda.hu/"')
    expect(tag).toContain('target="_blank"')
    expect(tag).toContain('rel="noopener noreferrer"')
  })

  it.each([
    ['elsodleges', 'kc-button--primary'],
    ['masodlagos', 'kc-button--secondary'],
    [null, 'kc-button--secondary'],
  ] as const)('gombsúly %s → %s', (gombSuly, osztaly) => {
    const html = render({
      block: blokk({ kartyak: [kartya({ felirat: 'Menj', url: '/kurzusok', gombSuly })] }),
    })
    expect(gombTag(html)).toContain(osztaly)
  })

  it('üres felirat, üres vagy tiltott cél: gomb és kártya-láb nélkül', () => {
    for (const k of [
      kartya({ felirat: '', url: '/kapcsolat' }),
      kartya({ felirat: 'Menj', url: '' }),
      kartya({ felirat: 'Menj', url: 'javascript:alert(1)' }),
      kartya({ felirat: 'Menj', url: null, jegyzet: 'Jegyzet gomb nélkül.' }),
    ]) {
      const html = render({ block: blokk({ kartyak: [k] }) })
      expect(html).not.toContain('kc-button')
      expect(html).not.toContain('kc-ajanlat-kartyak__lab')
      expect(html).not.toContain('javascript:')
      expect(html).not.toContain('Jegyzet gomb nélkül.')
    }
  })
})

describe('OfferCards: jegyzet a gomb alatt (WCAG 2.2 SC 3.2.5)', () => {
  it('kitöltött jegyzet: az áll ott, a gomb aria-describedby-ja rá mutat', () => {
    const html = render({
      block: blokk({
        kartyak: [
          kartya({ felirat: 'Menj', url: '/kapcsolat', jegyzet: 'A kapcsolat-oldalunkra visz.' }),
        ],
      }),
    })
    expect(gombTag(html)).toContain('aria-describedby="b1-1-jegyzet"')
    expect(html).toContain(
      '<p class="kc-ajanlat-kartyak__jegyzet" id="b1-1-jegyzet">A kapcsolat-oldalunkra visz.</p>',
    )
  })

  it('kitöltött jegyzet új lapon nyíló gombnál is a szerkesztőé (ikon nélkül)', () => {
    const html = render({
      block: blokk({
        kartyak: [
          kartya({
            felirat: 'Menj',
            url: 'https://pelda.hu/',
            ujAblakban: true,
            jegyzet: 'Saját.',
          }),
        ],
      }),
    })
    expect(html).toContain('id="b1-1-jegyzet">Saját.</p>')
    expect(html).not.toContain('kc-nav__external-icon')
  })

  it('üres jegyzet, külső cél új lapon: ikon + „Külső oldal, új lapon nyílik.”', () => {
    const html = render({
      block: blokk({
        kartyak: [kartya({ felirat: 'Menj', url: 'https://pelda.hu/', ujAblakban: true })],
      }),
    })
    expect(gombTag(html)).toContain('aria-describedby="b1-1-jegyzet"')
    expect(html).toMatch(
      /<p class="kc-ajanlat-kartyak__jegyzet" id="b1-1-jegyzet"><svg aria-hidden="true" class="kc-nav__external-icon"[\s\S]*?<\/svg>Külső oldal, új lapon nyílik\.<\/p>/,
    )
  })

  it('üres jegyzet, belső cél új lapon: „Új lapon nyílik.” (a „külső” itt nem lenne igaz)', () => {
    const html = render({
      block: blokk({ kartyak: [kartya({ felirat: 'Menj', url: '/kurzusok', ujAblakban: true })] }),
    })
    expect(html).toContain(`</svg>${BELSO_UJ_LAP_JEGYZET}</p>`)
    expect(html).not.toContain(KULSO_UJ_LAP_JEGYZET)
  })

  it('üres jegyzet, ugyanazon a lapon nyíló gomb: nincs jegyzet és aria-describedby', () => {
    for (const url of ['/kapcsolat', 'https://pelda.hu/']) {
      const html = render({ block: blokk({ kartyak: [kartya({ felirat: 'Menj', url })] }) })
      expect(html).not.toContain('kc-ajanlat-kartyak__jegyzet')
      expect(html).not.toContain('aria-describedby')
    }
  })
})

describe('OfferCards: „még nem elérhető” állapot', () => {
  it('bekapcsolva és kitöltve: az állapot-bekezdés a kártya testében', () => {
    const html = render({
      block: blokk({ kartyak: [kartya({ hamarosan: true, allapotSzoveg: 'Hamarosan jön.' })] }),
    })
    expect(html).toContain('<p class="kc-ajanlat-kartyak__allapot">Hamarosan jön.</p>')
  })

  it('kikapcsolva a szöveg akkor sem látszik; bekapcsolva, üresen sincs bekezdés', () => {
    expect(
      render({
        block: blokk({ kartyak: [kartya({ hamarosan: false, allapotSzoveg: 'Rejtve.' })] }),
      }),
    ).not.toContain('Rejtve.')
    expect(
      render({ block: blokk({ kartyak: [kartya({ hamarosan: true, allapotSzoveg: ' ' })] }) }),
    ).not.toContain('kc-ajanlat-kartyak__allapot')
  })
})

describe('OfferCards: azonosítók', () => {
  const kulsoKartya = kartya({ felirat: 'Menj', url: 'https://pelda.hu/', ujAblakban: true })

  it('az id-k az előtagból és a kártya sorszámából épülnek, egy blokkon belül egyediek', () => {
    const html = render({
      block: blokk({ title: 'Cím', kartyak: [kulsoKartya, kulsoKartya, kulsoKartya] }),
      idElotag: 'ajanlat-x',
    })
    const idk = [...html.matchAll(/\sid="([^"]+)"/g)].map((talalat) => talalat[1])
    expect(idk).toEqual([
      'ajanlat-x-cim',
      'ajanlat-x-1-jegyzet',
      'ajanlat-x-2-jegyzet',
      'ajanlat-x-3-jegyzet',
    ])
  })

  it('két blokk egy lapon: nincs ütköző id', () => {
    const html =
      render({ block: blokk({ id: 'elso', title: 'A', kartyak: [kulsoKartya] }) }) +
      render({ block: blokk({ id: 'masodik', title: 'B', kartyak: [kulsoKartya] }) })
    const idk = [...html.matchAll(/\sid="([^"]+)"/g)].map((talalat) => talalat[1])
    expect(idk).toHaveLength(4)
    expect(new Set(idk).size).toBe(4)
  })

  it('az előtag HTML-id-barát alakra tisztul', () => {
    const html = render({ block: blokk({ title: 'A' }), idElotag: 'ajanlat blokk/1' })
    expect(html).toContain('id="ajanlat-blokk-1-cim"')
  })
})

describe('OfferCards: mikroszöveg', () => {
  it('a beépített szövegekben nincs töltelék gondolatjel (– —)', () => {
    for (const beepitett of [KULSO_UJ_LAP_JEGYZET, BELSO_UJ_LAP_JEGYZET]) {
      expect(beepitett.includes(EN_DASH)).toBe(false)
      expect(beepitett.includes(EM_DASH)).toBe(false)
    }
    const html = render({
      block: blokk({
        kartyak: [
          kartya({ felirat: 'Menj', url: 'https://pelda.hu/', ujAblakban: true }),
          kartya({ felirat: 'Menj', url: '/kurzusok', ujAblakban: true }),
        ],
      }),
    })
    const tartalom = szoveg(html)
    expect(tartalom.includes(EN_DASH)).toBe(false)
    expect(tartalom.includes(EM_DASH)).toBe(false)
  })
})
