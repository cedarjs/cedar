import fs from 'node:fs'
import path from 'node:path'

import { Listr } from 'listr2'

import {
  colors as c,
  getPaths,
  isTypeScriptProject,
  recordTelemetryAttributes,
} from '@cedarjs/cli-helpers'
import { errorTelemetry } from '@cedarjs/telemetry'

// @ts-expect-error - No types for JS files
import { printSetupNotes } from '../../../../lib/index.js'

export interface Args {
  force: boolean
}

const notes = [
  'Universal Deploy is set up!',
  '',
  'Next steps:',
  `  ${c.highlight('yarn cedar build --ud')} — build the Universal Deploy server entry`,
  `  ${c.highlight('yarn cedar serve --ud')} — serve it locally`,
]

export async function handler({ force }: Args) {
  recordTelemetryAttributes({
    command: 'setup deploy universal-deploy',
  })

  const tasks = new Listr(
    [
      addUniversalDeployPluginToViteConfig({
        overwriteExisting: force,
      }),
      printSetupNotes(notes),
    ],
    {
      rendererOptions: { collapseSubtasks: false },
    },
  )

  try {
    await tasks.run()
  } catch (e) {
    errorTelemetry(process.argv, (e as Error).message)
    console.error(c.error((e as Error).message))
    process.exit((e as { exitCode?: number }).exitCode || 1)
  }
}

function addUniversalDeployPluginToViteConfig({
  overwriteExisting = false,
}: { overwriteExisting?: boolean } = {}) {
  return {
    title: 'Adding cedarUniversalDeployPlugin to vite config...',
    task: async (_ctx: unknown, task: { skip: (msg: string) => void }) => {
      const projectIsTS = isTypeScriptProject()
      const viteConfigPath = path.join(
        getPaths().web.base,
        `vite.config.${projectIsTS ? 'ts' : 'js'}`,
      )

      if (!fs.existsSync(viteConfigPath)) {
        task.skip(`${viteConfigPath} not found`)
        return
      }

      let content = fs.readFileSync(viteConfigPath, 'utf-8')

      if (content.includes('cedarUniversalDeployPlugin')) {
        if (overwriteExisting) {
          content = content
            .replace(/,\s*cedarUniversalDeployPlugin\s*\(\s*\)/g, '')
            .replace(/cedarUniversalDeployPlugin\s*\(\s*\),\s*/g, '')
            .replace(
              /^import\s*\{\s*[^}]*cedarUniversalDeployPlugin[^}]*\}\s*from\s*['"]@cedarjs\/vite['"];?\s*\n?/gm,
              '',
            )
            .replace(/\n{3,}/g, '\n\n')
        } else {
          task.skip('cedarUniversalDeployPlugin is already configured.')
          return
        }
      }

      content = mergeImport(content)
      content = addPluginToConfig(content)

      fs.writeFileSync(viteConfigPath, content)
    },
  }
}

function findCedarViteImportLine(lines: string[]): number {
  // First look for a line that has both "import" and "from '@cedarjs/vite'"
  for (let i = 0; i < lines.length; i++) {
    if (
      /^import\b/.test(lines[i]) &&
      /from\s+['"]@cedarjs\/vite['"]/.test(lines[i])
    ) {
      return i
    }
  }

  // Then look for a continuation line like "} from '@cedarjs/vite'"
  for (let i = 0; i < lines.length; i++) {
    if (/from\s+['"]@cedarjs\/vite['"]/.test(lines[i])) {
      // Walk backwards to find the "import" line
      for (let j = i; j >= 0; j--) {
        if (/^import\b/.test(lines[j])) {
          return j
        }
      }

      return i
    }
  }

  return -1
}

export function mergeImport(content: string): string {
  const lines = content.split('\n')
  const importIndex = findCedarViteImportLine(lines)

  if (importIndex === -1) {
    // No import from @cedarjs/vite — add both cedar and the UD plugin

    throw new Error('No import from @cedarjs/vite found')
  }

  const importLine = lines[importIndex]

  // Single-line named import: import { cedar } from '@cedarjs/vite'
  const singleLineNamed = importLine.match(
    /^(import\s*\{\s*)([^}]*?)(\s*\}\s*from\s+['"]@cedarjs\/vite['"];?)$/,
  )

  if (singleLineNamed) {
    const specifiers = singleLineNamed[2].trim()

    if (specifiers.includes('cedarUniversalDeployPlugin')) {
      return content
    }

    lines[importIndex] = specifiers
      ? `${singleLineNamed[1]}${specifiers}, cedarUniversalDeployPlugin${singleLineNamed[3]}`
      : `${singleLineNamed[1]}cedarUniversalDeployPlugin${singleLineNamed[3]}`

    return lines.join('\n')
  }

  // Multiline named import lines could be:
  //   import {
  //     cedar,
  //   } from '@cedarjs/vite'
  // Find the closing line
  let closeIndex = importIndex

  for (let i = importIndex + 1; i < lines.length; i++) {
    if (/}\s*from\s+['"]@cedarjs\/vite['"]/.test(lines[i])) {
      closeIndex = i
      break
    }
  }

  if (closeIndex > importIndex) {
    const specifiersLines = lines.slice(importIndex + 1, closeIndex)
    const allSpecifiers = specifiersLines.join(' ')

    if (allSpecifiers.includes('cedarUniversalDeployPlugin')) {
      return content
    }

    const indentMatch = specifiersLines[0]?.match(/^(\s+)/)
    const indent = indentMatch?.[1] || '  '
    lines.splice(closeIndex, 0, `${indent}cedarUniversalDeployPlugin,`)

    return lines.join('\n')
  }

  // Default import: import cedar from '@cedarjs/vite'
  const defaultMatch = importLine.match(
    /^import\s+(\w+)\s+from\s+['"]@cedarjs\/vite['"];?\s*$/,
  )

  if (defaultMatch) {
    // $2 includes the leading space, so no extra space before it
    lines[importIndex] = importLine.replace(
      /(import\s+\w+)(\s+from\s+['"]@cedarjs\/vite['"];?)/,
      '$1, { cedarUniversalDeployPlugin }$2',
    )

    return lines.join('\n')
  }

  return content
}

export function addPluginToConfig(content: string): string {
  const lines = content.split('\n')

  const pluginsLineIndex = lines.findIndex((line) =>
    /plugins\s*:\s*\[/.test(line),
  )

  if (pluginsLineIndex === -1) {
    return content
  }

  const pluginsLine = lines[pluginsLineIndex]

  // Inline case: plugins: [cedar()],
  const inlineMatch = pluginsLine
    .trim()
    .match(/^plugins\s*:\s*\[([\s\S]*?)\]\s*,?\s*$/)

  if (inlineMatch) {
    const inner = inlineMatch[1].trimEnd()
    const indentation = pluginsLine.match(/^\s*/)?.[0] || '  '

    lines[pluginsLineIndex] = inner
      ? `${indentation}plugins: [${inner}, cedarUniversalDeployPlugin()],`
      : `${indentation}plugins: [cedarUniversalDeployPlugin()],`
    return lines.join('\n')
  }

  // Multi-line case — first find the closing ]
  let closeIndex = -1

  for (let i = pluginsLineIndex + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (trimmed === ']' || trimmed === '],') {
      closeIndex = i
      break
    }
  }

  if (closeIndex === -1) {
    return content
  }

  const pluginsLineIndent = pluginsLine.match(/^\s*/)?.[0] || ''

  // Determine the indentation from the first entry (between plugins: [ and ])
  const firstEntryIndent = (() => {
    for (let i = pluginsLineIndex + 1; i < closeIndex; i++) {
      const trimmed = lines[i].trim()

      if (trimmed) {
        return lines[i].match(/^\s*/)?.[0] || '  '
      }
    }

    return pluginsLineIndent + '  '
  })()

  const prevLine = lines[closeIndex - 1]?.trimEnd()

  if (
    prevLine &&
    !prevLine.endsWith(',') &&
    prevLine !== '[' &&
    !prevLine.endsWith('[')
  ) {
    const commentIdx = prevLine.search(/\s+\/\/|(?<!\\)\/\*/)

    if (commentIdx !== -1) {
      lines[closeIndex - 1] =
        prevLine.slice(0, commentIdx) + ',' + prevLine.slice(commentIdx)
    } else {
      lines[closeIndex - 1] = prevLine + ','
    }
  }

  lines.splice(
    closeIndex,
    0,
    `${firstEntryIndent}cedarUniversalDeployPlugin(),`,
  )

  return lines.join('\n')
}
