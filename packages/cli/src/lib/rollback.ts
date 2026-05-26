import fs from 'node:fs'
import path from 'path'

interface RollbackStepFunc {
  type: 'func'
  func: () => unknown
}

interface RollbackStepFile {
  type: 'file'
  path: string
  content: Buffer | null
}

type RollbackStep = RollbackStepFunc | RollbackStepFile

// The stack containing rollback actions
const rollback: RollbackStep[] = []

/**
 * Adds a function call to the rollback stack, this function will be called when the rollback is executed
 *
 * @param func - The function to call
 * @param [atEnd=false] - If true inserts at the bottom of the stack instead of the top
 */
export function addFunctionToRollback(func: () => unknown, atEnd = false) {
  const step: RollbackStep = { type: 'func', func: func }
  if (atEnd) {
    rollback.unshift(step)
  } else {
    rollback.push(step)
  }
}

/**
 * Adds a file call to the rollback stack, when the rollback is executed the file will deleted if it does not currently exist or will be restored to its current state
 *
 * @param path - Path to the file
 * @param [atEnd=false] - If true inserts at the bottom of the stack instead of the top
 */
export function addFileToRollback(filePath: string, atEnd = false) {
  const step: RollbackStep = {
    type: 'file',
    path: filePath,
    content: fs.existsSync(filePath) ? fs.readFileSync(filePath) : null,
  }
  if (atEnd) {
    rollback.unshift(step)
  } else {
    rollback.push(step)
  }
}

/**
 * Executes a rollback by processing the contents of the rollback stack
 *
 * @param {object|null} [ctx=null] - The listr2 ctx
 * @param {object|null} [task=null] - The listr2 task
 */
export async function executeRollback(
  _: unknown = null,
  task: { title: string; task: { message: { error: string } } } | null = null,
) {
  if (task) {
    task.title = 'Reverting generator actions...'
  }
  while (rollback.length > 0) {
    const step = rollback.pop() as RollbackStep
    switch (step.type) {
      case 'func':
        await step.func()
        break
      case 'file':
        if (step.content === null) {
          fs.unlinkSync(step.path)
          // Remove any empty parent/grandparent directories, only need 2 levels so just do it manually
          let parent = path.dirname(step.path)
          if (parent !== '.' && fs.readdirSync(parent).length === 0) {
            fs.rmdirSync(parent)
          }
          parent = path.dirname(parent)
          if (parent !== '.' && fs.readdirSync(parent).length === 0) {
            fs.rmdirSync(parent)
          }
        } else {
          fs.writeFileSync(step.path, step.content)
        }
        break
      default:
        // This should be unreachable.
        break
    }
  }
  if (task) {
    task.title = `Reverted because: ${task.task.message.error}`
  }
}

/**
 * Clears the current rollback stack
 */
export function resetRollback() {
  rollback.length = 0
}

/**
 * Resets the current rollback stack and assigns all of the tasks to have a
 * listr2 rollback function which call {@link executeRollback}
 */
export function prepareForRollback(tasks: {
  tasks?: { task: { rollback: typeof executeRollback } }[]
}) {
  resetRollback()
  tasks.tasks?.forEach((task) => {
    task.task.rollback = executeRollback
  })
}
