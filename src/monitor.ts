import { getLogBaseData } from "./utils/index";
import { onWindowErr, onLongTask, onPaint, onTiming, onXHR } from './modules'
import type { IMonitorOptions, MonitorLog, MonitorTypeLog, RequestLog } from './interface'

export default class Monitor {
  reportUrl: string;
  monitorGif: string;
  timeoutDuration: number;
  errorQueue: RequestLog[];
  requestQueue: RequestLog[];
  maxQueueSize: number;
  sendTimer: number | null;
  originalXHR: { new(): XMLHttpRequest; prototype: XMLHttpRequest; readonly UNSENT: 0; readonly OPENED: 1; readonly HEADERS_RECEIVED: 2; readonly LOADING: 3; readonly DONE: 4; };
  originalFetch: ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) & { (input: RequestInfo | URL, init?: RequestInit): Promise<Response>; (input: string | URL | globalThis.Request, init?: RequestInit): Promise<Response>; };
  originalOnerror: OnErrorEventHandler;

  constructor(options: IMonitorOptions) {
    // if (!options.appId) throw new Error('appId is required');
    this.reportUrl = options?.reportUrl || ''
    this.monitorGif = options?.monitorGif || 'http://localhost:8080/send/monitor.gif'
    this.timeoutDuration = options?.timeoutDuration || 10000 // 默认超时时间10秒
    this.errorQueue = [] // 错误信息队列
    this.requestQueue = [] // 请求信息队列
    this.maxQueueSize = options?.maxQueueSize || 10 // 最大队列大小，超过自动发送
    this.sendTimer = null // 定时发送定时器
    this.init()

    // 保存原始方法，用于销毁时恢复
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

  send(data: MonitorTypeLog) {
    // 获取基础日志数据
    const baseData = getLogBaseData();
    const log: MonitorLog = {
      baseLog: baseData,
      ...data,
    };
    console.log('上报日志:', log);
    // @ts-ignore
    if(this.reportUrl && navigator.sendBeacon) {
      // 如果填了上报地址，并且浏览器支持sendBeacon
      const formData = new FormData();
      formData.append('data', encodeURIComponent(JSON.stringify(log)));
      return navigator.sendBeacon(this.reportUrl, formData);
    } else {
      // 如果填了gif地址，并且不是批量XHR请求
      if(this.monitorGif && data.type !== 'batchXHR') {
        const img = new window.Image();
        img.src = `${this.monitorGif}?data=${encodeURIComponent(JSON.stringify(log))}`;
        return
      } else {
        // 写个接口
      }
    }
  }

    /**
   * 上报请求信息
   */
  reportRequest() {
    if (this.requestQueue.length === 0) return

    // 发送请求信息
    this.send({
      type: 'batchXHR',
      requests: [...this.requestQueue]
    })

    // 清空队列
    this.requestQueue = []
  }

  /*
    * 上报请求错误信息
   */
  reportError() {
    if (this.errorQueue.length === 0) return

    // 发送错误信息
    this.send({
      type: 'batchXHR',
      requests: [...this.errorQueue]
    })

    // 清空队列
    this.errorQueue = []
  }


  /**
   * 捕获请求异常
   * @param {Object} requestInfo 请求信息
   */
  captureRequest(requestInfo: any) {
    // 验证请求类型是否符合规范
    const validRequestTypes = ['xhr', 'fetch']
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
      'startTime'
    ]
    for (const field of requiredFields) {
      if (requestInfo[field] === undefined) {
        console.warn(`监控系统: 请求信息中缺少必填字段 ${field}，无法上报`)
        return
      }
    }

    // 添加基本信息
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

  destroy() {
    // 发送剩余队列数据
    this.sendQueuedData()
    // 恢复原始方法
    window.XMLHttpRequest = this.originalXHR
    window.fetch = this.originalFetch
    window.onerror = this.originalOnerror

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