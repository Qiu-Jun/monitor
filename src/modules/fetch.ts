import { detectBusinessError } from '../utils/businessError'

/** 主动取消/超时产生的异常名，不算请求失败 */
const SKIPPED_ERROR_NAMES = ['AbortError', 'TimeoutError']

export default function onFetch() {
   const originalFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : undefined
   // @ts-ignore
   const _this = this

   if (!originalFetch)
      return

   /** 监控自身的异常不能影响业务请求 */
   // @ts-ignore
   const safeCapture = (info: any) => {
     try {
       _this.captureRequest(info)
     }
     catch { /* 静默 */ }
   }

   window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const reqUrl = typeof input === 'string' ? input : (input instanceof URL ? input.href : input.url)
      const reqMethod = String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()

      // 上报/回放自身 URL 不拦截：防递归，且 clone 读 body 会干扰 keepalive 上报
      if ((_this.endpoint && reqUrl === _this.endpoint) || (_this.replayEndpoint && reqUrl === _this.replayEndpoint))
         return originalFetch(input, init)

      const startTime = new Date().getTime()

      return originalFetch(input, init).then(
         (res: Response) => {
            const duration = new Date().getTime() - startTime

            if (res.status >= 400) {
               safeCapture({
                  type: 'fetch',
                  url: reqUrl,
                  method: reqMethod,
                  msg: `fetch请求失败: 状态码 ${res.status}`,
                  duration,
                  status: res.status,
                  success: false,
                  startTime,
               })
            }
            else if (res.status >= 200 && res.status < 300 && _this.isBusinessError) {
               // 仅对 JSON/文本类响应 clone 读文本判定业务错误，避免缓冲大体积二进制；clone 不消费业务侧响应体
               const contentType = res.headers.get('content-type') ?? ''
               if (contentType.includes('json') || contentType.startsWith('text/')) {
                  res.clone().text().then((text) => {
                     const business = detectBusinessError(text, _this.isBusinessError)
                     if (!business)
                        return
                     safeCapture({
                        type: 'fetch',
                        url: reqUrl,
                        method: reqMethod,
                        msg: `fetch业务错误: ${business.message ?? reqUrl}`,
                        duration: new Date().getTime() - startTime,
                        status: res.status,
                        success: false,
                        business,
                        startTime,
                     })
                  }).catch(() => { /* 静默 */ })
               }
            }

            return res
         },
         (err: unknown) => {
            if (SKIPPED_ERROR_NAMES.includes((err as { name?: string })?.name ?? ''))
               throw err

            safeCapture({
               type: 'fetch',
               url: reqUrl,
               method: reqMethod,
               msg: `fetch请求错误: ${reqUrl}`,
               duration: new Date().getTime() - startTime,
               status: 0,
               success: false,
               startTime,
            })
            throw err
         },
      )
   }
}
