import { basename } from 'node:path'

import type { TSESLint, TSESTree } from '@typescript-eslint/utils'
import { AST_NODE_TYPES, ESLintUtils } from '@typescript-eslint/utils'

const createRule = ESLintUtils.RuleCreator.withoutDocs

type FunctionLikeNode =
  | TSESTree.ArrowFunctionExpression
  | TSESTree.FunctionDeclaration
  | TSESTree.FunctionExpression

type ParamNode = TSESTree.Parameter

// `beforeQuery`/`afterQuery`/`isEmpty` are lifecycle hooks; `Loading`/
// `Failure`/`Success` are components. Both groups are checked param-first --
// only `beforeQuery` also requires an explicit return type, since its return
// type isn't otherwise checked anywhere (unlike its first param, which is
// load-bearing for `CellPropsVariables`).
const LIFECYCLE_EXPORTS = new Set(['beforeQuery', 'afterQuery', 'isEmpty'])
const RENDER_PROP_EXPORTS = new Set(['Loading', 'Failure', 'Success'])

interface DerivedQueryTypes {
  data: string
  variables: string
}

function getParamPattern(param: ParamNode): TSESTree.Node {
  return param.type === AST_NODE_TYPES.AssignmentPattern ? param.left : param
}

function paramHasTypeAnnotation(param: ParamNode): boolean {
  const pattern = getParamPattern(param)
  return 'typeAnnotation' in pattern && !!pattern.typeAnnotation
}

// Finds the `)` that closes the function's parameter list, so a missing return
// type can be inserted right after it regardless of function form (arrow,
// function expression, or function declaration). Only valid to call when the
// params are actually parenthesized -- see `isUnparenthesizedArrowParam`.
function getParamsClosingParen(
  sourceCode: TSESLint.SourceCode,
  fn: FunctionLikeNode,
) {
  if (fn.params.length > 0) {
    const lastParam = fn.params[fn.params.length - 1]
    return sourceCode.getTokenAfter(lastParam, (token) => token.value === ')')
  }

  return sourceCode.getFirstToken(fn, (token) => token.value === ')')
}

// A single-identifier arrow param (`x => ...`) is the one case where a
// param/return type can't just be inserted next to the existing tokens: there's
// no `)` to anchor on (searching forward for one risks landing on an unrelated
// `)` inside the function body), and TypeScript requires parens as soon as
// either the param or the return type is annotated. Destructured, defaulted,
// and multi-param arrows are always parenthesized already, and function
// declarations/expressions always require parens, so this can only be true for
// a bare identifier arrow param.
function isUnparenthesizedArrowParam(
  fn: FunctionLikeNode,
  param: ParamNode,
  sourceCode: TSESLint.SourceCode,
): boolean {
  if (fn.type !== AST_NODE_TYPES.ArrowFunctionExpression) {
    return false
  }
  if (fn.params.length !== 1 || fn.params[0] !== param) {
    return false
  }
  return sourceCode.getTokenBefore(param)?.value !== '('
}

// Wraps a bare identifier arrow param in parens while inserting its annotation
// and/or the function's return type, e.g. `data => data` becomes
// `(data: DataObject): DataObject => data`.
function* insertWrappedAnnotations(
  fixer: TSESLint.RuleFixer,
  param: ParamNode,
  paramTypeText: string | null,
  returnTypeText: string | null,
) {
  yield fixer.insertTextBefore(param, '(')
  const paramPart = paramTypeText ? `: ${paramTypeText}` : ''
  const returnPart = returnTypeText ? `: ${returnTypeText}` : ''
  yield fixer.insertTextAfter(param, `${paramPart})${returnPart}`)
}

function extractTypedDocumentNodeArgs(
  typeAnnotation: TSESTree.TSTypeAnnotation | undefined,
  sourceCode: TSESLint.SourceCode,
): DerivedQueryTypes | null {
  const type = typeAnnotation?.typeAnnotation
  if (type?.type !== AST_NODE_TYPES.TSTypeReference) {
    return null
  }

  if (
    type.typeName.type !== AST_NODE_TYPES.Identifier ||
    type.typeName.name !== 'TypedDocumentNode'
  ) {
    return null
  }

  const args = type.typeArguments?.params
  if (!args || args.length < 2) {
    return null
  }

  return {
    data: sourceCode.getText(args[0]),
    variables: sourceCode.getText(args[1]),
  }
}

function isImportSpecifier(
  specifier: TSESTree.ImportClause,
): specifier is TSESTree.ImportSpecifier {
  return specifier.type === AST_NODE_TYPES.ImportSpecifier
}

export const cellTypeAnnotations = createRule({
  meta: {
    type: 'suggestion',
    docs: {
      description:
        "Sets the types on a Cell file's lifecycle hooks and render props to the correct @cedarjs/web Cell types",
    },
    messages: {
      needsTypeAnnotation:
        'The `{{name}}` {{kind}} needs a type annotation of `{{typeName}}` ({{location}}).',
      beforeQueryParamNeedsType:
        "`beforeQuery`'s first parameter needs a type annotation. Cedar infers the Cell's external props from it, so leaving it untyped degrades type checking at every call site of this Cell.",
    },
    fixable: 'code',
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const sourceCode = context.sourceCode
    const filename = basename(context.filename)
    // `.jsx` is intentionally excluded: it's plain JavaScript-project output
    // (see `transformTSToJS` in `@cedarjs/cli`), so there's no build step
    // that would strip the TypeScript syntax this rule inserts.
    const filenameIndicatesCell = filename.endsWith('Cell.tsx')

    let hasQueryOrFragment = false
    let hasSuccessExport = false
    let derivedQueryTypes: DerivedQueryTypes | null = null

    let webTypeImport: TSESTree.ImportDeclaration | null = null

    // Names already imported as types from `@cedarjs/web`, either via
    // `import type { X } from '@cedarjs/web'` or the inline modifier
    // (`import { type X } from '@cedarjs/web'`).
    const importedWebTypeNames = new Set<string>()

    const checks: (() => void)[] = []

    // Names already given an insertion fix earlier in this same lint pass.
    // Two reports that both need a brand-new `@cedarjs/web` import (e.g.
    // `isEmpty`'s response and options params both needing `DataObject`)
    // would otherwise each independently insert the same import text at the
    // same position, producing a duplicate/conflicting fix.
    const claimedImportNames = new Set<string>()

    function needsImportEdit(importName: string | null): importName is string {
      if (!importName) {
        return false
      }

      if (importedWebTypeNames.has(importName)) {
        return false
      }

      if (claimedImportNames.has(importName)) {
        return false
      }

      claimedImportNames.add(importName)
      return true
    }

    function* importEdit(fixer: TSESLint.RuleFixer, importName: string) {
      const specifiers =
        webTypeImport?.specifiers.filter(isImportSpecifier) ?? []
      const lastSpecifier = specifiers[specifiers.length - 1]

      if (lastSpecifier) {
        yield fixer.insertTextAfter(lastSpecifier, `, ${importName}`)
        return
      }

      yield fixer.insertTextBeforeRange(
        [0, 0],
        `import type { ${importName} } from '@cedarjs/web'\n`,
      )
    }

    function checkBeforeQuery(fn: FunctionLikeNode, reportNode: TSESTree.Node) {
      const variablesType =
        derivedQueryTypes?.variables ?? 'Record<string, unknown>'

      if (!fn.returnType) {
        const typeName = `CellBeforeQueryResult<${variablesType}>`
        const shouldImport = needsImportEdit('CellBeforeQueryResult')

        context.report({
          node: reportNode,
          messageId: 'needsTypeAnnotation',
          data: {
            name: 'beforeQuery',
            typeName,
            kind: 'function',
            location: 'return type',
          },
          *fix(fixer) {
            const [firstParam] = fn.params

            if (
              firstParam &&
              isUnparenthesizedArrowParam(fn, firstParam, sourceCode)
            ) {
              yield* insertWrappedAnnotations(fixer, firstParam, null, typeName)
            } else {
              const closingParen = getParamsClosingParen(sourceCode, fn)

              if (!closingParen) {
                return
              }

              yield fixer.insertTextAfter(closingParen, `: ${typeName}`)
            }

            if (shouldImport) {
              yield* importEdit(fixer, 'CellBeforeQueryResult')
            }
          },
        })
      }

      const firstParam = fn.params[0]

      if (firstParam && !paramHasTypeAnnotation(firstParam)) {
        // The shape of `beforeQuery`'s first argument can't be safely
        // inferred from the QUERY's variables type (it may only partially
        // overlap), so this is surfaced without an autofix.
        context.report({
          node: reportNode,
          messageId: 'beforeQueryParamNeedsType',
        })
      }
    }

    function checkAfterQuery(fn: FunctionLikeNode, reportNode: TSESTree.Node) {
      // Only the param is checked. `afterQuery`'s return type isn't fed into
      // any other type via `Parameters<>`/`ReturnType<>` the way
      // `beforeQuery`'s first param is (see `CellPropsVariables` in
      // `@cedarjs/web`'s cellTypes.ts) -- nothing downstream ever inspects
      // it, so annotating it doesn't add any checking that isn't already
      // happening (or not happening) locally in this function body.
      const firstParam = fn.params[0]
      const missingParam = !!firstParam && !paramHasTypeAnnotation(firstParam)

      if (!missingParam) {
        return
      }

      const shouldImport = needsImportEdit('DataObject')

      context.report({
        node: reportNode,
        messageId: 'needsTypeAnnotation',
        data: {
          name: 'afterQuery',
          typeName: 'DataObject',
          kind: 'function',
          location: 'parameter',
        },
        *fix(fixer) {
          if (
            firstParam &&
            isUnparenthesizedArrowParam(fn, firstParam, sourceCode)
          ) {
            yield* insertWrappedAnnotations(
              fixer,
              firstParam,
              'DataObject',
              null,
            )
          } else if (firstParam) {
            yield fixer.insertTextAfter(
              getParamPattern(firstParam),
              ': DataObject',
            )
          }
          if (shouldImport) {
            yield* importEdit(fixer, 'DataObject')
          }
        },
      })
    }

    function checkIsEmpty(fn: FunctionLikeNode, reportNode: TSESTree.Node) {
      // Only the params are checked; see the comment in `checkAfterQuery` --
      // the same reasoning applies to `isEmpty`'s return type.
      const [responseParam, optionsParam] = fn.params
      const missingResponseType =
        !!responseParam && !paramHasTypeAnnotation(responseParam)
      const missingOptionsType =
        !!optionsParam && !paramHasTypeAnnotation(optionsParam)

      if (!missingResponseType && !missingOptionsType) {
        return
      }

      const shouldImport = needsImportEdit('DataObject')

      context.report({
        node: reportNode,
        messageId: 'needsTypeAnnotation',
        data: {
          name: 'isEmpty',
          typeName: 'DataObject',
          kind: 'function',
          location: 'parameters',
        },
        *fix(fixer) {
          if (
            responseParam &&
            isUnparenthesizedArrowParam(fn, responseParam, sourceCode)
          ) {
            yield* insertWrappedAnnotations(
              fixer,
              responseParam,
              missingResponseType ? 'DataObject' : null,
              null,
            )
          } else {
            if (missingResponseType && responseParam) {
              yield fixer.insertTextAfter(
                getParamPattern(responseParam),
                ': DataObject',
              )
            }
            if (missingOptionsType && optionsParam) {
              yield fixer.insertTextAfter(
                getParamPattern(optionsParam),
                ': { isDataEmpty: (data: DataObject) => boolean }',
              )
            }
          }
          if (shouldImport) {
            yield* importEdit(fixer, 'DataObject')
          }
        },
      })
    }

    function checkRenderProp(
      name: string,
      fn: FunctionLikeNode,
      reportNode: TSESTree.Node,
    ) {
      const [propsParam] = fn.params
      if (!propsParam || paramHasTypeAnnotation(propsParam)) {
        return
      }

      const variablesType = derivedQueryTypes?.variables

      let insertText: string
      if (name === 'Success') {
        insertText = derivedQueryTypes
          ? `CellSuccessProps<${derivedQueryTypes.data}, ${derivedQueryTypes.variables}>`
          : 'CellSuccessProps'
      } else if (name === 'Failure') {
        insertText = variablesType
          ? `CellFailureProps<${variablesType}>`
          : 'CellFailureProps'
      } else {
        insertText = variablesType
          ? `CellLoadingProps<${variablesType}>`
          : 'CellLoadingProps'
      }

      const importName = `Cell${name}Props`
      const shouldImport = needsImportEdit(importName)

      context.report({
        node: reportNode,
        messageId: 'needsTypeAnnotation',
        data: {
          name,
          typeName: insertText,
          kind: 'component',
          location: 'parameter',
        },
        *fix(fixer) {
          if (isUnparenthesizedArrowParam(fn, propsParam, sourceCode)) {
            yield* insertWrappedAnnotations(fixer, propsParam, insertText, null)
          } else {
            yield fixer.insertTextAfter(
              getParamPattern(propsParam),
              `: ${insertText}`,
            )
          }
          if (shouldImport) {
            yield* importEdit(fixer, importName)
          }
        },
      })
    }

    function checkExport(
      name: string,
      fn: FunctionLikeNode,
      reportNode: TSESTree.Node,
    ) {
      if (name === 'beforeQuery') {
        checkBeforeQuery(fn, reportNode)
      } else if (name === 'afterQuery') {
        checkAfterQuery(fn, reportNode)
      } else if (name === 'isEmpty') {
        checkIsEmpty(fn, reportNode)
      } else if (RENDER_PROP_EXPORTS.has(name)) {
        checkRenderProp(name, fn, reportNode)
      }
    }

    return {
      ImportDeclaration(node) {
        if (node.source.value !== '@cedarjs/web') {
          return
        }

        if (node.importKind === 'type') {
          webTypeImport = node
        }

        node.specifiers.filter(isImportSpecifier).forEach((specifier) => {
          if (node.importKind === 'type' || specifier.importKind === 'type') {
            importedWebTypeNames.add(specifier.local.name)
          }
        })
      },

      ExportNamedDeclaration(node) {
        if (node.declaration?.type === AST_NODE_TYPES.FunctionDeclaration) {
          const fn = node.declaration
          const idNode = fn.id
          if (!idNode) {
            return
          }
          const name = idNode.name

          if (name === 'Success') {
            hasSuccessExport = true
          }

          if (LIFECYCLE_EXPORTS.has(name) || RENDER_PROP_EXPORTS.has(name)) {
            checks.push(() => checkExport(name, fn, idNode))
          }

          return
        }

        if (node.declaration?.type !== AST_NODE_TYPES.VariableDeclaration) {
          return
        }

        node.declaration.declarations.forEach((vd) => {
          if (
            vd.type !== AST_NODE_TYPES.VariableDeclarator ||
            vd.id.type !== AST_NODE_TYPES.Identifier
          ) {
            return
          }

          const name = vd.id.name

          if (name === 'QUERY') {
            derivedQueryTypes ||= extractTypedDocumentNodeArgs(
              vd.id.typeAnnotation,
              sourceCode,
            )
            hasQueryOrFragment = true
            return
          }

          if (name === 'FRAGMENT') {
            hasQueryOrFragment = true
            return
          }

          if (name === 'Success') {
            hasSuccessExport = true
          }

          if (
            (LIFECYCLE_EXPORTS.has(name) || RENDER_PROP_EXPORTS.has(name)) &&
            (vd.init?.type === AST_NODE_TYPES.ArrowFunctionExpression ||
              vd.init?.type === AST_NODE_TYPES.FunctionExpression)
          ) {
            const fn = vd.init
            checks.push(() => checkExport(name, fn, vd.id))
          }
        })
      },

      'Program:exit'() {
        const isCellFile =
          filenameIndicatesCell && hasQueryOrFragment && hasSuccessExport

        if (!isCellFile) {
          return
        }

        checks.forEach((check) => check())
      },
    }
  },
})
