import fs from 'node:fs'
import path from 'node:path'

import { simpleTraverse, parse } from '@typescript-eslint/typescript-estree'
import type { TSESTree } from '@typescript-eslint/utils'
import { ESLintUtils, AST_NODE_TYPES } from '@typescript-eslint/utils'

const createRule = ESLintUtils.RuleCreator.withoutDocs

/**
 * Where `yarn cedar setup tenancy` puts the permissions package's source,
 * from the project root
 */
const PERMISSIONS_FILE = path.join('packages', 'permissions', 'src', 'index.ts')

const SDL_FILE = /\.sdl\.(?:ts|js)$/

// `@requirePermission(permission: "members.manage")`, with GraphQL's
// optional commas between arguments. A directive with an interpolation in
// it is split over two of the template's quasis, so it never matches here
// and is left alone
const DIRECTIVE =
  /@requirePermission\s*\(\s*permission\s*:\s*"([^"\n]*)"[\s,]*\)/g

/**
 * `text` with every GraphQL comment and block string blanked out, so a
 * directive mentioned in a description or a comment isn't taken for a real
 * one. Same length as `text`, so indexes into it still point at the source.
 * Plain strings are kept: the directive's own argument is one.
 */
function blankCommentsAndBlockStrings(text: string): string {
  let out = ''
  let i = 0

  while (i < text.length) {
    if (text.startsWith('"""', i)) {
      const end = text.indexOf('"""', i + 3)
      const stop = end === -1 ? text.length : end + 3
      out += text.slice(i, stop).replace(/[^\n]/g, ' ')
      i = stop
    } else if (text[i] === '"') {
      let j = i + 1

      while (j < text.length && text[j] !== '"' && text[j] !== '\n') {
        j += text[j] === '\\' ? 2 : 1
      }

      const stop = Math.min(j + 1, text.length)
      out += text.slice(i, stop)
      i = stop
    } else if (text[i] === '#') {
      const end = text.indexOf('\n', i)
      const stop = end === -1 ? text.length : end
      out += ' '.repeat(stop - i)
      i = stop
    } else {
      out += text[i]
      i += 1
    }
  }

  return out
}

type CachedNames = { mtimeMs: number; names: ReadonlySet<string> | null }

const cache = new Map<string, CachedNames>()

/**
 * `node` without the TypeScript-only wrappers that change nothing at
 * runtime: `x as const`, `x satisfies T`, `x!`
 */
function unwrapTypeExpressions(node: TSESTree.Node): TSESTree.Node {
  let current = node

  while (
    current.type === AST_NODE_TYPES.TSAsExpression ||
    current.type === AST_NODE_TYPES.TSSatisfiesExpression ||
    current.type === AST_NODE_TYPES.TSNonNullExpression
  ) {
    current = current.expression
  }

  return current
}

function stringValue(node: TSESTree.Node): string | undefined {
  if (node.type === AST_NODE_TYPES.Literal && typeof node.value === 'string') {
    return node.value
  }

  if (
    node.type === AST_NODE_TYPES.TemplateLiteral &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  ) {
    return node.quasis[0].value.cooked ?? undefined
  }

  return undefined
}

function propertyName(property: TSESTree.Property): string | undefined {
  if (property.computed) {
    return undefined
  }

  if (property.key.type === AST_NODE_TYPES.Identifier) {
    return property.key.name
  }

  return stringValue(property.key)
}

/**
 * The names in the `permissions: [...]` array of the first
 * `definePermissions({ ... })` call in `source`, or `null` when there's no
 * such call or the array holds anything but string literals (we can't tell
 * what the names are then)
 */
export function parsePermissionNames(source: string): Set<string> | null {
  let ast: TSESTree.Program

  try {
    ast = parse(source, { jsx: false, range: false, loc: false })
  } catch {
    return null
  }

  const result: { names: Set<string> | null } = { names: null }
  let found = false

  simpleTraverse(ast, {
    enter(node) {
      if (
        found ||
        node.type !== AST_NODE_TYPES.CallExpression ||
        node.callee.type !== AST_NODE_TYPES.Identifier ||
        node.callee.name !== 'definePermissions'
      ) {
        return
      }

      found = true

      const options = node.arguments[0]

      if (options?.type !== AST_NODE_TYPES.ObjectExpression) {
        return
      }

      for (const property of options.properties) {
        if (
          property.type !== AST_NODE_TYPES.Property ||
          propertyName(property) !== 'permissions'
        ) {
          continue
        }

        const value = unwrapTypeExpressions(property.value)

        if (value.type !== AST_NODE_TYPES.ArrayExpression) {
          continue
        }

        const names = new Set<string>()

        for (const element of value.elements) {
          const name = element
            ? stringValue(unwrapTypeExpressions(element))
            : undefined

          if (name === undefined) {
            return
          }

          names.add(name)
        }

        result.names = names
      }
    },
  })

  return result.names
}

/**
 * The app's permission names, read from the permissions file and cached
 * until the file changes. `null` when the file isn't there or doesn't
 * declare its permissions in a way we can read.
 */
function readPermissionNames(file: string): ReadonlySet<string> | null {
  let mtimeMs: number

  try {
    mtimeMs = fs.statSync(file).mtimeMs
  } catch {
    cache.delete(file)
    return null
  }

  const cached = cache.get(file)

  if (cached?.mtimeMs === mtimeMs) {
    return cached.names
  }

  let names: ReadonlySet<string> | null = null

  try {
    names = parsePermissionNames(fs.readFileSync(file, 'utf-8'))
  } catch {
    names = null
  }

  cache.set(file, { mtimeMs, names })

  return names
}

/** Looks for `packages/permissions/src/index.ts` in `dir` and above */
function findPermissionsFile(dir: string): string | undefined {
  for (let current = dir; ;) {
    const candidate = path.join(current, PERMISSIONS_FILE)

    if (fs.existsSync(candidate)) {
      return candidate
    }

    const parent = path.dirname(current)

    if (parent === current) {
      return undefined
    }

    current = parent
  }
}

function editDistance(a: string, b: string) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)

  for (let i = 1; i <= a.length; i++) {
    const row = [i]

    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        previous[j] + 1,
        row[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }

    previous = row
  }

  return previous[b.length]
}

function closestName(name: string, names: ReadonlySet<string>) {
  const maxDistance = Math.max(2, Math.floor(name.length / 4))
  let best: { name: string; distance: number } | undefined

  for (const candidate of names) {
    const distance = editDistance(name, candidate)

    if (distance <= maxDistance && (!best || distance < best.distance)) {
      best = { name: candidate, distance }
    }
  }

  return best?.name
}

export const validPermissionNames = createRule<
  [{ permissionsFile?: string }?],
  'unknownPermission' | 'unknownPermissionWithSuggestion'
>({
  meta: {
    type: 'problem',
    docs: {
      description:
        "Check that the permissions named in an SDL file's @requirePermission directives are defined",
    },
    messages: {
      unknownPermission:
        'Unknown permission "{{name}}". Add it to `permissions` in definePermissions(), or fix the name.',
      unknownPermissionWithSuggestion:
        'Unknown permission "{{name}}". Did you mean "{{suggestion}}"?',
    },
    schema: [
      {
        type: 'object',
        properties: {
          permissionsFile: { type: 'string' },
        },
        additionalProperties: false,
      },
    ],
  },
  defaultOptions: [{}],
  create(context, [options = {}]) {
    if (!SDL_FILE.test(context.filename)) {
      return {}
    }

    const permissionsFile = options.permissionsFile
      ? path.resolve(context.cwd, options.permissionsFile)
      : findPermissionsFile(path.dirname(context.filename))

    const names = permissionsFile ? readPermissionNames(permissionsFile) : null

    if (!names) {
      return {}
    }

    const { sourceCode } = context

    return {
      TaggedTemplateExpression(node) {
        if (
          node.tag.type !== AST_NODE_TYPES.Identifier ||
          node.tag.name !== 'gql'
        ) {
          return
        }

        for (const quasi of node.quasi.quasis) {
          const text = blankCommentsAndBlockStrings(quasi.value.raw)
          // The quasi's range includes the backtick or `}` before it
          const textStart = quasi.range[0] + 1

          for (const match of text.matchAll(DIRECTIVE)) {
            const name = match[1]

            if (names.has(name)) {
              continue
            }

            const nameStart =
              textStart + match.index + match[0].indexOf('"') + 1
            const suggestion = closestName(name, names)

            context.report({
              loc: {
                start: sourceCode.getLocFromIndex(nameStart),
                end: sourceCode.getLocFromIndex(nameStart + name.length),
              },
              ...(suggestion
                ? {
                    messageId: 'unknownPermissionWithSuggestion' as const,
                    data: { name, suggestion },
                  }
                : {
                    messageId: 'unknownPermission' as const,
                    data: { name },
                  }),
            })
          }
        }
      },
    }
  },
})
