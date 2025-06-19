import type { RollupOptions } from 'rollup'

export interface Options {
  cwd?: string

  /** The filepath to bundle and require */
  filepath: string

  // TODO: Should I keep or remove this?
  /** rollup options */
  rollupOptions?: RollupOptions & {
    watch?: undefined | never
  }

  /** External packages */
  external?: (string | RegExp)[]

  /** Not external packages */
  notExternal?: (string | RegExp)[]

  /**
   * Automatically mark node_modules as external
   * @default true - `false` when `filepath` is in node_modules
   */
  externalNodeModules?: boolean

  /**
   * A custom tsconfig path to read `paths` option
   *
   * Set to `false` to disable tsconfig
   * Or provide a `TsconfigRaw` object
   */
  tsconfig?: string | any | false

  /**
   * Preserve compiled temporary file for debugging
   * Default to `process.env.BUNDLE_REQUIRE_PRESERVE`
   */
  preserveTemporaryFile?: boolean

  /** Provide bundle format explicitly to skip the default format inference */
  format?: 'cjs' | 'esm'

  /** Returns the name of the output file */
  getOutputFile?: (
    filepath: string,
    format: 'cjs' | 'esm',
    randomId: string,
  ) => string
}
