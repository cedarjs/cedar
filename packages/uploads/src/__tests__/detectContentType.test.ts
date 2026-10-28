import { describe, expect, test } from 'vitest'

import {
  acceptedContentType,
  checkContentType,
  DETECT_CONTENT_TYPE_BYTES,
  DETECT_CONTENT_TYPE_TAIL_BYTES,
  DETECTABLE_CONTENT_TYPES,
  detectContentType,
  findZipCentralDirectory,
  isClaimedContentTypeAllowed,
  MAX_ZIP_DIRECTORY_BYTES,
} from '../detectContentType.js'

import {
  bigDirectoryPptx,
  officeOpenXml,
  openDocument,
  zip,
} from './helpers/zip.js'

const DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const PPTX =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const DOCM = 'application/vnd.ms-word.document.macroenabled.12'
const XLSM = 'application/vnd.ms-excel.sheet.macroenabled.12'
const PPTM = 'application/vnd.ms-powerpoint.presentation.macroenabled.12'
const ODT = 'application/vnd.oasis.opendocument.text'
const ODS = 'application/vnd.oasis.opendocument.spreadsheet'
const ODP = 'application/vnd.oasis.opendocument.presentation'

// Every fixture is a minimal header built here, not a copy of a real file

function bytes(...parts: (number[] | string)[]): Uint8Array {
  return new Uint8Array(
    Buffer.concat(
      parts.map((part) =>
        typeof part === 'string'
          ? Buffer.from(part, 'latin1')
          : Buffer.from(part),
      ),
    ),
  )
}

function uint32BE(n: number) {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
}

/** An ISO-BMFF `ftyp` box with a correct size, followed by an `mdat` header. */
function ftyp(major: string, ...compatible: string[]) {
  const size = 16 + 4 * compatible.length

  return bytes(
    uint32BE(size),
    'ftyp',
    major,
    [0, 0, 0, 0],
    compatible.join(''),
    uint32BE(8),
    'mdat',
  )
}

/** An EBML header whose children are `EBMLVersion` and then `DocType`. */
function ebml(docType: string) {
  const version = [0x42, 0x86, 0x81, 0x01]
  const docTypeElement = [0x42, 0x82, 0x80 | docType.length]
  const headerSize = version.length + docTypeElement.length + docType.length

  return bytes(
    [0x1a, 0x45, 0xdf, 0xa3, 0x80 | headerSize],
    version,
    docTypeElement,
    docType,
    // The Segment element that follows the header
    [0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
  )
}

function bmp(infoHeaderSize: number) {
  return bytes(
    'BM',
    [0x46, 0, 0, 0],
    [0, 0, 0, 0],
    [0x36, 0, 0, 0],
    [infoHeaderSize, 0, 0, 0],
    [1, 0, 0, 0, 1, 0, 0, 0],
  )
}

/**
 * A view of `data` that throws on any read at or past its end, so a test
 * fails if detection looks beyond the bytes it was given. Plain typed arrays
 * return `undefined` there, which would hide it.
 */
function strict(data: Uint8Array): Uint8Array {
  return new Proxy(data, {
    get(target, key) {
      if (
        typeof key === 'string' &&
        /^\d+$/.test(key) &&
        Number(key) >= target.length
      ) {
        throw new RangeError(`Read at ${key} past length ${target.length}`)
      }

      const value: unknown = Reflect.get(target, key, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0, 0])

const RECOGNISED: [string, Uint8Array, string][] = [
  ['JPEG', bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), 'image/jpeg'],
  ['PNG', PNG, 'image/png'],
  ['GIF87a', bytes('GIF87a', [1, 0, 1, 0]), 'image/gif'],
  ['GIF89a', bytes('GIF89a', [1, 0, 1, 0]), 'image/gif'],
  ['WebP', bytes('RIFF', [0x24, 0, 0, 0], 'WEBPVP8 '), 'image/webp'],
  ['BMP (BITMAPINFOHEADER)', bmp(40), 'image/bmp'],
  ['BMP (BITMAPV5HEADER)', bmp(124), 'image/bmp'],
  ['TIFF (little-endian)', bytes('II', [0x2a, 0, 8, 0, 0, 0]), 'image/tiff'],
  ['TIFF (big-endian)', bytes('MM', [0, 0x2a, 0, 0, 0, 8]), 'image/tiff'],
  ['PDF', bytes('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n'), 'application/pdf'],
  ['WebM', ebml('webm'), 'video/webm'],
  ['Matroska', ebml('matroska'), 'video/matroska'],
  ['OpenDocument text', openDocument(ODT), ODT],
  ['OpenDocument spreadsheet', openDocument(ODS), ODS],
  ['OpenDocument presentation', openDocument(ODP), ODP],
]

/**
 * Office Open XML files, recognised by their central directory, so only as
 * whole files (or with a tail).
 */
const OFFICE: [string, Uint8Array, string][] = [
  ['DOCX', officeOpenXml('word'), DOCX],
  ['XLSX', officeOpenXml('xl'), XLSX],
  ['PPTX', officeOpenXml('ppt'), PPTX],
  [
    'DOCM',
    officeOpenXml('word', [{ name: 'word/vbaProject.bin', data: 'vba' }]),
    DOCM,
  ],
  [
    'XLSM',
    officeOpenXml('xl', [{ name: 'xl/vbaProject.bin', data: 'vba' }]),
    XLSM,
  ],
  [
    'XLSM with only Excel 4.0 macro sheets',
    officeOpenXml('xl', [{ name: 'xl/macrosheets/sheet1.xml', data: '<x/>' }]),
    XLSM,
  ],
  [
    'PPTM',
    officeOpenXml('ppt', [{ name: 'ppt/vbaProject.bin', data: 'vba' }]),
    PPTM,
  ],
  [
    'DOCX with an archive comment',
    zip(
      [
        { name: '[Content_Types].xml', data: '<Types/>' },
        { name: 'word/document.xml', data: '<w/>' },
      ],
      { comment: 'PK\x05\x06 lookalike in the comment' },
    ),
    DOCX,
  ],
]

/** ISO-BMFF files, by brand family. */
const BRANDS: [string, Uint8Array, string][] = [
  ['AVIF (avif)', ftyp('avif', 'mif1', 'miaf'), 'image/avif'],
  ['AVIF sequence (avis)', ftyp('avis', 'msf1', 'miaf'), 'image/avif'],
  ['AVIF under a generic major brand', ftyp('mif1', 'avif'), 'image/avif'],
  ['HEIC (heic)', ftyp('heic', 'mif1', 'heic'), 'image/heic'],
  ['HEIC (heix)', ftyp('heix', 'mif1', 'heix'), 'image/heic'],
  ['HEIC under a generic major brand', ftyp('mif1', 'heic'), 'image/heic'],
  ['HEIC sequence (hevc)', ftyp('hevc', 'msf1'), 'image/heic-sequence'],
  ['HEIF (mif1)', ftyp('mif1', 'mif1'), 'image/heif'],
  ['HEIF sequence (msf1)', ftyp('msf1', 'iso8'), 'image/heif-sequence'],
  ['MP4 (isom)', ftyp('isom', 'isom', 'iso2', 'avc1', 'mp41'), 'video/mp4'],
  ['MP4 (mp41)', ftyp('mp41', 'mp41'), 'video/mp4'],
  ['MP4 (mp42)', ftyp('mp42', 'mp42', 'isom'), 'video/mp4'],
  ['MP4 (iso5, DASH)', ftyp('iso5', 'iso5', 'dash'), 'video/mp4'],
  ['MP4 (M4V)', ftyp('M4V ', 'M4V ', 'mp42'), 'video/mp4'],
  ['MP4 under an unlisted major brand', ftyp('XAVC', 'mp42'), 'video/mp4'],
  ['MP4 audio (M4A)', ftyp('M4A ', 'M4A ', 'mp42'), 'audio/mp4'],
  ['QuickTime (qt)', ftyp('qt  ', 'qt  '), 'video/quicktime'],
  [
    'QuickTime under an unlisted major brand',
    ftyp('XXXX', 'qt  '),
    'video/quicktime',
  ],
]

describe('detectContentType', () => {
  test.each([...RECOGNISED, ...BRANDS, ...OFFICE])(
    'recognises %s',
    (_name, data, expected) => {
      expect(detectContentType(strict(data))).toBe(expected)
    },
  )

  test('works on a Buffer as well as a Uint8Array', () => {
    expect(detectContentType(Buffer.from(PNG))).toBe('image/png')
  })

  test('only returns types listed in DETECTABLE_CONTENT_TYPES', () => {
    for (const [, data, expected] of [...RECOGNISED, ...BRANDS, ...OFFICE]) {
      expect(DETECTABLE_CONTENT_TYPES.has(expected)).toBe(true)
      expect(detectContentType(data)).toBe(expected)
    }
  })

  test('every fixture fits within DETECT_CONTENT_TYPE_BYTES', () => {
    for (const [, data, expected] of [...RECOGNISED, ...BRANDS]) {
      const padded = new Uint8Array(DETECT_CONTENT_TYPE_BYTES * 2)
      padded.set(data)
      expect(
        detectContentType(padded.subarray(0, DETECT_CONTENT_TYPE_BYTES)),
      ).toBe(expected)
    }
  })

  test.each([
    ['SVG', bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    [
      'SVG with an XML declaration',
      bytes('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>'),
    ],
    ['HTML', bytes('<!doctype html><script>alert(1)</script>')],
    ['plain text', bytes('hello, world')],
    ['a RIFF WAVE file', bytes('RIFF', [0x24, 0, 0, 0], 'WAVEfmt ')],
    ['the start of a ZIP archive', bytes('PK', [3, 4, 20, 0, 0, 0])],
    ['a ZIP archive', zip([{ name: 'notes.txt', data: 'hello' }])],
    [
      'a legacy OLE .doc',
      bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    ],
    ['empty input', new Uint8Array(0)],
  ])('does not recognise %s', (_name, data) => {
    expect(detectContentType(strict(data))).toBeNull()
  })

  describe('ftyp', () => {
    test('does not recognise unknown brands', () => {
      expect(detectContentType(ftyp('XXXX', 'YYYY'))).toBeNull()
    })

    test('ignores brands past the end of the box', () => {
      // A box of 16 bytes has no compatible brands, so the `avif` right
      // after it belongs to whatever comes next
      const data = bytes(uint32BE(16), 'ftyp', 'mif1', [0, 0, 0, 0], 'avif')

      expect(detectContentType(data)).toBe('image/heif')
    })

    test.each([
      ['0 (to end of file)', 0],
      ['1 (64-bit size follows)', 1],
      ['smaller than the header', 12],
      ['not a multiple of four', 18],
    ])('rejects a box size of %s', (_name, size) => {
      const data = bytes(uint32BE(size), 'ftyp', 'isom', [0, 0, 0, 0], 'isom')

      expect(detectContentType(data)).toBeNull()
    })

    test('does not guess from a cut-off list of compatible brands', () => {
      // The box claims 64 bytes, so the brand that decides may be missing
      const data = bytes(uint32BE(64), 'ftyp', 'mif1', [0, 0, 0, 0], 'mif1')

      expect(detectContentType(strict(data))).toBeNull()
    })

    test('does not scan a box bigger than a real ftyp ever is', () => {
      // A generic major brand, so the compatible brands would decide, and a
      // box size covering a large upload
      const huge = new Uint8Array(1 << 20)
      huge.set(bytes(uint32BE(huge.length), 'ftyp', 'mif1', [0, 0, 0, 0]))
      expect(detectContentType(strict(huge))).toBeNull()

      expect(
        detectContentType(ftyp('mif1', ...new Array(252).fill('avif'))),
      ).toBe('image/avif')
      expect(
        detectContentType(ftyp('mif1', ...new Array(253).fill('avif'))),
      ).toBeNull()
    })

    test('needs only the major brand when that decides', () => {
      const data = bytes(uint32BE(64), 'ftyp', 'heic', [0, 0, 0, 0])

      expect(detectContentType(strict(data))).toBe('image/heic')
    })
  })

  describe('EBML', () => {
    test('finds DocType after other header elements', () => {
      expect(detectContentType(ebml('webm'))).toBe('video/webm')
    })

    test('accepts a DocType padded with NULs', () => {
      expect(detectContentType(ebml('webm\0\0'))).toBe('video/webm')
    })

    test('accepts multi-byte element sizes', () => {
      const data = bytes(
        [0x1a, 0x45, 0xdf, 0xa3],
        // Header size 8, written in two bytes
        [0x40, 0x08],
        // DocType, size 4, written in two bytes
        [0x42, 0x82, 0x40, 0x04],
        'webm',
      )

      expect(detectContentType(strict(data))).toBe('video/webm')
    })

    test.each([
      ['an unknown DocType', ebml('mkv3d')],
      [
        'no DocType',
        bytes([0x1a, 0x45, 0xdf, 0xa3, 0x84], [0x42, 0x86, 0x81, 0x01]),
      ],
      [
        'a header of unknown size',
        bytes([0x1a, 0x45, 0xdf, 0xa3, 0xff], [0x42, 0x82, 0x84], 'webm'),
      ],
      [
        'an invalid size byte',
        bytes([0x1a, 0x45, 0xdf, 0xa3, 0x00], [0x42, 0x82, 0x84], 'webm'),
      ],
      [
        'a DocType too long to be a known one',
        bytes(
          [0x1a, 0x45, 0xdf, 0xa3, 0x40, 0x2b],
          [0x42, 0x82, 0xa8],
          'webm',
          new Array(36).fill(0),
        ),
      ],
      [
        'a child running past a one-byte header',
        bytes([0x1a, 0x45, 0xdf, 0xa3, 0x81, 0x42, 0x82, 0x84], 'webm'),
      ],
      [
        'a DocType longer than the input',
        bytes([0x1a, 0x45, 0xdf, 0xa3, 0x87], [0x42, 0x82, 0x88], 'webm'),
      ],
    ])('does not recognise %s', (_name, data) => {
      expect(detectContentType(strict(data))).toBeNull()
    })
  })

  describe('BMP', () => {
    test('does not recognise "BM" without a valid header', () => {
      expect(detectContentType(bytes('BMW is a car brand, not a bitmap'))).toBe(
        null,
      )
      expect(detectContentType(bmp(41))).toBeNull()
    })
  })

  test('every prefix of every fixture is either recognised the same or not at all', () => {
    for (const [name, data, expected] of [
      ...RECOGNISED,
      ...BRANDS,
      ...OFFICE,
    ]) {
      for (let length = 0; length <= data.length; length++) {
        const prefix = strict(data.slice(0, length))
        const detected = detectContentType(prefix)

        if (detected !== null && detected !== expected) {
          throw new Error(
            `${name} truncated to ${length} bytes detected as ${detected}`,
          )
        }
      }
    }
  })

  test('never throws or reads past the end of random input', () => {
    // A fixed-seed generator so a failure reproduces
    let seed = 0x2f6b1d3
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed
    }

    const headers = [...RECOGNISED, ...BRANDS, ...OFFICE].map(
      ([, data]) => data,
    )

    for (let i = 0; i < 2000; i++) {
      const data = new Uint8Array(random() % 64)

      for (let j = 0; j < data.length; j++) {
        data[j] = random() & 0xff
      }

      // Half the inputs start with a real signature followed by garbage
      if (i % 2 === 0) {
        const header = headers[random() % headers.length]
        data.set(header.subarray(0, Math.min(header.length, 12, data.length)))
      }

      expect(() => detectContentType(strict(data))).not.toThrow()
    }
  })
})

describe('ZIP-based office formats', () => {
  /** A DOCX big enough that its head and tail don't overlap. */
  function bigDocx(padding = DETECT_CONTENT_TYPE_BYTES * 4) {
    return zip([
      { name: '[Content_Types].xml', data: '<Types/>' },
      { name: 'word/media/image1.png', data: new Uint8Array(padding) },
      { name: 'word/document.xml', data: '<w/>' },
    ])
  }

  test('recognises OpenDocument from the head alone', () => {
    const data = openDocument(ODS, [
      { name: 'Pictures/a.png', data: new Uint8Array(10_000) },
    ])

    expect(
      detectContentType(strict(data.subarray(0, DETECT_CONTENT_TYPE_BYTES))),
    ).toBe(ODS)
  })

  test.each([
    [
      'a compressed mimetype entry',
      zip([{ name: 'mimetype', data: ODT, method: 8 }]),
    ],
    [
      'a mimetype entry that is not first',
      zip([
        { name: 'content.xml', data: '<x/>' },
        { name: 'mimetype', data: ODT },
      ]),
    ],
    [
      'an OpenDocument type it does not report (EPUB)',
      zip([{ name: 'mimetype', data: 'application/epub+zip' }]),
    ],
    [
      'an OpenDocument type it does not report (graphics)',
      openDocument('application/vnd.oasis.opendocument.graphics'),
    ],
  ])('does not recognise %s', (_name, data) => {
    expect(detectContentType(strict(data))).toBeNull()
  })

  test('does not guess Office Open XML from the head alone', () => {
    const data = bigDocx()
    const head = data.subarray(0, DETECT_CONTENT_TYPE_BYTES)

    expect(detectContentType(strict(head))).toBeNull()
  })

  test('recognises Office Open XML from its head plus its tail', () => {
    const data = bigDocx()
    const head = data.subarray(0, DETECT_CONTENT_TYPE_BYTES)
    const tail = data.subarray(data.length - DETECT_CONTENT_TYPE_TAIL_BYTES)

    expect(detectContentType(strict(head), { tail: strict(tail) })).toBe(DOCX)
  })

  test('does not guess when the tail does not hold the whole directory', () => {
    const data = bigDocx()
    const tail = data.subarray(data.length - 60)

    expect(
      detectContentType(data.subarray(0, 100), { tail: strict(tail) }),
    ).toBeNull()
  })

  test('ignores the tail for anything that is not a ZIP', () => {
    expect(detectContentType(PNG, { tail: officeOpenXml('word') })).toBe(
      'image/png',
    )
    expect(
      detectContentType(bytes('hello'), { tail: officeOpenXml('word') }),
    ).toBeNull()
  })

  test.each([
    [
      'no [Content_Types].xml',
      zip([{ name: 'word/document.xml', data: '<w/>' }]),
    ],
    [
      'parts of more than one kind of document',
      zip([
        { name: '[Content_Types].xml', data: '<Types/>' },
        { name: 'word/document.xml', data: '<w/>' },
        { name: 'xl/workbook.xml', data: '<x/>' },
      ]),
    ],
    [
      'a ZIP64 end of central directory',
      (() => {
        const data = officeOpenXml('word')
        // Total entries 0xFFFF means "see the ZIP64 record"
        data[data.length - 12] = 0xff
        data[data.length - 11] = 0xff
        return data
      })(),
    ],
    [
      'a directory size that does not match its entries',
      (() => {
        const data = officeOpenXml('word')
        data[data.length - 10] += 1
        return data
      })(),
    ],
  ])('does not recognise a ZIP with %s', (_name, data) => {
    expect(detectContentType(strict(data))).toBeNull()
  })

  describe('a central directory larger than the tail', () => {
    const data = bigDirectoryPptx()
    const head = data.subarray(0, DETECT_CONTENT_TYPE_BYTES)
    const tailStart = data.length - DETECT_CONTENT_TYPE_TAIL_BYTES
    const tail = data.subarray(tailStart)

    test('is bigger than the tail, so the fixture tests what it should', () => {
      const directory = findZipCentralDirectory(tail)

      expect(directory).not.toBeNull()
      expect(directory!.size).toBeGreaterThan(DETECT_CONTENT_TYPE_TAIL_BYTES)
      expect(directory!.offset).toBeLessThan(tailStart)
    })

    test('is recognised in the whole file', () => {
      expect(detectContentType(strict(data))).toBe(PPTX)
    })

    test('is not guessed from a tail that cuts it off', () => {
      expect(detectContentType(strict(head), { tail: strict(tail) })).toBeNull()
    })

    test('is recognised once the missing part is read and joined to the tail', () => {
      const directory = findZipCentralDirectory(tail)!
      const joined = data.subarray(directory.offset)

      expect(directory.offset + directory.size).toBeGreaterThan(tailStart)
      expect(detectContentType(strict(head), { tail: strict(joined) })).toBe(
        PPTX,
      )
    })
  })

  test('looks past an end-record lookalike in the archive comment', () => {
    // A comment ending in a signature plus 18 zero bytes looks like a record
    // of an empty directory, nearer the end than the real one
    const data = zip(
      [
        { name: '[Content_Types].xml', data: '<Types/>' },
        { name: 'word/document.xml', data: '<w/>' },
      ],
      { comment: 'note PK\x05\x06' + '\0'.repeat(18) },
    )

    expect(detectContentType(strict(data))).toBe(DOCX)
    expect(findZipCentralDirectory(data)?.size).toBeGreaterThan(0)
  })

  test('does not read a directory larger than MAX_ZIP_DIRECTORY_BYTES', () => {
    const data = officeOpenXml('word')
    const sizeField = data.length - 22 + 12
    new DataView(data.buffer).setUint32(
      sizeField,
      MAX_ZIP_DIRECTORY_BYTES + 1,
      true,
    )

    expect(findZipCentralDirectory(data)).toBeNull()
    expect(detectContentType(strict(data))).toBeNull()
  })

  test('reports where the directory is, and nothing for ZIP64', () => {
    const data = officeOpenXml('xl')
    const view = new DataView(data.buffer)
    const record = data.length - 22

    expect(findZipCentralDirectory(data)).toEqual({
      offset: view.getUint32(record + 16, true),
      size: view.getUint32(record + 12, true),
    })

    view.setUint32(record + 16, 0xffffffff, true)
    expect(findZipCentralDirectory(data)).toBeNull()
    expect(detectContentType(data)).toBeNull()
    expect(findZipCentralDirectory(bytes('not a zip'))).toBeNull()
  })

  test('never throws or reads past the end of a random central directory', () => {
    let seed = 0x5eed
    const random = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed
    }

    const head = officeOpenXml('word').subarray(0, 30)

    for (let i = 0; i < 2000; i++) {
      const tail = new Uint8Array(22 + (random() % 200))

      for (let j = 0; j < tail.length; j++) {
        tail[j] = random() & 0xff
      }

      // A well-placed end-of-central-directory signature, with random fields
      // and a comment length that reaches the end
      const record = tail.length - 22
      tail.set([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0], record)
      tail[record + 20] = 0
      tail[record + 21] = 0

      // Half of them point at a run of central-directory signatures
      if (i % 2 === 0) {
        for (let j = 0; j + 4 <= record; j += 46) {
          tail.set([0x50, 0x4b, 0x01, 0x02], j)
        }
      }

      expect(() =>
        detectContentType(strict(head), { tail: strict(tail) }),
      ).not.toThrow()
    }
  })
})

describe('acceptedContentType', () => {
  const HTML = bytes('<!doctype html><script>alert(1)</script>')
  const CSV = bytes('name,email\n')

  test('returns the detected type when it is accepted, whatever was claimed', () => {
    expect(
      acceptedContentType(PNG, ['image/*'], 'application/octet-stream'),
    ).toBe('image/png')
    expect(acceptedContentType(PNG, ['image/png'])).toBe('image/png')
    expect(acceptedContentType(ftyp('heic'), ['image/heic'], '')).toBe(
      'image/heic',
    )
  })

  test('rejects a recognised type that is not accepted', () => {
    expect(acceptedContentType(PNG, ['image/jpeg'], 'image/jpeg')).toBeNull()
    expect(
      acceptedContentType(bytes('%PDF-1.4'), ['image/*'], 'image/png'),
    ).toBeNull()
  })

  test('accepts a detected type through either spelling of its alias', () => {
    const jpeg = bytes([0xff, 0xd8, 0xff, 0xe0])

    expect(acceptedContentType(jpeg, ['image/jpg'], 'image/jpg')).toBe(
      'image/jpeg',
    )
    expect(acceptedContentType(ebml('matroska'), ['video/x-matroska'])).toBe(
      'video/matroska',
    )
    expect(acceptedContentType(ebml('matroska'), ['video/matroska'])).toBe(
      'video/matroska',
    )
    expect(acceptedContentType(ftyp('M4A '), ['audio/x-m4a'])).toBe('audio/mp4')
  })

  describe('bytes it does not recognise', () => {
    test('are refused when claimed as a type it can detect', () => {
      expect(acceptedContentType(HTML, ['image/png'], 'image/png')).toBeNull()
      expect(acceptedContentType(HTML, ['image/*'], 'image/png')).toBeNull()
      // An alias of a detectable type is a detectable type
      expect(acceptedContentType(HTML, ['*/*'], 'image/jpg')).toBeNull()
      expect(acceptedContentType(HTML, ['*/*'], DOCX)).toBeNull()
    })

    test('are accepted under a claimed type that matches, wildcards included', () => {
      expect(acceptedContentType(CSV, ['text/csv'], 'text/csv')).toBe(
        'text/csv',
      )
      expect(acceptedContentType(CSV, ['text/*'], 'text/csv')).toBe('text/csv')
      expect(acceptedContentType(CSV, ['*/*'], 'text/csv')).toBe('text/csv')
      expect(
        acceptedContentType(bytes('{}'), ['application/*'], 'application/json'),
      ).toBe('application/json')
      expect(acceptedContentType(CSV, ['image/*'], 'text/csv')).toBeNull()
    })

    test('are stored under the canonical spelling of the claimed type', () => {
      expect(
        acceptedContentType(CSV, ['text/csv'], 'TEXT/CSV; charset=utf-8'),
      ).toBe('text/csv')
    })

    test.each([
      ['image/svg+xml', ['image/*']],
      ['text/html', ['text/*']],
      ['application/xhtml+xml', ['application/*']],
      ['text/javascript', ['text/*']],
      ['application/javascript', ['application/*']],
      ['text/xml', ['*/*']],
      ['application/xml', ['application/*']],
      ['application/rss+xml', ['*/*']],
    ])('are never accepted as %s through a wildcard', (type, accept) => {
      expect(acceptedContentType(HTML, accept, type)).toBeNull()
    })

    test('are accepted as a type that can carry script when it is listed exactly', () => {
      const svg = bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>')

      expect(
        acceptedContentType(svg, ['image/*', 'image/svg+xml'], 'image/svg+xml'),
      ).toBe('image/svg+xml')
      expect(acceptedContentType(HTML, ['text/html'], 'text/html')).toBe(
        'text/html',
      )
    })

    test('are refused without a claimed type, or with a wildcard one', () => {
      expect(acceptedContentType(HTML, ['text/html'])).toBeNull()
      expect(acceptedContentType(HTML, ['text/html'], ' ')).toBeNull()
      expect(acceptedContentType(CSV, ['text/*'], 'text/*')).toBeNull()
      expect(acceptedContentType(CSV, ['*/*'], '*/*')).toBeNull()
    })
  })

  describe('office files', () => {
    test('are accepted from the whole file', () => {
      expect(acceptedContentType(officeOpenXml('word'), [DOCX], DOCX)).toBe(
        DOCX,
      )
    })

    test('are refused from the head alone, and accepted with the tail', () => {
      const data = zip([
        { name: '[Content_Types].xml', data: '<Types/>' },
        { name: 'xl/media/a.png', data: new Uint8Array(20_000) },
        { name: 'xl/workbook.xml', data: '<x/>' },
      ])
      const head = data.subarray(0, DETECT_CONTENT_TYPE_BYTES)
      const tail = data.subarray(-DETECT_CONTENT_TYPE_TAIL_BYTES)

      expect(acceptedContentType(head, [XLSX], XLSX)).toBeNull()
      expect(acceptedContentType(head, [XLSX], XLSX, { tail })).toBe(XLSX)
    })

    test('with macros are accepted only when listed exactly, never through a wildcard', () => {
      const docm = officeOpenXml('word', [
        { name: 'word/vbaProject.bin', data: 'vba' },
      ])

      expect(acceptedContentType(docm, ['application/*'], DOCM)).toBeNull()
      expect(acceptedContentType(docm, ['*/*'], DOCM)).toBeNull()
      expect(acceptedContentType(docm, ['application/*', DOCM], DOCM)).toBe(
        DOCM,
      )
      // The registered spelling is accepted as the same type
      expect(
        acceptedContentType(
          docm,
          ['application/vnd.ms-word.document.macroEnabled.12'],
          DOCM,
        ),
      ).toBe(DOCM)
      // Macro-free office files still pass a wildcard
      expect(
        acceptedContentType(officeOpenXml('word'), ['application/*']),
      ).toBe(DOCX)
    })

    test.each([
      'application/msword',
      'application/vnd.ms-excel',
      'application/vnd.ms-powerpoint',
      'application/vnd.ms-word.template.macroenabled.12',
      'application/vnd.ms-excel.addin.macroenabled.12',
    ])('claimed as %s are accepted only when listed exactly', (type) => {
      // Legacy OLE files aren't recognised, so the claim decides
      const ole = bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

      expect(acceptedContentType(ole, ['application/*'], type)).toBeNull()
      expect(acceptedContentType(ole, ['*/*'], type)).toBeNull()
      expect(acceptedContentType(ole, [type], type)).toBe(type)
    })

    test('with macros are not accepted as their macro-free type', () => {
      const docm = officeOpenXml('word', [
        { name: 'word/vbaProject.bin', data: 'vba' },
      ])

      expect(acceptedContentType(docm, [DOCX], DOCX)).toBeNull()
      expect(acceptedContentType(docm, [DOCX, DOCM], DOCX)).toBe(DOCM)
    })
  })
})

describe('checkContentType', () => {
  test('returns the accepted type like acceptedContentType()', () => {
    expect(
      checkContentType(PNG, ['image/*'], 'application/octet-stream'),
    ).toEqual({ contentType: 'image/png' })
    expect(
      checkContentType(bytes('name,email\n'), ['text/*'], 'TEXT/CSV'),
    ).toEqual({ contentType: 'text/csv' })
  })

  test('says what the bytes are and what was claimed when it refuses', () => {
    // An iPhone photo with a sequence brand, sent as a still
    expect(
      checkContentType(
        ftyp('hevc', 'mif1', 'msf1'),
        ['image/heic'],
        'image/heic',
      ),
    ).toEqual({
      rejected: { detected: 'image/heic-sequence', claimed: 'image/heic' },
    })
    expect(checkContentType(PNG, ['image/jpeg'], 'image/jpg')).toEqual({
      rejected: { detected: 'image/png', claimed: 'image/jpeg' },
    })
    expect(checkContentType(bytes('<p>'), ['image/*'], 'image/png')).toEqual({
      rejected: { detected: null, claimed: 'image/png' },
    })
    expect(checkContentType(bytes('<p>'), ['text/*'])).toEqual({
      rejected: { detected: null, claimed: null },
    })
    expect(checkContentType(PNG, ['image/jpeg'], ' ')).toEqual({
      rejected: { detected: 'image/png', claimed: null },
    })
  })
})

describe('isClaimedContentTypeAllowed', () => {
  test('applies the wildcard rules without looking at bytes', () => {
    expect(isClaimedContentTypeAllowed(['image/*'], 'image/png')).toBe(true)
    expect(isClaimedContentTypeAllowed(['image/jpeg'], 'image/jpg')).toBe(true)
    expect(isClaimedContentTypeAllowed(['text/*'], 'text/csv')).toBe(true)
    expect(isClaimedContentTypeAllowed(['image/*'], 'image/svg+xml')).toBe(
      false,
    )
    expect(
      isClaimedContentTypeAllowed(['image/svg+xml'], 'image/svg+xml'),
    ).toBe(true)
    expect(isClaimedContentTypeAllowed(['*/*'], 'text/html')).toBe(false)
    expect(isClaimedContentTypeAllowed(['image/*'], 'image/*')).toBe(false)
    expect(isClaimedContentTypeAllowed(['application/*'], DOCM)).toBe(false)
    expect(
      isClaimedContentTypeAllowed(['application/*'], 'application/msword'),
    ).toBe(false)
    expect(isClaimedContentTypeAllowed([DOCM], DOCM)).toBe(true)
    expect(isClaimedContentTypeAllowed(['application/*'], DOCX)).toBe(true)
    expect(isClaimedContentTypeAllowed(['image/*'], '')).toBe(false)
  })
})
