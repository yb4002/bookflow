import type { ID } from '@/domain/types'
import { SCHEMA_VERSION, TABLE_NAMES, type DbMeta, type Row, type TableName, type Tables } from './schema'
import type { StorageAdapter } from './storage'

export type ChangeOrigin = 'local' | 'remote'
export type ChangeListener = (tables: TableName[], origin: ChangeOrigin) => void
export type SeedData = { [K in TableName]?: Tables[K][] }

export interface DatabaseOptions {
  /** Key namespace, e.g. "bookflow". Lets several databases share one storage. */
  namespace?: string
  /** Produces the initial dataset when storage is empty (or on reset). */
  seed: () => SeedData
  /** Fills in fields added after a record was stored (keeps old data loadable). */
  normalize?: { [K in TableName]?: (row: Tables[K]) => Tables[K] }
}

/** Typed table over an in-memory cache that is written through to storage. */
export class Table<T extends Row> {
  constructor(
    private readonly rows: () => Map<ID, T>,
    private readonly touch: () => void,
  ) {}

  all(): T[] {
    return [...this.rows().values()]
  }
  get(id: ID): T | undefined {
    return this.rows().get(id)
  }
  where(predicate: (row: T) => boolean): T[] {
    return this.all().filter(predicate)
  }
  find(predicate: (row: T) => boolean): T | undefined {
    for (const row of this.rows().values()) if (predicate(row)) return row
    return undefined
  }
  insert(row: T): T {
    const rows = this.rows()
    if (rows.has(row.id)) throw new Error(`Duplicate id ${row.id}`)
    rows.set(row.id, row)
    this.touch()
    return row
  }
  /** Shallow-merges `patch`; returns the updated row. */
  update(id: ID, patch: Partial<T>): T {
    const rows = this.rows()
    const current = rows.get(id)
    if (!current) throw new Error(`Row ${id} not found`)
    const next = { ...current, ...patch, id }
    rows.set(id, next)
    this.touch()
    return next
  }
  upsert(row: T): T {
    this.rows().set(row.id, row)
    this.touch()
    return row
  }
  remove(id: ID): void {
    if (this.rows().delete(id)) this.touch()
  }
}

/**
 * Local-first database: typed tables, schema versioning, write-through persistence,
 * batched writes and change notifications (including from other browser tabs).
 * Synchronous internally; the repository layer exposes it asynchronously, the same
 * shape a remote database will have.
 */
export class Database {
  private readonly ns: string
  private cache = new Map<TableName, Map<ID, Row>>()
  private dirty = new Set<TableName>()
  private batchDepth = 0
  private listeners = new Set<ChangeListener>()
  private unsubscribeStorage?: () => void

  constructor(
    private readonly storage: StorageAdapter,
    private readonly options: DatabaseOptions,
  ) {
    this.ns = options.namespace ?? 'bookflow'
    this.unsubscribeStorage = storage.subscribe?.((key) => this.onExternalWrite(key))
    this.ensureInitialized()
  }

  get durable() {
    return this.storage.durable
  }

  table<K extends TableName>(name: K): Table<Tables[K]> {
    return new Table<Tables[K]>(
      () => this.rows(name) as Map<ID, Tables[K]>,
      () => this.markDirty(name),
    )
  }

  /** Runs several writes as one unit: persisted together, announced once. */
  batch<R>(fn: () => R): R {
    this.batchDepth++
    try {
      return fn()
    } finally {
      this.batchDepth--
      if (this.batchDepth === 0) this.flush()
    }
  }

  meta(): DbMeta {
    return JSON.parse(this.storage.get(this.metaKey())!) as DbMeta
  }

  /** Wipes every table and seeds a fresh dataset. */
  reset(): void {
    for (const name of TABLE_NAMES) this.storage.remove(this.tableKey(name))
    this.storage.remove(this.metaKey())
    this.cache.clear()
    this.ensureInitialized()
    this.emit([...TABLE_NAMES], 'local')
  }

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close() {
    this.unsubscribeStorage?.()
    this.listeners.clear()
  }

  /* ---------------- internals ---------------- */

  private metaKey = () => `${this.ns}:meta`
  private tableKey = (name: TableName) => `${this.ns}:v${SCHEMA_VERSION}:${name}`

  private ensureInitialized() {
    const raw = this.storage.get(this.metaKey())
    const meta = raw ? (JSON.parse(raw) as DbMeta) : null
    if (meta && meta.schemaVersion === SCHEMA_VERSION) return
    if (meta && meta.schemaVersion > SCHEMA_VERSION) throw new Error('Stored data is from a newer BookFlow version')
    // No data (or an older schema with no migration path yet): seed.
    // Future: run `migrations[meta.schemaVersion]` here instead of reseeding.
    const seed = this.options.seed()
    for (const name of TABLE_NAMES) this.storage.set(this.tableKey(name), JSON.stringify(seed[name] ?? []))
    this.storage.set(this.metaKey(), JSON.stringify({ schemaVersion: SCHEMA_VERSION, seededAt: new Date().toISOString() } satisfies DbMeta))
  }

  private rows(name: TableName): Map<ID, Row> {
    let rows = this.cache.get(name)
    if (!rows) {
      const raw = this.storage.get(this.tableKey(name))
      const list = raw ? (JSON.parse(raw) as Row[]) : []
      const normalize = this.options.normalize?.[name] as ((r: Row) => Row) | undefined
      rows = new Map(list.map((r) => {
        const row = normalize ? normalize(r) : r
        return [row.id, row]
      }))
      this.cache.set(name, rows)
    }
    return rows
  }

  private markDirty(name: TableName) {
    this.dirty.add(name)
    if (this.batchDepth === 0) this.flush()
  }

  private flush() {
    if (!this.dirty.size) return
    const changed = [...this.dirty]
    this.dirty.clear()
    for (const name of changed) this.storage.set(this.tableKey(name), JSON.stringify([...this.rows(name).values()]))
    this.emit(changed, 'local')
  }

  private onExternalWrite(key: string) {
    if (key === this.metaKey()) {
      // Another tab reset the data.
      this.cache.clear()
      this.emit([...TABLE_NAMES], 'remote')
      return
    }
    const name = TABLE_NAMES.find((t) => this.tableKey(t) === key)
    if (!name) return
    this.cache.delete(name) // reload lazily on next access
    this.emit([name], 'remote')
  }

  private emit(tables: TableName[], origin: ChangeOrigin) {
    for (const l of this.listeners) l(tables, origin)
  }
}
