# Nimbus — 技术方案与架构设计

> 基于 Claude Agent SDK 的常驻多渠道 AI agent（首发 Discord），复用 Claude Code 的订阅鉴权 / MCP / skill / 记忆 / 缓存 / 上下文压缩，并复用现有官方 Discord 插件的连接层（代理 + DM 修复 + 白名单）。Bot 人设仍是 Cici；项目/进程名为 Nimbus（与人设/渠道解耦，便于扩 TG）。
>
> 状态：Draft v1 · 日期：2026-06-07 · 首发渠道：Discord · 工程根：`~/nimbus/`

---

## 1. 背景与目标

### 1.1 痛点
Claude Code 自带的 channel 功能（`claude --channels plugin:discord`）把 Discord 事件 push 进**单一常驻 CC session**。局限：

- 单会话、无 per-chat 上下文隔离，多个 DM/频道混在一个 session 里。
- 无自定义路由、无审计、无业务编排（日报、定时任务）。
- 运行时脆弱（已踩坑：launchd 丢脚本、信任框 hang、单消费者 409、token 轮换 4004、升级覆盖代理层）。

### 1.2 目标
| # | 需求 | 实现方式 |
|---|---|---|
| 1 | Pro/Max **订阅**登录（非 API key 计费） | Agent SDK 默认读 `~/.claude` CLI 登录态；**不设 `ANTHROPIC_API_KEY`** |
| 2 | 复用 CC 的 **MCP / skill / 记忆** | `settingSources: ['user','project']` → 自动加载 `~/.claude` 的 MCP、skills、CLAUDE.md/memory |
| 3 | **自定义渠道常驻**（Discord 优先，TG 后续） | 自建事件循环 + 连接层（搬自官方插件 server.ts） |
| 4 | **缓存命中 / 上下文持久 / 压缩** 复用 | Agent SDK 即 CC 引擎本体：prompt caching + auto-compaction 内置；会话历史落 `~/.claude/projects/**/*.jsonl`，`resume` 直接吃 |
| 5 | **数据库** | SQLite：`chat_id → session_id` 映射 + 审计 + 定时任务状态 |

### 1.3 非目标
- 不对外人开放（订阅 ToS 仅限本人自用）。
- 不重写鉴权/代理/DM 修复（直接复用现有资产）。
- 不替代官方插件做 CC 内交互（官方插件仍可在纯交互会话用，但**不与本 bot 同时持 channel**，见 §9.2 单消费者铁律）。

---

## 2. 核心洞察

**Claude Agent SDK 就是 Claude Code 引擎本体的程序化入口。** 因此需求 1/2/4 几乎是"白嫖"——不需要重新实现缓存、压缩、skill、MCP、记忆，只要把 `settingSources` 打开即可。

真正需要自建的只有两块：
1. **Channel adapter（连接层 + 事件循环）** — 而连接层最难的部分（墙内 gateway-over-proxy + DM 修复 + 白名单）**已经在现有官方插件 server.ts 里调通**，直接搬。
2. **Session 路由 + DB** — per-chat 映射到可恢复 session。

> 语言决策：选 **TypeScript / bun**。理由：连接层（discord.js + `https-proxy-agent` + `undici ProxyAgent` + WebSocket override，墙内 gateway 走代理的命脉）已在 TS 里调通；discord.py 的 gateway-over-proxy 历史上很差。Agent SDK 的 TS 包（`@anthropic-ai/claude-agent-sdk`）加载 Python skill / MCP / memory 与 Python 版**完全一致**（skill 和 MCP 是子进程 / 配置，与宿主语言无关），故"复用 CC"一分不亏。

---

## 3. 总体架构

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          cici-discord-agent (bun 常驻进程)                       │
│                                                                                │
│   Discord Gateway                                                              │
│   (WSS, 经 Surge 6152 代理)                                                     │
│        │                                                                       │
│        ▼                                                                       │
│  ┌───────────────┐   搬自 server.ts §4-REUSE                                    │
│  │  连接层        │   · WebSocket override → 代理 (L67-94)                       │
│  │  Connection   │   · discord.js Client + intents + partials (L106-116)       │
│  │               │   · gateway 重连/心跳/re-login (L924-952)                    │
│  └───────┬───────┘                                                             │
│          │ messageCreate                                                       │
│          ▼                                                                     │
│  ┌───────────────┐   搬自 server.ts §4-REUSE                                    │
│  │ Access 网关    │   · gate(): allowlist/pairing/requireMention (L265-347)     │
│  │  (access.json) │   · 复用 ~/.claude/channels/discord/access.json (零改)      │
│  └───────┬───────┘                                                             │
│          │ deliver { chat_id, content, meta, attachments }                     │
│          ▼                                                                     │
│  ┌───────────────────────────────────────────────────┐  新建 §5.3            │
│  │  Session 路由 + 事件循环 (Dispatcher)               │                       │
│  │   1. DB 查 chat_id → sdk_session_id                 │◄──┐                  │
│  │   2. 构造 prompt（含 <channel> meta + 附件路径）     │   │ SQLite           │
│  │   3. 调 Agent SDK query({ resume })                 │   │ (§6)             │
│  │   4. 流式结果 → 出站发送                             │   │                  │
│  │   5. 回写新 session_id + 审计                        │───┘                  │
│  └───────┬───────────────────────────────────────────┘                       │
│          │ query(prompt, options)                                             │
│          ▼                                                                     │
│  ┌───────────────────────────────────────────────────┐  Agent SDK (=CC 引擎) │
│  │  @anthropic-ai/claude-agent-sdk                     │                       │
│  │   · 订阅 auth（读 ~/.claude，无 API key）            │  §5.4                │
│  │   · settingSources:['user','project']              │                       │
│  │       → MCP servers (alpaca/tavily/futu/...)        │                       │
│  │       → skills (~/.claude/skills, 50+)              │                       │
│  │       → CLAUDE.md + memory                          │                       │
│  │       → hooks: trade-guard.sh (AI 下单 deny)        │  §5.6 安全            │
│  │   · prompt caching + auto-compaction（内置）         │                       │
│  │   · 历史落 ~/.claude/projects/**/*.jsonl            │                       │
│  └───────┬───────────────────────────────────────────┘                       │
│          │ async iterable: system/assistant/tool/result                       │
│          ▼                                                                     │
│  ┌───────────────┐   搬自 server.ts §4-REUSE（去 MCP 包装）                     │
│  │  出站发送      │   · chunk() 2000 分片 (L402-421)                            │
│  │  Outbound     │   · fetchAllowedChannel + dmChannelUsers DM 修复 (L434-447) │
│  │               │   · reply/react/edit/fetch/download 逻辑体 (L632-752)        │
│  └───────┬───────┘                                                             │
│          │ ch.send()                                                          │
│          ▼                                                                     │
│   Discord (DM / guild channel)                                                │
│                                                                                │
│  ┌───────────────┐  新建 §8                                                    │
│  │  Scheduler    │  cron/定时 → 触发 query() 生成日报 → 主动 push 到 DM         │
│  └───────────────┘  (早间体检 / 盘前持仓 / 收盘复盘 → channel 1484554871800725624)│
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. 复用 vs 重写：server.ts 逐区映射

源文件：`~/.claude/plugins/cache/claude-plugins-official/discord/0.0.4/server.ts`（952 行，已打代理层 + dmChannelUsers 补丁）。

### 4.1 REUSE — 几乎原样搬（连接层 + 鉴权 + 出站逻辑体）

| 行号 | 模块 | 说明 | 改动 |
|---|---|---|---|
| L29-65 | STATE_DIR / `.env` 加载 / token / 全局错误处理 | 复用 `~/.claude/channels/discord/.env` token | 零改 |
| **L67-94** | **代理设置 + WebSocket override + 动态 import discord.js** | **墙内命脉**，gateway 走 Surge 6152 | 零改 |
| L106-116 | Client（intents + partials + proxyAgent rest） | DM partial 必须 | 零改 |
| L118-239 | Access 类型 / `readAccessFile` / `saveAccess` / `pruneExpired` | 复用 access.json 语义 | 零改 |
| L241-347 | **`gate()` + `isMentioned()`** | 入站白名单 / pairing / requireMention / mentionPatterns | 零改 |
| L349-396 | `checkApprovals()` pairing 审批轮询 | 保留 pairing 能力 | 零改 |
| L398-447 | `chunk()` / `fetchTextChannel` / **`fetchAllowedChannel`（含 dmChannelUsers DM 修复 L437-447）** | 出站门 + DM 回复修复 | 零改 |
| L449-469 | `downloadAttachment` / `safeAttName` | 附件下载到 inbox | 零改 |
| L632-752 | reply/fetch_messages/react/edit/download 的**逻辑体** | 发送循环 / 分片 / threading | 抽成内部函数（去掉 MCP `req.params` 包装，见 4.2） |
| L771-773 | client error handler | | 零改 |
| L836-862 | `messageCreate` + `handleInbound` 头部（gate + dmChannelUsers 捕获） | | 保留至 §swap 点 |
| L882-922 | typing 指示 / ackReaction / 附件列举 / 组装 meta | | 保留，meta 复用 |
| **L924-952** | **ready / shard 重连监控 / 60s 心跳 re-login / login(TOKEN)** | gateway 韧性，全部复用 | 零改 |

### 4.2 REPLACE — 删掉"单 CC session"的 MCP 模型，换成 Agent SDK 路由

| 行号 | 模块 | 处置 |
|---|---|---|
| L13-19 | `@modelcontextprotocol/sdk` imports | **删** |
| L471-498 | `new Server(...)` + instructions | **删**；instructions 文案可并入 Agent SDK 的 systemPrompt 上下文 |
| L500-549 | `permission_request` 通知处理（CC→Discord 权限按钮） | **删/改**：改用 Agent SDK 的 `canUseTool` 权限模型（§5.6） |
| L551-630 | `ListToolsRequestSchema`（reply/react/...） | **删**：这些不再是 MCP 工具，变成 bot 内部函数 |
| L632-752 | `CallToolRequestSchema` 处理器 | **改**：函数体（发送逻辑）保留为 `sendReply()/fetchHistory()/...` 内部 helper，外层 MCP 路由删掉 |
| L754 | `mcp.connect(StdioServerTransport)` | **删** |
| L756-769 | stdin EOF shutdown | **改**：无 stdin；改成 SIGTERM/SIGINT daemon 生命周期 |
| L775-834 | `interactionCreate` 权限按钮 | **删/改**：Agent SDK 权限模型下按钮可选保留做 UX |
| L864-880 | `PERMISSION_REPLY_RE` 拦截（"yes xxxxx"） | **删**：属 CC 权限中继 |
| **L906-921** | **`mcp.notification('notifications/claude/channel', ...)`** | **★ 核心 swap 点**：不再 push 给单一 CC session，改调 `dispatch(chat_id, content, meta)` → Agent SDK `query({resume})`（§5.3） |

> **一句话**：把"L906 处把消息塞进 MCP 通知"换成"把消息塞进 per-chat 的 Agent SDK 会话"。连接层、代理、白名单、DM 修复、出站发送全部不动。

---

## 5. 关键模块设计

### 5.1 连接层（Connection）
直接搬 §4.1。唯一注意：`.env` 里需有 `PROXY_URL=http://127.0.0.1:6152`（Surge）。WebSocket override **必须在** `import('discord.js')` 之前执行（L76-94 已是此序）。

### 5.2 Access 网关
零改复用 `~/.claude/channels/discord/access.json`：
- `dmPolicy: allowlist`，`allowFrom: ["1086665220723855560"]`（主人本人）
- guild channel `1086665896547864579`（requireMention）/ `1484554871800725624`（DM 日报频道，免 mention）
- `mentionPatterns: ["(?i)^cici\\b", "(?i)\\bcici\\b"]`

入站走 `gate()`：drop / pair / deliver 三态。只有 `deliver` 进入 Dispatcher。

### 5.3 Session 路由 + 事件循环（Dispatcher）★新建核心

```ts
// 伪代码
async function dispatch(chatId: string, content: string, meta: Meta) {
  const prior = db.getSession('discord', chatId);     // sdk_session_id | null
  const prompt = buildPrompt(content, meta);          // 含 user/ts/附件路径
  db.audit({ kind: 'in', chatId, user: meta.user, payload: content });

  let newSessionId = prior;
  const stream = query({
    prompt,
    options: {
      ...(prior ? { resume: prior } : {}),            // 续接 or 新开
      settingSources: ['user', 'project'],            // ← 复用 MCP/skill/memory/hooks
      cwd: WORKSPACE,                                  // 工作目录（§12-决策1: ~/nimbus/workspace）
      permissionMode: 'default',
      canUseTool,                                      // ← 安全闸（§5.6）
      ...(modelOverride ? { model: modelOverride } : {}), // §12-决策2: 默认省略→继承 ~/.claude；per-chat/job 可覆盖
    },
  });

  let buf = '';
  for await (const msg of stream) {
    if (msg.type === 'system' && msg.subtype === 'init') newSessionId = msg.session_id; // 捕获会话 id
    if (msg.type === 'assistant') buf += extractText(msg);                              // 累积回复
    if (msg.type === 'result')    await sendReply(chatId, buf || msg.result, meta);     // 终态发出
  }

  db.putSession('discord', chatId, newSessionId);     // 回写映射
  db.audit({ kind: 'out', chatId, payload: buf });
}
```

要点：
- **per-chat 串行**：同一 chat 的消息要排队（一个 chat 一个并发槽），避免 resume 竞态。用 per-chat 队列（`Map<chatId, Promise>` 链）。
- **session_id 捕获**：首轮无 `resume`，从 `system/init` 消息拿 `session_id` 存库；后续轮 `resume` 它。
- **上下文持久 = 免费**：会话内容由 SDK 落 jsonl，DB 只存映射，不重存正文。
- **进度反馈（§12-决策3）**：v1 = turn 进行中每 ~8s 重发 typing + 先发"🔍 正在分析…"占位、结束 `edit_message` 成最终答案；v2 = `includePartialMessages:true` token 级增量 + 工具步骤里程碑播报。

### 5.4 Agent SDK 集成（复用 CC 全家桶）
- **订阅 auth**：进程环境**不要**注入 `ANTHROPIC_API_KEY`；SDK 自动用 `claude login` 的 OAuth 态。
- **`settingSources: ['user','project']`** 一次性带来：
  - MCP servers（alpaca / tavily / futu-stock / claude.ai 托管的 Gmail/IBKR 等）
  - skills（`~/.claude/skills` 50+，research/market-pulse/btc-guanfu/futuapi/...）
  - 记忆（`~/.claude/CLAUDE.md` + `memory/MEMORY.md` 自动加载）
  - hooks（含 `trade-guard.sh`）
  - permissions（含 settings.local.json 里 IBKR 下单 deny）
- **cwd**：设为投资工作目录，使相对路径脚本（futuapi scripts 等）可跑。

### 5.5 出站发送（Outbound）
复用 L402-421 `chunk()` + L434-447 `fetchAllowedChannel`（DM 修复）+ L636-687 发送循环，封成：
- `sendReply(chatId, text, {reply_to?})` — 2000 分片 + threading + 附件
- `fetchHistory(chatId, limit)`、`react()`、`editMessage()`、`downloadAttachment()` —— 这些既给 Dispatcher 用，也作为给 Agent 暴露的**自定义工具**（让模型能在一轮内主动拉历史/发图，见 §5.7）。

### 5.6 安全闸 ★最高优先级
**AI 绝不下单（deny 硬拦截）必须穿透到本 bot。** 两道保险：

1. **继承 hooks**：`settingSources:['user']` 会加载 `~/.claude` 的 PreToolUse hook `trade-guard.sh`（拦 futu place/modify/cancel_order.py、`hl` 交易、polymarket 下单）。**上线前必须实测**：在 Discord 里发"帮我买 X"，确认被 deny 而非执行。
2. **`canUseTool` 兜底**：Dispatcher 传入 `canUseTool` 回调，对交易类工具名/脚本路径再做一层 deny（双保险，防 hook 因某 SDK 版本未触发而漏网）。

> 验证不通过 → 阻断上线。这是记忆 `feedback_trade_must_confirm` 的红线。

### 5.7 给 Agent 暴露 channel 工具（可选 v2）
把 `reply/react/edit/fetch_messages/download_attachment` 注册成 Agent SDK 的 in-process MCP（`createSdkMcpServer`），让模型能在一轮内主动操作 Discord（如先拉历史再答、发多张图）。v1 可省略，仅用 Dispatcher 终态 `sendReply`。

---

## 6. 数据库设计（SQLite）

```sql
-- 渠道 ↔ Agent SDK 会话映射（核心）
CREATE TABLE sessions (
  channel        TEXT NOT NULL,          -- 渠道标识,如 'discord'(可扩展新渠道)
  chat_id        TEXT NOT NULL,          -- Discord channel/DM id
  sdk_session_id TEXT,                   -- Agent SDK resume id
  cwd            TEXT,                   -- 该会话工作目录
  model          TEXT,                   -- §12-决策2: null=继承 ~/.claude；可 per-chat 覆盖
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (channel, chat_id)
);

-- 审计 / 可观测（入站/出站/工具/错误）
CREATE TABLE audit (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  ts      INTEGER NOT NULL,
  channel TEXT, chat_id TEXT, user TEXT,
  kind    TEXT,                          -- in | out | tool | error
  payload TEXT
);

-- 定时任务状态（日报等）
CREATE TABLE jobs (
  name        TEXT PRIMARY KEY,          -- 'morning_health' | 'pre_market' | 'close_review'
  cron        TEXT NOT NULL,
  target_chat TEXT NOT NULL,
  last_run    INTEGER,
  last_status TEXT
);
```

- **不入库**：会话正文（SDK jsonl 已存）、access.json（复用文件，语义一致）。
- 位置：`~/nimbus/data/state.db`。

---

## 7. 消息时序图（一次问答）

```
主人(Discord)        连接层         Access门        Dispatcher         Agent SDK            出站
   │  "Cici, NVDA?"    │              │               │                  │                  │
   ├─────────────────►│ messageCreate │               │                  │                  │
   │                   ├─ gate(msg) ──►│ allowFrom? ✓  │                  │                  │
   │                   │              ├─ deliver ─────►│                  │                  │
   │                   │              │               ├─ db.getSession ─ (null/有)            │
   │  (typing…)  ◄─────┤ sendTyping   │               ├─ query({resume,  │                  │
   │                   │              │               │   settingSources})├─► 加载 skill/MCP  │
   │                   │              │               │                  ├─ 调 us-stock-analysis│
   │                   │              │               │                  ├─ futuapi 拉真实持仓 │
   │                   │              │               │  ◄─ result ──────┤                  │
   │                   │              │               ├─ db.putSession   │                  │
   │                   │              │               ├─ sendReply ──────┼─────────────────►│ ch.send (分片)
   │  "NVDA 分析…"  ◄───┼──────────────┼───────────────┼──────────────────┼──────────────────┤
```

---

## 8. 主动推送 / 日报（Scheduler）

bot 常驻持连接后，加内部 cron（如 `croner`）：
- 早间体检 / 盘前持仓 / 收盘复盘 → 触发 `query()`（带对应 prompt + skill 路由）→ `sendReply(DM 1484554871800725624)`。
- 与现有 `/schedule` 不冲突：这里是 bot 进程内调度，直接复用连接，不再单起 daemon。
- 任务定义存 `jobs` 表，便于改 cron / 看上次状态。

---

## 9. 部署与运维

### 9.1 进程拓扑
```
launchd (com.nimbus.daemon, KeepAlive/RunAtLoad)
  └─ supervisor 脚本 (tmux 幂等：会话在则只 supervise)
       └─ tmux session 'nimbus'
            └─ bun run ~/nimbus/src/main.ts
                 (.env: DISCORD_BOT_TOKEN + PROXY_URL=http://127.0.0.1:6152)
```
真重载 = `tmux kill-session -t nimbus`（supervisor while 退 → launchd 拉新）。

### 9.2 ★单消费者铁律
同 token 多连接都能上 gateway（Discord 允许），问题是**逻辑层重复回复**。因此：
- **本 bot 运行时，不得同时跑 `claude --channels` 官方 daemon。** 旧 daemon 已于 2026-06-07 拆除，槽位空闲。
- 交互会话里**不要**用 `plugin:discord:discord` MCP 发消息（那是第二消费者）。

### 9.3 已知坑（全部继承自记忆，已规避）
| 坑 | 规避 |
|---|---|
| 墙内连不上 gateway | `.env` 必带 `PROXY_URL=6152` + WS override（搬 L67-94） |
| DM 回复 "not allowlisted" | 搬 dmChannelUsers 修复（L254/L437-447 + L861 捕获） |
| 信任框 hang | `~/.claude.json` 已设 `hasTrustDialogAccepted=true`（Agent SDK 走 cwd，需确认同样豁免；否则首跑加 `--dangerously-skip-permissions` 或预接受） |
| token 轮换 4004 | token 写 `.env`，轮换后重启进程 |
| 插件升级覆盖代理层 | 本 bot **独立目录**，不动插件 cache，自动绕开 |
| MCP 子进程代理 | 注意：bot 进程的 MCP server 若也需墙外网络，继承代理环境变量 |

### 9.4 可观测
- stderr → `~/nimbus/logs/nimbus.stderr.log`
- 代理连接数自检：`lsof -nP -iTCP@127.0.0.1:6152 -sTCP:ESTABLISHED | grep bun`
- 审计查询：`sqlite3 data/state.db "select * from audit order by ts desc limit 20"`

---

## 10. 风险与权衡

| 风险 | 评估 | 缓解 |
|---|---|---|
| 订阅 ToS：程序化用订阅 | 自用合规；对外开放有风险 | 仅 allowFrom 本人；不对外 |
| `settingSources` 是否真加载 user hooks | **需实测**：trade-guard deny 必须生效 | §5.6 双保险 + 上线前红线测试 |
| Agent SDK 版本 API 漂移 | `query` options / 消息结构可能随版本变 | 锁版本；以 `claude-api` skill / 安装版 d.ts 为准校对 |
| 信任框对 Agent SDK 的影响 | SDK 可能仍需 cwd 信任 | 首跑验证；必要时预接受/skip |
| per-chat 并发竞态 | resume 同一 session 并发会乱 | per-chat 串行队列（§5.3） |
| 长任务阻塞 | 一轮 query 可能很久 | typing 指示 + 超时 + 后台化（v2） |
| 单点：bun 进程挂 | | launchd KeepAlive + 心跳 re-login（L939-947 已有） |

---

## 11. 实施里程碑

- **M0 骨架**：bun 工程 + 搬连接层（§4.1）+ 跑通"收到 DM → 原样回显"（验证代理/DM/白名单链路）。
- **M1 接 Agent SDK**：Dispatcher + session 映射 + `settingSources` → 跑通"NVDA?" → 走 us-stock-analysis 真实回答。**含 §5.6 trade-guard 红线测试（不过不上线）。**
- **M2 出站完善**：chunk 分片 / 附件 / react / edit；per-chat 串行队列。
- **M3 持久 + 审计**：SQLite 三表落地；重启后 resume 验证。
- **M4 部署**：launchd→tmux supervisor；单消费者校验；7×24 稳定性观察。
- **M5 日报**：Scheduler + jobs 表 → 早间体检/盘前/收盘推 DM。
- **M6（可选）**：流式 edit 增量；channel 工具暴露给 Agent（§5.7）；扩展新渠道（实现 Channel 接口 + 连接层即可，Dispatcher 以下全复用）。

---

## 12. 决策记录（2026-06-07 已拍板）
1. **项目名 = `nimbus`**，工程根 `~/nimbus/`，workspace cwd = `~/nimbus/workspace`（与 `~` 隔离，相对路径脚本统一在此）。
2. **model**：默认省略 → 继承 `~/.claude`；`sessions.model` / `jobs` 可 per-chat / per-job 覆盖（日报、深度分析走 Opus）。
3. **进度反馈**：v1 = typing 续命 + 占位消息 edit 成终答；token 级流式留 v2。
4. **M0 起手**：进 full-dev-cycle 建骨架（搬连接层 → DM 回显）。

---

## 13. 解耦架构（便于后续加模块）

三层全部面向接口，**加新能力 = 加一个文件 + 注册一行，Core 零改**。

### 13.1 三个稳定接口

```ts
// 渠道适配器：Discord 先实现，其他渠道(Slack 等)后续 drop-in
interface Channel {
  id: string                                   // 渠道 id,如 'discord'
  start(): Promise<void>
  onMessage(cb: (m: InboundMsg) => void): void
  send(chatId: string, text: string, opts?: SendOpts): Promise<string>  // → message id
  edit(chatId: string, msgId: string, text: string): Promise<void>
  react(chatId: string, msgId: string, emoji: string): Promise<void>
  fetchHistory(chatId: string, limit: number): Promise<Msg[]>
  download(chatId: string, msgId: string): Promise<string[]>
}

// 业务模块：reports/alerts/proactive/... 每个独立插件
interface Module {
  name: string
  match?(m: InboundMsg): boolean   // 被动：命中则接管这条消息（否则走默认 Agent 对话）
  cron?: string                    // 主动：定时触发
  events?: EventType[]             // 事件：订阅数据信号（异动/止损/regime…）
  handle(ctx: ModuleContext): Promise<void>
}

// 模块拿到的一切能力（依赖注入，模块不直接 import 具体实现）
interface ModuleContext {
  agent: AgentRunner           // query() 封装：跑一轮 Agent（带 skill/MCP/memory）
  channels: ChannelRegistry    // 主动 push 到任意渠道
  db: DB
  memory: Memory               // portfolio_state.json / 用户画像 / 论点库
  safety: Safety               // canUseTool + trade-guard 校验
  trigger: Trigger             // { kind: 'message'|'cron'|'event', payload }
}
```

### 13.2 数据流（统一 Trigger 抽象）

```
       ┌─ Channel(discord) ──onMessage──┐
触发源 ─┼─ Scheduler(cron) ──────────────┼──► Trigger ──► Core 路由
       └─ EventSource(数据信号/webhook)──┘                  │
                                                            ├─ message: match 的 module 接管，否则默认对话
                                                            ├─ cron:    对应 module.handle
                                                            └─ event:   订阅该 event 的 module.handle
                                                                          │
                                                                          ▼
                                                            Dispatcher → AgentRunner(query)
                                                                          │
                                                                          ▼
                                                            ModuleContext.channels.send → 任意渠道
```

要点：
- **Core 不认识任何具体渠道/模块**——只认识三个接口。换 Discord→TG 只改 `channels/`；加"盘中告警"只加 `modules/alerts/`。
- **EventSource**（新增的第三类触发源）：把"数据信号"变成一等公民——异动 / 止损触线 / regime 切换 / 论点 decay 都是 event，模块订阅即可，主动投顾能力从此可插拔。
- **复用 L1 状态层**：`memory.ts` 直接读现有 `portfolio_state.json`（记忆 `project_advisor_system_l1_behavior`），不另起炉灶。

---

## 14. 智能投顾视角：当前设计还缺什么

现设计是"你问→它答 + 日报"，是**被动**的。真·投顾的价值在**主动看护 + 行为纠偏 + 闭环**。下表按对**你本人**的价值排序（强关联你的记忆画像）：

| 优先级 | 缺失能力 | 投顾视角为什么要 | 复用 | 落到模块 |
|---|---|---|---|---|
| **P0** | **行为护栏**：你说"满仓/杠杆ETF/接飞刀/转折投降"时主动拦 | 你最大的重复亏损模式（[[feedback_user_counter_trend_pattern]]）——拦住自残 = 投顾第一价值 | `trade-execution` pre-mortem 5 闸 | `modules/guardrail` |
| **P0** | **持仓感知**：每条建议先读真实持仓（futu+IBKR/portfolio_state.json） | 不能用通用模板（[[feedback_use_real_positions]]）；满仓+半导体44%集中要常驻在上下文 | L1 `portfolio_state.json` + `portfolio-manager` | `core/memory` + `modules/portfolio` |
| **P0** | **AI 不下单硬拦** | 红线（[[feedback_trade_must_confirm]]） | `safety.ts` + trade-guard hook | `core/safety` |
| **P1** | **主动告警**：异动/止损触线/regime 切换/集中度恶化 | 投顾要"盯盘"，不是等你问 | `futu-*-anomaly` / `market-pulse` MHS / `trade-execution` | `modules/alerts`（event 驱动） |
| **P1** | **论点看护**：90天僵尸 + decay + 价格对照 | 持仓论点会腐烂，要主动提醒复核 | `thesis-tracker` | `modules/proactive` |
| **P1** | **节奏闭环**：周一早体检 / 周日复盘 / 月报 | CLAUDE.md 已定操作节奏，但要自动跑 | `trade-journal` / `thesis-tracker` / `market-pulse` | `modules/reports`（cron） |
| **P1** | **免责声明 + 决策留痕**：建议自动附 disclaimer + 链到所用数据快照 | 合规 + 可回溯 | `audit` 表 | `core/dispatcher` 后处理 |
| **P2** | **事件驱动 pre-earnings**：持仓明天财报→自动推 checklist | 主动而非临时抱佛脚 | `event-calendar` | `modules/proactive` |
| **P2** | **图表回复**：发 K 线/技术图 PNG | 投顾该给图不只给字（reply 已支持 files） | `technical-analysis` 图像 | 任意模块 |
| **P2** | **数据新鲜度**：标注数据时间戳 + 盘前/盘后/休市感知 | 别给过期建议 | `market-data` / `event-calendar` | `core/agent` 注入 |
| **P3** | **额度/静默时段**：主动扫描限速 + quiet hours + 降级模型 | 订阅有用量上限，主动模块别烧爆 | `config.ts` rate-limit | `core/core` |
| **P3** | **语音输入 STT** | 手机上语音问 | （参考 ClaudeClaw） | `channels/discord` |

**给你的取舍建议**：M0-M5 先把"被动问答 + 日报 + 安全闸 + 持仓感知"做扎实（这已是可用投顾）。**P0 的行为护栏 + 持仓感知建议提前到 M1-M3**（它们是这套对你独有的最高价值，且复用现成 skill/state，成本低）。P1 主动告警依赖 EventSource，放到 M6+ 作为第一个"新增模块"的样板——正好验证解耦架构。

---

## 附：目录结构（解耦版，见 §13/§14）
```
~/nimbus/
├── DESIGN.md
├── package.json               (bun: discord.js / https-proxy-agent / undici / @anthropic-ai/claude-agent-sdk / croner / better-sqlite3 / zod)
├── src/
│   ├── main.ts                (装配: 读 config → new Core → 注册 channels/jobs → 启动)
│   ├── core/
│   │   ├── core.ts            (事件总线 + 生命周期；不依赖任何具体渠道)
│   │   ├── dispatcher.ts      (★ session 路由 + per-chat 串行队列)
│   │   ├── agent.ts           (Agent SDK 封装: query/settingSources/canUseTool)
│   │   ├── safety.ts          (canUseTool 闸 + trade-guard 校验)
│   │   ├── memory.ts          (portfolio_state.json / 用户画像读写)
│   │   └── db.ts              (better-sqlite3: sessions/audit/jobs/...)
│   ├── channels/             (★ 每渠道一个 adapter，实现统一 Channel 接口)
│   │   ├── channel.ts         (interface: onMessage/send/edit/react/fetch...)
│   │   └── discord/           (搬 server.ts: connection/access/outbound)
│   │                          (future: 新渠道实现同一 Channel 接口即可 drop-in)
│   ├── modules/              (★ 业务模块插件，注册到 Core；可独立增删)
│   │   ├── module.ts          (interface: name/triggers/cron?/handle())
│   │   ├── reports/           (日报: 早间体检/盘前/收盘)
│   │   ├── alerts/            (盘中异动/价格/论点 decay 主动告警)
│   │   ├── proactive/         (事件日历驱动的提醒)
│   │   └── portfolio/         (持仓快照/再平衡提示)
│   └── config.ts              (集中配置: 渠道/模型/cron/workspace)
├── workspace/                 (Agent cwd: 投资数据/脚本相对根)
├── data/state.db
└── logs/
```

---

## 15. 实现增补与变更记录（M7/M8 + 关键修复，2026-06）

> 原文 §1-14 是规划。本节记录实际实现中超出/偏离原计划的部分，以及踩过的 SDK 坑。**新人改代码前必读本节。**

### 15.1 已实现里程碑（M0–M8，均 live）
- **M0-M6**：连接层 / Agent SDK / per-chat 队列 / bun:sqlite / 流式 / 日报调度 / EventSource 告警 —— 见 §3-§14。（曾接 Telegram 渠道,已移除,只保留 Discord;Channel 接口仍支持再加新渠道。）
- **M7 智能路由**（`core/router.ts` + `core/symbol.ts` + `modules/quote/`）：按问题分三档——
  - **L0 直连**：纯查行情 → 直接 spawn `~/.claude/skills/futuapi/scripts/quote/get_snapshot.py`（数组参 spawn 无注入；symbol 经 normalizeSymbol 限定 + 中文名 NAME_MAP），~1-2s，**不起 agent**。OpenD(11111) 挂则 fallback market-data。
  - **L1 Sonnet** `claude-sonnet-4-6`（默认/兜底）；**L2 Opus** `claude-opus-4-8`（深度）。bias-up：拿不准升档。
- **M8 人审权限**（`core/permission.ts` + `safety.ts` makeCanUseTool 工厂）：ASK 类操作（对外发布/发送/破坏性命令）→ canUseTool 经 approver 发 Discord「🔐 y/n <code>」→ 等回复（120s 超时拒绝）。回复**跳队列**（dispatcher.dispatch 顶部 broker.tryResolve，防与被阻塞的 agent run 死锁）。**交易类仍硬 deny，不走审批。**

### 15.2 回复风格（systemPrompt）
agent.ts 用 `systemPrompt: {type:'preset', preset:'claude_code', append: REPLY_STYLE_APPEND}`——保留 Claude Code 预设 + CLAUDE.md，追加：结论先行(BLUF) / 轻量 markdown(粗体+短bullet，**禁表格**，手机优先) / 默认简洁 / 只在明确交易决策时 pre-mortem / Cici 克制 / AI 不下单。否则 CLAUDE.md 人设 + 注入的行为规则 + trade-rules hook 会把"NVDA?"逼成长篇审问。

### 15.3 ★SDK 关键坑（务必记住）
1. **canUseTool 的 `allow` 必须带 `updatedInput`**：`.d.ts` 标 `updatedInput?` 可选，但**运行时 Zod schema 要求它**。漏了 → **每个工具调用炸 ZodError**（"实时数据全报错"卡了两天的真凶）。正确：`{ behavior:'allow', updatedInput: input }`。deny 则需 `message`。
2. **MCP 不从 settings 自动加载**：SDK 只认通过 `mcpServers` option 传的（d.ts:1881）。必须 `loadMcpServers()` 读 `~/.claude.json` + `~/.claude/mcp.json` 合并传入。`MCP_EXCLUDE` 排除 grok-search（tavily 已覆盖）。
3. **`settingSources` 必须含 `'local'`**：trade-guard PreToolUse hook + IBKR deny 在 `settings.local.json`（local 源），漏了红线第一道闸不加载。
4. **订阅 auth**：绝不设 `ANTHROPIC_API_KEY`；daemon 脚本 `unset` 它。额度有日限 + **周限**（周限耗尽 resets 周三 18:00 之类，深度 agent 全停，L0 行情不受影响）。

### 15.4 独立项目化（fork）
`~/nimbus/skills/` = 37 个投资 skill 的 vendored 副本（rsync 排除 node_modules/venv/.git；剔除 10 个非投资）。**当前 agent 仍从 ~/.claude 读**（未改加载，不碰运行中的 bot）。**真独立待办**：① agent cwd/settingSources 切到项目 skills ② CLAUDE.md + trade-guard hook 搬进项目 ③ 外部依赖（OpenD / python futu 包 / MCP API keys）需单独处理（fork 带不走）。

### 15.5 部署（已上线）
launchd `com.nimbus.daemon` → `scripts/nimbus-daemon.sh`（tmux `nimbus` + 退避 supervisor）→ `bun run src/main.ts`。改代码重载 = `tmux kill-session -t nimbus`。单消费者铁律：原 CC discord 插件已删、TG `com.claude.daemon` 已 bootout，Nimbus 独占两 token。测试：`bun test`（476）。运维/故障排查见 `USAGE.md`。

---

## 16. 最终架构总览（2026-06-12 · 这是当前真实形态,新人先读本节）

> §1-15 是演进过程。本节是**收敛后的最终架构**——分层职责、数据流、安全模型、已知权衡。

### 16.1 一句话
Nimbus = **基于 Claude Agent SDK 的常驻投顾编排层**。自己只做"渠道 / 路由 / 触发 / 安全 / 记忆 / 调度",所有投资分析交给继承自 CC 的 skill+MCP。**北极星:用 CC 能力,不重做 CC。**

### 16.2 分层职责
```
渠道层 channels/    Discord adapter(统一 Channel 接口,可扩展新渠道)
   ↓ InboundMsg(带 userId → 身份感知)
编排层 core/
   ├ dispatcher    ★中枢:身份隔离 → 意图分档 → per-chat 串行队列 →
   │                记忆/时间/护栏注入 → agent.run → 流式/embed/outbox/台账
   ├ router/symbol L0 行情快路径分流 + 代码归一化(含中文名)
   ├ agent         Agent SDK 封装(订阅auth/动态模型/自适应思考/canUseTool/项目加载)
   ├ models        动态模型发现(supportedModels 滚动别名,跟随新发布)
   ├ safety        ★交易硬拦 + 账户隔离 + 人审批闸
   ├ memory        持仓画像/持久记忆(偏好/决策/教训)/时间注入
   ├ permission    人在回路审批(Discord y/n)
   ├ db            bun:sqlite(sessions/audit/jobs/memories/usage/decisions/cooldowns)
   └ scheduler/eventsource  cron + 告警轮询
能力层(继承)      37 投资 skill + MCP(futu/长桥/cmc/tavily/alpaca)+ IBKR连接器
                  + 内置工具(Bash/Write/WebSearch/WebFetch/Task子代理)+ python画图
模块层 modules/    被动(quote/guardrail/echo)+ 主动 cron(reports/opportunity/
                  reflection/portfolio-refresh/ops)+ 事件(alerts)
```

### 16.3 一条消息的完整数据流
```
DM → 渠道 gate(白名单) → dispatcher:
  1. isOwner = userId ∈ OWNER_IDS          ← ★隐私分叉
  2. "记住X" 快路径(仅本人)
  3. 意图分档 classify:
     · L0 行情 → 直 spawn futu/yfinance(不起 agent,秒回)
     · 否则 → 选模型(haiku/sonnet/opus 动态别名)
  4. 组 prompt:[北京时间] +(本人才有)[持仓画像(首轮)/记忆recall/护栏] +(非本人)[身份警示] + 用户消息
  5. agent.run(订阅auth · 项目skill · 自适应思考 · canUseTool[交易deny+非本人账户deny] · blockAccount)
  6. 流式增量 edit 占位 → 终态:剥离 ===DECISION===(仅本人入台账)→ 免责 → 发送
  7. outbox 有图自动发 · 用量入库(超预算提示)
```

### 16.4 安全模型(三层,红线不可松)
- **交易硬拦**(所有人):trade-guard hook(进程级)+ canUseTool(SDK级)→ futu/长桥/IBKR/hl/polymarket 下单工具全 deny。**AI 绝不下单。**
- **账户隔离**(非本人):非 OWNER → 不注入持仓、`blockAccount` 硬 deny 账户/持仓查询、prompt 警示禁透露隐私、不存记忆。
- **人审批**(对外操作):发布/发送/破坏性命令 → Discord y/n 才执行。
- 数据卫生:真实持仓/密钥经 gitignore 不入库;运行时数据不版本控制。

### 16.5 自动运转(8 cron + 告警)
进攻:机会扫描(工作日9点)· 防守:三日报+告警(止损/集中度/论点)· 数据:持仓刷新(含IBKR)· 进化:周反思(学教训入记忆)· 运维:成本周报+健康自愈。

### 16.6 "实时跟随最新"的双机制
- **模型**:supportedModels() 滚动别名 + 24h 刷新 → 新版自动用上。
- **SDK**:受控升级(typecheck+test+smoke 守护,不盲目)。

### 16.7 已知权衡(诚实记录)
- **半独立**:agent 从项目 `.claude` 加载 skill 定义,但数据(state/历史)+ 7 个 skill 脚本仍指向 `~/.claude`。本机部署下合理;完全独立需改脚本路径+同步数据,收益低未做。
- **vendored skills 会漂移**:`sync-skills.sh` 手动同步,非自动。
- **embed 仅结构化推送**:自由对话/日报用 markdown(embed 4096 限+丢格式)。
- **单消费者铁律**:同 token 只能一个 nimbus 持 channel(防双回复)。
- **长桥连接器依赖 claude.ai 订阅态**:彻底脱离 claude.ai 则失效,那时才需自接 API。

### 16.8 还可做(非必须)
知识 theses 导入让 bot 帮建 · browser-use(JS渲染/截图,边缘场景再加) · Discord 完全独立(state/脚本路径) · 决策台账的结果回填自动化(现靠周反思人工对照)。

---

## 17. 框架最终评估（2026-06-12 · review,主要看框架结构）

> 506 测试绿、live 稳定运行后的框架层评估。诚实记录优点 + 真问题 + 建议,不空泛。

### 17.1 框架优点(经验证)
- **分层清晰 + 解耦真**:渠道(Channel 接口)/ 编排(core)/ 模块(Module 接口)三层。新渠道接入只需实现 Channel 接口,dispatcher 以下零改 = 解耦到位(曾接 Telegram 验证过此路径,后按需求收敛回 Discord 单渠道)。
- **安全收口在一处**:所有 agent.run → 同一 `AgentRunnerImpl.run` → 同一 `canUseTool`(safety.ts)。红线(交易deny/账户隔离/paper闸)是**框架级单点收口**,不散落,难绕过。
- **统一 Trigger 抽象**:message/cron/event 三类触发归一,EventSource/Scheduler/渠道都产 Trigger → dispatcher 统一路由。加触发源不改核心。
- **错误兜底一致**:每个 cron 模块都有 try/catch;agent.run 有 stale-session 自愈 + 额度错误友好提示。失败不拖垮进程。
- **能力靠继承不重造**:37 skill + MCP 经 SDK 继承,nimbus 只做编排——北极星守得住。

### 17.2 框架真问题(按严重度)
1. **★dispatcher `#process` 是 250 行上帝方法**(最该改)。一个方法干了:身份隔离 / 记忆捕获 / 模块分发 / 意图分类 / L0 quote / 模型选择 / prompt 组装 / 占位+typing / 流式 / agent.run / 台账 / disclaimer / outbox / audit。**症状**:难读、难测局部、改一处怕碰别处(近期几个 bug 都在这附近)。**建议**:拆成 `#handleMemoryCapture` / `#handleQuote` / `#buildPrompt(isOwner)` / `#runConversation` / `#deliverFinal` 私有方法,#process 只做编排。有 500+ 测试守护,可渐进拆。
2. **cron 模块重复模式**:reports/opportunity/reflection/portfolio-refresh 都是"buildContext + getSession(resume) + agent.run + putSession + send"。reports 有 runReport helper 但其他各自重复。**建议**:抽 `runAgentReport(ctx, {prompt, model, targetChat})` 共享 helper,去重 + 统一(如统一加 nowLine/disclaimer)。
3. **DB 接口 12 方法偏胖**(违反接口隔离):getSession/putSession/audit/getJob/upsertJob/markJobRun/getCooldown/setCooldown/openDecisions?/recordDecision?/getUsageSummary?。模块只用其中几个。**建议(可选,低优先)**:拆 SessionStore/AuditLog/JobStore/MemoryStore/UsageStore 子接口;或保持(单实现下实用够用)。
4. **module.ts 是契约大杂烩**:Channel 引用 + Detector/Trigger/Position/PortfolioState/AgentRunner/Safety/Memory/DB/ModuleContext/Module 全在一文件。**建议(可选)**:按域拆(types/portfolio.ts、types/agent.ts...);或保持(集中查阅方便)。

### 17.3 演进性评估(加东西容易吗)
- **加渠道**:实现 Channel 接口 + registry.register → ✅ 易(曾接 Telegram 验证过此路径)。
- **加被动模块**(对话响应):写 Module + match → ✅ 易(quote/paper 是例)。
- **加 cron/event 模块**:写 Module + cron/events + 注册 → ✅ 易(8 个 cron 都这么加的)。
- **加数据源**:MCP 进 secrets/mcp.json 或 skill → ✅ 易(长桥这么加的)。
- **改对话主流程**:⚠️ 要碰 250 行 #process → 中等风险(问题1)。

### 17.4 结论
框架**骨架健康**(分层/解耦/安全收口/触发抽象/演进性都达标),无结构性缺陷。唯一明确的技术债是 **#process 上帝方法**(问题1)——值得在求稳期后渐进重构。其余(cron重复/DB胖/module.ts大)是整洁度问题,不影响正确性,按需处理。
