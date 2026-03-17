import type { BaseStorageAdapter } from './adapters/BaseStorageAdapter.js'
import { createUploadSavers } from './createSavers.js'
import type {
  ModelNamesFor,
  UploadConfigForModel,
  UploadsConfig,
} from './prismaExtension.js'
import { createUploadsExtension } from './prismaExtension.js'
import type { UrlSigner } from './UrlSigner.js'

type SetupStorageOptions<
  TClient,
  MNames extends ModelNamesFor<TClient> = ModelNamesFor<TClient>,
> = {
  uploadsConfig: UploadsConfig<TClient, MNames>
  storageAdapter: BaseStorageAdapter
  urlSigner?: UrlSigner
}

export const setupStorage = <
  TClient,
  MNames extends ModelNamesFor<TClient> = ModelNamesFor<TClient>,
>({
  uploadsConfig,
  storageAdapter,
  urlSigner,
}: SetupStorageOptions<TClient, MNames>) => {
  const prismaExtension = createUploadsExtension<TClient, MNames>(
    uploadsConfig,
    storageAdapter,
    urlSigner,
  )

  const saveFiles = createUploadSavers(uploadsConfig, storageAdapter)

  return {
    storagePrismaExtension: prismaExtension,
    saveFiles,
  }
}

/**
 * This utility function ensures that you receive accurate type suggestions for your savers.
 * If you use the type UploadsConfig directly, you may receive suggestions for saveFiles.forY where Y hasn't been configured.
 * By using this utility function, you will only receive suggestions for the models that you have configured.
 *
 * @param uploadsConfig The uploads configuration object.
 * @returns The same uploads configuration object, but with filtered types
 */
export function createUploadsConfig<
  TClient,
  T extends Partial<{
    [K in ModelNamesFor<TClient>]?: UploadConfigForModel<TClient, K>
  }>,
>(uploadsConfig: T): T {
  return uploadsConfig
}

export type { ModelNamesFor, UploadsConfig } from './prismaExtension.js'
