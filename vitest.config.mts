import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname) } },
  test: {
    include: ['features/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['node_modules/**', '.keystone/**', 'tests/**/*.test.cjs'],
    environment: 'node',
    // Database suites over a laptop-to-Railway link need more than 30 s per test (P5 r2 backlog c).
    testTimeout: process.env.VC_TEST_DATABASE_URL ? 180_000 : 30_000,
    hookTimeout: process.env.VC_TEST_DATABASE_URL ? 1_800_000 : 60_000,
    // Database suites share one scratch database; run files one at a time.
    fileParallelism: false,
  },
})
