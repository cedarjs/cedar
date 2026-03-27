import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api'
import opentelemetry, { SpanStatusCode } from '@opentelemetry/api'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { Resource } from '@opentelemetry/resources'
import {
  NodeTracerProvider,
  BatchSpanProcessor,
} from '@opentelemetry/sdk-trace-node'
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions'
import ci from 'ci-info'
import envinfo from 'envinfo'
import system from 'systeminformation'
import { v4 as uuidv4 } from 'uuid'

import pkgJson from '../package.json' with { type: 'json' }
const { name: packageName, version: packageVersion } = pkgJson

// Copied from @opentelemetry/semantic-conventions/incubating, as recommended:
// https://github.com/open-telemetry/opentelemetry-js/blob/main/semantic-conventions/README.md#unstable-semconv
const SEMRESATTRS_OS_TYPE = 'os.type'
const SEMRESATTRS_OS_VERSION = 'os.version'

let traceProvider: NodeTracerProvider | undefined
let traceProcessor: BatchSpanProcessor | undefined
let traceExporter: OTLPTraceExporter | undefined

export const UID = uuidv4()

export async function startTelemetry(): Promise<void> {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR)

  // Resources
  const info = JSON.parse(
    await envinfo.run(
      {
        System: ['OS', 'Shell'],
        Binaries: ['Node', 'Yarn', 'npm'],
        npmPackages: '@cedarjs/*',
        IDEs: ['VSCode'],
      },
      { json: true },
    ),
  )

  // get shell name instead of path
  const shell = info.System?.Shell // Windows doesn't always provide shell info, I guess
  if (shell?.path?.match('/')) {
    info.System.Shell.name = info.System.Shell.path.split('/').pop()
  } else if (shell?.path.match('\\')) {
    info.System.Shell.name = info.System.Shell.path.split('\\').pop()
  }
  const cpu = await system.cpu()
  const mem = await system.mem()

  // Record any specific development environment
  let developmentEnvironment = undefined
  // Gitpod
  if (Object.keys(process.env).some((key) => key.startsWith('GITPOD_'))) {
    developmentEnvironment = 'gitpod'
  }

  const resource = Resource.default().merge(
    new Resource({
      [ATTR_SERVICE_NAME]: packageName,
      [ATTR_SERVICE_VERSION]: packageVersion,
      [SEMRESATTRS_OS_TYPE]: info.System?.OS?.split(' ')[0],
      [SEMRESATTRS_OS_VERSION]: info.System?.OS?.split(' ')[1],
      'shell.name': info.System?.Shell?.name,
      'node.version': info.Binaries?.Node?.version,
      'yarn.version': info.Binaries?.Yarn?.version,
      'npm.version': info.Binaries?.npm?.version,
      'vscode.version': info.IDEs?.VSCode?.version,
      'cpu.count': cpu.physicalCores,
      'memory.gb': Math.round(mem.total / 1073741824),
      'env.node_env': process.env.NODE_ENV || undefined,
      'ci.redwood': !!process.env.REDWOOD_CI,
      'ci.isci': ci.isCI,
      'dev.environment': developmentEnvironment,
      uid: UID,
    }),
  )

  // Tracing
  traceExporter = new OTLPTraceExporter({
    url:
      process.env.REDWOOD_REDIRECT_TELEMETRY ||
      'https://quark.quantumparticle.io/v1/traces',
  })
  traceProcessor = new BatchSpanProcessor(traceExporter)
  traceProvider = new NodeTracerProvider({
    resource: resource,
    spanProcessors: [traceProcessor],
  })
  traceProvider.register()

  process.on('SIGTERM', async () => {
    await shutdownTelemetry()
  })
}

export async function shutdownTelemetry(): Promise<void> {
  try {
    opentelemetry.trace.getActiveSpan()?.end()
    await traceProvider?.shutdown()
    await traceProcessor?.shutdown()
    await traceExporter?.shutdown()
  } catch (error) {
    // We silence this error for user experience unless verbose telemetry is
    // enabled
    if (process.env.REDWOOD_VERBOSE_TELEMETRY) {
      console.error('Telemetry: shutdown error', error)
    }
  }
}

export function recordErrorViaTelemetry(error: unknown): void {
  opentelemetry.trace.getActiveSpan()?.setStatus({
    code: SpanStatusCode.ERROR,
    message: String(error).split('\n')[0],
  })
  opentelemetry.trace
    .getActiveSpan()
    ?.recordException(error instanceof Error ? error : new Error(String(error)))
}
