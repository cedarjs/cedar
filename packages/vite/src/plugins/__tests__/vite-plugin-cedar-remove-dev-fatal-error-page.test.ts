import { describe, it, expect, beforeEach } from 'vitest'

import { cedarRemoveDevFatalErrorPage } from '../vite-plugin-cedar-remove-dev-fatal-error-page.js'

function transform(code: string) {
  const plugin = cedarRemoveDevFatalErrorPage()

  if (typeof plugin.transform !== 'function') {
    throw new Error('Expected plugin to have a transform function')
  }

  // Cast to bypass the overloaded signature — we only care about the string return
  const result = (plugin.transform as (code: string, id: string) => unknown)(
    code,
    'FatalErrorPage.tsx',
  )

  return result
}

describe('cedarRemoveDevFatalErrorPage', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'production'
  })
  it('replaces the DevFatalErrorPage import with undefined', () => {
    const code = `import { DevFatalErrorPage } from '@cedarjs/web/dist/components/DevFatalErrorPage'

export default DevFatalErrorPage || (() => <div>Error</div>)`

    const result = transform(code)

    expect(result).toEqual({
      code: `const DevFatalErrorPage = undefined

export default DevFatalErrorPage || (() => <div>Error</div>)`,
    })
  })

  it('returns null when the import is not present', () => {
    const code = `import React from 'react'

export default () => <div>Hello</div>`

    const result = transform(code)

    expect(result).toBeNull()
  })

  it('handles extra whitespace in the import braces', () => {
    const code = `import {  DevFatalErrorPage  } from '@cedarjs/web/dist/components/DevFatalErrorPage'`

    const result = transform(code) as { code: string }

    expect(result.code).toBe('const DevFatalErrorPage = undefined')
  })

  it('handles double quotes in the import', () => {
    const code = `import { DevFatalErrorPage } from "@cedarjs/web/dist/components/DevFatalErrorPage"`

    const result = transform(code) as { code: string }

    expect(result.code).toBe('const DevFatalErrorPage = undefined')
  })

  it('returns null when NODE_ENV is development', () => {
    process.env.NODE_ENV = 'development'

    const code = `import { DevFatalErrorPage } from '@cedarjs/web/dist/components/DevFatalErrorPage'

export default DevFatalErrorPage || (() => <div>Error</div>)`

    const result = transform(code)

    expect(result).toBeNull()
  })
})
