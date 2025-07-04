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

          // 记录请求信息
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

          // 记录请求信息
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

        // xhr.addEventListener('loadend', function () {
        //   const duration = new Date().getTime() - startTime
        //   const status = xhr.status
        //   const success = status >= 200 && status < 300

        //   // 对于HTTP错误状态码，也捕获为错误
        //   if (!success) {
        //     _this.captureRequest({
        //       type: 'xhr',
        //       url: reqUrl,
        //       method: reqMethod || 'GET',
        //       msg: `XHR请求失败: 状态码 ${status}`,
        //       duration,
        //       status,
        //       success,
        //       startTime: new Date().getTime()
        //     })
        //   }
        // })

        return originalSend.apply(this, arguments)
      }

      return xhr
    } as any
}