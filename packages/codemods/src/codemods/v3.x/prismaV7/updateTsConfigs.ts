import fs from 'node:fs'

export type UpdateTsConfigsResult = {
  api: 'skipped' | 'unmodified' | 'updated'
  scripts: 'skipped' | 'unmodified' | 'updated'
  web: 'skipped' | 'unmodified' | 'updated'
}

/**
 * Sets `"module": "node20"` in compilerOptions of a tsconfig source string.
 * If `"module"` already exists with any value, it will be overwritten.
 * If it does not exist, it will be inserted after `"target"` if that setting
 * exists, otherwise as the first property in compilerOptions.
 * Uses a string-based approach to preserve comments.
 *
 * Returns the transformed string, or the original if no change was needed.
 */
export function transformTsConfigModule(source: string): string {
  // If already set to node20, nothing to do
  if (/["']module["']\s*:\s*["']node20["']/i.test(source)) {
    return source
  }

  // Overwrite existing "module": "..." value
  const overwritten = source.replace(/("module"\s*:\s*)"[^"]*"/, '$1"node20"')

  if (overwritten !== source) {
    return overwritten
  }

  // Insert after "target": "..." if present
  const afterTarget = source.replace(
    /("target"\s*:\s*"[^"]*")(,?)(\s*\n)/,
    (match, prop, comma, ws) => {
      const lineStart = source.lastIndexOf('\n', source.indexOf(match)) + 1
      const indentMatch = source.slice(lineStart).match(/^([ \t]+)/)
      const indent = indentMatch ? indentMatch[1] : '    '
      const trailingComma = comma || ','
      return `${prop}${trailingComma}${ws}${indent}"module": "node20",\n`
    },
  )

  if (afterTarget !== source) {
    return afterTarget
  }

  // Last resort: insert as first property inside compilerOptions
  return source.replace(
    /("compilerOptions"\s*:\s*\{)(\s*\n)/,
    (match, open, ws) => {
      const lineStart = source.lastIndexOf('\n', source.indexOf(match)) + 1
      const indentMatch = source.slice(lineStart).match(/^([ \t]+)/)
      const outerIndent = indentMatch ? indentMatch[1] : '  '
      const innerIndent = outerIndent + '  '
      return `${open}${ws}${innerIndent}"module": "node20",\n`
    },
  )
}

/**
 * Adds `"allowImportingTsExtensions": true` to compilerOptions in a tsconfig
 * file. Uses a string-based approach so that any existing comments are
 * preserved (JSON.parse would strip them).
 *
 * Returns the transformed string, or the original if no change was needed.
 */
export function transformTsConfig(source: string): string {
  // Idempotency: already present
  if (/["']allowImportingTsExtensions["']/.test(source)) {
    return source
  }

  // Find `"moduleResolution": "..."` and insert after it.
  // If that's not present, fall back to inserting after `"module": "..."`.
  // If neither is present, insert as the first property in compilerOptions.
  const afterModuleResolution = source.replace(
    /("moduleResolution"\s*:\s*"[^"]*")(,?)(\s*\n)/,
    (match, prop, comma, ws) => {
      // Detect indentation from this line
      const lineStart = source.lastIndexOf('\n', source.indexOf(match)) + 1
      const indentMatch = source.slice(lineStart).match(/^([ \t]+)/)
      const indent = indentMatch ? indentMatch[1] : '    '
      const trailingComma = comma || ','
      return `${prop}${trailingComma}${ws}${indent}"allowImportingTsExtensions": true,\n`
    },
  )

  if (afterModuleResolution !== source) {
    return afterModuleResolution
  }

  // Fallback: insert after "module": "..."
  const afterModule = source.replace(
    /("module"\s*:\s*"[^"]*")(,?)(\s*\n)/,
    (match, prop, comma, ws) => {
      const lineStart = source.lastIndexOf('\n', source.indexOf(match)) + 1
      const indentMatch = source.slice(lineStart).match(/^([ \t]+)/)
      const indent = indentMatch ? indentMatch[1] : '    '
      const trailingComma = comma || ','
      return `${prop}${trailingComma}${ws}${indent}"allowImportingTsExtensions": true,\n`
    },
  )

  if (afterModule !== source) {
    return afterModule
  }

  // Last resort: insert as first property inside compilerOptions
  return source.replace(
    /("compilerOptions"\s*:\s*\{)(\s*\n)/,
    (match, open, ws) => {
      const lineStart = source.lastIndexOf('\n', source.indexOf(match)) + 1
      const indentMatch = source.slice(lineStart).match(/^([ \t]+)/)
      const outerIndent = indentMatch ? indentMatch[1] : '  '
      const innerIndent = outerIndent + '  '
      return `${open}${ws}${innerIndent}"allowImportingTsExtensions": true,\n`
    },
  )
}

export async function updateTsConfig(
  tsConfigPath: string,
): Promise<'skipped' | 'unmodified' | 'updated'> {
  if (!fs.existsSync(tsConfigPath)) {
    return 'skipped'
  }

  const source = fs.readFileSync(tsConfigPath, 'utf-8')

  if (/["']allowImportingTsExtensions["']/.test(source)) {
    return 'unmodified'
  }

  const transformed = transformTsConfig(source)

  if (transformed === source) {
    return 'unmodified'
  }

  fs.writeFileSync(tsConfigPath, transformed, 'utf-8')
  return 'updated'
}

export async function updateApiTsConfig(
  tsConfigPath: string,
): Promise<'skipped' | 'unmodified' | 'updated'> {
  if (!fs.existsSync(tsConfigPath)) {
    return 'skipped'
  }

  const source = fs.readFileSync(tsConfigPath, 'utf-8')

  // Apply allowImportingTsExtensions (skips internally if already present)
  const withExtensions = transformTsConfig(source)

  // Apply "module": "node20" (overwrites or inserts)
  const withModule = transformTsConfigModule(withExtensions)

  if (withModule === source) {
    return 'unmodified'
  }

  fs.writeFileSync(tsConfigPath, withModule, 'utf-8')
  return 'updated'
}

export async function updateTsConfigs(paths: {
  apiTsConfig: string
  scriptsTsConfig: string
  webTsConfig: string
}): Promise<UpdateTsConfigsResult> {
  const [api, scripts, web] = await Promise.all([
    updateApiTsConfig(paths.apiTsConfig),
    updateTsConfig(paths.scriptsTsConfig),
    updateTsConfig(paths.webTsConfig),
  ])

  return { api, scripts, web }
}
