import { createReporter, makeH5Transport } from './exception'
import type { ExcReporter } from './exception'
import type { ExcEventPayload } from './exception/types'
import { onWindowErr, onLongTask, onPaint, onTiming, onXHR } from './modules'
import type { IMonitorOptions, MonitorTypeLog, RequestLog } from './interface'
import { getLogBaseData } from './utils/index'
import { isExceptionReportUrl, toExcEvents } from './utils/toExcEvent'
import { ReplayController, deriveReplayEndpoint } from './replay'

export default class Monitor {
  /** 异常平台上报地址 */
  endpoint: string
  /** 接入项目 projectKey */
  projectKey: string
  timeoutDuration: number
  errorQueue: RequestLog[]
  requestQueue: RequestLog[]
  maxQueueSize: number
  sendTimer: number | null
  reporter: ExcReporter
  private replay: ReplayController | null = null
  private readonly options: IMonitorOptions
  originalXHR: { new(): XMLHttpRequest, prototype: XMLHttpRequest, readonly UNSENT: 0, readonly OPENED: 1, readonly HEADERS_RECEIVED: 2, readonly LOADING: 3, readonly DONE: 4 }
  originalFetch: ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) & { (input: RequestInfo | URL, init?: RequestInit): Promise<Response>, (input: string | URL | globalThis.Request, init?: RequestInit): Promise<Response> }
  originalOnerror: OnErrorEventHandler

  constructor(options: IMonitorOptions) {
    this.options = options
    this.endpoint = options.endpoint
    this.projectKey = options.projectKey
    this.timeoutDuration = options.timeoutDuration ?? 60_000
    this.errorQueue = []
    this.requestQueue = []
    this.maxQueueSize = options.maxQueueSize ?? 10
    this.sendTimer = null

    this.reporter = createReporter(
      {
        endpoint: options.endpoint,
        projectKey: options.projectKey,
        release: options.release,
        environment: options.environment,
        maxBatch: options.maxBatch,
        flushInterval: options.flushInterval,
      },
      makeH5Transport(options.endpoint),
    )

    this.init()

    this.initReplay()

    this.originalXHR = window.XMLHttpRequest
    this.originalFetch = window.fetch
    this.originalOnerror = window.onerror
  }

  init() {
    onWindowErr.call(this)
    onLongTask.call(this)
    onPaint.call(this)
    onTiming.call(this)
    onXHR.call(this)
  }

  /** 回放初始化：显式开启 + 采样命中 + 回放地址可解析 */
  private initReplay(): void {
    const replayOptions = this.options.replay
    if (!replayOptions?.enabled)
      return
    const sampleRate = replayOptions.sampleRate ?? 1
    if (Math.random() >= sampleRate)
      return
    const replayEndpoint = replayOptions.replayEndpoint ?? deriveReplayEndpoint(this.endpoint)
    if (!replayEndpoint) {
      console.warn('monitor: replay.replayEndpoint 未配置且无法从 endpoint（需以 /report 结尾）推导，回放已禁用')
      return
    }
    this.replay = new ReplayController({
      replayEndpoint,
      projectKey: this.projectKey,
      bufferSeconds: replayOptions.bufferSeconds,
      maxUploadsPerSession: replayOptions.maxUploadsPerSession,
      minUploadIntervalMs: replayOptions.minUploadIntervalMs,
      maxReplayBytes: replayOptions.maxReplayBytes,
      captureRequest: replayOptions.captureRequest,
      maskTextClass: replayOptions.maskTextClass,
    })
    void this.replay.start()
  }

  /** 统一上报：转异常平台格式 → reporter 批量 POST；错误触发回放切片上传并回填 device.replayId */
  send(data: MonitorTypeLog) {
    const baseData = getLogBaseData()
    const events = toExcEvents(data, baseData, this.options)
    const replayId = this.replay?.captureIfTriggered(data)
    if (replayId) {
      for (const event of events)
        event.device = { ...event.device, replayId }
    }
    for (const event of events)
      this.reporter.capture(event)
  }

  /** 手动上报自定义事件 */
  capture(event: ExcEventPayload) {
    this.reporter.capture(event)
  }

  reportRequest() {
    if (this.requestQueue.length === 0)
      return

    this.send({ type: 'batchXHR', requests: [...this.requestQueue] })
    this.requestQueue = []
  }

  reportError() {
    if (this.errorQueue.length === 0)
      return

    this.send({ type: 'batchXHR', requests: [...this.errorQueue] })
    this.errorQueue = []
  }

  captureRequest(requestInfo: RequestLog & { type: 'xhr' | 'fetch' }) {
    const validRequestTypes = ['xhr', 'fetch'] as const
    if (!requestInfo.type || !validRequestTypes.includes(requestInfo.type)) {
      console.warn(`监控系统: 无效的请求类型 ${requestInfo.type}，无法上报`)
      return
    }

    if (isExceptionReportUrl(String(requestInfo.url ?? ''), this.endpoint))
      return

    const requiredFields = ['url', 'method', 'duration', 'status', 'success', 'startTime'] as const
    for (const field of requiredFields) {
      if (requestInfo[field] === undefined) {
        console.warn(`监控系统: 请求信息中缺少必填字段 ${field}，无法上报`)
        return
      }
    }

    requestInfo.page = window.location.href
    this.requestQueue.push(requestInfo)

    if (this.requestQueue.length >= this.maxQueueSize)
      this.reportRequest()
  }

  sendQueuedData() {
    if (this.errorQueue.length > 0)
      this.reportError()
    if (this.requestQueue.length > 0)
      this.reportRequest()
  }

  destroy() {
    this.replay?.stop()

    this.sendQueuedData()
    this.reporter.destroy()

    window.XMLHttpRequest = this.originalXHR
    window.fetch = this.originalFetch
    window.onerror = this.originalOnerror

    if (this.sendTimer) {
      clearInterval(this.sendTimer)
      this.sendTimer = null
    }

    this.errorQueue = []
    this.requestQueue = []
  }
}
