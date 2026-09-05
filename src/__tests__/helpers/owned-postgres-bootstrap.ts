import type { PostgresAdapter } from '@payloadcms/db-postgres'
import type { Pool, PoolClient } from 'pg'

type ConnectCallback = Parameters<Pool['connect']>[0]

/** The pinned adapter keeps its first pool.connect lease until process exit. */
export function captureOwnedPostgresBootstrap(db: PostgresAdapter): () => void {
  const RealPool = db.pg.Pool
  let first = true
  let bootstrap: PoolClient | undefined
  class OwnedPool extends RealPool {
    override connect(): Promise<PoolClient>
    override connect(callback: ConnectCallback): void
    override connect(callback?: ConnectCallback): Promise<PoolClient> | void {
      const capture = first
      first = false
      if (callback) {
        return super.connect((error, client, done) => {
          if (capture && client) bootstrap = client
          callback(error, client, done)
        })
      }
      return super.connect().then((client) => {
        if (capture) bootstrap = client
        return client
      })
    }
  }
  // A real Pool subclass: no query, transaction, or release behavior is replaced.
  db.pg = { ...db.pg, Pool: OwnedPool }
  return () => {
    if (!bootstrap) throw new Error('Owned PostgreSQL bootstrap lease was not captured')
    bootstrap.release(true)
    bootstrap = undefined
  }
}
