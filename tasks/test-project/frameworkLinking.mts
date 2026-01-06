import execa from 'execa'

export function addFrameworkDepsToProject(
  frameworkPath: string,
  projectPath: string,
  stdio?: 'pipe' | 'ignore' | 'inherit',
) {
  return execa('yarn project:deps', [], {
    cwd: frameworkPath,
    shell: true,
    stdio: stdio ?? 'inherit',
    env: {
      CFW_PATH: frameworkPath,
      RWJS_CWD: projectPath,
    },
  })
}

export function copyFrameworkPackages(
  frameworkPath: string,
  projectPath: string,
  stdio?: 'pipe' | 'ignore' | 'inherit',
) {
  return execa('yarn project:copy', [], {
    cwd: frameworkPath,
    shell: true,
    stdio: stdio ?? 'inherit',
    env: {
      CFW_PATH: frameworkPath,
      RWJS_CWD: projectPath,
    },
  })
}
