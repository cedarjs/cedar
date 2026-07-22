import MagicString from 'magic-string'
import type { SourceMap } from 'magic-string'

// The line alignment below is quadratic in the size of the changed region.
// For pathologically large regions, skip the alignment and map the region as
// a single edit instead of blowing up build time.
const MAX_ALIGNMENT_CELLS = 1_000_000

interface Hunk {
  oStart: number
  oEnd: number
  nStart: number
  nEnd: number
}

/**
 * Generates a sourcemap for a string transform by diffing its input and
 * output. Used for transforms that don't produce a map themselves.
 *
 * The diff first anchors on the common prefix and suffix lines, then aligns
 * the remaining lines with an LCS so that unchanged lines *inside* the
 * changed region (e.g. statements inside a newly inserted wrapper) also map
 * exactly. Aligned line pairs that differ are refined with a character-level
 * prefix/suffix diff, which gives exact column mappings for in-place
 * rewrites (e.g. import specifier rewrites) — including the columns after
 * the rewritten span. Only lines with no counterpart at all map coarsely, to
 * the start of their surrounding edit.
 *
 * Returns null when the input and output are identical.
 */
export function generateDiffSourceMap(
  original: string,
  transformed: string,
): SourceMap | null {
  if (original === transformed) {
    return null
  }

  const ms = new MagicString(original)

  const origLines = original.split('\n')
  const newLines = transformed.split('\n')

  // lineOffsets[i] = character offset where original line i starts
  const lineOffsets: number[] = new Array(origLines.length)
  let offset = 0
  for (let i = 0; i < origLines.length; i++) {
    lineOffsets[i] = offset
    offset += origLines[i].length + 1
  }

  // Anchor on common prefix and suffix lines. This is a fast path for the
  // typical localized edit and bounds the alignment work below.
  let prefix = 0
  const maxPrefix = Math.min(origLines.length, newLines.length)
  while (prefix < maxPrefix && origLines[prefix] === newLines[prefix]) {
    prefix++
  }

  let suffix = 0
  const maxSuffix = Math.min(origLines.length, newLines.length) - prefix
  while (
    suffix < maxSuffix &&
    origLines[origLines.length - 1 - suffix] ===
      newLines[newLines.length - 1 - suffix]
  ) {
    suffix++
  }

  const hunks = alignLines(
    origLines,
    prefix,
    origLines.length - suffix,
    newLines,
    prefix,
    newLines.length - suffix,
  )

  for (const hunk of hunks) {
    applyHunk(ms, hunk, origLines, newLines, lineOffsets, original.length)
  }

  if (ms.toString() !== transformed) {
    // Defensive: if the edit reconstruction doesn't reproduce the transformed
    // code exactly, a mapping derived from it would be wrong. Fall back to a
    // high-resolution identity map, which is line-accurate for
    // line-preserving transforms and never worse than no map.
    return new MagicString(original).generateMap({ hires: true })
  }

  return ms.generateMap({ hires: true })
}

/**
 * Aligns the changed regions' lines via a longest-common-subsequence walk
 * and returns the unequal hunks between matched lines. Matched lines are
 * left untouched so they map exactly.
 */
function alignLines(
  origLines: string[],
  oLo: number,
  oHi: number,
  newLines: string[],
  nLo: number,
  nHi: number,
): Hunk[] {
  const m = oHi - oLo
  const n = nHi - nLo

  if (m === 0 && n === 0) {
    return []
  }

  if (m === 0 || n === 0 || m * n > MAX_ALIGNMENT_CELLS) {
    return [{ oStart: oLo, oEnd: oHi, nStart: nLo, nEnd: nHi }]
  }

  // Standard LCS table, flattened: dp[i][j] = LCS length of
  // origLines[oLo+i..] and newLines[nLo+j..]
  const width = n + 1
  const dp = new Int32Array((m + 1) * width)
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i * width + j] =
        origLines[oLo + i] === newLines[nLo + j]
          ? dp[(i + 1) * width + j + 1] + 1
          : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1])
    }
  }

  const hunks: Hunk[] = []
  let i = 0
  let j = 0
  let hunkO = 0
  let hunkN = 0

  const flushHunk = () => {
    if (i > hunkO || j > hunkN) {
      hunks.push({
        oStart: oLo + hunkO,
        oEnd: oLo + i,
        nStart: nLo + hunkN,
        nEnd: nLo + j,
      })
    }
  }

  while (i < m && j < n) {
    if (origLines[oLo + i] === newLines[nLo + j]) {
      flushHunk()
      i++
      j++
      hunkO = i
      hunkN = j
    } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      i++
    } else {
      j++
    }
  }
  i = m
  j = n
  flushHunk()

  return hunks
}

function applyHunk(
  ms: MagicString,
  { oStart, oEnd, nStart, nEnd }: Hunk,
  origLines: string[],
  newLines: string[],
  lineOffsets: number[],
  originalLength: number,
): void {
  const oCount = oEnd - oStart
  const nCount = nEnd - nStart
  const newSlice = newLines.slice(nStart, nEnd)

  if (oCount === nCount) {
    // Same line count: refine each line pair with a character-level
    // prefix/suffix diff so columns map exactly, also after the edit
    for (let k = 0; k < oCount; k++) {
      diffLinePair(
        ms,
        lineOffsets[oStart + k],
        origLines[oStart + k],
        newLines[nStart + k],
      )
    }
  } else if (oCount === 0) {
    // Pure line insertion before original line oStart
    const text = newSlice.join('\n')
    if (oStart >= origLines.length) {
      ms.appendLeft(originalLength, '\n' + text)
    } else {
      ms.appendLeft(lineOffsets[oStart], text + '\n')
    }
  } else if (nCount === 0) {
    // Pure line deletion: also remove one of the bounding newlines
    const start = lineOffsets[oStart]
    if (oEnd >= origLines.length) {
      ms.remove(oStart > 0 ? start - 1 : start, originalLength)
    } else {
      ms.remove(start, lineOffsets[oEnd])
    }
  } else {
    // Replace the block, excluding the trailing newline (it is shared with
    // whatever follows)
    const start = lineOffsets[oStart]
    const end = lineOffsets[oEnd - 1] + origLines[oEnd - 1].length
    ms.overwrite(start, end, newSlice.join('\n'))
  }
}

function diffLinePair(
  ms: MagicString,
  lineStart: number,
  origLine: string,
  newLine: string,
): void {
  if (origLine === newLine) {
    return
  }

  let charPrefix = 0
  const maxCharPrefix = Math.min(origLine.length, newLine.length)
  while (
    charPrefix < maxCharPrefix &&
    origLine[charPrefix] === newLine[charPrefix]
  ) {
    charPrefix++
  }

  let charSuffix = 0
  const maxCharSuffix = Math.min(origLine.length, newLine.length) - charPrefix
  while (
    charSuffix < maxCharSuffix &&
    origLine[origLine.length - 1 - charSuffix] ===
      newLine[newLine.length - 1 - charSuffix]
  ) {
    charSuffix++
  }

  const start = lineStart + charPrefix
  const end = lineStart + origLine.length - charSuffix
  const replacement = newLine.slice(charPrefix, newLine.length - charSuffix)

  if (start === end) {
    ms.appendLeft(start, replacement)
  } else if (replacement === '') {
    ms.remove(start, end)
  } else {
    ms.overwrite(start, end, replacement)
  }
}
