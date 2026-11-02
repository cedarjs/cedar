import type { AttributeValue, Span } from '@opentelemetry/api'
import opentelemetry, { SpanStatusCode } from '@opentelemetry/api'

import { redactError } from './redact.js'

export { redactError, redactErrorMessage } from './redact.js'

type TelemetryAttributes = {
  [key: string]: AttributeValue | undefined
}

/**
 * Safely records attributes to the opentelemetry span
 *
 * @param attributes An object of key-value pairs to be individually recorded as attributes
 * @param span An optional span to record the attributes to. If not provided, the current active span will be used
 */
export function recordTelemetryAttributes(
  attributes: TelemetryAttributes,
  span?: Span,
) {
  const spanToRecord = span ?? opentelemetry.trace.getActiveSpan()

  if (spanToRecord === undefined) {
    return
  }

  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) {
      spanToRecord.setAttribute(key, value)
    }
  }
}

/**
 * Safely records an error to the opentelemetry span
 *
 * Only a redacted version of the error is recorded: the first line of the
 * message, with URLs and file paths replaced by placeholders, and no stack
 * trace. See `redactErrorMessage`.
 *
 * @param error An error to record to the span
 * @param span An optional span to record the error to. If not provided, the current active span will be used
 */
export function recordTelemetryError(error: unknown, span?: Span) {
  const spanToRecord = span ?? opentelemetry.trace.getActiveSpan()
  if (spanToRecord === undefined) {
    return
  }

  const redacted = redactError(error ?? 'Unknown error')

  spanToRecord.setStatus({
    code: SpanStatusCode.ERROR,
    message: redacted.message,
  })
  spanToRecord.recordException(redacted)
}
