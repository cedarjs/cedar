import { prepareApiTestDatabase } from '../../../api/prepareApiTestDatabase.js'

export default async function () {
  if (process.env.SKIP_DB_PUSH === '1') {
    return
  }

  await prepareApiTestDatabase()
}
