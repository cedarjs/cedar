// @ts-expect-error - Types not available for JS files
import { isModuleInstalled, installModule } from '../lib/packages.js'

type StudioOptions = {
  open?: boolean
}

export const handler = async (options: StudioOptions): Promise<void> => {
  try {
    // Check the module is installed
    if (!isModuleInstalled('@cedarjs/studio')) {
      console.log(
        'The studio package is not installed, installing it for you, this ' +
          'may take a moment...',
      )
      await installModule('@cedarjs/studio', '2')
      console.log('Studio package installed successfully.')

      const installedRealtime = await installModule('@cedarjs/realtime')
      if (installedRealtime) {
        console.log(
          "Added @cedarjs/realtime to your project, as it's used by Studio",
        )
      }

      const installedApiServer = await installModule('@cedarjs/api-server')
      if (installedApiServer) {
        console.log(
          "Added @cedarjs/api-server to your project, as it's used by Studio",
        )
      }
    }

    // Import studio and start it
    // @ts-expect-error - Types not available for JS files
    const { serve } = await import('@cedarjs/studio')
    await serve({ open: options.open, enableWeb: true })
  } catch (error) {
    console.log('Cannot start the development studio')
    console.log(error)
    process.exit(1)
  }
}
