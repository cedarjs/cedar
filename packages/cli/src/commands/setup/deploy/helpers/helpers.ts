export function createHandler(componentName: string) {
  return async function handler(argv: Record<string, unknown>) {
    const { handler: importedHandler } = await import(
      `../providers/${componentName}Handler.js`
    )

    return importedHandler(argv)
  }
}
