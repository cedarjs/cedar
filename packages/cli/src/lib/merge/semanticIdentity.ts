import type { NodePath } from '@babel/traverse'
import type {
  ImportDeclaration,
  ObjectProperty,
  VariableDeclarator,
} from '@babel/types'

export function semanticIdentity(path: NodePath): string {
  const identity = {
    get(p: NodePath): string[] {
      return p.type in this
        ? (this as Record<string, (p: NodePath) => string[]>)[p.type](p)
        : [p.type ?? 'unknown']
    },
    ObjectProperty: (p: NodePath<ObjectProperty>): string[] => {
      const key = p.node.key
      // Only Identifier keys (e.g. `{ foo: v }`) have a usable name for identity.
      // Computed keys (`{ [expr]: v }`) fall back to the node type, which is a
      // deliberate improvement over the original JS that returned `[undefined]`.
      if (key.type !== 'Identifier') {
        return [p.type]
      }
      return [key.name]
    },
    VariableDeclarator: (p: NodePath<VariableDeclarator>): string[] => {
      const id = p.node.id
      // Only simple Identifier patterns (e.g. `const foo = …`) have a usable name.
      // Destructuring patterns (`const { a } = …`) fall back to the node type,
      // a deliberate improvement over the original JS that returned `[undefined]`.
      if (id.type !== 'Identifier') {
        return [p.type]
      }
      return [id.name]
    },
    ImportDeclaration: (p: NodePath<ImportDeclaration>): string[] => [
      'ImportDeclaration',
      'source',
      p.node.source.value,
    ],
  }

  return path
    .getAncestry()
    .reduce((acc: string[], i: NodePath) => [...identity.get(i), ...acc], [])
    .join('.')
}
