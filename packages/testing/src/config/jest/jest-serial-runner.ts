// Originally from https://github.com/gabrieli/jest-serial-runner/blob/master/index.js
// with fixed module export

import jestRunner from 'jest-runner'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const TestRunner: (typeof jestRunner)['default'] =
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  jestRunner.default || jestRunner

class SerialRunner extends TestRunner {
  public isSerial: boolean

  constructor(...attr: ConstructorParameters<typeof TestRunner>) {
    super(...attr)
    this.isSerial = true
  }
}

// Export using CommonJS compatible `export =` syntax for Jest compatibility
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore  - `export =` is required for Jest compatibility despite ES
// module target
export = SerialRunner
