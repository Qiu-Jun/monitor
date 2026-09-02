/** 通用上报器（自定义采集场景按需引入，不含 Monitor 采集逻辑） */
export { createReporter, ExcReporter, SDK_VERSION, makeH5Transport } from './exception'
export type { ExcEventPayload, ExcSdkOptions, ExcTransport } from './exception'
