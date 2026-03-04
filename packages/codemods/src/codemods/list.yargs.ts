import fs from 'node:fs'
import path from 'path'

import type yargs from 'yargs'
import { decamelize } from 'yargs-parser'

export const command = 'list <rwVersion>'
export const description = 'List available codemods for a specific version'

export const aliases = ['ls']

export const builder = (yargs: yargs.Argv) => {
  yargs.positional('rwVersion', {
    type: 'string',
    required: true,
    choices: fs.readdirSync(import.meta.dirname).filter(
      // Only list the folders
      (file) => !fs.statSync(path.join(import.meta.dirname, file)).isFile(),
    ),
  })
}

export const handler = ({ rwVersion }: { rwVersion: string }) => {
  console.log('Listing codemods for', rwVersion)

  console.log()

  const modsForVersion = fs.readdirSync(
    path.join(import.meta.dirname, rwVersion),
  )

  modsForVersion.forEach((codemod) => {
    // Use decamelize to match the usual yargs names,
    // instead of having to load the .yargs files
    console.log(`- npx @cedarjs/codemods ${decamelize(codemod)}`)
  })
}
