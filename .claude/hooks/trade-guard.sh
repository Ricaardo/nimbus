#!/bin/bash
# AI 下单权限：完全关闭。任何下单/改单/撤单/交易执行 → permissionDecision=deny（硬拦截）
# 覆盖：futu place/modify/cancel_order.py + hyperliquid hl 交易子命令 + polymarket/通用下单脚本
# 只读（持仓/行情/组合/成交查询）不匹配 → 放行
# 用户本人仍可用 ! 前缀手动下单（hook 只拦 AI 的工具调用，不拦用户）
input=$(cat)
cmd=$(printf '%s' "$input" | python3 -c "import sys,json
try:
    print(json.load(sys.stdin).get('tool_input',{}).get('command',''))
except Exception:
    print('')" 2>/dev/null)

# 下单意图模式（尽量收紧，避免误伤只读）
PATTERN='(place_order|modify_order|cancel_order|submit_order|create_order|send_order)\.py'
PATTERN+='|(^|[^[:alnum:]_])hl[[:space:]]+(order|buy|sell|cancel|close|market|limit|trade|long|short|twap)'
PATTERN+='|polymarket.*(--buy|--sell|place|trade|order)'
PATTERN+='|(^|/)(buy|sell)\.py'

if printf '%s' "$cmd" | grep -Eiq "$PATTERN"; then
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"⛔ AI 下单权限已被主人完全关闭。任何下单/改单/撤单一律拒绝执行。如需交易，请主人本人在终端用 ! 前缀手动操作（如 ! hl buy ...），或先让我恢复护栏。"}}'
fi
exit 0
