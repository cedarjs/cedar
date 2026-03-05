# Utils

Shared utilities for CedarJS packages.

This package is intentionally kept minimal — it has no heavy transitive dependencies — so it can be safely imported by any CedarJS package, including the CLI, without bloating the install footprint.

## Utilities

### `cedarPluralize`

A thin wrapper around the [`pluralize`](https://github.com/plurals/pluralize) library that adds support for PascalCased multi-word identifiers (e.g. `DataModel` → `DataModels`) and a custom singular/plural mapping registry.

#### Functions

| Function                              | Description                                    |
| :------------------------------------ | :--------------------------------------------- |
| `pluralize(word)`                     | Returns the plural form of the given word.     |
| `singularize(word)`                   | Returns the singular form of the given word.   |
| `isPlural(word)`                      | Returns `true` if the (last) word is plural.   |
| `isSingular(word)`                    | Returns `true` if the (last) word is singular. |
| `addSingularPlural(singular, plural)` | Registers a custom singular ↔ plural mapping.  |

#### Usage

```ts
import {
  pluralize,
  singularize,
  isPlural,
  isSingular,
  addSingularPlural,
} from '@cedarjs/utils/cedarPluralize'

pluralize('book') // 'books'
pluralize('DataModel') // 'DataModels'
singularize('teeth') // 'tooth'
isPlural('books') // true
isSingular('tooth') // true

addSingularPlural('Pokemon', 'Pokemonii')
pluralize('Pokemon') // 'Pokemonii'
```

You can also import directly from the package root, which re-exports everything from `cedarPluralize`:

```ts
import { pluralize, singularize } from '@cedarjs/utils'
```
