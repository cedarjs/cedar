import path from 'path'

import { test, expect } from 'vitest'

import { ensurePosixPath } from '@cedarjs/project-config'

import { findCellMocks } from '../findCellMocks.js'

const FIXTURE_PATH = path.resolve(
  __dirname,
  '../../../../../__fixtures__/example-todo-main',
)

const cleanPaths = (p: string) => {
  return ensurePosixPath(path.relative(FIXTURE_PATH, p))
}

test('Finds cell mocks from example-todo', () => {
  const mockPaths = findCellMocks(FIXTURE_PATH).map(cleanPaths)

  expect(mockPaths).toEqual([
    'web/src/components/NumTodosCell/NumTodosCell.mock.js',
    'web/src/components/NumTodosTwoCell/NumTodosTwoCell.mock.js',
    'web/src/components/TodoListCell/TodoListCell.mock.js',
  ])
})
