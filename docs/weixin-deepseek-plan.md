# 微信群投顾：DeepSeek 接入与 Hermes 退役技术方案

> 状态：已定稿 · 日期：2026-06-25 · 工程根：`~/nimbus-os/nimbus/`

---

## 1. 背景与动机

### 1.1 现状

主人有一个微信群投顾机器人。消息链路：

```
微信群 → wx-cli → wechat-io (~/wechat-io) → Hermes (~/.hermes) → 回复
```

`wechat-io` 是纯 I/O 网关（Python，`~/wechat-io`），负责感知群消息、执行本地安全策略、调 AI 接口。它通过 OpenAI 兼容口 `POST http://localhost:8642/v1/chat/completions` 调 Hermes，并附带头 `X-Hermes-Session-Id: wechat-{chat_id}` 做群级会话隔离。

Hermes（`~/.hermes`）是一个重型通用 agent。实测数据：

- 单次回复上下文约 30 万 token
- 缓存命中率仅 ~58%
- 单会话已积累 459 条消息
- 日花费约 ¥7
- 用量统计有 bug：`deepseek-v4-flash` 在 `~/.hermes/agent/usage_pricing.py` 价格表里无条目，所有 flash 调用记 $0，实际花费不可见

此外，nimbus 已有 `WeixinChannel`（`src/channels/weixin/index.ts`）和 `WEIXIN_TWOWAY_ENABLED` 开关（`src/config.ts`），但当前走的是 weixin-hub/iLink 出站推送路径，**尚未接通 wechat-io 的入站回复链路**。

### 1.2 目标

1. 在 **nimbus 同一代码库内**（不 fork，不拉强分支）把 DeepSeek 做成一个**带成本控制的独立模块**，用同一套 Cici 代码起第二个进程实例驱动微信群回复。
2. 新实例**与 Cici 共存互不影响**：独立 launchd 服务、独立 SQLite 会话库、独立环境变量。
3. 为新实例补齐**浏览器能力**（nimbus 当前无任何浏览器工具，是净新增）。
4. 完成上述后**删除 Hermes**，先搬家凭证、解绑依赖，再删库。

### 1.3 非目标

- 不改动 `wechat-io`（零改动，继续当 I/O 网关）
- 不把 WhatsApp / Telegram 接入 nimbus
- 不优化 Cici 现有 Discord 实例（保持原样运行）
- 不重写现有 `WeixinChannel`（在其基础上扩展入站路径）

> **入站路径决策（已定）：Phase 1 走 `wechat-io`（个人微信，当前在产路径），只换大脑（Hermes→DeepSeek 模块），不同时切 iLink 双向入站。** 理由：wechat-io 是已验证的在产入站链路，整套方案建立在「wechat-io 零改动、只换后端」之上；同时切 iLink 会叠加「换账号身份 + 换协议」的第二个大迁移，风险翻倍。iLink 双向入站（`WEIXIN_TWOWAY_ENABLED`）作为**以后单独评估的「去脆弱化」迁移**（个人号封号风险 / macOS+AppleScript 脆弱性真成问题时再做），不在本方案范围。`channels/weixin/`（iLink 出站推送）继续保留为出站车道。

---

## 2. 可行性验证（实测结论）

以下均为实跑结果，非推测。

### 2.1 DeepSeek Anthropic 兼容口

DeepSeek 开放了 Anthropic Messages 兼容端点 `https://api.deepseek.com/anthropic`，接受标准 Anthropic 格式请求（`x-api-key` + `anthropic-version` header，`tools` 字段）。

实测返回：
- 标准 `tool_use` 内容块，`stop_reason: "tool_use"`
- `usage` 字段为 Anthropic 形状（`input_tokens` / `output_tokens` / `cache_read_input_tokens`）
- `model` 传 `deepseek-chat` 时，服务端落到 `deepseek-v4-flash`

### 2.2 Claude Agent SDK 直驱 DeepSeek

设置 `ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic`、`ANTHROPIC_API_KEY=<deepseek key>`、`options.model='deepseek-chat'` 后，在现有 `AgentRunnerImpl.run()` 流程中端到端跑通：

- `system/init` → 工具调用（Bash）→ 收工具结果 → 最终回答
- 结果：`subtype: "success"`, `is_error: false`
- 无需改动 SDK，改的只是进程环境变量和模型串

### 2.3 Prompt caching 有效

实测 `result.usage.cache_read_input_tokens` 有值。引擎那 ~16K 系统提示（CLAUDE.md + skill 描述前缀）可被缓存，这是控成本的核心杠杆。

### 2.4 已知限制

| 限制 | 影响 | 应对 |
|---|---|---|
| `models.ts` 的 `supportedModels()` 面向 Anthropic，对 DeepSeek 返回失败 | 无法动态解析模型别名 | 在 `models.ts` 加 provider 分支，`PROVIDER=deepseek` 时跳过 `supportedModels()` 直接返回固定串 |
| SDK 的 `WebSearch` / `WebFetch` 是 Anthropic 服务端工具 | DeepSeek 端点不支持 | 微信实例 `mcpAllow` 里去掉这两项，改走 tavily MCP 或 python fetch |
| Anthropic 专属参数 betas / fallbacks（服务端特性）未验证 | 可能报错 | 微信实例只用核心面，不依赖这些；`thinking` / `effort` 已实测可透传（见下） |

---

## 3. 架构与模块设计

### 3.1 全局拓扑

```
微信群 → wx-cli → wechat-io (~/wechat-io)
                    POST /v1/chat/completions
                    X-Hermes-Session-Id: wechat-{chat_id}
                         ↓
                 nimbus weixin 连接器 (src/connectors/weixin.ts)
                    解析 chatId → dispatcher → AgentRunnerImpl.run()
                         ↓
                 ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
                 ANTHROPIC_API_KEY=<deepseek key>
                 model=deepseek-chat
                         ↓
                 DeepSeek Anthropic 兼容口
                         ↓
                 回复文本 → wechat-io send_pipeline → WeChat
```

wechat-io 侧**零改动**：它只需把 `agent.openai_base_url` 改指到微信连接器的本地端口（如 `http://127.0.0.1:8770/v1`），其他配置照旧。

### 3.2 新增文件

所有新增在 nimbus 仓库内，不动现有文件（除 `models.ts` 一处 env-gated 分支）。

```
src/
├── core/
│   ├── provider.ts              # Provider 枚举 + 进程级配置注入
│   └── cost/
│       ├── meter.ts             # 每轮 result.usage 落库，按群/按天聚合
│       ├── budget.ts            # 日预算软告警 + 硬上限（超限降级或拒答）
│       ├── cache-policy.ts      # 冻结系统前缀、工具顺序确定化，提升缓存命中
│       └── context.ts           # 每群会话 token/轮数上限 + 超限压缩
└── connectors/
    └── weixin.ts                # OpenAI 兼容 /v1/chat/completions 入站 → dispatcher
```

现有文件只动 `src/core/models.ts`：加一处 env-gated 分支，`PROVIDER=deepseek` 时绕过 `supportedModels()` 调用，返回固定 `'deepseek-chat'` 串；`PROVIDER` 未设时走原来路径，**代码逻辑字节不变**。

### 3.3 `src/core/provider.ts`

定义 `Provider` 类型（`'claude' | 'deepseek'`）。`PROVIDER=deepseek` 时：

- 设置 `process.env.ANTHROPIC_BASE_URL = 'https://api.deepseek.com/anthropic'`
- 从进程环境读 `ANTHROPIC_API_KEY`（必须由 launchd plist 的 `EnvironmentVariables` 注入，不进全局 shell）
- `mcpAllow` 默认从 `MCP_DEFAULT_ALLOW`（当前值 `['tavily', 'alpaca']`）移除 WebSearch/WebFetch（Anthropic 服务端工具）

`PROVIDER` 未设或 `'claude'` 时，`provider.ts` 不做任何事，`models.ts` 的 `supportedModels()` 路径完全不受影响。

### 3.4 `src/core/models.ts` 改动位置

在现有 `refreshModels()` 函数顶部加 provider 检查：

```ts
// 仅改动这一处 —— provider 分支
if (process.env.PROVIDER === 'deepseek') {
  resolved.haiku = 'deepseek-chat'
  resolved.sonnet = 'deepseek-chat'
  resolved.opus = 'deepseek-v4-pro'  // 复杂分析按需升档
  lastRefresh = Date.now()
  return { ...resolved }
}
// 原有 supportedModels() 调用路径不动 ↓
```

`Tier` 类型、`modelFor()`、`pick()`、`lastRefreshTs()` 全部不动。

### 3.5 `src/connectors/weixin.ts`

这是 wechat-io 对话的入站适配器，暴露 OpenAI 兼容端点：

```
POST /v1/chat/completions
  接收 body.messages[-1].content 作为用户消息
  从 X-Hermes-Session-Id: wechat-{chatId} 提取 chatId
  → dispatcher.dispatch({ channel: 'weixin-ds', chatId, content, ... })
  → 返回 OpenAI 兼容格式 { choices[0].message.content: replyText }
```

注意与现有 `src/channels/weixin/index.ts`（Phase 2 双向 iLink 路径）的关系：`connectors/weixin.ts` 是**独立入站适配器**，对接 wechat-io 的 OpenAI 兼容调用；`channels/weixin/` 对接 weixin-hub 的 iLink 推送，两者路径不同、互不干扰。

### 3.6 成本控制模块（`src/core/cost/`）

六个杠杆，按降本幅度排序：

| 杠杆 | 模块 | 目标效果 |
|---|---|---|
| **精简 profile**（最大杠杆） | 微信实例 `CLAUDE.md` 精简版 | 只挂行情+搜索+脚本+浏览器四类工具；砍 Cici 全家桶（filings/options/ipo 等）；系统提示从数千行缩到数百行；直接减少每次输入 token |
| **缓存友好** | `cache-policy.ts` | 冻结系统提示前缀（不塞时间戳/UUID）；工具列表固定排序；目标缓存命中率 58%→90%（缓存读价格约为正常的 0.1×） |
| **上下文封顶** | `context.ts` | 每群会话设 token 上限（如 8 万）+ 轮数上限（如 50 轮）；超限触发压缩或清除，杜绝涨到 459 条 |
| **模型分档** | `provider.ts` + `models.ts` | 默认 `deepseek-chat`（= v4-flash，便宜）；复杂分析按需升 `deepseek-v4-pro` |
| **输出/工具瘦身** | `AgentRunnerImpl.run()` 调用侧 | `max_tokens` 收紧到微信群场景合理值；工具 schema 越少输入越省 |
| **计量+预算闸** | `meter.ts` + `budget.ts` | `result.usage` 每轮落库；按群/按天聚合；日上限告警/降级——同时修复 Hermes flash 不计费的问题 |

`meter.ts` 接入现有 `setUsageLogger` 机制（`agent.ts` 第 187-189 行）：用量记录路径不变，只需把 `db.logUsage()` 在微信实例场景下也接入 budget 校验。

---

## 4. 隔离设计（与 Cici 共存）

安全完全靠三点：新增不改写（DeepSeek 逻辑进新文件）+ 默认关的 env gate + 进程/状态分离。

### 4.1 碰撞点与隔离措施

| 碰撞点 | 风险 | 隔离措施 |
|---|---|---|
| `ANTHROPIC_BASE_URL` / `ANTHROPIC_API_KEY` 是进程级环境变量 | **头号风险**：如果泄漏进 Cici 的进程，Cici 会被指向 DeepSeek，Claude 订阅失效 | base_url / key **只写进微信实例的 launchd plist `EnvironmentVariables` 块**；绝不进全局 shell、`~/.zshrc`、`~/.env`、Cici 的 plist |
| SQLite 会话库 | session_id 串群 | 独立数据库文件（如 `data/weixin-ds.db`），不与 Cici 的 `data/state.db` 共用 |
| `cwd` / workspace | 生成图表/中间文件串发 | 独立 cwd（如 `~/nimbus-os/nimbus/workspace-weixin/`），outbox 目录独立 |
| MCP 服务配置 | 工具混用 | 微信实例 `mcpAllow` 白名单只含 `['tavily']`，去掉 futu/longbridge/alpaca 等账户类工具 |
| 额度 | Claude 订阅额度被 DeepSeek 实例消耗 | 天然隔离：Cici = Claude 订阅（无 API key），微信实例 = DeepSeek key（独立账单） |
| `PROVIDER` 未设时的行为 | 改动影响 Cici | `PROVIDER` env 不存在时，`provider.ts` 和 `models.ts` 新增分支均不执行，Cici 进程行为**字节不变** |

### 4.2 launchd 服务

微信实例独立一个 launchd plist，如 `ai.nimbus.weixin-deepseek.plist`，结构参照现有 `com.nimbus.daemon`，但 `EnvironmentVariables` 块里额外注入：

```xml
<key>PROVIDER</key><string>deepseek</string>
<key>ANTHROPIC_API_KEY</key><string>sk-deepseek-...</string>
<key>WEIXIN_TWOWAY</key><string>1</string>
```

Cici 的 plist 不含上述任何 key。

### 4.3 部署检查清单

1. 改完 `models.ts` 后，先单独启动 Cici（不设 `PROVIDER`），确认 `stderr` 输出模型解析正常（`haiku=claude-haiku-4-6 sonnet=claude-sonnet-4-6`），再继续。
2. 微信实例启动后，确认 Cici 的 Discord 回复仍走 Claude 订阅（看 `data/state.db` 的 usage 表，model 列应为 `claude-*` 不含 `deepseek`）。

---

## 5. 浏览器能力

### 5.1 背景

nimbus 当前**无任何浏览器能力**（`MCP_DEFAULT_ALLOW` 仅 `['tavily', 'alpaca']`，无浏览器工具），这是从 Hermes 退役中唯一需要迁移的能力。本次做净新增，不优化成本。

### 5.2 选型

**主选：Playwright MCP（`@playwright/mcp`，微软官方）**，本地运行 + 真实 Chrome channel + 持久 user-data-dir + headed 模式。

理由：
- 渲染保真度最高，适合有 JS 渲染的页面（部分券商/研究平台）
- 持久 `user-data-dir` 带登录态，可访问付费墙数据（本地持久化，凭证不出机）
- 截图/PDF/多标签均支持
- MCP 原生协议，直接挂进 Agent SDK 的 `mcpServers`，Cici 和微信实例共用同一配置
- 不频繁使用，重配置成本可接受

备选 `chrome-devtools-mcp`（Google 官方）综合能力弱于 Playwright MCP，作为降级选项。

**安全提醒：带券商登录态的浏览不要交给任何第三方云浏览器服务**（Browserbase / Steel 等）。凭证只在本机 `user-data-dir`。

**反爬补充**：若碰到需要反检测的匿名公开站，再单独评估加 stealth 插件（`playwright-extra` + stealth，或参考 Hermes 的 camoufox 方案）。**绝不在带登录态的 profile 上挂 stealth**，两套场景隔离。

### 5.3 接入方式

在 `secrets/mcp.json` 里增加 Playwright MCP 服务器条目，`agent.ts` 的 `loadAllMcpServers()` 会自动加载。Cici 和微信实例共用此配置；微信实例的 `mcpAllow` 按需加入 `'playwright'`。

---

## 6. Hermes 退役处置

**前置条件**：微信 DeepSeek 实例稳定运行至少一周后再删 Hermes。

### 6.1 资产清单与处置

| 资产 | 所在路径 | 处置 |
|---|---|---|
| 市场数据 MCP（akshare / baostock / yfinance） | `~/.hermes/mcp/` | **不迁移**——已是 nimbus 现成资产，解绑 Hermes 依赖，作为独立进程继续运行 |
| 微信/Discord/WhatsApp token | `~/.hermes/.env` | **搬家到 nimbus 自有 secret store（`secrets/`，gitignored）**；删库前必须完成 |
| ElevenLabs / FAL / Gemini / MiniMax / OpenRouter 等 AI key | `~/.hermes/.env` | 同上，搬家存档，暂不接桥 |
| iLink weixin 账号配置 | `~/.hermes/weixin/accounts/` | 搬家到 nimbus secret store；**weixin-hub 当前从 `~/.hermes/.env` 借 token，必须改指新路径**（否则删 Hermes 会搞坏 weixin-hub 的 token 读取） |
| WhatsApp / Telegram 凭证 | `~/.hermes/whatsapp/` 等 | 搬家存档，**只保留凭证，不接桥**（nimbus 不接这两个渠道） |
| Hermes 投研 skills | `~/.hermes/agent/skills/` | **丢弃**——nimbus 已有等效 skill |
| computer-use / Apple / email skills | `~/.hermes/` | **丢弃** |
| Hermes 会话历史 | `~/.hermes/state.db` | **备份**（`cp ~/.hermes/state.db ~/backup/hermes-state-$(date +%Y%m%d).db`），然后删 |

### 6.2 weixin-hub token 迁移（关键路径）

weixin-hub 的 `src/channels/weixin/hub.ts` 中 `loadHubToken()` 当前读 `~/.weixin-hub/api_token.txt`（hub 自身 token），但 weixin-hub 进程本身从 `~/.hermes/.env` 读 `WEIXIN_TOKEN`（iLink bot token）。删 Hermes 前必须：

1. 把 `~/.hermes/.env` 中的 `WEIXIN_TOKEN` / `WEIXIN_BASE_URL` / `WEIXIN_HOME_CHANNEL` 写入 weixin-hub 的 launchd plist `EnvironmentVariables`，或写到 nimbus `secrets/.env.weixin-hub`（weixin-hub 进程 source）。
2. 重启 weixin-hub，确认 `/health` 返回 `token_expired: false`，`POST /send` 正常。
3. 上述验证通过后，`~/.hermes/.env` 才可删除。

> ⚠️ **关键：token 不只是搬家，还要解决「过期后怎么刷新」。** 上面搬的是**静态 token 值**；但 iLink token 会过期（即 weixin-hub 现在偶发的 `-14 token expired`），当前是**靠 Hermes 的 iLink 扫码重登**重新拿 token。删掉 Hermes 后这个重登能力就没了——token 一过期，出站推送直接断且无法自助恢复。**删 Hermes 前必须先具备替代的重登/刷新路径**，二选一：
> - **(A) 抽取 Hermes 的 iLink 登录工具单独保留**（只留 `hermes ... iLink 扫码登录` 这一个能力的最小脚本，不留整个 agent）；或
> - **(B) 在 weixin-hub 里实现 iLink 重登流程**（扫码 → 写回 `WEIXIN_TOKEN`）。
>
> 在 (A) 或 (B) 跑通、并实测「token 过期 → 重登 → 恢复推送」闭环之前，**不得删除 Hermes**。

### 6.3 退役步骤

1. 搬家所有凭证到 nimbus `secrets/`（gitignored）
2. 改 weixin-hub token 来源（见 §6.2），验证正常
3. **建立 iLink token 重登/刷新替代路径（§6.2 的 A 或 B），实测「过期→重登→恢复推送」闭环跑通**——此步是删库的硬前置，未通过不得继续
4. 解绑市场数据 MCP（改为直接启动，不依赖 Hermes launchd）
5. 备份 `~/.hermes/state.db`
6. `launchctl bootout gui/$UID/com.hermes.daemon`（停服务）
7. `rm -rf ~/.hermes`（删库）

---

## 7. 落地顺序

### 第一步：计量与成本基础

新增 `src/core/provider.ts`、`src/core/cost/meter.ts`、`src/core/cost/budget.ts` 骨架。`src/core/models.ts` 加 env-gated 分支。此步不启动微信实例，只是把成本基础建好。

部署检查：改完 `models.ts` 后先确认 Cici 正常启动，`stderr` 日志模型解析无异常。

### 第二步：微信连接器 + 入站路由

新增 `src/connectors/weixin.ts`（OpenAI 兼容入站端点）；完善 `src/core/cost/cache-policy.ts` 和 `src/core/cost/context.ts`；微信实例 `mcpAllow` 去掉 WebSearch/WebFetch，加入 tavily。

`wechat-io` 侧改 `~/.wechat-io/config.yaml`：

```yaml
agent:
  openai_base_url: "http://127.0.0.1:8770/v1"
  openai_api_key: "nimbus-internal"
  model: "deepseek-chat"
```

### 第三步：挂 Playwright MCP

在 `secrets/mcp.json` 加 `@playwright/mcp` 条目，Cici 和微信实例均可用。验证：让 Cici 用浏览器抓一个需要 JS 渲染的页面，确认截图正常。

### 第四步：单群灰度

用一个测试群灰度：实测 DeepSeek 对 Cici 系统提示的指令遵循质量（尤其 `===DECISION===` 格式、trade-guard 红线、路由纪律）；观察每日花费曲线（目标 ¥7 → ¥1-2）。灰度期至少一周。

### 第五步：Hermes 退役

按 §6 流程执行。凭证搬家 → weixin-hub 改指 → 验证 → 解绑市场 MCP → 备份 state.db → 删除 Hermes。

---

## 8. 开放风险与待验证项

| 风险 | 类型 | 说明 |
|---|---|---|
| DeepSeek 对 Cici 系统提示的遵循质量 | **最大未知** | Cici 的 CLAUDE.md + skill 描述是为 Claude 调优的，DeepSeek 对其中隐式约定（`===DECISION===` 格式、路由纪律、御姐人设、trade-guard 红线）的遵循质量未知，必须灰度实测，不能假设等同 |
| 精简 profile 的质量/成本权衡点 | 设计决策 | 砍多少技能在质量与成本之间没有先验答案，需要实测后迭代 |
| DeepSeek Anthropic 口的稳定性 | 基础设施 | 该口是非官方兼容层，字段语义可能随 DeepSeek 版本变化，尤其 `cache_read_input_tokens` 的定义 |
| `thinking` / `effort` 参数 | ✅ 已实测可透传 | 实测：DeepSeek anthropic 口接受 `thinking:{type:'adaptive'}`、旧式 `enabled+budget_tokens`、`output_config.effort`，均不 400 且真返回 thinking 块；通过 Agent SDK 带 `thinking:adaptive` 端到端跑通工具调用。**`agent.ts` 现有透传无需改、微信实例无需屏蔽。**唯一保留：`effort` 被接受 ≠ DeepSeek 真按其调深度（可能吞掉），仅影响调优 |
| weixin-hub token 到期处理 | 运维 | weixin-hub 当前的 `-14` 错误（token expired）要靠 Hermes 的 iLink 重登，删 Hermes 后需要另起流程处理 token 刷新 |
| `WEIXIN_TWOWAY_ENABLED` 与 Hermes 并行 | 单消费者 | 切到 nimbus 微信连接器时，必须同时关 Hermes 的 weixin 轮询，否则 wechat-io 收到两个后端，会出现双回复或会话冲突 |

---

## 附录：相关文件速查

| 文件 | 说明 |
|---|---|
| `src/core/models.ts` | `Tier` 类型、`modelFor()`、`refreshModels()`——DeepSeek provider 分支加在这里 |
| `src/core/agent.ts` | `AgentRunnerImpl.run()`、`setUsageLogger()`——`UsageRecord` 落库钩子已存在 |
| `src/channels/weixin/index.ts` | 现有 `WeixinChannel`（iLink 出站推送路径，Phase 2 双向） |
| `src/channels/weixin/hub.ts` | `pushToHub()`，向 weixin-hub 推送 |
| `src/config.ts` | `WEIXIN_TWOWAY_ENABLED`、`WEIXIN_INBOUND_PORT`（8788）、`WEIXIN_HUB_URL`（8787）、`MCP_DEFAULT_ALLOW` |
| `~/wechat-io/src/wechat_io/router/dispatcher.py` | 调 OpenAI 兼容 API、传 `X-Hermes-Session-Id` |
| `~/nimbus-os/weixin-hub/run.py` | weixin-hub 主进程，token 来自 `~/.hermes/.env` |
| `~/.wechat-io/config.yaml` | wechat-io 的 `agent.openai_base_url`——切换后端只改这里 |
