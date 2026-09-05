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

`allowedMimeTypes` accepts exact types and `type/*` wildcards. `maxFiles` is enforced per token across every request that uses it, not just per batch. Profiles can also set `expiresIn` for their tokens; the default is five minutes. Per-user variation, like bigger limits for paying accounts, is plain code in the `requestUploadToken` resolver.

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

You can do the same thing in a service. Object-storage targets sign a URL; a database target has no URL, so read its bytes into a `data:` URI instead:

```ts
const target = resolveTarget(targets, upload.target)

const url =
  target.providerType === 'db'
    ? toDataUri(upload.mimeType, upload.data)
    : await target.getSignedReadUrl(upload.storageKey, { expiresIn: 600 })
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

`authenticate` resolves the requesting user from the request's auth header using the same decoder and `getCurrentUser` the GraphQL server uses. With it configured, the upload routes reject unauthenticated requests and tokens issued to someone else, so a leaked token can't be spent by anyone but its owner. The setup command wires it up when your app has auth. Without it, the token itself is the only identity on the route, which is only appropriate for apps with no auth at all. Other options: `prefix` (default `/upload`), `bodyLimit` (an outer ceiling, default 500 MB; the effective limit per request comes from the token), and `serveCacheControl`.

The FS route rejects early: a `Content-Length` beyond what the token allows is refused before any body is read, and files are aborted mid-stream once they pass the profile's `maxFileSize`. Each file's row is created before its bytes are written, so a crash in between leaves a pending row the cleanup job can find rather than an orphaned file.

## Confirming S3 uploads

A presigned PUT goes straight to S3, so the api has to learn when it finished. Two paths:

**Client confirmation (default).** After the PUT succeeds, `useS3Upload` calls the `confirmUpload` mutation. The service checks that the object exists, that the caller is the user the upload was issued to, and that the object's size matches the size the token authorized, then flips the row to `completed`. A presigned PUT cannot cap the body size, so this size check is what enforces `maxFileSize` on the S3 path: an oversized object is deleted and its row marked `failed`, and it is never served.

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
