import type { API, ASTPath, FileInfo } from 'jscodeshift'

/**
 * The Vite config objects that have a `rollupOptions` alias for
 * `rolldownOptions`
 */
const parentKeys = ['build', 'worker', 'optimizeDeps']

function keyName(key: unknown) {
  if (typeof key !== 'object' || key === null || !('type' in key)) {
    return undefined
  }

  if (key.type === 'Identifier' && 'name' in key) {
    return typeof key.name === 'string' ? key.name : undefined
  }

  if (
    (key.type === 'StringLiteral' || key.type === 'Literal') &&
    'value' in key
  ) {
    return typeof key.value === 'string' ? key.value : undefined
  }

  return undefined
}

/**
 * Renames `rollupOptions` to `rolldownOptions` in Vite's `build`, `worker` and
 * `optimizeDeps` options. Vite treats the two names the same, so this doesn't
 * change what the config does. Objects that set both are left alone, because
 * Vite ignores `rollupOptions` there, and merging the two would change that.
 */
export default function transform(file: FileInfo, api: API) {
  const j = api.jscodeshift
  const ast = j(file.source)
  let changed = false

  const renameIn = (propertyPaths: ASTPath[]) => {
    for (const propertyPath of propertyPaths) {
      const property = propertyPath.node

      if (
        !('key' in property) ||
        ('computed' in property && property.computed)
      ) {
        continue
      }

      if (keyName(property.key) !== 'rollupOptions') {
        continue
      }

      const objectPath = propertyPath.parent
      const parentPropertyPath = objectPath?.parent
      const parentProperty = parentPropertyPath?.node

      if (
        objectPath?.node.type !== 'ObjectExpression' ||
        !parentProperty ||
        !('key' in parentProperty) ||
        !parentKeys.includes(keyName(parentProperty.key) ?? '')
      ) {
        continue
      }

      const siblings: unknown[] = objectPath.node.properties
      const hasRolldownOptions = siblings.some(
        (sibling) =>
          typeof sibling === 'object' &&
          sibling !== null &&
          'key' in sibling &&
          keyName(sibling.key) === 'rolldownOptions',
      )

      if (hasRolldownOptions) {
        continue
      }

      property.key = j.identifier('rolldownOptions')
      changed = true
    }
  }

  renameIn(ast.find(j.ObjectProperty).paths())
  renameIn(ast.find(j.Property).paths())

  // `config.build.rollupOptions`, as in a plugin's `config()` hook
  ast
    .find(j.MemberExpression, {
      computed: false,
      property: { type: 'Identifier', name: 'rollupOptions' },
    })
    .filter((path) => {
      const object = path.node.object

      return (
        object.type === 'MemberExpression' &&
        !object.computed &&
        object.property.type === 'Identifier' &&
        parentKeys.includes(object.property.name)
      )
    })
    .forEach((path) => {
      path.node.property = j.identifier('rolldownOptions')
      changed = true
    })

  return changed ? ast.toSource() : file.source
}
