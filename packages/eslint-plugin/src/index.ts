import type { ESLintUtils } from '@typescript-eslint/utils'

import pkgJson from '../package.json' with { type: 'json' }

import { processEnvComputedRule } from './process-env-computed.js'
import { serviceTypeAnnotations } from './service-type-annotations.js'
import { unsupportedRouteComponents } from './unsupported-route-components.js'

export const meta = {
  name: '@cedarjs/eslint-plugin',
  version: pkgJson.version,
}

export const rules = {
  'process-env-computed': processEnvComputedRule,
  'service-type-annotations': serviceTypeAnnotations,
  'unsupported-route-components': unsupportedRouteComponents,
} satisfies Record<string, ESLintUtils.RuleModule<string>>

const plugin = { meta, rules }

export default plugin
