export const SAMPLE_JOB_PERFORM_ARGS = `async (location: string, data: string)`

export const SAMPLE_JOB_PERFORM_BODY = `
  const { default: fs } = await import('node:fs')
  fs.writeFileSync(location, data)
`

export const SAMPLE_FUNCTION = `
import type { APIGatewayEvent, Context } from 'aws-lambda'

import { SampleJob } from 'src/jobs/SampleJob/SampleJob'
import { later } from 'src/lib/jobs'

export const handler = async (event: APIGatewayEvent, _context: Context) => {
  const { location, data } = JSON.parse(event.body)

  await later(SampleJob, [location as string, data as string])

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      location,
      data,
    }),
  }
}
`

export const JOBS_SCRIPT = `
import { db } from 'api/src/lib/db'

export default async () => {
  const jobs = await db.backgroundJob.findMany()
  console.log(JSON.stringify(jobs))
}
`

export const PRISMA_SCRIPT = `
import { db } from 'api/src/lib/db'

export default async () => {
  const model = db.backgroundJob
  console.log(
    JSON.stringify({
      name: model.name,
    })
  )
}

`

export const SAMPLE_CRON_JOB = `
import fs from 'node:fs/promises'
import path from 'node:path'

import { jobs } from 'src/lib/jobs'

export const SampleCronJob = jobs.createJob({
  queue: 'default',
  cron: '* * * * * *',
  perform: async () => {
    const timestamp = new Date().toISOString().replace(/:/g, '_')
    const fileName = \`report-\${timestamp}.txt\`
    const fullPath = path.join(__dirname, '..', '..', '..', '..', fileName)
    jobs.logger.info('SampleCronJob: Writing report to ' + fullPath)
    await fs.writeFile(fullPath, 'Sample report')
  },
})

`

export const SCHEDULE_CRON_JOB_SCRIPT = `
import { SampleCronJob } from 'api/src/jobs/SampleCronJob/SampleCronJob'
import { later } from 'api/src/lib/jobs'

export default async () => {
  await later(SampleCronJob)
}

`
