import { defineConfig, devices } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1536, height: 1024 } } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:4173/api/health',
    reuseExistingServer: false,
    env: {
      DATABASE_PATH: join(tmpdir(), `billco-e2e-${process.pid}.sqlite`),
      API_PORT: '3002',
      UI_PORT: '4173',
    },
  },
})
