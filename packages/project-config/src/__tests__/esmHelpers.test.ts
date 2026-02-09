import path from 'path'

import { describe, beforeAll, afterAll, expect, test } from 'vitest'

import { projectIsEsm, projectRootIsEsm, projectSideIsEsm } from '../paths'

const CEDAR_CWD = process.env.CEDAR_CWD

describe('esm helpers', () => {
  describe('esm fixture', () => {
    const ESM_FIXTURE = path.join(__dirname, 'fixtures', 'esm')

    beforeAll(() => {
      process.env.CEDAR_CWD = ESM_FIXTURE
    })
    afterAll(() => {
      process.env.CEDAR_CWD = CEDAR_CWD
    })

    test('projectIsEsm', () => {
      expect(projectIsEsm()).toEqual(true)
    })

    test('projectRootIsEsm', () => {
      expect(projectRootIsEsm()).toEqual(true)
    })

    test('projectSideIsEsm', () => {
      expect(projectSideIsEsm('api')).toEqual(true)
      expect(projectSideIsEsm('web')).toEqual(true)
    })
  })

  describe('esm api only fixture', () => {
    const ESM_API_ONLY_FIXTURE = path.join(
      __dirname,
      'fixtures',
      'esm-api-only',
    )

    beforeAll(() => {
      process.env.CEDAR_CWD = ESM_API_ONLY_FIXTURE
    })
    afterAll(() => {
      process.env.CEDAR_CWD = CEDAR_CWD
    })

    test('projectIsEsm', () => {
      expect(projectIsEsm()).toEqual(false)
    })

    test('projectRootIsEsm', () => {
      expect(projectRootIsEsm()).toEqual(false)
    })

    test('projectSideIsEsm', () => {
      expect(projectSideIsEsm('api')).toEqual(true)
      expect(projectSideIsEsm('web')).toEqual(false)
    })
  })
})
