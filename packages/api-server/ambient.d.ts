// `@types/dotenv-defaults` depends on dotenv v8, but dotenv-defaults uses
// dotenv v14, so I have to manually fix the types here

declare module 'dotenv-defaults' {
  import type { DotenvConfigOptions, DotenvConfigOutput } from 'dotenv'

  interface ConfigOptions extends DotenvConfigOptions {
    multiline?: boolean
  }

  export function config(options?: ConfigOptions): DotenvConfigOutput
}
