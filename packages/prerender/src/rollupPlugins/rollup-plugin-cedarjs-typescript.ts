// import typescript from '@rollup/plugin-typescript'
import { swc } from 'rollup-plugin-swc3'

export function typescriptPlugin(
  filepath: string,
  tsconfig: false | string | Record<string, any>,
) {
  console.log('typescriptPlugin filepath', filepath)
  const isTypeScriptFile = filepath.endsWith('.ts') || filepath.endsWith('.tsx')

  if (!isTypeScriptFile) {
    return undefined
  }

  type PluginOptions = NonNullable<Parameters<typeof swc>[0]>

  const typescriptOptions: PluginOptions = {
    //sourceMaps: true,
    // inlineSourceMap: true,
    // declaration: false,
    // declarationMap: false,
    // noEmit: true,
    // skipLibCheck: true,
  }

  if (isTsconfigWithPath(tsconfig)) {
    console.log('tsconfig.path', tsconfig.path)
    typescriptOptions.tsconfig = tsconfig.path
    // } else if (isTsconfigWithData(tsconfig)) {
    //   console.log('tsconfig.data', tsconfig.data)
    //   typescriptOptions.compilerOptions = tsconfig.data.compilerOptions
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

// function isTsconfigWithData(
//   tsconfig: false | string | Record<string, any>,
// ): tsconfig is { data: { compilerOptions?: any } } {
//   return (
//     !!tsconfig &&
//     typeof tsconfig === 'object' &&
//     'data' in tsconfig &&
//     typeof tsconfig.data === 'object'
//   )
// }
