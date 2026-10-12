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
is never taken on the client's word, a type that can carry script never comes
in through a wildcard, and when detection can't decide (a cut-off `ftyp` box,
an office file without its tail) it returns `null` rather than a guess.

## API

```ts
detectContentType(bytes: Uint8Array, options?: { tail?: Uint8Array }): string | null

acceptedContentType(
  bytes: Uint8Array,
  accept: string[],
  claimedType?: string,
  options?: { tail?: Uint8Array },
): string | null

isClaimedContentTypeAllowed(accept: string[], claimedType: string): boolean

DETECTABLE_CONTENT_TYPES: ReadonlySet<string>
DETECT_CONTENT_TYPE_BYTES: number // 4096
DETECT_CONTENT_TYPE_TAIL_BYTES: number // 65536

CONTENT_TYPE_ALIASES: ReadonlyMap<string, string> // alias → canonical
canonicalContentType(type: string): string
SCRIPTABLE_CONTENT_TYPES: ReadonlySet<string>
isScriptableContentType(type: string): boolean
```

All exported from `@cedarjs/uploads`, implemented in
`packages/uploads/src/detectContentType.ts` and
`packages/uploads/src/contentTypes.ts`, with no dependencies.

- `detectContentType()` returns a MIME type or `null` for anything it doesn't
  recognise. It never throws and never reads past the end of `bytes`.
- `acceptedContentType()` returns the type to store a file under, or `null` when
  it isn't accepted (rules below).
- `DETECTABLE_CONTENT_TYPES` is every type detection can return.
- `DETECT_CONTENT_TYPE_BYTES` is how much of a file's head detection needs, for
  ranged reads of large objects.
- `tail` is the end of the file, for when `bytes` is only its head. Only ZIPs
  use it (see Office files below). Without it, the end of `bytes` is taken as
  the end of the file, which is right when `bytes` is the whole file.
- `isClaimedContentTypeAllowed()` is the accept rule for a claimed type before
  any bytes exist (presigning).

### Naming

"Content type" is the vocabulary uploads and HTTP already use (`contentType` on
presigned uploads, `Content-Type` headers). The JSDoc says "sniff" and cites the
WHATWG MIME Sniffing standard so searches for either term find it.

## Formats

| Format          | Signature                                               | Result                               |
| :-------------- | :------------------------------------------------------ | :----------------------------------- |
| JPEG            | `FF D8 FF`                                              | `image/jpeg`                         |
| PNG             | `89 50 4E 47 0D 0A 1A 0A`                               | `image/png`                          |
| GIF             | `GIF87a` / `GIF89a`                                     | `image/gif`                          |
| WebP            | `RIFF` … `WEBP`                                         | `image/webp`                         |
| BMP             | `BM`, zero reserved fields, a defined info-header size  | `image/bmp`                          |
| TIFF            | `II*\0` / `MM\0*`                                       | `image/tiff`                         |
| PDF             | `%PDF-`                                                 | `application/pdf`                    |
| AVIF            | `ftyp`, brand `avif`/`avis`                             | `image/avif`                         |
| HEIC            | `ftyp`, brand `heic`/`heix`/`heim`/`heis`               | `image/heic`                         |
| HEIC sequence   | `ftyp`, brand `hevc`/`hevx`/`hevm`/`hevs`               | `image/heic-sequence`                |
| HEIF (other)    | `ftyp`, brand `mif1`/`mif2` / `msf1`                    | `image/heif` / `image/heif-sequence` |
| MP4             | `ftyp`, brand `isom`, `iso2`–`iso9`, `mp41`, `mp42`, …  | `video/mp4`                          |
| MP4 audio       | `ftyp`, brand `M4A ` / `M4B `                           | `audio/mp4`                          |
| QuickTime/MOV   | `ftyp`, brand `qt  `                                    | `video/quicktime`                    |
| WebM / Matroska | EBML header, `DocType` `webm` / `matroska`              | `video/webm` / `video/matroska`      |
| OpenDocument    | ZIP, first entry `mimetype`, stored, holding the type   | `…opendocument.text` etc.            |
| Office Open XML | ZIP with `[Content_Types].xml` and `word/`/`xl/`/`ppt/` | `…wordprocessingml.document` etc.    |
| … with macros   | the same, plus `vbaProject.bin` or `xl/macrosheets/`    | `…document.macroenabled.12` etc.     |

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

### Office files: OpenDocument and Office Open XML

Both are ZIP archives (`PK\x03\x04`).

- **OpenDocument** (`.odt`, `.ods`, `.odp`) puts an uncompressed `mimetype`
  file first, holding the document's type, so the first local file header
  decides on its own. Only the three types are reported; other ODF types and
  EPUB (same mechanism) are `null`.
- **Office Open XML** (`.docx`, `.xlsx`, `.pptx`) is recognised by its entry
  names: `[Content_Types].xml` plus parts under exactly one of `word/`, `xl/`
  or `ppt/`. A ZIP's entries are listed in its central directory, at the end
  of the file, found through the end-of-central-directory record (22 bytes plus
  a comment). The directory is located right before that record (record offset
  minus directory size), which works on a tail without knowing the file size,
  and every entry is walked and must end exactly at the record. ZIP64 and
  multi-disk archives are `null`.
- **Macros.** A file with a VBA project (`vbaProject.bin`, `vbaData.xml`) or
  Excel 4.0 macro sheets (`xl/macrosheets/`) is reported as its macro-enabled
  type (`application/vnd.ms-word.document.macroenabled.12` and so on), never as
  `.docx`/`.xlsx`/`.pptx`. Decided: their own types rather than `null`, so an
  app can allow them deliberately by listing them, and so a claim of `.docm`
  isn't refused as a lie. Types are lower case throughout (MIME types are
  case-insensitive; the registrations say `macroEnabled`).
- **Without a tail** the first local headers aren't enough for Office Open XML:
  a macro part can come after any number of entries, so the head alone returns
  `null`. The caller supplies the tail (`{ tail }`) or the whole file.
- **`DETECT_CONTENT_TYPE_TAIL_BYTES` = 64 KiB.** The end record is 22 bytes
  (office files have no comment). A directory entry is 46 bytes plus its name,
  about 100 bytes for a typical office part, so 64 KiB holds about 600 entries:
  every ordinary document and workbook, and decks of a few hundred slides. A
  directory that doesn't fit is `null`.
- Templates and slide shows (`.dotx`, `.xltx`, `.potx`, `.ppsx`) differ only
  inside `[Content_Types].xml`, which is usually compressed, and are reported
  as the document type.

### Spellings: one alias table

`CONTENT_TYPE_ALIASES` is used everywhere types are compared: profile
`allowedMimeTypes` checks (`isMimeTypeAllowed()`), `acceptedContentType()`'s
`accept`, and the storage key extension. An accept list naming either spelling
accepts the type, and files are stored under the canonical one, which is what
`detectContentType()` returns:

| Canonical (stored) | Aliases                         | Why the alias is common              |
| :----------------- | :------------------------------ | :----------------------------------- |
| `image/jpeg`       | `image/jpg`, `image/pjpeg`      | misspelling; old IE progressive JPEG |
| `image/png`        | `image/x-png`                   | old IE                               |
| `image/bmp`        | `image/x-ms-bmp`, `image/x-bmp` | libmagic, older systems              |
| `application/pdf`  | `application/x-pdf`             | pre-registration type                |
| `video/matroska`   | `video/x-matroska`              | browsers and most tools (RFC 9559)   |
| `audio/mp4`        | `audio/x-m4a`                   | browsers on macOS                    |
| `video/mp4`        | `video/x-m4v`                   | browsers on macOS                    |

Every alias stays within its canonical type's top-level type, so wildcards
match the same either way. `mime-types` has no extension for `video/matroska`,
so storage keys look the extension up under every spelling (`.mkv`).

### Left out, deliberately

- **SVG**: it is XML that can carry script, and must never pass as a safe image.
  An app that wants SVG lists `image/svg+xml` exactly (see the accept rules) and
  sanitises it separately.
- **Text formats** (CSV, JSON, HTML, XML): no reliable signature.
- **Legacy binary Office files** (`.doc`, `.xls`, OLE compound files) and
  **other ZIPs** (plain `.zip`, EPUB, JAR): not reported.
- **QuickTime files without an `ftyp` box** (starting with `moov`/`mdat`/
  `wide`): old files only, and the signatures are weak.
- **3GP, JPEG XL, ICO, audio formats other than M4A**: not needed by the first
  consumer. Each is a small addition with a test.

## Accept rules: `acceptedContentType()`

- **Recognised bytes**: the detected type must match `accept` (wildcards and
  aliases included) and is returned. The claimed type is ignored.
- **Unrecognised bytes**: the claimed type, canonicalised, is accepted when it
  matches `accept`, wildcards included, except:
  - a claimed type in `DETECTABLE_CONTENT_TYPES` (or an alias of one) is refused:
    the bytes didn't match, so the claim is false;
  - a type that can carry script must be listed exactly:
    `SCRIPTABLE_CONTENT_TYPES` (`image/svg+xml`, `text/html`,
    `application/xhtml+xml`, `text/xml`, `application/xml`, `text/xsl`, the
    JavaScript/ECMAScript types) and any type ending in `+xml`;
  - a claimed wildcard (`image/*`) is never a file's type.

  No claimed type means not accepted.

So `['text/*']` admits CSV but not HTML, `['image/*']` never admits SVG, and
`['*/*']` admits anything that isn't lying about being a detectable type and
isn't scriptable.

The earlier rule (unrecognised bytes accepted only when the claim was listed
exactly) made default-on unsafe for existing apps: profiles allowing `text/*`,
`application/*` or `*/*` would have started refusing CSV, JSON, ZIP and other
legitimate files. Only types that are dangerous to serve need the exact listing.

## Wiring into uploads

`verifyContentType` defaults to `true` everywhere; `false` is the opt-out and
restores trusting the claimed type.

- **`POST {prefix}/fs`** (plugin option): each file is checked with
  `acceptedContentType()` against the token's `allowedMimeTypes` once its bytes
  are read (the whole file, so office files need no separate tail), and stored
  (row, storage key extension, storage `Content-Type`) under the returned type.
  The claimed-type check before buffering is skipped, because browsers often
  claim `application/octet-stream` for formats they don't know, like HEIC.
- **Presigned S3 uploads**: `createPresignedUpload()` applies
  `isClaimedContentTypeAllowed()` to the declared type (no wildcards; scriptable
  types listed exactly). `confirmUpload()` and the S3 webhook
  (`processS3EventRecord()`, which gets the plugin's option) then read the first
  `DETECT_CONTENT_TYPE_BYTES` with a ranged GET, plus the last
  `DETECT_CONTENT_TYPE_TAIL_BYTES` when the head is a ZIP, and run
  `acceptedContentType(head, [declared], declared, { tail })`. A mismatch claims
  the row `failed`, deletes the object and (in `confirmUpload`) throws
  `MIME_TYPE_NOT_ALLOWED`. A match records the canonical type on the row.
  - The bytes are checked against the **declared** type, not the profile: the
    row doesn't record its profile, and the declared type was checked against
    the profile at presign time. A file declared `application/octet-stream`
    whose bytes are recognised is therefore refused even under `*/*`.
  - **The object's own `Content-Type`** is not rewritten (no CopyObject). The
    presigned PUT signs `Content-Type`, so the object carries the declared type,
    and the bytes had to be that type, so the two differ at most in spelling
    (`image/jpg` vs `image/jpeg`). S3 never serves an object as a type its bytes
    aren't, so a rewrite would cost a copy per upload for nothing.
  - Storage providers gain an optional `readRange(key, { offset, length })`.
    The S3 provider implements it with a `Range` header; the check falls back to
    `read()` for providers without it (the size was already checked against the
    profile, so that's bounded).
  - The storage key keeps the extension of the declared type.
- **The `uploadFile` service template** (database targets, the only place the
  generated app sees the bytes) calls `acceptedContentType()` on the decoded
  bytes and stores the returned type. Existing apps keep their generated
  service; the docs show the change.

## What the tests guard

`packages/uploads/src/__tests__/detectContentType.test.ts`, with every fixture a
minimal header or archive built in code (ZIPs by `helpers/zip.ts`, checked
against `unzip -t` and `file` while writing it):

- Every format in the table, every ISO-BMFF brand family, and the office
  formats: DOCX/XLSX/PPTX, DOCM/XLSM/PPTM (VBA project, and Excel 4.0 macro
  sheets only), ODT/ODS/ODP from the head alone, an archive comment containing
  an end-record lookalike.
- Malformed `ftyp` boxes and EBML headers, as before.
- ZIPs: a compressed or non-first `mimetype`, unreported ODF types and EPUB, no
  `[Content_Types].xml`, mixed `word/` and `xl/`, ZIP64 markers, a directory
  size that doesn't match its entries, a plain ZIP; Office Open XML from the
  head alone is `null`, with the tail it is recognised, and a tail too short
  for the directory is `null`; the tail is ignored for non-ZIPs.
- **No out-of-bounds reads**: every fixture and every prefix of every fixture
  on a proxy that throws past the end, 2000 seeded random inputs, and 2000
  random central directories behind a well-placed end record.
- `acceptedContentType()`: detected type wins; aliases in either direction;
  unrecognised bytes claimed as a detectable type (or an alias of one);
  wildcards for unrecognised types; each scriptable type refused through a
  wildcard and accepted when listed exactly; canonical spelling stored; wildcard
  claims refused; office files from head only, with tail, and macro-enabled
  files not passing as macro-free.
- `isMimeTypeAllowed()` aliases (`profilesAndTokens.test.ts`).
- `verifyStoredContentType.test.ts`: head-only read for non-ZIPs, head and tail
  for ZIPs, a single read for small objects, the `read()` fallback, canonical
  spelling, refusals (including a recognised file declared as
  `application/octet-stream`).
- `s3Provider.test.ts`: `readRange` sends the right `Range` header.
- `services.test.ts` / `webhooks.test.ts`: confirm and webhook fail and delete
  on a type mismatch, record the canonical type, read only the head, honour
  `verifyContentType: false`; presign refuses scriptable types through a
  wildcard and wildcard claims; the plugin passes its option to the webhook.
- `plugin.test.ts`: checking is the default; `false` trusts the claim; aliases
  stored canonically; `text/*` admits text but not HTML.
- CLI `uploadsHandler.test.ts`: the generated service uses
  `acceptedContentType()` and stores its result.

## Decided

The open questions from the first version of this plan:

1. **Default.** Decided: `verifyContentType` defaults to `true` in the plugin,
   `confirmUpload()`, `createPresignedUpload()` and the S3 webhook, with the
   wildcard rule above making that safe for profiles that use wildcards.
   `false` is the opt-out. The changeset calls it a behaviour change.
2. **Per-profile instead of per-plugin.** Not in this PR (follow-up below).
3. **S3 confirm.** Decided: yes, with a ranged GET of the head (and tail for
   ZIPs), in both `confirmUpload` and the webhook; mismatches are deleted.
4. **The `uploadFile` template.** Decided: yes, it uses `acceptedContentType()`.
5. **Web side.** Not in this PR (follow-up below).
6. **`video/x-matroska` vs `video/matroska`.** Decided: return and store the
   registered `video/matroska` (RFC 9559); the alias table makes either
   spelling in an accept list work.
7. **More formats.** Office formats added (OpenDocument, Office Open XML). 3GP,
   JPEG XL, ICO and `ftyp`-less MOV stay on demand.

## Open questions

1. **Profile on the row.** S3 uploads are checked against the declared type
   because the row doesn't record its profile. Storing the profile name (a
   schema change) would let a `*/*` profile accept a HEIC declared as
   `application/octet-stream`. Worth it?
2. **Directories larger than 64 KiB.** Very large decks are `null` and refused.
   A second ranged read sized from the end record would fix it; add it if
   anyone hits it?
3. **OpenDocument macros.** ODF has no separate macro type; an `.odt` with Basic
   macros is reported as `.odt`. Look for `Basic/` entries when the directory
   is available?

## Follow-ups (not in this PR)

- **Web-side export** of the detector, for earlier feedback in `useDbUpload`:
  [cedarjs/cedar#3032](https://github.com/cedarjs/cedar/issues/3032). Separate
  because the web bundle and its tests are their own surface, and the server
  check is what matters for safety.
- **Per-profile `verifyContentType`**: it would have to be signed into the upload
  token, changing its payload format; with default-on and a working wildcard
  rule, a plugin-wide switch is enough until someone needs a mix.
