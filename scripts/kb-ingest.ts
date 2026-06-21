#!/usr/bin/env bun
/**
 * kb-ingest.ts — 知识层入库工具(给 skill 调用 + 历史 backfill)。
 *
 * 两种用法:
 *
 *   单篇入库(skill 产出报告后调用):
 *     bun run scripts/kb-ingest.ts --kind thesis --ticker NVDA --title "NVDA 多头" --file path/to/report.md
 *     echo "正文..." | bun run scripts/kb-ingest.ts --kind research --ticker AAPL --title "..."
 *     echo "正文..." | bun run scripts/kb-ingest.ts --kind framework --title "大师研习" --source-path "masters-study:ah:2026-06-21"
 *
 *   历史回填(一次性,把散落 markdown 灌进 knowledge.db):
 *     bun run scripts/kb-ingest.ts backfill
 *
 * 依赖 kb-server.py 在跑(127.0.0.1:6901)。失败非致命(知识层弱依赖)。
 */
import { readFileSync } from 'fs'
import { basename, resolve } from 'path'
import { kbIngest, kbHealth } from '../src/core/knowledge.js'
import { SKILLS_ROOT } from '../src/config.js'

// 从文件名猜 ticker(如 CRCL_thesis.md → CRCL;NVDA-2026Q1.md → NVDA)。
function guessTicker(file: string): string | undefined {
  const m = basename(file).match(/^([A-Z]{1,6}(?:\.[A-Z]{1,2})?)[._-]/)
  return m ? m[1] : undefined
}

// 从 markdown 首个 # 标题取 title,退化用文件名。
function guessTitle(body: string, file: string): string {
  const m = body.match(/^#\s+(.+)$/m)
  return (m ? m[1] : basename(file).replace(/\.md$/, '')).slice(0, 120)
}

interface ScanTarget {
  glob: string
  kind: string
}

const BACKFILL_TARGETS: ScanTarget[] = [
  { glob: 'research/ideas/**/*.md', kind: 'research' },
  { glob: 'research/scenarios/**/*.md', kind: 'research' },
  { glob: 'thesis-tracker/theses/**/*.md', kind: 'thesis' },
  { glob: 'thesis-tracker/reports/**/*.md', kind: 'thesis' },
  { glob: 'trade-journal/reports/**/*.md', kind: 'journal' },
]

// 投资大师框架 + 白毛股神方法论 → kind=framework(稳定智慧,任何分析时 recall 浮出)。
// 直接点名 SKILL.md(backfill 的 SKIP 规则会排除 SKILL.md,故单列)。
const FRAMEWORK_DOCS: Array<{ path: string; title: string }> = [
  // 协议摘要(怎么应用 — 量化门槛/5步检查/失效条件)
  { path: 'value-perspective/SKILL.md', title: '价值投资核心大师协议(Buffett/Lynch/Klarman/Bogle/Templeton/Greenblatt/Ackman/段永平)' },
  { path: 'macro-perspective/SKILL.md', title: '宏观周期6大师协议(Soros/Druckenmiller/Marks/Dalio/Simons/Mauboussin)' },
  { path: 'serenity-tracker/SKILL.md', title: '白毛股神Serenity瓶颈理论方法论(AI半导体供应链)' },
  { path: 'serenity-tracker/references/bottleneck-theory.md', title: '白毛股神瓶颈理论深度档:AI算力供应链瓶颈迁移图(光/CPO/HBM/InP衬底/Neocloud/太空)+选股逻辑+误用风险' },
  // 大师深度档(表达DNA + 成功/失败案例库 + 思维模式 + 常见误用)——分析时浮出真实案例
  { path: 'value-perspective/references/warren-buffett/dna-and-cases.md', title: 'Buffett深度档:护城河类型/See\'s/GEICO/KO/Apple成功·IBM/Kraft/Tesco失败/4道闸门' },
  { path: 'value-perspective/references/warren-buffett/sources/letters/primary-source-map.md', title: 'Buffett原文RAG索引:股东信精选(1983商誉/1989错误/2007护城河/2014五十周年/2024认错与长期持有)' },
  { path: 'value-perspective/references/duan-yongping/dna-and-cases.md', title: '段永平深度档:本分/stop doing不为清单/买公司不是买股票/能力圈不懂不做/网易抄底·苹果·茅台/DCF是思维方式/A股港股首选视角' },
  { path: 'value-perspective/references/duan-yongping/sources/qa/primary-source-map.md', title: '段永平问答资料RAG锚点:投资问答录/雪球问答/网易访谈/哈佛中国论坛线索(本分/能力圈/stop doing/DCF思维/网易苹果茅台)' },
  { path: 'value-perspective/references/seth-klarman/dna-and-cases.md', title: 'Klarman深度档:安全边际/3种便宜来源/forced sellers/下行优先/Lehman债权案例' },
  { path: 'value-perspective/references/joel-greenblatt/dna-and-cases.md', title: 'Greenblatt深度档:Magic Formula/ROIC+EBIT-EV/spin-off分拆/特殊情况投资' },
  { path: 'value-perspective/references/peter-lynch/dna-and-cases.md', title: 'Lynch深度档:6类公司分类/PEG/tenbagger/生活观察/Magellan实战/scuttlebutt' },
  { path: 'value-perspective/references/john-bogle/dna-and-cases.md', title: 'Bogle深度档:被动指数/成本数学/Bogleheads4法则/不择时' },
  { path: 'value-perspective/references/john-templeton/dna-and-cases.md', title: 'Templeton深度档:极度悲观点/全球CAPE价值/逆向/1939战时经典' },
  { path: 'value-perspective/references/bill-ackman/dna-and-cases.md', title: 'Ackman深度档:8-12集中/不对称/催化激进/COVID CDS对冲/Valeant失败' },
  // 第二批补充大师(填思维/价值根基/成长质量/长期复利空缺)
  { path: 'value-perspective/references/charlie-munger/dna-and-cases.md', title: 'Munger深度档:逆向inversion/心智模型格栅/25种误判心理/激励/See\'s/Costco/BYD·阿里认错' },
  { path: 'value-perspective/references/benjamin-graham/dna-and-cases.md', title: 'Graham深度档:安全边际源头/Mr.Market/内在价值/net-net/防御vs进取/GEICO/Graham Number' },
  { path: 'value-perspective/references/philip-fisher/dna-and-cases.md', title: 'Fisher深度档:scuttlebutt闲聊调研/15要点/成长质量/Motorola长持/卖出三理由' },
  { path: 'value-perspective/references/nick-sleep/dna-and-cases.md', title: 'Nick Sleep深度档:规模经济共享SES/目的地分析/Costco/Amazon飞轮/极低换手长期复利' },
  { path: 'macro-perspective/references/george-soros/dna-and-cases.md', title: 'Soros深度档:反身性/盛衰循环/1992英镑/认错要快/试错下注' },
  { path: 'macro-perspective/references/stanley-druckenmiller/dna-and-cases.md', title: 'Druckenmiller深度档:流动性驱动/集中重注/顺势/择时/资本保全' },
  { path: 'macro-perspective/references/howard-marks/dna-and-cases.md', title: 'Marks深度档:钟摆/第二层思维/周期定位/风险即永久损失/逆向不蛮干' },
  { path: 'macro-perspective/references/howard-marks/sources/memos/primary-source-map.md', title: 'Howard Marks原文RAG索引:Oaktree备忘录精选(Risk/The Most Important Thing/Limits to Negativism/Taking the Temperature/Sea Change/I Beg to Differ)' },
  { path: 'macro-perspective/references/ray-dalio/dna-and-cases.md', title: 'Dalio深度档:经济机器/债务周期/全天候/桥水原则/相关性分散' },
  { path: 'macro-perspective/references/jim-simons/dna-and-cases.md', title: 'Simons深度档:量化统计套利/Medallion/信号vs噪声/系统化不情绪' },
  { path: 'macro-perspective/references/michael-mauboussin/dna-and-cases.md', title: 'Mauboussin深度档:期望投资/运气vs技能/基础率/市场隐含预期' },
]

// skill 子目录里这些是模板/说明,不是研究产物,跳过。
const SKIP = /(\/references\/|\/scripts\/|SKILL\.md$|README|TEMPLATE|EXAMPLE)/i

async function backfill(): Promise<void> {
  const h = await kbHealth()
  if (!h) {
    console.error('✗ kb-server 未运行(127.0.0.1:6901)。先启动 sidecar:')
    console.error('  .venv-kb/bin/python scripts/kb-server.py &')
    process.exit(1)
  }
  let ok = 0
  let skip = 0
  for (const t of BACKFILL_TARGETS) {
    const glob = new Bun.Glob(t.glob)
    for await (const rel of glob.scan({ cwd: SKILLS_ROOT })) {
      const path = `${SKILLS_ROOT}/${rel}`
      if (SKIP.test(path)) { skip++; continue }
      let body: string
      try { body = readFileSync(path, 'utf8') } catch { continue }
      if (body.trim().length < 80) { skip++; continue } // 太短不值得入库
      const res = await kbIngest({
        kind: t.kind,
        ticker: guessTicker(rel),
        title: guessTitle(body, rel),
        source_path: path,
        body,
        meta: { backfill: true },
      })
      if (res) { ok++; console.log(`✓ [${t.kind}] ${rel} → ${res.chunks} chunks`) }
      else console.error(`✗ ingest 失败: ${rel}`)
    }
  }
  // 大师框架种子
  let missingFramework = 0
  for (const f of FRAMEWORK_DOCS) {
    const path = `${SKILLS_ROOT}/${f.path}`
    let body: string
    try { body = readFileSync(path, 'utf8') } catch {
      missingFramework++
      console.error(`✗ framework seed 缺失: ${f.path}`)
      continue
    }
    const res = await kbIngest({ kind: 'framework', title: f.title, source_path: path, body, meta: { seed: true } })
    if (res) { ok++; console.log(`✓ [framework] ${f.path} → ${res.chunks} chunks`) }
  }
  if (missingFramework > 0) {
    console.error(`✗ ${missingFramework} 个 framework seed 缺失,请修正 FRAMEWORK_DOCS。`)
    process.exit(1)
  }
  const after = await kbHealth()
  console.log(`\n回填完成: ${ok} 篇入库, ${skip} 跳过。知识库现有 ${after?.artifacts} artifacts / ${after?.chunks} chunks。`)
}

function parseFlags(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      out[argv[i].slice(2)] = argv[i + 1] ?? ''
      i++
    }
  }
  return out
}

async function single(argv: string[]): Promise<void> {
  const f = parseFlags(argv)
  if (!f.kind) { console.error('--kind 必填 (research|thesis|reflection|journal|filing|earnings_call)'); process.exit(1) }
  let body = ''
  if (f.file) body = readFileSync(f.file, 'utf8')
  else body = await Bun.stdin.text()
  if (!body.trim()) { console.error('正文为空 (--file 或 stdin)'); process.exit(1) }
  const splitList = (v?: string): string[] | undefined =>
    v ? v.split(',').map(s => s.trim()).filter(Boolean) : undefined
  const res = await kbIngest({
    kind: f.kind,
    ticker: f.ticker || (f.file ? guessTicker(f.file) : undefined),
    title: f.title || (f.file ? guessTitle(body, f.file) : undefined),
    // 归一为绝对路径,避免相对/绝对 source_path 不一致造成重复入库(覆盖语义靠它)。
    source_path: f['source-path'] || (f.file ? resolve(f.file) : undefined),
    // ResearchArtifact v1 直通字段
    symbols: splitList(f.symbols),
    tags: splitList(f.tags),
    source_id: f['source-id'] || undefined,
    body,
    meta: f.confidence || f.risk_score ? { confidence: f.confidence, risk_score: f.risk_score } : undefined,
  })
  if (res) console.log(`✓ 入库 artifact #${res.artifact_id} (${res.chunks} chunks)`)
  else { console.error('✗ 入库失败(kb-server 未运行?)'); process.exit(1) }
}

const argv = process.argv.slice(2)
if (argv[0] === 'backfill') await backfill()
else await single(argv)
