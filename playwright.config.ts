import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

const WEB_PORT = 5175
const API_PORT = 8788

/**
 * End-to-end tests against the real stack: API server (test mode, throwaway SQLite file)
 * + Vite. Each test resets the database first (see e2e/fixtures.ts), so tests are independent.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    launchOptions: { args: ['--no-sandbox'] },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    {
      command: 'npx tsx server/index.ts',
      url: `http://localhost:${API_PORT}/api/config`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { PORT: String(API_PORT), DATABASE_PATH: join(tmpdir(), `bookflow-e2e-${Date.now()}.sqlite`), BOOKFLOW_DEMO: '1', BOOKFLOW_TEST: '1' },
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { API_PORT: String(API_PORT) },
    },
  ],
})
