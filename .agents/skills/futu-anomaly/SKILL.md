---
name: futu-anomaly
description: 个股多维异动一站式（合并 资金/技术/衍生品/情绪 四维，futu OpenD）。资金面(资金流向/主力/大单/卖空/经纪商) + 技术面(K线形态/MACD/RSI/KDJ/金叉死叉/超买超卖) + 衍生品(牛熊证/期权大单/IV/PCR/smart money) + 社区情绪(讨论多空比/热度)。当用户问「X 异动/有没有异常/资金动向/主力进出/净流入流出/技术信号/形态/超买超卖/期权大单/隐含波动率/牛熊证/聪明钱押注/社区情绪/散户讨论/市场情绪/大家怎么看」时触发。先把名字归一为 US.NVDA / HK.00700 格式。默认扫全部四维，可 --dim 指定。需 OpenD 在线(部分 unusual 数据需 futu 数据权限)。
---

# Futu Anomaly — 多维异动（合并资金/技术/衍生品）

```bash
python3 skills/futu-anomaly/scripts/anomaly.py US.NVDA            # 全三维
python3 skills/futu-anomaly/scripts/anomaly.py HK.00700 --dim capital,technical
python3 skills/futu-anomaly/scripts/anomaly.py US.TSLA --dim derivatives --time-range 14
```
维度：`capital`(资金) · `technical`(技术) · `derivatives`(衍生品) · `all`(默认)。

## 说明
- 合并自原 futu-capital/technical/derivatives-anomaly 三个 skill（3→1，单一入口、broad 异动请求一次跑全维）。
- 需 futu OpenD 在线；部分 unusual 端点需对应 futu 数据权限（无权限返回空/err_code）。
- 符号格式 `市场.代码`：US.NVDA / HK.00700 / SH.600519。⚠️ 非投资建议。
