// This is for backwards compatibility
import * as jestPreset from './jest-preset.js'
// Export using CommonJS compatible `export =` syntax for Jest compatibility
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore  - `export =` is required for Jest compatibility despite ES
// module target
export = jestPreset
