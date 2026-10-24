/**
 * 剥离 tsc 产物（dist 下所有 .js）中的 console.*：
 * UMD 由 vite terser drop_console 处理，npm ESM/CJS 入口走这里，两条链路对齐
 * terser 只做 compress 不压缩命名，含 console 的文件才会被重写，其余保持 tsc 原样
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { minify } from 'terser'

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  }))
  return files.flat()
}

let cleaned = 0
for (const file of (await walk('dist')).filter(f => f.endsWith('.js'))) {
  const code = await readFile(file, 'utf8')
  if (!/\bconsole\s*\./.test(code))
    continue
  const { code: stripped } = await minify(code, {
    compress: { drop_console: true, drop_debugger: true },
    format: { beautify: true, indent_level: 2 },
  })
  if (stripped) {
    await writeFile(file, stripped)
    cleaned++
  }
}
console.log(`strip-console: ${cleaned} files cleaned`)
