import { createRequire } from 'node:module'

import type SharpConstructor from 'sharp'

import type { DerivedFileGenerator } from './derivedFiles.js'
import { detectContentType } from './detectContentType.js'
import { UploadError } from './errors.js'

/** The formats `sharpVariant()` writes. */
export type SharpVariantFormat = 'webp' | 'jpeg' | 'png' | 'avif'

/**
 * Which part of the image `cover` keeps: an edge or corner, the middle
 * (`centre`), or the part sharp finds most detailed (`entropy`) or most
 * eye-catching (`attention`).
 */
export type SharpVariantPosition =
  | 'centre'
  | 'top'
  | 'right top'
  | 'right'
  | 'right bottom'
  | 'bottom'
  | 'left bottom'
  | 'left'
  | 'left top'
  | 'entropy'
  | 'attention'

export interface SharpVariantOptions {
  /** Width in pixels. */
  width: number
  /** Height in pixels. Default: `width`, a square. */
  height?: number
  /**
   * `cover` (default) crops to exactly `width` × `height`, as a thumbnail
   * tile needs, keeping the middle unless `position` says otherwise. `inside` fits the whole image within them, keeping
   * its shape, and never makes it bigger than it is.
   */
  fit?: 'cover' | 'inside'
  /**
   * For `cover`: which part of the image is kept. Default `centre`; `top`
   * suits document pages.
   */
  position?: SharpVariantPosition
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

const POSITIONS: readonly SharpVariantPosition[] = [
  'centre',
  'top',
  'right top',
  'right',
  'right bottom',
  'bottom',
  'left bottom',
  'left',
  'left top',
  'entropy',
  'attention',
]

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

const invalid = (message: string) => new UploadError('CONFIGURATION', message)

/**
 * A derived-file generator that resizes images with
 * [sharp](https://sharp.pixelplumbing.com), which your app installs:
 * `yarn workspace api add sharp`. **Experimental**, like derived files.
 *
 * Turns the image the right way up (its EXIF orientation), drops its
 * metadata, and returns `null`, a permanent failure, for anything that isn't
 * a JPEG, PNG, WebP, GIF, AVIF or TIFF by its bytes. Images over 100
 * megapixels are refused, and so is a `cover` size over 100 megapixels.
 *
 * It runs sharp in your API process. For images from untrusted sources,
 * consider a generator that runs sharp in `@cedarjs/api/sandbox` instead;
 * see "Derived files" in the uploads docs.
 *
 * @example
 * variants: {
 *   // A 164 × 164 WebP, cropped from the middle
 *   'thumb-164': sharpVariant({ width: 164 }),
 *   // A page's top, 164 × 232
 *   'page-top': sharpVariant({ width: 164, height: 232, position: 'top' }),
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
    position,
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

  if (position !== undefined) {
    if (fit !== 'cover') {
      throw invalid(
        "sharpVariant() position is for fit 'cover', which crops; " +
          "fit 'inside' keeps the whole image.",
      )
    }

    if (!POSITIONS.includes(position)) {
      throw invalid(
        `sharpVariant() position must be one of ` +
          `${POSITIONS.map((p) => `'${p}'`).join(', ')}, got ` +
          `'${String(position)}'.`,
      )
    }
  }

  // A cover image is exactly width × height, however small the input
  if (fit === 'cover' && width * height > MAX_INPUT_PIXELS) {
    throw invalid(
      `sharpVariant() with fit 'cover' makes images of exactly width × ` +
        `height, which can be at most ${MAX_INPUT_PIXELS / 1_000_000} ` +
        `megapixels; ${width} × ${height} is ` +
        `${Math.round((width * height) / 1_000_000)}.`,
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

  // Loaded here, when the app starts, rather than on the first image: a
  // missing package, or its native library missing for this platform,
  // would otherwise fail every file asked for until resetVariants()
  const sharp = loadSharp()

  return async ({ readSource }) => {
    const { data } = await readSource()

    if (!DECODABLE.has(detectContentType(data) ?? '')) {
      return null
    }

    const image = sharp(data, {
      // Not sharp's default, 'warning': libjpeg warns about JPEGs that some
      // phones and cameras write, such as extra bytes before the end marker,
      // and that every browser shows. A broken or truncated file still fails
      failOn: 'error',
      limitInputPixels: MAX_INPUT_PIXELS,
    })
      .autoOrient()
      .resize(width, height, {
        fit,
        position: position ?? 'centre',
        withoutEnlargement: fit === 'inside',
      })

    // A PNG's `quality` would make it a palette image
    const output = await (
      format === 'png' ? image.png() : image.toFormat(format, { quality })
    ).toBuffer()

    return { data: output, mimeType: MIME_TYPES[format] }
  }
}

/** Loads sharp, and its native library, or says how to fix it. */
function loadSharp(): typeof SharpConstructor {
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

  try {
    return require('sharp') as typeof SharpConstructor
  } catch (e) {
    throw new UploadError(
      'CONFIGURATION',
      "sharpVariant() can't load the 'sharp' package, which is installed. " +
        'Usually its native library for this platform is missing; see ' +
        'https://sharp.pixelplumbing.com/install. sharp says: ' +
        (e instanceof Error ? e.message : String(e)),
      e,
    )
  }
}
