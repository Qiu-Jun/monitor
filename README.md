# @qiu_jun/monitors(自用)

前端监控 SDK：采集异常 + 性能指标，上报至异常分析平台（main-server `/api/exception/report`）。

内置 reporter（与 main-server `exception-sdk` 协议对齐），**无外部 SDK 依赖**，可独立打包发布 npm。

## 安装

```bash
pnpm add @qiu_jun/monitors
```

## 按需引入（子路径导出）

与异常平台 SDK 相同风格，按场景引入：

```ts
// 完整 H5 监控（采集 + 上报）
import { Monitor } from '@qiu_jun/monitors'
import { Monitor } from '@qiu_jun/monitors/h5'

// 仅 reporter（自定义采集，复用上报协议）
import { createReporter, makeH5Transport } from '@qiu_jun/monitors/reporter'
```

## 快速接入

```ts
import { Monitor } from '@qiu_jun/monitors'

const monitor = new Monitor({
  endpoint: 'https://your-host/api/exception/report',
  projectKey: 'your-project-key',
  release: '1.0.0',  // 客户端版本号 选填
  environment: 'production', 
  userId: 'optional-user-id', // 选填
})
```

配置 `endpoint` + `projectKey` 后，所有采集数据自动转为异常平台格式并批量上报。

**采样率**：仅在后台「接入项目」里配置 `sampleRate`，客户端无需传。

完整参数说明见 [docs.md](./docs.md)。

## 自动采集

| 采集项 | 异常平台 type | 说明 |
|---|---|---|
| JS 错误 | `error` | 含选择器、白屏检测 |
| Promise 未捕获 | `unhandledrejection` | |
| 资源加载失败 | `resource` | img/script/css 等 |
| XHR 失败/超时 | `request` | message 格式 `Request failed [500]: GET /api/...` |
| FP/FCP/FMP/LCP | `paint` | 指标在 `device` |
| DOMContentLoaded/load | `timing` | |
| 长任务 | `longTask` | duration ≥ 100ms 时 level=WARN |

## 手动上报

```ts
monitor.capture({
  type: 'custom',
  level: 'WARN',
  message: '支付回调超时',
})
```

## 构建发布

```bash
pnpm build   # tsc → dist/*.js + *.d.ts，vite → dist/monitor.umd.js
npm publish
```

产物：

| 路径 | 说明 |
|---|---|
| `@qiu_jun/monitor` | `dist/index.js` + `dist/index.d.ts` |
| `@qiu_jun/monitor/h5` | `dist/h5.js` + `dist/h5.d.ts` |
| `@qiu_jun/monitor/reporter` | `dist/reporter.js` + `dist/reporter.d.ts` |
| UMD | `dist/monitor.umd.js`（`require` 条件导出） |

## 与 main-server 的关系

- 上报协议对齐 `packages/main-server/src/modules/exception/report/`
- 异常类 → `exc_issue` + `exc_event`
- 性能类（paint/timing/longTask）→ `exc_perf_event`
- reporter 源码位于 `src/exception/`，与 exception-sdk 逻辑等价，便于独立发版
- **后台对接与展示**：[backend-integration.md](./backend-integration.md)（与 exception 模块 `/api/exception/*` 接口一一对照）
