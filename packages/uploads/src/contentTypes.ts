/**
 * Content-type spellings and classes shared by every place uploads compare
 * types: profile `allowedMimeTypes`, `acceptedContentType()`'s accept list,
 * and the type a file is stored under.
 */

/**
 * Other spellings of types `detectContentType()` returns, mapped to the
 * spelling it returns (the canonical one). Comparisons treat both spellings
 * as the same type, so an accept list naming either accepts the file, and
 * files are stored under the canonical spelling.
 *
 * - `image/jpg`, `image/pjpeg`: common misspelling, and what old Internet
 *   Explorer sent for progressive JPEGs.
 * - `image/x-png`: what old Internet Explorer sent for PNGs.
 * - `image/x-ms-bmp`, `image/x-bmp`: what `file`/libmagic and older systems
 *   report for BMPs. `image/bmp` is the registered type (RFC 7903).
 * - `application/x-pdf`: pre-registration PDF type some systems still send.
 * - `video/x-matroska`: the type browsers and most tools report for `.mkv`.
 *   `video/matroska` is the registered one (RFC 9559).
 * - `audio/x-m4a`: what browsers on macOS report for `.m4a`. `audio/mp4` is
 *   the registered type (RFC 4337).
 * - `video/x-m4v`: what browsers on macOS report for `.m4v`, an MP4 video.
 */
export const CONTENT_TYPE_ALIASES: ReadonlyMap<string, string> = new Map([
  ['image/jpg', 'image/jpeg'],
  ['image/pjpeg', 'image/jpeg'],
  ['image/x-png', 'image/png'],
  ['image/x-ms-bmp', 'image/bmp'],
  ['image/x-bmp', 'image/bmp'],
  ['application/x-pdf', 'application/pdf'],
  ['video/x-matroska', 'video/matroska'],
  ['audio/x-m4a', 'audio/mp4'],
  ['video/x-m4v', 'video/mp4'],
])

/**
 * Types a browser runs script in, or renders as a document that can run
 * script, when it is served from the app's origin. `acceptedContentType()`
 * never accepts one of these through a wildcard: an accept list has to name
 * it exactly. Every XML type (`text/xml`, `application/xml`, and anything
 * with a `+xml` suffix, such as `image/svg+xml` or `application/xhtml+xml`)
 * counts too, whether or not it is listed here.
 */
export const SCRIPTABLE_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'image/svg+xml',
  'text/html',
  'application/xhtml+xml',
  'text/xml',
  'application/xml',
  'text/xsl',
  'text/javascript',
  'application/javascript',
  'application/x-javascript',
  'text/ecmascript',
  'application/ecmascript',
])

/**
 * Office types that can carry macros. Macros run in Office on the machine of
 * whoever downloads the file, so accepting one is a way to deliver malware
 * to the app's other users, not an XSS risk, and a profile meant for
 * "documents" almost never means files with macros. `acceptedContentType()`
 * accepts these only when an accept list names them exactly, never through
 * a wildcard such as `application/*` or `*\/*`, whether the type was
 * detected from the bytes or claimed for bytes it doesn't recognise.
 *
 * The macro-enabled Office Open XML types (documents, templates, add-ins and
 * slide shows, and the binary `.xlsb` workbook), and the legacy binary
 * `.doc`, `.xls` and `.ppt` types, which can carry VBA too and which
 * detection doesn't recognise. Lower case, like every canonical type.
 */
export const MACRO_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'application/vnd.ms-word.document.macroenabled.12',
  'application/vnd.ms-word.template.macroenabled.12',
  'application/vnd.ms-excel.sheet.macroenabled.12',
  'application/vnd.ms-excel.template.macroenabled.12',
  'application/vnd.ms-excel.addin.macroenabled.12',
  'application/vnd.ms-excel.sheet.binary.macroenabled.12',
  'application/vnd.ms-powerpoint.presentation.macroenabled.12',
  'application/vnd.ms-powerpoint.template.macroenabled.12',
  'application/vnd.ms-powerpoint.slideshow.macroenabled.12',
  'application/vnd.ms-powerpoint.addin.macroenabled.12',
  'application/vnd.ms-powerpoint.slide.macroenabled.12',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
])

/** `type/subtype`, lower-cased, without parameters such as `charset`. */
export function normalizeContentType(contentType: string): string {
  return contentType.split(';')[0].trim().toLowerCase()
}

/**
 * The canonical spelling of `contentType`: normalized (lower-cased, without
 * parameters), with aliases from `CONTENT_TYPE_ALIASES` resolved.
 */
export function canonicalContentType(contentType: string): string {
  const normalized = normalizeContentType(contentType)

  return CONTENT_TYPE_ALIASES.get(normalized) ?? normalized
}

/** Every spelling of a canonical type: itself first, then its aliases. */
export function contentTypeSpellings(canonical: string): string[] {
  const spellings = [canonical]

  for (const [alias, target] of CONTENT_TYPE_ALIASES) {
    if (target === canonical) {
      spellings.push(alias)
    }
  }

  return spellings
}

/**
 * Whether a browser could run script in `contentType` served inline: one of
 * `SCRIPTABLE_CONTENT_TYPES`, or any XML type.
 */
export function isScriptableContentType(contentType: string): boolean {
  const type = canonicalContentType(contentType)

  return SCRIPTABLE_CONTENT_TYPES.has(type) || type.endsWith('+xml')
}

/**
 * Whether `contentType` is only accepted when listed exactly, never through a
 * wildcard: a type that can carry script (`isScriptableContentType()`) or
 * macros (`MACRO_CONTENT_TYPES`).
 */
export function isExplicitOnlyContentType(contentType: string): boolean {
  return (
    isScriptableContentType(contentType) ||
    MACRO_CONTENT_TYPES.has(canonicalContentType(contentType))
  )
}

/**
 * Whether `accept` names `contentType` exactly, not through a wildcard.
 * Aliases count as the same type.
 */
export function isContentTypeListed(
  accept: string[],
  contentType: string,
): boolean {
  const type = canonicalContentType(contentType)

  return accept.some((entry) => canonicalContentType(entry) === type)
}
