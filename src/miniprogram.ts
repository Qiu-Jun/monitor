/**
 * 小程序监控入口（按需引入）
 * 与 H5 入口相互独立：transport 基于 wx.request，错误采集基于 wx.onError / wx.onUnhandledRejection
 */
import { SDK_VERSION, createReporter } from './exception/reporter'
import type { ExcReporter } from './exception/reporter'
import type { ExcEventPayload, ExcSdkOptions, ExcTransport } from './exception/types'

export type { ExcEventPayload, ExcSdkOptions, ExcReporter, ExcTransport }
export { SDK_VERSION, createReporter }

/** 最小 wx 类型声明（避免强制依赖 miniprogram-api-typings） */
interface WxLike {
  request(options: {
    url: string
    method?: string
    header?: Record<string, string>
    data?: string
    success?: (res: { statusCode: number }) => void
    fail?: (err: { errMsg?: string }) => void
  }): void
  onError(callback: (message: string) => void): void
  offError?(callback: (message: string) => void): void
  onUnhandledRejection(callback: (res: { reason?: unknown }) => void): void
  offUnhandledRejection?(callback: (res: { reason?: unknown }) => void): void
  onAppHide?(callback: () => void): void
  offAppHide?(callback: () => void): void
  getAccountInfoSync?(): { miniProgram?: { envVersion?: string, version?: string } }
  getSystemInfoSync?(): Record<string, any>
}

/** 从全局取 wx（微信 / uni-app 等均已注入），取不到返回 undefined */
function getWx(): WxLike | undefined {
  return (globalThis as Record<string, any>).wx
}

/** 小程序 transport：wx.request POST JSON */
export function makeMiniProgramTransport(endpoint: string, wxApi?: WxLike): ExcTransport {
  const api = wxApi ?? getWx()
  if (!api)
    throw new Error('monitor: 未找到 wx 全局对象，请显式传入 wxApi')

  return (payload, projectKey) =>
    new Promise<void>((resolve, reject) => {
      api.request({
        url: endpoint,
        method: 'POST',
        header: { 'content-type': 'application/json', 'X-Project-Key': projectKey },
        data: JSON.stringify(payload),
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300)
            resolve()
          else
            reject(Object.assign(new Error(`monitor: 上报失败 ${res.statusCode}`), { statusCode: res.statusCode }))
        },
        fail: err => reject(new Error(`monitor: 上报失败 ${err?.errMsg ?? 'network error'}`)),
      })
    })
}

export interface MiniProgramMonitorOptions extends ExcSdkOptions {
  /** 用户标识（对齐 H5 侧 IMonitorOptions.userId） */
  userId?: string
  /** 默认取全局 wx；支付宝/百度等可显式传入适配后的 API */
  wxApi?: WxLike
  /** 拦截 App/Page/Component 生命周期（默认 true，须在调用 App()/Page() 之前初始化） */
  interceptLifecycle?: boolean
  /** 拦截 wx.request 上报失败请求（默认 true，上报自身 URL 除外，防递归） */
  interceptRequest?: boolean
}

export interface MiniProgramMonitor {
  reporter: ExcReporter
  /** 上报自定义事件 */
  capture: (event: ExcEventPayload) => void
  /** 立即上报缓冲中的事件，并还原 App/Page/Component 与 wx.request 的包装 */
  destroy: () => void
}

/** Page/Component 实例生命周期 */
const PAGE_LIFECYCLES = ['onLoad', 'onShow', 'onReady', 'onHide', 'onUnload', 'onPullDownRefresh', 'onReachBottom', 'onError'] as const
/** App 生命周期 */
const APP_LIFECYCLES = ['onLaunch', 'onShow', 'onHide', 'onPageNotFound'] as const
/** Component 生命周期 */
const COMPONENT_LIFECYCLES = ['attached', 'ready', 'detached'] as const

type LifecycleCallback = (this: any, ...args: any[]) => any

/**
 * 包装生命周期：正常执行不打扰；抛错（含 async 生命周期 reject）时上报
 * 带 lifecycle/页面/组件上下文与耗时，然后原样抛出（wx.onError 兜底，内部去重防双报）
 */
function wrapLifecycle(fn: LifecycleCallback, name: string, getContext: () => { page: string, component?: string }): LifecycleCallback {
  return function (this: any, ...args: any[]) {
    const start = Date.now()
    const handleError = (err: unknown) => {
      const e = err instanceof Error ? err : new Error(String(err))
      lifecycleErrorHandler?.({
        type: 'error',
        message: e.message,
        stack: e.stack,
        lifecycle: name,
        duration: Date.now() - start,
        page: getContext().page,
        component: getContext().component,
      })
    }
    try {
      const result = fn.apply(this, args)
      // async 生命周期（如 async onLoad）的 reject
      if (result instanceof Promise)
        return result.catch((err: unknown) => { handleError(err); throw err })
      return result
    }
    catch (err) {
      handleError(err)
      throw err
    }
  }
}

/** wrapLifecycle 上报出口（由 createMiniProgramMonitor 注入） */
let lifecycleErrorHandler: ((info: { type: 'error', message: string, stack?: string, lifecycle: string, duration: number, page: string, component?: string }) => void) | null = null

/** 短窗口内同消息去重（生命周期包装抛出 + wx.onError 会收到同一条错误） */
let lastErrorCache = { message: '', time: 0 }
function isDuplicate(message: string): boolean {
  const now = Date.now()
  if (message === lastErrorCache.message && now - lastErrorCache.time < 5_000)
    return true
  lastErrorCache = { message, time: now }
  return false
}

/**
 * 拦截全局 App/Page/Component：包装生命周期与组件 methods（抛错时带上下文上报）
 * 必须在业务代码调用 App()/Page()/Component() 之前执行
 */
function interceptConstructors() {
  const g = globalThis as any

  function wrapDefinition(original: (opts: any) => void, kind: 'App' | 'Page' | 'Component') {
    return function (this: any, options: any) {
      const lifecycles = kind === 'App' ? APP_LIFECYCLES : kind === 'Page' ? PAGE_LIFECYCLES : COMPONENT_LIFECYCLES
      const getContext = () => ({ page: kind === 'App' ? '' : currentPageRoute(), component: kind === 'Component' ? 'Component' : undefined })
      for (const name of lifecycles) {
        const fn = options?.[name]
        if (typeof fn === 'function')
          options[name] = wrapLifecycle(fn, name, getContext)
      }
      // Component 的 methods 也包一层（组件方法抛错常见于这里）
      if (kind === 'Component' && options?.methods) {
        for (const name of Object.keys(options.methods)) {
          const fn = options.methods[name]
          if (typeof fn === 'function')
            options.methods[name] = wrapLifecycle(fn, name, getContext)
        }
      }
      return original.call(this, options)
    }
  }

  const originals: Record<string, any> = {}
  for (const key of ['App', 'Page', 'Component'] as const) {
    if (typeof g[key] === 'function') {
      originals[key] = g[key]
      g[key] = Object.assign(wrapDefinition(g[key], key), { __monitor_original__: g[key] })
    }
  }
  return () => {
    for (const [key, fn] of Object.entries(originals)) {
      if (g[key]?.__monitor_original__ === fn)
        g[key] = fn
    }
  }
}

function currentPageRoute(): string {
  try {
    const pages = (globalThis as any).getCurrentPages?.() ?? []
    const route = pages[pages.length - 1]?.route
    return route ? `/${route}` : ''
  }
  catch {
    return ''
  }
}

/** 拦截 wx.request：失败的请求按 H5 侧 request 事件格式上报（上报自身 URL 除外，防递归） */
function interceptRequest(wxApi: WxLike, endpoint: string, capture: (event: ExcEventPayload) => void) {
  const original = wxApi.request.bind(wxApi)
  ;(wxApi as any).request = (options: any) => {
    const url = String(options?.url ?? '')
    if (url === endpoint)
      return original(options)

    const start = Date.now()
    return original({
      ...options,
      success: (res: any) => {
        if (res.statusCode >= 400) {
          capture({
            type: 'request',
            message: `Request failed [${res.statusCode}]: ${String(options?.method ?? 'GET').toUpperCase()} ${url}`,
            device: { durationMs: Date.now() - start },
          })
        }
        options?.success?.(res)
      },
      fail: (err: any) => {
        capture({
          type: 'request',
          message: `Request failed [network]: ${String(options?.method ?? 'GET').toUpperCase()} ${url}`,
          device: { durationMs: Date.now() - start, msg: err?.errMsg },
        })
        options?.fail?.(err)
      },
    })
  }
  return () => {
    ;(wxApi as any).request = original
  }
}

/** 小程序监控：创建 reporter + 挂载错误采集（wx.onError / wx.onUnhandledRejection）+ 切后台 flush */
export function createMiniProgramMonitor(options: MiniProgramMonitorOptions): MiniProgramMonitor {
  const wxApi = options.wxApi ?? getWx()
  if (!wxApi)
    throw new Error('monitor: 未找到 wx 全局对象，请显式传入 wxApi')

  const reporter = createReporter(options, makeMiniProgramTransport(options.endpoint, wxApi))

  const sys = wxApi.getSystemInfoSync?.()
  const account = wxApi.getAccountInfoSync?.().miniProgram
  // device 字段与 H5 侧 toExcEvent.baseDeviceFields 对齐：title/url/browser/os/deviceInfo/userAgent
  const baseDevice = {
    browser: `miniProgram ${account?.envVersion ?? ''}`.trim(),
    os: String(sys?.system ?? ''),
    deviceInfo: `${sys?.brand ?? ''} ${sys?.model ?? ''}`.trim(),
    userAgent: String(sys?.host ?? ''),
  }

  /** 当前页面路由（对齐 H5 侧的 page: location.href） */
  const currentPage = currentPageRoute

  const withBase = (event: ExcEventPayload): ExcEventPayload => ({
    level: 'ERROR',
    ...event,
    page: event.page ?? currentPage(),
    userId: event.userId ?? options.userId,
    release: event.release ?? options.release ?? account?.version,
    environment: event.environment
      ?? options.environment
      ?? (account?.envVersion === 'release' ? 'production' : account?.envVersion),
    device: { ...baseDevice, ...event.device },
  })

  const onError = (message: string) => {
    // 生命周期包装已上报过的错误（包装后原样抛出会再进这里），5s 内同消息去重
    if (isDuplicate(message))
      return
    const [msg, ...stackLines] = message.split('\n')
    reporter.capture(withBase({ type: 'error', message: msg, stack: stackLines.join('\n') || undefined }))
  }
  const onUnhandledRejection = (res: { reason?: unknown }) => {
    const reason = res.reason
    const err = reason instanceof Error ? reason : undefined
    reporter.capture(withBase({
      type: 'unhandledrejection',
      message: err?.message ?? (typeof reason === 'string' ? reason : JSON.stringify(reason)),
      stack: err?.stack,
    }))
  }
  const onAppHide = () => void reporter.flush()

  wxApi.onError(onError)
  wxApi.onUnhandledRejection(onUnhandledRejection)
  wxApi.onAppHide?.(onAppHide)

  const doCapture = (event: ExcEventPayload) => reporter.capture(withBase(event))

  // 生命周期拦截：包装内抛错 → 带上下文上报；随后原样抛出由 wx.onError 兜底（已去重）
  lifecycleErrorHandler = info => doCapture({
    type: 'error',
    message: info.message,
    stack: info.stack,
    device: { lifecycle: info.lifecycle, duration: info.duration, component: info.component },
  })

  const restoreConstructors
    = options.interceptLifecycle !== false ? interceptConstructors() : null
  const restoreRequest
    = options.interceptRequest !== false ? interceptRequest(wxApi, options.endpoint, doCapture) : null

  return {
    reporter,
    capture: doCapture,
    destroy: () => {
      lifecycleErrorHandler = null
      restoreConstructors?.()
      restoreRequest?.()
      wxApi.offError?.(onError)
      wxApi.offUnhandledRejection?.(onUnhandledRejection)
      wxApi.offAppHide?.(onAppHide)
      reporter.destroy()
    },
  }
}