import fs from 'node:fs'
import path from 'node:path'

import {
  simpleTraverse,
  parse as parseTypeScript,
} from '@typescript-eslint/typescript-estree'
import type { TSESTree } from '@typescript-eslint/utils'
import { ESLintUtils, AST_NODE_TYPES } from '@typescript-eslint/utils'
import { Kind, parse as parseGraphQL, visit } from 'graphql'
import type { DirectiveNode, DocumentNode, StringValueNode } from 'graphql'

const createRule = ESLintUtils.RuleCreator.withoutDocs

/**
 * Where `yarn cedar setup tenancy` puts the permissions package's source,
 * from the project root
 */
const PERMISSIONS_FILE = path.join('packages', 'permissions', 'src', 'index.ts')

const SDL_FILE = /\.sdl\.(?:ts|js)$/

// The check works on GraphQL's own AST. graphql-eslint hands its rules that
// same AST, so this part would carry over as is if the api side's SDL ever
// goes through graphql-eslint the way the web side's documents do. Only
// the gql template handling in the rule itself is about parsing the SDL
// ourselves.

export type UnknownPermission = {
  /** The directive's `permission` argument */
  node: StringValueNode
  name: string
  /** The closest defined name, when one is close enough to be a typo */
  suggestion: string | undefined
}

/**
 * What's wrong with `directive`, or `undefined` when it isn't a
 * `@requirePermission` whose `permission` is a literal that `names` doesn't
 * have
 */
export function checkRequirePermission(
  directive: DirectiveNode,
  names: ReadonlySet<string>,
): UnknownPermission | undefined {
  if (directive.name.value !== 'requirePermission') {
    return undefined
  }

  const argument = directive.arguments?.find(
    (argument) => argument.name.value === 'permission',
  )

  // An enum value, say, isn't a name we can check
  if (argument?.value.kind !== Kind.STRING) {
    return undefined
  }

  const name = argument.value.value

  if (names.has(name)) {
    return undefined
  }

  return { node: argument.value, name, suggestion: closestName(name, names) }
}

/**
 * The source of a gql template between its backticks, with every `${...}`
 * blanked out so the text keeps its length: an offset into `text` plus
 * `start` is an offset into the file. A whole interpolated definition
 * leaves valid SDL behind; an interpolation inside one doesn't, and the
 * template is then skipped.
 */
function templateText(
  template: TSESTree.TemplateLiteral,
  source: string,
): { start: number; text: string } {
  const start = template.range[0] + 1
  let text = ''
  let cursor = start

  for (const quasi of template.quasis) {
    // A quasi's range includes the backtick or `}` before it and the `${`
    // or backtick after it
    const rawStart = quasi.range[0] + 1
    const rawEnd = quasi.range[1] - (quasi.tail ? 1 : 2)

    text += source.slice(cursor, rawStart).replace(/[^\n]/g, ' ')
    text += source.slice(rawStart, rawEnd)
    cursor = rawEnd
  }

  return { start, text }
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
    ast = parseTypeScript(source, { jsx: false, range: false, loc: false })
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

        const { start, text } = templateText(node.quasi, sourceCode.text)
        let document: DocumentNode

        try {
          document = parseGraphQL(text)
        } catch {
          // Not SDL we can read. The GraphQL server reports real syntax
          // errors, with the directives in them still unchecked
          return
        }

        visit(document, {
          Directive(directive) {
            const unknown = checkRequirePermission(directive, names)

            if (!unknown?.node.loc) {
              return
            }

            const { name, suggestion } = unknown
            const { loc } = unknown.node

            // A string with an interpolation in it was parsed as blanks
            if (
              sourceCode.text.slice(start + loc.start, start + loc.end) !==
              text.slice(loc.start, loc.end)
            ) {
              return
            }

            context.report({
              loc: {
                start: sourceCode.getLocFromIndex(start + loc.start),
                end: sourceCode.getLocFromIndex(start + loc.end),
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
          },
        })
      },
    }
  },
})
