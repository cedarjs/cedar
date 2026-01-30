#!/usr/bin/env node
/**
 * Diagnose broken package.json files in the repository.
 *
 * Usage:
 *   node .github/scripts/diagnose-package-json.mjs
 *
 * The script recursively searches for `package.json` files (ignoring
 * common build/test directories) and attempts to JSON.parse them.
 * For each file that fails to parse it prints:
 *  - the file path
 *  - the JSON.parse error message
 *  - file metadata (size, mtime)
 *  - a contexted view of the file with line numbers
 *
 * This script is intended to be used as a CI diagnostic step after
 * a build failure so we can capture the exact broken `package.json`.
 */

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.yarn',
  '.cache',
  'dist',
  'tarballs',
  '__fixtures__',
  '__mocks__',
  '__tests__',
  '.nx',
])

/**
 * Recursively find package.json files starting from `root`.
 * Avoid walking into directories listed in IGNORED_DIRS.
 */
function findPackageJsons(root) {
  const results = []
  const stack = [root]

  while (stack.length > 0) {
    const current = stack.pop()
    let entries = []
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch (err) {
      // Skip unreadable directories
      continue
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) {
          continue
        }
        stack.push(path.join(current, entry.name))
      } else if (entry.isFile() && entry.name === 'package.json') {
        results.push(path.join(current, entry.name))
      }
    }
  }

  return results
}

/**
 * Print file content with line numbers and an optional highlight line.
 * Limits the output to reasonable amount of context to keep logs readable.
 */
function printFileWithContext(filePath, content, highlightLine = null) {
  const MAX_LINES = 500 // Hard limit to avoid huge logs
  const lines = content.split(/\r?\n/)
  const totalLines = Math.min(lines.length, MAX_LINES)

  const contextRadius = 6

  let start = 0
  let end = totalLines

  if (highlightLine !== null) {
    const idx = Math.max(0, highlightLine - 1)
    start = Math.max(0, idx - contextRadius)
    end = Math.min(totalLines, idx + contextRadius + 1)
  } else if (totalLines > 200) {
    // If very large file, show the head and tail
    end = 120
  }

  console.error(`---- START ${filePath} (lines ${start + 1}-${end}) ----`)
  for (let i = start; i < end; i += 1) {
    const lineNo = String(i + 1).padStart(5)
    const prefix =
      highlightLine !== null && i + 1 === highlightLine ? '>>' : '  '
    const line = lines[i] ?? ''
    // Print tab as two spaces to avoid strange spacing in CI logs
    console.error(`${prefix} ${lineNo} | ${line.replace(/\t/g, '  ')}`)
  }
  if (lines.length > MAX_LINES) {
    console.error(
      `... (file has ${lines.length} lines; truncated to ${MAX_LINES} lines)`,
    )
  } else if (totalLines !== lines.length) {
    console.error(`... (showing first ${totalLines} lines)`)
  }
  console.error(`----  END ${filePath} ----`)
}

/**
 * Try to extract a line number from a JSON parse error message.
 * Many implementations include something like "(line 71 column 1)" or
 * "position 1904 (line 71 column 1)".
 */
function extractLineFromErrorMessage(msg) {
  if (typeof msg !== 'string') {
    return null
  }
  // Match "line 71" or "line 71 column 1" or "position 1904 (line 71 column 1)"
  const m = msg.match(/line\s+(\d+)/i)
  if (m && m[1]) {
    return parseInt(m[1], 10)
  }
  // Some errors only include "position 1904". We could convert position to line
  // by counting newlines up to that char, but we don't rely on that here.
  return null
}

function humanSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/**
 * Main
 */
function main() {
  const repoRoot = process.cwd()

  console.error('🚨 Running package.json diagnostics')
  console.error(`Repository root: ${repoRoot}`)

  // Try to print git info if available
  try {
    const head = execSync('git rev-parse HEAD', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim()
    console.error(`Git HEAD: ${head}`)
    const status = execSync('git status --porcelain -uall', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim()
    if (status) {
      console.error('Git status (porcelain):')
      console.error(status)
    } else {
      console.error('Git status: clean')
    }
  } catch (err) {
    // Not a git repo or git not available; that's OK
  }

  // Find package.json files
  const candidateRoots = [repoRoot]
  // Also explicitly include `packages` if it exists to bias search
  if (fs.existsSync(path.join(repoRoot, 'packages'))) {
    candidateRoots.unshift(path.join(repoRoot, 'packages'))
  }

  const packageJsonFiles = new Set()
  for (const r of candidateRoots) {
    const found = findPackageJsons(r)
    for (const f of found) {
      packageJsonFiles.add(f)
    }
  }

  // Ensure we always check the top-level package.json
  packageJsonFiles.add(path.join(repoRoot, 'package.json'))

  const broken = []

  for (const filePath of Array.from(packageJsonFiles).sort()) {
    let content = ''
    try {
      content = fs.readFileSync(filePath, 'utf8')
    } catch (err) {
      // Skip unreadable files
      console.error(
        `⚠️  Could not read ${filePath}: ${err && err.message ? err.message : String(err)}`,
      )
      continue
    }

    try {
      // Try parse
      JSON.parse(content)
    } catch (err) {
      // Gather information about the break
      let stat = null
      try {
        stat = fs.statSync(filePath)
      } catch (_) {
        // ignore
      }
      broken.push({
        filePath,
        message: err && err.message ? err.message : String(err),
        size: stat ? stat.size : null,
        mtime: stat ? stat.mtime.toISOString() : null,
        content,
      })
    }
  }

  if (broken.length === 0) {
    console.error('✅ No broken package.json files found')
    process.exit(0)
  }

  console.error(
    `❌ Found ${broken.length} broken package.json file(s). Printing details:`,
  )

  for (const b of broken) {
    console.error('')
    console.error(`File: ${b.filePath}`)
    console.error(`Error: ${b.message}`)
    if (b.size !== null) {
      console.error(`Size: ${humanSize(b.size)} (${b.size} bytes)`)
    }
    if (b.mtime !== null) {
      console.error(`MTime: ${b.mtime}`)
    }

    // Try to locate line number from the error message
    const lineNumber = extractLineFromErrorMessage(b.message)
    if (lineNumber !== null) {
      console.error(`Detected error line: ${lineNumber}`)
    } else {
      console.error(
        'No line number detected in error message; showing context instead',
      )
    }

    // Print contexted file view
    try {
      printFileWithContext(b.filePath, b.content, lineNumber)
    } catch (err) {
      console.error(
        `Failed to print file context for ${b.filePath}: ${String(err)}`,
      )
    }

    // Suggest next steps
    console.error(
      'Hint: Inspect the printed lines above, especially near the reported line.',
    )
    console.error(
      'If the issue seems transient, it may be due to a concurrent writer on CI.',
    )
    console.error(
      'Consider re-running the job, or adding additional logging to capture the file at the moment of failure.',
    )
  }

  // We exit non-zero to indicate diagnostics found problems.
  process.exit(1)
}

main()
