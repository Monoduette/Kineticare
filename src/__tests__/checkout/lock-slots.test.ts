import { describe, expect, it } from 'vitest'

import {
  CHECKOUT_LOCK_MAX_CONCURRENT,
  CheckoutLockBusyError,
  withCheckoutLockSlot,
} from '../../lib/checkout/lock-slots'

/**
 * a-checkout-4 — a pénztár-zár helykorlátja. A 10 egyidejű pénztáras
 * pool-teszt (checkout-pool.test.ts) a korlát hatását méri; ez a fájl a
 * korlát saját életciklus-hibáit fogja: a hibával kilépő szakasz is
 * felszabadítja a helyét, és a túl sokáig váró kérés feladja (503) úgy, hogy
 * közben nem veszít el helyet.
 */

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('withCheckoutLockSlot', () => {
  it('a korláton felüli kérés vár; a hibával kilépő szakasz is felszabadítja a helyét', async () => {
    const gates = Array.from({ length: CHECKOUT_LOCK_MAX_CONCURRENT }, () => deferred())
    const holders = gates.map((gate, index) =>
      withCheckoutLockSlot(async () => {
        await gate.promise
        if (index === 0) {
          throw new Error('szakasz-hiba')
        }
      }),
    )
    let waiterRan = false
    const waiter = withCheckoutLockSlot(async () => {
      waiterRan = true
    })

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(waiterRan).toBe(false)

    gates[0]?.resolve()
    await expect(holders[0]).rejects.toThrow('szakasz-hiba')
    await waiter
    expect(waiterRan).toBe(true)

    for (const gate of gates) {
      gate.resolve()
    }
    await Promise.allSettled(holders)
  })

  it('a várakozási határ után CheckoutLockBusyError, és a feladott várakozó nem foglal helyet', async () => {
    const gate = deferred()
    const holders = Array.from({ length: CHECKOUT_LOCK_MAX_CONCURRENT }, () =>
      withCheckoutLockSlot(() => gate.promise),
    )

    await expect(withCheckoutLockSlot(async () => 'soha', 20)).rejects.toBeInstanceOf(
      CheckoutLockBusyError,
    )

    gate.resolve()
    await Promise.all(holders)
    // Minden hely szabad: a korlátnyi egyidejű szakasz azonnal belefér.
    const entered: number[] = []
    await Promise.all(
      Array.from({ length: CHECKOUT_LOCK_MAX_CONCURRENT }, (_unused, index) =>
        withCheckoutLockSlot(async () => {
          entered.push(index)
        }, 20),
      ),
    )
    expect(entered).toHaveLength(CHECKOUT_LOCK_MAX_CONCURRENT)
  })
})
