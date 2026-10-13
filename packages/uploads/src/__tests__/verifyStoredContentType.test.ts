import { describe, expect, test } from 'vitest'

import {
  DETECT_CONTENT_TYPE_BYTES,
  DETECT_CONTENT_TYPE_TAIL_BYTES,
} from '../detectContentType.js'
import {
  findZipCentralDirectory,
  MAX_ZIP_DIRECTORY_BYTES,
} from '../detectContentType.js'
import { verifyStoredContentType } from '../verifyStoredContentType.js'

import { createMemoryProvider } from './helpers/memoryProvider.js'
import { bigDirectoryPptx, officeOpenXml, zip } from './helpers/zip.js'

const PPTX =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(DETECT_CONTENT_TYPE_BYTES * 2),
])

function store(data: Uint8Array, options: { ranged?: boolean } = {}) {
  const target = createMemoryProvider({ providerType: 's3', ...options })
  target.objects.set('key', Buffer.from(data))

  return { target, size: data.length }
}

describe('verifyStoredContentType', () => {
  test('reads only the head of an object that is not a ZIP', async () => {
    const { target, size } = store(PNG)

    expect(
      await verifyStoredContentType(target, 'key', {
        size,
        declaredType: 'image/png',
      }),
    ).toBe('image/png')
    expect(target.ranges).toEqual([
      { key: 'key', offset: 0, length: DETECT_CONTENT_TYPE_BYTES },
    ])
  })

  test('reads the tail as well when the head is a ZIP', async () => {
    const docx = zip([
      { name: '[Content_Types].xml', data: '<Types/>' },
      { name: 'word/media/a.png', data: new Uint8Array(100_000) },
      { name: 'word/document.xml', data: '<w/>' },
    ])
    const { target, size } = store(docx)

    expect(
      await verifyStoredContentType(target, 'key', {
        size,
        declaredType: DOCX,
      }),
    ).toBe(DOCX)
    expect(target.ranges).toEqual([
      { key: 'key', offset: 0, length: DETECT_CONTENT_TYPE_BYTES },
      {
        key: 'key',
        offset: size - DETECT_CONTENT_TYPE_TAIL_BYTES,
        length: DETECT_CONTENT_TYPE_TAIL_BYTES,
      },
    ])
  })

  test('reads exactly the missing part of a directory larger than the tail', async () => {
    const pptx = bigDirectoryPptx()
    const { target, size } = store(pptx)
    const tailStart = size - DETECT_CONTENT_TYPE_TAIL_BYTES
    const directory = findZipCentralDirectory(pptx)!

    expect(
      await verifyStoredContentType(target, 'key', {
        size,
        declaredType: PPTX,
      }),
    ).toBe(PPTX)
    expect(target.ranges).toEqual([
      { key: 'key', offset: 0, length: DETECT_CONTENT_TYPE_BYTES },
      {
        key: 'key',
        offset: tailStart,
        length: DETECT_CONTENT_TYPE_TAIL_BYTES,
      },
      {
        key: 'key',
        offset: directory.offset,
        length: tailStart - directory.offset,
      },
    ])
  })

  test('does not read a directory larger than MAX_ZIP_DIRECTORY_BYTES', async () => {
    // A small DOCX padded past the tail, with its directory size forged
    const docx = officeOpenXml('word')
    const data = new Uint8Array(200_000)
    data.set(docx.subarray(0, 30))
    data.set(docx, data.length - docx.length)
    new DataView(data.buffer).setUint32(
      data.length - 22 + 12,
      MAX_ZIP_DIRECTORY_BYTES + 1,
      true,
    )
    const { target, size } = store(data)

    expect(
      await verifyStoredContentType(target, 'key', {
        size,
        declaredType: DOCX,
      }),
    ).toBeNull()
    expect(target.ranges).toHaveLength(2)
  })

  test('reads a small object once, whole', async () => {
    const { target, size } = store(PNG.subarray(0, 100))

    await verifyStoredContentType(target, 'key', {
      size,
      declaredType: 'image/png',
    })
    expect(target.ranges).toEqual([{ key: 'key', offset: 0, length: 100 }])
  })

  test('falls back to reading the whole object without readRange', async () => {
    const { target, size } = store(PNG, { ranged: false })

    expect(target.readRange).toBeUndefined()
    expect(
      await verifyStoredContentType(target, 'key', {
        size,
        declaredType: 'image/png',
      }),
    ).toBe('image/png')
  })

  test('returns the canonical spelling of the declared type', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])
    const { target, size } = store(jpeg)

    expect(
      await verifyStoredContentType(target, 'key', {
        size,
        declaredType: 'image/jpg',
      }),
    ).toBe('image/jpeg')
  })

  test.each([
    ['HTML declared as PNG', Buffer.from('<html></html>'), 'image/png'],
    ['a PNG declared as JPEG', PNG, 'image/jpeg'],
    // The profile allowed the declared type, not whatever the bytes are
    ['a PNG declared as a generic type', PNG, 'application/octet-stream'],
  ])('refuses %s', async (_name, data, declaredType) => {
    const { target, size } = store(data)

    expect(
      await verifyStoredContentType(target, 'key', { size, declaredType }),
    ).toBeNull()
  })

  test('accepts unrecognised bytes under a declared type it cannot check', async () => {
    const { target, size } = store(Buffer.from('a,b\n1,2\n'))

    expect(
      await verifyStoredContentType(target, 'key', {
        size,
        declaredType: 'text/csv; charset=utf-8',
      }),
    ).toBe('text/csv')
  })
})
