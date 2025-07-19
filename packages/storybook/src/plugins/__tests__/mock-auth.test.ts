import type { PluginOption } from 'vite'
import { describe, it, expect } from 'vitest'

import { mockAuth } from '../mock-auth.js'

describe('mockAuth plugin', () => {
  const plugin = mockAuth() as PluginOption & { transform: () => unknown }
  const transform = plugin.transform

  describe('file filtering', () => {
    it('should not transform files that do not contain "web/src/auth" in id', () => {
      const code =
        "import { createDbAuthClient, createAuth } from '@cedarjs/auth-dbauth-web'"
      const result = transform(code, 'src/components/Button.tsx')
      expect(result).toBe(code)
    })

    it('should transform files that contain "web/src/auth" in id', () => {
      const code = "import { createAuth } from '@cedarjs/auth-dbauth-web'"
      const result = transform(code, 'web/src/auth/index.ts')
      expect(result).not.toBe(code)
      expect(result).toContain(
        "import { createAuthentication as createAuth } from '@cedarjs/testing/auth'",
      )
    })
  })

  describe('createAuth import removal', () => {
    it('should remove single createAuth import', () => {
      const code = "import { createAuth } from '@cedarjs/auth-dbauth-web'"
      const result = transform(code, 'web/src/auth/index.ts')

      expect(result).toContain(
        "import { createAuthentication as createAuth } from '@cedarjs/testing/auth'",
      )
      expect(result).toContain("import {  } from '@cedarjs/auth-dbauth-web'")
    })

    it('should remove createAuth from beginning of import list', () => {
      const code =
        "import { createAuth, useAuth, logout } from '@cedarjs/auth-dbauth-web'"
      const result = transform(code, 'web/src/auth/index.ts')

      expect(result).toContain(
        "import {  useAuth, logout } from '@cedarjs/auth-dbauth-web'",
      )
    })

    it('should remove createAuth from middle of import list', () => {
      const code =
        "import { useAuth, createAuth, logout } from '@cedarjs/auth-dbauth-web'"
      const result = transform(code, 'web/src/auth/index.ts')

      expect(result).toContain(
        "import { useAuth,  logout } from '@cedarjs/auth-dbauth-web'",
      )
    })

    it('should remove createAuth from end of import list', () => {
      const code =
        "import { useAuth, logout, createAuth } from '@cedarjs/auth-dbauth-web'"
      const result = transform(code, 'web/src/auth/index.ts')

      expect(result).toContain(
        "import { useAuth, logout,  } from '@cedarjs/auth-dbauth-web'",
      )
    })

    it('should handle whitespace variations', () => {
      const testCases = [
        "import {createAuth} from '@cedarjs/auth-dbauth-web'",
        "import { createAuth } from '@cedarjs/auth-dbauth-web'",
        "import {  createAuth  } from '@cedarjs/auth-dbauth-web'",
        "import {\tcreateAuth\t} from '@cedarjs/auth-dbauth-web'",
        "import {\n  createAuth\n} from '@cedarjs/auth-dbauth-web'",
      ]

      testCases.forEach((code) => {
        const result = transform(code, 'web/src/auth/index.ts')
        expect(result).toContain(
          "import { createAuthentication as createAuth } from '@cedarjs/testing/auth'",
        )
        // Should remove createAuth but preserve import structure
        expect(result).toMatch(/import\s*{\s*}\s*from/)
        expect(result).not.toMatch(/createAuth\s*?}\s*?@cedarjs\/auth/)
      })
    })

    it('should handle multiple import statements', () => {
      const code = `
        import { createAuth, useAuth } from '@cedarjs/auth-dbauth-web'
        import { createAuth as ca } from 'other-lib'
        import { Button } from './Button'
      `
      const result = transform(code, 'web/src/auth/index.ts')

      // Should only affect the first import with createAuth
      expect(result).toContain(
        "import {  useAuth } from '@cedarjs/auth-dbauth-web'",
      )
      expect(result).toContain("import { createAuth as ca } from 'other-lib'")
      expect(result).toContain("import { Button } from './Button'")
    })

    it('should not affect createAuth in other contexts', () => {
      const code = `
        import { useAuth } from '@cedarjs/auth-dbauth-web'
        const createAuth = () => {}
        // createAuth is a function
      `
      const result = transform(code, 'web/src/auth/index.ts')

      expect(result).toContain('const createAuth = () => {}')
      expect(result).toContain('// createAuth is a function')
    })
  })

  describe('import addition', () => {
    it('should add mocked createAuth import at the top', () => {
      const code =
        "import { useAuth } from '@cedarjs/auth-dbauth-web'\n" +
        'export const auth = useAuth()'
      const result = transform(code, 'web/src/auth/index.ts')

      const lines = result.split('\n')
      expect(lines[0]).toBe(
        "import { createAuthentication as createAuth } from '@cedarjs/testing/auth'",
      )
    })

    it('should handle empty files', () => {
      const code = ''
      const result = transform(code, 'web/src/auth/index.ts')

      expect(result).toBe(
        "import { createAuthentication as createAuth } from '@cedarjs/testing/auth'\n",
      )
    })

    it('should handle files without imports', () => {
      const code = 'export const config = {}'
      const result = transform(code, 'web/src/auth/index.ts')

      expect(result).toContain(
        "import { createAuthentication as createAuth } from '@cedarjs/testing/auth'",
      )
      expect(result).toContain('export const config = {}')
    })
  })

  describe('regex performance and edge cases', () => {
    it('should handle files with many repetitive patterns efficiently', () => {
      // This test addresses the CodeQL warning about regex performance
      const imports = Array(100).fill('import{other}').join('')
      const code = `${imports}import{createAuth}from'@cedarjs/auth-dbauth-web'`

      const start = Date.now()
      const result = transform(code, 'web/src/auth/index.ts')
      const end = Date.now()

      // Should complete in reasonable time (less than 100ms)
      expect(end - start).toBeLessThan(100)
      expect(result).toContain(
        "import { createAuthentication as createAuth } from '@cedarjs/testing/auth'",
      )
    })

    it('should handle strings with many tab characters', () => {
      // Specific test for the CodeQL warning about tab repetitions
      const manyTabs = '\t'.repeat(1000)
      const code = `import {${manyTabs}createAuth${manyTabs}} from '@cedarjs/auth-dbauth-web'`

      const start = Date.now()
      const result = transform(code, 'web/src/auth/index.ts')
      const end = Date.now()

      expect(end - start).toBeLessThan(100)
      expect(result).toContain(
        "import { createAuthentication as createAuth } from '@cedarjs/testing/auth'",
      )
    })

    it('should not match createAuth as part of other identifiers', () => {
      const code = `import { createAuthToken, mycreateAuth } from '@cedarjs/auth-dbauth-web'`
      const result = transform(code, 'web/src/auth/index.ts')

      // Should not modify these since they're not exact word matches
      expect(result).toContain('createAuthToken')
      expect(result).toContain('mycreateAuth')
    })

    it('should handle malformed import statements gracefully', () => {
      const testCases = [
        'import { from "@cedarjs/auth-dbauth-web"', // Missing closing brace
        'import createAuth } from "@cedarjs/auth-dbauth-web"', // Missing opening brace
        'import { createAuth from "@cedarjs/auth-dbauth-web"', // Missing closing brace and }
      ]

      testCases.forEach((code) => {
        expect(() => {
          const result = transform(code, 'web/src/auth/index.ts')
          // Should not crash and should add the mock import
          expect(result).toContain(
            "import { createAuthentication as createAuth } from '@cedarjs/testing/auth'",
          )
        }).not.toThrow()
      })
    })
  })

  describe('complete transformation examples', () => {
    it('should transform a typical auth file correctly', () => {
      const code = `import { createDbAuthClient, createAuth } from '@cedarjs/auth-dbauth-web'

const dbAuthClient = createDbAuthClient()

export const { AuthProvider, useAuth } = createAuth(dbAuthClient)
`

      const result = transform(code, 'web/src/auth/index.ts')

      expect(result).toMatchInlineSnapshot(`
        "import { createAuthentication as createAuth } from '@cedarjs/testing/auth'
        import { createDbAuthClient,  } from '@cedarjs/auth-dbauth-web'

        const dbAuthClient = createDbAuthClient()

        export const { AuthProvider, useAuth } = createAuth(dbAuthClient)
        "
      `)
    })
  })
})
