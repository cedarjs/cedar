import fs from 'node:fs'
import path from 'node:path'

import { format } from 'prettier'

import { getPaths } from '@cedarjs/project-config'

const getPrettierConfig = async () => {
  const basePath = getPaths().base
  const prettierConfigCjsPath = path.join(basePath, 'prettier.config.cjs')
  const prettierConfigMjsPath = path.join(basePath, 'prettier.config.mjs')
  const prettierConfigPath = fs.existsSync(prettierConfigCjsPath)
    ? prettierConfigCjsPath
    : prettierConfigMjsPath

  try {
    const { default: prettierConfig } = await import(
      `file://${prettierConfigPath}`
    )
    return prettierConfig
  } catch {
    return undefined
  }
}

const prettify = async (code: string, options: Record<string, any> = {}) => {
  const prettierConfig = await getPrettierConfig()
  return format(code, {
    singleQuote: true,
    semi: false,
    ...prettierConfig,
    parser: 'babel',
    ...options,
  })
}

export default prettify
