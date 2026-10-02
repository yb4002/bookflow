import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BookingError } from '../../src/domain/errors'
import type { ImageKind } from '../../src/data/repositories/types'
import type { ImageStore } from '../repositories/sqlRepository'

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const TYPES = {
  png: { mime: 'image/png', magic: (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  jpeg: { mime: 'image/jpeg', magic: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  webp: { mime: 'image/webp', magic: (b: Buffer) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
} as const
type Ext = keyof typeof TYPES
const EXT_FILE = /^(logo|cover)-[a-f0-9]{16}\.(png|jpeg|webp)$/
const ID = /^[A-Za-z0-9_-]{1,64}$/
export const ASSET_PREFIX = '/api/assets'

/**
 * Logo/cover storage on the local filesystem (use a persistent volume in production;
 * swap for S3/R2 by implementing ImageStore). Uploads are validated by declared type
 * AND file signature, size-capped, and stored under random names per business, so a
 * client never controls a path.
 */
export function createFileImageStore(rootDir: string): ImageStore & { read(businessId: string, file: string): { data: Buffer; mime: string } | null } {
  mkdirSync(rootDir, { recursive: true })
  return {
    save(businessId: string, kind: ImageKind, dataUrl: string) {
      const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+=*)$/.exec(dataUrl)
      if (!match || !ID.test(businessId)) throw new BookingError('invalid_image')
      const ext = match[1] as Ext
      const data = Buffer.from(match[2], 'base64')
      if (data.length === 0 || data.length > MAX_IMAGE_BYTES || !TYPES[ext].magic(data)) throw new BookingError('invalid_image')
      const dir = join(rootDir, businessId)
      mkdirSync(dir, { recursive: true })
      const file = `${kind}-${randomBytes(8).toString('hex')}.${ext}`
      writeFileSync(join(dir, file), data)
      return `${ASSET_PREFIX}/${businessId}/${file}`
    },
    remove(url: string) {
      const m = new RegExp(`^${ASSET_PREFIX}/([^/]+)/([^/]+)$`).exec(url)
      if (!m || !ID.test(m[1]) || !EXT_FILE.test(m[2])) return
      rmSync(join(rootDir, m[1], m[2]), { force: true })
    },
    read(businessId: string, file: string) {
      if (!ID.test(businessId) || !EXT_FILE.test(file)) return null
      const path = join(rootDir, businessId, file)
      if (!existsSync(path)) return null
      const ext = file.split('.').pop() as Ext
      return { data: readFileSync(path), mime: TYPES[ext].mime }
    },
  }
}
