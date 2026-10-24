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
      // rrweb / pako 仅回放使用，动态 import 且不打进 UMD；script 标签接入需自行引入两者的 UMD 版本
      external: [/^rrweb($|\/)/, /^pako($|\/)/],
      output: {
        exports: 'named',
        globals: { rrweb: 'rrweb', pako: 'pako' },
      },
    },
  },
})
