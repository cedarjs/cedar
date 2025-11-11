import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

export const handler = async () => {
  recordTelemetryAttributes({
    command: 'record',
  })

  const { parseDatamodel } = await import('@cedarjs/record')

  await parseDatamodel()
}
