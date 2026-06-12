# Nimbus 使用文档

> Nimbus = 你的常驻智能投顾机器人。在 **Discord** 发消息,它用 Claude Code 的全部能力(skill / MCP / 记忆 / 你的真实持仓 / 写代码画图)帮你**赚钱分析**,并主动盯盘、找机会、复盘进化。
>
> 北极星:**用 CC 能力的机器人,不是重做 CC。** 投资逻辑全走现成 skill;AI 绝不下单。

---

## 1. 怎么用(直接 DM 机器人)

DM **Cici#8105**(Discord),它按问题自动分三档:

| 你发什么 | 档 | 用什么 | 速度 |
|---|---|---|---|
| `NVDA` / `腾讯` / `00700` / `英伟达多少钱` | **L0 直连** | 直调 futu 接口,不起 AI、不耗额度 | 1-2 秒 |
| `你好` / `谢谢` / `记一下…` | **Haiku** | 最便宜模型 | 秒级 |
| `NVDA 怎么样` / `最近有啥新闻` | **Sonnet** | 轻量分析 | 秒级 |
| `深度分析 NVDA 该不该加` / `估值` / `看组合` | **Opus** | 全 skill 深度 | 30-90 秒 |

- **思考深度 AI 自调**(adaptive):难题多想、闲聊少想,不用你管。
- **模型自动用最新**:跟随 Anthropic 滚动别名(haiku/sonnet/opus),发新版自动跟上,无需改配置。
- **回复结论先行**:第一行粗体结论 → 关键要点 → `---` → 详细分析放下面(想深看才往下读)。

### 行情支持的写法(L0 秒回)
- 美股 `NVDA` `AVGO` / 港股 `00700` `0700.HK` / A股 `600519`
- 中文/常用名(内置):腾讯、英伟达、博通、迈威尔、苹果、特斯拉、茅台、宁德…(加新名改 `src/core/symbol.ts` 的 `NAME_MAP`)

### 特殊指令(本地秒回,不耗额度)
- **`帮助`**(或 `菜单`/`/help`)→ 能力卡:怎么查行情、怎么深度分析、有哪些指令
- **`新话题`**(或 `重置`/`清空上下文`/`/new`)→ 清掉当前会话上下文重开,换标的时用,避免串台
- **`我的建议`**(或 `台账`)→ 决策台账:我给过的明确买卖建议(仅主人本人可见)
- **`重置高水位`**(或 `重置回撤`)→ 出入金后清掉回撤告警的峰值基准,下次刷新以当前组合市值为新高点(仅主人本人)
- **`记住 <内容>`** → 长期偏好,跨会话永久生效(如 `记住 以后先说预期空间再说风险`)
- 让它**画图/拉数据/回测** → 它会写 python 脚本(pandas/matplotlib),图自动发到对话
- 让它**搜新闻/查资料** → 优先用免费内置 WebSearch/WebFetch

> 提示:只发一个代码/名字(`NVDA`、`腾讯`)= 秒回行情;带问号或问句(`NVDA?`、`NVDA 怎么样`)= 走分析。

---

## 2. 自动运转(不用你问,它自己来)

推送到你的 DM 频道(`REPORT_DM`,Asia/Shanghai 时间):

| 作业 | 时间 | 干什么 |
|---|---|---|
| **机会扫描** 🎯 | 工作日 09:00 | **主动找赚钱机会**(1-3 个最值得出手的,带预期/催化/进场/仓位) |
| 早间体检 | 08:00 | market-pulse + 事件 + 论点 decay + 偏离 |
| 盘前持仓 | 21:00 | 真实持仓 + 止损位 + 催化 + 盘中触发器 |
| 收盘复盘 | 06:00 | trade-journal + 市场变化 + 论点更新 |
| 持仓刷新 | 07:30 & 20:30 | 拉 futu+IBKR 写 portfolio_state(数据保鲜) |
| **周反思** 🧠 | 周日 21:00 | 从真实交易学教训 → 存记忆 → 越用越懂你 |
| 成本周报 | 周一 08:30 | 上周各模型花费/token/缓存命中 |
| 健康自愈 | 每 20 分钟 | 检 OpenD,异常告警(冷却) |
| 主动告警 | 每 15 分钟 | **实时止损** / **止盈锁利** / 集中度 / 论点 decay(止损不静默) |

**主动告警细节**(每 15 分钟用 futu 实时价扫一遍持仓,不再等半天一次的快照):
- 🔴 **止损触线** — 现价 ≤ 论点止损价 → 立即推送(静默时段也推),复核论点 + 给止损/持有方案
- 📈 **止盈锁利** — 现价 ≥ 论点目标价(`valuation.target_price`),**或**单票浮盈 ≥30% → 提醒"拿住利润",给上移止损/分批止盈方案。同一标的同一盈利档约 7 天最多提醒一次,不啰嗦
- 📉 **组合回撤** — 总市值从高点(自动记录的高水位)回撤 ≥10% → 推送,判系统性 vs 个别拖累 + 给动作
- ⚠️ **集中度** — 单票 ≥25% 或半导体桶 >30%;**论点 decay** — 90 天僵尸 / verdict 转 decaying/broken
- 止损价/止盈价来自论点 YAML(`thesis-tracker/reports/theses/*.yaml` 的 `valuation.stop_loss` / `target_price`),持有且有论点的标的才有

改时间/阈值见 `src/config.ts`(`*_CRON` / `QUIET_HOURS` / `*_CONC_PCT` / `GAIN_ALERT_PCT` / `GAIN_COOLDOWN_MS` / `DRAWDOWN_PCT` / `ALERT_DAILY_CAP`)。

---

## 3. 数据源 & 能力

- **行情/交易数据**:futu(主) + IBKR(连接器,经刷新作业) + **长桥 LongPort(145 工具)** + market-data + cmc(加密)
- **新闻/搜索**:WebSearch(免费,真搜索)+ WebFetch(免费,抓静态页→markdown,不渲染 JS)+ tavily(计费,深度兜底)。动态页/登录抓取/截图需 browser-use(未装,边缘场景再加)。
- **自写脚本**:Bash + python(pandas/numpy/matplotlib)→ 拉数据/解析/回测/画图,不局限现成工具
- **skill**:37 个投资 skill(research/valuation/market-pulse/portfolio-manager/thesis-tracker/btc-guanfu/…)
- **记忆**:跨会话持久(偏好/决策/教训),决策台账(每条明确买卖建议留痕;发 `我的建议`/`台账` 查未结;周反思对照结果后自动结清,不无限堆积)

---

## 4. 安全红线(硬性,不可松动)

- **AI 绝不下单/改单/撤单。** 任何交易一律拒绝 → 给你【标的/方向/数量/价格】,你在 App 手动执行。
- 两道闸:`.claude/settings.json` 的 trade-guard hook(进程级)+ `src/core/safety.ts` 的 canUseTool(SDK 级,futu/长桥/IBKR/hl/polymarket 下单工具全 deny)。
- 对外操作(发广场/发邮件/破坏性命令)→ 弹 Discord 审批,回 `y <code>` / `n <code>` 才执行。
- 投资类回复自动附免责声明;所有进出消息记审计。

---

## 5. 日常运维

### 看状态
```bash
launchctl list | grep nimbus                 # daemon 在不在
tmux has-session -t nimbus && echo up        # bot 进程在不在
lsof -nP -iTCP@127.0.0.1:6152 -sTCP:ESTABLISHED | grep -c bun   # 应=1(单消费者)
```

### 看日志 / 成本 / 记忆
```bash
tail -f ~/nimbus/logs/nimbus.stderr.log
# 每日每模型成本:
sqlite3 ~/nimbus/data/state.db "select date(ts/1000,'unixepoch','localtime') d,model,round(sum(cost_usd),3) cost,count(*) n from usage group by 1,2 order by 1 desc"
# 学到的偏好/教训:
sqlite3 ~/nimbus/data/state.db "select kind,text from memories where active=1"
# 决策台账:
sqlite3 ~/nimbus/data/state.db "select symbol,direction,status,rationale from decisions order by id desc limit 20"
```

### 改代码后重载(daemon 自动拉新代码)
```bash
cd ~/nimbus && bun test && bun run typecheck   # 先确认绿
tmux kill-session -t nimbus                    # supervisor 退 → launchd 拉新进程
```

### 启停
```bash
# 临时停(会被 launchd 拉回):
tmux kill-session -t nimbus
# 彻底停(卸载 daemon):
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.nimbus.daemon.plist
# 装回:
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.nimbus.daemon.plist
```

### SDK 升级(受控,有测试守护)
```bash
cd ~/nimbus
npm view @anthropic-ai/claude-agent-sdk version   # 看最新
bun add @anthropic-ai/claude-agent-sdk@<新版本>
bun run typecheck && bun test ./src/              # 必须全绿
env -u ANTHROPIC_API_KEY bun run scripts/smoke-agent.ts '一句话测试'  # smoke
tmux kill-session -t nimbus                        # 绿了才 reload
```
> ⚠️ 不要盲目自动升——SDK API 会漂移(踩过 ZodError)。测试+smoke 绿才上线。

### 同步 skill(更新了 CC 的投资 skill 后)
```bash
cd ~/nimbus
bash scripts/sync-skills.sh        # 从 ~/.claude 同步已 fork 的投资 skill 定义(防漂移)
git add skills && git commit -m "sync skills"
```
> vendored skills 是 fork,~/.claude 是源;只同步定义,运行时数据(持仓/缓存/队列)各自维护。

### 版本控制(私有库 github.com/Ricaardo/nimbus)
```bash
cd ~/nimbus
bun test ./src/ && bun run typecheck   # 先确认绿
git add -A && git commit -m "..."
git push                                # 推私有库
```
> ⚠️ 仓库**必须私有**(含投资策略/持仓画像)。运行时数据(`skills/references/state/*.json` 真实持仓、`*.db`、队列)+ `secrets/` 已 gitignore,**不入库**。换机克隆后需手补 `secrets/mcp.json`(cmc/alpaca/tavily 密钥)+ 重新长桥 OAuth。

---

## 6. 配置速查(`src/config.ts`)

| 想改 | 常量 |
|---|---|
| 各作业时间 | `*_CRON`(MORNING/PREMARKET/CLOSE/OPPORTUNITY/REFLECTION/REFRESH/HEALTH/COST_REPORT) |
| 日报推送频道 | `REPORT_DM` |
| 告警冷却/静默/上限/阈值 | `COOLDOWN_TTL_MS` / `QUIET_HOURS` / `ALERT_DAILY_CAP` / `SINGLE_CONC_PCT` / `SEMIS_CONC_PCT` |
| 成本预算提示线 | `DAILY_COST_BUDGET_USD` |
| OpenD 地址端口 | `OPEND_HOST` / `OPEND_PORT` |
| 模型档(fallback 别名) | `HAIKU/SONNET/OPUS_MODEL`(平时自动发现,这些是兜底) |
| 中文名→代码 | `src/core/symbol.ts` 的 `NAME_MAP` |
| 回复风格/使命 | `src/core/agent.ts` 的 `REPLY_STYLE_APPEND` + `.claude/CLAUDE.md` |

**白名单**:Discord `~/.claude/channels/discord/access.json`。
**Token/密钥**(勿删):`~/.claude/channels/discord/.env`、`~/nimbus/secrets/mcp.json`、长桥 OAuth(Claude Code 凭证库)。

---

## 7. 故障排查

| 现象 | 处理 |
|---|---|
| 不回消息 | 看 `nimbus.stderr.log` 有无 `gateway connected`;确认你的 id 在白名单 |
| **回复两遍** | 双消费者!确认无 `claude --channels` daemon、本交互会话没激活 discord 插件;`lsof ...6152\|grep -c bun` 应=1 |
| 行情查不到 / L0 慢 | OpenD 没开 → `nc -z 127.0.0.1 11111`;开 Futu OpenD;否则 fallback yfinance |
| 额度用满 | 它会回"额度已用满(X 恢复)+ 行情仍可用";L0 行情不受影响 |
| 深度分析慢(30-90s) | 正常——跑真 skill + 深度思考;快问走 L0/Haiku |
| 墙内连不上 | `.env` 的 `PROXY_URL=http://127.0.0.1:6152`(Surge)要在跑 |
| 长桥失效 | 重新 OAuth:终端 `claude` → `/mcp` → longbridge → Authenticate |

---

## 8. 代码地图

```
~/nimbus/
├── USAGE.md / DESIGN.md / ROADMAP.md   使用 / 架构 / 路线
├── .claude/CLAUDE.md                    精简赚钱版人设(agent 从这加载)
├── secrets/                             凭证副本(gitignore,不入库)
├── skills/                              37 个投资 skill(vendored)
├── src/
│   ├── main.ts          装配 + 启动模型发现/调度/事件源
│   ├── config.ts        所有常量
│   ├── core/
│   │   ├── dispatcher.ts ★路由:分档+队列+流式+记忆注入+决策台账+outbox
│   │   ├── router.ts / symbol.ts   意图分档 + 代码归一化
│   │   ├── agent.ts      Agent SDK 封装(订阅auth/canUseTool/自适应思考/systemPrompt)
│   │   ├── models.ts     动态模型发现(supportedModels)
│   │   ├── safety.ts     ★交易拦截 + 审批闸
│   │   ├── memory.ts     持仓画像 + 持久记忆 + 时间注入
│   │   ├── db.ts         sqlite(sessions/audit/jobs/memories/usage/decisions/cooldowns)
│   │   ├── permission.ts 人审批(Discord y/n)
│   │   ├── scheduler.ts / eventsource.ts   cron + 告警轮询
│   ├── channels/discord/    渠道适配器
│   └── modules/         reports / opportunity / reflection / portfolio-refresh / alerts / guardrail / quote / ops(cost-report+health)
├── scripts/             smoke-agent / trigger-refresh / import-memories / sync-skills / nimbus-daemon.sh
└── data/state.db        SQLite(gitignore)
```

测试:`bun test ./src/`(484 用例)· 类型:`bun run typecheck`

---

## 9. 一句话备忘
- 查行情秒回、问分析自适应深想、买卖只给建议不下单。
- 主动找机会(工作日9点)、每周自我复盘进化、模型自动用最新。
- 改完代码 → `bun test` 绿 → `tmux kill-session -t nimbus` 重载。
- 任何时候只能有**一个** nimbus 消费者(防双回复)。
