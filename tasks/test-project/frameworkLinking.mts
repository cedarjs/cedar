import execa from 'execa'
import type { StdioOption, Options as ExecaOptions } from 'execa'

export const addFrameworkDepsToProject = (
  frameworkPath: string,
  projectPath: string,
  stdio?: StdioOption,
) => {
  const options: ExecaOptions = {
    cwd: frameworkPath,
    shell: true,
    stdio: (stdio ?? 'inherit') as any,
    env: {
      CFW_PATH: frameworkPath,
      RWJS_CWD: projectPath,
    },
  }

  return execa('yarn', ['project:deps'], options)
}

export const copyFrameworkPackages = (
  frameworkPath: string,
  projectPath: string,
  stdio?: StdioOption,
) => {
  const options: ExecaOptions = {
    cwd: frameworkPath,
    shell: true,
    stdio: (stdio ?? 'inherit') as any,
    env: {
      CFW_PATH: frameworkPath,
      RWJS_CWD: projectPath,
    },
  }

  return execa('yarn', ['project:copy'], options)
}
