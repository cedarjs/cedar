import { createRequire } from 'node:module'

import type SharpConstructor from 'sharp'

import type { DerivedFileGenerator } from './derivedFiles.js'
import { detectContentType } from './detectContentType.js'
import { UploadError } from './errors.js'

/** The formats `sharpVariant()` writes. */
export type SharpVariantFormat = 'webp' | 'jpeg' | 'png' | 'avif'

export interface SharpVariantOptions {
  /** Width in pixels. */
  width: number
  /** Height in pixels. Default: `width`, a square. */
  height?: number
  /**
   * `cover` (default) crops the middle to exactly `width` × `height`, as a
   * thumbnail tile needs. `inside` fits the whole image within them, keeping
   * its shape, and never makes it bigger than it is.
   */
  fit?: 'cover' | 'inside'
  /** Default `webp`. */
  format?: SharpVariantFormat
  /** 1–100, for `webp`, `jpeg` and `avif`. Default 80. */
  quality?: number
}

const MIME_TYPES: Record<SharpVariantFormat, string> = {
  webp: 'image/webp',
  jpeg: 'image/jpeg',
  png: 'image/png',
  avif: 'image/avif',
}

// Only bytes that are one of these reach libvips, so it uses no other
// decoder (SVG, PDF, HEIC…) on them, whatever the source claims they are
const DECODABLE = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/tiff',
])

// Refused before decoding: a small file can claim a huge image
const MAX_INPUT_PIXELS = 100_000_000

// libvips' largest dimension for most formats
const MAX_SIZE = 16383

const require = createRequire(import.meta.url)

let loaded: Promise<typeof SharpConstructor> | undefined

const loadSharp = () =>
  (loaded ??= import('sharp').then((module) => module.default))

const invalid = (message: string) => new UploadError('CONFIGURATION', message)

/**
 * A derived-file generator that resizes images with
 * [sharp](https://sharp.pixelplumbing.com), which your app installs:
 * `yarn workspace api add sharp`. **Experimental**, like derived files.
 *
 * Turns the image the right way up (its EXIF orientation), drops its
 * metadata, and returns `null`, a permanent failure, for anything that isn't
 * a JPEG, PNG, WebP, GIF, AVIF or TIFF by its bytes. Images over 100
 * megapixels are refused.
 *
 * It runs sharp in your API process. For images from untrusted sources,
 * consider a generator that runs sharp in `@cedarjs/api/sandbox` instead;
 * see "Derived files" in the uploads docs.
 *
 * @example
 * variants: {
 *   // A 164 × 164 WebP, cropped from the middle
 *   'thumb-164': sharpVariant({ width: 164 }),
 *   // At most 1600 × 1200, as a JPEG
 *   large: sharpVariant({
 *     width: 1600,
 *     height: 1200,
 *     fit: 'inside',
 *     format: 'jpeg',
 *     quality: 85,
 *   }),
 * }
 */
export function sharpVariant(
  options: SharpVariantOptions,
): DerivedFileGenerator {
  const {
    width,
    height = width,
    fit = 'cover',
    format = 'webp',
    quality = 80,
  } = options

  for (const [name, value] of [
    ['width', width],
    ['height', height],
  ] as const) {
    if (!Number.isInteger(value) || value < 1 || value > MAX_SIZE) {
      throw invalid(
        `sharpVariant() ${name} must be a whole number from 1 to ` +
          `${MAX_SIZE}, got ${String(value)}.`,
      )
    }
  }

  if (fit !== 'cover' && fit !== 'inside') {
    throw invalid(
      `sharpVariant() fit must be 'cover' or 'inside', got '${String(fit)}'.`,
    )
  }

  if (!Object.hasOwn(MIME_TYPES, format)) {
    throw invalid(
      `sharpVariant() format must be one of ` +
        `${Object.keys(MIME_TYPES).join(', ')}, got '${String(format)}'.`,
    )
  }

  if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw invalid(
      `sharpVariant() quality must be a whole number from 1 to 100, got ` +
        `${String(quality)}.`,
    )
  }

  // Checked here, when the app starts, rather than on the first image: a
  // missing package would otherwise fail every file asked for until
  // resetVariants()
  try {
    require.resolve('sharp')
  } catch (e) {
    throw new UploadError(
      'CONFIGURATION',
      "sharpVariant() needs the 'sharp' package, which isn't installed. " +
        'Add it to your api side with `yarn workspace api add sharp`, or ' +
        'write your own generator.',
      e,
    )
  }

  return async ({ readSource }) => {
    const { data } = await readSource()

    if (!DECODABLE.has(detectContentType(data) ?? '')) {
      return null
    }

    const sharp = await loadSharp()
    const image = sharp(data, {
      failOn: 'error',
      limitInputPixels: MAX_INPUT_PIXELS,
    })
      .autoOrient()
      .resize(width, height, { fit, withoutEnlargement: fit === 'inside' })

    // A PNG's `quality` would make it a palette image
    const output = await (
      format === 'png' ? image.png() : image.toFormat(format, { quality })
    ).toBuffer()

    return { data: output, mimeType: MIME_TYPES[format] }
  }
}
