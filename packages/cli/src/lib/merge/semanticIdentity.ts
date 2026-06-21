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
      if (key.type !== 'Identifier') {
        return [p.type]
      }
      return [key.name]
    },
    VariableDeclarator: (p: NodePath<VariableDeclarator>): string[] => {
      const id = p.node.id
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
