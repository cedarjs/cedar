import _generate from '@babel/generator'
import { parse } from '@babel/parser'
import _traverse from '@babel/traverse'
import type { NodePath } from '@babel/traverse'
import * as t from '@babel/types'
import type { Plugin } from 'vite'
import { normalizePath } from 'vite'

import { getPaths } from '@cedarjs/project-config'

// CJS/ESM interop — both packages ship a default export in CJS but may be
// imported as a namespace in ESM bundler contexts.
const traverse =
  (_traverse as unknown as { default: typeof _traverse }).default ?? _traverse
const generate =
  (_generate as unknown as { default: typeof _generate }).default ?? _generate

/**
 * Vite plugin that wraps exported API functions with OpenTelemetry spans to
 * provide automatic tracing in your Cedar API.
 *
 * For each `export const fn = (async?) (...) => {...}` declaration in an API
 * file this plugin:
 *
 * 1. Adds an import at the top of the file:
 *      import { trace as RW_OTEL_WRAPPER_TRACE } from '@opentelemetry/api'
 *
 * 2. Renames the original function:
 *      const __fn = <original function>
 *
 * 3. Replaces the export with a wrapper that starts an OTel span:
 *      export const fn = (async?) (...params) => {
 *        const RW_OTEL_WRAPPER_TRACER = RW_OTEL_WRAPPER_TRACE.getTracer('redwoodjs')
 *        const RW_OTEL_WRAPPER_RESULT = (await?) RW_OTEL_WRAPPER_TRACER.startActiveSpan(
 *          'redwoodjs:api:<folder>:<fnName>',
 *          (async?) (span) => { ... }
 *        )
 *        return RW_OTEL_WRAPPER_RESULT
 *      }
 *
 * This replaces `babel-plugin-redwood-otel-wrapping` for Vite builds.
 * The Babel plugin is still used for Jest transforms.
 */
export function cedarOtelWrappingPlugin(): Plugin {
  return {
    name: 'cedar-otel-wrapping',

    transform(code, id) {
      let apiSrc: string
      try {
        apiSrc = normalizePath(getPaths().api.src)
      } catch {
        return null
      }

      if (!normalizePath(id).startsWith(apiSrc + '/')) {
        return null
      }

      // Compute the top-level folder under api/src (e.g. 'functions', 'services')
      const relativePath = normalizePath(id).slice(apiSrc.length + 1)
      const apiFolder = relativePath.split('/')[0] ?? '?'

      const result = applyOtelWrapping(code, id, apiFolder)
      return result ? { code: result, map: null } : null
    },
  }
}

/**
 * Applies OpenTelemetry span wrapping to API source files.
 *
 * Exported as a standalone function so it can be tested without a Vite context.
 * Returns the transformed code string, or `null` if nothing was changed.
 */
export function applyOtelWrapping(
  code: string,
  filename: string,
  apiFolder: string,
): string | null {
  let ast: ReturnType<typeof parse>
  try {
    ast = parse(code, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    })
  } catch {
    return null
  }

  let didTransform = false

  // Add: import { trace as RW_OTEL_WRAPPER_TRACE } from '@opentelemetry/api'
  ast.program.body.unshift(
    t.importDeclaration(
      [
        t.importSpecifier(
          t.identifier('RW_OTEL_WRAPPER_TRACE'),
          t.identifier('trace'),
        ),
      ],
      t.stringLiteral('@opentelemetry/api'),
    ),
  )
  didTransform = true

  traverse(ast, {
    ExportNamedDeclaration(path: NodePath<t.ExportNamedDeclaration>) {
      wrapExportNamedDeclaration(path, filename, apiFolder)
    },
  })

  if (!didTransform) {
    return null
  }

  const { code: output } = generate(ast, {}, code)
  return output
}

function wrapExportNamedDeclaration(
  path: NodePath<t.ExportNamedDeclaration>,
  filename: string,
  apiFolder: string,
) {
  const declaration = path.node.declaration
  const declarationIsSupported =
    declaration?.type === 'VariableDeclaration' &&
    declaration.declarations[0].init?.type === 'ArrowFunctionExpression'

  if (!declarationIsSupported) {
    return
  }

  const originalFunction = declaration.declarations[0]
    .init as t.ArrowFunctionExpression
  if (!originalFunction) {
    return
  }

  const originalFunctionName =
    declaration.declarations[0].id.type === 'Identifier'
      ? declaration.declarations[0].id.name
      : '?'
  const wrappedFunctionName = `__${
    originalFunctionName === '?'
      ? 'RW_OTEL_WRAPPER_UNKNOWN_FUNCTION'
      : originalFunctionName
  }`

  const originalFunctionArgumentsWithoutDefaults: (
    | t.ArgumentPlaceholder
    | t.SpreadElement
    | t.Expression
  )[] = []

  for (const param of originalFunction.params) {
    if (param.type === 'Identifier') {
      originalFunctionArgumentsWithoutDefaults.push(param)
      continue
    }

    if (param.type === 'ObjectPattern') {
      const objectProperties = param.properties.filter(
        (p): p is t.ObjectProperty => p.type === 'ObjectProperty',
      )
      originalFunctionArgumentsWithoutDefaults.push(
        t.objectExpression(
          objectProperties.map((p) => {
            if (p.value.type === 'AssignmentPattern') {
              return t.objectProperty(p.key, p.value.left)
            }
            return p
          }),
        ),
      )
      continue
    }

    if (param.type === 'AssignmentPattern') {
      if (param.left.type === 'Identifier') {
        originalFunctionArgumentsWithoutDefaults.push(param.left)
      } else if (param.left.type === 'ObjectPattern') {
        const objectProperties = param.left.properties.filter(
          (p): p is t.ObjectProperty => p.type === 'ObjectProperty',
        )
        originalFunctionArgumentsWithoutDefaults.push(
          t.objectExpression(
            objectProperties.map((p) => {
              if (p.value.type === 'AssignmentPattern') {
                return t.objectProperty(p.key, p.value.left)
              }
              return p
            }),
          ),
        )
      } else {
        // TODO: Implement others, bail out for now
        return
      }
    }

    if (param.type === 'ArrayPattern' || param.type === 'RestElement') {
      // TODO: Implement, bail out for now
      return
    }
  }

  const activeSpanBlock = t.callExpression(
    t.memberExpression(
      t.identifier('RW_OTEL_WRAPPER_TRACER'),
      t.identifier('startActiveSpan'),
    ),
    [
      t.stringLiteral(`redwoodjs:api:${apiFolder}:${originalFunctionName}`),
      t.arrowFunctionExpression(
        [t.identifier('span')],
        t.blockStatement([
          t.expressionStatement(
            t.callExpression(
              t.memberExpression(
                t.identifier('span'),
                t.identifier('setAttribute'),
              ),
              [
                t.stringLiteral('code.function'),
                t.stringLiteral(originalFunctionName),
              ],
            ),
          ),
          t.expressionStatement(
            t.callExpression(
              t.memberExpression(
                t.identifier('span'),
                t.identifier('setAttribute'),
              ),
              [t.stringLiteral('code.filepath'), t.stringLiteral(filename)],
            ),
          ),
          t.tryStatement(
            t.blockStatement([
              t.variableDeclaration('const', [
                t.variableDeclarator(
                  t.identifier('RW_OTEL_WRAPPER_INNER_RESULT'),
                  originalFunction.async
                    ? t.awaitExpression(
                        t.callExpression(
                          t.identifier(wrappedFunctionName),
                          originalFunctionArgumentsWithoutDefaults,
                        ),
                      )
                    : t.callExpression(
                        t.identifier(wrappedFunctionName),
                        originalFunctionArgumentsWithoutDefaults,
                      ),
                ),
              ]),
              t.expressionStatement(
                t.callExpression(
                  t.memberExpression(t.identifier('span'), t.identifier('end')),
                  [],
                ),
              ),
              t.returnStatement(t.identifier('RW_OTEL_WRAPPER_INNER_RESULT')),
            ]),
            t.catchClause(
              t.identifier('error'),
              t.blockStatement([
                t.expressionStatement(
                  t.callExpression(
                    t.memberExpression(
                      t.identifier('span'),
                      t.identifier('recordException'),
                    ),
                    [t.identifier('error')],
                  ),
                ),
                t.expressionStatement(
                  t.callExpression(
                    t.memberExpression(
                      t.identifier('span'),
                      t.identifier('setStatus'),
                    ),
                    [
                      t.objectExpression([
                        t.objectProperty(
                          t.identifier('code'),
                          t.numericLiteral(2),
                        ),
                        t.objectProperty(
                          t.identifier('message'),
                          t.logicalExpression(
                            '??',
                            t.optionalMemberExpression(
                              t.optionalCallExpression(
                                t.optionalMemberExpression(
                                  t.optionalMemberExpression(
                                    t.identifier('error'),
                                    t.identifier('message'),
                                    false,
                                    true,
                                  ),
                                  t.identifier('split'),
                                  false,
                                  true,
                                ),
                                [t.stringLiteral('\n')],
                                false,
                              ),
                              t.numericLiteral(0),
                              true,
                              false,
                            ),
                            t.optionalMemberExpression(
                              t.optionalCallExpression(
                                t.optionalMemberExpression(
                                  t.optionalCallExpression(
                                    t.optionalMemberExpression(
                                      t.identifier('error'),
                                      t.identifier('toString'),
                                      false,
                                      true,
                                    ),
                                    [],
                                    false,
                                  ),
                                  t.identifier('split'),
                                  false,
                                  true,
                                ),
                                [t.stringLiteral('\n')],
                                false,
                              ),
                              t.numericLiteral(0),
                              true,
                              false,
                            ),
                          ),
                        ),
                      ]),
                    ],
                  ),
                ),
                t.expressionStatement(
                  t.callExpression(
                    t.memberExpression(
                      t.identifier('span'),
                      t.identifier('end'),
                    ),
                    [],
                  ),
                ),
                t.throwStatement(t.identifier('error')),
              ]),
            ),
          ),
        ]),
        originalFunction.async,
      ),
    ],
  )

  const wrapper = t.arrowFunctionExpression(
    originalFunction.params,
    t.blockStatement(
      [
        t.variableDeclaration('const', [
          t.variableDeclarator(
            t.identifier(wrappedFunctionName),
            originalFunction,
          ),
        ]),
        t.variableDeclaration('const', [
          t.variableDeclarator(
            t.identifier('RW_OTEL_WRAPPER_TRACER'),
            t.callExpression(
              t.memberExpression(
                t.identifier('RW_OTEL_WRAPPER_TRACE'),
                t.identifier('getTracer'),
              ),
              [t.stringLiteral('redwoodjs')],
            ),
          ),
        ]),
        t.variableDeclaration('const', [
          t.variableDeclarator(
            t.identifier('RW_OTEL_WRAPPER_RESULT'),
            originalFunction.async
              ? t.awaitExpression(activeSpanBlock)
              : activeSpanBlock,
          ),
        ]),
        t.returnStatement(t.identifier('RW_OTEL_WRAPPER_RESULT')),
      ],
      originalFunction.body.type === 'BlockStatement'
        ? originalFunction.body.directives
        : undefined,
    ),
    originalFunction.async,
  )

  // Replace the original function with the wrapped version
  declaration.declarations[0].init = wrapper
}
