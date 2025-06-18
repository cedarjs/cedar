import fs from 'node:fs'
import path from 'node:path'

/** Match .mjs, .cts, .ts, .jsx etc */
export const JS_EXT_RE = /\.([mc]?[tj]s|[tj]sx)$/

export type RequireFunction = (
  outfile: string,
  ctx: { format: 'cjs' | 'esm' },
) => any

function getPkgType() {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve('package.json'), 'utf-8'),
    )

    return pkg.type
  } catch {
    // Ignore
  }

  return undefined
}

export function guessFormat(inputFile: string): 'esm' | 'cjs' {
  if (!usingDynamicImport) {
    return 'cjs'
  }

  const ext = path.extname(inputFile)
  const type = getPkgType()
  if (ext === '.js') {
    return type === 'module' ? 'esm' : 'cjs'
  } else if (ext === '.ts' || ext === '.mts') {
    return 'esm'
  } else if (ext === '.mjs') {
    return 'esm'
  }
  return 'cjs'
}

declare const jest: any

// Stolen from https://github.com/vitejs/vite/blob/0713446fa4df678422c84bd141b189a930c100e7/packages/vite/src/node/utils.ts#L606
export const usingDynamicImport = typeof jest === 'undefined'

/**
 * Dynamically import files.
 *
 * As a temporary workaround for Jest's lack of stable ESM support, we fallback to require
 * if we're in a Jest environment.
 * See https://github.com/vitejs/vite/pull/5197#issuecomment-938054077
 *
 * @param file File path to import.
 */
export const dynamicImport: RequireFunction = async (
  id: string,
  { format },
) => {
  const fn = format === 'esm' ? (file: string) => import(file) : require

  return fn(id)
}

export const getRandomId = () => {
  return Math.random().toString(36).substring(2, 15)
}

export function isValidJsFile(filepath: string) {
  return JS_EXT_RE.test(filepath)
}
