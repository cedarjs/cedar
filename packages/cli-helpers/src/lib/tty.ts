import { errorTelemetry } from '@cedarjs/telemetry'

import { colors } from './colors.js'

/**
 * Prompting libraries (e.g. `prompts`) hang indefinitely when stdin isn't a
 * TTY - piped input, CI, or a backgrounded process never sends a keypress,
 * so the prompt neither resolves nor throws.
 *
 * Call this immediately before any interactive confirm/prompt that's only
 * reached when a flag was left unset, so a non-interactive invocation exits
 * with a clear, actionable error instead of hanging.
 */
export function requireTTYOrExit(flagHint: string): void {
  if (process.stdin.isTTY) {
    return
  }

  const error = new Error(
    'Cannot prompt for confirmation in a non-interactive terminal. ' +
      `Please pass ${flagHint} explicitly.`,
  )
  errorTelemetry(process.argv, error.message)
  console.error(colors.error(error.message))
  process.exit(1)
}
