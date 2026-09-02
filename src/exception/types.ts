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
  sampleRate?: number
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
