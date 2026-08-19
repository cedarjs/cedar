import type NodeFs from 'node:fs'
import path from 'node:path'

import { Listr } from 'listr2'
import { vi, it, expect, beforeEach } from 'vitest'

const { memfs, ufs, vol } = await vi.hoisted(async () => {
  const { vol, fs: memfs } = await import('memfs')
  const { ufs } = await import('unionfs')
  return { memfs, ufs, vol }
})

vi.mock('node:fs', async (importOriginal) => {
  const { wrapFsForUnionfs, wrapMemfsForUnionfs } =
    await import('../../__tests__/ufsFsProxy.js')
  const originalFs = await importOriginal<typeof NodeFs>()
  ufs.use(wrapFsForUnionfs(originalFs)).use(wrapMemfsForUnionfs(memfs))

  return {
    ...ufs,
    default: ufs,
  }
})

const fs = await import('node:fs')

import * as rollback from '../rollback.js'

// executeRollback is typed as a ListrTaskFn that requires (ctx, task) arguments,
// but in these unit tests we exercise the rollback logic directly without a
// Listr2 context. Wrapping with a no-arg helper avoids repeating the suppression
// on every call.
// @ts-expect-error - executeRollback is a ListrTaskFn; calling without ctx/task is safe here
const executeRollback: () => Promise<void> = rollback.executeRollback

beforeEach(() => {
  vol.reset()
})

it('resets file contents', async () => {
  vol.fromJSON({
    'fake-file-1': 'fake-content-1',
    'fake-file-2': 'fake-content-2',
  })
  rollback.addFileToRollback('fake-file-1')

  fs.writeFileSync('fake-file-1', 'fake-content-changed')

  await executeRollback()
  expect(fs.readFileSync('fake-file-1', 'utf-8')).toBe('fake-content-1')
  expect(fs.readFileSync('fake-file-2', 'utf-8')).toBe('fake-content-2')
})

it('removes new files', async () => {
  vol.fromJSON({
    'fake-file-1': 'fake-content-1',
  })
  rollback.addFileToRollback('fake-file-1')
  rollback.addFileToRollback('fake-file-2')

  fs.writeFileSync('fake-file-2', 'fake-content-new')

  await executeRollback()
  expect(fs.readFileSync('fake-file-1', 'utf-8')).toBe('fake-content-1')
  expect(fs.existsSync('fake-file-2')).toBe(false)
})

it('removes empty folders after removing files', async () => {
  vol.fromJSON({
    [path.join('fake_dir', 'mock_dir', 'test_dir')]: null,
  })
  rollback.addFileToRollback(
    path.join('fake_dir', 'mock_dir', 'test_dir', 'fake-file'),
  )
  fs.writeFileSync(
    path.join('fake_dir', 'mock_dir', 'test_dir', 'fake-file'),
    'fake-content',
  )

  await executeRollback()
  expect(
    fs.existsSync(path.join('fake_dir', 'mock_dir', 'test_dir', 'fake-file')),
  ).toBe(false)
  expect(fs.readdirSync('fake_dir')).toStrictEqual([])
})

it('removes a build artifact tracked before it was created, e.g. tsconfig.tsbuildinfo', async () => {
  // Mirrors the package generator's `installAndBuild()`: the build artifact
  // doesn't exist yet when it's registered for rollback, `tsc` then creates
  // it, and a later failure should remove it again.
  const tsBuildInfoPath = path.join(
    'packages',
    'my-package',
    'tsconfig.tsbuildinfo',
  )
  vol.fromJSON({
    [path.join('packages', 'my-package', 'package.json')]: '{}',
  })

  rollback.addFileToRollback(tsBuildInfoPath)
  fs.writeFileSync(tsBuildInfoPath, 'fake-tsbuildinfo-content')
  expect(fs.existsSync(tsBuildInfoPath)).toBe(true)

  await executeRollback()
  expect(fs.existsSync(tsBuildInfoPath)).toBe(false)
})

it('restores a pre-existing build artifact tracked before it was overwritten', async () => {
  const tsBuildInfoPath = path.join(
    'packages',
    'my-package',
    'tsconfig.tsbuildinfo',
  )
  vol.fromJSON({
    [tsBuildInfoPath]: 'original-tsbuildinfo-content',
  })

  rollback.addFileToRollback(tsBuildInfoPath)
  fs.writeFileSync(tsBuildInfoPath, 'new-tsbuildinfo-content')

  await executeRollback()
  expect(fs.readFileSync(tsBuildInfoPath, 'utf-8')).toBe(
    'original-tsbuildinfo-content',
  )
})

it('executes sync functions', async () => {
  vol.fromJSON({})
  rollback.addFunctionToRollback(() => {
    fs.writeFileSync('/fake-file', 'fake-content')
  })
  await executeRollback()
  expect(fs.readFileSync('/fake-file', 'utf-8')).toBe('fake-content')
})

it('executes async functions', async () => {
  vol.fromJSON({})
  rollback.addFunctionToRollback(async () => {
    // make up some async process
    await new Promise((resolve, _reject) => {
      fs.writeFileSync('/fake-file', 'fake-content')
      resolve(undefined)
    })
  })
  await executeRollback()
  expect(fs.readFileSync('/fake-file', 'utf-8')).toBe('fake-content')
})

it('executes rollback in order', async () => {
  // default stack ordering LIFO
  vol.fromJSON({
    'fake-file': '0',
  })
  rollback.addFunctionToRollback(() => {
    fs.writeFileSync('fake-file', '1')
  })
  rollback.addFunctionToRollback(() => {
    fs.writeFileSync('fake-file', '2')
  })
  rollback.addFunctionToRollback(() => {
    fs.writeFileSync('fake-file', '3')
  })
  await executeRollback()
  expect(fs.readFileSync('fake-file', 'utf-8')).toBe('1')

  // handles the atEnd flag
  vol.fromJSON({
    'fake-file': '0',
  })
  rollback.addFunctionToRollback(() => {
    fs.writeFileSync('fake-file', '1')
  })
  rollback.addFunctionToRollback(() => {
    fs.writeFileSync('fake-file', '2')
  }, true)
  rollback.addFunctionToRollback(() => {
    fs.writeFileSync('fake-file', '3')
  })
  await executeRollback()
  expect(fs.readFileSync('fake-file', 'utf-8')).toBe('2')

  // using files rather than functions
  vol.fromJSON({
    'fake-file': '0',
  })
  rollback.addFileToRollback('fake-file')
  fs.writeFileSync('fake-file', '1')
  rollback.addFileToRollback('fake-file')
  fs.writeFileSync('fake-file', '2')
  rollback.addFileToRollback('fake-file')
  fs.writeFileSync('fake-file', '3')
  await executeRollback()
  expect(fs.readFileSync('fake-file', 'utf-8')).toBe('0')

  // using files rather than functions and the atEnd flag
  vol.fromJSON({
    'fake-file': '0',
  })
  rollback.addFileToRollback('fake-file')
  fs.writeFileSync('fake-file', '1')
  rollback.addFileToRollback('fake-file')
  fs.writeFileSync('fake-file', '2')
  rollback.addFileToRollback('fake-file', true)
  fs.writeFileSync('fake-file', '3')
  await executeRollback()
  expect(fs.readFileSync('fake-file', 'utf-8')).toBe('2')
})

it('reset clears the stack', async () => {
  vol.fromJSON({})
  rollback.addFunctionToRollback(() => {
    fs.writeFileSync('fake-file', 'fake-content')
  })
  rollback.resetRollback()
  await executeRollback()
  expect(fs.existsSync('fake-file')).toBe(false)
})

it('prepare clears the stack', async () => {
  vol.fromJSON({})
  rollback.addFunctionToRollback(() => {
    fs.writeFileSync('fake-file', 'fake-content')
  })
  // @ts-expect-error - empty object tests the resetRollback() path;
  // tasks.tasks is optional-chained so no Listr instance is needed
  rollback.prepareForRollback({})
  await executeRollback()
  expect(fs.existsSync('fake-file')).toBe(false)
})

it('prepare sets listr2 rollback functions and rollback executes correctly', async () => {
  const fakeTaskFunction = vi.fn()
  const fakeRollbackFunction = vi.fn()
  const tasks = new Listr(
    [
      {
        title: 'First example task',
        task: () => {
          fakeTaskFunction()
          rollback.addFunctionToRollback(fakeRollbackFunction)
        },
      },
      {
        title: 'Second example task',
        task: () => {
          fakeTaskFunction()
        },
      },
      {
        title: 'Third example task',
        task: () => {
          throw new Error('fake error')
        },
      },
    ],
    { silentRendererCondition: true },
  )

  rollback.prepareForRollback(tasks)

  tasks.tasks.forEach((task) => {
    expect(task.task.rollback).toBe(rollback.executeRollback)
  })

  try {
    await tasks.run()
  } catch {
    // we expect the error
  }

  expect(fakeTaskFunction.mock.calls.length).toBe(2)
  expect(fakeRollbackFunction.mock.calls.length).toBe(1)
})
