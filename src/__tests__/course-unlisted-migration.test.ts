import type { MigrateUpArgs } from '@payloadcms/db-postgres'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { describe, expect, it } from 'vitest'

import { down, up } from '../migrations/20260921_095507_products_unlisted'
import { isDatabaseAvailable } from './helpers/db-available'

const hasDb = await isDatabaseAvailable()

// Saját kapcsolathoz tartozó ideiglenes táblák: a migráció nem érintheti a
// többi teszt products tábláját. CI-ban a DB hiánya nem lehet néma kihagyás.
describe.skipIf(!hasDb)('unlisted migration: existing rows and rollback', () => {
  it('defaults existing courses to listed and preserves their data through up/down', async () => {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URI })
    await client.connect()
    try {
      await client.query('BEGIN')
      await client.query('SET LOCAL search_path TO pg_temp')
      await client.query('CREATE TEMPORARY TABLE products (id integer, title text) ON COMMIT DROP')
      await client.query(
        'CREATE TEMPORARY TABLE "_products_v" (id integer, title text) ON COMMIT DROP',
      )
      await client.query("INSERT INTO products VALUES (1, 'existing course')")
      await client.query('INSERT INTO "_products_v" VALUES (1, \'existing version\')')

      const args = { db: drizzle(client) } as unknown as MigrateUpArgs
      await up(args)
      expect((await client.query('SELECT unlisted FROM products')).rows).toEqual([
        { unlisted: false },
      ])
      expect((await client.query('SELECT version_unlisted FROM "_products_v"')).rows).toEqual([
        { version_unlisted: false },
      ])
      await client.query('UPDATE products SET unlisted = true WHERE id = 1')
      await client.query("INSERT INTO products (id, title) VALUES (2, 'new course')")
      expect((await client.query('SELECT unlisted FROM products ORDER BY id')).rows).toEqual([
        { unlisted: true },
        { unlisted: false },
      ])

      await down(args)
      expect((await client.query('SELECT * FROM products ORDER BY id')).rows).toEqual([
        { id: 1, title: 'existing course' },
        { id: 2, title: 'new course' },
      ])
      expect((await client.query('SELECT * FROM "_products_v"')).rows).toEqual([
        { id: 1, title: 'existing version' },
      ])
    } finally {
      await client.query('ROLLBACK').catch(() => undefined)
      await client.end()
    }
  })
})
