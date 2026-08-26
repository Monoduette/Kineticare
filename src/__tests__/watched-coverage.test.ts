import { describe, expect, it } from 'vitest'

import {
  createWatchTracker,
  DEFAULT_MAX_CONTINUITY_GAP_SEC,
  isWatchedComplete,
  MAX_ADAPTIVE_GAP_SEC,
  mergeWatchIntervals,
  WATCHED_COMPLETION_RATIO,
  watchedRatio,
  watchedSecondsOf,
} from '../lib/stream/watched-coverage'

/**
 * A megnézett-arány számítás egységtesztje.
 *
 * A modul TISZTA (nincs DOM-ja, hálózata, ideje), ezért itt semmit nem kell
 * mockolni — és semmilyen hálózati hívás sem indulhat el.
 *
 * A tesztek a valódi lejátszó-viselkedést utánozzák: a `timeupdate` esemény
 * sűrűn, kis lépésekkel érkezik, a tekerés viszont NAGY ugrást okoz. Az
 * `emit` segéd ezt a sűrű mintavételt modellezi.
 */

/** Folyamatos lejátszás `from`-tól `to`-ig, `step` másodperces mintavétellel. */
function emit(record: (seconds: number) => void, from: number, to: number, step = 0.25): void {
  for (let seconds = from; seconds < to; seconds += step) {
    record(Number(seconds.toFixed(6)))
  }
  record(to)
}

describe('mergeWatchIntervals', () => {
  it('rendez és egyesíti az átfedő szakaszokat', () => {
    expect(
      mergeWatchIntervals([
        { start: 10, end: 20 },
        { start: 0, end: 5 },
        { start: 15, end: 30 },
      ]),
    ).toEqual([
      { start: 0, end: 5 },
      { start: 10, end: 30 },
    ])
  })

  it('az érintkező szakaszok (vég === kezdet) is egyesülnek', () => {
    expect(
      mergeWatchIntervals([
        { start: 0, end: 10 },
        { start: 10, end: 20 },
      ]),
    ).toEqual([{ start: 0, end: 20 }])
  })

  it('a teljesen tartalmazott szakasz nem rövidíti le a befoglalót', () => {
    expect(
      mergeWatchIntervals([
        { start: 0, end: 100 },
        { start: 10, end: 20 },
      ]),
    ).toEqual([{ start: 0, end: 100 }])
  })

  it('a hibás alakú szakaszokat (NaN, végtelen, fordított) eldobja', () => {
    expect(
      mergeWatchIntervals([
        { start: Number.NaN, end: 10 },
        { start: 0, end: Number.POSITIVE_INFINITY },
        { start: 30, end: 20 },
        { start: 1, end: 2 },
      ]),
    ).toEqual([{ start: 1, end: 2 }])
  })

  it('üres bemenet → üres kimenet', () => {
    expect(mergeWatchIntervals([])).toEqual([])
  })
})

describe('watchedSecondsOf / watchedRatio', () => {
  it('a hosszra vágja a túllógó szakaszt', () => {
    expect(watchedSecondsOf([{ start: 0, end: 500 }], 100)).toBe(100)
    expect(watchedRatio([{ start: 0, end: 500 }], 100)).toBe(1)
  })

  it('a negatív tartományba lógó szakasz csak a 0 fölötti részével számít', () => {
    expect(watchedSecondsOf([{ start: -50, end: 10 }], 100)).toBe(10)
  })

  it('ismeretlen / 0 / negatív / NaN hossz → 0 arány, sosem NaN', () => {
    const intervals = [{ start: 0, end: 100 }]
    for (const duration of [null, undefined, 0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(watchedSecondsOf(intervals, duration)).toBe(0)
      expect(watchedRatio(intervals, duration)).toBe(0)
    }
  })
})

describe('isWatchedComplete', () => {
  it('a küszöb pontos elérése kész', () => {
    expect(isWatchedComplete(0.9)).toBe(true)
  })

  it('lebegőpontos hajszálnyi hiány még kész (epszilon-tűrés)', () => {
    expect(isWatchedComplete(0.9 - 1e-12)).toBe(true)
  })

  it('valódi elmaradás nem kész', () => {
    expect(isWatchedComplete(0.89)).toBe(false)
  })

  it('0, negatív és NaN sosem kész', () => {
    expect(isWatchedComplete(0)).toBe(false)
    expect(isWatchedComplete(-1)).toBe(false)
    expect(isWatchedComplete(Number.NaN)).toBe(false)
  })
})

describe('createWatchTracker — lineáris nézés', () => {
  it('a teljes videó végignézése 100%, és kész', () => {
    const tracker = createWatchTracker(100)
    emit(tracker.record, 0, 100)
    expect(tracker.coverage()).toBe(1)
    expect(tracker.watchedSeconds()).toBe(100)
    expect(tracker.isComplete()).toBe(true)
    expect(tracker.intervals()).toEqual([{ start: 0, end: 100 }])
  })

  it('a videó feléig nézve 50%, és NEM kész', () => {
    const tracker = createWatchTracker(100)
    emit(tracker.record, 0, 50)
    expect(tracker.coverage()).toBeCloseTo(0.5, 10)
    expect(tracker.isComplete()).toBe(false)
  })

  it('pontosan a küszöbig nézve (90/100) már kész — 0,9 határeset', () => {
    const tracker = createWatchTracker(100)
    emit(tracker.record, 0, 90)
    expect(tracker.coverage()).toBe(WATCHED_COMPLETION_RATIO)
    expect(tracker.isComplete()).toBe(true)
  })

  it('a küszöb alatt egy hajszállal (89,9/100) még nem kész', () => {
    const tracker = createWatchTracker(100)
    emit(tracker.record, 0, 89.9)
    expect(tracker.isComplete()).toBe(false)
  })
})

describe('createWatchTracker — szkippelés (előretekerés)', () => {
  it('az ÁTUGROTT szakasz nem számít megnézettnek', () => {
    const tracker = createWatchTracker(100)
    emit(tracker.record, 0, 10)
    // Tekerés a 90. másodpercre — a 10–90 közti rész kimarad.
    emit(tracker.record, 90, 100)
    expect(tracker.watchedSeconds()).toBe(20)
    expect(tracker.coverage()).toBeCloseTo(0.2, 10)
    expect(tracker.isComplete()).toBe(false)
    expect(tracker.intervals()).toEqual([
      { start: 0, end: 10 },
      { start: 90, end: 100 },
    ])
  })

  it('a csúszka végére rántása NEM tesz készre (a kijátszás elleni fő védelem)', () => {
    const tracker = createWatchTracker(100)
    tracker.record(0)
    tracker.record(99.5)
    tracker.record(100)
    expect(tracker.coverage()).toBeCloseTo(0.005, 10)
    expect(tracker.isComplete()).toBe(false)
  })

  it('a küszöbnyi ugrás (2 mp) még folyamatos, a küszöb fölötti már tekerés', () => {
    const contiguous = createWatchTracker(100)
    contiguous.record(0)
    contiguous.record(DEFAULT_MAX_CONTINUITY_GAP_SEC)
    expect(contiguous.intervals()).toEqual([{ start: 0, end: DEFAULT_MAX_CONTINUITY_GAP_SEC }])

    const seeked = createWatchTracker(100)
    seeked.record(0)
    seeked.record(DEFAULT_MAX_CONTINUITY_GAP_SEC + 0.001)
    expect(seeked.intervals()).toEqual([
      { start: 0, end: 0 },
      { start: DEFAULT_MAX_CONTINUITY_GAP_SEC + 0.001, end: DEFAULT_MAX_CONTINUITY_GAP_SEC + 0.001 },
    ])
  })

  it('sok apró átugrás összeadódva sem tesz készre', () => {
    const tracker = createWatchTracker(100)
    // 10 db 5 másodperces szakasz megnézve, közöttük 5 mp átugorva → 50%.
    for (let block = 0; block < 10; block += 1) {
      emit(tracker.record, block * 10, block * 10 + 5)
    }
    expect(tracker.watchedSeconds()).toBeCloseTo(50, 6)
    expect(tracker.isComplete()).toBe(false)
  })

  it('a beállítható folytonossági küszöb érvényesül', () => {
    const tracker = createWatchTracker(100, { maxContinuityGapSec: 10 })
    tracker.record(0)
    tracker.record(8)
    expect(tracker.intervals()).toEqual([{ start: 0, end: 8 }])
  })
})

describe('createWatchTracker — oda-vissza tekerés és újranézés', () => {
  it('a visszatekerés utáni újranézés NEM duplázza az arányt', () => {
    const tracker = createWatchTracker(100)
    emit(tracker.record, 0, 50)
    // Vissza a 0-ra és újra végig a feléig.
    emit(tracker.record, 0, 50)
    expect(tracker.watchedSeconds()).toBe(50)
    expect(tracker.coverage()).toBeCloseTo(0.5, 10)
    expect(tracker.intervals()).toEqual([{ start: 0, end: 50 }])
  })

  it('a visszatekerés utáni FOLYTATÁS a hiányzó részt is lefedi', () => {
    const tracker = createWatchTracker(100)
    emit(tracker.record, 0, 60)
    emit(tracker.record, 30, 100)
    expect(tracker.watchedSeconds()).toBe(100)
    expect(tracker.isComplete()).toBe(true)
    expect(tracker.intervals()).toEqual([{ start: 0, end: 100 }])
  })

  it('az időbélyeg apró visszaremegése nem darabolja fel az intervallumot', () => {
    const tracker = createWatchTracker(100)
    tracker.record(10)
    tracker.record(10.5)
    tracker.record(10.25)
    tracker.record(11)
    expect(tracker.intervals()).toEqual([{ start: 10, end: 11 }])
  })

  it('nagy visszatekerés ÚJ intervallumot nyit, az arány nem nő tőle', () => {
    const tracker = createWatchTracker(100)
    emit(tracker.record, 80, 100)
    emit(tracker.record, 0, 20)
    expect(tracker.watchedSeconds()).toBe(40)
    expect(tracker.intervals()).toEqual([
      { start: 0, end: 20 },
      { start: 80, end: 100 },
    ])
  })
})

describe('createWatchTracker — határesetek', () => {
  it('ismeretlen hossz mellett sosem jelez készet', () => {
    const tracker = createWatchTracker(null)
    emit(tracker.record, 0, 100)
    expect(tracker.durationSec()).toBeNull()
    expect(tracker.coverage()).toBe(0)
    expect(tracker.watchedSeconds()).toBe(0)
    expect(tracker.isComplete()).toBe(false)
  })

  it('0, negatív és NaN hossz ugyanígy nem jelez készet', () => {
    for (const duration of [0, -100, Number.NaN]) {
      const tracker = createWatchTracker(duration)
      emit(tracker.record, 0, 100)
      expect(tracker.coverage()).toBe(0)
      expect(tracker.isComplete()).toBe(false)
    }
  })

  it('a hossz utólagos megadása visszamenőleg értelmet ad a rögzített szakaszoknak', () => {
    const tracker = createWatchTracker(null)
    emit(tracker.record, 0, 95)
    expect(tracker.isComplete()).toBe(false)
    tracker.setDuration(100)
    expect(tracker.durationSec()).toBe(100)
    expect(tracker.coverage()).toBeCloseTo(0.95, 10)
    expect(tracker.isComplete()).toBe(true)
  })

  it('a hossz visszavétele (null) újra letiltja a készre jelölést', () => {
    const tracker = createWatchTracker(100)
    emit(tracker.record, 0, 100)
    expect(tracker.isComplete()).toBe(true)
    tracker.setDuration(null)
    expect(tracker.isComplete()).toBe(false)
  })

  it('NaN, végtelen és negatív időpontot csendben eldob', () => {
    const tracker = createWatchTracker(100)
    tracker.record(Number.NaN)
    tracker.record(Number.POSITIVE_INFINITY)
    tracker.record(-5)
    expect(tracker.intervals()).toEqual([])
    expect(tracker.coverage()).toBe(0)

    // A hibás értékek után az első ÉRVÉNYES időpont nyitja az intervallumot.
    tracker.record(10)
    expect(tracker.intervals()).toEqual([{ start: 10, end: 10 }])
  })

  it('a hibás időpont nem szakítja meg a folytonosságot', () => {
    const tracker = createWatchTracker(100)
    tracker.record(10)
    tracker.record(Number.NaN)
    tracker.record(10.5)
    expect(tracker.intervals()).toEqual([{ start: 10, end: 10.5 }])
  })

  it('a hossznál nagyobb időpont nem visz 1 fölé', () => {
    const tracker = createWatchTracker(10)
    emit(tracker.record, 0, 10)
    tracker.record(11)
    tracker.record(12)
    expect(tracker.coverage()).toBe(1)
    expect(tracker.watchedSeconds()).toBe(10)
  })

  it('egyetlen időpont rögzítése 0 hosszú szakasz, arány gyakorlatilag 0', () => {
    const tracker = createWatchTracker(100)
    tracker.record(42)
    expect(tracker.watchedSeconds()).toBe(0)
    expect(tracker.coverage()).toBe(0)
    expect(tracker.isComplete()).toBe(false)
  })

  it('reset() teljesen nulláz, a hosszt viszont megtartja', () => {
    const tracker = createWatchTracker(100)
    emit(tracker.record, 0, 100)
    expect(tracker.isComplete()).toBe(true)
    tracker.reset()
    expect(tracker.intervals()).toEqual([])
    expect(tracker.coverage()).toBe(0)
    expect(tracker.isComplete()).toBe(false)
    expect(tracker.durationSec()).toBe(100)
  })

  it('az intervals() pillanatkép, a további rögzítés nem írja át', () => {
    const tracker = createWatchTracker(100)
    emit(tracker.record, 0, 10)
    const snapshot = tracker.intervals()
    emit(tracker.record, 10, 20)
    expect(snapshot).toEqual([{ start: 0, end: 10 }])
  })

  it('egyedi küszöb (pl. 0,5) érvényesül', () => {
    const tracker = createWatchTracker(100, { completionRatio: 0.5 })
    emit(tracker.record, 0, 50)
    expect(tracker.isComplete()).toBe(true)
  })
})

/**
 * A fix, 2 másodperces küszöb egy FELTEVÉS volt a Bunny lejátszójáról: hogy a
 * `timeupdate` sűrűbben érkezik ennél. A Bunny dokumentációja az esemény
 * ALAKJÁT rögzíti, a gyakoriságát nem. Ha a lejátszó ritkábban tüzelne, a fix
 * küszöb mellett minden lépés „tekerésnek" minősülne, az arány tartósan 0
 * maradna, és a lecke SOHA nem jelölődne készre magától — hibaüzenet nélkül.
 */
describe('createWatchTracker — adaptív folytonossági küszöb', () => {
  it('RITKA (5 mp-enkénti) timeupdate mellett is végigméri a videót', () => {
    const tracker = createWatchTracker(100)
    // A lejátszó 5 másodpercenként tüzel — a régi, fix 2 mp-es küszöbnél EZ
    // volt a néma bukás: minden lépés tekerésnek látszott.
    for (let seconds = 0; seconds <= 100; seconds += 5) {
      tracker.record(seconds)
    }
    expect(tracker.coverage()).toBeCloseTo(1, 6)
    expect(tracker.isComplete()).toBe(true)
  })

  it('a régi, FIX küszöb ugyanezen az adaton 0-t adna (a hiba reprodukciója)', () => {
    const fix = createWatchTracker(100, { adaptiveGap: false })
    for (let seconds = 0; seconds <= 100; seconds += 5) {
      fix.record(seconds)
    }
    // Minden minta önálló, nulla hosszú pont → semmi nem számít megnézettnek.
    expect(fix.watchedSeconds()).toBe(0)
    expect(fix.isComplete()).toBe(false)
  })

  it('a videó ELEJE sem vész el a tanulás alatt (visszamenőleges feldolgozás)', () => {
    const tracker = createWatchTracker(100)
    for (let seconds = 0; seconds <= 40; seconds += 5) {
      tracker.record(seconds)
    }
    // A legelső mintától kezdve minden benne van, nem csak a bemelegítés után.
    expect(tracker.intervals()).toEqual([{ start: 0, end: 40 }])
  })

  it('a megtanult küszöb a lépésköz 1,5-szerese, az alap alá SOHA nem megy', () => {
    const suru = createWatchTracker(100)
    for (let seconds = 0; seconds <= 5; seconds += 0.25) {
      suru.record(seconds)
    }
    // 0,25 × 1,5 = 0,375 — de az alsó korlát 2, tehát az marad.
    expect(suru.continuityGapSec()).toBe(DEFAULT_MAX_CONTINUITY_GAP_SEC)

    const ritka = createWatchTracker(100)
    for (let seconds = 0; seconds <= 60; seconds += 4) {
      ritka.record(seconds)
    }
    expect(ritka.continuityGapSec()).toBeCloseTo(6, 6)
  })

  it('a küszöb SOHA nem lépi túl a felső korlátot (a szkippelés-védelem marad)', () => {
    const tracker = createWatchTracker(1000)
    // Szélsőségesen ritka minta: 25 másodpercenként.
    for (let seconds = 0; seconds <= 500; seconds += 25) {
      tracker.record(seconds)
    }
    expect(tracker.continuityGapSec()).toBe(MAX_ADAPTIVE_GAP_SEC)
  })

  it('RITKA mintavétel mellett is megbukik a csúszka végére rántása', () => {
    const tracker = createWatchTracker(600)
    // Nézés 5 mp-es ütemben az első percben…
    for (let seconds = 0; seconds <= 60; seconds += 5) {
      tracker.record(seconds)
    }
    // …majd rántás a videó végére.
    tracker.record(595)
    tracker.record(600)
    expect(tracker.coverage()).toBeLessThan(0.2)
    expect(tracker.isComplete()).toBe(false)
  })

  it('a NAGY tekerés a tanulást sem torzítja (kimarad a mintából)', () => {
    const tracker = createWatchTracker(1000)
    for (let seconds = 0; seconds <= 30; seconds += 3) {
      tracker.record(seconds)
    }
    const kuszobTekeresElott = tracker.continuityGapSec()

    // Óriási ugrás — ez nem lépésköz, tehát nem taníthat.
    tracker.record(900)
    tracker.record(903)
    expect(tracker.continuityGapSec()).toBeCloseTo(kuszobTekeresElott, 6)
  })

  it('a lassulás/gyorsulás követhető: a küszöb az ÚJ ütemhez igazodik', () => {
    const tracker = createWatchTracker(600)
    for (let seconds = 0; seconds <= 30; seconds += 1) {
      tracker.record(seconds)
    }
    expect(tracker.continuityGapSec()).toBe(DEFAULT_MAX_CONTINUITY_GAP_SEC)
    expect(tracker.intervals()).toEqual([{ start: 0, end: 30 }])

    // A lejátszó menet közben ritkábbra vált (pl. háttérfülre került a lap).
    for (let seconds = 36; seconds <= 240; seconds += 6) {
      tracker.record(seconds)
    }
    expect(tracker.continuityGapSec()).toBeCloseTo(9, 6)

    // Az ÁTÁLLÁS néhány lépésbe kerül: amíg a medián át nem billen, a nagyobb
    // lépések tekerésnek látszanak. Ez KORLÁTOS (legfeljebb fél tanulóablak),
    // és utána a mérés hiánytalan — a lecke vége egyetlen, folytonos szakasz.
    const utolso = tracker.intervals().at(-1)
    expect(utolso?.end).toBe(240)
    expect((utolso?.end ?? 0) - (utolso?.start ?? 0)).toBeGreaterThanOrEqual(120)
    // Az átállás vesztesége az egész leckéhez képest is kicsi marad.
    expect(tracker.watchedSeconds()).toBeGreaterThan(180)
  })

  it('a reset a MEGTANULT küszöböt is nullázza (nem szivárog át a következő leckére)', () => {
    const tracker = createWatchTracker(600)
    for (let seconds = 0; seconds <= 60; seconds += 5) {
      tracker.record(seconds)
    }
    expect(tracker.continuityGapSec()).toBeGreaterThan(DEFAULT_MAX_CONTINUITY_GAP_SEC)

    tracker.reset()
    expect(tracker.continuityGapSec()).toBe(DEFAULT_MAX_CONTINUITY_GAP_SEC)
    expect(tracker.intervals()).toEqual([])
  })

  it('az adaptiveGap: false SZIGORÚAN a megadott küszöbhöz ragaszkodik', () => {
    const tracker = createWatchTracker(100, { maxContinuityGapSec: 3, adaptiveGap: false })
    for (let seconds = 0; seconds <= 50; seconds += 5) {
      tracker.record(seconds)
    }
    expect(tracker.continuityGapSec()).toBe(3)
    expect(tracker.watchedSeconds()).toBe(0)
  })

  it('KEVÉS minta (1-2 lépésköz) még nem tanít — a küszöb az alap marad', () => {
    const tracker = createWatchTracker(100)
    tracker.record(0)
    tracker.record(8)
    expect(tracker.continuityGapSec()).toBe(DEFAULT_MAX_CONTINUITY_GAP_SEC)
    expect(tracker.intervals()).toEqual([
      { start: 0, end: 0 },
      { start: 8, end: 8 },
    ])
  })
})

/**
 * A követőt a lejátszó MINDEN eseménynél lekérdezi (useWatchTracking: record →
 * coverage → jelentés). Egy korábbi változatban ez a lekérdezés véglegesítette
 * a bemelegítési puffert, és így pont a tanulást nyírta ki — a hiba a
 * modulteszteken nem, csak a hívási minta reprodukálásával látszik.
 */
describe('createWatchTracker — a lejátszó valódi hívási mintája', () => {
  it('a MINDEN lépés utáni lekérdezés NEM rontja el a tanulást', () => {
    const tracker = createWatchTracker(100)
    const aranyok: number[] = []
    for (let seconds = 0; seconds <= 100; seconds += 5) {
      tracker.setDuration(100)
      tracker.record(seconds)
      // Pontosan ezt teszi a lejátszó: minden eseménynél lekérdez.
      aranyok.push(tracker.coverage())
    }
    expect(tracker.coverage()).toBeCloseTo(1, 6)
    expect(tracker.isComplete()).toBe(true)
    // Az arány monoton nő — a vevő nem lát visszaeső százalékot.
    for (let index = 1; index < aranyok.length; index += 1) {
      expect(aranyok[index]).toBeGreaterThanOrEqual(aranyok[index - 1])
    }
  })

  it('bemelegítés közben is ÉRTELMES arányt ad (nem 0-ról ugrik)', () => {
    const tracker = createWatchTracker(100)
    tracker.record(0)
    tracker.record(5)
    tracker.record(10)
    tracker.record(15)
    // Négy minta, három lépésköz → a becslés már él, még véglegesítés előtt.
    expect(tracker.coverage()).toBeCloseTo(0.15, 6)
  })
})

/**
 * A code review bizonyította (reprodukcióval): a küszöb-tanulás pusztán a
 * média-időbélyegekből kijátszható volt — kitartó, egyenletes ugrásokkal a
 * medián felhúzható a 15 mp-es felső korlátig, onnantól a tekerés „folyamatos
 * lejátszásnak" számított, és a videó a tényleges megnézése nélkül is késznek
 * jelölődött. A falióra a becsületes döntő: valódi lejátszásnál a média-idő nem
 */
describe('createWatchTracker — falióra-szabály (a tanulás nem játszható ki)', () => {
  it('a GYORS tekerés-sorozat falióra mellett NEM kap lefedettséget', () => {
    const tracker = createWatchTracker(600)
    // A támadó 200 ms-onként ugrik 14 másodpercet — a régi kód ebből tanulta
    // meg a 15 mp-es küszöböt, és teljes lefedettséget adott.
    let wall = 0
    for (let seconds = 0; seconds <= 600; seconds += 14) {
      tracker.record(seconds, wall)
      wall += 200
    }
    expect(tracker.coverage()).toBeLessThan(0.05)
    expect(tracker.isComplete()).toBe(false)
    // A tekerés-delta a tanulásba sem számít: a küszöb az alapon marad.
    expect(tracker.continuityGapSec()).toBe(DEFAULT_MAX_CONTINUITY_GAP_SEC)
  })

  it('a LASSÚ, valós idejű lejátszás falióra mellett változatlanul mér', () => {
    const tracker = createWatchTracker(100)
    // 5 mp médialépés 5000 ms falióránként = pontosan 1× sebesség.
    let wall = 0
    for (let seconds = 0; seconds <= 100; seconds += 5) {
      tracker.record(seconds, wall)
      wall += 5000
    }
    expect(tracker.coverage()).toBeCloseTo(1, 6)
    expect(tracker.isComplete()).toBe(true)
  })

  it('a 2×-es sebességű nézés NEM bukik el a falióra-szabályon', () => {
    const tracker = createWatchTracker(100)
    // 2 mp média / 1000 ms fal = 2× — a megengedett 2,5-ös plafonon belül.
    let wall = 0
    for (let seconds = 0; seconds <= 100; seconds += 2) {
      tracker.record(seconds, wall)
      wall += 1000
    }
    expect(tracker.isComplete()).toBe(true)
  })

  it('falióra NÉLKÜL a viselkedés a korábbi marad (régi hívók, tesztek)', () => {
    const tracker = createWatchTracker(100)
    for (let seconds = 0; seconds <= 100; seconds += 5) {
      tracker.record(seconds)
    }
    expect(tracker.isComplete()).toBe(true)
  })

  it('a BEMELEGÍTÉS alatt érkező tekerés-sorozat sem tanít és nem is fed', () => {
    const tracker = createWatchTracker(600)
    // Már az első hat minta is rángatás: a warmup-tanulásnak is szűrnie kell.
    let wall = 0
    for (let index = 0; index < 6; index += 1) {
      tracker.record(index * 20, wall)
      wall += 100
    }
    expect(tracker.continuityGapSec()).toBe(DEFAULT_MAX_CONTINUITY_GAP_SEC)
    expect(tracker.watchedSeconds()).toBe(0)
  })

  it('a visszafelé járó falióra nem büntet (hibás mérés nem vehet el jogos időt)', () => {
    const tracker = createWatchTracker(100)
    const orak = [0, 1000, 500, 1500, 2500, 3500, 4500, 5500]
    for (let index = 0; index < orak.length; index += 1) {
      tracker.record(index, orak[index])
    }
    expect(tracker.intervals()).toEqual([{ start: 0, end: orak.length - 1 }])
  })

  it('a reset a falióra-állapotot is nullázza', () => {
    const tracker = createWatchTracker(100)
    tracker.record(0, 0)
    tracker.record(1, 500)
    tracker.reset()
    // Új lecke: az előző falióra nem szivároghat át — az első minta után nagy
    // média-ugrás jön, de előzmény nélkül nincs mihez mérni.
    tracker.record(50, 600)
    expect(tracker.intervals()).toEqual([{ start: 50, end: 50 }])
  })
})
