import { createRequire } from 'node:module'
import path from 'node:path'

import { getPaths } from '@cedarjs/project-config'

export async function runScriptFunction({
  path: scriptPath,
  functionName,
  args,
}) {
  const createdRequire = createRequire(import.meta.url)
  const script = createdRequire(scriptPath)
  const returnValue = await script[functionName](args)

  try {
    const { db } = createdRequire(path.join(getPaths().api.lib, 'db'))
    db.$disconnect()
  } catch (e) {
    // silence
  }

  return returnValue
}
