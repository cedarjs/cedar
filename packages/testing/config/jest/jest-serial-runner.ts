// Originally from https://github.com/gabrieli/jest-serial-runner/blob/master/index.js
// with fixed module export

import jestRunner from 'jest-runner'
const TestRunner = jestRunner.default || jestRunner

class SerialRunner extends TestRunner {
  public isSerial: boolean

  constructor(...attr: ConstructorParameters<typeof TestRunner>) {
    super(...attr)
    this.isSerial = true
  }
}

// Export using CommonJS compatible `export =` syntax for Jest compatibility
// @ts-expect-error - `export =` is required for Jest compatibility despite ES
// module target
export = SerialRunner
