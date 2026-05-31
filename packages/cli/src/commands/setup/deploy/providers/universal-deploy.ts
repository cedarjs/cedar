export const command = 'universal-deploy'

export const description = 'Setup Universal Deploy'

export async function handler() {
  const { handler } = await import('./universalDeployHandler.js')

  return handler()
}
