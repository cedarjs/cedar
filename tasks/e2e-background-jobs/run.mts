import process from 'node:process'

import { $, cd, path, ProcessOutput, fs } from 'zx'

import {
  JOBS_SCRIPT,
  PRISMA_SCRIPT,
  SAMPLE_FUNCTION,
  SAMPLE_JOB_PERFORM_ARGS,
  SAMPLE_JOB_PERFORM_BODY,
  SAMPLE_CRON_JOB,
  SCHEDULE_CRON_JOB_SCRIPT,
} from './fixtures.mjs'
import {
  makeFilePath,
  projectDirectoryExists,
  projectFileExists,
} from './util.mjs'

// job {
//   id: 1,
//   attempts: 0,
//   handler: `{
//     "name":"SampleJob",
//     "path":"SampleJob/SampleJob",
//     "args":[
//       "/Users/tobbe/tmp/cj-test-project-e2e-cron/BACKGROUND_JOB_TEST.txt",
//       "0049550"
//     ]
//   }`,
//   queue: 'default',
//   priority: 50,
//   runAt: '2025-07-09T10:45:28.723Z',
//   cron: null,
//   lockedAt: null,
//   lockedBy: null,
//   lastError: null,
//   failedAt: null,
//   createdAt: '2025-07-09T10:45:28.726Z',
//   updatedAt: '2025-07-09T10:45:28.726Z'
// }
// This is not a complete type, but it's enough for the purpose of this test
type Job = {
  id: string
  handler: string
  runAt: string | null
  cron: string | null
}

$.env.DATABASE_URL = 'file:./dev.db'

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2)
  const cleanFlag = args.includes('--clean')
  const inputPath = args.find((arg) => !arg.startsWith('--'))

  if (!inputPath) {
    console.error('No project path provided')
    process.exit(1)
  }

  // Change to the project directory
  const projectPath = path.resolve(inputPath)
  cd(projectPath)

  console.log(`Running background jobs E2E tests in project: ${projectPath}`)

  // Run git clean if --clean flag is provided
  if (cleanFlag) {
    console.log('\n🧹 Running git clean...')
    try {
      await $`git clean -fdx -e node_modules && git reset --hard && yarn`
      console.log('Git clean completed')
    } catch (error) {
      if (error instanceof ProcessOutput) {
        console.error('Failed to run git clean')
        console.error(error.toString())
        process.exit(1)
      } else {
        throw error
      }
    }
  }

  const testFileName = 'BACKGROUND_JOB_TEST.txt'
  const testFileLocation = path.join(projectPath, testFileName)
  const testFileData = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(7, '0')

  // Run all test steps
  await runJobsSetup(projectPath)
  await migrateDatabase(projectPath)
  await confirmPrismaModelExists()
  await generateJob(projectPath, testFileLocation, testFileData)
  await generateCronJob(projectPath)
  await scheduleCronJob(projectPath)
  await confirmJobDidNotRunSynchronously(projectPath, testFileName)
  const job = await confirmJobsWereScheduled(testFileLocation, testFileData)
  await jobsWorkoff()
  await confirmJobsRan(
    projectPath,
    testFileName,
    testFileLocation,
    testFileData,
  )
  await confirmJobWasRemoved(job)
  await runCronJob(projectPath)

  console.log('\n✅ All tests passed 🎉')
}

async function runJobsSetup(projectPath: string) {
  console.log('\n❓ Testing: `yarn rw setup jobs`')

  try {
    await $`yarn rw setup jobs`
  } catch (error) {
    if (error instanceof ProcessOutput) {
      console.error("💥 Failed to run: 'yarn rw setup jobs'")
      console.error(error.toString())
      process.exit(1)
    } else {
      throw error
    }
  }

  // Confirm job config file
  if (
    !projectFileExists({
      projectPath,
      filePath: 'api/src/lib/jobs.ts',
    })
  ) {
    console.error("💥 Expected file 'api/src/lib/jobs.ts' not found")
    process.exit(1)
  }
  console.log('Confirmed: job config file exists')

  const jobsTs = fs.readFileSync(
    path.join(projectPath, 'api/src/lib/jobs.ts'),
    'utf8',
  )

  if (!/import \{.*JobManager.*\} from ['"]@cedarjs\/jobs['"]/.test(jobsTs)) {
    console.error(
      "💥 Expected import from '@cedarjs/jobs' not found in 'api/src/lib/jobs.ts'",
    )
    process.exit(1)
  }

  if (
    !/adapter: ['"]prisma['"]/.test(jobsTs) ||
    !/queue: ['"]\*['"]/.test(jobsTs) ||
    !jobsTs.includes('sleepDelay: 5')
  ) {
    console.error("💥 Expected config not found in 'api/src/lib/jobs.ts'")
    process.exit(1)
  }

  console.log('Action: Altering the JobManager config to poll more often')
  const updatedJobsTs = jobsTs.replace('sleepDelay: 5', 'sleepDelay: 1')

  fs.writeFileSync(
    path.join(projectPath, 'api/src/lib/jobs.ts'),
    updatedJobsTs,
    'utf8',
  )

  // Confirm jobs directory
  if (
    !projectDirectoryExists({
      projectPath,
      directoryPath: 'api/src/jobs',
    })
  ) {
    console.error("💥 Expected directory 'api/src/jobs' not found")
    process.exit(1)
  }
  console.log('Confirmed: jobs directory')

  // Confirm jobs dependency in api package.json
  const apiPackageJson = await import(
    makeFilePath(path.join(projectPath, 'api/package.json'))
  )
  if (!apiPackageJson.dependencies['@cedarjs/jobs']) {
    console.error(
      "💥 Expected dependency '@cedarjs/jobs' not found in 'api/package.json'",
    )
    process.exit(1)
  }
  console.log('Confirmed: jobs dependency in api package.json')
}

async function migrateDatabase(projectPath: string) {
  console.log('\n❓ Testing: `yarn rw prisma migrate dev`')
  try {
    await $`yarn rw prisma migrate dev --name e2e-background-jobs`
  } catch (error) {
    if (error instanceof ProcessOutput) {
      console.error("💥 Failed to run: 'yarn rw prisma migrate dev'")
      console.error(error.toString())
      process.exit(1)
    } else {
      throw error
    }
  }

  // Confirm the prisma model exists
  console.log('Action: Adding scripts to get information from the database')
  const jobsScriptPath = path.join(projectPath, 'scripts/jobs.ts')
  fs.writeFileSync(jobsScriptPath, JOBS_SCRIPT)
  const prismaScriptPath = path.join(projectPath, 'scripts/prisma.ts')
  fs.writeFileSync(prismaScriptPath, PRISMA_SCRIPT)
}

async function confirmPrismaModelExists() {
  console.log('\n❓ Testing: the prisma model exists in the database')

  const prismaData = (await $`yarn rw exec prisma --silent`).toString()

  try {
    const { name } = JSON.parse(prismaData)

    if (name !== 'BackgroundJob') {
      console.error('💥 Expected model not found in the database')
      process.exit(1)
    }

    console.log('Confirmed: prisma model exists')
  } catch (error) {
    console.error('💥 Error: Failed to parse prisma script output')
    console.error(prismaData)
    console.error(error?.toString())
    process.exit(1)
  }
}

async function generateJob(
  projectPath: string,
  testFileLocation: string,
  testFileData: string,
) {
  console.log('\n❓ Testing: `yarn rw generate job SampleJob`')
  try {
    await $`yarn rw generate job SampleJob`
  } catch (error) {
    if (error instanceof ProcessOutput) {
      console.error("💥 Failed to run: 'yarn rw generate job SampleJob'")
      console.error(error.toString())
      process.exit(1)
    } else {
      throw error
    }
  }

  // Confirm the job file exists
  const expectedFiles = [
    'api/src/jobs/SampleJob/SampleJob.ts',
    'api/src/jobs/SampleJob/SampleJob.test.ts',
    'api/src/jobs/SampleJob/SampleJob.scenarios.ts',
  ]
  for (const file of expectedFiles) {
    if (!projectFileExists({ projectPath, filePath: file })) {
      console.error(`💥 Expected file '${file}' not found`)
      process.exit(1)
    }
  }

  console.log('Action: Altering the job to perform some test logic')
  const jobPath = path.join(projectPath, 'api/src/jobs/SampleJob/SampleJob.ts')
  let jobContents = fs.readFileSync(jobPath, 'utf8')
  jobContents = jobContents.replace(`async ()`, SAMPLE_JOB_PERFORM_ARGS)
  jobContents = jobContents.replace(
    `jobs.logger.info('SampleJob is performing...')`,
    SAMPLE_JOB_PERFORM_BODY,
  )
  fs.writeFileSync(jobPath, jobContents)

  console.log('Action: Adding a function to trigger scheduling a job')
  const functionPath = path.join(projectPath, 'api/src/functions/run.ts')
  fs.writeFileSync(functionPath, SAMPLE_FUNCTION)

  console.log('Action: Running `yarn rw serve api`')
  await $`yarn rw build api`
  const apiServer = $`yarn rw serve api`.nothrow()

  // Wait for the api server to start
  await new Promise((resolve) => {
    apiServer.stdout.on('data', (data) => {
      if (data.includes('API server listening at')) {
        resolve(null)
      }
    })
  })

  console.log('Action: Triggering the function')
  await fetch(`http://localhost:8911/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      location: testFileLocation,
      data: testFileData,
    }),
  })

  console.log('Action: Stopping the api server')
  await apiServer.kill('SIGKILL')
}

async function generateCronJob(projectPath: string) {
  console.log('\n❓ Testing: Manually create cron job')

  console.log('Action: Writing a sample cron job')
  fs.mkdirSync(path.join(projectPath, 'api/src/jobs/SampleCronJob'), {
    recursive: true,
  })
  fs.writeFileSync(
    path.join(projectPath, 'api/src/jobs/SampleCronJob/SampleCronJob.ts'),
    SAMPLE_CRON_JOB,
  )
}

async function scheduleCronJob(projectPath: string) {
  console.log('\n❓ Testing: Schedule cron job')
  console.log('Action: Adding a script to schedule the cron job')
  const scriptPath = path.join(projectPath, 'scripts/scheduleCronJob.ts')
  fs.writeFileSync(scriptPath, SCHEDULE_CRON_JOB_SCRIPT)

  console.log('Action: Building the api side')
  await $`yarn rw build api`

  console.log('Action: Running script')
  await $`yarn rw exec scheduleCronJob`
}

async function confirmJobDidNotRunSynchronously(
  projectPath: string,
  testFileName: string,
) {
  console.log('\n❓ Testing: Confirming the job did not run synchronously')
  if (
    projectFileExists({
      projectPath,
      filePath: testFileName,
    })
  ) {
    console.error('💥 Expected file to not exist yet')
    process.exit(1)
  }
  console.log('Confirmed: job did not run synchronously')
}

async function confirmJobsWereScheduled(
  testFileLocation: string,
  testFileData: string,
) {
  console.log(
    '\n❓ Testing: Confirming the jobs were scheduled into the database',
  )

  const rawJobs = (await $`yarn rw exec jobs --silent`).toString()
  let dataJob = undefined
  let cronJob = undefined

  try {
    const jobs: Job[] = JSON.parse(rawJobs)

    if (!jobs?.length) {
      console.error('💥 Expected job not found in the database')
      process.exit(1)
    }

    dataJob = jobs[0]
    cronJob = jobs[1]

    if (
      !dataJob?.runAt ||
      typeof dataJob.cron === 'undefined' ||
      typeof (dataJob as any).shouldBeUndefined !== 'undefined'
    ) {
      console.error('💥 Data job does not have the expected properties')
      process.exit(1)
    }

    if (
      !cronJob?.runAt ||
      !cronJob?.cron ||
      typeof (cronJob as any).shouldBeUndefined !== 'undefined'
    ) {
      console.error('💥 Cron job does not have the expected properties')
      process.exit(1)
    }

    console.log('Confirmed: jobs have expected properties')

    const handler = JSON.parse(dataJob?.handler ?? '{}')
    const args = handler.args ?? []

    if (args[0] !== testFileLocation || args[1] !== testFileData) {
      console.error('💥 Expected data job arguments do not match')
      process.exit(1)
    }

    console.log('Confirmed: data job was scheduled into the database')
  } catch (error) {
    console.error(
      '💥 Error: Failed to confirm data job was scheduled into the database',
    )
    console.error(rawJobs)
    console.error(error)
    process.exit(1)
  }

  return dataJob
}

async function jobsWorkoff() {
  console.log('\n❓ Testing: `yarn rw jobs workoff`')

  try {
    const { stdout } = await $`yarn rw jobs workoff`

    if (!stdout.includes('Starting 1 worker')) {
      console.error('💥 Error: Failed to start worker')
      console.error(stdout)
      process.exit(1)
    }

    console.log('Confirmed: worker started')

    if (!stdout.includes('Started job')) {
      console.error('💥 Error: Failed to start job')
      console.error(stdout)
      process.exit(1)
    }

    console.log('Confirmed: job started')

    if (!stdout.includes('Worker finished, shutting down')) {
      console.error('💥 Error: Worker did not finish')
      console.error(stdout)
      process.exit(1)
    }

    console.log('Confirmed: worker finished')
  } catch (error) {
    if (error instanceof ProcessOutput) {
      console.error('💥 Failed to run: `yarn rw jobs workoff`')
      console.error(error.toString())
      process.exit(1)
    } else {
      throw error
    }
  }
}

async function confirmJobsRan(
  projectPath: string,
  testFileName: string,
  testFileLocation: string,
  testFileData: string,
) {
  console.log('\n❓ Testing: Confirming the jobs ran')

  if (
    !projectFileExists({
      projectPath,
      filePath: testFileName,
    })
  ) {
    console.error('💥 Expected data file not found')
    process.exit(1)
  }

  const fileContents = fs.readFileSync(testFileLocation, 'utf8')
  if (fileContents !== testFileData) {
    console.error('💥 Expected data file contents do not match')
    process.exit(1)
  }
  console.log('Confirmed: data job ran')

  const reportFiles = fs
    .readdirSync(projectPath)
    .filter((file) => /^report-.*\.txt$/.test(file))

  const nbrOfReports = reportFiles.length

  if (nbrOfReports !== 1) {
    console.error('💥 Expected 1 cron job report, but found', nbrOfReports)
    process.exit(1)
  }
  console.log('Confirmed: cron job ran')
}

async function confirmJobWasRemoved(job: Job) {
  console.log('\n❓ Testing: Confirming the job was removed from the database')

  const rawJobsAfter = (await $`yarn rw exec jobs --silent`).toString()
  const jobsAfter: Job[] = JSON.parse(rawJobsAfter)
  const jobAfter = jobsAfter.find((j) => j.id === job.id)

  if (jobAfter) {
    console.error('💥 Job found in the database. It should have been removed')
    process.exit(1)
  }

  console.log('Confirmed: job was removed from the database')
}

async function runCronJob(projectPath: string) {
  console.log('\n❓ Testing: Cron Job')

  const rawJobsAfter = (await $`yarn rw exec jobs --silent`).toString()
  const jobsAfter: Job[] = JSON.parse(rawJobsAfter)
  const cronJob = jobsAfter.find((j) => {
    const handler = JSON.parse(j.handler)
    return handler.name === 'SampleCronJob'
  })

  if (!cronJob) {
    console.error('💥 Cron job not found in the database')
    process.exit(1)
  }

  console.log('Confirmed: cron job exists in the database')

  const runAt = new Date(cronJob.runAt ?? 0).toISOString().slice(11, 19)
  const nowMs = Date.now()
  const now = new Date(nowMs).toISOString().slice(11, 19)
  const delta = new Date(cronJob.runAt ?? 0).getTime() - nowMs
  console.log(`Confirmed: cron job scheduled to run at ${runAt}`)
  console.log(`           It is now ${now} (delta: ${delta}ms)`)

  try {
    const { stdout, stderr } = await $`yarn rw jobs work`
      .nothrow()
      .quiet()
      // 3600 was enough of a timeout locally, but I had to increase it for CI
      .timeout(9600)

    if (!stdout.includes('SampleCronJob: Writing report to')) {
      console.error("💥 Error: Couldn't find expected output")
      console.error(stdout)
      console.error(stderr)
      process.exit(1)
    }

    console.log('Confirmed: expected output found')
  } catch (error) {
    console.error('💥 Failed to run: `yarn rw jobs work`')
    if (!!error && typeof error === 'object') {
      console.error(error.toString())
    }
    process.exit(1)
  }

  const reportFiles = fs
    .readdirSync(projectPath)
    .filter((file) => /^report-.*\.txt$/.test(file))

  if (reportFiles.length < 3) {
    console.error('💥 Too few report files found')
    process.exit(1)
  }

  console.log(`Confirmed: ${reportFiles.length} reports found`)
}

main()
