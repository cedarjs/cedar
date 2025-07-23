import path from 'path'

import { createFilter } from '@rollup/pluginutils'
import type { Plugin } from 'rollup'

import type { PagesDependency } from '@cedarjs/project-config'
import {
  ensurePosixPath,
  getPaths,
  importStatementPath,
  processPagesDir,
} from '@cedarjs/project-config'

export interface PluginOptions {
  forPrerender?: boolean
}

// When running from the CLI another plugin in the pipeline will convert:
// - For dev, build and prerender (forJest === false):
//   'src/pages/ExamplePage' -> './pages/ExamplePage'
// - For test (forJest === true):
//   'src/pages/ExamplePage' -> '/Users/blah/pathToProject/web/src/pages/ExamplePage'
function getPathRelativeToSrc(maybeAbsolutePath: string) {
  // If the path is already relative
  if (!path.isAbsolute(maybeAbsolutePath)) {
    return maybeAbsolutePath
  }

  return `./${path.relative(getPaths().web.src, maybeAbsolutePath)}`
}

function withRelativeImports(page: PagesDependency) {
  return {
    ...page,
    relativeImport: ensurePosixPath(getPathRelativeToSrc(page.importPath)),
  }
}

function prerenderLoaderImpl(forPrerender: boolean, relativeImport: string) {
  if (forPrerender) {
    return `{
      const chunkId = './${relativeImport.split('/').at(-1)}-__PRERENDER_CHUNK_ID.js';
      return require(chunkId);
    }`
  }

  // This code will be output when building the web side (i.e. not when
  // prerendering)
  // active-route-loader will use this code for auto-imported pages, for the
  // first load of a prerendered page
  // Manually imported pages will be bundled in the main bundle and will be
  // loaded by the code in `normalizePage` in util.ts
  return `({
    default: globalThis.__REDWOOD__PRERENDER_PAGES[name]
  })`
}

export function cedarjsRoutesAutoLoaderPlugin({
  forPrerender = false,
}: PluginOptions = {}): Plugin {
  // @NOTE: This var gets mutated inside the transform function
  let pages = processPagesDir().map(withRelativeImports)

  // Currently processPagesDir() can return duplicate entries when there are
  // multiple files ending in Page in the individual page directories. This will
  // cause an error upstream. Here we check for duplicates and throw a more
  // helpful error message.
  const duplicatePageImportNames = new Set<string>()
  const sortedPageImportNames = pages.map((page) => page.importName).sort()
  for (let i = 0; i < sortedPageImportNames.length - 1; i++) {
    if (sortedPageImportNames[i + 1] === sortedPageImportNames[i]) {
      duplicatePageImportNames.add(sortedPageImportNames[i])
    }
  }
  if (duplicatePageImportNames.size > 0) {
    const dirList = Array.from(duplicatePageImportNames)
      .map((name) => `'${name}'`)
      .join(', ')
    throw new Error(
      "Unable to find only a single file ending in 'Page.{js,jsx,ts,tsx}' in " +
        `the following page directories: ${dirList}`,
    )
  }

  const filter = createFilter(['**/Routes.{tsx,jsx,js,ts}'])

  return {
    name: 'cedarjs-routes-auto-loader',

    buildStart() {
      // Refresh pages list at build start
      pages = processPagesDir().map(withRelativeImports)
    },

    transform(code: string, id: string) {
      if (!filter(id)) {
        return null
      }

      // Reset pages for each transform
      let currentPages = [...pages]

      // Parse existing imports to remove explicitly imported pages
      const importRegex = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g
      let match: RegExpExecArray | null
      const excludedPages = new Set<string>()

      while ((match = importRegex.exec(code)) !== null) {
        const [_fullMatch, defaultImportName, importPath] = match

        // For explicitly imported pages we need to check both formats:
        // 'src/pages/FooPage' and 'src/pages/FooPage/FooPage'

        // Remove the file extension
        const importPathWithoutExtension = importPath.replace(
          /\.(js|jsx|ts|tsx)$/,
          '',
        )

        // Check for the page with or without the trailing directory component
        const normalizedPathBase = importPathWithoutExtension.replace(
          /\/[^/]+$/,
          '',
        )
        const normalizedPathFull = importPathWithoutExtension

        const userImportRelativePaths = [
          getPathRelativeToSrc(importStatementPath(normalizedPathBase)),
          getPathRelativeToSrc(importStatementPath(normalizedPathFull)),
        ]

        // Find if this is a page that was auto-discovered
        const pageThatUserImported = currentPages.find((page) => {
          const pageRelativeImport = page.relativeImport.replace(
            /\.(js|jsx|ts|tsx)$/,
            '',
          )
          const importNameMatches = page.importName === defaultImportName
          const pathMatches = userImportRelativePaths.some(
            (path) =>
              pageRelativeImport === ensurePosixPath(path) ||
              pageRelativeImport.endsWith(`/${path.split('/').pop()}`),
          )

          // Match either by import name or by path
          return importNameMatches || pathMatches
        })

        if (pageThatUserImported) {
          // if (forPrerender) {
          //   // Update the import name with the user's import name
          //   // So that the JSX name stays consistent
          //   pageThatUserImported.importName = defaultImportName

          //   // Remove the import statement from the code
          //   modifiedCode = modifiedCode.replace(fullMatch, '')
          // }

          // Always remove the page from currentPages list if it's explicitly
          // imported so that we don't add loaders for these pages
          excludedPages.add(pageThatUserImported.importName)
          currentPages = currentPages.filter(
            (page) => page !== pageThatUserImported,
          )
        }
      }

      if (currentPages.length === 0) {
        return { code, map: null }
      }

      // Generate the auto-loader code
      const imports: string[] = []
      const declarations: string[] = []

      // Add "import { lazy } from 'react'"
      imports.push(`import { lazy } from 'react'`)

      // Generate declarations for each page
      for (const { importName, relativeImport } of currentPages) {
        // Skip any explicitly imported pages
        if (importName === 'FooPage' || excludedPages.has(importName)) {
          continue
        }

        const declaration = `const ${importName} = {
  name: "${importName}",
  prerenderLoader: (name) => ${prerenderLoaderImpl(forPrerender, relativeImport)},
  LazyComponent: lazy(() => import("${relativeImport}"))
}`
        declarations.push(declaration)
      }

      // Prepend the imports and declarations to the code
      const autoLoaderCode = [...imports, ...declarations].join('\n\n')
      const finalCode = `${autoLoaderCode}\n\n${code}`

      return {
        code: finalCode,
        map: null,
      }
    },
  }
}
