import { jsx as _jsx } from "react/jsx-runtime";
import { Text } from "ink";
import { getPnLColor } from "../theme.js";
export function PnL({ value, showSign = true, decimals = 2 }) {
    const numValue = typeof value === "string" ? parseFloat(value) : value;
    if (isNaN(numValue)) {
        return _jsx(Text, { color: "gray", children: "-" });
    }
    const color = getPnLColor(numValue);
    const sign = showSign && numValue > 0 ? "+" : "";
    const formatted = `${sign}${numValue.toFixed(decimals)}`;
    return _jsx(Text, { color: color, children: formatted });
}
export function PnLPercent({ value, decimals = 2 }) {
    const numValue = typeof value === "string" ? parseFloat(value) : value;
    if (isNaN(numValue)) {
        return _jsx(Text, { color: "gray", children: "-" });
    }
    const color = getPnLColor(numValue);
    const sign = numValue > 0 ? "+" : "";
    const formatted = `${sign}${numValue.toFixed(decimals)}%`;
    return _jsx(Text, { color: color, children: formatted });
}
