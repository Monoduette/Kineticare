/**
 * Seed — demó/induló tartalom, idempotens (email/slug/sku kulcs). npm run seed
 * SEED_OWNER_PASSWORD kötelező ownerhez; teljes seed élesen tiltott (SEED_SCOPE=kezdolap kivétel).
 * Kezdőlap layout csak üres szekciósornál íródik. Menü: menu-seed.ts
 */

import { pathToFileURL } from 'node:url'

import { getPayload, type Payload } from 'payload'

import {
  buildHomeLayout,
  ensureHomeImages,
  ensureHomeLayout,
  ensureHomeTestimonials,
  minimalRichText,
  type HomeMediaIds,
} from '../lib/home-seed'
import { ensureMediaFiles } from '../lib/media-restore'
import { ensureNavigationMenu } from '../lib/menu-seed'
import { ensureAppointmentForm } from '../lib/appointment/form'
import { ensureNewsletterForm } from '../lib/newsletter/form'
import { isProductionServerUrl, serverUrlHost } from '../lib/security/live-environment'
import {
  formatPasswordPolicyErrors,
  validatePasswordStrength,
} from '../lib/security/password-policy'
import config from '../payload.config'

const OWNER_EMAIL = process.env.SEED_OWNER_EMAIL ?? 'owner@kineticare.local'

/**
 * A hiányzó `SEED_OWNER_PASSWORD` magyar hibaüzenete. Exportált, hogy a teszt
 * karakter-pontosan rögzíthesse (és hogy sose kerüljön bele érték).
 */
export const MISSING_OWNER_PASSWORD_MESSAGE =
  'A SEED_OWNER_PASSWORD környezeti változó KÖTELEZŐ az owner-felhasználó ' +
  'létrehozásához: a jelszót a futtatókörnyezet adja meg, a script nem generál ' +
  'és nem naplóz jelszót. Állítsd be a szolgáltatás Variables felületén (érték a ' +
  'repóba SOHA nem kerül), majd futtasd újra a seedet.'

/** Owner jelszó kizárólag SEED_OWNER_PASSWORD-ből — generált jelszó naplóba kerülne. */
function resolveOwnerPassword(): string {
  const provided = process.env.SEED_OWNER_PASSWORD
  if (typeof provided !== 'string' || provided.trim().length === 0) {
    throw new Error(MISSING_OWNER_PASSWORD_MESSAGE)
  }
  const errors = validatePasswordStrength({ password: provided, email: OWNER_EMAIL })
  if (errors.length > 0) {
    throw new Error(
      `A SEED_OWNER_PASSWORD nem felel meg a jelszó-politikának. ${formatPasswordPolicyErrors(errors)}`,
    )
  }
  return provided
}

export interface SeedGuardInput {
  /** A `SEED_SCOPE` nyers értéke — a `kezdolap` hatókör élesben is futhat. */
  readonly seedScope: string | undefined
  /** A `NEXT_PUBLIC_SERVER_URL` nyers értéke. */
  readonly serverUrl: string | undefined
  /** A `SEED_CONFIRM_LIVE` nyers értéke — kifejezett tulajdonosi felülbírálás. */
  readonly confirmLive: string | undefined
}

/**
 * Teljes seed éles-védelem — éles DB-n tiltott (`SEED_CONFIRM_LIVE=igen` felülírás).
 * `SEED_SCOPE=kezdolap` továbbra is futhat élesben. Tiszta függvény, tesztelhető.
 */
export function seedGuardErrors(input: SeedGuardInput): string[] {
  if (input.seedScope?.trim() === 'kezdolap') {
    return []
  }
  if (input.confirmLive?.trim().toLowerCase() === 'igen') {
    return []
  }
  if (!isProductionServerUrl(input.serverUrl)) {
    return []
  }
  return [
    `A NEXT_PUBLIC_SERVER_URL az ÉLES oldalra mutat (${serverUrlHost(input.serverUrl)}) — a TELJES ` +
      'seed (demó-kategóriák, demó-oldal, demó-poszt, demó-termék, menüfa) ilyen ' +
      'környezetben nem futhat, mert bemutató-tartalmat keverne a valódi kínálat közé. ' +
      'Élesben a szűkített hatókör használható: SEED_SCOPE=kezdolap npm run seed. ' +
      'Ha egy ÚJ éles környezet első telepítése miatt mégis a teljes seed kell, a ' +
      'futtatás kifejezett megerősítéssel indítható: SEED_CONFIRM_LIVE=igen.',
  ]
}

/**
 * TARTALMI kapu: valódi vevőt vagy rendelést hordoz-e az adatbázis.
 *
 * A `NEXT_PUBLIC_SERVER_URL` egy rossz környezetbe másolt vagy elgépelt érték
 * is lehet — ez az ellenőrzés magából az ADATBÓL dönt (az `assertDemoDatabase`
 * mintája). A staff/owner felhasználókat szándékosan NEM nézzük: a fejlesztői és
 * demó-környezetek adminjai is valódi címmel lépnek be.
 */
async function assertNotLiveDatabase(payload: Payload): Promise<void> {
  const { docs: customers } = await payload.find({
    collection: 'users',
    where: { role: { equals: 'customer' } },
    limit: REAL_DATA_SCAN_LIMIT,
    depth: 0,
    overrideAccess: true,
  })
  const realCustomer = customers.find((user) => !isSeedSafeEmail(user.email))
  if (realCustomer !== undefined) {
    throw new Error(
      `Az adatbázisban VALÓDI vásárló van (felhasználó #${realCustomer.id}) — a teljes seed ` +
        'elutasítva, mert demó-tartalmat írna éles adat mellé. Élesben a szűkített ' +
        'hatókör használható: SEED_SCOPE=kezdolap npm run seed.',
    )
  }

  const { docs: orders } = await payload.find({
    collection: 'orders',
    limit: REAL_DATA_SCAN_LIMIT,
    depth: 0,
    overrideAccess: true,
  })
  const realOrder = orders.find((order) => !isSeedSafeEmail(order.customerEmail))
  if (realOrder !== undefined) {
    throw new Error(
      `Az adatbázisban VALÓDI rendelés van (rendelés #${realOrder.id}) — a teljes seed ` +
        'elutasítva. Élesben a szűkített hatókör használható: SEED_SCOPE=kezdolap npm run seed.',
    )
  }
}

/** Egy lekérdezésben átnézett sorok felső határa a „valódi adat" kapunál. */
const REAL_DATA_SCAN_LIMIT = 200

/**
 * Seed szempontjából ártalmatlan (nem valódi vevő) cím: a demó/teszt fiókok
 * `@example.com` domainje. A lista szándékosan szűk — inkább álljon meg a seed
 * feleslegesen, mint hogy éles adat mellé írjon.
 */
export function isSeedSafeEmail(email: string | null | undefined): boolean {
  return typeof email === 'string' && email.trim().toLowerCase().endsWith('@example.com')
}

// A kezdőlap-alapállapot logikája a src/lib/home-seed.ts-ben él (az onInit is
// azt futtatja); a tesztek kedvéért a buildHomeLayout innen is elérhető marad.
export { buildHomeLayout, type HomeMediaIds }

/**
 * A deploykor elveszett képfájlok visszatöltése (src/lib/media-restore.ts).
 *
 * A kép-helyreállításnak a layout-betöltés ELŐTT kell futnia: az
 * `ensureHomeImages` fájlnév-deduppal dolgozik, tehát a meglévő DB-rekordokat
 * látva kihagyná a hiányzó fájlok pótlását. Best-effort — az onInit
 * `ensureHomeBaseline` mintájára —, mert a seed többi lépését nem akaszthatja
 * meg egy fájlrendszer-hiba.
 */
async function restoreMediaFilesBestEffort(payload: Payload): Promise<void> {
  try {
    await ensureMediaFiles(payload)
  } catch (error) {
    payload.logger.warn(
      `Seed: a képfájlok helyreállítása sikertelen (best-effort): ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
}

async function seed(): Promise<void> {
  // ÉLES-VÉDELEM — a `SEED_SCOPE=kezdolap` ág ELŐTT, de azt átengedve (a
  // seedGuardErrors maga tér vissza üres listával arra a hatókörre).
  // Környezeti kapu ELŐSZÖR: adatbázis-kapcsolat sem kell hozzá.
  const guardErrors = seedGuardErrors({
    seedScope: process.env.SEED_SCOPE,
    serverUrl: process.env.NEXT_PUBLIC_SERVER_URL,
    confirmLive: process.env.SEED_CONFIRM_LIVE,
  })
  if (guardErrors.length > 0) {
    throw new Error(`A seed nem futhat le:\n- ${guardErrors.join('\n- ')}`)
  }

  const payload = await getPayload({ config })

  // --- Szűkített hatókör (SEED_SCOPE=kezdolap) -------------------------------
  // Éles környezetben CSAK ezt futtatjuk: a landing tartalmi képei a Médiatárba
  // + a kezdőlap alap-szekciósora. A demó-tartalmi lépések (owner-felhasználó,
  // kategóriák, oldalak, demó-poszt, demó-termék, menü) élesben nem jöhetnek
  // létre — azok a fejlesztői/üres-adatbázisos teljes seed részei maradnak.
  // Mindkét lépés idempotens, és meglévő szekciósort sosem ír felül.
  if (process.env.SEED_SCOPE === 'kezdolap') {
    await restoreMediaFilesBestEffort(payload)
    const homeMediaIds = await ensureHomeImages(payload)
    await ensureHomeLayout(payload, homeMediaIds)
    await ensureHomeTestimonials(payload)
    // A lábléc MINDEN oldalon megjelenik, ezért a „Hírlevél" űrlap telepítési
    // előfeltétel — a szűkített (éles) hatókörben is létre kell jönnie,
    // különben a feliratkozó-blokk élesben némán kimaradna.
    await ensureNewsletterForm(payload)
    // Az időpontkérő szekció űrlapja ugyanígy telepítési előfeltétel: a
    // szerkesztő a blokkot bármelyik lapra kiteheti, és űrlap nélkül a szekció
    // csak a telefonos utat tudná felkínálni.
    await ensureAppointmentForm(payload)
    payload.logger.info('Seed: kész (hatókör: kezdolap).')
    return
  }

  // TARTALMI kapu: a teljes seed csak olyan adatbázison futhat, amelyen nincs
  // valódi vevő vagy rendelés (a demoGuardErrors + assertDemoDatabase mintája:
  // a környezeti változó tévedhet, az adat nem).
  await assertNotLiveDatabase(payload)

  // --- Owner-felhasználó -----------------------------------------------------
  const existingOwner = await payload.find({
    collection: 'users',
    where: { email: { equals: OWNER_EMAIL } },
    limit: 1,
    overrideAccess: true,
  })

  let ownerId: number

  if (existingOwner.docs.length > 0) {
    ownerId = existingOwner.docs[0].id
    payload.logger.info(`Seed: owner-felhasználó már létezik (${OWNER_EMAIL}), kihagyva.`)
  } else {
    const password = resolveOwnerPassword()

    const owner = await payload.create({
      collection: 'users',
      data: {
        email: OWNER_EMAIL,
        password,
        name: 'Kineticare Owner',
        role: 'owner',
      },
      overrideAccess: true,
    })
    ownerId = owner.id
    // JELSZÓ SOHA NEM KERÜL A NAPLÓBA — sem kulcson, sem üzenetszövegbe ágyazva
    // (a logger redakciója kulcsnév-alapú, üzenetszöveget nem szűr).
    payload.logger.info(
      `Seed: owner-felhasználó létrehozva (${OWNER_EMAIL}); a jelszó a SEED_OWNER_PASSWORD értéke.`,
    )
  }

  // --- Kategóriák ------------------------------------------------------------
  const ensureCategory = async (input: {
    title: string
    slug: string
    type: 'content' | 'product'
  }): Promise<number> => {
    const existing = await payload.find({
      collection: 'categories',
      where: { slug: { equals: input.slug } },
      limit: 1,
      overrideAccess: true,
    })
    if (existing.docs.length > 0) {
      payload.logger.info(`Seed: kategória már létezik (${input.slug}), kihagyva.`)
      return existing.docs[0].id
    }
    const created = await payload.create({
      collection: 'categories',
      data: {
        title: input.title,
        slug: input.slug,
        type: input.type,
      },
      overrideAccess: true,
    })
    payload.logger.info(`Seed: kategória létrehozva (${input.slug}).`)
    return created.id
  }

  const contentCategoryId = await ensureCategory({
    title: 'Tudástár',
    slug: 'tudastar',
    type: 'content',
  })
  const productCategoryId = await ensureCategory({
    title: 'Kézrehabilitációs kurzusok',
    slug: 'kezrehabilitacios-kurzusok',
    type: 'product',
  })

  // --- Demó oldal ------------------------------------------------------------
  const existingPage = await payload.find({
    collection: 'pages',
    where: { slug: { equals: 'bemutatkozas' } },
    limit: 1,
    overrideAccess: true,
  })
  if (existingPage.docs.length > 0) {
    payload.logger.info('Seed: demó oldal már létezik (bemutatkozas), kihagyva.')
  } else {
    await payload.create({
      collection: 'pages',
      data: {
        title: 'Bemutatkozás',
        slug: 'bemutatkozas',
        excerpt: 'A Kineticare kézrehabilitációs kurzusplatform bemutatkozó oldala.',
        content: minimalRichText('Üdvözöl a Kineticare — ez a bemutatkozó demó oldal.'),
        // A `status` a `_status`-ból szinkronizálódik (src/lib/publish-status.ts),
        // ezért a kettőt együtt kell megadni — `_status` nélkül a rekord piszkozat
        // maradna, és a demó oldal nem jelenne meg a storefronton.
        status: 'published',
        _status: 'published',
        publishedAt: new Date().toISOString(),
      },
      overrideAccess: true,
    })
    payload.logger.info('Seed: demó oldal létrehozva (bemutatkozas).')
  }

  // --- Demó bejegyzés --------------------------------------------------------
  const existingPost = await payload.find({
    collection: 'posts',
    where: { slug: { equals: 'kezrehabilitacio-alapok' } },
    limit: 1,
    overrideAccess: true,
  })
  if (existingPost.docs.length > 0) {
    payload.logger.info('Seed: demó bejegyzés már létezik (kezrehabilitacio-alapok), kihagyva.')
  } else {
    await payload.create({
      collection: 'posts',
      data: {
        title: 'Kézrehabilitáció alapok',
        slug: 'kezrehabilitacio-alapok',
        excerpt: 'Bevezető a kézrehabilitációs gyakorlatok világába.',
        content: minimalRichText('Ez a demó bejegyzés a kézrehabilitáció alapjairól.'),
        // Lásd a demó oldalnál: a `status` a `_status`-ból szinkronizálódik.
        status: 'published',
        _status: 'published',
        publishedAt: new Date().toISOString(),
        author: ownerId,
        categories: [contentCategoryId],
      },
      overrideAccess: true,
    })
    payload.logger.info('Seed: demó bejegyzés létrehozva (kezrehabilitacio-alapok).')
  }

  // --- Demó termék (kurzus) --------------------------------------------------
  const existingProduct = await payload.find({
    collection: 'products',
    where: { sku: { equals: 'DEMO-KEZREHAB-001' } },
    limit: 1,
    overrideAccess: true,
  })
  if (existingProduct.docs.length > 0) {
    payload.logger.info('Seed: demó termék már létezik (DEMO-KEZREHAB-001), kihagyva.')
  } else {
    await payload.create({
      collection: 'products',
      data: {
        sku: 'DEMO-KEZREHAB-001',
        shortDescription: 'Demó kézrehabilitációs kurzus a platform kipróbálásához.',
        priceInHUFEnabled: true,
        priceInHUF: 19990,
        category: productCategoryId,
        status: 'published',
        _status: 'published',
      },
      overrideAccess: true,
    })
    payload.logger.info('Seed: demó termék létrehozva (DEMO-KEZREHAB-001).')
  }

  // --- Demó menüfa (frontend-keret) ------------------------------------------
  const pageId = (
    await payload.find({
      collection: 'pages',
      where: { slug: { equals: 'bemutatkozas' } },
      limit: 1,
      overrideAccess: true,
    })
  ).docs[0]?.id
  const postId = (
    await payload.find({
      collection: 'posts',
      where: { slug: { equals: 'kezrehabilitacio-alapok' } },
      limit: 1,
      overrideAccess: true,
    })
  ).docs[0]?.id
  const productId = (
    await payload.find({
      collection: 'products',
      where: { sku: { equals: 'DEMO-KEZREHAB-001' } },
      limit: 1,
      overrideAccess: true,
    })
  ).docs[0]?.id

  const ensureMenuItem = async (input: {
    label: string
    type: 'page' | 'post' | 'url' | 'product'
    order: number
    ref?: { relationTo: 'pages' | 'posts' | 'products'; value: number }
    url?: string
    parent?: number
  }): Promise<number | undefined> => {
    const existing = await payload.find({
      collection: 'menus',
      where: {
        and: [
          { label: { equals: input.label } },
          input.parent !== undefined
            ? { parent: { equals: input.parent } }
            : { parent: { exists: false } },
        ],
      },
      limit: 1,
      overrideAccess: true,
    })
    if (existing.docs.length > 0) {
      payload.logger.info(`Seed: menüpont már létezik (${input.label}), kihagyva.`)
      return existing.docs[0].id
    }
    const created = await payload.create({
      collection: 'menus',
      data: {
        label: input.label,
        type: input.type,
        order: input.order,
        ...(input.ref ? { ref: input.ref } : {}),
        ...(input.url ? { url: input.url } : {}),
        ...(input.parent !== undefined ? { parent: input.parent } : {}),
      },
      overrideAccess: true,
    })
    payload.logger.info(`Seed: menüpont létrehozva (${input.label}).`)
    return created.id
  }

  await ensureMenuItem({ label: 'Kezdőlap', type: 'url', url: '/', order: 0 })
  const coursesMenuId = await ensureMenuItem({
    label: 'Kurzusok',
    type: 'url',
    url: '/kurzusok',
    order: 1,
  })
  if (productId !== undefined && coursesMenuId !== undefined) {
    await ensureMenuItem({
      label: 'Demó kézrehabilitációs kurzus',
      type: 'product',
      ref: { relationTo: 'products', value: productId },
      parent: coursesMenuId,
      order: 0,
    })
  }
  if (postId !== undefined) {
    await ensureMenuItem({
      label: 'Tudástár',
      type: 'post',
      ref: { relationTo: 'posts', value: postId },
      order: 2,
    })
  }
  if (pageId !== undefined) {
    await ensureMenuItem({
      label: 'Bemutatkozás',
      type: 'page',
      ref: { relationTo: 'pages', value: pageId },
      order: 3,
    })
  }

  // A VALÓS menüstruktúra (Szolgáltatások + almenü, Tudástár) — ugyanaz a
  // label+parent dedup, mint fent, ezért a fenti demó-menüpontokat nem
  // duplikálja és nem írja felül. Élesben ugyanez a lépés a `npm run seed:menu`
  // scripttel futtatható önállóan (src/lib/menu-seed.ts).
  await ensureNavigationMenu(payload)

  // --- Kezdőlapi képek + alap-szekciósor -------------------------------------
  await restoreMediaFilesBestEffort(payload)
  const homeMediaIds = await ensureHomeImages(payload)
  await ensureHomeLayout(payload, homeMediaIds)
  await ensureHomeTestimonials(payload)

  // --- Nyilvános űrlapok (C9 + időpontkérés) ---------------------------------
  // A form-builder űrlap ADAT (a `forms` collection egy sora), nem séma: nincs
  // hozzá migráció. Idempotens — meglévő űrlapot SOHA nem ír felül, mert azt a
  // szerkesztő már átszabhatta.
  await ensureNewsletterForm(payload)
  await ensureAppointmentForm(payload)

  payload.logger.info('Seed: kész.')
}

/**
 * Indítás-kapu: a seed CSAK közvetlen futtatáskor indul el (npm run seed).
 * Importálva — például a `buildHomeLayout` alap-layoutot ellenőrző tesztből —
 * a modul mellékhatás nélkül töltődik be, adatbázis-kapcsolat nélkül.
 */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seed()
    .then(() => {
      process.exit(0)
    })
    .catch((error) => {
      console.error('Seed: hiba történt.', error)
      process.exit(1)
    })
}
