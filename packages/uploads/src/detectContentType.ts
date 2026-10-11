import { isMimeTypeAllowed } from './profiles.js'

/**
 * How many bytes from the start of a file `detectContentType()` needs to
 * recognise every format it knows. Pass at least this much when reading only
 * the head of a large file, e.g. with a ranged GET. Fewer bytes still work for
 * most formats. An ISO-BMFF file (MP4, HEIC…) whose type depends on a
 * compatible brand needs its whole `ftyp` box, and is reported as `null`
 * when the box is cut off.
 */
export const DETECT_CONTENT_TYPE_BYTES = 4096

/**
 * Every MIME type `detectContentType()` can return. A claimed type in this
 * set is one the bytes can confirm or refute, which is what
 * `acceptedContentType()` relies on.
 */
export const DETECTABLE_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/tiff',
  'image/avif',
  'image/heic',
  'image/heic-sequence',
  'image/heif',
  'image/heif-sequence',
  'application/pdf',
  'video/mp4',
  'audio/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
])

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const EBML_SIGNATURE = [0x1a, 0x45, 0xdf, 0xa3]

/** Sizes of the BMP info headers (BITMAPCOREHEADER through BITMAPV5HEADER). */
const BMP_INFO_HEADER_SIZES = new Set([12, 40, 52, 56, 64, 108, 124])

/** ISO-BMFF brands of AVIF stills (`avif`) and sequences (`avis`). */
const AVIF_BRANDS = new Set(['avif', 'avis'])
/** ISO-BMFF brands of HEVC-coded HEIF stills, i.e. HEIC. */
const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis'])
/** ISO-BMFF brands of HEVC-coded HEIF image sequences. */
const HEIC_SEQUENCE_BRANDS = new Set(['hevc', 'hevx', 'hevm', 'hevs'])
/** ISO-BMFF brands of MPEG-4 video files. */
const MP4_BRANDS = new Set([
  'isom',
  'iso2',
  'iso3',
  'iso4',
  'iso5',
  'iso6',
  'iso7',
  'iso8',
  'iso9',
  'mp41',
  'mp42',
  'mp71',
  'avc1',
  'dash',
  'M4V ',
])
/** ISO-BMFF brands of MPEG-4 audio files (`.m4a`, `.m4b`). */
const MP4_AUDIO_BRANDS = new Set(['M4A ', 'M4B '])
const QUICKTIME_BRAND = 'qt  '

/** EBML element IDs, with their length marker bits kept. */
const EBML_DOC_TYPE_ID = 0x4282

function hasBytesAt(bytes: Uint8Array, offset: number, expected: number[]) {
  if (bytes.length < offset + expected.length) {
    return false
  }

  return expected.every((b, i) => bytes[offset + i] === b)
}

/** Latin-1 text of `bytes[start, end)`, or `null` when that runs off the end. */
function ascii(bytes: Uint8Array, start: number, end: number) {
  if (end > bytes.length) {
    return null
  }

  let text = ''

  for (let i = start; i < end; i++) {
    text += String.fromCharCode(bytes[i])
  }

  return text
}

function readUint32BE(bytes: Uint8Array, offset: number) {
  if (bytes.length < offset + 4) {
    return null
  }

  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  )
}

function readUint32LE(bytes: Uint8Array, offset: number) {
  if (bytes.length < offset + 4) {
    return null
  }

  return (
    bytes[offset] +
    bytes[offset + 1] * 0x100 +
    bytes[offset + 2] * 0x10000 +
    bytes[offset + 3] * 0x1000000
  )
}

/**
 * MP4, QuickTime, HEIC/HEIF and AVIF all start with an ISO base media file
 * format `ftyp` box: a 32-bit size, `ftyp`, a major brand, a minor version,
 * then compatible brands up to the end of the box. The brands say which of
 * them the file is.
 */
function detectIsoBmff(bytes: Uint8Array): string | null {
  if (ascii(bytes, 4, 8) !== 'ftyp') {
    return null
  }

  const boxSize = readUint32BE(bytes, 0)

  // Header, major brand and minor version are 16 bytes, and brands are four
  // bytes each. Sizes 0 ("to end of file") and 1 (64-bit size follows) are
  // valid for other boxes but never seen on a real `ftyp`.
  if (boxSize === null || boxSize < 16 || boxSize % 4 !== 0) {
    return null
  }

  const major = ascii(bytes, 8, 12)

  if (major === null) {
    return null
  }

  const fromMajor = classifyMajorBrand(major)

  if (fromMajor) {
    return fromMajor
  }

  // The compatible brands decide, so they must all be there: a truncated
  // list could be missing the one that matters
  if (bytes.length < boxSize) {
    return null
  }

  const compatible: string[] = []

  for (let offset = 16; offset + 4 <= boxSize; offset += 4) {
    const brand = ascii(bytes, offset, offset + 4)

    if (brand !== null) {
      compatible.push(brand)
    }
  }

  return classifyCompatibleBrands(major, compatible)
}

function classifyMajorBrand(major: string): string | null {
  if (AVIF_BRANDS.has(major)) {
    return 'image/avif'
  }

  if (HEIC_BRANDS.has(major)) {
    return 'image/heic'
  }

  if (HEIC_SEQUENCE_BRANDS.has(major)) {
    return 'image/heic-sequence'
  }

  if (major === QUICKTIME_BRAND) {
    return 'video/quicktime'
  }

  if (MP4_AUDIO_BRANDS.has(major)) {
    return 'audio/mp4'
  }

  if (MP4_BRANDS.has(major)) {
    return 'video/mp4'
  }

  return null
}

/**
 * For a major brand that is generic (`mif1`/`msf1` only say "some HEIF") or
 * that `classifyMajorBrand()` doesn't know. Image codecs are checked first:
 * an AVIF or HEIC also lists generic brands, and some list `iso8` or `mp41`
 * as well.
 */
function classifyCompatibleBrands(
  major: string,
  compatible: string[],
): string | null {
  const has = (brands: ReadonlySet<string>) =>
    compatible.some((brand) => brands.has(brand))

  if (has(AVIF_BRANDS)) {
    return 'image/avif'
  }

  if (has(HEIC_BRANDS)) {
    return 'image/heic'
  }

  if (has(HEIC_SEQUENCE_BRANDS)) {
    return 'image/heic-sequence'
  }

  if (major === 'mif1' || major === 'mif2' || compatible.includes('mif1')) {
    return 'image/heif'
  }

  if (major === 'msf1' || compatible.includes('msf1')) {
    return 'image/heif-sequence'
  }

  if (compatible.includes(QUICKTIME_BRAND)) {
    return 'video/quicktime'
  }

  if (has(MP4_AUDIO_BRANDS)) {
    return 'audio/mp4'
  }

  if (has(MP4_BRANDS)) {
    return 'video/mp4'
  }

  return null
}

/**
 * Reads an EBML variable-length integer at `offset`. The number of leading
 * zero bits in the first byte gives the length (1 to 8 bytes). With
 * `keepMarker` the length-marker bit stays in the value, which is how element
 * IDs are written. `unknown` means a size whose value bits are all ones.
 */
function readVint(
  bytes: Uint8Array,
  offset: number,
  keepMarker: boolean,
): { value: number; length: number; unknown: boolean } | null {
  if (offset >= bytes.length) {
    return null
  }

  const first = bytes[offset]

  if (first === 0) {
    return null
  }

  let length = 1

  while (!(first & (0x80 >> (length - 1)))) {
    length++
  }

  if (offset + length > bytes.length) {
    return null
  }

  const marker = 0x80 >> (length - 1)
  let value = keepMarker ? first : first & (marker - 1)
  let allOnes = (first & (marker - 1)) === marker - 1

  for (let i = 1; i < length; i++) {
    const byte = bytes[offset + i]
    // Multiplication instead of `<<` keeps sizes past 2^31 correct
    value = value * 0x100 + byte
    allOnes = allOnes && byte === 0xff
  }

  return { value, length, unknown: !keepMarker && allOnes }
}

/**
 * WebM and Matroska both start with an EBML header element. Its `DocType`
 * child element says which one the file is.
 */
function detectEbml(bytes: Uint8Array): string | null {
  if (!hasBytesAt(bytes, 0, EBML_SIGNATURE)) {
    return null
  }

  const headerSize = readVint(bytes, EBML_SIGNATURE.length, false)

  if (!headerSize || headerSize.unknown) {
    return null
  }

  const headerStart = EBML_SIGNATURE.length + headerSize.length
  const headerEnd = Math.min(headerStart + headerSize.value, bytes.length)
  let offset = headerStart

  while (offset < headerEnd) {
    const id = readVint(bytes, offset, true)

    if (!id || id.length > 4) {
      return null
    }

    const size = readVint(bytes, offset + id.length, false)

    if (!size || size.unknown) {
      return null
    }

    const dataStart = offset + id.length + size.length

    if (id.value === EBML_DOC_TYPE_ID) {
      const docType = ascii(bytes, dataStart, dataStart + size.value)

      // EBML strings may be padded with trailing NULs
      switch (docType?.replace(/\0+$/, '')) {
        case 'webm':
          return 'video/webm'
        case 'matroska':
          return 'video/x-matroska'
        default:
          return null
      }
    }

    offset = dataStart + size.value
  }

  return null
}

function detectBmp(bytes: Uint8Array): string | null {
  if (ascii(bytes, 0, 2) !== 'BM') {
    return null
  }

  // "BM" alone is too weak a signature, so the two reserved header fields
  // must be zero and the info header must have one of the defined sizes
  const reserved = readUint32LE(bytes, 6)
  const infoHeaderSize = readUint32LE(bytes, 14)

  if (
    reserved === 0 &&
    infoHeaderSize !== null &&
    BMP_INFO_HEADER_SIZES.has(infoHeaderSize)
  ) {
    return 'image/bmp'
  }

  return null
}

/**
 * Tells what kind of file `bytes` is from its contents (its magic bytes), not
 * from a filename or the type a browser claimed. This is content sniffing, in
 * the sense of the WHATWG MIME Sniffing standard, limited to binary formats
 * with unambiguous signatures.
 *
 * Use it wherever a file's type matters for safety: before handing a user
 * upload to an image or video decoder, before serving it inline, before
 * trusting an `accept` list. A file's claimed type and extension are chosen
 * by whoever sent it.
 *
 * Returns a MIME type, or `null` when the format isn't one this function
 * recognises. It never throws and never reads past the end of `bytes`, so
 * truncated or garbage input returns `null`. Passing the first
 * `DETECT_CONTENT_TYPE_BYTES` bytes is enough; passing the whole file works
 * too.
 *
 * Recognised: JPEG, PNG, GIF, WebP, BMP, TIFF, AVIF, HEIC/HEIF (stills and
 * sequences), PDF, MP4 (video, and `audio/mp4` for `.m4a`), QuickTime/MOV,
 * WebM and Matroska. MP4, MOV, HEIC and AVIF share the ISO-BMFF `ftyp` box
 * and are told apart by its brands; WebM and Matroska share the EBML header
 * and are told apart by its `DocType`. WebM and Matroska are always reported
 * as video, because the header doesn't say whether there is a video track.
 *
 * Not recognised, deliberately: SVG and other text formats (an SVG is XML that
 * can carry script, so it must never pass as a safe image, and text has no
 * reliable signature), and ZIP-based formats such as `.docx` (telling them
 * apart means reading the archive's directory). See `DETECTABLE_CONTENT_TYPES`
 * for the full list of possible results.
 *
 * @example
 * import { detectContentType } from '@cedarjs/uploads'
 *
 * const type = detectContentType(bytes)
 *
 * if (type !== 'image/jpeg' && type !== 'image/png') {
 *   throw new Error('Only JPEG and PNG images can be thumbnailed')
 * }
 */
export function detectContentType(bytes: Uint8Array): string | null {
  if (hasBytesAt(bytes, 0, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg'
  }

  if (hasBytesAt(bytes, 0, PNG_SIGNATURE)) {
    return 'image/png'
  }

  const head6 = ascii(bytes, 0, 6)

  if (head6 === 'GIF87a' || head6 === 'GIF89a') {
    return 'image/gif'
  }

  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') {
    return 'image/webp'
  }

  if (ascii(bytes, 0, 5) === '%PDF-') {
    return 'application/pdf'
  }

  const head4 = ascii(bytes, 0, 4)

  if (head4 === 'II*\0' || head4 === 'MM\0*') {
    return 'image/tiff'
  }

  return detectIsoBmff(bytes) ?? detectEbml(bytes) ?? detectBmp(bytes)
}

function normalize(mimeType: string) {
  return mimeType.split(';')[0].trim().toLowerCase()
}

/**
 * Decides whether a file is one of the `accept`ed types by what its bytes
 * are, and returns the content type to record for it, or `null` when the
 * file is not accepted. `accept` takes the same entries as an upload
 * profile's `allowedMimeTypes`: exact types and `type/*` wildcards.
 *
 * - When `detectContentType()` recognises the bytes, the detected type must
 *   match `accept`, and is what's returned. The claimed type doesn't matter,
 *   so a HEIC photo a browser sent as `application/octet-stream` is accepted
 *   as `image/heic`.
 * - When it doesn't, the file is accepted on the strength of `claimedType`
 *   only if that type is listed in `accept` exactly (a wildcard isn't
 *   enough) and isn't one of `DETECTABLE_CONTENT_TYPES` (a real PNG would
 *   have been recognised). So `['image/*']` admits only images the detector
 *   recognises, and `['image/*', 'text/csv']` also admits files claimed to
 *   be CSV.
 *
 * @example
 * import { acceptedContentType, storeFile } from '@cedarjs/uploads'
 *
 * const mimeType = acceptedContentType(data, ['image/*'], input.mimeType)
 *
 * if (!mimeType) {
 *   throw new Error('That file is not an image')
 * }
 *
 * await storeFile(target, { db, filename, mimeType, data })
 */
export function acceptedContentType(
  bytes: Uint8Array,
  accept: string[],
  claimedType?: string,
): string | null {
  const detected = detectContentType(bytes)

  if (detected) {
    return isMimeTypeAllowed(accept, detected) ? detected : null
  }

  if (!claimedType) {
    return null
  }

  const claimed = normalize(claimedType)

  if (!claimed || DETECTABLE_CONTENT_TYPES.has(claimed)) {
    return null
  }

  return accept.some((entry) => normalize(entry) === claimed) ? claimed : null
}
