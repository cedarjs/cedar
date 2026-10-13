import {
  acceptedContentType,
  DETECT_CONTENT_TYPE_BYTES,
  DETECT_CONTENT_TYPE_TAIL_BYTES,
  findZipCentralDirectory,
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
 * last `DETECT_CONTENT_TYPE_TAIL_BYTES` when the head is a ZIP, plus the
 * start of the ZIP's central directory when that begins before the tail
 * (at most `MAX_ZIP_DIRECTORY_BYTES`).
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
    const tailStart = size - tailLength
    tail = await readRange(target, key, tailStart, tailLength)

    // A big directory starts before the tail: read exactly the missing part.
    // Only when the directory really reaches into the tail, which bounds the
    // read by the directory size `findZipCentralDirectory()` caps.
    const directory = findZipCentralDirectory(tail)

    if (
      directory &&
      directory.offset < tailStart &&
      directory.offset + directory.size > tailStart
    ) {
      const missing = await readRange(
        target,
        key,
        directory.offset,
        tailStart - directory.offset,
      )
      const joined = new Uint8Array(missing.length + tail.length)
      joined.set(missing)
      joined.set(tail, missing.length)
      tail = joined
    }
  }

  return acceptedContentType(head, [declaredType], declaredType, { tail })
}
