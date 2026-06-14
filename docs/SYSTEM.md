# 投顾机器人体系总览 + 运维方案

> 日期：2026-06-14 ·  范围：nimbus(中枢) + guanfu/ah-screener(引擎) + news(实时feed) + btcdca小程序(前端) + 数据桥
> 北极星：**用 CC 能力的投顾机器人，投资逻辑全走 skill，AI 绝不下单。**

---

## 1. 体系架构（一图）

```
                          你 (Discord DM / 微信 / 小程序)
                                    │
        ┌───────────────────────────┴───────────────────────────┐
        │  nimbus (TS·Bun·Claude Agent SDK) = 投顾中枢 [常驻]      │
        │  • 四档路由 L0直连/Haiku/Sonnet/Opus + adaptive 思考     │
        │  • 40+ skill 自动触发 · 真实持仓(futu+IBKR) · 决策台账   │
        │  • cron 自发运转: 机会扫描/日报/告警/复盘/持仓刷新/健康  │
        │  • 安全双闸: AI 绝不下单                                  │
        └───┬───────────────┬───────────────┬───────────────┬─────┘
            │ skill 调用      │ skill 调用     │ MCP            │ 读数据桥
     ┌──────▼──────┐  ┌──────▼──────┐  ┌─────▼─────┐  ┌───────▼────────┐
     │ guanfu(Go)  │  │ ah-screener │  │ cmc/alpaca │  │ news (Go) 实时  │
     │ 多资产择时   │  │ (Py) A/H/US │  │ /tavily/   │  │ feed 管道       │
     │ kNN/经典组合 │  │ 价值选股     │  │ longbridge │  │ trump/bwe/13F/  │
     │ =btc-guanfu  │  │ =skill      │  │ /futu MCP  │  │ A股扫描+DeepSeek│
     └─────────────┘  └─────────────┘  └───────────┘  └───────┬────────┘
                                                       filefeed │
                                          ~/nimbus-stack/nimbus/workspace/feed/*.json
                                          (breaking.jsonl + 13f-latest.json)

   外部数据源(机会性,不依赖): trump.fm · followserenity.com · QuiverQuant(国会) ·
   Finnhub(内部人/评级) · FINRA(做空) · FMP(基本面) · FRED(宏观) · Longbridge(A股/港股持牌) · akshare(A股独家扫描)
```

**分工**：guanfu 算时机/配置、ah-screener 选标的、news 实时 feed、**nimbus 编排+投顾+对话+推送**、小程序展示。

---

## 2. 组件详解

### 2.1 nimbus（中枢，~/nimbus-stack/nimbus，分支 master）
- TS/Bun，Claude Agent SDK，复用 ~/.claude 的订阅鉴权/skill/MCP/记忆。
- 渠道：Discord(Cici#8105) 常驻 + TG。L0(futu行情秒回)/Haiku(闲聊)/Sonnet(轻分析)/Opus(深度全skill)。
- cron 模块：opportunity(机会引擎) · reports(日报) · alerts(止损/集中度/decay) · portfolio-refresh(futu+IBKR真仓) · reflection(周复盘) · costReport · health。
- 安全：trade-guard hook + canUseTool deny + IBKR 连接器下单工具 deny → **AI 不下单**。

### 2.2 skill 层（42 投资 skill，vendored 进项目）

**加载机制（关键，曾因搬家踩坑）**：daemon 的 agent 经 SDK `settingSources:['project','local']` 从**项目自带** `.claude/skills` 加载，**不是直接读全局 ~/.claude/skills**。
- `~/nimbus-stack/nimbus/.claude/skills` 是**软链 → `../skills`**（项目根的 `skills/`，42 个投资 skill，随项目 git 版本化）。
- 全局 `~/.claude/skills`（52 个，含 browser-use/github/tmux/weather 等非投资 skill）是**同步源**：`scripts/sync-skills.sh` 把其中已 vendored 的投资 skill 拷进项目（只收投资 skill，不引入元/工具 skill）。
- ⚠️ **软链 dangling = agent 零 skill（静默降级，bot 照跑但没投资能力）**。搬家/改路径后必查（见 §5.2）。软链用相对 `../skills`、hook 用 `$CLAUDE_PROJECT_DIR` 防再踩。
- **已与 ~/.claude 解耦**（见 [decouple-from-cc.md](decouple-from-cc.md)）：config.ts 路径走 `SKILLS_ROOT=PROJECT_ROOT/skills`、vendored 脚本内部改 `__file__` 相对、运行态 state 与 Discord 渠道(token/access)搬进项目 `skills/references/state`+`secrets/discord`。`~/.claude/skills` 与 `~/.claude/channels` 可安全删除，CC 回归纯编码（保留订阅鉴权 + 托管连接器）。
- **引擎封装**：btc-guanfu(=guanfu) · ah-screener(=A/H选股) + us-screener(=美股选股)，二者同一 equity-screener 数仓。
- **本轮新增/重构 7 个**：congress-tracker(国会) · insider-tracker(内部人) · short-interest(做空) · analyst-ratings(评级) · serenity-tracker(白毛股神) · news-bridge(news数据桥) · futu-anomaly(资金/技术/衍生品三维异动 3→1)。
- 分析：research · valuation · market-pulse · sector-analyst · technical-analysis · us-stock-analysis · options-strategy-advisor · institutional-flow-tracker · event-calendar · portfolio-manager · trade-execution · trade-journal · thesis-tracker · value/macro-perspective(大师视角) …
- 数据：futuapi · market-data · news-dashboard · cmc/longbridge/alpaca MCP。

### 2.3 引擎（独立仓库，被 nimbus 以 skill 复用，不内嵌不重写）
- **guanfu**(~/nimbus-stack/guanfu, Go)：BTC/QQQ/SPY/Gold/任意美股 8域指标 + kNN前向收益 + 可靠性标注 + claim校准 + 经典组合(60/40/全天候/永久/巴菲特/全球)偏离。
- **equity-screener**(~/nimbus-stack/equity-screener, Py+DuckDB, 原 ah-stock-screener)：A/H/US 多因子价值选股数仓 + 风险闸 + 大师框架 + 回测，每日 launchd 自动跑。A/H 与 US 各自独立包/DB/CLI/报告，分别暴露为 `ah-screener` / `us-screener` 两 skill。

### 2.4 news（~/nimbus-stack/news, Go, 分支 main）实时 feed 管道
- 26 源：bwenews(ws)/trump.fm/bwe-tradfi/kobeissi/mms/kitco/finnhub/WSJ/Fed/BWE官方RSS + A股扫描×6 + 市场速览 + 观复 + 13F(11基金) + 宏观。
- DeepSeek 翻译(外文→中文替换正文)+ 报告 pro 解读；多渠道推送(微信/Discord)。
- **filefeed 渠道** → 写 `~/nimbus-stack/nimbus/workspace/feed/` 供 nimbus 读。
- A股/HK 数据分层(质量优先)：
  - **news 实时报价**：market service 适配器按优先级 **futu OpenD(持牌级·已在线, prio1) 主源 → 出错自动回退 akshare(prio5) → yahoo**；akshare 已非报价主源，仅兜底。
  - **bot/skill 层质量数据**(报价/日线/财务三表/估值)：nimbus 用 **Longbridge MCP**(持牌·最稳，远程 HTTP `openapi.longbridge.com/mcp`)；Go 侧无 longport 凭证故 news 不直连 Longbridge。
  - **A股独家扫描**(龙虎榜/资金流/涨停梯队/大宗/北向)：只能 akshare(别的源都没有)；news 推送 + equity-screener 数仓(`update-exclusives`)都用它。akshare 爬虫(东财偶断)只承担独家扫描+报价兜底。
  - baostock 实测被 Surge 代理黑洞(裸 socket :10030)+无实时，已弃用。国内期货：无(不需要)。

### 2.5 数据桥（news → nimbus）
- news filefeed 写 `breaking.jsonl`(实时新闻+译文+简评+tickers) + edgar 写 `13f-latest.json`。
- nimbus `news-bridge` skill 读取；`opportunity` 引擎每日用「feed×持仓」找机会。

### 2.6 btcdca 小程序（~/btcdca-miniprogram, 微信前端）
- 资产估值/QDII/懒人组合/Serenity观察。独立前端，连第三方(btcdca.me 非自有)+本地快照兜底。

---

## 3. 自发运转（cron 时刻表，CST）

| 时间 | 模块 | 做什么 |
|---|---|---|
| 每 20 分 | health | 健康自检 |
| 07:30 / 20:30 | portfolio-refresh | 拉 futu+IBKR 真仓 → portfolio_state.json |
| 08:00 | reports(morning) | 晨间体检 |
| 工作日 09:00 | **opportunity** | 主动找机会(news-bridge feed×持仓 + 13F + 国会/内部人/做空/评级交叉) |
| 21:00 | reports(premarket) | 美股盘前 |
| 06:00 | reports(close) | 美股收盘复盘 |
| 周日 21:00 | reflection | 周复盘自进化(行为弱点→记忆) |
| 周一 08:30 | costReport | 额度成本周报 |

> **是的，机器人自发运转**：进程常驻(tmux `nimbus`)，scheduler 按上表触发，每个 cron 任务内 agent **按 skill description 自动选用**相应 skill。DM 来消息即时响应。
> ⚠️ skill 多(40+) → 触发靠 description 质量；新 skill 都写了清晰 NOT-for 边界降低误触发。

---

## 4. 数据源 & Key 清单

| 源 | 用途 | Key/状态 |
|---|---|---|
| Claude 订阅 | agent 引擎 + IBKR/Gmail 托管连接器 | `claude login`(订阅) |
| FMP | 美股基本面(17 skill) | ✅ env |
| Finnhub | 内部人/评级/新闻 | ✅ env |
| FRED | 宏观 | ✅ env |
| Tavily / CMC | 搜索 / crypto | ✅ env |
| futu OpenD | 行情/持仓/异动(异动需数据权限,现 -12104) | 常驻 + 代理 |
| Longbridge MCP | **A股/港股/美股 报价+日线+财务三表+估值(持牌·最稳)** | ✅ secrets/mcp.json |
| QuiverQuant / FINRA / followserenity / trump.fm | 国会/做空/白毛股神/Trump | 免费无 key |
| akshare | A股 独家扫描(龙虎榜/资金流/涨停/大宗/北向) | 免费(爬虫,仅扫描用) |
| baostock | ~~A股日线+财务~~ | ❌ 弃用(被 Surge 代理黑洞,裸 socket :10030) |
| Schwab/嘉信 | — | ❌ 未配(不需要) |
| ibkr-pipeline(ib_insync) | — | ❌ 不建(AI不下单,行情已够) |

---

## 5. 运维方案

### 5.1 启停
```bash
# nimbus(投顾中枢): tmux 常驻
tmux attach -t nimbus              # 看实时
tmux kill-session -t nimbus        # 停
tmux new-session -d -s nimbus -c ~/nimbus-stack/nimbus 'exec bun run src/main.ts >> ~/nimbus-stack/nimbus/logs/nimbus.stdout.log 2>> ~/nimbus-stack/nimbus/logs/nimbus.stderr.log'   # 起

# news(实时feed): 二进制
cd ~/nimbus-stack/news && go build -o bin/platform ./cmd/platform
pkill -f 'bin/platform -config'; set -a; source .env; set +a
nohup ./bin/platform -config config.platform.yaml > logs/runtime.$(date +%Y%m%d).log 2>&1 &

# 依赖: futu OpenD 常驻 + Surge 代理(墙内 gateway)
```

### 5.2 监控
- nimbus 日志 `~/nimbus-stack/nimbus/logs/nimbus.{stdout,stderr}.log`；health cron 每 20 分自检。
- news 日志 `~/nimbus-stack/news/logs/runtime.*.log`；`/metrics`(Prometheus)；source_health → 飞书告警。
- 数据桥 `~/nimbus-stack/nimbus/workspace/feed/` 文件时间戳应每日更新。
- **skill 加载自检**（搬家/改路径后必跑，防 §2.2 软链 dangling 导致 agent 零 skill）：
  ```bash
  test -e ~/nimbus-stack/nimbus/.claude/skills/research && \
    echo "✓ skills 加载正常($(ls ~/nimbus-stack/nimbus/.claude/skills | wc -l) 个)" || \
    echo "✗ skills 软链 dangling — agent 无投资能力，修: ln -sfn ../skills ~/nimbus-stack/nimbus/.claude/skills"
  ```
- **下单安全闸自检**：`test -x ~/nimbus-stack/nimbus/.claude/hooks/trade-guard.sh`（settings.json 用 `$CLAUDE_PROJECT_DIR` 引用，搬家自愈）。

### 5.3 常见故障 → 处理
| 症状 | 原因 | 处理 |
|---|---|---|
| nimbus 不回消息 | 进程挂/Discord token | 看 stderr.log → 重启 tmux session |
| **回复像没 skill 能力**(不触发 research/估值/选股,只会聊天) | `.claude/skills` 软链 dangling(搬家遗留) | `ln -sfn ../skills .claude/skills` 重指；§5.2 自检 |
| agent.run 报 "Usage credits required for 1M context" | 模型解析到付费 [1m] 变体 | models.ts 已 `pick()` 避开 [1m]；确认 config fallback 用标准全名(`claude-sonnet-4-6`/`claude-opus-4-8`) |
| 行情/持仓查不到 | OpenD 掉线 | 重启 OpenD；查 11111 端口 |
| 异动 -12104 | futu 无异动数据权限 | 需开通 futu 数据订阅(可选) |
| news 某源超时(fed/bwe) | 慢服务器 TLS | 健康监控自动重试,非阻断 |
| A股报价/财务空 | — | 走 Longbridge MCP(持牌稳定),不受 akshare 影响 |
| A股扫描空(龙虎榜等) | akshare/东财断连 | 爬虫通病,下周期自恢复;仅影响独家扫描,非报价 |
| 数据桥无 breaking | news 挂/无新闻 | 查 news 进程;feed 是兜底,nimbus 不受影响 |
| 额度告警 | Opus 用量 | 看 costReport;闲聊降档 Haiku |

### 5.4 Key 轮换 / 依赖
- key 在 shell 环境(用户 profile) + `~/nimbus-stack/nimbus/secrets/mcp.json`；轮换后重启对应进程。
- 强依赖：Claude 订阅登录(发动机) · futu OpenD(行情/持仓) · Surge 代理(墙内)。
- 弱依赖(挂了降级不崩)：news feed · 各免费第三方源(快照兜底)。

### 5.5 演进
- 新增能力 = 加 skill(放 ~/.claude/skills/，写清 description+NOT-for) → **跑 `bash scripts/sync-skills.sh` 同步进项目 `skills/`**（只收已 vendored 的投资 skill）→ git commit。daemon 下次 agent.run 即生效（SDK 每次 query 读 FS，无需重启）。
- guanfu/ah-screener 各自独立升级，nimbus 经 skill 复用，无需改 nimbus。
- 周期性：`/memory-consolidate` 整理记忆；reflection 自动复盘进化。

---

## 6. 红线
- **AI 绝不下单**：trade-guard hook + canUseTool deny + IBKR/futu 下单工具 deny。建议参数让本人手动执行。
- 第三方源仅信息参考、非投资建议；btcdca.me 等不依赖。
- 交易军规(R1-R7) 在 trade-journal/trading-rules.yaml，护栏提醒非下单。
