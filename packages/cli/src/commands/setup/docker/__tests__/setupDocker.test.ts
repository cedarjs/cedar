import { vi, test, describe, expect } from 'vitest'

import { recordTelemetryAttributes } from '@cedarjs/cli-helpers'

import { command, description, builder, handler } from '../docker.js'

vi.mock('../dockerHandler.js')

vi.mock('@cedarjs/cli-helpers', () => {
  return {
    colors: Object.fromEntries(
      [
        'error',
        'warning',
        'highlight',
        'success',
        'info',
        'bold',
        'underline',
        'note',
        'tip',
        'important',
        'caution',
        'link',
      ].map((k) => [k, (s: string) => s]),
    ),
    recordTelemetryAttributes: vi.fn(),
  }
})

describe('setupDocker', () => {
  test("command didn't change unintentionally", () => {
    expect(command).toMatchInlineSnapshot(`"docker"`)
  })

  test("description didn't change unintentionally", () => {
    expect(description).toMatchInlineSnapshot(
      `"Setup the default Cedar Dockerfile"`,
    )
  })

  test('builder configures command options force and verbose ', () => {
    const mockYargs = {
      option: vi.fn(),
      epilogue: vi.fn(),
    }
    mockYargs.option.mockReturnValue(mockYargs)
    mockYargs.epilogue.mockReturnValue(mockYargs)

    builder(mockYargs)

    expect(mockYargs.option.mock.calls[0][0]).toMatchInlineSnapshot(`"force"`)
    expect(mockYargs.option.mock.calls[0][1]).toMatchInlineSnapshot(`
      {
        "alias": "f",
        "default": false,
        "description": "Overwrite existing configuration",
        "type": "boolean",
      }
    `)
  })

  test('the handler calls recordTelemetryAttributes', async () => {
    await handler({})

    expect(recordTelemetryAttributes).toHaveBeenCalledWith({
      command: 'setup docker',
      force: undefined,
      verbose: undefined,
    })
  })
})
