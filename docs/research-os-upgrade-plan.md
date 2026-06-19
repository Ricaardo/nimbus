# Nimbus → Investment Research OS 升级方案（彻底版）

> 日期：2026-06-19 · 范围：知识层(RAG) + OpenBB 接入 + TradingView 评估 + 体系架构优化
> 前提结论：**nimbus 已经是 Investment Research OS**，本方案是「增量补强」，不另起 LangGraph 第二大脑。
> 对照评估见对话记录；本文是可执行的工程方案。

---

## 0. 设计原则（先定边界，免得越做越像方案那套重栈）

1. **单一大脑**：编排继续走 nimbus 现有的 cron scheduler + Claude Agent SDK + 四档路由。**不引入 LangGraph**。
2. **单用户、本地优先、免费优先**：不上 Postgres/MinIO 重栈；向量库复用 SQLite（sqlite-vec），embedding 用本地模型。延续 [[nimbus-cost-optimization]] 的省额度原则。
3. **接现有抽象，不另造**：知识层接 `MemoryStore` 接口；数据源接 MCP；产物接现有 skill 目录约定。
4. **A/H/US 三市场不退化**：吸收方案的 schema/管线思路，但保留持牌源（futu/longbridge）与 A 股独家扫描（akshare）的优先级。
5. **红线不动**：AI 绝不下单（trade-guard hook + canUseTool deny 双闸）。

---

## 1. 知识层（RAG）— 核心，最高 ROI

### 1.1 问题陈述
- research 报告、thesis、trade-journal、reflection 复盘 = **散落 markdown**（`skills/research/ideas`、`skills/thesis-tracker/theses`、`skills/trade-journal/reports` …）。
- `state.db` 的 `memories` 表只有 11 条 `preference`；`recall()` 是关键词匹配（`src/core/db.ts:279`），命中率低、不跨语言、不语义。
- 后果：**每次分析都冷启动**。半年前对 NVDA 的判断、踩过的坑、写过的 thesis，分析时调不回来 → 知识不复利（违反方案 Principle 4，也是 nimbus 当前最大短板）。

### 1.2 接入点（关键发现）
`src/core/memory.ts` 已定义 `MemoryStore` 抽象，`recall(query, limit): string[]` 已被 `buildContext()` 和各处调用。
**知识层就是把 `recall` 从关键词升级成向量检索 + 扩大语料范围**，调用方零改动。

```
buildContext() / skill 调用
        │  recall(query)
        ▼
  MemoryStore.recall()  ← 升级点：keyword → vector(sqlite-vec) + keyword 混合
        │
        ▼
  knowledge.db (sqlite-vec)  ← 新增：报告/thesis/复盘/filing 的 chunk + 向量
```

### 1.3 选型决策（已定，附理由，可推翻）

| 维度 | 方案文档 | 本方案选择 | 理由 |
|---|---|---|---|
| 向量库 | pgvector + Postgres | **sqlite-vec**（独立 `data/knowledge.db`） | 单用户无需起 Postgres；Bun 原生 `bun:sqlite` 可 `loadExtension`；零新服务 |
| Embedding | （未指定） | **本地 `fastembed` + `bge-m3`**（多语言，中英混合）经 Python sidecar | 免费、离线、报告是中英混排；延续免费优先。备选：Voyage/OpenAI（付费、需 key） |
| 对象存储 | MinIO | **文件系统**（filing PDF 放 `data/filings/`） | 单机过度设计，不引入 MinIO |
| 摄入触发 | — | cron（已有 scheduler）+ 一次性 backfill 脚本 | 复用现有自运转 |

> 为什么不用 pgvector：只有当数据量到百万级 chunk 或要多机共享时才值得。单用户研究语料量级（数千~数万 chunk）sqlite-vec 完全胜任，且 0 运维。**如果将来要上 Postgres，再把 knowledge.db 迁过去即可，schema 兼容。**

### 1.4 数据模型（新增 `data/knowledge.db`）

```sql
-- 研究产物主表（结构化，吸收方案 ResearchReport schema）
CREATE TABLE artifacts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  kind        TEXT NOT NULL,        -- research | thesis | reflection | journal | filing | earnings_call
  ticker      TEXT,                 -- 可空（宏观/主题类）
  title       TEXT,
  created_at  INTEGER NOT NULL,
  source_path TEXT,                 -- 原 markdown/pdf 路径（可追溯，方案 Principle 3）
  meta        TEXT,                 -- JSON：sector/theme/confidence/risk_score/direction…
  body        TEXT NOT NULL         -- 全文（检索命中后回灌给 agent）
);

-- chunk + 向量（sqlite-vec 虚拟表）
CREATE VIRTUAL TABLE chunks USING vec0(
  embedding   FLOAT[1024],          -- bge-m3 维度
  artifact_id INTEGER,
  chunk_idx   INTEGER,
  +text       TEXT                  -- 原文 chunk（vec0 辅助列）
);

-- 结构化研究报告（可对比/可打分，喂回 expert-validate 思路）
CREATE TABLE research_reports (
  id            INTEGER PRIMARY KEY,
  ticker        TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  thesis        TEXT,  bull_case TEXT,  bear_case TEXT,
  moat          TEXT,  valuation TEXT,  catalyst  TEXT,
  risk_analysis TEXT,
  confidence    REAL,                 -- 0~1
  risk_score    REAL,                 -- 0~10，见 §1.7
  artifact_id   INTEGER               -- 关联全文
);
```

### 1.5 摄入管线（backfill + 增量）

**一次性 backfill**（`scripts/kb-backfill.ts`）：扫 `skills/*/{ideas,scenarios,theses,reports}/*.md` + 已有 reflection 输出 → 切 chunk（~512 token，带 overlap）→ sidecar embed → 写 `knowledge.db`。

**增量**：
- skill 产出报告/thesis 时，在写 markdown 的同时调 `kb.ingest(artifact)`（新增 helper）。
- reflection cron（周日 21:00）结束时把 lessons 入库。
- SEC/earnings 管线（§4.2）产出直接入库。

**Embedding sidecar**（`scripts/embed-server.py`，FastAPI on 127.0.0.1:6901，与 OpenBB 同构）：
```
POST /embed  {texts:[...]} → {vectors:[[...]]}
```
fastembed 加载 `bge-m3`，常驻；nimbus TS 经 HTTP 调用。查询期延迟 ~30-80ms/条，可接受。冷启动用 launchd/tmux 拉起。

### 1.6 检索注入（recall 升级）
`db.ts` 的 `recall(query)`：
1. query 经 sidecar embed → sqlite-vec KNN 取 top-k chunk；
2. 关键词命中（保留原逻辑）做 reranking 兜底；
3. 按 artifact 去重、附 `[kind·ticker·date]` 标注后返回。

`buildContext()` 无需改（已调 recall）；另在 research/thesis/portfolio-manager skill 的 Step「数据预取」里显式加一步「先 `recall(ticker)` 看历史判断」。

### 1.7 结构化报告 + 风险评分引擎（吸收方案）
- research skill 的 Narrative 模式输出，**额外**落一份结构化记录进 `research_reports`（字段见 §1.4），不取代自由文本。
- 风险分沿用方案加权式，权重集中可调（对齐 equity-screener `weights.py` 的「权重集中 + 来源标注」习惯）：
  ```
  risk_score = valuation*0.20 + financial*0.20 + management*0.15
             + competition*0.15 + macro*0.10 + execution*0.10 + regulation*0.10
  ```
- 价值：历史判断**可查询、可对比、可前瞻验证**（接 equity-screener 已有的 `expert-validate` 思路：N 个月后回看 confidence/risk_score 对不对）。

### 1.8 知识闭环
```
research/thesis 产出 ─┐
reflection 复盘 lessons ─┼─→ knowledge.db ──recall──→ 下次分析预取历史判断
SEC/earnings 管线 ─────┘                                    │
        ▲                                                   │
        └──────────────── 决策结果回填 decisions 表 ◀────────┘
```

### 1.9 落地步骤（Phase A）
1. `scripts/embed-server.py` + launchd 守护；`uv`/miniforge 装 `fastembed`。
2. `src/core/knowledge.ts`：sqlite-vec 加载、`ingest()` / `search()`。
3. `data/knowledge.db` 建表（迁移脚本）。
4. `db.ts.recall()` 接 `knowledge.search()`（保留关键词兜底）。
5. `scripts/kb-backfill.ts` 灌历史 markdown。
6. research/thesis/portfolio-manager skill 加「预取 recall」+ 结构化落库。
7. 测试：`recall("NVDA")` 能召回历史 thesis/report。

**新增文件**：`scripts/embed-server.py`、`scripts/kb-backfill.ts`、`src/core/knowledge.ts`、迁移脚本。**改动**：`db.ts`(recall)、3 个 skill 的 SKILL.md。

---

## 2. OpenBB 接入

### 2.1 形态：本地 MCP（与现有 MCP 同构，最低税）
- `pip install openbb openbb-mcp-server`（Python 3.9–3.12，独立 venv）。
- 起 `openbb-mcp` stdio/HTTP server。
- 注册进 `secrets/mcp.json`（与 longbridge/cmc/alpaca 并列）。
- 可选薄封装 skill `openbb-data`，写清 description 与 NOT-for（避免与 longbridge/futu/market-data 误触发）。

### 2.2 定位：**免费美股/宏观 fallback，不替换持牌源**
更新数据源优先级 doctrine（写进 SYSTEM.md §2.4）：

| 数据类 | 主源 | 回退 1 | 回退 2 |
|---|---|---|---|
| A/H 报价·财务·估值 | Longbridge MCP(持牌) | futu OpenD | akshare(仅兜底) |
| A 股独家扫描(龙虎榜/北向/涨停) | akshare | — | — |
| 美股报价·基本面 | FMP / Finnhub / futu | **OpenBB** | — |
| 美股 SEC/filings/transcripts | SEC EDGAR(直) | **OpenBB** | — |
| 宏观 | FRED | **OpenBB(多源聚合)** | World Bank |

> OpenBB 价值在**多源聚合 + filings/transcripts/screener 的统一接口**，正好喂 §4.2 的 SEC/earnings 管线。但 A/H 弱、无 A 股独家扫描，**不进 A/H 主链路**。

### 2.3 落地步骤（Phase B）
1. 独立 venv 装 OpenBB + mcp-server；冒烟（拉一条美股 + 一条 FRED）。
2. 加进 `mcp.json`，nimbus 重启验证工具可见。
3. （可选）`openbb-data` skill；写清边界。
4. SYSTEM.md 数据源表更新。

---

## 3. TradingView 评估结论

**不接入为数据源/skill。** 依据：
- TradingView **无公共数据 API**；REST 仅给券商接入；数据只对持牌 Charting Library 伙伴开放。
- 唯一对个人免费的是 **Charting Library / Widget**（自托管 JS 图表组件，非数据）。
- 非官方 `tradingview-ta`（技术评级爬虫）脆弱、可能违反 ToS，**不进体系**。

**可选（低优先）**：在 equity-screener 的 React 报告 viewer 里嵌 TradingView **Advanced Chart Widget**，纯前端展示 K 线/画线，数据仍走自有源。属锦上添花，不在本方案关键路径。

---

## 4. 体系架构优化（现有项目）

### 4.1 研究产物统一化（治理「markdown 散落」）
- 现状：产物散在各 skill 子目录，无统一索引、不可跨 skill 检索。
- 改造：所有产物**双写**——人读的 markdown（保留）+ `knowledge.db.artifacts`（机读/检索）。`source_path` 保留可追溯（方案 Principle 3）。
- 收益：knowledge 层、reflection、thesis-tracker 共享同一产物源，消除 drift。

### 4.2 补 SEC / Earnings-call 管线（吸收方案，接 OpenBB）
- 新 skill `filings-pipeline`：OpenBB/EDGAR 拉 10-K/10-Q/8-K → 切 chunk → 入 `knowledge.db`（kind=filing）→ 供 research 检索。重点公司清单复用 thesis/持仓。
- 新 skill `earnings-call`：OpenBB 拉 transcript → 情绪 + 管理层口径变化检测 → 入库（kind=earnings_call）+ 季度 insight 推送。
- 13F / insider **已有**（institutional-flow-tracker / insider-tracker / news 13F）——**不重做**，仅把其信号也写进 artifacts 供检索。

### 4.3 Skill 触发治理（42+ skill 误触发风险）
- 现状：SYSTEM.md 已点出「触发靠 description 质量」。
- 优化：① 建立 skill 能力矩阵文档（一图：输入→唯一 skill），② 对高重叠组（research/us-stock-analysis/market-pulse）补强互斥 NOT-for，③ 在 router 层加轻量「同类去重」防一问触发多 skill（CLAUDE.md 已有路由约定，落成代码/提示）。

### 4.4 数据源 doctrine 文档化
- 把 §2.2 的优先级表固化进 SYSTEM.md，每类数据「主源→回退」单一真相源，避免源 drift（延续 [[fmp-finnhub-free-tier-map]] / [[macro-13f-push-sources]] 的清单习惯）。

### 4.5 知识层 × reflection × decisions 闭环
- reflection 写 lessons → knowledge.db；decisions 表结果回填 → 关联 research_reports 的 confidence/risk_score → 周复盘算「判断命中率」。
- 让 [[nimbus-portfolio-state-sources]] 的「只信实时快照」原则延伸到研究层：**研究判断也带 as_of 与失效条件，过期自动降权**。

---

## 5. 路线图（取代方案 Phase 1-5，增量式）

| Phase | 内容 | 产出 | 依赖 |
|---|---|---|---|
| **A. 知识层**（最高优先） | §1 全部 | recall 向量化 + 历史报告可召回 | fastembed sidecar |
| **B. OpenBB** | §2 | 多一个免费美股/宏观/filing 源 | venv + mcp.json |
| **C. 结构化研究** | §1.7 + §4.1 | research_reports 表 + 双写 | A |
| **D. SEC/Earnings 管线** | §4.2 | filings/earnings 入知识库 | A + B |
| **E. 治理 + 闭环** | §4.3 §4.4 §4.5 | doctrine 文档 + 判断命中率 | A + C |

> A 与 B 可并行（互不依赖）。建议先 A（ROI 最高），B 顺手接。

---

## 6. 明确不做（拒绝项）
- ❌ LangGraph 第二编排层（与现有 scheduler+SDK 重复，集成税高，劈裂系统）。
- ❌ OpenBB 替换持牌源 / 进 A/H 主链路（A/H 弱、无独家扫描）。
- ❌ MinIO / Postgres 全量迁移（单用户过度设计；sqlite-vec 足够）。
- ❌ TradingView 数据源 / 非官方爬虫。
- ❌ 任何自动交易（红线）。

---

## 附：关键代码锚点
- 知识层接入：`src/core/memory.ts`（MemoryStore 接口）、`src/core/db.ts:279`（recall 实现）。
- 调度/cron：`src/modules/`（reflection / opportunity / reports …）。
- skill 产物目录：`skills/research/{ideas,scenarios}`、`skills/thesis-tracker/{theses,reports}`、`skills/trade-journal/reports`。
- MCP 注册：`secrets/mcp.json`。
- 风险/权重习惯参照：`equity-screener/src/ah_screener/weights.py`。
</content>
</invoke>
