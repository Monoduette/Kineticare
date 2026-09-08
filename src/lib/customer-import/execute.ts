/**
 * Vásárló-import végrehajtás — idempotens, missing-only.
 *
 * Meglévő user: csak hiányzó purchases; jelszó/szerepkör érintetlen. Új user:
 * véletlen jelszó, aktiválási linkkel cserélhető. `overrideAccess: true` a
 * purchases mező miatt (mint grant-purchase). Hibás sor nem állítja meg a futást.
 */

import type { Payload } from 'payload'

import { auditLogStore, writeAuditLog } from '../audit'
import { maskEmail } from '../email/mask'
import { generateInitialPassword } from '../security/initial-password'
import type { Logger } from '../logger'
import { withUserPurchasesLock } from '../user-purchases-lock'
import { purchaseIdsOf, type ImportPlan, type PlanEntry } from './plan'

/**
 * A kezdőjelszó-generátor KÖZÖS modulban él (`src/lib/security/initial-password.ts`),
 * mert a vendég-vásárlás fiók-feloldása is ugyanezt használja. A re-export a
 * meglévő hívók (és tesztek) kedvéért marad itt.
 */
export { generateInitialPassword }

export type ExecutedAction = PlanEntry['action'] | 'failed'

/** Egy sor végrehajtásának eredménye — a CLI ezt írja ki soronként. */
export interface ExecutionOutcome {
  readonly email: string
  readonly action: ExecutedAction
  readonly userId?: number
  /** A ténylegesen beírt termékek SKU-i (idempotens no-op esetén üres). */
  readonly grantedSkus: readonly string[]
  /** Magyar hibaüzenet, ha az `action` = `failed`. */
  readonly error?: string
}

/** A záró MÉRLEG számai (a media-restore összesítőjének mintájára, magyarul). */
export interface ExecutionSummary {
  letrehozva: number
  bovitve: number
  kihagyva: number
  hibas: number
}

export interface ExecutionResult {
  readonly outcomes: readonly ExecutionOutcome[]
  readonly summary: ExecutionSummary
  /** Az ebben a futásban LÉTREHOZOTT felhasználók e-mailjei (aktiválási linkhez). */
  readonly createdEmails: readonly string[]
  /** Minden érintett (létrehozott vagy bővített) e-mail. */
  readonly touchedEmails: readonly string[]
}

export interface ExecuteOptions {
  readonly log?: Logger
  /** Soronkénti visszajelzés a CLI-nek (a lib maga nem ír a kimenetre). */
  readonly onOutcome?: (outcome: ExecutionOutcome) => void
  /**
   * A RÉGI VÁSÁRLÁS IDŐPONTJÁNAK megőrzése audit-bejegyzésben (alap: be).
   *
   * A users kollekcióban ma nincs mező a systeme.io-beli `Date Registered`
   * értéknek, séma-változtatás pedig migrációt igényelne — ezért az adat az
   * `audit-logs` collectionbe kerül (tulajdonosi olvasás, módosíthatatlan
   * napló), a beírt termékek SKU-ival együtt. Így az „mikor lett vevő"
   * kérdés az importált hozzáférésekre visszakereshető marad.
   *
   * Az írás BEST-EFFORT: a napló hibája sosem bukhatja meg az importot
   * (writeAuditLog maga nyeli el a hibát és warn-ol).
   */
  readonly recordLegacyPurchase?: boolean
}

/** A régi vásárlás megőrzésének audit-művelet neve (a naplóban erre lehet keresni). */
export const LEGACY_PURCHASE_AUDIT_ACTION = 'customer-import.legacy-purchase'

/** A felhasználó FRISS purchases-listája (a terv elavulhatott két futás közt). */
async function currentPurchaseIds(payload: Payload, userId: number): Promise<number[]> {
  const user = await payload.findByID({
    collection: 'users',
    id: userId,
    depth: 0,
    overrideAccess: true,
  })
  return purchaseIdsOf(user.purchases)
}

async function executeEntry(
  payload: Payload,
  entry: PlanEntry,
  log: Logger | undefined,
): Promise<ExecutionOutcome> {
  if (entry.action === 'skip-complete') {
    return { email: entry.email, action: 'skip-complete', userId: entry.userId, grantedSkus: [] }
  }

  if (entry.action === 'create-user') {
    // A meglévő felhasználót SOSEM írjuk felül: ha időközben (párhuzamos futás,
    // közben regisztráló vevő) létrejött, átváltunk hozzáfűzésre.
    const existing = await payload.find({
      collection: 'users',
      where: { email: { equals: entry.email } },
      depth: 0,
      overrideAccess: true,
    })
    if (existing.docs.length > 0) {
      const user = existing.docs[0]
      return appendPurchases(payload, { ...entry, userId: user.id }, log)
    }

    const created = await payload.create({
      collection: 'users',
      data: {
        email: entry.email,
        name: entry.name,
        // Pontosan a collection alapértelmezése (Users.role `defaultValue:
        // 'customer'`) — azért szerepel kiírva, mert a generált create-adattípus
        // kötelezőnek jelöli a mezőt. Az import SOHA nem hoz létre staff/owner
        // fiókot; a szerepkör-emelés emberi döntés az adminban.
        role: 'customer',
        // A jelszó véletlen és eldobható — a vevő az aktiválási linkkel állít
        // be sajátot.
        password: generateInitialPassword(entry.email),
        // A fiókhoz a vevő MÉG NEM választott jelszót. A jelző a rendszer által
        // létrehozott fiókok közös jelölése (vendég-vásárlás is ezt írja), és
        // az első sikeres belépéskor magától törlődik (Users afterLogin hook).
        passwordSetupPending: true,
        ...(entry.missingProducts.length > 0
          ? { purchases: entry.missingProducts.map((product) => product.id) }
          : {}),
      },
      overrideAccess: true,
    })
    log?.info('vásárló-import: felhasználó létrehozva', {
      // Maszkolt cím: a teljes e-mail-cím nem kerülhet naplóba (a logger
      // `email` kulcsú mezőt eleve redaktál) — a sor a userId-vel azonosítható.
      cimzett: maskEmail(entry.email),
      userId: created.id,
      grantedProductIds: entry.missingProducts.map((product) => product.id),
    })
    return {
      email: entry.email,
      action: 'create-user',
      userId: created.id,
      grantedSkus: entry.missingProducts.map((product) => product.sku),
    }
  }

  return appendPurchases(payload, entry, log)
}

/** Hiányzó termékek hozzáfűzése — a meglévő lista MEGŐRZÉSÉVEL (missing-only). */
async function appendPurchases(
  payload: Payload,
  entry: PlanEntry,
  log: Logger | undefined,
): Promise<ExecutionOutcome> {
  const userId = entry.userId
  if (userId === undefined) {
    throw new Error('Hiányzó felhasználó-azonosító a hozzáfűzéshez.')
  }
  return withUserPurchasesLock(
    payload,
    userId,
    async () => {
      const owned = await currentPurchaseIds(payload, userId)
      const ownedKeys = new Set(owned.map(String))
      const missing = entry.missingProducts.filter((product) => !ownedKeys.has(String(product.id)))

      if (missing.length === 0) {
        // Idempotens no-op: a másodszori futás ide fut be.
        return { email: entry.email, action: 'skip-complete', userId, grantedSkus: [] }
      }

      await payload.update({
        collection: 'users',
        id: userId,
        data: { purchases: [...owned, ...missing.map((product) => product.id)] },
        overrideAccess: true,
      })
      log?.info('vásárló-import: kurzus-hozzáférés hozzáfűzve', {
        cimzett: maskEmail(entry.email),
        userId,
        grantedProductIds: missing.map((product) => product.id),
      })
      return {
        email: entry.email,
        action: 'append-purchases',
        userId,
        grantedSkus: missing.map((product) => product.sku),
      }
    },
    log,
  )
}

/**
 * A régi (systeme.io-beli) vásárlás megőrzése AUDIT-BEJEGYZÉSBEN.
 *
 * MIÉRT ITT: a `users` kollekcióban nincs mező a `Date Registered` értéknek, és
 * séma-változtatás migrációt igényelne (CLAUDE.md 3. tilos zóna: migrációt csak
 * a Payload eszközével, emberi döntés után). Az `audit-logs` viszont pontosan
 * erre való: módosíthatatlan, tulajdonosi olvasású nyilvántartás arról, hogy
 * KI, MIKOR, MIT kapott — a beírt SKU-kkal és a régi dátummal együtt.
 *
 * BEST-EFFORT: a `writeAuditLog` maga nyeli el a hibát (warn), tehát a napló
 * bukása SOSEM bukhatja meg az importot.
 */
async function recordLegacyPurchase(
  payload: Payload,
  entry: PlanEntry,
  outcome: ExecutionOutcome,
): Promise<void> {
  if (outcome.grantedSkus.length === 0 && entry.registeredAt === undefined) {
    return
  }
  await writeAuditLog({
    store: auditLogStore(payload),
    action: LEGACY_PURCHASE_AUDIT_ACTION,
    entityType: 'users',
    entityId: outcome.userId ?? null,
    after: {
      // A forrás a CSV-import maga; a fájl a gyakorlatban a systeme.io-export,
      // de a mező nem állít olyat, amit nem tud (generic alakú fájl is jöhet).
      forras: 'vásárló-import (CSV)',
      email: entry.email,
      // A régi rendszerbeli vevővé válás időpontja (ISO-8601), ha a fájl adta.
      regiVasarlasIdopontja: entry.registeredAt ?? null,
      beirtSkuk: [...outcome.grantedSkus],
      muvelet: outcome.action,
      // Registration time is audit history, never proof of a SKU grant clock.
      hozzaferesiEredet: 'legacy-unverified',
      hozzaferesiEllenorzes: 'manual-review-required',
    },
  })
}

/**
 * A terv végrehajtása soronként.
 *
 * ÜRES users-kollekcióra nem indul el: az első felhasználó a
 * `promoteFirstUserToOwner` hook miatt OWNER szerepkört kapna — vásárlói
 * importból owner-fiók sosem születhet.
 */
export async function executeImportPlan(
  payload: Payload,
  plan: ImportPlan,
  options: ExecuteOptions = {},
): Promise<ExecutionResult> {
  if (plan.emptyUserCollection && plan.summary.create > 0) {
    throw new Error(
      'A users kollekció üres: az első létrehozott felhasználó tulajdonosi (owner) szerepkört kapna. ' +
        'Hozd létre előbb az admin-felhasználót, és csak utána futtasd a vásárló-importot.',
    )
  }

  const outcomes: ExecutionOutcome[] = []
  const summary: ExecutionSummary = { letrehozva: 0, bovitve: 0, kihagyva: 0, hibas: 0 }
  const createdEmails: string[] = []
  const touchedEmails: string[] = []

  for (const entry of plan.entries) {
    let outcome: ExecutionOutcome
    try {
      outcome = await executeEntry(payload, entry, options.log)
      // A régi rendszerbeli vásárlás időpontjának megőrzése — CSAK a ténylegesen
      // megváltozott sorokra. Az idempotens újrafutás (`skip-complete`) így nem
      // szemeteli tele a naplót ugyanazzal a bejegyzéssel.
      if (options.recordLegacyPurchase !== false && outcome.action !== 'skip-complete') {
        await recordLegacyPurchase(payload, entry, outcome)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      outcome = { email: entry.email, action: 'failed', grantedSkus: [], error: message }
      options.log?.error('vásárló-import: a sor feldolgozása sikertelen', {
        cimzett: maskEmail(entry.email),
        error: message,
      })
    }

    switch (outcome.action) {
      case 'create-user':
        summary.letrehozva += 1
        createdEmails.push(outcome.email)
        touchedEmails.push(outcome.email)
        break
      case 'append-purchases':
        summary.bovitve += 1
        touchedEmails.push(outcome.email)
        break
      case 'skip-complete':
        summary.kihagyva += 1
        break
      default:
        summary.hibas += 1
        break
    }

    outcomes.push(outcome)
    options.onOutcome?.(outcome)
  }

  return { outcomes, summary, createdEmails, touchedEmails }
}
