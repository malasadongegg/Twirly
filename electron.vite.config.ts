import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const alias = {
  '@shared': resolve(__dirname, 'packages/shared'),
  '@core': resolve(__dirname, 'packages/core'),
  '@processing': resolve(__dirname, 'packages/processing'),
}

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: resolve(__dirname, 'apps/desktop/src/main/index.ts'),
        external: ['sharp', 'onnxruntime-node'],
      },
    },
  },
  preload: {
    resolve: { alias },
    build: {
      outDir: 'out/preload',
      rollupOptions: { input: resolve(__dirname, 'apps/desktop/src/preload/index.ts') },
    },
  },
  renderer: {
    root: resolve(__dirname, 'apps/desktop/src/renderer'),
    resolve: { alias: { ...alias, '@renderer': resolve(__dirname, 'apps/desktop/src/renderer') } },
    plugins: [react(), tailwindcss()],
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'apps/desktop/src/renderer/index.html'),
          wheel: resolve(__dirname, 'apps/desktop/src/renderer/wheel.html'),
          editor: resolve(__dirname, 'apps/desktop/src/renderer/editor.html'),
          'pdf-worker': resolve(__dirname, 'apps/desktop/src/renderer/pdf-worker.html'),
        },
      },
    },
  },
})
