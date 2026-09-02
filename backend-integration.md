# Monitor × 异常平台（exception 模块）对接文档

> 面向**后台前端**：`@qiu_jun/monitor` 采集的数据如何通过 main-server **`/api/exception/*`** 接口查询与展示。
>
> - 客户端接入：[docs.md](./docs.md)
> - 后端模块总览：main-server `packages/main-server/src/modules/exception/docs.md`
> - 后台页面实现指南：main-server `packages/main-server/src/modules/exception/admin-ui.md`

---

## 0. 全局约定

| 项 | 说明 |
|---|---|
| 路由前缀 | `/api/exception/`（`GLOBAL_PREFIX` 默认 `/api`） |
| 上报接口 | `POST /api/exception/report`，**免登录**，Header `X-Project-Key` |
| 管理接口 | 需 JWT Bearer，权限见各接口 |
| 响应格式 | `{ code: 0, data, message }`；`code !== 0` 为业务错误 |
| 分页请求 | `page`（≥1）+ `pageSize`（1–100） |
| 分页响应 | `data: { items: [], meta: { itemCount, totalItems, itemsPerPage, totalPages, currentPage } }` |

**Monitor 与 exception 的关系**：Monitor 是唯一 C 端采集 SDK；数据全部走 `POST /exception/report`，由 processor 分流到 `exc_issue`/`exc_event`（异常）或 `exc_perf_event`（性能）。后台**没有** monitor 专用接口，统一用 exception 模块 API，按 `projectId` 过滤 Monitor 对应项目即可。

---

## 1. 端到端数据流

```
Monitor SDK（H5/Web）
  │ POST /api/exception/report
  │ Header: X-Project-Key: {projectKey}
  │ Body: { events: ReportEventDto[] }  （1–50 条/次）
  │ 攒批默认：20 条 / 30s
  ▼
ReportController → 采样（项目 sampleRate）→ Bull 队列 exception:report
  ▼
ReportProcessor 按 type 分流
  ├─ error | unhandledrejection | resource | request | custom
  │     → exc_issue（指纹聚合）+ exc_event
  │     → 可触发告警（alert 模块）
  └─ paint | timing | longTask
        → exc_perf_event（直落，不参与 issue/告警）
  ▼
后台查询（本节第 3–5 章 exception 接口）
```

---

## 2. 上报接口（Monitor 写入）

### POST `/api/exception/report`

| 项 | 值 |
|---|---|
| 鉴权 | Header **`X-Project-Key`**（后台「接入项目」的 `projectKey`） |
| 限流 | 120 次/分钟/IP |
| 请求体 | `{ events: ReportEventDto[] }`，**1–50 条** |
| 成功响应 | `{ accepted: number }`（采样后实际入队数，可能为 0） |
| 错误 | 400 缺少 Key / DTO 校验失败；403 Key 无效或项目已停用 |

#### ReportEventDto（与 Monitor 映射）

| 字段 | 必填 | 限制 | Monitor 填充 |
|---|---|---|---|
| `type` | ✅ | 见下表 | `toExcEvent.ts` 映射 |
| `message` | ✅ | ≤2000 | 错误摘要 / `paint metrics` / `long task Nms` |
| `level` | ❌ | FATAL/ERROR/WARN/INFO | 异常 `ERROR`；性能 `INFO`；longTask≥100ms → `WARN` |
| `stack` | ❌ | ≤16000 | JS/Promise 错误时有 |
| `page` | ❌ | ≤500 | `pathname + search` |
| `userId` | ❌ | ≤64 | 初始化 `userId` |
| `release` | ❌ | ≤100 | 初始化 `release` |
| `environment` | ❌ | ≤50 | 初始化 `environment` |
| `sdkVersion` | ❌ | ≤20 | Monitor 未传则空 |
| `occurredAt` | ❌ | ISO8601 | 客户端时间，缺省服务端时间 |
| `device` | ❌ | JSON 对象 | 设备信息 + 性能指标，见 §2.2 |

#### type 枚举与 Monitor 采集对照

| `type` | 分类 | Monitor 采集 | 落库 |
|---|---|---|---|
| `error` | 异常 | JS 运行时错误 | `exc_issue` + `exc_event` |
| `unhandledrejection` | 异常 | Promise 未捕获 | 同上 |
| `resource` | 异常 | 静态资源加载失败 | 同上 |
| `request` | 异常 | XHR/Fetch 失败 | 同上 |
| `custom` | 异常 | `monitor.capture()` 手动上报 | 同上 |
| `paint` | 性能 | FP/FCP/FMP/LCP | `exc_perf_event` |
| `timing` | 性能 | DOMContentLoaded / load | `exc_perf_event` |
| `longTask` | 性能 | 长任务 | `exc_perf_event` |

#### §2.2 Monitor 写入的 `device` 字段

**公共**（异常/性能均有）：`title`, `url`, `browser`, `os`, `deviceInfo`, `userAgent`

**异常扩展**：

| Monitor 场景 | device 关键字段 |
|---|---|
| JS / Promise | `selector`, `filename`, `position`, `errorType`, `isWhiteScreen` |
| 资源失败 | `tagName`, `selector`, `errorType` |
| 接口失败 | `durationMs`, `msg` |

**性能指标**（统计 API 用 `JSON_EXTRACT(device, '$.{metric}')` 聚合）：

| type | device 字段 | 默认 metric |
|---|---|---|
| `paint` | `FP`, `FCP`, `FMP`, `LCP` | `LCP`, `FCP` |
| `timing` | `DOMContentLoadedTime`, `loadTime` | `loadTime` |
| `longTask` | `startTime`, `duration`, `selector`, `eventType` | `duration` |

---

## 3. exception 管理接口全览

> 以下路径均相对于 `/api/exception/`。Monitor 对接主要用 **projects**、**issues**、**stats**、**perf** 四组。

### 3.1 接入项目 `projects`（Monitor 项目配置）

| 方法 | 路径 | 权限 | Monitor 用途 |
|---|---|---|---|
| GET | `/projects` | `exception:project:list` | 项目下拉数据源；筛 `platform=h5\|web` |
| POST | `/projects` | `exception:project:add` | 新建 Monitor 项目，返回 `projectKey` |
| GET | `/projects/:id` | `exception:project:read` | 项目详情 |
| PUT | `/projects/:id` | `exception:project:update` | 改名称/采样率/备注 |
| DELETE | `/projects/:id` | `exception:project:delete` | 级联删问题+事件+性能 |
| PUT | `/projects/:id/toggle` | `exception:project:update` | 启停上报（停用后 Monitor 403） |
| PUT | `/projects/:id/reset-key` | `exception:project:update` | 重置 Key，旧 Key 立即失效 |

**创建 Monitor 项目示例**：

```http
POST /api/exception/projects
Authorization: Bearer {token}
Content-Type: application/json

{
  "name": "商城 H5",
  "platform": "h5",
  "sampleRate": 100,
  "remark": "Monitor SDK 接入"
}
```

响应 `data.projectKey` → 填入 Monitor 初始化参数。

**ProjectEntity 字段**：`id`, `name`, `projectKey`, `platform`(weapp|h5|web|node), `enabled`, `sampleRate`(0–100), `remark`, `createdAt`

---

### 3.2 异常问题 `issues`（Monitor 异常类数据展示）

| 方法 | 路径 | 权限 | Monitor 用途 |
|---|---|---|---|
| GET | `/issues` | `exception:issue:list` | 问题列表（Monitor 四类异常 + custom） |
| GET | `/issues/:id` | `exception:issue:read` | 问题详情 |
| PUT | `/issues/:id/status` | `exception:issue:update` | 状态流转 |
| DELETE | `/issues/:id` | `exception:issue:delete` | 删除问题及全部事件 |
| GET | `/issues/:id/events` | `exception:issue:read` | 该问题下原始事件分页 |

**GET `/issues` 查询参数**：

| 参数 | 说明 | Monitor 场景 |
|---|---|---|
| `projectId` | 接入项目 id | **必选**（选定 Monitor 项目） |
| `type` | error / unhandledrejection / resource / request / custom | 按 Monitor 异常类型筛选 |
| `status` | UNRESOLVED / RESOLVED / IGNORED | 处理状态 |
| `level` | FATAL / ERROR / WARN / INFO | 级别 |
| `keyword` | 标题模糊 | 搜错误信息 |
| `page`, `pageSize` | 分页 | 默认 page=1, pageSize=10 |

**IssueEntity 字段**：`id`, `projectId`, `title`, `type`, `level`, `status`, `count`, `userCount`, `firstSeenAt`, `lastSeenAt`, `resolvedAt`, `sampleEventId`, `release`, `environment`, `project: { id, name, platform }`

**EventEntity 字段**（`/issues/:id/events`）：`message`, `stack`, `page`, `userId`, `device`, `release`, `environment`, `sdkVersion`, `occurredAt`

**Monitor type → 列表筛选**：

| Monitor 采集 | issue.type | message 示例 |
|---|---|---|
| JS 错误 | `error` | `Cannot read properties of undefined` |
| Promise | `unhandledrejection` | 同上 |
| 资源失败 | `resource` | `Resource failed: https://...` |
| XHR/Fetch | `request` | `Request failed [500]: GET /api/user` |

**状态流转**：

```http
PUT /api/exception/issues/{id}/status
{ "status": "RESOLVED" }   // UNRESOLVED | RESOLVED | IGNORED
```

> 已 RESOLVED 的问题若 Monitor 再次上报同类异常，processor 会自动回流 UNRESOLVED。

---

### 3.3 统计 `stats`（Monitor 异常 + 性能概览/趋势）

| 方法 | 路径 | 权限 | Monitor 数据 |
|---|---|---|---|
| GET | `/stats/overview` | `exception:stats:read` | 异常概览 + `todayPerfEvents` |
| GET | `/stats/trend` | `exception:stats:read` | 异常事件/新增问题 日趋势 |
| GET | `/stats/perf/overview` | `exception:stats:read` | 性能概览（LCP/FCP/longTask） |
| GET | `/stats/perf/trend` | `exception:stats:read` | 性能指标日趋势 |
| GET | `/stats/perf/pages` | `exception:stats:read` | 按 page 聚合慢页面排名 |

#### GET `/stats/overview?projectId={id}`

```json
{
  "unresolved": 12,
  "todayIssues": 3,
  "todayEvents": 156,
  "total": 89,
  "todayPerfEvents": 420
}
```

| 字段 | 数据来源 | Monitor 对应 |
|---|---|---|
| `unresolved` | exc_issue status=UNRESOLVED | 未处理 JS/资源/接口等问题 |
| `todayIssues` | 今日 firstSeenAt 新问题 | 今日新指纹 |
| `todayEvents` | exc_event 今日计数 | **不含** paint/timing/longTask |
| `total` | exc_issue 累计 | — |
| `todayPerfEvents` | exc_perf_event 今日计数 | paint + timing + longTask |

#### GET `/stats/trend?projectId={id}&days=7`

```json
[{ "date": "2026-09-01", "events": 120, "newIssues": 2 }]
```

- `events`：当日 exc_event 数（Monitor 异常类）
- `newIssues`：当日新增 exc_issue 数
- `days`：1–90，默认 7，缺日补零

#### GET `/stats/perf/overview?projectId={id}`

```json
{
  "todayPerfEvents": 420,
  "todayPaintSamples": 380,
  "avgLcp": 2340.5,
  "avgFcp": 890.2,
  "todayLongTasks": 15
}
```

| 字段 | Monitor 来源 |
|---|---|
| `avgLcp` / `avgFcp` | type=paint，device.LCP / device.FCP 今日均值 |
| `todayLongTasks` | type=longTask 今日条数 |
| `todayPaintSamples` | type=paint 今日条数 |

#### GET `/stats/perf/trend?projectId={id}&type=paint&metric=LCP&days=7`

| 参数 | 说明 | Monitor 推荐值 |
|---|---|---|
| `type` | paint / timing / longTask | 三类性能 |
| `metric` | device JSON 字段名 | paint→LCP/FCP/FP/FMP；timing→loadTime/DOMContentLoadedTime；longTask→duration |
| `days` | 1–90 | 7 / 14 / 30 |

```json
[{ "date": "2026-09-01", "avgValue": 2100.3, "samples": 52 }]
```

#### GET `/stats/perf/pages?projectId={id}&type=paint&metric=LCP&limit=20`

```json
[{ "page": "/home", "avgValue": 3200.1, "samples": 120 }]
```

- `page` = Monitor 上报的 `pathname + search`
- `limit`：1–50，默认 20

---

### 3.4 性能原始事件 `perf`（Monitor 性能排查）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/perf/events` | `exception:stats:read` | exc_perf_event 分页，单条排查 |

**GET `/perf/events` 查询参数**：`projectId?`, `type?`(paint|timing|longTask), `page`, `pageSize`

**PerfEventEntity 字段**：`type`, `level`, `message`, `page`, `userId`, `device`, `release`, `environment`, `sdkVersion`, `occurredAt`

---

## 4. Monitor 展示场景 → exception 接口对照

| 后台 UI 场景 | 调用接口 | 关键参数 |
|---|---|---|
| 项目下拉 / 创建 Monitor 项目 | GET/POST `/exception/projects` | `platform=h5\|web` |
| 复制 projectKey 给前端 | GET `/exception/projects/:id` 或创建响应 | `projectKey` |
| 调整采样率 | PUT `/exception/projects/:id` | `{ sampleRate: 0-100 }` |
| 概览卡片：未处理问题 | GET `/exception/stats/overview` | `projectId` → `unresolved` |
| 概览卡片：今日异常 | 同上 | `todayEvents` |
| 概览卡片：今日 LCP | GET `/exception/stats/perf/overview` | `avgLcp` |
| 概览卡片：今日 longTask | 同上 | `todayLongTasks` |
| 异常趋势双折线 | GET `/exception/stats/trend` | `days=7` |
| LCP 7 日趋势图 | GET `/exception/stats/perf/trend` | `type=paint&metric=LCP&days=7` |
| 页面 load 趋势 | GET `/exception/stats/perf/trend` | `type=timing&metric=loadTime` |
| 慢页面 Top N | GET `/exception/stats/perf/pages` | `type=paint&metric=LCP&limit=20` |
| 异常问题表格 | GET `/exception/issues` | `projectId` + type/status 筛选 |
| 问题详情 + stack/device | GET `/issues/:id` + GET `/issues/:id/events` | 事件行展开 stack、device |
| 性能单条排查 | GET `/exception/perf/events` | `type=paint` 等 |
| 标记已解决 | PUT `/exception/issues/:id/status` | `{ status: "RESOLVED" }` |

---

## 5. 建议 API 封装（`src/api/exception.ts`）

```ts
// 与 admin-ui.md 对齐，Monitor 视图在此基础上增加 perf 方法

/** 接入项目 */
export const listProjects = (params) => request.get('/exception/projects', { params })
export const createProject = (data) => request.post('/exception/projects', data)

/** 异常概览 + 问题 */
export const getStatsOverview = (projectId?: number) =>
  request.get('/exception/stats/overview', { params: { projectId } })
export const getStatsTrend = (projectId?: number, days = 7) =>
  request.get('/exception/stats/trend', { params: { projectId, days } })
export const listIssues = (params) => request.get('/exception/issues', { params })
export const getIssue = (id: number) => request.get(`/exception/issues/${id}`)
export const listIssueEvents = (id: number, page = 1, pageSize = 10) =>
  request.get(`/exception/issues/${id}/events`, { params: { page, pageSize } })
export const updateIssueStatus = (id: number, status: string) =>
  request.put(`/exception/issues/${id}/status`, { status })

/** Monitor 性能（exception stats/perf + perf/events） */
export const getPerfOverview = (projectId?: number) =>
  request.get('/exception/stats/perf/overview', { params: { projectId } })
export const getPerfTrend = (params: { projectId?: number; type: string; metric?: string; days?: number }) =>
  request.get('/exception/stats/perf/trend', { params })
export const getPerfPages = (params: { projectId?: number; type: string; metric?: string; limit?: number }) =>
  request.get('/exception/stats/perf/pages', { params })
export const listPerfEvents = (params) => request.get('/exception/perf/events', { params })
```

**前端常量**（与 admin-ui.md 一致，Monitor 页可追加）：

```ts
export const ISSUE_TYPE = {
  error: 'JS 错误',
  unhandledrejection: 'Promise 拒绝',
  resource: '资源加载',
  request: '接口异常',
  custom: '自定义',
}
export const PERF_TYPE = { paint: '绘制指标', timing: '加载时序', longTask: '长任务' }
export const PERF_METRIC = {
  paint: ['LCP', 'FCP', 'FP', 'FMP'],
  timing: ['loadTime', 'DOMContentLoadedTime'],
  longTask: ['duration'],
}
```

---

## 6. 建议页面布局（Monitor 监控视图）

在「异常监控」下，选定 `platform=h5|web` 项目后：

```
┌─ 项目下拉（GET /exception/projects?platform=h5&pageSize=100）────────────┐
├─ 统计卡片 ────────────────────────────────────────────────────────────────┤
│ GET /stats/overview        → unresolved | todayEvents | total              │
│ GET /stats/perf/overview   → avgLcp | avgFcp | todayLongTasks             │
├─ Tab ─────────────────────────────────────────────────────────────────────┤
│ [异常] GET /issues + GET /issues/:id/events（stack/device 展开）           │
│ [异常趋势] GET /stats/trend?days=7                                         │
│ [性能趋势] GET /stats/perf/trend?type=paint&metric=LCP                    │
│ [慢页面] GET /stats/perf/pages?type=paint&metric=LCP&limit=20             │
│ [性能明细] GET /perf/events?type=paint                                    │
└───────────────────────────────────────────────────────────────────────────┘
```

**权限**：`exception:project:list`（项目）、`exception:issue:list/read/update`（异常）、`exception:stats:read`（统计+性能）。

---

## 7. 上报 / 查询联调示例

### 7.1 Monitor 上报（C 端）

```http
POST /api/exception/report
X-Project-Key: abc123...
Content-Type: application/json

{
  "events": [{
    "type": "error",
    "level": "ERROR",
    "message": "Cannot read properties of undefined",
    "stack": "TypeError: ...",
    "page": "/dashboard",
    "userId": "10001",
    "release": "1.2.0",
    "environment": "production",
    "device": { "browser": "Chrome", "os": "Windows", "errorType": "jsError" }
  }]
}
```

→ 响应 `{ "accepted": 1 }` → 后台 `GET /exception/issues?projectId=1&type=error` 可见新问题。

### 7.2 性能 paint 上报 → 统计查询

上报 `type=paint`, `device.LCP=2100` 后：

```http
GET /api/exception/stats/perf/overview?projectId=1
GET /api/exception/stats/perf/trend?projectId=1&type=paint&metric=LCP&days=7
GET /api/exception/stats/perf/pages?projectId=1&type=paint&metric=LCP&limit=20
```

---

## 8. 注意事项

|  topic | 说明 |
|---|---|
| 采样 | 仅项目 `sampleRate` 控制；`accepted` 可能小于上报条数 |
| 性能 vs 异常 | paint/timing/longTask **只**在 perf 接口查；勿在 `/issues` 查 |
| 性能 vs 告警 | 性能事件不触发 NEW_ISSUE / COUNT_THRESHOLD 等告警 |
| userId | 用于 issue `userCount`（日窗口 Redis 去重），**不是 UV/PV** |
| occurredAt | 客户端时间；issue 列表按 `lastSeenAt` 倒序 |
| stack | ≤16KB，展示需限高滚动 |
| device | 任意 JSON；Monitor 字段见 §2.2 |
| 指标缺失 | 用户快速关页时 LCP 等可能为 null，图表需处理 |

---

## 9. 联调检查清单

- [ ] `POST /exception/projects` 创建 h5/web 项目，Monitor 配置返回的 `projectKey`
- [ ] `POST /exception/report` 返回 `accepted > 0`
- [ ] `GET /exception/issues?projectId=&type=error` 能查到 JS 错误
- [ ] `GET /exception/stats/overview` 的 `todayEvents` 递增
- [ ] 页面停留后 `GET /exception/stats/perf/overview` 的 `todayPerfEvents` 递增
- [ ] `GET /exception/stats/perf/trend?type=paint&metric=LCP` 有数据
- [ ] `GET /exception/issues/:id/events` 可看到 `device.browser`、`stack`
