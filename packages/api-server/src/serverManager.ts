console.log('Module system check:')
console.log('typeof require:', typeof require)
console.log('typeof __dirname:', typeof __dirname)
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
console.log('__dirname value:', __dirname) // Add this line
console.log('typeof __filename:', typeof __filename)
console.log('typeof module:', typeof module)
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
console.log('typeof import.meta', typeof import.meta)
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
console.log('import.meta', import.meta)
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
console.log('typeof import.meta.dirname', typeof import.meta.dirname)
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
console.log('import.meta.dirname', import.meta.dirname)
console.log(
  'import.meta.dirname === __dirname',
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  import.meta.dirname === __dirname,
)

import type { ChildProcess } from 'child_process'
import { fork } from 'child_process'
import fs from 'fs'
import path from 'path'

// See https://github.com/webdiscus/ansis#troubleshooting
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import ansis from 'ansis'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import { getConfig, getPaths, resolveFile } from '@cedarjs/project-config'

// Just debugging
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
console.log('globalDirname', globalDirname)

// An esbuild plugin will take care of import.meta.dirname
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
const dirnameTop = import.meta.dirname
console.log('serverManager.ts dirnameTop', dirnameTop)
console.log('serverManager.ts __dirname', __dirname)
const binPathTop = path.join(dirnameTop, 'bin.js')
console.log('serverManager.ts binPathTop', binPathTop)

const argv = yargs(hideBin(process.argv))
  .option('debugPort', {
    description: 'Port on which to expose API server debugger',
    type: 'number',
    alias: ['debug-port', 'dp'],
  })
  .option('port', {
    description: 'The port to listen at',
    type: 'number',
    alias: 'p',
  })
  .parseSync()

const rwjsPaths = getPaths()

export class ServerManager {
  private httpServerProcess: ChildProcess | null = null

  private async startApiServer() {
    const forkOpts = {
      execArgv: process.execArgv,
    }

    // OpenTelemetry SDK Setup
    if (getConfig().experimental.opentelemetry.enabled) {
      // We expect the OpenTelemetry SDK setup file to be in a specific location
      const opentelemetrySDKScriptPath = path.join(
        rwjsPaths.api.dist,
        'opentelemetry.js',
      )
      const opentelemetrySDKScriptPathRelative = path.relative(
        rwjsPaths.base,
        opentelemetrySDKScriptPath,
      )
      console.log(
        `Setting up OpenTelemetry using the setup file: ${opentelemetrySDKScriptPathRelative}`,
      )
      if (fs.existsSync(opentelemetrySDKScriptPath)) {
        forkOpts.execArgv = forkOpts.execArgv.concat([
          `--require=${opentelemetrySDKScriptPath}`,
        ])
      } else {
        console.error(
          `OpenTelemetry setup file does not exist at ${opentelemetrySDKScriptPathRelative}`,
        )
      }
    }

    const debugPort = argv['debug-port']
    if (debugPort) {
      forkOpts.execArgv = forkOpts.execArgv.concat([`--inspect=${debugPort}`])
    }

    const port = argv.port ?? getConfig().api.port

    // Start API server

    const serverFile = resolveFile(`${rwjsPaths.api.dist}/server`)
    if (serverFile) {
      this.httpServerProcess = fork(
        serverFile,
        ['--apiPort', port.toString()],
        forkOpts,
      )
    } else {
      // An esbuild plugin will take care of import.meta.dirname
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const dirname = import.meta.dirname
      console.log('serverManager.ts dirname', dirname)
      const binPath = path.join(dirname, 'bin.js')
      console.log('serverManager.ts binPath', binPath)
      this.httpServerProcess = fork(
        binPath,
        ['api', '--port', port.toString()],
        forkOpts,
      )
    }
  }

  async restartApiServer() {
    await this.killApiServer()
    await this.startApiServer()
  }

  async killApiServer() {
    if (!this.httpServerProcess) {
      return
    }

    // Try to gracefully close the server
    // If it doesn't close within 2 seconds, forcefully close it
    await new Promise<void>((resolve) => {
      console.log(ansis.yellow('Shutting down API server.'))

      const cleanup = () => {
        this.httpServerProcess?.removeAllListeners('exit')
        clearTimeout(forceKillTimeout)
      }

      this.httpServerProcess?.on('exit', () => {
        console.log(ansis.yellow('API server exited.'))
        cleanup()
        resolve()
      })

      const forceKillTimeout = setTimeout(() => {
        console.log(
          ansis.yellow(
            'API server did not exit within 2 seconds, forcefully closing it.',
          ),
        )
        cleanup()
        this.httpServerProcess?.kill('SIGKILL')
        resolve()
      }, 2000)

      this.httpServerProcess?.kill()
    })
  }
}

export const serverManager = new ServerManager()
