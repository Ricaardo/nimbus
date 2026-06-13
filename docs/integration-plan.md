# Nimbus 整合执行方案（可落地）

> 日期：2026-06-13 ·  形式：**以 nimbus 为中枢，整合 = 新增 skill（原生插件单元）+ news→nimbus 数据桥 + 去重动作**。
> 北极星不变：投资逻辑全走 skill；AI 绝不下单。
> 所有外部源均已实测（见每节「实测」）；无免费源的能力**明确标暂缓**，不写成可执行。

---

## 0. 为什么是「加 skill + 数据桥」而不是合并代码
nimbus 是 Claude Agent SDK agent，**能力单元 = skill**（agent 按 description 自动触发）。所以：
- **补能力 = 加一个 skill**（SKILL.md + 脚本），零改 agent 核心。
- **跨系统数据（news 的实时 feed）= JSON 数据桥**，skill/opportunity 读文件，不耦合进程。
- guanfu / ah-screener 已是 skill，**不重写不内嵌**。

来源项目对应关系：
| 来源 | 精髓 | 落地形式 |
|---|---|---|
| guanfu | 多资产读盘/组合/kNN | 已是 `btc-guanfu` skill（保留） |
| ah-stock-screener | A/H/US 选股 | 已是 `ah-stock-screener` skill（保留） |
| API 数据方案 | Finnhub 内部人(免费)/FMP 基本面/期货外汇债券数据源 | 见 §3.2 §3.4 |
| btcdca 小程序 | Serenity 源 / 经典组合+政治跟单 / QDII | 见 §3.1 §3.3 §3.5 |
| news (Go) | 实时新闻 firehose + 13F/A股扫描结构化数据 | 见 §4 数据桥 + §2 去重 |

---

## 1. 现状缺口（实测核对）

| 能力 | nimbus 现状 | 实测 | 动作 |
|---|---|---|---|
| 多资产读盘/选股/估值/研报 | ✅ skill 齐全 | — | 保留 |
| 美股新闻(Benzinga) | ✅ `alpaca` MCP(get-news) | — | 直接用，无需加 |
| 内部人交易 | ❌ 无 | ✅ Finnhub 免费可用 | **新增 skill §3.2** |
| Serenity(白毛股神) | ❌ 无 | ✅ followserenity.com 200 | **新增 skill §3.1** |
| 经典组合/政治跟单 | ⚠️ 仅 portfolio-manager | 小程序有现成清单 | **新增 skill §3.3** |
| 期货/外汇/债券实时 | ⚠️ 偏弱(ROADMAP 自述) | ✅ yfinance 可用 | **强化 market-data §3.4** |
| QDII 基金 | ❌ 无 | ✅ btcdca.me/akshare | 可选 §3.5 |
| 国会交易 | ❌ 无 | ❌ **无免费源**(Finnhub 付费/公共站已挂) | **暂缓**，见 §3.6 |
| 实时新闻 firehose | ❌(仅 on-demand) | news 已有 | **数据桥 §4** |

---

## 2. 去重动作（先清理，零风险）

1. **冻结 news 的 Go `investor` 模块**（5 大师）——与 nimbus 的 `value-perspective`/`macro-perspective`/`research` 完全重复。投顾归 nimbus。
   - 操作：news 侧 `cmd/platform/investor.go` 不再启用（或删 investor schedule），保留代码备查。
2. **news ↔ nimbus 频道分流**（都发 Discord，不同 bot：我是小川普#3177 / Cici#8105，无 409；只防互刷）。
   - news → 「新闻 feed」频道（forum/webhook）；nimbus → 「投顾/DM」。
3. **合并 5 个 `futu-*-anomaly` skill → 1 个多维异动 skill**（nimbus ROADMAP §1.6 已列）。
4. **BTC 读盘**：news guanfu-score 推快照、nimbus btc-guanfu 对话深答——同源 guanfu，分用途，保留。

---

## 3. 新增 / 强化 skill（build-ready）

> 统一约定：skill 放 `~/nimbus/skills/<name>/`，含 `SKILL.md`（frontmatter: name/description 决定触发）+ `scripts/`。脚本读 key 从环境（FMP/Finnhub 等已在用，见 stock-screener 的 fmp_client.py 模式）。

### 3.1 `serenity-tracker` —— 白毛股神 Serenity 持仓观点 ✅
- **数据源（实测 200）**：`https://www.followserenity.com/`（Thesis Tracker 静态页，~7MB，内嵌持仓/观点数据）。来源：本人 X `@aleabitoreddit`。
- **SKILL.md frontmatter**：
  ```yaml
  name: serenity-tracker
  description: 追踪「白毛股神」Serenity(@aleabitoreddit)的持仓观点/Thesis Tracker(AI 半导体供应链瓶颈选股)。
    当用户问「白毛股神/Serenity/瓶颈理论/他最近看好什么/aleabitoreddit」时触发。
    NOT for: 个股深度分析→us-stock-analysis；通用选股→ah-stock-screener。
  ```
- **脚本** `scripts/fetch.py`：GET followserenity.com → 从内嵌 JSON/HTML 抽 thesis 列表(标的/方向/逻辑/更新时间) → 输出精简表 + 快照兜底（仿小程序：成功后写本地快照，失败回退）。
- **NOT-for**：不照抄下单；标注「自述战绩、未审计」。

### 3.2 `insider-tracker` —— 内部人交易 ✅
- **数据源（实测免费）**：Finnhub `GET /stock/insider-transactions?symbol=X&token=$FINNHUB_API_KEY`（已实测拉到 NVDA 数据）。key 复用 news 的 `FINNHUB_API_KEY`（放 nimbus 环境）。
- **SKILL.md**：`description: 查个股内部人(高管/董事)买卖披露(SEC Form 4)。问「X 内部人/高管增减持/insider」触发。`
- **脚本** `scripts/insider.py`：传 symbol → 拉近 N 月 → 汇总净增减持 + 重大单 → 表格。
- **联动**：与 `institutional-flow-tracker`(13F) 互补（一个内部人、一个机构）。

### 3.3 `lazy-portfolios` —— 经典组合 + 政治跟单 ✅
- **数据来源**：迁移 `~/btcdca-miniprogram/data/portfolios.js`（20+ 套：60/40 / 全天候 / 永久 / 三基金 / 目标日期 / Pinwheel / Merriman / 人民币 QDII + **佩洛西跟单 / 特朗普信托**）。组合权重是静态策展数据，直接拷成 `scripts/portfolios.json`。
- **偏离/再平衡**：复用 guanfu `allocate` 思路（或调 `btc-guanfu`/`portfolio-manager` skill 算当前权重 vs 目标）。
- **SKILL.md**：`description: 经典懒人组合(全天候/永久/三基金/Pinwheel/Merriman)+政治跟单(佩洛西/特朗普信托)的配置、权重、再平衡参考。问「经典组合/懒人配置/全天候/佩洛西跟单/政治跟单」触发。`
- **注**：政治跟单原 `btcdca.me/api/v2/political-portfolios` 已 404 → 用迁移的静态清单 + 标注「估算/非实时」。

### 3.4 强化 `market-data` —— 期货/外汇/债券 ✅
- nimbus ROADMAP 自述「债券/外汇/期货实时数据偏弱」。
- **数据源（免费）**：yfinance 符号——期货 `ES=F/NQ=F/CL=F/GC=F`、外汇 `EURUSD=X/USDJPY=X/DXY`、债券 `^TNX/^TYX/TLT`。
- **落地**：在现有 `market-data` skill 的脚本里**补这三类符号映射 + 报价/历史**（不新建 skill，扩展即可）。IBKR 连接器(只读)可作实时增强（订阅 auth 下可用）。

### 3.5 （可选）`qdii-funds` —— QDII 基金
- 仅在你实际配 QDII 时做。**数据源（实测 200）**：`https://btcdca.me/us-fund-holdings/api/funds`（第三方，兜底 akshare 场内基金）。输出关键指标/经理/持仓/费率/排序。

### 3.6 国会交易 —— ⛔ 暂缓（无免费源）
- 实测：Finnhub congressional = **付费**；housestockwatcher / senate-stock-watcher 公共数据**已挂(000/403)**；btcdca.me political-portfolios **404**。
- 结论：**当前无可靠免费源**。选项：① 付费 Quiver Quant；② 等公共源恢复。**不写成可执行 skill**，先在本文件挂账。

---

## 4. news → nimbus 数据桥（唯一值得做的系统级整合）

让 nimbus 投顾能基于 news 的**实时 firehose + 结构化独家数据**推理（如「这条突发对我持仓什么影响」「今日 13F/A股候选有什么」）。

### 形式：news 写 JSON 落盘 → nimbus 读（不耦合进程）
- **news 侧**：新增一个轻量 sink/导出，把结构化产出写到共享目录 `~/nimbus/workspace/feed/`：
  - `feed/13f-latest.json`（13F 持仓变动，已有 edgar_13f.py 产出，改写到此路径）
  - `feed/ashare-candidates.json`（A 股扫描候选）
  - `feed/breaking.jsonl`（重大突发：trump/bwe，append，带时间/标的/译文/简评，保留近 24h）
- **契约（JSON schema）**：
  ```json
  {"ts":"2026-06-13T10:00:00+08:00","source":"trump-rss","title":"...","zh":"中文译文",
   "tickers":["NVDA"],"impact":"利好|利空|中性","note":"一句简评","link":"..."}
  ```
- **nimbus 侧**：新增 `news-bridge` skill —— 读 `~/nimbus/workspace/feed/*`，供 agent 在「最近有什么大事/影响我持仓吗」时引用；或让 `opportunity` cron 模块每日扫 `breaking.jsonl` × 真实持仓 → 主动提示。
- **优点**：news 当 nimbus 的实时数据源，nimbus 当会推理的投顾；各自最强，零重写、进程隔离（news 挂不影响 nimbus）。

---

## 5. 执行顺序 + 验收

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P0 去重** | §2：冻结 news investor · 频道分流 · futu-anomaly 合并 | Discord 不再双推投顾；news 只发 feed |
| **P1 新增 skill** | §3.1 serenity · §3.2 insider · §3.4 期货外汇债券强化 | DM「白毛股神最近看好啥」「NVDA 内部人」「ES 期货报价」有结果 |
| **P2 组合** | §3.3 lazy-portfolios（迁小程序清单） | DM「全天候组合 / 佩洛西跟单」返回配置 |
| **P3 数据桥** | §4：news 写 feed/*.json + nimbus news-bridge skill + opportunity 接入 | DM「最近大事对我持仓影响」引用到 news feed |
| 挂账 | §3.6 国会交易（待免费源）· §3.5 QDII（按需） | — |

> 建议 **P0 → P1**（清理 + 立刻可见的新能力），再 P3 数据桥（系统级价值）。P2 组合数据可随时。

---

## 6. 边界
- guanfu / ah-screener / 小程序 **保持独立**，nimbus 以 skill / 数据桥复用，不内嵌不重写。
- btcdca.me、followserenity.com、trump.fm 均第三方 → **做快照兜底**（仿小程序模式），不强依赖。
- 新增 skill 都附「未审计/非投资建议」免责 + 不下单红线。
- key 复用：FMP/Finnhub 已在用；新 skill 读同一环境变量，不新增账户。
