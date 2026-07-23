'use server'

import fs from 'node:fs'

export async function formAction(formData: FormData) {
  const delay = Number(formData.get('delay'))
  console.log(delay)
  console.log('cwd', process.cwd())
  await fs.promises.writeFile(
    'settings.json',
    `${JSON.stringify({ delay })}\n`
  )
}
