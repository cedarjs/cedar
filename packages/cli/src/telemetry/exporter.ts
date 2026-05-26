import fs from 'node:fs'
import path from 'path'

import type { ExportResult } from '@opentelemetry/core'
import type { ReadableSpan } from '@opentelemetry/sdk-trace-node'

import { getPaths } from '@cedarjs/project-config'

/**
 * Custom exporter which writes spans to a file inside of .cedar/spans
 */
export class CustomFileExporter {
  /**
   * @type string
   * @private
   */
  #storageFileName: string

  /**
   * @type string
   * @private
   */
  #storageFilePath: string

  /**
   * @type boolean
   * @private
   */
  #isShutdown = false

  constructor() {
    this.#storageFileName = `${Date.now()}.json`

    // Ensure the path exists
    this.#storageFilePath = path.join(
      getPaths().generated.base,
      'telemetry',
      this.#storageFileName,
    )
    fs.mkdirSync(path.dirname(this.#storageFilePath), { recursive: true })

    // Create the file and open a JSON array
    fs.writeFileSync(this.#storageFilePath, '[')
  }

  /**
   * Called to export sampled {@link ReadableSpan}s.
   * @param spans the list of sampled Spans to be exported.
   */
  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ) {
    for (const span of spans) {
      fs.appendFileSync(
        this.#storageFilePath,
        JSON.stringify(
          span,
          (key, value) => {
            if (key === '_spanProcessor') {
              return undefined
            }

            return value
          },
          2,
        ),
      )

      fs.appendFileSync(this.#storageFilePath, ',')
    }

    resultCallback({ code: 0 })
  }

  /** Stops the exporter. */
  shutdown() {
    // Close the JSON array
    if (!this.#isShutdown) {
      // Remove the trailing comma
      fs.truncateSync(
        this.#storageFilePath,
        fs.statSync(this.#storageFilePath).size - 1,
      )
      fs.appendFileSync(this.#storageFilePath, ']')
      this.#isShutdown = true
    }
  }

  /** Immediately export all spans */
  forceFlush() {
    // Do nothing
  }
}
