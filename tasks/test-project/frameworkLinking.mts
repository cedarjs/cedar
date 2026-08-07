import execa from 'execa'

export function copyFrameworkPackages(
  frameworkPath: string,
  projectPath: string,
  stdio?: 'pipe' | 'ignore' | 'inherit',
) {
  return execa('yarn', ['project:copy'], {
    cwd: frameworkPath,
    stdio: stdio ?? 'inherit',
    env: {
      CFW_PATH: frameworkPath,
      CEDAR_CWD: projectPath,
    },
  })
}
