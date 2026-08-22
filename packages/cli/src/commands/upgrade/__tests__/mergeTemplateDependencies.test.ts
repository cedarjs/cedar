import { describe, expect, it } from 'vitest'

import { mergeTemplateDependencies } from '../upgradeHandler.js'

describe('mergeTemplateDependencies', () => {
  describe('non-CedarJS packages', () => {
    it('pins to the template version, adding missing ones', () => {
      const local = { devDependencies: { prettier: '3.0.0' } }

      mergeTemplateDependencies(
        'devDependencies',
        { devDependencies: { prettier: '3.8.4', typescript: '5.9.3' } },
        local,
        [],
      )

      expect(local.devDependencies).toEqual({
        prettier: '3.8.4',
        typescript: '5.9.3',
      })
    })

    it('only reports changes when verbose or dry run', () => {
      const template = { devDependencies: { prettier: '3.8.4' } }
      const quiet: string[] = []
      const loud: string[] = []

      mergeTemplateDependencies(
        'devDependencies',
        template,
        { devDependencies: { prettier: '3.0.0' } },
        quiet,
      )
      mergeTemplateDependencies(
        'devDependencies',
        template,
        { devDependencies: { prettier: '3.0.0' } },
        loud,
        { verbose: true },
      )

      expect(quiet).toEqual([])
      expect(loud).toEqual([' - prettier: 3.0.0 => 3.8.4'])
    })
  })

  describe('CedarJS packages', () => {
    it('leaves an existing one alone', () => {
      // The earlier "Updating your CedarJS version" task owns this one
      const local = { devDependencies: { '@cedarjs/eslint-config': '5.0.6' } }
      const messages: string[] = []

      mergeTemplateDependencies(
        'devDependencies',
        { devDependencies: { '@cedarjs/eslint-config': '6.0.0' } },
        local,
        messages,
        { verbose: true },
      )

      expect(local.devDependencies['@cedarjs/eslint-config']).toBe('5.0.6')
      expect(messages).toEqual([])
    })

    it('does not add a missing one', () => {
      // Indistinguishable from one the user deliberately removed
      const local: { devDependencies?: Record<string, string> } = {
        devDependencies: {},
      }
      const messages: string[] = []

      mergeTemplateDependencies(
        'devDependencies',
        { devDependencies: { '@cedarjs/forms': '6.0.0' } },
        local,
        messages,
        { verbose: true },
      )

      expect(local.devDependencies).toEqual({})
      expect(messages).toEqual([])
    })
  })

  describe('missing sections', () => {
    it('creates the section when the project has none', () => {
      const local: { dependencies?: Record<string, string> } = {}

      mergeTemplateDependencies(
        'dependencies',
        { dependencies: { react: '19.2.3' } },
        local,
        [],
      )

      expect(local.dependencies).toEqual({ react: '19.2.3' })
    })

    it('does not report against a section the project does not have', () => {
      const local: { dependencies?: Record<string, string> } = {}
      const messages: string[] = []

      mergeTemplateDependencies(
        'dependencies',
        { dependencies: { react: '19.2.3' } },
        local,
        messages,
        { verbose: true },
      )

      expect(messages).toEqual([' - react: undefined => 19.2.3'])
    })

    it('does not create a section it would leave empty', () => {
      const local: { dependencies?: Record<string, string> } = {}

      mergeTemplateDependencies('dependencies', {}, local, [])
      mergeTemplateDependencies('dependencies', { dependencies: {} }, local, [])
      // Only CedarJS packages, all of which are skipped
      mergeTemplateDependencies(
        'dependencies',
        { dependencies: { '@cedarjs/api-server': '6.0.0' } },
        local,
        [],
      )

      expect(local).toEqual({})
    })
  })
})
