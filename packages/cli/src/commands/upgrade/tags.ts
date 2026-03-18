export function isValidCedarJSTag(tag: string) {
  return ['rc', 'canary', 'latest', 'next', 'experimental'].includes(tag)
}
