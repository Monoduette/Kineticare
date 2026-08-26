/**
 * Csonkolt progress-lista biztonságos levágása: enrollment és progress külön plafon.
 * Ha a progress plafon vág, az utolsó user sorai + nagyobb userId-k kiesnek — inkább kevesebb, de igaz adat.
 * Közös szabály a kurzus-panel és a Statisztika Kurzus-hatás táblája között.
 */

/** Bármi */

/** Bármi, amit egy felhasználóhoz kötünk (a levágás csak az azonosítót nézi). */
export interface UserScopedRow {
  userId: number
}

export interface TrimTruncatedProgressInput<P extends UserScopedRow, E extends UserScopedRow> {
  /** A (esetleg csonkolt) progress-sorok, `['user','id']` sorrendben. */
  progressRows: P[]
  /** A TELJES enrollment-lista ugyanerre a kurzusra. */
  enrollments: E[]
  /** Elérte-e a progress-lapozás a felső korlátot. */
  truncated: boolean
}

export interface TrimTruncatedProgressResult<P extends UserScopedRow, E extends UserScopedRow> {
  /** A megtartott progress-sorok (az utolsó, félbevágott user nélkül). */
  progressRows: P[]
  /** A megtartott beiratkozások (csak akikről teljes adatunk van). */
  enrollments: E[]
  /** Hány diák maradt ki a csonkolás miatt — a felületnek jelentendő. */
  omitted: number
}

/**
 * Levágja a csonkolt progress-listát az utolsó TELJES felhasználóig, és
 * ugyanerre szűkíti az enrollment-listát.
 *
 * Csonkolás nélkül (`truncated: false`) mindkét lista változatlanul jön
 * vissza, `omitted: 0` mellett — a hívó tehát feltétel nélkül átengedheti
 * rajta az adatot.
 */
export function trimTruncatedProgress<P extends UserScopedRow, E extends UserScopedRow>(
  input: TrimTruncatedProgressInput<P, E>,
): TrimTruncatedProgressResult<P, E> {
  if (!input.truncated || input.progressRows.length === 0) {
    return { progressRows: input.progressRows, enrollments: input.enrollments, omitted: 0 }
  }

  const progressRows = [...input.progressRows]
  const hianyosTolUserId = progressRows[progressRows.length - 1].userId
  while (
    progressRows.length > 0 &&
    progressRows[progressRows.length - 1].userId === hianyosTolUserId
  ) {
    progressRows.pop()
  }

  const enrollments = input.enrollments.filter((entry) => entry.userId < hianyosTolUserId)
  return { progressRows, enrollments, omitted: input.enrollments.length - enrollments.length }
}
