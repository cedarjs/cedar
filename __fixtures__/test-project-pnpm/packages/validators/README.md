# Shared Package '@my-org/validators'

Use code in this package by adding it to the dependencies on the side you want
to use it, with the special `workspace:*` version. After that you can import it
into your code:

```json
  "dependencies": {
    "@my-org/validators": "workspace:*"
  }
```

```javascript
import { validators } from '@my-org/validators'
```
