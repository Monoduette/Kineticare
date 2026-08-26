/** purchases-cell formázók: cím-lánc egyezik a storefrontdal; hiányos adat nem omlik össze. */

import { describe, expect, it } from 'vitest'

import {
  formatCourseLabel,
  formatPurchaseLabels,
  formatPurchaseRows,
  INLINE_NO_LESSONS_LABEL,
  inlineStatusLabel,
  normalizeProgressEntry,
  PROGRESS_SEPARATOR,
  PURCHASES_EMPTY_PLACEHOLDER,
  readProductTitles,
  readPurchaseIds,
  readRowUserId,
} from '../components/admin/purchases-cell'
import { statusLabel } from '../components/admin/course-progress-view'
import type { UserCourseProgressEntry } from '../lib/admin/user-progress-contract'
import { courseTitle } from '../lib/courses'
import { NO_LESSONS_LABEL } from '../lib/curriculum/progress'

const titles = new Map<string, string>([
  ['11', 'Otthoni KézRehab Program'],
  ['12', 'SOS Kézrelax villámkurzus'],
])

describe('kurzus-címke', () => {
  it('a kurzus címét használja, ha van', () => {
    expect(formatCourseLabel({ id: 11, sku: 'KEZ-ALAP', displayTitle: 'Otthoni KézRehab' })).toBe(
      'Otthoni KézRehab',
    )
  })

  it('cím híján a sku-t, annak híján az azonosítót írja ki', () => {
    expect(formatCourseLabel({ id: 11, sku: 'KEZ-ALAP' })).toBe('KEZ-ALAP')
    expect(formatCourseLabel({ id: 11, sku: '   ', displayTitle: '  ' })).toBe('Kurzus #11')
    expect(formatCourseLabel({ id: 11 })).toBe('Kurzus #11')
  })

  it('AZONOS a storefront courseTitle láncával (nem csúszhatnak szét)', () => {
    const cases = [
      { id: 11, sku: 'KEZ-ALAP', displayTitle: 'Otthoni KézRehab' },
      { id: 12, sku: 'KEZ-HALADO', displayTitle: '' },
      { id: 13, sku: '', displayTitle: '' },
    ]
    for (const product of cases) {
      expect(formatCourseLabel(product)).toBe(courseTitle(product))
    }
  })
})

describe('hozzáférés-azonosítók olvasása', () => {
  it('nyers azonosítókat olvas (lista-nézet)', () => {
    expect(readPurchaseIds([11, '12'])).toEqual(['11', '12'])
  })

  it('feloldott dokumentumot is olvas (szerkesztő-nézet)', () => {
    expect(readPurchaseIds([{ id: 11, sku: 'KEZ-ALAP' }])).toEqual(['11'])
  })

  it('polimorf kapcsolat-alakot is olvas', () => {
    expect(readPurchaseIds([{ relationTo: 'products', value: 11 }])).toEqual(['11'])
    expect(readPurchaseIds([{ relationTo: 'products', value: { id: 12 } }])).toEqual(['12'])
  })

  it('nem tömb vagy hibás elem esetén nem dob', () => {
    expect(readPurchaseIds(undefined)).toEqual([])
    expect(readPurchaseIds(null)).toEqual([])
    expect(readPurchaseIds('11')).toEqual([])
    expect(readPurchaseIds([null, {}, { id: {} }, 11])).toEqual(['11'])
  })

  it('DEDUPLIKÁL, a beérkezési sorrendet megtartva', () => {
    // A `purchases` mezőn nincs egyediség-kényszer: egy kézi szerkesztés vagy
    // ismételt hozzáférés-adás ugyanazt a kurzust kétszer is felviheti. A
    // cella ilyenkor UGYANAZT a sort írta ki kétszer — a szerver oldala
    // (`purchasedProductIds`) viszont már eddig is deduplikált.
    expect(readPurchaseIds([10, 10, 20])).toEqual(['10', '20'])
    // A szám és a szám alakú szöveg UGYANAZ az azonosító.
    expect(readPurchaseIds([10, '10'])).toEqual(['10'])
    // Vegyes alakok: a feloldott dokumentum és a polimorf érték is beleszámít.
    expect(readPurchaseIds([{ id: 11 }, 11, { relationTo: 'products', value: 11 }])).toEqual(['11'])
  })
})

describe('termék-válasz feldolgozása', () => {
  it('azonosító → cím térképet ad', () => {
    const map = readProductTitles({
      docs: [
        { id: 11, sku: 'KEZ-ALAP', displayTitle: 'Otthoni KézRehab Program' },
        { id: 12, sku: 'SOS' },
      ],
    })
    expect(map.get('11')).toBe('Otthoni KézRehab Program')
    expect(map.get('12')).toBe('SOS')
  })

  it('hibás választ üres térképpel nyel el', () => {
    expect(readProductTitles(null).size).toBe(0)
    expect(readProductTitles({ docs: 'nem tömb' }).size).toBe(0)
    expect(readProductTitles({ docs: [null, { sku: 'nincs id' }] }).size).toBe(0)
  })
})

describe('cella-sorok', () => {
  it('a kurzusok címét írja ki, sorrendtartóan', () => {
    expect(formatPurchaseLabels([11, 12], titles)).toEqual([
      'Otthoni KézRehab Program',
      'SOS Kézrelax villámkurzus',
    ])
  })

  it('üres hozzáférés-listára egyetlen helyőrzőt ad', () => {
    expect(formatPurchaseLabels([], titles)).toEqual([PURCHASES_EMPTY_PLACEHOLDER])
    expect(formatPurchaseLabels(undefined, titles)).toEqual([PURCHASES_EMPTY_PLACEHOLDER])
  })

  it('be nem töltött cím esetén az azonosító látszik (a sor sosem tűnik el)', () => {
    expect(formatPurchaseLabels([11, 99], titles)).toEqual([
      'Otthoni KézRehab Program',
      'Kurzus #99',
    ])
    expect(formatPurchaseLabels([11], new Map())).toEqual(['Kurzus #11'])
  })
})

/* Haladás a kurzus mellett: kurzusonkénti sor, állapot szóval (WCAG 1.4.1). */

/**
 * Egy érvényes haladás-bejegyzés, a szerződés alakjában.
 *
 * A `lessonCount` alapból pozitív: a 0 KÜLÖN megjelenési állapot („nincs
 * tananyag"), azt a saját blokkja méri.
 */
function entry(
  productId: number,
  percent: number,
  status: UserCourseProgressEntry['status'],
  lessonCount = 8,
): UserCourseProgressEntry {
  return { productId, percent, status, lessonCount }
}

describe('állapot mondatközi alakja', () => {
  it('a panel szótárából jön, csak a kezdőbetűje kicsi', () => {
    expect(inlineStatusLabel('nem-kezdte')).toBe('nem kezdte el')
    expect(inlineStatusLabel('folyamatban')).toBe('folyamatban')
    expect(inlineStatusLabel('befejezte')).toBe('befejezte')
  })

  it('NEM ír új szótárt: a panel statusLabel-jével betűre egyezik', () => {
    for (const status of ['nem-kezdte', 'folyamatban', 'befejezte'] as const) {
      const panelLabel = statusLabel(status)
      // Ugyanaz a szöveg, csak a kezdőbetű kisbetűs — ha a panel felirata
      // változik, ez a teszt vezeti rá a listát is (WCAG 2.2 SC 3.2.4).
      expect(inlineStatusLabel(status).toLocaleLowerCase('hu-HU')).toBe(
        panelLabel.toLocaleLowerCase('hu-HU'),
      )
    }
  })
})

describe('sor-azonosító olvasása a Payload rowData propjából', () => {
  it('a sor dokumentumának azonosítóját adja', () => {
    expect(readRowUserId({ id: 7, email: 'valaki@pelda.hu' })).toBe(7)
    expect(readRowUserId({ id: '7' })).toBe(7)
  })

  it('hiányzó vagy hibás rowData esetén null (a cella nem indít kérést)', () => {
    expect(readRowUserId(undefined)).toBeNull()
    expect(readRowUserId(null)).toBeNull()
    expect(readRowUserId({})).toBeNull()
    expect(readRowUserId({ id: 0 })).toBeNull()
    expect(readRowUserId({ id: -3 })).toBeNull()
    expect(readRowUserId({ id: 1.5 })).toBeNull()
    expect(readRowUserId({ id: 'nem szám' })).toBeNull()
    expect(readRowUserId({ id: null })).toBeNull()
    expect(readRowUserId('7')).toBeNull()
  })
})

describe('haladás-bejegyzés ellenőrzése', () => {
  it('érvényes bejegyzést átenged', () => {
    expect(
      normalizeProgressEntry({ productId: 11, percent: 45, status: 'folyamatban', lessonCount: 8 }),
    ).toEqual(entry(11, 45, 'folyamatban'))
  })

  it('hibás alakot null-lal nyel el', () => {
    expect(normalizeProgressEntry(null)).toBeNull()
    expect(normalizeProgressEntry('11')).toBeNull()
    expect(normalizeProgressEntry({ percent: 45, status: 'folyamatban', lessonCount: 8 })).toBeNull()
    expect(normalizeProgressEntry({ productId: 11, status: 'folyamatban', lessonCount: 8 })).toBeNull()
    expect(normalizeProgressEntry({ productId: 11, percent: 45, lessonCount: 8 })).toBeNull()
    expect(
      normalizeProgressEntry({ productId: 11, percent: '45', status: 'folyamatban', lessonCount: 8 }),
    ).toBeNull()
    expect(
      normalizeProgressEntry({
        productId: 11,
        percent: Number.NaN,
        status: 'folyamatban',
        lessonCount: 8,
      }),
    ).toBeNull()
    expect(
      normalizeProgressEntry({ productId: 11, percent: 45, status: 'ismeretlen', lessonCount: 8 }),
    ).toBeNull()
  })

  it('a hiányzó vagy hibás leckeszám ÉRVÉNYTELEN — nem „alapértelmezett 0"', () => {
    // A `lessonCount` KÖTELEZŐ: enélkül a „nincs tananyag" állapot nem
    // különböztethető meg a valódi 0%-tól, és pont az a hamis „0% · nem kezdte
    // el" sor jönne vissza, ami miatt a mező született.
    expect(normalizeProgressEntry({ productId: 11, percent: 45, status: 'folyamatban' })).toBeNull()
    expect(
      normalizeProgressEntry({ productId: 11, percent: 45, status: 'folyamatban', lessonCount: -1 }),
    ).toBeNull()
    expect(
      normalizeProgressEntry({ productId: 11, percent: 45, status: 'folyamatban', lessonCount: 2.5 }),
    ).toBeNull()
    expect(
      normalizeProgressEntry({ productId: 11, percent: 45, status: 'folyamatban', lessonCount: '8' }),
    ).toBeNull()
    // A 0 viszont ÉRVÉNYES érték: ez maga a „nincs tananyag" állapot.
    expect(
      normalizeProgressEntry({ productId: 11, percent: 0, status: 'nem-kezdte', lessonCount: 0 }),
    ).toEqual(entry(11, 0, 'nem-kezdte', 0))
  })

  it('a szerződést sértő százalékot 0–100 közé szorítja és egészre kerekíti', () => {
    const p = (percent: number, status: string): number | undefined =>
      normalizeProgressEntry({ productId: 11, percent, status, lessonCount: 8 })?.percent
    expect(p(-4, 'nem-kezdte')).toBe(0)
    expect(p(140, 'befejezte')).toBe(100)
    expect(p(45.6, 'folyamatban')).toBe(46)
  })
})

describe('cella-sorok haladással', () => {
  it('haladás-adat NÉLKÜL a mai viselkedést hozza (csak a cím)', () => {
    expect(formatPurchaseRows([11, 12], titles, null).map((row) => row.text)).toEqual([
      'Otthoni KézRehab Program',
      'SOS Kézrelax villámkurzus',
    ])
    expect(formatPurchaseRows([11], titles, undefined)[0]).toEqual({
      title: 'Otthoni KézRehab Program',
      percent: null,
      status: null,
      text: 'Otthoni KézRehab Program',
    })
  })

  it('a cím MELLETT a százalék és az állapot SZAVA is megjelenik', () => {
    const rows = formatPurchaseRows([11, 12], titles, [
      entry(11, 45, 'folyamatban'),
      entry(12, 0, 'nem-kezdte'),
    ])
    expect(rows.map((row) => row.text)).toEqual([
      'Otthoni KézRehab Program · 45% · folyamatban',
      'SOS Kézrelax villámkurzus · 0% · nem kezdte el',
    ])
  })

  it('az elválasztó KÖZÉPPONT (U+00B7), nem gondolatjel és nem kvirtmínusz', () => {
    expect(PROGRESS_SEPARATOR).toBe('·')
    const text = formatPurchaseRows([11], titles, [entry(11, 45, 'folyamatban')])[0].text
    expect(text).not.toMatch(/[–—]/)
  })

  it('KURZUSONKÉNTI sor, nem átlag: minden kurzus a SAJÁT haladását kapja', () => {
    const rows = formatPurchaseRows([11, 12], titles, [
      entry(12, 100, 'befejezte'),
      entry(11, 20, 'folyamatban'),
    ])
    expect(rows.map((row) => row.percent)).toEqual([20, 100])
    expect(rows.map((row) => row.status)).toEqual(['folyamatban', 'befejezte'])
  })

  it('0 ELINDÍTHATÓ leckénél „nincs tananyag" — se százalék, se állapot-szó', () => {
    // MÉRT HIBA (vezetői kör, 2026-08-21): a lecke `status` alapértelmezése
    // `processing`, ezért egy friss kurzusnál a nevező 0, és a cella azt
    // állította, hogy „0% · nem kezdte el" — olyan vevőkről is, akik a
    // kurzust korábban végignézték.
    const row = formatPurchaseRows([11], titles, [entry(11, 0, 'nem-kezdte', 0)])[0]
    expect(row.text).toBe('Otthoni KézRehab Program · még nincs tananyag')
    expect(row.text).not.toContain('%')
    expect(row.text).not.toContain('nem kezdte el')
    // A sor SEM százalékot, SEM állapotot nem hordoz — a komponens így nem is
    // tud belőle mást rajzolni.
    expect(row.percent).toBeNull()
    expect(row.status).toBeNull()
  })

  it('a „nincs tananyag" szó a vevői felirat mondatközi alakja (egy fogalom, egy szó)', () => {
    expect(INLINE_NO_LESSONS_LABEL).toBe('még nincs tananyag')
    // Ha a vevői felirat változik, ez a teszt vezeti rá az admin-listát is
    // (WCAG 2.2 SC 3.2.4, Consistent Identification).
    expect(INLINE_NO_LESSONS_LABEL.toLocaleLowerCase('hu-HU')).toBe(
      NO_LESSONS_LABEL.toLocaleLowerCase('hu-HU'),
    )
  })

  it('0% és 100% is kiíródik (nem esik ki üresként)', () => {
    expect(formatPurchaseRows([11], titles, [entry(11, 0, 'nem-kezdte')])[0].text).toBe(
      'Otthoni KézRehab Program · 0% · nem kezdte el',
    )
    expect(formatPurchaseRows([11], titles, [entry(11, 100, 'befejezte')])[0].text).toBe(
      'Otthoni KézRehab Program · 100% · befejezte',
    )
  })

  it('a haladás-válaszban lévő IDEGEN kurzus nem hoz létre sort', () => {
    const rows = formatPurchaseRows([11], titles, [entry(11, 45, 'folyamatban'), entry(99, 80, 'folyamatban')])
    expect(rows).toHaveLength(1)
    expect(rows[0].text).toBe('Otthoni KézRehab Program · 45% · folyamatban')
  })

  it('ismeretlen kurzus-azonosítónál a nyers azonosító MELLETT is látszik a haladás', () => {
    expect(formatPurchaseRows([99], titles, [entry(99, 30, 'folyamatban')])[0].text).toBe(
      'Kurzus #99 · 30% · folyamatban',
    )
  })

  it('HIBÁS status esetén a sor csak a címet hozza (nem állít valótlant)', () => {
    // A statusLabel `default` ága „Nem kezdte el"-t adna egy ismeretlen
    // értékre is — a listában ez egy konkrét emberről szóló hamis állítás
    // volna, ezért a bejegyzés inkább kiesik.
    const rossz = [{ productId: 11, percent: 45, status: 'ismeretlen' }] as unknown as UserCourseProgressEntry[]
    expect(formatPurchaseRows([11], titles, rossz)[0]).toEqual({
      title: 'Otthoni KézRehab Program',
      percent: null,
      status: null,
      text: 'Otthoni KézRehab Program',
    })
  })

  it('nem tömb haladás-adatra sem dob', () => {
    const rossz = 'nem tömb' as unknown as UserCourseProgressEntry[]
    expect(formatPurchaseRows([11], titles, rossz)[0].text).toBe('Otthoni KézRehab Program')
  })

  it('üres hozzáférés-listára a helyőrző marad, haladás nélkül', () => {
    expect(formatPurchaseRows([], titles, [entry(11, 45, 'folyamatban')])).toEqual([
      {
        title: PURCHASES_EMPTY_PLACEHOLDER,
        percent: null,
        status: null,
        text: PURCHASES_EMPTY_PLACEHOLDER,
      },
    ])
  })

  it('a formatPurchaseLabels a sorok CÍM-oszlopa (a két lánc nem csúszhat szét)', () => {
    const value = [11, 99]
    expect(formatPurchaseLabels(value, titles)).toEqual(
      formatPurchaseRows(value, titles, [entry(11, 45, 'folyamatban')]).map((row) => row.title),
    )
  })
})
