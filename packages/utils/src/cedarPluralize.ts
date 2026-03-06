import plurals from 'pluralize'

type Mappings = {
  toSingular: Record<string, string>
  toPlural: Record<string, string>
}

const mappings: Mappings = {
  toSingular: {},
  toPlural: {},
}

/**
 * Find last PascalCase word in a multi-word identifier.
 *
 * Example: "FooBarBaz" -> "Baz"
 */
function lastWord(str: string) {
  const capitals = str.match(/[A-Z]/g) ?? []
  if (capitals.length === 0) {
    return str
  }

  const lastCapital = capitals[capitals.length - 1]
  const lastIndex = str.lastIndexOf(lastCapital)

  if (lastIndex >= 0) {
    return str.slice(lastIndex)
  }

  return str
}

/**
 * Returns the plural form of the given word.
 */
export function pluralize(word: string): string {
  if (mappings.toPlural[word]) {
    return mappings.toPlural[word]
  }

  // Handle PascalCased multi-word identifiers by only pluralizing the last word.
  const singular = lastWord(word)
  const base = word.slice(0, word.length - singular.length)

  if (mappings.toPlural[singular]) {
    return base + mappings.toPlural[singular]
  }

  return base + plurals.plural(singular)
}

/**
 * Returns the singular form of the given word.
 */
export function singularize(word: string): string {
  if (mappings.toSingular[word]) {
    return mappings.toSingular[word]
  }

  const plural = lastWord(word)
  const base = word.slice(0, word.length - plural.length)

  if (mappings.toSingular[plural]) {
    return base + mappings.toSingular[plural]
  }

  return base + plurals.singular(plural)
}

/**
 * Returns true if the (last) word is plural.
 */
export function isPlural(word: string): boolean {
  return plurals.isPlural(lastWord(word))
}

/**
 * Returns true if the (last) word is singular.
 */
export function isSingular(word: string): boolean {
  return plurals.isSingular(lastWord(word))
}

/**
 * Adds a new mapping from singular to plural.
 *
 * This function also maintains reverse mappings and ensures any previous
 * conflicting mapping is removed (tests rely on this behavior).
 */
export function addSingularPlural(singular: string, plural: string): void {
  const existingPlural = Object.keys(mappings.toSingular).find((key) => {
    return mappings.toSingular[key] === singular
  })

  if (existingPlural !== undefined) {
    delete mappings.toSingular[existingPlural]
    delete mappings.toPlural[existingPlural]
  }

  mappings.toPlural[singular] = plural
  mappings.toPlural[plural] = plural
  mappings.toSingular[plural] = singular
  mappings.toSingular[singular] = singular
}
