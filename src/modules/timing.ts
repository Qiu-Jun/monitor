import type { TimingLog } from '../interface'

/** 采集并上报页面加载时序（DOMContentLoaded / load） */
function reportTiming(this: { send: (log: TimingLog) => void }) {
  let DOMContentLoadedTime = 0
  let loadTime = 0

  // 新版：PerformanceNavigationTiming；旧版降级 performance.timing
  if (performance.getEntriesByType) {
    const perfEntries = performance.getEntriesByType('navigation')
    if (perfEntries.length > 0) {
      const navigationEntry = perfEntries[0] as PerformanceNavigationTiming
      const { domContentLoadedEventStart, loadEventStart, fetchStart } = navigationEntry
      DOMContentLoadedTime = domContentLoadedEventStart - fetchStart
      loadTime = loadEventStart - fetchStart
    }
  }
  else {
    const { fetchStart, domContentLoadedEventStart, loadEventStart } = performance.timing
    DOMContentLoadedTime = domContentLoadedEventStart - fetchStart
    loadTime = loadEventStart - fetchStart
  }

  const log: TimingLog = {
    type: 'timing',
    DOMContentLoadedTime,
    loadTime,
  }
  console.log('[monitor] timing 上报', log)
  this.send(log)
}

type TimingHost = { send: (log: TimingLog) => void }

/**
 * 监听页面加载时序。
 * 若 SDK 在 window.load 之后才初始化，直接补报，避免永远收不到 timing。
 */
export default function onTiming(this: TimingHost) {
  const run = () => reportTiming.call(this)

  if (document.readyState === 'complete') {
    console.log('[monitor] 页面已 load 完成，立即补报 timing')
    run()
    return
  }

  window.addEventListener('load', run)
}
