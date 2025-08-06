// Originally from https://github.com/gabrieli/jest-serial-runner/blob/master/index.js
// with fixed module export

const { default: TestRunner } = require('jest-runner')

class SerialRunner extends TestRunner {
  public isSerial: boolean

  constructor(...attr: any[]) {
    super(...attr)
    this.isSerial = true
  }
}

module.exports = SerialRunner
