/**
 * Egyszeri backfill: hiányzó orders.items[].priceHufSnapshot pótlása a rendelés
 * SAJÁT totalHufSnapshot értékéből — SOHA a termék mai árából (docs/ar-snapshot-backfill.md).
 *
 * Alapból próbafutás; íráshoz OWNER_BACKFILL_CONFIRM=igen. Éles futás előtt: npm run backup:db
 *   npm run backfill:ar-snapshot
 *   OWNER_BACKFILL_CONFIRM=igen npm run backfill:ar-snapshot
 *
 * Csak hiányzó árat tölt; csak paid rendelések. A teljes items tömb íródik vissza (drizzle).
 */

import { pathToFileURL } from 'node:url'

import { getPayload, type Payload } from 'payload'

import { createLogger, type Logger } from '../lib/logger'
// A lapozó-segéd a statisztika-lekérdezésből jön (felső korlátos, csonkolást
// jelző beolvasás). Szándékosan NEM másoljuk le: egy második, önálló
// lapozó-implementáció külön karbantartandó hibaforrás lenne.
import { readStatisticsPages } from '../lib/statistics/query'
import config from '../payload.config'
import type { Order } from '../payload-types'

/** Egy lapon beolvasott rendelés. */
export const BACKFILL_LAPMERET = 200
/** Legfeljebb ennyi rendelést dolgozunk fel egy futásban (nincs `limit: 0`). */
export const BACKFILL_RENDELES_MAX = 20_000

/**
 * Determinisztikus rendezés a lapozáshoz: az `id` egyedi (elsődleges kulcs),
 * és a script nem módosítja — a lapok határa így akkor sem csúszik el, ha
 * közben írunk. (A `-createdAt` itt rossz választás lenne: azonos időbélyegű
 * rendeléseknél tiebreaker nélkül sorok eshetnének ki a feldolgozásból.)
 */
const BACKFILL_SORT = 'id'

/**
 * Csak a szükséges mezők. A tulajdonos-only mezőket (`refunds`,
 * `customerSnapshot`, `ipAddress`, `invoiceNumber`, `barionPaymentId`) NEM
 * kérjük le — ugyanaz a szemlélet, mint a statisztika-lekérdezésben.
 */
const BACKFILL_SELECT = {
  orderNumber: true,
  status: true,
  totalHufSnapshot: true,
  items: true,
} as const

/** Csak paid rendelések — a bevétel-riport is csak ezeket számolja. */
const BACKFILL_WHERE = { status: { equals: 'paid' } } as const

/** A rendelés `items` tömbjének egy sora (a generált Payload-típusból). */
export type RendelesTetel = NonNullable<Order['items']>[number]

/** Egy rendelés-tétel azon szelete, amiből a kiosztás dolgozik. */
export interface BackfillTetel {
  readonly priceHufSnapshot?: number | null
  readonly quantity?: number | null
}

/** Egy rendelés azon szelete, amiből a kiosztás dolgozik. */
export interface BackfillRendeles {
  readonly totalHufSnapshot?: number | null
  readonly items?: readonly BackfillTetel[] | null
}

/** Miért maradt ki egy rendelés — a jelentés ezekre bontva sorol fel. */
export type KihagyasIndok =
  | 'nincs-tetel'
  | 'hianyzo-vegosszeg'
  | 'tobb-hianyzo-ar'
  | 'nem-pozitiv-maradek'
  | 'nem-egesz-egysegar'
  | 'ervenytelen-mennyiseg'
  | 'ervenytelen-ar'

/** A kihagyás-indokok magyar magyarázata — ezt olvassa az üzemeltető. */
export const KIHAGYAS_SZOVEG: Readonly<Record<KihagyasIndok, string>> = {
  'nincs-tetel':
    'a rendelésnek van végösszege, de EGYETLEN tétele sincs — kurzus-bontás ebből nem építhető, kézi rendezés kell',
  'hianyzo-vegosszeg':
    'a rendelés „Végösszeg a megrendeléskor” (totalHufSnapshot) mezője hiányzik vagy nem pozitív — nincs miből számolni',
  'tobb-hianyzo-ar':
    'egynél több tételnél hiányzik az ár — a végösszeg szétosztása kitalált adat lenne',
  'nem-pozitiv-maradek':
    'a végösszegből a többi tétel levonása után nulla vagy negatív maradék jön ki — a rendelés adatai ellentmondanak egymásnak',
  'nem-egesz-egysegar':
    'a maradék nem osztható a tétel mennyiségével egész forintra — a script nem kerekít',
  'ervenytelen-mennyiseg':
    'valamelyik tétel mennyisége nem pozitív egész — az ilyen sort tartalmazó tömb visszaírása a mező min:1 validációján bukna, a „javítása” pedig kitalált adat lenne',
  'ervenytelen-ar': 'valamelyik meglévő tételár negatív — a maradék-számítás így nem megbízható',
}

/** Egy tétel beírandó ára. */
export interface ArIras {
  readonly index: number
  readonly priceHuf: number
}

/** Egy tétel beírandó mennyisége. */
export interface MennyisegIras {
  readonly index: number
  readonly quantity: number
}

/** A kiosztó függvény döntése egy rendelésre. */
export type Kiosztas =
  | { readonly dontes: 'nincs-teendo' }
  | {
      readonly dontes: 'ir'
      readonly arak: readonly ArIras[]
      readonly mennyisegek: readonly MennyisegIras[]
    }
  | { readonly dontes: 'kihagy'; readonly indok: KihagyasIndok; readonly reszlet: string }

/**
 * Hiányzik-e az ár. A 0 ÉRVÉNYES ár (ingyenes kurzus), tehát nem hiányzik —
 * meglévő értéket a script sosem ír felül.
 */
export function hianyzikAzAr(ertek: unknown): boolean {
  return typeof ertek !== 'number' || !Number.isFinite(ertek)
}

/** A mennyiség-mező állapota: hiányzik, érvényes, vagy jelen van, de hibás. */
export function mennyisegAllapota(ertek: unknown): 'hianyzik' | 'ervenyes' | 'ervenytelen' {
  if (ertek === null || ertek === undefined) {
    return 'hianyzik'
  }
  if (typeof ertek === 'number' && Number.isFinite(ertek) && ertek > 0 && Number.isInteger(ertek)) {
    return 'ervenyes'
  }
  return 'ervenytelen'
}

/**
 * Mennyiség a SZÁMÍTÁSHOZ — hiányzó/érvénytelen érték = 1 db, pontosan úgy,
 * ahogy a `totalHufSnapshot` is képződött (src/lib/order-integrity.ts).
 */
export function mennyisegSzamitashoz(ertek: unknown): number {
  return typeof ertek === 'number' && Number.isFinite(ertek) && ertek > 0 ? ertek : 1
}

/** Emberi olvasásra formázott mezőérték a kihagyás-indokláshoz. */
function ertekLeirasa(ertek: unknown): string {
  if (ertek === null) {
    return 'null'
  }
  if (ertek === undefined) {
    return 'hiányzik'
  }
  return String(ertek)
}

/**
 * Hiányzó ár kiosztása totalHufSnapshot-ból. Egy hiányzó tételnél oszt; többnél kihagyás.
 * Nem kerekít; mai termékár TILOS forrás.
 */
export function kiosztHianyzoArakat(rendeles: BackfillRendeles): Kiosztas {
  const tetelek = Array.isArray(rendeles.items) ? rendeles.items : []
  const vegosszeg = rendeles.totalHufSnapshot
  const vanErvenyesVegosszeg =
    typeof vegosszeg === 'number' && Number.isFinite(vegosszeg) && vegosszeg > 0

  if (tetelek.length === 0) {
    if (vanErvenyesVegosszeg) {
      return {
        dontes: 'kihagy',
        indok: 'nincs-tetel',
        reszlet: `végösszeg: ${vegosszeg} Ft, tételek száma: 0`,
      }
    }
    return { dontes: 'nincs-teendo' }
  }

  const hianyzoArIndexek: number[] = []
  const negativArIndexek: number[] = []
  const hianyzoMennyisegIndexek: number[] = []
  const ervenytelenMennyisegIndexek: number[] = []

  tetelek.forEach((tetel, index) => {
    const ar = tetel.priceHufSnapshot
    if (hianyzikAzAr(ar)) {
      hianyzoArIndexek.push(index)
    } else if (typeof ar === 'number' && ar < 0) {
      negativArIndexek.push(index)
    }
    const allapot = mennyisegAllapota(tetel.quantity)
    if (allapot === 'hianyzik') {
      hianyzoMennyisegIndexek.push(index)
    } else if (allapot === 'ervenytelen') {
      ervenytelenMennyisegIndexek.push(index)
    }
  })

  if (hianyzoArIndexek.length === 0 && hianyzoMennyisegIndexek.length === 0) {
    return { dontes: 'nincs-teendo' }
  }

  // Innentől ÍRNI szeretnénk, tehát a teljes tömbnek visszaírhatónak kell
  // lennie — a hibás sorokat előbb ember rendezi.
  if (ervenytelenMennyisegIndexek.length > 0) {
    return {
      dontes: 'kihagy',
      indok: 'ervenytelen-mennyiseg',
      reszlet: `érintett tétel(ek): ${ervenytelenMennyisegIndexek
        .map((index) => `#${index + 1} (${ertekLeirasa(tetelek[index].quantity)})`)
        .join(', ')}`,
    }
  }
  if (negativArIndexek.length > 0) {
    return {
      dontes: 'kihagy',
      indok: 'ervenytelen-ar',
      reszlet: `érintett tétel(ek): ${negativArIndexek
        .map((index) => `#${index + 1} (${ertekLeirasa(tetelek[index].priceHufSnapshot)} Ft)`)
        .join(', ')}`,
    }
  }

  const mennyisegek: MennyisegIras[] = hianyzoMennyisegIndexek.map((index) => ({
    index,
    quantity: 1,
  }))

  if (hianyzoArIndexek.length === 0) {
    return { dontes: 'ir', arak: [], mennyisegek }
  }
  if (hianyzoArIndexek.length > 1) {
    return {
      dontes: 'kihagy',
      indok: 'tobb-hianyzo-ar',
      reszlet: `${hianyzoArIndexek.length} tételnél hiányzik az ár (${hianyzoArIndexek
        .map((index) => `#${index + 1}`)
        .join(', ')}), a tételek száma: ${tetelek.length}`,
    }
  }
  if (!vanErvenyesVegosszeg) {
    return {
      dontes: 'kihagy',
      indok: 'hianyzo-vegosszeg',
      reszlet: `totalHufSnapshot: ${ertekLeirasa(vegosszeg)}`,
    }
  }

  const hianyzoIndex = hianyzoArIndexek[0]
  let tobbiOsszege = 0
  tetelek.forEach((tetel, index) => {
    if (index === hianyzoIndex) {
      return
    }
    // A `hianyzikAzAr` szűrés után itt biztosan véges szám áll.
    const ar = typeof tetel.priceHufSnapshot === 'number' ? tetel.priceHufSnapshot : 0
    tobbiOsszege += ar * mennyisegSzamitashoz(tetel.quantity)
  })

  const maradek = vegosszeg - tobbiOsszege
  if (maradek <= 0) {
    return {
      dontes: 'kihagy',
      indok: 'nem-pozitiv-maradek',
      reszlet: `maradék: ${maradek} Ft (végösszeg ${vegosszeg} Ft − a többi tétel ${tobbiOsszege} Ft)`,
    }
  }

  const mennyiseg = mennyisegSzamitashoz(tetelek[hianyzoIndex].quantity)
  const egysegar = maradek / mennyiseg
  if (!Number.isInteger(egysegar)) {
    return {
      dontes: 'kihagy',
      indok: 'nem-egesz-egysegar',
      reszlet: `${maradek} Ft / ${mennyiseg} db = ${egysegar} — nem egész forint`,
    }
  }

  return { dontes: 'ir', arak: [{ index: hianyzoIndex, priceHuf: egysegar }], mennyisegek }
}

/**
 * A visszaírandó, TELJES `items` tömb felépítése — tiszta függvény.
 *
 * Minden meglévő sor változatlanul megy tovább (`...tetel`: azonosító,
 * termék-hivatkozás, `titleSnapshot`), és kizárólag a kiosztás által
 * megnevezett mezők kapnak új értéket. A teljes tömb azért kell, mert a
 * drizzle-adapter update-kor törli és újra beszúrja a tömb sorait (lásd a
 * modul fejlécének 5. pontját).
 */
export function epitsdVisszairandoTeteleket(
  tetelek: readonly RendelesTetel[],
  kiosztas: Extract<Kiosztas, { dontes: 'ir' }>,
): RendelesTetel[] {
  const arIndexek = new Map(kiosztas.arak.map((iras) => [iras.index, iras.priceHuf]))
  const mennyisegIndexek = new Map(kiosztas.mennyisegek.map((iras) => [iras.index, iras.quantity]))
  return tetelek.map((tetel, index) => {
    const ujAr = arIndexek.get(index)
    const ujMennyiseg = mennyisegIndexek.get(index)
    return {
      ...tetel,
      ...(ujAr === undefined ? {} : { priceHufSnapshot: ujAr }),
      ...(ujMennyiseg === undefined ? {} : { quantity: ujMennyiseg }),
    }
  })
}

/** Egy kihagyott rendelés a jelentésben. */
export interface KihagyottRendeles {
  readonly azonosito: string
  readonly status: string | null
  readonly indok: KihagyasIndok
  readonly reszlet: string
}

/** Egy sikertelen írás a jelentésben. */
export interface IrasHiba {
  readonly azonosito: string
  readonly hiba: string
}

/** A futás összegzése — a jelentés ebből formázódik. */
export interface BackfillJelentes {
  readonly dryRun: boolean
  readonly megnezettRendelesek: number
  readonly felsoKorlat: number
  readonly csonkolt: boolean
  readonly erintettRendelesek: number
  readonly arIrasok: number
  readonly mennyisegIrasok: number
  readonly nincsTeendo: number
  readonly kihagyottak: readonly KihagyottRendeles[]
  readonly irasHibak: readonly IrasHiba[]
}

/** Ember által olvasható rendelés-azonosító: a rendelésszám, ha van; különben `#id`. */
export function rendelesAzonosito(id: number | string, orderNumber: unknown): string {
  return typeof orderNumber === 'string' && orderNumber.trim().length > 0
    ? orderNumber.trim()
    : `#${id}`
}

/**
 * A JELENTÉS magyar sorai — tiszta függvény, hogy tesztelhető legyen.
 *
 * A kihagyottak listája a lényeg: azokat ember nézi meg. Ezért indokonként
 * csoportosítva, a rendelés-azonosítókkal és a konkrét számokkal íródnak ki.
 */
export function formazdJelentest(jelentes: BackfillJelentes): string[] {
  const sorok: string[] = []
  const mod = jelentes.dryRun ? 'PRÓBAFUTÁS' : 'ÉLES FUTÁS'

  sorok.push(`Ár-snapshot backfill — ${mod} összesítése`)
  sorok.push(
    `Megnézett rendelés: ${jelentes.megnezettRendelesek} db (felső korlát: ${jelentes.felsoKorlat}).`,
  )
  if (jelentes.csonkolt) {
    sorok.push(
      `FIGYELEM — CSONKOLT BEOLVASÁS: a rendelések száma elérte a ${jelentes.felsoKorlat}-es felső korlátot, tehát NEM néztünk meg minden rendelést. Futtasd újra magasabb korláttal: --max=<szám>.`,
    )
  }

  const ige = jelentes.dryRun ? 'ÍRNA' : 'ÍRT'
  sorok.push(
    `${ige}: ${jelentes.erintettRendelesek} rendelés — ${jelentes.arIrasok} tétel-ár és ${jelentes.mennyisegIrasok} mennyiség.`,
  )
  sorok.push(`Nincs teendő: ${jelentes.nincsTeendo} rendelés (már teljes az adata).`)
  sorok.push(`Kihagyva: ${jelentes.kihagyottak.length} rendelés.`)

  if (jelentes.kihagyottak.length > 0) {
    sorok.push('A kihagyott rendelések — ezeket EMBERNEK kell megnéznie:')
    const indokok = new Set(jelentes.kihagyottak.map((elem) => elem.indok))
    for (const indok of indokok) {
      const csoport = jelentes.kihagyottak.filter((elem) => elem.indok === indok)
      sorok.push(`  • ${indok} (${csoport.length} db) — ${KIHAGYAS_SZOVEG[indok]}`)
      for (const elem of csoport) {
        sorok.push(
          `      ${elem.azonosito} [státusz: ${elem.status ?? 'ismeretlen'}] — ${elem.reszlet}`,
        )
      }
    }
  }

  if (jelentes.irasHibak.length > 0) {
    sorok.push(`ÍRÁSI HIBA: ${jelentes.irasHibak.length} rendelés nem íródott be.`)
    for (const hiba of jelentes.irasHibak) {
      sorok.push(`      ${hiba.azonosito} — ${hiba.hiba}`)
    }
  }

  if (jelentes.dryRun) {
    sorok.push(
      'PRÓBAFUTÁS: az adatbázisba SEMMI nem íródott. Tényleges futtatás (előtte KÖTELEZŐ `npm run backup:db`): OWNER_BACKFILL_CONFIRM=igen npm run backfill:ar-snapshot',
    )
  }

  return sorok
}

/** A beolvasott rendelés-dokumentum alakja (a `BACKFILL_SELECT` szerint). */
export interface BackfillOrderDoc {
  readonly id: number
  readonly orderNumber?: string | null
  readonly status?: string | null
  readonly totalHufSnapshot?: number | null
  readonly items?: readonly RendelesTetel[] | null
}

/** A futtatás injektált függőségei — teszthez mockolható. */
export interface BackfillFuggosegek {
  readonly payload: Pick<Payload, 'find' | 'update'>
  readonly dryRun: boolean
  readonly max?: number
  readonly lapmeret?: number
  readonly log?: Pick<Logger, 'info' | 'warn' | 'error'>
}

const NEMA_NAPLO: Pick<Logger, 'info' | 'warn' | 'error'> = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

/**
 * A backfill VEZÉRLÉSE: beolvasás lapozva, kiosztás rendelésenként, majd —
 * kizárólag ÉLES futásban — írás.
 *
 * A próbafutás kapuja EGYETLEN helyen zár: az írás előtti `if (dryRun)`.
 * Ezt a kaput teszt méri (a mockolt `payload.update` hívásszáma próbafutásban
 * pontosan 0).
 */
export async function futtatBackfill(fuggosegek: BackfillFuggosegek): Promise<BackfillJelentes> {
  const log = fuggosegek.log ?? NEMA_NAPLO
  const max = fuggosegek.max ?? BACKFILL_RENDELES_MAX
  const lapmeret = fuggosegek.lapmeret ?? BACKFILL_LAPMERET

  const { docs, truncated } = await readStatisticsPages<BackfillOrderDoc>(
    async (page, limit) =>
      (await fuggosegek.payload.find({
        collection: 'orders',
        where: BACKFILL_WHERE,
        depth: 0,
        page,
        limit,
        sort: BACKFILL_SORT,
        select: BACKFILL_SELECT,
        overrideAccess: true,
      })) as unknown as {
        docs?: BackfillOrderDoc[] | null
        hasNextPage?: boolean | null
        totalDocs?: number | null
      },
    lapmeret,
    max,
  )

  const kihagyottak: KihagyottRendeles[] = []
  const irasHibak: IrasHiba[] = []
  let erintettRendelesek = 0
  let arIrasok = 0
  let mennyisegIrasok = 0
  let nincsTeendo = 0

  for (const doc of docs) {
    const azonosito = rendelesAzonosito(doc.id, doc.orderNumber)
    const kiosztas = kiosztHianyzoArakat({
      totalHufSnapshot: doc.totalHufSnapshot ?? null,
      items: doc.items ?? null,
    })

    if (kiosztas.dontes === 'nincs-teendo') {
      nincsTeendo += 1
      continue
    }
    if (kiosztas.dontes === 'kihagy') {
      kihagyottak.push({
        azonosito,
        status: typeof doc.status === 'string' ? doc.status : null,
        indok: kiosztas.indok,
        reszlet: kiosztas.reszlet,
      })
      continue
    }

    const tetelek = Array.isArray(doc.items) ? doc.items : []
    const ujTetelek = epitsdVisszairandoTeteleket(tetelek, kiosztas)

    erintettRendelesek += 1
    arIrasok += kiosztas.arak.length
    mennyisegIrasok += kiosztas.mennyisegek.length

    const leiras = [
      ...kiosztas.arak.map((iras) => `#${iras.index + 1}. tétel ára ${iras.priceHuf} Ft`),
      ...kiosztas.mennyisegek.map(
        (iras) => `#${iras.index + 1}. tétel mennyisége ${iras.quantity}`,
      ),
    ].join('; ')

    if (fuggosegek.dryRun) {
      log.info(`Ár-snapshot backfill — ÍRNA: ${azonosito} → ${leiras}`)
      continue
    }

    try {
      await fuggosegek.payload.update({
        collection: 'orders',
        id: doc.id,
        depth: 0,
        overrideAccess: true,
        data: { items: ujTetelek },
      })
      log.info(`Ár-snapshot backfill — ÍRVA: ${azonosito} → ${leiras}`)
    } catch (error: unknown) {
      erintettRendelesek -= 1
      arIrasok -= kiosztas.arak.length
      mennyisegIrasok -= kiosztas.mennyisegek.length
      const uzenet = error instanceof Error ? error.message : String(error)
      irasHibak.push({ azonosito, hiba: uzenet })
      log.error(`Ár-snapshot backfill — ÍRÁSI HIBA: ${azonosito}`, { hiba: uzenet })
    }
  }

  return {
    dryRun: fuggosegek.dryRun,
    megnezettRendelesek: docs.length,
    felsoKorlat: max,
    csonkolt: truncated,
    erintettRendelesek,
    arIrasok,
    mennyisegIrasok,
    nincsTeendo,
    kihagyottak,
    irasHibak,
  }
}

/** A kapu: kizárólag a pontos „igen” érték nyitja (apply-owner-content.ts mintája). */
const kapuNyitva = (nev: string): boolean => process.env[nev]?.trim().toLowerCase() === 'igen'

/** A `--max=<szám>` kapcsoló feldolgozása; hibás vagy hiányzó értéknél az alapérték. */
export function parseMaxKapcsolo(argv: readonly string[], alapertek: number): number {
  const talalat = argv.find((arg) => arg.startsWith('--max='))
  if (talalat === undefined) {
    return alapertek
  }
  const nyers = talalat.slice('--max='.length).trim()
  if (!/^\d+$/.test(nyers)) {
    return alapertek
  }
  const ertek = Number(nyers)
  return Number.isSafeInteger(ertek) && ertek > 0 ? ertek : alapertek
}

const log = createLogger({ script: 'backfill-price-snapshot' })

async function futtat(): Promise<void> {
  const dryRun = !kapuNyitva('OWNER_BACKFILL_CONFIRM')
  const max = parseMaxKapcsolo(process.argv.slice(2), BACKFILL_RENDELES_MAX)

  log.info(
    dryRun
      ? 'Ár-snapshot backfill: PRÓBAFUTÁS indul (OWNER_BACKFILL_CONFIRM=igen nélkül semmi nem íródik).'
      : 'Ár-snapshot backfill: ÉLES futás indul (OWNER_BACKFILL_CONFIRM=igen). Remélem, futott előtte `npm run backup:db`.',
  )

  const payload = await getPayload({ config })
  const jelentes = await futtatBackfill({ payload, dryRun, max, log })

  for (const sor of formazdJelentest(jelentes)) {
    log.info(sor)
  }

  if (jelentes.irasHibak.length > 0 || jelentes.csonkolt) {
    process.exitCode = 1
    return
  }
  if (!dryRun) {
    log.info('OWNER_BACKFILL_OK')
  }
}

// A modul mellékhatás nélkül importálható (a tiszta függvények és a vezérlés
// így tesztelhetők); a futtatás csak közvetlen indításkor indul el.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  futtat()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((error: unknown) => {
      log.error('Ár-snapshot backfill: hiba történt.', {
        error: error instanceof Error ? error.message : String(error),
      })
      process.exit(1)
    })
}
