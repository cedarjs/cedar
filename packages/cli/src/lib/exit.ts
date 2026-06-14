import ansis from 'ansis'
import { terminalLink } from 'termi-link'
import { v4 as uuidv4 } from 'uuid'

import {
  recordTelemetryAttributes,
  recordTelemetryError,
} from '@cedarjs/cli-helpers'

interface ExitWithErrorOptions {
  exitCode?: number
  message?: string
  epilogue?: string
  includeEpilogue?: boolean
  includeReferenceCode?: boolean
}

const discordLink = terminalLink('Discord', 'https://cedarjs.com/discord')
const githubLink = terminalLink('GitHub', 'https://github.com/cedarjs/cedar')
const DEFAULT_ERROR_EPILOGUE = [
  'Need help?',
  ` - Not sure about something or need advice? Reach out on our ${discordLink}`,
  ` - Think you've found a bug? Open an issue on our ${githubLink}`,
].join('\n')

export function exitWithError(
  error: unknown,
  {
    exitCode,
    message,
    epilogue,
    includeEpilogue,
    includeReferenceCode,
  }: ExitWithErrorOptions = {},
): never {
  // Set the default values
  if (error && typeof error === 'object' && 'exitCode' in error) {
    exitCode ??= typeof error.exitCode === 'number' ? error.exitCode : 1
  }

  exitCode ??= 1
  epilogue ??= DEFAULT_ERROR_EPILOGUE
  includeEpilogue ??= true
  includeReferenceCode ??= true

  // Determine the correct error message
  if (message === undefined) {
    if (error instanceof Error && error.stack) {
      message = error.stack
    } else {
      message = String(error) || 'Unknown error'
    }
  }

  // Generate a unique reference code for the error which can be used to look up
  // the error in telemetry if needed and if the user chooses to share it
  const errorReferenceCode = uuidv4()

  // Scrollbars sometimes cause wrapping issues, so we shorten the line length
  // to prevent wrapping issues
  const line = ansis.red('-'.repeat(process.stderr.columns - 4))

  // Generate and print a nice message to the user
  const content = !includeEpilogue
    ? message
    : [
        '',
        line,
        message,
        `\n${line}`,
        epilogue,
        includeReferenceCode &&
          ` - Here's your unique error reference to quote: '${errorReferenceCode}'`,
        line,
      ]
        .filter(Boolean)
        .join('\n')

  console.error(content)

  // Record the error in telemetry
  recordTelemetryError(error ?? new Error(message ?? ''))
  recordTelemetryAttributes({ errorReferenceCode })

  process.exit(exitCode)
}
