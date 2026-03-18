import path from 'node:path'

// This variable gets used in other functions
// and is set when webTasks, apiTasks, streamingTasks or fragmentsTasks are
// called
let OUTPUT_PATH: string | undefined

export function setOutputPath(path: string) {
  OUTPUT_PATH = path
}

export function getOutputPath() {
  if (!OUTPUT_PATH) {
    throw new Error('Output path not set')
  }

  return OUTPUT_PATH
}

export function fullPath(
  name: string,
  { addExtension } = { addExtension: true },
) {
  if (!OUTPUT_PATH) {
    throw new Error('Output path not set')
  }

  if (addExtension) {
    if (name.startsWith('api')) {
      name += '.ts'
    } else if (name.startsWith('web')) {
      name += '.tsx'
    }
  }

  return path.join(OUTPUT_PATH, name)
}
