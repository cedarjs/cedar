import fs from 'fs'

import mime from 'mime-types'

// These functions are in a separate file so that they can be mocked with jest

// Its possible for sourceRoot to be undefined in the tests..
// Not sure if possible in actually running builds
export function convertToDataUrl(assetPath: string) {
  try {
    const base64AssetContents = fs.readFileSync(assetPath, 'base64')
    const mimeType = mime.lookup(assetPath)
    return `data:${mimeType};base64,${base64AssetContents}`
  } catch {
    console.warn(`Could not read file ${assetPath} for conversion to data uri`)
    return ''
  }
}

export function dedent(indentLevel: number) {
  return (strings: TemplateStringsArray, ...values: any[]) => {
    // Reconstruct the full string from template literal parts
    let result = strings[0]

    for (let i = 0; i < values.length; i++) {
      result += values[i] + strings[i + 1]
    }

    // Split into lines
    const lines = result.split('\n')

    // Remove leading/trailing empty lines
    while (lines.length > 0 && lines[0].trim() === '') {
      lines.shift()
    }
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
      lines.pop()
    }

    const minIndent = indentLevel

    // Remove the specified indentation from lines that have enough indentation
    const dedentedLines = lines.map((line) => {
      if (line.trim() === '') {
        return ''
      }

      // Check if line has enough indentation to remove
      const match = line.match(/^(\s*)/)
      if (match && match[1].length >= minIndent) {
        return line.slice(minIndent)
      }

      // Return line as-is if it doesn't have enough indentation
      return line
    })

    return dedentedLines.join('\n')
  }
}
