import { $, cd } from 'zx'

import type { Options } from './lib.mjs'
import {
  buildTarballs,
  detectPackageManager,
  FRAMEWORK_PATH,
  copyTarballs,
  updateResolutions,
  pmInstall,
} from './lib.mjs'
import { OutputManager, Stage } from './output.mjs'

function stageLog(verboseOutput: boolean, message: string) {
  // In verbose/CI mode the OutputManager spinner is disabled, so we emit
  // plain console lines so stage transitions are visible in CI logs.
  if (verboseOutput) {
    console.log(`[tarsync] ${message}`)
  }
}

export async function tarsync(
  { projectPath, verbose }: Omit<Options, 'watch'>,
  triggeredBy: string,
) {
  const isTTY = process.stdout.isTTY
  const verboseOutput = verbose || !isTTY
  $.verbose = verboseOutput

  const packageManager = await detectPackageManager(projectPath)
  const outputManager = new OutputManager({
    disabled: verboseOutput,
    packageManager,
  })

  outputManager.start({ triggeredBy })
  stageLog(verboseOutput, `starting (triggered by: ${triggeredBy})`)
  stageLog(verboseOutput, `project path: ${projectPath}`)
  stageLog(verboseOutput, `package manager: ${packageManager}`)

  cd(FRAMEWORK_PATH)

  outputManager.switchStage(Stage.BUILD_PACK)
  stageLog(verboseOutput, 'stage: build and pack tarballs')
  try {
    await buildTarballs()
  } catch (error) {
    outputManager.stop(error)
    console.error('[tarsync] ERROR in build:pack stage:', error)
    throw error
  }

  outputManager.switchStage(Stage.MOVE)
  stageLog(verboseOutput, 'stage: copy tarballs to project')
  try {
    await copyTarballs(projectPath)
  } catch (error) {
    outputManager.stop(error)
    console.error('[tarsync] ERROR in copy tarballs stage:', error)
    throw error
  }

  outputManager.switchStage(Stage.RESOLUTIONS)
  stageLog(verboseOutput, 'stage: update resolutions in package.json')
  try {
    await updateResolutions(projectPath)
  } catch (error) {
    outputManager.stop(error)
    console.error('[tarsync] ERROR in update resolutions stage:', error)
    throw error
  }

  outputManager.switchStage(Stage.INSTALL)
  stageLog(verboseOutput, `stage: run ${packageManager} install`)
  try {
    await pmInstall(projectPath)
  } catch (error) {
    outputManager.stop(error)
    console.error(`[tarsync] ERROR in ${packageManager} install stage:`, error)
    throw error
  }

  outputManager.switchStage(Stage.DONE)
  outputManager.stop()
  stageLog(verboseOutput, 'done')
}
