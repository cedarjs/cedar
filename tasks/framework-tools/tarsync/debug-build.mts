#!/usr/bin/env tsx

import ansis from 'ansis'
import { $ } from 'zx'
import {
  buildTarballs,
  buildTarballsWithExplicitSync,
  buildTarballsWithCaching
} from './lib-debug.mts'

async function main() {
  console.log(ansis.bold.green('🔍 Starting Cedar Build Debugging Session'))

  const strategy = process.argv[2] || 'debug'

  console.log(`Strategy: ${strategy}`)
  console.log(`CI Environment: ${process.env.CI ? 'Yes' : 'No'}`)
  console.log(`Node Version: ${process.version}`)
  console.log(`Platform: ${process.platform}`)

  try {
    switch (strategy) {
      case 'original':
        console.log(ansis.yellow('\n🧪 Testing original build approach (with debug)'))
        await buildTarballs()
        break

      case 'explicit':
        console.log(ansis.yellow('\n🧪 Testing explicit sync approach'))
        await buildTarballsWithExplicitSync()
        break

      case 'cached':
        console.log(ansis.yellow('\n🧪 Testing cached approach'))
        await buildTarballsWithCaching()
        break

      case 'single':
        console.log(ansis.yellow('\n🧪 Testing single package build'))
        await $`yarn nx run @cedarjs/testing:build --verbose`
        await $`sync`
        await new Promise(resolve => setTimeout(resolve, 2000))
        await $`yarn nx run @cedarjs/testing:build:pack --verbose`
        break

      default:
        console.log(ansis.yellow('\n🧪 Running comprehensive debug test'))

        console.log('\n1️⃣ Testing original approach...')
        try {
          await buildTarballs()
          console.log(ansis.green('✅ Original approach succeeded'))
        } catch (error) {
          console.log(ansis.red('❌ Original approach failed'))
          console.error(error)
        }

        console.log('\n2️⃣ Testing explicit sync approach...')
        try {
          await buildTarballsWithExplicitSync()
          console.log(ansis.green('✅ Explicit sync approach succeeded'))
        } catch (error) {
          console.log(ansis.red('❌ Explicit sync approach failed'))
          console.error(error)
        }

        console.log('\n3️⃣ Testing cached approach...')
        try {
          await buildTarballsWithCaching()
          console.log(ansis.green('✅ Cached approach succeeded'))
        } catch (error) {
          console.log(ansis.red('❌ Cached approach failed'))
          console.error(error)
        }
    }

    console.log(ansis.bold.green('\n🎉 Debug session completed'))

  } catch (error) {
    console.error(ansis.bold.red('\n💥 Debug session failed:'), error)
    process.exit(1)
  }
}

main()
