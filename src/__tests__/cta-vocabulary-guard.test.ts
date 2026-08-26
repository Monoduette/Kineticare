import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  CTA_PROGRESS_LABELS,
  CTA_VOCABULARY,
  buildCtaIndex,
  ctaEntry,
  ctaLabel,
  ctaPatternEntry,
  ctaProgressLabel,
  isApprovedCtaLabel,
  type CtaAction,
  type CtaEntry,
} from '@/lib/cta-vocabulary'

import {
  BARE_FORBIDDEN_LABELS,
  ELLIPSIS,
  EM_DASH,
  EN_DASH,
  pusztaAlak,
} from './helpers/cta-mikroszoveg'

/**
 * G-UI1 – CTA-SZÓTÁR ŐR (`docs/ui-sztenderdek.md` §6.3).
 * Két dolgot véd, és mindkettő valós, mért hibából nőtt ki:
 * 1. A MIKROSZÖVEG-SZABÁLYOK (§3.1). A repóban a mérés 4688 db U+2014-et
 * talált, köztük vevő által látott gombfeliratban is
 * („Ingyenes — azonnal eléred"). A tulajdonos kifogása („AI-szagú,
 */

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const UI_STANDARDS_PATH = `${REPO_ROOT}docs/ui-sztenderdek.md`
const BUTTON_INVENTORY_PATH = `${REPO_ROOT}docs/gomb-inventar.md`

/** Minden látható CTA-felirat (a #16 magyarázó mondatával együtt). */
const ALL_LABELS: readonly string[] = CTA_VOCABULARY.map((entry) => entry.label)

/** Csak a gombfeliratok – a magyarázó mondatra a szóhossz-korlát nem vonatkozik. */
const BUTTON_LABELS: readonly string[] = CTA_VOCABULARY.filter(
  (entry) => entry.person !== 'explanatory',
).map((entry) => entry.label)

const PROGRESS_LABELS: readonly string[] = Object.values(CTA_PROGRESS_LABELS)

const ALL_TEXTS: readonly string[] = [...ALL_LABELS, ...PROGRESS_LABELS]

/**
 * Kiszedi egy markdown-táblázat megnevezett oszlopából a backtickes
 * szövegeket. Csak a fejlécben megnevezett oszlopot nézi, hogy a „Miért ez"
 * oszlopban idézett ROSSZ feliratok (pl. a mai „Ingyenes — azonnal eléred")
 * ne kerüljenek a jóváhagyott halmazba.
 */
function backtickedCellsOfColumn(markdown: string, columnNeedle: string): string[] {
  const lines = markdown.split('\n')
  const found: string[] = []

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line.startsWith('|') || !line.includes(columnNeedle)) continue
    // Csak akkor FEJLÉC, ha a következő sor a markdown elválasztója – így egy
    // adatsorban előforduló szó nem indít téves oszlop-olvasást.
    if (!/^\|[\s:|-]+\|$/u.test(lines[i + 1] ?? '')) continue

    const header = line.split('|').map((cell) => cell.trim())
    const columnIndex = header.findIndex((cell) => cell.includes(columnNeedle))
    if (columnIndex === -1) continue

    // A fejléc utáni elválasztó sort átlépjük, majd a sorokat a tábla végéig olvassuk.
    for (let row = i + 2; row < lines.length; row += 1) {
      const rowLine = lines[row]
      if (!rowLine.startsWith('|')) break
      const cells = rowLine.split('|').map((cell) => cell.trim())
      const cell = cells[columnIndex]
      if (cell === undefined) continue
      for (const match of cell.matchAll(/`([^`]+)`/g)) {
        found.push(match[1])
      }
    }
  }

  return found
}

/**
 * A L-1 (folyamatban-feliratok) felsorolás backtickes elemei.
 *
 * A horgony a §3.2-beli „L-1 jóváhagyott feliratkészlet" félkövér cím. Ha a
 * doksiban átfogalmazzák, ez a teszt HANGOSAN bukik – szándékosan: a néma
 * átugrás (üres lista → triviálisan zöld) rosszabb, mint a hamis riasztás.
 */
const L1_DOC_ANCHOR = 'L-1 jóváhagyott feliratkészlet'

function progressLabelsFromDoc(markdown: string): string[] {
  const lines = markdown.split('\n')
  const anchor = lines.findIndex((line) => line.includes(L1_DOC_ANCHOR))
  expect(anchor, `a "${L1_DOC_ANCHOR}" horgony nem található a §3.2-ben`).toBeGreaterThan(-1)

  for (let i = anchor; i < lines.length; i += 1) {
    if (!lines[i].startsWith('`')) continue
    return [...lines[i].matchAll(/`([^`]+)`/g)].map((match) => match[1])
  }
  throw new Error('a L-1 felsorolás sora nem található')
}

describe('G-UI1 – CTA-szótár: mikroszöveg-szabályok (docs/ui-sztenderdek.md §3.1)', () => {
  it('egyetlen feliratban sincs U+2014 (kvirtmínusz) – magyar szövegben nem írásjel', () => {
    const offenders = ALL_TEXTS.filter((text) => text.includes(EM_DASH))
    expect(offenders, 'U+2014 a CTA-szótárban').toEqual([])
  })

  it('egyetlen feliratban sincs gondolatjel (U+2013) – gombszövegben nulla a küszöb', () => {
    const offenders = ALL_TEXTS.filter((text) => text.includes(EN_DASH))
    expect(offenders, 'U+2013 a CTA-szótárban').toEqual([])
  })

  it('egyetlen felirat sem kezdődik „Tovább"-bal (M-7: nem mondja meg, mi történik)', () => {
    const offenders = ALL_LABELS.filter((label) =>
      label.toLocaleLowerCase('hu').startsWith('tovább'),
    )
    expect(offenders, '„Tovább"-bal kezdődő felirat').toEqual([])
  })

  it('egyetlen felirat sem puszta tiltott szó (M-7: Küldés, OK, Bővebben, Részletek…)', () => {
    const offenders = ALL_LABELS.filter((label) => BARE_FORBIDDEN_LABELS.includes(pusztaAlak(label)))
    expect(offenders, 'puszta, célt nem nevező felirat').toEqual([])
  })

  it('minden gombfelirat legfeljebb 4 szó (M-3; NN/g: 2–4 szó)', () => {
    const offenders = BUTTON_LABELS.filter((label) => label.split(/\s+/u).length > 4)
    expect(offenders, '4 szónál hosszabb gombfelirat').toEqual([])
  })

  it('minden felirat mondatkezdő nagybetűs és nem csupa nagybetű (M-4)', () => {
    const notSentenceCase = ALL_LABELS.filter(
      (label) => label.charAt(0) !== label.charAt(0).toLocaleUpperCase('hu'),
    )
    expect(notSentenceCase, 'kisbetűvel kezdődő felirat').toEqual([])

    const shouting = ALL_LABELS.filter((label) => label === label.toLocaleUpperCase('hu'))
    expect(shouting, 'csupa nagybetűs felirat (verzál csak CSS-ből)').toEqual([])
  })

  it('minden folyamatban-felirat U+2026-tal végződik, nem három ponttal (P-1d)', () => {
    const offenders = PROGRESS_LABELS.filter(
      (label) => !label.endsWith(ELLIPSIS) || label.includes('...'),
    )
    expect(offenders, 'rossz három pont a folyamatban-feliratban').toEqual([])
  })
})

describe('G-UI1 – CTA-szótár: egy cselekvés = egy felirat (WCAG 2.2 SC 3.2.4)', () => {
  it('nincs két bejegyzés ugyanarra a cselekvés-kulcsra', () => {
    const seen = new Map<string, string>()
    const duplicates: string[] = []
    for (const entry of CTA_VOCABULARY) {
      const existing = seen.get(entry.action)
      if (existing !== undefined) {
        duplicates.push(`${entry.action}: "${existing}" ↔ "${entry.label}"`)
        continue
      }
      seen.set(entry.action, entry.label)
    }
    expect(duplicates, 'ugyanarra a cselekvésre két felirat').toEqual([])
  })

  it('nincs két különböző cselekvés azonos felirattal (szinonima visszafelé is hiba)', () => {
    const byLabel = new Map<string, string[]>()
    for (const entry of CTA_VOCABULARY) {
      byLabel.set(entry.label, [...(byLabel.get(entry.label) ?? []), entry.action])
    }
    const collisions = [...byLabel.entries()]
      .filter(([, actions]) => actions.length > 1)
      .map(([label, actions]) => `${label}: ${actions.join(', ')}`)
    expect(collisions, 'azonos felirat két cselekvésen').toEqual([])
  })

  it('az index-építő HANGOSAN bukik, ha mégis két felirat kerül egy cselekvésre', () => {
    const original = CTA_VOCABULARY[0]
    const duplicate: CtaEntry = { ...original, label: 'Másik felirat' }
    expect(() => buildCtaIndex([original, duplicate])).toThrow(/két felirat került be/u)
    // Az éles szótár ugyanezen az úton épül, tehát a hiba modulbetöltéskor dől ki.
    expect(() => buildCtaIndex(CTA_VOCABULARY)).not.toThrow()
  })

  it('minden bejegyzés hivatkozik a §3.2 sorszámára (visszakereshetőség)', () => {
    const offenders = CTA_VOCABULARY.filter((entry) => !entry.section.startsWith('#'))
    expect(offenders.map((entry) => entry.action)).toEqual([])
  })

  it('a `patterned` és a `pattern` mező EGYÜTT jár (C-6, 2026-08-18)', () => {
    // A `patterned: true` 2026-08-18 előtt csak EMBERNEK szóló jelölés volt,
    // ezért a termék-oldali őr kilenc szabályos `Vissza a …` feliratot
    // kivétel-sorként vezetett. A gépi alak (`pattern`) ezt zárja be — de csak
    // akkor, ha a kettő nem tud szétcsúszni.
    const szetcsuszott = CTA_VOCABULARY.filter(
      (entry) => entry.patterned !== (entry.pattern !== null),
    ).map((entry) => `${entry.section} ${entry.action}`)
    expect(
      szetcsuszott,
      '`patterned: true` mellett KÖTELEZŐ a `pattern`, és fordítva',
    ).toEqual([])
  })

  it('minden MINTÁZATOS sor saját felirata illeszkedik a saját mintázatára', () => {
    // Enélkül egy elgépelt mintázat („^Vissza az …") némán elfogadna mindent,
    // amit nem kellene, és elutasítaná a kanonikus alakot.
    const nemIllik = CTA_VOCABULARY.filter(
      (entry) => entry.pattern !== null && !new RegExp(entry.pattern, 'u').test(entry.label),
    ).map((entry) => `${entry.section} „${entry.label}" ↛ /${entry.pattern ?? ''}/`)
    expect(nemIllik, 'a mintázat nem ismeri fel a saját kanonikus feliratát').toEqual([])
  })

  it('a mintázat KÖTELEZŐ, nem üres tárgyat kér (a puszta alak nem „Substantial")', () => {
    expect(ctaPatternEntry('Vissza a kezdőlapra')?.action).toBe('back-to-courses')
    expect(ctaPatternEntry('Letöltöm az igazolást')?.action).toBe('invoice-download')
    expect(ctaPatternEntry('Hívd Kiss Katát')?.action).toBe('call-specialist')

    for (const puszta of ['Vissza', 'Vissza a', 'Vissza a ', 'Letöltöm', 'Hívd', 'Hívd ']) {
      expect(ctaPatternEntry(puszta), `a puszta „${puszta}" nem lehet mintázatos alak`).toBeNull()
    }
  })

  it('`isApprovedCtaLabel`: szótári VAGY mintázatos, más nem', () => {
    expect(isApprovedCtaLabel('Megveszem a kurzust')).toBe(true)
    expect(isApprovedCtaLabel('Küldés…')).toBe(false) // L-1, nem §3.2-felirat
    expect(isApprovedCtaLabel('Vissza a Tudástárba')).toBe(true)
    expect(isApprovedCtaLabel('Tovább a kurzusaimhoz')).toBe(false)
    expect(isApprovedCtaLabel('Megveszem')).toBe(false)
  })

  it('a lekérdező függvények a szótárból dolgoznak, ismeretlen kulcsra pedig hangosan buknak', () => {
    expect(ctaLabel('course-buy')).toBe('Megveszem a kurzust')
    expect(ctaEntry('checkout-submit').weight).toBe('primary')
    expect(ctaProgressLabel('checkout-submit')).toBe(CTA_PROGRESS_LABELS.processing)
    expect(ctaProgressLabel('course-buy')).toBeNull()

    // Szándékos típus-kényszerítés: futásidőben is védve kell lennie (nem `any`).
    const unknownAction = 'nincs-ilyen-cselekves' as CtaAction
    expect(() => ctaLabel(unknownAction)).toThrow(/nincs jóváhagyott felirat/u)
  })
})

describe('G-UI1 – a szótár és a két doksi bitre egyezik', () => {
  it('a §3.2 „Jóváhagyott felirat" oszlopa pontosan a modul feliratkészlete', () => {
    const markdown = readFileSync(UI_STANDARDS_PATH, 'utf8')
    const fromDoc = new Set(backtickedCellsOfColumn(markdown, 'Jóváhagyott felirat'))
    expect(fromDoc.size, 'a §3.2 táblázat nem található vagy üres').toBeGreaterThan(0)
    expect([...fromDoc].sort()).toEqual([...new Set(ALL_LABELS)].sort())
  })

  it('a §3.2 L-1 felsorolása pontosan a modul folyamatban-feliratai', () => {
    const markdown = readFileSync(UI_STANDARDS_PATH, 'utf8')
    expect(progressLabelsFromDoc(markdown).sort()).toEqual([...PROGRESS_LABELS].sort())
  })

  it('a gomb-inventar.md §5 „Jóváhagyott" oszlopa ugyanezeket a feliratokat képezi le', () => {
    const markdown = readFileSync(BUTTON_INVENTORY_PATH, 'utf8')
    const fromInventory = new Set(backtickedCellsOfColumn(markdown, 'Jóváhagyott'))
    expect(fromInventory.size, 'a gomb-inventar §5 leképezés nem található').toBeGreaterThan(0)
    expect([...fromInventory].sort()).toEqual([...new Set([...ALL_LABELS, ...PROGRESS_LABELS])].sort())
  })
})
