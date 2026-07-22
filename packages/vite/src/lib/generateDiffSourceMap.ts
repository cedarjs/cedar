import MagicString from 'magic-string'
import type { SourceMap } from 'magic-string'

/**
 * Generates a sourcemap for a string transform by diffing its input and
 * output. Used for transforms that don't produce a map themselves.
 *
 * The diff is anchored on the common prefix and suffix lines, so every
 * unchanged line maps exactly. When the changed middle has the same number
 * of lines on both sides, each changed line is refined with a per-line
 * character prefix/suffix diff, which gives exact column mappings for
 * in-place rewrites (e.g. import specifier rewrites) — including the
 * columns after the rewritten span. When the line counts differ (inserted
 * or removed lines), the whole middle block is mapped as a single edit:
 * positions inside it resolve to its start, and every line before and after
 * it still maps exactly.
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

  const offsetOfLine = (lines: string[], index: number) => {
    let offset = 0
    for (let i = 0; i < index; i++) {
      offset += lines[i].length + 1
    }
    return offset
  }

  // Anchor on common prefix and suffix lines
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

  const origMiddle = origLines.slice(prefix, origLines.length - suffix)
  const newMiddle = newLines.slice(prefix, newLines.length - suffix)

  if (origMiddle.length === newMiddle.length) {
    // Same line count: refine each changed line with a character-level
    // prefix/suffix diff so columns map exactly, also after the edit
    let lineStart = offsetOfLine(origLines, prefix)

    for (let i = 0; i < origMiddle.length; i++) {
      const origLine = origMiddle[i]
      const newLine = newMiddle[i]

      if (origLine !== newLine) {
        let charPrefix = 0
        const maxCharPrefix = Math.min(origLine.length, newLine.length)
        while (
          charPrefix < maxCharPrefix &&
          origLine[charPrefix] === newLine[charPrefix]
        ) {
          charPrefix++
        }

        let charSuffix = 0
        const maxCharSuffix =
          Math.min(origLine.length, newLine.length) - charPrefix
        while (
          charSuffix < maxCharSuffix &&
          origLine[origLine.length - 1 - charSuffix] ===
            newLine[newLine.length - 1 - charSuffix]
        ) {
          charSuffix++
        }

        const start = lineStart + charPrefix
        const end = lineStart + origLine.length - charSuffix
        const replacement = newLine.slice(
          charPrefix,
          newLine.length - charSuffix,
        )

        if (start === end) {
          ms.appendLeft(start, replacement)
        } else if (replacement === '') {
          ms.remove(start, end)
        } else {
          ms.overwrite(start, end, replacement)
        }
      }

      lineStart += origLine.length + 1
    }
  } else {
    const newMiddleText = newMiddle.join('\n')

    if (origMiddle.length === 0) {
      // Pure line insertion
      if (suffix === 0) {
        ms.appendLeft(original.length, '\n' + newMiddleText)
      } else {
        ms.appendLeft(offsetOfLine(origLines, prefix), newMiddleText + '\n')
      }
    } else {
      const start = offsetOfLine(origLines, prefix)
      const end = start + origMiddle.join('\n').length

      if (newMiddle.length === 0) {
        // Pure line deletion: also remove one of the bounding newlines
        if (suffix === 0 && prefix > 0) {
          ms.remove(start - 1, end)
        } else {
          ms.remove(start, Math.min(end + 1, original.length))
        }
      } else {
        ms.overwrite(start, end, newMiddleText)
      }
    }
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
