import { describe, it, expect } from 'vitest'
import yargs from 'yargs'

import { commandForTelemetry } from '../commandForTelemetry.js'

/**
 * Parses `args` with command definitions modelled on Cedar's CLI, and returns
 * what `commandForTelemetry` describes from inside a middleware
 */
async function describe_(args: string[]) {
  let description: string | undefined

  await yargs(args)
    .option('cwd', { type: 'string' })
    .option('load-env-files', { type: 'string', array: true })
    .option('telemetry', { type: 'boolean' })
    .middleware([
      (argv, instance) => {
        delete argv.cwd
        delete argv['load-env-files']
        description = commandForTelemetry(argv, instance, args)
      },
    ])
    .command(['generate <type>', 'g'], 'generate', (y) =>
      y
        .command(
          'page <name> [path]',
          'page',
          (y) =>
            y
              .positional('name', { type: 'string' })
              .positional('path', { type: 'string' })
              .option('force', { alias: 'f', type: 'boolean' }),
          () => {},
        )
        .demandCommand(),
    )
    .command(
      'setup <command>',
      'setup',
      (y) =>
        y.command(
          'deploy <target>',
          'deploy',
          (y) =>
            y.command(
              'baremetal',
              'baremetal',
              (y) => y.option('monitor', { type: 'string' }),
              () => {},
            ),
          () => {},
        ),
      () => {},
    )
    .command(
      'build [workspace..]',
      'build',
      (y) => y.option('verbose', { alias: 'v', type: 'boolean' }),
      () => {},
    )
    .command(
      'serve [side]',
      'serve',
      (y) =>
        y
          .option('apiHost', { type: 'string' })
          .option('socket', { type: 'string' }),
      () => {},
    )
    .command(['data-migrate <command>', 'dm'], 'data-migrate', (y) =>
      y.command(
        'up',
        'up',
        (y) =>
          y
            .option('dist-path', { alias: 'd', type: 'string' })
            .option('verbose', { alias: 'v', type: 'boolean' })
            .option('force', { alias: 'f', type: 'boolean' }),
        () => {},
      ),
    )
    .command(
      'exec [name]',
      'exec',
      (y) =>
        y
          .option('prisma', { type: 'boolean', default: true })
          .option('silent', { alias: 's', type: 'boolean' })
          .strict(false),
      () => {},
    )
    .command(
      'prisma [commands..]',
      'prisma',
      (y) =>
        y
          .strict(false)
          .parserConfiguration({ 'camel-case-expansion': false })
          .help(false)
          .version(false),
      () => {},
    )
    .parseAsync()

  return description
}

describe('commandForTelemetry', () => {
  it('uses canonical command names and placeholders for positionals', async () => {
    expect(
      await describe_(['g', 'page', 'Payroll', '/payroll', '--force']),
    ).toEqual('generate page [name] [path] --force')
  })

  it('leaves out positionals that were not given', async () => {
    expect(await describe_(['generate', 'page', 'Payroll'])).toEqual(
      'generate page [name]',
    )
    expect(await describe_(['build'])).toEqual('build')
  })

  it('replaces variadic positionals with one placeholder', async () => {
    expect(await describe_(['build', 'api', 'acme-billing'])).toEqual(
      'build [workspace]',
    )
  })

  it('keeps nested subcommands', async () => {
    expect(
      await describe_(['setup', 'deploy', 'baremetal', '--monitor', 'pm2']),
    ).toEqual('setup deploy baremetal --monitor [monitor]')
  })

  it('replaces option values with placeholders', async () => {
    expect(
      await describe_([
        'serve',
        'api',
        '--apiHost=http://10.0.3.7:8911',
        '--socket',
        '/run/acme.sock',
      ]),
    ).toEqual('serve [side] --apiHost [apiHost] --socket [socket]')
  })

  it('keeps boolean flags, including short and negated ones', async () => {
    expect(await describe_(['build', '-v'])).toEqual('build -v')
    expect(await describe_(['exec', 'seed', '--no-prisma'])).toEqual(
      'exec [name] --no-prisma',
    )
  })

  it('keeps every flag in a group of short options', async () => {
    expect(await describe_(['data-migrate', 'up', '-vf'])).toEqual(
      'data-migrate up -v -f',
    )
    expect(
      await describe_(['data-migrate', 'up', '-vdtenant-acme/dist']),
    ).toEqual('data-migrate up -v -d [dist-path]')
  })

  it('stops reading a short-option group at an undeclared option', async () => {
    expect(await describe_(['prisma', 'migrate', 'dev', '-pSecret'])).toEqual(
      'prisma [commands] -p',
    )
    expect(await describe_(['data-migrate', 'up', '-vxSecret'])).toEqual(
      'data-migrate up -v -x',
    )
  })

  it('keeps short aliases of options exec declares', async () => {
    expect(await describe_(['exec', 'seed', '-s', '-xSecret'])).toEqual(
      'exec [name] -s',
    )
  })

  it('replaces values attached to short options', async () => {
    expect(
      await describe_(['data-migrate', 'up', '-dtenant-acme/dist']),
    ).toEqual('data-migrate up -d [dist-path]')
  })

  it('replaces values of global options, even after they are removed from argv', async () => {
    expect(
      await describe_(['--cwd', '/Users/ada/acme', 'build', '--telemetry']),
    ).toEqual('build --cwd [cwd] --telemetry')
    expect(
      await describe_(['exec', 'seed', '--load-env-files', 'acme']),
    ).toEqual('exec [name] --load-env-files [load-env-files]')
  })

  it('keeps option names forwarded to wrapped tools', async () => {
    expect(
      await describe_(['prisma', 'migrate', 'dev', '--name', 'add-payroll']),
    ).toEqual('prisma [commands] --name [name]')
    expect(
      await describe_(['prisma', 'migrate', 'dev', '--create-only']),
    ).toEqual('prisma [commands] --create-only')
  })

  it("drops options exec forwards to the user's script", async () => {
    expect(
      await describe_(['exec', 'seed', '--tenant-acme', 'x', '--silent']),
    ).toEqual('exec [name] --silent')
  })

  it('leaves out everything after --', async () => {
    expect(await describe_(['exec', 'seed', '--', '--tenant', 'acme'])).toEqual(
      'exec [name]',
    )
  })

  it('returns undefined without a yargs instance', () => {
    expect(commandForTelemetry({}, undefined, ['build'])).toBeUndefined()
  })
})
