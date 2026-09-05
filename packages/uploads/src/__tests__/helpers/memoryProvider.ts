import { UploadError } from '../../errors.js'
import type { StorageProvider } from '../../types.js'

/**
 * An in-memory object-storage provider for tests. `presign` controls whether
 * `getPresignedUploadUrl` works (S3-like) or throws (FS-like).
 */
export function createMemoryProvider(
  options: { providerType?: string; presign?: boolean; bucket?: string } = {},
): StorageProvider & { objects: Map<string, Buffer> } {
  const {
    providerType = 'memory',
    presign = false,
    bucket = 'bucket',
  } = options
  const objects = new Map<string, Buffer>()

  const provider: StorageProvider & { objects: Map<string, Buffer> } = {
    name: '',
    providerType,
    objects,

    async write(key, data) {
      objects.set(key, Buffer.from(data))
    },

    async read(key) {
      const data = objects.get(key)

      if (!data) {
        throw new Error(`No object '${key}'`)
      }

      return data
    },

    async delete(key) {
      objects.delete(key)
    },

    async exists(key) {
      return objects.has(key)
    },

    async getObjectSize(key) {
      return objects.get(key)?.byteLength ?? null
    },

    async getSignedReadUrl(key, opts = {}) {
      return `memory://${provider.name}/${key}?disposition=${opts.disposition ?? 'attachment'}`
    },

    async getPresignedUploadUrl(key, { contentType }) {
      if (!presign) {
        throw new UploadError('PRESIGN_NOT_SUPPORTED', 'no presign')
      }

      return {
        url: `https://${bucket}.example.com/${key}`,
        method: 'PUT',
        headers: { 'Content-Type': contentType },
      }
    },

    getConfig() {
      return { bucket, keyPrefix: '' }
    },
  }

  return provider
}
