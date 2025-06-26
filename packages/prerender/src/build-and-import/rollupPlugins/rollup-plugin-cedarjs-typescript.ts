import { swc } from 'rollup-plugin-swc3'

export function typescriptPlugin(
  filepath: string,
  tsconfig: false | string | Record<string, any>,
) {
  const isTypeScriptFile = filepath.endsWith('.ts') || filepath.endsWith('.tsx')

  if (!isTypeScriptFile) {
    return undefined
  }

  type PluginOptions = NonNullable<Parameters<typeof swc>[0]>

  const typescriptOptions: PluginOptions = {}

  if (isTsconfigWithPath(tsconfig)) {
    typescriptOptions.tsconfig = tsconfig.path
  }

  return swc(typescriptOptions)
}

function isTsconfigWithPath(
  tsconfig: false | string | Record<string, any>,
): tsconfig is { path: string } {
  return (
    !!tsconfig &&
    typeof tsconfig === 'object' &&
    'path' in tsconfig &&
    typeof tsconfig.path === 'string'
  )
}
