/**
 * 错误回放（仅 Web/H5）：rrweb 持续环形录制，出错时切片上传独立接口
 * 小程序无 DOM，不支持回放
 * 设计：录制与上传解耦——segments 滚动保留最近 2 个（每个以完整快照开头，覆盖约 bufferSeconds），
 * 出错时同步取快照 + 生成 replayId，异步压缩上传（fire-and-forget，失败静默）
 */
import type { record } from 'rrweb'
import type { MonitorTypeLog, ReplayOptions } from '../interface'
import { randomId } from '../utils/uuid'
import { uploadReplay } from './upload'

/** rrweb 事件的最小结构（完整结构由播放端按 format 解析，SDK 只关心时间戳） */
interface RrwebEvent {
  timestamp: number
  [key: string]: unknown
}

/** 环形缓冲保留的 segment 数：2 个 × (bufferSeconds/2) 的快照间隔 ⇒ 覆盖 bufferSeconds/2 ~ bufferSeconds */
const MAX_SEGMENTS = 2

const DEFAULTS = {
  bufferSeconds: 30,
  maxUploadsPerSession: 10,
  minUploadIntervalMs: 30000,
  maxReplayBytes: 2 * 1024 * 1024,
}

/** 由上报地址推导回放地址：末尾 /report 换成 /replay，匹配不到返回 undefined */
export function deriveReplayEndpoint(endpoint: string): string | undefined {
  const trimmed = endpoint.replace(/\/+$/, '')
  return trimmed.endsWith('/report')
    ? `${trimmed.slice(0, -'/report'.length)}/replay`
    : undefined
}

/** 运行时回放配置（ReplayOptions 去掉采样/开关后传入） */
export interface ReplayRuntimeOptions extends Pick<ReplayOptions, 'bufferSeconds' | 'maxUploadsPerSession' | 'minUploadIntervalMs' | 'maxReplayBytes' | 'captureRequest' | 'maskTextClass'> {
  replayEndpoint: string
  projectKey: string
}

export class ReplayController {
  /** 每个 segment 以一份完整 DOM 快照开头 */
  private segments: RrwebEvent[][] = []
  private stopFn: (() => void) | null = null
  private starting = false
  private lastUploadAt = 0
  private uploadCount = 0

  constructor(private readonly opts: ReplayRuntimeOptions) {}

  /** 动态加载 rrweb 并开始录制；加载失败静默降级（错误上报不受影响） */
  async start(): Promise<void> {
    if (this.stopFn || this.starting)
      return
    this.starting = true
    try {
      const { record } = await import('rrweb')
      this.stopFn = record({
        emit: (event, isCheckout) => {
          // 首个事件或 checkout 事件开启新 segment（首个事件即初始完整快照）
          if (isCheckout || this.segments.length === 0)
            this.segments.push([])
          this.segments[this.segments.length - 1].push(event as RrwebEvent)
          while (this.segments.length > MAX_SEGMENTS)
            this.segments.shift()
        },
        // 快照间隔 = bufferSeconds/2，配合保留 2 个 segment 实现环形覆盖
        checkoutEveryNms: Math.max((this.opts.bufferSeconds ?? DEFAULTS.bufferSeconds) * 500, 10_000),
        // 隐私默认：输入值全脱敏；.rr-mask 脱敏文本、.rr-block 整块打码（均可按需加到业务元素上）
        maskAllInputs: true,
        maskTextClass: this.opts.maskTextClass ?? 'rr-mask',
        blockClass: 'rr-block',
        sampling: { mousemove: 50, scroll: 150, input: 'last' },
      }) ?? null
    }
    catch (err) {
      console.warn('monitor: rrweb 加载失败，回放不可用（错误上报不受影响）', err)
    }
  }

  /** 出错时由 Monitor.send 调用：命中触发条件且限流通过 → 同步返回 replayId，异步上传 */
  captureIfTriggered(data: MonitorTypeLog): string | undefined {
    if (!this.isTrigger(data))
      return undefined

    const now = Date.now()
    if (now - this.lastUploadAt < (this.opts.minUploadIntervalMs ?? DEFAULTS.minUploadIntervalMs))
      return undefined
    if (this.uploadCount >= (this.opts.maxUploadsPerSession ?? DEFAULTS.maxUploadsPerSession))
      return undefined

    const all: RrwebEvent[] = ([] as RrwebEvent[]).concat(...this.segments)
    if (all.length === 0)
      return undefined

    const replayId = randomId()
    this.lastUploadAt = now
    this.uploadCount++

    // 体积超限只保留最新 segment（自带完整快照，仍可播放）
    const maxBytes = this.opts.maxReplayBytes ?? DEFAULTS.maxReplayBytes
    const events = this.segments.length > 1 && JSON.stringify(all).length > maxBytes
      ? [...this.segments[this.segments.length - 1]]
      : all

    void this.compressAndUpload(replayId, events)
    return replayId
  }

  stop(): void {
    this.stopFn?.()
    this.stopFn = null
  }

  /** error / unhandledrejection 触发；request 失败按配置开启（batchXHR 内均为失败请求） */
  private isTrigger(data: MonitorTypeLog): boolean {
    if (data.type === 'error')
      return true
    if (!this.opts.captureRequest)
      return false
    return data.type === 'xhr' || data.type === 'fetch' || data.type === 'batchXHR'
  }

  private async compressAndUpload(replayId: string, events: RrwebEvent[]): Promise<void> {
    try {
      const json = JSON.stringify(events)
      const { deflate } = await import('pako')
      await uploadReplay(this.opts.replayEndpoint, this.opts.projectKey, {
        replayId,
        format: 'rrweb@2',
        codec: 'deflate-base64',
        size: json.length,
        durationMs: events.length > 1
          ? events[events.length - 1].timestamp - events[0].timestamp
          : 0,
        occurredAt: new Date().toISOString(),
        data: toBase64(deflate(json)),
      })
    }
    catch {
      // 回放是可丢数据：失败静默，不重试、不进队列
    }
  }
}

/** Uint8Array → base64（分块拼接避免 btoa 单次参数超限） */
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK)
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(binary)
}
