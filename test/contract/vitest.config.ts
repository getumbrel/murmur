import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The Hermes contract suite (npm run test:contract): Murmur's expectations of
// Hermes, checked against a real one. Not part of `npm test`, which needs no Docker.
export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../../src', import.meta.url)),
      '@shared': fileURLToPath(new URL('../../shared', import.meta.url)),
    },
  },
  test: {
    include: ['test/contract/**/*.contract.ts'],
    globalSetup: ['test/contract/setup.ts'],
    setupFiles: ['test/contract/browser.ts'],
    // One Hermes for the whole run, and some files change what all its agents share (the model, config).
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Pulling the image can take a while on a cold CI runner.
    teardownTimeout: 60_000,
  },
})
