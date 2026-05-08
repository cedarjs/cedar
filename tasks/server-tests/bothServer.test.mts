import { describe, expect, it } from 'vitest'
import { $ } from 'zx'

import { cedar, cedarServer } from './vitest.setup.mjs'

describe('cedar serve', () => {
  it('has help configured', async () => {
    const { stdout } = await $`yarn node ${cedar} serve --help`
    expect(stdout).toMatchInlineSnapshot(`
      "cedar serve [side]

      Start a server for serving both the api and web sides

      Commands:
        cedar serve      Start a server for serving the api and web sides    [default]
        cedar serve api  Start a server for serving the api side
        cedar serve web  Start a server for serving the web side

      Options:
            --cwd                                 Working directory to use (where
                                                  \`cedar.toml\` or \`redwood.toml\` is
                                                  located)
            --load-env-files                      Load additional .env files. Values
                                                  defined in files specified later
                                                  override earlier ones.       [array]
            --telemetry                           Whether to send anonymous usage
                                                  telemetry to RedwoodJS     [boolean]
            --version                             Show version number        [boolean]
            --webPort, --web-port                 The port for the web server to
                                                  listen on                   [number]
            --webHost, --web-host                 The host for the web server to
                                                  listen on. Note that you most likely
                                                  want this to be '0.0.0.0' in
                                                  production                  [string]
            --apiPort, --api-port                 The port for the api server to
                                                  listen on                   [number]
            --apiHost, --api-host                 The host for the api server to
                                                  listen on. Note that you most likely
                                                  want this to be '0.0.0.0' in
                                                  production                  [string]
            --apiRootPath, --api-root-path,       Root path where your api functions
            --rootPath, --root-path               are served   [string] [default: "/"]
            --ud                                  Use the Universal Deploy server
                                                  (srvx) for the API side. The web
                                                  side is served by the existing
                                                  static file server. Pass --ud to opt
                                                  in; the default is Fastify for both
                                                  sides.    [boolean] [default: false]
        -h, --help                                Show help                  [boolean]

      Also see the CedarJS CLI Reference (https://cedarjs.com/docs/cli-commands#serve)
      "
    `)
  })

  it('errors out on unknown args', async () => {
    try {
      await $`yarn node ${cedar} serve --foo --bar --baz`
      expect(true).toEqual(false)
    } catch (p) {
      expect(p.exitCode).toEqual(1)
      expect(p.stdout).toEqual('')
      expect(p.stderr).toMatchInlineSnapshot(`
        "cedar serve [side]

        Start a server for serving both the api and web sides

        Commands:
          cedar serve      Start a server for serving the api and web sides    [default]
          cedar serve api  Start a server for serving the api side
          cedar serve web  Start a server for serving the web side

        Options:
              --cwd                                 Working directory to use (where
                                                    \`cedar.toml\` or \`redwood.toml\` is
                                                    located)
              --load-env-files                      Load additional .env files. Values
                                                    defined in files specified later
                                                    override earlier ones.       [array]
              --telemetry                           Whether to send anonymous usage
                                                    telemetry to RedwoodJS     [boolean]
              --version                             Show version number        [boolean]
              --webPort, --web-port                 The port for the web server to
                                                    listen on                   [number]
              --webHost, --web-host                 The host for the web server to
                                                    listen on. Note that you most likely
                                                    want this to be '0.0.0.0' in
                                                    production                  [string]
              --apiPort, --api-port                 The port for the api server to
                                                    listen on                   [number]
              --apiHost, --api-host                 The host for the api server to
                                                    listen on. Note that you most likely
                                                    want this to be '0.0.0.0' in
                                                    production                  [string]
              --apiRootPath, --api-root-path,       Root path where your api functions
              --rootPath, --root-path               are served   [string] [default: "/"]
              --ud                                  Use the Universal Deploy server
                                                    (srvx) for the API side. The web
                                                    side is served by the existing
                                                    static file server. Pass --ud to opt
                                                    in; the default is Fastify for both
                                                    sides.    [boolean] [default: false]
          -h, --help                                Show help                  [boolean]

        Also see the CedarJS CLI Reference (https://cedarjs.com/docs/cli-commands#serve)

        Unknown arguments: foo, bar, baz
        "
      `)
    }
  })
})

describe('cedarServer', () => {
  it('has help configured', async () => {
    const { stdout } = await $`yarn node ${cedarServer} --help`
    expect(stdout).toMatchInlineSnapshot(`
      "cedar-server

      Start a server for serving the api and web sides

      Commands:
        cedar-server      Start a server for serving the api and web sides   [default]
        cedar-server api  Start a server for serving the api side
        cedar-server web  Start a server for serving the web side

      Options:
            --webPort, --web-port                 The port for the web server to
                                                  listen on                   [number]
            --webHost, --web-host                 The host for the web server to
                                                  listen on. Note that you most likely
                                                  want this to be '0.0.0.0' in
                                                  production                  [string]
            --apiPort, --api-port                 The port for the api server to
                                                  listen on                   [number]
            --apiHost, --api-host                 The host for the api server to
                                                  listen on. Note that you most likely
                                                  want this to be '0.0.0.0' in
                                                  production                  [string]
            --apiRootPath, --api-root-path,       Root path where your api functions
            --rootPath, --root-path               are served   [string] [default: "/"]
        -h, --help                                Show help                  [boolean]
        -v, --version                             Show version number        [boolean]
      "
    `)
  })

  it('errors out on unknown args', async () => {
    try {
      await $`yarn node ${cedarServer} --foo --bar --baz`
      expect(true).toEqual(false)
    } catch (p) {
      expect(p.exitCode).toEqual(1)
      expect(p.stdout).toEqual('')
      expect(p.stderr).toMatchInlineSnapshot(`
        "cedar-server

        Start a server for serving the api and web sides

        Commands:
          cedar-server      Start a server for serving the api and web sides   [default]
          cedar-server api  Start a server for serving the api side
          cedar-server web  Start a server for serving the web side

        Options:
              --webPort, --web-port                 The port for the web server to
                                                    listen on                   [number]
              --webHost, --web-host                 The host for the web server to
                                                    listen on. Note that you most likely
                                                    want this to be '0.0.0.0' in
                                                    production                  [string]
              --apiPort, --api-port                 The port for the api server to
                                                    listen on                   [number]
              --apiHost, --api-host                 The host for the api server to
                                                    listen on. Note that you most likely
                                                    want this to be '0.0.0.0' in
                                                    production                  [string]
              --apiRootPath, --api-root-path,       Root path where your api functions
              --rootPath, --root-path               are served   [string] [default: "/"]
          -h, --help                                Show help                  [boolean]
          -v, --version                             Show version number        [boolean]

        Unknown arguments: foo, bar, baz
        "
      `)
    }
  })
})
