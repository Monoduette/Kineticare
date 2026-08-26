import { describe, expect, it } from 'vitest'

import {
  courseVisibilityNotice,
  normalizeVisibility,
} from '../components/admin/course-visibility'
import {
  lessonRowLabel,
  moduleRowLabel,
  NEM_JATSZHATO,
  NEVTELEN_LECKE,
  NEVTELEN_MODUL,
} from '../components/admin/curriculum-row-label'

/**
 * A KURZUS-SZERKESZTŐLAP két UX-javításának tiszta logikája.
 *
 * Mindkettőt egy valódi böngészővel végzett admin UX-audit hívta életre, amely
 * végigjátszotta egy új kurzus felvitelét owner és staff jogosultsággal is.
 * A tesztek TISZTA függvényeket hívnak: nincs DOM, nincs hálózat, nincs Payload.
 */

describe('moduleRowLabel — a csukott modul-sor felirata', () => {
  /**
   * A mért hiba: a hét beszédes című modul nyolc TELJESEN EGYFORMA, „Modul 01…08"
   * feliratú szürke csíkként jelent meg, mert a felirat a sorszám volt, nem a cím.
   */
  it('a CÍM jelenik meg, a leckék számával — nem a sorszám', () => {
    expect(
      moduleRowLabel({ title: '1. ALAPOK — Így kezdj neki', lessons: [{}, {}, {}] }, 1),
    ).toBe('1. ALAPOK — Így kezdj neki (3 lecke)')
  })

  it('egyetlen leckénél is ugyanaz az alak (magyarul nincs többes szám szám után)', () => {
    expect(moduleRowLabel({ title: 'BÓNUSZOK', lessons: [{}] }, 5)).toBe('BÓNUSZOK (1 lecke)')
  })

  it('lecke nélküli modulnál KIMONDJA, hogy üres', () => {
    expect(moduleRowLabel({ title: 'Facebook csoport', lessons: [] }, 2)).toBe(
      'Facebook csoport (nincs lecke)',
    )
    expect(moduleRowLabel({ title: 'Facebook csoport' }, 2)).toBe('Facebook csoport (nincs lecke)')
  })

  it('a kitöltetlen KÖTELEZŐ cím azonnal feltűnik a csukott soron', () => {
    expect(moduleRowLabel({ title: '', lessons: [{}] }, 9)).toBe(`9. modul — ${NEVTELEN_MODUL} (1 lecke)`)
    expect(moduleRowLabel({ title: '   ' }, 3)).toBe(`3. modul — ${NEVTELEN_MODUL} (nincs lecke)`)
    expect(moduleRowLabel(null, 4)).toBe(`4. modul — ${NEVTELEN_MODUL} (nincs lecke)`)
  })

  it('hiányzó vagy hibás sorszámmal sem dob (a felirat sosem törhet el)', () => {
    expect(moduleRowLabel({ title: null })).toBe(`1. modul — ${NEVTELEN_MODUL} (nincs lecke)`)
    expect(moduleRowLabel({ title: null }, Number.NaN)).toContain(NEVTELEN_MODUL)
    expect(moduleRowLabel(undefined, 0)).toContain('1. modul')
  })

  it('a nem tömb `lessons` értéket 0-nak veszi (a nyers adat nem megbízható)', () => {
    expect(moduleRowLabel({ title: 'Modul', lessons: 'nem tömb' }, 1)).toBe('Modul (nincs lecke)')
  })
})

describe('lessonRowLabel — a csukott lecke-sor felirata', () => {
  it('a CÍM és a TÍPUS jelenik meg', () => {
    expect(lessonRowLabel({ title: 'Bemelegítés', kind: 'video', status: 'ready' }, 1)).toBe(
      'Bemelegítés · Videó',
    )
    expect(lessonRowLabel({ title: 'Étrend', kind: 'szoveg' }, 2)).toBe('Étrend · Szöveges')
    expect(lessonRowLabel({ title: 'Csoport', kind: 'link' }, 3)).toBe('Csoport · Külső link')
  })

  /**
   * A kurzusfeltöltés leggyakoribb NÉMA hibája: a videó feltöltődik, de az
   * állapota „Feldolgozás alatt" marad, és a vevőnél egyszerűen nem indul el.
   * Csukott soron látva azonnal szembetűnik.
   */
  it('a NEM lejátszható videót külön jelzi', () => {
    expect(lessonRowLabel({ title: 'Nyújtás', kind: 'video', status: 'processing' }, 1)).toBe(
      `Nyújtás · Videó · ${NEM_JATSZHATO}`,
    )
    expect(lessonRowLabel({ title: 'Nyújtás', kind: 'video', status: 'error' }, 1)).toContain(
      NEM_JATSZHATO,
    )
    expect(lessonRowLabel({ title: 'Nyújtás', kind: 'video' }, 1)).toContain(NEM_JATSZHATO)
  })

  it('a NEM videós leckéken nincs lejátszhatóság-jelzés (nincs is értelme)', () => {
    expect(lessonRowLabel({ title: 'Étrend', kind: 'szoveg', status: 'processing' }, 1)).toBe(
      'Étrend · Szöveges',
    )
    expect(lessonRowLabel({ title: 'Csoport', kind: 'link', status: 'error' }, 1)).toBe(
      'Csoport · Külső link',
    )
  })

  it('a hiányzó típus VIDEÓNAK számít — egyezően a tananyag-modellel', () => {
    expect(lessonRowLabel({ title: 'Régi lecke', status: 'ready' }, 1)).toBe('Régi lecke · Videó')
    expect(lessonRowLabel({ title: 'Régi lecke', kind: null, status: 'ready' }, 1)).toBe(
      'Régi lecke · Videó',
    )
  })

  it('az ismeretlen típus sem töri el a feliratot', () => {
    expect(lessonRowLabel({ title: 'Valami', kind: 'ismeretlen', status: 'ready' }, 1)).toBe(
      'Valami · Videó',
    )
  })

  it('a kitöltetlen cím a csukott soron is látszik', () => {
    expect(lessonRowLabel({ title: '', kind: 'szoveg' }, 4)).toBe(
      `4. lecke — ${NEVTELEN_LECKE} · Szöveges`,
    )
  })
})

/**
 * Az audit végigjátszotta egy új kurzus felvitelét: a rendszer „Állapot:
 * Közzétett"-et írt (a Payload `_status`-a), a mentés sikeres volt, DE az
 * adatbázisban `status=NULL` maradt, és a kurzus NEM jelent meg a /kurzusok
 * oldalon. A bolt kizárólag a `products.status` mezőt nézi. A munkatárs
 * ráadásul nem is tudja átállítani (owner-only mező), tehát sem észrevenni, sem
 */
describe('courseVisibilityNotice — látszik-e a kurzus a weboldalon', () => {
  it('a KITÖLTETLEN mezőnél figyelmeztet, és megnevezi a félrevezető felső sávot', () => {
    const notice = courseVisibilityNotice(null, false)
    expect(notice.kind).toBe('figyelmeztetes')
    expect(notice.title).toContain('MÉG NEM látszik')
    expect(notice.body).toContain('Állapot: Közzétett')
    expect(notice.body).toContain('NEM a weboldali megjelenésre')
  })

  it('MUNKATÁRSNAK megmondja, hogy a tulajdonost kell megkérnie', () => {
    const notice = courseVisibilityNotice('draft', false)
    expect(notice.kind).toBe('figyelmeztetes')
    expect(notice.body).toContain('tulajdonos')
  })

  it('TULAJDONOSNAK a konkrét teendőt mondja, felesleges kerülőút nélkül', () => {
    const notice = courseVisibilityNotice('draft', true)
    expect(notice.body).toContain('Megjelenés a weboldalon')
    expect(notice.body).not.toContain('Ezt csak a tulajdonos')
  })

  it('archiváltnál is figyelmeztet — az sem látszik', () => {
    const notice = courseVisibilityNotice('archived', true)
    expect(notice.kind).toBe('figyelmeztetes')
    expect(notice.title).toContain('ARCHIVÁLT')
  })

  it('közzétett kurzusnál megerősít, nem riogat', () => {
    const notice = courseVisibilityNotice('published', false)
    expect(notice.kind).toBe('rendben')
    expect(notice.title).toContain('LÁTSZIK')
  })

  it('ismeretlen érték = nincs beállítva (sosem hazudik „látszik"-ot)', () => {
    for (const ertek of [undefined, '', 'Published', 'aktív', 42, {}, []]) {
      expect(normalizeVisibility(ertek)).toBeNull()
      expect(courseVisibilityNotice(ertek, true).kind).toBe('figyelmeztetes')
    }
  })
})
