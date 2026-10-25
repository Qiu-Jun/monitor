/** 业务错误详情（isBusinessError 判定命中时提取） */
export interface BusinessErrorInfo {
  code?: number | string
  message?: string
}

/**
 * 解析响应体并按 isBusinessError 判定业务错误
 * body 支持已解析对象或 JSON 字符串；非 JSON 文本 / 解析失败 / 未配置判定函数返回 null（不拦截）
 */
export function detectBusinessError(
  body: unknown,
  isBusinessError?: (body: unknown) => boolean,
): BusinessErrorInfo | null {
  if (typeof isBusinessError !== 'function')
    return null

  let parsed = body
  if (typeof parsed === 'string') {
    const text = parsed.trim()
    // 非 { 或 [ 开头直接跳过，避免对 HTML/文本整体 JSON.parse
    if (!text.startsWith('{') && !text.startsWith('['))
      return null
    try {
      parsed = JSON.parse(text)
    }
    catch {
      return null
    }
  }

  if (!isBusinessError(parsed))
    return null

  const record = parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  return {
    code: typeof record.code === 'number' || typeof record.code === 'string' ? record.code : undefined,
    message: typeof record.message === 'string' ? record.message : undefined,
  }
}
