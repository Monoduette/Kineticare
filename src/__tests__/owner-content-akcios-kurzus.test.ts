import { describe, expect, it } from 'vitest'

import {
  AKCIOS_KURZUS_ARSZOVEG_CSERE,
  AKCIOS_KURZUS_FO_ELONYOK,
  AKCIOS_KURZUS_GYIK,
  AKCIOS_KURZUS_KORABBI_FO_ELONYOK,
  AKCIOS_KURZUS_KORABBI_SEO_CIM,
  AKCIOS_KURZUS_KORABBI_SEO_LEIRAS,
  AKCIOS_KURZUS_SEO_CIM,
  AKCIOS_KURZUS_SEO_LEIRAS,
  AKCIOS_KURZUS_SLUG,
  AKCIOS_MENUPONT_REGI_FELIRAT,
  AKCIOS_MENUPONT_UJ_FELIRAT,
  alkalmazAkciosArAtallas,
  alkalmazAkciosEladoMezok,
  alkalmazAkciosMenupont,
  alkalmazAszfBekezdesCserek,
  type AkciosEladoMezok,
} from '../scripts/apply-owner-content'
import { formatPriceHuf } from '../lib/format-price'
import type { Menu } from '../payload-types'

/**
 * WP54/2026-09-20 — az akciós kurzus tiszta szabályai
 * (src/scripts/apply-owner-content.ts). Adatbázis és hálózat nélkül.
 *
 * Mért tulajdonságok szabályonként: (1) a várt állapoton módosít, (2) a már
 * elvégzett állapoton csendben kihagy (idempotencia), (3) szerkesztői adathoz
 * nem nyúl, (4) hiányzó előfeltételnél hangosan kihagy.
 */

const GONDOLATJEL = /[–—]/u

const menupont = (
  felul: Partial<Menu> = {},
): Pick<Menu, 'id' | 'label' | 'type' | 'ref' | 'unlisted'> => ({
  id: 8,
  label: AKCIOS_MENUPONT_REGI_FELIRAT,
  type: 'page',
  ref: { relationTo: 'pages', value: 16 },
  unlisted: false,
  ...felul,
})

const uresMezok = (): AkciosEladoMezok => ({
  salesHighlights: [],
  faq: [],
  seoTitle: null,
  seoDescription: null,
  relatedProducts: [],
})

describe('vevői szövegek: natív magyar, gondolatjel nélkül, a felület korlátain belül', () => {
  it('egyik új felirat sem tartalmaz gondolatjelet', () => {
    const szovegek = [
      AKCIOS_MENUPONT_UJ_FELIRAT,
      AKCIOS_KURZUS_SEO_CIM,
      AKCIOS_KURZUS_SEO_LEIRAS,
      AKCIOS_KURZUS_ARSZOVEG_CSERE.ujKezdet,
      ...AKCIOS_KURZUS_FO_ELONYOK,
      ...AKCIOS_KURZUS_GYIK.flatMap((sor) => [sor.question, sor.answer]),
    ]
    for (const szoveg of szovegek) {
      expect(szoveg, szoveg).not.toMatch(GONDOLATJEL)
    }
  })

  it('a fő előnyök legfeljebb 4 sor, mind 84 karakter alatt (sales-content MAX_HIGHLIGHT_LENGTH)', () => {
    expect(AKCIOS_KURZUS_FO_ELONYOK.length).toBeLessThanOrEqual(4)
    for (const sor of AKCIOS_KURZUS_FO_ELONYOK) {
      expect(sor.length, sor).toBeLessThanOrEqual(84)
    }
  })

  it('a SEO-leírás 160 karakter alatt, a SEO-cím 60 alatt', () => {
    expect(AKCIOS_KURZUS_SEO_LEIRAS.length).toBeLessThanOrEqual(160)
    expect(AKCIOS_KURZUS_SEO_CIM.length).toBeLessThanOrEqual(60)
  })

  it('az ár-mondat cseréje a régi, teljes árú mondatra és a korábbi futás mondatára is illeszkedik', () => {
    expect(AKCIOS_KURZUS_ARSZOVEG_CSERE.regiKezdet).toContain('79 500 Ft-ért érhető el')
    expect(AKCIOS_KURZUS_ARSZOVEG_CSERE.korabbiKezdetek?.[0]).toContain('39 500 Ft')
    expect(AKCIOS_KURZUS_ARSZOVEG_CSERE.ujKezdet).not.toContain('119 000')
  })

  it('a statikus szövegek árat nem mondanak ki: az akció lejárta után is igazak maradnak', () => {
    // Az árat egyedül a buybox mutatja, élőben (coursePriceHuf). A beégetett
    // összeg a lejárat után félrevezető árközlés lenne (2005/29/EK 6. cikk (1) d).
    const ARAT_MOND = /\d[\d\s.]*\s*Ft|forint/iu
    const szovegek = [
      AKCIOS_KURZUS_SEO_CIM,
      AKCIOS_KURZUS_SEO_LEIRAS,
      AKCIOS_KURZUS_ARSZOVEG_CSERE.ujKezdet,
      ...AKCIOS_KURZUS_FO_ELONYOK,
      ...AKCIOS_KURZUS_GYIK.flatMap((sor) => [sor.question, sor.answer]),
    ]
    for (const szoveg of szovegek) {
      expect(szoveg, szoveg).not.toMatch(ARAT_MOND)
    }
    // Az árelőnyt állító fordulat sem maradhat a statikus leírásban.
    expect(AKCIOS_KURZUS_SEO_LEIRAS).not.toMatch(/akciós áron/iu)
    expect(AKCIOS_KURZUS_FO_ELONYOK.join(' ')).not.toMatch(/akciós áron/iu)
  })
})

describe('alkalmazAkciosMenupont', () => {
  it('a régi feliratú oldal-menüpontot az akciós kurzusra állítja, rejtett linkként', () => {
    const eredmeny = alkalmazAkciosMenupont({ menupont: menupont(), akciosId: 4 })
    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.kihagyasok).toHaveLength(0)
    expect(eredmeny.adat).toEqual({
      label: AKCIOS_MENUPONT_UJ_FELIRAT,
      type: 'product',
      ref: { relationTo: 'products', value: 4 },
      unlisted: true,
      openInNewTab: false,
    })
  })

  it('a felirat kis/nagybetűje és a szélső szóköz nem számít', () => {
    const eredmeny = alkalmazAkciosMenupont({
      menupont: menupont({ label: '  Olcsó Dolgok Itt ' }),
      akciosId: 4,
    })
    expect(eredmeny.adat?.label).toBe(AKCIOS_MENUPONT_UJ_FELIRAT)
  })

  it('a már átállított menüponton csendben kihagy (idempotencia)', () => {
    const eredmeny = alkalmazAkciosMenupont({
      menupont: menupont({
        label: AKCIOS_MENUPONT_UJ_FELIRAT,
        type: 'product',
        ref: { relationTo: 'products', value: 4 },
        unlisted: true,
      }),
      akciosId: 4,
    })
    expect(eredmeny.adat).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok[0]?.indok).toContain('MÁR')
    expect(eredmeny.kihagyasok[0]?.hangos).toBe(false)
  })

  it('az új feliratú, de még nem rejtett vagy más célú menüpontot befejezi', () => {
    const eredmeny = alkalmazAkciosMenupont({
      menupont: menupont({
        label: AKCIOS_MENUPONT_UJ_FELIRAT,
        type: 'product',
        ref: { relationTo: 'products', value: { id: 4 } as never },
        unlisted: false,
      }),
      akciosId: 4,
    })
    expect(eredmeny.adat?.unlisted).toBe(true)
    expect(eredmeny.adat?.ref).toEqual({ relationTo: 'products', value: 4 })
  })

  it('szerkesztett feliratot nem ír át', () => {
    const eredmeny = alkalmazAkciosMenupont({
      menupont: menupont({ label: 'Partnereknek' }),
      akciosId: 4,
    })
    expect(eredmeny.adat).toBeNull()
    expect(eredmeny.kihagyasok[0]?.indok).toContain('pontos egyezésnél')
  })

  it('az akciós kurzus nélkül hangosan kihagy, cél nélkül nem ír', () => {
    const eredmeny = alkalmazAkciosMenupont({ menupont: menupont(), akciosId: null })
    expect(eredmeny.adat).toBeNull()
    expect(eredmeny.kihagyasok[0]?.hangos).toBe(true)
    expect(eredmeny.kihagyasok[0]?.indok).toContain(AKCIOS_KURZUS_SLUG)
  })
})

describe('alkalmazAkciosEladoMezok', () => {
  it('üres mezőkbe mind az öt eladó adatot beírja', () => {
    const eredmeny = alkalmazAkciosEladoMezok({ jelenlegi: uresMezok(), sosId: 2 })
    expect(eredmeny.kihagyasok).toHaveLength(0)
    expect(eredmeny.modositasok).toHaveLength(5)
    expect(eredmeny.adat.salesHighlights?.map((sor) => sor.text)).toEqual([
      ...AKCIOS_KURZUS_FO_ELONYOK,
    ])
    expect(eredmeny.adat.faq).toHaveLength(AKCIOS_KURZUS_GYIK.length)
    expect(eredmeny.adat.seoTitle).toBe(AKCIOS_KURZUS_SEO_CIM)
    expect(eredmeny.adat.seoDescription).toBe(AKCIOS_KURZUS_SEO_LEIRAS)
    expect(eredmeny.adat.relatedProducts).toEqual([2])
  })

  it('a kitöltött mezőket nem írja felül, csak a hiányzókat pótolja', () => {
    const eredmeny = alkalmazAkciosEladoMezok({
      jelenlegi: {
        salesHighlights: [{ text: 'Szerkesztői sor' }],
        faq: [{ question: 'Saját kérdés?', answer: 'Saját válasz.' }],
        seoTitle: 'Saját SEO-cím',
        seoDescription: null,
        relatedProducts: [1],
      },
      sosId: 2,
    })
    expect(Object.keys(eredmeny.adat)).toEqual(['seoDescription'])
    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.kihagyasok).toHaveLength(4)
    for (const lepes of eredmeny.kihagyasok) {
      expect(lepes.indok).toContain('sosem ír felül')
    }
  })

  it('a script korábbi, beégetett árú szövegeit lecseréli (és csak azokat)', () => {
    const eredmeny = alkalmazAkciosEladoMezok({
      jelenlegi: {
        ...uresMezok(),
        salesHighlights: AKCIOS_KURZUS_KORABBI_FO_ELONYOK.map((text) => ({ text })),
        faq: [{ question: 'Saját kérdés?', answer: 'Saját válasz.' }],
        seoTitle: AKCIOS_KURZUS_KORABBI_SEO_CIM,
        seoDescription: AKCIOS_KURZUS_KORABBI_SEO_LEIRAS,
        relatedProducts: [1],
      },
      sosId: 2,
    })
    expect(eredmeny.adat.salesHighlights?.map((sor) => sor.text)).toEqual([
      ...AKCIOS_KURZUS_FO_ELONYOK,
    ])
    expect(eredmeny.adat.seoTitle).toBe(AKCIOS_KURZUS_SEO_CIM)
    expect(eredmeny.adat.seoDescription).toBe(AKCIOS_KURZUS_SEO_LEIRAS)
    expect(eredmeny.adat.faq).toBeUndefined()
    expect(eredmeny.modositasok).toHaveLength(3)
  })

  it('a korábbi sorokat szerkesztői módosítás után már nem írja felül', () => {
    const szerkesztett = [...AKCIOS_KURZUS_KORABBI_FO_ELONYOK]
    szerkesztett[1] = 'Szerkesztői sor'
    const eredmeny = alkalmazAkciosEladoMezok({
      jelenlegi: {
        ...uresMezok(),
        salesHighlights: szerkesztett.map((text) => ({ text })),
        seoTitle: `${AKCIOS_KURZUS_KORABBI_SEO_CIM} `,
      },
      sosId: 2,
    })
    expect(eredmeny.adat.salesHighlights).toBeUndefined()
    expect(eredmeny.adat.seoTitle).toBeUndefined()
  })

  it('második futásra (minden kitöltve) egyetlen módosítás sincs', () => {
    const elso = alkalmazAkciosEladoMezok({ jelenlegi: uresMezok(), sosId: 2 })
    const masodik = alkalmazAkciosEladoMezok({
      jelenlegi: { ...uresMezok(), ...elso.adat },
      sosId: 2,
    })
    expect(masodik.modositasok).toHaveLength(0)
    expect(Object.keys(masodik.adat)).toHaveLength(0)
  })

  it('SOS kurzus nélkül a kapcsolódó sáv hangos kihagyás, a többi mező íródik', () => {
    const eredmeny = alkalmazAkciosEladoMezok({ jelenlegi: uresMezok(), sosId: null })
    expect(eredmeny.adat.relatedProducts).toBeUndefined()
    expect(eredmeny.kihagyasok.find((l) => l.hangos)?.indok).toContain('SOS')
    expect(eredmeny.modositasok).toHaveLength(4)
  })

  it('a bemenetet nem módosítja helyben', () => {
    const jelenlegi = uresMezok()
    alkalmazAkciosEladoMezok({ jelenlegi, sosId: 2 })
    expect(jelenlegi).toEqual(uresMezok())
  })
})

describe('alkalmazAkciosArAtallas (WP63: Ár = rendes ár, Akciós ár = akciós ár)', () => {
  const oroklott = {
    promoEnabled: true,
    promoOriginalPriceHuf: 79500,
    promoPriceHuf: null,
    priceInHUF: 39500,
    priceInHUFEnabled: true,
  }

  it('az örökölt állapotot egy lépésben átfordítja: Ár 79 500, Akciós ár 39 500, Teljes ár üres', () => {
    const eredmeny = alkalmazAkciosArAtallas({ jelenlegi: oroklott })
    expect(eredmeny.adat).toEqual({
      priceInHUF: 79500,
      promoPriceHuf: 39500,
      promoOriginalPriceHuf: null,
    })
    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.kihagyasok).toHaveLength(0)
    expect(eredmeny.modositasok[0]?.uzenet).toContain(formatPriceHuf(79500))
    expect(eredmeny.modositasok[0]?.uzenet).toContain(formatPriceHuf(39500))
    expect(eredmeny.modositasok[0]?.indok).toContain('magától a rendes ár él')
  })

  it('kitöltött akciós ár mellett csendben kihagy (idempotencia, második futás)', () => {
    const elso = alkalmazAkciosArAtallas({ jelenlegi: oroklott })
    const masodik = alkalmazAkciosArAtallas({ jelenlegi: { ...oroklott, ...elso.adat } })
    expect(masodik.adat).toEqual({})
    expect(masodik.modositasok).toHaveLength(0)
    expect(masodik.kihagyasok[0]?.hangos).toBe(false)
    expect(masodik.kihagyasok[0]?.indok).toContain('MÁR')
  })

  it('kitöltött akciós ár mellett akkor sem nyúl hozzá, ha az örökölt mező még ott van', () => {
    const eredmeny = alkalmazAkciosArAtallas({
      jelenlegi: { ...oroklott, priceInHUF: 79500, promoPriceHuf: 39500 },
    })
    expect(eredmeny.adat).toEqual({})
    expect(eredmeny.kihagyasok[0]?.hangos).toBe(false)
  })

  it('üres örökölt teljes árnál csendben kihagy, nincs teendő', () => {
    for (const ertek of [null, undefined, 0]) {
      const eredmeny = alkalmazAkciosArAtallas({
        jelenlegi: { ...oroklott, promoOriginalPriceHuf: ertek },
      })
      expect(eredmeny.adat).toEqual({})
      expect(eredmeny.modositasok).toHaveLength(0)
      expect(eredmeny.kihagyasok[0]?.hangos).toBe(false)
      expect(eredmeny.kihagyasok[0]?.indok).toContain('nincs örökölt teljes ár')
    }
  })

  it('használhatatlan örökölt értéknél hangosan kihagy (nem nagyobb az Árnál, vagy nincs érvényes Ár)', () => {
    const nemNagyobb = alkalmazAkciosArAtallas({
      jelenlegi: { ...oroklott, promoOriginalPriceHuf: 39500 },
    })
    expect(nemNagyobb.adat).toEqual({})
    expect(nemNagyobb.kihagyasok[0]?.hangos).toBe(true)
    expect(nemNagyobb.kihagyasok[0]?.indok).toContain('adminban')

    const nincsAr = alkalmazAkciosArAtallas({ jelenlegi: { ...oroklott, priceInHUF: null } })
    expect(nincsAr.adat).toEqual({})
    expect(nincsAr.kihagyasok[0]?.hangos).toBe(true)

    const kikapcsoltAr = alkalmazAkciosArAtallas({
      jelenlegi: { ...oroklott, priceInHUFEnabled: false },
    })
    expect(kikapcsoltAr.adat).toEqual({})
    expect(kikapcsoltAr.kihagyasok[0]?.hangos).toBe(true)
  })

  it('a bemenetet nem módosítja helyben, és a szövegekben nincs gondolatjel', () => {
    const jelenlegi = { ...oroklott }
    const eredmeny = alkalmazAkciosArAtallas({ jelenlegi })
    expect(jelenlegi).toEqual(oroklott)
    for (const lepes of [...eredmeny.modositasok, ...eredmeny.kihagyasok]) {
      expect(`${lepes.uzenet} ${lepes.indok}`).not.toMatch(GONDOLATJEL)
    }
  })
})

describe('az akciós törzs ár-mondatának cseréje (alkalmazAszfBekezdesCserek újrahasználva)', () => {
  const bekezdes = (text: string) => ({
    type: 'paragraph',
    children: [{ type: 'text', text }],
  })
  const torzs = (arMondat: string) => ({
    root: {
      type: 'root',
      children: [
        bekezdes('Az Otthoni KézRehab egy könnyen követhető program.'),
        bekezdes(`${arMondat} (A kurzus nem helyettesíti a szakorvosi kontrollt.)`),
      ],
    },
  })

  it('a teljes árú mondatot az akciósra cseréli, a zárójeles maradék marad', () => {
    const eredmeny = alkalmazAszfBekezdesCserek(torzs(AKCIOS_KURZUS_ARSZOVEG_CSERE.regiKezdet), [
      AKCIOS_KURZUS_ARSZOVEG_CSERE,
    ])
    expect(eredmeny.modositasok).toHaveLength(1)
    const uj = (eredmeny.content as { root: { children: { children: { text: string }[] }[] } }).root
      .children[1].children[0].text
    expect(uj.startsWith(AKCIOS_KURZUS_ARSZOVEG_CSERE.ujKezdet)).toBe(true)
    expect(uj).toContain('(A kurzus nem helyettesíti a szakorvosi kontrollt.)')
    expect(uj).not.toContain('119 000')
  })

  it('a script korábbi futásának beégetett árú mondatát is lecseréli, a maradék marad', () => {
    const korabbi = AKCIOS_KURZUS_ARSZOVEG_CSERE.korabbiKezdetek?.[0] ?? ''
    const eredmeny = alkalmazAszfBekezdesCserek(torzs(korabbi), [AKCIOS_KURZUS_ARSZOVEG_CSERE])
    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.kihagyasok).toHaveLength(0)
    const uj = (eredmeny.content as { root: { children: { children: { text: string }[] }[] } }).root
      .children[1].children[0].text
    expect(uj.startsWith(AKCIOS_KURZUS_ARSZOVEG_CSERE.ujKezdet)).toBe(true)
    expect(uj).toContain('(A kurzus nem helyettesíti a szakorvosi kontrollt.)')
    expect(uj).not.toContain('39 500')
  })

  it('a már javított törzsön csendben kihagy', () => {
    const eredmeny = alkalmazAszfBekezdesCserek(torzs(AKCIOS_KURZUS_ARSZOVEG_CSERE.ujKezdet), [
      AKCIOS_KURZUS_ARSZOVEG_CSERE,
    ])
    expect(eredmeny.content).toBeNull()
    expect(eredmeny.kihagyasok[0]?.indok).toContain('MÁR')
  })

  it('átírt szövegen hangosan kihagy, nem tippel', () => {
    const eredmeny = alkalmazAszfBekezdesCserek(torzs('Az ár most más.'), [
      AKCIOS_KURZUS_ARSZOVEG_CSERE,
    ])
    expect(eredmeny.content).toBeNull()
    expect(eredmeny.kihagyasok[0]?.hangos).toBe(true)
  })
})
