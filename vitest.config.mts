import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname) } },
  test: {
    include: ['features/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['node_modules/**', '.keystone/**', 'tests/**/*.test.cjs'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Database suites share one scratch database; run files one at a time.
    fileParallelism: false,
  },
})
