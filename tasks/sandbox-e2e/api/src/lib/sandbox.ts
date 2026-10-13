import dns from 'node:dns/promises'

import {
  findChildScript,
  permissionModelBlocksNetwork,
  runSandboxedChild,
} from '@cedarjs/api/sandbox'

// A 16x16 red PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAGUlEQVQokWM4ISdHEmIY1SA3GkonhmvSAADkYgQQjClmVwAAAABJRU5ErkJggg==',
  'base64',
)

const parse = (output: Buffer) => {
  try {
    return JSON.parse(output.toString())
  } catch {
    return output.toString()
  }
}

/**
 * Runs a pure-JS child that tries to reach the network, the environment
 * and this file, and a sharp child that makes a thumbnail
 */
export async function runSandboxChecks() {
  // The function itself can reach the network: the child's refusals mean
  // something
  const parentDns = await dns
    .lookup('example.com')
    .then(() => 'resolved')
    .catch((e: unknown) => (e instanceof Error ? e.message : String(e)))

  const probe = await runSandboxedChild({
    script: findChildScript(import.meta.dirname, 'sandboxProbe.child'),
    input: Buffer.alloc(0),
    args: [import.meta.filename],
    timeoutMs: 20_000,
  })

  const thumbnail = await runSandboxedChild({
    script: findChildScript(import.meta.dirname, 'sandboxThumbnail.child'),
    packages: ['sharp'],
    allowAddons: true,
    input: PNG,
    timeoutMs: 20_000,
  })

  return {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    permissionModelBlocksNetwork: permissionModelBlocksNetwork(),
    parentDns,
    probe: probe.ok
      ? { ok: true, result: parse(probe.output) }
      : { ok: false, message: probe.message, stderr: probe.stderr },
    thumbnail: thumbnail.ok
      ? { ok: true, result: parse(thumbnail.output) }
      : { ok: false, message: thumbnail.message, stderr: thumbnail.stderr },
  }
}
