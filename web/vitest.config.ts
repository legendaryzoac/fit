import { defineConfig } from 'vitest/config'

// Unit tests for the pure libraries only (no DOM): the engine checks that
// stand between a language model and the athlete's program.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
