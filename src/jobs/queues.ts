/**
 * Queue-nevek és cron egy helyen: az autoRun csak futtat, a schedule sorba
 * állít, és a handleSchedules csak azonos queue-névre fut. A két cron ezért
 * ugyanabból a konstansból jön.
 */
const QUEUE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/

export function assertQueueName(name: string): string {
  if (!QUEUE_NAME_PATTERN.test(name)) {
    throw new Error(`Érvénytelen job-queue név: "${name}" (megengedett: ${QUEUE_NAME_PATTERN})`)
  }
  return name
}

export const WEBHOOK_RETRY_QUEUE = assertQueueName('webhook-maintenance')

/**
 * Rendelés-életciklus queue (W4): az esemény-vezérelt Számlázz.hu-jobok
 * (invoice-issue, storno-issue, corrective-invoice-issue) ide kerülnek — a
 * webhook-retry-tól elkülönítve, hogy a callback-újrapróbálások ne keveredjenek
 * a rendelés-karbantartással. A queue-név a payload-jobs táblában is megjelenik.
 * Az order-poll nem ide tartozik, hanem a saját ORDER_POLL_QUEUE-jába.
 */
export const ORDER_MAINTENANCE_QUEUE = assertQueueName('order-maintenance')

/**
 * Az order-poll SAJÁT queue-ja (hibavadász C, PR #307).
 *
 * MIÉRT KÜLÖN: a Payload runJobs a futtatható jobokból `limit` darabot vesz
 * fel, `createdAt` szerint növekvő sorrendben (payload-jobs defaultSort nélkül,
 * `processingOrder` nélkül). A Számlázz.hu-jobok újrapróbáláskor megtartják a
 * régi createdAt-jüket, és várakoztatás nélkül a következő tickben újra
 * felvehetők. Amíg az order-poll velük egy queue-ban volt, egy Számlázz.hu-
 * kimaradás alatt ők töltötték ki a tick minden helyét, a mindig frissebb
 * order-poll pedig 20–40 percig sem futott: nem volt elveszett-callback-pótlás,
 * számla-resweep, napi összesítő, és az életjel kimaradása hamis „a jobok
 * leálltak” riasztást adott. A saját queue-ban a poll minden tickben lefut,
 * akármekkora a számlázási torlódás.
 */
export const ORDER_POLL_QUEUE = assertQueueName('order-poll')

/**
 * webhook-maintenance ritmus: PERCENKÉNT.
 *
 * Indoklás: az elhasalt Barion-callback újrapróbálása a fizetés lezárásának
 * leggyorsabb útja, a task pedig olcsó (egyetlen indexelt `webhook-events`
 * lekérdezés, max. 25 sor), és a saját exponenciális backoffja (isRetryDue)
 * amúgy is visszafogja a tényleges újrahívásokat. Percnél sűrűbb nem lehet: a
 * Payload autoRun-cronja a legkisebb egységként a percet kezeli.
 */
export const WEBHOOK_RETRY_CRON = '* * * * *'

/**
 * order-poll és order-maintenance ritmus: 5 PERCENKÉNT.
 *
 * Indoklás: az order-poll KIMENŐ Barion-hívásokat végez (GetState, max. 25
 * függő rendelésre futásonként), ezért nem szabad percenként futnia — 5 perc a
 * józan kompromisszum az elveszett callback pótlásának késleltetése (max. ~5
 * perc, a vevő addig „feldolgozás alatt" állapotot lát) és a szolgáltatói
 * terhelés között. A Barion PaymentWindow 30 perc, tehát 5 perc bőven belefér a
 * fizetés életciklusába. Ugyanez a ritmus hajtja az order-maintenance queue-t,
 * amely az invoice-issue / storno-issue / corrective-invoice-issue jobokat
 * viszi: ezeket ESEMÉNY állítja sorba, és az 5 perces autoRun-tickeken futnak
 * le, a `schedule` rájuk nem vonatkozik.
 */
export const ORDER_MAINTENANCE_CRON = '*/5 * * * *'
