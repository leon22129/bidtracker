import { jest as jestGlobals } from '@jest/globals';

// Jest's ESM runtime exposes `test`/`expect` globally, but not the `jest` helper.
// Keep existing specs portable while the application consumes Nest's ESM packages.
Object.defineProperty(globalThis, 'jest', {
  configurable: true,
  value: jestGlobals,
});
