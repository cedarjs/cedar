import fs from 'node:fs'
import path from 'node:path'

// @ts-expect-error - @vercel/nft has no bundled type declarations
import { nodeFileTrace } from '@vercel/nft'
import type Archiver from 'archiver'

import { findApiDistFunctions } from '@cedarjs/internal/dist/files'
import { ensurePosixPath, getPaths } from '@cedarjs/project-config'

import * as nftPacker from '../packing/nft.js'

const ZIPBALL_DIR = './api/dist/zipball'

export async function zipDirectory(source: string, out: string): Promise<void> {
  // archiver (like @vercel/nft above) is only added to a project's own
  // devDependencies when `cedar setup deploy serverless` is run, so it's an
  // optional peer dependency here rather than a hard dependency of the CLI.
  let archiver: typeof Archiver
  try {
    archiver = (await import('archiver')).default
  } catch (e) {
    if (
      e instanceof Error &&
      'code' in e &&
      e.code === 'ERR_MODULE_NOT_FOUND'
    ) {
      throw new Error(
        "Could not find the 'archiver' package, which this command needs " +
          'to pack your functions. Install it with `npm i -D archiver` (or ' +
          'the yarn/pnpm equivalent) and try again.',
      )
    }

    throw e
  }

  const archive = archiver('zip', { zlib: { level: 5 } })
  const stream = fs.createWriteStream(out)

  return new Promise((resolve, reject) => {
    archive
      .directory(source, false)
      .on('error', (err) => reject(err))
      .pipe(stream)

    stream.on('close', () => resolve())
    archive.finalize()
  })
}

// returns a tuple of [filePath, fileContent]
export function generateEntryFile(
  functionAbsolutePath: string,
  name: string,
): [string, string] {
  const relativeImport = ensurePosixPath(
    path.relative(getPaths().base, functionAbsolutePath),
  )
  return [
    `${ZIPBALL_DIR}/${name}/${name}.js`,
    `module.exports = require('./${relativeImport}')`,
  ]
}

export async function packageSingleFunction(
  functionFile: string,
): Promise<void> {
  const { name: functionName } = path.parse(functionFile)

  const { fileList: functionDependencyFileList } = await nodeFileTrace([
    functionFile,
  ])
  const copyPromises: Promise<void>[] = []
  for (const singleDependencyPath of functionDependencyFileList) {
    copyPromises.push(
      fs.promises.cp(
        './' + singleDependencyPath,
        `${ZIPBALL_DIR}/${functionName}/${singleDependencyPath}`,
        { recursive: true, force: true },
      ),
    )
  }

  const [entryFilePath, content] = generateEntryFile(functionFile, functionName)

  // This generates an "entry" file, that just proxies the actual
  // function that is nested in api/dist/
  const dir = path.dirname(entryFilePath)
  const functionEntryPromise = fs.promises
    .mkdir(dir, { recursive: true })
    .then(() => fs.promises.writeFile(entryFilePath, content))
  copyPromises.push(functionEntryPromise)

  await Promise.all(copyPromises)
  await zipDirectory(
    `${ZIPBALL_DIR}/${functionName}`,
    `${ZIPBALL_DIR}/${functionName}.zip`,
  )
  await fs.promises.rm(`${ZIPBALL_DIR}/${functionName}`, {
    recursive: true,
    force: true,
  })
}

export function nftPack(): Promise<void[]> {
  const filesToBePacked = findApiDistFunctions({ cwd: getPaths().api.base })
  return Promise.all(filesToBePacked.map(nftPacker.packageSingleFunction))
}
