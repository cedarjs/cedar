import fs from 'node:fs'
import path from 'node:path'

import type { PackageManager } from './handle-args.js'
import { getCedarCommandPrefix, getInstallCommand } from './package-manager.js'

export interface ReplacementValues {
  packageManager: PackageManager
  databaseUrl: string
  directDatabaseUrl: string
  neonClaimExpiry: string
  neonClaimUrl: string
}

/** String replace of placeholders in template files */
export async function replacePlaceholders(
  dir: string,
  values: ReplacementValues,
) {
  const installCommand = getInstallCommand(values.packageManager)
  const cedarCommand = getCedarCommandPrefix(values.packageManager)

  const replacements: Record<string, string | undefined> = {
    '{{PM}}': values.packageManager,
    '{{PM_INSTALL}}': installCommand,
    '{{CEDAR_CLI}}': cedarCommand,
    '{{DATABASE_URL}}': values.databaseUrl,
    '{{DIRECT_DATABASE_URL}}': values.directDatabaseUrl,
    '{{NEON_CLAIM_EXPIRY}}': values.neonClaimExpiry,
    '{{NEON_CLAIM_URL}}': values.neonClaimUrl,
  }

  const patterns = [
    '**/*.{json,md,js,ts,yml,yaml}',
    '**/.*/**/*.{json,md,js,ts,yml,yaml}',
    '**/.env*',
  ]

  for (const pattern of patterns) {
    for await (const file of fs.promises.glob(pattern, { cwd: dir })) {
      const fullPath = path.join(dir, file)
      let content = await fs.promises.readFile(fullPath, 'utf-8')

      for (const [placeholder, value] of Object.entries(replacements)) {
        if (value !== undefined) {
          content = content.replaceAll(placeholder, value)
        }
      }

      await fs.promises.writeFile(fullPath, content, 'utf-8')
    }
  }
}
