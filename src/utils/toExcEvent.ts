import type { ExcEventPayload } from '../exception/types'
import type {
  BaseLog,
  BatchRequestLog,
  ErrorLog,
  IMonitorOptions,
  LongTaskLog,
  MonitorTypeLog,
  PaintLog,
  RequestLog,
  TimingLog,
} from '../interface'

/** 当前页面 **/
function currentPage(): string {
  try {
    return location.href
  }
  catch {
    return ''
  }
}

function baseDeviceFields(base: BaseLog): Record<string, unknown> {
  return {
    title: base.title,
    url: base.url,
    browser: base.browser,
    os: base.os,
    deviceInfo: base.device,
    userAgent: base.userAgent,
  }
}

function contextFields(
  base: BaseLog,
  opts: Pick<IMonitorOptions, 'userId' | 'release' | 'environment'>,
): Partial<ExcEventPayload> {
  return {
    page: currentPage(),
    userId: opts.userId,
    release: opts.release,
    environment: opts.environment,
    device: baseDeviceFields(base),
  }
}

function mapErrorLog(
  log: ErrorLog,
  base: BaseLog,
  opts: Pick<IMonitorOptions, 'userId' | 'release' | 'environment'>,
): ExcEventPayload {
  const ctx = contextFields(base, opts)

  if (log.errorType === 'promiseError') {
    return {
      type: 'unhandledrejection',
      level: 'ERROR',
      message: log.message,
      stack: log.stack,
      ...ctx,
      device: { ...ctx.device, selector: log.selector, filename: log.filename, position: log.position, errorType: log.errorType },
    }
  }

  if (log.errorType === 'loadResourceError') {
    const url = log.filename ?? log.message
    return {
      type: 'resource',
      level: 'ERROR',
      message: url ? `Resource failed: ${url}` : log.message,
      ...ctx,
      device: { ...ctx.device, tagName: log.tagName, selector: log.selector, errorType: log.errorType },
    }
  }

  return {
    type: 'error',
    level: 'ERROR',
    message: log.message,
    stack: log.stack,
    ...ctx,
    device: {
      ...ctx.device,
      selector: log.selector,
      isWhiteScreen: log.isWhiteScreen,
      filename: log.filename,
      position: log.position,
      errorType: log.errorType,
    },
  }
}

function mapPaintLog(log: PaintLog, base: BaseLog, opts: Pick<IMonitorOptions, 'userId' | 'release' | 'environment'>): ExcEventPayload {
  const ctx = contextFields(base, opts)
  return {
    type: 'paint',
    level: 'INFO',
    message: 'paint metrics',
    ...ctx,
    device: { ...ctx.device, FP: log.FP, FCP: log.FCP, FMP: log.FMP, LCP: log.LCP },
  }
}

function mapTimingLog(log: TimingLog, base: BaseLog, opts: Pick<IMonitorOptions, 'userId' | 'release' | 'environment'>): ExcEventPayload {
  const ctx = contextFields(base, opts)
  return {
    type: 'timing',
    level: 'INFO',
    message: 'timing metrics',
    ...ctx,
    device: { ...ctx.device, DOMContentLoadedTime: log.DOMContentLoadedTime, loadTime: log.loadTime },
  }
}

function mapLongTaskLog(log: LongTaskLog, base: BaseLog, opts: Pick<IMonitorOptions, 'userId' | 'release' | 'environment'>): ExcEventPayload {
  const ctx = contextFields(base, opts)
  return {
    type: 'longTask',
    level: log.duration >= 100 ? 'WARN' : 'INFO',
    message: `long task ${log.duration}ms`,
    ...ctx,
    device: { ...ctx.device, startTime: log.startTime, duration: log.duration, selector: log.selector, eventType: log.eventType },
  }
}

/** RequestLog（失败）→ request */
export function mapRequestLog(
  req: RequestLog,
  base: BaseLog,
  opts: Pick<IMonitorOptions, 'userId' | 'release' | 'environment'>,
): ExcEventPayload | null {
  if (req.success !== false)
    return null

  const url = String(req.url ?? '')
  const method = String(req.method ?? 'GET').toUpperCase()
  const status = req.status ?? 0
  const reason = status === 0 ? 'network' : String(status)
  const ctx = contextFields(base, opts)

  return {
    type: 'request',
    level: 'ERROR',
    message: `Request failed [${reason}]: ${method} ${url}`,
    ...ctx,
    device: { ...ctx.device, durationMs: req.duration, msg: req.msg },
  }
}

function mapBatchRequestLog(
  log: BatchRequestLog,
  base: BaseLog,
  opts: Pick<IMonitorOptions, 'userId' | 'release' | 'environment'>,
): ExcEventPayload[] {
  return log.requests
    .map(req => mapRequestLog(req, base, opts))
    .filter((e): e is ExcEventPayload => e != null)
}

/** monitor 采集日志 → 异常平台事件列表 */
export function toExcEvents(
  data: MonitorTypeLog,
  base: BaseLog,
  opts: Pick<IMonitorOptions, 'userId' | 'release' | 'environment'>,
): ExcEventPayload[] {
  if (data.type === 'error')
    return [mapErrorLog(data, base, opts)]
  if (data.type === 'paint')
    return [mapPaintLog(data, base, opts)]
  if (data.type === 'timing')
    return [mapTimingLog(data, base, opts)]
  if (data.type === 'longTask')
    return [mapLongTaskLog(data, base, opts)]
  if (data.type === 'batchXHR')
    return mapBatchRequestLog(data, base, opts)
  if (data.type === 'xhr' || data.type === 'fetch') {
    const one = mapRequestLog(data, base, opts)
    return one ? [one] : []
  }
  return []
}

/** 是否为异常平台上报 URL（防递归拦截） */
export function isExceptionReportUrl(url: string | URL, endpoint?: string): boolean {
  if (!endpoint)
    return false
  return String(url) === endpoint
}
