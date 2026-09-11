# @qiu_jun/monitors 参数说明

> **后台对接展示**：Monitor 数据如何通过 exception 模块 `/api/exception/*` 接口查询与展示，见 [backend-integration.md](./backend-integration.md)（含完整 API 清单、字段映射、页面场景对照）。

## 子路径导出

| 子路径 | 入口文件 | 说明 |
|---|---|---|
| `@qiu_jun/monitors` | `dist/index.js` | 主入口：Monitor + reporter 类型 |
| `@qiu_jun/monitors/h5` | `dist/h5.js` | H5 监控（与主入口等价，按需引入） |
| `@qiu_jun/monitors/miniprogram` | `dist/miniprogram.js` | 小程序监控（`wx.request` 上报，独立于 H5） |
| `@qiu_jun/monitors/reporter` | `dist/reporter.js` | 仅上报器，无采集逻辑 |

`package.json` 的 `exports` 与 `@qiu_jun/exception` 对齐：子路径为 `types` + `default`；主入口额外提供 `import`（ESM `index.js`）与 `require`（UMD `monitor.umd.js`，CDN / script 标签引入）。

---

## Monitor 初始化参数（`IMonitorOptions`，H5）

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
| `page` | H5 为当前页 `pathname + search`；小程序为页面路由（如 `/pages/index/index`） |
| `device` | 浏览器、OS、选择器、性能指标等 JSON |
| `release` / `environment` / `userId` | 来自初始化配置 |

---

## 示例（H5）

```ts
import { Monitor } from '@qiu_jun/monitors'

const monitor = new Monitor({
  endpoint: 'https://your-host/api/exception/report',
  projectKey: 'your-project-key',
  release: '1.2.0',
  environment: import.meta.env.PROD ? 'production' : 'development',
  userId: getCurrentUserId(), // 登录后传入，可选
})
```

---

## 小程序监控（`createMiniProgramMonitor`）

微信小程序独立入口（注入了 `wx` 全局的 uni-app 等亦可直接用），采集基于 `wx.onError` / `wx.onUnhandledRejection`，上报基于 `wx.request`。

**必须在业务代码调用 `App()` / `Page()` / `Component()` 之前初始化**——SDK 会包装这三个全局构造函数来拦截生命周期。

```ts
// app.ts 最顶部
import { createMiniProgramMonitor } from '@qiu_jun/monitors/miniprogram'

const monitor = createMiniProgramMonitor({
  endpoint: 'https://your-host/api/exception/report',
  projectKey: 'your-project-key',
  userId: getCurrentUserId(), // 可选
})

App({ /* 业务代码照常写 */ })
```

### 参数（`MiniProgramMonitorOptions`，继承 `ExcSdkOptions`）

| 参数 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `endpoint` | ✅ | `string` | 上报地址，同 H5 |
| `projectKey` | ✅ | `string` | 同 H5，`X-Project-Key` 鉴权 |
| `userId` | ❌ | `string` | 用户标识 |
| `release` | ❌ | `string` | 默认取 `getAccountInfoSync` 的线上版本号 |
| `environment` | ❌ | `string` | 默认 `envVersion === 'release'` 时为 `production`，否则为 `envVersion` |
| `sampleRate` | ❌ | `number` | **客户端采样率**（%），默认 `100`；与 H5 不同，小程序在端上采样 |
| `maxBatch` | ❌ | `number` | 攒批条数阈值，默认 `20` |
| `flushInterval` | ❌ | `number` | 定时 flush 间隔（ms），默认 `30000` |
| `wxApi` | ❌ | `WxLike` | 默认取全局 `wx`；支付宝/百度等小程序传适配后的 API 对象 |
| `interceptLifecycle` | ❌ | `boolean` | 拦截 App/Page/Component 生命周期，默认 `true` |
| `interceptRequest` | ❌ | `boolean` | 拦截 wx.request 失败请求，默认 `true` |

### 自动采集范围

| 错误来源 | 事件 `type` | 说明 |
|---|---|---|
| `wx.onError` | `error` | 全局 JS 异常 |
| `wx.onUnhandledRejection` | `unhandledrejection` | 未处理的 Promise reject |
| `App`/`Page`/`Component` 生命周期抛错 | `error` | 带 `lifecycle`（如 `onLoad`）、页面路由、耗时；`async` 生命周期的 reject 也覆盖；与 `wx.onError` 收到的同条错误 5 秒窗口去重，不双报 |
| `Component` 的 `methods` 抛错 | `error` | 组件方法异常 |
| `wx.request` 失败（statusCode ≥ 400 或网络失败） | `request` | 带耗时；上报自身的 URL 跳过，防递归 |

### 手动上报与销毁

```ts
// 自定义事件
monitor.capture({
  type: 'custom',
  level: 'FATAL', // FATAL | ERROR | WARN | INFO
  message: '支付回调异常',
  stack: err.stack,
})

// 还原 App/Page/Component、wx.request、onError 等全部包装并 flush（测试场景用）
monitor.destroy()
```

### 上报机制与注意事项

- 事件进缓冲区，攒够 `maxBatch`（20）条或 `flushInterval`（30 秒）到期批量 `POST` JSON，缓冲上限 100 条
- **切后台自动 flush**（`wx.onAppHide`）；上报失败自动放回缓冲重试，仅 403（key 无效）丢弃
- **request 合法域名**：`endpoint` 域名需加入小程序后台「开发管理 → 开发设置 → 服务器域名 → request 合法域名」，否则真机上静默失败（开发者工具可勾选「不校验合法域名」调试）
- 其他小程序平台：传入适配 `wx.request` / `onError` / `onUnhandledRejection` 等接口的 `wxApi` 即可
