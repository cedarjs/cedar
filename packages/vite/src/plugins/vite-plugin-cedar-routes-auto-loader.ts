import fs from 'node:fs'
import path from 'node:path'

import type { Plugin } from 'vite'
import { normalizePath } from 'vite'

import type { PagesDependency } from '@cedarjs/project-config'
import {
  ensurePosixPath,
  getPaths,
  importStatementPath,
  processPagesDir,
  resolveFile,
} from '@cedarjs/project-config'

function getPathRelativeToSrc(maybeAbsolutePath: string): string {
  // Strip file extension upfront so explicit imports like
  // './pages/HomePage/HomePage.tsx' match discovered pages like './pages/HomePage/HomePage'
  const withoutExt = maybeAbsolutePath.replace(/\.[^/.]+$/, '')

  // Handle src/ bare specifiers (e.g. 'src/pages/FooPage').
  // When `forVite` is true, babel-plugin-module-resolver's src alias does not
  // run, so these specifiers arrive here unresolved. We resolve them via the
  // filesystem so that this auto-loader can correctly match and deregister
  // pages that have been explicitly imported by the user.
  if (withoutExt.startsWith('src/')) {
    const basePath = path.join(getPaths().web.base, withoutExt)

    const resolved =
      resolveFile(basePath) ||
      resolveFile(path.join(basePath, 'index')) ||
      resolveFile(path.join(basePath, path.basename(basePath)))

    if (resolved) {
      const resolvedWithoutExt = resolved.replace(/\.[^/.]+$/, '')
      return './' + path.relative(getPaths().web.src, resolvedWithoutExt)
    }

    // Fallback: should not happen in a well-formed project
    return './' + withoutExt.slice('src/'.length)
  }

  if (!path.isAbsolute(withoutExt)) {
    return withoutExt
  }

  return `./${path.relative(getPaths().web.src, withoutExt)}`
}

function withRelativeImports(page: PagesDependency) {
  return {
    ...page,
    relativeImport: ensurePosixPath(getPathRelativeToSrc(page.importPath)),
  }
}

/**
 * Vite plugin to auto-load page components into the Routes file.
 *
 * For each page found in `web/src/pages` that is not already explicitly
 * imported in Routes.tsx, this plugin prepends a lazy-loaded declaration:
 *
 * ```js
 * const PageName = {
 *   name: "PageName",
 *   prerenderLoader: (name) => ({ default: globalThis.__REDWOOD__PRERENDER_PAGES[name] }),
 *   LazyComponent: lazy(() => import("./pages/PageName/PageName")),
 * }
 * ```
 *
 * Pages already imported by App.tsx are also excluded to avoid Vite's
 * "dynamically imported by Routes.tsx but also statically imported by App.tsx"
 * warning.
 *
 * This replaces `babel-plugin-redwood-routes-auto-loader` for Vite builds.
 * The babel plugin is still used for Jest and prerender.
 */
export function cedarRoutesAutoLoaderPlugin(): Plugin {
  const routesFileId = normalizePath(getPaths().web.routes)

  // Check for duplicate page names upfront (same as babel plugin)
  const initialPages = processPagesDir().map(withRelativeImports)
  const duplicatePageImportNames = new Set<string>()
  const sortedPageImportNames = initialPages
    .map((page) => page.importName)
    .sort()
  for (let i = 0; i < sortedPageImportNames.length - 1; i++) {
    if (sortedPageImportNames[i + 1] === sortedPageImportNames[i]) {
      duplicatePageImportNames.add(sortedPageImportNames[i])
    }
  }
  if (duplicatePageImportNames.size > 0) {
    const pageNames = Array.from(duplicatePageImportNames)
      .map((name) => `'${name}'`)
      .join(', ')
    throw new Error(
      "Unable to find only a single file ending in 'Page.{js,jsx,ts,tsx}' in " +
        `the following page directories: ${pageNames}`,
    )
  }

  return {
    name: 'cedar-routes-auto-loader',

    transform(code, id) {
      if (normalizePath(id) !== routesFileId) {
        return null
      }

      let pages = processPagesDir().map(withRelativeImports)

      // De-register pages that are already statically imported in App.tsx.
      // Leaving them in would cause Vite to warn:
      // "dynamically imported by Routes.tsx but also statically imported by App.tsx
      //  – dynamic import will not move module into another chunk"
      const appPath = resolveFile(path.join(getPaths().web.src, 'App'))
      if (appPath) {
        const appSource = fs.readFileSync(appPath, 'utf8')
        // Match all import patterns:
        // - default: import Foo from
        // - named: import { Foo } from
        // - namespace: import * as Foo from
        // - composite: import Foo, { ... } from
        const appImportRe =
          /^import\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+(?:\s*,\s*\{[^}]*\})?)\s+from\s+['"]([^'"]+)['"]/gm
        let appMatch: RegExpExecArray | null
        while ((appMatch = appImportRe.exec(appSource)) !== null) {
          const rel = ensurePosixPath(
            getPathRelativeToSrc(importStatementPath(appMatch[1])),
          )
          pages = pages.filter((page) => page.relativeImport !== rel)
        }
      }

      // De-register pages that are already explicitly imported in Routes.tsx.
      // The user has opted in to a static (non-lazy) import for these.
      // Match all import patterns:
      // - default: import Foo from
      // - named: import { Foo } from
      // - namespace: import * as Foo from
      // - composite: import Foo, { ... } from
      const routesImportRe =
        /^import\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+(?:\s*,\s*\{[^}]*\})?)\s+from\s+['"]([^'"]+)['"]/gm
      let routesMatch: RegExpExecArray | null
      while ((routesMatch = routesImportRe.exec(code)) !== null) {
        const userImportRelativePath = ensurePosixPath(
          getPathRelativeToSrc(importStatementPath(routesMatch[1])),
        )
        pages = pages.filter(
          (page) => page.relativeImport !== userImportRelativePath,
        )
      }

      if (pages.length === 0) {
        return null
      }

      // Build the auto-loader declarations to prepend to the Routes file.
      const lines: string[] = [`import { lazy } from 'react'`]

      for (const { importName, relativeImport } of pages) {
        lines.push(
          `const ${importName} = {`,
          `  name: "${importName}",`,
          `  prerenderLoader: (name) => ({ default: globalThis.__REDWOOD__PRERENDER_PAGES[name] }),`,
          `  LazyComponent: lazy(() => import("${relativeImport}")),`,
          `}`,
        )
      }

      return {
        code: lines.join('\n') + '\n\n' + code,
        map: null,
      }
    },
  }
}
