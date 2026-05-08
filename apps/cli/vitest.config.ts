import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@rekurn/core': resolve(__dirname, '../../packages/core/src/index.ts'),
      '@rekurn/crypto': resolve(__dirname, '../../packages/crypto/src/index.ts'),
      '@rekurn/types': resolve(__dirname, '../../packages/types/src/index.ts'),
      '@rekurn/diff': resolve(__dirname, '../../packages/diff/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
  },
})
