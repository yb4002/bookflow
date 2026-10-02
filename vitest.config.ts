import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
      // Several suites seed full demo databases; give slow machines (e.g. this phone) room.
      testTimeout: 30_000,
      hookTimeout: 30_000,
      // Deterministic dates regardless of the machine running the tests.
      env: { TZ: 'UTC' },
    },
  }),
)
