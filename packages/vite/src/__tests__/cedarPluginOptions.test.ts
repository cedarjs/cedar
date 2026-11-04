import { describe, expect, it } from 'vitest'

import { cedar } from '../index.js'

describe('cedar()', () => {
  it('throws when it gets a babel option', () => {
    expect(() =>
      cedar({
        mode: 'production',
        // @ts-expect-error - `babel` isn't a cedar() option. JavaScript configs
        // can still pass it, which is what this test is about
        babel: { plugins: ['my-babel-plugin'] },
      }),
    ).toThrow("`cedar()` doesn't take a `babel` option")
  })
})
