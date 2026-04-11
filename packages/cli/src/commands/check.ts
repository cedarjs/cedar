import { recordTelemetryAttributes, colors as c } from '@cedarjs/cli-helpers'

export const command = 'check'
export const aliases = ['diagnostics']
export const description =
  'Get structural diagnostics for a Redwood project (experimental)'

export const handler = async () => {
  recordTelemetryAttributes({ command: 'check' })

  const { printDiagnostics, DiagnosticSeverity } =
    await import('@cedarjs/structure')

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
