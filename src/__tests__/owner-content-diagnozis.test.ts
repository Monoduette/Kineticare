import { describe, expect, it } from 'vitest'

import {
  DIAGNOZIS_REGI_MONDAT,
  DIAGNOZIS_UJ_MONDAT,
  alkalmazDiagnozisTagmondatTorles,
} from '../scripts/apply-owner-content'
import type { Page } from '../payload-types'

/**
 * 2026-09-22 — a „nem diagnózis a webről" tagmondat törlése a szolgáltatás-
 * sorokból (src/scripts/apply-owner-content.ts). Adatbázis és hálózat nélkül.
 *
 * Mért tulajdonságok: (1) a betűre egyező mondatot cseréli, a sor többi része
 * marad; (2) második futásra nincs teendő; (3) szerkesztői szöveghez nem nyúl;
 * (4) más blokktípus érintetlen.
 */

type Layout = NonNullable<Page['layout']>

const RENDELOI_TORZS = `Akut panasz, műtét utáni időszak vagy hosszú ideje tartó fájdalom esetén a stúdióban várunk: gyógytorna, manuálterápia és a hozzád igazított kiegészítő terápiák. ${DIAGNOZIS_REGI_MONDAT}`

const segitsegBlokk = (torzs: string): Layout[number] =>
  ({
    blockType: 'services',
    title: 'Így tudunk segíteni',
    rows: [
      { number: '1', title: 'Rendelői kezelések', body: torzs },
      { number: '2', title: 'Otthoni program', body: 'Ha otthon szeretnél gyakorolni.' },
    ],
  }) as unknown as Layout[number]

const richText = {
  blockType: 'richText',
  content: { root: { children: [] } },
} as unknown as Layout[number]

const sorTorzse = (layout: Layout | null, blokk: number, sor: number): unknown => {
  const talalat = layout?.[blokk] as { rows?: { body?: unknown }[] } | undefined
  return talalat?.rows?.[sor]?.body
}

describe('alkalmazDiagnozisTagmondatTorles', () => {
  it('a tagmondatot pontra cseréli, a sor eleje és a többi sor változatlan', () => {
    const layout: Layout = [richText, segitsegBlokk(RENDELOI_TORZS)]
    const eredmeny = alkalmazDiagnozisTagmondatTorles(layout, 'Rólunk oldal')

    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.kihagyasok).toHaveLength(0)
    const uj = sorTorzse(eredmeny.layout, 1, 0)
    expect(uj).toBe(RENDELOI_TORZS.replace(DIAGNOZIS_REGI_MONDAT, DIAGNOZIS_UJ_MONDAT))
    expect(String(uj)).not.toContain('diagnózis')
    expect(String(uj).endsWith('A pontos tervet vizsgálat után állítjuk össze.')).toBe(true)
    expect(sorTorzse(eredmeny.layout, 1, 1)).toBe('Ha otthon szeretnél gyakorolni.')
    // A nem érintett blokk ugyanaz a referencia marad.
    expect(eredmeny.layout?.[0]).toBe(layout[0])
    expect(eredmeny.modositasok[0]?.uzenet).toContain('Rendelői kezelések')
  })

  it('második futásra „MÁR" kihagyás, nincs írás', () => {
    const elso = alkalmazDiagnozisTagmondatTorles([segitsegBlokk(RENDELOI_TORZS)], 'Kezdőlap')
    const masodik = alkalmazDiagnozisTagmondatTorles(elso.layout, 'Kezdőlap')
    expect(masodik.layout).toBeNull()
    expect(masodik.modositasok).toHaveLength(0)
    expect(masodik.kihagyasok[0]?.indok).toContain('MÁR')
  })

  it('szerkesztői, másként fogalmazott szöveghez nem nyúl', () => {
    const szerkesztoi = 'Akut sérülések esetén a stúdiónkban várunk. Nem diagnózis a webről.'
    const eredmeny = alkalmazDiagnozisTagmondatTorles([segitsegBlokk(szerkesztoi)], 'Kezdőlap')
    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok[0]?.hangos).not.toBe(true)
  })

  it('üres szekciósornál indokolt kihagyás', () => {
    const eredmeny = alkalmazDiagnozisTagmondatTorles([], 'Rólunk oldal')
    expect(eredmeny.layout).toBeNull()
    expect(eredmeny.kihagyasok).toHaveLength(1)
  })
})
