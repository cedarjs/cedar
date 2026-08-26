// @dependency: oxc-parser@0.144.0
import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'

import { parseSync, Visitor } from 'oxc-parser'

import { getPaths } from '@cedarjs/project-config'

const projectPaths = getPaths()
const projectRoot = projectPaths.base

// JSX is only compiled on the web side, and only in .jsx and .tsx files. The
// api side and scripts/ pick their esbuild loader from the file extension, so
// JSX in a .js file there has never built and there is nothing to detect
const webSrcPatterns = ['**/*.js']

const exclude = ['**/node_modules/**', '**/dist/**']

/**
 * Reports a problem that blocks the upgrade. Callers must also set
 * `shouldAbort`, which makes the script exit non-zero.
 *
 * Writes to stdout, even though this is an error. The CLI reads a failed
 * script's stdout into the message it shows the user (`preUpgradeScripts.ts`:
 * `errorOutput = e.stdout || e.message`) and only surfaces stderr under
 * `--verbose`, so anything written to stderr here would be invisible in the
 * default output.
 */
function fail(title: string, lines: string[]) {
  console.log(util.styleText('red', title) + '\n')

  for (const line of lines) {
    console.log(line + '\n')
  }
}

/**
 * Parses `code` as JSX and returns true if the AST contains a JSX element or
 * fragment. A file that doesn't parse as JSX is reported as not containing
 * JSX: a real JSX file with a syntax error fails the web build regardless of
 * its extension, and a plain JS file that happens to be ambiguous with JSX
 * must not block the upgrade.
 */
function containsJsx(filename: string, code: string) {
  let found = false

  try {
    const { program, errors } = parseSync(filename, code, { lang: 'jsx' })

    if (errors.length > 0) {
      return false
    }

    const visitor = new Visitor({
      JSXElement() {
        found = true
      },
      JSXFragment() {
        found = true
      },
    })

    visitor.visit(program)
  } catch {
    return false
  }

  return found
}

async function main() {
  // Set by any check that has found something the user must fix before
  // upgrading. Checked once at the end so every problem gets reported in one
  // pass, rather than the user fixing one and rerunning to find the next
  let shouldAbort = false

  const jsFilesWithJsx: string[] = []

  for await (const file of fs.promises.glob(webSrcPatterns, {
    cwd: projectPaths.web.src,
    exclude,
  })) {
    const filePath = path.join(projectPaths.web.src, file)
    const content = await fs.promises.readFile(filePath, 'utf8')

    if (containsJsx(filePath, content)) {
      jsFilesWithJsx.push(path.relative(projectRoot, filePath))
    }
  }

  if (jsFilesWithJsx.length > 0) {
    shouldAbort = true

    fail('JSX found in .js files', [
      'Found JSX in these .js files:\n' +
        jsFilesWithJsx.map((file) => '  ' + file).join('\n'),
      'Vite only compiles JSX in .jsx and .tsx files, so these files break\n' +
        'the web build. Rename each one to .jsx (imports do not need to\n' +
        'change, since Vite resolves the extension).',
    ])
  }

  if (shouldAbort) {
    // Set exitCode and return rather than calling process.exit() directly,
    // so pending stdout/stderr writes from the console.log/error calls above
    // aren't truncated before the process terminates.
    process.exitCode = 1
    return
  }
}

main()
