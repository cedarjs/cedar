import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

// @ts-expect-error - Types not available for JS files
import c from '../lib/colors.js'

export const command = 'check'
export const aliases = ['diagnostics']
export const description =
  'Get structural diagnostics for a Redwood project (experimental)'

export const handler = async () => {
  recordTelemetryAttributes({ command: 'check' })

  const structure = await import('@cedarjs/structure')
  const { printDiagnostics, DiagnosticSeverity } = structure.default

  console.log('structure', structure)
  console.log('structure.default', structure.default)
  console.log('DiagnosticServerity', DiagnosticSeverity)

  printDiagnostics({
    getSeverityLabel: (severity) => {
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
