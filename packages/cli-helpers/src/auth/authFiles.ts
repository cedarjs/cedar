import fs from 'node:fs'
import path from 'path'

import pascalcase from 'pascalcase'

import { transformTSToJS } from '../lib/index.js'
import { getPaths } from '../lib/paths.js'
import { isTypeScriptProject } from '../lib/project.js'

interface FilesArgs {
  basedir: string
  webAuthn: boolean
  /**
   * Selects the `*.oauth.*` template variant, the same way `webAuthn` selects
   * the `*.webAuthn.*` variant. When both are true, the most specific
   * template available is preferred (`*.webAuthn.oauth.*`), falling back to
   * a single-variant or the base template when a more specific one doesn't
   * exist for a given template file.
   */
  oauth?: boolean
}

/**
 * The recognized variant tags a template file name can carry between its
 * base name and its `<ext>.template` suffix, e.g. `auth.webAuthn.oauth.ts.template`
 * has tags `['webAuthn', 'oauth']`.
 */
const VARIANT_TAGS = ['webAuthn', 'oauth']

interface TemplateVariant {
  fileName: string
  tags: string[]
}

/**
 * Splits a template file name into its base name, variant tags, and
 * extension, e.g. `auth.webAuthn.oauth.ts.template` becomes
 * `{ baseName: 'auth', tags: ['webAuthn', 'oauth'], ext: 'ts' }`.
 */
function parseTemplateFileName(fileName: string) {
  const parts = fileName.split('.')
  const baseName = parts[0]
  const ext = parts.at(-2)
  const tags = parts.slice(1, -2).filter((part) => VARIANT_TAGS.includes(part))

  return { baseName, tags, ext }
}

/**
 * For every distinct (base name + extension) template in `templateFiles`,
 * picks the most specific variant whose tags are all present in
 * `activeTags`, falling back to the base template (no tags) when no more
 * specific variant applies.
 */
function pickTemplateVariants(templateFiles: string[], activeTags: string[]) {
  const candidatesByKey = new Map<string, TemplateVariant[]>()

  for (const fileName of templateFiles) {
    const { baseName, tags, ext } = parseTemplateFileName(fileName)
    const key = `${baseName}.${ext}`

    const candidates = candidatesByKey.get(key) ?? []
    candidates.push({ fileName, tags })
    candidatesByKey.set(key, candidates)
  }

  const picked: TemplateVariant[] = []

  for (const candidates of candidatesByKey.values()) {
    const applicable = candidates.filter((candidate) =>
      candidate.tags.every((tag) => activeTags.includes(tag)),
    )

    const mostSpecific = applicable.reduce((best, candidate) =>
      candidate.tags.length > best.tags.length ? candidate : best,
    )

    picked.push(mostSpecific)
  }

  return picked
}

/**
 * Get the api side file paths and file contents to write
 *
 * Example return value:
 * ```json
 * {
 *   "/Users/tobbe/dev/rw-app/api/src/lib/auth.ts": "<file content>",
 *   "/Users/tobbe/dev/rw-app/api/src/lib/helperFunctions.ts": "<file content>",
 *   "/Users/tobbe/dev/rw-app/api/src/functions/auth.ts": "<file content>"
 * }
 * ```
 */
export const apiSideFiles = async ({
  basedir,
  webAuthn,
  oauth = false,
}: FilesArgs) => {
  const apiSrcPath = getPaths().api.src
  const apiBaseTemplatePath = path.join(basedir, 'templates', 'api')
  const templateDirectories = fs.readdirSync(apiBaseTemplatePath)

  let filesRecord: Record<string, string> = {}

  const activeTags = [
    ...(webAuthn ? ['webAuthn'] : []),
    ...(oauth ? ['oauth'] : []),
  ]

  for (const dir of templateDirectories) {
    const templateFiles = fs.readdirSync(path.join(apiBaseTemplatePath, dir))
    const pickedVariants = pickTemplateVariants(templateFiles, activeTags)

    const filePaths = pickedVariants.map(({ fileName }) => {
      const { baseName, ext } = parseTemplateFileName(fileName)
      // remove "template" from the end, and change from {ts,tsx} to
      // {js,jsx} for JavaScript projects
      let outputFileName = `${baseName}.${ext}`
      if (!isTypeScriptProject()) {
        outputFileName = outputFileName.replace(/\.ts(x?)$/, '.js$1')
      }

      const templateFilePath = path.join(apiBaseTemplatePath, dir, fileName)
      const outputFilePath = path.join(apiSrcPath, dir, outputFileName)

      return { templateFilePath, outputFilePath }
    })

    for (const paths of filePaths) {
      const content = fs.readFileSync(paths.templateFilePath, 'utf8')

      filesRecord = {
        ...filesRecord,
        [paths.outputFilePath]: isTypeScriptProject()
          ? content
          : await transformTSToJS(paths.outputFilePath, content),
      }
    }
  }

  return filesRecord
}

/**
 * Loops through the keys in `filesRecord` and generates unique file paths if
 * they conflict with existing files
 *
 * Given this input:
 * ```json
 * {
 *   "/Users/tobbe/dev/rw-app/api/src/lib/auth.ts": "<file content>",
 *   "/Users/tobbe/dev/rw-app/api/src/lib/helperFunctions.ts": "<file content>",
 *   "/Users/tobbe/dev/rw-app/api/src/lib/supertokens.ts": "<file content>",
 *   "/Users/tobbe/dev/rw-app/api/src/functions/auth.ts": "<file content>"
 * }
 * ```
 *
 * You could get this output, depending on what existing files there are
 * ```json
 * {
 *   "/Users/tobbe/dev/rw-app/api/src/lib/supertokensAuth3.ts": "<file content>",
 *   "/Users/tobbe/dev/rw-app/api/src/lib/supertokensHelperFunctions.ts": "<file content>",
 *   "/Users/tobbe/dev/rw-app/api/src/lib/supertokens2.ts": "<file content>",
 *   "/Users/tobbe/dev/rw-app/api/src/functions/auth.ts": "<file content>"
 * }
 * ```
 */
export function generateUniqueFileNames(
  filesRecord: Record<string, string>,
  provider: string,
) {
  const newFilesRecord: Record<string, string> = {}

  Object.keys(filesRecord).forEach((fullPath) => {
    let newFullPath = fullPath
    let i = 1
    while (fs.existsSync(newFullPath)) {
      const nameParts = path.basename(fullPath).split('.')

      if (nameParts[0] === provider) {
        // api/lib/supertokens.ts -> api/lib/supertokens2.ts

        const newFileName =
          provider + (i + 1) + '.' + nameParts.slice(1).join('.')

        newFullPath = path.join(path.dirname(fullPath), newFileName)
      } else {
        // api/lib/auth.ts -> api/lib/supertokensAuth.ts
        // (potentially) -> api/lib/supertokensAuth2.ts depending on what
        // files already exists
        const count = i > 1 ? i : ''

        const newFileName =
          provider +
          pascalcase(nameParts[0]) +
          count +
          '.' +
          nameParts.slice(1).join('.')

        newFullPath = path.join(path.dirname(fullPath), newFileName)
      }

      i++
    }

    newFilesRecord[newFullPath] = filesRecord[fullPath]
  })

  return newFilesRecord
}
