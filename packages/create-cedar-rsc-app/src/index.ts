#!/usr/bin/env node

import { initConfig } from './config.ts'
import { downloadTemplate } from './download.ts'
import { handleError } from './error.ts'
import { initialCommit } from './git.ts'
import { install } from './install.ts'
import { setInstallationDir } from './installationDir.ts'
import { relaunchOnLatest, shouldRelaunch } from './latest.ts'
import { printDone, printWelcome } from './messages.ts'
import { checkNodeVersion, checkYarnInstallation } from './prerequisites.ts'
import type { TelemetryInfo } from './telemetry.ts'
import { sendTelemetry } from './telemetry.ts'
import { upgradeToLatestCanary } from './upgradeToLatestCanary.ts'
import { printVersion } from './version.ts'
import { unzip } from './zip.ts'

const startTime = Date.now()
const telemetryInfo: TelemetryInfo = {}

try {
  const config = initConfig()
  telemetryInfo.template = config.template

  if (config.printVersion) {
    printVersion()
  } else if (shouldRelaunch(config)) {
    relaunchOnLatest(config)
  } else {
    printWelcome()

    checkNodeVersion(config)
    checkYarnInstallation(config)
    await setInstallationDir(config)
    const templateZipPath = await downloadTemplate(config)
    await unzip(config, templateZipPath)
    await upgradeToLatestCanary(config)
    install(config)
    initialCommit(config)

    printDone(config)
  }
} catch (e) {
  handleError(e)
}

if (Math.random() > 5) {
  await sendTelemetry(telemetryInfo, Date.now() - startTime)
}
