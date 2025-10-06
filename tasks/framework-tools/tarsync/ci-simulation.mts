#!/usr/bin/env tsx

import ansis from 'ansis'
import { $, fs, path } from 'zx'

async function debugPackageState(packageName: string, step: string) {
  console.log(ansis.blue(`\n=== DEBUG: ${packageName} - ${step} ===`))
  console.log(`Timestamp: ${new Date().toISOString()}`)
  console.log(`Working directory: ${process.cwd()}`)

  const packagePath = `./packages/${packageName}`

  if (await fs.pathExists(packagePath)) {
    console.log(`Package directory exists: ${packagePath}`)

    // Check critical directories
    const distPath = path.join(packagePath, 'dist')
    const configPath = path.join(packagePath, 'config')

    console.log(`Dist directory exists: ${await fs.pathExists(distPath)}`)
    if (await fs.pathExists(distPath)) {
      try {
        const distContents = await fs.readdir(distPath, { recursive: true })
        console.log(`Dist contents (${distContents.length} items):`)
        distContents.slice(0, 10).forEach(item => console.log(`  ${item}`))
        if (distContents.length > 10) {
          console.log(`  ... and ${distContents.length - 10} more items`)
        }
      } catch (error) {
        console.log(`Error reading dist directory: ${error}`)
      }
    }

    console.log(`Config directory exists: ${await fs.pathExists(configPath)}`)
    if (await fs.pathExists(configPath)) {
      try {
        const configContents = await fs.readdir(configPath, { recursive: true })
        console.log(`Config contents (${configContents.length} items):`)
        configContents.slice(0, 10).forEach(item => console.log(`  ${item}`))
        if (configContents.length > 10) {
          console.log(`  ... and ${configContents.length - 10} more items`)
        }
      } catch (error) {
        console.log(`Error reading config directory: ${error}`)
      }
    }
  } else {
    console.log(`Package directory does not exist: ${packagePath}`)
  }

  console.log(ansis.blue(`=== END DEBUG: ${packageName} - ${step} ===\n`))
}

async function simulateCI() {
  console.log(ansis.bold.green('🔄 Simulating CI environment behavior'))

  // Set CI environment variables
  process.env.CI = 'true'
  process.env.NODE_ENV = 'production'

  console.log(`CI Environment: ${process.env.CI}`)
  console.log(`Node Environment: ${process.env.NODE_ENV}`)
  console.log(`Platform: ${process.platform}`)

  // Clean up any existing builds
  console.log(ansis.yellow('\n🧹 Cleaning up existing builds...'))
  try {
    await $`yarn nx reset`
    await $`find ./packages -name "*.tgz" -delete`
    await $`find ./packages -name "dist" -type d -exec rm -rf {} + || true`
    await $`find ./packages -name "config" -type d -exec rm -rf {} + || true`
  } catch (error) {
    console.log('Cleanup completed (some errors expected)')
  }

  console.log(ansis.yellow('\n📦 Step 1: Running build step explicitly...'))
  await debugPackageState('testing', 'before-build')

  // Simulate the exact commands from the PR description
  await $`yarn nx run-many -t build --exclude create-cedar-app --skipNxCache --skipRemoteCache --verbose`

  await debugPackageState('testing', 'after-build-before-sync')

  // Add explicit file system sync like CI might need
  await $`sync`
  await new Promise(resolve => setTimeout(resolve, 1000))

  await debugPackageState('testing', 'after-build-after-sync')

  console.log(ansis.yellow('\n📦 Step 2: Running build:pack step explicitly...'))

  await debugPackageState('testing', 'before-build-pack')

  await $`yarn nx run-many -t build:pack --exclude create-cedar-app --skipNxCache --skipRemoteCache --verbose`

  await debugPackageState('testing', 'after-build-pack')
}

async function simulateContainerFileSystem() {
  console.log(ansis.bold.green('🐳 Simulating container-like file system behavior'))

  // Set container-like environment
  process.env.CI = 'true'
  process.env.DOCKER = 'true'

  console.log(ansis.yellow('\n📦 Testing with aggressive cleanup between steps...'))

  // Clean slate
  await $`yarn nx reset`

  await debugPackageState('testing', 'container-before-build')

  // Build step
  await $`yarn nx run testing:build --verbose --skipNxCache --skipRemoteCache`

  await debugPackageState('testing', 'container-after-build')

  // Simulate potential container layer issues
  console.log(ansis.cyan('⏳ Simulating container layer sync delay...'))
  await new Promise(resolve => setTimeout(resolve, 3000))

  await debugPackageState('testing', 'container-after-delay')

  // Build:pack step
  await $`yarn nx run testing:build:pack --verbose --skipNxCache --skipRemoteCache`

  await debugPackageState('testing', 'container-after-build-pack')
}

async function testConcurrentBuilds() {
  console.log(ansis.bold.green('⚡ Testing concurrent build behavior'))

  // Clean slate
  await $`yarn nx reset`

  console.log(ansis.yellow('\n📦 Testing parallel vs sequential builds...'))

  // Test 1: Sequential builds (should work)
  console.log('\n1️⃣ Sequential builds:')
  await $`yarn nx run testing:build --verbose --skipNxCache --skipRemoteCache`
  await debugPackageState('testing', 'sequential-after-build')
  await $`yarn nx run testing:build:pack --verbose --skipNxCache --skipRemoteCache`
  await debugPackageState('testing', 'sequential-after-pack')

  // Clean for next test
  await $`find ./packages/testing -name "*.tgz" -delete || true`
  await $`rm -rf ./packages/testing/dist ./packages/testing/config || true`

  // Test 2: Rapid fire commands (might expose race conditions)
  console.log('\n2️⃣ Rapid fire builds:')
  try {
    // Start build
    const buildPromise = $`yarn nx run testing:build --verbose --skipNxCache --skipRemoteCache`

    // Wait a short moment then start pack (this might cause issues)
    setTimeout(async () => {
      console.log('🏃 Starting build:pack while build might still be running...')
      try {
        await $`yarn nx run testing:build:pack --verbose --skipNxCache --skipRemoteCache`
      } catch (error) {
        console.log(ansis.red('❌ Build:pack failed (expected):'), error.message)
      }
    }, 2000)

    await buildPromise
    await debugPackageState('testing', 'rapid-after-build')
  } catch (error) {
    console.log(ansis.red('Rapid fire test revealed timing issues:'), error.message)
  }
}

async function main() {
  console.log(ansis.bold.green('🔍 Cedar CI Simulation Test Suite'))

  const testType = process.argv[2] || 'all'

  try {
    switch (testType) {
      case 'ci':
        await simulateCI()
        break
      case 'container':
        await simulateContainerFileSystem()
        break
      case 'concurrent':
        await testConcurrentBuilds()
        break
      default:
        console.log(ansis.yellow('\n🧪 Running all CI simulation tests...'))

        console.log('\n' + '='.repeat(50))
        await simulateCI()

        console.log('\n' + '='.repeat(50))
        await simulateContainerFileSystem()

        console.log('\n' + '='.repeat(50))
        await testConcurrentBuilds()
    }

    console.log(ansis.bold.green('\n🎉 CI simulation completed'))

  } catch (error) {
    console.error(ansis.bold.red('\n💥 CI simulation failed:'), error)
    process.exit(1)
  }
}

main()
