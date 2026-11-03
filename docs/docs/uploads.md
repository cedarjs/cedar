---
description: Upload files to S3, the local filesystem, or the database, and store server-generated files
---

# Uploads & Storage

Whether it's user avatars, document sharing, or PDFs your app generates itself, files need somewhere to live and a safe way to get there. `@cedarjs/uploads` gives your api side named storage targets, token-gated upload routes, and a single `Upload` table that tracks every file; and gives your web side hooks and components built on [Uppy](https://uppy.io).

The design in one paragraph: **GraphQL authorizes, Fastify moves bytes, services own the lifecycle.** A client asks GraphQL for a short-lived upload token for a named profile. The token carries the profile's limits, signed. Bytes then go either straight to S3 with a presigned URL or through a Fastify route on the api server, both of which check the token before accepting anything. Every file gets an `Upload` row, and your services call `storeFile()` and `deleteFile()` explicitly, so nothing happens behind your back inside a database query.

## Setup

```bash
yarn cedar setup uploads
```

The command asks which storage targets to configure. In a script or CI, pass them with `--targets` instead:

```bash
yarn cedar setup uploads --targets fs db s3
```

The command:

- Adds the `Upload` model to `schema.prisma`
- Creates `api/src/lib/uploads.ts` with your storage targets and upload profiles
- Creates `api/src/graphql/uploads.sdl.ts` and `api/src/services/uploads/uploads.ts`
- Creates the `@requireUploadToken`, `@withSignedUrl`, and `@withDataUri` directives
- Creates `api/src/server.ts` if you don't have one and registers the upload plugin in it, wired to your auth decoder and `getCurrentUser` when the app has auth
- Installs `@cedarjs/uploads` on both sides, plus the AWS SDK and Uppy packages your targets need
- Adds `UPLOAD_TOKEN_SECRET` (freshly generated) and any target-specific variables to `.env`

Afterwards, run the migration and regenerate types:

```bash
yarn cedar prisma migrate dev
yarn cedar generate types
```

## Storage targets

A target is a named destination backed by a provider. `api/src/lib/uploads.ts` defines them:

```ts title="api/src/lib/uploads.ts"
import path from 'node:path'

import { S3Client } from '@aws-sdk/client-s3'

import { getPaths } from '@cedarjs/project-config'
import {
  createDbProvider,
  createFsProvider,
  defineStorageTargets,
} from '@cedarjs/uploads'
import { createS3Provider } from '@cedarjs/uploads/s3'

export const s3Client = new S3Client({ region: process.env.AWS_REGION })

export const targets = defineStorageTargets({
  avatars: createS3Provider({
    client: s3Client,
    bucket: process.env.S3_BUCKET_AVATARS,
    region: process.env.AWS_REGION,
    keyPrefix: 'avatars/',
  }),
  local: createFsProvider({
    uploadDir: path.join(getPaths().api.base, '.uploads'),
    serveBaseUrl: process.env.UPLOAD_SERVE_BASE_URL,
    signSecret: process.env.UPLOAD_TOKEN_SECRET,
  }),
  thumbnails: createDbProvider(),
})
```

`defineStorageTargets` names each provider after its key, so `targets.avatars` works for direct access and `resolveTarget(targets, upload.target)` works when the name comes from a database row.

Three providers ship with the package:

| Provider             | Where bytes go                  | How uploads arrive                                 | Best for                                |
| :------------------- | :------------------------------ | :------------------------------------------------- | :-------------------------------------- |
| `createS3Provider()` | An S3 (or S3-compatible) bucket | Straight from the browser with a presigned PUT URL | Production                              |
| `createFsProvider()` | A directory on the api server   | `POST /upload/fs` on the api server                | Development, single-server deploys      |
| `createDbProvider()` | The `Upload.data` column        | Base64 through a GraphQL mutation                  | Small files like avatars and thumbnails |

The S3 provider lives at `@cedarjs/uploads/s3` because it needs `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`, which are only installed when you use it. It works with any S3-compatible service: point the `S3Client` at the service's endpoint.

Every provider implements the same small `StorageProvider` contract (`write`, `read`, `delete`, `exists`, `getObjectSize`, `getSignedReadUrl`, `getPresignedUploadUrl`, `getConfig`). That's what lets directives and utilities treat targets interchangeably. It is a contract, not an abstraction layer: your `S3Client` is right there in the config file for anything provider-specific, and `target.getConfig()` hands you the bucket, region, and key prefix for services like transloadit or imgix.

## Upload profiles

Clients never say how big a file may be or what type it can have. They name a **profile**, and the server owns what that profile allows:

```ts title="api/src/lib/uploads.ts"
export const profiles = defineUploadProfiles({
  avatar: {
    target: 'avatars',
    allowedMimeTypes: ['image/png', 'image/jpeg'],
    maxFileSize: 5 * 1024 * 1024,
    maxFiles: 1,
  },
  attachment: {
    target: 'local',
    allowedMimeTypes: ['application/pdf', 'image/*'],
    maxFileSize: 25 * 1024 * 1024,
    maxFiles: 10,
  },
})
```

`allowedMimeTypes` accepts exact types and `type/*` wildcards, and is checked against what each file's bytes are, not just the type the client claimed (see [Checking what a file really is](#checking-what-a-file-really-is)). Types that can carry script, like SVG and HTML, only match when listed exactly. `maxFiles` is enforced per token across every request that uses it, not just per batch. Profiles can also set `expiresIn` for their tokens; the default is five minutes. Per-user variation, like bigger limits for paying accounts, is plain code in the `requestUploadToken` resolver.

## The `Upload` model

Every file, whether uploaded by a user or generated by the server, gets a row:

```prisma
model Upload {
  id             String   @id @default(cuid())
  target         String
  status         String   @default("pending")
  filename       String
  mimeType       String
  size           BigInt
  storageKey     String?
  data           Bytes?
  userId         String?
  tokenId        String?
  organizationId String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```

`target` says which provider holds the file and `storageKey` is that provider's reference (an S3 key, a filename on disk, or `null` for inline data). Your own models reference uploads by id:

```prisma
model User {
  id       String  @id
  avatarId String?
  avatar   Upload? @relation(fields: [avatarId], references: [id])
}
```

`status` moves from `pending` to `completed` when the bytes are confirmed to be in place, or to `failed` when they never arrived or didn't match what was authorized. Only `completed` uploads are ever served.

## Upload tokens

An upload token is a [signed token](signed-tokens.md) with the `cedar-upload` purpose. It carries the profile's constraints, the target, the id of the user it was issued to, and a unique id the server uses to count how many files the token has created. The generated `requestUploadToken` query issues them:

```graphql
query {
  requestUploadToken(profile: "avatar") {
    token
    allowedMimeTypes
    maxFileSize
    maxFiles
  }
}
```

The echoed constraints are for client-side UX, such as file-picker filters. The copy inside the token is what the server enforces. Tokens are always bound to a user: `requestUploadToken` refuses to issue one without `context.currentUser`, and both the upload routes and the `@requireUploadToken` directive reject a token presented by a different user.

Tokens are signed with `UPLOAD_TOKEN_SECRET`. Generate one with `yarn cedar generate secret`, keep it out of version control, and use a different value per environment.

## Uploading from the web side

Install what your targets need. The setup command does this for you; for reference, direct-to-S3 uploads need `@uppy/core`, `@uppy/react`, and `@uppy/aws-s3`, filesystem uploads need `@uppy/xhr-upload` instead of `@uppy/aws-s3`, and `@uppy/dashboard` provides the default UI.

### S3 and filesystem targets

`useS3Upload` and `useFsUpload` do the whole dance: fetch a token, upload each file, and hand you the resulting `Upload` ids.

```tsx title="web/src/components/AvatarUploader.tsx"
import { UppyUploader, useS3Upload } from '@cedarjs/uploads/web'

const AvatarUploader = ({ onDone }: { onDone: (uploadId: string) => void }) => {
  const { uppy } = useS3Upload({
    profile: 'avatar',
    onUploadComplete: ([uploadId]) => onDone(uploadId),
  })

  return <UppyUploader uppy={uppy} />
}
```

Swap `useS3Upload` for `useFsUpload` to upload through the api server. Both return `{ uppy, completedUploads, isUploading }`, and the `uppy` instance is a regular Uppy instance, so any Uppy UI works with it. `UppyUploader` renders the Uppy Dashboard by default; `variant="drag-drop"` renders a headless dropzone with a file list and `variant="file-input"` renders a plain upload button. `<S3Uploader>` and `<FsUploader>` bundle the hook and the UI for the common case.

Behind the scenes, `useS3Upload` asks the `createPresignedUploadUrl` mutation for a URL per file (sending the token in the `x-upload-token` header), PUTs the bytes there, then calls `confirmUpload`. `useFsUpload` posts each file to `/upload/fs` with the token in the same header. `useFsUpload` reads the api origin from `RWJS_API_URL`; pass `endpoint` to override it.

Both hooks keep track of how many files the current token has been used for and when it expires, and fetch a fresh token when it has no files left or is about to expire. A mounted component can upload any number of times, including with a `maxFiles: 1` profile.

### Database targets

Small files go through GraphQL as base64. `useDbUpload` and `<DbInput>` read files in the browser and validate them against the profile's constraints; the generated `uploadFile` mutation stores them:

```tsx title="web/src/components/ThumbnailInput.tsx"
import { DbInput } from '@cedarjs/uploads/web'

import { useMutation } from '@cedarjs/web'

const UPLOAD_FILE = gql`
  mutation UploadThumbnail($input: UploadFileInput!) {
    uploadFile(profile: "thumbnail", input: $input) {
      id
    }
  }
`

const ThumbnailInput = () => {
  const [uploadFile] = useMutation(UPLOAD_FILE)

  return (
    <DbInput
      allowedMimeTypes={['image/png', 'image/jpeg']}
      maxFileSize={1024 * 1024}
      onFilesReady={([file]) => uploadFile({ variables: { input: file } })}
    />
  )
}
```

The client-side checks are for feedback only. The `uploadFile` service validates the MIME type and size again and `storeFile()` enforces the 1 MB default cap for database targets.

## Checking what a file really is

An upload's MIME type, and its filename, are whatever the client sent. Checking `allowedMimeTypes` against them keeps honest users on track, but anyone can upload an HTML page named `cat.png` and claimed to be `image/png`. So uploads check what each file's bytes are as well (the plugin's `verifyContentType`, on by default), and anything of your own that relies on a file's type for safety, like handing it to an image decoder or serving it inline, should do the same.

`detectContentType()` tells what a file is from its bytes (its "magic bytes", also called content sniffing):

```ts
import { detectContentType } from '@cedarjs/uploads'

detectContentType(bytes) // 'image/heic', 'video/mp4', … or null
```

It returns a MIME type, or `null` for anything it doesn't recognise. It never throws. Pass the whole file, or for a large file in object storage its first `DETECT_CONTENT_TYPE_BYTES` (4 KB) plus, when those start a ZIP, its last `DETECT_CONTENT_TYPE_TAIL_BYTES` (64 KB): `detectContentType(head, { tail })`.

| Detected type                                         | Format                                  |
| :---------------------------------------------------- | :-------------------------------------- |
| `image/jpeg`, `image/png`, `image/gif`, `image/webp`  | JPEG, PNG, GIF, WebP                    |
| `image/bmp`, `image/tiff`                             | BMP, TIFF                               |
| `image/heic`, `image/heif`, `image/avif`              | HEIC (iPhone photos), other HEIF, AVIF  |
| `image/heic-sequence`, `image/heif-sequence`          | HEIC/HEIF image sequences               |
| `application/pdf`                                     | PDF                                     |
| `video/mp4`, `audio/mp4`, `video/quicktime`           | MP4, M4A, QuickTime/MOV                 |
| `video/webm`, `video/matroska`                        | WebM, Matroska (MKV), reported as video |
| `application/vnd.oasis.opendocument.text` (and so on) | OpenDocument `.odt`, `.ods`, `.odp`     |
| `application/vnd.openxmlformats-officedocument.…`     | Office `.docx`, `.xlsx`, `.pptx`        |
| `application/vnd.ms-word.document.macroenabled.12` …  | Macro-enabled `.docm`, `.xlsm`, `.pptm` |

Office files are ZIP archives, told apart from other ZIPs by their entries, which are listed in the archive's central directory at the end of the file. That's why a `.docx` needs the tail; from its head alone it is `null`. When the directory is bigger than the tail (a deck with hundreds of slides), `findZipCentralDirectory(tail)` says where it starts: read from there up to the tail, join the two, and pass that as `tail`. Uploads do this for you. Directories over `MAX_ZIP_DIRECTORY_BYTES` (4 MB, tens of thousands of entries) and ZIP64 archives aren't read, and are `null`.

A file with macros is reported as the macro-enabled type, so a profile that allows `.docx` never admits a `.docm`. Templates and slide shows (`.dotx`, `.ppsx`, …) are reported as the document type. Old binary Office files (`.doc`, `.xls`) and other ZIPs aren't recognised. OpenDocument has no separate type for files with macros, so an `.odt` with Basic macros is reported as `.odt`.

SVG is deliberately not detected: it is XML, can carry script, and shouldn't pass as a safe image. Text formats (CSV, JSON, HTML) have no reliable signature.

### Spellings

Some types have more than one name in use. Uploads treat these as the same type wherever types are compared, so a profile listing either spelling accepts both, and files are stored under the first (canonical) one:

| Stored as         | Also accepted as                |
| :---------------- | :------------------------------ |
| `image/jpeg`      | `image/jpg`, `image/pjpeg`      |
| `image/png`       | `image/x-png`                   |
| `image/bmp`       | `image/x-ms-bmp`, `image/x-bmp` |
| `application/pdf` | `application/x-pdf`             |
| `video/matroska`  | `video/x-matroska`              |
| `audio/mp4`       | `audio/x-m4a`                   |
| `video/mp4`       | `video/x-m4v`                   |

The table is exported as `CONTENT_TYPE_ALIASES`, and `canonicalContentType()` resolves a type to its stored spelling.

### Accept rules

`acceptedContentType(bytes, accept, claimedType)` checks a file against an accept list and returns the type to store it under, or `null` when the file isn't accepted:

- When the bytes are recognised, the detected type must match the list, wildcards included, and is what's returned. The claimed type is ignored, so a HEIC photo a browser sent as `application/octet-stream` is accepted as `image/heic`.
- When they aren't, the claimed type is accepted if it matches the list, wildcards included, so `['text/*']` admits CSV and `['*/*']` admits anything. Two exceptions:
  - A claimed type the detector knows is refused. A real PNG would have been recognised, so bytes that weren't, claimed as `image/png`, are lying.
  - A type that can carry script must be listed exactly: SVG (`image/svg+xml`), HTML and XHTML, JavaScript, and XML types (`text/xml`, `application/xml`, and anything ending in `+xml`). `['image/*']` never admits an SVG. List `image/svg+xml` if you want SVGs, and sanitize them before serving them inline. The list is exported as `SCRIPTABLE_CONTENT_TYPES`.

Office types that can carry macros must be listed exactly too, whether detected from the bytes or claimed: the macro-enabled `.docm`, `.xlsm`, `.pptm` (and their template, add-in and slide-show variants), and the old binary `.doc`, `.xls` and `.ppt` (`application/msword`, `application/vnd.ms-excel`, `application/vnd.ms-powerpoint`). Macros run in Office on the machine of whoever downloads the file, so accepting them is a way to deliver malware to your other users, and a "documents" profile allowing `application/*` almost never means them. List the type if you do want it. The list is exported as `MACRO_CONTENT_TYPES`.

A file a profile accepts as one type is never accepted as another because its bytes say so: a `.docx` is a ZIP, but a profile that allows only `application/zip` refuses it, because its bytes say it is a Word document.

To accept photos from phones, list `image/heic` and `image/heif`, and `image/heic-sequence` too: some HEIC files have a sequence brand (bursts, animations), and their bytes say `image/heic-sequence` even when the browser sent `image/heic`.

`checkContentType(bytes, accept, claimedType)` applies the same rules and says why a file is refused: it returns `{ contentType }`, or `{ rejected: { detected, claimed } }` with the type the bytes are (`null` if they weren't recognised) and the type the client claimed. `POST /upload/fs` uses it to name both in its error, for example `File 'photo.heic' was sent as 'image/heic', but its content is 'image/heic-sequence', which is not in the allowedMimeTypes of upload profile 'photos'. Add 'image/heic-sequence' to accept it.`

### Where uploads check

- **`POST /upload/fs`** checks every file with `checkContentType()` against the profile and stores it under the type returned.
- **Direct uploads to S3** never pass through your api, so the bytes are checked when the upload is settled, by `confirmUpload` or the S3 webhook (see [Confirming S3 uploads](#confirming-s3-uploads)). The object's head (and, for a ZIP, its tail) is read with a ranged GET and must be the type the client declared when it asked for the upload URL. That type was checked against the profile then, with the same exceptions as above. The bytes are checked against the declared type, not the profile, because the `Upload` row doesn't record which profile it was made for. A mismatch fails the upload and deletes the object.
- **Database targets** go through the `uploadFile` service the setup command generates, which calls `acceptedContentType()` on the decoded bytes and stores the type it returns.

Turn it off with `verifyContentType: false` on the plugin (which covers `/upload/fs` and the S3 webhook), on `confirmUpload()` and on `createPresignedUpload()`. Uploads then trust the claimed type, as they did before.

## Reading files back

Store the `Upload` id on your model, then let a directive turn it into something a browser can load:

```graphql title="api/src/graphql/users.sdl.ts"
type User {
  id: String!
  name: String!
  avatarUrl: String @withSignedUrl
}
```

Resolve `avatarUrl` to the upload id (a plain `avatarUrl: (user) => user.avatarId` resolver, or name the field `avatarId` and alias it on the client) and `@withSignedUrl` returns a time-limited URL from whichever target holds the file. For S3 that's a native presigned GET; for filesystem targets it's a signed URL to the api's serve route; for database targets it's a `data:` URI. `@withDataUri` always returns a `data:` URI, reading from storage if it has to, and is meant for small files only.

Signed URLs default to `Content-Disposition: attachment`. The stored MIME type is whatever the client claimed, and an inline `image/svg+xml` served from your own origin is a stored cross-site-scripting vector, so inline rendering is opt-in. Pass `disposition: 'inline'` to `createWithSignedUrlDirective()` in the generated directive file when your profiles only admit types you trust to render.

Filesystem targets serve files through the api's serve route, which sends active content (HTML, SVG, XML, JavaScript and PDF) as an attachment even when the signed URL asks for inline. To preview PDFs in the browser, list them in the plugin's `inlineTypes` option:

```ts
await server.register(cedarUploadsPlugin, {
  // ...
  inlineTypes: ['application/pdf'],
})
```

Only list types you're comfortable rendering from your app's origin. S3 targets return presigned URLs to the bucket, so the disposition signed into the URL is always used there.

You can do the same thing in a service. Object-storage targets sign a URL; a database target has no URL, so read its bytes into a `data:` URI instead:

```ts
const target = resolveTarget(targets, upload.target)

if (target.providerType === 'db') {
  return upload.data ? toDataUri(upload.mimeType, upload.data) : null
}

if (!upload.storageKey) {
  return null
}

return target.getSignedReadUrl(upload.storageKey, { expiresIn: 600 })
```

Directive lookups are batched per request and never fetch the inline `data` column for object-storage rows, so a `@withSignedUrl` field on a list query costs one database query, not one per row.

## Server-generated files

Reports, exports, thumbnails: anything your api creates itself goes through `storeFile()`, which writes the bytes to a target and creates the `Upload` row in one call.

```ts title="api/src/jobs/MonthlyReportJob.ts"
import { storeFile } from '@cedarjs/uploads'

import { db } from 'src/lib/db'
import { targets } from 'src/lib/uploads'

export const MonthlyReportJob = async ({ month }: { month: string }) => {
  const pdf = await generateReportPdf(month)

  const upload = await storeFile(targets.reports, {
    db,
    filename: `report-${month}.pdf`,
    mimeType: 'application/pdf',
    data: pdf,
  })

  await db.report.create({ data: { month, fileId: upload.id } })
}
```

Pass `userId` when the file belongs to someone, so the ownership checks that guard user uploads apply to it too, and `organizationId` in multi-tenant apps.

Thumbnails and previews are better kept as [derived files](#derived-files-thumbnails-previews-and-other-variants), which Cedar makes once, keeps track of, and deletes with their source.

When you make a file from an upload, a thumbnail of a photo or a preview of a PDF, consider decoding the upload in a locked-down child process with [`@cedarjs/locked-child`](https://github.com/cedarjs/locked-child), so a crafted file that exploits a JavaScript decoder (pdf.js, say) can't reach your secrets. A native decoder (sharp's libvips) isn't limited by Node's file and network permissions: there the child process still keeps your environment variables out of reach, and full isolation needs an OS-level sandbox. See [Untrusted Files](security.md#untrusted-files).

## Deleting files

Deleting an `Upload` row does nothing to the bytes, by design. `deleteFile()` deletes the object first and then the row, so a crash in between leaves a visible row rather than an unreachable object, and a missing object is tolerated, so it's safe to retry.

```ts
import { deleteFile, resolveTarget } from '@cedarjs/uploads'

export const deleteReport = async ({ id }: { id: string }) => {
  const report = await db.report.findUniqueOrThrow({
    where: { id },
    include: { file: true },
  })

  if (report.file) {
    await deleteFile(resolveTarget(targets, report.file.target), {
      db,
      upload: report.file,
    })
  }

  return db.report.delete({ where: { id } })
}
```

## Derived files: thumbnails, previews and other variants

:::caution Experimental

Derived files are experimental. The API may change until a second app, or a different kind of file such as video, has used it.

:::

A photo's thumbnails, a PDF's drawn first page, a video's poster frame: files made from another file are **derived files**, and each kind (`thumb-164`, `preview`) is a **variant**. The file they're made from can be an upload, or a file that lives somewhere else entirely, such as a document your app fetches from a third-party API when it needs it. Your app writes the function that makes each variant; Cedar keeps the bookkeeping:

- a derived file is made the first time it's asked for, by one process at a time
- a generator that throws is tried again a few times over several hours; one that returns `null` is remembered as failed
- `resetVariants('preview')` clears every `preview` after you fix its generator, so each is made again when next asked for
- `deleteFor(source)` deletes a source file's derived files, and `deleteFile()` does it for you for uploads

Each made file is an ordinary `Upload` row, stored on a target like any other file. `@cedarjs/uploads` makes no images itself: a generator can use sharp, pdf.js, ffmpeg or a third-party service, and the package depends on none of them. A generator decodes bytes someone else made, so the advice on [decoding in a sandbox](#server-generated-files) applies to it too.

For image thumbnails and resizes, [`@cedarjs/uploads-sharp`](https://github.com/cedarjs/uploads-sharp) has a ready-made generator built on sharp: `sharpVariant({ width: 164 })` is a 164 × 164 WebP cropped from the middle, turned the right way up and written without metadata. Install it and sharp on your api side with `yarn workspace api add @cedarjs/uploads-sharp sharp`. Its README lists the options, and shows how to handle HEIC photos and how to run sharp in a sandbox.

### Schema

Add a `DerivedFile` model to keep track of derived files, then create a migration. The `Upload` model stays as it is.

```prisma title="api/db/schema.prisma"
model DerivedFile {
  id        String   @id @default(cuid())
  /// The source file, such as "upload:<id>" or "remote:<org>/<doc>"
  source    String
  /// Name of the variant, such as "thumb-164" or "preview"
  variant   String
  /// The made file's Upload row
  uploadId  String?
  status    String   @default("pending")
  claimId   String?
  attempts  Int      @default(0)
  updatedAt DateTime @updatedAt

  @@unique([source, variant])
}
```

The unique index is what lets only one process start making a given file. `source` is a plain string, not a relation, because the source doesn't have to be a row in your database. That means nothing in the database stops a source file from going away while its derived files stay behind: call `deleteFor()` when you delete a source file. For uploads, `deleteFile()` does that when you pass it `derivedFiles`.

Your own models keep referencing only the original file. They need no columns for thumbnails, no "thumbnail failed at" timestamp, and no relation per variant.

### Declaring derived files

```ts title="api/src/lib/derivedFiles.ts"
import { defineDerivedFiles, uploadSource } from '@cedarjs/uploads'
import type { DerivedFileGenerator } from '@cedarjs/uploads'
import sharp from 'sharp'

import { db } from 'src/lib/db'
import { targets } from 'src/lib/uploads'

const square =
  (size: number): DerivedFileGenerator =>
  async ({ readSource }) => ({
    data: await sharp((await readSource()).data)
      .resize(size, size)
      .webp()
      .toBuffer(),
    mimeType: 'image/webp',
  })

export const derivedFiles = defineDerivedFiles({
  db,
  targets,
  // Where made files are stored, unless a variant names its own target
  target: targets.thumbnails,
  sources: {
    upload: uploadSource({ db, targets }),
    // Files that live elsewhere: read() fetches one by your reference
    remote: {
      key: (ref: RemoteDocRef) => `${ref.org}/${ref.docId}`,
      read: async (ref: RemoteDocRef) => {
        const doc = await fetchRemoteDocument(ref)
        return (
          doc && {
            data: doc.bytes,
            filename: doc.name,
            organizationId: ref.org,
          }
        )
      },
    },
  },
  variants: {
    'thumb-164': square(164),
    'thumb-328': square(328),
    preview: { generate: drawFirstPage, target: targets.previews },
  },
})
```

A source has a `read()` that returns the file (`{ data, mimeType?, filename?, userId?, organizationId? }`), or `null` when it doesn't exist, and a `key()` that turns your reference into a stable string. References that are strings already don't need `key()`. `uploadSource()` reads an upload from whichever target holds it and gives the made files the upload's owner and organization; an id with no `Upload` row reads as `null`. Whether a viewer may see a derived file is for your code to check, as it is for any upload.

A generator receives `source` (its name, its key, and your reference), the variant's name, and `readSource()`, which reads the source file once however often you call it. It returns `{ data, mimeType, filename? }`, or `null` when this source can't have this variant (a file type it doesn't handle).

### Failures

- **A thrown error is temporary.** A network error or a service that is down is reported to `onError` (which logs by default), and the first request after the next of `retryDelays` has passed tries again. By default that is five retries, 1 minute, 5 minutes, 30 minutes, 2 hours and 6 hours after the attempt before, so an outage of a few hours at a third-party source heals by itself, and a file that still can't be made is remembered as failed about 8.5 hours after the first attempt. Pass `retryDelays: [...]` (in milliseconds, one retry per entry) to change it, or `[]` to never retry.
- **`null` from a generator is permanent**: this source can't have this variant. So is a made file that can't be stored (an invalid MIME type, or too big for a database target).
- **Failed stays failed** until you call `resetVariants()`.
- **A source file that doesn't exist is an error, not a failure.** When a source's `read()` returns `null`, such as for an upload id with no row, `acquireVariant()` and `acquireVariantData()` throw an `UploadError` with code `NOT_FOUND` that names the source key (`upload:<id>`), and nothing is recorded: no `DerivedFile` row is left, so a typo or a deleted file isn't remembered as failed, and a later acquire tries again. Catch it where a source may have been deleted. Only an attempt reads the source, so a file that was already made, or already failed, is reported as such until you delete it with `deleteFor()`.

### Acquiring derived files

```ts
const result = await derivedFiles.acquireVariant(
  { upload: photo.uploadId },
  'thumb-164'
)

if (result.status === 'completed') {
  // result.upload is the made file's Upload row
}

// The row and its bytes, or null when not ready or failed
const read = await derivedFiles.acquireVariantData({ remote: ref }, 'preview')

// Only if it has already been made; never makes anything
const made = await derivedFiles.findVariant({ upload: id }, 'thumb-164')
const byPhoto = await derivedFiles.findVariants(
  photos.map((photo) => ({ upload: photo.uploadId })),
  'thumb-164'
)
```

`acquireVariant()` returns `completed` with the made file's `Upload` row, `failed`, or `pending`, and throws `NOT_FOUND` for a source file that doesn't exist. Pending means it isn't ready: another process is making it right now, or an attempt failed and is waiting for its retry. It doesn't wait for another process; show a placeholder and ask again later. Within one process, concurrent calls for the same file share one attempt.

The made file is an ordinary `Upload` row, so the `@withSignedUrl` and `@withDataUri` directives work on its id. On a list page, use `findVariants()` so two queries cover every row and nothing is made while the page waits, and make missing files ahead of time from a job:

```ts title="api/src/jobs/ThumbnailJob/ThumbnailJob.ts"
export const ThumbnailJob = jobs.createJob({
  queue: 'default',
  perform: async ({ uploadId }: { uploadId: string }) => {
    await derivedFiles.acquireVariant({ upload: uploadId }, 'thumb-164')
    await derivedFiles.acquireVariant({ upload: uploadId }, 'thumb-328')
  },
})
```

An attempt holds a claim on its `DerivedFile` row while it runs. A claim older than `claimTimeout` (ten minutes) is treated as left behind by a process that died, and the next request starts a new attempt. Claims and retries use absolute timestamps, so time zones don't matter, but your servers' clocks should be roughly in sync (NTP).

### Remaking derived files

After fixing a generator, clear every file of that variant:

```ts title="scripts/redrawPreviews.ts"
import { derivedFiles } from 'api/src/lib/derivedFiles'

export default async () => {
  console.info(await derivedFiles.resetVariants('preview')) // { deleted, errors }
}
```

Made and failed files alike are deleted, and each is made again the next time it's acquired. To make them right away, acquire them from a script or a job.

### Deleting a source and its derived files

Pass `derivedFiles` to `deleteFile()` and it deletes the upload's derived files (bytes, `Upload` rows and bookkeeping) with it. It looks for them both before and after deleting the upload, so a derived file another request started making in between is deleted too:

```ts
await deleteFile(resolveTarget(targets, upload.target), {
  db,
  upload,
  derivedFiles,
})
```

For other sources, call `deleteFor()` once the source file is gone, for example when your app learns a third-party document was deleted. Calling it after, not before, means an attempt that read the file just before it went away is caught too:

```ts
await derivedFiles.deleteFor({ remote: ref })
```

Cedar doesn't sweep for derived files whose source went away without a `deleteFor()`: only your app knows how to ask a third party which files still exist. If you need a sweep, write it as a job that reads your `DerivedFile` rows for that source, checks them against the source, and calls `deleteFor()` for the gone ones.

## Cleaning up stale uploads

A presigned URL that is issued but never used, or an upload request that dies halfway, leaves a `pending` row behind. `cleanupStaleUploads()` claims rows that have been pending for longer than an hour, marks them `failed`, and deletes any bytes that did land. It keeps the failed rows as tombstones and re-checks recent ones on every run, so a deletion that errored, or bytes that arrived after the claim, are cleaned up on the next pass. Run it from a [recurring job](background-jobs.md):

```ts title="api/src/jobs/CleanupUploadsJob/CleanupUploadsJob.ts"
import { cleanupStaleUploads } from '@cedarjs/uploads'

import { db } from 'src/lib/db'
import { jobs } from 'src/lib/jobs'
import { targets } from 'src/lib/uploads'

export const CleanupUploadsJob = jobs.createJob({
  queue: 'default',
  perform: async () => {
    const { claimed, deleted } = await cleanupStaleUploads({ db, targets })
    jobs.logger.info({ claimed, deleted }, 'Swept stale uploads')
  },
})
```

## The upload plugin

`cedarUploadsPlugin` registers the upload routes on the Fastify server in `api/src/server.ts`:

```ts title="api/src/server.ts"
import { createServer } from '@cedarjs/api-server'
import { authDecoder } from '@cedarjs/auth-dbauth-api'
import { cedarUploadsPlugin, createUploadAuthenticator } from '@cedarjs/uploads'

import { getCurrentUser } from 'src/lib/auth'
import { db } from 'src/lib/db'
import { logger } from 'src/lib/logger'
import { targets } from 'src/lib/uploads'

async function main() {
  const server = await createServer({ logger })

  await server.register(cedarUploadsPlugin, {
    tokenSecret: process.env.UPLOAD_TOKEN_SECRET,
    targets,
    db,
    authenticate: createUploadAuthenticator({ authDecoder, getCurrentUser }),
  })

  await server.start()
}

main()
```

| Route                   | Method | Purpose                                                           |
| :---------------------- | :----- | :---------------------------------------------------------------- |
| `/upload/fs`            | POST   | Multipart uploads for filesystem (and other object) targets       |
| `/upload/serve?token=…` | GET    | Serves filesystem files behind signed URLs                        |
| `/upload/webhook/s3`    | POST   | S3 event notifications via SNS (only with the `s3Webhook` option) |
| `/upload/health`        | GET    | Lists the configured targets                                      |

`authenticate` resolves the requesting user from the request's auth header using the same decoder and `getCurrentUser` the GraphQL server uses. With it configured, the upload routes reject unauthenticated requests and tokens issued to someone else, so a leaked token can't be spent by anyone but its owner. The setup command wires it up when your app has auth. Without it, the token itself is the only identity on the route, which is only appropriate for apps with no auth at all. Other options: `prefix` (default `/upload`), `bodyLimit` (an outer ceiling, default 500 MB; the effective limit per request comes from the token), `serveCacheControl`, `inlineTypes` (see [Reading files back](#reading-files-back)), and `verifyContentType` (see [Checking what a file really is](#checking-what-a-file-really-is)).

The FS route rejects early: a `Content-Length` beyond what the token allows is refused before any body is read, and files are aborted mid-stream once they pass the profile's `maxFileSize`. Each file's row is created before its bytes are written, so a crash in between leaves a pending row the cleanup job can find rather than an orphaned file.

## Confirming S3 uploads

A presigned PUT goes straight to S3, so the api has to learn when it finished. Two paths:

**Client confirmation (default).** After the PUT succeeds, `useS3Upload` calls the `confirmUpload` mutation. The service checks that the object exists, that the caller is the user the upload was issued to, that the object's size matches the size the token authorized, and that its bytes are the type the client declared, then flips the row to `completed`. A presigned PUT cannot cap the body size or check what the bytes are, so these checks are what enforce `maxFileSize` and `allowedMimeTypes` on the S3 path: an object that fails them is deleted and its row marked `failed`, and it is never served.

The type check reads only the object's first 4 KB (and its last 64 KB when it is a ZIP, plus the start of its central directory when that is bigger), with ranged GETs. The row is stored under the canonical spelling of the declared type. The object keeps the `Content-Type` it was uploaded with, which the presigned URL pins to the declared type, so S3 never serves it as something its bytes aren't. A browser that can't name a file's type declares `application/octet-stream`; on this path that only passes for a profile that allows it and for bytes the detector doesn't recognise, since the declared type, not the profile, is what the bytes are checked against: the `Upload` row has no profile name to check against.

**S3 event notifications (recommended for production).** Configure the bucket to publish `s3:ObjectCreated:*` events to an SNS topic with an HTTPS subscription pointing at `/upload/webhook/s3`, and enable the route:

```ts
await server.register(cedarUploadsPlugin, {
  // ...
  s3Webhook: { topicArn: process.env.UPLOADS_SNS_TOPIC_ARN },
})
```

The handler verifies the SNS signature against Amazon's certificate, requires the message to come from exactly that topic, confirms the subscription automatically, and settles each notified object the same way `confirmUpload` does. Duplicate notifications and rows the cleanup job already claimed are left alone. With the webhook in place, pass `confirm: false` to `useS3Upload` to skip client confirmation.

The webhook is an AWS mechanism. S3-compatible services such as Railway buckets, Cloudflare R2, or MinIO don't publish events through SNS, so on those hosts leave `s3Webhook` unset and rely on client confirmation plus the cleanup job. The upload path itself is unaffected: point the `S3Client` at the service's endpoint and everything else works the same.

## Multi-tenant apps

Tokens carry the organization they were issued under, `Upload` rows record it, and confirmation and the `@requireUploadToken` directive reject a token or upload from another organization. `issueUploadToken` reads `organizationId` from `context.currentUser` by default; pass it explicitly from your `requestUploadToken` resolver when your app resolves the current organization some other way, and give `createRequireUploadTokenDirective` a `getOrganizationId` callback to match. With [tenancy](tenancy.md) treating `Upload` as tenant-owned, the directives' lookups are scoped automatically.

## Third-party services

Nothing hides the raw storage details. `upload.storageKey` is the S3 key, `upload.target` names the configuration, and `target.getConfig()` returns the bucket, region, and key prefix, which is everything transloadit, imgix, Cloudflare Images, or your own `sharp` pipeline needs:

```ts
const upload = await db.upload.findUniqueOrThrow({ where: { id } })
const { bucket } = resolveTarget(targets, upload.target).getConfig()

await transloadit.createAssembly({
  steps: {
    import: { robot: '/s3/import', bucket, path: upload.storageKey },
    resize: { robot: '/image/resize', width: 300, height: 300 },
  },
})
```

## Migrating from `@cedarjs/storage`

`@cedarjs/storage` is deprecated. Its Prisma extension stored file paths in your own model's columns and moved bytes as a side effect of `create`, `update`, and `delete`. `@cedarjs/uploads` replaces that with explicit calls and a dedicated table. To migrate:

1. Run `yarn cedar setup uploads` and configure a filesystem target pointing at your existing upload directory.
2. Replace `saveFiles.forModel(input)` calls in services with `storeFile(target, { db, filename, mimeType, data })` and store the returned `upload.id` in a new `Upload` relation on your model.
3. Remove `.$extends(storagePrismaExtension)` from `api/src/lib/db.ts`, and add explicit `deleteFile()` calls for the deletes and replacements that need them.
4. Replace `@withSignedUrl(strategy: ...)` with `@withSignedUrl` on a field that resolves to the upload id, and drop the `signedUrl` function; the plugin's serve route replaces it.
5. Backfill the `Upload` table from the location strings in your existing columns with a one-off script: for each row, create an `Upload` with `target`, `storageKey` (the filename on disk), `filename`, `mimeType`, and `size`, then point the new relation at it.

The legacy package keeps working in the meantime; its documentation is on the [legacy uploads page](uploads-legacy.md).
