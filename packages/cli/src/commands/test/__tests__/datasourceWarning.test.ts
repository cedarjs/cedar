import Enquirer from 'enquirer'
import { fs as memfs, vol } from 'memfs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { warnIfNonStandardDatasourceUrl } from '../datasourceWarning.js'

vi.mock('node:fs', () => ({ ...memfs, default: { ...memfs } }))

vi.mock('enquirer', () => ({
  default: {
    prompt: vi.fn(),
  },
}))

vi.mock('@cedarjs/project-config', () => ({
  getPaths: () => ({
    api: {
      prismaConfig: 'project/api/prisma.config.ts',
    },
  }),
}))

beforeEach(() => {
  vol.reset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(process, 'exit').mockImplementation(
    (_code?: string | number | null) => {
      throw new Error('process.exit called')
    },
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('warnIfNonStandardDatasourceUrl', () => {
  describe('when there is no prisma config file', () => {
    it('returns without warning or prompting', async () => {
      vol.fromJSON({}, 'project')

      await warnIfNonStandardDatasourceUrl()

      expect(console.warn).not.toHaveBeenCalled()
      expect(Enquirer.prompt).not.toHaveBeenCalled()
    })
  })

  describe('when the datasource url uses DATABASE_URL', () => {
    it('does not warn or prompt for a multi-line env() config', async () => {
      vol.fromJSON({
        'project/api/prisma.config.ts': `
          export default defineConfig({
            datasource: {
              url: env('DATABASE_URL'),
            },
          })
        `,
      })

      await warnIfNonStandardDatasourceUrl()

      expect(console.warn).not.toHaveBeenCalled()
      expect(Enquirer.prompt).not.toHaveBeenCalled()
    })

    it('does not warn or prompt for a multi-line env() config with an eol comment', async () => {
      vol.fromJSON({
        'project/api/prisma.config.ts': `
          export default defineConfig({
            datasource: {
              url: env('DATABASE_URL'), // some comment
            },
          })
        `,
      })

      await warnIfNonStandardDatasourceUrl()

      expect(console.warn).not.toHaveBeenCalled()
      expect(Enquirer.prompt).not.toHaveBeenCalled()
    })

    it('does not warn or prompt for a multi-line process.env config', async () => {
      vol.fromJSON({
        'project/api/prisma.config.ts': `
          export default defineConfig({
            datasource: {
              url: process.env.DATABASE_URL,
            },
          })
        `,
      })

      await warnIfNonStandardDatasourceUrl()

      expect(console.warn).not.toHaveBeenCalled()
      expect(Enquirer.prompt).not.toHaveBeenCalled()
    })

    it('does not warn or prompt for a multi-line process.env config with an eol comment', async () => {
      vol.fromJSON({
        'project/api/prisma.config.ts': `
          export default defineConfig({
            datasource: {
              url: process.env.DATABASE_URL, // some comment
            },
          })
        `,
      })

      await warnIfNonStandardDatasourceUrl()

      expect(console.warn).not.toHaveBeenCalled()
      expect(Enquirer.prompt).not.toHaveBeenCalled()
    })

    it('does not warn or prompt for a single-line env() config', async () => {
      vol.fromJSON({
        'project/api/prisma.config.ts':
          "export default defineConfig({ datasource: { url: env('DATABASE_URL') } })",
      })

      await warnIfNonStandardDatasourceUrl()

      expect(console.warn).not.toHaveBeenCalled()
      expect(Enquirer.prompt).not.toHaveBeenCalled()
    })

    it('does not warn or prompt for a single-line env() config with an eol comment', async () => {
      vol.fromJSON({
        'project/api/prisma.config.ts':
          "export default defineConfig({ datasource: { url: env('DATABASE_URL') } }) // some comment",
      })

      await warnIfNonStandardDatasourceUrl()

      expect(console.warn).not.toHaveBeenCalled()
      expect(Enquirer.prompt).not.toHaveBeenCalled()
    })

    it('does not warn or prompt for a single-line process.env config', async () => {
      vol.fromJSON({
        'project/api/prisma.config.ts':
          'export default defineConfig({ datasource: { url: process.env.DATABASE_URL } })',
      })

      await warnIfNonStandardDatasourceUrl()

      expect(console.warn).not.toHaveBeenCalled()
      expect(Enquirer.prompt).not.toHaveBeenCalled()
    })

    it('does not warn or prompt for a single-line process.env config with an eol comment', async () => {
      vol.fromJSON({
        'project/api/prisma.config.ts':
          'export default defineConfig({ datasource: { url: process.env.DATABASE_URL } }) // some comment',
      })

      await warnIfNonStandardDatasourceUrl()

      expect(console.warn).not.toHaveBeenCalled()
      expect(Enquirer.prompt).not.toHaveBeenCalled()
    })

    it('does not warn or prompt for a commented-out non-standard env var', async () => {
      vol.fromJSON({
        'project/api/prisma.config.ts': `
          export default defineConfig({
            datasource: {
              // url: process.env.MY_DATABASE_URL,
              url: process.env.DATABASE_URL,
            },
          })
        `,
      })

      await warnIfNonStandardDatasourceUrl()

      expect(console.warn).not.toHaveBeenCalled()
      expect(Enquirer.prompt).not.toHaveBeenCalled()
    })
  })

  describe('when the datasource url uses a non-standard env var', () => {
    it('warns and prompts when using multi-line env() syntax', async () => {
      vol.fromJSON({
        'project/api/prisma.config.ts': `
          export default defineConfig({
            datasource: {
              url: env('MY_DATABASE_URL'),
            },
          })
        `,
      })

      vi.mocked(Enquirer.prompt).mockResolvedValue({ proceed: true })

      await warnIfNonStandardDatasourceUrl()

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('"MY_DATABASE_URL"'),
      )
      expect(Enquirer.prompt).toHaveBeenCalledOnce()
    })

    it('warns and prompts when using multi-line env() syntax with an eol comment', async () => {
      vol.fromJSON({
        'project/api/prisma.config.ts': `
          export default defineConfig({
            datasource: {
              url: env('MY_DATABASE_URL'), // some comment
            },
          })
        `,
      })

      vi.mocked(Enquirer.prompt).mockResolvedValue({ proceed: true })

      await warnIfNonStandardDatasourceUrl()

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('"MY_DATABASE_URL"'),
      )
      expect(Enquirer.prompt).toHaveBeenCalledOnce()
    })

    it('warns and prompts when using multi-line process.env syntax', async () => {
      vol.fromJSON({
        'project/api/prisma.config.ts': `
          export default defineConfig({
            datasource: {
              url: process.env.MY_DATABASE_URL,
            },
          })
        `,
      })

      vi.mocked(Enquirer.prompt).mockResolvedValue({ proceed: true })

      await warnIfNonStandardDatasourceUrl()

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('"MY_DATABASE_URL"'),
      )
      expect(Enquirer.prompt).toHaveBeenCalledOnce()
    })

    it('warns and prompts when using multi-line process.env syntax with an eol comment', async () => {
      vol.fromJSON({
        'project/api/prisma.config.ts': `
          export default defineConfig({
            datasource: {
              url: process.env.MY_DATABASE_URL, // some comment
            },
          })
        `,
      })

      vi.mocked(Enquirer.prompt).mockResolvedValue({ proceed: true })

      await warnIfNonStandardDatasourceUrl()

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('"MY_DATABASE_URL"'),
      )
      expect(Enquirer.prompt).toHaveBeenCalledOnce()
    })

    it('warns and prompts when using single-line env() syntax', async () => {
      vol.fromJSON({
        'project/api/prisma.config.ts':
          "export default defineConfig({ datasource: { url: env('MY_DATABASE_URL') } })",
      })

      vi.mocked(Enquirer.prompt).mockResolvedValue({ proceed: true })

      await warnIfNonStandardDatasourceUrl()

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('"MY_DATABASE_URL"'),
      )
      expect(Enquirer.prompt).toHaveBeenCalledOnce()
    })

    it('warns and prompts when using single-line env() syntax with an eol comment', async () => {
      vol.fromJSON({
        'project/api/prisma.config.ts':
          "export default defineConfig({ datasource: { url: env('MY_DATABASE_URL') } }) // some comment",
      })

      vi.mocked(Enquirer.prompt).mockResolvedValue({ proceed: true })

      await warnIfNonStandardDatasourceUrl()

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('"MY_DATABASE_URL"'),
      )
      expect(Enquirer.prompt).toHaveBeenCalledOnce()
    })

    it('warns and prompts when using single-line process.env syntax', async () => {
      vol.fromJSON({
        'project/api/prisma.config.ts':
          'export default defineConfig({ datasource: { url: process.env.MY_DATABASE_URL } })',
      })

      vi.mocked(Enquirer.prompt).mockResolvedValue({ proceed: true })

      await warnIfNonStandardDatasourceUrl()

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('"MY_DATABASE_URL"'),
      )
      expect(Enquirer.prompt).toHaveBeenCalledOnce()
    })

    it('warns and prompts when using single-line process.env syntax with an eol comment', async () => {
      vol.fromJSON({
        'project/api/prisma.config.ts':
          'export default defineConfig({ datasource: { url: process.env.MY_DATABASE_URL } }) // some comment',
      })

      vi.mocked(Enquirer.prompt).mockResolvedValue({ proceed: true })

      await warnIfNonStandardDatasourceUrl()

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('"MY_DATABASE_URL"'),
      )
      expect(Enquirer.prompt).toHaveBeenCalledOnce()
    })

    describe('prompting', () => {
      it('when the user confirms, it does not exit the process', async () => {
        vol.fromJSON({
          'project/api/prisma.config.ts': `
            export default defineConfig({
              datasource: {
                url: env('MY_DATABASE_URL'),
              },
            })
          `,
        })

        vi.mocked(Enquirer.prompt).mockResolvedValue({ proceed: true })

        await expect(warnIfNonStandardDatasourceUrl()).resolves.not.toThrow()

        expect(process.exit).not.toHaveBeenCalled()
      })

      it('when the user declines, it logs "Aborting." and exits with code 1', async () => {
        vol.fromJSON({
          'project/api/prisma.config.ts': `
            export default defineConfig({
              datasource: {
                url: env('MY_DATABASE_URL'),
              },
            })
          `,
        })

        vi.mocked(Enquirer.prompt).mockResolvedValue({ proceed: false })

        await expect(warnIfNonStandardDatasourceUrl()).rejects.toThrow(
          'process.exit called',
        )

        expect(console.log).toHaveBeenCalledWith('Aborting.')
        expect(process.exit).toHaveBeenCalledWith(1)
      })
    })
  })
})
