# @cedarjs/uploads

File uploads and storage for CedarJS apps.

- **Named storage targets** backed by providers for S3 (`@cedarjs/uploads/s3`),
  the local filesystem, and the database, all implementing one small
  `StorageProvider` contract.
- **Upload profiles** that the server owns: clients name a profile, the server
  signs its constraints into a short-lived, user-bound upload token.
- **A Fastify plugin** with token-gated routes for filesystem uploads,
  signed-URL file serving, and S3 event webhooks.
- **GraphQL directives** (`@requireUploadToken`, `@withSignedUrl`,
  `@withDataUri`) and service helpers for issuing tokens, presigning direct
  uploads, and confirming them.
- **Lifecycle utilities** (`storeFile`, `deleteFile`, `cleanupStaleUploads`) for
  server-generated files and explicit cleanup.
- **Derived files (variants)**, experimental: thumbnails, previews, a video's
  poster frame. `defineUploadVariants()` takes one generator function per
  variant name and keeps the bookkeeping: variants are `Upload` rows linked
  to their source, made once on first read even under concurrency, failures
  remembered with a retry-after, `regenerateVariants()` to remake one name,
  and deletion with the source.
- **Content detection** (`detectContentType`, `acceptedContentType`) that
  checks what an uploaded file really is from its bytes, not from its name or
  the type the browser claimed: images, PDF, audio/video, and OpenDocument and
  Office files. Uploads use it by default (`verifyContentType`), and store
  each file under one canonical spelling of its type.
- **Web hooks and components** at `@cedarjs/uploads/web`, built on Uppy.

```bash
yarn cedar setup uploads
```

See the [uploads documentation](https://cedarjs.com/docs/uploads) for the full
guide.
