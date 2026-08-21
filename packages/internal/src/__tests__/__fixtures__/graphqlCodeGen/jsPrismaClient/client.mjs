// Stand-in for the `client.mjs` entry point emitted by Prisma's
// `prisma-client` generator when `generatedFileExtension` is "mjs".
//
// Codegen reads the model names out of `models.mjs` and never loads this
// file. Vitest runs through Vite, which *would* happily import it, hiding a
// regression — so this fixture throws to assert it stays unimported.

throw new Error(
  'A JavaScript Prisma client must not be imported — codegen reads models.mjs',
)
