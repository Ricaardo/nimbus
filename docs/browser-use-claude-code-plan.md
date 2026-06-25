# 用 Claude Code 替代 browser-use 的 Agent 循环 — 设计方案

> 目标:不引入 `browser-use` 框架自带的 LLM 循环(它要计费 API key、且大脑不是 Claude Code),
> 而是**把 browser-use 那套"循环"逐个部件用 Claude Code 重建**——
> 大脑 = Claude Code(**订阅额度,无额外 API**),控制 = Claude Code **亲自逐步操作(非脚本生成)**。

---

## 0. 先拆解:browser-use 的"循环"到底由什么组成

`browser-use` 不是魔法,它的 `Agent.run()` 循环就是这 6 个部件:

| # | 部件 | browser-use 里是什么 |
|---|---|---|
| ① 感知(Perception) | 把当前页 DOM 抽成**带编号的可交互元素**(`[12]<button>登录</button>`)+ 可选截图 | `DomService` |
| ② 动作空间(Action space) | 一组**受限高层动作**:`click_element(index)` / `input_text(index,text)` / `scroll` / `go_to_url` / `extract_content` / `done` | `Controller` + 动作注册表 |
| ③ 决策(Brain) | LLM 看①、从②里挑下一步,输出**结构化动作** | **要你配的 LLM(API key,计费)** ← 就是这里要换掉 |
| ④ 执行(Execution) | 用 Playwright 把动作打到浏览器 | `BrowserSession`(底层就是 Playwright) |
| ⑤ 记忆/规划(Memory/Plan) | 维护动作历史、目标、可选 planner | Agent 内部 state |
| ⑥ 自定义动作(Extensibility) | `@controller.action` 装饰器注册你自己的 Python 动作 | Controller registry |

**关键洞察**:①②④本质都是 **Playwright 之上的封装**,③才是 browser-use 真正"自带 LLM"的地方。
**我们要做的,就是把 ③ 换成 Claude Code,其余部件用 Claude Code 生态里现成的等价物顶上。**

---

## 1. 逐部件替代映射

| browser-use 部件 | Claude Code 替代 | 说明 |
|---|---|---|
| ③ 决策 LLM(API key) | **Claude Code 本体(订阅)** | 大脑换成 Claude Code,零额外 API。这是整个方案的核心。 |
| ② 循环 | **Claude Code 原生 agent 循环** | Claude Code 本就是"看工具结果→推理→调下一个工具"的循环,天然就是 browser-use 的 loop。 |
| ① 感知 | **Playwright MCP 的 `browser_snapshot`** | 它返回**可访问性结构树,每个元素带 `ref`**(如 `ref=e12`)——和 browser-use 的"带编号元素"是一回事。复杂场景退化到 `browser_take_screenshot` 走视觉。 |
| ② 动作空间 | **Playwright MCP 的 `browser_*` 工具** | `browser_click(ref)` ≈ `click_element(index)`;`browser_type` ≈ `input_text`;`browser_navigate`/`browser_scroll`/`browser_select_option`… 一一对应。Claude 通过 tool-calling 输出结构化动作。 |
| ④ 执行 | **Playwright MCP 内部的 Playwright** | browser-use 底层也是 Playwright,这层完全一样。 |
| ⑤ 记忆/规划 | **Claude Code 的会话上下文 + TODO/扩展思考** | 同一任务内,前面每步的结果都在上下文里(=动作历史);规划用它的 reasoning / TodoWrite。 |
| ⑥ 自定义动作 | **Claude Code Skill(剧本)或自定义 MCP 工具** | 见第 4 节。`@controller.action` 的等价物。 |

> 一句话:**browser-use = Playwright + 自带 LLM 循环;我们 = Playwright(MCP) + Claude Code 当循环。**
> 同一套感知/动作层,只把"自带计费 LLM"换成"你的订阅 Claude Code",并且每一步都由 Claude Code 现场决策。

---

## 2. 两种落地设计

### 设计 A —— Playwright MCP + Claude Code(推荐,零自定义代码)

直接用微软官方 **Playwright MCP**:它已经把 browser-use 的①②④打包好了(结构化 snapshot + ref 动作 + Playwright 执行),Claude Code 的原生循环顶替③⑤。

```
你: 自然语言任务
      ▼
Claude Code(订阅, 大脑+循环)  ──观察→推理→单步动作→再观察──┐
      │ 调 browser_* 工具                                   │
      ▼                                                     │
Playwright MCP(本地)= 感知(snapshot/ref)+ 动作 + 执行 ────┘
      ▼
真实 Chrome(headed, 持久 user-data-dir, 登录态留本机)
```

装:
```bash
claude mcp add playwright -- npx -y @playwright/mcp@latest \
  --browser chrome --channel chrome --user-data-dir ~/.cc-browser-profile
```

**优点**:零自定义代码、官方维护、a11y 树天然防"点错元素"。**适合 95% 场景,先用它。**

### 设计 B —— browser-use 现成 MCP,砍掉它的 LLM,Claude Code 当大脑(已实测验证)

> ✅ 已在隔离 venv 实装 `browser-use==0.13.1` 验证:它**自带现成 MCP server**(`python -m browser_use.mcp`),
> **无需任何 API key、不开浏览器即可构造**,暴露 **15 个不依赖 LLM 的低层工具** + 1 个 LLM agent 工具。
> 所以 **Design B 根本不必改源码**——现成的就能让 Claude Code 当大脑。

**实测暴露的工具**(`browser_use/mcp/server.py`):

- ✅ 15 个 **keyless** 低层工具,正好给 Claude Code:
  `browser_get_state`(感知:带 index 的可交互元素)、`browser_click(index|坐标)`、`browser_type(index,text)`、
  `browser_scroll`、`browser_navigate`、`browser_extract_content`、`browser_get_html`、`browser_screenshot`、
  `browser_go_back`、`browser_list_tabs`/`browser_switch_tab`/`browser_close_tab`、
  `browser_list_sessions`/`browser_close_session`/`browser_close_all`。
- ❌ 1 个要砍/禁的:`retry_with_browser_use_agent` —— 调它**自己的 LLM**(无 key 时自动失效)。

**实测确认的关键事实**:`_init_browser_session()` 里 LLM 是**条件初始化**(`if api_key:` 才建,否则 `self.llm=None`);
低层工具全程不碰 `self.llm`。**所以只要不配 key,server 就是纯感知/动作引擎,大脑只能是 Claude Code。**

#### 落地(两选一)

**B-1 零改源码(推荐,实测可行)**:用现成 MCP,靠"不配 key + 权限 deny"把 agent 工具关死。
```bash
# 在隔离 venv 里(已建于 ~/browser-use-cc/.venv312)
claude mcp add browser-use -- python -m browser_use.mcp
# 浏览器内核(首次):playwright install chromium  或用系统 Chrome channel
```
`~/.claude/settings.json`:
```jsonc
{
  "permissions": {
    "deny":  ["mcp__browser-use__retry_with_browser_use_agent"],   // 关死它自带的 LLM 循环
    "allow": ["mcp__browser-use__browser_get_state","mcp__browser-use__browser_navigate",
              "mcp__browser-use__browser_screenshot","mcp__browser-use__browser_get_html",
              "mcp__browser-use__browser_extract_content","mcp__browser-use__browser_list_tabs"],
    "ask":   ["mcp__browser-use__browser_click","mcp__browser-use__browser_type",
              "mcp__browser-use__browser_scroll","mcp__browser-use__browser_switch_tab"]
  }
}
```
绝不配 OpenAI/Anthropic key 给这个 venv → agent 工具即便被调也无脑可用。**大脑只能是 Claude Code。**

**B-2 改源码(你已授权,作硬化)**:若想彻底无此工具,patch `browser_use/mcp/server.py`:
删 `list_tools` 里 `retry_with_browser_use_agent` 那个 `types.Tool(...)`(~384-457 行)+ `handle_call_tool`
里 `if tool_name == 'retry_with_browser_use_agent'` 分支(~492-493)+ `_retry_with_browser_use_agent` 方法
+ `Agent`/`ChatOpenAI`/`get_default_llm` 的 import。剩下纯 15 个低层工具。建议用 patch 文件 vendoring,便于跟版本升级。

#### 循环(Claude Code 当大脑)
Claude Code 调 `browser_get_state()` 看带 index 的元素 → 推理 → `browser_click(12)`/`browser_type(8,"…")` →
再 `browser_get_state()` → … 直到完成。**感知=browser-use(最强 DOM 抽取),大脑+循环=Claude Code(订阅),零计费 API。**

> 下面这段是早期"自写薄包装"的兜底设计;实测证明现成 MCP 已够用,通常**不需要**自写。保留备参。

#### (兜底备参)自写薄 MCP 包装

上面 B-1 实测已够用,**通常不需要**自写。仅当未来某版 browser-use 的现成 MCP 不再给低层控制、
或你要定制感知输出时,才自己包一层(用 `mcp`/`fastmcp`),骨架如下:

```python
# browser_use_mcp.py(骨架,无 LLM)
from fastmcp import FastMCP
from browser_use.browser import BrowserSession        # ① 感知+④ 执行
from browser_use.controller.service import Controller # ② 动作

mcp = FastMCP("browser-use-perception")
session = BrowserSession(headless=False, user_data_dir="~/.cc-browser-profile")
controller = Controller()

@mcp.tool()
async def get_state() -> str:
    """返回当前页带 index 的可交互元素(+ 可选截图路径)。"""
    st = await session.get_state_summary()       # browser-use 的 DomService 产物
    return st.element_tree_as_indexed_text()     # [12]<button>登录</button> 形式

@mcp.tool()
async def click(index: int) -> str:
    return await controller.act({"click_element_by_index": {"index": index}}, session)

@mcp.tool()
async def input_text(index: int, text: str) -> str:
    return await controller.act({"input_text": {"index": index, "text": text}}, session)

@mcp.tool()
async def navigate(url: str) -> str:
    return await controller.act({"go_to_url": {"url": url}}, session)

# scroll / extract_content / get_html… 同理映射 controller 动作
if __name__ == "__main__":
    mcp.run()   # stdio
```
```bash
claude mcp add browser-use-perception -- python /path/to/browser_use_mcp.py
```

**循环**:Claude Code 调 `get_state()` 看带 index 的元素 → 推理 → `click(12)`/`input_text(8,"...")` → 再 `get_state()` → … 直到完成。**大脑/循环=Claude Code(订阅),感知=browser-use,执行=Playwright,零计费 API。**

**优点**:browser-use 最强感知层 + Claude Code 当脑。**代价**:多一个 Python 依赖(独立 venv);B-2 还要写那一百多行。**设计 A 定位不准的站点才上 B。**

---

## 3. 循环实际怎么转(一次任务)

任务:"登录雪球,把 NVDA 最新研报标题给我"。Claude Code **逐步**(每行=一次工具调用+一次观察):

1. `browser_navigate("https://xueqiu.com/S/NVDA")` → `browser_snapshot()`(读到带 ref 的元素)
2. 看到登录态有效/或提示你登 → 继续
3. `browser_click(ref=研报标签)` → `browser_wait_for(...)` → `browser_snapshot()`
4. 从结构树读前 N 条标题+链接 → 整理 → 返回;判断任务完成(=browser-use 的 `done`)

**②③④⑤全在这一个循环里**:弹窗/改版/验证码当场看到当场应对(对应 browser-use 的自纠错),
不是写死脚本。**步数 = Claude Code 调用次数**(订阅额度),用 snapshot 优先、截图克制来省。

---

## 4. ⑥ 自定义动作 = browser-use `@action` 的两种等价物

browser-use 用 `@controller.action("订机票")` 注册自定义动作。在 Claude Code 下你有两条路,都**不写自动化脚本**:

**(a) Skill 剧本(首选,零代码)**——新增一个"动作"= 写一份 `~/.claude/skills/<name>/SKILL.md`:
```markdown
---
name: snowball-research
description: 登录雪球抓某标的最新研报标题+链接。用户说"雪球研报"时用。
---
步骤(给你自己的指引,用 browser_* 现场执行,不是脚本):
1. browser_navigate 到 https://xueqiu.com/S/{symbol}
2. 切"研报"标签;browser_snapshot 读前 N 条标题+链接(别截图)
3. 遇登录墙→停下提示主人手动登录;只读不写,不点可疑外链
```
Claude Code 自动发现、需要时读它当指引。**新增动作 = 新写一份 SKILL.md。**

**(b) 自定义 MCP 工具(需要真·新底层能力时)**——把一个确定性强、要复用的复合动作封成 MCP 工具(如 `book_flight(...)`)。等价于 browser-use 的 `@action`,但作为 Claude Code 的工具暴露。

> 拓展心法:**能力边界 = Playwright/MCP 工具;玩法 = 无限多的 Skill;大脑与控制权 = 永远是 Claude Code。**

---

## 5. browser-use 的"高级特性"在 Claude Code 下怎么覆盖

| browser-use 特性 | Claude Code 下 |
|---|---|
| 动作历史/记忆 | 同会话上下文天然保留每步结果;长任务用 TodoWrite/分段总结防上下文膨胀 |
| Planner(规划) | Claude 的 reasoning / 扩展思考 / 先列 TODO 再执行 |
| 自纠错 | 循环里看到新状态当场改路径(本来就比脚本强) |
| 结构化输出动作 | tool-calling 本身就是结构化 |
| 录制/回放(确定性) | Claude 每次现场重推,**更适应、但确定性弱**;要可复用就固化成 Skill 给"骨架" |
| 视觉定位(canvas/无 DOM) | `browser_take_screenshot` + Claude 视觉兜底(代价:token) |

**核心取舍**:browser-use 偏"可复现的自动化";Claude Code 偏"现场适应的智能体"。
你要的是后者(自然语言、agent 实时控制),所以这个替代不仅可行,而且**正是更契合你诉求的形态**。

---

## 6. 安全红线(不变)

1. 带登录态的浏览**不出本机**;绝不交云浏览器。
2. 链接安全:不自动点邮件/消息里的可疑链接,跟进前看清真实 URL,不明先问。
3. 写类动作(click/type/提交/上传)→ 用 `settings.json` 的 `permissions.ask` **每次确认**;读类(navigate/snapshot)放行。
4. 反爬隔离:匿名站用**单独 stealth profile**,**绝不在带登录态 profile 上挂 stealth**。
5. 交易/资金类网页操作一律停下交你本人,不代下单。

---

## 7. 落地清单

1. 设计 A:`claude mcp add playwright …` → headed 跑一次种登录态 → settings.json 配读放行/写确认。
2. 直接自然语言用;把常用流程逐个写成 `~/.claude/skills/<name>/SKILL.md`。
3. 若某站点定位不准,再评估设计 B(browser-use 感知层包 MCP)。

## 8. 待确认
1. 先走设计 A(零代码),还是你要我直接把设计 B 的 browser-use-as-MCP 薄包装也写出来?
2. 第一批要打通登录态/做成 Skill 的目标站是哪些?
3. 写动作默认每次确认,还是常用站点直接放行?
