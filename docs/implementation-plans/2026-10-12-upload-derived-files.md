# Derived files (variants)

Derived files for `@cedarjs/uploads`: files made from another file, such as
thumbnails, previews or a video's poster frame. The file they are made from can
be an upload, or a file stored somewhere else, such as a document fetched from a
third-party API when it is needed. Cedar keeps track of them; the app supplies
the function that makes each kind (a **variant**), and any source beyond
uploads.

Status: implemented as **experimental**. It stays experimental in the docs until
a second app, or video, has used it.

This plan applies the principles in
[`docs/design-principles.md`](../design-principles.md): the lifecycle stays
explicit (deleting derived files is a call, `deleteFor()`, which `deleteFile()`
makes for uploads, not a Prisma hook), and refusals name their alternatives
(an unknown source lists the configured ones; a source that can't key a
reference says to add `key()`; `deleteFile()` with derived files that have no
upload source says how to add one).

It is one of three related proposals that came out of the same work on a
production app (Effibo):

1. **This one:** derived files in `@cedarjs/uploads`.
2. **Declarative recurring jobs and unique jobs** in `@cedarjs/jobs`.
3. **A "locked child" runner**: parsing untrusted files (PDFs, images, video) in
   a sandboxed Node child process. Generators that parse untrusted files would
   run inside it; this plan does not depend on it.

## Table of contents

- [The problem](#the-problem)
- [Decisions](#decisions)
- [How it fits what uploads already has](#how-it-fits-what-uploads-already-has)
- [API](#api)
- [Schema](#schema)
- [Making a file once](#making-a-file-once)
- [Failures and retry](#failures-and-retry)
- [Resetting](#resetting)
- [Deleting](#deleting)
- [What the tests guard](#what-the-tests-guard)
- [Follow-ups](#follow-ups)
- [Open questions](#open-questions)

## The problem

A production Cedar app shows square thumbnails (two sizes) of photos and PDFs,
and a drawn first page of each PDF. Most of the effort went into plumbing, not
image making:

- **The same fields on every model.** Three models each got `thumbnailUpload`,
  `thumbnail2xUpload` and a failure timestamp, and two of them also
  `previewUpload`, plus a back-relation on `Upload` for every one of those
  relations.
- **A hand-kept owner list** for the job that sweeps orphaned uploads.
- **A race-fix helper** so two processes making the same file at the same
  moment don't crash on a unique constraint, plus an in-process map of
  in-flight promises.
- **A failure memo, by hand**: a `...FailedAt` column per kind of file.
- **A script per model** to remake all of one kind after a fix.

The same app also needs thumbnails and previews of files it never stores as
uploads: documents in Ordrestyring, a third-party system, fetched from its API
on demand. Tying derived files to `Upload` rows leaves those out.

## Decisions

- **Derived files are not tied to uploads.** A source is anything with a
  `read(ref)`: `uploadSource()` for uploads, or the app's own function for a
  third-party API. Why: the production app's Ordrestyring documents are never
  uploads, and storing each original first, only to thumbnail it, would copy a
  third party's files into the app's storage.
- **A separate, opt-in `DerivedFile` table**; the `Upload` model needs nothing.
  Why: a source that isn't a row can't be a foreign key, so the bookkeeping
  needs a table keyed by a string (`upload:<id>`, `osdoc:<org>/<case>/<doc>`).
  It also leaves the `Upload` model and every app that doesn't use derived
  files untouched. The made file is still an ordinary `Upload` row, so storage,
  serving, directives and tenancy work on it unchanged.
- **The claim has its own column, `claimId`.** Why: `Upload.tokenId` means "the
  upload token that created this row"; using it for claims gave one column two
  meanings.
- **A thrown error is temporary; `null` is permanent.** A throw is retried up to
  `maxAttempts` (3) times, the next attempt allowed `retryDelay` (one minute)
  after the last, doubling, counted in `attempts`. `null` from a generator or a
  source, or a made file `storeFile()` refuses, is failed at once. Failed stays
  failed until `resetVariants()`. Why: network failures (a third-party API
  being down) are common for remote sources and shouldn't be remembered for a
  day, while "this file type has no preview" never changes. This replaces
  `retryFailedAfter`.
- **No waiting for another process.** When another process holds the claim,
  `acquireVariant()` returns `pending` at once instead of polling. Why: polling
  was the most complex part of the code and held requests open; a caller can
  show a placeholder and ask again. Concurrent calls in one process still share
  one attempt. `pollInterval` is gone; `claimTimeout` stays, so a claim left by
  a process that died is taken over.
- **No variant made from another variant.** `readVariant()` in the generator
  context, and the dependency-cycle detection it needed, are gone. Why: it was a
  large share of the code for one use (a PDF thumbnail cut from its drawn
  page), which a generator can do by drawing the page itself.
- **No `onDelete: Restrict`, no `HAS_VARIANTS`.** Deleting is a call,
  `deleteFor(source)`, and `deleteFile()` makes it when given `derivedFiles`.
  Why: there is no foreign key to restrict on. The trade-off: nothing in the
  database stops a source file going away while its derived files stay. For
  uploads, `deleteFile({ derivedFiles })` covers it; for other sources the app
  must call `deleteFor()`, or the made files are orphaned.
- **`resetVariants()` deletes, it doesn't remake.** Why: a source key can't be
  turned back into the app's reference, so Cedar can't call a source's `read()`
  for a key alone. Each file is made again on its next acquire, or by the app's
  own backfill.
- **Names.** "acquire" for anything that may create (`acquireVariant`,
  `acquireVariantData`), plain reads are `find*`. There is no public `get*` that
  creates. `getVariantUrl()` is not carried over: the made file is an `Upload`,
  so `@withSignedUrl` and `@withDataUri` serve it.
- **Owners.** `uploadSource()` copies the upload's `userId` and
  `organizationId` to the made files; other sources return them from `read()`.
  Whether a viewer may see a derived file is the caller's to check, as it is for
  any upload.
- **No `cedar.toml` flag.** Opting in is calling `defineDerivedFiles()`; Cedar's
  flags are for framework behavior.
- **Streaming later.** A source's `read()` returns the whole file. A generator
  gets a context object with `readSource()`, so `openSource()` (a stream) or
  `sourcePath()` (a temp file) can be added without breaking generators, and a
  source can grow an optional streaming method next to `read()`.
- **No migration recipe** from the first, upload-only schema: it was
  experimental and short-lived.
- **`cleanupStaleUploads()` measures pending rows from `createdAt`.** No
  `Upload` row is reclaimed by derived files, so it has no reason to measure
  from `updatedAt`.
- **No media dependencies.** A poster frame made with ffmpeg is just another
  generator; the tests use trivial generators.

## How it fits what uploads already has

`@cedarjs/uploads` has no processors, hooks or Prisma extension: services call
`storeFile()` and `deleteFile()` explicitly, and every file has one row in a
single `Upload` table. Derived files reuse that:

- **A made file is stored with `storeFile()`**: same providers, same
  `generateStorageKey()`, same MIME check and 1 MB cap for DB targets.
- **Serving is unchanged.** A made file's id works with `@withSignedUrl` and
  `@withDataUri`.
- **Deleting is explicit**: `deleteFor()` deletes made files with
  `deleteFile()`, then their bookkeeping rows.

## API

```ts
import {
  defineDerivedFiles,
  deleteFile,
  uploadSource,
} from '@cedarjs/uploads'

export const derivedFiles = defineDerivedFiles({
  db,
  targets,
  target: targets.thumbnails,
  sources: {
    upload: uploadSource({ db, targets }),
    osdoc: { key: (ref: OsDocRef) => keyOf(ref), read: fetchOsDocument },
  },
  variants: {
    'thumb-164': makeSquare(164),
    preview: { generate: drawFirstPage, target: targets.previews },
  },
  maxAttempts: 3, // default
  retryDelay: 60 * 1000, // default, doubling
  claimTimeout: 10 * 60 * 1000, // default
  onError: (error, { source, variant }) => logger.warn(...),
})

await derivedFiles.acquireVariant({ upload: id }, 'thumb-164')
// { status: 'completed', upload } | { status: 'pending' } | { status: 'failed' }
await derivedFiles.acquireVariantData({ osdoc: ref }, 'preview') // { upload, data } | null
await derivedFiles.findVariant({ upload: id }, 'thumb-164') // never makes
await derivedFiles.findVariants(refs, 'thumb-164') // (Upload | null)[], in order
await derivedFiles.resetVariants('preview') // { deleted, errors }
await derivedFiles.deleteFor({ osdoc: ref })

await deleteFile(target, { db, upload, derivedFiles }) // upload and its derived files
```

A source is `{ key?(ref): string; read(ref) }`. `read()` returns
`{ data, mimeType?, filename?, userId?, organizationId? }`, or `null` when the
file doesn't exist. `key()` is optional for string references. A generator gets
`{ source: { name, key, ref }, variant, readSource() }` and returns
`{ data, mimeType, filename? }` or `null`.

Source names are letters, digits, `_` and `-` (they start every key, so no `:`).
Variant names are letters, digits, `.`, `_` and `-`, because they end up in
filenames and logs.

## Schema

```prisma
model DerivedFile {
  id        String   @id @default(cuid())
  source    String
  variant   String
  uploadId  String?
  status    String   @default("pending")
  claimId   String?
  attempts  Int      @default(0)
  updatedAt DateTime @updatedAt

  @@unique([source, variant])
}
```

- **The unique index is the lock**: one process creates the row that claims a
  file.
- **`uploadId` is not a relation.** A relation would need a back-relation field
  on `Upload`. A made file deleted some other way is noticed on the next
  acquire and made again.
- **The failure memo is the row**: `failed`, with `updatedAt` as when.

`DerivedFileDatabase` is the structural subset of a generated client the code
uses; the test helper assigns the generated client to it, so the types can't
drift.

## Making a file once

`acquireVariant(source, name)` finds the row for `(source key, variant)`:

- none: create it as `pending` with a random `claimId` and `attempts: 1`, and
  make the file. A unique violation means another process got there first:
  `pending`.
- `completed`: return its `Upload` row (or, if that row is gone, claim and make
  it again).
- `failed`: `failed`.
- `pending` without a claim (waiting for a retry): `pending` until the backoff
  has passed, then claim it with a conditional update and try again.
- `pending` with a claim: `pending`, unless the claim is older than
  `claimTimeout`; then take it over, or mark it failed if that was the last
  attempt allowed.

The claim holder runs the generator, stores the file with `storeFile()`, and
completes the row with a conditional update on its own `claimId`. If that
matches nothing (the row was deleted or taken over meanwhile), it deletes the
file it made.

## Failures and retry

A thrown error from the source or the generator, or from storing (a storage
outage), goes to `onError` and releases the claim with `attempts` counted; the
next acquire after `retryDelay * 2^(attempts - 1)` tries again, until
`maxAttempts`. `null`, or a made file `storeFile()` refuses
(`MIME_TYPE_NOT_ALLOWED`, `FILE_TOO_LARGE`), fails the row at once.

Claims and retries compare `updatedAt`, an absolute timestamp, with the
process's clock: time zones don't matter, but the processes' clocks should be
roughly in sync (NTP).

## Resetting

`resetVariants(name)` deletes every row of one variant, made or failed, with its
made file, in id order and batches. An attempt still running for a deleted row
finds its claim gone and deletes what it made. A row that can't be deleted is
reported through `onError` and counted in `errors`.

## Deleting

`deleteFor(source)` deletes each derived file's made file (bytes, then `Upload`
row), then its `DerivedFile` row, the latter only in the state the file was
deleted for: an attempt that completes in between is seen, and its file
deleted too. `deleteFile(target, { db, upload, derivedFiles })` calls
`deleteForUpload()` before and after deleting the upload. Before, so a refusal
(with `derivedFiles` but no `uploadSource()` configured, naming the fix) leaves
everything in place. After, because an attempt claims its row before it reads
its source: any attempt that read the upload before it was deleted has its row
by then, so the second pass deletes it, and the attempt finds its claim gone
and deletes what it made. For other sources the same holds when the app calls
`deleteFor()` after the source file is gone.

## What the tests guard

`packages/uploads/src/__tests__/derivedFiles.test.ts`, against the package's
real SQLite test database:

- A file is made on acquire, stored as an `Upload` with the source's owner and
  organization, and found later without calling the generator again.
- A source outside uploads, with an object reference and a `key()`.
- DB targets store made files inline.
- Concurrent acquires in one process run the generator once; a second
  "process" gets `pending` instead of waiting.
- A stale claim is taken over after `claimTimeout`, and failed if it was the
  last attempt.
- A throwing generator is retried with backoff, then failed, and stays failed;
  a retry can succeed. A not-yet-completed upload is retried.
- `null` from a generator or a source fails at once, without `onError`, until
  `resetVariants()`; a made file `storeFile()` refuses fails at once.
- Invalid names, unknown variants and sources, two sources in one reference,
  and a non-string reference without `key()` are refused, naming the fix.
- `findVariants()` returns files in the order given.
- A file whose completion can't be saved leaves nothing behind and releases
  its claim; a made file deleted some other way is made again, and two
  processes doing that at once keep one tracked file.
- `resetVariants()` clears one variant and leaves others; a file being made
  during a reset leaves nothing behind.
- `deleteFile()` with `derivedFiles` deletes an upload's derived files and only
  those; without an upload source it refuses before deleting anything; a file
  finished during or after a delete, or whose attempt started while the upload
  was being deleted, leaves nothing behind.

## Follow-ups

- **Streaming sources**: `openSource()` / `sourcePath()` in the generator
  context, and an optional streaming method on sources, when a video generator
  needs them.
- **Sandboxed generators**: run generators that parse untrusted files in the
  "locked child" runner (proposal 3).
- **Recurring/unique jobs** (proposal 2) would make "make missing files in the
  background" a declared job rather than app code.

## Open questions

- **Retry defaults.** Three attempts, one minute then two, means a third-party
  outage longer than about three minutes fails every file requested during it
  until `resetVariants()`. Should the delay be longer, or should exhausted
  retries be distinguishable from `null` so they can be reset on their own?
- **Orphans for external sources.** An app that forgets `deleteFor()` leaves
  made files behind. Is a sweep worth adding (an optional `exists(keys)` on a
  source, and a `deleteOrphans()` that checks it)?
- **A missing upload** (`{ upload: 'typo' }`) is remembered as failed, like any
  source whose `read()` returns `null`, and logged nowhere. Should
  `uploadSource()` throw for an id that never existed instead?
- **Owner without a read.** A generator that returns a file without calling
  `readSource()` still causes one read, to copy the source's owner to the made
  file. Fine for uploads; worth a separate, cheaper "describe" on sources if a
  remote source minds.
- **Sync vs. job-based generation.** `acquireVariant()` makes on demand, in the
  request. Should the package offer a "queue it" mode tied to `@cedarjs/jobs`,
  or is acquiring from a job enough?
