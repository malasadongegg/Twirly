import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const repo = resolve(__dirname, '../../..')

// Standalone page that renders Twirly's real components frame by frame for the trailer.
export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@shared': resolve(repo, 'packages/shared'),
      '@core': resolve(repo, 'packages/core'),
      '@renderer': resolve(repo, 'apps/desktop/src/renderer'),
    },
  },
  build: { outDir: resolve(__dirname, 'dist'), emptyOutDir: true, assetsInlineLimit: 0 },
})
