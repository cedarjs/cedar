// Stand-in for the `client.ts` entry point emitted by Prisma's `prisma-client`
// generator when `generatedFileExtension` is "ts".
//
// Node cannot `import()` a TypeScript file, so codegen has to read `ModelName`
// out of `internal/prismaNamespace.ts` instead of importing this. Vitest runs
// through Vite, which *would* happily transform and import this file, hiding
// the bug — so this fixture throws to assert that it is never imported.

throw new Error(
  'A TypeScript Prisma client must not be imported — Node cannot load it',
)
