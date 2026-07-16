import path from 'node:path'

import fg from 'fast-glob'

import { getPaths, importStatementPath } from '@cedarjs/project-config'

/**
 * Expands glob directory imports such as:
 *   import services from 'src/services/**\/*.{js,ts}'
 * into individual namespace imports:
 *   let services = {}
 *   import * as services_a from 'src/services/a'
 *   services.a = services_a
 *
 * This is the esbuild-path equivalent of:
 *   - babel-plugin-redwood-import-dir  (kept for Jest / console / data-migrate)
 *   - cedarImportDirPlugin             (Vite plugin, for Vite build paths)
 *
 * Code duplication between the two non-Babel plugins is intentional.
 *
 * Returns the transformed source code, or null if no glob imports were found.
 */
export function applyImportDir(code: string, filePath: string): string | null {
  if (!code.includes('**')) {
    return null
  }

  // Matches:  import <name> from '<source-with-**>'
  // Handles both single and double quotes; optional trailing semicolon.
  const GLOB_IMPORT_RE =
    /^import\s+(\w+)\s+from\s+['"]([^'"]*\*\*[^'"]*)['"]\s*;?/gm

  let hasTransformations = false

  const result = code.replace(
    GLOB_IMPORT_RE,
    (match: string, importName: string, sourceValue: string) => {
      const importGlob = importStatementPath(sourceValue)

      // If the glob starts with 'src/', resolve it relative to the api base
      // directory (mirrors the Vite plugin's behaviour).  Otherwise resolve
      // relative to the file being transformed.
      const cwd = importGlob.startsWith('src/')
        ? getPaths().api.base
        : path.dirname(filePath)

      let dirFiles: string[]
      try {
        dirFiles = fg
          .sync(importGlob, { cwd })
          .filter((n) => !n.includes('.test.'))
          .filter((n) => !n.includes('.scenarios.'))
          .filter((n) => !n.includes('.d.ts'))
      } catch {
        // If glob resolution fails, leave the import unchanged.
        return match
      }

      const staticGlob = importGlob.split('*')[0]
      const filePathToVarName = (fp: string) =>
        fp
          .replace(staticGlob, '')
          .replace(/\.(js|ts)$/, '')
          .replace(/[^a-zA-Z0-9]/g, '_')

      hasTransformations = true

      let replacement = `let ${importName} = {};\n`

      for (const fp of dirFiles) {
        const { dir: fileDir, name: fileName } = path.parse(fp)
        const varName = filePathToVarName(fp)
        const nsImport = `${importName}_${varName}`
        replacement += `import * as ${nsImport} from '${fileDir}/${fileName}';\n`
        replacement += `${importName}.${varName} = ${nsImport};\n`
      }

      return replacement.trimEnd()
    },
  )

  return hasTransformations ? result : null
}
