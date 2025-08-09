import type { PluginOption } from 'vite'

export function mockRouter(): PluginOption {
  return {
    name: 'mock-@cedarjs/router',
    enforce: 'pre',
    transform(code: string, id: string) {
      if (id.includes('src')) {
        code = code.replace(
          "'@cedarjs/router'",
          "'storybook-framework-cedarjs/dist/mocks/MockRouter'",
        )
      }
      return code
    },
  }
}
