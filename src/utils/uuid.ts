/** 生成关联用随机 id：优先 crypto.randomUUID，非安全上下文（http）降级为 getRandomValues 拼十六进制 */
export function randomId(): string {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === 'function')
    return cryptoApi.randomUUID()
  // randomUUID 仅安全上下文（HTTPS）可用；getRandomValues 在 http 下依然可用
  if (typeof cryptoApi?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16)
    cryptoApi.getRandomValues(bytes)
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  }
  // 极老环境兜底：仅作关联键用途，非安全场景
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
}
