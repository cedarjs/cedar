import sharp from 'sharp'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { DerivedFileContext } from '../derivedFiles.js'
import { defineDerivedFiles, uploadSource } from '../derivedFiles.js'
import { UploadError } from '../errors.js'
import { sharpVariant } from '../sharp.js'
import { storeFile } from '../storeFile.js'
import { defineStorageTargets } from '../targets.js'

import { createMemoryProvider } from './helpers/memoryProvider.js'
import { derivedDb as db, resetTestDb } from './helpers/testDb.js'

/** A solid image, `width` × `height`, in `format`. */
function image(
  width: number,
  height: number,
  format: 'png' | 'jpeg' = 'png',
): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: '#c00' },
  })
    .toFormat(format)
    .toBuffer()
}

/** Runs a generator on `data`, as `defineDerivedFiles()` would. */
async function run(
  generate: ReturnType<typeof sharpVariant>,
  data: Uint8Array,
) {
  const context: DerivedFileContext = {
    source: { name: 'upload', key: 'upload:1', ref: '1' },
    variant: 'test',
    readSource: async () => ({ data: Buffer.from(data) }),
  }

  return generate(context)
}

async function made(
  generate: ReturnType<typeof sharpVariant>,
  data: Uint8Array,
) {
  const file = await run(generate, data)

  if (!file) {
    throw new Error('expected a file')
  }

  return { ...file, metadata: await sharp(file.data).metadata() }
}

describe('sharpVariant', () => {
  test('makes a square WebP thumbnail, cropped, by default', async () => {
    const file = await made(sharpVariant({ width: 164 }), await image(400, 200))

    expect(file.mimeType).toBe('image/webp')
    expect(file.metadata).toMatchObject({
      format: 'webp',
      width: 164,
      height: 164,
    })
  })

  test('reads GIF, WebP, AVIF and TIFF too', async () => {
    const generate = sharpVariant({ width: 32 })

    for (const format of ['gif', 'webp', 'avif', 'tiff'] as const) {
      const input = await sharp({
        create: { width: 64, height: 48, channels: 3, background: '#c00' },
      })
        .toFormat(format)
        .toBuffer()
      const file = await made(generate, input)

      expect(file.metadata).toMatchObject({
        format: 'webp',
        width: 32,
        height: 32,
      })
    }
  })

  test('crops to width × height', async () => {
    const file = await made(
      sharpVariant({ width: 120, height: 80 }),
      await image(100, 300),
    )

    expect(file.metadata).toMatchObject({ width: 120, height: 80 })
  })

  test("fits within width × height with 'inside', never enlarging", async () => {
    const fit = sharpVariant({ width: 100, height: 100, fit: 'inside' })

    expect((await made(fit, await image(400, 200))).metadata).toMatchObject({
      width: 100,
      height: 50,
    })
    expect((await made(fit, await image(40, 20))).metadata).toMatchObject({
      width: 40,
      height: 20,
    })
  })

  test('writes the format asked for, with its quality', async () => {
    const input = await image(300, 300, 'jpeg')

    for (const format of ['jpeg', 'png', 'avif'] as const) {
      const file = await made(sharpVariant({ width: 64, format }), input)

      expect(file.mimeType).toBe(`image/${format}`)
      expect(file.metadata.format).toBe(format === 'avif' ? 'heif' : format)
    }

    const low = await made(
      sharpVariant({ width: 256, format: 'jpeg', quality: 10 }),
      input,
    )
    const high = await made(
      sharpVariant({ width: 256, format: 'jpeg', quality: 95 }),
      input,
    )

    expect(low.data.length).toBeLessThan(high.data.length)
  })

  test('turns the image the right way up and drops its metadata', async () => {
    // Stored 200 × 100, shown turned a quarter (EXIF orientation 6)
    const turned = await sharp(await image(200, 100, 'jpeg'))
      .withMetadata({ orientation: 6 })
      .toBuffer()
    const file = await made(
      sharpVariant({ width: 1000, fit: 'inside' }),
      turned,
    )

    expect(file.metadata).toMatchObject({ width: 100, height: 200 })
    expect(file.metadata.orientation).toBeUndefined()
    expect(file.metadata.exif).toBeUndefined()
  })

  test('returns null for anything but a supported image, by its bytes', async () => {
    const generate = sharpVariant({ width: 64 })
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
    )

    expect(await run(generate, svg)).toBe(null)
    expect(await run(generate, Buffer.from('%PDF-1.7\n'))).toBe(null)
    expect(await run(generate, Buffer.alloc(0))).toBe(null)
  })

  test('throws for a broken image, so it is retried and logged', async () => {
    const png = await image(64, 64)

    await expect(
      run(sharpVariant({ width: 32 }), png.subarray(0, 40)),
    ).rejects.toThrow()
  })

  test('refuses invalid options, naming what is allowed', () => {
    const invalid = [
      [{ width: 0 }, 'width must be a whole number from 1 to 16383, got 0'],
      [{ width: 10, height: 1.5 }, 'height must be a whole number'],
      [{ width: 10, fit: 'fill' }, "fit must be 'cover' or 'inside'"],
      [{ width: 10, format: 'gif' }, 'format must be one of webp, jpeg'],
      [{ width: 10, quality: 101 }, 'quality must be a whole number'],
    ] as const

    for (const [options, message] of invalid) {
      // @ts-expect-error - values the types rule out, as JavaScript could pass
      expect(() => sharpVariant(options)).toThrow(message)
    }

    expect(() => sharpVariant({ width: -1 })).toThrow(UploadError)
  })

  test('says how to install sharp when it is missing', async () => {
    vi.resetModules()
    vi.doMock('node:module', () => ({
      createRequire: () => ({
        resolve: () => {
          throw Object.assign(new Error("Cannot find module 'sharp'"), {
            code: 'MODULE_NOT_FOUND',
          })
        },
      }),
    }))

    try {
      const { sharpVariant: withoutSharp } = await import('../sharp.js')
      const { UploadError: FreshUploadError } = await import('../errors.js')

      let error: unknown
      try {
        withoutSharp({ width: 64 })
      } catch (e) {
        error = e
      }

      expect(error).toBeInstanceOf(FreshUploadError)
      expect(error).toMatchObject({ code: 'CONFIGURATION' })
      expect(String(error)).toContain('yarn workspace api add sharp')
    } finally {
      vi.doUnmock('node:module')
      vi.resetModules()
    }
  })

  describe('with defineDerivedFiles()', () => {
    beforeEach(resetTestDb)

    test("stores an upload's thumbnail as an Upload", async () => {
      const targets = defineStorageTargets({
        files: createMemoryProvider(),
        thumbs: createMemoryProvider(),
      })
      const upload = await storeFile(targets.files, {
        db,
        filename: 'photo.jpg',
        mimeType: 'image/jpeg',
        data: await image(640, 480, 'jpeg'),
      })
      const derived = defineDerivedFiles({
        db,
        targets,
        target: targets.thumbs,
        sources: { upload: uploadSource({ db, targets }) },
        variants: { 'thumb-164': sharpVariant({ width: 164 }) },
      })

      const read = await derived.acquireVariantData(
        { upload: upload.id },
        'thumb-164',
      )

      expect(read?.upload).toMatchObject({
        filename: 'photo-thumb-164.webp',
        mimeType: 'image/webp',
        target: 'thumbs',
      })
      expect(await sharp(read?.data).metadata()).toMatchObject({
        format: 'webp',
        width: 164,
        height: 164,
      })
    })
  })
})
