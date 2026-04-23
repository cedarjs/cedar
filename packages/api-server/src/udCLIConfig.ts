import ansis from 'ansis'
import type { Argv } from 'yargs'

type UDParsedOptions = {
  port?: number
  host?: string
  apiRootPath?: string
}

export const description =
  'Start a Universal Deploy server for serving the Cedar API'

export function builder(yargs: Argv<UDParsedOptions>) {
  yargs.options({
    port: {
      description: 'The port to listen at',
      type: 'number',
      alias: 'p',
      default: 8911,
    },
    host: {
      description:
        'The host to listen at. Note that you most likely want this to be ' +
        "'0.0.0.0' in production",
      type: 'string',
    },
    apiRootPath: {
      description: 'Root path where your api functions are served',
      type: 'string',
      alias: ['api-root-path', 'rootPath', 'root-path'],
      default: '/',
    },
  })
}

export async function handler(options: UDParsedOptions) {
  const timeStart = Date.now()

  console.log(ansis.dim.italic('Starting Universal Deploy Server...'))

  const { createUDServer } = await import('./createUDServer.js')

  await createUDServer({
    port: options.port,
    host: options.host,
    apiRootPath: options.apiRootPath,
  })

  console.log(ansis.dim.italic('Took ' + (Date.now() - timeStart) + ' ms'))
}
