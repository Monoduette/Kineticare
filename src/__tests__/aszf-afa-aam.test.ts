/**
 * 18. tartalom-javítás, harmadik csere — az ÁSZF áfa-mondata.
 *
 * A tulajdonos 2026-09-24-i döntése: a KINETICARE Kft. alanyi adómentes
 * („AAM minden ár”), a számlák élesben `SZAMLAZZ_AFAKULCS=AAM` kulccsal mennek
 * ki (nettó = bruttó, áfa = 0). Az élő ÁSZF viszont még 27%-os áfát ígér; ezt
 * a mondatot kell a számlával egyező állításra cserélni, a jogi szöveg többi
 * részéhez nyúlni nem szabad.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  JOGI_FORRAS_DIR,
  JOGI_OLDALAK,
  jogiOldalTartalom,
  richTextSzoveg,
} from '../lib/legal-content'
import {
  ASZF_AFA_REGI_KEZDET,
  ASZF_AFA_UJ_KEZDET,
  ASZF_BARION_UJ_BEKEZDESEK,
  ASZF_JAVITOTT_BEKEZDES,
  alkalmazAszfAdatvedelemLink,
  alkalmazAszfBarionKiegeszites,
  alkalmazAszfBekezdesCserek,
} from '../scripts/apply-owner-content'
import { para, richText } from '../scripts/restore-legacy-content'

// ---------------------------------------------------------------------------
// Fixtúrák — SZÁNDÉKOSAN LITERÁLOK, nem a kód konstansaiból származtatottak:
// így a konstans elrontása nem rontja el vele együtt a fixtúrát is.
// ---------------------------------------------------------------------------

/** Az élő, RÉGI áfa-bekezdés BETŰRE (a záró szóköz is szándékos). */
const ELO_AFA_BEKEZDES =
  'A fizetést követően a Vásárló a számlát emailben kapja meg link formájában, a Számlázz.hu rendszerén keresztül. A Vásárló elfogadja, hogy a számlát/nyugtát a KINETICARE Kft állítja ki 27%-os áfatartalommal. '

/** A jóváhagyott új áfa-mondatok (a tulajdonos által elfogadott megfogalmazás). */
const UJ_AFA_SZOVEG =
  'A fizetést követően a Vásárló a számlát emailben kapja meg link formájában, a Számlázz.hu rendszerén keresztül. A számlát a KINETICARE Kft. állítja ki. A KINETICARE Kft. az általános forgalmi adóról szóló 2007. évi CXXVII. törvény szerint alanyi adómentes, ezért a számla áfát nem tartalmaz. A Weboldalon feltüntetett ár a fizetendő végösszeg.'

/**
 * Az ÁSZF MÁSIK, szintén „A fizetést követően a Vásárló” kezdetű bekezdése.
 * Ehhez a csere SOHA nem nyúlhat.
 */
const VALASZ_EMAIL_BEKEZDES =
  'A fizetést követően a Vásárló a köteles a válasz emailt elolvasni és aszerint eljárni, ha a spam mappába kerül a levél vagy kézbesíthetetlen üzenet érkezik vissza, azért a KINETICARE nem vállal felelősséget. KINETICARE fenntartja magának a jogot, hogy a beérkezett fizetési kérelmet indoklás nélkül elutasítsa, a hozzáférést megszakítsa és a pénzt visszautalja a bankkártyájára, erről az érintettet a megadott emailen tájékoztatja, aki köteles 72 órán belül elküldeni bankszámlaszámát a visszautaláshoz, amennyiben ezt a KINETICARE kéri.'

/** A 18. javítás első két cseréje UTÁNI fizetés-bekezdés (Barion). */
const FIZETO_BEKEZDES_JAVITVA =
  'A fizetés titkosított csatornán megy végbe, a Weboldaltól függetlenül, a Barion Payment Zrt. által üzemeltetett Barion Smart Gateway fizetési felületén. '

/** A 18. javítás első két cseréje UTÁNI hozzáférés-bekezdés. */
const HOZZAFERES_BEKEZDES_JAVITVA =
  'A szolgáltatás egyszeri fizetéssel jár, a megvásárolt tartalom pedig időbeli korlátozás nélkül, véglegesen elérhető marad a Vásárló számára a felhasználói fiókjában.  Az ismeretterjesztő videó bármely módon történő lementése, másolása akár részben, akár egészben kifejezetten és szigorúan tilos.  '

/** A fizetés-bekezdés a 18. javítás ELŐTT (STRIPE). */
const FIZETO_BEKEZDES_STRIPE =
  'A fizetés titkosított csatornán megy végbe, a Weboldaltól függetlenül, a STRIPE fizetési felületén. '

/** A hozzáférés-bekezdés a 18. javítás ELŐTT (három hónap). */
const HOZZAFERES_BEKEZDES_REGI =
  'A szolgáltatás egyszeri fizetéssel jár, a hozzáférés három hónap időtartamra garantált, azt követően addig tart, amíg a tartalomhoz történő hozzáférést a KINETICARE biztosítja. A KINETICARE bármikor jogosult a harmadik hónap letelte után a felvétel elérését korlátozni, véglegesen lezárni, vagy a felvételt magát a KINETICARE weboldaláról törölni.  Az ismeretterjesztő videó bármely módon történő lementése, másolása akár részben, akár egészben kifejezetten és szigorúan tilos.  '

/** Rich-text tartalom bekezdés-szövegekből. */
const tartalom = (bekezdesek: readonly string[]): unknown =>
  richText(bekezdesek.map((szoveg) => para(szoveg)))

/** A csomópontok listája egy rich-text tartalomból (referencia-összevetéshez). */
const gyerekek = (content: unknown): unknown[] =>
  (content as { root: { children: unknown[] } }).root.children

/**
 * Az élő ÁSZF valószínű mai alakja: a 18. javítás első két cseréje és a 19.
 * javítás már lefutott, az áfa-mondat viszont még a 27%-os.
 */
const eloAszfCsakAfaHibas = (): unknown =>
  tartalom([
    'A Vásárló kizárólag 18. életévét betöltött személy lehet. ',
    HOZZAFERES_BEKEZDES_JAVITVA,
    FIZETO_BEKEZDES_JAVITVA,
    ...ASZF_BARION_UJ_BEKEZDESEK,
    VALASZ_EMAIL_BEKEZDES,
    'A szolgáltatás ára a Weboldalon feltüntetett ár online ismeretterjesztő anyagonként. ',
    ELO_AFA_BEKEZDES,
  ])

/** Az áfa-bekezdés indexe az `eloAszfCsakAfaHibas` fixtúrában. */
const AFA_INDEX = 3 + ASZF_BARION_UJ_BEKEZDESEK.length + 2

/** A válasz email-bekezdés indexe az `eloAszfCsakAfaHibas` fixtúrában. */
const VALASZ_EMAIL_INDEX = 3 + ASZF_BARION_UJ_BEKEZDESEK.length

// ---------------------------------------------------------------------------
// 1. A csere az élő alakon
// ---------------------------------------------------------------------------

describe('alkalmazAszfBekezdesCserek — az áfa-mondat (27% → AAM)', () => {
  it('a 27%-os mondatot az AAM-mondatra cseréli, a záró szóköz marad, minden MÁS csomópont azonos', () => {
    const eredeti = eloAszfCsakAfaHibas()
    const eredmeny = alkalmazAszfBekezdesCserek(eredeti)

    // 1. cáfolható állítás: ha a csere nem fut le, a 27% bennmarad.
    expect(eredmeny.content).not.toBeNull()
    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.modositasok[0].szabaly).toBe('aszf-afa-aam')

    const regi = gyerekek(eredeti)
    const uj = gyerekek(eredmeny.content)
    expect(uj).toHaveLength(regi.length)
    uj.forEach((csomopont, index) => {
      if (index === AFA_INDEX) {
        expect(csomopont).not.toBe(regi[index])
      } else {
        expect(csomopont).toBe(regi[index])
      }
    })

    // A közös kezdetű válasz email-bekezdés is ugyanaz a csomópont maradt.
    expect(uj[VALASZ_EMAIL_INDEX]).toBe(regi[VALASZ_EMAIL_INDEX])

    const sorok = richTextSzoveg(eredmeny.content).split('\n')
    expect(sorok[VALASZ_EMAIL_INDEX]).toBe(VALASZ_EMAIL_BEKEZDES)
    // A bekezdés maradéka (a záró szóköz) betűre megmarad.
    expect(sorok[AFA_INDEX]).toBe(`${UJ_AFA_SZOVEG} `)
    expect(sorok.join('\n')).not.toContain('27%')
    expect(sorok.join('\n')).not.toContain('áfatartalommal')
  })

  it('a másik két csere halkan kihagy, mert azok már lefutottak', () => {
    const eredmeny = alkalmazAszfBekezdesCserek(eloAszfCsakAfaHibas())
    expect(eredmeny.kihagyasok.map((lepes) => lepes.szabaly)).toEqual([
      'aszf-fizetesi-szolgaltato',
      'aszf-hozzaferes-idotartam',
    ])
    for (const kihagyas of eredmeny.kihagyasok) {
      expect(kihagyas.hangos).not.toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------
// 2. Idempotencia
// ---------------------------------------------------------------------------

describe('alkalmazAszfBekezdesCserek — az áfa-csere idempotenciája', () => {
  it('másodszor futva SEMMIT nem ír, és az áfa-csere halkan kihagy', () => {
    const elso = alkalmazAszfBekezdesCserek(eloAszfCsakAfaHibas())
    const masodik = alkalmazAszfBekezdesCserek(elso.content)

    // 2. cáfolható állítás: idempotencia nélkül minden futás új verziót
    // gyártana az élő jogi oldalon.
    expect(masodik.content).toBeNull()
    expect(masodik.modositasok).toHaveLength(0)
    const afa = masodik.kihagyasok.find((lepes) => lepes.szabaly === 'aszf-afa-aam')
    expect(afa).toBeDefined()
    expect(afa?.indok).toContain('MÁR a javított szöveggel')
    expect(afa?.hangos).not.toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 3. A szerkesztő szövegének védelme
// ---------------------------------------------------------------------------

describe('alkalmazAszfBekezdesCserek — szerkesztett áfa-bekezdés', () => {
  it('az első mondattal kezdődő, de ÁTÍRT bekezdést nem írja felül, hangosan kihagy és idéz', () => {
    const szerkesztett =
      'A fizetést követően a Vásárló a számlát emailben kapja meg link formájában, a Számlázz.hu rendszerén keresztül. A számlán az ár egyösszegű.'
    const eredmeny = alkalmazAszfBekezdesCserek(
      tartalom([
        HOZZAFERES_BEKEZDES_JAVITVA,
        FIZETO_BEKEZDES_JAVITVA,
        VALASZ_EMAIL_BEKEZDES,
        szerkesztett,
      ]),
    )

    // 3. cáfolható állítás: a szerkesztői mondat NEM íródik felül…
    expect(eredmeny.content).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    const afa = eredmeny.kihagyasok.find((lepes) => lepes.szabaly === 'aszf-afa-aam')
    // …a kihagyás HANGOS…
    expect(afa?.hangos).toBe(true)
    // …és a napló a MOSTANI szöveget idézi (a válasz email-bekezdést nem).
    expect(afa?.indok).toContain('a helyén ez áll')
    expect(afa?.indok).toContain('A számlán az ár egyösszegű.')
    expect(afa?.indok).not.toContain('köteles')
  })
})

// ---------------------------------------------------------------------------
// 4. A közös kezdetű másik bekezdés
// ---------------------------------------------------------------------------

describe('alkalmazAszfBekezdesCserek — a válasz email-bekezdés érinthetetlen', () => {
  it('ha CSAK a válasz email-bekezdés van a lapon, nem ír, és nem tekinti áfa-mondatnak', () => {
    const eredeti = tartalom([
      HOZZAFERES_BEKEZDES_JAVITVA,
      FIZETO_BEKEZDES_JAVITVA,
      VALASZ_EMAIL_BEKEZDES,
    ])
    const eredmeny = alkalmazAszfBekezdesCserek(eredeti)

    // 4. cáfolható állítás: ha a régi kezdet csak a közös szavakig érne, a
    // válasz email-bekezdés íródna át.
    expect(eredmeny.content).toBeNull()
    expect(eredmeny.modositasok).toHaveLength(0)
    const afa = eredmeny.kihagyasok.find((lepes) => lepes.szabaly === 'aszf-afa-aam')
    expect(afa?.hangos).toBe(true)
    expect(afa?.indok).toContain('sincs a lapon')
  })

  it('a régi és az új kezdet sem illeszkedik a válasz email-bekezdésre', () => {
    expect(VALASZ_EMAIL_BEKEZDES.startsWith(ASZF_AFA_REGI_KEZDET)).toBe(false)
    expect(VALASZ_EMAIL_BEKEZDES.startsWith(ASZF_AFA_UJ_KEZDET)).toBe(false)
  })

  it('a forrásfájlban TÉNYLEG két bekezdés indul a közös szavakkal, de csak egy az AAM-mondattal', () => {
    // Ez indokolja a TELJES két mondatos régi kezdetet: rövidebb illesztéssel
    // a csere a „nem egyértelmű” ágra futna, vagy rossz bekezdést írna át.
    const oldal = JOGI_OLDALAK.find((elem) => elem.slug === 'aszf')
    expect(oldal).toBeDefined()
    const sorok = richTextSzoveg(jogiOldalTartalom(oldal!)).split('\n')
    expect(sorok.filter((sor) => sor.startsWith('A fizetést követően a Vásárló'))).toHaveLength(2)
    expect(sorok.filter((sor) => sor.startsWith(ASZF_AFA_UJ_KEZDET))).toHaveLength(1)
    expect(sorok).toContain(VALASZ_EMAIL_BEKEZDES)
  })
})

// ---------------------------------------------------------------------------
// 5. A jogi forrásfájl
// ---------------------------------------------------------------------------

describe('az ÁSZF forrásfájlja az AAM-mondatot hozza', () => {
  it('a generált ÁSZF az AAM-mondatot tartalmazza, 27%-ot és „áfatartalommal” szót nem', () => {
    const oldal = JOGI_OLDALAK.find((elem) => elem.slug === 'aszf')
    expect(oldal).toBeDefined()
    const szoveg = richTextSzoveg(jogiOldalTartalom(oldal!))

    // 5. cáfolható állítás: ha a `legal-source/aszf.txt`-be visszakerülne a
    // 27%-os mondat, egy újonnan létrehozott ÁSZF-oldal megint 27%-ot ígérne.
    expect(szoveg).toContain(UJ_AFA_SZOVEG)
    expect(szoveg).not.toContain('27%')
    expect(szoveg).not.toContain('áfatartalommal')
  })

  it('az aszf.txt PONTOSAN egyszer tartalmazza az új kezdetet, záró szóközzel', () => {
    const nyers = readFileSync(path.join(JOGI_FORRAS_DIR, 'aszf.txt'), 'utf8')
    expect(nyers.split(ASZF_AFA_UJ_KEZDET).length - 1).toBe(1)
    expect(nyers.split('\n')).toContain(`${ASZF_AFA_UJ_KEZDET} `)
  })

  it('a kódbeli konstansok betűre a jóváhagyott szöveggel és a mért élő szöveggel egyeznek', () => {
    expect(ASZF_AFA_UJ_KEZDET).toBe(UJ_AFA_SZOVEG)
    expect(ELO_AFA_BEKEZDES.startsWith(ASZF_AFA_REGI_KEZDET)).toBe(true)
    expect(ELO_AFA_BEKEZDES.slice(ASZF_AFA_REGI_KEZDET.length)).toBe(' ')
    // A tulajdonos kikötése: gondolatjel nem kerülhet a vevői szövegbe.
    expect(ASZF_AFA_UJ_KEZDET).not.toMatch(/[–—]/)
  })
})

// ---------------------------------------------------------------------------
// 6. A teljes lánc (14. → 18. → 19. javítás), ahogy a fő futás hívja
// ---------------------------------------------------------------------------

/** A fő futás ÁSZF-lánca: 14 → 18 → 19, a `??` visszaesésekkel együtt. */
const futtasdALancot = (
  eredeti: unknown,
): { vegso: unknown | null; modositasok: number; hangos: number } => {
  const link = alkalmazAszfAdatvedelemLink(eredeti)
  const tenyek = alkalmazAszfBekezdesCserek(link.content ?? eredeti)
  const barion = alkalmazAszfBarionKiegeszites(tenyek.content ?? link.content ?? eredeti)
  const lepesek = [link, tenyek, barion]
  return {
    vegso: barion.content ?? tenyek.content ?? link.content,
    modositasok: lepesek.reduce((osszeg, lepes) => osszeg + lepes.modositasok.length, 0),
    hangos: lepesek.reduce(
      (osszeg, lepes) => osszeg + lepes.kihagyasok.filter((k) => k.hangos === true).length,
      0,
    ),
  }
}

describe('a 14. → 18. → 19. javítás lánca a teljesen javítatlan ÁSZF-en', () => {
  const teljesenJavitatlan = (): unknown =>
    tartalom([
      'A Vásárló kizárólag 18. életévét betöltött személy lehet. ',
      'Adatkezelési tájékoztatónkat az alábbi linken érheti el: [xxx]',
      HOZZAFERES_BEKEZDES_REGI,
      FIZETO_BEKEZDES_STRIPE,
      VALASZ_EMAIL_BEKEZDES,
      'A szolgáltatás ára a Weboldalon feltüntetett ár online ismeretterjesztő anyagonként. ',
      ELO_AFA_BEKEZDES,
    ])

  it('az eredményben ott az AAM-mondat és a Barion-bekezdések, 27% nincs', () => {
    const lanc = futtasdALancot(teljesenJavitatlan())

    // 6. cáfolható állítás: a lánc minden eleme lefut, hangos kihagyás nélkül.
    expect(lanc.vegso).not.toBeNull()
    expect(lanc.hangos).toBe(0)
    // 14: 1 csere; 18: 3 csere; 19: 1 beszúrás.
    expect(lanc.modositasok).toBe(5)

    const sorok = richTextSzoveg(lanc.vegso).split('\n')
    expect(sorok).toContain(`${UJ_AFA_SZOVEG} `)
    expect(sorok).toContain(ASZF_JAVITOTT_BEKEZDES)
    expect(sorok).toContain(VALASZ_EMAIL_BEKEZDES)
    for (const bekezdes of ASZF_BARION_UJ_BEKEZDESEK) {
      expect(sorok).toContain(bekezdes)
    }
    const szoveg = sorok.join('\n')
    expect(szoveg).not.toContain('27%')
    expect(szoveg).not.toContain('áfatartalommal')
    expect(szoveg).not.toContain('STRIPE')
  })

  it('a lánc második futása már semmit nem ír', () => {
    const elso = futtasdALancot(teljesenJavitatlan())
    const masodik = futtasdALancot(elso.vegso)
    expect(masodik.vegso).toBeNull()
    expect(masodik.modositasok).toBe(0)
    expect(masodik.hangos).toBe(0)
  })
})
