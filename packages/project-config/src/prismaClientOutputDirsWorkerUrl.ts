// This module is loaded on demand instead of being bundled into the package
// entry points. `import.meta` is ES module syntax, and tools that transpile
// the entry points to CommonJS at runtime (e.g. jscodeshift's Babel register
// hook) leave it in place, which makes Node load their output as an ES module.
export const prismaClientOutputDirsWorkerUrl = new URL(
  './prismaClientOutputDirsWorker.js',
  import.meta.url,
)
