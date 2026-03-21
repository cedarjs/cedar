import { defineConfig } from 'vitest/config'
import { BaseSequencer } from 'vitest/node'
import type { TestSpecification } from 'vitest/node'

import { cedarVitestPreset } from '@cedarjs/vite/api'

class SortSequencer extends BaseSequencer {
  async sort(tests: TestSpecification[]) {
    // Test the Cedar CLI --load-env-files flag (see smoke-tests-test.yml)
    if (process.env.SMOKE_ENV_VAR !== 'smoke-value') {
      throw new Error(
        'Unexpected SMOKE_ENV_VAR value: ' + process.env.SMOKE_ENV_VAR
      )
    }

    // Test the db import tracking Cedar has in its vitest config for the api
    // side
    return tests
      .filter((test) => test.moduleId.endsWith('-db-import.test.ts'))
      .sort()
  }
}

export default defineConfig({
  plugins: [cedarVitestPreset()],
  test: {
    globals: true,
    sequence: {
      sequencer: SortSequencer,
    },
  },
})
