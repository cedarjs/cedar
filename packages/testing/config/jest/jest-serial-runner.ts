// Originally from https://github.com/gabrieli/jest-serial-runner/blob/master/index.js
// with fixed module export

import * as TestRunnerModule from 'jest-runner'
const TestRunner = (TestRunnerModule as any).default || TestRunnerModule

class SerialRunner extends TestRunner {
  public isSerial: boolean

  constructor(...attr: any[]) {
    super(...attr)
    this.isSerial = true
  }
}

export default SerialRunner
