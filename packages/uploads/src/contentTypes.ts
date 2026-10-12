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
