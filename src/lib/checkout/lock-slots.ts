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
 * engedne, a korlát mégis a kisebb, biztonságos 2 marad, mert ugyanebből a
 * poolból él a Barion-callback és a háttér-jobok is. Egy callback csúcson 4
 * kapcsolatot fog (session-zár + rendelés-zár + ügyfél-zár + lekérdezés). Az
 * order-maintenance queue egy tickben 4 jobot futtat párhuzamosan
 * (src/jobs/index.ts `ORDER_MAINTENANCE_AUTORUN_LIMIT`: order-poll, számla,
 * stornó, helyesbítő), jobonként legfeljebb 3 kapcsolattal, ez 12.
 *
 * A legrosszabb eset így sem fér el: két nyitott pénztár (8) és egy teli
 * job-tick (12) már mind a 20 kapcsolatot fogja, a callbacknek és a
 * webhook-retry jobnak nem marad hely. Ilyenkor a kapcsolat-timeoutig (10 mp)
 * várnak, utána hibát kapnak: a még nem rögzített callbackre 500 megy, amit a
 * Barion újraküld, a rögzített esemény feldolgozását pedig a webhook-retry
 * pótolja. Ez csak akkor áll elő, ha a pénztári forgalom job-torlódással esik
 * egybe (például egy Számlázz.hu-kimaradás utáni pótláskor): késleltet, de
 * adatot nem veszít. Négy pénztárhellyel (16) már egy fél job-tick (6) mellett
 * is kifogyna a pool. Hogy a job-limitet 2-re csökkentsük (akkor a csúcs
 * 8 + 6 = 14, és 6 kapcsolat marad), vagy a poolt növeljük, nyitott döntés
 * (w1 integráció, követő feladat).
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
