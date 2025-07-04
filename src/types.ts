export interface IMonitorOptions {
  baseURL?: string
  appId?: string
  userId?: string
  timeoutDuration?: number
  maxQueueSize?: number
  sendInterval?: number
  callback?: (data?: any) => void
}
