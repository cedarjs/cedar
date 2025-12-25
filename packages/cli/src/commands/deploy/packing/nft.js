import fs from 'node:fs'
import path from 'node:path'

import { nodeFileTrace } from '@vercel/nft'
import archiver from 'archiver'

import { findApiDistFunctions } from '@cedarjs/internal/dist/files'
import { ensurePosixPath, getPaths } from '@cedarjs/project-config'

import * as nftPacker from '../packing/nft.js'

const ZIPBALL_DIR = './api/dist/zipball'

export function zipDirectory(source, out) {
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
export function generateEntryFile(functionAbsolutePath, name) {
  const relativeImport = ensurePosixPath(
    path.relative(getPaths().base, functionAbsolutePath),
  )
  return [
    `${ZIPBALL_DIR}/${name}/${name}.js`,
    `module.exports = require('./${relativeImport}')`,
  ]
}

export async function packageSingleFunction(functionFile) {
  const { name: functionName } = path.parse(functionFile)

  const { fileList: functionDependencyFileList } = await nodeFileTrace([
    functionFile,
  ])
  const copyPromises = []
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
  return
}

export function nftPack() {
  const filesToBePacked = findApiDistFunctions()
  return Promise.all(filesToBePacked.map(nftPacker.packageSingleFunction))
}
