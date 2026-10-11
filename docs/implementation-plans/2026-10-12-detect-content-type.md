# Detecting what an uploaded file really is: `detectContentType()`

Plan for adding content detection ("magic bytes", content sniffing) to
`@cedarjs/uploads`, and for using it where uploads check a file's type.

## Why

An upload carries two claims about its type: its filename and the MIME type the
client sent. Both are chosen by whoever uploads the file. `@cedarjs/uploads`
checks a profile's `allowedMimeTypes` against the claimed type, which keeps
honest clients on track but stops no one: an HTML page uploaded as `cat.png`
with `Content-Type: image/png` passes an `image/*` profile.

That matters as soon as the app does anything with the bytes. The case this
comes from is an app that generates thumbnails and previews of files that arrive
from users, from insurers' systems and from ERP integrations. Its image decoder
is compiled with a small set of formats enabled, and the only formats sent to it
are the ones its decoders allow, **judged by the bytes**. A file claiming to be
a JPEG that is really something else never reaches the decoder, and a HEIC photo
a browser labelled `application/octet-stream` still gets a thumbnail. The same
check decides what the app's file proxy will serve inline. Every app that does
this needs the same small, careful function, and it is easy to get subtly wrong
(see the ISO-BMFF section below), so it belongs in the framework.

Related proposals from the same work, each its own PR:

- **Derived files (variants) on `@cedarjs/uploads`**: thumbnails and previews
  stored as files derived from an upload. Variant generation is the main
  consumer of `detectContentType()`: it decides which generator, if any, a file
  goes to.
- **Declarative recurring and unique jobs in `@cedarjs/jobs`**: thumbnail
  generation runs as a job, deduplicated per file.
- **A "locked child" runner** for parsing untrusted files in a sandboxed Node
  process. Detection is the cheap first gate; the sandbox contains whatever a
  decoder does with a file that passed it.

Design principle applied: _fail closed_
([design principles](../design-principles.md)). A type the detector recognises
is never taken on the client's word, and a wildcard in an accept list never
admits a file the detector can't vouch for.

## API

```ts
detectContentType(bytes: Uint8Array): string | null

acceptedContentType(
  bytes: Uint8Array,
  accept: string[],
  claimedType?: string,
): string | null

DETECTABLE_CONTENT_TYPES: ReadonlySet<string>
DETECT_CONTENT_TYPE_BYTES: number // 4096
```

All exported from `@cedarjs/uploads`, implemented in
`packages/uploads/src/detectContentType.ts`, with no dependencies.

- `detectContentType()` returns a MIME type or `null` for anything it doesn't
  recognise. It never throws and never reads past the end of `bytes`.
- `acceptedContentType()` returns the type to store a file under, or `null` when
  it isn't accepted (rules below).
- `DETECTABLE_CONTENT_TYPES` is every type detection can return.
- `DETECT_CONTENT_TYPE_BYTES` is how much of a file's head detection needs, for
  ranged reads of large objects.

### Naming

"Content type" is the vocabulary uploads and HTTP already use (`contentType` on
presigned uploads, `Content-Type` headers). The JSDoc says "sniff" and cites the
WHATWG MIME Sniffing standard so searches for either term find it.

## Formats

| Format          | Signature                                              | Result                               |
| :-------------- | :----------------------------------------------------- | :----------------------------------- |
| JPEG            | `FF D8 FF`                                             | `image/jpeg`                         |
| PNG             | `89 50 4E 47 0D 0A 1A 0A`                              | `image/png`                          |
| GIF             | `GIF87a` / `GIF89a`                                    | `image/gif`                          |
| WebP            | `RIFF` … `WEBP`                                        | `image/webp`                         |
| BMP             | `BM`, zero reserved fields, a defined info-header size | `image/bmp`                          |
| TIFF            | `II*\0` / `MM\0*`                                      | `image/tiff`                         |
| PDF             | `%PDF-`                                                | `application/pdf`                    |
| AVIF            | `ftyp`, brand `avif`/`avis`                            | `image/avif`                         |
| HEIC            | `ftyp`, brand `heic`/`heix`/`heim`/`heis`              | `image/heic`                         |
| HEIC sequence   | `ftyp`, brand `hevc`/`hevx`/`hevm`/`hevs`              | `image/heic-sequence`                |
| HEIF (other)    | `ftyp`, brand `mif1`/`mif2` / `msf1`                   | `image/heif` / `image/heif-sequence` |
| MP4             | `ftyp`, brand `isom`, `iso2`–`iso9`, `mp41`, `mp42`, … | `video/mp4`                          |
| MP4 audio       | `ftyp`, brand `M4A ` / `M4B `                          | `audio/mp4`                          |
| QuickTime/MOV   | `ftyp`, brand `qt  `                                   | `video/quicktime`                    |
| WebM / Matroska | EBML header, `DocType` `webm` / `matroska`             | `video/webm` / `video/x-matroska`    |

### ISO-BMFF: MP4, MOV, HEIC and AVIF

All four start with an `ftyp` box: a big-endian 32-bit size, `ftyp`, a
four-character major brand, a minor version, and compatible brands up to the end
of the box. Telling them apart:

1. The box must be well formed: size at least 16 and a multiple of four. Sizes 0
   and 1 (valid for other boxes) are rejected.
2. A specific major brand decides on its own: AVIF, then HEIC, then HEIC
   sequence, then QuickTime, then MP4 audio, then MP4.
3. Otherwise the major brand is generic (`mif1`/`msf1` only say "some HEIF") or
   unknown, and the compatible brands decide, image codecs first: an AVIF or
   HEIC also lists generic brands and sometimes `iso8` or `mp41`. A `mif1` file
   listing `avif` is AVIF; one listing `heic` is HEIC; one listing neither is
   generic HEIF.
4. When the compatible brands decide, the whole `ftyp` box must be present. A
   cut-off list could be missing the brand that matters, so a truncated box
   returns `null` rather than a guess.

### EBML: WebM and Matroska

Both start with an EBML header element (`1A 45 DF A3`). Its children are walked
as variable-length-integer IDs and sizes until the `DocType` element (`42 82`),
whose string value (`webm` or `matroska`, NUL padding allowed) decides. Unknown
sizes, invalid length bytes, IDs longer than four bytes and values running past
the input all return `null`. The header doesn't say whether there is a video
track, so both are reported as video.

### Left out, deliberately

- **SVG**: it is XML that can carry script, and must never pass as a safe image.
  An app that wants SVG lists `image/svg+xml` exactly (see the accept rules) and
  sanitises it separately.
- **Text formats** (CSV, JSON, HTML, XML): no reliable signature.
- **ZIP-based office formats** (`.docx`, `.xlsx`): telling them apart from other
  ZIPs means reading the archive's central directory, which is neither small nor
  cheap.
- **QuickTime files without an `ftyp` box** (starting with `moov`/`mdat`/
  `wide`): old files only, and the signatures are weak.
- **3GP, JPEG XL, ICO, audio formats other than M4A**: not needed by the first
  consumer. Each is a small addition with a test.

## Accept rules: `acceptedContentType()`

- **Recognised bytes**: the detected type must match `accept` (wildcards
  included) and is returned. The claimed type is ignored.
- **Unrecognised bytes**: the claimed type is accepted only if it is listed in
  `accept` exactly (not through a wildcard) and isn't in
  `DETECTABLE_CONTENT_TYPES` (a real PNG would have been recognised). No claimed
  type means not accepted.

So `['image/*']` admits only images the detector recognises,
`['image/*', 'text/csv']` also admits files claimed to be CSV, and `['*/*']`
admits only recognised files. An app that wants "anything" doesn't turn
verification on.

## Wiring into uploads

The upload plugin's `POST {prefix}/fs` route is where `allowedMimeTypes` is
checked against bytes the server holds. It gets an opt-in plugin option:

```ts
await server.register(cedarUploadsPlugin, { /* … */ verifyContentType: true })
```

With it on, each file is checked with `acceptedContentType()` against the
token's `allowedMimeTypes` once its bytes are read, and stored (row, storage key
extension, and storage `Content-Type`) under the returned type. The claimed-type
check before buffering is skipped, because browsers often claim
`application/octet-stream` for formats they don't know, like HEIC. Size limits
apply as before.

Backward compatibility: the option defaults to `false`, and without it the route
checks the claimed type only. It is a plugin option rather than a profile option
so the token payload format doesn't change.

Not wired, and why:

- **Presigned S3 uploads** never pass through the api; the server has no bytes
  to check at presign time. Checking at confirm time would need a ranged GET of
  `DETECT_CONTENT_TYPE_BYTES` per upload (open question).
- **The `uploadFile` service for database targets** is app code generated by
  `yarn cedar setup uploads`. The docs show how to swap its
  `isMimeTypeAllowed()` call for `acceptedContentType()`; changing the template
  is an open question.

## What the tests guard

`packages/uploads/src/__tests__/detectContentType.test.ts`, with every fixture a
minimal header built in code:

- Every format in the table, and every ISO-BMFF brand family, including AVIF and
  HEIC under a generic `mif1` major brand and MP4/QuickTime under an unlisted
  major brand.
- Malformed `ftyp` boxes (sizes 0, 1, too small, not a multiple of four); brands
  past the end of the box being ignored; a cut-off brand list returning `null`
  while a deciding major brand still works.
- EBML `DocType` after other elements, NUL padding, multi-byte sizes; unknown
  DocType, missing DocType, unknown and invalid sizes, and a DocType running
  past the input returning `null`.
- SVG, HTML, plain text, WAVE, ZIP and empty input returning `null`, and "BM"
  text not passing as a bitmap.
- **No out-of-bounds reads**: detection runs on a proxy that throws on any index
  at or past the end, for every fixture, every prefix of every fixture (each
  must be detected the same or as `null`, never as something else), and 2000
  seeded random inputs, half starting with a real signature.
- `acceptedContentType()`: detected type wins over the claim; recognised but not
  accepted; unrecognised bytes claimed as a detectable type; exact listing
  versus wildcards; parameters and case in the claim; SVG never through
  `image/*`.
- Plugin (`plugin.test.ts`): without the option the claimed type is trusted;
  with it, a PNG claimed as `application/octet-stream` is stored as `image/png`
  with a `.png` key, HTML claimed as PNG is refused with no row left behind, a
  recognised but disallowed type is refused, and an unrecognisable type passes
  only when listed exactly.

## Open questions

1. **Default.** Should `verifyContentType` default to `true` in the next major,
   and `yarn cedar setup uploads` turn it on for new apps?
2. **Per-profile instead of per-plugin.** A profile-level flag would need it
   signed into the upload token. Worth it?
3. **S3 confirm.** Verify presigned uploads in `confirmUpload` with a ranged GET
   of the first `DETECT_CONTENT_TYPE_BYTES`, failing and deleting the object on
   mismatch?
4. **The `uploadFile` template.** Generate it with `acceptedContentType()`? That
   changes the stored type for existing apps' new uploads (the detected type
   instead of the claimed one).
5. **Web side.** The detector is dependency-free and runs in a browser;
   `useDbUpload` could use it for earlier feedback. Export it from
   `@cedarjs/uploads/web` too?
6. **`video/x-matroska`** is the common but unregistered type for MKV;
   `video/matroska` is the IANA one. Which should be returned?
7. **More formats** (3GP, JPEG XL, ICO, old `ftyp`-less MOV): add on demand?
