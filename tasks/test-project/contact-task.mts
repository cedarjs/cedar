import fs from 'node:fs'
import path from 'node:path'

import { fullPath, getOutputPath } from './paths.mts'
import {
  addModel,
  applyCodemod,
  createBuilder,
  exec,
  getExecaOptions,
} from './util.mts'

export async function contactTask({
  packageManager = 'yarn',
}: {
  packageManager?: string
} = {}) {
  const cedarBin = packageManager === 'npm' ? 'npx' : packageManager

  const { contact } = await import('./codemods/models.mts')

  await addModel(contact)

  await exec(
    `${cedarBin} cedar prisma migrate dev --name create_contact`,
    [],
    getExecaOptions(path.join(getOutputPath())),
  )

  const generateScaffold = createBuilder(`${cedarBin} cedar g scaffold`)
  await generateScaffold('contacts')

  const contactsServicePath = fullPath('api/src/services/contacts/contacts')

  await Promise.all([updateService(contactsServicePath), updateServiceTest()])

  return applyCodemod('contacts.mts', contactsServicePath)
}

async function updateService(contactsServicePath: string) {
  const originalContactsService = await fs.promises.readFile(
    contactsServicePath,
    'utf-8',
  )
  await fs.promises.writeFile(
    contactsServicePath,
    originalContactsService.replace(
      "import { db } from 'src/lib/db'",
      '// Testing aliased imports with extensions\n' +
        "import { db } from 'src/lib/db.js'",
    ),
  )
}

async function updateServiceTest() {
  const contactsTestPath = fullPath('api/src/services/contacts/contacts.test')
  const contactsTest = await fs.promises.readFile(contactsTestPath, 'utf-8')

  // Doing simple string replacing here allows me better control over blank
  // lines compared to proper codemods with jscodeshift. Plus it's faster
  await fs.promises.writeFile(
    contactsTestPath,
    "import { vi } from 'vitest'\n\n" +
      contactsTest
        .replace(
          "describe('contacts', () => {",
          "describe('contacts', () => {\n" +
            '  afterEach(() => {\n' +
            `    vi.mocked(console).log.mockRestore?.()\n` +
            '  })\n',
        )
        .replace(
          "  scenario('creates a contact', async () => {",
          "  scenario('creates a contact', async () => {\n" +
            `    vi.spyOn(console, 'log').mockImplementation(() => {})\n`,
        ),
  )
}
