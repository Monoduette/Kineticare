/**
 * 18. tartalom-javítás — az ÉLŐ ÁSZF ténybeli hibái. A harmadik csere
 * (tulajdonosi döntés, 2026-09-24) a 27%-os áfa-mondatot írja át alanyi
 * adómentesre; annak fókuszált tesztjei az `aszf-afa-aam.test.ts`-ben vannak.
 * A javítás a Barion elfogadóhely-jóváhagyás miatt sürgős és önálló
 * kockázatú: az élő ÁSZF egy MÁSIK fizetési szolgáltatót (STRIPE) nevez meg,
 * miközben a fizetés a Barion Smart Gateway-en megy — a bíráló pedig az ÉLŐ
 * oldalt nézi át. A második csere a „három hónap időtartamra garantált"
 */

import { describe, expect, it } from 'vitest'

import { JOGI_OLDALAK, jogiOldalTartalom, richTextSzoveg } from '../lib/legal-content'
import {
  ASZF_AFA_REGI_KEZDET,
  ASZF_AFA_UJ_KEZDET,
  ASZF_BEKEZDES_CSEREK,
  ASZF_FIZETO_REGI_KEZDET,
  ASZF_FIZETO_UJ_KEZDET,
  ASZF_HOZZAFERES_REGI_KEZDET,
  ASZF_HOZZAFERES_UJ_KEZDET,
  alkalmazAszfBekezdesCserek,
} from '../scripts/apply-owner-content'
import { para, richText } from '../scripts/restore-legacy-content'

// ---------------------------------------------------------------------------
// Fixtúrák — az ÉLŐ oldal mai bekezdései, BETŰRE (a záró és a mondatközi
// dupla szóköz is szándékos: a forrásfájl szó szerinti másolata).
// ---------------------------------------------------------------------------

/**
 * A bekezdés MARADÉKA, aminek mindkét cserénél változatlanul kell maradnia.
 *
 * SZÁNDÉKOSAN LITERÁL, nem a kód konstansaiból származtatott: ez az élő oldal
 * MÉRT szövege (a `legal-source/aszf.txt` 2026-08-17 előtti alakja). Ha a
 * fixtúrát a konstansokból építenénk, a konstans elrontása a fixtúrát is
 * elrontaná — a teszt önmagával lenne konzisztens, és semmit nem bizonyítana.
 */
const MASOLAS_TILALMA =
  '  Az ismeretterjesztő videó bármely módon történő lementése, másolása akár részben, akár egészben kifejezetten és szigorúan tilos.  '

/** Az élő, RÉGI hozzáférés-bekezdés BETŰRE (két cserélendő mondat + a maradék). */
const ELO_HOZZAFERES_BEKEZDES = `A szolgáltatás egyszeri fizetéssel jár, a hozzáférés három hónap időtartamra garantált, azt követően addig tart, amíg a tartalomhoz történő hozzáférést a KINETICARE biztosítja. A KINETICARE bármikor jogosult a harmadik hónap letelte után a felvétel elérését korlátozni, véglegesen lezárni, vagy a felvételt magát a KINETICARE weboldaláról törölni.${MASOLAS_TILALMA}`

/** Az élő, RÉGI fizetés-bekezdés BETŰRE (egyetlen mondat, záró szóközzel). */
const ELO_FIZETO_BEKEZDES =
  'A fizetés titkosított csatornán megy végbe, a Weboldaltól függetlenül, a STRIPE fizetési felületén. '

/**
 * Az élő, RÉGI áfa-bekezdés BETŰRE (27%-os mondattal, záró szóközzel). A
 * tulajdonos 2026-09-24-i döntése óta (a KINETICARE Kft. alanyi adómentes) a
 * 18. javítás harmadik cseréje írja át.
 */
const ELO_AFA_BEKEZDES =
  'A fizetést követően a Vásárló a számlát emailben kapja meg link formájában, a Számlázz.hu rendszerén keresztül. A Vásárló elfogadja, hogy a számlát/nyugtát a KINETICARE Kft állítja ki 27%-os áfatartalommal. '

/**
 * Az ÁSZF MÁSIK, szintén „A fizetést követően a Vásárló” kezdetű bekezdése
 * (a válasz email elolvasásáról). Egyik csere sem érintheti.
 */
const VALASZ_EMAIL_BEKEZDES =
  'A fizetést követően a Vásárló a köteles a válasz emailt elolvasni és aszerint eljárni, ha a spam mappába kerül a levél vagy kézbesíthetetlen üzenet érkezik vissza, azért a KINETICARE nem vállal felelősséget. KINETICARE fenntartja magának a jogot, hogy a beérkezett fizetési kérelmet indoklás nélkül elutasítsa, a hozzáférést megszakítsa és a pénzt visszautalja a bankkártyájára, erről az érintettet a megadott emailen tájékoztatja, aki köteles 72 órán belül elküldeni bankszámlaszámát a visszautaláshoz, amennyiben ezt a KINETICARE kéri.'

/** Rich-text tartalom bekezdés-szövegekből. */
const tartalom = (bekezdesek: readonly string[]): unknown =>
  richText(bekezdesek.map((szoveg) => para(szoveg)))

/** Az élő ÁSZF javítatlan alakja — a három hibás bekezdéssel. */
const eloAszf = (): unknown =>
  tartalom([
    'A Vásárló kizárólag 18. életévét betöltött személy lehet. ',
    ELO_HOZZAFERES_BEKEZDES,
    'Részletfizetés nem lehetséges.',
    ELO_FIZETO_BEKEZDES,
    VALASZ_EMAIL_BEKEZDES,
    ELO_AFA_BEKEZDES,
  ])

/** A csomópontok listája egy rich-text tartalomból (referencia-összevetéshez). */
const gyerekek = (content: unknown): unknown[] =>
  (content as { root: { children: unknown[] } }).root.children

describe('alkalmazAszfBekezdesCserek — a fizetési szolgáltató neve', () => {
  it('a STRIPE-ot a Barion Smart Gateway-re cseréli', () => {
    const eredmeny = alkalmazAszfBekezdesCserek(eloAszf())
    const szoveg = richTextSzoveg(eredmeny.content)

    // 1. cáfolható állítás: ha a csere nem fut le, a STRIPE bennmarad.
    expect(szoveg).not.toContain('STRIPE')
    expect(szoveg).toContain(ASZF_FIZETO_UJ_KEZDET)
    expect(szoveg).toContain('Barion Payment Zrt.')
  })

  it('a bekezdés záró szóközét is megőrzi (a maradék byte-ra változatlan)', () => {
    const eredmeny = alkalmazAszfBekezdesCserek(eloAszf())
    const sorok = richTextSzoveg(eredmeny.content).split('\n')
    expect(sorok).toContain(`${ASZF_FIZETO_UJ_KEZDET} `)
  })
})

describe('alkalmazAszfBekezdesCserek — a hozzáférés időtartama', () => {
  it('a három hónapos kikötés eltűnik', () => {
    const szoveg = richTextSzoveg(alkalmazAszfBekezdesCserek(eloAszf()).content)

    // 2. cáfolható állítás: a korlátozó mondat egyetlen nyoma sem maradhat.
    expect(szoveg).not.toContain('három hónap')
    expect(szoveg).not.toContain('határozott időtartamú hozzáférést biztosít')
    expect(szoveg).toContain(ASZF_HOZZAFERES_UJ_KEZDET)
  })

  it('a lezárási jogot kimondó mondat is eltűnik', () => {
    const szoveg = richTextSzoveg(alkalmazAszfBekezdesCserek(eloAszf()).content)

    // 3. cáfolható állítás: ha csak az ELSŐ mondatot cserélnénk, ez bennmaradna.
    expect(szoveg).not.toContain('harmadik hónap letelte')
    expect(szoveg).not.toContain('véglegesen lezárni')
    expect(szoveg).not.toContain('weboldaláról törölni')
  })

  it('a bekezdés MARADÉKA (a másolás tilalma) betűre változatlan', () => {
    const szoveg = richTextSzoveg(alkalmazAszfBekezdesCserek(eloAszf()).content)

    // 7. cáfolható állítás: teljes bekezdés-csere esetén ez a mondat elveszne.
    expect(szoveg).toContain(`${ASZF_HOZZAFERES_UJ_KEZDET}${MASOLAS_TILALMA}`)
  })
})

describe('alkalmazAszfBekezdesCserek — amihez NEM szabad hozzányúlni', () => {
  it('a válasz emailről szóló, szintén „A fizetést követően” kezdetű bekezdés sértetlen, a csomópont UGYANAZ marad', () => {
    const eredeti = eloAszf()
    const eredmeny = alkalmazAszfBekezdesCserek(eredeti)
    const szoveg = richTextSzoveg(eredmeny.content)

    // 6. cáfolható állítás: az áfa-csere a TELJES két mondatos régi kezdetre
    // illeszt, ezért a közös szavakkal induló másik bekezdés szövege és
    // csomópont-referenciája is változatlan — a script hozzá sem ér.
    expect(szoveg).toContain(VALASZ_EMAIL_BEKEZDES)
    expect(gyerekek(eredmeny.content)[4]).toBe(gyerekek(eredeti)[4])
  })

  it('a nem érintett bekezdések csomópontjai referencia szerint azonosak', () => {
    const eredeti = eloAszf()
    const eredmeny = alkalmazAszfBekezdesCserek(eredeti)
    const regi = gyerekek(eredeti)
    const uj = gyerekek(eredmeny.content)

    expect(uj[0]).toBe(regi[0])
    expect(uj[2]).toBe(regi[2])
    expect(uj[4]).toBe(regi[4])
    expect(uj[1]).not.toBe(regi[1])
    expect(uj[3]).not.toBe(regi[3])
    expect(uj[5]).not.toBe(regi[5])
  })
})

describe('alkalmazAszfBekezdesCserek — idempotencia', () => {
  it('másodszor futva SEMMIT nem ír, és nem is kiabál', () => {
    const elso = alkalmazAszfBekezdesCserek(eloAszf())
    expect(elso.modositasok).toHaveLength(ASZF_BEKEZDES_CSEREK.length)

    const masodik = alkalmazAszfBekezdesCserek(elso.content)

    // 4. cáfolható állítás: ha az idempotencia elvész, itt újabb módosítás
    // keletkezne — és az élő oldalon minden futás új verziót gyártana.
    expect(masodik.modositasok).toHaveLength(0)
    expect(masodik.content).toBeNull()
    expect(masodik.kihagyasok).toHaveLength(ASZF_BEKEZDES_CSEREK.length)
    for (const kihagyas of masodik.kihagyasok) {
      expect(kihagyas.indok).toContain('MÁR a javított szöveggel kezdődik')
      // HALK kihagyás: ez a legjobb lehetséges kimenet, nem hiba.
      expect(kihagyas.hangos).not.toBe(true)
    }
  })

  it('a harmadik futás is stabil (a kimenet nem oszcillál)', () => {
    const elso = alkalmazAszfBekezdesCserek(eloAszf())
    const masodik = alkalmazAszfBekezdesCserek(elso.content)
    const harmadik = alkalmazAszfBekezdesCserek(masodik.content ?? elso.content)
    expect(harmadik.content).toBeNull()
    expect(harmadik.modositasok).toHaveLength(0)
  })
})

describe('alkalmazAszfBekezdesCserek — a szerkesztő szövegének védelme', () => {
  it('SZERKESZTETT bekezdést nem ír át, hangosan kihagy, és kiírja, mit talált', () => {
    const sajatSzoveg =
      'A fizetés titkosított csatornán megy végbe, a Weboldaltól függetlenül, a bankunk fizetési felületén, 2026 őszétől.'
    const eredmeny = alkalmazAszfBekezdesCserek(tartalom([sajatSzoveg, ELO_HOZZAFERES_BEKEZDES]))

    const fizeto = eredmeny.kihagyasok.find(
      (lepes) => lepes.szabaly === 'aszf-fizetesi-szolgaltato',
    )
    expect(fizeto).toBeDefined()

    // 5. cáfolható állítás: a szerkesztői mondat NEM íródik felül…
    expect(richTextSzoveg(eredmeny.content)).toContain(sajatSzoveg)
    // …a kihagyás HANGOS…
    expect(fizeto?.hangos).toBe(true)
    // …és a napló megmondja, mit talált a helyén.
    expect(fizeto?.indok).toContain('a helyén ez áll')
    expect(fizeto?.indok).toContain('a bankunk fizetési felületén')
  })

  it('egy rossz bekezdés NEM blokkolja a többi javítását', () => {
    const eredmeny = alkalmazAszfBekezdesCserek(
      tartalom([
        'Teljesen más fizetési mondat áll itt.',
        ELO_HOZZAFERES_BEKEZDES,
        ELO_AFA_BEKEZDES,
      ]),
    )

    // 8. cáfolható állítás: a cserék FÜGGETLENEK — az egyik hangos kihagyása
    // mellett a többi lefut.
    expect(eredmeny.modositasok.map((lepes) => lepes.szabaly)).toEqual([
      'aszf-hozzaferes-idotartam',
      'aszf-afa-aam',
    ])
    expect(eredmeny.kihagyasok).toHaveLength(1)
    expect(eredmeny.kihagyasok[0].szabaly).toBe('aszf-fizetesi-szolgaltato')
    expect(eredmeny.kihagyasok[0].hangos).toBe(true)
    expect(richTextSzoveg(eredmeny.content)).toContain(ASZF_HOZZAFERES_UJ_KEZDET)
    expect(richTextSzoveg(eredmeny.content)).toContain(ASZF_AFA_UJ_KEZDET)
  })

  it('TÖBB egyforma bekezdésnél nem dönt maga', () => {
    const eredmeny = alkalmazAszfBekezdesCserek(
      tartalom([ELO_FIZETO_BEKEZDES, ELO_FIZETO_BEKEZDES]),
    )
    const fizeto = eredmeny.kihagyasok.find(
      (lepes) => lepes.szabaly === 'aszf-fizetesi-szolgaltato',
    )
    expect(fizeto?.hangos).toBe(true)
    expect(fizeto?.indok).toContain('nem egyértelmű')
    expect(richTextSzoveg(eredmeny.content ?? tartalom([ELO_FIZETO_BEKEZDES]))).toContain('STRIPE')
  })

  it('idegen szerkezetnél MINDEN szabály hangosan kihagy', () => {
    const eredmeny = alkalmazAszfBekezdesCserek({ nem: 'richtext' })
    expect(eredmeny.content).toBeNull()
    expect(eredmeny.kihagyasok).toHaveLength(ASZF_BEKEZDES_CSEREK.length)
    for (const kihagyas of eredmeny.kihagyasok) {
      expect(kihagyas.hangos).toBe(true)
    }
  })
})

describe('a kódbeli mondatok és a jogi forrásfájl összhangja', () => {
  const aszfLeiras = () => {
    const oldal = JOGI_OLDALAK.find((elem) => elem.slug === 'aszf')
    expect(oldal).toBeDefined()
    return oldal!
  }

  it('a forrásfájlból generált ÁSZF MÁR a javított mondatokat hozza', () => {
    // 9. cáfolható állítás: ha valaki visszaírná a régi mondatokat a
    // `src/lib/legal-source/aszf.txt`-be, ez a teszt bukik.
    const szoveg = richTextSzoveg(jogiOldalTartalom(aszfLeiras()))
    expect(szoveg).toContain(ASZF_FIZETO_UJ_KEZDET)
    expect(szoveg).toContain(ASZF_HOZZAFERES_UJ_KEZDET)
    expect(szoveg).toContain(ASZF_AFA_UJ_KEZDET)
    expect(szoveg).not.toContain(ASZF_FIZETO_REGI_KEZDET)
    expect(szoveg).not.toContain(ASZF_HOZZAFERES_REGI_KEZDET)
    expect(szoveg).not.toContain(ASZF_AFA_REGI_KEZDET)
    expect(szoveg).not.toContain('STRIPE')
  })

  it('a forrásfájlból generált ÁSZF-en a javításnak NINCS teendője', () => {
    // Ez köti össze a két felet, és egyben a konstansok BETŰHÍVSÉGÉT bizonyítja:
    // egy frissen létrehozott oldalon már minden a helyén van, tehát a script
    // halkan kihagy — ha a konstans akár egy szóközzel elcsúszna a forrástól,
    // itt HANGOS kihagyás keletkezne.
    const eredmeny = alkalmazAszfBekezdesCserek(jogiOldalTartalom(aszfLeiras()))
    expect(eredmeny.content).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    expect(eredmeny.kihagyasok).toHaveLength(ASZF_BEKEZDES_CSEREK.length)
    for (const kihagyas of eredmeny.kihagyasok) {
      expect(kihagyas.hangos).not.toBe(true)
    }
  })

  it('a kódbeli RÉGI mondatok betűre az élő oldal mai szövegével kezdődnek', () => {
    // A cserélendő szöveg az élő adatbázis MÉRT ténye. Ha a konstans akár egy
    // karakterrel elcsúszik tőle, az éles futás semmit nem talál, és a STRIPE
    // bennmarad — ezért itt a LITERÁL fixtúrához mérjük, nem önmagához.
    expect(ELO_FIZETO_BEKEZDES.startsWith(ASZF_FIZETO_REGI_KEZDET)).toBe(true)
    expect(ELO_HOZZAFERES_BEKEZDES.startsWith(ASZF_HOZZAFERES_REGI_KEZDET)).toBe(true)
    expect(ELO_AFA_BEKEZDES.startsWith(ASZF_AFA_REGI_KEZDET)).toBe(true)
    // A régi kezdet a TELJES cserélendő rész: a maradék már a megtartandó
    // mondat (illetve a fizetés- és az áfa-bekezdésnél csak a záró szóköz).
    expect(ELO_FIZETO_BEKEZDES.slice(ASZF_FIZETO_REGI_KEZDET.length)).toBe(' ')
    expect(ELO_AFA_BEKEZDES.slice(ASZF_AFA_REGI_KEZDET.length)).toBe(' ')
    expect(ELO_HOZZAFERES_BEKEZDES.slice(ASZF_HOZZAFERES_REGI_KEZDET.length)).toBe(MASOLAS_TILALMA)
  })

  it('az áfa-mondat a 2026-09-24-i AAM-döntést követi, a 27% sehol nem marad', () => {
    // Tulajdonosi döntés: a KINETICARE Kft. alanyi adómentes, a számlák AAM
    // kulccsal mennek ki. A 27%-ot csak az áfa-csere RÉGI kezdete említheti.
    for (const csere of ASZF_BEKEZDES_CSEREK) {
      expect(csere.ujKezdet).not.toContain('27%')
      expect(csere.nyom).not.toContain('27%')
      if (csere.szabaly !== 'aszf-afa-aam') {
        expect(csere.regiKezdet).not.toContain('27%')
      }
    }
    const afaCsere = ASZF_BEKEZDES_CSEREK.find((csere) => csere.szabaly === 'aszf-afa-aam')
    expect(afaCsere?.regiKezdet).toBe(ASZF_AFA_REGI_KEZDET)
    expect(afaCsere?.ujKezdet).toBe(ASZF_AFA_UJ_KEZDET)

    const szoveg = richTextSzoveg(jogiOldalTartalom(aszfLeiras()))
    expect(szoveg).toContain('alanyi adómentes, ezért a számla áfát nem tartalmaz')
    expect(szoveg).not.toContain('27%')
    expect(szoveg).not.toContain('áfatartalommal')
  })
})
