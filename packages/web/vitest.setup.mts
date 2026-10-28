import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'

// Node ships its own global `sessionStorage`/`localStorage` (unflagged as of
// Node 26). Vitest's jsdom environment only swaps a global for jsdom's
// version if the global didn't already exist on `globalThis` before jsdom
// was set up (see `populateGlobal` in vitest's jsdom environment), so on
// Node versions that define these natively, `window.sessionStorage` silently
// stays Node's real in-memory Storage instead of jsdom's — while
// `window.Storage` still correctly points at jsdom's class. That mismatch
// breaks anything that does `vi.spyOn(Storage.prototype, ...)` to mock
// storage, since it patches a different class than the one `sessionStorage`
// actually uses.
//
// Fixed upstream in vitest 5 (its jsdom environment now overrides both
// globals unconditionally), but this repo is still on vitest 4. Force both
// storages back to jsdom's own instances until that upgrade happens.
const jsdomWindow = (globalThis as { jsdom?: { window: Window } }).jsdom?.window
if (jsdomWindow) {
  for (const key of ['sessionStorage', 'localStorage'] as const) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      get: () => jsdomWindow[key],
    })
  }
}

afterEach(() => {
  // If vitest globals are enabled testing-library will clean up after each
  // test automatically, but we don't enable globals, so we have to manually
  // clean up here
  // https://testing-library.com/docs/react-testing-library/api/#cleanup
  cleanup()
})
