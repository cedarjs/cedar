import { defineConfig } from 'vitest/config'
import { BaseSequencer } from 'vitest/node'
import type { TestSpecification } from 'vitest/node'

import { cedarVitestPreset } from '@cedarjs/vite/api'

class SortSequencer extends BaseSequencer {
  async sort(tests: TestSpecification[]) {
    // This is currently setup to only test the db import tracking Cedar has
    // in its vitest config for the api side
    // Feel free to extend this if you need to test other features
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
