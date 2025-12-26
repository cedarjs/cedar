import { fetch } from '@whatwg-node/fetch'

/**
 * @param tag should be something like 'v0.42.1'
 * @param file should be something like 'prettier.config.cjs', 'api/src/index.ts', 'web/src/index.ts'
 */
export default async function fetchFileFromTemplate(tag: string, file: string) {
  const URL = `https://raw.githubusercontent.com/redwoodjs/redwood/${tag}/packages/create-cedar-app/template/${file}`
  const res = await fetch(URL)
  return res.text()
}
