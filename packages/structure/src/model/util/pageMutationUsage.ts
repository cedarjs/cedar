import fs from 'node:fs'
import path from 'node:path'

import { Kind, OperationTypeNode, parse as parseGraphQL } from 'graphql'
import * as tsm from 'ts-morph'

import { createTSMSourceFile_cached } from '../../x/ts-morph.js'
import type { RWProject } from '../RWProject.js'

/**
 * File extensions (in resolution order) tried when an import specifier
 * doesn't include one, mirroring typical Metro/webpack/vite resolution.
 */
const RESOLVE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js']

/**
 * Per-project cache of "mutation root field names found directly in this
 * file" (i.e. not counting fields found in imported files). Many pages
 * share the same components (e.g. a shared `<Form>` or layout), so caching
 * per file - rather than per page - avoids re-parsing the same file many
 * times when checking many routes.
 */
const fileMutationFieldsCache = new WeakMap<
  RWProject,
  Map<string, Set<string>>
>()

/**
 * Transitively walks the static imports reachable from `entryFilePath`
 * (typically a page's file path) and collects the names of GraphQL mutation
 * root fields used anywhere in that import graph, via `gql`/`graphql`
 * tagged template literals.
 *
 * This is a best-effort, syntactic analysis: it does not resolve TypeScript
 * path aliases beyond the `src/` -> `web/src/` convention, does not follow
 * re-exports (`export * from './x'`), and skips any GraphQL document it
 * can't parse (e.g. ones mangled by interpolation).
 *
 * @returns a map of mutation root field name -> the first file path (inside
 * `web/src`) in which a `gql`/`graphql` document using that mutation was
 * found.
 */
export function getMutationFieldsUsedTransitively(
  project: RWProject,
  entryFilePath: string,
): Map<string, string> {
  const usedIn = new Map<string, string>()
  const visited = new Set<string>()
  const queue = [path.normalize(entryFilePath)]

  while (queue.length > 0) {
    // Guaranteed defined: the loop condition checked queue.length > 0
    const filePath = queue.shift() as string

    if (visited.has(filePath)) {
      continue
    }
    visited.add(filePath)

    for (const fieldName of getMutationFieldNamesForFile(project, filePath)) {
      if (!usedIn.has(fieldName)) {
        usedIn.set(fieldName, filePath)
      }
    }

    for (const importedFilePath of resolveImportedFilePaths(
      project,
      filePath,
    )) {
      if (!visited.has(importedFilePath)) {
        queue.push(importedFilePath)
      }
    }
  }

  return usedIn
}

/**
 * Returns (and caches at the project level) the mutation root field names
 * used directly within `filePath`, i.e. not counting any imported files.
 */
function getMutationFieldNamesForFile(
  project: RWProject,
  filePath: string,
): Set<string> {
  let cache = fileMutationFieldsCache.get(project)
  if (!cache) {
    cache = new Map()
    fileMutationFieldsCache.set(project, cache)
  }

  const cached = cache.get(filePath)
  if (cached) {
    return cached
  }

  const fieldNames = extractMutationFieldNames(filePath)
  cache.set(filePath, fieldNames)
  return fieldNames
}

/**
 * Parses `filePath` and extracts the top-level selection-set field names of
 * every `mutation` operation defined in a `gql`/`graphql` tagged template
 * literal within it.
 */
function extractMutationFieldNames(filePath: string): Set<string> {
  const fieldNames = new Set<string>()

  const sf = readSourceFile(filePath)
  if (!sf) {
    return fieldNames
  }

  for (const tagged of sf.getDescendantsOfKind(
    tsm.SyntaxKind.TaggedTemplateExpression,
  )) {
    const tag = tagged.getTag()
    if (!tsm.Node.isIdentifier(tag)) {
      continue
    }
    if (tag.getText() !== 'gql' && tag.getText() !== 'graphql') {
      continue
    }

    const documentText = TemplateLiteral_toStaticText(tagged.getTemplate())
    if (!documentText) {
      continue
    }

    try {
      const document = parseGraphQL(documentText)
      for (const definition of document.definitions) {
        if (
          definition.kind !== Kind.OPERATION_DEFINITION ||
          definition.operation !== OperationTypeNode.MUTATION
        ) {
          continue
        }
        for (const selection of definition.selectionSet.selections) {
          if (selection.kind === Kind.FIELD) {
            fieldNames.add(selection.name.value)
          }
        }
      }
    } catch {
      // Best-effort: skip documents we can't parse (e.g. ones mangled by
      // interpolation) rather than failing the whole analysis.
      continue
    }
  }

  return fieldNames
}

/**
 * Extracts the static text of a template literal. For templates with
 * substitutions (e.g. an interpolated fragment), the quasi (non-interpolated)
 * parts are concatenated, which is good enough to preserve the operation's
 * field structure even though the interpolated content itself is dropped.
 */
function TemplateLiteral_toStaticText(
  template: tsm.TemplateLiteral,
): string | undefined {
  if (tsm.Node.isNoSubstitutionTemplateLiteral(template)) {
    return template.getLiteralText()
  }
  if (tsm.Node.isTemplateExpression(template)) {
    let text = template.getHead().getLiteralText()
    for (const span of template.getTemplateSpans()) {
      text += span.getLiteral().getLiteralText()
    }
    return text
  }
  return undefined
}

/**
 * Resolves the file paths of every `ImportDeclaration` module specifier in
 * `filePath` that points inside `web/src`. Import specifiers pointing to npm
 * packages, the api side, or anything else outside `web/src` are skipped.
 */
function resolveImportedFilePaths(
  project: RWProject,
  filePath: string,
): string[] {
  const sf = readSourceFile(filePath)
  if (!sf) {
    return []
  }

  const resolved: string[] = []
  for (const importDecl of sf.getDescendantsOfKind(
    tsm.SyntaxKind.ImportDeclaration,
  )) {
    const specifier = importDecl.getModuleSpecifierValue()
    const resolvedPath = resolveModuleSpecifier(project, filePath, specifier)
    if (resolvedPath) {
      resolved.push(resolvedPath)
    }
  }
  return resolved
}

/**
 * Resolves a single import specifier to an absolute file path inside
 * `web/src`, or `undefined` if it's not a relative import / `src/`-aliased
 * import, or if it doesn't resolve to a file inside `web/src` (e.g. an npm
 * package, or an api-side import).
 */
function resolveModuleSpecifier(
  project: RWProject,
  fromFilePath: string,
  specifier: string,
): string | undefined {
  const webSrc = project.pathHelper.web.src

  let basePath: string
  if (specifier.startsWith('.')) {
    basePath = path.resolve(path.dirname(fromFilePath), specifier)
  } else if (specifier === 'src' || specifier.startsWith('src/')) {
    basePath = path.join(webSrc, specifier.slice('src'.length))
  } else {
    // Not a relative or `src/`-aliased import (e.g. an npm package, or an
    // absolute import into the api side) - nothing to resolve.
    return undefined
  }

  const resolvedPath = resolveWithExtensions(basePath)
  if (!resolvedPath) {
    return undefined
  }

  const relativeToWebSrc = path.relative(webSrc, resolvedPath)
  if (relativeToWebSrc.startsWith('..') || path.isAbsolute(relativeToWebSrc)) {
    // Resolves outside web/src (e.g. reaching into the api side)
    return undefined
  }

  return resolvedPath
}

/**
 * Tries `basePath` as-is, then with each of `RESOLVE_EXTENSIONS`, then as a
 * directory index file with each of `RESOLVE_EXTENSIONS`.
 */
function resolveWithExtensions(basePath: string): string | undefined {
  if (isFile(basePath)) {
    return basePath
  }

  for (const ext of RESOLVE_EXTENSIONS) {
    const candidate = basePath + ext
    if (isFile(candidate)) {
      return candidate
    }
  }

  for (const ext of RESOLVE_EXTENSIONS) {
    const candidate = path.join(basePath, 'index' + ext)
    if (isFile(candidate)) {
      return candidate
    }
  }

  return undefined
}

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

/**
 * Reads and parses `filePath` with ts-morph, going through the same cached
 * in-memory source-file infrastructure the rest of the model uses (see
 * `FileNode.sf`). Returns `undefined` (rather than throwing) for files that
 * don't exist or fail to parse, since this analysis must degrade gracefully.
 */
function readSourceFile(filePath: string): tsm.SourceFile | undefined {
  let text: string
  try {
    text = fs.readFileSync(filePath, 'utf8')
  } catch {
    return undefined
  }

  try {
    return createTSMSourceFile_cached(filePath, text)
  } catch {
    return undefined
  }
}
