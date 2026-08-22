import { describe, expect, it } from 'vitest'

import { mergeTemplateDependencies } from '../upgradeHandler.js'

const CEDAR_VERSION = '6.0.0-rc.312'

describe('mergeTemplateDependencies', () => {
  describe('CedarJS packages', () => {
    it('adds one the project is missing, at the version being upgraded to', () => {
      const local = { devDependencies: { '@cedarjs/core': CEDAR_VERSION } }
      const messages: string[] = []

      mergeTemplateDependencies(
        'devDependencies',
        // The template pins a literal version. It's whatever is on `main`, so
        // it must not end up in the project
        { devDependencies: { '@cedarjs/eslint-config': '6.0.0' } },
        local,
        CEDAR_VERSION,
        messages,
      )

      expect(local.devDependencies['@cedarjs/eslint-config']).toBe(
        CEDAR_VERSION,
      )
      expect(messages).toEqual([
        ' - @cedarjs/eslint-config: (added) => 6.0.0-rc.312',
      ])
    })

    it('reports an added package even when not verbose', () => {
      const local = { devDependencies: {} }
      const messages: string[] = []

      mergeTemplateDependencies(
        'devDependencies',
        { devDependencies: { '@cedarjs/eslint-config': '6.0.0' } },
        local,
        CEDAR_VERSION,
        messages,
        { verbose: false, dryRun: false },
      )

      expect(messages).toHaveLength(1)
    })

    it('leaves one the project already has alone', () => {
      // The earlier "Updating your CedarJS version" task owns this one
      const local = { devDependencies: { '@cedarjs/eslint-config': '5.0.6' } }
      const messages: string[] = []

      mergeTemplateDependencies(
        'devDependencies',
        { devDependencies: { '@cedarjs/eslint-config': '6.0.0' } },
        local,
        CEDAR_VERSION,
        messages,
      )

      expect(local.devDependencies['@cedarjs/eslint-config']).toBe('5.0.6')
      expect(messages).toEqual([])
    })

    it('does not duplicate one the project keeps in the other section', () => {
      const local = {
        dependencies: { '@cedarjs/api-server': '5.0.6' },
        devDependencies: {},
      }
      const messages: string[] = []

      mergeTemplateDependencies(
        'devDependencies',
        { devDependencies: { '@cedarjs/api-server': '6.0.0' } },
        local,
        CEDAR_VERSION,
        messages,
      )

      expect(local.devDependencies).toEqual({})
      expect(local.dependencies['@cedarjs/api-server']).toBe('5.0.6')
      expect(messages).toEqual([])
    })

    it('never adds @cedarjs/studio', () => {
      const local = { devDependencies: {} }
      const messages: string[] = []

      mergeTemplateDependencies(
        'devDependencies',
        { devDependencies: { '@cedarjs/studio': '6.0.0' } },
        local,
        CEDAR_VERSION,
        messages,
      )

      expect(local.devDependencies).toEqual({})
      expect(messages).toEqual([])
    })
  })

  describe('non-CedarJS packages', () => {
    it('pins to the template version, adding missing ones', () => {
      const local = { devDependencies: { prettier: '3.0.0' } }
      const messages: string[] = []

      mergeTemplateDependencies(
        'devDependencies',
        { devDependencies: { prettier: '3.8.4', typescript: '5.9.3' } },
        local,
        CEDAR_VERSION,
        messages,
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
        CEDAR_VERSION,
        quiet,
      )
      mergeTemplateDependencies(
        'devDependencies',
        template,
        { devDependencies: { prettier: '3.0.0' } },
        CEDAR_VERSION,
        loud,
        { verbose: true },
      )

      expect(quiet).toEqual([])
      expect(loud).toEqual([' - prettier: 3.0.0 => 3.8.4'])
    })
  })

  describe('missing sections', () => {
    it('creates the section when the project has none', () => {
      const local: { dependencies?: Record<string, string> } = {}
      const messages: string[] = []

      mergeTemplateDependencies(
        'dependencies',
        { dependencies: { '@cedarjs/api-server': '6.0.0' } },
        local,
        CEDAR_VERSION,
        messages,
      )

      expect(local.dependencies).toEqual({
        '@cedarjs/api-server': CEDAR_VERSION,
      })
    })

    it('does not create an empty section the template does not have', () => {
      const local: { dependencies?: Record<string, string> } = {}

      mergeTemplateDependencies('dependencies', {}, local, CEDAR_VERSION, [])
      mergeTemplateDependencies(
        'dependencies',
        { dependencies: {} },
        local,
        CEDAR_VERSION,
        [],
      )

      expect(local).toEqual({})
    })
  })
})
