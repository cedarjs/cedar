import { expect, test } from 'tstyche'

import { createUploadsConfig, setupStorage } from '@cedarjs/storage'

import { MemoryStorage } from '../adapters/MemoryStorage/MemoryStorage.js'
import { type UploadsConfig } from '../prismaExtension.js'
import type { PrismaClient } from '../__tests__/prisma-client/client.js'

// Use the createUploadsConfig helper here....
// otherwise the types won't be accurate
const uploadsConfig = createUploadsConfig({
  dummy: {
    fields: 'uploadField',
  },
  dumbo: {
    fields: ['firstUpload', 'secondUpload'],
  },
} satisfies UploadsConfig<PrismaClient, 'dummy' | 'dumbo'>)

const { saveFiles } = setupStorage<PrismaClient, 'dummy' | 'dumbo'>({
  uploadsConfig,
  storageAdapter: new MemoryStorage({
    baseDir: '/tmp',
  }),
})

// const prismaClient = new PrismaClient().$extends(storagePrismaExtension)

test('only configured models have savers', () => {
  expect(saveFiles).type.toHaveProperty('forDummy')
  expect(saveFiles).type.toHaveProperty('forDumbo')

  // These weren't configured above
  expect(saveFiles).type.not.toHaveProperty('forNoUploadFields')
  expect(saveFiles).type.not.toHaveProperty('forBook')
  expect(saveFiles).type.not.toHaveProperty('forBookCover')
})

test('inline config for save files is OK!', () => {
  const inlineConfig = createUploadsConfig({
    bookCover: {
      fields: 'photo',
    },
  } satisfies UploadsConfig<PrismaClient, 'bookCover'>)

  const { saveFiles } = setupStorage<PrismaClient, 'bookCover'>({
    uploadsConfig: inlineConfig,
    storageAdapter: new MemoryStorage({
      baseDir: '/tmp',
    }),
  })

  expect(saveFiles).type.toHaveProperty('forBookCover')
  expect(saveFiles).type.not.toHaveProperty('forDummy')
  expect(saveFiles).type.not.toHaveProperty('forDumbo')
})

test('UploadsConfig accepts all available models with their fields', () => {
  expect<UploadsConfig<PrismaClient>>().type.toHaveProperty('dummy')
  expect<UploadsConfig<PrismaClient>>().type.toHaveProperty('dumbo')
  expect<UploadsConfig<PrismaClient>>().type.toHaveProperty('book')
  expect<UploadsConfig<PrismaClient>>().type.toHaveProperty('bookCover')
  expect<UploadsConfig<PrismaClient>>().type.toHaveProperty('noUploadFields')

  expect<UploadsConfig<PrismaClient>['dumbo']>().type.toBeAssignableFrom<{
    fields: ['firstUpload'] // one of the fields, but not all of them
  }>()

  expect<UploadsConfig<PrismaClient>['dumbo']>().type.toBeAssignableFrom<{
    fields: ['firstUpload', 'secondUpload'] // one of the fields, but not all of them
  }>()

  expect<UploadsConfig<PrismaClient>['bookCover']>().type.toBeAssignableFrom<{
    fields: 'photo'
  }>()

  // If you give it something else, it won't accept it
  expect<
    UploadsConfig<PrismaClient>['bookCover']
  >().type.not.toBeAssignableFrom<{
    fields: ['bazinga']
  }>()
})
