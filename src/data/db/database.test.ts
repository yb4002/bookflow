import { describe, expect, it, vi } from 'vitest'
import { Database } from './database'
import { MemoryStorage } from './storage'
import { normalizers } from './normalize'
import { SCHEMA_VERSION } from './schema'

const seed = () => ({
  businesses: [{ id: 'b1', slug: 'one', name: 'One' } as never],
  services: [{ id: 's1', businessId: 'b1', name: 'Cut' } as never],
})

describe('Database', () => {
  it('seeds empty storage once and keeps data across instances (reloads)', () => {
    const storage = new MemoryStorage()
    const seedFn = vi.fn(seed)
    const db1 = new Database(storage, { seed: seedFn })
    db1.table('services').update('s1', { name: 'Haircut' })
    const db2 = new Database(storage, { seed: seedFn })
    expect(seedFn).toHaveBeenCalledTimes(1)
    expect(db2.table('services').get('s1')?.name).toBe('Haircut')
    expect(db2.meta().schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('batches writes: one persist and one change event per batch', () => {
    const storage = new MemoryStorage()
    const db = new Database(storage, { seed })
    const set = vi.spyOn(storage, 'set')
    const listener = vi.fn()
    db.onChange(listener)
    db.batch(() => {
      db.table('services').insert({ id: 's2', businessId: 'b1', name: 'Color' } as never)
      db.table('services').insert({ id: 's3', businessId: 'b1', name: 'Gloss' } as never)
      db.table('businesses').update('b1', { name: 'One Studio' })
    })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0].sort()).toEqual(['businesses', 'services'])
    expect(set).toHaveBeenCalledTimes(2)
  })

  it('rejects duplicate ids and missing rows', () => {
    const db = new Database(new MemoryStorage(), { seed })
    expect(() => db.table('services').insert({ id: 's1' } as never)).toThrow(/Duplicate/)
    expect(() => db.table('services').update('nope', {})).toThrow(/not found/)
  })

  it('reset reseeds and notifies', () => {
    const db = new Database(new MemoryStorage(), { seed })
    db.table('services').remove('s1')
    const listener = vi.fn()
    db.onChange(listener)
    db.reset()
    expect(db.table('services').get('s1')).toBeDefined()
    expect(listener).toHaveBeenCalled()
  })

  it('normalizes rows stored before multi-tenancy and settings existed', () => {
    const storage = new MemoryStorage()
    storage.set('legacy:meta', JSON.stringify({ schemaVersion: SCHEMA_VERSION, seededAt: '2026-01-01' }))
    storage.set(`legacy:v${SCHEMA_VERSION}:businesses`, JSON.stringify([{ id: 'biz_1', slug: 'luna-hair', bookingUrl: 'x', currency: 'USD' }]))
    storage.set(`legacy:v${SCHEMA_VERSION}:appointments`, JSON.stringify([{ id: 'a1' }]))
    const db = new Database(storage, { namespace: 'legacy', seed: () => ({}), normalize: normalizers })
    const b = db.table('businesses').get('biz_1')!
    expect(b.settings).toEqual({ defaultLanguage: 'en', currency: 'auto' })
    expect('bookingUrl' in b).toBe(false)
    expect(db.table('appointments').get('a1')?.businessId).toBe('biz_1')
  })

  it('refuses data written by a newer schema', () => {
    const storage = new MemoryStorage()
    storage.set('bookflow:meta', JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, seededAt: '' }))
    expect(() => new Database(storage, { seed })).toThrow(/newer/)
  })

  it('reloads a table when another tab writes it', () => {
    const listeners: ((key: string) => void)[] = []
    const storage = Object.assign(new MemoryStorage(), { subscribe: (l: (key: string) => void) => (listeners.push(l), () => {}) })
    const db = new Database(storage, { seed })
    expect(db.table('services').get('s1')?.name).toBe('Cut')
    const onChange = vi.fn()
    db.onChange(onChange)
    // Simulate another tab writing the services table
    storage.set(`bookflow:v${SCHEMA_VERSION}:services`, JSON.stringify([{ id: 's1', businessId: 'b1', name: 'Renamed elsewhere' }]))
    listeners.forEach((l) => l(`bookflow:v${SCHEMA_VERSION}:services`))
    expect(onChange).toHaveBeenCalledWith(['services'], 'remote')
    expect(db.table('services').get('s1')?.name).toBe('Renamed elsewhere')
  })
})
