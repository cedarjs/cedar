import {
  acceptedContentType,
  DETECT_CONTENT_TYPE_BYTES,
  DETECT_CONTENT_TYPE_TAIL_BYTES,
} from './detectContentType.js'
import type { StorageProvider } from './types.js'

const ZIP_LOCAL_HEADER = [0x50, 0x4b, 0x03, 0x04]

async function readRange(
  target: StorageProvider,
  key: string,
  offset: number,
  length: number,
): Promise<Uint8Array> {
  if (target.readRange) {
    return target.readRange(key, { offset, length })
  }

  // The object's size was checked against the profile's limit already, so
  // reading it whole is bounded
  return (await target.read(key)).subarray(offset, offset + length)
}

/**
 * Checks an object that was uploaded straight to storage against the type
 * the client declared for it when it asked for the upload URL. The declared
 * type was checked against the upload profile then, and is the
 * `Content-Type` the object was stored with, so the bytes must be that type
 * (or an alias of it). Reads the first `DETECT_CONTENT_TYPE_BYTES`, plus the
 * last `DETECT_CONTENT_TYPE_TAIL_BYTES` when the head is a ZIP.
 *
 * Returns the canonical type to record, or `null` when the bytes aren't the
 * declared type.
 */
export async function verifyStoredContentType(
  target: StorageProvider,
  key: string,
  { size, declaredType }: { size: number; declaredType: string },
): Promise<string | null> {
  const headLength = Math.min(size, DETECT_CONTENT_TYPE_BYTES)
  const head = await readRange(target, key, 0, headLength)
  let tail: Uint8Array | undefined

  // A head shorter than the object means there is an end the office formats
  // need, which only matters for ZIPs
  const isZip = ZIP_LOCAL_HEADER.every((byte, i) => head[i] === byte)

  if (isZip && size > head.length) {
    const tailLength = Math.min(size, DETECT_CONTENT_TYPE_TAIL_BYTES)
    tail = await readRange(target, key, size - tailLength, tailLength)
  }

  return acceptedContentType(head, [declaredType], declaredType, { tail })
}
