import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** Match .mjs, .cts, .ts, .jsx etc */
export const JS_EXT_RE = /\.([mc]?[tj]s|[tj]sx)$/

export type RequireFunction = (
  outfile: string,
  ctx: { format: 'cjs' | 'esm' },
) => any

export function getPkgType() {
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

export const getRandomId = () => {
  return Math.random().toString(36).substring(2, 15)
}

export function isValidJsFile(filepath: string) {
  return JS_EXT_RE.test(filepath)
}

/**
 * Converts a file path to a URL path (file://...)
 * Without this, absolute paths can't be imported on Windows
 */
export function makeFilePath(path: string) {
  return pathToFileURL(path).href
}
