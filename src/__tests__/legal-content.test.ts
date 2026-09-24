import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  JOGI_FORRAS_DIR,
  JOGI_OLDALAK,
  jogiElemek,
  jogiForrasSzoveg,
  jogiOldalTartalom,
  jogiRichText,
  jogiSzoveg,
  lexicalToJogiForras,
  parseJogiForras,
  richTextSzoveg,
} from '../lib/legal-content'
import { PRIVACY_POLICY_PATH } from '../lib/newsletter/consent-text'
import { slugify } from '../lib/slugify'

/**
 * A jogi oldalak tartalom-modulja (src/lib/legal-content.ts).
 *
 * A teszt LÉNYEGE a SZÓ SZERINTISÉG BIZONYÍTÁSA: a jogász szövegét a
 * generált Lexical tartalomból visszaolvasva karakterre ugyanazt kell kapni,
 * mint a forrásfájlból — a TELJES hosszon, mind a három dokumentumra.
 *
 * Hogy a bizonyítás ne legyen körkörös, a teszt SAJÁT, naiv jelölő-leválasztót
 * használ (`nyersSzoveg`) a modul `parseJogiForras`-a helyett: ha a parser
 * bármit hozzátenne, elvenne vagy trimmelne, az összevetés megbukik.
 *
 * Fájl- és hálózati hívás: a modul a repóban élő forrásfájlokat olvassa
 * (`src/lib/legal-source/*.txt`) — hálózati hívás nincs (CLAUDE.md 15.
 * üzemeltetési tanulság).
 */

/** A sor eleji megjelenítési jelölők — a leghosszabbtól a legrövidebbig. */
const JELOLOK = ['## ', '# ', '- ']

/**
 * A forrásfájl SZÖVEGE, a teszt saját, naiv leválasztójával: üres sor kiesik,
 * minden más sorról CSAK a sor eleji jelölő tűnik el. Semmilyen trim vagy
 * whitespace-normalizálás nincs benne.
 */
const nyersSzoveg = (nyers: string): string =>
  nyers
    .split('\n')
    .filter((sor) => sor.trim().length > 0)
    .map((sor) => {
      const jelolo = JELOLOK.find((jelolt) => sor.startsWith(jelolt))
      return jelolo === undefined ? sor : sor.slice(jelolo.length)
    })
    .join('\n')

describe('jogi oldalak — szó szerintiség', () => {
  it.each(JOGI_OLDALAK.map((oldal) => [oldal.slug, oldal] as const))(
    '/%s: a richText-ből visszanyert szöveg KARAKTERRE azonos a forrásfájléval',
    (_slug, oldal) => {
      const forras = nyersSzoveg(jogiForrasSzoveg(oldal))
      const vissza = richTextSzoveg(jogiOldalTartalom(oldal))

      // Először a hossz: hiba esetén ez mondja meg, hogy elveszett-e szöveg.
      expect(vissza.length).toBe(forras.length)
      expect(vissza).toBe(forras)
      // Nem üres dokumentum: a leghosszabb (ÁSZF) 20 000 karakter fölött van,
      // a legrövidebb (impresszum) is több száz — a nulla hosszú „egyezés"
      // tehát nem csúszhat át.
      expect(forras.length).toBeGreaterThan(500)
    },
  )

  it('a modul saját elemzése ugyanazt a szöveget adja, mint a naiv leválasztó', () => {
    for (const oldal of JOGI_OLDALAK) {
      expect(jogiSzoveg(jogiElemek(oldal))).toBe(nyersSzoveg(jogiForrasSzoveg(oldal)))
    }
  })

  it('a forrásfájlokban nincs docx-kinyerési maradék (XML-töredék, HTML-entitás)', () => {
    for (const oldal of JOGI_OLDALAK) {
      const nyers = jogiForrasSzoveg(oldal)
      expect(nyers).not.toMatch(/<w:/)
      expect(nyers).not.toMatch(/<\/?[a-z][^>]*>/i)
      expect(nyers).not.toMatch(/&(amp|lt|gt|quot|#\d+);/)
      // Az üres sorok halmozódása (docx-műtermék) normalizálva van.
      expect(nyers).not.toMatch(/\n\n\n/)
    }
  })

  it('a jogász dokumentumainak jellemző, ellenőrizhető részletei megvannak', () => {
    const aszf = jogiSzoveg(jogiElemek(JOGI_OLDALAK[0]))
    expect(JOGI_OLDALAK[0].slug).toBe('aszf')
    expect(aszf).toContain('A KINETICARE KFT')
    expect(aszf).toContain('Cégjegyzékszám: 20-09-079468')
    expect(aszf).toContain('Adószám: ')
    expect(aszf).toContain('32697865-1-20')
    expect(aszf).toContain('Kelt: 2025. 07.05.')

    const adat = jogiSzoveg(jogiElemek(JOGI_OLDALAK[1]))
    expect(JOGI_OLDALAK[1].slug).toBe('adatvedelem')
    expect(adat).toContain('A KINETICARE Kft. adatkezelési tájékoztatója')
    expect(adat).toContain('Nemzeti Adatvédelmi és Információszabadság Hatóság')

    const impresszum = jogiSzoveg(jogiElemek(JOGI_OLDALAK[2]))
    expect(JOGI_OLDALAK[2].slug).toBe('impresszum')
    expect(impresszum).toContain('KINETICARE Korlátolt Felelősségű Társaság')
    expect(impresszum).toContain('Tárhely.Eu Kft.')
  })
})

describe('jogi oldalak — szerkezet', () => {
  it('a jelölők a várt Lexical csomópontokká fordulnak', () => {
    const elemek = parseJogiForras(
      ['# Szakasz', 'Bekezdés.', '## Alszakasz', '- első', '- második', '', 'Záró.'].join('\n'),
    )
    expect(elemek).toEqual([
      { tipus: 'cim', szoveg: 'Szakasz' },
      { tipus: 'bekezdes', szoveg: 'Bekezdés.' },
      { tipus: 'alcim', szoveg: 'Alszakasz' },
      { tipus: 'listaelem', szoveg: 'első' },
      { tipus: 'listaelem', szoveg: 'második' },
      { tipus: 'bekezdes', szoveg: 'Záró.' },
    ])

    const gyerekek = jogiRichText(elemek).root.children
    expect(gyerekek.map((node) => node.type)).toEqual([
      'heading',
      'paragraph',
      'heading',
      'list',
      'paragraph',
    ])
    expect(gyerekek[0]).toMatchObject({ tag: 'h2' })
    expect(gyerekek[2]).toMatchObject({ tag: 'h3' })
    // Az egymás utáni felsorolás-elemek EGY listába kerülnek.
    expect(gyerekek[3]).toMatchObject({ tag: 'ul', listType: 'bullet' })
    expect((gyerekek[3] as unknown as { children: unknown[] }).children).toHaveLength(2)
  })

  it('a bekezdésen belüli szöveg nem trimmelődik (a bevezető szóköz megmarad)', () => {
    const elemek = parseJogiForras(' bevezető szóközzel kezdődő bekezdés ')
    expect(elemek).toEqual([{ tipus: 'bekezdes', szoveg: ' bevezető szóközzel kezdődő bekezdés ' }])
  })

  it('minden jogi oldal tartalma renderelhető (nem üres Lexical gyökér)', () => {
    for (const oldal of JOGI_OLDALAK) {
      const tartalom = jogiOldalTartalom(oldal)
      expect(tartalom.root.type).toBe('root')
      expect(tartalom.root.children.length).toBeGreaterThan(10)
      for (const node of tartalom.root.children) {
        expect(['heading', 'paragraph', 'list']).toContain(node.type)
      }
    }
  })
})

describe('jogi oldalak — webcímek és metaadatok', () => {
  it('a slugok a LÁBLÉC linkjeihez igazodnak (/aszf, /adatvedelem, /impresszum)', () => {
    expect(JOGI_OLDALAK.map((oldal) => oldal.slug)).toEqual(['aszf', 'adatvedelem', 'impresszum'])
    // A hírlevél-hozzájárulás linkje ugyanerre az oldalra mutat — ha az egyik
    // elmozdul, ez a teszt bukik, nem a látogató fut 404-be.
    expect(JOGI_OLDALAK.map((oldal) => `/${oldal.slug}`)).toContain(PRIVACY_POLICY_PATH)
  })

  it('a slugot a Pages slug-hookja VÁLTOZATLANUL hagyja', () => {
    // A `slugField` beforeValidate hookja (src/fields/slug.ts) a megadott
    // slugot `slugify`-olja. Ha bármelyik jogi slug ettől elmozdulna, a lábléc
    // linkjei 404-be futnának — ezért itt rögzítjük, hogy fixpont mind a három.
    for (const oldal of JOGI_OLDALAK) {
      expect(slugify(oldal.slug)).toBe(oldal.slug)
    }
  })

  it('minden oldalnak van címe és SEO-leírása, és a leírás nem a jogi szöveg másolata', () => {
    for (const oldal of JOGI_OLDALAK) {
      expect(oldal.cim.length).toBeGreaterThan(0)
      expect(oldal.seoLeiras.length).toBeGreaterThan(40)
      expect(oldal.seoLeiras.length).toBeLessThanOrEqual(200)
      expect(jogiSzoveg(jogiElemek(oldal))).not.toContain(oldal.seoLeiras)
    }
  })

  it('a forrásfájlok a modul mellett élnek és olvashatók', () => {
    for (const oldal of JOGI_OLDALAK) {
      const teljes = path.join(JOGI_FORRAS_DIR, oldal.forrasFajl)
      expect(readFileSync(teljes, 'utf8')).toBe(jogiForrasSzoveg(oldal))
    }
  })
})

describe('richTextSzoveg', () => {
  it('a lista minden eleme ÖNÁLLÓ sor lesz', () => {
    const tartalom = jogiRichText(parseJogiForras(['- a', '- b', 'c'].join('\n')))
    expect(richTextSzoveg(tartalom)).toBe('a\nb\nc')
  })

  it('rossz alakú bemenetre üres szöveget ad, nem dob', () => {
    expect(richTextSzoveg(null)).toBe('')
    expect(richTextSzoveg({})).toBe('')
    expect(richTextSzoveg({ root: { children: 'nem tömb' } })).toBe('')
  })
})

// ---------------------------------------------------------------------------
// lexicalToJogiForras: a jogiRichText inverze (H10)
// ---------------------------------------------------------------------------

describe('lexicalToJogiForras — a jogiRichText inverze', () => {
  it.each(JOGI_OLDALAK.map((oldal) => [oldal.slug, oldal] as const))(
    '/%s: forrás → Lexical → forrás ugyanazt az elemsort adja (jelölőkkel együtt)',
    (_slug, oldal) => {
      const elemek = parseJogiForras(jogiForrasSzoveg(oldal))
      const vissza = lexicalToJogiForras(jogiRichText(elemek))
      expect(parseJogiForras(vissza)).toEqual(elemek)
      // A címsor-jelölők megmaradnak (a `richTextSzoveg` ezeket eldobja).
      expect(vissza.split('\n').filter((sor) => sor.startsWith('# ')).length).toBe(
        elemek.filter((elem) => elem.tipus === 'cim').length,
      )
    },
  )

  it('a szerkezeti fordítás: címsorszintek, felsorolás, számozott és beágyazott lista, sortörés, link', () => {
    const szoveg = (text: string) => ({ type: 'text', text })
    const tartalom = {
      root: {
        children: [
          { type: 'heading', tag: 'h1', children: [szoveg('Első')] },
          { type: 'heading', tag: 'h2', children: [szoveg('Fejezet')] },
          {
            type: 'heading',
            tag: 'h4',
            children: [szoveg('Al'), { type: 'linebreak' }, szoveg('cím')],
          },
          {
            type: 'paragraph',
            children: [
              szoveg('Székhely:'),
              { type: 'tab' },
              szoveg('Keszthely'),
              { type: 'linebreak' },
              szoveg('Adószám: 1'),
            ],
          },
          {
            type: 'list',
            listType: 'bullet',
            children: [
              { type: 'listitem', children: [szoveg('a')] },
              {
                type: 'listitem',
                children: [
                  {
                    type: 'list',
                    listType: 'number',
                    children: [
                      { type: 'listitem', value: 1, children: [szoveg('a1')] },
                      { type: 'listitem', value: 2, children: [szoveg('a2')] },
                    ],
                  },
                ],
              },
              { type: 'listitem', children: [szoveg('b')] },
            ],
          },
          {
            type: 'paragraph',
            children: [
              szoveg('Lásd: '),
              {
                type: 'link',
                fields: { url: 'https://www.bekeltetes.hu' },
                children: [szoveg('a testületek listája')],
              },
              szoveg(', '),
              {
                type: 'link',
                fields: { url: 'https://www.kineticare.hu/adatvedelem' },
                children: [szoveg('https://www.kineticare.hu/adatvedelem')],
              },
              szoveg(', '),
              { type: 'autolink', url: 'mailto:info@pelda.hu', children: [szoveg('írj nekünk')] },
              szoveg(', '),
              { type: 'link', fields: { url: '/aszf' }, children: [szoveg('ÁSZF')] },
            ],
          },
          { type: 'horizontalrule' },
          { type: 'paragraph', children: [] },
          { type: 'upload', value: 12 },
        ],
      },
    }
    expect(lexicalToJogiForras(tartalom).split('\n')).toEqual([
      '# Első',
      '# Fejezet',
      '## Al cím',
      'Székhely:\tKeszthely',
      'Adószám: 1',
      '- a',
      '  1. a1',
      '  2. a2',
      '- b',
      'Lásd: a testületek listája (https://www.bekeltetes.hu), https://www.kineticare.hu/adatvedelem, írj nekünk (info@pelda.hu), ÁSZF',
      '',
      '',
    ])
  })

  it('rossz alakú bemenetre üres szöveget ad, nem dob', () => {
    expect(lexicalToJogiForras(null)).toBe('')
    expect(lexicalToJogiForras('szöveg')).toBe('')
    expect(lexicalToJogiForras({})).toBe('')
    expect(lexicalToJogiForras({ root: { children: 'nem tömb' } })).toBe('')
    expect(lexicalToJogiForras({ root: { children: [null, 3, { type: 'text' }] } })).toBe('')
  })
})
