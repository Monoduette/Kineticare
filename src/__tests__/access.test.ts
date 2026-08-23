import type { Access, CollectionConfig, Field, FieldAccess } from 'payload'
import { describe, expect, it } from 'vitest'

import {
  adminOrPublishedStatus,
  canUpdateUser,
  isAdmin,
  isAdminFieldAccess,
  isDocumentOwner,
  isOwner,
  isOwnerFieldAccess,
  isSelfOrAdmin,
  isStaffOrOwner,
  isStaffOrOwnerFieldAccess,
  denyFieldWrite,
  publishedOrAdmin,
} from '../access'
import { visibleMenusOrAdmin } from '../access/menus-visibility'
import { visibleTestimonialsOrAdmin } from '../access/testimonials-visibility'
import { canReadOwnCourseProgress } from '../collections/CourseProgress'
import { orderIntegrityBeforeChange } from '../lib/order-integrity'
import configPromise from '../payload.config'

/**
 * T-011 access-függvény unit-tesztek: minden függvényhez pozitív + negatív eset
 * látogató / customer / staff / owner szerepkörökre.
 */

type Role = 'owner' | 'staff' | 'customer'

const owner = { id: 1, role: 'owner' as Role }
const staff = { id: 2, role: 'staff' as Role }
const customer = { id: 3, role: 'customer' as Role }

const accessArgs = (user: { id: number; role: Role } | null): Parameters<Access>[0] =>
  ({ req: { user } }) as unknown as Parameters<Access>[0]

const fieldAccessArgs = (user: { id: number; role: Role } | null): Parameters<FieldAccess>[0] =>
  ({ req: { user } }) as unknown as Parameters<FieldAccess>[0]

describe('isOwner / isOwnerFieldAccess', () => {
  it('ownernek true', () => {
    expect(isOwner(accessArgs(owner))).toBe(true)
    expect(isOwnerFieldAccess(fieldAccessArgs(owner))).toBe(true)
  })

  it.each([
    ['staff', staff],
    ['customer', customer],
  ])('%s szerepkörre false', (_label, user) => {
    expect(isOwner(accessArgs(user))).toBe(false)
    expect(isOwnerFieldAccess(fieldAccessArgs(user))).toBe(false)
  })

  it('látogatónak (nincs user) false', () => {
    expect(isOwner(accessArgs(null))).toBe(false)
    expect(isOwnerFieldAccess(fieldAccessArgs(null))).toBe(false)
  })
})

describe('isStaffOrOwner / isStaffOrOwnerFieldAccess', () => {
  it.each([
    ['owner', owner],
    ['staff', staff],
  ])('%s szerepkörre true', (_label, user) => {
    expect(isStaffOrOwner(accessArgs(user))).toBe(true)
    expect(isStaffOrOwnerFieldAccess(fieldAccessArgs(user))).toBe(true)
  })

  it('customerre false', () => {
    expect(isStaffOrOwner(accessArgs(customer))).toBe(false)
    expect(isStaffOrOwnerFieldAccess(fieldAccessArgs(customer))).toBe(false)
  })

  it('látogatónak false', () => {
    expect(isStaffOrOwner(accessArgs(null))).toBe(false)
    expect(isStaffOrOwnerFieldAccess(fieldAccessArgs(null))).toBe(false)
  })
})

describe('isAdmin / isAdminFieldAccess (plugin-bekötés: staff+owner)', () => {
  it.each([
    ['owner', owner],
    ['staff', staff],
  ])('%s szerepkörre true', (_label, user) => {
    expect(isAdmin(accessArgs(user))).toBe(true)
    expect(isAdminFieldAccess(fieldAccessArgs(user))).toBe(true)
  })

  it('customerre és látogatóra false', () => {
    expect(isAdmin(accessArgs(customer))).toBe(false)
    expect(isAdminFieldAccess(fieldAccessArgs(customer))).toBe(false)
    expect(isAdmin(accessArgs(null))).toBe(false)
    expect(isAdminFieldAccess(fieldAccessArgs(null))).toBe(false)
  })
})

describe('isSelfOrAdmin (users read/update)', () => {
  it.each([
    ['owner', owner],
    ['staff', staff],
  ])('%s minden rekordot ér (true)', (_label, user) => {
    expect(isSelfOrAdmin(accessArgs(user))).toBe(true)
  })

  it('customer csak a saját rekordját éri (id-kényszer)', () => {
    expect(isSelfOrAdmin(accessArgs(customer))).toEqual({ id: { equals: customer.id } })
  })

  it('látogatónak false', () => {
    expect(isSelfOrAdmin(accessArgs(null))).toBe(false)
  })
})

/**
 * A users ÍRÁSI szabálya (2026-08-16, belső biztonsági átvizsgálás).
 *
 * A régi szabály (`isSelfOrAdmin`) a staffnak MINDEN felhasználói rekordra
 * írási jogot adott — az owner és a többi staff rekordjára is. A Payload
 * beépített `password`/`email` mezőin nincs mezőszintű access, tehát ez idegen
 * fiók hitelesítési adatainak átírását (fiókátvételt) engedte volna. Az alábbi
 * mátrix mind a négy szerepkör-kombinációra rögzíti az új szabályt; a régi
 * kódon a staff-sor (`true` helyett where-kényszer) azonnal megbukna.
 */
describe('canUpdateUser (users update — legkisebb jogosultság)', () => {
  it('owner minden rekordot módosíthat (true)', () => {
    expect(canUpdateUser(accessArgs(owner))).toBe(true)
  })

  it('staff CSAK a saját rekordját és a customer rekordokat módosíthatja', () => {
    expect(canUpdateUser(accessArgs(staff))).toEqual({
      or: [{ id: { equals: staff.id } }, { role: { equals: 'customer' } }],
    })
  })

  it('a staff where-kényszere NEM engedi az owner/staff rekordot (csak customer vagy önmaga)', () => {
    const where = canUpdateUser(accessArgs(staff)) as {
      or: Array<Record<string, Record<string, unknown>>>
    }
    // Egyik ág sem enged owner/staff szerepkörű, idegen rekordot:
    expect(where.or.map((clause) => Object.keys(clause)[0])).toEqual(['id', 'role'])
    expect(where.or[1].role.equals).toBe('customer')
  })

  it('customer kizárólag a saját rekordját módosíthatja (id-kényszer)', () => {
    expect(canUpdateUser(accessArgs(customer))).toEqual({ id: { equals: customer.id } })
  })

  it('látogatónak false', () => {
    expect(canUpdateUser(accessArgs(null))).toBe(false)
  })

  it('az OLVASÁS tágabb marad, mint az írás (a staff minden rekordot lát)', () => {
    // Ügyfélszolgálat/rendelés-egyeztetés: a staff olvasása változatlanul true.
    expect(isSelfOrAdmin(accessArgs(staff))).toBe(true)
    expect(canUpdateUser(accessArgs(staff))).not.toBe(true)
  })
})

describe('publishedOrAdmin (pages/posts read, saját status mező)', () => {
  it.each([
    ['owner', owner],
    ['staff', staff],
  ])('%s draftot is olvas (true)', (_label, user) => {
    expect(publishedOrAdmin(accessArgs(user))).toBe(true)
  })

  it('customer csak publishedet olvas (status-kényszer)', () => {
    expect(publishedOrAdmin(accessArgs(customer))).toEqual({ status: { equals: 'published' } })
  })

  it('látogató is csak publishedet olvas', () => {
    expect(publishedOrAdmin(accessArgs(null))).toEqual({ status: { equals: 'published' } })
  })
})

describe('adminOrPublishedStatus (products read, drafts _status mező)', () => {
  it.each([
    ['owner', owner],
    ['staff', staff],
  ])('%s draftot is olvas (true)', (_label, user) => {
    expect(adminOrPublishedStatus(accessArgs(user))).toBe(true)
  })

  it('customer és látogató csak published draft-verziót olvas', () => {
    expect(adminOrPublishedStatus(accessArgs(customer))).toEqual({
      _status: { equals: 'published' },
    })
    expect(adminOrPublishedStatus(accessArgs(null))).toEqual({ _status: { equals: 'published' } })
  })
})

describe('visibleTestimonialsOrAdmin (testimonials read, a menus mintájára)', () => {
  it.each([
    ['owner', owner],
    ['staff', staff],
  ])('%s a levett véleményeket is olvassa (true)', (_label, user) => {
    expect(visibleTestimonialsOrAdmin(accessArgs(user))).toBe(true)
  })

  it('customer csak a látható véleményeket olvassa (visible-kényszer)', () => {
    expect(visibleTestimonialsOrAdmin(accessArgs(customer))).toEqual({
      visible: { equals: true },
    })
  })

  it('látogató is csak a látható véleményeket olvassa', () => {
    expect(visibleTestimonialsOrAdmin(accessArgs(null))).toEqual({ visible: { equals: true } })
  })
})

describe('isDocumentOwner (orders/carts customer-kényszer)', () => {
  it('bejelentkezett user a saját customer-dokumentumait kapja', () => {
    expect(isDocumentOwner(accessArgs(customer))).toEqual({
      customer: { equals: customer.id },
    })
  })

  it('látogatónak false', () => {
    expect(isDocumentOwner(accessArgs(null))).toBe(false)
  })
})

/** Rekurzív mező-gyűjtő a group/row/tabs-struktúrákhoz (a plugin mezőfája ilyen). */
const flattenFields = (fields: Field[]): Field[] => {
  const result: Field[] = []
  for (const field of fields) {
    result.push(field)
    if ('fields' in field && Array.isArray(field.fields)) {
      result.push(...flattenFields(field.fields as Field[]))
    }
    if (field.type === 'tabs' && Array.isArray(field.tabs)) {
      for (const tab of field.tabs) {
        result.push(...flattenFields(tab.fields as Field[]))
      }
    }
  }
  return result
}

type NamedTestField = Field & {
  name: string
  access?: {
    create?: FieldAccess
    read?: FieldAccess
    update?: FieldAccess
    delete?: FieldAccess
  }
  unique?: boolean
}

const findField = (collection: CollectionConfig, name: string): NamedTestField | undefined =>
  flattenFields(collection.fields).find((field) => 'name' in field && field.name === name) as
    | NamedTestField
    | undefined

describe('collection access bekötés a végleges configban', () => {
  it('pages/posts/menus/categories/media a mátrix szerint bekötve', async () => {
    const config = await configPromise
    const bySlug = new Map<string, CollectionConfig>(
      (config.collections ?? []).map((c) => [c.slug, c]),
    )

    for (const slug of ['pages', 'posts']) {
      const collection = bySlug.get(slug)
      expect(collection?.access?.read, slug).toBe(publishedOrAdmin)
      expect(collection?.access?.create, slug).toBe(isStaffOrOwner)
      expect(collection?.access?.update, slug).toBe(isStaffOrOwner)
      expect(collection?.access?.delete, slug).toBe(isStaffOrOwner)
    }

    const categories = bySlug.get('categories')
    expect(categories?.access?.create).toBe(isStaffOrOwner)
    expect(categories?.access?.update).toBe(isStaffOrOwner)
    expect(categories?.access?.delete).toBe(isStaffOrOwner)
    // categories read: nyilvános (mindenkinek true)
    expect(categories?.access?.read?.(accessArgs(null))).toBe(true)

    // menus (T-013): a read nyilvános, de nem-admin csak a visible=true sorokat
    // kapja (where-kényszer); staff/owner mindent lát. A centrális politika és a
    // Menus collection ugyanazt a visibleMenusOrAdmin függvényt használja.
    const menus = bySlug.get('menus')
    expect(menus?.access?.create).toBe(isStaffOrOwner)
    expect(menus?.access?.update).toBe(isStaffOrOwner)
    expect(menus?.access?.delete).toBe(isStaffOrOwner)
    expect(menus?.access?.read).toBe(visibleMenusOrAdmin)
    expect(menus?.access?.read?.(accessArgs(null))).toEqual({ visible: { equals: true } })
    expect(menus?.access?.read?.(accessArgs(customer))).toEqual({ visible: { equals: true } })
    expect(menus?.access?.read?.(accessArgs(staff))).toBe(true)
    expect(menus?.access?.read?.(accessArgs(owner))).toBe(true)

    const media = bySlug.get('media')
    // A public read megmarad, a write staff+owner.
    expect(media?.access?.read?.(accessArgs(null))).toBe(true)
    expect(media?.access?.create).toBe(isStaffOrOwner)
    expect(media?.access?.update).toBe(isStaffOrOwner)
    expect(media?.access?.delete).toBe(isStaffOrOwner)
  })

  /**
   * A Testimonials collection-fájl maga NEM tartalmaz access-blokkot: a
   * politikát a centrális pipeline (applyCollectionAccessPolicies) applikálja rá.
   * Ez a teszt azt őrzi, hogy a bekötés a VÉGLEGES configban tényleg megtörténik
   * — különben a collection default (staff-only admin) szabályokkal maradna, és
   * a kezdőlap vélemény-szekciója nem kapna adatot a nyilvános olvasáson.
   */
  it('testimonials: a read látható-vagy-admin, az írás staff+owner', async () => {
    const config = await configPromise
    const testimonials = (config.collections ?? []).find((c) => c.slug === 'testimonials')

    expect(testimonials).toBeDefined()
    expect(testimonials?.access?.read).toBe(visibleTestimonialsOrAdmin)
    expect(testimonials?.access?.create).toBe(isStaffOrOwner)
    expect(testimonials?.access?.update).toBe(isStaffOrOwner)
    expect(testimonials?.access?.delete).toBe(isStaffOrOwner)

    // Mátrix-sor: látogató és customer csak a visible=true sorokat kapja,
    // staff/owner mindent (az adminban a levett vélemény is szerkeszthető).
    expect(testimonials?.access?.read?.(accessArgs(null))).toEqual({ visible: { equals: true } })
    expect(testimonials?.access?.read?.(accessArgs(customer))).toEqual({
      visible: { equals: true },
    })
    expect(testimonials?.access?.read?.(accessArgs(staff))).toBe(true)
    expect(testimonials?.access?.read?.(accessArgs(owner))).toBe(true)
  })

  it('users: saját rekord + owner-only delete, nyitott regisztráció', async () => {
    const config = await configPromise
    const users = (config.collections ?? []).find((c) => c.slug === 'users')

    expect(users?.access?.read).toBe(isSelfOrAdmin)
    // Az ÍRÁS szűkebb, mint az olvasás: staff csak a saját + customer rekordot.
    expect(users?.access?.update).toBe(canUpdateUser)
    expect(users?.access?.update?.(accessArgs(owner))).toBe(true)
    expect(users?.access?.update?.(accessArgs(staff))).not.toBe(true)
    expect(users?.access?.update?.(accessArgs(null))).toBe(false)
    expect(users?.access?.delete).toBe(isOwner)
    expect(users?.access?.admin).toBe(isStaffOrOwner)
    // A create nyitott (regisztráció) — látogató is hozhat létre fiókot.
    expect(users?.access?.create?.(accessArgs(null))).toBe(true)

    // A role mező továbbra is owner-only (jogemelés-gátlás).
    const roleField = findField(users as CollectionConfig, 'role')
    expect(roleField?.access?.create).toBe(isOwnerFieldAccess)
    expect(roleField?.access?.update).toBe(isOwnerFieldAccess)

    // A purchases mező írása zárt (2026-08-23): a pipa megkerülné az
    // ajándék-órát. Részletes mátrix:
    // src/__tests__/security/users-purchases-field-access.test.ts.
    const purchasesField = findField(users as CollectionConfig, 'purchases')
    expect(purchasesField?.access?.create?.(fieldAccessArgs(owner))).toBe(false)
    expect(purchasesField?.access?.update?.(fieldAccessArgs(owner))).toBe(false)
    expect(purchasesField?.access?.update?.(fieldAccessArgs(staff))).toBe(false)
    expect(purchasesField?.access?.update?.(fieldAccessArgs(customer))).toBe(false)
    expect(purchasesField?.access?.update?.(fieldAccessArgs(null))).toBe(false)

    // A három szerző-mező (credentials, bioShort, portrait) írása szintén
    // staff/owner-only. Enélkül a vevő a SAJÁT rekordján (canUpdateUser)
    // beírhatna magának szakmai titulust, amit a cikkek szerző- és
    // lektor-blokkja meg a MedicalWebPage séma nyilvánosan megjelenít —
    // YMYL-tartalomnál hamis szakmai hitelesítés (biztonsági review,
    // 2026-08-22). Az őr mindhárom mezőn a TELJES szerepkör-mátrixot méri,
    // hogy a mező-access törlése ne csúszhasson vissza némán.
    for (const fieldName of ['credentials', 'bioShort', 'portrait'] as const) {
      const field = findField(users as CollectionConfig, fieldName)
      expect(field?.access?.create?.(fieldAccessArgs(owner)), `${fieldName} create owner`).toBe(
        true,
      )
      expect(field?.access?.update?.(fieldAccessArgs(owner)), `${fieldName} update owner`).toBe(
        true,
      )
      expect(field?.access?.update?.(fieldAccessArgs(staff)), `${fieldName} update staff`).toBe(
        true,
      )
      expect(
        field?.access?.update?.(fieldAccessArgs(customer)),
        `${fieldName} update customer`,
      ).toBe(false)
      expect(field?.access?.update?.(fieldAccessArgs(null)), `${fieldName} update anon`).toBe(false)
    }
  })

  it('products: ár-mezők és status owner-only írásúak', async () => {
    const config = await configPromise
    const products = (config.collections ?? []).find((c) => c.slug === 'products') as
      | CollectionConfig
      | undefined
    expect(products).toBeDefined()

    for (const name of ['priceInHUF', 'priceInHUFEnabled']) {
      const field = findField(products as CollectionConfig, name)
      expect(field, name).toBeDefined()
      expect(field?.access?.create, name).toBe(isOwnerFieldAccess)
      expect(field?.access?.update, name).toBe(isOwnerFieldAccess)
    }

    // A status a videos[].status miatt nem egyedi név — a top-level mezőt vizsgáljuk.
    const statusField = (products as CollectionConfig).fields.find(
      (field) => 'name' in field && field.name === 'status',
    ) as NamedTestField | undefined
    expect(statusField).toBeDefined()
    expect(statusField?.access?.create).toBe(isOwnerFieldAccess)
    expect(statusField?.access?.update).toBe(isOwnerFieldAccess)
  })

  it('orders: pénzügyi/személyes mezők read owner-only, refund update owner-only', async () => {
    const config = await configPromise
    const orders = (config.collections ?? []).find((c) => c.slug === 'orders') as
      | CollectionConfig
      | undefined
    expect(orders).toBeDefined()

    for (const name of ['customerSnapshot', 'ipAddress', 'invoiceNumber', 'barionPaymentId']) {
      const field = findField(orders as CollectionConfig, name)
      expect(field, name).toBeDefined()
      expect(field?.access?.read, name).toBe(isOwnerFieldAccess)
    }

    for (const name of ['refundedAt', 'refundReason']) {
      const field = findField(orders as CollectionConfig, name)
      expect(field, name).toBeDefined()
      expect(field?.access?.update, name).toBe(isOwnerFieldAccess)
    }
  })

  it('orders: számla/stornó/helyesbítő mezőket staff és owner REST-en sem ír (K5)', async () => {
    const config = await configPromise
    const orders = (config.collections ?? []).find((c) => c.slug === 'orders') as
      | CollectionConfig
      | undefined
    expect(orders).toBeDefined()

    const locked = [
      'invoiceStatus',
      'invoiceNumber',
      'invoicePdfUrl',
      'invoiceAttempts',
      'invoiceLastError',
      'invoiceCompletionDate',
      'stornoStatus',
      'stornoNumber',
      'stornoAttempts',
      'stornoLastError',
      'correctiveInvoiceStatus',
      'correctiveInvoiceNumber',
      'correctiveInvoiceSeq',
      'correctiveInvoiceAttempts',
      'correctiveInvoiceLastError',
      'correctiveInvoiceAttemptsSeq',
    ]
    for (const name of locked) {
      const field = findField(orders as CollectionConfig, name)
      expect(field, name).toBeDefined()
      expect(field?.access?.update, `${name} update`).toBe(denyFieldWrite)
      expect(field?.access?.update?.(fieldAccessArgs(staff)), `${name} staff`).toBe(false)
      expect(field?.access?.update?.(fieldAccessArgs(owner)), `${name} owner`).toBe(false)
    }
  })

  it('orders: orderNumber + snapshot-mezők bekötve, integritási hook create-kor fut', async () => {
    const config = await configPromise
    const orders = (config.collections ?? []).find((c) => c.slug === 'orders') as
      | CollectionConfig
      | undefined
    expect(orders).toBeDefined()

    const orderNumber = findField(orders as CollectionConfig, 'orderNumber')
    expect(orderNumber).toBeDefined()
    expect(orderNumber?.unique).toBe(true)
    // A kliens nem írhatja (sem create, sem update).
    expect(orderNumber?.access?.create?.(fieldAccessArgs(owner))).toBe(false)
    expect(orderNumber?.access?.update?.(fieldAccessArgs(owner))).toBe(false)

    for (const name of ['totalHufSnapshot', 'titleSnapshot', 'priceHufSnapshot']) {
      const field = findField(orders as CollectionConfig, name)
      expect(field, name).toBeDefined()
      expect(field?.access?.create?.(fieldAccessArgs(owner)), name).toBe(false)
      expect(field?.access?.update?.(fieldAccessArgs(owner)), name).toBe(false)
    }

    expect(orders?.hooks?.beforeChange).toContain(orderIntegrityBeforeChange)
  })

  it('users: a zárolt fiók feloldása (unlock) kizárólag owner-jog (M1)', async () => {
    const config = await configPromise
    const users = (config.collections ?? []).find((c) => c.slug === 'users')

    // A kulcs hiányában a szanitizálás a „bármely bejelentkezett felhasználó"
    // defaultAccess-t kötné be (payload/dist/collections/config/defaults.js) —
    // egy customer feloldhatná bármely zárolt fiókot.
    expect(users?.access?.unlock).toBe(isOwner)
    expect(users?.access?.unlock?.(accessArgs(owner))).toBe(true)
    expect(users?.access?.unlock?.(accessArgs(staff))).toBe(false)
    expect(users?.access?.unlock?.(accessArgs(customer))).toBe(false)
    expect(users?.access?.unlock?.(accessArgs(null))).toBe(false)
  })

  it('users: a tokenExpiration másodpercben értelmezett 2 óra — 7200 (M7)', async () => {
    const config = await configPromise
    const users = (config.collections ?? []).find((c) => c.slug === 'users')

    // A JWT exp = iat + tokenExpiration (payload/dist/auth/jwt.js), az iat
    // MÁSODPERCBEN van — a korábbi 7_200_000 ezért ~83 napot jelentett.
    expect(users?.auth).toMatchObject({ tokenExpiration: 7200 })
  })

  it('forms/form-submissions: űrlap-írás staff+owner, a beküldés nyilvános marad (M2)', async () => {
    const config = await configPromise
    const bySlug = new Map<string, CollectionConfig>(
      (config.collections ?? []).map((c) => [c.slug, c]),
    )

    const forms = bySlug.get('forms')
    expect(forms).toBeDefined()
    // A read nyilvános marad (a plugin defaultja — a nyilvános űrlap-render kéri).
    expect(forms?.access?.read?.(accessArgs(null))).toBe(true)
    // M2: a plugin create/update/delete-re a „bármely bejelentkezett user"
    // defaultAccess-t tenné (a plugin csak a read-et tölti ki) — helyette
    // staff+owner (isAdmin), különben egy customer átírhatná a kapcsolat-űrlapot
    // és a beküldési e-mail-címet (PII-szivárgás).
    expect(forms?.access?.create).toBe(isAdmin)
    expect(forms?.access?.update).toBe(isAdmin)
    expect(forms?.access?.delete).toBe(isAdmin)
    // Viselkedés-mátrix: anon/customer nem szerkeszthet űrlapot, staff/owner igen.
    for (const operation of ['create', 'update', 'delete'] as const) {
      const accessFn = forms?.access?.[operation]
      expect(accessFn?.(accessArgs(null)), `forms/${operation}/anon`).toBe(false)
      expect(accessFn?.(accessArgs(customer)), `forms/${operation}/customer`).toBe(false)
      expect(accessFn?.(accessArgs(staff)), `forms/${operation}/staff`).toBe(true)
      expect(accessFn?.(accessArgs(owner)), `forms/${operation}/owner`).toBe(true)
    }

    const submissions = bySlug.get('form-submissions')
    expect(submissions).toBeDefined()
    // A beküldés (create) nyilvános marad — a kapcsolat-űrlap működése.
    expect(submissions?.access?.create?.(accessArgs(null))).toBe(true)
    // A beküldések olvasása/kezelése staff+owner (PII-védelem).
    expect(submissions?.access?.read).toBe(isAdmin)
    expect(submissions?.access?.update).toBe(isAdmin)
    expect(submissions?.access?.delete).toBe(isAdmin)
    expect(submissions?.access?.read?.(accessArgs(null))).toBe(false)
    expect(submissions?.access?.read?.(accessArgs(customer))).toBe(false)
    expect(submissions?.access?.read?.(accessArgs(staff))).toBe(true)
    expect(submissions?.access?.read?.(accessArgs(owner))).toBe(true)
  })

  it('webhook-events/audit-logs/course-progress: access-bekötés és mátrix (M10)', async () => {
    const config = await configPromise
    const bySlug = new Map<string, CollectionConfig>(
      (config.collections ?? []).map((c) => [c.slug, c]),
    )

    const roleMatrix: Array<[string, { id: number; role: Role } | null]> = [
      ['owner', owner],
      ['staff', staff],
      ['customer', customer],
      ['látogató', null],
    ]

    // webhook-events: olvasás staff+owner, írás SENKI (kizárólag
    // rendszerfolyamat, overrideAccess-szel). A collection helyi,
    // nem exportált access-függvényeket használ — a bekötést a
    // viselkedésen mérjük.
    const webhookEvents = bySlug.get('webhook-events')
    expect(webhookEvents).toBeDefined()
    expect(webhookEvents?.access?.read?.(accessArgs(owner))).toBe(true)
    expect(webhookEvents?.access?.read?.(accessArgs(staff))).toBe(true)
    expect(webhookEvents?.access?.read?.(accessArgs(customer))).toBe(false)
    expect(webhookEvents?.access?.read?.(accessArgs(null))).toBe(false)
    for (const operation of ['create', 'update', 'delete'] as const) {
      const accessFn = webhookEvents?.access?.[operation]
      for (const [label, user] of roleMatrix) {
        expect(accessFn?.(accessArgs(user)), `webhook-events/${operation}/${label}`).toBe(false)
      }
    }

    // audit-logs: olvasás KIZÁRÓLAG owner (a before/after személyes adatot
    // hordozhat), írás SENKI (az audit-trail integritása).
    const auditLogs = bySlug.get('audit-logs')
    expect(auditLogs).toBeDefined()
    expect(auditLogs?.access?.read?.(accessArgs(owner))).toBe(true)
    expect(auditLogs?.access?.read?.(accessArgs(staff))).toBe(false)
    expect(auditLogs?.access?.read?.(accessArgs(customer))).toBe(false)
    expect(auditLogs?.access?.read?.(accessArgs(null))).toBe(false)
    for (const operation of ['create', 'update', 'delete'] as const) {
      const accessFn = auditLogs?.access?.[operation]
      for (const [label, user] of roleMatrix) {
        expect(accessFn?.(accessArgs(user)), `audit-logs/${operation}/${label}`).toBe(false)
      }
    }

    // course-progress: a read a saját-haladás szabály (bekötés-identitás +
    // mátrix), create/update SENKI (csak a szerver route, overrideAccess-szel),
    // delete staff+owner (hibás sor javítása az adminból).
    const courseProgress = bySlug.get('course-progress')
    expect(courseProgress).toBeDefined()
    expect(courseProgress?.access?.read).toBe(canReadOwnCourseProgress)
    expect(courseProgress?.access?.delete).toBe(isStaffOrOwner)
    expect(courseProgress?.access?.read?.(accessArgs(owner))).toBe(true)
    expect(courseProgress?.access?.read?.(accessArgs(staff))).toBe(true)
    expect(courseProgress?.access?.read?.(accessArgs(customer))).toEqual({
      user: { equals: customer.id },
    })
    expect(courseProgress?.access?.read?.(accessArgs(null))).toBe(false)
    for (const operation of ['create', 'update'] as const) {
      const accessFn = courseProgress?.access?.[operation]
      for (const [label, user] of roleMatrix) {
        expect(accessFn?.(accessArgs(user)), `course-progress/${operation}/${label}`).toBe(false)
      }
    }
    expect(courseProgress?.access?.delete?.(accessArgs(null))).toBe(false)
    expect(courseProgress?.access?.delete?.(accessArgs(customer))).toBe(false)
    expect(courseProgress?.access?.delete?.(accessArgs(staff))).toBe(true)
    expect(courseProgress?.access?.delete?.(accessArgs(owner))).toBe(true)
  })
})
