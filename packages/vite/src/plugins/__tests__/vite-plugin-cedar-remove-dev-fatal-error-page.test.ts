import dedent from 'ts-dedent'
import type { ResolvedConfig } from 'vite'
import { describe, it, expect, beforeEach } from 'vitest'

import { cedarRemoveDevFatalErrorPage } from '../vite-plugin-cedar-remove-dev-fatal-error-page.js'

function getPluginTransform(mode?: string) {
  const plugin = cedarRemoveDevFatalErrorPage()

  if (typeof plugin.configResolved !== 'function') {
    expect.fail('Expected plugin to have a configResolved function')
  }

  if (typeof plugin.transform !== 'function') {
    expect.fail('Expected plugin to have a transform function')
  }

  // Mock ResolvedConfig with minimal required fields (so we don't have to
  // provide ~35 fields with dummy values)
  const config = {
    command: 'build',
    mode,
  } as ResolvedConfig

  // Calling `bind` to please TS
  // See https://stackoverflow.com/a/70463512/88106
  // Typecasting because we're only going to call transform, and we don't need
  // anything provided by the context.
  // This used to be `{} as TransformPluginContext`, but that requires transient
  // dependencies to match versions. Using `ThisParameterType` is more resilient
  plugin.configResolved.bind(
    {} as ThisParameterType<typeof plugin.configResolved>,
  )(config)

  return plugin.transform.bind({} as ThisParameterType<typeof plugin.transform>)
}

describe('cedarRemoveDevFatalErrorPage', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'production'
  })

  it('replaces the DevFatalErrorPage import with undefined', () => {
    const code = dedent`
      import { DevFatalErrorPage } from '@cedarjs/web/dist/components/DevFatalErrorPage'

      export default DevFatalErrorPage || (() => <div>Error</div>)
    `

    const transform = getPluginTransform()
    const result = transform(code, 'FatalErrorPage.tsx')

    expect(result).toEqual({
      code: dedent`
        const DevFatalErrorPage = undefined

        export default DevFatalErrorPage || (() => <div>Error</div>)
      `,
      map: null,
    })
  })

  it('returns null when the import is not present', () => {
    const code = dedent`
      import React from 'react'

      export default () => <div>Hello</div>
    `

    const transform = getPluginTransform()
    const result = transform(code, 'FatalErrorPage.tsx')

    expect(result).toBeNull()
  })

  it('handles extra whitespace in the import braces', () => {
    const code = dedent`
      import {  DevFatalErrorPage  } from '@cedarjs/web/dist/components/DevFatalErrorPage'
    `

    const transform = getPluginTransform()
    const result = transform(code, 'FatalErrorPage.tsx')

    expect(result).toEqual({
      code: 'const DevFatalErrorPage = undefined',
      map: null,
    })
  })

  it('handles double quotes in the import', () => {
    const code = dedent`
      import { DevFatalErrorPage } from "@cedarjs/web/dist/components/DevFatalErrorPage"
    `

    const transform = getPluginTransform()
    const result = transform(code, 'FatalErrorPage.tsx')

    expect(result).toEqual({
      code: 'const DevFatalErrorPage = undefined',
      map: null,
    })
  })

  it('returns null when mode is development', () => {
    const code = dedent`
      import { DevFatalErrorPage } from '@cedarjs/web/dist/components/DevFatalErrorPage'

      export default DevFatalErrorPage || (() => <div>Error</div>)
    `

    const transform = getPluginTransform('development')
    const result = transform(code, 'FatalErrorPage.tsx')

    expect(result).toBeNull()
  })
})
