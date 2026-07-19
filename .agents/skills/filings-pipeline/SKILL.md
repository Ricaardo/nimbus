---
name: filings-pipeline
description: 抓取并摘要美股 SEC 文件(10-K 年报/10-Q 季报/8-K 临时报告),提炼关键变化(风险因子增删、MD&A 口径、重大事件),并入知识库供日后研究语义召回。数据优先 SEC EDGAR(免费直连),OpenBB MCP 兜底。当用户问「X 最新 10-K/10-Q/8-K/年报季报说了什么/风险因子变化/SEC filing」或在做深度研究需要原始披露时触发。NOT for: 内部人 Form 4→insider-tracker；13F→institutional-flow-tracker；财务三表数字→valuation/us-stock-analysis；A股公告→equity-screener。仅信息参考,非投资建议。
---

# Filings Pipeline — SEC 文件抓取 + 摘要 + 入库

把 10-K/10-Q/8-K 从"读一次就丢"变成"可累积、可语义召回"的研究资产。

## 工作流

### Step 1: 定位文件
- 优先 **SEC EDGAR** 全文检索(免费):`https://efts.sec.gov/LATEST/search-index?q=...&forms=10-K`,或公司 filings 页 `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&ticker=<T>&type=10-K`。
- 兜底 **OpenBB**（任意对话可用,零 MCP 成本,走 python CLI）:
  ```bash
  ~/nimbus-os/nimbus/.venv-openbb/bin/python -c "from openbb import obb; print(obb.equity.fundamental.filings('NVDA', provider='sec').to_df().head(20))"
  ```
  （交互式想用 OpenBB MCP 工具时,该 run 显式 `mcpAllow: ['openbb']`；默认休眠不占 token。）
  **OpenBB 完整命令→provider 速查**：`~/nimbus-os/nimbus/skills/references/openbb-commands.md`（别凭空猜命令路径）。
- 用 `WebFetch`(免费)抓正文,需要深度多源再上 tavily。

### Step 2: 提炼(不是全文复制,是结构化摘要)
- **10-K**:业务/护城河变化、风险因子**与上一年的增删**(新增风险最有信息量)、MD&A 口径、关键财务趋势、资本配置。
- **10-Q**:季度环比变化、指引调整、一次性项目。
- **8-K**:事件性质(高管变动/并购/重大合同/重述)+ 对 thesis 的影响。
- 必给一句话:**这份文件相对市场预期/上期，最重要的 1 个变化是什么**。

### Step 3: 入知识库(kind=filing)
```bash
cat <<'DOC' | bun run ~/nimbus-os/nimbus/scripts/kb-ingest.ts --kind filing --ticker NVDA --title "NVDA 10-K FY2026 摘要"
<结构化摘要正文>
DOC
```
让未来对该标的的 `research`/`thesis-tracker` 分析自动召回披露原文要点。

### Step 4: 联动
- 风险因子新增/恶化 → 提示 `thesis-tracker` 复审对应 pillar。
- 8-K 重大事件 → `research` Scenarios 模式推演影响。

## 注意
- SEC EDGAR 有 fair-access 限速,带 `User-Agent: <name> <email>`。
- 只做美股;A股/港股公告走 equity-screener 的 HKEXnews/公告解析。
