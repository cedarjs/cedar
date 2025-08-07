import type {
  EnvironmentContext,
  JestEnvironmentConfig,
} from '@jest/environment'
import { TestEnvironment } from 'jest-environment-node'

class RedwoodApiJestEnvironment extends TestEnvironment {
  private testPath: string

  constructor(config: JestEnvironmentConfig, context: EnvironmentContext) {
    super(config, context)
    this.testPath = context.testPath
  }

  async setup(): Promise<void> {
    await super.setup()

    this.global.testPath = this.testPath
  }

  async teardown(): Promise<void> {
    await super.teardown()
  }

  getVmContext() {
    return super.getVmContext()
  }

  // async handleTestEvent(event, state) {
  //   if (event.name === 'test_start') {
  //     // Link to event docs:
  //     // https://github.com/facebook/jest/blob/master/packages/jest-types/src/Circus.ts
  //   }
  // }
}

export default RedwoodApiJestEnvironment
