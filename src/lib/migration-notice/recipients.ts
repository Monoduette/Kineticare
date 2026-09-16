/**
 * Az átköltöztetési értesítő (WP40) CÍMZETT-KÖRE.
 *
 * Kik kapják: a `customer` szerepkörű fiókok, amelyeket a RENDSZER hozott létre
 * (vásárló-import vagy ingyenes-kurzus igénylés), és amelyekhez a vevő MÉG NEM
 * állított be saját jelszót. Ennek a jele a `passwordSetupPending: true`
 * (`src/collections/Users.ts`): az első sikeres belépéskor magától törlődik,
 * tehát „aki már belépett az új oldalon" automatikusan kiesik. Külön
 * „utolsó belépés" mezőre nem építünk: a `lastLoginAt` mezőt ma semmi nem írja.
 *
 * Kik NEM kapják:
 *  - staff / owner (a szerepkör-szűrő miatt);
 *  - aki már beállított jelszót (`passwordSetupPending: false`);
 *  - akinek az ÚJ oldalon rendelése van (vendég-vásárlás): neki nem volt régi
 *    jelszava, a fizetés utáni levél már jelszó-beállító linket vitt;
 *  - aki már megkapta ezt a levelet (`migrationNoticeSentAt`), kivéve `--force`;
 *  - akinek NINCS kurzus-hozzáférése (purchases és accessGrants üres): neki a
 *    levél Kurzusaim-ígérete hamis lenne (vezetői döntés, 2026-09-16); a
 *    próbafutás külön listázza őket, és `--include-no-access` kapcsolóval
 *    kérésre bevehetők (előbb a terv 10. pontjának címke → SKU táblája).
 *
 * A modul CSAK OLVAS; a küldés és a jelölés a `send.ts` dolga.
 */

import type { Payload } from 'payload'

import type { User } from '../../payload-types'

export interface MigrationNoticeRecipient {
  readonly id: User['id']
  readonly email: string
  readonly name: string | null
  /** Volt-e már kiküldés (a `--force` ág ezt a dátumot látja, de nem tiszteli). */
  readonly sentAt: string | null
  /** Van-e a fiókon kurzus-hozzáférés (purchases vagy accessGrants). */
  readonly hasAccess: boolean
}

export interface RecipientFilter {
  /** Újraküldés a már jelölt fiókoknak is. */
  readonly force?: boolean
  /** Csak ez az egy cím (kisbetűsítve hasonlítjuk). */
  readonly only?: string
  /** Legfeljebb ennyi címzett (a szűrés UTÁN, azonosító szerint növekvő sorrendben). */
  readonly limit?: number
  /** A kurzus-hozzáférés nélküli fiókok is kapjanak levelet (alapból kimaradnak). */
  readonly includeNoAccess?: boolean
}

export interface RecipientSelection {
  readonly recipients: readonly MigrationNoticeRecipient[]
  /**
   * Kurzus-hozzáférés nélkül kimaradt fiókok (csak `includeNoAccess` nélkül
   * töltődik): a CLI maszkolva, darabszámmal listázza őket.
   */
  readonly excludedNoAccess: readonly MigrationNoticeRecipient[]
  readonly skipped: {
    /** Már megkapta a levelet (és nincs `--force`). */
    readonly alreadySent: number
    /** Az új oldalon rendelése van (vendég-vásárló, nem átköltöztetett). */
    readonly hasNewSiteOrder: number
    /** A `--only` / `--limit` miatt kimaradt jelöltek. */
    readonly filteredOut: number
  }
}

/** Lapozás mérete a users-lekérdezésben (a Payload alapértelmezett 10-e kevés). */
const PAGE_SIZE = 200

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

function purchasesOf(user: Pick<User, 'purchases' | 'accessGrants'>): boolean {
  const purchases = Array.isArray(user.purchases) ? user.purchases : []
  const grants = Array.isArray(user.accessGrants) ? user.accessGrants : []
  return purchases.length > 0 || grants.length > 0
}

async function hasNewSiteOrder(payload: Payload, userId: User['id']): Promise<boolean> {
  const { totalDocs } = await payload.count({
    collection: 'orders',
    where: { customer: { equals: userId } },
    overrideAccess: true,
  })
  return totalDocs > 0
}

/**
 * A címzettek összegyűjtése. Determinisztikus sorrend (id szerint növekvő),
 * hogy a `--limit=N` próbakör és az éles kör ugyanazokkal kezdjen.
 */
export async function collectMigrationNoticeRecipients(
  payload: Payload,
  filter: RecipientFilter = {},
): Promise<RecipientSelection> {
  const only = filter.only ? normalizeEmail(filter.only) : undefined
  const candidates: MigrationNoticeRecipient[] = []
  const excludedNoAccess: MigrationNoticeRecipient[] = []
  let alreadySent = 0
  let hasNewSiteOrderCount = 0
  let filteredOut = 0

  let page = 1
  let hasNextPage = true
  while (hasNextPage) {
    const result = await payload.find({
      collection: 'users',
      where: {
        and: [{ role: { equals: 'customer' } }, { passwordSetupPending: { equals: true } }],
      },
      depth: 0,
      limit: PAGE_SIZE,
      page,
      sort: 'id',
      overrideAccess: true,
    })

    for (const user of result.docs) {
      const email = typeof user.email === 'string' ? normalizeEmail(user.email) : ''
      if (!email) {
        continue
      }
      const sentAt =
        typeof user.migrationNoticeSentAt === 'string' ? user.migrationNoticeSentAt : null
      if (sentAt !== null && filter.force !== true) {
        alreadySent += 1
        continue
      }
      if (only !== undefined && email !== only) {
        filteredOut += 1
        continue
      }
      if (await hasNewSiteOrder(payload, user.id)) {
        hasNewSiteOrderCount += 1
        continue
      }
      const recipient: MigrationNoticeRecipient = {
        id: user.id,
        email,
        name: typeof user.name === 'string' && user.name.trim() ? user.name.trim() : null,
        sentAt,
        hasAccess: purchasesOf(user),
      }
      if (!recipient.hasAccess && filter.includeNoAccess !== true) {
        excludedNoAccess.push(recipient)
        continue
      }
      candidates.push(recipient)
    }

    hasNextPage = result.hasNextPage === true
    page += 1
  }

  let recipients: MigrationNoticeRecipient[] = candidates
  if (filter.limit !== undefined && filter.limit >= 0 && candidates.length > filter.limit) {
    filteredOut += candidates.length - filter.limit
    recipients = candidates.slice(0, filter.limit)
  }

  return {
    recipients,
    excludedNoAccess,
    skipped: { alreadySent, hasNewSiteOrder: hasNewSiteOrderCount, filteredOut },
  }
}
