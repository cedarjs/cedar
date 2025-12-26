import type { Plugin } from 'vite'

export function trackDbImportsPlugin(): Plugin {
  return {
    name: 'db-import-tracker',
    transform(code, id) {
      // This regex and code content check could potentially match other files.
      // It's very unlikely, but it is possible. For now this is good enough
      if (
        id.match(/\/api\/src\/lib\/db\.(js|ts)$/) &&
        code.includes('PrismaClient')
      ) {
        // Inserting the code last (instead of at the top) works nicer with
        // sourcemaps
        return (
          code +
          `
          ;if (typeof globalThis !== "undefined") {
            globalThis.__cedarjs_db_imported__ = true;
          } else {
            throw new Error(
              "vite-plugin-track-db-imports: globalThis is undefined. " +
              "This is an error with CedarJS"
            );
          }
          `
        )
      }

      return code
    },
  }
}
