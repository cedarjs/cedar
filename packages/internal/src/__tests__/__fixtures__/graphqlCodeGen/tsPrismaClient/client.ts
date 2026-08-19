// Stand-in for the `client.ts` entry point emitted by Prisma's `prisma-client`
// generator when `generatedFileExtension` is "ts".
//
// Codegen reads the model names out of `models.ts` and never loads this file.
// Vitest runs through Vite, which *would* happily transform and import it,
// hiding a regression — so this fixture throws to assert it stays unimported.

throw new Error(
  'A TypeScript Prisma client must not be imported — codegen reads models.ts',
)
