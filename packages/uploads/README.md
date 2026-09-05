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
- **Web hooks and components** at `@cedarjs/uploads/web`, built on Uppy.

```bash
yarn cedar setup uploads
```

See the [uploads documentation](https://cedarjs.com/docs/uploads) for the full
guide.
