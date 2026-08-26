import type { Payload } from 'payload'

import { hasStaffOrOwnerRole } from '../../access/roles'
import type { Product } from '../../payload-types'
import { buildCurriculum, type Curriculum } from '../curriculum/curriculum'
import { logger } from '../logger'
import { generateRequestId, getRequestId } from '../request-id'
import { readStatisticsPages } from '../statistics/query'
import {
  buildUserProgressRows,
  trimTruncatedUserProgress,
  type UserProgressSourceRow,
  type UserProgressUserInput,
} from './user-course-progress'
import {
  parseUserIdsParam,
  USER_PROGRESS_MAX_USERS,
  USER_PROGRESS_USERS_PARAM,
  type UserProgressResponse,
} from './user-progress-contract'

/**
 * GET /api/admin/user-progress?users=<id,id,…> route-handler factory.
 *
 * Staff/owner RBAC; haladás szerveren, közös `summarizeCurriculum`-mal. Kötegelt
 * `in` lekérdezések (N+1 elkerülése); explicit lapozás; csonkolásnál inkább hiány,
 * mint hamis százalék. Minden válasz `no-store`. Naplóban nincs név/e-mail.
 */

export interface UserProgressHandlerDeps {
  getPayload: () => Promise<Payload>
}

/**
 * Egy lapon beolvasott felhasználó. A kérés amúgy is legfeljebb
 * `USER_PROGRESS_MAX_USERS` azonosítót enged, tehát ez egyetlen lap — az
 * explicit lapméret viszont itt is kötelező (a gyári 10 csendben csonkolna).
 */
export const USER_PROGRESS_USER_PAGE_SIZE = USER_PROGRESS_MAX_USERS
/** Egy lapon beolvasott kurzus (tananyag). */
export const USER_PROGRESS_PRODUCT_PAGE_SIZE = 100
/**
 * Legfeljebb ennyi KÜLÖNBÖZŐ kurzus tananyagát olvassuk be egy kérésben.
 * A webshop kínálata ennek töredéke; a korlát csak azért van, hogy egy
 * elszabadult lekérdezés se olvashasson korlátlanul.
 */
export const USER_PROGRESS_PRODUCT_MAX = 500
/** Egy lapon beolvasott haladás-sor. */
export const USER_PROGRESS_ROW_PAGE_SIZE = 1_000
/**
 * Legfeljebb ennyi haladás-sort olvasunk be egy kérésben.
 *
 * A legrosszabb reális eset: 100 felhasználó × ~200 megjelölt lecke (öt-hat
 * teljes kurzus fejenként) = 20 000 sor. A plafon tehát a valós terhelés fölött
 * van, vagyis a csonkolás — és a vele járó felhasználó-kihagyás — gyakorlatilag
 * nem fordulhat elő; ha mégis, a válasz inkább hallgat, mint hogy hamis
 * százalékot mutasson.
 */
export const USER_PROGRESS_ROW_MAX = 20_000

/**
 * Minden válasz `no-store` — a részletes indoklás a fejkommentben.
 * Ugyanaz a konstans-alak, mint a Videótár-végponton.
 */
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const

/** A Payload find-válaszának minimális alakja, amit a lapozás használ. */
interface FindResultLike<T> {
  docs?: T[] | null
  totalDocs?: number | null
  hasNextPage?: boolean | null
}

/** A felhasználó-dokumentum azon szelete, amit a lekérdezés KIKÉR. */
interface UserProgressUserDoc {
  id?: unknown
  purchases?: unknown
}

/** A termék-dokumentum azon szelete, amit a lekérdezés KIKÉR. */
interface UserProgressProductDoc {
  id?: unknown
  modules?: Product['modules']
  videos?: Product['videos']
}

/** A haladás-sor azon szelete, amit a lekérdezés KIKÉR. */
interface UserProgressRowDoc {
  user?: unknown
  product?: unknown
  videoRef?: unknown
}

/*
 * A felhasználó-lekérdezés KIZÁRÓLAG a hozzáférés-listát kéri ki (az `id`-t a
 * Payload select-módban mindig adja). A név, az e-mail és a számlázási adat így
 * be sem kerül a memóriába — nem elég, hogy a válaszból kihagyjuk, be sem
 * olvassuk (ugyanaz az elv, mint a statisztika `ENROLLMENT_SELECT`-jénél).
 */
const USER_SELECT = { purchases: true } as const

/* A tananyaghoz a `modules` és a `videos` kell — a marketingszöveg, az ár és a
   képek nem. A kurzus CÍMÉT sem kérjük: a lista cellája a saját
   `purchases` adatából már tudja, melyik kurzus melyik. */
const PRODUCT_SELECT = { modules: true, videos: true } as const

/* A `watchedAt` nem kell: a válasz csak százalékot és állapotot hordoz. */
const PROGRESS_SELECT = { user: true, product: true, videoRef: true } as const

/** Érvényes, véges azonosító (a DB-ből és a JSON-ból is jöhet hibás érték). */
function finiteId(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** A relationship-érték numerikus azonosítója (nyers id vagy populate-olt doc). */
function relationshipId(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'object' && value !== null) {
    return finiteId((value as { id?: unknown }).id)
  }
  return null
}

function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * A `purchases` lista kurzus-azonosítói, duplikátum nélkül.
 *
 * `depth: 0` mellett számok jönnek, de a mező populálva is érkezhet (más
 * hívási úton), ezért a `relationshipId` mindkét alakot kezeli.
 */
function purchasedProductIds(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return []
  }
  const ids: number[] = []
  const seen = new Set<number>()
  for (const entry of value) {
    const productId = relationshipId(entry)
    if (productId === null || seen.has(productId)) {
      continue
    }
    seen.add(productId)
    ids.push(productId)
  }
  return ids
}

export function createUserProgressHandler(
  deps: UserProgressHandlerDeps,
): (request: Request) => Promise<Response> {
  return async function GET(request: Request): Promise<Response> {
    const requestId = getRequestId(request.headers) ?? generateRequestId()
    const log = logger.child({ requestId, route: 'admin-user-progress' })

    try {
      const payload = await deps.getPayload()

      // RBAC: anon → 401; customer → 403; staff/owner mehet tovább.
      const { user } = await payload.auth({ headers: request.headers })
      if (!user) {
        return Response.json(
          { error: 'A kurzus-haladás megtekintéséhez bejelentkezés szükséges.' },
          { status: 401, headers: NO_STORE_HEADERS },
        )
      }
      if (!hasStaffOrOwnerRole(user)) {
        // Csak azonosító és szerepkör megy a naplóba — user-objektum SOHA.
        log.warn('user-progress: jogosulatlan kísérlet (nem staff/owner szerepkör)', {
          userId: user.id,
          role: user.role ?? null,
        })
        return Response.json(
          {
            error:
              'A kurzus-haladás megtekintéséhez munkatársi vagy tulajdonosi jogosultság kell.',
          },
          { status: 403, headers: NO_STORE_HEADERS },
        )
      }

      const userIds = parseUserIdsParam(
        new URL(request.url).searchParams.get(USER_PROGRESS_USERS_PARAM),
      )
      if (userIds.length === 0) {
        return Response.json(
          { error: 'A felhasználó azonosítója hiányzik vagy nem értelmezhető. Frissítsd a listát.' },
          { status: 400, headers: NO_STORE_HEADERS },
        )
      }
      if (userIds.length > USER_PROGRESS_MAX_USERS) {
        // A korlátot KIMONDJUK: a hívó (és a kézzel próbálkozó ember) enélkül
        // csak annyit látna, hogy „nem jó", és nem tudná, mekkora csomagot kérjen.
        return Response.json(
          {
            error: `Egyszerre legfeljebb ${String(USER_PROGRESS_MAX_USERS)} felhasználó haladása kérhető le. Kisebb csomagokban kérd le őket.`,
          },
          { status: 400, headers: NO_STORE_HEADERS },
        )
      }

      // 1) A kért felhasználók hozzáférés-listája — EGY kötegelt lekérdezés.
      //    Az `id` szerinti rendezés determinisztikus lapozást ad, és a válasz
      //    sorrendje is stabil lesz tőle.
      const userPage = await readStatisticsPages<UserProgressUserDoc>(
        (page, limit) =>
          payload.find({
            collection: 'users',
            where: { id: { in: userIds } },
            depth: 0,
            page,
            limit,
            sort: 'id',
            select: USER_SELECT,
          }) as Promise<FindResultLike<UserProgressUserDoc>>,
        USER_PROGRESS_USER_PAGE_SIZE,
        USER_PROGRESS_MAX_USERS,
      )

      const users: UserProgressUserInput[] = []
      const productIdSet = new Set<number>()
      for (const doc of userPage.docs) {
        const userId = finiteId(doc.id)
        if (userId === null) {
          continue
        }
        const productIds = purchasedProductIds(doc.purchases)
        for (const productId of productIds) {
          productIdSet.add(productId)
        }
        users.push({ userId, productIds })
      }

      // Egyetlen kért felhasználónak sincs vásárlása (vagy egyik azonosító sem
      // létezik): nincs mit lekérdezni, a válasz üres kurzus-listákat visz.
      // A további két lekérdezést KIHAGYJUK — üres `in` feltételt sosem küldünk.
      if (productIdSet.size === 0) {
        const response: UserProgressResponse = {
          users: buildUserProgressRows({ users, rows: [], curriculums: new Map() }),
        }
        log.info('user-progress: haladás kiszolgálva (nincs kurzus-hozzáférés)', {
          requestedUsers: userIds.length,
          returnedUsers: response.users.length,
        })
        return Response.json(response, { status: 200, headers: NO_STORE_HEADERS })
      }

      // A kurzus-korlátot a LEKÉRDEZÉS ELŐTT nézzük meg. A `productIdSet` a
      // kért felhasználók `purchases` listáiból gyűlik össze, tehát a mérete
      // NEM következik a felhasználó-korlátból: száz vevő elvileg több ezer
      // különböző kurzust hozhat, és az azonosítók így korlátlanul kerülnének
      // két `in` kifejezésbe. Az utólagos lapozás-plafon
      // (`USER_PROGRESS_PRODUCT_MAX`) ezt már csak a beolvasott sorokra
      // korlátozza — magát a lekérdezést nem.
      if (productIdSet.size > USER_PROGRESS_PRODUCT_MAX) {
        log.warn('user-progress: túl sok különböző kurzus egy kérésben', {
          requestedUsers: userIds.length,
          products: productIdSet.size,
        })
        return Response.json(
          {
            error: `Egyszerre legfeljebb ${String(USER_PROGRESS_PRODUCT_MAX)} különböző kurzus haladása kérhető le, a kért felhasználókhoz ennél több tartozik. Kisebb csomagokban kérd le őket.`,
          },
          { status: 400, headers: NO_STORE_HEADERS },
        )
      }

      const productIds = [...productIdSet].sort((left, right) => left - right)

      // 2) A kurzusok tananyaga — szintén EGY kötegelt lekérdezés.
      //    depth: 0 elég: a mellékletek (media-reláció) a százalékba nem
      //    számítanak, viszont a lekérdezés így lényegesen olcsóbb.
      const productPage = await readStatisticsPages<UserProgressProductDoc>(
        (page, limit) =>
          payload.find({
            collection: 'products',
            where: { id: { in: productIds } },
            depth: 0,
            page,
            limit,
            sort: 'id',
            select: PRODUCT_SELECT,
          }) as Promise<FindResultLike<UserProgressProductDoc>>,
        USER_PROGRESS_PRODUCT_PAGE_SIZE,
        USER_PROGRESS_PRODUCT_MAX,
      )

      const curriculums = new Map<number, Curriculum>()
      for (const doc of productPage.docs) {
        const productId = finiteId(doc.id)
        if (productId === null) {
          continue
        }
        // hasAccess: true — az admin a teljes szerkezetet látja. A Bunny-GUID
        // így bekerül a MODELLBE, a válaszba viszont sosem: onnan csak
        // százalék és állapot megy ki.
        curriculums.set(
          productId,
          buildCurriculum({ modules: doc.modules ?? null, videos: doc.videos ?? null }, true),
        )
      }

      // 3) A haladás-sorok — EGYETLEN lapozott lekérdezés a két `in` feltétellel.
      //    A rendezés FELHASZNÁLÓ szerint megy: így a felső korlát
      //    felhasználó-határon vág, nem valakinek a sorai közepén (a másodlagos
      //    `id` a lapok közti determinisztikus sorrendhez kell).
      const rowPage = await readStatisticsPages<UserProgressRowDoc>(
        (page, limit) =>
          payload.find({
            collection: 'course-progress',
            where: { and: [{ user: { in: userIds } }, { product: { in: productIds } }] },
            depth: 0,
            page,
            limit,
            sort: ['user', 'id'],
            select: PROGRESS_SELECT,
          }) as Promise<FindResultLike<UserProgressRowDoc>>,
        USER_PROGRESS_ROW_PAGE_SIZE,
        USER_PROGRESS_ROW_MAX,
      )

      const rows: UserProgressSourceRow[] = []
      for (const doc of rowPage.docs) {
        const rowUserId = relationshipId(doc.user)
        const rowProductId = relationshipId(doc.product)
        const videoRef = trimmedOrNull(doc.videoRef)
        if (rowUserId === null || rowProductId === null || videoRef === null) {
          continue
        }
        rows.push({ userId: rowUserId, productId: rowProductId, videoRef })
      }

      // Csonkolásnál inkább kihagyunk felhasználót, mint hogy alulmért — vagyis
      // HAMIS — százalékot mutassunk (a szabály a tiszta modulban él).
      const teljes = trimTruncatedUserProgress({ users, rows, truncated: rowPage.truncated })

      const response: UserProgressResponse = {
        users: buildUserProgressRows({ users: teljes.users, rows: teljes.rows, curriculums }),
      }

      if (rowPage.truncated || productPage.truncated) {
        log.warn('user-progress: a beolvasás elérte a felső korlátot', {
          requestedUsers: userIds.length,
          returnedUsers: response.users.length,
          omittedUsers: teljes.omitted,
          progressRowsReturned: teljes.rows.length,
          progressTruncated: rowPage.truncated,
          productsTruncated: productPage.truncated,
        })
      }

      log.info('user-progress: haladás kiszolgálva', {
        requestedUsers: userIds.length,
        returnedUsers: response.users.length,
        products: curriculums.size,
        progressRowsReturned: teljes.rows.length,
      })

      return Response.json(response, { status: 200, headers: NO_STORE_HEADERS })
    } catch (error) {
      log.error('user-progress: váratlan technikai hiba', {
        error: error instanceof Error ? error.message : String(error),
      })
      return Response.json(
        {
          error:
            'A kurzus-haladás most nem kérdezhető le. Próbáld újra néhány perc múlva.',
        },
        { status: 500, headers: NO_STORE_HEADERS },
      )
    }
  }
}
