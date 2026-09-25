import { describe, expect, it } from 'vitest'

import { checkConnectionBudget } from '../lib/db-connection-budget'
import type { LogContext, Logger } from '../lib/logger'

/**
 * A pool mérete csak a mért `max_connections`-höz állítható (AGENTS.md; Codex,
 * PR #307): induláskor mérünk, és ha két konténer (deploy-átfedés) poolja és a
 * tartalék nem fér bele, RIASZTÁS szól. A pool a `pg` query-határa; a mérés
 * SQL-je a helyi Postgresen is lefutott (PR-leírás).
 */

interface Sor {
  level: 'debug' | 'info' | 'warn' | 'error'
  msg: string
  context?: LogContext
}

function rogzitoLogger(): { log: Logger; sorok: Sor[] } {
  const sorok: Sor[] = []
  const ir =
    (level: Sor['level']) =>
    (msg: string, context?: LogContext): void => {
      sorok.push(context === undefined ? { level, msg } : { level, msg, context })
    }
  const log: Logger = {
    debug: ir('debug'),
    info: ir('info'),
    warn: ir('warn'),
    error: ir('error'),
    child: () => log,
  }
  return { log, sorok }
}

const poolAmely = (maxConnections: unknown) => ({
  query: async () => ({ rows: [{ max_connections: maxConnections }] }),
})

describe('checkConnectionBudget: a max_connections induláskori mérése', () => {
  it('a Postgres alapértékénél (100) két 20-as pool és a tartalék (50) belefér: mérési sor, riasztás nélkül', async () => {
    const { log, sorok } = rogzitoLogger()
    await checkConnectionBudget(poolAmely(100), log)

    expect(sorok).toEqual([
      {
        level: 'info',
        msg: 'Postgres kapcsolat-keret mérve',
        context: { maxConnections: 100, poolMax: 20, containers: 2, needed: 50 },
      },
    ])
  })

  it('ha a mért érték kevesebb a szükségesnél, RIASZTÁS a mért és a szükséges számmal', async () => {
    const { log, sorok } = rogzitoLogger()
    await checkConnectionBudget(poolAmely(49), log)

    expect(sorok).toHaveLength(1)
    expect(sorok[0]?.level).toBe('error')
    expect(sorok[0]?.msg).toMatch(/^RIASZTÁS: a Postgres max_connections kevesebb/)
    expect(sorok[0]?.context).toMatchObject({ maxConnections: 49, poolMax: 20, needed: 50 })
  })

  it('a mérés hibája csak figyelmeztetés, az indulást nem akasztja meg', async () => {
    const { log, sorok } = rogzitoLogger()
    const hibas = {
      query: async () => {
        throw new Error('a kapcsolat nem jött létre')
      },
    }

    await expect(checkConnectionBudget(hibas, log)).resolves.toBeUndefined()
    await expect(checkConnectionBudget(poolAmely('nem szám'), log)).resolves.toBeUndefined()
    expect(sorok.map((sor) => sor.level)).toEqual(['warn', 'warn'])
  })
})
