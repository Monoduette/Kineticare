// A jelszó-politika hook (OWASP A07) + login-hiba naplózás (afterError).
// A beforeChange hook a hash-elés ELŐTT fut (a create/update műveletek csak a
// hookok után generálják a salt/hash párost), így a data.password itt még nyers szöveg.
import {
  formatPasswordPolicyErrors,
  validatePasswordStrength,
} from '../lib/security/password-policy'
import { createLogger } from '../lib/logger'
import { resolveClientIp } from '../lib/audit'
import { deleteCourseProgressOnParentDelete } from '../lib/course-progress/cleanup'
import {
  CREDENTIAL_CHANGE_REVOKE_KEY,
  isEmailChanged,
  isPasswordChanged,
  revokeOtherSessionsAfterCredentialChange,
  revokeOtherSessionsAfterPasswordReset,
  shouldMarkCredentialChangeForSessionRevoke,
} from '../lib/security/revoke-other-sessions'
import {
  APIError,
  AuthenticationError,
  LockedAuth,
  type CollectionAfterChangeHook,
  type CollectionAfterErrorHook,
  type CollectionAfterLoginHook,
  type CollectionBeforeChangeHook,
  type CollectionConfig,
  type PayloadRequest,
} from 'payload'
import {
  canUpdateUser,
  hasOwnerRole,
  isOwner,
  isOwnerFieldAccess,
  isSelfOrAdmin,
  isStaffOrOwner,
  isStaffOrOwnerFieldAccess,
} from '../access'
import type { User } from '../payload-types'

const logger = createLogger({ module: 'users' })

/** A kérésen belül megosztott users-darabszám kulcsa a `req.context`-ben. */
const EXISTING_USER_COUNT = 'kineticareExistingUserCount'

/**
 * A meglévő felhasználók száma — kérésenként EGYSZER kérdezve le.
 *
 * A `promoteFirstUserToOwner` és az `enforcePasswordPolicy` ugyanazt kérdezi
 * („van-e már felhasználó?"), és mindkettő ugyanabban a beforeChange-láncban,
 * a beszúrás ELŐTT fut — a válasz a kérésen belül nem változhat, tehát a két
 * külön `count` ugyanazt a számot adta. A Payload `req.context`-je a hookok közt
 * megosztott, ezért az elsőként lefutó hook eredményét a másik onnan olvassa:
 * create-enként egy DB-kérdés kettő helyett.
 *
 * A hiányzó `context`-et is elviseli (unit-tesztek egyszerűsített req-mockja):
 * ilyenkor nincs megosztás, csak a friss lekérdezés — a visszaadott érték
 * mindkét ágon ugyanaz.
 */
async function countExistingUsers(req: PayloadRequest): Promise<number> {
  const cached = req.context?.[EXISTING_USER_COUNT]
  if (typeof cached === 'number') {
    return cached
  }
  const { totalDocs } = await req.payload.count({ collection: 'users' })
  if (req.context) {
    req.context[EXISTING_USER_COUNT] = totalDocs
  }
  return totalDocs
}

// OWASP A07: jelszó-erősségi politika. A Payload 3.88.0-ban nincs natív
// passwordMinLength/komplexitási beállítás, ezért hookból érvényesítjük.
// A collection beforeChange hook a hash-elés ELŐTT fut (a create/update
// műveletek csak a hookok után generálják a salt/hash párost), így a
// data.password itt még nyers szöveg. ASYNC — az első user ellenőrzéséhez
// a users-darabszámot a DB-ből kell lekérni.
const enforcePasswordPolicy: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  req,
  operation,
}) => {
  // Csak akkor ellenőrzünk, ha ténylegesen jelszót állítanak be vagy
  // módosítanak — a többi profilmező-mentést a hook érintetlenül hagyja.
  if (typeof data.password !== 'string' || data.password.length === 0) {
    return data
  }
  // Az első felhasználó (create-first-user / seed / első admin) létrehozásakor
  // a politika NEM érvényesül — különben az első admin létrehozása is
  // elbukna egy gyengébb jelszón, és a rendszer elérhetetlenné válna.
  // A politika csak a 2. usertől kezdve él (a create műveletnél).
  if (operation === 'create' && (await countExistingUsers(req)) === 0) {
    return data
  }
  // Update-nél az e-mail gyakran nincs a payloadban — ilyenkor a
  // meglévő rekord e-mail-címével vetjük össze a jelszót.
  const email =
    typeof data.email === 'string'
      ? data.email
      : (originalDoc?.email as string | undefined)
  const errors = validatePasswordStrength({ password: data.password, email })
  if (errors.length > 0) {
    throw new APIError(formatPasswordPolicyErrors(errors), 400)
  }
  return data
}

/**
 * A felhasználónak megjelenő 403-as üzenet, ha idegen fiók hitelesítési adatát
 * próbálná átírni. Exportált, hogy a teszt karakter-pontosan rögzíthesse.
 */
export const FOREIGN_CREDENTIAL_CHANGE_MESSAGE =
  'Más felhasználó e-mail-címét vagy jelszavát csak tulajdonos módosíthatja. ' +
  'A saját adataidat bármikor átírhatod; idegen fiókhoz kérj tulajdonosi segítséget.'

/**
 * Második védvonal: nem-owner csak saját jelszó/e-mail cseréje (beforeChange hook).
 * Kiegészíti a canUpdateUser where-t; create/resetPassword/server-side update nem érintett.
 */
const blockForeignCredentialChange: CollectionBeforeChangeHook = ({
  data,
  originalDoc,
  operation,
  req,
}) => {
  if (operation !== 'update') {
    return data
  }
  const actor = req.user
  if (!actor) {
    return data
  }
  const targetId = (originalDoc as { id?: unknown } | undefined)?.id ?? data.id
  if (targetId !== undefined && targetId !== null && String(targetId) === String(actor.id)) {
    return data
  }
  const changesPassword = typeof data.password === 'string' && data.password.length > 0
  const currentEmail = normalizeEmail((originalDoc as { email?: unknown } | undefined)?.email)
  const nextEmail = normalizeEmail(data.email)
  const changesEmail = nextEmail !== undefined && nextEmail !== currentEmail
  if (!changesPassword && !changesEmail) {
    return data
  }
  if (hasOwnerRole(actor)) {
    return data
  }
  logger.warn('elutasított hitelesítési-adat módosítás idegen felhasználói rekordon', {
    actorId: actor.id,
    actorRole: (actor as { role?: unknown }).role,
    targetUserId: targetId,
    mezo: changesPassword ? 'jelszó' : 'e-mail',
  })
  throw new APIError(FOREIGN_CREDENTIAL_CHANGE_MESSAGE, 403)
}

/** E-mail a Payload tárolási alakjában (trimmelt, kisbetűs); nem-string → undefined. */
function normalizeEmail(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim().toLowerCase() : undefined
}

// Az ELSŐ felhasználó owner-szerepkört kap.
//
// Enélkül a rendszer telepítés után zárva marad: a `role` mező field-access-e
// owner-only (`isOwnerFieldAccess`), owner viszont még nincs, ezért a
// create-first-user form nem tudja elküldeni a role-t, és az új user a
// `defaultValue: 'customer'` szerepkörrel jön létre. A collection
// `access.admin` viszont `isStaffOrOwner` — vagyis az első user NEM jut be az
// adminba, törölni sem lehet (`access.delete: isOwner`), és a szerepkörét sem
// írhatja át senki. A hook ezt a patthelyzetet oldja fel: ha a DB-ben még
// nincs user, a létrejövő rekord owner lesz. A 2. usertől a hook nem nyúl a
// role-hoz, tehát a jogemelés elleni védelem (owner-only field access)
// változatlanul él.
const promoteFirstUserToOwner: CollectionBeforeChangeHook = async ({ data, req, operation }) => {
  if (operation !== 'create') {
    return data
  }
  if ((await countExistingUsers(req)) > 0) {
    return data
  }
  logger.info('Az első felhasználó owner szerepkörrel jön létre')
  return { ...data, role: 'owner' }
}

// Sikertelen bejelentkezés naplózása. A Payload 3.88.0-ban NINCS
// afterFailedLogin hook; a REST /api/users/login hibák (hibás jelszó →
// AuthenticationError, zárolt fiók → LockedAuth) a routeError-en át a
// collection afterError hookjában landolnak. Jelszót sosem naplózunk —
// a logger redact-listája is védi az ilyen kulcsokat.
const logFailedLogin: CollectionAfterErrorHook = ({ error, req }) => {
  const isLoginRequest = typeof req.url === 'string' && req.url.includes('/login')
  if (!isLoginRequest || !(error instanceof AuthenticationError || error instanceof LockedAuth)) {
    return
  }
  const email = typeof req.data?.email === 'string' ? req.data.email : undefined
  // Megbízható kliens-IP (CF / x-forwarded-for hátulról; lásd src/lib/audit.ts).
  const ip = resolveClientIp(req.headers) ?? 'ismeretlen'
  logger.warn('Sikertelen bejelentkezés', {
    email,
    ip,
    reason: error instanceof LockedAuth ? 'zárolt fiók' : 'hibás jelszó',
  })
}

/**
 * A „jelszó-beállítás függőben" jelző TÖRLÉSE az első sikeres belépéskor.
 *
 * MIT JELENT A JELZŐ: a rendszer által létrehozott fiókokon (vendég-vásárlás
 * fiók-feloldása, vásárló-import) a vevő MÉG NEM választott jelszót — a
 * kezdőjelszó véletlen és eldobható. A jelzőből tudja a fizetés utáni levél,
 * hogy jelszó-beállító linket kell küldenie, nem „lépj be a fiókodba" szöveget.
 *
 * MIÉRT ÉPP A BELÉPÉSNÉL TÖRÖLJÜK: a sikeres bejelentkezés a BIZONYÍTÉK arra,
 * hogy a vevőnek működő jelszava van. Ez a jelszó-visszaállítás útját is lefedi:
 * a Payload `resetPasswordOperation`-je a jelszócsere után lefuttatja az
 * afterLogin hookokat (a beforeChange láncot NEM), tehát az aktiváló linkkel
 * beállított jelszó is ide fut be. Külön reset-oldali huzalozás így nem kell.
 *
 * BEST-EFFORT: a jelző törlésének hibája SOSEM törheti a bejelentkezést — hiba
 * esetén csak naplózunk; a legrosszabb következmény, hogy egy későbbi vásárlás
 * levelében fölöslegesen szerepel a jelszó-beállító link (a link a saját
 * címére megy, tehát ez nem jogosultsági kockázat).
 *
 * A `req` TOVÁBBADÁSA KÖTELEZŐ: enélkül a beágyazott update új tranzakcióban
 * futna, és a login-tranzakció által már írt sorra ön-blokkoló deadlockot okozna.
 */
/**
 * Jelszó- vagy e-mail-csere után a többi sessiont vissza kell vonni (J2).
 * A zászlót ide tesszük, mert a reset-ág megkerüli a beforeChange-et:
 * ott az afterLogin + útvonal dönt. Access-szabályt ez a hook nem nyit.
 */
const markCredentialChangeForSessionRevoke: CollectionBeforeChangeHook = ({
  data,
  originalDoc,
  operation,
  req,
}) => {
  const passwordChanged = isPasswordChanged(data)
  const emailChanged = isEmailChanged({
    currentEmail: normalizeEmail((originalDoc as { email?: unknown } | undefined)?.email),
    nextEmail: normalizeEmail(data.email),
  })
  if (
    shouldMarkCredentialChangeForSessionRevoke({ operation, passwordChanged, emailChanged }) &&
    req.context
  ) {
    req.context[CREDENTIAL_CHANGE_REVOKE_KEY] = true
  }
  return data
}

const revokeOtherSessionsAfterCredentialChangeHook: CollectionAfterChangeHook = async ({
  doc,
  operation,
  req,
  context,
}) => {
  await revokeOtherSessionsAfterCredentialChange({
    doc: doc as { id?: unknown },
    operation,
    req,
    context: context as Record<string, unknown> | undefined,
  })
  return doc
}

const revokeOtherSessionsAfterPasswordResetHook: CollectionAfterLoginHook = async ({
  req,
  user,
  token,
}) => {
  await revokeOtherSessionsAfterPasswordReset({ req, user, token })
  return user
}

const clearPasswordSetupPendingAfterLogin: CollectionAfterLoginHook = async ({ req, user }) => {
  if ((user as Pick<User, 'passwordSetupPending'>).passwordSetupPending !== true) {
    return user
  }
  try {
    await req.payload.update({
      collection: 'users',
      id: user.id,
      data: { passwordSetupPending: false },
      req,
      overrideAccess: true,
    })
  } catch (error) {
    logger.warn('a „jelszó-beállítás függőben" jelző törlése sikertelen (best-effort)', {
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  return user
}

export const Users: CollectionConfig = {
  slug: 'users',
  labels: {
    singular: 'Felhasználó',
    plural: 'Felhasználók',
  },
  admin: {
    useAsTitle: 'email',
    group: 'Felhasználók',
    // A „ki mit vett meg" a lista alapkérdése (tulajdonosi igény, 2026-08-16):
    // a purchases oszlop a kurzusok CÍMÉT mutatja (PurchasesCell). Szűrni a
    // lista „Szűrők" gombjával lehet rá (relationship-mező → kurzus-választó).
    defaultColumns: ['name', 'email', 'role', 'purchases', 'lastLoginAt'],
    description:
      'Szerkesztők és vásárlók. A szerepkört csak tulajdonos állíthatja át; a megvásárolt kurzusokat munkatárs és tulajdonos szerkesztheti. ' +
      'A „Megvásárolt kurzusok" oszlopban a kurzus mellett a haladás is látszik: ez számított érték, ezért eszerint rendezni és szűrni nem lehet.',
  },
  auth: {
    maxLoginAttempts: 5,
    lockTime: 600_000, // 10 perc zárolás 5 sikertelen próbálkozás után
    // A tokenExpiration-t a Payload MÁSODPERCBEN értelmezi (a JWT exp =
    // iat + tokenExpiration, node_modules/payload/dist/auth/jwt.js) — nem
    // milliszekundumban, mint a lockTime-ot.
    tokenExpiration: 7200, // 2 óra (másodpercben)
    // A session-süti Secure-jelölése: a Payload 3.88.0 defaultja secure:false
    // (collections/config/defaults.js), így a süti síma HTTP-n is elkészülne.
    // Élesben (https) KÖTELEZŐ a secure; fejlesztésben (http://localhost)
    // kikapcsolva marad, különben a böngésző el sem tárolná.
    cookies: { secure: process.env.NODE_ENV === 'production' },
  },
  access: {
    // Az admin felületet staff+owner éri el.
    admin: isStaffOrOwner,
    // Nyilvános regisztráció engedélyezett: a role mező owner-only
    // field-access-e miatt jogemelés így sem lehetséges (minden regisztráló
    // a default 'customer' szerepkört kapja). Owner az adminból bárkit létrehozhat.
    create: () => true,
    // OLVASÁS: saját rekord, staff/owner minden rekordot (ügyfélszolgálat,
    // rendelés-egyeztetés). A role és purchases mezők mezőszinten védettek.
    read: isSelfOrAdmin,
    // ÍRÁS: szűkebb, mint az olvasás (legkisebb jogosultság elve) — owner
    // mindent, staff a saját rekordját + a customer rekordokat, customer csak
    // magát. Indoklás és a védelmi rétegek: src/access/users-update.ts.
    update: canUpdateUser,
    // Törlés kizárólag owner.
    delete: isOwner,
    // Zárolt fiók feloldása (maxLoginAttempts után) kizárólag owner: a kulcs
    // hiányában a Payload a `defaultAccess`-t köti be, ami BÁRMELY
    // bejelentkezett felhasználónak engedné (auth/defaultAccess.js).
    unlock: isOwner,
  },
  fields: [
    // Az email mezőt az auth automatikusan hozzáadja.
    {
      name: 'name',
      type: 'text',
      required: true,
      label: 'Név',
    },
    {
      name: 'credentials',
      type: 'text',
      label: 'Végzettség, titulus',
      /** Tilos zóna 4: credentials/bioShort/portrait írás csak staff/owner (YMYL hamis hitelesítés ellen). */
      access: {
        create: isStaffOrOwnerFieldAccess,
        update: isStaffOrOwnerFieldAccess,
      },
      admin: {
        description:
          'Rövid szakmai titulus, például: gyógytornász, kézterapeuta. A cikkek szerzősorában és a szerző-blokkban jelenik meg. Csak olyan végzettséget írj ide, ami igazolható.',
      },
    },
    {
      name: 'bioShort',
      type: 'textarea',
      label: 'Rövid szakmai bemutatkozás',
      // Írás csak staff/owner — az indoklás a credentials mezőnél (tilos zóna 4).
      access: {
        create: isStaffOrOwnerFieldAccess,
        update: isStaffOrOwnerFieldAccess,
      },
      admin: {
        description:
          '1–2 mondat a szakterületről, a cikkek végi szerző-blokkba. Csak igazolható állítás kerülhet bele, gyógyulást ígérő megfogalmazás nem.',
      },
    },
    {
      name: 'portrait',
      type: 'upload',
      relationTo: 'media',
      label: 'Arckép',
      // Írás csak staff/owner — az indoklás a credentials mezőnél (tilos zóna 4).
      access: {
        create: isStaffOrOwnerFieldAccess,
        update: isStaffOrOwnerFieldAccess,
      },
      admin: {
        description:
          'Arckép a cikkek végi szerző-blokkba. Valódi portré legyen, ne logó vagy illusztráció: az olvasók a mérések szerint egyedül az igazi arcképet nézik meg.',
      },
    },
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'customer',
      label: 'Szerepkör',
      options: [
        { label: 'Tulajdonos', value: 'owner' },
        { label: 'Munkatárs', value: 'staff' },
        { label: 'Vásárló', value: 'customer' },
      ],
      admin: {
        description:
          'Tulajdonos: mindent lát és állít. Munkatárs: tartalmat kezel. Vásárló: csak a saját fiókját. Átállítani csak tulajdonos tud.',
      },
      access: {
        create: isOwnerFieldAccess,
        update: isOwnerFieldAccess,
      },
    },
    {
      name: 'purchases',
      type: 'relationship',
      relationTo: 'products',
      hasMany: true,
      label: 'Megvásárolt kurzusok',
      /** purchases írás csak rendszerfolyamat — admin pipa megkerülte a grant-panelt (2026-08-23). */
      access: {
        create: () => false,
        update: () => false,
      },
      admin: {
        description:
          'A felhasználó által megvásárolt kurzusok (hozzáférés). Fizetés és ajándékozás után töltődik. ' +
          'Kézi ajándék a Kurzus ajándékozása panellel vagy a grant-purchase scripttel adható — itt pipálni nem lehet, ' +
          'mert a pipa megkerülné a hozzáférés hosszát. A vevő saját magának nem adhat hozzáférést. ' +
          'A listaoszlopban minden kurzus mellett a haladás is megjelenik: ez számított érték, ezért eszerint rendezni és szűrni nem lehet. ' +
          'Szűrés a listában: Szűrők → Megvásárolt kurzusok.',
        components: {
          // A listaoszlop a kurzus CÍMÉT mutatja (displayTitle), nem a puszta
          // azonosítót — a gyári relationship-cella a `useAsTitle: 'sku'` miatt
          // csak a SKU-t írná ki.
          Cell: '/components/admin/PurchasesCell#PurchasesCell',
        },
      },
    },
    {
      /**
       * Ajándék-hozzáférés kezdőpontja időkorlátos kurzusnál (accessDurationDays).
       *
       * A purchases lista csak azt tudja, HOZZÁFÉR-e a vevő; a 365 napos óra
       * kezdőpontja paid rendelés nélkül itt él. Írás: kizárólag rendszerfolyamat
       * (`overrideAccess: true`) — a Kurzus ajándékozása panel a grant-végpontot
       * hívja, nem ezt a mezőt. A purchases mező írása is zárt (2026-08-23):
       * a pipa megkerülné ezt az órát.
       */
      name: 'accessGrants',
      type: 'array',
      label: 'Ajándék-hozzáférés (időpontok)',
      access: {
        create: () => false,
        update: () => false,
      },
      admin: {
        readOnly: true,
        description:
          'Időkorlátos ajándék-kurzus kezdőpontja. A staff a Kurzus ajándékozása panellel adja, nem itt.',
      },
      fields: [
        {
          name: 'product',
          type: 'relationship',
          relationTo: 'products',
          required: true,
          label: 'Kurzus',
        },
        {
          name: 'grantedAt',
          type: 'date',
          required: true,
          label: 'Ajándékozás időpontja',
          admin: {
            date: { pickerAppearance: 'dayAndTime' },
          },
        },
      ],
    },
    {
      // Olvasható áttekintő a felhasználó LAPJÁN: melyik kurzust vette meg, a
      // kurzus címével. UI-mező (nem tárol adatot → nincs séma-változás), a
      // fenti relationship-mező marad a szerkesztés helye.
      name: 'purchasesOverview',
      type: 'ui',
      label: 'Megvásárolt kurzusok (áttekintés)',
      admin: {
        components: {
          Field: '/components/admin/PurchasesOverviewPanel#PurchasesOverviewPanel',
        },
      },
    },
    {
      // Kézi kurzus-hozzáférés panel (UI-mező, NEM tárol adatot → nincs
      // séma-változás, migrációt nem igényel). A purchases mező field-access-e
      // rendszer-írású: a panel nem ír közvetlenül, hanem a
      // POST /api/admin/grant-purchase végpontot hívja (staff/owner, idempotens,
      // audit-naplózott) — ugyanaz a szolgáltatás, amit a CLI-script használ.
      name: 'grantPurchasePanel',
      type: 'ui',
      label: 'Kurzus ajándékozása',
      admin: {
        components: {
          Field: '/components/admin/GrantPurchasePanel#GrantPurchasePanel',
        },
      },
    },
    {
      name: 'billingName',
      type: 'text',
      label: 'Számlázási név',
    },
    {
      name: 'billingZip',
      type: 'text',
      label: 'Irányítószám',
    },
    {
      name: 'billingCity',
      type: 'text',
      label: 'Település',
    },
    {
      name: 'billingStreet',
      type: 'text',
      label: 'Utca, házszám',
    },
    {
      name: 'taxNumber',
      type: 'text',
      label: 'Adószám',
      admin: {
        description: 'Csak céges vásárlásnál kell.',
      },
    },
    {
      name: 'lastLoginAt',
      type: 'date',
      label: 'Utolsó belépés',
      admin: {
        readOnly: true,
      },
    },
    {
      /**
       * „A vevő még nem választott jelszót" jelző — a RENDSZER által létrehozott
       * fiókokon igaz (vendég-vásárlás fiók-feloldása, vásárló-import), minden
       * más fiókon hamis (a regisztráló maga adja meg a jelszavát).
       *
       * MIRE KELL: a fizetés utáni levél ebből dönti el, hogy jelszó-beállító
       * linket küldjön-e, vagy a belépésre irányítson. Enélkül a másodszor
       * (szintén vendégként) vásárló, még nem aktivált vevő „lépj be a
       * fiókodba" levelet kapna egy olyan fiókhoz, amihez nincs jelszava.
       *
       * ÍRÁS: kizárólag rendszerfolyamat (a mező create/update access-e zárt, a
       * beírás `overrideAccess: true`-val megy — a `purchases` mintája). A jelző
       * az első sikeres belépéskor magától törlődik (afterLogin hook), és a
       * jelszó-visszaállítás útja is ide fut be.
       */
      name: 'passwordSetupPending',
      type: 'checkbox',
      defaultValue: false,
      label: 'Jelszó-beállítás függőben',
      access: {
        create: () => false,
        update: () => false,
      },
      admin: {
        readOnly: true,
        description:
          'A fiókot a rendszer hozta létre (vendég-vásárlás vagy import), és a vevő még nem állított be saját jelszót. Az első belépéskor magától törlődik.',
      },
    },
  ],
  hooks: {
    // A hitelesítési-adat őr ELSŐKÉNT fut: idegen rekord jelszó-/e-mail-cseréje
    // már a jelszó-politika és a bootstrap-hook előtt elutasításra kerül.
    beforeChange: [
      blockForeignCredentialChange,
      promoteFirstUserToOwner,
      enforcePasswordPolicy,
      markCredentialChangeForSessionRevoke,
    ],
    // A haladás-sorok takarítása a törlés ELŐTT. Enélkül a Postgres elhasal
    // (course_progress.user_id NOT NULL + ON DELETE SET NULL), és a felhasználó
    // NEM TÖRÖLHETŐ — GDPR-törlési kérésnél is. Helyben, valós adatbázis ellen
    // reprodukálva; részletes indoklás: src/lib/course-progress/cleanup.ts.
    beforeDelete: [deleteCourseProgressOnParentDelete('user')],
    afterChange: [revokeOtherSessionsAfterCredentialChangeHook],
    afterLogin: [
      clearPasswordSetupPendingAfterLogin,
      revokeOtherSessionsAfterPasswordResetHook,
    ],
    afterError: [logFailedLogin],
  },
}
