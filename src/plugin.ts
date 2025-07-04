/* eslint-disable prefer-rest-params */
import Monitor from './monitor'
import { IMonitorOptions } from './types'

/**
 * Vue监控插件
 * 使用方式: app.use(MonitorPlugin, options)
 */
export default {
  install: (app: any, options: IMonitorOptions = {}) => {
    // 创建监控实例
    const monitor = new Monitor({
      baseURL: options.baseURL || '',
      appId: options.appId || '',
      userId: options.userId || '',
      sendInterval: options.sendInterval || 5000,
      maxQueueSize: options.maxQueueSize || 10,
      timeoutDuration: options.timeoutDuration || 10000
    })

    // 初始化监控
    monitor.init()

    // 添加到全局属性
    app.config.globalProperties.$monitor = monitor

    // 提供注入，用于组合式API
    app.provide('monitor', monitor)

    // 监听应用卸载
    const originalUnmount = app.unmount
    app.unmount = function () {
      // 销毁监控
      monitor.destroy()
      return originalUnmount.apply(this, arguments as any)
    }
  }
}
