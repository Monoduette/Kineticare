import { describe, expect, it } from 'vitest'

import {
  HOME_HELP_LEAD,
  HOME_HELP_STATES,
  homeHelpFallbackMedia,
  presentHomeLayout,
  presentSzolgaltatasokLayout,
} from '../lib/home-help-states'
import type { BlockServices, Page } from '../payload-types'
import {
  regiKodSinE,
  sinElrendezesKitoltese,
  type SinElrendezesKitoltes,
} from '../scripts/sin-elrendezes-kitoltes'

/**
 * A services `elrendezes` + `hatter` előtöltő szabálya (H15, A4 adat;
 * src/scripts/sin-elrendezes-kitoltes.ts).
 *
 * A fixtúrák az élő lapok services blokkjai (live-pages.json, 2026-09-23): az
 * azonosítók, az elrendezés, a háttér, a sorcímek, a CTA-k és az URL-ek szó
 * szerint, néhány hosszú törzsszöveg és a szomszéd blokkok rövidítve (a
 * döntést egyik sem befolyásolja). A „régi kód” várt kimenetét a
 * 793fe0b állapot `presentHomeLayout` / `presentSzolgaltatasokLayout`
 * függvénye adta ugyanezeken az alakokon: a vezető naplójában rögzített mérés
 * szerint a régi kód kimenete a szabály ELŐTTI adaton mélyen egyezik az új
 * kód kimenetével a szabály UTÁNI adaton, a szabály nélkül pedig nem.
 */

type Szekciosor = NonNullable<Page['layout']>

/** Mélyen fagyasztott másolat: ha a szabály írna a bemenetbe, a teszt dob. */
function fagyaszt<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const inner of Object.values(value)) fagyaszt(inner)
    Object.freeze(value)
  }
  return value
}

const klon = <T>(value: T): T => structuredClone(value)

const KEZDOLAP_SEGITSEG = {
  id: '6a77d01c912afa00500f9823',
  eyebrow: 'Szolgáltatásaink',
  title: 'Így tudunk segíteni',
  lead: null,
  elrendezes: 'tabla',
  image: 31,
  blockName: null,
  rows: [
    {
      id: '6a77d01c912afa00500f9820',
      number: '01',
      title: 'Rendelői kezelések',
      osszefoglalo: null,
      body: 'Akut sérülések, műtét utáni állapotok és krónikus fájdalmak esetén a mozgásterápia a gyógyulás alappillére. Gyógytornával, manuálterápiával és egy sor kiegészítő terápiával várunk a stúdiónkban.',
      photo: null,
      felirat: 'Tovább a kezelésekre',
      url: '/szolgaltatasok',
      ujAblakban: false,
    },
    {
      id: '6a77d01c912afa00500f9821',
      number: '02',
      title: 'Otthoni program',
      osszefoglalo: null,
      body: 'Otthoni videókurzusunkkal a saját tempódban gyakorolhatsz. A teljes program tartalmát és árát a kurzus oldalán találod.',
      photo: null,
      felirat: 'Nézd meg a kurzusokat',
      url: '/kurzusok',
      ujAblakban: false,
    },
    {
      id: '6a77d01c912afa00500f9822',
      number: '03',
      title: 'Szakmai képzések',
      osszefoglalo: null,
      body: 'Akkreditált tantermi kézkurzusunkat a ProBody Stúdióval együttműködve hoztuk létre a kéz, a csukló- és könyökízület rehabilitációs lehetőségeiről gyógytornászoknak, orvosoknak, erőnléti és szakági edzőknek.',
      photo: null,
      felirat: 'Nézd meg a kézworkshopot',
      url: 'https://probodystudio.hu/kez-workshop/',
      ujAblakban: true,
    },
  ],
  blockType: 'services',
  sectionSettings: { visible: true, anchorId: null, hatter: 'feher' },
}

const KEZDOLAP_ERRE_SZAMITHATSZ = {
  id: '6a9c96a036937b2ea7011293',
  eyebrow: null,
  title: 'Erre számíthatsz velünk',
  lead: '',
  elrendezes: 'tabla',
  image: 40,
  blockName: null,
  rows: [
    { id: 'e1', number: '01', title: 'Szakmai figyelem', body: 'Első.', photo: null },
    { id: 'e2', number: '02', title: 'Segítség a mindennapokhoz', body: 'Második.', photo: null },
  ],
  blockType: 'services',
  sectionSettings: { visible: true, anchorId: null, hatter: 'feher' },
}

/** Az élő kezdőlap szekciósora (a services blokkok szó szerint, a többi rövidítve). */
const kezdolap = (): Szekciosor =>
  klon([
    { id: 'hero', blockType: 'filmHero', title: 'Hatékony és biztonságos módszerek' },
    { id: 'about', blockType: 'about', title: 'Megérdemled a profi törődést' },
    { id: 'press', blockType: 'pressLogos' },
    { id: 'creds', blockType: 'credsStrip', sectionSettings: { hatter: 'feher' } },
    KEZDOLAP_SEGITSEG,
    { id: 'kartyak', blockType: 'courseCards' },
    { id: 'sos', blockType: 'freeSos', title: 'Ingyenes villámkurzus' },
    { id: 'welcome', blockType: 'welcome', title: 'Szeretnél megszabadulni a fájdalomtól?' },
    KEZDOLAP_ERRE_SZAMITHATSZ,
    { id: 'cta', blockType: 'ctaBanner', title: 'Kezdd el még ma' },
  ]) as unknown as Szekciosor

const SZOLG_AJTO = {
  id: '6a81644079c56f0072e916ec',
  eyebrow: 'Szolgáltatásaink',
  title: 'Így segítünk',
  lead: null,
  elrendezes: 'tabla',
  image: 12,
  blockName: null,
  rows: [
    {
      id: '6a81644079c56f0072e916e9',
      number: '01',
      title: 'Rendelői kezelések',
      osszefoglalo: null,
      body: 'Akut sérülés, műtét utáni állapot vagy krónikus fájdalom esetén: egyénre szabott gyógytorna, manuálterápia és kiegészítő terápiák.',
      photo: null,
      felirat: 'Időpontot kérek',
      url: '/kapcsolat',
      ujAblakban: false,
    },
    {
      id: '6a81644079c56f0072e916ea',
      number: '02',
      title: 'Otthoni online program',
      osszefoglalo: null,
      body: 'Otthoni videókurzusunkkal a saját tempódban gyakorolhatsz. A teljes program tartalmát és árát a kurzus oldalán találod.',
      photo: null,
      felirat: 'Nézd meg a teljes kurzust',
      url: '/kurzusok/otthoni-kezrehab-program',
      ujAblakban: false,
    },
    {
      id: '6a81644079c56f0072e916eb',
      number: '03',
      title: 'Szakmai képzések',
      osszefoglalo: null,
      body: 'Gyógytornászoknak, orvosoknak, mozgásterapeutáknak és edzőknek: akkreditált tantermi képzés.',
      photo: null,
      felirat: 'Nézd meg a kézworkshopot',
      url: 'https://probodystudio.hu/kez-workshop/',
      ujAblakban: true,
    },
  ],
  blockType: 'services',
  sectionSettings: { visible: true, anchorId: 'szolgaltatasaink', hatter: 'tint' },
}

/**
 * Az „Amit a rendelőben kínálunk” technika-tábla (élőben öt sor, itt háromra
 * rövidítve, üres felirattal és URL-lel): így a háromsoros, de CTA nélküli,
 * tehát nem ajtó eset is le van fedve.
 */
const SZOLG_TECHNIKAK = {
  id: '6aaf0eb0325e7f002245b334',
  eyebrow: 'Rendelői kezelések',
  title: 'Amit a rendelőben kínálunk',
  lead: 'Vizsgálat után ezekből állítjuk össze a kezelési tervedet.',
  elrendezes: 'tabla',
  image: 44,
  rows: ['Gyógytorna', 'Manuálterápia', 'Kinesio Tape és Dynamic Tape'].map((title, index) => ({
    id: `t${index}`,
    number: String(index + 1),
    title,
    body: 'Szöveg.',
    felirat: '',
    url: '',
    photo: null,
  })),
  blockType: 'services',
  sectionSettings: { visible: true, anchorId: 'technikak', hatter: 'feher' },
}

const SZOLG_EZERT = {
  id: '6a9c9118d73a76a3a4c168c7',
  eyebrow: null,
  title: 'Ezért fogod imádni',
  lead: '',
  elrendezes: 'tabla',
  image: 45,
  rows: [
    {
      id: 'z1',
      number: '01',
      title: 'A kéz a szakterületünk',
      body: 'Első.',
      felirat: null,
      url: null,
    },
    {
      id: 'z2',
      number: '02',
      title: 'A hétköznapokra készülünk',
      body: 'Második.',
      felirat: null,
      url: null,
    },
  ],
  blockType: 'services',
  sectionSettings: { visible: true, anchorId: null, hatter: 'tint' },
}

/** Az élő /szolgaltatasok szekciósora. */
const szolgaltatasok = (): Szekciosor =>
  klon([
    { id: 'w', blockType: 'welcome', title: 'Fáj a kezed?' },
    SZOLG_AJTO,
    SZOLG_TECHNIKAK,
    { id: 'rt', blockType: 'richText' },
    SZOLG_EZERT,
    { id: 'vel', blockType: 'testimonials' },
    { id: 'cta', blockType: 'ctaBanner', title: 'Kezdd el otthon' },
  ]) as unknown as Szekciosor

const fotoUrl = (photo: unknown): unknown =>
  typeof photo === 'object' && photo !== null && 'url' in photo ? photo.url : photo

/** A megjelenítés szempontjából mérvadó vetület (Services.tsx ezeket olvassa). */
function vetulet(block: Szekciosor[number] | undefined) {
  if (block?.blockType !== 'services') return block
  const b: BlockServices = block
  return {
    elrendezes: b.elrendezes === 'sin' ? 'sin' : 'tabla',
    hatter: b.sectionSettings?.hatter ?? null,
    eyebrow: b.eyebrow ?? null,
    title: b.title ?? null,
    lead: b.lead ?? null,
    image: b.image ?? null,
    rows: (b.rows ?? []).map((row) => ({
      number: row.number ?? null,
      title: row.title,
      osszefoglalo: row.osszefoglalo ?? null,
      body: row.body,
      felirat: row.felirat ?? null,
      url: row.url ?? null,
      ujAblakban: row.ujAblakban ?? null,
      photo: fotoUrl(row.photo) ?? null,
    })),
  }
}

const ujLayout = (eredmeny: SinElrendezesKitoltes): Szekciosor => {
  if (eredmeny.layout === null) throw new Error('A szabály nem adott új szekciósort.')
  return eredmeny.layout as Szekciosor
}

describe('sin-elrendezes-kitoltes: az élő kezdőlap', () => {
  it('az „Így tudunk segíteni” blokk Sín + Világoskék lesz, a tábla érintetlen', () => {
    const bemenet = fagyaszt(kezdolap())
    const eredmeny = sinElrendezesKitoltese(bemenet, 'kezdolap')
    expect(eredmeny.allapot).toBe('KITOLTVE')
    expect(eredmeny.naplo.map((sor) => [sor.index, sor.allapot, sor.regi, sor.uj])).toEqual([
      [
        4,
        'KITOLTVE',
        { elrendezes: 'tabla', hatter: 'feher' },
        { elrendezes: 'sin', hatter: 'tint' },
      ],
      [
        8,
        'ERINTETLEN',
        { elrendezes: 'tabla', hatter: 'feher' },
        { elrendezes: 'tabla', hatter: 'feher' },
      ],
    ])
    expect(eredmeny.naplo[0]?.blokkId).toBe(KEZDOLAP_SEGITSEG.id)
    expect(eredmeny.naplo[0]?.uzenet).toContain('Kezdőlap, 5. szekció')
    expect(eredmeny.naplo[0]?.uzenet).not.toMatch(/[–—]/)
  })

  it('a szabály UTÁN az új kód ugyanazt rajzolja, mint a régi kód a szabály ELŐTT', () => {
    const uj = presentHomeLayout(ujLayout(sinElrendezesKitoltese(kezdolap(), 'kezdolap')))
    const sin = vetulet(uj[4])
    // A régi kód (793fe0b) kimenete ugyanezen az élő alakon: sín, tint sáv, a
    // CMS szövege, a kódbeli bevezető és összegzés, a három tartalék-fotó.
    expect(sin).toEqual({
      elrendezes: 'sin',
      hatter: 'tint',
      eyebrow: 'Szolgáltatásaink',
      title: 'Így tudunk segíteni',
      lead: HOME_HELP_LEAD,
      image: 31,
      rows: KEZDOLAP_SEGITSEG.rows.map((row, index) => ({
        number: row.number,
        title: row.title,
        osszefoglalo: HOME_HELP_STATES[index]?.osszefoglalo,
        body: row.body,
        felirat: row.felirat,
        url: row.url,
        ujAblakban: row.ujAblakban,
        photo: homeHelpFallbackMedia(index).url,
      })),
    })
    // A tábla a régi kódban is változatlanul ment át (nem a sín szomszédja).
    expect(vetulet(uj[8])).toEqual(vetulet(kezdolap()[8]))
    // A többi szekció azonos objektum-tartalmú.
    for (const index of [0, 1, 2, 3, 5, 6, 7, 9]) expect(uj[index]).toEqual(kezdolap()[index])
  })

  it('szabály NÉLKÜL az új kód táblára váltana: ezért kell egy deployban futnia', () => {
    const ujSzabalyNelkul = presentHomeLayout(kezdolap())
    expect(vetulet(ujSzabalyNelkul[4])).toMatchObject({ elrendezes: 'tabla', hatter: 'feher' })
  })

  it('a második futás MAR, és nem ad új szekciósort', () => {
    const elso = ujLayout(sinElrendezesKitoltese(kezdolap(), 'kezdolap'))
    const masodik = sinElrendezesKitoltese(fagyaszt(elso), 'kezdolap')
    expect(masodik.allapot).toBe('MAR')
    expect(masodik.layout).toBeNull()
    expect(masodik.naplo.map((sor) => sor.allapot)).toEqual(['MAR', 'ERINTETLEN'])
  })

  it('szerkesztői egyéb mezőt nem ír: csak az elrendezés és a sectionSettings.hatter változik', () => {
    const elotte = kezdolap()
    const utana = ujLayout(sinElrendezesKitoltese(elotte, 'kezdolap'))
    expect(utana).toHaveLength(elotte.length)
    utana.forEach((blokk, index) => {
      if (index !== 4) {
        expect(blokk).toBe(elotte[index])
        return
      }
      const regi = elotte[index] as BlockServices
      expect(blokk).toEqual({
        ...regi,
        elrendezes: 'sin',
        sectionSettings: { ...regi.sectionSettings, hatter: 'tint' },
      })
    })
  })
})

describe('sin-elrendezes-kitoltes: az élő /szolgaltatasok', () => {
  it('a háromsoros, CTA-s ajtó-blokk Sín lesz (a háttér már Világoskék), a táblák érintetlenek', () => {
    const elotte = fagyaszt(szolgaltatasok())
    const eredmeny = sinElrendezesKitoltese(elotte, 'szolgaltatasok')
    expect(eredmeny.allapot).toBe('KITOLTVE')
    expect(eredmeny.naplo.map((sor) => [sor.index, sor.allapot, sor.uj])).toEqual([
      [1, 'KITOLTVE', { elrendezes: 'sin', hatter: 'tint' }],
      [2, 'ERINTETLEN', { elrendezes: 'tabla', hatter: 'feher' }],
      [4, 'ERINTETLEN', { elrendezes: 'tabla', hatter: 'tint' }],
    ])
    // A háttér már tint volt: a sectionSettings objektum sem cserélődik.
    expect((ujLayout(eredmeny)[1] as BlockServices).sectionSettings).toBe(
      (elotte[1] as BlockServices).sectionSettings,
    )
  })

  it('a szabály UTÁN az új kód ugyanazt rajzolja, mint a régi kód a szabály ELŐTT', () => {
    const uj = presentSzolgaltatasokLayout(
      ujLayout(sinElrendezesKitoltese(szolgaltatasok(), 'szolgaltatasok')),
    )
    // A régi kód kimenete: sín a lap SAJÁT szövegével (összegzés és bevezető
    // pótlás nélkül), tint sáv, a három ajtó tartalék-fotója.
    expect(vetulet(uj[1])).toEqual({
      elrendezes: 'sin',
      hatter: 'tint',
      eyebrow: 'Szolgáltatásaink',
      title: 'Így segítünk',
      lead: null,
      image: 12,
      rows: SZOLG_AJTO.rows.map((row, index) => ({
        number: row.number,
        title: row.title,
        osszefoglalo: null,
        body: row.body,
        felirat: row.felirat,
        url: row.url,
        ujAblakban: row.ujAblakban,
        photo: homeHelpFallbackMedia(index).url,
      })),
    })
    // A két tábla: a régi kód `tabla`-ra írta (már az volt), az új változatlanul adja.
    expect(vetulet(uj[2])).toEqual(vetulet(szolgaltatasok()[2]))
    expect(vetulet(uj[4])).toEqual(vetulet(szolgaltatasok()[4]))
    expect(vetulet(uj[4])).toMatchObject({ elrendezes: 'tabla', hatter: 'tint' })
  })

  it('szabály NÉLKÜL az új kód az ajtó-blokkot táblának rajzolná', () => {
    const ujSzabalyNelkul = presentSzolgaltatasokLayout(szolgaltatasok())
    expect(vetulet(ujSzabalyNelkul[1])).toMatchObject({ elrendezes: 'tabla' })
  })

  it('a második futás MAR', () => {
    const elso = ujLayout(sinElrendezesKitoltese(szolgaltatasok(), 'szolgaltatasok'))
    const masodik = sinElrendezesKitoltese(fagyaszt(elso), 'szolgaltatasok')
    expect(masodik.allapot).toBe('MAR')
    expect(masodik.layout).toBeNull()
  })

  it('szerkesztői egyéb mezőt nem ír: az ajtó-blokkon csak az elrendezés változik', () => {
    const elotte = szolgaltatasok()
    const utana = ujLayout(sinElrendezesKitoltese(elotte, 'szolgaltatasok'))
    utana.forEach((blokk, index) => {
      if (index !== 1) {
        expect(blokk).toBe(elotte[index])
        return
      }
      expect(blokk).toEqual({ ...elotte[index], elrendezes: 'sin' })
    })
  })
})

describe('sin-elrendezes-kitoltes: a régi kód döntése és a szélső esetek', () => {
  it('kezdőlap: a mentett sín a régi kódban is sín volt, a Sötétkék megmarad', () => {
    const blokk = {
      id: 'x',
      blockType: 'services',
      title: 'Saját sín',
      elrendezes: 'sin',
      rows: [{ title: 'A', body: 'B' }],
      sectionSettings: { visible: true, hatter: 'sotet' },
    }
    expect(regiKodSinE(blokk, 'kezdolap')).toBe(true)
    const eredmeny = sinElrendezesKitoltese([blokk], 'kezdolap')
    expect(eredmeny.allapot).toBe('MAR')
    expect(eredmeny.naplo[0]?.uj).toEqual({ elrendezes: 'sin', hatter: 'sotet' })
  })

  it('/szolgaltatasok: a nem-ajtó blokk mentett sínjét a régi kód táblának rajzolta, a szabály Táblára írja', () => {
    const blokk = {
      id: 'y',
      blockType: 'services',
      title: 'Ezért fogod imádni',
      elrendezes: 'sin',
      rows: [{ title: 'A', body: 'B' }],
      sectionSettings: { visible: true, hatter: 'feher' },
    }
    expect(regiKodSinE(blokk, 'szolgaltatasok')).toBe(false)
    const eredmeny = sinElrendezesKitoltese([blokk], 'szolgaltatasok')
    expect(eredmeny.allapot).toBe('KITOLTVE')
    expect(ujLayout(eredmeny)[0]).toEqual({ ...blokk, elrendezes: 'tabla' })
  })

  it('a mező nélküli tábla Tábla értéket kap, a háttere nem változik', () => {
    const blokk = {
      id: 'z',
      blockType: 'services',
      title: 'Régi tábla',
      rows: [{ title: 'A', body: 'B' }],
      sectionSettings: { visible: true },
    }
    const eredmeny = sinElrendezesKitoltese([blokk], 'kezdolap')
    expect(ujLayout(eredmeny)[0]).toEqual({ ...blokk, elrendezes: 'tabla' })
  })

  it('rossz alakú bemenetre nem dob', () => {
    expect(sinElrendezesKitoltese(null, 'kezdolap')).toEqual({
      allapot: 'NINCS_SERVICES',
      layout: null,
      naplo: [],
    })
    expect(
      sinElrendezesKitoltese([1, 'x', null, { blockType: 'about' }], 'szolgaltatasok'),
    ).toEqual({ allapot: 'NINCS_SERVICES', layout: null, naplo: [] })
  })
})
