import type { UploadDatabase, UploadRecord } from './types.js'

interface Pending {
  resolve: (upload: UploadRecord | null) => void
  reject: (e: unknown) => void
}

interface Loader {
  cache: Map<string, Promise<UploadRecord | null>>
  queue: Map<string, Pending[]>
  scheduled: boolean
}

const loaders = new WeakMap<object, Loader>()

function flush(loader: Loader, db: UploadDatabase) {
  loader.scheduled = false

  const batch = loader.queue
  loader.queue = new Map()

  const ids = [...batch.keys()]

  db.upload
    .findMany({ where: { id: { in: ids } }, omit: { data: true } })
    .then((rows) => {
      const byId = new Map(rows.map((row) => [row.id, row]))

      for (const [id, waiters] of batch) {
        const row = byId.get(id) ?? null
        for (const waiter of waiters) {
          waiter.resolve(row)
        }
      }
    })
    .catch((e: unknown) => {
      for (const waiters of batch.values()) {
        for (const waiter of waiters) {
          waiter.reject(e)
        }
      }
    })
}

/**
 * Loads an `Upload` row by id, batching every call made during the same
 * tick for the same `scope` into one query. A transformer directive runs
 * once per field per row, so a list of a hundred rows would otherwise be a
 * hundred queries. Scope on the GraphQL context so the batch and its cache
 * live exactly one request. The batch query leaves out `data`, so inline
 * blobs are never dragged into memory for object-storage rows.
 */
export function loadUpload(
  scope: object,
  db: UploadDatabase,
  id: string,
): Promise<UploadRecord | null> {
  let loader = loaders.get(scope)

  if (!loader) {
    loader = { cache: new Map(), queue: new Map(), scheduled: false }
    loaders.set(scope, loader)
  }

  const cached = loader.cache.get(id)

  if (cached) {
    return cached
  }

  const promise = new Promise<UploadRecord | null>((resolve, reject) => {
    const waiters = loader.queue.get(id) ?? []
    waiters.push({ resolve, reject })
    loader.queue.set(id, waiters)
  })

  loader.cache.set(id, promise)

  if (!loader.scheduled) {
    loader.scheduled = true
    queueMicrotask(() => flush(loader, db))
  }

  return promise
}
