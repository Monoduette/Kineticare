import { describe, expect, it } from 'vitest'

import {
  AKCIOS_KURZUS_ARSZOVEG_CSERE,
  AKCIOS_KURZUS_FO_ELONYOK,
  AKCIOS_KURZUS_GYIK,
  AKCIOS_KURZUS_SEO_CIM,
  AKCIOS_KURZUS_SEO_LEIRAS,
  AKCIOS_KURZUS_SLUG,
  AKCIOS_MENUPONT_REGI_FELIRAT,
  AKCIOS_MENUPONT_UJ_FELIRAT,
  alkalmazAkciosAkcioMezok,
  alkalmazAkciosEladoMezok,
  alkalmazAkciosMenupont,
  alkalmazAszfBekezdesCserek,
  type AkciosEladoMezok,
} from '../scripts/apply-owner-content'
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

  it('az ár-mondat cseréje a régi, teljes árú mondatra illeszkedik, és a helyes akciós árat írja', () => {
    expect(AKCIOS_KURZUS_ARSZOVEG_CSERE.regiKezdet).toContain('79 500 Ft-ért érhető el')
    expect(AKCIOS_KURZUS_ARSZOVEG_CSERE.ujKezdet).toContain('39 500 Ft')
    expect(AKCIOS_KURZUS_ARSZOVEG_CSERE.ujKezdet).not.toContain('119 000')
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

describe('alkalmazAkciosAkcioMezok (PR #278: akciós megjelenés bekapcsolása)', () => {
  const alap = {
    promoEnabled: false,
    promoOriginalPriceHuf: null,
    priceInHUF: 39500,
    priceInHUFEnabled: true,
  }

  it('bekapcsolja a pipát és beírja a teljes árú program árát teljes árnak (egy lépésben)', () => {
    const eredmeny = alkalmazAkciosAkcioMezok({ jelenlegi: alap, teljesAr: 79500 })
    expect(eredmeny.adat).toEqual({ promoEnabled: true, promoOriginalPriceHuf: 79500 })
    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.kihagyasok).toHaveLength(0)
  })

  it('bekapcsolt pipa mellett csendben kihagy (idempotencia)', () => {
    const eredmeny = alkalmazAkciosAkcioMezok({
      jelenlegi: { ...alap, promoEnabled: true, promoOriginalPriceHuf: 79500 },
      teljesAr: 79500,
    })
    expect(eredmeny.adat).toEqual({})
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok[0]?.hangos).toBe(false)
    expect(eredmeny.kihagyasok[0]?.indok).toContain('MÁR')
  })

  it('szerkesztő által kikapcsolt akciót (kitöltött teljes ár mellett) nem kapcsol vissza', () => {
    const eredmeny = alkalmazAkciosAkcioMezok({
      jelenlegi: { ...alap, promoEnabled: false, promoOriginalPriceHuf: 79500 },
      teljesAr: 79500,
    })
    expect(eredmeny.adat).toEqual({})
    expect(eredmeny.kihagyasok[0]?.indok).toContain('szerkesztői döntés')
  })

  it('teljes ár nélkül (nem olvasható vagy nem nagyobb) az akciót sem kapcsolja be, hangosan', () => {
    const kisebb = alkalmazAkciosAkcioMezok({ jelenlegi: alap, teljesAr: 30000 })
    expect(kisebb.adat).toEqual({})
    expect(kisebb.kihagyasok[0]?.hangos).toBe(true)
    const nincs = alkalmazAkciosAkcioMezok({ jelenlegi: alap, teljesAr: null })
    expect(nincs.adat).toEqual({})
    expect(nincs.kihagyasok[0]?.hangos).toBe(true)
  })

  it('a szövegekben nincs gondolatjel', () => {
    const eredmeny = alkalmazAkciosAkcioMezok({ jelenlegi: alap, teljesAr: 79500 })
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
