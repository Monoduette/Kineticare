import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  CIKK_GYIK,
  faqFor,
  faqMezore,
  GYIK_MAX,
  GYIK_MIN,
  VALASZ_MONDAT_MAX,
  VALASZ_MONDAT_MIN,
} from '../lib/tudastar/faq'
import { extractArticleBody, FORRAS_JELOLESEK } from '../lib/tudastar/markdown-to-lexical'

/**
 * Őrök a Tudástár GYIK-tételeire.
 *
 * ═══ MIT MÉRÜNK, ÉS MIT NEM ═══
 * A legfontosabb állítás nem az, hogy „lefut”, hanem hogy a válaszok NEM
 * TALÁLT KI klinikai állítást: mindegyik a cikk törzsének kivonata. Ezt géppel
 * teljesen bizonyítani nem lehet, ezért két mérhető közelítést használunk:
 *
 *  - **G3:** minden tétel `szakasz` mezője (a cikk H2-je, amelyik a választ
 *    adja) tényleg ott van a cikk törzsében. Ez köti a tételt a szöveg egy
 *    konkrét pontjához.
 *  - **G4:** minden `horgony` (a válasz tartalmi kulcsszavai, a cikk saját
 *    szakkifejezéseivel) szó szerint megvan a VÁLASZBAN és a cikk TÖRZSÉBEN
 *    is. Ez azt méri, hogy a válasz kulcsállításai visszavezethetők a cikkre.
 *
 * **Amit ez NEM fed le:** a horgonyok között nem szereplő mondatrészeket. Egy
 * válasz elvben tartalmazhatna a horgonyok mellé csempészett, cikkből nem
 * következő állítást, és a teszt ezt nem venné észre. A horgonyok ezért a
 * válasz VÁZÁT adják (számadat, küszöb, fejmondat), nem a díszítést, és az
 * emberi felülvizsgálat ettől nem válik feleslegessé. Ugyanígy nem mérhető
 * géppel az sem, hogy egy mért keresési kérdésre azért NINCS tétel, mert a
 * cikk nem fedi le: azt a hiánylista rögzíti
 * (`docs/tudastar-cikkek-betoltese.md` 10.).
 */

const FAJL: Readonly<Record<string, string>> = {
  'miert-zsibbad-a-kezem': '1-miert-zsibbad-a-kezem.md',
  'keztoalagut-szindroma': '2-keztoalagut-szindroma.md',
  teniszkonyok: '3-teniszkonyok.md',
  'pattano-ujj': '4-pattano-ujj.md',
  'csuklo-es-kezfajdalom': '5-csuklo-es-kezfajdalom.md',
  'csuklotores-utani-gyogytorna': '6-csuklotores-utani-gyogytorna.md',
  inhuvelygyulladas: '7-inhuvelygyulladas.md',
  'befagyott-vall': '8-befagyott-vall.md',
}

/**
 * A cikk törzse EGY sorrá kisimítva.
 *
 * A markdown lágyan tördelt: egy mondat két sorra is eshet. Szó szerinti
 * keresésnél ezért a sortöréseket szóközzé kell olvasztani, különben a
 * horgonyok hamisan buknának.
 */
const torzsSzovege = (slug: string): string => {
  const nyers = readFileSync(path.join(process.cwd(), 'docs', 'cikkek', FAJL[slug]), 'utf8')
  return normal(extractArticleBody(nyers).lines.join(' '))
}

/** Kisbetűsítés és szóköz-összevonás; az ékezeteket MEGTARTJA. */
const normal = (szoveg: string): string => szoveg.toLowerCase().replace(/\s+/g, ' ').trim()

/** Mondatokra bontás: mondatvégi írásjel + szóköz a határ. */
const mondatok = (szoveg: string): string[] =>
  szoveg.split(/(?<=[.!?])\s+/).filter((mondat) => mondat.trim().length > 0)

const MINDEN_TETEL = CIKK_GYIK.flatMap((gyik) =>
  gyik.tetelek.map((tetel) => [`${gyik.slug} — ${tetel.kerdes}`, gyik.slug, tetel] as const),
)

describe('G1 — cikkenként 2–6 tétel, a maxRows korlát alatt', () => {
  it.each(CIKK_GYIK.map((gyik) => [gyik.slug, gyik] as const))('%s', (slug, gyik) => {
    expect(gyik.tetelek.length, `${slug}: kevés tétel`).toBeGreaterThanOrEqual(GYIK_MIN)
    expect(gyik.tetelek.length, `${slug}: a maxRows korlát 6`).toBeLessThanOrEqual(GYIK_MAX)
  })

  it('nincs kétszer ugyanaz a slug', () => {
    const slugok = CIKK_GYIK.map((gyik) => gyik.slug)
    expect(new Set(slugok).size).toBe(slugok.length)
  })

  it('cikken belül nincs két azonos kérdés', () => {
    for (const gyik of CIKK_GYIK) {
      const kerdesek = gyik.tetelek.map((tetel) => normal(tetel.kerdes))
      expect(new Set(kerdesek).size, `${gyik.slug}: ismétlődő kérdés`).toBe(kerdesek.length)
    }
  })

  it('minden slug létező cikkfájlhoz tartozik', () => {
    for (const gyik of CIKK_GYIK) {
      expect(FAJL[gyik.slug], `${gyik.slug}: nincs ilyen cikkfájl`).toBeDefined()
    }
  })
})

describe('G2 — a kérdés és a válasz alakja', () => {
  it.each(MINDEN_TETEL)('%s', (_nev, _slug, tetel) => {
    expect(tetel.kerdes.trim().length, 'üres kérdés').toBeGreaterThan(0)
    expect(tetel.valasz.trim().length, 'üres válasz').toBeGreaterThan(0)
    expect(tetel.kerdes.trim().endsWith('?'), 'a kérdés kérdőjelre végződjön').toBe(true)

    // 2–4 mondat: a mező admin-leírásának kikötése. A felső korlát azért
    // kemény, mert az AI-válaszok a teljes szöveget idézik, és egy hosszú
    // bekezdést már kivonatolnak, vagyis a mi mondatunk helyett a sajátjukat
    // adnák vissza.
    const db = mondatok(tetel.valasz).length
    expect(db, `${tetel.kerdes}: ${db} mondat`).toBeGreaterThanOrEqual(VALASZ_MONDAT_MIN)
    expect(db, `${tetel.kerdes}: ${db} mondat`).toBeLessThanOrEqual(VALASZ_MONDAT_MAX)
    expect(tetel.valasz.trim()).toMatch(/[.!?]$/)

    // Minden tételnek van mért eredete és cikkbeli forrása.
    expect(tetel.mert.length, `${tetel.kerdes}: nincs mért kifejezés`).toBeGreaterThan(0)
    expect(tetel.szakasz.trim().length).toBeGreaterThan(0)
    expect(tetel.horgony.length, `${tetel.kerdes}: nincs horgony`).toBeGreaterThan(0)
  })
})

describe('G3 — a hivatkozott szakasz tényleg a cikkben van', () => {
  it.each(MINDEN_TETEL)('%s', (_nev, slug, tetel) => {
    expect(
      torzsSzovege(slug).includes(normal(tetel.szakasz)),
      `${slug}: a(z) „${tetel.szakasz}” szakasz nincs a cikk törzsében`,
    ).toBe(true)
  })
})

describe('G4 — a válasz kulcsállításai a cikk törzséből jönnek', () => {
  it.each(MINDEN_TETEL)('%s', (_nev, slug, tetel) => {
    const torzs = torzsSzovege(slug)
    const valasz = normal(tetel.valasz)
    for (const horgony of tetel.horgony) {
      const keresett = normal(horgony)
      expect(valasz.includes(keresett), `„${horgony}” nincs a válaszban`).toBe(true)
      expect(
        torzs.includes(keresett),
        `„${horgony}” nincs a(z) ${slug} cikk törzsében: a válasz állítása nem vezethető ` +
          'vissza a szövegre. Vagy a cikket kell bővíteni, vagy a választ visszavenni.',
      ).toBe(true)
    }
  })
})

describe('G5 — nincs forrás-hivatkozás a GYIK-ben', () => {
  // Tulajdonosi döntés (2026-08-21): a cikkszövegben nincs forrásmegjelölés.
  // A GYIK ugyanennek a szövegnek a kivonata, tehát rá is érvényes. Az őr a
  // fordító FORRAS_JELOLESEK listáját használja, hogy a két hely ne csússzon el.
  it.each(MINDEN_TETEL)('%s', (_nev, _slug, tetel) => {
    for (const jel of FORRAS_JELOLESEK) {
      expect(tetel.kerdes.includes(jel), `forrásjelölés a kérdésben: ${jel}`).toBe(false)
      expect(tetel.valasz.includes(jel), `forrásjelölés a válaszban: ${jel}`).toBe(false)
    }
  })
})

describe('G6 — magyar tipográfia: nincs töltelék gondolatjel', () => {
  // `docs/ui-sztenderdek.md` §3.1: a kvirtmínusz (U+2014) magyar szövegben
  // egyáltalán nem használatos, a nagykötőjel (U+2013) pedig szóközök nélkül,
  // számtartományban áll („4–6 hét”). Szóközzel körülvéve gondolatjel lenne,
  // ami itt kivétel nélkül töltelék volna.
  it.each(MINDEN_TETEL)('%s', (_nev, _slug, tetel) => {
    const szoveg = `${tetel.kerdes} ${tetel.valasz}`
    expect(szoveg.includes('—'), 'kvirtmínusz (U+2014) magyar szövegben').toBe(false)
    expect(/\s–|–\s/.test(szoveg), 'szóközös (töltelék) gondolatjel').toBe(false)
  })
})

describe('G8 — a két új cikk GYIK-kérdései a törzs Gyakori kérdések H3-jai', () => {
  const UJ = ['inhuvelygyulladas', 'befagyott-vall'] as const

  it.each(UJ)('%s', (slug) => {
    const nyers = readFileSync(path.join(process.cwd(), 'docs', 'cikkek', FAJL[slug]), 'utf8')
    const { lines } = extractArticleBody(nyers)
    const gyikH3: string[] = []
    let gyikben = false
    for (const sor of lines) {
      if (sor.startsWith('## ')) {
        gyikben = sor === '## Gyakori kérdések'
        continue
      }
      if (gyikben && sor.startsWith('### ')) gyikH3.push(sor.slice(4).trim())
    }
    const kerdesek = faqFor(slug)?.tetelek.map((tetel) => tetel.kerdes) ?? []
    expect(kerdesek.length).toBeGreaterThanOrEqual(GYIK_MIN)
    expect(kerdesek.length).toBeLessThanOrEqual(GYIK_MAX)
    expect(kerdesek).toEqual(gyikH3)
  })
})

describe('G7 — faqFor és faqMezore', () => {
  it('minden felvett slugra visszaad', () => {
    for (const gyik of CIKK_GYIK) {
      expect(faqFor(gyik.slug)).toBe(gyik)
    }
  })

  it('ismeretlen slugra undefined, nem üres tömb', () => {
    // Ez a különbség viszi a betöltő döntését: az `undefined` azt jelenti,
    // hogy a faq mezőhöz hozzá sem nyúlunk, tehát egy adminban kézzel felvett
    // GYIK megmarad.
    expect(faqFor('nincs-ilyen-cikk')).toBeUndefined()
    expect(faqMezore('nincs-ilyen-cikk')).toBeUndefined()
  })

  it('a Payload-alakra képezés csak a kérdést és a választ viszi', () => {
    for (const gyik of CIKK_GYIK) {
      const mezo = faqMezore(gyik.slug)
      expect(mezo).toHaveLength(gyik.tetelek.length)
      mezo?.forEach((sor, index) => {
        expect(Object.keys(sor).sort()).toEqual(['answer', 'question'])
        expect(sor.question).toBe(gyik.tetelek[index].kerdes)
        expect(sor.answer).toBe(gyik.tetelek[index].valasz)
      })
    }
  })
})
