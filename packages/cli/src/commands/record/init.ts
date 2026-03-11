import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

export const handler = async (_argv?: Record<string, unknown>) => {
  recordTelemetryAttributes({
    command: 'record',
  })

  // @ts-expect-error - Types not available for JS files
  const { parseDatamodel } = await import('@cedarjs/record')

  await parseDatamodel()
}
