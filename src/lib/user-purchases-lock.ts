import type { Payload } from 'payload'

import { withAdvisoryLock } from './advisory-lock'
import { logger as rootLogger, type Logger } from './logger'

/**
 * User-szintű advisory-zár a purchases RMW-hez (lost update ellen).
 * Zár-sorrend: order → email → user. A `fn` csak újraolvasás + írás; külső HTTP tilos.
 */

/** Egy vevő purchases-RMW-jének advisory-zár kulcsa. */
export function userPurchasesLockKey(userId: number | string): string {
  return `purchases:user:${userId}`
}

/**
 * A `fn` futtatása a vevő purchases-zára alatt (`purchases:user:<userId>`).
 *
 * A zár a `withAdvisoryLock` közös magjára épül — processzek között is véd.
 */
export async function withUserPurchasesLock<T>(
  payload: Payload,
  userId: number | string,
  fn: () => Promise<T>,
  log: Logger = rootLogger,
): Promise<T> {
  return withAdvisoryLock(payload, userPurchasesLockKey(userId), fn, log)
}
