import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: 'es2015',
    outDir: 'dist',
    minify: 'terser',
    sourcemap: false,
    terserOptions: {
      compress: {
        //生产环境时移除console
        drop_console: true,
        drop_debugger: true,
      },
    },
    lib: {
      entry: './src/index.ts', // 入口文件
      name: 'monitor', // 打包后的库名
      fileName: (format) => `monitor.${format}.js`, // 输出文件名格式
      formats: ['es', 'umd'] // 支持的格式
    },
  }
})