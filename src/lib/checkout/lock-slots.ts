/**
 * A pénztár kritikus szakaszainak folyamaton belüli korlátja (a-checkout-4).
 *
 * MIÉRT: a `withAdvisoryLock` a zár idejére lefoglal egy pool-kapcsolatot (a
 * zár tranzakciója tétlenül vár), a védett szakasz lekérdezései pedig további
 * kapcsolatokat kérnek ugyanabból a poolból (find, a create saját
 * tranzakciója, a feltételes státuszírás beágyazott zára). A pool alapból
 * 10 kapcsolatos (pg), tehát tíz egyidejű pénztár mind a tíz kapcsolatot a
 * zárakra fogta, és a védett szakaszok első lekérdezése a kapcsolat-timeoutig
 * (10 mp) várt, majd elbukott; közben a replika minden más DB-hívása
 * (Barion-callback, admin) is állt. Ez egyetlen IP tíz párhuzamos kérésével
 * kiváltható volt.
 *
 * A megoldás: egy folyamatban egyszerre legfeljebb `CHECKOUT_LOCK_MAX_CONCURRENT`
 * pénztár-zár lehet nyitva, a többi a zár ELŐTT, kapcsolat nélkül vár a sorára.
 * Egy nyitott szakasz legrosszabb esetben négy kapcsolatot fog (zár + beágyazott
 * státuszzár + a Payload-írás tranzakciója + egy lekérdezés), így kettő
 * legfeljebb nyolcat, és a poolban mindig marad hely a callbacknek és az
 * adminnak. A szakasz jellemzően néhány tíz ezredmásodperc (Barion-hívás a
 * zárban már nincs), tehát a sor másodpercenként több tucat pénztárat enged át.
 *
 * A korlát folyamatonként érvényes, mert a pool is az. A sorban állás felső
 * határa `CHECKOUT_LOCK_SLOT_WAIT_MS`: ennél tovább egy vevő sem várhat
 * válasz nélkül, ilyenkor a hívó 503-at ad („próbáld újra").
 *
 * A pool azóta kifejezetten 20 kapcsolatos (src/payload.config.ts `pool.max`,
 * w1-barion-platform). A „(pool.max − 2) / 4” ökölszabály így 4 helyet is
 * engedne, a korlát mégis a kisebb, biztonságos 2 marad: ugyanebből a poolból
 * él a Barion-callback is, amely csúcson kérésenként 4 kapcsolatot fog
 * (session-zár + rendelés-zár + ügyfél-zár + lekérdezés), és a számla-job is
 * 2–3-at. Két nyitott pénztár (8) mellett két egyidejű callback (8) és egy
 * számla-job (3) még elfér a 20-ban; négy pénztár (16) mellett már egyetlen
 * callback is kimerítené a poolt, és a fizetések visszaigazolása állna.
 */

export const CHECKOUT_LOCK_MAX_CONCURRENT = 2
export const CHECKOUT_LOCK_SLOT_WAIT_MS = 15_000

/** A sorban állás túllépte a felső határt; a hívó 503-at ad. */
export class CheckoutLockBusyError extends Error {
  constructor(waitedMs: number) {
    super(`A pénztár-zárra várakozás ${waitedMs} ms után feladva (túlterhelés).`)
    this.name = 'CheckoutLockBusyError'
  }
}

interface Waiter {
  resolve: () => void
  timer: ReturnType<typeof setTimeout>
}

let active = 0
const queue: Waiter[] = []

function acquire(waitMs: number): Promise<void> {
  if (active < CHECKOUT_LOCK_MAX_CONCURRENT) {
    active += 1
    return Promise.resolve()
  }
  return new Promise<void>((resolve, reject) => {
    const waiter: Waiter = {
      resolve: () => {
        clearTimeout(waiter.timer)
        resolve()
      },
      timer: setTimeout(() => {
        const index = queue.indexOf(waiter)
        if (index >= 0) {
          queue.splice(index, 1)
        }
        reject(new CheckoutLockBusyError(waitMs))
      }, waitMs),
    }
    queue.push(waiter)
  })
}

function release(): void {
  const next = queue.shift()
  if (next) {
    // A hely közvetlenül a következőé: az `active` nem csökken, így közben
    // érkező új kérés nem előzheti meg a sorban állót.
    next.resolve()
    return
  }
  active -= 1
}

/**
 * A `fn` futtatása egy szabad pénztár-helyen. A hely a `fn` végén (hibánál
 * is) felszabadul. A zárat a `fn` veszi fel, tehát a várakozó kérés nem fog
 * adatbázis-kapcsolatot.
 */
export async function withCheckoutLockSlot<T>(
  fn: () => Promise<T>,
  waitMs: number = CHECKOUT_LOCK_SLOT_WAIT_MS,
): Promise<T> {
  await acquire(waitMs)
  try {
    return await fn()
  } finally {
    release()
  }
}
