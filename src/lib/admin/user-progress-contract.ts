import type { CourseStudentStatus } from './course-progress-stats'

/**
 * Felhasználók-lista haladás-szerződés — szerver és kliens közös forrása.
 * A válaszban nincs név/e-mail (a lista oszlopai már mutatják).
 */

/** A végpont útvonala. */
export const USER_PROGRESS_ENDPOINT = '/api/admin/user-progress'

/** A kért felhasználó-azonosítók query-paraméterének neve. */
export const USER_PROGRESS_USERS_PARAM = 'users'

/**
 * Egy kérésben legfeljebb ennyi felhasználó haladása kérhető le.
 *
 * A Payload lista-nézete alapból 10–100 sort mutat, de a `?limit=` kézzel
 * nagyobbra is állítható — a kliens ezért CSOMAGOKRA bontja a kérést, nem
 * hagyatkozik arra, hogy egy oldal sosem nagyobb ennél. A korlát így nem UX-
 * hiba forrása, hanem az egy kérésre eső adatbázis-munka felső határa.
 */
export const USER_PROGRESS_MAX_USERS = 100

/**
 * A legnagyobb elfogadott felhasználó-azonosító: az `int4` felső határa.
 *
 * A `users.id` Postgres `integer` oszlop; ennél nagyobb értékkel a lekérdezés
 * nem „nem talál" választ ad, hanem tartomány-hibával dől el.
 */
const USER_ID_MAX = 2_147_483_647

/** Egy kurzus haladása EGY felhasználónál. */
export interface UserCourseProgressEntry {
  productId: number
  /** Kerekített százalék, 0–100 — a közös `summarizeCurriculum`-ból. */
  percent: number
  status: CourseStudentStatus
  /** Elindítható leckék száma (nevező). 0 = „nincs tananyag", nem „0% · nem kezdte el". */
  lessonCount: number
}

/** Egy felhasználó összes (hozzáférhető) kurzusának haladása. */
export interface UserProgressRow {
  userId: number
  courses: UserCourseProgressEntry[]
}

/** A `GET /api/admin/user-progress` sikeres válasza. */
export interface UserProgressResponse {
  users: UserProgressRow[]
}

/**
 * Az azonosító-lista kódolása a query-stringbe.
 *
 * Vesszővel elválasztott egészek. Szándékosan nem `users[]=1&users[]=2`:
 * a rövidebb alak több száz azonosítónál is bőven belefér az URL-hossz
 * gyakorlati korlátjába, és a szerver oldali értelmezése egyértelmű.
 */
export function buildUserProgressQuery(userIds: readonly number[]): string {
  const params = new URLSearchParams()
  params.set(USER_PROGRESS_USERS_PARAM, userIds.join(','))
  return `${USER_PROGRESS_ENDPOINT}?${params.toString()}`
}

/**
 * A query-paraméter értelmezése: pozitív egészek, duplikátum nélkül,
 * a beérkezési sorrendet megtartva.
 *
 * A query-string BÁRMI lehet (kézzel írt URL, hibás kliens), ezért az
 * értelmezés szigorú: ami nem pozitív egész, az kimarad. Ha a nyers érték
 * üres vagy egyetlen érvényes azonosítót sem tartalmaz, üres tömb jön vissza —
 * a hívó ebből dönt a 400-as válaszról.
 *
 * A felső határ az `int4` maximuma (2 147 483 647), mert a `users.id` ilyen
 * oszlop. A `Number.isInteger` ezt nem fogta: a `9e18` egész, tehát átment az
 * értelmezésen, és a Postgres a lekérdezésnél tartomány-hibát dobott volna —
 * vagyis egy kézzel írt URL a végpontot 500-asra vitte. A `Number.isSafeInteger`
 * ezen felül a lebegőpontos pontatlanságot is kizárja (`2**53` fölött két
 * különböző azonosító ugyanarra a számra kerekedne).
 */
export function parseUserIdsParam(raw: string | null): number[] {
  if (raw === null) {
    return []
  }
  const ids: number[] = []
  const seen = new Set<number>()
  for (const part of raw.split(',')) {
    const trimmed = part.trim()
    if (trimmed.length === 0) {
      continue
    }
    const value = Number(trimmed)
    if (
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > USER_ID_MAX ||
      seen.has(value)
    ) {
      continue
    }
    seen.add(value)
    ids.push(value)
  }
  return ids
}
