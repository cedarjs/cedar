import execa from 'execa'
import type { StdioOption } from 'execa'

export const addFrameworkDepsToProject = (
  frameworkPath: string,
  projectPath: string,
  stdio?: StdioOption,
) => {
  return execa('yarn project:deps', {
    cwd: frameworkPath,
    shell: true,
    stdio: stdio ? stdio : 'inherit',
    env: {
      CFW_PATH: frameworkPath,
      RWJS_CWD: projectPath,
    },
  })
}

export const copyFrameworkPackages = (
  frameworkPath: string,
  projectPath: string,
  stdio?: StdioOption,
) => {
  return execa('yarn project:copy', {
    cwd: frameworkPath,
    shell: true,
    stdio: stdio ? stdio : 'inherit',
    env: {
      CFW_PATH: frameworkPath,
      RWJS_CWD: projectPath,
    },
  })
}