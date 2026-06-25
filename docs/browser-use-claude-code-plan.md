# Browser-Use × Claude Code 最终方案(Agent 实时控制 · 无额外 API · 可拓展)

> 范围:**只用 Claude Code(CLI 本体)** 实现"自然语言操控浏览器做 Web UI 自动化"。
> 不集成 nimbus、不写自动化脚本——由 **Claude Code 这个 agent 本人**一步步控制浏览器。
> 大脑用你的 **Claude 订阅额度**(Max 计划),不另起按量计费 API。

---

## 0. 一句话

给 Claude Code 装上 **Playwright MCP**(本地真 Chrome + 持久登录态),然后你用自然语言下指令。
Claude Code 在它本就有的 **观察→推理→单步动作→再观察** 循环里**亲自**驱动浏览器——
不是它写一段脚本去跑,而是它每一步都看着页面做决定。

---

## 1. 核心原则:Agent 实时控制,不是脚本生成(你强调的点)

| | ❌ 脚本生成式 | ✅ Agent 实时控制(本方案) |
|---|---|---|
| 谁决定每一步 | 让模型写一段 Playwright/Selenium 脚本,脚本自跑 | Claude Code **每一步**亲自:看当前页 → 决定 → 调一个动作 → 看结果 |
| 遇到意外 | 脚本崩,不变通 | 当场看到、当场应对(关弹窗/换路径/喊你) |
| 像什么 | 写菜谱让机器人照做 | 一个会看屏幕的人坐那儿,你说一句它做一步 |

**Claude Code 天生就是后者**——它是个交互式 agent,工具调用就是"观察→行动"循环。
所以这条要求**默认满足**,关键是:**用 Playwright MCP 暴露的"原子动作工具"**(navigate/snapshot/click/type…),
**不要**去封装"跑完整脚本"的工具。Claude 自己拆解任务、逐步操作。

---

## 2. 为什么不需要额外 API

- Claude Code(Max 订阅)登录后,所有推理走**订阅额度**。
- Playwright MCP 是它的**工具**,工具调用的推理由订阅模型完成 → **零额外 API、零按量计费**。
- 带登录态的浏览**只在本机**(凭证存本地 profile),不碰任何云浏览器服务。
- 对比社区 `browser-use`/Browserbase:它们自带计费 LLM key + 云端浏览器 → 既花钱又有凭证外泄风险,**不用**。

---

## 3. 安装(三步)

### 3.1 给 Claude Code 加 Playwright MCP

```bash
claude mcp add playwright -- npx -y @playwright/mcp@latest \
  --browser chrome --channel chrome \
  --user-data-dir ~/.cc-browser-profile
```

(等价于在 `~/.claude.json` 或项目 `.mcp.json` 的 `mcpServers` 里加一条 `playwright`。)

### 3.2 种登录态(一次)

第一次 headed 跑起来后,在那个 Chrome 窗口里**手动登录**你要用的站点;
登录态落进 `~/.cc-browser-profile`,以后 Claude 复用,不必每次登。

### 3.3 设权限(关键:读放行、写要确认)

在 `~/.claude/settings.json`(或项目 `.claude/settings.json`)里:

```jsonc
{
  "permissions": {
    "allow": [
      "mcp__playwright__browser_navigate",
      "mcp__playwright__browser_snapshot",
      "mcp__playwright__browser_take_screenshot",
      "mcp__playwright__browser_wait_for"
    ],
    "ask": [
      "mcp__playwright__browser_click",
      "mcp__playwright__browser_type",
      "mcp__playwright__browser_file_upload",
      "mcp__playwright__browser_press_key"
    ]
  }
}
```

读类动作(导航/读结构/截图)自动放行;**写类动作(点击/输入/上传)每次问你** ——
这就是浏览器版的"护栏",防止它误点误交。觉得太啰嗦可把常用站点的 click/type 也挪进 `allow`。

---

## 4. 工具面(Playwright MCP 的原子动作)

| 工具 | 作用 | 省 token 提示 |
|---|---|---|
| `browser_navigate(url)` | 打开页面 | |
| `browser_snapshot()` | 读**可访问性结构树**定位元素 | **优先用它**,结构化、便宜 |
| `browser_click(ref)` / `browser_type(ref,text)` | 点 / 输入 | |
| `browser_select_option` / `browser_press_key` | 选择 / 按键 | |
| `browser_wait_for(text\|time)` | 等渲染/等元素 | 别盲点,先等 |
| `browser_take_screenshot()` | 截图给"肉眼"看 | **只在结构树不够时**才用,截图烧 token |
| `browser_tabs` / `browser_file_upload` / `browser_handle_dialog` | 标签/上传/弹窗 | |

**省额度心法:能用 `snapshot`(结构)就别 `screenshot`(像素)。**

---

## 5. 一次任务怎么跑(观察→单步动作循环)

你:"去雪球登录后,把 NVDA 的最新研报标题给我"。Claude Code 内部**一步步**:

1. `browser_navigate("https://xueqiu.com/S/NVDA")` → `browser_snapshot()`
2. 看到要登录 → 提示你(或用已存登录态)→ 继续
3. `browser_click(研报标签)` → `browser_wait_for(...)` → `browser_snapshot()`
4. 从结构树读出前 N 条标题+链接 → 整理 → 回给你

**第 2/3 步若弹窗、改版、要验证码,它在循环里当场看到并应对**——不是一段写死的脚本崩在那。

---

## 6. 拓展性:之后怎么新增"特定操作动作"(用 Skill,不写代码)

你要"以后能加一些特定动作,且完全 agent 控制"。正确姿势是 **加知识(Skill 剧本),不加脚本**:

### 6.1 即兴(零成本)
直接自然语言:"打开 X,搜 Y,把前 10 条标题给我"。一次性任务够用。

### 6.2 固化成 Claude Code Skill(推荐,可复用)
建 `~/.claude/skills/snowball-research/SKILL.md`:

```markdown
---
name: snowball-research
description: 登录雪球抓某标的的最新研报标题+链接。当用户要"雪球研报/雪球讨论"时用。
---
# 雪球研报抓取
前提:已用持久 profile 登录雪球。
步骤(给你自己的指引,不是脚本):
1. browser_navigate 到 https://xueqiu.com/S/{symbol}
2. 切到"公告/研报"标签
3. 用 browser_snapshot 读列表前 N 条标题与链接(别截图)
4. 若遇登录墙 → 停下提示主人手动登录后再试
5. 整理成「标题 — 链接」短行返回
注意:绝不点站内可疑外链;只读不写。
```

Claude Code 会**自动发现**这个 skill,需要时读它当指引、用同一套原子工具**现场执行**。
**新增一个动作 = 新写一份这样的 SKILL.md**,不写、不跑任何脚本——完全符合"agent 控制"。

### 6.3 新增"底层能力"(很少需要)
只有当 Playwright MCP **没有**的底层能力(特殊设备/协议)才在 MCP 层加工具。日常拓展几乎都停在 6.2。

> 拓展心法:**能力边界 = Playwright MCP 的原子工具;玩法 = 无限多的 Skill 剧本;控制权 = 永远在 agent。**

---

## 7. 安全红线

1. 带登录态的浏览**不出本机**;绝不交云浏览器(Browserbase/Steel)。
2. **链接安全**:不自动点开邮件/消息里的可疑链接;跟进前看清真实 URL,不明先问。
3. **不可逆/对外动作**(发帖/提交/删改/转账)→ 靠第 3.3 的 `ask` 权限**每次确认**。
4. **反爬隔离**:需要 stealth 的匿名公开站,用**另一个匿名 profile**;**绝不在带登录态的 profile 上挂 stealth**(防风控封号 + 指纹串味)。
5. 涉及**交易/资金**的网页操作一律停下交你本人,不代下单。

---

## 8. 失败模式与兜底

| 问题 | 处理 |
|---|---|
| 登录态过期 | headed 下你手动登一次,持久 profile 记住;agent 检测到登录页就停下提示 |
| 验证码/强反爬 | 不硬刚;切匿名 stealth profile 或转人工;别在主 profile 上试 |
| 结构树定位不到 | 退一步 `browser_take_screenshot` 给 Claude 看一眼(代价:token) |
| JS 重渲染慢 | `browser_wait_for` 显式等 |
| 无 Chrome | 把 `--channel chrome` 改 `chromium`(Playwright 自带) |

---

## 9. 落地清单

1. `claude mcp add playwright …`(第 3.1)。
2. headed 跑一次,登录目标站,种 profile(第 3.2)。
3. 在 settings.json 配读放行/写确认权限(第 3.3)。
4. 按需建 `~/.claude/skills/<name>/SKILL.md` 剧本(第 6.2),一个动作一份。
5. 直接自然语言用起来。

---

## 10. 待确认

1. 第一批要打通登录态的目标站?(决定先种哪些 profile)
2. 写动作(click/type)默认**每次确认**,还是对你常用站点直接放行?
3. 要不要我帮你起一个示例 skill(比如雪球/某研报站)当模板?
