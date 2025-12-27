import portfinder from 'portfinder'

/**
 * Finds a free port
 * @param  requestedPort Port to start searching from
 * @param  excludePorts  Array of port numbers to exclude
 * @return A free port equal or higher than requestedPort but not within excludePorts. If no port can be found then returns -1
 */
export async function getFreePort(
  requestedPort: number,
  excludePorts: number[] = [],
): Promise<number> {
  try {
    let freePort = await portfinder.getPortPromise({
      port: requestedPort,
    })
    if (excludePorts.includes(freePort)) {
      freePort = await getFreePort(freePort + 1, excludePorts)
    }
    return freePort
  } catch {
    return -1
  }
}
