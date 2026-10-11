# Upload derived files (variants)

Derived files for `@cedarjs/uploads`: an upload can have **variants**, files
made from it such as thumbnails, previews or a video's poster frame. Cedar keeps
track of them; the app supplies only the function that makes one.

Status: implemented as **experimental**. It stays experimental in the docs until
a second app, or video, has used it.

This plan applies the principles in
[`docs/design-principles.md`](../design-principles.md): the lifecycle stays
explicit (deleting variants is part of the `deleteFile()` call, not a Prisma
hook), the schema fails closed (`onDelete: Restrict` refuses to delete a source
row that still has variants), and that refusal names its alternatives
(`HAS_VARIANTS`: pass `targets` to `deleteFile()`, or call `deleteVariants()`
first).

It is one of three related proposals that came out of the same work on a
production app (Effibo):

1. **This one:** derived files in `@cedarjs/uploads`.
2. **Declarative recurring jobs and unique jobs** in `@cedarjs/jobs`.
3. **A "locked child" runner**: parsing untrusted files (PDFs, images, video) in
   a sandboxed Node child process. Variant generators that parse untrusted files
   would run inside it; this plan does not depend on it.

## Table of contents

- [The problem](#the-problem)
- [Decisions](#decisions)
- [How it fits what uploads already has](#how-it-fits-what-uploads-already-has)
- [API](#api)
- [Schema and storage](#schema-and-storage)
- [Making a variant once](#making-a-variant-once)
- [Failures and retry](#failures-and-retry)
- [Regenerating](#regenerating)
- [Deleting](#deleting)
- [What the tests guard](#what-the-tests-guard)
- [Discoverability](#discoverability)
- [Follow-ups](#follow-ups)
- [Open questions](#open-questions)

## The problem

A production Cedar app shows square thumbnails (two sizes) of photos and PDFs,
and a drawn first page of each PDF. Most of the effort went into plumbing, not
image making:

- **The same fields on every model.** Three models each got `thumbnailUpload`,
  `thumbnail2xUpload` and a failure timestamp, and two of them also
  `previewUpload`, plus a back-relation on `Upload` for every one of those
  relations: eight of the eleven back-relations on `Upload` are derived files.
- **A hand-kept owner list.** The job that sweeps orphaned uploads needs to know
  every relation through which something can own an `Upload`. That list is
  updated by hand for every new relation; forget one and the files are swept
  after a day, or leak forever.
- **A race-fix helper.** Two processes (a background job and a backfill script,
  or two requests from two api processes) can make the same derived file at the
  same moment. Each create function stores its files, then does a conditional
  update, and throws its files away if it lost. A helper exists only to do
  "create the row, or fill it if the field is still empty" without a
  unique-constraint crash. On top of that, an in-process map of in-flight
  promises keeps two tiles of one page from making the same thumbnail twice.
- **A failure memo, by hand.** "Could not be made, try again after a day" is a
  `...FailedAt` column per kind of derived file and a check in every create
  function.
- **Remaking all of one kind is a script per model.** After a fix to PDF
  drawing, a script cleared the fields, deleted the uploads and remade them, one
  model at a time.
- **"Without thumbnails" queries per model**, for backfills.

If uploads knew that one upload can be derived from another, each with a name
(`thumb-164`, `thumb-328`, `preview`), all of that collapses: the derived files
go when the source goes; making a missing one happens once even with two
requests at the same moment; "couldn't be made, try again after N" is tracked;
"remake every `preview`" is one call. The app keeps only the function that turns
bytes into the new file.

## Decisions

- **A real implementation with tests, not an RFC.** Tests fail when things
  change; docs don't.
- **Small.** Cedar owns the bookkeeping: the relation to the source, deletion
  with the source, once-only making under concurrency, the failure memo with
  retry-after, regenerate-all for one variant name, and reading and serving. The
  app passes generator functions: `variants: { 'thumb-164': makeThumb }`.
- **No media dependencies.** Video is the "is this generic?" test: a poster
  frame made with ffmpeg is just another generator. The package does not depend
  on sharp, pdf.js or ffmpeg, and the tests use trivial generators.
- **Experimental** in the docs until a second app or video uses it.
- **Built on uploads, not beside it**: see the next section.

## How it fits what uploads already has

`@cedarjs/uploads` has no processors, hooks, or Prisma extension: services call
`storeFile()` and `deleteFile()` explicitly, and every file has one row in a
single `Upload` table, with bytes on a named storage target (`StorageProvider`:
S3, filesystem, or inline in the row for DB targets). Variants reuse every part
of that:

- **A variant is an `Upload` row.** Same table, same `target` / `storageKey` /
  `data` columns, same providers, same `generateStorageKey()`, the same 1 MB cap
  for DB targets. It copies its source's `userId` and `organizationId`, so
  ownership checks and tenancy scoping apply to it as to any upload.
- **Serving is unchanged.** A variant's id works with `@withSignedUrl` and
  `@withDataUri`; `getVariantUrl()` is the same logic for service code.
- **Deletion stays explicit.** `deleteFile()` gains an optional `targets`
  option; with it, the upload's variants are deleted (bytes, then rows) before
  the upload. Nothing happens inside a Prisma query, in line with the uploads
  plan's two-gate test.
- **Status is reused for bookkeeping.** `pending` is the claim while a variant
  is being made, `completed` is made, `failed` is the failure memo.
  `cleanupStaleUploads()` already ignores `failed` rows with no `storageKey`,
  and claims `pending` rows older than an hour as `failed`, which turns a claim
  abandoned by a crashed process into a remembered failure: the behavior we want
  anyway.
- **`tokenId` holds the claim id** while a variant is `pending`. For an upload
  made through the upload routes it is the id of the token that created the row;
  for a variant it is the id of the attempt that is making it. Both say "what is
  creating this row", and it is cleared on completion.

## API

```ts
import { defineUploadVariants, deleteFile } from '@cedarjs/uploads'

export const uploadVariants = defineUploadVariants({
  db,
  targets,
  target: targets.thumbnails,
  variants: {
    'thumb-164': makeSquare(164),
    'thumb-328': makeSquare(328),
    preview: { generate: drawFirstPage, target: targets.previews },
    poster: makePosterFrame, // ffmpeg, in the app
  },
  retryFailedAfter: 24 * 60 * 60 * 1000, // default: one day
  claimTimeout: 10 * 60 * 1000, // default: ten minutes
  pollInterval: 250, // default
  onError: (error, { sourceId, variant }) => logger.warn(...),
})

await uploadVariants.getVariant(uploadId, 'thumb-164') // row, made if missing; null if failed
await uploadVariants.readVariant(uploadId, 'thumb-164') // { upload, data } | null
await uploadVariants.getVariantUrl(uploadId, 'thumb-164', { expiresIn: 600 })
await uploadVariants.findVariant(uploadId, 'thumb-164') // only if made; never makes
await uploadVariants.findVariants(uploadIds, 'thumb-164') // Map<sourceId, row>
await uploadVariants.regenerateVariants('preview') // { deleted, made, failed, errors }
await uploadVariants.deleteVariants(uploadId)

await deleteFile(target, { db, upload, targets }) // source and its variants
```

A generator gets `{ source, variant, readSource(), readVariant(name) }` and
returns `{ data, mimeType, filename? }` or `null`:

- `readSource()` reads the source's bytes from whichever target holds them.
- `readVariant(name)` reads another variant of the same source, making it first
  if needed. This is how a PDF's thumbnail is cut from its drawn first page,
  which the real app does. A variant that ends up depending on itself is refused
  with a `CONFIGURATION` error.
- `null` means "this source cannot have this variant" (a file type the generator
  does not handle). It is remembered like a failure.

Variant names are restricted to letters, digits, `.`, `_` and `-`, because they
end up in filenames and logs. Variants are made from original uploads only;
asking for a variant of a variant is `NOT_SUPPORTED`, which keeps deletion one
level deep.

## Schema and storage

Two nullable columns, a self-relation and a unique index on `Upload`:

```prisma
sourceId String?
variant  String?
source   Upload?  @relation("UploadVariants", fields: [sourceId], references: [id], onDelete: Restrict)
variants Upload[] @relation("UploadVariants")

@@unique([sourceId, variant])
```

Why this shape:

- **Variants in the `Upload` table, not a side table.** Everything that works on
  uploads (providers, directives, serialization, tenancy, the cleanup job) works
  on variants unchanged. A separate `UploadVariant` table would need its own
  copy of each.
- **No columns on the app's models.** The app's `Document.uploadId` stays the
  only reference. The per-model thumbnail fields, failure timestamps and
  back-relations go away, and an orphan sweep's owner list shrinks to the app's
  real owners: a variant's owner is its source.
- **The unique index is the lock.** `(sourceId, variant)` lets exactly one
  process create the pending row that claims a variant. Original uploads have
  `NULL` in both columns, and SQL unique indexes treat `NULL`s as distinct, so
  originals never collide.
- **`onDelete: Restrict`, not `Cascade`.** A cascade would delete the variant
  rows inside the database and leave their bytes in storage with nothing
  referencing them: exactly the silent orphaning the uploads design avoids.
  Restrict makes a forgotten variant a loud error instead.
- **The failure memo is the row.** A `failed` variant row with no file;
  `updatedAt` is when it failed. No `failedAt` column is needed.

The types are structural, like the rest of the package: `UploadVariantDatabase`
is the subset of a generated client that variants use. The base `UploadDatabase`
is unchanged, so apps that do not add the columns are not affected.

## Making a variant once

`getVariant(source, name)`:

1. **In this process**, concurrent calls for the same source and name share one
   promise.
2. **Across processes**, the variant's own row is the claim. A caller finds the
   row for `(sourceId, variant)`:
   - none: create it as `pending` with a random claim id in `tokenId`. A unique
     violation means another process won; look again.
   - `completed`: return it.
   - `failed`: see below.
   - `pending` and fresh: another process is making it; wait `pollInterval` and
     look again.
   - `pending` and older than `claimTimeout`: its maker died; take the claim
     over with a conditional update on the old claim id.
3. The claim holder runs the generator, writes the bytes under a new storage
   key, and completes the row with a conditional update on its own claim id. If
   that update matches nothing (the source was deleted, a regenerate removed the
   row, or another process took over a claim it thought abandoned), the bytes it
   wrote are deleted again.

A storage write that fails releases the claim rather than recording a failure:
storage being down is not the source file's fault.

## Failures and retry

A generator that throws or returns `null`, or returns an invalid MIME type or a
file too big for a DB target, leaves the row `failed` with no file. Requests
within `retryFailedAfter` of `updatedAt` get `null` without calling the
generator. The first request after that claims the row with a conditional update
(`failed` and older than the cutoff, to `pending`) and tries again. Thrown
errors go to `onError`.

## Regenerating

`regenerateVariants(name)` remakes every variant of one name, made or failed,
and leaves every other name alone. The run's cutoff is the newest existing row's
`createdAt`, read from the database so the run ends on the database's clock
rather than the process's. Rows are handled oldest first in batches: delete the
bytes and the row, then make it again with `getVariant()` (or, with
`remake: false`, leave it to the next read). A row that cannot be deleted is
reported through `onError` and skipped, so the loop always ends.

## Deleting

`deleteFile(target, { db, upload, targets })` deletes the upload's bytes, then
each variant's bytes and row, then the upload's row. A variant claimed by a
concurrent request in between makes the row delete fail on the foreign key; the
variants are deleted again, up to three rounds.

Without `targets`, a source with variants cannot be deleted: the foreign key
refuses, and `deleteFile()` turns that into `UploadError('HAS_VARIANTS')` naming
both ways out. Calling again with `targets` finishes the job, since
`deleteFile()` is idempotent.

A variant still being made when its source is deleted loses its claim (its row
is gone), and deletes the bytes it wrote.

## What the tests guard

`packages/uploads/src/__tests__/variants.test.ts`, against the package's real
SQLite test database:

- A variant that doesn't exist yet is made on read, stored on the variant's
  target, linked to its source (`sourceId`, `variant`), with the source's owner
  and organization; later reads find it without calling the generator.
- DB targets store variants inline and serve them as `data:` URIs; object
  storage serves signed URLs.
- Two concurrent requests in one process run the generator once.
- Two concurrent requests from two separate instances (two "processes" sharing
  only the database) run the generator once and return the same row.
- A claim whose maker died (a stale `pending` row) is taken over.
- A generator failure is remembered: not retried before `retryFailedAfter`
  passes, retried and made after it. `null` is remembered the same way.
- One variant made from another with `readVariant()`, and a self-dependency
  refused.
- Unknown and invalid variant names, variants of variants, and missing sources
  are refused with the right error codes.
- `findVariants()` returns made variants of many sources in one query.
- `regenerateVariants()` remakes one name and leaves the others (same row, same
  file); it also retries remembered failures; `remake: false` only deletes.
- Deleting a source with `targets` deletes its variants and their stored files
  on every target, and leaves other sources' variants alone.
- Deleting a source without `targets` is refused with `HAS_VARIANTS`, and
  calling again with `targets` finishes.
- A variant finished after its source was deleted leaves no file behind.

The test helper also assigns the generated Prisma client to
`UploadDatabase & UploadVariantDatabase`, so the structural types cannot drift
from what Prisma generates.

## Discoverability

Names use the words people search for: `defineUploadVariants`, `getVariant`,
`regenerateVariants`, `deleteVariants`, `UploadVariant*` types, with JSDoc
mentioning derived files, thumbnails, previews and poster frames. The uploads
docs have a "Derived files: thumbnails, previews and other variants" section,
and the package README a bullet.

Lint rules that point at variants (for example, flagging a model with
`thumbnailUpload` / `...FailedAt` columns) are a later step. Cedar's linting is
moving to oxlint (see
[the oxlint and oxfmt migration plan](2026-09-12-oxlint-and-oxfmt-migration.md)),
so any such rule would be written for oxlint.

## Follow-ups

- **Sniff a file's type by its bytes**, not the client's claimed MIME type, in
  uploads itself. Generators would get the sniffed type, and serving and upload
  profiles could use it too. Not built here.
- **Sandboxed generators**: run generators that parse untrusted files in the
  "locked child" runner (proposal 3).
- **Setup command**: `yarn cedar setup uploads` could add the variant columns
  once the feature is no longer experimental.
- **Recurring/unique jobs** (proposal 2) would make "make missing variants in
  the background" a declared job rather than app code.

## Open questions

- **Schema.** Should the variant columns be part of the `Upload` model that
  `yarn cedar setup uploads` writes, or stay opt-in? Today they are opt-in and
  documented; apps add them and create a migration. Adding them for everyone
  costs two nullable columns and an index and avoids a migration later.
- **Migrating existing apps.** An app with per-model thumbnail relations can
  move by setting `sourceId` and `variant` on its existing thumbnail `Upload`
  rows in a data migration, then dropping its own columns. Worth a documented
  recipe once a second app does it.
- **Sync vs. job-based generation.** `getVariant()` makes on demand, in the
  request. Apps that cannot afford that call it from a job and use
  `findVariant()` / `findVariants()` in requests. Should the package offer a
  "queue it" mode tied to `@cedarjs/jobs` (proposal 2), or is this split enough?
- **Transient vs. permanent failures.** Every generator failure is remembered
  for `retryFailedAfter`. A generator that fetches from a network may want
  "don't remember this one". A named escape (an error class the generator throws
  to release the claim) is cheap to add when a second use asks for it.
- **Large sources.** `readSource()` buffers the whole file. A video generator
  may prefer a stream or a temp file; it can read the provider directly today
  (`resolveTarget(targets, source.target).readStream`). Should the context offer
  a stream?
- **Serving private files.** Variants inherit their source's `userId` and
  `organizationId`, and `getVariantUrl()` signs a URL for whoever calls it.
  Authorization is the caller's, as for any upload. Should variant URLs be
  checked against the source's owner automatically, or is that the app's?
- **Sources outside uploads.** The production app also thumbnails files that
  live in a third-party system and are never stored as uploads. Those have no
  source row, so this design does not cover them; storing the original first (or
  a "remote source" row) would.
- **Clocks.** The failure memo and the claim timeout compare `updatedAt`, which
  Prisma sets in the client, with the process's clock. Across processes with
  skewed clocks a retry can come slightly early or late; a claim timeout well
  above the slowest generator keeps that harmless.
