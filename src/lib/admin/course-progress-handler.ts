import type { Payload } from 'payload'

import { hasStaffOrOwnerRole } from '../../access/roles'
import { buildCurriculum } from '../curriculum/curriculum'
import { logger } from '../logger'
import { generateRequestId, getRequestId } from '../request-id'
import { trimTruncatedProgress } from '../statistics/progress-truncation'
import { isReadTruncated } from '../statistics/query'
import {
  buildCourseProgressStats,
  type CourseEnrollment,
  type CourseProgressStatRow,
  type CourseProgressStats,
} from './course-progress-stats'

/**
 * GET /api/admin/course-progress?productId=<szám> route-handler factory.
 *
 * Staff/owner RBAC; haladás szerveren, közös `summarizeCurriculum`-mal. Explicit
 * lapozás; haladás `['user','id']` szerint (felhasználó-határon vág, ne hamis
 * százalék). Csonkolást a `meta` és `notice` kimondja. Minden válasz `no-store`.
 */

export interface CourseProgressHandlerDeps {
  getPayload: () => Promise<Payload>
}

/** Egy lapon beolvasott beiratkozott felhasználók száma. */
export const ENROLLMENT_PAGE_SIZE = 200
/** Legfeljebb ennyi beiratkozottat összesítünk egy kérésben. */
export const ENROLLMENT_MAX = 2_000
/** Egy lapon beolvasott haladás-sorok száma. */
export const PROGRESS_PAGE_SIZE = 500
/** Legfeljebb ennyi haladás-sort olvasunk be egy kérésben. */
export const PROGRESS_MAX = 20_000

/**
 * Minden válasz `no-store` — a részletes indoklás a fejkommentben.
 * Ugyanaz a konstans-alak, mint a Videótár-végponton.
 */
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' } as const

/** A lapozott olvasás eredménye — a csonkolás ténye is benne van. */
interface PagedResult<T> {
  docs: T[]
  /** A találatok teljes száma a DB szerint (ha a Payload megadta). */
  totalDocs: number | null
  /** Igaz, ha a felső korlát miatt NEM olvastuk be az összes sort. */
  truncated: boolean
}

/** A Payload find-válaszának minimális alakja, amit a lapozás használ. */
interface FindResultLike<T> {
  docs?: T[] | null
  totalDocs?: number | null
  hasNextPage?: boolean | null
}

/**
 * Lapozott beolvasás felső korláttal.
 *
 * A ciklus akkor áll meg, ha (a) a Payload jelzi, hogy nincs több lap,
 * (b) egy lap az elvártnál kevesebb sort adott (a `hasNextPage` hiányában is
 * megbízható jel), vagy (c) elértük a felső korlátot. A (c) esetben a
 * csonkolás tényét a KÖZÖS `isReadTruncated` dönti el (src/lib/statistics/
 * query.ts) — ugyanaz a szabály, mint a statisztika-lekérdezésben, hogy a két
 * olvasó ne mondhasson mást ugyanarra a helyzetre —, és a hívó ezt KIÍRJA a
 * válaszban.
 */
async function readAllPages<T>(
  fetchPage: (page: number, limit: number) => Promise<FindResultLike<T>>,
  pageSize: number,
  maxDocs: number,
): Promise<PagedResult<T>> {
  const docs: T[] = []
  let totalDocs: number | null = null
  let page = 1

  for (;;) {
    const result = await fetchPage(page, pageSize)
    const pageDocs = Array.isArray(result.docs) ? result.docs : []
    if (typeof result.totalDocs === 'number' && Number.isFinite(result.totalDocs)) {
      totalDocs = result.totalDocs
    }
    docs.push(...pageDocs)

    if (docs.length >= maxDocs) {
      // A korlátot pontosan tartjuk, hogy a válaszban közölt darabszám igaz legyen.
      // Csonkolás CSAK akkor van, ha tényleg maradt beolvasatlan sor: a pontosan
      // a korláttal egyező, teljes halmaz NEM csonkolt (hamis riasztás nélkül).
      return {
        docs: docs.slice(0, maxDocs),
        totalDocs,
        truncated: isReadTruncated({
          totalDocs,
          hasNextPage: result.hasNextPage,
          maxDocs,
          loaded: docs.length,
          pageDocsLength: pageDocs.length,
          pageSize,
        }),
      }
    }
    if (pageDocs.length < pageSize || result.hasNextPage === false) {
      return { docs, totalDocs, truncated: false }
    }
    page += 1
  }
}

/** Csak pozitív egész kurzus-azonosítót fogadunk el (a query-string bármi lehet). */
function parseProductId(raw: string | null): number | null {
  if (raw === null || raw.trim().length === 0) {
    return null
  }
  const value = Number(raw.trim())
  return Number.isInteger(value) && value > 0 ? value : null
}

/** A relationship-érték numerikus azonosítója (nyers id vagy populate-olt doc). */
function relationshipId(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'object' && value !== null) {
    const id = (value as { id?: unknown }).id
    if (typeof id === 'number' && Number.isFinite(id)) {
      return id
    }
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

/** A kurzus emberi neve: a marketingcím, ennek hiányában az sku, végül az azonosító. */
function productLabel(product: { id: number; displayTitle?: unknown; sku?: unknown }): string {
  return (
    trimmedOrNull(product.displayTitle) ?? trimmedOrNull(product.sku) ?? `#${String(product.id)}`
  )
}

/** A válasz `meta` blokkja — a beolvasás mérete és a csonkolás ténye. */
interface CourseProgressMeta {
  generatedAt: string
  enrollments: {
    /** Ennyi diák szerepel az összesítésben (HIÁNYTALAN adattal). */
    returned: number
    total: number | null
    truncated: boolean
    /**
     * Ennyi beiratkozottat SZÁNDÉKOSAN hagytunk ki: a haladás-soraik a
     * beolvasott ablakon kívülre estek volna, tehát csak HAMIS (alulmért)
     * százalékot tudnánk róluk mutatni.
     */
    omitted: number
  }
  progressRows: { returned: number; total: number | null; truncated: boolean }
  /** A kurzus elindítható leckéinek száma — a nevező. */
  totalLessons: number
  /** Igaz, ha a tananyag még a RÉGI, lapos videólistából képződik. */
  legacyCurriculum: boolean
}

export interface CourseProgressResponse extends CourseProgressStats {
  product: { id: number; title: string }
  meta: CourseProgressMeta
  /** Magyar figyelmeztetés, ha az adat csonkolt — különben null. */
  notice: string | null
}

export function createCourseProgressHandler(
  deps: CourseProgressHandlerDeps,
): (request: Request) => Promise<Response> {
  return async function GET(request: Request): Promise<Response> {
    const requestId = getRequestId(request.headers) ?? generateRequestId()
    const log = logger.child({ requestId, route: 'admin-course-progress' })

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
        log.warn('course-progress: jogosulatlan kísérlet (nem staff/owner szerepkör)', {
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

      const productId = parseProductId(new URL(request.url).searchParams.get('productId'))
      if (productId === null) {
        return Response.json(
          { error: 'A kurzus azonosítója hiányzik vagy nem értelmezhető. Nyisd meg újra a kurzus lapját.' },
          { status: 400, headers: NO_STORE_HEADERS },
        )
      }

      // A kurzus tananyaga. depth: 0 elég — a mellékleteket (media-reláció) az
      // összesítés nem használja, viszont a lekérdezés így lényegesen olcsóbb.
      const products = await payload.find({
        collection: 'products',
        where: { id: { equals: productId } },
        limit: 1,
        depth: 0,
        pagination: false,
      })
      const product = products.docs[0]
      if (!product) {
        return Response.json(
          { error: `Nincs ilyen kurzus (azonosító: ${String(productId)}).` },
          { status: 404, headers: NO_STORE_HEADERS },
        )
      }

      // A tananyag a KÖZÖS modellből: `hasAccess: true`, mert az admin-nézet a
      // teljes szerkezetet látja. (A Bunny-GUID így bekerül a modellbe, de a
      // válaszba SOSEM: csak a lecke-címek és a refek mennek ki.)
      const curriculum = buildCurriculum(product, true)

      // „Beiratkozott" = akinek a purchases listája tartalmazza a terméket.
      // Az `id` szerinti rendezés determinisztikus lapozást ad (a createdAt
      // ütközhet, az id nem), így a lapok között nem csúszhat el sor.
      const enrollmentPage = await readAllPages<{
        id: number
        email?: unknown
        name?: unknown
      }>(
        (page, limit) =>
          payload.find({
            collection: 'users',
            where: { purchases: { equals: productId } },
            depth: 0,
            limit,
            page,
            sort: 'id',
          }),
        ENROLLMENT_PAGE_SIZE,
        ENROLLMENT_MAX,
      )

      const enrollments: CourseEnrollment[] = []
      for (const doc of enrollmentPage.docs) {
        const userId = relationshipId(doc)
        if (userId === null) {
          continue
        }
        enrollments.push({
          userId,
          email: trimmedOrNull(doc.email) ?? '',
          name: trimmedOrNull(doc.name),
        })
      }

      // A kurzus MINDEN haladás-sora. Nem szűrünk a beiratkozottak azonosítóira:
      // egy több ezer elemű `in` feltétel drágább lenne, az összesítő pedig
      // amúgy is eldobja a nem beiratkozottak sorait.
      // A rendezés FELHASZNÁLÓ szerint megy (lásd a fejkommentet): így a felső
      // korlát user-határon vág, nem egy diák sorainak a közepén. A másodlagos
      // `id` a lapok közti determinisztikus sorrendhez kell.
      const progressPage = await readAllPages<{
        user?: unknown
        videoRef?: unknown
        watchedAt?: unknown
      }>(
        (page, limit) =>
          payload.find({
            collection: 'course-progress',
            where: { product: { equals: productId } },
            depth: 0,
            limit,
            page,
            sort: ['user', 'id'],
          }),
        PROGRESS_PAGE_SIZE,
        PROGRESS_MAX,
      )

      const nyersProgressRows: CourseProgressStatRow[] = []
      for (const row of progressPage.docs) {
        const userId = relationshipId(row.user)
        const videoRef = trimmedOrNull(row.videoRef)
        if (userId === null || videoRef === null) {
          continue
        }
        nyersProgressRows.push({
          userId,
          videoRef,
          watchedAt: typeof row.watchedAt === 'string' ? row.watchedAt : null,
        })
      }

      /**
       * Csonkolásnál az UTOLSÓ felhasználó sorai félbevághatók, tehát róla csak
       * alulmért — vagyis HAMIS — százalékot tudnánk mutatni. A levágás szabálya
       * a src/lib/statistics/progress-truncation.ts közös moduljában él, hogy a
       * Statisztika nézet Kurzus-hatás táblája ne tudjon tőle elcsúszni
       * (korábban csak itt volt meg, és a másik felület emiatt hamis
       * „nem kezdte el" számot mutatott).
       */
      const teljes = trimTruncatedProgress({
        progressRows: nyersProgressRows,
        enrollments,
        truncated: progressPage.truncated,
      })
      const progressRows = teljes.progressRows
      const teljesEnrollments = teljes.enrollments
      const kihagyottDiakok = teljes.omitted

      const stats = buildCourseProgressStats({
        curriculum,
        enrollments: teljesEnrollments,
        progressRows,
      })

      const truncated = enrollmentPage.truncated || progressPage.truncated
      if (truncated) {
        log.warn('course-progress: a válasz csonkolt (elért felső korlát)', {
          productId,
          enrollmentsReturned: teljesEnrollments.length,
          enrollmentsOmitted: kihagyottDiakok,
          enrollmentsTruncated: enrollmentPage.truncated,
          progressRowsReturned: progressRows.length,
          progressRowsTruncated: progressPage.truncated,
        })
      }

      const response: CourseProgressResponse = {
        ...stats,
        product: { id: product.id, title: productLabel(product) },
        meta: {
          generatedAt: new Date().toISOString(),
          enrollments: {
            returned: teljesEnrollments.length,
            total: enrollmentPage.totalDocs,
            truncated: enrollmentPage.truncated,
            omitted: kihagyottDiakok,
          },
          progressRows: {
            returned: progressRows.length,
            total: progressPage.totalDocs,
            truncated: progressPage.truncated,
          },
          totalLessons: curriculum.lessons.filter((lesson) => lesson.playable).length,
          legacyCurriculum: curriculum.legacy,
        },
        // A szöveg SOSEM hallgatja el a csonkolást, és külön kimondja, ha
        // diákok maradtak ki: a megjelenített számok viszont MINDIG teljesek.
        notice: truncated
          ? `A kurzusnak a megjeleníthetőnél több adata van, ezért a lista csonkolt (legfeljebb ${String(ENROLLMENT_MAX)} hozzáférő és ${String(PROGRESS_MAX)} haladás-sor).${
              kihagyottDiakok > 0
                ? ` ${String(kihagyottDiakok)} hallgató kimaradt a listából, mert róluk csak hiányos, ezért félrevezető haladás látszana.`
                : ''
            } A megjelenített hallgatók adatai teljesek.`
          : null,
      }

      log.info('course-progress: összesítés kiszolgálva', {
        productId,
        enrolled: stats.totals.enrolled,
        started: stats.totals.started,
        completed: stats.totals.completed,
        truncated,
      })

      return Response.json(response, { status: 200, headers: NO_STORE_HEADERS })
    } catch (error) {
      log.error('course-progress: váratlan technikai hiba', {
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
