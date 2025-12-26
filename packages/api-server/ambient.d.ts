// `@types/dotenv-defaults` depends on dotenv v8, but dotenv-defaults uses
// dotenv v14, so I have to manually fix the types here

declare module 'dotenv-defaults' {
  import type { config as Config } from 'dotenv-defaults/index.js'

  type BrokenConfigOptions = Exclude<Parameters<typeof Config>[0], undefined>
  type ConfigOutput = ReturnType<typeof Config>

  interface ConfigOptions extends BrokenConfigOptions {
    multiline?: boolean
  }

  export function config(options?: ConfigOptions): ConfigOutput
}
