import type { IFs } from 'memfs'
import type { IFS } from 'unionfs/lib/fs.d.ts'

export function wrapFsForUnionfs<T extends Record<string, unknown>>(
  originalFs: T,
): T & IFS

export function wrapMemfsForUnionfs(memfs: IFs): IFS
