/**
 * Migrációs séma-őr közös motorja (G1/G2). Kanonizálja a drizzle snapshotot,
 * replay-eli a datált migrációk SQL-jét memóriában, diff-et készít. Ismeretlen
 * statement vagy snapshot-kulcs hangos bukás — csendes átengedés tilos.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// Kanonikus sémamodell — mindkét oldal (SQL-replay és snapshot-kivonat) ezt
// az alakot állítja elő, a diffCanonical pedig ezeket veti össze.
// ---------------------------------------------------------------------------

export interface CanonicalColumn {
  /** Normalizált típus: a séma-minősített, idézett enum-hivatkozások csupasz névre egyszerűsödnek. */
  type: string
  notNull: boolean
  primaryKey: boolean
  /** Normalizált alapértelmezés (a végleges `::típus` castektől megtisztítva); hiányában nincs DEFAULT. */
  default?: string
}

export interface CanonicalIndex {
  /** Oszlopnevek az index-deklaráció sorrendjében (a sorrend tartalmi). */
  columns: string[]
  unique: boolean
}

export interface CanonicalForeignKey {
  tableTo: string
  columnsFrom: string[]
  columnsTo: string[]
  onDelete: string
  onUpdate: string
}

export interface CanonicalTable {
  columns: Record<string, CanonicalColumn>
  indexes: Record<string, CanonicalIndex>
  foreignKeys: Record<string, CanonicalForeignKey>
}

export interface CanonicalSchema {
  /** Táblanév szerint (a snapshot `public.<név>` kulcsaiból a séma-előtag levetve). */
  tables: Record<string, CanonicalTable>
  /** Enum-név → értéklista, a DEKLARÁCIÓ sorrendjében (sorrend-érzékeny). */
  enums: Record<string, string[]>
}

/** Üres kiinduló sémamodell a replayhez. */
export function createEmptyCanonicalSchema(): CanonicalSchema {
  return { tables: {}, enums: {} }
}

// ---------------------------------------------------------------------------
// A migrations-könyvtár felsorolása
// ---------------------------------------------------------------------------

const helperDir = path.dirname(fileURLToPath(import.meta.url))

/** A src/migrations könyvtár abszolút útvonala. */
export function migrationsDir(): string {
  return path.resolve(helperDir, '../../migrations')
}

/**
 * A datált migrációs fájlnév whitelistje: `YYYYMMDD_HHMMSS_<snake_név>.<ext>`.
 * A `^…$` horgony és a `[a-z0-9_]+` (pont nélküli) névrész miatt az index.ts
 * és a generátor által esetleg kitett `.checksums.json` is kiesik — a
 * snapshot-választás így kizárólag valódi, datált snapshotok között történik.
 */
function datedFileRegex(extension: string): RegExp {
  return new RegExp(`^\\d{8}_\\d{6}_[a-z0-9_]+\\.${extension}$`)
}

/**
 * A datált migrációs .ts fájlok NEVEI, lexikografikusan rendezve.
 * A sorrend tartalmi: a payload éles migráció-futtatása (readMigrationFiles.js)
 * is könyvtár-scan + sort() szerint játssza le őket — a replay ezt követi.
 */
export function listDatedMigrationTs(): string[] {
  const whitelist = datedFileRegex('ts')
  return fs
    .readdirSync(migrationsDir())
    .filter((name) => whitelist.test(name))
    .sort()
}

/**
 * A legutolsó drizzle-snapshot .json TELJES útvonala — a datált snapshotok
 * lexikografikusan legnagyobbika (a dátum-előtag miatt ez az időrendi is).
 * Bukás, ha egyetlen snapshot sincs: ilyenkor a G1/G2-nek nincs mihez
 * viszonyítania, és ezt nem szabad csendben átengedni.
 */
export function latestSnapshotPath(): string {
  const whitelist = datedFileRegex('json')
  const snapshots = fs
    .readdirSync(migrationsDir())
    .filter((name) => whitelist.test(name))
    .sort()
  const latest = snapshots[snapshots.length - 1]
  if (latest === undefined) {
    throw new Error(`nincs datált snapshot .json a(z) ${migrationsDir()} könyvtárban`)
  }
  return path.join(migrationsDir(), latest)
}

/** A snapshot .json beolvasása nyers (ismeretlen típusú) JSON-ként. */
export function readSnapshot(snapshotPath: string): unknown {
  return JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) as unknown
}

// ---------------------------------------------------------------------------
// Snapshot-kanonizálás: a generateDrizzleJson-kimenetből kanonikus modell.
// A modellbe nem kivonható vödrök csak üresen fogadhatók el.
// ---------------------------------------------------------------------------

function asPlainObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`a snapshot ${label} része nem objektum`)
  }
  return value as Record<string, unknown>
}

/** A modellen kívüli vödör csak hiányzó vagy üres objektum lehet — egyébként hangos bukás. */
function expectEmptyBucket(value: unknown, label: string): void {
  if (value === undefined) {
    return
  }
  if (typeof value !== 'object' || value === null || Object.keys(value).length > 0) {
    throw new Error(
      `a snapshot ${label} vödrös része nem üres — a séma-őr ezt a dimenziót (még) nem modellezi, ` +
        'a kanonizálót ki kell bővíteni, mielőtt ez a tartalom csendben elveszne',
    )
  }
}

/**
 * A pinned drizzle snapshot-formátum ZÁRT kulcslistái szintenként. A formátum
 * a repóban rögzített drizzle-verzióhoz kötött: egy jövőbeli formátum-bővülés
 * (pl. új mezőtípus-kulcs a táblaobjektumban) itt hangos bukás legyen, ne
 * néma vakfolt — a kanonizálót tudatosan kell bővíteni, mielőtt az új
 * dimenzió csendben elveszne.
 *
 * A listák a formátum TELJES szókészlete (a futásidejű generateDrizzleJson-
 * kimenet és a szerializált fájl uniója): a `generated`/`identity`/`where`/
 * `opclass`/`schemaTo` kulcsokat a generátor ma undefined-ként hordozza, és a
 * JSON.stringify a fájlba íráskor eldobja őket — ezért a snapshot-fájlokban
 * nem látszanak, de a G2 futásidejű összevetésében jelen vannak. Tartalommal
 * bírva egyiket sem tudná a kanonikus modell összevetni — azt külön
 * ellenőrizzük (lásd a canonicalizeSnapshot belső megjegyzéseit).
 */
const SNAPSHOT_ROOT_KEYS = [
  'version',
  'dialect',
  'tables',
  'enums',
  'schemas',
  'sequences',
  'roles',
  'policies',
  'views',
  '_meta',
  'id',
  'prevId',
] as const
const SNAPSHOT_ENUM_KEYS = ['name', 'schema', 'values'] as const
const SNAPSHOT_TABLE_KEYS = [
  'name',
  'schema',
  'columns',
  'indexes',
  'foreignKeys',
  'compositePrimaryKeys',
  'uniqueConstraints',
  'policies',
  'checkConstraints',
  'isRLSEnabled',
] as const
const SNAPSHOT_COLUMN_KEYS = [
  'name',
  'type',
  'typeSchema',
  'primaryKey',
  'notNull',
  'default',
  'generated',
  'identity',
] as const
const SNAPSHOT_INDEX_KEYS = ['name', 'columns', 'isUnique', 'method', 'concurrently', 'with', 'where'] as const
const SNAPSHOT_INDEX_COLUMN_KEYS = ['expression', 'isExpression', 'asc', 'nulls', 'opclass'] as const
const SNAPSHOT_FOREIGN_KEY_KEYS = [
  'name',
  'tableFrom',
  'columnsFrom',
  'tableTo',
  'columnsTo',
  'onDelete',
  'onUpdate',
  'schemaTo',
] as const

/** Kulcsszintű szigorúság: ismeretlen kulcs bármely modellzett szinten hangos bukás. */
function expectKnownKeys(value: Record<string, unknown>, knownKeys: readonly string[], label: string): void {
  const known = new Set<string>(knownKeys)
  for (const key of Object.keys(value)) {
    if (!known.has(key)) {
      throw new Error(
        `a snapshot ${label} része ismeretlen kulcsot tartalmaz: '${key}' — ` +
          'a snapshot-formátum a pinned drizzle-verzióhöz kötött; ha a generátor bővült, ' +
          'a kanonizálót tudatosan ki kell bővíteni, mielőtt ez a tartalom csendben elveszne',
      )
    }
  }
}

/**
 * A snapshot JSON → kanonikus modell. A top-level `id`/`prevId`/`_meta`
 * generálási zaj a kivonatba nem jut át — így a generálásonként változó
 * UUID-k a diffet nem mocskolják, miközben a tartalmi dimenziók (táblák,
 * enumok) sorrend-hűen megmaradnak. Kulcsszinten a kanonizáló ZÁRT: minden
 * modellzett szinten (gyökér, enum, tábla, oszlop, index, idegen kulcs) csak
 * a pinned formátum ismert kulcsai fogadhatók el — ismeretlen kulcs hangos
 * bukás (expectKnownKeys), nem csendes átengedés.
 */
export function canonicalizeSnapshot(json: unknown): CanonicalSchema {
  const root = asPlainObject(json, 'gyökere')
  expectKnownKeys(root, SNAPSHOT_ROOT_KEYS, 'gyökere')

  expectEmptyBucket(root.sequences, 'sequences')
  expectEmptyBucket(root.roles, 'roles')
  expectEmptyBucket(root.policies, 'policies')
  expectEmptyBucket(root.views, 'views')
  expectEmptyBucket(root.schemas, 'schemas (a public sémán kívüli névtér jelenleg nem modellezett)')

  const schema = createEmptyCanonicalSchema()

  const enums = asPlainObject(root.enums, 'enums')
  for (const [enumKey, enumValue] of Object.entries(enums)) {
    if (!enumKey.startsWith('public.')) {
      throw new Error(`a snapshot enums-kulcsa nem public-alapú: ${enumKey}`)
    }
    const enumObject = asPlainObject(enumValue, `enums.${enumKey}`)
    expectKnownKeys(enumObject, SNAPSHOT_ENUM_KEYS, `enums.${enumKey}`)
    if (!Array.isArray(enumObject.values) || !enumObject.values.every((v) => typeof v === 'string')) {
      throw new Error(`a snapshot enums.${enumKey}.values nem szöveges tömb`)
    }
    schema.enums[enumKey.slice('public.'.length)] = [...enumObject.values]
  }

  const tables = asPlainObject(root.tables, 'tables')
  for (const [tableKey, tableValue] of Object.entries(tables)) {
    if (!tableKey.startsWith('public.')) {
      throw new Error(`a snapshot tables-kulcsa nem public-alapú: ${tableKey}`)
    }
    const tableName = tableKey.slice('public.'.length)
    const tableObject = asPlainObject(tableValue, `tables.${tableKey}`)
    expectKnownKeys(tableObject, SNAPSHOT_TABLE_KEYS, `tables.${tableKey}`)

    expectEmptyBucket(tableObject.compositePrimaryKeys, `tables.${tableKey}.compositePrimaryKeys`)
    expectEmptyBucket(tableObject.uniqueConstraints, `tables.${tableKey}.uniqueConstraints`)
    expectEmptyBucket(tableObject.checkConstraints, `tables.${tableKey}.checkConstraints`)
    expectEmptyBucket(tableObject.policies, `tables.${tableKey}.policies`)
    if (tableObject.isRLSEnabled) {
      throw new Error(`a snapshot ${tableKey} táblája RLS-engedett — ezt a séma-őr nem modellezi`)
    }

    const columns: Record<string, CanonicalColumn> = {}
    const columnsObject = asPlainObject(tableObject.columns, `tables.${tableKey}.columns`)
    for (const [columnName, columnValue] of Object.entries(columnsObject)) {
      const column = asPlainObject(columnValue, `tables.${tableKey}.columns.${columnName}`)
      expectKnownKeys(column, SNAPSHOT_COLUMN_KEYS, `tables.${tableKey}.columns.${columnName}`)
      // A `generated`/`identity` kulcsot a generátor ma undefined-ként hordozza
      // (a fájlba íráskor elveszik) — TARTALOMMAL a modell nem tudná összevetni.
      if (column.generated !== undefined || column.identity !== undefined) {
        throw new Error(
          `a snapshot ${tableKey}.${columnName} oszlopa generated/identity tartalmat hordoz — ` +
            'ezt a dimenziót a séma-őr (még) nem modellezi',
        )
      }
      const canonical: CanonicalColumn = {
        type: String(column.type),
        notNull: Boolean(column.notNull),
        primaryKey: Boolean(column.primaryKey),
      }
      if (column.default !== undefined) {
        // A snapshotban az alapértelmezés szöveg ('now()', "'page'"), szám
        // (0, 3) vagy logikai (false) — a kanonikus alak egységesen szöveg.
        canonical.default = typeof column.default === 'string' ? column.default : String(column.default)
      }
      columns[columnName] = canonical
    }

    const indexes: Record<string, CanonicalIndex> = {}
    const indexesObject = asPlainObject(tableObject.indexes ?? {}, `tables.${tableKey}.indexes`)
    for (const [indexName, indexValue] of Object.entries(indexesObject)) {
      const index = asPlainObject(indexValue, `tables.${tableKey}.indexes.${indexName}`)
      expectKnownKeys(index, SNAPSHOT_INDEX_KEYS, `tables.${tableKey}.indexes.${indexName}`)
      // Parciális (where-predikátumos) indexet a CREATE INDEX replay-oldallal
      // nem tud az őr összevetni — a kulcs ma mindig undefined.
      if (index.where !== undefined) {
        throw new Error(
          `a snapshot ${tableKey}.${indexName} indexe parciális (where-predikátumos) — ` +
            'a séma-őr ezt (még) nem modellezi',
        )
      }
      if (!Array.isArray(index.columns)) {
        throw new Error(`a snapshot ${tableKey}.${indexName} indexének columns mezője nem tömb`)
      }
      const expressions: string[] = []
      for (const columnEntry of index.columns) {
        const entry = asPlainObject(columnEntry, `tables.${tableKey}.indexes.${indexName}.columns[]`)
        expectKnownKeys(entry, SNAPSHOT_INDEX_COLUMN_KEYS, `tables.${tableKey}.indexes.${indexName}.columns[]`)
        if (entry.isExpression) {
          throw new Error(
            `a snapshot ${tableKey}.${indexName} indexe kifejezés-oszlopot tartalmaz — ` +
              'a séma-őr ezt (még) nem tudja a CREATE INDEX replay oldalával összevetni',
          )
        }
        // Operátor-osztályos index-oszlopot sem tud az őr összevetni — a kulcs ma mindig undefined.
        if (entry.opclass !== undefined) {
          throw new Error(
            `a snapshot ${tableKey}.${indexName} indexe operátor-osztályos (opclass) oszlopot tartalmaz — ` +
              'a séma-őr ezt (még) nem modellezi',
          )
        }
        expressions.push(String(entry.expression))
      }
      indexes[indexName] = { columns: expressions, unique: Boolean(index.isUnique) }
    }

    const foreignKeys: Record<string, CanonicalForeignKey> = {}
    const foreignKeysObject = asPlainObject(
      tableObject.foreignKeys ?? {},
      `tables.${tableKey}.foreignKeys`,
    )
    for (const [fkName, fkValue] of Object.entries(foreignKeysObject)) {
      const fk = asPlainObject(fkValue, `tables.${tableKey}.foreignKeys.${fkName}`)
      expectKnownKeys(fk, SNAPSHOT_FOREIGN_KEY_KEYS, `tables.${tableKey}.foreignKeys.${fkName}`)
      // A public sémán kívüli cél nem modellezett (a tableTo séma-előtag nélküli
      // kanonikus név) — a `schemaTo` kulcs ma mindig undefined.
      if (fk.schemaTo !== undefined) {
        throw new Error(
          `a snapshot ${tableKey}.${fkName} idegen kulcsa sémaminősített (schemaTo) célra mutat — ` +
            'a séma-őr a public sémán kívüli hivatkozást (még) nem modellezi',
        )
      }
      foreignKeys[fkName] = {
        tableTo: String(fk.tableTo),
        columnsFrom: asStringArray(fk.columnsFrom, `tables.${tableKey}.foreignKeys.${fkName}.columnsFrom`),
        columnsTo: asStringArray(fk.columnsTo, `tables.${tableKey}.foreignKeys.${fkName}.columnsTo`),
        onDelete: String(fk.onDelete),
        onUpdate: String(fk.onUpdate),
      }
    }

    schema.tables[tableName] = { columns, indexes, foreignKeys }
  }

  return schema
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new Error(`a snapshot ${label} mezője nem szöveges tömb`)
  }
  return [...value]
}

// ---------------------------------------------------------------------------
// diffCanonical — magyar, emberi diff-lista két kanonikus modell között.
// Az irány: az ELSŐ modellt a MÁSODIKHOZ viszonyítja — ami az elsőben nincs
// meg a másodikból, az „hiányzik"; ami az elsőben többlet, az „felesleges".
// ---------------------------------------------------------------------------

function diffColumnFields(table: string, column: string, actual: CanonicalColumn, expected: CanonicalColumn): string[] {
  const diffs: string[] = []
  if (actual.type !== expected.type) {
    diffs.push(`eltérő oszlop-típus: ${table}.${column} ('${actual.type}' ≠ '${expected.type}')`)
  }
  if (actual.notNull !== expected.notNull) {
    diffs.push(`eltérő NOT NULL: ${table}.${column} (${actual.notNull} ≠ ${expected.notNull})`)
  }
  if (actual.primaryKey !== expected.primaryKey) {
    diffs.push(`eltérő PRIMARY KEY: ${table}.${column} (${actual.primaryKey} ≠ ${expected.primaryKey})`)
  }
  if (actual.default !== expected.default) {
    diffs.push(
      `eltérő alapértelmezés: ${table}.${column} (${actual.default ?? 'nincs'} ≠ ${expected.default ?? 'nincs'})`,
    )
  }
  return diffs
}

/** Magyar diff-lista két kanonikus sémamodell között; üres lista = azonos séma. */
export function diffCanonical(actual: CanonicalSchema, expected: CanonicalSchema): string[] {
  const diffs: string[] = []

  for (const tableName of Object.keys(expected.tables)) {
    if (!(tableName in actual.tables)) {
      diffs.push(`hiányzó tábla: ${tableName}`)
    }
  }
  for (const tableName of Object.keys(actual.tables)) {
    if (!(tableName in expected.tables)) {
      diffs.push(`felesleges tábla: ${tableName}`)
    }
  }

  for (const tableName of Object.keys(expected.tables)) {
    const actualTable = actual.tables[tableName]
    const expectedTable = expected.tables[tableName]
    if (actualTable === undefined || expectedTable === undefined) {
      continue
    }

    for (const columnName of Object.keys(expectedTable.columns)) {
      if (!(columnName in actualTable.columns)) {
        diffs.push(`hiányzó oszlop: ${tableName}.${columnName}`)
      }
    }
    for (const columnName of Object.keys(actualTable.columns)) {
      if (!(columnName in expectedTable.columns)) {
        diffs.push(`felesleges oszlop: ${tableName}.${columnName}`)
      }
    }
    for (const [columnName, expectedColumn] of Object.entries(expectedTable.columns)) {
      const actualColumn = actualTable.columns[columnName]
      if (actualColumn !== undefined) {
        diffs.push(...diffColumnFields(tableName, columnName, actualColumn, expectedColumn))
      }
    }

    for (const indexName of Object.keys(expectedTable.indexes)) {
      if (!(indexName in actualTable.indexes)) {
        diffs.push(`hiányzó index: ${tableName}.${indexName}`)
      }
    }
    for (const indexName of Object.keys(actualTable.indexes)) {
      if (!(indexName in expectedTable.indexes)) {
        diffs.push(`felesleges index: ${tableName}.${indexName}`)
      }
    }
    for (const [indexName, expectedIndex] of Object.entries(expectedTable.indexes)) {
      const actualIndex = actualTable.indexes[indexName]
      if (actualIndex === undefined) {
        continue
      }
      if (actualIndex.columns.join(',') !== expectedIndex.columns.join(',')) {
        diffs.push(
          `eltérő index-oszlopok: ${tableName}.${indexName} ('${actualIndex.columns.join(',')}' ≠ '${expectedIndex.columns.join(',')}')`,
        )
      }
      if (actualIndex.unique !== expectedIndex.unique) {
        diffs.push(`eltérő index-egyediség: ${tableName}.${indexName} (${actualIndex.unique} ≠ ${expectedIndex.unique})`)
      }
    }

    for (const fkName of Object.keys(expectedTable.foreignKeys)) {
      if (!(fkName in actualTable.foreignKeys)) {
        diffs.push(`hiányzó idegen kulcs: ${tableName}.${fkName}`)
      }
    }
    for (const fkName of Object.keys(actualTable.foreignKeys)) {
      if (!(fkName in expectedTable.foreignKeys)) {
        diffs.push(`felesleges idegen kulcs: ${tableName}.${fkName}`)
      }
    }
    for (const [fkName, expectedFk] of Object.entries(expectedTable.foreignKeys)) {
      const actualFk = actualTable.foreignKeys[fkName]
      if (actualFk === undefined) {
        continue
      }
      const actualDesc = `${actualFk.tableTo}(${actualFk.columnsTo.join(',')}) onDelete=${actualFk.onDelete} onUpdate=${actualFk.onUpdate}`
      const expectedDesc = `${expectedFk.tableTo}(${expectedFk.columnsTo.join(',')}) onDelete=${expectedFk.onDelete} onUpdate=${expectedFk.onUpdate}`
      if (
        actualFk.tableTo !== expectedFk.tableTo ||
        actualFk.columnsFrom.join(',') !== expectedFk.columnsFrom.join(',') ||
        actualFk.columnsTo.join(',') !== expectedFk.columnsTo.join(',') ||
        actualFk.onDelete !== expectedFk.onDelete ||
        actualFk.onUpdate !== expectedFk.onUpdate
      ) {
        diffs.push(`eltérő idegen kulcs: ${tableName}.${fkName} (${actualDesc} ≠ ${expectedDesc})`)
      }
    }
  }

  for (const enumName of Object.keys(expected.enums)) {
    if (!(enumName in actual.enums)) {
      diffs.push(`hiányzó enum: ${enumName}`)
    }
  }
  for (const enumName of Object.keys(actual.enums)) {
    if (!(enumName in expected.enums)) {
      diffs.push(`felesleges enum: ${enumName}`)
    }
  }
  for (const [enumName, expectedValues] of Object.entries(expected.enums)) {
    const actualValues = actual.enums[enumName]
    if (actualValues === undefined) {
      continue
    }
    // SORREND-ÉRZÉKENY összevetés: az enum-értéklista sorrendje tartalmi
    // (ALTER TYPE … ADD VALUE BEFORE/AFTER pozicionál, a snapshot pedig a
    // config-deklaráció sorrendjét őrzi).
    if (actualValues.join('\n') !== expectedValues.join('\n')) {
      diffs.push(
        `eltérő enum-értékek (sorrendérzékeny): ${enumName} ('${actualValues.join(',')}' ≠ '${expectedValues.join(',')}')`,
      )
    }
  }

  return diffs
}

// ---------------------------------------------------------------------------
// Migráció-lefuttatás ál-adapterrel: az up()/down() SQL-jeinek kifogása
// VALÓDI adatbázis-kapcsolat nélkül.
// ---------------------------------------------------------------------------

/** A datált migrációs modulok futásidejű minimális szerződése. */
type MigrationFn = (args: { db: unknown; payload: unknown; req: unknown }) => Promise<unknown>

interface MigrationModule {
  up: MigrationFn
  down: MigrationFn
}

function asMigrationModule(raw: unknown, fileName: string): MigrationModule {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`G1: a(z) ${fileName} migrációs modul nem objektum`)
  }
  const record = raw as Record<string, unknown>
  if (typeof record.up !== 'function' || typeof record.down !== 'function') {
    throw new Error(`G1: a(z) ${fileName} modulból hiányzik az up()/down() export`)
  }
  return { up: record.up as MigrationFn, down: record.down as MigrationFn }
}

/**
 * Ál-`db`: kizárólag az `execute` tag engedélyezett (a capture-ön keresztül);
 * bármely más tag elérésekor egy dobó függvény jön — a migráció így hangosan
 * elhasal, ha a séma-őr által nem látott adapter-felületre támaszkodna.
 */
function createFakeDb(capture: (query: unknown) => void): unknown {
  const execute = async (query: unknown): Promise<void> => {
    capture(query)
  }
  return new Proxy(
    { execute },
    {
      get(target, key) {
        if (key === 'execute') {
          return target.execute
        }
        return () => {
          throw new Error(`G1: a migráció a db.${String(key)} tagot használná — az őr csak db.execute-et enged`)
        }
      },
    },
  )
}

/** Ál-`payload`/`req`: MINDEN tulajdonság-hozzáférés dob — a séma-őr alatt a migráció semmit nem kérdezhet meg. */
function createThrowingProxy(label: string): unknown {
  return new Proxy(
    {},
    {
      get(_target, key) {
        throw new Error(`G1: a migráció a ${label}.${String(key)} tagot érné el — a séma-őr ezt nem engedi`)
      },
    },
  )
}

/**
 * Duck-typelt StringChunk-felismerés. Szándékosan NEM instanceof-alapú: a
 * chunk-osztály a drizzle-orm/@payloadcms db-postgres újraexportokon át
 * érkezhet, és a példányazonosság modul-duplikációnál elromlana — a
 * szerkezeti jegyek (konstruktornév + tiszta szöveg-értéktömb) viszont
 * stabilak. Bármely más chunk-alak (Param/Table/Raw/bármi) nem statikus
 * SQL-t jelent.
 */
function isStringChunk(chunk: unknown): chunk is { value: string[] } {
  if (typeof chunk !== 'object' || chunk === null) {
    return false
  }
  const ctor = (chunk as { constructor?: { name?: unknown } }).constructor
  if (ctor?.name !== 'StringChunk') {
    return false
  }
  const value = (chunk as { value?: unknown }).value
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

/**
 * Egy kifogott db.execute-argumentumból a TELJES SQL-szöveg. Csak paraméter
 * nélküli, tisztán statikus sql template fogadható el: ha a template
 * interpolációt tartalmazna, nem-StringChunk darab is bekerülne — az pedig
 * azonnali, hangos bukás.
 */
function extractSqlFromQuery(query: unknown, context: string): string {
  if (typeof query !== 'object' || query === null) {
    throw new Error(`G1: nem statikus SQL (${context}): a db.execute argumentuma nem drizzle-sql objektum`)
  }
  const chunks = (query as { queryChunks?: unknown }).queryChunks
  if (!Array.isArray(chunks) || chunks.length === 0) {
    throw new Error(`G1: nem statikus SQL (${context}): nem nyerhető ki egyetlen queryChunk sem`)
  }
  let sqlText = ''
  for (const chunk of chunks) {
    if (!isStringChunk(chunk)) {
      throw new Error(
        `G1: nem statikus SQL (${context}): az sql template nem-szöveges chunkot tartalmaz ` +
          '(interpoláció/beágyazott paraméter) — a séma-őr kizárólag statikus SQL-t enged',
      )
    }
    sqlText += chunk.value.join('')
  }
  if (sqlText.trim().length === 0) {
    throw new Error(`G1: üres SQL-statement (${context}): a kifogott template nem hordoz tartalmat`)
  }
  return sqlText
}

/**
 * Karakter-szkenneres statement-splittelés:
 *  1. a `--` sorvégig-megjegyzéseket (aposztróf-tudatosan) eltávolítja — a
 *     20260730_080404_sync_schema_code up() template-je magyarázó
 *     megjegyzést hordoz a visszatöltő UPDATE előtt;
 *  2. top-level `;` mentén vág (az aposztróf-literálokban, az '' escape-párral
 *     együtt, a pontosvessző nem választójel);
 *  3. a darabokat whitespace-normalizálja, az üresek eldobja.
 */
export function splitSqlStatements(sqlText: string): string[] {
  const rawParts: string[] = []
  let current = ''
  let inQuote = false
  let index = 0
  while (index < sqlText.length) {
    const ch = sqlText[index]
    if (inQuote) {
      current += ch
      if (ch === "'") {
        if (sqlText[index + 1] === "'") {
          current += "'"
          index += 2
          continue
        }
        inQuote = false
      }
      index += 1
      continue
    }
    if (ch === "'") {
      inQuote = true
      current += ch
      index += 1
      continue
    }
    if (ch === '-' && sqlText[index + 1] === '-') {
      while (index < sqlText.length && sqlText[index] !== '\n') {
        index += 1
      }
      continue
    }
    if (ch === ';') {
      rawParts.push(current)
      current = ''
      index += 1
      continue
    }
    current += ch
    index += 1
  }
  rawParts.push(current)
  return rawParts.map((part) => part.replace(/\s+/g, ' ').trim()).filter((part) => part.length > 0)
}

/**
 * Egy datált migrációs fájl up() VAGY down() függvényének lefuttatása
 * ál-adapterrel, és a kifogott SQL statement-lista visszaadása. A dinamikus
 * import miatt a migrációk csak itt, a teszt-folyamatban töltődnek be.
 */
export async function captureMigrationStatements(
  fileName: string,
  direction: 'up' | 'down',
): Promise<string[]> {
  const baseName = fileName.replace(/\.ts$/, '')
  const rawModule: unknown = await import(`../../migrations/${baseName}.ts`)
  const migration = asMigrationModule(rawModule, fileName)
  const captured: unknown[] = []
  const db = createFakeDb((query) => {
    captured.push(query)
  })
  const payload = createThrowingProxy('payload')
  const req = createThrowingProxy('req')
  await migration[direction]({ db, payload, req })
  const statements: string[] = []
  for (const query of captured) {
    statements.push(...splitSqlStatements(extractSqlFromQuery(query, `${fileName} ${direction}()`)))
  }
  return statements
}

// ---------------------------------------------------------------------------
// Statement-osztályozás (whitelist) és replay-alkalmazók.
//
// A családlista a 13 datált migráció TÉNYLEGES statement-készletét fedi le
// (az Architect-mérés + pozitív kontroll alapján). Az UP-oldali replayhez
// minden up-családhoz tartozik alkalmazó; a DOWN csak parse-olt, így a
// down-only családok (DROP TABLE/DROP COLUMN/DROP CONSTRAINT/DROP DEFAULT/
// RLS-átállítás) ismertek, de replay-kezelőjük szándékosan nincs — ha egy
// jövőbeli up() ilyet hozna, az hangos bukás, nem csendes átengedés.
// ---------------------------------------------------------------------------

export type StatementKind =
  | 'create-type-as-enum'
  | 'alter-type-add-value'
  | 'create-table'
  | 'add-foreign-key'
  | 'drop-constraint'
  | 'create-index'
  | 'drop-index'
  | 'add-column'
  | 'drop-column'
  | 'set-data-type'
  | 'set-default'
  | 'drop-default'
  | 'drop-not-null'
  | 'set-not-null'
  | 'disable-rls'
  | 'enable-rls'
  | 'drop-table'
  | 'drop-type'
  | 'update-backfill-literal'

const STATEMENT_PATTERNS: ReadonlyArray<readonly [StatementKind, RegExp]> = [
  ['create-type-as-enum', /^CREATE TYPE "(?:[a-zA-Z0-9_]+"\.)?"[a-zA-Z0-9_]+" AS ENUM\(/],
  ['alter-type-add-value', /^ALTER TYPE "(?:[a-zA-Z0-9_]+"\.)?"[a-zA-Z0-9_]+" ADD VALUE /],
  ['create-table', /^CREATE TABLE "[a-zA-Z0-9_]+" \(/],
  ['add-foreign-key', /^ALTER TABLE "[a-zA-Z0-9_]+" ADD CONSTRAINT "[a-zA-Z0-9_]+" FOREIGN KEY /],
  ['drop-constraint', /^ALTER TABLE "[a-zA-Z0-9_]+" DROP CONSTRAINT "[a-zA-Z0-9_]+"$/],
  ['create-index', /^CREATE (?:UNIQUE )?INDEX "[a-zA-Z0-9_]+" ON "[a-zA-Z0-9_]+" USING btree \(/],
  ['drop-index', /^DROP INDEX "[a-zA-Z0-9_]+"$/],
  ['add-column', /^ALTER TABLE "[a-zA-Z0-9_]+" ADD COLUMN /],
  ['drop-column', /^ALTER TABLE "[a-zA-Z0-9_]+" DROP COLUMN "[a-zA-Z0-9_]+"$/],
  ['set-data-type', /^ALTER TABLE "[a-zA-Z0-9_]+" ALTER COLUMN "[a-zA-Z0-9_]+" SET DATA TYPE /],
  ['set-default', /^ALTER TABLE "[a-zA-Z0-9_]+" ALTER COLUMN "[a-zA-Z0-9_]+" SET DEFAULT /],
  ['drop-default', /^ALTER TABLE "[a-zA-Z0-9_]+" ALTER COLUMN "[a-zA-Z0-9_]+" DROP DEFAULT$/],
  ['drop-not-null', /^ALTER TABLE "[a-zA-Z0-9_]+" ALTER COLUMN "[a-zA-Z0-9_]+" DROP NOT NULL$/],
  ['set-not-null', /^ALTER TABLE "[a-zA-Z0-9_]+" ALTER COLUMN "[a-zA-Z0-9_]+" SET NOT NULL$/],
  ['disable-rls', /^ALTER TABLE "[a-zA-Z0-9_]+" DISABLE ROW LEVEL SECURITY$/],
  ['enable-rls', /^ALTER TABLE "[a-zA-Z0-9_]+" ENABLE ROW LEVEL SECURITY$/],
  ['drop-table', /^DROP TABLE "[a-zA-Z0-9_]+" CASCADE$/],
  ['drop-type', /^DROP TYPE "(?:[a-zA-Z0-9_]+"\.)?"[a-zA-Z0-9_]+"$/],
  // A séma-semleges adat-visszatöltés EGYETLEN elfogadott DML-alakja
  // (20260730_080404_sync_schema_code: a menus.type NULL-sorok 'page'-re
  // töltése a NOT NULL kényszer előtt). Minden más DML ismeretlen alak.
  ['update-backfill-literal', /^UPDATE "[a-zA-Z0-9_]+" SET "[a-zA-Z0-9_]+" = '(?:[^']|'')*' WHERE "[a-zA-Z0-9_]+" IS NULL$/],
]

/**
 * A statement családjának felismerése a whitelist alapján.
 * `null` = ismeretlen alak → a hívó kötelessége a hangos bukás.
 */
export function classifyStatement(statement: string): StatementKind | null {
  for (const [kind, pattern] of STATEMENT_PATTERNS) {
    if (pattern.test(statement)) {
      return kind
    }
  }
  return null
}

/** A replay által kezelt (up-oldali) családok — a többi parse-only. */
const REPLAYABLE_KINDS: ReadonlySet<StatementKind> = new Set([
  'create-type-as-enum',
  'alter-type-add-value',
  'create-table',
  'add-foreign-key',
  'create-index',
  'drop-index',
  'add-column',
  'set-data-type',
  'set-default',
  'drop-not-null',
  'set-not-null',
  'drop-type',
  'update-backfill-literal',
])

// ---------------------------------------------------------------------------
// SQL-oldali normalizálók — a snapshot-cella-alakokhoz igazodva.
// ---------------------------------------------------------------------------

/**
 * Típus-normalizálás: a séma-minősített, idézett enum-hivatkozás
 * (`"public"."enum_x"` vagy `"enum_x"`) csupasz névre egyszerűsödik; minden
 * más típus (serial, varchar, timestamp(3) with time zone, jsonb, …) változatlan.
 */
function normalizeTypeName(rawType: string): string {
  const enumMatch = rawType.trim().match(/^(?:"[a-zA-Z0-9_]+"\.)?"([a-zA-Z0-9_]+)"$/)
  if (enumMatch !== null) {
    return enumMatch[1]
  }
  return rawType.trim()
}

/**
 * Alapértelmezés-normalizálás: a végleges `::típus` castek (`::text`,
 * `::"public"."enum_x"`, esetleg láncolva) levesve — a snapshot a cast nélküli
 * cella-alakot őrzi (`'created'`, `'page'`). A szöveg-literálok ('' escape
 * párral), a `now()`, a szám- és logikai literálok változatlanok.
 */
function normalizeDefaultExpr(rawDefault: string): string {
  let expr = rawDefault.trim()
  for (;;) {
    const castMatch = expr.match(/^(.*?)::(?:"[a-z]+"\.)?"?[a-zA-Z0-9_]+"?$/s)
    if (castMatch === null) {
      break
    }
    expr = castMatch[1].trim()
  }
  return expr
}

/** `'a', 'b', 'c'` alakú literállista parse-olása ('' escape-tudatos); hibás alakra `null`. */
function parseStringLiteralList(body: string): string[] | null {
  const values: string[] = []
  let index = 0
  const consumeWhitespace = (): void => {
    while (index < body.length && /\s/.test(body[index])) {
      index += 1
    }
  }
  consumeWhitespace()
  for (;;) {
    if (body[index] !== "'") {
      return null
    }
    index += 1
    let value = ''
    for (;;) {
      if (index >= body.length) {
        return null
      }
      if (body[index] === "'") {
        if (body[index + 1] === "'") {
          value += "'"
          index += 2
          continue
        }
        index += 1
        break
      }
      value += body[index]
      index += 1
    }
    values.push(value)
    consumeWhitespace()
    if (index >= body.length) {
      break
    }
    if (body[index] !== ',') {
      return null
    }
    index += 1
    consumeWhitespace()
  }
  return values
}

/** `"a","b"` alakú idézett névlista parse-olása; hibás alakra `null`. */
function parseQuotedNameList(body: string): string[] | null {
  const names: string[] = []
  for (const part of body.split(',')) {
    const match = part.trim().match(/^"([a-zA-Z0-9_]+)"$/)
    if (match === null) {
      return null
    }
    names.push(match[1])
  }
  return names
}

/** Top-level vessző-menti vágás CREATE TABLE törzsben (zárójel- és aposztróf-tudatos). */
function splitTopLevelComma(body: string): string[] {
  const parts: string[] = []
  let depth = 0
  let inQuote = false
  let current = ''
  let index = 0
  while (index < body.length) {
    const ch = body[index]
    if (inQuote) {
      current += ch
      if (ch === "'") {
        if (body[index + 1] === "'") {
          current += "'"
          index += 2
          continue
        }
        inQuote = false
      }
      index += 1
      continue
    }
    if (ch === "'") {
      inQuote = true
      current += ch
      index += 1
      continue
    }
    if (ch === '(') {
      depth += 1
    } else if (ch === ')') {
      depth -= 1
    }
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
      index += 1
      continue
    }
    current += ch
    index += 1
  }
  parts.push(current)
  return parts.map((part) => part.trim()).filter((part) => part.length > 0)
}

/**
 * Oszlopdefiníció-farak (típus + PRIMARY KEY + NOT NULL + DEFAULT) parse-olása.
 * A CREATE TABLE törzs darabjaiból és az ADD COLUMN faragványaiból egyaránt
 * dolgozik. `null` = a darab nem oszlopdefiníció (pl. tábla-szintű kényszer)
 * → a hívó hangosan elhasal.
 */
function parseColumnTail(
  tail: string,
): { column: CanonicalColumn } | null {
  const defaultMatch = tail.match(/\bDEFAULT\s+(.+?)(?:\s+NOT\s+NULL|\s+PRIMARY\s+KEY)?$/)
  const primaryKey = /\bPRIMARY KEY\b/.test(tail)
  const notNull = /\bNOT NULL\b/.test(tail)
  let typePart = tail
  let defaultValue: string | undefined
  if (defaultMatch !== null && defaultMatch.index !== undefined) {
    defaultValue = normalizeDefaultExpr(defaultMatch[1])
    typePart = tail.slice(0, defaultMatch.index).trim()
  }
  const typeName = normalizeTypeName(
    typePart.replace(/\s+PRIMARY\s+KEY\b/g, '').replace(/\s+NOT\s+NULL\b/g, '').trim(),
  )
  if (typeName.length === 0) {
    return null
  }
  const column: CanonicalColumn = { type: typeName, notNull, primaryKey }
  if (defaultValue !== undefined) {
    column.default = defaultValue
  }
  return { column }
}

// ---------------------------------------------------------------------------
// A replay-alkalmazók — mindegyik hangosan elhasal, ha a statement nem a
// várt alakú, vagy a séma-modell ellentmondana neki.
// ---------------------------------------------------------------------------

function fail(context: string, reason: string): never {
  throw new Error(`G1 replay-hiba (${context}): ${reason}`)
}

function requireTable(schema: CanonicalSchema, tableName: string, context: string): CanonicalTable {
  const table = schema.tables[tableName]
  if (table === undefined) {
    fail(context, `a(z) "${tableName}" tábla nem létezik a replay-modellben`)
  }
  return table
}

function requireColumn(schema: CanonicalSchema, tableName: string, columnName: string, context: string): CanonicalColumn {
  const table = requireTable(schema, tableName, context)
  const column = table.columns[columnName]
  if (column === undefined) {
    fail(context, `a(z) "${tableName}"."${columnName}" oszlop nem létezik a replay-modellben`)
  }
  return column
}

function applyCreateTypeAsEnum(schema: CanonicalSchema, statement: string, context: string): void {
  const match = statement.match(/^CREATE TYPE "(?:[a-zA-Z0-9_]+"\.)?"([a-zA-Z0-9_]+)" AS ENUM\((.*)\)$/)
  if (match === null) {
    fail(context, `feldolgozhatatlan CREATE TYPE: ${statement}`)
  }
  const values = parseStringLiteralList(match[2])
  if (values === null) {
    fail(context, `feldolgozhatatlan enum-értéklista: ${statement}`)
  }
  if (schema.enums[match[1]] !== undefined) {
    fail(context, `a(z) "${match[1]}" enum már létezik (ismételt CREATE TYPE előzetes DROP TYPE nélkül)`)
  }
  schema.enums[match[1]] = values
}

function applyAlterTypeAddValue(schema: CanonicalSchema, statement: string, context: string): void {
  const match = statement.match(
    /^ALTER TYPE "(?:[a-zA-Z0-9_]+"\.)?"([a-zA-Z0-9_]+)" ADD VALUE '((?:[^']|'')*)'(?: (BEFORE|AFTER) '((?:[^']|'')*)')?$/,
  )
  if (match === null) {
    fail(context, `feldolgozhatatlan ALTER TYPE ADD VALUE: ${statement}`)
  }
  const enumValues = schema.enums[match[1]]
  if (enumValues === undefined) {
    fail(context, `a(z) "${match[1]}" enum nem létezik a replay-modellben`)
  }
  const newValue = match[2].replace(/''/g, "'")
  if (match[3] === undefined) {
    enumValues.push(newValue)
    return
  }
  const anchor = match[4].replace(/''/g, "'")
  const anchorIndex = enumValues.indexOf(anchor)
  if (anchorIndex === -1) {
    fail(context, `a(z) "${match[1]}" enum "${anchor}" értéke nem létezik (BEFORE/AFTER horgony)`)
  }
  enumValues.splice(match[3] === 'BEFORE' ? anchorIndex : anchorIndex + 1, 0, newValue)
}

function applyCreateTable(schema: CanonicalSchema, statement: string, context: string): void {
  const match = statement.match(/^CREATE TABLE "([a-zA-Z0-9_]+)" \((.*)\)$/)
  if (match === null) {
    fail(context, `feldolgozhatatlan CREATE TABLE: ${statement}`)
  }
  const tableName = match[1]
  if (schema.tables[tableName] !== undefined) {
    fail(context, `a(z) "${tableName}" tábla már létezik (ismételt CREATE TABLE)`)
  }
  const columns: Record<string, CanonicalColumn> = {}
  for (const item of splitTopLevelComma(match[2])) {
    const itemMatch = item.match(/^"([a-zA-Z0-9_]+)" (.+)$/)
    if (itemMatch === null) {
      fail(context, `a(z) "${tableName}" CREATE TABLE nem-oszlop tételt tartalmaz: ${item}`)
    }
    const parsed = parseColumnTail(itemMatch[2])
    if (parsed === null) {
      fail(context, `a(z) "${tableName}"."${itemMatch[1]}" oszlopdefiníciója feldolgozhatatlan: ${itemMatch[2]}`)
    }
    columns[itemMatch[1]] = parsed.column
  }
  schema.tables[tableName] = { columns, indexes: {}, foreignKeys: {} }
}

function applyAddForeignKey(schema: CanonicalSchema, statement: string, context: string): void {
  const match = statement.match(
    /^ALTER TABLE "([a-zA-Z0-9_]+)" ADD CONSTRAINT "([a-zA-Z0-9_]+)" FOREIGN KEY \(([^)]+)\) REFERENCES "(?:[a-zA-Z0-9_]+"\.)?"([a-zA-Z0-9_]+)"\(([^)]+)\) ON DELETE ([a-z]+(?: [a-z]+)*) ON UPDATE ([a-z]+(?: [a-z]+)*)$/,
  )
  if (match === null) {
    fail(context, `feldolgozhatatlan ADD CONSTRAINT FOREIGN KEY: ${statement}`)
  }
  const [, tableName, fkName, columnsFromRaw, tableTo, columnsToRaw, onDelete, onUpdate] = match
  const columnsFrom = parseQuotedNameList(columnsFromRaw)
  const columnsTo = parseQuotedNameList(columnsToRaw)
  if (columnsFrom === null || columnsTo === null) {
    fail(context, `feldolgozhatatlan FK-oszloplista: ${statement}`)
  }
  const table = requireTable(schema, tableName, context)
  requireTable(schema, tableTo, context)
  for (const columnName of columnsFrom) {
    requireColumn(schema, tableName, columnName, context)
  }
  for (const columnName of columnsTo) {
    requireColumn(schema, tableTo, columnName, context)
  }
  if (table.foreignKeys[fkName] !== undefined) {
    fail(context, `a(z) "${fkName}" idegen kulcs már létezik a(z) "${tableName}" táblán`)
  }
  table.foreignKeys[fkName] = { tableTo, columnsFrom, columnsTo, onDelete, onUpdate }
}

function applyCreateIndex(schema: CanonicalSchema, statement: string, context: string): void {
  const match = statement.match(/^CREATE (UNIQUE )?INDEX "([a-zA-Z0-9_]+)" ON "([a-zA-Z0-9_]+)" USING btree \(([^)]+)\)$/)
  if (match === null) {
    fail(context, `feldolgozhatatlan CREATE INDEX: ${statement}`)
  }
  const [, uniqueFlag, indexName, tableName, columnsRaw] = match
  const columns = parseQuotedNameList(columnsRaw)
  if (columns === null) {
    fail(context, `feldolgozhatatlan index-oszloplista: ${statement}`)
  }
  const table = requireTable(schema, tableName, context)
  for (const columnName of columns) {
    requireColumn(schema, tableName, columnName, context)
  }
  if (table.indexes[indexName] !== undefined) {
    fail(context, `a(z) "${indexName}" index már létezik a(z) "${tableName}" táblán`)
  }
  table.indexes[indexName] = { columns, unique: uniqueFlag !== undefined }
}

function applyDropIndex(schema: CanonicalSchema, statement: string, context: string): void {
  const match = statement.match(/^DROP INDEX "([a-zA-Z0-9_]+)"$/)
  if (match === null) {
    fail(context, `feldolgozhatatlan DROP INDEX: ${statement}`)
  }
  const indexName = match[1]
  for (const table of Object.values(schema.tables)) {
    if (table.indexes[indexName] !== undefined) {
      delete table.indexes[indexName]
      return
    }
  }
  fail(context, `a(z) "${indexName}" index egyik táblán sem létezik a replay-modellben`)
}

function applyAddColumn(schema: CanonicalSchema, statement: string, context: string): void {
  const match = statement.match(/^ALTER TABLE "([a-zA-Z0-9_]+)" ADD COLUMN "([a-zA-Z0-9_]+)" (.+)$/)
  if (match === null) {
    fail(context, `feldolgozhatatlan ADD COLUMN: ${statement}`)
  }
  const [, tableName, columnName, tail] = match
  const parsed = parseColumnTail(tail)
  if (parsed === null) {
    fail(context, `feldolgozhatatlan ADD COLUMN faragvány: ${statement}`)
  }
  const table = requireTable(schema, tableName, context)
  if (table.columns[columnName] !== undefined) {
    fail(context, `a(z) "${tableName}"."${columnName}" oszlop már létezik`)
  }
  table.columns[columnName] = parsed.column
}

function applySetDataType(schema: CanonicalSchema, statement: string, context: string): void {
  const match = statement.match(
    /^ALTER TABLE "([a-zA-Z0-9_]+)" ALTER COLUMN "([a-zA-Z0-9_]+)" SET DATA TYPE (.+?)(?: USING .+)?$/,
  )
  if (match === null) {
    fail(context, `feldolgozhatatlan SET DATA TYPE: ${statement}`)
  }
  const column = requireColumn(schema, match[1], match[2], context)
  column.type = normalizeTypeName(match[3])
}

function applySetDefault(schema: CanonicalSchema, statement: string, context: string): void {
  const match = statement.match(/^ALTER TABLE "([a-zA-Z0-9_]+)" ALTER COLUMN "([a-zA-Z0-9_]+)" SET DEFAULT (.+)$/)
  if (match === null) {
    fail(context, `feldolgozhatatlan SET DEFAULT: ${statement}`)
  }
  const column = requireColumn(schema, match[1], match[2], context)
  column.default = normalizeDefaultExpr(match[3])
}

function applyNotNullChange(
  schema: CanonicalSchema,
  statement: string,
  notNull: boolean,
  context: string,
): void {
  const match = statement.match(/^ALTER TABLE "([a-zA-Z0-9_]+)" ALTER COLUMN "([a-zA-Z0-9_]+)" (?:DROP NOT NULL|SET NOT NULL)$/)
  if (match === null) {
    fail(context, `feldolgozhatatlan NOT NULL-átállítás: ${statement}`)
  }
  const column = requireColumn(schema, match[1], match[2], context)
  column.notNull = notNull
}

function applyDropType(schema: CanonicalSchema, statement: string, context: string): void {
  const match = statement.match(/^DROP TYPE "(?:[a-zA-Z0-9_]+"\.)?"([a-zA-Z0-9_]+)"$/)
  if (match === null) {
    fail(context, `feldolgozhatatlan DROP TYPE: ${statement}`)
  }
  if (schema.enums[match[1]] === undefined) {
    fail(context, `a(z) "${match[1]}" enum nem létezik a replay-modellben`)
  }
  delete schema.enums[match[1]]
}

/**
 * Egy statement replay-alkalmazása a sémamodellre. Ismeretlen alak → bukás;
 * ismert, de replay-kezelő nélküli (down-only) alak → bukás. A séma-semleges
 * visszatöltő UPDATE tudatos no-op.
 */
export function replayStatement(schema: CanonicalSchema, statement: string, context: string): void {
  const kind = classifyStatement(statement)
  if (kind === null) {
    fail(context, `ismeretlen statement-alak: ${statement}`)
  }
  if (!REPLAYABLE_KINDS.has(kind)) {
    fail(context, `a(z) "${kind}" statement-családhoz nincs replay-kezelő: ${statement}`)
  }
  switch (kind) {
    case 'create-type-as-enum':
      applyCreateTypeAsEnum(schema, statement, context)
      return
    case 'alter-type-add-value':
      applyAlterTypeAddValue(schema, statement, context)
      return
    case 'create-table':
      applyCreateTable(schema, statement, context)
      return
    case 'add-foreign-key':
      applyAddForeignKey(schema, statement, context)
      return
    case 'create-index':
      applyCreateIndex(schema, statement, context)
      return
    case 'drop-index':
      applyDropIndex(schema, statement, context)
      return
    case 'add-column':
      applyAddColumn(schema, statement, context)
      return
    case 'set-data-type':
      applySetDataType(schema, statement, context)
      return
    case 'set-default':
      applySetDefault(schema, statement, context)
      return
    case 'drop-not-null':
      applyNotNullChange(schema, statement, false, context)
      return
    case 'set-not-null':
      applyNotNullChange(schema, statement, true, context)
      return
    case 'drop-type':
      applyDropType(schema, statement, context)
      return
    case 'update-backfill-literal':
      // Séma-semleges adat-visszatöltés (a whitelist már a szigorú
      // `SET "c" = '<lit>' WHERE "c" IS NULL` alakra szűkített) — a
      // sémamodellen nincs hatása, tudatos no-op.
      return
    default:
      fail(context, `le nem fedett replay-ág: ${kind}`)
  }
}
