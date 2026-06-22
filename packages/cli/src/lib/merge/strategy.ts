import type { NodePath } from '@babel/core'
import * as t from '@babel/types'
import uniqWith from 'lodash/uniqWith.js'

import { nodeIs, sieve } from './algorithms.js'

const OPAQUE_UID_TAG =
  'RW_MERGE_OPAQUE_UID_Q2xldmVyIHlvdSEgSGF2ZSBhIGNvb2tpZS4='

// A MergeProxy wraps a Babel NodePath and exposes the underlying node's
// properties directly, plus a `path` property pointing back to the NodePath.
// See makeProxy() in index.js for the Proxy implementation.
export type MergeProxy<T extends t.Node = t.Node> = T & {
  readonly path: NodePath<T>
}

type NodeReducer = (base: MergeProxy, ext: MergeProxy) => void

type OpaqueReducer = NodeReducer & { readonly [OPAQUE_UID_TAG]: true }

function requireSameType(base: MergeProxy, ext: MergeProxy): void {
  if (base.path.type !== ext.path.type) {
    throw new Error(
      'Attempting to merge nodes with different types. This is not yet supported.',
    )
  }
}

function requireStrategyExists(
  base: MergeProxy,
  _ext: MergeProxy,
  strategy: Partial<Record<string, unknown>>,
  strategyName: string,
): void {
  if (!(base.path.type in strategy)) {
    throw new Error(
      `Attempting to ${strategyName} nodes that do not have an ${strategyName} strategy.`,
    )
  }
}

const strictEquality = (lhs: unknown, rhs: unknown) => lhs === rhs
// Accept unknown params so these can be stored in Record<string, EqualityFn>
// without casts. The Babel AST nodes we receive are guaranteed to have the
// required shape by the time the function is called.
function hasName(v: unknown): v is { name: string } {
  return typeof v === 'object' && v !== null && 'name' in v
}
function hasKeyName(v: unknown): v is { key: { name: string } } {
  return (
    typeof v === 'object' &&
    v !== null &&
    'key' in v &&
    typeof (v as { key?: unknown }).key === 'object' &&
    (v as { key?: unknown }).key !== null &&
    'name' in (v as { key: object }).key
  )
}
function hasValue(v: unknown): v is { value: unknown } {
  return typeof v === 'object' && v !== null && 'value' in v
}
const byName = (lhs: unknown, rhs: unknown): boolean =>
  hasName(lhs) && hasName(rhs) && lhs.name === rhs.name
const byKeyName = (lhs: unknown, rhs: unknown): boolean =>
  hasKeyName(lhs) && hasKeyName(rhs) && lhs.key.name === rhs.key.name
const byValue = (lhs: unknown, rhs: unknown): boolean =>
  hasValue(lhs) && hasValue(rhs) && lhs.value === rhs.value

function defaultEquality(
  baseContainer: unknown[],
  extContainer: unknown[],
): (lhs: unknown, rhs: unknown) => boolean {
  const sample =
    (baseContainer.length && baseContainer[0]) ||
    (extContainer.length && extContainer[0])

  const defaults: Record<string, (lhs: unknown, rhs: unknown) => boolean> = {
    BigIntLiteral: byValue,
    BooleanLiteral: byValue,
    Identifier: byName,
    NumericLiteral: byValue,
    ObjectProperty: byKeyName,
    StringLiteral: byValue,
  }

  return sample &&
    typeof sample === 'object' &&
    'type' in sample &&
    typeof sample.type === 'string' &&
    sample.type in defaults
    ? defaults[sample.type]
    : strictEquality
}

export function opaquely<T extends NodeReducer>(reducer: T): T & OpaqueReducer {
  return Object.assign(reducer, { [OPAQUE_UID_TAG]: true as const })
}

export function isOpaque(fn: NodeReducer | OpaqueReducer): fn is OpaqueReducer {
  return OPAQUE_UID_TAG in fn && fn[OPAQUE_UID_TAG] === true
}

export const keepBase = opaquely(() => {})

export const keepBoth = opaquely((base: MergeProxy, ext: MergeProxy) => {
  base.path.insertAfter(ext.path.node)
})

export const keepExtension = opaquely((base: MergeProxy, ext: MergeProxy) => {
  base.path.replaceWith(ext.path)
})

export const keepBothStatementParents = opaquely(
  (base: MergeProxy, ext: MergeProxy) => {
    // This creates an ambiguity. How do we treat nodes "between" base and its statement parent? Do we
    // recursively merge those, or not? In other words, are we opaque starting from base, or starting
    // from base.getStatementParent()? If it's the former, this currently works - the node reducer of
    // keepBothStatementParents marks the node as opaque. If it's the latter, this is wrong - again,
    // the node marked is opaque, but nodes which are children of base.getStatementParent(), but
    // parents of base will still be recursively merged by other strategies. I'm not sure what to do.
    const extParent = ext.path.getStatementParent()
    if (extParent) {
      base.path.getStatementParent()?.insertAfter(extParent.node)
    }
  },
)

// Each interleave/concat strategy function is stored keyed by node type name
// and is only ever called when the proxy's runtime type matches the key.
// The casts inside each function are safe because the strategy map key
// guarantees the node type at the call site.
type ImportDeclarationProxy = MergeProxy<t.ImportDeclaration>
type ArrayExpressionProxy = MergeProxy<t.ArrayExpression>
type ObjectExpressionProxy = MergeProxy<t.ObjectExpression>
type StringLiteralProxy = MergeProxy<t.StringLiteral>

const interleaveStrategy: Partial<
  Record<string, (base: MergeProxy, ext: MergeProxy) => void>
> = {
  ImportDeclaration(base, ext) {
    // Safe: interleaveStrategy['ImportDeclaration'] is only called when
    // base.path.type === 'ImportDeclaration'
    const baseImport = base as unknown as ImportDeclarationProxy
    const extImport = ext as unknown as ImportDeclarationProxy

    const baseSpecs = baseImport.specifiers
    const extSpecs = extImport.specifiers

    const importSpecifierEquality = (
      lhs: t.ImportDeclaration['specifiers'][number],
      rhs: t.ImportDeclaration['specifiers'][number],
    ) => {
      if (lhs.type !== rhs.type) {
        return false
      }
      if (lhs.type === 'ImportSpecifier' && rhs.type === 'ImportSpecifier') {
        return (
          lhs.imported.type === 'Identifier' &&
          rhs.imported.type === 'Identifier' &&
          lhs.imported.name === rhs.imported.name &&
          lhs.local?.name === rhs.local?.name
        )
      }
      return lhs.local?.name === rhs.local?.name
    }

    const uniqueSpecifiersOfType = (type: string) =>
      uniqWith(
        [...baseSpecs, ...extSpecs].filter(nodeIs(type)),
        importSpecifierEquality,
      )

    // Rule 1: If there's exactly 1 import with 0 specifiers, it's a side-effect import and should
    // not be merged, because adding specifiers would change its meaning.
    if (!baseSpecs.length !== !extSpecs.length) {
      return keepBothStatementParents(baseImport, extImport)
    }

    // Rule 2: Default specifiers must appear first, and be unique in a statement.
    const defaultPosition = (specs: unknown[]) =>
      specs.some(nodeIs('ImportDefaultSpecifier')) ? -1 : 0

    // Rule 3: There can only be one wildcard import per statement, and wildcard imports cannot
    // mix with import specifiers.
    const namespacePosition = (specs: unknown[]) =>
      specs.some(nodeIs('ImportNamespaceSpecifier')) ||
      specs.some(nodeIs('ImportSpecifier'))
        ? -1
        : specs.length
    const importPosition = (specs: unknown[]) =>
      specs.some(nodeIs('ImportNamespaceIdentifier')) ? -1 : specs.length

    const [firstSpecifierList, ...rest] = sieve(
      [uniqueSpecifiersOfType('ImportDefaultSpecifier'), defaultPosition],
      [uniqueSpecifiersOfType('ImportNamespaceSpecifier'), namespacePosition],
      [uniqueSpecifiersOfType('ImportSpecifier'), importPosition],
    )

    baseImport.specifiers = firstSpecifierList
    if (rest.length) {
      baseImport.path.insertAfter(
        rest.map((specs) => t.importDeclaration(specs, baseImport.source)),
      )
    }
  },
}

export function interleave(base: MergeProxy, ext: MergeProxy): void {
  requireSameType(base, ext)
  requireStrategyExists(base, ext, interleaveStrategy, 'interleave')
  interleaveStrategy[base.path.type]!(base, ext)
}

const concatStrategy: Partial<
  Record<string, (base: MergeProxy, ext: MergeProxy) => void>
> = {
  ArrayExpression(base, ext) {
    const b = base as unknown as ArrayExpressionProxy
    const e = ext as unknown as ArrayExpressionProxy
    b.elements = [...b.elements, ...e.elements]
  },
  ObjectExpression(base, ext) {
    const b = base as unknown as ObjectExpressionProxy
    const e = ext as unknown as ObjectExpressionProxy
    b.properties = [...b.properties, ...e.properties]
  },
  StringLiteral(base, ext) {
    const b = base as unknown as StringLiteralProxy
    const e = ext as unknown as StringLiteralProxy
    b.value = b.value.concat(e.value)
  },
}

export function concat(base: MergeProxy, ext: MergeProxy): void {
  requireSameType(base, ext)
  requireStrategyExists(base, ext, concatStrategy, 'concat')
  concatStrategy[base.path.type]!(base, ext)
}

type EqualityFn = (lhs: unknown, rhs: unknown) => boolean

const concatUniqueStrategy: Partial<
  Record<string, (base: MergeProxy, ext: MergeProxy, eq?: EqualityFn) => void>
> = {
  ArrayExpression(base, ext, eq) {
    const b = base as unknown as ArrayExpressionProxy
    const e = ext as unknown as ArrayExpressionProxy
    const equalFn = eq ?? defaultEquality(b.elements, e.elements)
    b.elements = uniqWith([...b.elements, ...e.elements], equalFn)
  },
  ObjectExpression(base, ext, eq) {
    const b = base as unknown as ObjectExpressionProxy
    const e = ext as unknown as ObjectExpressionProxy
    const equalFn = eq ?? defaultEquality(b.properties, e.properties)
    b.properties = uniqWith([...b.properties, ...e.properties], equalFn)
  },
}

// concatUnique can be called in two ways:
//   concatUnique(base, ext)           — acts as a NodeReducer directly
//   concatUnique(equalityFn)          — returns a NodeReducer using the given equality fn
export function concatUnique(eq: EqualityFn): NodeReducer
export function concatUnique(base: MergeProxy, ext: MergeProxy): void
export function concatUnique(
  baseOrEq: MergeProxy | EqualityFn,
  ext?: MergeProxy,
): NodeReducer | void {
  if (typeof baseOrEq === 'function') {
    // Factory mode: MergeProxy is always an object (Babel AST node), so
    // typeof === 'function' reliably narrows to EqualityFn.
    const eq = baseOrEq
    return (base: MergeProxy, innerExt: MergeProxy) => {
      requireSameType(base, innerExt)
      requireStrategyExists(
        base,
        innerExt,
        concatUniqueStrategy,
        'concatUnique',
      )
      concatUniqueStrategy[base.path.type]!(base, innerExt, eq)
    }
  }

  // Reducer mode: baseOrEq is MergeProxy, ext is defined (guaranteed by overloads)
  const base = baseOrEq
  if (!ext) {
    return
  }
  requireSameType(base, ext)
  requireStrategyExists(base, ext, concatUniqueStrategy, 'concatUnique')
  // The type-specific concatUnique implementations will provide an appropriate equality operator.
  concatUniqueStrategy[base.path.type]!(base, ext)
}
