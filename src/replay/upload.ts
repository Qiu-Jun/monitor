/** 回放上传 payload（契约见 backend-integration.md「回放接口」） */
export interface ReplayUploadPayload {
  replayId: string
  /** 事件流格式+版本，播放器按此选择解析方式 */
  format: 'rrweb@2'
  /** data 编码方式 */
  codec: 'deflate-base64'
  /** 解压前 JSON 字节数 */
  size: number
  /** 回放覆盖时长（首末事件时间差 ms） */
  durationMs: number
  occurredAt: string
  /** pako deflate + base64 后的 rrweb 事件流 */
  data: string
}

/** 回放独立上传：与事件上报共用鉴权头；失败由调用方静默处理（回放是可丢数据） */
export async function uploadReplay(replayEndpoint: string, projectKey: string, payload: ReplayUploadPayload): Promise<void> {
  const res = await fetch(replayEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Project-Key': projectKey },
    body: JSON.stringify(payload),
  })
  if (!res.ok)
    throw Object.assign(new Error(`monitor: 回放上传失败 ${res.status}`), { statusCode: res.status })
}
