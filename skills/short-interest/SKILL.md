---
name: short-interest
description: 查个股做空占比/做空压力——FINRA 每日 ShortVolume/TotalVolume(免费,无key)。当用户问「X 做空/空头/short interest/做空比例/谁在做空/空头拥挤」时触发。先把名字归一为美股 ticker。注意：这是每日"做空成交占比"(反映当日做空压力/拥挤度)，不是双月未平仓 short interest。NOT for: 卖空异动/沽空(港股A股)→futu-capital-anomaly；内部人→insider-tracker。非投资建议。
---

# Short Interest — 做空占比（FINRA 每日）

```bash
python3 skills/short-interest/scripts/short_vol.py NVDA           # 近5日
python3 skills/short-interest/scripts/short_vol.py TSLA --days 10
```
输出：近 N 日做空占比 + 趋势条 + 空/总成交量。

## 边界
- FINRA `cdn.finra.org/equity/regsho/daily`（免费、无 key、仅美股）。
- **是做空成交占比，非未平仓空头**：高占比=当日做空活跃/拥挤，可作 squeeze 风险或看空情绪参考，但不等于"空头持仓多少"。
- 当天/周末文件未发布会回退最近交易日。⚠️ 非投资建议。
