import { describe, expect, test } from 'vitest'

import {
  acceptedContentType,
  DETECT_CONTENT_TYPE_BYTES,
  DETECTABLE_CONTENT_TYPES,
  detectContentType,
} from '../detectContentType.js'

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
  ['Matroska', ebml('matroska'), 'video/x-matroska'],
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
  test.each([...RECOGNISED, ...BRANDS])(
    'recognises %s',
    (_name, data, expected) => {
      expect(detectContentType(strict(data))).toBe(expected)
    },
  )

  test('works on a Buffer as well as a Uint8Array', () => {
    expect(detectContentType(Buffer.from(PNG))).toBe('image/png')
  })

  test('only returns types listed in DETECTABLE_CONTENT_TYPES', () => {
    for (const [, data, expected] of [...RECOGNISED, ...BRANDS]) {
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
    ['a ZIP archive (e.g. .docx)', bytes('PK', [3, 4, 20, 0, 0, 0])],
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
        // Header size 7, written in two bytes
        [0x40, 0x07],
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
    for (const [name, data, expected] of [...RECOGNISED, ...BRANDS]) {
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

    const headers = [...RECOGNISED, ...BRANDS].map(([, data]) => data)

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

describe('acceptedContentType', () => {
  const HTML = bytes('<!doctype html><script>alert(1)</script>')

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

  test('rejects unrecognised bytes claimed to be a detectable type', () => {
    expect(acceptedContentType(HTML, ['image/png'], 'image/png')).toBeNull()
    expect(acceptedContentType(HTML, ['image/*'], 'image/png')).toBeNull()
  })

  test('accepts unrecognised bytes only for a claimed type listed exactly', () => {
    const csv = bytes('name,email\n')

    expect(acceptedContentType(csv, ['text/*'], 'text/csv')).toBeNull()
    expect(acceptedContentType(csv, ['*/*'], 'text/csv')).toBeNull()
    expect(acceptedContentType(csv, ['image/*', 'Text/CSV'], 'text/csv')).toBe(
      'text/csv',
    )
    expect(
      acceptedContentType(csv, ['text/csv'], 'TEXT/CSV; charset=utf-8'),
    ).toBe('text/csv')
  })

  test('rejects unrecognised bytes without a claimed type', () => {
    expect(acceptedContentType(HTML, ['text/html'])).toBeNull()
    expect(acceptedContentType(HTML, ['text/html'], ' ')).toBeNull()
  })

  test('never accepts SVG through an image wildcard', () => {
    const svg = bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>')

    expect(acceptedContentType(svg, ['image/*'], 'image/svg+xml')).toBeNull()
  })
})
