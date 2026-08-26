/**
 * 19. tartalom-javítás — az ÁSZF megfeleltetése a Barion elfogadóhely-jóváhagyás
 * KÖTELEZŐ tartalmi listájának.
 * A Barion jóváhagyási listája szó szerint megköveteli, hogy az ÁSZF
 * tartalmazza „a webáruház üzemeltetőjének nevét, cégjegyzékszámát, címét,
 * adószámát, valamint e-mail címét és telefonszámát”, „a Barion fizetési
 */

import { describe, expect, it } from 'vitest'

import { JOGI_OLDALAK, jogiOldalTartalom, richTextSzoveg } from '../lib/legal-content'
import {
  ASZF_BARION_HORGONY_KEZDET,
  ASZF_BARION_UJ_BEKEZDESEK,
  ASZF_FIZETO_UJ_KEZDET,
  alkalmazAszfBarionKiegeszites,
  alkalmazAszfBekezdesCserek,
} from '../scripts/apply-owner-content'
import { para, richText } from '../scripts/restore-legacy-content'

// ---------------------------------------------------------------------------
// Segédek
// ---------------------------------------------------------------------------

/** Az ÁSZF leírása a jogi oldalak közül. */
const aszfLeiras = () => {
  const oldal = JOGI_OLDALAK.find((elem) => elem.slug === 'aszf')
  expect(oldal).toBeDefined()
  return oldal!
}

/** A forrásfájlból generált ÁSZF TELJES szövege. */
const forrasSzoveg = (): string => richTextSzoveg(jogiOldalTartalom(aszfLeiras()))

/** Rich-text tartalom bekezdés-szövegekből. */
const tartalom = (bekezdesek: readonly string[]): unknown =>
  richText(bekezdesek.map((szoveg) => para(szoveg)))

/** A csomópontok listája egy rich-text tartalomból (referencia-összevetéshez). */
const gyerekek = (content: unknown): unknown[] =>
  (content as { root: { children: unknown[] } }).root.children

/**
 * A 27%-os áfáról szóló mondat — a tulajdonos KIFEJEZETTEN kikötötte, hogy
 * maradjon (az AAM/27 kérdés még nem dőlt el). A beszúrás nem érintheti.
 */
const AFA_BEKEZDES =
  'A fizetést követően a Vásárló a számlát emailben kapja meg link formájában, a Számlázz.hu rendszerén keresztül. A Vásárló elfogadja, hogy a számlát/nyugtát a KINETICARE Kft állítja ki 27%-os áfatartalommal. '

/**
 * Az élő ÁSZF fizetési bekezdése a 18. javítás UTÁN (ez a beszúrás horgonya).
 *
 * SZÁNDÉKOSAN LITERÁL, nem a konstansból származtatott: így a konstans
 * elrontása nem rontja el vele együtt a fixtúrát is.
 */
const ELO_FIZETO_BEKEZDES_JAVITVA =
  'A fizetés titkosított csatornán megy végbe, a Weboldaltól függetlenül, a Barion Payment Zrt. által üzemeltetett Barion Smart Gateway fizetési felületén. '

/** Ugyanez a bekezdés a 18. javítás ELŐTT (az élő oldal mai, mért alakja). */
const ELO_FIZETO_BEKEZDES_STRIPE =
  'A fizetés titkosított csatornán megy végbe, a Weboldaltól függetlenül, a STRIPE fizetési felületén. '

/** A már javított, de a Barion-leírást még NEM tartalmazó élő ÁSZF. */
const eloAszfBarionLeirasNelkul = (): unknown =>
  tartalom([
    'A Vásárló kizárólag 18. életévét betöltött személy lehet. ',
    'Részletfizetés nem lehetséges.',
    ELO_FIZETO_BEKEZDES_JAVITVA,
    AFA_BEKEZDES,
  ])

// ---------------------------------------------------------------------------
// 1. A Barion tartalmi listája a FORRÁSFÁJLON mérve
// ---------------------------------------------------------------------------

describe('a Barion jóváhagyási lista kötelező elemei az ÁSZF forrásában', () => {
  it('az üzemeltető neve, cégjegyzékszáma, címe, adószáma, e-mail címe és telefonszáma benne van', () => {
    const szoveg = forrasSzoveg()

    // 1. cáfolható állítás: bármelyik cégadat kiesése megbuktatja a tesztet.
    expect(szoveg).toContain('KINETICARE Kft.')
    expect(szoveg).toContain('20-09-079468')
    expect(szoveg).toContain('8360 Keszthely, Kacsóh Pongrác utca 1. 2a. ép.')
    expect(szoveg).toContain('32697865-1-20')
    expect(szoveg).toContain('egeszsegmozgastamogatas@gmail.com')
    expect(szoveg).toContain('+36203573493')
  })

  it('a Barion fizetési módról ÉRDEMI leírás van, nem csak a szolgáltató neve', () => {
    const szoveg = forrasSzoveg()

    // 2. cáfolható állítás: a javítás előtt a Barion neve EGYETLEN mondatban
    // szerepelt, MNB-engedélyszám és kártyaadat-tájékoztatás nélkül.
    expect(szoveg).toContain('H-EN-I-1064/2013')
    expect(szoveg).toContain('Magyar Nemzeti Bank felügyelete alatt álló intézmény')
    expect(szoveg).toContain('A bankkártya adatok a kereskedőhöz nem jutnak el.')
    expect(szoveg).toContain('a kártyaadatokat nem ismeri meg és nem tárolja')
    expect(szoveg).toContain('nincs felára')

    // A „Barion” szó több mint egyszer fordul elő: a leírás valóban leírás.
    expect(szoveg.split('Barion').length - 1).toBeGreaterThanOrEqual(5)
  })

  it('a teljesítés átlagos ideje ki van mondva, digitális termékre szabva', () => {
    const szoveg = forrasSzoveg()

    // 3. cáfolható állítás: a javítás előtt a lapon SEHOL nem állt, mikor kapja
    // meg a Vásárló a hozzáférést; a „teljesítés” szó végig jogi értelemben
    // (hibás teljesítés, kellékszavatosság) szerepelt.
    expect(szoveg).toContain('A megrendelés teljesítésének, azaz a hozzáférés megnyitásának átlagos ideje')
    // Digitális terméknél a „kiszállítás” félrevezető — ezt ki KELL mondani.
    expect(szoveg).toContain('postai kiszállítás nincs')
    // A tényleges teljesítés: azonnali hozzáférés a felhasználói fiókban.
    expect(szoveg).toContain('a sikeres fizetés Barion-visszaigazolása után azonnal')
    expect(szoveg).toContain('a Vásárló felhasználói fiókjában')
    // Kiút, ha a gépi teljesítés elmarad.
    expect(szoveg).toContain('24 órán belül')
  })

  it('az ÁSZF elfogadása a vásárlás előfeltételeként szerepel', () => {
    // A lista első pontja („elfogadása a vásárlás előfeltétele”) szöveges fele.
    expect(forrasSzoveg()).toContain(
      'bejelöli az Általános Szerződési feltételek elfogadására',
    )
  })
})

// ---------------------------------------------------------------------------
// 2. A KIVITEL az élő oldalra
// ---------------------------------------------------------------------------

describe('alkalmazAszfBarionKiegeszites — a hiányzó bekezdések beszúrása', () => {
  it('mind a három bekezdést beszúrja, közvetlenül a fizetési bekezdés után', () => {
    const eredmeny = alkalmazAszfBarionKiegeszites(eloAszfBarionLeirasNelkul())

    // 4. cáfolható állítás: ha a beszúrás nem fut le, az élő oldalról hiányzik
    // a Barion-leírás és a teljesítési idő — vagyis a jóváhagyás elbukik.
    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.content).not.toBeNull()

    const sorok = richTextSzoveg(eredmeny.content).split('\n')
    const horgonyIndex = sorok.indexOf(ELO_FIZETO_BEKEZDES_JAVITVA)
    expect(horgonyIndex).toBeGreaterThanOrEqual(0)
    // A három új bekezdés PONTOSAN a horgony után, ebben a sorrendben áll.
    expect(sorok.slice(horgonyIndex + 1, horgonyIndex + 4)).toEqual([
      ...ASZF_BARION_UJ_BEKEZDESEK,
    ])
  })

  it('a meglévő bekezdéseket NEM módosítja (csomópont-referencia szerint sem)', () => {
    const eredeti = eloAszfBarionLeirasNelkul()
    const eredmeny = alkalmazAszfBarionKiegeszites(eredeti)
    const regi = gyerekek(eredeti)
    const uj = gyerekek(eredmeny.content)

    // 7. cáfolható állítás: a lépés CSAK BESZÚR. Ha bármelyik meglévé
    // csomópontot újraépítené, ezek az azonosságok elbuknának — és a 27%-os
    // áfa-mondat (tulajdonosi kikötés) sem volna bizonyítottan érintetlen.
    expect(uj).toHaveLength(regi.length + ASZF_BARION_UJ_BEKEZDESEK.length)
    expect(uj[0]).toBe(regi[0])
    expect(uj[1]).toBe(regi[1])
    expect(uj[2]).toBe(regi[2])
    expect(uj[uj.length - 1]).toBe(regi[regi.length - 1])
    expect(richTextSzoveg(eredmeny.content)).toContain('27%-os áfatartalommal')
  })

  it('másodszor futva SEMMIT nem ír, és nem is kiabál', () => {
    const elso = alkalmazAszfBarionKiegeszites(eloAszfBarionLeirasNelkul())
    const masodik = alkalmazAszfBarionKiegeszites(elso.content)

    // 5. cáfolható állítás: idempotencia nélkül minden futás újabb három
    // bekezdést szúrna be, és az élő ÁSZF-ben halmozódnának a másolatok.
    expect(masodik.content).toBeNull()
    expect(masodik.modositasok).toHaveLength(0)
    expect(masodik.kihagyasok).toHaveLength(1)
    expect(masodik.kihagyasok[0].indok).toContain('MÁR az ÁSZF-ben van')
    expect(masodik.kihagyasok[0].hangos).not.toBe(true)
  })

  it('a harmadik futás is stabil (a kimenet nem oszcillál)', () => {
    const elso = alkalmazAszfBarionKiegeszites(eloAszfBarionLeirasNelkul())
    const masodik = alkalmazAszfBarionKiegeszites(elso.content)
    const harmadik = alkalmazAszfBarionKiegeszites(masodik.content ?? elso.content)
    expect(harmadik.content).toBeNull()
    expect(harmadik.modositasok).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 3. Amikor a script NEM dönthet maga
// ---------------------------------------------------------------------------

describe('alkalmazAszfBarionKiegeszites — a szerkesztő szövegének védelme', () => {
  it('RÉSZLEGESEN meglévő szövegnél hangosan kihagy, nem duplikál', () => {
    const eredmeny = alkalmazAszfBarionKiegeszites(
      tartalom([ELO_FIZETO_BEKEZDES_JAVITVA, ASZF_BARION_UJ_BEKEZDESEK[0], AFA_BEKEZDES]),
    )

    // 6. cáfolható állítás: naiv beszúrással a Barion-tájékoztató KÉTSZER
    // kerülne az élő jogi szövegbe.
    expect(eredmeny.content).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok[0].hangos).toBe(true)
    expect(eredmeny.kihagyasok[0].indok).toContain('részleges állapotban')
  })

  it('hiányzó horgonynál hangosan kihagy, és nem tippel', () => {
    const eredmeny = alkalmazAszfBarionKiegeszites(
      tartalom(['Teljesen más fizetési mondat áll itt.', AFA_BEKEZDES]),
    )

    // 8. cáfolható állítás: horgony nélkül a script nem találhatja ki, hova
    // tartozik a Barion-leírás — inkább semmit nem ír.
    expect(eredmeny.content).toBeNull()
    expect(eredmeny.kihagyasok[0].hangos).toBe(true)
    expect(eredmeny.kihagyasok[0].indok).toContain('nem található')
  })

  it('TÖBB horgonynál sem dönt maga', () => {
    const eredmeny = alkalmazAszfBarionKiegeszites(
      tartalom([ELO_FIZETO_BEKEZDES_JAVITVA, ELO_FIZETO_BEKEZDES_JAVITVA]),
    )
    expect(eredmeny.content).toBeNull()
    expect(eredmeny.kihagyasok[0].hangos).toBe(true)
    expect(eredmeny.kihagyasok[0].indok).toContain('nem egyértelmű')
  })

  it('idegen szerkezetnél hangosan kihagy', () => {
    const eredmeny = alkalmazAszfBarionKiegeszites({ nem: 'richtext' })
    expect(eredmeny.content).toBeNull()
    expect(eredmeny.kihagyasok).toHaveLength(1)
    expect(eredmeny.kihagyasok[0].hangos).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 4. A kód és a jogi forrásfájl összhangja, valamint a javítás-lánc
// ---------------------------------------------------------------------------

describe('a kódbeli bekezdések és a jogi forrásfájl összhangja', () => {
  it('a forrásfájlból generált ÁSZF MÁR mind a három bekezdést tartalmazza', () => {
    // 9. cáfolható állítás: ha valaki kiszedné a bekezdéseket a
    // `src/lib/legal-source/aszf.txt`-ből, ez a teszt bukik.
    const sorok = forrasSzoveg().split('\n')
    for (const bekezdes of ASZF_BARION_UJ_BEKEZDESEK) {
      expect(sorok).toContain(bekezdes)
    }
  })

  it('a forrásfájlból generált ÁSZF-en a beszúrásnak NINCS teendője', () => {
    // Ez köti össze a két felet, és egyben a konstansok BETŰHÍVSÉGÉT bizonyítja:
    // egy frissen létrehozott oldalon már minden a helyén van, tehát a script
    // HALKAN kihagy. Ha a konstans akár egy szóközzel elcsúszna a forrástól,
    // itt „részleges állapot” miatti HANGOS kihagyás keletkezne.
    const eredmeny = alkalmazAszfBarionKiegeszites(jogiOldalTartalom(aszfLeiras()))
    expect(eredmeny.content).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok).toHaveLength(1)
    expect(eredmeny.kihagyasok[0].hangos).not.toBe(true)
  })

  it('a horgony betűre a 18. javítás ÚJ mondata, és a forrásfájlban is ez áll', () => {
    expect(ASZF_BARION_HORGONY_KEZDET).toBe(ASZF_FIZETO_UJ_KEZDET)
    expect(ELO_FIZETO_BEKEZDES_JAVITVA.startsWith(ASZF_BARION_HORGONY_KEZDET)).toBe(true)
    expect(forrasSzoveg()).toContain(ASZF_BARION_HORGONY_KEZDET)
  })

  it('a 18. + 19. javítás LÁNCA a mai élő ÁSZF-en végigfut', () => {
    // 10. cáfolható állítás: az élő oldalon MA még a STRIPE-os mondat áll,
    // tehát a 19. javítás horgonyát a 18. javítás teremti meg. Rossz
    // sorrendnél (vagy ütköző horgonynál) itt nem lenne beszúrás.
    const eloMa = tartalom([
      'A Vásárló kizárólag 18. életévét betöltött személy lehet. ',
      ELO_FIZETO_BEKEZDES_STRIPE,
      AFA_BEKEZDES,
    ])

    const tenyek = alkalmazAszfBekezdesCserek(eloMa)
    expect(tenyek.content).not.toBeNull()

    const barion = alkalmazAszfBarionKiegeszites(tenyek.content)
    expect(barion.modositasok).toHaveLength(1)

    const szoveg = richTextSzoveg(barion.content)
    expect(szoveg).not.toContain('STRIPE')
    expect(szoveg).toContain('H-EN-I-1064/2013')
    expect(szoveg).toContain('postai kiszállítás nincs')
    expect(szoveg).toContain('27%-os áfatartalommal')
  })

  it('egyik új bekezdés sem nyúl a 27%-os áfa kérdéséhez', () => {
    // Tulajdonosi kikötés: az AAM/27 kérdés még nem dőlt el.
    for (const bekezdes of ASZF_BARION_UJ_BEKEZDESEK) {
      expect(bekezdes).not.toContain('27%')
      expect(bekezdes).not.toContain('áfa')
      expect(bekezdes).not.toContain('alanyi adómentes')
    }
  })
})
