# Nimbus 独立化与优化 — 最终方案（规划，未开发）

> 目标:让 Nimbus 成为可独立运行、越用越懂你、省额度的投资顾问机器人。
> 日期:2026-06-11(已 review)· 状态:规划 / 待批准后开发

## TL;DR（执行摘要）
- **现状**:M0–M8 全通,核心链路(收消息→拉真数据→简洁分析→安全闸)已 live 验证;IBKR/Gmail 等托管连接器订阅 auth 下**已验证可调**。
- **三件事**:① **省额度**(根因=大固定上下文×多步工具往返×Opus → 瘦身上下文+模型分层);② **加记忆/自进化**(最大短板,Hermes 的强项;且**现在 bot 根本没读到你 11 条 CC 记忆**——独立与"懂你"在此合流);③ **文件/机器独立**(搬 CLAUDE.md/hooks/吸收外部 cron/迁用户知识进项目,**留本机、不脱 claude.ai**)。
- **架构升级**:顾问状态模型 + 决策台账(可问责)+ 数据缓存 + 证据型软护栏(军规→强提醒)。不建通用金融 KB,不拆多 subagent。
- **顺序**:P0 快赢(含军规改文案,1-2天)→ Phase1 省额度(3-5天)→ Phase2 记忆+自进化(1-2周,核心)→ Phase3 独立(本机自包含)→ Phase4 打磨。
- **护城河**:聚焦投资+硬安全(AI 不下单),不打广度战、不换地基、不自动生成交易逻辑。
- **已定 5 项 + 待拍板 4 项**:见末尾「决策记录」。

---

## 0. 现状（已验证可用）
- M0–M8 全通:Discord+TG 独占、三档路由(L0直连/L1 Sonnet/L2 Opus)、L0 行情秒回、深度分析能拉真数据(futu/market-data,PATH 修复后)、持仓感知注入、行为护栏、主动告警、日报、权限转 Discord、AI 绝不下单(双闸)。
- 37 个投资 skill 已 vendored 进 `~/nimbus/skills/`,但 **agent 仍从 ~/.claude 加载**。
- 依赖 CC 环境的部分:CLAUDE.md、hooks(trade-guard)、portfolio_state.json 的生成、MCP 配置+keys、python(miniforge)、IBKR(claude.ai 托管)。

---

## Q1 — 脱离 CC 还需迁移/完善什么

**先定"独立度"(关键)**:目标是 **文件/机器独立(自包含可移植)**,**不是脱离 claude.ai 账户**。`claude` CLI + 订阅登录是 nimbus 的发动机——它带来订阅定价、CC skill 引擎、**已验证可用的 IBKR/Gmail 等托管连接器**。脱离 claude.ai = 拆地基(丢这些,还得自接 IBKR),违背北极星。**独立 = 在任意机器装 claude CLI + login,而非甩掉它。**

**结论:skill 本身基本齐了(37 个),真正缺的是"支撑基础设施 + 外部 cron + 用户知识"。** 按依赖图分块:

### 1.1 加载切换（让 agent 用项目自带 skill）
- 现:`settingSources:['user','project','local']` + cwd=workspace → 从 ~/.claude 读。
- 改:项目根放 `.claude/skills`(或 symlink 现有 vendored)、cwd 指向项目根、settingSources 去 'user' 留 'project'+'local'。
- 风险:去 'user' 会丢 ~/.claude 的 CLAUDE.md 和 hooks → 必须先把它们也搬进项目(下)。

### 1.2 CLAUDE.md + hooks（人设与护栏）
- **项目专属精简 CLAUDE.md**:只保留投资顾问相关(人设/牛熊分工/持仓铁律/AI不下单),**砍掉** 全局那套 15-skill 长文(顺带大幅省 token,见 Q3)。
- hooks 搬进项目:`trade-guard.sh`(PreToolUse 下单拦截)、`trade-guardrail`(UserPromptSubmit 军规提醒)、behavior_monitor。放项目 `.claude/hooks/` + settings.local。

### 1.3 ★持仓刷新管线（最关键的缺口）
- 现:`portfolio_state.json` 由**外部** CC 系统(com.cici.advisor-briefing + L1 脚本)拉 futu+IBKR 生成。Nimbus 只读不写。
- 缺:Nimbus 必须**自己拥有刷新管线**——定时跑 futu(futuapi 脚本)+ IBKR 拉持仓 → 写 portfolio_state.json。否则脱离 CC 后持仓数据会过期。
- 落地:project `modules/portfolio-refresh`(cron)+ 复用 futuapi 脚本 + 自建 IBKR 拉取(下)。

### 1.4 IBKR ✅ 已 live 验证可用（订阅 auth 自动继承托管连接器）
- **结论(2026-06-11 实测,推翻早前 d.ts 推断)**:nimbus 在订阅 auth 下**自动继承 claude.ai 账户的全部托管连接器**——IBKR / Gmail / Google Drive / Calendar / Candid 都出现在 SDK 的 mcp_servers,**且 IBKR 能真调**(实测拉到 净值$1,976.5 / 现金$750 / MRVL 5股)。**不需要 ib_insync / 自有 API。**
- 机制:连接器随 `claude login` 订阅态注入(不是经 `mcpServers` 声明,SDK 自动带)。所以**只要 nimbus 走订阅 auth,IBKR 就免费可用**。
- ⚠️ **安全**:IBKR 连接器含 `create_order_instruction`/`delete_order_instruction`(下单工具)——已被 **canUseTool MCP_DENY_EXACT + settings.local deny 双重硬拦**,READ(持仓/余额)可用、下单 deny。红线不变,但**务必保持** deny(连接器现可达,deny 是唯一闸)。
- ⚠️ **独立性代价**:这些连接器**依赖 claude.ai 订阅登录态**。若 Phase 3 要**彻底脱离 claude.ai auth**,连接器会失效 → 那时才需 ib_insync 自接。当前模型(订阅 auth)下**无需任何 IBKR 开发**。
- 副产物:Gmail/GDrive/GCalendar 也可用(Gmail send 已在 ASK 名单 → 触发 Discord 审批)。可按需利用(如读财报邮件/日程)。

### 1.5 依赖与密钥（可移植性）
- **Python venv**:项目自带 requirements(futu / yfinance / akshare / pandas / numpy / scipy…),固定解释器(现 PYTHON_BIN 指 miniforge → 改项目 venv)。
- **Node**:crypto skill(hyperliquid/polymarket)的 node_modules(vendored 时排除了,要重装)。
- **MCP**:项目 `.mcp.json`(cmc/alpaca/tavily/futu-stock)+ 各自 API key。
- **密钥**:项目 `secrets/.env`(tavily/cmc/alpaca/FMP/Finnhub/iwencai/binance-square…)。当前散在 ~/.claude。
- **外部服务**:OpenD(futu 网关)需常驻;OnchainOS 等按需。

### 1.7 ★吸收外部 launchd cron（独立的硬依赖）
- 现:4 个 `com.cici.*` launchd 跑在 nimbus 之外,喂着 nimbus 依赖的数据:
  - `stop-check` → `stop_check_cron.sh`(**刷新 portfolio_state.json** + 止损检查)
  - `advisor-briefing` → `briefing_cron.sh`(日报——**与 nimbus reports 重复,去重**)
  - `behavior-monitor` → `behavior_cron.sh`(跑 `trade-journal/scripts/behavior_monitor.py`)
  - `channel-log-rotate` → `rotate-logs.sh`(nimbus 有自己的日志,可弃)
- 做:nimbus scheduler **吸收功能性的三个**(portfolio 刷新 / behavior 监控 / 止损),停掉外部 launchd 防双跑。

### 1.8 ★用户知识迁移（"懂你"的命脉,与 Phase 2 同源）
- 发现:**11 条 feedback 记忆 + MEMORY.md** 是 CC harness 的 auto-memory,**Agent SDK 不作为 settingSource 加载** → nimbus agent 现在**很可能根本没读到这些**(只有 memory.ts 硬编码的静态画像)。
- 影响:bot 的"懂你"被严重低估了——别教条、SOXL 教训、逆势/接飞刀弱点细节、券商账户事实…这些演进出来的知识 agent 没拿到。
- 做:把这 11 条(+ 持续新增)迁进 nimbus 自己的记忆层(Phase 2 的 SQLite 三层记忆),memory.buildContext 检索注入。**Phase 2 与 Phase 3 在此合流。**

### 1.9 部署目标 ✅ 锁定本机
- **决策(主人定):留本 Mac。** 依赖 Surge 6152 代理 + OpenD 常驻 + miniforge,这些已就位。
- 含义:不追 VPS/单命令安装的"完全可移植"——独立目标收敛为"**不依赖 ~/.claude 散落文件 + 自己吸收外部 cron + 自带用户知识**",仍跑在本机的 claude CLI + 订阅。工作量大减(省掉跨机重装)。

### 1.6 skill 完善（可选）
- 合并冗余:5 个 `futu-*-anomaly` 可整合成一个多维异动 skill。
- 校验每个 skill 在"纯项目环境"能跑(数据源/key/包齐全);剔除依赖 claude.ai 托管能力的。
- 缺的能力:暂无明显空白;若要,补"债券/外汇/期货"的实时数据源(现偏弱)。

---

## Q2 — 架构优化（上下文 / 记忆 / 自进化）

### 2.1 上下文纪律（直接省钱,见 Q3）
- **buildContext 每轮重注入** → 改为**每会话注入一次**(resume 已带历史),volatile 持仓块单独、按需刷新。
- 精简注入:风险画像静态部分进 systemPrompt(可缓存),只有"当前持仓快照"动态注入。
- 长会话:依赖 SDK auto-compaction;可加"关键事实置顶/pin"避免被压缩丢掉(论点/止损位/用户偏好)。

### 2.2 持久记忆层（当前几乎没有）
- 现:session_id(对话连续)+ audit(日志,不可检索)+ portfolio_state(状态)。**没有跨会话的语义记忆。**
- 痛点实例:你昨天教它"别教条"——那是 session 内的;**换个会话/重启就忘了**。用户偏好、历史决策、论点、结果都没沉淀。
- 方案:项目级记忆库(SQLite FTS5 + 可选 embedding),三类——
  - **偏好/反馈**(persistent):"别教条""先说市场再给建议"等指令永久生效。
  - **决策/论点**(episodic):问过什么、买了什么、论点是什么、止损位。
  - **结果/教训**(outcome):建议对不对、复盘结论。
- memory.buildContext 升级为**检索增强**:按当前问题召回相关记忆,而非只塞静态画像。
- 跨渠道统一:Discord/TG 同一主人 → 同一记忆与会话上下文。

### 2.3 自进化（闭环学习）
- **结果闭环**:建议 → thesis-tracker/trade-journal 跟踪 → 价格对照 → 对错入"教训"记忆 → 反哺护栏。
- **周反思任务**(类 /memory-consolidate):每周自动复盘本周交互+决策,提炼重复错误,更新行为上下文。当前护栏是**静态关键词**(满仓/杠杆/接飞刀);自进化让它从**真实 trade-journal 数据**学出个性化弱点。
- **反馈捕获**:用户纠正(如"别教条")→ 自动落偏好记忆,下次默认遵守。

### 2.4 可靠性
- MCP/OpenD 健康检查 + 自动重连/重启;额度感知退避(见 Q3);多渠道一致性。

### 2.5 知识库决策 — 不建通用金融 KB
- Claude 模型本身已装海量金融/经济知识 + skill 已编码方法论 → 通用 KB **冗余/会过时/占 token**,违背北极星(别重做模型已有)。
- 真正要补的不是 RAG 大块,而是:① **用户专属知识**(哲学/打法/教训/清单逻辑)→ Phase 2 记忆;② **薄"小众参考"包**(合约规格/税务/券商怪癖/行业分类映射/你的简写术语表)——模型易错的小事实,小而精;③ 实时数据(已有工具)。

### 2.6 架构优化（robo-advisor 专属,按价值排）
- **① 顾问状态模型(world-model)**:持久维护"当前 regime + 在跟论点 + watchlist + 待决策",跨会话/渠道一致,驱动主动性(现每轮无状态 agent.run)。
- **② 决策台账(decision ledger)**:每条建议结构化记录(标的/方向/理由/当时数据)→ 事后对照结果 → 喂自进化。**"可问责顾问" vs 聊天机器人的分水岭**;audit 表是起点,需升级成 decisions 表。
- **④ 短 TTL 数据缓存**:同一标的别在一次分析里重复拉 → 省工具往返(=省额度+提速)。
- **刻意不做**:深度分析不拆多 subagent 扇出(对额度更糟);保持单 agent + 优化工具往返。

### 2.7 军规 → 强提醒（去教条,主人明确要求）
- 现:`trade-guardrail.sh`(UserPromptSubmit)把 R1-R7 当**硬规则**注入 + guardrail 模块**强制 pre-mortem 盘问** → 教条。
- 改:命令式("禁止/必须")→ **证据型强提醒**(摆你真实持仓+历史,如"SOXL 上次亏 $1,630/-7.4%,右侧确认了吗?",让你自己定)。**唯一保留硬线 = AI 绝不下单**(安全契约,非教条),其余全转软提醒。
- 持久化:"别教条"等偏好进记忆永久生效(现换会话即忘)。
- 拆分:**语气改写 = P0 快赢(现在就能改 hook + guardrail 文案)**;证据型+持久化 = Phase 2(需记忆)。

---

## Q3 — 为什么订阅额度烧得快（根因 + 削减）

**核心:每次深度提问 = 大固定上下文 × 多次工具往返 × Opus 单价。** 按贡献排序:

| # | 根因 | 说明 |
|---|---|---|
| 1 | **Agentic 多步工具调用** | 一次深度分析调 N 个工具(行情/财报/技术/同行…),**每步都把完整上下文重发一遍**。N×大 = 最大头。 |
| 2 | **固定上下文巨大** | CC 预设 systemPrompt(很大)+ 全局 CLAUDE.md(15-skill 长文)+ 47 skill 描述 + 4 个 MCP 的工具 schema。每个请求都带。 |
| 3 | **buildContext 每轮重注入** | 持仓+画像+规则每轮塞,加 token 且 volatile 数据**打断 prompt cache**。 |
| 4 | **Opus 默认深度 + 日报/告警走 Opus** | Opus ≈ Sonnet 5x 单价;3 个日报 + 告警都 Opus。 |
| 5 | **闲聊也触发完整 run** | "hi" 也走 Sonnet 全上下文(无 Haiku 档)。 |
| 6 | **定时负载** | 3 日报/天 + 15 分钟告警扫描(每次真告警=一次 Opus run)。 |
| 7 | **缓存未优化** | volatile 注入靠前 → 破坏稳定前缀缓存 → 整段重算。 |

**削减方案(按性价比)**:
- **A. 瘦身上下文(最大杠杆)**:项目精简 CLAUDE.md + **只加载用得到的 skill**(非全 47 个描述)+ 裁剪 MCP 工具面。每请求 token↓,且因 #1 每步往返都受益 ×N。
- **B. buildContext 每会话一次 + 缓存友好**:静态进 systemPrompt(可缓存),volatile 持仓单独小块、定期刷新。
- **C. 模型分层更狠**:**加回 Haiku 档**给闲聊/操作;Sonnet 默认;Opus 只给明确深度。
- **D. 减少工具往返**:常规查询优先 L0/直连;给 agent 步数上限;轻问用轻 skill。
- **E. 定时降本**:日报减量或常规用 Sonnet、只周深度用 Opus;告警扫描只 detector(纯状态,不起 agent),真命中才 Opus。
- **F. Prompt caching**:稳定前缀(system+tools+skills)做成跨轮命中。
- **G. 额度预算守卫**:跟踪日/周 token,主动任务超预算退避 + quiet hours;DB 记 usage。

> 预估:A+B+C 三项落地,深度提问 token 可降 **40-60%**(主要砍固定上下文 ×N 往返),闲聊降 **>80%**(转 Haiku/L0)。

---

## 分阶段路线图（建议顺序 + 工作量 + 验收）

**排序逻辑**:省额度(Phase 1)= 立即见效、低风险、不依赖独立,**先做**;记忆/自进化(Phase 2)= 战略差异化(竞品验证的短板),**紧随**;完全独立(Phase 3)= 工作量最大、最后做(且非紧急,现状能跑)。

### ⚡ P0 快赢 ✅ 完成（2026-06-11）
- ✅ systemPrompt 结论先行+简洁、删 grok-search、三档路由、L0 直连。
- ✅ **buildContext 每会话注入一次**(dispatcher: 仅首轮无 prior session 时注入,resume 带走)。
- ✅ **Haiku 档**(router 加 'haiku' tier + CASUAL_WORDS;闲聊/问候/记笔记 → `claude-haiku-4-5`)。
- ✅ **日报转 Sonnet**(REPORT_MODEL = SONNET_MODEL)。
- ✅ **军规→强提醒**(guardrail detect 改证据型软提醒,去"强制/必须/禁止";唯一硬线 AI 不下单另在 safety)。
- 478 测试绿,已 reload 上线。

### Phase 1 — 省额度（部分完成 2026-06-11）
- ✅ **G 用量跟踪**:每次 agent.run 捕获 `total_cost_usd`+token 入 `usage` 表(db.logUsage/getTodayCost);超 `DAILY_COST_BUDGET_USD`(默认$5)stderr 提示(advisory,不硬拦红线告警)。
- ✅ **F 缓存**:已由 P0 的 buildContext-once 实现(volatile 不再每轮注入,稳定前缀可缓存)。
- ✅ **E 告警**:经核 EventSource 本就是 detector 纯函数扫描,只在真命中+过闸才起 agent——已高效,无需改。
- ⬜ **A 瘦身上下文(剩下的大头,Phase 3 纠缠)**:精简 CLAUDE.md + 按需加载 skill,**需 loading 切换**(去 'user' 源、用项目 .claude/skills)——风险高(可能弄坏正跑的 bot),放 Phase 3 独立化时一起做。
- **可见性**:`sqlite3 ~/nimbus/data/state.db "select date(ts/1000,'unixepoch','localtime') d,model,round(sum(cost_usd),3) cost,count(*) n from usage group by d,model"` 看每日每模型成本。

### Phase 2 — 持久记忆 + 自进化（Part 1 ✅ 2026-06-11 / Part 2 待续）
**✅ Part 1（记忆基座）已上线**:
- `memories` 表(kind=preference/profile/decision/lesson + slug 去重 + active 可回滚)；db `remember/getPersistent/recall/deactivate`。
- memory.ts `setMemoryStore` + buildContext 注入"已学到的偏好"块(持久,首轮)；dispatcher per-message `recall` 注入相关决策/教训。
- **迁移 11 条 CC feedback 记忆**(`scripts/import-memories.ts`,slug 去重可重跑)——解决"Agent SDK 没加载 CC auto-memory"。
- **反馈捕获**:`记住 X` 快路径 → 存 preference,长期生效(解决"换会话就忘")。
- 安全:可回滚(deactivate)防学歪。479 测试绿。
**⬜ Part 2(自进化闭环)待续**:决策台账(decisions 表:建议→理由→结果)、周反思任务(从 trade-journal 学个性化弱点)、recall 升级 FTS5/embedding、跨渠道统一。
- **KPI**:偏好持久命中率;复盘提到的历史决策准确率。

### Phase 3 — 完全独立（loading 切换 ✅ 2026-06-11 / 余下待续）
- ✅ **加载切换(核心)**:agent settingSources=['project','local'] + cwd=PROJECT_ROOT;新建 `~/nimbus/.claude/`(精简赚钱版 CLAUDE.md + skills 软链 vendored 37 + trade-guard hook + settings.json IBKR deny)。影子测试通过后切线上:精简省额度 + 甩掉全局 R1-R7 军规 hook + 文件独立。代价:claude.ai 连接器(IBKR/Gmail)退出。
- ⬜ **持仓刷新管线(1.3,最重)**:nimbus 自拉 futu+IBKR 写 portfolio_state.json,吸收外部 launchd cron(1.7)。现暂靠 L1 cron 续刷(IBKR 仍可见)。
- ⬜ **IBKR 自接(补 live 查询)**:ib_insync+IB Gateway,或窄连接器刷新作业。需 Gateway/creds。
- ⬜ keys/MCP/venv 内置(本机部署,1.9 已锁本机,跨机重装不追)。
- **验收**:`~/.claude` 移走后 Nimbus 仍正常(红线/护栏/人设/数据全在)。loading 切换已达成大部分;持仓刷新管线是剩下的独立硬骨头。

### Phase 4 — 打磨（按需）
- 可靠性(MCP/OpenD 健康检查+自愈)、IBKR 自接(若需)、skill 合并(5 个 futu-anomaly)、债/汇/期数据源补强、可选新渠道(iMessage/WhatsApp)。

---

## 竞品借鉴 — OpenClaw / Hermes（2026-06-11 调研）

| | OpenClaw(Steinberger, 247k★) | Hermes Agent(Nous, MIT, 46k★, 已装@JeeeffBot) |
|---|---|---|
| 定位 | 本地"全能"自治 agent(OS/浏览器/10+渠道) | 自托管持久 agent,**记忆+自进化** |
| 卖点 | 广(什么都能干) | **三层记忆(技能/对话/用户建模)+ 闭环学习(自动写 skill)** |

**判断:借"记忆/自进化/可移植",不借"广度"。** Nimbus 差异化 = 聚焦投资 + 硬安全(AI 不下单)+ 真实持仓 + 行为护栏,不打"能干多少事"的广度战(广度=攻击面,对钱 bot 是负债)。

**该借(高价值,补 Q2)**:
- **三层记忆(Hermes)** ↔ Q2.2:用户建模(画像/偏好"别教条"/弱点,**跨会话持久**)+ 对话记忆(FTS/embedding)+ 教训记忆(复盘对错)。
- **闭环学习(Hermes)** ↔ Q2.3:但**只学偏好与行为模式,不自动生成投资 skill**(管钱 bot 自创策略=学歪风险)。从真实 trade-journal 学个性化弱点强化护栏,替代静态关键词。
- **单命令安装+自带依赖(Hermes)** ↔ Q1/Phase3 可移植性标杆。

**可选借(OpenClaw)**:更多渠道(iMessage/WhatsApp/Signal,Channel 接口已解耦,加 adapter 便宜)、群聊补齐。

**⛔ 刻意不借**:OpenClaw 式"接管 OS + computer use 全自动"(能力面=失控面,违背安全聚焦);**不把 Nimbus 迁去 Hermes/OpenClaw 框架**(它们接任意 LLM,会丢 Agent SDK 复用 CC skill/MCP 的北极星)。借思路不换地基。

> 净结论:Nimbus 在**渠道/编排**上已不输,在**记忆/自进化**上落后 Hermes——这正是 Phase 2 要补的,竞品验证了优先级。

---

## 非目标 / 边界（护城河,任何阶段不越界）
- **不打广度战**:不追"能干任意事/接管 OS/computer use"(OpenClaw 路线)——对管钱 bot,能力面=失控面。聚焦投资。
- **不换地基**:不迁去 Hermes/OpenClaw/任意 LLM 框架——必须保 Agent SDK **复用 CC skill/MCP** 的北极星。
- **不自动生成投资逻辑**:自进化只学偏好/弱点,绝不让它自创策略/自动写交易 skill。
- **AI 绝不下单**:任何阶段红线不松动(双闸:trade-guard hook + canUseTool)。
- **不重做 CC**:Nimbus = 渠道+编排+触发+安全+记忆层,投资分析全交 skill。

## 决策记录

**✅ 已定**:
- **独立度** = 文件/机器独立(不脱 claude.ai 账户,保订阅+SDK+连接器)。
- **部署** = 留本机(Mac + Surge 代理 + OpenD,不上 VPS)。
- **IBKR** = 用托管连接器(已验证可调),**不**自接 ib_insync。
- **金融知识库** = 不建通用 KB;补用户知识(记忆)+ 薄参考包。
- **军规** = 改成证据型**强提醒**(去教条);唯一硬线保留 AI 不下单。

**⬜ 待拍板**:
1. **先做哪个 Phase?** 建议 P0 快赢 → Phase 1(省额度) → Phase 2(记忆/自进化,战略核心)。
2. **加回 Haiku 档?**(闲聊/操作用 Haiku 省额度)——建议加。
3. **记忆库选型**:纯 SQLite FTS5(轻)vs + embedding(召回强)?建议先 FTS5。
4. **新渠道**要不要(iMessage/WhatsApp)?现 Discord+TG,建议暂不。

## 风险 / 权衡
- 独立后**维护双份**(项目 skill vs ~/.claude)会漂移——需定同步策略或彻底切断。
- 精简 CLAUDE.md 可能丢某些隐性行为 → 需回归测试(红线/护栏/人设)。
- 持仓刷新管线 + IBKR 自接是真开发量(非配置),Phase 3 最重。
- 记忆库自进化要防"学歪"(把错误偏好固化)——需人工可审/可回滚。
- 额度守卫不能误伤红线告警(止损类仍须及时)。

---

## 后续待办池（2026-06-12 收尾,按价值排,未做）

> 已完成的核心(三档/记忆/自进化/机会引擎/隐私隔离/embed/动态模型/长桥/代理)见各章 + git 历史。
> 下面是想到但暂缓的,随时可挑一个继续。

### 数据 / 持仓
- **长桥持仓 ❌ 不并入(2026-06-12 实测=模拟盘)**:长桥 MCP 账户绑的是**模拟/Paper 账户**(IBIT 1733分数股/现金≈0/净值与持仓矛盾/320万整数融资额=demo 特征;主人确认真实账户无持仓)。**持仓数据不可信,绝不并入真实组合。长桥只当行情/数据源(行情真实)。** 若要真实账户:需真实户开通 OpenAPI 权限后重新 OAuth;但 futu/IBKR 已覆盖真实持仓,长桥保持纯行情源最干净。
- **三账户统一净值视图**:futu + IBKR + 长桥 总资产/总盈亏/跨账户集中度。
- 论点 theses 导入:`~/.claude/skills/.../theses/` 现空 → 让 bot 帮你给现有持仓建论点 YAML(thesis-tracker),周反思/decay 才有素材。

### 能力 / 体验
- **Discord embed 用到更多场景**:机会扫描/告警也可上 embed 卡片(现仅成本周报/健康)。
- **决策台账结果回填自动化**:现靠周反思人工对照;可让刷新作业按价格自动 closeDecision(命中目标/止损)。
- **图表能力增强**:让 agent 默认对深度个股分析配 K 线/对比图(现要显式要求)。
- browser-use:JS 渲染页/登录抓取/截图(边缘,真遇到再加)。
- 语音输入(TG/Discord 语音 → STT → 提问)。

### 架构 / 独立性
- **完全独立(脱离 ~/.claude)**:7 个 skill 脚本硬编码 ~/.claude 路径 + state/历史数据在 ~/.claude → 改路径 + 数据迁项目。本机部署下非必须,半独立合理。
- vendored skills 自动同步:现 `sync-skills.sh` 手动;可加 cron 定期同步 + 自动 commit。
- 多用户正式化:现隐私隔离按 OWNER_IDS;若要给家人/朋友只读访问,可加"访客模式"分级。

### 运维 / 可靠性
- **代理/连通自愈扩展**:health 现只查 OpenD;可加 gateway/长桥/各 MCP 健康 + 自动重连。
- 成本预算硬限:现超 $5/天仅提示;可选硬停主动任务(保留红线告警)。
- 知识库 recall 升级:现关键词;可上 embedding 向量召回(更准,需向量库)。

### 已知小修(技术债)
- guardrail/memory 的 SOXL 等具体案例数字是硬编码,应改从 trade-journal 真实数据读。
- buildContext 持仓摘要 only top-5 by weight;可配。
- TG markdown:grammY 的 MarkdownV2 转义未做(现纯文本,主人说不做)。
