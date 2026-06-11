import '@testing-library/jest-dom'
import { expect } from 'vitest'

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
})

// Extend matchers
expect.extend({
  toBeCloseTo(received: number, expected: number, precision = 2) {
    const pass = Math.abs(received - expected) < Math.pow(10, -precision) / 2
    return {
      pass,
      message: () =>
        pass
          ? `expected ${received} not to be close to ${expected}`
          : `expected ${received} to be close to ${expected}`,
    }
  },
})
