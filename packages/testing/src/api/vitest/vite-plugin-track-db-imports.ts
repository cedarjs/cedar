import type { Plugin } from 'vite'

export function trackDbImportsPlugin(): Plugin {
  return {
    name: 'db-import-tracker',
    transform(code, id) {
      if (id.match(/src\/lib\/db\.(js|ts)$/)) {
        // Inserting the code last (instead of at the top) works nicer with
        // sourcemaps
        return code + '\n\n;globalThis.__cedarjs_db_imported__ = true;'
      }

      return code
    },
  }
}

// This is a version that AI suggested to me
// TODO: There are a few things I want to explore
// - How's resetting the flag working currently? Is it reset when it needs to
//   be? Is doing it in configureServer() and buildStart() actually helping?
// - Correct source maps are nice when something is broken in a test. Should
//   look into providing the `map` property in the transform result. What does
//   `null` mean?
// - That `typeof` guard looks sensible. Should probably add someting like that.
//   But maybe throwing an error if it's undefined, so that users can report it
//   as an error with the framework
// - Another option for resetting the flag is to have a `afterEach` or
//   `afterAll` that does it
//
// {
//   name: 'db-import-tracker',
//   configureServer() {
//     // Reset flag when server starts
//     globalThis.__cedarjs_db_imported__ = false;
//   },
//   buildStart() {
//     // Reset flag when build starts
//     globalThis.__cedarjs_db_imported__ = false;
//   },
//   transform(code, id) {
//     // More comprehensive matching
//     const isDbModule =
//       /src\/lib\/db\.(js|ts|mjs|cjs)$/.test(id) ||
//       /src\/lib\/db\/index\.(js|ts|mjs|cjs)$/.test(id);

//     if (isDbModule) {
//       // Add some safety checks
//       const injectedCode = `
// // Cedar.js DB import tracker
// if (typeof globalThis !== 'undefined') {
//   globalThis.__cedarjs_db_imported__ = true;
// }

// ${code}`;

//       return {
//         code: injectedCode,
//         map: null
//       };
//     }

//     return null;
//   },
// }
