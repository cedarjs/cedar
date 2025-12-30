import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

// @ts-expect-error - Types not available for JS files
import c from '../lib/colors.js'
// @ts-expect-error - Types not available for JS files
import { getPaths } from '../lib/index.js'

export const command = 'check'
export const aliases = ['diagnostics']
export const description =
  'Get structural diagnostics for a Redwood project (experimental)'

export const handler = async () => {
  recordTelemetryAttributes({ command: 'check' })

  const { printDiagnostics, DiagnosticSeverity } = (
    await import('@cedarjs/structure')
  ).default

  console.log('DiagnosticServerity', DiagnosticSeverity)

  printDiagnostics(getPaths().base, {
    getSeverityLabel: (severity: unknown) => {
      if (severity === DiagnosticSeverity.Error) {
        return c.error('error')
      }

      if (severity === DiagnosticSeverity.Warning) {
        return c.warning('warning')
      }

      return c.info('info')
    },
  })
}
