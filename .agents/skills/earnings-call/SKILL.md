---
name: earnings-call
description: 抓取并分析美股财报电话会 transcript——管理层口径/情绪、与上季的语气变化(更乐观/更谨慎)、指引措辞、分析师追问的痛点,生成季度 insight 并入知识库供日后召回。数据优先 OpenBB MCP transcript 工具,兜底 WebSearch/WebFetch 公开来源。当用户问「X 财报电话会/earnings call/管理层怎么说/guidance 口径/conference call 重点」或财报季跟踪重点公司时触发。NOT for: 财务数字/业绩 beat-miss→us-stock-analysis/valuation；SEC 文件→filings-pipeline；新闻列表→news-dashboard。仅信息参考,非投资建议。
---

# Earnings Call — 财报电话会分析 + 入库

财报数字看 beat/miss,但**管理层口径与语气变化**往往是先行信号。把它结构化、可累积。

## 工作流

### Step 1: 拿 transcript
- 优先 **OpenBB**（python CLI,零 MCP 成本）:
  ```bash
  ~/nimbus-os/nimbus/.venv-openbb/bin/python -c "from openbb import obb; print(obb.equity.fundamental.transcript('NVDA', year=2026, provider='fmp').to_df())"
  ```
  （交互式想用 OpenBB MCP 工具,该 run 显式 `mcpAllow: ['openbb']`；默认休眠。）
  **OpenBB 命令速查**：`~/nimbus-os/nimbus/skills/references/openbb-commands.md`。
- 兜底 `WebSearch`/`WebFetch`(免费,Motley Fool/Seeking Alpha/公司 IR 常有全文)。

### Step 2: 分析(四个维度)
1. **口径情绪**:整体偏乐观/中性/谨慎;给 1~5 分 + 关键措辞引用。
2. **环比语气变化**(最有价值):对照上季 transcript(知识库里若有,先 `recall`),管理层在需求/利润率/竞争/指引上的措辞是**更强还是更弱**。
3. **指引措辞**:具体数字 + 限定词("at least"/"approximately"/"headwinds")。
4. **分析师追问**:他们反复追问的点 = 市场最担心的痛点。

### Step 3: 季度 insight + 入库(kind=earnings_call)
```bash
cat <<'DOC' | bun run ~/nimbus-os/nimbus/scripts/kb-ingest.ts --kind earnings_call --ticker NVDA --title "NVDA FY26Q1 电话会"
<四维分析正文,含与上季对照>
DOC
```

### Step 4: 联动
- 语气显著转向(转谨慎/转乐观) → `thesis-tracker` 加 data point、重估 conviction。
- 指引 vs 共识背离 → `research` Scenarios 推演。

## 重点跟踪清单（财报季自发运转可用）
NVDA · MSFT · META · GOOGL · AMZN · TSLA · AVGO + 当前持仓/thesis 标的。

## 注意
- 只信公开 transcript;只做美股。
- 与上季对照依赖知识库已有该标的 earnings_call artifact → 坚持每季入库才形成对照链。
