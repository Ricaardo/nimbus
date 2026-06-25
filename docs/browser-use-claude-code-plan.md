# Browser-Use 接入本地 Claude Code 方案（用订阅额度做自然语言 Web UI 操作）

> 目标:让你用**自然语言**指挥一个浏览器做 Web UI 操作(登录、点选、填表、抓取墙后数据、
> 截图核对),而"大脑"用的是**本地 Claude Code 的订阅额度**(Max 订阅),不另起按量计费的
> API key。本文给出架构选型、推荐方案、安全红线、落地步骤。
>
> 状态:Playwright MCP 已写入 `secrets/nimbus` 的 `secrets/mcp.json`(见下),即"已半接通"。
> 本方案把它收口成一个可复用、有护栏的能力。

---

## 0. 一句话结论

**用"Claude Code(订阅模式)+ Playwright MCP(本地真 Chrome + 持久登录态)"**:
Claude 自己读页面的可访问性树(a11y snapshot)、决定点哪、填什么,通过 MCP 工具驱动浏览器。
"大脑"就是已经跑在订阅额度上的那个 agent —— **不引入任何带 API key 的外部 browser-use 库**,
所以天然"用 CC 的 AI 额度"。

---

## 1. 关键约束:为什么不能用现成的 browser-use 库

社区的 `browser-use` / `Browserbase` / `Steel` 等方案,**自己持有一个 LLM API key**(OpenAI/
Anthropic 按量计费)来做决策循环。这违背你的核心诉求("用 Claude Code 的订阅额度"):

- 它们调的是**计费 API**,不是你的 Max 订阅 → 额外花钱,且账号体系不同。
- 把**带券商/邮箱登录态**的浏览器交给云端浏览器服务,是凭证外泄风险。

所以"用订阅额度"这条约束,直接锁死了架构:**决策必须由本地 Claude Code / Claude Agent SDK
(订阅模式,`preset: 'claude_code'`)发出**,浏览器只是它调用的一组工具(MCP)。
nimbus 现在正是这么跑的(`assertSubscriptionMode()` + `settingSources:['project','local']` +
preset claude_code),所以**接入点已经存在**。

---

## 2. 选型对比

| 方案 | 大脑 | 计费 | 页面感知 | 登录态 | 适用 | 取舍 |
|---|---|---|---|---|---|---|
| **A. Playwright MCP + CC**(推荐) | 本地 CC 订阅 | **订阅额度** | a11y 结构树(省 token) | 持久 user-data-dir(真 Chrome) | 绝大多数 Web UI / 墙后数据 | DOM 驱动、稳、便宜;需本机有 Chrome |
| B. chrome-devtools-mcp + CC | 本地 CC 订阅 | 订阅额度 | CDP | 可持久 | 调试向 | 能力综合弱于 A(微软 Playwright MCP 更全) |
| C. computer-use / 视觉点击 | 本地 CC 订阅 | 订阅额度(但**截图烧 token**) | 截图像素 | 跟随真实桌面 | 原生 app / canvas / 无 DOM | 贵、脆;浏览器在本环境是 read tier,点击被挡 |
| D. browser-use / 云浏览器 | **自带 API key** | ❌ 按量计费 | 视觉+DOM | 云端(凭证外泄) | — | **否决**:不走订阅 + 凭证风险 |

**结论:主选 A**。C 仅在没有 DOM 的场景(原生应用、画布)兜底;D 直接排除。

---

## 3. 推荐架构(方案 A 细节)

```
你: "Cici,去 X 站登录后把我自选股的研报标题抓下来"
        │ 自然语言
        ▼
Claude Code / nimbus agent  (订阅额度, preset claude_code)
        │ 调 MCP 工具
        ▼
@playwright/mcp  (本地 stdio 进程)
        │ CDP
        ▼
真实 Chrome (--channel chrome, headed)
   └── 持久 user-data-dir: /Users/x/.playwright-nimbus-profile  (带登录态)
```

### 3.1 它已经接好的部分

`~/nimbus-os/nimbus/secrets/mcp.json` 已有:

```json
"playwright": {
  "command": "npx",
  "args": ["-y","@playwright/mcp@latest",
           "--browser","chrome","--channel","chrome",
           "--user-data-dir","/Users/x/.playwright-nimbus-profile"],
  "type": "stdio"
}
```

`agent.ts` 的 `loadAllMcpServers()` 会自动加载它;只要某次 run 的 `mcpAllow` 含 `'playwright'`,
Cici 就能用浏览器工具。**Cici(Claude 订阅)和微信 DeepSeek 实例共用这一条配置**。

### 3.2 工具面(Playwright MCP 暴露的能力)

- `browser_navigate(url)` — 打开页面
- `browser_snapshot()` — 返回**可访问性结构树**(不是截图),Claude 据此定位元素,省 token
- `browser_click(ref)` / `browser_type(ref, text)` / `browser_select_option` / `browser_press_key`
- `browser_wait_for(text|time)` — 等渲染/等元素
- `browser_take_screenshot()` — **仅在需要肉眼核对时**才用(截图才烧 token)
- `browser_tabs` / `browser_file_upload` / `browser_handle_dialog` 等

**省额度要点:优先 `browser_snapshot`(结构化、廉价),`screenshot` 只在必要时。**

### 3.3 怎么"用订阅额度"——无需额外动作

nimbus/Cici 本来就跑在订阅模式(无 `ANTHROPIC_API_KEY`,走 `claude_code` preset)。
Playwright MCP 是工具调用,推理由那个订阅 agent 完成 → **天然计在订阅额度上**。
(微信 DeepSeek 实例若也开 `playwright`,则那条链路计在 DeepSeek key 上——按需选择哪个实例接浏览器。)

### 3.4 两种触发方式

1. **交互式**:你在 Discord/微信对 Cici 说"去某站抓某数据",该 run 的 `mcpAllow` 加 `'playwright'`。
   建议加一个轻量意图判断:只有当请求明显需要浏览器(给了 URL / "登录后"/"墙后"/"截图核对")才挂,
   避免每次闲聊都加载浏览器工具定义(省 token)。
2. **计划任务(module)**:做一个 nimbus module,定时用持久登录态去抓某个付费源(如某研报站),
   落库后进日报。复用现有 scheduler + module 体系。

---

## 4. 安全红线(沿用项目既有约定,务必照搬)

1. **带登录态的浏览不出本机**:凭证只存本地 `user-data-dir`,**绝不交给 Browserbase/Steel 等云浏览器**。
2. **链接安全**:不自动点开邮件/消息里的可疑链接;跟进前先看清真实 URL,不明就先问你。
3. **交易红线不变**:浏览器**绝不用于下单/改单/撤单/转账**;涉及资金动作一律停下交给你本人。
4. **对外/不可逆动作先确认**:发帖、发消息、提交表单、删改数据等,先报"将要做什么"再执行。
5. **反爬与登录态隔离**:需要反检测(stealth)的匿名公开站,用**另一个匿名 profile** + stealth;
   **绝不在带登录态的 profile 上挂 stealth**——两套场景物理隔离,避免风控封号 + 指纹串味。

---

## 5. 失败模式与兜底

| 问题 | 处理 |
|---|---|
| 登录态过期 | headed 模式下你本人扫码/输密一次,持久 profile 记住;agent 检测到登录页就停下提示 |
| 站点强反爬/验证码 | 不硬刚;切匿名 stealth profile 或转人工;别在主 profile 上试 |
| a11y 树定位不到元素 | 退一步 `browser_take_screenshot` 给 Claude 看一眼再决策(代价:token) |
| 页面 JS 重渲染慢 | `browser_wait_for` 显式等;别盲点 |
| Chrome 未装 / channel 不符 | 模板用 `--channel chrome`;无 Chrome 则改 `chromium`(Playwright 自带) |

---

## 6. 落地步骤(最小)

1. **确认 Chrome 在位**:`--channel chrome` 需要本机 Chrome;否则改 `chromium`。
2. **首次登录种 profile**:headed 跑一次,手动登录目标站,登录态落进 `/Users/x/.playwright-nimbus-profile`。
3. **意图门控**(可选但建议):在 dispatcher 给"需要浏览器"的请求把 `'playwright'` 加进 `mcpAllow`;
   其余请求不加(省工具定义 token)。
4. **加护栏**:把第 4 节红线接进 `canUseTool`/`safety.ts`(对 `browser_*` 的写动作走确认/拒绝),
   与现有 trade-guard 一致。
5. **(可选)计划任务 module**:封一个"墙后数据抓取"module,定时跑 + 落库 + 进日报。

---

## 7. 与微信 DeepSeek 实例的关系

- 浏览器能力**默认挂在 Cici(Claude 订阅)实例**——它推理强,适合复杂 Web 操作,且计订阅额度。
- 微信 DeepSeek 实例**默认不挂浏览器**(那个实例要去搜索、走轻量闲聊);若确需,再单独把
  `'playwright'` 加进它的 `mcpAllow`,但注意那会计在 DeepSeek key 上、且 DeepSeek 工具调用能力弱于 Claude。

---

## 8. 待你确认的点

1. 浏览器能力主要挂在 **Cici(Claude 订阅)** 还是也给微信实例?(建议:仅 Cici)
2. 第一批要打通登录态的目标站是哪些?(决定先种哪些 profile)
3. 是否要我把"意图门控 + browser_* 写动作护栏"也实现掉,还是先只保留手动触发?
