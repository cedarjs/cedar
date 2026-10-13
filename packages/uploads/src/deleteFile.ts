import { UploadError } from './errors.js'
import type {
  StorageProvider,
  StorageTargets,
  UploadDatabase,
  UploadRecord,
  UploadVariantDatabase,
} from './types.js'
import { deleteVariants } from './variants.js'

export type DeleteFileOptions =
  | {
      db: UploadDatabase
      upload: Pick<UploadRecord, 'id' | 'storageKey'>
      targets?: undefined
    }
  | {
      db: UploadDatabase & UploadVariantDatabase
      upload: Pick<UploadRecord, 'id' | 'storageKey'>
      /**
       * Every configured storage target. When given, the upload's derived
       * files (variants: thumbnails, previews) are deleted first, from
       * whichever targets hold them. Required for an upload that has
       * variants.
       */
      targets: StorageTargets
    }

// A concurrent request can claim a new variant between deleting the
// variants and deleting the source; this many rounds settle that
const MAX_VARIANT_ROUNDS = 3

function isPrismaError(e: unknown, code: string): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && e.code === code
}

/**
 * Deletes a stored file: bytes first, then the `Upload` row. Bytes-first
 * ordering means a crash between the two steps leaves a row whose object is
 * gone, which the app can see and fix by calling again, whereas the reverse
 * order would leave an unreachable object nothing references. A missing
 * object or row is tolerated, so the call is idempotent.
 *
 * Pass `targets` to delete the upload's derived files (variants) with it.
 * Without it, deleting an upload that has variants throws an `UploadError`
 * with code `HAS_VARIANTS`, because the variant rows reference their source.
 */
export async function deleteFile(
  target: StorageProvider,
  options: DeleteFileOptions,
): Promise<void> {
  const { upload } = options

  if (upload.storageKey) {
    await target.delete(upload.storageKey)
  }

  for (let round = 1; ; round++) {
    if (options.targets) {
      await deleteVariants(upload, {
        db: options.db,
        targets: options.targets,
      })
    }

    try {
      await options.db.upload.delete({ where: { id: upload.id } })
      return
    } catch (e) {
      if (isPrismaError(e, 'P2025')) {
        return
      }

      if (!isPrismaError(e, 'P2003')) {
        throw e
      }

      if (!options.targets) {
        // Another model referencing the upload raises the same error, and
        // a schema without the variant columns rejects the query
        const hasVariants = await options.db.upload
          .count({ where: { sourceId: upload.id } })
          .then(
            (count) => count > 0,
            () => false,
          )

        if (!hasVariants) {
          throw e
        }

        throw new UploadError(
          'HAS_VARIANTS',
          `Upload '${upload.id}' has derived files (variants), so its row ` +
            'cannot be deleted on its own. Pass `targets` to deleteFile() to ' +
            'delete the variants with it, or call deleteVariants() first.',
          e,
        )
      }

      if (round >= MAX_VARIANT_ROUNDS) {
        throw e
      }
    }
  }
}
