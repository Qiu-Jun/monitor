import type { ExcEventPayload, ExcSdkOptions, ExcTransport } from './types'

export const SDK_VERSION = '0.0.1'

const DEFAULT_MAX_BATCH = 20
const DEFAULT_FLUSH_INTERVAL = 30_000
const MAX_BUFFER = 100

/** 缓冲上报器：攒批 → transport 批量上报 */
export class ExcReporter {
  private buffer: ExcEventPayload[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private sending = false

  constructor(
    private readonly options: ExcSdkOptions,
    private readonly transport: ExcTransport,
  ) {}

  /** 采样 + 入缓冲 */
  capture(event: ExcEventPayload): void {
    const sampleRate = this.options.sampleRate ?? 100
    if (sampleRate < 100 && Math.random() * 100 >= sampleRate)
      return

    this.buffer.push({
      ...event,
      level: event.level ?? 'ERROR',
      occurredAt: event.occurredAt ?? new Date().toISOString(),
      sdkVersion: event.sdkVersion ?? SDK_VERSION,
    })

    if (this.buffer.length > MAX_BUFFER)
      this.buffer = this.buffer.slice(-MAX_BUFFER)

    if (this.buffer.length >= (this.options.maxBatch ?? DEFAULT_MAX_BATCH))
      void this.flush()
    else
      this.ensureTimer()
  }

  async flush(): Promise<void> {
    if (this.sending || this.buffer.length === 0)
      return

    this.clearTimer()
    this.sending = true
    const events = this.buffer
    this.buffer = []

    try {
      await this.transport({ events }, this.options.projectKey)
    }
    catch (err: any) {
      // 403 key 无效：放弃；其余放回缓冲重试
      if (err?.statusCode !== 403) {
        this.buffer = [...events, ...this.buffer].slice(-MAX_BUFFER)
        this.ensureTimer()
      }
    }
    finally {
      this.sending = false
    }
  }

  destroy(): void {
    this.clearTimer()
    void this.flush()
  }

  private ensureTimer(): void {
    if (this.timer)
      return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, this.options.flushInterval ?? DEFAULT_FLUSH_INTERVAL)
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}

export function createReporter(options: ExcSdkOptions, transport: ExcTransport): ExcReporter {
  return new ExcReporter(options, transport)
}
