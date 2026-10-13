/**
 * Builds a minimal, valid ZIP archive in memory, for tests of ZIP-based
 * format detection. Entries are stored (not compressed) unless `method` says
 * otherwise; only the headers matter to detection, so a "deflated" entry's
 * data is left as is.
 */
export interface ZipEntry {
  name: string
  data?: string | Uint8Array
  /** Compression method written to the headers. Defaults to 0 (stored). */
  method?: number
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n

  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }

  return c >>> 0
})

function crc32(data: Uint8Array) {
  let crc = 0xffffffff

  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }

  return (crc ^ 0xffffffff) >>> 0
}

function u16(n: number) {
  const b = Buffer.alloc(2)
  b.writeUInt16LE(n)
  return b
}

function u32(n: number) {
  const b = Buffer.alloc(4)
  b.writeUInt32LE(n)
  return b
}

export function zip(
  entries: ZipEntry[],
  { comment = '' }: { comment?: string } = {},
): Uint8Array {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const { name, data = '', method = 0 } of entries) {
    const bytes =
      typeof data === 'string' ? Buffer.from(data) : Buffer.from(data)
    const nameBytes = Buffer.from(name)
    const crc = crc32(bytes)

    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20), // version needed
      u16(0), // flags
      u16(method),
      u16(0), // time
      u16(0x21), // date: 1980-01-01
      u32(crc),
      u32(bytes.length),
      u32(bytes.length),
      u16(nameBytes.length),
      u16(0), // extra length
      nameBytes,
      bytes,
    ])

    centrals.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20), // version made by
        u16(20), // version needed
        u16(0),
        u16(method),
        u16(0),
        u16(0x21),
        u32(crc),
        u32(bytes.length),
        u32(bytes.length),
        u16(nameBytes.length),
        u16(0), // extra length
        u16(0), // comment length
        u16(0), // disk
        u16(0), // internal attributes
        u32(0), // external attributes
        u32(offset),
        nameBytes,
      ]),
    )

    locals.push(local)
    offset += local.length
  }

  const directory = Buffer.concat(centrals)
  const commentBytes = Buffer.from(comment)
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0), // this disk
    u16(0), // directory disk
    u16(entries.length),
    u16(entries.length),
    u32(directory.length),
    u32(offset),
    u16(commentBytes.length),
    commentBytes,
  ])

  return new Uint8Array(Buffer.concat([...locals, directory, end]))
}

const CONTENT_TYPES = '<?xml version="1.0"?><Types/>'

/** The entries of a minimal Office Open XML file of the given family. */
export function officeOpenXml(
  family: 'word' | 'xl' | 'ppt',
  extra: ZipEntry[] = [],
): Uint8Array {
  const main = {
    word: 'word/document.xml',
    xl: 'xl/workbook.xml',
    ppt: 'ppt/presentation.xml',
  }[family]

  return zip([
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: '<Relationships/>' },
    { name: main, data: '<root/>' },
    ...extra,
  ])
}

/** A minimal OpenDocument file: the `mimetype` entry first, stored. */
export function openDocument(mimeType: string, extra: ZipEntry[] = []) {
  return zip([
    { name: 'mimetype', data: mimeType },
    { name: 'content.xml', data: '<office:document-content/>' },
    { name: 'META-INF/manifest.xml', data: '<manifest:manifest/>' },
    ...extra,
  ])
}

/**
 * A PPTX whose central directory is larger than
 * `DETECT_CONTENT_TYPE_TAIL_BYTES` (64 KiB): the parts of 1,000 slides,
 * with the bulk of the file before the directory.
 */
export function bigDirectoryPptx(): Uint8Array {
  const slides: ZipEntry[] = []

  for (let i = 1; i <= 1000; i++) {
    slides.push({ name: `ppt/slides/slide${i}.xml`, data: '<p:sld/>' })
    slides.push({
      name: `ppt/slides/_rels/slide${i}.xml.rels`,
      data: '<Relationships/>',
    })
  }

  return zip([
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: 'ppt/media/image1.png', data: new Uint8Array(100_000) },
    { name: 'ppt/presentation.xml', data: '<p:presentation/>' },
    ...slides,
  ])
}
