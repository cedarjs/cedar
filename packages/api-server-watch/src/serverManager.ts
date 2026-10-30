import type { ChildProcess } from 'child_process'
import { fork } from 'child_process'
import { createRequire } from 'node:module'
import path from 'path'

import ansis from 'ansis'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'

import {
  getConfig,
  getOTelImportArgs,
  getPaths,
  resolveFile,
} from '@cedarjs/project-config'

const require = createRequire(import.meta.url)

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
      execArgv: process.execArgv.concat(getOTelImportArgs()),
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
      // `serverManager` lives in @cedarjs/api-server-watch, not
      // @cedarjs/api-server, so its production bin can't be found by walking
      // up from this module's own directory. Resolve it by package name
      // instead, the same way core's bin-forwarding wrappers do.
      const apiServerPkgPath =
        require.resolve('@cedarjs/api-server/package.json')
      const apiServerDir = path.dirname(apiServerPkgPath)
      const apiServerPkg = require(apiServerPkgPath)
      const binPath = path.join(
        apiServerDir,
        apiServerPkg.bin['cedarjs-server'],
      )

      const args = ['api', '--port', port.toString()]
      this.httpServerProcess = fork(binPath, args, forkOpts)
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
