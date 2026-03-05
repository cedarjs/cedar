# Utils

Shared utilities for CedarJS packages and Cedar apps.

## Utilities

### `cedarPluralize`

A thin wrapper around the [`pluralize`](https://github.com/plurals/pluralize)
library that adds support for PascalCased multi-word identifiers (e.g.
`DataModel` -> `DataModels`) and a custom singular/plural mapping registry.

#### Functions

| Function                              | Description                                    |
| ------------------------------------- | ---------------------------------------------- |
| `pluralize(word)`                     | Returns the plural form of the given word      |
| `singularize(word)`                   | Returns the singular form of the given word    |
| `isPlural(word)`                      | Returns `true` if the (last) word is plural    |
| `isSingular(word)`                    | Returns `true` if the (last) word is singular  |
| `addSingularPlural(singular, plural)` | Registers a custom singular <-> plural mapping |

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
