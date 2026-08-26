import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  FREE_COURSE_FORM_LINK_TEXT,
  FreeCourseFormLink,
} from '../components/courses/FreeCourseFormLink'
import {
  CROSS_SELL_HEADING,
  CROSS_SELL_LEAD,
  CROSS_SELL_LEAD_WITH_PRICE,
  RELATED_COURSES_HEADING,
  RELATED_COURSES_HEADING_ID,
  RelatedCourses,
} from '../components/courses/RelatedCourses'
import { buildCourseSlug } from '../lib/course-url'
import { ctaEntry, ctaLabel } from '../lib/cta-vocabulary'
import { formatPriceHuf } from '../lib/format-price'
import type { Product } from '../payload-types'
import {
  OTTHONI_KURZUS_SLUG,
  alkalmazSosKapcsolodoKurzus,
  kapcsolodoAzonositok,
} from '../scripts/apply-owner-content'

/**
 * ŐR — CROSS-SELL AZ INGYENES KURZUS OLDALÁN (2026-08-17).
 * A régi `www.kineticare.hu` ingyenes lánca nem ért véget az e-mail
 * megadásával: a beküldés után a látogató azonnal fizetős ajánlatra ment
 * (`urlRedirect: /oto-kezrehab-akcio` — „ez a lánc üzleti lényege”, mérve:
 * `docs/regi-oldal-osszehasonlitas.md` 5.1). Ugyanott az 5.2 mérése szerint ma
 */

/** U+2014 – kvirtmínusz. Magyar szövegben nem írásjel (ui-sztenderdek §3.1.1). */
const EM_DASH = String.fromCharCode(0x2014)
/** U+2013 – gondolatjel. Vevői mikroszövegben töltelékként tiltott (§3.1.2). */
const EN_DASH = String.fromCharCode(0x2013)

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const CSS_PATH = `${REPO_ROOT}src/app/(frontend)/kurzusok/kurzusok.css`
const PAGE_PATH = `${REPO_ROOT}src/app/(frontend)/kurzusok/[slug]/page.tsx`

/**
 * SÜRGETŐ és ÍGÉRŐ fordulatok. A lista szándékosan tő-alapú (kisbetűsítve
 * keresünk), hogy a ragozott alakokat is elkapja.
 */
const TILTOTT_FORDULATOK = [
  'csak ma',
  'csak most',
  'utolsó',
  'visszaszámlál',
  'lejár',
  'siess',
  'ne maradj le',
  'korlátozott',
  'garantál',
  'meggyógy',
  'gyógyulás',
  'fájdalommentes',
  'kérjük',
]

/**
 * A vevőnek MEGJELENŐ, ebben a körben írt szövegek — mind egy helyen.
 *
 * FIGYELEM (vezetői javítás, 2026-08-17): ez a lista ÖNMAGÁBAN NEM ELÉG. Egy
 * cáfoló ellenőrzés kimutatta, hogy a konstans-lista vizsgálata VAKON ZÖLD
 * marad, ha valaki a JSX-be ír közvetlenül egy mondatot: a beszúrt
 * „Siess, csak ma! … garantált gyógyulás" bekezdéssel a teszt 30/30 zöld
 * maradt. Ezért a mikroszöveg-szabályokat a RENDERELT KIMENETRE is futtatjuk
 * (lásd a „renderelt kimenet" blokkot) — az fogja meg a JSX-be írt szöveget is.
 */
const VEVOI_SZOVEGEK: readonly string[] = [
  CROSS_SELL_HEADING,
  CROSS_SELL_LEAD,
  CROSS_SELL_LEAD_WITH_PRICE,
  RELATED_COURSES_HEADING,
  FREE_COURSE_FORM_LINK_TEXT,
  ctaLabel('free-course-request-link'),
]

const termek = (overrides: Partial<Product> = {}): Product =>
  ({
    id: 7,
    sku: 'Otthoni KézRehab Program',
    slug: 'otthoni-kezrehab-program',
    status: 'published',
    shortDescription: 'Otthon végezhető kézrehabilitációs program gyógytornászoktól.',
    priceInHUF: 79500,
    priceInHUFEnabled: true,
    ...overrides,
  }) as Product

const sav = (products: Product[], crossSell?: boolean): string =>
  renderToStaticMarkup(
    createElement(RelatedCourses, crossSell === undefined ? { products } : { crossSell, products }),
  )

describe('1. a sáv csak akkor jelenik meg, ha a szerkesztő tényleg beállított kurzust', () => {
  it('beállított kapcsolat nélkül NINCS sáv (a mai viselkedés)', () => {
    expect(sav([])).toBe('')
    expect(sav([], true)).toBe('')
  })

  it('a nem publikált kapcsolat sem kerül ki (draft/archived upsell tilos)', () => {
    expect(sav([termek({ status: 'draft' })], true)).toBe('')
    expect(sav([termek({ status: 'archived' })], true)).toBe('')
  })

  it('a sáv a címsorától kapja a hozzáférhető nevét (a szekció így landmark)', () => {
    const html = sav([termek()], true)
    expect(html).toContain(`aria-labelledby="${RELATED_COURSES_HEADING_ID}"`)
    expect(html).toContain(`id="${RELATED_COURSES_HEADING_ID}"`)
  })
})

describe('2. az INGYENES ágon cross-sell keretezés, a fizetősön semleges sáv', () => {
  const ingyenesAg = sav([termek()], true)
  const fizetosAg = sav([termek()])

  it('az ingyenes ágon cím ÉS felvezető áll a kártya fölött', () => {
    expect(ingyenesAg).toContain(CROSS_SELL_HEADING)
    expect(ingyenesAg).toContain(CROSS_SELL_LEAD_WITH_PRICE)
    // A felvezető a cím UTÁN és a kártya ELŐTT: a keretezés a döntés előtt kell.
    expect(ingyenesAg.indexOf(CROSS_SELL_HEADING)).toBeLessThan(
      ingyenesAg.indexOf(CROSS_SELL_LEAD_WITH_PRICE),
    )
    expect(ingyenesAg.indexOf(CROSS_SELL_LEAD_WITH_PRICE)).toBeLessThan(
      ingyenesAg.indexOf('kc-course-grid'),
    )
  })

  it('a FIZETŐS kurzus oldala VÁLTOZATLAN: semleges cím, felvezető nélkül', () => {
    expect(fizetosAg).toContain(RELATED_COURSES_HEADING)
    expect(fizetosAg).not.toContain(CROSS_SELL_HEADING)
    expect(fizetosAg).not.toContain(CROSS_SELL_LEAD_WITH_PRICE)
    expect(fizetosAg).not.toContain(CROSS_SELL_LEAD)
    expect(fizetosAg).not.toContain('kc-course-related__lead')
  })

  it('az ÁR látszik a kártyán (Baymard: ár nélkül a cross-sell összevethetetlen)', () => {
    expect(ingyenesAg).toContain(formatPriceHuf(79500))
  })

  it('ár NÉLKÜLI kapcsolt kurzusnál a felvezető nem állít árat', () => {
    const html = sav([termek({ priceInHUFEnabled: false, priceInHUF: null })], true)
    expect(html).toContain(CROSS_SELL_LEAD)
    expect(html).not.toContain(CROSS_SELL_LEAD_WITH_PRICE)
  })

  it('a kártya CTA-t nem kap: a kártya EGÉSZE link (§3.2 #11)', () => {
    expect(ingyenesAg).not.toContain('<button')
    expect(ingyenesAg).toContain('/kurzusok/otthoni-kezrehab-program')
  })
})

describe('3. mikroszöveg: natív magyar, sürgetés és ígéret nélkül', () => {
  it('egyetlen szövegben sincs U+2014 vagy U+2013', () => {
    const bunosok = VEVOI_SZOVEGEK.filter(
      (szoveg) => szoveg.includes(EM_DASH) || szoveg.includes(EN_DASH),
    )
    expect(bunosok, 'gondolatjel a vevői szövegben').toEqual([])
  })

  it('egyetlen szövegben sincs felkiáltójel', () => {
    expect(VEVOI_SZOVEGEK.filter((szoveg) => szoveg.includes('!'))).toEqual([])
  })

  it('nincs sürgetés, nincs gyógyulás-ígéret, nincs „Kérjük"', () => {
    const bunosok = VEVOI_SZOVEGEK.flatMap((szoveg) => {
      const kisbetus = szoveg.toLocaleLowerCase('hu')
      return TILTOTT_FORDULATOK.filter((tiltott) => kisbetus.includes(tiltott)).map(
        (tiltott) => `${szoveg} → „${tiltott}"`,
      )
    })
    expect(bunosok, 'tiltott fordulat a vevői szövegben').toEqual([])
  })

  it('a felvezetők számot nem állítanak (kitalált statisztika tilos)', () => {
    for (const szoveg of [CROSS_SELL_LEAD, CROSS_SELL_LEAD_WITH_PRICE, CROSS_SELL_HEADING]) {
      expect(szoveg, 'számot tartalmazó felvezető').not.toMatch(/\d/u)
    }
  })
})

describe('4. ismételt belépő az igénylő űrlaphoz (§3.2 #27)', () => {
  const html = renderToStaticMarkup(
    createElement(FreeCourseFormLink, { formId: 'kurzus-vasarlas-gomb' }),
  )

  it('LINK, nem gomb: navigál, tehát horgony (ui-sztenderdek §2.1)', () => {
    expect(html).toContain('<a')
    expect(html).toContain('href="#kurzus-vasarlas-gomb"')
    expect(html).not.toContain('<button')
  })

  it('a felirat a SZÓTÁRBÓL jön, és nem azonos a beküldő gombéval', () => {
    expect(html).toContain(ctaLabel('free-course-request-link'))
    expect(ctaLabel('free-course-request-link')).not.toBe(ctaLabel('free-course-request'))
  })

  it('a szótári sor navigáció (E/2) és MÁSODLAGOS súlyú, folyamat-felirat nélkül', () => {
    const bejegyzes = ctaEntry('free-course-request-link')
    expect(bejegyzes.section).toBe('#27')
    expect(bejegyzes.person).toBe('e2')
    expect(bejegyzes.weight).toBe('secondary')
    expect(bejegyzes.progress).toBeNull()
    // A megjelenés is a súlyt viszi: nem második ELSŐDLEGES gomb a lapon (K-3).
    expect(html).toContain('kc-button--secondary')
    expect(html).not.toContain('kc-button--primary')
  })

  it('a magyarázó sor megmondja, hol az űrlap és mi kell hozzá', () => {
    expect(html).toContain(FREE_COURSE_FORM_LINK_TEXT)
  })
})

describe('5. a hatókör: az ismételt belépő csak ott van, ahol ragadós doboz nincs', () => {
  const css = readFileSync(CSS_PATH, 'utf8')

  /**
   * A megadott feltételű `@media` blokkok törzse, ÖSSZEFŰZVE. A stíluslapon
   * ugyanaz a töréspont többször is szerepel (rács, elrendezés, ez a blokk) —
   * ha csak az elsőt néznénk, az őr némán a rossz blokkot vizsgálná.
   */
  const mediaTorzs = (feltetel: string): string => {
    const torzsek: string[] = []
    let honnan = 0
    for (;;) {
      const kezdet = css.indexOf(`@media ${feltetel} {`, honnan)
      if (kezdet < 0) break
      let melyseg = 0
      let vege = -1
      for (let i = css.indexOf('{', kezdet); i < css.length; i += 1) {
        if (css[i] === '{') melyseg += 1
        if (css[i] === '}') {
          melyseg -= 1
          if (melyseg === 0) {
            vege = i
            break
          }
        }
      }
      if (vege < 0) throw new Error(`a(z) ${feltetel} media-blokk nincs lezárva`)
      torzsek.push(css.slice(kezdet, vege))
      honnan = vege
    }
    expect(torzsek.length, `nincs ilyen @media szabály: ${feltetel}`).toBeGreaterThan(0)
    return torzsek.join('\n')
  }

  it('a vásárlódoboz 1024px-től ragadós (ez a hatókör alapja)', () => {
    expect(mediaTorzs('(min-width: 1024px)')).toContain('position: sticky')
  })

  it('1024px felett az ismételt belépő eltűnik (ott a ragadós doboz a megoldás)', () => {
    const torzs = mediaTorzs('(min-width: 1024px)')
    expect(torzs).toMatch(/\.kc-course-recall\s*\{[^}]*display:\s*none/u)
  })

  it('a megjelenítését ÖSSZESEN két szabály állítja (későbbi szabály nem üti ki)', () => {
    // MIÉRT (vezetői javítás, 2026-08-17): a cáfoló ellenőrzés kimutatta, hogy
    // a fenti két állítás VAKON ZÖLD marad, ha valaki a lap VÉGÉRE ír egy
    // erősebb szabályt (mérve: `.kc-course-layout__main .kc-course-recall
    // { display: flex }` mellett a belépő Chromiumban 1024/1280/1440 px-en is
    // MEGJELENT, miközben a teszt 30/30 zöld volt). Ez a sor a `display`
    // deklarációk SZÁMÁT rögzíti: pontosan kettő lehet, az alapszabályé
    // (flex) és a médialekérdezésé (none). Bármely harmadik — akár erősebb,
    // akár későbbi — szabály megbuktatja a tesztet.
    const deklaraciok = [
      ...css.matchAll(/(?<valaszto>[^{}]*\.kc-course-recall[^{}]*)\{(?<torzs>[^}]*)\}/gu),
    ].filter((talalat) => /display\s*:/u.test(talalat.groups?.torzs ?? ''))

    const ertekek = deklaraciok.map((talalat) =>
      (/display\s*:\s*([^;]+);/u.exec(talalat.groups?.torzs ?? '')?.[1] ?? '').trim(),
    )
    expect(ertekek.sort(), `váratlan display-szabály a .kc-course-recall-ra`).toEqual([
      'flex',
      'none',
    ])
  })

  it('1024px ALATT viszont látszik (az alapszabály nem rejti el)', () => {
    const alap = /\.kc-course-recall\s*\{([^}]*)\}/u.exec(css)
    expect(alap, 'nincs .kc-course-recall alapszabály').not.toBeNull()
    expect(alap?.[1]).toContain('display: flex')
  })

  it('a blokk nem vezet be negyedik betűméretet (csak a három token)', () => {
    for (const szabaly of ['.kc-course-recall__text', '.kc-course-related__lead']) {
      const talalat = new RegExp(`\\${szabaly}\\s*\\{([^}]*)\\}`, 'u').exec(css)
      expect(talalat, `nincs ${szabaly} szabály`).not.toBeNull()
      const meret = /font-size:\s*([^;]+);/u.exec(talalat?.[1] ?? '')
      expect(meret?.[1].trim()).toMatch(/^var\(--kc-font-(l|m|s)\)$/u)
    }
  })
})

describe('6. a kurzusoldal bekötése', () => {
  const forras = readFileSync(PAGE_PATH, 'utf8')

  it('a cross-sell keretezés az ÁR-ÁLLAPOTHOZ kötött, nem az űrlaphoz', () => {
    expect(forras).toContain("crossSell={priceBadge === 'free'}")
  })

  it('az ismételt belépő csak az ingyenes ágon renderelődik', () => {
    expect(forras).toContain('{showFreeRequestForm ? <FreeCourseFormLink formId={CTA_ID} /> : null}')
  })

  it('a sáv adatforrása a szerkesztői mező marad (nincs beégetett termék)', () => {
    expect(forras).toContain('products={relatedProductsOf(product)}')
  })
})

describe('7. 17. tartalom-javítás — a kapcsolódó kurzus beállítása', () => {
  const CEL = 11
  const SOS = 2

  it('a keresett webcím a kurzus nevéből adódó slug (nem kézzel talált érték)', () => {
    expect(OTTHONI_KURZUS_SLUG).toBe(buildCourseSlug('Otthoni KézRehab Program'))
  })

  it('ÜRES mezőnél beírja a fizetős programot', () => {
    const eredmeny = alkalmazSosKapcsolodoKurzus({ jelenlegi: null, sosId: SOS, celId: CEL })
    expect(eredmeny.relatedProducts).toEqual([CEL])
    expect(eredmeny.modositasok).toHaveLength(1)
    expect(eredmeny.kihagyasok).toEqual([])
  })

  it('IDEMPOTENS: a saját eredményén futtatva már nem ír', () => {
    const elso = alkalmazSosKapcsolodoKurzus({ jelenlegi: null, sosId: SOS, celId: CEL })
    const masodik = alkalmazSosKapcsolodoKurzus({
      jelenlegi: elso.relatedProducts,
      sosId: SOS,
      celId: CEL,
    })
    expect(masodik.relatedProducts).toBeNull()
    expect(masodik.modositasok).toEqual([])
    expect(masodik.kihagyasok[0]?.indok).toContain('MÁR be van állítva')
  })

  it('az idempotens kihagyás NEM hangos (nincs emberi teendő)', () => {
    /**
     * MIÉRT (vezetői javítás, 2026-08-17, ÉLES NAPLÓ alapján): a `hangos: true`
     * `logger.error`-t ír. Az éles tartalom-job futásában emiatt EGYETLEN
     * `error` sor állt a 21 `warn` mellett — pont a legjobb kimenetnél:
     *
     *   „Az SOS kurzus kapcsolódó kurzusa (…) (a kapcsolódó kurzus MÁR be van
     *    állítva — nincs teendő)"  ← severity: error
     *
     * Ez zaj: minden további futás hibásnak látszik, és a valódi hibák
     * elvesznek benne. A hangos ág azoknak az eseteknek való, ahol EMBERI
     * TEENDŐ van. Ez a teszt a két csoportot szétválasztva rögzíti.
     */
    const idempotens = alkalmazSosKapcsolodoKurzus({
      jelenlegi: [CEL],
      sosId: SOS,
      celId: CEL,
    })
    expect(idempotens.kihagyasok[0]?.hangos).toBe(false)
  })

  it('viszont MINDEN emberi teendőt igénylő kihagyás hangos marad', () => {
    const esetek = [
      {
        nev: 'a cél kurzus nincs meg',
        eredmeny: alkalmazSosKapcsolodoKurzus({ jelenlegi: [], sosId: SOS, celId: null }),
      },
      {
        nev: 'önhivatkozás',
        eredmeny: alkalmazSosKapcsolodoKurzus({ jelenlegi: [], sosId: SOS, celId: SOS }),
      },
      {
        nev: 'a szerkesztő mást állított be',
        eredmeny: alkalmazSosKapcsolodoKurzus({ jelenlegi: [999], sosId: SOS, celId: CEL }),
      },
    ]
    for (const { nev, eredmeny } of esetek) {
      expect(eredmeny.kihagyasok[0]?.hangos, nev).toBe(true)
    }
  })

  it('a cél kurzus HIÁNYÁT hangosan jelzi, és nem találgat azonosítót', () => {
    const eredmeny = alkalmazSosKapcsolodoKurzus({ jelenlegi: [], sosId: SOS, celId: null })
    expect(eredmeny.relatedProducts).toBeNull()
    expect(eredmeny.kihagyasok[0]?.hangos).toBe(true)
    expect(eredmeny.kihagyasok[0]?.indok).toContain(OTTHONI_KURZUS_SLUG)
  })

  it('önhivatkozást sosem ír be', () => {
    const eredmeny = alkalmazSosKapcsolodoKurzus({ jelenlegi: [], sosId: SOS, celId: SOS })
    expect(eredmeny.relatedProducts).toBeNull()
    expect(eredmeny.kihagyasok[0]?.hangos).toBe(true)
  })

  it('a SZERKESZTŐ beállítását nem írja felül', () => {
    const eredmeny = alkalmazSosKapcsolodoKurzus({ jelenlegi: [99], sosId: SOS, celId: CEL })
    expect(eredmeny.relatedProducts).toBeNull()
    expect(eredmeny.kihagyasok[0]?.hangos).toBe(true)
    expect(eredmeny.kihagyasok[0]?.indok).toContain('99')
  })

  it('az azonosító-kiolvasás a mélyített (objektumos) alakot is kezeli', () => {
    expect(kapcsolodoAzonositok([3, { id: 4 } as Product, null as unknown as number])).toEqual([
      3, 4,
    ])
    expect(kapcsolodoAzonositok(null)).toEqual([])
  })
})

describe('7. a mikroszöveg-szabályok a RENDERELT kimenetre is állnak', () => {
  /**
   * MIÉRT KELL EZ A BLOKK (vezetői javítás, 2026-08-17):
   * a cáfoló ellenőrzés kimutatta, hogy a `VEVOI_SZOVEGEK` konstans-lista
   * vizsgálata VAKON ZÖLD marad, ha valaki a JSX-be ír közvetlenül egy
   * mondatot. Bizonyítva: egy beszúrt „Siess, csak ma! Kérjük, ne maradj le a
   * garantált gyógyulásról — az ajánlat lejár." bekezdéssel a fájl 30/30 zöld
   * maradt, és a teljes sor is zöld volt.
   *
   * Ez a blokk a TÉNYLEGESEN renderelt HTML-t szűri, tehát mindegy, hogy a
   * szöveg konstansból vagy közvetlenül a JSX-ből jön.
   */

  /** A HTML-ből a látogatónak megjelenő szöveg (címkék és attribútumok nélkül). */
  const lathatoSzoveg = (html: string): string =>
    html
      .replace(/<[^>]*>/gu, ' ')
      .replace(/&[a-z]+;/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()

  /** Minden renderelt felület, amit ez a kör a vevőnek megmutat. */
  const feluletek = (): { nev: string; html: string }[] => [
    { nev: 'cross-sell sáv (ár látszik)', html: sav([termek()], true) },
    {
      nev: 'cross-sell sáv (ár nélkül)',
      html: sav([termek({ priceInHUF: null, priceInHUFEnabled: false })], true),
    },
    { nev: 'semleges sáv', html: sav([termek()], false) },
    {
      nev: 'ismételt belépő az űrlaphoz',
      html: renderToStaticMarkup(
        createElement(FreeCourseFormLink, { formId: 'kurzus-vasarlas-gomb' }),
      ),
    },
  ]

  it('nincs töltelék gondolatjel a renderelt szövegben', () => {
    for (const { nev, html } of feluletek()) {
      expect(lathatoSzoveg(html), nev).not.toMatch(/[\u2013\u2014]/u)
    }
  })

  it('nincs felkiáltójel a renderelt szövegben', () => {
    for (const { nev, html } of feluletek()) {
      expect(lathatoSzoveg(html), nev).not.toContain('!')
    }
  })

  it('nincs sürgetés, ígéret és „Kérjük" a renderelt szövegben', () => {
    for (const { nev, html } of feluletek()) {
      const szoveg = lathatoSzoveg(html).toLocaleLowerCase('hu')
      for (const tiltott of TILTOTT_FORDULATOK) {
        expect(szoveg, `${nev}: „${tiltott}"`).not.toContain(tiltott)
      }
    }
  })

  it('minden renderelt felület ad legalább egy mondatot (nem üres a szűrő)', () => {
    // Negatív-próba a SZŰRŐRE magára: ha a `lathatoSzoveg` egyszer üres
    // stringet adna vissza (pl. elrontott regex), a fenti három teszt
    // hazug módon zöld lenne. Ez a sor ezt zárja ki.
    for (const { nev, html } of feluletek()) {
      expect(lathatoSzoveg(html).length, nev).toBeGreaterThan(20)
    }
  })
})
