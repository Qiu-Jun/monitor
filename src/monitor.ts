/* eslint-disable prefer-rest-params */
import { IMonitorOptions } from './types'

export default class Monitor {
  options: IMonitorOptions
  baseURL: string
  appId: string
  userId: string
  timeoutDuration: number
  maxQueueSize: number
  errorQueue: any[]
  requestQueue: any[]
  sendTimer: number | null

  originalXHR: any
  originalFetch: any
  originalOnerror: any
  unhandledRejectionListener: any
  resourceErrorListener: any

  constructor(options: IMonitorOptions) {
    this.options = options || ({} as any)
    this.baseURL = options?.baseURL || ''
    this.appId = options?.appId || ''
    this.userId = options?.userId || ''
    this.timeoutDuration = options?.timeoutDuration || 10000 // 默认超时时间10秒
    this.errorQueue = [] // 错误信息队列
    this.requestQueue = [] // 请求信息队列
    this.maxQueueSize = options?.maxQueueSize || 10 // 最大队列大小，超过自动发送
    this.sendTimer = null // 定时发送定时器

    // 保存原始方法，用于销毁时恢复
    this.originalXHR = window.XMLHttpRequest
    this.originalFetch = window.fetch
    this.originalOnerror = window.onerror

    // 保存事件监听器引用，用于销毁时移除
    this.unhandledRejectionListener = null
    this.resourceErrorListener = null
  }

  /**
   * 初始化监控事件
   */
  init() {
    // 监听全局错误
    window.onerror = (msg, url, lineNo, columnNo, error) => {
      this.captureError({
        type: 'js',
        subType: 'onerror',
        msg,
        url,
        lineNo,
        columnNo,
        stack: error?.stack || '',
        time: new Date().getTime()
      })
      return true // 阻止默认行为
    }

    // 监听Promise错误
    this.unhandledRejectionListener = (event: any) => {
      this.captureError({
        type: 'js',
        subType: 'promise',
        msg: event.reason?.message || 'Promise Error',
        stack: event.reason?.stack || '',
        time: new Date().getTime()
      })
    }
    window.addEventListener(
      'unhandledrejection',
      this.unhandledRejectionListener
    )

    // 监听资源加载错误
    this.resourceErrorListener = (event: any) => {
      // 过滤JS错误，因为JS错误已经被window.onerror捕获
      if (event.target !== window) {
        this.captureError({
          type: 'resource',
          subType: event.target.tagName.toLowerCase(),
          url: event.target.src || event.target.href || '',
          msg: `资源加载失败: ${event.target.tagName}`,
          time: new Date().getTime()
        })
      }
    }
    window.addEventListener('error', this.resourceErrorListener, true) // 使用捕获模式

    // 监听AJAX请求
    this.monitorXHR()

    // 监听Fetch请求
    this.monitorFetch()

    // 设置定时发送
    this.sendTimer = setInterval(
      () => {
        this.sendQueuedData()
      },
      this.options?.sendInterval || 5000
    )
    this.options?.callback && this.options.callback()
  }

  /**
   * 监控XMLHttpRequest请求
   */
  monitorXHR() {
    const originalXHR = window.XMLHttpRequest as any
    // eslint-disable-next-line @typescript-eslint/no-this-alias
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

          // 记录请求信息
          _this.captureRequest({
            type: 'xhr',
            url: reqUrl,
            method: reqMethod || 'GET',
            duration,
            status: 0,
            success: false,
            time: new Date().getTime()
          })

          // 记录错误信息
          _this.captureError({
            type: 'js',
            subType: 'xhr',
            msg: `XHR请求错误: ${reqUrl}`,
            url: reqUrl,
            stack: '',
            time: new Date().getTime()
          })
        })

        // 添加超时事件监听
        xhr.addEventListener('timeout', function () {
          const duration = new Date().getTime() - startTime

          // 记录请求信息
          _this.captureRequest({
            type: 'xhr',
            url: reqUrl,
            method: reqMethod || 'GET',
            duration,
            status: 0,
            success: false,
            time: new Date().getTime()
          })

          // 记录错误信息
          _this.captureError({
            type: 'js',
            subType: 'xhr',
            msg: `XHR请求超时: ${reqUrl}`,
            url: reqUrl,
            stack: '',
            time: new Date().getTime()
          })
        })

        xhr.addEventListener('loadend', function () {
          const duration = new Date().getTime() - startTime
          const status = xhr.status
          const success = status >= 200 && status < 300

          _this.captureRequest({
            type: 'xhr',
            url: reqUrl,
            method: reqMethod || 'GET',
            duration,
            status,
            success,
            time: new Date().getTime()
          })

          // 对于HTTP错误状态码，也捕获为错误
          if (!success) {
            _this.captureError({
              type: 'js',
              subType: 'xhr',
              msg: `XHR请求失败: 状态码 ${status}`,
              url: reqUrl,
              stack: '',
              time: new Date().getTime()
            })
          }
        })

        return originalSend.apply(this, arguments)
      }

      return xhr
    } as any
  }

  /**
   * 监控Fetch请求
   */
  monitorFetch() {
    const originalFetch = window.fetch
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const _this = this

    window.fetch = function (input: any, init: any) {
      const startTime = new Date().getTime()
      const url = typeof input === 'string' ? input : input.url
      const method =
        init?.method || (input instanceof Request ? input.method : 'GET')

      return originalFetch
        .apply(this, arguments as any)
        .then((response) => {
          const duration = new Date().getTime() - startTime
          const status = response.status
          const success = response.ok

          _this.captureRequest({
            type: 'fetch',
            url,
            method,
            duration,
            status,
            success,
            time: new Date().getTime()
          })

          return response
        })
        .catch((error) => {
          const duration = new Date().getTime() - startTime

          _this.captureRequest({
            type: 'fetch',
            url,
            method,
            duration,
            status: 0,
            success: false,
            time: new Date().getTime()
          })

          // 记录错误信息
          _this.captureError({
            type: 'js',
            subType: 'fetch',
            msg: error.message || 'Fetch Error',
            url,
            stack: error.stack || '',
            time: new Date().getTime()
          })

          throw error
        })
    }
  }

  /**
   * 捕获错误
   * @param {Object} errorInfo 错误信息
   */
  captureError(errorInfo: any) {
    // 验证错误类型是否符合规范
    const validErrorTypes = ['js', 'resource', 'custom', 'performance']
    if (!errorInfo.type || !validErrorTypes.includes(errorInfo.type)) {
      console.warn(`监控系统: 无效的错误类型 ${errorInfo.type}，无法上报`)
      return
    }

    // 验证子类型是否符合规范
    const validSubTypes: Record<string, string[]> = {
      js: ['onerror', 'promise', 'xhr', 'fetch'],
      resource: ['img', 'script', 'link', 'audio', 'video'],
      custom: ['business'],
      performance: ['component_render']
    }

    if (
      !errorInfo.subType ||
      !validSubTypes[errorInfo.type]?.includes(errorInfo.subType)
    ) {
      console.warn(
        `监控系统: 错误类型 ${errorInfo.type} 下的无效子类型 ${errorInfo.subType}，无法上报`
      )
      return
    }

    // 验证必填字段
    if (!errorInfo.msg) {
      console.warn('监控系统: 错误信息(msg)为必填项，无法上报')
      return
    }

    if (!errorInfo.time) {
      console.warn('监控系统: 错误时间(time)为必填项，无法上报')
      return
    }

    // 添加基本信息
    errorInfo.appId = this.appId
    errorInfo.userId = this.userId
    errorInfo.userAgent = navigator.userAgent
    errorInfo.page = window.location.href

    // 加入队列
    this.errorQueue.push(errorInfo)

    // 检查队列大小，如果超过阈值则立即发送
    if (this.errorQueue.length >= this.maxQueueSize) {
      this.reportError()
    }
  }

  /**
   * 捕获请求
   * @param {Object} requestInfo 请求信息
   */
  captureRequest(requestInfo: any) {
    // 验证请求类型是否符合规范
    const validRequestTypes = ['xhr', 'fetch', 'vuex_action']
    if (!requestInfo.type || !validRequestTypes.includes(requestInfo.type)) {
      console.warn(`监控系统: 无效的请求类型 ${requestInfo.type}，无法上报`)
      return
    }

    // 验证必填字段
    const requiredFields = [
      'url',
      'method',
      'duration',
      'status',
      'success',
      'time'
    ]
    for (const field of requiredFields) {
      if (requestInfo[field] === undefined) {
        console.warn(`监控系统: 请求信息中缺少必填字段 ${field}，无法上报`)
        return
      }
    }

    // 添加基本信息
    requestInfo.appId = this.appId
    requestInfo.userId = this.userId
    requestInfo.page = window.location.href

    // 加入队列
    this.requestQueue.push(requestInfo)

    // 检查队列大小，如果超过阈值则立即发送
    if (this.requestQueue.length >= this.maxQueueSize) {
      this.reportRequest()
    }
  }

  /**
   * 批量发送队列数据
   */
  sendQueuedData() {
    if (this.errorQueue.length > 0) {
      this.reportError()
    }

    if (this.requestQueue.length > 0) {
      this.reportRequest()
    }
  }

  /**
   * 上报页面信息
   */
  reportPage(info = {}) {
    const pageInfo = {
      appId: this.appId,
      userId: this.userId,
      title: document.title,
      url: window.location.href,
      referrer: document.referrer,
      screenWidth: window.screen.width,
      screenHeight: window.screen.height,
      language: navigator.language,
      userAgent: navigator.userAgent,
      time: new Date().getTime(),
      ...info
    }

    // 添加性能信息
    if (window.performance) {
      const {
        domainLookupEnd,
        domainLookupStart,
        connectStart,
        connectEnd,
        secureConnectionStart,
        requestStart,
        responseStart,
        responseEnd,
        domContentLoadedEventStart,
        domContentLoadedEventEnd,
        loadEventEnd,
        startTime
      } = performance.getEntriesByType('navigation')[0] as any
      const performanceInfo = {
        dnsTime: domainLookupEnd - domainLookupStart, // dns解析时间
        tcpTime: connectEnd - secureConnectionStart, // tcp连接时间
        sslTime: connectEnd - connectStart, // ssl握手时间
        requestTime: responseStart - requestStart, // 请求时间
        responseTime: responseEnd - responseStart, // 响应时间
        domReadyTime: domContentLoadedEventEnd - domContentLoadedEventStart, // dom解析
        loadTime: loadEventEnd - startTime // 页面完全加载时间
      }
      Object.assign(pageInfo, performanceInfo)
    }

    // 发送页面信息
    this.send('/api/pages/create', pageInfo)
  }

  /**
   * 上报js错误信息
   */
  reportError() {
    if (this.errorQueue.length === 0) return

    // 发送错误信息
    this.send('/api/errors/create', {
      errors: [...this.errorQueue]
    })

    // 清空队列
    this.errorQueue = []
  }

  /**
   * 上报请求信息
   */
  reportRequest() {
    if (this.requestQueue.length === 0) return

    // 发送请求信息
    this.send('/api/requests/create', {
      requests: [...this.requestQueue]
    })

    // 清空队列
    this.requestQueue = []
  }

  /**
   * 发送数据到服务器
   * @param {string} path API路径
   * @param {Object} data 数据
   */
  send(path: string, data: any) {
    // 如果没有baseURL则不发送
    if (!this.baseURL) return

    // 使用Beacon API发送，避免页面卸载时丢失数据
    if (navigator.sendBeacon) {
      const fullURL = this.baseURL + path
      const blob = new Blob([JSON.stringify(data)], {
        type: 'application/json'
      })
      navigator.sendBeacon(fullURL, blob)
      return
    }

    // 后备方案：使用图片请求
    const img = new Image()
    img.src = `${this.baseURL}${path}?data=${encodeURIComponent(
      JSON.stringify(data)
    )}&t=${new Date().getTime()}`
  }

  /**
   * 销毁监控系统
   */
  destroy() {
    // 发送剩余队列数据
    this.sendQueuedData()

    // 恢复原始方法
    window.XMLHttpRequest = this.originalXHR
    window.fetch = this.originalFetch
    window.onerror = this.originalOnerror

    // 移除事件监听器
    if (this.unhandledRejectionListener) {
      window.removeEventListener(
        'unhandledrejection',
        this.unhandledRejectionListener
      )
      this.unhandledRejectionListener = null
    }

    if (this.resourceErrorListener) {
      window.removeEventListener('error', this.resourceErrorListener, true)
      this.resourceErrorListener = null
    }

    // 清理定时器
    if (this.sendTimer) {
      clearInterval(this.sendTimer)
      this.sendTimer = null
    }

    // 清空队列
    this.errorQueue = []
    this.requestQueue = []

    console.log('监控系统已销毁')
  }
}
