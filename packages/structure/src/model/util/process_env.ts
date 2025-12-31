import fs from 'node:fs'
import path from 'node:path'

import * as tsm from 'ts-morph'

import { globSync } from '../../x/path'
import { createTSMSourceFile_cached } from '../../x/ts-morph'

export function process_env_findAll(dir: string) {
  const globPath = path.join(dir, 'src/**/*.{js,ts,jsx,tsx}')
  return globSync(globPath).flatMap((file) =>
    process_env_findInFile(file, fs.readFileSync(file).toString()),
  )
}

export function process_env_findInFile(
  filePath: string,
  text: string,
): { key: string; node: tsm.Node }[] {
  if (!text.includes('process.env')) {
    return []
  }
  try {
    return process_env_findInFile2(createTSMSourceFile_cached(filePath, text))
  } catch {
    return []
  }
}

export function process_env_findInFile2(
  sf: tsm.SourceFile,
): { key: string; node: tsm.Node }[] {
  const penvs = sf
    .getDescendantsOfKind(tsm.SyntaxKind.PropertyAccessExpression)
    .filter(is_process_env)

  const results: { key: string; node: tsm.Node }[] = []

  for (const penv of penvs) {
    const node = penv.getParent()
    if (!node) {
      continue
    }
    if (tsm.Node.isPropertyAccessExpression(node)) {
      results.push({ key: node.getName(), node })
    } else if (tsm.Node.isElementAccessExpression(node)) {
      const arg = node.getArgumentExpression()
      if (arg && tsm.Node.isStringLiteral(arg)) {
        results.push({ key: arg.getLiteralText(), node })
      }
    }
  }

  return results
}

function is_process_env(n: tsm.Node): n is tsm.PropertyAccessExpression {
  if (!tsm.Node.isPropertyAccessExpression(n)) {
    return false
  }
  return n.getExpression().getText() === 'process' && n.getName() === 'env'
}
