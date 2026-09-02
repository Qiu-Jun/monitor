import { defineConfig } from 'vite'
import { resolve } from 'node:path'

/** UMD 单文件（CDN / script 标签）；ESM/CJS 子路径由 tsc 产出 */
export default defineConfig({
  build: {
    target: 'es2015',
    outDir: 'dist',
    emptyOutDir: false,
    minify: 'terser',
    sourcemap: false,
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'Monitor',
      formats: ['umd'],
      fileName: () => 'monitor.umd.js',
    },
    rollupOptions: {
      output: {
        exports: 'named',
        globals: {},
      },
    },
  },
})
