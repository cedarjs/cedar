import { findChildScript, runSandboxedChild } from '@cedarjs/api/sandbox'

export async function humanize(text: string) {
  const result = await runSandboxedChild({
    script: findChildScript(import.meta.dirname, 'humanize.child'),
    input: Buffer.from(text),
  })

  if (!result.ok) {
    throw new Error(result.message)
  }

  return result.output.toString()
}
