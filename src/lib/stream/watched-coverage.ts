/**
 * Megnézett-arány számítás — tiszta, DOM- és hálózat-mentes modul.
 *
 * Hibrid haladás: automatikus kész ≥90% tényleges lejátszás; kézi jelölés megmarad.
 * Megnézett intervallumok (nem max currentTime); adaptív folytonossági küszöb.
 * Teszt: watched-coverage.test.ts
 */

/** Egy megnézett szakasz másodpercben, a videó időtengelyén. */
export interface WatchInterval {
  readonly start: number
  readonly end: number
}

/**
 * A készre jelölés küszöbe: a videó 90%-a.
 *
 * A maradék 10% szándékos ráhagyás — a legtöbb leckevideó végén stáblista,
 * elköszönés vagy csend van, amit a néző jogosan hagy ki. Ha 100%-ot várnánk,
 * gyakorlatilag SOHA nem jelölődne készre semmi.
 */
export const WATCHED_COMPLETION_RATIO = 0.9

/**
 * Ekkora ugrásig számít folyamatosnak a lejátszás (másodperc). Efölött
 * tekerésnek minősül, és új intervallum kezdődik.
 *
 * Ez ALSÓ KORLÁT: a követő ennél megengedőbb lehet, ha a lejátszó ritkábban
 * küld `timeupdate`-et (lásd a fejkomment „adaptív küszöb" szakaszát).
 */
export const DEFAULT_MAX_CONTINUITY_GAP_SEC = 2

/**
 * A megtanult lépésköz ennyiszerese számít még folyamatosnak.
 *
 * 1,5 azért jó: a lejátszók ütemezése ingadozik (egy-egy esemény késhet), de
 * egy VALÓDI tekerés jellemzően nagyságrenddel nagyobbat ugrik ennél, tehát a
 * szkippelés-ellenes védelem érintetlen marad.
 */
export const ADAPTIVE_GAP_FACTOR = 1.5

/**
 * A megtanult küszöb SOHA nem lehet ennél nagyobb.
 *
 * Enélkül egy sűrű tekerés-sorozat fölhúzhatná a küszöböt odáig, hogy a
 * csúszka-rángatás is „folyamatos lejátszásnak" számítson — vagyis pont a
 * kijátszás elleni fő védelem ürülne ki.
 */
export const MAX_ADAPTIVE_GAP_SEC = 15

/**
 * Ekkora ugrás fölött a különbség biztosan NEM lejátszási lépésköz, ezért a
 * tanulásba sem számít bele (a medián így nem torzul a nagy tekerésektől).
 */
export const ADAPTIVE_SAMPLE_CAP_SEC = 30

/**
 * Max lejátszási sebesség a faliórához képest (2,5×) — gyorsabb ugrás tekerés, nem tanulás.
 */
export const MAX_PLAYBACK_RATE = 2.5

/**
 * Ráhagyás a falióra-szabályhoz másodpercben — az esemény-ütemezés és az
 * időbélyeg-kerekítés ingadozását fedi, hogy a jogos lejátszás sose bukjon el
 * rajta.
 */
export const WALL_CLOCK_SLACK_SEC = 1.5

/**
 * Ennyi időpontot pufferelünk, mielőtt az első küszöböt kiszámítjuk. Öt
 * különbség már elég stabil mediánt ad, és ennyi minta még a leglassabb
 * ütemezésnél is pár másodperc alatt összejön.
 */
export const ADAPTIVE_WARMUP_SAMPLES = 6

/**
 * Ennyi legutóbbi lépésközből számoljuk a mediánt.
 *
 * Az ablak mérete kompromisszum: nagyobb ablak stabilabb mediánt ad, de lassabban
 * követi a lejátszó ütemének VÁLTOZÁSÁT (pl. háttérfülre váltás), és az átállás
 * ideje alatt a lépések tekerésnek látszanak. Nyolc minta még robusztus a
 * kilógó értékekre, és az átállás is néhány lépés alatt megtörténik.
 */
const ADAPTIVE_WINDOW = 8

/**
 * Lebegőpontos tűrés a küszöb-összehasonlításhoz.
 *
 * A 90% pontos elérése VALÓDI határeset (pl. 100 másodperces videóból pontosan
 * 90 megnézve), és a másodpercek összeadása közben felgyülemlő ábrázolási hiba
 * miatt az eredmény lehet 0.8999999999999999. Enélkül a tűrés nélkül a néző a
 * küszöb elérése után sem kapná meg a jelölést — pontosan azt a bizalmat
 * rombolva, amiért az automatika készült.
 */
const COMPLETION_EPSILON = 1e-9

/** Pozitív, véges hossz másodpercben; minden más (0, NaN, negatív, nem szám) → null. */
function normalizeDurationSec(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/**
 * Intervallumok összefésülése: rendezés kezdet szerint, majd az érintkező vagy
 * átfedő szakaszok egyesítése.
 *
 * A hibás alakú elemeket (NaN, végtelen, fordított irányú szakasz) csendben
 * eldobja — a bemenet a lejátszóból származik, tehát nem megbízható.
 * A nulla hosszú (pont-) intervallumok BENNMARADNAK: az arányhoz 0-val
 * járulnak hozzá, de megőrzik a „hol járt a néző" információt.
 */
export function mergeWatchIntervals(intervals: readonly WatchInterval[]): WatchInterval[] {
  const usable = intervals.filter(
    (interval) =>
      Number.isFinite(interval.start) &&
      Number.isFinite(interval.end) &&
      interval.end >= interval.start,
  )
  const sorted = [...usable].sort((left, right) => left.start - right.start)

  const merged: WatchInterval[] = []
  for (const current of sorted) {
    const last = merged[merged.length - 1]
    if (last !== undefined && current.start <= last.end) {
      if (current.end > last.end) {
        merged[merged.length - 1] = { start: last.start, end: current.end }
      }
      continue
    }
    merged.push({ start: current.start, end: current.end })
  }
  return merged
}

/**
 * Az intervallumok által lefedett EGYEDI másodpercek száma, a `[0, durationSec]`
 * tartományra vágva. Ismeretlen hossznál 0.
 */
export function watchedSecondsOf(
  intervals: readonly WatchInterval[],
  durationSec: number | null | undefined,
): number {
  const duration = normalizeDurationSec(durationSec)
  if (duration === null) {
    return 0
  }
  let total = 0
  for (const interval of mergeWatchIntervals(intervals)) {
    const start = Math.min(Math.max(interval.start, 0), duration)
    const end = Math.min(Math.max(interval.end, 0), duration)
    if (end > start) {
      total += end - start
    }
  }
  return total
}

/**
 * A megnézett arány 0 és 1 között. Ismeretlen/0 hossznál 0 — sosem NaN, mert az
 * hívási helyenként másképp viselkedne (`NaN >= 0.9` hamis, de `NaN.toFixed()`
 * „NaN"-t ír a felületre).
 */
export function watchedRatio(
  intervals: readonly WatchInterval[],
  durationSec: number | null | undefined,
): number {
  const duration = normalizeDurationSec(durationSec)
  if (duration === null) {
    return 0
  }
  return Math.min(watchedSecondsOf(intervals, duration) / duration, 1)
}

/** Elérte-e az arány a küszöböt (lebegőpontos tűréssel). */
export function isWatchedComplete(
  ratio: number,
  completionRatio: number = WATCHED_COMPLETION_RATIO,
): boolean {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return false
  }
  return ratio + COMPLETION_EPSILON >= completionRatio
}

export interface WatchTrackerOptions {
  /**
   * A folytonossági küszöb ALSÓ korlátja másodpercben. Alapértelmezés: 2.
   * A követő ennél megengedőbb lehet, ha a lejátszó ritkábban küld eseményt.
   */
  maxContinuityGapSec?: number
  /** A készre jelölés küszöbe 0 és 1 között. Alapértelmezés: 0,9. */
  completionRatio?: number
  /**
   * Kikapcsolja a küszöb menet közbeni tanulását. Csak akkor kell, ha a hívó
   * SZIGORÚAN a megadott küszöbhöz akar ragaszkodni (pl. célzott teszt).
   */
  adaptiveGap?: boolean
}

export interface WatchTracker {
  /**
   * Egy `timeupdate` időpont rögzítése. Érvénytelen értéket csendben eldob.
   *
   * @param wallClockMs a rögzítés FALIÓRA-időbélyege (pl. `performance.now()`).
   *   Ha a hívó megadja, a követő érvényesíti a falióra-szabályt: a valós
   *   időnél gyorsabb média-előrehaladás tekerésnek számít, a megtanult
   *   küszöbtől függetlenül. Nélküle a viselkedés tisztán média-idő alapú.
   */
  record(seconds: number, wallClockMs?: number): void
  /**
   * A videó hosszának (utólagos) beállítása. A lejátszó gyakran csak a `ready`
   * vagy az első `timeupdate` esemény után tudja a hosszt, ezért a követő
   * hossz nélkül is elindítható.
   */
  setDuration(durationSec: number | null | undefined): void
  /** Az ismert hossz, vagy null. */
  durationSec(): number | null
  /** A megnézett szakaszok összefésült, csak olvasható pillanatképe. */
  intervals(): WatchInterval[]
  /** A megnézett EGYEDI másodpercek száma (a hosszra vágva). */
  watchedSeconds(): number
  /** A megnézett arány 0 és 1 között; ismeretlen hossznál 0. */
  coverage(): number
  /** Elérte-e a küszöböt. Ismeretlen hossznál MINDIG false. */
  isComplete(): boolean
  /**
   * A JELENLEG érvényes folytonossági küszöb másodpercben — a megtanult
   * lépésközzel együtt. Diagnosztikai célú: ezt olvasva látszik, hogy a
   * lejátszó ütemezéséhez igazodott-e a követő.
   */
  continuityGapSec(): number
  /** Teljes nullázás (pl. leckeváltásnál, hogy az előző lecke ne szivárogjon át). */
  reset(): void
}

/** Rendezett minta mediánja. Üres bemenetnél null. */
function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null
  }
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) {
    return sorted[middle]
  }
  return (sorted[middle - 1] + sorted[middle]) / 2
}

interface MutableInterval {
  start: number
  end: number
}

/** Egy rögzített minta: média-időpont + (ha ismert) falióra-időbélyeg. */
interface Minta {
  readonly s: number
  readonly w: number | null
}

/**
 * A FALIÓRA-SZABÁLY: a média-előrehaladás nem lehet gyorsabb, mint az eltelt
 * valós idő × a megengedett lejátszási sebesség (+ ráhagyás). Ami gyorsabb, az
 * tekerés — a megtanult küszöbtől FÜGGETLENÜL, és a tanulásba sem számít bele.
 *
 * Falióra-adat nélkül (régi hívók, tesztek) a szabály nem él — ilyenkor a
 * viselkedés a korábbi, tisztán média-idő alapú marad.
 */
function faliOraSzerintTekeres(mediaDelta: number, elozoW: number | null, mostaniW: number | null): boolean {
  if (elozoW === null || mostaniW === null) {
    return false
  }
  const eltEltSec = (mostaniW - elozoW) / 1000
  // Visszafelé járó vagy értelmetlen óra: nem büntetünk hibás mérés alapján.
  if (!Number.isFinite(eltEltSec) || eltEltSec < 0) {
    return false
  }
  return mediaDelta > eltEltSec * MAX_PLAYBACK_RATE + WALL_CLOCK_SLACK_SEC
}

/**
 * Minta-sorozat szakaszokra bontása egy ADOTT folytonossági küszöbbel —
 * tiszta függvény, állapot nélkül. A falióra-szabályt is érvényesíti.
 *
 * A bemelegítési puffer ÁTMENETI (nem véglegesített) kiértékeléséhez kell: a
 * lejátszó minden eseménynél lekérdezi az arányt, és ez a lekérdezés NEM
 * véglegesítheti a puffert, különben a tanulás soha nem kapna mintát.
 */
function szakaszokra(samples: readonly Minta[], gap: number): WatchInterval[] {
  const result: MutableInterval[] = []
  let open: MutableInterval | null = null
  let elozo: Minta | null = null
  for (const minta of samples) {
    if (open === null || elozo === null) {
      open = { start: minta.s, end: minta.s }
      elozo = minta
      continue
    }
    const delta = minta.s - elozo.s
    const folyamatos =
      Math.abs(delta) <= gap && !faliOraSzerintTekeres(delta, elozo.w, minta.w)
    if (folyamatos) {
      if (minta.s > open.end) {
        open.end = minta.s
      }
      if (minta.s < open.start) {
        open.start = minta.s
      }
    } else {
      result.push(open)
      open = { start: minta.s, end: minta.s }
    }
    elozo = minta
  }
  if (open !== null) {
    result.push(open)
  }
  return result
}

/**
 * A megtanult küszöb lépésköz-mintákból. `null`, ha még kevés a minta ahhoz,
 * hogy a medián értelmes legyen.
 */
function tanultKuszob(lepeskozok: readonly number[], alapKuszob: number): number | null {
  if (lepeskozok.length < 3) {
    return null
  }
  const tipikus = median(lepeskozok)
  if (tipikus === null) {
    return null
  }
  return Math.min(
    Math.max(alapKuszob, tipikus * ADAPTIVE_GAP_FACTOR),
    Math.max(alapKuszob, MAX_ADAPTIVE_GAP_SEC),
  )
}

/**
 * A minták egymást követő, ÉSSZERŰ nagyságú (tanításra alkalmas) különbségei.
 * A falióra-szabályt megbukó delta NEM taníthat: pontosan ez zárja ki, hogy a
 * tekerés-sorozat felhúzza a küszöböt (code review-találat).
 */
function tanithatoLepeskozok(samples: readonly Minta[]): number[] {
  const result: number[] = []
  for (let index = 1; index < samples.length; index += 1) {
    const delta = samples[index].s - samples[index - 1].s
    if (
      delta > 0 &&
      delta <= ADAPTIVE_SAMPLE_CAP_SEC &&
      !faliOraSzerintTekeres(delta, samples[index - 1].w, samples[index].w)
    ) {
      result.push(delta)
    }
  }
  return result
}

/**
 * Megnézett-arány követő egyetlen videóhoz.
 *
 * Használat: minden `timeupdate` eseménynél `record(seconds)`, majd
 * `isComplete()` — igaz esetén indulhat a szerver felé a készre jelölés.
 * A követő determinisztikus: nincs benne idő- vagy véletlen-függés, kizárólag
 * a kapott időpontok sorozata számít, ezért maradéktalanul tesztelhető.
 *
 * @param durationSec a videó hossza, ha már ismert
 */
export function createWatchTracker(
  durationSec?: number | null,
  options?: WatchTrackerOptions,
): WatchTracker {
  const alapKuszob =
    typeof options?.maxContinuityGapSec === 'number' &&
    Number.isFinite(options.maxContinuityGapSec) &&
    options.maxContinuityGapSec >= 0
      ? options.maxContinuityGapSec
      : DEFAULT_MAX_CONTINUITY_GAP_SEC
  const tanul = options?.adaptiveGap !== false
  const completionRatio =
    typeof options?.completionRatio === 'number' &&
    Number.isFinite(options.completionRatio) &&
    options.completionRatio > 0
      ? options.completionRatio
      : WATCHED_COMPLETION_RATIO

  let duration = normalizeDurationSec(durationSec)
  /** A már LEZÁRT szakaszok (tekerés zárja le őket). */
  let closed: MutableInterval[] = []
  /** A most bővülő szakasz — null, amíg egyetlen érvényes időpont sem érkezett. */
  let open: MutableInterval | null = null
  /** A legutóbb rögzített időpont — a folytonosság EHHEZ mérődik, nem az intervallum végéhez. */
  let cursor: number | null = null
  /** A legutóbbi minta falióra-időbélyege (ha a hívó adott). */
  let utolsoFaliOra: number | null = null

  /** A jelenleg érvényes küszöb — a tanulás ezt emelheti, az alap alá SOHA. */
  let aktualisKuszob = alapKuszob
  /** A legutóbbi, ésszerű nagyságú lépésközök (a medián alapja). */
  let lepeskozok: number[] = []
  /** A bemelegítési puffer: még nem feldolgozott, de érvényes minták. */
  let bemelegites: Minta[] = []
  /** Igaz, amint a puffer feldolgozásra került (utána közvetlenül dolgozunk). */
  let bemelegitesLezarva = !tanul

  /**
   * Egy időpont feldolgozása a JELENLEG érvényes küszöbbel.
   *
   * @param kenyszerTekeres igaz, ha a falióra-szabály már tekerésnek ítélte —
   *   ilyenkor a megtanult küszöb sem mentheti fel.
   */
  const feldolgoz = (seconds: number, kenyszerTekeres: boolean): void => {
    if (open === null || cursor === null) {
      open = { start: seconds, end: seconds }
      cursor = seconds
      return
    }

    const gap = seconds - cursor
    if (!kenyszerTekeres && Math.abs(gap) <= aktualisKuszob) {
      // Folyamatos lejátszás (vagy a lejátszó időbélyegének remegése).
      if (seconds > open.end) {
        open.end = seconds
      }
      if (seconds < open.start) {
        open.start = seconds
      }
    } else {
      // TEKERÉS: a nyitott szakasz lezárul, az átugrott rész NEM számít bele.
      closed.push(open)
      open = { start: seconds, end: seconds }
    }
    cursor = seconds
  }

  /** Egy lépésköz beszámítása a tanulásba, majd a küszöb újraszámítása. */
  const tanulLepeskozt = (delta: number): void => {
    if (!tanul || !(delta > 0) || delta > ADAPTIVE_SAMPLE_CAP_SEC) {
      return
    }
    lepeskozok.push(delta)
    if (lepeskozok.length > ADAPTIVE_WINDOW) {
      lepeskozok = lepeskozok.slice(-ADAPTIVE_WINDOW)
    }
    aktualisKuszob = tanultKuszob(lepeskozok, alapKuszob) ?? aktualisKuszob
  }

  /**
   * A bemelegítési puffer VÉGLEGESÍTÉSE: előbb megtanuljuk a lépésközt az
   * összes pufferelt mintából, és csak UTÁNA szegmentálunk — így a videó eleje
   * ugyanazzal a küszöbbel értékelődik, mint a többi része.
   *
   * Ezt KIZÁRÓLAG a `record` hívja, amikor a puffer betelt. Egy lekérdezés
   * (coverage/intervals) SOHA — a lejátszó minden eseménynél lekérdezi az
   * arányt, tehát a lekérdezés-vezérelt véglegesítés kinyírná a tanulást.
   */
  const bemelegitestLezar = (): void => {
    if (bemelegitesLezarva) {
      return
    }
    bemelegitesLezarva = true
    for (const delta of tanithatoLepeskozok(bemelegites)) {
      tanulLepeskozt(delta)
    }
    let elozo: Minta | null = null
    for (const minta of bemelegites) {
      const kenyszer =
        elozo === null ? false : faliOraSzerintTekeres(minta.s - elozo.s, elozo.w, minta.w)
      feldolgoz(minta.s, kenyszer)
      utolsoFaliOra = minta.w
      elozo = minta
    }
    bemelegites = []
  }

  /**
   * Pillanatkép a megnézett szakaszokról. Bemelegítés alatt a puffer ÁTMENETI
   * kiértékelésével — a legjobb pillanatnyi becsléssel, de véglegesítés nélkül.
   */
  const snapshot = (): WatchInterval[] => {
    if (!bemelegitesLezarva) {
      return szakaszokra(bemelegites, atmenetiKuszob())
    }
    return open === null ? [...closed] : [...closed, { start: open.start, end: open.end }]
  }

  /** A bemelegítés alatt érvényes, még nem véglegesített küszöb-becslés. */
  function atmenetiKuszob(): number {
    if (!tanul) {
      return alapKuszob
    }
    return tanultKuszob(tanithatoLepeskozok(bemelegites), alapKuszob) ?? alapKuszob
  }

  return {
    record(seconds: number, wallClockMs?: number): void {
      // A lejátszóból jövő érték nem megbízható: NaN, végtelen és negatív
      // időpont sosem kerülhet be (negatív `currentTime` nem létezik).
      if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
        return
      }
      const faliOra =
        typeof wallClockMs === 'number' && Number.isFinite(wallClockMs) ? wallClockMs : null

      if (!bemelegitesLezarva) {
        bemelegites.push({ s: seconds, w: faliOra })
        if (bemelegites.length >= ADAPTIVE_WARMUP_SAMPLES) {
          bemelegitestLezar()
        }
        return
      }

      // A falióra-szabály ELŐBB dönt, mint a megtanult küszöb: a valós időnél
      // gyorsabb média-előrehaladás tekerés, és nem is taníthat.
      const kenyszerTekeres =
        cursor !== null && faliOraSzerintTekeres(seconds - cursor, utolsoFaliOra, faliOra)
      if (cursor !== null && !kenyszerTekeres) {
        tanulLepeskozt(seconds - cursor)
      }
      feldolgoz(seconds, kenyszerTekeres)
      utolsoFaliOra = faliOra
    },

    setDuration(value: number | null | undefined): void {
      duration = normalizeDurationSec(value)
    },

    durationSec(): number | null {
      return duration
    },

    continuityGapSec(): number {
      return bemelegitesLezarva ? aktualisKuszob : atmenetiKuszob()
    },

    intervals(): WatchInterval[] {
      return mergeWatchIntervals(snapshot())
    },

    watchedSeconds(): number {
      return watchedSecondsOf(snapshot(), duration)
    },

    coverage(): number {
      return watchedRatio(snapshot(), duration)
    },

    isComplete(): boolean {
      if (duration === null) {
        return false
      }
      return isWatchedComplete(watchedRatio(snapshot(), duration), completionRatio)
    },

    reset(): void {
      closed = []
      open = null
      cursor = null
      utolsoFaliOra = null
      lepeskozok = []
      bemelegites = []
      aktualisKuszob = alapKuszob
      bemelegitesLezarva = !tanul
    },
  }
}
