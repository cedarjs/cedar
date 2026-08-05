import { disposeCedarPgTest } from '../../../api/cedarPgLifecycle.js'

export default async function () {
  await disposeCedarPgTest()
}
