import { UploadError } from '../errors.js'
import type { StorageProvider } from '../types.js'

/**
 * Marks a target whose bytes live inline in the `Upload.data` column. The
 * provider itself owns no storage: `storeFile()` writes the row and the
 * `@withSignedUrl` / `@withDataUri` directives read it back as a `data:` URI.
 * Every method that would need external storage throws.
 */
export function createDbProvider(): StorageProvider {
  const notSupported = (operation: string) =>
    new UploadError(
      'NOT_SUPPORTED',
      `The DB storage target '${provider.name}' keeps bytes inline in the ` +
        `Upload row, so \`${operation}\` is not available. Use storeFile() ` +
        'to write and the Upload row itself to read.',
    )

  const provider: StorageProvider = {
    name: '',
    providerType: 'db',

    async write() {
      throw notSupported('write')
    },

    async read() {
      throw notSupported('read')
    },

    async delete() {
      // Deleting the Upload row deletes the bytes
    },

    async exists() {
      return false
    },

    async getObjectSize() {
      return null
    },

    async getSignedReadUrl() {
      throw notSupported('getSignedReadUrl')
    },

    async getPresignedUploadUrl() {
      throw new UploadError(
        'PRESIGN_NOT_SUPPORTED',
        `The DB storage target '${provider.name}' does not support ` +
          'presigned uploads. Send the file as base64 through GraphQL and ' +
          'call storeFile() in the service.',
      )
    },

    getConfig() {
      return {}
    },
  }

  return provider
}
