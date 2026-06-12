import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
import { colors } from "../theme.js";
import { formatTimestamp } from "../../watch.js";
export function WatchHeader({ title, lastUpdated }) {
    const timestamp = lastUpdated
        ? lastUpdated.toLocaleTimeString("en-US", {
            hour12: false,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        })
        : formatTimestamp();
    return (_jsxs(Box, { marginBottom: 1, children: [_jsx(Text, { bold: true, children: title }), _jsx(Text, { color: colors.muted, children: " (watching)" }), _jsx(Box, { flexGrow: 1 }), _jsxs(Text, { color: colors.muted, children: ["Last updated: ", timestamp] })] }));
}
export function WatchFooter({ message = "Press Ctrl+C to exit" }) {
    return (_jsx(Box, { marginTop: 1, children: _jsx(Text, { color: colors.muted, children: message }) }));
}
