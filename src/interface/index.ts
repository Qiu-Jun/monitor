export interface IMonitorOptions {
  /** 异常平台上报地址，如 https://host/api/exception/report */
  endpoint: string
  /** 接入项目 projectKey（后台「接入项目」创建后获得） */
  projectKey: string
  /** 客户端版本号 */
  release?: string
  /** 环境 production | development */
  environment?: string
  /** reporter 批量阈值，默认 20 */
  maxBatch?: number
  /** reporter 定时 flush 间隔 ms，默认 30000（30 秒） */
  flushInterval?: number
  userId?: string
  /** XHR 超时阈值 ms，默认 60000（1 分钟） */
  timeoutDuration?: number
  maxQueueSize?: number
  /** 同类错误采集去重窗口（ms），默认 0 不启用；窗口内 errorType+message+filename 相同的错误只上报一条。建议与 replay.minUploadIntervalMs 同值（如 30000），错误事件与回放 1:1 */
  errorDedupeMs?: number
  /** 业务错误判定：HTTP 2xx 但响应体 code 非成功的接口（如 { code: 1102, message: '无权限访问' }）返回 true 则上报为 request 事件。入参为解析后的响应体（非 JSON / 解析失败跳过）；XHR responseType 为 blob/arraybuffer 时读不到响应体同样跳过。示例：body => (body as any)?.code !== 0 */
  isBusinessError?: (body: unknown) => boolean
  /** 错误回放（仅 Web/H5，小程序无 DOM 不支持），默认关闭 */
  replay?: ReplayOptions
}

/** 错误回放配置：环形录制最近操作，出错时上传最近 15~30 秒，经独立接口 + device.replayId 关联异常事件 */
export interface ReplayOptions {
  /** 开启回放，默认 false */
  enabled?: boolean
  /** 会话采样率 0-1，默认 1（命中才录制） */
  sampleRate?: number
  /** 环形缓冲长度（秒），默认 30（实际覆盖 bufferSeconds/2 ~ bufferSeconds） */
  bufferSeconds?: number
  /** 单会话回放上传上限，默认 10 */
  maxUploadsPerSession?: number
  /** 两次上传最小间隔（ms），默认 30000 */
  minUploadIntervalMs?: number
  /** 单条回放解压前体积上限（字节），默认 2MB，超出只保留最新快照段 */
  maxReplayBytes?: number
  /** 请求失败是否也触发回放上传，默认 false（仅 error/unhandledrejection 触发） */
  captureRequest?: boolean
  /** 文本脱敏类名，默认 'rr-mask'；输入值默认全脱敏（maskAllInputs） */
  maskTextClass?: string
  /** 回放上传地址；默认由 endpoint 末尾 /report 换成 /replay，推导不出时必须显式传 */
  replayEndpoint?: string
}


// 基础日志
export interface BaseLog {
  // 网页标题
  title: string;
  // 网页地址
  url: string;
  // 用户环境完整信息
  userAgent: string;
  // 浏览器
  browser: string;
  // 设备
  device: string;
  // 操作系统
  os: string;
}

// 错误日志
export interface ErrorLog {
  // type 监控类型：error（代码错误）
  type: "error";
  // 错误类型：jsError（JS 代码错误）、promiseError（Promise 错误）、xhrError（API 请求错误）
  errorType: "jsError" | "promiseError" | "xhrError";
  // 错误信息
  message: string;
  // 错误发生的文件
  filename?: string;
  // 错误发生的行列信息
  position?: string;
  // 错误堆栈信息
  stack?: string;
  // 错误发生在 DOM 到顶层元素的链路信息（使用选择器表示，如：body div#container input）
  selector?: string;
  // 是否白屏
  isWhiteScreen?: boolean;
  // xhr 数据
  xhrData?: {
    eventType: "load" | "error"; // xhr 错误事件类型
    url: string; // api 路径
    method: string; // 请求方式
    header: Record<string, unknown>; // 请求头
    params: string; // 请求参数
    duration: number; // 请求时长
    status: number; // 请求状态
    response: string; // 请求结果
  };
}

// 性能指标日志
export interface PaintLog {
  // type 监控类型：性能监控
  type: "paint";
  // FP
  FP?: number;
  // FCP
  FCP?: number;
  // FMP
  FMP?: number;
  // LCP
  LCP?: number;
}

// timing 加载时间日志
export interface TimingLog {
  // type 监控类型：性能监控
  type: "timing";
  // DOMContentLoaded 的执行时间
  DOMContentLoadedTime: number;
  // load 页面完整的加载时间
  loadTime: number;
}

// longTask 长任务日志
export interface LongTaskLog {
  // type 监控类型：性能监控
  type: "longTask";
  // 开始时间
  startTime: number;
  // 持续时间
  duration: number;
  // 交互事件
  eventType?: string;
  // 操作 DOM 选择器链路
  selector?: string;
}

export interface RequestLog {
  // type 监控类型：性能监控
  type: "xhr" | "fetch";
  startTime: number;
  duration: number;
  msg: string;
  success?: boolean;
  status?: number;
  url?: string;
  method?: string;
  /** 业务错误详情（isBusinessError 判定命中时填充，如 { code: 1102, message: '无权限访问' }） */
  business?: { code?: number | string, message?: string };
  /** 请求发生时页面地址（captureRequest 自动填充） */
  page?: string;
}
export interface BatchRequestLog {
  type: 'batchXHR',
  requests: RequestLog[];
}

// 监控种类日志
export type MonitorTypeLog = ErrorLog | PaintLog | TimingLog | LongTaskLog | RequestLog | BatchRequestLog;