/**
 * 与 main-server packages/exception-sdk/src/types.ts 对齐
 * monitor 内置 reporter，避免跨仓库 dist 依赖
 */

/** SDK 配置 */
export interface ExcSdkOptions {
  endpoint: string
  projectKey: string
  release?: string
  environment?: string
  /** 低级别事件（WARN/INFO，性能类等）采样率（%），0-100，默认 100 全量 */
  sampleRate?: number
  /** 错误事件（ERROR/FATAL）采样率（%），0-100，默认 100 全量；不随 sampleRate 联动，需压错误量时显式调低 */
  errorSampleRate?: number
  maxBatch?: number
  flushInterval?: number
}

/** 单条上报事件（对齐服务端 ReportEventDto） */
export interface ExcEventPayload {
  type: 'error' | 'unhandledrejection' | 'resource' | 'request' | 'custom' | 'paint' | 'timing' | 'longTask'
  level?: 'FATAL' | 'ERROR' | 'WARN' | 'INFO'
  message: string
  stack?: string
  page?: string
  userId?: string
  /** 客户端版本号 */
  release?: string
  /** 环境 production | development */
  environment?: string
  sdkVersion?: string
  occurredAt?: string
  device?: Record<string, any>
}

export type ExcTransport = (payload: { events: ExcEventPayload[] }, projectKey: string) => Promise<void>
