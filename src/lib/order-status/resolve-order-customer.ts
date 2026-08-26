import type { Payload } from 'payload'

import type { Order, User } from '../../payload-types'
import { withAdvisoryLock } from '../advisory-lock'
import { maskEmail } from '../email/mask'
import type { Logger } from '../logger'
import { generateInitialPassword } from '../security/initial-password'
import { isGuestBindableAccount } from './guest-bindable-account'

/**
 * Fiók-feloldás vendég-vásárlásnál (paid előtt). E-mail-zár alatt keresés/létrehozás;
 * aktivált vagy nem-customer fiókhoz nem köt. Generált jelszó nem megy levélben.
 */

/** A rendeléshez feloldott fiók — a paid-átmenet és a visszaigazoló levél is ezt kapja. */
export interface OrderCustomerResolution {
  userId: number
  /** true, ha a fiók MOST, ebben a lépésben jött létre (vendég-vásárlás). */
  created: boolean
  /**
   * true, ha a vevőnek MÉG NINCS saját jelszava (most létrehozott vagy korábban
   * rendszer által létrehozott, még nem aktivált fiók) — ilyenkor jár a levélben
   * a jelszó-beállító link.
   */
  passwordSetupPending: boolean
  /**
   * true, ha a rendelés MÁR a fiókhoz volt kötve (bejelentkezett vásárlás) —
   * ilyenkor a levél változatlan marad (a vevő ismeri a fiókját).
   */
  alreadyLinked: boolean
  /** A fiók e-mail-címe (a levél és az aktiváló link címzettje). */
  email: string | null
  name: string | null
}

/** Relationship-érték → dokumentum-azonosító (number vagy populate-olt doc). */
function relationshipId(value: unknown): number | null {
  if (typeof value === 'number') {
    return value
  }
  if (typeof value === 'object' && value !== null && 'id' in value) {
    const id = (value as { id?: unknown }).id
    return typeof id === 'number' ? id : null
  }
  return null
}

interface CustomerSnapshotShape {
  email?: unknown
  name?: unknown
  billingName?: unknown
}

function snapshotOf(order: Order): CustomerSnapshotShape {
  return typeof order.customerSnapshot === 'object' && order.customerSnapshot !== null
    ? (order.customerSnapshot as CustomerSnapshotShape)
    : {}
}

function snapshotString(snapshot: CustomerSnapshotShape, key: keyof CustomerSnapshotShape): string {
  const value = snapshot[key]
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * A rendeléshez tartozó e-mail-cím, a users.email tárolási alakjára hozva
 * (kisbetűs, trimmelt — lásd Payload auth/baseFields/email.js).
 */
export function orderCustomerEmail(order: Order): string | null {
  const snapshot = snapshotOf(order)
  const raw = (order.customerEmail ?? '').trim() || snapshotString(snapshot, 'email')
  const normalized = raw.trim().toLowerCase()
  return normalized.length > 0 ? normalized : null
}

/** A vevő neve a rendelésről (a fiók `name` mezőjéhez); hiányában a számlázási név. */
function orderCustomerName(order: Order): string {
  const snapshot = snapshotOf(order)
  return snapshotString(snapshot, 'name') || snapshotString(snapshot, 'billingName')
}

/** Az e-mail-cím szerinti fiók-feloldás advisory-zár kulcsa (egy cím = egy zár). */
export function orderCustomerLockKey(email: string): string {
  return `order-customer:${email}`
}

async function findUserByEmail(payload: Payload, email: string): Promise<User | null> {
  const { docs } = await payload.find({
    collection: 'users',
    where: { email: { equals: email } },
    limit: 1,
    depth: 0,
    pagination: false,
    overrideAccess: true,
  })
  return (docs[0] as User | undefined) ?? null
}

function isPasswordSetupPending(user: Pick<User, 'passwordSetupPending'>): boolean {
  return user.passwordSetupPending === true
}

/**
 * A rendelés vevőjének feloldása — a `paid` átmenet ELŐFELTÉTELE.
 *
 * A hozzáférés-beírás (`grantPurchases`) fiók nélkül nem működik, ezért ez a
 * lépés a fizetési FŐLÁNC része: hibája dob, és a hívó (callback/poll) így
 * újrapróbálható `failed` állapotban hagyja az eseményt — a néma elnyelés
 * pontosan az a hiba, ami „pénz levonva, kurzus sehol" állapotot okozna.
 */
export async function resolveOrderCustomer(input: {
  payload: Payload
  order: Order
  log: Logger
}): Promise<OrderCustomerResolution> {
  const { payload, order, log } = input

  // 1. A rendelés MÁR fiókhoz kötött (bejelentkezett vásárlás) — csak beolvassuk.
  const linkedId = relationshipId(order.customer)
  if (linkedId !== null) {
    const user = (await payload.findByID({
      collection: 'users',
      id: linkedId,
      depth: 0,
      overrideAccess: true,
    })) as User
    return {
      userId: linkedId,
      created: false,
      passwordSetupPending: isPasswordSetupPending(user),
      alreadyLinked: true,
      email: user.email ?? null,
      name: user.name ?? null,
    }
  }

  // 2. Vendég-rendelés: az e-mail az EGYETLEN kapocs. Enélkül a hozzáférés
  //    kiadhatatlan — dobunk, hogy a hiba látható és újrapróbálható legyen.
  const email = orderCustomerEmail(order)
  if (email === null) {
    throw new Error(
      'a rendeléshez sem vevő (customer), sem e-mail-cím nem tartozik — a hozzáférés nem adható ki',
    )
  }
  const name = orderCustomerName(order)

  const resolved = await withAdvisoryLock(
    payload,
    orderCustomerLockKey(email),
    async (): Promise<{ user: User; created: boolean }> => {
      const existing = await findUserByEmail(payload, email)
      if (existing) {
        if (!isGuestBindableAccount(existing)) {
          throw new Error(
            'a vendég-rendelés aktivált vagy nem-customer fiókhoz nem köthető — a vevő jelentkezzen be',
          )
        }
        return { user: existing, created: false }
      }

      /**
       * ÜRES users-kollekcióra NEM hozunk létre fiókot: az első felhasználó a
       * `promoteFirstUserToOwner` hook miatt OWNER szerepkört kapna — vásárlásból
       * sosem születhet tulajdonosi fiók (a vásárló-import ugyanezt a szabályt
       * követi). Ez elvileg nem fordulhat elő (paid rendeléshez kell egy futó
       * rendszer), ezért hangosan hibázunk, nem csendben kihagyunk.
       */
      const { totalDocs } = await payload.count({ collection: 'users' })
      if (totalDocs === 0) {
        throw new Error(
          'a users kollekció üres: a vendég-vásárlásból létrehozott fiók tulajdonosi (owner) szerepkört kapna — a fiók-létrehozás elutasítva',
        )
      }

      try {
        const created = (await payload.create({
          collection: 'users',
          data: {
            email,
            name: name || email,
            // Pontosan a collection alapértelmezése (Users.role defaultValue:
            // 'customer') — kiírva, mert a generált create-adattípus kötelezőnek
            // jelöli a mezőt. Vásárlásból SOHA nem születik staff/owner fiók.
            role: 'customer',
            // Eldobható, véletlen jelszó: a Payload jelszó nélkül nem hoz létre
            // auth-rekordot. A vevő az aktiváló linkkel állít be sajátot.
            password: generateInitialPassword(email),
            passwordSetupPending: true,
          },
          overrideAccess: true,
          depth: 0,
        })) as User
        return { user: created, created: true }
      } catch (error) {
        // VERSENYHELYZET-TARTALÉK: ha a zár kimaradt (nem-production, mockolt
        // Payload) és közben más létrehozta a fiókot, a create egyedi-kényszerbe
        // ütközik. Ilyenkor a MÁSIK szál fiókját fogadjuk el — duplikátum nem jöhet létre.
        const raced = await findUserByEmail(payload, email)
        if (raced) {
          if (!isGuestBindableAccount(raced)) {
            throw new Error(
              'a vendég-rendelés aktivált vagy nem-customer fiókhoz nem köthető — a vevő jelentkezzen be',
            )
          }
          log.warn('fiók-feloldás: a fiókot közben egy párhuzamos szál hozta létre — azt használjuk', {
            cimzett: maskEmail(email),
            userId: raced.id,
          })
          return { user: raced, created: false }
        }
        throw error
      }
    },
    log,
  )

  // 3. A rendelés KÖTÉSE a fiókhoz — innentől a hozzáférés-beírás és az admin
  //    nézet is a fiókot látja. A `customer` mező a rendelésen rendszer-írású.
  await payload.update({
    collection: 'orders',
    id: order.id,
    data: { customer: resolved.user.id },
    overrideAccess: true,
  })

  log.info(
    resolved.created
      ? 'vendég-vásárlás: új fiók létrehozva és a rendeléshez kötve'
      : 'vendég-vásárlás: a rendelés a meglévő fiókhoz kötve (duplikátum nem jött létre)',
    {
      // A teljes cím SOSEM kerül naplóba — csak maszkolva, `cimzett` kulcson.
      cimzett: maskEmail(email),
      userId: resolved.user.id,
      created: resolved.created,
    },
  )

  return {
    userId: resolved.user.id,
    created: resolved.created,
    passwordSetupPending: resolved.created || isPasswordSetupPending(resolved.user),
    alreadyLinked: false,
    email: resolved.user.email ?? email,
    name: resolved.user.name ?? (name || null),
  }
}
