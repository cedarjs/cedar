import fs from 'node:fs'
import path from 'node:path'

import MagicString from 'magic-string'
import type { SourceMap } from 'magic-string'

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
export function applyImportDir(
  code: string,
  filePath: string,
): { code: string; map?: SourceMap } | null {
  if (!code.includes('**')) {
    return null
  }

  // Matches:  import <name> from '<source-with-**>'
  // Handles both single and double quotes; optional trailing semicolon.
  const GLOB_IMPORT_RE =
    /^import\s+(\w+)\s+from\s+['"]([^'"]*\*\*[^'"]*)['"]\s*;?/gm

  const s = new MagicString(code)
  let hasTransformations = false

  for (const match of code.matchAll(GLOB_IMPORT_RE)) {
    const importName = match[1]
    const sourceValue = match[2]
    const importGlob = importStatementPath(sourceValue)

    // If the glob starts with 'src/', resolve it relative to the api base
    // directory (mirrors the Vite plugin's behaviour).  Otherwise resolve
    // relative to the file being transformed.
    const cwd = importGlob.startsWith('src/')
      ? getPaths().api.base
      : path.dirname(filePath)

    let dirFiles: string[]
    try {
      dirFiles = fs.globSync(importGlob, {
        cwd,
        exclude: (n) =>
          n.includes('.test.') ||
          n.includes('.scenarios.') ||
          n.includes('.d.ts'),
      })
    } catch {
      // If glob resolution fails, leave the import unchanged.
      continue
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

    s.overwrite(
      match.index,
      match.index + match[0].length,
      replacement.trimEnd(),
    )
  }

  return hasTransformations
    ? { code: s.toString(), map: s.generateMap({ hires: true }) }
    : null
}
