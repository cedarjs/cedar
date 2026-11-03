import {
  canonicalContentType,
  isContentTypeListed,
  isExplicitOnlyContentType,
} from './contentTypes.js'
import { isMimeTypeAllowed } from './profiles.js'

/**
 * How many bytes from the start of a file `detectContentType()` needs to
 * recognise every format it knows. Pass at least this much when reading only
 * the head of a large file, e.g. with a ranged GET. Fewer bytes still work for
 * most formats. An ISO-BMFF file (MP4, HEIC…) whose type depends on a
 * compatible brand needs its whole `ftyp` box, and is reported as `null`
 * when the box is cut off. Office files (`.docx`, `.xlsx`, `.pptx`) also
 * need the end of the file; see `DETECT_CONTENT_TYPE_TAIL_BYTES`.
 */
export const DETECT_CONTENT_TYPE_BYTES = 4096

/**
 * How many bytes from the end of a file to pass as `tail` to
 * `detectContentType()` when `bytes` is only the head of the file. Only ZIP
 * files (head starts with `PK\x03\x04`) need it: telling a `.docx` from a
 * `.docm` or any other ZIP means reading the archive's central directory,
 * which is at the end.
 *
 * The end-of-central-directory record is 22 bytes, plus an archive comment
 * that office files don't have. Each directory entry is 46 bytes plus its
 * name (and an extra field some tools add), about 100 bytes for a typical
 * office part, so 64 KiB holds a directory of 600 or so entries: every
 * ordinary document and workbook, and slide decks of a few hundred slides.
 * A directory that doesn't fit is reported as `null`, never guessed; use
 * `findZipCentralDirectory()` to read the rest of it.
 */
export const DETECT_CONTENT_TYPE_TAIL_BYTES = 64 * 1024

/**
 * The largest ZIP central directory `detectContentType()` reads: 4 MiB, some
 * 40,000 entries, far beyond any real office file. A ZIP with a bigger
 * directory is reported as `null`, so a crafted archive can't make detection
 * walk (or a caller read) an unbounded directory.
 */
export const MAX_ZIP_DIRECTORY_BYTES = 4 * 1024 * 1024

export interface DetectContentTypeOptions {
  /**
   * The last bytes of the file, when `bytes` is only its head (for example
   * from two ranged reads of an object in storage). Without it, the end of
   * `bytes` is taken as the end of the file, which is right when `bytes` is
   * the whole file. Read `DETECT_CONTENT_TYPE_TAIL_BYTES`, or the whole file
   * when it is smaller. Only ZIP-based formats use it.
   */
  tail?: Uint8Array
}

const DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const PPTX =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
// Registered as `…macroEnabled.12`; MIME types are case-insensitive, and
// every type here is lower case so comparisons can be exact
const DOCM = 'application/vnd.ms-word.document.macroenabled.12'
const XLSM = 'application/vnd.ms-excel.sheet.macroenabled.12'
const PPTM = 'application/vnd.ms-powerpoint.presentation.macroenabled.12'
const ODT = 'application/vnd.oasis.opendocument.text'
const ODS = 'application/vnd.oasis.opendocument.spreadsheet'
const ODP = 'application/vnd.oasis.opendocument.presentation'

/**
 * Every MIME type `detectContentType()` can return, in its canonical
 * spelling. A claimed type in this set (or an alias of one) is one the bytes
 * can confirm or refute, which is what `acceptedContentType()` relies on.
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
  'video/matroska',
  DOCX,
  XLSX,
  PPTX,
  DOCM,
  XLSM,
  PPTM,
  ODT,
  ODS,
  ODP,
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
/**
 * Largest `ftyp` box read: 1 KiB, room for 252 compatible brands. Real ones
 * list a handful, so they are tens of bytes.
 */
const MAX_FTYP_BOX_SIZE = 1024

/** EBML element IDs, with their length marker bits kept. */
const EBML_DOC_TYPE_ID = 0x4282
/** Longest `DocType` read, with room for NUL padding after `matroska`. */
const MAX_DOC_TYPE_LENGTH = 32

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
  // valid for other boxes but never seen on a real `ftyp`, and neither is
  // one bigger than `MAX_FTYP_BOX_SIZE`, which would otherwise have the
  // brand scan below walk a whole large upload.
  if (
    boxSize === null ||
    boxSize < 16 ||
    boxSize % 4 !== 0 ||
    boxSize > MAX_FTYP_BOX_SIZE
  ) {
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
  const headerEnd = headerStart + headerSize.value
  let offset = headerStart

  // Every child must lie wholly inside the header the file declares; one
  // that runs past it means the header is broken
  while (offset < Math.min(headerEnd, bytes.length)) {
    const id = readVint(bytes, offset, true)

    if (!id || id.length > 4 || offset + id.length > headerEnd) {
      return null
    }

    const size = readVint(bytes, offset + id.length, false)

    if (!size || size.unknown) {
      return null
    }

    const dataStart = offset + id.length + size.length

    if (dataStart + size.value > headerEnd) {
      return null
    }

    if (id.value === EBML_DOC_TYPE_ID) {
      // Every DocType this function knows is short, so a long one is not one
      // of them, and is never copied out of the input
      let docTypeEnd = dataStart + size.value

      if (size.value > MAX_DOC_TYPE_LENGTH || docTypeEnd > bytes.length) {
        return null
      }

      // EBML strings may be padded with trailing NULs
      while (docTypeEnd > dataStart && bytes[docTypeEnd - 1] === 0) {
        docTypeEnd--
      }

      switch (ascii(bytes, dataStart, docTypeEnd)) {
        case 'webm':
          return 'video/webm'
        case 'matroska':
          return 'video/matroska'
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

const ZIP_LOCAL_HEADER = [0x50, 0x4b, 0x03, 0x04]
const ZIP_CENTRAL_HEADER = [0x50, 0x4b, 0x01, 0x02]
const ZIP_END_OF_DIRECTORY = [0x50, 0x4b, 0x05, 0x06]
const ZIP_LOCAL_HEADER_SIZE = 30
const ZIP_CENTRAL_HEADER_SIZE = 46
const ZIP_END_OF_DIRECTORY_SIZE = 22
const ZIP_MAX_COMMENT_LENGTH = 0xffff

/** The OpenDocument types `detectOpenDocument()` reports. */
const OPEN_DOCUMENT_TYPES = new Set([ODT, ODS, ODP])

function readUint16LE(bytes: Uint8Array, offset: number) {
  if (bytes.length < offset + 2) {
    return null
  }

  return bytes[offset] + bytes[offset + 1] * 0x100
}

/**
 * An OpenDocument file is a ZIP whose first entry is an uncompressed file
 * named `mimetype` holding the document's MIME type. That is all in the
 * first local file header, so the head of the file decides on its own.
 */
function detectOpenDocument(bytes: Uint8Array): string | null {
  const flags = readUint16LE(bytes, 6)
  const method = readUint16LE(bytes, 8)
  const compressedSize = readUint32LE(bytes, 18)
  const size = readUint32LE(bytes, 22)
  const nameLength = readUint16LE(bytes, 26)
  const extraLength = readUint16LE(bytes, 28)

  if (
    flags === null ||
    method === null ||
    compressedSize === null ||
    size === null ||
    nameLength === null ||
    extraLength === null
  ) {
    return null
  }

  // Stored (method 0), with its sizes in the header rather than in a data
  // descriptor after the data (flag bit 3)
  if (method !== 0 || flags & 0x08 || compressedSize !== size || size > 64) {
    return null
  }

  const nameEnd = ZIP_LOCAL_HEADER_SIZE + nameLength

  if (ascii(bytes, ZIP_LOCAL_HEADER_SIZE, nameEnd) !== 'mimetype') {
    return null
  }

  const contentStart = nameEnd + extraLength
  const content = ascii(bytes, contentStart, contentStart + size)

  return content !== null && OPEN_DOCUMENT_TYPES.has(content) ? content : null
}

interface ZipEndRecord {
  /** Where the record starts in the bytes it was found in. */
  recordOffset: number
  entries: number
  /** Size of the central directory, in bytes. */
  directorySize: number
  /** Where the central directory starts, from the start of the file. */
  directoryOffset: number
}

/**
 * Most end-of-central-directory candidates tried per file. A real record is
 * normally the first one found; more only appear when an archive comment
 * happens to contain the signature, and this bounds the work a crafted
 * comment full of them can cause.
 */
const MAX_ZIP_END_RECORD_CANDIDATES = 16

/**
 * End-of-central-directory record candidates at the end of `end`, nearest
 * the end first. A candidate is a record signature whose comment length
 * reaches exactly the end of `end`. An archive comment may itself contain
 * something that looks like one, so callers keep trying candidates until one
 * leads to a directory. Candidates describing a ZIP64 or multi-disk archive
 * (office files are neither), or a directory larger than
 * `MAX_ZIP_DIRECTORY_BYTES`, are skipped.
 */
function* zipEndRecords(end: Uint8Array): Generator<ZipEndRecord> {
  const last = end.length - ZIP_END_OF_DIRECTORY_SIZE
  const first = Math.max(0, last - ZIP_MAX_COMMENT_LENGTH)
  let candidates = 0

  for (let offset = last; offset >= first; offset--) {
    if (
      !hasBytesAt(end, offset, ZIP_END_OF_DIRECTORY) ||
      readUint16LE(end, offset + 20) !== last - offset
    ) {
      continue
    }

    if (++candidates > MAX_ZIP_END_RECORD_CANDIDATES) {
      return
    }

    const disk = readUint16LE(end, offset + 4)
    const directoryDisk = readUint16LE(end, offset + 6)
    const entries = readUint16LE(end, offset + 10)
    const directorySize = readUint32LE(end, offset + 12)
    const directoryOffset = readUint32LE(end, offset + 16)

    // 0xFFFF and 0xFFFFFFFF mean "see the ZIP64 record"
    if (
      disk !== 0 ||
      directoryDisk !== 0 ||
      entries === null ||
      entries === 0xffff ||
      directorySize === null ||
      directorySize === 0xffffffff ||
      directorySize > MAX_ZIP_DIRECTORY_BYTES ||
      directoryOffset === null ||
      directoryOffset === 0xffffffff
    ) {
      continue
    }

    yield { recordOffset: offset, entries, directorySize, directoryOffset }
  }
}

/**
 * Where a ZIP's central directory is, from the start of the file, read from
 * the end-of-central-directory record at the very end of `tail` (the last
 * bytes of the file). `null` when `tail` has no such record describing a
 * non-empty directory, or the archive is one `detectContentType()` won't
 * read (ZIP64, multi-disk, or a directory over `MAX_ZIP_DIRECTORY_BYTES`).
 *
 * For callers that read a large file in ranges: when `detectContentType(head,
 * { tail })` returns `null` for a ZIP because the directory starts before the
 * tail, read the bytes from `offset` up to where the tail starts, and pass
 * them and the tail joined together as the new `tail`.
 */
export function findZipCentralDirectory(
  tail: Uint8Array,
): { offset: number; size: number } | null {
  // An empty directory identifies nothing, and is what a lookalike in an
  // archive comment (signature plus zeros) usually describes
  for (const record of zipEndRecords(tail)) {
    if (record.entries > 0 && record.directorySize > 0) {
      return { offset: record.directoryOffset, size: record.directorySize }
    }
  }

  return null
}

/**
 * The entry names in the central directory an end-of-central-directory
 * `record` describes. `null` when the whole directory isn't in `end`, or
 * isn't well formed.
 */
function readZipEntryNames(
  end: Uint8Array,
  { recordOffset, entries, directorySize }: ZipEndRecord,
): string[] | null {
  // The directory sits right before the record. Locating it this way, rather
  // than by its recorded offset, works on a tail without knowing the file's
  // size; the entry walk below checks that it really is a directory.
  let offset = recordOffset - directorySize

  if (offset < 0) {
    return null
  }

  const names: string[] = []

  for (let i = 0; i < entries; i++) {
    if (!hasBytesAt(end, offset, ZIP_CENTRAL_HEADER)) {
      return null
    }

    const nameLength = readUint16LE(end, offset + 28)
    const extraLength = readUint16LE(end, offset + 30)
    const commentLength = readUint16LE(end, offset + 32)

    if (nameLength === null || extraLength === null || commentLength === null) {
      return null
    }

    const nameStart = offset + ZIP_CENTRAL_HEADER_SIZE
    const name = ascii(end, nameStart, nameStart + nameLength)
    offset = nameStart + nameLength + extraLength + commentLength

    if (name === null || offset > recordOffset) {
      return null
    }

    names.push(name)
  }

  return offset === recordOffset ? names : null
}

/**
 * Office Open XML files (`.docx`, `.xlsx`, `.pptx`) are ZIPs with a
 * `[Content_Types].xml` entry and their parts under `word/`, `xl/` or `ppt/`.
 * Macro-enabled files (`.docm`, `.xlsm`, `.pptm`) have the same layout plus
 * a VBA project or Excel 4.0 macro sheets, and are reported as their own
 * types so that an accept list of `.docx` never admits macros. Templates and
 * slide shows (`.dotx`, `.xltx`, `.potx`, `.ppsx`) differ only inside
 * `[Content_Types].xml` and are reported as the document type.
 */
function classifyOfficeOpenXml(entryNames: string[]): string | null {
  const names = entryNames.map((name) => name.toLowerCase())

  if (!names.includes('[content_types].xml')) {
    return null
  }

  const families = [
    { prefix: 'word/', plain: DOCX, macro: DOCM },
    { prefix: 'xl/', plain: XLSX, macro: XLSM },
    { prefix: 'ppt/', plain: PPTX, macro: PPTM },
  ].filter(({ prefix }) => names.some((name) => name.startsWith(prefix)))

  // None, or a mix that no Office application writes
  if (families.length !== 1) {
    return null
  }

  const hasMacros = names.some(
    (name) =>
      name.endsWith('vbaproject.bin') ||
      name.endsWith('vbadata.xml') ||
      name.startsWith('xl/macrosheets/'),
  )

  return hasMacros ? families[0].macro : families[0].plain
}

/**
 * ZIP-based office formats. OpenDocument is decided by the head alone;
 * Office Open XML needs the central directory, from `tail` or, without one,
 * from the end of `bytes`. Any other ZIP is `null`.
 */
function detectZip(bytes: Uint8Array, tail?: Uint8Array): string | null {
  if (!hasBytesAt(bytes, 0, ZIP_LOCAL_HEADER)) {
    return null
  }

  const openDocument = detectOpenDocument(bytes)

  if (openDocument) {
    return openDocument
  }

  const end = tail ?? bytes

  for (const record of zipEndRecords(end)) {
    const names = readZipEntryNames(end, record)
    const type = names && classifyOfficeOpenXml(names)

    if (type) {
      return type
    }
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
 * recognises. It never throws and never reads past the end of its input, so
 * truncated or garbage input returns `null`. Pass the whole file, or its
 * first `DETECT_CONTENT_TYPE_BYTES` bytes plus, for a ZIP, its last
 * `DETECT_CONTENT_TYPE_TAIL_BYTES` as `tail`. Without the tail, a `.docx`,
 * `.xlsx` or `.pptx` whose head is all there is returns `null`.
 *
 * Recognised: JPEG, PNG, GIF, WebP, BMP, TIFF, AVIF, HEIC/HEIF (stills and
 * sequences), PDF, MP4 (video, and `audio/mp4` for `.m4a`), QuickTime/MOV,
 * WebM, Matroska, OpenDocument (`.odt`, `.ods`, `.odp`) and Office Open XML
 * (`.docx`, `.xlsx`, `.pptx`, and their macro-enabled `.docm`, `.xlsm`,
 * `.pptm`, which are reported as their own types). MP4, MOV, HEIC and AVIF
 * share the ISO-BMFF `ftyp` box and are told apart by its brands; WebM and
 * Matroska share the EBML header and are told apart by its `DocType`. WebM
 * and Matroska are always reported as video, because the header doesn't say
 * whether there is a video track.
 *
 * Returned types are the canonical spellings (`image/jpeg`, `video/matroska`,
 * `audio/mp4`); see `CONTENT_TYPE_ALIASES` for the others.
 *
 * Not recognised, deliberately: SVG and other text formats (an SVG is XML that
 * can carry script, so it must never pass as a safe image, and text has no
 * reliable signature), ZIPs that aren't one of the office formats above, and
 * legacy binary Office files (`.doc`, `.xls`). See `DETECTABLE_CONTENT_TYPES`
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
 *
 * @example
 * // A large object in storage: its head, and its tail when it is a ZIP
 * const type = detectContentType(head, { tail })
 */
export function detectContentType(
  bytes: Uint8Array,
  options: DetectContentTypeOptions = {},
): string | null {
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

  return (
    detectIsoBmff(bytes) ??
    detectEbml(bytes) ??
    detectBmp(bytes) ??
    detectZip(bytes, options.tail)
  )
}

/**
 * Whether a claimed type may be accepted before the file's bytes are seen,
 * as when issuing a presigned upload URL: allowed by `accept`, not a
 * wildcard, and, for a type that can carry script or macros, listed exactly.
 * The bytes still have to be checked once they arrive.
 */
export function isClaimedContentTypeAllowed(
  accept: string[],
  claimedType: string,
): boolean {
  const claimed = canonicalContentType(claimedType)

  if (!claimed || claimed.includes('*')) {
    return false
  }

  return isExplicitOnlyContentType(claimed)
    ? isContentTypeListed(accept, claimed)
    : isMimeTypeAllowed(accept, claimed)
}

/**
 * Decides whether a file is one of the `accept`ed types by what its bytes
 * are, and returns the content type to record for it, or `null` when the
 * file is not accepted. `accept` takes the same entries as an upload
 * profile's `allowedMimeTypes`: exact types and `type/*` wildcards, with
 * either spelling of an aliased type (`CONTENT_TYPE_ALIASES`).
 *
 * - When `detectContentType()` recognises the bytes, the detected type must
 *   match `accept`, and is what's returned. The claimed type doesn't matter,
 *   so a HEIC photo a browser sent as `application/octet-stream` is accepted
 *   as `image/heic`. A macro-enabled Office file (`MACRO_CONTENT_TYPES`)
 *   must be listed exactly: `['application/*']` never admits a `.docm`.
 * - When it doesn't, the file is accepted on the strength of `claimedType`
 *   when that matches `accept`, wildcards included, except:
 *   - a claimed type in `DETECTABLE_CONTENT_TYPES` is refused: a real PNG
 *     would have been recognised, so the claim is false;
 *   - a type that can carry script (`SCRIPTABLE_CONTENT_TYPES`, and any XML
 *     type) or macros (`MACRO_CONTENT_TYPES`, which includes the legacy
 *     `.doc`, `.xls` and `.ppt` types) must be listed exactly. `['image/*']`
 *     never admits an SVG, `['text/*']` never admits HTML, and `['*\/*']`
 *     never admits a `.doc`.
 *
 *   No claimed type means not accepted.
 *
 * The returned type is canonical: lower-cased, without parameters, and with
 * aliases resolved, so a JPEG claimed as `image/jpg` is stored as
 * `image/jpeg`.
 *
 * Pass the whole file, or its head with `options.tail` (see
 * `detectContentType()`). An office file checked by its head alone isn't
 * recognised, and its claimed type is then refused as false.
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
  options: DetectContentTypeOptions = {},
): string | null {
  const result = checkContentType(bytes, accept, claimedType, options)

  return 'contentType' in result ? result.contentType : null
}

/** Why `checkContentType()` refused a file. */
export interface ContentTypeRejection {
  /**
   * What `detectContentType()` says the bytes are, or `null` when it doesn't
   * recognise them.
   */
  detected: string | null
  /**
   * The claimed type, canonical (`image/jpeg` for `image/jpg`), or `null`
   * when none was claimed.
   */
  claimed: string | null
}

/** The result of `checkContentType()`: the type to record, or why not. */
export type ContentTypeCheck =
  { contentType: string } | { rejected: ContentTypeRejection }

/**
 * `acceptedContentType()`, saying why a file is refused: the same rules,
 * but returns `{ contentType }` for an accepted file and
 * `{ rejected: { detected, claimed } }` for a refused one, so an error can
 * name both types.
 *
 * The two differing is the case worth explaining. An iPhone photo whose
 * major brand is `hevc` is detected as `image/heic-sequence`, while the
 * browser claims `image/heic`, so a profile that only lists `image/heic`
 * refuses it.
 *
 * @example
 * import { checkContentType } from '@cedarjs/uploads'
 *
 * const result = checkContentType(data, ['image/heic'], 'image/heic')
 *
 * if ('rejected' in result) {
 *   const { detected, claimed } = result.rejected
 *   throw new Error(`Sent as ${claimed}, but the file is ${detected}`)
 * }
 *
 * await storeFile(target, { db, filename, mimeType: result.contentType, data })
 */
export function checkContentType(
  bytes: Uint8Array,
  accept: string[],
  claimedType?: string,
  options: DetectContentTypeOptions = {},
): ContentTypeCheck {
  const detected = detectContentType(bytes, options)
  const claimed = claimedType ? canonicalContentType(claimedType) : ''
  const rejected = { detected, claimed: claimed || null }

  if (detected) {
    // A macro-enabled file needs naming exactly, whatever the wildcards say
    const allowed = isExplicitOnlyContentType(detected)
      ? isContentTypeListed(accept, detected)
      : isMimeTypeAllowed(accept, detected)

    return allowed ? { contentType: detected } : { rejected }
  }

  // No claimed type means not accepted. And a type the detector knows would
  // have been recognised, so the claim is false.
  if (!claimed || DETECTABLE_CONTENT_TYPES.has(claimed)) {
    return { rejected }
  }

  return isClaimedContentTypeAllowed(accept, claimed)
    ? { contentType: claimed }
    : { rejected }
}
