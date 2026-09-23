import { describe, expect, it } from 'vitest'

import { courseVisibilityNotice, normalizeVisibility } from '../components/admin/course-visibility'
import {
  lessonRowLabel,
  moduleRowLabel,
  NEM_JATSZHATO,
  NEVTELEN_LECKE,
  NEVTELEN_MODUL,
  isEditorVideoPlayable,
} from '../components/admin/curriculum-row-label'
import {
  COURSE_MODULES_ADMIN_DESCRIPTION,
  LESSON_DURATION_ADMIN_DESCRIPTION,
} from '../fields/course-modules'

/**
 * A KURZUS-SZERKESZTŐLAP két UX-javításának tiszta logikája.
 *
 * Mindkettőt egy valódi böngészővel végzett admin UX-audit hívta életre, amely
 * végigjátszotta egy új kurzus felvitelét owner és staff jogosultsággal is.
 * A tesztek TISZTA függvényeket hívnak: nincs DOM, nincs hálózat. A mezőleírás
 * konstansok a `course-modules` modulból jönnek (Payload-mező objektum nélkül
 * is olvashatók).
 */

describe('moduleRowLabel — a csukott modul-sor felirata', () => {
  /**
   * A mért hiba: a hét beszédes című modul nyolc TELJESEN EGYFORMA, „Modul 01…08"
   * feliratú szürke csíkként jelent meg, mert a felirat a sorszám volt, nem a cím.
   */
  it('a CÍM jelenik meg, a leckék számával — nem a sorszám', () => {
    expect(moduleRowLabel({ title: '1. ALAPOK — Így kezdj neki', lessons: [{}, {}, {}] }, 1)).toBe(
      '1. ALAPOK — Így kezdj neki (3 lecke)',
    )
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
    expect(moduleRowLabel({ title: '', lessons: [{}] }, 9)).toBe(
      `9. modul — ${NEVTELEN_MODUL} (1 lecke)`,
    )
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
    expect(
      lessonRowLabel(
        { title: 'Bemelegítés', kind: 'video', status: 'ready', streamAssetId: 'guid-1' },
        1,
      ),
    ).toBe('Bemelegítés · Videó')
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

  it('Kész állapot GUID nélkül is még nem játszható (a vevőnél sem indul)', () => {
    expect(lessonRowLabel({ title: 'Nyújtás', kind: 'video', status: 'ready' }, 1)).toContain(
      NEM_JATSZHATO,
    )
    expect(
      lessonRowLabel({ title: 'Nyújtás', kind: 'video', status: 'ready', streamAssetId: '   ' }, 1),
    ).toContain(NEM_JATSZHATO)
    expect(
      isEditorVideoPlayable({
        title: 'Nyújtás',
        kind: 'video',
        status: 'ready',
        streamAssetId: 'guid-1',
      }),
    ).toBe(true)
    expect(isEditorVideoPlayable({ kind: 'video', status: 'ready' })).toBe(false)
    expect(isEditorVideoPlayable({ kind: 'szoveg', status: 'ready' })).toBe(false)
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
    expect(
      lessonRowLabel({ title: 'Régi lecke', status: 'ready', streamAssetId: 'guid-regi' }, 1),
    ).toBe('Régi lecke · Videó')
    expect(
      lessonRowLabel(
        { title: 'Régi lecke', kind: null, status: 'ready', streamAssetId: 'guid-regi' },
        1,
      ),
    ).toBe('Régi lecke · Videó')
  })

  it('az ismeretlen típus sem töri el a feliratot', () => {
    expect(
      lessonRowLabel(
        { title: 'Valami', kind: 'ismeretlen', status: 'ready', streamAssetId: 'guid-x' },
        1,
      ),
    ).toBe('Valami · Videó')
  })

  it('a kitöltetlen cím a csukott soron is látszik', () => {
    expect(lessonRowLabel({ title: '', kind: 'szoveg' }, 4)).toBe(
      `4. lecke — ${NEVTELEN_LECKE} · Szöveges`,
    )
  })
})

describe('szerkesztői mezőleírások — ne hazudjanak a lejátszásról', () => {
  it('a Hossz mező nem mondja, hogy nélküle a videó nem indul', () => {
    expect(LESSON_DURATION_ADMIN_DESCRIPTION).toContain('Ajánlott')
    expect(LESSON_DURATION_ADMIN_DESCRIPTION).toContain('24 órás')
    expect(LESSON_DURATION_ADMIN_DESCRIPTION).not.toMatch(/KÖTELEZŐ/)
    expect(LESSON_DURATION_ADMIN_DESCRIPTION).not.toMatch(/[–—]/)
  })

  it('a Tananyag mező kimondja, hogy egy új lecke elrejti a régi Videók listát', () => {
    expect(COURSE_MODULES_ADMIN_DESCRIPTION).toContain('elrejtődik')
    expect(COURSE_MODULES_ADMIN_DESCRIPTION).toContain('kurzus:videok-modulba')
    expect(COURSE_MODULES_ADMIN_DESCRIPTION).not.toMatch(/[–—]/)
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
  it('a rejtett közzétett kurzusnál pontosan elválasztja a listázást a hozzáféréstől', () => {
    const notice = courseVisibilityNotice('published', true, true)
    expect(notice.kind).toBe('rendben')
    expect(notice.title).toContain('közvetlen linkkel')
    expect(notice.body).toContain('bárki')
    expect(notice.body).toContain('Kurzusaim')
    expect(notice.body).toContain('nem hozzáférés-védelem')
  })

  it('a rejtett jelzés nem teszi elérhetővé a piszkozatot vagy az archivált kurzust', () => {
    for (const status of ['draft', 'archived', null]) {
      expect(courseVisibilityNotice(status, true, true)).toEqual(
        courseVisibilityNotice(status, true),
      )
    }
    for (const unlisted of [undefined, null, false, 'true']) {
      expect(courseVisibilityNotice('published', true, unlisted)).toEqual(
        courseVisibilityNotice('published', true),
      )
    }
  })

  it('a KITÖLTETLEN mezőnél figyelmeztet, és megnevezi a félrevezető felső sávot', () => {
    const notice = courseVisibilityNotice(null, false)
    expect(notice.kind).toBe('figyelmeztetes')
    expect(notice.title).toBe('Figyelem: ez a kurzus még nem látszik a weboldalon.')
    expect(notice.body).toContain('Állapot: Közzétett')
    // K42: verzál helyett kiemelés (<strong>), a kiemelt részlet a szövegben áll.
    expect(notice.emphasis).toBe('nem a weboldali megjelenésre')
    expect(notice.body).toContain(notice.emphasis)
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
    expect(notice.title).toBe('Figyelem: ez a kurzus archivált, ezért nem látszik a weboldalon.')
  })

  it('közzétett kurzusnál megerősít, nem riogat', () => {
    const notice = courseVisibilityNotice('published', false)
    expect(notice.kind).toBe('rendben')
    expect(notice.title).toBe('Ez a kurzus látszik a weboldalon.')
  })

  it('ismeretlen érték = nincs beállítva (sosem hazudik „látszik"-ot)', () => {
    for (const ertek of [undefined, '', 'Published', 'aktív', 42, {}, []]) {
      expect(normalizeVisibility(ertek)).toBeNull()
      expect(courseVisibilityNotice(ertek, true).kind).toBe('figyelmeztetes')
    }
  })

  it('K42: a szövegekben nincs verzál szó, gondolatjel és ASCII idézőjel', () => {
    const cases: Array<[unknown, boolean, unknown]> = [
      ['published', true, false],
      ['published', false, true],
      ['draft', true, false],
      ['draft', false, false],
      ['archived', false, false],
      [null, false, false],
    ]
    for (const [status, canEdit, unlisted] of cases) {
      const notice = courseVisibilityNotice(status, canEdit, unlisted)
      for (const text of [notice.title, notice.body]) {
        expect(text).not.toMatch(/\b[A-ZÁÉÍÓÖŐÚÜŰ]{2,}\b/u)
        expect(text).not.toMatch(/[–—"]/)
      }
    }
  })
})
