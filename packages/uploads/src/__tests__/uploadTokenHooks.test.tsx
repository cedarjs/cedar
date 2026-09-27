// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { CedarUppy } from '../web/createUppy.js'
import { useFsUpload } from '../web/hooks/useFsUpload.js'
import { useS3Upload } from '../web/hooks/useS3Upload.js'
import {
  readTokenLifetimeMs,
  useUploadToken,
} from '../web/hooks/useUploadToken.js'

const apollo = vi.hoisted(() => ({
  execute: vi.fn(),
  mutate: vi.fn(),
}))

vi.mock('@apollo/client/react', () => ({
  useLazyQuery: () => [apollo.execute, { loading: false, error: undefined }],
  useMutation: () => [apollo.mutate],
}))

function base64Url(value: string) {
  return btoa(value).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

let issued = 0

/** A token shaped like a signed token, with the given lifetime in seconds. */
function fakeToken(lifetimeSeconds: number) {
  issued += 1
  const iat = 1_700_000_000

  return [
    base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    base64Url(JSON.stringify({ n: issued, iat, exp: iat + lifetimeSeconds })),
    'signature',
  ].join('.')
}

function mockTokenQuery({
  maxFiles,
  lifetimeSeconds = 300,
  token,
}: {
  maxFiles: number
  lifetimeSeconds?: number
  token?: () => string
}) {
  apollo.execute.mockImplementation(async () => ({
    data: {
      requestUploadToken: {
        token: token ? token() : fakeToken(lifetimeSeconds),
        allowedMimeTypes: ['image/png'],
        maxFileSize: '1000',
        maxFiles,
      },
    },
  }))
}

beforeEach(() => {
  issued = 0
  apollo.execute.mockReset()
  apollo.mutate.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('readTokenLifetimeMs', () => {
  test('reads exp - iat from the token claims', () => {
    expect(readTokenLifetimeMs(fakeToken(300))).toBe(300_000)
  })

  test('returns null for a token without readable claims', () => {
    expect(readTokenLifetimeMs('not-a-token')).toBeNull()
    expect(readTokenLifetimeMs('a.%%%.c')).toBeNull()
  })
})

describe('useUploadToken', () => {
  test('reuses a token until maxFiles files have used it', async () => {
    mockTokenQuery({ maxFiles: 2 })
    const { result } = renderHook(() => useUploadToken({ profile: 'docs' }))

    let tokens: string[] = []
    await act(async () => {
      tokens.push(await result.current.acquireToken())
      tokens.push(await result.current.acquireToken())
      tokens.push(await result.current.acquireToken())
    })

    expect(apollo.execute).toHaveBeenCalledTimes(2)
    expect(tokens[0]).toBe(tokens[1])
    expect(tokens[2]).not.toBe(tokens[0])

    tokens = []
    await act(async () => {
      tokens.push(await result.current.acquireToken(2))
    })

    // One file was left on the second token, not enough for two
    expect(apollo.execute).toHaveBeenCalledTimes(3)
  })

  test('fetches a fresh token for every upload with a maxFiles: 1 profile', async () => {
    mockTokenQuery({ maxFiles: 1 })
    const { result } = renderHook(() => useUploadToken({ profile: 'avatar' }))

    let first = ''
    let second = ''
    await act(async () => {
      first = await result.current.acquireToken()
    })

    expect(result.current.hasUsableToken()).toBe(false)

    await act(async () => {
      second = await result.current.acquireToken()
    })

    expect(apollo.execute).toHaveBeenCalledTimes(2)
    expect(second).not.toBe(first)
  })

  test('fetches a fresh token before the current one expires', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    mockTokenQuery({ maxFiles: 10, lifetimeSeconds: 300 })
    const { result } = renderHook(() => useUploadToken({ profile: 'docs' }))

    const tokens: string[] = []
    await act(async () => {
      tokens.push(await result.current.acquireToken())
    })

    now.mockReturnValue(1_000_000 + 200_000)
    await act(async () => {
      tokens.push(await result.current.acquireToken())
    })

    expect(tokens[1]).toBe(tokens[0])
    expect(result.current.hasUsableToken()).toBe(true)

    // Inside the safety margin before the five minute expiry
    now.mockReturnValue(1_000_000 + 280_000)
    expect(result.current.hasUsableToken()).toBe(false)

    await act(async () => {
      tokens.push(await result.current.acquireToken())
    })

    expect(apollo.execute).toHaveBeenCalledTimes(2)
    expect(tokens[2]).not.toBe(tokens[0])
  })

  test('counts the token lifetime from when it was requested', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    mockTokenQuery({ maxFiles: 10, lifetimeSeconds: 300 })
    const respond = apollo.execute.getMockImplementation()
    // The response takes a minute to arrive
    apollo.execute.mockImplementation(async (...args: unknown[]) => {
      now.mockReturnValue(1_000_000 + 60_000)
      return respond?.(...args)
    })

    const { result } = renderHook(() => useUploadToken({ profile: 'docs' }))

    await act(async () => {
      await result.current.acquireToken()
    })

    now.mockReturnValue(1_000_000 + 260_000)
    expect(result.current.hasUsableToken()).toBe(true)

    // Inside the safety margin before the expiry counted from the request
    now.mockReturnValue(1_000_000 + 280_000)
    expect(result.current.hasUsableToken()).toBe(false)
  })

  test('concurrent callers share one fetch while the token has room', async () => {
    mockTokenQuery({ maxFiles: 2 })
    const { result } = renderHook(() => useUploadToken({ profile: 'docs' }))

    let tokens: string[] = []
    await act(async () => {
      tokens = await Promise.all([
        result.current.acquireToken(),
        result.current.acquireToken(),
      ])
    })

    expect(apollo.execute).toHaveBeenCalledTimes(1)
    expect(tokens[0]).toBe(tokens[1])
  })

  test('concurrent callers get separate tokens when one is not enough', async () => {
    mockTokenQuery({ maxFiles: 1 })
    const { result } = renderHook(() => useUploadToken({ profile: 'avatar' }))

    let tokens: string[] = []
    await act(async () => {
      tokens = await Promise.all([
        result.current.acquireToken(),
        result.current.acquireToken(),
      ])
    })

    expect(apollo.execute).toHaveBeenCalledTimes(2)
    expect(tokens[0]).not.toBe(tokens[1])
  })

  test('hands a fresh token to a batch bigger than maxFiles', async () => {
    mockTokenQuery({ maxFiles: 1 })
    const { result } = renderHook(() => useUploadToken({ profile: 'avatar' }))

    await act(async () => {
      await result.current.acquireToken(3)
    })

    expect(apollo.execute).toHaveBeenCalledTimes(1)
  })

  test('tracks only file counts for a token without readable claims', async () => {
    let n = 0
    mockTokenQuery({ maxFiles: 2, token: () => `opaque-${++n}` })
    const { result } = renderHook(() => useUploadToken({ profile: 'docs' }))

    const tokens: string[] = []
    await act(async () => {
      tokens.push(await result.current.acquireToken())
      tokens.push(await result.current.acquireToken())
      tokens.push(await result.current.acquireToken())
    })

    expect(tokens).toEqual(['opaque-1', 'opaque-1', 'opaque-2'])
  })
})

/**
 * Swaps the XHR plugin for an uploader that records the token header each
 * file would be sent with, so no network request is made.
 */
function recordFsUploads(uppy: CedarUppy) {
  const plugin = uppy.getPlugin('XHRUpload')

  if (!plugin) {
    throw new Error('XHRUpload plugin missing')
  }

  const headers = plugin.opts.headers

  if (typeof headers !== 'function') {
    throw new Error('Expected per-file headers')
  }

  uppy.removePlugin(plugin)

  const sent: string[] = []

  uppy.addUploader(async (fileIDs) => {
    uppy.emit(
      'upload-start',
      fileIDs.map((id) => uppy.getFile(id)),
    )

    for (const id of fileIDs) {
      const file = uppy.getFile(id)
      sent.push(headers(file)['x-upload-token'])
      uppy.emit('upload-success', file, {
        status: 201,
        body: undefined,
        uploadURL: undefined,
      })
    }
  })

  return sent
}

describe('useFsUpload', () => {
  test('sends a fresh token with each upload of a maxFiles: 1 profile', async () => {
    mockTokenQuery({ maxFiles: 1 })
    const { result } = renderHook(() => useFsUpload({ profile: 'avatar' }))

    await waitFor(() => expect(result.current.uppy).not.toBeNull())
    const uppy = result.current.uppy as CedarUppy
    const sent = recordFsUploads(uppy)
    uppy.setOptions({ autoProceed: false })

    const png = { name: 'a.png', type: 'image/png', data: new Blob(['a']) }

    await act(async () => {
      uppy.addFile(png)
      await uppy.upload()
    })

    await act(async () => {
      uppy.addFile({ ...png, name: 'b.png' })
      await uppy.upload()
    })

    expect(sent).toHaveLength(2)
    expect(sent[0]).toBeTruthy()
    expect(sent[1]).toBeTruthy()
    expect(sent[1]).not.toBe(sent[0])
    expect(apollo.execute).toHaveBeenCalledTimes(2)
  })

  test('limits the files waiting to upload to maxFiles', async () => {
    mockTokenQuery({ maxFiles: 1 })
    const { result } = renderHook(() => useFsUpload({ profile: 'avatar' }))

    await waitFor(() => expect(result.current.uppy).not.toBeNull())
    const uppy = result.current.uppy as CedarUppy
    uppy.setOptions({ autoProceed: false })

    await act(async () => {
      uppy.addFile({ name: 'a.png', type: 'image/png', data: new Blob(['a']) })
    })

    await waitFor(() =>
      expect(() =>
        uppy.addFile({
          name: 'b.png',
          type: 'image/png',
          data: new Blob(['b']),
        }),
      ).toThrow(),
    )
    expect(uppy.getFiles()).toHaveLength(1)
  })

  test('adding several files at once fetches one token for the batch', async () => {
    mockTokenQuery({ maxFiles: 3 })
    const { result } = renderHook(() => useFsUpload({ profile: 'docs' }))

    await waitFor(() => expect(result.current.uppy).not.toBeNull())
    const uppy = result.current.uppy as CedarUppy
    const sent = recordFsUploads(uppy)
    uppy.setOptions({ autoProceed: false })

    await act(async () => {
      uppy.addFiles([
        { name: 'a.png', type: 'image/png', data: new Blob(['a']) },
        { name: 'b.png', type: 'image/png', data: new Blob(['b']) },
      ])
      await uppy.upload()
    })

    expect(apollo.execute).toHaveBeenCalledTimes(1)
    expect(sent).toHaveLength(2)
    expect(sent[0]).toBe(sent[1])
  })
})

describe('useS3Upload', () => {
  test('asks for a fresh token once the current one is used up', async () => {
    mockTokenQuery({ maxFiles: 1 })
    apollo.mutate.mockResolvedValue({
      data: {
        createPresignedUploadUrl: {
          uploadId: 'u',
          url: 'https://s3.example/put',
          method: 'PUT',
          headers: {},
        },
      },
    })

    const { result } = renderHook(() => useS3Upload({ profile: 'avatar' }))

    await waitFor(() => expect(result.current.uppy).not.toBeNull())
    const uppy = result.current.uppy as CedarUppy
    const plugin = uppy.getPlugin('AwsS3')

    if (!plugin) {
      throw new Error('AwsS3 plugin missing')
    }

    const signRequest = plugin.opts.signRequest

    await act(async () => {
      uppy.setOptions({ autoProceed: false })
      const first = uppy.addFile({
        name: 'a.png',
        type: 'image/png',
        data: new Blob(['a']),
      })
      await signRequest({ method: 'PUT', key: first })
      const second = uppy.addFile({
        name: 'b.png',
        type: 'image/png',
        data: new Blob(['b']),
      })
      await signRequest({ method: 'PUT', key: second })
    })

    const sentTokens = apollo.mutate.mock.calls.map(
      ([options]) => options.context.headers['x-upload-token'],
    )

    expect(sentTokens).toHaveLength(2)
    expect(sentTokens[1]).not.toBe(sentTokens[0])
  })
})
