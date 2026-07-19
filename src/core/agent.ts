/**
 * agent.ts — Thin wrapper around the Claude Agent SDK `query` function.
 *
 * Key design decisions:
 * - Never sets ANTHROPIC_API_KEY — auth comes from the user's CLI subscription.
 * - Two-layer trade defence:
 *     Layer 1: settings.local.json — trade-guard PreToolUse hook
 *              (~/.claude/hooks/trade-guard.sh) + IBKR permissions.deny —
 *              loaded via settingSources: ['local'] below.
 *     Layer 2: canUseTool from safety.ts — SDK-level callback that catches
 *              MCP order tools and Bash trade commands at query time.
 * - Passes settingSources: ['user', 'project', 'local'] so CLAUDE.md, skills,
 *   and settings.local.json (trade-guard hook + IBKR deny) are all loaded.
 * - cwd defaults to WORKSPACE constant.
 * - queryFn is injectable for testing (default = real SDK query).
 */

import { query } from '@anthropic-ai/claude-agent-sdk'
import type {
  SDKMessage,
  SDKSystemMessage,
  SDKAssistantMessage,
  SDKPartialAssistantMessage,
  SDKResultSuccess,
} from '@anthropic-ai/claude-agent-sdk'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { PROJECT_ROOT, MCP_DEFAULT_ALLOW } from '../config.js'
import { getProvider, computeCostUsd } from './provider.js'
import { canUseTool, makeCanUseTool } from './safety.js'
import type { Approver } from './safety.js'
import type { AgentRunner } from '../modules/module.js'

// ── MCP servers ───────────────────────────────────────────────────────────────
// The SDK only exposes MCP servers passed via the `mcpServers` option — it does
// NOT auto-load them from settings. So we read the user's local MCP config
// (~/.claude.json + ~/.claude/mcp.json) and pass them through, giving the agent
// the same data tools (tavily news / cmc / alpaca / grok-search / futu-stock)
// it has in interactive Claude Code. claude.ai-hosted MCPs aren't in these files
// (the harness injects those), so only locally-runnable servers are loaded.
// MCP servers to exclude from the agent (redundant / unwanted).
// grok-search dropped: tavily already covers web search + news.
const MCP_EXCLUDE = new Set(['grok-search'])

/**
 * Load all available MCP servers from the three config sources, merge them,
 * and strip the excluded set. This is the raw full map — callers use
 * `filterMcp` to get only the servers they need.
 */
function loadAllMcpServers(): Record<string, unknown> {
  const merged: Record<string, unknown> = {}
  // Read order: CC global first (fallback), then PROJECT secrets/mcp.json last
  // so the project's own copy (含密钥, gitignored) WINS → 独立、不依赖 ~/.claude。
  for (const p of [
    join(homedir(), '.claude.json'),
    join(homedir(), '.claude', 'mcp.json'),
    join(PROJECT_ROOT, 'secrets', 'mcp.json'),
  ]) {
    try {
      const raw = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>
      const servers = (raw.mcpServers ?? raw) as Record<string, unknown>
      if (servers && typeof servers === 'object') Object.assign(merged, servers)
    } catch { /* missing/unreadable → skip */ }
  }
  for (const k of MCP_EXCLUDE) delete merged[k]
  return merged
}

/**
 * Filter an MCP server map to only include the given allow-listed keys.
 * Exact key match — returns a new object with only the whitelisted servers.
 * Exported for unit tests.
 */
export function filterMcp(
  all: Record<string, unknown>,
  allow: readonly string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const key of allow) {
    if (Object.prototype.hasOwnProperty.call(all, key)) {
      result[key] = all[key]
    }
  }
  return result
}

// Full map loaded once at module init (all servers, minus excluded).
const ALL_MCP_SERVERS = loadAllMcpServers()
// Log the available server keys once at startup so key-name drift is visible.
process.stderr.write(
  `nimbus: MCP servers available — [${Object.keys(ALL_MCP_SERVERS).join(', ')}]\n`,
)

// ── Reply-style guidance (appended to the Claude Code preset) ─────────────────
// Counters the verbosity that the investment-advisor CLAUDE.md persona + injected
// behaviour rules + trade-rules hook otherwise produce on every message, and
// pins a conclusion-first, chat-friendly markdown format.
const REPLY_STYLE_APPEND = [
  '【核心使命 — 最高优先】',
  '你是帮主人**赚钱**的投资分析师,不是风控警察。主线:**机会/预期回报/风险报酬比/催化剂/该多大仓位去抓**。',
  '• 先给机会与判断,再附风险。主人方向常对、毁在执行——放大他的判断,给可执行的赚钱方案。',
  '• 看不清就说,但给"什么信号出现就值得出手/加码"的前瞻,别一味劝退。',
  '',
  '【回复结构 — 结论先行,务必遵守】',
  '1. **第一行 = 一句话结论/动作**(粗体),关键数字粗体。主人一眼看到"怎么办"。',
  '2. 紧跟 1-3 句最关键要点(方向 / 预期空间 / 关键催化)。',
  '   给方向/判断时**带置信度**(高/中/低 或 概率%),并附一句**失效条件**(什么发生就推翻该判断)。',
  '3. 简单问题(查行情 / 闲聊 / 事实)到此为止,别展开。',
  '4. 要详细分析时:用 `---` 分隔线,**详细分析放在结论下面**,主人想深看才往下读。',
  '',
  '【Discord 格式 — 善用原生渲染,美观可扫读】',
  '• **粗体**标结论/数字 · `## 小标题`分区 · `> 引用`强调金句/关键判断 · 反引号标价格代码 · `-` bullet 列点 · `---`分隔结论与分析。',
  '• emoji 标区块,克制不滥用:📈看多 📉看空 ⚠️风险 ✅确认 🎯目标价 💡机会 📊数据。',
  '• **绝不用 markdown 表格**(Discord 渲染差)→ 改用 bullet 或「标签: 值」短行对齐。',
  '• 段落短、有留白、手机友好;深度分析也要分区分段,不要一大坨堆砌。',
  '• **涉及价格走势/多标的对比/历史分位/回测/组合配比时,主动写 python(matplotlib/pandas)出图**,图自动发到对话——一图胜千言,优于一堆数字。',
  '',
  '【其他】',
  '• 风控是护栏不是主题:只在主人真要做交易决策时简短带一句,平时别说教。',
  '• Cici 御姐人设,犀利克制,惜字如金。',
  '• AI 绝不下单:给【标的/方向/数量/价格】让主人手动执行;给明确建议时末尾附 ===DECISION=== 块(见 CLAUDE.md)。',
].join('\n')

// ── 微信群人格(PROVIDER=deepseek 实例)─────────────────────────────────────────
// 比奇堡群的独立轻量 system prompt(PROVIDER=deepseek 用)。
// 关键:这是【完整 system prompt】,不挂 claude_code 预设——省掉那十几 k 的内置工具定义。
// 闲聊默认零工具;只有 router 把消息判为分析/行情(sonnet/opus tier)时才注入行情 MCP,
// 即「分析按需才调用」。角色名册:群里仅一人是主人。内容边界:不产出色情/露骨内容。
const WEIXIN_SYSTEM_PROMPT = [
  '你是微信群「比奇堡堡外势力」里的 Andy,一个随性的群友(不是投资顾问工作台)。',
  '【风格】口语、短句、像群里的朋友;不要用 markdown(粗体/标题/列表/代码块都不要),不长篇大论,一般一两句话。',
  '  别说教,别用「作为AI/根据我的分析/建议您/综上所述/希望以上」这类腔调。',
  '【角色记忆】群里只有一个是主人——微信名「其实你也觉得没意思了对吧」;其余是普通群友。',
  '  对主人更上心;对其他人友好礼貌,但不透露主人的私事、账户、持仓等隐私。',
  '【分析按需】平时就是闲聊,别主动掉书袋。只有当有人真问到行情/某只股票/投资判断时才认真分析——',
  '  那种时候你会拿到行情工具,用工具给事实、别瞎编;没工具/不确定就直说。',
  '【内容边界】不发黄色/露骨/色情内容;有人往那个方向带,就轻描淡写带过或转移话题。涉及钱/交易不下单,只动嘴给信息。',
].join('\n')

// ── Subscription-mode guard ───────────────────────────────────────────────────

/**
 * Warn if an explicit API key is present in the environment, which suggests
 * the session may be billed against a pay-as-you-go key rather than the
 * user's Claude subscription.  Does NOT exit — just warns.
 * Skipped for non-claude providers (deepseek), where ANTHROPIC_API_KEY holds
 * the provider's own key and is required for authentication.
 */
export function assertSubscriptionMode(): void {
  if (getProvider() === 'claude' && process.env['ANTHROPIC_API_KEY']) {
    process.stderr.write(
      '[nimbus/agent] WARNING: ANTHROPIC_API_KEY found in environment. ' +
      'Nimbus is designed to run under the Claude subscription (not a billed API key). ' +
      'Requests may be charged against that key instead.\n',
    )
  }
}

// ── Text extraction helper ────────────────────────────────────────────────────

function extractText(msg: SDKAssistantMessage): string {
  const content = msg.message.content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text') {
      // BetaTextBlock always has `text: string`; cast to access it.
      parts.push((block as { type: 'text'; text: string }).text)
    }
  }
  return parts.join('')
}

/** Extract text delta from an SDKPartialAssistantMessage (stream_event).
 *  Returns empty string for non-text-delta events (tool start, message_start, etc.). */
function extractPartialText(msg: SDKPartialAssistantMessage): string {
  const ev = msg.event
  if (
    ev.type === 'content_block_delta' &&
    ev.delta.type === 'text_delta'
  ) {
    return (ev.delta as { type: 'text_delta'; text: string }).text
  }
  return ''
}

// ── QueryFn type ──────────────────────────────────────────────────────────────

/** Shape of the real SDK `query` function, used for injection in tests. */
export type QueryFn = typeof query

// ── Usage tracking (Phase 1 省额度可见性) ─────────────────────────────────────

/** One agent run's cost/token usage, captured from the SDK result message. */
export interface UsageRecord {
  model: string
  costUsd: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
}

// Module-level sink so EVERY agent.run (conversation/report/alert) is captured
// centrally, regardless of caller. main.ts wires it to db.logUsage.
let usageLogger: ((u: UsageRecord) => void) | undefined
export function setUsageLogger(fn: (u: UsageRecord) => void): void {
  usageLogger = fn
}

// ── AgentRunner implementation ────────────────────────────────────────────────

export class AgentRunnerImpl implements AgentRunner {
  private readonly queryFn: QueryFn

  /**
   * @param queryFn - Defaults to the real SDK `query`.  Pass a mock in tests
   *   to assert that the correct options (settingSources, canUseTool, etc.)
   *   are forwarded without making real network calls.
   */
  constructor(queryFn: QueryFn = query) {
    this.queryFn = queryFn
  }

  async run({
    prompt,
    resume,
    cwd,
    model,
    onText,
    approver,
    effort,
    settingSources,
    blockAccount,
    allowPaperTrade,
    mcpAllow,
  }: {
    prompt: string
    resume?: string
    cwd?: string
    model?: string
    onText?: (t: string) => void
    approver?: Approver
    /** Reasoning effort: low(haiku/闲聊) / medium(sonnet) / high(opus 深度). */
    effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    /** Override settingSources for special calls (e.g. portfolio-refresh needs
     *  'user' to reach the claude.ai IBKR connector). Default = lean project+local. */
    settingSources?: ('user' | 'project' | 'local')[]
    /** 非本人提问 → 禁查主人账户/持仓工具(隐私隔离)。 */
    blockAccount?: boolean
    /** ★长桥模拟盘下单放行(仅 paper 模块、指纹验证通过后传 true)。 */
    allowPaperTrade?: boolean
    /** MCP server whitelist for this run. Defaults to MCP_DEFAULT_ALLOW.
     *  Pass [] to disable all MCP, or ['longbridge'] for paper-trade calls. */
    mcpAllow?: readonly string[]
  }): Promise<{ sessionId?: string; text: string }> {
    // One attempt with a given resume value. Wrapped so a stale session
    // ("No conversation found") can be retried once WITHOUT resume (fresh session)
    // instead of hard-failing every message on that chat.
    const attempt = async (resumeArg: string | undefined): Promise<{ sessionId?: string; text: string }> => {
    let sessionId: string | undefined
    let accumulatedText = ''
    let resultText: string | undefined
    let capturedUsage: UsageRecord | undefined
    // True once any stream_event (partial text delta) has been delivered to onText.
    // Used to suppress duplicate onText calls from the final assistant message.
    let hadStreamEvents = false

    const options: Parameters<typeof query>[0]['options'] = {
      // Phase 3 独立：从项目自带 .claude 加载（精简 CLAUDE.md + 项目 skill + 项目
      // settings.json 的 trade-guard hook + IBKR deny）。去掉 'user' 源 → 不再载入
      // 笨重的全局 CLAUDE.md + R1-R7 军规 hook（省额度 + 去教条）。代价：claude.ai
      // 托管连接器(IBKR/Gmail)随 'user' 一起退出 → IBKR 持仓改由 portfolio_state.json 提供。
      // PROVIDER=deepseek(微信群实例):瘦身——不载项目 skills/CLAUDE.md/hook(闲聊用不上,
      // 省每条消息的常驻 token);Cici 路径不变。
      // WeChat 频道：轻量闲聊，省 token 不加载 skills/CLAUDE.md/hook。
      // Cici（Discord/API）：完整投资人格 + trade-guard 护栏。
      settingSources: process.env['WEIXIN_INBOUND'] === '1'
        ? []
        : (settingSources ?? ['project', 'local']),
      // 两条都用 claude_code 预设(完整工具脚手架,机器人保有全部能力);只换 append:
      // deepseek → Andy 群聊人格;Cici → 投资风格。预设那段前缀虽大,但 DeepSeek 提示缓存
      // 会按 cache_read 计费(便宜 ~50 倍),同群第二条起几乎免费,故不为省 token 而砍能力。
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        // WeChat 频道：Andy 群聊人格；Cici（Discord/API）：御姐投资人格
        append: process.env['WEIXIN_INBOUND'] === '1' ? WEIXIN_SYSTEM_PROMPT : REPLY_STYLE_APPEND,
      },
      // AI 自适应思考:Claude 自己决定何时/想多深(难题多想、闲聊少想),不硬编码。
      // display:'omitted' 让思考过程不进回复,保持聊天端干净。
      thinking: { type: 'adaptive', display: 'omitted' },
      // DeepSeek V4 Pro: 默认 max reasoning effort（不传则用默认推理深度，偏浅）。
      // Claude: adaptive thinking 自适应，effort 仅当调用方显式指定时传入。
      ...(effort !== undefined ? { effort } : (getProvider() === 'deepseek' ? { effort: 'max' as const } : {})),
      // Give the agent only the whitelisted MCP servers for this run.
      // filterMcp returns a subset of ALL_MCP_SERVERS keyed by mcpAllow.
      // Empty result → omit mcpServers entirely (existing "空则不传" logic).
      ...(() => {
        const mcpServers = filterMcp(ALL_MCP_SERVERS, mcpAllow ?? MCP_DEFAULT_ALLOW)
        return Object.keys(mcpServers).length > 0
          ? { mcpServers: mcpServers as Parameters<typeof query>[0]['options'] extends { mcpServers?: infer M } ? M : never }
          : {}
      })(),
      cwd: cwd ?? PROJECT_ROOT,
      permissionMode: 'default',
      // Layer 2: SDK-level trade guard. With an approver, ASK-listed ops get
      // routed to the user for approval; without one, the static guard is used.
      canUseTool: approver || blockAccount || allowPaperTrade
        ? makeCanUseTool(approver, { blockAccount, allowPaperTrade })
        : canUseTool,
      includePartialMessages: true, // Enable streaming token-level deltas via stream_event.
      ...(resumeArg !== undefined ? { resume: resumeArg } : {}),
      ...(model !== undefined ? { model } : {}),
    }

    const stream = this.queryFn({ prompt, options })

    for await (const message of stream as AsyncIterable<SDKMessage>) {
      if (message.type === 'system') {
        const sys = message as SDKSystemMessage
        if (sys.subtype === 'init') {
          sessionId = sys.session_id
        }
      } else if (message.type === 'stream_event') {
        // Partial/streaming delta from includePartialMessages: true.
        // Extract text increments and forward to onText for throttled UI updates.
        const partial = message as SDKPartialAssistantMessage
        const delta = extractPartialText(partial)
        if (delta) {
          hadStreamEvents = true
          onText?.(delta)
        }
        // Note: accumulatedText is NOT updated here — the final assistant message
        // carries the complete text, so we rely on that for the result value.
      } else if (message.type === 'assistant') {
        const asst = message as SDKAssistantMessage
        const chunk = extractText(asst)
        if (chunk) {
          accumulatedText += chunk
          // When stream_event deltas were already delivered to onText, skip the
          // per-message call to avoid double delivery.  Fall back to per-message
          // delivery when no partial events were received (e.g., SDK version that
          // ignores includePartialMessages, or a response that emitted no text deltas).
          if (!hadStreamEvents) {
            onText?.(chunk)
          }
        }
      } else if (message.type === 'result') {
        if (message.subtype === 'success') {
          const r = message as SDKResultSuccess
          resultText = r.result
          const u = (r.usage ?? {}) as Record<string, unknown>
          const n = (k: string): number => Number(u[k] ?? 0) || 0
          const resolvedModel = Object.keys(r.modelUsage ?? {})[0] ?? model ?? 'inherited'
          const inputTokens = n('input_tokens') + n('cache_read_input_tokens') + n('cache_creation_input_tokens')
          const outputTokens = n('output_tokens')
          const cacheReadTokens = n('cache_read_input_tokens')
          // The SDK does not recognise deepseek-* model ids and always returns
          // total_cost_usd=0 for DeepSeek calls.  When running against the
          // DeepSeek backend, recompute cost from token counts using the
          // DeepSeek price table so budget tracking reflects real spend.
          // The Claude path uses the SDK value unchanged.
          const sdkCost = r.total_cost_usd ?? 0
          const costUsd = getProvider() === 'deepseek'
            ? computeCostUsd(resolvedModel, { inputTokens, cacheReadTokens, outputTokens })
            : sdkCost
          capturedUsage = {
            model: resolvedModel,
            costUsd,
            inputTokens,
            outputTokens,
            cacheReadTokens,
          }
        }
        // For error results we fall through to accumulated text.
      }
    }

    if (capturedUsage) {
      try { usageLogger?.(capturedUsage) } catch { /* never let logging break a turn */ }
    }

    return {
      sessionId,
      text: resultText ?? accumulatedText,
    }
    } // end attempt

    try {
      return await attempt(resume)
    } catch (err) {
      // Stale/expired session id → drop resume and start a fresh conversation once.
      if (resume !== undefined && /No conversation found|session ID|session not found/i.test(String(err))) {
        process.stderr.write(`nimbus: stale session ${resume} → 重开新会话\n`)
        return await attempt(undefined)
      }
      throw err
    }
  }
}

/** Singleton instance for use in module context. */
export const agentRunner: AgentRunner = new AgentRunnerImpl()
