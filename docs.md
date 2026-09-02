# @qiu_jun/monitor 参数说明

> **后台对接展示**：Monitor 数据如何通过 exception 模块 `/api/exception/*` 接口查询与展示，见 [backend-integration.md](./backend-integration.md)（含完整 API 清单、字段映射、页面场景对照）。

## 子路径导出

| 子路径 | 入口文件 | 说明 |
|---|---|---|
| `@qiu_jun/monitor` | `dist/index.js` | 主入口：Monitor + reporter 类型 |
| `@qiu_jun/monitor/h5` | `dist/h5.js` | H5 监控（与主入口等价，按需引入） |
| `@qiu_jun/monitor/reporter` | `dist/reporter.js` | 仅上报器，无采集逻辑 |

`package.json` 的 `exports` 与 `@qiu_jun/exception` 对齐：`types` + `default`；主入口额外提供 `import`（CJS）与 `require`（UMD `monitor.umd.js`）。

---

## Monitor 初始化参数（`IMonitorOptions`）

配置 `endpoint` + `projectKey` 后，采集数据走异常平台上报协议（`POST /api/exception/report`）。

| 参数 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `endpoint` | ✅ | `string` | 上报地址，如 `https://your-host/api/exception/report`（`GLOBAL_PREFIX` 默认 `/api`） |
| `projectKey` | ✅ | `string` | 接入项目密钥，后台「异常监控 → 接入项目」创建后获得；请求头 `X-Project-Key` 鉴权 |
| `release` | ❌ | `string` | 客户端发版版本号，如 `1.2.0`；写入每条事件，便于按版本排查、对比 |
| `environment` | ❌ | `string` | 运行环境，如 `production` / `development` / `staging`；区分线上与测试数据 |
| `userId` | ❌ | `string` | 当前登录用户标识；用于事件上下文及 issue「影响用户数」统计，未登录可不传 |
| `maxBatch` | ❌ | `number` | reporter 缓冲条数上限，满则上报，默认 `20` |
| `flushInterval` | ❌ | `number` | reporter 定时 flush 间隔（ms），默认 `30000`（30 秒） |
| `maxQueueSize` | ❌ | `number` | XHR 失败请求队列上限，默认 `10` |
| `timeoutDuration` | ❌ | `number` | XHR 超时阈值（ms），默认 `60000`（1 分钟） |

**采样率不在客户端配置。** 在后台编辑接入项目的 `sampleRate`（0–100%）即可，服务端收到 batch 后按项目采样率过滤。

---

## 参数区别（常见疑问）

| 参数 | 回答的问题 | 与 projectKey 关系 |
|---|---|---|
| `projectKey` | 哪个接入项目 / App？ | 鉴权 + 数据归属，**必填** |
| `release` | 哪个客户端版本出的问题？ | 同一项目下不同版本共用同一 key |
| `environment` | 线上还是测试环境？ | 同上，建议 prod/test 用不同项目 key 更清晰 |
| `userId` | 哪个终端用户触发的？ | 可选，用于影响用户数统计 |
| 项目 `sampleRate`（后台） | 服务端收多少比例？ | 在项目配置里改，**客户端不传** |

---

## 上报事件字段（自动填充）

Monitor 将采集结果映射为异常平台 `ReportEventDto`，主要字段：

| 字段 | 说明 |
|---|---|
| `type` | `error` / `unhandledrejection` / `resource` / `request` / `paint` / `timing` / `longTask` / `custom` |
| `level` | 异常默认 `ERROR`，性能默认 `INFO`，长任务 ≥100ms 为 `WARN` |
| `message` | 错误摘要或指标描述 |
| `stack` | JS 堆栈（有则填） |
| `page` | 当前页 `pathname + search` |
| `device` | 浏览器、OS、选择器、性能指标等 JSON |
| `release` / `environment` / `userId` | 来自初始化配置 |

---

## 示例

```ts
import { Monitor } from '@qiu_jun/monitor'

const monitor = new Monitor({
  endpoint: 'https://your-host/api/exception/report',
  projectKey: 'your-project-key',
  release: '1.2.0',
  environment: import.meta.env.PROD ? 'production' : 'development',
  userId: getCurrentUserId(), // 登录后传入，可选
})
```
