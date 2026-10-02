import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

const WEB_PORT = 5175
const API_PORT = 8788

const DATABASE_PATH = join(tmpdir(), `bookflow-e2e-${Date.now()}.sqlite`)
const API_ENV = { DATABASE_PATH, UPLOAD_DIR: join(tmpdir(), `bookflow-e2e-uploads-${Date.now()}`), BOOKFLOW_DEMO: '1', BOOKFLOW_TEST: '1' }
/** E2E_DEV=1: run against the Vite dev server (hot reload, slower) instead of a production bundle. */
const dev = process.env.E2E_DEV === '1'
const STATIC_DIR = join(tmpdir(), 'bookflow-e2e-dist')

/**
 * End-to-end tests against the real stack: the API server (test mode, throwaway SQLite file)
 * serving a freshly built production bundle of the web app — what users actually get.
 * Each test resets the database first (see e2e/fixtures.ts), so tests are independent.
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
  webServer: dev
    ? [
        {
          command: 'npx tsx server/index.ts',
          url: `http://localhost:${API_PORT}/api/config`,
          reuseExistingServer: false,
          timeout: 120_000,
          env: { ...API_ENV, PORT: String(API_PORT), STATIC_DIR: join(tmpdir(), 'bookflow-e2e-none') },
        },
        {
          command: `npx vite --port ${WEB_PORT} --strictPort`,
          url: `http://localhost:${WEB_PORT}`,
          reuseExistingServer: false,
          timeout: 120_000,
          env: { API_PORT: String(API_PORT) },
        },
      ]
    : [
        {
          command: `npx vite build --logLevel warn --emptyOutDir --outDir ${STATIC_DIR} && npx tsx server/index.ts`,
          url: `http://localhost:${WEB_PORT}/api/config`,
          reuseExistingServer: false,
          timeout: 300_000,
          env: { ...API_ENV, PORT: String(WEB_PORT), STATIC_DIR, PUBLIC_BASE_URL: `http://localhost:${WEB_PORT}` },
        },
      ],
})
