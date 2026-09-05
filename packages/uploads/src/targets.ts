import { UploadError } from './errors.js'
import type { StorageProvider, StorageTargets } from './types.js'

/**
 * Names each provider after its key so that `targets.avatars` works for direct
 * access and `targets[upload.target]` works for lookup from a database row.
 * Returns the same object, typed.
 */
export function defineStorageTargets<T extends StorageTargets>(targets: T): T {
  for (const [name, provider] of Object.entries(targets)) {
    provider.name = name
  }

  return targets
}

/**
 * Looks a target up by name, throwing an `UploadError` with code
 * `UNKNOWN_TARGET` that lists the configured names when it is missing. Use it
 * when the name comes from an `Upload` row's `target` column.
 */
export function resolveTarget(
  targets: StorageTargets,
  name: string,
): StorageProvider {
  // Own-property check so inherited names such as `toString` cannot
  // resolve to a non-provider value
  const target = Object.hasOwn(targets, name) ? targets[name] : undefined

  if (!target) {
    throw new UploadError(
      'UNKNOWN_TARGET',
      `Unknown storage target '${name}'. Available targets: ` +
        `${Object.keys(targets).join(', ') || '(none)'}.`,
    )
  }

  return target
}
