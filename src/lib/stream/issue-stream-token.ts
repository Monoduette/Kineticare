import type { Payload } from 'payload'

import { accessExpiredMessage } from '../course-access'
import { resolveSingleCourseAccess } from '../course-access-lookup'
import {
  buildCurriculum,
  findLessonByRefOrAsset,
  firstPlayableVideoLesson,
  type CurriculumLesson,
} from '../curriculum/curriculum'
import type { Product, User } from '../../payload-types'
import { logger as rootLogger, type Logger } from '../logger'
import type { StreamTokenResponseBody } from './contract'
import { createStreamPlaybackToken } from './token'

/**
 * GET /api/stream-token üzleti logika: purchases paywall, lejárt hozzáférés 403,
 * hiányzó BUNNY_STREAM_TOKEN_AUTH_KEY → 503 (lazy env).
 */

/** Üzleti hiba HTTP-státusszal és magyar felhasználói üzenettel. */
export class StreamTokenError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'StreamTokenError'
    this.status = status
  }
}

export interface StreamTokenServiceInput {
  payload: Payload
  user: User
  /** A kérés productId query-paramétere (nyers, validálatlan). */
  productId: unknown
  /** Opcionális videó-azonosító a terméken belül (streamAssetId vagy sor-id). */
  videoId?: unknown
  /** RequestId-vel kötött logger (opcionális; alapértelmezés a root logger). */
  logger?: Logger
}

/**
 * A szolgáltatás eredménye AZONOS a végpont válasz-törzsével — a típus a
 * közös szerződés-modulból jön, így a kliens és a szerver nem tudnak
 * észrevétlenül eltérni egymástól (`expiresAt` ISO-8601, nem szám).
 */
export type StreamTokenServiceResult = StreamTokenResponseBody

/** Egységes 403-as üzenet — nem árulja el, hogy létezik-e a termék/videó. */
const FORBIDDEN_MESSAGE = 'A videó megtekintéséhez a kurzus megvásárlása szükséges.'

/** Egységes 503-as üzenet — a BUNNY_STREAM_* konfiguráció/adat hibáira. */
const UNAVAILABLE_MESSAGE =
  'A videólejátszás ideiglenesen nem érhető el. Próbáld újra néhány perc múlva.'

function parseProductId(raw: unknown): number {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) {
    return raw
  }
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
    const parsed = Number(raw.trim())
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed
    }
  }
  throw new StreamTokenError(
    400,
    'A kurzus azonosítója hiányzik vagy nem értelmezhető. Frissítsd az oldalt, és indítsd újra a videót.',
  )
}

/** A users.purchases relationship eleme lehet id (number) vagy populate-olt Product. */
function hasPurchased(user: User, productId: number): boolean {
  const purchases = Array.isArray(user.purchases) ? user.purchases : []
  return purchases.some((entry) => {
    if (typeof entry === 'number') {
      return entry === productId
    }
    return (
      typeof entry === 'object' &&
      entry !== null &&
      typeof entry.id === 'number' &&
      entry.id === productId
    )
  })
}

/**
 * Lecke kiválasztása a termék TANANYAGÁBÓL (modulok → leckék, vagy a régi,
 * lapos videólista — a döntést a src/lib/curriculum/curriculum.ts hozza meg,
 * ugyanaz a modul, amit a lejátszó felülete is használ). Így a jegykiadás és a
 * megjelenített tananyag nem tudhatja máshogy, mi a kurzus tartalma.
 *
 * videoId-val a STABIL azonosító szerinti egyezés (a sor `id` mezője VAGY a
 * streamAssetId) — sorszám szándékosan nem fogadható el, mert a lejátszható
 * leckék számozása a feldolgozási állapottól függően elcsúszik.
 *
 * videoId nélkül az első lejátszható VIDEÓ-lecke, végső soron az első lecke —
 * hogy a csak feldolgozás alatti videót tartalmazó kurzus a beszédesebb 409-et
 * kapja a 404 helyett.
 */
function selectLesson(product: Product, videoId: string | undefined): CurriculumLesson {
  // A szerver-oldali kiválasztás mindig teljes adattal dolgozik: a hozzáférést
  // a hívó már ellenőrizte (1., 3. és 3/b lépés), a GUID-elrejtés csak a
  // KLIENSNEK szánt modellre vonatkozik.
  const curriculum = buildCurriculum(product, true)
  if (videoId !== undefined) {
    const match = findLessonByRefOrAsset(curriculum, videoId)
    if (!match) {
      throw new StreamTokenError(404, 'A kért videó nem található.')
    }
    return match
  }
  const first = firstPlayableVideoLesson(curriculum) ?? curriculum.lessons[0]
  if (!first) {
    throw new StreamTokenError(404, 'A kurzushoz nem tartozik lejátszható videó.')
  }
  return first
}

/** Kérés-idejű (lazy) ENV-ellenőrzés — NEM induláskori assert (lásd src/env.ts megjegyzés). */
function requireTokenAuthKey(log: Logger): string {
  const key = process.env.BUNNY_STREAM_TOKEN_AUTH_KEY
  if (typeof key !== 'string' || key.trim().length === 0) {
    log.error(
      'stream-token: hiányzik a BUNNY_STREAM_TOKEN_AUTH_KEY — a videólejátszás nem elérhető',
    )
    throw new StreamTokenError(503, UNAVAILABLE_MESSAGE)
  }
  return key
}

export async function issueStreamToken(
  input: StreamTokenServiceInput,
): Promise<StreamTokenServiceResult> {
  const log = input.logger ?? rootLogger
  const productId = parseProductId(input.productId)

  // 1) Paywall: a vásárlás-ellenőrzés a termék lekérdezése ELŐTT — a nem-vevő
  //    403-as válasza nem fedi fel, hogy a termék/videó egyáltalán létezik-e.
  if (!hasPurchased(input.user, productId)) {
    log.warn('stream-token: hozzáférés megtagadva (nincs vásárlás)', {
      userId: input.user.id,
      productId,
    })
    throw new StreamTokenError(403, FORBIDDEN_MESSAGE)
  }

  // 2) A vevő esetében a termék biztosan létezik a purchases miatt; ha mégsem,
  //    az adat-inkonzisztencia — 404 (a nem-vevők felé nincs enumerációs csatorna).
  let product: Product
  try {
    product = await input.payload.findByID({
      collection: 'products',
      id: productId,
      overrideAccess: true,
      depth: 0,
    })
  } catch {
    log.warn('stream-token: a megvásárolt termék nem található', {
      userId: input.user.id,
      productId,
    })
    throw new StreamTokenError(404, 'A kurzus nem található.')
  }

  // 3) Státusz-szabály: published → rendben; archived → a meglévő vevő tovább
  //    nézi; draft/ismeretlen → senki (owner preview jelenleg nem scope).
  if (product.status !== 'published' && product.status !== 'archived') {
    log.warn('stream-token: a termék nem published/archived státuszú', {
      userId: input.user.id,
      productId,
    })
    throw new StreamTokenError(403, FORBIDDEN_MESSAGE)
  }

  // 3/b) Időbeli érvényesség: a termék accessDurationDays mezője szerint lejárt
  //      hozzáférés → 403. Korlátlan terméknél (üres/0/negatív mező) ez extra
  //      adatbázis-kör nélkül fut le.
  const access = await resolveSingleCourseAccess({
    payload: input.payload,
    userId: input.user.id,
    product,
    logger: log,
  })
  if (!access.hasAccess) {
    log.warn('stream-token: hozzáférés megtagadva (lejárt hozzáférés)', {
      userId: input.user.id,
      productId,
      accessDurationDays: product.accessDurationDays ?? null,
      expiresAt: access.expiresAt?.toISOString() ?? null,
    })
    throw new StreamTokenError(403, accessExpiredMessage(access.expiresAt))
  }

  // 4) Lecke kiválasztása és lejátszhatóság-ellenőrzés.
  const rawVideoId = typeof input.videoId === 'string' ? input.videoId.trim() : ''
  const lesson = selectLesson(product, rawVideoId.length > 0 ? rawVideoId : undefined)

  // 4/a) Csak VIDEÓ-leckéhez van értelmezhető Bunny-jegy. A szöveges leckét és
  //      a külső linket a felület jegy nélkül nyitja meg; ha mégis ide érkezik
  //      ilyen kérés, az hibás kliens — nem adunk rá jegyet.
  if (lesson.kind !== 'video') {
    log.warn('stream-token: nem videó típusú leckére érkezett jegykérés', {
      userId: input.user.id,
      productId,
      lessonKind: lesson.kind,
    })
    throw new StreamTokenError(404, 'A kért videó nem található.')
  }
  const streamAssetId = lesson.streamAssetId ?? ''
  if (streamAssetId.length === 0) {
    log.error('stream-token: a videóhoz nincs streamAssetId rendelve', {
      userId: input.user.id,
      productId,
    })
    throw new StreamTokenError(503, UNAVAILABLE_MESSAGE)
  }
  if (lesson.status !== 'ready') {
    throw new StreamTokenError(
      409,
      'A videó feldolgozása még folyamatban van. Nézz vissza néhány perc múlva.',
    )
  }
  // A tananyag-modell a nem pozitív hosszt már null-ra normalizálta; a jegy
  // élettartama enélkül nem számolható ki.
  if (lesson.durationSec === null) {
    log.error('stream-token: a videó durationSec mezője hiányzik vagy érvénytelen', {
      userId: input.user.id,
      productId,
    })
    throw new StreamTokenError(503, UNAVAILABLE_MESSAGE)
  }

  // 5) Token kiállítása — a library token-kulcsa kérés-idejű lazy ellenőrzéssel.
  //    A Bunny-jegy hash-e az `expires` értéket is tartalmazza, ezért ugyanaz a
  //    másodperc megy a válaszba (ISO-8601), amivel a hash készült: a kliens
  //    ebből építi vissza az embed-URL `expires` paraméterét.
  const signingKey = requireTokenAuthKey(log)
  const issued = createStreamPlaybackToken({
    videoId: streamAssetId,
    durationSec: lesson.durationSec,
    signingKey,
  })
  const expiresAt = new Date(issued.expires * 1000).toISOString()

  log.info('stream-token: lejátszási token kiállítva', {
    userId: input.user.id,
    productId,
    expiresAt,
  })

  return {
    token: issued.token,
    expiresAt,
  }
}
