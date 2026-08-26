import { readFileSync } from 'node:fs'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CoursePlayer } from '../components/account/CoursePlayer'

import {
  AUTO_WATCHED_RATIO,
  adjacentLessons,
  completionAnnouncement,
  elativeSuffix,
  formatLessonDuration,
  initialOpenModuleIds,
  mergeModuleState,
  moduleStateKey,
  navigableLessons,
  previousAction,
  primaryAction,
  readModuleState,
  shouldAutoMarkWatched,
  writeModuleState,
  type ModuleStateStorage,
} from '../components/account/player/navigation'
import { ctaLabel } from '../lib/cta-vocabulary'
import { buildCurriculum, type Curriculum } from '../lib/curriculum/curriculum'
import type { Product } from '../payload-types'

/**
 * A KURZUS-LEJÁTSZÓ TISZTA LOGIKÁJA — navigáció, gombfeliratok, akkordeon-állapot.
 * A lejátszó felülete DOM-, iframe- és időzítő-nehéz, a repó tesztkörnyezete
 * viszont node (vitest.config.ts). Ezért minden szabály, ami DOM nélkül
 * eldönthető, tiszta modulba került
 * (src/components/account/player/navigation.ts) — ez a teszt AZT méri.
 */

/** A GENERÁLT Payload-típusok — így a teszt akkor is szól, ha a mező alakja változik. */
type ProductModules = NonNullable<Product['modules']>
type RawLesson = NonNullable<ProductModules[number]['lessons']>[number]

/** Videó-lecke a modell szabályai szerint elindítható alakban. */
function video(id: string, title: string, durationSec?: number): RawLesson {
  return { id, title, kind: 'video', streamAssetId: `guid-${id}`, status: 'ready', durationSec }
}

/** Feldolgozás alatti videó — NEM elindítható, a navigáció átlépi. */
function processing(id: string, title: string): RawLesson {
  return { id, title, kind: 'video', streamAssetId: `guid-${id}`, status: 'processing' }
}

function makeCurriculum(modules: ProductModules): Curriculum {
  return buildCurriculum({ modules, videos: [] }, true)
}

/** Két modul: az elsőben egy feldolgozás alatti lecke is van. */
const curriculum = makeCurriculum([
  {
    id: 'm1',
    title: '1. ALAPOK',
    lessons: [
      video('l1', 'Bevezetés', 125),
      processing('l2', 'Még készül'),
      { id: 'l3', title: 'Olvasnivaló', kind: 'szoveg' },
    ],
  },
  {
    id: 'm2',
    title: '2. GYAKORLATOK',
    lessons: [
      video('l4', 'Csuklókörzés', 3725),
      { id: 'l5', title: 'Csoport', kind: 'link', url: 'https://example.com' },
    ],
  },
])

describe('navigableLessons — a feldolgozás alatti lecke kimarad', () => {
  it('csak az elindítható leckék kerülnek a navigációs sorrendbe', () => {
    expect(navigableLessons(curriculum).map((lesson) => lesson.ref)).toEqual([
      'l1',
      'l3',
      'l4',
      'l5',
    ])
  })
})

describe('adjacentLessons — előző/következő', () => {
  it('a feldolgozás alatti leckét ÁTLÉPI', () => {
    const { next } = adjacentLessons(curriculum, 'l1')
    expect(next?.ref).toBe('l3')
  })

  it('modulhatáron át is halad', () => {
    const { next, previous } = adjacentLessons(curriculum, 'l3')
    expect(next?.ref).toBe('l4')
    expect(next?.moduleIndex).toBe(1)
    expect(previous?.ref).toBe('l1')
  })

  it('az első leckének nincs előzője, az utolsónak nincs következője', () => {
    expect(adjacentLessons(curriculum, 'l1').previous).toBeNull()
    expect(adjacentLessons(curriculum, 'l5').next).toBeNull()
  })

  it('ismeretlen vagy nem elindítható ref esetén egyik irány sincs', () => {
    expect(adjacentLessons(curriculum, 'l2')).toEqual({ previous: null, next: null })
    expect(adjacentLessons(curriculum, 'nincs-ilyen')).toEqual({ previous: null, next: null })
    expect(adjacentLessons(curriculum, null)).toEqual({ previous: null, next: null })
  })
})

describe('previousAction — nincs letiltott gomb', () => {
  it('az első leckén NINCS előző akció (a felület így ki sem teszi a gombot)', () => {
    expect(previousAction(curriculum, 'l1')).toBeNull()
  })

  it('a felirat a CÉL leckét nevezi meg', () => {
    expect(previousAction(curriculum, 'l4')).toEqual({
      label: 'Előző: Olvasnivaló',
      ariaLabel: 'Előző: Olvasnivaló (előző lecke)',
      targetRef: 'l3',
    })
  })
})

describe('primaryAction — a gombfeliratok állapotgépe', () => {
  it('nem kész lecke: JELÖL ÉS LÉP, a felirat a következő leckét nevezi meg', () => {
    const action = primaryAction(curriculum, 'l1', new Set())
    expect(action).not.toBeNull()
    expect(action?.kind).toBe('complete-and-advance')
    expect(action?.label).toBe('Kész, tovább: Olvasnivaló')
    expect(action?.marksWatched).toBe(true)
    expect(action?.targetRef).toBe('l3')
    expect(action?.disabled).toBe(false)
  })

  it('már kész lecke: csak LÉP, nem jelöl újra', () => {
    const action = primaryAction(curriculum, 'l1', new Set(['l1']))
    expect(action?.kind).toBe('advance')
    expect(action?.label).toBe('Következő: Olvasnivaló')
    expect(action?.marksWatched).toBe(false)
  })

  it('modulhatáron a felirat felvezetője a következő MODULT nevezi meg', () => {
    const action = primaryAction(curriculum, 'l3', new Set())
    expect(action?.moduleHint).toBe('Következő modul: 2. GYAKORLATOK')
    // A hozzáférhető név a LÁTHATÓ felirattal kezdődik (WCAG 2.5.3).
    expect(action?.ariaLabel.startsWith('Kész, tovább: Csuklókörzés')).toBe(true)
    expect(action?.ariaLabel).toContain('Következő modul: 2. GYAKORLATOK')
  })

  it('modulon belül NINCS modul-felvezető', () => {
    expect(primaryAction(curriculum, 'l4', new Set())?.moduleHint).toBeNull()
  })

  it('utolsó lecke, még nem kész: §3.2 #30 felirat, lépés nélkül', () => {
    const action = primaryAction(curriculum, 'l5', new Set(['l1', 'l3', 'l4']))
    expect(action?.kind).toBe('complete-course')
    expect(action?.label).toBe(ctaLabel('course-finish'))
    // A hozzáférhető név a LÁTHATÓ felirattal kezdődik (WCAG 2.2 · 2.5.3), és a
    // lecke nevét kettőspont vezeti be — a korábbi kvirtmínusz tiltott (§3.1.1).
    expect(action?.ariaLabel.startsWith(`${ctaLabel('course-finish')}: `)).toBe(true)
    expect(action?.ariaLabel.includes(String.fromCharCode(0x2014))).toBe(false)
    expect(action?.marksWatched).toBe(true)
    expect(action?.targetRef).toBeNull()
    expect(action?.disabled).toBe(false)
  })

  it('minden lecke kész: visszajelzés, letiltva, jelölés nélkül', () => {
    const action = primaryAction(curriculum, 'l5', new Set(['l1', 'l3', 'l4', 'l5']))
    expect(action?.kind).toBe('course-complete')
    expect(action?.label).toBe('Minden lecke kész')
    expect(action?.disabled).toBe(true)
    expect(action?.marksWatched).toBe(false)
  })

  /**
   * REGRESSZIÓ-ŐR. Ez a szélsőséges eset a valóságban gyakori: a vevő a
   * railből előreugrik az utolsó leckére, végignézi (az automatikus jelölés
   * késznek teszi), de korábban kihagyott egyet.
   *
   * Korábban ez az ág „Kurzus befejezése" gombot adott `marksWatched: true` +
   * `targetRef: null` értékkel — a lecke viszont MÁR kész volt, ezért a
   * jelölés azonnal kilépett, navigáció pedig nem volt: egy ENGEDÉLYEZETT
   * gomb, ami a kurzus befejezését ígérte, és a kattintásra semmi nem
   * történt. Most oda léptet, ahol a hiányzó munka van.
   */
  it('az utolsó lecke KÉSZ, de korábban kimaradt egy: a hiányzó leckére léptet', () => {
    const action = primaryAction(curriculum, 'l5', new Set(['l5']))

    expect(action?.kind).toBe('advance')
    expect(action?.label).toBe('Hátralévő lecke: Bevezetés')
    // A gomb SOSEM lehet no-op: vagy jelöl, vagy léptet.
    expect(action?.targetRef).toBe('l1')
    expect(action?.marksWatched).toBe(false)
    expect(action?.disabled).toBe(false)
  })

  it('a hiányzó lecke az ELSŐ nem kész a megjelenítési sorrendben', () => {
    const action = primaryAction(curriculum, 'l5', new Set(['l1', 'l5']))
    expect(action?.targetRef).toBe('l3')
  })

  it('az elsődleges gomb SOHA nem enged no-opot (jelöl VAGY léptet VAGY letiltott)', () => {
    const refek = ['l1', 'l3', 'l4', 'l5']
    // Minden lecke × minden „mi van kész" kombináció bejárása.
    for (const current of refek) {
      for (let maszk = 0; maszk < 1 << refek.length; maszk += 1) {
        const watched = new Set(refek.filter((_, i) => (maszk & (1 << i)) !== 0))
        const action = primaryAction(curriculum, current, watched)
        if (action === null) {
          continue
        }
        const teszValamit =
          action.disabled || action.targetRef !== null || (action.marksWatched && !watched.has(current))
        expect(teszValamit, `${current} / ${[...watched].join(',')} → ${action.kind}`).toBe(true)
      }
    }
  })

  it('ismeretlen aktuális lecke esetén nincs akció', () => {
    expect(primaryAction(curriculum, null, new Set())).toBeNull()
    expect(primaryAction(curriculum, 'nincs-ilyen', new Set())).toBeNull()
  })
})

describe('modul-nyitottság — kezdőállapot és megőrzés', () => {
  it('kezdetben CSAK az aktuális lecke modulja nyitva', () => {
    expect(initialOpenModuleIds(curriculum, 'l4')).toEqual(['m2'])
    expect(initialOpenModuleIds(curriculum, 'l1')).toEqual(['m1'])
  })

  it('aktív lecke nélkül az első modul nyílik (a lista ne tűnjön üresnek)', () => {
    expect(initialOpenModuleIds(curriculum, null)).toEqual(['m1'])
  })

  it('a kulcs KURZUSONKÉNT különbözik', () => {
    expect(moduleStateKey(7)).toBe('kc-player-modulok-7')
    expect(moduleStateKey(7)).not.toBe(moduleStateKey(8))
  })

  it('a megőrzött állapotból kiesik a már nem létező modul', () => {
    expect(mergeModuleState(curriculum, ['m2', 'torolt-modul'], 'l4')).toEqual(['m2'])
  })

  it('az AKTUÁLIS lecke modulja akkor is nyitva van, ha a mentés csukná', () => {
    expect(mergeModuleState(curriculum, ['m1'], 'l4')).toEqual(['m1', 'm2'])
  })

  it('mentés hiányában a kezdőállapot jön', () => {
    expect(mergeModuleState(curriculum, null, 'l4')).toEqual(['m2'])
  })

  it('a visszaadott sorrend a TANANYAGÉ, nem a mentésé', () => {
    expect(mergeModuleState(curriculum, ['m2', 'm1'], 'l1')).toEqual(['m1', 'm2'])
  })
})

describe('readModuleState / writeModuleState — a privát mód nem törhet el semmit', () => {
  function storage(initial: Record<string, string>): ModuleStateStorage & { store: Record<string, string> } {
    const store = { ...initial }
    return {
      store,
      getItem: (key) => store[key] ?? null,
      setItem: (key, value) => {
        store[key] = value
      },
    }
  }

  it('érvényes mentés visszaolvasható', () => {
    const target = storage({ 'kc-player-modulok-1': '["m1","m2"]' })
    expect(readModuleState(target, 'kc-player-modulok-1')).toEqual(['m1', 'm2'])
  })

  it('hiányzó kulcs → null (a hívó a kezdőállapotot használja)', () => {
    expect(readModuleState(storage({}), 'kc-player-modulok-1')).toBeNull()
  })

  it('elrontott JSON → null, NEM kivétel', () => {
    const target = storage({ 'kc-player-modulok-1': '{nem json' })
    expect(readModuleState(target, 'kc-player-modulok-1')).toBeNull()
  })

  it('nem-tömb és nem-string elemek kiszűrődnek', () => {
    const target = storage({ 'kc-player-modulok-1': '{"a":1}' })
    expect(readModuleState(target, 'kc-player-modulok-1')).toBeNull()
    const mixed = storage({ 'kc-player-modulok-1': '["m1",7,null,"m2"]' })
    expect(readModuleState(mixed, 'kc-player-modulok-1')).toEqual(['m1', 'm2'])
  })

  it('DOBÓ tároló (privát mód) esetén sem száll el — sem olvasásnál, sem írásnál', () => {
    const throwing: ModuleStateStorage = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(readModuleState(throwing, 'kulcs')).toBeNull()
    expect(() => writeModuleState(throwing, 'kulcs', ['m1'])).not.toThrow()
  })

  it('hiányzó tároló (szerveroldal) esetén is működik', () => {
    expect(readModuleState(null, 'kulcs')).toBeNull()
    expect(() => writeModuleState(null, 'kulcs', ['m1'])).not.toThrow()
  })

  it('az írás a nyitott modulok tömbjét menti', () => {
    const target = storage({})
    writeModuleState(target, 'kulcs', new Set(['m1', 'm2']))
    expect(target.store.kulcs).toBe('["m1","m2"]')
  })
})

describe('formatLessonDuration', () => {
  it('percet és másodpercet ad, két számjegyű másodperccel', () => {
    expect(formatLessonDuration(125)).toBe('2:05')
    expect(formatLessonDuration(59)).toBe('0:59')
  })

  it('órás anyagnál óra:perc:másodperc', () => {
    expect(formatLessonDuration(3725)).toBe('1:02:05')
  })

  it('hiányzó vagy értelmetlen hossz → null (a felület nem ír ki semmit)', () => {
    expect(formatLessonDuration(null)).toBeNull()
    expect(formatLessonDuration(0)).toBeNull()
    expect(formatLessonDuration(-4)).toBeNull()
    expect(formatLessonDuration(Number.NaN)).toBeNull()
  })
})

describe('elativeSuffix — a bejelentés magyarul hangozzon el', () => {
  it('az utolsó KIMONDOTT szó dönt', () => {
    expect(elativeSuffix(18)).toBe('ból') // tizennyolcból
    expect(elativeSuffix(12)).toBe('ből') // tizenkettőből
    expect(elativeSuffix(7)).toBe('ből') // hétből
    expect(elativeSuffix(6)).toBe('ból') // hatból
    expect(elativeSuffix(3)).toBe('ból') // háromból
  })

  it('kerek tízeseknél a tízes szava dönt', () => {
    expect(elativeSuffix(10)).toBe('ből') // tízből
    expect(elativeSuffix(20)).toBe('ból') // húszból
    expect(elativeSuffix(40)).toBe('ből') // negyvenből
    expect(elativeSuffix(60)).toBe('ból') // hatvanból
  })

  it('száz és ezer', () => {
    expect(elativeSuffix(100)).toBe('ból') // százból
    expect(elativeSuffix(1000)).toBe('ből') // ezerből
  })

  it('a bejelentés teljes mondata összeáll', () => {
    expect(completionAnnouncement({ lessonTitle: 'Csuklókörzés', completed: 12, total: 18 })).toBe(
      'Csuklókörzés befejezve. 12 lecke kész a 18-ból.',
    )
  })
})

describe('shouldAutoMarkWatched — az automatikus jelölés küszöbe', () => {
  it('a küszöb felett jelöl', () => {
    expect(shouldAutoMarkWatched(AUTO_WATCHED_RATIO, false)).toBe(true)
    expect(shouldAutoMarkWatched(1, false)).toBe(true)
  })

  it('a küszöb alatt nem', () => {
    expect(shouldAutoMarkWatched(0.5, false)).toBe(false)
  })

  it('a már kész leckét nem jelöli újra (nem küld fölösleges kérést)', () => {
    expect(shouldAutoMarkWatched(1, true)).toBe(false)
  })

  it('értelmetlen arány esetén nem jelöl', () => {
    // A NaN és a végtelen egyaránt a jelentő oldal hibája — ilyenkor NEM
    // szabad a vevő nevében készre jelölni egy leckét.
    expect(shouldAutoMarkWatched(Number.NaN, false)).toBe(false)
    expect(shouldAutoMarkWatched(Number.POSITIVE_INFINITY, false)).toBe(false)
  })
})

describe('régi, lapos videólistás kurzus — a navigáció ott is működik', () => {
  it('az implicit modul leckéi között ugyanúgy lehet lépni', () => {
    const legacy = buildCurriculum(
      {
        modules: [],
        videos: [
          { id: 'v1', title: 'Első rész', streamAssetId: 'g1', status: 'ready' },
          { id: 'v2', title: 'Második rész', streamAssetId: 'g2', status: 'ready' },
        ],
      },
      true,
    )
    expect(legacy.legacy).toBe(true)
    expect(adjacentLessons(legacy, 'v1').next?.ref).toBe('v2')
    expect(primaryAction(legacy, 'v1', new Set())?.label).toBe('Kész, tovább: Második rész')
    expect(initialOpenModuleIds(legacy, 'v2')).toEqual(['legacy'])
  })
})

/**
 * A KOMPONENS SZERZŐDÉSE — a szerveroldali kimeneten mérve.
 *
 * A repó tesztkörnyezete node, ezért nincs kattintás-szimuláció; ami viszont a
 * STATIKUS jelölésben eldől — az akadálymentességi szerződés, az élő régió
 * jelenléte, a színfüggetlen állapotjelölés —, azt itt őrizzük. Ezek pontosan
 * azok a részletek, amelyek egy átszabásnál NÉMÁN tűnnek el.
 */
describe('CoursePlayer — a felület szerződése a szerveroldali kimeneten', () => {
  const html = renderToStaticMarkup(
    createElement(CoursePlayer, {
      product: { id: 5, slug: 'kezrehab', title: 'Kézrehab alapkurzus' },
      curriculum,
      hasAccess: true,
      watchedRefs: ['l1'],
    }),
  )

  it('W3C APG akkordeon: a fejléc-gomb aria-expanded + aria-controls, a panel aria-labelledby', () => {
    expect(html).toContain('id="kc-player-5-modul-0-fejlec"')
    expect(html).toContain('aria-controls="kc-player-5-modul-0-panel"')
    expect(html).toContain('aria-labelledby="kc-player-5-modul-0-fejlec"')
    // A modul-fejléc GOMB egy h3-ban ül (a fejléc-szint a listát strukturálja).
    expect(html).toContain('<h3 class="kc-player-rail__module-heading"><button')
  })

  it('kezdetben CSAK az aktuális lecke modulja nyitva (a második panel hidden)', () => {
    // A folytatás az első nem kész lecke: 'l3' az 1. modulban → m1 nyitva, m2 zárva.
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toMatch(/id="kc-player-5-modul-1-panel"[^>]*hidden|hidden[^>]*id="kc-player-5-modul-1-panel"/)
  })

  it('az állapot SOSEM csak színnel jelölt: minden sor visel szöveges állapotot', () => {
    expect(html).toContain('Befejezve')
    expect(html).toContain('Nem kezdett')
    expect(html).toContain('Hamarosan elérhető')
  })

  it('az aktív lecke aria-current="true"-t kap', () => {
    expect(html).toContain('aria-current="true"')
  })

  it('EGYETLEN, mindig jelen lévő élő régió van (nem feltételesen renderelt)', () => {
    const statusRegions = html.match(/role="status"/g) ?? []
    expect(statusRegions).toHaveLength(1)
    expect(html).toContain('aria-live="polite"')
  })

  it('a lecke címe programozottan fókuszálható h1 (lecke-váltáskor ide megy a fókusz)', () => {
    expect(html).toMatch(/<h1 class="kc-player__lesson-title"[^>]*tabindex="-1"/)
  })

  it('az elsődleges akció a CÉLT nevezi meg, nem csak azt, hogy „Következő"', () => {
    expect(html).toContain('Kész, tovább: Csuklókörzés')
  })

  it('a haladás a tananyag-modell közös szövegével jelenik meg', () => {
    expect(html).toContain('1/4 lecke kész')
    expect(html).toContain('role="progressbar"')
  })

  it('a mobil tananyag-panelt nyitó gomb dialógust jelez', () => {
    expect(html).toContain('aria-haspopup="dialog"')
  })

  it('SZÖVEGES lecke: nincs iframe (és így token-kérés sem indul)', () => {
    expect(html).not.toContain('<iframe')
  })
})

describe('CoursePlayer — kapuzott állapotok', () => {
  it('feldolgozás alatti tananyagnál nem üres képernyő, hanem magyar magyarázat', () => {
    const onlyProcessing = makeCurriculum([
      { id: 'm1', title: 'Modul', lessons: [processing('p1', 'Készül')] },
    ])
    const html = renderToStaticMarkup(
      createElement(CoursePlayer, {
        product: { id: 5, title: 'Kézrehab alapkurzus' },
        curriculum: onlyProcessing,
        hasAccess: true,
      }),
    )
    expect(html).toContain('feldolgozása folyamatban van')
    expect(html).not.toContain('<iframe')
  })

  it('minden lecke kész: visszafogott megerősítés, elutasító gomb nélkül', () => {
    const html = renderToStaticMarkup(
      createElement(CoursePlayer, {
        product: { id: 5, title: 'Kézrehab alapkurzus' },
        curriculum,
        hasAccess: true,
        watchedRefs: ['l1', 'l3', 'l4', 'l5'],
      }),
    )
    expect(html).toContain('Elvégezted a kurzust — 4 lecke kész')
    expect(html).toContain('4/4 lecke kész')
    // A sáv NEM elutasítható (nincs „×", nincs „később"): nincs mit elhárítani,
    // és a dark pattern-tilalom szerint nem is kell rá válaszolni.
    expect(html).not.toContain('Nem érdekel')
    expect(html).not.toContain('Később')
  })

  it('a KÉSZ kurzus utolsó leckéjén a primer gomb már csak visszajelzés', () => {
    // A folytatás-ajánlás kész kurzusnál az ELSŐ leckére mutat (újranézés),
    // ezért a „Minden lecke kész" visszajelzés az utolsó leckén jelenik meg —
    // ott, ahol tényleg nincs hová továbblépni.
    const done = new Set(['l1', 'l3', 'l4', 'l5'])
    const action = primaryAction(curriculum, 'l5', done)
    expect(action?.kind).toBe('course-complete')
    expect(action?.disabled).toBe(true)
    // …miközben az első leckén továbbra is van értelmes következő lépés.
    expect(primaryAction(curriculum, 'l1', done)?.kind).toBe('advance')
  })
})

/**
 * A jelölés duplikáció-védelme korábban a `watched` és a `pending` ÁLLAPOTOT
 * olvasta, ami a callback lezárásából jön, és két renderelés között elavul.
 * Élesben mérve: gyors `timeupdate`-ütem mellett EGY leckére NÉGY
 * `mark-watched` kérés ment ki, és minden duplikátum újra lefuttatta a
 * funnel-blokkot — a „kurzusonként egyszer" mérföldkövek (course_started,
 */
describe('markWatched — a duplikáció-védelem szerkezeti', () => {
  const source = readFileSync(
    new URL('../components/account/CoursePlayer.tsx', import.meta.url),
    'utf8',
  )

  it('a zár SZINKRON refet olvas, nem renderelés-függő állapotot', () => {
    expect(source).toMatch(/if \(keszLeckekRef\.current\.has\(lessonRef\)\) \{\s*\n\s*return/)
    // A régi, elavuló lezárásra épülő alak nem térhet vissza.
    expect(source).not.toMatch(/watched\.has\(lessonRef\) \|\| pending\.has\(lessonRef\)/)
  })

  it('az automatikus jelölés is a refet nézi (a timeupdate sűrűbb a renderelésnél)', () => {
    expect(source).toMatch(/shouldAutoMarkWatched\(watchedRatio, keszLeckekRef\.current\.has/)
  })

  /**
   * A mérföldkő-pillanatkép a SIKER-ágban, a csak sikernél előrelépő
   * `analitikaRef`-ből készül. A code review mérte a korábbi (hívás előtti,
   * optimista zárból vett) pillanatkép hibáját: párhuzamos jelöléseknél a
   * megbukó társ benne ragadt a másik hívás pillanatképében.
   */
  it('a mérföldkő-pillanatkép a SIKER-ágban, az analitika-refből készül', () => {
    const markWatchedIndex = source.indexOf('const markWatched = useCallback(')
    expect(markWatchedIndex).toBeGreaterThan(-1)
    const awaitIndex = source.indexOf('await markVideoWatched(', markWatchedIndex)
    const beforeIndex = source.indexOf(
      'const before = summarizeCurriculum(curriculum, analitikaRef.current)',
      markWatchedIndex,
    )
    expect(awaitIndex).toBeGreaterThan(-1)
    // A pillanatkép a hálózati hívás UTÁN (a siker-ágban) készül…
    expect(beforeIndex).toBeGreaterThan(awaitIndex)
    // …és az analitika-könyvelés kizárólag ott lép előre.
    const advanceCount = source.split('analitikaRef.current = ').length - 1
    expect(advanceCount).toBe(1)
  })
})
