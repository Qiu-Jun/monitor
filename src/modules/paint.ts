import type { PaintLog } from '../interface'

/** 带历史缓冲的 PerformanceObserver（兼容 SDK 晚于首次绘制才启动） */
function observeBuffered(
  type: string,
  callback: (entries: PerformanceEntry[]) => void,
): PerformanceObserver | null {
  if (typeof PerformanceObserver === 'undefined')
    return null

  try {
    const observer = new PerformanceObserver((list) => {
      callback(list.getEntries())
    })
    // type + buffered 可拿到观察前已产生的条目
    observer.observe({ type, buffered: true } as PerformanceObserverInit)
    return observer
  }
  catch (err) {
    console.warn('[monitor] PerformanceObserver 不支持 type=', type, err)
    return null
  }
}

type PaintHost = { send: (log: PaintLog) => void }

/**
 * 采集绘制指标 FP/FCP/FMP/LCP。
 * 若 SDK 在 window.load 之后初始化，仍会延迟上报（含 buffered 历史指标）。
 */
export default function onPaint(this: PaintHost) {
  if (typeof PerformanceObserver === 'undefined') {
    console.warn('[monitor] 当前环境不支持 PerformanceObserver，跳过 paint 采集')
    return
  }

  let FP: PerformanceEntry | null = null
  let FCP: PerformanceEntry | null = null
  let FMP: PerformanceEntry | null = null
  let LCP: PerformanceEntry | null = null

  const observerFPAndFCP = observeBuffered('paint', (entries) => {
    for (const entry of entries) {
      if (entry.name === 'first-paint') {
        FP = entry
        console.log('[monitor] FP', FP.startTime)
      }
      else if (entry.name === 'first-contentful-paint') {
        FCP = entry
        console.log('[monitor] FCP', FCP.startTime)
      }
    }
  })

  const observerFMP = observeBuffered('element', (entries) => {
    if (entries.length > 0) {
      FMP = entries[0]
      console.log('[monitor] FMP', FMP.startTime)
      observerFMP?.disconnect()
    }
  })

  // LCP 会多次更新，上报前再 disconnect
  const observerLCP = observeBuffered('largest-contentful-paint', (entries) => {
    if (entries.length > 0) {
      LCP = entries[entries.length - 1]
      console.log('[monitor] LCP', LCP.startTime)
    }
  })

  /** load 后再等一段时间，尽量拿到稳定 LCP 再上报 */
  const scheduleReport = () => {
    setTimeout(() => {
      observerLCP?.disconnect()
      observerFPAndFCP?.disconnect()
      observerFMP?.disconnect()

      const log: PaintLog = {
        type: 'paint',
        FP: FP?.startTime,
        FCP: FCP?.startTime,
        FMP: FMP?.startTime,
        LCP: LCP?.startTime,
      }
      console.log('[monitor] paint 上报', log)
      this.send(log)
    }, 3000)
  }

  if (document.readyState === 'complete') {
    console.log('[monitor] 页面已 load 完成，延迟补报 paint')
    scheduleReport()
    return
  }

  window.addEventListener('load', scheduleReport)
}
