import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { CedarDirective } from '@cedarjs/graphql-server'

import {
  createRequireUploadTokenDirective,
  createWithDataUriDirective,
  createWithSignedUrlDirective,
  getUploadTokenPayload,
  UPLOAD_TOKEN_CONTEXT_KEY,
} from '../directives.js'
import { createDbProvider } from '../providers/db.js'
import { storeFile } from '../storeFile.js'
import { defineStorageTargets } from '../targets.js'
import { loadUpload } from '../uploadLoader.js'

import { createMemoryProvider } from './helpers/memoryProvider.js'
import { db, prisma, resetTestDb } from './helpers/testDb.js'
import { SECRET, tokenFor } from './helpers/tokens.js'

/**
 * Invokes a directive the way the GraphQL plugin does. The directives under
 * test read only `context` and `resolvedValue`; `info` is typed as
 * `GraphQLResolveInfo` but never touched, so an empty object stands in for it
 * through one documented cast here instead of one at every call site.
 */
function run(
  directive: CedarDirective,
  args: { context: Record<string, unknown>; resolvedValue?: unknown },
) {
  return directive.onResolvedValue({
    root: {},
    args: {},
    directiveArgs: {},
    // GraphQLResolveInfo is not consulted by these directives
    info: {} as never,
    ...args,
  })
}

describe('@requireUploadToken', () => {
  const directive = createRequireUploadTokenDirective({ secret: SECRET })

  test('attaches the validated payload to the context', () => {
    const context: Record<string, unknown> = {
      event: { headers: { 'x-upload-token': tokenFor() } },
      currentUser: { id: 'user_1' },
    }

    run(directive, { context })

    expect(getUploadTokenPayload(context)).toMatchObject({ sub: 'user_1' })
    expect(context[UPLOAD_TOKEN_CONTEXT_KEY]).toBeDefined()
  })

  test('reads the header from a fetch Request too', () => {
    const context: Record<string, unknown> = {
      request: new Request('http://localhost/graphql', {
        headers: { 'x-upload-token': tokenFor() },
      }),
      currentUser: { id: 'user_1' },
    }

    run(directive, { context })

    expect(getUploadTokenPayload(context)).toMatchObject({ sub: 'user_1' })
  })

  test('rejects a request with no current user', () => {
    expect(() =>
      run(directive, {
        context: { event: { headers: { 'x-upload-token': tokenFor() } } },
      }),
    ).toThrow('You must be logged in to use an upload token.')
  })

  test('rejects missing, invalid, and foreign tokens', () => {
    expect(() =>
      run(directive, { context: { event: { headers: {} } } }),
    ).toThrow('Missing upload token.')

    expect(() =>
      run(directive, {
        context: { event: { headers: { 'x-upload-token': 'nope' } } },
      }),
    ).toThrow('Invalid upload token (INVALID).')

    expect(() =>
      run(directive, {
        context: {
          event: { headers: { 'x-upload-token': tokenFor() } },
          currentUser: { id: 'user_2' },
        },
      }),
    ).toThrow('Upload token was issued to a different user.')

    expect(() =>
      run(directive, {
        context: {
          event: {
            headers: {
              'x-upload-token': tokenFor({ organizationId: 'org_1' }),
            },
          },
          currentUser: { id: 'user_1', organizationId: 'org_2' },
        },
      }),
    ).toThrow('Upload token was issued for a different organization.')
  })

  test('uses getOrganizationId when provided', () => {
    const scoped = createRequireUploadTokenDirective({
      secret: SECRET,
      getOrganizationId: (context) => (context.org as { id: string }).id,
    })
    const context = {
      event: {
        headers: { 'x-upload-token': tokenFor({ organizationId: 'org_1' }) },
      },
      currentUser: { id: 'user_1' },
      org: { id: 'org_1' },
    }

    expect(() => run(scoped, { context })).not.toThrow()
  })

  test('getUploadTokenPayload throws without the directive', () => {
    expect(() => getUploadTokenPayload({})).toThrow('@requireUploadToken')
  })
})

describe('@withSignedUrl and @withDataUri', () => {
  beforeEach(resetTestDb)
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function makeTargets() {
    return defineStorageTargets({
      files: createMemoryProvider(),
      thumbs: createDbProvider(),
    })
  }

  test('resolves object-storage rows to signed URLs', async () => {
    const targets = makeTargets()
    const directive = createWithSignedUrlDirective({
      db,
      targets,
      disposition: 'inline',
    })
    const upload = await storeFile(targets.files, {
      db,
      filename: 'a.png',
      mimeType: 'image/png',
      data: Buffer.from('png'),
    })

    const url = await run(directive, { context: {}, resolvedValue: upload.id })

    expect(url).toBe(`memory://files/${upload.storageKey}?disposition=inline`)
  })

  test('resolves DB rows to data URIs and null for everything else', async () => {
    const targets = makeTargets()
    const directive = createWithSignedUrlDirective({ db, targets })
    const upload = await storeFile(targets.thumbs, {
      db,
      filename: 'a.png',
      mimeType: 'image/png',
      data: Buffer.from('png'),
    })
    const pending = await prisma.upload.create({
      data: {
        target: 'files',
        status: 'pending',
        filename: 'p',
        mimeType: 'image/png',
        size: 1n,
        storageKey: 'p.png',
      },
    })

    const resolve = (resolvedValue: unknown) =>
      run(directive, { context: {}, resolvedValue })

    expect(await resolve(upload.id)).toBe('data:image/png;base64,cG5n')
    expect(await resolve(pending.id)).toBeNull()
    expect(await resolve('missing')).toBeNull()
    expect(await resolve(null)).toBeNull()
    expect(await resolve(42)).toBeNull()
  })

  test('@withDataUri reads object storage as well as inline data', async () => {
    const targets = makeTargets()
    const directive = createWithDataUriDirective({ db, targets })
    const stored = await storeFile(targets.files, {
      db,
      filename: 'a.txt',
      mimeType: 'text/plain',
      data: Buffer.from('hi'),
    })
    const inline = await storeFile(targets.thumbs, {
      db,
      filename: 'b.txt',
      mimeType: 'text/plain',
      data: Buffer.from('yo'),
    })

    const resolve = (resolvedValue: unknown) =>
      run(directive, { context: {}, resolvedValue })

    expect(await resolve(stored.id)).toBe('data:text/plain;base64,aGk=')
    expect(await resolve(inline.id)).toBe('data:text/plain;base64,eW8=')
  })

  test('batches lookups made in the same tick for one context', async () => {
    const targets = makeTargets()
    const directive = createWithSignedUrlDirective({ db, targets })
    const uploads = await Promise.all(
      [1, 2, 3].map((n) =>
        storeFile(targets.files, {
          db,
          filename: `${n}.txt`,
          mimeType: 'text/plain',
          data: Buffer.from(String(n)),
        }),
      ),
    )
    const findMany = vi.spyOn(prisma.upload, 'findMany')
    const context = {}

    const urls = await Promise.all(
      uploads.map((u) => run(directive, { context, resolvedValue: u.id })),
    )

    expect(urls).toHaveLength(3)
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(findMany.mock.calls[0][0]).toMatchObject({ omit: { data: true } })

    // Cached for the rest of the request
    await loadUpload(context, db, uploads[0].id)
    expect(findMany).toHaveBeenCalledTimes(1)

    // A different context is a different request
    await loadUpload({}, db, uploads[0].id)
    expect(findMany).toHaveBeenCalledTimes(2)
  })
})
