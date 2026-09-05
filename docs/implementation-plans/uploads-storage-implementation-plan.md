# CedarJS Uploads & Storage — Implementation Plan

## Table of Contents

- [Design Principles](#design-principles)
- [Architecture Overview](#architecture-overview)
- [Storage Targets & Provider Interface](#storage-targets--provider-interface)
  - [The Provider Contract](#the-provider-contract)
  - [Built-in Providers](#built-in-providers)
  - [Defining Storage Targets](#defining-storage-targets)
  - [Future Providers (Azure, GCS)](#future-providers-azure-gcs)
- [Package Structure](#package-structure)
- [Data Model (Prisma)](#data-model-prisma)
- [API-Side Implementation](#api-side-implementation)
  - [Upload Tokens (JWT)](#upload-tokens-jwt)
  - [S3 Provider — Presigned Direct Uploads](#s3-provider--presigned-direct-uploads)
  - [Local FS Provider](#local-fs-provider)
  - [DB Provider](#db-provider)
  - [Server-Generated Files (`storeFile`)](#server-generated-files-storefile)
  - [Fastify Upload Plugin](#fastify-upload-plugin)
  - [GraphQL Integration](#graphql-integration)
- [Web-Side Implementation (Uppy)](#web-side-implementation-uppy)
  - [Uppy Configuration](#uppy-configuration)
  - [React Hooks](#react-hooks)
  - [React Components](#react-components)
- [CLI Setup Commands](#cli-setup-commands)
- [S3 Webhook Confirmation](#s3-webhook-confirmation)
- [Third-Party Integration (transloadit, imgix, etc.)](#third-party-integration-transloadit-imgix-etc)
- [tus Extensibility](#tus-extensibility)
- [Migration from Current Implementation](#migration-from-current-implementation)
- [Implementation Phases](#implementation-phases)
- [Open Questions](#open-questions)

---

## Design Principles

1. **GraphQL for authorization, Fastify for file bytes.** Upload tokens are
   issued via GraphQL (where all existing auth tooling lives). Actual file
   bytes flow through dedicated Fastify routes (where early rejection,
   streaming, and body limits are possible). This gives better abuse
   protection than GraphQL multipart — Fastify can reject a 1 GB attack file
   after reading the headers, before buffering a single byte, while GraphQL
   Yoga would buffer the entire request body before any directive runs.

2. **Provider contract, not abstraction layer.** Each storage provider (S3,
   filesystem, DB) implements a shared TypeScript interface using its
   native SDK directly. The S3 provider calls `PutObjectCommand`. The FS
   provider calls `fs.writeFile`. There's no base class in between and no
   third-party storage abstraction. The interface exists so that providers
   are interchangeable where the framework needs them (directives, file
   serving, `storeFile()`), not to hide provider-specific features.

3. **Named storage targets.** Developers configure named destinations
   ("avatars", "reports", "local") that map to provider instances. The
   `Upload` table records _which target_ a file lives on so the system can
   look up the right provider when reading, serving, or deleting.

4. **All uploads track metadata in the database.** Every file — whether
   user-uploaded or server-generated — gets a row in an `Upload` table with
   status, original filename, MIME type, size, and a provider-specific
   storage key. This gives a single source of truth.

5. **Manual lifecycle management.** Developers explicitly call storage
   operations in their services. No automatic Prisma extension magic. The
   [two-gate test for ambient magic](../design-principles.md#the-two-gate-test-for-ambientextension-magic):
   it must both prevent an omission that would fail silently and
   catastrophically, and stay pure and transactional with respect to the
   query. Storage hooks fail both gates:
   a forgotten storage call is a visible bug (the file is missing), and
   file I/O inside a query hook is non-transactional external work with
   its own failure modes. Explicit calls are more boilerplate but
   dramatically simpler to reason about, debug, and customize. (The
   tenancy extension in #2544 passes both gates — omission would be a
   silent cross-tenant leak, and where-clause injection is pure query
   rewriting — which is why these two designs land on opposite sides of
   the same principle.)

6. **Uppy on the frontend.** Uppy's pluggable architecture maps perfectly
   onto our providers: `@uppy/aws-s3` for presigned uploads,
   `@uppy/xhr-upload` for local FS, and a lightweight custom approach for
   DB. Users who want tus later just swap in `@uppy/tus`.

7. **tus-ready architecture.** By routing file uploads through Fastify (not
   GraphQL), adding tus support later is just registering another Fastify
   plugin. The upload token system works with tus too (tus supports custom
   headers).

8. **Third-party integration by design.** The `Upload` record exposes raw
   storage keys and target configuration so developers can pass them
   directly to services like transloadit, imgix, or Cloudflare Images
   without going through any Cedar abstraction.

---

## Architecture Overview

### Upload & Storage Flows

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          Client (Uppy)                                   │
├───────────────────┬───────────────────────┬──────────────────────────────┤
│   S3 Presigned    │     Local FS          │           DB                 │
│                   │                       │                              │
│  @uppy/aws-s3     │  @uppy/xhr-upload     │  GraphQL mutation            │
│  ─────────────    │  ─────────────────    │  (base64 String field)       │
│  1. getPresigned  │  1. POST /upload/fs   │  1. sendBytes mutation       │
│     URL (GQL)     │     w/ JWT header     │     w/ base64 data           │
│  2. PUT directly  │  2. Server saves      │  2. Service stores as        │
│     to S3         │     to disk           │     Prisma Bytes             │
│  3. S3 webhook or │  3. Returns upload    │  3. Returns upload           │
│     client confirm│     record            │     record                   │
└───────────────────┴───────────────────────┴──────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│                    Server-Generated Files                                │
│                                                                          │
│  Background jobs, services, or API handlers that produce files           │
│  (PDFs, exports, thumbnails, etc.) without any user upload.              │
│                                                                          │
│  storeFile(targets.reports, {                                            │
│    db, filename, mimeType, data: pdfBuffer                               │
│  })                                                                      │
│                                                                          │
│  Bypasses tokens, Fastify routes, and Uppy entirely.                     │
│  Writes directly to the target provider and creates an Upload record.    │
└──────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                   ┌──────────────────────┐
                   │  Upload table (DB)   │
                   │  ──────────────────  │
                   │  id, target,         │
                   │  status, filename,   │
                   │  mimeType, size,     │
                   │  storageKey, data,   │
                   │  createdAt, ...      │
                   └──────────────────────┘
```

### Security Flow

```
┌──────────┐   1. requestUploadToken      ┌──────────────┐
│  Client  │ ──── (GraphQL, protected ──  │  API Server  │
│          │      by @requireAuth)        │              │
│          │ ◄── JWT upload token ──────  │  Issues JWT  │
│          │                              │  w/ constraints│
│          │   2a. S3: getPresignedUrl    │              │
│          │ ──── (GraphQL, validated ──  │  Validates   │
│          │       by @requireUpload      │  JWT, returns│
│          │       Token)                 │  presigned   │
│          │ ◄── presigned PUT URL ─────  │  S3 URL      │
│          │                              │              │
│          │   2b. FS: POST /upload/fs    │              │
│          │ ──── (Fastify route, JWT ──  │  Validates   │
│          │       in x-upload-token      │  JWT, checks │
│          │       header)                │  bodyLimit,  │
│          │ ◄── upload record ─────────  │  saves file  │
└──────────┘                              └──────────────┘
```

---

## Storage Targets & Provider Interface

### The Provider Contract

A `StorageProvider` is a TypeScript interface that defines the minimum
operations Cedar needs. Each provider implements it using its native SDK.
This is NOT an abstraction layer — it's a contract that ensures providers
are interchangeable where the framework needs them.

```ts
// packages/uploads/core/src/providers/types.ts

export interface StorageProvider {
  /** Name of this provider instance, set by defineStorageTargets() */
  name: string

  /**
   * 'db' is the only value the framework branches on — it marks the
   * provider that stores file content inline in the Upload row. All
   * other values ('s3', 'fs', 'azure', …) are treated identically as
   * object storage. See "Provider Type Discrimination" under
   * Implementation Notes.
   */
  providerType: 'db' | string

  /** Write bytes to storage, return nothing (key is provided) */
  write(key: string, data: Buffer, opts: { contentType: string }): Promise<void>

  /** Read bytes from storage */
  read(key: string): Promise<Buffer>

  /** Delete a stored object */
  delete(key: string): Promise<void>

  /** Check if an object exists */
  exists(key: string): Promise<boolean>

  /**
   * Size in bytes of a stored object, or null when the provider cannot
   * know. Completion-time verification treats null as a failed check —
   * a provider that cannot report size cannot prove the object is
   * within the profile's limit.
   */
  getObjectSize(key: string): Promise<number | null>

  /**
   * Generate a time-limited URL for reading/downloading. Defaults to
   * attachment disposition wherever the provider controls response
   * headers (S3 response overrides, the FS serve route) — the stored
   * MIME type is client-asserted, so inline rendering is opt-in. See
   * "File Serving".
   */
  getSignedReadUrl(
    key: string,
    opts?: { expiresIn?: number; disposition?: 'attachment' | 'inline' }
  ): Promise<string>

  /**
   * Generate a presigned URL for direct client upload.
   * Returns the shape Uppy's @uppy/aws-s3 expects from getUploadParameters().
   * Not all providers support this — FS and DB throw.
   */
  getPresignedUploadUrl(
    key: string,
    opts: {
      contentType: string
      maxSize?: number
      expiresIn?: number
    }
  ): Promise<{ url: string; method: string; headers: Record<string, string> }>

  /**
   * Access to provider-specific configuration for third-party integration.
   * For S3: { bucket, region, keyPrefix }
   * For FS: { uploadDir }
   * For DB: {}
   */
  getConfig(): Record<string, unknown>
}
```

Developers who need to do something provider-specific (S3 lifecycle rules,
Azure access tiers, GCS ACLs) use their native SDK client directly. The
provider doesn't hide the client — it's right there in the user's
`api/src/lib/uploads.ts` configuration file.

### Built-in Providers

#### S3 Provider

Uses `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` directly.

```ts
// packages/uploads/core/src/providers/s3.ts

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export interface S3ProviderOptions {
  client: S3Client
  bucket: string
  keyPrefix?: string // default: ''
}

export function createS3Provider(opts: S3ProviderOptions): StorageProvider {
  const { client, bucket, keyPrefix = '' } = opts

  return {
    name: '', // set by defineStorageTargets

    async write(key, data, { contentType }) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: `${keyPrefix}${key}`,
          Body: data,
          ContentType: contentType,
        })
      )
    },

    async read(key) {
      const res = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: `${keyPrefix}${key}`,
        })
      )
      return Buffer.from(await res.Body!.transformToByteArray())
    },

    async delete(key) {
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: `${keyPrefix}${key}`,
        })
      )
    },

    async exists(key) {
      try {
        await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: `${keyPrefix}${key}` })
        )
        
        return true
      } catch {
        return false
      }
    },

    async getSignedReadUrl(key, opts = {}) {
      const { expiresIn = 3600, disposition = 'attachment' } = opts
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: `${keyPrefix}${key}`,
          // Safe serving default, mirroring the FS serve route — the
          // stored MIME type is client-asserted, so inline is opt-in
          ResponseContentDisposition: disposition,
        }),
        { expiresIn }
      )
    },

    async getPresignedUploadUrl(key, { contentType, expiresIn = 300 }) {
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: `${keyPrefix}${key}`,
          ContentType: contentType,
        }),
        { expiresIn }
      )
      return {
        url,
        method: 'PUT',
        headers: { 'Content-Type': contentType },
      }
    },

    getConfig() {
      return { bucket, region: opts.client.config.region, keyPrefix }
    },
  }
}
```

#### FS Provider

Uses `node:fs` and `node:crypto` directly.

```ts
// packages/uploads/core/src/providers/fs.ts

import fs from 'node:fs/promises'
import path from 'node:path'
import { createHmac } from 'node:crypto'

export interface FsProviderOptions {
  uploadDir: string
  serveBaseUrl?: string // e.g., 'http://localhost:8911/upload/serve'
  signSecret?: string // for generating signed serve URLs
}

export function createFsProvider(opts: FsProviderOptions): StorageProvider
```

The FS provider's `getSignedReadUrl` generates an HMAC-signed token URL
pointing to the Fastify file-serving route; the requested disposition is
encoded into the signed token, so inline serving is granted per-URL by
the code that signs the URL, never chosen by the requester. Its
`getPresignedUploadUrl` throws — FS uploads go through the Fastify
`POST /upload/fs` route, not direct-to-storage.

#### DB Provider

Uses Prisma `Bytes` field. Unlike S3 and FS, the DB provider doesn't
write to external storage — it signals that file data should be stored
inline in the `Upload.data` column.

```ts
// packages/uploads/core/src/providers/db.ts

export function createDbProvider(): StorageProvider
```

The DB provider's `write`/`read` are thin wrappers that operate on
Buffers in memory. The actual Prisma persistence is handled by `storeFile()`
and the service layer, not the provider itself. `getPresignedUploadUrl`
throws. `getSignedReadUrl` returns a `data:` URI.

### Defining Storage Targets

`defineStorageTargets()` is a thin helper that assigns each provider's
`.name` property from the object key. It returns the same object, typed,
so that `targets.avatars` works for direct access and
`targets[upload.target]` works for dynamic lookup from DB records.

```ts
// packages/uploads/core/src/targets.ts

export function defineStorageTargets<T extends Record<string, StorageProvider>>(
  targets: T
): T {
  for (const [name, provider] of Object.entries(targets)) {
    provider.name = name
  }
  return targets
}

/**
 * Safely look up a target by name with a clear error message.
 * Use this when resolving the target from a DB record's `target` field.
 */
export function resolveTarget(
  targets: Record<string, StorageProvider>,
  name: string
): StorageProvider {
  const target = targets[name]
  if (!target) {
    throw new Error(
      `Unknown storage target "${name}". ` +
        `Available: ${Object.keys(targets).join(', ')}`
    )
  }
  return target
}
```

#### User's configuration file

```ts
// api/src/lib/uploads.ts (generated by CLI)

import path from 'node:path'

import { S3Client } from '@aws-sdk/client-s3'
import {
  defineStorageTargets,
  createS3Provider,
  createFsProvider,
  createDbProvider,
} from '@cedarjs/uploads'

// The user's own S3 client — used directly alongside the provider
// for any S3-specific operations (lifecycle rules, CORS, etc.)
export const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

export const targets = defineStorageTargets({
  // Production: user avatars in a dedicated S3 bucket
  avatars: createS3Provider({
    client: s3Client,
    bucket: process.env.S3_BUCKET_AVATARS!,
    keyPrefix: 'avatars/',
  }),

  // Production: server-generated reports in a separate bucket
  reports: createS3Provider({
    client: s3Client,
    bucket: process.env.S3_BUCKET_REPORTS!,
    keyPrefix: 'reports/',
  }),

  // Development / simple deploys: local filesystem
  local: createFsProvider({
    uploadDir: path.join(__dirname, '..', '..', '.uploads'),
    serveBaseUrl: process.env.UPLOAD_SERVE_BASE_URL || 'http://localhost:8911',
    signSecret: process.env.UPLOAD_TOKEN_SECRET!,
  }),

  // Small inline blobs (favicons, thumbnails)
  thumbnails: createDbProvider(),
})
```

### Future Providers (Azure, GCS)

Adding a new provider means implementing the `StorageProvider` interface
with the provider's native SDK. No changes to the Upload model, directives,
hooks, or Fastify plugin.

```ts
// Future: packages/uploads/core/src/providers/azure.ts
import { BlobServiceClient } from '@azure/storage-blob'

export interface AzureProviderOptions {
  client: BlobServiceClient
  container: string
  pathPrefix?: string
}

export function createAzureProvider(opts: AzureProviderOptions): StorageProvider
```

```ts
// Future: packages/uploads/core/src/providers/gcs.ts
import { Storage } from '@google-cloud/storage'

export interface GcsProviderOptions {
  storage: Storage
  bucket: string
  pathPrefix?: string
}

export function createGcsProvider(opts: GcsProviderOptions): StorageProvider
```

The user's targets config simply adds:

```ts
export const targets = defineStorageTargets({
  avatars: createS3Provider({ ... }),
  archives: createAzureProvider({ client: azureClient, container: 'archives' }),
  backups: createGcsProvider({ storage: gcsStorage, bucket: 'backups' }),
  local: createFsProvider({ ... }),
})
```

No changes to any other code. The `@withSignedUrl` directive, `storeFile()`,
and all hooks work identically because they go through the `StorageProvider`
interface.

---

## Package Structure

### `packages/uploads/core` — `@cedarjs/uploads`

The main API-side package. Contains:

- Provider interface and built-in providers (S3, FS, DB)
- `defineStorageTargets()` and `resolveTarget()`
- `storeFile()` utility for server-generated files
- Upload token creation and validation (JWT)
- Fastify plugin (routes for upload, presigned URLs, file serving, webhooks)
- GraphQL directive definitions (`@requireUploadToken`, `@withSignedUrl`,
  `@withDataUri`)
- Shared types and constants

**Dependencies:**

- `jsonwebtoken`
- `@fastify/multipart`
- `mime-types`

**Peer dependencies** (install only what you use):

- `@aws-sdk/client-s3` (only for S3 provider)
- `@aws-sdk/s3-request-presigner` (only for S3 provider)

### `packages/uploads/web` — `@cedarjs/uploads-web`

The web-side package. Contains:

- Pre-configured Uppy instance factory
- React hooks (`useUploadToken`, `useS3Upload`, `useFsUpload`,
  `useDbUpload`)
- React components (thin wrappers around Uppy's React components)
- Integration with Cedar's GraphQL client (Apollo)

**Dependencies:**

- `@uppy/core`
- `@uppy/react`

**Peer dependencies** (install only what you use):

- `@uppy/aws-s3` (only for S3 uploads)
- `@uppy/xhr-upload` (only for FS uploads)
- `@uppy/dashboard` (optional UI component)
- `@uppy/drag-drop` (optional UI component)
- `@uppy/progress-bar` (optional UI component)

### Why Two Packages (Not More)

The RedwoodJS PR splits into 6+ packages. That's too granular — it creates
versioning headaches and cognitive overhead. Two packages (API + web) is the
natural split along the Cedar architecture boundary. S3 SDK and Uppy
plugins are peer dependencies, so users who don't need them don't install
them.

---

## Data Model (Prisma)

The CLI setup command will add this model to the user's `schema.prisma`:

```prisma
model Upload {
  id         String   @id @default(cuid())

  /// Name of the storage target (maps to targets config)
  /// e.g., "avatars", "reports", "local", "thumbnails"
  target     String

  /// "pending" | "completed" | "failed"
  status     String   @default("pending")

  /// Original filename from the client (or server)
  filename   String

  /// MIME type (e.g., "image/png")
  mimeType   String

  /// File size in bytes. BigInt because Prisma's Int is signed 32-bit,
  /// which caps at 2 GB — too small for the multipart and tus futures
  /// this plan anticipates. Exposed through GraphQL as the BigInt scalar.
  size       BigInt

  /// Provider-specific storage reference.
  /// S3: the object key (e.g., "avatars/clx123.png")
  /// FS: the filename on disk (e.g., "clx123.png")
  /// DB: null (data is inline)
  /// Azure (future): blob name
  /// GCS (future): object name
  storageKey String?

  /// Inline binary data — only for the DB provider
  data       Bytes?

  /// The user this file belongs to. Nullable so apps without auth are
  /// unaffected. Stamped from the upload token's `sub` claim for user
  /// uploads; set explicitly for server-generated files when relevant.
  /// See "Upload Ownership (`userId`)" under Implementation Notes.
  userId     String?

  /// Id (`jti`) of the upload token that created this row. Null for
  /// server-generated files. Counting a token's rows is how the server
  /// enforces the profile's `maxFiles` across requests.
  tokenId    String?

  /// The organization this file belongs to, for apps using multi-tenancy
  /// (#2544). When the tenancy extension counts Upload as tenant-owned,
  /// every lookup in the serving directives is scoped automatically —
  /// which closes the hole where a cross-tenant Upload id stored in a
  /// field would otherwise yield a signed URL. Nullable so single-tenant
  /// apps are unaffected.
  organizationId String?

  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}
```

### Why a Unified Table

- Single source of truth for all files, regardless of provider or origin
  (user upload vs. server generated)
- Easy to query "all uploads for target X" or "all pending uploads older
  than 1 hour"
- Clean foreign key references from application models:

  ```prisma
  model User {
    id       String  @id
    name     String
    avatarId String?
    avatar   Upload? @relation(fields: [avatarId], references: [id])
  }

  model Report {
    id     String  @id
    month  String
    year   Int
    fileId String?
    file   Upload? @relation(fields: [fileId], references: [id])
  }
  ```

- Simplifies cleanup jobs (find all `pending` uploads older than 1 hour →
  delete from storage and DB)
- The `target` field makes it trivial to look up the right provider for
  any operation

### Why `target` Instead of `strategy`

The original plan used a `strategy` field ("s3", "fs", "db") plus
separate columns for each provider's reference (`s3Key`, `s3Bucket`,
`fsPath`). With storage targets, a single `target` field encodes both the
_provider type_ AND the _destination_ (which bucket, which directory). And
a single `storageKey` column holds whatever the provider uses as its
reference, because the provider knows how to interpret it.

This means adding Azure or GCS later requires zero schema changes. A new
provider's storage key is just another string in the `storageKey` column.

### Status Transitions

```
  ┌─────────┐    upload succeeds     ┌───────────┐
  │ pending │ ──────────────────────▶ │ completed │
  └─────────┘                        └───────────┘
       │
       │ upload fails / expires
       ▼
  ┌─────────┐
  │  failed │
  └─────────┘
```

For S3 presigned uploads, the record starts as `pending` and transitions to
`completed` when the S3 event notification webhook fires (or when the client
confirms and the server verifies). FS uploads also pass through `pending`:
the row is created before the bytes are written and flipped to `completed`
in the same request (see "Local FS Provider"). DB and server-generated
files go directly to `completed` (the server has the bytes and saves
synchronously). Every `pending` → `completed`/`failed` transition is a
conditional update (`updateMany` filtered on the current status), so the
webhook, `confirmUpload`, and the stale-upload cleanup job cannot race
each other into inconsistent states.

---

## API-Side Implementation

### Upload Tokens (JWT)

Upload tokens are short-lived JWTs that encode upload constraints. They're
issued via a GraphQL query protected by `@requireAuth` (or whatever auth
the developer uses), ensuring all existing Cedar auth tooling is leveraged.

#### Token Payload

```ts
// packages/uploads/core/src/uploadToken.ts

interface UploadTokenPayload {
  /** The upload profile this token was issued for */
  profile: string

  /** Allowed MIME types (e.g., ["image/png", "image/jpeg"]) */
  allowedMimeTypes: string[]

  /** Maximum file size in bytes */
  maxFileSize: number

  /** Maximum number of files in a single upload batch */
  maxFiles: number

  /** Target name — which storage target this token authorizes */
  target: string

  /**
   * Subject — the id of the user the token was issued to (from
   * context.currentUser). Stamped onto the Upload record as userId and
   * checked by confirmUpload, so a leaked token is bound to one account
   * for its short lifetime instead of being bearer-anyone.
   */
  sub: string

  /**
   * Unique token id. Stamped onto Upload records as tokenId; counting a
   * token's records is how the server enforces maxFiles across requests.
   */
  jti: string

  /**
   * The organization the token was issued under, for apps using
   * multi-tenancy (#2544). Stamped onto Upload records and checked at
   * confirmation, mirroring sub. Absent in single-tenant apps.
   */
  organizationId?: string
}
```

#### Upload Profiles

Constraints are server-defined, never client-supplied. The client names a
**profile**; the server owns what that profile allows. Without this, the
token query would merely notarize whatever constraints the client asked
for — any authenticated user could request a token for any target at any
size, and `@requireAuth` gates _who_, not _what_.

Profiles live next to the targets in `api/src/lib/uploads.ts`:

```ts
import { defineUploadProfiles } from '@cedarjs/uploads'

export const profiles = defineUploadProfiles({
  avatar: {
    target: 'avatars',
    allowedMimeTypes: ['image/png', 'image/jpeg'],
    maxFileSize: 5 * 1024 * 1024,
    maxFiles: 1,
  },
  attachment: {
    target: 'local',
    allowedMimeTypes: ['application/pdf', 'image/png', 'image/jpeg'],
    maxFileSize: 25 * 1024 * 1024,
    maxFiles: 10,
  },
})
```

The generated `requestUploadToken(profile: String!)` resolver looks the
profile up, refuses unknown names, and signs the profile's constraints
into the token together with the current user's id (`sub`), a fresh
token id (`jti`), and — in multi-tenant apps (#2544) — the current
organization id. Per-user or per-role variation (pro accounts get bigger
limits) is plain code in that resolver.

#### Token Issuance

```ts
import jwt from 'jsonwebtoken'

interface CreateUploadTokenOptions {
  secret: string
  expiresIn?: string | number // default: '5m'
  payload: UploadTokenPayload
}

function createUploadToken(options: CreateUploadTokenOptions): string

function verifyUploadToken(token: string, secret: string): UploadTokenPayload
```

The secret is stored in an environment variable (`UPLOAD_TOKEN_SECRET`). The
CLI setup command generates a random secret and adds it to `.env`.

Token responses are sent with `Cache-Control: no-store`. The token varies
per user and expires in minutes; the web side's `fetchPolicy: 'no-cache'`
only bypasses Apollo's client cache, so this response header is what keeps
HTTP intermediaries from ever storing or replaying a token.

#### Token Header

The client sends the token in the `x-upload-token` HTTP header. This header
is used by both Fastify routes (FS uploads) and GraphQL operations
(presigned URL requests).

### S3 Provider — Presigned Direct Uploads

Files go directly from the client to S3, never touching the Cedar API
server.

#### Flow

1. **Client requests upload token** via GraphQL (`requestUploadToken` query,
   protected by `@requireAuth`). Receives a JWT encoding the target name
   and constraints.

2. **Client requests presigned URL** via GraphQL (`createPresignedUploadUrl`
   mutation, protected by `@requireUploadToken`). The server:
   - Validates the JWT from the `x-upload-token` header
   - Validates the requested `contentType` against the token's
     `allowedMimeTypes` — a disallowed type is refused before anything
     is signed, and the presigned PUT pins the `Content-Type` header it
     was signed with, so S3 rejects an upload that swaps it
   - Looks up the target from the validated token payload
   - Generates a storage key (e.g., `avatars/clx123abc.png`)
   - Calls `target.getPresignedUploadUrl(key, { contentType, ... })`
   - Creates an `Upload` record with status `pending`, `userId` from the
     token's `sub`, `organizationId` and `tokenId` from the token's
     claims, and `size` set to the declared size after validating it
     against the token's `maxFileSize` — completion-time verification
     compares the real object against this value. The count of the
     token's existing records and the insert are one atomic
     count-and-create (a serialized transaction keyed on `tokenId`), so
     concurrent requests sharing one token cannot exceed `maxFiles`
   - Returns `{ uploadId, url, method, headers }` — this shape is exactly
     what Uppy's `@uppy/aws-s3` plugin expects from `getUploadParameters()`

3. **Client uploads directly to S3** using the presigned URL (Uppy handles
   this automatically).

4. **S3 sends event notification** to a Fastify webhook endpoint
   (`POST /upload/webhook/s3`). The handler finds the matching `Upload`
   record and updates status to `completed`. (See [S3 Webhook
   Confirmation](#s3-webhook-confirmation) for details.)

   Alternatively, for development or simpler setups, the **client confirms**
   via a `confirmUpload` mutation and the server verifies the object exists
   before marking it completed.

#### Size Enforcement

A presigned PUT pins only the headers that were signed — it cannot cap the
body size, so `maxFileSize` is not enforceable at upload time on this
path. Two complementary mechanisms cover it:

- **Post-hoc verification (built in).** The pending `Upload` row records
  the declared, token-validated `size`. Both completion paths — the S3
  webhook and `confirmUpload` — compare the actual object size against
  it; a mismatch deletes the object and marks the row `failed`. An
  oversized object lives in the bucket only until confirmation and is
  never marked `completed` or served.
- **Presigned POST policies (documented alternative).** S3's POST policy
  supports `content-length-range`, which rejects oversized bodies during
  the upload itself. Uppy's `@uppy/aws-s3` supports POST policies; the
  how-to shows the swap for apps that want hard enforcement at the edge.

#### Presigned URL Generation

The presigned URL generation is handled by the S3 provider's
`getPresignedUploadUrl()` method (see [S3 Provider](#s3-provider) above),
which uses `@aws-sdk/s3-request-presigner` directly.

#### Reading Files Back (Signed Download URLs)

The S3 provider's `getSignedReadUrl()` generates native S3 presigned GET
URLs using `@aws-sdk/s3-request-presigner`, signing
`ResponseContentDisposition: attachment` by default so S3 serves the
object with the same safe defaults as the FS serve route (see "File
Serving" for why inline is opt-in). These are used by the
`@withSignedUrl` directive and can be called directly in services:

```ts
const url = await targets.avatars.getSignedReadUrl(upload.storageKey!, {
  expiresIn: 3600,
})
```

### Local FS Provider

Files are uploaded through the Cedar API server and saved to the local
filesystem. Protected by JWT upload tokens.

#### Flow

1. **Client requests upload token** via GraphQL (same as S3, but the token's
   `target` field points to an FS target).

2. **Client uploads file** via `POST /upload/fs` (Fastify route). The
   request includes:
   - `x-upload-token` header with the JWT
   - `multipart/form-data` body with the file(s)

3. **Fastify route handler:**
   - Validates the JWT token (checks expiry, resolves target)
   - When the plugin's `authenticate` option is configured, resolves the
     requesting user and rejects a token whose `sub` is a different user
     — one user cannot spend another user's token
   - Checks `Content-Length` against the batch bound — the token's
     `maxFiles × maxFileSize` plus an allowance for the multipart
     envelope — and rejects before buffering when the header is present
     and too large. The header can be absent (chunked encoding) or
     dishonest, and it measures the whole request rather than any one
     file, so `@fastify/multipart` is also configured with the per-file
     `fileSize` limit and the `files` count limit from the token, which
     abort the stream mid-flight
   - Processes the multipart stream via `@fastify/multipart`
   - Validates MIME type against `allowedMimeTypes` from token
   - Generates a storage key: `<cuid>.<ext>`
   - Creates the `Upload` record with status `pending`, `userId` from
     the token's `sub`, and `organizationId`/`tokenId` from the token's
     claims — using the same atomic count-and-create against `tokenId`
     as the presign path, so `maxFiles` holds token-wide across
     requests and under concurrency, not just per multipart batch.
     Row-first ordering means a crash between record and write
     leaves a pending row the cleanup job can find — bytes-first would
     leave an object on disk that nothing references
   - Calls `target.write(key, data, { contentType })` to save to disk
   - Flips the record `pending` → `completed` (conditional update) and
     returns it as JSON

#### File Serving

For local FS files, a Fastify route at `GET /upload/serve/:token` handles
serving:

1. Decodes an HMAC-signed token containing the upload ID and expiry
2. Looks up the `Upload` record
3. Resolves the target provider
4. Streams the file from disk with appropriate `Content-Type`,
   `Cache-Control`, and `ETag` headers — plus
   `X-Content-Type-Options: nosniff` and, by default,
   `Content-Disposition: attachment`. Inline rendering is opt-in, because
   the stored MIME type is client-asserted: an "image" allowlist that
   admits `image/svg+xml` is admitting a scriptable document, and inline
   SVG served from the app's origin is stored XSS. Apps that want inline
   images should restrict inline serving to raster types or verify magic
   bytes at upload time

The HMAC signing reuses the same `UPLOAD_TOKEN_SECRET`. The FS provider's
`getSignedReadUrl()` generates these token URLs.

### DB Provider

Small files stored as binary data directly in the Prisma database. No
Fastify routes needed — data flows through GraphQL as base64-encoded strings.

#### Flow

1. **Client sends base64 data** in a GraphQL mutation input field:

   ```graphql
   input CreateAvatarInput {
     filename: String!
     mimeType: String!
     data: String! # base64-encoded
   }
   ```

2. **Service handler** calls `storeFile()` with the DB target:

   ```ts
   import { storeFile } from '@cedarjs/uploads'
   import { targets } from 'src/lib/uploads'

   export const createAvatar = async ({ input }) => {
     const upload = await storeFile(targets.thumbnails, {
       db,
       filename: input.filename,
       mimeType: input.mimeType,
       data: Buffer.from(input.data, 'base64'),
       // The avatar belongs to the requesting user — persisting the
       // owner keeps the signed-URL ownership checks effective for
       // files stored through storeFile() too
       userId: context.currentUser.id,
     })

     return db.user.update({
       where: { id: context.currentUser.id },
       data: { avatarId: upload.id },
     })
   }
   ```

#### Size Cap

This path is the deliberate exception to design principle 1: the base64
payload rides through GraphQL, which buffers the whole request before any
directive runs. That trade is acceptable only because these files are
small — so "small" gets a number. DB-target profiles default to a
`maxFileSize` of 1 MB, enforced in `useDbUpload` on the client and again
in `storeFile()` for `providerType: 'db'` targets on the server, which
rejects the decoded buffer before anything is persisted. The GraphQL
endpoint's request body limit is the outer guard on how much a single
request can buffer at all — configure it with the cap in mind (1 MB of
file data is ~1.4 MB of base64). Files that can exceed the cap belong on
an FS or S3 target.

#### Serving DB Files

DB uploads are served as data URIs (for inline display) via the
`@withDataUri` GraphQL directive, or the provider's `getSignedReadUrl()`
which also returns a `data:` URI. Browsers render `data:` URIs in an
opaque origin and refuse top-level `data:` navigation, so this path does
not carry the same-origin stored-XSS risk that makes the FS serve route
default to attachment disposition:

```ts
function toDataUri(mimeType: string, data: Buffer): string {
  return `data:${mimeType};base64,${data.toString('base64')}`
}
```

### Server-Generated Files (`storeFile`)

The `storeFile()` utility is the first-class path for storing files that
are NOT user uploads — PDFs, exports, thumbnails, reports, processed images,
etc. It bypasses all upload machinery (tokens, Fastify routes, Uppy) and
writes directly to the target provider.

```ts
// packages/uploads/core/src/storeFile.ts

import { createId } from '@paralleldrive/cuid2'
import mime from 'mime-types'

interface StoreFileOptions {
  db: PrismaClient
  filename: string
  mimeType: string
  data: Buffer
  /**
   * Reject `data` larger than this many bytes. Defaults to the 1 MB DB
   * size cap for `providerType: 'db'` targets (see "Size Cap") and to
   * unlimited for object-storage targets.
   */
  maxSize?: number
  /**
   * Owner of the file, when it belongs to a user. Persisted onto the
   * Upload row so the ownership checks that guard user uploads apply
   * to server-stored files too.
   */
  userId?: string
  /** Owning organization, for multi-tenant apps (#2544). */
  organizationId?: string
}

/**
 * Store a file directly to a storage target and create an Upload record.
 * Use this for server-generated files (PDFs, exports, etc.) that don't
 * go through the user upload flow.
 */
export async function storeFile(
  target: StorageProvider,
  options: StoreFileOptions
): Promise<Upload> {
  const { db, filename, mimeType, data, maxSize, userId, organizationId } =
    options
  const ext = mime.extension(mimeType)
  const key = ext ? `${createId()}.${ext}` : createId()

  // For the DB provider, data goes in the Upload.data column
  // For S3/FS/etc., data goes to external storage via the provider
  const isDbProvider = target.providerType === 'db'

  const cap = maxSize ?? (isDbProvider ? DB_MAX_FILE_SIZE : undefined)
  if (cap !== undefined && data.length > cap) {
    throw new Error(`File exceeds the ${cap} byte limit`)
  }

  if (!isDbProvider) {
    await target.write(key, data, { contentType: mimeType })
  }

  return db.upload.create({
    data: {
      target: target.name,
      status: 'completed',
      filename,
      mimeType,
      size: BigInt(data.length),
      storageKey: isDbProvider ? null : key,
      data: isDbProvider ? data : null,
      userId: userId ?? null,
      organizationId: organizationId ?? null,
    },
  })
}
```

#### Complete Example: Monthly Report Job

```ts
// api/src/jobs/MonthlyReportJob.ts

import { storeFile } from '@cedarjs/uploads'
import { db } from 'src/lib/db'
import { targets } from 'src/lib/uploads'
import { generateReportPdf } from 'src/lib/reports'

export const MonthlyReportJob = async () => {
  const pdfBuffer = await generateReportPdf({
    month: 'January',
    year: 2025,
  })

  const upload = await storeFile(targets.reports, {
    db,
    filename: 'report-2025-01.pdf',
    mimeType: 'application/pdf',
    data: pdfBuffer,
  })

  await db.report.create({
    data: {
      month: 'January',
      year: 2025,
      fileId: upload.id,
    },
  })
}
```

#### Why `storeFile()` Matters

Without this utility, storing a server-generated file would require
understanding provider internals, generating keys, creating Upload records,
and wiring it all together. `storeFile()` reduces it to a single call:
target + metadata + bytes → Upload record. This makes the "storage without
uploads" workflow just as easy as the user-upload workflow.

### Deleting Files (`deleteFile`) and Stale-Upload Cleanup

Manual lifecycle cuts both ways: deleting an `Upload` row does nothing to
the bytes, by design. The two pieces of boilerplate every app then needs
ship in the package rather than being reimplemented per app:

```ts
/**
 * Delete a stored file: bytes first, then the Upload record. Bytes-first
 * ordering means a crash between the two steps leaves a row whose object
 * is gone — visible to the app and fixed by retrying the call — where
 * the reverse order leaves an unreachable orphan object that nothing
 * references. A missing object is tolerated, so the call is idempotent
 * and safe to retry.
 */
export async function deleteFile(
  target: StorageProvider,
  options: { db: PrismaClient; upload: Upload }
): Promise<void>

/**
 * Sweep stale uploads. Claims `pending` Upload rows older than
 * `olderThan` (default: 1 hour) with a conditional `pending` → `failed`
 * update, then deletes any bytes that did land in storage. Covers
 * presigned uploads that were issued but never completed, and FS
 * uploads that crashed between row creation and write. The sweep is
 * race-safe: because the completion paths flip `pending` → `completed`
 * with the same conditional pattern, a row that completes mid-sweep is
 * skipped (its claim matches zero rows) and a claimed row can no
 * longer complete.
 *
 * Claimed rows are kept as `failed` tombstones rather than deleted, and
 * each sweep re-attempts byte deletion for `failed` rows younger than
 * `retryWindow` (default: 24 hours) whose object still exists in
 * storage. That makes byte deletion retryable — a `target.delete()`
 * that errors is retried on the next run — and it catches the
 * pathological in-flight upload whose bytes land after the row was
 * claimed. The windows are chosen against the upload timeline: a
 * presigned PUT must start within the URL's 5-minute validity, so
 * `olderThan` (1 hour) claims rows whose upload window is long closed,
 * and an upload would have to stay in flight for a full `retryWindow`
 * after issuance to land bytes after the final deletion attempt —
 * beyond any realistic client or S3 connection lifetime. Operators
 * with unusual transfer profiles raise `retryWindow` to match. Run it
 * from a recurring `@cedarjs/jobs` job; the setup command's next-steps
 * output shows the job.
 */
export async function cleanupStaleUploads(options: {
  db: PrismaClient
  targets: Record<string, StorageProvider>
  olderThan?: number
  /** How long `failed` tombstones stay in the re-check set — default: 24 hours */
  retryWindow?: number
}): Promise<{ deleted: number }>
```

### Fastify Upload Plugin

A Fastify plugin that registers all upload-related routes. Users register
it in their `api/src/server.ts`.

```ts
// packages/uploads/core/src/fastifyPlugin.ts

import type { FastifyInstance } from 'fastify'

interface UploadPluginOptions {
  /** JWT secret for upload tokens */
  tokenSecret: string

  /** The full targets map — used for resolving targets from tokens */
  targets: Record<string, StorageProvider>

  /** Database client for creating Upload records */
  db: PrismaClient

  /** Route prefix — default: '/upload' */
  prefix?: string

  /**
   * Hard outer ceiling on FS upload request size — default: 500 MB.
   * The effective per-request bound comes from the token (`maxFiles` ×
   * `maxFileSize` plus a multipart-envelope allowance), so this only
   * needs to sit above the largest FS profile's aggregate — a
   * profile-valid batch is never rejected by the outer ceiling.
   */
  bodyLimit?: number

  /**
   * Resolve the authenticated user for a request (e.g. from the app's
   * auth header). Upload routes reject tokens whose `sub` — or, in
   * multi-tenant apps, `organizationId` — belongs to someone else, so
   * one user cannot spend another user's token. The setup command
   * builds this callback with `createUploadAuthenticator({ authDecoder,
   * getCurrentUser })`, which decodes the request's auth header with
   * the app's auth decoder and passes the decoded auth data to the
   * app's `getCurrentUser` — the same pipeline the GraphQL server
   * uses. Without it, the token itself is the only identity on the
   * route.
   */
  authenticate?: (
    req: FastifyRequest
  ) => Promise<{ id: string; organizationId?: string } | null>
}

async function cedarUploadsPlugin(
  fastify: FastifyInstance,
  options: UploadPluginOptions
): Promise<void>
```

#### Registered Routes

| Route                   | Method | Purpose                             |
| ----------------------- | ------ | ----------------------------------- |
| `{prefix}/fs`           | POST   | Accept file uploads for FS targets  |
| `{prefix}/serve/:token` | GET    | Serve local FS files via signed URL |
| `{prefix}/webhook/s3`   | POST   | Receive S3 event notifications      |
| `{prefix}/health`       | GET    | Health check for the upload system  |

#### User's `api/src/server.ts`

```ts
import { createServer } from '@cedarjs/api-server'
import { authDecoder } from '@cedarjs/auth-dbauth-api'
import { cedarUploadsPlugin, createUploadAuthenticator } from '@cedarjs/uploads'

import { getCurrentUser } from 'src/lib/auth'
import { logger } from 'src/lib/logger'
import { db } from 'src/lib/db'
import { targets } from 'src/lib/uploads'

async function main() {
  const server = await createServer({
    logger,
  })

  await server.register(cedarUploadsPlugin, {
    tokenSecret: process.env.UPLOAD_TOKEN_SECRET!,
    targets,
    db,
    // Binds upload tokens to the requesting user. The authenticator
    // mirrors the GraphQL server's auth pipeline: it decodes the
    // request's auth header with the app's auth decoder, then resolves
    // the user with the app's getCurrentUser — getCurrentUser itself
    // takes decoded auth data, not a raw request. The setup command
    // generates these lines for apps with auth, so user binding is on
    // in the default setup, not an opt-in extra.
    authenticate: createUploadAuthenticator({ authDecoder, getCurrentUser }),
  })

  await server.start()
}

main()
```

The plugin reads the target from the validated JWT token payload to determine
which provider to use. No separate per-provider configuration needed —
everything comes from the targets map.

### GraphQL Integration

#### SDL Additions (generated by CLI)

```graphql
# api/src/graphql/uploads.sdl.ts

type UploadToken {
  token: String!
  """
  The profile's constraints, echoed for client-side UX (file-picker
  filters, pre-upload validation). The authoritative copy is inside the
  signed token.
  """
  allowedMimeTypes: [String!]!
  maxFileSize: BigInt!
  maxFiles: Int!
}

type PresignedUploadUrl {
  uploadId: String!
  url: String!
  method: String!
  headers: JSON!
}

input CreatePresignedUploadUrlInput {
  filename: String!
  contentType: String!
  size: BigInt!
}

type Query {
  """
  The profile name must match a key in the app's upload-profiles config.
  Constraints come from that server-side profile — the client never
  supplies them. See "Upload Profiles".
  """
  requestUploadToken(profile: String!): UploadToken! @requireAuth
}

type Mutation {
  createPresignedUploadUrl(
    input: CreatePresignedUploadUrlInput!
  ): PresignedUploadUrl! @requireAuth @requireUploadToken

  confirmUpload(uploadId: String!): Upload! @requireAuth
}
```

`size` and `maxFileSize` use the `BigInt` scalar that ships with Cedar's
GraphQL server, matching `Upload.size` — GraphQL's `Int` is signed 32-bit
and caps at 2 GB, which the multipart and tus futures this plan
anticipates would outgrow.

#### `@requireUploadToken` Directive

A **validator directive** that checks for a valid JWT upload token in the
`x-upload-token` request header. Applied to GraphQL operations that should
only be accessible with a valid upload token.

```ts
// packages/uploads/core/src/directives/requireUploadToken.ts

import {
  createValidatorDirective,
  ValidatorDirectiveFunc,
} from '@cedarjs/graphql-server'
import { verifyUploadToken } from '../uploadToken.js'

export const schema = gql`
  directive @requireUploadToken on FIELD_DEFINITION
`

const validate: ValidatorDirectiveFunc = ({ context }) => {
  const tokenHeader = context.event?.headers?.['x-upload-token']

  if (!tokenHeader) {
    throw new Error('Missing upload token')
  }

  const payload = verifyUploadToken(
    tokenHeader,
    process.env.UPLOAD_TOKEN_SECRET!
  )

  // A token is bound to the user (and, in multi-tenant apps, the
  // organization) it was issued to — an authenticated user cannot
  // spend someone else's token or carry one across organizations
  if (context.currentUser && String(context.currentUser.id) !== payload.sub) {
    throw new Error('Upload token was issued to a different user')
  }
  if (
    payload.organizationId &&
    payload.organizationId !== context.currentUser?.organizationId
  ) {
    throw new Error('Upload token was issued for a different organization')
  }

  // Attach the validated payload to context for use in resolvers
  context.uploadTokenPayload = payload
}

export default createValidatorDirective(schema, validate)
```

#### `@withSignedUrl` Directive

A **transformer directive** that converts upload IDs stored in database
fields into signed URLs for serving. Looks up the `Upload` record,
resolves the target provider, and calls `getSignedReadUrl()`.

```graphql
directive @withSignedUrl on FIELD_DEFINITION
```

Example usage:

```graphql
type User {
  id: String!
  name: String!
  avatarUrl: String @withSignedUrl
}
```

The directive implementation:

```ts
// packages/uploads/core/src/directives/withSignedUrl.ts

import {
  createTransformerDirective,
  TransformerDirectiveFunc,
} from '@cedarjs/graphql-server'
import { resolveTarget } from '../targets.js'

export const schema = gql`
  directive @withSignedUrl on FIELD_DEFINITION
`

const transform: TransformerDirectiveFunc = async ({
  context,
  resolvedValue,
}) => {
  if (!resolvedValue) {
    return null
  }

  // resolvedValue is an Upload ID. One DataLoader per request batches
  // the row lookups (a transformer directive runs per field per row),
  // and its batch query selects every column except `data`, so S3/FS
  // rows never drag inline blobs into memory.
  const upload = await uploadLoader(context).load(resolvedValue)

  if (!upload || upload.status !== 'completed') {
    return null
  }

  const target = resolveTarget(targets, upload.target)

  if (target.providerType === 'db') {
    // Fetch `data` only now that the target is known to be the DB
    // provider — return a data URI
    const { data } = await db.upload.findUniqueOrThrow({
      where: { id: upload.id },
      select: { data: true },
    })
    return `data:${upload.mimeType};base64,${data!.toString('base64')}`
  }

  return target.getSignedReadUrl(upload.storageKey!)
}

export default createTransformerDirective(schema, transform)
```

Note that `@withSignedUrl` no longer needs a `strategy` argument. It reads
the target from the Upload record and resolves the right provider
automatically. This means the directive works identically for S3, FS, DB,
and any future provider.

Two implementation requirements — both visible in the example above —
keep the directive safe on list queries:

- **Batch the lookups.** A transformer directive runs per field per row —
  a 100-row list with one decorated field is 100 single-row queries
  unless the directive resolves through `uploadLoader`, a per-request
  DataLoader keyed on upload id. URL signing itself is local crypto (the
  S3 presigner, the FS HMAC) and needs no batching.
- **Never fetch `data` for non-DB targets.** `Upload.data` holds the
  inline bytes for DB targets; an unqualified lookup drags the blob
  into memory for every S3/FS row too. The loader's batch query selects
  everything except `data`; the directive fetches `data` only when the
  resolved target has `providerType === 'db'`. And because the DB path
  embeds a full base64 data URI into the response, DB-target fields
  belong on detail queries, not list queries — the DB size cap keeps the
  worst case bounded.

#### `@withDataUri` Directive

A **transformer directive** that always returns a data URI, regardless of
provider. Reads the file from storage and base64-encodes it. Best for small
files only (DB targets, thumbnails).

```graphql
directive @withDataUri on FIELD_DEFINITION

type User {
  id: String!
  thumbnailDataUri: String @withDataUri
}
```

---

## Web-Side Implementation (Uppy)

### Uppy Configuration

We provide factory functions that create pre-configured Uppy instances for
each provider type.

```ts
// packages/uploads/web/src/createUppy.ts

import Uppy from '@uppy/core'

interface BaseUppyOptions {
  /** From the upload token payload */
  allowedMimeTypes?: string[]
  maxFileSize?: number
  maxFiles?: number

  /** Uppy core options passthrough */
  autoProceed?: boolean
  debug?: boolean
}

interface S3UppyOptions extends BaseUppyOptions {
  provider: 's3'
  /**
   * Function that fetches a presigned URL from the Cedar API.
   * Called for each file. Returns the shape Uppy expects.
   */
  getUploadParameters: (file: UppyFile) => Promise<{
    url: string
    method: 'PUT'
    headers: Record<string, string>
  }>
}

interface FsUppyOptions extends BaseUppyOptions {
  provider: 'fs'
  /** Upload endpoint URL — default: '/upload/fs' */
  endpoint?: string
  /** Upload token to send in headers */
  uploadToken: string
}

type CreateUppyOptions = S3UppyOptions | FsUppyOptions

function createUppy(options: CreateUppyOptions): Uppy
```

### React Hooks

#### `useUploadToken`

Fetches an upload token from the GraphQL API. Uses Apollo's `useLazyQuery`
with `fetchPolicy: 'no-cache'` — tokens expire, so Apollo's cache must
never answer this query — and only fetches when needed (not on mount).
The response carries the profile's constraints for client-side UX, and
the hook exposes them alongside the token.

```ts
// packages/uploads/web/src/hooks/useUploadToken.ts

interface UseUploadTokenOptions {
  /** Name of a server-defined upload profile — see "Upload Profiles" */
  profile: string
}

interface UseUploadTokenResult {
  /** Call this to fetch a fresh token */
  requestToken: () => Promise<string>
  /** The current token (null if not yet fetched) */
  token: string | null
  /**
   * The profile's constraints, echoed by the server alongside the token
   * for client-side UX. Null until the first successful fetch.
   */
  constraints: {
    allowedMimeTypes: string[]
    maxFileSize: number
    maxFiles: number
  } | null
  /** Loading state */
  loading: boolean
  /** Error state */
  error: ApolloError | undefined
}

function useUploadToken(options: UseUploadTokenOptions): UseUploadTokenResult
```

#### `useS3Upload`

Combines token fetching, presigned URL generation, and Uppy instance
management for S3 direct uploads.

```ts
// packages/uploads/web/src/hooks/useS3Upload.ts

interface UseS3UploadOptions {
  /** Name of a server-defined upload profile — see "Upload Profiles" */
  profile: string
  onUploadComplete?: (uploadIds: string[]) => void
  onUploadError?: (error: Error) => void
}

interface UseS3UploadResult {
  /** Pre-configured Uppy instance — pass to Uppy React components */
  uppy: Uppy
  /** Array of completed upload IDs */
  completedUploads: string[]
  /** Whether any upload is in progress */
  isUploading: boolean
}

function useS3Upload(options: UseS3UploadOptions): UseS3UploadResult
```

Internally, this hook:

1. Uses `useUploadToken` to get a token
2. Creates an Uppy instance with `@uppy/aws-s3`
3. Configures `getUploadParameters` to call the `createPresignedUploadUrl`
   GraphQL mutation (passing the token in headers)
4. Tracks completed uploads

#### `useFsUpload`

Same shape as `useS3Upload` but uses `@uppy/xhr-upload` targeting the
Fastify upload route.

```ts
// packages/uploads/web/src/hooks/useFsUpload.ts

interface UseFsUploadOptions {
  /** Name of a server-defined upload profile — see "Upload Profiles" */
  profile: string
  endpoint?: string // default: '/upload/fs'
  onUploadComplete?: (uploadIds: string[]) => void
  onUploadError?: (error: Error) => void
}

interface UseFsUploadResult {
  uppy: Uppy
  completedUploads: string[]
  isUploading: boolean
}

function useFsUpload(options: UseFsUploadOptions): UseFsUploadResult
```

Internally:

1. Uses `useUploadToken` to get a token
2. Creates an Uppy instance with `@uppy/xhr-upload`
3. Configures the endpoint and token header
4. Tracks completed uploads

#### `useDbUpload`

For small files that go through GraphQL as base64. Does NOT use Uppy — uses
a simple `FileReader` approach instead, since these are small files and
Uppy would be overkill.

```ts
// packages/uploads/web/src/hooks/useDbUpload.ts

interface UseDbUploadOptions {
  allowedMimeTypes: string[]
  maxFileSize: number
  maxFiles?: number
  onFileReady?: (file: {
    filename: string
    mimeType: string
    data: string // base64
    size: number
  }) => void
}

interface UseDbUploadResult {
  /** Call with a File object to read it as base64 */
  readFile: (file: File) => Promise<{
    filename: string
    mimeType: string
    data: string
    size: number
  }>

  /** Call with a FileList (from <input type="file">) */
  readFiles: (files: FileList) => Promise<
    Array<{
      filename: string
      mimeType: string
      data: string
      size: number
    }>
  >

  /** Progress: number of files read / total files */
  progress: { completed: number; total: number }

  /** Whether files are being read */
  isReading: boolean
}

function useDbUpload(options: UseDbUploadOptions): UseDbUploadResult
```

This hook validates file type/size client-side and returns base64-encoded
data that the developer passes to their GraphQL mutation. The client-side
checks are UX only — the service is the enforcement point (`storeFile()`
applies the DB size cap, and the developer's resolver validates the MIME
type and file count against the profile).

### React Components

Thin wrappers around Uppy's React components that integrate with the hooks
above.

#### `<S3Uploader>`

```tsx
// packages/uploads/web/src/components/S3Uploader.tsx

interface S3UploaderProps {
  /** Name of a server-defined upload profile — see "Upload Profiles" */
  profile: string
  onUploadComplete?: (uploadIds: string[]) => void
  onUploadError?: (error: Error) => void
  /** "dashboard" | "drag-drop" | "file-input" — default: "dashboard" */
  variant?: string
  /** Pass-through props to the underlying Uppy component */
  uppyProps?: Record<string, unknown>
  children?: React.ReactNode
}
```

#### `<FsUploader>`

Same props shape as `<S3Uploader>` but uses the FS upload flow internally.

#### `<DbInput>`

A simpler component for DB uploads — just a styled file input with
client-side validation and base64 reading.

```tsx
interface DbInputProps {
  allowedMimeTypes: string[]
  maxFileSize: number
  maxFiles?: number
  onFilesReady?: (
    files: Array<{
      filename: string
      mimeType: string
      data: string
      size: number
    }>
  ) => void
  children?: React.ReactNode
}
```

---

## CLI Setup Commands

### `yarn cedar setup uploads`

Interactive setup that asks which targets the developer wants and scaffolds
accordingly.

#### What It Does

1. **Adds the `Upload` model** to `schema.prisma` (using AST transform or
   string append — no codemod needed, Prisma schema is declarative)

2. **Creates `api/src/lib/uploads.ts`** — configuration file with:
   - `defineStorageTargets()` call with selected providers
   - S3 client setup (if an S3 target is selected)
   - FS config (if an FS target is selected)
   - `defineUploadProfiles()` with one starter profile per selected target
   - Export of `targets` and `profiles`

3. **Creates `api/src/graphql/uploads.sdl.ts`** — SDL with upload token
   query, presigned URL mutation, confirm mutation, and directives

4. **Creates `api/src/services/uploads/uploads.ts`** — Service with
   `requestUploadToken`, `createPresignedUploadUrl`, and `confirmUpload`
   resolvers

5. **Creates directive files:**
   - `api/src/directives/requireUploadToken/requireUploadToken.ts`
   - `api/src/directives/withSignedUrl/withSignedUrl.ts`
   - `api/src/directives/withDataUri/withDataUri.ts` (if DB target)

6. **Updates `api/src/server.ts`** — Adds the Fastify upload plugin
   registration (AST transform via jscodeshift, or instruction to add
   manually if transform fails)

7. **Installs dependencies:**
   - API: `@cedarjs/uploads`
   - API: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`
     (if S3 target)
   - Web: `@cedarjs/uploads-web`
   - Web: `@uppy/core`, `@uppy/react`
   - Web: `@uppy/aws-s3` (if S3 target)
   - Web: `@uppy/xhr-upload` (if FS target)

8. **Adds environment variables** to `.env`:
   - `UPLOAD_TOKEN_SECRET` (random generated)
   - `UPLOAD_SERVE_BASE_URL` (for FS targets)
   - `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
     `S3_BUCKET_*` (for S3 targets, with placeholder values)

9. **Runs `yarn cedar prisma migrate dev`** to apply the schema change

10. **Runs `yarn cedar generate types`** to update TypeScript types

#### Interactive Prompts

```
? Which storage targets do you want to configure?
  ◉ S3 — Direct-to-S3 presigned uploads (production)
  ◉ Local FS — Upload through API server (development)
  ◉ DB — Small files stored in database

? S3 target name: (avatars)
? S3 bucket name: (my-app-avatars)
? Add another S3 target? (y/N)

? FS target name: (local)
? Upload directory: (.uploads)
```

---

## S3 Webhook Confirmation

When a file is uploaded directly to S3, the API server needs to know the
upload completed. We use S3 Event Notifications for this.

### Architecture

```
S3 Bucket ──▶ EventBridge ──▶ SNS Topic ──▶ HTTPS Subscription
                                                    │
                                                    ▼
                                          POST /upload/webhook/s3
                                          (Fastify route in Cedar API)
```

Alternative: S3 → SNS (direct, without EventBridge). Both work.

### Webhook Handler

```ts
// packages/uploads/core/src/webhooks/s3.ts

interface S3WebhookHandlerOptions {
  db: PrismaClient
  targets: Record<string, StorageProvider>
  /**
   * The trusted SNS topic. Required — the handler rejects any
   * notification whose TopicArn does not exactly match, so a valid
   * signature from an attacker-controlled topic is not enough to feed
   * the webhook events.
   */
  topicArn: string
}

async function handleS3Webhook(
  request: FastifyRequest,
  options: S3WebhookHandlerOptions
): Promise<void> {
  // 1. Parse SNS message (handles SubscriptionConfirmation + Notification)
  // 2. Validate SNS signature (prevent spoofing) AND require the
  //    message's TopicArn to exactly match the configured topicArn —
  //    a validly signed message from an untrusted topic is rejected
  // 3. Extract S3 event from notification
  // 4. For each s3:ObjectCreated event:
  //    a. Extract the bucket and the URL-encoded object key, and
  //       decode the key
  //    b. Resolve the target whose config matches the event's bucket
  //       and key prefix (via getConfig()), strip the prefix, and find
  //       the Upload record by target + storageKey with status
  //       "pending" — an exact bucket-plus-effective-key match
  //       (storageKey alone is not guaranteed unique across targets,
  //       and providers store it without the keyPrefix), and duplicate
  //       notifications for already-settled rows are ignored
  //    c. Compare the actual S3 object size against the size recorded
  //       at presign time — on mismatch, claim the row "pending" →
  //       "failed" (conditional update), delete the object only when
  //       the claim matched, and stop (see "Size Enforcement")
  //    d. Flip status "pending" → "completed" (conditional update — a
  //       row the cleanup job already claimed stays untouched) and
  //       record the actual object size
}
```

### CLI Generator for S3 Webhooks

```bash
yarn cedar generate s3-webhook
```

This generates:

- A Terraform/CloudFormation/Pulumi snippet for creating the SNS topic and
  S3 event notification
- Or a simple AWS CLI script that sets it up
- Documentation on how to configure the S3 bucket

### Fallback: Client-Side Confirmation

For development or simpler setups, we also support client-side confirmation.
After Uppy reports a successful upload, the client calls a GraphQL mutation:

```graphql
type Mutation {
  confirmUpload(uploadId: String!): Upload! @requireAuth
}
```

The service verifies the S3 object exists before updating the status:

```ts
import { resolveTarget } from '@cedarjs/uploads'
import { targets } from 'src/lib/uploads'

export const confirmUpload = async ({ uploadId }) => {
  const upload = await db.upload.findUniqueOrThrow({
    where: { id: uploadId },
  })

  // Only the user (and, in multi-tenant apps, the organization) the
  // upload token was issued to can confirm it
  if (upload.userId && upload.userId !== context.currentUser.id) {
    throw new ForbiddenError("You don't have access to this upload")
  }
  if (
    upload.organizationId &&
    upload.organizationId !== context.currentUser.organizationId
  ) {
    throw new ForbiddenError("You don't have access to this upload")
  }

  // Only pending object-storage uploads await confirmation. DB uploads
  // have no storageKey and complete synchronously; a row that is not
  // pending is already settled.
  if (upload.status !== 'pending' || !upload.storageKey) {
    throw new Error('Upload is not awaiting confirmation')
  }

  const target = resolveTarget(targets, upload.target)

  // Verify the object actually exists in storage
  const exists = await target.exists(upload.storageKey)

  if (!exists) {
    throw new Error('Upload not found in storage')
  }

  // Verify the object matches what the token authorized — a presigned
  // PUT cannot cap body size (see "Size Enforcement"). An unknown size
  // counts as a failed verification: a provider that cannot report size
  // cannot prove the object is within the profile's limit.
  const actualSize = await target.getObjectSize(upload.storageKey)
  if (actualSize === null || BigInt(actualSize) !== upload.size) {
    // Claim the row before touching bytes — if a concurrent path
    // settled it first, skip deletion and leave the settled state
    const { count } = await db.upload.updateMany({
      where: { id: uploadId, status: 'pending' },
      data: { status: 'failed' },
    })
    if (count === 1) {
      await target.delete(upload.storageKey)
    }
    return db.upload.findUniqueOrThrow({ where: { id: uploadId } })
  }

  // Conditional transition — a row the cleanup job already claimed
  // stays failed instead of being resurrected
  await db.upload.updateMany({
    where: { id: uploadId, status: 'pending' },
    data: { status: 'completed' },
  })

  return db.upload.findUniqueOrThrow({ where: { id: uploadId } })
}
```

This is the default for development. The S3 webhook is recommended for
production.

---

## Third-Party Integration (transloadit, imgix, etc.)

The `Upload` record + target configuration exposes all the raw information
that third-party file processing services need. No Cedar abstraction sits
between the developer and these services.

### transloadit

transloadit needs an S3 reference to the source file. The Upload record
and target provide everything:

```ts
import { resolveTarget } from '@cedarjs/uploads'
import { targets } from 'src/lib/uploads'

const upload = await db.upload.findUniqueOrThrow({
  where: { id: uploadId },
})
const target = resolveTarget(targets, upload.target)
const config = target.getConfig()

await transloadit.createAssembly({
  steps: {
    import: {
      robot: '/s3/import',
      path: upload.storageKey,
      bucket: config.bucket,
      // credentials configured in transloadit dashboard
    },
    resize: {
      robot: '/image/resize',
      width: 300,
      height: 300,
    },
    export: {
      robot: '/s3/store',
      bucket: config.bucket,
      path: `thumbnails/${upload.storageKey}`,
    },
  },
})
```

### imgix

imgix uses the S3 bucket as a "source" and the object key as the path:

```ts
const upload = await db.upload.findUniqueOrThrow({
  where: { id: uploadId },
})

// The storageKey is the S3 object key — exactly what imgix expects
const imgixUrl = `https://my-app.imgix.net/${upload.storageKey}?w=300&h=300&auto=format`
```

### Cloudflare Images

```ts
const upload = await db.upload.findUniqueOrThrow({
  where: { id: uploadId },
})
const target = resolveTarget(targets, upload.target)
const signedUrl = await target.getSignedReadUrl(upload.storageKey!, {
  expiresIn: 600,
})

// Feed the signed URL to Cloudflare Images
const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1`,
  {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfToken}` },
    body: new URLSearchParams({ url: signedUrl }),
  }
)
```

### Why This Works

The design intentionally keeps all provider-specific details accessible:

- `upload.storageKey` — the raw S3 key, FS path, or blob reference
- `upload.target` — which provider configuration to use
- `target.getConfig()` — bucket name, region, key prefix, etc.
- `target.getSignedReadUrl()` — temporary URL for services that fetch by URL

No abstraction layer prevents you from reaching the information these
services need.

---

## tus Extensibility

The architecture is designed so that tus can be added later without
rearchitecting. Here's what makes it work:

### Why It's Easy to Add

1. **Uploads already go through Fastify** — tus is just another Fastify
   route. If uploads went through GraphQL, adding tus would require a
   completely different path.

2. **Upload tokens work with tus** — The `tus-js-client` (and Uppy's
   `@uppy/tus`) supports custom headers on upload requests. The
   `x-upload-token` header works identically.

3. **The Upload model is target-agnostic** — A tus upload would use an
   existing S3 or FS target. The record just gets created in the
   `onUploadFinish` callback.

4. **Uppy supports tus natively** — Swapping `@uppy/xhr-upload` for
   `@uppy/tus` on the client is a one-line plugin change.

### What Adding tus Would Look Like

```ts
// User's api/src/server.ts — future tus support

import { Server as TusServer } from '@tus/server'
import { S3Store } from '@tus/s3-store' // or FileStore for local

import { db } from 'src/lib/db'
import { targets } from 'src/lib/uploads'

const tusServer = new TusServer({
  path: '/upload/tus',
  datastore: new S3Store({
    s3ClientConfig: {
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    },
    bucket: process.env.S3_BUCKET_AVATARS!,
  }),
  onUploadFinish: async (req, res, upload) => {
    // Create Upload record using the same model as everything else
    await db.upload.create({
      data: {
        target: 'avatars', // maps to the same target in the config
        status: 'completed',
        filename: upload.metadata?.filename ?? 'unknown',
        mimeType: upload.metadata?.filetype ?? 'application/octet-stream',
        size: BigInt(upload.size ?? 0),
        storageKey: upload.id, // tus-s3-store uses the upload ID as S3 key
      },
    })
    return res
  },
})

// Mount tus on the Fastify instance
server.addContentTypeParser(
  'application/offset+octet-stream',
  (req, payload, done) => {
    done(null)
  }
)

server.all('/upload/tus', (req, reply) => {
  tusServer.handle(req.raw, reply.raw)
})
server.all('/upload/tus/*', (req, reply) => {
  tusServer.handle(req.raw, reply.raw)
})
```

This would be documented as an "Advanced: Adding tus Support" guide, not
built into the core package.

---

## Migration from Current Implementation

### Current State

The existing `@cedarjs/storage` package uses:

- A `BaseStorageAdapter` abstraction with `FileSystemStorage` and
  `MemoryStorage`
- A Prisma client extension that hooks into create/update/delete
- `setupStorage()` and `createUploadsConfig()` for configuration
- A jscodeshift codemod that modifies `db.ts`
- Location strings (file paths) stored in model columns

### Migration Path

1. **Mark `@cedarjs/storage` as deprecated** in its package.json and README.
   Add a console warning on import pointing to the new packages.

2. **New packages ship alongside** the old one. They're completely
   independent — no shared code, no shared configuration.

3. **Migration guide** documents:
   - How to move from Prisma extension hooks to explicit service calls
   - How to migrate file references from location strings in model columns
     to Upload records with foreign keys
   - How to switch from the old `UrlSigner` to the new target-based signed
     URL system
   - A one-time script to backfill the `Upload` table from existing
     location strings

4. **Future major version** (Cedar v3 or similar): Remove `@cedarjs/storage`
   entirely.

### Codemod Feasibility

A codemod could automate part of the migration:

- Find `setupStorage()` calls → replace with `defineStorageTargets` +
  `createFsProvider` calls
- Find `saveFiles.forX(input)` calls → replace with explicit
  `storeFile()` calls
- Find `.$extends(storagePrismaExtension)` in db.ts → remove it
- Add the `Upload` model to `schema.prisma`

However, the architectural change (automatic → manual lifecycle, location
strings → Upload records with foreign keys) means some migration will always
require developer judgment. The codemod handles the mechanical parts; a
migration guide covers the rest.

---

## Implementation Phases

### Phase 1: Core Foundation

**Goal:** Provider interface, FS target, upload tokens, `storeFile()`, and
the Prisma Upload model work end to end.

**Packages touched:** `@cedarjs/uploads` (new), CLI

**Deliverables:**

- [ ] `packages/uploads/core/` package scaffolding (package.json, tsconfig,
      build config)
- [ ] `StorageProvider` interface
- [ ] `createFsProvider()` implementation
- [ ] `createDbProvider()` implementation
- [ ] `defineStorageTargets()` and `resolveTarget()`
- [ ] `storeFile()`, `deleteFile()` and `cleanupStaleUploads()` utilities
- [ ] `defineUploadProfiles()` and profile-based token issuance
- [ ] Upload token JWT creation and validation (profile constraints +
      `sub` claim)
- [ ] Fastify upload plugin with FS upload route (`POST /upload/fs`)
- [ ] Fastify file serving route (`GET /upload/serve/:token`) with HMAC
      signed URLs
- [ ] `@requireUploadToken` validator directive
- [ ] `@withSignedUrl` transformer directive (FS and DB targets)
- [ ] `@withDataUri` transformer directive
- [ ] Prisma `Upload` model schema
- [ ] CLI: `yarn cedar setup uploads` (FS + DB targets, no interactive
      prompts yet)
- [ ] Integration tests: token flow, file upload, file serving, storeFile

### Phase 2: S3 Presigned Uploads

**Goal:** Direct-to-S3 uploads via presigned URLs work end to end.

**Packages touched:** `@cedarjs/uploads`

**Deliverables:**

- [ ] `createS3Provider()` implementation
- [ ] `getPresignedUploadUrl()` in S3 provider
- [ ] `getSignedReadUrl()` in S3 provider (native S3 presigned GET)
- [ ] `createPresignedUploadUrl` GraphQL mutation and service
- [ ] `confirmUpload` mutation and service (client-side confirmation
      with ownership and size verification)
- [ ] S3 webhook handler (SNS message parsing and signature validation)
- [ ] `@withSignedUrl` directive — works with S3 targets automatically
- [ ] CLI: S3 target option in setup command
- [ ] CLI: `yarn cedar generate s3-webhook` (optional)
- [ ] Integration tests with LocalStack or MinIO

### Phase 3: Web-Side (Uppy Integration)

**Goal:** React hooks and components for all three provider types.

**Packages touched:** `@cedarjs/uploads-web` (new)

**Deliverables:**

- [ ] `packages/uploads/web/` package scaffolding
- [ ] `createUppy()` factory function
- [ ] `useUploadToken` hook
- [ ] `useS3Upload` hook (wraps Uppy + `@uppy/aws-s3`)
- [ ] `useFsUpload` hook (wraps Uppy + `@uppy/xhr-upload`)
- [ ] `useDbUpload` hook (FileReader-based, no Uppy)
- [ ] `<S3Uploader>`, `<FsUploader>`, `<DbInput>` components
- [ ] Storybook stories for each component
- [ ] Example in test-project or kitchen-sink fixture

### Phase 4: Polish & Documentation

**Goal:** Production-ready with comprehensive docs.

**Deliverables:**

- [ ] Interactive CLI setup (target selection prompts, multiple S3 buckets)
- [ ] Migration guide from `@cedarjs/storage`
- [ ] Deprecation warnings in `@cedarjs/storage`
- [ ] "Adding tus Support" advanced guide
- [ ] "Third-Party Integration" guide (transloadit, imgix, Cloudflare Images)
- [ ] "Cleaning Up Stale Uploads" guide using `@cedarjs/jobs`
- [ ] API reference documentation
- [ ] Tutorial: "File Uploads in CedarJS"
- [ ] Security documentation (token flow, abuse prevention, S3 bucket
      policies)

### Estimated Effort

| Phase              | Estimated Time | Dependencies |
| ------------------ | -------------- | ------------ |
| Phase 1: Core + FS | 2–3 weeks      | None         |
| Phase 2: S3        | 1–2 weeks      | Phase 1      |
| Phase 3: Web/Uppy  | 2–3 weeks      | Phase 1      |
| Phase 4: Polish    | 1–2 weeks      | Phases 1–3   |

Phase 2 and Phase 3 can run in parallel. Phase 3 can start as soon as
Phase 1 is complete — the S3 and DB Uppy hooks can be built against the
provider interface with mocked backends while Phase 2 finishes the S3
provider.

---

## Implementation Notes

### Provider Type Discrimination

The `StorageProvider` interface includes an explicit `providerType: string`
property, and `storeFile()` branches on it. Inspecting `getConfig()` output
to detect the DB provider is not an option: config shapes are
provider-defined and offer no stable signal.

The framework only ever branches on a single special value — `'db'` — which
identifies the database-backed provider that stores file content inline. Every
other provider value is treated uniformly as object storage. This means adding
a new cloud provider (Azure, GCS, R2, etc.) in the future requires only a new
package implementing the interface; no changes to framework internals are needed.

```ts
interface StorageProvider {
  // 'db' is the only value the framework branches on.
  // All other values ('s3', 'fs', 'azure', 'gcs', 'r2', …) are treated
  // identically as object-storage providers. Third-party providers simply
  // declare their own string — no framework changes required.
  providerType: 'db' | string
  // …rest of interface
}
```

Built-in values: `'db'`, `'s3'`, `'fs'`.

### Upload Ownership (`userId`)

The `Upload` model carries a nullable `userId`. Implicit ownership via a
FK on the application model (e.g. `user.avatarId`) works for the simplest cases
but breaks down as soon as you need to answer "show all files uploaded by user X"
or enforce download authorisation without traversing every possible join.

A `userId` on `Upload` directly:

- Enables straightforward access-control checks in the `@requireUploadToken`
  and `@withSignedUrl` directives.
- Makes audit queries trivial
  (`db.upload.findMany({ where: { userId: currentUser.id } })`).
- Is nullable, so applications that don't use auth are completely unaffected.

For token-based uploads the framework stamps it from the token's `sub`
claim. For `storeFile()` calls, developers set it explicitly when the
file belongs to a user.

### Large File Uploads (S3 Multipart, >5 GB)

Deferred. Uppy's `@uppy/aws-s3` supports multipart uploads via the
`shouldUseMultipart` option, but it requires additional presigned URL endpoints
(`createMultipartUpload`, `signPart`, `completeMultipartUpload`). The Fastify
plugin should be designed with room to add these routes in a future phase.
In the meantime, users needing large-file support can self-serve with tus +
`@tus/s3-store`, which handles S3 multipart natively.

### Image Processing Integration

Out of scope for v1. The API design — particularly `storeFile()` and
`target.getConfig()` — already exposes everything that transloadit, imgix,
Cloudflare Images, or sharp-based local processing need. No special hooks are
required; the `Upload` record and provider config are sufficient.

### Provider-Specific Metadata

Deferred. Some providers support custom metadata on stored objects (S3 object
metadata, GCS custom metadata). If this becomes necessary, `StorageProvider.write()`
can accept an optional `metadata` bag in a future iteration. Developers needing
this today can use the native SDK client directly via the provider's config.
