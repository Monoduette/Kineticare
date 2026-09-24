import type { Where } from 'payload'

/**
 * Kis, memóriabeli `Where`-kiértékelő a riasztás-tesztekhez: pontosan azokat
 * az operátorokat ismeri, amelyeket a `src/lib/alerts/` feltételei használnak
 * (and, or, equals, in, less_than, greater_than_equal, exists). Ismeretlen
 * operátorra HANGOSAN dob, hogy egy új feltétel ne mehessen át tesztelve
 * látszó, valójában ki nem értékelt ágon.
 */

type Doc = Readonly<Record<string, unknown>>

function compare(value: unknown, operand: unknown): number {
  if (typeof value === 'number' && typeof operand === 'number') {
    return value - operand
  }
  return String(value).localeCompare(String(operand))
}

function matchesField(doc: Doc, field: string, condition: unknown): boolean {
  if (typeof condition !== 'object' || condition === null) {
    throw new Error(`érvénytelen feltétel a(z) ${field} mezőn`)
  }
  const value = doc[field]
  for (const [operator, operand] of Object.entries(condition)) {
    switch (operator) {
      case 'equals':
        if (value !== operand) return false
        break
      case 'in':
        if (!Array.isArray(operand) || !operand.includes(value)) return false
        break
      case 'less_than':
        if (value === undefined || value === null || compare(value, operand) >= 0) return false
        break
      case 'greater_than_equal':
        if (value === undefined || value === null || compare(value, operand) < 0) return false
        break
      case 'exists':
        if ((value !== undefined && value !== null) !== operand) return false
        break
      default:
        throw new Error(`a teszt-kiértékelő nem ismeri a(z) ${operator} operátort`)
    }
  }
  return true
}

export function matchesWhere(doc: Doc, where: Where): boolean {
  for (const [key, condition] of Object.entries(where)) {
    if (key === 'and') {
      if (!(condition as Where[]).every((sub) => matchesWhere(doc, sub))) return false
    } else if (key === 'or') {
      if (!(condition as Where[]).some((sub) => matchesWhere(doc, sub))) return false
    } else if (!matchesField(doc, key, condition)) {
      return false
    }
  }
  return true
}

/** Payload-szerű `count`/`find` memóriabeli gyűjteményekre. */
export function createMemoryPayload(collections: Readonly<Record<string, readonly Doc[]>>) {
  const countCalls: Array<{ collection: string; where?: Where; overrideAccess?: boolean }> = []
  const findCalls: Array<Record<string, unknown>> = []
  const payload = {
    count: async (args: { collection: string; where?: Where; overrideAccess?: boolean }) => {
      countCalls.push(args)
      const docs = collections[args.collection] ?? []
      return { totalDocs: docs.filter((doc) => matchesWhere(doc, args.where ?? {})).length }
    },
    find: async (args: {
      collection: string
      where?: Where
      page?: number
      limit?: number
      sort?: string
    }) => {
      findCalls.push(args)
      const docs = (collections[args.collection] ?? []).filter((doc) =>
        matchesWhere(doc, args.where ?? {}),
      )
      const limit = args.limit ?? 10
      const page = args.page ?? 1
      const slice = docs.slice((page - 1) * limit, page * limit)
      return { docs: slice, hasNextPage: page * limit < docs.length, totalDocs: docs.length }
    },
  }
  return { payload, countCalls, findCalls }
}
