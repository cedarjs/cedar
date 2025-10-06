#!/usr/bin/env tsx

import ansis from 'ansis'
import { buildTarballs, buildTarballsSequentially } from './lib-fixed.mts'

async function main() {
  console.log(ansis.bold.green('🔧 Testing Cedar Build Fix'))

  const approach = process.argv[2] || 'default'

  console.log(`Testing approach: ${approach}`)
  console.log(`CI Environment: ${process.env.CI ? 'Yes' : 'No'}`)
  console.log(`Node Version: ${process.version}`)
  console.log(`Platform: ${process.platform}`)

  try {
    switch (approach) {
      case 'sequential':
        console.log(ansis.yellow('\n🔄 Testing sequential build approach'))
        await buildTarballsSequentially()
        break

      case 'default':
      default:
        console.log(ansis.yellow('\n🔄 Testing improved build approach'))
        await buildTarballs()
        break
    }

    console.log(ansis.bold.green('\n🎉 Build test completed successfully'))

  } catch (error) {
    console.error(ansis.bold.red('\n💥 Build test failed:'), error)
    process.exit(1)
  }
}

main()
