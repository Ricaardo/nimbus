# 解耦方案:让 nimbus 自包含,把 ~/.claude 还给"纯编码 CC"

> 目标:删掉 `~/.claude/skills`(投资 skill)和 `~/.claude/channels`(渠道)后 nimbus 仍正常自主运转。
> 北极星:nimbus 只引用**自带** `skills/` 与项目内 state/secrets,绝不伸手 `~/.claude/skills` / `~/.claude/channels`。
> 保留(这是 CC 编码底座,非投资内容):`claude login` 订阅鉴权、IBKR/Gmail 托管连接器、`~/.claude.json`(MCP 仅 fallback,已被 secrets/mcp.json 覆盖)。

## 依赖现状(审计结论)

| 类别 | 位置 | 删了会怎样 |
|---|---|---|
| 🟢 已独立 | agent skill 加载(项目 `.claude/skills`→`skills/`)、MCP(`secrets/mcp.json` 全 5 server)、trade-guard(`$CLAUDE_PROJECT_DIR`) | 不受影响 |
| 🔴 config.ts 5 路径 | `FUTU_SNAPSHOT_SCRIPT`/`MARKET_DATA_QUOTE_SCRIPT`/`PORTFOLIO_STATE_PATH`/`IBKR_POSITIONS_FILE`/`PORTFOLIO_STATE_GEN` 指 `~/.claude/skills/...` | L0 行情、持仓刷新崩 |
| 🔴 2 处 prompt | `reports/index.ts`、`reflection/index.ts` 写死 `python3 ~/.claude/skills/...` | agent 跑错路径 |
| 🔴 12 个 vendored 脚本 | `portfolio_state.py`/`briefing.py`/`idea_feed.py`/`macro_feed.py`/`holdings_earnings.py`/`behavior_monitor.py`/`ah/us value_pipeline.py`/`square-bot ×3` 内部硬编码 `{HOME}/.claude/skills/...` | 脚本运行时找不到兄弟脚本/state |
| 🔴 运行态 state | `~/.claude/skills/references/state/*.json`(持仓真相,sync 排除不 vendored) | 持仓快照丢失 |
| 🔴 Discord 渠道 | `~/.claude/channels/discord/`:token `.env`、白名单 `access.json`、去重 state、inbox | bot 失联 |

## 迁移策略

**脚本类引用 → 改为相对 `__file__` 解析**(最稳):每个脚本在 `skills/<skill>/scripts/<f>.py`,
故 `SKILLS_ROOT = Path(__file__).resolve().parents[2]`。改后脚本在 `nimbus/skills/` 或
`~/.claude/skills/` 都能跑,零硬编码——天然解耦。

**config.ts / prompt → 改为 `${PROJECT_ROOT}/skills/...`**(项目已 vendored 全部脚本,已验证存在)。

**state / 渠道 → 实体搬进项目**(copy live→项目,再 repoint),不丢数据。

## 执行步骤(Phase)

### P1 — state + 渠道数据搬入项目(先搬数据,防丢)
- `skills/references/state/`:把 `~/.claude/skills/references/state/{portfolio_state,ibkr_positions,earnings_cache,macro_cache}.json` 的 **live 版**拷进项目(覆盖 Jun-12 stale vendored 副本)。
- 报告目录:`thesis-tracker/reports/theses`、`trade-journal/reports/trades` live→项目(若项目侧更旧)。
- 渠道:`~/.claude/channels/discord/{.env,access.json}` → 项目 `secrets/discord/`(.env 含 token,chmod 600;inbox 不搬,运行期重建)。

### P2 — config.ts repoint(5 路径 + STATE_DIR + env 加载)
- 5 个脚本/ state 路径 → `join(PROJECT_ROOT, 'skills', ...)` / `join(PROJECT_ROOT, 'skills/references/state', ...)`。
- `STATE_DIR` 默认 → `join(PROJECT_ROOT, 'secrets', 'discord')`(env `DISCORD_STATE_DIR` 仍可覆盖)。

### P3 — patch 12 个 vendored 脚本(`__file__` 相对解析)
- py:`SKILLS_ROOT = Path(__file__).resolve().parents[2]`,所有 `{HOME}/.claude/skills` → `{SKILLS_ROOT}`。
- sh(square-bot):`ROOT="$(cd "$(dirname "$0")/.." && pwd)"`。
- 跳过 `dividend-screener:1100`(纯注释)。

### P4 — 2 处 prompt 路径
- `reports/index.ts`、`reflection/index.ts` 的 `~/.claude/skills/...` → `${PROJECT_ROOT}/skills/...`。

### P5 — 验证 + 收尾
- **grep 守卫**:`grep -rE '\.claude/skills' src/ skills/` 应只剩注释/无害项 → 加一条测试/CI 检查防回潮。
- `bun run typecheck` + 关键脚本 smoke(portfolio_state.py 生成、L0 quote)。
- `sync-skills.sh` 失去意义(源将删)→ 标注废弃或改为项目内自检。
- 重启 daemon,确认行情/持仓/skill 正常。
- **最后**:用户确认无误后,删 `~/.claude/skills`(投资)+ `~/.claude/channels`。本方案不替用户执行删除。

## 不动的东西
- 全局 `~/.claude/CLAUDE.md`(投资指令)——属"指令"非代码依赖,用户可另行精简;portfolio-refresh 的 `'user'` settingSource 只为够 IBKR 托管连接器,不需要投资 CLAUDE.md。
- 订阅鉴权、`~/.claude.json`(MCP fallback)、托管连接器。
