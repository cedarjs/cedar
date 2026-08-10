import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { Listr } from 'listr2'

import { getPaths } from '@cedarjs/project-config'

import { writeFile } from '../../../lib/index.js'
import { getSchema } from '../../../lib/schemaHelpers.js'

const STUB_HASH_MARKER = '@cedar-generator-stub-hash'
const STUB_HASH_MARKER_REGEX = new RegExp(
  `^// ${STUB_HASH_MARKER} ([0-9a-f]+)$`,
  'm',
)

function stubHash(contents: string) {
  return crypto.createHash('sha256').update(contents).digest('hex').slice(0, 16)
}

/**
 * Prepends a header to a generated stub file explaining why it exists and how
 * to replace it. The header ends with a hash of the stub's contents, so that
 * we can later tell whether the user has edited the file (see `isPristineStub`)
 */
export function addStubHeader({
  content,
  stubModel,
  generatedFor,
}: {
  content: string
  stubModel: string
  generatedFor: string
}) {
  // The hash only covers what comes after the marker line, so that the header
  // itself isn't part of the hashed content
  const body = '\n\n' + content
  const header = [
    `// Generated as a read-only stub by \`cedar generate sdl ` +
      `${generatedFor}\`,`,
    `// because ${generatedFor} has a relation to ${stubModel}, which had ` +
      `no SDL yet.`,
    `// Run \`cedar generate sdl ${stubModel}\` to replace this stub with ` +
      `the real thing.`,
    `// If you edit this file, the hash below will stop matching and you'll`,
    `// need to pass \`--force\` to overwrite it.`,
    `// ${STUB_HASH_MARKER} ${stubHash(body)}`,
  ].join('\n')

  return header + body
}

/**
 * Returns true if `contents` is a generated stub that hasn't been edited
 * since it was generated
 */
export function isPristineStub(contents: string) {
  const match = STUB_HASH_MARKER_REGEX.exec(contents)

  if (!match) {
    return false
  }

  const body = contents.slice(match.index + match[0].length)

  return stubHash(body) === match[1]
}

function readExistingSdlFiles(): string[] {
  const graphqlDir = getPaths().api.graphql

  if (!fs.existsSync(graphqlDir)) {
    return []
  }

  const contents: string[] = []
  const dirsToWalk = [graphqlDir]

  while (dirsToWalk.length > 0) {
    const dir = dirsToWalk.shift()

    if (!dir) {
      break
    }

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        dirsToWalk.push(entryPath)
      } else if (/\.sdl\.(js|ts)$/.test(entry.name)) {
        contents.push(fs.readFileSync(entryPath, 'utf-8'))
      }
    }
  }

  return contents
}

/**
 * Returns the names of all models that `modelName` is related to, directly or
 * transitively, whose GraphQL types aren't defined in any existing SDL file.
 * Handles circular relations (e.g. Message ↔ User)
 */
export async function missingRelatedModels(
  modelName: string,
): Promise<string[]> {
  const existingSdls = readExistingSdlFiles()
  const isDefined = (typeName: string) =>
    existingSdls.some((sdl) =>
      new RegExp(`\\btype\\s+${typeName}\\b`).test(sdl),
    )

  const seen = new Set([modelName])
  const missing: string[] = []
  const queue = [modelName]

  while (queue.length > 0) {
    const current = queue.shift()

    if (!current) {
      break
    }

    const model = await getSchema(current)

    if (!model || !('fields' in model)) {
      continue
    }

    for (const field of model.fields) {
      // Only fields with a `relationName` are actual relations to other
      // models (`kind === 'object'` alone would also match Prisma composite
      // types, which aren't models)
      if (!field.relationName || seen.has(field.type)) {
        continue
      }

      seen.add(field.type)

      if (!isDefined(field.type)) {
        missing.push(field.type)
        queue.push(field.type)
      }
    }
  }

  return missing
}

/**
 * Like `writeFilesTask`, but existing files that are pristine generated stubs
 * (see `isPristineStub`) are overwritten without requiring `--force`
 */
export function writeFilesWithStubsTask(
  files: Record<string, string>,
  { overwriteExisting = false }: { overwriteExisting?: boolean } = {},
) {
  const { base } = getPaths()

  return new Listr(
    Object.entries(files).map(([file, contents]) => ({
      title: `...waiting to write file \`./${path.relative(base, file)}\`...`,
      task: (_ctx: unknown, task: { title?: string }) => {
        let canOverwrite = overwriteExisting

        if (!canOverwrite && fs.existsSync(file)) {
          const existingContents = fs.readFileSync(file, 'utf-8')

          if (isPristineStub(existingContents)) {
            canOverwrite = true
          } else if (STUB_HASH_MARKER_REGEX.test(existingContents)) {
            throw new Error(
              `${file} started out as a generated stub, but has since been ` +
                'edited. Use `--force` to overwrite it.',
            )
          }
        }

        return writeFile(
          file,
          contents,
          { overwriteExisting: canOverwrite },
          task,
        )
      },
    })),
  )
}
