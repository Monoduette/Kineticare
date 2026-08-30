/**
 * DEMO-környezet feltöltése kitalált adattal (vásárlók, paid rendelések, haladás).
 * Idempotens; meglévő adatot nem ír felül. Élesen NEM futhat.
 *
 * Kapuk: DEMO_MODE=1 kötelező; kineticare.hu URL tiltott; valódi @example.com-n kívüli
 * vevő vagy rendelés → leállás. Fizetés: applyBarionStateTransition (SOSEM confirmOrder).
 *
 *   DEMO_MODE=1 npm run seed:demo
 * Előfeltétel: migrate + npm run seed. DEMO_CUSTOMER_PASSWORD kötelező (RFC 2606 @example.com).
 * Részletek: docs/demo-kornyezet.md
 */

import { pathToFileURL } from 'node:url'

import { getPayload, type Payload } from 'payload'

import { mapBarionPaymentStatus, type BarionPaymentStateResponse } from '../lib/barion'
import { buildCurriculum, playableLessons } from '../lib/curriculum/curriculum'
import { minimalRichText } from '../lib/home-seed'
import { createLogger, type Logger } from '../lib/logger'
import { applyBarionStateTransition } from '../lib/order-status/apply-barion-state'
import { generateInitialPassword } from '../lib/security/initial-password'
import { isProductionServerUrl, PRODUCTION_HOSTS, serverUrlHost } from '../lib/security/live-environment'
import {
  formatPasswordPolicyErrors,
  validatePasswordStrength,
} from '../lib/security/password-policy'
import config from '../payload.config'
import type { Order, Product, User } from '../payload-types'

const log = createLogger({ script: 'demo-seed' })

// ---------------------------------------------------------------------------
// Állandók
// ---------------------------------------------------------------------------

/**
 * A demó-adat egyetlen felismerhető jegye: az e-mail-domain.
 *
 * Az `example.com` az RFC 2606 által kifejezetten bemutató/dokumentációs célra
 * fenntartott domain — sosem tartozhat valódi postafiókhoz, tehát a demó-adat
 * véletlenül sem címezhet valódi embert. Egyben ez a KAPU is: a script minden
 * általa írt sort ezzel jelöl, és a „valódi adat" felismerése is ezen múlik.
 */
export const DEMO_EMAIL_DOMAIN = 'example.com'

/** A bemutatóhoz használt, ISMERT azonosítójú vásárlói fiók. */
export const DEMO_ACCOUNT_EMAIL = `demo.vasarlo@${DEMO_EMAIL_DOMAIN}`

/** A vásárlások alapértelmezett céltermékének azonosítója (a 79 500 Ft-os kurzus). */
export const DEMO_COURSE_SKU = 'Otthoni KézRehab Program'

/** A kurzus ára, ha a scriptnek KELL létrehoznia (mert még nincs az adatbázisban). */
export const DEMO_COURSE_PRICE_HUF = 79_500

/**
 * Éles publikus hosztok — ezekre mutató `NEXT_PUBLIC_SERVER_URL` mellett a
 * script SOSEM fut le. (A demó-környezet saját aldomaint vagy Railway-címet
 * kap, lásd docs/demo-kornyezet.md.)
 *
 * A definíció a KÖZÖS modulban él (src/lib/security/live-environment.ts), mert
 * a `seed.ts` éles-védelme ugyanezt a listát használja; itt csak
 * továbbexportáljuk, hogy a meglévő importok változatlanul működjenek.
 */
export { PRODUCTION_HOSTS, serverUrlHost }

/** Egy demó-rendelés kimenetele — a bemutatón mindkettőt látni akarjuk. */
export type DemoOrderOutcome = 'paid' | 'payment_failed'

export interface DemoPerson {
  /** Kitalált név (magyar), kizárólag bemutató célra. */
  readonly name: string
  /** `@example.com` cím — sosem valódi postafiók. */
  readonly email: string
  readonly billingZip: string
  readonly billingCity: string
  readonly billingStreet: string
  /** Mi történjen a rendelésével: kifizetve vagy elakadt fizetés. */
  readonly outcome: DemoOrderOutcome
  /**
   * A kurzus-haladás célaránya (0 = el sem kezdte, 1 = végigment). A tényleges
   * lecke-szám a kurzus AKTUÁLIS tananyagából számolódik (`watchedLessonCount`).
   */
  readonly progressRatio: number
}

/**
 * A kitalált szereplők. A haladás szándékosan vegyes (2 × „nem kezdte",
 * 2 × ~30%, 2 × ~70%, 2 × kész), hogy az admin haladás-panelje és a vásárlói
 * Kurzusaim-nézet is életszerű képet mutasson.
 *
 * Minden cím `@example.com`, minden név és cím kitalált — valódi személyre,
 * valódi lakcímre egyik sem utal.
 */
export const DEMO_PEOPLE: readonly DemoPerson[] = [
  {
    name: 'Demó Vásárló',
    email: DEMO_ACCOUNT_EMAIL,
    billingZip: '1011',
    billingCity: 'Budapest',
    billingStreet: 'Minta utca 1.',
    outcome: 'paid',
    progressRatio: 0.7,
  },
  {
    name: 'Kovács Anna',
    email: `kovacs.anna@${DEMO_EMAIL_DOMAIN}`,
    billingZip: '4024',
    billingCity: 'Debrecen',
    billingStreet: 'Példa tér 3.',
    outcome: 'paid',
    progressRatio: 1,
  },
  {
    name: 'Szabó Réka',
    email: `szabo.reka@${DEMO_EMAIL_DOMAIN}`,
    billingZip: '6720',
    billingCity: 'Szeged',
    billingStreet: 'Minta köz 7.',
    outcome: 'paid',
    progressRatio: 0.3,
  },
  {
    name: 'Nagy Eszter',
    email: `nagy.eszter@${DEMO_EMAIL_DOMAIN}`,
    billingZip: '9021',
    billingCity: 'Győr',
    billingStreet: 'Példa sor 12.',
    outcome: 'paid',
    progressRatio: 0,
  },
  {
    name: 'Tóth Márton',
    email: `toth.marton@${DEMO_EMAIL_DOMAIN}`,
    billingZip: '7621',
    billingCity: 'Pécs',
    billingStreet: 'Minta utca 24.',
    outcome: 'paid',
    progressRatio: 0.7,
  },
  {
    name: 'Varga Júlia',
    email: `varga.julia@${DEMO_EMAIL_DOMAIN}`,
    billingZip: '1132',
    billingCity: 'Budapest',
    billingStreet: 'Példa körút 55.',
    outcome: 'paid',
    progressRatio: 1,
  },
  {
    name: 'Kiss Bence',
    email: `kiss.bence@${DEMO_EMAIL_DOMAIN}`,
    billingZip: '8000',
    billingCity: 'Székesfehérvár',
    billingStreet: 'Minta dűlő 2.',
    outcome: 'paid',
    progressRatio: 0.3,
  },
  {
    name: 'Horváth Zsófia',
    email: `horvath.zsofia@${DEMO_EMAIL_DOMAIN}`,
    billingZip: '3300',
    billingCity: 'Eger',
    billingStreet: 'Példa lépcső 9.',
    outcome: 'paid',
    progressRatio: 0,
  },
  {
    // „Elakadt fizetés": a rendelés létrejött, a fizetés nem sikerült — a
    // bemutatón ez mutatja meg, hogy sikertelen fizetésre NINCS hozzáférés.
    name: 'Balogh Péter',
    email: `balogh.peter@${DEMO_EMAIL_DOMAIN}`,
    billingZip: '2400',
    billingCity: 'Dunaújváros',
    billingStreet: 'Minta part 4.',
    outcome: 'payment_failed',
    progressRatio: 0,
  },
]

/** A demó-tananyag egy leckéje (csak akkor jön létre, ha a kurzus üres). */
interface DemoLessonSeed {
  readonly title: string
  readonly summary: string
}

interface DemoModuleSeed {
  readonly title: string
  readonly summary: string
  readonly lessons: readonly DemoLessonSeed[]
}

/**
 * A demó-tananyag: 10 SZÖVEGES lecke, három fejezetben.
 *
 * Miért szövegesek: videó-leckéhez valódi Bunny Stream azonosító kellene
 * (kitalált GUID-dal a lecke nem indulna el, és a `playable` szabály miatt a
 * haladásba sem számítana bele). A szöveges lecke minden környezetben
 * megnyitható és beleszámít a haladásba, tehát a bemutató teljes körben
 * végigjátszható külső szolgáltatás nélkül.
 *
 * A leckeszám (10) szándékosan kerek: a 30% / 70% / 100% célarányból pontosan
 * 3 / 7 / 10 kész lecke lesz.
 */
const DEMO_CURRICULUM: readonly DemoModuleSeed[] = [
  {
    title: '1. Alapok — kezdd biztonságosan',
    summary: 'Bemutató fejezet: mire figyelj az első héten.',
    lessons: [
      { title: 'Üdvözlünk a programban', summary: 'Hogyan épül fel a kurzus.' },
      { title: 'Ismerd meg a kezed', summary: 'Alap fogalmak egyszerűen.' },
      { title: 'Biztonsági alapszabályok', summary: 'Mikor hagyd abba a gyakorlást.' },
    ],
  },
  {
    title: '2. Napi gyakorlatok',
    summary: 'Bemutató fejezet: a napi rutin elemei.',
    lessons: [
      { title: 'Bemelegítés lépésről lépésre', summary: 'Rövid, napi bevezető rutin.' },
      { title: 'Csuklómozgatás', summary: 'A mindennapi mozgástartomány.' },
      { title: 'Ujjgyakorlatok', summary: 'Finommozgás és fogásbiztonság.' },
      { title: 'Alkar és könyök', summary: 'A kéz mögötti lánc.' },
    ],
  },
  {
    title: '3. Fenntartás és megelőzés',
    summary: 'Bemutató fejezet: hogyan tovább a program után.',
    lessons: [
      { title: 'Heti terv összeállítása', summary: 'Mennyit, mikor, hogyan.' },
      { title: 'Munkahelyi tippek', summary: 'Kis változtatások, nagy hatás.' },
      { title: 'Összefoglalás és következő lépések', summary: 'Zárás, továbblépés.' },
    ],
  },
]

/** A demó-leckék szövege — kimondja magáról, hogy bemutató-tartalom. */
const DEMO_LESSON_TEXT =
  'Ez a lecke a BEMUTATÓ környezet kitalált tartalma: a felület működésének ' +
  'megmutatására szolgál, nem szakmai útmutató. Az éles kurzusban itt a valódi ' +
  'videó és a hozzá tartozó leírás áll.'

// ---------------------------------------------------------------------------
// Tiszta (adatbázis nélküli) segédfüggvények — tesztelhetők
// ---------------------------------------------------------------------------

export interface DemoGuardInput {
  /** A `DEMO_MODE` környezeti változó nyers értéke. */
  readonly demoMode: string | undefined
  /** A `NEXT_PUBLIC_SERVER_URL` nyers értéke. */
  readonly serverUrl: string | undefined
}

/**
 * A KÖRNYEZETI kapuk ellenőrzése — a hibák magyar mondatokként, sorrendben.
 *
 * Üres tömb = a környezet demónak tekinthető. A függvény szándékosan tiszta
 * (nincs `process.env`-olvasás benne), hogy a kapuk tesztből is bizonyíthatók
 * legyenek.
 */
export function demoGuardErrors(input: DemoGuardInput): string[] {
  const errors: string[] = []

  if (input.demoMode?.trim() !== '1') {
    errors.push(
      'A demó-feltöltés csak DEMO_MODE=1 mellett futhat. Éles környezetben ezt a ' +
        'változót SOHA ne állítsd be — a script kitalált vevőket és kifizetett ' +
        'rendeléseket ír az adatbázisba.',
    )
  }

  if (isProductionServerUrl(input.serverUrl)) {
    const host = serverUrlHost(input.serverUrl)
    errors.push(
      `A NEXT_PUBLIC_SERVER_URL az ÉLES oldalra mutat (${host}) — a demó-feltöltés ` +
        'ilyen környezetben nem futhat. A demó-környezet saját címet kap ' +
        '(lásd docs/demo-kornyezet.md).',
    )
  }

  return errors
}

/** Demó-címnek számít-e (kizárólag az `@example.com` domain). */
export function isDemoEmail(email: string | null | undefined): boolean {
  return typeof email === 'string' && email.trim().toLowerCase().endsWith(`@${DEMO_EMAIL_DOMAIN}`)
}

/**
 * A demó-rendelések dátumai — az AKTUÁLIS naptári éven belül, egyenletesen
 * szétosztva az évkezdet és a mostani időpont között, növekvő sorrendben.
 *
 * MIÉRT NEM NYÚLNAK VISSZA AZ ELŐZŐ ÉVBE: a rendelésszám formátuma
 * `KH-<év>-<sorszám>` (src/lib/order-number.ts), és a generátor MINDIG az
 * aktuális évet írja bele. Egy tavalyi dátumú, idei sorszámú rendelés
 * önmagának mondana ellent az adminban. Következmény: januári futásnál a
 * szórás értelemszerűen szűk — ez tudatos csere a belső ellentmondás ellen.
 */
export function demoOrderDates(count: number, now: Date): Date[] {
  if (count <= 0) {
    return []
  }
  const yearStart = new Date(now.getFullYear(), 0, 1, 9, 30, 0, 0)
  // Legalább egy nap ablak: az évkezdet napján futtatva sem lehet nulla hosszú.
  const span = Math.max(now.getTime() - yearStart.getTime(), 24 * 60 * 60 * 1000)
  return Array.from({ length: count }, (_, index) => {
    const ratio = (index + 0.5) / count
    return new Date(yearStart.getTime() + Math.round(span * ratio))
  })
}

/**
 * Hány lecke legyen késznek jelölve a célarányból.
 *
 * Kerekítés a legközelebbi egészre, a végeredmény mindig 0 és a leckeszám közé
 * szorítva — így a „kész" (1.0) eset tényleg 100%, a „nem kezdte" (0) pedig
 * tényleg nulla, tetszőleges tananyag-méret mellett is.
 */
export function watchedLessonCount(totalLessons: number, ratio: number): number {
  if (totalLessons <= 0 || ratio <= 0) {
    return 0
  }
  return Math.min(totalLessons, Math.max(0, Math.round(totalLessons * ratio)))
}

/** A demó-fizetés azonosítója — a `DEMO-` előtag az adminban is elárulja magát. */
export function demoPaymentId(orderNumber: string): string {
  return `DEMO-${orderNumber}`
}

/**
 * A demó-fizetés állapotválasza — a rendelés SAJÁT snapshotjából.
 *
 * Ez az az adat, amit éles fizetésnél a Barion GetState ad vissza; a script
 * hálózati hívás helyett a rendelés szerver-oldali igazságából (totalHufSnapshot
 * + currency) állítja elő, hogy az állapotgép összeg-assertje ugyanúgy
 * lefusson, mint élesben.
 */
export function demoPaymentState(order: Order, completedAt: Date): BarionPaymentStateResponse {
  const orderNumber = order.orderNumber ?? `DEMO-${order.id}`
  const paymentId = demoPaymentId(orderNumber)
  const total = order.totalHufSnapshot ?? 0
  const currency = order.currency ?? 'HUF'
  return {
    PaymentId: paymentId,
    PaymentRequestId: orderNumber,
    Status: 'Succeeded',
    CompletedAt: completedAt.toISOString(),
    Total: total,
    Currency: currency,
    Transactions: [
      {
        TransactionId: `${paymentId}-1`,
        POSTransactionId: `${orderNumber}-1`,
        TransactionTime: completedAt.toISOString(),
        Total: total,
        Currency: currency,
        Status: 'Succeeded',
      },
    ],
  }
}

// ---------------------------------------------------------------------------
// Adatbázis-oldali kapuk
// ---------------------------------------------------------------------------

/** Egy lekérdezésben átnézett sorok felső határa a „valódi adat" kapuknál. */
const REAL_DATA_SCAN_LIMIT = 200

/**
 * TARTALMI kapu: valódi (nem demó) vevőt vagy rendelést tartalmaz-e az
 * adatbázis. A `DEMO_MODE` egy rossz környezetbe másolt változó is lehet — ez
 * az ellenőrzés magából az ADATBÓL dönt.
 *
 * Szándékosan NEM vizsgáljuk a staff/owner felhasználók címét: a demó-környezet
 * adminjai valódi címmel lépnek be (a lányok is), az ő jelenlétük tehát nem
 * jelent éles adatbázist.
 */
export async function assertDemoDatabase(payload: Payload): Promise<void> {
  const users = await payload.count({ collection: 'users' })
  if (users.totalDocs === 0) {
    throw new Error(
      'A users kollekció üres: az első létrehozott felhasználó tulajdonosi (owner) ' +
        'szerepkört kapna, demó-vásárlóból pedig sosem lehet tulajdonos. Futtasd előbb ' +
        'a dokumentált, tokenes owner-bootstrapot, majd a `npm run seed`-et, és csak ' +
        'utána a demó-feltöltést.',
    )
  }

  const customers = await payload.find({
    collection: 'users',
    where: { role: { equals: 'customer' } },
    limit: REAL_DATA_SCAN_LIMIT,
    depth: 0,
    overrideAccess: true,
  })
  const realCustomer = customers.docs.find((user) => !isDemoEmail(user.email))
  if (realCustomer !== undefined) {
    throw new Error(
      'Az adatbázisban VALÓDI vásárló van (nem @example.com címmel, ' +
        `felhasználó #${realCustomer.id}) — ez nem demó-adatbázis. A demó-feltöltés ` +
        'elutasítva; használj külön demó-környezetet külön adatbázissal ' +
        '(docs/demo-kornyezet.md).',
    )
  }

  const orders = await payload.find({
    collection: 'orders',
    limit: REAL_DATA_SCAN_LIMIT,
    depth: 0,
    overrideAccess: true,
  })
  const realOrder = orders.docs.find((order) => !isDemoEmail(order.customerEmail))
  if (realOrder !== undefined) {
    throw new Error(
      'Az adatbázisban VALÓDI rendelés van (nem @example.com vevővel, ' +
        `rendelés #${realOrder.id}) — ez nem demó-adatbázis. A demó-feltöltés elutasítva.`,
    )
  }
}

// ---------------------------------------------------------------------------
// Entitás-biztosítók (mind idempotens)
// ---------------------------------------------------------------------------

interface DemoSummary {
  felhasznaloLetrehozva: number
  felhasznaloMegvolt: number
  rendelesLetrehozva: number
  rendelesMegvolt: number
  haladasLetrehozva: number
}

/** A termékkategória (a products-on kötelező mező) — a seed.ts kulcsával. */
async function ensureProductCategoryId(payload: Payload): Promise<number> {
  const slug = 'kezrehabilitacios-kurzusok'
  const existing = await payload.find({
    collection: 'categories',
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  if (existing.docs.length > 0) {
    return existing.docs[0].id
  }
  const created = await payload.create({
    collection: 'categories',
    data: { title: 'Kézrehabilitációs kurzusok', slug, type: 'product' },
    overrideAccess: true,
  })
  log.info('demó: termékkategória létrehozva', { slug, categoryId: created.id })
  return created.id
}

/**
 * A céltermék (kurzus) feloldása sku alapján; ha még nincs, létrehozza.
 *
 * A MEGLÉVŐ terméket a script nem írja át (ár, leírás, státusz mind marad) —
 * az a szerkesztő munkája. Ha a kurzus nem publikált vagy nincs ára, arról
 * hangosan figyelmeztet, mert akkor a storefronton nem látszik.
 */
async function ensureDemoCourse(payload: Payload, sku: string): Promise<Product> {
  const existing = await payload.find({
    collection: 'products',
    where: { sku: { equals: sku } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })

  if (existing.docs.length > 0) {
    const product = existing.docs[0]
    if (product.status !== 'published') {
      log.warn(
        'demó: a céltermék nem publikált — a storefronton nem fog látszani (az adminban állítható át)',
        { productId: product.id, sku, status: product.status ?? null },
      )
    }
    if (product.priceInHUFEnabled !== true || typeof product.priceInHUF !== 'number') {
      log.warn('demó: a célterméknek nincs érvényes ára — a rendelések 0 Ft-osak lesznek', {
        productId: product.id,
        sku,
      })
    }
    return product
  }

  const created = await payload.create({
    collection: 'products',
    data: {
      sku,
      displayTitle: sku,
      shortDescription:
        'Bemutató kurzus a demó-környezethez: a vásárlási és tanulási folyamat végigjátszásához.',
      priceInHUFEnabled: true,
      priceInHUF: DEMO_COURSE_PRICE_HUF,
      category: await ensureProductCategoryId(payload),
      status: 'published',
      _status: 'published',
    },
    overrideAccess: true,
  })
  log.info('demó: céltermék létrehozva (eddig nem létezett)', {
    productId: created.id,
    sku,
    priceInHUF: DEMO_COURSE_PRICE_HUF,
  })
  return created
}

/**
 * Demó-tananyag a kurzusra — KIZÁRÓLAG akkor, ha a kurzuson SEMMILYEN
 * tananyag-szerkezet nincs. Meglévő modult vagy régi videólistát a script SOHA
 * nem ír felül: a haladás ilyenkor a VALÓDI leckékre rögzül.
 *
 * A feltétel szándékosan szigorúbb a „nincs lecke"-nél: egy FÉLKÉSZ, még üres
 * modul-váz is a szerkesztő munkája (`videok-modulba.ts` ugyanezt az elvet
 * követi). A PISZKOZATOT is megnézzük, mert a products collectionön autosave-es
 * draftok élnek: a nem publikált modul-váz a publikált változatból nem látszik,
 * és a script írása kiütné.
 */
async function ensureDemoCurriculum(payload: Payload, product: Product): Promise<Product> {
  const hasStructure = (candidate: Pick<Product, 'modules' | 'videos'>): boolean =>
    (candidate.modules?.length ?? 0) > 0 || (candidate.videos?.length ?? 0) > 0

  if (hasStructure(product)) {
    log.info('demó: a kurzusnak már van tananyag-szerkezete — változatlanul hagyva', {
      productId: product.id,
      leckekSzama: buildCurriculum(product, true).lessons.length,
    })
    return product
  }

  const draft = await payload
    .findByID({
      collection: 'products',
      id: product.id,
      depth: 0,
      overrideAccess: true,
      draft: true,
    })
    .catch(() => null)
  if (draft !== null && hasStructure(draft)) {
    log.warn(
      'demó: a kurzus PISZKOZATÁBAN már van tananyag-szerkezet (nem publikált szerkesztés) — a demó-tananyag kimarad, hogy ne írjuk felül',
      { productId: product.id },
    )
    return product
  }

  await payload.update({
    collection: 'products',
    id: product.id,
    data: {
      modules: DEMO_CURRICULUM.map((modul) => ({
        title: modul.title,
        summary: modul.summary,
        lessons: modul.lessons.map((lesson) => ({
          title: lesson.title,
          kind: 'szoveg' as const,
          summary: lesson.summary,
          content: minimalRichText(DEMO_LESSON_TEXT),
        })),
      })),
    },
    overrideAccess: true,
  })

  const refreshed = await payload.findByID({
    collection: 'products',
    id: product.id,
    depth: 0,
    overrideAccess: true,
  })
  log.info('demó: szöveges demó-tananyag létrehozva a kurzuson', {
    productId: product.id,
    leckekSzama: buildCurriculum(refreshed, true).lessons.length,
  })
  return refreshed
}

/**
 * Demó-vásárló biztosítása. MEGLÉVŐ fiókhoz nem nyúl: sem jelszót, sem nevet,
 * sem számlázási adatot nem ír felül (a bemutató közben átállított adat marad).
 */
async function ensureDemoUser(
  payload: Payload,
  person: DemoPerson,
  password: string,
  summary: DemoSummary,
): Promise<User> {
  const existing = await payload.find({
    collection: 'users',
    where: { email: { equals: person.email } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  if (existing.docs.length > 0) {
    summary.felhasznaloMegvolt += 1
    return existing.docs[0]
  }

  const created = await payload.create({
    collection: 'users',
    data: {
      email: person.email,
      name: person.name,
      // Pontosan a collection alapértelmezése (Users.role defaultValue:
      // 'customer') — kiírva, mert a generált create-adattípus kötelezőnek
      // jelöli. Demó-adatból SOHA nem születik staff/owner fiók.
      role: 'customer',
      password,
      billingName: person.name,
      billingZip: person.billingZip,
      billingCity: person.billingCity,
      billingStreet: person.billingStreet,
    },
    overrideAccess: true,
    depth: 0,
  })
  summary.felhasznaloLetrehozva += 1
  log.info('demó: vásárlói fiók létrehozva', { userId: created.id, nev: person.name })
  return created
}

/** A vevő-snapshot alakja azonos a checkout-éval (src/lib/checkout/start-checkout.ts). */
function demoCustomerSnapshot(person: DemoPerson, userId: number, at: Date): Record<string, unknown> {
  return {
    id: userId,
    email: person.email,
    name: person.name,
    billingName: person.name,
    billingZip: person.billingZip,
    billingCity: person.billingCity,
    billingStreet: person.billingStreet,
    taxNumber: null,
    snapshotAt: at.toISOString(),
    // A demó-jelleg magán a snapshoton is látszik — így egy exportált
    // rendelés-soron sem lehet összekeverni valódi vevőadattal.
    demo: true,
  }
}

/** A vevő + kurzus párhoz tartozó MEGLÉVŐ rendelés (bármely státuszban). */
async function findDemoOrder(
  payload: Payload,
  person: DemoPerson,
  productId: number,
): Promise<Order | null> {
  const result = await payload.find({
    collection: 'orders',
    where: {
      and: [{ customerEmail: { equals: person.email } }, { 'items.product': { equals: productId } }],
    },
    limit: 1,
    depth: 0,
    overrideAccess: true,
    // A where-alak a generált Where-típusnál szűkebben igazolt (a
    // start-checkout.ts duplavásárlás-ellenőrzésének mintája).
  } as unknown as Parameters<Payload['find']>[0])
  return (result.docs[0] as Order | undefined) ?? null
}

/**
 * Demó-rendelés biztosítása a vevőhöz.
 *
 * Az ÚT azonos az élessel: a rendelés `payment_pending` státusszal jön létre
 * (az árat és a rendelésszámot az orders beforeChange-hookja adja), majd
 * `paid`-re KIZÁRÓLAG a saját állapotgép állítja. A `payment_failed`
 * kimenetelnél a rendelés ott marad, ahol az éles checkout is hagyja, ha a
 * fizetésindítás elhasal: fizetésazonosító nélkül, `payment_failed` státuszban.
 *
 * IDEMPOTENCIA + ÖNGYÓGYÍTÁS: ha a vevőnek MÁR VAN rendelése erre a kurzusra,
 * új nem jön létre. A félbeszakadt futás nyomát (paid-re szánt, de
 * payment_pending-ben maradt rendelés) a következő futás fejezi be — így nem
 * keletkezik árva, függő rendelés.
 */
async function ensureDemoOrder(
  payload: Payload,
  input: {
    person: DemoPerson
    user: User
    product: Product
    orderedAt: Date
    summary: DemoSummary
  },
): Promise<void> {
  const { person, user, product, orderedAt, summary } = input

  const existing = await findDemoOrder(payload, person, product.id)
  if (existing !== null) {
    const shouldFinishPaid =
      person.outcome === 'paid' &&
      (existing.status === 'payment_pending' || existing.status === 'created')
    if (!shouldFinishPaid) {
      summary.rendelesMegvolt += 1
      return
    }
    // Félbeszakadt korábbi futás — az állapotgép befejezi az átmenetet.
    log.warn('demó: függőben maradt rendelés befejezése (korábbi futás megszakadt)', {
      orderId: existing.id,
      orderNumber: existing.orderNumber ?? null,
    })
    await transitionDemoOrderToPaid(payload, existing, orderedAt)
    summary.rendelesMegvolt += 1
    return
  }

  const created = (await payload.create({
    collection: 'orders',
    data: {
      customer: user.id,
      customerEmail: person.email,
      // Az élessel azonos kiinduló státusz — a `paid` sosem create-kor dől el.
      status: person.outcome === 'paid' ? 'payment_pending' : 'payment_failed',
      currency: 'HUF',
      items: [{ product: product.id, quantity: 1 }],
      consentWithdrawalWaiver: true,
      consentWithdrawalWaiverAt: orderedAt.toISOString(),
      customerSnapshot: demoCustomerSnapshot(person, user.id, orderedAt),
      // A dátum a bevétel-alakulás miatt VISSZAMENŐLEG állítódik: a Payload a
      // megadott createdAt-ot megtartja (a drizzle upsertRow csak hiányzó
      // értéknél tölti ki a mostani időponttal).
      createdAt: orderedAt.toISOString(),
      updatedAt: orderedAt.toISOString(),
    },
    overrideAccess: true,
    depth: 0,
  })) as Order

  summary.rendelesLetrehozva += 1
  log.info('demó: rendelés létrehozva', {
    orderId: created.id,
    orderNumber: created.orderNumber ?? null,
    status: created.status ?? null,
    totalHuf: created.totalHufSnapshot ?? null,
  })

  if (person.outcome !== 'paid') {
    return
  }

  // A fizetésazonosítók ott kerülnek a rendelésre, ahol élesben is: a fizetés
  // ELINDÍTÁSAKOR, az állapotátmenet előtt.
  const orderNumber = created.orderNumber ?? `DEMO-${created.id}`
  await payload.update({
    collection: 'orders',
    id: created.id,
    data: {
      barionPaymentId: demoPaymentId(orderNumber),
      barionPaymentRequestId: orderNumber,
    },
    overrideAccess: true,
  })

  const withPaymentId = (await payload.findByID({
    collection: 'orders',
    id: created.id,
    depth: 0,
    overrideAccess: true,
  })) as Order
  await transitionDemoOrderToPaid(payload, withPaymentId, orderedAt)
}

/**
 * A `paid` átmenet a SAJÁT állapotgépen keresztül — hálózati hívás nélkül.
 *
 * A `confirmOrder` (plugin) SOSEM hívódik; az átmenetet ugyanaz a modul végzi,
 * amit élesben a Barion-callback és az order-poll job használ. A fizetés utáni
 * mellékhatások (számla, e-mail) SZÁNDÉKOSAN kimaradnak: azokat a hívó indítja,
 * és demóban sem számlát, sem levelet nem küldünk.
 */
async function transitionDemoOrderToPaid(
  payload: Payload,
  order: Order,
  completedAt: Date,
): Promise<void> {
  const state = demoPaymentState(order, completedAt)
  const orderLog: Logger = log.child({
    orderId: order.id,
    orderNumber: order.orderNumber ?? null,
  })
  const result = await applyBarionStateTransition({
    payload,
    order,
    // A leképezést is a valódi függvény végzi ('Succeeded' → 'paid').
    mapped: mapBarionPaymentStatus(state.Status),
    state,
    log: orderLog,
  })
  if (result.action !== 'paid') {
    throw new Error(
      `A demó-rendelés (#${order.id}) nem állt „fizetve" állapotba: ${result.action}` +
        `${result.reason ? ` (${result.reason})` : ''}. A demó-adat így hiányos lenne.`,
    )
  }
}

/**
 * Kurzus-haladás rögzítése a célarány szerint.
 *
 * A sorokat a rendszer írja (`course-progress` create access zárt), ezért
 * `overrideAccess: true` — pontosan úgy, ahogy a mark-watched végpont teszi
 * (src/lib/course-progress/mark-watched.ts). Idempotens: a meglévő
 * (felhasználó + kurzus + lecke-ref) sorokat nem duplikálja.
 */
async function ensureDemoProgress(
  payload: Payload,
  input: {
    user: User
    product: Product
    person: DemoPerson
    orderedAt: Date
    now: Date
    summary: DemoSummary
  },
): Promise<void> {
  const { user, product, person, orderedAt, now, summary } = input

  const lessons = playableLessons(buildCurriculum(product, true))
  const target = watchedLessonCount(lessons.length, person.progressRatio)
  if (target === 0) {
    return
  }

  const existing = await payload.find({
    collection: 'course-progress',
    where: { and: [{ user: { equals: user.id } }, { product: { equals: product.id } }] },
    limit: 500,
    depth: 0,
    overrideAccess: true,
  })
  const alreadyWatched = new Set(existing.docs.map((row) => row.videoRef))

  for (const [index, lesson] of lessons.slice(0, target).entries()) {
    if (alreadyWatched.has(lesson.ref)) {
      continue
    }
    // Életszerű ütem: a vásárlás után háromnaponta egy lecke, de sosem a
    // jövőben (a demó-rendelés dátuma több hónapos is lehet).
    const watchedAt = new Date(
      Math.min(orderedAt.getTime() + (index + 1) * 3 * 24 * 60 * 60 * 1000, now.getTime() - 60_000),
    )
    await payload.create({
      collection: 'course-progress',
      data: {
        user: user.id,
        product: product.id,
        videoRef: lesson.ref,
        watchedAt: watchedAt.toISOString(),
        createdAt: watchedAt.toISOString(),
        updatedAt: watchedAt.toISOString(),
      },
      overrideAccess: true,
    })
    summary.haladasLetrehozva += 1
  }
}

// ---------------------------------------------------------------------------
// Fő folyamat
// ---------------------------------------------------------------------------

/**
 * A hiányzó `DEMO_CUSTOMER_PASSWORD` magyar hibaüzenete. Exportált, hogy a
 * teszt karakter-pontosan rögzíthesse (és hogy sose kerüljön bele érték).
 */
export const MISSING_DEMO_PASSWORD_MESSAGE =
  'A DEMO_CUSTOMER_PASSWORD környezeti változó KÖTELEZŐ: a bemutató fiókjának ' +
  'jelszavát a futtatókörnyezet adja meg, a script nem generál és nem naplóz ' +
  'jelszót. Állítsd be a demó-szolgáltatás Variables felületén (érték a repóba ' +
  'SOHA nem kerül), majd indítsd újra a feltöltést — részletek: docs/demo-kornyezet.md.'

/** Demo jelszó kizárólag DEMO_CUSTOMER_PASSWORD-ből — generált jelszó naplóba kerülne. */
function resolveDemoAccountPassword(): string {
  const provided = process.env.DEMO_CUSTOMER_PASSWORD
  if (typeof provided !== 'string' || provided.trim().length === 0) {
    throw new Error(MISSING_DEMO_PASSWORD_MESSAGE)
  }
  const errors = validatePasswordStrength({ password: provided, email: DEMO_ACCOUNT_EMAIL })
  if (errors.length > 0) {
    throw new Error(
      `A DEMO_CUSTOMER_PASSWORD nem felel meg a jelszó-politikának. ${formatPasswordPolicyErrors(errors)}`,
    )
  }
  return provided
}

export async function demoSeed(): Promise<void> {
  const guardErrors = demoGuardErrors({
    demoMode: process.env.DEMO_MODE,
    serverUrl: process.env.NEXT_PUBLIC_SERVER_URL,
  })
  if (guardErrors.length > 0) {
    throw new Error(`A demó-feltöltés nem futhat le:\n- ${guardErrors.join('\n- ')}`)
  }

  // A jelszó-ellenőrzés MINDEN adatbázis-írás előtt fut le: hiányzó vagy hibás
  // DEMO_CUSTOMER_PASSWORD mellett félkész demó-adat sem keletkezhet.
  const demoAccountPassword = resolveDemoAccountPassword()

  const payload = await getPayload({ config })
  await assertDemoDatabase(payload)

  const sku = process.env.DEMO_COURSE_SKU?.trim() || DEMO_COURSE_SKU
  const baseProduct = await ensureDemoCourse(payload, sku)
  const product = await ensureDemoCurriculum(payload, baseProduct)

  const now = new Date()
  const orderDates = demoOrderDates(DEMO_PEOPLE.length, now)
  const summary: DemoSummary = {
    felhasznaloLetrehozva: 0,
    felhasznaloMegvolt: 0,
    rendelesLetrehozva: 0,
    rendelesMegvolt: 0,
    haladasLetrehozva: 0,
  }

  for (const [index, person] of DEMO_PEOPLE.entries()) {
    const isDemoAccount = person.email === DEMO_ACCOUNT_EMAIL
    const password = isDemoAccount
      ? demoAccountPassword
      : // A többi demó-fiókhoz eldobható, véletlen jelszó tartozik: azokba
        // senki nem lép be, a bemutató a demo-fiókkal megy.
        generateInitialPassword(person.email)

    const userCountBefore = summary.felhasznaloLetrehozva
    const user = await ensureDemoUser(payload, person, password, summary)
    if (isDemoAccount && summary.felhasznaloLetrehozva > userCountBefore) {
      // JELSZÓ SOHA NEM KERÜL A NAPLÓBA — sem kulcson, sem üzenetszövegbe
      // ágyazva (a logger redakciója kulcsnév-alapú, szöveget nem szűr).
      log.info(
        `demó: a bemutató fiókja létrejött — belépés: ${DEMO_ACCOUNT_EMAIL}, ` +
          'a jelszó a DEMO_CUSTOMER_PASSWORD környezeti változó értéke.',
      )
    } else if (isDemoAccount) {
      log.info(
        `demó: a bemutató fiókja már létezett (${DEMO_ACCOUNT_EMAIL}) — a jelszava VÁLTOZATLAN. ` +
          'Ha nem ismered, az adminban állítható át.',
      )
    }

    const orderedAt = orderDates[index]
    await ensureDemoOrder(payload, { person, user, product, orderedAt, summary })
    if (person.outcome === 'paid') {
      await ensureDemoProgress(payload, { user, product, person, orderedAt, now, summary })
    }
  }

  log.info('demó: kész', {
    kurzus: sku,
    productId: product.id,
    felhasznaloLetrehozva: summary.felhasznaloLetrehozva,
    felhasznaloMegvolt: summary.felhasznaloMegvolt,
    rendelesLetrehozva: summary.rendelesLetrehozva,
    rendelesMegvolt: summary.rendelesMegvolt,
    haladasLetrehozva: summary.haladasLetrehozva,
  })
}

/**
 * Indítás-kapu: a feltöltés CSAK közvetlen futtatáskor indul el
 * (`npm run seed:demo`). Importálva — a tiszta segédfüggvények teszteléséhez —
 * a modul mellékhatás nélkül töltődik be, adatbázis-kapcsolat nélkül.
 */
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  demoSeed()
    .then(() => {
      process.exit(0)
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      log.error('demó: a feltöltés sikertelen', { error: message })
      process.exit(1)
    })
}
