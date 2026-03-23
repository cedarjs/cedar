import execa from 'execa'

export function addFrameworkDepsToProject(
  frameworkPath: string,
  projectPath: string,
  stdio?: 'pipe' | 'ignore' | 'inherit',
) {
  return execa('yarn', ['project:deps'], {
    cwd: frameworkPath,
    stdio: stdio ?? 'inherit',
    env: {
      CFW_PATH: frameworkPath,
      CEDAR_CWD: projectPath,
      // TODO: Remove this as soon as Cedar v2.6.0 is released
      RWJS_CWD: projectPath,
    },
  })
}

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
      // TODO: Remove this as soon as Cedar v2.6.0 is released
      RWJS_CWD: projectPath,
    },
  })
}
