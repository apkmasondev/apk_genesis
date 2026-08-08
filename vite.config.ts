import { defineConfig } from 'vite'

// Relative output keeps the single-page build portable: it works under the
// /apk_genesis/ project path and continues to work unchanged on a custom domain.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    cssMinify: 'lightningcss',
    assetsInlineLimit: 2048,
  },
})
