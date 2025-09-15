import cfonts from 'cfonts'
import gradient from 'gradient-string'

export function generateLogo(text: string, options: { palette: string[] }) {
  const output = cfonts.render(text, {
    letterSpacing: 2,
    gradient: false,
  })

  // Check if output is valid
  if (!output || typeof output === 'boolean') {
    return
  }

  // Apply gradient to each line of the output
  const lines = output.string.split('\n')
  const gradientInstance = gradient(options.palette)

  const gradientLines = lines.map((line: string) => {
    if (line.trim()) {
      return gradientInstance(line)
    }
    return line
  })

  // return the final result
  return gradientLines.join('\n')
}
