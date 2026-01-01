export { DiagnosticSeverity } from './x/diagnostics'
export { RWProject, RWRoute } from './model'
export { URL_file } from './x/URL'
import { RWProject } from './model'
import type { GetSeverityLabelFunction } from './x/diagnostics'
import { ExtendedDiagnostic_format, DiagnosticSeverity } from './x/diagnostics'

export function getProject(projectRoot: string) {
  return new RWProject({
    projectRoot,
  })
}

export async function printDiagnostics(
  projectRoot: string,
  opts?: { getSeverityLabel?: GetSeverityLabelFunction },
) {
  const project = getProject(projectRoot)
  const formatOpts = { cwd: projectRoot, ...opts }
  try {
    let warnings = 0
    let errors = 0
    for (const d of await project.collectDiagnostics()) {
      const str = ExtendedDiagnostic_format(d, formatOpts)
      console.log(`\n${str}`)
      // counts number of warnings and errors encountered
      if (d.diagnostic.severity === DiagnosticSeverity.Warning) {
        warnings++
      }
      if (d.diagnostic.severity === DiagnosticSeverity.Error) {
        errors++
      }
    }

    if (warnings === 0 && errors === 0) {
      console.log('\nSuccess: no errors or warnings were detected\n')
    } else if (errors > 0) {
      console.error(
        `\nFailure: ${errors} errors and ${warnings} warnings detected\n`,
      )
      process.exit(1)
    }
  } catch (e: any) {
    throw new Error(e.message)
  }
}
