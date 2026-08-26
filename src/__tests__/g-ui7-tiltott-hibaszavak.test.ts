import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * G-UI7 — TILTOTT HIBASZAVAK ŐRE (`docs/ui-sztenderdek.md` §2.7, §6.3, A/9).
 * MIT VÉD. A §2.7 a GOV.UK hibaüzenet-szabályait ülteti át magyarra: a
 * hibaüzenet mondja meg, MI történt és HOGYAN javítható, és tiltja a
 * „please" (magyarul: „Kérjük"), a „sorry" („Sajnos"), a „valid/invalid"
 * („Érvénytelen") és a humoros („oops" → „Hopp") fordulatokat, valamint a
 */

const REPO = fileURLToPath(new URL('..', import.meta.url))

/**
 * A bejárt forrásfák (a `src/` alatt) — itt élnek a felhasználói szövegek.
 * A `fields`, `blocks` és `plugins` fák a Payload-tartalom szerkesztői és
 * megjelenítő rétege: felirat, segédszöveg és hibaüzenet ugyanúgy születhet
 * bennük, tehát ugyanaz a szabály vonatkozik rájuk.
 */
const FAK = ['lib', 'components', 'app', 'collections', 'fields', 'blocks', 'plugins'] as const

/**
 * A fákon kívüli, NEVESÍTETT extra fájl: a Payload-konfiguráció hookjai
 * nyilvános űrlap-hibaüzeneteket dobnak (spam-ellenőrzés), tehát ugyanaz a
 * szabály vonatkozik rájuk.
 */
const EXTRA_FAJLOK = ['payload.config.ts'] as const

const KITERJESZTESEK = ['.ts', '.tsx'] as const

interface Szabaly {
  /** A szabály neve a bukás-üzenetben. */
  readonly nev: string
  /** A tiltott alak. A `g` kapcsoló kötelező (az őr minden találatot felsorol). */
  readonly minta: RegExp
  /** Mit kell helyette írni — ez megy a bukás-üzenetbe. */
  readonly helyette: string
}

/**
 * A szóhatár magyar betűkre is helyes: a `\b` az ékezetes betűt HATÁRNAK
 * látná (pl. „érvénytelenné" → találat), ezért Unicode-betű-lookaround kell.
 */
const SZO_ELOTT = '(?<!\\p{L})'
const SZO_UTAN = '(?!\\p{L})'

const SZABALYOK: readonly Szabaly[] = [
  {
    nev: 'Kérjük',
    minta: new RegExp(`${SZO_ELOTT}kérjük${SZO_UTAN}`, 'giu'),
    helyette:
      'mondd meg tegezve, MIT tegyen a látogató („Próbáld újra néhány perc múlva.", ' +
      '„Frissítsd az oldalt, és próbáld újra.") — a „Kérjük" választást sugall ott, ahol nincs választás',
  },
  {
    nev: 'Sajnos',
    minta: new RegExp(`${SZO_ELOTT}sajnos${SZO_UTAN}`, 'giu'),
    helyette:
      'hagyd el a sajnálkozást, és írd le, mi történt és mi a következő lépés (GOV.UK: a „sorry" nem segít)',
  },
  {
    nev: 'Hopp',
    minta: new RegExp(`${SZO_ELOTT}hoppá?${SZO_UTAN}`, 'giu'),
    helyette: 'a hiba nem vicc: nevezd meg a helyzetet és a teendőt, humor nélkül',
  },
  {
    nev: 'Érvénytelen',
    minta: new RegExp(`${SZO_ELOTT}Érvénytelen${SZO_UTAN}`, 'gu'),
    helyette:
      'mondd meg, MELYIK adat hiányzik vagy rossz, és hogyan javítható ' +
      '(„A kurzus azonosítója hiányzik vagy nem értelmezhető. Nyisd meg újra a kurzus oldalát.")',
  },
  {
    nev: 'hibakód',
    minta: /hibakód/giu,
    helyette: 'a látogatónak a hibakód semmit nem mond: írd le a helyzetet és a teendőt',
  },
]

/** A maszkolás állapotai — a string- és sablonliterálok a KÓD részei maradnak. */
type Allapot = 'kod' | 'soros-komment' | 'blokk-komment' | 'aposztrof' | 'idezojel' | 'sablon'

/**
 * A kommentek kiszóközölése. A sortörések helyben maradnak, tehát a maszkolt
 * szöveg indexei a nyers forráséval egyeznek — a sorszám pontosan visszafejthető.
 */
export function kommentekNelkul(forras: string): string {
  const ki: string[] = []
  let allapot: Allapot = 'kod'
  let i = 0
  const push = (karakter: string, komment: boolean): void => {
    ki.push(komment && karakter !== '\n' ? ' ' : karakter)
  }
  while (i < forras.length) {
    const c = forras[i]
    const kovetkezo = forras[i + 1]
    switch (allapot) {
      case 'kod':
        // Kódban a fordított perjel REGEX-LITERÁLBAN áll (`/^https?:\/\//i`).
        // Escape-átugrás nélkül a `\/` utáni `/` soros kommentet nyitna, a
        // `\/` utáni `*` pedig blokk-kommentet — mindkettő elnémítaná a
        // valódi üzeneteket. Ugyanaz a lépés, mint a literálok ágában.
        if (c === '\\') {
          push(c, false)
          if (kovetkezo !== undefined) push(kovetkezo, false)
          i += 2
          continue
        }
        if (c === '/' && kovetkezo === '/') {
          allapot = 'soros-komment'
          push(' ', true)
          push(' ', true)
          i += 2
          continue
        }
        if (c === '/' && kovetkezo === '*') {
          allapot = 'blokk-komment'
          push(' ', true)
          push(' ', true)
          i += 2
          continue
        }
        if (c === "'") allapot = 'aposztrof'
        else if (c === '"') allapot = 'idezojel'
        else if (c === '`') allapot = 'sablon'
        push(c, false)
        i += 1
        continue
      case 'soros-komment':
        if (c === '\n') allapot = 'kod'
        push(c, true)
        i += 1
        continue
      case 'blokk-komment':
        if (c === '*' && kovetkezo === '/') {
          allapot = 'kod'
          push(' ', true)
          push(' ', true)
          i += 2
          continue
        }
        push(c, true)
        i += 1
        continue
      default: {
        // Stringen/sablonon belül: az escape-elt karakter átugorva, hogy a
        // `\'` ne zárja le a literált.
        if (c === '\\') {
          push(c, false)
          if (kovetkezo !== undefined) push(kovetkezo, false)
          i += 2
          continue
        }
        const zaro = allapot === 'aposztrof' ? "'" : allapot === 'idezojel' ? '"' : '`'
        if (c === zaro) allapot = 'kod'
        // A soron belül le nem zárt aposztróf/idézőjel (pl. JSX-szövegben álló
        // írásjel) nem ragadhat be: a sortörés visszaadja a kód-állapotot.
        else if (c === '\n' && allapot !== 'sablon') allapot = 'kod'
        push(c, false)
        i += 1
        continue
      }
    }
  }
  return ki.join('')
}

export interface Talalat {
  readonly sor: number
  readonly szabaly: Szabaly
  readonly reszlet: string
}

/** Egy forrásfájl tiltott találatai (kommentek nélkül, sorszámmal). */
export function tiltottTalalatok(forras: string): Talalat[] {
  const maszkolt = kommentekNelkul(forras)
  const talalatok: Talalat[] = []
  for (const szabaly of SZABALYOK) {
    const minta = new RegExp(szabaly.minta.source, szabaly.minta.flags)
    let egyezes = minta.exec(maszkolt)
    while (egyezes !== null) {
      const elotte = maszkolt.slice(0, egyezes.index)
      const sor = elotte.split('\n').length
      const sorKezdet = elotte.lastIndexOf('\n') + 1
      const sorVege = maszkolt.indexOf('\n', egyezes.index)
      talalatok.push({
        sor,
        szabaly,
        reszlet: forras
          .slice(sorKezdet, sorVege === -1 ? forras.length : sorVege)
          .trim()
          .slice(0, 120),
      })
      egyezes = minta.exec(maszkolt)
    }
  }
  return talalatok.sort((a, b) => a.sor - b.sor)
}

function fajlokat(gyoker: string): string[] {
  const talalat: string[] = []
  const bejar = (konyvtar: string): void => {
    for (const bejegyzes of readdirSync(konyvtar)) {
      const teljes = join(konyvtar, bejegyzes)
      if (statSync(teljes).isDirectory()) {
        bejar(teljes)
        continue
      }
      if (bejegyzes.endsWith('.d.ts') || /\.test\.tsx?$/.test(bejegyzes)) continue
      if (KITERJESZTESEK.some((veg) => bejegyzes.endsWith(veg))) talalat.push(teljes)
    }
  }
  bejar(join(REPO, gyoker))
  return talalat
}

const FAJLOK = [
  ...FAK.flatMap((fa) => fajlokat(fa)),
  ...EXTRA_FAJLOK.map((fajl) => join(REPO, fajl)),
]
  .map((teljes) => teljes.slice(REPO.length))
  .sort()

const FORRASOK = new Map<string, string>(
  FAJLOK.map((ut) => [ut, readFileSync(join(REPO, ut), 'utf8')]),
)

describe('G-UI7 — a bejáró tényleg végigméri a felületet', () => {
  it('minden forrásfa és a nevesített extra fájl benne van a mérésben', () => {
    for (const fa of FAK) {
      expect(
        FAJLOK.some((ut) => ut.startsWith(`${fa}/`)),
        `a(z) "${fa}" fa egyetlen fájlt sem adott — a bejáró elromlott`,
      ).toBe(true)
    }
    for (const fajl of EXTRA_FAJLOK) {
      expect(FAJLOK).toContain(fajl)
    }
    // Nagyságrendi kapu: ha a bejárás összeomlana, ez azonnal kiderül.
    expect(FAJLOK.length).toBeGreaterThan(200)
  })

  it('a maszkolás NEM nyeli el a látogatói szöveget (string, sablon és JSX-szöveg is marad)', () => {
    const mintak: ReadonlyArray<readonly [string, string]> = [
      ['lib/checkout/route-handler.ts', 'A fizetés indítása most nem sikerült.'],
      ['app/(frontend)/kapcsolat/_components/ContactForm.tsx', 'Az űrlap most nem érhető el.'],
      ['lib/email/templates/layout.ts', 'automatikus üzenet'],
    ]
    for (const [ut, mondat] of mintak) {
      const forras = FORRASOK.get(ut)
      expect(forras, `hiányzó mérési minta: ${ut}`).toBeDefined()
      expect(
        kommentekNelkul(forras as string).includes(mondat),
        `a maszkolás elnyelte a(z) "${mondat}" mondatot itt: ${ut}`,
      ).toBe(true)
    }
  })
})

describe('G-UI7 — az őr harap (önteszt a szabályokon)', () => {
  const nevek = (forras: string): string[] =>
    tiltottTalalatok(forras).map((talalat) => talalat.szabaly.nev)

  it('string-literálban álló tiltott szót MEGFOG', () => {
    expect(nevek("const HIBA = 'Váratlan hiba. Kérjük, próbáld újra később.'")).toEqual(['Kérjük'])
    expect(nevek("const HIBA = 'Sajnos nem sikerült.'")).toEqual(['Sajnos'])
    expect(nevek("const HIBA = 'Hopp, valami elromlott.'")).toEqual(['Hopp'])
    expect(nevek("const HIBA = 'Érvénytelen kérés.'")).toEqual(['Érvénytelen'])
    expect(nevek("const HIBA = 'A hibakód: 500.'")).toEqual(['hibakód'])
  })

  it('JSX-ben álló nyers szöveget és sablonliterált is MEGFOG', () => {
    expect(nevek('<p>Az űrlap nem érhető el. Kérjük, próbáld később.</p>')).toEqual(['Kérjük'])
    expect(nevek('const x = `Ez ${nev} üzenete, kérjük, ne válaszolj rá.`')).toEqual(['Kérjük'])
  })

  it('a KOMMENTBEN idézett tiltott szót NEM fogja meg (soros, blokk és JSX-komment)', () => {
    expect(nevek('// FIGYELEM: ez az E/1-es „kérem", NEM a tiltott „Kérjük".')).toEqual([])
    expect(nevek('/**\n * A korábbi „Kérjük, próbáld újra később" helyett.\n * Érvénytelen/hiányzó érték → null.\n */')).toEqual(
      [],
    )
    expect(nevek('{/* a GOV.UK minta tiltja a hibakódot („500") */}')).toEqual([])
    expect(nevek("const HIBA = 'Próbáld újra.' // korábban: 'Kérjük, próbáld újra.'")).toEqual([])
  })

  /**
   * MÉRT KIJÁTSZÁS (2026-08-22). A maszkoló kód-ága nem ismerte az escape-et,
   * ezért egy REGEX-LITERÁL elnémíthatta a saját sora maradékát (`\/` + `/`),
   * a `\/` + `*` alak pedig a következő blokk-komment-záróig MINDENT. A repóban
   * ÉLT: a régi és az új maszkolás összevetve 205 karakter / 11 sor / 10 fájl
   * különbséget adott (pl. `lib/szamlazz/client.ts:149`, `lib/seo.ts:53`,
   * `components/lexical/serialize.tsx:205,232`) — ennyi látogatói szöveg állt
   * a mérésen kívül. Új tiltott találat egyik újonnan látható sorban sincs,
   * tehát a javítás nem hoz be regressziót, csak a vak foltot szünteti meg.
   */
  it('a regex-literálbeli escape-elt perjel NEM nyit kommentet', () => {
    // (1) `\/` + `/` → korábban SOROS kommentet nyitott a sor maradékára.
    expect(nevek("const U = /^https?:\\/\\//iu; const HIBA = 'Kérjük, próbáld újra.'")).toEqual([
      'Kérjük',
    ])
    // (2) `\/` + `*` → korábban BLOKK-kommentet nyitott a következő sorokra is.
    const regexUtan = [
      'const VEG = /\\/*$/u',
      "const A = 'Sajnos nem sikerült.'",
      "const B = 'Érvénytelen kérés.'",
    ].join('\n')
    expect(nevek(regexUtan)).toEqual(['Sajnos', 'Érvénytelen'])
    // (3) A VALÓDI blokk-komment ettől függetlenül néma marad.
    expect(nevek("/* Kérjük, ne írj ilyet. */\nconst OK = 'Próbáld újra.'")).toEqual([])
  })

  it('a JOGOS alakokat NEM fogja meg (E/1 „kérem", leíró „érvénytelenné", „shopping")', () => {
    expect(nevek("const CTA = 'Kérem a visszaállító linket'")).toEqual([])
    expect(nevek("const T = 'Ilyenkor a régi link érvénytelenné válik.'")).toEqual([])
    expect(nevek("const T = 'A jelszó-visszaállító link lejárt vagy érvénytelen. Kérj újat.'")).toEqual(
      [],
    )
    expect(nevek("const T = 'shopping'")).toEqual([])
  })

  it('a szóhatár toldalékkal is működik (a „Kérjük"-öt nem lehet ragozással kicselezni)', () => {
    expect(nevek("const HIBA = 'Kérjük!'")).toEqual(['Kérjük'])
    expect(nevek("const HIBA = 'kérjük, várj'")).toEqual(['Kérjük'])
  })

  it('a több soros sablonliterálban álló `//` NEM hallgattat el egy sort', () => {
    const forras = ['const x = `', '  https://pelda.hu', '  Kérjük, próbáld újra.', '`'].join('\n')
    const talalatok = tiltottTalalatok(forras)
    expect(talalatok).toHaveLength(1)
    expect(talalatok[0].sor).toBe(3)
  })
})

describe('G-UI7 — a felületi szövegekben nincs tiltott hibaszó (§2.7)', () => {
  it('egyetlen látogatói szöveg sem tartalmaz „Kérjük"/„Sajnos"/„Érvénytelen"/„Hopp"/hibakódot', () => {
    const jelentes: string[] = []
    for (const [ut, forras] of FORRASOK) {
      for (const talalat of tiltottTalalatok(forras)) {
        jelentes.push(
          `${ut}:${talalat.sor} — „${talalat.szabaly.nev}"\n` +
            `      ott: ${talalat.reszlet}\n` +
            `      helyette: ${talalat.szabaly.helyette}`,
        )
      }
    }
    expect(
      jelentes,
      jelentes.length === 0
        ? ''
        : 'docs/ui-sztenderdek.md §2.7 (G-UI7, A/9): a hibaüzenet mondja meg, MI történt és ' +
          'MIT tegyen a látogató, tegezve. Tiltott szavak a felületi szövegben:\n' +
          jelentes.join('\n'),
    ).toEqual([])
  })
})
