import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'packages/shared'),
      '@core': resolve(__dirname, 'packages/core'),
      '@processing': resolve(__dirname, 'packages/processing'),
      '@renderer': resolve(__dirname, 'apps/desktop/src/renderer'),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
    testTimeout: 30000,
  },
})
