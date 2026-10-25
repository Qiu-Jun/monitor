import { detectBusinessError } from '../utils/businessError'

/** 读取 XHR 响应体：responseType 非 text/json 时访问 responseText 会抛 InvalidStateError，读不到返回 undefined */
function readXhrBody(xhr: XMLHttpRequest): unknown {
  try {
    if (xhr.responseType === '' || xhr.responseType === 'text')
      return xhr.responseText
    return xhr.responseType === 'json' ? xhr.response : undefined
  }
  catch {
    return undefined
  }
}

export default function onXHR() {
   const originalXHR = window.XMLHttpRequest as any
   // @ts-ignore
   const _this = this
   
   window.XMLHttpRequest = function () {
      const xhr = new originalXHR()
      const originalOpen = xhr.open
      const originalSend = xhr.send

      // 记录请求开始时间
      let startTime: number
      let reqUrl: string | URL
      let reqMethod: string

      xhr.open = function (method: string, url: URL | string, ...args: any) {
        reqUrl = url
        reqMethod = method
        return originalOpen.apply(this, [method, url, ...args])
      }

      xhr.send = function () {
        startTime = new Date().getTime()

        // 添加错误事件监听
        xhr.addEventListener('error', function () {
          const duration = new Date().getTime() - startTime
          const status = xhr.status
          const urlStr = String(reqUrl ?? '')

          if (_this.endpoint && urlStr === _this.endpoint)
            return

          _this.captureRequest({
            type: 'xhr',
            url: reqUrl,
            method: reqMethod || 'GET',
            duration,
            status: status || 0,
            success: false,
            msg: `XHR请求错误: ${reqUrl}`,
            startTime: new Date().getTime()
          })
        })

        // 添加超时事件监听
        xhr.addEventListener('timeout', function () {
          const duration = new Date().getTime() - startTime
          const status = xhr.status
          const urlStr = String(reqUrl ?? '')

          if (_this.endpoint && urlStr === _this.endpoint)
            return

          _this.captureRequest({
            type: 'xhr',
            url: reqUrl,
            method: reqMethod || 'GET',
            msg: `XHR请求超时`,
            duration,
            status: status || 0,
            success: false,
            startTime: new Date().getTime()
          })
        })

        // 请求完成：HTTP >= 400 与业务错误（HTTP 2xx 但响应体 code 非成功）。
        // error/timeout 后 loadend 也会触发，但那时 status 为 0，走不进下面任一分支，不会重复上报
        xhr.addEventListener('loadend', function () {
          const duration = new Date().getTime() - startTime
          const status = xhr.status
          const urlStr = String(reqUrl ?? '')

          if (_this.endpoint && urlStr === _this.endpoint)
            return

          // HTTP 层失败（4xx/5xx）
          if (status >= 400) {
            _this.captureRequest({
              type: 'xhr',
              url: reqUrl,
              method: reqMethod || 'GET',
              msg: `XHR请求失败: 状态码 ${status}`,
              duration,
              status,
              success: false,
              startTime
            })
            return
          }

          // 业务错误：需配置 isBusinessError 才会读响应体判定
          if (status >= 200 && status < 300 && _this.isBusinessError) {
            const business = detectBusinessError(readXhrBody(xhr), _this.isBusinessError)
            if (business) {
              _this.captureRequest({
                type: 'xhr',
                url: reqUrl,
                method: reqMethod || 'GET',
                msg: `XHR业务错误: ${business.message ?? urlStr}`,
                duration,
                status,
                success: false,
                business,
                startTime
              })
            }
          }
        })

        return originalSend.apply(this, arguments)
      }

      return xhr
    } as any
}
